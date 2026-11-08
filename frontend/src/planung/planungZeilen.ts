import dayjs from 'dayjs';
import type {
  Personal,
  Planung,
  PlanungBlock,
  PlanungBlockAendernBody,
  PlanungBlockBody,
  PlanungErzeugenBody,
  PlanungKopf,
  PlanungPersonEingabe,
  PlanungPosten,
  QualiSollEintrag,
  SchichtplanBlock,
  SchichtplanBlockAendernBody,
  SchichtplanBlockBody,
  SchichtplanErzeugenBody,
  SchichtplanHelfer,
  SchichtplanPersonEingabe,
  SchichtplanPostenEingabe,
} from '../api/types';
import { alsZeitpunkt, effektiveZone } from '../anzeige/zeitEingabe';
import { formatDauer } from '../abloesung/dauer';
import {
  STUNDE_MS,
  type RasterBlock,
  type RasterZeile,
  type Spanne,
} from '../abloesung/schichtplan/raster';
import {
  alsRasterBlock,
  OHNE_ABSCHNITT,
  PAUSE,
  personenOptionen,
  postenEingabe,
  postenSchluessel,
  type PersonOption,
} from '../abloesung/schichtplan/schichtplanZeilen';

/**
 * Adapter der Vorplanung (LLH-1586) auf das fachneutrale Raster und die Bausteine des
 * Einsatz-Schichtplans (`abloesung/schichtplan`): Blockdialog, „Schichten erzeugen“, Seitenleiste
 * und Handy-Liste arbeiten auf `SchichtplanBlock` und den Bodies des Einsatzes. Dieser Adapter
 * übersetzt in beide Richtungen; gerechnet wird nichts, Lücke und Befunde liefert der Server.
 *
 * SCHLÜSSEL: ein Posten der Planung steht in den Bausteinen als Posten der Art `einheit` mit der
 * `posten_id` als `einheit_id` (Zeile `einheit:<posten_id>`), die Pause bleibt die Pause. Die Art
 * sieht niemand: Titel und Abschnitt kommen aus dem Posten der Planung. Hinaus geht nur
 * `posten_id` (`null` = Pause).
 */

/** Zeile eines Postens der Planung; `null` ist die Pause. */
export function zeileVon(postenId: number | null): string {
  return postenId == null ? PAUSE : postenSchluessel({ art: 'einheit', einheit_id: postenId });
}

/** Posten aus der Eingabe der Bausteine: `null` = Pause. */
function postenIdVon(p: SchichtplanPostenEingabe): number | null {
  if (p.art === 'pause') return null;
  return p.art === 'einheit' ? p.einheit_id : p.uhs_id;
}

/** Posten aus einer Zeile: `null` = Pause, `undefined` = keine Zeile der Planung. */
export function postenIdAus(zeile: string): number | null | undefined {
  const p = postenEingabe(zeile);
  if (!p) return undefined;
  return postenIdVon(p);
}

/**
 * Die Zeilen in der Reihenfolge der Posten (`sortier`), die Pause zuletzt. Der Abschnitt ist die
 * Gruppe; hat ein Posten keinen, während andere einen haben, steht er unter „Ohne Abschnitt“,
 * damit er nicht unter dem Abschnitt darüber zu stehen scheint.
 */
export function planungZeilen(posten: readonly PlanungPosten[]): RasterZeile[] {
  const geordnet = [...posten].sort((a, b) => a.sortier - b.sortier);
  const mitAbschnitt = geordnet.some((p) => p.abschnitt);
  const zeilen: RasterZeile[] = geordnet.map((p) => ({
    schluessel: zeileVon(p.id),
    titel: p.bezeichnung,
    gruppe: p.abschnitt ? p.abschnitt : mitAbschnitt ? OHNE_ABSCHNITT : null,
  }));
  zeilen.push({ schluessel: PAUSE, titel: 'Pause', gruppe: null, ueberlappungErlaubt: true });
  return zeilen;
}

/** Ein Block der Planung in der Form des Einsatz-Blocks. */
export function alsSchichtplanBlock(
  block: PlanungBlock,
  postenNamen: ReadonlyMap<number, string>,
): SchichtplanBlock {
  const { posten_id, ...rest } = block;
  return {
    ...rest,
    posten:
      posten_id == null
        ? { art: 'pause', aufgeloest: false }
        : {
            art: 'einheit',
            einheit_id: posten_id,
            bezeichnung: postenNamen.get(posten_id) ?? 'Posten',
            aufgeloest: false,
          },
  };
}

export function schichtplanBloecke(planung: Planung | undefined): SchichtplanBlock[] {
  if (!planung) return [];
  const namen = new Map(planung.posten.map((p) => [p.id, p.bezeichnung]));
  return planung.bloecke.map((b) => alsSchichtplanBlock(b, namen));
}

export function rasterBloeckeVon(bloecke: readonly SchichtplanBlock[]): RasterBlock[] {
  return bloecke.map(alsRasterBlock);
}

// ── Bodies hinaus ────────────────────────────────────────────────────────────────────────────

/** Personen der Planung: Stamm-Personal und Helfer (eine Ad-hoc-Kraft gibt es ohne Einsatz nicht). */
function personenHinaus(personen: readonly SchichtplanPersonEingabe[]): PlanungPersonEingabe[] {
  return personen.flatMap((p): PlanungPersonEingabe[] =>
    p.art === 'stamm' || p.art === 'helfer' ? [p] : [],
  );
}

