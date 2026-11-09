import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
}));
vi.mock('./client', () => ({
  apiGet: vi.fn(),
  apiSend: vi.fn(),
}));

import { startAuthentication } from '@simplewebauthn/browser';
import { apiSend } from './client';
import { fuehrungBasis, uebernimmFuehrungMitUnterschrift } from './fuehrung';
import { gegenzeichne } from './instanz';

const start = {
  zeremonie: 'z1',
  challenge: 'c1',
  rp_id: 'hub.example.org',
  credential_ids: ['cid'],
  erklaerung: '{}',
};
const antwort = {
  id: 'cid',
  response: { authenticatorData: 'ad', clientDataJSON: 'cdj', signature: 'sig' },
};
const assertion = {
  credential_id: 'cid',
  authenticator_data: 'ad',
  client_data_json: 'cdj',
  signatur: 'sig',
};

describe('unterschreibeErklaerung (LLH-1490/1491)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiSend).mockImplementation(async (pfad: string) =>
      pfad.endsWith('/start') ? start : { ok: true },
    );
    vi.mocked(startAuthentication).mockResolvedValue(antwort as never);
  });

  it('Gegenzeichnung: Start, Unterschrift mit der Challenge des Servers, Abschluss', async () => {
    await gegenzeichne(7);
    expect(apiSend).toHaveBeenNthCalledWith(
      1,
      '/api/admin/instanz/unterschrift/7/gegenzeichnen/start',
      'POST',
      undefined,
    );
    expect(startAuthentication).toHaveBeenCalledWith({
      optionsJSON: {
        challenge: 'c1',
        rpId: 'hub.example.org',
        allowCredentials: [{ id: 'cid', type: 'public-key' }],
        userVerification: 'required',
      },
    });
    expect(apiSend).toHaveBeenNthCalledWith(
      2,
      '/api/admin/instanz/unterschrift/7/gegenzeichnen/abschluss',
      'POST',
      { zeremonie: 'z1', assertion },
    );
  });

  it('Notübernahme: der Grund geht an den Start, die Assertion an den Abschluss', async () => {
    await uebernimmFuehrungMitUnterschrift({ akteId: 4 }, 'ELW weg');
    expect(apiSend).toHaveBeenNthCalledWith(
      1,
      '/api/admin/instanz/fuehrung/4/notuebernahme/start',
      'POST',
      { grund: 'ELW weg' },
    );
    expect(apiSend).toHaveBeenNthCalledWith(
      2,
      '/api/admin/instanz/fuehrung/4/notuebernahme/abschluss',
      'POST',
      { zeremonie: 'z1', assertion },
    );
  });

  it('bildet den Pfad am Einsatz oder an der Akte', () => {
    expect(fuehrungBasis({ einsatzId: 7 })).toBe('/api/einsaetze/7/fuehrung');
    expect(fuehrungBasis({ akteId: 4 })).toBe('/api/admin/instanz/fuehrung/4');
  });
});
