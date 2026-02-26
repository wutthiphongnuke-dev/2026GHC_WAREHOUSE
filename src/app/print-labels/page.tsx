"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import Barcode from 'react-barcode';
import { QRCodeSVG } from 'qrcode.react';
import { 
    Printer, Search, Package, Plus, Trash2, X, Settings2, 
    QrCode, AlignStartVertical, FileDown, Layers
} from 'lucide-react';

export default function PrintLabelsPage() {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  // --- Print Queue State ---
  const [printQueue, setPrintQueue] = useState<any[]>([]);
  
  // --- Settings State ---
  const [labelType, setLabelType] = useState<'BARCODE' | 'QR'>('BARCODE');
  const [labelSize, setLabelSize] = useState<'THERMAL' | 'A4'>('THERMAL');

  useEffect(() => {
      fetchProducts();
  }, []);

  const fetchProducts = async () => {
      setLoading(true);
      try {
          const { data, error } = await supabase.from('master_products').select('product_id, product_name, category, base_uom');
          if (error) throw error;
          setProducts(data || []);
      } catch (error: any) {
          console.error(error);
          alert("Error loading products: " + error.message);
      }
      setLoading(false);
  };

  const addToQueue = (product: any) => {
      const existing = printQueue.find(item => item.product_id === product.product_id);
      if (existing) {
          setPrintQueue(printQueue.map(item => item.product_id === product.product_id ? { ...item, copies: item.copies + 1 } : item));
      } else {
          setPrintQueue([...printQueue, { ...product, copies: 1, lotNo: '', expDate: '' }]);
      }
  };

  const updateQueueItem = (id: string, field: string, value: any) => {
      setPrintQueue(printQueue.map(item => item.product_id === id ? { ...item, [field]: value } : item));
  };

  const removeFromQueue = (id: string) => {
      setPrintQueue(printQueue.filter(item => item.product_id !== id));
  };

  const handlePrint = () => {
      if (printQueue.length === 0) return alert("ไม่มีรายการในคิวปริ้นท์");
      window.print();
  };

  const filteredProducts = products.filter(p => 
      (p.product_id || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
      (p.product_name || '').toLowerCase().includes(searchTerm.toLowerCase())
  ).slice(0, 20);

  // คำนวณจำนวนดวงสติกเกอร์ทั้งหมด
  const totalLabels = printQueue.reduce((acc, item) => acc + (Number(item.copies) || 0), 0);

  return (
    <div className="flex h-full bg-slate-50 flex-col overflow-hidden relative rounded-2xl font-sans">
      
      {/* 🟢 CSS สำหรับซ่อน UI และจัดหน้าตอนสั่ง Print */}
      <style>{`
        @media print {
            body * { visibility: hidden; }
            #printable-labels, #printable-labels * { visibility: visible; }
            #printable-labels {
                position: absolute;
                left: 0; top: 0;
                width: 100%;
                display: flex;
                flex-wrap: wrap;
                gap: ${labelSize === 'A4' ? '10px' : '0px'};
                padding: 0;
                margin: 0;
                background: white;
            }
            .print-label-box {
                page-break-inside: avoid;
                width: ${labelSize === 'THERMAL' ? '100%' : '30%'};
                height: ${labelSize === 'THERMAL' ? '100vh' : 'auto'};
                margin-bottom: ${labelSize === 'THERMAL' ? '0' : '15px'};
            }
        }
      `}</style>

      {/* --- HEADER (ซ่อนตอนปริ้นท์) --- */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between items-center z-10 print:hidden flex-shrink-0">
          <div>
              <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                  <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><Printer size={20}/></div> 
                  Label Generator
              </h1>
              <p className="text-slate-500 text-xs mt-1">ระบบสร้างและพิมพ์บาร์โค้ด / QR Code สำหรับติดสินค้า</p>
          </div>
          <div className="flex items-center gap-3 bg-slate-50 p-1.5 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 px-3 border-r border-slate-200">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Format</span>
                  <select className="bg-transparent text-sm font-bold text-indigo-600 outline-none cursor-pointer" value={labelType} onChange={e => setLabelType(e.target.value as any)}>
                      <option value="BARCODE">Barcode (1D)</option>
                      <option value="QR">QR Code (2D)</option>
                  </select>
              </div>
              <div className="flex items-center gap-2 px-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Printer</span>
                  <select className="bg-transparent text-sm font-bold text-indigo-600 outline-none cursor-pointer" value={labelSize} onChange={e => setLabelSize(e.target.value as any)}>
                      <option value="THERMAL">Thermal (สติกเกอร์ม้วน)</option>
                      <option value="A4">A4 (สติกเกอร์แผ่น)</option>
                  </select>
              </div>
          </div>
      </div>

      <div className="flex flex-1 overflow-hidden print:hidden">
          
          {/* --- LEFT PANEL: Product Search --- */}
          <div className="w-80 bg-white border-r border-slate-200 flex flex-col z-0">
              <div className="p-4 border-b border-slate-100 bg-slate-50">
                  <div className="relative">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                      <input 
                          type="text" placeholder="ค้นหาสินค้าเพื่อปริ้นท์..." 
                          className="w-full pl-9 p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none shadow-inner"
                          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                      />
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 bg-slate-50">
                  {loading && <div className="text-center p-4 text-slate-400 text-sm">Loading...</div>}
                  {filteredProducts.map(p => (
                      <div key={p.product_id} onClick={() => addToQueue(p)} className="p-3 bg-white border border-slate-200 rounded-xl hover:border-indigo-400 hover:shadow-md cursor-pointer transition-all group flex justify-between items-center">
                          <div>
                              <div className="font-bold text-slate-800 text-sm">{p.product_id}</div>
                              <div className="text-xs text-slate-500 truncate w-40">{p.product_name}</div>
                          </div>
                          <button className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                              <Plus size={16}/>
                          </button>
                      </div>
                  ))}
              </div>
          </div>

          {/* --- RIGHT PANEL: Print Queue --- */}
          <div className="flex-1 flex flex-col bg-slate-100">
              <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center shadow-sm">
                  <h2 className="font-bold text-slate-700 flex items-center gap-2"><Layers size={18} className="text-indigo-500"/> Print Queue ({printQueue.length} SKUs)</h2>
                  <button onClick={() => setPrintQueue([])} className="text-xs font-bold text-rose-500 hover:underline">Clear All</button>
              </div>

              <div className="flex-1 overflow-auto p-6">
                  {printQueue.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400">
                          <Printer size={64} className="opacity-20 mb-4"/>
                          <p className="text-lg font-bold">เลือกสินค้าจากเมนูด้านซ้าย</p>
                          <p className="text-sm">เพื่อสร้างบาร์โค้ดเตรียมปริ้นท์</p>
                      </div>
                  ) : (
                      <div className="space-y-4">
                          {printQueue.map((item) => (
                              <div key={item.product_id} className="bg-white p-4 rounded-2xl shadow-sm border border-slate-200 flex gap-6 items-center relative overflow-hidden">
                                  {/* Left: Preview */}
                                  <div className="w-48 h-32 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center justify-center p-2 shrink-0">
                                      {labelType === 'BARCODE' ? (
                                          <Barcode value={item.product_id} width={1.2} height={40} fontSize={12} displayValue={true} background="transparent" />
                                      ) : (
                                          <QRCodeSVG value={item.product_id} size={80} level="H" />
                                      )}
                                  </div>
                                  
                                  {/* Right: Controls */}
                                  <div className="flex-1 grid grid-cols-2 gap-4">
                                      <div className="col-span-2">
                                          <div className="font-bold text-lg text-slate-800">{item.product_name}</div>
                                          <div className="text-sm text-slate-500 font-mono">{item.product_id}</div>
                                      </div>
                                      <div>
                                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Lot / Batch No. (Optional)</label>
                                          <input type="text" className="w-full p-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500" placeholder="e.g. L-2401" value={item.lotNo} onChange={e => updateQueueItem(item.product_id, 'lotNo', e.target.value)} />
                                      </div>
                                      <div>
                                          <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">EXP Date (Optional)</label>
                                          <input type="date" className="w-full p-2 border border-slate-300 rounded-lg text-sm outline-none focus:border-indigo-500" value={item.expDate} onChange={e => updateQueueItem(item.product_id, 'expDate', e.target.value)} />
                                      </div>
                                      <div className="col-span-2 flex items-center gap-4 mt-2">
                                          <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-100 rounded-lg p-1">
                                              <span className="text-xs font-bold text-indigo-700 pl-2">จำนวนพิมพ์ (ดวง):</span>
                                              <input type="number" min="1" className="w-20 p-1.5 text-center font-black text-indigo-700 rounded bg-white border border-indigo-200 outline-none" value={item.copies} onChange={e => updateQueueItem(item.product_id, 'copies', parseInt(e.target.value) || 1)} />
                                          </div>
                                      </div>
                                  </div>

                                  <button onClick={() => removeFromQueue(item.product_id)} className="absolute top-4 right-4 text-slate-300 hover:text-rose-500 transition-colors"><X size={20}/></button>
                              </div>
                          ))}
                      </div>
                  )}
              </div>

              {/* Bottom Print Action */}
              <div className="bg-white p-5 border-t border-slate-200 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] flex justify-between items-center z-10">
                  <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-600">รวมที่ต้องพิมพ์ทั้งหมด</span>
                      <span className="text-2xl font-black text-indigo-600">{totalLabels} <span className="text-sm font-medium text-slate-500">ดวง</span></span>
                  </div>
                  <button onClick={handlePrint} disabled={printQueue.length === 0} className="px-10 py-3.5 bg-indigo-600 text-white rounded-xl font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 flex items-center gap-2 transition-all active:scale-95 disabled:bg-slate-300 disabled:shadow-none">
                      <Printer size={20}/> <span>Print Labels</span>
                  </button>
              </div>
          </div>
      </div>

      {/* ========================================== */}
      {/* 🖨️ PRINTABLE AREA (แสดงเฉพาะตอนสั่ง Print) */}
      {/* ========================================== */}
      <div id="printable-labels" className="hidden">
          {printQueue.map(item => {
              // สร้าง Label ซ้ำตามจำนวน copies
              return Array.from({ length: item.copies }).map((_, index) => (
                  <div key={`${item.product_id}-${index}`} className="print-label-box flex flex-col items-center justify-center p-4 border border-black border-dashed box-border">
                      <div className="font-bold text-sm text-center mb-1 leading-tight w-full truncate">{item.product_name}</div>
                      
                      <div className="my-2">
                          {labelType === 'BARCODE' ? (
                              <Barcode value={item.product_id} width={1.8} height={40} fontSize={14} displayValue={true} margin={0} />
                          ) : (
                              <div className="flex flex-col items-center">
                                  <QRCodeSVG value={item.product_id} size={80} level="H" />
                                  <span className="font-mono font-bold text-sm mt-1">{item.product_id}</span>
                              </div>
                          )}
                      </div>

                      {(item.lotNo || item.expDate) && (
                          <div className="text-[10px] font-bold text-center mt-1 border-t border-black border-dotted pt-1 w-full flex justify-between px-2">
                              {item.lotNo && <span>Lot: {item.lotNo}</span>}
                              {item.expDate && <span>EXP: {item.expDate}</span>}
                          </div>
                      )}
                  </div>
              ));
          })}
      </div>

    </div>
  );
}