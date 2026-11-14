import type { AnzeigeKonventionen } from '../anzeige/format';
import { ZEITDARSTELLUNG_VORGABE } from '../anzeige/zeitDarstellung';
import { SYSTEM_RUFNAME } from './systemKennung';

/**
 * Leseansicht des ETB in Spalten (Change `kwc2yszv-etb-neuentwurf`, design.md D1, Spec
 * `etb-zeitachse-darstellung`, „Spaltenzeile in kompakter Dichte“) — die reinen Teile: welche
 * Zeilenform auf welcher Fläche gilt, die Spaltenbreiten, die Kopf und Zeile TEILEN (eine
 * Konstante, kein Messen), und die Lesart von Von → An.
 */

/**
 * Die drei Formen einer Zeitachsenzeile:
 * - `spalten` — kompakte Dichte ab `lg`: feste Spalten (`EtbSpaltenzeile`) unter einem Spaltenkopf;
 * - `handschirm` — unter `md` in jeder Dichte: Kopfzeile, darunter der Text in voller Breite;
 * - `zeitachse` — sonst (komfortabel und Handschuh ab `md`, kompakt zwischen `md` und `lg`): der
 *   gemeinsame Baustein `Zeitachseneintrag`, den elf andere Flächen nutzen und den das ETB nicht
 *   umbaut (D1).
 */
export type EtbZeilenform = 'spalten' | 'handschirm' | 'zeitachse';

export function etbZeilenform(args: {
  schmal: boolean;
  abLg: boolean;
  kompakt: boolean;
}): EtbZeilenform {
  if (args.schmal) return 'handschirm';
  return args.kompakt && args.abLg ? 'spalten' : 'zeitachse';
}

/**
 * Die Spalten in ihrer Folge, als Spuren des CSS-Grids. Kopf (`EtbSpaltenkopf`) und Zeile
 * (`EtbSpaltenzeile`) lesen DIESELBE Liste über {@link ETB_SPALTEN_RASTER}; so fluchten sie ohne
 * Messung.
 *
 * Von → An und Vermerk sind Variablen (`etbSpaltenzeile.css`): ab 1100 px Zeitachsenbreite die
 * Entwurfsmaße 210 und 124 px, darunter Anteile der Breite (13 % und 11 %). Mit den festen Maßen
 * fiele die Spalte Inhalt unter 1093 px unter 45 % der Contentbreite (Regel
 * `frontend/src/etb/AGENTS.md`, „Spaltenzeile“): Zeit, Nr., Typ, Menü, Einzug und Rinnen nehmen
 * schon 267 px. Die Zeitspalte hängt an der Zeitdarstellung ({@link zeitSpalteBreite}), die
 * Menüspalte an der Bedienhöhe der Dichte; beide setzt die Zeitachse als Variable.
 */
export const ETB_SPALTEN = [
  { name: 'Zeit', spur: 'var(--etb-spalte-zeit, 56px)' },
  { name: 'Nr.', spur: '36px' },
  { name: 'Typ', spur: '84px' },
  { name: 'Von → An', spur: 'var(--etb-spalte-vonan, 210px)' },
  { name: 'Inhalt', spur: 'minmax(0, 1fr)' },
  { name: 'Vermerk', spur: 'var(--etb-spalte-vermerk, 124px)' },
  { name: '', spur: 'var(--etb-spalte-menue, 30px)' },
] as const;

export const ETB_SPALTEN_RASTER = ETB_SPALTEN.map((s) => s.spur).join(' ');

/** Rinne zwischen den Spalten. */
export const ETB_SPALTEN_RINNE = 8;

/** Typkante links an der Zeile (wie im Entwurf 3 px) und der Einzug dahinter — auch im Kopf. */
export const ETB_SPALTEN_KANTE = 3;
export const ETB_SPALTEN_EINZUG = 10;

/**
 * Breite der Zeitspalte in px: Mono 15 px (0,6 em je Ziffer). Taktisch höchstens sechs Zeichen
 * (`DDHHMM` für einen früheren Tag), sonst „DD.MM. HH:mm“ mit zwölf.
 */
export function zeitSpalteBreite(konv: Pick<AnzeigeKonventionen, 'zeitdarstellung'>): number {
  const art = konv.zeitdarstellung ?? ZEITDARSTELLUNG_VORGABE;
  return art === 'taktisch' ? 56 : 110;
}

/** Was in der Spalte Von → An steht (Spec, „Eigener Vermerk statt Von → An“). */
export type VonAnAnzeige =
  { art: 'weg'; von: string; an: string } | { art: 'vermerk'; stelle: string } | null;

/**
 * Von → An eines Eintrags. Gleiche Seiten (eine Entscheidung der Einsatzleitung, die sie selbst
 * festhält) stehen als „Vermerk <Stelle>“; „System → System“ sagt nichts und fällt weg (LLH-1106),
 * eine fehlende Seite bleibt leer und wird als „—“ gezeigt.
 */
export function vonAnAnzeige(von?: string | null, an?: string | null): VonAnAnzeige {
  const v = von?.trim() ?? '';
  const a = an?.trim() ?? '';
  if (!v && !a) return null;
  if (v === SYSTEM_RUFNAME && a === SYSTEM_RUFNAME) return null;
  if (v === a) return { art: 'vermerk', stelle: v };
  return { art: 'weg', von: v, an: a };
}

/** Der volle Text der Spalte Von → An samt Meldeweg — Titel bei Auslassung. */
export function vonAnTitel(anzeige: VonAnAnzeige, weg?: string): string {
  const kern =
    anzeige == null
      ? ''
      : anzeige.art === 'vermerk'
        ? `Vermerk ${anzeige.stelle}`
        : `${anzeige.von || '—'} → ${anzeige.an || '—'}`;
  return [kern, weg].filter(Boolean).join(' · ');
}
