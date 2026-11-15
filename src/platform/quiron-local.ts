import { dashboardConversationFallback } from '../ai/dashboard-conversation.policy';
export function localCareReply(text: string, messages: { role: string; text: string }[], locale: 'es' | 'en') {
  const en = locale === 'en';
  const q = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const answer = dashboardConversationFallback(text, locale, messages.slice(-12).map(m => ({ role: m.role, content: m.text })));
  if (answer) return answer;
  if (/^(hola|hello|hi)[!.\s]*$/.test(q)) return en ? 'Hi. What would you like to talk about?' : 'Hola. ¿De qué te gustaría hablar?';
  if (/^(stop|basta|no quiero seguir( hablando)?|i want to stop( talking)?)[.!?\s]*$/.test(q)) return en ? 'We can stop here.' : 'Lo dejamos aquí.';
  if (/soledad|me siento sol|lonely|alone/.test(q)) return en ? 'Feeling lonely can be difficult. Would talking with someone you trust help right now?' : 'La soledad puede pesar. ¿Te ayudaría hablar un rato con alguien de confianza?';
  if (/doctor|medico|medica|psicolog|psychologist|no esta|isn.?t here|unavailable|le paso algo/.test(q)) {
    return en
      ? 'If the medic or psychologist is not available, I can stay with you as temporary support. Tell me if this is physical, emotional, or both, and how severe it feels (1–5). I will not diagnose. If breathing, chest pain, fainting, or self-harm is involved, seek a human now and alert the chief.'
      : 'Si el médico o el psicólogo no está, puedo acompañarte como apoyo temporal. Decime si es físico, emocional o ambos, y qué tan fuerte se siente (1–5). No diagnostico. Si hay falta de aire, dolor de pecho, desmayo o ideas de hacerte daño, buscá a una persona ahora y avisá al jefe.';
  }
  if (/me siento mal|feel (bad|sick|unwell)|dolor|pain|headache|no dormi|didn.?t sleep/.test(q)) {
    return en
      ? 'I am with you on this mission. Is it physical, emotional, or both? When did it start, and how did you sleep? If a medic or psychologist is aboard, we can request a visit; if not, I will help you organize next steps without a diagnosis.'
      : 'Estoy con vos en esta misión. ¿Es físico, emocional o ambos? ¿Cuándo empezó y cómo dormiste? Si hay médico o psicólogo a bordo, podemos pedir una cita; si no, te ayudo a ordenar los pasos sin diagnosticar.';
  }
  if (/por que|why|explica|explain/.test(q)) return en ? 'Let us make this clearer. We can separate what you have described from anything that would need measurements or human review.' : 'Veámoslo más claro: podemos separar lo que has contado de lo que necesitaría mediciones o revisión humana.';
  return en ? 'I can help you organize what is happening. What part would you like to focus on?' : 'Puedo ayudarte a ordenar lo que está pasando. ¿En qué parte te gustaría centrarnos?';
}
