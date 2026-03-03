"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../../supabaseClient'; 
import { Plus, Trash2, Search, FileUp, FileDown, Truck, Calendar, Thermometer, MapPin, Package, ArrowRight, Box, Edit2, Clock, Archive, CheckCircle, AlertCircle, X, User, History, AlertTriangle, Printer, Filter } from 'lucide-react';
import * as XLSX from 'xlsx';

interface FormDataState {
  docNo: string;
  vendorId: string;
  vendorName: string;
  refPO: string;
  truckTemp: string;
  note: string;
}

const getThaiDate = (dateObj = new Date()) => {
    return dateObj.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
};

const Inbound = () => {
  const [userRole, setUserRole] = useState<string>('VIEWER');
  const [bkkTime, setBkkTime] = useState<string>('');

  const [activeTab, setActiveTab] = useState<string>('po');
  const [listTab, setListTab] = useState<string>('PENDING'); 
  const [dateFilter, setDateFilter] = useState<string>('ALL');
  
  const [pendingPOs, setPendingPOs] = useState<any[]>([]);
  const [filteredPOs, setFilteredPOs] = useState<any[]>([]);
  const [poSearchTerm, setPoSearchTerm] = useState<string>('');
  
  const [selectedPO, setSelectedPO] = useState<any>(null);
  const [deliveryTiming, setDeliveryTiming] = useState<string>('');

  const [vendors, setVendors] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [productSearchTerm, setProductSearchTerm] = useState<string>('');

  const [cart, setCart] = useState<any[]>([]);
  
  const [cartSearchTerm, setCartSearchTerm] = useState<string>('');

  const [formData, setFormData] = useState<FormDataState>({
    docNo: '', vendorId: '', vendorName: '', refPO: '', truckTemp: '', note: ''
  });
  const [loading, setLoading] = useState<boolean>(false);

  const [vendorSearchInput, setVendorSearchInput] = useState<string>('');
  const [showVendorDropdown, setShowVendorDropdown] = useState<boolean>(false);
  const vendorDropdownRef = useRef<HTMLDivElement | null>(null);

  const todayStr = getThaiDate();
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportStart, setExportStart] = useState<string>(todayStr);
  const [exportEnd, setExportEnd] = useState<string>(todayStr);

  useEffect(() => {
    const fetchRole = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            const { data } = await supabase.from('user_roles').select('role').eq('user_id', session.user.id).single();
            setUserRole(data?.role || 'VIEWER');
        }
    };
    fetchRole();

    setFormData((prev: FormDataState) => ({ ...prev, docNo: `RCV-${Date.now()}` }));
    fetchMasterData();

    const updateTime = () => {
        const now = new Date();
        setBkkTime(now.toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour12: false }));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);

    const handleClickOutside = (event: MouseEvent) => {
        if (vendorDropdownRef.current && !vendorDropdownRef.current.contains(event.target as Node)) {
            setShowVendorDropdown(false);
        }
    };
    document.addEventListener("mousedown", handleClickOutside);
    
    return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        clearInterval(timer);
    };
  }, []);

  const isViewer = userRole === 'VIEWER';

  useEffect(() => {
    if (vendors.length > 0) fetchPendingPOs();
  }, [vendors, listTab]);

  useEffect(() => {
    let result = pendingPOs || [];
    const today = getThaiDate();

    if (listTab === 'PENDING') {
        if (dateFilter === 'LATE') result = result.filter((po: any) => (po.delivery_date || today) < today);
        else if (dateFilter === 'TODAY') result = result.filter((po: any) => (po.delivery_date || today) === today);
        else if (dateFilter === 'FUTURE') result = result.filter((po: any) => (po.delivery_date || today) > today);
    }

    if (poSearchTerm) {
        const lower = poSearchTerm.toLowerCase();
        result = result.filter((po: any) => {
            const matchHeader = 
                (po.po_number || '').toLowerCase().includes(lower) || 
                (po.vendor_full_name || '').toLowerCase().includes(lower) ||
                (po.vendor_id || '').toLowerCase().includes(lower);

            const matchLines = (po.po_lines || []).some((line: any) => {
                const matchId = (line.product_id || '').toLowerCase().includes(lower);
                const prodInfo = products.find(p => p.product_id === line.product_id);
                const matchName = (prodInfo?.product_name || '').toLowerCase().includes(lower);
                return matchId || matchName;
            });

            return matchHeader || matchLines;
        });
    }
    setFilteredPOs(result);
  }, [poSearchTerm, pendingPOs, dateFilter, listTab, products]);

  const fetchPendingPOs = async () => {
    try {
        const { data: snap, error } = await supabase
            .from('purchase_orders')
            .select(`*, po_lines (*)`)
            .in('status', listTab === 'PENDING' ? ['PENDING'] : ['PARTIAL']);
            
        if (error) throw error;
        
        let data = (snap || []).map((raw: any) => {
            const vendorObj = vendors.find(v => v.vendor_id === raw.vendor_id);
            return {
                ...raw, 
                vendor_full_name: vendorObj ? vendorObj.vendor_name : (raw.vendor_id || 'Unknown'),
            };
        });

        if (listTab === 'PENDING') data.sort((a: any, b: any) => new Date(a.delivery_date || 0).getTime() - new Date(b.delivery_date || 0).getTime());
        else data.sort((a: any, b: any) => new Date(b.delivery_date || 0).getTime() - new Date(a.delivery_date || 0).getTime());

        setPendingPOs(data);
    } catch (error: any) { console.error("Error fetching POs:", error); } 
  };

  const fetchMasterData = async () => {
    try {
        const { data: vData } = await supabase.from('master_vendors').select('*');
        setVendors(vData || []);
        
        const { data: pData } = await supabase.from('master_products').select('*');
        setProducts(pData || []);
    } catch (error: any) { console.error("Error fetching master data:", error); } 
  };

  // 🚀🚀🚀 ระบบนำเข้า PO ความเร็วสูง (High-Performance Bulk Import) 🚀🚀🚀
  const handleImportPO = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e: any) => {
        if (!e.target?.result) return;
        setLoading(true);
        await new Promise(resolve => setTimeout(resolve, 10));

        try {
            const data = new Uint8Array(e.target.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
            if (rows.length === 0) throw new Error("ไฟล์ว่างเปล่า (File Empty!)");

            const groupedPOs: Record<string, any> = {};
            
            rows.forEach((row: any) => {
                const poNo = row['Purchase order'];
                if (!poNo) return;
                
                let dDate = row['Delivery date'];
                if (typeof dDate === 'number') dDate = getThaiDate(new Date(Math.round((dDate - 25569) * 86400 * 1000)));
                else if (!dDate) dDate = getThaiDate();

                const cleanPoNo = String(poNo).trim();

                if (!groupedPOs[cleanPoNo]) {
                    groupedPOs[cleanPoNo] = { 
                        po_number: cleanPoNo, 
                        vendor_id: String(row['Vendor account'] || '').trim(), 
                        delivery_date: dDate, 
                        warehouse_code: row['Warehouse'] || 'Main', 
                        status: 'PENDING',
                        lines: []
                    };
                }
                
                groupedPOs[cleanPoNo].lines.push({ 
                    po_number: cleanPoNo,
                    product_id: String(row['Item number'] || '').trim(), 
                    ordered_qty: parseFloat(row['Quantity']) || 0, 
                    received_qty: 0 
                });
            });

            const incomingPoNumbers = Object.keys(groupedPOs);

            // 1. เช็คเลข PO ทั้งหมดว่ามีอันไหนอยู่ในระบบแล้วบ้าง
            const { data: existingPOs, error: checkErr } = await supabase
                .from('purchase_orders')
                .select('po_number')
                .in('po_number', incomingPoNumbers);

            if (checkErr) throw checkErr;

            const existingPoSet = new Set(existingPOs?.map(p => p.po_number) || []);
            const duplicatedPOs = [];
            const newPOs = [];

            // 2. แยกของเก่า (ข้าม) และของใหม่ (เตรียมเข้า)
            for (const poNo of incomingPoNumbers) {
                if (existingPoSet.has(poNo)) {
                    duplicatedPOs.push(poNo); 
                } else {
                    newPOs.push(poNo); 
                }
            }

            if (duplicatedPOs.length > 0) {
                const displayDupes = duplicatedPOs.length > 5 ? duplicatedPOs.slice(0, 5).join('\n- ') + `\n...และอื่นๆ รวม ${duplicatedPOs.length} รายการ` : '- ' + duplicatedPOs.join('\n- ');
                alert(`⚠️ ปฏิเสธการนำเข้า PO ซ้ำ!\n\nระบบพบว่าเลข PO ต่อไปนี้ถูกนำเข้าและบันทึกในระบบไปแล้ว:\n${displayDupes}\n\nระบบจะทำการข้ามรายการเหล่านี้ (หากต้องการรับของเซ็ตนี้ใหม่ กรุณาเปลี่ยนชื่อเลข PO ในไฟล์ Excel)\n\nระบบจะนำเข้าเฉพาะ PO เลขใหม่ให้เท่านั้นครับ`);
            }

            // ⚡⚡⚡ กระบวนการ Bulk Insert (เร็วกว่าเดิม 10-100 เท่า) ⚡⚡⚡
            const poDataToInsert: any[] = [];
            const poLinesToInsert: any[] = [];

            for (const poNo of newPOs) {
                const poData = groupedPOs[poNo];
                const poLinesData = poData.lines;
                delete poData.lines;

                poDataToInsert.push(poData);
                poLinesToInsert.push(...poLinesData); // เอา array ย่อยมายัดรวมกัน
            }

            if (poDataToInsert.length > 0) {
                // ยิง 1 ที บันทึกหัว PO ทั้งหมดรวดเดียว
                const { error: poInsertErr } = await supabase.from('purchase_orders').insert(poDataToInsert);
                if (poInsertErr) throw poInsertErr;

                // ยิงอีก 1 ที บันทึกรายการสินค้าทั้งหมดรวดเดียว
                if (poLinesToInsert.length > 0) {
                    const { error: linesInsertErr } = await supabase.from('po_lines').insert(poLinesToInsert);
                    if (linesInsertErr) throw linesInsertErr;
                }
            }
            
            if (newPOs.length > 0) {
                alert(`✅ นำเข้า PO ใหม่เสร็จสมบูรณ์จำนวน: ${newPOs.length} เอกสาร (ประมวลผลความเร็วสูง)`);
                fetchPendingPOs(); 
            }
            
        } catch (error: any) { alert("Import Error: " + error.message); }
        setLoading(false);
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  const handleExportPending = async () => {
    if (!exportStart || !exportEnd) return alert("กรุณาเลือกวันที่ให้ครบถ้วน");
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 10));

    try {
        const { data: pos, error } = await supabase
            .from('purchase_orders')
            .select('*, po_lines(*)')
            .in('status', ['PENDING', 'PARTIAL'])
            .gte('delivery_date', exportStart)
            .lte('delivery_date', exportEnd)
            .order('delivery_date', { ascending: true });

        if (error) throw error;

        const exportData: any[] = [];
        const today = getThaiDate();

        for (const po of pos || []) {
            const vendor = vendors.find(v => v.vendor_id === po.vendor_id);
            const vendorName = vendor ? vendor.vendor_name : po.vendor_id;
            let timing = po.delivery_date < today ? 'LATE (ล่าช้า)' : (po.delivery_date === today ? 'TODAY (วันนี้)' : 'FUTURE (ล่วงหน้า)');

            for (const line of po.po_lines || []) {
                const pendingQty = (line.ordered_qty || 0) - (line.received_qty || 0);
                if (pendingQty > 0) {
                    const product = products.find(p => p.product_id === line.product_id);
                    exportData.push({
                        "PO Number": po.po_number,
                        "Delivery Date": po.delivery_date,
                        "Timing Status": timing,
                        "PO Status": po.status,
                        "Vendor Code": po.vendor_id,
                        "Vendor Name": vendorName,
                        "Product Code": line.product_id,
                        "Product Name": product ? product.product_name : 'Unknown',
                        "Category": product ? product.category : '',
                        "Ordered Qty": line.ordered_qty,
                        "Received Qty": line.received_qty,
                        "Pending Qty": pendingQty,
                        "Base Unit": product ? product.base_uom : 'Unit'
                    });
                }
            }
        }

        if (exportData.length === 0) {
            alert("ไม่พบรายการสินค้าค้างส่งในช่วงวันที่เลือก");
            setLoading(false);
            return;
        }

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Pending_Deliveries");
        XLSX.writeFile(wb, `Pending_Report_${exportStart}_to_${exportEnd}.xlsx`);
        setShowExportModal(false);
    } catch (error: any) {
        alert("Export Error: " + error.message);
    }
    setLoading(false);
  };

  const selectPO = (po: any) => {
    setSelectedPO(po);
    setVendorSearchInput('');
    setShowVendorDropdown(false);
    setCartSearchTerm(''); 

    const today = getThaiDate();
    const planDate = po.delivery_date || today;
    let timing = today < planDate ? "EARLY" : (today > planDate ? "LATE" : "ON-TIME");
    
    setDeliveryTiming(timing);
    setFormData({
        docNo: `RCV-${Date.now()}`,
        vendorId: po.vendor_id || '',
        vendorName: po.vendor_full_name || '',
        refPO: po.po_number || '', 
        truckTemp: '',
        note: ''
    });
    setVendorSearchInput(po.vendor_full_name || po.vendor_id || '');

    const safeItems = po.po_lines || [];
    const pendingItems = safeItems.filter((item: any) => ((item.ordered_qty || 0) - (item.received_qty || 0)) > 0);

    const mappedItems = pendingItems.map((item: any) => {
        const productInfo = products.find(p => p.product_id === item.product_id);
        const remainingQty = (item.ordered_qty || 0) - (item.received_qty || 0);
        return createCartItem(item.product_id, productInfo?.product_name, remainingQty, productInfo);
    });

    setCart(mappedItems); 
  };

  const handleForceClose = async () => {
    if (!selectedPO) return;
    if (!window.confirm(`คุณแน่ใจหรือไม่ที่จะ "ปิดเอกสาร" PO: ${selectedPO.po_number}?\n\n(ระบบจะเปลี่ยนสถานะเป็น COMPLETED ทันที โดยจะไม่รอรับสินค้าที่เหลืออีกต่อไป)`)) return;
    
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 10));

    try {
        await supabase.from('purchase_orders').update({ status: 'COMPLETED' }).eq('po_number', selectedPO.po_number);
        alert("✅ ปิดรายการ PO (Force Close) สำเร็จ!");
        setSelectedPO(null); setCart([]); fetchPendingPOs();
    } catch (error: any) { alert("Error: " + error.message); }
    setLoading(false);
  };

  const handleVendorSelect = (vendor: any) => {
      setFormData((prev: FormDataState) => ({ ...prev, vendorId: vendor.vendor_id, vendorName: vendor.vendor_name }));
      setVendorSearchInput(vendor.vendor_name);
      setShowVendorDropdown(false);
  };

  const filteredVendorList = (vendors || []).filter((v: any) => 
      (v.vendor_name || '').toLowerCase().includes(vendorSearchInput.toLowerCase()) ||
      (v.vendor_id || '').toLowerCase().includes(vendorSearchInput.toLowerCase())
  );

  const createCartItem = (id: string, name: string, qtyOrder: number, productInfo: any = null) => {
      const baseUnit = productInfo?.base_uom || 'Piece';
      const purchaseUnit = productInfo?.purchase_uom || baseUnit;
      const convRate = parseFloat(productInfo?.conversion_rate) || 1;
      const smartLocation = productInfo?.default_location || 'MAIN_WH';
      const shelfPosition = productInfo?.shelf_position || '-';
      const today = getThaiDate();

      return {
        productId: id, 
        productName: name || `Item ${id}`,
        category: productInfo?.category || '',
        qtyOrdered: qtyOrder, 
        qtyReceived: qtyOrder, 
        recvUnit: purchaseUnit, 
        conversionRate: convRate, 
        baseUnit: baseUnit, 
        mfgDate: today, 
        expDate: '', 
        productTemp: '',
        location: smartLocation, 
        shelf_position: shelfPosition, 
        isAutoLocation: !!productInfo?.default_location,
        lotStatus: 'AVAILABLE'
      };
  };

  const addToCart = (product: any) => {
    if (isViewer) return;
    const existing = cart.find((i: any) => i.productId === product.product_id);
    if (existing) return alert("มีสินค้านี้ในตะกร้าอยู่แล้ว!");
    const newItem = createCartItem(product.product_id, product.product_name, 0, product);
    newItem.qtyReceived = 1; 
    setCart([...cart, newItem]);
  };

  const updateItem = (productId: string, field: string, value: any) => {
    if (isViewer) return;
    setCart(prevCart => prevCart.map(item => {
        if (item.productId === productId) {
            const updatedItem = { ...item, [field]: value };
            if (field === 'location') updatedItem.isAutoLocation = false;
            return updatedItem;
        }
        return item;
    }));
  };

  const filteredProducts = (products || []).filter((p: any) => 
    (p.product_name || '').toLowerCase().includes(productSearchTerm.toLowerCase()) ||
    (p.product_id || '').toLowerCase().includes(productSearchTerm.toLowerCase())
  ).slice(0, 20); 

  const filteredCart = useMemo(() => {
      if (!cartSearchTerm) return cart;
      const lowerSearch = cartSearchTerm.toLowerCase();
      return cart.filter(item => 
          item.productId.toLowerCase().includes(lowerSearch) || 
          item.productName.toLowerCase().includes(lowerSearch)
      );
  }, [cart, cartSearchTerm]);

  const handleSubmit = async () => {
    if (isViewer) return alert("ไม่มีสิทธิ์ทำรายการ (View Only)");
    if (cart.length === 0) return alert("No items.");
    if (!formData.vendorId && activeTab === 'manual') return alert("Select Vendor.");
    
    const hasOverReceive = cart.some(item => parseFloat(item.qtyReceived) > parseFloat(item.qtyOrdered) && parseFloat(item.qtyOrdered) > 0);
    if (hasOverReceive) {
        if (!window.confirm("⚠️ แจ้งเตือน: มีรายการที่รับเข้า 'เกิน' กว่าจำนวนสั่งซื้อ (Over-receive) คุณต้องการยืนยันการรับเข้านี้หรือไม่?")) return;
    } else {
        if (!window.confirm("ยืนยันการรับเข้าสินค้า (Confirm Inbound)?")) return;
    }

    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 10));

    try {
        const { data: receiptData, error: receiptError } = await supabase
            .from('inbound_receipts')
            .insert([{
                po_number: activeTab === 'po' ? formData.refPO : null,
                delivery_timing: deliveryTiming || 'ON-TIME',
                truck_temperature: formData.truckTemp ? parseFloat(formData.truckTemp) : null,
                document_reference: formData.docNo
            }])
            .select('receipt_id')
            .single();
            
        if (receiptError) throw receiptError;
        const newReceiptId = receiptData.receipt_id;

        const inboundLinesToInsert = [];
        const logsToInsert = [];
        const productIds = cart.map(item => item.productId);

        const { data: existingLots } = await supabase.from('inventory_lots').select('*').in('product_id', productIds);

        const lotsMap = new Map();
        existingLots?.forEach(lot => {
            const key = `${lot.product_id}_${lot.storage_location}_${lot.mfg_date}_${lot.exp_date}_${lot.status}`;
            lotsMap.set(key, lot);
        });

        const lotsToUpsertMap = new Map();
        const currentBalances: Record<string, number> = {};
        productIds.forEach(id => currentBalances[id] = 0);
        
        existingLots?.forEach(lot => {
            currentBalances[lot.product_id] += Number(lot.quantity) || 0;
        });

        const itemsToProcess = cart.filter(item => parseFloat(item.qtyReceived) > 0 || parseFloat(item.qtyOrdered) === 0);

        for (const item of itemsToProcess) {
            const rcvQty = parseFloat(item.qtyReceived) || 0;
            const convRate = parseFloat(item.conversionRate) || 1;
            const baseQty = rcvQty * convRate; 
            
            const safeMfgDate = item.mfgDate || getThaiDate();
            const nextYear = new Date(); nextYear.setFullYear(nextYear.getFullYear() + 1);
            const safeExpDate = item.expDate || getThaiDate(nextYear);

            inboundLinesToInsert.push({
                receipt_id: newReceiptId,
                product_id: item.productId,
                received_qty: rcvQty,
                product_temperature: item.productTemp ? parseFloat(item.productTemp) : null,
                storage_location: item.location,
                mfg_date: safeMfgDate,
                exp_date: safeExpDate,
                receive_unit: item.recvUnit,
                conversion_rate: convRate,
                base_qty: baseQty
            });

            const lotKey = `${item.productId}_${item.location}_${safeMfgDate}_${safeExpDate}_${item.lotStatus}`;
            const existingLot = lotsMap.get(lotKey);

            if (existingLot) {
                existingLot.quantity = Number(existingLot.quantity) + baseQty;
                existingLot.last_updated = new Date().toISOString();
                lotsToUpsertMap.set(lotKey, existingLot);
            } else {
                if (lotsToUpsertMap.has(lotKey)) {
                    const draftLot = lotsToUpsertMap.get(lotKey);
                    draftLot.quantity += baseQty;
                } else {
                    const newLot = {
                        product_id: item.productId,
                        storage_location: item.location,
                        quantity: baseQty,
                        mfg_date: safeMfgDate,
                        exp_date: safeExpDate,
                        status: item.lotStatus
                    };
                    lotsToUpsertMap.set(lotKey, newLot);
                    lotsMap.set(lotKey, newLot); 
                }
            }

            currentBalances[item.productId] += baseQty;
            const baseOrderedQty = item.qtyOrdered ? (parseFloat(item.qtyOrdered) * convRate) : 0;
            let thaiTimingStatus = deliveryTiming === 'LATE' ? 'ล่าช้า' : (deliveryTiming === 'EARLY' ? 'มาก่อนกำหนด' : 'ตรงเวลา');

            logsToInsert.push({
                transaction_type: 'INBOUND',
                product_id: item.productId,
                quantity_change: baseQty,
                balance_after: currentBalances[item.productId],
                remarks: `รับเข้าตามเอกสาร ${formData.docNo} ${activeTab === 'po' ? `(อ้างอิง PO: ${formData.refPO})` : '(Manual)'}`,
                metadata: {
                    po_number: activeTab === 'po' ? formData.refPO : null, 
                    doc_no: formData.docNo, 
                    scheduled_date: activeTab === 'po' && selectedPO ? selectedPO.delivery_date : null,
                    time_status: thaiTimingStatus,
                    vehicle_temp: formData.truckTemp ? parseFloat(formData.truckTemp) : null,
                    product_temp: item.productTemp ? parseFloat(item.productTemp) : null,
                    ordered_qty: baseOrderedQty 
                }
            });
        }

        const promises = [];
        if (inboundLinesToInsert.length > 0) promises.push(supabase.from('inbound_lines').insert(inboundLinesToInsert));
        const lotsToUpsert = Array.from(lotsToUpsertMap.values());
        if (lotsToUpsert.length > 0) promises.push(supabase.from('inventory_lots').upsert(lotsToUpsert));
        if (logsToInsert.length > 0) promises.push(supabase.from('transactions_log').insert(logsToInsert));

        const itemsWithNewLoc = cart.filter(item => !item.isAutoLocation && !isViewer);
        if (itemsWithNewLoc.length > 0) {
            const uniqueLocs: Record<string, string> = {};
            itemsWithNewLoc.forEach(i => uniqueLocs[i.productId] = i.location);
            Object.entries(uniqueLocs).forEach(([pid, loc]) => {
                promises.push(supabase.from('master_products').update({ default_location: loc }).eq('product_id', pid));
            });
        }

        await Promise.all(promises);

        if (activeTab === 'po' && selectedPO) {
            let isAllComplete = true;
            const poPromises = [];

            for (const item of cart) {
                const poLine = selectedPO.po_lines.find((l: any) => l.product_id === item.productId);
                if (poLine) {
                    const newReceived = parseFloat(poLine.received_qty) + (parseFloat(item.qtyReceived) || 0);
                    if (newReceived < parseFloat(poLine.ordered_qty)) isAllComplete = false;
                    poPromises.push(supabase.from('po_lines').update({ received_qty: newReceived }).eq('po_line_id', poLine.po_line_id));
                }
            }

            const untouchedLines = selectedPO.po_lines.filter((l: any) => !cart.find((c: any) => c.productId === l.product_id));
            untouchedLines.forEach((l: any) => {
                if (parseFloat(l.received_qty) < parseFloat(l.ordered_qty)) isAllComplete = false;
            });

            const newStatus = isAllComplete ? 'COMPLETED' : 'PARTIAL';
            poPromises.push(supabase.from('purchase_orders').update({ status: newStatus }).eq('po_number', selectedPO.po_number));
            await Promise.all(poPromises);
        }

        if (window.confirm("🎉 รับเข้าสำเร็จอย่างรวดเร็ว!\n\nต้องการไปที่หน้า [Print Labels] เพื่อพิมพ์บาร์โค้ดสำหรับสินค้าล็อตนี้เลยหรือไม่?")) {
            const printJobs = itemsToProcess.map((item: any) => ({
                product_id: item.productId,
                product_name: item.productName,
                copies: item.qtyReceived ? Math.ceil(parseFloat(item.qtyReceived)) : 1, 
                lotNo: '', 
                expDate: item.expDate || '',
                location: `${item.location} ${item.shelf_position !== '-' ? `(Shelf: ${item.shelf_position})` : ''}` 
            }));
            sessionStorage.setItem('wms_auto_print_queue', JSON.stringify(printJobs));
            window.location.href = '/print-labels';
        }

        setCart([]); setSelectedPO(null); setCartSearchTerm('');
        setFormData((prev: FormDataState) => ({...prev, docNo: `RCV-${Date.now()}`, truckTemp: '', vendorId: '', vendorName: '', refPO: ''}));
        setVendorSearchInput('');
        fetchPendingPOs(); 

    } catch (error: any) { alert("Error: " + error.message); }
    setLoading(false);
  };

  return (
    <div className="flex h-full bg-slate-50 flex-col rounded-2xl overflow-hidden relative">
      <div className="bg-white border-b border-slate-200 px-4 md:px-6 py-3 flex flex-col md:flex-row md:items-center justify-between shadow-sm z-10 gap-3">
        <div className="flex items-center gap-2 justify-between w-full md:w-auto">
            <h1 className="text-xl md:text-2xl font-bold text-slate-800 flex items-center gap-2">
                <Truck className="text-blue-600"/> Inbound
            </h1>
            <div className="md:hidden flex items-center gap-1.5 bg-slate-900 text-white px-3 py-1.5 rounded-lg shadow-inner">
                <Clock size={12} className="text-emerald-400 animate-pulse"/>
                <span className="text-xs font-mono font-bold tracking-widest">{bkkTime}</span>
                <span className="text-[9px] text-slate-400 font-bold ml-0.5">BKK</span>
            </div>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            <div className="bg-slate-100 p-1 rounded-lg flex w-full sm:w-auto justify-center">
                <button onClick={() => {setActiveTab('po'); setCart([]); setCartSearchTerm('');}} className={`flex-1 sm:flex-none px-4 py-2 rounded-md font-bold text-sm transition-all ${activeTab === 'po' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>From PO</button>
                <button onClick={() => {setActiveTab('manual'); setCart([]); setCartSearchTerm('');}} className={`flex-1 sm:flex-none px-4 py-2 rounded-md font-bold text-sm transition-all ${activeTab === 'manual' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Manual</button>
            </div>
            
            <div className="hidden md:flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-xl shadow-lg border border-slate-700">
                <Clock size={16} className="text-emerald-400 animate-pulse"/>
                <span className="text-sm font-mono font-bold tracking-widest">{bkkTime}</span>
                <span className="text-[10px] text-slate-400 font-bold ml-1">BKK</span>
            </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        
        {/* --- LEFT PANEL --- */}
        <div className="w-full lg:w-96 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0 h-[45vh] lg:h-full">
            {activeTab === 'po' ? (
                <>
                    <div className="p-3 bg-blue-50 border-b border-blue-100 flex flex-col gap-2">
                        {!isViewer ? (
                          <>
                            <label className="flex items-center justify-center gap-2 w-full bg-white border border-dashed border-blue-400 text-blue-600 p-2 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors shadow-sm">
                                <FileUp size={16}/> <span className="font-bold text-xs md:text-sm">Import PO (Excel)</span>
                                <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleImportPO}/>
                            </label>
                            <button onClick={() => setShowExportModal(true)} className="flex items-center justify-center gap-2 w-full bg-orange-50 border border-orange-300 text-orange-600 p-2 rounded-lg hover:bg-orange-100 transition-colors shadow-sm font-bold text-xs md:text-sm">
                                <FileDown size={16}/> Export ค้างส่ง (Pending)
                            </button>
                          </>
                        ) : (
                          <div className="text-xs text-center text-slate-400 font-bold p-2 bg-slate-100 rounded-lg">🔒 ไม่มีสิทธิ์จัดการข้อมูล PO</div>
                        )}
                    </div>
                    
                    <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 shrink-0">
                        <button onClick={() => {setListTab('PENDING'); setDateFilter('TODAY');}} className={`py-2.5 text-xs font-bold flex items-center justify-center gap-2 transition-all ${listTab === 'PENDING' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><Calendar size={12}/> Wait to Receive</button>
                        <button onClick={() => setListTab('PARTIAL')} className={`py-2.5 text-xs font-bold flex items-center justify-center gap-2 transition-all ${listTab === 'PARTIAL' ? 'bg-white text-orange-600 border-b-2 border-orange-600' : 'text-slate-500 hover:text-slate-700'}`}><Clock size={12}/> Partial Pending</button>
                    </div>
                    
                    {listTab === 'PENDING' && (
                        <div className="flex bg-slate-100 p-1 gap-1 border-b border-slate-200 shrink-0">
                            <button onClick={() => setDateFilter('LATE')} className={`flex-1 text-[10px] py-1.5 rounded font-bold flex items-center justify-center gap-1 ${dateFilter === 'LATE' ? 'bg-red-100 text-red-600 border border-red-200' : 'text-slate-500 hover:bg-white'}`}><AlertCircle size={10}/> Late</button>
                            <button onClick={() => setDateFilter('TODAY')} className={`flex-1 text-[10px] py-1.5 rounded font-bold flex items-center justify-center gap-1 ${dateFilter === 'TODAY' ? 'bg-green-100 text-green-600 border border-green-200' : 'text-slate-500 hover:bg-white'}`}><CheckCircle size={10}/> Today</button>
                            <button onClick={() => setDateFilter('FUTURE')} className={`flex-1 text-[10px] py-1.5 rounded font-bold flex items-center justify-center gap-1 ${dateFilter === 'FUTURE' ? 'bg-blue-100 text-blue-600 border border-blue-200' : 'text-slate-500 hover:bg-white'}`}><Calendar size={10}/> Future</button>
                            <button onClick={() => setDateFilter('ALL')} className={`flex-1 text-[10px] py-1.5 rounded font-bold ${dateFilter === 'ALL' ? 'bg-white text-slate-800 border border-slate-300' : 'text-slate-500 hover:bg-white'}`}>All</button>
                        </div>
                    )}

                    <div className="p-2 border-b border-slate-100 bg-white shrink-0">
                        <div className="relative">
                            <Search className="absolute left-3 top-2 text-slate-400" size={16}/>
                            <input 
                                type="text" 
                                placeholder="ค้นหา: PO, Vendor, รหัส, ชื่อสินค้า..." 
                                className="w-full pl-9 p-2 border rounded-lg text-xs bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500" 
                                value={poSearchTerm} 
                                onChange={(e: any) => setPoSearchTerm(e.target.value)} 
                            />
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-100 min-h-0">
                        {filteredPOs.length === 0 && <div className="text-center text-slate-400 mt-10 p-4 text-xs">No {listTab} POs found.</div>}
                        {filteredPOs.map((po: any) => (
                            <div key={po.po_number} onClick={() => selectPO(po)} className={`p-3 rounded-xl cursor-pointer border shadow-sm transition-all group ${selectedPO?.po_number === po.po_number ? 'bg-white border-blue-500 ring-2 ring-blue-100 shadow-md' : 'bg-white border-slate-200 hover:border-blue-400'}`}>
                                <div className="flex justify-between items-start mb-1.5">
                                    <div className="flex items-center gap-2">
                                        <div className={`text-[10px] px-1.5 py-0.5 rounded font-bold text-white shadow-sm flex items-center gap-1 ${po.delivery_date < getThaiDate() ? 'bg-red-500' : (po.delivery_date === getThaiDate() ? 'bg-green-600' : 'bg-blue-400')}`}><Calendar size={10}/> {po.delivery_date}</div>
                                        {po.status === 'PARTIAL' && <span className="text-[9px] bg-orange-100 text-orange-700 px-1.5 rounded border border-orange-200 font-bold">Pending</span>}
                                    </div>
                                    <span className="font-mono font-bold text-slate-700 text-xs bg-slate-100 px-1.5 py-0.5 rounded">{po.po_number}</span>
                                </div>
                                <div className="mb-2 flex flex-col gap-1">
                                    <div className="font-bold text-slate-800 text-xs leading-tight line-clamp-1">{po.vendor_full_name}</div>
                                    <div className="text-[9px] text-slate-500 flex items-center gap-1 bg-slate-50 w-max px-1.5 py-0.5 rounded border border-slate-200">
                                        <History size={10} className="text-blue-400"/> นำเข้าเมื่อ: {po.created_at ? new Date(po.created_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) + ' น.' : 'N/A'}
                                    </div>
                                </div>
                                <div className="flex justify-between items-center text-[10px] text-slate-500 border-t pt-1.5 mt-1.5">
                                    <div className="flex items-center gap-1"><Package size={10}/> <span>{(po.po_lines || []).reduce((acc: number, i: any) => acc + ((i.ordered_qty||0) - (i.received_qty||0)), 0).toLocaleString(undefined, {maximumFractionDigits: 2})} Left</span></div>
                                    <span className={`flex items-center gap-1 font-medium ${selectedPO?.po_number === po.po_number ? 'text-blue-600' : 'text-slate-400'}`}>Select <ArrowRight size={10}/></span>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <div className="p-3 h-full flex flex-col bg-slate-50">
                    <div className="mb-3 relative" ref={vendorDropdownRef}>
                        <label className="text-xs font-bold text-slate-700 block mb-1">ค้นหาผู้จัดจำหน่าย (Vendor)</label>
                        <div className="relative">
                            <User className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                            <input 
                                type="text" placeholder="พิมพ์ชื่อ Vendor..." disabled={isViewer}
                                className="w-full pl-9 p-2 text-sm border rounded-xl shadow-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100 bg-white"
                                value={vendorSearchInput}
                                onChange={(e: any) => {
                                    setVendorSearchInput(e.target.value);
                                    setShowVendorDropdown(true);
                                }}
                                onFocus={() => {if(!isViewer) setShowVendorDropdown(true)}}
                            />
                            {vendorSearchInput && !isViewer && <button onClick={() => {setVendorSearchInput(''); setFormData((prev: FormDataState) => ({...prev, vendorId:'', vendorName:''}));}} className="absolute right-3 top-2.5 text-slate-400 hover:text-red-500"><X size={16}/></button>}
                        </div>
                        {showVendorDropdown && !isViewer && (
                            <div className="absolute z-50 w-full bg-white border border-slate-200 rounded shadow-xl mt-1 max-h-48 overflow-y-auto">
                                {filteredVendorList.length > 0 ? filteredVendorList.map((v: any) => (
                                    <div key={v.vendor_id} onMouseDown={(e: any) => { e.preventDefault(); handleVendorSelect(v); }} className="p-2 hover:bg-blue-50 cursor-pointer border-b last:border-0">
                                        <div className="font-bold text-xs text-slate-700">{v.vendor_name}</div>
                                        <div className="text-[10px] text-slate-400">{v.vendor_id}</div>
                                    </div>
                                )) : <div className="p-3 text-slate-400 text-center text-xs">ไม่พบข้อมูล Vendor</div>}
                            </div>
                        )}
                    </div>
                    
                    <div className="mb-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-2 text-blue-400" size={16}/>
                            <input type="text" placeholder="ค้นหา: รหัส หรือ ชื่อสินค้า..." disabled={isViewer} className="w-full pl-9 p-2 text-sm border-2 border-blue-100 rounded-xl focus:ring-0 focus:border-blue-400 outline-none disabled:bg-slate-100 bg-white shadow-inner" value={productSearchTerm} onChange={(e: any) => setProductSearchTerm(e.target.value)}/>
                        </div>
                    </div>
                    <div className="flex-1 overflow-auto border border-slate-200 rounded-xl bg-white shadow-sm min-h-0">
                        {filteredProducts.map((p: any) => (
                            <div key={p.product_id} onMouseDown={(e: any) => { e.preventDefault(); addToCart(p); }} className={`p-3 border-b flex justify-between items-center group ${isViewer ? 'opacity-50' : 'hover:bg-blue-50 cursor-pointer transition-colors'}`}>
                                <div>
                                    <div className="font-bold text-sm text-slate-800">{p.product_id}</div>
                                    <div className="text-xs text-slate-500 line-clamp-1 mt-0.5">{p.product_name}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {p.category && <span className="text-[9px] font-bold uppercase bg-purple-50 text-purple-600 px-2 py-0.5 rounded border border-purple-100 shrink-0">{p.category}</span>}
                                    {!isViewer && <Plus size={18} className="text-slate-300 group-hover:text-blue-600 transition-colors"/>}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        {/* --- RIGHT PANEL --- */}
        <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden min-h-[50vh]">
            <div className="bg-white p-3 md:p-4 border-b border-slate-200 shadow-sm flex flex-col md:flex-row md:justify-between md:items-start shrink-0 gap-3">
                 <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 w-full">
                    <div className="col-span-1 lg:border-r border-slate-100">
                        <label className="text-[9px] md:text-[10px] uppercase font-bold text-slate-400">Doc No.</label>
                        <div className="font-mono font-bold text-slate-800 text-sm md:text-lg">{formData.docNo}</div>
                    </div>
                    
                    <div className="col-span-1 lg:border-r border-slate-100">
                        <label className="text-[9px] md:text-[10px] uppercase font-bold text-slate-400">PO Number</label>
                        <input 
                            type="text" 
                            className="w-full font-bold text-xs md:text-sm border-none focus:ring-0 p-0 text-slate-800 placeholder-slate-300 bg-transparent outline-none disabled:bg-transparent"
                            placeholder="พิมพ์เลข PO..." disabled={isViewer}
                            value={formData.refPO} 
                            readOnly={activeTab === 'po'}
                            onChange={(e: any) => setFormData((prev: FormDataState) => ({...prev, refPO: e.target.value}))}
                        />
                    </div>

                    <div className="col-span-2 lg:col-span-1 lg:border-r border-slate-100">
                        <label className="text-[9px] md:text-[10px] uppercase font-bold text-slate-400">Vendor</label>
                        <div className="font-bold text-xs md:text-sm truncate text-blue-600 mt-0.5">{formData.vendorName || '-'}</div>
                    </div>

                    <div className="col-span-1 lg:border-r border-slate-100">
                        <label className="text-[9px] md:text-[10px] uppercase font-bold text-slate-400">Timing</label>
                        <div className={`font-bold text-xs md:text-sm ${deliveryTiming === 'LATE' ? 'text-red-500' : 'text-green-600'}`}>{deliveryTiming || '-'}</div>
                    </div>
                    
                    <div className="col-span-1">
                        <label className="text-[9px] md:text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1"><Thermometer size={10}/> Temp (°C)</label>
                        <input type="number" step="0.1" disabled={isViewer} className="w-full border border-slate-300 rounded px-2 py-0.5 md:py-1 text-xs md:text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100" value={formData.truckTemp} onChange={(e: any) => setFormData((prev: FormDataState) => ({...prev, truckTemp: e.target.value}))}/>
                    </div>
                 </div>
                 
                 {activeTab === 'po' && selectedPO && !isViewer && (
                     <button 
                        onClick={handleForceClose} 
                        className="bg-rose-50 text-rose-600 border border-rose-200 px-3 md:px-4 py-1.5 md:py-2 rounded-lg text-xs md:text-sm font-bold flex items-center justify-center gap-1 hover:bg-rose-100 hover:text-rose-700 shadow-sm whitespace-nowrap mt-2 md:mt-0 w-full md:w-auto" 
                     >
                        <Archive size={14}/> ปิด PO (Force Close)
                     </button>
                 )}
            </div>

            {/* แถบค้นหาภายในตะกร้า (Cart Search) */}
            {cart.length > 0 && (
                <div className="px-2 md:px-4 pt-3 pb-1 shrink-0 bg-slate-50">
                    <div className="relative">
                        <Filter className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                        <input 
                            type="text" 
                            placeholder={`ค้นหาสินค้าใน PO นี้ (${cart.length} รายการ)...`}
                            className="w-full pl-9 p-2 border border-slate-300 rounded-lg text-sm bg-white shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                            value={cartSearchTerm}
                            onChange={(e) => setCartSearchTerm(e.target.value)}
                        />
                        {cartSearchTerm && (
                            <button onClick={() => setCartSearchTerm('')} className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-700"><X size={16}/></button>
                        )}
                    </div>
                </div>
            )}

            <div className="flex-1 p-2 md:p-4 min-h-0 relative">
                <div className="absolute inset-2 md:inset-4 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                    <div className="overflow-x-auto custom-scrollbar flex-1">
                        <table className="w-full text-left text-xs md:text-sm min-w-[900px]">
                            <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] md:text-xs border-b sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="p-2 md:p-3 w-48">Product Info</th>
                                    <th className="p-2 md:p-3 w-16 text-center">Rem.</th>
                                    <th className="p-2 md:p-3 w-24 text-center bg-yellow-50 text-yellow-800 border-x border-yellow-100">Receive Qty</th>
                                    <th className="p-2 md:p-3 w-40 bg-blue-50 text-blue-800 border-x border-blue-100">Conversion</th>
                                    <th className="p-2 md:p-3 w-16 text-center">Temp</th>
                                    <th className="p-2 md:p-3 w-24">QC Status</th>
                                    <th className="p-2 md:p-3 w-32">MFG / EXP <span className="text-[9px] font-normal tracking-widest block text-slate-400">(DD/MM/YYYY)</span></th>
                                    <th className="p-2 md:p-3 w-28">Location & Shelf</th>
                                    {!isViewer ? <th className="p-2 md:p-3 w-10"></th> : null}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredCart.length === 0 ? (
                                    <tr>
                                        <td colSpan={9} className="p-12 text-center text-slate-400 h-48">
                                            <Package size={40} className="opacity-20 mb-3 mx-auto"/>
                                            <p className="text-sm font-medium">{cartSearchTerm ? 'ไม่พบสินค้าที่ค้นหาในตะกร้า' : (activeTab === 'po' ? 'Select a PO from the left list.' : 'Select Vendor & Add items.')}</p>
                                        </td>
                                    </tr>
                                ) : filteredCart.map((item: any) => {
                                    const isReceiving = parseFloat(item.qtyReceived) > 0;

                                    return (
                                    <tr key={item.productId} className={`align-top transition-colors ${isReceiving ? 'bg-emerald-50/30 hover:bg-emerald-50/60' : 'hover:bg-slate-50'}`}>
                                        <td className="p-2 md:p-3">
                                            <div className="font-bold text-slate-700 text-xs">{item.productId}</div>
                                            <div className="text-[10px] md:text-xs text-slate-500 truncate w-40 mt-0.5" title={item.productName}>{item.productName}</div>
                                        </td>
                                        <td className="p-2 md:p-3 text-center pt-3 text-slate-400 font-mono text-xs">{item.qtyOrdered.toLocaleString(undefined, {maximumFractionDigits: 2})}</td>
                                        <td className={`p-2 md:p-3 text-center border-x ${isReceiving ? 'bg-emerald-100/50 border-emerald-200' : 'bg-yellow-50 border-yellow-100'}`}>
                                            <input type="number" step="0.01" disabled={isViewer} className={`w-full p-1.5 md:p-2 border rounded-lg text-center font-bold focus:ring-2 outline-none disabled:bg-slate-100 shadow-inner ${isReceiving ? 'border-emerald-400 text-emerald-800 focus:ring-emerald-500 bg-white' : 'border-yellow-300 text-slate-800 focus:ring-yellow-500 bg-white'}`} value={item.qtyReceived} onChange={(e: any) => updateItem(item.productId, 'qtyReceived', e.target.value)}/>
                                        </td>
                                        <td className="p-2 md:p-3 bg-blue-50/30 border-x border-blue-100">
                                            <div className="flex items-center gap-1 mb-1.5"><input type="text" disabled={isViewer} placeholder="Unit" className="w-12 md:w-16 p-1 border rounded text-[10px] md:text-xs bg-white text-center shadow-sm outline-none disabled:bg-slate-100" value={item.recvUnit} onChange={(e: any) => updateItem(item.productId, 'recvUnit', e.target.value)} /><span className="text-[10px] text-slate-400">x</span><input type="number" disabled={isViewer} placeholder="Rate" className="w-12 md:w-14 p-1 border rounded text-[10px] md:text-xs text-center bg-white shadow-sm outline-none disabled:bg-slate-100" value={item.conversionRate} onChange={(e: any) => updateItem(item.productId, 'conversionRate', e.target.value)} /></div>
                                            <div className="flex items-center gap-1 bg-blue-100 px-1.5 md:px-2 py-1 rounded border border-blue-200 shadow-sm"><Box size={12} className="text-blue-500"/><div className="text-xs md:text-sm font-black text-blue-700">{((parseFloat(item.qtyReceived)||0) * (parseFloat(item.conversionRate)||1)).toLocaleString(undefined, {maximumFractionDigits: 2})}</div><div className="text-[9px] md:text-[10px] font-bold text-blue-600 uppercase">{item.baseUnit}</div></div>
                                        </td>
                                        <td className="p-2 md:p-3"><input type="number" step="0.1" disabled={isViewer} placeholder="°C" className="w-full p-1.5 md:p-2 border rounded text-center text-xs focus:ring-1 focus:ring-blue-300 outline-none disabled:bg-slate-100 bg-white" value={item.productTemp} onChange={(e: any) => updateItem(item.productId, 'productTemp', e.target.value)}/></td>
                                        
                                        <td className="p-2 md:p-3">
                                            <select 
                                                disabled={isViewer}
                                                className={`w-full p-1.5 md:p-2 border rounded text-[9px] md:text-[10px] font-bold outline-none cursor-pointer ${item.lotStatus === 'HOLD' ? 'bg-rose-50 text-rose-700 border-rose-200 ring-1 ring-rose-400' : 'bg-emerald-50 text-emerald-700 border-emerald-200'} disabled:cursor-not-allowed shadow-sm`}
                                                value={item.lotStatus}
                                                onChange={(e: any) => updateItem(item.productId, 'lotStatus', e.target.value)}
                                            >
                                                <option value="AVAILABLE">✅ สมบูรณ์ (AVAILABLE)</option>
                                                <option value="HOLD">⚠️ กักกัน (QC HOLD)</option>
                                            </select>
                                        </td>

                                        <td className="p-2 md:p-3 space-y-1.5">
                                            <input type="date" disabled={isViewer} className="w-full p-1 md:p-1.5 border border-slate-300 rounded text-[10px] md:text-xs text-slate-600 outline-none focus:border-blue-500 disabled:bg-slate-100 bg-white shadow-sm" value={item.mfgDate} onChange={(e: any) => updateItem(item.productId, 'mfgDate', e.target.value)} title="MFG (ผลิต)" />
                                            <input type="date" disabled={isViewer} className="w-full p-1 md:p-1.5 border border-slate-300 rounded text-[10px] md:text-xs text-red-500 outline-none focus:border-red-500 disabled:bg-slate-100 bg-red-50/30 shadow-sm" value={item.expDate} onChange={(e: any) => updateItem(item.productId, 'expDate', e.target.value)} title="EXP (หมดอายุ)"/>
                                        </td>
                                        <td className="p-2 md:p-3">
                                            <div className={`flex items-center gap-1 border rounded p-1 focus-within:ring-1 focus-within:ring-blue-300 relative mb-1.5 shadow-sm ${isViewer ? 'bg-slate-100' : 'bg-white'}`}>
                                                {item.isAutoLocation ? <History size={10} className="text-blue-500"/> : <MapPin size={10} className="text-slate-400"/>}
                                                <input type="text" disabled={isViewer} className="w-full text-[10px] md:text-xs outline-none bg-transparent font-bold text-slate-700" value={item.location} onChange={(e: any) => updateItem(item.productId, 'location', e.target.value)} title="Room Location" placeholder="Room..."/>
                                            </div>
                                            <div className="text-[9px] md:text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 truncate" title={`Shelf: ${item.shelf_position}`}>
                                                Shelf: <span className="text-amber-600">{item.shelf_position}</span>
                                            </div>
                                        </td>
                                        {!isViewer ? <td className="p-2 md:p-3 text-center pt-3"><button onClick={() => setCart(cart.filter(c => c.productId !== item.productId))} className="text-slate-300 hover:text-red-500 transition-colors p-1"><Trash2 size={16}/></button></td> : null}
                                    </tr>
                                )})}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div className="bg-white p-3 md:p-4 border-t border-slate-200 flex justify-between items-center z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] shrink-0">
                <div className="text-xs md:text-sm text-slate-500 flex gap-2 md:gap-4 flex-col sm:flex-row">
                    <span>แสดง: <span className="font-bold text-slate-800">{filteredCart.length}</span> / {cart.length} SKUs</span>
                    <span className="hidden sm:inline">|</span>
                    <span>Total Base Qty (รับจริง): <span className="font-bold text-emerald-600 text-sm md:text-base">{cart.reduce((a: number, b: any) => a + ((parseFloat(b.qtyReceived)||0)*(parseFloat(b.conversionRate)||1)), 0).toLocaleString(undefined, {maximumFractionDigits: 2})}</span></span>
                </div>
                
                {!isViewer && (
                  <button onClick={handleSubmit} disabled={loading || cart.length === 0} className={`px-4 md:px-8 py-2 md:py-3 rounded-lg text-white text-xs md:text-sm font-bold shadow-lg flex items-center gap-2 transition-all transform active:scale-95 ${loading ? 'bg-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-blue-200'}`}>
                      {loading ? 'Processing...' : <><CheckCircle size={18}/> Confirm Inbound</>}
                  </button>
                )}
            </div>
        </div>
      </div>

      {showExportModal && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                        <FileDown size={18} className="text-orange-500"/> 
                        Export รายงานสินค้าค้างส่ง
                    </h3>
                    <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-red-500 transition-colors"><X size={20}/></button>
                </div>
                <div className="p-6 flex flex-col gap-5">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Start Date (ตั้งแต่วันที่)</label>
                        <input type="date" className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-500 transition-colors" value={exportStart} onChange={e => setExportStart(e.target.value)} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">End Date (ถึงวันที่)</label>
                        <input type="date" className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-500 transition-colors" value={exportEnd} onChange={e => setExportEnd(e.target.value)} />
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button onClick={() => setShowExportModal(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                    <button onClick={handleExportPending} disabled={loading} className="px-6 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 shadow-md shadow-orange-200 transition-all flex items-center gap-2">
                        {loading ? 'Processing...' : 'Download Excel'}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default Inbound;