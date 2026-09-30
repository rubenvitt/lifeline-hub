import { describe, expect, it } from 'vitest';
import type { Einheit, Einsatzabschnitt, Sprechgruppe } from '../api/types';
import {
  abschnitteOhneSprechgruppe,
  einheitenOhneErreichbarkeit,
  einheitenOhneSprechgruppe,
  lokaleSprechgruppenOhneZuordnung,
  type Quelle,
} from './luecken';

function sg(id: number, bezeichnung: string, lokal = false): Sprechgruppe {
  return {
    id,
    bezeichnung,
    betriebsart: 'TMO',
    aktiv: true,
    einsatz_lokal: lokal,
    einsatz_id: lokal ? 1 : null,
    sortier: id,
  };
}

function abschnitt(id: number, sprechgruppen: Sprechgruppe[] = []): Einsatzabschnitt {
  return { id, einsatz_id: 1, name: `A${id}`, sortier: id, sprechgruppen };
}

function einheit(
  id: number,
  {
    sprechgruppen = [],
    erreichbarkeit = null,
  }: { sprechgruppen?: Sprechgruppe[]; erreichbarkeit?: string | null } = {},
): Einheit {
  return {
    id,
    einsatz_id: 1,
    name: `E${id}`,
    sortier: id,
    sprechgruppen,
    erreichbarkeit,
    fahrzeug_mitglieder: [],
    material_mitglieder: [],
    personal_mitglieder: [],
    ist: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    ist_kumuliert: { fuehrer: 0, unterfuehrer: 0, mannschaft: 0 },
    status: { quelle: 'ohne', verteilung: [] },
  } as Einheit;
}

const daten = <T>(d: T[]): Quelle<T> => ({ zustand: 'daten', daten: d });
const gesperrt = <T>(): Quelle<T> => ({ zustand: 'gesperrt', daten: [] });
const laden = <T>(): Quelle<T> => ({ zustand: 'laden', daten: [] });

describe('abschnitteOhneSprechgruppe', () => {
  it('trifft nur Abschnitte ohne zugeordnete Sprechgruppe', () => {
    const l = abschnitteOhneSprechgruppe(daten([abschnitt(1, [sg(1, '311')]), abschnitt(2)]));
    expect(l.zustand).toBe('daten');
    expect(l.treffer.map((a) => a.id)).toEqual([2]);
  });

  it('meldet den Leerfall nur mit geladenen Daten', () => {
    expect(abschnitteOhneSprechgruppe(daten([abschnitt(1, [sg(1, '311')])]))).toEqual({
      zustand: 'daten',
      treffer: [],
    });
  });

  it('behauptet ohne Daten keine Zahl', () => {
    expect(abschnitteOhneSprechgruppe(gesperrt())).toEqual({ zustand: 'gesperrt', treffer: [] });
    expect(abschnitteOhneSprechgruppe(laden())).toEqual({ zustand: 'laden', treffer: [] });
  });
});

describe('einheitenOhneSprechgruppe / einheitenOhneErreichbarkeit', () => {
  it('trifft Einheiten ohne Sprechgruppe', () => {
    const l = einheitenOhneSprechgruppe(
      daten([einheit(1), einheit(2, { sprechgruppen: [sg(1, '311')] })]),
    );
    expect(l.treffer.map((e) => e.id)).toEqual([1]);
  });

  it('zählt eine leere oder nur aus Leerzeichen bestehende Erreichbarkeit als fehlend', () => {
    const l = einheitenOhneErreichbarkeit(
      daten([
        einheit(1, { erreichbarkeit: '0171 1234567' }),
        einheit(2, { erreichbarkeit: '   ' }),
        einheit(3),
      ]),
    );
    expect(l.treffer.map((e) => e.id)).toEqual([2, 3]);
  });

  it('reicht den Zustand der Quelle durch', () => {
    expect(einheitenOhneErreichbarkeit({ zustand: 'fehler', daten: [] }).zustand).toBe('fehler');
  });
});

describe('lokaleSprechgruppenOhneZuordnung', () => {
  const lokalFrei = sg(10, 'DMO 999', true);
  const lokalAmAbschnitt = sg(11, 'TMO 311', true);
  const lokalAnEinheit = sg(12, 'TMO 312', true);
  const katalogFrei = sg(13, 'TMO 400');

  it('trifft nur einsatzlokale Sprechgruppen, die weder Abschnitt noch Einheit tragen', () => {
    const l = lokaleSprechgruppenOhneZuordnung(
      daten([lokalFrei, lokalAmAbschnitt, lokalAnEinheit, katalogFrei]),
      daten([abschnitt(1, [lokalAmAbschnitt])]),
      daten([einheit(1, { sprechgruppen: [lokalAnEinheit] })]),
    );
    expect(l.zustand).toBe('daten');
    expect(l.treffer.map((s) => s.bezeichnung)).toEqual(['DMO 999']);
  });

  it('nimmt den schlechtesten Zustand der drei Quellen und behauptet dann keine Zahl', () => {
    const l = lokaleSprechgruppenOhneZuordnung(daten([lokalFrei]), daten([]), gesperrt());
    expect(l).toEqual({ zustand: 'gesperrt', treffer: [] });
    expect(lokaleSprechgruppenOhneZuordnung(laden(), daten([]), daten([])).zustand).toBe('laden');
  });
});
