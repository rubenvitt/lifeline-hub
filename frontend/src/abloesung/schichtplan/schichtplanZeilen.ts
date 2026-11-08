import type {
  AbloesungVorgabe,
  Einheit,
  EinsatzPersonal,
  Personal,
  Schichtplan,
  SchichtplanBefund,
  SchichtplanBlock,
  SchichtplanBlockBody,
  SchichtplanHelfer,
  SchichtplanPerson,
  SchichtplanPersonEingabe,
  SchichtplanPostenEingabe,
  Uhs,
} from '../../api/types';
import { alsBackendZeit, alsZeitpunkt } from '../../anzeige/zeitEingabe';
import { qualiSollEingabe } from '../../kraefte/qualiSoll';
import { abschnittDerEinheit } from '../../kraefte/kraeftebaumKern';
import { formatDauer } from '../dauer';
import type { Ampel, RasterBlock, RasterZeile } from './raster';

/**
 * Der Schichtplan eines Einsatzes als Raster (LLH-1554): Zeilen aus Einheiten, UHS und der
 * Pause, Blöcke mit Ampel und Wort. Gerechnet wird nichts nach: Lücke und Befunde liefert der
 * Server (`abloesung::schichtplan::pruefung`, `frontend/src/kraefte/AGENTS.md`, „Schichtplan“).
 */

export const PAUSE = 'pause';
export const OHNE_ABSCHNITT = 'Ohne Abschnitt';

/** Schlüssel einer Zeile aus dem Posten eines Blocks oder einer Eingabe. */
export function postenSchluessel(p: {
  art: string;
  einheit_id?: number | null;
  uhs_id?: number | null;
}): string {
  if (p.art === 'einheit') return `einheit:${p.einheit_id}`;
  if (p.art === 'uhs') return `uhs:${p.uhs_id}`;
  return PAUSE;
}

/** Umkehr von {@link postenSchluessel}; Unbekanntes ist `null`. */
export function postenEingabe(schluessel: string): SchichtplanPostenEingabe | null {
  if (schluessel === PAUSE) return { art: 'pause' };
  const m = /^(einheit|uhs):(\d+)$/.exec(schluessel);
  if (!m) return null;
  const id = Number(m[2]);
  return m[1] === 'einheit' ? { art: 'einheit', einheit_id: id } : { art: 'uhs', uhs_id: id };
}

interface ZeilenQuellen {
  /** Ohne Freigabe des Moduls Einheiten `undefined`: dann nur Einheiten mit Blöcken. */
  einheiten?: readonly Einheit[];
  /** Ohne Freigabe des Moduls UHS `undefined`: dann nur UHS mit Blöcken. */
  uhs?: readonly Uhs[];
  /** Abschnitte in der Reihenfolge der Gliederung (die Vorgaben der Ablösung). */
  abschnitte: readonly Pick<AbloesungVorgabe, 'abschnitt_id' | 'abschnitt_name'>[];
  bloecke: readonly SchichtplanBlock[];
}

/**
 * Zeilen nach Abschnitt in der Reihenfolge der Gliederung, darin erst die Einheiten (auch
 * Untereinheiten, mit dem geerbten Abschnitt), dann die UHS; danach „Ohne Abschnitt“, zuletzt die
 * Pause. Aufgelöste Posten stehen nur, solange sie Blöcke tragen.
 */
