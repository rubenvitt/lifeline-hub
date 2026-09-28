import { afterEach, describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { BenutzerAnzeige } from '../api/types';
import { einsatzKeys } from '../api/queryKeys';
import { lagebildAnlegen, lagebildLesen, lagebildLoeschenPlatte } from './lagebildSpeicher';
import {
  lagebildAnmelden,
  lagebildBeenden,
  lagebildLoeschen,
  lagebildStarten,
} from './lagebildSitzung';
import { HOECHSTLIEGEZEIT_MS } from './lagebildStart';
import { queueAlleLaden, queueEinreihen, queueLeerenFuerTests } from './queue';

const A = { id: 7, benutzername: 'a', anzeigename: 'A' } as BenutzerAnzeige;
const B = { id: 8, benutzername: 'b', anzeigename: 'B' } as BenutzerAnzeige;
const DROSSEL = 20;
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wartet, bis der gedrosselte Persister den Stand geschrieben hat. */
async function warteAufGeschrieben(pruefen: (anzahl: number) => boolean) {
  for (let i = 0; i < 50; i++) {
    const satz = await lagebildLesen();
    if (satz && pruefen(satz.client.clientState.queries.length)) return satz;
    await warte(DROSSEL);
  }
  throw new Error('nicht geschrieben');
}

const clients: QueryClient[] = [];
function neuerClient() {
  const qc = new QueryClient();
  clients.push(qc);
  return qc;
}

afterEach(async () => {
  for (const qc of clients.splice(0)) await lagebildBeenden(qc);
  await lagebildLoeschenPlatte();
});

describe('Lagebild-Sitzung', () => {
  it('schreibt nach dem Start mit Serverbestätigung die Allowlist und nur sie', async () => {
    const qc = neuerClient();
    expect(await lagebildStarten(qc, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL })).toBe(A);
    qc.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    qc.setQueryData(einsatzKeys.chatNachrichten(3), [{ id: 2 }]);
    const satz = await warteAufGeschrieben((n) => n > 0);
    expect(satz.benutzer).toEqual(A);
    expect(satz.client.clientState.queries.map((q) => q.queryKey)).toEqual([
      einsatzKeys.personen(3),
    ]);
  });

  it('schreibt auch, was schon VOR dem Abonnieren im Cache lag', async () => {
    // Serverbestätigt hängen die Seiten ihre Abfragen ein, während die Wiederherstellung noch
    // läuft — sind sie fertig, bevor das Abonnement steht, kommt kein Cache-Ereignis mehr
    // (gemessen an der Lagekarte im e2e: der Datensatz blieb leer).
    const qc = neuerClient();
    qc.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    await lagebildStarten(qc, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    const satz = await warteAufGeschrieben((n) => n > 0);
    expect(satz.client.clientState.queries.map((q) => q.queryKey)).toEqual([
      einsatzKeys.personen(3),
    ]);
  });

  it('stellt den Stand nach einem Netzfehler als dieselbe Person wieder her', async () => {
    const erster = neuerClient();
    await lagebildStarten(erster, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    erster.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    await warteAufGeschrieben((n) => n > 0);
    await lagebildBeenden(erster);

    const zweiter = neuerClient();
    expect(await lagebildStarten(zweiter, { art: 'netzfehler' }, { drosselMs: DROSSEL })).toEqual(
      A,
    );
    expect(zweiter.getQueryData(einsatzKeys.personen(3))).toEqual([{ id: 1 }]);
  });

  it('löscht bei einer Server-Ablehnung und stellt nichts wieder her', async () => {
    const erster = neuerClient();
    await lagebildStarten(erster, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    erster.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    await warteAufGeschrieben((n) => n > 0);
    await lagebildBeenden(erster);

    const zweiter = neuerClient();
    expect(await lagebildStarten(zweiter, { art: 'abgelehnt' })).toBeNull();
    expect(zweiter.getQueryCache().getAll()).toHaveLength(0);
    expect(await lagebildLesen()).toBeUndefined();
  });

  it('stellt für einen anderen Benutzer nichts wieder her und ersetzt den Datensatz', async () => {
    const erster = neuerClient();
    await lagebildStarten(erster, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    erster.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    await warteAufGeschrieben((n) => n > 0);
    await lagebildBeenden(erster);

    const zweiter = neuerClient();
    expect(await lagebildStarten(zweiter, { art: 'ok', benutzer: B })).toBe(B);
    expect(zweiter.getQueryCache().getAll()).toHaveLength(0);
    const satz = await lagebildLesen();
    expect(satz?.benutzer).toEqual(B);
    expect(satz?.client.clientState.queries).toEqual([]);
  });

  it('verwirft einen Stand, dessen letzte Bestätigung älter als 24 h ist', async () => {
    await lagebildAnlegen({
      benutzer: A,
      bestaetigtAt: Date.now() - HOECHSTLIEGEZEIT_MS - 1,
      buster: __APP_VERSION__,
      client: {
        timestamp: Date.now(),
        buster: __APP_VERSION__,
        clientState: { queries: [], mutations: [] },
      },
    });
    const qc = neuerClient();
    expect(await lagebildStarten(qc, { art: 'netzfehler' })).toBeNull();
    expect(await lagebildLesen()).toBeUndefined();
  });

  it('räumt beim Löschen Speicher und Platte und schreibt danach nichts mehr', async () => {
    const qc = neuerClient();
    await lagebildStarten(qc, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    qc.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    await warteAufGeschrieben((n) => n > 0);
    // Eine Änderung, deren gedrosselter Durchlauf noch aussteht:
    qc.setQueryData(einsatzKeys.einheiten(3), [{ id: 2 }]);
    await lagebildLoeschen(qc);
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    await warte(DROSSEL * 4);
    expect(await lagebildLesen()).toBeUndefined();
    // Auch spätere Änderungen legen nichts wieder an.
    qc.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    await warte(DROSSEL * 4);
    expect(await lagebildLesen()).toBeUndefined();
  });

  it('lässt die Offline-Queue beim Löschen stehen', async () => {
    await queueLeerenFuerTests();
    await queueEinreihen(A.id, 3, { typ: 'meldung', inhalt: 'Beweis' } as Parameters<
      typeof queueEinreihen
    >[2]);
    const qc = neuerClient();
    await lagebildStarten(qc, { art: 'ok', benutzer: A });
    await lagebildLoeschen(qc);
    expect(await queueAlleLaden(A.id)).toHaveLength(1);
    await queueLeerenFuerTests();
  });

  it('räumt bei der Anmeldung eines anderen Benutzers den Stand des vorherigen', async () => {
    const qc = neuerClient();
    await lagebildStarten(qc, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    qc.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    await warteAufGeschrieben((n) => n > 0);
    await lagebildAnmelden(qc, B, { drosselMs: DROSSEL });
    expect(qc.getQueryCache().getAll()).toHaveLength(0);
    const satz = await lagebildLesen();
    expect(satz?.benutzer).toEqual(B);
    expect(satz?.client.clientState.queries).toEqual([]);
  });

  it('behält bei erneuter Anmeldung derselben Person Speicher und Platte', async () => {
    const qc = neuerClient();
    await lagebildStarten(qc, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL });
    qc.setQueryData(einsatzKeys.personen(3), [{ id: 1 }]);
    await warteAufGeschrieben((n) => n > 0);
    await lagebildAnmelden(qc, A, { drosselMs: DROSSEL });
    expect(qc.getQueryData(einsatzKeys.personen(3))).toEqual([{ id: 1 }]);
    expect((await lagebildLesen())?.client.clientState.queries).toHaveLength(1);
  });

  it('bewegt die Bestätigung mit einem Fetch-Erfolg, nicht mit setQueryData', async () => {
    const qc = neuerClient();
    await lagebildStarten(qc, { art: 'ok', benutzer: A }, { drosselMs: DROSSEL, jetzt: 1000 });
    expect((await lagebildLesen())?.bestaetigtAt).toBe(1000);
    qc.setQueryData(einsatzKeys.personen(3), []);
    await warte(DROSSEL * 3);
    expect((await lagebildLesen())?.bestaetigtAt).toBe(1000);
    await qc.fetchQuery({ queryKey: einsatzKeys.einheiten(3), queryFn: async () => [] });
    await warte(DROSSEL * 3);
    expect((await lagebildLesen())?.bestaetigtAt).toBeGreaterThan(1000);
  });
});
