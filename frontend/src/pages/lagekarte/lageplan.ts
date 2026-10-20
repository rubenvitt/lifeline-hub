import { fachebeneAlter } from './fachebenen';
import type { AktiveFachebene, ZoneFeature } from './kartenLayer';
import { EBENEN } from './leistenDaten';
import type { KarteMarker } from './marker';
import { zoneTypLabel } from './zonenStil';

/**
 * Reine Ableitungen des Lageplans (LLH-1051, Spec `lagekarte-druck`): Maßstab, Nordpfeil, Fläche
 * auf dem Blatt und Legende. Druck (`LageplanDruck.tsx`) und Bild der Anlage (`lageplanBild.ts`)
 * lesen dieselben Werte, damit Papier und Anlage nicht auseinanderlaufen.
 */

/**
 * Größte Bildfläche auf A4 quer bei 15 mm Rand (267 × 180 mm): der Druckkopf braucht ohne Logo
 * rund 52 mm, Maßstabszeile und eine kurze Legende rund 25 mm (gemessen in Chromium,
 * `e2e/lagekarte-druck.spec.ts`). Ist der Rest höher, wird das Bild kleiner
 * ({@link lageplanBildHoehe}).
 */
export const LAGEPLAN_BILD_MAX_MM = { breite: 267, hoehe: 95 } as const;

/**
 * Höhe, die das Blatt höchstens belegt: 180 mm Nutzhöhe der Seite, 3 mm Luft für Rundung und
 * Unterschiede zwischen Messung und Druck.
 */
export const LAGEPLAN_BLATT_HOEHE_MM = 177;

/** Kleiner wird das Bild nicht; reicht auch das nicht, bricht das Blatt um. */
export const LAGEPLAN_BILD_MIN_HOEHE_MM = 35;

/**
 * Höchste Bildhöhe in mm, wenn alles außer dem Bild (Druckkopf, Abstände, Maßstabszeile, Hinweis,
 * Legende) `restMm` hoch ist: der Rest des Blatts, zwischen {@link LAGEPLAN_BILD_MIN_HOEHE_MM} und
 * der größten Fläche, auf 0,1 mm abgerundet. Ohne Messung (`restMm` ungültig) die größte Fläche.
 */
export function lageplanBildHoehe(restMm: number): number {
  if (!Number.isFinite(restMm) || restMm <= 0) return LAGEPLAN_BILD_MAX_MM.hoehe;
  // Auf 0,1 mm abgerundet (die Messung kommt in Pixeln); das Epsilon fängt Gleitkommareste.
  const frei = Math.floor((LAGEPLAN_BLATT_HOEHE_MM - restMm) * 10 + 1e-6) / 10;
  return Math.max(LAGEPLAN_BILD_MIN_HOEHE_MM, Math.min(LAGEPLAN_BILD_MAX_MM.hoehe, frei));
}

/** Die Maßstabsleiste deckt höchstens ein Viertel der Bildbreite. */
const MASSSTAB_HOECHSTANTEIL = 0.25;

export interface Massstab {
  /** Länge der Leiste in Metern, eine runde Zahl (1, 2, 5 × 10ⁿ). */
  meter: number;
  /** „500 m“, „2 km“. */
  text: string;
  /** Anteil der Leiste an der Bildbreite, 0–1. */
  anteil: number;
}

/** „500 m“ unter einem Kilometer, sonst „2 km“ (deutsches Komma, falls nötig). */
export function massstabText(meter: number): string {
  if (meter < 1000) return `${meter} m`;
  return `${(meter / 1000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} km`;
}

/**
 * Maßstabsleiste für ein Bild von `breitePx` CSS-Pixeln bei `meterJePx` Metern je CSS-Pixel in
 * der Bildmitte: die längste runde Strecke (1, 2, 5 × 10ⁿ m), die in ein Viertel der Breite passt.
 * Ohne brauchbare Angabe `null` — dann steht keine Leiste da statt einer geratenen.
 */
export function massstabLeiste(meterJePx: number | null, breitePx: number): Massstab | null {
  if (meterJePx == null || !(meterJePx > 0) || !(breitePx > 0)) return null;
  const gesamt = meterJePx * breitePx;
  const hoechstens = gesamt * MASSSTAB_HOECHSTANTEIL;
  if (!Number.isFinite(hoechstens) || hoechstens < 1) return null;
  const zehner = 10 ** Math.floor(Math.log10(hoechstens));
  const stufe = [5, 2, 1].find((f) => f * zehner <= hoechstens) ?? 1;
  const meter = stufe * zehner;
  return { meter, text: massstabText(meter), anteil: meter / gesamt };
}

/**
 * Verhältniszahl „1 : N“ auf dem Blatt: wie viele Meter Gelände ein Meter Papier zeigt, auf zwei
 * gültige Stellen gerundet (das Blatt wird nie genauer als der Drucker). `null` ohne Angabe.
 */
export function massstabZahl(
  meterJePx: number | null,
  breitePx: number,
  druckBreiteMm: number,
): number | null {
  if (meterJePx == null || !(meterJePx > 0) || !(breitePx > 0) || !(druckBreiteMm > 0)) {
    return null;
  }
  const n = (meterJePx * breitePx) / (druckBreiteMm / 1000);
  const stellen = 10 ** Math.max(0, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / stellen) * stellen;
}

/** „1 : 12.000“. */
export function massstabZahlText(n: number): string {
  return `1 : ${n.toLocaleString('de-DE')}`;
}

/**
 * Drehung des Nordpfeils in Grad: die Karte ist um `peilung` nach rechts gedreht, Norden zeigt
 * also um denselben Winkel nach links. Auf 0–360 normiert, `-0` als 0.
 */
