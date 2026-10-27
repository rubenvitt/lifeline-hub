import { describe, expect, it } from 'vitest';
import {
  ALLE_ARTEN,
  BENACHRICHTIGUNG_ARTEN,
  ersatzPfad,
  sammelGruppeVon,
  sammelTitel,
  sammelZeilen,
  toastSchluessel,
  ZIEL_SPRUENGE,
  zielPfad,
  zielVon,
} from './benachrichtigungKatalog';

describe('Katalog der Benachrichtigungsarten', () => {
  it('Alarm-Arten sind genau die des Katalogs (design.md D4, LLH-1142 E1, LLH-1425)', () => {
    expect(ALLE_ARTEN.filter((a) => BENACHRICHTIGUNG_ARTEN[a].stufe === 'alarm')).toEqual([
      'sofortmeldung',
      'sofortmeldung_eskaliert',
      'auftrag_ueberfaellig',
      'abloesung_faellig',
      'vermisstenmeldung',
      'unwetter',
    ]);
  });

  it('Rückmeldung überfällig ist ein abschaltbarer Eingang mit Sprung zur Einheit (LLH-1425)', () => {
    expect(BENACHRICHTIGUNG_ARTEN.rueckmeldung_ueberfaellig).toMatchObject({
      stufe: 'hinweis',
      einstellbar: true,
    });
    expect(zielVon({ art: 'rueckmeldung_ueberfaellig', bezug_typ: 'einheit' })).toBe('einheiten');
    expect(zielVon({ art: 'vermisstenmeldung', bezug_typ: 'person' })).toBe('personen');
  });

  it('Org-Arten sind Aufnahme und neuer Einsatz', () => {
    expect(ALLE_ARTEN.filter((a) => BENACHRICHTIGUNG_ARTEN[a].org)).toEqual([
      'einsatz_aufnahme',
      'einsatz_neu',
    ]);
  });

  it('jeder Name ist eindeutig', () => {
    const namen = ALLE_ARTEN.map((a) => BENACHRICHTIGUNG_ARTEN[a].name);
    expect(new Set(namen).size).toBe(namen.length);
  });

  it('jede Benachrichtigung hat ihren eigenen Toast-Schlüssel, auch zwei zum selben Bezug', () => {
    expect(toastSchluessel({ benachrichtigung_id: 40 })).toBe('b-40');
    expect(toastSchluessel({ benachrichtigung_id: 41 })).toBe('b-41');
  });

  it('Unwetter (Warnstufe rot) ist seit LLH-1425 ein Alarm: in den Einstellungen ohne Schalter', () => {
    expect(BENACHRICHTIGUNG_ARTEN.unwetter).toMatchObject({ stufe: 'alarm', einstellbar: true });
  });

  it('Hinweise der Ablösung (LLH-1131): leise, abschaltbar, Sprung in die Ablösung', () => {
    for (const art of ['abloesung_planung', 'abloesung_abloeser'] as const) {
      expect(BENACHRICHTIGUNG_ARTEN[art]).toMatchObject({ stufe: 'hinweis', einstellbar: true });
    }
    for (const bezug_typ of [
      'abloeser_alarmiert',
      'abloeser_eingetroffen',
      'abloeser_br_eingetroffen',
      'abloeser_abgerufen',
      'abloeser_entfallen',
      'abloeser_alarmierung_gestrichen',
      'abloeser_eintreffen_gestrichen',
    ] as const) {
      expect(zielVon({ art: 'abloesung_abloeser', bezug_typ })).toBe('abloesung');
    }
    expect(zielVon({ art: 'abloesung_planung', bezug_typ: 'abloesung' })).toBe('abloesung');
    expect(sammelGruppeVon('abloesung_planung')).toBe('abloesung');
    expect(sammelGruppeVon('abloesung_abloeser')).toBe('abloesung_abloeser');
  });

  it('Ersatz ohne gelesenen Text: eine Benachrichtigung der Ablösung springt zu ihrer Schicht', () => {
    for (const bezug_typ of ['abloesung', 'abloeser_eingetroffen', 'abloeser_entfallen'] as const) {
      expect(ersatzPfad({ art: 'abloesung_abloeser', bezug_typ, bezug_id: 9, einsatz_id: 4 })).toBe(
        '/einsaetze/4/abloesung?schicht=9',
      );
    }
    // Eine Meldung springt zu sich, mit Hervorhebung (LLH-1052).
    expect(
      ersatzPfad({ art: 'sofortmeldung', bezug_typ: 'meldung', bezug_id: 7, einsatz_id: 4 }),
    ).toBe('/einsaetze/4/meldungen?meldung=7');
    // Eine fällige Erinnerung springt zu ihrer Karte (LLH-1467), wie der Server-Pfad.
    expect(
      ersatzPfad({
        art: 'erinnerung_faellig',
        bezug_typ: 'erinnerung',
        bezug_id: 5,
        einsatz_id: 4,
      }),
    ).toBe('/einsaetze/4/erinnerungen?erinnerung=5');
    // Die Übernahme in die Lage springt in die Lage-Sicht (LLH-1062), wie der Server-Pfad.
    expect(
      ersatzPfad({ art: 'meldung', bezug_typ: 'lage_uebernahme', bezug_id: 7, einsatz_id: 4 }),
    ).toBe('/einsaetze/4/lagemeldungen');
    // Sonst das Modul des Bezugs, Org-Arten der Einsatz.
    expect(
      ersatzPfad({ art: 'auftrag_erteilt', bezug_typ: 'auftrag', bezug_id: 3, einsatz_id: 4 }),
    ).toBe('/einsaetze/4/auftraege');
    expect(
      ersatzPfad({ art: 'einsatz_neu', bezug_typ: 'einsatz', bezug_id: 4, einsatz_id: 4 }),
    ).toBe('/einsaetze/4');
  });

  it('jeder Sprung führt in den Einsatz, außerhalb in die Einsatzliste', () => {
    for (const { ziel } of ZIEL_SPRUENGE) {
      if (ziel === 'einsaetze') continue;
      expect(zielPfad(ziel, 4)).toMatch(/^\/einsaetze\/4(\/|$)/);
      expect(zielPfad(ziel, null)).toBe('/einsaetze');
    }
  });
});

describe('Sammeltoast', () => {
  it('Titel: eigene Gruppe der bestehenden Alarme, sonst Alarme oder Hinweise', () => {
    const sofort = { gruppe: 'sofort' as const, stufe: 'alarm' as const };
    const auftrag = { gruppe: 'auftrag_erteilt' as const, stufe: 'hinweis' as const };
    expect(sammelTitel([sofort, sofort])).toBe('2 weitere Sofortmeldungen');
    expect(sammelTitel([auftrag, auftrag])).toBe('2 weitere Hinweise');
    expect(sammelTitel([auftrag, sofort])).toBe('2 weitere Alarme');
  });

  it('Zählzeilen erst ab zwei Arten', () => {
    expect(sammelZeilen([{ name: 'Neuer Auftrag' }, { name: 'Neuer Auftrag' }])).toEqual([]);
    expect(
      sammelZeilen([
        { name: 'Neuer Auftrag' },
        { name: 'Neuer Befehl' },
        { name: 'Neuer Auftrag' },
      ]),
    ).toEqual(['2 × Neuer Auftrag', '1 × Neuer Befehl']);
  });
});
