import { describe, expect, it } from 'vitest';
import { zuUpdate, normalisiereAnzeige, normalisiereEinsatz } from './orgEinstellungenForm';
import type { OrgEinstellungen } from '../../api/types';

const VOLL = {
  org_id: 1,
  zeitzone: 'Europe/Berlin',
  zeitformat: '12h',
  einheiten: 'imperial',
  koordinatenformat: 'mgrs',
  retention_dauer_tage: 90,
  etb_nummer_praefix: 'EB-',
  meldung_nummer_praefix: 'M-',
  auftrag_nummer_praefix: 'A-',
  meldung_bestaetigung_frist_min: 30,
  auftrag_quittierung_frist_min: 45,
  auto_etb_eintraege: 0,
  geocoder_url: 'https://geo.example',
  geaendert_at: null,
  geaendert_von: null,
} as unknown as OrgEinstellungen;

describe('zuUpdate', () => {
  it('mappt alle 12 Felder aus dem geladenen Zustand (auto_etb 0 → false)', () => {
    expect(zuUpdate(VOLL)).toEqual({
      zeitzone: 'Europe/Berlin',
      zeitformat: '12h',
      einheiten: 'imperial',
      koordinatenformat: 'mgrs',
      retention_dauer_tage: 90,
      etb_nummer_praefix: 'EB-',
      meldung_nummer_praefix: 'M-',
      auftrag_nummer_praefix: 'A-',
      meldung_bestaetigung_frist_min: 30,
      auftrag_quittierung_frist_min: 45,
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
      etb_nummer_praefix: null,
      meldung_nummer_praefix: null,
      auftrag_nummer_praefix: null,
      meldung_bestaetigung_frist_min: null,
      auftrag_quittierung_frist_min: null,
      auto_etb_eintraege: false,
    });
  });
});
