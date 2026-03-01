"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Store, Search, Calendar, Package, TrendingUp, Filter, 
    BarChart2, Download, MapPin, Activity, PieChart as PieChartIcon, Target,
    DollarSign, Hash, ChevronRight, RefreshCw // 🟢 เพิ่ม RefreshCw
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
    Legend, ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';
import * as XLSX from 'xlsx';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#8b5cf6', '#14b8a6'];

export default function BranchDeliveryReport() {
  const [loading, setLoading] = useState(true);
  const [syncProgress, setSyncProgress] = useState(''); // 🟢 State แสดงความคืบหน้าการโหลด
  
  // --- Data States ---
  const [branches, setBranches] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  // --- Filter States ---
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [productSearchTerm, setProductSearchTerm] = useState(''); 
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  
  const [metricType, setMetricType] = useState<'VALUE' | 'QTY'>('VALUE');
  
  const [startDate, setStartDate] = useState(() => {
      const d = new Date(); d.setMonth(d.getMonth() - 1); 
      return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
              setIsSearchFocused(false);
          }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
      fetchData();
  }, [startDate, endDate]);

  // ==================== 🟢 FETCH DATA (อัปเกรด Chunking & Performance) ====================
  const fetchData = async () => {
      setLoading(true);
      setSyncProgress('กำลังเตรียมข้อมูลอ้างอิง...');
      try {
          // 1. โหลด Master Data ก่อน
          const [bRes, pRes] = await Promise.all([
              supabase.from('master_branches').select('branch_id, branch_name'),
              supabase.from('master_products').select('product_id, product_name, base_uom, standard_cost, category')
          ]);
          setBranches(bRes.data || []);
          setProducts(pRes.data || []);

          // 🟢 สร้าง Hash Map (O(1) Lookup) เพื่อลดภาระการวนลูปซ้อนลูปตอนประกอบร่างข้อมูล
          const productMap: Record<string, any> = {};
          const cats = new Set<string>();
          (pRes.data || []).forEach(p => { 
              productMap[p.product_id] = p;
              if (p.category) cats.add(p.category); 
          });
          setCategories(Array.from(cats).sort());

          const branchMap: Record<string, string> = {};
          (bRes.data || []).forEach(b => {
              branchMap[b.branch_id] = b.branch_name;
          });

          // 2. ดึงประวัติการจัดส่งแบบ Pagination (ข้ามขีดจำกัด 1,000 บรรทัด)
          setSyncProgress('กำลังดึงประวัติการจัดส่ง...');
          let allTransactions: any[] = [];
          let hasMore = true;
          let offset = 0;
          const limitSize = 1000;

          while (hasMore) {
              const { data: txData, error: txError } = await supabase
                  .from('transactions_log')
                  .select('transaction_id, transaction_date, product_id, branch_id, quantity_change, remarks, reference_id')
                  .eq('transaction_type', 'OUTBOUND')
                  .gte('transaction_date', `${startDate}T00:00:00.000Z`)
                  .lte('transaction_date', `${endDate}T23:59:59.999Z`)
                  .order('transaction_date', { ascending: false })
                  .range(offset, offset + limitSize - 1);

              if (txError) throw txError;

              if (txData && txData.length > 0) {
                  allTransactions = [...allTransactions, ...txData];
                  offset += limitSize;
                  setSyncProgress(`ดึงข้อมูลแล้ว ${allTransactions.length.toLocaleString()} รายการ...`);
                  if (txData.length < limitSize) hasMore = false;
              } else {
                  hasMore = false;
              }
          }

          setSyncProgress('กำลังประมวลผลข้อมูล...');
          
          // 🟢 3. ประกอบร่างข้อมูลโดยใช้ Hash Map (ประมวลผลเร็วขึ้น 100 เท่า)
          const processedTx = allTransactions.map(tx => {
              const pInfo = productMap[tx.product_id];
              const derivedBranchId = tx.branch_id || tx.remarks?.split(' ')[1] || 'UNKNOWN';
              
              return {
                  ...tx,
                  branch_id: derivedBranchId,
                  branch_name: branchMap[derivedBranchId] || derivedBranchId, // หาชื่อสาขาไว้เลย
                  qty: Math.abs(Number(tx.quantity_change)),
                  dateObj: new Date(tx.transaction_date),
                  product_name: pInfo?.product_name || 'Unknown',
                  category: pInfo?.category || 'Uncategorized',
                  base_uom: pInfo?.base_uom || '-',
                  value: Number(tx.metadata?.document_cost_amt) || (Math.abs(Number(tx.quantity_change)) * (Number(pInfo?.standard_cost) || 0))
              };
          });

          setTransactions(processedTx);
      } catch (error) {
          console.error("Error loading report:", error);
          alert("เกิดข้อผิดพลาดในการโหลดข้อมูล");
      }
      setLoading(false);
      setSyncProgress('');
  };

  const filteredData = useMemo(() => {
      return transactions.filter(tx => {
          const matchBranch = selectedBranch === 'ALL' || tx.branch_id === selectedBranch;
          const matchCategory = selectedCategory === 'ALL' || tx.category === selectedCategory;
          const matchProduct = productSearchTerm === '' || 
              tx.product_id.toLowerCase().includes(productSearchTerm.toLowerCase()) || 
              tx.product_name.toLowerCase().includes(productSearchTerm.toLowerCase());

          return matchBranch && matchCategory && matchProduct;
      });
  }, [transactions, selectedBranch, selectedCategory, productSearchTerm]);

  const searchSuggestions = useMemo(() => {
      if (!productSearchTerm) return [];
      const uniqueNames = Array.from(new Set(transactions.map(t => t.product_name)));
      return uniqueNames.filter(name => name.toLowerCase().includes(productSearchTerm.toLowerCase())).slice(0, 5);
  }, [transactions, productSearchTerm]);

  const kpiStats = useMemo(() => {
      let totalQty = 0; let totalValue = 0;
      const branchCount = new Set();
      filteredData.forEach(tx => {
          totalQty += tx.qty;
          totalValue += tx.value;
          branchCount.add(tx.branch_id);
      });
      return { totalQty, totalValue, activeBranches: branchCount.size };
  }, [filteredData]);

  // --- Charts Data Calculation ---
  const dailyChartData = useMemo(() => {
      const dateMap: Record<string, number> = {};
      filteredData.forEach(tx => {
          const dateKey = tx.dateObj.toISOString().split('T')[0]; 
          dateMap[dateKey] = (dateMap[dateKey] || 0) + (metricType === 'VALUE' ? tx.value : tx.qty);
      });
      return Object.keys(dateMap).sort().map(key => ({
          name: new Date(key).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
          Value: dateMap[key]
      }));
  }, [filteredData, metricType]);

  const categoryChartData = useMemo(() => {
      const catMap: Record<string, number> = {};
      filteredData.forEach(tx => {
          catMap[tx.category] = (catMap[tx.category] || 0) + (metricType === 'VALUE' ? tx.value : tx.qty);
      });
      return Object.keys(catMap).map(key => ({
          name: key, value: catMap[key]
      })).sort((a, b) => b.value - a.value);
  }, [filteredData, metricType]);

  const branchComparisonData = useMemo(() => {
      const bMap: Record<string, number> = {};
      filteredData.forEach(tx => {
          bMap[tx.branch_name] = (bMap[tx.branch_name] || 0) + (metricType === 'VALUE' ? tx.value : tx.qty);
      });
      return Object.keys(bMap).map(key => ({
          name: key, Amount: bMap[key] 
      })).sort((a, b) => b.Amount - a.Amount).slice(0, 5);
  }, [filteredData, metricType]);

  const topProductsData = useMemo(() => {
      const prodMap: Record<string, number> = {};
      filteredData.forEach(tx => {
          prodMap[tx.product_name] = (prodMap[tx.product_name] || 0) + (metricType === 'VALUE' ? tx.value : tx.qty);
      });
      return Object.keys(prodMap).map(key => ({
          name: key, Amount: prodMap[key]
      })).sort((a, b) => b.Amount - a.Amount).slice(0, 5);
  }, [filteredData, metricType]);


  const handleExport = () => {
      if (filteredData.length === 0) return alert("ไม่มีข้อมูลให้ Export");
      // ไม่ต้อง .find() ซ้ำแล้ว เพราะข้อมูลถูกประกอบร่างสมบูรณ์แล้ว
      const exportPayload = filteredData.map(tx => ({
          'วันที่ส่ง (Date)': tx.dateObj.toLocaleDateString('th-TH'),
          'เวลา (Time)': tx.dateObj.toLocaleTimeString('th-TH'),
          'สาขาปลายทาง (Branch)': tx.branch_name,
          'หมวดหมู่ (Category)': tx.category,
          'รหัสสินค้า (SKU)': tx.product_id,
          'ชื่อสินค้า (Product)': tx.product_name,
          'จำนวนส่ง (Qty)': tx.qty,
          'มูลค่า (Value)': tx.value,
          'หน่วย (UOM)': tx.base_uom,
          'เลขที่เอกสาร (Ref)': tx.reference_id || tx.transaction_id,
      }));

      const ws = XLSX.utils.json_to_sheet(exportPayload);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Branch_Delivery");
      XLSX.writeFile(wb, `Delivery_Report_${startDate}_to_${endDate}.xlsx`);
  };

  const CustomTooltip = ({ active, payload }: any) => {
      if (active && payload && payload.length) {
          const val = payload[0].value;
          return (
              <div className="bg-slate-900 text-white p-3 rounded-xl shadow-2xl border border-slate-700 text-sm font-bold z-50 relative">
                  <div className="text-slate-300 mb-1">{payload[0].name}</div>
                  <div className="text-emerald-400">
                      {metricType === 'VALUE' ? `฿${Number(val).toLocaleString()}` : `${Number(val).toLocaleString()} หน่วย`}
                  </div>
              </div>
          );
      }
      return null;
  };

  return (
    <div className="p-4 md:p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      {/* --- HEADER --- */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 flex-shrink-0">
          <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-800 flex items-center gap-2">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl shadow-inner"><TrendingUp size={20} className="md:w-6 md:h-6"/></div>
                  Branch Delivery Analytics
              </h1>
              <p className="text-slate-500 text-xs md:text-sm mt-1">แดชบอร์ดวิเคราะห์การเบิกจ่าย เปรียบเทียบสาขา และสัดส่วนสินค้า</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              
              {/* 🟢 สถานะการโหลด */}
              {syncProgress && (
                  <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg font-bold text-xs bg-indigo-50 text-indigo-600 border border-indigo-100 animate-pulse">
                      <Activity size={14}/> {syncProgress}
                  </span>
              )}

              <div className="flex items-center bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
                  <button onClick={() => setMetricType('VALUE')} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${metricType === 'VALUE' ? 'bg-indigo-50 text-indigo-700 shadow-sm' : 'text-slate-400 hover:bg-slate-50'}`}>
                      <DollarSign size={16}/> ยอดเงิน
                  </button>
                  <button onClick={() => setMetricType('QTY')} className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${metricType === 'QTY' ? 'bg-emerald-50 text-emerald-700 shadow-sm' : 'text-slate-400 hover:bg-slate-50'}`}>
                      <Hash size={16}/> จำนวน
                  </button>
              </div>

              {/* 🟢 ปุ่ม Sync Data */}
              <button onClick={fetchData} disabled={loading} className="w-full md:w-auto px-4 py-2 bg-white text-slate-600 border border-slate-300 rounded-xl font-bold shadow-sm hover:bg-slate-50 flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm">
                  <RefreshCw size={16} className={loading ? "animate-spin text-indigo-500" : ""}/> Sync
              </button>

              <button onClick={handleExport} disabled={loading} className="w-full md:w-auto px-5 py-2 bg-slate-800 text-white rounded-xl font-bold shadow-lg shadow-slate-200 hover:bg-slate-900 flex items-center justify-center gap-2 transition-all disabled:opacity-50 text-sm">
                  <Download size={16}/> Export
              </button>
          </div>
      </div>

      {/* --- FILTER CONTROL PANEL --- */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row flex-wrap gap-4 items-center flex-shrink-0 relative z-30">
          <div className="flex w-full md:w-auto items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
              <Calendar size={18} className="text-indigo-500 ml-1 shrink-0"/>
              <input type="date" value={startDate} max={endDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-xs md:text-sm font-bold text-slate-700 outline-none cursor-pointer w-full"/>
              <span className="text-slate-400 font-bold">-</span>
              <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-xs md:text-sm font-bold text-slate-700 outline-none cursor-pointer w-full pr-1"/>
          </div>

          <div className="flex w-full md:w-auto items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 flex-1 min-w-[150px]">
              <Store size={18} className="text-emerald-500 ml-1 shrink-0"/>
              <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full truncate">
                  <option value="ALL">เปรียบเทียบทุกสาขา</option>
                  {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.branch_name}</option>)}
              </select>
          </div>

          <div className="flex w-full md:w-auto items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 flex-1 min-w-[150px]">
              <PieChartIcon size={18} className="text-rose-500 ml-1 shrink-0"/>
              <select value={selectedCategory} onChange={e => setSelectedCategory(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full truncate">
                  <option value="ALL">ทุกหมวดหมู่</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
          </div>

          {/* 🟢 Search bar with Autocomplete */}
          <div ref={searchRef} className="flex w-full md:w-auto items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 flex-1 min-w-[200px] relative focus-within:ring-2 focus-within:ring-indigo-100 focus-within:bg-white transition-all shadow-inner focus-within:shadow-none">
              <Search size={18} className="text-amber-500 ml-1 shrink-0"/>
              <input 
                  type="text" 
                  placeholder="พิมพ์ค้นหาสินค้า เช่น นม..." 
                  className="bg-transparent text-sm font-bold text-slate-700 outline-none w-full"
                  value={productSearchTerm}
                  onFocus={() => setIsSearchFocused(true)}
                  onChange={e => {
                      setProductSearchTerm(e.target.value);
                      setIsSearchFocused(true);
                  }}
              />
              {isSearchFocused && searchSuggestions.length > 0 && (
                  <div className="absolute top-[110%] left-0 w-full bg-white border border-slate-200 shadow-xl rounded-xl overflow-hidden py-1 z-50">
                      {searchSuggestions.map((s, i) => (
                          <div 
                              key={i} 
                              className="px-4 py-2 hover:bg-indigo-50 text-sm cursor-pointer font-medium text-slate-700 flex items-center gap-2"
                              onClick={() => {
                                  setProductSearchTerm(s);
                                  setIsSearchFocused(false);
                              }}
                          >
                              <Search size={12} className="text-slate-400"/> {s}
                          </div>
                      ))}
                  </div>
              )}
          </div>
      </div>

      {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-indigo-500">
              <Activity size={48} className="animate-spin mb-4"/>
              <span className="font-bold tracking-widest uppercase">Analyzing Data...</span>
          </div>
      ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6 pb-6 relative z-10">
              
              {/* --- KPI Cards --- */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 shrink-0">
                  <div className={`bg-white p-4 md:p-6 rounded-3xl shadow-sm border flex items-center justify-between relative overflow-hidden group transition-all ${metricType === 'QTY' ? 'border-indigo-300 ring-2 ring-indigo-50' : 'border-slate-200 opacity-70'}`}>
                      <div className="absolute -right-6 -top-6 w-24 h-24 bg-indigo-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                      <div className="relative z-10">
                          <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Volume (ปริมาณ)</div>
                          <div className={`text-xl md:text-3xl font-black ${metricType === 'QTY' ? 'text-indigo-600' : 'text-slate-800'}`}>{kpiStats.totalQty.toLocaleString()} <span className="text-[10px] md:text-sm text-slate-400 font-medium">หน่วย</span></div>
                      </div>
                      <div className={`w-10 h-10 md:w-12 md:h-12 rounded-2xl flex items-center justify-center relative z-10 ${metricType === 'QTY' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' : 'bg-slate-100 text-slate-400'}`}><Package size={20}/></div>
                  </div>
                  
                  <div className={`bg-white p-4 md:p-6 rounded-3xl shadow-sm border flex items-center justify-between relative overflow-hidden group transition-all ${metricType === 'VALUE' ? 'border-emerald-300 ring-2 ring-emerald-50' : 'border-slate-200 opacity-70'}`}>
                      <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                      <div className="relative z-10">
                          <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Total Value (มูลค่า)</div>
                          <div className={`text-xl md:text-3xl font-black ${metricType === 'VALUE' ? 'text-emerald-600' : 'text-slate-800'}`}>฿{kpiStats.totalValue.toLocaleString()}</div>
                      </div>
                      <div className={`w-10 h-10 md:w-12 md:h-12 rounded-2xl flex items-center justify-center relative z-10 ${metricType === 'VALUE' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-200' : 'bg-slate-100 text-slate-400'}`}><DollarSign size={20}/></div>
                  </div>

                  <div className="bg-white p-4 md:p-6 rounded-3xl shadow-sm border border-slate-200 flex items-center justify-between relative overflow-hidden group col-span-2 md:col-span-1">
                      <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                      <div className="relative z-10">
                          <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Active Branches</div>
                          <div className="text-xl md:text-3xl font-black text-slate-800">{kpiStats.activeBranches} <span className="text-[10px] md:text-sm text-slate-400 font-medium">สาขา</span></div>
                      </div>
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center relative z-10"><Store size={20} className="md:w-6 md:h-6"/></div>
                  </div>
              </div>

              {/* --- Charts --- */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
                  
                  {/* 1. Bar Chart (Daily Trend) */}
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 lg:col-span-2">
                      <h2 className="text-sm md:text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <BarChart2 className="text-indigo-500 w-4 h-4 md:w-5 md:h-5"/> 
                          แนวโน้มการจัดส่งรายวัน ({metricType === 'VALUE' ? 'บาท' : 'หน่วย'})
                      </h2>
                      <div className="w-full h-64 md:h-72">
                          {dailyChartData.length === 0 ? (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">ไม่พบข้อมูลตามช่วงวันที่เลือก</div>
                          ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={dailyChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                                      <defs>
                                          <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                              <stop offset="5%" stopColor={metricType === 'VALUE' ? '#10b981' : '#6366f1'} stopOpacity={1}/>
                                              <stop offset="95%" stopColor={metricType === 'VALUE' ? '#34d399' : '#818cf8'} stopOpacity={0.2}/>
                                          </linearGradient>
                                      </defs>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b', fontWeight: 600}} dy={10}/>
                                      <YAxis 
                                          axisLine={false} tickLine={false} 
                                          tick={{fontSize: 10, fill: '#64748b'}}
                                          tickFormatter={(val) => metricType === 'VALUE' ? `฿${(val/1000).toFixed(0)}k` : val} 
                                      />
                                      <RechartsTooltip content={<CustomTooltip />} cursor={{fill: '#f1f5f9'}} />
                                      <Bar dataKey="Value" fill="url(#colorValue)" radius={[6, 6, 0, 0]} maxBarSize={40} />
                                  </BarChart>
                              </ResponsiveContainer>
                          )}
                      </div>
                  </div>

                  {/* 2. Pie Chart (Category Distribution) */}
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex flex-col">
                      <h2 className="text-sm md:text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <PieChartIcon className="text-rose-500 w-4 h-4 md:w-5 md:h-5"/> สัดส่วนตามหมวดหมู่
                      </h2>
                      <div className="w-full flex-1 min-h-[200px]">
                          {categoryChartData.length === 0 ? (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">ไม่พบข้อมูล</div>
                          ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                  <PieChart>
                                      <Pie
                                          data={categoryChartData}
                                          cx="50%" cy="50%"
                                          innerRadius={55} outerRadius={85}
                                          paddingAngle={5} dataKey="value"
                                      >
                                          {categoryChartData.map((entry, index) => (
                                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="transparent" />
                                      ))}
                                      </Pie>
                                      <RechartsTooltip content={<CustomTooltip />} />
                                      <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '15px', fontWeight: 600, color: '#475569' }}/>
                                  </PieChart>
                              </ResponsiveContainer>
                          )}
                      </div>
                  </div>

                  {/* 3. Horizontal Bar Chart (Top Branches Comparison) */}
                  {selectedBranch === 'ALL' && (
                      <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 lg:col-span-2">
                          <h2 className="text-sm md:text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                              <Target className="text-amber-500 w-4 h-4 md:w-5 md:h-5"/> เปรียบเทียบ Top 5 สาขาที่ส่งออกสูงสุด
                          </h2>
                          <div className="w-full h-64 md:h-72">
                              {branchComparisonData.length === 0 ? (
                                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">ไม่พบข้อมูล</div>
                              ) : (
                                  <ResponsiveContainer width="100%" height="100%">
                                      <BarChart data={branchComparisonData} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0"/>
                                          <XAxis type="number" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}}/>
                                          <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#334155', fontWeight: 600}} width={100}/>
                                          <RechartsTooltip content={<CustomTooltip />} cursor={{fill: '#f1f5f9'}} />
                                          <Bar dataKey="Amount" fill="#f59e0b" radius={[0, 6, 6, 0]} barSize={24}>
                                              {branchComparisonData.map((entry, index) => (
                                                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                              ))}
                                          </Bar>
                                      </BarChart>
                                  </ResponsiveContainer>
                              )}
                          </div>
                      </div>
                  )}

                  {/* 4. Top 5 Products List */}
                  <div className={`bg-white p-5 rounded-3xl shadow-sm border border-slate-200 ${selectedBranch !== 'ALL' ? 'lg:col-span-3' : 'lg:col-span-1'}`}>
                      <h2 className="text-sm md:text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <Package className="text-blue-500 w-4 h-4 md:w-5 md:h-5"/> Top 5 สินค้าขายดี
                      </h2>
                      <div className="flex flex-col gap-3">
                          {topProductsData.length === 0 ? (
                              <div className="text-center text-slate-400 text-sm py-10">ไม่พบข้อมูล</div>
                          ) : topProductsData.map((item, i) => (
                              <div key={i} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl hover:bg-indigo-50 transition-colors cursor-default">
                                  <div className="flex items-center gap-3">
                                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${i===0 ? 'bg-amber-100 text-amber-600' : i===1 ? 'bg-slate-200 text-slate-600' : i===2 ? 'bg-orange-100 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                                          {i+1}
                                      </div>
                                      <div className="text-sm font-bold text-slate-700 truncate w-32 md:w-40" title={item.name}>{item.name}</div>
                                  </div>
                                  <div className={`text-sm font-black ${metricType === 'VALUE' ? 'text-emerald-600' : 'text-indigo-600'}`}>
                                      {metricType === 'VALUE' ? `฿${item.Amount.toLocaleString()}` : item.Amount.toLocaleString()}
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>

              {/* --- DETAILED DATA TABLE --- */}
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[400px]">
                  <div className="p-4 md:p-5 border-b border-slate-100 flex justify-between items-center bg-white">
                      <div>
                          <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm md:text-base">
                              <Filter size={18} className="text-indigo-500"/> รายการจัดส่งล่าสุด
                          </h2>
                          <p className="text-xs text-slate-500 mt-1">ตารางสรุปรายละเอียด (จำกัด 100 รายการล่าสุด)</p>
                      </div>
                      <span className="text-[10px] md:text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 px-3 py-1.5 rounded-full">{filteredData.length.toLocaleString()} Records</span>
                  </div>
                  
                  <div className="flex-1 overflow-x-auto">
                      <table className="w-full text-left text-sm whitespace-nowrap min-w-[700px]">
                          <thead className="bg-slate-50 text-slate-500 font-bold text-[10px] md:text-xs uppercase sticky top-0 z-10 shadow-[0_2px_4px_rgba(0,0,0,0.02)]">
                              <tr>
                                  <th className="p-3 md:p-4 pl-4 md:pl-6">Date / Time</th>
                                  <th className="p-3 md:p-4">Destination Branch</th>
                                  <th className="p-3 md:p-4">Product Details</th>
                                  <th className="p-3 md:p-4 text-center">Category</th>
                                  <th className="p-3 md:p-4 text-right">Quantity</th>
                                  <th className="p-3 md:p-4 text-right pr-4 md:pr-6">Value (THB)</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {filteredData.slice(0, 100).map((tx, idx) => (
                                  <tr key={tx.transaction_id || idx} className="hover:bg-slate-50/80 transition-colors group">
                                      <td className="p-3 md:p-4 pl-4 md:pl-6">
                                          <div className="font-bold text-slate-700">{tx.dateObj.toLocaleDateString('th-TH')}</div>
                                          <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{tx.dateObj.toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</div>
                                      </td>
                                      <td className="p-3 md:p-4">
                                          <div className="font-bold text-emerald-700 flex items-center gap-1.5 text-xs md:text-sm"><Store size={14}/> {tx.branch_name}</div>
                                          <div className="text-[10px] text-slate-400 font-mono mt-0.5 ml-5">{tx.branch_id}</div>
                                      </td>
                                      <td className="p-3 md:p-4">
                                          <div className="font-bold text-slate-800 text-xs md:text-sm truncate max-w-[200px]">{tx.product_name}</div>
                                          <div className="text-[10px] text-indigo-500 bg-indigo-50 inline-block px-1.5 rounded font-mono mt-1">{tx.product_id}</div>
                                      </td>
                                      <td className="p-3 md:p-4 text-center">
                                          <span className="text-[10px] bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-bold border border-slate-200 shadow-sm">{tx.category}</span>
                                      </td>
                                      <td className="p-3 md:p-4 text-right">
                                          <span className="font-black text-base text-slate-700">{tx.qty.toLocaleString()}</span>
                                      </td>
                                      <td className="p-3 md:p-4 text-right pr-4 md:pr-6 font-black text-emerald-600 text-base">
                                          {tx.value.toLocaleString()}
                                      </td>
                                  </tr>
                              ))}
                              {/* 🟢 Grand Total Footer Row */}
                              {filteredData.length > 0 && (
                                  <tr className="bg-slate-800 text-white font-black">
                                      <td colSpan={4} className="p-4 pl-6 text-right uppercase tracking-widest text-xs text-slate-300">Grand Total (ยอดรวมทั้งหมดของการค้นหานี้)</td>
                                      <td className="p-4 text-right text-lg text-indigo-400">{kpiStats.totalQty.toLocaleString()}</td>
                                      <td className="p-4 text-right pr-6 text-lg text-emerald-400">฿{kpiStats.totalValue.toLocaleString()}</td>
                                  </tr>
                              )}
                          </tbody>
                      </table>
                  </div>
              </div>

          </div>
      )}
    </div>
  );
}