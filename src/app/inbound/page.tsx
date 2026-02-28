"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient'; 
import { Plus, Trash2, Search, FileUp, FileDown, Truck, Calendar, Thermometer, MapPin, Package, ArrowRight, Box, Edit2, Clock, Archive, CheckCircle, AlertCircle, X, User, History, AlertTriangle, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';

interface FormDataState {
  docNo: string;
  vendorId: string;
  vendorName: string;
  refPO: string;
  truckTemp: string;
  note: string;
}

const Inbound = () => {
  // --- ROLE SECURITY STATE ---
  const [userRole, setUserRole] = useState<string>('VIEWER');
  
  // --- STATE ---
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
  
  const [formData, setFormData] = useState<FormDataState>({
    docNo: '', vendorId: '', vendorName: '', refPO: '', truckTemp: '', note: ''
  });
  const [loading, setLoading] = useState<boolean>(false);

  const [vendorSearchInput, setVendorSearchInput] = useState<string>('');
  const [showVendorDropdown, setShowVendorDropdown] = useState<boolean>(false);
  const vendorDropdownRef = useRef<HTMLDivElement | null>(null);

  // --- EXPORT STATE ---
  const todayStr = new Date().toISOString().split('T')[0];
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [exportStart, setExportStart] = useState<string>(todayStr);
  const [exportEnd, setExportEnd] = useState<string>(todayStr);

  // --- INIT ---
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

    const handleClickOutside = (event: MouseEvent) => {
        if (vendorDropdownRef.current && !vendorDropdownRef.current.contains(event.target as Node)) {
            setShowVendorDropdown(false);
        }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isViewer = userRole === 'VIEWER';

  useEffect(() => {
    if (vendors.length > 0) fetchPendingPOs();
  }, [vendors, listTab]);

  // --- FILTER LOGIC ---
  useEffect(() => {
    let result = pendingPOs || [];
    const today = new Date().toISOString().split('T')[0];

    if (listTab === 'PENDING') {
        if (dateFilter === 'LATE') result = result.filter((po: any) => (po.delivery_date || today) < today);
        else if (dateFilter === 'TODAY') result = result.filter((po: any) => (po.delivery_date || today) === today);
        else if (dateFilter === 'FUTURE') result = result.filter((po: any) => (po.delivery_date || today) > today);
    }

    if (poSearchTerm) {
        const lower = poSearchTerm.toLowerCase();
        result = result.filter((po: any) => 
            (po.po_number || '').toLowerCase().includes(lower) || 
            (po.vendor_full_name || '').toLowerCase().includes(lower) ||
            (po.vendor_id || '').toLowerCase().includes(lower)
        );
    }
    setFilteredPOs(result);
  }, [poSearchTerm, pendingPOs, dateFilter, listTab]);

  // --- FETCH DATA ---
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

  // --- ACTIONS ---
  const handleImportPO = (event: any) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e: any) => {
        if (!e.target?.result) return;
        setLoading(true);
        try {
            const data = new Uint8Array(e.target.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
            if (rows.length === 0) throw new Error("File Empty!");

            const groupedPOs: Record<string, any> = {};
            
            rows.forEach((row: any) => {
                const poNo = row['Purchase order'];
                if (!poNo) return;
                
                let dDate = row['Delivery date'];
                if (typeof dDate === 'number') dDate = new Date(Math.round((dDate - 25569) * 86400 * 1000)).toISOString().split('T')[0];
                else if (!dDate) dDate = new Date().toISOString().split('T')[0];

                if (!groupedPOs[poNo]) {
                    groupedPOs[poNo] = { 
                        po_number: String(poNo).trim(), 
                        vendor_id: String(row['Vendor account'] || '').trim(), 
                        delivery_date: dDate, 
                        warehouse_code: row['Warehouse'] || 'Main', 
                        status: 'PENDING',
                        lines: []
                    };
                }
                
                groupedPOs[poNo].lines.push({ 
                    po_number: String(poNo).trim(),
                    product_id: String(row['Item number'] || '').trim(), 
                    ordered_qty: parseFloat(row['Quantity']) || 0, 
                    received_qty: 0 
                });
            });

            let count = 0;
            for (const poNo of Object.keys(groupedPOs)) {
                const poData = groupedPOs[poNo];
                const poLinesData = poData.lines;
                delete poData.lines;

                await supabase.from('purchase_orders').upsert([poData], { onConflict: 'po_number' });
                await supabase.from('po_lines').upsert(poLinesData, { onConflict: 'po_number,product_id' });
                count++;
            }
            
            alert(`✅ Processed ${count} POs!`);
            fetchPendingPOs(); 
        } catch (error: any) { alert("Import Error: " + error.message); }
        setLoading(false);
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  const handleExportPending = async () => {
    if (!exportStart || !exportEnd) return alert("กรุณาเลือกวันที่ให้ครบถ้วน");
    setLoading(true);
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
        const today = new Date().toISOString().split('T')[0];

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

  const checkCrossDockAndSetCart = async (newCartItems: any[]) => {
      setCart(newCartItems); 
      try {
          const pIds = newCartItems.map(i => i.productId);
          if (pIds.length === 0) return;
          
          const { data: outLines } = await supabase.from('outbound_lines').select('rm_code').in('rm_code', pIds);
          const crossDockIds = outLines?.map((l: any) => l.rm_code) || [];
          
          if (crossDockIds.length > 0) {
              setCart(prev => prev.map(item => ({
                  ...item,
                  isCrossDock: crossDockIds.includes(item.productId)
              })));
          }
      } catch (e) { console.error(e); }
  };

  const selectPO = (po: any) => {
    setSelectedPO(po);
    setVendorSearchInput('');
    setShowVendorDropdown(false);

    const today = new Date().toISOString().split('T')[0];
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

    checkCrossDockAndSetCart(mappedItems);
  };

  const handleForceClose = async () => {
    if (!selectedPO) return;
    if (!window.confirm(`คุณแน่ใจหรือไม่ที่จะ "ปิดเอกสาร" PO: ${selectedPO.po_number}?\n\n(ระบบจะเปลี่ยนสถานะเป็น COMPLETED และจะไม่แสดงในหน้ารอรับสินค้าอีก)`)) return;
    
    setLoading(true);
    try {
        await supabase.from('purchase_orders').update({ status: 'COMPLETED' }).eq('po_number', selectedPO.po_number);
        alert("✅ ปิดรายการ PO สำเร็จ!");
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
      const today = new Date().toISOString().split('T')[0];

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
        isAutoLocation: !!productInfo?.default_location,
        lotStatus: 'AVAILABLE',
        isCrossDock: false
      };
  };

  const addToCart = (product: any) => {
    if (isViewer) return;
    const existing = cart.find((i: any) => i.productId === product.product_id);
    if (existing) return alert("Item already in list!");
    const newItem = createCartItem(product.product_id, product.product_name, 0, product);
    newItem.qtyReceived = 1; 
    checkCrossDockAndSetCart([...cart, newItem]);
  };

  const updateItem = (index: number, field: string, value: any) => {
    if (isViewer) return;
    const newCart = [...cart];
    (newCart[index] as any)[field] = value;
    if(field === 'location') newCart[index].isAutoLocation = false;
    setCart(newCart);
  };

  const filteredProducts = (products || []).filter((p: any) => 
    (p.product_name || '').toLowerCase().includes(productSearchTerm.toLowerCase()) ||
    (p.product_id || '').toLowerCase().includes(productSearchTerm.toLowerCase())
  ).slice(0, 10);

  // ==========================================
  // SUBMIT INBOUND
  // ==========================================
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

        for (const item of cart) {
            const rcvQty = parseFloat(item.qtyReceived) || 0;
            const convRate = parseFloat(item.conversionRate) || 1;
            const baseQty = rcvQty * convRate; 
            
            const safeMfgDate = item.mfgDate || new Date().toISOString().split('T')[0];
            const safeExpDate = item.expDate || new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];

            await supabase.from('inbound_lines').insert([{
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
            }]);

            const { data: existingLots } = await supabase.from('inventory_lots').select('*')
                .eq('product_id', item.productId)
                .eq('storage_location', item.location)
                .eq('mfg_date', safeMfgDate)
                .eq('exp_date', safeExpDate)
                .eq('status', item.lotStatus);

            if (existingLots && existingLots.length > 0) {
                const lot = existingLots[0];
                await supabase.from('inventory_lots').update({
                    quantity: Number(lot.quantity) + baseQty,
                    last_updated: new Date().toISOString()
                }).eq('lot_id', lot.lot_id);
            } else {
                await supabase.from('inventory_lots').insert([{
                    product_id: item.productId,
                    storage_location: item.location,
                    quantity: baseQty,
                    mfg_date: safeMfgDate,
                    exp_date: safeExpDate,
                    status: item.lotStatus
                }]);
            }

            const { data: allLots } = await supabase.from('inventory_lots').select('quantity').eq('product_id', item.productId);
            const balanceAfter = allLots?.reduce((sum, l) => sum + Number(l.quantity), 0) || 0;
            const baseOrderedQty = item.qtyOrdered ? (parseFloat(item.qtyOrdered) * convRate) : 0;
            
            let thaiTimingStatus = 'ตรงเวลา';
            if (deliveryTiming === 'LATE') thaiTimingStatus = 'ล่าช้า';
            if (deliveryTiming === 'EARLY') thaiTimingStatus = 'มาก่อนกำหนด';

            await supabase.from('transactions_log').insert([{
                transaction_type: 'INBOUND',
                product_id: item.productId,
                quantity_change: baseQty,
                balance_after: balanceAfter,
                remarks: `รับเข้า (Inbound) ตามเอกสาร ${formData.docNo} [QC: ${item.lotStatus}]`,
                metadata: {
                    scheduled_date: activeTab === 'po' && selectedPO ? selectedPO.delivery_date : null,
                    time_status: thaiTimingStatus,
                    vehicle_temp: formData.truckTemp ? parseFloat(formData.truckTemp) : null,
                    product_temp: item.productTemp ? parseFloat(item.productTemp) : null,
                    ordered_qty: baseOrderedQty 
                }
            }]);

            if (!item.isAutoLocation && !isViewer) {
                await supabase.from('master_products')
                    .update({ default_location: item.location })
                    .eq('product_id', item.productId);
            }
        }

        if (activeTab === 'po' && selectedPO) {
            let isAllComplete = true;

            for (const item of cart) {
                const poLine = selectedPO.po_lines.find((l: any) => l.product_id === item.productId);
                if (poLine) {
                    const newReceived = parseFloat(poLine.received_qty) + (parseFloat(item.qtyReceived) || 0);
                    if (newReceived < parseFloat(poLine.ordered_qty)) isAllComplete = false;

                    await supabase.from('po_lines')
                        .update({ received_qty: newReceived })
                        .eq('po_line_id', poLine.po_line_id);
                }
            }

            const untouchedLines = selectedPO.po_lines.filter((l: any) => !cart.find((c: any) => c.productId === l.product_id));
            untouchedLines.forEach((l: any) => {
                if (parseFloat(l.received_qty) < parseFloat(l.ordered_qty)) isAllComplete = false;
            });

            const newStatus = isAllComplete ? 'COMPLETED' : 'PARTIAL';
            await supabase.from('purchase_orders').update({ status: newStatus }).eq('po_number', selectedPO.po_number);
        }

        if (window.confirm("🎉 รับเข้าสำเร็จ!\n\nต้องการไปที่หน้า [Print Labels] เพื่อพิมพ์บาร์โค้ดสำหรับสินค้าล็อตนี้เลยหรือไม่?")) {
            window.location.href = '/print-labels';
        }

        setCart([]); setSelectedPO(null);
        setFormData((prev: FormDataState) => ({...prev, docNo: `RCV-${Date.now()}`, truckTemp: '', vendorId: '', vendorName: '', refPO: ''}));
        setVendorSearchInput('');
        fetchPendingPOs(); 

    } catch (error: any) { alert("Error: " + error.message); }
    setLoading(false);
  };

  return (
    <div className="flex h-full bg-slate-50 flex-col rounded-2xl overflow-hidden relative">
      <div className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm z-10">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2"><Truck className="text-blue-600"/> Inbound</h1>
        <div className="bg-slate-100 p-1 rounded-lg flex">
            <button onClick={() => {setActiveTab('po'); setCart([]);}} className={`px-4 py-2 rounded-md font-bold text-sm ${activeTab === 'po' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>From PO</button>
            <button onClick={() => {setActiveTab('manual'); setCart([]);}} className={`px-4 py-2 rounded-md font-bold text-sm ${activeTab === 'manual' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}>Manual</button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT PANEL */}
        <div className="w-96 bg-white border-r border-slate-200 flex flex-col">
            {activeTab === 'po' ? (
                <>
                    <div className="p-4 bg-blue-50 border-b border-blue-100 flex flex-col gap-2">
                        {!isViewer ? (
                          <>
                            <label className="flex items-center justify-center gap-2 w-full bg-white border border-dashed border-blue-400 text-blue-600 p-2.5 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors shadow-sm">
                                <FileUp size={18}/> <span className="font-bold text-sm">Import PO (Excel)</span>
                                <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleImportPO}/>
                            </label>
                            <button onClick={() => setShowExportModal(true)} className="flex items-center justify-center gap-2 w-full bg-orange-50 border border-orange-300 text-orange-600 p-2.5 rounded-lg hover:bg-orange-100 transition-colors shadow-sm font-bold text-sm">
                                <FileDown size={18}/> Export ค้างส่ง (Pending)
                            </button>
                          </>
                        ) : (
                          <div className="text-xs text-center text-slate-400 font-bold p-2 bg-slate-100 rounded-lg">🔒 ไม่มีสิทธิ์จัดการข้อมูล PO</div>
                        )}
                    </div>
                    
                    <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50">
                        <button onClick={() => {setListTab('PENDING'); setDateFilter('TODAY');}} className={`py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all ${listTab === 'PENDING' ? 'bg-white text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><Calendar size={14}/> Wait to Receive</button>
                        <button onClick={() => setListTab('PARTIAL')} className={`py-3 text-sm font-bold flex items-center justify-center gap-2 transition-all ${listTab === 'PARTIAL' ? 'bg-white text-orange-600 border-b-2 border-orange-600' : 'text-slate-500 hover:text-slate-700'}`}><Clock size={14}/> Partial Pending</button>
                    </div>
                    
                    {listTab === 'PENDING' && (
                        <div className="flex bg-slate-100 p-1 gap-1 border-b border-slate-200">
                            <button onClick={() => setDateFilter('LATE')} className={`flex-1 text-[10px] py-1.5 rounded font-bold flex items-center justify-center gap-1 ${dateFilter === 'LATE' ? 'bg-red-100 text-red-600 border border-red-200' : 'text-slate-500 hover:bg-white'}`}><AlertCircle size={10}/> Late</button>
                            <button onClick={() => setDateFilter('TODAY')} className={`flex-1 text-[10px] py-1.5 rounded font-bold flex items-center justify-center gap-1 ${dateFilter === 'TODAY' ? 'bg-green-100 text-green-600 border border-green-200' : 'text-slate-500 hover:bg-white'}`}><CheckCircle size={10}/> Today</button>
                            <button onClick={() => setDateFilter('FUTURE')} className={`flex-1 text-[10px] py-1.5 rounded font-bold flex items-center justify-center gap-1 ${dateFilter === 'FUTURE' ? 'bg-blue-100 text-blue-600 border border-blue-200' : 'text-slate-500 hover:bg-white'}`}><Calendar size={10}/> Future</button>
                            <button onClick={() => setDateFilter('ALL')} className={`flex-1 text-[10px] py-1.5 rounded font-bold ${dateFilter === 'ALL' ? 'bg-white text-slate-800 border border-slate-300' : 'text-slate-500 hover:bg-white'}`}>All</button>
                        </div>
                    )}

                    <div className="p-3 border-b border-slate-100 bg-white">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                            <input type="text" placeholder="Search PO Number..." className="w-full pl-10 p-2.5 border rounded-lg text-sm bg-slate-50 outline-none focus:ring-2 focus:ring-blue-500" value={poSearchTerm} onChange={(e: any) => setPoSearchTerm(e.target.value)} />
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-y-auto p-2 space-y-2 bg-slate-100">
                        {filteredPOs.length === 0 && <div className="text-center text-slate-400 mt-10 p-4">No {listTab} POs found.</div>}
                        {filteredPOs.map((po: any) => (
                            <div key={po.po_number} onClick={() => selectPO(po)} className={`p-4 rounded-xl cursor-pointer border shadow-sm transition-all group ${selectedPO?.po_number === po.po_number ? 'bg-white border-blue-500 ring-2 ring-blue-100 shadow-md' : 'bg-white border-slate-200 hover:border-blue-400'}`}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        <div className={`text-xs px-2 py-0.5 rounded font-bold text-white shadow-sm flex items-center gap-1 ${po.delivery_date < new Date().toISOString().split('T')[0] ? 'bg-red-500' : (po.delivery_date === new Date().toISOString().split('T')[0] ? 'bg-green-600' : 'bg-blue-400')}`}><Calendar size={10}/> {po.delivery_date}</div>
                                        {po.status === 'PARTIAL' && <span className="text-[10px] bg-orange-100 text-orange-700 px-1.5 rounded border border-orange-200 font-bold">Pending</span>}
                                    </div>
                                    <span className="font-mono font-bold text-slate-700 text-sm bg-slate-100 px-2 py-0.5 rounded">{po.po_number}</span>
                                </div>
                                <div className="mb-2">
                                    <div className="font-bold text-slate-800 text-sm leading-tight">{po.vendor_full_name}</div>
                                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{po.vendor_id}</div>
                                </div>
                                <div className="flex justify-between items-center text-xs text-slate-500 border-t pt-2 mt-2">
                                    <div className="flex items-center gap-1"><Package size={12}/> <span>{(po.po_lines || []).reduce((acc: number, i: any) => acc + ((i.ordered_qty||0) - (i.received_qty||0)), 0)} Left</span></div>
                                    <span className={`flex items-center gap-1 font-medium ${selectedPO?.po_number === po.po_number ? 'text-blue-600' : 'text-slate-400'}`}>Select <ArrowRight size={12}/></span>
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : (
                <div className="p-4 h-full flex flex-col">
                    <div className="mb-4 relative" ref={vendorDropdownRef}>
                        <label className="text-sm font-bold text-slate-700 block mb-1">Search Vendor</label>
                        <div className="relative">
                            <User className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                            <input 
                                type="text" placeholder="Type Vendor Name..." disabled={isViewer}
                                className="w-full pl-10 p-2.5 border rounded shadow-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100"
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
                            <div className="absolute z-50 w-full bg-white border border-slate-200 rounded shadow-xl mt-1 max-h-60 overflow-y-auto">
                                {filteredVendorList.length > 0 ? filteredVendorList.map((v: any) => (
                                    <div key={v.vendor_id} onMouseDown={(e: any) => { e.preventDefault(); handleVendorSelect(v); }} className="p-3 hover:bg-blue-50 cursor-pointer border-b last:border-0">
                                        <div className="font-bold text-sm text-slate-700">{v.vendor_name}</div>
                                        <div className="text-xs text-slate-400">{v.vendor_id}</div>
                                    </div>
                                )) : <div className="p-3 text-slate-400 text-center text-sm">No vendors found</div>}
                            </div>
                        )}
                    </div>
                    
                    <div className="mb-2"><input type="text" placeholder="Search Product..." disabled={isViewer} className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100" value={productSearchTerm} onChange={(e: any) => setProductSearchTerm(e.target.value)}/></div>
                    <div className="flex-1 overflow-auto border rounded bg-white">
                        {filteredProducts.map((p: any) => (
                            <div key={p.product_id} onMouseDown={(e: any) => { e.preventDefault(); addToCart(p); }} className={`p-3 border-b flex justify-between items-center group ${isViewer ? 'opacity-50' : 'hover:bg-blue-50 cursor-pointer'}`}>
                                <div>
                                    <div className="font-bold text-sm">{p.product_id}</div>
                                    <div className="text-xs text-slate-500">{p.product_name}</div>
                                </div>
                                {p.category && <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded border border-purple-100">{p.category}</span>}
                                {!isViewer && <Plus size={16} className="text-slate-400 group-hover:text-blue-600"/>}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>

        {/* --- RIGHT FORM --- */}
        <div className="flex-1 flex flex-col bg-slate-50 overflow-hidden">
            <div className="bg-white p-4 border-b border-slate-200 shadow-sm flex justify-between items-start">
                 <div className="grid grid-cols-5 gap-4 flex-1">
                    <div className="col-span-1 border-r border-slate-100"><label className="text-[10px] uppercase font-bold text-slate-400">Doc No.</label><div className="font-mono font-bold text-slate-800 text-lg">{formData.docNo}</div></div>
                    
                    <div className="col-span-1 border-r border-slate-100">
                        <label className="text-[10px] uppercase font-bold text-slate-400">PO Number</label>
                        <input 
                            type="text" 
                            className="w-full font-bold text-sm border-none focus:ring-0 p-0 text-slate-800 placeholder-slate-300 bg-transparent outline-none disabled:bg-transparent"
                            placeholder="Type PO Number..." disabled={isViewer}
                            value={formData.refPO} 
                            readOnly={activeTab === 'po'}
                            onChange={(e: any) => setFormData((prev: FormDataState) => ({...prev, refPO: e.target.value}))}
                        />
                    </div>

                    <div className="col-span-1 border-r border-slate-100 relative">
                        <label className="text-[10px] uppercase font-bold text-slate-400">Vendor</label>
                        <div className="font-bold text-sm truncate text-blue-600 mt-0.5">{formData.vendorName || '-'}</div>
                    </div>

                    <div className="col-span-1 border-r border-slate-100"><label className="text-[10px] uppercase font-bold text-slate-400">Timing</label><div className={`font-bold text-sm ${deliveryTiming === 'LATE' ? 'text-red-500' : 'text-green-600'}`}>{deliveryTiming || '-'}</div></div>
                    
                    <div className="col-span-1"><label className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1"><Thermometer size={12}/> Truck Temp (°C)</label><input type="number" disabled={isViewer} className="w-full border border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:bg-slate-100" value={formData.truckTemp} onChange={(e: any) => setFormData((prev: FormDataState) => ({...prev, truckTemp: e.target.value}))}/></div>
                 </div>
                 
                 {activeTab === 'po' && selectedPO && !isViewer && (
                     <button 
                        onClick={handleForceClose} 
                        className="ml-4 bg-rose-50 text-rose-600 border border-rose-200 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-rose-100 hover:text-rose-700 transition-colors shadow-sm whitespace-nowrap" 
                        title="ปิดเอกสาร PO นี้ทันที (ไม่ต้องรับของเพิ่มแล้ว)"
                     >
                        <Archive size={16}/> ปิด PO (Force Close)
                     </button>
                 )}
            </div>

            <div className="flex-1 overflow-auto p-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b">
                            <tr>
                                <th className="p-3 w-40">Product</th>
                                <th className="p-3 w-16 text-center">Rem.</th>
                                <th className="p-3 w-20 text-center bg-yellow-50 text-yellow-800 border-x border-yellow-100">Receive Qty</th>
                                <th className="p-3 w-48 bg-blue-50 text-blue-800 border-x border-blue-100">Conversion</th>
                                <th className="p-3 w-16 text-center">Temp</th>
                                <th className="p-3 w-28">QC Status</th>
                                <th className="p-3 w-28">MFG / EXP *</th>
                                <th className="p-3 w-24">Location</th>
                                {!isViewer ? <th className="p-3 w-10"></th> : null}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {cart.length === 0 ? (
                                <tr><td colSpan={9} className="p-12 text-center text-slate-400 flex flex-col items-center justify-center h-64"><Package size={48} className="opacity-20 mb-4"/><p className="text-lg font-medium">{activeTab === 'po' ? 'Select a PO from the left list.' : 'Select Vendor & Add items.'}</p></td></tr>
                            ) : cart.map((item: any, idx: number) => (
                                <tr key={idx} className="hover:bg-slate-50 align-top transition-colors">
                                    <td className="p-3">
                                        <div className="font-bold text-slate-700 flex items-center gap-2">
                                            {item.productId}
                                            {item.isCrossDock && <span className="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 font-black animate-pulse flex items-center gap-1"><AlertTriangle size={10}/> CROSS-DOCK</span>}
                                        </div>
                                        <div className="text-xs text-slate-500 truncate w-32" title={item.productName}>{item.productName}</div>
                                    </td>
                                    <td className="p-3 text-center pt-4 text-slate-400 font-mono">{item.qtyOrdered}</td>
                                    <td className="p-3 text-center bg-yellow-50 border-x border-yellow-100">
                                        <input type="number" disabled={isViewer} className="w-full p-2 border border-yellow-300 rounded text-center font-bold text-slate-800 focus:ring-2 focus:ring-yellow-500 outline-none disabled:bg-slate-100" value={item.qtyReceived} onChange={(e: any) => updateItem(idx, 'qtyReceived', e.target.value)}/>
                                    </td>
                                    <td className="p-3 bg-blue-50/30 border-x border-blue-100">
                                        <div className="flex items-center gap-2 mb-2"><input type="text" disabled={isViewer} placeholder="Unit" className="w-16 p-1 border rounded text-xs bg-white text-center shadow-sm disabled:bg-slate-100" value={item.recvUnit} onChange={(e: any) => updateItem(idx, 'recvUnit', e.target.value)} /><span className="text-xs text-slate-400">x</span><input type="number" disabled={isViewer} placeholder="Rate" className="w-14 p-1 border rounded text-xs text-center bg-white shadow-sm disabled:bg-slate-100" value={item.conversionRate} onChange={(e: any) => updateItem(idx, 'conversionRate', e.target.value)} /></div>
                                        <div className="flex items-center gap-2 bg-blue-100 px-2 py-1.5 rounded border border-blue-200 shadow-sm"><Box size={14} className="text-blue-500"/><div className="text-sm font-black text-blue-700">{(parseFloat(item.qtyReceived)||0) * (parseFloat(item.conversionRate)||1)}</div><div className="text-xs font-bold text-blue-600 uppercase">{item.baseUnit}</div></div>
                                    </td>
                                    <td className="p-3"><input type="number" disabled={isViewer} placeholder="°C" className="w-full p-2 border rounded text-center focus:ring-1 focus:ring-blue-300 outline-none disabled:bg-slate-100" value={item.productTemp} onChange={(e: any) => updateItem(idx, 'productTemp', e.target.value)}/></td>
                                    
                                    <td className="p-3">
                                        <select 
                                            disabled={isViewer}
                                            className={`w-full p-2 border rounded text-[10px] font-bold outline-none cursor-pointer ${item.lotStatus === 'HOLD' ? 'bg-rose-50 text-rose-700 border-rose-200 ring-1 ring-rose-400' : 'bg-emerald-50 text-emerald-700 border-emerald-200'} disabled:cursor-not-allowed`}
                                            value={item.lotStatus}
                                            onChange={(e: any) => updateItem(idx, 'lotStatus', e.target.value)}
                                        >
                                            <option value="AVAILABLE">✅ สมบูรณ์ (AVAILABLE)</option>
                                            <option value="HOLD">⚠️ กักกัน (QC HOLD)</option>
                                        </select>
                                    </td>

                                    <td className="p-3 space-y-1">
                                        <input type="date" disabled={isViewer} className="w-full p-1 border border-slate-300 rounded text-xs text-slate-500 outline-none mb-1 focus:border-blue-500 disabled:bg-slate-100" value={item.mfgDate} onChange={(e: any) => updateItem(idx, 'mfgDate', e.target.value)} title="MFG" />
                                        <input type="date" disabled={isViewer} className="w-full p-1 border border-slate-300 rounded text-xs text-red-400 outline-none focus:border-red-500 disabled:bg-slate-100" value={item.expDate} onChange={(e: any) => updateItem(idx, 'expDate', e.target.value)} title="EXP"/>
                                    </td>
                                    <td className="p-3">
                                        <div className={`flex items-center gap-1 border rounded p-1 focus-within:ring-1 focus-within:ring-blue-300 relative ${isViewer ? 'bg-slate-100' : 'bg-white'}`}>
                                            {item.isAutoLocation ? <History size={12} className="text-blue-500"/> : <MapPin size={12} className="text-slate-400"/>}
                                            <input type="text" disabled={isViewer} className="w-full text-xs outline-none bg-transparent" value={item.location} onChange={(e: any) => updateItem(idx, 'location', e.target.value)} />
                                        </div>
                                    </td>
                                    {!isViewer ? <td className="p-3 text-center pt-4"><button onClick={() => setCart(cart.filter((_,i)=>i!==idx))} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16}/></button></td> : null}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-white p-4 border-t border-slate-200 flex justify-between items-center z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <div className="text-sm text-slate-500 flex gap-4"><span>SKUs: <span className="font-bold text-slate-800">{cart.length}</span></span><span>Total Base Qty: <span className="font-bold text-blue-600">{cart.reduce((a: number, b: any) => a + ((parseFloat(b.qtyReceived)||0)*(parseFloat(b.conversionRate)||1)), 0)}</span></span></div>
                
                {!isViewer && (
                  <button onClick={handleSubmit} disabled={loading || cart.length === 0} className={`px-8 py-3 rounded-lg text-white font-bold shadow-lg flex items-center gap-2 transition-all transform active:scale-95 ${loading ? 'bg-slate-300' : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-blue-200'}`}>{loading ? 'Processing...' : <><CheckCircle size={20}/> Confirm Inbound</>}</button>
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
                    <button onClick={() => setShowExportModal(false)} className="text-slate-400 hover:text-red-500 transition-colors">
                        <X size={20}/>
                    </button>
                </div>
                <div className="p-6 flex flex-col gap-5">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Start Date (ตั้งแต่วันที่)</label>
                        <input 
                            type="date" 
                            className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-500 transition-colors" 
                            value={exportStart} 
                            onChange={e => setExportStart(e.target.value)} 
                        />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">End Date (ถึงวันที่)</label>
                        <input 
                            type="date" 
                            className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-500 transition-colors" 
                            value={exportEnd} 
                            onChange={e => setExportEnd(e.target.value)} 
                        />
                    </div>
                </div>
                <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                    <button onClick={() => setShowExportModal(false)} className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-200 rounded-lg transition-colors">Cancel</button>
                    <button 
                        onClick={handleExportPending} 
                        disabled={loading} 
                        className="px-6 py-2 bg-orange-500 text-white font-bold rounded-lg hover:bg-orange-600 shadow-md shadow-orange-200 transition-all flex items-center gap-2"
                    >
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