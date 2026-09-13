import { describe, expect, it } from 'vitest';
import type { Stabsfunktion } from '../api/types';
import {
  besetzungAktion,
  besetzungDarstellung,
  besetzungFormWerte,
  besetzungRechteText,
  zeileFuer,
} from './besetzung';

function zeile(over: Partial<Stabsfunktion> = {}): Stabsfunktion {
  return {
    sachgebiet: 's2',
    besetzung_art: 'personal',
    personal_id: 99,
    name: 'Müller',
    personal_noch_disponiert: true,
    gesetzt_at: '2026-09-13 10:00:00',
    gesetzt_von_id: 1,
    ...over,
  };
}

describe('zeileFuer', () => {
  it('findet die belegte Zeile und liefert undefined für eine nicht vergebene', () => {
    const stab = { anzahl_lagebesprechungen: 0, besetzung: [zeile()] };
    expect(zeileFuer(stab, 's2')?.name).toBe('Müller');
    expect(zeileFuer(stab, 's4')).toBeUndefined();
    expect(zeileFuer(undefined, 's2')).toBeUndefined();
  });
});

describe('besetzungDarstellung', () => {
  it('nennt jeden Zustand beim Wort und bleibt neutral', () => {
    expect(besetzungDarstellung(undefined)).toEqual({ rolle: 'neutral', label: 'nicht vergeben' });
    expect(besetzungDarstellung(zeile())).toEqual({ rolle: 'neutral', label: 'Müller' });
    expect(
      besetzungDarstellung(
        zeile({ besetzung_art: 'einsatzleitung', personal_id: undefined, name: undefined }),
      ),
    ).toEqual({ rolle: 'neutral', label: 'Einsatzleitung' });
    expect(
      besetzungDarstellung(
        zeile({ besetzung_art: 'extern', personal_id: undefined, name: 'Dr. Weber' }),
      ),
    ).toEqual({ rolle: 'neutral', label: 'Dr. Weber (extern)' });
    expect(
      besetzungDarstellung(
        zeile({ besetzung_art: 'rueckwaertig', personal_id: undefined, name: 'Leitstelle' }),
      ),
    ).toEqual({ rolle: 'neutral', label: 'Leitstelle (rückwärtig)' });
  });

  /** Nur bei `personal` ist das Flag aussagekräftig (bei den anderen Arten immer true). */
  it('hängt „nicht mehr disponiert" nur an eine Person, deren Disposition weg ist', () => {
    expect(
      besetzungDarstellung(zeile({ personal_id: undefined, personal_noch_disponiert: false }))
        .label,
    ).toBe('Müller · nicht mehr disponiert');
    // Gegenfall: bei den anderen Arten ist das Flag bedeutungslos, auch wenn es false trägt.
    expect(
      besetzungDarstellung(
        zeile({
          besetzung_art: 'extern',
          personal_id: undefined,
          name: 'Dr. Weber',
          personal_noch_disponiert: false,
        }),
      ).label,
    ).not.toContain('nicht mehr disponiert');
    expect(
      besetzungDarstellung(
        zeile({
          besetzung_art: 'rueckwaertig',
          personal_id: undefined,
          name: 'Leitstelle',
          personal_noch_disponiert: false,
        }),
      ).label,
    ).not.toContain('nicht mehr disponiert');
  });
});

describe('besetzungFormWerte', () => {
  it('belegt die Maske mit dem aktuellen Zustand vor', () => {
    expect(besetzungFormWerte(undefined)).toEqual({ art: 'nicht_vergeben' });
    expect(besetzungFormWerte(zeile())).toEqual({ art: 'personal', personal_id: 99 });
    expect(
      besetzungFormWerte(
        zeile({ besetzung_art: 'einsatzleitung', personal_id: undefined, name: undefined }),
      ),
    ).toEqual({ art: 'einsatzleitung' });
    expect(
      besetzungFormWerte(
        zeile({ besetzung_art: 'rueckwaertig', personal_id: undefined, name: 'FEZ' }),
      ),
    ).toEqual({ art: 'rueckwaertig', bezeichnung: 'FEZ' });
  });
});

