import { abrufZustand, type AbrufZustand } from '../../api/abrufZustand';
import type { ModulZaehler } from '../../api/types';

/**
 * Die Handlungsmengen des Führungsstands — Aufträge, Meldungen, Nachforderungen und (LLH-1145)
 * Erinnerungen und Lagemeldungen — aus dem Modulzähler des
 * Servers (`GET …/modul-zaehler`, `src/einsatz/zaehler.rs`).
 *
 * **Eine Heimat je Zahl (LFH-550):** Lage-Dashboard, Führungsüberblick und die Vorbereitung der
 * Lagebesprechung zählen diese Mengen NICHT über die Listen. Dieselbe Zahl steht so im
 * Modulpanel, im Führungsstand und im Überblick. „Überfällig" heißt „davon überfällig" (nur
 * offene), „Bestätigung überfällig" schließt eskalierte unbestätigte Meldungen ein.
 *
 * Fehlt ein Modul in der Antwort, darf die Person es nicht sehen: `gesperrt`, nie 0.
 */

type AuftragsZaehler = NonNullable<ModulZaehler['auftraege']>;
type MeldungsZaehler = NonNullable<ModulZaehler['meldungen']>;
export type NachforderungsZaehler = NonNullable<ModulZaehler['nachforderungen']>;
type ErinnerungsZaehler = NonNullable<ModulZaehler['erinnerungen']>;
type LagemeldungsZaehler = NonNullable<ModulZaehler['lagemeldungen']>;

/** Was an der Zähler-Abfrage gelesen wird (Teilmenge von `UseQueryResult`). */
export interface ZaehlerAbfrage {
  data: ModulZaehler | undefined;
  error: unknown;
  isError: boolean;
  isPending: boolean;
}

export type Zaehlstand<T> =
  { zustand: 'daten'; zahl: T } | { zustand: Exclude<AbrufZustand, 'daten'> };

function stand<T>(
  q: ZaehlerAbfrage,
  feld: (z: ModulZaehler) => T | null | undefined,
): Zaehlstand<T> {
  const z = abrufZustand(q);
  if (z !== 'daten') return { zustand: z };
  const zahl = q.data ? feld(q.data) : undefined;
  return zahl == null ? { zustand: 'gesperrt' } : { zustand: 'daten', zahl };
}

export function auftragsStand(q: ZaehlerAbfrage): Zaehlstand<AuftragsZaehler> {
  return stand(q, (z) => z.auftraege);
}

export function meldungsStand(q: ZaehlerAbfrage): Zaehlstand<MeldungsZaehler> {
  return stand(q, (z) => z.meldungen);
}

/** LLH-1078: die offenen Nachforderungen je Stufe (Überblick, Vorbereitung der Lagebesprechung). */
export function nachforderungsStand(q: ZaehlerAbfrage): Zaehlstand<NachforderungsZaehler> {
  return stand(q, (z) => z.nachforderungen);
}

/** LLH-1145: fällige offene Erinnerungen („Offene Vorgänge“ im Überblick). */
export function erinnerungsStand(q: ZaehlerAbfrage): Zaehlstand<ErinnerungsZaehler> {
  return stand(q, (z) => z.erinnerungen);
}

/** LLH-1145: neue Lagemeldungen (Notiz des Abschnitts Meldungen in „Offene Vorgänge“). */
export function lagemeldungsStand(q: ZaehlerAbfrage): Zaehlstand<LagemeldungsZaehler> {
  return stand(q, (z) => z.lagemeldungen);
}

/** Wortlaut für ein Modul, das die Person nicht sehen darf. */
export const NICHT_FREIGEGEBEN = 'nicht freigegeben';

/** „1 überfällig" · „keiner überfällig" — die überfälligen UNTER den offenen. */
export function auftraegeNotiz(z: AuftragsZaehler): string {
  return z.ueberfaellig > 0 ? `${z.ueberfaellig} überfällig` : 'keiner überfällig';
}

/**
 * „2 unterwegs" — die unterwegs UNTER den offenen Nachforderungen. Eine Formulierung für die
 * Werkzeugkachel (`stab/werkzeugZahlen.ts`) und die Lagekennzahl im Band (LLH-1371).
 */
export function nachforderungenNotiz(z: NachforderungsZaehler): string {
  return `${z.unterwegs} unterwegs`;
}

/** „2 neu" · „2 neu · 1 Bestätigung überfällig". */
export function meldungenNotiz(z: MeldungsZaehler): string {
  return (
    `${z.ungesehen} neu` +
    (z.bestaetigung_ueberfaellig > 0
      ? ` · ${z.bestaetigung_ueberfaellig} Bestätigung überfällig`
      : '')
  );
}
