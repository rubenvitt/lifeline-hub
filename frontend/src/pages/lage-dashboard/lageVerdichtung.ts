import type {
  GefahrBewertung,
  Gefahrengebiet,
  Gefahrentyp,
  LageberichtKopf,
  Person,
  Schaden,
  Sichtungskategorie,
  Tier,
  Uhs,
  Warnstufe,
} from '../../api/types';
import { GEFAHRENTYPEN_ALPHABETISCH } from '../gefahren/gefahrenSchema';
import { NICHT_BEURTEILT, istBeurteilt } from '../gefahren/beurteilung';
import { gefahrengebietName } from '../../api/gefahren';
import { ohneAbgeschlossene, sichtungsbild } from '../../personen/personenBilanz';

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

interface PersonStatusVerteilung {
  erfasst: number;
  vermisst: number;
  betroffen: number;
  verstorben: number;
  abgemeldet: number;
}

interface BetroffeneVerdichtung {
  sk: SkVerteilung;
  status: PersonStatusVerteilung;
  /** Personen mit Sichtung SK I–IV in Versorgung (medizinisch/triage-relevant). */
  patienten: number;
  /** Abgeschlossene Patienten (LLH-1332): in `gesamt`, in keiner SK-Zahl. */
  abgeschlossen: number;
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

interface GefahrVerdichtung {
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

interface GefahrenmatrixVerdichtung {
  /** Nur Gefahrentypen mit einer Stufe über „keine“, in Katalogreihenfolge. */
  zeilen: GefahrenZeile[];
}

/**
 * Verdichtet die Matrizen aller Gefahrengebiete eines Einsatzes.
 *
 * „keine“ ist die Vorgabe jeder Zelle (LLH-1090, Spec `gefahrenmatrix`): eine ausdrücklich auf
 * „keine“ gesetzte Zelle sagt dasselbe wie eine ohne Bewertung, deshalb steht ein Typ nur mit einer
 * Stufe darüber als Zeile da — wie im Matrixauszug der Palette. Ob überhaupt jemand hingesehen hat,
 * sagt nicht die Matrix, sondern die Beurteilung je Gebiet ({@link beurteilungHinweis}).
 *
 * Reihenfolge alphabetisch wie die Matrix (LLH-1102, `sortGefahrenAlphabetisch`), nicht nach
 * Dringlichkeit (Prüfliste Kriterium 9): eine Gefahr steht überall an derselben Stelle.
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
  for (const { wert, label } of GEFAHRENTYPEN_ALPHABETISCH) {
    const stufe = hoechste.get(wert);
    if (stufe != null && stufe !== 'keine') zeilen.push({ typ: wert, label, stufe });
  }
  return { zeilen };
}

/** Bis zu so vielen nicht beurteilten Gebieten nennt der Hinweis die Namen, darüber die Zahl. */
const NAMEN_HOECHSTENS = 2;

/**
 * Hinweis auf nicht beurteilte Gefahrengebiete (LLH-1090) statt der früheren Zählung
 * unbewerteter Gefahrentypen: „Hangrutsch Kirchberg: nicht beurteilt“, bei mehr als zwei Gebieten
 * „3 Gebiete nicht beurteilt“. `null`, wenn jedes Gebiet beurteilt ist oder es keines gibt.
 */
export function beurteilungHinweis(gebiete: readonly Gefahrengebiet[]): string | null {
  const offen = gebiete.filter((g) => !istBeurteilt(g));
  if (offen.length === 0) return null;
  if (offen.length > NAMEN_HOECHSTENS) return `${offen.length} Gebiete ${NICHT_BEURTEILT}`;
  return offen.map((g) => `${gefahrengebietName(g.label, g.id)}: ${NICHT_BEURTEILT}`).join(' · ');
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
 * Sichtungsbild aus der SK-Verteilung. Der Anteil bezieht sich auf alle Gesichteten (SK I–IV, tot,
 * unverletzt), nicht auf alle Erfassten — Ungesichtete nennt die Seite separat.
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
  // Die SK-Verteilung zählt EINE Stelle (LFH-550): `sichtungsbild`, wie die Seitenleiste der
  // Betroffenen. Hier nur die Übernahme der Schlüssel. Abgeschlossene zählen nicht (LLH-1332,
  // Spec `lage-verdichtung`; Gegenstück im Lagemonitor `person::zaehle_lage_sichtung`).
  const inVersorgung = ohneAbgeschlossene(personen);
  const sk: SkVerteilung = { ...sichtungsbild(inVersorgung).je };
  const status: PersonStatusVerteilung = {
    erfasst: 0,
    vermisst: 0,
    betroffen: 0,
    verstorben: 0,
    abgemeldet: 0,
  };
  for (const p of personen) status[p.status] += 1;
  return {
    sk,
    status,
    patienten: sk.sk1 + sk.sk2 + sk.sk3 + sk.sk4,
    abgeschlossen: personen.length - inVersorgung.length,
    vermisst: status.vermisst,
    gesamt: personen.length,
  };
}

/**
 * Jüngster Lagebericht nach `erstellt_at` (das Format ist lexikografisch sortierbar). Null bei
 * leerer Liste.
 */
export function neuesterLagebericht(berichte: LageberichtKopf[]): LageberichtKopf | null {
  if (berichte.length === 0) return null;
  return berichte.reduce((neuester, b) => (b.erstellt_at > neuester.erstellt_at ? b : neuester));
}

interface TierVerdichtung {
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

interface UhsVerdichtung {
  geplant: number;
  aktiv: number;
  aufgeloest: number;
  gesamt: number;
  /** Kräfte an aktiven UHS, Summe ihrer Stärke (LFH-1045, Spec `uhs-staerke`). */
  kraefteAktiv: number;
}
export function verdichteUhs(uhs: Uhs[]): UhsVerdichtung {
  const v: UhsVerdichtung = {
    geplant: 0,
    aktiv: 0,
    aufgeloest: 0,
    gesamt: uhs.length,
    kraefteAktiv: 0,
  };
  for (const u of uhs) {
    v[u.status] += 1;
    if (u.status === 'aktiv') {
      v.kraefteAktiv += u.staerke.fuehrer + u.staerke.unterfuehrer + u.staerke.mannschaft;
    }
  }
  return v;
}

interface SchadenVerdichtung {
  offen: number;
  uebergeben: number;
  abgeschlossen: number;
  gesamt: number;
}
export function verdichteSchaeden(
  schaeden: readonly Pick<Schaden, 'status'>[],
): SchadenVerdichtung {
  const v: SchadenVerdichtung = {
    offen: 0,
    uebergeben: 0,
    abgeschlossen: 0,
    gesamt: schaeden.length,
  };
  for (const s of schaeden) v[s.status] += 1;
  return v;
}
