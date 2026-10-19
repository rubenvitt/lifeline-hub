import type { KoerperRegion, VerletzungAnsicht } from '../../api/types';

/**
 * Geometrie des Körperschemas (LLH-1120, Spec `koerperschema`, design.md D13). EINE Quelle für
 * Figur, Trefferzonen, Tastaturfolge und Druck, Vorbild `marke/bildmarkeGeometrie.ts` mit seinem
 * Guard (`geometrie.test.ts`).
 *
 * ── RAHMEN ───────────────────────────────────────────────────────────────────────────────
 *
 * Gezeichnet wird in einem Entwurfsraster von {@link RAHMEN} (300 × 440 Einheiten, Hochformat 15 :
 * 22). Gespeichert wird die Lage normiert auf 0..1 je Ansicht (`x` = Einheit / 300, `y` = Einheit
 * / 440): dieselbe Zahl steht an jeder Figur an derselben Stelle. Die Seiten zählen aus Sicht des
 * Patienten — vorn liegt seine linke Seite rechts im Bild, hinten links.
 *
 * ── DREI UMRISSE, EINE REGIONSKARTE ──────────────────────────────────────────────────────
 *
 * Männlich, weiblich und neutral (divers, unbekannt, ohne Angabe) unterscheiden sich nur in
 * Schultern, Taille und Hüfte. Die Trefferzonen und Mittelpunkte sind für alle gleich; der Guard
 * prüft, dass jeder Mittelpunkt in jedem Umriss liegt. Ein nachgetragenes Geschlecht verschiebt
 * so keine Markierung. Die Figur ist ein Polygon mit harten Ecken (Radius 0 der
 * Gestaltungssprache), eine Zeichnung und kein Icon (Spec `iconsatz`).
 *
 * ── TREFFERZONEN ─────────────────────────────────────────────────────────────────────────
 *
 * Jede Zone ist eine Vereinigung achsparalleler Rechtecke, lückenlos nebeneinander, ohne
 * Überlappung. Jede enthält ein Quadrat von {@link ZONE_MIN} Einheiten Kante; mit
 * {@link figurMassstab} sind das in jeder Dichte mehr als die Steuerhöhe, in der Handschuh-Stufe
 * mehr als 72 px. Hand, Fuß und Hals sind an der Figur klein: ihre Zonen reichen über die
 * Silhouette hinaus, Hand nach außen, Fuß nach unten, der Hals als Band unter dem Kopf mit zwei
 * Flügeln neben Kinn und Hals (über den Schultern ist Platz). Vorn teilen sich Kopf und Gesicht
 * den Kopf: das Gesicht ist das Feld in der Mitte, der Kopf liegt als Bügel darüber und daneben.
 * Hinten trägt der Rücken ein Band über der Wirbelsäule.
 */

/** Das Entwurfsraster in Einheiten. */
export const RAHMEN = { breite: 300, hoehe: 440 } as const;

/** Kante des Quadrats, das jede Trefferzone enthält, in Einheiten (Guard). */
export const ZONE_MIN = 46;

/** Der Maßstab rechnet mit diesem Nenner, eine Einheit unter {@link ZONE_MIN}: Reserve fürs Runden. */
const ZONE_MIN_NENNER = 45;

/** Untergrenze des Maßstabs: die Figur bleibt auch in `kompakt` lesbar groß (330 × 484 px). */
export const MASSSTAB_BODEN = 1.1;

/**
 * Pixel je Einheit für das volle Schema, aus der Steuerhöhe der Stufe: die kleinste Zone misst
 * dann mehr als `controlHeight` (Handschuh: 72 / 45 = 1,6 → 480 × 704 px, Zone ≥ 73,6 px). Rein
 * und exportiert (Muster „Handgebautes Bedienziel“), Böden als Literale im Test.
 */
export function figurMassstab(token: { controlHeight: number }): number {
  return Math.max(MASSSTAB_BODEN, token.controlHeight / ZONE_MIN_NENNER);
}

export type Punkt = readonly [number, number];

/** Ein Rechteck der Zone: links oben, Breite, Höhe (Einheiten). */
export interface Rechteck {
  x: number;
  y: number;
  b: number;
  h: number;
}

export interface Zone {
  region: KoerperRegion;
  /** Die Rechtecke der Zone, ohne Überlappung untereinander und mit anderen Zonen. */
  flaechen: readonly Rechteck[];
  /** Mittelpunkt: Lage des Sternchens ohne Tippstelle (Tastatur) und Prüfpunkt des Guards. */
  mitte: Punkt;
}

export type Figur = 'maennlich' | 'weiblich' | 'neutral';

const MITTE_X = RAHMEN.breite / 2;

