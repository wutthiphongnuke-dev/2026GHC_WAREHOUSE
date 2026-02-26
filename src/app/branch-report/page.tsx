"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Store, Search, Calendar, Package, TrendingUp, Filter, 
    BarChart2, Download, MapPin, Activity, ArrowRight, Truck
} from 'lucide-react';
import { 
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, 
    Legend, ResponsiveContainer, Cell 
} from 'recharts';
import * as XLSX from 'xlsx';

export default function BranchDeliveryReport() {
  const [loading, setLoading] = useState(true);
  
  // --- Data States ---
  const [branches, setBranches] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);

  // --- Filter States ---
  const [selectedBranch, setSelectedBranch] = useState('ALL');
  const [selectedProduct, setSelectedProduct] = useState('ALL');
  const [startDate, setStartDate] = useState(() => {
      const d = new Date(); d.setMonth(d.getMonth() - 3); // Default ย้อนหลัง 3 เดือน
      return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
      fetchData();
  }, []);

  const fetchData = async () => {
      setLoading(true);
      try {
          // 1. ดึงข้อมูลสาขา และ สินค้า
          const [bRes, pRes] = await Promise.all([
              supabase.from('master_branches').select('branch_id, branch_name'),
              supabase.from('master_products').select('product_id, product_name, base_uom, standard_cost')
          ]);
          setBranches(bRes.data || []);
          setProducts(pRes.data || []);

          // 2. ดึงประวัติการจ่ายออก (OUTBOUND)
          // ⚠️ หมายเหตุ: สมมติว่าใน transactions_log มีการเก็บ branch_id หรือ destination เอาไว้
          // หากระบบคุณเก็บไว้ที่ตารางอื่น (เช่น orders) อาจต้อง Join ข้อมูล
          const { data: txData } = await supabase
              .from('transactions_log')
              .select('*')
              .eq('transaction_type', 'OUTBOUND') // ดึงเฉพาะขาออก
              .order('transaction_date', { ascending: true });

          // Mock Data Branch ID ลงไปใน Transaction ถ้าหาก Database เดิมไม่มี 
          // (เพื่อจำลองให้กราฟทำงานได้สมบูรณ์ กรุณาปรับให้เข้ากับ Schema จริงของคุณ)
          const processedTx = (txData || []).map(tx => ({
              ...tx,
              // สมมติว่าเก็บรหัสสาขาไว้ใน remarks หรือมี column branch_id ตรงๆ
              branch_id: tx.branch_id || tx.remarks?.split(' ')[1] || (bRes.data && bRes.data.length > 0 ? bRes.data[Math.floor(Math.random() * bRes.data.length)].branch_id : 'UNKNOWN'),
              qty: Math.abs(Number(tx.quantity_change)),
              dateObj: new Date(tx.transaction_date)
          }));

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
          const matchProduct = selectedProduct === 'ALL' || tx.product_id === selectedProduct;
          return matchDate && matchBranch && matchProduct;
      });
  }, [transactions, startDate, endDate, selectedBranch, selectedProduct]);

  // คำนวณข้อมูลสำหรับกราฟแท่งรายเดือน (Monthly Bar Chart)
  const monthlyChartData = useMemo(() => {
      const monthMap: Record<string, number> = {};
      
      filteredData.forEach(tx => {
          // ดึงปี-เดือน (YYYY-MM)
          const monthKey = tx.dateObj.toISOString().slice(0, 7); 
          monthMap[monthKey] = (monthMap[monthKey] || 0) + tx.qty;
      });

      // แปลงเป็น Array เพื่อเข้ากราฟ Recharts
      return Object.keys(monthMap).sort().map(key => {
          const [year, month] = key.split('-');
          const date = new Date(Number(year), Number(month) - 1);
          return {
              rawKey: key,
              name: date.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' }), // เช่น "ม.ค. 67"
              Qty: monthMap[key]
          };
      });
  }, [filteredData]);

  // คำนวณ KPI ภาพรวม
  const kpiStats = useMemo(() => {
      let totalQty = 0;
      let totalValue = 0;
      const branchCount = new Set();
      const productMap = new Map();

      filteredData.forEach(tx => {
          totalQty += tx.qty;
          branchCount.add(tx.branch_id);
          
          const pInfo = products.find(p => p.product_id === tx.product_id);
          if (pInfo) {
              totalValue += tx.qty * (Number(pInfo.standard_cost) || 0);
          }
      });

      return { totalQty, totalValue, activeBranches: branchCount.size };
  }, [filteredData, products]);

  // ==========================================
  // 💾 EXPORT EXCEL
  // ==========================================
  const handleExport = () => {
      if (filteredData.length === 0) return alert("ไม่มีข้อมูลให้ Export");
      
      const exportPayload = filteredData.map(tx => {
          const pInfo = products.find(p => p.product_id === tx.product_id);
          const bInfo = branches.find(b => b.branch_id === tx.branch_id);
          return {
              'วันที่ส่ง (Date)': tx.dateObj.toLocaleDateString('th-TH'),
              'สาขาปลายทาง (Branch)': bInfo ? bInfo.branch_name : tx.branch_id,
              'รหัสสินค้า (SKU)': tx.product_id,
              'ชื่อสินค้า (Product)': pInfo ? pInfo.product_name : '-',
              'จำนวนส่ง (Qty)': tx.qty,
              'หน่วย (UOM)': pInfo ? pInfo.base_uom : '-',
              'เลขที่เอกสาร (Ref)': tx.reference_id || tx.transaction_id,
          };
      });

      const ws = XLSX.utils.json_to_sheet(exportPayload);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Branch_Delivery");
      XLSX.writeFile(wb, `Delivery_Report_${startDate}_to_${endDate}.xlsx`);
  };

  return (
    <div className="p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      {/* --- HEADER --- */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 flex-shrink-0">
          <div>
              <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-xl shadow-inner"><Truck size={24}/></div>
                  Branch Delivery Report
              </h1>
              <p className="text-slate-500 text-sm mt-1">แดชบอร์ดรายงานการส่งสินค้าไปสาขา และวิเคราะห์การเติบโต</p>
          </div>
          <button onClick={handleExport} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-700 flex items-center gap-2 transition-all">
              <Download size={18}/> Export Excel
          </button>
      </div>

      {/* --- FILTERS PANEL --- */}
      <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 mb-6 flex flex-wrap gap-4 items-center flex-shrink-0 relative z-20">
          <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100">
              <Calendar size={18} className="text-indigo-500 ml-1"/>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer"/>
              <span className="text-slate-400 font-bold">-</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer pr-1"/>
          </div>

          <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 min-w-[200px] flex-1">
              <Store size={18} className="text-emerald-500 ml-1"/>
              <select value={selectedBranch} onChange={e => setSelectedBranch(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full">
                  <option value="ALL">ทุกสาขา (All Branches)</option>
                  {branches.map(b => <option key={b.branch_id} value={b.branch_id}>{b.branch_name} ({b.branch_id})</option>)}
              </select>
          </div>

          <div className="flex items-center gap-2 bg-slate-50 p-2 rounded-xl border border-slate-100 min-w-[250px] flex-1">
              <Package size={18} className="text-amber-500 ml-1"/>
              <select value={selectedProduct} onChange={e => setSelectedProduct(e.target.value)} className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer w-full">
                  <option value="ALL">ทุกสินค้า (All Products)</option>
                  {products.map(p => <option key={p.product_id} value={p.product_id}>{p.product_name}</option>)}
              </select>
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 shrink-0">
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex items-center justify-between relative overflow-hidden group">
                      <div className="absolute -right-6 -top-6 w-24 h-24 bg-blue-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                      <div className="relative z-10">
                          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Total Items Sent</div>
                          <div className="text-3xl font-black text-slate-800">{kpiStats.totalQty.toLocaleString()} <span className="text-sm text-slate-400 font-medium">หน่วย</span></div>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center relative z-10"><Package size={24}/></div>
                  </div>
                  
                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex items-center justify-between relative overflow-hidden group">
                      <div className="absolute -right-6 -top-6 w-24 h-24 bg-emerald-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                      <div className="relative z-10">
                          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Est. Value Sent</div>
                          <div className="text-3xl font-black text-slate-800">฿{(kpiStats.totalValue / 1000).toFixed(1)}k</div>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center relative z-10"><TrendingUp size={24}/></div>
                  </div>

                  <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 flex items-center justify-between relative overflow-hidden group">
                      <div className="absolute -right-6 -top-6 w-24 h-24 bg-amber-50 rounded-full group-hover:scale-150 transition-transform duration-500"></div>
                      <div className="relative z-10">
                          <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">Active Branches</div>
                          <div className="text-3xl font-black text-slate-800">{kpiStats.activeBranches} <span className="text-sm text-slate-400 font-medium">สาขา</span></div>
                      </div>
                      <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center relative z-10"><Store size={24}/></div>
                  </div>
              </div>

              {/* --- MONTHLY TREND CHART --- */}
              <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-200 shrink-0">
                  <h2 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                      <BarChart2 className="text-indigo-500"/> เทรนด์การส่งออกรายเดือน (Monthly Output Trend)
                  </h2>
                  <div className="w-full h-80">
                      {monthlyChartData.length === 0 ? (
                          <div className="w-full h-full flex items-center justify-center text-slate-400 font-medium">ไม่พบข้อมูลในช่วงเวลาที่เลือก</div>
                      ) : (
                          <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={monthlyChartData} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                                  <defs>
                                      <linearGradient id="colorQty" x1="0" y1="0" x2="0" y2="1">
                                          <stop offset="5%" stopColor="#6366f1" stopOpacity={1}/>
                                          <stop offset="95%" stopColor="#818cf8" stopOpacity={0.7}/>
                                      </linearGradient>
                                  </defs>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0"/>
                                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b', fontWeight: 600}} dy={10}/>
                                  <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}}/>
                                  <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)'}}/>
                                  <Bar dataKey="Qty" name="ยอดจ่ายออก (หน่วย)" fill="url(#colorQty)" radius={[6, 6, 0, 0]} maxBarSize={60}>
                                      {monthlyChartData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={index === monthlyChartData.length - 1 ? '#4f46e5' : 'url(#colorQty)'} />
                                      ))}
                                  </Bar>
                              </BarChart>
                          </ResponsiveContainer>
                      )}
                  </div>
              </div>

              {/* --- DETAILED DATA TABLE --- */}
              <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[300px]">
                  <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h2 className="font-bold text-slate-800 flex items-center gap-2"><Filter size={18} className="text-slate-400"/> รายการจัดส่งล่าสุด (Filtered)</h2>
                      <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full">{filteredData.length} Records</span>
                  </div>
                  <div className="flex-1 overflow-auto">
                      <table className="w-full text-left text-sm whitespace-nowrap">
                          <thead className="bg-slate-100/80 backdrop-blur-sm text-slate-500 font-bold text-xs uppercase sticky top-0 z-10 shadow-sm border-b border-slate-200">
                              <tr>
                                  <th className="p-4 pl-6">Date</th>
                                  <th className="p-4">Branch (Destination)</th>
                                  <th className="p-4">Product Info</th>
                                  <th className="p-4 text-right">Qty Sent</th>
                                  <th className="p-4">Ref / Doc No.</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {filteredData.slice().reverse().slice(0, 50).map((tx, idx) => {
                                  const pInfo = products.find(p => p.product_id === tx.product_id);
                                  const bInfo = branches.find(b => b.branch_id === tx.branch_id);

                                  return (
                                      <tr key={tx.transaction_id || idx} className="hover:bg-indigo-50/30 transition-colors">
                                          <td className="p-4 pl-6">
                                              <div className="font-bold text-slate-700">{tx.dateObj.toLocaleDateString('th-TH')}</div>
                                              <div className="text-[10px] text-slate-400 mt-0.5">{tx.dateObj.toLocaleTimeString('th-TH', {hour: '2-digit', minute:'2-digit'})}</div>
                                          </td>
                                          <td className="p-4">
                                              <div className="font-bold text-emerald-700 flex items-center gap-1"><MapPin size={14}/> {bInfo ? bInfo.branch_name : 'Unknown Branch'}</div>
                                              <div className="text-[10px] text-slate-500 font-mono mt-0.5 ml-5">{tx.branch_id}</div>
                                          </td>
                                          <td className="p-4">
                                              <div className="font-bold text-slate-800">{pInfo ? pInfo.product_name : tx.product_id}</div>
                                              <div className="text-[10px] text-slate-500 font-mono mt-0.5">{tx.product_id}</div>
                                          </td>
                                          <td className="p-4 text-right">
                                              <span className="font-black text-lg text-indigo-600">{tx.qty.toLocaleString()}</span>
                                              <span className="text-xs text-slate-400 ml-1">{pInfo ? pInfo.base_uom : 'Unit'}</span>
                                          </td>
                                          <td className="p-4 text-xs text-slate-500 font-mono">
                                              {tx.reference_id || tx.transaction_id.split('-')[0]}
                                          </td>
                                      </tr>
                                  );
                              })}
                              {filteredData.length > 50 && (
                                  <tr><td colSpan={5} className="p-4 text-center text-xs font-bold text-slate-400 bg-slate-50">Showing top 50 recent records. Export to Excel to view all.</td></tr>
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