import { describe, expect, it } from 'vitest';
import { ortEingabe, ortFelder, ortsfeldAusGespeichert } from './ortsfeldFormular';

/**
 * Abbildung des Ortsfelds auf die Wire-Felder (LLH-1121 D2, LLH-1534). Dass ein geleerter Text auch
 * die Koordinate leert, regelt das Feld (`nachTextaenderung`, `Ortsfeld.karte.test.tsx`); hier geht
 * hinaus, was das Feld zeigt.
 *
 * Mutationsprobe (von Hand, rot gesehen, dann zurückgedreht): `ortFelder` schickt die Koordinate
 * wieder nur neben einem Text — rot in „ein ohne Text gespeicherter Punkt geht wieder hinaus“.
 */
describe('ortFelder', () => {
  it('Text und Koordinate gehen gemeinsam hinaus, der Text getrimmt', () => {
    expect(
      ortFelder({ text: ' Turnhalle ', koordinate: { lat: 1, lon: 2 }, quelle: 'adresse' }),
    ).toEqual({ text: 'Turnhalle', lat: 1, lon: 2 });
  });

  it('ohne Angabe sind beide leer; ohne Text fällt eine Koordinate aus Treffer oder Eingabe weg', () => {
    expect(ortFelder({ text: '  ', koordinate: null })).toEqual({
      text: null,
      lat: null,
      lon: null,
    });
    expect(ortFelder({ text: ' ', koordinate: { lat: 1, lon: 2 }, quelle: 'adresse' })).toEqual({
      text: null,
      lat: null,
      lon: null,
    });
    expect(ortFelder(undefined)).toEqual({ text: null, lat: null, lon: null });
  });

  it('ein ohne Text gespeicherter Punkt geht wieder hinaus, statt still zu verschwinden', () => {
    // Etwa auf der Lagekarte verortet: das Feld zeigt den Punkt, also bleibt die Sache verortet.
    const gespeichert = ortsfeldAusGespeichert(null, 1, 2);
    expect(gespeichert).toEqual({ text: '', koordinate: { lat: 1, lon: 2 }, quelle: 'karte' });
    expect(ortFelder(gespeichert)).toEqual({ text: null, lat: 1, lon: 2 });
  });
});

describe('ortEingabe', () => {
  it('lässt fehlende Angaben weg', () => {
    expect(ortEingabe({ text: '', koordinate: null })).toEqual({});
    expect(ortEingabe({ text: 'Deich', koordinate: null })).toEqual({ text: 'Deich' });
    expect(ortEingabe({ text: 'Deich', koordinate: { lat: 1, lon: 2 }, quelle: 'karte' })).toEqual({
      text: 'Deich',
      lat: 1,
      lon: 2,
    });
  });
});