/** Spiegelt ein Rechteck an der senkrechten Mitte. */
function spiegleRechteck(r: Rechteck): Rechteck {
  return { ...r, x: RAHMEN.breite - r.x - r.b };
}

/**
 * Der Umriss aus seiner rechten Hälfte (von der Scheitelmitte im Uhrzeigersinn bis zum Schritt):
 * die linke Hälfte ist das Spiegelbild in umgekehrter Folge. Beide Ansichten tragen denselben
 * Umriss; was vorn und hinten unterscheidet, sind die Regionen.
 */
function umrissAusHaelfte(rechts: readonly Punkt[]): readonly Punkt[] {
  const links = rechts
    .filter(([x]) => x !== MITTE_X)
    .map(([x, y]) => [RAHMEN.breite - x, y] as const)
    .reverse();
  return [...rechts, ...links];
}

const HAELFTE_NEUTRAL: readonly Punkt[] = [
  [150, 6],
  [162, 6],
  [174, 18],
  [176, 46],
  [168, 66],
  [160, 76],
  [161, 90],
  [192, 96],
  [210, 104],
  [216, 170],
  [220, 234],
  [226, 244],
  [224, 280],
  [212, 286],
  [204, 278],
  [200, 244],
  [198, 236],
  [196, 172],
  [194, 120],
  [188, 124],
  [182, 190],
  [190, 240],
  [192, 262],
  [188, 330],
  [184, 388],
  [196, 398],
  [196, 410],
  [158, 410],
  [158, 388],
  [156, 330],
  [154, 266],
  [150, 262],
];

/** Männlich: Schultern breiter, Arme weiter außen, Hüfte schmaler. */
const HAELFTE_MAENNLICH: readonly Punkt[] = [
  [150, 6],
  [162, 6],
  [174, 18],
  [176, 46],
  [168, 66],
  [160, 76],
  [161, 90],
  [196, 96],
  [214, 104],
  [219, 170],
  [223, 234],
  [229, 244],
  [227, 280],
  [215, 286],
  [206, 278],
  [202, 244],
  [200, 236],
  [198, 172],
  [196, 120],
  [190, 124],
  [184, 190],
  [188, 240],
  [190, 262],
  [188, 330],
  [184, 388],
  [196, 398],
  [196, 410],
  [158, 410],
  [158, 388],
  [156, 330],
  [154, 266],
  [150, 262],
];

/** Weiblich: Schultern schmaler, Taille enger, Hüfte breiter. */
const HAELFTE_WEIBLICH: readonly Punkt[] = [
  [150, 6],
  [162, 6],
  [174, 18],
  [176, 46],
  [168, 66],
  [160, 76],
  [161, 90],
  [188, 96],
  [206, 104],
  [214, 170],
  [218, 234],
  [224, 244],
  [222, 280],
  [210, 286],
  [202, 278],
  [198, 244],
  [196, 236],
  [194, 172],
  [192, 120],
  [186, 124],
  [178, 190],
  [194, 240],
  [196, 262],
  [190, 330],
  [184, 388],
  [196, 398],
  [196, 410],
  [158, 410],
  [158, 388],
  [156, 330],
  [154, 266],
  [150, 262],
];

/** Die drei Umrisse als geschlossene Polygone (Einheiten). */
export const UMRISSE: Record<Figur, readonly Punkt[]> = {
  maennlich: umrissAusHaelfte(HAELFTE_MAENNLICH),
  weiblich: umrissAusHaelfte(HAELFTE_WEIBLICH),
  neutral: umrissAusHaelfte(HAELFTE_NEUTRAL),
};

/** SVG-Pfad eines Umrisses (`M … L … Z`), harte Ecken. */
export function umrissPfad(figur: Figur): string {
  const [erster, ...rest] = UMRISSE[figur];
  return `M${erster[0]} ${erster[1]}${rest.map(([x, y]) => `L${x} ${y}`).join('')}Z`;
}

/**
 * Der Kopf als Bügel: ein Band über dem Kopf und je eine Säule daneben, beide Säulen reichen
 * über die Silhouette hinaus. Vorn liegt das Gesicht im Bügel, hinten gehört die Mitte zum Kopf.
 */
const KOPF_BUEGEL: readonly Rechteck[] = [
  { x: 76, y: 0, b: 148, h: 30 },
  { x: 76, y: 30, b: 48, h: 20 },
  { x: 176, y: 30, b: 48, h: 20 },
];
const KOPF_MITTE: Rechteck = { x: 124, y: 30, b: 52, h: 46 };

