import type { GlobalToken } from 'antd';
import type { Person, Sichtungskategorie } from '../api/types';
import { registrierAnzeige } from '../api/einsatzPerson';
import { rollenFarbe, sichtung } from '../theme/statusFarben';
import { sichtungsfarben } from '../theme/tokens';
import type { KarteMarker } from '../pages/lagekarte/marker';
import { SK_WORT } from './personMeta';
import { istAngetroffen } from './personenBilanz';

/**
 * Marker der Kartenansicht „Betroffene" — rein, damit die Auswahl ohne WebGL prüfbar ist.
 *
 * - Stornierte Personen fallen ganz heraus, auch aus der Zählung „ohne Koordinate".
 * - Nur ANGETROFFENE Personen stehen auf der Karte und in der Zählung: die Koordinate ist ein
 *   FUNDort. Das gilt auch für eine stehengebliebene Koordinate nach einem Wechsel zu
 *   „vermisst" — die Regel hängt an der Anzeige, nicht an den Eingabewegen.
 * - Nur ein VOLLSTÄNDIGES Paar `antreff_lat`/`antreff_lon` ist eine Koordinate.
 * - Farbe aus der Sichtungsachse; ohne Sichtung und „unverletzt" neutral. Zweiter Kanal ist die
 *   Beschriftung `R-042 · SK II` — auch „ohne Sichtung" wird gesagt.
 *
 * Der Token kommt wie bei `baueMarker` von der aufrufenden Ebene (MapLibre-Werte, keine
 * DOM-Styles).
 */
/**
 * Kurzzeichen IM Markerkreis — der zweite Kanal, der auch unterhalb des Plaketten-Zooms stehen
 * bleibt (sonst unterschieden sich SK I und SK III dort nur durch die Farbe). Record über die
 * Union, damit eine neue Kategorie den Typcheck bricht.
 */
export const SK_KURZZEICHEN: Record<Sichtungskategorie | 'ohne', string> = {
  sk1: 'I',
  sk2: 'II',
  sk3: 'III',
  sk4: 'IV',
  tot: 'T',
  unverletzt: 'U',
  ohne: '–',
};

export function personenMarker(
  personen: readonly Person[],
  token: GlobalToken,
): { marker: KarteMarker[]; ohneKoordinate: number } {
  const marker: KarteMarker[] = [];
  let ohneKoordinate = 0;
  const neutral = rollenFarbe('neutral', token);

  for (const p of personen) {
    if (p.storniert_at || !istAngetroffen(p)) continue;
    const lat = p.antreff_lat;
    const lon = p.antreff_lon;
    if (lat == null || lon == null) {
      ohneKoordinate += 1;
      continue;
    }
    const sk = p.aktuelle_sichtung ?? null;
    const darstellung = sk ? sichtung[sk] : null;
    const skText = darstellung ? darstellung.label : SK_WORT.ohne;
    marker.push({
      schluessel: `person-${p.id}`,
      typ: 'person',
      id: p.id,
      lat,
      lon,
      label: `${registrierAnzeige(p.registrier_nr)} · ${skText}`,
      kurzzeichen: SK_KURZZEICHEN[sk ?? 'ohne'],
      sichtung: sk ?? 'ohne',
      // Der gezeichnete Kreis bleibt ~22 px, die unsichtbare Trefferzone misst `controlHeight`.
      trefferDurchmesser: token.controlHeight,
      farbe: darstellung?.farbe ? sichtungsfarben[darstellung.farbe] : neutral,
    });
  }

  return { marker, ohneKoordinate };
}
