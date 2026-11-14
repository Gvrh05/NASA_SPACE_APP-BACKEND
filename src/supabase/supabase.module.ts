import { Controller, Get, Module } from '@nestjs/common'

@Controller('api/supabase')
export class SupabaseController {
  @Get('health')
  async health() {
    const url = process.env.SUPABASE_URL?.trim() ?? null
    const key = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() ?? null
    if (!url || !key) {
      return {
        configured: false,
        ok: false,
        message: 'Faltan SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY en el .env del backend.',
      }
    }
    let host: string | null = null
    try {
      host = new URL(url).host
    } catch {
      return { configured: true, ok: false, message: 'SUPABASE_URL inválida.' }
    }
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/health`, {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.timeout(8000),
      })
      return {
        configured: true,
        ok: response.ok,
        host,
        status: response.status,
        hasDbPassword: Boolean(process.env.SUPABASE_DB_PASSWORD),
        message: response.ok
          ? 'Supabase alcanzable. La simulación HELIOS sigue en Nest/IndexedDB hasta migrar tablas.'
          : 'Supabase respondió con error; revisá la URL y la publishable key.',
      }
    } catch {
      return {
        configured: true,
        ok: false,
        host,
        hasDbPassword: Boolean(process.env.SUPABASE_DB_PASSWORD),
        message: 'No se pudo contactar Supabase desde Nest.',
      }
    }
  }
}

@Module({ controllers: [SupabaseController] })
export class SupabaseModule {}
