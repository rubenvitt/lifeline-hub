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
 * so keine Markierung. Die Figur ist eine Zeichnung und kein Icon (Spec `iconsatz`): eine weiche
 * Kontur durch Stützpunkte (Catmull-Rom), die nur an Hals, Achsel und Schritt knickt, die Arme
 * frei neben dem Rumpf (LLH-1485, vorher ein Polygon mit harten Ecken). Binnenlinien
 * unterscheiden vorn und hinten. Guard und Tippstelle rechnen mit dem abgetasteten Polygon.
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

/** Ein Stützpunkt des Umrisses; `ecke` knickt die Kontur (Hals, Achsel, Schritt). */
interface Stuetze {
  p: Punkt;
  ecke?: boolean;
}

/** Was die drei Figuren unterscheidet, als Versatz in Einheiten gegen die neutrale. */
interface Gestalt {
  schulter: number;
  brust: number;
  taille: number;
  huefte: number;
}

const GESTALT: Record<Figur, Gestalt> = {
  /** Schultern breiter, Arme weiter außen, Hüfte schmaler. */
  maennlich: { schulter: 4, brust: 1, taille: 1, huefte: -3 },
  /** Schultern schmaler, Taille enger, Hüfte breiter. */
  weiblich: { schulter: -4, brust: 1, taille: -3, huefte: 4 },
  neutral: { schulter: 0, brust: 0, taille: 0, huefte: 0 },
};

/**
 * Die rechte Bildhälfte von der Scheitelmitte im Uhrzeigersinn bis zum Schritt: Kopf, Hals,
 * Schulter, Arm außen hinab, Hand mit Daumenansatz, Arm innen hinauf bis zur Achsel, Rumpf, Bein
 * außen hinab, Fuß, Bein innen hinauf. Der Arm steht frei neben dem Rumpf.
 */
function haelfte({ schulter: s, brust: b, taille: t, huefte: h }: Gestalt): readonly Stuetze[] {
  const p = (x: number, y: number, ecke = false): Stuetze => ({ p: [x, y], ecke });
  return [
    // Kopf und Hals
    p(150, 6),
    p(163, 8),
    p(171, 17),
    p(174, 32),
    p(172, 46),
    p(167, 56),
    p(160, 63, true),
    p(162, 72),
    p(164, 80, true),
    // Schulter und Arm außen
    p(178 + s / 2, 86),
    p(196 + s, 93),
    p(207 + s, 101),
    p(212 + s, 114),
    p(214 + s, 136),
    p(216 + s, 168),
    p(219 + s, 200),
    p(222 + s, 232),
    // Hand
    p(226 + s, 244),
    p(229 + s, 260),
    p(228 + s, 276),
    p(222 + s, 288),
    p(215 + s, 288),
    p(211 + s, 278),
    p(207 + s, 268),
    p(205 + s, 256),
    p(206 + s, 244),
    // Arm innen bis zur Achsel
    p(203 + s, 232),
    p(200 + s, 204),
    p(198 + s, 172),
    p(196 + s, 140),
    p(194 + s, 120, true),
    // Rumpf
    p(189 + b / 3, 128),
    p(187 + b, 150),
    p(183 + t, 176),
    p(181 + t, 196),
    p(186 + h, 222),
    p(190 + h, 246),
    p(191 + h * 0.6, 270),
    // Bein außen, Fuß, Bein innen
    p(188, 300),
    p(185, 326),
    p(183, 336),
    p(186, 356),
    p(183, 376),
    p(178, 388),
    p(183, 397),
    p(188, 406),
    p(184, 413),
    p(162, 413),
    p(158, 404),
    p(160, 392),
    p(158, 368),
    p(157, 340),
    p(156, 312),
    p(154, 284),
    p(150, 268, true),
  ];
}

/**
 * Der geschlossene Umriss aus seiner rechten Hälfte: die linke ist das Spiegelbild in umgekehrter
 * Folge. Beide Ansichten tragen denselben Umriss; was vorn und hinten unterscheidet, sind die
 * Regionen und die Binnenlinien.
 */
function stuetzen(figur: Figur): readonly Stuetze[] {
  const rechts = haelfte(GESTALT[figur]);
  const links = rechts
    .filter(({ p: [x] }) => x !== MITTE_X)
    .map(({ p: [x, y], ecke }) => ({ p: [RAHMEN.breite - x, y] as const, ecke }))
    .reverse();
  return [...rechts, ...links];
}

/** Ein kubisches Stück der Kontur: Anfang, zwei Kontrollpunkte, Ende. */
type Stueck = readonly [Punkt, Punkt, Punkt, Punkt];

