import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  // ดึงค่า URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  
  // ดึงค่า Key (ทำ Fallback ให้รองรับทั้ง 2 ชื่อ เผื่อตั้งชื่อใน .env ไว้แบบไหนก็ใช้ได้หมด)
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;

  // ตรวจสอบว่ามีค่าครบไหม ถ้าไม่ครบให้แจ้งเตือนชัดเจนแทนการ Error แดง
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL or Key is missing. Please check your .env.local file.');
  }

  // ส่งคืนค่า Client ของ @supabase/ssr
  return createBrowserClient(supabaseUrl, supabaseKey);
}