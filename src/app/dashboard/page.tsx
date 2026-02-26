"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Activity, Package, TrendingUp, AlertTriangle, 
    ArrowRight, Clock, Box, ShoppingCart, Truck, ShieldAlert, Calendar
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
    Legend, ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';
import Link from 'next/link';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#0ea5e9', '#8b5cf6'];

export default function DashboardPage() {
  const [loading, setLoading] = useState(true);

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

          // คำนวณหา Low stock แจ้งเตือน
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

          // 🟢 2. เรียกใช้ RPC เพื่อให้ Database บวกเลข KPI ให้ (แม่นยำ 100% ยอดไม่ตกหล่น และเร็วมาก)
          const { data: rpcData, error: rpcError } = await supabase.rpc('get_dashboard_kpis', {
              start_date: `${startDate}T00:00:00.000Z`,
              end_date: `${endDate}T23:59:59.999Z`
          });

          if (rpcError) console.error("RPC Error:", rpcError);

          const totalInboundRPC = rpcData?.[0]?.total_inbound || 0;
          const totalOutboundRPC = rpcData?.[0]?.total_outbound || 0;

          // 🟢 3. ดึง Transaction แค่ 5,000 รายการล่าสุด เพื่อเอามาวาดกราฟ Trend และตารางล่าสุด (ป้องกันเว็บค้าง)
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
          const groupByMonth = diffDays > 31; // ถ้าดูเกิน 31 วัน ให้แสดงผลกราฟเป็นรายเดือน

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

          // 🟢 4. นำข้อมูลลง State (ใช้ค่ายอดรวมที่ได้จาก RPC มาโชว์ในการ์ด)
          setKpi({
              totalOutbound: totalOutboundRPC,
              totalInbound: totalInboundRPC,
              lowStockCount: lowStock.length,
              pendingPOs: pendingPOs
          });
          
          setCategoryData(formattedCategory);
          setTrendData(formattedTrend);
          setLowStockItems(lowStock.sort((a, b) => b.deficit - a.deficit).slice(0, 5));
          
          const recent = transactions.slice(0, 5).map(tx => ({
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
              <div className="bg-white p-3 rounded-xl shadow-lg border border-slate-100 text-sm font-bold">
                  <div className="text-slate-500 mb-1">{payload[0].name || payload[0].payload.date}</div>
                  {payload.map((entry: any, index: number) => (
                      <div key={index} style={{ color: entry.color }} className="flex justify-between gap-4">
                          <span>{entry.name}:</span>
                          <span>{Number(entry.value).toLocaleString()}</span>
                      </div>
                  ))}
              </div>
          );
      }
      return null;
  };

  if (loading) {
      return (
          <div className="h-full flex flex-col items-center justify-center text-cyan-600 bg-slate-50">
              <Activity size={48} className="animate-spin mb-4"/>
              <span className="font-bold tracking-widest uppercase">Syncing Live Data...</span>
          </div>
      );
  }

  return (
    <div className="p-4 md:p-6 h-full bg-slate-50 flex flex-col font-sans overflow-y-auto custom-scrollbar">
      
      {/* --- HEADER --- */}
      <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4 shrink-0">
          <div>
              <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                  <Activity className="text-cyan-500"/> Executive Dashboard
              </h1>
              <p className="text-slate-500 text-sm mt-1">ภาพรวมคลังสินค้าและการเคลื่อนไหว (กรองตามช่วงวันที่)</p>
          </div>
          
          <div className="flex items-center gap-2 bg-white p-2.5 rounded-xl shadow-sm border border-slate-200 w-full md:w-auto">
              <Calendar size={18} className="text-indigo-500 ml-1 shrink-0"/>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full md:w-auto"/>
              <span className="text-slate-400 font-bold">-</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full md:w-auto pr-1"/>
          </div>
      </div>

      {/* --- KPI CARDS (🟢 ปรับให้กดคลิกเพื่อไปดูข้อมูลจริงได้) --- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6 shrink-0">
          
          <Link href="/branch-report" className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex flex-col relative overflow-hidden group hover:ring-2 hover:ring-blue-400 cursor-pointer transition-all">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
              <div className="relative z-10 flex-1">
                  <div className="flex justify-between items-start mb-2">
                      <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center"><Truck size={20}/></div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500 transition-colors"/>
                  </div>
                  <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Total Outbound (จ่ายออก)</div>
                  <div className="text-xl md:text-2xl font-black text-slate-800 truncate">{kpi.totalOutbound.toLocaleString()} <span className="text-xs text-slate-400">หน่วย</span></div>
              </div>
          </Link>

          <Link href="/transactions" className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex flex-col relative overflow-hidden group hover:ring-2 hover:ring-emerald-400 cursor-pointer transition-all">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
              <div className="relative z-10 flex-1">
                  <div className="flex justify-between items-start mb-2">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center"><Package size={20}/></div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-emerald-500 transition-colors"/>
                  </div>
                  <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Total Inbound (รับเข้า)</div>
                  <div className="text-xl md:text-2xl font-black text-emerald-600">{kpi.totalInbound.toLocaleString()} <span className="text-xs text-slate-400">หน่วย</span></div>
              </div>
          </Link>

          <Link href="/warehouse" className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex flex-col relative overflow-hidden group hover:ring-2 hover:ring-rose-400 cursor-pointer transition-all">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-rose-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
              <div className="relative z-10 flex-1">
                  <div className="flex justify-between items-start mb-2">
                      <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center"><AlertTriangle size={20}/></div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-rose-500 transition-colors"/>
                  </div>
                  <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Low Stock Alerts</div>
                  <div className="text-xl md:text-2xl font-black text-rose-600">{kpi.lowStockCount} <span className="text-xs text-slate-400">SKUs</span></div>
              </div>
          </Link>

          <Link href="/inbound" className="bg-white p-5 rounded-3xl shadow-sm border border-slate-200 flex flex-col relative overflow-hidden group hover:ring-2 hover:ring-amber-400 cursor-pointer transition-all">
              <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
              <div className="relative z-10 flex-1">
                  <div className="flex justify-between items-start mb-2">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center"><Clock size={20}/></div>
                      <ArrowRight size={16} className="text-slate-300 group-hover:text-amber-500 transition-colors"/>
                  </div>
                  <div className="text-slate-500 text-[10px] md:text-xs font-bold uppercase tracking-wider mb-1">Pending POs</div>
                  <div className="text-xl md:text-2xl font-black text-slate-800">{kpi.pendingPOs} <span className="text-xs text-slate-400">POs</span></div>
              </div>
          </Link>
      </div>

      {/* --- CHARTS SECTION --- */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6 shrink-0">
          
          {/* Trend Bar Chart */}
          <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-slate-200 lg:col-span-2">
              <h2 className="text-sm md:text-base font-bold text-slate-800 mb-6 flex items-center gap-2">
                  <TrendingUp className="text-indigo-500 w-5 h-5"/> ความเคลื่อนไหว รับเข้า-จ่ายออก
              </h2>
              <div className="w-full h-64 md:h-72">
                  {trendData.length === 0 ? (
                      <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">ไม่พบข้อมูลความเคลื่อนไหว</div>
                  ) : (
                      <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b', fontWeight: 600}} dy={10}/>
                              <YAxis axisLine={false} tickLine={false} tick={{fontSize: 10, fill: '#64748b'}}/>
                              <RechartsTooltip content={<CustomTooltip />} />
                              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }}/>
                              <Bar dataKey="รับเข้า" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                              <Bar dataKey="จ่ายออก" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={40} />
                          </BarChart>
                      </ResponsiveContainer>
                  )}
              </div>
          </div>

          {/* Category Pie Chart */}
          <div className="bg-white p-5 md:p-6 rounded-3xl shadow-sm border border-slate-200 flex flex-col">
              <h2 className="text-sm md:text-base font-bold text-slate-800 mb-2 flex items-center gap-2">
                  <Box className="text-cyan-500 w-5 h-5"/> สัดส่วนการจ่ายออกตามหมวดหมู่
              </h2>
              <div className="w-full flex-1 min-h-[200px]">
                  {categoryData.length === 0 ? (
                      <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">ไม่พบข้อมูลการจ่ายออก</div>
                  ) : (
                      <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                              <Pie
                                  data={categoryData}
                                  cx="50%" cy="50%"
                                  innerRadius={60} outerRadius={90}
                                  paddingAngle={5} dataKey="value"
                              >
                                  {categoryData.map((entry, index) => (
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
      </div>

      {/* --- TABLES SECTION --- */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 shrink-0 pb-6">
          
          {/* Low Stock Table */}
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-rose-50/50">
                  <h2 className="font-bold text-rose-700 flex items-center gap-2"><ShieldAlert size={18}/> ต้องสั่งซื้อด่วน (Low Stock)</h2>
                  <Link href="/warehouse" className="text-xs font-bold text-rose-600 hover:underline">ดูทั้งหมด</Link>
              </div>
              <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-slate-500 font-bold text-[10px] uppercase">
                          <tr>
                              <th className="p-3 pl-5">Product Info</th>
                              <th className="p-3 text-center">Current</th>
                              <th className="p-3 text-center">Min</th>
                              <th className="p-3 text-right pr-5">Deficit</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {lowStockItems.length === 0 ? (
                              <tr><td colSpan={4} className="p-8 text-center text-slate-400 text-sm">สต๊อกปลอดภัยทุกรายการ 🎉</td></tr>
                          ) : lowStockItems.map(item => (
                              <tr key={item.product_id} className="hover:bg-slate-50">
                                  <td className="p-3 pl-5">
                                      <div className="font-bold text-slate-800 text-xs truncate max-w-[150px]">{item.product_name}</div>
                                      <div className="text-[10px] text-slate-500 font-mono">{item.product_id}</div>
                                  </td>
                                  <td className="p-3 text-center font-bold text-rose-600 bg-rose-50/30">{item.current_stock}</td>
                                  <td className="p-3 text-center text-slate-500 font-mono">{item.min_stock}</td>
                                  <td className="p-3 text-right pr-5 text-rose-600 font-black flex justify-end items-center gap-1">
                                      -{item.deficit} <span className="text-[10px] text-rose-400 font-normal">{item.base_uom}</span>
                                  </td>
                              </tr>
                          ))}
                      </tbody>
                  </table>
              </div>
          </div>

          {/* Recent Transactions Table */}
          <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-indigo-50/50">
                  <h2 className="font-bold text-indigo-700 flex items-center gap-2"><Clock size={18}/> ความเคลื่อนไหวล่าสุด</h2>
                  <Link href="/transactions" className="text-xs font-bold text-indigo-600 hover:underline">ดูประวัติทั้งหมด</Link>
              </div>
              <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                      <thead className="bg-slate-50 text-slate-500 font-bold text-[10px] uppercase">
                          <tr>
                              <th className="p-3 pl-5">Time</th>
                              <th className="p-3">Type</th>
                              <th className="p-3">Product Info</th>
                              <th className="p-3 text-right pr-5">Qty</th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {recentTx.length === 0 ? (
                              <tr><td colSpan={4} className="p-8 text-center text-slate-400 text-sm">ยังไม่มีความเคลื่อนไหว</td></tr>
                          ) : recentTx.map((tx, idx) => {
                              const isOut = tx.transaction_type === 'OUTBOUND';
                              const isAdj = tx.transaction_type === 'ADJUST';
                              return (
                                  <tr key={idx} className="hover:bg-slate-50">
                                      <td className="p-3 pl-5">
                                          <div className="text-[10px] font-bold text-slate-600">{new Date(tx.transaction_date).toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</div>
                                          <div className="text-[9px] text-slate-400">{new Date(tx.transaction_date).toLocaleDateString('th-TH', {day:'2-digit', month:'short'})}</div>
                                      </td>
                                      <td className="p-3">
                                          <span className={`text-[9px] font-black px-2 py-0.5 rounded uppercase ${isOut ? 'bg-rose-100 text-rose-600' : isAdj ? 'bg-amber-100 text-amber-600' : 'bg-emerald-100 text-emerald-600'}`}>
                                              {tx.transaction_type}
                                          </span>
                                      </td>
                                      <td className="p-3">
                                          <div className="font-bold text-slate-800 text-xs truncate max-w-[120px]">{tx.product_name}</div>
                                      </td>
                                      <td className={`p-3 text-right pr-5 font-black ${isOut || tx.quantity_change < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
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