import { AsyncLocalStorage } from 'node:async_hooks';
export type Lang = 'es' | 'en';
const locale = new AsyncLocalStorage<Lang>();
export function uiLang(): Lang {
  return locale.getStore() ?? 'es';
}
export function runInLocale<T>(language: unknown, operation: () => T): T {
  const selected: Lang =
    typeof language === 'string' && /^en(?:[-,;]|$)/i.test(language.trim())
      ? 'en'
      : 'es';
  return locale.run(selected, operation);
}
