import type { FormRule } from 'antd';
import type { AnzeigeKonventionen } from '../anzeige/format';
import { uhrzeitOhneDatum } from '../anzeige/zeitDarstellung';

/**
 * Dauern und Wanduhrzeiten der Ablösung (LLH-1122): Dauern in Anzeige und Eingabe in einer Form,
 * Wechselzeiten getrennt (LLH-1437).
 *
 * - **Dauer** („Rhythmus 8 h“, „7:30 h“, „45 min“): nie „8.0“ oder „7,5“ in der Anzeige. Die
 *   Lage spricht vom 8-Stunden-Rhythmus; eine halbe Stunde steht als „:30“ wie auf der Uhr. Das
 *   Feld liest jede Anzeige zurück und dazu bloße Stunden („8“), „h:mm“, Minuten („90 min“) und
 *   das Dezimalkomma („7,5“), weil das die Eingaben sind, die eine Führungskraft tippt.
 * - **Wechselzeiten** zeigt {@link formatUhrzeiten} in der Zeitdarstellung („0600/1800“ bzw.
 *   „06:00/18:00“, Rolle `uhrzeit` über `anzeige/zeitDarstellung.ts:uhrzeitOhneDatum`); das Feld
 *   steht immer taktisch ({@link uhrzeitenFeldText}), so wie man sie tippt. Die Maske liest beide
 *   Formen. An den Server gehen sie als `HH:MM`, sortiert und ohne Doppel wie dort
 *   (`src/schichtmodell/mod.rs`, `WerteBody::check`).
 *
 * Rein; die Grenzen kommen aus `api/eingabegrenzen.ts`.
 */

/** „45 min“ · „8 h“ · „7:30 h“ — ganze Minuten. */
export function formatDauer(minuten: number): string {
  if (minuten < 60) return `${minuten} min`;
  const h = Math.floor(minuten / 60);
  const m = minuten % 60;
  return m === 0 ? `${h} h` : `${h}:${String(m).padStart(2, '0')} h`;
}

/** Ergebnis einer Dauer-Eingabe. */
export type ParsedDauer =
  { art: 'leer' } | { art: 'ungueltig' } | { art: 'minuten'; minuten: number };

const STUNDEN = /^(\d{1,3})\s*h?$/i;
const STUNDEN_MINUTEN = /^(\d{1,3}):([0-5]\d)\s*h?$/i;
const DEZIMAL = /^(\d{1,3})[,.](\d{1,2})\s*h?$/i;
const MINUTEN = /^(\d{1,5})\s*min$/i;

/** Liest eine Dauer (Regeln im Dateikopf); leer und unlesbar sind eigene Ergebnisse. */
export function parseDauer(text: string | null | undefined): ParsedDauer {
  const t = (text ?? '').trim();
  if (t === '') return { art: 'leer' };
  let treffer = MINUTEN.exec(t);
  if (treffer) return { art: 'minuten', minuten: Number(treffer[1]) };
  treffer = STUNDEN.exec(t);
  if (treffer) return { art: 'minuten', minuten: Number(treffer[1]) * 60 };
  treffer = STUNDEN_MINUTEN.exec(t);
  if (treffer) return { art: 'minuten', minuten: Number(treffer[1]) * 60 + Number(treffer[2]) };
  treffer = DEZIMAL.exec(t);
  if (treffer) {
    const minuten = Math.round(Number(`${treffer[1]}.${treffer[2]}`) * 60);
    return { art: 'minuten', minuten };
  }
  return { art: 'ungueltig' };
}

/** Minuten einer Eingabe, die die Regel {@link dauerRegel} schon geprüft hat; leer → `null`. */
export function dauerMinuten(text: string | null | undefined): number | null {
  const p = parseDauer(text);
  return p.art === 'minuten' ? p.minuten : null;
}

/** Vorbelegung eines Dauerfeldes: dieselbe Form wie die Anzeige. */
export function dauerFeldText(minuten: number | null | undefined): string | undefined {
  return minuten == null ? undefined : formatDauer(minuten);
}

