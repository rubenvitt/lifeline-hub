/**
 * Einträge des Flächen-Auswahlmenüs der Lagekarte (LFH-812): Liegen am Tipppunkt mehrere Flächen,
 * wählt der Mensch selbst (`entscheideKlickziel` → `mehrdeutig`). Hier steht, wie ein Eintrag
 * heißt und wie hoch er ist — rein, ohne Karte prüfbar.
 *
 * Die Kennung ist menschenlesbar, nie eine Datenbank-id (Bedien-Leitlinie): die Art der Fläche
 * und ihre Bezeichnung, ohne Bezeichnung die Art allein; bei Fachebenen der Name der Ebene und der
 * Titel der Meldung, damit zwei Warnungen derselben Ebene unterscheidbar bleiben.
 */
import type { FachebeneQuelle } from '../../api/fachebenen';
import type { ZoneTyp } from '../../api/types';
import { FACHEBENEN } from './fachebenen';
import { fachebeneTitel, pick } from './fachebeneTitel';
import type { Flaechenziel, Merkmal } from './klickziel';
import { zoneTypLabel } from './zonenStil';

export interface FlaechenKennung {
  /** Art der Fläche: Zonentyp, „Abschnitt" oder der Name der Fachebene. */
  art: string;
  /** Bezeichnung der einzelnen Fläche; `null`, wenn sie nichts über die Art hinaus sagt. */
  titel: string | null;
  /** Ganze Kennung als ein Text (Eintrag, zugänglicher Name). */
  text: string;
}

/** Die Quelle einer Fachebenen-Fläche aus ihrer Ebenen-id (`fachebene-<quelle>-fill`). */
export function fachebeneQuelleVon(layerId: string): FachebeneQuelle | null {
  const m = /^fachebene-(.+)-fill$/.exec(layerId);
  return m && m[1] in FACHEBENEN ? (m[1] as FachebeneQuelle) : null;
}

function kennung(art: string, titel: string | null): FlaechenKennung {
  const eigen = titel && titel !== art ? titel : null;
  return { art, titel: eigen, text: eigen ? `${art}: ${eigen}` : art };
}

export function flaechenKennung<F extends Merkmal>(ziel: Flaechenziel<F>): FlaechenKennung {
  const p = ziel.merkmal.properties ?? {};
  if (ziel.art === 'zone') {
    const typ = pick(p, 'typ');
    return kennung(typ ? zoneTypLabel(typ as ZoneTyp) : 'Zone', pick(p, 'label'));
  }
  if (ziel.art === 'abschnitt') return kennung('Abschnitt', pick(p, 'label'));
  const quelle = fachebeneQuelleVon(ziel.merkmal.layer.id);
  if (!quelle) return kennung('Fachebene', null);
  // NINA heißt im Inspector-Kopf immer „Amtliche Warnung"; im Menü unterscheidet die Überschrift.
  const titel =
    (quelle === 'nina' ? pick(p, 'HEADLINE', 'headline') : null) ?? fachebeneTitel(quelle, p);
  return kennung(FACHEBENEN[quelle].label, titel);
}

/**
 * Stil eines Menüeintrags: seit LFH-776 die gemeinsame Schale aller Punktmenüs der Karte.
 */
export { punktmenueEintragStil as flaechenwahlEintragStil } from './PunktankerMenue';