/**
 * Die Kontur als Catmull-Rom-Spline durch die Stützpunkte, als kubische Stücke. An einer Ecke
 * fällt der Kontrollpunkt auf den Stützpunkt, die Kontur knickt dort.
 */
function stuecke(punkte: readonly Stuetze[]): readonly Stueck[] {
  const n = punkte.length;
  return punkte.map((_, i) => {
    const [p0, p1, p2, p3] = [-1, 0, 1, 2].map((d) => punkte[(i + d + n) % n]);
    const k1 = p1.ecke ? 0 : 1 / 6;
    const k2 = p2.ecke ? 0 : 1 / 6;
    return [
      p1.p,
      [p1.p[0] + (p2.p[0] - p0.p[0]) * k1, p1.p[1] + (p2.p[1] - p0.p[1]) * k1],
      [p2.p[0] - (p3.p[0] - p1.p[0]) * k2, p2.p[1] - (p3.p[1] - p1.p[1]) * k2],
      p2.p,
    ] as const;
  });
}

/** Abtastungen je Stück für das Polygon des Guards und der Tippstelle. */
const ABTASTUNG = 6;

function abgetastet(teile: readonly Stueck[]): readonly Punkt[] {
  return teile.flatMap(([a, b, c, d]) =>
    Array.from({ length: ABTASTUNG }, (_, i) => {
      const t = i / ABTASTUNG;
      const u = 1 - t;
      const f = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      return [
        f[0] * a[0] + f[1] * b[0] + f[2] * c[0] + f[3] * d[0],
        f[0] * a[1] + f[1] * b[1] + f[2] * c[1] + f[3] * d[1],
      ] as const;
    }),
  );
}

const STUECKE: Record<Figur, readonly Stueck[]> = {
  maennlich: stuecke(stuetzen('maennlich')),
  weiblich: stuecke(stuetzen('weiblich')),
  neutral: stuecke(stuetzen('neutral')),
};

/**
 * Die drei Umrisse als dicht abgetastete Polygone (Einheiten): Grundlage von {@link imUmriss}
 * für Guard und Tippstelle. Gezeichnet wird die Kurve ({@link umrissPfad}).
 */
export const UMRISSE: Record<Figur, readonly Punkt[]> = {
  maennlich: abgetastet(STUECKE.maennlich),
  weiblich: abgetastet(STUECKE.weiblich),
  neutral: abgetastet(STUECKE.neutral),
};

const zahl = (v: number) => String(Math.round(v * 10) / 10);

/** SVG-Pfad eines Umrisses (`M … C … Z`), weiche Kontur mit Knicken an Hals, Achsel und Schritt. */
export function umrissPfad(figur: Figur): string {
  const teile = STUECKE[figur];
  const [x0, y0] = teile[0][0];
  const kurven = teile
    .map(([, b, c, d]) => `C${[b, c, d].map(([x, y]) => `${zahl(x)} ${zahl(y)}`).join(' ')}`)
    .join('');
  return `M${x0} ${y0}${kurven}Z`;
}

/** Eine Binnenlinie: quadratische Kurve von `von` über `ueber` nach `nach` (Einheiten). */
export interface Binnenlinie {
  von: Punkt;
  ueber: Punkt;
  nach: Punkt;
}

/**
 * Binnenlinien je Ansicht: vorn Schlüsselbeine und Knie, hinten Wirbelsäule, Schulterblätter und
 * Gesäßfalte. Sie unterscheiden vorn und hinten auf einen Blick und tragen keine Bedienung; für
 * alle Figuren gleich, der Guard prüft, dass jede in jedem Umriss liegt.
 */
export const BINNENLINIEN: Record<VerletzungAnsicht, readonly Binnenlinie[]> = {
  vorn: [
    { von: [136, 92], ueber: [144, 97], nach: [150, 95] },
    { von: [150, 95], ueber: [156, 97], nach: [164, 92] },
    { von: [125, 334], ueber: [131, 337], nach: [137, 334] },
    { von: [163, 334], ueber: [169, 337], nach: [175, 334] },
  ],
  hinten: [
    { von: [150, 84], ueber: [150, 167], nach: [150, 250] },
    { von: [126, 112], ueber: [130, 130], nach: [138, 134] },
    { von: [174, 112], ueber: [170, 130], nach: [162, 134] },
    { von: [150, 250], ueber: [136, 256], nach: [126, 254] },
    { von: [150, 250], ueber: [164, 256], nach: [174, 254] },
  ],
};

/** SVG-Pfad der Binnenlinien einer Ansicht. */
export function binnenPfad(ansicht: VerletzungAnsicht): string {
  return BINNENLINIEN[ansicht]
    .map(({ von, ueber, nach }) => `M${von.join(' ')}Q${ueber.join(' ')} ${nach.join(' ')}`)
    .join('');
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
