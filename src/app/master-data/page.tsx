"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Database, Package, Users, Search, UploadCloud, CheckCircle, 
    AlertCircle, Edit2, Box, Store, RefreshCw, X, Save, 
    ChevronLeft, ChevronRight, ShieldCheck, Filter, ArrowUpDown, Info, Clock
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function MasterDataPage() {
  const [activeTab, setActiveTab] = useState<'PRODUCTS' | 'VENDORS'>('PRODUCTS');
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  
  const [products, setProducts] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Edit Modal & Vendor Search States
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [vendorSearchInModal, setVendorSearchInModal] = useState('');
  const [showVendorList, setShowVendorList] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const vendorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      fetchMasterData();
      
      const handleClickOutside = (event: MouseEvent) => {
          if (vendorRef.current && !vendorRef.current.contains(event.target as Node)) {
              setShowVendorList(false);
          }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchMasterData = async () => {
      setLoading(true);
      setSyncProgress('กำลังดึงข้อมูลหลัก...');
      try {
          // ทะลวงขีดจำกัด 3,000 แถว
          let allP: any[] = []; let hasMoreP = true; let offsetP = 0;
          while(hasMoreP) {
              const { data, error } = await supabase.from('master_products').select('*').range(offsetP, offsetP + 1000 - 1);
              if (error || !data || data.length < 1000) hasMoreP = false;
              if (data) allP = [...allP, ...data];
              offsetP += 1000;
          }
          
          let allV: any[] = []; let hasMoreV = true; let offsetV = 0;
          while(hasMoreV) {
              const { data, error } = await supabase.from('master_vendors').select('*').range(offsetV, offsetV + 1000 - 1);
              if (error || !data || data.length < 1000) hasMoreV = false;
              if (data) allV = [...allV, ...data];
              offsetV += 1000;
          }

          setProducts(allP);
          setVendors(allV);
      } catch (error) { console.error(error); }
      setLoading(false);
      setSyncProgress('');
  };

  // 🟢 1. ระบบอัปโหลด Excel (Smart Parsing Engine)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setLoading(true);
      setSyncProgress('กำลังอ่านไฟล์ Excel ต้นฉบับ...');
      
      const reader = new FileReader();
      reader.onload = async (evt: any) => {
          try {
              const data = new Uint8Array(evt.target.result);
              const workbook = XLSX.read(data, { type: 'array' });
              const sheet = workbook.Sheets[workbook.SheetNames[0]];
              const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });

              if (rows.length === 0) throw new Error("ไฟล์ว่างเปล่า");

              setSyncProgress('กำลังวิเคราะห์โครงสร้างข้อมูล (Extracting AI)...');

              const vendorMap = new Map<string, any>();
              const productMap = new Map<string, any>();

              rows.forEach(row => {
                  const vId = String(row['Vendor ID'] || '').trim();
                  const vName = String(row['Vender Name'] || '').trim();
                  const isValidVendor = vId !== '' && vId !== '-';
                  
                  if (isValidVendor && !vendorMap.has(vId)) {
                      vendorMap.set(vId, { vendor_id: vId, vendor_name: vName || `Vendor ${vId}` });
                  }

                  const pId = String(row['item_code'] || '').trim();
                  if (pId) {
                      const existingProduct = products.find(p => p.product_id === pId);
                      
                      // จัดการ MOQ
                      const rawMoq = String(row['ขั้นต่ำการสั่งซื้อ (MOQ)'] || '').trim();
                      const parsedMoq = (rawMoq.toLowerCase() === 'not_found' || isNaN(Number(rawMoq))) ? (existingProduct?.moq || 0) : Number(rawMoq);

                      // จัดการชื่อสินค้า
                      const newName = String(row['item_Name'] || row['item_name'] || '').trim();

                      // จัดการสถานะ
                      const rawActive = String(row['Active'] || '').trim().toUpperCase();
                      let finalStatus = existingProduct?.status || 'ACTIVE'; 
                      if (rawActive === 'Y') finalStatus = 'ACTIVE';
                      else if (rawActive === 'N') finalStatus = 'INACTIVE';

                      // 🟢 จัดการราคา (Price)
                      const rawPrice = row['Price'];
                      const parsedPrice = !isNaN(Number(rawPrice)) && rawPrice !== '' ? Number(rawPrice) : (existingProduct?.standard_cost || 0);

                      // 🟢 วิเคราะห์สกัดระยะเวลารอของ (Lead Time) จากข้อความ
                      const condition = String(row['เงื่อนไขในการจัดส่งสินค้า '] || row['เงื่อนไขในการจัดส่งสินค้า'] || '');
                      const leadTimeMatch = condition.match(/(\d+)\s*วัน/);
                      const parsedLeadTime = leadTimeMatch ? Number(leadTimeMatch[1]) : (existingProduct?.lead_time || 3);

                      if (existingProduct) {
                          // อัปเดตข้อมูลให้ฉลาดขึ้น
                          productMap.set(pId, {
                              ...existingProduct, 
                              product_name: newName || existingProduct.product_name,
                              status: finalStatus,
                              vendor_id: isValidVendor ? vId : existingProduct.vendor_id,
                              moq: parsedMoq,
                              standard_cost: parsedPrice,
                              lead_time: parsedLeadTime
                          });
                      } else {
                          // สร้างสินค้าใหม่
                          productMap.set(pId, {
                              product_id: pId,
                              product_name: newName || pId, 
                              category: String(row['Type'] || 'Unknown').trim(),
                              base_uom: 'Unit',
                              purchase_uom: 'Unit',
                              conversion_rate: 1,
                              standard_cost: parsedPrice,
                              status: finalStatus, 
                              vendor_id: isValidVendor ? vId : null,
                              moq: parsedMoq,
                              min_stock: 0,
                              lead_time: parsedLeadTime
                          });
                      }
                  }
              });

              setSyncProgress(`กำลังอัปเดต ข้อมูลคู่ค้าจำนวน ${vendorMap.size} ราย...`);
              const vendorsToUpsert = Array.from(vendorMap.values());
              if (vendorsToUpsert.length > 0) {
                  const { error: vError } = await supabase.from('master_vendors').upsert(vendorsToUpsert, { onConflict: 'vendor_id' });
                  if (vError) throw new Error("Vendor Update Error: " + vError.message);
              }

              setSyncProgress(`กำลังอัปเดต สินค้าจำนวน ${productMap.size} รายการ...`);
              const productsToUpsert = Array.from(productMap.values());
              if (productsToUpsert.length > 0) {
                  const { error: pError } = await supabase.from('master_products').upsert(productsToUpsert, { onConflict: 'product_id' });
                  if (pError) throw new Error("Product Update Error: " + pError.message);
              }

              alert(`✅ อัปเดตข้อมูลสำเร็จ!\n\n- เพิ่ม/อัปเดตคู่ค้า: ${vendorsToUpsert.length} ราย\n- ปรับปรุงข้อมูลสินค้า: ${productsToUpsert.length} รายการ\n\n(✨ ระบบได้สกัดข้อมูล Lead Time และ ราคา ให้อัตโนมัติแล้ว)`);
              fetchMasterData();

          } catch (error: any) {
              alert("❌ เกิดข้อผิดพลาด: " + error.message);
          }
          setLoading(false);
          setSyncProgress('');
      };
      reader.readAsArrayBuffer(file);
      e.target.value = ''; 
  };

  // 🟢 2. ระบบค้นหา Vendor ใน Modal
  const filteredVendorsInModal = useMemo(() => {
      if (!vendorSearchInModal) return vendors;
      const lower = vendorSearchInModal.toLowerCase();
      return vendors.filter(v => 
          v.vendor_name.toLowerCase().includes(lower) || 
          v.vendor_id.toLowerCase().includes(lower)
      ).slice(0, 10);
  }, [vendors, vendorSearchInModal]);

  const handleUpdateProduct = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const updatedData = {
          product_name: String(formData.get('product_name')).trim(),
          category: String(formData.get('category')).trim(),
          vendor_id: editingProduct.vendor_id, 
          purchase_uom: String(formData.get('purchase_uom')).trim(),
          base_uom: String(formData.get('base_uom')).trim(),
          conversion_rate: Number(formData.get('conversion_rate')),
          standard_cost: Number(formData.get('standard_cost')),
          moq: Number(formData.get('moq')),
          min_stock: Number(formData.get('min_stock')),
          lead_time: Number(formData.get('lead_time')),
          status: String(formData.get('status')),
      };

      setIsSaving(true);
      try {
          const { error } = await supabase.from('master_products').update(updatedData).eq('product_id', editingProduct.product_id);
          if (error) throw error;
          setProducts(products.map(p => p.product_id === editingProduct.product_id ? { ...p, ...updatedData } : p));
          alert("✅ อัปเดตข้อมูลสินค้าสำเร็จ");
          setEditingProduct(null);
      } catch (err: any) { alert(err.message); }
      setIsSaving(false);
  };

  const filteredData = useMemo(() => {
      const lowerSearch = searchTerm.toLowerCase();
      if (activeTab === 'PRODUCTS') {
          return products.filter(p => 
              p.product_id.toLowerCase().includes(lowerSearch) || 
              p.product_name.toLowerCase().includes(lowerSearch)
          );
      } else {
          return vendors.filter(v => 
              v.vendor_id.toLowerCase().includes(lowerSearch) || 
              v.vendor_name.toLowerCase().includes(lowerSearch)
          );
      }
  }, [products, vendors, searchTerm, activeTab]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const currentItems = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      {/* 🟢 Analytics Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 shrink-0">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><Package size={24}/></div>
              <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Products</div>
                  <div className="text-2xl font-black text-slate-800">{products.length}</div>
              </div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl"><CheckCircle size={24}/></div>
              <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Items</div>
                  <div className="text-2xl font-black text-emerald-600">{products.filter(p => p.status === 'ACTIVE').length}</div>
              </div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl"><Users size={24}/></div>
              <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">Vendors</div>
                  <div className="text-2xl font-black text-blue-600">{vendors.length}</div>
              </div>
          </div>
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-xl"><ShieldCheck size={24}/></div>
              <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">System Mode</div>
                  <div className="text-lg font-black text-amber-600">Advanced DB</div>
              </div>
          </div>
      </div>

      <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4 shrink-0">
          <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm w-full md:w-auto">
              <button onClick={() => {setActiveTab('PRODUCTS'); setCurrentPage(1);}} className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'PRODUCTS' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <Package size={16}/> สินค้า ({products.length})
              </button>
              <button onClick={() => {setActiveTab('VENDORS'); setCurrentPage(1);}} className={`px-6 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all ${activeTab === 'VENDORS' ? 'bg-slate-800 text-white shadow-md' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <Store size={16}/> คู่ค้า ({vendors.length})
              </button>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-80">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                  <input type="text" placeholder={`ค้นหา${activeTab === 'PRODUCTS' ? 'สินค้า' : 'คู่ค้า'}...`} className="w-full pl-10 p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
              </div>
              <button onClick={fetchMasterData} disabled={loading} className="p-2.5 bg-white border border-slate-300 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors shadow-sm">
                  <RefreshCw size={18} className={loading ? "animate-spin" : ""}/>
              </button>
              <label className="flex items-center justify-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700 cursor-pointer transition-all active:scale-95 group">
                  <UploadCloud size={18} className="group-hover:-translate-y-1 transition-transform"/>
                  {loading ? 'Processing...' : 'Upload Master File'}
                  <input type="file" accept=".xlsx, .csv" className="hidden" onChange={handleFileUpload} disabled={loading}/>
              </label>
          </div>
      </div>

      {/* 🟢 Main Table with New Layout */}
      <div className="flex-1 bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 overflow-auto custom-scrollbar">
              <table className="w-full text-left text-sm border-separate border-spacing-0">
                  <thead className="bg-slate-50 text-slate-500 font-bold text-xs uppercase sticky top-0 z-10">
                      <tr>
                          <th className="p-4 pl-6 border-b border-slate-100 w-16">Action</th>
                          <th className="p-4 border-b border-slate-100 w-24">Status</th>
                          <th className="p-4 border-b border-slate-100">{activeTab === 'PRODUCTS' ? 'รหัส / ชื่อสินค้า' : 'รหัส / ชื่อคู่ค้า'}</th>
                          {activeTab === 'PRODUCTS' && (
                              <>
                                  <th className="p-4 border-b border-slate-100 text-center w-36">หน่วยสั่ง/จ่าย (UOM)</th>
                                  <th className="p-4 border-b border-slate-100 text-right w-28">ต้นทุน (Cost)</th>
                                  <th className="p-4 border-b border-slate-100 text-center w-28">LT / MOQ</th>
                                  <th className="p-4 border-b border-slate-100 w-48">ผูกคู่ค้า (Vendor)</th>
                              </>
                          )}
                          {activeTab === 'VENDORS' && <th className="p-4 border-b border-slate-100 text-center">จำนวนสินค้าที่ผูก</th>}
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                      {currentItems.length === 0 ? (
                          <tr><td colSpan={7} className="p-16 text-center text-slate-400 font-bold"><Database size={48} className="mx-auto mb-4 opacity-20"/>ไม่พบข้อมูลที่ค้นหา</td></tr>
                      ) : currentItems.map(item => (
                          <tr key={activeTab === 'PRODUCTS' ? item.product_id : item.vendor_id} className="hover:bg-slate-50/80 transition-colors group">
                              <td className="p-4 pl-6">
                                  {activeTab === 'PRODUCTS' ? (
                                      <button onClick={() => {setEditingProduct(item); setVendorSearchInModal('');}} className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all shadow-sm">
                                          <Edit2 size={14}/>
                                      </button>
                                  ) : <Info size={16} className="text-slate-300"/>}
                              </td>
                              <td className="p-4">
                                  <span className={`px-2 py-1 rounded-md text-[10px] font-black border ${item.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                                      {item.status || 'ACTIVE'}
                                  </span>
                              </td>
                              <td className="p-4">
                                  <div className="font-bold text-slate-800">{activeTab === 'PRODUCTS' ? item.product_id : item.vendor_id}</div>
                                  <div className="text-xs text-slate-400 line-clamp-1 truncate max-w-[280px]">{activeTab === 'PRODUCTS' ? item.product_name : item.vendor_name}</div>
                              </td>
                              {activeTab === 'PRODUCTS' && (
                                  <>
                                      <td className="p-4 text-center">
                                          <div className="flex flex-col items-center">
                                              <span className="font-black text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded text-[10px]">{item.purchase_uom}</span>
                                              <div className="text-[9px] text-slate-400 mt-0.5 font-bold">1 = {item.conversion_rate} {item.base_uom}</div>
                                          </div>
                                      </td>
                                      <td className="p-4 text-right font-mono font-bold text-slate-600">
                                          ฿{Number(item.standard_cost).toLocaleString(undefined, {minimumFractionDigits: 2})}
                                      </td>
                                      <td className="p-4 text-center">
                                          <div className="text-xs font-bold text-slate-700 flex justify-center items-center gap-1"><Clock size={12} className="text-amber-500"/> {item.lead_time || 0} วัน</div>
                                          <div className="text-[9px] font-bold text-slate-400 mt-0.5 bg-slate-100 px-1 rounded inline-block">MOQ: {item.moq || 0}</div>
                                      </td>
                                      <td className="p-4">
                                          <div className="text-xs font-bold text-slate-600 truncate max-w-[150px]">{vendors.find(v => v.vendor_id === item.vendor_id)?.vendor_name || '-'}</div>
                                          <div className="text-[9px] font-mono text-slate-300">{item.vendor_id}</div>
                                      </td>
                                  </>
                              )}
                              {activeTab === 'VENDORS' && (
                                  <td className="p-4 text-center">
                                      <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full font-bold text-xs border border-blue-100">
                                          {products.filter(p => p.vendor_id === item.vendor_id).length} Items
                                      </span>
                                  </td>
                              )}
                          </tr>
                      ))}
                  </tbody>
              </table>
          </div>

          <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center shrink-0">
              <div className="text-xs font-bold text-slate-400">Showing {currentItems.length} of {filteredData.length} entries</div>
              {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                      <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"><ChevronLeft size={16}/></button>
                      <span className="text-xs font-black text-slate-700 px-2">Page {currentPage} of {totalPages}</span>
                      <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 bg-white border border-slate-300 rounded-lg hover:bg-slate-100 disabled:opacity-30 transition-colors"><ChevronRight size={16}/></button>
                  </div>
              )}
          </div>
      </div>

      {/* 🟢 Edit Modal (Searchable Vendor) */}
      {editingProduct && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
                  <div className="p-6 border-b border-slate-100 bg-indigo-50 flex justify-between items-center shrink-0">
                      <div>
                          <h3 className="font-black text-indigo-900 text-xl flex items-center gap-3"><Edit2 size={24} className="text-indigo-600"/> Edit Master Information</h3>
                          <p className="text-xs font-bold text-indigo-400 uppercase tracking-widest mt-1">Product SKU: {editingProduct.product_id}</p>
                      </div>
                      <button onClick={() => setEditingProduct(null)} className="p-2 hover:bg-rose-500 hover:text-white text-slate-400 rounded-full transition-all"><X size={24}/></button>
                  </div>

                  <form onSubmit={handleUpdateProduct} className="flex-1 overflow-y-auto p-8 bg-white custom-scrollbar">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                          
                          {/* Left Column: Basic Info */}
                          <div className="space-y-6">
                              <div>
                                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Product Name (Display)</label>
                                  <input type="text" name="product_name" defaultValue={editingProduct.product_name} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 outline-none focus:ring-2 focus:ring-indigo-500" required />
                              </div>
                              <div className="grid grid-cols-2 gap-4">
                                  <div>
                                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Category</label>
                                      <input type="text" name="category" defaultValue={editingProduct.category} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 outline-none" required />
                                  </div>
                                  <div>
                                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Status</label>
                                      <select name="status" defaultValue={editingProduct.status} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-slate-800 outline-none">
                                          <option value="ACTIVE">🟢 ACTIVE</option>
                                          <option value="INACTIVE">🔴 INACTIVE</option>
                                      </select>
                                  </div>
                              </div>

                              <div className="pt-4 border-t border-slate-100">
                                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">Linked Vendor (Searchable)</label>
                                  <div className="relative" ref={vendorRef}>
                                      <div className="relative">
                                          <Store className="absolute left-3 top-3.5 text-indigo-400" size={18}/>
                                          <input 
                                              type="text" 
                                              placeholder="Type to search vendor..."
                                              className="w-full pl-10 p-3.5 bg-blue-50/50 border border-blue-100 rounded-2xl font-black text-indigo-900 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                                              value={vendorSearchInModal || vendors.find(v => v.vendor_id === editingProduct.vendor_id)?.vendor_name || ''}
                                              onChange={e => {setVendorSearchInModal(e.target.value); setShowVendorList(true);}}
                                              onFocus={() => setShowVendorList(true)}
                                          />
                                          {editingProduct.vendor_id && (
                                              <div className="absolute right-3 top-3 text-[10px] font-mono bg-indigo-600 text-white px-2 py-1 rounded-lg shadow-sm">
                                                  ID: {editingProduct.vendor_id}
                                              </div>
                                          )}
                                      </div>

                                      {showVendorList && (
                                          <div className="absolute z-50 w-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl max-h-56 overflow-y-auto animate-fade-in-up">
                                              {filteredVendorsInModal.map(v => (
                                                  <div 
                                                      key={v.vendor_id} 
                                                      onClick={() => {
                                                          setEditingProduct({...editingProduct, vendor_id: v.vendor_id});
                                                          setVendorSearchInModal(v.vendor_name);
                                                          setShowVendorList(false);
                                                      }}
                                                      className="p-4 hover:bg-indigo-50 cursor-pointer flex justify-between items-center border-b border-slate-50 last:border-0 transition-colors"
                                                  >
                                                      <div className="font-bold text-slate-700 text-sm">{v.vendor_name}</div>
                                                      <div className="text-[10px] font-mono text-slate-400">{v.vendor_id}</div>
                                                  </div>
                                              ))}
                                              {filteredVendorsInModal.length === 0 && <div className="p-4 text-center text-xs text-slate-400 font-bold">ไม่พบข้อมูลคู่ค้า</div>}
                                          </div>
                                      )}
                                  </div>
                              </div>
                          </div>

                          {/* Right Column: Logistics & Cost */}
                          <div className="space-y-6">
                              <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-100 space-y-4 shadow-inner">
                                  <h4 className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2"><Box size={16}/> UOM & Conversion</h4>
                                  <div className="grid grid-cols-3 gap-3 items-end">
                                      <div>
                                          <label className="text-[9px] font-bold text-indigo-500 mb-1 block">Buy Unit</label>
                                          <input type="text" name="purchase_uom" defaultValue={editingProduct.purchase_uom} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-center font-bold text-sm" required />
                                      </div>
                                      <div className="text-center pb-2 font-black text-slate-300">=</div>
                                      <div>
                                          <label className="text-[9px] font-bold text-indigo-500 mb-1 block">Conv. Rate</label>
                                          <input type="number" step="0.01" name="conversion_rate" defaultValue={editingProduct.conversion_rate} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-center font-black text-indigo-600" required />
                                      </div>
                                  </div>
                                  <div>
                                      <label className="text-[9px] font-bold text-emerald-500 mb-1 block text-center uppercase">Base Unit (Internal)</label>
                                      <input type="text" name="base_uom" defaultValue={editingProduct.base_uom} className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-center font-bold text-sm text-emerald-600" required />
                                  </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                  <div className="bg-orange-50/50 p-5 rounded-[2rem] border border-orange-100">
                                      <label className="text-[10px] font-black text-orange-400 uppercase tracking-widest block mb-2">Cost / Base Unit</label>
                                      <div className="relative">
                                          <span className="absolute left-3 top-3 font-bold text-orange-400">฿</span>
                                          <input type="number" step="0.01" name="standard_cost" defaultValue={editingProduct.standard_cost} className="w-full pl-7 p-3 bg-white border border-orange-200 rounded-2xl font-black text-orange-700 outline-none" required />
                                      </div>
                                  </div>
                                  <div className="bg-indigo-50/50 p-5 rounded-[2rem] border border-indigo-100">
                                      <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest block mb-2">MOQ (Buy Unit)</label>
                                      <input type="number" step="0.1" name="moq" defaultValue={editingProduct.moq} className="w-full p-3 bg-white border border-indigo-200 rounded-2xl font-black text-indigo-700 outline-none" required />
                                  </div>
                              </div>

                              <div className="grid grid-cols-2 gap-4">
                                  <div>
                                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Safety Stock</label>
                                      <input type="number" name="min_stock" defaultValue={editingProduct.min_stock} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:border-indigo-400" required />
                                  </div>
                                  <div>
                                      <label className="text-[10px] font-black text-slate-400 uppercase block mb-1">Lead Time (Days)</label>
                                      <input type="number" name="lead_time" defaultValue={editingProduct.lead_time} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold outline-none focus:border-indigo-400" required />
                                  </div>
                              </div>
                          </div>
                      </div>

                      <div className="mt-10 flex gap-4 shrink-0">
                          <button type="button" onClick={() => setEditingProduct(null)} className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black hover:bg-slate-200 transition-all">Cancel</button>
                          <button type="submit" disabled={isSaving} className="flex-[2] py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-xl shadow-indigo-200 hover:bg-indigo-700 flex items-center justify-center gap-3 transition-all active:scale-95 disabled:opacity-50">
                              {isSaving ? <RefreshCw size={20} className="animate-spin"/> : <Save size={20}/>} 
                              {isSaving ? 'UPDATING...' : 'SAVE CHANGES'}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

    </div>
  );
}