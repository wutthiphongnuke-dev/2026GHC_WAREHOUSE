"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { supabase } from '../supabaseClient';
import { 
  ShieldCheck, Server, Activity, Globe, Database, 
  Lock, Cpu, ArrowRight, Package, Home, Users 
} from 'lucide-react';

export default function HomePage() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [stats, setStats] = useState({
    products: 0,
    branches: 0,
    vendors: 0,
    ping: 0
  });

  useEffect(() => {
    // Animation trigger
    setTimeout(() => setIsLoaded(true), 100);
    fetchSystemPulse();
  }, []);

  const fetchSystemPulse = async () => {
    const start = Date.now();
    try {
      // ดึงตัวเลขสถิติแบบเร็วๆ (ใช้ count: exact) เพื่อไม่ให้โหลดหนัก
      const [pRes, bRes, vRes] = await Promise.all([
        supabase.from('master_products').select('*', { count: 'exact', head: true }),
        supabase.from('master_branches').select('*', { count: 'exact', head: true }),
        supabase.from('master_vendors').select('*', { count: 'exact', head: true })
      ]);

      const end = Date.now();
      
      setStats({
        products: pRes.count || 0,
        branches: bRes.count || 0,
        vendors: vRes.count || 0,
        ping: end - start // คำนวณ Latency คร่าวๆ
      });
    } catch (error) {
      console.error("Error fetching pulse:", error);
    }
  };

  return (
    // พื้นหลังโทนลึก (Deep Slate) ให้ความรู้สึกมั่นคง ปลอดภัย
    <div className="h-full w-full bg-slate-950 relative overflow-hidden flex flex-col justify-center items-center font-sans">
      
      {/* --- Visual Effects (เส้นกริด และ แสงเรืองรอง) --- */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:64px_64px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] pointer-events-none"></div>
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-600/10 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-cyan-500/10 blur-[120px] rounded-full pointer-events-none"></div>

      <div className={`relative z-10 w-full max-w-6xl px-6 transition-all duration-1000 transform ${isLoaded ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-12'}`}>
        
        {/* --- 1. SYSTEM HEALTH BADGES --- */}
        <div className="flex flex-wrap justify-center gap-3 md:gap-6 mb-12">
            <Badge icon={<Server size={14}/>} text="SYSTEM ONLINE" color="text-emerald-400" dotColor="bg-emerald-400" />
            <Badge icon={<Database size={14}/>} text="SUPABASE CONNECTED" color="text-cyan-400" dotColor="bg-cyan-400" />
            <Badge icon={<Lock size={14}/>} text="END-TO-END ENCRYPTED" color="text-fuchsia-400" />
            <Badge icon={<Activity size={14}/>} text={`LATENCY: ${stats.ping > 0 ? stats.ping : '--'}ms`} color="text-amber-400" />
        </div>

        {/* --- 2. HERO TYPOGRAPHY --- */}
        <div className="text-center mb-16 relative">
          <div className="text-xs md:text-sm font-bold tracking-[0.3em] text-slate-500 mb-4">WAREHOUSE MANAGEMENT BY WUTTHIPHONG</div>
          <h1 className="text-6xl md:text-8xl font-black tracking-tighter text-white mb-6 drop-shadow-2xl">
            2026 <span className="text-transparent bg-clip-text bg-gradient-to-br from-cyan-400 to-blue-600">GHC WAREHOUSE</span>
          </h1>
          <p className="text-slate-400 max-w-2xl mx-auto text-lg md:text-xl font-light leading-relaxed">
            Warehouse Management System for Greyhound cafe' <br/>
            <span className="text-slate-500 text-sm">Synchronized • Secure • Scalable</span>
          </p>
        </div>

        {/* --- 3. DATABASE PULSE (สถิติรวม) --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-16">
          <StatCard icon={<Package size={24}/>} label="Total Managed SKUs" value={stats.products} delay="delay-100" />
          <StatCard icon={<Home size={24}/>} label="Active Branches" value={stats.branches} delay="delay-200" />
          <StatCard icon={<Users size={24}/>} label="Registered Vendors" value={stats.vendors} delay="delay-300" />
        </div>

        {/* --- 4. ACTION BUTTON --- */}
        <div className="flex justify-center">
            <Link href="/dashboard" className="group relative px-8 py-4 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl flex items-center gap-4 overflow-hidden transition-all hover:bg-white/10 hover:border-cyan-500/50 hover:shadow-[0_0_40px_rgba(34,211,238,0.2)]">
                <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                <Cpu className="text-cyan-400 relative z-10" size={24} />
                <span className="text-lg font-bold text-white tracking-wide relative z-10">INITIALIZE WORKSPACE</span>
                <ArrowRight className="text-slate-400 group-hover:text-cyan-400 group-hover:translate-x-2 transition-all relative z-10" size={20} />
            </Link>
        </div>

      </div>

      {/* Footer Info */}
      <div className="absolute bottom-6 left-0 right-0 text-center text-[10px] font-mono text-slate-600 tracking-widest pointer-events-none">
        WMS PRO CORE v2.0.0 © {new Date().getFullYear()} • AUTHORIZED PERSONNEL ONLY
      </div>
    </div>
  );
}

// --- Sub Components สำหรับความสวยงาม ---

function Badge({ icon, text, color, dotColor }: any) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900/50 backdrop-blur-md border border-white/5 rounded-full shadow-lg">
      <span className={color}>{icon}</span>
      <span className={`text-[10px] font-mono font-bold tracking-widest ${color}`}>{text}</span>
      {dotColor && (
        <span className="relative flex h-2 w-2 ml-1">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColor}`}></span>
          <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`}></span>
        </span>
      )}
    </div>
  );
}

function StatCard({ icon, label, value, delay }: any) {
  return (
    <div className={`p-6 bg-slate-900/40 backdrop-blur-sm border border-slate-800 rounded-3xl flex flex-col items-center text-center transition-all hover:bg-slate-800/50 hover:border-slate-700 animate-fade-in-up ${delay}`}>
      <div className="w-12 h-12 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center mb-4 shadow-inner">
        {icon}
      </div>
      <div className="text-4xl font-black text-white mb-1 font-mono tracking-tight">
        {value.toLocaleString()}
      </div>
      <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}