"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { Database, Package, Users, Search, UploadCloud, CheckCircle, AlertCircle, Edit2, Box, Store, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function MasterDataPage() {
  const [activeTab, setActiveTab] = useState<'PRODUCTS' | 'VENDORS'>('PRODUCTS');
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState('');
  
  const [products, setProducts] = useState<any[]>([]);
  const [vendors, setVendors] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
      fetchMasterData();
  }, []);

  const fetchMasterData = async () => {
      setLoading(true);
      try {
          const [pRes, vRes] = await Promise.all([
              supabase.from('master_products').select('*').order('product_id', { ascending: true }),
              supabase.from('master_vendors').select('*').order('vendor_id', { ascending: true })
          ]);
          setProducts(pRes.data || []);
          setVendors(vRes.data || []);
      } catch (error) {
          console.error("Fetch Error:", error);
      }
      setLoading(false);
  };

  // 🚀 ระบบอัปโหลดและอัปเดตข้อมูล (Smart Bulk Import)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setLoading(true);
      setSyncProgress('กำลังอ่านไฟล์ Excel...');
      
      const reader = new FileReader();
      reader.onload = async (evt: any) => {
          try {
              const data = new Uint8Array(evt.target.result);
              const workbook = XLSX.read(data, { type: 'array' });
              const sheet = workbook.Sheets[workbook.SheetNames[0]];
              
              // อ่านข้อมูลและแปลงเป็น JSON
              const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });

              if (rows.length === 0) throw new Error("ไฟล์ว่างเปล่า");

              setSyncProgress('กำลังแยกข้อมูล คู่ค้า (Vendors) และ สินค้า (Products)...');

              const vendorMap = new Map<string, any>();
              const productMap = new Map<string, any>();

              // 1. วนลูปสกัดข้อมูลจาก Excel
              rows.forEach(row => {
                  const vId = String(row['Vendor ID'] || '').trim();
                  const vName = String(row['Vender Name'] || '').trim();
                  
                  // 🟢 แก้ไขบั๊ก Foreign Key: เช็คให้ชัวร์ว่า vId มีตัวอักษรจริงๆ ไม่ใช่แค่ช่องว่าง
                  const isValidVendor = vId !== '' && vId !== '-';
                  
                  // เก็บข้อมูล Vendor (เฉพาะแถวที่มีรหัส Vendor เท่านั้น)
                  if (isValidVendor && !vendorMap.has(vId)) {
                      vendorMap.set(vId, { vendor_id: vId, vendor_name: vName || `Vendor ${vId}` });
                  }

                  const pId = String(row['item_code'] || '').trim();
                  if (pId) {
                      const existingProduct = products.find(p => p.product_id === pId);
                      
                      const rawMoq = row['ขั้นต่ำการสั่งซื้อ (MOQ)'];
                      const parsedMoq = isNaN(Number(rawMoq)) ? 0 : Number(rawMoq);

                      productMap.set(pId, {
                          product_id: pId,
                          product_name: existingProduct?.product_name || pId, 
                          category: String(row['Type'] || existingProduct?.category || 'Unknown').trim(),
                          base_uom: String(row['Unit'] || existingProduct?.base_uom || 'Unit').trim().toLowerCase(),
                          purchase_uom: String(row['Unit'] || existingProduct?.purchase_uom || 'Unit').trim().toLowerCase(),
                          standard_cost: Number(row['Price']) || existingProduct?.standard_cost || 0,
                          status: String(row['Active']) === 'Y' ? 'ACTIVE' : 'INACTIVE',
                          vendor_id: isValidVendor ? vId : null, // 🟢 ถ้าไม่มี Vendor ให้ส่ง null จะไม่ติด Error
                          moq: parsedMoq
                      });
                  }
              });

              setSyncProgress(`กำลังอัปเดต คู่ค้าจำนวน ${vendorMap.size} ราย...`);
              
              // 2. บันทึกข้อมูล Vendor ลง Database (ต้องบันทึก Vendor ก่อน Product เสมอ)
              const vendorsToUpsert = Array.from(vendorMap.values());
              if (vendorsToUpsert.length > 0) {
                  const { error: vError } = await supabase.from('master_vendors').upsert(vendorsToUpsert, { onConflict: 'vendor_id' });
                  if (vError) throw new Error("Vendor Update Error: " + vError.message);
              }

              setSyncProgress(`กำลังอัปเดต สินค้าจำนวน ${productMap.size} รายการ...`);

              // 3. บันทึกข้อมูล Product ลง Database
              const productsToUpsert = Array.from(productMap.values());
              if (productsToUpsert.length > 0) {
                  const { error: pError } = await supabase.from('master_products').upsert(productsToUpsert, { onConflict: 'product_id' });
                  if (pError) throw new Error("Product Update Error: " + pError.message);
              }

              alert(`✅ อัปเดตฐานข้อมูลสำเร็จ!\n- เพิ่ม/อัปเดตคู่ค้า: ${vendorsToUpsert.length} ราย\n- เพิ่ม/อัปเดตสินค้า: ${productsToUpsert.length} รายการ`);
              fetchMasterData();

          } catch (error: any) {
              alert("❌ เกิดข้อผิดพลาด: " + error.message);
          }
          setLoading(false);
          setSyncProgress('');
      };
      reader.readAsArrayBuffer(file);
      e.target.value = ''; // เคลียร์ช่อง input
  };

  const filteredProducts = useMemo(() => {
      const lowerSearch = searchTerm.toLowerCase();
      return products.filter(p => 
          (p.product_id || '').toLowerCase().includes(lowerSearch) ||
          (p.product_name || '').toLowerCase().includes(lowerSearch) ||
          (p.vendor_id || '').toLowerCase().includes(lowerSearch)
      );
  }, [products, searchTerm]);

  const filteredVendors = useMemo(() => {
      const lowerSearch = searchTerm.toLowerCase();
      return vendors.filter(v => 
          (v.vendor_id || '').toLowerCase().includes(lowerSearch) ||
          (v.vendor_name || '').toLowerCase().includes(lowerSearch)
      );
  }, [vendors, searchTerm]);

  return (
    <div className="p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      {/* HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 shrink-0">
          <div>
              <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                  <Database className="text-indigo-600"/> Master Data Management
              </h1>
              <p className="text-slate-500 text-sm mt-1">จัดการฐานข้อมูล สินค้าหลัก (Products) และ ข้อมูลคู่ค้า (Vendors)</p>
          </div>
          
          <div className="flex items-center gap-3 w-full md:w-auto">
              <button onClick={fetchMasterData} disabled={loading} className="p-2.5 bg-white border border-slate-300 text-slate-600 rounded-xl shadow-sm hover:bg-slate-50 transition-colors disabled:opacity-50">
                  <RefreshCw size={18} className={loading ? "animate-spin text-indigo-500" : ""} />
              </button>
              
              <label className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700 cursor-pointer transition-all active:scale-95 group">
                  <UploadCloud size={18} className="group-hover:-translate-y-1 transition-transform"/>
                  {loading ? 'กำลังประมวลผล...' : 'Import Master Data (Excel)'}
                  <input type="file" accept=".xlsx, .csv" className="hidden" onChange={handleFileUpload} disabled={loading}/>
              </label>
          </div>
      </div>

      {syncProgress && (
          <div className="mb-4 bg-indigo-50 border border-indigo-200 text-indigo-700 px-4 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 animate-pulse shrink-0">
              <AlertCircle size={16}/> {syncProgress}
          </div>
      )}

      {/* TABS & SEARCH */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4 shrink-0">
          <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm w-full sm:w-auto">
              <button 
                  onClick={() => setActiveTab('PRODUCTS')} 
                  className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'PRODUCTS' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                  <Package size={16}/> สินค้า ({products.length})
              </button>
              <button 
                  onClick={() => setActiveTab('VENDORS')} 
                  className={`flex-1 sm:flex-none px-6 py-2 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all ${activeTab === 'VENDORS' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-500 hover:bg-slate-50'}`}
              >
                  <Users size={16}/> คู่ค้า ({vendors.length})
              </button>
          </div>

          <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
              <input 
                  type="text" 
                  placeholder={`ค้นหา${activeTab === 'PRODUCTS' ? 'สินค้า' : 'คู่ค้า'}...`}
                  className="w-full pl-9 p-2.5 bg-white border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
              />
          </div>
      </div>

      {/* DATA TABLES */}
      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col min-h-0">
          <div className="flex-1 overflow-auto custom-scrollbar">
              {activeTab === 'PRODUCTS' ? (
                  <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-slate-600 font-bold text-xs uppercase sticky top-0 border-b border-slate-200 z-10">
                          <tr>
                              <th className="p-3 pl-6 w-32">Status</th>
                              <th className="p-3 min-w-[250px]">รหัส / ชื่อสินค้า</th>
                              <th className="p-3">หมวดหมู่</th>
                              <th className="p-3 text-center">หน่วยนับ</th>
                              <th className="p-3 text-right">ราคาทุน</th>
                              <th className="p-3 text-center">MOQ</th>
                              <th className="p-3 text-center">ผูกคู่ค้า (Vendor)</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {filteredProducts.length === 0 ? (
                              <tr><td colSpan={7} className="p-12 text-center text-slate-400"><Box size={48} className="mx-auto mb-3 opacity-20"/>ไม่มีข้อมูลสินค้า</td></tr>
                          ) : filteredProducts.map(p => {
                              const vendorName = vendors.find(v => v.vendor_id === p.vendor_id)?.vendor_name || '-';
                              return (
                                  <tr key={p.product_id} className="hover:bg-slate-50 transition-colors group">
                                      <td className="p-3 pl-6">
                                          <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${p.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                              {p.status}
                                          </span>
                                      </td>
                                      <td className="p-3">
                                          <div className="font-bold text-slate-800 text-sm">{p.product_id}</div>
                                          <div className="text-xs text-slate-500 mt-0.5 truncate max-w-[300px]" title={p.product_name}>{p.product_name}</div>
                                      </td>
                                      <td className="p-3">
                                          <span className="text-[10px] uppercase font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded border border-indigo-100">{p.category}</span>
                                      </td>
                                      <td className="p-3 text-center">
                                          <div className="font-bold text-slate-700">{p.base_uom}</div>
                                      </td>
                                      <td className="p-3 text-right font-mono text-slate-600">
                                          {Number(p.standard_cost).toLocaleString(undefined, {minimumFractionDigits: 2})} ฿
                                      </td>
                                      <td className="p-3 text-center font-bold text-amber-600">
                                          {p.moq > 0 ? p.moq : '-'}
                                      </td>
                                      <td className="p-3 text-center">
                                          {p.vendor_id ? (
                                              <div className="inline-flex flex-col items-center">
                                                  <div className="text-xs font-bold text-slate-700 truncate max-w-[150px]" title={vendorName}>{vendorName}</div>
                                                  <div className="text-[9px] text-slate-400 font-mono mt-0.5">{p.vendor_id}</div>
                                              </div>
                                          ) : (
                                              <span className="text-xs text-slate-300">-</span>
                                          )}
                                      </td>
                                  </tr>
                              );
                          })}
                      </tbody>
                  </table>
              ) : (
                  <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-slate-600 font-bold text-xs uppercase sticky top-0 border-b border-slate-200 z-10">
                          <tr>
                              <th className="p-4 pl-6 w-48">Vendor ID</th>
                              <th className="p-4 min-w-[300px]">ชื่อคู่ค้า (Vendor Name)</th>
                              <th className="p-4 text-center">จำนวนสินค้าที่ผูกไว้</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {filteredVendors.length === 0 ? (
                              <tr><td colSpan={3} className="p-12 text-center text-slate-400"><Store size={48} className="mx-auto mb-3 opacity-20"/>ไม่มีข้อมูลคู่ค้า</td></tr>
                          ) : filteredVendors.map(v => {
                              // นับว่า Vendor เจ้านี้ส่งสินค้าให้เรากี่ตัว
                              const linkedProductsCount = products.filter(p => p.vendor_id === v.vendor_id).length;
                              
                              return (
                                  <tr key={v.vendor_id} className="hover:bg-slate-50 transition-colors">
                                      <td className="p-4 pl-6 font-mono font-bold text-indigo-600">{v.vendor_id}</td>
                                      <td className="p-4 font-bold text-slate-800">{v.vendor_name}</td>
                                      <td className="p-4 text-center">
                                          {linkedProductsCount > 0 ? (
                                              <span className="bg-blue-50 text-blue-700 font-bold px-3 py-1 rounded-lg border border-blue-200">
                                                  {linkedProductsCount} รายการ
                                              </span>
                                          ) : (
                                              <span className="text-slate-300 text-xs">ยังไม่มีสินค้า</span>
                                          )}
                                      </td>
                                  </tr>
                              );
                          })}
                      </tbody>
                  </table>
              )}
          </div>
          
          <div className="p-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-500 font-medium flex justify-between items-center shrink-0">
              <div>แสดงผล: {activeTab === 'PRODUCTS' ? filteredProducts.length : filteredVendors.length} รายการ</div>
              <div className="flex items-center gap-1"><AlertCircle size={12}/> ข้อมูลอ้างอิงจากไฟล์ Excel สินค้า+คู่ค้า</div>
          </div>
      </div>

    </div>
  );
}