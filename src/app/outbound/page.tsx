"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import { ShoppingCart, Search, Plus, MapPin, Trash2, CheckCircle, UploadCloud, Store, FileText, AlertCircle, ScanBarcode, X, ChevronDown, ChevronUp, ShieldAlert, Camera, Layers, Filter } from 'lucide-react';
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
  expected_uom?: string; 
  uom_mismatch?: boolean; 
}

interface ParsedOrder {
  to_number: string;
  to_warehouse: string;
  ref_document: string;
  delivery_date: string;
  items: ParsedItem[];
  isDuplicate?: boolean; 
  source_file?: string; 
}

const extractDateFromFilename = (filename: string): string | null => {
    let match = filename.match(/(\d{4})[-_.](\d{2})[-_.](\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;

    match = filename.match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/);
    if (match) return `${match[3]}-${match[2]}-${match[1]}`;

    match = filename.match(/(\d{4})(\d{2})(\d{2})/);
    if (match && parseInt(match[2]) <= 12 && parseInt(match[3]) <= 31 && parseInt(match[1]) > 2000) {
        return `${match[1]}-${match[2]}-${match[3]}`;
    }

    match = filename.match(/(\d{2})(\d{2})(\d{4})/);
    if (match && parseInt(match[2]) <= 12 && parseInt(match[1]) <= 31 && parseInt(match[3]) > 2000) {
        return `${match[3]}-${match[2]}-${match[1]}`;
    }

    return null; 
};

export default function Outbound() {
  const [activeTab, setActiveTab] = useState<string>('scan'); 
  const [cart, setCart] = useState<any[]>([]);
  const [formData, setFormData] = useState<FormDataState>({
    docNo: '', branchId: '', branchName: '', refDoc: '', note: ''
  });
  const [bulkOrders, setBulkOrders] = useState<ParsedOrder[]>([]);
  const [uploadStats, setUploadStats] = useState<{total: number, dupes: number}>({ total: 0, dupes: 0 });
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  // 🟢 State สำหรับปุ่มกรองเฉพาะรายการที่มีปัญหา
  const [showOnlyErrors, setShowOnlyErrors] = useState<boolean>(false);

  const [inventory, setInventory] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState<string>('');
  const [branchSearchInput, setBranchSearchInput] = useState<string>('');
  const [showBranchDropdown, setShowBranchDropdown] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  
  const scannerInputRef = useRef<HTMLInputElement>(null);
  const branchDropdownRef = useRef<HTMLDivElement>(null);
  const [scanInput, setScanInput] = useState<string>('');

  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const scannerRef = useRef<any>(null);
  const lastScanRef = useRef<{code: string, time: number}>({code: '', time: 0});
  
  const inventoryRef = useRef<any[]>([]);
  useEffect(() => { inventoryRef.current = inventory; }, [inventory]);

  const [expandedOrders, setExpandedOrders] = useState<Record<number, boolean>>({});

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

  useEffect(() => {
      if (isCameraOpen) {
          import('html5-qrcode').then(({ Html5QrcodeScanner }) => {
              const scanner = new Html5QrcodeScanner(
                  "reader",
                  { fps: 10, qrbox: { width: 250, height: 150 }, aspectRatio: 1.0 },
                  false
              );
              scannerRef.current = scanner;
              scanner.render(
                  (decodedText: string) => {
                      const now = Date.now();
                      if (lastScanRef.current.code === decodedText && (now - lastScanRef.current.time) < 2000) return;
                      lastScanRef.current = { code: decodedText, time: now };
                      
                      processBarcode(decodedText);
                  },
                  (err: any) => { /* ignore */ }
              );
          }).catch(err => {
              alert("กรุณาติดตั้ง html5-qrcode (npm install html5-qrcode)");
              console.error(err);
          });
      }

      return () => {
          if (scannerRef.current) {
              scannerRef.current.clear().catch(console.error);
              scannerRef.current = null;
          }
      };
  }, [isCameraOpen]);

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
            location: invMap[p.product_id] ? Array.from(invMap[p.product_id].locs).join(', ') : (p.default_location || 'MAIN'),
            category: p.category || 'Uncategorized', 
            shelf_position: p.shelf_position || '-', 
            standard_cost: Number(p.standard_cost) || 0
        }));

        setInventory(processedInv);

        const { data: branchData } = await supabase.from('master_branches').select('*').eq('is_active', true);
        setBranches(branchData || []);
    } catch (error) { console.error("Error fetching data:", error); }
  };

  const handleBranchSelect = (branch: any) => {
      setFormData(prev => ({ ...prev, branchId: branch.branch_id, branchName: branch.branch_name }));
      setBranchSearchInput(branch.branch_name);
      setShowBranchDropdown(false);
  };

  const processBarcode = (barcode: string) => {
      const stockItem = inventoryRef.current.find(i => i.product_id.toLowerCase() === barcode.toLowerCase());
      if (!stockItem) {
          alert(`❌ ไม่พบรหัสสินค้า [${barcode}] ในระบบ`);
          return;
      }

      setCart(prevCart => {
          const existingIdx = prevCart.findIndex(c => c.productId === stockItem.product_id);
          if (existingIdx >= 0) {
              const newCart = [...prevCart];
              newCart[existingIdx].qtyPicked = (parseFloat(newCart[existingIdx].qtyPicked) || 0) + 1;
              return newCart;
          } else {
              return [...prevCart, {
                  productId: stockItem.product_id, 
                  productName: stockItem.product_name,
                  qtyPicked: 1, 
                  stockQty: stockItem.current_qty, 
                  location: stockItem.location || '-', 
                  category: stockItem.category, 
                  shelf_position: stockItem.shelf_position, 
                  unit: stockItem.unit || 'Piece',
                  standardCost: stockItem.standard_cost 
              }];
          }
      });
  };

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

  const isCartValid = cart.every(item => (parseFloat(item.qtyPicked) || 0) > 0 && (parseFloat(item.qtyPicked) || 0) <= item.stockQty);

  const handleSubmitScan = async () => {
      if (cart.length === 0) return alert("ตะกร้าว่างเปล่า");
      if (!formData.branchName || !formData.branchId) return alert("กรุณาระบุสาขา/ผู้รับให้ถูกต้อง");

      let forceReason = '';
      if (!isCartValid) {
          const reason = window.prompt("⚠️ มียอดเบิกเกินสต๊อกในระบบ!\nหากยืนยันต้องการ 'บังคับตัดสต๊อก (ติดลบ)' กรุณาระบุเหตุผล:");
          if (reason === null) return; 
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

          if (formData.refDoc) {
              const { data: existRef } = await supabase.from('outbound_orders')
                  .select('to_number')
                  .or(`to_number.eq.${formData.refDoc},ref_document.eq.${formData.refDoc}`)
                  .limit(1);
              if (existRef && existRef.length > 0) {
                  alert(`❌ เอกสารอ้างอิง "${formData.refDoc}" นี้มีประวัติถูกทำรายการจ่ายออกไปแล้วในระบบ`);
                  setLoading(false); return;
              }
          }

          await supabase.from('outbound_orders').insert([{
              to_number: formData.docNo,
              to_warehouse: formData.branchName,
              ref_document: formData.refDoc || 'MANUAL',
              delivery_date: new Date().toISOString().split('T')[0]
          }]);

          const linesToInsert = [];
          for (const item of cart) {
              const qtyToDeduct = parseFloat(item.qtyPicked);
              let remaining = qtyToDeduct;
              const { data: lots } = await supabase.from('inventory_lots').select('*').eq('product_id', item.productId).gt('quantity', 0).order('mfg_date', { ascending: true, nullsFirst: false });
              
              for (const lot of (lots || [])) {
                  if (remaining <= 0) break;
                  const deductAmt = Math.min(Number(lot.quantity), remaining);
                  await supabase.from('inventory_lots').update({ quantity: Number(lot.quantity) - deductAmt }).eq('lot_id', lot.lot_id);
                  remaining -= deductAmt;
              }

              if (remaining > 0) {
                  const { data: anyLot } = await supabase.from('inventory_lots').select('*').eq('product_id', item.productId).limit(1);
                  if (anyLot && anyLot.length > 0) {
                      await supabase.from('inventory_lots').update({ quantity: Number(anyLot[0].quantity) - remaining }).eq('lot_id', anyLot[0].lot_id);
                  } else {
                      await supabase.from('inventory_lots').insert([{ product_id: item.productId, quantity: -remaining, storage_location: 'PENDING_RCV' }]);
                  }
              }

              const { data: newLots } = await supabase.from('inventory_lots').select('quantity').eq('product_id', item.productId);
              const newBalance = newLots?.reduce((sum, l) => sum + Number(l.quantity), 0) || 0;

              const costAmt = qtyToDeduct * (item.standardCost || 0);

              await supabase.from('transactions_log').insert([{
                  transaction_type: 'OUTBOUND', product_id: item.productId, quantity_change: -qtyToDeduct, balance_after: newBalance,
                  branch_id: formData.branchId, remarks: `จ่ายออกตามเอกสาร ${formData.docNo}${forceReason ? ` (🚨 บังคับตัด: ${forceReason})` : ''}`,
                  metadata: { document_cost_amt: costAmt, unit_cost: item.standardCost, unit: item.unit } 
              }]);

              linesToInsert.push({
                  to_number: formData.docNo, rm_code: item.productId, description: item.productName, qty: qtyToDeduct, unit: item.unit
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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setLoading(true);
      try {
          const allParsedOrders: Record<string, ParsedOrder> = {};

          const { data: pData } = await supabase.from('master_products').select('product_id, product_name, standard_cost, base_uom'); 

          const readFilePromises = Array.from(files).map(file => {
              return new Promise<void>((resolve, reject) => {
                  const dateFromFilename = extractDateFromFilename(file.name);
                  const reader = new FileReader();
                  reader.onload = async (evt: any) => {
                      try {
                          const data = new Uint8Array(evt.target.result);
                          const workbook = XLSX.read(data, { type: 'array' });
                          const sheet = workbook.Sheets[workbook.SheetNames[0]];
                          const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: "" }); 

                          let currentHeader: ParsedOrder | null = null;
                          const { data: lotData } = await supabase.from('inventory_lots').select('product_id, quantity');
                          
                          const stockMap: Record<string, number> = {};
                          (lotData || []).forEach(l => { stockMap[l.product_id] = (stockMap[l.product_id] || 0) + Number(l.quantity); });

                          for (let i = 0; i < rows.length; i++) {
                              const row = rows[i];
                              if (!row || row.length === 0) continue;

                              const col0 = String(row[0]).trim();

                              if (col0.startsWith("TO-")) {
                                  let dDate = dateFromFilename;
                                  if (!dDate) {
                                      dDate = String(row[4]).trim();
                                      if (dDate.includes('/')) {
                                          const [d, m, y] = dDate.split('/');
                                          dDate = `${y}-${m}-${d}`;
                                      }
                                  }

                                  currentHeader = {
                                      to_number: col0, 
                                      to_warehouse: String(row[1]).trim(), 
                                      ref_document: String(row[3]).trim(), 
                                      delivery_date: dDate || new Date().toISOString().split('T')[0], 
                                      items: [], 
                                      isDuplicate: false,
                                      source_file: file.name
                                  };
                                  
                                  if(!allParsedOrders[col0]) {
                                      allParsedOrders[col0] = currentHeader;
                                  }
                                  continue;
                              }

                              if (currentHeader && col0 && !col0.startsWith("TO-") && !col0.includes("Total") && String(row[3]) !== "Total") {
                                  const qty = parseFloat(row[2]) || 0;
                                  if (qty > 0) {
                                      const stockItem = inventory.find(inv => inv.product_id === col0);
                                      const currentStock = stockItem ? stockItem.current_qty : 0;
                                      const unitCost = parseFloat(row[4]) || 0;
                                      const costAmt = parseFloat(row[6]) || (qty * unitCost) || 0;
                                      
                                      const productInfo = pData?.find(p => p.product_id === col0);
                                      const expectedUom = productInfo?.base_uom || 'Unit';
                                      const excelUnit = String(row[3]).trim();
                                      const isMismatch = !!productInfo && excelUnit.toLowerCase() !== expectedUom.toLowerCase();

                                      const targetOrder = allParsedOrders[currentHeader.to_number];
                                      if(targetOrder) {
                                          targetOrder.items.push({
                                              rm_code: col0, 
                                              description: String(row[1]).trim(), 
                                              qty: qty, 
                                              unit: excelUnit, 
                                              expected_uom: expectedUom,
                                              uom_mismatch: isMismatch, 
                                              unit_cost: unitCost, 
                                              cost_amt: costAmt, 
                                              inStock: currentStock, 
                                              hasError: currentStock < qty || isMismatch 
                                          });
                                      }
                                  }
                              }
                          }
                          resolve();
                      } catch (err) { reject(err); }
                  };
                  reader.readAsArrayBuffer(file);
              });
          });

          await Promise.all(readFilePromises);

          const toNumbers = Object.keys(allParsedOrders);
          if (toNumbers.length > 0) {
              const { data: existByToNumber } = await supabase.from('outbound_orders').select('to_number').in('to_number', toNumbers);
              const { data: existByRef } = await supabase.from('outbound_orders').select('ref_document').in('ref_document', toNumbers);
              
              const duplicateSet = new Set([ ...(existByToNumber?.map(d => d.to_number) || []), ...(existByRef?.map(d => d.ref_document) || []) ]);
              Object.values(allParsedOrders).forEach(order => { if (duplicateSet.has(order.to_number)) order.isDuplicate = true; });
          }

          // 🟢 1. Sort บิลที่มีปัญหาขึ้นมาอยู่ด้านบนสุดเสมอ
          const finalOrders = Object.values(allParsedOrders);
          finalOrders.sort((a, b) => {
              const aHasIssue = a.items.some(i => i.hasError || i.uom_mismatch);
              const bHasIssue = b.items.some(i => i.hasError || i.uom_mismatch);
              
              if (aHasIssue && !bHasIssue) return -1;
              if (!aHasIssue && bHasIssue) return 1;
              
              if (a.isDuplicate && !b.isDuplicate) return 1;
              if (!a.isDuplicate && b.isDuplicate) return -1;
              return 0;
          });

          setBulkOrders(finalOrders);
          
          // 🟢 สั่งเปิด Accordion อัตโนมัติสำหรับบิลที่มีปัญหา หรือ 3 บิลแรก
          const initialExpanded: Record<number, boolean> = {};
          finalOrders.forEach((o, idx) => { 
              if(o.items.some(i => i.hasError || i.uom_mismatch) || idx < 3) {
                  initialExpanded[idx] = true; 
              }
          });
          setExpandedOrders(initialExpanded);

          setUploadStats({
              total: finalOrders.length,
              dupes: finalOrders.filter(o => o.isDuplicate).length
          });

      } catch (error: any) { alert("เกิดข้อผิดพลาดในการอ่านไฟล์: " + error.message); }
      setLoading(false);
      e.target.value = ''; 
  };

  // 🟢 2. ฟังก์ชันแก้ไขตัวเลข Inline ของบรรทัดทั่วไป (พิมพ์ปุ๊บคำนวณปั๊บ)
  const handleUpdateItemQty = (orderIndex: number, itemIndex: number, newQty: number) => {
      const updated = [...bulkOrders];
      const item = updated[orderIndex].items[itemIndex];
      
      item.qty = newQty;
      item.cost_amt = newQty * (item.unit_cost || 0);
      
      // ประเมิน Error ใหม่จากยอดสต๊อก (ถ้าจำนวนใหม่เกินสต๊อก ก็ยังให้แดงอยู่)
      item.hasError = (item.inStock || 0) < newQty || item.uom_mismatch;

      setBulkOrders(updated);
  };

  // 🟢 ฟังก์ชันสำหรับกดยืนยัน UOM Mismatch
  const handleResolveUom = (orderIndex: number, itemIndex: number) => {
      const updated = [...bulkOrders];
      const item = updated[orderIndex].items[itemIndex];
      
      if (item.qty <= 0) return alert("กรุณาใส่จำนวนที่มากกว่า 0");

      item.unit = item.expected_uom || 'Unit';
      item.uom_mismatch = false;
      item.hasError = (item.inStock || 0) < item.qty; // ปลดล็อคแดงเรื่องหน่วย แล้วไปเช็คเรื่องสต๊อกแทน

      setBulkOrders(updated);
  };

  const validOrdersToProcess = bulkOrders.filter(o => !o.isDuplicate);
  const needsForceIssue = validOrdersToProcess.some(o => o.items.some(i => i.hasError && !i.uom_mismatch)); 
  const hasUomMismatchOverall = validOrdersToProcess.some(o => o.items.some(i => i.uom_mismatch));

  const handleSubmitBulk = async () => {
      if (validOrdersToProcess.length === 0) return alert("ไม่มีเอกสารใหม่ให้บันทึก (เป็นเอกสารซ้ำทั้งหมด)");
      
      if (hasUomMismatchOverall) {
          return alert("⚠️ พบรายการที่ 'หน่วยนับ' ไม่ตรงกับระบบ (ไฮไลท์สีแดง)\n\nกรุณากรอกตัวเลขจำนวนใหม่ให้เป็นหน่วยที่ระบบต้องการ และกดปุ่ม ✅ เพื่อยืนยันให้ครบทุกรายการก่อนครับ");
      }

      let forceReason = '';
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
          const requiredProducts = [...new Set(validOrdersToProcess.flatMap(o => o.items.map(i => i.rm_code)))];
          
          const { data: allLots } = await supabase.from('inventory_lots')
              .select('*').in('product_id', requiredProducts).gt('quantity', 0)
              .order('mfg_date', { ascending: true, nullsFirst: false });

          const lotsByProduct: Record<string, any[]> = {};
          requiredProducts.forEach(id => lotsByProduct[id] = []);
          (allLots || []).forEach(lot => {
              lotsByProduct[lot.product_id].push({...lot}); 
          });

          const balanceByProduct: Record<string, number> = {};
          requiredProducts.forEach(id => {
              balanceByProduct[id] = lotsByProduct[id].reduce((sum, l) => sum + Number(l.quantity), 0);
          });

          const ordersToInsert: any[] = [];
          const linesToInsert: any[] = [];
          const logsToInsert: any[] = [];
          const newLotsToInsert: any[] = [];
          const lotsMapToUpsert = new Map<string, any>(); 

          for (const order of validOrdersToProcess) {
              const rawBranch = order.to_warehouse ? String(order.to_warehouse).trim() : '';
              
              const matchedBranch = branches.find(b => b.branch_id === rawBranch || b.branch_name === rawBranch);
              const targetBranchId = matchedBranch ? matchedBranch.branch_id : rawBranch;

              ordersToInsert.push({
                  to_number: order.to_number, to_warehouse: order.to_warehouse,
                  ref_document: order.ref_document, delivery_date: order.delivery_date, summit_date: order.delivery_date 
              });

              for (const item of order.items) {
                  linesToInsert.push({
                      to_number: order.to_number, rm_code: item.rm_code, description: item.description,
                      qty: item.qty, unit: item.unit, unit_cost: item.unit_cost, cost_amt: item.cost_amt
                  });

                  let remaining = item.qty;
                  const productLots = lotsByProduct[item.rm_code];

                  for (const lot of productLots) {
                      if (remaining <= 0) break;
                      if (lot.quantity <= 0) continue; 

                      const deductAmt = Math.min(lot.quantity, remaining);
                      lot.quantity -= deductAmt;
                      remaining -= deductAmt;

                      lotsMapToUpsert.set(lot.lot_id, {
                          lot_id: lot.lot_id, product_id: lot.product_id, storage_location: lot.storage_location,
                          quantity: lot.quantity, mfg_date: lot.mfg_date, exp_date: lot.exp_date
                      });
                  }

                  if (remaining > 0) {
                      newLotsToInsert.push({ product_id: item.rm_code, quantity: -remaining, storage_location: 'PENDING_RCV' });
                  }

                  balanceByProduct[item.rm_code] -= item.qty;
                  const txDate = order.delivery_date ? `${order.delivery_date}T12:00:00.000Z` : new Date().toISOString();

                  logsToInsert.push({
                      transaction_type: 'OUTBOUND', product_id: item.rm_code, quantity_change: -item.qty,
                      balance_after: balanceByProduct[item.rm_code], branch_id: targetBranchId, 
                      remarks: `จ่ายออกตามเอกสาร ${order.to_number}${forceReason ? ` (🚨 บังคับตัด: ${forceReason})` : ''}`,
                      transaction_date: txDate,
                      metadata: { document_cost_amt: item.cost_amt, unit_cost: item.unit_cost, unit: item.unit }
                  });
              }
          }

          const promises = [];
          if (ordersToInsert.length > 0) promises.push(supabase.from('outbound_orders').insert(ordersToInsert));
          if (linesToInsert.length > 0) promises.push(supabase.from('outbound_lines').insert(linesToInsert));
          if (logsToInsert.length > 0) promises.push(supabase.from('transactions_log').insert(logsToInsert));
          if (newLotsToInsert.length > 0) promises.push(supabase.from('inventory_lots').insert(newLotsToInsert));

          const lotsToUpsert = Array.from(lotsMapToUpsert.values());
          if (lotsToUpsert.length > 0) promises.push(supabase.from('inventory_lots').upsert(lotsToUpsert));

          await Promise.all(promises);

          alert(`✅ นำเข้าข้อมูลและตัดสต๊อกสำเร็จ จำนวน ${validOrdersToProcess.length} เอกสาร `);
          setBulkOrders([]);
          fetchMasterData();
      } catch (error: any) { alert("❌ Error: " + error.message); }
      setLoading(false);
  };

  const removeOrder = (index: number) => {
      setBulkOrders(bulkOrders.filter((_, i) => i !== index));
  };

  const toggleOrderExpand = (index: number) => {
      setExpandedOrders(prev => ({ ...prev, [index]: !prev[index] }));
  };

  const filteredInventory = inventory.filter(p => (p.product_name || '').toLowerCase().includes(productSearchTerm.toLowerCase()) || (p.product_id || '').toLowerCase().includes(productSearchTerm.toLowerCase())).slice(0, 10);
  const filteredBranches = branches.filter(b => (b.branch_name || '').toLowerCase().includes(branchSearchInput.toLowerCase()) || (b.branch_id || '').toLowerCase().includes(branchSearchInput.toLowerCase()));

  return (
    <div className="flex h-full bg-slate-50 flex-col relative rounded-2xl overflow-hidden">
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm z-10 flex-wrap gap-2">
        <h1 className="text-xl md:text-2xl font-bold text-red-600 flex items-center gap-2"><ShoppingCart/> Outbound (จ่ายสินค้า)</h1>
        <div className="bg-slate-100 p-1 rounded-lg flex">
            <button onClick={() => setActiveTab('scan')} className={`px-4 py-2 rounded-md font-bold text-sm flex items-center gap-2 ${activeTab === 'scan' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}><ScanBarcode size={16}/> Scan / Manual</button>
            <button onClick={() => setActiveTab('bulk')} className={`px-4 py-2 rounded-md font-bold text-sm flex items-center gap-2 ${activeTab === 'bulk' ? 'bg-white text-red-600 shadow-sm' : 'text-slate-500'}`}><UploadCloud size={16}/> Import TO (Excel)</button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* === LEFT PANEL === */}
        {activeTab === 'scan' && (
            <div className="w-full md:w-[400px] bg-white border-b md:border-b-0 md:border-r flex flex-col shrink-0">
                <div className="p-4 flex flex-col h-full max-h-[40vh] md:max-h-full">
                    
                    <div className="mb-4 bg-slate-50 p-4 rounded-xl border-2 border-red-100 focus-within:border-red-500 focus-within:bg-red-50/20 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-red-500 uppercase flex items-center gap-1"><ScanBarcode size={14}/> Barcode Scanner</label>
                            
                            <button onClick={() => setIsCameraOpen(true)} className="flex items-center gap-1 bg-red-100 text-red-600 px-3 py-1.5 rounded-lg font-bold text-[10px] hover:bg-red-200 transition-colors shadow-sm">
                                <Camera size={14}/> เปิดกล้องสแกน
                            </button>
                        </div>
                        <input 
                            ref={scannerInputRef} type="text" 
                            className="w-full p-2 border border-slate-300 rounded-lg text-lg font-mono outline-none shadow-inner focus:ring-4 focus:ring-red-100 bg-white"
                            placeholder="สแกน หรือ พิมพ์บาร์โค้ด..."
                            value={scanInput} onChange={(e) => setScanInput(e.target.value)} onKeyDown={handleScan} autoFocus
                        />
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
                                <div className="min-w-0 pr-2">
                                    <div className="font-bold text-sm text-slate-700 truncate">{p.product_id}</div>
                                    <div className="text-xs text-slate-500 truncate">{p.product_name}</div>
                                    <div className="text-[10px] text-cyan-600 mt-1 font-bold">
                                        <Layers size={10} className="inline mr-1"/> Zone: {p.category} | Shelf: {p.shelf_position}
                                    </div>
                                </div>
                                <div className="text-right flex flex-col items-end shrink-0">
                                    <div className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-100">Stock: {p.current_qty.toLocaleString(undefined, {maximumFractionDigits: 2})}</div>
                                    <Plus size={16} className="text-slate-300 mt-2 group-hover:text-red-600"/>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        )}

        {/* === RIGHT PANEL === */}
        <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden min-w-0">
            {activeTab === 'scan' ? (
                <>
                    <div className="bg-white p-4 border-b border-slate-200 shadow-sm z-20">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="border-b md:border-b-0 md:border-r border-slate-100 pb-2 md:pb-0 md:pr-4">
                                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Doc No.</label>
                                <input className="w-full font-mono font-bold text-slate-800 text-lg border-none focus:ring-0 p-0 outline-none bg-transparent" value={formData.docNo} onChange={e=>setFormData(prev => ({...prev, docNo:e.target.value}))}/>
                            </div>
                            <div className="border-b md:border-b-0 md:border-r border-slate-100 pb-2 md:pb-0 md:pr-4 relative" ref={branchDropdownRef}>
                                <label className="text-[10px] uppercase font-bold text-red-500 flex items-center gap-1 mb-1"><Store size={10}/> สาขาที่เบิก (Branch) *</label>
                                <input type="text" className={`w-full font-bold text-sm border-none focus:ring-0 p-0 outline-none ${formData.branchName ? 'text-blue-600' : 'text-slate-500'}`} placeholder="ค้นหาสาขา..." value={branchSearchInput} onChange={e => {setBranchSearchInput(e.target.value); setShowBranchDropdown(true);}} onFocus={() => setShowBranchDropdown(true)}/>
                                {showBranchDropdown && (
                                    <div className="absolute top-full left-0 z-50 w-full bg-white border rounded shadow-2xl mt-2 max-h-64 overflow-y-auto">
                                        {filteredBranches.map((b: any) => (
                                            <div key={b.branch_id} onMouseDown={(e)=>{e.preventDefault(); handleBranchSelect(b);}} className="p-3 hover:bg-red-50 cursor-pointer border-b">
                                                <div className="font-bold text-sm">{b.branch_name}</div><div className="text-xs text-slate-400">ID: {b.branch_id}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="pb-2 md:pb-0">
                                <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Ref Document (อ้างอิงบิล Excel)</label>
                                <input className="w-full text-sm font-bold border-none p-0 outline-none placeholder-slate-300 bg-transparent" value={formData.refDoc} onChange={e=>setFormData(prev => ({...prev, refDoc:e.target.value}))} placeholder="เช่น TO-H00130165090..."/>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto p-4">
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b">
                                    <tr>
                                        <th className="p-3 w-10 text-center">#</th>
                                        <th className="p-3 min-w-[200px]">รหัส / ชื่อสินค้า <span className="text-cyan-600 ml-1">(พิกัดหยิบของ)</span></th>
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
                                        const isError = (parseFloat(item.qtyPicked) || 0) > item.stockQty;
                                        return (
                                        <tr key={idx} className={`${isError ? 'bg-orange-50/50' : ''}`}>
                                            <td className="p-3 text-center">{idx + 1}</td>
                                            <td className="p-3">
                                                <div className="font-bold">{item.productId}</div>
                                                <div className="text-xs text-slate-500 truncate max-w-[250px]" title={item.productName}>{item.productName}</div>
                                                <div className="mt-1 flex items-center gap-1">
                                                    <span className="text-[10px] font-bold text-cyan-600 bg-cyan-50 border border-cyan-100 px-1.5 py-0.5 rounded">Zone: {item.category}</span>
                                                    <span className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">Shelf: {item.shelf_position}</span>
                                                </div>
                                                {isError && <span className="text-[10px] text-orange-500 font-bold block mt-1">สต๊อกไม่พอ (ต้องบังคับตัด)</span>}
                                            </td>
                                            <td className="p-3 text-center font-mono bg-slate-50">{item.stockQty.toLocaleString(undefined, {maximumFractionDigits: 2})}</td>
                                            <td className="p-3 text-center bg-red-50/30 border-x">
                                                <input type="number" step="0.01" className={`w-full p-2 border rounded-lg text-center font-bold outline-none ${isError ? 'border-orange-500 text-orange-600 bg-orange-50' : 'border-slate-300'}`} value={item.qtyPicked} onChange={e => {const newCart = [...cart]; newCart[idx].qtyPicked = e.target.value; setCart(newCart);}}/>
                                            </td>
                                            <td className="p-3 text-center text-xs uppercase">{item.unit}</td>
                                            <td className="p-3"><button onClick={() => setCart(cart.filter((_, i) => i !== idx))} className="text-slate-300 hover:text-red-500"><Trash2 size={18}/></button></td>
                                        </tr>
                                    )})}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div className="bg-white p-4 border-t flex flex-col md:flex-row justify-between items-center shadow-lg gap-4">
                        <div className="text-sm font-bold">รวม: {cart.reduce((a,b) => a + (parseFloat(b.qtyPicked)||0), 0).toLocaleString(undefined, {maximumFractionDigits: 2})} ชิ้น</div>
                        <button 
                            onClick={handleSubmitScan} 
                            disabled={loading || cart.length === 0} 
                            className={`w-full md:w-auto px-8 py-3 rounded-xl text-white font-bold flex justify-center gap-2 ${loading || cart.length === 0 ? 'bg-slate-300' : !isCartValid ? 'bg-orange-500 hover:bg-orange-600' : 'bg-red-600 hover:bg-red-700'}`}
                        >
                            {loading ? 'Saving...' : !isCartValid ? <><AlertCircle size={20}/> บังคับจ่าย (Force Issue)</> : <><CheckCircle size={20}/> ยืนยันการจ่าย</>}
                        </button>
                    </div>
                </>
            ) : (
                <div className="flex flex-col h-full bg-slate-100 p-4 md:p-6 min-w-0">
                    <div className="bg-white p-6 md:p-8 rounded-xl border-2 border-dashed border-red-300 text-center mb-6 shadow-sm">
                        <label className="cursor-pointer block">
                            <UploadCloud size={48} className="mx-auto text-red-400 mb-2"/>
                            <span className="text-lg font-bold text-slate-700">อัปโหลดรายงานการเบิก (ลากวางได้หลายไฟล์)</span>
                            <p className="text-xs text-slate-400 mt-2">รูปแบบวันที่รองรับในชื่อไฟล์: YYYY-MM-DD, DD-MM-YYYY</p>
                            <input type="file" accept=".xlsx, .csv" multiple className="hidden" onChange={handleFileUpload} disabled={loading}/>
                        </label>
                    </div>

                    {hasUomMismatchOverall && (
                        <div className="mb-6 bg-rose-50 border border-rose-400 p-4 rounded-2xl flex items-start gap-3 shadow-sm animate-pulse">
                            <ShieldAlert size={24} className="text-rose-600 shrink-0"/>
                            <div>
                                <h3 className="font-black text-rose-800 text-lg">⚠️ พบรายการที่ "หน่วยนับ" (UOM) ไม่ตรงกับระบบ!</h3>
                                <p className="text-rose-700 text-sm mt-1 font-medium">เพื่อป้องกันสต๊อกเพี้ยน ระบบได้ทำการล็อคการนำเข้าไว้ <b>กรุณาดูที่ตารางด้านล่างและแปลงตัวเลขให้เป็นหน่วยที่ระบบต้องการ แล้วกด ✅ เพื่อยืนยัน</b></p>
                            </div>
                        </div>
                    )}

                    {bulkOrders.length > 0 && (
                        <div className="flex-1 overflow-auto bg-white rounded-xl shadow border flex flex-col min-w-0">
                            <div className="p-4 bg-slate-50 border-b flex flex-col md:flex-row justify-between items-center shrink-0 gap-4">
                                <div className="flex flex-col md:flex-row items-center gap-3">
                                    <div className="font-bold text-slate-700">พบ {uploadStats.total} เอกสาร (ซ้ำ {uploadStats.dupes} ใบ)</div>
                                    {/* 🟢 3. ปุ่มสำหรับกด Filter โชว์เฉพาะบิลที่มีปัญหา */}
                                    <button 
                                        onClick={() => setShowOnlyErrors(!showOnlyErrors)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-1.5 transition-colors ${showOnlyErrors ? 'bg-orange-100 text-orange-700 border-orange-300 shadow-inner' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50 shadow-sm'}`}
                                    >
                                        <Filter size={14}/> {showOnlyErrors ? 'แสดงทั้งหมด' : '🔍 กรองเฉพาะรายการที่มีปัญหา'}
                                    </button>
                                </div>
                                <button 
                                    onClick={handleSubmitBulk} 
                                    disabled={validOrdersToProcess.length === 0 || loading || hasUomMismatchOverall} 
                                    className={`w-full md:w-auto px-6 py-2 rounded-lg text-white font-bold shadow transition-colors ${validOrdersToProcess.length === 0 || hasUomMismatchOverall ? 'bg-slate-400 cursor-not-allowed' : needsForceIssue ? 'bg-orange-500 hover:bg-orange-600' : 'bg-green-600 hover:bg-green-700'}`}
                                >
                                    {loading ? 'Processing...' : needsForceIssue && !hasUomMismatchOverall ? `บังคับนำเข้าและตัดสต๊อก (${validOrdersToProcess.length})` : `⚡ นำเข้าและตัดสต๊อกทันที (${validOrdersToProcess.length})`}
                                </button>
                            </div>
                            
                            <div className="p-4 space-y-4 flex-1 overflow-y-auto min-w-0">
                                {needsForceIssue && !hasUomMismatchOverall && <div className="bg-orange-50 border border-orange-200 p-3 rounded-lg text-orange-700 text-sm font-bold flex items-center gap-2"><AlertCircle size={16}/> มีเอกสารที่สต๊อกไม่พอจ่าย คุณสามารถกดนำเข้าได้ แต่ระบบจะถามเหตุผลการบังคับตัด</div>}
                                
                                {bulkOrders.map((order, oIndex) => {
                                    // 🟢 ระบบกรอง หากเปิดโหมดกรอง แล้วบิลนั้นๆ ไม่มีปัญหาเลย ให้ข้ามการวาดบิลนั้นไปเลย
                                    if (showOnlyErrors && !order.items.some(i => i.hasError || i.uom_mismatch)) return null;

                                    return (
                                    <div key={order.to_number} className={`border rounded-lg overflow-hidden ${order.isDuplicate ? 'border-red-400' : order.items.some(i => i.hasError || i.uom_mismatch) ? 'border-orange-400 shadow-md ring-2 ring-orange-100' : 'border-slate-200'}`}>
                                        <div onClick={() => toggleOrderExpand(oIndex)} className={`p-4 flex flex-col md:flex-row justify-between md:items-center cursor-pointer gap-2 ${order.isDuplicate ? 'bg-red-100/50' : order.items.some(i => i.hasError || i.uom_mismatch) ? 'bg-orange-50' : 'bg-slate-50 hover:bg-slate-100'}`}>
                                            <div className="flex items-center gap-4">
                                                <button className="text-slate-400 hover:text-slate-700">
                                                    {expandedOrders[oIndex] ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
                                                </button>
                                                <div>
                                                    <div className="font-bold text-blue-700 text-lg flex items-center gap-2">
                                                        {order.to_number}
                                                        {order.isDuplicate && <span className="bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full flex items-center gap-1 shadow-sm"><ShieldAlert size={12}/> ซ้ำ</span>}
                                                    </div>
                                                    <div className="text-xs text-slate-500 mt-1"><Store size={12} className="inline mr-1"/>{order.to_warehouse}</div>
                                                </div>
                                            </div>
                                            <div className="text-left md:text-right flex flex-row md:flex-col items-center md:items-end justify-between md:justify-start ml-10 md:ml-0 mt-2 md:mt-0">
                                                <div className="font-bold text-slate-700">{order.items.length} รายการ</div>
                                                {order.isDuplicate 
                                                    ? <div className="text-[10px] text-red-500 font-bold bg-white px-2 py-0.5 rounded border border-red-200 ml-2 md:ml-0 md:mt-1">ข้ามอัตโนมัติ</div>
                                                    : <div className="text-xs text-slate-400 ml-2 md:ml-0 md:mt-1">
                                                        Date: {order.delivery_date} {order.source_file && `(จากไฟล์: ${order.source_file})`}
                                                      </div>
                                                }
                                            </div>
                                        </div>

                                        {expandedOrders[oIndex] && (
                                            <div className={`border-t bg-white overflow-x-auto ${order.isDuplicate ? 'opacity-50 pointer-events-none' : ''}`}>
                                                <table className="w-full text-left text-sm whitespace-nowrap">
                                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
                                                        <tr>
                                                            <th className="p-2 pl-4">RM Code</th>
                                                            <th className="p-2 min-w-[150px]">Description</th>
                                                            <th className="p-2 text-center bg-slate-100">มีสต๊อก</th>
                                                            <th className="p-2 text-center border-x border-slate-200 bg-blue-50/30">ยอดจ่าย (ปรับแก้ได้)</th>
                                                            <th className="p-2 text-right">Cost Amt.</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y">
                                                        {order.items.map((item, idx) => (
                                                            <tr key={idx} className={!order.isDuplicate && (item.hasError || item.uom_mismatch) ? 'bg-orange-50/50' : 'hover:bg-slate-50 transition-colors'}>
                                                                <td className="p-2 pl-4 font-bold">{item.rm_code}</td>
                                                                <td className="p-2 text-xs text-slate-600 truncate max-w-[200px]" title={item.description}>{item.description}</td>
                                                                <td className="p-2 text-center bg-slate-50 text-xs font-mono text-blue-600 border-x border-slate-100">{item.inStock?.toLocaleString(undefined, {maximumFractionDigits: 2})}</td>
                                                                
                                                                {/* 🟢 2. ให้กล่องจำนวนเป็น Input ที่สามารถแก้ไขได้ทั้งหมด */}
                                                                <td className="p-2 text-center border-r border-slate-200">
                                                                    <div className="flex flex-col items-center justify-center">
                                                                        {item.uom_mismatch && !order.isDuplicate && (
                                                                            <span className="text-[10px] font-black text-rose-600 mb-1.5 flex items-center gap-1 bg-rose-100 px-2 py-0.5 rounded shadow-sm border border-rose-200">
                                                                                <AlertCircle size={12}/> โดนเปลี่ยนหน่วยนับ! ({item.unit} ➡️ {item.expected_uom})
                                                                            </span>
                                                                        )}
                                                                        <div className="flex items-center gap-1 justify-center">
                                                                            <input 
                                                                                type="number" step="0.01"
                                                                                value={item.qty === 0 ? '' : item.qty}
                                                                                onChange={(e) => handleUpdateItemQty(oIndex, idx, Number(e.target.value))}
                                                                                className={`w-20 p-1.5 text-sm font-black text-center border rounded-lg outline-none focus:ring-2 transition-all shadow-inner ${item.uom_mismatch ? 'border-rose-400 bg-white focus:ring-rose-500 text-rose-700' : item.hasError ? 'border-orange-400 bg-white focus:ring-orange-500 text-orange-700' : 'border-slate-300 bg-white focus:ring-blue-500 text-slate-700'}`}
                                                                                disabled={order.isDuplicate}
                                                                                onClick={(e) => e.stopPropagation()}
                                                                            />
                                                                            
                                                                            {item.uom_mismatch && !order.isDuplicate ? (
                                                                                <button 
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        handleResolveUom(oIndex, idx);
                                                                                    }}
                                                                                    className="p-1.5 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors shadow-md border border-rose-600"
                                                                                    title="กดเพื่อยืนยันการเปลี่ยนหน่วยนับ"
                                                                                >
                                                                                    <CheckCircle size={16}/>
                                                                                </button>
                                                                            ) : (
                                                                                <span className="text-[10px] text-slate-500 font-bold ml-1 w-8 text-left uppercase tracking-wider">{item.unit}</span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </td>

                                                                <td className="p-2 text-right text-slate-500 text-xs font-mono">{item.cost_amt.toLocaleString()} ฿</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                )})}
                            </div>
                        </div>
                    )}
                    {bulkOrders.length === 0 && !loading && (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl bg-white">
                            <FileText size={64} className="opacity-20 mb-4"/>
                            <p className="font-medium">อัปโหลดไฟล์ Excel เพื่อแสดงพรีวิวข้อมูล</p>
                        </div>
                    )}
                </div>
            )}
        </div>
      </div>

      {/* 🟢 CAMERA MODAL */}
      {isCameraOpen && (
          <div className="fixed inset-0 bg-slate-900/90 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col">
                  <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2"><Camera size={20} className="text-red-500"/> สแกนผ่านกล้องมือถือ</h3>
                      <button onClick={() => setIsCameraOpen(false)} className="text-slate-400 hover:text-red-500 bg-white p-2 rounded-full shadow-sm"><X size={20}/></button>
                  </div>
                  <div className="p-4 bg-black flex justify-center items-center relative min-h-[300px]">
                      <div id="reader" className="w-full bg-white rounded-xl overflow-hidden"></div>
                  </div>
                  <div className="p-4 text-center bg-slate-50 border-t">
                      <div className="text-sm font-bold text-slate-600">หันกล้องไปที่บาร์โค้ด หรือ QR Code</div>
                      <div className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-widest">(ระบบจะค้นหาสินค้าให้อัตโนมัติ)</div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}