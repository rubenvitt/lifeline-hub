/**
 * Punktweise Bearbeitung einer bestehenden Zone (LLH-1344, design.md D2): Eckpunkte verschieben,
 * zwischen zwei Ecken einfügen, entfernen, die letzte Änderung zurücknehmen. Rein und ohne Karte;
 * die Griffe an der Karte (`zonenBearbeitungKarte.ts`) melden nur Aktionen, die Seite hält den
 * Stand im Modus-Reducer (`useKartenInteraktion`).
 *
 * Ein Punkt heißt über Ring und Index: bei einer Linie gibt es genau einen Ring (die Linie selbst),
 * bei einer Fläche ist Ring 0 der Außenring, weitere Ringe sind Löcher. Der Schlusspunkt eines
 * Flächenrings ist kein eigener Punkt: er folgt immer dem ersten.
 */
import type { GeoJsonGeometry } from './geo';

/** Ein Eckpunkt der bearbeiteten Figur. */
export interface PunktRef {
  ring: number;
  index: number;
}

/** Eine Lage in GeoJSON-Reihenfolge `[lon, lat]`. */
export type Lage = [number, number];

export interface BearbeitungsStand {
  /** Die gespeicherte Geometrie — Ziel von „verwerfen“ und Maß für „geändert“. */
  original: GeoJsonGeometry;
  geometrie: GeoJsonGeometry;
  /** Gewählter Eckpunkt („Punkt entfernen“); `null` ohne Wahl. */
  gewaehlt: PunktRef | null;
  /** Frühere Stände für „Letzte Änderung zurück“, der jüngste zuletzt. */
  verlauf: GeoJsonGeometry[];
}

export type BearbeitungsAktion =
  | { art: 'verschieben'; punkt: PunktRef; lage: Lage }
  /** Neuer Punkt zwischen `nach` und seinem Nachfolger im Ring. */
  | { art: 'einfuegen'; ring: number; nach: number; lage: Lage }
  | { art: 'waehlen'; punkt: PunktRef | null }
  | { art: 'entfernen' }
  | { art: 'zurueck' }
  /** Alle Änderungen verwerfen (erste Esc-Stufe): zurück auf den gespeicherten Stand. */
  | { art: 'verwerfen' };

/** Die Eckpunkte je Ring, ohne den Schlusspunkt einer Fläche. Rein. */
export function eckenJeRing(g: GeoJsonGeometry): Lage[][] {
  if (g.type === 'LineString') return [g.coordinates.map((p) => [p[0], p[1]] as Lage)];
  return g.coordinates.map((ring) => {
    const offen = ring.map((p) => [p[0], p[1]] as Lage);
    const erster = offen[0];
    const letzter = offen[offen.length - 1];
    if (offen.length > 1 && erster[0] === letzter[0] && erster[1] === letzter[1]) offen.pop();
    return offen;
  });
}

/** Geometrie gleicher Art aus Ecken je Ring; Flächenringe werden geschlossen. Rein. */
function ausEcken(art: GeoJsonGeometry['type'], ringe: Lage[][]): GeoJsonGeometry {
  if (art === 'LineString') return { type: 'LineString', coordinates: ringe[0].map((p) => [...p]) };
  return {
    type: 'Polygon',
    coordinates: ringe.map((r) => [...r.map((p) => [...p]), [...r[0]]]),
  };
}

/** Kleinste Punktzahl je Ring: Linie 2, Fläche 3 (wie beim Zeichnen). */
export function mindestPunkte(g: GeoJsonGeometry): number {
  return g.type === 'LineString' ? 2 : 3;
}

export function starteBearbeitung(g: GeoJsonGeometry): BearbeitungsStand {
  return { original: g, geometrie: g, gewaehlt: null, verlauf: [] };
}

/** Punkte der Figur über alle Ringe. */
export function punktZahl(s: BearbeitungsStand): number {
  return eckenJeRing(s.geometrie).reduce((n, r) => n + r.length, 0);
}

/** Weicht die Figur vom gespeicherten Stand ab? */
export function istGeaendert(s: BearbeitungsStand): boolean {
  return JSON.stringify(s.geometrie) !== JSON.stringify(s.original);
}

/** Lässt sich der gewählte Punkt entfernen, ohne den Ring unter das Minimum zu bringen? */
export function kannEntfernen(s: BearbeitungsStand): boolean {
  if (!s.gewaehlt) return false;
  const ring = eckenJeRing(s.geometrie)[s.gewaehlt.ring];
  return ring != null && ring.length > mindestPunkte(s.geometrie);
}

function gueltig(ringe: Lage[][], p: PunktRef): boolean {
  return p.ring >= 0 && p.ring < ringe.length && p.index >= 0 && p.index < ringe[p.ring].length;
}

/** Neuer Stand mit neuer Geometrie; der alte geht in den Verlauf. */
function mitGeometrie(
  s: BearbeitungsStand,
  ringe: Lage[][],
  gewaehlt: PunktRef | null,
): BearbeitungsStand {
  return {
    ...s,
    geometrie: ausEcken(s.geometrie.type, ringe),
    gewaehlt,
    verlauf: [...s.verlauf, s.geometrie],
  };
}

