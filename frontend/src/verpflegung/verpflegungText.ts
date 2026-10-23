/**
 * Verpflegung — Wortlaute und Zeitraumtexte an EINER Stelle, damit Kartenkopf, zugängliche
 * Namen und Nachforderungs-Vorbelegung nicht auseinanderlaufen.
 *
 * Umgerechnet wird über `inZone` in der Zeitzone der Anzeige-Konventionen, damit dieselben
 * Uhrzeiten auf der Karte stehen wie im ETB-Eintrag, den der Server in der Org-Zeitzone schreibt;
 * die Schreibweise kommt aus dem Formatkern (LLH-1061, taktisch `1200`).
 * Anführungszeichen ‚…‘ wie in den ETB-Sätzen (`src/verpflegung/mod.rs`).
 */
import { DEFAULT_KONVENTIONEN, inZone, type AnzeigeKonventionen } from '../anzeige/format';
import { tagUndUhrzeit, uhrzeit as uhrzeitRolle, zeitKurz } from '../anzeige/zeitDarstellung';
import type {
  Kostform,
  Sonderkost,
  SonderkostEingabe,
  Verpflegungsart,
  VerpflegungsstelleArt,
  VerpflegungZeitfenster,
} from '../api/types';
import type { NachforderungVorbelegung } from '../routing/deeplinks';

/** Wortlaut je Kostform — exhaustiv über `Record`: eine sechste Kostform bricht den Typcheck. */
export const KOSTFORM_LABEL: Record<Kostform, string> = {
  vegetarisch: 'vegetarisch',
  vegan: 'vegan',
  ohne_schwein: 'ohne Schweinefleisch',
  diaet_allergenarm: 'Diät/allergenarm',
  saeugling_kleinkind: 'Säugling/Kleinkind',
};

/** Art einer Verpflegungsstelle (LLH-1040), exhaustiv über `Record`. */
export const STELLE_ART_LABEL: Record<VerpflegungsstelleArt, string> = {
  feldkueche: 'Feldküche',
  ausgabestelle: 'Ausgabestelle',
  zufuehrung: 'Zuführung',
};

/** Verpflegungsart eines Zeitfensters (LLH-1040, nur Anzeige), exhaustiv über `Record`. */
export const VERPFLEGUNGSART_LABEL: Record<Verpflegungsart, string> = {
  warm: 'warm',
  kalt: 'kalt',
  getraenke: 'Getränke',
};

/** Feste Reihenfolge der Kostformen (Anzeige und Dialog). */
export const KOSTFORMEN = Object.keys(KOSTFORM_LABEL) as Kostform[];

/** Die Bezeichnung in deutschen einfachen Anführungszeichen. */
export function zitat(bezeichnung: string): string {
  return `‚${bezeichnung}‘`;
}

/** „1200" bzw. „12:00" in der Anzeigezone; leer bei unlesbarem Wert. */
export function uhrzeit(wire: string, konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN): string {
  return uhrzeitRolle(wire, konv);
}

/** „1200–1330" — nur die Uhrzeiten (Bezeichnung der Nachforderung, D9). */
export function uhrzeitenText(
  zf: Pick<VerpflegungZeitfenster, 'von_at' | 'bis_at'>,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return `${uhrzeit(zf.von_at, konv)}–${uhrzeit(zf.bis_at, konv)}`;
}

/**
 * „241200–1330", über Mitternacht „242200–250200" (bzw. „24.09. 12:00–13:30“) — der Anfang mit
 * Tag, das Ende in der Rolle „kurz“ mit dem Tag des Anfangs als „heute“ (LLH-1061). Der Server
 * schreibt `zeitraum_text` noch in der alten Form; er zieht in einem eigenen Schritt nach.
 */
export function zeitraumText(
  zf: Pick<VerpflegungZeitfenster, 'von_at' | 'bis_at'>,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  const von = tagUndUhrzeit(zf.von_at, konv);
  const bis = zeitKurz(zf.bis_at, konv, inZone(zf.von_at, konv));
  if (!von || !bis) return '';
  return `${von}–${bis}`;
}

/**
 * Zeilenkennung eines Zeitfensters für zugängliche Namen („Mittag 241200–1330").
 * Die Bezeichnung allein reicht nicht: „Mittag" gibt es an jedem Einsatztag.
 */
