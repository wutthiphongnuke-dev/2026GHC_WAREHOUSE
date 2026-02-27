"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Activity, Package, TrendingUp, AlertTriangle, 
    ArrowRight, Clock, Box, ShoppingCart, Truck, ShieldAlert, Calendar,
    Zap, BarChart3, Radio, PieChart as PieChartIcon
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
    Legend, ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';
import Link from 'next/link';

// ปรับสีให้ดูเป็นโทน Modern SaaS
const COLORS = ['#6366f1', '#14b8a6', '#f59e0b', '#f43f5e', '#0ea5e9', '#8b5cf6'];

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(new Date());

  // --- Filter States ---
  const [startDate, setStartDate] = useState(() => {
      const d = new Date(); d.setMonth(d.getMonth() - 3);
      return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  // --- States สำหรับข้อมูล ---
  const [kpi, setKpi] = useState({
      totalOutbound: 0,
      totalInbound: 0,
      lowStockCount: 0,
      pendingPOs: 0
  });
  
  const [trendData, setTrendData] = useState<any[]>([]);
  const [categoryData, setCategoryData] = useState<any[]>([]);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [recentTx, setRecentTx] = useState<any[]>([]);

  // นาฬิกา Real-time สำหรับ Command Center
  useEffect(() => {
      const timer = setInterval(() => setCurrentTime(new Date()), 1000);
      return () => clearInterval(timer);
  }, []);

  useEffect(() => {
      fetchDashboardData();
  }, [startDate, endDate]);

  const fetchDashboardData = async () => {
      setLoading(true);
      try {
          // 1. ดึงข้อมูล Master และ สต๊อก
          const [prodRes, lotRes, poRes] = await Promise.all([
              supabase.from('master_products').select('product_id, product_name, category, min_stock, base_uom'),
              supabase.from('inventory_lots').select('product_id, quantity'),
              supabase.from('purchase_orders').select('po_number').in('status', ['PENDING', 'PARTIAL'])
          ]);

          const products = prodRes.data || [];
          const lots = lotRes.data || [];
          const pendingPOs = poRes.data?.length || 0;

          const stockMap: Record<string, number> = {};
          lots.forEach(l => {
              stockMap[l.product_id] = (stockMap[l.product_id] || 0) + Number(l.quantity);
          });

          const lowStock: any[] = [];
          products.forEach(p => {
              const currentStock = stockMap[p.product_id] || 0;
              if (currentStock <= (p.min_stock || 0)) {
                  lowStock.push({ ...p, current_stock: currentStock, deficit: (p.min_stock || 0) - currentStock });
              }
          });

          // 2. เรียกใช้ RPC 
          const { data: rpcData, error: rpcError } = await supabase.rpc('get_dashboard_kpis', {
              start_date: `${startDate}T00:00:00.000Z`,
              end_date: `${endDate}T23:59:59.999Z`
          });

          if (rpcError) console.error("RPC Error:", rpcError);

          const totalInboundRPC = rpcData?.[0]?.total_inbound || 0;
          const totalOutboundRPC = rpcData?.[0]?.total_outbound || 0;

          // 3. ดึง Transaction
          const { data: txData } = await supabase
              .from('transactions_log')
              .select('*')
              .gte('transaction_date', `${startDate}T00:00:00.000Z`)
              .lte('transaction_date', `${endDate}T23:59:59.999Z`)
              .order('transaction_date', { ascending: false })
              .limit(5000); 

          const transactions = txData || [];

          const catMap: Record<string, number> = {};
          const trendMap: Record<string, { in: number, out: number }> = {};

          const sDate = new Date(startDate);
          const eDate = new Date(endDate);
          const diffDays = Math.ceil((eDate.getTime() - sDate.getTime()) / (1000 * 3600 * 24));
          const groupByMonth = diffDays > 31; 

          transactions.forEach(tx => {
              const pInfo = products.find(p => p.product_id === tx.product_id);
              const qty = Math.abs(Number(tx.quantity_change));
              const txDate = new Date(tx.transaction_date);
              
              let dateKey = '';
              if (groupByMonth) {
                  dateKey = txDate.toISOString().slice(0, 7);
              } else {
                  dateKey = txDate.toISOString().split('T')[0];
              }
              
              if (!trendMap[dateKey]) trendMap[dateKey] = { in: 0, out: 0 };

              if (tx.transaction_type === 'OUTBOUND') {
                  trendMap[dateKey].out += qty;
                  const cat = pInfo?.category || 'ไม่ระบุหมวดหมู่';
                  catMap[cat] = (catMap[cat] || 0) + qty;
              } else if (tx.transaction_type === 'INBOUND') {
                  trendMap[dateKey].in += qty;
              }
          });

          const formattedTrend = Object.keys(trendMap).sort().map(key => {
              let nameLabel = '';
              if (groupByMonth) {
                  const [y, m] = key.split('-');
                  nameLabel = new Date(Number(y), Number(m)-1).toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });
              } else {
                  nameLabel = new Date(key).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
              }
              return {
                  date: nameLabel,
                  'รับเข้า': trendMap[key].in,
                  'จ่ายออก': trendMap[key].out
              };
          });

          const formattedCategory = Object.keys(catMap).map(cat => ({
              name: cat,
              value: catMap[cat]
          })).sort((a, b) => b.value - a.value);

          setKpi({
              totalOutbound: totalOutboundRPC,
              totalInbound: totalInboundRPC,
              lowStockCount: lowStock.length,
              pendingPOs: pendingPOs
          });
          
          setCategoryData(formattedCategory);
          setTrendData(formattedTrend);
          setLowStockItems(lowStock.sort((a, b) => b.deficit - a.deficit).slice(0, 5));
          
          const recent = transactions.slice(0, 6).map(tx => ({
              ...tx,
              product_name: products.find(p => p.product_id === tx.product_id)?.product_name || 'Unknown'
          }));
          setRecentTx(recent);

      } catch (error) {
          console.error("Error fetching dashboard:", error);
      }
      setLoading(false);
  };

  const CustomTooltip = ({ active, payload }: any) => {
      if (active && payload && payload.length) {
          return (
              <div className="bg-slate-900/95 backdrop-blur-md p-4 rounded-2xl shadow-2xl border border-slate-700 text-sm font-bold text-white z-50">
                  <div className="text-slate-400 mb-2 border-b border-slate-700 pb-2">{payload[0].name || payload[0].payload.date}</div>
                  {payload.map((entry: any, index: number) => (
                      <div key={index} className="flex justify-between gap-6 items-center mb-1">
                          <span className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                              {entry.name}
                          </span>
                          <span className="text-lg font-black" style={{ color: entry.color }}>{Number(entry.value).toLocaleString()}</span>
                      </div>
                  ))}
              </div>
          );
      }
      return null;
  };

  if (loading) {
      return (
          <div className="h-full flex flex-col items-center justify-center bg-slate-50 relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03]"></div>
              <div className="relative z-10 flex flex-col items-center">
                  <div className="w-16 h-16 bg-white rounded-2xl shadow-2xl flex items-center justify-center mb-6 relative">
                      <div className="absolute inset-0 bg-indigo-500 rounded-2xl animate-ping opacity-20"></div>
                      <Zap size={32} className="text-indigo-600 animate-pulse"/>
                  </div>
                  <span className="font-black text-slate-800 tracking-widest uppercase text-xl">Initializing Workspace</span>
                  <span className="text-slate-400 text-sm mt-2">Connecting to secure database...</span>
              </div>
          </div>
      );
  }

  return (
    <div className="p-4 md:p-6 h-full bg-slate-50 flex flex-col font-sans overflow-y-auto custom-scrollbar relative">
      
      {/* Background Pattern */}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.02] pointer-events-none"></div>

      {/* --- FLOATING HEADER (Command Center Style) --- */}
      <div className="bg-white/80 backdrop-blur-xl border border-white shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-4 rounded-3xl mb-8 flex flex-col xl:flex-row justify-between xl:items-center gap-4 shrink-0 relative z-20">
          <div className="flex items-center gap-4 pl-2">
              <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                  <Activity className="text-white w-6 h-6"/>
              </div>
              <div>
                  <h1 className="text-xl md:text-2xl font-black text-slate-800 tracking-tight">WMS Command Center</h1>
                  <div className="flex items-center gap-3 text-xs md:text-sm font-medium mt-1">
                      <span className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100">
                          <Radio size={12} className="animate-pulse"/> System Online
                      </span>
                      <span className="text-slate-500 font-mono flex items-center gap-1">
                          <Clock size={12}/> {currentTime.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' })} • {currentTime.toLocaleTimeString('th-TH')}
                      </span>
                  </div>
              </div>
          </div>
          
          <div className="flex items-center gap-2 bg-slate-100/50 p-1.5 rounded-2xl border border-slate-200/60 w-full xl:w-auto">
              <div className="flex items-center bg-white px-3 py-2 rounded-xl shadow-sm border border-slate-100 flex-1 xl:flex-none">
                  <Calendar size={16} className="text-indigo-500 mr-2 shrink-0"/>
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full xl:w-auto"/>
              </div>
              <span className="text-slate-300 font-black px-1">-</span>
              <div className="flex items-center bg-white px-3 py-2 rounded-xl shadow-sm border border-slate-100 flex-1 xl:flex-none">
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full xl:w-auto"/>
              </div>
          </div>
      </div>

      {/* --- KPI CARDS (Hyper-Modern Hover Effects) --- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8 shrink-0 relative z-10">
          
          {/* Outbound Card */}
          <Link href="/branch-report" className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex flex-col relative overflow-hidden group hover:-translate-y-1 hover:shadow-2xl hover:shadow-indigo-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-indigo-500/20 transition-colors"></div>
              <div className="relative z-10 flex-1">
                  <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-50 to-indigo-100 border border-indigo-100 text-indigo-600 flex items-center justify-center group-hover:scale-110 transition-transform"><Truck size={24}/></div>
                      <div className="bg-slate-50 p-2 rounded-full text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors"><ArrowRight size={16}/></div>
                  </div>
                  <div className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Total Outbound</div>
                  <div className="text-3xl font-black text-slate-800 flex items-baseline gap-1">
                      {kpi.totalOutbound.toLocaleString()} <span className="text-sm font-bold text-slate-400">หน่วย</span>
                  </div>
              </div>
          </Link>

          {/* Inbound Card */}
          <Link href="/transactions" className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex flex-col relative overflow-hidden group hover:-translate-y-1 hover:shadow-2xl hover:shadow-emerald-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-emerald-500/20 transition-colors"></div>
              <div className="relative z-10 flex-1">
                  <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100 border border-emerald-100 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform"><Package size={24}/></div>
                      <div className="bg-slate-50 p-2 rounded-full text-slate-400 group-hover:bg-emerald-600 group-hover:text-white transition-colors"><ArrowRight size={16}/></div>
                  </div>
                  <div className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Total Inbound</div>
                  <div className="text-3xl font-black text-slate-800 flex items-baseline gap-1">
                      {kpi.totalInbound.toLocaleString()} <span className="text-sm font-bold text-slate-400">หน่วย</span>
                  </div>
              </div>
          </Link>

          {/* Alert Card */}
          <Link href="/warehouse" className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex flex-col relative overflow-hidden group hover:-translate-y-1 hover:shadow-2xl hover:shadow-rose-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-rose-500/20 transition-colors"></div>
              <div className="relative z-10 flex-1">
                  <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100 border border-rose-100 text-rose-600 flex items-center justify-center group-hover:scale-110 transition-transform relative">
                          {kpi.lowStockCount > 0 && <span className="absolute -top-1 -right-1 flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span></span>}
                          <ShieldAlert size={24}/>
                      </div>
                      <div className="bg-slate-50 p-2 rounded-full text-slate-400 group-hover:bg-rose-600 group-hover:text-white transition-colors"><ArrowRight size={16}/></div>
                  </div>
                  <div className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Low Stock Alert</div>
                  <div className="text-3xl font-black text-slate-800 flex items-baseline gap-1">
                      {kpi.lowStockCount} <span className="text-sm font-bold text-rose-500 bg-rose-50 px-2 py-0.5 rounded-lg ml-1">SKUs</span>
                  </div>
              </div>
          </Link>

          {/* PO Card */}
          <Link href="/inbound" className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex flex-col relative overflow-hidden group hover:-translate-y-1 hover:shadow-2xl hover:shadow-amber-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 rounded-full blur-3xl -mr-10 -mt-10 group-hover:bg-amber-500/20 transition-colors"></div>
              <div className="relative z-10 flex-1">
                  <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 border border-amber-100 text-amber-600 flex items-center justify-center group-hover:scale-110 transition-transform"><ShoppingCart size={24}/></div>
                      <div className="bg-slate-50 p-2 rounded-full text-slate-400 group-hover:bg-amber-500 group-hover:text-white transition-colors"><ArrowRight size={16}/></div>
                  </div>
                  <div className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-1">Pending Orders</div>
                  <div className="text-3xl font-black text-slate-800 flex items-baseline gap-1">
                      {kpi.pendingPOs} <span className="text-sm font-bold text-slate-400">POs</span>
                  </div>
              </div>
          </Link>
      </div>

      {/* --- CHARTS SECTION (Beautiful Recharts) --- */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mb-8 shrink-0">
          
          {/* Main Trend Chart */}
          <div className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 xl:col-span-2 flex flex-col">
              <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                      <BarChart3 className="text-indigo-500 w-5 h-5"/> Inventory Movement Trend
                  </h2>
                  <span className="text-xs font-bold text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">Daily / Monthly View</span>
              </div>
              <div className="w-full flex-1 min-h-[300px]">
                  {trendData.length === 0 ? (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-sm"><BarChart3 size={32} className="opacity-20 mb-2"/> No movement data found</div>
                  ) : (
                      <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }} barGap={2}>
                              <defs>
                                  <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#14b8a6" stopOpacity={1}/>
                                      <stop offset="95%" stopColor="#14b8a6" stopOpacity={0.4}/>
                                  </linearGradient>
                                  <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#6366f1" stopOpacity={1}/>
                                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0.4}/>
                                  </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#64748b', fontWeight: 600}} dy={10}/>
                              <YAxis axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#64748b'}}/>
                              <RechartsTooltip content={<CustomTooltip />} cursor={{fill: '#f8fafc'}} />
                              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }}/>
                              <Bar dataKey="รับเข้า" fill="url(#colorIn)" radius={[6, 6, 0, 0]} maxBarSize={30} />
                              <Bar dataKey="จ่ายออก" fill="url(#colorOut)" radius={[6, 6, 0, 0]} maxBarSize={30} />
                          </BarChart>
                      </ResponsiveContainer>
                  )}
              </div>
          </div>

          {/* Category Donut Chart */}
          <div className="bg-white p-6 rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 flex flex-col">
              <h2 className="text-lg font-black text-slate-800 mb-2 flex items-center gap-2">
                  <Box className="text-rose-500 w-5 h-5"/> Outbound by Category
              </h2>
              <div className="text-xs text-slate-400 mb-4 border-b border-slate-100 pb-2">สัดส่วนการเบิกจ่ายแยกตามหมวดหมู่สินค้า</div>
              <div className="w-full flex-1 min-h-[250px] relative">
                  {categoryData.length === 0 ? (
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 text-sm"><PieChartIcon size={32} className="opacity-20 mb-2"/> No category data</div>
                  ) : (
                      <>
                          {/* Inner Circle Label */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none mt-[-20px]">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</span>
                              <span className="text-xl font-black text-slate-800">{kpi.totalOutbound.toLocaleString()}</span>
                          </div>
                          <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                  <Pie
                                      data={categoryData}
                                      cx="50%" cy="45%"
                                      innerRadius={70} outerRadius={100}
                                      paddingAngle={3} dataKey="value"
                                      stroke="none"
                                  >
                                      {categoryData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                      ))}
                                  </Pie>
                                  <RechartsTooltip content={<CustomTooltip />} />
                                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 600, color: '#475569' }}/>
                              </PieChart>
                          </ResponsiveContainer>
                      </>
                  )}
              </div>
          </div>
      </div>

      {/* --- TABLES SECTION (Clean & Actionable) --- */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-6 shrink-0">
          
          {/* Action List: Low Stock */}
          <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden flex flex-col">
              <div className="p-5 flex justify-between items-center bg-white border-b border-slate-100">
                  <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center"><AlertTriangle size={18}/></div>
                      <div>
                          <h2 className="font-bold text-slate-800 text-base">Action Required: Low Stock</h2>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">รายการที่ต้องสั่งซื้อด่วน</p>
                      </div>
                  </div>
                  <Link href="/warehouse" className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors">View All</Link>
              </div>
              <div className="p-2">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          <tr>
                              <th className="p-3 pl-4">Product / SKU</th>
                              <th className="p-3 text-center">Current</th>
                              <th className="p-3 text-center">Minimum</th>
                              <th className="p-3 text-right pr-4">Status</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                          {lowStockItems.length === 0 ? (
                              <tr><td colSpan={4} className="p-10 text-center text-slate-400 font-medium">✨ All stock levels are healthy!</td></tr>
                          ) : lowStockItems.map(item => (
                              <tr key={item.product_id} className="hover:bg-slate-50/50 transition-colors group">
                                  <td className="p-3 pl-4">
                                      <div className="font-bold text-slate-800 text-sm truncate max-w-[200px]">{item.product_name}</div>
                                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{item.product_id}</div>
                                  </td>
                                  <td className="p-3 text-center font-black text-rose-600 text-lg">{item.current_stock}</td>
                                  <td className="p-3 text-center text-slate-500 font-medium">{item.min_stock}</td>
                                  <td className="p-3 text-right pr-4">
                                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-1 rounded-md border border-rose-200">
                                          Deficit -{item.deficit}
                                      </span>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>

          {/* Live Feed: Recent Transactions */}
          <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 overflow-hidden flex flex-col">
              <div className="p-5 flex justify-between items-center bg-white border-b border-slate-100">
                  <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center relative">
                          <span className="absolute top-0 right-0 flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-indigo-500"></span></span>
                          <Activity size={18}/>
                      </div>
                      <div>
                          <h2 className="font-bold text-slate-800 text-base">Live Activity Feed</h2>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ความเคลื่อนไหวล่าสุดในระบบ</p>
                      </div>
                  </div>
                  <Link href="/transactions" className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors">View History</Link>
              </div>
              <div className="p-2">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          <tr>
                              <th className="p-3 pl-4 w-28">Timestamp</th>
                              <th className="p-3 w-24 text-center">Event</th>
                              <th className="p-3">Product</th>
                              <th className="p-3 text-right pr-4">Volume</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                          {recentTx.length === 0 ? (
                              <tr><td colSpan={4} className="p-10 text-center text-slate-400 font-medium">📭 No recent activity</td></tr>
                          ) : recentTx.map((tx, idx) => {
                              const isOut = tx.transaction_type === 'OUTBOUND';
                              const isAdj = tx.transaction_type === 'ADJUST';
                              return (
                                  <tr key={idx} className="hover:bg-slate-50/50 transition-colors group">
                                      <td className="p-3 pl-4">
                                          <div className="text-xs font-bold text-slate-700">{new Date(tx.transaction_date).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</div>
                                          <div className="text-[9px] text-slate-400 mt-0.5 font-medium">{new Date(tx.transaction_date).toLocaleDateString('th-TH', {day:'2-digit', month:'short', year:'numeric'})}</div>
                                      </td>
                                      <td className="p-3 text-center">
                                          <span className={`text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-wider ${isOut ? 'bg-indigo-50 text-indigo-600 border border-indigo-100' : isAdj ? 'bg-amber-50 text-amber-600 border border-amber-100' : 'bg-emerald-50 text-emerald-600 border border-emerald-100'}`}>
                                              {tx.transaction_type}
                                          </span>
                                      </td>
                                      <td className="p-3">
                                          <div className="font-bold text-slate-800 text-sm truncate max-w-[180px]">{tx.product_name}</div>
                                      </td>
                                      <td className={`p-3 text-right pr-4 font-black text-base ${isOut || tx.quantity_change < 0 ? 'text-indigo-600' : 'text-emerald-600'}`}>
                                          {tx.quantity_change > 0 ? '+' : ''}{tx.quantity_change}
                                      </td>
                                  </tr>
                              );
                          })}
                      </tbody>
                  </table>
              </div>
          </div>

      </div>
    </div>
  );
}