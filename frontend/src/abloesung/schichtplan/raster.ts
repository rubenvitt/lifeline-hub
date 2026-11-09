import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { effektiveZone } from '../../anzeige/zeitEingabe';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * Das Raster des Schichtplans, fachneutral und ohne React (LLH-1554, Konzept LLH-1523
 * Abschnitt 6): Zeilen, Blöcke, Zeitachse und die Rechnung eines Zugs. Die Ansicht im Einsatz
 * (`schichtplanZeilen.ts`) und die Vorplanung ohne Einsatz (LLH-1561) bauen ihre Zeilen und
 * Blöcke je mit einem eigenen Adapter; das Raster kennt weder Einheit noch UHS.
 *
 * Zeiten sind Millisekunden seit der Epoche. Das Raster rastet auf 5 Minuten, ein Block dauert
 * mindestens 10 Minuten (wie Server und Suite, Spec `kraefte-schichtplan`, „Planschicht“).
 * Eine Spanne darf mehrere Tage umfassen.
 */

export const MINUTE_MS = 60_000;
export const STUNDE_MS = 60 * MINUTE_MS;
export const RASTER_MS = 5 * MINUTE_MS;
export const MINDEST_MS = 10 * MINUTE_MS;

export interface RasterZeile {
  /** Eindeutig im Raster, z. B. `einheit:12`, `uhs:3`, `pause`. */
  schluessel: string;
  titel: string;
  /** Gruppenkopf (Abschnitt); `null` = ohne Kopf. Die Reihenfolge der Zeilen kommt vom Aufrufer. */
  gruppe: string | null;
  /** Blöcke dieser Zeile dürfen sich überschneiden (die Pause). */
  ueberlappungErlaubt?: boolean;
  /**
   * Der Posten ist entfallen, die Zeilenschleuse hält seine leere Zeile, bis sie öffnet
   * (LLH-1604, `zeilenSchleuse.ts`). In ihr wird nichts angelegt und nichts abgelegt.
   */
  entfallen?: boolean;
}

/** Titel einer Zeile; eine entfallene trägt den Zusatz (LLH-1604). */
export function titelVon(z: RasterZeile): string {
  return z.entfallen ? `${z.titel} (entfallen)` : z.titel;
}

/** Ampel eines Blocks; das Wort daneben ist der zweite Kanal (WCAG 1.4.1). */
export type Ampel = 'besetzt' | 'luecke' | 'befund' | 'ohne-soll';

export interface RasterBlock {
  id: number;
  zeile: string;
  von: number;
  bis: number;
  /** Inhalt des Blocks: die Personen oder „unbesetzt“. */
  text: string;
  ampel: Ampel;
  ampelWort: string;
}

export interface Spanne {
  von: number;
  bis: number;
}

/** Auf das 5-Minuten-Raster, zur nächsten Marke. */
export function schnappe(ms: number): number {
  return Math.round(ms / RASTER_MS) * RASTER_MS;
}

export function xAusZeit(t: number, breite: number, spanne: Spanne): number {
  return ((t - spanne.von) / (spanne.bis - spanne.von)) * breite;
}

export function zeitAusX(x: number, breite: number, spanne: Spanne): number {
  return spanne.von + (x / breite) * (spanne.bis - spanne.von);
}

/** Überschneidet `[von, bis)` einen anderen Block der Zeile? Berühren ist erlaubt. */
export function ueberschneidet(
  bloecke: readonly RasterBlock[],
  zeile: string,
  von: number,
  bis: number,
  ohneId?: number,
): boolean {
  return bloecke.some((b) => b.zeile === zeile && b.id !== ohneId && b.von < bis && von < b.bis);
}

// ── Zug ────────────────────────────────────────────────────────────────────────────────────

/** Ein laufender Zeigerzug im Raster. */
export type Zug =
  /** Zeitbereich in einer Zeile aufziehen. */
  | { art: 'anlegen'; zeile: string; start: number }
  /** Block verschieben, auch in eine andere Zeile; `griff` = Abstand Zeiger–Beginn. */
  | { art: 'verschieben'; blockId: number; von: number; bis: number; griff: number }
  /** Eine Kante ziehen. */
  | { art: 'anfang' | 'ende'; blockId: number; zeile: string; von: number; bis: number };

