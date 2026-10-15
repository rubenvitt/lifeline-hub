import { describe, expect, it } from 'vitest';
import {
  ALLE_ARTEN,
  BENACHRICHTIGUNG_ARTEN,
  sammelTitel,
  sammelZeilen,
  toastSchluessel,
  ZIEL_SPRUENGE,
  zielPfad,
} from './benachrichtigungKatalog';

describe('Katalog der Benachrichtigungsarten', () => {
  it('Alarm-Arten sind genau die vier aus design.md D4', () => {
    expect(ALLE_ARTEN.filter((a) => BENACHRICHTIGUNG_ARTEN[a].stufe === 'alarm')).toEqual([
      'sofortmeldung',
      'sofortmeldung_eskaliert',
      'auftrag_ueberfaellig',
      'abloesung_faellig',
    ]);
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

  it('die Arten der Sonderwege teilen deren Toast-Schlüssel, alle anderen haben einen eigenen', () => {
    const e = { bezug_id: 7, benachrichtigung_id: 40 };
    expect(toastSchluessel({ ...e, art: 'sofortmeldung' })).toBe('sofort-7');
    expect(toastSchluessel({ ...e, art: 'auftrag_ueberfaellig' })).toBe('auftrag-7');
    expect(toastSchluessel({ ...e, art: 'erinnerung_faellig' })).toBe('erinnerung-7');
    expect(toastSchluessel({ ...e, art: 'abloesung_faellig' })).toBe('abloesung-7-faellig');
    expect(toastSchluessel({ ...e, art: 'abloesung_vorwarnung' })).toBe('abloesung-7-vorwarnung');
    expect(toastSchluessel({ ...e, art: 'auftrag_erteilt' })).toBe('b-40');
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
