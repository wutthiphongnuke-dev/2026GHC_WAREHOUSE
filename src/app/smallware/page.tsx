"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import imageCompression from 'browser-image-compression';
import { 
    Search, Image as ImageIcon, UploadCloud, Package, MapPin, 
    ZoomIn, X, Activity, Camera, Layers, ChevronLeft, ChevronRight 
} from 'lucide-react';

export default function SmallwareCatalog() {
  const [userRole, setUserRole] = useState<string>('VIEWER');
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [categories, setCategories] = useState<string[]>([]);
  
  // 🟢 1. ลดจำนวนต่อหน้าลงเหลือ 30 เพื่อให้ DOM ไม่หนัก ไถลื่นบนมือถือทุกรุ่น
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 30; 
  
  // Image Upload & Zoom States
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);

  useEffect(() => {
      const init = async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
              const { data } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).single();
              setUserRole(data?.role || 'VIEWER');
          }
          fetchCatalog();
      };
      init();
  }, []);

  useEffect(() => {
      setCurrentPage(1);
  }, [searchTerm, categoryFilter]);

  const fetchCatalog = async () => {
      setLoading(true);
      try {
          const { data: prodData, error: prodErr } = await supabase
              .from('master_products')
              .select('product_id, product_name, category, base_uom, default_location, image_url, status')
              .eq('status', 'ACTIVE');
          
          if (prodErr) throw prodErr;

          const { data: lotsData } = await supabase.from('inventory_lots').select('product_id, quantity, storage_location');
          
          const invMap: Record<string, { qty: number, locs: Set<string> }> = {};
          (lotsData || []).forEach(lot => {
              if (!invMap[lot.product_id]) invMap[lot.product_id] = { qty: 0, locs: new Set() };
              invMap[lot.product_id].qty += Number(lot.quantity) || 0;
              if (lot.storage_location) invMap[lot.product_id].locs.add(lot.storage_location);
          });

          const cats = new Set<string>();
          const processed = (prodData || []).map(p => {
              if (p.category) cats.add(p.category);
              const stockInfo = invMap[p.product_id];
              return {
                  ...p,
                  current_qty: stockInfo ? stockInfo.qty : 0,
                  locations: stockInfo && stockInfo.locs.size > 0 ? Array.from(stockInfo.locs).join(', ') : p.default_location || 'N/A'
              };
          });

          processed.sort((a, b) => {
              if (a.image_url && !b.image_url) return -1;
              if (!a.image_url && b.image_url) return 1;
              return a.product_name.localeCompare(b.product_name);
          });

          setCategories(Array.from(cats).sort());
          setProducts(processed);
      } catch (error: any) {
          console.error(error);
          alert("Error: " + error.message);
      }
      setLoading(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, productId: string) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadingId(productId);
      try {
          // ลบรูปเก่าทิ้ง (เพื่อประหยัดพื้นที่ Supabase)
          const currentProduct = products.find(p => p.product_id === productId);
          if (currentProduct && currentProduct.image_url) {
              try {
                  const urlParts = currentProduct.image_url.split('/');
                  const oldFileName = urlParts[urlParts.length - 1]?.split('?')[0];
                  if (oldFileName) {
                      await supabase.storage.from('product_images').remove([oldFileName]);
                  }
              } catch (err) {
                  console.warn("ไม่สามารถลบรูปเก่าได้:", err);
              }
          }

          // 🟢 2. บีบอัดลงไปอีกขั้น: จำกัด 50KB และกว้างสุด 600px 
          // (ภาพยังชัดระดับ HD แต่ขนาดเล็กลงครึ่งนึงจากเดิม)
          const options = {
              maxSizeMB: 0.05, 
              maxWidthOrHeight: 600, 
              useWebWorker: true,
              fileType: 'image/webp' // แปลงเป็น WebP (เล็กลงกว่า JPG มากๆ)
          };
          const compressedFile = await imageCompression(file, options);

          const fileName = `${productId}-${Date.now()}.webp`;

          const { error: uploadError } = await supabase.storage
              .from('product_images')
              .upload(fileName, compressedFile, { cacheControl: '3600', upsert: true });

          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage.from('product_images').getPublicUrl(fileName);

          const { error: dbError } = await supabase
              .from('master_products')
              .update({ image_url: publicUrl })
              .eq('product_id', productId);

          if (dbError) throw dbError;

          fetchCatalog(); 
      } catch (error: any) {
          alert("Upload Error: " + error.message);
      }
      setUploadingId(null);
      e.target.value = ''; 
  };

  const filteredProducts = products.filter(p => {
      const matchSearch = p.product_name.toLowerCase().includes(searchTerm.toLowerCase()) || p.product_id.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCat = categoryFilter === 'ALL' || p.category === categoryFilter;
      return matchSearch && matchCat;
  });

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const currentItems = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
      <div className="p-4 md:p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
          
          {/* HEADER & FILTERS */}
          <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4 shrink-0">
              <div>
                  <h1 className="text-xl md:text-2xl font-black text-slate-800 flex items-center gap-2">
                      <div className="p-2 bg-amber-100 text-amber-600 rounded-xl shadow-inner"><ImageIcon size={24}/></div>
                      Visual Catalog
                  </h1>
                  <p className="text-slate-500 text-xs md:text-sm mt-1">ระบบแคตตาล็อกรูปภาพ พร้อมระบบแบ่งหน้าเพื่อให้โหลดไวขึ้น</p>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-3">
                  <select 
                      className="p-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 bg-white text-sm font-bold text-slate-700"
                      value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                  >
                      <option value="ALL">ทุกหมวดหมู่ (All Categories)</option>
                      {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div className="relative">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                      <input 
                          type="text" placeholder="ค้นหาชื่อ หรือ รหัสสินค้า..." 
                          className="pl-9 pr-4 py-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 w-full sm:w-64 text-sm shadow-inner"
                          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                      />
                  </div>
              </div>
          </div>

          {/* GRID GALLERY */}
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 pb-2">
              {loading ? (
                  <div className="flex flex-col items-center justify-center h-64 text-amber-500">
                      <Activity className="animate-spin mb-4" size={40}/>
                      <span className="font-bold tracking-widest">Loading Catalog...</span>
                  </div>
              ) : filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                      <Layers size={48} className="opacity-20 mb-4"/>
                      <span className="font-bold">ไม่พบสินค้าตามที่ค้นหา</span>
                  </div>
              ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">
                      {currentItems.map((item) => (
                          <div key={item.product_id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow group flex flex-col">
                              
                              <div className="aspect-square bg-slate-100 relative flex items-center justify-center group/img overflow-hidden">
                                  {item.image_url ? (
                                      <>
                                          <img 
                                              src={item.image_url} 
                                              alt={item.product_name} 
                                              loading="lazy" 
                                              decoding="async" // 🟢 3. เทคนิคนี้ช่วยให้เบราว์เซอร์ถอดรหัสรูปในแบคกราวด์ หน้าจอจะไม่ค้าง!
                                              className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-500"
                                          />
                                          <button 
                                              onClick={() => setZoomedImage(item.image_url)}
                                              className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center text-white"
                                          >
                                              <ZoomIn size={32}/>
                                          </button>
                                      </>
                                  ) : (
                                      <div className="text-slate-300 flex flex-col items-center">
                                          <ImageIcon size={40} className="mb-2 opacity-50"/>
                                          <span className="text-xs font-bold uppercase">No Image</span>
                                      </div>
                                  )}

                                  {userRole !== 'VIEWER' && (
                                      <label className={`absolute top-2 right-2 p-2 rounded-lg cursor-pointer shadow-lg transition-colors ${item.image_url ? 'bg-white/80 text-slate-700 hover:bg-white' : 'bg-amber-500 text-white hover:bg-amber-600'} ${uploadingId === item.product_id ? 'animate-pulse' : ''}`} title="อัปโหลด/เปลี่ยนรูปภาพ">
                                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, item.product_id)} disabled={uploadingId === item.product_id}/>
                                          {uploadingId === item.product_id ? <Activity size={16} className="animate-spin"/> : <Camera size={16}/>}
                                      </label>
                                  )}
                              </div>

                              <div className="p-3 md:p-4 flex-1 flex flex-col border-t border-slate-100">
                                  <div className="font-mono text-[10px] text-amber-600 font-bold mb-1">{item.product_id}</div>
                                  <div className="font-bold text-slate-800 text-sm mb-2 line-clamp-2 flex-1" title={item.product_name}>{item.product_name}</div>
                                  
                                  <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-50">
                                      <div className="flex flex-col">
                                          <span className="text-[10px] text-slate-400 uppercase font-bold">In Stock</span>
                                          <span className={`font-black text-base ${item.current_qty > 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                              {item.current_qty} <span className="text-[10px] text-slate-400 font-normal">{item.base_uom}</span>
                                          </span>
                                      </div>
                                      <div className="flex flex-col items-end">
                                          <span className="text-[10px] text-slate-400 uppercase font-bold">Location</span>
                                          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded truncate max-w-[80px]" title={item.locations}>
                                              {item.locations}
                                          </span>
                                      </div>
                                  </div>
                              </div>
                          </div>
                      ))}
                  </div>
              )}
          </div>

          {/* PAGINATION CONTROLS */}
          {filteredProducts.length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0">
                  <div className="text-xs text-slate-500 font-medium">
                      แสดง {((currentPage - 1) * itemsPerPage) + 1} ถึง {Math.min(currentPage * itemsPerPage, filteredProducts.length)} จากทั้งหมด <span className="font-bold text-slate-700">{filteredProducts.length}</span> รายการ
                  </div>
                  <div className="flex items-center gap-2">
                      <button 
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))} 
                          disabled={currentPage === 1} 
                          className="p-2 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                          <ChevronLeft size={16} className="text-slate-600"/>
                      </button>
                      <div className="text-sm font-bold text-slate-700 px-4 py-2 bg-slate-100 rounded-lg">
                          หน้า {currentPage} / {totalPages || 1}
                      </div>
                      <button 
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} 
                          disabled={currentPage === totalPages || totalPages === 0} 
                          className="p-2 bg-white border border-slate-300 rounded-lg shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
                      >
                          <ChevronRight size={16} className="text-slate-600"/>
                      </button>
                  </div>
              </div>
          )}

          {/* ZOOM MODAL */}
          {zoomedImage && (
              <div className="fixed inset-0 bg-slate-950/90 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setZoomedImage(null)}>
                  <button className="absolute top-4 right-4 text-white hover:text-rose-400 transition-colors bg-black/50 p-2 rounded-full"><X size={32}/></button>
                  <img src={zoomedImage} alt="Zoomed" className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}/>
              </div>
          )}
      </div>
  );
}