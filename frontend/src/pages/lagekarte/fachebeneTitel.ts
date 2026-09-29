/**
 * Titel einer Fachebenen-Meldung als reiner Text (LFH-812): dieselbe Ableitung für den Kopf des
 * `FachebenenInspector` und die Einträge des Flächen-Auswahlmenüs. Ohne Zeichen — ein Emoji ist
 * keine Ikone; der Inspector setzt sein Wetterzeichen selbst davor.
 */
import type { FachebeneQuelle } from '../../api/fachebenen';
import { FACHEBENEN } from './fachebenen';

/** Wert als getrimmter String oder null (akzeptiert auch Zahlen). */
export function alsText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  return null;
}

/** Erstes nicht-leeres Feld aus mehreren möglichen Property-Namen. */
export function pick(p: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = alsText(p[k]);
    if (v) return v;
  }
  return null;
}

/** „DAUERREGEN" / „STARKES GEWITTER" → „Dauerregen" / „Starkes Gewitter". */
export function titelCase(v: string): string {
  return v
    .toLocaleLowerCase('de-DE')
    .replace(/(^|\s|-)([\p{L}])/gu, (_, sep, ch) => sep + ch.toLocaleUpperCase('de-DE'));
}

/** DWD: das Ereignis; NINA: „Amtliche Warnung"; sonst `titel`/`name`, Rückfall der Ebenenname. */
export function fachebeneTitel(quelle: FachebeneQuelle, p: Record<string, unknown>): string {
  if (quelle === 'dwd') {
    const event = pick(p, 'EVENT', 'event');
    return event ? titelCase(event) : 'Wetterwarnung';
  }
  if (quelle === 'nina') return 'Amtliche Warnung';
  return pick(p, 'titel', 'name') ?? FACHEBENEN[quelle].label;
}
