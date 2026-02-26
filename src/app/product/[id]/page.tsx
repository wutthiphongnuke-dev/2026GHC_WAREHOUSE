"use client";

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '../../../supabaseClient';
import { 
    Package, MapPin, Tag, Box, ArrowLeft, History, 
    TrendingUp, TrendingDown, Activity, AlertTriangle, Calendar
} from 'lucide-react';

export default function ProductDetailPage() {
    const params = useParams();
    const router = useRouter();
    const productId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [product, setProduct] = useState<any>(null);
    const [lots, setLots] = useState<any[]>([]);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [totalStock, setTotalStock] = useState(0);

    useEffect(() => {
        if (productId) fetchItemData();
    }, [productId]);

    const fetchItemData = async () => {
        setLoading(true);
        try {
            // 1. ดึงข้อมูล Master Product
            const { data: prodData } = await supabase.from('master_products').select('*').eq('product_id', decodeURIComponent(productId)).single();
            if (!prodData) throw new Error("ไม่พบสินค้ารหัสนี้");
            setProduct(prodData);

            // 2. ดึงข้อมูล Lot / สถานที่จัดเก็บ (Inventory Lots)
            const { data: lotsData } = await supabase.from('inventory_lots').select('*').eq('product_id', prodData.product_id).gt('quantity', 0);
            setLots(lotsData || []);
            setTotalStock((lotsData || []).reduce((acc, lot) => acc + Number(lot.quantity), 0));

            // 3. ดึงประวัติการเคลื่อนไหว (Transactions)
            const { data: txData } = await supabase.from('transactions_log')
                .select('*').eq('product_id', prodData.product_id)
                .order('transaction_date', { ascending: false }).limit(100);
            setTransactions(txData || []);

        } catch (error: any) {
            console.error(error);
            alert(error.message);
            router.push('/warehouse');
        }
        setLoading(false);
    };

    if (loading) return <div className="flex h-full items-center justify-center text-cyan-500 font-bold animate-pulse"><Activity size={32} className="mr-2 animate-spin"/> Loading Item Data...</div>;
    if (!product) return null;

    return (
        <div className="p-6 bg-slate-50 h-full flex flex-col overflow-y-auto rounded-2xl relative font-sans">
            
            {/* --- HEADER --- */}
            <div className="mb-6 flex items-start gap-4">
                <button onClick={() => router.back()} className="p-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors text-slate-500 mt-1 shadow-sm">
                    <ArrowLeft size={20}/>
                </button>
                <div className="flex-1 flex justify-between items-start">
                    <div>
                        <div className="flex items-center gap-3 mb-1">
                            <h1 className="text-3xl font-black text-slate-800">{product.product_name}</h1>
                            <span className={`text-[10px] font-bold px-2 py-1 rounded uppercase tracking-widest ${product.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                {product.status}
                            </span>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-slate-500 font-medium mt-2">
                            <span className="flex items-center gap-1 font-mono text-cyan-700 bg-cyan-50 px-2 py-0.5 rounded border border-cyan-100"><Package size={14}/> {product.product_id}</span>
                            <span className="flex items-center gap-1"><Tag size={14}/> {product.category || 'Uncategorized'}</span>
                            <span className="flex items-center gap-1"><Box size={14}/> {product.base_uom}</span>
                        </div>
                    </div>
                    <div className="text-right bg-white p-4 rounded-2xl border border-slate-200 shadow-sm min-w-[200px]">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Current Total Stock</div>
                        <div className={`text-4xl font-black ${totalStock <= (product.min_stock||0) ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {totalStock.toLocaleString()} <span className="text-sm font-medium text-slate-500">{product.base_uom}</span>
                        </div>
                        {totalStock <= (product.min_stock||0) && <div className="text-[10px] text-rose-500 font-bold mt-1 animate-pulse flex items-center justify-end gap-1"><AlertTriangle size={12}/> ต่ำกว่าจุดสั่งซื้อ (Min: {product.min_stock})</div>}
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
                
                {/* --- LEFT: ACTIVE LOTS & LOCATIONS --- */}
                <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                    <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
                        <MapPin size={18} className="text-indigo-500"/>
                        <h2 className="font-bold text-slate-700">Storage Locations (Lots)</h2>
                    </div>
                    <div className="flex-1 overflow-auto p-4 space-y-3">
                        {lots.length === 0 ? (
                            <div className="text-center text-slate-400 py-10 text-sm">ไม่มีสต๊อกคงเหลือในระบบ</div>
                        ) : lots.map(lot => (
                            <div key={lot.lot_id} className="p-4 border border-slate-200 rounded-xl hover:border-indigo-300 transition-colors shadow-sm relative overflow-hidden">
                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-400"></div>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="font-bold text-slate-800 flex items-center gap-1"><MapPin size={12} className="text-slate-400"/> {lot.storage_location}</div>
                                    <div className="font-black text-indigo-600 text-lg">{Number(lot.quantity).toLocaleString()}</div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 bg-slate-50 p-2 rounded-lg mt-2">
                                    <div><span className="uppercase font-bold text-slate-400 block mb-0.5">MFG</span>{lot.mfg_date || '-'}</div>
                                    <div><span className="uppercase font-bold text-slate-400 block mb-0.5">EXP</span>{lot.exp_date || '-'}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* --- RIGHT: TRANSACTION HISTORY --- */}
                <div className="lg:col-span-2 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                    <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <History size={18} className="text-cyan-500"/>
                            <h2 className="font-bold text-slate-700">Transaction History</h2>
                        </div>
                        <span className="text-xs text-slate-400">100 รายการล่าสุด</span>
                    </div>
                    <div className="flex-1 overflow-auto">
                        <table className="w-full text-left text-sm whitespace-nowrap">
                            <thead className="bg-slate-100/50 text-slate-500 font-bold uppercase text-[10px] sticky top-0 backdrop-blur-sm shadow-sm z-10">
                                <tr>
                                    <th className="p-3 pl-4">Date & Time</th>
                                    <th className="p-3">Ref ID</th>
                                    <th className="p-3 text-center">Type</th>
                                    <th className="p-3 text-right">Change</th>
                                    <th className="p-3 text-right">Balance</th>
                                    <th className="p-3">Remarks</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {transactions.length === 0 ? (
                                    <tr><td colSpan={6} className="text-center text-slate-400 py-10">ไม่มีประวัติการทำรายการ</td></tr>
                                ) : transactions.map(tx => (
                                    <tr key={tx.transaction_id} className="hover:bg-slate-50 transition-colors group">
                                        <td className="p-3 pl-4">
                                            <div className="font-bold text-slate-700">{new Date(tx.transaction_date).toLocaleDateString('th-TH')}</div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">{new Date(tx.transaction_date).toLocaleTimeString('th-TH')}</div>
                                        </td>
                                        <td className="p-3 font-mono text-[10px] text-slate-400 truncate max-w-[100px]" title={tx.reference_id || tx.transaction_id}>
                                            {tx.reference_id?.split('-')[0] || tx.transaction_id?.split('-')[0]}
                                        </td>
                                        <td className="p-3 text-center">
                                            <span className={`text-[9px] font-black px-2 py-1 rounded-md uppercase tracking-wider ${
                                                tx.transaction_type === 'INBOUND' ? 'bg-emerald-100 text-emerald-700' :
                                                tx.transaction_type === 'OUTBOUND' ? 'bg-rose-100 text-rose-700' :
                                                'bg-orange-100 text-orange-700'
                                            }`}>
                                                {tx.transaction_type}
                                            </span>
                                        </td>
                                        <td className={`p-3 text-right font-black ${Number(tx.quantity_change) > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                            {Number(tx.quantity_change) > 0 ? '+' : ''}{Number(tx.quantity_change).toLocaleString()}
                                        </td>
                                        <td className="p-3 text-right font-bold text-slate-700 bg-slate-50/50">
                                            {Number(tx.balance_after).toLocaleString()}
                                        </td>
                                        <td className="p-3 text-xs text-slate-500 truncate max-w-[200px]" title={tx.remarks}>
                                            {tx.remarks || '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>
        </div>
    );
}