"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '../../supabaseClient';
import { useRouter } from 'next/navigation';
import { 
  Settings, User, Bell, Shield, Database, Save, Building, 
  LogOut, Activity, Users, ShieldAlert, CheckCircle 
} from 'lucide-react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('profile');
  const router = useRouter();
  
  // States สำหรับข้อมูลผู้ใช้ปัจจุบัน
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [myRole, setMyRole] = useState<string>('VIEWER');

  // States สำหรับแท็บ Roles (เฉพาะ Admin)
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [updatingRole, setUpdatingRole] = useState<string | null>(null);

  useEffect(() => {
    fetchMyProfile();
  }, []);

  // 1. ดึงข้อมูลส่วนตัวของคนที่ Login อยู่
  const fetchMyProfile = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        setCurrentUser(user);
        
        // เช็คว่าคนนี้มีสิทธิ์อะไรในตาราง user_roles
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .single();
          
        const currentRole = roleData?.role || 'VIEWER';
        setMyRole(currentRole);

        // ถ้าเป็น ADMIN ให้ไปดึงข้อมูลพนักงานทั้งหมดมาเตรียมไว้
        if (currentRole === 'ADMIN') {
          fetchAllUsers();
        }
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
  };

  // 2. ดึงรายชื่อพนักงานทั้งหมด (เฉพาะ Admin)
  const fetchAllUsers = async () => {
    try {
      const { data, error } = await supabase.from('user_roles').select('*').order('created_at', { ascending: false });
      if (!error && data) {
        setAllUsers(data);
      }
    } catch (error) {
      console.error("Error fetching all users", error);
    }
  };

  // 3. ฟังก์ชันเปลี่ยนสิทธิ์พนักงาน (เฉพาะ Admin)
  const handleRoleChange = async (userId: string, newRole: string) => {
    setUpdatingRole(userId);
    try {
      const { error } = await supabase
        .from('user_roles')
        .update({ role: newRole })
        .eq('user_id', userId);

      if (error) throw error;
      
      alert('✅ อัปเดตสิทธิ์การใช้งานสำเร็จ!');
      fetchAllUsers(); // รีเฟรชตาราง
    } catch (error: any) {
      alert('❌ เกิดข้อผิดพลาด: ' + error.message);
    }
    setUpdatingRole(null);
  };

  // 4. ฟังก์ชันออกจากระบบ (Logout)
  const handleLogout = async () => {
    if (!window.confirm("ยืนยันการออกจากระบบ?")) return;
    await supabase.auth.signOut();
    router.push('/login');
  };

  if (loading) {
    return <div className="flex h-full items-center justify-center bg-slate-50"><Activity className="animate-spin text-blue-500" size={32}/></div>;
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-5 shadow-sm z-10 flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Settings className="text-slate-600" /> การตั้งค่าระบบ (Settings)
          </h1>
          <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
            จัดการข้อมูลส่วนตัวและสิทธิ์การใช้งาน 
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider text-white ${myRole === 'ADMIN' ? 'bg-fuchsia-500' : myRole === 'STAFF' ? 'bg-blue-500' : 'bg-slate-400'}`}>
              Your Role: {myRole}
            </span>
          </p>
        </div>
        <button onClick={handleLogout} className="bg-rose-50 text-rose-600 border border-rose-200 px-6 py-2 rounded-lg font-bold shadow-sm hover:bg-rose-100 flex items-center gap-2 transition-colors">
          <LogOut size={18} /> ออกจากระบบ
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Menu */}
        <div className="w-64 bg-white border-r border-slate-200 p-4 flex flex-col gap-2 z-0 shrink-0">
          <MenuButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')} icon={<User size={18} />} label="ข้อมูลส่วนตัว" />
          
          {/* ซ่อนเมนูเหล่านี้ถ้าเป็นแค่ VIEWER */}
          {myRole !== 'VIEWER' && (
            <>
              <MenuButton active={activeTab === 'warehouse'} onClick={() => setActiveTab('warehouse')} icon={<Building size={18} />} label="คลังสินค้า & สาขา" />
              <MenuButton active={activeTab === 'notifications'} onClick={() => setActiveTab('notifications')} icon={<Bell size={18} />} label="การแจ้งเตือน" />
            </>
          )}

          {/* ซ่อนเมนูจัดการ Role ถ้าไม่ใช่ ADMIN */}
          {myRole === 'ADMIN' && (
            <MenuButton active={activeTab === 'security'} onClick={() => setActiveTab('security')} icon={<Shield size={18} />} label="สิทธิ์การใช้งาน (Roles)" />
          )}
        </div>

        {/* Right Content Area */}
        <div className="flex-1 p-8 overflow-y-auto bg-slate-50 custom-scrollbar">
          <div className="max-w-4xl bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            
            {/* 🔴 TAB: PROFILE */}
            {activeTab === 'profile' && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold text-slate-800 border-b pb-4 mb-6">ข้อมูลบัญชีผู้ใช้</h2>
                <div className="space-y-6">
                  <div className="flex items-center gap-6">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-slate-200 to-slate-100 flex items-center justify-center text-slate-400 border-4 border-white shadow-md">
                      <User size={40} />
                    </div>
                    <div>
                      <div className="text-lg font-black text-slate-800">{currentUser?.email}</div>
                      <div className="text-sm text-slate-500 font-mono mt-1">User ID: {currentUser?.id.split('-')[0]}...</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-600 mb-2">อีเมล (Email)</label>
                      <input type="email" value={currentUser?.email || ''} disabled className="w-full p-3 border border-slate-200 bg-slate-50 rounded-lg text-slate-500 cursor-not-allowed" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-600 mb-2">ระดับสิทธิ์ (System Role)</label>
                      <input type="text" value={myRole} disabled className="w-full p-3 border border-slate-200 bg-slate-50 rounded-lg text-slate-500 cursor-not-allowed font-bold" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* 🔴 TAB: ROLES MANAGEMENT (เฉพาะ ADMIN) */}
            {activeTab === 'security' && myRole === 'ADMIN' && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex justify-between items-center border-b pb-4 mb-6">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Users size={20} className="text-fuchsia-500"/> จัดการสิทธิ์พนักงาน (Role Management)</h2>
                    <p className="text-xs text-slate-500 mt-1">กำหนดสิทธิ์ว่าใครสามารถเข้าถึงหน้าจอไหนได้บ้าง</p>
                  </div>
                  <button onClick={fetchAllUsers} className="text-sm font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100">Refresh Data</button>
                </div>

                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead className="bg-slate-50 text-slate-600 font-bold text-xs uppercase border-b border-slate-200">
                      <tr>
                        <th className="p-4">Email</th>
                        <th className="p-4">Join Date</th>
                        <th className="p-4">Current Role</th>
                        <th className="p-4 text-center">Change Role</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allUsers.length === 0 ? (
                        <tr><td colSpan={4} className="p-8 text-center text-slate-400">ยังไม่มีข้อมูลในตาราง user_roles</td></tr>
                      ) : allUsers.map(u => (
                        <tr key={u.user_id} className="hover:bg-slate-50 transition-colors">
                          <td className="p-4 font-bold text-slate-800">{u.email}</td>
                          <td className="p-4 text-slate-500 text-xs">{new Date(u.created_at).toLocaleDateString('th-TH')}</td>
                          <td className="p-4">
                            <span className={`text-[10px] font-black px-2.5 py-1 rounded-md uppercase tracking-wider ${
                              u.role === 'ADMIN' ? 'bg-fuchsia-100 text-fuchsia-700' : 
                              u.role === 'STAFF' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
                            }`}>
                              {u.role}
                            </span>
                          </td>
                          <td className="p-4 text-center">
                            <select 
                              disabled={updatingRole === u.user_id}
                              value={u.role}
                              onChange={(e) => handleRoleChange(u.user_id, e.target.value)}
                              className="bg-white border border-slate-300 text-slate-700 text-xs font-bold rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            >
                              <option value="ADMIN">ADMIN (เข้าได้ทุกระบบ)</option>
                              <option value="STAFF">STAFF (จัดการสต๊อกได้)</option>
                              <option value="VIEWER">VIEWER (ดูได้อย่างเดียว)</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 bg-blue-50 border border-blue-100 p-4 rounded-xl flex items-start gap-3">
                  <ShieldAlert className="text-blue-500 shrink-0 mt-0.5" size={18}/>
                  <div className="text-xs text-slate-700">
                    <strong className="font-bold block text-sm mb-1 text-blue-800">คำอธิบายระดับสิทธิ์:</strong>
                    <ul className="list-disc pl-4 space-y-1">
                      <li><b>ADMIN:</b> มีสิทธิ์สูงสุด เข้าได้ทุกเมนู รวมถึง Dev Tools และการเปลี่ยนสิทธิ์ผู้อื่น</li>
                      <li><b>STAFF:</b> สำหรับพนักงานคลัง สามารถทำ Inbound, Outbound, Cycle Count ได้</li>
                      <li><b>VIEWER:</b> สำหรับเซลส์หรือบุคคลภายนอก จะเห็นเฉพาะหน้า Dashboard, Inventory และ Branch Report เท่านั้น (กดแก้ไขไม่ได้)</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* Other Placeholder Tabs */}
            {(activeTab === 'warehouse' || activeTab === 'notifications') && (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 animate-in fade-in duration-500">
                <Settings size={48} className="opacity-20 mb-4" />
                <h3 className="text-lg font-bold text-slate-600">ฟีเจอร์กำลังอยู่ระหว่างการพัฒนา</h3>
                <p className="text-sm mt-2">ส่วนนี้จะเปิดให้ใช้งานในเวอร์ชันถัดไป</p>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// Component ย่อยสำหรับเมนูด้านซ้าย
function MenuButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${
        active 
          ? 'bg-blue-50 text-blue-700 border border-blue-100 shadow-sm' 
          : 'text-slate-600 hover:bg-slate-50'
      }`}
    >
      <div className={`${active ? 'text-blue-600' : 'text-slate-400'}`}>
        {icon}
      </div>
      {label}
    </button>
  );
}