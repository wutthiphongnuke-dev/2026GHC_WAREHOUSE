"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    History, Search, Download, Filter, Calendar, Activity, 
    ArrowUpDown, ChevronLeft, ChevronRight, FileText, Database, Snowflake, Store,
    Eye, X, AlertOctagon, GitBranch, MapPin, Receipt, Clock, Package, RefreshCw
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function TransactionLogPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [syncProgress, setSyncProgress] = useState<string>(''); 
  const [transactions, setTransactions] = useState<any[]>([]);
  const [branchMap, setBranchMap] = useState<Record<string, string>>({}); 

  // --- Filter & Search States ---
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  
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

  // --- Modal States ---
  const [receiptModal, setReceiptModal] = useState<any>(null); 
  const [journeyModal, setJourneyModal] = useState<any>(null); 
  const [journeyData, setJourneyData] = useState<any[]>([]);
  const [journeyLoading, setJourneyLoading] = useState(false);

  useEffect(() => {
      fetchData();
  }, [startDate, endDate]);

  // ==================== FETCH DATA (ระบบ Chunking ทะลวงขีดจำกัด) ====================
  const fetchData = async () => {
      setLoading(true);
      setSyncProgress('กำลังเตรียมข้อมูล...');
      try {
          const [prodRes, branchRes] = await Promise.all([
              supabase.from('master_products').select('product_id, product_name, category, base_uom, default_location'),
              supabase.from('master_branches').select('branch_id, branch_name')
          ]);

          const productMap: Record<string, any> = {};
          (prodRes.data || []).forEach(p => productMap[p.product_id] = p);

          const bMap: Record<string, string> = {};
          (branchRes.data || []).forEach(b => bMap[b.branch_id] = b.branch_name);
          setBranchMap(bMap);

          setSyncProgress('กำลังดึงประวัติการทำรายการ...');
          let allTransactions: any[] = [];
          let hasMore = true;
          let offset = 0;
          const limitSize = 1000; 

          while (hasMore) {
              const { data: tData, error: tErr } = await supabase
                  .from('transactions_log')
                  .select('*')
                  .gte('transaction_date', `${startDate}T00:00:00.000Z`)
                  .lte('transaction_date', `${endDate}T23:59:59.999Z`)
                  .order('transaction_date', { ascending: false })
                  .range(offset, offset + limitSize - 1);

              if (tErr) {
                  console.error("Error loading transactions:", tErr);
                  break;
              }

              if (tData && tData.length > 0) {
                  allTransactions = [...allTransactions, ...tData];
                  offset += limitSize;
                  setSyncProgress(`ดึงประวัติแล้ว ${allTransactions.length.toLocaleString()} รายการ...`);
                  
                  if (tData.length < limitSize) {
                      hasMore = false; 
                  }
              } else {
                  hasMore = false;
              }
          }

          setSyncProgress('กำลังประมวลผลข้อมูล...');
          
          // 🟢 1. Data Deduplication (กรองข้อมูลซ้ำที่เกิดจากการ Pagination)
          const uniqueTxMap = new Map();
          allTransactions.forEach(tx => {
              // ถ้ามี id นี้อยู่แล้ว มันจะถูกเขียนทับด้วยข้อมูลเดิม (แปลว่ากรองตัวซ้ำออกไป)
              if (tx.transaction_id) {
                  uniqueTxMap.set(tx.transaction_id, tx);
              }
          });
          const deduplicatedTransactions = Array.from(uniqueTxMap.values());

          const formattedData = deduplicatedTransactions.map(tx => {
              const anomalies = [];
              if (Number(tx.balance_after) < 0) anomalies.push("ยอดสต๊อกคงเหลือติดลบ (Negative Stock)");
              if (tx.transaction_type === 'OUTBOUND' && Math.abs(Number(tx.quantity_change)) >= 1000) anomalies.push("ยอดจ่ายออกสูงผิดปกติ (Volume Spike)");
              if (/(เสียหาย|แตก|เคลม|ชำรุด|พัง|หาย|ขาด|defect|damage|loss)/i.test(tx.remarks || '')) anomalies.push("ระบุคีย์เวิร์ดสินค้าชำรุด/สูญหาย");

              return {
                  ...tx,
                  product_name: productMap[tx.product_id]?.product_name || 'Unknown Product',
                  category: productMap[tx.product_id]?.category || 'Unknown',
                  base_uom: productMap[tx.product_id]?.base_uom || 'Unit', 
                  default_location: productMap[tx.product_id]?.default_location || '-', 
                  branch_name: bMap[tx.branch_id] || tx.branch_id || null, 
                  qty: Number(tx.quantity_change) || 0,
                  balance: Number(tx.balance_after) || 0,
                  dateObj: new Date(tx.transaction_date),
                  metadata: tx.metadata || {},
                  anomalies 
              };
          });

          setTransactions(formattedData);

      } catch (error: any) {
          console.error("Error fetching transactions:", error);
          alert("ไม่สามารถดึงข้อมูลประวัติได้: " + error.message);
      }
      setLoading(false);
      setSyncProgress(''); 
  };

  const filteredData = useMemo(() => {
      return transactions.filter(tx => {
          const txDate = tx.dateObj.toISOString().split('T')[0];
          if (startDate && txDate < startDate) return false;
          if (endDate && txDate > endDate) return false;
          if (typeFilter !== 'ALL' && tx.transaction_type !== typeFilter) return false;

          if (searchTerm) {
              const lowerSearch = searchTerm.toLowerCase();
              const matchId = (tx.transaction_id || '').toLowerCase().includes(lowerSearch);
              const matchProductId = (tx.product_id || '').toLowerCase().includes(lowerSearch);
              const matchProductName = (tx.product_name || '').toLowerCase().includes(lowerSearch);
              const matchRemarks = (tx.remarks || '').toLowerCase().includes(lowerSearch);
              const matchBranch = (tx.branch_name || '').toLowerCase().includes(lowerSearch); 
              
              if (!matchId && !matchProductId && !matchProductName && !matchRemarks && !matchBranch) {
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

  const openJourney = async (productInfo: any) => {
      setJourneyModal(productInfo);
      setJourneyLoading(true);
      try {
          const { data } = await supabase
              .from('transactions_log')
              .select('*')
              .eq('product_id', productInfo.product_id)
              .order('transaction_date', { ascending: false })
              .limit(50);
          setJourneyData(data || []);
      } catch (err) { console.error(err); }
      setJourneyLoading(false);
  };

  const handleExport = () => {
      if (filteredData.length === 0) return alert("ไม่มีข้อมูลสำหรับ Export");
      const exportPayload = filteredData.map(tx => {
          const meta = tx.metadata || {};
          let docRef = meta.po_number || meta.doc_no || '-';
          if (docRef === '-' && tx.remarks) {
              const match = tx.remarks.match(/(RCV-[\w-]+|PO-[\w-]+|TO-[\w-]+)/);
              if (match) docRef = match[0];
          }

          return {
              'วันที่ (Date)': tx.dateObj.toLocaleDateString('th-TH'),
              'เวลา (Time)': tx.dateObj.toLocaleTimeString('th-TH'),
              'รหัสอ้างอิง (Txn ID)': tx.transaction_id,
              'ประเภท (Type)': tx.transaction_type,
              'สาขาปลายทาง (Branch)': tx.branch_name || '-', 
              'รหัสสินค้า (SKU)': tx.product_id,
              'ชื่อสินค้า (Product Name)': tx.product_name,
              'จำนวน (Qty)': tx.qty,
              'ยอดคงเหลือ (Balance)': tx.balance,
              'หน่วย (Unit)': meta.unit || tx.base_uom,
              'เลขเอกสาร': docRef,
              'หมายเหตุ (Remarks)': tx.remarks || '-',
              'ความผิดปกติ (Anomaly)': tx.anomalies.join(', ') || 'ปกติ'
          };
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
  
  return (
    <div className="p-6 bg-slate-50 h-full flex flex-col overflow-hidden relative rounded-2xl selection:bg-indigo-100">
      
      {/* --- HEADER --- */}
      <div className="mb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4 flex-shrink-0">
        <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg shadow-indigo-200/50">
                    <History size={20} className="text-white" />
                </div>
                Audit Hub & Transactions Log
            </h1>
            <p className="text-slate-500 text-sm mt-2">ตรวจสอบประวัติการเคลื่อนไหว, ไทม์ไลน์สินค้า และระบบตรวจจับความผิดปกติอัจฉริยะ (AI-Anomaly)</p>
        </div>
        <div className="flex items-center gap-3">
            {syncProgress && (
                <span className="text-xs font-bold text-indigo-600 animate-pulse bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100">
                    {syncProgress}
                </span>
            )}
            
            <button onClick={fetchData} disabled={loading} className="px-4 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg text-sm font-bold shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                <RefreshCw size={16} className={loading ? "animate-spin text-indigo-500" : ""} /> Sync DB
            </button>
            <button onClick={handleExport} disabled={loading} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-md shadow-indigo-200 hover:bg-indigo-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
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
                  id="searchTransaction"
                  name="searchTransaction"
                  placeholder="ค้นหา: รหัส, ชื่อสินค้า, สาขา, เลขเอกสาร..." 
                  className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-inner bg-slate-50 focus:bg-white"
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)}
              />
          </div>

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
              <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200">
                  <Filter size={16} className="text-slate-400 ml-2"/>
                  <select 
                      id="typeFilter"
                      name="typeFilter"
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

              <div className="flex flex-wrap items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                  <Calendar size={16} className="text-slate-400 shrink-0"/>
                  <input 
                      type="date" 
                      id="startDate"
                      name="startDate"
                      className="bg-transparent border-none text-sm font-bold text-slate-700 outline-none cursor-pointer" 
                      value={startDate} 
                      max={endDate} 
                      onChange={e => setStartDate(e.target.value)} 
                  />
                  <span className="text-slate-400 font-bold">-</span>
                  <input 
                      type="date" 
                      id="endDate"
                      name="endDate"
                      className="bg-transparent border-none text-sm font-bold text-slate-700 outline-none cursor-pointer" 
                      value={endDate} 
                      min={startDate} 
                      max={new Date().toISOString().split('T')[0]} 
                      onChange={e => setEndDate(e.target.value)} 
                  />
              </div>
          </div>
      </div>

      {/* --- DATA TABLE --- */}
      <div className="bg-white rounded-b-2xl shadow-sm border-x border-b border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-slate-100 text-slate-500 font-bold border-b border-slate-200 text-xs uppercase sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th className="p-4 cursor-pointer hover:bg-slate-200 w-40" onClick={() => handleSort('transaction_date')}>Date & Time</th>
                        <th className="p-4 w-40">Type / Branch</th>
                        <th className="p-4">Product Info (Journey)</th>
                        <th className="p-4 text-right">Change</th>
                        <th className="p-4 text-right">Balance</th>
                        <th className="p-4 w-56">Remarks</th>
                        <th className="p-4 w-20 text-center">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan={7} className="p-12 text-center text-slate-400"><Activity size={32} className="animate-spin mx-auto mb-2 text-indigo-400"/>กำลังโหลดข้อมูลประวัติ...</td></tr>
                    ) : currentData.length === 0 ? (
                        <tr><td colSpan={7} className="p-12 text-center text-slate-400"><FileText size={48} className="opacity-20 mx-auto mb-3"/>ไม่พบข้อมูลที่ตรงกับเงื่อนไขการค้นหา</td></tr>
                    ) : currentData.map((tx, idx) => {
                        const hasAnomaly = tx.anomalies.length > 0;

                        return (
                        // 🟢 2. React Key Fix: รวบ id เข้ากับ index เพื่อการันตีไม่ให้ซ้ำกัน 100%
                        <tr key={`${tx.transaction_id}-${idx}`} className={`transition-colors group ${hasAnomaly ? 'bg-rose-50/50 hover:bg-rose-100/50' : 'hover:bg-slate-50'}`}>
                            <td className="p-4">
                                <div className="font-bold text-slate-700 flex items-center gap-2">
                                    {hasAnomaly && (
                                        <span title={tx.anomalies.join('\n')} className="flex items-center">
                                            <AlertOctagon size={16} className="text-rose-500 animate-pulse" />
                                        </span>
                                    )}
                                    {tx.dateObj.toLocaleDateString('th-TH')}
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5 ml-6">{tx.dateObj.toLocaleTimeString('th-TH')} น.</div>
                            </td>
                            <td className="p-4">
                                <span className={`text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider ${
                                    tx.transaction_type === 'INBOUND' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                                    tx.transaction_type === 'OUTBOUND' ? 'bg-rose-100 text-rose-700 border border-rose-200' :
                                    'bg-orange-100 text-orange-700 border border-orange-200'
                                }`}>
                                    {tx.transaction_type}
                                </span>
                                {tx.branch_name && tx.transaction_type === 'OUTBOUND' && (
                                    <div className="mt-1.5 flex items-center gap-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded w-max border border-indigo-100" title="สาขาปลายทาง">
                                        <Store size={10}/> {tx.branch_name}
                                    </div>
                                )}
                            </td>
                            <td className="p-4">
                                <div className="font-bold text-slate-800 truncate max-w-[200px]" title={tx.product_name}>{tx.product_name}</div>
                                <button onClick={() => openJourney(tx)} className="text-[10px] font-mono mt-1 flex items-center gap-1 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded border border-indigo-100 transition-colors" title="คลิกเพื่อดูเส้นทางสินค้านี้">
                                    <GitBranch size={10}/> {tx.product_id}
                                </button>
                            </td>
                            <td className={`p-4 text-right font-black text-base ${tx.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {tx.qty > 0 ? '+' : ''}{tx.qty.toLocaleString()}
                            </td>
                            <td className={`p-4 text-right font-bold border-x border-slate-100 ${hasAnomaly ? 'bg-rose-100/30 text-rose-700' : 'bg-slate-50/50 text-slate-600'}`}>
                                {tx.balance.toLocaleString()}
                            </td>
                            <td className="p-4 text-xs text-slate-600 truncate max-w-[250px]" title={tx.remarks}>
                                {hasAnomaly ? <span className="text-rose-600 font-bold">{tx.remarks || 'ตรวจพบความผิดปกติ'}</span> : (tx.remarks || '-')}
                            </td>
                            <td className="p-4 text-center">
                                <button onClick={() => setReceiptModal(tx)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors shadow-sm" title="View e-Receipt">
                                    <Eye size={16}/>
                                </button>
                            </td>
                        </tr>
                    )})}
                </tbody>
            </table>
        </div>
        
        {/* Pagination Footer */}
        <div className="p-3 border-t border-slate-200 bg-slate-50 flex justify-between items-center text-xs text-slate-500 flex-shrink-0">
            <div>Showing <b>{filteredData.length === 0 ? 0 : ((currentPage-1)*itemsPerPage)+1}</b> - <b>{Math.min(currentPage*itemsPerPage, filteredData.length)}</b> of <b>{filteredData.length}</b> records</div>
            <div className="flex items-center gap-2">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-30 transition-colors"><ChevronLeft size={16}/></button>
                <span className="font-bold text-slate-700 px-2">Page {currentPage} of {totalPages || 1}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="p-1.5 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-30 transition-colors"><ChevronRight size={16}/></button>
            </div>
        </div>
      </div>

      {/* ======================================================= */}
      {/* 🧾 MODAL: DIGITAL E-RECEIPT */}
      {/* ======================================================= */}
      {receiptModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative animate-fade-in">
                  <div className="absolute top-0 left-0 right-0 h-3 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-indigo-600 opacity-20"></div>
                  
                  <div className="p-6 pt-8 bg-slate-50 border-b border-dashed border-slate-300 flex flex-col items-center text-center">
                      <div className={`w-12 h-12 rounded-full mb-3 flex items-center justify-center ${receiptModal.transaction_type === 'INBOUND' ? 'bg-emerald-100 text-emerald-600' : receiptModal.transaction_type === 'OUTBOUND' ? 'bg-rose-100 text-rose-600' : 'bg-orange-100 text-orange-600'}`}>
                          <Receipt size={24}/>
                      </div>
                      <h3 className="font-black text-xl text-slate-800 tracking-widest uppercase">Transaction Slip</h3>
                      <div className="text-xs text-slate-500 font-mono mt-1">{receiptModal.transaction_id}</div>
                  </div>

                  <div className="p-6 space-y-4 text-sm bg-white">
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Date & Time</span>
                          <span className="font-bold text-slate-800">{receiptModal.dateObj.toLocaleString('th-TH')}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Type</span>
                          <span className="font-black text-indigo-600">{receiptModal.transaction_type}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Product</span>
                          <div className="text-right">
                              <div className="font-bold text-slate-800 truncate max-w-[200px]">{receiptModal.product_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{receiptModal.product_id}</div>
                          </div>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Quantity</span>
                          <span className={`font-black text-lg ${receiptModal.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{receiptModal.qty > 0 ? '+' : ''}{receiptModal.qty} {receiptModal.base_uom}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Balance After</span>
                          <span className="font-bold text-slate-800">{receiptModal.balance}</span>
                      </div>
                      {receiptModal.branch_name && (
                          <div className="flex justify-between border-b border-slate-100 pb-2">
                              <span className="text-slate-500">Branch</span>
                              <span className="font-bold text-indigo-600 flex items-center gap-1"><Store size={14}/> {receiptModal.branch_name}</span>
                          </div>
                      )}

                      {Object.keys(receiptModal.metadata || {}).length > 0 && (
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mt-4">
                              <div className="text-xs font-bold text-slate-500 uppercase mb-2 flex items-center gap-1"><Database size={12}/> Extra Metadata</div>
                              {Object.entries(receiptModal.metadata).map(([key, val]) => (
                                  <div key={key} className="flex justify-between text-xs mb-1">
                                      <span className="text-slate-400 capitalize">{key.replace('_', ' ')}</span>
                                      <span className="font-mono text-slate-700">{String(val)}</span>
                                  </div>
                              ))}
                          </div>
                      )}

                      {receiptModal.remarks && (
                          <div className="bg-slate-100 p-3 rounded-lg text-xs italic text-slate-600">
                              "{receiptModal.remarks}"
                          </div>
                      )}
                  </div>
                  <div className="p-4 bg-slate-50 border-t border-slate-200">
                      <button onClick={()=>setReceiptModal(null)} className="w-full py-2.5 bg-slate-800 text-white rounded-xl font-bold hover:bg-black transition-colors">Close Slip</button>
                  </div>
              </div>
          </div>
      )}

      {/* ======================================================= */}
      {/* 🗺️ MODAL: PRODUCT JOURNEY */}
      {/* ======================================================= */}
      {journeyModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-fade-in">
                  <div className="p-5 border-b bg-indigo-50 flex justify-between items-center">
                      <div>
                          <h3 className="font-bold text-indigo-900 text-lg flex items-center gap-2"><GitBranch size={20}/> Product Journey Timeline</h3>
                          <div className="flex items-center gap-2 mt-1">
                              <span className="bg-white border border-indigo-200 text-indigo-700 text-[10px] font-mono px-2 py-0.5 rounded font-bold">{journeyModal.product_id}</span>
                              <span className="text-sm font-bold text-indigo-800">{journeyModal.product_name}</span>
                          </div>
                      </div>
                      <button onClick={()=>setJourneyModal(null)} className="text-indigo-400 hover:text-rose-500 p-2 bg-white rounded-full shadow-sm"><X size={20}/></button>
                  </div>

                  <div className="flex-1 overflow-auto p-6 bg-slate-50 custom-scrollbar">
                      {journeyLoading ? (
                          <div className="flex flex-col items-center justify-center h-40 text-indigo-500"><Activity className="animate-spin mb-2"/><span className="text-sm font-bold tracking-widest">Tracing Data...</span></div>
                      ) : (
                          <div className="relative border-l-2 border-indigo-200 ml-4 space-y-6 pb-4">
                              {journeyData.map((j, i) => {
                                  const isOut = j.transaction_type === 'OUTBOUND';
                                  const isIn = j.transaction_type === 'INBOUND';
                                  const bName = branchMap[j.branch_id] || j.branch_id;
                                  
                                  return (
                                  <div key={i} className="relative pl-6 group">
                                      <div className={`absolute -left-[9px] top-1 w-4 h-4 rounded-full border-2 border-white ${isIn ? 'bg-emerald-500' : isOut ? 'bg-rose-500' : 'bg-amber-500'} shadow-sm group-hover:scale-125 transition-transform`}></div>
                                      
                                      <div className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                                          <div className="flex justify-between items-start mb-2">
                                              <div className="flex items-center gap-2">
                                                  <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase ${isIn ? 'bg-emerald-100 text-emerald-700' : isOut ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                                      {j.transaction_type}
                                                  </span>
                                                  <span className="text-xs text-slate-400 flex items-center gap-1 font-mono"><Clock size={12}/> {new Date(j.transaction_date).toLocaleString('th-TH')}</span>
                                              </div>
                                              <div className={`font-black text-lg ${Number(j.quantity_change) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                  {Number(j.quantity_change) > 0 ? '+' : ''}{j.quantity_change}
                                              </div>
                                          </div>
                                          
                                          <div className="text-sm text-slate-700 font-medium mb-2">
                                              {isIn ? "รับสินค้าเข้าคลัง" : isOut ? `จัดส่งไปยังสาขา: ${bName || 'ไม่ระบุ'}` : "ปรับปรุงยอดสต๊อก / Cycle Count"}
                                          </div>

                                          <div className="flex justify-between items-end mt-3 pt-3 border-t border-slate-100 border-dashed">
                                              <div className="text-[10px] text-slate-400 truncate max-w-[250px]" title={j.remarks}>
                                                  📝 {j.remarks || 'ไม่มีหมายเหตุ'}
                                              </div>
                                              <div className="text-xs font-bold text-slate-800 bg-slate-100 px-2 py-1 rounded-lg">
                                                  Balance: {j.balance_after}
                                              </div>
                                          </div>
                                      </div>
                                  </div>
                              )})}
                              <div className="relative pl-6">
                                  <div className="absolute -left-[7px] top-1 w-3 h-3 bg-slate-300 rounded-full border-2 border-white"></div>
                                  <div className="text-xs font-bold text-slate-400">จุดเริ่มต้นการบันทึกประวัติ (End of History)</div>
                              </div>
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}