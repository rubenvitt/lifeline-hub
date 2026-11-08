import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Person, PersonAnlass, Sichtungskategorie, VerbleibArt } from '../api/types';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { inZone } from '../anzeige/zeitDarstellung';
import { ANLASS_REIHE } from './personMeta';
import { hatKoordinate } from './koordinate';
import { nichtGeladen } from '../offline/lagebildKuerzung';

dayjs.extend(utc);

/**
 * Ableitungen der Betroffenen-Seitenleiste („Sichtungsbild", „Verbleib", „Offene Felder") und
 * der Lücken-Markierung der Zeilen. Rein. Stornierte Personen liefert `GET …/personen` nicht.
 *
 * ── WAS EINE LÜCKE IST ──────────────────────────────────────────────────────────────────
 * Offen ist ein Feld nur bei einer ANGETROFFENEN Person (erfasst, betroffen, verstorben). Eine
 * vermisste hat naturgemäß weder Fundort noch Verbleib; Abgemeldete sind abgeschlossen.
 *  · ohne Verbleib — keine Verbleib-Art UND keine aktuelle UHS. Wer in einer UHS liegt, ist
 *    verortet.
 *  · ohne Fundort  — weder `antreff_ort` noch eine Fundort-Koordinate; eine genügt. Ein ohne
 *    Netz nicht geladener Fundort (LFH-1095) ist unbekannt, keine Lücke.
 *
 * ── VERBLEIB IST STRUKTUR, NICHT DIE KURZFORM ───────────────────────────────────────────
 * Gezählt wird nach `aktuelle_verbleib_art`; die Kurzform `aktueller_verbleib` bleibt
 * Anzeigetext und wird nicht zurückgeparst. Das Ziel (Klinik, Unterkunft) wird nicht
 * aufgegliedert: die Zählung beantwortet „wohin", nicht „in welches Haus".
 * Präzedenz je Person: Verbleib-Art vor UHS vor „offen".
 */

/**
 * Abgeschlossen (LLH-1332, Spec `patienten-uebergabe`): übergeben, entlassen, in Notunterkunft
 * oder Verbleib des Leichnams. Der Server leitet `versorgung` ab, der Client rechnet nicht nach.
 * Standardansichten und Lagezahlen lassen solche Personen weg (`ohneAbgeschlossene`).
 */
export function istAbgeschlossen(p: Pick<Person, 'versorgung'>): boolean {
  return p.versorgung === 'abgeschlossen';
}

/** Personen in Versorgung (offen oder unterwegs), Reihenfolge unverändert. */
export function ohneAbgeschlossene<T extends Pick<Person, 'versorgung'>>(alle: readonly T[]): T[] {
  return alle.filter((p) => !istAbgeschlossen(p));
}

/** Angetroffen = eine Person, bei der Fundort und Verbleib erwartbar sind. */
export function istAngetroffen(p: Pick<Person, 'status'>): boolean {
  return p.status === 'erfasst' || p.status === 'betroffen' || p.status === 'verstorben';
}

function leer(s: string | null | undefined): boolean {
  return s == null || s.trim() === '';
}

interface Luecken {
  verbleib: boolean;
  fundort: boolean;
}

type LueckenFelder = Pick<
  Person,
  | 'status'
  | 'versorgung'
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
    fundort: !nichtGeladen(p, 'antreff_ort') && leer(p.antreff_ort) && !hatKoordinate(p),
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

export type VerbleibKlasse = VerbleibArt | 'unterwegs' | 'uhs' | 'offen';

/**
 * Klasse des Verbleibs: ein Eigentransport ohne Übergabe ist „unterwegs“ (LLH-1332), sonst die
 * Art; ohne Art die UHS, sonst offen.
 */
export function verbleibKlasse(
  p: Pick<Person, 'aktuelle_verbleib_art' | 'aktuelle_uhs_id' | 'versorgung'>,
): VerbleibKlasse {
  if (p.versorgung === 'unterwegs') return 'unterwegs';
  if (p.aktuelle_verbleib_art != null) return p.aktuelle_verbleib_art;
  if (p.aktuelle_uhs_id != null) return 'uhs';
  return 'offen';
}

/** Exhaustiv über `VerbleibArt`: eine neue Art bricht den Typcheck statt still zu fehlen. */
const VERBLEIB_LABEL: Record<Exclude<VerbleibKlasse, 'uhs'>, string> = {
  unterwegs: 'Unterwegs',
  transport: 'Transport',
  notunterkunft: 'Notunterkunft',
  entlassung: 'entlassen',
  vor_ort: 'vor Ort',
  verstorben: 'verstorben',
  offen: 'offen',
};

/** Wort einer Verbleib-Art — Rückfall der Anzeige, wenn die Kurzform fehlt. */
export function verbleibLabel(art: VerbleibArt | 'unterwegs'): string {
  return VERBLEIB_LABEL[art];
}

interface VerbleibPosten {
  schluessel: string;
  label: string;
  wert: number;
  /** `offen` ist die Lücke und wird in `achtung` gesetzt. */
  offen: boolean;
}

