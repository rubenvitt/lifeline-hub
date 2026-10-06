import { SEITENGROESSE } from '../api/etb';

/**
 * Seitenfenster der ETB-Zeitachse (LFH-947, Spec `etb-zeitachse-fenster`, D1/D4 in
 * `openspec/changes/archive/2026-10-06-lfh-947-etb-zeitachse-seitenfenster/design.md`).
 *
 * Die Liste hält höchstens {@link ETB_MAX_SEITEN} Seiten. TanStack lädt bei einer Invalidierung
 * so viele Seiten nach, wie im Cache liegen, nacheinander — ohne Deckel kostete jeder neue Eintrag
 * nach tiefem Blättern eine Kette über alle Seiten. Damit der Weg zurück nach oben bleibt, trägt
 * jeder Seitenparameter seine Richtung:
 *
 * - `undefined`: der Kopf (neueste Seite).
 * - `{ aelter: n }`: die Seite unter `n` (`before_lfd_nr`).
 * - `{ neuer: n }`: die Seite direkt über `n` (`after_lfd_nr`), absteigend geliefert.
 *
 * Jeder Folgeparameter stammt aus einer gelesenen Nummer, deshalb entsteht keine Lücke.
 */
export type EtbSeitenParam = { aelter: number } | { neuer: number } | undefined;

/** Höchstzahl gehaltener Seiten — Startwert aus dem Ticket, gemessen im Branch. */
export const ETB_MAX_SEITEN = 5;

interface Nummeriert {
  id: number;
  lfd_nr: number;
}

/** Parameter der nächsten (älteren) Seite nach `letzte`, oder `undefined` am unteren Ende. */
export function naechsterSeitenParam(
  letzte: readonly Nummeriert[],
  param: EtbSeitenParam,
): EtbSeitenParam {
  if (param && 'neuer' in param) {
    // Eine `neuer`-Seite sagt nichts über Älteres: darunter liegt mindestens der Cursor selbst.
    const unten = letzte[letzte.length - 1]?.lfd_nr ?? param.neuer + 1;
    return { aelter: unten };
  }
  if (letzte.length < SEITENGROESSE) return undefined;
  return { aelter: letzte[letzte.length - 1].lfd_nr };
}

/** Parameter der vorigen (neueren) Seite vor `erste`, oder `undefined`, wenn sie die neueste ist. */
export function vorigerSeitenParam(
  erste: readonly Nummeriert[],
  param: EtbSeitenParam,
): EtbSeitenParam {
  if (param == null) return undefined;
  if ('neuer' in param) {
    // Kurz heißt: über dem Cursor lag nichts mehr. Ein späterer Neuabruf derselben Seite füllt
    // sie mit neuen Einträgen auf; ist sie dann voll, gibt es wieder eine vorige.
    if (erste.length < SEITENGROESSE) return undefined;
    return { neuer: erste[0].lfd_nr };
  }
  return { neuer: erste[0]?.lfd_nr ?? param.aelter - 1 };
}

/**
 * Wohin ein Sprung auf `zielId` blättern muss (design.md D4): Kennung und laufende Nummer wachsen
 * in einem Einsatz gemeinsam (`etb::repo::einfuegen`, Rust-Test `kennung_waechst_mit_lfd_nr`).
 */
export function sprungRichtung(
  seiten: readonly (readonly Nummeriert[])[],
  zielId: number,
): 'da' | 'aelter' | 'neuer' | 'fehlt' {
  let hoechste = -Infinity;
  let kleinste = Infinity;
  for (const seite of seiten) {
    for (const e of seite) {
      if (e.id === zielId) return 'da';
      if (e.id > hoechste) hoechste = e.id;
      if (e.id < kleinste) kleinste = e.id;
    }
  }
  if (zielId > hoechste && hoechste !== -Infinity) return 'neuer';
  if (zielId < kleinste || kleinste === Infinity) return 'aelter';
  return 'fehlt';
}