/** Wendet eine Aktion an; eine unpassende Aktion lässt den Stand unverändert (Identität). Rein. */
export function wendeAn(s: BearbeitungsStand, a: BearbeitungsAktion): BearbeitungsStand {
  const ringe = eckenJeRing(s.geometrie);
  switch (a.art) {
    case 'waehlen':
      if (a.punkt && !gueltig(ringe, a.punkt)) return s;
      return { ...s, gewaehlt: a.punkt };
    case 'verschieben': {
      if (!gueltig(ringe, a.punkt)) return s;
      const alt = ringe[a.punkt.ring][a.punkt.index];
      if (alt[0] === a.lage[0] && alt[1] === a.lage[1]) return { ...s, gewaehlt: a.punkt };
      const neu = ringe.map((r) => r.slice());
      neu[a.punkt.ring][a.punkt.index] = [a.lage[0], a.lage[1]];
      return mitGeometrie(s, neu, a.punkt);
    }
    case 'einfuegen': {
      const ring = ringe[a.ring];
      if (!ring || a.nach < 0 || a.nach >= ring.length) return s;
      // Eine Linie hat hinter dem letzten Punkt keine Kante.
      if (s.geometrie.type === 'LineString' && a.nach >= ring.length - 1) return s;
      const neu = ringe.map((r) => r.slice());
      neu[a.ring].splice(a.nach + 1, 0, [a.lage[0], a.lage[1]]);
      return mitGeometrie(s, neu, { ring: a.ring, index: a.nach + 1 });
    }
    case 'entfernen': {
      if (!kannEntfernen(s) || !s.gewaehlt) return s;
      const neu = ringe.map((r) => r.slice());
      neu[s.gewaehlt.ring].splice(s.gewaehlt.index, 1);
      return mitGeometrie(s, neu, null);
    }
    case 'zurueck': {
      if (s.verlauf.length === 0) return s;
      return {
        ...s,
        geometrie: s.verlauf[s.verlauf.length - 1],
        gewaehlt: null,
        verlauf: s.verlauf.slice(0, -1),
      };
    }
    case 'verwerfen':
      return istGeaendert(s) || s.gewaehlt ? starteBearbeitung(s.original) : s;
  }
}

/** Ein Zwischenpunkt: Mitte der Kante von Ecke `nach` zu ihrem Nachfolger. */
export interface Zwischenpunkt {
  ring: number;
  nach: number;
  lage: Lage;
}

/**
 * Die Mitten aller Kanten — bei einer Fläche auch die Schlusskante vom letzten zum ersten Punkt.
 * Arithmetisches Mittel in Grad: für Kanten einer Einsatzzone (Meter bis wenige Kilometer) liegt
 * es sichtbar auf der Kante. Rein.
 */
export function zwischenpunkte(g: GeoJsonGeometry): Zwischenpunkt[] {
  const aus: Zwischenpunkt[] = [];
  eckenJeRing(g).forEach((ring, r) => {
    const kanten = g.type === 'LineString' ? ring.length - 1 : ring.length;
    for (let i = 0; i < kanten; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      aus.push({ ring: r, nach: i, lage: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] });
    }
  });
  return aus;
}

/** Bildschirmlage eines Punktes in Pixeln. */
export interface Px {
  x: number;
  y: number;
}

/**
 * Welche Griffe stehen (design.md D2, „gedrängte Griffe“): ein Eckgriff, der näher als eine halbe
 * Griffkante an einem schon stehenden liegt, fällt weg — außer er ist gewählt; ein Zwischengriff
 * nur an einer Kante von mindestens zwei Griffkanten Länge. Eingabe sind die Bildschirmlagen der
 * Ecken je Ring (wie `eckenJeRing`) und die Art der Figur; Ausgabe je Ring die stehenden Ecken und
 * die stehenden Kanten (Index = `nach`). Rein.
 */
export function sichtbareGriffe(
  eckenPx: Px[][],
  art: GeoJsonGeometry['type'],
  kante: number,
  gewaehlt: PunktRef | null = null,
): { ecken: boolean[][]; kanten: boolean[][] } {
  const stehend: Px[] = [];
  const abstand = (a: Px, b: Px) => Math.hypot(a.x - b.x, a.y - b.y);
  // Der gewählte Punkt steht immer und zuerst: sonst verschwände der Griff, den „Punkt entfernen“
  // meint.
  if (gewaehlt && eckenPx[gewaehlt.ring]?.[gewaehlt.index])
    stehend.push(eckenPx[gewaehlt.ring][gewaehlt.index]);
  const ecken = eckenPx.map((ring, r) =>
    ring.map((p, i) => {
      if (gewaehlt && gewaehlt.ring === r && gewaehlt.index === i) return true;
      if (stehend.some((q) => abstand(p, q) < kante / 2)) return false;
      stehend.push(p);
      return true;
    }),
  );
  const kanten = eckenPx.map((ring) => {
    const n = art === 'LineString' ? ring.length - 1 : ring.length;
    return Array.from({ length: Math.max(n, 0) }, (_, i) => {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      return abstand(a, b) >= 2 * kante;
    });
  });
  return { ecken, kanten };
}