/**
 * Zählung „Verbleib" über die angetroffenen Personen: je UHS ein Posten, die Verbleib-Arten mit
 * ihrem Wort, „offen" zuletzt und IMMER — eine fehlende Zeile „offen 0" sähe aus wie „nicht
 * erhoben".
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
 * „Transportiert / offen" (Einsatzbericht; die Lage zählt seit LLH-1332 über
 * {@link versorgungsBilanz}).
 *  · transportiert — angetroffen, Verbleib-Art `transport`, Status NICHT `angemeldet` (eine
 *    Voranmeldung ist kein erledigter Transport; ohne Status zählt der Transport).
 *  · offen — dieselbe Lücke „Verbleib offen" wie auf der Betroffenen-Seite ({@link lueckenVon}).
 */
type TransportFelder = Pick<
  Person,
  | 'status'
  | 'versorgung'
  | 'aktuelle_verbleib_art'
  | 'aktueller_verbleib_status'
  | 'aktuelle_uhs_id'
>;

/**
 * Transportiert (Regel von {@link transportBilanz}; auch der Block Hilfeleistungen des Berichts,
 * LLH-1575): angetroffen, Verbleib-Klasse Transport oder unterwegs, nicht nur vorangemeldet.
 */
export function istTransportiert(p: TransportFelder): boolean {
  if (!istAngetroffen(p)) return false;
  const k = verbleibKlasse(p);
  return (k === 'transport' || k === 'unterwegs') && p.aktueller_verbleib_status !== 'angemeldet';
}

export function transportBilanz(alle: readonly TransportFelder[]): {
  transportiert: number;
  offen: number;
} {
  let transportiert = 0;
  let offen = 0;
  for (const p of alle) {
    if (istTransportiert(p)) transportiert++;
    else if (istAngetroffen(p) && verbleibKlasse(p) === 'offen') offen++;
  }
  return { transportiert, offen };
}

/**
 * „Unterwegs / offen / abgeschlossen“ (Lage-Dashboard, Fuß des Sichtungspaneels; LLH-1332, Spec
 * `betroffene-lagedaten`) über die angetroffenen Personen:
 *  · unterwegs — Eigentransport ohne quittierte Übergabe;
 *  · offen — dieselbe Lücke „Verbleib offen" wie auf der Betroffenen-Seite ({@link lueckenVon});
 *  · abgeschlossen — übergeben, entlassen, Notunterkunft, Verbleib des Leichnams.
 */
export function versorgungsBilanz(
  alle: readonly Pick<
    Person,
    'status' | 'versorgung' | 'aktuelle_verbleib_art' | 'aktuelle_uhs_id'
  >[],
): { unterwegs: number; offen: number; abgeschlossen: number } {
  let unterwegs = 0;
  let offen = 0;
  let abgeschlossen = 0;
  for (const p of alle) {
    if (!istAngetroffen(p)) continue;
    if (p.versorgung === 'abgeschlossen') abgeschlossen++;
    else if (p.versorgung === 'unterwegs') unterwegs++;
    else if (verbleibKlasse(p) === 'offen') offen++;
  }
  return { unterwegs, offen, abgeschlossen };
}

// ── Offene Felder ───────────────────────────────────────────────────────────────────────

interface OffeneFelder {
  ohneVerbleib: number;
  ohneFundort: number;
  /** Angetroffene Personen, deren Fundort ohne Netz nicht geladen ist (LFH-1095): weder offen
   *  noch vorhanden. */
  fundortNichtGeladen: number;
  /** Datensätze mit mindestens einer Lücke — die Menge, die „Nur Lücken zeigen" zeigt. */
  datensaetze: number;
}

export function offeneFelder(alle: readonly Person[]): OffeneFelder {
  let ohneVerbleib = 0;
  let ohneFundort = 0;
  let fundortNichtGeladen = 0;
  let datensaetze = 0;
  for (const p of alle) {
    const l = lueckenVon(p);
    if (l.verbleib) ohneVerbleib++;
    if (l.fundort) ohneFundort++;
    if (istAngetroffen(p) && nichtGeladen(p, 'antreff_ort')) fundortNichtGeladen++;
    if (l.verbleib || l.fundort) datensaetze++;
  }
  return { ohneVerbleib, ohneFundort, fundortNichtGeladen, datensaetze };
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

interface Sichtungsbild {
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

// ── Kontakte je Einheit ─────────────────────────────────────────────────────────────────

/** Ein Posten „Versorgt von“: die Einheit, ihr Abschnitt zur Abfragezeit und die Zahl ihrer Kontakte. */
export interface KontaktePosten {
  einheitId: number;
  name: string;
  abschnitt: string | null;
  wert: number;
}

/**
 * Kontakte je Einheit (LLH-1567, design.md D8): je versorgender Einheit die Zahl ihrer Patienten,
 * ohne Stornierte, mit Abgeschlossenen (ein Kontakt bleibt ein Kontakt). Personen ohne Einheit
 * zählen nicht. Absteigend nach Zahl, dann nach Name. Seitenleiste, Lagebild und Bericht zählen
 * mit dieser einen Funktion.
 */
export function kontakteJeEinheit(
  alle: readonly Pick<
    Person,
    | 'storniert_at'
    | 'versorgende_einheit_id'
    | 'versorgende_einheit_name'
    | 'versorgende_einheit_abschnitt_name'
  >[],
): KontaktePosten[] {
  const je = new Map<number, KontaktePosten>();
  for (const p of alle) {
    if (p.storniert_at != null || p.versorgende_einheit_id == null) continue;
    const bisher = je.get(p.versorgende_einheit_id);
    if (bisher) bisher.wert++;
    else
      je.set(p.versorgende_einheit_id, {
        einheitId: p.versorgende_einheit_id,
        name: p.versorgende_einheit_name ?? 'Einheit',
        abschnitt: p.versorgende_einheit_abschnitt_name ?? null,
        wert: 1,
      });
  }
  return [...je.values()].sort(
    (a, b) => b.wert - a.wert || a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }),
  );
}

