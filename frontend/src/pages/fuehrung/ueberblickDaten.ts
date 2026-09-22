/**
 * Ableitungen des Führungsüberblicks (Neuentwurf „Instrumententafel", Screen S2).
 *
 * Die Seite entscheidet über Form, diese Datei über Bedeutung — dieselbe Trennung wie
 * `pages/lage-dashboard/lagebild.ts`. Alles hier ist REIN und nimmt die Uhr als Argument
 * (`jetzt`, Muster `stab/lagebesprechungZustand.ts`): die Seite tickt, der Test stellt die
 * Zeit, niemand braucht Fake-Timer.
 *
 * Der Basename ist bewusst nicht `ueberblick.ts` neben `UeberblickPage.tsx` — die
 * Kollisionsregel aus CLAUDE.md (`direkteinstiegKern`) gilt sinngemäß für jedes
 * Modulpaar aus Komponente und reinem Kern.
 *
 * ZEIT: jeder Wire-String ist UTC OHNE Zonenkennung. Verglichen wird ausschließlich über
 * {@link zeitpunkt} (`dayjs.utc`), nie über `dayjs(s)` — das läse Ortszeit und verschöbe
 * das 60-Minuten-Fenster still um den Zonenversatz.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type {
  Auftrag,
  Einheit,
  EinsatzFahrzeug,
  EinsatzStatus,
  EinsatzMaterial,
  EinsatzPersonal,
  Einsatzabschnitt,
  Erinnerung,
  EtbEintragAnzeige,
  Gefahrengebiet,
  Person,
  Warnstufe,
} from '../../api/types';
import type { KennzahlTon } from '../../components/instrument';
import {
  OHNE_ABSCHNITT_KEY,
  OHNE_EINHEIT_KEY_PREFIX,
  baueKraeftebild,
  staerkeText,
  verdichte,
  type MeldebildZeile,
  type StaerkeSumme,
} from '../../kraefte/kraeftebild';
import { verdichteGefahrengebiete } from '../lage-dashboard/lageVerdichtung';
import { dauerText } from '../../stab/lagebesprechungZustand';
import { warnstufeKennzahl, type Statusrolle } from '../../theme/statusFarben';

dayjs.extend(utc);

/** Das Fenster „in 60 min" / „der letzten Stunde". */
export const FENSTER_MINUTEN = 60;
/** Ab hier gilt eine Marke als knapp (Ton `achtung`). */
export const KNAPP_MINUTEN = 30;
/** Wie viele Entscheidungen der Rückfall zeigt, wenn die letzte Stunde leer ist. */
export const ENTSCHEIDUNGEN_RUECKFALL = 5;
/** Wie viele Marken das Seitenfeld trägt; der Rest wird gezählt, nicht verschwiegen. */
export const MARKEN_MAX = 6;

/** Wire-Zeit (UTC ohne Zone) → Zeitpunkt; `null` bei fehlendem oder unlesbarem Wert. */
export function zeitpunkt(wire: string | null | undefined): Dayjs | null {
  if (!wire) return null;
  const d = dayjs.utc(wire);
  return d.isValid() ? d : null;
}

function ms(wire: string | null | undefined): number | null {
  return zeitpunkt(wire)?.valueOf() ?? null;
}

// ── Kennzahlen ──────────────────────────────────────────────────────────────────

/** Statusrolle → Ton der Kennzahl. Exhaustiv über die volle Rolle, damit eine neue Rolle
 *  den Build bricht. `KennzahlTon` kennt seit 22.09.2026 auch `normal`/`bedien` (für das
 *  Meldebild-Statusband) — hier bleiben sie bewusst neutral: „keine Gefahr" ist die neutrale
 *  Zahl, keine grüne, und eine Warnstufe ist keine Bedienbeziehung. */
const ROLLE_ALS_TON: Record<Statusrolle, KennzahlTon> = {
  alarm: 'alarm',
  achtung: 'achtung',
  normal: 'neutral',
  neutral: 'neutral',
  bedien: 'neutral',
  marke: 'neutral',
};