/**
 * Der Wertgleichheits-Riegel (Spec 10, Muster `BemerkungZelle`): ein unveränderter PUT schriebe
 * `gesetzt_at` neu und feuerte ein Live-Ereignis für nichts (`src/stab/repo.rs:474-498`).
 * Jede „keine"-Aussage steht neben einem Gegenfall, der sehr wohl sendet.
 */
describe('besetzungAktion', () => {
  it('leere Zeile, „nicht vergeben" bestätigt → keine Aktion', () => {
    expect(besetzungAktion(undefined, { art: 'nicht_vergeben' })).toEqual({ typ: 'keine' });
  });

  it('belegte Zeile, „nicht vergeben" → entfernen', () => {
    expect(besetzungAktion(zeile(), { art: 'nicht_vergeben' })).toEqual({ typ: 'entfernen' });
  });

  it('leere Zeile, Person gewählt → setzen mit NUR der personal_id', () => {
    expect(
      besetzungAktion(undefined, { art: 'personal', personal_id: 99, bezeichnung: 'Rest' }),
    ).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'personal', personal_id: 99 },
    });
  });

  it('Person geleert (null nach abgebrochener Ad-hoc-Anlage) → keine Aktion, nie ein null-PUT', () => {
    expect(besetzungAktion(undefined, { art: 'personal', personal_id: null })).toEqual({
      typ: 'keine',
    });
    expect(
      besetzungAktion(zeile({ personal_id: undefined }), { art: 'personal', personal_id: null }),
    ).toEqual({
      typ: 'keine',
    });
  });

  it('dieselbe Person erneut → keine Aktion; eine andere Person → setzen', () => {
    expect(besetzungAktion(zeile(), { art: 'personal', personal_id: 99 })).toEqual({
      typ: 'keine',
    });
    expect(besetzungAktion(zeile(), { art: 'personal', personal_id: 7 })).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'personal', personal_id: 7 },
    });
  });

  it('Einsatzleitung bleibt Einsatzleitung → keine Aktion; Wechsel dorthin → setzen ohne Zusatzfelder', () => {
    const el = zeile({ besetzung_art: 'einsatzleitung', personal_id: undefined, name: undefined });
    expect(besetzungAktion(el, { art: 'einsatzleitung' })).toEqual({ typ: 'keine' });
    expect(besetzungAktion(zeile(), { art: 'einsatzleitung', personal_id: 99 })).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'einsatzleitung' },
    });
  });

  it('extern: getrimmte gleiche Bezeichnung → keine Aktion; andere → setzen mit NUR der Bezeichnung', () => {
    const ext = zeile({ besetzung_art: 'extern', personal_id: undefined, name: 'Dr. Weber' });
    expect(besetzungAktion(ext, { art: 'extern', bezeichnung: '  Dr. Weber ' })).toEqual({
      typ: 'keine',
    });
    expect(
      besetzungAktion(ext, { art: 'extern', bezeichnung: 'Dr. Lang', personal_id: 99 }),
    ).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'extern', bezeichnung: 'Dr. Lang' },
    });
  });

  it('Artwechsel bei gleicher Bezeichnung (extern → rückwärtig) ist eine Änderung', () => {
    const ext = zeile({ besetzung_art: 'extern', personal_id: undefined, name: 'Leitstelle' });
    expect(besetzungAktion(ext, { art: 'rueckwaertig', bezeichnung: 'Leitstelle' })).toEqual({
      typ: 'setzen',
      daten: { besetzung_art: 'rueckwaertig', bezeichnung: 'Leitstelle' },
    });
  });
});

describe('besetzungRechteText', () => {
  it('unterscheidet abgeschlossenen Einsatz und fehlende Rolle', () => {
    expect(besetzungRechteText('abgeschlossen')).toMatch(/abgeschlossen/);
    expect(besetzungRechteText('aktiv')).toMatch(/Einsatzleitung und Führungspersonal/);
  });
});
