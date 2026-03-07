"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    History, Search, Download, Filter, Calendar, Activity, 
    ChevronLeft, ChevronRight, FileText, Database, Store,
    X, AlertOctagon, GitBranch, MapPin, Receipt, Clock, RefreshCw, FileCheck, Trash2, Edit2
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function TransactionLogPage() {
  const [userRole, setUserRole] = useState<string>('VIEWER');
  const [loading, setLoading] = useState<boolean>(true);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
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

  // State สำหรับการแก้ไขข้อมูล (Edit Modal)
  const [editModal, setEditModal] = useState<any>(null);
  const [editQty, setEditQty] = useState('');
  const [editPoNumber, setEditPoNumber] = useState(''); 
  const [editRemarks, setEditRemarks] = useState('');

  useEffect(() => {
      const fetchRole = async () => {
          const { data: { session } } = await supabase.auth.getSession();
          if (session) {
              const { data } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).single();
              setUserRole(data?.role || 'VIEWER');
          }
      };
      fetchRole();
  }, []);

  useEffect(() => {
      const handler = setTimeout(() => setDebouncedSearch(searchTerm), 300);
      return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => { fetchData(); }, [startDate, endDate]);

  const fetchData = async () => {
      setLoading(true);
      setSyncProgress('กำลังเตรียมข้อมูล...');
      try {
          const [prodRes, branchRes] = await Promise.all([
              supabase.from('master_products').select('product_id, product_name, category, base_uom, purchase_uom, conversion_rate'),
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

          setSyncProgress('กำลังประกอบข้อมูล MFG/EXP (แยกตารางป้องกัน Error)...');
          
          const uniqueTxMap = new Map();
          allTransactions.forEach(tx => {
              if (tx.transaction_id) uniqueTxMap.set(tx.transaction_id, tx);
          });
          const deduplicatedTransactions = Array.from(uniqueTxMap.values());

          // 🟢 1. รวบรวม Doc Ref เฉพาะ INBOUND
          const inboundDocRefs = [...new Set(
              deduplicatedTransactions
                  .filter(tx => tx.transaction_type === 'INBOUND')
                  .map(tx => {
                      let meta = tx.metadata;
                      if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e){ meta = {}; } }
                      
                      let docRef = meta?.doc_no || '-';
                      if (docRef === '-' && tx.remarks) {
                          const match = tx.remarks.match(/(RCV-[\w-]+|PO-[\w-]+)/);
                          if (match) docRef = match[0];
                      }
                      return docRef;
                  })
                  .filter(ref => ref !== '-')
          )];

          const inboundDetailsMap: Record<string, any> = {};
          
          // 🟢 2. ดึงข้อมูลแยกตาราง (Safe Query)
          if (inboundDocRefs.length > 0) {
              const chunkSize = 100; 
              for (let i = 0; i < inboundDocRefs.length; i += chunkSize) {
                  const chunk = inboundDocRefs.slice(i, i + chunkSize);
                  
                  // ดึงใบรับเข้า
                  const { data: receipts } = await supabase
                      .from('inbound_receipts')
                      .select('receipt_id, document_reference, truck_temperature')
                      .in('document_reference', chunk);
                      
                  if (receipts && receipts.length > 0) {
                      const receiptIds = receipts.map((r: any) => r.receipt_id);
                      
                      // ดึงรายการย่อยของใบรับเข้า
                      const { data: lines } = await supabase
                          .from('inbound_lines')
                          .select('receipt_id, product_id, mfg_date, exp_date, product_temperature')
                          .in('receipt_id', receiptIds);
                          
                      receipts.forEach((r: any) => {
                          const relatedLines = (lines || []).filter((l: any) => l.receipt_id === r.receipt_id);
                          relatedLines.forEach((line: any) => {
                              const key = `${r.document_reference}_${line.product_id}`;
                              inboundDetailsMap[key] = {
                                  mfg: line.mfg_date,
                                  exp: line.exp_date,
                                  pTemp: line.product_temperature,
                                  vTemp: r.truck_temperature
                              };
                          });
                      });
                  }
              }
          }

          setSyncProgress('กำลังประมวลผล (Processing)...');

          const formattedData = deduplicatedTransactions.map(tx => {
              let meta = tx.metadata || {};
              if (typeof meta === 'string') { try { meta = JSON.parse(meta); } catch(e){ meta = {}; } }

              let docRef = meta.doc_no || '-';
              if (docRef === '-' && tx.remarks) {
                  const match = tx.remarks.match(/(RCV-[\w-]+|PO-[\w-]+|TO-[\w-]+)/);
                  if (match) docRef = match[0];
              }

              const anomalies = [];
              if (Number(tx.balance_after) < 0) anomalies.push("Negative Stock");
              if (/(เสียหาย|แตก|เคลม|ชำรุด|พัง|หาย|ขาด)/i.test(tx.remarks || '')) anomalies.push("Damage/Loss");

              const dateObj = new Date(tx.transaction_date);
              const pInfo = productMap[tx.product_id] || {};

              // 🟢 ประกอบร่างข้อมูล
              const inboundKey = `${docRef}_${tx.product_id}`;
              const inboundDetail = inboundDetailsMap[inboundKey] || {};

              return {
                  ...tx,
                  product_name: pInfo.product_name || 'Unknown',
                  base_uom: pInfo.base_uom || 'Unit', 
                  purchase_uom: pInfo.purchase_uom || pInfo.base_uom || 'Unit',
                  conversion_rate: Number(pInfo.conversion_rate) || 1,
                  branch_name: bMap[tx.branch_id] || tx.branch_id || null, 
                  qty: Number(tx.quantity_change) || 0,
                  balance: Number(tx.balance_after) || 0,
                  dateObj,
                  txDateStr: dateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }),
                  timestamp: dateObj.getTime(),
                  docRef,
                  poNumber: meta.po_number || '-',
                  orderedQty: meta.ordered_qty || 0, 
                  timingStatus: meta.time_status || '-', 
                  metadata: meta,
                  anomalies,
                  // 🟢 ถ้าใน metadata มีเก็บไว้ใช้ก่อน ถ้าไม่มีไปดึงจาก Inbound Lines
                  mfg_date: inboundDetail.mfg || null,
                  exp_date: inboundDetail.exp || null,
                  product_temp: meta.product_temp ?? inboundDetail.pTemp ?? null,
                  vehicle_temp: meta.vehicle_temp ?? inboundDetail.vTemp ?? null,
              };
          });

          setTransactions(formattedData);
      } catch (error: any) { alert("ไม่สามารถดึงข้อมูลได้: " + error.message); }
      setLoading(false); setSyncProgress(''); 
  };

  const handleDeleteTransaction = async (tx: any) => {
      if (userRole === 'VIEWER') return alert('คุณไม่มีสิทธิ์ (View Only)');
      
      const isOutbound = tx.transaction_type.includes('OUT') || tx.transaction_type.includes('DISP');
      const actionText = isOutbound ? 'คืนยอดสินค้าเข้าคลัง' : 'หักยอดสินค้าออกจากคลัง';
      
      if (!window.confirm(`⚠️ คำเตือนระดับ Admin ⚠️\n\nคุณแน่ใจหรือไม่ที่จะลบประวัติรายการนี้?\nระบบจะทำการ "${actionText}" จำนวน ${Math.abs(tx.qty)} ${tx.base_uom} อัตโนมัติ เพื่อให้สต๊อกปัจจุบันถูกต้อง\n\nการกระทำนี้ไม่สามารถย้อนกลับได้!`)) return;

      setActionLoading(true);
      try {
          const reverseQty = isOutbound ? Math.abs(tx.qty) : -Math.abs(tx.qty);

          const { data: lots } = await supabase
              .from('inventory_lots')
              .select('*')
              .eq('product_id', tx.product_id)
              .order('quantity', { ascending: false });

          if (lots && lots.length > 0) {
              const targetLot = lots[0]; 
              const newQty = Math.max(0, Number(targetLot.quantity) + reverseQty);
              await supabase.from('inventory_lots').update({ quantity: newQty, last_updated: new Date().toISOString() }).eq('lot_id', targetLot.lot_id);
          } else if (reverseQty > 0) {
              await supabase.from('inventory_lots').insert([{ product_id: tx.product_id, quantity: reverseQty, storage_location: 'RECOVERY_BIN', status: 'AVAILABLE' }]);
          }

          await supabase.from('transactions_log').delete().eq('transaction_id', tx.transaction_id);

          setTransactions(prev => prev.filter(item => item.transaction_id !== tx.transaction_id));
          alert(`✅ ลบประวัติและดึงยอดสต๊อกกลับเรียบร้อยแล้ว!`);
      } catch (error: any) { alert("Delete Error: " + error.message); }
      setActionLoading(false);
  };

  const handleEditSubmit = async () => {
      if (!editModal) return;
      if (!editRemarks.trim()) return alert("กรุณาระบุหมายเหตุเพื่อเป็นหลักฐานในการแก้ไข");
      
      setActionLoading(true);
      try {
          const { data: { user } } = await supabase.auth.getUser();
          const userEmail = user?.email || 'Admin User';

          const tx = editModal;
          const oldQty = Math.abs(tx.qty); 
          const newQty = Math.abs(Number(editQty)); 
          const diff = newQty - oldQty; 

          // ปรับยอดสต๊อกชดเชยส่วนต่าง
          if (diff !== 0) {
              const isOutbound = tx.transaction_type.includes('OUT') || tx.transaction_type.includes('DISP');
              const adjStock = isOutbound ? -diff : diff;

              const { data: lots } = await supabase
                  .from('inventory_lots')
                  .select('*')
                  .eq('product_id', tx.product_id)
                  .order('quantity', { ascending: false });

              if (lots && lots.length > 0) {
                  const targetLot = lots[0];
                  const updatedQty = Math.max(0, Number(targetLot.quantity) + adjStock);
                  await supabase.from('inventory_lots').update({ quantity: updatedQty, last_updated: new Date().toISOString() }).eq('lot_id', targetLot.lot_id);
              } else if (adjStock > 0) {
                  await supabase.from('inventory_lots').insert([{ product_id: tx.product_id, quantity: adjStock, storage_location: 'RECOVERY_BIN', status: 'AVAILABLE' }]);
              }
          }

          const isNegative = tx.quantity_change < 0;
          const finalQtyChange = isNegative ? -newQty : newQty;

          let finalRemarks = tx.remarks || '';
          if (!finalRemarks.includes('[แก้ไข]')) {
              finalRemarks = `[แก้ไข: ${editRemarks}] ` + finalRemarks;
          } else {
              finalRemarks = `[แก้ไข: ${editRemarks}] ` + finalRemarks.replace(/\[แก้ไข:.*?\] /, ''); 
          }

          const finalPoNumber = editPoNumber.trim() ? editPoNumber.trim() : null;

          const newMeta = {
              ...tx.metadata,
              po_number: finalPoNumber, 
              is_edited: true,
              edited_by: userEmail,
              edited_at: new Date().toISOString(),
              original_qty: diff !== 0 ? oldQty : (tx.metadata.original_qty || oldQty)
          };

          await supabase.from('transactions_log')
              .update({
                  quantity_change: finalQtyChange,
                  remarks: finalRemarks,
                  metadata: newMeta
              })
              .eq('transaction_id', tx.transaction_id);

          alert("✅ บันทึกการแก้ไขสำเร็จ! ข้อมูลถูกอัปเดตเข้าระบบและสต๊อกเรียบร้อยแล้ว");
          setEditModal(null);
          fetchData(); 
      } catch (err: any) {
          alert("Error: " + err.message);
      }
      setActionLoading(false);
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
          let valA = a[sortConfig.key]; let valB = b[sortConfig.key];
          if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  }, [transactions, debouncedSearch, typeFilter, startDate, endDate, sortConfig]);

  // 🚀 ฟังก์ชัน Export
  const handleExport = async () => {
      if (filteredData.length === 0) return alert("ไม่มีข้อมูลสำหรับ Export");
      
      setActionLoading(true); 
      try {
          const wb = XLSX.utils.book_new();

          // --- 1. แยกข้อมูล INBOUND ---
          const inboundData = filteredData.filter(tx => tx.transaction_type === 'INBOUND');

          if (inboundData.length > 0) {
              const inExport = inboundData.map(tx => {
                  const baseQty = Math.abs(tx.qty);
                  const convRate = tx.conversion_rate || 1;
                  const rcvLargeQty = baseQty / convRate; 
                  const ordLargeQty = tx.orderedQty ? (tx.orderedQty / convRate) : rcvLargeQty;

                  return {
                      'วันที่ (Date)': tx.dateObj.toLocaleDateString('th-TH'),
                      'เวลา (Time)': tx.dateObj.toLocaleTimeString('th-TH'),
                      'ใบอ้างอิง (Doc Ref)': tx.docRef !== '-' ? tx.docRef : '',
                      'เลขที่ใบสั่งซื้อ (PO)': tx.poNumber !== '-' ? tx.poNumber : '',
                      'รหัสสินค้า (SKU)': tx.product_id,
                      'ชื่อสินค้า (Product Name)': tx.product_name,
                      'ยอดสั่งซื้อ (Order Qty)': ordLargeQty,
                      'หน่วยสั่งซื้อ (Purchase UOM)': tx.purchase_uom,
                      'จำนวนรับจริง (Receive Qty)': rcvLargeQty,
                      'หน่วยรับ (Receive UOM)': tx.purchase_uom,
                      'ยอดเข้าสต๊อก (Base Qty)': baseQty,
                      'หน่วยย่อย (Base UOM)': tx.base_uom,
                      'อัตราแปลง (Conversion)': `1 ${tx.purchase_uom} = ${convRate} ${tx.base_uom}`,
                      'อุณหภูมิรถ (°C)': tx.vehicle_temp ?? '-',     
                      'อุณหภูมิสินค้า (°C)': tx.product_temp ?? '-',   
                      'วันที่ผลิต (MFG)': tx.mfg_date ? new Date(tx.mfg_date).toLocaleDateString('en-GB') : '-', 
                      'วันหมดอายุ (EXP)': tx.exp_date ? new Date(tx.exp_date).toLocaleDateString('en-GB') : '-', 
                      'คงเหลือ (Balance)': tx.balance,
                      'สถานะส่ง (Timing)': tx.timingStatus,
                      'หมายเหตุ (Remarks)': tx.remarks || '-',
                      'สถานะ (Audit)': tx.metadata?.is_edited ? `แก้ไขโดย ${tx.metadata.edited_by}` : 'ปกติ',
                  };
              });
              const wsIn = XLSX.utils.json_to_sheet(inExport);
              XLSX.utils.book_append_sheet(wb, wsIn, "รับเข้า (INBOUND)");
          }

          // --- 2. แยกข้อมูล OUTBOUND ---
          const outboundData = filteredData.filter(tx => tx.transaction_type.includes('OUT') || tx.transaction_type.includes('DISP'));
          if (outboundData.length > 0) {
              const outExport = outboundData.map(tx => ({
                  'วันที่ (Date)': tx.dateObj.toLocaleDateString('th-TH'),
                  'เวลา (Time)': tx.dateObj.toLocaleTimeString('th-TH'),
                  'ใบเบิก/อ้างอิง (Doc Ref)': tx.docRef !== '-' ? tx.docRef : '',
                  'สาขาปลายทาง (Branch)': tx.branch_name || '-',
                  'รหัสสินค้า (SKU)': tx.product_id,
                  'ชื่อสินค้า (Product Name)': tx.product_name,
                  'ยอดจ่ายออก (Outbound Qty)': Math.abs(tx.qty),
                  'หน่วย (Base UOM)': tx.base_uom,
                  'คงเหลือ (Balance)': tx.balance,
                  'หมายเหตุ (Remarks)': tx.remarks || '-',
                  'สถานะ (Audit)': tx.metadata?.is_edited ? `แก้ไขโดย ${tx.metadata.edited_by}` : 'ปกติ',
              }));
              const wsOut = XLSX.utils.json_to_sheet(outExport);
              XLSX.utils.book_append_sheet(wb, wsOut, "จ่ายออก (OUTBOUND)");
          }

          // --- 3. แยกข้อมูล ADJUST (ปรับยอด) ---
          const adjustData = filteredData.filter(tx => tx.transaction_type === 'ADJUST');
          if (adjustData.length > 0) {
              const adjExport = adjustData.map(tx => ({
                  'วันที่ (Date)': tx.dateObj.toLocaleDateString('th-TH'),
                  'เวลา (Time)': tx.dateObj.toLocaleTimeString('th-TH'),
                  'รหัสสินค้า (SKU)': tx.product_id,
                  'ชื่อสินค้า (Product Name)': tx.product_name,
                  'ยอดที่ปรับ (+/-)': tx.qty,
                  'หน่วย (Base UOM)': tx.base_uom,
                  'คงเหลือ (Balance)': tx.balance,
                  'สาเหตุ/หมายเหตุ (Remarks)': tx.remarks || '-',
                  'สถานะ (Audit)': tx.metadata?.is_edited ? `แก้ไขโดย ${tx.metadata.edited_by}` : 'ปกติ',
              }));
              const wsAdj = XLSX.utils.json_to_sheet(adjExport);
              XLSX.utils.book_append_sheet(wb, wsAdj, "ปรับยอด (ADJUST)");
          }

          if (wb.SheetNames.length === 0) {
              const wsFall = XLSX.utils.json_to_sheet(filteredData);
              XLSX.utils.book_append_sheet(wb, wsFall, "Transactions");
          }

          XLSX.writeFile(wb, `WMS_Transactions_${new Date().toISOString().split('T')[0]}.xlsx`);
          
      } catch (error: any) {
          alert("Export Error: " + error.message);
      }
      setActionLoading(false);
  };

  const handleSort = (key: string) => {
      setSortConfig(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const currentData = filteredData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  
  return (
    <div className="p-4 md:p-6 bg-slate-50 h-full flex flex-col overflow-hidden relative rounded-2xl font-sans">
      
      {/* 🟢 Loading Overlay */}
      {actionLoading && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-sm z-[100] flex flex-col items-center justify-center">
              <Activity size={48} className="text-amber-500 animate-spin mb-4"/>
              <div className="font-black text-slate-800 tracking-widest uppercase text-lg">Processing Data...</div>
              <div className="text-slate-500 font-bold mt-1 text-sm">กำลังประมวลผลข้อมูล กรุณารอสักครู่</div>
          </div>
      )}

      {/* HEADER */}
      <div className="mb-4 flex flex-col md:flex-row md:justify-between md:items-end gap-4 flex-shrink-0">
        <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2">
                <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-lg text-white"><History size={20} /></div>
                Transactions Log
            </h1>
            <p className="text-slate-500 text-xs md:text-sm mt-1">ตรวจสอบ, แก้ไข, และย้อนดูประวัติความเคลื่อนไหวสต๊อก</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
            {syncProgress && <span className="text-xs font-bold text-indigo-600 animate-pulse bg-indigo-50 px-2 py-1 rounded-lg border border-indigo-100">{syncProgress}</span>}
            <button onClick={fetchData} disabled={loading || actionLoading} className="px-3 py-2 bg-white border border-slate-300 text-slate-600 rounded-lg text-xs md:text-sm font-bold shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCw size={14} className={loading ? "animate-spin text-indigo-500" : ""} /> Sync
            </button>
            <button onClick={handleExport} disabled={loading || actionLoading} className="px-3 py-2 bg-emerald-600 text-white rounded-lg text-xs md:text-sm font-bold shadow-md hover:bg-emerald-700 transition-colors flex items-center gap-1.5 disabled:opacity-50">
                <Download size={14}/> Export Excel
            </button>
        </div>
      </div>

      {/* FILTERS */}
      <div className="bg-white p-3 rounded-t-2xl border border-slate-200 shadow-sm flex flex-col xl:flex-row gap-3 items-center justify-between flex-shrink-0 z-20 relative">
          <div className="relative flex-1 w-full xl:max-w-lg">
              <Search className="absolute left-3 top-2.5 text-blue-400" size={16}/>
              <input 
                  type="text" placeholder="ค้นหา: รหัส, ชื่อ, สาขา, เลข PO..." 
                  className="w-full pl-9 pr-3 py-2 border-2 border-blue-50 rounded-xl text-sm font-medium outline-none focus:ring-0 focus:border-blue-400 transition-colors bg-slate-50 focus:bg-white"
                  value={searchTerm} onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }}
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

      {/* DATA TABLE */}
      <div className="bg-white rounded-b-2xl shadow-sm border-x border-b border-slate-200 overflow-hidden flex flex-col flex-1 min-h-0">
        <div className="flex-1 overflow-auto custom-scrollbar">
            <table className="w-full text-left text-sm whitespace-nowrap min-w-[1000px]">
                <thead className="bg-slate-100 text-slate-500 font-black border-b border-slate-200 text-[10px] tracking-wider uppercase sticky top-0 z-10 shadow-sm">
                    <tr>
                        <th className="p-3 pl-4 cursor-pointer hover:bg-slate-200 w-36 transition-colors" onClick={() => handleSort('transaction_date')}>Date & Time {sortConfig.key === 'transaction_date' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</th>
                        <th className="p-3 w-48">Doc Ref / PO</th>
                        <th className="p-3 min-w-[250px]">Product Details</th>
                        <th className="p-3 w-36 text-right pr-6 bg-slate-200/50">Quantity</th>
                        <th className="p-3 w-28 text-right pr-6">Balance</th>
                        <th className="p-3 w-32 text-center sticky right-0 bg-slate-100 shadow-[-5px_0_10px_-5px_rgba(0,0,0,0.05)]">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {loading ? (
                        <tr><td colSpan={6} className="p-12 text-center text-slate-400"><Activity size={28} className="animate-spin mx-auto mb-2 text-indigo-400"/>Loading Transactions...</td></tr>
                    ) : currentData.length === 0 ? (
                        <tr><td colSpan={6} className="p-12 text-center text-slate-400"><FileText size={40} className="opacity-20 mx-auto mb-2"/>ไม่พบข้อมูลที่ค้นหา</td></tr>
                    ) : currentData.map((tx, idx) => {
                        const isPO = tx.transaction_type === 'INBOUND';
                        const isOut = tx.transaction_type.includes('OUT') || tx.transaction_type.includes('DISP');
                        
                        return (
                        <tr key={`${tx.transaction_id}-${idx}`} className="transition-colors align-middle hover:bg-blue-50/30 group">
                            
                            <td className="p-3 pl-4">
                                <div className="font-bold text-slate-700">{tx.dateObj.toLocaleDateString('th-TH')}</div>
                                <div className="text-xs text-slate-400 font-mono mt-0.5"><Clock size={10} className="inline mr-1 mb-0.5"/>{tx.dateObj.toLocaleTimeString('th-TH')}</div>
                            </td>
                            
                            <td className="p-3">
                                <div className="flex flex-col items-start gap-1.5">
                                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-md uppercase tracking-widest ${isPO ? 'bg-emerald-100 text-emerald-700' : isOut ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {tx.transaction_type}
                                    </span>
                                    {tx.poNumber !== '-' && <div className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-1.5 rounded border border-blue-100"><span className="text-slate-400">PO:</span> {tx.poNumber}</div>}
                                    {tx.docRef !== '-' && tx.docRef !== tx.poNumber && <div className="text-[10px] font-mono font-bold text-slate-600 bg-slate-100 px-1.5 rounded border border-slate-200"><span className="text-slate-400">Ref:</span> {tx.docRef}</div>}
                                </div>
                            </td>
                            
                            <td className="p-3">
                                <div className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                    {tx.product_id}
                                    {tx.anomalies.length > 0 && <span title={tx.anomalies.join(', ')}><AlertOctagon size={14} className="text-rose-500"/></span>}
                                </div>
                                <div className="text-xs text-slate-500 mt-0.5 truncate max-w-[280px]" title={tx.product_name}>{tx.product_name}</div>
                                {tx.branch_name && isOut && <div className="mt-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded w-max"><Store size={10} className="inline mr-1"/>{tx.branch_name}</div>}
                                
                                {/* 🟢 NEW: แสดงผล MFG / EXP / Temp ในตาราง */}
                                {isPO && (tx.mfg_date || tx.exp_date || tx.product_temp !== null || tx.vehicle_temp !== null) && (
                                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                        {tx.mfg_date && <span className="text-[9px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200" title="วันผลิต (MFG)">MFG: {new Date(tx.mfg_date).toLocaleDateString('en-GB')}</span>}
                                        {tx.exp_date && <span className="text-[9px] font-medium text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100" title="วันหมดอายุ (EXP)">EXP: {new Date(tx.exp_date).toLocaleDateString('en-GB')}</span>}
                                        {tx.product_temp !== null && <span className="text-[9px] font-medium text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-100" title="อุณหภูมิสินค้า (Product Temp)">P.Temp: {tx.product_temp}°C</span>}
                                    </div>
                                )}
                            </td>
                            
                            <td className={`p-3 text-right pr-6 bg-slate-50/50 border-x border-slate-100/50 ${tx.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                <div className="flex flex-col items-end">
                                    <div className="font-black text-lg font-mono flex items-center gap-2">
                                        {tx.metadata?.is_edited && <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded uppercase tracking-widest border border-amber-200 shadow-sm" title={`แก้โดย ${tx.metadata.edited_by}`}>✏️ EDITED</span>}
                                        {tx.qty > 0 ? '+' : ''}{tx.qty.toLocaleString()}
                                    </div>
                                    <div className="text-[10px] font-medium text-slate-400 uppercase">{tx.base_uom}</div>
                                </div>
                            </td>

                            <td className="p-3 text-right pr-6">
                                <div className="font-bold text-slate-700 text-base font-mono">{tx.balance.toLocaleString()}</div>
                                <div className="text-[10px] text-slate-400">คงเหลือ</div>
                            </td>

                            <td className="p-3 text-center sticky right-0 bg-white group-hover:bg-blue-50/30 shadow-[-5px_0_10px_-5px_rgba(0,0,0,0.05)] transition-colors">
                                <div className="flex items-center justify-center gap-1.5">
                                    <button onClick={() => setReceiptModal(tx)} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-indigo-500 hover:text-white hover:bg-indigo-500 transition-colors shadow-sm" title="View e-Receipt">
                                        <FileCheck size={16}/>
                                    </button>
                                    
                                    {userRole !== 'VIEWER' && (
                                        <>
                                            <button onClick={() => {
                                                setEditModal(tx);
                                                setEditQty(Math.abs(tx.qty).toString());
                                                setEditPoNumber(tx.poNumber !== '-' ? tx.poNumber : ''); 
                                                setEditRemarks('');
                                            }} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-amber-500 hover:text-white hover:bg-amber-500 hover:border-amber-500 transition-colors shadow-sm" title="Edit Transaction">
                                                <Edit2 size={16}/>
                                            </button>
                                            <button onClick={() => handleDeleteTransaction(tx)} className="p-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-400 hover:text-white hover:bg-rose-500 hover:border-rose-500 transition-colors shadow-sm" title="Delete & Reverse Stock">
                                                <Trash2 size={16}/>
                                            </button>
                                        </>
                                    )}
                                </div>
                            </td>
                        </tr>
                    )})}
                </tbody>
            </table>
        </div>
        
        {/* PAGINATION */}
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
      {/* ✏️ MODAL: EDIT TRANSACTION */}
      {/* ======================================================= */}
      {editModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
                  <div className="p-5 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                      <h3 className="font-black text-lg text-slate-800 flex items-center gap-2"><Edit2 size={20} className="text-amber-500"/> แก้ไขรายการ (Edit)</h3>
                      <button onClick={() => setEditModal(null)} className="text-slate-400 hover:text-rose-500 transition-colors bg-white p-2 rounded-full shadow-sm"><X size={20}/></button>
                  </div>
                  <div className="p-6 space-y-4">
                      
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-1">ข้อมูลสินค้า</label>
                          <div className="font-bold text-slate-800">{editModal.product_id}</div>
                          <div className="text-xs text-slate-500 truncate mt-0.5">{editModal.product_name}</div>
                      </div>

                      {editModal.transaction_type === 'INBOUND' && (
                          <div>
                              <label className="text-xs font-bold text-blue-600 mb-1.5 flex items-center gap-1"><Receipt size={14}/> เพิ่ม/แก้ไข เลข PO อ้างอิง</label>
                              <input 
                                  type="text" 
                                  placeholder="ระบุเลข PO..."
                                  className="w-full p-2.5 border border-blue-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold text-slate-700 bg-blue-50/30"
                                  value={editPoNumber}
                                  onChange={(e) => setEditPoNumber(e.target.value)}
                              />
                          </div>
                      )}

                      <div className="grid grid-cols-3 gap-4 border-t border-slate-100 pt-4">
                          <div className="col-span-2">
                              <label className="text-xs font-bold text-slate-600 mb-1.5 block">จำนวนที่ถูกต้อง (ใหม่) *</label>
                              <input 
                                  type="number" step="0.01" 
                                  className="w-full p-2.5 border-2 border-amber-200 rounded-xl outline-none focus:ring-4 focus:ring-amber-500/20 font-black text-lg text-amber-700 bg-amber-50"
                                  value={editQty}
                                  onChange={(e) => setEditQty(e.target.value)}
                              />
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-500 mb-1.5 block">หน่วย</label>
                              <input type="text" disabled value={editModal.base_uom} className="w-full p-2.5 border border-slate-200 rounded-xl bg-slate-100 text-slate-500 font-bold text-center cursor-not-allowed"/>
                          </div>
                      </div>
                      
                      <div>
                          <label className="text-xs font-bold text-slate-600 mb-1.5 block">หมายเหตุการแก้ไข (ต้องระบุ) *</label>
                          <textarea 
                              className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 text-sm bg-white"
                              rows={2}
                              placeholder="เช่น เพิ่มเลข PO ที่ตกหล่น, แก้ไขจำนวนรับ..."
                              value={editRemarks}
                              onChange={(e) => setEditRemarks(e.target.value)}
                          ></textarea>
                      </div>
                  </div>
                  <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                      <button onClick={() => setEditModal(null)} className="px-5 py-2.5 font-bold text-slate-500 hover:bg-slate-200 rounded-xl transition-colors">ยกเลิก</button>
                      <button 
                          onClick={handleEditSubmit} 
                          disabled={actionLoading || !editQty || !editRemarks.trim()}
                          className="px-6 py-2.5 bg-amber-500 text-white font-bold rounded-xl hover:bg-amber-600 shadow-lg shadow-amber-200 transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          {actionLoading ? 'กำลังบันทึก...' : 'บันทึกข้อมูล'}
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* ======================================================= */}
      {/* 🧾 MODAL: DIGITAL E-RECEIPT */}
      {/* ======================================================= */}
      {receiptModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden relative">
                  <div className="absolute top-0 left-0 right-0 h-3 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] bg-indigo-600 opacity-20"></div>
                  
                  <div className="p-5 pt-6 bg-slate-50 border-b border-dashed border-slate-300 flex flex-col items-center text-center">
                      <div className={`w-12 h-12 rounded-2xl mb-3 flex items-center justify-center ${receiptModal.transaction_type === 'INBOUND' ? 'bg-emerald-100 text-emerald-600' : receiptModal.transaction_type.includes('OUT') ? 'bg-rose-100 text-rose-600' : 'bg-orange-100 text-orange-600'}`}>
                          <Receipt size={24}/>
                      </div>
                      <h3 className="font-black text-lg text-slate-800 tracking-widest uppercase">Transaction Slip</h3>
                      <div className="text-[10px] text-slate-400 font-mono mt-1">{receiptModal.transaction_id}</div>
                  </div>

                  <div className="p-6 space-y-3 text-xs bg-white">
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
                      
                      <div className="flex justify-between border-b border-slate-100 pb-3 mt-2">
                          <span className="text-slate-500">Product</span>
                          <div className="text-right">
                              <div className="font-bold text-slate-800 truncate max-w-[200px]">{receiptModal.product_name}</div>
                              <div className="text-[10px] text-slate-400 font-mono mt-0.5">{receiptModal.product_id}</div>
                          </div>
                      </div>

                      {/* 🟢 NEW: แสดงรายละเอียด MFG/EXP ในใบเสร็จรับเข้า */}
                      {receiptModal.transaction_type === 'INBOUND' && (receiptModal.mfg_date || receiptModal.exp_date || receiptModal.product_temp !== null) && (
                          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 mt-2 space-y-1.5">
                              {receiptModal.mfg_date && <div className="flex justify-between text-xs"><span className="text-slate-500">MFG Date</span><span className="font-medium text-slate-700">{new Date(receiptModal.mfg_date).toLocaleDateString('en-GB')}</span></div>}
                              {receiptModal.exp_date && <div className="flex justify-between text-xs"><span className="text-slate-500">EXP Date</span><span className="font-medium text-rose-600">{new Date(receiptModal.exp_date).toLocaleDateString('en-GB')}</span></div>}
                              {receiptModal.vehicle_temp !== null && <div className="flex justify-between text-xs"><span className="text-slate-500">Vehicle Temp</span><span className="font-medium text-blue-600">{receiptModal.vehicle_temp} °C</span></div>}
                              {receiptModal.product_temp !== null && <div className="flex justify-between text-xs"><span className="text-slate-500">Product Temp</span><span className="font-medium text-blue-600">{receiptModal.product_temp} °C</span></div>}
                          </div>
                      )}

                      <div className="flex justify-between border-b border-slate-100 pb-2 mt-2">
                          <span className="text-slate-500">Quantity</span>
                          <span className={`font-black text-lg ${receiptModal.qty > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{receiptModal.qty > 0 ? '+' : ''}{receiptModal.qty} {receiptModal.base_uom}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-100 pb-2">
                          <span className="text-slate-500">Balance After</span><span className="font-bold text-slate-800 text-sm">{receiptModal.balance}</span>
                      </div>

                      {receiptModal.metadata?.is_edited && (
                          <div className="bg-amber-50 p-3 rounded-xl border border-amber-200 mt-4 text-amber-800 space-y-1.5">
                              <div className="font-black flex items-center gap-1.5 mb-2 text-amber-600 border-b border-amber-200/50 pb-2"><Edit2 size={14}/> ข้อมูลถูกแก้ไข (Edited)</div>
                              <div className="flex justify-between"><span className="opacity-70">ยอดเดิมก่อนแก้:</span> <b>{receiptModal.metadata.original_qty} {receiptModal.base_uom}</b></div>
                              <div className="flex justify-between"><span className="opacity-70">แก้ไขโดย:</span> <b>{receiptModal.metadata.edited_by}</b></div>
                              <div className="flex justify-between"><span className="opacity-70">เวลาที่แก้:</span> <b>{new Date(receiptModal.metadata.edited_at).toLocaleString('th-TH', {dateStyle: 'short', timeStyle: 'short'})} น.</b></div>
                          </div>
                      )}

                      {receiptModal.remarks && (
                          <div className="bg-slate-50 p-3 rounded-xl text-xs text-slate-600 border border-slate-200 mt-4 leading-relaxed">
                              <b>📝 หมายเหตุ:</b> <br/>{receiptModal.remarks}
                          </div>
                      )}
                  </div>
                  <div className="p-4 bg-slate-50 border-t border-slate-200">
                      <button onClick={()=>setReceiptModal(null)} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-black transition-colors text-sm shadow-md">ปิดหน้าต่าง (Close)</button>
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}