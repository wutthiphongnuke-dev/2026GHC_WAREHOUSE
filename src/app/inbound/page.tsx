"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient'; 
import { Plus, Trash2, Search, FileUp, Truck, Calendar, Thermometer, MapPin, Package, ArrowRight, Box, Edit2, Clock, Archive, CheckCircle, AlertCircle, X, User, History } from 'lucide-react';
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

  // --- INIT ---
  useEffect(() => {
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

    setCart(pendingItems.map((item: any) => {
        const productInfo = products.find(p => p.product_id === item.product_id);
        const remainingQty = (item.ordered_qty || 0) - (item.received_qty || 0);
        return createCartItem(item.product_id, productInfo?.product_name, remainingQty, productInfo);
    }));
  };

  const handleForceClose = async () => {
    if (!selectedPO) return;
    if (!window.confirm(`Force Close PO: ${selectedPO.po_number}?`)) return;
    setLoading(true);
    try {
        await supabase.from('purchase_orders').update({ status: 'COMPLETED' }).eq('po_number', selectedPO.po_number);
        alert("✅ PO Closed!");
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
        isAutoLocation: !!productInfo?.default_location
      };
  };

  const addToCart = (product: any) => {
    const existing = cart.find((i: any) => i.productId === product.product_id);
    if (existing) return alert("Item already in list!");
    const newItem = createCartItem(product.product_id, product.product_name, 0, product);
    newItem.qtyReceived = 1; 
    setCart([...cart, newItem]);
  };

  const updateItem = (index: number, field: string, value: any) => {
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
  // SUBMIT INBOUND (อิงตาม New Schema + Metadata QC)
  // ==========================================
  const handleSubmit = async () => {
    if (cart.length === 0) return alert("No items.");
    if (!formData.vendorId && activeTab === 'manual') return alert("Select Vendor.");
    if (!window.confirm("Confirm Inbound?")) return;

    setLoading(true);
    try {
        // 1. สร้าง Inbound Receipt
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

        // 2. ลูปจัดการรายการ
        for (const item of cart) {
            const rcvQty = parseFloat(item.qtyReceived) || 0;
            const convRate = parseFloat(item.conversionRate) || 1;
            const baseQty = rcvQty * convRate; 
            
            const safeMfgDate = item.mfgDate || new Date().toISOString().split('T')[0];
            const safeExpDate = item.expDate || new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0];

            // 2.1 บันทึก Inbound Lines
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

            // 2.2 จัดการ Inventory Lots
            const { data: existingLots } = await supabase.from('inventory_lots').select('*')
                .eq('product_id', item.productId)
                .eq('storage_location', item.location)
                .eq('mfg_date', safeMfgDate)
                .eq('exp_date', safeExpDate);

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
                    exp_date: safeExpDate
                }]);
            }

            // 2.3 คำนวณ Balance และบันทึก Transaction Log + 🟢 ส่ง Metadata QC ไปด้วย
            const { data: allLots } = await supabase.from('inventory_lots').select('quantity').eq('product_id', item.productId);
            const balanceAfter = allLots?.reduce((sum, l) => sum + Number(l.quantity), 0) || 0;

            // แปลงยอดสั่งซื้อ (Ordered Qty) ให้เป็นหน่วยฐาน (Base) เพื่อให้ Export Excel คำนวณส่วนต่างได้ถูกต้อง
            const baseOrderedQty = item.qtyOrdered ? (parseFloat(item.qtyOrdered) * convRate) : 0;
            
            // แปลงสถานะเป็นภาษาไทยให้ Export สวยๆ
            let thaiTimingStatus = 'ตรงเวลา';
            if (deliveryTiming === 'LATE') thaiTimingStatus = 'ล่าช้า';
            if (deliveryTiming === 'EARLY') thaiTimingStatus = 'มาก่อนกำหนด';

            await supabase.from('transactions_log').insert([{
                transaction_type: 'INBOUND',
                product_id: item.productId,
                quantity_change: baseQty,
                balance_after: balanceAfter,
                remarks: `รับเข้า (Inbound) ตามเอกสาร ${formData.docNo}`,
                // 🟢 เพิ่มข้อมูล Metadata สำหรับหน้า Export ตรงนี้ครับ
                metadata: {
                    scheduled_date: activeTab === 'po' && selectedPO ? selectedPO.delivery_date : null,
                    time_status: thaiTimingStatus,
                    vehicle_temp: formData.truckTemp ? parseFloat(formData.truckTemp) : null,
                    product_temp: item.productTemp ? parseFloat(item.productTemp) : null,
                    ordered_qty: baseOrderedQty 
                }
            }]);

            // 2.4 Update Default Location (Auto-Learn)
            if (!item.isAutoLocation) {
                await supabase.from('master_products')
                    .update({ default_location: item.location })
                    .eq('product_id', item.productId);
            }
        }

        // 3. อัปเดต PO Status
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

        alert("🎉 Inbound Success! (ระบบรับเข้าและส่งข้อมูล QC ไปยังหน้ารายงานเรียบร้อย)");
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
                    <div className="p-4 bg-blue-50 border-b border-blue-100">
                        <label className="flex items-center justify-center gap-2 w-full bg-white border border-dashed border-blue-400 text-blue-600 p-3 rounded-lg cursor-pointer hover:bg-blue-50 transition-colors shadow-sm">
                            <FileUp size={20}/> <span className="font-bold">Import PO (Excel)</span>
                            <input type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleImportPO}/>
                        </label>
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
                                type="text" placeholder="Type Vendor Name..." 
                                className="w-full pl-10 p-2.5 border rounded shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                value={vendorSearchInput}
                                onChange={(e: any) => {
                                    setVendorSearchInput(e.target.value);
                                    setShowVendorDropdown(true);
                                }}
                                onFocus={() => setShowVendorDropdown(true)}
                            />
                            {vendorSearchInput && <button onClick={() => {setVendorSearchInput(''); setFormData((prev: FormDataState) => ({...prev, vendorId:'', vendorName:''}));}} className="absolute right-3 top-2.5 text-slate-400 hover:text-red-500"><X size={16}/></button>}
                        </div>
                        {showVendorDropdown && (
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
                    
                    <div className="mb-2"><input type="text" placeholder="Search Product..." className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500 outline-none" value={productSearchTerm} onChange={(e: any) => setProductSearchTerm(e.target.value)}/></div>
                    <div className="flex-1 overflow-auto border rounded bg-white">
                        {filteredProducts.map((p: any) => (
                            <div key={p.product_id} onMouseDown={(e: any) => { e.preventDefault(); addToCart(p); }} className="p-3 border-b hover:bg-blue-50 cursor-pointer flex justify-between items-center group">
                                <div>
                                    <div className="font-bold text-sm">{p.product_id}</div>
                                    <div className="text-xs text-slate-500">{p.product_name}</div>
                                </div>
                                {p.category && <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded border border-purple-100">{p.category}</span>}
                                <Plus size={16} className="text-slate-400 group-hover:text-blue-600"/>
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
                            className="w-full font-bold text-sm border-none focus:ring-0 p-0 text-slate-800 placeholder-slate-300 bg-transparent outline-none"
                            placeholder="Type PO Number..."
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
                    
                    <div className="col-span-1"><label className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1"><Thermometer size={12}/> Truck Temp (°C)</label><input type="number" className="w-full border border-slate-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={formData.truckTemp} onChange={(e: any) => setFormData((prev: FormDataState) => ({...prev, truckTemp: e.target.value}))}/></div>
                 </div>
                 
                 {activeTab === 'po' && selectedPO && listTab === 'PARTIAL' && (
                     <button onClick={handleForceClose} className="ml-4 bg-red-50 text-red-600 border border-red-200 px-3 py-2 rounded-lg text-xs font-bold flex flex-col items-center hover:bg-red-100 transition-colors" title="Close this PO manually"><Archive size={16}/><span>End PO</span></button>
                 )}
            </div>

            <div className="flex-1 overflow-auto p-4">
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-xs border-b">
                            <tr>
                                <th className="p-3 w-40">Product</th>
                                <th className="p-3 w-20 text-center">Remaining</th>
                                <th className="p-3 w-24 text-center bg-yellow-50 text-yellow-800 border-x border-yellow-100">Receive Qty</th>
                                <th className="p-3 w-56 bg-blue-50 text-blue-800 border-x border-blue-100">Conversion</th>
                                <th className="p-3 w-20">Item Temp</th>
                                <th className="p-3 w-32">MFG / EXP *</th>
                                <th className="p-3 w-28">Location</th>
                                <th className="p-3 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {cart.length === 0 ? (
                                <tr><td colSpan={8} className="p-12 text-center text-slate-400 flex flex-col items-center justify-center h-64"><Package size={48} className="opacity-20 mb-4"/><p className="text-lg font-medium">{activeTab === 'po' ? 'Select a PO from the left list.' : 'Select Vendor & Add items.'}</p></td></tr>
                            ) : cart.map((item: any, idx: number) => (
                                <tr key={idx} className="hover:bg-slate-50 align-top transition-colors">
                                    <td className="p-3">
                                        <div className="font-bold text-slate-700">{item.productId}</div>
                                        <div className="text-xs text-slate-500 truncate w-32" title={item.productName}>{item.productName}</div>
                                    </td>
                                    <td className="p-3 text-center pt-4 text-slate-400 font-mono">{item.qtyOrdered}</td>
                                    <td className="p-3 text-center bg-yellow-50 border-x border-yellow-100"><input type="number" className="w-full p-2 border border-yellow-300 rounded text-center font-bold text-slate-800 focus:ring-2 focus:ring-yellow-500 outline-none" value={item.qtyReceived} onChange={(e: any) => updateItem(idx, 'qtyReceived', e.target.value)}/></td>
                                    <td className="p-3 bg-blue-50/30 border-x border-blue-100">
                                        <div className="flex items-center gap-2 mb-2"><input type="text" placeholder="Unit" className="w-16 p-1 border rounded text-xs bg-white text-center shadow-sm" value={item.recvUnit} onChange={(e: any) => updateItem(idx, 'recvUnit', e.target.value)} /><span className="text-xs text-slate-400">x</span><input type="number" placeholder="Rate" className="w-14 p-1 border rounded text-xs text-center bg-white shadow-sm" value={item.conversionRate} onChange={(e: any) => updateItem(idx, 'conversionRate', e.target.value)} /></div>
                                        <div className="flex items-center gap-2 bg-blue-100 px-2 py-1.5 rounded border border-blue-200 shadow-sm group hover:ring-1 hover:ring-blue-400 cursor-text"><Box size={14} className="text-blue-500"/><div className="text-sm font-black text-blue-700">{(parseFloat(item.qtyReceived)||0) * (parseFloat(item.conversionRate)||1)}</div><div className="text-xs font-bold text-blue-600 uppercase">{item.baseUnit}</div></div>
                                    </td>
                                    <td className="p-3"><input type="number" placeholder="°C" className="w-full p-2 border rounded text-center focus:ring-1 focus:ring-blue-300 outline-none" value={item.productTemp} onChange={(e: any) => updateItem(idx, 'productTemp', e.target.value)}/></td>
                                    <td className="p-3 space-y-1">
                                        <label className="text-[9px] text-slate-400 uppercase">MFG</label>
                                        <input type="date" required className="w-full p-1 border border-slate-300 rounded text-xs text-slate-500 outline-none mb-1 focus:border-blue-500" value={item.mfgDate} onChange={(e: any) => updateItem(idx, 'mfgDate', e.target.value)} />
                                        <label className="text-[9px] text-slate-400 uppercase">EXP</label>
                                        <input type="date" className="w-full p-1 border border-slate-300 rounded text-xs text-red-400 outline-none focus:border-red-500" value={item.expDate} onChange={(e: any) => updateItem(idx, 'expDate', e.target.value)} />
                                    </td>
                                    <td className="p-3">
                                        <div className="flex items-center gap-1 border rounded p-1 bg-white focus-within:ring-1 focus-within:ring-blue-300 relative">
                                            {item.isAutoLocation ? <History size={12} className="text-blue-500"/> : <MapPin size={12} className="text-slate-400"/>}
                                            <input type="text" className="w-full text-xs outline-none" value={item.location} onChange={(e: any) => updateItem(idx, 'location', e.target.value)} />
                                        </div>
                                    </td>
                                    <td className="p-3 text-center pt-4"><button onClick={() => setCart(cart.filter((_,i)=>i!==idx))} className="text-slate-300 hover:text-red-500 transition-colors"><Trash2 size={16}/></button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-white p-4 border-t border-slate-200 flex justify-between items-center z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <div className="text-sm text-slate-500 flex gap-4"><span>SKUs: <span className="font-bold text-slate-800">{cart.length}</span></span><span>Total Base Qty: <span className="font-bold text-blue-600">{cart.reduce((a: number, b: any) => a + ((parseFloat(b.qtyReceived)||0)*(parseFloat(b.conversionRate)||1)), 0)}</span></span></div>
                <button onClick={handleSubmit} disabled={loading || cart.length === 0} className={`px-8 py-3 rounded-lg text-white font-bold shadow-lg flex items-center gap-2 transition-all transform active:scale-95 ${loading ? 'bg-slate-300' : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-blue-200'}`}>{loading ? 'Processing...' : <><CheckCircle size={20}/> Confirm Inbound</>}</button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Inbound;