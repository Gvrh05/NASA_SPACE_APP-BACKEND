import { computePrepPercent, prepItemProgress } from './seed'
import type { PrepItem } from './types'

function item(partial: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return {
    missionId: 'm1',
    category: 'higiene',
    description: '',
    source: 'test',
    ownerProfileId: null,
    qtyRequired: null,
    qtyAvailable: null,
    critical: false,
    status: 'pendiente_revision',
    evidence: '',
    verifiedBy: null,
    verifiedAt: null,
    applies: true,
    updatedAt: 1,
    ...partial,
  }
}

describe('prep percent with partial quantities', () => {
  it('counts have/need for quantity items', () => {
    const hygiene = item({
      id: 'h',
      title: 'Higiene',
      qtyRequired: 36,
      qtyAvailable: 18,
    })
    expect(prepItemProgress(hygiene)).toBe(0.5)
    const rows = [
      hygiene,
      item({
        id: 'c',
        title: 'Comms',
        status: 'cargado_verificado',
      }),
    ]
    // 0.5 + 1 = 1.5 / 2 = 75%
    expect(computePrepPercent(rows)).toBe(75)
  })

  it('caps at 100% when have exceeds need', () => {
    expect(
      prepItemProgress(
        item({ id: 'h', title: 'H', qtyRequired: 10, qtyAvailable: 40 }),
      ),
    ).toBe(1)
  })
})