// ── Anlass der Hilfeleistung (LLH-1566) ─────────────────────────────────────────────────

/** Schlüssel der Anlass-Zählung: der Katalog in seiner Folge, dann „ohne“. */
export type AnlassbildSchluessel = PersonAnlass | 'ohne';

interface Anlassbild {
  /** Gezählte Kontakte: alle gelieferten Personen außer den vermissten. */
  gesamt: number;
  je: Record<AnlassbildSchluessel, number>;
}

/**
 * Kontakte je Anlass der Hilfeleistung (LLH-1566), Grundlage für Lagebild (LLH-1574) und Bericht
 * (LLH-1575). Abgeschlossene zählen mit: im Sanitätsdienst ist der versorgte und entlassene Fall
 * der häufigste Kontakt. Vermisste sind kein Kontakt und zählen nicht; ohne Anlass unter `ohne`.
 */
export function anlassbild(alle: readonly Pick<Person, 'status' | 'anlass'>[]): Anlassbild {
  const je = Object.fromEntries([...ANLASS_REIHE, 'ohne'].map((k) => [k, 0])) as Record<
    AnlassbildSchluessel,
    number
  >;
  let gesamt = 0;
  for (const p of alle) {
    if (p.status === 'vermisst') continue;
    je[p.anlass ?? 'ohne']++;
    gesamt++;
  }
  return { gesamt, je };
}

// ── Kontakte je Stunde (LLH-1575) ───────────────────────────────────────────────────────

const STUNDE_MS = 3_600_000;

/** Eine Stunde des Verlaufs: Beginn als UTC-Wirestring, Zahl der Kontakte und ihre Anlässe. */
export interface StundenPosten {
  /** Beginn der Stunde in der Zone der Konventionen, als UTC-Wirestring (`YYYY-MM-DD HH:mm:ss`). */
  beginn: string;
  wert: number;
  je: Record<AnlassbildSchluessel, number>;
}

/**
 * Kontakte je Stunde über den ganzen Einsatz (LLH-1575, design.md D4; das Lagebild zählt in
 * einem festen Fenster, `pages/lage-dashboard/verlauf.ts`): Zeit des Kontakts ist `erfasst_at`
 * (bei einer vorgemerkten Aufnahme die Erfassungszeit). Gezählt wird wie in {@link anlassbild},
 * ohne Vermisste. Die Stunden gelten in der Zone der
 * Konventionen (`konv.zeitzone`, im Bericht die der Organisation); jede Stunde vom ersten bis zum
 * letzten Kontakt steht da, eine ohne Kontakt mit 0. Ohne Kontakt eine leere Liste.
 */
export function kontakteJeStunde(
  alle: readonly Pick<Person, 'status' | 'anlass' | 'erfasst_at'>[],
  konv: AnzeigeKonventionen,
): StundenPosten[] {
  const je = new Map<number, StundenPosten>();
  const leer = (ms: number): StundenPosten => ({
    beginn: dayjs.utc(ms).format('YYYY-MM-DD HH:mm:ss'),
    wert: 0,
    je: Object.fromEntries([...ANLASS_REIHE, 'ohne'].map((k) => [k, 0])) as Record<
      AnlassbildSchluessel,
      number
    >,
  });
  for (const p of alle) {
    if (p.status === 'vermisst') continue;
    const d = inZone(p.erfasst_at, konv);
    if (!d.isValid()) continue;
    // Nicht `startOf('hour')`: das Zonen-Plugin legt in der Nacht der Zeitumstellung beide
    // Stunden 02 Uhr auf dieselbe. Minuten und Sekunden der Wanduhr abziehen trifft auch Zonen
    // mit halben Stunden Versatz.
    const ms = d.valueOf() - (d.minute() * 60 + d.second()) * 1000 - d.millisecond();
    const posten = je.get(ms) ?? leer(ms);
    posten.wert++;
    posten.je[p.anlass ?? 'ohne']++;
    je.set(ms, posten);
  }
  if (je.size === 0) return [];
  const schluessel = [...je.keys()];
  const von = Math.min(...schluessel);
  const bis = Math.max(...schluessel);
  const reihe: StundenPosten[] = [];
  for (let ms = von; ms <= bis; ms += STUNDE_MS) reihe.push(je.get(ms) ?? leer(ms));
  return reihe;
}
