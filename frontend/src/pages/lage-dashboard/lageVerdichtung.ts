import type { GefahrBewertung, Gefahrengebiet, LageberichtAnzeige, Person, Schaden, Tier, Uhs, Warnstufe } from '../../api/types';

export interface SkVerteilung {
  sk1: number; sk2: number; sk3: number; sk4: number;
  tot: number; unverletzt: number;
  /** Personen ohne Sichtung (aktuelle_sichtung === null). */
  ohne: number;
}

export interface PersonStatusVerteilung {
  erfasst: number; vermisst: number; betroffen: number;
  verstorben: number; abgemeldet: number;
}

export interface BetroffeneVerdichtung {
  sk: SkVerteilung;
  status: PersonStatusVerteilung;
  /** Personen mit Sichtung SK I–IV (medizinisch/triage-relevant). */
  patienten: number;
  vermisst: number;
  gesamt: number;
}

const WARNSTUFE_RANG: Record<Warnstufe, number> = {
  keine: 0, niedrig: 1, mittel: 2, hoch: 3, akut: 4,
};

/** Ordinales Maximum aller Warnstufen; 'keine' wenn leer. */
export function hoechsteWarnstufe(bewertungen: GefahrBewertung[]): Warnstufe {
  let max: Warnstufe = 'keine';
  for (const b of bewertungen) {
    if (WARNSTUFE_RANG[b.warnstufe] > WARNSTUFE_RANG[max]) max = b.warnstufe;
  }
  return max;
}

export interface GefahrVerdichtung {
  hoechste: Warnstufe;
  /** Anzahl Bewertungen mit Warnstufe !== 'keine'. */
  anzahlAktiv: number;
}

export function verdichteGefahren(bewertungen: GefahrBewertung[]): GefahrVerdichtung {
  return {
    hoechste: hoechsteWarnstufe(bewertungen),
    anzahlAktiv: bewertungen.filter((b) => b.warnstufe !== 'keine').length,
  };
}

const WARNSTUFE_RANG_MAP: Record<Warnstufe, number> = {
  keine: 0, niedrig: 1, mittel: 2, hoch: 3, akut: 4,
};

/** Gefahren-Verdichtung aus Gefahrengebiet-Übersicht (ohne Einzel-Matrix-Requests). */
export function verdichteGefahrengebiete(gebiete: Gefahrengebiet[]): GefahrVerdichtung {
  let max: Warnstufe = 'keine';
  let anzahlAktiv = 0;
  for (const g of gebiete) {
    if (WARNSTUFE_RANG_MAP[g.hoechste_warnstufe] > WARNSTUFE_RANG_MAP[max]) {
      max = g.hoechste_warnstufe;
    }
    if (g.hoechste_warnstufe !== 'keine') anzahlAktiv += 1;
  }
  return { hoechste: max, anzahlAktiv };
}

export function verdichtePersonen(personen: Person[]): BetroffeneVerdichtung {
  const sk: SkVerteilung = { sk1: 0, sk2: 0, sk3: 0, sk4: 0, tot: 0, unverletzt: 0, ohne: 0 };
  const status: PersonStatusVerteilung = {
    erfasst: 0, vermisst: 0, betroffen: 0, verstorben: 0, abgemeldet: 0,
  };
  for (const p of personen) {
    if (p.aktuelle_sichtung === null) sk.ohne += 1;
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

export interface TierVerdichtung { aktiv: number; vermisst: number; abgeschlossen: number; gesamt: number; }
export function verdichteTiere(tiere: Tier[]): TierVerdichtung {
  const v: TierVerdichtung = { aktiv: 0, vermisst: 0, abgeschlossen: 0, gesamt: tiere.length };
  for (const t of tiere) v[t.status] += 1;
  return v;
}

export interface UhsVerdichtung { geplant: number; aktiv: number; aufgeloest: number; gesamt: number; }
export function verdichteUhs(uhs: Uhs[]): UhsVerdichtung {
  const v: UhsVerdichtung = { geplant: 0, aktiv: 0, aufgeloest: 0, gesamt: uhs.length };
  for (const u of uhs) v[u.status] += 1;
  return v;
}

export interface SchadenVerdichtung { offen: number; uebergeben: number; abgeschlossen: number; gesamt: number; }
export function verdichteSchaeden(schaeden: Schaden[]): SchadenVerdichtung {
  const v: SchadenVerdichtung = { offen: 0, uebergeben: 0, abgeschlossen: 0, gesamt: schaeden.length };
  for (const s of schaeden) v[s.status] += 1;
  return v;
}
