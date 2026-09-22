import type { Person, Sichtungskategorie, VerbleibArt } from '../api/types';
import { hatKoordinate } from './koordinate';

/**
 * Die Ableitungen der Betroffenen-Seitenleiste (Neuentwurf S7: „Sichtungsbild",
 * „Verbleib", „Offene Felder") und der Lücken-Markierung der Zeilen. Rein — ohne Render
 * prüfbar. Grundmenge ist immer die gelieferte Liste; stornierte Personen liefert
 * `GET …/personen` gar nicht erst (`src/person/repo.rs`, `storniert_at IS NULL`).
 *
 * ── WAS EINE LÜCKE IST ──────────────────────────────────────────────────────────────────
 *
 * Offen ist ein Feld nur bei einer ANGETROFFENEN Person (erfasst, betroffen, verstorben).
 * Eine vermisste Person hat naturgemäß weder Fundort noch Verbleib — sie als Lücke zu
 * zählen, meldete genau die Fälle als Versäumnis, in denen niemand etwas versäumt hat.
 * Abgemeldete sind abgeschlossen; eine Lücke dort ist keine Aufgabe mehr.
 *
 *  · ohne Verbleib — keine Verbleib-Art UND keine aktuelle Unfallhilfsstelle. Wer in einer
 *    UHS liegt, ist verortet; „Verbleib offen" hieße dort „wir wissen nicht, wo die Person
 *    ist", und das stimmt nicht.
 *  · ohne Fundort  — weder `antreff_ort` (Freitext) noch eine Fundort-Koordinate. Eine der
 *    beiden genügt: die Koordinate aus `#52.2691/9.1342` IST der Fundort, auch ohne Wort.
 *
 * ── VERBLEIB IST STRUKTUR, NICHT DIE KURZFORM ───────────────────────────────────────────
 *
 * Gezählt wird nach `aktuelle_verbleib_art` (LFH-613, Cache des jüngsten Verbleib-Ereignisses,
 * in derselben Transaktion gepflegt). Die Kurzform `aktueller_verbleib` bleibt Anzeigetext
 * und wird hier NICHT mehr zurückgeparst — ein Ziel mit „→" oder eine neue Art hätte den
 * Parser still auf „sonstiger" fallen lassen. Das Ziel (Klinik, Unterkunft) ist gespeichert,
 * wird aber bewusst nicht aufgegliedert: die Zählung beantwortet „wohin", nicht „in welches
 * Haus".
 *
 * Präzedenz je Person: Verbleib-Art vor Unfallhilfsstelle vor „offen" — trägt eine Person
 * beides (etwa „vor Ort" und noch eine UHS-Belegung), zählt die Art.
 */

/** Angetroffen = eine Person, bei der Fundort und Verbleib erwartbar sind. */
export function istAngetroffen(p: Pick<Person, 'status'>): boolean {
  return p.status === 'erfasst' || p.status === 'betroffen' || p.status === 'verstorben';
}

function leer(s: string | null | undefined): boolean {
  return s == null || s.trim() === '';
}

export interface Luecken {
  verbleib: boolean;
  fundort: boolean;
}

type LueckenFelder = Pick<
  Person,
  | 'status'
  | 'aktuelle_verbleib_art'
  | 'aktuelle_uhs_id'
  | 'antreff_ort'
  | 'antreff_lat'
  | 'antreff_lon'
>;

export function lueckenVon(p: LueckenFelder): Luecken {
  if (!istAngetroffen(p)) return { verbleib: false, fundort: false };
  return {
    verbleib: verbleibKlasse(p) === 'offen',
    fundort: leer(p.antreff_ort) && !hatKoordinate(p),
  };
}

export function hatLuecke(p: LueckenFelder): boolean {
  const l = lueckenVon(p);
  return l.verbleib || l.fundort;
}

/** Wortlaut des zweiten Kanals neben der Zeilentönung: „Verbleib, Fundort offen". */
export function lueckenText(l: Luecken): string | null {
  const teile = [l.verbleib && 'Verbleib', l.fundort && 'Fundort'].filter(Boolean);
  return teile.length === 0 ? null : `${teile.join(', ')} offen`;
}

// ── Verbleib ────────────────────────────────────────────────────────────────────────────

export type VerbleibKlasse = VerbleibArt | 'uhs' | 'offen';

export function verbleibKlasse(
  p: Pick<Person, 'aktuelle_verbleib_art' | 'aktuelle_uhs_id'>,
): VerbleibKlasse {
  if (p.aktuelle_verbleib_art != null) return p.aktuelle_verbleib_art;
  if (p.aktuelle_uhs_id != null) return 'uhs';
  return 'offen';
}

/** Exhaustiv über `VerbleibArt`: eine neue Art bricht den Typcheck statt still zu fehlen. */
const VERBLEIB_LABEL: Record<Exclude<VerbleibKlasse, 'uhs'>, string> = {
  transport: 'Transport',
  notunterkunft: 'Notunterkunft',
  entlassung: 'entlassen',
  vor_ort: 'vor Ort',
  verstorben: 'verstorben',
  offen: 'offen',
};

