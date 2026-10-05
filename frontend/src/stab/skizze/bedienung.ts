import type { SkizzenBezug } from '../../api/fernmeldeskizzeVertrag';
import type { Fernmeldenetz, NetzBaumKnoten, Rechtsquelle } from '../fernmeldeskizze';
import { bedingungszeichenText } from '../skizzenZeichen';
import { SCHRIFTFELD, stichSchluessel, stichleitungen } from './ebenen';

/**
 * Bedienung der Fernmeldeskizze ohne Zeiger (LFH-893 D6, D8), rein: Fokusfolge, Tasten,
 * Rechte je Element und die Ziele von „Verbinden mit …“. Die Fläche ruft nur diese Funktionen;
 * Tests in `bedienung.test.ts` belegen die Spec-Szenarien „Zuordnen mit der Tastatur“,
 * „Verschieben mit Pfeiltasten“, „Nur Leserecht“, „Recht auf Stab, nicht auf Einheiten“ und
 * „Mobil“ auf dieser Ebene.
 */

// ── Fokusfolge ─────────────────────────────────────────────────────────────────────────────

/**
 * Tab-Folge der Elemente (D6): Führungsstelle und Baum der Führungsorganisation, je Stelle direkt
 * danach ihre Stichleitungen (damit Entf an einer Stichleitung ohne Zeiger geht), dann Schienen,
 * externe Stellen, Komponenten (je mit Stichleitungen), Verbindungen, Bereiche, Schriftfeld.
 */
export function fokusfolge(netz: Fernmeldenetz): string[] {
  const stiche = stichleitungen(netz);
  const mitStichen = (key: string) => [
    key,
    ...stiche.filter((s) => s.stelle === key).map((s) => s.key),
  ];
  const baum: string[] = [];
  const geh = (k: NetzBaumKnoten) => {
    if (k.key !== 'sammel') baum.push(k.key);
    for (const c of k.kinder) geh(c);
  };
  for (const w of netz.baum) geh(w);
  const vorhanden = new Set(netz.stellen.map((s) => s.key));
  const art = (a: string) => netz.stellen.filter((s) => s.art === a).map((s) => s.key);
  return [
    ...(vorhanden.has('fs') ? mitStichen('fs') : []),
    ...baum.filter((k) => vorhanden.has(k)).flatMap(mitStichen),
    ...netz.schienen.map((s) => s.key),
    ...art('extern').flatMap(mitStichen),
    ...art('komponente').flatMap(mitStichen),
    ...netz.verbindungen.map((v) => v.key),
    ...netz.bereiche.map((b) => b.key),
    SCHRIFTFELD,
  ];
}

/** Das nächste Element in Tab-Richtung; `null` an den Enden (der Fokus verlässt die Fläche). */
export function naechsterFokus(
  folge: readonly string[],
  aktuell: string | null,
  richtung: 1 | -1,
): string | null {
  const i = aktuell == null ? -1 : folge.indexOf(aktuell);
  if (i < 0) return folge.length > 0 ? folge[richtung === 1 ? 0 : folge.length - 1] : null;
  return folge[i + richtung] ?? null;
}

// ── Tasten ─────────────────────────────────────────────────────────────────────────────────

export type TastenBefehl =
  | { art: 'verschiebe'; dx: number; dy: number }
  | { art: 'groesse'; dx: number; dy: number }
  | { art: 'oeffne' }
  | { art: 'verbinden' }
  | { art: 'entferne' }
  | { art: 'rueckgaengig' }
  | { art: 'wiederholen' }
  | { art: 'wandere'; richtung: 1 | -1 }
  | { art: 'abwaehlen' }
  | { art: 'menue' }
  | { art: 'zoom'; richtung: 1 | -1 }
  | { art: 'einpassen' };

/** Rasterfelder je Pfeiltaste mit Umschalt. */
export const GROSSER_SCHRITT = 5;

const PFEILE: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

