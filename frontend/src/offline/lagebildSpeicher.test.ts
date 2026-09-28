import { afterEach, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import type { BenutzerAnzeige } from '../api/types';
import {
  LAGEBILD_DB,
  lagebildAnlegen,
  lagebildClientSchreiben,
  lagebildBestaetigen,
  lagebildLesen,
  lagebildLoeschenPlatte,
  type LagebildDatensatz,
} from './lagebildSpeicher';
import { queueAlleLaden, queueEinreihen, queueLeerenFuerTests } from './queue';

const BENUTZER: BenutzerAnzeige = {
  id: 7,
  benutzername: 'fk',
  anzeigename: 'Führungskraft',
  org_rolle: 'mitglied',
  system_rolle: 'benutzer',
  aktiv: true,
  totp_aktiviert: false,
  erstellt_at: '2026-09-01T00:00:00',
} as BenutzerAnzeige;

const CLIENT = { timestamp: 1, buster: 'v1', clientState: { queries: [], mutations: [] } };

afterEach(async () => {
  await lagebildLoeschenPlatte();
});

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
