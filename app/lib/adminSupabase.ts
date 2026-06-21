import { createClient } from '@supabase/supabase-js';

/**
 * Server‑only Supabase client with Service Role privileges.
 * Loaded only in API routes or server‑side code (never exported to client bundles).
 */
export function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for admin actions');
  }
  return createClient(url, serviceKey);
}

export type AdminClient = ReturnType<typeof adminSupabase>;
