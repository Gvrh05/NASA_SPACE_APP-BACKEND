import { dashboardConversationFallback } from '../ai/dashboard-conversation.policy';
export function localCareReply(text: string, messages: { role: string; text: string }[], locale: 'es' | 'en') {
  const en = locale === 'en';
  const q = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const answer = dashboardConversationFallback(text, locale, messages.slice(-12).map(m => ({ role: m.role, content: m.text })));
  if (answer) return answer;
  if (/^(hola|hello|hi)[!.\s]*$/.test(q)) return en ? 'Hi. What would you like to talk about?' : 'Hola. ¿De qué te gustaría hablar?';
  if (/^(stop|basta|no quiero seguir( hablando)?|i want to stop( talking)?)[.!?\s]*$/.test(q)) return en ? 'We can stop here.' : 'Lo dejamos aquí.';
  if (/soledad|me siento sol|lonely|alone/.test(q)) return en ? 'Feeling lonely can be difficult. Would talking with someone you trust help right now?' : 'La soledad puede pesar. ¿Te ayudaría hablar un rato con alguien de confianza?';
  if (/por que|why|explica|explain/.test(q)) return en ? 'Let us make this clearer. We can separate what you have described from anything that would need measurements or human review.' : 'Veámoslo más claro: podemos separar lo que has contado de lo que necesitaría mediciones o revisión humana.';
  return en ? 'I can help you organize what is happening. What part would you like to focus on?' : 'Puedo ayudarte a ordenar lo que está pasando. ¿En qué parte te gustaría centrarnos?';
}
