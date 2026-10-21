import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { KartenHandle } from './Kartenflaeche';
import { KARTE_NICHT_DARSTELLBAR } from './kartenGrafik';
import { KARTENBILD_FEHLT, KeinKartenbild, useLageplan, type LageplanQuellen } from './useLageplan';

/**
 * Grund eines Lageplans ohne Bild (LLH-1353): kann die Kartenfläche nicht zeichnen (Gerät ohne
 * WebGL2), sagen Druck und Anlage das; sonst bleibt es beim allgemeinen „Kartenbild nicht
 * aufgenommen“.
 *
 * Mutationsprobe: `isDarstellbar()` in `useLageplan` nicht gelesen → beide „ohne Karte“-Fälle
 * nennen „Kartenbild nicht aufgenommen“, rot (geprobt 21.10.).
 */
function karte(darstellbar: boolean) {
  return {
    current: {
      nimmBildAuf: vi.fn(() => Promise.resolve(null)),
      isDarstellbar: () => darstellbar,
    } as unknown as KartenHandle,
  };
}

const KOPF = {
  einsatz: { bezeichnung: 'Hochwasser' },
  ansicht: null,
  grundlage: null,
  stand: null,
};
const QUELLEN = {} as LageplanQuellen;

function zeige(darstellbar: boolean) {
  const melde = vi.fn();
  const beginneHandlung = vi.fn(() => melde);
  const { result } = renderHook(() =>
    useLageplan({ kartenRef: karte(darstellbar), kopf: KOPF, quellen: QUELLEN, beginneHandlung }),
  );
  return { result, melde, beginneHandlung };
}

describe('useLageplan ohne Kartenbild (LLH-1353)', () => {
  it('Druck ohne Karte: „Lageplan nicht gedruckt“ mit dem Zustand der Fläche, kein Blatt', async () => {
    const { result, melde, beginneHandlung } = zeige(false);
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.vorbereitenDruck();
    });
    expect(ok).toBe(false);
    expect(beginneHandlung).toHaveBeenCalledWith(
      'lageplan-druck',
      'Lageplan nicht gedruckt',
      KARTE_NICHT_DARSTELLBAR,
    );
    expect(melde).toHaveBeenCalledWith(new Error(KARTE_NICHT_DARSTELLBAR));
    expect(result.current.blatt).toBeNull();
  });

  it('Druck mit Karte, aber ohne Bild: „Kartenbild nicht aufgenommen“', async () => {
    const { result, melde, beginneHandlung } = zeige(true);
    await act(async () => {
      await result.current.vorbereitenDruck();
    });
    expect(beginneHandlung).toHaveBeenCalledWith(
      'lageplan-druck',
      'Lageplan nicht gedruckt',
      KARTENBILD_FEHLT,
    );
    expect(melde).toHaveBeenCalledWith(new Error(KARTENBILD_FEHLT));
  });

  it('Anlage ohne Karte: scheitert mit dem Zustand der Fläche als Grund', async () => {
    const { result } = zeige(false);
    const anlage = result.current.erstelleAnlage();
    await expect(anlage).rejects.toBeInstanceOf(KeinKartenbild);
    await expect(anlage).rejects.toThrow(KARTE_NICHT_DARSTELLBAR);
  });

  it('Anlage mit Karte, aber ohne Bild: „Kartenbild nicht aufgenommen“', async () => {
    const { result } = zeige(true);
    await expect(result.current.erstelleAnlage()).rejects.toThrow(KARTENBILD_FEHLT);
  });
});
