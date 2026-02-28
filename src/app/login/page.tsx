"use client";

import { useState } from 'react';
import { supabase } from '../../supabaseClient';
import { useRouter } from 'next/navigation';
import { Database, Lock, Mail, Activity, ArrowRight, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;
      
      // ล็อกอินสำเร็จ พุ่งไปหน้า Dashboard
      router.push('/dashboard');
    } catch (error: any) {
      setErrorMsg('อีเมลหรือรหัสผ่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4 relative overflow-hidden selection:bg-cyan-500/30">
      {/* Background Effects */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-cyan-600/20 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03] pointer-events-none"></div>

      <div className="w-full max-w-md bg-slate-800/50 backdrop-blur-2xl border border-slate-700/50 p-8 rounded-3xl shadow-2xl relative z-10 animate-fade-in">
        
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-cyan-400 rounded-2xl flex items-center justify-center shadow-[0_0_30px_rgba(34,211,238,0.3)] mb-4">
            <Database size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-cyan-400 tracking-tight">WMS<span className="text-cyan-400">PRO</span></h1>
          <p className="text-slate-400 text-sm mt-2 font-medium flex items-center gap-1.5"><ShieldCheck size={14} className="text-emerald-400"/> Secure Enterprise Access</p>
        </div>

        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/50 text-rose-400 text-sm px-4 py-3 rounded-xl mb-6 text-center font-bold animate-shake">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1 block">Email Address</label>
            <div className="relative">
              <Mail size={18} className="absolute left-4 top-3.5 text-slate-500" />
              <input 
                type="email" required
                className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder-slate-600 font-medium"
                placeholder="admin@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1 block">Password</label>
            <div className="relative">
              <Lock size={18} className="absolute left-4 top-3.5 text-slate-500" />
              <input 
                type="password" required
                className="w-full bg-slate-900/50 border border-slate-700 text-white rounded-xl pl-12 pr-4 py-3 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder-slate-600 font-medium"
                placeholder="••••••••"
                value={password} onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" disabled={loading}
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white font-bold py-3.5 rounded-xl mt-4 shadow-[0_0_20px_rgba(34,211,238,0.2)] hover:shadow-[0_0_30px_rgba(34,211,238,0.4)] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <><Activity size={18} className="animate-spin"/> Authenticating...</> : <>Login to Workspace <ArrowRight size={18}/></>}
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-slate-500">
          ระบบสงวนสิทธิ์การเข้าใช้งานเฉพาะบุคลากรที่ได้รับอนุญาตเท่านั้น
        </div>
      </div>
    </div>
  );
}