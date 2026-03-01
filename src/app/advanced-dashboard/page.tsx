"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Lock, ShieldAlert, BarChart3, Calendar, Filter, Search,
    RefreshCw, X, TrendingUp, DollarSign, Package, Bot,
    Activity, ArrowRight, Download, FileSpreadsheet, AlertTriangle, Layers, CheckSquare
} from 'lucide-react';
import * as XLSX from 'xlsx';

const SECRET_PIN = "9999"; 

export default function AdvancedDashboard() {
  const [pinInput, setPinInput] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [pinError, setPinError] = useState(false);

  // 🟢 Filter States
  const [preset, setPreset] = useState('THIS_MONTH');
  const [dateRange, setDateRange] = useState({
      start: new Date(new Date().setDate(1)).toISOString().split('T')[0], 
      end: new Date().toISOString().split('T')[0]
  });
  const [searchTerm, setSearchTerm] = useState(''); // ระบบค้นหาใหม่
  
  const [allBranches, setAllBranches] = useState<any[]>([]);
  const [selectedBranches, setSelectedBranches] = useState<Set<string>>(new Set());
  
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'ABC' | 'LEAKAGE' | 'AI_ALERTS'>('OVERVIEW');

  const [loading, setLoading] = useState(false);
  const [rawTransactions, setRawTransactions] = useState<any[]>([]);
  const [masterProducts, setMasterProducts] = useState<Record<string, any>>({});

  // ==========================================
  // 🔒 PIN PAD LOGIC
  // ==========================================
  const handlePinPress = (num: string) => {
      if (pinInput.length < 4) {
          const newPin = pinInput + num;
          setPinInput(newPin);
          if (newPin.length === 4) {
              if (newPin === SECRET_PIN) {
                  setIsUnlocked(true);
                  fetchInitialData();
              } else {
                  setPinError(true);
                  setTimeout(() => { setPinInput(''); setPinError(false); }, 800);
              }
          }
      }
  };

  // ==========================================
  // 📥 DATA FETCHING
  // ==========================================
  const fetchInitialData = async () => {
      setLoading(true);
      try {
          const { data: branches } = await supabase.from('master_branches').select('*');
          const branchList = branches || [];
          setAllBranches(branchList);
          setSelectedBranches(new Set(branchList.map(b => b.branch_id)));

          const { data: products } = await supabase.from('master_products').select('*');
          const pMap: Record<string, any> = {};
          (products || []).forEach(p => pMap[p.product_id] = p);
          setMasterProducts(pMap);

          await syncData(dateRange.start, dateRange.end);
      } catch (err) { console.error(err); }
      setLoading(false);
  };

  const syncData = async (startDate: string, endDate: string) => {
      setLoading(true);
      try {
          // ปรับ Timezone ชดเชยเวลาไทย เพื่อให้ดึงข้อมูลได้เป๊ะขึ้น
          const startDateTime = `${startDate}T00:00:00+07:00`;
          const endDateTime = `${endDate}T23:59:59+07:00`;
          
          const { data, error } = await supabase
              .from('transactions_log')
              .select('*')
              .gte('transaction_date', startDateTime)
              .lte('transaction_date', endDateTime);

          if (error) throw error;
          setRawTransactions(data || []);
      } catch (error: any) { alert("Sync Error: " + error.message); }
      setLoading(false);
  };

  const handlePresetClick = (p: string) => {
      setPreset(p);
      const today = new Date();
      const format = (d: Date) => d.toISOString().split('T')[0];

      if (p === 'TODAY') {
          setDateRange({ start: format(today), end: format(today) });
      } else if (p === '7D') {
          const past = new Date(today); past.setDate(past.getDate() - 7);
          setDateRange({ start: format(past), end: format(today) });
      } else if (p === '30D') {
          const past = new Date(today); past.setDate(past.getDate() - 30);
          setDateRange({ start: format(past), end: format(today) });
      } else if (p === 'THIS_MONTH') {
          const start = new Date(today.getFullYear(), today.getMonth(), 1);
          setDateRange({ start: format(start), end: format(today) });
      }
  };

  const toggleBranch = (branchId: string) => {
      const newSet = new Set(selectedBranches);
      if (newSet.has(branchId)) newSet.delete(branchId);
      else newSet.add(branchId);
      setSelectedBranches(newSet);
  };

  // ==========================================
  // 🧠 ADVANCED BI ENGINE (DATA PROCESSING)
  // ==========================================
  
  // 1. ผูกข้อมูล + กรองสาขา + 🔍 กรองจากช่องค้นหา
  const enrichedTransactions = useMemo(() => {
      let filtered = rawTransactions.filter(tx => selectedBranches.has(tx.branch_id));
      
      // กรอง Search Term
      if (searchTerm.trim() !== '') {
          const lowerTerm = searchTerm.toLowerCase();
          filtered = filtered.filter(tx => 
              (tx.product_id || '').toLowerCase().includes(lowerTerm) ||
              (tx.branch_id || '').toLowerCase().includes(lowerTerm) ||
              (tx.remarks || '').toLowerCase().includes(lowerTerm) ||
              (masterProducts[tx.product_id]?.product_name || '').toLowerCase().includes(lowerTerm)
          );
      }

      return filtered.map(tx => {
          const pInfo = masterProducts[tx.product_id] || {};
          const qty = Math.abs(tx.quantity_change);
          // 🎯 ปรับให้ยึดจากราคาในบิล (metadata) ก่อน ถอดกลับมาเป็น Cost ถ้าไม่มีค่อยคูณราคา Master
          const unitCost = tx.metadata?.unit_cost || pInfo.standard_cost || 0;
          const cost = tx.metadata?.document_cost_amt || (qty * unitCost);
          const txUnit = tx.metadata?.unit || pInfo.base_uom || 'N/A';
          
          return { 
              ...tx, qty_abs: qty, cost_value: cost, 
              p_name: pInfo.product_name || 'Unknown Product', 
              category: pInfo.category || 'Uncategorized',
              base_uom: pInfo.base_uom || 'N/A',
              tx_unit: txUnit
          };
      });
  }, [rawTransactions, selectedBranches, masterProducts, searchTerm]);

  // 2. วิเคราะห์ภาพรวม
  const overviewData = useMemo(() => {
      let totalOutQty = 0; let totalOutValue = 0; let totalLeakage = 0;
      const branchStats: Record<string, { qty: number, value: number }> = {};
      const catStats: Record<string, { qty: number, value: number }> = {};

      enrichedTransactions.forEach(tx => {
          if (tx.transaction_type === 'OUTBOUND') {
              totalOutQty += tx.qty_abs;
              totalOutValue += tx.cost_value;

              if (!branchStats[tx.branch_id]) branchStats[tx.branch_id] = { qty: 0, value: 0 };
              branchStats[tx.branch_id].qty += tx.qty_abs;
              branchStats[tx.branch_id].value += tx.cost_value;

              if (!catStats[tx.category]) catStats[tx.category] = { qty: 0, value: 0 };
              catStats[tx.category].qty += tx.qty_abs;
              catStats[tx.category].value += tx.cost_value;
          }
          if (tx.transaction_type === 'ADJUST' && tx.quantity_change < 0) {
              totalLeakage += tx.cost_value;
          }
      });

      const topBranches = Object.entries(branchStats).map(([id, data]) => ({ id, ...data })).sort((a, b) => b.value - a.value);
      const topCats = Object.entries(catStats).map(([cat, data]) => ({ cat, ...data })).sort((a, b) => b.value - a.value);

      return { totalOutQty, totalOutValue, totalLeakage, topBranches, topCats };
  }, [enrichedTransactions]);

  // 3. ABC Analysis
  const abcAnalysis = useMemo(() => {
      const productStats: Record<string, { name: string, qty: number, value: number, unit: string }> = {};
      let totalValueAll = 0;

      enrichedTransactions.filter(tx => tx.transaction_type === 'OUTBOUND').forEach(tx => {
          if (!productStats[tx.product_id]) productStats[tx.product_id] = { name: tx.p_name, qty: 0, value: 0, unit: tx.base_uom };
          productStats[tx.product_id].qty += tx.qty_abs;
          productStats[tx.product_id].value += tx.cost_value;
          totalValueAll += tx.cost_value;
      });

      const sortedProducts = Object.entries(productStats).map(([id, data]) => ({ id, ...data })).sort((a, b) => b.value - a.value);

      let cumulativeValue = 0;
      return sortedProducts.map(p => {
          cumulativeValue += p.value;
          const cumPercent = totalValueAll > 0 ? (cumulativeValue / totalValueAll) * 100 : 0;
          let grade = 'C';
          if (cumPercent <= 80) grade = 'A';
          else if (cumPercent <= 95) grade = 'B';
          return { ...p, percent: totalValueAll > 0 ? (p.value / totalValueAll) * 100 : 0, grade };
      });
  }, [enrichedTransactions]);

  const leakageData = useMemo(() => {
      return enrichedTransactions.filter(tx => tx.transaction_type === 'ADJUST' && tx.quantity_change < 0).sort((a, b) => b.cost_value - a.cost_value);
  }, [enrichedTransactions]);

  // 🤖 4. AI ANOMALY DETECTION (ระบบตรวจจับความผิดปกติ)
  const aiAlerts = useMemo(() => {
      const alerts: any[] = [];
      const statsByProduct: Record<string, { sum: number, count: number }> = {};

      // หาระดับการเบิกเฉลี่ยของแต่ละสินค้า (เฉพาะ Outbound)
      const outbounds = enrichedTransactions.filter(tx => tx.transaction_type === 'OUTBOUND');
      outbounds.forEach(tx => {
          if(!statsByProduct[tx.product_id]) statsByProduct[tx.product_id] = { sum: 0, count: 0 };
          statsByProduct[tx.product_id].sum += tx.qty_abs;
          statsByProduct[tx.product_id].count += 1;
      });

      // ตรวจหาความผิดปกติ
      outbounds.forEach(tx => {
          const avgQty = statsByProduct[tx.product_id].sum / statsByProduct[tx.product_id].count;
          
          // Rule 1: Unit Mismatch (หน่วยเบิกไม่ตรงกับระบบ)
          const isUnitMismatch = tx.tx_unit.toLowerCase() !== tx.base_uom.toLowerCase() && tx.tx_unit !== 'N/A';
          
          // Rule 2: Volume Spike (เบิกสูงกว่าค่าเฉลี่ย 3 เท่า และต้องเบิกมากกว่า 5 ชิ้นขึ้นไปถึงจะจับผิด)
          const isSpike = (tx.qty_abs > avgQty * 3) && tx.qty_abs > 5 && statsByProduct[tx.product_id].count > 2;

          if (isUnitMismatch || isSpike) {
              alerts.push({
                  ...tx,
                  anomaly_type: isUnitMismatch ? 'UNIT_MISMATCH' : 'VOLUME_SPIKE',
                  reason: isUnitMismatch 
                      ? `ตรวจพบหน่วยผิดปกติ: เบิกเป็น "${tx.tx_unit}" แต่ระบบตั้งไว้เป็น "${tx.base_uom}"` 
                      : `ยอดเบิกผิดปกติ: เบิก ${tx.qty_abs} ${tx.base_uom} (สูงกว่าค่าเฉลี่ยปกติ ${Math.round(avgQty)} ชิ้น)`,
                  severity: isUnitMismatch ? 'HIGH' : 'MEDIUM'
              });
          }
      });

      // เรียงจากความรุนแรง และวันที่ล่าสุด
      return alerts.sort((a, b) => new Date(b.transaction_date).getTime() - new Date(a.transaction_date).getTime());
  }, [enrichedTransactions]);

  // --- Export Functions ---
  const handleExportData = (data: any[], filename: string) => {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
      XLSX.writeFile(wb, `${filename}_${dateRange.start}_to_${dateRange.end}.xlsx`);
  };

  // ==========================================
  // 🛑 UI: PIN PAD SCREEN
  // ==========================================
  if (!isUnlocked) {
      return (
          <div className="h-full bg-slate-50 flex items-center justify-center p-4">
              <div className="bg-white p-8 rounded-3xl shadow-xl max-w-sm w-full flex flex-col items-center border border-slate-200 animate-fade-in">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-6 border border-slate-100 shadow-sm">
                      <Lock size={32} className={pinError ? "text-rose-500 animate-bounce" : "text-cyan-500"}/>
                  </div>
                  <h2 className="text-slate-800 font-bold text-xl tracking-widest uppercase mb-1">Executive Access</h2>
                  <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-8">Enter Authorization PIN</p>
                  
                  <div className="flex gap-4 mb-8">
                      {[0, 1, 2, 3].map(i => (
                          <div key={i} className={`w-4 h-4 rounded-full transition-all duration-300 ${pinInput.length > i ? 'bg-cyan-500 shadow-lg shadow-cyan-200 scale-125' : 'bg-slate-100 border border-slate-200'}`}></div>
                      ))}
                  </div>

                  <div className="grid grid-cols-3 gap-4 w-full px-4">
                      {['1','2','3','4','5','6','7','8','9','C','0','<'].map(num => (
                          <button 
                              key={num} onClick={() => { if(num === 'C') setPinInput(''); else if(num === '<') setPinInput(prev => prev.slice(0, -1)); else handlePinPress(num); }}
                              className={`h-14 rounded-2xl font-black text-xl transition-all active:scale-95 ${num === 'C' || num === '<' ? 'bg-slate-50 text-slate-400 hover:bg-slate-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-cyan-600 shadow-sm'}`}
                          >
                              {num}
                          </button>
                      ))}
                  </div>
              </div>
          </div>
      );
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar bg-slate-50 p-4 md:p-6 font-sans text-slate-800">
        
        <div className="max-w-7xl mx-auto space-y-6 pb-10">
            {/* 1. HEADER & GLOBAL FILTERS */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
                <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-4 mb-4">
                    <div>
                        <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-blue-600 flex items-center gap-2">
                            <Activity size={24} className="text-cyan-500"/> Executive BI Dashboard
                        </h1>
                        <p className="text-slate-500 text-xs mt-1">Smart Analytics & AI Anomaly Detection</p>
                    </div>
                    
                    {/* Date Selector */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="flex bg-slate-50 border border-slate-200 rounded-xl p-1 shadow-inner">
                            {['TODAY', '7D', '30D', 'THIS_MONTH'].map(p => (
                                <button key={p} onClick={() => handlePresetClick(p)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${preset === p ? 'bg-white text-cyan-600 shadow-sm border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>{p === 'THIS_MONTH' ? 'เดือนนี้' : p}</button>
                            ))}
                        </div>

                        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-1.5 rounded-xl">
                            <input type="date" className="bg-transparent text-sm text-slate-700 outline-none px-2 cursor-pointer" value={dateRange.start} onChange={e => {setDateRange({...dateRange, start: e.target.value}); setPreset('CUSTOM');}}/>
                            <ArrowRight size={14} className="text-slate-400"/>
                            <input type="date" className="bg-transparent text-sm text-slate-700 outline-none px-2 cursor-pointer" value={dateRange.end} onChange={e => {setDateRange({...dateRange, end: e.target.value}); setPreset('CUSTOM');}}/>
                        </div>
                        
                        <button onClick={() => syncData(dateRange.start, dateRange.end)} disabled={loading} className="px-5 py-2.5 bg-cyan-600 hover:bg-cyan-700 text-white rounded-xl font-bold text-sm flex items-center gap-2 shadow-sm transition-all disabled:opacity-50">
                            <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> Sync
                        </button>
                    </div>
                </div>

                {/* 🔍 Global Search & Branch Filter */}
                <div className="pt-4 border-t border-slate-100 flex flex-col md:flex-row gap-4">
                    
                    {/* Search Bar */}
                    <div className="relative flex-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1 mb-1"><Search size={12}/> Global Search</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                            <input 
                                type="text" placeholder="ค้นหา รหัส, ชื่อสินค้า, สาขา, หรือหมายเหตุ..." 
                                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-cyan-500"
                                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>

                    {/* Branch Checkboxes */}
                    <div className="flex-[2] flex flex-col">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1"><Filter size={12}/> Branches ({selectedBranches.size}/{allBranches.length})</span>
                            <div className="flex items-center gap-2">
                                <button onClick={() => setSelectedBranches(new Set(allBranches.map(b => b.branch_id)))} className="text-[10px] text-cyan-600 font-bold underline">Select All</button>
                                <button onClick={() => setSelectedBranches(new Set())} className="text-[10px] text-slate-500 font-bold underline">Clear</button>
                            </div>
                        </div>
                        <div className="max-h-20 overflow-y-auto custom-scrollbar flex flex-wrap gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200">
                            {allBranches.map(b => (
                                <label key={b.branch_id} className="flex items-center gap-1.5 cursor-pointer bg-white px-2 py-1 rounded border border-slate-200 hover:border-cyan-300 transition-colors">
                                    <input type="checkbox" checked={selectedBranches.has(b.branch_id)} onChange={() => toggleBranch(b.branch_id)} className="w-3 h-3 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"/>
                                    <span className={`text-[11px] truncate max-w-[120px] ${selectedBranches.has(b.branch_id) ? 'text-slate-700 font-bold' : 'text-slate-400'}`}>{b.branch_name}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* 2. TABS NAVIGATION */}
            <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                <button onClick={()=>setActiveTab('OVERVIEW')} className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${activeTab==='OVERVIEW' ? 'bg-cyan-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}><BarChart3 size={16}/> Overview</button>
                <button onClick={()=>setActiveTab('ABC')} className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${activeTab==='ABC' ? 'bg-indigo-600 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}><Layers size={16}/> ABC Analysis</button>
                <button onClick={()=>setActiveTab('LEAKAGE')} className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${activeTab==='LEAKAGE' ? 'bg-rose-500 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-500 hover:bg-slate-50'}`}><ShieldAlert size={16}/> Leakage Tracker</button>
                <button onClick={()=>setActiveTab('AI_ALERTS')} className={`px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 transition-all ${activeTab==='AI_ALERTS' ? 'bg-amber-500 text-white shadow-md' : 'bg-white border border-slate-200 text-slate-500 hover:bg-amber-50'}`}>
                    <Bot size={16}/> AI Alerts 
                    {aiAlerts.length > 0 && <span className="bg-white text-amber-600 px-1.5 py-0.5 rounded text-[10px] ml-1">{aiAlerts.length}</span>}
                </button>
            </div>

            {/* 3. MAIN CONTENT AREA */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 md:p-6 shadow-sm min-h-[500px]">
                {loading ? (
                    <div className="h-64 flex flex-col items-center justify-center text-cyan-600"><Activity size={48} className="animate-spin mb-4 opacity-50"/><span className="font-bold tracking-widest uppercase text-sm">Processing Data...</span></div>
                ) : (
                    <>
                        {/* TAB 1: OVERVIEW */}
                        {activeTab === 'OVERVIEW' && (
                            <div className="animate-fade-in space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div className="bg-white border border-slate-200 p-5 rounded-2xl relative overflow-hidden shadow-sm">
                                        <div className="text-[10px] text-cyan-600 font-bold uppercase tracking-widest mb-1">Total Outbound Value</div>
                                        <div className="text-3xl font-black text-slate-800">฿ {overviewData.totalOutValue.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                                    </div>
                                    <div className="bg-white border border-slate-200 p-5 rounded-2xl relative overflow-hidden shadow-sm">
                                        <div className="text-[10px] text-emerald-600 font-bold uppercase tracking-widest mb-1">Total Outbound Qty</div>
                                        <div className="text-3xl font-black text-slate-800">{overviewData.totalOutQty.toLocaleString()} <span className="text-sm font-medium text-slate-400">Units</span></div>
                                    </div>
                                    <div className="bg-white border border-rose-200 p-5 rounded-2xl relative overflow-hidden shadow-sm">
                                        <div className="text-[10px] text-rose-500 font-bold uppercase tracking-widest mb-1">Total Leakage (Adjust Loss)</div>
                                        <div className="text-3xl font-black text-rose-600">฿ {overviewData.totalLeakage.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                    {/* Branch Ranking */}
                                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                                        <h3 className="font-bold text-lg text-slate-800 flex items-center justify-between mb-4">
                                            <span className="flex items-center gap-2"><TrendingUp size={18} className="text-cyan-600"/> Branch Leaderboard</span>
                                            <div className="flex gap-3 text-[10px] font-bold uppercase tracking-widest">
                                                <span className="text-cyan-600">■ Value</span><span className="text-emerald-600">■ Qty</span>
                                            </div>
                                        </h3>
                                        <div className="space-y-4">
                                            {overviewData.topBranches.slice(0, 10).map((b, i) => {
                                                const maxVal = overviewData.topBranches[0]?.value || 1;
                                                const maxQty = Math.max(...overviewData.topBranches.map(x => x.qty), 1);
                                                return (
                                                    <div key={b.id}>
                                                        <div className="flex justify-between text-sm mb-1"><span className="font-bold text-slate-700 truncate pr-4">#{i+1} {b.id}</span></div>
                                                        <div className="flex items-center gap-3 mb-1">
                                                            <div className="flex-1 h-2 bg-slate-200 rounded-full"><div className="h-full bg-cyan-400 rounded-full" style={{width: `${(b.value/maxVal)*100}%`}}></div></div>
                                                            <div className="w-20 text-[10px] text-cyan-700 text-right font-bold">฿ {b.value.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex-1 h-2 bg-slate-200 rounded-full"><div className="h-full bg-emerald-400 rounded-full" style={{width: `${(b.qty/maxQty)*100}%`}}></div></div>
                                                            <div className="w-20 text-[10px] text-emerald-700 text-right font-bold">{b.qty.toLocaleString()}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Category Ranking */}
                                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                                        <h3 className="font-bold text-lg text-slate-800 flex items-center justify-between mb-4">
                                            <span className="flex items-center gap-2"><Layers size={18} className="text-indigo-600"/> Top Categories</span>
                                            <div className="flex gap-3 text-[10px] font-bold uppercase tracking-widest">
                                                <span className="text-indigo-600">■ Value</span><span className="text-emerald-600">■ Qty</span>
                                            </div>
                                        </h3>
                                        <div className="space-y-4">
                                            {overviewData.topCats.slice(0, 10).map((c, i) => {
                                                const maxVal = overviewData.topCats[0]?.value || 1;
                                                const maxQty = Math.max(...overviewData.topCats.map(x => x.qty), 1);
                                                return (
                                                    <div key={c.cat}>
                                                        <div className="flex justify-between text-sm mb-1"><span className="font-bold text-slate-700 truncate pr-4">#{i+1} {c.cat}</span></div>
                                                        <div className="flex items-center gap-3 mb-1">
                                                            <div className="flex-1 h-2 bg-slate-200 rounded-full"><div className="h-full bg-indigo-400 rounded-full" style={{width: `${(c.value/maxVal)*100}%`}}></div></div>
                                                            <div className="w-20 text-[10px] text-indigo-700 text-right font-bold">฿ {c.value.toLocaleString(undefined, {maximumFractionDigits:0})}</div>
                                                        </div>
                                                        <div className="flex items-center gap-3">
                                                            <div className="flex-1 h-2 bg-slate-200 rounded-full"><div className="h-full bg-emerald-400 rounded-full" style={{width: `${(c.qty/maxQty)*100}%`}}></div></div>
                                                            <div className="w-20 text-[10px] text-emerald-700 text-right font-bold">{c.qty.toLocaleString()}</div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* TAB: ABC / LEAKAGE / AI_ALERTS */}
                        {activeTab !== 'OVERVIEW' && (
                            <div className="animate-fade-in flex flex-col h-full">
                                <div className="flex justify-between items-end mb-4">
                                    <div>
                                        <h3 className={`font-bold text-xl mb-1 flex items-center gap-2 ${activeTab==='ABC'?'text-slate-800':activeTab==='LEAKAGE'?'text-rose-600':'text-amber-600'}`}>
                                            {activeTab==='ABC' ? <Layers size={20}/> : activeTab==='LEAKAGE' ? <ShieldAlert size={20}/> : <Bot size={20}/>}
                                            {activeTab==='ABC' ? 'ABC Analysis' : activeTab==='LEAKAGE' ? 'Cost Leakage' : 'AI Anomaly Detection'}
                                        </h3>
                                        <p className="text-xs text-slate-500">
                                            {activeTab==='ABC' ? 'จัดเกรดสินค้าตามมูลค่าเบิกออก' : activeTab==='LEAKAGE' ? 'รายการของหาย/บังคับตัด' : 'AI ตรวจจับความผิดปกติของข้อมูลการเบิกจ่าย (หน่วยผิด / ยอดพุ่ง)'}
                                        </p>
                                    </div>
                                    <button 
                                        onClick={() => handleExportData(activeTab==='ABC'?abcAnalysis:activeTab==='LEAKAGE'?leakageData:aiAlerts, activeTab)} 
                                        className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 border border-emerald-200 rounded-lg text-xs font-bold flex items-center gap-2 transition-colors"
                                    >
                                        <FileSpreadsheet size={14}/> Export Excel
                                    </button>
                                </div>

                                <div className="rounded-xl border border-slate-200 overflow-hidden">
                                    <div className="overflow-x-auto custom-scrollbar max-h-[600px]">
                                        <table className="w-full text-left text-sm whitespace-nowrap">
                                            {activeTab === 'ABC' && (
                                                <>
                                                    <thead className="bg-slate-50 text-slate-600 font-bold text-xs uppercase sticky top-0 border-b border-slate-200 z-10">
                                                        <tr><th className="p-3 pl-4">Rank</th><th className="p-3">Product</th><th className="p-3 text-center">Grade</th><th className="p-3 text-right">Total Qty</th><th className="p-3 text-right">Value (฿)</th></tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {abcAnalysis.map((p, i) => (
                                                            <tr key={p.id} className="hover:bg-slate-50">
                                                                <td className="p-3 pl-4 text-center font-mono text-slate-400">{i+1}</td>
                                                                <td className="p-3"><div className="font-bold">{p.id}</div><div className="text-xs text-slate-500">{p.name}</div></td>
                                                                <td className="p-3 text-center"><span className={`px-2 py-1 rounded-md text-xs font-black ${p.grade==='A'?'bg-emerald-100 text-emerald-700':p.grade==='B'?'bg-amber-100 text-amber-700':'bg-slate-100 text-slate-600'}`}>{p.grade}</span></td>
                                                                <td className="p-3 text-right font-mono">{p.qty.toLocaleString()} <span className="text-[10px] text-slate-400">{p.unit}</span></td>
                                                                <td className="p-3 text-right font-bold text-cyan-600">{p.value.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </>
                                            )}

                                            {activeTab === 'LEAKAGE' && (
                                                <>
                                                    <thead className="bg-slate-50 text-slate-600 font-bold text-xs uppercase sticky top-0 border-b border-slate-200 z-10">
                                                        <tr><th className="p-3 pl-4">Date</th><th className="p-3">Product</th><th className="p-3">Branch</th><th className="p-3">Reason</th><th className="p-3 text-center">Lost Qty</th><th className="p-3 text-right">Lost Value (฿)</th></tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {leakageData.map((tx, i) => (
                                                            <tr key={tx.transaction_id || i} className="hover:bg-slate-50">
                                                                <td className="p-3 pl-4 text-xs">{new Date(tx.transaction_date).toLocaleDateString('th-TH')}</td>
                                                                <td className="p-3"><div className="font-bold">{tx.product_id}</div><div className="text-[10px] text-slate-500">{tx.p_name}</div></td>
                                                                <td className="p-3 text-xs">{tx.branch_id}</td>
                                                                <td className="p-3 text-rose-500 text-xs">{tx.remarks}</td>
                                                                <td className="p-3 text-center font-bold text-rose-600">{tx.qty_abs} <span className="text-[10px]">{tx.base_uom}</span></td>
                                                                <td className="p-3 text-right font-black text-rose-500">{tx.cost_value.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </>
                                            )}

                                            {/* 🤖 AI ALERTS TAB FORMAT */}
                                            {activeTab === 'AI_ALERTS' && (
                                                <>
                                                    <thead className="bg-amber-50 text-amber-700 font-bold text-xs uppercase sticky top-0 border-b border-amber-200 z-10">
                                                        <tr><th className="p-3 pl-4">Date</th><th className="p-3">Product</th><th className="p-3">Branch / Doc</th><th className="p-3">AI Findings (Reason)</th><th className="p-3 text-center">Alert Type</th></tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {aiAlerts.length === 0 ? <tr><td colSpan={5} className="p-10 text-center text-emerald-600 font-bold">🎉 ยอดเยี่ยม! AI ไม่พบข้อมูลการเบิกจ่ายที่ผิดปกติ</td></tr> :
                                                         aiAlerts.map((tx, i) => (
                                                            <tr key={tx.transaction_id || i} className="hover:bg-amber-50/30">
                                                                <td className="p-3 pl-4 text-xs text-slate-500">{new Date(tx.transaction_date).toLocaleDateString('th-TH')}</td>
                                                                <td className="p-3"><div className="font-bold text-slate-800">{tx.product_id}</div><div className="text-[10px] text-slate-500">{tx.p_name}</div></td>
                                                                <td className="p-3 text-xs"><div className="font-bold">{tx.branch_id}</div><div className="text-[10px] text-slate-400">{tx.remarks}</div></td>
                                                                <td className="p-3"><div className="text-xs font-bold text-rose-600">{tx.reason}</div></td>
                                                                <td className="p-3 text-center">
                                                                    <span className={`px-2 py-1 rounded text-[10px] font-black uppercase ${tx.severity==='HIGH'?'bg-rose-100 text-rose-700':'bg-orange-100 text-orange-700'}`}>{tx.anomaly_type}</span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </>
                                            )}

                                        </table>
                                    </div>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    </div>
  );
}