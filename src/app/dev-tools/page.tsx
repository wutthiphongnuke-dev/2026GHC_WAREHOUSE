"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Edit2, Trash2, Plus, Save, X, Upload, Package, Users, Home, Search, 
    Download, ChevronLeft, ChevronRight, DollarSign, Database, MapPin, Tag, Terminal, Activity,
    FileSpreadsheet, Info, Layers
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function DevToolsPage() {
  const [activeTab, setActiveTab] = useState('master_products');
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentItem, setCurrentItem] = useState<any>(null);
  const [saveLoading, setSaveLoading] = useState(false);

  // Pagination State
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // --- CONFIG: TABS & COLUMNS ---
  const tabs = [
      { 
          id: 'master_products', label: 'Product Master', icon: Package, color: 'text-cyan-500', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20',
          pk: 'product_id',
          columns: [
              { key: 'product_id', label: 'SKU' },
              { key: 'product_name', label: 'Product Name' },
              { key: 'category', label: 'Category' },
              { key: 'default_location', label: 'Location' },
              { key: 'shelf_position', label: 'Shelf' }, // 🟢 เพิ่มคอลัมน์ Shelf
              { key: 'base_uom', label: 'Base Unit' },
              { key: 'standard_cost', label: 'Cost' },       
              { key: 'status', label: 'Status' }
          ]
      },
      { 
          id: 'master_vendors', label: 'Vendors', icon: Users, color: 'text-fuchsia-500', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/20',
          pk: 'vendor_id',
          columns: [ { key: 'vendor_id', label: 'Vendor Code' }, { key: 'vendor_name', label: 'Vendor Name' } ]
      },
      { 
          id: 'master_branches', label: 'Branches', icon: Home, color: 'text-emerald-500', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20',
          pk: 'branch_id',
          columns: [ { key: 'branch_id', label: 'Branch ID & Name' }, { key: 'is_active', label: 'Active' } ]
      }
  ];

  const currentTabConfig = tabs.find(t => t.id === activeTab);

  // --- INITIAL LOAD ---
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
      
      const pk = currentTabConfig?.pk || 'id';
      const sortedItems = (items || []).sort((a,b) => (a[pk] || '').localeCompare(b[pk] || ''));
      setData(sortedItems);
    } catch (error: any) { 
        console.error("Error fetching data:", error); 
        alert("Load Error: " + error.message);
    }
    setLoading(false);
  };

  // ==========================================
  // 📥 IMPORT / 📤 EXPORT & TEMPLATE
  // ==========================================
  const handleDownloadTemplate = () => {
      let templateData = {};
      
      if (activeTab === 'master_products') {
          templateData = {
              product_id: 'P-001',
              product_name: 'ตัวอย่าง สินค้า ก.',
              category: 'SM', // 🟢 เปลี่ยนตัวอย่างให้ตรงกับบริบท Zone
              default_location: 'MAIN_WH',
              shelf_position: 'A11', // 🟢 เพิ่มตัวอย่าง Shelf ใน Template
              base_uom: 'Piece',
              purchase_uom: 'Box',
              conversion_rate: 10,
              standard_cost: 150.50, // 🟢 ตัวอย่างทศนิยม
              min_stock: 50,
              status: 'ACTIVE'
          };
      } else if (activeTab === 'master_vendors') {
          templateData = { vendor_id: 'V-001', vendor_name: 'บริษัท ตัวอย่าง จำกัด' };
      } else if (activeTab === 'master_branches') {
          templateData = { branch_name: '0001 EM-Emporium', is_active: 'TRUE' };
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
        if (!window.confirm(`ยืนยันการนำเข้าข้อมูล Excel สู่ตาราง ${activeTab}?\n\n💡 ระบบรองรับ Bulk Edit: ถ้ารหัสเดิมมีอยู่แล้ว ระบบจะอัปเดตข้อมูลให้ ถ้ารหัสใหม่จะถูกเพิ่มเข้าไป`)) return;
        setLoading(true);
        try {
            const buffer = new Uint8Array(e.target.result);
            const workbook = XLSX.read(buffer, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
            
            const pk = currentTabConfig?.pk || 'id';
            const cleanRows = rows.map(row => {
                const cleanRow = { ...row };
                
                if (activeTab === 'master_branches') {
                    const fullName = row['ชื่อสาขา'] || row['branch_name'] || row['Branch Name'] || row['branch_id'] || row['Branch ID'];
                    if (fullName) {
                        cleanRow.branch_id = String(fullName).trim();
                        cleanRow.branch_name = String(fullName).trim();
                    }
                    if (cleanRow.is_active === undefined || cleanRow.is_active === "") cleanRow.is_active = true; 
                    delete cleanRow['ชื่อสาขา']; delete cleanRow['Branch Name']; delete cleanRow['Branch ID'];
                }

                // 🟢 รองรับทศนิยมโดยใช้ parseFloat
                if(cleanRow.standard_cost) cleanRow.standard_cost = parseFloat(cleanRow.standard_cost);
                if(cleanRow.conversion_rate) cleanRow.conversion_rate = parseFloat(cleanRow.conversion_rate);
                if(cleanRow.min_stock) cleanRow.min_stock = parseInt(cleanRow.min_stock);
                
                if(cleanRow.is_active === 'TRUE' || cleanRow.is_active === 'true' || cleanRow.is_active === true) cleanRow.is_active = true;
                if(cleanRow.is_active === 'FALSE' || cleanRow.is_active === 'false' || cleanRow.is_active === false) cleanRow.is_active = false;

                // 🟢 แปลงค่าให้เป็น String ป้องกันบั๊กกรณีผู้ใช้พิมพ์เลขเพียวๆ ลงในช่อง Shelf
                if(cleanRow.shelf_position) cleanRow.shelf_position = String(cleanRow.shelf_position).trim();

                return cleanRow;
            }).filter(row => row[pk]); 

            // Deduplication
            const uniqueMap = new Map();
            cleanRows.forEach(row => { uniqueMap.set(row[pk], row); });
            const deduplicatedRows = Array.from(uniqueMap.values());

            if (deduplicatedRows.length > 0) {
                const { error } = await supabase.from(activeTab).upsert(deduplicatedRows, { onConflict: pk });
                if (error) throw error;
                
                const duplicateCount = cleanRows.length - deduplicatedRows.length;
                let alertMsg = `✅ นำเข้าและอัปเดตข้อมูล ${deduplicatedRows.length} รายการสำเร็จ!`;
                if (duplicateCount > 0) alertMsg += `\n(💡 กรองข้อมูลรหัสซ้ำกันออกไป ${duplicateCount} บรรทัด)`;
                
                alert(alertMsg); 
                fetchData();
            } else {
                alert("⚠️ ไม่พบข้อมูลที่สามารถนำเข้าได้ กรุณาตรวจสอบหัวคอลัมน์ให้ตรงกับ Template");
            }
        } catch (error: any) { alert("Import Error: " + error.message); }
        setLoading(false);
    };
    reader.readAsArrayBuffer(file);
    event.target.value = null; 
  };

  const handleExport = () => {
      if (data.length === 0) return alert("ไม่มีข้อมูลให้ Export");
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, activeTab);
      XLSX.writeFile(wb, `${activeTab}_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // ==========================================
  // CRUD ACTIONS
  // ==========================================
  const handleDelete = async (id: string) => {
    if (!window.confirm("ยืนยันการลบข้อมูลนี้? (การลบ Master Data อาจส่งผลกระทบต่อ Transaction ที่อ้างอิงถึง)")) return;
    const pk = currentTabConfig?.pk || 'id';
    setLoading(true);
    try { 
        const { error } = await supabase.from(activeTab).delete().eq(pk, id); 
        if (error) throw error;
        setData(data.filter(item => item[pk] !== id)); 
        alert("✅ ลบข้อมูลสำเร็จ");
    } catch (error: any) { alert("Delete Error: " + error.message); }
    setLoading(false);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaveLoading(true);
    const formData = new FormData(e.currentTarget);
    const payload: any = Object.fromEntries(formData.entries());
    
    if (payload.standard_cost) payload.standard_cost = parseFloat(payload.standard_cost as string);
    if (payload.conversion_rate) payload.conversion_rate = parseFloat(payload.conversion_rate as string);
    if (payload.min_stock) payload.min_stock = parseInt(payload.min_stock as string);
    
    if (activeTab === 'master_branches') {
        payload.is_active = payload.is_active === 'on' ? true : false;
        payload.branch_id = payload.branch_name;
    }

    const pk = currentTabConfig?.pk || 'id';
    const docId = payload[pk] as string;

    if (!docId) { setSaveLoading(false); return alert(`ข้อมูลไม่สมบูรณ์ ขาดรหัสหลัก (ID)`); }

    try {
        const { error } = await supabase.from(activeTab).upsert([payload], { onConflict: pk });
        if (error) throw error;
        setIsModalOpen(false); 
        fetchData();
        alert("✅ บันทึกข้อมูลสำเร็จ");
    } catch (error: any) { alert("Save Error: " + error.message); }
    setSaveLoading(false);
  };

  const filteredData = useMemo(() => {
      if (!searchTerm) return data;
      const lower = searchTerm.toLowerCase();
      return data.filter(item => Object.values(item).some(val => String(val).toLowerCase().includes(lower)));
  }, [data, searchTerm]);

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const currentItems = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="flex flex-col h-full bg-slate-50 font-sans">
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10 flex-shrink-0">
        <div>
            <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-blue-600 flex items-center gap-2">
                <Database className="text-cyan-500" size={24}/> Master Data & Dev Tools
            </h1>
            <p className="text-slate-500 text-xs mt-1">ศูนย์กลางจัดการข้อมูลหลัก (Products, Vendors, Branches)</p>
        </div>
        <div className="flex gap-2 text-xs font-bold">
            <span className="flex items-center gap-1 bg-emerald-50 text-emerald-600 border border-emerald-200 px-3 py-1.5 rounded-lg">
                <Activity size={14}/> DB Connected
            </span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
          <div className="w-64 bg-white border-r border-slate-200 flex flex-col p-4 space-y-2 z-0">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-2">Data Tables</div>
              {tabs.map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                      className={`w-full text-left px-4 py-3 rounded-xl flex items-center gap-3 transition-all ${activeTab === tab.id ? `${tab.bg} ${tab.border} border ${tab.color} font-bold shadow-sm` : 'hover:bg-slate-50 text-slate-600 font-medium'}`}
                  >
                      <tab.icon size={18} className={activeTab === tab.id ? tab.color : 'text-slate-400'}/>
                      {tab.label}
                  </button>
              ))}
          </div>

          <div className="flex-1 p-6 flex flex-col overflow-hidden bg-slate-100">
              
              <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-2xl mb-4 flex items-start gap-3 shadow-sm shrink-0">
                  <Info className="text-blue-500 shrink-0 mt-0.5" size={18}/>
                  <div className="text-sm">
                      <strong className="font-bold">แก้ไขข้อมูล (Bulk Edit):</strong> คุณสามารถกดปุ่ม <span className="font-bold bg-white px-1.5 py-0.5 rounded border border-blue-200 text-xs">Export</span> เพื่อนำข้อมูลทั้งหมดไปแก้ไข (เช่น แก้ Location หรือ UOM) ใน Excel จากนั้นกดปุ่ม <span className="font-bold bg-white px-1.5 py-0.5 rounded border border-blue-200 text-xs">Import</span> นำไฟล์ที่แก้แล้วกลับเข้ามา ระบบจะอัปเดตข้อมูลทับของเดิมให้ทันทีโดยอัตโนมัติ!
                  </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden relative">
                  
                  <div className="p-4 border-b border-slate-100 flex flex-wrap justify-between items-center gap-4 bg-slate-50">
                      <div className="relative w-full max-w-sm">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                          <input type="text" placeholder={`Search in ${currentTabConfig?.label}...`} className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-cyan-500 outline-none shadow-inner"
                              value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                      </div>
                      
                      <div className="flex gap-2 flex-wrap">
                          <button onClick={handleDownloadTemplate} className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl font-bold hover:bg-emerald-100 text-sm shadow-sm transition-colors">
                              <FileSpreadsheet size={16}/> Template
                          </button>
                          
                          <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 rounded-xl text-slate-600 font-bold hover:bg-slate-100 text-sm shadow-sm transition-colors">
                              <Download size={16}/> Export
                          </button>
                          <label className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-xl font-bold hover:bg-black text-sm cursor-pointer shadow-md transition-all">
                              <Upload size={16}/> Import
                              <input type="file" accept=".xlsx, .csv" className="hidden" onChange={handleFileUpload}/>
                          </label>
                          <button onClick={() => { setCurrentItem(null); setIsModalOpen(true); }} className={`flex items-center gap-2 px-4 py-2 text-white rounded-xl font-bold text-sm shadow-md transition-all hover:brightness-110 ${activeTab==='master_products' ? 'bg-cyan-600 shadow-cyan-200' : activeTab==='master_vendors' ? 'bg-fuchsia-600 shadow-fuchsia-200' : 'bg-emerald-600 shadow-emerald-200'}`}>
                              <Plus size={16}/> New Record
                          </button>
                      </div>
                  </div>

                  <div className="flex-1 overflow-auto bg-white custom-scrollbar">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                          <thead className="bg-slate-100/80 text-slate-500 font-bold uppercase text-[10px] tracking-wider sticky top-0 backdrop-blur-md z-10 shadow-sm border-b border-slate-200">
                              <tr>
                                  <th className="p-4 w-10 text-center">#</th>
                                  {currentTabConfig?.columns.map(col => <th key={col.key} className="p-4">{col.label}</th>)}
                                  <th className="p-4 text-center w-28 bg-slate-100 sticky right-0">Actions</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {loading ? <tr><td colSpan={10} className="p-12 text-center text-slate-400"><Activity className="animate-spin mx-auto mb-2 text-cyan-500"/> Loading Database...</td></tr> : 
                               currentItems.length === 0 ? <tr><td colSpan={10} className="p-12 text-center text-slate-400">No records found.</td></tr> :
                               currentItems.map((item, idx) => (
                                  <tr key={item[currentTabConfig?.pk || ''] || idx} className="hover:bg-slate-50 transition-colors group">
                                      <td className="p-4 text-center text-xs text-slate-400 font-mono">{(currentPage - 1) * itemsPerPage + idx + 1}</td>
                                      {currentTabConfig?.columns.map(col => (
                                          <td key={col.key} className="p-4 text-slate-700">
                                              {col.key === 'standard_cost' 
                                                ? <span className="font-bold text-emerald-600">฿ {item[col.key]?.toLocaleString(undefined, {maximumFractionDigits: 2})}</span> 
                                                : col.key === 'status' ? (
                                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${item[col.key] === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{item[col.key]}</span>
                                                )
                                                : col.key === 'is_active' ? (
                                                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${item[col.key] ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{item[col.key] ? 'TRUE' : 'FALSE'}</span>
                                                )
                                                // 🟢 แสดงป้ายกำกับ Zone, Room, Shelf ให้สวยงาม
                                                : col.key === 'default_location' || col.key === 'shelf_position' || col.key === 'category' ? (
                                                    <span className={`text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider ${item[col.key] && item[col.key] !== '-' ? (col.key === 'category' ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700 border border-amber-200') : 'bg-slate-100 text-slate-400'}`}>
                                                        {col.key === 'default_location' ? <MapPin size={10} className="inline mr-1 mb-0.5"/> : col.key === 'shelf_position' ? <Layers size={10} className="inline mr-1 mb-0.5"/> : <Tag size={10} className="inline mr-1 mb-0.5"/>}
                                                        {item[col.key] || '-'}
                                                    </span>
                                                )
                                                : col.key === 'min_stock' ? (
                                                    <span className="font-mono text-slate-500 font-bold">{item[col.key] || 0}</span>
                                                )
                                                : <span className={col.key.includes('id') ? 'font-mono text-xs font-bold text-cyan-700' : ''}>{item[col.key] || '-'}</span>
                                              }
                                          </td>
                                      ))}
                                      <td className="p-4 text-center bg-white group-hover:bg-slate-50 sticky right-0 shadow-[-5px_0_10px_-5px_rgba(0,0,0,0.05)] border-l border-slate-100">
                                          <div className="flex items-center justify-center gap-2">
                                              <button onClick={() => { setCurrentItem(item); setIsModalOpen(true); }} className="p-1.5 text-slate-400 hover:text-cyan-600 hover:bg-cyan-50 rounded-lg transition-colors"><Edit2 size={16}/></button>
                                              <button onClick={() => handleDelete(item[currentTabConfig?.pk || 'id'])} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"><Trash2 size={16}/></button>
                                          </div>
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
                  
                  <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between items-center text-xs text-slate-500">
                      <div>Showing <b>{currentItems.length}</b> of <b>{filteredData.length}</b> records</div>
                      <div className="flex items-center gap-2">
                          <button onClick={() => setCurrentPage(p => Math.max(1, p-1))} disabled={currentPage===1} className="p-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-50"><ChevronLeft size={16}/></button>
                          <span className="font-bold text-slate-700 px-2">Page {currentPage} of {totalPages || 1}</span>
                          <button onClick={() => setCurrentPage(p => Math.min(totalPages, p+1))} disabled={currentPage===totalPages || totalPages===0} className="p-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-50"><ChevronRight size={16}/></button>
                      </div>
                  </div>
              </div>
          </div>
      </div>

      {/* --- FORM MODAL --- */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl overflow-hidden border border-slate-200">
            <div className="p-5 bg-slate-50 border-b border-slate-200 flex justify-between items-center relative overflow-hidden">
                <div className={`absolute -right-10 -top-10 w-32 h-32 rounded-full opacity-20 ${activeTab==='master_products' ? 'bg-cyan-500' : activeTab==='master_vendors' ? 'bg-fuchsia-500' : 'bg-emerald-500'}`}></div>
                <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2 relative z-10">
                    {currentItem ? <Edit2 size={20} className="text-cyan-600"/> : <Plus size={20} className="text-cyan-600"/>} 
                    {currentItem ? 'Edit Record' : 'Create New Record'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 bg-white rounded-full hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition-colors relative z-10"><X size={20}/></button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-5">
                {activeTab === 'master_products' && (
                    <>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">SKU / ID *</label><input name="product_id" defaultValue={currentItem?.product_id} required readOnly={!!currentItem} className={`w-full p-2.5 border border-slate-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-cyan-500 outline-none ${currentItem ? 'bg-slate-100 text-slate-500' : 'bg-white'}`} placeholder="P-001"/></div>
                            <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Product Name *</label><input name="product_name" defaultValue={currentItem?.product_name} required className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500 outline-none" placeholder="ชื่อสินค้า"/></div>
                        </div>
                        
                        {/* 🟢 อัปเดตส่วน Location Hierarchy ให้มีครบ 3 ช่อง (Zone, Room, Shelf) */}
                        <div className="grid grid-cols-3 gap-4">
                            <div><label className="text-[11px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Tag size={12}/> Zone (Category)</label><input name="category" defaultValue={currentItem?.category} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500 outline-none" placeholder="e.g. SM"/></div>
                            <div><label className="text-[11px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><MapPin size={12}/> Room (Location)</label><input name="default_location" defaultValue={currentItem?.default_location} className="w-full p-2.5 border border-amber-300 bg-amber-50 text-amber-800 rounded-xl font-bold uppercase text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="e.g. MAIN_WH"/></div>
                            <div><label className="text-[11px] font-bold text-slate-500 uppercase mb-1 flex items-center gap-1"><Layers size={12}/> Shelf (ชั้นวาง)</label><input name="shelf_position" defaultValue={currentItem?.shelf_position} className="w-full p-2.5 border border-amber-300 bg-amber-50 text-amber-800 rounded-xl font-bold uppercase text-sm focus:ring-2 focus:ring-amber-500 outline-none" placeholder="e.g. A11"/></div>
                        </div>

                        <div className="bg-cyan-50/50 p-4 rounded-xl border border-cyan-100">
                            <h4 className="text-xs font-bold text-cyan-700 mb-3 flex items-center gap-2"><DollarSign size={14}/> Base Unit & Standard Cost</h4>
                            <div className="grid grid-cols-3 gap-3">
                                <div><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Base UOM</label><input name="base_uom" defaultValue={currentItem?.base_uom || 'Piece'} required className="w-full p-2 border border-cyan-200 rounded-lg text-sm text-center bg-white" placeholder="ชิ้น"/></div>
                                {/* 🟢 รองรับการพิมพ์ทศนิยม */}
                                <div className="col-span-2"><label className="text-[10px] font-bold text-slate-500 uppercase mb-1 block">Cost (per Base Unit)</label><input name="standard_cost" type="number" step="0.01" defaultValue={currentItem?.standard_cost} className="w-full p-2 border border-cyan-200 rounded-lg text-sm font-bold text-emerald-600 bg-white" placeholder="0.00"/></div>
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-4">
                             <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Buy UOM</label><input name="purchase_uom" defaultValue={currentItem?.purchase_uom} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm" placeholder="ลัง"/></div>
                             <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Conv. Rate</label><input name="conversion_rate" type="number" step="0.01" defaultValue={currentItem?.conversion_rate || 1} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm" placeholder="1"/></div>
                             <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Min Stock</label><input name="min_stock" type="number" defaultValue={currentItem?.min_stock || 10} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm" placeholder="10"/></div>
                        </div>
                        
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Status</label>
                            <select name="status" defaultValue={currentItem?.status || 'ACTIVE'} className="w-full p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500 outline-none bg-white">
                                <option value="ACTIVE">ACTIVE (เปิดใช้งาน)</option>
                                <option value="INACTIVE">INACTIVE (ปิดใช้งาน/ซ่อน)</option>
                            </select>
                        </div>
                    </>
                )}

                {activeTab === 'master_vendors' && (
                    <div className="space-y-4">
                        <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Vendor Code (ID) *</label><input name="vendor_id" defaultValue={currentItem?.vendor_id} required readOnly={!!currentItem} className={`w-full p-3 border border-slate-300 rounded-xl font-mono focus:ring-2 focus:ring-fuchsia-500 outline-none ${currentItem ? 'bg-slate-100 text-slate-500' : 'bg-white'}`} placeholder="V-001"/></div>
                        <div><label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Vendor Name *</label><input name="vendor_name" defaultValue={currentItem?.vendor_name} required className="w-full p-3 border border-slate-300 rounded-xl focus:ring-2 focus:ring-fuchsia-500 outline-none" placeholder="บริษัทจำกัด..."/></div>
                    </div>
                )}

                {activeTab === 'master_branches' && (
                    <div className="space-y-4">
                        <div className="bg-blue-50 border border-blue-200 p-3 rounded-xl text-xs text-blue-700 mb-2">
                            💡 แนะนำ: ระบุ Branch Name เป็นแบบ <b>"รหัส - ชื่อเต็ม"</b> (เช่น <b>0001 EM-Emporium</b>) ระบบจะนำไปใช้เป็น ID ด้วยอัตโนมัติ
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Branch ID & Name *</label>
                            <input 
                                name="branch_name" 
                                defaultValue={currentItem?.branch_name} 
                                required 
                                className="w-full p-3 border border-slate-300 rounded-xl font-bold focus:ring-2 focus:ring-emerald-500 outline-none" 
                                placeholder="เช่น 0001 EM-Emporium"
                            />
                        </div>
                        <div className="flex items-center gap-2 mt-4 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                            <input type="checkbox" name="is_active" id="is_active" defaultChecked={currentItem ? currentItem.is_active : true} className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"/>
                            <label htmlFor="is_active" className="text-sm font-bold text-slate-700 cursor-pointer">เปิดใช้งานสาขานี้ (Active)</label>
                        </div>
                    </div>
                )}

                <div className="pt-4 border-t border-slate-100 flex gap-3">
                    <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">Cancel</button>
                    <button type="submit" disabled={saveLoading} className={`flex-1 py-3 rounded-xl text-white font-bold flex justify-center items-center gap-2 shadow-lg transition-all ${activeTab==='master_products' ? 'bg-cyan-600 hover:bg-cyan-700 shadow-cyan-200' : activeTab==='master_vendors' ? 'bg-fuchsia-600 hover:bg-fuchsia-700 shadow-fuchsia-200' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'} disabled:opacity-50`}>
                        {saveLoading ? 'Saving...' : <><Save size={18}/> Save Data</>}
                    </button>
                </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
