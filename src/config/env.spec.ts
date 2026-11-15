import * as tls from 'node:tls';
import { configureSystemTrust } from './env';
jest.mock('node:tls', () => ({
  getCACertificates: jest.fn((type: string) => type === 'system' ? ['os-ca', 'bundled'] : ['bundled']),
  setDefaultCACertificates: jest.fn(),
}));
beforeEach(() => jest.clearAllMocks());
it('leaves certificate trust unchanged unless explicitly enabled', () => {
  configureSystemTrust({});
  expect(tls.setDefaultCACertificates).not.toHaveBeenCalled();
});
it('adds system trust without dropping bundled authorities', () => {
  configureSystemTrust({ AI_USE_SYSTEM_CA: 'true' });
  expect(tls.setDefaultCACertificates).toHaveBeenCalledWith(['bundled', 'os-ca']);
});
