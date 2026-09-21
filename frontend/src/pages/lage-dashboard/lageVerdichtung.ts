import type {
  GefahrBewertung,
  Gefahrengebiet,
  Gefahrentyp,
  LageberichtAnzeige,
  Person,
  Schaden,
  Sichtungskategorie,
  Tier,
  Uhs,
  Warnstufe,
} from '../../api/types';
import { GEFAHRENTYPEN } from '../gefahren/gefahrenSchema';

export interface SkVerteilung {
  sk1: number;
  sk2: number;
  sk3: number;
  sk4: number;
  tot: number;
  unverletzt: number;
  /** Personen ohne Sichtung (aktuelle_sichtung === null). */
  ohne: number;
}

export interface PersonStatusVerteilung {
  erfasst: number;
  vermisst: number;
  betroffen: number;
  verstorben: number;
  abgemeldet: number;
}

export interface BetroffeneVerdichtung {
  sk: SkVerteilung;
  status: PersonStatusVerteilung;
  /** Personen mit Sichtung SK I–IV (medizinisch/triage-relevant). */
  patienten: number;
  vermisst: number;
  gesamt: number;
}

export const WARNSTUFE_RANG: Record<Warnstufe, number> = {
  keine: 0,
  niedrig: 1,
  mittel: 2,
  hoch: 3,
  akut: 4,
};

export interface GefahrVerdichtung {
  hoechste: Warnstufe;
  /** Anzahl Gefahrengebiete mit höchster Warnstufe !== 'keine'. */
  anzahlAktiv: number;
}

/** Gefahren-Verdichtung aus Gefahrengebiet-Übersicht (ohne Einzel-Matrix-Requests). */
export function verdichteGefahrengebiete(gebiete: Gefahrengebiet[]): GefahrVerdichtung {
  let max: Warnstufe = 'keine';
  let anzahlAktiv = 0;
  for (const g of gebiete) {
    if (WARNSTUFE_RANG[g.hoechste_warnstufe] > WARNSTUFE_RANG[max]) {
      max = g.hoechste_warnstufe;
    }
    if (g.hoechste_warnstufe !== 'keine') anzahlAktiv += 1;
  }
  return { hoechste: max, anzahlAktiv };
}

/** Eine Zeile der Gefahrenmatrix im Lagebild: ein Gefahrentyp, verdichtet über ALLE
 *  Gefahrengebiete und Schutzobjekte auf seine höchste Warnstufe. */
export interface GefahrenZeile {
  typ: Gefahrentyp;
  label: string;
  stufe: Warnstufe;
}

export interface GefahrenmatrixVerdichtung {
  /** Nur BEWERTETE Gefahrentypen, in Katalogreihenfolge. */
  zeilen: GefahrenZeile[];
  /** Gefahrentypen ohne jede Bewertung in irgendeinem Gebiet. */
  unbewertet: number;
}

/**
 * Verdichtet die Matrizen aller Gefahrengebiete eines Einsatzes (Neuentwurf S3).
 *
 * „KEINE" UND „UNBEWERTET" SIND ZWEI AUSSAGEN. Eine Bewertung mit Warnstufe `keine` ist
 * eine Meldung („hier ist nachgesehen worden, es besteht keine Gefahr"); ein Typ ohne jede
 * Bewertung ist eine Lücke. Die erste steht als Zeile mit leerem Balken und dem Wort
 * „keine" da, die zweite erscheint NICHT als Zeile, sondern als Zähler darunter — sonst
 * sähen dreizehn Zeilen „keine" aus wie ein geprüfter, ruhiger Einsatz.
 *
 * Die Reihenfolge ist die des Katalogs (`GEFAHRENTYPEN`), nicht die Dringlichkeit: eine
 * Zeile steht in jedem Zustand an ihrem Platz (Prüfliste Kriterium 9). Das deckt sich mit
 * dem Entwurf, der ebenfalls nicht nach Stufe sortiert.
 */
export function verdichteGefahrenmatrix(
  bewertungen: readonly GefahrBewertung[],
): GefahrenmatrixVerdichtung {
  const hoechste = new Map<Gefahrentyp, Warnstufe>();
  for (const b of bewertungen) {
    const bisher = hoechste.get(b.gefahrentyp);
    if (bisher == null || WARNSTUFE_RANG[b.warnstufe] > WARNSTUFE_RANG[bisher]) {
      hoechste.set(b.gefahrentyp, b.warnstufe);
    }
  }
  const zeilen: GefahrenZeile[] = [];
  for (const { wert, label } of GEFAHRENTYPEN) {
    const stufe = hoechste.get(wert);
    if (stufe != null) zeilen.push({ typ: wert, label, stufe });
  }
  return { zeilen, unbewertet: GEFAHRENTYPEN.length - zeilen.length };
}

