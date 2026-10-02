import { beforeAll, describe, expect, it } from 'vitest';
import { deleteDB, openDB } from 'idb';
import { rohLesen } from '../../test/rohIdb';

/**
 * Upgrade der Entwurfs-DB v1 → v2 (LFH-767, design.md D5). Eigene Datei, weil das Modul seine
 * Verbindung zwischenspeichert: die v1-DB muss stehen, BEVOR es sie zum ersten Mal öffnet.
 */

const STUNDE = 60 * 60 * 1000;
const jetzt = Date.now();
const vor = (stunden: number) => new Date(jetzt - stunden * STUNDE).toISOString();

function altEntwurf(id: string, geaendert_at: string) {
  return {
    id,
    einsatz_id: 7,
    inhalt: `Alt ${id}`,
    typ: 'meldung',
    erstellt_at: geaendert_at,
    geaendert_at,
  };
}

beforeAll(async () => {
  await deleteDB('lifeline-etb-entwuerfe');
  const v1 = await openDB('lifeline-etb-entwuerfe', 1, {
    upgrade(d) {
      const store = d.createObjectStore('entwuerfe', { keyPath: 'id' });
      store.createIndex('by-einsatz', 'einsatz_id');
    },
  });
  await v1.put('entwuerfe', altEntwurf('jung', vor(2)));
  await v1.put('entwuerfe', altEntwurf('alt', vor(30)));
  v1.close();
});

describe('Entwurfs-DB v1 → v2 (LFH-767)', () => {
  it('lässt den Altbestand beim Upgrade stehen, zeigt ihn aber niemandem', async () => {
    const { entwuerfeLaden } = await import('./entwurfStore');
    expect(await entwuerfeLaden(11, 7)).toEqual([]);
    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toHaveLength(2);
  });

  it('die erste bestätigte Person übernimmt Altentwürfe bis 24 h, ältere gehen', async () => {
    const { entwuerfeAufraeumen, entwuerfeLaden } = await import('./entwurfStore');

    await entwuerfeAufraeumen(11, jetzt);

    expect((await entwuerfeLaden(11, 7)).map((e) => e.inhalt)).toEqual(['Alt jung']);
    expect(await entwuerfeLaden(22, 7)).toEqual([]);
    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toHaveLength(1);
  });
});
