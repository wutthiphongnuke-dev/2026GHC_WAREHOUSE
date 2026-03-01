"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../supabaseClient';
import Barcode from 'react-barcode';
import { QRCodeSVG } from 'qrcode.react';
import { 
    Printer, Search, Package, Plus, Trash2, X, 
    Layers, MapPin, Calendar, CheckCircle, ArrowRight, Minus
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
  const [labelDesign, setLabelDesign] = useState<'STANDARD' | 'DETAILED'>('DETAILED'); // 🟢 เพิ่ม Layout Design

  useEffect(() => {
      fetchProducts();
      checkForAutoPrintJobs();
  }, []);

  // 🟢 ฟังก์ชันเช็คว่ามีคิวปริ้นท์ที่ส่งมาจากหน้า Inbound หรือไม่
  const checkForAutoPrintJobs = () => {
      const savedJobs = sessionStorage.getItem('wms_auto_print_queue');
      if (savedJobs) {
          try {
              const parsedJobs = JSON.parse(savedJobs);
              setPrintQueue(parsedJobs);
              // โหลดเสร็จ ล้างข้อมูลทิ้งทันที ป้องกันการรีเฟรชแล้วคิวเบิ้ล
              sessionStorage.removeItem('wms_auto_print_queue');
          } catch (e) {
              console.error("Failed to parse auto print jobs", e);
          }
      }
  };

  const fetchProducts = async () => {
      setLoading(true);
      try {
          const { data, error } = await supabase.from('master_products').select('product_id, product_name, category, base_uom, default_location');
          if (error) throw error;
          setProducts(data || []);
      } catch (error: any) {
          console.error(error);
      }
      setLoading(false);
  };

  const addToQueue = (product: any) => {
      const existing = printQueue.find(item => item.product_id === product.product_id);
      if (existing) {
          updateQueueItem(product.product_id, 'copies', existing.copies + 1);
      } else {
          setPrintQueue([{ 
              ...product, 
              copies: 1, 
              lotNo: '', 
              expDate: '',
              location: product.default_location || '' 
          }, ...printQueue]);
      }
  };

  const updateQueueItem = (id: string, field: string, value: any) => {
      setPrintQueue(printQueue.map(item => item.product_id === id ? { ...item, [field]: value } : item));
  };

  const adjustCopies = (id: string, amount: number) => {
      setPrintQueue(printQueue.map(item => {
          if (item.product_id === id) {
              const newCopies = Math.max(1, item.copies + amount);
              return { ...item, copies: newCopies };
          }
          return item;
      }));
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
  ).slice(0, 30);

  const totalLabels = printQueue.reduce((acc, item) => acc + (Number(item.copies) || 0), 0);

  return (
    <div className="flex h-full bg-slate-100 flex-col overflow-hidden relative rounded-2xl font-sans">
      
      {/* 🟢 CSS สำหรับการปริ้นท์ (Enterprise Standard) */}
      <style>{`
        @media print {
            body * { visibility: hidden; }
            #printable-labels, #printable-labels * { visibility: visible; }
            body, html { margin: 0; padding: 0; background: white; }
            #printable-labels {
                position: absolute;
                left: 0; top: 0;
                width: 100%;
                display: flex;
                flex-wrap: wrap;
                gap: ${labelSize === 'A4' ? '12px' : '0px'};
                padding: ${labelSize === 'A4' ? '10px' : '0px'};
                background: white;
            }
            .print-label-box {
                page-break-inside: avoid;
                width: ${labelSize === 'THERMAL' ? '100%' : '30%'};
                height: ${labelSize === 'THERMAL' ? '100vh' : 'auto'};
                max-height: ${labelSize === 'THERMAL' ? '100vh' : 'auto'};
                margin-bottom: ${labelSize === 'THERMAL' ? '0' : '15px'};
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                padding: 10px;
                box-sizing: border-box;
                border: ${labelSize === 'A4' ? '1px dashed #ccc' : 'none'};
            }
        }
      `}</style>

      {/* --- HEADER --- */}
      <div className="bg-white px-6 py-5 flex justify-between items-center z-10 print:hidden shadow-sm flex-shrink-0">
          <div>
              <h1 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-cyan-500 flex items-center gap-2">
                  <Printer size={24} className="text-indigo-600"/> Smart Label Generator
              </h1>
              <p className="text-slate-500 text-sm mt-1 font-medium">พิมพ์บาร์โค้ดและป้ายกำกับสินค้าสำหรับคลังสินค้า</p>
          </div>

          <div className="flex gap-4">
              {/* Settings Group */}
              <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200">
                  <div className="flex flex-col px-2 border-r border-slate-200">
                      <span className="text-[9px] font-bold text-slate-400 uppercase">Format</span>
                      <select className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer" value={labelType} onChange={e => setLabelType(e.target.value as any)}>
                          <option value="BARCODE">Barcode (1D)</option>
                          <option value="QR">QR Code (2D)</option>
                      </select>
                  </div>
                  <div className="flex flex-col px-2 border-r border-slate-200">
                      <span className="text-[9px] font-bold text-slate-400 uppercase">Template</span>
                      <select className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer" value={labelDesign} onChange={e => setLabelDesign(e.target.value as any)}>
                          <option value="STANDARD">Standard (ชื่อ+รหัส)</option>
                          <option value="DETAILED">Detailed (+โซน/หมดอายุ)</option>
                      </select>
                  </div>
                  <div className="flex flex-col px-2">
                      <span className="text-[9px] font-bold text-slate-400 uppercase">Printer</span>
                      <select className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer" value={labelSize} onChange={e => setLabelSize(e.target.value as any)}>
                          <option value="THERMAL">Thermal (ม้วน)</option>
                          <option value="A4">A4 (สติกเกอร์แผ่น)</option>
                      </select>
                  </div>
              </div>
          </div>
      </div>

      <div className="flex flex-1 overflow-hidden print:hidden p-4 gap-4">
          
          {/* --- LEFT PANEL: Product Search --- */}
          <div className="w-96 bg-white border border-slate-200 rounded-2xl flex flex-col z-0 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <h3 className="font-bold text-slate-700">Master Products</h3>
                  <span className="text-xs font-bold bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full">{products.length} Items</span>
              </div>
              <div className="p-3 border-b border-slate-100">
                  <div className="relative">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={18}/>
                      <input 
                          type="text" placeholder="ค้นหารหัส หรือ ชื่อสินค้า..." 
                          className="w-full pl-10 p-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                      />
                  </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                  {loading && <div className="text-center p-4 text-indigo-500 text-sm font-bold animate-pulse">กำลังโหลดฐานข้อมูล...</div>}
                  {filteredProducts.map(p => (
                      <div key={p.product_id} onClick={() => addToQueue(p)} className="p-3 bg-white border border-slate-100 rounded-xl hover:border-indigo-400 hover:shadow-md cursor-pointer transition-all group flex justify-between items-center">
                          <div className="flex items-center gap-3">
                              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-500 group-hover:bg-indigo-500 group-hover:text-white transition-colors">
                                  <Package size={20}/>
                              </div>
                              <div>
                                  <div className="font-black text-slate-800 text-sm">{p.product_id}</div>
                                  <div className="text-xs text-slate-500 truncate w-48">{p.product_name}</div>
                              </div>
                          </div>
                          <Plus size={18} className="text-slate-300 group-hover:text-indigo-600"/>
                      </div>
                  ))}
              </div>
          </div>

          {/* --- RIGHT PANEL: Print Queue --- */}
          <div className="flex-1 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
                  <h2 className="font-bold text-slate-800 flex items-center gap-2">
                      <Layers size={18} className="text-indigo-600"/> Print Queue 
                      <span className="text-sm font-medium text-slate-500">({printQueue.length} รายการ)</span>
                  </h2>
                  {printQueue.length > 0 && (
                      <button onClick={() => setPrintQueue([])} className="text-xs font-bold text-rose-500 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-colors">ล้างคิวทั้งหมด (Clear All)</button>
                  )}
              </div>

              <div className="flex-1 overflow-auto p-4 bg-slate-100/50 custom-scrollbar">
                  {printQueue.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-slate-400">
                          <div className="w-32 h-32 bg-slate-100 rounded-full flex items-center justify-center mb-4 border-4 border-white shadow-inner">
                              <Printer size={48} className="text-slate-300"/>
                          </div>
                          <p className="text-lg font-bold text-slate-600">ยังไม่มีสินค้าในคิว</p>
                          <p className="text-sm mt-1">คลิกเลือกสินค้าจากเมนูด้านซ้าย หรือรับเข้าผ่านเมนู Inbound</p>
                      </div>
                  ) : (
                      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                          {printQueue.map((item) => (
                              <div key={item.product_id} className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 flex flex-col relative group hover:border-indigo-300 transition-colors">
                                  
                                  <button onClick={() => removeFromQueue(item.product_id)} className="absolute top-3 right-3 text-slate-300 hover:text-rose-500 hover:bg-rose-50 p-1.5 rounded-lg transition-all z-10"><X size={18}/></button>

                                  <div className="flex gap-4">
                                      {/* Barcode Preview Placeholder */}
                                      <div className="w-32 h-32 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center justify-center shrink-0 overflow-hidden relative">
                                          <div className="absolute top-1 left-1 text-[8px] font-bold text-slate-300">PREVIEW</div>
                                          {labelType === 'BARCODE' ? (
                                              <Barcode value={item.product_id} width={1} height={40} fontSize={10} displayValue={true} background="transparent" margin={0}/>
                                          ) : (
                                              <QRCodeSVG value={item.product_id} size={70} level="H" />
                                          )}
                                      </div>
                                      
                                      <div className="flex-1 pr-6">
                                          <div className="font-black text-slate-800 text-base leading-tight mb-1">{item.product_name}</div>
                                          <div className="text-sm text-indigo-600 font-mono font-bold mb-3">{item.product_id}</div>
                                          
                                          <div className="grid grid-cols-2 gap-3">
                                              <div>
                                                  <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-1"><Calendar size={10}/> EXP Date</label>
                                                  <input type="date" className="w-full p-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white transition-colors" value={item.expDate} onChange={e => updateQueueItem(item.product_id, 'expDate', e.target.value)} />
                                              </div>
                                              <div>
                                                  <label className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1 mb-1"><MapPin size={10}/> Location</label>
                                                  <input type="text" placeholder="โซนจัดเก็บ" className="w-full p-1.5 border border-slate-200 rounded-lg text-xs outline-none focus:border-indigo-500 bg-slate-50 focus:bg-white uppercase font-bold text-amber-700 transition-colors" value={item.location} onChange={e => updateQueueItem(item.product_id, 'location', e.target.value)} />
                                              </div>
                                          </div>
                                      </div>
                                  </div>

                                  {/* Quick Qty Adjuster */}
                                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                                      <span className="text-xs font-bold text-slate-500 uppercase">Print Copies</span>
                                      <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                                          <button onClick={() => adjustCopies(item.product_id, -1)} className="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-slate-600 hover:text-rose-500 hover:bg-rose-50"><Minus size={14}/></button>
                                          <input type="number" min="1" className="w-16 h-8 text-center font-black text-indigo-700 bg-transparent border-none outline-none" value={item.copies} onChange={e => updateQueueItem(item.product_id, 'copies', parseInt(e.target.value) || 1)} />
                                          <button onClick={() => adjustCopies(item.product_id, 1)} className="w-8 h-8 flex items-center justify-center bg-white rounded-lg shadow-sm text-slate-600 hover:text-emerald-500 hover:bg-emerald-50"><Plus size={14}/></button>
                                      </div>
                                  </div>

                              </div>
                          ))}
                      </div>
                  )}
              </div>

              {/* Bottom Print Action */}
              <div className="bg-white p-5 border-t border-slate-200 shadow-[0_-10px_30px_rgba(0,0,0,0.05)] flex justify-between items-center z-10 shrink-0">
                  <div className="flex flex-col">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Labels to Print</span>
                      <span className="text-3xl font-black text-indigo-600">{totalLabels} <span className="text-sm font-bold text-slate-500 uppercase ml-1">Labels</span></span>
                  </div>
                  <button onClick={handlePrint} disabled={printQueue.length === 0} className="px-10 py-4 bg-gradient-to-r from-indigo-600 to-cyan-500 hover:from-indigo-500 hover:to-cyan-400 text-white rounded-2xl font-black shadow-lg shadow-indigo-200 flex items-center gap-3 transition-all active:scale-95 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed text-lg">
                      <Printer size={24}/> START PRINTING
                  </button>
              </div>
          </div>
      </div>

      {/* ========================================== */}
      {/* 🖨️ PRINTABLE AREA (แสดงเฉพาะตอนสั่ง Print ลงกระดาษจริง) */}
      {/* ========================================== */}
      <div id="printable-labels" className="hidden">
          {printQueue.map(item => {
              // สร้าง Label ซ้ำตามจำนวน copies
              return Array.from({ length: item.copies }).map((_, index) => (
                  <div key={`${item.product_id}-${index}`} className="print-label-box font-sans">
                      
                      {/* --- ชื่อสินค้า --- */}
                      <div className="font-bold text-[12px] text-center mb-1 leading-tight w-full truncate text-black uppercase">
                          {item.product_name}
                      </div>
                      
                      {/* --- บาร์โค้ด / QR --- */}
                      <div className="my-1 flex justify-center items-center w-full">
                          {labelType === 'BARCODE' ? (
                              <Barcode value={item.product_id} width={1.8} height={40} fontSize={14} displayValue={true} margin={0} background="transparent"/>
                          ) : (
                              <div className="flex flex-col items-center">
                                  <QRCodeSVG value={item.product_id} size={70} level="H" />
                                  <span className="font-mono font-bold text-[12px] mt-1 text-black">{item.product_id}</span>
                              </div>
                          )}
                      </div>

                      {/* --- ข้อมูลเสริม (ถ้าเลือกแบบ DETAILED) --- */}
                      {labelDesign === 'DETAILED' && (
                          <div className="text-[10px] font-bold text-center mt-1 border-t border-black border-dashed pt-1 w-full flex justify-between px-1 text-black">
                              <span className="truncate max-w-[50%]">LOC: {item.location || 'N/A'}</span>
                              <span className="truncate max-w-[50%] text-right">EXP: {item.expDate || '-'}</span>
                          </div>
                      )}
                  </div>
              ));
          })}
      </div>

    </div>
  );
}