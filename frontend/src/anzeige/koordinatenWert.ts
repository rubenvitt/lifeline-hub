/**
 * Wert der `KoordinatenEingabe` (LFH-517): leer (`null`), gültig (`LatLon`) oder ungültig.
 *
 * Ungültig ist kein „leer“: früher meldete die Eingabe beides als `null`, ein Formular speicherte
 * dann still eine gelöschte Koordinate. Der Ungültig-Wert trägt Wortlaut und Format, damit die
 * Eingabe ihn nach dem Fokusverlust wieder zeigt und ein Systemwechsel ihn neu lesen kann.
 *
 * Formulare nehmen `KoordinatenFeld` (Regel `koordinatenRegel` eingebaut); gesendet wird nur über
 * `alsLatLon`.
 */
import type { FormRule } from 'antd';
import type { Koordinatenformat } from '../api/types';
import type { LatLon } from './koordinaten';

export interface UngueltigeKoordinate {
  ungueltig: true;
  /** Der Wortlaut, wie getippt. */
  text: string;
  /** Das Format, in dem der Wortlaut nicht lesbar war. */
  format: Koordinatenformat;
}

export type KoordinatenWert = LatLon | UngueltigeKoordinate | null;

export const FORMAT_LABEL: Record<Koordinatenformat, string> = {
  wgs84: 'WGS84 dezimal',
  dms: 'Grad/Min/Sek',
  utm: 'UTM',
  mgrs: 'MGRS',
  gk: 'Gauß-Krüger',
};

export function istUngueltigeKoordinate(wert: unknown): wert is UngueltigeKoordinate {
  return (
    typeof wert === 'object' &&
    wert !== null &&
    (wert as { ungueltig?: unknown }).ungueltig === true
  );
}

export function istLatLon(wert: KoordinatenWert | undefined): wert is LatLon {
  return wert != null && !istUngueltigeKoordinate(wert);
}

export function ungueltigText(format: Koordinatenformat): string {
  return `Ungültige Koordinate im Format ${FORMAT_LABEL[format]}`;
}

/** Sperrt das Absenden, solange die Koordinate ungültig ist; leer bleibt erlaubt. */
export const koordinatenRegel: FormRule = {
  validator: (_, wert: unknown) =>
    istUngueltigeKoordinate(wert)
      ? Promise.reject(new Error(ungueltigText(wert.format)))
      : Promise.resolve(),
};

/**
 * Für das Senden: gültig → `LatLon`, leer → `null`. Ungültig wirft (fail-closed): fehlt einem
 * Formular die Regel, darf eine Tippstörung die gespeicherte Koordinate nicht löschen.
 */
export function alsLatLon(wert: KoordinatenWert | undefined): LatLon | null {
  if (istUngueltigeKoordinate(wert)) {
    throw new Error(`${ungueltigText(wert.format)}: "${wert.text}" darf nicht gesendet werden`);
  }
  return wert ?? null;
}
