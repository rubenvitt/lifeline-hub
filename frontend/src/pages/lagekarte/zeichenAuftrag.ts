import type { ZoneTyp } from '../../api/types';
import type { ZeichnenAuftrag } from '../../routing/deeplinks';
import type { ZeichenModus } from './zeichnen';
import { FREIE_SKIZZE_VORGABEFARBE, ZONE_TYPEN } from './zonenStil';

/** Der Zonen-Entwurf, mit dem `onZoneZeichnenStart` den Zeichenmodus betritt. */
export interface ZonenZeichenEntwurf {
  typ: ZoneTyp;
  modus: ZeichenModus;
  farbe?: string;
}

/**
 * Übersetzt einen Zeichnen-Auftrag aus `?zeichnen=` (LFH-825) in den Entwurf, den der Knopf des
 * Typs im Zeichnen-Paneel starten würde — Geometrie aus `ZONE_TYPEN`, eine Wahrheit mit dem
 * Paneel. `null` heißt: nicht zeichnen, nur räumen.
 *
 * - Typ mit fester Geometrie: eine passende Form ist erlaubt, eine abweichende macht den Auftrag
 *   ungültig (eine Absperrgrenze als Fläche wird nicht still umgedeutet).
 * - Typ mit `beides`: die Form wählt, ohne Form gilt die Fläche (erster Knopf im Paneel), Farbe
 *   wie im Paneel.
 * - Typ ohne Eintrag in `ZONE_TYPEN`: `null`.
 */
export function zeichenAuftragZuEntwurf(auftrag: ZeichnenAuftrag): ZonenZeichenEntwurf | null {
  const info = ZONE_TYPEN.find((t) => t.typ === auftrag.typ);
  if (!info) return null;
  if (info.geometrie === 'beides') {
    return {
      typ: info.typ,
      modus: auftrag.form === 'linie' ? 'linie' : 'polygon',
      farbe: FREIE_SKIZZE_VORGABEFARBE,
    };
  }
  const form = info.geometrie === 'Polygon' ? 'flaeche' : 'linie';
  if (auftrag.form !== undefined && auftrag.form !== form) return null;
  return { typ: info.typ, modus: form === 'flaeche' ? 'polygon' : 'linie' };
}
