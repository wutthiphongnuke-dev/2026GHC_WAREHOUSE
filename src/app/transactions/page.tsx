"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    History, Search, Download, Filter, Calendar, Activity, 
    ArrowUpDown, ChevronLeft, ChevronRight, FileText, Database, Snowflake
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function TransactionLogPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [transactions, setTransactions] = useState<any[]>([]);

  // --- Filter & Search States ---
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  
  // Default Date Range (ย้อนหลัง 30 วัน)
  const [startDate, setStartDate] = useState(() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // --- Sort & Pagination States ---
  const [sortConfig, setSortConfig] = useState({ key: 'transaction_date', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  useEffect(() => {
      fetchData();
  }, []);

  const fetchData = async () => {
      setLoading(true);
      try {
          // 1. ดึง Master Products เพื่อเอามา Map ข้อมูลพื้นฐาน
          const { data: prodData } = await supabase.from('master_products').select('product_id, product_name, category, base_uom, default_location');
          const productMap: Record<string, any> = {};
          (prodData || []).forEach(p => productMap[p.product_id] = p);

          // 2. ดึง Transaction Log (🟢 อัปเดต: ให้ดึงข้อมูลจาก Database ตามช่วงวันที่เลือกไว้เลย)
          const { data: txData, error } = await supabase
              .from('transactions_log')
              .select('*')
              .gte('transaction_date', `${startDate}T00:00:00.000Z`) // ตั้งแต่วันที่
              .lte('transaction_date', `${endDate}T23:59:59.999Z`)   // ถึงวันที่
              .order('transaction_date', { ascending: false })
              .limit(5000); // ขยาย Limit เผื่อไว้ให้ดึงได้สูงสุด 5,000 รายการต่อการค้นหา 1 ครั้ง

          if (error) throw error;

          // 3. ประกอบร่างข้อมูล
          const formattedData = (txData || []).map(tx => ({
              ...tx,
              product_name: productMap[tx.product_id]?.product_name || 'Unknown Product',
              category: productMap[tx.product_id]?.category || 'Unknown',
              base_uom: productMap[tx.product_id]?.base_uom || 'Unit', 
              default_location: productMap[tx.product_id]?.default_location || '-', 
              qty: Number(tx.quantity_change) || 0,
              balance: Number(tx.balance_after) || 0,
              dateObj: new Date(tx.transaction_date),
              metadata: tx.metadata || {} 
          }));

          setTransactions(formattedData);

      } catch (error: any) {
          console.error("Error fetching transactions:", error);
          alert("ไม่สามารถดึงข้อมูลประวัติได้: " + error.message);
      }
      setLoading(false);
  };

  // 🟢 อัปเดต: สั่งให้โหลดข้อมูลจาก DB ใหม่ทุกครั้งที่เปลี่ยนวันที่
  useEffect(() => {
      fetchData();
  }, [startDate, endDate]);

  // --- 🔍 DEEP SEARCH & FILTER LOGIC ---
  const filteredData = useMemo(() => {
      return transactions.filter(tx => {
          const txDate = tx.dateObj.toISOString().split('T')[0];
          if (startDate && txDate < startDate) return false;
          if (endDate && txDate > endDate) return false;
          if (typeFilter !== 'ALL' && tx.transaction_type !== typeFilter) return false;

          // 🟢 รองรับการค้นหาตามเลขเอกสาร PO, TO (ค้นหาจาก remarks และ metadata)
          if (searchTerm) {
              const lowerSearch = searchTerm.toLowerCase();
              const matchId = (tx.transaction_id || '').toLowerCase().includes(lowerSearch);
              const matchProductId = (tx.product_id || '').toLowerCase().includes(lowerSearch);
              const matchProductName = (tx.product_name || '').toLowerCase().includes(lowerSearch);
              const matchRemarks = (tx.remarks || '').toLowerCase().includes(lowerSearch);
              const matchMetadata = JSON.stringify(tx.metadata || {}).toLowerCase().includes(lowerSearch);
              
              if (!matchId && !matchProductId && !matchProductName && !matchRemarks && !matchMetadata) {
                  return false;
              }
          }
          return true;
      }).sort((a, b) => {
          const key = sortConfig.key as keyof typeof a;
          let valA = a[key];
          let valB = b[key];
          
          if (key === 'transaction_date') {
              valA = a.dateObj.getTime();
              valB = b.dateObj.getTime();
          }

          if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  }, [transactions, searchTerm, typeFilter, startDate, endDate, sortConfig]);

  // --- 📄 EXPORT DATA TO EXCEL (🟢 อัปเกรดใหม่ ตาม Requirement) ---
  const handleExport = () => {
      if (filteredData.length === 0) return alert("ไม่มีข้อมูลสำหรับ Export");
      
      const exportPayload = filteredData.map(tx => {
          const meta = tx.metadata || {};

          // 🟢 พยายามดึงเลขเอกสาร หรือ PO จาก metadata หรือหมายเหตุ (Remarks)
          let docRef = meta.po_number || meta.doc_no || '-';
          if (docRef === '-' && tx.remarks) {
              // ตรวจจับแพทเทิร์น RCV-xxx, PO-xxx, TO-xxx ในช่องหมายเหตุ
              const match = tx.remarks.match(/(RCV-[\w-]+|PO-[\w-]+|TO-[\w-]+)/);
              if (match) docRef = match[0];
          }

          // ข้อมูลพื้นฐานที่ทุก Type ต้องมี
          const row: any = {
              'วันที่ (Date)': tx.dateObj.toLocaleDateString('th-TH'),
              'เวลา (Time)': tx.dateObj.toLocaleTimeString('th-TH'),
              'รหัสอ้างอิง (Txn ID)': tx.transaction_id,
              'เลขเอกสาร / PO': docRef, // 🟢 เพิ่มเลข PO / เอกสารอ้างอิง
              'ประเภท (Type)': tx.transaction_type,
              'รหัสสินค้า (SKU)': tx.product_id,
              'ชื่อสินค้า (Product Name)': tx.product_name,
              'หมวดหมู่ (Category)': tx.category,
              'จำนวนการเปลี่ยนแปลง (Qty Change)': tx.qty,
              'ยอดคงเหลือ (Balance)': tx.balance,
              'หน่วย (Unit)': meta.unit || tx.base_uom, // 🟢 เพิ่มหน่วยจ่าย/รับ
              'ตำแหน่ง (Location)': meta.location || tx.default_location, // 🟢 เพิ่ม Location
              'MFG Date': meta.mfg_date || '-', // 🟢 เพิ่ม MFG
              'EXP Date': meta.exp_date || '-', // 🟢 เพิ่ม EXP
          };

          // 🟢 แทรกคอลัมน์พิเศษสำหรับ INBOUND
          if (tx.transaction_type === 'INBOUND') {
              const orderedQty = Number(meta.ordered_qty) || 0;
              const receivedQty = tx.qty;
              const diff = receivedQty - orderedQty; // ขาดคือติดลบ, เกินคือบวก

              row['กำหนดส่ง (Scheduled)'] = meta.scheduled_date ? new Date(meta.scheduled_date).toLocaleDateString('th-TH') : '-';
              row['สถานะเวลา (Time Status)'] = meta.time_status || '-'; 
              row['อุณหภูมิรถ (Vehicle Temp °C)'] = meta.vehicle_temp ? `${meta.vehicle_temp}` : '-';
              row['อุณหภูมิสินค้า (Product Temp °C)'] = meta.product_temp ? `${meta.product_temp}` : '-';
              row['ยอดสั่งซื้อ (Ordered Qty)'] = orderedQty > 0 ? orderedQty : '-';
              row['ยอดรับจริง (Received Qty)'] = receivedQty;
              
              // 🟢 Discrepancy (รายงานเป็นแค่ตัวเลข เพื่อให้ทำ Sum ใน Excel ได้)
              row['ค้างส่ง/ส่งเกิน (Discrepancy)'] = orderedQty > 0 ? diff : 0; 

          } else {
              // สำหรับ OUTBOUND/ADJUST ปล่อยว่างไว้เพื่อรักษาโครงสร้าง Column
              row['กำหนดส่ง (Scheduled)'] = '-';
              row['สถานะเวลา (Time Status)'] = '-';
              row['อุณหภูมิรถ (Vehicle Temp °C)'] = '-';
              row['อุณหภูมิสินค้า (Product Temp °C)'] = '-';
              row['ยอดสั่งซื้อ (Ordered Qty)'] = '-';
              row['ยอดรับจริง (Received Qty)'] = '-';
              row['ค้างส่ง/ส่งเกิน (Discrepancy)'] = '-';
          }

          row['หมายเหตุ (Remarks)'] = tx.remarks || '-';
          return row;
      });

      const ws = XLSX.utils.json_to_sheet(exportPayload);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transaction_Log");
      XLSX.writeFile(wb, `Transaction_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleSort = (key: string) => {
      let direction = 'asc';
      if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
      setSortConfig({ key, direction });
  };

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const currentData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  useEffect(() => { setCurrentPage(1); }, [searchTerm, typeFilter, startDate, endDate]);

  return (
    <div className="p-6 bg-slate-50 h-full flex flex-col overflow-hidden relative rounded-2xl">
      
      {/* --- HEADER --- */}
      <div className="mb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4 flex-shrink-0">
        <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-200/50">
                    <History size={20} className="text-white" />
                </div>
                Transaction Log Report
            </h1>
            <p className="text-slate-500 text-sm mt-2">ตรวจสอบประวัติการเคลื่อนไหวของสต๊อกสินค้า และข้อมูล QC ตอนรับเข้า</p>
        </div>
        <div className="flex gap-2">
            <button onClick={fetchData} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2">
                <Database size={16}/> Sync DB
            </button>
            <button onClick={handleExport} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-colors flex items-center gap-2">
                <Download size={16}/> Export Excel
            </button>
        </div>
      </div>

      {/* --- FILTER CONTROL PANEL --- */}
      <div className="bg-white p-4 rounded-t-2xl border border-slate-200 shadow-sm flex flex-col lg:flex-row gap-4 items-center justify-between flex-shrink-0 z-20 relative">
          <div className="relative flex-1 w-full lg:max-w-md">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
              <input 
                  type="text" 
                  placeholder="Deep Search: รหัส, ชื่อสินค้า, เลข PO/เอกสาร..." 
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-inner bg-slate-50 focus:bg-white"
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)}
              />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
                  <Filter size={16} className="text-slate-400 ml-2"/>
                  <select 
                      className="bg-transparent border-none text-sm font-bold text-slate-700 outline-none cursor-pointer py-1 pr-2"
                      value={typeFilter} 
                      onChange={e => setTypeFilter(e.target.value)}
                  >
                      <option value="ALL">All Types</option>
                      <option value="INBOUND">Inbound (รับเข้า)</option>
                      <option value="OUTBOUND">Outbound (จ่ายออก)</option>
                      <option value="ADJUST">Adjust (ปรับยอด)</option>
                  </select>
              </div>

              <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <Calendar size={16} className="text-slate-400"/>
                  <input type="date" className="bg-transparent border-none text-sm font-bold text-slate-700 outline-none" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  <span className="text-slate-400">-</span>
                  <input type="date" className="bg-transparent border-none text-sm font-bold text-slate-700 outline-none" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
          </div>
      </div>

      {/* --- DATA TABLE --- */}
      <div className="bg-white rounded-b-2xl shadow-sm border-x border-b border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-500 font-bold border-b border-slate-200 text-xs uppercase sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th className="p-4 cursor-pointer hover:bg-slate-200 transition-colors w-40" onClick={() => handleSort('transaction_date')}>
                            Date & Time <ArrowUpDown size={12} className="inline ml-1 opacity-50"/>
                        </th>
                        <th className="p-4 w-32">Txn ID</th>
                        <th className="p-4 cursor-pointer hover:bg-slate-200 transition-colors w-28" onClick={() => handleSort('transaction_type')}>
                            Type <ArrowUpDown size={12} className="inline ml-1 opacity-50"/>
                        </th>
                        <th className="p-4">Product Info</th>
                        <th className="p-4 text-right cursor-pointer hover:bg-slate-200 transition-colors" onClick={() => handleSort('qty')}>
                            Change <ArrowUpDown size={12} className="inline ml-1 opacity-50"/>
                        </th>
                        <th className="p-4 text-right">Balance</th>
                        <th className="p-4 w-64">Remarks / Ref</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan={7} className="p-12 text-center text-slate-400"><Activity size={32} className="animate-spin mx-auto mb-2 text-indigo-400"/>กำลังโหลดข้อมูลประวัติ...</td></tr>
                    ) : currentData.length === 0 ? (
                        <tr><td colSpan={7} className="p-12 text-center text-slate-400"><FileText size={48} className="opacity-20 mx-auto mb-3"/>ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา</td></tr>
                    ) : currentData.map((tx, idx) => (
                        <tr key={tx.transaction_id || idx} className="hover:bg-slate-50 transition-colors group">
                            <td className="p-4">
                                <div className="font-bold text-slate-700">{tx.dateObj.toLocaleDateString('th-TH')}</div>
                                <div className="text-xs text-slate-400 mt-0.5">{tx.dateObj.toLocaleTimeString('th-TH')} น.</div>
                            </td>
                            <td className="p-4 font-mono text-[10px] text-slate-400 truncate max-w-[120px]" title={tx.transaction_id}>
                                {tx.transaction_id?.split('-')[0]}...
                            </td>
                            <td className="p-4">
                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider ${
                                    tx.transaction_type === 'INBOUND' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                                    tx.transaction_type === 'OUTBOUND' ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                                    'bg-orange-100 text-orange-700 border border-orange-200'
                                }`}>
                                    {tx.transaction_type}
                                </span>
                            </td>
                            <td className="p-4">
                                <div className="font-bold text-slate-800">{tx.product_name}</div>
                                <div className="text-[10px] text-slate-500 font-mono mt-0.5">{tx.product_id}</div>
                            </td>
                            <td className={`p-4 text-right font-black text-base ${tx.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {tx.qty > 0 ? '+' : ''}{tx.qty.toLocaleString()}
                            </td>
                            <td className="p-4 text-right font-bold text-slate-600 bg-slate-50/50 border-x border-slate-100">
                                {tx.balance.toLocaleString()}
                            </td>
                            <td className="p-4 text-xs text-slate-600 truncate max-w-[250px]" title={tx.remarks}>
                                {tx.remarks || '-'}
                                {tx.transaction_type === 'INBOUND' && tx.metadata?.vehicle_temp && (
                                    <span className="ml-2 inline-flex items-center gap-1 bg-cyan-50 text-cyan-600 px-1.5 py-0.5 rounded text-[9px] font-bold border border-cyan-100">
                                        <Snowflake size={10}/> QC Logged
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
        
        {/* Pagination Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between items-center text-xs text-slate-500 flex-shrink-0">
            <div>
                Showing <b>{filteredData.length === 0 ? 0 : ((currentPage-1)*itemsPerPage)+1}</b> - <b>{Math.min(currentPage*itemsPerPage, filteredData.length)}</b> of <b>{filteredData.length}</b> records
            </div>
            <div className="flex items-center gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white transition-colors"><ChevronLeft size={16}/></button>
                <span className="font-bold text-slate-700 px-2">Page {currentPage} of {totalPages || 1}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="p-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white transition-colors"><ChevronRight size={16}/></button>
            </div>
        </div>
      </div>
    </div>
  );
}