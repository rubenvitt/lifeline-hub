import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../api/client';
import type { SkizzenBereich, SkizzenLage } from '../../api/fernmeldeskizzeVertrag';
import type { KommunikationsStelle } from '../../api/types';
import { abschnitt, daten, quellen } from '../../test/fernmeldenetz';
import { baueFernmeldenetz, type Fernmeldenetz } from '../fernmeldeskizze';
import type { SkizzenAktionen } from '../skizzenAktionen';
import { Befehlsstapel } from '../skizzenBefehle';
import { VERSCHOBEN_MELDUNG, useSkizzenHandlungen } from './useSkizzenHandlungen';

/**
 * Die Handlungen der Fläche gegen gefälschte Schreibwege (LFH-893 D4, D6; Review S1, S3, S4,
 * O3): welche erwartete Version jede Handlung und jede Gegenhandlung schickt, und wann die eigene
 * Lage über dem Netz steht.
 */

const ZIEL = { x: 400, y: 80 };
const VORHER = { x: 16, y: 16 };

function lage(element: string, version: number, p = VORHER): SkizzenLage {
  return { element, x: p.x, y: p.y, breite: null, version };
}

function bereich(version: number, p: Partial<SkizzenBereich> = {}): SkizzenBereich {
  return {
    id: 4,
    bezeichnung: 'Rückwärtiger Bereich',
    x: 0,
    y: 0,
    breite: 320,
    hoehe: 192,
    version,
    ...p,
  };
}

function netz(
  p: { lage?: SkizzenLage[]; bereiche?: SkizzenBereich[]; einsatzId?: number } = {},
): Fernmeldenetz {
  return baueFernmeldenetz(
    quellen({
      einsatzId: p.einsatzId ?? 7,
      abschnitte: daten([abschnitt(1, { name: 'EA 1' })]),
      skizze: { lage: p.lage ?? [], bereiche: p.bereiche ?? [] },
    }),
  );
}

function konflikt() {
  return new ApiError(409, 'Von einem anderen Arbeitsplatz verschoben', {
    vomAnwendungsserver: true,
  });
}

function aktionenAttrappe() {
  let version = 0;
  return {
    verschiebe: vi.fn(async (element: string, l: { x: number; y: number }): Promise<SkizzenLage> =>
      lage(element, ++version, l),
    ),
    entferneLage: vi.fn(async () => {}),
    neuAnordnen: vi.fn(async () => {}),
    ordneZu: vi.fn(async () => {}),
    loese: vi.fn(async () => {}),
    legeVerbindungAn: vi.fn(),
    aendereVerbindung: vi.fn(),
    entferneVerbindung: vi.fn(async () => {}),
    legeKomponenteAn: vi.fn(),
    aendereKomponente: vi.fn(),
    entferneKomponente: vi.fn(async () => {}),
    legeExterneStelleAn: vi.fn(async (stellenart, bezeichnung): Promise<KommunikationsStelle> => ({
      id: 42,
      stellenart,
      bezeichnung,
      verbindungen: [],
      sprechgruppen: [],
    })),
    entferneExterneStelle: vi.fn(async () => {}),
    legeBereichAn: vi.fn(),
    aendereBereich: vi.fn(
      async (id: number, felder: object, v: number): Promise<SkizzenBereich> => ({
        ...bereich(v + 1),
        id,
        ...felder,
      }),
    ),
    entferneBereich: vi.fn(async () => {}),
    setzeSchriftfeld: vi.fn(),
    setzeRufname: vi.fn(async () => {}),
    setzeKommunikationsmittel: vi.fn(async () => {}),
  } satisfies SkizzenAktionen;
}

function haken(start: Fernmeldenetz, aktionen = aktionenAttrappe()) {
  const befehle = new Befehlsstapel();
  const r = renderHook(({ n }) => useSkizzenHandlungen(n, aktionen, befehle), {
    initialProps: { n: start },
  });
  return { ...r, aktionen, befehle, netz: (n: Fernmeldenetz) => r.rerender({ n }) };
}

