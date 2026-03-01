"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    RefreshCw, MapPin, Search, ClipboardCheck, ShieldAlert, 
    CheckCircle, X, AlertTriangle, ArrowRight, Save, Activity, Plus, Package,
    Download, Bookmark, Edit2, FileText, Database, Users, CloudOff, Cloud, Trash2,
    UploadCloud, FileSpreadsheet // 🟢 นำเข้า Icon เพิ่มเติม
} from 'lucide-react';
import * as XLSX from 'xlsx';

export default function CycleCountPage() {
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<'LIST' | 'WORKSHEET'>('LIST');

  // --- List View States ---
  const [tasks, setTasks] = useState<any[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [locations, setLocations] = useState<string[]>([]);
  const [newLocation, setNewLocation] = useState('');

  // --- Worksheet States ---
  const [activeTask, setActiveTask] = useState<any>(null);
  const [lines, setLines] = useState<any[]>([]);
  const [masterProducts, setMasterProducts] = useState<any[]>([]);
  
  // Local changes for multi-user sync
  const [localCounts, setLocalCounts] = useState<Record<string, string>>({});
  const [localRemarks, setLocalRemarks] = useState<Record<string, string>>({});
  const [dirtyLines, setDirtyLines] = useState<Set<string>>(new Set());

  const [searchLine, setSearchLine] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [addSearchTerm, setAddSearchTerm] = useState('');

  // =====================================================================
  // 1. INITIAL LOAD (TASK LIST)
  // =====================================================================
  useEffect(() => {
      fetchTasks();
      fetchLocations();
  }, []);

  const fetchTasks = async () => {
      setLoading(true);
      try {
          const { data, error } = await supabase
              .from('cycle_count_tasks')
              .select('*')
              .order('created_at', { ascending: false });
          if (error) throw error;
          setTasks(data || []);
      } catch (err: any) { console.error(err); }
      setLoading(false);
  };

  const fetchLocations = async () => {
      try {
          const { data: pData } = await supabase.from('master_products').select('default_location');
          const { data: iData } = await supabase.from('inventory_lots').select('storage_location');
          const locs = new Set<string>();
          (pData || []).forEach(p => p.default_location && locs.add(p.default_location));
          (iData || []).forEach(i => i.storage_location && locs.add(i.storage_location));
          setLocations(Array.from(locs).sort());

          const { data: mp } = await supabase.from('master_products').select('*');
          setMasterProducts(mp || []);
      } catch (err) {}
  };

  // =====================================================================
  // 2. CREATE NEW TASK (SNAPSHOT)
  // =====================================================================
  const createNewTask = async () => {
      if (!newLocation) return alert("กรุณาเลือกโซนที่ต้องการนับ");
      setLoading(true);
      try {
          const isAll = newLocation === 'ALL';
          const taskNo = `CC-${new Date().toISOString().replace(/[-:T]/g, '').slice(0,14)}`;

          const { data: taskData, error: taskErr } = await supabase
              .from('cycle_count_tasks')
              .insert([{ task_no: taskNo, location_zone: newLocation }])
              .select()
              .single();
          
          if (taskErr) throw taskErr;

          const expectedProducts = isAll ? masterProducts : masterProducts.filter(p => p.default_location === newLocation);
          let query = supabase.from('inventory_lots').select('product_id, quantity, storage_location').limit(100000);
          if (!isAll) query = query.eq('storage_location', newLocation);
          const { data: lots } = await query;

          const aggregated: Record<string, number> = {};
          (lots || []).forEach(lot => {
              if (lot.product_id) aggregated[lot.product_id] = (aggregated[lot.product_id] || 0) + Number(lot.quantity);
          });

          const itemsMap: Record<string, any> = {};

          expectedProducts.forEach(p => {
              itemsMap[p.product_id] = {
                  task_id: taskData.task_id,
                  product_id: p.product_id,
                  system_qty: aggregated[p.product_id] || 0,
                  is_extra: false
              };
          });

          (lots || []).forEach(lot => {
              if (lot.product_id && !itemsMap[lot.product_id]) {
                  itemsMap[lot.product_id] = {
                      task_id: taskData.task_id,
                      product_id: lot.product_id,
                      system_qty: aggregated[lot.product_id] || 0,
                      is_extra: true
                  };
              }
          });

          const linesToInsert = Object.values(itemsMap);
          if (linesToInsert.length > 0) {
              const { error: lineErr } = await supabase.from('cycle_count_lines').insert(linesToInsert);
              if (lineErr) throw lineErr;
          }

          setShowCreateModal(false);
          fetchTasks();
          loadWorksheet(taskData);

      } catch (err: any) { alert("Error: " + err.message); }
      setLoading(false);
  };

  const deleteTask = async (taskId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation(); 
      
      if (!window.confirm("⚠️ ยืนยันการลบใบงานนี้ใช่หรือไม่?\nข้อมูลการตรวจนับทั้งหมดในใบงานนี้จะถูกลบและกู้คืนไม่ได้!")) return;
      
      setLoading(true);
      try {
          const { error } = await supabase.from('cycle_count_tasks').delete().eq('task_id', taskId);
          if (error) throw error;
          
          alert("🗑️ ลบใบงานเรียบร้อยแล้ว");
          
          if (activeTask?.task_id === taskId) {
              setView('LIST');
              setActiveTask(null);
          }
          fetchTasks();
      } catch (err: any) {
          alert("Error deleting task: " + err.message);
      }
      setLoading(false);
  };

  // =====================================================================
  // 3. WORKSHEET LOGIC (MULTI-USER SYNC)
  // =====================================================================
  const loadWorksheet = async (task: any) => {
      setLoading(true);
      setActiveTask(task);
      try {
          const { data, error } = await supabase
              .from('cycle_count_lines')
              .select('*')
              .eq('task_id', task.task_id)
              .order('system_qty', { ascending: false });
          
          if (error) throw error;
          
          const enrichedLines = (data || []).map(line => {
              const pInfo = masterProducts.find(p => p.product_id === line.product_id);
              return { ...line, product_name: pInfo?.product_name || 'Unknown', unit: pInfo?.base_uom || 'Unit' };
          });

          setLines(enrichedLines);
          setLocalCounts({});
          setLocalRemarks({});
          setDirtyLines(new Set());
          setView('WORKSHEET');
      } catch (err: any) { alert("Error loading task: " + err.message); }
      setLoading(false);
  };

  const handleLocalChange = (lineId: string, field: 'count' | 'remark', value: string) => {
      if (field === 'count') setLocalCounts(prev => ({ ...prev, [lineId]: value }));
      if (field === 'remark') setLocalRemarks(prev => ({ ...prev, [lineId]: value }));
      setDirtyLines(prev => new Set(prev).add(lineId));
  };

  const syncToCloud = async () => {
      if (dirtyLines.size === 0) return loadWorksheet(activeTask); 
      setLoading(true);
      try {
          const updates = Array.from(dirtyLines).map(lineId => {
              const line = lines.find(l => l.line_id === lineId);
              const newCountStr = localCounts[lineId] !== undefined ? localCounts[lineId] : line.counted_qty?.toString();
              const newCount = newCountStr ? Number(newCountStr) : null;
              
              return {
                  line_id: lineId,
                  task_id: activeTask.task_id,
                  product_id: line.product_id,
                  system_qty: line.system_qty,
                  counted_qty: newCount,
                  diff_qty: newCount !== null ? newCount - line.system_qty : null,
                  remarks: localRemarks[lineId] !== undefined ? localRemarks[lineId] : line.remarks
              };
          });

          const { error } = await supabase.from('cycle_count_lines').upsert(updates);
          if (error) throw error;

          await loadWorksheet(activeTask); 
      } catch (err: any) { alert("Sync Error: " + err.message); }
      setLoading(false);
  };

  const handleAddExtraItem = async (product: any) => {
      const exists = lines.find(l => l.product_id === product.product_id);
      if (exists) return alert("สินค้านี้มีอยู่ในใบงานแล้ว!");

      setLoading(true);
      try {
          await supabase.from('cycle_count_lines').insert([{
              task_id: activeTask.task_id,
              product_id: product.product_id,
              system_qty: 0,
              is_extra: true
          }]);
          setShowAddModal(false);
          setAddSearchTerm('');
          await loadWorksheet(activeTask);
      } catch (err: any) { alert(err.message); }
      setLoading(false);
  };

  // =====================================================================
  // 🟢 EXCEL EXPORT / IMPORT LOGIC
  // =====================================================================
  const handleDownloadTemplate = () => {
      const templateData = lines.map(item => ({
          'รหัสสินค้า (Product ID) *ห้ามแก้*': item.product_id,
          'ชื่อสินค้า (Product Name)': item.product_name,
          'ยอดระบบ (System Qty)': item.system_qty,
          'ยอดที่นับได้ (Counted Qty)': '', // ปล่อยว่างให้พนักงานไปกรอก
          'หมายเหตุ (Remarks)': ''
      }));

      const ws = XLSX.utils.json_to_sheet(templateData);
      // แนะนำการตั้งค่าความกว้างคอลัมน์
      ws['!cols'] = [{ wch: 25 }, { wch: 40 }, { wch: 15 }, { wch: 20 }, { wch: 30 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Count_Template");
      XLSX.writeFile(wb, `Template_${activeTask.task_no}.xlsx`);
  };

  const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt: any) => {
          try {
              const data = new Uint8Array(evt.target.result);
              const workbook = XLSX.read(data, { type: 'array' });
              const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]]);
              
              let updatedCount = 0;
              const newLocalCounts = { ...localCounts };
              const newLocalRemarks = { ...localRemarks };
              const newDirtyLines = new Set(dirtyLines);

              rows.forEach((row: any) => {
                  const pid = (row['รหัสสินค้า (Product ID) *ห้ามแก้*'] || row['Product ID'] || '').toString().trim();
                  const countedQty = row['ยอดที่นับได้ (Counted Qty)'];
                  const remark = row['หมายเหตุ (Remarks)'] || '';

                  // อัปเดตเฉพาะรายการที่มีการกรอกตัวเลขเข้ามาเท่านั้น
                  if (pid && countedQty !== undefined && countedQty !== null && countedQty !== '') {
                      const matchingLine = lines.find(l => l.product_id === pid);
                      if (matchingLine) {
                          newLocalCounts[matchingLine.line_id] = countedQty.toString();
                          newLocalRemarks[matchingLine.line_id] = remark.toString();
                          newDirtyLines.add(matchingLine.line_id);
                          updatedCount++;
                      }
                  }
              });

              if (updatedCount > 0) {
                  setLocalCounts(newLocalCounts);
                  setLocalRemarks(newLocalRemarks);
                  setDirtyLines(newDirtyLines);
                  alert(`✅ โหลดข้อมูลผลการนับสำเร็จ ${updatedCount} รายการ\n\n(ข้อมูลจะแสดงเป็นสีเหลือง กรุณาตรวจสอบและกดปุ่ม "Sync Data" เพื่อบันทึกขึ้นระบบ)`);
              } else {
                  alert("⚠️ ไม่พบข้อมูลยอดนับในไฟล์ หรือรหัสสินค้าไม่ตรงกับในใบงาน");
              }
          } catch (err: any) { alert("Error reading file: " + err.message); }
          e.target.value = ''; // รีเซ็ต input file
      };
      reader.readAsArrayBuffer(file);
  };

  const handleExportResult = () => {
      const exportData = lines.map(item => ({
          'Task No': activeTask.task_no,
          'Zone': activeTask.location_zone,
          'รหัสสินค้า (Product ID)': item.product_id,
          'ชื่อสินค้า (Product Name)': item.product_name,
          'หน่วย (Unit)': item.unit,
          'ยอดระบบ (B)': item.system_qty,
          'ยอดนับได้จริง (A)': item.counted_qty !== null ? item.counted_qty : 'ยังไม่ได้นับ',
          'ส่วนต่าง (C)': item.diff_qty !== null ? item.diff_qty : '-',
          'หมายเหตุ (Remarks)': item.remarks || (item.is_extra ? 'นอกระบบ/หลงโซน' : '')
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Count_Result");
      XLSX.writeFile(wb, `Result_${activeTask.task_no}.xlsx`);
  };

  // =====================================================================
  // 4. POST TO STOCK
  // =====================================================================
  const confirmAndPost = async () => {
      if (dirtyLines.size > 0) return alert("คุณยังมีข้อมูลที่ยังไม่ได้ Sync กรุณากดปุ่ม 'Sync Data' ก่อนยืนยัน");
      
      const discrepancies = lines.filter(l => l.diff_qty !== null && l.diff_qty !== 0);
      const uncounted = lines.filter(l => l.counted_qty === null);

      if (uncounted.length > 0) {
          if (!window.confirm(`⚠️ มี ${uncounted.length} รายการที่ยังไม่ได้นับ (จะถูกข้ามไป)\n\nยืนยันตัดสต๊อกสำหรับ ${discrepancies.length} รายการที่มีส่วนต่างหรือไม่?`)) return;
      } else {
          if (!window.confirm(`พบส่วนต่างทั้งหมด ${discrepancies.length} รายการ\nยืนยันการปรับสต๊อกจริงใช่หรือไม่?`)) return;
      }

      setLoading(true);
      try {
          const prodIds = discrepancies.map(d => d.product_id);
          const locationToAdjust = activeTask.location_zone;

          let lotQuery = supabase.from('inventory_lots').select('*').in('product_id', prodIds).limit(100000);
          if (locationToAdjust !== 'ALL') lotQuery = lotQuery.eq('storage_location', locationToAdjust);
          const { data: currentLots } = await lotQuery;

          const { data: globalLots } = await supabase.from('inventory_lots').select('product_id, quantity').in('product_id', prodIds).limit(100000);
          const globalSums: Record<string, number> = {};
          (globalLots || []).forEach(l => { globalSums[l.product_id] = (globalSums[l.product_id] || 0) + Number(l.quantity); });

          const lotsToUpsert: any[] = [];
          const lotsToInsert: any[] = [];
          const logsToInsert: any[] = [];
          const now = new Date().toISOString();

          for (const line of discrepancies) {
              const diff = line.diff_qty;
              const itemLots = (currentLots || []).filter(l => l.product_id === line.product_id);

              if (diff < 0) {
                  let remainingAbs = Math.abs(diff);
                  for (const lot of itemLots) {
                      if (remainingAbs <= 0) break;
                      const lotQty = Number(lot.quantity);
                      if (lotQty <= 0) continue;
                      const deduct = Math.min(lotQty, remainingAbs);
                      lotsToUpsert.push({
                          lot_id: lot.lot_id, product_id: lot.product_id, 
                          storage_location: lot.storage_location, 
                          quantity: lotQty - deduct, last_updated: now
                      });
                      remainingAbs -= deduct;
                  }
              } else if (diff > 0) {
                  if (itemLots.length > 0) {
                      itemLots.sort((a, b) => Number(b.quantity) - Number(a.quantity));
                      lotsToUpsert.push({
                          lot_id: itemLots[0].lot_id,
                          product_id: itemLots[0].product_id,
                          storage_location: itemLots[0].storage_location, 
                          quantity: Number(itemLots[0].quantity) + diff, 
                          last_updated: now
                      });
                  } else {
                      const pInfo = masterProducts.find(p => p.product_id === line.product_id);
                      const strictLocation = locationToAdjust === 'ALL' ? (pInfo?.default_location || 'UNKNOWN') : locationToAdjust;

                      lotsToInsert.push({
                          product_id: line.product_id,
                          storage_location: strictLocation, 
                          quantity: diff, last_updated: now
                      });
                  }
              }

              const currentGlobal = globalSums[line.product_id] || 0;
              const rmk = line.remarks ? ` | Note: ${line.remarks}` : '';
              logsToInsert.push({
                  transaction_type: 'ADJUST', product_id: line.product_id,
                  quantity_change: diff, balance_after: currentGlobal + diff,
                  branch_id: locationToAdjust, 
                  remarks: `Cycle Count Task [${activeTask.task_no}]: Sys ${line.system_qty} -> Act ${line.counted_qty}${rmk}`,
                  transaction_date: now
              });
          }

          const promises = [];
          if (lotsToUpsert.length > 0) promises.push(supabase.from('inventory_lots').upsert(lotsToUpsert));
          if (lotsToInsert.length > 0) promises.push(supabase.from('inventory_lots').insert(lotsToInsert));
          if (logsToInsert.length > 0) promises.push(supabase.from('transactions_log').insert(logsToInsert));
          promises.push(supabase.from('cycle_count_tasks').update({ status: 'COMPLETED', completed_at: now }).eq('task_id', activeTask.task_id));

          await Promise.all(promises);

          alert(`✅ ตัดสต๊อกเรียบร้อย!\nใบงานถูกปิดสมบูรณ์แล้ว`);
          setView('LIST');
          fetchTasks();
      } catch (err: any) { alert("Post Error: " + err.message); }
      setLoading(false);
  };

  // --- Helpers ---
  const filteredLines = lines.filter(l => 
      (l.product_name||'').toLowerCase().includes(searchLine.toLowerCase()) || 
      (l.product_id||'').toLowerCase().includes(searchLine.toLowerCase())
  );

  const summary = useMemo(() => {
      let match = 0; let diffCount = 0; let counted = 0;
      lines.forEach(l => {
          const liveCount = localCounts[l.line_id] !== undefined ? localCounts[l.line_id] : l.counted_qty?.toString();
          if (liveCount !== undefined && liveCount !== null && liveCount !== '') {
              counted++;
              if (Number(liveCount) === l.system_qty) match++; else diffCount++;
          }
      });
      const progress = lines.length > 0 ? ((counted / lines.length) * 100).toFixed(0) : '0';
      return { match, diffCount, counted, progress, totalItems: lines.length };
  }, [lines, localCounts]);

  return (
    <div className="p-4 md:p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
      
      {/* 🔴 VIEW: TASK LIST */}
      {view === 'LIST' && (
          <div className="flex flex-col h-full animate-fade-in">
              <div className="flex flex-col md:flex-row justify-between md:items-center mb-6 gap-4 flex-shrink-0">
                  <div>
                      <h1 className="text-xl md:text-2xl font-black text-slate-800 flex items-center gap-2">
                          <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><ClipboardCheck size={20}/></div>
                          Cycle Count Manager
                      </h1>
                      <p className="text-slate-500 text-xs md:text-sm mt-1">ระบบสร้างใบงานตรวจนับ และอนุมัติปรับสต๊อก</p>
                  </div>
                  <button onClick={() => setShowCreateModal(true)} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-colors">
                      <Plus size={18}/> สร้างใบงานนับใหม่ (New Task)
                  </button>
              </div>

              <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                  <div className="p-4 border-b bg-slate-50 flex items-center justify-between">
                      <div className="font-bold text-slate-700 text-sm">ประวัติใบงานทั้งหมด ({tasks.length} รายการ)</div>
                      <button onClick={fetchTasks} className="text-slate-400 hover:text-indigo-600"><RefreshCw size={16}/></button>
                  </div>
                  <div className="flex-1 overflow-auto p-4 custom-scrollbar">
                      {loading ? (
                          <div className="flex justify-center items-center h-40 text-indigo-500"><Activity className="animate-spin"/></div>
                      ) : tasks.length === 0 ? (
                          <div className="flex flex-col justify-center items-center h-40 text-slate-400">
                              <FileText size={48} className="opacity-20 mb-4"/>
                              <span>ยังไม่มีประวัติใบงานตรวจนับ</span>
                          </div>
                      ) : (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                              {tasks.map(task => (
                                  <div key={task.task_id} className={`border rounded-2xl p-5 hover:shadow-md transition-all cursor-pointer flex flex-col justify-between ${task.status === 'COMPLETED' ? 'bg-slate-50 border-slate-200' : 'bg-white border-indigo-200 shadow-sm'}`} onClick={() => loadWorksheet(task)}>
                                      <div>
                                          <div className="flex justify-between items-start mb-3">
                                              <span className="font-black text-indigo-700 font-mono text-sm bg-indigo-50 px-2 py-1 rounded">{task.task_no}</span>
                                              <div className="flex items-center gap-2">
                                                  <span className={`text-[10px] font-bold px-2 py-1 rounded-full uppercase ${task.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700 animate-pulse'}`}>{task.status.replace('_', ' ')}</span>
                                                  
                                                  {task.status !== 'COMPLETED' && (
                                                      <button onClick={(e) => deleteTask(task.task_id, e)} className="text-slate-300 hover:text-rose-500 transition-colors p-1" title="ลบใบงานนี้">
                                                          <Trash2 size={16}/>
                                                      </button>
                                                  )}
                                              </div>
                                          </div>
                                          <div className="font-bold text-slate-800 text-lg mb-1">Zone: {task.location_zone === 'ALL' ? 'รวมทั้งคลัง' : task.location_zone}</div>
                                          <div className="text-xs text-slate-500 flex items-center gap-1"><MapPin size={12}/> สร้างเมื่อ: {new Date(task.created_at).toLocaleDateString('th-TH')}</div>
                                      </div>
                                      <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center text-xs font-bold">
                                          {task.status === 'COMPLETED' ? (
                                              <span className="text-emerald-600 flex items-center gap-1"><CheckCircle size={14}/> ปิดจ๊อบแล้ว</span>
                                          ) : (
                                              <span className="text-indigo-600 flex items-center gap-1">คลิกเพื่อเปิดใบงาน <ArrowRight size={14}/></span>
                                          )}
                                      </div>
                                  </div>
                              ))}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* 🔴 VIEW: WORKSHEET (COUNTING INTERFACE) */}
      {view === 'WORKSHEET' && activeTask && (
          <div className="flex flex-col h-full animate-fade-in">
              
              <div className="bg-slate-800 text-white p-4 md:p-5 shrink-0 flex flex-col gap-3 md:gap-4 rounded-t-2xl">
                  <div className="flex flex-col lg:flex-row justify-between lg:items-center gap-3">
                      <div>
                          <div className="flex items-center gap-2 mb-1">
                              <button onClick={() => setView('LIST')} className="text-slate-400 hover:text-white bg-slate-700 p-1.5 rounded-lg transition-colors"><ArrowRight size={16} className="rotate-180"/></button>
                              <span className="bg-indigo-500 text-white text-[10px] font-mono px-2 py-0.5 rounded font-bold">{activeTask.task_no}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${activeTask.status === 'COMPLETED' ? 'bg-emerald-500' : 'bg-amber-500'}`}>{activeTask.status}</span>
                          </div>
                          <h2 className="font-bold text-lg md:text-xl flex items-center gap-2 mt-2">
                              Zone: {activeTask.location_zone === 'ALL' ? 'รวมทั้งหมด' : activeTask.location_zone}
                          </h2>
                      </div>
                      
                      <div className="flex flex-wrap gap-2">
                          {activeTask.status !== 'COMPLETED' && (
                              <>
                                  <button onClick={() => setShowAddModal(true)} className="bg-white/10 hover:bg-white/20 text-white border border-white/20 px-3 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1">
                                      <Plus size={14}/> เพิ่มของนอกใบงาน
                                  </button>
                                  
                                  {/* 🟢 กลุ่มปุ่ม Excel (Template / Import) */}
                                  <div className="flex bg-white/10 border border-white/20 rounded-lg overflow-hidden">
                                      <button onClick={handleDownloadTemplate} className="px-3 py-2 text-xs font-bold hover:bg-white/20 transition-colors flex items-center gap-1 border-r border-white/10" title="โหลดไฟล์ Excel ไปกรอกข้อมูลผลนับ">
                                          <FileSpreadsheet size={14}/> โหลดใบนับ (Template)
                                      </button>
                                      <label className="px-3 py-2 text-xs font-bold text-amber-300 hover:bg-white/20 transition-colors flex items-center gap-1 cursor-pointer" title="อัปโหลดไฟล์ Excel ที่กรอกผลนับแล้ว">
                                          <UploadCloud size={14}/> อัปโหลดผลนับ
                                          <input type="file" accept=".xlsx, .csv" hidden onChange={handleImportExcel} />
                                      </label>
                                  </div>
                              </>
                          )}
                          
                          <button onClick={handleExportResult} className="bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-2 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 shadow-sm">
                              <Download size={14}/> โหลดสรุปผล
                          </button>
                          
                          {activeTask.status !== 'COMPLETED' && (
                              <button onClick={syncToCloud} className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${dirtyLines.size > 0 ? 'bg-amber-400 text-amber-900 shadow-lg shadow-amber-500/20' : 'bg-indigo-500 text-white hover:bg-indigo-600'}`}>
                                  {dirtyLines.size > 0 ? <><CloudOff size={14}/> ยังไม่ Save ({dirtyLines.size})</> : <><Cloud size={14}/> Sync Data</>}
                              </button>
                          )}
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-2 md:gap-4 mt-2">
                      <div className="bg-slate-700/50 p-3 rounded-xl border border-slate-600">
                          <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">ความคืบหน้า</div>
                          <div className="text-xl font-black">{summary.counted}/{summary.totalItems} <span className="text-xs font-normal opacity-50">({summary.progress}%)</span></div>
                      </div>
                      <div className="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
                          <div className="text-[10px] text-emerald-300 uppercase font-bold mb-1">ยอดตรง (Match)</div>
                          <div className="text-xl font-black text-emerald-400">{summary.match}</div>
                      </div>
                      <div className="bg-rose-500/10 p-3 rounded-xl border border-rose-500/20">
                          <div className="text-[10px] text-rose-300 uppercase font-bold mb-1">ส่วนต่าง (Diff)</div>
                          <div className="text-xl font-black text-rose-400">{summary.diffCount}</div>
                      </div>
                  </div>
              </div>

              <div className="p-2 border-x border-b border-slate-200 bg-slate-50 flex justify-between items-center shrink-0">
                  <div className="text-xs text-slate-500 font-bold ml-2 flex items-center gap-2"><Users size={14}/> Multi-user Realtime</div>
                  <div className="relative w-64">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={14}/>
                      <input type="text" placeholder="ค้นหาสินค้าในใบงาน..." className="w-full pl-8 p-1.5 rounded border border-slate-300 text-xs outline-none focus:border-indigo-500 bg-white" value={searchLine} onChange={e => setSearchLine(e.target.value)}/>
                  </div>
              </div>

              {/* Table */}
              <div className="flex-1 overflow-hidden bg-white border-x border-slate-200 flex flex-col">
                  <div className="overflow-x-auto flex-1 custom-scrollbar">
                      <table className="w-full text-left text-sm whitespace-nowrap min-w-[800px]">
                          <thead className="bg-slate-100 text-slate-600 font-bold text-[10px] uppercase sticky top-0 shadow-sm z-10 border-b border-slate-200">
                              <tr>
                                  <th className="p-3 pl-4">Product Info</th>
                                  <th className="p-3 text-center bg-slate-200/50">ระบบ (B)</th>
                                  <th className="p-3 text-center bg-indigo-50 text-indigo-700">นับได้จริง (A)</th>
                                  <th className="p-3 text-center border-r">ส่วนต่าง (C)</th>
                                  <th className="p-3 pr-4">หมายเหตุ</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                              {loading && lines.length === 0 ? (
                                  <tr><td colSpan={5} className="p-10 text-center"><Activity className="animate-spin mx-auto text-indigo-500"/></td></tr>
                              ) : filteredLines.map(item => {
                                  // หาค่าที่พิมพ์สดๆ (ถ้ามี) หรือเอาค่าจาก Cloud
                                  const displayCountStr = localCounts[item.line_id] !== undefined ? localCounts[item.line_id] : (item.counted_qty !== null ? item.counted_qty.toString() : '');
                                  const displayRemark = localRemarks[item.line_id] !== undefined ? localRemarks[item.line_id] : (item.remarks || '');
                                  const isDirty = dirtyLines.has(item.line_id);
                                  
                                  const isCounted = displayCountStr !== '';
                                  const actual = isCounted ? Number(displayCountStr) : null;
                                  const diff = actual !== null ? actual - item.system_qty : null;
                                  const isDiff = diff !== null && diff !== 0;
                                  const isReadonly = activeTask.status === 'COMPLETED';

                                  return (
                                      <tr key={item.line_id} className={`transition-colors ${!isCounted ? 'hover:bg-slate-50' : isDiff ? 'bg-rose-50/40' : 'bg-emerald-50/20'}`}>
                                          <td className="p-3 pl-4">
                                              <div className="font-bold text-slate-800 text-sm truncate max-w-[250px]">{item.product_name}</div>
                                              <div className="text-[10px] text-slate-500 font-mono mt-0.5 flex items-center gap-2">
                                                  {item.product_id}
                                                  {item.is_extra && <span className="bg-amber-100 text-amber-700 px-1 rounded font-bold uppercase text-[9px]">เพิ่มใหม่</span>}
                                              </div>
                                          </td>
                                          
                                          <td className="p-3 text-center font-mono text-slate-700 bg-slate-50/50 font-bold text-base">
                                              {item.system_qty}
                                          </td>
                                          
                                          <td className="p-2 text-center bg-indigo-50/20 relative">
                                              <input 
                                                  type="number" min="0" placeholder={isReadonly ? '-' : "รอการนับ..."} disabled={isReadonly}
                                                  className={`w-28 text-center text-lg font-black rounded-xl py-2 outline-none border transition-colors disabled:bg-transparent disabled:border-none ${!isCounted ? 'text-slate-400 bg-white border-slate-200 focus:border-indigo-400' : isDiff ? 'text-rose-600 bg-white border-rose-300 focus:border-rose-500' : 'text-emerald-700 bg-emerald-100/50 border-emerald-200'}`}
                                                  value={displayCountStr}
                                                  onChange={(e) => handleLocalChange(item.line_id, 'count', e.target.value)}
                                              />
                                              {isDirty && <div className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full animate-pulse" title="ยังไม่ Save ขึ้น Cloud"></div>}
                                          </td>

                                          <td className="p-3 text-center border-r border-slate-100">
                                              {diff === null ? <span className="text-slate-300">-</span> : isDiff ? (
                                                  <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full font-black text-sm ${diff > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                                      {diff > 0 ? '+' : ''}{diff}
                                                  </span>
                                              ) : <span className="text-emerald-500 font-bold text-xs"><CheckCircle size={14} className="inline mr-1"/>ยอดตรง</span>}
                                          </td>

                                          <td className="p-2 pr-4">
                                              <input 
                                                  type="text" placeholder={isReadonly ? '-' : "ระบุสาเหตุดิฟ..."} disabled={isReadonly}
                                                  className={`w-full p-2 text-xs outline-none rounded-lg border transition-colors disabled:bg-transparent disabled:border-none ${isDirty ? 'bg-amber-50/50 border-amber-200' : 'bg-white border-slate-200 focus:border-indigo-400'}`}
                                                  value={displayRemark}
                                                  onChange={(e) => handleLocalChange(item.line_id, 'remark', e.target.value)}
                                              />
                                          </td>
                                      </tr>
                                  );
                              })}
                          </tbody>
                      </table>
                  </div>
              </div>

              {/* Bottom Action Bar */}
              {activeTask.status !== 'COMPLETED' && (
                  <div className="p-4 border-x border-b rounded-b-2xl border-slate-200 bg-white flex flex-col sm:flex-row justify-between items-center gap-3 shadow-[0_-4px_10px_-5px_rgba(0,0,0,0.1)] shrink-0">
                      <button onClick={() => deleteTask(activeTask.task_id)} className="w-full sm:w-auto px-4 py-2 font-bold text-rose-500 hover:bg-rose-50 rounded-xl transition-colors text-sm md:text-base flex items-center justify-center gap-2">
                          <Trash2 size={16}/> ลบและทิ้งใบงานนี้
                      </button>
                      <button onClick={confirmAndPost} className="w-full sm:w-auto px-8 py-3 rounded-xl font-bold shadow-lg transition-all flex items-center justify-center gap-2 text-white bg-slate-900 hover:bg-black hover:scale-[1.02]">
                          <Save size={18}/> ยืนยันจบงานและอัปเดตสต๊อก
                      </button>
                  </div>
              )}
          </div>
      )}

      {/* 🔴 MODAL: CREATE TASK */}
      {showCreateModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in">
                  <div className="p-5 border-b bg-slate-50 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800 text-lg">สร้างใบงานใหม่</h3>
                      <button onClick={()=>setShowCreateModal(false)} className="text-slate-400 hover:text-rose-500"><X size={20}/></button>
                  </div>
                  <div className="p-6">
                      <label className="text-xs font-bold text-slate-500 uppercase block mb-2">เลือกโซนที่จะนับ</label>
                      <select 
                          className="w-full p-3 border border-slate-300 rounded-xl text-base font-bold text-slate-700 outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                          value={newLocation} onChange={e => setNewLocation(e.target.value)}
                      >
                          <option value="">-- กรุณาเลือก --</option>
                          <option value="ALL">🌟 รวมทั้งหมดทุกโซน (Global)</option>
                          {locations.map(loc => <option key={loc} value={loc}>📍 Zone: {loc}</option>)}
                      </select>
                  </div>
                  <div className="p-4 border-t bg-slate-50 flex gap-3">
                      <button onClick={()=>setShowCreateModal(false)} className="flex-1 py-3 font-bold text-slate-600 hover:bg-slate-200 rounded-xl transition-colors">ยกเลิก</button>
                      <button onClick={createNewTask} disabled={loading || !newLocation} className="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-200 disabled:bg-slate-300 transition-all">สร้างใบงาน</button>
                  </div>
              </div>
          </div>
      )}

      {/* 🔴 MODAL: ADD EXTRA ITEM */}
      {showAddModal && (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2"><Package size={16} className="text-indigo-500"/> ค้นหาสินค้าเพิ่มเข้าใบงาน</h3>
                      <button onClick={()=>setShowAddModal(false)} className="text-slate-400 hover:text-rose-500"><X size={20}/></button>
                  </div>
                  <div className="p-4 border-b border-slate-100">
                      <div className="relative">
                          <Search className="absolute left-3 top-3 text-slate-400" size={16}/>
                          <input type="text" placeholder="พิมพ์ชื่อ หรือ รหัส..." autoFocus className="w-full pl-9 p-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={addSearchTerm} onChange={e=>setAddSearchTerm(e.target.value)}/>
                      </div>
                  </div>
                  <div className="flex-1 overflow-auto p-2 custom-scrollbar">
                      {masterProducts.filter(p => (p.product_name||'').toLowerCase().includes(addSearchTerm.toLowerCase()) || (p.product_id||'').toLowerCase().includes(addSearchTerm.toLowerCase())).slice(0, 50).map(p => (
                          <div key={p.product_id} onClick={()=>handleAddExtraItem(p)} className="p-3 border-b border-slate-50 hover:bg-indigo-50 cursor-pointer flex justify-between items-center group rounded-xl">
                              <div>
                                  <div className="font-bold text-slate-800 text-sm">{p.product_name}</div>
                                  <div className="text-xs text-slate-500 font-mono mt-0.5">{p.product_id}</div>
                              </div>
                              <button className="text-indigo-600 bg-indigo-100 p-2 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"><Plus size={16}/></button>
                          </div>
                      ))}
                  </div>
              </div>
          </div>
      )}

    </div>
  );
}