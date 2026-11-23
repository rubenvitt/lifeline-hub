import { describe, expect, it } from 'vitest';
import {
  ALLE_ARTEN,
  BENACHRICHTIGUNG_ARTEN,
  ersatzPfad,
  toastSchluessel,
  ZIEL_SPRUENGE,
  zielPfad,
  zielVon,
} from './benachrichtigungKatalog';

describe('Katalog der Benachrichtigungsarten', () => {
  it('Alarm-Arten sind genau die des Katalogs (design.md D4, LLH-1142 E1, LLH-1425, LLH-1491)', () => {
    expect(ALLE_ARTEN.filter((a) => BENACHRICHTIGUNG_ARTEN[a].stufe === 'alarm')).toEqual([
      'sofortmeldung',
      'sofortmeldung_eskaliert',
      'auftrag_ueberfaellig',
      'abloesung_faellig',
      'vermisstenmeldung',
      'unwetter',
      // LLH-1491: eine ungültige Übernahme der Führung.
      'fuehrung_ungueltig',
    ]);
    expect(BENACHRICHTIGUNG_ARTEN.fuehrung_uebernommen.stufe).toBe('hinweis');
  });

  it('Rückmeldung überfällig ist ein abschaltbarer Eingang mit Sprung zur Einheit (LLH-1425)', () => {
    expect(BENACHRICHTIGUNG_ARTEN.rueckmeldung_ueberfaellig).toMatchObject({
      stufe: 'hinweis',
      einstellbar: true,
    });
    expect(zielVon({ art: 'rueckmeldung_ueberfaellig', bezug_typ: 'einheit' })).toBe('einheiten');
    expect(zielVon({ art: 'vermisstenmeldung', bezug_typ: 'person' })).toBe('personen');
  });

  it('Org-Arten sind Aufnahme, neuer Einsatz und die Störungen einer Anbindung', () => {
    expect(ALLE_ARTEN.filter((a) => BENACHRICHTIGUNG_ARTEN[a].org)).toEqual([
      'einsatz_aufnahme',
      'einsatz_neu',
      'adapter_eingriff',
      'adapter_gestoert',
      'adapter_wieder_ok',
    ]);
  });

  describe('Störung einer Anbindung (LLH-2026)', () => {
    const ARTEN = ['adapter_eingriff', 'adapter_gestoert', 'adapter_wieder_ok'] as const;

    it('ist ein abschaltbarer Eingang', () => {
      for (const art of ARTEN) {
        expect(BENACHRICHTIGUNG_ARTEN[art]).toMatchObject({
          stufe: 'hinweis',
          org: true,
          einstellbar: true,
        });
      }
      expect(BENACHRICHTIGUNG_ARTEN.adapter_eingriff.name).toBe('Anbindung braucht Eingriff');
    });

    it('springt zu den Anbindungen, nie in einen Einsatz', () => {
      for (const art of ARTEN) {
        expect(zielVon({ art, bezug_typ: 'adapter' })).toBe('anbindungen');
        const pfad = ersatzPfad({ art, bezug_typ: 'adapter', bezug_id: 3, einsatz_id: null });
        expect(pfad).toBe('/admin/einstellungen/anbindungen');
      }
      expect(zielPfad('anbindungen', null)).toBe('/admin/einstellungen/anbindungen');
      expect(zielPfad('anbindungen', 4)).toBe('/admin/einstellungen/anbindungen');
      expect(ZIEL_SPRUENGE.find((z) => z.ziel === 'anbindungen')?.text).toBe('Zu Anbindungen');
    });

    it('eine Org-Art ohne Einsatz springt nie nach /einsaetze/null', () => {
      expect(
        ersatzPfad({ art: 'einsatz_neu', bezug_typ: 'einsatz', bezug_id: 3, einsatz_id: null }),
      ).not.toContain('null');
    });
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
      'abloeser_wiederhergestellt',
    ] as const) {
      expect(zielVon({ art: 'abloesung_abloeser', bezug_typ })).toBe('abloesung');
    }
    expect(zielVon({ art: 'abloesung_planung', bezug_typ: 'abloesung' })).toBe('abloesung');
  });

  it('Ersatz ohne gelesenen Text: eine Benachrichtigung der Ablösung springt zu ihrer Schicht', () => {
    for (const bezug_typ of ['abloesung', 'abloeser_eingetroffen', 'abloeser_entfallen'] as const) {
      expect(ersatzPfad({ art: 'abloesung_abloeser', bezug_typ, bezug_id: 9, einsatz_id: 4 })).toBe(
        '/einsaetze/4/abloesung?schicht=9',
      );
    }
    // Der gebündelte Hinweis eines Wechselzeitpunkts springt in den Schichtplan (LLH-1555).
    expect(
      ersatzPfad({
        art: 'abloesung_faellig',
        bezug_typ: 'schichtplan_wechsel',
        bezug_id: 29903735,
        einsatz_id: 4,
      }),
    ).toBe('/einsaetze/4/abloesung?ansicht=plan&wechsel=29903735');
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
      // Die Anbindungen liegen außerhalb jedes Einsatzes (LLH-2026, eigener Test oben).
      if (ziel === 'einsaetze' || ziel === 'anbindungen') continue;
      expect(zielPfad(ziel, 4)).toMatch(/^\/einsaetze\/4(\/|$)/);
      expect(zielPfad(ziel, null)).toBe('/einsaetze');
    }
  });
});
