import { createHmac } from 'node:crypto';
import { createInitialState } from '../simulation/domain/scenarios';
import { ingestLinkPacket, signedPacket } from '../simulation/domain/messages';
import { canonicalPacket, DEMO_MAC_KEY } from '../simulation/shared/mac';
import { latestReliable } from '../simulation/domain/selectors';

function fixture() {
  const state = createInitialState('baseline');
  const packet = signedPacket({
    messageId: 'security-packet',
    sequence: state.lastInboundSequence + 1,
    crewId: 'elena-torres',
    sensorId: 'security-sensor',
    kind: 'heart_rate',
    value: 70,
    measuredAt: state.clock.simulatedAt,
    receivedAt: state.clock.simulatedAt,
    signalQuality: 100,
    context: 'routine',
  });
  return { state, packet };
}
describe('telemetry integrity regression', () => {
  it('matches HMAC-SHA256 v2 and accepts a valid packet', () => {
    const { state, packet } = fixture();
    expect(canonicalPacket(packet)).toContain('v2');
    expect(packet.mac).toBe(
      createHmac('sha256', DEMO_MAC_KEY)
        .update(canonicalPacket(packet))
        .digest('hex'),
    );
    expect(ingestLinkPacket(state, packet).measurements).toHaveLength(
      state.measurements.length + 1,
    );
  });
  it.each(['value', 'measuredAt', 'messageId', 'sensorId'] as const)(
    'detects a changed %s and records a rejection',
    (field) => {
      const { state, packet } = fixture();
      const changed = {
        value: 71,
        measuredAt: packet.measuredAt - 1,
        messageId: 'changed-message',
        sensorId: 'changed-sensor',
      };
      const next = ingestLinkPacket(state, {
        ...packet,
        [field]: changed[field],
      });
      expect(next.measurements).toEqual(state.measurements);
      expect(next.rejected.at(-1)?.reason).toBe('altered');
    },
  );
  it('prevents duplicate measurements and invalid sequence acceptance', () => {
    const { state, packet } = fixture();
    const accepted = ingestLinkPacket(state, packet);
    const duplicate = ingestLinkPacket(accepted, packet);
    expect(duplicate.measurements).toEqual(accepted.measurements);
    expect(duplicate.rejected.at(-1)?.reason).toBe('duplicate');
    const reordered = signedPacket({
      ...packet,
      messageId: 'other-message',
      mac: undefined,
    });
    const next = ingestLinkPacket(accepted, reordered);
    expect(next.measurements).toEqual(accepted.measurements);
    expect(next.rejected.at(-1)?.reason).toBe('out_of_order');
  });
  it('retains an old reading as stale instead of current reliable evidence', () => {
    const { state, packet } = fixture();
    const old = signedPacket({
      ...packet,
      measuredAt: packet.measuredAt - 3600000,
      mac: undefined,
    });
    const before = latestReliable(state, 'elena-torres', 'heart_rate');
    const next = ingestLinkPacket(state, old);
    expect(next.measurements.at(-1)?.integrity).toBe('stale');
    expect(latestReliable(next, 'elena-torres', 'heart_rate')).toEqual(before);
  });
});
