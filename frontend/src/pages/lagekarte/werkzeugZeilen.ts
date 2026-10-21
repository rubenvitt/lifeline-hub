import type { ZoneTyp } from '../../api/types';
import type { ZonenForm } from './useKartenInteraktion';
import { FREIE_SKIZZE_VORGABEFARBE, type ZoneTypInfo } from './zonenStil';

/**
 * Einträge des Werkzeugmenüs an der Karte (LLH-1038, Spec `lagekarte-zeichnen`, „Flächen und
 * Linien im Werkzeugmenü“) — rein, aus `ZONE_TYPEN` abgeleitet: ein neuer Zonentyp und jede neue
 * Form (Kreis, LLH-1043) erscheinen ohne Änderung am Menü.
 */

/** Was ein Eintrag startet — derselbe Entwurf, den `onZoneZeichnenStart` nimmt. */
export interface WerkzeugEntwurf {
  typ: ZoneTyp;
  modus: ZonenForm;
  /** Nur die freie Skizze: ein gespeicherter Datenwert (`FREIE_SKIZZE_VORGABEFARBE`). */
  farbe?: string;
}

export interface WerkzeugForm {
  /** Zugänglicher Name, eindeutig im Menü („Absperrbereich als Kreis“). */
  name: string;
  /** Sichtbare Beschriftung: der Typname am Hauptknopf, sonst nur die Form. */
  text: string;
  entwurf: WerkzeugEntwurf;
}

/** Eine Zeile: Hauptknopf mit der Vorgabeform des Typs, daneben die übrigen Formen. */
export interface WerkzeugZeile {
  typ: ZoneTyp;
  haupt: WerkzeugForm;
  weitere: WerkzeugForm[];
}

/** `data-lfh` der Menüfläche — `escGehoertOverlay` und die e2e-Proben fragen danach. */
export const WERKZEUGMENUE_KENNUNG = 'werkzeugmenue';

/**
 * Je Zonentyp eine Zeile. Die Vorgabeform ist die des Links ohne Form (`zeichenAuftragZuEntwurf`):
 * Fläche, bei einer Linienart die Linie. Daneben „Linie“ für einen Typ mit Fläche und Linie und
 * „Kreis“ für jede Flächenart; eine Linie wird nie ein Kreis (Spec „Kreis um einen Punkt“).
 */
export function werkzeugZeilen(typen: readonly ZoneTypInfo[]): WerkzeugZeile[] {
  return typen.map((t) => {
    const farbe = t.geometrie === 'beides' ? { farbe: FREIE_SKIZZE_VORGABEFARBE } : {};
    const form = (modus: ZonenForm, text: string): WerkzeugForm => ({
      name: `${t.label} als ${text}`,
      text,
      entwurf: { typ: t.typ, modus, ...farbe },
    });
    const vorgabe: ZonenForm = t.geometrie === 'LineString' ? 'linie' : 'polygon';
    const weitere: WerkzeugForm[] = [];
    if (t.geometrie === 'beides') weitere.push(form('linie', 'Linie'));
    if (t.geometrie !== 'LineString') weitere.push(form('kreis', 'Kreis'));
    return {
      typ: t.typ,
      haupt: { name: t.label, text: t.label, entwurf: { typ: t.typ, modus: vorgabe, ...farbe } },
      weitere,
    };
  });
}
