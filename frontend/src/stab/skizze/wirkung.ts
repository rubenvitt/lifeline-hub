import type { Verbindungsart, Verbindungsmedium } from '../../api/fernmeldeskizzeVertrag';
import type { Fernmeldenetz } from '../fernmeldeskizze';
import { RASTER, type Platz } from '../fernmeldeskizzeLayout';
import type { BereichsFelder, VerbindungsFelder } from '../skizzenAktionen';
import {
  griffGrund,
  lageGrund,
  rechtGrund,
  schienenId,
  type Bedienkontext,
  type TastenBefehl,
} from './bedienung';
import type { Punkt } from './ansicht';
import { teileStichSchluessel } from './ebenen';
import {
  LOESE_ABSTAND,
  abstandZurSchiene,
  aufRaster,
  schieneAn,
  schienenLageAb,
  stelleAn,
} from './geometrie';

/**
 * Was ein Ziehen oder eine Taste an einem Element bewirkt (LFH-893 D4–D8), rein: die Fläche
 * meldet Ziehquelle, Endpunkt und Weg in Skizzeneinheiten, diese Datei entscheidet, welcher
 * Schreibweg folgt. Getroffen wird über die Geometrie (`geometrie.ts`), nicht über die
 * Droppables von dnd-kit, damit die Entscheidung ohne Browser-Layout prüfbar ist.
 */

/** Was gezogen wird; die dnd-kit-ID ist `<art>:<key>`. */
export type ZiehDaten =
  | { art: 'stelle'; key: string }
  | { art: 'schiene'; key: string }
  /** Der Anschlusspunkt einer Stelle: auf eine Schiene (zuordnen) oder Stelle (verbinden). */
  | { art: 'anschluss'; key: string }
  | { art: 'stich'; key: string; schiene: string; stelle: string }
  | { art: 'bereich'; key: string }
  /** Die Ecke unten rechts eines Bereichs: Größe. */
  | { art: 'ecke'; key: string }
  | { art: 'palette'; sprechgruppeId: number }
  /** Nicht ziehbar (Verbindung, Schriftfeld): nur Wahl und Fokus. */
  | { art: 'fest'; key: string };

export interface Lage {
  x: number;
  y: number;
  breite?: number | null;
}

export type Wirkung =
  | { art: 'nichts' }
  /** Ohne Recht: der Grund steht am Element, statt dass still nichts geschieht. */
  | { art: 'abgelehnt'; element: string; grund: string }
  | { art: 'verschiebe'; key: string; ziel: Lage; vorher: Lage }
  /** Erste Lage einer Schiene aus der Palette (es gibt noch keine, die zurückkäme). */
  | { art: 'schieneSetzen'; key: string; ziel: Lage }
  | { art: 'bereich'; key: string; felder: BereichsFelder }
  | { art: 'zuordnen'; stelle: string; sprechgruppeId: number }
  | { art: 'loese'; stelle: string; sprechgruppeId: number }
  /** Punkt-zu-Punkt: die Seite fragt noch nach der Art (Menü, D6). */
  | { art: 'verbinden'; von: string; nach: string }
  | { art: 'entferneVerbindung'; key: string }
  /** Ganz zurücknehmbar (Rückgängig legt ihn gleich wieder an): ohne Rückfrage. */
  | { art: 'entferneBereich'; key: string }
  /** Nicht ganz zurücknehmbar (Komponente: ihre Verbindungen fallen weg): erst nach Rückfrage. */
  | { art: 'frage'; key: string };

export interface Ablage {
  daten: ZiehDaten;
  /** Endpunkt des Zeigers in Skizzeneinheiten; `null` außerhalb der Fläche. */
  ende: Punkt | null;
  /** Weg des Zeigers in Skizzeneinheiten. */
  weg: Punkt;
}

/** Kleinste Seite eines Bereichs. */
export const BEREICH_MIN = 8 * RASTER;

const NICHTS: Wirkung = { art: 'nichts' };

type Plaetze = ReadonlyMap<string, Platz>;

/** Neue Lage aus alter Lage und Weg: auf dem Raster, nie links oder oberhalb von 0. */
function versetzt(p: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
  return { x: Math.max(0, aufRaster(p.x + dx)), y: Math.max(0, aufRaster(p.y + dy)) };
}

