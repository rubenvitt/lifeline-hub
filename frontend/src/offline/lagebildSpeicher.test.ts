import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import type { BenutzerAnzeige } from '../api/types';
import {
  LAGEBILD_DB,
  lagebildAnlegen,
  lagebildClientSchreiben,
  lagebildBestaetigen,
  lagebildLesen,
  lagebildLoeschenPlatte,
  lagebildSpeicherZuruecksetzenFuerTests,
  type LagebildDatensatz,
} from './lagebildSpeicher';
import { queueAlleLaden, queueEinreihen, queueLeerenFuerTests } from './queue';

const BENUTZER: BenutzerAnzeige = {
  id: 7,
  benutzername: 'fk',
  anzeigename: 'Führungskraft',
  org_rolle: 'fuehrungskraft',
  system_rolle: 'keiner',
  aktiv: true,
  totp_aktiviert: false,
  passwort_gesetzt: true,
  erstellt_at: '2026-09-01T00:00:00',
} as BenutzerAnzeige;

const CLIENT = { timestamp: 1, buster: 'v1', clientState: { queries: [], mutations: [] } };

afterEach(async () => {
  vi.restoreAllMocks();
  await lagebildLoeschenPlatte();
});

/** Schlüssel, die ein Aufruf im Store `stand` liest bzw. schreibt (LFH-939 D2). */
function zugriffeBeobachten() {
  const gelesen: unknown[] = [];
  const geschrieben: unknown[] = [];
  const get = IDBObjectStore.prototype.get;
  const put = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, k) {
    gelesen.push(k);
    return get.call(this, k);
  });
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    wert,
    k,
  ) {
    geschrieben.push(k);
    return put.call(this, wert, k);
  });
  return { gelesen, geschrieben };
}

describe('lagebildSpeicher', () => {
  it('liest zurück, was angelegt wurde', async () => {
    const satz: LagebildDatensatz = {
      benutzer: BENUTZER,
      bestaetigtAt: 1000,
      buster: 'v1',
      client: CLIENT,
    };
    await lagebildAnlegen(satz);
    expect(await lagebildLesen()).toEqual(satz);
  });

  it('liefert nach dem Löschen nichts mehr', async () => {
    await lagebildAnlegen({ benutzer: BENUTZER, bestaetigtAt: 1, buster: 'v1', client: CLIENT });
    await lagebildLoeschenPlatte();
    expect(await lagebildLesen()).toBeUndefined();
  });

  it('schreibt einen Client nur in einen bestehenden Datensatz derselben Identität', async () => {
    const neu = { ...CLIENT, timestamp: 2 };
    // Kein Datensatz: nichts anlegen (ein anderer Tab hat gelöscht).
    await lagebildClientSchreiben(BENUTZER.id, neu);
    expect(await lagebildLesen()).toBeUndefined();

    await lagebildAnlegen({ benutzer: BENUTZER, bestaetigtAt: 1, buster: 'v1', client: CLIENT });
    // Fremde Identität: nicht überschreiben.
    await lagebildClientSchreiben(99, neu);
    expect((await lagebildLesen())?.client.timestamp).toBe(1);
    // Eigene Identität: schreiben, Bestätigung bleibt unberührt.
    await lagebildClientSchreiben(BENUTZER.id, neu);
    const satz = await lagebildLesen();
    expect(satz?.client.timestamp).toBe(2);
    expect(satz?.bestaetigtAt).toBe(1);
  });

  it('bewegt die Bestätigung nur am bestehenden Datensatz derselben Identität', async () => {
    await lagebildBestaetigen(BENUTZER.id, 50);
    expect(await lagebildLesen()).toBeUndefined();
    await lagebildAnlegen({ benutzer: BENUTZER, bestaetigtAt: 1, buster: 'v1', client: CLIENT });
    await lagebildBestaetigen(99, 50);
    expect((await lagebildLesen())?.bestaetigtAt).toBe(1);
    await lagebildBestaetigen(BENUTZER.id, 50);
    expect((await lagebildLesen())?.bestaetigtAt).toBe(50);
  });

  it('bestätigt, ohne den gespeicherten Stand zu lesen oder zu schreiben (LFH-939)', async () => {
    await lagebildAnlegen({ benutzer: BENUTZER, bestaetigtAt: 1, buster: 'v1', client: CLIENT });
    const { gelesen, geschrieben } = zugriffeBeobachten();
    await lagebildBestaetigen(BENUTZER.id, 50);
    expect(gelesen).toEqual(['kopf']);
    expect(geschrieben).toEqual(['kopf']);
    vi.restoreAllMocks();
    const satz = await lagebildLesen();
    expect(satz?.bestaetigtAt).toBe(50);
    expect(satz?.client).toEqual(CLIENT);
  });

  it('prüft beim Schreiben des Stands nur den Kopf (LFH-939)', async () => {
    await lagebildAnlegen({ benutzer: BENUTZER, bestaetigtAt: 1, buster: 'v1', client: CLIENT });
    const { gelesen, geschrieben } = zugriffeBeobachten();
    await lagebildClientSchreiben(BENUTZER.id, { ...CLIENT, timestamp: 3 });
    expect(gelesen).toEqual(['kopf']);
    expect(geschrieben).toEqual(['client']);
  });

  it('verwirft beim Upgrade einen Datensatz der Vorversion (LFH-939)', async () => {
    lagebildSpeicherZuruecksetzenFuerTests();
    await new Promise((fertig) => setTimeout(fertig, 0));
    await new Promise<void>((fertig, fehler) => {
      const loeschen = indexedDB.deleteDatabase(LAGEBILD_DB);
      loeschen.onsuccess = () => fertig();
      loeschen.onerror = () => fehler(loeschen.error);
    });
    const alt = await openDB(LAGEBILD_DB, 1, {
      upgrade(d) {
        d.createObjectStore('stand');
      },
    });
    await alt.put(
      'stand',
      { benutzer: BENUTZER, bestaetigtAt: 1, buster: 'v0', client: CLIENT },
      'aktuell',
    );
    alt.close();
    expect(await lagebildLesen()).toBeUndefined();
    const roh = await openDB(LAGEBILD_DB);
    expect(await roh.getAllKeys('stand')).toEqual([]);
    roh.close();
  });

  it('fasst die Offline-Queue nicht an', async () => {
    await queueLeerenFuerTests();
    await queueEinreihen(BENUTZER.id, 3, {
      typ: 'meldung',
      inhalt: 'Beweis',
    } as Parameters<typeof queueEinreihen>[2]);
    await lagebildAnlegen({ benutzer: BENUTZER, bestaetigtAt: 1, buster: 'v1', client: CLIENT });
    await lagebildLoeschenPlatte();
    expect(await queueAlleLaden(BENUTZER.id)).toHaveLength(1);
    await queueLeerenFuerTests();
  });

  it('trägt einen eigenen Datenbanknamen', async () => {
    expect(LAGEBILD_DB).toBe('lifeline-lagebild');
    await lagebildAnlegen({ benutzer: BENUTZER, bestaetigtAt: 1, buster: 'v1', client: CLIENT });
    const db = await openDB(LAGEBILD_DB);
    expect([...db.objectStoreNames]).toEqual(['stand']);
    db.close();
  });
});