export function zeitfensterKennung(
  zf: Pick<VerpflegungZeitfenster, 'bezeichnung' | 'von_at' | 'bis_at'>,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return `${zf.bezeichnung} ${zeitraumText(zf, konv)}`;
}

/** Die belegten Kostformen einer Sonderkost — `>0` im Bedarf ODER in der Ausgabe. */
export function belegteKostformen(...mengen: readonly Sonderkost[]): Kostform[] {
  return KOSTFORMEN.filter((k) => mengen.some((m) => m[k] > 0));
}

/** „davon 3 vegan, 2 vegetarisch" — leer ohne Sonderkost. */
/** Eine Eingabe trägt nur die belegten Kostformen; fehlende sind 0. */
export function sonderkostVoll(sk: SonderkostEingabe | undefined): Sonderkost {
  return {
    vegetarisch: sk?.vegetarisch ?? 0,
    vegan: sk?.vegan ?? 0,
    ohne_schwein: sk?.ohne_schwein ?? 0,
    diaet_allergenarm: sk?.diaet_allergenarm ?? 0,
    saeugling_kleinkind: sk?.saeugling_kleinkind ?? 0,
  };
}

export function sonderkostText(sk: Sonderkost): string {
  const teile = KOSTFORMEN.filter((k) => sk[k] > 0).map((k) => `${sk[k]} ${KOSTFORM_LABEL[k]}`);
  return teile.length > 0 ? `davon ${teile.join(', ')}` : '';
}

/**
 * Anzahl, die eine Nachforderung anfordert: die Gesamtfehlmenge, bei einer Fehlmenge nur in
 * Kostformen deren Summe (Sonderkost ist Teilmenge der EP). 0 heißt: nichts nachzufordern.
 */
export function nachforderungsAnzahl(zf: VerpflegungZeitfenster): number {
  const sonderkost = KOSTFORMEN.reduce((s, k) => s + zf.fehlmenge.sonderkost[k], 0);
  return Math.max(zf.fehlmenge.gesamt, sonderkost);
}

/**
 * Vorbelegung der Nachforderung aus einer Fehlmenge; `null` ohne Fehlmenge. Fehlende Sonderkost
 * steht in der Begründung, sonst ginge sie auf dem Weg verloren.
 */
export function nachforderungVorbelegung(
  zf: VerpflegungZeitfenster,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): NachforderungVorbelegung | null {
  const anzahl = nachforderungsAnzahl(zf);
  if (anzahl <= 0) return null;
  return {
    art: 'Verpflegung',
    bezeichnung: `Essensportionen ${zitat(zf.bezeichnung)} ${uhrzeitenText(zf, konv)}`,
    anzahl,
    begruendung: `Unterdeckung Verpflegung ${zitat(zf.bezeichnung)}: Bedarf ${zf.bedarf.gesamt}, ausgegeben ${zf.ausgegeben.gesamt}.${fehlendeSonderkost(zf)}`,
  };
}

/** „ Es fehlt Sonderkost: …" in fester Reihenfolge, leer ohne fehlende Sonderkost. */
function fehlendeSonderkost(zf: VerpflegungZeitfenster): string {
  const fehlend = KOSTFORMEN.filter((k) => zf.fehlmenge.sonderkost[k] > 0).map(
    (k) => `${zf.fehlmenge.sonderkost[k]} ${KOSTFORM_LABEL[k]}`,
  );
  return fehlend.length > 0 ? ` Es fehlt Sonderkost: ${fehlend.join(', ')}.` : '';
}

/**
 * Text der Meldung an die Einsatzleitung, mit der das Verpflegungsgerät eine Fehlmenge meldet
 * (LFH-1044: das Gerät fordert nicht selbst nach); `null` ohne Fehlmenge.
 */
export function meldungVorbelegung(
  zf: VerpflegungZeitfenster,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string | null {
  const anzahl = nachforderungsAnzahl(zf);
  if (anzahl <= 0) return null;
  return `Fehlmenge Verpflegung ${zitat(zf.bezeichnung)} ${uhrzeitenText(zf, konv)}: ${anzahl} EP (Bedarf ${zf.bedarf.gesamt}, ausgegeben ${zf.ausgegeben.gesamt}).${fehlendeSonderkost(zf)}`;
}
