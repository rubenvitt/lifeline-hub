import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Wächter für die Bildschleife der Suite (LLH-2023, `setup.ts`).
 *
 * jsdom 31 startet seine eigene Bildschleife erst bei Bedarf, über Nodes globales `setInterval`.
 * Ein Test, der `setInterval` fälscht, während ein Bild angefordert wird, ließ sie auf dem
 * gefälschten Intervall stehen: für den Rest der Datei feuerte kein `requestAnimationFrame`
 * mehr, und jeder spätere `autoFocus` eines Menüs blieb aus (BrDetailPage, 12 Tests).
 */
const naechstesBild = () =>
  new Promise<'feuert' | 'haengt'>((fertig) => {
    const frist = setTimeout(() => fertig('haengt'), 500);
    requestAnimationFrame(() => {
      clearTimeout(frist);
      fertig('feuert');
    });
  });

describe('Bildschleife der Suite (LLH-2023)', () => {
  afterEach(() => vi.useRealTimers());

  it('ein Bild feuert', async () => {
    expect(await naechstesBild()).toBe('feuert');
  });

  it('ein unter gefälschtem Intervall angefordertes Bild hält die Schleife nicht an', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    requestAnimationFrame(() => {});
    vi.useRealTimers();
    expect(await naechstesBild()).toBe('feuert');
  });

  it('cancelAnimationFrame nimmt ein angefordertes Bild zurück', async () => {
    const zurueckgenommen = vi.fn();
    cancelAnimationFrame(requestAnimationFrame(zurueckgenommen));
    expect(await naechstesBild()).toBe('feuert');
    expect(zurueckgenommen).not.toHaveBeenCalled();
  });

  it('ein Bild bekommt einen Zeitstempel wie im Browser', async () => {
    const zeit = await new Promise<number>((fertig) => requestAnimationFrame(fertig));
    expect(typeof zeit).toBe('number');
    expect(zeit).toBeGreaterThanOrEqual(0);
  });
});
