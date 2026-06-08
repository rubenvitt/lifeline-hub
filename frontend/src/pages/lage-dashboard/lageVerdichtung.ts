import type { GefahrBewertung, LageberichtAnzeige, Person, Warnstufe } from '../../api/types';

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
