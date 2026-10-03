import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Person } from '../api/types';
import { ortCacheRaeumen, ortKeyVon, setzeOrt } from '../anzeige/ortCache';
import {
  liesErfassungsSitzungswert,
  schreibeErfassungsSitzungswert,
} from '../components/erfassungsSitzung';
import { entwuerfeLeerenFuerTests, entwurfSpeichern } from '../etb/entwuerfe/entwurfStore';
import type { EtbEntwurf } from '../etb/entwuerfe/entwurfModell';
import { rohLesen } from '../test/rohIdb';
import { geraetFuerBenutzerRaeumen, geraetRaeumen } from './geraetRaeumung';
import {
  queueEinreihen,
  queueLeerenFuerTests,
  schreibaktionEinreihen,
  schreibaktionenLaden,
  schreibaktionPersonAbschliessen,
} from './queue';

const A = 11;
const B = 22;

function entwurf(over: Partial<EtbEntwurf> = {}): EtbEntwurf {
  const jetzt = new Date().toISOString();
  return {
    id: 'e-a',
    benutzer_id: A,
    einsatz_id: 7,
    inhalt: 'Pumpe 2 ausgefallen',
    typ: 'meldung',
    erstellt_at: jetzt,
    geaendert_at: jetzt,
    ...over,
  };
}

async function quittungAnlegen(benutzerId: number): Promise<void> {
  await schreibaktionEinreihen(benutzerId, 7, {
    art: 'person',
    daten: { name: 'Muster', status: 'erfasst', client_id: `q-${benutzerId}` },
  });
  const [zeile] = await schreibaktionenLaden(benutzerId, 7);
  const person = { id: 1, name: 'Muster', status: 'erfasst' } as unknown as Person;
  await schreibaktionPersonAbschliessen(benutzerId, zeile, person);
}

/** Alles, was eine Person auf dem Gerät hinterlässt, dazu ein offener Queue-Eintrag. */
async function geraetBefuellen(): Promise<void> {
  await entwurfSpeichern(entwurf());
  await quittungAnlegen(A);
  await setzeOrt(ortKeyVon(51.16, 10.45), 'Hauptstr. 5, Musterstadt');
  schreibeErfassungsSitzungswert(7, 'person', 'antreff_ort', 'Sammelstelle Süd');
  await queueEinreihen(A, 7, { typ: 'meldung', inhalt: 'offline vorgemerkt', client_id: 'etb-a' });
}

beforeEach(async () => {
  await entwuerfeLeerenFuerTests();
  await queueLeerenFuerTests();
  await ortCacheRaeumen();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('geraetRaeumen (LFH-767)', () => {
  it('Abmelden räumt Entwurf, Quittung, Ortscache und Erfassungswerte — die Queue bleibt', async () => {
    await geraetBefuellen();

    await geraetRaeumen('abmelden');

    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toEqual([]);
    expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]);
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([]);
    expect(liesErfassungsSitzungswert(7, 'person', 'antreff_ort')).toBeUndefined();
    expect(await rohLesen('lifeline-offline', 'ausstehend')).toHaveLength(1);
  });

  it('Sitzungsende behält den Entwurf und räumt den Rest', async () => {
    await geraetBefuellen();

    await geraetRaeumen('sitzungsende');

    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toHaveLength(1);
    expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]);
    expect(await rohLesen('lifeline-ortcache', 'ortsnamen')).toEqual([]);
    expect(liesErfassungsSitzungswert(7, 'person', 'antreff_ort')).toBeUndefined();
    expect(await rohLesen('lifeline-offline', 'ausstehend')).toHaveLength(1);
  });

  it('ein scheiternder Ort hält die übrigen nicht auf und wirft nicht', async () => {
    await geraetBefuellen();
    const fehler = vi.spyOn(console, 'error').mockImplementation(() => {});
    const leeren = IDBObjectStore.prototype.clear;
    vi.spyOn(IDBObjectStore.prototype, 'clear').mockImplementation(function (this: IDBObjectStore) {
      if (this.name === 'ortsnamen') throw new Error('Kontingent');
      return leeren.call(this);
    });

    await expect(geraetRaeumen('abmelden')).resolves.toBeUndefined();

    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toEqual([]);
    expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]);
    expect(liesErfassungsSitzungswert(7, 'person', 'antreff_ort')).toBeUndefined();
    expect(fehler).toHaveBeenCalled();
  });
});

describe('geraetFuerBenutzerRaeumen (LFH-767)', () => {
  it('räumt bei der Anmeldung von B die Entwürfe und Quittungen von A', async () => {
    await entwurfSpeichern(entwurf());
    await quittungAnlegen(A);
    await entwurfSpeichern(entwurf({ id: 'e-b', benutzer_id: B }));

    await geraetFuerBenutzerRaeumen(B);

    const entwuerfe = (await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')) as EtbEntwurf[];
    expect(entwuerfe.map((e) => e.id)).toEqual(['e-b']);
    expect(await rohLesen('lifeline-offline', 'personErfassungsQuittungen')).toEqual([]);
  });

  it('ohne Person bleibt ein junger Entwurf liegen', async () => {
    await entwurfSpeichern(entwurf());

    await geraetFuerBenutzerRaeumen(null);

    expect(await rohLesen('lifeline-etb-entwuerfe', 'entwuerfe')).toHaveLength(1);
  });
});