/** Breite eines Kantengriffs in Pixeln. */
export const KANTE_PX = 8;

/** Welche Kanten eines Blocks Griffe tragen: nur echte Kanten in der Spanne, nur mit Platz. */
export function griffKanten(
  block: { von: number; bis: number },
  spanne: Spanne,
  breitePx: number,
): { anfang: boolean; ende: boolean } {
  const platz = breitePx > 3 * KANTE_PX;
  return { anfang: platz && block.von >= spanne.von, ende: platz && block.bis <= spanne.bis };
}

/** Was ein Druck an der Stelle `versatzPx` im Block fasst. */
export function griffAn(
  versatzPx: number,
  breitePx: number,
  kanten: { anfang: boolean; ende: boolean },
): 'anfang' | 'ende' | 'verschieben' {
  if (kanten.anfang && versatzPx < KANTE_PX) return 'anfang';
  if (kanten.ende && versatzPx > breitePx - KANTE_PX) return 'ende';
  return 'verschieben';
}

export interface ZugStand {
  zeile: string;
  von: number;
  bis: number;
}

/**
 * Wo der Zug gerade steht, aus der Zeit und der Zeile unter dem Zeiger. Aufziehen und Kanten
 * bleiben in ihrer Zeile; nur das Verschieben wechselt sie. Kanten halten die Mindestdauer.
 */
export function zugStand(zug: Zug, zeit: number, zeileUnterZeiger: string | null): ZugStand {
  switch (zug.art) {
    case 'anlegen': {
      const a = schnappe(zug.start);
      const b = schnappe(zeit);
      return { zeile: zug.zeile, von: Math.min(a, b), bis: Math.max(a, b) };
    }
    case 'verschieben': {
      const von = schnappe(zeit - zug.griff);
      return { zeile: zeileUnterZeiger ?? '', von, bis: von + (zug.bis - zug.von) };
    }
    case 'anfang':
      return {
        zeile: zug.zeile,
        von: Math.min(schnappe(zeit), zug.bis - MINDEST_MS),
        bis: zug.bis,
      };
    case 'ende':
      return {
        zeile: zug.zeile,
        von: zug.von,
        bis: Math.max(schnappe(zeit), zug.von + MINDEST_MS),
      };
  }
}

export type ZugPruefung = 'ok' | 'zu-kurz' | 'ueberschneidung' | 'keine-zeile' | 'unveraendert';

/**
 * Darf der Stand eines Zugs geschrieben werden? Der Server prüft dasselbe (400/422); das Raster
 * sendet nur, was er annähme, und zeigt den Grund am Schatten.
 *
 * `kopie` (LLH-1584): ein verschobener Block mit Strg oder Alt legt eine Kopie an. Das Original
 * bleibt stehen, die Kopie prüft deshalb auch gegen den eigenen Block, und am alten Platz ist sie
 * nicht „unverändert“, sondern eine Überschneidung (außer in der Pause).
 */
export function pruefeZug(
  zug: Zug,
  stand: ZugStand,
  zeilen: readonly RasterZeile[],
  bloecke: readonly RasterBlock[],
  kopie = false,
): ZugPruefung {
  const zeile = zeilen.find((z) => z.schluessel === stand.zeile);
  // Eine entfallene Zeile hält nur die Schleuse (LLH-1604): ihren Posten gibt es nicht mehr.
  if (!zeile || zeile.entfallen) return 'keine-zeile';
  if (stand.bis - stand.von < MINDEST_MS) return 'zu-kurz';
  const alsKopie = kopie && zug.art === 'verschieben';
  if (zug.art !== 'anlegen' && !alsKopie) {
    const block = bloecke.find((b) => b.id === zug.blockId);
    if (block && block.zeile === stand.zeile && block.von === stand.von && block.bis === stand.bis)
      return 'unveraendert';
  }
  if (
    !zeile.ueberlappungErlaubt &&
    ueberschneidet(
      bloecke,
      stand.zeile,
      stand.von,
      stand.bis,
      zug.art === 'anlegen' || alsKopie ? undefined : zug.blockId,
    )
  )
    return 'ueberschneidung';
  return 'ok';
}

// ── Spanne und Achse ───────────────────────────────────────────────────────────────────────

export type SpannenWahl = '6h' | '12h' | 'einsatz';

