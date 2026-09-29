/**
 * Die EINE Schreibweise der Fundort-Koordinate: `52.2691/9.1342` — Schnellerfassung, Maske und
 * Detailseite lesen über dieselbe Funktion. Rein.
 *
 *  · Das `/` trennt Breite und Länge. Ein Komma ist DEUTSCHES Dezimalzeichen
 *    (`52,2691/9,1342`), nie Trenner.
 *  · Ein führendes `#` (Kürzel der Schnellerfassung) wird übergangen.
 *  · Minus ist erlaubt, Bereich WGS84 (±90/±180) wie im Backend (422) — hier vorher gemeldet.
 */

type KoordinatenErgebnis = { ok: true; lat: number; lon: number } | { ok: false; grund: string };

const ZAHL = /^-?\d{1,3}(?:[.,]\d+)?$/;

function zahlAus(teil: string): number | null {
  const t = teil.trim();
  if (!ZAHL.test(t)) return null;
  return Number(t.replace(',', '.'));
}

export function parseKoordinate(text: string): KoordinatenErgebnis {
  const roh = text.trim().replace(/^#/, '').trim();
  if (roh === '') return { ok: false, grund: 'Koordinate fehlt' };
  const teile = roh.split('/');
  if (teile.length !== 2) {
    return { ok: false, grund: 'Breite und Länge mit „/“ trennen (52.2691/9.1342)' };
  }
  const lat = zahlAus(teile[0]);
  const lon = zahlAus(teile[1]);
  if (lat == null || lon == null) {
    return { ok: false, grund: 'keine Zahl als Breite oder Länge (52.2691/9.1342)' };
  }
  if (lat < -90 || lat > 90) return { ok: false, grund: 'Breite außerhalb ±90' };
  if (lon < -180 || lon > 180) return { ok: false, grund: 'Länge außerhalb ±180' };
  return { ok: true, lat, lon };
}

/** `52.2691/9.1342` — vier Nachkommastellen (≈ 11 m), Punkt als Dezimalzeichen. */
export function formatKoordinate(lat: number, lon: number): string {
  return `${lat.toFixed(4)}/${lon.toFixed(4)}`;
}

/**
 * Trägt die Person eine VOLLSTÄNDIGE Koordinate? Die eine Regel für Lücke, Anzeige und
 * Bearbeiten — ein halbes Paar zählt nirgends als Fundort.
 */
export function hatKoordinate(p: {
  antreff_lat?: number | null;
  antreff_lon?: number | null;
}): p is { antreff_lat: number; antreff_lon: number } {
  return p.antreff_lat != null && p.antreff_lon != null;
}

/** `52.2691/9.1342` oder `null` ohne vollständiges Paar. */
export function koordinatenText(p: {
  antreff_lat?: number | null;
  antreff_lon?: number | null;
}): string | null {
  return hatKoordinate(p) ? formatKoordinate(p.antreff_lat, p.antreff_lon) : null;
}
