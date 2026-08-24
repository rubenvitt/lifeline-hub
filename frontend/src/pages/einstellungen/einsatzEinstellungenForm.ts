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
 * Geteilte Form-Logik der vier Einsatz-Einstellungs-Sektionen (LFH-345 · C10, H15/M15).
 *
 * **KRITISCH:** `PUT /api/einsaetze/{id}/einstellungen` ist Vollersatz (kein PATCH). Jede
 * Sektion speichert darum den VOLLEN Payload:
 * `{ ...zuUpdate(geladeneDaten), ...normalisiere<Sektion>(form) }`. `zuUpdate` liefert die
 * Basis aus dem geladenen Zustand, der Sektions-Normalizer überschreibt nur seine eigenen
 * Felder — so nullt ein Speichern in „Aufbewahrung" nie die Nummernkreise.
 *
 * Das ist wörtlich der Vertrag, den die Org-Ebene seit LFH-281 mit `orgEinstellungenForm.ts`
 * löst; dieses Modul ist dessen Gegenstück, keine Erfindung. **Nicht** von dort kopieren
 * lässt sich `auto_etb_eintraege`: die Org-Ebene ist zweiwertig und rechnet `!== 0`, die
 * Einsatz-Ebene ist DREIwertig (siehe {@link zuUpdate}).
 *
 * Warum ein eigenes Modul statt Logik in den vier Seiten: der Fehlerfall ist stumm. Ein
 * vergessenes Feld erzeugt keinen roten Test und kein Fehlerbild — der Datensatz verliert
 * es beim nächsten Speichern einer fremden Sektion, und niemand sieht es, bis eine Nummer
 * falsch vergeben wird. Prüfbar ist das nur an EINER Stelle, und die ist hier.
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
 * **Die Karten-Defaults sind der Grund, warum diese Funktion mehr Felder trägt, als in den
 * vier Sektionen sichtbar sind.** `basemap_modus`, `karten_zoom_start` und
 * `fachebenen_sichtbar` leben seit LFH-319 auf der Lagekarte („Für den Einsatz speichern")
 * und sind aus diesem Formular entfernt. Die Spalten bleiben als Saat der Standardansicht —
 * deshalb MUSS ihr Bestandswert hier mitfahren, sonst nullt der Vollersatz-UPSERT-PUT sie
 * beim nächsten Save einer beliebigen Sektion.
 *
 * **`auto_etb_eintraege` ist dreiwertig**, anders als auf der Org-Ebene: `null` heißt „erbt
 * den Org-Standard", `0` heißt „Aus", alles andere „An". Die Org-Zeile (`!== 0`) hierher zu
 * kopieren verwandelte ein geerbtes „erbt Org" beim Speichern einer fremden Sektion still
 * in ein explizites „An".
 */
export function zuUpdate(e: EinsatzEinstellungen): EinstellungenUpdate {
  return {
    standard_modul: e.standard_modul ?? null,
    basemap_modus: e.basemap_modus ?? null,
    karten_zoom_start: e.karten_zoom_start ?? null,
    // Das Backend serialisiert die Fachebenen untypisiert (`unknown`), die Formgebung ist
    // FE-lokal — siehe `FachebenenSichtbar` in `api/types.ts`.
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
 * Initial-Form-Werte je Sektion aus dem geladenen Zustand.
 *
 * `null → undefined` ist nicht kosmetisch: antd zeigt seinen Platzhalter nur bei
 * `undefined`; ein `null` im Formularwert stellt ein leeres, aber „gesetztes" Feld dar.
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
    // Tristate zurück in den Select: null bleibt leer (erbt Org), 0 = Aus, sonst An.
    auto_etb_eintraege: e.auto_etb_eintraege == null ? undefined : e.auto_etb_eintraege !== 0,
  };
}

export function initialAufbewahrung(e: EinsatzEinstellungen): FormWerteAufbewahrung {
  return { retention_dauer_tage: e.retention_dauer_tage ?? undefined };
}

// ── Geteilte Darstellungs-Helfer der vier Sektionen ──────────────────────────
//
// Sie stehen hier und nicht in einer fünften Datei, weil sie dieselbe Frage beantworten wie
// der Rest des Moduls: WIE trägt eine Sektion einen Wert, den sie mit den anderen teilt.
// Alle drei sind rein und ohne React — prüfbar ohne Render (Muster `bedienzielStil`).

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
 * Speicher-Leiste am unteren Rand einer Sektion — sticky, mit Trennlinie und eigenem Grund.
 *
 * **Sticky ist die halbe Zusicherung, „im `<form>`" die andere.** Der Knopf lag bis C10 im
 * Kopf-Aktionen-Slot von `EinsatzSeite`, also als DOM-Geschwister AUSSERHALB des `<form>` —
 * dort konnte er nichts übermitteln, weshalb der Bestand `form.submit()` von Hand rief und
 * Enter im Formular tot war (Erfassungs-Norm B4/LFH-332, Befund H69). Hier trägt er
 * `htmlType="submit"`, und die eingebaute Formularübermittlung des Browsers erledigt den
 * Rest. Sticky, weil er sonst bei neun Feldern aus dem Bild scrollt, während man das letzte
 * ausfüllt (Bauform übernommen aus `pages/EinheitDetailPage.tsx`, Befund M26).
 *
 * Kein `<Space>`: hier steht genau EIN Knopf, kein `danger`-Nachbar — die Abstandsregel aus
 * LFH-363 hat hier nichts zu entscheiden.
 */
export function speicherLeisteStil(token: {
  colorBgContainer: string;
  paddingSM: number;
  colorBorderSecondary: string;
}): CSSProperties {
  return {
    position: 'sticky',
    bottom: 0,
    zIndex: 1,
    background: token.colorBgContainer,
    paddingBlock: token.paddingSM,
    borderTop: `1px solid ${token.colorBorderSecondary}`,
  };
}

/**
 * Feldraster einer Sektion — REIN und exportiert, damit die Ungleichheit über beide Breiten
 * ohne Render prüfbar ist (Muster `bedienzielStil` aus LFH-365; jsdom rechnet kein Layout,
 * und `Grid.useBreakpoint()` liefert dort auf dem ersten Render ohnehin „breit").
 *
 * Zwei Spalten trägt allein die Sektion „Verhalten" mit ihren neun Feldern; „Allgemein" (5)
 * und „Aufbewahrung" (1) bleiben einspaltig — zwei Spalten für ein Feld wären Zierde. Die
 * Schwelle `lg` liest der Aufrufer aus `useViewport`, nicht diese Funktion: eine reine
 * Stilfunktion, die selbst einen Hook ruft, wäre kein Prüfobjekt mehr.
 */
export function feldrasterStil(zweispaltig: boolean, spaltenabstand: number): CSSProperties {
  return {
    display: 'grid',
    gridTemplateColumns: zweispaltig ? '1fr 1fr' : '1fr',
    columnGap: spaltenabstand,
    alignItems: 'start',
  };
}
