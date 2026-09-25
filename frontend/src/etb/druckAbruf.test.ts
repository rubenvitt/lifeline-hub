import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listeEtb } from '../api/etb';
import type { EtbEintragAnzeige } from '../api/types';
import { DRUCK_SEITE, ladeEtbVollstaendig } from './druckAbruf';

vi.mock('../api/etb', () => ({ listeEtb: vi.fn() }));

/**
 * Vollabruf der ETB-Auswahl für den Druck (LFH-22, design.md D4). Der Server liefert
 * `lfd_nr DESC` mit Cursor `before_lfd_nr` und höchstens 500 je Seite. Die Schleife geht
 * über DIESELBE Liste wie der Bildschirm — eine Abbildung Filter → Query (`listeEtb`),
 * dieselben Gates.
 */

function eintrag(lfd_nr: number, over: Partial<EtbEintragAnzeige> = {}): EtbEintragAnzeige {
  return {
    id: lfd_nr * 10,
    lfd_nr,
    typ: 'meldung',
    inhalt: `Eintrag ${lfd_nr}`,
    ereigniszeit: '2026-09-25 08:00:00',
    received_at: '2026-09-25 08:00:00',
    erfasser_id: 1,
    erfasser_name: 'EL',
    ...over,
  } as EtbEintragAnzeige;
}

/** Ein Tagebuch mit den Nummern 1…n; `listeEtb` bedient Cursor und Limit wie der Server. */
function tagebuch(n: number, filter: (e: EtbEintragAnzeige) => boolean = () => true) {
  const alle = Array.from({ length: n }, (_, i) => eintrag(i + 1)).filter(filter);
  vi.mocked(listeEtb).mockImplementation(async (_einsatz, params = {}) => {
    const unter = params.before_lfd_nr ?? Infinity;
    return alle
      .filter((e) => e.lfd_nr < unter)
      .sort((a, b) => b.lfd_nr - a.lfd_nr)
      .slice(0, params.limit ?? 100);
  });
  return alle;
}

beforeEach(() => {
  vi.mocked(listeEtb).mockReset();
});

describe('ladeEtbVollstaendig', () => {
  it('lädt 1 200 Einträge in drei Aufrufen mit Cursor und limit 500', async () => {
    tagebuch(1200);
    const ergebnis = await ladeEtbVollstaendig(7, {});
    expect(ergebnis.eintraege).toHaveLength(1200);
    const aufrufe = vi.mocked(listeEtb).mock.calls;
    expect(aufrufe).toHaveLength(3);
    expect(aufrufe.map(([id]) => id)).toEqual([7, 7, 7]);
    expect(aufrufe.map(([, p]) => p?.limit)).toEqual([DRUCK_SEITE, DRUCK_SEITE, DRUCK_SEITE]);
    expect(aufrufe.map(([, p]) => p?.before_lfd_nr)).toEqual([undefined, 701, 201]);
    expect(DRUCK_SEITE).toBe(500);
    expect(ergebnis.hoechsteLfdNr).toBe(1200);
  });

  it('braucht bei genau 500 Einträgen einen zweiten, leeren Aufruf', async () => {
    tagebuch(500);
    const ergebnis = await ladeEtbVollstaendig(7, {});
    expect(ergebnis.eintraege).toHaveLength(500);
    expect(vi.mocked(listeEtb)).toHaveBeenCalledTimes(2);
  });

  it('reicht den Filter unverändert an listeEtb durch — keine zweite Abbildung', async () => {
    tagebuch(3);
    const filter = {
      q: 'Damm',
      typ: 'meldung' as const,
      von: '2026-09-25 06:00:00',
      einheit_id: 4,
    };
    await ladeEtbVollstaendig(7, filter);
    expect(vi.mocked(listeEtb).mock.calls[0][1]).toEqual({ ...filter, limit: DRUCK_SEITE });
  });

  it('verwirft das Ergebnis, wenn eine spätere Seite scheitert', async () => {
    const alle = tagebuch(1200);
    let aufruf = 0;
    vi.mocked(listeEtb).mockImplementation(async (_e, params = {}) => {
      aufruf += 1;
      if (aufruf === 3) throw new Error('Netz weg');
      const unter = params.before_lfd_nr ?? Infinity;
      return alle
        .filter((e) => e.lfd_nr < unter)
        .sort((a, b) => b.lfd_nr - a.lfd_nr)
        .slice(0, 500);
    });
    await expect(ladeEtbVollstaendig(7, {})).rejects.toThrow('Netz weg');
  });

  it('wirft, wenn eine Seite eine Nummer nicht unterhalb des Cursors liefert — keine Endlosschleife', async () => {
    // Ein Server, der den Cursor ignoriert, lieferte ewig dieselbe volle Seite.
    const volle = Array.from({ length: 500 }, (_, i) => eintrag(1000 - i));
    vi.mocked(listeEtb).mockResolvedValue(volle);
    await expect(ladeEtbVollstaendig(7, {})).rejects.toThrow(/Cursor/);
    expect(vi.mocked(listeEtb)).toHaveBeenCalledTimes(2);
  });

  it('meldet den Fortschritt je Seite', async () => {
    tagebuch(1200);
    const fortschritt: number[] = [];
    await ladeEtbVollstaendig(7, {}, { onFortschritt: (n) => fortschritt.push(n) });
    expect(fortschritt).toEqual([500, 1000, 1200]);
  });

  it('holt die Berichtigungen eigens nach, wenn ein Filter aktiv ist', async () => {
    tagebuch(3);
    const ergebnis = await ladeEtbVollstaendig(7, { typ: 'meldung' });
    const aufrufe = vi.mocked(listeEtb).mock.calls.map(([, p]) => p);
    expect(aufrufe).toContainEqual({ typ: 'berichtigung', limit: DRUCK_SEITE });
    expect(ergebnis.berichtigungen).toBeDefined();
  });

  it('holt keine Berichtigungen nach — ohne Filter oder beim Filter auf Berichtigungen', async () => {
    tagebuch(3);
    await ladeEtbVollstaendig(7, {});
    await ladeEtbVollstaendig(7, { typ: 'berichtigung' });
    const typen = vi.mocked(listeEtb).mock.calls.map(([, p]) => p?.typ);
    expect(typen).toEqual([undefined, 'berichtigung']);
  });
});
