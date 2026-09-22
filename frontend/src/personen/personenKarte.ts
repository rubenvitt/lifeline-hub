import type { GlobalToken } from 'antd';
import type { Person, Sichtungskategorie } from '../api/types';
import { registrierAnzeige } from '../api/einsatzPerson';
import { rollenFarbe, sichtung } from '../theme/statusFarben';
import { sichtungsfarben } from '../theme/tokens';
import type { KarteMarker } from '../pages/lagekarte/marker';
import { SK_WORT } from './personMeta';
import { istAngetroffen } from './personenBilanz';

/**
 * Marker der Kartenansicht „Betroffene" (LFH-613, design D7) — rein, damit die Auswahl ohne
 * WebGL prüfbar ist.
 *
 * - Stornierte Personen fallen ganz heraus, auch aus der Zählung „ohne Koordinate": sie
 *   stehen in keiner Sicht der Seite, eine Lücke an ihnen wäre keine.
 * - Nur ANGETROFFENE Personen (`istAngetroffen`) stehen auf der Karte und in der Zählung: die
 *   Koordinate ist ein FUNDort, und eine vermisste Person hat keinen. Das gilt auch für eine
 *   stehengebliebene Koordinate nach einem Wechsel zu „vermisst" — die Regel hängt an der
 *   Anzeige, nicht an den Eingabewegen (Review LFH-613).
 * - Nur ein VOLLSTÄNDIGES Paar `antreff_lat`/`antreff_lon` ist eine Koordinate.
 * - Farbe aus der Sichtungsachse (`tokens.ts`, `sichtungsfarben`); ohne Sichtung und
 *   „unverletzt" (ohne Fachfarbe) neutral. Der zweite Kanal (WCAG 1.4.1) ist die
 *   Beschriftung `R-042 · SK II` — auch die Abwesenheit einer Sichtung wird GESAGT
 *   („ohne Sichtung"), nicht bloß durch eine fehlende Farbe angedeutet.
 *
 * Der Token kommt wie bei `baueMarker` von der aufrufenden Ebene: die neutrale Rolle
 * hängt am Modus, und das Modul erzeugt MapLibre-Werte, keine DOM-Styles.
 */
/**
 * Kurzzeichen IM Markerkreis — der zweite Kanal, der auch unterhalb des Plaketten-Zooms
 * (`BESCHRIFTUNG_AB_ZOOM`) und bei weichenden Plaketten stehen bleibt (Review LFH-613: sonst
 * unterschieden sich SK I und SK III auf der Übersicht nur durch die Farbe). Record über die
 * Union, damit eine neue Kategorie den Typcheck bricht statt still ohne Kürzel zu erscheinen.
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
      farbe: darstellung?.farbe ? sichtungsfarben[darstellung.farbe] : neutral,
    });
  }

  return { marker, ohneKoordinate };
}
