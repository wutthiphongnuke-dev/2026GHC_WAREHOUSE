"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    RefreshCw, MapPin, Search, ClipboardCheck, ShieldAlert, 
    CheckCircle, X, AlertTriangle, ArrowRight, Save, Activity, Plus, Package
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

  // Add Extra Item State
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearchTerm, setAddSearchTerm] = useState('');

  useEffect(() => {
      fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
      setLoading(true);
      try {
          // 1. ดึง Master Products ทั้งหมดเก็บไว้ (แก้ปัญหา Join ข้อมูลไม่ติด)
          const { data: pData } = await supabase.from('master_products').select('*').eq('status', 'ACTIVE');
          setMasterProducts(pData || []);

          // 2. ดึง Location ที่มีอยู่
          const { data: iData } = await supabase.from('inventory_lots').select('storage_location').gt('quantity', 0);
          const uniqueLocs = Array.from(new Set((iData || []).map(d => d.storage_location).filter(Boolean))).sort();
          setLocations(uniqueLocs as string[]);
      } catch (error) {
          console.error(error);
      }
      setLoading(false);
  };

  // 🚀 เริ่มสร้างงานนับ (Group by Product ID ให้เสถียรขึ้น)
  const generateCountTask = async () => {
      if (!selectedLocation) return alert("กรุณาเลือก Location ที่ต้องการตรวจนับ");
      setLoading(true);
      try {
          const { data: lots } = await supabase.from('inventory_lots').select('*').eq('storage_location', selectedLocation);
          
          // รวมยอดสต๊อกที่อาจมีหลาย Lot ใน Location เดียวกัน
          const aggregated: Record<string, number> = {};
          (lots || []).forEach(lot => {
              aggregated[lot.product_id] = (aggregated[lot.product_id] || 0) + Number(lot.quantity);
          });

          const itemsToCount = Object.keys(aggregated).map(pid => {
              const pInfo = masterProducts.find(p => p.product_id === pid);
              return {
                  product_id: pid,
                  product_name: pInfo?.product_name || 'Unknown Item',
                  unit: pInfo?.base_uom || 'Unit',
                  cost: Number(pInfo?.standard_cost) || 0,
                  system_qty: aggregated[pid],
                  location: selectedLocation,
                  isExtra: false // เอาไว้เช็คว่าเป็นของที่เพิ่งแอดเข้ามาใหม่ไหม
              };
          }).filter(item => item.system_qty > 0); // เอาเฉพาะที่ระบบมีของ

          setCountItems(itemsToCount);
          setActualCounts({}); 
          setCountSearchTerm('');
          setStep(2); 
      } catch (error: any) {
          alert("Error: " + error.message);
      }
      setLoading(false);
  };

  // ➕ เพิ่มสินค้านอกระบบที่นับเจอใน Location นี้
  const handleAddExtraItem = (product: any) => {
      const exists = countItems.find(i => i.product_id === product.product_id);
      if (exists) {
          alert("สินค้านี้มีอยู่ในรายการตรวจนับแล้ว!");
          return;
      }

      const newItem = {
          product_id: product.product_id,
          product_name: product.product_name,
          unit: product.base_uom || 'Unit',
          cost: Number(product.standard_cost) || 0,
          system_qty: 0, // ระบบคิดว่าไม่มีของ (0)
          location: selectedLocation,
          isExtra: true
      };

      setCountItems([newItem, ...countItems]);
      setShowAddModal(false);
      setAddSearchTerm('');
  };

  const submitBlindCount = () => {
      const uncounted = countItems.filter(item => actualCounts[item.product_id] === undefined || actualCounts[item.product_id] === '');
      if (uncounted.length > 0) {
          if (!window.confirm(`มีสินค้า ${uncounted.length} รายการที่ยังไม่ได้กรอกยอด (ระบบจะถือว่าเป็น 0)\nต้องการดำเนินการต่อหรือไม่?`)) return;
      }
      setStep(3); 
  };

  // 🛡️ Manager อนุมัติและปรับสต๊อก
  const approveAndAdjust = async () => {
      const discrepancies = countItems.filter(item => {
          const actual = Number(actualCounts[item.product_id]) || 0;
          return actual !== item.system_qty;
      });

      if (discrepancies.length === 0) {
          alert("🎉 ยอดตรงกันทุกรายการ! ไม่มีการปรับสต๊อก");
          setStep(1); return;
      }

      if (!window.confirm(`พบยอดดิฟ ${discrepancies.length} รายการ\nยืนยันการอนุมัติและปรับสต๊อก (Adjust) ในระบบหรือไม่?`)) return;

      setLoading(true);
      try {
          for (const item of discrepancies) {
              const actual = Number(actualCounts[item.product_id]) || 0;
              const diff = actual - item.system_qty;

              // 1. ดึงข้อมูล Lot เดิมของสินค้านี้ใน Location นี้
              const { data: existingLots } = await supabase.from('inventory_lots')
                  .select('*').eq('product_id', item.product_id).eq('storage_location', item.location);

              if (actual === 0) {
                  // ถ้าของหายหมด ให้เคลียร์ยอดทุก Lot ใน Location นี้เป็น 0
                  for (const l of existingLots || []) {
                      await supabase.from('inventory_lots').update({ quantity: 0 }).eq('lot_id', l.lot_id || l.id);
                  }
              } else if (existingLots && existingLots.length > 0) {
                  // ถ้ามี Lot อยู่แล้ว ให้เอาผลต่าง (diff) ไปบวก/ลบ กับ Lot แรกที่เจอ
                  const targetLot = existingLots[0];
                  await supabase.from('inventory_lots').update({ 
                      quantity: Number(targetLot.quantity) + diff,
                      last_updated: new Date().toISOString()
                  }).eq(targetLot.lot_id ? 'lot_id' : 'id', targetLot.lot_id || targetLot.id);
              } else {
                  // ถ้าไม่เคยมี Lot ใน Location นี้เลย (เช่นของหลงมา) ให้สร้างใหม่
                  await supabase.from('inventory_lots').insert([{
                      product_id: item.product_id,
                      storage_location: item.location,
                      quantity: actual
                  }]);
              }

              // 2. คำนวณ Balance รวมและบันทึก Transaction Log
              const { data: allLots } = await supabase.from('inventory_lots').select('quantity').eq('product_id', item.product_id);
              const totalBalance = allLots?.reduce((sum, l) => sum + Number(l.quantity), 0) || 0;

              await supabase.from('transactions_log').insert([{
                  transaction_type: 'ADJUST',
                  product_id: item.product_id,
                  quantity_change: diff,
                  balance_after: totalBalance,
                  remarks: `Cycle Count (${item.location}): System ${item.system_qty} -> Actual ${actual}`
              }]);
          }

          alert("✅ อนุมัติและปรับยอดสต๊อกสำเร็จ!");
          setStep(1);
          setCountItems([]);
          setActualCounts({});
          fetchInitialData(); // Refresh Locations
      } catch (error: any) {
          alert("Approval Error: " + error.message);
      }
      setLoading(false);
  };

  const summary = useMemo(() => {
      let match = 0; let diff = 0; let diffValue = 0;
      countItems.forEach(item => {
          const actual = Number(actualCounts[item.product_id]) || 0;
          if (actual === item.system_qty) match++;
          else {
              diff++;
              diffValue += Math.abs(actual - item.system_qty) * item.cost;
          }
      });
      return { match, diff, diffValue };
  }, [countItems, actualCounts]);

  const filteredCountItems = countItems.filter(item => 
      item.product_name.toLowerCase().includes(countSearchTerm.toLowerCase()) || 
      item.product_id.toLowerCase().includes(countSearchTerm.toLowerCase())
  );

  return (
    <div className="p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      {/* --- HEADER --- */}
      <div className="flex justify-between items-start mb-6 flex-shrink-0">
          <div>
              <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><RefreshCw size={20}/></div>
                  Cycle Count & Audit
              </h1>
              <p className="text-slate-500 text-sm mt-1">ระบบตรวจนับสต๊อกตามรอบ (Blind Count) และตรวจสอบยอด</p>
          </div>
          
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-xl shadow-sm border border-slate-200">
              <div className={`flex items-center gap-2 font-bold text-sm ${step >= 1 ? 'text-indigo-600' : 'text-slate-400'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 1 ? 'bg-indigo-100' : 'bg-slate-100'}`}>1</span> Plan
              </div>
              <div className="w-8 h-px bg-slate-200"></div>
              <div className={`flex items-center gap-2 font-bold text-sm ${step >= 2 ? 'text-indigo-600' : 'text-slate-400'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 2 ? 'bg-indigo-100' : 'bg-slate-100'}`}>2</span> Count
              </div>
              <div className="w-8 h-px bg-slate-200"></div>
              <div className={`flex items-center gap-2 font-bold text-sm ${step >= 3 ? 'text-indigo-600' : 'text-slate-400'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${step >= 3 ? 'bg-indigo-100' : 'bg-slate-100'}`}>3</span> Approve
              </div>
          </div>
      </div>

      <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative">
          {loading && (
              <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center text-indigo-600">
                  <Activity size={48} className="animate-spin mb-4"/>
                  <span className="font-bold tracking-widest uppercase">Processing...</span>
              </div>
          )}

          {/* ========================================== */}
          {/* STEP 1: GENERATE PLAN */}
          {/* ========================================== */}
          {step === 1 && (
              <div className="flex flex-col items-center justify-center h-full p-6 animate-fade-in">
                  <div className="w-full max-w-lg bg-slate-50 p-8 rounded-3xl border border-slate-200 text-center shadow-inner">
                      <div className="w-20 h-20 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
                          <MapPin size={32}/>
                      </div>
                      <h2 className="text-xl font-bold text-slate-800 mb-2">Create Count Task</h2>
                      <p className="text-slate-500 text-sm mb-8">เลือกโซน (Location) ที่ต้องการให้พนักงานเดินไปตรวจนับ</p>
                      
                      <div className="text-left mb-6">
                          <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block mb-2 pl-1">Select Location Zone</label>
                          <select 
                              className="w-full p-4 border border-slate-300 rounded-xl text-lg font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 bg-white shadow-sm cursor-pointer"
                              value={selectedLocation}
                              onChange={e => setSelectedLocation(e.target.value)}
                          >
                              <option value="">-- กรุณาเลือก Location --</option>
                              {locations.map(loc => <option key={loc} value={loc}>📍 Zone: {loc}</option>)}
                          </select>
                      </div>

                      <button onClick={generateCountTask} disabled={!selectedLocation} className="w-full py-4 bg-indigo-600 text-white rounded-xl font-black text-lg shadow-lg shadow-indigo-200 hover:bg-indigo-700 hover:scale-[1.02] transition-all disabled:bg-slate-300 disabled:scale-100 disabled:shadow-none flex items-center justify-center gap-2">
                          Start Blind Count <ArrowRight size={20}/>
                      </button>
                  </div>
              </div>
          )}

          {/* ========================================== */}
          {/* STEP 2: BLIND COUNT (UI ใช้งานง่ายขึ้น) */}
          {/* ========================================== */}
          {step === 2 && (
              <div className="flex flex-col h-full animate-fade-in">
                  <div className="p-4 bg-indigo-50 border-b border-indigo-100 flex flex-wrap justify-between items-center gap-4 shrink-0">
                      <div>
                          <h2 className="font-bold text-indigo-800 flex items-center gap-2"><ClipboardCheck size={18}/> Blind Count Entry</h2>
                          <p className="text-xs text-indigo-600 mt-1">Location: <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded shadow-sm">{selectedLocation}</span></p>
                      </div>
                      <div className="flex gap-3 items-center flex-1 justify-end">
                          <div className="relative w-64">
                              <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                              <input type="text" placeholder="ค้นหาสินค้าในใบจด..." className="w-full pl-9 p-2 rounded-lg border border-indigo-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={countSearchTerm} onChange={e => setCountSearchTerm(e.target.value)}/>
                          </div>
                          <button onClick={() => setShowAddModal(true)} className="bg-white text-indigo-600 border border-indigo-200 px-4 py-2 rounded-lg text-sm font-bold shadow-sm hover:bg-indigo-600 hover:text-white transition-colors flex items-center gap-1">
                              <Plus size={16}/> เพิ่มสินค้านอกระบบ
                          </button>
                      </div>
                  </div>
                  
                  <div className="flex-1 overflow-auto p-6 bg-slate-50">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {filteredCountItems.length === 0 && <div className="col-span-full text-center text-slate-400 p-10">ไม่พบรายการสินค้า</div>}
                          {filteredCountItems.map((item, idx) => (
                              <div key={item.product_id} className={`bg-white p-5 rounded-2xl shadow-sm border focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-100 transition-all ${item.isExtra ? 'border-amber-300 bg-amber-50/10' : 'border-slate-200'}`}>
                                  <div className="flex justify-between items-start mb-4">
                                      <span className="text-[10px] font-mono font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded">#{idx+1}</span>
                                      {item.isExtra && <span className="text-[9px] font-bold bg-amber-100 text-amber-700 px-2 py-1 rounded uppercase flex items-center gap-1"><AlertTriangle size={10}/> นอกระบบ</span>}
                                  </div>
                                  <div className="font-bold text-slate-800 text-lg leading-tight mb-1 truncate" title={item.product_name}>{item.product_name}</div>
                                  <div className="text-xs text-slate-500 font-mono mb-4">{item.product_id}</div>
                                  
                                  <div className="flex items-center gap-3">
                                      <input 
                                          type="number" min="0" placeholder="ระบุยอดที่นับได้"
                                          className="w-full text-center text-3xl font-black text-indigo-600 bg-slate-50 border border-slate-200 rounded-xl py-3 outline-none focus:bg-white focus:border-indigo-400 transition-colors placeholder:text-slate-300 placeholder:text-lg"
                                          value={actualCounts[item.product_id] ?? ''}
                                          onChange={(e) => setActualCounts({...actualCounts, [item.product_id]: e.target.value})}
                                      />
                                      <span className="text-slate-400 font-bold w-12 text-sm">{item.unit}</span>
                                  </div>
                              </div>
                          ))}
                      </div>
                  </div>

                  <div className="p-4 border-t border-slate-200 bg-white flex justify-between items-center shrink-0">
                      <button onClick={() => setStep(1)} className="px-6 py-3 font-bold text-slate-500 hover:bg-slate-100 rounded-xl transition-colors">Cancel</button>
                      <button onClick={submitBlindCount} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-md hover:bg-indigo-700 transition-all flex items-center gap-2">
                          Submit Count <ArrowRight size={18}/>
                      </button>
                  </div>
              </div>
          )}

          {/* ========================================== */}
          {/* STEP 3: MANAGER APPROVAL */}
          {/* ========================================== */}
          {step === 3 && (
              <div className="flex flex-col h-full animate-fade-in">
                  <div className="p-6 bg-slate-800 text-white flex flex-wrap justify-between items-center gap-4 shrink-0">
                      <div>
                          <h2 className="font-bold text-xl flex items-center gap-2"><ShieldAlert className="text-amber-400"/> Audit & Approval</h2>
                          <p className="text-xs text-slate-400 mt-1">ตรวจสอบยอดที่พนักงานนับเทียบกับระบบ Location: {selectedLocation}</p>
                      </div>
                      <div className="flex gap-4">
                          <div className="bg-emerald-500/20 border border-emerald-500/30 px-4 py-2 rounded-xl text-center">
                              <div className="text-[10px] text-emerald-300 uppercase font-bold">Matched</div>
                              <div className="text-xl font-black text-emerald-400">{summary.match}</div>
                          </div>
                          <div className="bg-rose-500/20 border border-rose-500/30 px-4 py-2 rounded-xl text-center min-w-[100px]">
                              <div className="text-[10px] text-rose-300 uppercase font-bold">Discrepancy</div>
                              <div className="text-xl font-black text-rose-400">{summary.diff}</div>
                          </div>
                      </div>
                  </div>

                  <div className="flex-1 overflow-auto bg-slate-50">
                      <table className="w-full text-left text-sm whitespace-nowrap border-collapse">
                          <thead className="bg-white text-slate-500 font-bold text-[10px] uppercase sticky top-0 shadow-sm z-10 border-b border-slate-200">
                              <tr>
                                  <th className="p-4 pl-6">Product Info</th>
                                  <th className="p-4 text-center bg-slate-100">System Qty</th>
                                  <th className="p-4 text-center bg-indigo-50 text-indigo-700">Actual Counted</th>
                                  <th className="p-4 text-center">Variance (Diff)</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                              {countItems.map(item => {
                                  const actual = Number(actualCounts[item.product_id]) || 0;
                                  const diff = actual - item.system_qty;
                                  const isDiff = diff !== 0;

                                  return (
                                      <tr key={item.product_id} className={`transition-colors ${isDiff ? 'bg-rose-50/30 hover:bg-rose-50/80' : 'bg-white hover:bg-slate-50'}`}>
                                          <td className="p-4 pl-6">
                                              <div className="font-bold text-slate-800">{item.product_name}</div>
                                              <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                                                  {item.product_id}
                                                  {item.isExtra && <span className="bg-amber-100 text-amber-700 px-1 rounded font-bold">ของหลงเข้าโซน</span>}
                                              </div>
                                          </td>
                                          <td className="p-4 text-center font-mono text-slate-500 bg-slate-50/50">
                                              {item.system_qty}
                                          </td>
                                          <td className="p-4 text-center font-black text-lg text-indigo-700 bg-indigo-50/30">
                                              {actual}
                                          </td>
                                          <td className="p-4 text-center">
                                              {isDiff ? (
                                                  <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded-full font-bold text-xs ${diff > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                                      {diff > 0 ? '+' : ''}{diff} {item.unit}
                                                  </span>
                                              ) : (
                                                  <span className="text-emerald-500 font-bold flex items-center justify-center gap-1"><CheckCircle size={14}/> OK</span>
                                              )}
                                          </td>
                                      </tr>
                                  );
                              })}
                          </tbody>
                      </table>
                  </div>

                  <div className="p-5 border-t border-slate-200 bg-white flex justify-between items-center shrink-0">
                      <div className="flex items-center gap-3">
                          <button onClick={() => setStep(2)} className="px-6 py-3 font-bold text-slate-500 border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors">Back to Edit</button>
                      </div>
                      <button onClick={approveAndAdjust} className={`px-8 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center gap-2 ${summary.diff > 0 ? 'bg-rose-600 text-white hover:bg-rose-700 shadow-rose-200' : 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-200'}`}>
                          {summary.diff > 0 ? <><Save size={18}/> Approve & Adjust Inventory</> : <><CheckCircle size={18}/> Verify (No Changes)</>}
                      </button>
                  </div>
              </div>
          )}
      </div>

      {/* --- MODAL: เพิ่มสินค้านอกระบบ --- */}
      {showAddModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[80vh]">
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2"><Package size={18} className="text-indigo-500"/> เพิ่มสินค้านอกระบบเพื่อตรวจนับ</h3>
                      <button onClick={()=>setShowAddModal(false)} className="text-slate-400 hover:text-rose-500"><X size={20}/></button>
                  </div>
                  <div className="p-4 border-b border-slate-100">
                      <div className="relative">
                          <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                          <input type="text" placeholder="พิมพ์ชื่อ หรือ รหัสสินค้า (Master Product)..." autoFocus className="w-full pl-9 p-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={addSearchTerm} onChange={e=>setAddSearchTerm(e.target.value)}/>
                      </div>
                  </div>
                  <div className="flex-1 overflow-auto p-2">
                      {masterProducts.filter(p => (p.product_name||'').toLowerCase().includes(addSearchTerm.toLowerCase()) || (p.product_id||'').toLowerCase().includes(addSearchTerm.toLowerCase())).slice(0, 50).map(p => (
                          <div key={p.product_id} onClick={()=>handleAddExtraItem(p)} className="p-3 border-b border-slate-100 hover:bg-indigo-50 cursor-pointer flex justify-between items-center group">
                              <div>
                                  <div className="font-bold text-slate-800 text-sm">{p.product_name}</div>
                                  <div className="text-xs text-slate-500 font-mono mt-0.5">{p.product_id}</div>
                              </div>
                              <button className="text-indigo-600 bg-indigo-100 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Plus size={16}/></button>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}