export function baueZeilen({ einheiten, uhs, abschnitte, bloecke }: ZeilenQuellen): RasterZeile[] {
  const namen = new Map(abschnitte.map((a) => [a.abschnitt_id, a.abschnitt_name]));
  const geerbt = abschnittDerEinheit(einheiten ?? []);
  const jeAbschnitt = new Map<number | null, RasterZeile[]>();
  const gesehen = new Set<string>();
  const dazu = (abschnittId: number | null | undefined, zeile: Omit<RasterZeile, 'gruppe'>) => {
    if (gesehen.has(zeile.schluessel)) return;
    gesehen.add(zeile.schluessel);
    const id = abschnittId != null && namen.has(abschnittId) ? abschnittId : null;
    const gruppe = id != null ? (namen.get(id) ?? OHNE_ABSCHNITT) : OHNE_ABSCHNITT;
    const liste = jeAbschnitt.get(id) ?? [];
    liste.push({ ...zeile, gruppe });
    jeAbschnitt.set(id, liste);
  };
  for (const e of einheiten ?? []) {
    if (e.aufgeloest_at != null) continue;
    dazu(geerbt.get(e.id)?.id, {
      schluessel: postenSchluessel({ art: 'einheit', einheit_id: e.id }),
      titel: e.name,
    });
  }
  for (const u of uhs ?? []) {
    if (u.storniert_at != null || u.status === 'aufgeloest') continue;
    dazu(u.abschnitt_id, {
      schluessel: postenSchluessel({ art: 'uhs', uhs_id: u.id }),
      titel: u.bezeichnung,
    });
  }
  // Posten, die nur noch der Plan kennt (aufgelöst oder ohne Freigabe der Liste).
  const einheitAbschnitt = new Map((einheiten ?? []).map((e) => [e.id, geerbt.get(e.id)?.id]));
  const uhsAbschnitt = new Map((uhs ?? []).map((u) => [u.id, u.abschnitt_id]));
  for (const b of bloecke) {
    const p = b.posten;
    if (p.art === 'pause') continue;
    const titel = `${p.bezeichnung ?? (p.art === 'uhs' ? 'UHS' : 'Einheit')}${p.aufgeloest ? ' (aufgelöst)' : ''}`;
    const abschnitt =
      p.art === 'einheit'
        ? einheitAbschnitt.get(p.einheit_id ?? -1)
        : uhsAbschnitt.get(p.uhs_id ?? -1);
    dazu(abschnitt, { schluessel: postenSchluessel(p), titel });
  }
  const zeilen: RasterZeile[] = [];
  for (const a of abschnitte) zeilen.push(...(jeAbschnitt.get(a.abschnitt_id) ?? []));
  zeilen.push(...(jeAbschnitt.get(null) ?? []));
  zeilen.push({ schluessel: PAUSE, titel: 'Pause', gruppe: null, ueberlappungErlaubt: true });
  return zeilen;
}

// ── Ampel und Texte ──────────────────────────────────────────────────────────────────────────

const BEFUND_WORT: Record<SchichtplanBefund['art'], string> = {
  doppelt: 'doppelt verplant',
  quali: 'Qualifikation fehlt',
  dienst: 'zu lange im Dienst',
  verfuegbar: 'nicht verfügbar',
  abweichung: 'nicht am Posten',
};

/** Alle Befunde eines Blocks: die des Blocks und die seiner Personen, je Art einmal. */
export function befundArten(block: SchichtplanBlock): SchichtplanBefund['art'][] {
  const arten = new Set<SchichtplanBefund['art']>();
  for (const b of block.befunde) arten.add(b.art);
  for (const p of block.personen ?? []) for (const b of p.befunde) arten.add(b.art);
  return [...arten];
}

export function befundWort(art: SchichtplanBefund['art']): string {
  return BEFUND_WORT[art];
}

/**
 * Ampel mit Wort: ein Befund geht vor der Lücke, die Lücke vor „besetzt“. Die Pause ohne Befund und
 * ein Block ohne Soll haben keine Ampel, nur das Wort.
 */
export function ampelVon(block: SchichtplanBlock): { ampel: Ampel; wort: string } {
  const arten = befundArten(block);
  if (arten.length > 0) return { ampel: 'befund', wort: befundWort(arten[0]) };
  if (block.posten.art === 'pause') return { ampel: 'ohne-soll', wort: 'Pause' };
  if (block.offene_plaetze > 0) return { ampel: 'luecke', wort: `${block.offene_plaetze} offen` };
  if (block.soll_anzahl == null)
    return { ampel: 'ohne-soll', wort: block.personen_anzahl > 0 ? 'ohne Soll' : 'unbesetzt' };
  return { ampel: 'besetzt', wort: 'besetzt' };
}

/** Die Personen eines Blocks als Text; ohne Freigabe Personal nur die Zahl. */
export function personenText(block: SchichtplanBlock): string {
  if (block.personen == null)
    return block.personen_anzahl === 0
      ? 'unbesetzt'
      : `${block.personen_anzahl} ${block.personen_anzahl === 1 ? 'Person' : 'Personen'}`;
  return block.personen.length === 0 ? 'unbesetzt' : block.personen.map((p) => p.name).join(', ');
}

/**
 * Die Lücke wie im Konzept: „1 Platz offen, braucht Rettungssanitäter“. Ohne offene Plätze und
 * ohne offene Anforderung `null`.
 */
