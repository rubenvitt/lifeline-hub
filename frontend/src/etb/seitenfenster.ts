import { SEITENGROESSE, type EtbAbfrage } from '../api/etb';
import {
  seitenLimit,
  type CursorAdapter,
  type FensterParam,
} from '../components/fensterBeideRichtungen';

/**
 * Seitenfenster der ETB-Zeitachse (LFH-947, Spec `etb-zeitachse-fenster`, D1/D4 in
 * `openspec/changes/archive/2026-10-06-lfh-947-etb-zeitachse-seitenfenster/design.md`).
 *
 * Seit LLH-2036 blättert das ETB über den gemeinsamen Helfer `components/fensterBeideRichtungen.ts`
 * wie Chat und Infotelefon: höchstens `FENSTER_MAX_SEITEN` Seiten, Seitenparameter mit Richtung,
 * nach oben einer mehr (`seitenLimit`), und eine nicht volle `neuer`-Seite vorn gilt als Kopf
 * (`useKopfAnnehmen`). Hier steht nur, was am ETB hängt: der Cursor (die laufende Nummer), ihre
 * Abfrageparameter und die Sprungrichtung eines Deeplinks.
 */
interface Nummeriert {
  id: number;
  lfd_nr: number;
}

/** Cursor der Zeitachse: die laufende Nummer (`before_lfd_nr`/`after_lfd_nr`). */
export const ETB_CURSOR: CursorAdapter<Nummeriert, number> = {
  cursor: (e) => e.lfd_nr,
  einschliessendAelter: (n) => n + 1,
  einschliessendNeuer: (n) => n - 1,
};

/** Die Seitenmerkmale eines Fensterparameters: Richtung als Cursor und Größe (`seitenLimit`). */
export function etbSeitenAbfrage(
  param: FensterParam<number>,
): Pick<EtbAbfrage, 'before_lfd_nr' | 'after_lfd_nr' | 'limit'> {
  const limit = seitenLimit(SEITENGROESSE, param);
  if (param == null) return { limit };
  if ('aelter' in param) return { before_lfd_nr: param.aelter, limit };
  return { after_lfd_nr: param.neuer, limit };
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
