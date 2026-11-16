import { randomBytes } from 'node:crypto'
import type { PrepItem } from './types'

/** Avance 0–1 de un ítem: con cantidad usa tengo/requerido; sin cantidad, check binario. */
export function prepItemProgress(item: PrepItem): number {
  if (!item.applies || item.status === 'no_aplica') return 0
  if (item.qtyRequired != null && item.qtyRequired > 0) {
    const have = Math.max(0, Number(item.qtyAvailable ?? 0))
    return Math.min(1, have / item.qtyRequired)
  }
  return item.status === 'cargado_verificado' ? 1 : 0
}

export function computePrepPercent(items: PrepItem[]): number {
  const applicable = items.filter((item) => item.applies && item.status !== 'no_aplica')
  if (applicable.length === 0) return 0
  const sum = applicable.reduce((acc, item) => acc + prepItemProgress(item), 0)
  return Math.round((sum / applicable.length) * 1000) / 10
}

export function isPrepItemComplete(item: PrepItem): boolean {
  return prepItemProgress(item) >= 1
}

export function nid(): string {
  return randomBytes(8).toString('hex')
}