/** Zonen der Körpermitte, je Ansicht. */
const MITTE_VORN: readonly Zone[] = [
  { region: 'kopf', flaechen: KOPF_BUEGEL, mitte: [150, 18] },
  { region: 'gesicht', flaechen: [KOPF_MITTE], mitte: [150, 52] },
];
const MITTE_HINTEN: readonly Zone[] = [
  { region: 'kopf', flaechen: [...KOPF_BUEGEL, KOPF_MITTE], mitte: [150, 38] },
];

/** Der Hals: Band unter dem Kopf, Flügel neben Kinn und Hals, über den Schultern (vorn = hinten). */
const HALS: Zone = {
  region: 'hals',
  flaechen: [
    { x: 124, y: 76, b: 52, h: 20 },
    { x: 40, y: 50, b: 84, h: 46 },
    { x: 176, y: 50, b: 84, h: 46 },
  ],
  mitte: [150, 86],
};

const RUMPF_VORN: readonly Zone[] = [
  { region: 'thorax', flaechen: [{ x: 108, y: 96, b: 84, h: 68 }], mitte: [150, 128] },
  { region: 'abdomen', flaechen: [{ x: 108, y: 164, b: 84, h: 48 }], mitte: [150, 188] },
  { region: 'becken', flaechen: [{ x: 108, y: 212, b: 84, h: 48 }], mitte: [150, 234] },
];
const RUMPF_HINTEN: readonly Zone[] = [
  {
    region: 'ruecken',
    flaechen: [
      { x: 108, y: 96, b: 84, h: 46 },
      { x: 108, y: 142, b: 19, h: 70 },
      { x: 173, y: 142, b: 19, h: 70 },
    ],
    mitte: [150, 118],
  },
  { region: 'wirbelsaeule', flaechen: [{ x: 127, y: 142, b: 46, h: 70 }], mitte: [150, 176] },
  { region: 'gesaess', flaechen: [{ x: 108, y: 212, b: 84, h: 48 }], mitte: [150, 236] },
];

/** Gliedmaßen ohne Seite, so wie sie LINKS IM BILD stehen; rechts im Bild das Spiegelbild. */
type Glied = 'oberarm' | 'unterarm' | 'hand' | 'oberschenkel' | 'unterschenkel' | 'fuss';
const GLIEDER_LINKS_IM_BILD: readonly { glied: Glied; flaechen: Rechteck[]; mitte: Punkt }[] = [
  { glied: 'oberarm', flaechen: [{ x: 50, y: 96, b: 58, h: 76 }], mitte: [95, 136] },
  { glied: 'unterarm', flaechen: [{ x: 44, y: 172, b: 64, h: 64 }], mitte: [93, 204] },
  // Nach außen über die Hand hinaus (D13).
  { glied: 'hand', flaechen: [{ x: 26, y: 236, b: 78, h: 64 }], mitte: [90, 258] },
  { glied: 'oberschenkel', flaechen: [{ x: 104, y: 260, b: 46, h: 70 }], mitte: [129, 294] },
  { glied: 'unterschenkel', flaechen: [{ x: 104, y: 330, b: 46, h: 54 }], mitte: [130, 356] },
  // Nach unten über den Fuß hinaus bis an den Rahmen (D13).
  { glied: 'fuss', flaechen: [{ x: 94, y: 384, b: 56, h: 56 }], mitte: [128, 398] },
];

/** Gliedmaßen einer Ansicht: vorn steht links im Bild die rechte Seite des Patienten, hinten die linke. */
function glieder(ansicht: VerletzungAnsicht): Zone[] {
  const linksImBild = ansicht === 'vorn' ? 'r' : 'l';
  const rechtsImBild = ansicht === 'vorn' ? 'l' : 'r';
  return GLIEDER_LINKS_IM_BILD.flatMap(({ glied, flaechen, mitte }) => [
    { region: `${glied}_${linksImBild}` as KoerperRegion, flaechen, mitte },
    {
      region: `${glied}_${rechtsImBild}` as KoerperRegion,
      flaechen: flaechen.map(spiegleRechteck),
      mitte: [RAHMEN.breite - mitte[0], mitte[1]] as const,
    },
  ]);
}

/**
 * Die Zonen je Ansicht in FESTER Folge: so durchläuft sie die Tastatur (Roving-Tabindex, Spec
 * „Jede Region ist erreichbar“) — Kopf, Hals, Rumpf von oben, dann die Gliedmaßen in der Folge
 * des Bildes von links nach rechts, Arme vor Beinen.
 */
export const ZONEN: Record<VerletzungAnsicht, readonly Zone[]> = {
  vorn: ordne([...MITTE_VORN, HALS, ...RUMPF_VORN, ...glieder('vorn')]),
  hinten: ordne([...MITTE_HINTEN, HALS, ...RUMPF_HINTEN, ...glieder('hinten')]),
};