/**
 * Prüfung eines Dauerfeldes: lesbar und zwischen `min` und `max` Minuten; leer nur, wenn nicht
 * `pflicht`. Die Meldung nennt die Grenzen in derselben Form wie die Anzeige.
 */
export function dauerRegel(opts: {
  pflicht: boolean;
  min: number;
  max: number;
  pflichtText?: string;
}): FormRule {
  return {
    validator: (_regel, wert: string | undefined) => {
      const p = parseDauer(wert);
      if (p.art === 'leer') {
        return opts.pflicht
          ? Promise.reject(new Error(opts.pflichtText ?? 'Bitte eine Dauer angeben'))
          : Promise.resolve();
      }
      if (p.art === 'ungueltig') {
        return Promise.reject(new Error('Dauer wie „8 h“, „7:30 h“ oder „45 min“'));
      }
      if (p.minuten < opts.min || p.minuten > opts.max) {
        return Promise.reject(
          new Error(`Zwischen ${formatDauer(opts.min)} und ${formatDauer(opts.max)}`),
        );
      }
      return Promise.resolve();
    },
  };
}

/** Anzeige: `['06:00', '18:00']` → „0600/1800“ bzw. „06:00/18:00“, je nach Darstellung. */
export function formatUhrzeiten(zeiten: readonly string[], konv: AnzeigeKonventionen): string {
  return zeiten.map((z) => uhrzeitOhneDatum(z, konv)).join('/');
}

/** Vorbelegung des Feldes „Wechselzeiten“: `['06:00', '18:00']` → „0600/1800“, immer taktisch. */
export function uhrzeitenFeldText(zeiten: readonly string[]): string {
  return zeiten.map((z) => z.replace(':', '')).join('/');
}

/** Ergebnis einer Eingabe von Wechselzeiten; `ungueltig` nennt die erste unlesbare. */
export type ParsedUhrzeiten =
  { art: 'leer' } | { art: 'ungueltig'; text: string } | { art: 'zeiten'; zeiten: string[] };

const UHRZEIT = /^(\d{1,2}):?(\d{2})$/;

/** Eine Uhrzeit `HHMM`, `HMM` oder `H:MM`/`HH:MM` → `HH:MM`; sonst `null`. */
function parseUhrzeit(text: string): string | null {
  const treffer = UHRZEIT.exec(text);
  if (!treffer) return null;
  const h = Number(treffer[1]);
  const m = Number(treffer[2]);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Liest Wechselzeiten, getrennt durch Leerzeichen, Komma, Semikolon oder Schrägstrich. */
export function parseUhrzeiten(text: string | null | undefined): ParsedUhrzeiten {
  const teile = (text ?? '').split(/[\s,;/]+/).filter((t) => t !== '');
  if (teile.length === 0) return { art: 'leer' };
  const zeiten: string[] = [];
  for (const teil of teile) {
    const z = parseUhrzeit(teil);
    if (z == null) return { art: 'ungueltig', text: teil };
    zeiten.push(z);
  }
  return { art: 'zeiten', zeiten: [...new Set(zeiten)].sort() };
}

/** Anzahl der Eingaben vor dem Entdoppeln — so zählt der Server gegen seine Grenze. */
export function countUhrzeitenEingaben(text: string | null | undefined): number {
  return (text ?? '').split(/[\s,;/]+/).filter((t) => t !== '').length;
}

/** Prüfung des Feldes „Wechselzeiten“: mindestens eine, höchstens `max`, jede lesbar. */
export function uhrzeitenRegel(max: number): FormRule {
  return {
    validator: (_regel, wert: string | undefined) => {
      const p = parseUhrzeiten(wert);
      if (p.art === 'leer') {
        return Promise.reject(new Error('Bitte mindestens eine Wechselzeit angeben'));
      }
      if (p.art === 'ungueltig') {
        return Promise.reject(new Error(`„${p.text}“ ist keine Uhrzeit wie 0600 oder 18:00`));
      }
      if (countUhrzeitenEingaben(wert) > max) {
        return Promise.reject(new Error(`Höchstens ${max} Wechselzeiten`));
      }
      return Promise.resolve();
    },
  };
}
