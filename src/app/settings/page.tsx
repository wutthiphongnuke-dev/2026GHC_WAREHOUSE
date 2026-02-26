"use client";

import React, { useState } from 'react';
import { Settings, User, Bell, Shield, Database, Save, Building } from 'lucide-react';

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('profile');

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-5 shadow-sm z-10 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Settings className="text-slate-600" /> การตั้งค่าระบบ (Settings)
          </h1>
          <p className="text-sm text-slate-500 mt-1">จัดการข้อมูลส่วนตัว สิทธิ์การใช้งาน และการตั้งค่าคลังสินค้า</p>
        </div>
        <button className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold shadow hover:bg-blue-700 flex items-center gap-2 transition-colors">
          <Save size={18} /> บันทึกการตั้งค่า
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar Menu */}
        <div className="w-64 bg-white border-r border-slate-200 p-4 flex flex-col gap-2 z-0">
          <MenuButton 
            active={activeTab === 'profile'} 
            onClick={() => setActiveTab('profile')} 
            icon={<User size={18} />} 
            label="ข้อมูลส่วนตัว" 
          />
          <MenuButton 
            active={activeTab === 'warehouse'} 
            onClick={() => setActiveTab('warehouse')} 
            icon={<Building size={18} />} 
            label="คลังสินค้า & สาขา" 
          />
          <MenuButton 
            active={activeTab === 'notifications'} 
            onClick={() => setActiveTab('notifications')} 
            icon={<Bell size={18} />} 
            label="การแจ้งเตือน" 
          />
          <MenuButton 
            active={activeTab === 'security'} 
            onClick={() => setActiveTab('security')} 
            icon={<Shield size={18} />} 
            label="สิทธิ์การใช้งาน (Roles)" 
          />
        </div>

        {/* Right Content Area */}
        <div className="flex-1 p-8 overflow-y-auto bg-slate-50">
          <div className="max-w-3xl bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
            
            {activeTab === 'profile' && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold text-slate-800 border-b pb-4 mb-6">ข้อมูลบัญชีผู้ใช้</h2>
                <div className="space-y-6">
                  <div className="flex items-center gap-6">
                    <div className="w-24 h-24 rounded-full bg-slate-200 flex items-center justify-center text-slate-400 border-4 border-white shadow-md">
                      <User size={40} />
                    </div>
                    <div>
                      <button className="px-4 py-2 bg-white border border-slate-300 rounded-lg text-sm font-bold text-slate-700 hover:bg-slate-50">เปลี่ยนรูปโปรไฟล์</button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-bold text-slate-600 mb-2">ชื่อ - นามสกุล</label>
                      <input type="text" defaultValue="Admin User" className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-600 mb-2">อีเมล</label>
                      <input type="email" defaultValue="admin@supabasewms.com" className="w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-600 mb-2">แผนก</label>
                      <input type="text" defaultValue="Warehouse Management" disabled className="w-full p-3 border border-slate-200 bg-slate-100 rounded-lg text-slate-500 cursor-not-allowed" />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'warehouse' && (
              <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                <h2 className="text-xl font-bold text-slate-800 border-b pb-4 mb-6">ตั้งค่าคลังสินค้าหลัก</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-2">รหัสคลังหลัก (Default Warehouse)</label>
                    <input type="text" defaultValue="H0013" className="w-full p-3 border border-slate-300 rounded-lg outline-none" />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-600 mb-2">ชื่อคลังหลัก</label>
                    <input type="text" defaultValue="Central Warehouse/Logistic" className="w-full p-3 border border-slate-300 rounded-lg outline-none" />
                  </div>
                  <div className="pt-4">
                    <button className="text-blue-600 font-bold text-sm hover:underline flex items-center gap-1">
                      + เพิ่มสาขาใหม่ (Add New Branch)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {(activeTab === 'notifications' || activeTab === 'security') && (
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
          ? 'bg-blue-50 text-blue-700 border border-blue-100' 
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