function verschiebe(
  netz: Fernmeldenetz,
  plaetze: Plaetze,
  key: string,
  dx: number,
  dy: number,
): Wirkung {
  const p = plaetze.get(key);
  if (!p) return NICHTS;
  const ziel = versetzt(p, dx, dy);
  if (ziel.x === p.x && ziel.y === p.y) return NICHTS;
  const breite = netz.lage.get(key)?.breite;
  const mitBreite = breite != null ? { breite } : {};
  return {
    art: 'verschiebe',
    key,
    ziel: { ...ziel, ...mitBreite },
    vorher: { x: p.x, y: p.y, ...mitBreite },
  };
}

function bereichVerschieben(netz: Fernmeldenetz, key: string, dx: number, dy: number): Wirkung {
  const b = netz.bereiche.find((x) => x.key === key);
  if (!b) return NICHTS;
  const ziel = versetzt(b, dx, dy);
  if (ziel.x === b.x && ziel.y === b.y) return NICHTS;
  return { art: 'bereich', key, felder: ziel };
}

function bereichGroesse(netz: Fernmeldenetz, key: string, dx: number, dy: number): Wirkung {
  const b = netz.bereiche.find((x) => x.key === key);
  if (!b) return NICHTS;
  const breite = Math.max(BEREICH_MIN, aufRaster(b.breite + dx));
  const hoehe = Math.max(BEREICH_MIN, aufRaster(b.hoehe + dy));
  if (breite === b.breite && hoehe === b.hoehe) return NICHTS;
  return { art: 'bereich', key, felder: { breite, hoehe } };
}

function haengtAn(netz: Fernmeldenetz, stelle: string, schiene: string): boolean {
  return (
    netz.schienen.find((s) => s.key === schiene)?.teilnehmer.some((t) => t.element === stelle) ??
    false
  );
}

/** Zuordnen, sofern die Stelle noch nicht an der Schiene hängt und das Recht da ist. */
function zuordnen(
  netz: Fernmeldenetz,
  kontext: Bedienkontext,
  stelle: string,
  schiene: string,
): Wirkung | null {
  if (haengtAn(netz, stelle, schiene)) return null;
  const id = schienenId(schiene);
  if (id == null) return null;
  const grund = griffGrund(netz, stelle, kontext);
  return grund
    ? { art: 'abgelehnt', element: stelle, grund }
    : { art: 'zuordnen', stelle, sprechgruppeId: id };
}

function loese(
  netz: Fernmeldenetz,
  kontext: Bedienkontext,
  stelle: string,
  schiene: string,
): Wirkung {
  const id = schienenId(schiene);
  if (id == null || !haengtAn(netz, stelle, schiene)) return NICHTS;
  const grund = griffGrund(netz, stelle, kontext);
  return grund
    ? { art: 'abgelehnt', element: stelle, grund }
    : { art: 'loese', stelle, sprechgruppeId: id };
}

/** Ohne Recht auf Lage und Skizzeneigenes: abgelehnt, sonst `null`. */
function ohneLage(netz: Fernmeldenetz, kontext: Bedienkontext, element: string): Wirkung | null {
  const grund = lageGrund(netz, kontext);
  return grund ? { art: 'abgelehnt', element, grund } : null;
}

