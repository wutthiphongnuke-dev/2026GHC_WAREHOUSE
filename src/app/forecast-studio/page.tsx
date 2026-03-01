"use client";

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../supabaseClient';
import { 
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, 
    Legend, ResponsiveContainer, Area, ComposedChart, ReferenceLine
} from 'recharts';
import { 
    BrainCircuit, TrendingUp, Search, Activity, Package, Calendar, 
    Settings2, Target, BarChart2, CheckCircle, RefreshCw, AlertCircle,
    Download, FileSpreadsheet
} from 'lucide-react';
import * as XLSX from 'xlsx'; // 🟢 เพิ่มระบบ Export

// --- คณิตศาสตร์สำหรับการพยากรณ์ (Forecast Engine) ---
const ALGORITHMS = [
    { id: 'MA', name: 'Moving Average (MA)', desc: 'ค่าเฉลี่ยเคลื่อนที่พื้นฐาน เหมาะกับสินค้าที่ยอดขายนิ่งๆ' },
    { id: 'WMA', name: 'Weighted Moving Average', desc: 'ให้น้ำหนักข้อมูลล่าสุดมากกว่า เหมาะกับช่วงที่เทรนด์เริ่มเปลี่ยน' },
    { id: 'SES', name: 'Simple Exponential Smoothing', desc: 'ปรับเรียบข้อมูล ตัดสัญญาณรบกวน (Noise) ออก' },
    { id: 'HOLT', name: 'Holt’s Linear Trend', desc: 'ดักจับเทรนด์ (ขาขึ้น/ลง) ได้ดีเยี่ยม' },
    { id: 'HW', name: 'Holt-Winters (Seasonality)', desc: 'ดักจับฤดูกาล (เช่น ขายดีทุกวันศุกร์-เสาร์)' },
    { id: 'ARIMA', name: 'Auto-ARIMA (Lite)', desc: 'วิเคราะห์ความผันผวน (Volatility) และ Auto-regression' },
    { id: 'PROPHET', name: 'Prophet (Heuristic)', desc: 'ผสมผสานเทรนด์หลัก ฤดูกาลรายสัปดาห์ และการเติบโต' }
];

