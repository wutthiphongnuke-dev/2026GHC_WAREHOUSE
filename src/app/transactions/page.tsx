"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    History, Search, Download, Filter, Calendar, Activity, 
    ChevronLeft, ChevronRight, FileText, Database, Store,
    X, AlertOctagon, GitBranch, MapPin, Receipt, Clock, RefreshCw, FileCheck
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function TransactionLogPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [syncProgress, setSyncProgress] = useState<string>(''); 
  const [transactions, setTransactions] = useState<any[]>([]);
  const [branchMap, setBranchMap] = useState<Record<string, string>>({}); 

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  
  const [startDate, setStartDate] = useState(() => {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  });
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }));

  const [sortConfig, setSortConfig] = useState({ key: 'transaction_date', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  const [receiptModal, setReceiptModal] = useState<any>(null); 
  const [journeyModal, setJourneyModal] = useState<any>(null); 
  const [journeyData, setJourneyData] = useState<any[]>([]);
  const [journeyLoading, setJourneyLoading] = useState(false);

  useEffect(() => {
      const handler = setTimeout(() => {
          setDebouncedSearch(searchTerm);
      }, 300);
      return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
      fetchData();
  }, [startDate, endDate]);

  const fetchData = async () => {
      setLoading(true);
      setSyncProgress('กำลังเตรียมข้อมูล...');
      try {
          const [prodRes, branchRes] = await Promise.all([
              supabase.from('master_products').select('product_id, product_name, category, base_uom'),
              supabase.from('master_branches').select('branch_id, branch_name')
          ]);

          const productMap: Record<string, any> = {};
          (prodRes.data || []).forEach(p => productMap[p.product_id] = p);

          const bMap: Record<string, string> = {};
          (branchRes.data || []).forEach(b => bMap[b.branch_id] = b.branch_name);
          setBranchMap(bMap);

          setSyncProgress('กำลังดึงข้อมูลประวัติ...');
          let allTransactions: any[] = [];
          let hasMore = true;
          let offset = 0;
          const limitSize = 1500; 

          while (hasMore) {
              const { data: tData, error: tErr } = await supabase
                  .from('transactions_log')
                  .select('*')
                  .gte('transaction_date', `${startDate}T00:00:00.000Z`)
                  .lte('transaction_date', `${endDate}T23:59:59.999Z`)
                  .order('transaction_date', { ascending: false })
                  .range(offset, offset + limitSize - 1);

              if (tErr) break;

              if (tData && tData.length > 0) {
                  allTransactions = [...allTransactions, ...tData];
                  offset += limitSize;
                  setSyncProgress(`ดึงข้อมูลแล้ว ${allTransactions.length.toLocaleString()} รายการ...`);
                  if (tData.length < limitSize) hasMore = false; 
              } else {
                  hasMore = false;
              }
          }

          setSyncProgress('กำลังประมวลผล (Processing)...');
          
          const uniqueTxMap = new Map();
          allTransactions.forEach(tx => {
              if (tx.transaction_id) uniqueTxMap.set(tx.transaction_id, tx);
          });
          const deduplicatedTransactions = Array.from(uniqueTxMap.values());

          const rcvDocs = new Set<string>();
          deduplicatedTransactions.forEach(tx => {
              if (tx.transaction_type === 'INBOUND') {
                  let docRef = tx.metadata?.doc_no;
                  if (!docRef && tx.remarks) {
                      const match = tx.remarks.match(/(RCV-[\w-]+)/);
                      if (match) docRef = match[0];
                  }
                  if (docRef && !tx.metadata?.po_number) rcvDocs.add(docRef);
              }
          });

          const rcvToPoMap: Record<string, string> = {};
          if (rcvDocs.size > 0) {
              const { data: receipts } = await supabase.from('inbound_receipts').select('document_reference, po_number').in('document_reference', Array.from(rcvDocs));
              receipts?.forEach(r => {
                  if (r.document_reference && r.po_number) rcvToPoMap[r.document_reference] = r.po_number;
              });
          }

          const formattedData = deduplicatedTransactions.map(tx => {
              const meta = tx.metadata || {};
              let docRef = meta.doc_no || '-';
              if (docRef === '-' && tx.remarks) {
                  const match = tx.remarks.match(/(RCV-[\w-]+|PO-[\w-]+|TO-[\w-]+)/);
                  if (match) docRef = match[0];
              }

              let poNumber = meta.po_number || '-';
              if (poNumber === '-' && docRef.startsWith('RCV') && rcvToPoMap[docRef]) {
                  poNumber = rcvToPoMap[docRef];
              }

              const anomalies = [];
              if (Number(tx.balance_after) < 0) anomalies.push("Negative Stock");
              if (/(เสียหาย|แตก|เคลม|ชำรุด|พัง|หาย|ขาด)/i.test(tx.remarks || '')) anomalies.push("Damage/Loss");

              const dateObj = new Date(tx.transaction_date);

              return {
                  ...tx,
                  product_name: productMap[tx.product_id]?.product_name || 'Unknown',
                  base_uom: productMap[tx.product_id]?.base_uom || 'Unit', 
                  branch_name: bMap[tx.branch_id] || tx.branch_id || null, 
                  qty: Number(tx.quantity_change) || 0,
                  balance: Number(tx.balance_after) || 0,
                  dateObj,
                  txDateStr: dateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
                  timestamp: dateObj.getTime(),
                  docRef,
                  poNumber,
                  orderedQty: meta.ordered_qty || 0, 
                  timingStatus: meta.time_status || '-', 
                  metadata: meta,
                  anomalies 
              };
          });

          setTransactions(formattedData);
      } catch (error: any) {
          alert("ไม่สามารถดึงข้อมูลได้: " + error.message);
      }
      setLoading(false);
      setSyncProgress(''); 
  };

  const filteredData = useMemo(() => {
      let result = transactions;

      result = result.filter(tx => {
          if (startDate && tx.txDateStr < startDate) return false;
          if (endDate && tx.txDateStr > endDate) return false;
          if (typeFilter !== 'ALL' && tx.transaction_type !== typeFilter) return false;
          return true;
      });

      if (debouncedSearch) {
          const lowerSearch = debouncedSearch.toLowerCase();
          result = result.filter(tx => 
              (tx.product_id || '').toLowerCase().includes(lowerSearch) ||
              (tx.product_name || '').toLowerCase().includes(lowerSearch) ||
              (tx.poNumber || '').toLowerCase().includes(lowerSearch) ||
              (tx.docRef || '').toLowerCase().includes(lowerSearch) ||
              (tx.branch_name || '').toLowerCase().includes(lowerSearch) ||
              (tx.transaction_id || '').toLowerCase().includes(lowerSearch)
          );
      }

      return result.sort((a, b) => {
          if (sortConfig.key === 'transaction_date') {
              return sortConfig.direction === 'asc' ? a.timestamp - b.timestamp : b.timestamp - a.timestamp;
          }
          
          let valA = a[sortConfig.key];
          let valB = b[sortConfig.key];
          if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  }, [transactions, debouncedSearch, typeFilter, startDate, endDate, sortConfig]);

  const openJourney = async (productInfo: any) => {
      setJourneyModal(productInfo);
      setJourneyLoading(true);
      try {
          const { data } = await supabase.from('transactions_log').select('*').eq('product_id', productInfo.product_id).order('transaction_date', { ascending: false }).limit(50);
          setJourneyData(data || []);
      } catch (err) { console.error(err); }
      setJourneyLoading(false);
  };

  const handleExport = () => {
      if (filteredData.length === 0) return alert("ไม่มีข้อมูลสำหรับ Export");
      
      const exportPayload = filteredData.map(tx => {
          const refDocument = tx.poNumber !== '-' ? tx.poNumber : (tx.docRef !== '-' ? tx.docRef : '');
          const rowData: any = {
              'วันที่ (Date)': tx.dateObj.toLocaleDateString('th-TH'),
              'เวลา (Time)': tx.dateObj.toLocaleTimeString('th-TH'),
              'ประเภท (Type)': tx.transaction_type,
              'PO Number / Doc Ref': refDocument,
              'สาขา (Branch)': tx.branch_name || '-', 
              'รหัสสินค้า (SKU)': tx.product_id,
              'ชื่อสินค้า (Product Name)': tx.product_name,
              'หน่วย (Base Unit)': tx.base_uom,
          };

          if (tx.transaction_type === 'INBOUND') {
              rowData['ยอดสั่งซื้อ (Ordered Qty)'] = tx.orderedQty || tx.qty; 
              rowData['ยอดรับเข้าจริง (Received Qty)'] = tx.qty;
              rowData['สถานะการส่ง (Timing)'] = tx.timingStatus;
          } else {
              rowData['ยอดจ่ายออก/ปรับ (Qty Change)'] = tx.qty;
          }

          rowData['ยอดคงเหลือ (Balance)'] = tx.balance;
          rowData['หมายเหตุ (Remarks)'] = tx.remarks || '-';
          rowData['สถานะข้อมูล (Anomaly)'] = tx.anomalies.join(', ') || 'ปกติ';

          return rowData;
      });

      const ws = XLSX.utils.json_to_sheet(exportPayload);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Transactions");
      XLSX.writeFile(wb, `WMS_Transactions_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  const handleSort = (key: string) => {
      setSortConfig(prev => ({
          key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
      }));
  };

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const currentData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  return (
    <div className="p-4 md:p-6 bg-slate-50 h-full flex flex-col overflow-hidden relative rounded-2xl font-sans">
      
      <div className="mb-4 flex flex-col md:flex-row md:justify-between md:items-end gap-4 flex-shrink-0">
        <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2">
                <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg text-white">
                    <History size={20} />
                </div>
                Transactions Log
            </h1>
            <p className="text-slate-500 text-xs md:text-sm mt-1">ประวัติความเคลื่อนไหวสต๊อกทั้งหมด</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            {syncProgress && <span className="text-xs font-bold text-indigo-600 animate-pulse bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100">{syncProgress}</span>}
            <button onClick={fetchData} disabled={loading} className="px-3 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg text-xs md:text-sm font-bold shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCw size={14} className={loading ? "animate-spin text-indigo-500" : ""} /> Sync
            </button>
            <button onClick={handleExport} disabled={loading} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs md:text-sm font-bold shadow-md hover:bg-emerald-700 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                <Download size={14}/> Export
            </button>
        </div>
      </div>

      <div className="bg-white p-3 rounded-t-2xl border border-slate-200 shadow-sm flex flex-col xl:flex-row gap-3 items-center justify-between flex-shrink-0 z-20 relative">
          
          <div className="relative flex-1 w-full xl:max-w-lg">
              <Search className="absolute left-3 top-2.5 text-blue-400" size={16}/>
              <input 
                  type="text" 
                  placeholder="ค้นหา: รหัส, ชื่อ, สาขา, PO..." 
                  className="w-full pl-9 pr-3 py-2 border-2 border-blue-50 rounded-xl text-sm font-medium outline-none focus:ring-0 focus:border-blue-400 transition-colors bg-slate-50 focus:bg-white"
                  value={searchTerm} 
                  onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
              />
          </div>

          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
              <div className="flex items-center gap-1.5 bg-slate-50 p-1 rounded-xl border border-slate-200">
                  <Filter size={14} className="text-slate-400 ml-2"/>
                  <select 
                      className="bg-transparent border-none text-xs md:text-sm font-bold text-slate-700 outline-none cursor-pointer py-1 pr-1"
                      value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setCurrentPage(1); }}
                  >
                      <option value="ALL">ทั้งหมด (All)</option>
                      <option value="INBOUND">รับเข้า (IN)</option>
                      <option value="OUTBOUND">จ่ายออก (OUT)</option>
                      <option value="ADJUST">ปรับยอด (ADJ)</option>
                  </select>
              </div>

              <div className="flex items-center gap-2 bg-slate-50 px-2 py-1 rounded-xl border border-slate-200">
                  <Calendar size={14} className="text-slate-400 shrink-0"/>
                  <input type="date" className="bg-transparent border-none text-xs font-bold text-slate-700 outline-none cursor-pointer" value={startDate} onChange={e => setStartDate(e.target.value)} />
                  <span className="text-slate-300">-</span>
                  <input type="date" className="bg-transparent border-none text-xs font-bold text-slate-700 outline-none cursor-pointer" value={endDate} onChange={e => setEndDate(e.target.value)} />
              </div>
          </div>
      </div>

      <div className="bg-white rounded-b-2xl shadow-sm border-x border-b border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-left text-sm whitespace-nowrap min-w-[900px]">
                <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 text-xs uppercase sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th className="p-3 cursor-pointer hover:bg-slate-200 w-36" onClick={() => handleSort('transaction_date')}>Date & Time</th>
                        <th className="p-3 w-40">Doc Ref</th>
                        <th className="p-3 min-w-[250px]">Product Info</th>
                        <th className="p-3 w-48 text-right pr-6">Qty & Balance</th>
                        <th className="p-3 w-16 text-center">Action</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan={5} className="p-12 text-center text-slate-400"><Activity size={28} className="animate-spin mx-auto mb-2 text-indigo-400"/>กำลังโหลดข้อมูล...</td></tr>
                    ) : currentData.length === 0 ? (
                        <tr><td colSpan={5} className="p-12 text-center text-slate-400"><FileText size={40} className="opacity-20 mx-auto mb-2"/>ไม่พบข้อมูล</td></tr>
                    ) : currentData.map((tx, idx) => {
                        const isPO = tx.transaction_type === 'INBOUND';
                        
                        return (
                        <tr key={`${tx.transaction_id}-${idx}`} className="transition-colors align-top hover:bg-slate-50">
                            <td className="p-3">
                                <div className="font-bold text-slate-700">{tx.dateObj.toLocaleDateString('th-TH')}</div>
                                <div className="text-xs text-slate-400">{tx.dateObj.toLocaleTimeString('th-TH')} น.</div>
                            </td>
                            <td className="p-3">
                                <div className="mb-1.5">
                                    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase tracking-wider ${
                                        tx.transaction_type === 'INBOUND' ? 'bg-emerald-100 text-emerald-700' :
                                        tx.transaction_type === 'OUTBOUND' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                                    }`}>
                                        {tx.transaction_type}
                                    </span>
                                </div>
                                <div className="flex flex-col gap-0.5">
                                    {tx.poNumber !== '-' && <div className="text-[10px] font-mono font-bold bg-blue-50 text-blue-700 px-1.5 rounded border border-blue-100 w-max">PO: {tx.poNumber}</div>}
                                    {tx.docRef !== '-' && tx.docRef !== tx.poNumber && <div className="text-[10px] font-mono font-bold bg-slate-100 text-slate-600 px-1.5 rounded border border-slate-200 w-max">Ref: {tx.docRef}</div>}
                                </div>
                                {tx.branch_name && tx.transaction_type === 'OUTBOUND' && (
                                    <div className="mt-1 text-[10px] font-bold text-indigo-600 truncate max-w-[120px]"><Store size={10} className="inline mr-1"/>{tx.branch_name}</div>
                                )}
                            </td>
                            <td className="p-3">
                                <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                    {tx.product_id}
                                    {/* 🟢 แก้ไข: ครอบ Icon ด้วยแท็ก span และนำ title มาใส่ที่ span แทน */}
                                    {tx.anomalies.length > 0 && (
                                        <span title={tx.anomalies.join(', ')}>
                                            <AlertOctagon size={14} className="text-rose-500" />
                                        </span>
                                    )}
                                </div>
                                <div className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[280px]" title={tx.product_name}>{tx.product_name}</div>
                                <button onClick={() => openJourney(tx)} className="text-[9px] uppercase tracking-widest font-bold mt-1.5 flex items-center gap-1 text-indigo-400 hover:text-indigo-600 transition-colors">
                                    <GitBranch size={10}/> Journey
                                </button>
                            </td>
                            
                            <td className="p-3 text-right pr-6 bg-slate-50/30">
                                {isPO ? (
                                    <div className="flex flex-col items-end text-xs mb-1">
                                        <div className="text-slate-400">Order: <span className="font-mono">{tx.orderedQty || '-'}</span> <span className="text-[9px]">{tx.base_uom}</span></div>
                                        <div className="font-bold text-emerald-600 mt-0.5">Recv: <span className="font-mono bg-emerald-50 px-1 rounded">+{tx.qty.toLocaleString()}</span> <span className="text-[9px]">{tx.base_uom}</span></div>
                                    </div>
                                ) : (
                                    <div className={`font-black text-sm mb-1 ${tx.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                        {tx.qty > 0 ? '+' : ''}{tx.qty.toLocaleString()} <span className="text-[9px] font-normal text-slate-400">{tx.base_uom}</span>
                                    </div>
                                )}
                                <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-200 border-dashed inline-block">
                                    Bal: <span className="font-mono font-bold text-slate-800">{tx.balance.toLocaleString()}</span>
                                </div>
                            </td>

                            <td className="p-3 text-center">
                                <button onClick={() => setReceiptModal(tx)} className="p-2 bg-white border border-slate-200 rounded-lg text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition-colors shadow-sm" title="View e-Receipt & Details">
                                    <FileCheck size={16}/>
                                </button>
                            </td>
                        </tr>
                    )})}
                </tbody>
            </table>
        </div>
        
        <div className="p-2.5 border-t border-slate-200 bg-slate-50 flex justify-between items-center text-xs text-slate-500 flex-shrink-0">
            <div>Showing <b>{filteredData.length === 0 ? 0 : ((currentPage-1)*itemsPerPage)+1}</b> - <b>{Math.min(currentPage*itemsPerPage, filteredData.length)}</b> of <b>{filteredData.length}</b></div>
            <div className="flex items-center gap-1.5">
                <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-1 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={16}/></button>
                <span className="font-bold text-slate-700 px-2">Page {currentPage} / {totalPages || 1}</span>
                <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages || totalPages === 0} className="p-1 bg-white border border-slate-300 rounded shadow-sm hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={16}/></button>
            </div>
        </div>
      </div>

      {/* ======================================================= */}
      {/* 🧾 MODAL: DIGITAL E-RECEIPT */}
      {/* ======================================================= */}
      {receiptModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 z-[60]">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden relative animate-fade-in">
                  <div className="absolute top-0 left-0 right-0 h-3 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-indigo-600 opacity-20"></div>
                  
                  <div className="p-5 pt-6 bg-slate-50 border-b border-dashed border-slate-300 flex flex-col items-center text-center">
                      <div className={`w-10 h-10 rounded-full mb-2 flex items-center justify-center ${receiptModal.transaction_type === 'INBOUND' ? 'bg-emerald-100 text-emerald-600' : receiptModal.transaction_type === 'OUTBOUND' ? 'bg-rose-100 text-rose-600' : 'bg-orange-100 text-orange-600'}`}>
                          <Receipt size={20}/>
                      </div>
                      <h3 className="font-black text-lg text-slate-800 tracking-widest uppercase">Transaction Slip</h3>
                      <div className="text-[10px] text-slate-400 font-mono">{receiptModal.transaction_id}</div>
                  </div>

                  <div className="p-5 space-y-3 text-xs bg-white">
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Date & Time</span><span className="font-bold text-slate-800">{receiptModal.dateObj.toLocaleString('th-TH')}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Type</span><span className="font-black text-indigo-600">{receiptModal.transaction_type}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Doc Reference</span><span className="font-mono font-bold text-slate-700">{receiptModal.docRef !== '-' ? receiptModal.docRef : '-'}</span>
                      </div>
                      {receiptModal.poNumber !== '-' && (
                          <div className="flex justify-between border-b border-slate-100 pb-2">
                              <span className="text-slate-500">PO Number</span><span className="font-mono font-bold text-blue-600">{receiptModal.poNumber}</span>
                          </div>
                      )}
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Product</span>
                          <div className="text-right">
                              <div className="font-bold text-slate-800 truncate max-w-[200px]">{receiptModal.product_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">{receiptModal.product_id}</div>
                          </div>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Quantity</span>
                          <span className={`font-black text-base ${receiptModal.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{receiptModal.qty > 0 ? '+' : ''}{receiptModal.qty} {receiptModal.base_uom}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Balance After</span><span className="font-bold text-slate-800">{receiptModal.balance}</span>
                      </div>

                      {receiptModal.remarks && (
                          <div className="bg-slate-100 p-3 rounded-lg text-xs text-slate-600 border border-slate-200">
                              <b>📝 หมายเหตุ:</b> <br/>{receiptModal.remarks}
                          </div>
                      )}
                      
                      {receiptModal.timingStatus !== '-' && (
                           <div className="flex justify-between mt-2">
                               <span className="text-slate-500">สถานะจัดส่ง:</span>
                               <span className="font-bold text-slate-700">{receiptModal.timingStatus}</span>
                           </div>
                      )}
                  </div>
                  <div className="p-3 bg-slate-50 border-t border-slate-200">
                      <button onClick={()=>setReceiptModal(null)} className="w-full py-2 bg-slate-800 text-white rounded-lg font-bold hover:bg-black transition-colors text-sm">Close</button>
                  </div>
              </div>
          </div>
      )}

      {/* ======================================================= */}
      {/* 🗺️ MODAL: PRODUCT JOURNEY */}
      {/* ======================================================= */}
      {journeyModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 z-[60]">
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