"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    Calendar as CalIcon, Save, Search, Package, TrendingUp, TrendingDown, 
    Minus, X, Filter, BarChart2, Zap, BrainCircuit, Activity, CheckCircle, 
    ShoppingCart, ArrowRight, MapPin, ChevronLeft, ChevronRight, Download, 
    FileSpreadsheet, Flame, Wand2, Settings, AlertTriangle, Plus, Trash2, RefreshCw
} from 'lucide-react';
import * as XLSX from 'xlsx';

const DEFAULT_ROOMS = [
    { id: 'FRESH', label: 'ของสด (ทั่วไป)' },
    { id: 'MEAT',  label: 'ของสด (หมู/ไก่/เนื้อ)' },
    { id: 'DRY',   label: 'ของแห้ง/เครื่องปรุง' },
    { id: 'SUPPLY',label: 'ของสิ้นเปลือง' },
    { id: 'DISH',  label: 'จานชาม/อุปกรณ์' }
];

export default function PlanningPage() {
  const [userRole, setUserRole] = useState<string>('VIEWER');
  const [planningRooms, setPlanningRooms] = useState<any[]>(DEFAULT_ROOMS);
  const [newRoomName, setNewRoomName] = useState('');
  const [isAddingRoom, setIsAddingRoom] = useState(false);

  const [activeRoom, setActiveRoom] = useState(DEFAULT_ROOMS[0]);
  const [activeTab, setActiveTab] = useState<'ANALYZE' | 'MANAGE'>('ANALYZE'); 
  const [loading, setLoading] = useState(true);
  const [syncProgress, setSyncProgress] = useState(''); 
  
  const [products, setProducts] = useState<any[]>([]);
  const [historicalDemand, setHistoricalDemand] = useState<any[]>([]); 
  const [pendingPOs, setPendingPOs] = useState<any[]>([]);
  const [plannedOrders, setPlannedOrders] = useState<any[]>([]);

  // 🟢 Manage Items States (เพิ่ม State สำหรับ Category)
  const [manageSearch, setManageSearch] = useState('');
  const [manageLocation, setManageLocation] = useState('ALL');
  const [manageCategory, setManageCategory] = useState('ALL');

  const [selectedMonth, setSelectedMonth] = useState(() => {
      const today = new Date();
      return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });
  const [weekOffset, setWeekOffset] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [baseAvgPeriod, setBaseAvgPeriod] = useState<number>(30); 
  const [forecastStrategy, setForecastStrategy] = useState<'MA' | 'TREND' | 'PEAK' | 'ARIMA'>('ARIMA'); 
  const [demandFactor, setDemandFactor] = useState<number>(1.0); 

  const [cellModal, setCellModal] = useState<any>(null); 
  const [liveConversion, setLiveConversion] = useState(0);
  const [editingProduct, setEditingProduct] = useState<any>(null); 

  useEffect(() => {
    const savedRooms = localStorage.getItem('wms_custom_planning_rooms');
    if (savedRooms) {
        try {
            const parsed = JSON.parse(savedRooms);
            if (parsed && parsed.length > 0) {
                setPlanningRooms(parsed);
                setActiveRoom(parsed[0]);
            }
        } catch(e) {}
    }

    const fetchRole = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            const { data } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).single();
            setUserRole(data?.role || 'VIEWER');
        }
    };
    fetchRole();
    fetchData();
  }, [selectedMonth]);

  const isViewer = userRole === 'VIEWER';

  const fetchData = async () => {
    setLoading(true);
    setSyncProgress('กำลังเตรียมข้อมูล...');
    try {
        const dateLimit = new Date(); 
        dateLimit.setDate(dateLimit.getDate() - 120); 
        dateLimit.setHours(0, 0, 0, 0);
        const dateLimitStr = dateLimit.toISOString().split('T')[0];

        const [year, month] = selectedMonth.split('-');
        const startOfMonth = new Date(Number(year), Number(month) - 1, 1).toISOString().split('T')[0];
        const endOfMonth = new Date(Number(year), Number(month), 0).toISOString().split('T')[0];

        const [pRes, iRes, poHeadRes, poLineRes, planRes] = await Promise.all([
            supabase.from('master_products').select('*'),
            supabase.from('inventory_lots').select('product_id, quantity'),
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
            category: p.category || 'Unknown',
            base_uom: p.base_uom || 'Unit',
            purchase_uom: p.purchase_uom || p.base_uom || 'Unit',
            conversion_rate: Number(p.conversion_rate) || 1,
            min_stock: Number(p.min_stock) || 0,
            moq: Number(p.moq) || 1 
        }));
        setProducts(safeProducts);
        setPlannedOrders(planRes.data || []);

        if (poHeadRes.data && poLineRes.data) {
            const incoming = poLineRes.data.map((line: any) => {
                const header = poHeadRes.data.find((h:any) => h.po_number === line.po_number);
                return { product_id: line.product_id, qty: Number(line.ordered_qty) - Number(line.received_qty), date: header?.delivery_date };
            }).filter((i:any) => i.qty > 0 && i.date);
            setPendingPOs(incoming);
        }

        setSyncProgress('กำลังดึงประวัติการเบิกจ่าย...');
        let allTransactions: any[] = [];
        let hasMore = true;
        let offset = 0;
        const limitSize = 1000; 

        while (hasMore) {
            const { data: tData, error: tErr } = await supabase
                .from('transactions_log')
                .select('product_id, transaction_type, quantity_change, transaction_date')
                .gte('transaction_date', dateLimitStr)
                .range(offset, offset + limitSize - 1); 

            if (tErr) {
                console.error("Error loading transactions:", tErr);
                break;
            }

            if (tData && tData.length > 0) {
                allTransactions = [...allTransactions, ...tData];
                offset += limitSize;
                setSyncProgress(`ดึงประวัติแล้ว ${allTransactions.length} รายการ...`);
                
                if (tData.length < limitSize) {
                    hasMore = false; 
                }
            } else {
                hasMore = false;
            }
        }

        setSyncProgress('กำลังประมวลผลข้อมูล...');
        const pastDemand: any[] = [];
        allTransactions.forEach(t => {
            if (!t.transaction_date) return;
            const type = String(t.transaction_type).toUpperCase();
            const qty = Number(t.quantity_change);
            
            const isOutboundKeyword = type.includes('OUT') || type.includes('TRANS') || type.includes('DISP') || type.includes('ISSUE') || type.includes('SALE') || type.includes('USE');
            const isNegativeButNotAdjust = qty < 0 && !type.includes('ADJUST') && !type.includes('CYCLE') && !type.includes('IN') && !type.includes('RECV') && !type.includes('RECEIPT');

            if (isOutboundKeyword || isNegativeButNotAdjust) {
                const d = new Date(t.transaction_date);
                if (isNaN(d.getTime())) return;
                
                const localDateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                
                pastDemand.push({
                    product_id: t.product_id,
                    date: localDateStr, 
                    qty: Math.abs(qty)
                });
            }
        });
        setHistoricalDemand(pastDemand);

    } catch (error) { console.error("Error fetching data:", error); }
    setLoading(false);
    setSyncProgress('');
  };

  const handleAddRoom = () => {
      if (!newRoomName.trim()) return;
      const newId = `ROOM_${Date.now()}`;
      const newRooms = [...planningRooms, { id: newId, label: newRoomName.trim() }];
      setPlanningRooms(newRooms);
      localStorage.setItem('wms_custom_planning_rooms', JSON.stringify(newRooms));
      setNewRoomName('');
      setIsAddingRoom(false);
      setActiveRoom(newRooms[newRooms.length - 1]);
  };

  const handleDeleteRoom = async (roomId: string, roomLabel: string) => {
      if (!window.confirm(`ลบหมวดหมู่ "${roomLabel}" หรือไม่?\n(สินค้าในหมวดนี้จะถูกปลดออกไปอยู่รายการที่ยังไม่จัดกลุ่ม)`)) return;
      
      const newRooms = planningRooms.filter(r => r.id !== roomId);
      if (newRooms.length === 0) newRooms.push(DEFAULT_ROOMS[0]); 
      
      setPlanningRooms(newRooms);
      localStorage.setItem('wms_custom_planning_rooms', JSON.stringify(newRooms));
      if (activeRoom.id === roomId) setActiveRoom(newRooms[0]);

      await supabase.from('master_products').update({ planning_room: null }).eq('planning_room', roomId);
      setProducts(products.map(p => p.planning_room === roomId ? { ...p, planning_room: null } : p));
  };

  const toggleProductAssignment = async (product: any, assignToRoomId: string | null) => {
      if (isViewer) return;
      setProducts(products.map(p => p.product_id === product.product_id ? { ...p, planning_room: assignToRoomId } : p));
      try {
          await supabase.from('master_products').update({ planning_room: assignToRoomId }).eq('product_id', product.product_id);
      } catch (e) {
          console.error("Failed to save assignment", e);
          setProducts(products.map(p => p.product_id === product.product_id ? { ...p, planning_room: product.planning_room } : p));
          alert("ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่");
      }
  };

  const handleSaveMasterData = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if(isViewer) return;
      const formData = new FormData(e.currentTarget);
      const newMinStock = Number(formData.get('min_stock'));

      if (newMinStock < 0) return alert("ห้ามใส่ค่าติดลบ");

      setLoading(true);
      try {
          const { error } = await supabase.from('master_products')
              .update({ min_stock: newMinStock })
              .eq('product_id', editingProduct.product_id);
          
          if (error) throw error;
          
          setProducts(products.map(p => p.product_id === editingProduct.product_id ? { ...p, min_stock: newMinStock } : p));
          setEditingProduct(null);
      } catch (error: any) { alert("Update Error: " + error.message); }
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

      const txs = historicalDemand.filter(t => t.product_id === pid);
      
      let totalBasePeriod = 0; let total7d = 0;
      let maxDaily = 0;
      const dailyUsageMap: Record<string, number> = {};

      const dBase = new Date(today); dBase.setDate(dBase.getDate() - baseAvgPeriod + 1);
      const d7 = new Date(today); d7.setDate(d7.getDate() - 7 + 1);

      for (let i = 0; i < baseAvgPeriod; i++) {
          const tempD = new Date(today);
          tempD.setDate(tempD.getDate() - i);
          const tempDStr = `${tempD.getFullYear()}-${String(tempD.getMonth()+1).padStart(2,'0')}-${String(tempD.getDate()).padStart(2,'0')}`;
          dailyUsageMap[tempDStr] = 0;
      }

      txs.forEach(t => {
          const [ty, tm, td] = t.date.split('-');
          const tDate = new Date(Number(ty), Number(tm) - 1, Number(td));
          const qty = t.qty;
          
          if (tDate >= dBase && tDate <= today) {
              totalBasePeriod += qty;
              if (dailyUsageMap[t.date] !== undefined) {
                  dailyUsageMap[t.date] += qty;
              }
          }
          if (tDate >= d7 && tDate <= today) {
              total7d += qty;
          }
      });

      const dailyValues = Object.values(dailyUsageMap);
      maxDaily = dailyValues.length > 0 ? Math.max(...dailyValues) : 0;
      const avgBase = totalBasePeriod / baseAvgPeriod;
      const avg7 = total7d / 7;

      let stdDev = 0;
      if (baseAvgPeriod > 0) {
          const variance = dailyValues.reduce((acc, val) => acc + Math.pow(val - avgBase, 2), 0) / baseAvgPeriod;
          stdDev = Math.sqrt(variance);
      }

      let trend = 'STABLE';
      let trendPercent = 0;
      if (avgBase > 0) {
          trendPercent = ((avg7 - avgBase) / avgBase) * 100;
          if (trendPercent >= 20) trend = 'UP';
          else if (trendPercent <= -20) trend = 'DOWN';
      } else if (avg7 > 0) {
          trend = 'UP'; trendPercent = 100;
      }

      let baseDemand = avgBase;
      if (forecastStrategy === 'TREND') baseDemand = avg7 > avgBase ? avg7 : avgBase;
      if (forecastStrategy === 'PEAK') baseDemand = maxDaily > 0 ? maxDaily : avgBase;
      if (forecastStrategy === 'ARIMA') baseDemand = avgBase + (1.28 * stdDev); 

      let appliedDemand = baseDemand * demandFactor;
      const hasDataInPeriod = totalBasePeriod > 0;

      const incomingMap: Record<string, number> = {};
      pendingPOs.filter(po => po.product_id === pid).forEach(po => { incomingMap[po.date] = (incomingMap[po.date] || 0) + po.qty; });

      const manualPlanMap: Record<string, any> = {};
      plannedOrders.filter(plan => plan.product_id === pid).forEach(plan => { 
          manualPlanMap[plan.plan_date] = { baseQty: Number(plan.qty_base), purchaseQty: Number(plan.qty_purchase) }; 
      });

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

      return { avgBase, stdDev, appliedDemand, trend, trendPercent, maxDaily, timeline, hasDataInPeriod, baseAvgPeriod };
  };

  const handleSavePlan = async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if(isViewer) return; 
      
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

  const handleDeletePlan = async () => {
      if (isViewer) return;
      if (!window.confirm("ต้องการลบแผนการสั่งซื้อนี้ทิ้งหรือไม่?")) return;
      
      setLoading(true);
      try {
          const existingPlan = plannedOrders.find(p => p.product_id === cellModal.product.product_id && p.plan_date === cellModal.dateStr);
          if (existingPlan) {
              await supabase.from('planning_orders').delete().eq('id', existingPlan.id);
          }
          setCellModal(null);
          fetchData();
      } catch (error: any) { alert("Delete Error: " + error.message); }
      setLoading(false);
  };

  const handleAutoGeneratePO = async () => {
      if (isViewer) return alert("ไม่มีสิทธิ์ทำรายการ");

      const targetProducts = products.filter(p => p.planning_room === activeRoom.id).map(p => p.product_id);
      const plansToConvert = plannedOrders.filter(plan => targetProducts.includes(plan.product_id) && Number(plan.qty_purchase) > 0);

      if (plansToConvert.length === 0) return alert("ไม่มียอดแผนสั่งซื้อ (Purchase Qty) ที่สามารถแปลงเป็นเอกสาร PO ได้ในเดือนที่เลือก");

      if (!window.confirm(`คุณกำลังจะแปลงแผนการสั่งซื้อของห้อง "${activeRoom.label}" เป็นใบสั่งซื้อ (PO) อัตโนมัติ\n\nระบบจะรวบรวมรายการและสร้างใบ PO แยกตามวันที่ให้ทันที ยืนยันหรือไม่?`)) return;

      setLoading(true);
      try {
          const groupedByDate: Record<string, any[]> = {};
          plansToConvert.forEach(plan => {
              if (!groupedByDate[plan.plan_date]) groupedByDate[plan.plan_date] = [];
              groupedByDate[plan.plan_date].push(plan);
          });

          let createdCount = 0;
          for (const date in groupedByDate) {
              const lines = groupedByDate[date];
              const poNumber = `PO-AUTO-${date.replace(/-/g, '')}-${Math.floor(Math.random() * 1000)}`;

              await supabase.from('purchase_orders').insert([{
                  po_number: poNumber,
                  warehouse_code: 'MAIN_WH', 
                  delivery_date: date,
                  status: 'PENDING'
              }]);

              const poLinesData = lines.map(line => ({
                  po_number: poNumber,
                  product_id: line.product_id,
                  ordered_qty: line.qty_purchase,
                  received_qty: 0
              }));
              await supabase.from('po_lines').insert(poLinesData);

              const planIds = lines.map(l => l.id);
              await supabase.from('planning_orders').delete().in('id', planIds);

              createdCount++;
          }

          alert(`✅ สร้างใบสั่งซื้อ (PO) สำเร็จจำนวน ${createdCount} ใบ!\n(คุณสามารถไปแก้ไข/ระบุคู่ค้าได้ที่ตารางรับเข้า/PO)`);
          fetchData();
      } catch (error: any) {
          alert("เกิดข้อผิดพลาดในการสร้าง PO: " + error.message);
      }
      setLoading(false);
  };

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
              'จุดสั่งซื้อ (Min Stock)': p.min_stock,
              'หน่วยจ่าย (Base UOM)': p.base_uom,
              'หน่วยสั่งซื้อ (Purchase UOM)': p.purchase_uom,
              'คาดการณ์ยอดใช้ต่อวัน (Est. Demand)': forecast.appliedDemand.toFixed(2),
              'Trend (%)': forecast.trendPercent !== 0 ? `${forecast.trendPercent > 0 ? '+' : ''}${forecast.trendPercent.toFixed(1)}%` : '-',
          };

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

  // 🟢 ข้อมูล Dropdown หมวดหมู่ และ โลเคชั่น
  const uniqueLocations = useMemo(() => {
      const locs = new Set(products.map(p => p.default_location).filter(l => l && l !== 'Unassigned'));
      return ['ALL', ...Array.from(locs).sort()];
  }, [products]);

  const uniqueCategories = useMemo(() => {
      const cats = new Set(products.map(p => p.category).filter(c => c && c !== 'Unknown'));
      return ['ALL', ...Array.from(cats).sort()];
  }, [products]);

  const { assignedProducts, availableProducts } = useMemo(() => {
      const assigned: any[] = []; const available: any[] = [];
      products.forEach(p => {
          if (p.planning_room === activeRoom.id) assigned.push(p);
          else if (!p.planning_room) available.push(p);
      });
      return { assignedProducts: assigned, availableProducts: available };
  }, [products, activeRoom]);

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

  return (
    <div className="p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      <div className="flex justify-between items-start mb-6 flex-shrink-0">
          <div>
              <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2"><CalIcon className="text-indigo-600"/> Smart Planning Center</h1>
              <p className="text-slate-500 text-sm mt-1">ระบบวางแผนและสั่งซื้ออัจฉริยะ พร้อมระบบพยากรณ์ความต้องการ (Forecast Engine)</p>
          </div>
          <div className="flex gap-3">
              {activeTab === 'ANALYZE' && (
                  <>
                      <button onClick={handleExportPlan} className="px-4 py-2 bg-white text-slate-700 border border-slate-300 rounded-lg text-sm font-bold flex items-center gap-2 shadow-sm hover:bg-slate-50 transition-colors">
                          <FileSpreadsheet size={16}/> Export Plan
                      </button>
                      
                      {!isViewer && (
                          <button onClick={handleAutoGeneratePO} className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-500 text-white rounded-lg text-sm font-black flex items-center gap-2 shadow-md hover:from-emerald-600 hover:to-teal-600 transition-all active:scale-95">
                              <Wand2 size={16}/> Convert to PO
                          </button>
                      )}
                  </>
              )}

              <div className="flex bg-white rounded-xl p-1 border border-slate-200 shadow-sm">
                  {!isViewer && (
                      <button onClick={() => setActiveTab('MANAGE')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ${activeTab === 'MANAGE' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
                          <Package size={16}/> Manage Rooms
                      </button>
                  )}
                  <button onClick={() => setActiveTab('ANALYZE')} className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-colors ${activeTab === 'ANALYZE' ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-50'}`}>
                      <TrendingUp size={16}/> Analyze & Plan
                  </button>
              </div>
          </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-2 scrollbar-hide flex-shrink-0">
          {planningRooms.map(room => (
              <div key={room.id} className="relative group shrink-0">
                  <button 
                      onClick={() => { setActiveRoom(room); setWeekOffset(0); }}
                      className={`px-5 py-2.5 rounded-full whitespace-nowrap text-sm font-bold border transition-all flex items-center gap-2 ${
                          activeRoom.id === room.id 
                          ? 'bg-slate-800 text-white border-slate-800 shadow-md scale-105' 
                          : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-100'
                      }`}
                  >
                      {room.label}
                  </button>
                  
                  {!isViewer && activeTab === 'MANAGE' && !DEFAULT_ROOMS.find(d => d.id === room.id) && (
                      <button 
                          onClick={(e) => { e.stopPropagation(); handleDeleteRoom(room.id, room.label); }} 
                          className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shadow-sm hover:scale-110"
                      >
                          <X size={12}/>
                      </button>
                  )}
              </div>
          ))}

          {!isViewer && activeTab === 'MANAGE' && (
              isAddingRoom ? (
                  <div className="flex items-center gap-1 bg-white border border-indigo-300 rounded-full p-1 shadow-sm shrink-0">
                      <input 
                          type="text" 
                          placeholder="ชื่อหมวดหมู่..." 
                          className="text-sm outline-none px-3 w-32 bg-transparent"
                          value={newRoomName}
                          onChange={e => setNewRoomName(e.target.value)}
                          autoFocus
                          onKeyDown={e => e.key === 'Enter' && handleAddRoom()}
                      />
                      <button onClick={handleAddRoom} className="p-1.5 bg-indigo-100 text-indigo-600 rounded-full hover:bg-indigo-500 hover:text-white transition-colors"><CheckCircle size={14}/></button>
                      <button onClick={() => setIsAddingRoom(false)} className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"><X size={14}/></button>
                  </div>
              ) : (
                  <button onClick={() => setIsAddingRoom(true)} className="px-4 py-2.5 rounded-full text-sm font-bold border border-dashed border-slate-300 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition-all flex items-center gap-1 shrink-0">
                      <Plus size={16}/> เพิ่มหมวดหมู่
                  </button>
              )
          )}
      </div>

      {/* ==================== PART 1: MANAGE ITEMS (WITH ADVANCED FILTERS) ==================== */}
      {activeTab === 'MANAGE' && !isViewer && (
          <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
              <div className="p-4 border-b bg-slate-50 flex justify-between items-center flex-wrap gap-4">
                  <div className="flex gap-3 items-center flex-1 flex-wrap">
                      <div className="relative w-64">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                          <input type="text" placeholder="ค้นหา: ชื่อสินค้า, รหัสสินค้า..." className="w-full pl-9 p-2.5 bg-white border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm" value={manageSearch} onChange={e => setManageSearch(e.target.value)}/>
                      </div>
                      
                      {/* 🟢 Dropdown กรอง Category */}
                      <div className="flex items-center gap-2 bg-white px-3 py-2.5 rounded-xl border border-slate-300 shadow-sm">
                          <Package size={16} className="text-slate-400"/>
                          <select className="bg-transparent text-sm font-bold text-slate-600 outline-none cursor-pointer w-32" value={manageCategory} onChange={e => setManageCategory(e.target.value)}>
                              <option value="ALL">All Categories</option>
                              {uniqueCategories.filter(c => c !== 'ALL').map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                      </div>
                      
                      {/* 🟢 Dropdown กรอง Location */}
                      <div className="flex items-center gap-2 bg-white px-3 py-2.5 rounded-xl border border-slate-300 shadow-sm">
                          <MapPin size={16} className="text-slate-400"/>
                          <select className="bg-transparent text-sm font-bold text-slate-600 outline-none cursor-pointer w-32" value={manageLocation} onChange={e => setManageLocation(e.target.value)}>
                              <option value="ALL">All Locations</option>
                              {uniqueLocations.filter(l => l !== 'ALL').map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                      </div>
                  </div>
                  <div className="text-sm text-emerald-600 font-bold flex items-center gap-2 bg-emerald-50 px-4 py-2.5 rounded-xl border border-emerald-100 shadow-sm">
                      <Save size={16}/> ระบบบันทึกอัตโนมัติเมื่อคลิก
                  </div>
              </div>

              <div className="flex flex-1 overflow-hidden">
                  <div className="flex-1 border-r border-slate-200 flex flex-col bg-slate-50/50">
                      <div className="p-3 bg-white border-b border-slate-100 font-bold text-slate-500 text-xs uppercase flex justify-between tracking-widest">
                          <span className="flex items-center gap-2"><Filter size={14}/> สินค้าที่ยังไม่จัดกลุ่ม (คลิกเพื่อเพิ่ม)</span>
                          <span className="bg-slate-100 px-2 py-0.5 rounded-md">{availableProducts.length}</span>
                      </div>
                      <div className="flex-1 overflow-auto p-3 space-y-2">
                          {availableProducts
                              .filter(p => {
                                  const searchLower = manageSearch.toLowerCase();
                                  const matchSearch = (p.product_name || '').toLowerCase().includes(searchLower) || 
                                                      (p.product_id || '').toLowerCase().includes(searchLower);
                                  const matchLoc = manageLocation === 'ALL' || p.default_location === manageLocation;
                                  const matchCat = manageCategory === 'ALL' || p.category === manageCategory;
                                  return matchSearch && matchLoc && matchCat;
                              })
                              .slice(0, 100) 
                              .map(p => (
                              <div key={p.product_id} onClick={() => toggleProductAssignment(p, activeRoom.id)} className="bg-white p-3 rounded-xl border border-slate-200 hover:border-indigo-400 cursor-pointer flex justify-between items-center group shadow-sm hover:shadow-md transition-all">
                                  <div>
                                      <div className="font-bold text-slate-700 text-sm">{p.product_name}</div>
                                      <div className="text-xs text-slate-400 flex items-center gap-2 mt-1">
                                          <span className="bg-slate-100 font-mono px-1.5 rounded">{p.product_id}</span>
                                          {p.category && p.category !== 'Unknown' && <span className="bg-slate-100 px-1.5 rounded">{p.category}</span>}
                                      </div>
                                  </div>
                                  <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                                      <Plus size={16}/>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>

                  <div className="flex-1 flex flex-col bg-white">
                      <div className="p-3 bg-indigo-50 border-b border-indigo-100 font-bold text-indigo-700 text-xs uppercase flex justify-between tracking-widest">
                          <span className="flex items-center gap-2"><CheckCircle size={14}/> สินค้าในหมวด: {activeRoom.label}</span>
                          <span className="bg-white px-2 py-0.5 rounded-md border border-indigo-200">{assignedProducts.length}</span>
                      </div>
                      <div className="flex-1 overflow-auto p-3 space-y-2">
                          {assignedProducts
                              .filter(p => {
                                  const searchLower = manageSearch.toLowerCase();
                                  return (p.product_name || '').toLowerCase().includes(searchLower) || 
                                         (p.product_id || '').toLowerCase().includes(searchLower);
                              })
                              .map(p => (
                              <div key={p.product_id} className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 flex justify-between items-center shadow-sm hover:border-rose-300 transition-colors group">
                                  <div>
                                      <div className="font-bold text-slate-800 text-sm">{p.product_name}</div>
                                      <div className="text-xs text-slate-500 font-mono mt-1">{p.product_id}</div>
                                  </div>
                                  <button onClick={() => toggleProductAssignment(p, null)} className="p-2 bg-white hover:bg-rose-500 rounded-full text-slate-400 hover:text-white border border-transparent transition-all shadow-sm">
                                      <Minus size={16}/>
                                  </button>
                              </div>
                          ))}
                      </div>
                  </div>
              </div>
          </div>
      )}

      {activeTab === 'ANALYZE' && (
          <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
              
              <div className="p-4 border-b border-slate-200 flex flex-wrap justify-between items-center bg-slate-50 gap-4">
                  <div className="flex items-center gap-4 flex-wrap">
                      
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

                      <div className="flex items-center gap-2 bg-blue-50 px-3 py-1.5 rounded-xl border border-blue-200 shadow-sm">
                          <Activity size={16} className="text-blue-600"/>
                          <span className="text-xs font-bold text-blue-800">ฐานข้อมูล:</span>
                          <select value={baseAvgPeriod} onChange={(e) => setBaseAvgPeriod(Number(e.target.value))} className="bg-transparent text-sm font-bold text-blue-900 outline-none cursor-pointer">
                              <option value={7}>7 วันย้อนหลัง</option>
                              <option value={14}>14 วันย้อนหลัง</option>
                              <option value={30}>30 วันย้อนหลัง</option>
                          </select>
                      </div>

                      <div className="flex items-center gap-2 bg-purple-50 px-3 py-1.5 rounded-xl border border-purple-200 shadow-sm">
                          <BrainCircuit size={16} className="text-purple-600"/>
                          <select value={forecastStrategy} onChange={(e) => setForecastStrategy(e.target.value as any)} className="bg-transparent text-sm font-bold text-purple-900 outline-none cursor-pointer border-r border-purple-200 pr-2">
                              <option value="MA">Basic Avg (ค่าเฉลี่ยปกติ)</option>
                              <option value="TREND">Trend Mode (เน้นยอดล่าสุด)</option>
                              <option value="PEAK">Peak Mode (กันของขาด)</option>
                              <option value="ARIMA">Auto-ARIMA (วิเคราะห์ความผันผวน)</option>
                          </select>
                          
                          <select value={demandFactor} onChange={(e) => setDemandFactor(Number(e.target.value))} className="bg-transparent text-sm font-bold text-purple-700 outline-none cursor-pointer ml-1">
                              <option value={1.0}>100% (Normal)</option>
                              <option value={1.2}>120% (Holiday)</option>
                              <option value={1.5}>150% (High Season)</option>
                              <option value={0.8}>80% (Low Season)</option>
                          </select>
                      </div>

                      <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-600 px-3 py-1.5 rounded-xl shadow-sm text-sm font-bold hover:bg-slate-100 transition-colors disabled:opacity-50">
                          <RefreshCw size={14} className={loading ? "animate-spin text-indigo-500" : ""} />
                          Sync Data
                      </button>
                      
                      {syncProgress && (
                          <span className="text-xs font-bold text-indigo-600 animate-pulse">{syncProgress}</span>
                      )}

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
                              <th className="p-3 text-center w-28 bg-white border-r border-slate-200">
                                  <div className="flex flex-col items-center">
                                      <span>{forecastStrategy === 'PEAK' ? 'Max/Day' : forecastStrategy === 'ARIMA' ? 'Adjusted/Day' : 'Avg/Day'}</span>
                                      <span className="text-[9px] text-slate-400 font-medium tracking-widest mt-0.5">({baseAvgPeriod} Days)</span>
                                  </div>
                              </th>
                              
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
                                          <td className="p-3 pl-6 sticky left-0 bg-white group-hover:bg-slate-50 z-20 border-r border-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)]">
                                              <div className="font-bold text-slate-800 text-sm truncate max-w-[280px]" title={p.product_name}>{p.product_name}</div>
                                              <div className="flex items-center justify-between mt-1.5">
                                                  <div className="flex items-center gap-2">
                                                      <span className="text-[10px] text-slate-500 font-mono bg-slate-100 px-1.5 py-0.5 rounded">{p.product_id}</span>
                                                      
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
                                                  
                                                  <div className="flex items-center gap-2">
                                                      <span className="text-[9px] font-bold text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100 flex items-center gap-1" title="Min Stock (จุดสั่งซื้อ)">
                                                          Min: {p.min_stock}
                                                          {!isViewer && <button onClick={() => setEditingProduct(p)} className="hover:text-rose-800 ml-1"><Settings size={10}/></button>}
                                                      </span>
                                                      <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100" title={`สั่งเป็น ${p.purchase_uom} / จ่ายเป็น ${p.base_uom}`}>
                                                          {p.purchase_uom} (={p.conversion_rate})
                                                      </span>
                                                  </div>
                                              </div>
                                          </td>
                                          
                                          <td className="p-3 text-center border-r border-slate-100 font-mono font-bold text-slate-600 bg-slate-50/50 relative">
                                              <div className="text-sm text-slate-800 flex items-center justify-center gap-1" title={forecastStrategy === 'ARIMA' ? `StdDev: ${forecast.stdDev.toFixed(2)}` : ''}>
                                                  {forecast.appliedDemand.toFixed(1)}
                                                  
                                                  {!forecast.hasDataInPeriod && forecast.appliedDemand === 0 && (
                                                      <span title={`ไม่มีประวัติการเบิกใน ${forecast.baseAvgPeriod} วันที่ผ่านมา`}>
                                                          <AlertTriangle size={14} className="text-amber-500 cursor-help" />
                                                      </span>
                                                  )}
                                              </div>
                                              {demandFactor !== 1 && <div className="text-[9px] text-purple-500 font-bold mt-0.5">x{demandFactor} applied</div>}
                                          </td>
                                          
                                          {timelineHeaders.map((head, idx) => {
                                              const dayData = forecast.timeline.find(t => t.dateStr === head.dateStr);
                                              if (!dayData) return <td key={idx} className="border-r border-slate-100"></td>;

                                              const isLow = dayData.projectedStock <= p.min_stock;
                                              const isNegative = dayData.projectedStock < 0;

                                              return (
                                                  <td 
                                                      key={idx} 
                                                      onClick={() => {
                                                          if (isViewer) return; 
                                                          setCellModal({ product: p, ...dayData });
                                                          setLiveConversion(dayData.plannedPurchase);
                                                      }}
                                                      className={`relative p-2 border-r border-slate-100 h-[70px] min-w-[120px] transition-colors ${!isViewer ? 'cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-400' : ''} ${isNegative ? 'bg-rose-50/50' : isLow ? 'bg-amber-50/30' : 'bg-white'}`}
                                                  >
                                                      {(dayData.plannedPurchase > 0 || dayData.incomingPO > 0) && (
                                                          <div className="absolute top-1 right-1 flex flex-col items-end gap-1">
                                                              {dayData.plannedPurchase > 0 && <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shadow-sm border border-emerald-200" title={`แผนสั่งซื้อ: ${dayData.plannedPurchase} ${p.purchase_uom}`}>+{dayData.plannedPurchase} {p.purchase_uom}</span>}
                                                              {dayData.incomingPO > 0 && <span className="text-[9px] font-bold text-cyan-700 bg-cyan-100 px-1.5 py-0.5 rounded border border-cyan-200" title="รอรับเข้า (PO)">+{dayData.incomingPO} In</span>}
                                                          </div>
                                                      )}
                                                      
                                                      <div className="flex items-center justify-center h-full">
                                                          <div className={`font-black text-xl ${isNegative ? 'text-rose-600' : 'text-slate-800'} ${isLow && !isNegative ? 'text-amber-600' : ''}`}>
                                                              {Math.round(dayData.projectedStock)}
                                                          </div>
                                                      </div>

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
                          {!isViewer && <button onClick={()=>setActiveTab('MANAGE')} className="text-indigo-500 hover:underline mt-2 font-bold flex items-center gap-1">ไปที่หน้า Manage Rooms <ArrowRight size={14}/></button>}
                      </div>
                  )}
              </div>
          </div>
      )}

      {cellModal && !isViewer && (
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

                      <div className="flex gap-2">
                          {cellModal.plannedBase > 0 && (
                              <button type="button" onClick={handleDeletePlan} disabled={loading} className="px-4 py-3 bg-rose-50 text-rose-600 rounded-xl font-bold hover:bg-rose-100 transition-colors flex items-center justify-center shadow-sm">
                                  <Trash2 size={18}/>
                              </button>
                          )}
                          <button type="button" onClick={() => setCellModal(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors shadow-sm">Cancel</button>
                          <button type="submit" disabled={loading} className="flex-[2] py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 flex justify-center items-center gap-2 transition-all">
                              {loading ? 'Saving...' : <><Save size={18}/> Save Plan</>}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {editingProduct && !isViewer && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
                  <div className="p-5 border-b border-rose-100 flex justify-between items-start bg-rose-50 relative overflow-hidden">
                      <div className="relative z-10">
                          <h3 className="font-bold text-rose-800 flex items-center gap-2"><Settings size={18}/> ตั้งค่าจุดสั่งซื้อ (Min Stock)</h3>
                          <p className="text-xs text-rose-600 mt-1">{editingProduct.product_name}</p>
                      </div>
                      <button onClick={() => setEditingProduct(null)} className="p-2 bg-white/50 rounded-full hover:bg-white text-rose-500 relative z-10"><X size={18}/></button>
                  </div>
                  
                  <form onSubmit={handleSaveMasterData} className="p-6">
                      <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs p-3 rounded-xl mb-4 flex gap-2 items-start">
                          <AlertTriangle size={14} className="shrink-0 mt-0.5"/>
                          <span>การแก้ไขนี้จะมีผลกับ <b>ทุกระบบ (ทั้งหน้า Inventory, Dashboard และแจ้งเตือน)</b></span>
                      </div>

                      <div className="mb-6">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 text-center">
                              ป้อนจำนวน Min Stock ใหม่ (หน่วย: {editingProduct.base_uom})
                          </label>
                          <input 
                              type="number" min="0" name="min_stock" 
                              defaultValue={editingProduct.min_stock}
                              className="w-full text-center text-5xl font-black text-rose-600 border-b-2 border-slate-200 focus:border-rose-500 outline-none pb-2 transition-colors bg-transparent"
                              autoFocus required
                          />
                      </div>

                      <div className="flex gap-3">
                          <button type="button" onClick={() => setEditingProduct(null)} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-bold hover:bg-slate-200 transition-colors shadow-sm">Cancel</button>
                          <button type="submit" disabled={loading} className="flex-1 py-3 bg-rose-600 text-white rounded-xl font-bold shadow-lg shadow-rose-200 hover:bg-rose-700 flex justify-center items-center gap-2 transition-all">
                              {loading ? 'Saving...' : <><Save size={18}/> Update System</>}
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}

    </div>
  );
}