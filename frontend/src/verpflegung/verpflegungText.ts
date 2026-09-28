/**
 * Verpflegung — Wortlaute und Zeitraumtexte an EINER Stelle, damit Kartenkopf, zugängliche
 * Namen und Nachforderungs-Vorbelegung nicht auseinanderlaufen.
 *
 * Umgerechnet wird über `inZone` in der Zeitzone der Anzeige-Konventionen, damit dieselben
 * Uhrzeiten auf der Karte stehen wie im ETB-Eintrag, den der Server in der Org-Zeitzone schreibt.
 * Anführungszeichen ‚…‘ wie in den ETB-Sätzen (`src/verpflegung/mod.rs`).
 */
import { DEFAULT_KONVENTIONEN, inZone, type AnzeigeKonventionen } from '../anzeige/format';
import type { Kostform, Sonderkost, VerpflegungZeitfenster } from '../api/types';
import type { NachforderungVorbelegung } from '../routing/deeplinks';

/** Wortlaut je Kostform — exhaustiv über `Record`: eine sechste Kostform bricht den Typcheck. */
export const KOSTFORM_LABEL: Record<Kostform, string> = {
  vegetarisch: 'vegetarisch',
  vegan: 'vegan',
  ohne_schwein: 'ohne Schweinefleisch',
  diaet_allergenarm: 'Diät/allergenarm',
  saeugling_kleinkind: 'Säugling/Kleinkind',
};

/** Feste Reihenfolge der Kostformen (Anzeige und Dialog). */
export const KOSTFORMEN = Object.keys(KOSTFORM_LABEL) as Kostform[];

/** Die Bezeichnung in deutschen einfachen Anführungszeichen. */
export function zitat(bezeichnung: string): string {
  return `‚${bezeichnung}‘`;
}

/** „12:00" in der Anzeigezone; leer bei unlesbarem Wert. */
export function uhrzeit(wire: string, konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN): string {
  const d = inZone(wire, konv);
  return d.isValid() ? d.format('HH:mm') : '';
}

/** „12:00–13:30" — nur die Uhrzeiten (Bezeichnung der Nachforderung, D9). */
export function uhrzeitenText(
  zf: Pick<VerpflegungZeitfenster, 'von_at' | 'bis_at'>,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  return `${uhrzeit(zf.von_at, konv)}–${uhrzeit(zf.bis_at, konv)}`;
}

/**
 * „24.09. 12:00–13:30", über Mitternacht „24.09. 22:00–25.09. 02:00" — wie `zeitraum_text` im
 * Backend, damit Karte und ETB-Eintrag gleich lauten.
 */
export function zeitraumText(
  zf: Pick<VerpflegungZeitfenster, 'von_at' | 'bis_at'>,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): string {
  const v = inZone(zf.von_at, konv);
  const b = inZone(zf.bis_at, konv);
  if (!v.isValid() || !b.isValid()) return '';
  const bisText =
    v.format('YYYY-MM-DD') === b.format('YYYY-MM-DD')
      ? b.format('HH:mm')
      : b.format('DD.MM. HH:mm');
  return `${v.format('DD.MM. HH:mm')}–${bisText}`;
}

/**
 * Zeilenkennung eines Zeitfensters für zugängliche Namen („Mittag 24.09. 12:00–13:30").
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
  const fehlend = KOSTFORMEN.filter((k) => zf.fehlmenge.sonderkost[k] > 0).map(
    (k) => `${zf.fehlmenge.sonderkost[k]} ${KOSTFORM_LABEL[k]}`,
  );
  const sonderkost = fehlend.length > 0 ? ` Es fehlt Sonderkost: ${fehlend.join(', ')}.` : '';
  return {
    art: 'Verpflegung',
    bezeichnung: `Essensportionen ${zitat(zf.bezeichnung)} ${uhrzeitenText(zf, konv)}`,
    anzahl,
    begruendung: `Unterdeckung Verpflegung ${zitat(zf.bezeichnung)}: Bedarf ${zf.bedarf.gesamt}, ausgegeben ${zf.ausgegeben.gesamt}.${sonderkost}`,
  };
}
