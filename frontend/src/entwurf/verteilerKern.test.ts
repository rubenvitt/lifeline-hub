import { describe, expect, it } from 'vitest';
import type { FuehrungsfunktionEintrag, VerteilerEintrag } from '../api/types';
import {
  toVerteilerRequest,
  isVerteilerChanged,
  verteilerDruckzeile,
  verteilerNames,
  verteilerNamesFromForm,
  toVerteilerFormValues,
  type VerteilerSources,
} from './verteilerKern';

const eintrag = (
  funktion: FuehrungsfunktionEintrag['funktion'],
  label: string,
  kuerzel: string | null,
  bezeichnung_pflicht = false,
): FuehrungsfunktionEintrag =>
  ({
    funktion,
    label,
    standard_label: label,
    kuerzel,
    art: 'sachgebiet',
    bezeichnung_pflicht,
  }) as FuehrungsfunktionEintrag;

const katalog = [
  eintrag('el', 'Einsatzleitung', 'EL'),
  eintrag('s3', 'Einsatz', 'S3'),
  eintrag('fachberater', 'Fachberater', null, true),
];

const quellen: VerteilerSources = {
  abschnitte: [{ id: 3, name: 'EA Süd' }],
  einheiten: [{ id: 9, name: '1. Zug' }],
  vorschlaege: { katalog, besetzung: new Map([['s3', 'Schulz']]) },
};

const gespeichert: VerteilerEintrag[] = [
  { id: 1, empfaenger_typ: 'abschnitt', abschnitt_id: 3, snap_anzeige: 'EA Süd' },
  { id: 2, empfaenger_typ: 'funktion', funktion: 's3', snap_anzeige: 'S3 Einsatz' },
  {
    id: 3,
    empfaenger_typ: 'funktion',
    funktion: 'fachberater',
    funktion_text: 'THW',
    snap_anzeige: 'Fachberater: THW',
  },
  {
    id: 4,
    empfaenger_typ: 'extern',
    extern_kategorie: 'leitstelle',
    extern_bezeichnung: 'ILS Musterstadt',
    snap_anzeige: 'ILS Musterstadt',
  },
];

describe('verteilerKern (LLH-1172)', () => {
  it('gespeicherter Verteiler → Formularwert → Request, hin und zurück', () => {
    const werte = toVerteilerFormValues(gespeichert);
    expect(werte).toEqual({
      intern: ['abschnitt:3', 'funktion:s3', 'funktion:fachberater:THW'],
      extern: [{ kategorie: 'leitstelle', bezeichnung: 'ILS Musterstadt' }],
    });
    expect(toVerteilerRequest(werte, katalog)).toEqual([
      { empfaenger_typ: 'abschnitt', abschnitt_id: 3 },
      { empfaenger_typ: 'funktion', funktion: 's3' },
      { empfaenger_typ: 'funktion', funktion: 'fachberater', funktion_text: 'THW' },
      {
        empfaenger_typ: 'extern',
        extern_kategorie: 'leitstelle',
        extern_bezeichnung: 'ILS Musterstadt',
      },
    ]);
  });

  it('eine leere externe Zeile fällt weg, ein leerer Verteiler bleibt leer', () => {
    expect(
      toVerteilerRequest(
        { intern: [], extern: [{ kategorie: 'leitstelle', bezeichnung: '  ' }] },
        katalog,
      ),
    ).toEqual([]);
    expect(toVerteilerRequest(undefined, katalog)).toEqual([]);
    expect(toVerteilerFormValues([])).toEqual({ intern: [], extern: [] });
  });

  it('ein gelöschter Abschnitt bleibt mit seinem Namen stehen', () => {
    const werte = toVerteilerFormValues([
      { id: 1, empfaenger_typ: 'abschnitt', snap_anzeige: 'EA Nord' },
    ]);
    expect(werte.intern).toEqual(['EA Nord']);
  });

  it('Namen für den Druckkopf: wie der Snapshot des Servers, ohne Besetzung', () => {
    expect(
      verteilerNamesFromForm(
        {
          intern: [
            'abschnitt:3',
            'einheit:9',
            'funktion:s3',
            'funktion:el',
            'funktion:fachberater:THW',
            'Verbindungsstelle',
          ],
          extern: [
            { kategorie: 'leitstelle', bezeichnung: ' ILS Musterstadt ' },
            { bezeichnung: '' },
          ],
        },
        quellen,
        [],
      ),
    ).toEqual([
      'EA Süd',
      '1. Zug',
      'S3 Einsatz',
      'Einsatzleitung',
      'Fachberater: THW',
      'Verbindungsstelle',
      'ILS Musterstadt',
    ]);
  });

  it('ohne geladene Optionen nennt der Druckkopf den gespeicherten Namen', () => {
    const ohne: VerteilerSources = {
      abschnitte: [],
      einheiten: [],
      vorschlaege: quellen.vorschlaege,
    };
    expect(
      verteilerNamesFromForm({ intern: ['abschnitt:3'], extern: [] }, ohne, gespeichert),
    ).toEqual(['EA Süd']);
  });

  it('Druckzeile nur mit Namen', () => {
    expect(verteilerDruckzeile([])).toEqual([]);
    expect(verteilerDruckzeile(verteilerNames(gespeichert))).toEqual([
      { etikett: 'Verteiler', wert: 'EA Süd, S3 Einsatz, Fachberater: THW, ILS Musterstadt' },
    ]);
  });

  it('ein gespeicherter Funktionseintrag geht auch ohne geladenen Katalog als Funktion zurück', () => {
    const werte = toVerteilerFormValues(gespeichert);
    expect(toVerteilerRequest(werte, [], gespeichert)).toEqual([
      { empfaenger_typ: 'abschnitt', abschnitt_id: 3 },
      { empfaenger_typ: 'funktion', funktion: 's3' },
      { empfaenger_typ: 'funktion', funktion: 'fachberater', funktion_text: 'THW' },
      {
        empfaenger_typ: 'extern',
        extern_kategorie: 'leitstelle',
        extern_bezeichnung: 'ILS Musterstadt',
      },
    ]);
    // Gegenprobe: ohne den gespeicherten Stand würde der Tag zum Freitext.
    expect(toVerteilerRequest({ intern: ['funktion:s3'], extern: [] }, [])).toEqual([
      { empfaenger_typ: 'funktion', funktion_text: 'funktion:s3' },
    ]);
  });

  it('geändert nur bei einer echten Abweichung vom gespeicherten Verteiler', () => {
    expect(isVerteilerChanged(undefined, gespeichert)).toBe(false);
    expect(isVerteilerChanged(toVerteilerFormValues(gespeichert), gespeichert)).toBe(false);
    expect(isVerteilerChanged({ intern: [], extern: [] }, [])).toBe(false);
    expect(isVerteilerChanged({ intern: ['abschnitt:3'], extern: [] }, [])).toBe(true);
    const werte = toVerteilerFormValues(gespeichert);
    expect(
      isVerteilerChanged(
        { ...werte, extern: [{ kategorie: 'leitstelle', bezeichnung: 'ILS Musterstadt ' }] },
        gespeichert,
      ),
    ).toBe(false);
    expect(isVerteilerChanged({ ...werte, extern: [] }, gespeichert)).toBe(true);
  });
});
