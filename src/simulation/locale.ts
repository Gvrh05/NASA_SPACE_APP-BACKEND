import { AsyncLocalStorage } from 'node:async_hooks';
export type Lang = 'es' | 'en';
const locale = new AsyncLocalStorage<Lang>();
export function uiLang(): Lang {
  return locale.getStore() ?? 'en';
}
export function runInLocale<T>(language: unknown, operation: () => T): T {
  const selected: Lang =
    typeof language === 'string' && /^es(?:[-,;]|$)/i.test(language.trim())
      ? 'es'
      : 'en';
  return locale.run(selected, operation);
}
