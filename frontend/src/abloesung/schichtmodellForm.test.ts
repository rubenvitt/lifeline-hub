import { describe, expect, it } from 'vitest';
import { buildWerteBody, toFormWerte, vorlaufKopf } from './schichtmodellForm';
import { formatRegel, formatRegelKurz } from './schichtmodellText';

const hochwasser = {
  bezeichnung: '12-h-Schicht Hochwasser',
  typ: 'wechselzeiten' as const,
  wechselzeiten: ['06:00', '18:00'],
  mindestdauer_minuten: 240,
  vorwarnung_minuten: 45,
  planungsvorlauf_minuten: 120,
};

describe('Schichtmodell-Formular (LLH-1122)', () => {
  it('belegt Dauern als „h:mm“-Text vor und Wechselzeiten taktisch', () => {
    expect(toFormWerte(hochwasser)).toEqual({
      bezeichnung: '12-h-Schicht Hochwasser',
      typ: 'wechselzeiten',
      rhythmus: undefined,
      wechselzeiten: '0600/1800',
      mindestdauer: '4 h',
      vorwarnung: '45 min',
      // Gleich der Vorgabe: leer, der Platzhalter zeigt den Wert.
      planungsvorlauf: undefined,
    });
    expect(
      toFormWerte({
        bezeichnung: 'SanD',
        typ: 'rhythmus',
        rhythmus_minuten: 450,
        vorwarnung_minuten: 30,
        planungsvorlauf_minuten: 120,
      }),
    ).toMatchObject({ typ: 'rhythmus', rhythmus: '7:30 h', vorwarnung: undefined });
    expect(toFormWerte(null)).toEqual({ typ: 'rhythmus' });
  });

  it('schickt nur die Felder des Typs und lässt leere Vorläufe weg', () => {
    expect(
      buildWerteBody({
        bezeichnung: '  SanD 6 h ',
        typ: 'rhythmus',
        rhythmus: '6',
        // Liegengebliebene Felder des anderen Typs gehen nicht mit (sonst 422).
        wechselzeiten: '0600',
        mindestdauer: '4 h',
      }),
    ).toEqual({ bezeichnung: 'SanD 6 h', typ: 'rhythmus', rhythmus_minuten: 360 });
    expect(
      buildWerteBody({
        bezeichnung: 'Hochwasser',
        typ: 'wechselzeiten',
        rhythmus: '12',
        wechselzeiten: '1800 0600',
        mindestdauer: '4:00',
        vorwarnung: '45 min',
        planungsvorlauf: '3 h',
      }),
    ).toEqual({
      bezeichnung: 'Hochwasser',
      typ: 'wechselzeiten',
      wechselzeiten: ['06:00', '18:00'],
      mindestdauer_minuten: 240,
      vorwarnung_minuten: 45,
      planungsvorlauf_minuten: 180,
    });
  });

  it('liest die eigene Vorbelegung unverändert zurück', () => {
    const body = buildWerteBody(toFormWerte(hochwasser));
    expect(body).toEqual({
      bezeichnung: hochwasser.bezeichnung,
      typ: 'wechselzeiten',
      wechselzeiten: ['06:00', '18:00'],
      mindestdauer_minuten: 240,
      vorwarnung_minuten: 45,
    });
  });

  it('der Kopf des Klappteils nennt die wirksamen Werte samt Vorgabe', () => {
    expect(vorlaufKopf({})).toBe('Vorwarnung 30 min (Vorgabe) · Planungsvorlauf 2 h (Vorgabe)');
    expect(vorlaufKopf({ vorwarnung: '45 min', planungsvorlauf: '1:30' })).toBe(
      'Vorwarnung 45 min · Planungsvorlauf 1:30 h',
    );
  });

  it('beschreibt die Regel lesbar, Wechselzeiten taktisch', () => {
    expect(formatRegel(hochwasser)).toBe('Wechsel 0600/1800 · Mindestdauer 4 h');
    expect(formatRegel({ ...hochwasser, mindestdauer_minuten: 0 })).toBe('Wechsel 0600/1800');
    expect(formatRegel({ typ: 'rhythmus', rhythmus_minuten: 720 })).toBe('Rhythmus 12 h');
    expect(formatRegelKurz(hochwasser)).toBe('Wechsel 0600/1800');
    expect(formatRegelKurz({ typ: 'rhythmus', rhythmus_minuten: 450 })).toBe('7:30 h');
  });
});
