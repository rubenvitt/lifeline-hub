/**
 * Verpflegung (LFH-634) — Wortlaute und Zeitraumtexte an EINER Stelle.
 *
 * Kartenkopf, zugänglicher Name der Kartenaktionen und die Vorbelegung der Nachforderung
 * (design.md D9) nennen dasselbe Zeitfenster. Stünde die Formatierung an drei Stellen, liefen
 * „24.09. 12:00–13:30" am Kopf und „12:00–13:30" in der Nachforderung still auseinander, sobald
 * jemand eine davon anfasst.
 *
 * ZEIT: Wire-Strings sind UTC ohne Zonenkennung. Umgerechnet wird über `inZone` aus
 * `anzeige/format.ts` — die Zeitzone der Anzeige-Konventionen (die der Organisation), ohne sie
 * die Ortszeit des Browsers (`dayjs.utc(s).local()`). Damit stehen dieselben Uhrzeiten auf der
 * Karte wie im ETB-Eintrag, den der Server in der Zeitzone der Organisation schreibt (D5).
 *
 * ANFÜHRUNGSZEICHEN: ‚…‘ (U+201A/U+2018) wie in den ETB-Sätzen (`src/verpflegung/mod.rs`).
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
 * „24.09. 12:00–13:30", über Mitternacht „24.09. 22:00–25.09. 02:00" — dieselbe Form wie
 * `zeitraum_text` im Backend (D5), damit Karte und ETB-Eintrag gleich lauten.
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
 * Vorbelegung der Nachforderung aus einer Fehlmenge (design.md D9). `null` ohne Fehlmenge
 * GESAMT: eine Fehlmenge nur in einer Kostform ergäbe Anzahl 0, und die verwirft
 * `parseNachforderungVorbelegung` ganz — der Sprung öffnete dann eine leere Erfassung.
 */
export function nachforderungVorbelegung(
  zf: VerpflegungZeitfenster,
  konv: AnzeigeKonventionen = DEFAULT_KONVENTIONEN,
): NachforderungVorbelegung | null {
  if (zf.fehlmenge.gesamt <= 0) return null;
  return {
    art: 'Verpflegung',
    bezeichnung: `Essensportionen ${zitat(zf.bezeichnung)} ${uhrzeitenText(zf, konv)}`,
    anzahl: zf.fehlmenge.gesamt,
    begruendung: `Unterdeckung Verpflegung ${zitat(zf.bezeichnung)}: Bedarf ${zf.bedarf.gesamt}, ausgegeben ${zf.ausgegeben.gesamt}.`,
  };
}