export function blockBody(b: SchichtplanBlockBody): PlanungBlockBody {
  const { posten, personen, ...rest } = b;
  const body: PlanungBlockBody = { ...rest, posten_id: postenIdVon(posten) };
  if (personen) body.personen = personenHinaus(personen);
  return body;
}

export function blockAendernBody(b: SchichtplanBlockAendernBody): PlanungBlockAendernBody {
  const { posten, personen, ...rest } = b;
  const body: PlanungBlockAendernBody = { ...rest };
  if (posten) body.posten_id = postenIdVon(posten);
  if (personen) body.personen = personenHinaus(personen);
  return body;
}

export function erzeugenBody(b: SchichtplanErzeugenBody): PlanungErzeugenBody {
  const { posten, ...rest } = b;
  return { ...rest, posten_id: postenIdVon(posten) };
}

// ── Vorgaben je Posten und Personen ──────────────────────────────────────────────────────────

/** Soll eines neuen Blocks ohne eigene Angabe (der Server kopiert das Soll des Postens). */
export function sollVorgaben(posten: readonly PlanungPosten[]): Map<string, number | null> {
  return new Map(posten.map((p) => [zeileVon(p.id), p.soll_anzahl ?? null]));
}

export function qualiVorgaben(
  posten: readonly PlanungPosten[],
): Map<string, readonly QualiSollEintrag[] | null> {
  return new Map(posten.map((p) => [zeileVon(p.id), p.quali_soll ?? null]));
}

/** Schichtlänge je Posten in der Form der Anzeige („4 h“); ohne Länge fehlt der Posten. */
export function laengenVorgaben(posten: readonly PlanungPosten[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of posten)
    if (p.schichtlaenge_minuten != null)
      m.set(zeileVon(p.id), formatDauer(p.schichtlaenge_minuten));
  return m;
}

/** Wen man einteilen kann: Stamm-Personal im Dienst und die Helfer der Planung. */
export function planungPersonen(
  stamm: readonly Personal[] | undefined,
  helfer: readonly SchichtplanHelfer[] | undefined,
): PersonOption[] {
  return personenOptionen(undefined, stamm, helfer);
}

// ── Zeitspanne ───────────────────────────────────────────────────────────────────────────────

export const GANZE_PLANUNG = 'ganz';

/** Ein Kalendertag der Planung in der Anzeigezone. */
export interface PlanungTag {
  /** `tag:YYYY-MM-DD` */
  schluessel: string;
  von: number;
  bis: number;
}

/** Höchstens so viele Tage (der Server lässt 14 zu; eine Grenze gegen Endlosschleifen). */
const TAGE_MAX = 31;

/** Die Kalendertage von `von` bis `bis` (das Ende ausschließlich) in der Zone. */
export function planungTage(
  kopf: Pick<PlanungKopf, 'von' | 'bis'>,
  zone: string | null | undefined,
): PlanungTag[] {
  const z = effektiveZone(zone);
  const von = alsZeitpunkt(kopf.von);
  const bis = alsZeitpunkt(kopf.bis);
  if (!von || !bis) return [];
  // Tagesbeginne als Wanduhr „Datum 00:00“ direkt in der Zone: `startOf('day')` auf einem
  // Zonen-Datum nimmt bei der Zeitumstellung den Versatz der Browserzone (dayjs-tz).
  const beginn = (datum: string) =>
    (z ? dayjs.tz(`${datum} 00:00:00`, z) : dayjs(`${datum}T00:00:00`)).valueOf();
  const folgetag = (datum: string) => dayjs(datum).add(1, 'day').format('YYYY-MM-DD');
  const tage: PlanungTag[] = [];
  let datum = (z ? dayjs(von.valueOf()).tz(z) : dayjs(von.valueOf())).format('YYYY-MM-DD');
  let start = beginn(datum);
  for (let i = 0; i < TAGE_MAX && start < bis.valueOf(); i++) {
    const naechstes = folgetag(datum);
    const ende = beginn(naechstes);
    tage.push({ schluessel: `tag:${datum}`, von: start, bis: ende });
    datum = naechstes;
    start = ende;
  }
  return tage;
}

/**
 * Die gezeigte Spanne: ein Tag ganz, oder die ganze Planung auf volle Stunden, so weit auch
 * Blöcke außerhalb des Zeitraums reichen (die Befunde nennen sie, das Raster soll sie zeigen).
 */
export function planungSpanne(
  wahl: string,
  kopf: Pick<PlanungKopf, 'von' | 'bis'>,
  tage: readonly PlanungTag[],
  bloecke: readonly RasterBlock[],
): Spanne {
  const tag = tage.find((t) => t.schluessel === wahl);
  if (tag) return { von: tag.von, bis: tag.bis };
  const von = Math.min(alsZeitpunkt(kopf.von)?.valueOf() ?? 0, ...bloecke.map((b) => b.von));
  const bis = Math.max(alsZeitpunkt(kopf.bis)?.valueOf() ?? 0, ...bloecke.map((b) => b.bis));
  const abgerundet = Math.floor(von / STUNDE_MS) * STUNDE_MS;
  const aufgerundet = Math.ceil(bis / STUNDE_MS) * STUNDE_MS;
  return { von: abgerundet, bis: Math.max(aufgerundet, abgerundet + STUNDE_MS) };
}