export default function ForecastStudioPage() {
    const [loading, setLoading] = useState(false);
    const [syncProgress, setSyncProgress] = useState(''); // 🟢 เพิ่ม State บอกสถานะโหลดข้อมูล
    const [products, setProducts] = useState<any[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedProduct, setSelectedProduct] = useState<any>(null);
    
    // --- Forecast Settings ---
    const [historyDays, setHistoryDays] = useState(60); 
    const [forecastHorizon, setForecastHorizon] = useState(14); 
    const [selectedAlgo, setSelectedAlgo] = useState('PROPHET'); // 🟢 เปลี่ยน Default เป็น Prophet ที่ฉลาดกว่า
    
    // --- Data States ---
    const [rawHistory, setRawHistory] = useState<any[]>([]);
    const [chartData, setChartData] = useState<any[]>([]);
    const [metrics, setMetrics] = useState({ mape: 0, rmse: 0 });

    useEffect(() => {
        fetchProducts();
    }, []);

    const fetchProducts = async () => {
        setLoading(true);
        const { data } = await supabase.from('master_products').select('product_id, product_name, category, base_uom').order('product_name');
        setProducts(data || []);
        setLoading(false);
    };

    useEffect(() => {
        if (selectedProduct) fetchHistoryData(selectedProduct.product_id);
    }, [selectedProduct, historyDays]);

    useEffect(() => {
        if (rawHistory.length > 0) runForecastModel();
    }, [rawHistory, selectedAlgo, forecastHorizon]);

    // 🟢 1. FETCH DATA (อัปเกรดเป็น Chunking System)
    const fetchHistoryData = async (productId: string) => {
        setLoading(true);
        setSyncProgress('กำลังเตรียมข้อมูล...');
        try {
            const today = new Date(); today.setHours(0,0,0,0);
            const startDate = new Date(today); startDate.setDate(startDate.getDate() - historyDays + 1);
            const dateLimitStr = startDate.toISOString().split('T')[0];
            
            let allTransactions: any[] = [];
            let hasMore = true;
            let offset = 0;
            const limitSize = 1000;

            // 🟢 วนลูปโหลดประวัติจนกว่าจะครบ ป้องกันข้อมูลขาดหาย
            while (hasMore) {
                const { data: txs, error } = await supabase
                    .from('transactions_log')
                    .select('transaction_date, transaction_type, quantity_change')
                    .eq('product_id', productId)
                    .gte('transaction_date', dateLimitStr)
                    .range(offset, offset + limitSize - 1);

                if (error) throw error;

                if (txs && txs.length > 0) {
                    allTransactions = [...allTransactions, ...txs];
                    offset += limitSize;
                    setSyncProgress(`ดึงประวัติแล้ว ${allTransactions.length} รายการ...`);
                    if (txs.length < limitSize) hasMore = false;
                } else {
                    hasMore = false;
                }
            }

            setSyncProgress('กำลังประมวลผล (Data Preprocessing)...');

            // เติม 0 ในวันที่ไม่มีการเบิก (Continuous Time Series)
            const dailyMap: Record<string, number> = {};
            for(let i=0; i<historyDays; i++) {
                const d = new Date(startDate); d.setDate(d.getDate() + i);
                dailyMap[d.toISOString().split('T')[0]] = 0;
            }

            allTransactions.forEach(tx => {
                if (!tx.transaction_date) return;
                const type = String(tx.transaction_type).toUpperCase();
                const qty = Number(tx.quantity_change);
                
                const isOutboundKeyword = type.includes('OUT') || type.includes('TRANS') || type.includes('DISP') || type.includes('ISSUE') || type.includes('SALE') || type.includes('USE');
                const isNegativeButNotAdjust = qty < 0 && !type.includes('ADJUST') && !type.includes('CYCLE') && !type.includes('IN') && !type.includes('RECV') && !type.includes('RECEIPT');

                if (isOutboundKeyword || isNegativeButNotAdjust) {
                    const localDate = new Date(tx.transaction_date);
                    const dStr = `${localDate.getFullYear()}-${String(localDate.getMonth()+1).padStart(2,'0')}-${String(localDate.getDate()).padStart(2,'0')}`;
                    if (dailyMap[dStr] !== undefined) {
                        dailyMap[dStr] += Math.abs(qty);
                    }
                }
            });

            const timeSeries = Object.keys(dailyMap).sort().map(date => ({
                date, actual: dailyMap[date]
            }));
            setRawHistory(timeSeries);

        } catch (error) { console.error(error); }
        setLoading(false);
        setSyncProgress('');
    };

    // ==========================================
    // 🧠 FORECASTING ENGINE (MATH ALGORITHMS)
    // ==========================================
    const runForecastModel = () => {
        const data = [...rawHistory];
        const actuals = data.map(d => d.actual);
        const n = actuals.length;
        let backtest: (number | null)[] = Array(n).fill(null);
        let forecasts: (number | null)[] = Array(forecastHorizon).fill(null);

        const alpha = 0.3; const beta = 0.2; const gamma = 0.4;
        
        switch (selectedAlgo) {
            case 'MA': 
                const windowMA = 7;
                for (let i = windowMA; i < n; i++) {
                    backtest[i] = actuals.slice(i - windowMA, i).reduce((a,b)=>a+b,0) / windowMA;
                }
                const lastMA = actuals.slice(-windowMA).reduce((a,b)=>a+b,0) / windowMA;
                forecasts = forecasts.map(() => lastMA);
                break;

            case 'WMA': 
                const windowWMA = 7;
                const weights = [1, 2, 3, 4, 5, 6, 7];
                const weightSum = 28;
                for (let i = windowWMA; i < n; i++) {
                    let sum = 0;
                    for (let j = 0; j < windowWMA; j++) sum += actuals[i - windowWMA + j] * weights[j];
                    backtest[i] = sum / weightSum;
                }
                let lastWMA = 0;
                for (let j = 0; j < windowWMA; j++) lastWMA += actuals[n - windowWMA + j] * weights[j];
                lastWMA /= weightSum;
                forecasts = forecasts.map(() => lastWMA);
                break;

            case 'SES': 
                backtest[0] = actuals[0];
                for (let i = 1; i < n; i++) {
                    backtest[i] = alpha * actuals[i-1] + (1 - alpha) * backtest[i-1]!;
                }
                const lastSES = alpha * actuals[n-1] + (1 - alpha) * backtest[n-1]!;
                forecasts = forecasts.map(() => lastSES);
                break;

            case 'HOLT': 
                let level = actuals[0]; let trend = actuals[1] - actuals[0];
                backtest[0] = level;
                for (let i = 1; i < n; i++) {
                    const lastLevel = level;
                    level = alpha * actuals[i] + (1 - alpha) * (level + trend);
                    trend = beta * (level - lastLevel) + (1 - beta) * trend;
                    backtest[i] = level + trend;
                }
                for (let i = 0; i < forecastHorizon; i++) {
                    forecasts[i] = level + (i + 1) * trend;
                }
                break;

            case 'HW': 
                const slen = 7;
                let s = Array(slen).fill(0);
                if (n >= slen) {
                    const avgInitial = actuals.slice(0, slen).reduce((a,b)=>a+b,0)/slen;
                    for(let i=0; i<slen; i++) s[i] = actuals[i] - avgInitial;
                }
                let L = actuals[0]; let T = 0;
                for (let i = 0; i < n; i++) {
                    if (i < slen) { backtest[i] = actuals[i]; continue; }
                    const lastL = L;
                    L = alpha * (actuals[i] - s[i % slen]) + (1 - alpha) * (L + T);
                    T = beta * (L - lastL) + (1 - beta) * T;
                    s[i % slen] = gamma * (actuals[i] - L) + (1 - gamma) * s[i % slen];
                    backtest[i] = L + T + s[i % slen];
                }
                for (let i = 0; i < forecastHorizon; i++) {
                    forecasts[i] = L + (i + 1) * T + s[(n + i) % slen];
                }
                break;

            case 'ARIMA': 
                let ar = 0; let err = 0;
                backtest[0] = actuals[0];
                for (let i = 1; i < n; i++) {
                    const diff = actuals[i] - actuals[i-1];
                    ar = 0.5 * actuals[i-1];
                    err = 0.3 * (backtest[i-1]! - actuals[i-1]);
                    backtest[i] = Math.max(0, ar + err + (actuals.reduce((a,b)=>a+b,0)/n));
                }
                const mean = actuals.reduce((a,b)=>a+b,0)/n;
                const stdDev = Math.sqrt(actuals.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / n);
                for (let i = 0; i < forecastHorizon; i++) {
                    forecasts[i] = Math.max(0, mean + (0.5 * stdDev * (Math.random() > 0.5 ? 1 : -1))); 
                }
                break;

            case 'PROPHET': 
                const weeklyProfile = [0,0,0,0,0,0,0];
                const dayCounts = [0,0,0,0,0,0,0];
                data.forEach((d) => {
                    const dayIdx = new Date(d.date).getDay();
                    weeklyProfile[dayIdx] += d.actual;
                    dayCounts[dayIdx]++;
                });
                const globalAvg = actuals.reduce((a,b)=>a+b,0)/n;
                const weeklyMultiplier = weeklyProfile.map((sum, i) => {
                    const dayAvg = dayCounts[i] > 0 ? sum/dayCounts[i] : 0;
                    return globalAvg > 0 ? dayAvg / globalAvg : 1;
                });
                
                let pLevel = actuals[0]; let pTrend = (actuals[n-1] - actuals[0]) / n;
                for (let i = 0; i < n; i++) {
                    const dayIdx = new Date(data[i].date).getDay();
                    backtest[i] = (pLevel + (i * pTrend)) * weeklyMultiplier[dayIdx];
                }
                for (let i = 0; i < forecastHorizon; i++) {
                    const futureDate = new Date(data[n-1].date);
                    futureDate.setDate(futureDate.getDate() + i + 1);
                    const dayIdx = futureDate.getDay();
                    forecasts[i] = Math.max(0, (pLevel + ((n + i) * pTrend)) * weeklyMultiplier[dayIdx]);
                }
                break;
        }

        // Calculate Metrics
        let se = 0; let ape = 0; let count = 0;
        for (let i = 0; i < n; i++) {
            if (backtest[i] !== null && actuals[i] > 0) {
                se += Math.pow(actuals[i] - backtest[i]!, 2);
                ape += Math.abs((actuals[i] - backtest[i]!) / actuals[i]);
                count++;
            }
        }
        setMetrics({
            rmse: count > 0 ? Math.sqrt(se / count) : 0,
            mape: count > 0 ? (ape / count) * 100 : 0
        });

        // Prepare Chart Data
        const finalChartData = [];
        for (let i = 0; i < n; i++) {
            finalChartData.push({
                date: new Date(data[i].date).toLocaleDateString('en-GB', {day:'2-digit', month:'short'}),
                rawDate: data[i].date,
                Actual: data[i].actual,
                Backtest: backtest[i] !== null ? Math.max(0, Number(backtest[i]?.toFixed(2))) : null,
                Forecast: null
            });
        }
        for (let i = 0; i < forecastHorizon; i++) {
            const d = new Date(data[n-1].date);
            d.setDate(d.getDate() + i + 1);
            finalChartData.push({
                date: d.toLocaleDateString('en-GB', {day:'2-digit', month:'short'}),
                rawDate: d.toISOString().split('T')[0],
                Actual: null,
                Backtest: null,
                Forecast: Math.max(0, Number(forecasts[i]?.toFixed(2)))
            });
        }
        setChartData(finalChartData);
    };

    // 🟢 2. EXPORT EXCEL LOGIC
    const handleExportForecast = () => {
        if (chartData.length === 0 || !selectedProduct) return alert("ไม่มีข้อมูลสำหรับ Export");

        const exportPayload = chartData.map(d => ({
            'วันที่ (Date)': d.rawDate,
            'ประเภท (Type)': d.Forecast !== null ? 'Future (อนาคต)' : 'Historical (อดีต)',
            'ยอดเบิกจริง (Actual)': d.Actual !== null ? d.Actual : '-',
            'ทดสอบโมเดล (Backtest)': d.Backtest !== null ? d.Backtest : '-',
            'ยอดพยากรณ์ (Forecast)': d.Forecast !== null ? d.Forecast : '-',
            'หน่วย (UOM)': selectedProduct.base_uom
        }));

        const ws = XLSX.utils.json_to_sheet(exportPayload);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `${selectedAlgo}_Forecast`);
        XLSX.writeFile(wb, `Demand_Forecast_${selectedProduct.product_id}_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const filteredProducts = useMemo(() => {
        if (!searchTerm) return products;
        const s = searchTerm.toLowerCase();
        return products.filter(p => p.product_name.toLowerCase().includes(s) || p.product_id.toLowerCase().includes(s));
    }, [products, searchTerm]);

    const CustomTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-slate-900/95 p-3 rounded-xl shadow-xl border border-slate-700 text-xs text-white">
                    <div className="font-bold text-slate-300 mb-2 pb-1 border-b border-slate-700">{label}</div>
                    {payload.map((entry: any, index: number) => (
                        <div key={index} className="flex justify-between gap-4 mb-1">
                            <span style={{ color: entry.color }} className="font-bold">{entry.name}:</span>
                            <span className="font-mono">{entry.value}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    return (
        <div className="p-4 md:p-6 h-full bg-slate-50 flex flex-col font-sans overflow-hidden">
            
            {/* HEADER */}
            <div className="flex justify-between items-start mb-6 shrink-0">
                <div>
                    <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                        <div className="p-2 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-xl text-white shadow-lg"><BrainCircuit size={24}/></div>
                        Forecast Studio (AI)
                    </h1>
                    <p className="text-slate-500 text-sm mt-1">วิเคราะห์และพยากรณ์ Demand ขั้นสูงด้วยสถิติและ Machine Learning (Lite)</p>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0 overflow-hidden">
                
                {/* --- LEFT PANEL: Settings & Product Selection --- */}
                <div className="w-full lg:w-80 bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col overflow-hidden shrink-0">
                    <div className="p-4 bg-slate-50 border-b border-slate-100 font-bold text-slate-700 flex items-center justify-between">
                        <span className="flex items-center gap-2"><Settings2 size={18} className="text-indigo-500"/> Parameters</span>
                        {/* 🟢 ปุ่ม Sync Data Manual */}
                        {selectedProduct && (
                            <button onClick={() => fetchHistoryData(selectedProduct.product_id)} disabled={loading} className="text-indigo-600 hover:bg-indigo-100 p-1.5 rounded-lg transition-colors" title="Sync ข้อมูลใหม่">
                                <RefreshCw size={14} className={loading ? "animate-spin" : ""}/>
                            </button>
                        )}
                    </div>
                    
                    <div className="p-4 border-b border-slate-100 space-y-4 bg-white">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase">Forecast Algorithm</label>
                            <select 
                                className="w-full mt-1 p-2 bg-indigo-50 border border-indigo-100 text-indigo-700 font-bold rounded-lg outline-none cursor-pointer"
                                value={selectedAlgo} onChange={e => setSelectedAlgo(e.target.value)}
                            >
                                {ALGORITHMS.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                            <p className="text-[10px] text-slate-400 mt-1">{ALGORITHMS.find(a => a.id === selectedAlgo)?.desc}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Train Data (Days)</label>
                                <select className="w-full mt-1 p-1.5 border rounded outline-none text-sm font-bold bg-slate-50" value={historyDays} onChange={e => setHistoryDays(Number(e.target.value))}>
                                    <option value={30}>30 Days</option><option value={60}>60 Days</option><option value={90}>90 Days</option><option value={120}>120 Days</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase">Forecast (Days)</label>
                                <select className="w-full mt-1 p-1.5 border rounded outline-none text-sm font-bold text-indigo-600 bg-indigo-50" value={forecastHorizon} onChange={e => setForecastHorizon(Number(e.target.value))}>
                                    <option value={7}>7 Days</option><option value={14}>14 Days</option><option value={30}>30 Days</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="p-3 border-b border-slate-100 bg-slate-50 relative">
                        <Search size={16} className="absolute left-6 top-5 text-slate-400"/>
                        <input 
                            type="text" placeholder="ค้นหาสินค้าเพื่อวิเคราะห์..." 
                            className="w-full pl-9 p-2 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-400 shadow-inner bg-white"
                            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="flex-1 overflow-auto p-2 bg-slate-50 custom-scrollbar">
                        {filteredProducts.slice(0, 100).map(p => (
                            <div 
                                key={p.product_id} 
                                onClick={() => setSelectedProduct(p)}
                                className={`p-3 rounded-xl cursor-pointer mb-1 border transition-all ${selectedProduct?.product_id === p.product_id ? 'bg-indigo-600 text-white border-indigo-700 shadow-md' : 'bg-white border-slate-200 text-slate-700 hover:border-indigo-300 hover:shadow-sm'}`}
                            >
                                <div className="font-bold text-sm truncate">{p.product_name}</div>
                                <div className={`text-[10px] font-mono mt-0.5 ${selectedProduct?.product_id === p.product_id ? 'text-indigo-200' : 'text-slate-400'}`}>{p.product_id}</div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* --- RIGHT PANEL: Graph & Analysis --- */}
                <div className="flex-1 bg-white rounded-3xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                    {loading ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-indigo-500">
                            <RefreshCw size={40} className="animate-spin mb-4"/>
                            <div className="font-bold tracking-widest uppercase text-sm">Running Algorithm...</div>
                            {syncProgress && <div className="text-xs font-bold mt-2 bg-indigo-50 px-3 py-1 rounded-full">{syncProgress}</div>}
                        </div>
                    ) : !selectedProduct ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                            <Target size={64} className="opacity-20 mb-4"/>
                            <div className="font-bold text-lg">โปรดเลือกสินค้าจากเมนูด้านซ้าย</div>
                            <div className="text-sm">เพื่อทำการวิเคราะห์ข้อมูลพยากรณ์ (Forecast Analysis)</div>
                        </div>
                    ) : (
                        <>
                            <div className="p-6 border-b border-slate-100 flex flex-wrap justify-between items-center gap-4 bg-slate-50">
                                <div>
                                    <h2 className="text-xl font-black text-slate-800 flex items-center gap-2">
                                        {selectedProduct.product_name}
                                    </h2>
                                    <div className="flex items-center gap-3 mt-1 text-sm font-medium">
                                        <span className="text-indigo-600 font-mono bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">{selectedProduct.product_id}</span>
                                        <span className="text-slate-500 flex items-center gap-1"><Package size={14}/> {selectedProduct.category}</span>
                                    </div>
                                </div>
                                <div className="flex gap-4 items-center">
                                    <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-end min-w-[120px]">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center gap-1" title="ยิ่งค่าเปอร์เซ็นต์ต่ำ แปลว่าโมเดลทำนายได้แม่นยำ"><AlertCircle size={12}/> MAPE (Error %)</span>
                                        <span className={`text-2xl font-black ${metrics.mape < 20 ? 'text-emerald-500' : metrics.mape < 40 ? 'text-amber-500' : 'text-rose-500'}`}>
                                            {metrics.mape.toFixed(1)}%
                                        </span>
                                    </div>
                                    <div className="bg-white p-3 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-end min-w-[120px]">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">RMSE (Deviation)</span>
                                        <span className="text-2xl font-black text-slate-700">
                                            ±{metrics.rmse.toFixed(1)} <span className="text-xs text-slate-400">{selectedProduct.base_uom}</span>
                                        </span>
                                    </div>
                                    
                                    {/* 🟢 ปุ่ม Export Excel */}
                                    <button onClick={handleExportForecast} className="p-3 bg-slate-800 text-white rounded-2xl shadow-lg hover:bg-black transition-colors flex items-center gap-2 font-bold text-sm h-full">
                                        <Download size={18}/> <span className="hidden xl:inline">Export</span>
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 p-6 min-h-[400px]">
                                <h3 className="text-sm font-bold text-slate-600 mb-4 flex items-center gap-2">
                                    <TrendingUp size={16} className="text-indigo-500"/> 
                                    Actual vs Backtest vs Forecast ({selectedAlgo})
                                </h3>
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9"/>
                                        <XAxis dataKey="date" tick={{fontSize: 10, fill: '#64748b'}} tickLine={false} axisLine={false} dy={10} minTickGap={20}/>
                                        <YAxis tick={{fontSize: 10, fill: '#64748b'}} tickLine={false} axisLine={false}/>
                                        <RechartsTooltip content={<CustomTooltip />} />
                                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '12px', fontWeight: 'bold' }}/>
                                        
                                        <ReferenceLine x={chartData[chartData.length - forecastHorizon - 1]?.date} stroke="#cbd5e1" strokeDasharray="3 3" label={{ position: 'top', value: 'Today', fill: '#94a3b8', fontSize: 10, fontWeight: 'bold' }} />

                                        <Area type="step" dataKey="Actual" fill="#e0e7ff" stroke="none" name="Actual Demand (จริง)" />
                                        <Line type="monotone" dataKey="Backtest" stroke="#8b5cf6" strokeWidth={2} dot={false} name="Model Fitted (จำลองอดีต)" strokeDasharray="5 5" />
                                        <Line type="monotone" dataKey="Forecast" stroke="#f43f5e" strokeWidth={3} dot={{r: 3, fill: '#f43f5e', strokeWidth: 0}} activeDot={{r: 6}} name={`Forecast ${forecastHorizon} Days (พยากรณ์)`} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>

                            <div className="h-48 border-t border-slate-100 bg-slate-50 flex flex-col shrink-0">
                                <div className="p-2 border-b border-slate-200 text-xs font-bold text-slate-500 flex justify-between px-6 bg-slate-100">
                                    <span>Forecasted Values (Next {forecastHorizon} Days)</span>
                                    <span>Total Est: <span className="text-rose-600 font-black">{chartData.reduce((acc, d) => acc + (d.Forecast || 0), 0).toFixed(0)}</span> {selectedProduct.base_uom}</span>
                                </div>
                                <div className="flex-1 overflow-x-auto custom-scrollbar p-4 flex gap-3">
                                    {chartData.filter(d => d.Forecast !== null).map((d, i) => (
                                        <div key={i} className="bg-white border border-rose-100 rounded-xl p-3 min-w-[100px] flex flex-col items-center justify-center shadow-sm shrink-0 hover:-translate-y-1 transition-transform">
                                            <span className="text-[10px] font-bold text-slate-400 mb-1">{d.date}</span>
                                            <span className="text-xl font-black text-rose-500">{d.Forecast?.toFixed(1)}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}