export interface Taste {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Die Bedeutung einer Taste auf der Fläche; `null` = nicht unsere. */
export function tastenBefehl(e: Taste): TastenBefehl | null {
  const strg = e.ctrlKey || e.metaKey;
  const taste = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (strg) {
    if (taste === 'z') return e.shiftKey ? { art: 'wiederholen' } : { art: 'rueckgaengig' };
    if (taste === 'y') return { art: 'wiederholen' };
    return null;
  }
  const pfeil = PFEILE[e.key];
  if (pfeil) {
    if (e.altKey) return { art: 'groesse', dx: pfeil[0], dy: pfeil[1] };
    const n = e.shiftKey ? GROSSER_SCHRITT : 1;
    return { art: 'verschiebe', dx: pfeil[0] * n, dy: pfeil[1] * n };
  }
  if (e.altKey) return null;
  switch (taste) {
    case 'Enter':
      return { art: 'oeffne' };
    case 'v':
      return { art: 'verbinden' };
    case 'Delete':
    case 'Backspace':
      return { art: 'entferne' };
    case 'Tab':
      return { art: 'wandere', richtung: e.shiftKey ? -1 : 1 };
    case 'Escape':
      return { art: 'abwaehlen' };
    case 'ContextMenu':
      return { art: 'menue' };
    case 'F10':
      return e.shiftKey ? { art: 'menue' } : null;
    case '+':
    case '=':
      return { art: 'zoom', richtung: 1 };
    case '-':
      return { art: 'zoom', richtung: -1 };
    case '0':
      return { art: 'einpassen' };
    default:
      return null;
  }
}

// ── Rechte (D8) ────────────────────────────────────────────────────────────────────────────

export interface Bedienkontext {
  /** Die Seite hat Schreibwege übergeben (Schreibrecht im Einsatz). */
  aktionen: boolean;
  /** Schmaler als `md`: nur lesen, zoomen, hervorheben. */
  mobil: boolean;
}

const RECHT_WORT: Record<Rechtsquelle, string> = {
  einsatzabschnitte: 'Abschnitte',
  einheiten: 'Einheiten',
  verwaltung: 'Einsatzverwaltung',
  stab: 'Stab',
};

/** Wortlaut für ein fehlendes Recht, z. B. „Einheiten: kein Schreibrecht“. */
export function rechtGrund(recht: Rechtsquelle): string {
  return `${RECHT_WORT[recht]}: kein Schreibrecht`;
}

function flaechenGrund(k: Bedienkontext): string | null {
  if (!k.aktionen) return 'Kein Schreibrecht im Einsatz';
  if (k.mobil) return 'Am schmalen Bildschirm nur lesen';
  return null;
}

/**
 * Warum ein Element keinen Griff zum Zuordnen und Ändern am Datensatz bietet; `null` = es bietet
 * einen. Schienen, Verbindungen, Bereiche und Schriftfeld sind Skizzeneigenes (Stab).
 */
export function griffGrund(netz: Fernmeldenetz, key: string, k: Bedienkontext): string | null {
  const flaeche = flaechenGrund(k);
  if (flaeche) return flaeche;
  const stelle = netz.stellen.find((s) => s.key === key);
  if (stelle) return stelle.schreibbar ? null : rechtGrund(stelle.recht);
  return netz.rechte.stab === true ? null : rechtGrund('stab');
}

/** Warum nichts verschoben, angelegt oder entfernt werden kann (Skizzeneigenes braucht Stab). */
export function lageGrund(netz: Fernmeldenetz, k: Bedienkontext): string | null {
  return flaechenGrund(k) ?? (netz.rechte.stab === true ? null : rechtGrund('stab'));
}

// ── „Verbinden mit …“ ───────────────────────────────────────────────────────────────────────

export interface VerbindenZiel {
  /** `sg-<id>` oder Stellenschlüssel. */
  key: string;
  art: 'schiene' | 'stelle';
  /** Sprechgruppen-ID bei Schienen. */
  sprechgruppeId: number | null;
  label: string;
  /** Zweite Zeile: Rufname, Herkunft. */
  zusatz: string | null;
}

/**
 * Die Ziele von „Verbinden mit …“ für eine Stelle: zuerst Sprechgruppen (zuordnen; ohne die
 * schon zugeordneten, auch Katalog-Einträge ohne Schiene), dann Stellen (Punkt-zu-Punkt; ohne
 * die Stelle selbst). Schienen nur mit Recht am Datensatz der Stelle, Stellen nur mit Recht auf
 * den Stab (D8). Gesucht wird ohne Groß-/Kleinschreibung in Zeichen, Bezeichnung und Rufname.
 */
export function verbindenZiele(
  netz: Fernmeldenetz,
  quelle: string,
  suche: string,
): VerbindenZiel[] {
  const von = netz.stellen.find((s) => s.key === quelle);
  if (!von) return [];
  const begriff = suche.trim().toLowerCase();
  const passt = (...texte: (string | null | undefined)[]) =>
    begriff === '' || texte.some((t) => t?.toLowerCase().includes(begriff));

  const zugeordnet = new Set(
    stichleitungen(netz)
      .filter((s) => s.stelle === quelle)
      .map((s) => s.schiene),
  );
  const schienen: VerbindenZiel[] = von.schreibbar
    ? netz.sprechgruppen
        .filter((s) => !zugeordnet.has(`sg-${s.id}`))
        .map((s) => ({
          key: `sg-${s.id}`,
          art: 'schiene' as const,
          sprechgruppeId: s.id,
          label: bedingungszeichenText(s.betriebsart, s.bezeichnung),
          zusatz: s.einsatz_lokal ? 'einsatzlokal' : null,
        }))
        .filter((z) => passt(z.label))
    : [];
  const stellen: VerbindenZiel[] =
    netz.rechte.stab === true
      ? netz.stellen
          .filter((s) => s.key !== quelle && passt(s.bezeichnung, s.rufname))
          .map((s) => ({
            key: s.key,
            art: 'stelle' as const,
            sprechgruppeId: null,
            label: s.bezeichnung,
            zusatz: s.rufname,
          }))
      : [];
  return [...schienen, ...stellen];
}

/** Die Stichleitung einer Stelle an einer Schiene, falls es sie gibt. */
export function stichVon(netz: Fernmeldenetz, schiene: string, stelle: string): string | null {
  const s = netz.schienen.find((x) => x.key === schiene);
  return s?.teilnehmer.some((t) => t.element === stelle) ? stichSchluessel(schiene, stelle) : null;
}

const BEZUG_ART = {
  ab: 'abschnitt',
  eh: 'einheit',
  ks: 'stelle',
  ko: 'komponente',
} as const;

/** Der Skizzen-Bezug (D3) eines Stellenschlüssels; Umkehrung von `bezugSchluessel`. */
export function bezugAus(key: string): SkizzenBezug | null {
  if (key === 'fs') return { art: 'fuehrungsstelle', id: null };
  const m = /^(ab|eh|ks|ko)-(\d+)$/.exec(key);
  return m ? { art: BEZUG_ART[m[1] as keyof typeof BEZUG_ART], id: Number(m[2]) } : null;
}

/** Die Sprechgruppen-ID einer Schiene `sg-<id>`. */
export function schienenId(key: string): number | null {
  const m = /^sg-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}