describe('useSkizzenHandlungen — eigene Lage über dem Netz (Review S1)', () => {
  it('„Neu anordnen“ an einem anderen Arbeitsplatz: die eigene Lage fällt, das nächste Verschieben erwartet keine Zeile', async () => {
    const h = haken(netz());
    await act(() => h.result.current.verschieben('ab-1', ZIEL, VORHER));
    expect(h.aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', ZIEL, null);
    // Der Cache trägt die Antwort (`setQueryData`), dann verwirft ein anderer Arbeitsplatz alle Lagen.
    h.netz(netz({ lage: [lage('ab-1', 1, ZIEL)] }));
    expect(h.result.current.angezeigt.lage.get('ab-1')).toMatchObject(ZIEL);
    h.netz(netz({ lage: [] }));
    expect(h.result.current.angezeigt.lage.has('ab-1')).toBe(false);

    await act(() => h.result.current.verschieben('ab-1', VORHER, ZIEL));
    expect(h.aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', VORHER, null);
  });

  it('solange das Netz die Antwort noch nicht trägt, steht die eigene Lage und gilt die eigene Version', async () => {
    const h = haken(netz());
    await act(() => h.result.current.verschieben('ab-1', ZIEL, VORHER));
    expect(h.result.current.angezeigt.lage.get('ab-1')).toMatchObject(ZIEL);
    await act(() => h.result.current.verschieben('ab-1', VORHER, ZIEL));
    expect(h.aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', VORHER, 1);
  });

  it('eine jüngere Version im Netz (fremdes Verschieben) gilt, die eigene Lage fällt', async () => {
    const h = haken(netz({ lage: [lage('ab-1', 3)] }));
    await act(() => h.result.current.verschieben('ab-1', ZIEL, VORHER));
    expect(h.aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', ZIEL, 3);
    h.netz(netz({ lage: [lage('ab-1', 9, { x: 800, y: 800 })] }));
    expect(h.result.current.angezeigt.lage.get('ab-1')).toMatchObject({ x: 800, version: 9 });
    await act(() => h.result.current.verschieben('ab-1', ZIEL, VORHER));
    expect(h.aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', ZIEL, 9);
  });
});

describe('useSkizzenHandlungen — Rückgängig mit der eigenen Version (Review S3, O3)', () => {
  it('Rückgängig schickt die Version der eigenen Antwort; ein fremdes Verschieben dazwischen ist 409 und verwirft den Eintrag', async () => {
    const aktionen = aktionenAttrappe();
    aktionen.verschiebe.mockResolvedValueOnce(lage('ab-1', 4, ZIEL));
    const h = haken(netz({ lage: [lage('ab-1', 3)] }), aktionen);
    await act(() => h.result.current.verschieben('ab-1', ZIEL, VORHER));
    // Ein anderer Arbeitsplatz verschiebt danach: Version 5 im Netz.
    h.netz(netz({ lage: [lage('ab-1', 5, { x: 640, y: 0 })] }));
    aktionen.verschiebe.mockRejectedValueOnce(konflikt());
    let ergebnis: Awaited<ReturnType<typeof h.result.current.rueckgaengig>> | undefined;
    await act(async () => {
      ergebnis = await h.result.current.rueckgaengig();
    });
    expect(aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', VORHER, 4);
    expect(ergebnis).toMatchObject({
      art: 'gescheitert',
      grund: VERSCHOBEN_MELDUNG,
      verworfen: true,
    });
    expect(h.befehle.stand()).toMatchObject({ rueckgaengig: 0, wiederholen: 0 });
  });

  it('Rückgängig und Wiederholen reichen die Version der jeweils letzten eigenen Antwort weiter', async () => {
    const aktionen = aktionenAttrappe();
    aktionen.verschiebe
      .mockResolvedValueOnce(lage('ab-1', 4, ZIEL))
      .mockResolvedValueOnce(lage('ab-1', 5, VORHER))
      .mockResolvedValueOnce(lage('ab-1', 6, ZIEL));
    const h = haken(netz({ lage: [lage('ab-1', 3)] }), aktionen);
    await act(() => h.result.current.verschieben('ab-1', ZIEL, VORHER));
    h.netz(netz({ lage: [lage('ab-1', 4, ZIEL)] }));
    await act(() => h.result.current.rueckgaengig());
    expect(aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', VORHER, 4);
    h.netz(netz({ lage: [lage('ab-1', 5)] }));
    await act(() => h.result.current.wiederholen());
    expect(aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', ZIEL, 5);
  });

  it('Rückgängig nach dem ersten Verschieben eines auto-gelegten Elements verwirft dessen Lage, statt sie festzuschreiben', async () => {
    const h = haken(netz());
    await act(() => h.result.current.verschieben('ab-1', ZIEL, VORHER));
    h.netz(netz({ lage: [lage('ab-1', 1, ZIEL)] }));
    await act(() => h.result.current.rueckgaengig());
    expect(h.aktionen.entferneLage).toHaveBeenCalledWith('ab-1', 1);
    expect(h.aktionen.verschiebe).toHaveBeenCalledTimes(1);
    // Bis das Netz nachzieht, steht das Element schon wieder im Auto-Layout.
    expect(h.result.current.angezeigt.lage.has('ab-1')).toBe(false);
    h.netz(netz());
    await act(() => h.result.current.wiederholen());
    expect(h.aktionen.verschiebe).toHaveBeenLastCalledWith('ab-1', ZIEL, null);
  });

  it('Bereich: Rückgängig schickt die Version der eigenen Antwort, nicht die jüngste im Netz', async () => {
    const h = haken(netz({ bereiche: [bereich(2)] }));
    const b = h.result.current.angezeigt.bereiche[0];
    await act(() => h.result.current.aendereBereich(b, { x: 64 }));
    expect(h.aktionen.aendereBereich).toHaveBeenLastCalledWith(4, { x: 64 }, 2);
    // Ein anderer Arbeitsplatz ändert danach: Version 7.
    h.netz(netz({ bereiche: [bereich(7, { x: 128 })] }));
    h.aktionen.aendereBereich.mockRejectedValueOnce(konflikt());
    let ergebnis: Awaited<ReturnType<typeof h.result.current.rueckgaengig>> | undefined;
    await act(async () => {
      ergebnis = await h.result.current.rueckgaengig();
    });
    expect(h.aktionen.aendereBereich).toHaveBeenLastCalledWith(4, { x: 0 }, 3);
    expect(ergebnis).toMatchObject({
      art: 'gescheitert',
      grund: 'von einem anderen Arbeitsplatz geändert',
      verworfen: true,
    });
  });
});

describe('useSkizzenHandlungen — externe Stelle anlegen (Review S4)', () => {
  it('liegt auf dem Stapel; Rückgängig entfernt genau die angelegte Stelle', async () => {
    const h = haken(netz());
    await act(() => h.result.current.legeExterneStelleAn('leitstelle', 'ILS Musterhausen'));
    expect(h.aktionen.legeExterneStelleAn).toHaveBeenCalledWith('leitstelle', 'ILS Musterhausen');
    expect(h.befehle.stand().rueckgaengig).toBe(1);
    await act(() => h.result.current.rueckgaengig());
    expect(h.aktionen.entferneExterneStelle).toHaveBeenCalledWith(42);
    // Wiederholen legt neu an; ein weiteres Rückgängig nimmt die NEUE Stelle.
    h.aktionen.legeExterneStelleAn.mockResolvedValueOnce({
      id: 43,
      stellenart: 'leitstelle',
      bezeichnung: 'ILS Musterhausen',
      verbindungen: [],
      sprechgruppen: [],
    });
    await act(() => h.result.current.wiederholen());
    await act(() => h.result.current.rueckgaengig());
    expect(h.aktionen.entferneExterneStelle).toHaveBeenLastCalledWith(43);
  });
});
