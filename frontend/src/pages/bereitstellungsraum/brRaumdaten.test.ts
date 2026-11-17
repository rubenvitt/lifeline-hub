import { describe, expect, it } from 'vitest';
import type { Bereitstellungsraum } from '../../api/types';
import { brPatch, brRaumdatenWerte } from './brRaumdaten';

/**
 * Teil-Patch der Raumdaten (LFH-1147, LLH-1920) mit dem Standort als Ortsfeld (LLH-1114, Spec
 * `ortsfeld`): verglichen werden die Werte beim Öffnen mit den Eingaben. Text und Koordinate gehen
 * nur hinaus, wenn sie sich geändert haben; ein geleerter Standort leert beide.
 */
const raum = {
  id: 1,
  bezeichnung: 'BR Alpha',
  standort: 'Marktplatz',
  notiz: null,
  lat: 53.0775,
  lon: 8.81,
} as unknown as Bereitstellungsraum;
const vorher = brRaumdatenWerte(raum);
const punkt = { lat: 53.0775, lon: 8.81 };

describe('brRaumdatenWerte', () => {
  it('belegt Bezeichnung, Standort mit Koordinate und eine fehlende Notiz leer', () => {
    expect(vorher.bezeichnung).toBe('BR Alpha');
    expect(vorher.standort).toMatchObject({ text: 'Marktplatz', koordinate: punkt });
    expect(vorher.notiz).toBe('');
  });
});

describe('brPatch · Standort als Ortsfeld (LLH-1114)', () => {
  it('Textkorrektur am verorteten Raum: nur der Text geht hinaus', () => {
    expect(
      brPatch(vorher, {
        ...vorher,
        standort: { text: 'Marktplatz 2', koordinate: punkt, quelle: 'karte' },
      }),
    ).toEqual({ standort: 'Marktplatz 2' });
  });

  it('ein neuer Punkt geht als Paar hinaus, der Text bleibt draußen', () => {
    expect(
      brPatch(vorher, {
        ...vorher,
        standort: { text: 'Marktplatz', koordinate: { lat: 53.1, lon: 8.82 }, quelle: 'karte' },
      }),
    ).toEqual({ lat: 53.1, lon: 8.82 });
  });

  it('geleerter Standort leert Text und Koordinate', () => {
    expect(brPatch(vorher, { ...vorher, standort: { text: ' ', koordinate: punkt } })).toEqual({
      standort: null,
      lat: null,
      lon: null,
    });
  });

  it('unverändert: leerer Patch', () => {
    expect(brPatch(vorher, { ...vorher })).toEqual({});
  });
});

describe('brPatch · Bezeichnung und Notiz', () => {
  it('getrimmte Bezeichnung, geleerte Notiz als null', () => {
    const mitNotiz = brRaumdatenWerte({ ...raum, notiz: 'Zufahrt Nord' } as Bereitstellungsraum);
    expect(brPatch(mitNotiz, { ...mitNotiz, bezeichnung: ' BR Beta ', notiz: '  ' })).toEqual({
      bezeichnung: 'BR Beta',
      notiz: null,
    });
  });
});
