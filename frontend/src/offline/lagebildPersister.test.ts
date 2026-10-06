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

  it('hält bei langsamem Schreibweg höchstens einen laufenden und einen wartenden Stand (LFH-939)', async () => {
    await datensatzAnlegen();
    let gleichzeitig = 0;
    let hoechstens = 0;
    const schreiben = vi.fn(async (id: number, c: PersistedClient) => {
      gleichzeitig += 1;
      hoechstens = Math.max(hoechstens, gleichzeitig);
      await warte(DROSSEL * 4);
      await speicher.lagebildClientSchreiben(id, c);
      gleichzeitig -= 1;
    });
    const p = erzeugeLagebildPersister(BENUTZER.id, { drosselMs: DROSSEL, schreiben });
    const erzeugt: number[] = [];
    // Ein Ereignis je Drittel der Drossel über die Dauer mehrerer Schreibvorgänge.
    for (let i = 1; i <= 30; i++) {
      p.vormerken(() => {
        erzeugt.push(i);
        return client(i);
      });
      await warte(DROSSEL / 3);
    }
    await warte(DROSSEL * 12);
    expect(hoechstens).toBe(1);
    // Dehydriert wird nur, was auch geschrieben wird: kein Stand wartet in einer Kette.
    expect(erzeugt.length).toBe(schreiben.mock.calls.length);
    expect(erzeugt.length).toBeLessThan(10);
    expect((await speicher.lagebildLesen())?.client.timestamp).toBe(30);
  });

  it('wartet beim Abbrechen den laufenden Schreibvorgang ab und verwirft den wartenden', async () => {
    await datensatzAnlegen();
    const schreiben = vi.fn(async (id: number, c: PersistedClient) => {
      await warte(DROSSEL * 2);
      await speicher.lagebildClientSchreiben(id, c);
    });
    const p = erzeugeLagebildPersister(BENUTZER.id, { drosselMs: DROSSEL, schreiben });
    p.vormerken(() => client(1));
    await warte(DROSSEL * 1.5);
    const zweiter = vi.fn(() => client(2));
    p.vormerken(zweiter);
    await p.abbrechen();
    expect((await speicher.lagebildLesen())?.client.timestamp).toBe(1);
    await warte(DROSSEL * 4);
    expect(zweiter).not.toHaveBeenCalled();
    expect(schreiben).toHaveBeenCalledTimes(1);
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