export function lueckeText(
  block: SchichtplanBlock,
  qualiNamen: ReadonlyMap<number, string>,
): string | null {
  if (block.offene_plaetze <= 0) return null;
  const plaetze = `${block.offene_plaetze} ${block.offene_plaetze === 1 ? 'Platz' : 'Plätze'} offen`;
  const braucht = block.offene_anforderungen
    .map(
      (a) =>
        `${a.fehlen > 1 ? `${a.fehlen} × ` : ''}${qualiNamen.get(a.qualifikation_id) ?? 'Qualifikation'}`,
    )
    .join(', ');
  return braucht ? `${plaetze}, braucht ${braucht}` : plaetze;
}

/** Ein Befund als Satzteil für den Blockdialog. */
export function befundText(
  befund: SchichtplanBefund,
  qualiNamen: ReadonlyMap<number, string>,
  wer?: string,
): string {
  const vorn = wer ? `${wer}: ` : '';
  switch (befund.art) {
    case 'quali':
      return `${vorn}${befund.fehlen ?? 1} × ${qualiNamen.get(befund.qualifikation_id ?? -1) ?? 'Qualifikation'} fehlt`;
    case 'dienst':
      return `${vorn}${formatDauer(befund.dauer_minuten ?? 0)} im Dienst`;
    default:
      return `${vorn}${befundWort(befund.art)}`;
  }
}

/** Ein Block des Servers als Block des Rasters. */
export function alsRasterBlock(block: SchichtplanBlock): RasterBlock {
  const { ampel, wort } = ampelVon(block);
  return {
    id: block.id,
    zeile: postenSchluessel(block.posten),
    von: alsZeitpunkt(block.von)?.valueOf() ?? 0,
    bis: alsZeitpunkt(block.bis)?.valueOf() ?? 0,
    text: personenText(block),
    ampel,
    ampelWort: wort,
  };
}

export function rasterBloecke(plan: Schichtplan | undefined): RasterBlock[] {
  return (plan?.bloecke ?? []).map(alsRasterBlock);
}

// ── Personen ─────────────────────────────────────────────────────────────────────────────────

export type PersonenGruppe = 'verfuegbar' | 'im-einsatz' | 'stamm' | 'helfer';

export const PERSONEN_GRUPPEN: { gruppe: PersonenGruppe; titel: string }[] = [
  { gruppe: 'verfuegbar', titel: 'Verfügbar' },
  { gruppe: 'im-einsatz', titel: 'Im Einsatz' },
  { gruppe: 'stamm', titel: 'Stamm' },
  { gruppe: 'helfer', titel: 'Helfer' },
];

export interface PersonOption {
  /** `stamm:<personal_id>`, `einsatz:<einsatz_personal_id>` oder `helfer:<id>`. */
  schluessel: string;
  name: string;
  gruppe: PersonenGruppe;
  eingabe: SchichtplanPersonEingabe;
}

/** Schlüssel einer Eingabe; Stamm-Personal gilt immer über `personal_id`. */
export function eingabeSchluessel(e: SchichtplanPersonEingabe): string {
  if (e.art === 'stamm') return `stamm:${e.personal_id}`;
  if (e.art === 'einsatz') return `einsatz:${e.einsatz_personal_id}`;
  return `helfer:${e.helfer_id}`;
}

/** Eine eingeteilte Person als Eingabe (für das Schreiben der ganzen Liste). */
export function personEingabe(p: SchichtplanPerson): SchichtplanPersonEingabe | null {
  if (p.personal_id != null) return { art: 'stamm', personal_id: p.personal_id };
  if (p.einsatz_personal_id != null)
    return { art: 'einsatz', einsatz_personal_id: p.einsatz_personal_id };
  if (p.helfer_id != null) return { art: 'helfer', helfer_id: p.helfer_id };
  return null;
}

export function blockPersonenEingaben(block: SchichtplanBlock): SchichtplanPersonEingabe[] {
  return (block.personen ?? []).flatMap((p) => {
    const e = personEingabe(p);
    return e ? [e] : [];
  });
}

/**
 * Wen man einteilen kann: wer im Einsatz ist (ohne Einheit und UHS „verfügbar“), das Stamm-Personal
 * im Dienst, das noch nicht im Einsatz ist, und die Helfer des Plans.
 */
