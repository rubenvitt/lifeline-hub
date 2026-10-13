import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import type { MedienkontaktKennzahlen, ModulZaehler } from '../api/types';
import { werkzeugZahl, type WerkzeugZahlQuellen } from './werkzeugZahlen';
import type { SichtbaresWerkzeug } from './werkzeuge';

const werkzeug = (key: string, modulKey = key): SichtbaresWerkzeug => ({
  zustand: 'frei',
  key,
  label: key,
  modulKey,
  pfad: () => '/',
});
const abfrage = <T>(data: T | undefined, fehler?: unknown) => ({
  data,
  error: fehler ?? null,
  isError: fehler != null,
  isPending: data == null && fehler == null,
});
const ZAEHLER: ModulZaehler = {
  auftraege: { offen: 2, in_arbeit: 1, ueberfaellig: 1 },
  meldungen: { offen: 3, ungesehen: 2, bestaetigung_ueberfaellig: 0 },
  einheiten: { gesamt: 0 },
  etb: { gesamt: 47 },
  lagemeldungen: { neu: 4 },
};
const PRESSE = { offene_anfragen: 2 } as MedienkontaktKennzahlen;
/** Der Wert einer Zahl im Zustand `daten`, sonst `undefined`. */
const wertVon = (z: ReturnType<typeof werkzeugZahl>) =>
  z?.zustand === 'daten' ? z.wert : undefined;
const quellen = (over: Partial<WerkzeugZahlQuellen> = {}): WerkzeugZahlQuellen => ({
  zaehler: abfrage(ZAEHLER),
  presse: abfrage(PRESSE),
  funkplan: { zustand: 'daten', anzahl: 3 },
  ...over,
});

describe('werkzeugZahl (design.md D4)', () => {
  it('Aufträge: die offenen als Achtung, wenn welche überfällig sind, mit Wort', () => {
    expect(werkzeugZahl(werkzeug('auftraege'), quellen())).toMatchObject({
      zustand: 'daten',
      wert: '2',
      notiz: '1 überfällig',
      ton: 'achtung',
    });
  });

  it('Aufträge ohne überfällige bleiben neutral', () => {
    const z = { ...ZAEHLER, auftraege: { offen: 2, in_arbeit: 0, ueberfaellig: 0 } };
    expect(werkzeugZahl(werkzeug('auftraege'), quellen({ zaehler: abfrage(z) }))).toMatchObject({
      wert: '2',
      ton: 'neutral',
    });
  });

  it('Meldungen und Bestandszähler zeigen dieselbe Zahl wie das Modulmenü', () => {
    expect(werkzeugZahl(werkzeug('meldungen'), quellen())).toMatchObject({
      wert: '3',
      notiz: '2 neu',
    });
    expect(wertVon(werkzeugZahl(werkzeug('etb'), quellen()))).toBe('47');
    // Eine Null ist ein Wert, kein Zustand.
    expect(wertVon(werkzeugZahl(werkzeug('einheiten'), quellen()))).toBe('0');
  });

  // LLH-1206: dieselbe Zahl und derselbe Wortlaut wie im Modulmenü.
  it('Lagemeldungen zeigen die neuen wie das Modulmenü', () => {
    expect(werkzeugZahl(werkzeug('lagemeldungen'), quellen())).toMatchObject({
      zustand: 'daten',
      wert: '4',
      beschreibung: '4 neue Lagemeldungen',
      ton: 'neutral',
    });
  });

  it('ein Modul ohne Zähler zeigt keine Zahl', () => {
    expect(werkzeugZahl(werkzeug('nachforderungen'), quellen())).toBeNull();
    expect(werkzeugZahl(werkzeug('infotelefon', 'stab'), quellen())).toBeNull();
  });

  it('fehlt das Feld in der Antwort, steht „—“ mit Grund, nie 0', () => {
    expect(werkzeugZahl(werkzeug('einsatzabschnitte'), quellen())).toMatchObject({
      zustand: 'daten',
      wert: '—',
      notiz: 'nicht freigegeben',
    });
  });

  it('solange der Zähler lädt oder gescheitert ist, steht kein Wert', () => {
    expect(
      werkzeugZahl(werkzeug('auftraege'), quellen({ zaehler: abfrage(undefined) }))?.zustand,
    ).toBe('laden');
    const kaputt = quellen({ zaehler: abfrage(undefined, new ApiError(500, 'kaputt')) });
    expect(werkzeugZahl(werkzeug('auftraege'), kaputt)).toMatchObject({
      zustand: 'fehler',
      notiz: 'nicht geladen',
    });
  });

  it('Pressearbeit zeigt die offenen Anfragen, gesperrt „—“', () => {
    expect(werkzeugZahl(werkzeug('presse', 'stab'), quellen())).toMatchObject({
      wert: '2',
      notiz: 'offene Anfragen',
    });
    const gesperrt = quellen({ presse: abfrage(undefined, new ApiError(403, 'verboten')) });
    expect(werkzeugZahl(werkzeug('presse', 'stab'), gesperrt)).toMatchObject({
      wert: '—',
      notiz: 'nicht freigegeben',
    });
  });

  it('Funkplan zeigt die Zahl der Lücken, ohne Teilsumme bei fehlender Quelle', () => {
    expect(werkzeugZahl(werkzeug('funkplan', 'fernmeldewesen'), quellen())).toMatchObject({
      wert: '3',
      notiz: 'Lücken',
    });
    const eine = quellen({ funkplan: { zustand: 'daten', anzahl: 1 } });
    expect(werkzeugZahl(werkzeug('funkplan', 'fernmeldewesen'), eine)?.notiz).toBe('Lücke');
    const gesperrt = quellen({ funkplan: { zustand: 'gesperrt', anzahl: null } });
    expect(werkzeugZahl(werkzeug('funkplan', 'fernmeldewesen'), gesperrt)).toMatchObject({
      wert: '—',
      notiz: 'nicht freigegeben',
    });
  });

  it('ohne Netz und ohne Stand „nicht geladen“ statt endlos „lädt“', () => {
    const offline = quellen({
      presse: abfrage(undefined),
      zaehler: abfrage(undefined),
      ohneVerbindung: true,
    });
    expect(werkzeugZahl(werkzeug('presse', 'stab'), offline)).toMatchObject({
      zustand: 'fehler',
      notiz: 'nicht geladen',
    });
    expect(werkzeugZahl(werkzeug('auftraege'), offline)?.zustand).toBe('fehler');
    // Mit vorgehaltenem Stand bleibt die Zahl.
    expect(wertVon(werkzeugZahl(werkzeug('etb'), quellen({ ohneVerbindung: true })))).toBe('47');
  });

  it('ein gesperrtes Werkzeug trägt nie eine Zahl', () => {
    expect(werkzeugZahl({ ...werkzeug('auftraege'), zustand: 'gesperrt' }, quellen())).toBeNull();
  });
});
