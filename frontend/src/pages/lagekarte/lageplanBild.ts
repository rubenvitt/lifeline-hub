import { GEDAEMPFT_DECKKRAFT } from './abschnittFokus';
import type { KartenAufnahme, KartenBuendel } from './kartenAufnahme';
import {
  massstabLeiste,
  nordpfeilDrehung,
  veraltetHinweis,
  type LageplanLegende,
  type LegendenZone,
} from './lageplan';

/**
 * Bilder des Lageplans (LLH-1051, Spec `lagekarte-druck`) auf einer 2D-Leinwand:
 *
 * - {@link setzeKartenbild}: der Ausschnitt samt Bündel-Donuts (die als DOM nicht auf der
 *   Leinwand der Karte liegen) — das Bild des Druckblatts.
 * - {@link setzeLageplanAnlage}: dasselbe als ganzes Blatt mit Kopf, Maßstab, Nordpfeil und
 *   Legende — die PNG-Anlage an Lagebericht oder Befehl, die ohne die Seite verständlich bleibt.
 *
 * Papierfarben (`white`, `black`) als Namen wie in `druck/druck.css`: das Blatt ist hell, auch im
 * Nachtbetrieb.
 */

/** Längste Kante des Bildes in px: ein 3×-Tablet ergäbe sonst ein PNG nahe der 25-MiB-Grenze. */
export const LAGEPLAN_BILD_MAX_PX = 2800;

/** Schrift des Blatts; die App-Schrift ist nicht sicher geladen, wenn die Leinwand zeichnet. */
const SCHRIFT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** Maßstab der Leinwand: Bildpunkte je CSS-Pixel des Ausschnitts, gedeckelt. */
export function bildSkala(aufnahme: Pick<KartenAufnahme, 'breitePx' | 'hoehePx' | 'cssBreite'>) {
  const geraet = aufnahme.cssBreite > 0 ? aufnahme.breitePx / aufnahme.cssBreite : 1;
  const laengste = Math.max(aufnahme.breitePx, aufnahme.hoehePx);
  return laengste > LAGEPLAN_BILD_MAX_PX ? geraet * (LAGEPLAN_BILD_MAX_PX / laengste) : geraet;
}

/** Spalten der Legende auf dem Anlagenbild: so viele, wie Zeilen von 220 CSS-px nebeneinander passen. */
export function legendenSpalten(cssBreite: number): number {
  return Math.max(1, Math.min(4, Math.floor(cssBreite / 220)));
}

type Leinwand = { leinwand: HTMLCanvasElement; ctx: CanvasRenderingContext2D };

function neueLeinwand(breite: number, hoehe: number): Leinwand | null {
  const leinwand = document.createElement('canvas');
  leinwand.width = Math.max(1, Math.round(breite));
  leinwand.height = Math.max(1, Math.round(hoehe));
  const ctx = leinwand.getContext('2d');
  return ctx ? { leinwand, ctx } : null;
}

