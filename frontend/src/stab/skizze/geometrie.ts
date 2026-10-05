import type { NetzStelle } from '../fernmeldeskizze';
import {
  KASTEN_POLSTER,
  RAND,
  RASTER,
  SCHIENE_LINIE_VERSATZ,
  TZ_HOEHE,
  schienenLinieY,
  type Platz,
} from '../fernmeldeskizzeLayout';
import { BEDINGUNGSZEICHEN_HOEHE, ZEICHEN_GROESSE } from '../skizzenZeichen';
import type { Groesse, Punkt } from './ansicht';
import { SCHRIFTFELD, teileStichSchluessel } from './ebenen';

/**
 * Geometrie der Fläche (LFH-893 D4, D6): wo Linien ansetzen und was unter einem Punkt liegt.
 * Rein, in Skizzeneinheiten; das Layout liefert die Plätze (`fernmeldeskizzeLayout.ts`).
 *
 * - **Stichleitung** rechtwinklig: aus der eigenen Steigleitung (Auto-Layout) bzw. senkrecht aus
 *   dem Platz; liegt die Stelle neben der Schiene, erst waagerecht bis zu ihrem Ende. Der letzte
 *   Punkt liegt immer auf der Linie der Schiene, innerhalb ihrer Länge.
 * - **Treffer beim Ablegen:** eine Schiene trifft, wer höchstens {@link SCHIENEN_TOLERANZ} über
 *   oder unter ihrer Linie und innerhalb ihrer Länge loslässt; eine Stelle, wer in ihrem Platz
 *   loslässt. Getestet in `geometrie.test.ts`, damit Ziehen und Tastatur dieselbe Antwort geben.
 */

/** Halbe Höhe des Bedingungszeichens plus ein Rasterfeld: so weit trifft das Ablegen eine Schiene. */
export const SCHIENEN_TOLERANZ = BEDINGUNGSZEICHEN_HOEHE / 2 + RASTER;
/** Wie weit eine Stichleitung von ihrer Schiene weggezogen werden muss, um sie zu lösen. */
export const LOESE_ABSTAND = 4 * RASTER;

export interface Rechteck {
  x: number;
  y: number;
  breite: number;
  hoehe: number;
}

/** Mitte des Zeichens einer Stelle: dort setzen Verbindungen an. */
export function zeichenMitte(s: Pick<NetzStelle, 'art'>, p: Platz): Punkt {
  const cx = p.x + p.breite / 2;
  switch (s.art) {
    case 'fuehrungsstelle':
    case 'abschnitt':
      return { x: cx, y: p.y + KASTEN_POLSTER + TZ_HOEHE / 2 };
    case 'einheit':
    case 'extern':
      return { x: cx, y: p.y + TZ_HOEHE / 2 };
    case 'komponente':
      return { x: cx, y: p.y + ZEICHEN_GROESSE / 2 };
  }
}

function ohneDoppel(punkte: Punkt[]): Punkt[] {
  return punkte.filter((p, i) => i === 0 || p.x !== punkte[i - 1].x || p.y !== punkte[i - 1].y);
}

/** Die Punkte der Stichleitung einer Stelle an einer Schiene, von der Stelle zur Linie. */
export function stichleitungsPunkte(
  s: Pick<NetzStelle, 'art'>,
  stelle: Platz,
  schiene: Platz,
): Punkt[] {
  const linieY = schienenLinieY(schiene);
  const von = schiene.x;
  const bis = schiene.x + schiene.breite;
  const klemme = (x: number) => Math.min(bis, Math.max(von, x));
  const mitte = zeichenMitte(s, stelle);
  const cx = stelle.x + stelle.breite / 2;
  const unten = stelle.y + stelle.hoehe;
  /** Senkrecht aus dem Platz: unten heraus, oben heraus, oder aus der Zeichenmitte. */
  const ausgang = (x: number): Punkt => ({
    x,
    y: linieY >= unten ? unten : linieY <= stelle.y ? stelle.y : mitte.y,
  });

  // Eigene Steigleitung links neben der Spalte (Auto-Layout): waagerecht hinein, dann senkrecht.
  if (stelle.steigX != null && stelle.steigX !== cx) {
    const a = { x: stelle.x, y: mitte.y };
    return ohneDoppel([
      a,
      { x: stelle.steigX, y: a.y },
      { x: stelle.steigX, y: linieY },
      { x: klemme(stelle.steigX), y: linieY },
    ]);
  }
  const x = stelle.steigX ?? cx;
  if (x >= von && x <= bis) return ohneDoppel([ausgang(x), { x, y: linieY }]);
  // Neben der Schiene: waagerecht bis an ihr Ende, dann senkrecht auf die Linie.
  const ende = x < von ? von : bis;
  const a = { x: x < von ? stelle.x + stelle.breite : stelle.x, y: mitte.y };
  return ohneDoppel([a, { x: ende, y: a.y }, { x: ende, y: linieY }]);
}

