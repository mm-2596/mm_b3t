import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = !!(
  supabaseUrl &&
  supabaseUrl.startsWith('http') &&
  supabaseAnonKey &&
  supabaseAnonKey.length > 10
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: ReturnType<typeof createBrowserClient<any>> = isSupabaseConfigured
  ? createBrowserClient(supabaseUrl, supabaseAnonKey)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  : (null as any)
