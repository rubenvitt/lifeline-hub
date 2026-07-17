import type {
  EinheitenSystem,
  Koordinatenformat,
  OrgEinstellungen,
  OrgEinstellungenUpdate,
  Zeitformat,
} from '../../api/types';

/**
 * Geteilte Form-Logik der drei Einstellungs-Sektions-Routen (LFH-284).
 *
 * **KRITISCH:** `PUT /api/org-einstellungen` ist Vollersatz (kein PATCH). Jede Sektion
 * speichert darum den VOLLEN Payload: `{ ...zuUpdate(geladeneDaten), ...normalisiere<Sektion>(form) }`.
 * `zuUpdate` liefert die Basis aus dem geladenen Zustand, die Sektions-Normalizer überschreiben
 * nur ihre eigenen Felder — so nullt ein Anzeige-Save nie die Einsatz-Default-Spalten.
 */

/** Anzeige-Sektion: Darstellungs-Defaults + Geocoder. */
export interface FormWerteAnzeige {
  zeitzone?: string;
  zeitformat?: Zeitformat;
  einheiten?: EinheitenSystem;
  koordinatenformat?: Koordinatenformat;
  geocoder_url?: string;
}

/** Einsatz-Defaults-Sektion: Aufbewahrung, Nummernkreise, Fristen, Auto-ETB. */
export interface FormWerteEinsatz {
  retention_dauer_tage?: number;
  etb_nummer_praefix?: string;
  meldung_nummer_praefix?: string;
  auftrag_nummer_praefix?: string;
  meldung_bestaetigung_frist_min?: number;
  auftrag_quittierung_frist_min?: number;
  auto_etb_eintraege: boolean;
}

/** Voller Update-Payload aus dem geladenen Zustand — Basis für den Vollersatz-Merge-Save. */
export function zuUpdate(e: OrgEinstellungen): OrgEinstellungenUpdate {
  return {
    zeitzone: e.zeitzone ?? null,
    zeitformat: e.zeitformat ?? null,
    einheiten: e.einheiten ?? null,
    koordinatenformat: e.koordinatenformat ?? null,
    retention_dauer_tage: e.retention_dauer_tage ?? null,
    etb_nummer_praefix: e.etb_nummer_praefix ?? null,
    meldung_nummer_praefix: e.meldung_nummer_praefix ?? null,
    auftrag_nummer_praefix: e.auftrag_nummer_praefix ?? null,
    meldung_bestaetigung_frist_min: e.meldung_bestaetigung_frist_min ?? null,
    auftrag_quittierung_frist_min: e.auftrag_quittierung_frist_min ?? null,
    // 0 = aus; null/1 = an (Default an).
    auto_etb_eintraege: e.auto_etb_eintraege !== 0,
    geocoder_url: e.geocoder_url ?? null,
  };
}

/** Anzeige-Felder wire-korrekt normalisieren (Strings trimmen, leer → null). */
export function normalisiereAnzeige(
  w: FormWerteAnzeige,
): Pick<
  OrgEinstellungenUpdate,
  'zeitzone' | 'zeitformat' | 'einheiten' | 'koordinatenformat' | 'geocoder_url'
> {
  return {
    zeitzone: w.zeitzone?.trim() || null,
    zeitformat: w.zeitformat ?? null,
    einheiten: w.einheiten ?? null,
    koordinatenformat: w.koordinatenformat ?? null,
    geocoder_url: w.geocoder_url?.trim() || null,
  };
}

/** Einsatz-Default-Felder wire-korrekt normalisieren (Präfixe trimmen, leer → null). */
export function normalisiereEinsatz(
  w: FormWerteEinsatz,
): Pick<
  OrgEinstellungenUpdate,
  | 'retention_dauer_tage'
  | 'etb_nummer_praefix'
  | 'meldung_nummer_praefix'
  | 'auftrag_nummer_praefix'
  | 'meldung_bestaetigung_frist_min'
  | 'auftrag_quittierung_frist_min'
  | 'auto_etb_eintraege'
> {
  return {
    retention_dauer_tage: w.retention_dauer_tage ?? null,
    etb_nummer_praefix: w.etb_nummer_praefix?.trim() || null,
    meldung_nummer_praefix: w.meldung_nummer_praefix?.trim() || null,
    auftrag_nummer_praefix: w.auftrag_nummer_praefix?.trim() || null,
    meldung_bestaetigung_frist_min: w.meldung_bestaetigung_frist_min ?? null,
    auftrag_quittierung_frist_min: w.auftrag_quittierung_frist_min ?? null,
    auto_etb_eintraege: w.auto_etb_eintraege,
  };
}

/** Initial-Form-Werte der Anzeige-Sektion aus dem geladenen Zustand. */
export function initialAnzeige(e: OrgEinstellungen): FormWerteAnzeige {
  return {
    zeitzone: e.zeitzone ?? undefined,
    zeitformat: e.zeitformat ?? undefined,
    einheiten: e.einheiten ?? undefined,
    koordinatenformat: e.koordinatenformat ?? undefined,
    geocoder_url: e.geocoder_url ?? undefined,
  };
}

/** Initial-Form-Werte der Einsatz-Defaults-Sektion aus dem geladenen Zustand. */
export function initialEinsatz(e: OrgEinstellungen): FormWerteEinsatz {
  return {
    retention_dauer_tage: e.retention_dauer_tage ?? undefined,
    etb_nummer_praefix: e.etb_nummer_praefix ?? undefined,
    meldung_nummer_praefix: e.meldung_nummer_praefix ?? undefined,
    auftrag_nummer_praefix: e.auftrag_nummer_praefix ?? undefined,
    meldung_bestaetigung_frist_min: e.meldung_bestaetigung_frist_min ?? undefined,
    auftrag_quittierung_frist_min: e.auftrag_quittierung_frist_min ?? undefined,
    auto_etb_eintraege: e.auto_etb_eintraege !== 0,
  };
}
