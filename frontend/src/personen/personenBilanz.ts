import type { Person, Sichtungskategorie } from '../api/types';

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
 *  · ohne Verbleib — kein `aktueller_verbleib` UND keine aktuelle Unfallhilfsstelle. Wer in
 *    einer UHS liegt, ist verortet; „Verbleib offen" hieße dort „wir wissen nicht, wo die
 *    Person ist", und das stimmt nicht.
 *  · ohne Fundort  — `antreff_ort` leer.
 *
 * ── VERBLEIB IST EINE KURZFORM, KEINE STRUKTUR ──────────────────────────────────────────
 *
 * `aktueller_verbleib` ist ein Cache-Text, den das Backend ausschließlich über
 * `VerbleibArt::kurzform` schreibt (`src/person/mod.rs`): `Transport → <Ziel>` bzw.
 * `Transport`, `entlassen`, `vor Ort`, `verstorben`. Die Art ist daraus sauber ableitbar;
 * das Ziel NICHT als eigene Achse — ein strukturierter Verbleib fehlt (LFH-613), also wird
 * nicht nach Klinik aufgegliedert. Ein Text außerhalb der vier Formen fällt auf
 * „sonstiger" statt still in eine der Arten.
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
  'status' | 'aktueller_verbleib' | 'aktuelle_uhs_id' | 'antreff_ort'
>;

export function lueckenVon(p: LueckenFelder): Luecken {
  if (!istAngetroffen(p)) return { verbleib: false, fundort: false };
  return {
    verbleib: leer(p.aktueller_verbleib) && p.aktuelle_uhs_id == null,
    fundort: leer(p.antreff_ort),
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

export type VerbleibKlasse =
  'transport' | 'entlassen' | 'vor_ort' | 'verstorben' | 'sonstig' | 'uhs' | 'offen';

/** Kurzform → Art. Pinnt die vier Backend-Formen (Test). */
export function verbleibArtAus(kurzform: string): Exclude<VerbleibKlasse, 'uhs' | 'offen'> {
  const t = kurzform.trim();
  if (t === 'Transport' || t.startsWith('Transport →')) return 'transport';
  if (t === 'entlassen') return 'entlassen';
  if (t === 'vor Ort') return 'vor_ort';
  if (t === 'verstorben') return 'verstorben';
  return 'sonstig';
}

export function verbleibKlasse(
  p: Pick<Person, 'aktueller_verbleib' | 'aktuelle_uhs_id'>,
): VerbleibKlasse {
  if (!leer(p.aktueller_verbleib)) return verbleibArtAus(p.aktueller_verbleib!);
  if (p.aktuelle_uhs_id != null) return 'uhs';
  return 'offen';
}

const VERBLEIB_LABEL: Record<Exclude<VerbleibKlasse, 'uhs'>, string> = {
  transport: 'Transport',
  entlassen: 'entlassen',
  vor_ort: 'vor Ort',
  verstorben: 'verstorben',
  sonstig: 'sonstiger',
  offen: 'offen',
};

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