export interface BetroffeneKennzahl {
  anzahl: number;
  /** Erfasst in den letzten {@link FENSTER_MINUTEN} Minuten. */
  neu: number;
}

export function betroffeneKennzahl(personen: Person[], jetzt: Dayjs): BetroffeneKennzahl {
  const grenze = jetzt.valueOf() - FENSTER_MINUTEN * 60_000;
  const neu = personen.filter((p) => (ms(p.erfasst_at) ?? -Infinity) >= grenze).length;
  return { anzahl: personen.length, neu };
}

export interface KraefteKennzahl {
  gesamt: number;
  /** BOS-Schreibweise F/UF/M//Σ aus `staerkeText`. */
  text: string;
}

export function kraefteKennzahl(
  personal: EinsatzPersonal[],
  fahrzeuge: EinsatzFahrzeug[],
  material: EinsatzMaterial[],
): KraefteKennzahl {
  const s = verdichte(personal, fahrzeuge, material).staerke;
  return { gesamt: s.gesamt, text: staerkeText(s) };
}

export interface WarnstufeKennzahl {
  stufe: Warnstufe;
  /** Das Wort — der zweite Kanal neben der Farbe. */
  wort: string;
  ton: KennzahlTon;
  anzahlAktiv: number;
}

/** Höchste Warnstufe über alle Gefahrengebiete — gelesen über `warnstufeKennzahl`, nicht
 *  über `warnstufeKarte` (Begründung in `lagebild.ts`: ohne Gebiet ist nichts gemeldet,
 *  nicht „vorsichtshalber Gefahr"). */
export function warnstufeKennzahlVon(gebiete: Gefahrengebiet[]): WarnstufeKennzahl {
  const v = verdichteGefahrengebiete(gebiete);
  const d = warnstufeKennzahl[v.hoechste];
  return {
    stufe: v.hoechste,
    wort: d.label,
    ton: ROLLE_ALS_TON[d.rolle],
    anzahlAktiv: v.anzahlAktiv,
  };
}

export interface AuftraegeKennzahl {
  offen: number;
  /** Davon schon angenommen (`in_arbeit`). */
  inArbeit: number;
  ueberfaellig: number;
  ton: KennzahlTon;
}

export function auftraegeKennzahl(auftraege: Auftrag[]): AuftraegeKennzahl {
  const offen = auftraege.filter(istOffen);
  const ueberfaellig = offen.filter((a) => a.ist_ueberfaellig).length;
  const inArbeit = offen.filter((a) => a.bearbeitungsstatus === 'in_arbeit').length;
  return {
    offen: offen.length,
    inArbeit,
    ueberfaellig,
    ton: ueberfaellig > 0 ? 'alarm' : 'neutral',
  };
}

/** Wie viele Abschnittsnamen die Notiz trägt, bevor sie zählt statt aufzählt. */
const NAMEN_MAX = 4;

export function abschnittNamen(abschnitte: Einsatzabschnitt[]): string {
  const namen = sortiereAbschnitte(abschnitte).map((a) => a.name);
  if (namen.length <= NAMEN_MAX) return namen.join(', ');
  return `${namen.slice(0, NAMEN_MAX).join(', ')} +${namen.length - NAMEN_MAX}`;
}

function sortiereAbschnitte(abschnitte: Einsatzabschnitt[]): Einsatzabschnitt[] {
  return [...abschnitte].sort((a, b) => a.sortier - b.sortier || a.id - b.id);
}

// ── Aufträge ────────────────────────────────────────────────────────────────────

/** Offen im Sinne des Überblicks: `offen` oder `in_arbeit` — dieselbe Menge wie
 *  `auftraegeOffen` im Lage-Dashboard (alles außer vollzogen/abgenommen). */
export function istOffen(a: Auftrag): boolean {
  return a.bearbeitungsstatus === 'offen' || a.bearbeitungsstatus === 'in_arbeit';
}

/**
 * Offene Aufträge in Lesefolge: überfällige zuerst, dann nach Frist aufsteigend; ohne
 * Frist ans Ende („unbestimmt ist nicht dringend", `lagebild.ts:auftragszeilen`). Bei
 * Gleichstand nach Erteilung, zuletzt nach id — damit ein Live-Refetch dieselbe Folge
 * liefert und keine Zeile springt.
 */
