import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { PlatformDb } from './types'

const TABLE = 'helios_platform_state'
const ROW_ID = 'current'

export type RemoteSnapshot = {
  revision: number
  payload: { version?: number; db: PlatformDb }
}

/** Service role stays on the server. Jest never talks to Supabase. */
export function platformRemoteEnabled(): boolean {
  if (process.env.JEST_WORKER_ID) return false
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())
}

function client(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Supabase no está configurado para la plataforma')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export async function pullPlatformSnapshot(): Promise<RemoteSnapshot | null> {
  const { data, error } = await client()
    .from(TABLE)
    .select('revision,payload')
    .eq('id', ROW_ID)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const payload = data.payload as RemoteSnapshot['payload'] | null
  if (!payload?.db) return null
  return { revision: Number(data.revision) || 0, payload }
}

export async function pushPlatformSnapshot(revision: number, version: number, db: PlatformDb): Promise<void> {
  const { error } = await client().from(TABLE).upsert(
    {
      id: ROW_ID,
      revision,
      payload: { version, db },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(error.message)
}