/** Mitte zuerst (wie aufgeführt), dann Arme, dann Beine, je links im Bild vor rechts. */
function ordne(zonen: Zone[]): Zone[] {
  const seiteImBild = (z: Zone) => (z.mitte[0] < MITTE_X ? 0 : 1);
  const glied = (z: Zone) =>
    GLIEDER_LINKS_IM_BILD.findIndex((g) => g.glied === z.region.replace(/_[lr]$/, ''));
  const nachBild = (a: Zone, b: Zone) => seiteImBild(a) - seiteImBild(b) || glied(a) - glied(b);
  const mitte = zonen.filter((z) => glied(z) < 0);
  const arme = zonen.filter((z) => glied(z) >= 0 && glied(z) < 3).sort(nachBild);
  const beine = zonen.filter((z) => glied(z) >= 3).sort(nachBild);
  return [...mitte, ...arme, ...beine];
}

/** Die Zone einer Region in einer Ansicht, `undefined`, wenn es die Region dort nicht gibt. */
export function zoneVon(ansicht: VerletzungAnsicht, region: KoerperRegion): Zone | undefined {
  return ZONEN[ansicht].find((z) => z.region === region);
}

/** Ob es die Region in der Ansicht gibt — dieselben Paare prüft der Server (422). */
export function gibtEsIn(ansicht: VerletzungAnsicht, region: KoerperRegion): boolean {
  return zoneVon(ansicht, region) !== undefined;
}

/** Rahmen einer Zone (Einheiten). */
export function zonenRahmen(zone: Zone): Rechteck {
  const x = Math.min(...zone.flaechen.map((r) => r.x));
  const y = Math.min(...zone.flaechen.map((r) => r.y));
  const x2 = Math.max(...zone.flaechen.map((r) => r.x + r.b));
  const y2 = Math.max(...zone.flaechen.map((r) => r.y + r.h));
  return { x, y, b: x2 - x, h: y2 - y };
}

/**
 * Ob die Zone ein achsparalleles Quadrat der Kante `kante` ganz enthält. Kandidaten sind die
 * Kanten ihrer Rechtecke; geprüft wird auf einem Raster von 2 Einheiten (Guard).
 */
export function enthaeltQuadrat(zone: Zone, kante: number): boolean {
  const xs = zone.flaechen.flatMap((r) => [r.x, r.x + r.b - kante]);
  const ys = zone.flaechen.flatMap((r) => [r.y, r.y + r.h - kante]);
  return xs.some((x0) =>
    ys.some((y0) => {
      for (let dx = 0; dx <= kante; dx += 2) {
        for (let dy = 0; dy <= kante; dy += 2) {
          if (!inZone([x0 + dx, y0 + dy], zone)) return false;
        }
      }
      return true;
    }),
  );
}

/** Punkt im Polygon (Strahlverfahren); auf der Kante zählt nicht sicher, der Guard meidet Kanten. */
export function imUmriss([px, py]: Punkt, umriss: readonly Punkt[]): boolean {
  let innen = false;
  for (let i = 0, j = umriss.length - 1; i < umriss.length; j = i++) {
    const [xi, yi] = umriss[i];
    const [xj, yj] = umriss[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) innen = !innen;
  }
  return innen;
}

/** Punkt in einer Zone (eines ihrer Rechtecke, Ränder eingeschlossen). */
export function inZone([px, py]: Punkt, zone: Zone): boolean {
  return zone.flaechen.some((r) => px >= r.x && px <= r.x + r.b && py >= r.y && py <= r.y + r.h);
}

/** Einheiten → normierte Lage (0..1 je Ansicht), wie sie der Server speichert. */
export function normiere([x, y]: Punkt): { x: number; y: number } {
  return { x: x / RAHMEN.breite, y: y / RAHMEN.hoehe };
}

/** Normierte Lage → Einheiten. */
export function inEinheiten(x: number, y: number): Punkt {
  return [x * RAHMEN.breite, y * RAHMEN.hoehe];
}

/**
 * Die Lage eines Sternchens aus einer Tippstelle: liegt sie in der Zone UND in der Figur, steht
 * das Sternchen dort, sonst (Zonenrand neben der Silhouette, Tastatur) am Mittelpunkt der Region.
 * So steht keine Markierung im leeren Raum neben der Hand.
 */
export function sternLage(zone: Zone, tipp: Punkt | null, figur: Figur): Punkt {
  if (tipp && inZone(tipp, zone) && imUmriss(tipp, UMRISSE[figur])) return tipp;
  return zone.mitte;
}
