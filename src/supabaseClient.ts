import { createClient } from '@supabase/supabase-js';

// URL และ Key จากโปรเจกต์ Supabase ของคุณ
const supabaseUrl: string = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://okjebyljswrnhvjicmsy.supabase.co';
const supabaseKey: string = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9ramVieWxqc3dybmh2amljbXN5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDAwMDQ0MzIsImV4cCI6MjA1NTU4MDQzMn0.n-P0eX1_3H_Y71d-5T7V7bYt11S8F_H7YtE-Otz_m8c';

// สร้างและส่งออก Supabase Client
export const supabase = createClient(supabaseUrl, supabaseKey);