import { describe, expect, it } from 'vitest';
import {
  istSkelettVerkuerzung,
  zuUpdate,
  normalisiereAnzeige,
  normalisiereEinsatz,
} from './orgEinstellungenForm';
import type { OrgEinstellungen } from '../../api/types';

const VOLL = {
  org_id: 1,
  zeitzone: 'Europe/Berlin',
  zeitformat: '12h',
  einheiten: 'imperial',
  koordinatenformat: 'mgrs',
  retention_dauer_tage: 90,
  skelett_dauer_tage: 3650,
  etb_nummer_praefix: 'EB-',
  meldung_nummer_praefix: 'M-',
  auftrag_nummer_praefix: 'A-',
  einsatz_nummer_praefix: 'WF-',
  meldung_bestaetigung_frist_min: 30,
  auftrag_quittierung_frist_min: 45,
  rueckmeldung_frist_min: 25,
  auto_etb_eintraege: 0,
  geocoder_url: 'https://geo.example',
  geaendert_at: null,
  geaendert_von: null,
} as unknown as OrgEinstellungen;

describe('zuUpdate', () => {
  it('mappt alle 14 Felder aus dem geladenen Zustand (auto_etb 0 → false)', () => {
    expect(zuUpdate(VOLL)).toEqual({
      zeitzone: 'Europe/Berlin',
      zeitformat: '12h',
      einheiten: 'imperial',
      koordinatenformat: 'mgrs',
      retention_dauer_tage: 90,
      // Fehlte es hier, leerte jedes Speichern einer anderen Sektion die Skelett-Frist (LFH-750).
      skelett_dauer_tage: 3650,
      etb_nummer_praefix: 'EB-',
      meldung_nummer_praefix: 'M-',
      auftrag_nummer_praefix: 'A-',
      // Fehlte es hier, nullte jedes Speichern der Anzeige-Sektion das Präfix.
      einsatz_nummer_praefix: 'WF-',
      meldung_bestaetigung_frist_min: 30,
      auftrag_quittierung_frist_min: 45,
      rueckmeldung_frist_min: 25,
      auto_etb_eintraege: false,
      geocoder_url: 'https://geo.example',
    });
  });

  it('null-Felder bleiben null; auto_etb null → true (Default an)', () => {
    const leer = {
      ...VOLL,
      zeitzone: null,
      retention_dauer_tage: null,
      auto_etb_eintraege: null,
    } as unknown as OrgEinstellungen;
    const u = zuUpdate(leer);
    expect(u.zeitzone).toBeNull();
    expect(u.retention_dauer_tage).toBeNull();
    expect(u.auto_etb_eintraege).toBe(true);
  });
});

describe('normalisiereAnzeige', () => {
  it('trimmt Strings, leer → null, füllt fehlende Enums mit null', () => {
    expect(normalisiereAnzeige({ zeitzone: '  Europe/Berlin  ', geocoder_url: '   ' })).toEqual({
      zeitzone: 'Europe/Berlin',
      zeitformat: null,
      einheiten: null,
      koordinatenformat: null,
      geocoder_url: null,
    });
  });
});

describe('normalisiereEinsatz', () => {
  it('leeres Präfix → null, fehlende Zahlen → null, auto_etb als Bool', () => {
    expect(
      normalisiereEinsatz({
        etb_nummer_praefix: '  ',
        auto_etb_eintraege: false,
      }),
    ).toEqual({
      retention_dauer_tage: null,
      skelett_dauer_tage: null,
      etb_nummer_praefix: null,
      meldung_nummer_praefix: null,
      auftrag_nummer_praefix: null,
      einsatz_nummer_praefix: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      rueckmeldung_frist_min: null,
      auto_etb_eintraege: false,
    });
  });

  it('LFH-617: trimmt das Einsatznummer-Präfix', () => {
    expect(
      normalisiereEinsatz({ einsatz_nummer_praefix: ' WF- ', auto_etb_eintraege: true })
        .einsatz_nummer_praefix,
    ).toBe('WF-');
  });
});

describe('istSkelettVerkuerzung (LFH-750, Spiegel von routes::org_einstellungen::setzen)', () => {
  it('erstmaliges Setzen und Verkürzen sind zu bestätigen, Gleichlassen, Verlängern, Leeren nicht', () => {
    expect(istSkelettVerkuerzung(null, 3650)).toBe(true);
    expect(istSkelettVerkuerzung(undefined, 3650)).toBe(true);
    expect(istSkelettVerkuerzung(3650, 365)).toBe(true);
    expect(istSkelettVerkuerzung(3650, 3650)).toBe(false);
    expect(istSkelettVerkuerzung(3650, 4000)).toBe(false);
    expect(istSkelettVerkuerzung(3650, null)).toBe(false);
    expect(istSkelettVerkuerzung(null, null)).toBe(false);
  });
});
