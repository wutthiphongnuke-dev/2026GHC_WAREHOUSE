"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import imageCompression from 'browser-image-compression';
import { 
    Search, Image as ImageIcon, Package, MapPin, 
    ZoomIn, X, Activity, Camera, Layers, ChevronLeft, ChevronRight, Tag
} from 'lucide-react';

export default function SmallwareCatalog() {
  const [userRole, setUserRole] = useState<string>('VIEWER');
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL'); 
  
  const [categories, setCategories] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]); 
  
  // Pagination
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

  useEffect(() => { setCurrentPage(1); }, [searchTerm, categoryFilter, locationFilter]);

  const fetchCatalog = async () => {
      setLoading(true);
      try {
          // ดึงข้อมูลหลักจาก Master Products
          const { data: prodData, error: prodErr } = await supabase
              .from('master_products')
              .select('product_id, product_name, category, base_uom, default_location, shelf_position, image_url, status')
              .eq('status', 'ACTIVE');
          
          if (prodErr) throw prodErr;

          // ดึงยอดสต๊อก (ไม่ต้องสนใจ Location ใน Lot แล้ว สนใจแค่จำนวน)
          const { data: lotsData } = await supabase.from('inventory_lots').select('product_id, quantity');
          
          const invMap: Record<string, { qty: number }> = {};
          (lotsData || []).forEach(lot => {
              if (!invMap[lot.product_id]) invMap[lot.product_id] = { qty: 0 };
              invMap[lot.product_id].qty += Number(lot.quantity) || 0;
          });

          const cats = new Set<string>();
          const locs = new Set<string>(); 

          const processed = (prodData || []).map(prod => {
              if (prod.category) cats.add(prod.category);
              
              const stockInfo = invMap[prod.product_id];
              
              // 🚨 อัปเดตใหม่: บังคับใช้ Location และ Shelf จาก Master Products 100% (ไม่ดึงจาก Lot แล้ว)
              const actualLoc = prod.default_location || '-';
              
              if (actualLoc && actualLoc !== '-') locs.add(actualLoc); 

              return {
                  ...prod,
                  current_qty: stockInfo ? stockInfo.qty : 0,
                  actual_location: actualLoc
              };
          });

          // เรียงให้รูปที่มีภาพอยู่บนสุด และตามด้วยตัวอักษร
          processed.sort((a, b) => {
              if (a.image_url && !b.image_url) return -1;
              if (!a.image_url && b.image_url) return 1;
              return (a.product_name || '').localeCompare(b.product_name || '');
          });

          setCategories(Array.from(cats).sort());
          setLocations(Array.from(locs).sort()); 
          setProducts(processed);
      } catch (error: any) {
          console.error(error); alert("Error: " + error.message);
      }
      setLoading(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, productId: string) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadingId(productId);
      try {
          const currentProduct = products.find(prod => prod.product_id === productId);
          if (currentProduct && currentProduct.image_url) {
              try {
                  const urlParts = currentProduct.image_url.split('/');
                  const oldFileName = urlParts[urlParts.length - 1]?.split('?')[0];
                  if (oldFileName) await supabase.storage.from('product_images').remove([oldFileName]);
              } catch (err) { console.warn("ไม่สามารถลบรูปเก่าได้:", err); }
          }

          const options = { maxSizeMB: 0.05, maxWidthOrHeight: 800, useWebWorker: true, fileType: 'image/webp' };
          const compressedFile = await imageCompression(file, options);
          const fileName = `${productId}-${Date.now()}.webp`;

          const { error: uploadError } = await supabase.storage.from('product_images').upload(fileName, compressedFile, { cacheControl: '3600', upsert: true });
          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage.from('product_images').getPublicUrl(fileName);
          const { error: dbError } = await supabase.from('master_products').update({ image_url: publicUrl }).eq('product_id', productId);
          if (dbError) throw dbError;

          fetchCatalog(); 
      } catch (error: any) { alert("Upload Error: " + error.message); }
      setUploadingId(null);
      e.target.value = ''; 
  };

  const filteredProducts = products.filter(product => {
      const nameStr = product.product_name || '';
      const idStr = product.product_id || '';
      const matchSearch = nameStr.toLowerCase().includes(searchTerm.toLowerCase()) || idStr.toLowerCase().includes(searchTerm.toLowerCase());
      const matchCat = categoryFilter === 'ALL' || product.category === categoryFilter;
      const matchLoc = locationFilter === 'ALL' || product.actual_location === locationFilter; 
      return matchSearch && matchCat && matchLoc;
  });

  const totalPages = Math.ceil(filteredProducts.length / itemsPerPage);
  const currentItems = filteredProducts.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
      <div className="p-3 md:p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
          
          {/* HEADER & FILTERS */}
          <div className="flex flex-col md:flex-row justify-between md:items-center mb-4 gap-3 shrink-0">
              <div>
                  <h1 className="text-xl md:text-3xl font-black text-slate-800 flex items-center gap-2">
                      <div className="p-2 md:p-2.5 bg-gradient-to-br from-amber-400 to-orange-500 text-white rounded-xl md:rounded-2xl shadow-lg shadow-orange-200">
                          <ImageIcon size={20} className="md:w-6 md:h-6"/>
                      </div>
                      Warehouse Catalog
                  </h1>
              </div>
              
              <div className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
                  <select 
                      className="px-3 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 bg-white text-xs md:text-sm font-bold text-slate-700 shadow-sm cursor-pointer"
                      value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
                  >
                      <option value="ALL">ทุกโซน (Zones)</option>
                      {categories.map(cat => <option key={cat} value={cat}>GHC: {cat}</option>)}
                  </select>
                  
                  <select 
                      className="px-3 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 bg-white text-xs md:text-sm font-bold text-slate-700 shadow-sm cursor-pointer"
                      value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
                  >
                      <option value="ALL">ทุกห้อง (Locations)</option>
                      {locations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                  </select>

                  <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                      <input 
                          type="text" placeholder="ค้นหารหัส หรือ ชื่อสินค้า..." 
                          className="pl-9 pr-3 py-2 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 w-full text-xs md:text-sm shadow-sm bg-white"
                          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                      />
                  </div>
              </div>
          </div>

          {/* GRID GALLERY */}
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 pb-2">
              {loading ? (
                  <div className="flex flex-col items-center justify-center h-full text-amber-500">
                      <Activity className="animate-spin mb-4" size={40}/>
                      <span className="font-bold tracking-widest uppercase text-xs md:text-sm">Loading...</span>
                  </div>
              ) : filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-slate-400">
                      <Layers size={48} className="opacity-20 mb-4"/>
                      <span className="font-bold text-sm md:text-lg">ไม่พบสินค้า</span>
                  </div>
              ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-5">
                      {currentItems.map((item) => (
                          <div key={item.product_id} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden hover:shadow-md transition-shadow group flex flex-col relative">
                              
                              {/* 🖼️ IMAGE AREA */}
                              <div className="aspect-square bg-slate-100 relative flex items-center justify-center group/img overflow-hidden">
                                  {item.image_url ? (
                                      <>
                                          <img 
                                              src={item.image_url} alt={item.product_name} 
                                              loading="lazy" decoding="async"
                                              className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-500 ease-in-out"
                                          />
                                          <button 
                                              onClick={() => setZoomedImage(item.image_url)}
                                              className="absolute inset-0 bg-slate-900/20 opacity-0 group-hover/img:opacity-100 transition-opacity duration-300 flex items-center justify-center text-white backdrop-blur-sm"
                                          >
                                              <ZoomIn size={32}/>
                                          </button>
                                      </>
                                  ) : (
                                      <div className="text-slate-300 flex flex-col items-center">
                                          <ImageIcon size={32} className="mb-1 opacity-40"/>
                                          <span className="text-[10px] font-bold uppercase tracking-widest">No Image</span>
                                      </div>
                                  )}

                                  {userRole !== 'VIEWER' && (
                                      <label className={`absolute top-2 right-2 p-2 rounded-xl cursor-pointer shadow-md backdrop-blur-md transition-transform active:scale-95 ${item.image_url ? 'bg-white/80 text-slate-600 hover:bg-white' : 'bg-amber-500 text-white hover:bg-amber-600'} ${uploadingId === item.product_id ? 'animate-pulse' : ''}`} title="เพิ่ม/เปลี่ยนรูปภาพ">
                                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, item.product_id)} disabled={uploadingId === item.product_id}/>
                                          {uploadingId === item.product_id ? <Activity size={16} className="animate-spin"/> : <Camera size={16}/>}
                                      </label>
                                  )}
                                  
                                  {/* ป้าย Stock Overlay */}
                                  <div className="absolute bottom-2 left-2">
                                      <span className={`px-2 py-1 rounded-lg text-[10px] md:text-xs font-black shadow-md backdrop-blur-md flex items-center gap-1 ${item.current_qty > 0 ? 'bg-white/90 text-emerald-700' : 'bg-rose-500/90 text-white'}`}>
                                          <Package size={10}/> {item.current_qty.toLocaleString(undefined, {maximumFractionDigits: 2})} <span className="font-normal opacity-80">{item.base_uom}</span>
                                      </span>
                                  </div>
                              </div>

                              {/* 📝 CONTENT AREA */}
                              <div className="p-3 flex-1 flex flex-col bg-white">
                                  <div className="mb-1.5">
                                      <span className="font-mono text-xs md:text-sm font-black text-slate-800 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">
                                          {item.product_id}
                                      </span>
                                  </div>
                                  
                                  <div className="font-bold text-slate-600 text-[11px] md:text-xs mb-3 line-clamp-2 leading-snug" title={item.product_name}>
                                      {item.product_name}
                                  </div>
                                  
                                  {/* Location Widget */}
                                  <div className="mt-auto bg-slate-50/80 rounded-xl p-2 border border-slate-100 space-y-1.5">
                                      <div className="flex items-center justify-between">
                                          <span className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1"><Tag size={10}/> Zone</span>
                                          <span className="font-black text-indigo-700 text-[10px]">{item.category || '-'}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                          <span className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1"><MapPin size={10}/> Room</span>
                                          <span className="font-bold text-blue-700 text-[10px] truncate max-w-[80px]" title={item.actual_location}>{item.actual_location}</span>
                                      </div>
                                      <div className="flex items-center justify-between">
                                          <span className="text-[9px] font-bold text-slate-400 uppercase flex items-center gap-1"><Layers size={10}/> Shelf</span>
                                          <span className="font-black text-amber-700 bg-amber-100 px-1.5 rounded text-[10px]">{item.shelf_position || '-'}</span>
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
              <div className="mt-3 pt-3 border-t border-slate-200 flex justify-between items-center shrink-0">
                  <div className="text-[10px] md:text-xs text-slate-500 font-medium">
                      รวม <span className="font-bold text-slate-800">{filteredProducts.length}</span> รายการ
                  </div>
                  <div className="flex items-center gap-1.5">
                      <button 
                          onClick={() => setCurrentPage(prevPage => Math.max(1, prevPage - 1))} 
                          disabled={currentPage === 1} 
                          className="p-1.5 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 disabled:opacity-40"
                      >
                          <ChevronLeft size={16} className="text-slate-600"/>
                      </button>
                      <div className="text-xs font-black text-slate-700 px-3 py-1.5 bg-slate-100 rounded-lg">
                          {currentPage}/{totalPages || 1}
                      </div>
                      <button 
                          onClick={() => setCurrentPage(prevPage => Math.min(totalPages, prevPage + 1))} 
                          disabled={currentPage === totalPages || totalPages === 0} 
                          className="p-1.5 bg-white border border-slate-200 rounded-lg shadow-sm hover:bg-slate-50 disabled:opacity-40"
                      >
                          <ChevronRight size={16} className="text-slate-600"/>
                      </button>
                  </div>
              </div>
          )}

          {/* ZOOM MODAL */}
          {zoomedImage && (
              <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fade-in" onClick={() => setZoomedImage(null)}>
                  <button className="absolute top-4 right-4 text-slate-300 hover:text-white transition-colors bg-white/10 hover:bg-white/20 p-2 rounded-full backdrop-blur-lg">
                      <X size={24}/>
                  </button>
                  <img src={zoomedImage} alt="Zoomed" className="max-w-full max-h-[90vh] object-contain rounded-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}/>
              </div>
          )}
      </div>
  );
}