import { afterEach, describe, expect, it, vi } from 'vitest';
import { ohneSicherenKontext } from '../test/ohneSicherenKontext';
import { neueClientId } from './clientId';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('neueClientId (LFH-762)', () => {
  let zuruecknehmen: (() => void) | null = null;
  afterEach(() => {
    zuruecknehmen?.();
    zuruecknehmen = null;
    vi.restoreAllMocks();
  });

  it('nimmt crypto.randomUUID, wenn es bereitsteht', () => {
    const spion = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('11111111-2222-4333-8444-555555555555');
    expect(neueClientId()).toBe('11111111-2222-4333-8444-555555555555');
    expect(spion).toHaveBeenCalledTimes(1);
  });

  it('baut ohne sicheren Kontext eine RFC-4122-v4-ID aus getRandomValues', () => {
    zuruecknehmen = ohneSicherenKontext();
    // Gegenprobe: die Nachstellung nimmt randomUUID wirklich weg.
    expect(typeof globalThis.crypto.randomUUID).toBe('undefined');
    const ids = Array.from({ length: 200 }, () => neueClientId());
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('setzt Versions- und Variantenbits auch bei ausgereizten Zufallsbytes', () => {
    zuruecknehmen = ohneSicherenKontext();
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((feld) => {
      (feld as Uint8Array).fill(0xff);
      return feld;
    });
    expect(neueClientId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('setzt sie auch bei Null-Bytes', () => {
    zuruecknehmen = ohneSicherenKontext();
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation((feld) => {
      (feld as Uint8Array).fill(0);
      return feld;
    });
    expect(neueClientId()).toBe('00000000-0000-4000-8000-000000000000');
  });
});
