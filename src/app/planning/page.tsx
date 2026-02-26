"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Calendar as CalIcon, Save, Search, Package, TrendingUp, TrendingDown, 
    Minus, X, Filter, BarChart2, Zap, BrainCircuit, Activity, CheckCircle, 
    ShoppingCart, ArrowRight, MapPin, ChevronLeft, ChevronRight, Download, 
    FileSpreadsheet, Flame
} from 'lucide-react';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import * as XLSX from 'xlsx'; // 🟢 เพิ่ม Import XLSX สำหรับการ Export

export default function PlanningPage() {
  // --- CONFIGURATION ---
  const PLANNING_ROOMS = useMemo(() => [
      { id: 'FRESH', label: 'ของสด (ทั่วไป)' },
      { id: 'MEAT',  label: 'ของสด (หมู/ไก่/เนื้อ)' },
      { id: 'DRY',   label: 'ของแห้ง/เครื่องปรุง' },
      { id: 'SUPPLY',label: 'ของสิ้นเปลือง' },
      { id: 'DISH',  label: 'จานชาม/อุปกรณ์' },
      { id: 'UNIFORM', label: 'ยูนิฟอร์ม' },
      { id: 'ALCOHOL', label: 'แอลกอฮอล์/เครื่องดื่ม' }
  ], []);

  // --- STATE ---
  const [activeRoom, setActiveRoom] = useState(PLANNING_ROOMS[0]);
  const [activeTab, setActiveTab] = useState<'ANALYZE' | 'MANAGE'>('ANALYZE'); 
  const [loading, setLoading] = useState(true);
  
  // Data State
  const [products, setProducts] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [pendingPOs, setPendingPOs] = useState<any[]>([]);
  const [plannedOrders, setPlannedOrders] = useState<any[]>([]);

  // Manage Items State
  const [manageSearch, setManageSearch] = useState('');
  const [manageLocation, setManageLocation] = useState('ALL');
  const [localAssigned, setLocalAssigned] = useState<string[]>([]); 

  // Planning & Time Horizon State
  const [selectedMonth, setSelectedMonth] = useState(() => {
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });
  const [weekOffset, setWeekOffset] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  
  // 🟢 Advanced Forecasting States
  const [forecastStrategy, setForecastStrategy] = useState<'MA' | 'TREND' | 'PEAK'>('TREND');
  const [demandFactor, setDemandFactor] = useState<number>(1.0); // 1.0 = 100% Normal, 1.2 = +20% High Season

  // Modals
  const [forecastModal, setForecastModal] = useState<any>(null); 
  const [cellModal, setCellModal] = useState<any>(null); 

  useEffect(() => {
    fetchData();
  }, [selectedMonth]);

  const fetchData = async () => {
    setLoading(true);
    try {
        const dateLimit = new Date(); 
        dateLimit.setDate(dateLimit.getDate() - 60); 

        const [year, month] = selectedMonth.split('-');
        const startOfMonth = new Date(Number(year), Number(month) - 1, 1).toISOString().split('T')[0];
        const endOfMonth = new Date(Number(year), Number(month), 0).toISOString().split('T')[0];

        const [pRes, iRes, tRes, poHeadRes, poLineRes, planRes] = await Promise.all([
            supabase.from('master_products').select('*'),
            supabase.from('inventory_lots').select('product_id, quantity'),
            supabase.from('transactions_log').select('product_id, transaction_type, quantity_change, transaction_date').gte('transaction_date', dateLimit.toISOString()),
            supabase.from('purchase_orders').select('po_number, delivery_date').in('status', ['PENDING', 'PARTIAL']),
            supabase.from('po_lines').select('*'),
            supabase.from('planning_orders').select('*').gte('plan_date', startOfMonth).lte('plan_date', endOfMonth)
        ]);

        const stockMap: Record<string, number> = {};
        (iRes.data || []).forEach((lot: any) => { stockMap[lot.product_id] = (stockMap[lot.product_id] || 0) + Number(lot.quantity); });

        const safeProducts = (pRes.data || []).map(p => ({
            ...p,
            product_id: p.product_id || p.id,
            product_name: p.product_name || 'Unknown Item',
            current_qty: stockMap[p.product_id || p.id] || 0,
            planning_room: p.planning_room || null,
            default_location: p.default_location || 'Unassigned',
            base_uom: p.base_uom || 'Unit',
            purchase_uom: p.purchase_uom || p.base_uom || 'Unit',
            conversion_rate: Number(p.conversion_rate) || 1,
            min_stock: Number(p.min_stock) || 0
        }));
        setProducts(safeProducts);
        setTransactions(tRes.data || []);
        setPlannedOrders(planRes.data || []);

        if (poHeadRes.data && poLineRes.data) {
            const incoming = poLineRes.data.map((line: any) => {
                const header = poHeadRes.data.find((h:any) => h.po_number === line.po_number);
                return { product_id: line.product_id, qty: Number(line.ordered_qty) - Number(line.received_qty), date: header?.delivery_date };
            }).filter((i:any) => i.qty > 0 && i.date);
            setPendingPOs(incoming);
        }
    } catch (error) { console.error("Error fetching data:", error); }
    setLoading(false);
  };

  // ==================== PART 1: MANAGE ITEMS LOGIC ====================
  const uniqueLocations = useMemo(() => {
      const locs = new Set(products.map(p => p.default_location).filter(l => l && l !== 'Unassigned'));
      return ['ALL', ...Array.from(locs).sort()];
  }, [products]);

  const { assignedProducts, availableProducts } = useMemo(() => {
      const assigned: any[] = []; const available: any[] = [];
      products.forEach(p => {
          if (p.planning_room === activeRoom.id) assigned.push(p);
          else if (!p.planning_room) available.push(p);
      });
      return { assignedProducts: assigned, availableProducts: available };
  }, [products, activeRoom]);

  useEffect(() => { setLocalAssigned(assignedProducts.map(p => p.product_id)); }, [assignedProducts]);

  const handleSaveAssignment = async () => {
      if(!window.confirm(`บันทึกการจัดกลุ่มสินค้าสำหรับห้อง "${activeRoom.label}" หรือไม่?`)) return;
      setLoading(true);
      try {
          for (const pid of localAssigned) {
              await supabase.from('master_products').update({ planning_room: activeRoom.id }).eq('product_id', pid);
          }
          const removed = assignedProducts.filter(p => !localAssigned.includes(p.product_id));
          for (const p of removed) {
              await supabase.from('master_products').update({ planning_room: null }).eq('product_id', p.product_id);
          }
          alert("✅ บันทึกสำเร็จ!");
          fetchData(); 
      } catch (error: any) { alert("Error: " + error.message); }
      setLoading(false);
  };

  // ==================== PART 2: ADVANCED FORECASTING LOGIC ====================
  const getProductForecast = (product: any) => {
      const pid = product.product_id;
      let runningStock = product.current_qty;
      const today = new Date(); today.setHours(0,0,0,0);
      
      const [year, month] = selectedMonth.split('-');
      const planStart = new Date(Number(year), Number(month) - 1, 1);
      const daysInMonth = new Date(Number(year), Number(month), 0).getDate();

      // ดึง Transaction ขาออกเท่านั้น
      const txs = transactions.filter(t => t.product_id === pid && (t.transaction_type === 'OUTBOUND' || Number(t.quantity_change) < 0));
      
      let total30d = 0; let total7d = 0;
      let maxDaily = 0;
      const dailyUsageMap: Record<string, number> = {};

      const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
      const d7 = new Date(today); d7.setDate(d7.getDate() - 7);

      txs.forEach(t => {
          const tDate = new Date(t.transaction_date);
          const qty = Math.abs(Number(t.quantity_change));
          if (tDate >= d30) {
              total30d += qty;
              const dStr = tDate.toISOString().split('T')[0];
              dailyUsageMap[dStr] = (dailyUsageMap[dStr] || 0) + qty;
          }
          if (tDate >= d7) total7d += qty;
      });

      maxDaily = Object.values(dailyUsageMap).length > 0 ? Math.max(...Object.values(dailyUsageMap)) : 0;
      const avg30 = total30d / 30;
      const avg7 = total7d / 7;

      // 🟢 วิเคราะห์ Hot Trend (%)
      let trend = 'STABLE';
      let trendPercent = 0;
      if (avg30 > 0) {
          trendPercent = ((avg7 - avg30) / avg30) * 100;
          if (trendPercent >= 20) trend = 'UP';
          else if (trendPercent <= -20) trend = 'DOWN';
      } else if (avg7 > 0) {
          trend = 'UP'; trendPercent = 100;
      }

      // 🟢 เลือก Base Demand ตาม Strategy ที่เลือก
      let baseDemand = avg30;
      if (forecastStrategy === 'TREND') baseDemand = avg7 > avg30 ? avg7 : avg30;
      if (forecastStrategy === 'PEAK') baseDemand = maxDaily > 0 ? maxDaily : avg30;

      // 🟢 จำลอง Demand Factor (เช่น เผื่อวันหยุดยาว)
      let appliedDemand = baseDemand * demandFactor;
      if (appliedDemand === 0) appliedDemand = 0.1;

      // Map Incoming
      const incomingMap: Record<string, number> = {};
      pendingPOs.filter(po => po.product_id === pid).forEach(po => { incomingMap[po.date] = (incomingMap[po.date] || 0) + po.qty; });

      const manualPlanMap: Record<string, any> = {};
      plannedOrders.filter(plan => plan.product_id === pid).forEach(plan => { 
          manualPlanMap[plan.plan_date] = { baseQty: Number(plan.qty_base), purchaseQty: Number(plan.qty_purchase) }; 
      });

      // ลบสต๊อกล่วงหน้าหากเปิดดูเดือนอนาคต
      const daysUntilStart = Math.floor((planStart.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysUntilStart > 0) runningStock -= (appliedDemand * daysUntilStart);

      const timeline = [];
      for (let i = 0; i < daysInMonth; i++) {
          const bucketDate = new Date(planStart);
          bucketDate.setDate(bucketDate.getDate() + i);
          const bucketDateStr = bucketDate.toISOString().split('T')[0];
          
          let bucketIncomingPO = incomingMap[bucketDateStr] || 0;
          let plannedBase = manualPlanMap[bucketDateStr]?.baseQty || 0;
          let plannedPurchase = manualPlanMap[bucketDateStr]?.purchaseQty || 0;

          runningStock = runningStock - appliedDemand + bucketIncomingPO + plannedBase;

          timeline.push({
              dateObj: bucketDate,
              dateStr: bucketDateStr,
              label: bucketDate.toLocaleDateString('en-GB', {day:'2-digit', month:'short'}),
              demand: appliedDemand,
              incomingPO: bucketIncomingPO,
              plannedBase,
              plannedPurchase,
              projectedStock: runningStock
          });
      }

      return { avg30, appliedDemand, trend, trendPercent, maxDaily, timeline };
  };

  // ==================== SAVE CELL PLAN ====================
  const handleSavePlan = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const baseQtyInput = Number(formData.get('planned_base_qty'));
      if (baseQtyInput < 0) return alert("ห้ามใส่ค่าติดลบ");

      const product = cellModal.product;
      const dateStr = cellModal.dateStr;
      const purchaseQty = Math.ceil(baseQtyInput / product.conversion_rate);

      setLoading(true);
      try {
          const existingPlan = plannedOrders.find(p => p.product_id === product.product_id && p.plan_date === dateStr);
          if (baseQtyInput === 0 && existingPlan) {
              await supabase.from('planning_orders').delete().eq('id', existingPlan.id);
          } else if (baseQtyInput > 0) {
              if (existingPlan) {
                  await supabase.from('planning_orders').update({ qty_base: baseQtyInput, qty_purchase: purchaseQty }).eq('id', existingPlan.id);
              } else {
                  await supabase.from('planning_orders').insert([{ product_id: product.product_id, plan_date: dateStr, qty_base: baseQtyInput, qty_purchase: purchaseQty }]);
              }
          }
          setCellModal(null);
          fetchData(); 
      } catch (error: any) { alert("Save Error: " + error.message); }
      setLoading(false);
  };

  // ==================== 💾 EXPORT EXCEL LOGIC ====================
  const handleExportPlan = () => {
      const exportData: any[] = [];
      const targetProducts = products.filter(p => p.planning_room === activeRoom.id && (p.product_name||'').toLowerCase().includes(searchTerm.toLowerCase()));

      if (targetProducts.length === 0) return alert("ไม่มีข้อมูลสำหรับ Export");

      targetProducts.forEach(p => {
          const forecast = getProductForecast(p);
          const row: any = {
              'ห้อง (Room)': activeRoom.label,
              'รหัสสินค้า (SKU)': p.product_id,
              'ชื่อสินค้า (Product)': p.product_name,
              'หมวดหมู่ (Category)': p.category,
              'คงเหลือปัจจุบัน (Stock)': p.current_qty,
              'หน่วยจ่าย (Base UOM)': p.base_uom,
              'หน่วยสั่งซื้อ (Purchase UOM)': p.purchase_uom,
              'คาดการณ์ยอดใช้ต่อวัน (Est. Demand)': forecast.appliedDemand.toFixed(2),
              'Trend (%)': forecast.trendPercent !== 0 ? `${forecast.trendPercent > 0 ? '+' : ''}${forecast.trendPercent.toFixed(1)}%` : '-',
          };

          // ดึงข้อมูล 7 วันที่โชว์อยู่บนหน้าจอใส่ในคอลัมน์ Excel
          timelineHeaders.forEach(head => {
              const dayData = forecast.timeline.find(t => t.dateStr === head.dateStr);
              if (dayData) {
                  row[`[Plan] ${head.label}`] = dayData.plannedPurchase > 0 ? `${dayData.plannedPurchase} ${p.purchase_uom}` : '-';
                  row[`[Stock] ${head.label}`] = Math.round(dayData.projectedStock);
              }
          });

          exportData.push(row);
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, `Plan_Wk${weekOffset+1}`);
      XLSX.writeFile(wb, `Replenishment_Plan_${activeRoom.id}_${selectedMonth}_Wk${weekOffset+1}.xlsx`);
  };

  // --- Render Helpers ---
  const timelineHeaders = useMemo(() => {
      const [year, month] = selectedMonth.split('-');
      const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
      
      const startIdx = weekOffset * 7;
      const heads = [];
      for(let i = 0; i < 7; i++) { 
          const currentDay = startIdx + i + 1;
          if (currentDay <= daysInMonth) {
              const d = new Date(Number(year), Number(month) - 1, currentDay);
              heads.push({ dateStr: d.toISOString().split('T')[0], label: d.toLocaleDateString('en-GB', {weekday:'short', day:'2-digit'}) });
          }
      }
      return heads;
  }, [selectedMonth, weekOffset]);

  const maxWeeks = useMemo(() => {
      const [year, month] = selectedMonth.split('-');
      return Math.ceil(new Date(Number(year), Number(month), 0).getDate() / 7);
  }, [selectedMonth]);

  const [liveConversion, setLiveConversion] = useState(0);

  return (
    <div className="p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      {/* HEADER */}
      <div className="flex justify-between items-start mb-6 flex-shrink-0">
          <div>
              <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2"><CalIcon className="text-indigo-600"/> Smart Planning Center</h1>
              <p className="text-slate-500 text-sm mt-1">ระบบวางแผนและสั่งซื้ออัจฉริยะ พร้อมระบบพยากรณ์ความต้องการ (Forecast Engine)</p>
          </div>
          <div className="flex gap-3">
              {activeTab === 'ANALYZE' && (
                  <button onClick={handleExportPlan} className="px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm hover:bg-emerald-700 transition-colors">
                      <FileSpreadsheet size={16}/> Export Plan
                  </button>
              )}
              <div className="flex bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
                  <button onClick={() => setActiveTab('MANAGE')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ${activeTab === 'MANAGE' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
                      <Package size={16}/> Manage Rooms
                  </button>
                  <button onClick={() => setActiveTab('ANALYZE')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ${activeTab === 'ANALYZE' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
                      <TrendingUp size={16}/> Analyze & Plan
                  </button>
              </div>
          </div>
      </div>

      {/* ROOM TABS */}
      <div className="flex gap-2 overflow-x-auto pb-4 mb-2 scrollbar-hide flex-shrink-0">
          {PLANNING_ROOMS.map(room => (
              <button 
                  key={room.id}
                  onClick={() => { setActiveRoom(room); setLocalAssigned([]); setWeekOffset(0); }}
                  className={`px-5 py-2.5 rounded-full whitespace-nowrap text-sm font-bold border transition-all ${
                      activeRoom.id === room.id 
                      ? 'bg-slate-800 text-white border-slate-800 shadow-md scale-105' 
                      : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                  }`}
              >
                  {room.label}
              </button>
          ))}
      </div>

      {/* ==================== PART 1: MANAGE ITEMS (SPLIT PANE) ==================== */}
      {activeTab === 'MANAGE' && (
          <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
              <div className="p-4 border-b bg-slate-50 flex justify-between items-center">
                  <div className="flex gap-4 items-center flex-1">
                      <div className="relative w-64">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                          <input type="text" placeholder="Search available items..." className="w-full pl-9 p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" value={manageSearch} onChange={e => setManageSearch(e.target.value)}/>
                      </div>
                      <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-slate-200 shadow-sm">
                          <Filter size={16} className="text-slate-400"/>
                          <select 
                              className="bg-transparent text-sm font-bold text-slate-600 outline-none cursor-pointer"
                              value={manageLocation} onChange={e => setManageLocation(e.target.value)}
                          >
                              <option value="ALL">All Locations</option>
                              {uniqueLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                          </select>
                      </div>
                  </div>
                  <button onClick={handleSaveAssignment} disabled={loading} className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold shadow-md hover:bg-indigo-700 flex items-center gap-2 transition-all active:scale-95 disabled:bg-slate-300">
                      <Save size={18}/> Save Assignment
                  </button>
              </div>

              <div className="flex flex-1 overflow-hidden">
                  <div className="flex-1 border-r border-slate-200 flex flex-col bg-slate-50/50">
                      <div className="p-3 bg-white border-b border-slate-100 font-bold text-slate-500 text-xs uppercase flex justify-between tracking-widest">
                          <span className="flex items-center gap-2"><Filter size={14}/> Available Products</span>
                          <span className="bg-slate-100 px-2 py-0.5 rounded-md">{availableProducts.length}</span>
                      </div>
                      <div className="flex-1 overflow-auto p-3 space-y-2">
                          {availableProducts
                              .filter(p => (p.product_name||'').toLowerCase().includes(manageSearch.toLowerCase()) && (manageLocation === 'ALL' || p.default_location === manageLocation))
                              .slice(0, 100) 
                              .map(p => (
                              <div key={p.product_id} onClick={() => setLocalAssigned([...localAssigned, p.product_id])} className="bg-white p-3 rounded-xl border border-slate-200 hover:border-indigo-400 cursor-pointer flex justify-between items-center group shadow-sm hover:shadow-md transition-all">
                                  <div>
                                      <div className="font-bold text-slate-700 text-sm">{p.product_name}</div>
                                      <div className="text-xs text-slate-400 flex items-center gap-2 mt-1">
                                          <span className="bg-slate-100 font-mono px-1.5 rounded">{p.product_id}</span>
                                          <span className="flex items-center gap-1 text-[10px] bg-emerald-50 px-1.5 rounded text-emerald-600"><MapPin size={10}/> {p.default_location}</span>
                                      </div>
                                  </div>
                                  <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                                      <ArrowRight size={16}/>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>

                  <div className="flex-1 flex flex-col bg-white">
                      <div className="p-3 bg-indigo-50 border-b border-indigo-100 font-bold text-indigo-700 text-xs uppercase flex justify-between tracking-widest">
                          <span className="flex items-center gap-2"><CheckCircle size={14}/> Assigned to: {activeRoom.label}</span>
                          <span className="bg-white px-2 py-0.5 rounded-md border border-indigo-200">{localAssigned.length}</span>
                      </div>
                      <div className="flex-1 overflow-auto p-3 space-y-2">
                          {products.filter(p => localAssigned.includes(p.product_id)).map(p => (
                              <div key={p.product_id} className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 flex justify-between items-center shadow-sm">
                                  <div>
                                      <div className="font-bold text-slate-800 text-sm">{p.product_name}</div>
                                      <div className="text-xs text-slate-500 font-mono mt-1">{p.product_id}</div>
                                  </div>
                                  <button onClick={() => setLocalAssigned(localAssigned.filter(id => id !== p.product_id))} className="p-2 bg-white hover:bg-rose-50 rounded-full text-slate-400 hover:text-rose-500 border border-transparent hover:border-rose-200 transition-all shadow-sm">
                                      <X size={16}/>
                                  </button>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* ==================== PART 2: ANALYZE & PLAN (ADVANCED FORECAST) ==================== */}
      {activeTab === 'ANALYZE' && (
          <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
              {/* Top Controls */}
              <div className="p-4 border-b border-slate-200 flex flex-wrap justify-between items-center bg-slate-50 gap-4">
                  <div className="flex items-center gap-4">
                      
                      {/* 📅 Month Picker & Week Pagination */}
                      <div className="flex items-center gap-2 bg-white rounded-xl shadow-sm border border-slate-200 p-1.5">
                          <div className="flex items-center gap-2 px-2 border-r border-slate-100">
                              <CalIcon size={16} className="text-indigo-500"/>
                              <input type="month" value={selectedMonth} onChange={e => {setSelectedMonth(e.target.value); setWeekOffset(0);}} className="text-sm font-bold text-slate-700 outline-none cursor-pointer bg-transparent"/>
                          </div>
                          <div className="flex items-center gap-1 px-1">
                              <button onClick={() => setWeekOffset(w => Math.max(0, w-1))} disabled={weekOffset === 0} className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-30 transition-colors"><ChevronLeft size={16}/></button>
                              <span className="text-xs font-bold text-slate-600 w-20 text-center uppercase tracking-widest">Wk {weekOffset + 1} / {maxWeeks}</span>
                              <button onClick={() => setWeekOffset(w => Math.min(maxWeeks-1, w+1))} disabled={weekOffset >= maxWeeks-1} className="p-1.5 hover:bg-slate-100 rounded-lg disabled:opacity-30 transition-colors"><ChevronRight size={16}/></button>
                          </div>
                      </div>

                      {/* 📈 Forecast Strategy Control */}
                      <div className="flex items-center gap-2 bg-purple-50 px-3 py-1.5 rounded-xl border border-purple-200 shadow-sm">
                          <BrainCircuit size={16} className="text-purple-600"/>
                          <select value={forecastStrategy} onChange={(e) => setForecastStrategy(e.target.value as any)} className="bg-transparent text-sm font-bold text-purple-900 outline-none cursor-pointer border-r border-purple-200 pr-2">
                              <option value="MA">Moving Avg (30D)</option>
                              <option value="TREND">AI Trend (Hot/Cold)</option>
                              <option value="PEAK">Peak Protection (Max)</option>
                          </select>
                          
                          {/* Demand Multiplier (Scenario) */}
                          <select value={demandFactor} onChange={(e) => setDemandFactor(Number(e.target.value))} className="bg-transparent text-sm font-bold text-purple-700 outline-none cursor-pointer ml-1">
                              <option value={1.0}>100% (Normal)</option>
                              <option value={1.2}>120% (Holiday)</option>
                              <option value={1.5}>150% (High Season)</option>
                              <option value={0.8}>80% (Low Season)</option>
                          </select>
                      </div>

                  </div>

                  <div className="relative w-64">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                      <input type="text" placeholder="ค้นหาสินค้าในห้องนี้..." className="w-full pl-9 p-2 border border-slate-300 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}/>
                  </div>
              </div>

              <div className="flex-1 overflow-auto custom-scrollbar">
                  <table className="w-full text-left text-sm border-collapse">
                      <thead className="bg-slate-100/90 backdrop-blur-md text-slate-600 font-bold text-xs uppercase sticky top-0 z-30 shadow-sm">
                          <tr>
                              <th className="p-3 pl-6 sticky left-0 bg-slate-100 z-40 border-r border-slate-200 w-80 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Product Info</th>
                              <th className="p-3 text-center w-24 bg-white border-r border-slate-200">
                                  {forecastStrategy === 'PEAK' ? 'Max/Day' : 'Demand/Day'}
                              </th>
                              
                              {/* 🟢 7 Days Columns */}
                              {timelineHeaders.map((head, i) => (
                                  <th key={i} className="p-3 text-center min-w-[120px] border-r border-slate-200 bg-white">
                                      {head.label}
                                  </th>
                              ))}
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {products
                              .filter(p => p.planning_room === activeRoom.id && (p.product_name||'').toLowerCase().includes(searchTerm.toLowerCase()))
                              .map(p => {
                                  const forecast = getProductForecast(p);
                                  
                                  return (
                                      <tr key={p.product_id} className="hover:bg-slate-50 transition-colors group">
                                          {/* 1. Product Info */}
                                          <td className="p-3 pl-6 sticky left-0 bg-white group-hover:bg-slate-50 z-20 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                              <div className="font-bold text-slate-800 text-sm truncate max-w-[280px]" title={p.product_name}>{p.product_name}</div>
                                              <div className="flex items-center justify-between mt-1.5">
                                                  <div className="flex items-center gap-2">
                                                      <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded">{p.product_id}</span>
                                                      
                                                      {/* Trend Indicators */}
                                                      {forecast.trend === 'UP' && (
                                                          <span className="flex items-center gap-0.5 text-[9px] bg-rose-100 text-rose-600 px-1 py-0.5 rounded font-bold" title={`Trend UP ${forecast.trendPercent.toFixed(0)}%`}>
                                                              <Flame size={10}/> +{forecast.trendPercent.toFixed(0)}%
                                                          </span>
                                                      )}
                                                      {forecast.trend === 'DOWN' && (
                                                          <span className="flex items-center gap-0.5 text-[9px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded font-bold" title={`Trend DOWN ${forecast.trendPercent.toFixed(0)}%`}>
                                                              <TrendingDown size={10}/> {forecast.trendPercent.toFixed(0)}%
                                                          </span>
                                                      )}
                                                  </div>
                                                  <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100" title={`สั่งเป็น ${p.purchase_uom} / จ่ายเป็น ${p.base_uom}`}>
                                                      {p.purchase_uom} (={p.conversion_rate} {p.base_uom})
                                                  </span>
                                              </div>
                                          </td>
                                          
                                          {/* 2. Calculated Demand */}
                                          <td className="p-3 text-center border-r border-slate-100 font-mono font-bold text-slate-600 bg-slate-50/50 relative">
                                              <div className="text-sm text-slate-800">{forecast.appliedDemand.toFixed(1)}</div>
                                              {demandFactor !== 1 && <div className="text-[9px] text-purple-500 font-bold mt-0.5">x{demandFactor} applied</div>}
                                          </td>
                                          
                                          {/* 3. 7 Days Timeline Cells */}
                                          {timelineHeaders.map((head, idx) => {
                                              const dayData = forecast.timeline.find(t => t.dateStr === head.dateStr);
                                              if (!dayData) return <td key={idx} className="border-r border-slate-100"></td>;

                                              const isLow = dayData.projectedStock <= p.min_stock;
                                              const isNegative = dayData.projectedStock < 0;

                                              return (
                                                  <td 
                                                      key={idx} 
                                                      onClick={() => {
                                                          setCellModal({ product: p, ...dayData });
                                                          setLiveConversion(dayData.plannedPurchase);
                                                      }}
                                                      className={`relative p-2 border-r border-slate-100 h-[70px] min-w-[120px] cursor-pointer transition-colors hover:ring-2 hover:ring-inset hover:ring-indigo-400 ${isNegative ? 'bg-rose-50/50' : isLow ? 'bg-amber-50/30' : 'bg-white'}`}
                                                  >
                                                      {/* 🟢 มุมขวาบน (สีเขียว): จำนวนสั่ง (เป็นหน่วยซื้อ) */}
                                                      {(dayData.plannedPurchase > 0 || dayData.incomingPO > 0) && (
                                                          <div className="absolute top-1 right-1 flex flex-col items-end gap-1">
                                                              {dayData.plannedPurchase > 0 && <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shadow-sm border border-emerald-200" title={`แผนสั่งซื้อ: ${dayData.plannedPurchase} ${p.purchase_uom}`}>+{dayData.plannedPurchase} {p.purchase_uom}</span>}
                                                              {dayData.incomingPO > 0 && <span className="text-[9px] font-bold text-cyan-700 bg-cyan-100 px-1.5 py-0.5 rounded border border-cyan-200" title="รอรับเข้า (PO)">+{dayData.incomingPO} In</span>}
                                                          </div>
                                                      )}
                                                      
                                                      {/* 🟢 ตรงกลาง: สต๊อกคงเหลือ (Projected) */}
                                                      <div className="flex items-center justify-center h-full">
                                                          <div className={`font-black text-xl ${isNegative ? 'text-rose-600' : 'text-slate-800'} ${isLow && !isNegative ? 'text-amber-600' : ''}`}>
                                                              {Math.round(dayData.projectedStock)}
                                                          </div>
                                                      </div>

                                                      {/* 🟢 มุมล่างซ้าย (สีแดง): ยอดคาดการณ์การใช้ */}
                                                      <span className="absolute bottom-1 left-1 text-[9px] font-bold text-rose-400 bg-white/50 px-1 rounded" title="คาดการณ์ยอดใช้ (Demand)">
                                                          -{dayData.demand.toFixed(1)}
                                                      </span>
                                                  </td>
                                              );
                                          })}
                                      </tr>
                                  );
                              })}
                      </tbody>
                  </table>
                  {products.filter(p => p.planning_room === activeRoom.id).length === 0 && (
                      <div className="p-16 text-center text-slate-400 flex flex-col items-center">
                          <Package size={64} className="mb-4 opacity-20"/>
                          <p className="text-lg font-bold">ไม่มีสินค้าในหมวดหมู่ "{activeRoom.label}"</p>
                          <button onClick={()=>setActiveTab('MANAGE')} className="text-indigo-500 hover:underline mt-2 font-bold flex items-center gap-1">ไปที่หน้า Manage Rooms <ArrowRight size={14}/></button>
                      </div>
                  )}
              </div>
          </div>
      )}

      {/* ======================================= */}
      {/* 🚀 MODAL: CELL PLAN ENTRY */}
      {/* ======================================= */}
      {cellModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
                  <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-indigo-50 relative overflow-hidden">
                      <div className="absolute right-0 top-0 w-32 h-32 bg-white rounded-bl-full opacity-30 -mr-10 -mt-10"></div>
                      <div className="relative z-10">
                          <h3 className="font-bold text-indigo-800 flex items-center gap-2"><ShoppingCart size={18}/> Add Planned Order</h3>
                          <p className="text-xs text-indigo-600 mt-1">{cellModal.label} • {cellModal.product.product_name}</p>
                      </div>
                      <button onClick={() => setCellModal(null)} className="p-2 bg-white/50 rounded-full hover:bg-white text-indigo-500 relative z-10"><X size={18}/></button>
                  </div>
                  
                  <form onSubmit={handleSavePlan} className="p-6">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 mb-6 flex justify-between items-center text-xs text-slate-500 font-bold">
                          <span className="text-indigo-600">1 {cellModal.product.purchase_uom}</span>
                          <ArrowRight size={12}/>
                          <span>= {cellModal.product.conversion_rate} {cellModal.product.base_uom}</span>
                      </div>

                      <div className="mb-6">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 text-center">
                              ป้อนจำนวนสั่ง (คิดตามหน่วยจ่าย: {cellModal.product.base_uom})
                          </label>
                          <input 
                              type="number" min="0" name="planned_base_qty" 
                              defaultValue={cellModal.plannedBase || ''}
                              onChange={(e) => setLiveConversion(Math.ceil(Number(e.target.value) / cellModal.product.conversion_rate))}
                              className="w-full text-center text-5xl font-black text-indigo-600 border-b-2 border-slate-200 focus:border-indigo-500 outline-none pb-2 transition-colors bg-transparent"
                              placeholder="0" autoFocus
                          />
                          
                          <div className="text-center mt-4 text-sm font-bold text-emerald-700 bg-emerald-50 py-3 rounded-xl border border-emerald-200 flex flex-col items-center justify-center shadow-inner">
                              <span className="text-[10px] uppercase tracking-widest opacity-70 mb-1">ระบบจะบันทึกการสั่งซื้อเป็น</span>
                              <span className="text-2xl font-black">{liveConversion} <span className="text-sm font-medium">{cellModal.product.purchase_uom}</span></span>
                          </div>
                      </div>

                      <div className="flex gap-3">
                          <button type="button" onClick={() => setCellModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors">Cancel</button>
                          <button type="submit" disabled={loading} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 flex justify-center items-center gap-2 transition-all">
                              {loading ? 'Saving...' : <><Save size={18}/> Save Plan</>}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

    </div>
  );
}