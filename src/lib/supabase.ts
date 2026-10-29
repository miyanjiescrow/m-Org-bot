/**
 * Supabase Client Initialization & Resilience Layer
 * Safe execution with graceful in-memory fallback
 */
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = (process.env.SUPABASE_URL || '').trim();
const supabaseKey = (process.env.SUPABASE_KEY || '').trim();

let client: SupabaseClient | null = null;
let isConfigured = false;

if (supabaseUrl && supabaseKey) {
  try {
    client = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    isConfigured = true;
    console.log('✅ Supabase client initialized successfully.');
  } catch (err: any) {
    console.error('⚠️ Failed to initialize Supabase client:', err.message);
    client = null;
    isConfigured = false;
  }
} else {
  console.info('ℹ️ Supabase credentials not set in environment. Running with high-performance in-memory database store.');
}

export const supabase = client;
export const isSupabaseConfigured = (): boolean => isConfigured && client !== null;
