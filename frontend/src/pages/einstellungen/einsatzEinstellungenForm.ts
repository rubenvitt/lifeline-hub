import type { CSSProperties } from 'react';
import type {
  EinheitenSystem,
  EinsatzEinstellungen,
  EinstellungenUpdate,
  FachebenenSichtbar,
  Koordinatenformat,
  Zeitformat,
} from '../../api/types';

/**
 * Geteilte Form-Logik der vier Einsatz-Einstellungs-Sektionen — Gegenstück zu
 * `orgEinstellungenForm.ts`.
 *
 * KRITISCH: `PUT /api/einsaetze/{id}/einstellungen` ist Vollersatz. Jede Sektion speichert `{
 * ...zuUpdate(geladeneDaten), ...normalisiere<Sektion>(form) }`, sonst nullte ein Speichern in
 * „Aufbewahrung" die Nummernkreise. Der Fehlerfall ist stumm — kein roter Test, kein Fehlerbild —,
 * deshalb liegt die Logik an einer prüfbaren Stelle.
 */

/** Sektion „Allgemein": Einstieg + Anzeige-Konventionen (5 Felder). */
export interface FormWerteAllgemein {
  standard_modul?: string;
  zeitzone?: string;
  zeitformat?: Zeitformat;
  einheiten?: EinheitenSystem;
  koordinatenformat?: Koordinatenformat;
}

/** Sektion „Verhalten & Automatik": Nummernkreise, Fristen, Auto-ETB (9 Felder). */
export interface FormWerteVerhalten {
  etb_nummer_praefix?: string;
  etb_nummer_start?: number;
  meldung_nummer_praefix?: string;
  meldung_nummer_start?: number;
  auftrag_nummer_praefix?: string;
  auftrag_nummer_start?: number;
  meldung_bestaetigung_frist_min?: number;
  auftrag_quittierung_frist_min?: number;
  rueckmeldung_frist_min?: number;
  /** Tristate: `undefined` = Org-Standard erben, `true` = An, `false` = Aus. */
  auto_etb_eintraege?: boolean;
}

/** Sektion „Aufbewahrung & Archiv" (1 Feld). */
export interface FormWerteAufbewahrung {
  retention_dauer_tage?: number;
}

/**
 * Voller Update-Payload aus dem geladenen Zustand — Basis für den Vollersatz-Merge-Save.
 *
 * Er trägt mehr Felder, als die Sektionen zeigen: `basemap_modus`, `karten_zoom_start` und
 * `fachebenen_sichtbar` leben auf der Lagekarte, ihr Bestandswert muss aber mitfahren, sonst nullt
 * der PUT sie.
 *
 * `auto_etb_eintraege` ist dreiwertig (null = erbt Org, 0 = Aus, sonst An) — die zweiwertige
 * Org-Formel `!== 0` machte aus „erbt Org" still ein „An".
 */
export function zuUpdate(e: EinsatzEinstellungen): EinstellungenUpdate {
  return {
    standard_modul: e.standard_modul ?? null,
    basemap_modus: e.basemap_modus ?? null,
    karten_zoom_start: e.karten_zoom_start ?? null,
    // Das Backend serialisiert die Fachebenen untypisiert, die Formgebung ist FE-lokal
    // (`FachebenenSichtbar` in `api/types.ts`).
    fachebenen_sichtbar: (e.fachebenen_sichtbar as FachebenenSichtbar | null) ?? null,
    zeitzone: e.zeitzone ?? null,
    zeitformat: e.zeitformat ?? null,
    einheiten: e.einheiten ?? null,
    koordinatenformat: e.koordinatenformat ?? null,
    etb_nummer_praefix: e.etb_nummer_praefix ?? null,
    etb_nummer_start: e.etb_nummer_start ?? null,
    meldung_nummer_praefix: e.meldung_nummer_praefix ?? null,
    meldung_nummer_start: e.meldung_nummer_start ?? null,
    auftrag_nummer_praefix: e.auftrag_nummer_praefix ?? null,
    auftrag_nummer_start: e.auftrag_nummer_start ?? null,
    meldung_bestaetigung_frist_min: e.meldung_bestaetigung_frist_min ?? null,
    auftrag_quittierung_frist_min: e.auftrag_quittierung_frist_min ?? null,
    rueckmeldung_frist_min: e.rueckmeldung_frist_min ?? null,
    auto_etb_eintraege: e.auto_etb_eintraege == null ? null : e.auto_etb_eintraege !== 0,
    retention_dauer_tage: e.retention_dauer_tage ?? null,
  };
}

/** Allgemein-Felder wire-korrekt normalisieren (Strings trimmen, leer → null). */
export function normalisiereAllgemein(
  w: FormWerteAllgemein,
): Pick<
  EinstellungenUpdate,
  'standard_modul' | 'zeitzone' | 'zeitformat' | 'einheiten' | 'koordinatenformat'
> {
  return {
    standard_modul: w.standard_modul || null,
    zeitzone: w.zeitzone?.trim() || null,
    zeitformat: w.zeitformat ?? null,
    einheiten: w.einheiten ?? null,
    koordinatenformat: w.koordinatenformat ?? null,
  };
}