/** Abstand eines Punktes zu einer Strecke. */
function streckenAbstand(p: Punkt, a: Punkt, b: Punkt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Abstand eines Punktes zur Linie einer Schiene (über ihre ganze Länge). */
export function abstandZurSchiene(p: Punkt, schiene: Platz): number {
  const y = schienenLinieY(schiene);
  return streckenAbstand(p, { x: schiene.x, y }, { x: schiene.x + schiene.breite, y });
}

/** Die Schiene unter einem Punkt, die nächste zuerst; `null`, wenn keine nah genug ist. */
export function schieneAn(
  schienen: readonly string[],
  plaetze: ReadonlyMap<string, Platz>,
  p: Punkt,
  toleranz = SCHIENEN_TOLERANZ,
): string | null {
  let beste: { key: string; abstand: number } | null = null;
  for (const key of schienen) {
    const platz = plaetze.get(key);
    if (!platz) continue;
    const abstand = abstandZurSchiene(p, platz);
    if (abstand <= toleranz && (!beste || abstand < beste.abstand)) beste = { key, abstand };
  }
  return beste?.key ?? null;
}

/** Die Stelle, in deren Platz der Punkt liegt; bei Überlappung die zuletzt gezeichnete. */
export function stelleAn(
  stellen: readonly string[],
  plaetze: ReadonlyMap<string, Platz>,
  p: Punkt,
  ausser?: string,
): string | null {
  for (let i = stellen.length - 1; i >= 0; i -= 1) {
    const key = stellen[i];
    if (key === ausser) continue;
    const r = plaetze.get(key);
    if (r && p.x >= r.x && p.x <= r.x + r.breite && p.y >= r.y && p.y <= r.y + r.hoehe) {
      return key;
    }
  }
  return null;
}

/** Auf das Raster (D4). */
export function aufRaster(v: number): number {
  return Math.round(v / RASTER) * RASTER;
}

/** Die Lage einer Schiene, deren Linie bei `p` beginnen soll (Palette auf die Fläche). */
export function schienenLageAb(p: Punkt): Punkt {
  return { x: aufRaster(p.x), y: aufRaster(p.y - SCHIENE_LINIE_VERSATZ) };
}

/** Umfassendes Rechteck mehrerer Rechtecke; `null` ohne Eingabe. */
export function umfassend(rechtecke: readonly Rechteck[]): Rechteck | null {
  if (rechtecke.length === 0) return null;
  const x = Math.min(...rechtecke.map((r) => r.x));
  const y = Math.min(...rechtecke.map((r) => r.y));
  const r = Math.max(...rechtecke.map((q) => q.x + q.breite));
  const u = Math.max(...rechtecke.map((q) => q.y + q.hoehe));
  return { x, y, breite: r - x, hoehe: u - y };
}

/**
 * Ausdehnung der Fläche samt Schriftfeld (D13): das Schriftfeld steht unten rechts unter allem
 * (Layout und Bereiche), die Ausdehnung umfasst es mit Rand. So passt die `viewBox` die ganze
 * Skizze samt Schriftfeld ein, am Schirm wie auf Papier.
 */
export function flaechenAusdehnung(
  layout: Groesse,
  bereiche: readonly Rechteck[],
  schriftfeld: Groesse,
): { inhalt: Groesse; schriftfeld: Punkt } {
  const rechts = Math.max(
    layout.breite,
    schriftfeld.breite + 2 * RAND,
    ...bereiche.map((b) => b.x + b.breite + RAND),
  );
  const unten = Math.max(layout.hoehe, ...bereiche.map((b) => b.y + b.hoehe + RAND));
  return {
    inhalt: { breite: rechts, hoehe: unten + schriftfeld.hoehe + RAND },
    schriftfeld: { x: rechts - RAND - schriftfeld.breite, y: unten },
  };
}

/**
 * Das Rechteck eines Elements, um es in den sichtbaren Ausschnitt zu holen (Spec „Klick im
 * Paneel“): Stichleitungen über ihre Stelle, Verbindungen über beide Enden.
 */
export function elementRechteck(
  netz: {
    verbindungen: readonly { key: string; von: string; nach: string }[];
    bereiche: readonly (Rechteck & { key: string })[];
  },
  plaetze: ReadonlyMap<string, Rechteck>,
  schriftfeld: Rechteck,
  key: string,
): Rechteck | null {
  if (key === SCHRIFTFELD) return schriftfeld;
  const stich = teileStichSchluessel(key);
  const p = plaetze.get(stich ? stich.stelle : key);
  if (p) return { x: p.x, y: p.y, breite: p.breite, hoehe: p.hoehe };
  const b = netz.bereiche.find((x) => x.key === key);
  if (b) return { x: b.x, y: b.y, breite: b.breite, hoehe: b.hoehe };
  const v = netz.verbindungen.find((x) => x.key === key);
  if (v) {
    const enden = [plaetze.get(v.von), plaetze.get(v.nach)].filter((r): r is Rechteck => r != null);
    return umfassend(enden);
  }
  return null;
}