async function ladeBild(bild: Blob): Promise<CanvasImageSource | null> {
  try {
    if (typeof createImageBitmap === 'function') return await createImageBitmap(bild);
    const url = URL.createObjectURL(bild);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}

function alsPng(leinwand: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((fertig) => {
    try {
      leinwand.toBlob((b) => fertig(b && b.size > 0 ? b : null), 'image/png');
    } catch {
      fertig(null);
    }
  });
}

/**
 * Ein Bündel-Donut wie `baueClusterDonut`: Ring in Anteilen, weißer Kern, Zahl, Kürzel. Ein Bündel
 * nur aus fremden Kräften im Abschnittsfokus zeichnet mit `GEDAEMPFT_DECKKRAFT` wie auf der Karte
 * (LLH-1349); die Segmente sind deshalb Ringstücke, die den Kern nicht überdecken — durchscheinend
 * übereinander gemalt, färbten sie ihn.
 */
export function zeichneBuendel(
  ctx: CanvasRenderingContext2D,
  b: KartenBuendel,
  s: number,
  dy: number,
) {
  const x = b.x * s;
  const y = b.y * s + dy;
  const r = (b.durchmesser / 2) * s;
  const innen = r - b.ring * s;
  ctx.save();
  if (b.gedaempft) ctx.globalAlpha = GEDAEMPFT_DECKKRAFT;
  let winkel = -Math.PI / 2;
  const segmente = b.segmente.length > 0 ? b.segmente : [{ farbe: b.neutral, anteil: 1 }];
  for (const seg of segmente) {
    const bis = winkel + seg.anteil * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x, y, r, winkel, bis);
    ctx.arc(x, y, innen, bis, winkel, true);
    ctx.closePath();
    ctx.fillStyle = seg.farbe;
    ctx.fill();
    winkel = bis;
  }
  ctx.beginPath();
  ctx.arc(x, y, innen, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.fillStyle = 'black';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${Math.round(13 * s)}px ${SCHRIFT}`;
  ctx.fillText(b.zahl, x, b.kurz ? y - 5 * s : y);
  if (b.kurz) {
    ctx.font = `${Math.round(10 * s)}px ${SCHRIFT}`;
    ctx.fillText(b.kurz, x, y + 7 * s);
  }
  ctx.restore();
}

/** Zeichnet Ausschnitt und Bündel ab `dy`; liefert die Höhe in Bildpunkten. */
function zeichneAusschnitt(
  ctx: CanvasRenderingContext2D,
  karte: CanvasImageSource,
  aufnahme: KartenAufnahme,
  s: number,
  dy: number,
): number {
  const breite = aufnahme.cssBreite * s;
  const hoehe = aufnahme.cssHoehe * s;
  ctx.drawImage(karte, 0, dy, breite, hoehe);
  for (const b of aufnahme.buendel) zeichneBuendel(ctx, b, s, dy);
  return hoehe;
}

/** Das Kartenbild des Druckblatts: Ausschnitt samt Bündeln, ohne Bündel unverändert. */
export async function setzeKartenbild(aufnahme: KartenAufnahme): Promise<Blob | null> {
  const s = bildSkala(aufnahme);
  const geraet = aufnahme.cssBreite > 0 ? aufnahme.breitePx / aufnahme.cssBreite : 1;
  if (aufnahme.buendel.length === 0 && s === geraet) return aufnahme.bild;
  const karte = await ladeBild(aufnahme.bild);
  const flaeche = neueLeinwand(aufnahme.cssBreite * s, aufnahme.cssHoehe * s);
  if (!karte || !flaeche) return null;
  zeichneAusschnitt(flaeche.ctx, karte, aufnahme, s, 0);
  return alsPng(flaeche.leinwand);
}

/** Text auf `max` Bildpunkte kürzen, mit Auslassungszeichen. */
function gekuerzt(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

function zeichneNordpfeil(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  grad: number,
) {
  const r = 18 * s;
  ctx.save();
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.translate(x, y);
  ctx.rotate((grad * Math.PI) / 180);
  ctx.fillStyle = 'black';
  ctx.beginPath();
  ctx.moveTo(0, -r + 4 * s);
  ctx.lineTo(6 * s, 6 * s);
  ctx.lineTo(0, 2 * s);
  ctx.lineTo(-6 * s, 6 * s);
  ctx.closePath();
  ctx.fill();
  ctx.font = `700 ${Math.round(10 * s)}px ${SCHRIFT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', 0, 12 * s);
  ctx.restore();
}

function zeichneMassstab(
  ctx: CanvasRenderingContext2D,
  x: number,
  yUnten: number,
  s: number,
  laenge: number,
  text: string,
) {
  const h = 8 * s;
  ctx.font = `${Math.round(12 * s)}px ${SCHRIFT}`;
  const textBreite = ctx.measureText(text).width;
  const pad = 6 * s;
  ctx.fillStyle = 'white';
  ctx.fillRect(
    x - pad,
    yUnten - h - 18 * s - pad,
    laenge + 2 * pad + Math.max(0, textBreite - laenge),
    h + 18 * s + 2 * pad,
  );
  ctx.fillStyle = 'black';
  ctx.fillRect(x, yUnten - h, laenge / 2, h);
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(x, yUnten - h, laenge, h);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, yUnten - h - 4 * s);
}

function zeichneZonenFeld(
  ctx: CanvasRenderingContext2D,
  z: LegendenZone,
  x: number,
  y: number,
  g: number,
  s: number,
) {
  ctx.save();
  ctx.globalAlpha = Math.max(0.15, Math.min(1, z.fuellDeckung));
  ctx.fillStyle = z.fuellung;
  ctx.fillRect(x, y, g, g);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = z.linie;
  ctx.lineWidth = 2 * s;
  if (z.gestrichelt) ctx.setLineDash([4 * s, 3 * s]);
  ctx.strokeRect(x, y, g, g);
  ctx.restore();
}

export interface LageplanAnlageDaten {
  aufnahme: KartenAufnahme;
  /** „Lageplan · Hochwasser Musterstadt“. */
  titel: string;
  /** Unter dem Titel, mit „ · “ verbunden: Stand, Ansicht, Kartengrundlage. */
  zeilen: string[];
  legende: LageplanLegende;
}

/**
 * Die Anlage als ganzes Blatt: Kopf, Ausschnitt mit Maßstab und Nordpfeil, Hinweis auf veraltete
 * Fachebenen, Legende. `null`, wenn die Leinwand kein Bild hergibt.
 */
export async function setzeLageplanAnlage(d: LageplanAnlageDaten): Promise<Blob | null> {
  const { aufnahme, legende } = d;
  const s = bildSkala(aufnahme);
  const breite = aufnahme.cssBreite * s;
  const rand = 16 * s;
  const kopfHoehe = 58 * s;
  const zeile = 20 * s;
  const hinweis = veraltetHinweis(legende);
  const spalten = legendenSpalten(aufnahme.cssBreite);
  // Dieselbe Folge wie auf Papier (`legendenTexte`), an den Zonen mit Farbfeld.
  const eintraege = [
    ...legende.ebenen.map((z) => ({ text: z.text, zone: null as LegendenZone | null })),
    ...legende.zonen.map((z) => ({ text: z.text, zone: z })),
    ...legende.fachebenen.map((z) => ({ text: z.text, zone: null })),
    ...legende.bilder.map((z) => ({ text: `Bild: ${z.text}`, zone: null })),
  ];
  const zeilenJeSpalte = Math.ceil(eintraege.length / spalten);
  const legendeHoehe =
    (hinweis ? zeile + 4 * s : 0) + (eintraege.length > 0 ? zeile + zeilenJeSpalte * zeile : 0);
  const hoehe = kopfHoehe + aufnahme.cssHoehe * s + rand + legendeHoehe + rand;

  const karte = await ladeBild(aufnahme.bild);
  const flaeche = neueLeinwand(breite, hoehe);
  if (!karte || !flaeche) return null;
  const { ctx, leinwand } = flaeche;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, leinwand.width, leinwand.height);

  // Kopf
  ctx.fillStyle = 'black';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 ${Math.round(18 * s)}px ${SCHRIFT}`;
  ctx.fillText(gekuerzt(ctx, d.titel, breite - 2 * rand), rand, rand + 16 * s);
  ctx.font = `${Math.round(13 * s)}px ${SCHRIFT}`;
  ctx.fillText(gekuerzt(ctx, d.zeilen.join(' · '), breite - 2 * rand), rand, rand + 36 * s);

  // Ausschnitt mit Maßstab und Nordpfeil
  const kartenHoehe = zeichneAusschnitt(ctx, karte, aufnahme, s, kopfHoehe);
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1 * s;
  ctx.strokeRect(0, kopfHoehe, breite, kartenHoehe);
  const massstab = massstabLeiste(aufnahme.meterJePx, aufnahme.cssBreite);
  if (massstab) {
    zeichneMassstab(
      ctx,
      rand,
      kopfHoehe + kartenHoehe - rand,
      s,
      massstab.anteil * breite,
      massstab.text,
    );
  }
  zeichneNordpfeil(
    ctx,
    breite - rand - 18 * s,
    kopfHoehe + rand + 18 * s,
    s,
    nordpfeilDrehung(aufnahme.peilung),
  );

  // Hinweis und Legende
  let y = kopfHoehe + kartenHoehe + rand;
  if (hinweis) {
    ctx.fillStyle = 'black';
    ctx.font = `700 ${Math.round(13 * s)}px ${SCHRIFT}`;
    ctx.fillText(gekuerzt(ctx, hinweis, breite - 2 * rand), rand, y + 14 * s);
    y += zeile + 4 * s;
  }
  if (eintraege.length > 0) {
    ctx.font = `700 ${Math.round(13 * s)}px ${SCHRIFT}`;
    ctx.fillText('Legende', rand, y + 14 * s);
    y += zeile;
    ctx.font = `${Math.round(12 * s)}px ${SCHRIFT}`;
    const spaltenBreite = (breite - 2 * rand) / spalten;
    const feld = 12 * s;
    eintraege.forEach((e, i) => {
      const sp = Math.floor(i / zeilenJeSpalte);
      const x = rand + sp * spaltenBreite;
      const zy = y + (i % zeilenJeSpalte) * zeile;
      let tx = x;
      if (e.zone) {
        zeichneZonenFeld(ctx, e.zone, x, zy + 3 * s, feld, s);
        tx += feld + 6 * s;
      }
      ctx.fillStyle = 'black';
      ctx.fillText(gekuerzt(ctx, e.text, x + spaltenBreite - tx - 8 * s), tx, zy + 14 * s);
    });
  }
  return alsPng(leinwand);
}