export function offeneAuftraege(auftraege: Auftrag[]): Auftrag[] {
  return auftraege.filter(istOffen).sort((a, b) => {
    if (a.ist_ueberfaellig !== b.ist_ueberfaellig) return a.ist_ueberfaellig ? -1 : 1;
    const fa = ms(a.frist_at);
    const fb = ms(b.frist_at);
    if (fa !== fb) {
      if (fa == null) return 1;
      if (fb == null) return -1;
      return fa - fb;
    }
    const ea = ms(a.erteilt_at) ?? 0;
    const eb = ms(b.erteilt_at) ?? 0;
    return ea - eb || a.id - b.id;
  });
}

/** „an …" — die Anzeigenamen der Empfänger, wie sie beim Erteilen festgehalten wurden;
 *  `null`, wenn keiner festgehalten ist (die Seite schreibt dann „ohne Empfänger" statt
 *  „an ohne Empfänger"). */
export function empfaengerText(a: Auftrag): string | null {
  const namen = (a.empfaenger ?? []).map((e) => e.snap_anzeige.trim()).filter(Boolean);
  return namen.length > 0 ? namen.join(', ') : null;
}

export function folgeText(anzahl: number): string | null {
  if (anzahl <= 0) return null;
  return anzahl === 1 ? '1 Auftrag' : `${anzahl} Aufträge`;
}

// ── Einsatzabschnitte ───────────────────────────────────────────────────────────

export interface MittelVerteilung {
  bereit: number;
  gebunden: number;
  ausfall: number;
  /** Mittel ohne Statuskategorie — gezählt, damit die drei Zellen nicht mehr behaupten. */
  ohne: number;
}

export interface AbschnittZeile {
  key: string;
  /** `null` nur für die Sammelzeile „Ohne Abschnitt" — sie hat keinen Deeplink. */
  abschnittId: number | null;
  name: string;
  leiter: string | null;
  /** Alle Einheiten im Teilbaum, auch untergeordnete Einheiten und Unterabschnitte. */
  einheiten: number;
  unterabschnitte: number;
  staerke: StaerkeSumme;
  staerkeText: string;
  mittel: MittelVerteilung;
  /** Offene Aufträge an diesen Abschnitt (oder einen Unterabschnitt), jüngste zuerst. */
  auftraege: Auftrag[];
}

export interface AbschnittRohdaten {
  abschnitte: Einsatzabschnitt[];
  einheiten: Einheit[];
  personal: EinsatzPersonal[];
  fahrzeuge: EinsatzFahrzeug[];
  material: EinsatzMaterial[];
  auftraege: Auftrag[];
}