function abgerundetAufStunde(ms: number): number {
  return Math.floor(ms / STUNDE_MS) * STUNDE_MS;
}

function aufgerundetAufStunde(ms: number): number {
  return Math.ceil(ms / STUNDE_MS) * STUNDE_MS;
}

/**
 * Die gezeigte Spanne: 6 h ab einer Stunde vor jetzt, 12 h ab zwei Stunden vor jetzt, oder der
 * ganze Einsatz vom Beginn (oder dem frühesten Block) bis zum spätesten Block, mindestens bis
 * zwei Stunden nach jetzt.
 */
export function spanneAus(
  wahl: SpannenWahl,
  jetzt: number,
  beginn: number,
  bloecke: readonly RasterBlock[],
): Spanne {
  if (wahl === '6h') {
    const von = abgerundetAufStunde(jetzt) - STUNDE_MS;
    return { von, bis: von + 6 * STUNDE_MS };
  }
  if (wahl === '12h') {
    const von = abgerundetAufStunde(jetzt) - 2 * STUNDE_MS;
    return { von, bis: von + 12 * STUNDE_MS };
  }
  const von = abgerundetAufStunde(Math.min(beginn, jetzt, ...bloecke.map((b) => b.von)));
  const bis = aufgerundetAufStunde(
    Math.max(jetzt + 2 * STUNDE_MS, von + 6 * STUNDE_MS, ...bloecke.map((b) => b.bis)),
  );
  return { von, bis };
}

/**
 * Pixel je Stunde: die Breite füllt die Spanne, aber nie enger als `mindestJeStunde` (dann rollt
 * das Raster waagerecht). So bleibt eine 5-Minuten-Marke auch im ganzen Einsatz greifbar.
 */
export function pxJeStunde(breite: number, spanne: Spanne, mindestJeStunde: number): number {
  const stunden = (spanne.bis - spanne.von) / STUNDE_MS;
  return Math.max(mindestJeStunde, breite / Math.max(stunden, 1));
}

/** Abstand der beschrifteten Stundenmarken: 1, 2, 3, 6 oder 12 h, je nach Platz. */
export function markenSchritt(pxStunde: number, mindestAbstand = 56): number {
  for (const h of [1, 2, 3, 6, 12]) if (h * pxStunde >= mindestAbstand) return h;
  return 24;
}

/**
 * Volle Stunden der Anzeigezone in der Spanne, alle `schritt` Stunden (Wanduhr 0, 2, 4 … bei 2).
 * Über eine Umstellung der Uhr hinweg zählt die Wanduhr, nicht die Dauer.
 */
export function stundenMarken(
  spanne: Spanne,
  zone: string | null | undefined,
  schritt: number,
): number[] {
  const z = effektiveZone(zone);
  const inZone = (ms: number) => (z ? dayjs(ms).tz(z) : dayjs(ms));
  const marken: number[] = [];
  // Weiter in echten Stunden (Millisekunden): `add(1, 'hour')` in der Zone liefe in der Nacht der
  // Rückstellung doppelt über dieselbe Stunde.
  let t = inZone(spanne.von).startOf('hour').valueOf();
  if (t < spanne.von) t += STUNDE_MS;
  // Sicher gegen Endlosschleifen: höchstens eine Marke je Stunde.
  for (let i = 0; i < 24 * 400 && t <= spanne.bis; i++, t += STUNDE_MS) {
    if (inZone(t).hour() % schritt === 0) marken.push(t);
  }
  return marken;
}

// ── Liste fürs Handy ───────────────────────────────────────────────────────────────────────

export interface JetztUndNaechstes {
  /** Was gerade läuft (in der Pause auch mehrere). */
  jetzt: RasterBlock[];
  /** Der nächste Block, der danach beginnt. */
  naechstes: RasterBlock | null;
}

/** Je Zeile: was gerade läuft, und was als Nächstes beginnt. */
export function jetztUndNaechstes(
  bloecke: readonly RasterBlock[],
  zeile: string,
  jetzt: number,
): JetztUndNaechstes {
  const eigene = bloecke.filter((b) => b.zeile === zeile).sort((a, b) => a.von - b.von);
  const laufend = eigene.filter((b) => b.von <= jetzt && jetzt < b.bis);
  const naechstes = eigene.find((b) => b.von > jetzt) ?? null;
  return { jetzt: laufend, naechstes };
}
