"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../supabaseClient';
import Link from 'next/link';
import { 
    LayoutDashboard, Package, TrendingUp, TrendingDown, 
    AlertTriangle, DollarSign, Activity, Calendar, PieChart as PieIcon, ArrowRight, Clock, Box, ShieldCheck, Zap, Users, Home, X
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
    PieChart, Pie, Cell, Legend 
} from 'recharts';

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);
  
  // States สำหรับเก็บข้อมูลสถิติ
  const [stats, setStats] = useState({
      totalValue: 0,
      totalItems: 0,
      totalBranches: 0,
      totalVendors: 0,
      lowStockCount: 0,
      inboundToday: 0,
      outboundToday: 0,
      inboundValToday: 0,
      outboundValToday: 0
  });

  // States สำหรับกราฟและลิสต์
  const [graphData, setGraphData] = useState<any[]>([]); 
  const [categoryData, setCategoryData] = useState<any[]>([]); 
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [recentTrans, setRecentTrans] = useState<any[]>([]);

  // State สำหรับ Interactive Modal
  const [selectedTx, setSelectedTx] = useState<any | null>(null);

  // โทนสีล้ำสมัย (Neon / Cyberpunk)
  const COLORS = ['#06b6d4', '#8b5cf6', '#d946ef', '#f43f5e', '#10b981', '#f59e0b'];

  const fetchDashboardData = useCallback(async () => {
      setLoading(true);
      try {
          // 1. ดึง Master Data Counts
          const { count: branchesCount } = await supabase.from('master_branches').select('*', { count: 'exact', head: true });
          const { count: vendorsCount } = await supabase.from('master_vendors').select('*', { count: 'exact', head: true });

          // 2. ดึง Master Products และ Inventory Lots
          const { data: productsData } = await supabase.from('master_products').select('product_id, product_name, category, standard_cost, min_stock, base_uom, status');
          const { data: lotsData } = await supabase.from('inventory_lots').select('product_id, quantity');
          
          const products = productsData || [];
          const productMap: Record<string, any> = {};
          products.forEach(p => productMap[p.product_id] = p);

          const stockMap: Record<string, number> = {};
          (lotsData || []).forEach((lot: any) => {
              stockMap[lot.product_id] = (stockMap[lot.product_id] || 0) + Number(lot.quantity);
          });

          // --- คำนวณ Overview Stats & Low Stock ---
          let tValue = 0;
          let tItems = 0; 
          let lowStockArr: any[] = [];
          const catMap: Record<string, number> = {};

          products.forEach(p => {
              const currentQty = stockMap[p.product_id] || 0;
              const minStock = Number(p.min_stock) || 0;
              const cost = Number(p.standard_cost) || 0;

              if (currentQty > 0) {
                  tItems += 1;
                  const itemValue = currentQty * cost;
                  tValue += itemValue;

                  const cat = p.category || 'Uncategorized';
                  catMap[cat] = (catMap[cat] || 0) + itemValue;
              }

              if (currentQty <= minStock && p.status === 'ACTIVE') {
                  lowStockArr.push({
                      id: p.product_id,
                      name: p.product_name,
                      stock: currentQty,
                      min: minStock,
                      unit: p.base_uom || 'Unit'
                  });
              }
          });

          const pieData = Object.keys(catMap).map(key => ({
              name: key,
              value: catMap[key]
          })).sort((a, b) => b.value - a.value).slice(0, 5);

          // 3. ดึง Transaction Log ย้อนหลัง 7 วัน
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
          sevenDaysAgo.setHours(0, 0, 0, 0);

          const { data: txsData } = await supabase
              .from('transactions_log')
              .select('*')
              .gte('transaction_date', sevenDaysAgo.toISOString())
              .order('transaction_date', { ascending: false });

          const txs = txsData || [];

          // --- คำนวณ Today Stats & กราฟ 7 วัน ---
          const todayStr = new Date().toISOString().split('T')[0];
          let inToday = 0; let outToday = 0;
          let inValToday = 0; let outValToday = 0;
          const recentLogs: any[] = [];
          const dailyDataMap: Record<string, { Inbound: number, Outbound: number }> = {};
          
          for (let i = 6; i >= 0; i--) {
              const d = new Date(); d.setDate(d.getDate() - i);
              dailyDataMap[d.toISOString().split('T')[0]] = { Inbound: 0, Outbound: 0 };
          }

          txs.forEach((t: any) => {
              const dateStr = new Date(t.transaction_date).toISOString().split('T')[0];
              const qty = Math.abs(Number(t.quantity_change) || 0);
              const cost = Number(productMap[t.product_id]?.standard_cost) || 0;
              const val = qty * cost;

              // เก็บ History 15 รายการล่าสุดสำหรับ List
              if (recentLogs.length < 15) {
                  recentLogs.push({
                      id: t.transaction_id,
                      type: t.transaction_type,
                      product_id: t.product_id,
                      product_name: productMap[t.product_id]?.product_name || 'Unknown',
                      qty: t.quantity_change,
                      balance: t.balance_after,
                      remarks: t.remarks,
                      date: new Date(t.transaction_date)
                  });
              }

              if (dateStr === todayStr) {
                  if (t.transaction_type === 'INBOUND' || Number(t.quantity_change) > 0) {
                      inToday += qty; inValToday += val;
                  } else {
                      outToday += qty; outValToday += val;
                  }
              }

              if (dailyDataMap[dateStr]) {
                  if (t.transaction_type === 'INBOUND' || Number(t.quantity_change) > 0) dailyDataMap[dateStr].Inbound += qty;
                  else dailyDataMap[dateStr].Outbound += qty;
              }
          });

          const barData = Object.keys(dailyDataMap).sort().map(dateStr => {
              const d = new Date(dateStr);
              return { name: `${d.getDate()}/${d.getMonth()+1}`, Inbound: dailyDataMap[dateStr].Inbound, Outbound: dailyDataMap[dateStr].Outbound };
          });

          // Set All States
          setStats({
              totalValue: tValue,
              totalItems: tItems,
              totalBranches: branchesCount || 0,
              totalVendors: vendorsCount || 0,
              lowStockCount: lowStockArr.length,
              inboundToday: inToday,
              outboundToday: outToday,
              inboundValToday: inValToday,
              outboundValToday: outValToday
          });
          setLowStockItems(lowStockArr.sort((a,b) => a.stock - b.stock).slice(0, 10));
          setCategoryData(pieData);
          setGraphData(barData);
          setRecentTrans(recentLogs);

      } catch (error) {
          console.error("Error loading dashboard data:", error);
      }
      setLoading(false);
  }, []);

  useEffect(() => {
      fetchDashboardData();
  }, [fetchDashboardData]);

  return (
    <div className="p-6 bg-slate-50 h-full flex flex-col overflow-y-auto rounded-2xl relative font-sans selection:bg-cyan-200">
      
      {/* --- HEADER --- */}
      <div className="mb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
        <div>
            <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-slate-800 via-slate-700 to-cyan-700 flex items-center gap-3 tracking-tight">
                <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-xl shadow-lg shadow-cyan-200/50">
                    <Activity size={24} className="text-white" />
                </div>
                Command Center
            </h1>
            <p className="text-slate-500 text-sm mt-2 flex items-center gap-2 font-medium">
                <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span></span>
                Live Database Connected
            </p>
        </div>
        <div className="text-xs font-bold text-slate-500 flex items-center gap-4 bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-1"><Home size={14} className="text-emerald-500"/> {stats.totalBranches} สาขา</div>
            <div className="w-px h-4 bg-slate-200"></div>
            <div className="flex items-center gap-1"><Users size={14} className="text-fuchsia-500"/> {stats.totalVendors} คู่ค้า</div>
            <div className="w-px h-4 bg-slate-200"></div>
            <div className="flex items-center gap-2 text-cyan-600"><Calendar size={14}/> {new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' })}</div>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <Zap size={48} className="animate-pulse mb-4 text-cyan-500 opacity-50"/>
            <p className="text-lg font-bold tracking-widest uppercase">Syncing Data...</p>
        </div>
      ) : (
        <>
          {/* --- KPI CARDS (Sci-Fi Glassmorphism) --- */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
              
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-[0_0_25px_rgba(6,182,212,0.15)] hover:border-cyan-300 transition-all duration-300 relative overflow-hidden group">
                  <div className="absolute -right-6 -top-6 w-32 h-32 bg-gradient-to-br from-cyan-100 to-transparent rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700"></div>
                  <div className="relative z-10">
                      <div className="text-slate-500 font-bold text-xs uppercase tracking-wider mb-2 flex items-center justify-between">
                          Total Investment <DollarSign size={14} className="text-cyan-500"/>
                      </div>
                      <div className="text-3xl font-black text-slate-800 mb-2 tracking-tight">฿{(stats.totalValue / 1000).toFixed(1)}<span className="text-lg text-slate-400">k</span></div>
                      <div className="text-[10px] text-cyan-700 font-bold bg-cyan-50 w-max px-2 py-1 rounded-md border border-cyan-100 flex items-center gap-1">
                          <ShieldCheck size={12}/> {stats.totalItems} Active SKUs
                      </div>
                  </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-[0_0_25px_rgba(16,185,129,0.15)] hover:border-emerald-300 transition-all duration-300 relative overflow-hidden group">
                  <div className="absolute -right-6 -top-6 w-32 h-32 bg-gradient-to-br from-emerald-100 to-transparent rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700"></div>
                  <div className="relative z-10">
                      <div className="text-slate-500 font-bold text-xs uppercase tracking-wider mb-2 flex items-center justify-between">
                          Today Inbound <TrendingUp size={14} className="text-emerald-500"/>
                      </div>
                      <div className="text-3xl font-black text-slate-800 mb-2 tracking-tight">{stats.inboundToday.toLocaleString()} <span className="text-sm text-slate-400 font-medium">Qty</span></div>
                      <div className="text-[10px] text-emerald-700 font-bold bg-emerald-50 w-max px-2 py-1 rounded-md border border-emerald-100">
                          มูลค่า: ฿{stats.inboundValToday.toLocaleString()}
                      </div>
                  </div>
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 hover:shadow-[0_0_25px_rgba(244,63,94,0.15)] hover:border-rose-300 transition-all duration-300 relative overflow-hidden group">
                  <div className="absolute -right-6 -top-6 w-32 h-32 bg-gradient-to-br from-rose-100 to-transparent rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700"></div>
                  <div className="relative z-10">
                      <div className="text-slate-500 font-bold text-xs uppercase tracking-wider mb-2 flex items-center justify-between">
                          Today Outbound <TrendingDown size={14} className="text-rose-500"/>
                      </div>
                      <div className="text-3xl font-black text-slate-800 mb-2 tracking-tight">{stats.outboundToday.toLocaleString()} <span className="text-sm text-slate-400 font-medium">Qty</span></div>
                      <div className="text-[10px] text-rose-700 font-bold bg-rose-50 w-max px-2 py-1 rounded-md border border-rose-100">
                          มูลค่า: ฿{stats.outboundValToday.toLocaleString()}
                      </div>
                  </div>
              </div>

              <div className={`bg-white p-6 rounded-2xl shadow-sm border transition-all duration-300 relative overflow-hidden group ${stats.lowStockCount > 0 ? 'border-orange-300 shadow-[0_0_15px_rgba(249,115,22,0.1)]' : 'border-slate-200'}`}>
                  <div className={`absolute -right-6 -top-6 w-32 h-32 rounded-full opacity-50 group-hover:scale-150 transition-transform duration-700 ${stats.lowStockCount > 0 ? 'bg-gradient-to-br from-orange-100 to-transparent' : 'bg-slate-50'}`}></div>
                  <div className="relative z-10">
                      <div className="text-slate-500 font-bold text-xs uppercase tracking-wider mb-2 flex items-center justify-between">
                          Stock Warning <AlertTriangle size={14} className={stats.lowStockCount > 0 ? "text-orange-500" : "text-slate-400"}/>
                      </div>
                      <div className={`text-3xl font-black mb-2 tracking-tight ${stats.lowStockCount > 0 ? 'text-orange-600' : 'text-slate-800'}`}>{stats.lowStockCount} <span className="text-sm font-medium text-slate-400">SKUs</span></div>
                      {stats.lowStockCount > 0 ? (
                          <div className="text-[10px] text-orange-700 font-bold bg-orange-50 w-max px-2 py-1 rounded-md border border-orange-200 flex items-center gap-1 animate-pulse">
                              ต้องการสั่งซื้อด่วน
                          </div>
                      ) : (
                          <div className="text-[10px] text-slate-500 font-bold bg-slate-100 w-max px-2 py-1 rounded-md border border-slate-200 flex items-center gap-1">
                              สต๊อกอยู่ในเกณฑ์ปกติ
                          </div>
                      )}
                  </div>
              </div>
          </div>

          {/* --- CHARTS SECTION --- */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Bar Chart */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 lg:col-span-2">
                  <div className="flex justify-between items-center mb-6">
                      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                          <Activity size={16} className="text-fuchsia-500"/> Volume Trend (7 Days)
                      </h2>
                  </div>
                  <div className="h-64 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={graphData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 'bold'}} dy={10}/>
                              <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#94a3b8', fontWeight: 'bold'}}/>
                              <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)'}}/>
                              <Legend iconType="circle" wrapperStyle={{fontSize: '11px', fontWeight: 'bold', color: '#64748b'}}/>
                              <Bar dataKey="Inbound" fill="url(#colorIn)" radius={[4, 4, 0, 0]} maxBarSize={20} />
                              <Bar dataKey="Outbound" fill="url(#colorOut)" radius={[4, 4, 0, 0]} maxBarSize={20} />
                              <defs>
                                  <linearGradient id="colorIn" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#10b981" stopOpacity={1}/>
                                      <stop offset="95%" stopColor="#34d399" stopOpacity={0.8}/>
                                  </linearGradient>
                                  <linearGradient id="colorOut" x1="0" y1="0" x2="0" y2="1">
                                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={1}/>
                                      <stop offset="95%" stopColor="#fb7185" stopOpacity={0.8}/>
                                  </linearGradient>
                              </defs>
                          </BarChart>
                      </ResponsiveContainer>
                  </div>
              </div>

              {/* Donut Chart */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 relative">
                  <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                      <PieIcon size={16} className="text-cyan-500"/> Value by Category
                  </h2>
                  <div className="flex-1 h-64 relative">
                      {categoryData.length > 0 ? (
                          <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                  <Pie data={categoryData} cx="50%" cy="50%" innerRadius={65} outerRadius={85} paddingAngle={5} dataKey="value" stroke="none">
                                      {categoryData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                      ))}
                                  </Pie>
                                  <Tooltip formatter={(value: any) => `฿${Number(value || 0).toLocaleString()}`} contentStyle={{borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'}}/>
                              </PieChart>
                          </ResponsiveContainer>
                      ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400 font-bold">No Data</div>
                      )}
                      
                      {categoryData.length > 0 && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-4">
                              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Top Cat</span>
                              <span className="text-sm font-black text-slate-700 truncate w-28 text-center">{categoryData[0]?.name}</span>
                          </div>
                      )}
                  </div>
              </div>
          </div>

          {/* --- INTERACTIVE DATA LISTS --- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-6">
              
              {/* Critical Low Stock */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col">
                  <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                          <AlertTriangle size={16} className="text-orange-500"/> Action Required (Low Stock)
                      </h2>
                      <Link href="/warehouse" className="text-xs font-bold text-cyan-600 hover:text-cyan-700 hover:underline flex items-center gap-1">
                          จัดการสต๊อก <ArrowRight size={12}/>
                      </Link>
                  </div>
                  <div className="p-2 flex-1 overflow-auto">
                      {lowStockItems.length === 0 ? (
                          <div className="text-center py-10 text-slate-400 flex flex-col items-center">
                              <Box size={32} className="opacity-20 mb-2"/>
                              <p className="text-sm font-bold">All stocks are healthy.</p>
                          </div>
                      ) : lowStockItems.map((item, idx) => (
                          <div key={idx} className="flex justify-between items-center p-3 m-1 hover:bg-slate-50 rounded-xl transition-colors border border-transparent hover:border-slate-200">
                              <div className="flex items-start gap-3">
                                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-100 to-red-50 flex items-center justify-center text-orange-600 shadow-inner">
                                      <Package size={18}/>
                                  </div>
                                  <div>
                                      <div className="font-bold text-slate-700 text-sm">{item.name}</div>
                                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{item.id}</div>
                                  </div>
                              </div>
                              <div className="text-right">
                                  <div className="font-black text-orange-600 text-lg">{item.stock} <span className="text-xs font-normal text-slate-500">{item.unit}</span></div>
                                  <div className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">Min: {item.min}</div>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>

              {/* Clickable Live Feed */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col">
                  <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                      <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                          <Clock size={16} className="text-cyan-500"/> Live Operations Feed
                      </h2>
                  </div>
                  <div className="p-2 flex-1 overflow-auto max-h-[350px]">
                      {recentTrans.length === 0 ? (
                          <div className="text-center py-10 text-slate-400 text-sm font-bold">No recent activities.</div>
                      ) : recentTrans.map((t, idx) => (
                          <div 
                              key={idx} 
                              onClick={() => setSelectedTx(t)}
                              className="flex justify-between items-center p-3 m-1 hover:bg-cyan-50 cursor-pointer rounded-xl transition-all border border-transparent hover:border-cyan-100 group"
                          >
                              <div className="flex items-center gap-3">
                                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-md ${
                                      t.type === 'INBOUND' || Number(t.qty) > 0 ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 
                                      t.type === 'OUTBOUND' || Number(t.qty) < 0 ? 'bg-gradient-to-br from-rose-400 to-rose-600' : 'bg-slate-400'
                                  }`}>
                                      {t.type === 'INBOUND' || Number(t.qty) > 0 ? <TrendingUp size={16}/> : <TrendingDown size={16}/>}
                                  </div>
                                  <div>
                                      <div className="font-bold text-slate-700 text-sm group-hover:text-cyan-700 transition-colors">
                                          {t.product_name}
                                      </div>
                                      <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate max-w-[150px]">
                                          {t.remarks || t.id}
                                      </div>
                                  </div>
                              </div>
                              <div className="text-right">
                                  <div className={`font-black text-sm ${Number(t.qty) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                      {Number(t.qty) > 0 ? '+' : ''}{t.qty}
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                                      {t.date.toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}
                                  </div>
                              </div>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
        </>
      )}

      {/* --- HOLOGRAPHIC TRANSACTION MODAL --- */}
      {selectedTx && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-slate-200">
                  <div className={`p-6 relative overflow-hidden ${Number(selectedTx.qty) > 0 ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                      <div className="absolute right-0 top-0 w-32 h-32 opacity-10 bg-black rounded-bl-full -mr-10 -mt-10"></div>
                      <div className="flex justify-between items-start relative z-10">
                          <div>
                              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Transaction Details</div>
                              <h3 className={`text-2xl font-black ${Number(selectedTx.qty) > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                                  {Number(selectedTx.qty) > 0 ? 'INBOUND' : 'OUTBOUND'}
                              </h3>
                          </div>
                          <button onClick={() => setSelectedTx(null)} className="p-2 bg-white/50 hover:bg-white rounded-full text-slate-500 transition-colors"><X size={18}/></button>
                      </div>
                  </div>
                  
                  <div className="p-6 space-y-4">
                      <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Product Info</label>
                          <div className="font-bold text-slate-800">{selectedTx.product_name}</div>
                          <div className="text-xs text-slate-500 font-mono mt-0.5">{selectedTx.product_id}</div>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4 border-y border-slate-100 py-4">
                          <div>
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Change Qty</label>
                              <div className={`text-xl font-black ${Number(selectedTx.qty) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                  {Number(selectedTx.qty) > 0 ? '+' : ''}{selectedTx.qty}
                              </div>
                          </div>
                          <div>
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Balance After</label>
                              <div className="text-xl font-black text-slate-800">{selectedTx.balance}</div>
                          </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Date & Time</label>
                              <div className="text-sm font-bold text-slate-700">
                                  {selectedTx.date.toLocaleDateString('th-TH')} <br/>
                                  <span className="text-slate-500">{selectedTx.date.toLocaleTimeString('th-TH')} น.</span>
                              </div>
                          </div>
                          <div>
                              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block mb-1">Remarks / Ref</label>
                              <div className="text-sm font-medium text-slate-600 break-words">{selectedTx.remarks || '-'}</div>
                          </div>
                      </div>
                  </div>
                  
                  <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-center">
                      <div className="text-[10px] text-slate-400 font-mono">TX_ID: {selectedTx.id}</div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}