function abschnittIdAusKey(key: string): number | null {
  const m = /^ab-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

function zaehleImTeilbaum(zeile: MeldebildZeile): { einheiten: number; abschnittIds: number[] } {
  let einheiten = 0;
  const abschnittIds: number[] = [];
  const id = abschnittIdAusKey(zeile.key);
  if (zeile.art === 'abschnitt' && id != null) abschnittIds.push(id);
  if (zeile.art === 'einheit' && !zeile.key.startsWith(OHNE_EINHEIT_KEY_PREFIX)) einheiten += 1;
  for (const kind of zeile.children ?? []) {
    const k = zaehleImTeilbaum(kind);
    einheiten += k.einheiten;
    abschnittIds.push(...k.abschnittIds);
  }
  return { einheiten, abschnittIds };
}

/**
 * Eine Zeile je OBERSTEM Abschnitt, die Zahlen KUMULIERT über Unterabschnitte — so liest
 * es das Meldebild (`baueKraeftebild`), und so summieren sich die Zeilen zur Einsatzstärke.
 * Die Sammelzeile „Ohne Abschnitt" steht am Ende, wenn sie etwas trägt: ohne sie gingen
 * die Kräfte außerhalb jedes Abschnitts still aus der Summe verloren.
 *
 * Die Mittelverteilung ist KEIN Einheitenstatus (den gibt es nicht, LFH-609), sondern die
 * Verfügbarkeit der Fahrzeuge UND des Personals im Teilbaum — die Seite beschriftet das so.
 */
export function abschnittZeilen(r: AbschnittRohdaten): AbschnittZeile[] {
  const { baum } = baueKraeftebild(r.abschnitte, r.einheiten, r.personal, r.fahrzeuge, r.material);
  const abschnittNachId = new Map(r.abschnitte.map((a) => [a.id, a]));
  const offen = r.auftraege
    .filter(istOffen)
    .sort((a, b) => (ms(b.erteilt_at) ?? 0) - (ms(a.erteilt_at) ?? 0) || b.id - a.id);

  const zeilen: AbschnittZeile[] = baum.map((knoten) => {
    const id = abschnittIdAusKey(knoten.key);
    const abschnitt = id != null ? abschnittNachId.get(id) : undefined;
    const { einheiten, abschnittIds } = zaehleImTeilbaum(knoten);
    const teilbaum = new Set(abschnittIds);
    const p = knoten.personalVerteilung;
    const f = knoten.fahrzeugVerteilung;
    const summe = (k: 'verfuegbar' | 'gebunden' | 'nicht_verfuegbar' | 'ohne') =>
      (p?.[k] ?? 0) + (f?.[k] ?? 0);
    return {
      key: knoten.key,
      abschnittId: knoten.key === OHNE_ABSCHNITT_KEY ? null : id,
      name: knoten.bezeichnung,
      leiter: abschnitt?.leiter_name ?? null,
      einheiten,
      unterabschnitte: Math.max(0, abschnittIds.length - 1),
      staerke: knoten.staerke,
      staerkeText: staerkeText(knoten.staerke),
      mittel: {
        bereit: summe('verfuegbar'),
        gebunden: summe('gebunden'),
        ausfall: summe('nicht_verfuegbar'),
        ohne: summe('ohne'),
      },
      auftraege:
        teilbaum.size === 0
          ? []
          : offen.filter((a) =>
              (a.empfaenger ?? []).some(
                (e) => e.abschnitt_id != null && teilbaum.has(e.abschnitt_id),
              ),
            ),
    };
  });

  // Oberste Abschnitte in der gepflegten Reihenfolge; „Ohne Abschnitt" bleibt am Ende.
  const rang = new Map(sortiereAbschnitte(r.abschnitte).map((a, i) => [a.id, i]));
  return zeilen.sort((a, b) => {
    if (a.abschnittId == null) return 1;
    if (b.abschnittId == null) return -1;
    return (rang.get(a.abschnittId) ?? 0) - (rang.get(b.abschnittId) ?? 0);
  });
}

// ── Entscheidungen ──────────────────────────────────────────────────────────────

export interface EntscheidungsAuswahl {
  eintraege: EtbEintragAnzeige[];
  /** `stunde`: die letzte Stunde trug Entscheidungen. `zuletzt`: Rückfall auf die jüngsten. */
  modus: 'stunde' | 'zuletzt';
}

/**
 * Entscheidungen der letzten Stunde, jüngste zuerst. Ist die Stunde leer, die letzten
 * {@link ENTSCHEIDUNGEN_RUECKFALL} — und der Modus sagt es, damit die Seite die
 * Überschrift nicht lügen lässt.
 */
export function entscheidungenAuswahl(
  eintraege: EtbEintragAnzeige[],
  jetzt: Dayjs,
): EntscheidungsAuswahl {
  const sortiert = eintraege
    .filter((e) => e.typ === 'entscheidung')
    .sort((a, b) => (ms(b.ereigniszeit) ?? 0) - (ms(a.ereigniszeit) ?? 0) || b.lfd_nr - a.lfd_nr);
  const grenze = jetzt.valueOf() - FENSTER_MINUTEN * 60_000;
  const stunde = sortiert.filter((e) => (ms(e.ereigniszeit) ?? -Infinity) >= grenze);
  if (stunde.length > 0) return { eintraege: stunde, modus: 'stunde' };
  return { eintraege: sortiert.slice(0, ENTSCHEIDUNGEN_RUECKFALL), modus: 'zuletzt' };
}

// ── Nächste Marken ──────────────────────────────────────────────────────────────

export type MarkenTon = 'neutral' | 'achtung' | 'alarm';
export type MarkenArt = 'auftrag' | 'erinnerung' | 'lagebesprechung';

export interface Marke {
  key: string;
  art: MarkenArt;
  /** id des Auftrags bzw. der Erinnerung; `null` bei der Lagebesprechung. */
  id: number | null;
  zeit: string;
  text: string;
  ton: MarkenTon;
  /** Zweiter Kanal neben der Farbe: „überfällig" · „in 23 min". */
  wort: string;
}

export interface MarkenAuswahl {
  marken: Marke[];
  /** Wie viele Marken hinter {@link MARKEN_MAX} nicht gezeigt werden. */
  weitere: number;
}

export function markenBewertung(zeit: Dayjs, jetzt: Dayjs): { ton: MarkenTon; wort: string } {
  const abstand = zeit.valueOf() - jetzt.valueOf();
  if (abstand <= 0) return { ton: 'alarm', wort: 'überfällig' };
  const minuten = Math.floor(abstand / 60_000);
  const wort = minuten === 0 ? 'in < 1 min' : `in ${dauerText(minuten)}`;
  return { ton: minuten < KNAPP_MINUTEN ? 'achtung' : 'neutral', wort };
}

/**
 * Die anstehenden Fristen aus drei Quellen: Frist offener Aufträge, Fälligkeit offener
 * Erinnerungen, nächste Lagebesprechung. Aufsteigend nach Zeit — Überfälliges steht damit
 * oben, und das ist gewollt: es ist die Marke, die schon gerissen ist.
 */
export function naechsteMarken(
  auftraege: Auftrag[],
  erinnerungen: Erinnerung[],
  naechsteLagebesprechung: string | null | undefined,
  jetzt: Dayjs,
): MarkenAuswahl {
  const roh: { key: string; art: MarkenArt; id: number | null; zeit: string; text: string }[] = [];
  for (const a of auftraege) {
    if (istOffen(a) && zeitpunkt(a.frist_at)) {
      roh.push({
        key: `a-${a.id}`,
        art: 'auftrag',
        id: a.id,
        zeit: a.frist_at!,
        text: a.auftrag_text,
      });
    }
  }
  for (const e of erinnerungen) {
    if (e.status === 'offen' && zeitpunkt(e.faellig_at)) {
      roh.push({
        key: `e-${e.id}`,
        art: 'erinnerung',
        id: e.id,
        zeit: e.faellig_at,
        text: e.titel,
      });
    }
  }
  if (zeitpunkt(naechsteLagebesprechung)) {
    roh.push({
      key: 'lagebesprechung',
      art: 'lagebesprechung',
      id: null,
      zeit: naechsteLagebesprechung!,
      text: 'Lagebesprechung',
    });
  }
  const sortiert = roh.sort(
    (a, b) => (ms(a.zeit) ?? 0) - (ms(b.zeit) ?? 0) || a.key.localeCompare(b.key),
  );
  const marken = sortiert.slice(0, MARKEN_MAX).map((m) => ({
    ...m,
    ...markenBewertung(zeitpunkt(m.zeit)!, jetzt),
  }));
  return { marken, weitere: Math.max(0, sortiert.length - MARKEN_MAX) };
}

/**
 * Grund der fehlenden Schreibberechtigung als ganzer Satz (C10/M16, C11/M45): die
 * Primäraktion steht gesperrt da, der Satz nennt den Grund. Nennt die zwei Schreibwege,
 * die der Überblick anbietet — Einträge erfassen und Abschnitte anlegen.
 */
export function ueberblickRechteText(einsatzStatus: EinsatzStatus): string {
  return einsatzStatus !== 'aktiv'
    ? 'Der Einsatz ist abgeschlossen — Einsatztagebuch und Abschnitte sind nur noch lesbar.'
    : 'Nur Einsatzleitung und Führungspersonal können Einträge erfassen und Abschnitte anlegen.';
}
