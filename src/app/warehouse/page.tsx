"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { supabase } from '../../supabaseClient';
import { Search, UploadCloud, Layers, ArrowUpDown, RefreshCw, Download, ChevronLeft, ChevronRight, Edit2, X, CheckCircle, Eye, EyeOff, Archive, History, FileText, AlertTriangle, FileSpreadsheet } from 'lucide-react';
import * as XLSX from 'xlsx';

export default function Inventory() {
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // --- Settings & Filters ---
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [locationFilter, setLocationFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [alertDays, setAlertDays] = useState(7); 
  const [calcPeriod, setCalcPeriod] = useState(30); 
  const [showArchived, setShowArchived] = useState(false); 

  // --- Pagination ---
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 100;

  // --- Sort ---
  const [sortConfig, setSortConfig] = useState({ key: 'days_supply', direction: 'asc' });

  // --- SINGLE ADJUST MODAL ---
  const [adjustItem, setAdjustItem] = useState<any>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [isAdjusting, setIsAdjusting] = useState(false);

  // --- BULK ADJUST MODAL (Preview) ---
  const [bulkPreviewData, setBulkPreviewData] = useState<any[]>([]);
  const [isBulkPreviewOpen, setIsBulkPreviewOpen] = useState(false);
  const [isBulkSaving, setIsBulkSaving] = useState(false);

  // --- STOCK CARD MODAL ---
  const [stockCardItem, setStockCardItem] = useState<any>(null);
  const [stockHistory, setStockHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    fetchData();
  }, [calcPeriod]);

  // 🟢 1. FETCH DATA (อิงตาม Schema)
  const fetchData = async () => {
    setLoading(true);
    try {
        const { data: prodData, error: prodErr } = await supabase.from('master_products').select('*');
        if (prodErr) throw prodErr;
        const allProducts = prodData || [];

        const { data: lotsData, error: lotsErr } = await supabase.from('inventory_lots').select('product_id, quantity, storage_location');
        if (lotsErr) throw lotsErr;
        
        const invMap: Record<string, { total_qty: number, locations: Set<string> }> = {};
        (lotsData || []).forEach((lot: any) => {
            if (!invMap[lot.product_id]) invMap[lot.product_id] = { total_qty: 0, locations: new Set() };
            invMap[lot.product_id].total_qty += Number(lot.quantity) || 0;
            if (lot.storage_location) invMap[lot.product_id].locations.add(lot.storage_location);
        });

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - calcPeriod);
        
        const { data: transData } = await supabase
            .from('transactions_log')
            .select('product_id, transaction_type, quantity_change')
            .gte('transaction_date', startDate.toISOString());
            
        const transList = transData || [];
        
        const processed = allProducts.map((product: any) => {
            const stockInfo = invMap[product.product_id] || { total_qty: 0, locations: new Set() };
            const currentStock = stockInfo.total_qty;
            const locationStr = stockInfo.locations.size > 0 ? Array.from(stockInfo.locations).join(', ') : (product.default_location || 'Main');

            const itemTrans = transList.filter((t: any) => t.product_id === product.product_id);
            let totalOut = 0; let totalIn = 0;

            itemTrans.forEach((t: any) => {
                const qty = Math.abs(Number(t.quantity_change) || 0);
                if (t.transaction_type === 'IN' || t.transaction_type === 'RECEIPT' || t.transaction_type === 'INBOUND') totalIn += qty;
                else if (t.transaction_type === 'OUT' || t.transaction_type === 'TRANSFER' || t.transaction_type === 'OUTBOUND' || t.quantity_change < 0) totalOut += qty;
            });

            const avgDailyOut = totalOut / calcPeriod;
            const daysSupply = avgDailyOut > 0 ? Math.floor(currentStock / avgDailyOut) : (currentStock > 0 ? 999 : 0);
            const sellThrough = (totalOut + currentStock) > 0 ? (totalOut / (currentStock + totalOut)) * 100 : 0;

            let status = 'Normal';
            if (currentStock <= 0) status = 'Out of Stock';
            else if (currentStock <= (product.min_stock || 0) || daysSupply <= alertDays) status = 'Low Stock';
            else if (totalOut === 0 && calcPeriod >= 14) status = 'Dead Stock';
            else if (sellThrough < 10 && calcPeriod >= 14) status = 'Slow Moving';

            const today = new Date();
            const depleteDate = new Date(today);
            depleteDate.setDate(today.getDate() + daysSupply);

            return {
                id: product.product_id,
                product_id: product.product_id,
                product_name: product.product_name,
                category: product.category || 'Uncategorized',
                current_qty: currentStock,
                unit: product.base_uom || 'Piece',
                location: locationStr,
                total_in: totalIn,
                total_out: totalOut,
                avg_daily: avgDailyOut,
                days_supply: daysSupply,
                sell_through: sellThrough,
                status: status,
                depletion_date: daysSupply > 365 ? 'Safe (>1Y)' : (daysSupply === 0 && currentStock === 0 ? '-' : depleteDate.toISOString().split('T')[0]),
                is_hidden: product.status === 'INACTIVE' 
            };
        });
        setInventory(processed);
    } catch (error: any) { 
        console.error(error); alert("Load Error: " + error.message);
    }
    setLoading(false);
  };

  // 🟢 2. ADJUST STOCK LOGIC (Shared Core)
  const executeStockAdjust = async (productId: string, diff: number, newQty: number, reason: string) => {
      const { data: lots } = await supabase.from('inventory_lots').select('*').eq('product_id', productId).order('quantity', { ascending: false }).limit(1);
      
      if (lots && lots.length > 0) {
          const newLotQty = Number(lots[0].quantity) + diff;
          await supabase.from('inventory_lots').update({ quantity: newLotQty, last_updated: new Date().toISOString() }).eq('lot_id', lots[0].lot_id);
      } else {
          await supabase.from('inventory_lots').insert([{ product_id: productId, quantity: newQty, storage_location: 'MAIN_WH' }]);
      }

      await supabase.from('transactions_log').insert([{
          transaction_type: 'ADJUST',
          product_id: productId,
          quantity_change: diff,
          balance_after: newQty,
          remarks: reason || 'System Adjustment'
      }]);
  };

  const handleSaveAdjust = async () => {
      if (!adjustItem) return;
      const newQty = parseInt(adjustQty);
      if (isNaN(newQty) || newQty < 0) return alert("Please enter a valid positive number");
      setIsAdjusting(true);
      try {
          const diff = newQty - adjustItem.current_qty;
          if (diff !== 0) await executeStockAdjust(adjustItem.product_id, diff, newQty, adjustReason || 'Manual Adjustment');
          alert("✅ Stock Updated Successfully!");
          setAdjustItem(null);
          fetchData();
      } catch (error: any) { alert("Error: " + error.message); }
      setIsAdjusting(false);
  };

  // 🟢 3. SECURE BULK ADJUST (Export Template -> Import -> Preview -> Confirm)
  const handleExportAdjustTemplate = () => {
      const exportData = sortedData.map(item => ({
          'รหัสสินค้า (Product ID)': item.product_id,
          'ชื่อสินค้า (Product Name)': item.product_name,
          'ยอดสต๊อกปัจจุบัน (Current Qty)': item.current_qty,
          'ยอดสต๊อกใหม่ (New Qty)': '', // ว่างไว้ให้ User กรอก
          'เหตุผลการปรับยอด (Reason)': 'Audit Check'
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      // ใส่สีหรือล็อค Column ไม่ได้ผ่าน xlsx ธรรมดา แต่จัดฟอร์แมตให้ดูง่ายได้
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Adjust_Template");
      XLSX.writeFile(wb, `Stock_Adjust_Template_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleImportBulkAdjust = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (evt: any) => {
          try {
              const data = new Uint8Array(evt.target.result);
              const workbook = XLSX.read(data, { type: 'array' });
              const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]]);
              
              const changes: any[] = [];
              rows.forEach((row: any) => {
                  const pid = String(row['รหัสสินค้า (Product ID)'] || row['Product ID'] || row['product_id'] || '').trim();
                  const newQty = parseInt(row['ยอดสต๊อกใหม่ (New Qty)'] || row['New Qty']);
                  const reason = String(row['เหตุผลการปรับยอด (Reason)'] || row['Reason'] || 'Bulk Import Adjustment');

                  if (pid && !isNaN(newQty) && newQty >= 0) {
                      const currentItem = inventory.find(i => i.product_id === pid);
                      if (currentItem && currentItem.current_qty !== newQty) {
                          changes.push({
                              product_id: pid,
                              product_name: currentItem.product_name,
                              old_qty: currentItem.current_qty,
                              new_qty: newQty,
                              diff: newQty - currentItem.current_qty,
                              reason: reason
                          });
                      }
                  }
              });

              if (changes.length > 0) {
                  setBulkPreviewData(changes);
                  setIsBulkPreviewOpen(true);
              } else {
                  alert("ไม่พบรายการที่ต้องปรับปรุง (ยอดอาจตรงอยู่แล้ว หรือรูปแบบไฟล์/คอลัมน์ไม่ถูกต้อง)");
              }
          } catch (err: any) { alert("Error reading file: " + err.message); }
          e.target.value = ''; // Reset input
      };
      reader.readAsArrayBuffer(file);
  };

  const handleConfirmBulkAdjust = async () => {
      setIsBulkSaving(true);
      try {
          for (const item of bulkPreviewData) {
              await executeStockAdjust(item.product_id, item.diff, item.new_qty, item.reason);
          }
          alert(`✅ ปรับปรุงสต๊อกสำเร็จจำนวน ${bulkPreviewData.length} รายการ!`);
          setIsBulkPreviewOpen(false);
          setBulkPreviewData([]);
          fetchData();
      } catch (error: any) {
          alert("Error during bulk adjust: " + error.message);
      }
      setIsBulkSaving(false);
  };

  // --- Export Report ---
  const handleExportReport = () => {
      const exportData = sortedData.map(item => ({
          'รหัส': item.product_id,
          'ชื่อสินค้า': item.product_name,
          'จำนวนคงคลัง': item.current_qty,
          'หน่วย': item.unit,
          'Outbound': item.total_out,
          'Inbound': item.total_in,
          'Category': item.category,
          'Location': item.location,
          'Status': item.status,
          '% การระบายสินค้า': item.sell_through.toFixed(2) + '%',
          'ค่าเฉลี่ยจ่าย/วัน': item.avg_daily.toFixed(2),
          'จำนวนวันที่จ่ายได้': item.days_supply,
          'Hidden': item.is_hidden ? 'Yes' : 'No'
      }));
      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Inventory_Report");
      XLSX.writeFile(wb, `Inventory_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  // --- STOCK CARD ---
  const handleOpenStockCard = async (item: any) => {
      setStockCardItem(item);
      setHistoryLoading(true);
      setStockHistory([]);
      try {
          const { data: snap } = await supabase.from('transactions_log').select('*').eq('product_id', item.product_id).order('transaction_date', { ascending: false }).limit(100);
          setStockHistory((snap || []).map(d => ({
              id: d.transaction_id, date: new Date(d.transaction_date), docNo: d.reference_id || '-', type: d.transaction_type, ref: d.remarks || '-', qtyChange: Number(d.quantity_change) || 0, balance: Number(d.balance_after) || 0
          })));
      } catch (error) { console.error(error); }
      setHistoryLoading(false);
  };

  const handleToggleArchive = async (e: React.MouseEvent, item: any) => {
      e.stopPropagation();
      const newStatus = !item.is_hidden;
      if (!window.confirm(newStatus ? `ซ่อนสินค้า "${item.product_name}"?` : `แสดงสินค้า "${item.product_name}"?`)) return;
      try {
          await supabase.from('master_products').update({ status: newStatus ? 'INACTIVE' : 'ACTIVE' }).eq('product_id', item.product_id);
          fetchData();
      } catch (error) { console.error(error); }
  };

  // --- Data Sorting & Filtering ---
  const handleSort = (key: string) => {
      let direction = 'asc';
      if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
      setSortConfig({ key, direction });
  };

  const sortedData = useMemo(() => {
      let data = [...inventory];
      if (showArchived) data = data.filter(i => i.is_hidden); else data = data.filter(i => !i.is_hidden); 
      if (searchTerm) {
          const lower = searchTerm.toLowerCase();
          data = data.filter(i => (i.product_id||'').toLowerCase().includes(lower) || (i.product_name||'').toLowerCase().includes(lower));
      }
      if (categoryFilter !== 'ALL') data = data.filter(i => i.category === categoryFilter);
      if (statusFilter !== 'ALL') data = data.filter(i => i.status === statusFilter);
      if (locationFilter !== 'ALL') data = data.filter(i => (i.location || '-') === locationFilter);

      if (sortConfig.key) {
          data.sort((a: any, b: any) => {
              if (a[sortConfig.key] < b[sortConfig.key]) return sortConfig.direction === 'asc' ? -1 : 1;
              if (a[sortConfig.key] > b[sortConfig.key]) return sortConfig.direction === 'asc' ? 1 : -1;
              return 0;
          });
      }
      return data;
  }, [inventory, searchTerm, categoryFilter, statusFilter, locationFilter, sortConfig, showArchived]);

  const totalPages = Math.ceil(sortedData.length / itemsPerPage);
  const currentData = sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  useEffect(() => { setCurrentPage(1); }, [searchTerm, categoryFilter, statusFilter, locationFilter, showArchived]);
  
  const uniqueCategories = [...new Set(inventory.map(i => i.category))].filter(Boolean).sort();
  const uniqueLocations = [...new Set(inventory.map(i => i.location || '-'))].filter(Boolean).sort();

  return (
    <div className="p-6 bg-slate-50 h-full flex flex-col overflow-hidden relative rounded-2xl selection:bg-cyan-200 font-sans">
      {/* 1. Header Section */}
      <div className="mb-4 flex flex-col lg:flex-row justify-between lg:items-center gap-4 flex-shrink-0">
        <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                <div className="p-1.5 bg-cyan-100 text-cyan-600 rounded-lg"><Layers size={20}/></div> 
                Inventory Management
            </h1>
            <p className="text-slate-500 text-xs mt-1">วิเคราะห์สต๊อก คำนวณวันหมดอายุ และการระบายสินค้า (Last {calcPeriod} Days)</p>
        </div>
        <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowArchived(!showArchived)} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold shadow-sm text-xs transition-colors ${showArchived ? 'bg-slate-700 text-white' : 'bg-white text-slate-500 border border-slate-300 hover:bg-slate-50'}`}>
                {showArchived ? <><Eye size={14}/> View Active</> : <><Archive size={14}/> View Hidden</>}
            </button>
            
            {/* 🟢 Secure Bulk Adjust Tools */}
            <div className="flex items-center bg-white border border-slate-300 rounded-lg p-0.5 shadow-sm text-xs font-bold overflow-hidden">
                <button onClick={handleExportAdjustTemplate} className="px-3 py-1 hover:bg-blue-50 text-blue-600 flex items-center gap-1 border-r border-slate-200 transition-colors" title="โหลดแบบฟอร์ม Excel">
                    <FileSpreadsheet size={14}/> Template
                </button>
                <label className="px-3 py-1 hover:bg-amber-50 text-amber-600 flex items-center gap-1 cursor-pointer transition-colors" title="อัปโหลดไฟล์ Excel เพื่อปรับสต๊อก">
                    <UploadCloud size={14}/> Bulk Adjust
                    <input type="file" accept=".xlsx, .csv" className="hidden" onChange={handleImportBulkAdjust} />
                </label>
            </div>

            <button onClick={handleExportReport} className="flex items-center gap-2 bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-bold shadow hover:bg-emerald-700 text-xs transition-colors">
                <Download size={14}/> Export
            </button>
            <button onClick={fetchData} className="flex items-center gap-2 bg-cyan-600 text-white px-3 py-1.5 rounded-lg font-bold shadow hover:bg-cyan-700 text-xs transition-colors">
                <RefreshCw size={14}/> Sync
            </button>
        </div>
      </div>

      {/* 2. Filters Section */}
      <div className={`p-3 rounded-t-xl border border-slate-200 shadow-sm flex flex-wrap gap-4 items-center justify-between flex-shrink-0 transition-colors ${showArchived ? 'bg-slate-100' : 'bg-white'}`}>
          <div className="flex gap-4 flex-1">
              <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                  <input type="text" placeholder="Search product..." className="w-full pl-9 p-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-cyan-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
              </div>
              <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none cursor-pointer hover:bg-slate-50" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                  <option value="ALL">All Categories</option>
                  {uniqueCategories.map(c => <option key={c as string} value={c as string}>{c as string}</option>)}
              </select>
              <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none cursor-pointer hover:bg-slate-50" value={locationFilter} onChange={e => setLocationFilter(e.target.value)}>
                  <option value="ALL">All Locations</option>
                  {uniqueLocations.map(l => <option key={l as string} value={l as string}>{l as string}</option>)}
              </select>
              <select className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white outline-none cursor-pointer hover:bg-slate-50" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="ALL">All Status</option>
                  <option value="Normal">Normal</option>
                  <option value="Low Stock">Low Stock</option>
                  <option value="Slow Moving">Slow Moving</option>
                  <option value="Dead Stock">Dead Stock</option>
                  <option value="Out of Stock">Out of Stock</option>
              </select>
          </div>

          <div className="flex items-center gap-4 border-l pl-4 border-slate-200">
              <div className="flex flex-col items-end">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Alert Days</label>
                  <select className="text-xs font-bold border rounded p-1 text-rose-600 bg-rose-50 cursor-pointer outline-none" value={alertDays} onChange={e => setAlertDays(parseInt(e.target.value))}>
                      <option value="3">3 Days</option><option value="5">5 Days</option><option value="7">7 Days</option><option value="14">14 Days</option>
                  </select>
              </div>
              <div className="flex flex-col items-end">
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Analysis Period</label>
                  <select className="text-xs font-bold border rounded p-1 text-cyan-600 bg-cyan-50 cursor-pointer outline-none" value={calcPeriod} onChange={e => setCalcPeriod(parseInt(e.target.value))}>
                      <option value="7">Last 7 Days</option><option value="14">Last 14 Days</option><option value="30">Last 30 Days</option>
                  </select>
              </div>
          </div>
      </div>

      {/* 3. Table Section */}
      <div className="bg-white rounded-b-xl shadow-sm border-x border-b border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-600 font-bold border-b text-xs uppercase sticky top-0 z-20 shadow-sm">
                    <tr>
                        <th className="p-3 pl-4 sticky left-0 bg-slate-100 z-30 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] cursor-pointer hover:bg-slate-200" onClick={() => handleSort('product_id')}>Product Info <ArrowUpDown size={10} className="inline ml-1"/></th>
                        <th className="p-3 text-center bg-gray-50 cursor-pointer hover:bg-gray-200" onClick={() => handleSort('current_qty')}>Stock <ArrowUpDown size={10} className="inline ml-1"/></th>
                        <th className="p-3 text-center">Unit</th>
                        <th className="p-3 text-center text-emerald-700 bg-emerald-50">Inbound</th>
                        <th className="p-3 text-center text-rose-700 bg-rose-50">Outbound</th>
                        <th className="p-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('avg_daily')}>Avg Out/Day</th>
                        <th className="p-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('sell_through')}>Sell-Through</th>
                        <th className="p-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('days_supply')}>Days Supply</th>
                        <th className="p-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('depletion_date')}>Depletion</th>
                        <th className="p-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('status')}>Status</th>
                        <th className="p-3 text-center cursor-pointer hover:bg-slate-200" onClick={() => handleSort('location')}>Loc</th>
                        <th className="p-3 text-center w-28">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan={12} className="p-10 text-center text-slate-400">Loading data...</td></tr>
                    ) : currentData.length === 0 ? (
                        <tr><td colSpan={12} className="p-10 text-center text-slate-400">No data found in {showArchived ? 'Archived' : 'Active'} list.</td></tr>
                    ) : currentData.map((item, idx) => {
                        const isCritical = !showArchived && (item.status === 'Low Stock' || item.status === 'Out of Stock');
                        return (
                            <tr key={idx} className={`hover:bg-cyan-50/50 transition-colors group ${isCritical ? 'bg-rose-50/30' : ''} ${item.is_hidden ? 'bg-slate-50 text-slate-400' : ''}`}>
                                <td className={`p-3 pl-4 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] ${isCritical ? 'bg-rose-50' : 'bg-white'} group-hover:bg-cyan-50/80`}>
                                    {/* 🟢 Clickable Product Link */}
                                    <Link href={`/product/${encodeURIComponent(item.product_id)}`} className="font-bold text-cyan-700 hover:text-cyan-600 hover:underline transition-all block">
                                        {item.product_id}
                                    </Link>
                                    <div className="text-xs text-slate-500 truncate w-40 mt-0.5" title={item.product_name}>{item.product_name}</div>
                                    <div className="text-[10px] text-slate-400">{item.category}</div>
                                </td>
                                <td className="p-3 text-center font-bold text-lg text-slate-800 bg-gray-50/30">{item.current_qty.toLocaleString()}</td>
                                <td className="p-3 text-center text-xs text-slate-500">{item.unit}</td>
                                <td className="p-3 text-center text-emerald-600 bg-emerald-50/10">+{item.total_in.toLocaleString()}</td>
                                <td className="p-3 text-center text-rose-600 bg-rose-50/10">-{item.total_out.toLocaleString()}</td>
                                <td className="p-3 text-center font-mono">{item.avg_daily.toLocaleString(undefined,{maximumFractionDigits:1})}</td>
                                <td className="p-3 text-center">
                                    <div className="text-xs font-bold">{item.sell_through.toFixed(1)}%</div>
                                    <div className="w-12 h-1 bg-slate-200 rounded-full mx-auto mt-1 overflow-hidden">
                                        <div className={`h-full ${item.sell_through > 50 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{width: `${Math.min(item.sell_through, 100)}%`}}></div>
                                    </div>
                                </td>
                                <td className="p-3 text-center">
                                    <span className={`px-2 py-1 rounded font-bold ${item.days_supply <= alertDays && !showArchived ? 'text-rose-700 bg-rose-100 animate-pulse' : 'text-slate-700'}`}>
                                        {item.days_supply > 365 ? '>1Y' : item.days_supply}
                                    </span>
                                </td>
                                <td className="p-3 text-center text-xs font-bold text-slate-600">{item.depletion_date}</td>
                                <td className="p-3 text-center">
                                    <span className={`text-[10px] px-2 py-1 rounded-full border font-bold ${
                                        item.status === 'Out of Stock' ? 'bg-slate-200 text-slate-500' :
                                        item.status === 'Dead Stock' ? 'bg-slate-800 text-white' :
                                        item.status === 'Low Stock' ? 'bg-rose-100 text-rose-600 border-rose-200' :
                                        item.status === 'Slow Moving' ? 'bg-amber-100 text-amber-600 border-amber-200' :
                                        'bg-emerald-100 text-emerald-600 border-emerald-200'
                                    }`}>
                                        {item.status}
                                    </span>
                                </td>
                                <td className="p-3 text-center text-xs font-mono text-slate-500 max-w-[100px] truncate" title={item.location}>{item.location}</td>
                                <td className="p-3 text-center flex justify-center gap-1">
                                    <button onClick={() => handleOpenStockCard(item)} className="p-1.5 hover:bg-slate-200 rounded-full text-slate-500 hover:text-cyan-600 transition-colors" title="Stock History">
                                        <History size={14}/>
                                    </button>
                                    <button onClick={() => setAdjustItem(item)} className="p-1.5 hover:bg-slate-200 rounded-full text-slate-500 hover:text-amber-500 transition-colors" title="Adjust Stock">
                                        <Edit2 size={14}/>
                                    </button>
                                    <button onClick={(e) => handleToggleArchive(e, item)} className={`p-1.5 rounded-full transition-colors ${item.is_hidden ? 'text-cyan-500 hover:bg-cyan-100' : 'text-slate-400 hover:bg-slate-200 hover:text-rose-500'}`} title={item.is_hidden ? "Unhide" : "Hide"}>
                                        {item.is_hidden ? <Eye size={14}/> : <EyeOff size={14}/>}
                                    </button>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
        
        {/* Pagination Footer */}
        <div className="p-2 border-t bg-slate-50 flex justify-between items-center text-xs text-slate-500 flex-shrink-0">
            <div>
                Showing {((currentPage-1)*itemsPerPage)+1} - {Math.min(currentPage*itemsPerPage, sortedData.length)} of {sortedData.length} items
                <span className="ml-2 font-bold text-slate-400">
                    {showArchived ? '(Archived Items)' : '(Active Items)'}
                </span>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronLeft size={16}/></button>
                <span className="font-bold text-slate-700 flex items-center px-2">Page {currentPage} of {totalPages || 1}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-1.5 rounded hover:bg-slate-200 disabled:opacity-30"><ChevronRight size={16}/></button>
            </div>
        </div>
      </div>

      {/* --- SINGLE ADJUST MODAL --- */}
      {adjustItem && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                  <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                      <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800"><Edit2 size={18} className="text-amber-500"/> Adjust Stock</h3>
                      <button onClick={() => setAdjustItem(null)} className="text-slate-400 hover:text-rose-500"><X size={20}/></button>
                  </div>
                  <div className="p-6">
                      <div className="mb-4">
                          <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Product</label>
                          <div className="font-bold text-slate-800">{adjustItem.product_name}</div>
                          <div className="text-xs text-slate-400">{adjustItem.product_id}</div>
                      </div>
                      <div className="mb-4">
                          <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Current Quantity</label>
                          <input type="number" className="w-full p-3 border border-slate-300 rounded-xl text-xl font-bold text-center focus:ring-2 focus:ring-cyan-500 outline-none" value={adjustQty} onChange={(e) => setAdjustQty(e.target.value)} autoFocus />
                      </div>
                      <div>
                          <label className="text-xs font-bold text-slate-500 uppercase block mb-1">Reason / Note</label>
                          <textarea className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-cyan-500 outline-none resize-none" placeholder="e.g. Audit correction, Damaged" rows={2} value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)}></textarea>
                      </div>
                  </div>
                  <div className="p-4 border-t bg-slate-50 flex gap-3">
                      <button onClick={() => setAdjustItem(null)} className="flex-1 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors">Cancel</button>
                      <button onClick={handleSaveAdjust} disabled={isAdjusting} className="flex-1 py-2.5 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600 flex justify-center gap-2 items-center shadow-lg shadow-amber-200 transition-colors">
                          {isAdjusting ? 'Saving...' : <><CheckCircle size={18}/> Confirm</>}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* --- BULK ADJUST PREVIEW MODAL (SECURE) --- */}
      {isBulkPreviewOpen && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col overflow-hidden">
                  <div className="p-5 bg-amber-50 border-b border-amber-200 flex justify-between items-center">
                      <div>
                          <h3 className="font-bold text-lg flex items-center gap-2 text-amber-800"><AlertTriangle size={18}/> Review Bulk Adjustments</h3>
                          <p className="text-xs text-amber-600 mt-1">กรุณาตรวจสอบการเปลี่ยนแปลงก่อนยืนยันการบันทึก (พบ {bulkPreviewData.length} รายการที่ต้องปรับยอด)</p>
                      </div>
                      <button onClick={() => {setIsBulkPreviewOpen(false); setBulkPreviewData([]);}} className="text-amber-500 hover:text-rose-500 p-2"><X size={20}/></button>
                  </div>
                  
                  <div className="flex-1 overflow-auto bg-slate-50 p-4">
                      <table className="w-full text-left text-sm bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                          <thead className="bg-slate-100 text-slate-600 uppercase text-xs">
                              <tr>
                                  <th className="p-3 pl-4">Product Info</th>
                                  <th className="p-3 text-center bg-slate-50">Old Qty</th>
                                  <th className="p-3 text-center bg-amber-50 text-amber-700">New Qty</th>
                                  <th className="p-3 text-right border-l">Change (Diff)</th>
                                  <th className="p-3 pr-4">Reason</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {bulkPreviewData.map((item, i) => (
                                  <tr key={i}>
                                      <td className="p-3 pl-4">
                                          <div className="font-bold text-slate-800">{item.product_id}</div>
                                          <div className="text-xs text-slate-500 truncate w-48">{item.product_name}</div>
                                      </td>
                                      <td className="p-3 text-center text-slate-400 font-mono bg-slate-50">{item.old_qty}</td>
                                      <td className="p-3 text-center font-bold text-amber-700 bg-amber-50/50">{item.new_qty}</td>
                                      <td className={`p-3 text-right font-bold border-l ${item.diff > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                          {item.diff > 0 ? '+' : ''}{item.diff}
                                      </td>
                                      <td className="p-3 pr-4 text-xs text-slate-500 truncate max-w-[150px]">{item.reason}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>

                  <div className="p-4 border-t border-slate-200 bg-white flex justify-between items-center">
                      <div className="text-sm font-bold text-slate-600">ตรวจสอบและยืนยันการปรับยอด?</div>
                      <div className="flex gap-3">
                          <button onClick={() => {setIsBulkPreviewOpen(false); setBulkPreviewData([]);}} className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">Cancel</button>
                          <button onClick={handleConfirmBulkAdjust} disabled={isBulkSaving} className="px-8 py-2.5 rounded-xl bg-amber-500 text-white font-bold hover:bg-amber-600 flex items-center gap-2 shadow-lg shadow-amber-200 transition-colors">
                              {isBulkSaving ? 'Updating...' : <><CheckCircle size={18}/> Confirm & Save All</>}
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* --- STOCK CARD MODAL --- */}
      {stockCardItem && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl h-[600px] flex flex-col overflow-hidden">
                  <div className="p-5 border-b flex justify-between items-center bg-slate-50">
                      <div>
                          <h3 className="font-bold text-lg flex items-center gap-2 text-slate-800">
                              <History size={18} className="text-cyan-600"/> Stock Card History
                          </h3>
                          <div className="text-sm text-slate-500 flex items-center gap-2 mt-1">
                              <span className="font-mono bg-white border border-slate-200 px-1.5 py-0.5 rounded shadow-sm">{stockCardItem.product_id}</span>
                              <span className="font-medium text-slate-700">{stockCardItem.product_name}</span>
                          </div>
                      </div>
                      <button onClick={() => setStockCardItem(null)} className="text-slate-400 hover:text-rose-500 p-2 hover:bg-slate-200 rounded-full transition-colors"><X size={20}/></button>
                  </div>

                  <div className="flex-1 overflow-auto bg-white p-0">
                      <table className="w-full text-left text-sm border-collapse">
                          <thead className="bg-slate-100 text-slate-500 font-bold text-xs uppercase sticky top-0 shadow-sm z-10">
                              <tr>
                                  <th className="p-4 w-40">Date & Time</th>
                                  <th className="p-4 w-32">Doc No</th>
                                  <th className="p-4 w-24">Type</th>
                                  <th className="p-4">Remarks/Ref</th>
                                  <th className="p-4 text-right">Qty Change</th>
                                  <th className="p-4 text-right">Balance</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {historyLoading ? (
                                  <tr><td colSpan={6} className="p-10 text-center text-slate-400">Loading history...</td></tr>
                              ) : stockHistory.length === 0 ? (
                                  <tr><td colSpan={6} className="p-12 text-center text-slate-400 flex flex-col items-center"><FileText size={40} className="opacity-20 mb-3"/>No transaction history found</td></tr>
                              ) : stockHistory.map((h, i) => (
                                  <tr key={i} className="hover:bg-cyan-50/50 transition-colors">
                                      <td className="p-4 text-slate-600 text-xs">
                                          <div className="font-bold text-slate-700">{h.date.toLocaleDateString('th-TH')}</div>
                                          <div className="text-slate-400 mt-0.5">{h.date.toLocaleTimeString('th-TH', {hour:'2-digit', minute:'2-digit'})}</div>
                                      </td>
                                      <td className="p-4 font-mono text-cyan-600 text-[10px] font-bold truncate max-w-[120px]" title={h.docNo}>{h.docNo}</td>
                                      <td className="p-4">
                                          <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                                              h.type === 'IN' || h.type === 'RECEIPT' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                                              h.type === 'OUT' || h.type === 'TRANSFER' ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                                              'bg-amber-100 text-amber-700 border border-amber-200'
                                          }`}>{h.type}</span>
                                      </td>
                                      <td className="p-4 text-slate-700 text-xs font-medium truncate max-w-[150px]">{h.ref}</td>
                                      <td className={`p-4 text-right font-black text-base ${h.qtyChange > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                          {h.qtyChange > 0 ? '+' : ''}{h.qtyChange.toLocaleString()}
                                      </td>
                                      <td className="p-4 text-right font-bold text-slate-800">
                                          {h.balance.toLocaleString()}
                                      </td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}