/** Verhalten-Felder wire-korrekt normalisieren (Präfixe trimmen, leer → null). */
export function normalisiereVerhalten(
  w: FormWerteVerhalten,
): Pick<
  EinstellungenUpdate,
  | 'etb_nummer_praefix'
  | 'etb_nummer_start'
  | 'meldung_nummer_praefix'
  | 'meldung_nummer_start'
  | 'auftrag_nummer_praefix'
  | 'auftrag_nummer_start'
  | 'meldung_bestaetigung_frist_min'
  | 'auftrag_quittierung_frist_min'
  | 'rueckmeldung_frist_min'
  | 'auto_etb_eintraege'
> {
  return {
    etb_nummer_praefix: w.etb_nummer_praefix?.trim() || null,
    etb_nummer_start: w.etb_nummer_start ?? null,
    meldung_nummer_praefix: w.meldung_nummer_praefix?.trim() || null,
    meldung_nummer_start: w.meldung_nummer_start ?? null,
    auftrag_nummer_praefix: w.auftrag_nummer_praefix?.trim() || null,
    auftrag_nummer_start: w.auftrag_nummer_start ?? null,
    meldung_bestaetigung_frist_min: w.meldung_bestaetigung_frist_min ?? null,
    auftrag_quittierung_frist_min: w.auftrag_quittierung_frist_min ?? null,
    rueckmeldung_frist_min: w.rueckmeldung_frist_min ?? null,
    // `undefined` (leerer Select) → `null`: das Backend liest null als „erbt Org-Default".
    auto_etb_eintraege: w.auto_etb_eintraege ?? null,
  };
}

/** Aufbewahrungs-Feld wire-korrekt normalisieren (leer = keine Auto-Frist). */
export function normalisiereAufbewahrung(
  w: FormWerteAufbewahrung,
): Pick<EinstellungenUpdate, 'retention_dauer_tage'> {
  return { retention_dauer_tage: w.retention_dauer_tage ?? null };
}

/**
 * Initial-Form-Werte je Sektion aus dem geladenen Zustand. `null → undefined`, weil antd seinen
 * Platzhalter nur bei `undefined` zeigt.
 */
export function initialAllgemein(e: EinsatzEinstellungen): FormWerteAllgemein {
  return {
    standard_modul: e.standard_modul ?? undefined,
    zeitzone: e.zeitzone ?? undefined,
    zeitformat: e.zeitformat ?? undefined,
    einheiten: e.einheiten ?? undefined,
    koordinatenformat: e.koordinatenformat ?? undefined,
  };
}

export function initialVerhalten(e: EinsatzEinstellungen): FormWerteVerhalten {
  return {
    etb_nummer_praefix: e.etb_nummer_praefix ?? undefined,
    etb_nummer_start: e.etb_nummer_start ?? undefined,
    meldung_nummer_praefix: e.meldung_nummer_praefix ?? undefined,
    meldung_nummer_start: e.meldung_nummer_start ?? undefined,
    auftrag_nummer_praefix: e.auftrag_nummer_praefix ?? undefined,
    auftrag_nummer_start: e.auftrag_nummer_start ?? undefined,
    meldung_bestaetigung_frist_min: e.meldung_bestaetigung_frist_min ?? undefined,
    auftrag_quittierung_frist_min: e.auftrag_quittierung_frist_min ?? undefined,
    rueckmeldung_frist_min: e.rueckmeldung_frist_min ?? undefined,
    // Tristate zurück in den Select: null bleibt leer (erbt Org), 0 = Aus, sonst An.
    auto_etb_eintraege: e.auto_etb_eintraege == null ? undefined : e.auto_etb_eintraege !== 0,
  };
}

export function initialAufbewahrung(e: EinsatzEinstellungen): FormWerteAufbewahrung {
  return { retention_dauer_tage: e.retention_dauer_tage ?? undefined };
}

// ── Geteilte Darstellungs-Helfer der vier Sektionen (rein, ohne React) ──

/** „Standard (Org): X", wenn ein Org-Default gesetzt ist; sonst nichts. */
export function orgHinweisWert(
  wert: string | number | null | undefined,
  suffix?: string,
): string | undefined {
  if (wert == null) return undefined;
  return `Standard (Org): ${wert}${suffix ? ` ${suffix}` : ''}`;
}

/** Wie {@link orgHinweisWert}, aber mit dem sichtbaren Options-Label statt dem Wire-Wert. */
export function orgHinweisSelect<T extends string>(
  wert: T | null | undefined,
  optionen: { value: T; label: string }[],
): string | undefined {
  if (wert == null) return undefined;
  const opt = optionen.find((o) => o.value === wert);
  return opt ? `Standard (Org): ${opt.label}` : undefined;
}

/** Org-Hinweis für die Auto-ETB-Tristate: 0 = Aus, alles andere = An. */
export function orgHinweisAutoEtb(wert: number | null | undefined): string | undefined {
  if (wert == null) return undefined;
  return `Standard (Org): ${wert === 0 ? 'Aus' : 'An'}`;
}

/**
 * Feldraster einer Sektion — rein und exportiert, damit beide Breiten ohne Render prüfbar sind.
 * Zwei Spalten trägt nur „Verhalten" (neun Felder). Die Schwelle `lg` liest der Aufrufer aus
 * `useViewport`.
 */
export function feldrasterStil(zweispaltig: boolean, spaltenabstand: number): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: zweispaltig ? '1fr 1fr' : '1fr',
    columnGap: spaltenabstand,
    alignItems: 'start',
  };
}
