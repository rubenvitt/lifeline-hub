import type { ZeichnenAuftrag } from '../../routing/deeplinks';
import type { ZoneEntwurf } from './useKartenInteraktion';
import { FREIE_SKIZZE_VORGABEFARBE, ZONE_TYPEN } from './zonenStil';

/**
 * Übersetzt einen Zeichnen-Auftrag aus `?zeichnen=` (LFH-825) in den Entwurf, den der Hauptknopf des
 * Typs im Werkzeugmenü startet (`werkzeugZeilen`) — Geometrie aus `ZONE_TYPEN`, eine Wahrheit mit
 * dem Menü. `null` heißt: nicht zeichnen, nur räumen.
 *
 * - Typ mit fester Geometrie: eine passende Form ist erlaubt, eine abweichende macht den Auftrag
 *   ungültig (eine Absperrgrenze als Fläche wird nicht still umgedeutet).
 * - Typ mit `beides`: die Form wählt, ohne Form gilt die Fläche (Hauptknopf im Menü), Farbe
 *   wie im Menü.
 * - Form `kreis` (LLH-1043): jeder Typ mit Fläche; Radius und Mitte des Auftrags belegen den
 *   Kreis vor. Eine Linie wird kein Kreis.
 * - Typ ohne Eintrag in `ZONE_TYPEN`: `null`.
 */
export function zeichenAuftragZuEntwurf(auftrag: ZeichnenAuftrag): ZoneEntwurf | null {
  const info = ZONE_TYPEN.find((t) => t.typ === auftrag.typ);
  if (!info) return null;
  if (auftrag.form === 'kreis') {
    if (info.geometrie === 'LineString') return null;
    return {
      typ: info.typ,
      modus: 'kreis',
      ...(info.geometrie === 'beides' ? { farbe: FREIE_SKIZZE_VORGABEFARBE } : {}),
      kreis: { mitte: auftrag.mitte ?? null, radiusM: auftrag.radius ?? null },
    };
  }
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