/** Eine Zeile des Sichtungsbilds. */
export interface SichtungsZeile {
  kategorie: Sichtungskategorie;
  wert: number;
  /** Anteil an allen GESICHTETEN Personen, 0…1. */
  anteil: number;
}

/** Die vier Patientenkategorien stehen immer da — auch mit 0, eine Null ist ein Befund. */
const SICHTUNG_IMMER: readonly Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4'];
/** Diese zwei nur, wenn es sie gibt: sie sind keine Behandlungsstufe. */
const SICHTUNG_FALLS_VORHANDEN: readonly Sichtungskategorie[] = ['tot', 'unverletzt'];

/**
 * Sichtungsbild aus der SK-Verteilung (Neuentwurf S3).
 *
 * Der Anteil bezieht sich auf alle gesichteten Personen (SK I–IV, tot, unverletzt) — nicht
 * auf alle erfassten: eine Person ohne Sichtung hat keine Kategorie, sie gehört nicht in
 * den Nenner eines Kategorienanteils. Die Ungesichteten nennt die Seite separat.
 */
export function sichtungsZeilen(sk: SkVerteilung): SichtungsZeile[] {
  const gesichtet = sk.sk1 + sk.sk2 + sk.sk3 + sk.sk4 + sk.tot + sk.unverletzt;
  const kategorien = [...SICHTUNG_IMMER, ...SICHTUNG_FALLS_VORHANDEN.filter((k) => sk[k] > 0)];
  return kategorien.map((kategorie) => ({
    kategorie,
    wert: sk[kategorie],
    anteil: gesichtet > 0 ? sk[kategorie] / gesichtet : 0,
  }));
}

export function verdichtePersonen(personen: Person[]): BetroffeneVerdichtung {
  const sk: SkVerteilung = { sk1: 0, sk2: 0, sk3: 0, sk4: 0, tot: 0, unverletzt: 0, ohne: 0 };
  const status: PersonStatusVerteilung = {
    erfasst: 0,
    vermisst: 0,
    betroffen: 0,
    verstorben: 0,
    abgemeldet: 0,
  };
  for (const p of personen) {
    if (p.aktuelle_sichtung == null) sk.ohne += 1;
    else sk[p.aktuelle_sichtung] += 1;
    status[p.status] += 1;
  }
  return {
    sk,
    status,
    patienten: sk.sk1 + sk.sk2 + sk.sk3 + sk.sk4,
    vermisst: status.vermisst,
    gesamt: personen.length,
  };
}

/**
 * Jüngster Lagebericht nach `erstellt_at`. Das Format 'YYYY-MM-DD HH:MM:SS' ist
 * lexikografisch sortierbar. Null bei leerer Liste.
 */
export function neuesterLagebericht(berichte: LageberichtAnzeige[]): LageberichtAnzeige | null {
  if (berichte.length === 0) return null;
  return berichte.reduce((neuester, b) => (b.erstellt_at > neuester.erstellt_at ? b : neuester));
}

export interface TierVerdichtung {
  aktiv: number;
  vermisst: number;
  abgeschlossen: number;
  gesamt: number;
}
export function verdichteTiere(tiere: Tier[]): TierVerdichtung {
  const v: TierVerdichtung = { aktiv: 0, vermisst: 0, abgeschlossen: 0, gesamt: tiere.length };
  for (const t of tiere) v[t.status] += 1;
  return v;
}

export interface UhsVerdichtung {
  geplant: number;
  aktiv: number;
  aufgeloest: number;
  gesamt: number;
}
export function verdichteUhs(uhs: Uhs[]): UhsVerdichtung {
  const v: UhsVerdichtung = { geplant: 0, aktiv: 0, aufgeloest: 0, gesamt: uhs.length };
  for (const u of uhs) v[u.status] += 1;
  return v;
}

export interface SchadenVerdichtung {
  offen: number;
  uebergeben: number;
  abgeschlossen: number;
  gesamt: number;
}
export function verdichteSchaeden(schaeden: Schaden[]): SchadenVerdichtung {
  const v: SchadenVerdichtung = {
    offen: 0,
    uebergeben: 0,
    abgeschlossen: 0,
    gesamt: schaeden.length,
  };
  for (const s of schaeden) v[s.status] += 1;
  return v;
}