export function nordpfeilDrehung(peilung: number): number {
  if (!Number.isFinite(peilung)) return 0;
  const w = (((-peilung % 360) + 360) % 360) + 0;
  return w === 360 ? 0 : w;
}

/** Bildfläche auf dem Blatt in mm: Seitenverhältnis des Ausschnitts, so groß wie möglich. */
export function lageplanFlaeche(
  breitePx: number,
  hoehePx: number,
  max: { breite: number; hoehe: number } = LAGEPLAN_BILD_MAX_MM,
): { breiteMm: number; hoeheMm: number } {
  const verhaeltnis = breitePx > 0 && hoehePx > 0 ? breitePx / hoehePx : max.breite / max.hoehe;
  const breiteMm = Math.min(max.breite, max.hoehe * verhaeltnis);
  return { breiteMm, hoeheMm: breiteMm / verhaeltnis };
}

// ── Legende ─────────────────────────────────────────────────────────────────────────────

export interface LegendenZeile {
  schluessel: string;
  text: string;
}

export interface LegendenZone extends LegendenZeile {
  fuellung: string;
  fuellDeckung: number;
  linie: string;
  gestrichelt: boolean;
}

export interface LegendenFachebene extends LegendenZeile {
  veraltet: boolean;
}

export interface LageplanLegende {
  ebenen: LegendenZeile[];
  zonen: LegendenZone[];
  fachebenen: LegendenFachebene[];
  bilder: LegendenZeile[];
  /** Fachebenen jenseits ihrer Schwelle (LFH-591), für den Hinweis über der Legende. */
  veraltet: string[];
}

export interface LegendenQuellen {
  /** Was auf der Karte GEZEICHNET ist — nie die Schalter: eine gesperrte Ebene hat keine Marker. */
  marker: readonly Pick<KarteMarker, 'typ'>[];
  /** Gezeichnete Abschnittsflächen. */
  abschnitte: number;
  zonen: readonly Pick<ZoneFeature, 'id' | 'label' | 'typ' | 'stil' | 'gestrichelt'>[];
  fachebenen: readonly Pick<AktiveFachebene, 'def'>[];
  abgerufen: Readonly<Partial<Record<string, string>>>;
  /** Namen der sichtbaren Bild-Hintergründe. */
  bilder: readonly { id: number; name: string }[];
  jetztMs: number;
  /** Uhrzeit wie im Panel der Fachebenen („1430“, am Vortag „291430“). */
  formatZeitKurz: (iso: string) => string;
}

/**
 * Legende des Lageplans aus dem, was die Karte zeichnet. Eine Ebene ohne gezeichnetes Objekt fehlt;
 * eine Ebene, deren Modul gesperrt ist, hat keine Daten (Sperre an der Datenquelle, LFH-669) und
 * steht deshalb nie in der Legende. Die Warnstufe einer Gefahrenzone steht als Text in ihrer
 * Beschriftung (LFH-357), die Farbe ist nur der zweite Kanal.
 */
export function lageplanLegende(q: LegendenQuellen): LageplanLegende {
  const anzahl = new Map<string, number>();
  for (const m of q.marker) anzahl.set(m.typ, (anzahl.get(m.typ) ?? 0) + 1);
  const ebenen: LegendenZeile[] = [];
  for (const { key, name } of EBENEN) {
    if (key === 'zone') continue; // jede Zone steht einzeln
    const n = (anzahl.get(key) ?? 0) + (key === 'abschnitt' ? q.abschnitte : 0);
    if (n > 0) ebenen.push({ schluessel: key, text: `${name} (${n})` });
  }
  const zonen: LegendenZone[] = q.zonen.map((z) => ({
    schluessel: `zone-${z.id}`,
    text: z.label?.trim() || (z.typ ? zoneTypLabel(z.typ) : 'Zone'),
    fuellung: z.stil.fillColor,
    fuellDeckung: z.stil.fillOpacity,
    linie: z.stil.lineColor,
    gestrichelt: !!z.gestrichelt,
  }));
  const veraltet: string[] = [];
  const fachebenen: LegendenFachebene[] = q.fachebenen.map(({ def }) => {
    const alter = fachebeneAlter(def.key, q.abgerufen[def.key], q.jetztMs);
    const stand = alter ? `Stand ${q.formatZeitKurz(alter.abgerufen)}` : null;
    if (alter?.veraltet) veraltet.push(`${def.label} (${stand})`);
    return {
      schluessel: `fachebene-${def.key}`,
      text: [def.label, alter?.veraltet ? 'veraltet' : null, stand].filter(Boolean).join(' · '),
      veraltet: !!alter?.veraltet,
    };
  });
  const bilder = q.bilder.map((b) => ({ schluessel: `bild-${b.id}`, text: b.name }));
  return { ebenen, zonen, fachebenen, bilder, veraltet };
}

/** Hinweis über der Legende, wenn eine Fachebene veraltet ist; sonst `null`. */
export function veraltetHinweis(legende: Pick<LageplanLegende, 'veraltet'>): string | null {
  if (legende.veraltet.length === 0) return null;
  return `${legende.veraltet.length === 1 ? 'Veraltete Fachebene' : 'Veraltete Fachebenen'}: ${legende.veraltet.join(', ')}`;
}

/** Alle Legendenzeilen als Text, in der Folge des Blatts (für das Bild der Anlage). */
export function legendenTexte(legende: LageplanLegende): string[] {
  return [
    ...legende.ebenen.map((z) => z.text),
    ...legende.zonen.map((z) => z.text),
    ...legende.fachebenen.map((z) => z.text),
    ...legende.bilder.map((z) => `Bild: ${z.text}`),
  ];
}
