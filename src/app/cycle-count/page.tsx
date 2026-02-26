"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    RefreshCw, MapPin, Search, ClipboardCheck, ShieldAlert, 
    CheckCircle, X, AlertTriangle, ArrowRight, Save, Activity, Plus, Package,
    Target, ArrowLeft, Bookmark, Edit2
} from 'lucide-react';

export default function CycleCountPage() {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Data States
  const [locations, setLocations] = useState<string[]>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [countItems, setCountItems] = useState<any[]>([]);
  const [masterProducts, setMasterProducts] = useState<any[]>([]);
  
  // Input States
  const [actualCounts, setActualCounts] = useState<Record<string, string>>({});
  const [countSearchTerm, setCountSearchTerm] = useState('');

  // Review State (เก็บ State ตอนเข้ามาหน้า Review เพื่อไม่ให้บรรทัดกระโดดเวลาแก้ตัวเลข)
  const [reviewItems, setReviewItems] = useState<any[]>([]);

  // Add Extra Item State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearchTerm, setAddSearchTerm] = useState('');

  useEffect(() => {
      // ตรวจสอบว่ามี Draft ค้างอยู่หรือไม่เมื่อเปิดหน้าเว็บ
      const savedDraft = localStorage.getItem('cycleCountDraft');
      if (savedDraft) {
          try {
              const parsed = JSON.parse(savedDraft);
              if (window.confirm(`📍 พบข้อมูลการนับสต๊อกที่บันทึกค้างไว้ (Zone: ${parsed.location})\nต้องการนับต่อจากเดิมหรือไม่?`)) {
                  setSelectedLocation(parsed.location);
                  setCountItems(parsed.countItems);
                  setActualCounts(parsed.actualCounts);
                  setStep(2);
              } else {
                  localStorage.removeItem('cycleCountDraft');
              }
          } catch (e) {
              localStorage.removeItem('cycleCountDraft');
          }
      }
      fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
      setLoading(true);
      try {
          const { data: pData } = await supabase.from('master_products').select('*').eq('status', 'ACTIVE');
          const products = pData || [];
          setMasterProducts(products);

          const { data: iData } = await supabase.from('inventory_lots').select('storage_location');
          
          const allLocs = new Set<string>();
          products.forEach(p => { if (p.default_location) allLocs.add(p.default_location); });
          (iData || []).forEach(lot => { if (lot.storage_location) allLocs.add(lot.storage_location); });

          const uniqueLocs = Array.from(allLocs).sort();
          setLocations(uniqueLocs as string[]);
      } catch (error) {
          console.error(error);
      }
      setLoading(false);
  };

  const generateCountTask = async () => {
      if (!selectedLocation) return alert("กรุณาเลือก Location ที่ต้องการตรวจนับ");
      setLoading(true);
      try {
          const expectedProducts = masterProducts.filter(p => p.default_location === selectedLocation);
          const { data: lots } = await supabase.from('inventory_lots').select('*').eq('storage_location', selectedLocation);
          
          const aggregated: Record<string, number> = {};
          (lots || []).forEach(lot => {
              aggregated[lot.product_id] = (aggregated[lot.product_id] || 0) + Number(lot.quantity);
          });

          const itemsMap: Record<string, any> = {};

          expectedProducts.forEach(p => {
              itemsMap[p.product_id] = {
                  product_id: p.product_id,
                  product_name: p.product_name,
                  unit: p.base_uom || 'Unit',
                  cost: Number(p.standard_cost) || 0,
                  system_qty: aggregated[p.product_id] || 0, 
                  location: selectedLocation,
                  isExtra: false 
              };
          });

          (lots || []).forEach(lot => {
              if (!itemsMap[lot.product_id]) {
                  const pInfo = masterProducts.find(p => p.product_id === lot.product_id);
                  itemsMap[lot.product_id] = {
                      product_id: lot.product_id,
                      product_name: pInfo?.product_name || 'Unknown Item',
                      unit: pInfo?.base_uom || 'Unit',
                      cost: Number(pInfo?.standard_cost) || 0,
                      system_qty: aggregated[lot.product_id],
                      location: selectedLocation,
                      isExtra: true 
                  };
              }
          });

          setCountItems(Object.values(itemsMap));
          setActualCounts({}); 
          setCountSearchTerm('');
          setStep(2); 
      } catch (error: any) {
          alert("Error: " + error.message);
      }
      setLoading(false);
  };

  const handleAddExtraItem = (product: any) => {
      const exists = countItems.find(i => i.product_id === product.product_id);
      if (exists) return alert("สินค้านี้มีอยู่ในรายการตรวจนับแล้ว!");

      const newItem = {
          product_id: product.product_id,
          product_name: product.product_name,
          unit: product.base_uom || 'Unit',
          cost: Number(product.standard_cost) || 0,
          system_qty: 0, 
          location: selectedLocation,
          isExtra: true
      };

      setCountItems([newItem, ...countItems]);
      setShowAddModal(false);
      setAddSearchTerm('');
  };

  // 🟢 ฟังก์ชันสำหรับ Save Draft
  const saveDraft = () => {
      localStorage.setItem('cycleCountDraft', JSON.stringify({
          location: selectedLocation,
          countItems,
          actualCounts
      }));
      alert("💾 บันทึกแบบร่างเรียบร้อยแล้ว!\nคุณสามารถปิดหน้านี้แล้วกลับมาทำต่อได้ภายหลัง");
  };

  const clearDraft = () => {
      localStorage.removeItem('cycleCountDraft');
  };

  const submitBlindCount = () => {
      const uncounted = countItems.filter(item => actualCounts[item.product_id] === undefined || actualCounts[item.product_id] === '');
      if (uncounted.length > 0) {
          if (!window.confirm(`มีสินค้า ${uncounted.length} รายการที่ยังไม่ได้กรอกยอด (ระบบจะถือว่าเป็น 0)\nต้องการดำเนินการไปหน้าตรวจสอบยอดหรือไม่?`)) return;
      }
      
      // จัดเรียงรายการเอาพวกยอดดิฟไว้บนสุด เฉพาะตอนกดเข้ามา (เพื่อไม่ให้มันกระโดดเวลาแก้เลขในหน้า Review)
      const sorted = [...countItems].sort((a, b) => {
          const diffA = Math.abs((Number(actualCounts[a.product_id]) || 0) - a.system_qty);
          const diffB = Math.abs((Number(actualCounts[b.product_id]) || 0) - b.system_qty);
          if (diffA > 0 && diffB === 0) return -1;
          if (diffB > 0 && diffA === 0) return 1;
          return 0;
      });

      setReviewItems(sorted);
      setStep(3); 
  };

  const approveAndAdjust = async () => {
      const discrepancies = countItems.filter(item => {
          const actual = Number(actualCounts[item.product_id]) || 0;
          return actual !== item.system_qty;
      });

      if (discrepancies.length === 0) {
          alert("🎉 ยอดตรงกันทุกรายการ! ระบบจะบันทึกผลการนับโดยไม่มีการปรับสต๊อก");
          clearDraft();
          setStep(1); return;
      }

      if (!window.confirm(`⚠️ พบยอดดิฟ จำนวน ${discrepancies.length} รายการ\nระบบจะทำการ Adjust สต๊อกจริงทันที\nยืนยันการนำส่งและปรับยอดหรือไม่?`)) return;

      setLoading(true);
      try {
          for (const item of discrepancies) {
              const actual = Number(actualCounts[item.product_id]) || 0;
              const diff = actual - item.system_qty;

              const { data: existingLots } = await supabase.from('inventory_lots')
                  .select('*').eq('product_id', item.product_id).eq('storage_location', item.location);

              if (actual === 0) {
                  for (const l of existingLots || []) {
                      await supabase.from('inventory_lots').update({ quantity: 0 }).eq('lot_id', l.lot_id || l.id);
                  }
              } else if (existingLots && existingLots.length > 0) {
                  const targetLot = existingLots[0];
                  await supabase.from('inventory_lots').update({ 
                      quantity: Number(targetLot.quantity) + diff,
                      last_updated: new Date().toISOString()
                  }).eq(targetLot.lot_id ? 'lot_id' : 'id', targetLot.lot_id || targetLot.id);
              } else {
                  await supabase.from('inventory_lots').insert([{
                      product_id: item.product_id,
                      storage_location: item.location,
                      quantity: actual
                  }]);
              }

              const { data: allLots } = await supabase.from('inventory_lots').select('quantity').eq('product_id', item.product_id);
              const totalBalance = allLots?.reduce((sum, l) => sum + Number(l.quantity), 0) || 0;

              await supabase.from('transactions_log').insert([{
                  transaction_type: 'ADJUST',
                  product_id: item.product_id,
                  quantity_change: diff,
                  balance_after: totalBalance,
                  remarks: `Cycle Count (${item.location}): System ${item.system_qty} -> Actual ${actual} (Diff: ${diff > 0 ? '+' : ''}${diff})`
              }]);
          }

          alert("✅ นำส่งข้อมูลและปรับยอดสต๊อก (Post Adjustments) สำเร็จ!");
          clearDraft(); // เคลียร์ร่างทิ้งหลังสำเร็จ
          setStep(1);
          setCountItems([]);
          setActualCounts({});
          fetchInitialData(); 
      } catch (error: any) {
          alert("Approval Error: " + error.message);
      }
      setLoading(false);
  };

  const summary = useMemo(() => {
      let match = 0; let diffCount = 0; let netDiffValue = 0;
      countItems.forEach(item => {
          const actual = Number(actualCounts[item.product_id]) || 0;
          if (actual === item.system_qty) {
              match++;
          } else {
              diffCount++;
              netDiffValue += (actual - item.system_qty) * item.cost;
          }
      });
      const accuracy = countItems.length > 0 ? ((match / countItems.length) * 100).toFixed(1) : '0.0';
      return { match, diffCount, netDiffValue, accuracy, totalItems: countItems.length };
  }, [countItems, actualCounts]);

  const filteredCountItems = countItems.filter(item => 
      item.product_name.toLowerCase().includes(countSearchTerm.toLowerCase()) || 
      item.product_id.toLowerCase().includes(countSearchTerm.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      {/* --- HEADER --- */}
      <div className="flex flex-col md:flex-row justify-between md:items-center mb-4 md:mb-6 flex-shrink-0 gap-4">
          <div>
              <h1 className="text-xl md:text-2xl font-black text-slate-800 flex items-center gap-2">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><RefreshCw size={18} className="md:w-5 md:h-5"/></div>
                  Cycle Count & Audit
              </h1>
              <p className="text-slate-500 text-xs md:text-sm mt-1">ตรวจนับสต๊อกและวิเคราะห์ผลต่าง (ปรับแก้ไขยอดในหน้า Review ได้ทันที)</p>
          </div>
          
          <div className="flex items-center gap-1 md:gap-2 bg-white px-3 py-2 md:px-4 md:py-2 rounded-xl shadow-sm border border-slate-200 overflow-x-auto w-full md:w-auto whitespace-nowrap hide-scrollbar">
              <div className={`flex items-center gap-1 md:gap-2 font-bold text-xs md:text-sm ${step >= 1 ? 'text-indigo-600' : 'text-slate-400'}`}>
                  <span className={`w-5 h-5 md:w-6 md:h-6 rounded-full flex items-center justify-center text-[10px] md:text-xs ${step >= 1 ? 'bg-indigo-100' : 'bg-slate-100'}`}>1</span> Plan
              </div>
              <div className="w-4 md:w-8 h-px bg-slate-200"></div>
              <div className={`flex items-center gap-1 md:gap-2 font-bold text-xs md:text-sm ${step >= 2 ? 'text-indigo-600' : 'text-slate-400'}`}>
                  <span className={`w-5 h-5 md:w-6 md:h-6 rounded-full flex items-center justify-center text-[10px] md:text-xs ${step >= 2 ? 'bg-indigo-100' : 'bg-slate-100'}`}>2</span> Count
              </div>
              <div className="w-4 md:w-8 h-px bg-slate-200"></div>
              <div className={`flex items-center gap-1 md:gap-2 font-bold text-xs md:text-sm ${step >= 3 ? 'text-indigo-600' : 'text-slate-400'}`}>
                  <span className={`w-5 h-5 md:w-6 md:h-6 rounded-full flex items-center justify-center text-[10px] md:text-xs ${step >= 3 ? 'bg-indigo-100' : 'bg-slate-100'}`}>3</span> Review
              </div>
          </div>
      </div>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
          {loading && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-indigo-600">
                  <Activity size={48} className="animate-spin mb-4"/>
                  <span className="font-bold tracking-widest uppercase text-sm md:text-base">Processing...</span>
              </div>
          )}

          {/* ========================================== */}
          {/* STEP 1: GENERATE PLAN */}
          {/* ========================================== */}
          {step === 1 && (
              <div className="flex flex-col items-center justify-center h-full p-4 md:p-6 animate-fade-in">
                  <div className="w-full max-w-lg bg-slate-50 p-6 md:p-8 rounded-3xl border border-slate-200 text-center shadow-inner">
                      <div className="w-16 h-16 md:w-20 md:h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-4 md:mb-6 shadow-sm">
                          <MapPin size={28} className="md:w-8 md:h-8"/>
                      </div>
                      <h2 className="text-lg md:text-xl font-bold text-slate-800 mb-2">Create Count Task</h2>
                      <p className="text-slate-500 text-xs md:text-sm mb-6 md:mb-8">เลือกโซน (Location) ที่ต้องการสร้างใบงานนับสต๊อก</p>
                      
                      <div className="text-left mb-6">
                          <label className="text-[10px] md:text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2 pl-1">Select Location Zone</label>
                          <select 
                              className="w-full p-3 md:p-4 border border-slate-300 rounded-xl text-base md:text-lg font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 bg-white shadow-sm cursor-pointer"
                              value={selectedLocation}
                              onChange={e => setSelectedLocation(e.target.value)}
                          >
                              <option value="">-- กรุณาเลือก Location --</option>
                              {locations.map(loc => <option key={loc} value={loc}>📍 Zone: {loc}</option>)}
                          </select>
                      </div>

                      <button onClick={generateCountTask} disabled={!selectedLocation} className="w-full py-3 md:py-4 bg-indigo-600 text-white rounded-xl font-black text-base md:text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:scale-[1.02] transition-all disabled:bg-slate-300 disabled:scale-100 disabled:shadow-none flex items-center justify-center gap-2">
                          Start Blind Count <ArrowRight size={18}/>
                      </button>
                  </div>
              </div>
          )}

          {/* ========================================== */}
          {/* STEP 2: BLIND COUNT (ลงยอด แต่ยังไม่เข้า DB) */}
          {/* ========================================== */}
          {step === 2 && (
              <div className="flex flex-col h-full animate-fade-in">
                  <div className="p-3 md:p-4 bg-indigo-50 border-b border-indigo-100 flex flex-col lg:flex-row justify-between lg:items-center gap-3 shrink-0">
                      <div>
                          <h2 className="font-bold text-indigo-800 flex items-center gap-2 text-sm md:text-base"><ClipboardCheck size={18}/> บันทึกยอดนับ (Blind Count)</h2>
                          <div className="text-[10px] md:text-xs text-indigo-600 mt-1 flex flex-wrap items-center gap-1.5">
                              <span>Loc:</span> 
                              <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded shadow-sm">{selectedLocation}</span>
                              <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-bold">ไม่แสดงยอดระบบ</span>
                          </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 md:gap-3 items-stretch sm:items-center flex-1 lg:justify-end">
                          <div className="relative w-full sm:w-64">
                              <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                              <input type="text" placeholder="ค้นหาสินค้าในใบจด..." className="w-full pl-9 p-2 rounded-lg border border-indigo-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={countSearchTerm} onChange={e => setCountSearchTerm(e.target.value)}/>
                          </div>
                          <button onClick={() => setShowAddModal(true)} className="w-full sm:w-auto bg-white text-indigo-600 border border-indigo-200 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-indigo-600 hover:text-white transition-colors flex items-center justify-center gap-1">
                              <Plus size={16}/> สินค้านอกระบบ
                          </button>
                      </div>
                  </div>
                  
                  <div className="flex-1 overflow-auto p-3 md:p-6 bg-slate-50">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
                          {filteredCountItems.length === 0 && <div className="col-span-full text-center text-slate-400 p-10">ไม่พบรายการสินค้า</div>}
                          {filteredCountItems.map((item, idx) => (
                              <div key={item.product_id} className={`bg-white p-4 md:p-5 rounded-2xl shadow-sm border focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 transition-all ${item.isExtra ? 'border-amber-300 bg-amber-50/10' : 'border-slate-200'}`}>
                                  <div className="flex justify-between items-start mb-3 md:mb-4">
                                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">#{idx+1}</span>
                                      {item.isExtra && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded uppercase flex items-center gap-1"><AlertTriangle size={10}/> ของหลงโซน</span>}
                                  </div>
                                  <div className="font-bold text-slate-800 text-base md:text-lg leading-tight mb-1 truncate" title={item.product_name}>{item.product_name}</div>
                                  <div className="text-[10px] md:text-xs text-slate-500 font-mono mb-3 md:mb-4">{item.product_id}</div>
                                  
                                  <div className="flex items-center gap-2 md:gap-3">
                                      <input 
                                          type="number" min="0" placeholder="ระบุยอดนับ"
                                          className="w-full text-center text-2xl md:text-3xl font-black text-indigo-600 bg-slate-50 border border-slate-200 rounded-xl py-2 md:py-3 outline-none focus:bg-white focus:border-indigo-400 transition-colors placeholder:text-slate-300 placeholder:text-sm md:placeholder:text-lg"
                                          value={actualCounts[item.product_id] ?? ''}
                                          onChange={(e) => setActualCounts({...actualCounts, [item.product_id]: e.target.value})}
                                      />
                                      <span className="text-slate-400 font-bold w-10 md:w-12 text-xs md:text-sm">{item.unit}</span>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>

                  <div className="p-3 md:p-4 border-t border-slate-200 bg-white flex flex-wrap justify-between items-center shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] gap-2">
                      <button onClick={() => { clearDraft(); setStep(1); }} className="w-full sm:w-auto px-4 py-2 font-bold text-rose-500 hover:bg-rose-50 rounded-xl transition-colors text-sm md:text-base order-3 sm:order-1">ยกเลิก (Cancel)</button>
                      
                      <button onClick={saveDraft} className="w-full sm:w-auto px-6 py-2 md:py-3 font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors flex justify-center items-center gap-2 text-sm md:text-base order-2 sm:order-2">
                          <Bookmark size={18}/> พักการนับ (Save Draft)
                      </button>

                      <button onClick={submitBlindCount} className="w-full sm:w-auto px-8 py-2 md:py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 text-sm md:text-base order-1 sm:order-3">
                          ส่งยอดตรวจสอบ <ArrowRight size={18}/>
                      </button>
                  </div>
              </div>
          )}

          {/* ========================================== */}
          {/* STEP 3: VARIANCE ANALYSIS & POST ADJUSTMENT */}
          {/* ========================================== */}
          {step === 3 && (
              <div className="flex flex-col h-full animate-fade-in">
                  
                  {/* --- Variance Dashboard Top --- */}
                  <div className="bg-slate-800 text-white p-4 md:p-6 shrink-0 flex flex-col gap-3 md:gap-4">
                      <div>
                          <h2 className="font-bold text-lg md:text-xl flex items-center gap-2"><ShieldAlert className="text-amber-400 w-5 h-5"/> Variance Analysis</h2>
                          <p className="text-[10px] md:text-xs text-slate-400 mt-1">เทียบยอดนับกับข้อมูลในระบบ (ยอดจริงยังไม่ถูกปรับ จนกว่าจะกดยืนยันด้านล่าง) | Loc: {selectedLocation}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-4">
                          <div className="bg-slate-700/50 p-3 md:p-4 rounded-xl border border-slate-600">
                              <div className="text-[9px] md:text-[10px] text-slate-400 uppercase font-bold mb-1">Items</div>
                              <div className="text-xl md:text-2xl font-black text-white">{summary.totalItems}</div>
                          </div>
                          <div className="bg-emerald-500/10 p-3 md:p-4 rounded-xl border border-emerald-500/20">
                              <div className="text-[9px] md:text-[10px] text-emerald-300 uppercase font-bold mb-1 flex items-center gap-1"><CheckCircle size={10}/> Match</div>
                              <div className="text-xl md:text-2xl font-black text-emerald-400">{summary.match}</div>
                          </div>
                          <div className="bg-rose-500/10 p-3 md:p-4 rounded-xl border border-rose-500/20">
                              <div className="text-[9px] md:text-[10px] text-rose-300 uppercase font-bold mb-1 flex items-center gap-1"><AlertTriangle size={10}/> Diff</div>
                              <div className="text-xl md:text-2xl font-black text-rose-400">{summary.diffCount}</div>
                          </div>
                          <div className="bg-indigo-500/10 p-3 md:p-4 rounded-xl border border-indigo-500/20 flex flex-col justify-center relative overflow-hidden">
                              <Target size={30} className="absolute -right-2 -bottom-2 text-indigo-500/20"/>
                              <div className="text-[9px] md:text-[10px] text-indigo-300 uppercase font-bold mb-1">Accuracy</div>
                              <div className="text-xl md:text-2xl font-black text-indigo-400">{summary.accuracy}%</div>
                          </div>
                      </div>
                  </div>

                  {/* --- Variance Table (สามารถแก้ไขยอดได้ตรงนี้เลย) --- */}
                  <div className="flex-1 overflow-hidden bg-slate-50 w-full flex flex-col">
                      <div className="overflow-x-auto w-full flex-1">
                          <table className="w-full text-left text-sm whitespace-nowrap border-collapse min-w-[600px]">
                              <thead className="bg-white text-slate-500 font-bold text-[10px] uppercase sticky top-0 shadow-sm z-10 border-b border-slate-200">
                                  <tr>
                                      <th className="p-3 md:p-4 pl-4 md:pl-6">Product Info</th>
                                      <th className="p-3 md:p-4 text-center bg-slate-100">System (ระบบ)</th>
                                      <th className="p-3 md:p-4 text-center bg-indigo-50 text-indigo-700">Counted (นับได้) <Edit2 size={10} className="inline"/></th>
                                      <th className="p-3 md:p-4 text-center">Variance (ผลต่าง)</th>
                                      <th className="p-3 md:p-4 text-right pr-4 md:pr-6">Value (มูลค่า)</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-200">
                                  {reviewItems.map(item => {
                                      const actual = Number(actualCounts[item.product_id]) || 0;
                                      const diff = actual - item.system_qty;
                                      const isDiff = diff !== 0;
                                      const valueImpact = diff * item.cost;

                                      return (
                                          <tr key={item.product_id} className={`transition-colors ${isDiff ? 'bg-rose-50/40' : 'bg-white hover:bg-slate-50'}`}>
                                              <td className="p-3 md:p-4 pl-4 md:pl-6">
                                                  <div className="font-bold text-slate-800 text-xs md:text-sm truncate max-w-[200px] md:max-w-[300px]">{item.product_name}</div>
                                                  <div className="text-[9px] md:text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                                                      {item.product_id}
                                                      {item.isExtra && <span className="bg-amber-100 text-amber-700 px-1 rounded font-bold">ของหลงโซน</span>}
                                                  </div>
                                              </td>
                                              <td className="p-3 md:p-4 text-center font-mono text-slate-500 bg-slate-50/50">
                                                  {item.system_qty}
                                              </td>
                                              
                                              {/* 🟢 เปลี่ยนเป็น Input เพื่อให้แก้ไขยอดได้ทันทีในหน้า Review */}
                                              <td className="p-2 md:p-3 text-center bg-indigo-50/30">
                                                  <input 
                                                      type="number" min="0" placeholder="ระบุยอด"
                                                      className={`w-20 md:w-28 text-center text-base md:text-lg font-black rounded-lg py-1 md:py-2 outline-none border transition-colors ${isDiff ? 'text-rose-600 bg-white border-rose-200 focus:border-rose-500 focus:ring-2 focus:ring-rose-100' : 'text-emerald-700 bg-transparent border-transparent hover:bg-white hover:border-emerald-200 focus:bg-white focus:border-emerald-400'}`}
                                                      value={actualCounts[item.product_id] ?? ''}
                                                      onChange={(e) => setActualCounts({...actualCounts, [item.product_id]: e.target.value})}
                                                  />
                                              </td>

                                              <td className="p-3 md:p-4 text-center">
                                                  {isDiff ? (
                                                      <span className={`inline-flex items-center justify-center px-2 py-0.5 md:px-2.5 md:py-1 rounded-full font-bold text-[10px] md:text-xs ${diff > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                                          {diff > 0 ? '+' : ''}{diff} {item.unit}
                                                      </span>
                                                  ) : (
                                                      <span className="text-emerald-500 font-bold flex items-center justify-center gap-1 text-xs"><CheckCircle size={12}/> ตรงเป๊ะ</span>
                                                  )}
                                              </td>
                                              <td className={`p-3 md:p-4 text-right font-bold pr-4 md:pr-6 text-xs md:text-sm ${isDiff ? (diff > 0 ? 'text-emerald-600' : 'text-rose-600') : 'text-slate-300'}`}>
                                                  {isDiff ? `${diff > 0 ? '+' : ''}${valueImpact.toLocaleString()} ฿` : '-'}
                                              </td>
                                          </tr>
                                      );
                                  })}
                              </tbody>
                          </table>
                      </div>
                  </div>

                  <div className="p-3 md:p-5 border-t border-slate-200 bg-white flex flex-wrap justify-between items-center shrink-0 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] gap-2 md:gap-4">
                      <button onClick={saveDraft} className="w-full sm:w-auto px-6 py-2 md:py-3 font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-xl hover:bg-amber-100 transition-colors flex justify-center items-center gap-2 text-sm md:text-base order-2 sm:order-1">
                          <Bookmark size={18}/> พักการนับ (Save Draft)
                      </button>
                      
                      <button onClick={approveAndAdjust} className={`w-full sm:w-auto px-4 py-2 md:px-8 md:py-3 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-sm md:text-base order-1 sm:order-2 ${summary.diffCount > 0 ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-200' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200'}`}>
                          {summary.diffCount > 0 ? <><Save size={16}/> ยืนยันปรับสต๊อก</> : <><CheckCircle size={16}/> ยืนยันผล</>}
                      </button>
                  </div>
              </div>
          )}
      </div>

      {/* --- MODAL: เพิ่มสินค้านอกระบบ --- */}
      {showAddModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-3 md:p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="p-3 md:p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2 text-sm md:text-base"><Package size={16} className="text-indigo-500"/> ค้นหาสินค้านอกระบบ</h3>
                      <button onClick={()=>setShowAddModal(false)} className="text-slate-400 hover:text-rose-500 p-1"><X size={20}/></button>
                  </div>
                  <div className="p-3 md:p-4 border-b border-slate-100">
                      <div className="relative w-full">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                          <input type="text" placeholder="พิมพ์ชื่อ หรือ รหัสสินค้า..." autoFocus className="w-full pl-9 p-2 md:p-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={addSearchTerm} onChange={e=>setAddSearchTerm(e.target.value)}/>
                      </div>
                  </div>
                  <div className="flex-1 overflow-auto p-2">
                      {masterProducts.filter(p => (p.product_name||'').toLowerCase().includes(addSearchTerm.toLowerCase()) || (p.product_id||'').toLowerCase().includes(addSearchTerm.toLowerCase())).slice(0, 50).map(p => (
                          <div key={p.product_id} onClick={()=>handleAddExtraItem(p)} className="p-3 border-b border-slate-100 hover:bg-indigo-50 cursor-pointer flex justify-between items-center group">
                              <div className="pr-2">
                                  <div className="font-bold text-slate-800 text-xs md:text-sm">{p.product_name}</div>
                                  <div className="text-[10px] md:text-xs text-slate-500 font-mono mt-0.5">{p.product_id}</div>
                              </div>
                              <button className="text-indigo-600 bg-indigo-100 p-1.5 rounded-lg md:opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"><Plus size={16}/></button>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}