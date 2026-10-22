import { describe, expect, it } from 'vitest';
import type { Bereitstellungsraum } from '../../api/types';
import { brPatchAus } from './BrBearbeitenModal';

/**
 * Teil-Patch der Raumdaten mit dem Standort als Ortsfeld (LLH-1114, Spec `ortsfeld`): Text und
 * Koordinate gehen nur hinaus, wenn sie sich gegen den Stand beim Öffnen geändert haben; ein
 * geleerter Standort leert beide.
 */
const basis = {
  id: 1,
  bezeichnung: 'BR Alpha',
  standort: 'Marktplatz',
  notiz: null,
  lat: 53.0775,
  lon: 8.81,
} as unknown as Bereitstellungsraum;
const punkt = { lat: 53.0775, lon: 8.81 };

describe('brPatchAus · Standort als Ortsfeld (LLH-1114)', () => {
  it('Textkorrektur am verorteten Raum: nur der Text geht hinaus', () => {
    expect(
      brPatchAus(basis, {
        bezeichnung: 'BR Alpha',
        standort: { text: 'Marktplatz 2', koordinate: punkt, quelle: 'karte' },
      }),
    ).toEqual({ standort: 'Marktplatz 2' });
  });

  it('ein neuer Punkt geht als Paar hinaus, der Text bleibt draußen', () => {
    expect(
      brPatchAus(basis, {
        bezeichnung: 'BR Alpha',
        standort: { text: 'Marktplatz', koordinate: { lat: 53.1, lon: 8.82 }, quelle: 'karte' },
      }),
    ).toEqual({ lat: 53.1, lon: 8.82 });
  });

  it('geleerter Standort leert Text und Koordinate', () => {
    expect(
      brPatchAus(basis, { bezeichnung: 'BR Alpha', standort: { text: ' ', koordinate: punkt } }),
    ).toEqual({ standort: null, lat: null, lon: null });
  });

  it('unverändert: leerer Patch', () => {
    expect(
      brPatchAus(basis, {
        bezeichnung: 'BR Alpha',
        standort: { text: 'Marktplatz', koordinate: punkt, quelle: 'karte' },
      }),
    ).toEqual({});
  });
});
