import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const effectiveSupabaseUrl = isSupabaseConfigured ? supabaseUrl : 'http://localhost:54321';
const effectiveSupabaseAnonKey = isSupabaseConfigured ? supabaseAnonKey : 'public-anon-key-placeholder';

export const supabase = createClient(effectiveSupabaseUrl, effectiveSupabaseAnonKey);
