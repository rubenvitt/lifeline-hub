import { describe, it, expect, afterEach } from 'vitest';
import { openDB } from 'idb';
import { rohLesen } from '../test/rohIdb';
import {
  ortKeyVon,
  holeOrt,
  setzeOrt,
  ortCacheRaeumen,
  ortCacheZuruecksetzenFuerTests,
  ORTCACHE_FRIST_MS,
  ORTCACHE_OBERGRENZE,
} from './ortCache';

describe('ortCache', () => {
  afterEach(() => ortCacheRaeumen());

  it('rundet den Key auf 3 Nachkommastellen (~100 m)', () => {
    expect(ortKeyVon(51.1604, 10.4514)).toBe('51.160,10.451');
    expect(ortKeyVon(51.16042, 10.45138)).toBe(ortKeyVon(51.1604, 10.4514));
  });

  it('set→get-Roundtrip; Miss → null', async () => {
    const key = ortKeyVon(51.1604, 10.4514);
    expect(await holeOrt(key)).toBeNull();
    await setzeOrt(key, 'Hauptstr. 5, Musterstadt');
    expect(await holeOrt(key)).toBe('Hauptstr. 5, Musterstadt');
  });

  it('überschreibt vorhandenen Wert', async () => {
    const key = ortKeyVon(48.0, 11.0);
    await setzeOrt(key, 'Alt');
    await setzeOrt(key, 'Neu');
    expect(await holeOrt(key)).toBe('Neu');
  });

  it('räumt beim Ausgang die Platte (LFH-767)', async () => {
    await setzeOrt(ortKeyVon(51.1604, 10.4514), 'Hauptstr. 5, Musterstadt');
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toHaveLength(1);

    await ortCacheRaeumen();

    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([]);
  });

  /** Einträge direkt auf die Platte legen und die Verbindung vergessen: das nächste Öffnen
   *  dünnt aus wie beim Start der App. */
  async function rohSchreiben(eintraege: [string, { name: string; at: number }][]) {
    await holeOrt('vorher-oeffnen');
    ortCacheZuruecksetzenFuerTests();
    const d = await openDB('lifeline-ortcache');
    const tx = d.transaction('ortsnamen', 'readwrite');
    for (const [key, wert] of eintraege) void tx.store.put(wert, key);
    await tx.done;
    d.close();
  }

  it('löscht beim Öffnen Einträge, die älter als 30 Tage sind (LFH-941)', async () => {
    const jetzt = Date.now();
    await rohSchreiben([
      ['alt', { name: 'Alter Ort', at: jetzt - ORTCACHE_FRIST_MS - 60_000 }],
      ['frisch', { name: 'Frischer Ort', at: jetzt - ORTCACHE_FRIST_MS + 60_000 }],
    ]);
    expect(await holeOrt('alt')).toBeNull();
    expect(await holeOrt('frisch')).toBe('Frischer Ort');
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toHaveLength(1);
  });

  it('hält beim Öffnen höchstens 5 000 Einträge, die ältesten fallen heraus (LFH-941)', async () => {
    const jetzt = Date.now();
    const eintraege: [string, { name: string; at: number }][] = [];
    for (let i = 0; i < ORTCACHE_OBERGRENZE + 10; i++) {
      eintraege.push([`k${i}`, { name: `Ort ${i}`, at: jetzt - 1_000_000 + i }]);
    }
    await rohSchreiben(eintraege);
    expect(await holeOrt('k9')).toBeNull();
    expect(await holeOrt('k10')).toBe('Ort 10');
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toHaveLength(ORTCACHE_OBERGRENZE);
  });

  it('verwirft den Bestand der Vorversion ohne Zeitstempel, ohne Versionssprung (LFH-941)', async () => {
    ortCacheZuruecksetzenFuerTests();
    await new Promise<void>((fertig, fehler) => {
      const loeschen = indexedDB.deleteDatabase('lifeline-ortcache');
      loeschen.onsuccess = () => fertig();
      loeschen.onerror = () => fehler(loeschen.error);
    });
    const alt = await openDB('lifeline-ortcache', 1, {
      upgrade(d) {
        d.createObjectStore('ortsnamen');
      },
    });
    await alt.put('ortsnamen', 'Alter Ort', ortKeyVon(1, 1));
    alt.close();
    expect(await holeOrt(ortKeyVon(1, 1))).toBeNull();
    await setzeOrt(ortKeyVon(2, 2), 'Neuer Ort');
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([
      { name: 'Neuer Ort', at: expect.any(Number) },
    ]);
    const roh = await openDB('lifeline-ortcache');
    expect(roh.version).toBe(1);
    roh.close();
  });

  it('liest einen nackten Namen, den ein alter Tab nach dem Öffnen schreibt', async () => {
    await holeOrt('vorher-oeffnen');
    const roh = await openDB('lifeline-ortcache');
    await roh.put('ortsnamen', 'Alter Tab', ortKeyVon(3, 3));
    roh.close();
    expect(await holeOrt(ortKeyVon(3, 3))).toBe('Alter Tab');
  });

  it('gibt die DB frei, wenn ein neueres Bundle hochstufen will', async () => {
    await holeOrt('vorher-oeffnen');
    const neu = await Promise.race([
      openDB('lifeline-ortcache', 2),
      new Promise<'blockiert'>((fertig) => setTimeout(() => fertig('blockiert'), 500)),
    ]);
    expect(neu).not.toBe('blockiert');
    if (neu !== 'blockiert') neu.close();
    ortCacheZuruecksetzenFuerTests();
    await new Promise<void>((fertig) => {
      const loeschen = indexedDB.deleteDatabase('lifeline-ortcache');
      loeschen.onsuccess = () => fertig();
      loeschen.onblocked = () => fertig();
    });
  });
});
