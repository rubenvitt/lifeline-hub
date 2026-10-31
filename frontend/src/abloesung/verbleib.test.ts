import { describe, expect, it } from 'vitest';
import type { BrListenEintrag } from '../api/types';
import { verbleibBody, verbleibOptionen, verbleibRaeume, verbleibText } from './verbleib';

describe('Verbleib nach dem Vollzug (LLH-1308)', () => {
  it('nimmt nur aktive, nicht stornierte Räume', () => {
    const raeume = [
      { id: 1, bezeichnung: 'Schule', status: 'aktiv', storniert_at: null },
      { id: 2, bezeichnung: 'Sportplatz', status: 'geplant', storniert_at: null },
      { id: 3, bezeichnung: 'Halle', status: 'aufgeloest', storniert_at: null },
      { id: 4, bezeichnung: 'Hof', status: 'aktiv', storniert_at: '2026-10-31 12:00:00' },
    ] as unknown as BrListenEintrag[];
    expect(verbleibRaeume(raeume)).toEqual([{ id: 1, bezeichnung: 'Schule' }]);
    expect(verbleibRaeume(undefined)).toEqual([]);
  });

  it('Optionen: In Ruhe, je Raum, Entlassen; gesperrt ohne Räume', () => {
    const raeume = [{ id: 1, bezeichnung: 'Schule' }];
    expect(verbleibOptionen(raeume, false).map((o) => o.label)).toEqual([
      'In Ruhe',
      'Bereitstellungsraum «Schule»',
      'Entlassen',
    ]);
    expect(verbleibOptionen(raeume, true).map((o) => o.value)).toEqual(['ruhe', 'entlassen']);
  });

  it('Body: Ruhe geht nicht hinaus, der Raum mit Kennung', () => {
    expect(verbleibBody(undefined)).toEqual({});
    expect(verbleibBody('ruhe')).toEqual({});
    expect(verbleibBody('entlassen')).toEqual({ verbleib: 'entlassen' });
    expect(verbleibBody('br:7')).toEqual({ verbleib: 'bereitstellungsraum', verbleib_br_id: 7 });
  });

  it('Kartentext nennt den Verbleib, bei Ruhe nichts', () => {
    expect(verbleibText({ verbleib: 'ruhe' })).toBeNull();
    expect(verbleibText({ verbleib: 'entlassen' })).toBe('danach entlassen');
    expect(
      verbleibText({ verbleib: 'bereitstellungsraum', verbleib_br_bezeichnung: 'Schule' }),
    ).toBe('danach Bereitstellungsraum Schule');
  });
});