export function personenOptionen(
  einsatzPersonal: readonly EinsatzPersonal[] | undefined,
  stamm: readonly Personal[] | undefined,
  helfer: readonly SchichtplanHelfer[] | null | undefined,
): PersonOption[] {
  const optionen: PersonOption[] = [];
  const imEinsatz = new Set<number>();
  for (const p of einsatzPersonal ?? []) {
    if (p.beendet_at != null) continue;
    if (p.personal_id != null) imEinsatz.add(p.personal_id);
    const eingabe: SchichtplanPersonEingabe =
      p.personal_id != null
        ? { art: 'stamm', personal_id: p.personal_id }
        : { art: 'einsatz', einsatz_personal_id: p.id };
    optionen.push({
      schluessel: eingabeSchluessel(eingabe),
      name: p.name,
      gruppe: p.einheit_id != null || p.uhs_id != null ? 'im-einsatz' : 'verfuegbar',
      eingabe,
    });
  }
  for (const p of stamm ?? []) {
    if (imEinsatz.has(p.id)) continue;
    const eingabe: SchichtplanPersonEingabe = { art: 'stamm', personal_id: p.id };
    optionen.push({
      schluessel: eingabeSchluessel(eingabe),
      name: p.name,
      gruppe: 'stamm',
      eingabe,
    });
  }
  for (const h of helfer ?? []) {
    const eingabe: SchichtplanPersonEingabe = { art: 'helfer', helfer_id: h.id };
    optionen.push({
      schluessel: eingabeSchluessel(eingabe),
      name: h.name,
      gruppe: 'helfer',
      eingabe,
    });
  }
  return optionen;
}

/**
 * Die Personenliste eines Blocks mit einer Person mehr; steht sie schon darin, `null` (dann gibt es
 * nichts zu schreiben).
 */
export function mitPerson(
  block: SchichtplanBlock,
  neu: SchichtplanPersonEingabe,
): SchichtplanPersonEingabe[] | null {
  const bisher = blockPersonenEingaben(block);
  const schluessel = eingabeSchluessel(neu);
  if (bisher.some((e) => eingabeSchluessel(e) === schluessel)) return null;
  return [...bisher, neu];
}

/**
 * Body der Kopie eines Blocks (LLH-1584) an einen anderen Posten oder eine andere Zeit (Wire):
 * gleiches Soll und Qualifikationssoll, die Personen nur mit `mitPersonen`, die Notiz nie (sie
 * gilt meist der Zeit des Originals). An der Pause gibt es kein Soll; kommt die Kopie aus der
 * Pause, fehlt das Soll und der Server nimmt die Vorgabe des Zielpostens.
 */
export function kopieBody(
  block: SchichtplanBlock,
  ziel: { posten: SchichtplanPostenEingabe; von: string; bis: string },
  mitPersonen: boolean,
): SchichtplanBlockBody {
  const body: SchichtplanBlockBody = { posten: ziel.posten, von: ziel.von, bis: ziel.bis };
  if (ziel.posten.art === 'pause') body.soll_anzahl = null;
  else if (block.posten.art !== 'pause') {
    body.soll_anzahl = block.soll_anzahl ?? null;
    body.quali_soll = block.quali_soll ? qualiSollEingabe(block.quali_soll) : null;
  }
  const personen = mitPersonen ? blockPersonenEingaben(block) : [];
  if (personen.length > 0) body.personen = personen;
  return body;
}

/** Posten eines gelesenen Blocks als Eingabe. */
function postenVon(block: SchichtplanBlock): SchichtplanPostenEingabe | null {
  return postenEingabe(postenSchluessel(block.posten));
}

/**
 * „Als nächsten Block kopieren“ (LLH-1584): derselbe Posten, Beginn am Ende des Blocks, gleiche
 * Dauer, ohne Personen (der Folgeblock ist die Ablösung, Abstimmung 08.11.2026).
 */
export function naechsterBlockBody(block: SchichtplanBlock): SchichtplanBlockBody | null {
  const posten = postenVon(block);
  const von = alsZeitpunkt(block.von);
  const bis = alsZeitpunkt(block.bis);
  if (!posten || !von || !bis) return null;
  const dauer = bis.valueOf() - von.valueOf();
  return kopieBody(
    block,
    { posten, von: block.bis, bis: alsBackendZeit(bis.add(dauer, 'millisecond')) },
    false,
  );
}
