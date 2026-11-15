import { z } from 'zod';
import { parse } from './contracts';

/** Identificador de sesión de demostración. No autentica a una persona. */
export function session(value: unknown): string {
  return parse(z.uuid(), value);
}
