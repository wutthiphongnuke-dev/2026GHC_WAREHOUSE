"use client";

import { Inter } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter, usePathname } from 'next/navigation';
// ⚠️ ตรวจสอบ Path ของ supabase ให้ตรงกับโปรเจกต์ของคุณ
import { supabase } from "../supabaseClient"; 
import { 
  Database, Activity, Package, PackagePlus, Truck, Settings, 
  Search, Bell, User, History, X, AlertTriangle, Users, QrCode, BrainCircuit, RefreshCw, Menu, Store 
} from "lucide-react";

const inter = Inter({ subsets: ["latin"] });

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  
  // 🟢 เพิ่ม State สำหรับเก็บ Role
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{products: any[], vendors: any[]}>({ products: [], vendors: [] });
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const [notifications, setNotifications] = useState<any[]>([]);
  const [totalAlerts, setTotalAlerts] = useState<number>(0); 
  const [showNotif, setShowNotif] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  // --- 🛡️ เช็คสถานะการเข้าสู่ระบบ & ดึงสิทธิ์ (Role) ---
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session && pathname !== '/login') {
        router.push('/login');
      } else if (session) {
        setIsAuthenticated(true);
        
        // 🟢 ดึง Role จาก Database
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .single();
          
        const role = roleData?.role || 'VIEWER';
        setUserRole(role);

        // 🔴 Route Protection: บล็อคการเข้าหน้าเว็บตามสิทธิ์
        if (role === 'VIEWER') {
          // VIEWER ห้ามเข้าหน้าเหล่านี้
          const blockedForViewer = ['/inbound', '/outbound', '/transactions', '/cycle-count', '/print-labels', '/planning', '/dev-tools'];
          if (blockedForViewer.some(route => pathname.startsWith(route))) {
            router.push('/dashboard'); // เตะกลับ Dashboard
          }
        } else if (role === 'STAFF') {
          // STAFF ห้ามเข้า Dev Tools
          if (pathname.startsWith('/dev-tools')) {
            router.push('/dashboard');
          }
        }
      }
    };
    
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session && pathname !== '/login') {
        router.push('/login');
      }
    });

    return () => subscription.unsubscribe();
  }, [pathname, router]);

  // --- ปิด Dropdown เมื่อคลิกที่อื่น ---
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) setShowSearchDropdown(false);
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) setShowNotif(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // --- 🔔 ระบบแจ้งเตือน (โหลดเฉพาะตอน Login แล้ว) ---
  useEffect(() => {
    if (!isAuthenticated) return;

    const fetchNotifs = async () => {
      try {
        const { data: prods } = await supabase.from('master_products').select('product_id, product_name, min_stock, status').eq('status', 'ACTIVE');
        const { data: lots } = await supabase.from('inventory_lots').select('product_id, quantity');
        
        const stockMap: any = {};
        (lots || []).forEach(l => stockMap[l.product_id] = (stockMap[l.product_id] || 0) + Number(l.quantity));

        const alerts = (prods || [])
            .filter(p => (stockMap[p.product_id] || 0) <= (p.min_stock || 0))
            .map(p => ({
                id: p.product_id, 
                title: 'Low Stock Warning', 
                message: `สินค้า ${p.product_id} (${p.product_name}) เหลือ ${stockMap[p.product_id] || 0} ชิ้น (เกณฑ์ ${p.min_stock})`, 
                type: 'WARNING'
            }));
        
        setTotalAlerts(alerts.length);
        setNotifications(alerts.slice(0, 20)); 
      } catch (error) { console.error(error); }
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 300000);
    return () => clearInterval(interval);
  }, [isAuthenticated]);

  // --- 🔍 ระบบ Deep Search ---
  useEffect(() => {
    if (!searchQuery.trim() || !isAuthenticated) {
      setSearchResults({ products: [], vendors: [] });
      setIsSearching(false);
      return;
    }
    
    const delayDebounce = setTimeout(async () => {
      setIsSearching(true);
      try {
        const term = `%${searchQuery}%`;
        const [prodRes, vendRes] = await Promise.all([
          supabase.from('master_products').select('product_id, product_name').or(`product_id.ilike.${term},product_name.ilike.${term}`).limit(5),
          supabase.from('master_vendors').select('vendor_id, vendor_name').or(`vendor_id.ilike.${term},vendor_name.ilike.${term}`).limit(3)
        ]);
        setSearchResults({ products: prodRes.data || [], vendors: vendRes.data || [] });
      } catch (error) { console.error(error); }
      setIsSearching(false);
    }, 400); 

    return () => clearTimeout(delayDebounce);
  }, [searchQuery, isAuthenticated]);

  useEffect(() => {
    if (isMobileMenuOpen) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = 'unset';
    return () => { document.body.style.overflow = 'unset'; }
  }, [isMobileMenuOpen]);

  const isLoginPage = pathname === '/login';

  // 🟢 รอโหลด Role ให้เสร็จก่อนโชว์หน้าเว็บ (ป้องกันเว็บกระพริบเห็นเมนูที่ไม่มีสิทธิ์)
  if ((isAuthenticated === null || (isAuthenticated && !userRole)) && !isLoginPage) {
      return (
        <html lang="en">
          <body className="bg-slate-900 flex items-center justify-center h-screen">
            <div className="animate-pulse text-cyan-500 font-bold flex flex-col items-center gap-3">
               <Database size={32} className="animate-bounce" />
               <span className="tracking-widest uppercase text-sm">Checking Permissions...</span>
            </div>
          </body>
        </html>
      );
  }

  return (
    <html lang="en">
      <body className={`${inter.className} ${isLoginPage ? 'bg-slate-900' : 'bg-slate-50'} text-slate-900 font-sans selection:bg-cyan-200 h-screen flex flex-col overflow-hidden`}>
        
        {!isLoginPage && (
          <header className="absolute top-2 sm:top-4 left-2 sm:left-4 right-2 sm:right-4 z-50 animate-fade-in">
            <nav className="mx-auto w-full max-w-[1920px] bg-slate-950/85 backdrop-blur-xl border border-white/10 shadow-[0_8px_30px_rgba(0,0,0,0.25)] hover:shadow-[0_8px_40px_rgba(34,211,238,0.2)] transition-shadow duration-500 rounded-2xl px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2 sm:gap-4 relative">
              
              <Link href="/" className="flex items-center gap-2 sm:gap-3 group shrink-0">
                <div className="relative flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.5)] group-hover:shadow-[0_0_25px_rgba(34,211,238,0.8)] transition-all duration-300">
                  <Database size={18} className="text-white relative z-10 sm:w-5 sm:h-5" />
                </div>
                <div className="flex flex-col hidden sm:flex">
                  <span className="font-black text-lg sm:text-xl tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-200 to-cyan-300 drop-shadow-sm">WMS<span className="text-cyan-400">PRO</span></span>
                  <span className="text-[8px] sm:text-[9px] text-cyan-400/80 font-mono tracking-widest uppercase flex items-center gap-1"><div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>Live System</span>
                </div>
              </Link>

              {/* 🟢 เมนูตรงกลาง (ซ่อนตาม Role) */}
              <div className="hidden lg:flex items-center gap-1 flex-1 justify-start xl:justify-center overflow-x-auto whitespace-nowrap px-2 scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden mask-image-fade">
                
                <NavItem href="/dashboard" icon={<Activity size={16} />} label="Dashboard" />           
                <NavItem href="/warehouse" icon={<Package size={16} />} label="Inventory" />
                
                {/* 🔴 ซ่อนจาก VIEWER */}
                {userRole !== 'VIEWER' && (
                  <>
                    <NavItem href="/inbound" icon={<PackagePlus size={16} />} label="Inbound" />
                    <NavItem href="/outbound" icon={<Truck size={16} />} label="Outbound" />
                    <NavItem href="/transactions" icon={<History size={16} />} label="Logs" />
                  </>
                )}
                
                <div className="w-[1px] h-5 bg-slate-700/50 mx-2 shrink-0"></div>

                <NavItem href="/branch-report" icon={<Store size={16} />} label="Branch Report" />
                
                {/* 🔴 ซ่อนจาก VIEWER */}
                {userRole !== 'VIEWER' && (
                  <>
                    <NavItem href="/cycle-count" icon={<RefreshCw size={16} />} label="Cycle Count" />
                    <NavItem href="/print-labels" icon={<QrCode size={16} />} label="Labels" />
                    <NavItem href="/planning" icon={<BrainCircuit size={16} />} label="Planning" />
                  </>
                )}

                {/* 🔴 โชว์ให้ ADMIN คนเดียวเท่านั้น */}
                {userRole === 'ADMIN' && (
                  <>
                    <div className="w-[1px] h-5 bg-slate-700/50 mx-2 shrink-0"></div>
                    <NavItem href="/dev-tools" icon={<Settings size={16} />} label="Dev Tools" isDev />
                  </>
                )}
              </div>

              {/* 3. เครื่องมือเสริมด้านขวา */}
              <div className="flex items-center gap-1 sm:gap-4 shrink-0">
                
                {/* 🔍 GLOBAL SEARCH */}
                <div className="relative hidden xl:block group" ref={searchRef}>
                  <Search size={16} className={`absolute left-3 top-2.5 transition-colors ${showSearchDropdown ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <input 
                    type="text" placeholder="ค้นหา รหัส, คู่ค้า..." 
                    className="bg-slate-900/60 border border-slate-700 text-slate-200 text-sm rounded-full pl-9 pr-4 py-2 w-64 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all placeholder-slate-500"
                    value={searchQuery}
                    onChange={(e) => { setSearchQuery(e.target.value); setShowSearchDropdown(true); }}
                    onFocus={() => setShowSearchDropdown(true)}
                  />
                  {showSearchDropdown && searchQuery && (
                    <div className="absolute top-full right-0 mt-4 w-[380px] bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-50">
                       <div className="p-3 bg-slate-50 border-b text-xs font-bold text-slate-500 uppercase flex justify-between items-center">
                          <span>Search Results</span>
                          {isSearching && <span className="text-cyan-600 flex items-center gap-1"><Activity size={12} className="animate-spin"/> Searching...</span>}
                       </div>
                       <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
                          {(!isSearching && searchResults.products.length === 0 && searchResults.vendors.length === 0) && (
                              <div className="p-6 text-center text-slate-400 text-sm">ไม่พบข้อมูลที่ตรงกับ <span className="font-bold text-slate-600">"{searchQuery}"</span></div>
                          )}
                          {searchResults.products.length > 0 && (
                              <div className="mb-2">
                                  {searchResults.products.map(p => (
                                      <Link href={`/product/${encodeURIComponent(p.product_id)}`} key={p.product_id} onClick={()=>setShowSearchDropdown(false)} className="flex items-center gap-3 p-3 hover:bg-cyan-50 rounded-xl transition-colors cursor-pointer group/item">
                                          <div className="p-2 bg-slate-100 rounded-lg group-hover/item:bg-cyan-100 group-hover/item:text-cyan-600"><Package size={16}/></div>
                                          <div><div className="text-sm font-bold text-slate-800">{p.product_id}</div><div className="text-xs text-slate-500">{p.product_name}</div></div>
                                      </Link>
                                  ))}
                              </div>
                          )}
                       </div>
                    </div>
                  )}
                </div>

                {/* 🔔 NOTIFICATION BELL */}
                <div className="relative" ref={notifRef}>
                  <button onClick={() => setShowNotif(!showNotif)} className={`relative p-2 transition-colors group ${showNotif ? 'text-cyan-400' : 'text-slate-400 hover:text-cyan-300'}`}>
                    <Bell size={20} className={notifications.length > 0 ? 'animate-bounce text-orange-400' : ''}/>
                    {totalAlerts > 0 && <span className="absolute top-1 right-1 w-2.5 h-2.5 sm:w-3 sm:h-3 bg-red-500 border-2 border-slate-950 rounded-full"></span>}
                  </button>
                  {showNotif && (
                    <div className="absolute top-full right-0 mt-4 w-72 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden z-50">
                        <div className="p-4 bg-slate-50 border-b flex justify-between items-center">
                            <span className="text-sm font-bold text-slate-800 flex items-center gap-2"><Bell size={16} className="text-cyan-600"/> System Alerts</span>
                        </div>
                        <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                            {notifications.length === 0 ? (
                                <div className="p-10 text-center text-slate-400"><span className="text-sm font-bold">ไม่มีการแจ้งเตือนใหม่</span></div>
                            ) : (
                                notifications.map((n, i) => (
                                    <Link href={`/product/${encodeURIComponent(n.id)}`} key={i} onClick={()=>setShowNotif(false)} className="p-3 sm:p-4 border-b border-slate-100 hover:bg-orange-50 cursor-pointer transition-colors flex gap-3 items-start block">
                                        <div className="p-2 bg-orange-100 text-orange-600 rounded-full shrink-0 mt-1"><AlertTriangle size={14}/></div>
                                        <div>
                                            <div className="text-xs sm:text-sm font-bold text-slate-800">{n.title}</div>
                                            <div className="text-[10px] sm:text-xs text-slate-600 mt-1">{n.message}</div>
                                        </div>
                                    </Link>
                                ))
                            )}
                        </div>
                    </div>
                  )}
                </div>

                <div className="hidden sm:block w-[1px] h-6 bg-slate-700/50"></div>

                {/* USER PROFILE */}
                <Link href="/settings" className="hidden sm:flex items-center gap-3 group cursor-pointer">
                  <div className="text-right hidden md:block">
                    <div className="text-sm font-bold text-cyan-400 transition-colors uppercase tracking-widest">{userRole}</div>
                  </div>
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center border-2 border-slate-800 group-hover:border-cyan-500 transition-colors shadow-sm shrink-0">
                    <User size={16} className="text-slate-300 group-hover:text-white" />
                  </div>
                </Link>

                <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 lg:hidden text-slate-400 hover:text-cyan-400 transition-colors shrink-0 z-50 relative">
                    {isMobileMenuOpen ? <X size={24} className="text-white"/> : <Menu size={24} />}
                </button>

              </div>
            </nav>

            {/* --- MOBILE DROPDOWN (ซ่อนตาม Role ด้วย) --- */}
            {isMobileMenuOpen && (
                <>
                  <div className="fixed inset-0 bg-slate-950/40 backdrop-blur-sm z-40 lg:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>
                  <div className="lg:hidden absolute top-full left-2 right-2 sm:left-4 sm:right-4 mt-2 bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl p-4 flex flex-col gap-1.5 z-50 max-h-[75vh] overflow-y-auto">
                        <>
                            <div className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest px-2 pb-1 mt-1">Core Operations</div>
                            <MobileNavItem href="/dashboard" icon={<Activity size={18}/>} label="Dashboard" onClick={() => setIsMobileMenuOpen(false)}/>
                            <MobileNavItem href="/warehouse" icon={<Package size={18}/>} label="Inventory" onClick={() => setIsMobileMenuOpen(false)}/>
                            
                            {userRole !== 'VIEWER' && (
                              <>
                                <MobileNavItem href="/inbound" icon={<PackagePlus size={18}/>} label="Inbound" onClick={() => setIsMobileMenuOpen(false)}/>
                                <MobileNavItem href="/outbound" icon={<Truck size={18}/>} label="Outbound" onClick={() => setIsMobileMenuOpen(false)}/>
                                <MobileNavItem href="/transactions" icon={<History size={18}/>} label="Logs" onClick={() => setIsMobileMenuOpen(false)}/>
                              </>
                            )}
                            
                            <div className="h-px bg-slate-800/60 my-2 mx-2"></div>
                            
                            <div className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest px-2 pb-1">Reports & Tools</div>
                            <MobileNavItem href="/branch-report" icon={<Store size={18}/>} label="Branch Report" onClick={() => setIsMobileMenuOpen(false)}/>
                            
                            {userRole !== 'VIEWER' && (
                              <>
                                <MobileNavItem href="/cycle-count" icon={<RefreshCw size={18}/>} label="Cycle Count" onClick={() => setIsMobileMenuOpen(false)}/>
                                <MobileNavItem href="/print-labels" icon={<QrCode size={18}/>} label="Labels" onClick={() => setIsMobileMenuOpen(false)}/>
                                <MobileNavItem href="/planning" icon={<BrainCircuit size={18}/>} label="Planning" onClick={() => setIsMobileMenuOpen(false)}/>
                              </>
                            )}

                            <div className="h-px bg-slate-800/60 my-2 mx-2"></div>

                            <div className="text-[10px] font-bold text-cyan-500 uppercase tracking-widest px-2 pb-1">System</div>
                            <MobileNavItem href="/settings" icon={<User size={18}/>} label="Profile & Settings" onClick={() => setIsMobileMenuOpen(false)}/>
                            
                            {userRole === 'ADMIN' && (
                              <MobileNavItem href="/dev-tools" icon={<Settings size={18}/>} label="Dev Tools" isDev onClick={() => setIsMobileMenuOpen(false)}/>
                            )}
                        </>
                  </div>
                </>
            )}
          </header>
        )}

        {/* --- Main Content Area --- */}
        <main className={`flex-1 w-full flex flex-col overflow-hidden ${isLoginPage ? 'p-0' : 'pt-[72px] sm:pt-[88px] pb-2 sm:pb-4 px-2 sm:px-4'}`}>
          <div className={`flex-1 overflow-hidden relative ${isLoginPage ? 'bg-transparent' : 'bg-white rounded-2xl shadow-sm border border-slate-200'}`}>
            {children}
          </div>
        </main>

        <style dangerouslySetInnerHTML={{__html: `
          .mask-image-fade { mask-image: linear-gradient(to right, black 90%, transparent 100%); -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%); }
        `}} />
      </body>
    </html>
  );
}

function NavItem({ href, icon, label, isDev = false }: { href: string, icon: React.ReactNode, label: string, isDev?: boolean }) {
  return (
    <Link href={href} className="group relative px-3 py-2 rounded-xl flex items-center gap-1.5 overflow-hidden transition-all duration-300 hover:bg-white/5 shrink-0">
      <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-r ${isDev ? 'from-fuchsia-500/10 to-pink-500/10' : 'from-cyan-500/10 to-blue-500/10'}`}></div>
      <div className={`absolute bottom-0 left-1/2 -translate-x-1/2 w-0 h-[2px] opacity-0 group-hover:w-full group-hover:opacity-100 transition-all duration-300 ease-out shadow-[0_0_8px_rgba(255,255,255,0.8)] ${isDev ? 'bg-fuchsia-400' : 'bg-cyan-400'}`}></div>
      <div className={`relative z-10 flex items-center gap-1.5 ${isDev ? 'text-slate-400 group-hover:text-fuchsia-300' : 'text-slate-400 group-hover:text-cyan-300'} transition-colors duration-300`}>
        <div className={`transition-transform duration-300 group-hover:scale-110 ${isDev ? 'group-hover:drop-shadow-[0_0_8px_rgba(232,121,249,0.8)]' : 'group-hover:drop-shadow-[0_0_8px_rgba(34,211,238,0.8)]'}`}>{icon}</div>
        <span className="text-[13px] font-semibold tracking-wide">{label}</span>
      </div>
    </Link>
  );
}

function MobileNavItem({ href, icon, label, isDev = false, onClick }: any) {
    return (
        <Link href={href} onClick={onClick} className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-200 ${isDev ? 'text-fuchsia-400 hover:bg-fuchsia-500/10 hover:pl-4' : 'text-slate-300 hover:text-cyan-400 hover:bg-cyan-500/10 hover:pl-4'}`}>
            <div className={`${isDev ? 'text-fuchsia-400' : 'text-cyan-500'}`}>{icon}</div>
            <span className="font-bold text-sm tracking-wide">{label}</span>
        </Link>
    );
}