/**
 * Verpflegung — zeitabhängige Einstufung eines Zeitfensters.
 *
 * Deckung und Fehlmenge rechnet das Backend (`src/verpflegung/deckung.rs`). Die Einstufung hängt
 * zusätzlich an „hat begonnen?" und damit an der Uhr; sie läuft deshalb nur hier (neu bewertet
 * über `useJetzt`) — vom Backend wäre sie zwischen zwei Abrufen veraltet.
 *
 * Wire-Strings sind UTC OHNE Zonenkennung: nur über `dayjs.utc` lesen, nie `dayjs(s)`.
 */
import dayjs, { type Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import type { Kostform, VerpflegungZeitfenster } from '../api/types';
import type { VerpflegungDeckung } from '../theme/statusFarben';

dayjs.extend(utc);

/** Die fünf Kostformen in fester Reihenfolge — exhaustiv über `Record`, damit eine sechste
 *  Kostform im generierten Typ hier den Typcheck bricht statt still zu fehlen. */
const KOSTFORMEN: Record<Kostform, true> = {
  vegetarisch: true,
  vegan: true,
  ohne_schwein: true,
  diaet_allergenarm: true,
  saeugling_kleinkind: true,
};

/** Wire-Zeit (UTC ohne Zone) → Zeitpunkt; `null` bei unlesbarem Wert. */
function wireZeit(wire: string): Dayjs | null {
  const d = dayjs.utc(wire);
  return d.isValid() ? d : null;
}

/** Keine Fehlmenge, weder gesamt noch in einer der fünf Kostformen. */
function istGedeckt(zf: VerpflegungZeitfenster): boolean {
  if (zf.fehlmenge.gesamt !== 0) return false;
  return (Object.keys(KOSTFORMEN) as Kostform[]).every((k) => zf.fehlmenge.sonderkost[k] === 0);
}

/**
 * gedeckt (keine Fehlmenge) · offen (Fehlmenge, noch nicht begonnen) · unterdeckung (Fehlmenge,
 * begonnen). `jetzt == von` gilt als begonnen; ein unlesbarer Beginn ebenfalls, damit eine
 * Fehlmenge auffällt.
 */
export function deckungEinstufung(zf: VerpflegungZeitfenster, jetzt: Dayjs): VerpflegungDeckung {
  if (istGedeckt(zf)) return 'gedeckt';
  const von = wireZeit(zf.von_at);
  if (von && jetzt.valueOf() < von.valueOf()) return 'offen';
  return 'unterdeckung';
}

/**
 * Trennung „laufend & anstehend" / „vergangen": vergangen erst, wenn das Ende VOR jetzt liegt.
 * Ein unlesbares Ende bleibt bei „laufend" sichtbar.
 */
export function istVergangen(zf: VerpflegungZeitfenster, jetzt: Dayjs): boolean {
  const bis = wireZeit(zf.bis_at);
  return bis !== null && bis.valueOf() < jetzt.valueOf();
}
