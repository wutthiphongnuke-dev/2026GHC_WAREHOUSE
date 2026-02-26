"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Store, Search, Calendar, Package, TrendingUp, Filter, 
    BarChart2, Download, MapPin, Activity, PieChart as PieChartIcon, Target
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
    Legend, ResponsiveContainer, Cell, PieChart, Pie, Sector
} from 'recharts';
import * as XLSX from 'xlsx';

// สีสำหรับ Pie Chart
const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#8b5cf6', '#14b8a6'];

export default function BranchDeliveryReport() {
  const [loading, setLoading] = useState(true);
  
  // --- Data States ---
  const [branches, setBranches] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>([]);

  // --- Filter States ---
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [productSearchTerm, setProductSearchTerm] = useState(''); // 🟢 ค้นหาด้วยการพิมพ์แทน Dropdown
  
  const [startDate, setStartDate] = useState(() => {
      const d = new Date(); d.setMonth(d.getMonth() - 3);
      return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
      fetchData();
  }, []);

  const fetchData = async () => {
      setLoading(true);
      try {
          const [bRes, pRes] = await Promise.all([
              supabase.from('master_branches').select('branch_id, branch_name'),
              supabase.from('master_products').select('product_id, product_name, base_uom, standard_cost, category')
          ]);
          setBranches(bRes.data || []);
          setProducts(pRes.data || []);

          // ดึงหมวดหมู่ทั้งหมดที่ไม่ซ้ำกัน
          const cats = new Set<string>();
          (pRes.data || []).forEach(p => { if (p.category) cats.add(p.category); });
          setCategories(Array.from(cats).sort());

          const { data: txData } = await supabase
              .from('transactions_log')
              .select('*')
              .eq('transaction_type', 'OUTBOUND')
              .order('transaction_date', { ascending: true });

          const processedTx = (txData || []).map(tx => {
              const pInfo = (pRes.data || []).find(p => p.product_id === tx.product_id);
              return {
                  ...tx,
                  branch_id: tx.branch_id || tx.remarks?.split(' ')[1] || 'UNKNOWN',
                  qty: Math.abs(Number(tx.quantity_change)),
                  dateObj: new Date(tx.transaction_date),
                  product_name: pInfo?.product_name || 'Unknown',
                  category: pInfo?.category || 'Uncategorized',
                  value: Math.abs(Number(tx.quantity_change)) * (Number(pInfo?.standard_cost) || 0)
              };
          });

          setTransactions(processedTx);

      } catch (error) {
          console.error("Error loading report:", error);
      }
      setLoading(false);
  };

  // ==========================================
  // 🧠 FILTER & CALCULATE LOGIC
  // ==========================================
  const filteredData = useMemo(() => {
      return transactions.filter(tx => {
          const txDate = tx.dateObj.toISOString().split('T')[0];
          const matchDate = txDate >= startDate && txDate <= endDate;
          const matchBranch = selectedBranch === 'ALL' || tx.branch_id === selectedBranch;
          const matchCategory = selectedCategory === 'ALL' || tx.category === selectedCategory;
          
          // 🟢 รองรับการพิมพ์ค้นหาสินค้า
          const matchProduct = productSearchTerm === '' || 
              tx.product_id.toLowerCase().includes(productSearchTerm.toLowerCase()) || 
              tx.product_name.toLowerCase().includes(productSearchTerm.toLowerCase());

          return matchDate && matchBranch && matchCategory && matchProduct;
      });
  }, [transactions, startDate, endDate, selectedBranch, selectedCategory, productSearchTerm]);

  // 1. กราฟแท่งรายเดือน (Monthly Trend)
  const monthlyChartData = useMemo(() => {
      const monthMap: Record<string, number> = {};
      filteredData.forEach(tx => {
          const monthKey = tx.dateObj.toISOString().slice(0, 7); 
          monthMap[monthKey] = (monthMap[monthKey] || 0) + tx.qty;
      });
      return Object.keys(monthMap).sort().map(key => {
          const [year, month] = key.split('-');
          const date = new Date(Number(year), Number(month) - 1);
          return {
              name: date.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }),
              Qty: monthMap[key]
          };
      });
  }, [filteredData]);

  // 2. กราฟวงกลม สัดส่วนตามหมวดหมู่ (Category Distribution)
  const categoryChartData = useMemo(() => {
      const catMap: Record<string, number> = {};
      filteredData.forEach(tx => {
          catMap[tx.category] = (catMap[tx.category] || 0) + tx.qty;
      });
      return Object.keys(catMap).map(key => ({
          name: key,
          value: catMap[key]
      })).sort((a, b) => b.value - a.value); // เรียงจากมากไปน้อย
  }, [filteredData]);

  // 3. กราฟแท่งแนวนอน เปรียบเทียบสาขา (Top Branches Comparison)
  const branchComparisonData = useMemo(() => {
      const branchMap: Record<string, number> = {};
      filteredData.forEach(tx => {
          branchMap[tx.branch_id] = (branchMap[tx.branch_id] || 0) + tx.qty;
      });
      return Object.keys(branchMap).map(key => {
          const bInfo = branches.find(b => b.branch_id === key);
          return {
              name: bInfo ? bInfo.branch_name : key,
              Qty: branchMap[key]
          };
      }).sort((a, b) => b.Qty - a.Qty).slice(0, 5); // เอาแค่ Top 5 มาโชว์
  }, [filteredData, branches]);

  // KPI ภาพรวม
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

  const handleExport = () => {
      if (filteredData.length === 0) return alert("ไม่มีข้อมูลให้ Export");
      
      const exportPayload = filteredData.map(tx => {
          const pInfo = products.find(p => p.product_id === tx.product_id);
          const bInfo = branches.find(b => b.branch_id === tx.branch_id);
          return {
              'วันที่ส่ง (Date)': tx.dateObj.toLocaleDateString('th-TH'),
              'สาขาปลายทาง (Branch)': bInfo ? bInfo.branch_name : tx.branch_id,
              'หมวดหมู่ (Category)': tx.category,
              'รหัสสินค้า (SKU)': tx.product_id,
              'ชื่อสินค้า (Product)': tx.product_name,
              'จำนวนส่ง (Qty)': tx.qty,
              'มูลค่า (Value)': tx.value,
              'หน่วย (UOM)': pInfo ? pInfo.base_uom : '-',
              'เลขที่เอกสาร (Ref)': tx.reference_id || tx.transaction_id,
          };
      });

      const ws = XLSX.utils.json_to_sheet(exportPayload);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Branch_Delivery");
      XLSX.writeFile(wb, `Delivery_Report_${startDate}_to_${endDate}.xlsx`);
  };

  // Custom Tooltip สำหรับ Pie Chart
  const CustomTooltip = ({ active, payload }: any) => {
      if (active && payload && payload.length) {
          return (
              <div className="bg-white p-3 rounded-xl shadow-lg border border-slate-100 text-sm font-bold">
                  <div className="text-slate-500 mb-1">{payload[0].name}</div>
                  <div className="text-indigo-600">{Number(payload[0].value).toLocaleString()} หน่วย</div>
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
          <button onClick={handleExport} className="w-full md:w-auto px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 flex items-center justify-center gap-2 transition-all">
              <Download size={18}/> Export Excel
          </button>
      </div>

      {/* --- FILTERS PANEL (Responsive) --- */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row flex-wrap gap-4 items-center flex-shrink-0 relative z-20">
          
          <div className="flex w-full md:w-auto items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
              <Calendar size={18} className="text-indigo-500 ml-1 shrink-0"/>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-xs md:text-sm font-bold text-slate-700 outline-none cursor-pointer w-full"/>
              <span className="text-slate-400 font-bold">-</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-xs md:text-sm font-bold text-slate-700 outline-none cursor-pointer w-full pr-1"/>
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

          <div className="flex w-full md:w-auto items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 flex-1 min-w-[200px] relative focus-within:ring-2 focus-within:ring-indigo-100">
              <Search size={18} className="text-amber-500 ml-1 shrink-0"/>
              <input 
                  type="text" 
                  placeholder="ค้นหารหัส หรือ ชื่อสินค้า..." 
                  className="bg-transparent text-sm font-bold text-slate-700 outline-none w-full"
                  value={productSearchTerm}
                  onChange={e => setProductSearchTerm(e.target.value)}
              />
          </div>
      </div>

      {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center text-indigo-500">
              <Activity size={48} className="animate-spin mb-4"/>
              <span className="font-bold tracking-widest uppercase">Analyzing Data...</span>
          </div>
      ) : (
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-6 pb-6">
              
              {/* --- KPI SUMMARY CARDS --- */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6 shrink-0">
                  <div className="bg-white p-4 md:p-6 rounded-3xl shadow-sm border border-slate-200 flex items-center justify-between relative overflow-hidden group">
                      <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                      <div className="relative z-10">
                          <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Volume (ปริมาณ)</div>
                          <div className="text-xl md:text-3xl font-black text-slate-800">{kpiStats.totalQty.toLocaleString()} <span className="text-[10px] md:text-sm text-slate-400 font-medium">หน่วย</span></div>
                      </div>
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center relative z-10"><Package size={20} className="md:w-6 md:h-6"/></div>
                  </div>
                  
                  <div className="bg-white p-4 md:p-6 rounded-3xl shadow-sm border border-slate-200 flex items-center justify-between relative overflow-hidden group">
                      <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                      <div className="relative z-10">
                          <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Est. Value (มูลค่า)</div>
                          <div className="text-xl md:text-3xl font-black text-slate-800">฿{(kpiStats.totalValue / 1000).toFixed(1)}k</div>
                      </div>
                      <div className="w-10 h-10 md:w-12 md:h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center relative z-10"><TrendingUp size={20} className="md:w-6 md:h-6"/></div>
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

              {/* --- CHARTS DASHBOARD (3-Way Analysis) --- */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
                  
                  {/* 1. Bar Chart (Trend) */}
                  <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 lg:col-span-2">
                      <h2 className="text-sm md:text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <BarChart2 className="text-indigo-500 w-4 h-4 md:w-5 md:h-5"/> ปริมาณการจ่ายออกรายเดือน
                      </h2>
                      <div className="w-full h-64 md:h-72">
                          {monthlyChartData.length === 0 ? (
                              <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">ไม่พบข้อมูล</div>
                          ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={monthlyChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                      <defs>
                                          <linearGradient id="colorQty" x1="0" y1="0" x2="0" y2="1">
                                              <stop offset="5%" stopColor="#6366f1" stopOpacity={1}/>
                                              <stop offset="95%" stopColor="#818cf8" stopOpacity={0.6}/>
                                          </linearGradient>
                                      </defs>
                                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b', fontWeight: 600}} dy={10}/>
                                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}}/>
                                      <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)'}}/>
                                      <Bar dataKey="Qty" name="ยอดจ่ายออก" fill="url(#colorQty)" radius={[4, 4, 0, 0]} maxBarSize={50} />
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
                                          innerRadius={50} outerRadius={80}
                                          paddingAngle={5} dataKey="value"
                                      >
                                          {categoryChartData.map((entry, index) => (
                                              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                          ))}
                                      </Pie>
                                      <RechartsTooltip content={<CustomTooltip />} />
                                      <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }}/>
                                  </PieChart>
                              </ResponsiveContainer>
                          )}
                      </div>
                  </div>

                  {/* 3. Horizontal Bar Chart (Top Branches Comparison) */}
                  {selectedBranch === 'ALL' && (
                      <div className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 lg:col-span-3">
                          <h2 className="text-sm md:text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                              <Target className="text-emerald-500 w-4 h-4 md:w-5 md:h-5"/> เปรียบเทียบ Top 5 สาขาที่เบิกสูงสุด
                          </h2>
                          <div className="w-full h-64 md:h-80">
                              {branchComparisonData.length === 0 ? (
                                  <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">ไม่พบข้อมูล</div>
                              ) : (
                                  <ResponsiveContainer width="100%" height="100%">
                                      <BarChart data={branchComparisonData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0"/>
                                          <XAxis type="number" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}}/>
                                          <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#334155', fontWeight: 600}} width={120}/>
                                          <RechartsTooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'}}/>
                                          <Bar dataKey="Qty" name="ยอดเบิก (หน่วย)" fill="#10b981" radius={[0, 4, 4, 0]} barSize={24}>
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
              </div>

              {/* --- DETAILED DATA TABLE --- */}
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[300px]">
                  <div className="p-4 md:p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h2 className="font-bold text-slate-800 flex items-center gap-2 text-sm md:text-base"><Filter size={16} className="text-slate-400"/> รายการจัดส่งล่าสุด (Filtered)</h2>
                      <span className="text-[10px] md:text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">{filteredData.length} Records</span>
                  </div>
                  <div className="flex-1 overflow-x-auto">
                      <table className="w-full text-left text-sm whitespace-nowrap min-w-[600px]">
                          <thead className="bg-slate-100/80 backdrop-blur-sm text-slate-500 font-bold text-[10px] md:text-xs uppercase sticky top-0 z-10 shadow-sm border-b border-slate-200">
                              <tr>
                                  <th className="p-3 md:p-4 pl-4 md:pl-6">Date</th>
                                  <th className="p-3 md:p-4">Destination (Branch)</th>
                                  <th className="p-3 md:p-4">Product Info</th>
                                  <th className="p-3 md:p-4 text-center">Category</th>
                                  <th className="p-3 md:p-4 text-right">Qty Sent</th>
                                  <th className="p-3 md:p-4">Ref / Doc No.</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {filteredData.slice().reverse().slice(0, 50).map((tx, idx) => {
                                  const bInfo = branches.find(b => b.branch_id === tx.branch_id);

                                  return (
                                      <tr key={tx.transaction_id || idx} className="hover:bg-indigo-50/30 transition-colors">
                                          <td className="p-3 md:p-4 pl-4 md:pl-6">
                                              <div className="font-bold text-slate-700">{tx.dateObj.toLocaleDateString('th-TH')}</div>
                                              <div className="text-[9px] md:text-[10px] text-slate-400 mt-0.5">{tx.dateObj.toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</div>
                                          </td>
                                          <td className="p-3 md:p-4">
                                              <div className="font-bold text-emerald-700 flex items-center gap-1 text-xs md:text-sm truncate max-w-[150px] md:max-w-none"><MapPin size={12}/> {bInfo ? bInfo.branch_name : 'Unknown Branch'}</div>
                                              <div className="text-[9px] md:text-[10px] text-slate-500 font-mono mt-0.5 ml-4 md:ml-5">{tx.branch_id}</div>
                                          </td>
                                          <td className="p-3 md:p-4">
                                              <div className="font-bold text-slate-800 text-xs md:text-sm truncate max-w-[150px] md:max-w-none">{tx.product_name}</div>
                                              <div className="text-[9px] md:text-[10px] text-slate-500 font-mono mt-0.5">{tx.product_id}</div>
                                          </td>
                                          <td className="p-3 md:p-4 text-center">
                                              <span className="text-[9px] md:text-[10px] bg-slate-100 text-slate-600 px-2 py-1 rounded font-bold border border-slate-200">{tx.category}</span>
                                          </td>
                                          <td className="p-3 md:p-4 text-right">
                                              <span className="font-black text-base md:text-lg text-indigo-600">{tx.qty.toLocaleString()}</span>
                                          </td>
                                          <td className="p-3 md:p-4 text-[10px] md:text-xs text-slate-500 font-mono">
                                              {tx.reference_id || tx.transaction_id.split('-')[0]}
                                          </td>
                                      </tr>
                                  );
                              })}
                              {filteredData.length > 50 && (
                                  <tr><td colSpan={6} className="p-4 text-center text-xs font-bold text-slate-400 bg-slate-50">Showing top 50 recent records. Export to Excel to view all.</td></tr>
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