/** Wort einer Verbleib-Art — Rückfall der Anzeige, wenn die Kurzform fehlt. */
export function verbleibLabel(art: VerbleibArt): string {
  return VERBLEIB_LABEL[art];
}

export interface VerbleibPosten {
  schluessel: string;
  label: string;
  wert: number;
  /** `offen` ist die Lücke und wird in `achtung` gesetzt. */
  offen: boolean;
}

/**
 * Zählung „Verbleib" über die angetroffenen Personen. Eine UHS erscheint mit ihrer
 * Bezeichnung (je Stelle ein Posten), die Verbleib-Arten mit ihrem Wort, „offen" zuletzt
 * und IMMER — eine fehlende Zeile „offen 0" sähe aus wie „nicht erhoben".
 */
export function verbleibZaehlung(
  alle: readonly Person[],
  uhsName: (id: number) => string | undefined,
): VerbleibPosten[] {
  const zaehler = new Map<string, VerbleibPosten>();
  const zaehle = (schluessel: string, label: string, offen = false) => {
    const bisher = zaehler.get(schluessel);
    if (bisher) bisher.wert++;
    else zaehler.set(schluessel, { schluessel, label, wert: 1, offen });
  };
  let offen = 0;
  for (const p of alle) {
    if (!istAngetroffen(p)) continue;
    const k = verbleibKlasse(p);
    if (k === 'offen') offen++;
    else if (k === 'uhs') {
      const id = p.aktuelle_uhs_id!;
      zaehle(`uhs:${id}`, uhsName(id) ?? 'Unfallhilfsstelle');
    } else zaehle(k, VERBLEIB_LABEL[k]);
  }
  const posten = [...zaehler.values()].sort((a, b) => b.wert - a.wert);
  return [
    ...posten,
    { schluessel: 'offen', label: VERBLEIB_LABEL.offen, wert: offen, offen: true },
  ];
}

/**
 * „Transportiert / offen" (Lage-Dashboard, Fuß des Sichtungspaneels; Neuentwurf S3).
 *
 *  · transportiert — angetroffen, Verbleib-Art `transport` und Status NICHT `angemeldet`.
 *    Eine Voranmeldung an der Klinik ist kein erledigter Transport; ohne Statusangabe
 *    zählt der Transport (das Ereignis ist erfasst, nur nicht fortgeschrieben).
 *  · offen — dieselbe Lücke „Verbleib offen" wie auf der Betroffenen-Seite
 *    ({@link lueckenVon}): angetroffen, ohne Verbleib-Art und ohne Unfallhilfsstelle.
 */
export function transportBilanz(
  alle: readonly Pick<
    Person,
    'status' | 'aktuelle_verbleib_art' | 'aktueller_verbleib_status' | 'aktuelle_uhs_id'
  >[],
): { transportiert: number; offen: number } {
  let transportiert = 0;
  let offen = 0;
  for (const p of alle) {
    if (!istAngetroffen(p)) continue;
    const k = verbleibKlasse(p);
    if (k === 'transport' && p.aktueller_verbleib_status !== 'angemeldet') transportiert++;
    else if (k === 'offen') offen++;
  }
  return { transportiert, offen };
}

// ── Offene Felder ───────────────────────────────────────────────────────────────────────

export interface OffeneFelder {
  ohneVerbleib: number;
  ohneFundort: number;
  /** Datensätze mit mindestens einer Lücke — die Menge, die „Nur Lücken zeigen" zeigt. */
  datensaetze: number;
}

export function offeneFelder(alle: readonly Person[]): OffeneFelder {
  let ohneVerbleib = 0;
  let ohneFundort = 0;
  let datensaetze = 0;
  for (const p of alle) {
    const l = lueckenVon(p);
    if (l.verbleib) ohneVerbleib++;
    if (l.fundort) ohneFundort++;
    if (l.verbleib || l.fundort) datensaetze++;
  }
  return { ohneVerbleib, ohneFundort, datensaetze };
}

// ── Sichtungsbild ───────────────────────────────────────────────────────────────────────

/** Reihenfolge des Sichtungsbilds: Dringlichkeit zuerst, dann tot, unverletzt, ohne. */
export const SICHTUNGSBILD_REIHE = [
  'sk1',
  'sk2',
  'sk3',
  'sk4',
  'tot',
  'unverletzt',
  'ohne',
] as const satisfies readonly (Sichtungskategorie | 'ohne')[];

export type SichtungsbildSchluessel = (typeof SICHTUNGSBILD_REIHE)[number];

export interface Sichtungsbild {
  gesamt: number;
  je: Record<SichtungsbildSchluessel, number>;
}

/** Alle gelieferten Personen, je Sichtung; ungesichtet (auch vermisst) unter `ohne`. */
export function sichtungsbild(alle: readonly Pick<Person, 'aktuelle_sichtung'>[]): Sichtungsbild {
  const je = Object.fromEntries(SICHTUNGSBILD_REIHE.map((k) => [k, 0])) as Record<
    SichtungsbildSchluessel,
    number
  >;
  for (const p of alle) je[p.aktuelle_sichtung ?? 'ohne']++;
  return { gesamt: alle.length, je };
}
