"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import imageCompression from 'browser-image-compression';
import { 
    Edit2, Trash2, Plus, Save, X, Upload, Package, Users, Home, Search, 
    Download, ChevronLeft, ChevronRight, DollarSign, Database, MapPin, Tag, Activity,
    FileSpreadsheet, Info, Layers, AlertTriangle, Camera, Image as ImageIcon
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function UnifiedMasterDataPage() {
  const [activeTab, setActiveTab] = useState<'master_products' | 'master_vendors' | 'master_branches'>('master_products');
  const [data, setData] = useState<any[]>([]);
  const [vendorsList, setVendorsList] = useState<any[]>([]); 
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<any>(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [formVendorId, setFormVendorId] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => {
      const fetchVendors = async () => {
          const { data } = await supabase.from('master_vendors').select('vendor_id, vendor_name');
          if (data) setVendorsList(data);
      };
      fetchVendors();
  }, []);

  useEffect(() => {
    fetchData();
    setSearchTerm('');
    setCurrentPage(1);
  }, [activeTab]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: items, error } = await supabase.from(activeTab).select('*');
      if (error) throw error;
      
      const pk = activeTab === 'master_products' ? 'product_id' : activeTab === 'master_vendors' ? 'vendor_id' : 'branch_id';
      const sortedItems = (items || []).sort((a,b) => String(a[pk] || '').localeCompare(String(b[pk] || '')));
      setData(sortedItems);
    } catch (error: any) { 
        console.error("Error fetching data:", error); 
        alert("Load Error: " + error.message);
    }
    setLoading(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, productId: string) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploadingId(productId);
      try {
          const currentProduct = data.find(p => p.product_id === productId);
          if (currentProduct?.image_url) {
              try {
                  const urlParts = currentProduct.image_url.split('/');
                  const oldFileName = urlParts[urlParts.length - 1]?.split('?')[0];
                  if (oldFileName) await supabase.storage.from('product_images').remove([oldFileName]);
              } catch (err) { console.warn("ไม่สามารถลบรูปเก่าได้", err); }
          }

          const options = { maxSizeMB: 0.1, maxWidthOrHeight: 800, useWebWorker: true, fileType: 'image/webp' };
          const compressedFile = await imageCompression(file, options);
          const fileName = `${productId}-${Date.now()}.webp`;

          const { error: uploadError } = await supabase.storage.from('product_images').upload(fileName, compressedFile, { cacheControl: '3600', upsert: true });
          if (uploadError) throw uploadError;

          const { data: { publicUrl } } = supabase.storage.from('product_images').getPublicUrl(fileName);
          const { error: dbError } = await supabase.from('master_products').update({ image_url: publicUrl }).eq('product_id', productId);
          if (dbError) throw dbError;

          fetchData();
      } catch (error: any) {
          alert("อัปโหลดรูปภาพล้มเหลว: " + error.message);
      }
      setUploadingId(null);
      e.target.value = ''; 
  };

  const handleDownloadTemplate = () => {
      let templateData = {};
      if (activeTab === 'master_products') {
          templateData = {
              product_id: 'P-001', product_name: 'ตัวอย่าง สินค้า ก.', category: 'SM', 
              default_location: 'MAIN_WH', shelf_position: 'A11', planning_room: 'Room A',
              base_uom: 'Piece', purchase_uom: 'Box', conversion_rate: 10, standard_cost: 150.50, 
              min_stock: 50, lead_time: 3, moq: 1, vendor_id: 'V-001', status: 'ACTIVE'
          };
      } else if (activeTab === 'master_vendors') {
          templateData = { vendor_id: 'V-001', vendor_name: 'บริษัท ตัวอย่าง จำกัด' };
      } else if (activeTab === 'master_branches') {
          templateData = { branch_id: 'BR-001', branch_name: '0001 EM-Emporium', is_active: 'TRUE' };
      }
      const ws = XLSX.utils.json_to_sheet([templateData]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Template");
      XLSX.writeFile(wb, `${activeTab}_Template.xlsx`);
  };

  const handleFileUpload = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e: any) => {
        if (!window.confirm(`ยืนยันการนำเข้าข้อมูล Excel สู่ตาราง ${activeTab}?`)) return;
        setLoading(true);
        try {
            const buffer = new Uint8Array(e.target.result);
            const workbook = XLSX.read(buffer, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
            
            const pk = activeTab === 'master_products' ? 'product_id' : activeTab === 'master_vendors' ? 'vendor_id' : 'branch_id';
            const cleanRows = rows.map(row => {
                const cleanRow = { ...row };
                if (activeTab === 'master_branches') {
                    const fullName = cleanRow.branch_id || cleanRow.branch_name || row['ชื่อสาขา'] || row['Branch Name'] || row['Branch ID'];
                    if (fullName && !cleanRow.branch_id) cleanRow.branch_id = String(fullName).trim();
                    if (fullName && !cleanRow.branch_name) cleanRow.branch_name = String(fullName).trim();
                    if (cleanRow.is_active === undefined || cleanRow.is_active === "") cleanRow.is_active = true; 
                    delete cleanRow['ชื่อสาขา']; delete cleanRow['Branch Name']; delete cleanRow['Branch ID'];
                }
                if(cleanRow.standard_cost !== undefined && cleanRow.standard_cost !== "") cleanRow.standard_cost = parseFloat(cleanRow.standard_cost);
                if(cleanRow.conversion_rate !== undefined && cleanRow.conversion_rate !== "") cleanRow.conversion_rate = parseFloat(cleanRow.conversion_rate);
                if(cleanRow.min_stock !== undefined && cleanRow.min_stock !== "") cleanRow.min_stock = parseInt(cleanRow.min_stock);
                if(cleanRow.lead_time !== undefined && cleanRow.lead_time !== "") cleanRow.lead_time = parseInt(cleanRow.lead_time);
                if(cleanRow.moq !== undefined && cleanRow.moq !== "") cleanRow.moq = parseFloat(cleanRow.moq);
                
                if(cleanRow.is_active === 'TRUE' || cleanRow.is_active === 'true' || cleanRow.is_active === true) cleanRow.is_active = true;
                if(cleanRow.is_active === 'FALSE' || cleanRow.is_active === 'false' || cleanRow.is_active === false) cleanRow.is_active = false;
                if(cleanRow.shelf_position) cleanRow.shelf_position = String(cleanRow.shelf_position).trim();

                if(activeTab === 'master_products') {
                    if (!cleanRow.vendor_id || String(cleanRow.vendor_id).trim() === '') cleanRow.vendor_id = null;
                }
                delete cleanRow.created_at; delete cleanRow.updated_at; delete cleanRow.id;
                return cleanRow;
            }).filter(row => row[pk]); 

            const uniqueMap = new Map();
            cleanRows.forEach(row => { uniqueMap.set(row[pk], row); });
            const deduplicatedRows = Array.from(uniqueMap.values());

            if (deduplicatedRows.length > 0) {
                const { error } = await supabase.from(activeTab).upsert(deduplicatedRows, { onConflict: pk });
                if (error) throw error;
                alert(`✅ นำเข้าและอัปเดตข้อมูลสำเร็จ ${deduplicatedRows.length} รายการ!`); 
                fetchData();
            } else {
                alert("⚠️ ไม่พบข้อมูลที่สามารถนำเข้าได้ กรุณาตรวจสอบหัวคอลัมน์");
            }
        } catch (error: any) { alert("Import Error: " + error.message); }
        setLoading(false);
    };
    reader.readAsArrayBuffer(file);
    event.target.value = null; 
  };

  const handleExport = () => {
      if (data.length === 0) return alert("ไม่มีข้อมูลให้ Export");
      const exportData = data.map(item => {
          const row = { ...item };
          if (activeTab === 'master_products' && row.vendor_id) {
              row.vendor_name = vendorsList.find(v => v.vendor_id === row.vendor_id)?.vendor_name || '';
          }
          delete row.id; delete row.created_at; delete row.updated_at;
          return row;
      });
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, activeTab);
      XLSX.writeFile(wb, `${activeTab}_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("ยืนยันการลบข้อมูลนี้? (การลบ Master Data อาจส่งผลกระทบต่อประวัติที่อ้างอิงถึงรหัสนี้)")) return;
    const pk = activeTab === 'master_products' ? 'product_id' : activeTab === 'master_vendors' ? 'vendor_id' : 'branch_id';
    setLoading(true);
    try { 
        const { error } = await supabase.from(activeTab).delete().eq(pk, id); 
        
        // 🛡️ ดักจับ Error กรณีข้อมูลถูกนำไปใช้งานแล้ว (Foreign Key Violation)
        if (error) {
            if (error.code === '23503') {
                let msg = `🚨 ไม่สามารถลบ "${id}" ได้!`;
                if (activeTab === 'master_vendors') msg += `\nเนื่องจากคู่ค้านี้มี "ประวัติการสั่งซื้อ (PO)" อยู่ในระบบแล้ว`;
                else if (activeTab === 'master_products') msg += `\nเนื่องจากสินค้านี้มี "ประวัติรับ/จ่าย" หรือ "ยอดสต๊อก" อยู่ในระบบแล้ว`;
                else msg += `\nเนื่องจากข้อมูลนี้ถูกอ้างอิงใช้งานในระบบแล้ว`;
                
                throw new Error(`${msg}\n\n💡 คำแนะนำ: หากไม่ต้องการใช้งานแล้ว ให้กดแก้ไข (Edit) แล้วเติมคำว่า "(ยกเลิก)" ไว้ที่ชื่อแทนการลบครับ เพื่อรักษาประวัติเดิมไว้`);
            }
            throw error;
        }

        setData(data.filter(item => item[pk] !== id)); 
        alert("✅ ลบข้อมูลสำเร็จ");
    } catch (error: any) { 
        alert(error.message); 
    }
    setLoading(false);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const payload: any = Object.fromEntries(formData.entries());
    
    if (payload.standard_cost) payload.standard_cost = parseFloat(payload.standard_cost as string);
    if (payload.conversion_rate) payload.conversion_rate = parseFloat(payload.conversion_rate as string);
    if (payload.min_stock) payload.min_stock = parseInt(payload.min_stock as string);
    if (payload.lead_time) payload.lead_time = parseInt(payload.lead_time as string);
    if (payload.moq) payload.moq = parseFloat(payload.moq as string);
    
    if (activeTab === 'master_branches') {
        payload.is_active = payload.is_active === 'on' ? true : false;
        payload.branch_id = payload.branch_name;
    }

    if (activeTab === 'master_products') {
        if (!payload.vendor_id || String(payload.vendor_id).trim() === '') payload.vendor_id = null;
    }

    const pk = activeTab === 'master_products' ? 'product_id' : activeTab === 'master_vendors' ? 'vendor_id' : 'branch_id';
    const newId = (payload[pk] as string)?.trim();

    if (!newId) return alert(`⚠️ ข้อมูลไม่สมบูรณ์ ขาดรหัสหลัก (ID)`);

    if (!currentItem) {
        const isDuplicate = data.some(item => item[pk].toLowerCase() === newId.toLowerCase());
        if (isDuplicate) return alert(`🚨 แจ้งเตือน: รหัส "${newId}" มีอยู่แล้วในระบบ!`);
    } else {
        const oldId = currentItem[pk];
        if (oldId !== newId) {
            const isDuplicate = data.some(item => item[pk].toLowerCase() === newId.toLowerCase());
            if (isDuplicate) return alert(`🚨 แจ้งเตือน: รหัสใหม่ "${newId}" ไปซ้ำกับข้อมูลอื่นที่มีอยู่แล้ว!`);
            if (!window.confirm(`⚠️ คุณกำลังเปลี่ยนรหัสจาก "${oldId}" เป็น "${newId}" ยืนยันหรือไม่?`)) return;
        }
    }

    setSaveLoading(true);
    try {
        if (currentItem && currentItem[pk] !== newId) {
            const { error } = await supabase.from(activeTab).update(payload).eq(pk, currentItem[pk]);
            if (error) throw error;
        } else {
            const { error } = await supabase.from(activeTab).upsert([payload], { onConflict: pk });
            if (error) throw error;
        }

        setIsModalOpen(false); 
        fetchData();
        
        if (activeTab === 'master_vendors') {
             const { data: vData } = await supabase.from('master_vendors').select('vendor_id, vendor_name');
             if (vData) setVendorsList(vData);
        }

        alert("✅ บันทึกข้อมูลสำเร็จเรียบร้อย");
    } catch (error: any) { 
        alert("Save Error: " + error.message); 
    }
    setSaveLoading(false);
  };

  const filteredData = useMemo(() => {
      if (!searchTerm) return data;
      const lower = searchTerm.toLowerCase();
      return data.filter(item => Object.values(item).some(val => String(val).toLowerCase().includes(lower)));
  }, [data, searchTerm]);

  const uniqueCategories = useMemo(() => [...new Set(data.map(i => i.category).filter(Boolean))].sort(), [data]);
  const uniqueLocations = useMemo(() => [...new Set(data.map(i => i.default_location).filter(Boolean))].sort(), [data]);
  const uniquePlanningRooms = useMemo(() => [...new Set(data.map(i => i.planning_room).filter(Boolean))].sort(), [data]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const currentItems = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const openModalForNew = () => {
      setCurrentItem(null);
      setFormVendorId('');
      setIsModalOpen(true);
  }

  const openModalForEdit = (item: any) => {
      setCurrentItem(item);
      setFormVendorId(item.vendor_id || '');
      setIsModalOpen(true);
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 font-sans">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10 flex-shrink-0">
        <div>
            <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-cyan-600 flex items-center gap-2">
                <Database className="text-indigo-500" size={24}/> Master Data & System Tools
            </h1>
            <p className="text-slate-500 text-xs mt-1 font-medium">ศูนย์รวมการตั้งค่าและจัดการฐานข้อมูลหลักของระบบคลังสินค้า</p>
        </div>
        <div className="flex gap-2 text-xs font-bold">
            <span className="flex items-center gap-1 bg-emerald-50 text-emerald-600 border border-emerald-200 px-3 py-1.5 rounded-lg shadow-sm">
                <Activity size={14} className="animate-pulse"/> DB Connected
            </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
          
          <div className="w-72 bg-white border-r border-slate-200 flex flex-col p-5 space-y-8 z-0 overflow-y-auto custom-scrollbar">
              
              <div>
                  <div className="flex items-center gap-2 mb-3 px-1 text-slate-800">
                      <div className="p-1.5 bg-cyan-100 text-cyan-600 rounded-lg"><Package size={16}/></div>
                      <h3 className="font-black text-sm uppercase tracking-wider">หมวดข้อมูลสินค้า</h3>
                  </div>
                  <div className="space-y-2">
                      <button onClick={() => setActiveTab('master_products')}
                          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${activeTab === 'master_products' ? `bg-cyan-50 border border-cyan-200 text-cyan-700 font-bold shadow-sm` : 'hover:bg-slate-50 text-slate-600 font-medium'}`}
                      >
                          <Database size={16} className={activeTab === 'master_products' ? 'text-cyan-500' : 'text-slate-400'}/>
                          ฐานข้อมูลสินค้า (Products)
                      </button>
                  </div>
              </div>

              <div>
                  <div className="flex items-center gap-2 mb-3 px-1 text-slate-800 border-t border-slate-100 pt-6">
                      <div className="p-1.5 bg-fuchsia-100 text-fuchsia-600 rounded-lg"><Users size={16}/></div>
                      <h3 className="font-black text-sm uppercase tracking-wider">หมวดองค์กรและคู่ค้า</h3>
                  </div>
                  <div className="space-y-2">
                      <button onClick={() => setActiveTab('master_vendors')}
                          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${activeTab === 'master_vendors' ? `bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-700 font-bold shadow-sm` : 'hover:bg-slate-50 text-slate-600 font-medium'}`}
                      >
                          <Users size={16} className={activeTab === 'master_vendors' ? 'text-fuchsia-500' : 'text-slate-400'}/>
                          รายชื่อคู่ค้า (Vendors)
                      </button>
                      <button onClick={() => setActiveTab('master_branches')}
                          className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${activeTab === 'master_branches' ? `bg-emerald-50 border border-emerald-200 text-emerald-700 font-bold shadow-sm` : 'hover:bg-slate-50 text-slate-600 font-medium'}`}
                      >
                          <Home size={16} className={activeTab === 'master_branches' ? 'text-emerald-500' : 'text-slate-400'}/>
                          รายชื่อสาขา (Branches)
                      </button>
                  </div>
              </div>
          </div>

          <div className="flex-1 p-6 flex flex-col overflow-hidden bg-slate-50/50">
              
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden relative">
                  
                  <div className="p-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-4 bg-white">
                      <div className="relative w-full max-w-sm">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                          <input type="text" placeholder={`ค้นหาใน ${activeTab === 'master_products' ? 'Products' : activeTab === 'master_vendors' ? 'Vendors' : 'Branches'}...`} 
                              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl text-sm bg-slate-50 focus:bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                      </div>
                      
                      <div className="flex gap-2 flex-wrap">
                          <button onClick={handleDownloadTemplate} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl font-bold hover:bg-emerald-100 text-sm shadow-sm transition-colors">
                              <FileSpreadsheet size={16}/> โหลดแบบฟอร์ม
                          </button>
                          
                          <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-xl text-slate-600 font-bold hover:bg-slate-100 text-sm shadow-sm transition-colors">
                              <Download size={16}/> ส่งออก Excel
                          </button>
                          <label className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl font-bold hover:bg-black text-sm cursor-pointer shadow-md transition-all">
                              <Upload size={16}/> นำเข้า Excel
                              <input type="file" accept=".xlsx, .csv" className="hidden" onChange={handleFileUpload}/>
                          </label>
                          <button onClick={openModalForNew} className={`flex items-center gap-2 px-4 py-2 text-white rounded-xl font-bold text-sm shadow-md transition-all hover:brightness-110 ${activeTab==='master_products' ? 'bg-cyan-600 shadow-cyan-200' : activeTab==='master_vendors' ? 'bg-fuchsia-600 shadow-fuchsia-200' : 'bg-emerald-600 shadow-emerald-200'}`}>
                              <Plus size={16}/> สร้างรายการใหม่
                          </button>
                      </div>
                  </div>

                  <div className="flex-1 overflow-auto bg-slate-50 custom-scrollbar relative">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                          <thead className="bg-white text-slate-500 font-bold uppercase text-[10px] tracking-wider sticky top-0 z-10 shadow-sm border-b border-slate-200">
                              <tr>
                                  <th className="p-4 w-10 text-center">#</th>
                                  {activeTab === 'master_products' && (
                                      <>
                                          <th className="p-4 w-16 text-center">รูปภาพ</th>
                                          <th className="p-4">SKU / รหัสสินค้า</th>
                                          <th className="p-4">ชื่อสินค้า</th>
                                          <th className="p-4">ผู้ขาย (Vendor)</th>
                                          <th className="p-4">ห้อง/ชั้นวาง</th>
                                          <th className="p-4">หน่วย</th>
                                          <th className="p-4 text-right">ต้นทุน</th>
                                          <th className="p-4 text-center">สถานะ</th>
                                      </>
                                  )}
                                  {activeTab === 'master_vendors' && (
                                      <><th className="p-4">รหัสผู้ขาย (Vendor ID)</th><th className="p-4">ชื่อบริษัท (Vendor Name)</th></>
                                  )}
                                  {activeTab === 'master_branches' && (
                                      <><th className="p-4">รหัสสาขาและชื่อ (Branch ID)</th><th className="p-4 text-center">สถานะใช้งาน</th></>
                                  )}
                                  <th className="p-4 text-center w-28 bg-white sticky right-0 shadow-[-5px_0_10px_-5px_rgba(0,0,0,0.05)] border-l border-slate-100">จัดการ</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                              {loading ? <tr><td colSpan={10} className="p-12 text-center text-slate-400"><Activity className="animate-spin mx-auto mb-2 text-indigo-500"/> กำลังโหลดข้อมูล...</td></tr> : 
                               currentItems.length === 0 ? <tr><td colSpan={10} className="p-12 text-center text-slate-400"><Database className="mx-auto mb-2 opacity-20" size={32}/> ไม่พบข้อมูลในระบบ</td></tr> :
                               currentItems.map((item, idx) => {
                                  // 🚨 บังคับใช้ Index สร้าง Key เพื่อไม่ให้เกิด Error คีย์ซ้ำ
                                  const uniqueKey = `row-${currentPage}-${idx}`;

                                  return (
                                  <tr key={uniqueKey} className="hover:bg-indigo-50/30 transition-colors group">
                                      <td className="p-4 text-center text-xs text-slate-400 font-mono">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                                      
                                      {activeTab === 'master_products' && (
                                          <>
                                              <td className="p-2 text-center">
                                                  <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center relative overflow-hidden group/img mx-auto">
                                                      {item.image_url ? (
                                                          <img src={item.image_url} alt="img" className="w-full h-full object-cover"/>
                                                      ) : <ImageIcon size={16} className="text-slate-300"/>}
                                                      <label className={`absolute inset-0 bg-black/40 text-white flex items-center justify-center opacity-0 group-hover/img:opacity-100 cursor-pointer transition-opacity ${uploadingId === item.product_id ? 'opacity-100 bg-black/60' : ''}`} title="เปลี่ยนรูปภาพ">
                                                          <input type="file" accept="image/*" className="hidden" onChange={(e) => handleImageUpload(e, item.product_id)} disabled={uploadingId === item.product_id}/>
                                                          {uploadingId === item.product_id ? <Activity size={14} className="animate-spin"/> : <Camera size={14}/>}
                                                      </label>
                                                  </div>
                                              </td>
                                              <td className="p-4 font-mono font-bold text-cyan-700 text-xs">{item.product_id}</td>
                                              <td className="p-4 font-bold text-slate-800 truncate max-w-[200px]" title={item.product_name}>{item.product_name}</td>
                                              <td className="p-4">
                                                  {item.vendor_id ? (
                                                      <div className="flex flex-col">
                                                          <span className="font-bold text-fuchsia-700 text-[10px] bg-fuchsia-50 px-1.5 py-0.5 rounded w-max border border-fuchsia-100 mb-0.5">{item.vendor_id}</span>
                                                          <span className="text-[10px] text-slate-500 truncate max-w-[120px]" title={vendorsList.find(v => v.vendor_id === item.vendor_id)?.vendor_name}>{vendorsList.find(v => v.vendor_id === item.vendor_id)?.vendor_name || 'ไม่พบชื่อบริษัท'}</span>
                                                      </div>
                                                  ) : <span className="text-slate-300 text-xs">-</span>}
                                              </td>
                                              <td className="p-4">
                                                  <div className="flex flex-col gap-1">
                                                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded uppercase w-max bg-amber-50 text-amber-700 border border-amber-200"><MapPin size={8} className="inline mr-1"/>{item.default_location || '-'}</span>
                                                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase w-max bg-slate-100 text-slate-500 border border-slate-200"><Layers size={8} className="inline mr-1"/>{item.shelf_position || '-'}</span>
                                                  </div>
                                              </td>
                                              <td className="p-4 text-xs font-bold text-slate-500">{item.base_uom}</td>
                                              <td className="p-4 text-right font-bold text-emerald-600">฿ {item.standard_cost?.toLocaleString(undefined, {maximumFractionDigits: 2})}</td>
                                              <td className="p-4 text-center">
                                                  <span className={`text-[9px] font-bold px-2 py-1 rounded-md ${item.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{item.status}</span>
                                              </td>
                                          </>
                                      )}

                                      {activeTab === 'master_vendors' && (
                                          <>
                                              <td className="p-4 font-mono font-bold text-fuchsia-700">{item.vendor_id}</td>
                                              <td className="p-4 font-bold text-slate-800">{item.vendor_name}</td>
                                          </>
                                      )}

                                      {activeTab === 'master_branches' && (
                                          <>
                                              <td className="p-4 font-bold text-emerald-700">{item.branch_id}</td>
                                              <td className="p-4 text-center">
                                                  <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${item.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{item.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span>
                                              </td>
                                          </>
                                      )}

                                      <td className="p-4 text-center bg-white group-hover:bg-indigo-50/50 sticky right-0 shadow-[-5px_0_10px_-5px_rgba(0,0,0,0.05)] border-l border-slate-100">
                                          <div className="flex items-center justify-center gap-2">
                                              <button onClick={() => openModalForEdit(item)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-100 rounded-lg transition-colors" title="แก้ไข"><Edit2 size={16}/></button>
                                              <button onClick={() => handleDelete(item[activeTab === 'master_products' ? 'product_id' : activeTab === 'master_vendors' ? 'vendor_id' : 'branch_id'])} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-100 rounded-lg transition-colors" title="ลบ"><Trash2 size={16}/></button>
                                          </div>
                                      </td>
                                  </tr>
                              )})}
                          </tbody>
                      </table>
                  </div>
                  
                  <div className="p-3 border-t border-slate-200 bg-white flex justify-between items-center text-xs text-slate-500">
                      <div>แสดง <b>{currentItems.length}</b> จากทั้งหมด <b>{filteredData.length}</b> รายการ</div>
                      <div className="flex items-center gap-2">
                          <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage===1} className="p-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-50"><ChevronLeft size={16}/></button>
                          <span className="font-bold text-slate-700 px-3 py-1 bg-slate-100 rounded-lg">หน้า {currentPage} / {totalPages || 1}</span>
                          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage===totalPages || totalPages===0} className="p-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-50"><ChevronRight size={16}/></button>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200 my-auto">
            <div className="p-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center relative overflow-hidden">
                <div className={`absolute -right-10 -top-10 w-32 h-32 rounded-full opacity-20 ${activeTab==='master_products' ? 'bg-cyan-500' : activeTab==='master_vendors' ? 'bg-fuchsia-500' : 'bg-emerald-500'}`}></div>
                <h3 className="font-black text-xl text-slate-800 flex items-center gap-2 relative z-10">
                    {currentItem ? <Edit2 size={20} className={activeTab==='master_products' ? 'text-cyan-600' : activeTab==='master_vendors' ? 'text-fuchsia-600' : 'text-emerald-600'}/> : <Plus size={20} className={activeTab==='master_products' ? 'text-cyan-600' : activeTab==='master_vendors' ? 'text-fuchsia-600' : 'text-emerald-600'}/>} 
                    {currentItem ? 'แก้ไขข้อมูล (Edit Record)' : 'เพิ่มข้อมูลใหม่ (New Record)'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 bg-white rounded-full hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition-colors relative z-10 shadow-sm"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto custom-scrollbar">
                {activeTab === 'master_products' && (
                    <>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                                    SKU / ID * {currentItem && <span title="สามารถแก้รหัสได้ แต่โปรดระวังผลกระทบ"><AlertTriangle size={12} className="text-amber-500"/></span>}
                                </label>
                                <input 
                                    name="product_id" 
                                    defaultValue={currentItem?.product_id} 
                                    required 
                                    className={`w-full p-2.5 border rounded-xl text-sm font-mono focus:ring-2 outline-none shadow-inner ${currentItem ? 'border-amber-300 bg-amber-50 focus:ring-amber-500 text-amber-900 font-bold' : 'border-slate-300 bg-white focus:ring-cyan-500'}`} 
                                    placeholder="P-001"
                                />
                            </div>
                            <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Product Name *</label><input name="product_name" defaultValue={currentItem?.product_name} required className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500 outline-none shadow-inner" placeholder="ชื่อสินค้า"/></div>
                        </div>
                        
                        <div className="grid grid-cols-4 gap-4">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Tag size={12}/> Category</label>
                                <input list="category-options" name="category" defaultValue={currentItem?.category} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500 outline-none shadow-inner" placeholder="SM"/>
                                <datalist id="category-options">{uniqueCategories.map(c => <option key={c as string} value={c as string} />)}</datalist>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><MapPin size={12}/> Room</label>
                                <input list="location-options" name="default_location" defaultValue={currentItem?.default_location} className="w-full p-2.5 border border-amber-300 bg-amber-50 text-amber-800 rounded-xl font-bold uppercase text-sm focus:ring-2 focus:ring-amber-500 outline-none shadow-inner" placeholder="MAIN_WH"/>
                                <datalist id="location-options">{uniqueLocations.map(l => <option key={l as string} value={l as string} />)}</datalist>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Layers size={12}/> Shelf</label>
                                <input name="shelf_position" defaultValue={currentItem?.shelf_position} className="w-full p-2.5 border border-amber-300 bg-amber-50 text-amber-800 rounded-xl font-bold uppercase text-sm focus:ring-2 focus:ring-amber-500 outline-none shadow-inner" placeholder="A11"/>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">Planning Room</label>
                                <input list="planning-options" name="planning_room" defaultValue={currentItem?.planning_room} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500 outline-none shadow-inner" placeholder="GHC"/>
                                <datalist id="planning-options">{uniquePlanningRooms.map(p => <option key={p as string} value={p as string} />)}</datalist>
                            </div>
                        </div>

                        <div className="bg-cyan-50/50 p-4 rounded-xl border border-cyan-100">
                            <h4 className="text-xs font-bold text-cyan-700 mb-3 flex items-center gap-2"><DollarSign size={14}/> Base Unit & Standard Cost</h4>
                            <div className="grid grid-cols-3 gap-4">
                                <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Base UOM</label><input name="base_uom" defaultValue={currentItem?.base_uom || 'Piece'} required className="w-full p-2.5 border border-cyan-200 rounded-lg text-sm text-center bg-white shadow-inner" placeholder="ชิ้น"/></div>
                                <div className="col-span-2"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Cost (per Base Unit)</label><input name="standard_cost" type="number" step="0.01" defaultValue={currentItem?.standard_cost} className="w-full p-2.5 border border-cyan-200 rounded-lg text-sm font-bold text-emerald-600 bg-white shadow-inner" placeholder="0.00"/></div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                             <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Buy UOM</label><input name="purchase_uom" defaultValue={currentItem?.purchase_uom} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm shadow-inner" placeholder="ลัง"/></div>
                             <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Conv. Rate</label><input name="conversion_rate" type="number" step="0.01" defaultValue={currentItem?.conversion_rate || 1} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm shadow-inner" placeholder="1"/></div>
                             <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Min Stock</label><input name="min_stock" type="number" defaultValue={currentItem?.min_stock || 10} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm shadow-inner" placeholder="10"/></div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                             <div className="flex gap-4">
                                 <div className="w-1/2"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Lead Time (Days)</label><input name="lead_time" type="number" defaultValue={currentItem?.lead_time || 3} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm shadow-inner" placeholder="3"/></div>
                                 <div className="w-1/2"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">MOQ (Buy Unit)</label><input name="moq" type="number" step="0.01" defaultValue={currentItem?.moq || 1} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm shadow-inner" placeholder="1"/></div>
                             </div>
                             
                             <div className="bg-fuchsia-50/50 p-3 rounded-xl border border-fuchsia-100">
                                 <label className="text-[10px] font-bold text-fuchsia-700 uppercase mb-1 flex items-center gap-1"><Users size={12}/> Vendor ID (คู่ค้า)</label>
                                 <input 
                                    list="vendor-options" name="vendor_id" 
                                    value={formVendorId} 
                                    onChange={(e) => setFormVendorId(e.target.value)}
                                    className="w-full p-2.5 border border-fuchsia-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-fuchsia-500 outline-none bg-white shadow-inner" 
                                    placeholder="เลือกรหัสผู้ขาย..."
                                 />
                                 <datalist id="vendor-options">
                                     {vendorsList.map(v => <option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}
                                 </datalist>
                                 <div className="mt-1.5 text-[10px] font-bold text-slate-500 truncate" title={vendorsList.find(v => v.vendor_id === formVendorId)?.vendor_name}>
                                     {formVendorId ? (vendorsList.find(v => v.vendor_id === formVendorId)?.vendor_name || <span className="text-rose-500">❌ ไม่พบรหัสผู้ขายนี้ในระบบ</span>) : 'เว้นว่าง (ไม่มีผู้ขาย)'}
                                 </div>
                             </div>
                        </div>
                        
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Status</label>
                            <select name="status" defaultValue={currentItem?.status || 'ACTIVE'} className="w-full p-3 border border-slate-300 rounded-xl text-sm font-bold focus:ring-2 focus:ring-cyan-500 outline-none bg-white shadow-inner">
                                <option value="ACTIVE">🟢 ACTIVE (เปิดใช้งาน)</option>
                                <option value="INACTIVE">🔴 INACTIVE (ปิดใช้งาน/ซ่อน)</option>
                            </select>
                        </div>
                    </>
                )}

                {activeTab === 'master_vendors' && (
                    <div className="space-y-5">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 flex items-center gap-1">
                                Vendor Code (ID) * {currentItem && <span title="สามารถแก้รหัสได้ แต่โปรดระวังผลกระทบ"><AlertTriangle size={12} className="text-amber-500"/></span>}
                            </label>
                            <input 
                                name="vendor_id" 
                                defaultValue={currentItem?.vendor_id} 
                                required 
                                className={`w-full p-3 border rounded-xl font-mono focus:ring-2 outline-none shadow-inner ${currentItem ? 'border-amber-300 bg-amber-50 focus:ring-amber-500 text-amber-900 font-bold' : 'border-slate-300 bg-white focus:ring-fuchsia-500'}`} 
                                placeholder="V-001"
                            />
                        </div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Vendor Name *</label><input name="vendor_name" defaultValue={currentItem?.vendor_name} required className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-fuchsia-500 outline-none shadow-inner" placeholder="บริษัทจำกัด..."/></div>
                    </div>
                )}

                {activeTab === 'master_branches' && (
                    <div className="space-y-5">
                        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl text-sm text-blue-700 mb-2 leading-relaxed">
                            💡 <b>ข้อแนะนำ:</b> ระบุรหัสและชื่อสาขาในช่องเดียวกันแบบ <b>"รหัส - ชื่อเต็ม"</b><br/>เช่น <span className="font-mono bg-white px-1 border rounded">0001 EM-Emporium</span> ระบบจะนำไปใช้เป็น ID อัตโนมัติ
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Branch ID & Name *</label>
                            <input 
                                name="branch_name" 
                                defaultValue={currentItem?.branch_name} 
                                required 
                                className="w-full p-3 border border-slate-300 rounded-xl font-bold focus:ring-2 focus:ring-emerald-500 outline-none shadow-inner" 
                                placeholder="เช่น 0001 EM-Emporium"
                            />
                        </div>
                        <div className="flex items-center gap-3 mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl">
                            <input type="checkbox" name="is_active" id="is_active" defaultChecked={currentItem ? currentItem.is_active : true} className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"/>
                            <label htmlFor="is_active" className="text-sm font-bold text-slate-700 cursor-pointer">เปิดใช้งานสาขานี้ (Active)</label>
                        </div>
                    </div>
                )}

                <div className="pt-6 border-t border-slate-100 flex gap-4 sticky bottom-0 bg-white pb-2">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">ยกเลิก (Cancel)</button>
                    <button type="submit" disabled={saveLoading} className={`flex-1 py-3.5 rounded-xl text-white font-bold flex justify-center items-center gap-2 shadow-lg transition-all ${activeTab==='master_products' ? 'bg-cyan-600 hover:bg-cyan-700 shadow-cyan-200' : activeTab==='master_vendors' ? 'bg-fuchsia-600 hover:bg-fuchsia-700 shadow-fuchsia-200' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'} disabled:opacity-50`}>
                        {saveLoading ? 'กำลังบันทึก...' : <><Save size={18}/> บันทึกข้อมูล (Save)</>}
                    </button>
                </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}