/** Die Wirkung eines beendeten Ziehens. */
export function ablageWirkung(
  netz: Fernmeldenetz,
  plaetze: Plaetze,
  kontext: Bedienkontext,
  { daten, ende, weg }: Ablage,
): Wirkung {
  const schienen = netz.schienen.map((s) => s.key);
  switch (daten.art) {
    case 'stelle': {
      const schiene = ende ? schieneAn(schienen, plaetze, ende) : null;
      const zu = schiene ? zuordnen(netz, kontext, daten.key, schiene) : null;
      if (zu) return zu;
      return (
        ohneLage(netz, kontext, daten.key) ?? verschiebe(netz, plaetze, daten.key, weg.x, weg.y)
      );
    }
    case 'schiene':
      return (
        ohneLage(netz, kontext, daten.key) ?? verschiebe(netz, plaetze, daten.key, weg.x, weg.y)
      );
    case 'anschluss': {
      if (!ende) return NICHTS;
      const schiene = schieneAn(schienen, plaetze, ende);
      if (schiene) return zuordnen(netz, kontext, daten.key, schiene) ?? NICHTS;
      const nach = stelleAn(
        netz.stellen.map((s) => s.key),
        plaetze,
        ende,
        daten.key,
      );
      if (!nach) return NICHTS;
      return netz.rechte.stab === true
        ? { art: 'verbinden', von: daten.key, nach }
        : { art: 'abgelehnt', element: daten.key, grund: rechtGrund('stab') };
    }
    case 'stich': {
      const platz = plaetze.get(daten.schiene);
      if (!platz) return NICHTS;
      if (ende && abstandZurSchiene(ende, platz) <= LOESE_ABSTAND) return NICHTS;
      return loese(netz, kontext, daten.stelle, daten.schiene);
    }
    case 'bereich':
      return (
        ohneLage(netz, kontext, daten.key) ?? bereichVerschieben(netz, daten.key, weg.x, weg.y)
      );
    case 'ecke':
      return ohneLage(netz, kontext, daten.key) ?? bereichGroesse(netz, daten.key, weg.x, weg.y);
    case 'palette': {
      if (!ende) return NICHTS;
      const key = `sg-${daten.sprechgruppeId}`;
      const abgelehnt = ohneLage(netz, kontext, key);
      if (abgelehnt) return abgelehnt;
      const lage = schienenLageAb(ende);
      const ziel = { x: Math.max(0, lage.x), y: Math.max(0, lage.y) };
      const p = plaetze.get(key);
      if (!p) return { art: 'schieneSetzen', key, ziel };
      return verschiebe(netz, plaetze, key, ziel.x - p.x, ziel.y - p.y);
    }
    case 'fest':
      return NICHTS;
  }
}

/** Die Wirkung einer Taste, die am Element etwas schreibt (Pfeile, Alt+Pfeile, Entf). */
export function tastenWirkung(
  netz: Fernmeldenetz,
  plaetze: Plaetze,
  kontext: Bedienkontext,
  befehl: TastenBefehl,
  key: string,
): Wirkung {
  const istBereich = netz.bereiche.some((b) => b.key === key);
  const stich = teileStichSchluessel(key);
  switch (befehl.art) {
    case 'verschiebe': {
      const dx = befehl.dx * RASTER;
      const dy = befehl.dy * RASTER;
      if (istBereich) return ohneLage(netz, kontext, key) ?? bereichVerschieben(netz, key, dx, dy);
      const beweglich =
        netz.stellen.some((s) => s.key === key) || netz.schienen.some((s) => s.key === key);
      if (!beweglich) return NICHTS;
      return ohneLage(netz, kontext, key) ?? verschiebe(netz, plaetze, key, dx, dy);
    }
    case 'groesse':
      if (!istBereich) return NICHTS;
      return (
        ohneLage(netz, kontext, key) ??
        bereichGroesse(netz, key, befehl.dx * RASTER, befehl.dy * RASTER)
      );
    case 'entferne': {
      if (stich) return loese(netz, kontext, stich.stelle, stich.schiene);
      if (netz.verbindungen.some((v) => v.key === key)) {
        return ohneLage(netz, kontext, key) ?? { art: 'entferneVerbindung', key };
      }
      if (istBereich) return ohneLage(netz, kontext, key) ?? { art: 'entferneBereich', key };
      const komponente = netz.stellen.some((s) => s.key === key && s.art === 'komponente');
      if (komponente) return ohneLage(netz, kontext, key) ?? { art: 'frage', key };
      return NICHTS;
    }
    default:
      return NICHTS;
  }
}

/**
 * Medium einer neuen Verbindung, bis jemand es im Paneel ändert: Funk nur, wo die Art Funk ist
 * (Richtfunk, Satellit); alles andere glatt.
 */
export function vorgabeMedium(art: Verbindungsart): Verbindungsmedium {
  return art === 'richtfunk' || art === 'satellit' ? 'funk' : 'leitung';
}

/** Die Felder einer neu angelegten Verbindung aus der Artwahl. */
export function neueVerbindung(art: Verbindungsart): VerbindungsFelder {
  return { art, medium: vorgabeMedium(art), status: 'bestehend' };
}
