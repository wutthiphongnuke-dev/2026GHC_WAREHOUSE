"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { ShoppingCart, Search, Plus, MapPin, Trash2, CheckCircle, UploadCloud, Store, FileText, AlertCircle, ScanBarcode, X, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import * as XLSX from 'xlsx';

interface FormDataState {
  docNo: string;
  branchId: string;
  branchName: string;
  refDoc: string;
  note: string;
}

interface ParsedItem {
  rm_code: string;
  description: string;
  qty: number;
  unit: string;
  unit_cost: number;
  cost_amt: number;
  inStock?: number;
  hasError?: boolean;
}

interface ParsedOrder {
  to_number: string;
  to_warehouse: string;
  ref_document: string;
  delivery_date: string;
  items: ParsedItem[];
  isDuplicate?: boolean; 
}

const Outbound = () => {
  // --- STATE ---
  const [activeTab, setActiveTab] = useState<string>('scan'); 
  
  // State: Scan / Manual Mode
  const [cart, setCart] = useState<any[]>([]);
  const [formData, setFormData] = useState<FormDataState>({
    docNo: '', branchId: '', branchName: '', refDoc: '', note: ''
  });
  
  // State: Bulk Import Mode
  const [bulkOrders, setBulkOrders] = useState<ParsedOrder[]>([]);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // Master Data State
  const [inventory, setInventory] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState<string>('');
  const [branchSearchInput, setBranchSearchInput] = useState<string>('');
  const [showBranchDropdown, setShowBranchDropdown] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Refs
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const [scanInput, setScanInput] = useState<string>('');

  // --- INIT ---
  useEffect(() => {
    setFormData(prev => ({ ...prev, docNo: `TO-MNL-${Date.now()}` }));
    fetchMasterData();
    
    if (activeTab === 'scan' && scannerInputRef.current) scannerInputRef.current.focus();

    const handleClickOutside = (event: MouseEvent) => {
        if (branchDropdownRef.current && !branchDropdownRef.current.contains(event.target as Node)) setShowBranchDropdown(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [activeTab]);

  const fetchMasterData = async () => {
    try {
        const { data: prodData } = await supabase.from('master_products').select('*').eq('status', 'ACTIVE');
        const { data: lotsData } = await supabase.from('inventory_lots').select('product_id, quantity, storage_location');
        
        const invMap: Record<string, { total_qty: number, locs: Set<string> }> = {};
        (lotsData || []).forEach((lot: any) => {
            if (!invMap[lot.product_id]) invMap[lot.product_id] = { total_qty: 0, locs: new Set() };
            invMap[lot.product_id].total_qty += Number(lot.quantity) || 0;
            if (lot.storage_location) invMap[lot.product_id].locs.add(lot.storage_location);
        });

        const processedInv = (prodData || []).map(p => ({
            product_id: p.product_id,
            product_name: p.product_name,
            current_qty: invMap[p.product_id]?.total_qty || 0,
            unit: p.base_uom || 'Piece',
            location: invMap[p.product_id] ? Array.from(invMap[p.product_id].locs).join(', ') : (p.default_location || 'MAIN')
        }));

        setInventory(processedInv);

        const { data: branchData } = await supabase.from('master_branches').select('*').eq('is_active', true);
        setBranches(branchData || []);
    } catch (error) { console.error("Error fetching data:", error); }
  };

  // 🟢 1. แก้ไขให้สามารถกดเลือกสาขาได้
  const handleBranchSelect = (branch: any) => {
      setFormData(prev => ({ ...prev, branchId: branch.branch_id, branchName: branch.branch_name }));
      setBranchSearchInput(branch.branch_name);
      setShowBranchDropdown(false);
  };

  // ==========================================
  // SHARED: INVENTORY DEDUCTION (รองรับการหักติดลบ / Force Issue)
  // ==========================================
  const deductStockFIFO = async (productId: string, qtyToDeduct: number, docNo: string, targetBranchId: string, forceReason?: string) => {
      let remaining = qtyToDeduct;
      
      const { data: lots, error } = await supabase
          .from('inventory_lots')
          .select('*')
          .eq('product_id', productId)
          .gt('quantity', 0)
          .order('mfg_date', { ascending: true, nullsFirst: false });
          
      if (error) throw error;

      // 1. ตัดสต๊อกตาม Lot ที่มีเป็นบวกก่อน
      for (const lot of (lots || [])) {
          if (remaining <= 0) break;
          const deductAmt = Math.min(Number(lot.quantity), remaining);
          
          await supabase.from('inventory_lots')
              .update({ 
                  quantity: Number(lot.quantity) - deductAmt,
                  last_updated: new Date().toISOString()
              })
              .eq('lot_id', lot.lot_id);
              
          remaining -= deductAmt;
      }

      // 2. 🟢 หากตัดหมดแล้วแต่ยังเหลือยอดที่ต้องตัด (แสดงว่าสต๊อกไม่พอ แต่บังคับตัด)
      if (remaining > 0) {
          // หาว่ามี Lot ไหนหลงเหลืออยู่ไหมเพื่อเอาไปหักให้ติดลบ
          const { data: anyLot } = await supabase.from('inventory_lots').select('*').eq('product_id', productId).limit(1);
          
          if (anyLot && anyLot.length > 0) {
              await supabase.from('inventory_lots').update({ 
                  quantity: Number(anyLot[0].quantity) - remaining 
              }).eq('lot_id', anyLot[0].lot_id);
          } else {
              // ถ้าไม่มี Lot เลย ให้สร้าง Lot จำลองที่ติดลบไว้
              await supabase.from('inventory_lots').insert([{
                  product_id: productId,
                  quantity: -remaining,
                  storage_location: 'PENDING_RCV' 
              }]);
          }
      }

      // 3. 🟢 บันทึก Transaction Log และแนบ branch_id ไปเพื่อให้ Dashboard นำไปแสดงผล
      const { data: newLots } = await supabase.from('inventory_lots').select('quantity').eq('product_id', productId);
      const newBalance = newLots?.reduce((sum, l) => sum + Number(l.quantity), 0) || 0;

      let txRemarks = `จ่ายออกตามเอกสาร ${docNo}`;
      if (forceReason) txRemarks += ` (🚨 บังคับตัด: ${forceReason})`;

      await supabase.from('transactions_log').insert([{
          transaction_type: 'OUTBOUND',
          product_id: productId,
          quantity_change: -qtyToDeduct,
          balance_after: newBalance,
          branch_id: targetBranchId, 
          remarks: txRemarks
      }]);
  };

  // ==========================================
  // MODE 1: SCAN & MANUAL LOGIC
  // ==========================================
  const handleScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
          e.preventDefault();
          const scannedCode = scanInput.trim();
          if (scannedCode) {
              processBarcode(scannedCode);
              setScanInput(''); 
          }
      }
  };

  const processBarcode = (barcode: string) => {
      const stockItem = inventory.find(i => i.product_id.toLowerCase() === barcode.toLowerCase());
      if (!stockItem) return alert(`❌ ไม่พบรหัสสินค้า [${barcode}] ในระบบ`);

      const existingIdx = cart.findIndex(c => c.productId === stockItem.product_id);
      if (existingIdx >= 0) {
          const newCart = [...cart];
          newCart[existingIdx].qtyPicked = (parseInt(newCart[existingIdx].qtyPicked) || 0) + 1;
          setCart(newCart);
      } else {
          setCart([...cart, {
              productId: stockItem.product_id, productName: stockItem.product_name,
              qtyPicked: 1, stockQty: stockItem.current_qty, location: stockItem.location || '-', unit: stockItem.unit || 'Piece'
          }]);
      }
  };

  const updateItem = (index: number, field: string, value: any) => {
      const newCart = [...cart];
      newCart[index][field] = value;
      setCart(newCart);
  };

  const isCartValid = cart.every(item => parseInt(item.qtyPicked) > 0 && parseInt(item.qtyPicked) <= item.stockQty);

  const handleSubmitScan = async () => {
    if (cart.length === 0) return alert("ตะกร้าว่างเปล่า");
    if (!formData.branchName || !formData.branchId) return alert("กรุณาระบุสาขา/ผู้รับให้ถูกต้อง");

    let forceReason = '';
    
    // 🟢 ถ้ายอดไม่พอ ให้ถามเหตุผลเพื่อบังคับตัด
    if (!isCartValid) {
        const reason = window.prompt("⚠️ มียอดเบิกเกินสต๊อกในระบบ!\nหากยืนยันต้องการ 'บังคับตัดสต๊อก (ติดลบ)' กรุณาระบุเหตุผล (เช่น รับของมาแล้วแต่ยังไม่ได้คีย์):");
        if (reason === null) return; // กดยกเลิก
        if (reason.trim() === '') return alert("ต้องระบุเหตุผลเพื่อเป็นหลักฐานในการบังคับตัด");
        forceReason = reason;
    } else {
        if (!window.confirm(`ยืนยันการจ่ายสินค้า ไปยังสาขา: ${formData.branchName}?`)) return;
    }

    setLoading(true);
    try {
        const { data: exist } = await supabase.from('outbound_orders').select('to_number').eq('to_number', formData.docNo).single();
        if (exist) {
            alert(`❌ เลขเอกสาร ${formData.docNo} นี้ถูกใช้จ่ายออกไปแล้ว`);
            setLoading(false); return;
        }

        await supabase.from('outbound_orders').insert([{
            to_number: formData.docNo,
            to_warehouse: formData.branchName,
            ref_document: formData.refDoc || 'MANUAL',
            delivery_date: new Date().toISOString().split('T')[0]
        }]);

        const linesToInsert = [];
        for (const item of cart) {
            const pickQty = parseInt(item.qtyPicked);
            // โยน forceReason เข้าไปในฟังก์ชันตัดสต๊อก
            await deductStockFIFO(item.productId, pickQty, formData.docNo, formData.branchId, forceReason);

            linesToInsert.push({
                to_number: formData.docNo,
                rm_code: item.productId,
                description: item.productName,
                qty: pickQty,
                unit: item.unit,
                unit_cost: 0, cost_amt: 0
            });
        }
        await supabase.from('outbound_lines').insert(linesToInsert);

        alert("✅ จ่ายสินค้าออกสำเร็จ!");
        setCart([]);
        setFormData(prev => ({...prev, docNo: `TO-MNL-${Date.now()}`, refDoc: '', branchId: '', branchName: ''}));
        setBranchSearchInput('');
        fetchMasterData();
    } catch (error: any) { alert("❌ Error: " + error.message); }
    setLoading(false);
  };

  // ==========================================
  // MODE 2: BULK IMPORT EXCEL LOGIC
  // ==========================================
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (evt: any) => {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });

            const parsedOrders: Record<string, ParsedOrder> = {};
            let currentHeader: ParsedOrder | null = null;

            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                if (!row || row.length === 0) continue;

                const col0 = String(row[0]).trim();

                if (col0.startsWith("TO-")) {
                    let dDate = String(row[4]).trim();
                    if (dDate.includes('/')) {
                        const [d, m, y] = dDate.split('/');
                        dDate = `${y}-${m}-${d}`;
                    }
                    currentHeader = {
                        to_number: col0,
                        to_warehouse: String(row[1]).trim(),
                        ref_document: String(row[3]).trim(),
                        delivery_date: dDate,
                        items: [],
                        isDuplicate: false
                    };
                    parsedOrders[col0] = currentHeader;
                    continue;
                }

                if (currentHeader && col0 && !col0.startsWith("TO-") && !col0.includes("Total") && String(row[3]) !== "Total") {
                    const qty = parseFloat(row[2]) || 0;
                    if (qty > 0) {
                        const stockItem = inventory.find(inv => inv.product_id === col0);
                        const currentStock = stockItem ? stockItem.current_qty : 0;
                        
                        currentHeader.items.push({
                            rm_code: col0,
                            description: String(row[1]).trim(),
                            qty: qty,
                            unit: String(row[3]).trim(),
                            unit_cost: parseFloat(row[4]) || 0,
                            cost_amt: parseFloat(row[6]) || 0,
                            inStock: currentStock,
                            hasError: currentStock < qty // ระบุไว้เฉยๆ ว่าของไม่พอ แต่เราจะไม่บล็อก
                        });
                    }
                }
            }

            const toNumbers = Object.keys(parsedOrders);
            if (toNumbers.length > 0) {
                const { data: existingDocs } = await supabase
                    .from('outbound_orders')
                    .select('to_number')
                    .in('to_number', toNumbers);
                
                const duplicateSet = new Set(existingDocs?.map(d => d.to_number) || []);
                Object.values(parsedOrders).forEach(order => {
                    if (duplicateSet.has(order.to_number)) order.isDuplicate = true;
                });
            }

            // คำนวณข้ามบิลว่าของพอไหม
            const globalReq: Record<string, number> = {};
            Object.values(parsedOrders).filter(o => !o.isDuplicate).forEach(o => o.items.forEach(i => globalReq[i.rm_code] = (globalReq[i.rm_code] || 0) + i.qty));
            
            Object.values(parsedOrders).filter(o => !o.isDuplicate).forEach(o => {
                o.items.forEach(i => {
                    const stockItem = inventory.find(inv => inv.product_id === i.rm_code);
                    if (!stockItem || stockItem.current_qty < globalReq[i.rm_code]) i.hasError = true;
                });
            });

            setBulkOrders(Object.values(parsedOrders));
            setExpandedOrder(Object.values(parsedOrders)[0]?.to_number || null);

        } catch (error: any) { alert("เกิดข้อผิดพลาดในการอ่านไฟล์: " + error.message); }
        setLoading(false);
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const validOrdersToProcess = bulkOrders.filter(o => !o.isDuplicate);
  const needsForceIssue = validOrdersToProcess.some(o => o.items.some(i => i.hasError));

  const handleSubmitBulk = async () => {
    if (validOrdersToProcess.length === 0) return alert("ไม่มีเอกสารใหม่ให้บันทึก (เป็นเอกสารซ้ำทั้งหมด)");
    
    let forceReason = '';
    
    // 🟢 ถามหาเหตุผลหากเป็นการ Import Excel แล้วสต๊อกไม่พอ
    if (needsForceIssue) {
        const reason = window.prompt("⚠️ พบรายการที่สต๊อกไม่พอจ่าย!\nหากต้องการ 'บังคับตัดสต๊อก' กรุณาระบุเหตุผลเพื่อบันทึกในระบบ:");
        if (reason === null) return; 
        if (reason.trim() === '') return alert("กรุณาระบุเหตุผล หากต้องการบังคับตัดสต๊อก");
        forceReason = reason;
    } else {
        if (!window.confirm(`ระบบจะตัดเฉพาะเอกสารที่ไม่ซ้ำ\nยืนยันนำเข้าและจ่ายสินค้าจำนวน ${validOrdersToProcess.length} บิล?`)) return;
    }

    setLoading(true);
    try {
        for (const order of validOrdersToProcess) {
            
            // พยายามหา branch_id จากชื่อที่ส่งมา เพื่อให้หน้ารายงานเอาไปใช้ได้
            const matchedBranch = branches.find(b => b.branch_name === order.to_warehouse || b.branch_id === order.to_warehouse);
            const targetBranchId = matchedBranch ? matchedBranch.branch_id : order.to_warehouse;

            await supabase.from('outbound_orders').insert([{
                to_number: order.to_number,
                to_warehouse: order.to_warehouse,
                ref_document: order.ref_document,
                delivery_date: order.delivery_date
            }]);

            const linesToInsert = [];
            for (const item of order.items) {
                // 🟢 โยน forceReason เข้าไปตอนตัดสต๊อก
                await deductStockFIFO(item.rm_code, item.qty, order.to_number, targetBranchId, forceReason);

                linesToInsert.push({
                    to_number: order.to_number,
                    rm_code: item.rm_code,
                    description: item.description,
                    qty: item.qty,
                    unit: item.unit,
                    unit_cost: item.unit_cost,
                    cost_amt: item.cost_amt
                });
            }
            await supabase.from('outbound_lines').insert(linesToInsert);
        }

        alert(`✅ นำเข้าข้อมูลและตัดสต๊อกสำเร็จ จำนวน ${validOrdersToProcess.length} เอกสาร!`);
        setBulkOrders([]);
        fetchMasterData();
    } catch (error: any) { alert("❌ Error: " + error.message); }
    setLoading(false);
  };

  const filteredInventory = inventory.filter(p => (p.product_name || '').toLowerCase().includes(productSearchTerm.toLowerCase()) || (p.product_id || '').toLowerCase().includes(productSearchTerm.toLowerCase())).slice(0, 10);
  const filteredBranches = branches.filter(b => (b.branch_name || '').toLowerCase().includes(branchSearchInput.toLowerCase()) || (b.branch_id || '').toLowerCase().includes(branchSearchInput.toLowerCase()));

  return (
    <div className="flex h-full bg-slate-50 flex-col relative rounded-2xl overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm z-10">
        <h1 className="text-2xl font-bold text-red-600 flex items-center gap-2"><ShoppingCart/> Outbound (จ่ายสินค้า)</h1>
        <div className="bg-slate-100 p-1 rounded-lg flex">
            <button onClick={() => setActiveTab('scan')} className={`px-4 py-2 rounded-md font-bold text-sm flex items-center gap-2 ${activeTab === 'scan' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}><ScanBarcode size={16}/> Scan / Manual</button>
            <button onClick={() => setActiveTab('bulk')} className={`px-4 py-2 rounded-md font-bold text-sm flex items-center gap-2 ${activeTab === 'bulk' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}><UploadCloud size={16}/> Import TO (Excel)</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* === LEFT PANEL (Only show in SCAN mode) === */}
        {activeTab === 'scan' && (
            <div className="w-[400px] bg-white border-r flex flex-col">
                <div className="p-4 flex flex-col h-full">
                    <div className="mb-6 bg-slate-50 p-4 rounded-xl border-2 border-red-100 focus-within:border-red-500 focus-within:bg-red-50/20 transition-colors">
                        <label className="text-xs font-bold text-red-500 uppercase flex items-center gap-1 mb-2"><ScanBarcode size={14}/> Barcode Scanner</label>
                        <input 
                            ref={scannerInputRef} type="text" 
                            className="w-full p-3 border border-slate-300 rounded-lg text-lg font-mono outline-none shadow-inner focus:ring-4 focus:ring-red-100"
                            placeholder="Scan Product Barcode..."
                            value={scanInput} onChange={(e) => setScanInput(e.target.value)} onKeyDown={handleScan} autoFocus
                        />
                        <p className="text-[10px] text-slate-400 mt-2 text-center">เสียบเครื่องสแกนแล้วยิงได้เลย หรือพิมพ์แล้วกด Enter</p>
                    </div>

                    <div className="flex items-center gap-2 mb-2 px-1">
                        <div className="h-px bg-slate-200 flex-1"></div>
                        <span className="text-xs font-bold text-slate-400 uppercase">OR Manual Search</span>
                        <div className="h-px bg-slate-200 flex-1"></div>
                    </div>

                    <div className="mb-2 relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                        <input type="text" placeholder="ค้นหารหัส หรือ ชื่อสินค้า..." className="w-full pl-10 p-2.5 border rounded-lg bg-slate-50 outline-none focus:bg-white focus:border-red-400" 
                            value={productSearchTerm} onChange={e => setProductSearchTerm(e.target.value)}
                        />
                    </div>
                    
                    <div className="flex-1 overflow-auto border border-slate-200 rounded-lg bg-white">
                        {filteredInventory.length === 0 && <div className="p-8 text-center text-slate-400">ไม่พบสินค้าในสต๊อก</div>}
                        {filteredInventory.map((p: any) => (
                            <div key={p.product_id} onMouseDown={(e)=>{e.preventDefault(); processBarcode(p.product_id);}} className="p-3 border-b hover:bg-red-50 cursor-pointer flex justify-between items-center group transition-colors">
                                <div>
                                    <div className="font-bold text-sm text-slate-700">{p.product_id}</div>
                                    <div className="text-xs text-slate-500 truncate w-48">{p.product_name}</div>
                                </div>
                                <div className="text-right flex flex-col items-end">
                                    <div className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100">Stock: {p.current_qty}</div>
                                    <Plus size={16} className="text-slate-300 mt-2 group-hover:text-red-600"/>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* === RIGHT PANEL === */}
        <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
            
            {activeTab === 'scan' ? (
                <>
                    <div className="bg-white p-4 border-b border-slate-200 shadow-sm flex justify-between items-start z-20">
                        <div className="grid grid-cols-4 gap-4 flex-1">
                            <div className="col-span-1 border-r border-slate-100">
                                <label className="text-[10px] uppercase font-bold text-slate-400">Doc No.</label>
                                <input className="w-full font-mono font-bold text-slate-800 text-lg border-none focus:ring-0 p-0 outline-none bg-transparent" value={formData.docNo} onChange={e=>setFormData(prev => ({...prev, docNo:e.target.value}))}/>
                            </div>
                            <div className="col-span-1 border-r border-slate-100 relative" ref={branchDropdownRef}>
                                <label className="text-[10px] uppercase font-bold text-red-500 flex items-center gap-1"><Store size={10}/> สาขาที่เบิก (Branch) *</label>
                                <input type="text" className={`w-full font-bold text-sm border-none focus:ring-0 p-0 outline-none ${formData.branchName ? 'text-blue-600' : 'text-slate-500'}`} placeholder="พิมพ์เพื่อค้นหาสาขา..." value={branchSearchInput} onChange={e => {setBranchSearchInput(e.target.value); setShowBranchDropdown(true);}} onFocus={() => setShowBranchDropdown(true)}/>
                                {showBranchDropdown && (
                                    <div className="absolute top-full left-0 z-50 w-80 bg-white border rounded shadow-2xl mt-2 max-h-64 overflow-y-auto">
                                        {filteredBranches.map((b: any) => (
                                            <div key={b.branch_id} onMouseDown={(e)=>{e.preventDefault(); handleBranchSelect(b);}} className="p-3 hover:bg-red-50 cursor-pointer border-b">
                                                <div className="font-bold text-sm">{b.branch_name}</div><div className="text-xs text-slate-400">ID: {b.branch_id}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="col-span-1 border-r border-slate-100">
                                <label className="text-[10px] uppercase font-bold text-slate-400">Ref Document</label>
                                <input className="w-full text-sm font-bold border-none p-0 outline-none placeholder-slate-300 bg-transparent" value={formData.refDoc} onChange={e=>setFormData(prev => ({...prev, refDoc:e.target.value}))} placeholder="อ้างอิง..."/>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto p-4">
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b">
                                    <tr>
                                        <th className="p-3 w-10 text-center">#</th>
                                        <th className="p-3">รหัส / ชื่อสินค้า</th>
                                        <th className="p-3 w-32 text-center bg-slate-100">สต๊อกที่มี</th>
                                        <th className="p-3 w-40 text-center bg-red-50 text-red-700 border-x border-red-100">จ่ายออก</th>
                                        <th className="p-3 w-24 text-center">หน่วย</th>
                                        <th className="p-3 w-10"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {cart.length === 0 ? (
                                        <tr><td colSpan={6} className="p-12 text-center text-slate-400 h-64"><ShoppingCart size={48} className="opacity-20 mb-4 mx-auto"/><p>แสกนสินค้า หรือเลือกจากรายการด้านซ้าย</p></td></tr>
                                    ) : cart.map((item, idx) => {
                                        const isError = parseInt(item.qtyPicked) > item.stockQty;
                                        return (
                                        <tr key={idx} className={`${isError ? 'bg-orange-50/50' : ''}`}>
                                            <td className="p-3 text-center">{idx + 1}</td>
                                            <td className="p-3">
                                                <div className="font-bold">{item.productId}</div>
                                                <div className="text-xs text-slate-500">{item.productName}</div>
                                                {isError && <span className="text-[10px] text-orange-500 font-bold">สต๊อกไม่พอ (ต้องบังคับตัด)</span>}
                                            </td>
                                            <td className="p-3 text-center font-mono bg-slate-50">{item.stockQty}</td>
                                            <td className="p-3 text-center bg-red-50/30 border-x">
                                                <input type="number" className={`w-full p-2 border rounded-lg text-center font-bold outline-none ${isError ? 'border-orange-500 text-orange-600 bg-orange-50' : 'border-slate-300'}`} value={item.qtyPicked} onChange={e => updateItem(idx, 'qtyPicked', e.target.value)}/>
                                            </td>
                                            <td className="p-3 text-center text-xs uppercase">{item.unit}</td>
                                            <td className="p-3"><button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-500"><Trash2 size={18}/></button></td>
                                        </tr>
                                    )})}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white p-4 border-t flex justify-between items-center shadow-lg">
                        <div className="text-sm font-bold">รวม: {cart.reduce((a,b) => a + (parseInt(b.qtyPicked)||0), 0)} ชิ้น</div>
                        <button 
                            onClick={handleSubmitScan} 
                            disabled={loading || cart.length === 0} 
                            className={`px-8 py-3 rounded-xl text-white font-bold flex gap-2 ${loading || cart.length === 0 ? 'bg-slate-300' : !isCartValid ? 'bg-orange-500 hover:bg-orange-600' : 'bg-red-600 hover:bg-red-700'}`}
                        >
                            {loading ? 'Saving...' : !isCartValid ? <><AlertCircle size={20}/> บังคับจ่าย (Force Issue)</> : <><CheckCircle size={20}/> ยืนยันการจ่าย</>}
                        </button>
                    </div>
                </>
            ) : (
                // --- BULK PREVIEW UI ---
                <div className="flex flex-col h-full bg-slate-100 p-6">
                    <div className="bg-white p-8 rounded-xl border-2 border-dashed border-red-300 text-center mb-6 shadow-sm">
                        <label className="cursor-pointer block">
                            <UploadCloud size={48} className="mx-auto text-red-400 mb-2"/>
                            <span className="text-lg font-bold text-slate-700">อัปโหลดรายงานการเบิก (Excel)</span>
                            <p className="text-xs text-slate-400 mt-2">รูปแบบ: TO No., To Warehouse, Rm Code, Qty...</p>
                            <input type="file" accept=".xlsx, .csv" className="hidden" onChange={handleFileUpload} disabled={loading}/>
                        </label>
                    </div>

                    {bulkOrders.length > 0 && (
                        <div className="flex-1 overflow-auto bg-white rounded-xl shadow border flex flex-col">
                            <div className="p-4 bg-slate-50 border-b flex justify-between items-center shrink-0">
                                <div className="font-bold text-slate-700">พบ {bulkOrders.length} เอกสาร (ซ้ำ {bulkOrders.filter(o=>o.isDuplicate).length} ใบ)</div>
                                <button 
                                    onClick={handleSubmitBulk} 
                                    disabled={validOrdersToProcess.length === 0 || loading} 
                                    className={`px-6 py-2 rounded-lg text-white font-bold shadow ${validOrdersToProcess.length === 0 ? 'bg-slate-400' : needsForceIssue ? 'bg-orange-500 hover:bg-orange-600' : 'bg-green-600 hover:bg-green-700'}`}
                                >
                                    {loading ? 'Processing...' : needsForceIssue ? `บังคับนำเข้าและตัดสต๊อก (${validOrdersToProcess.length})` : `นำเข้าและตัดสต๊อก (${validOrdersToProcess.length})`}
                                </button>
                            </div>
                            
                            <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                                {needsForceIssue && <div className="bg-orange-50 border border-orange-200 p-3 rounded-lg text-orange-700 text-sm font-bold flex items-center gap-2"><AlertCircle size={16}/> มีเอกสารที่สต๊อกไม่พอจ่าย คุณสามารถกดนำเข้าได้ แต่ระบบจะถามเหตุผลการบังคับตัด</div>}
                                
                                {bulkOrders.map(order => (
                                    <div key={order.to_number} className={`border rounded-lg overflow-hidden ${order.isDuplicate ? 'border-red-400' : order.items.some(i => i.hasError) ? 'border-orange-400' : 'border-slate-200'}`}>
                                        <div onClick={() => setExpandedOrder(expandedOrder === order.to_number ? null : order.to_number)} className={`p-4 flex justify-between items-center cursor-pointer ${order.isDuplicate ? 'bg-red-100/50' : order.items.some(i => i.hasError) ? 'bg-orange-50' : 'bg-slate-50 hover:bg-slate-100'}`}>
                                            <div className="flex items-center gap-4">
                                                {expandedOrder === order.to_number ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
                                                <div>
                                                    <div className="font-bold text-blue-700 text-lg flex items-center gap-2">
                                                        {order.to_number}
                                                        {order.isDuplicate && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm"><ShieldAlert size={12}/> ซ้ำ (จ่ายแล้ว)</span>}
                                                    </div>
                                                    <div className="text-xs text-slate-500 mt-1"><Store size={12} className="inline mr-1"/>{order.to_warehouse}</div>
                                                </div>
                                            </div>
                                            <div className="text-right flex flex-col items-end">
                                                <div className="font-bold text-slate-700">{order.items.length} รายการ</div>
                                                {order.isDuplicate 
                                                    ? <div className="text-[10px] text-red-500 font-bold mt-1 bg-white px-2 py-0.5 rounded border border-red-200">เอกสารนี้จะถูกข้ามอัตโนมัติ</div>
                                                    : <div className="text-xs text-slate-400 mt-1">Ref: {order.ref_document} | Date: {order.delivery_date}</div>
                                                }
                                            </div>
                                        </div>

                                        {expandedOrder === order.to_number && (
                                            <div className={`border-t bg-white ${order.isDuplicate ? 'opacity-50 pointer-events-none' : ''}`}>
                                                <table className="w-full text-left text-sm">
                                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                                                        <tr>
                                                            <th className="p-2 pl-4">RM Code</th>
                                                            <th className="p-2">Description</th>
                                                            <th className="p-2 text-center bg-slate-100">มีสต๊อก</th>
                                                            <th className="p-2 text-center">จ่าย</th>
                                                            <th className="p-2 text-right">Cost Amt.</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y">
                                                        {order.items.map((item, idx) => (
                                                            <tr key={idx} className={!order.isDuplicate && item.hasError ? 'bg-orange-50/50' : ''}>
                                                                <td className="p-2 pl-4 font-bold">{item.rm_code}</td>
                                                                <td className="p-2 text-xs text-slate-600 truncate max-w-[200px]">{item.description}</td>
                                                                <td className="p-2 text-center bg-slate-50 text-xs font-mono text-blue-600">{item.inStock}</td>
                                                                <td className="p-2 text-center font-bold">
                                                                    <span className={!order.isDuplicate && item.hasError ? 'text-orange-600' : 'text-green-600'}>{item.qty}</span> <span className="text-[10px] text-slate-400">{item.unit}</span>
                                                                </td>
                                                                <td className="p-2 text-right text-slate-500">{item.cost_amt.toLocaleString()} ฿</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default Outbound;