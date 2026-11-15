import { authorizedCareHistory } from './care-memory'

describe('authorized care memory', () => {
  it('prepends same-mode longitudinal notes and stays inside the history budget', () => {
    const current = Array.from({ length: 14 }, (_, index) => ({
      role: index % 2 ? 'assistant' as const : 'user' as const,
      content: `turn ${index}`,
    }))
    const history = authorizedCareHistory(current, ['LONGITUDINAL-HEADACHE', '   '])
    expect(history.length).toBeLessThanOrEqual(12)
    expect(history[0].content).toContain('LONGITUDINAL-HEADACHE')
    expect(history.at(-1)?.content).toBe('turn 13')
    expect(Buffer.byteLength(JSON.stringify(history), 'utf8')).toBeLessThanOrEqual(12000)
  })

  it('keeps the recent thread when there is no older authorized report', () => {
    expect(authorizedCareHistory([{ role: 'user', content: 'hola' }], [])).toEqual([
      { role: 'user', content: 'hola' },
    ])
  })
})
