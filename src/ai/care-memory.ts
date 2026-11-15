type Turn = { role: 'user' | 'assistant'; content: string }

const PREFIX = 'Earlier authorized reports from this person in the same care mode: '

/** Recent turns plus a short digest of older same-mode reports. Empty unless the caller already checked consent. */
export function authorizedCareHistory(current: Turn[], priorLines: string[]): Turn[] {
  const history = current.slice(-12).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, 2000),
  }))
  const prior = priorLines.map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(-6)
  if (prior.length) {
    history.unshift({ role: 'user', content: `${PREFIX}${prior.join(' · ')}`.slice(0, 2000) })
    while (history.length > 12) history.splice(1, 1)
  }
  while (history.length && Buffer.byteLength(JSON.stringify(history), 'utf8') > 12000) {
    if (history.length > 1 && history[0]?.content.startsWith(PREFIX)) history.splice(1, 1)
    else history.shift()
  }
  return history
}
