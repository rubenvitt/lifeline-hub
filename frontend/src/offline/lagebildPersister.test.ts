import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PersistedClient } from '@tanstack/query-persist-client-core';
import type { BenutzerAnzeige } from '../api/types';
import { erzeugeLagebildPersister } from './lagebildPersister';
import * as speicher from './lagebildSpeicher';

const BENUTZER = { id: 7, benutzername: 'fk' } as BenutzerAnzeige;
const DROSSEL = 30;

function client(ts: number): PersistedClient {
  return { timestamp: ts, buster: 'v1', clientState: { queries: [], mutations: [] } };
}

async function datensatzAnlegen() {
  await speicher.lagebildAnlegen({
    benutzer: BENUTZER,
    bestaetigtAt: 1,
    buster: 'v1',
    client: client(0),
  });
}

const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  vi.restoreAllMocks();
  speicher.lagebildSpeicherZuruecksetzenFuerTests();
  await speicher.lagebildLoeschenPlatte();
});

describe('Lagebild-Persister', () => {
  it('fasst Speicherungen innerhalb der Drosselung zu einem Schreibvorgang zusammen', async () => {
    await datensatzAnlegen();
    const schreiben = vi.fn(speicher.lagebildClientSchreiben);
    const p = erzeugeLagebildPersister(BENUTZER.id, { drosselMs: DROSSEL, schreiben });
    await p.persistClient(client(1));
    await p.persistClient(client(2));
    await p.persistClient(client(3));
    expect(schreiben).not.toHaveBeenCalled();
    await warte(DROSSEL * 3);
    expect(schreiben).toHaveBeenCalledTimes(1);
    expect((await speicher.lagebildLesen())?.client.timestamp).toBe(3);
  });

  it('schreibt nach dem Abbrechen keinen ausstehenden Durchlauf mehr', async () => {
    await datensatzAnlegen();
    const p = erzeugeLagebildPersister(BENUTZER.id, { drosselMs: DROSSEL });
    await p.persistClient(client(5));
    await p.abbrechen();
    await warte(DROSSEL * 3);
    expect((await speicher.lagebildLesen())?.client.timestamp).toBe(0);
    // Auch spätere Aufrufe bleiben wirkungslos: der Persister ist tot.
    await p.persistClient(client(6));
    await warte(DROSSEL * 3);
    expect((await speicher.lagebildLesen())?.client.timestamp).toBe(0);
  });

  it('legt keinen Datensatz an, wenn ein anderer Tab gelöscht hat', async () => {
    const p = erzeugeLagebildPersister(BENUTZER.id, { drosselMs: DROSSEL });
    await p.persistClient(client(9));
    await warte(DROSSEL * 3);
    expect(await speicher.lagebildLesen()).toBeUndefined();
  });

  it('stellt nur den Stand derselben Identität wieder her', async () => {
    await datensatzAnlegen();
    expect(await erzeugeLagebildPersister(BENUTZER.id).restoreClient()).toEqual(client(0));
    expect(await erzeugeLagebildPersister(99).restoreClient()).toBeUndefined();
  });

  it('löscht über removeClient den Datensatz', async () => {
    await datensatzAnlegen();
    await erzeugeLagebildPersister(BENUTZER.id).removeClient();
    expect(await speicher.lagebildLesen()).toBeUndefined();
  });

  it('wirft nicht, wenn die IndexedDB scheitert', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    speicher.lagebildSpeicherZuruecksetzenFuerTests();
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('blockiert');
    });
    const p = erzeugeLagebildPersister(BENUTZER.id, { drosselMs: DROSSEL });
    expect(() => p.persistClient(client(1))).not.toThrow();
    await warte(DROSSEL * 3);
    await expect(p.restoreClient()).resolves.toBeUndefined();
  });
});
