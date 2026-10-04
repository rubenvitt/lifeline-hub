import type { AbrufZustand } from '../api/abrufZustand';
import type {
  Einheit,
  EinsatzFahrzeug,
  EinsatzPersonal,
  Einsatzabschnitt,
  Sprechgruppe,
} from '../api/types';
import { kommunikationsmittelLabel, teileSprechgruppen } from '../components/kommunikationsmittel';
import {
  FUEHRUNGSSTELLE_STELLE,
  fuehrungsstelleErfasst,
  type FuehrungsstelleQuelle,
} from './fuehrungsstelle';
import {
  abschnitteOhneSprechgruppe,
  einheitenOhneErreichbarkeit,
  einheitenOhneSprechgruppe,
  lokaleSprechgruppenOhneZuordnung,
  verbindungenOhneGemeinsameSprechgruppe,
  type Luecke,
  type Quelle,
  type Verbindung,
} from './luecken';

/**
 * Der Funkplan des Sachgebiets S6 (FwDV 100 Anlage 5, LFH-548) als reine Ableitung aus den
 * geladenen Listen. Keine eigene Datenhaltung: was hier steht, steht so an Abschnitt, Einheit,
 * Fahrzeug und Personal (Migrationen 0047/0073/0086) und an der eigenen Führungsstelle (0145).
 *
 * Herleitung: `openspec/changes/archive/2026-09-30-lfh-548-funkplan/design.md` (D3, D6),
 * Führungsstelle: `openspec/changes/archive/2026-10-04-lfh-849-eigene-fuehrungsstelle/design.md` (D4).
 */

export type FunkplanArt = 'fuehrungsstelle' | 'abschnitt' | 'einheit' | 'fahrzeug' | 'sammel';

/** Leiter/Führer einer Zeile. `zustand`: die Quelle fehlt, es ist KEIN leerer Bestand. */
export type Leitung =
  | { art: 'name'; namen: string[] }
  | { art: 'leer' }
  | { art: 'zustand'; zustand: Exclude<AbrufZustand, 'daten'> };

/**
 * Eine Zeile des Baums. EIN Typ für alle Ebenen, weil `Datensicht.baum` Kinder desselben Typs
 * verlangt (`KinderFeld<T>`); `art` unterscheidet.
 */
export interface FunkplanZeile {
  /** Über alle Ebenen eindeutig: `fs`, `ab-<id>`, `eh-<id>`, `fz-<id>`, `sammel`. */
  key: string;
  art: FunkplanArt;
  /** Datenbank-ID der Quelle — nur für Deeplinks, nie für die Anzeige. */
  id: number | null;
  /** Menschenlesbare Kennung: Name bzw. beim Fahrzeug der Funkrufname. */
  stelle: string;
  /** Beim Fahrzeug der Fahrzeugtyp, sonst `null`. */
  stelleZusatz: string | null;
  /**
   * Führungsstelle: Rufname · Abschnitt: Kurzbezeichnung · Einheit: Funkrufname · Fahrzeug: OPTA.
   * Nie geraten.
   */
  rufname: string | null;
  leitung: Leitung;
  tmo: string[];
  dmo: string[];
  /** Bereits als Label. */
  kommunikationsmittel: string | null;
  /** Personenbezogen: nur Anzeige und Druck, nie Lagebericht (D5). */
  erreichbarkeit: string | null;
  children?: FunkplanZeile[];
}

export interface FunkplanQuellen {
  abschnitte: Quelle<Einsatzabschnitt>;
  einheiten: Quelle<Einheit>;
  fahrzeuge: Quelle<EinsatzFahrzeug>;
  personal: Quelle<EinsatzPersonal>;
  sprechgruppen: Quelle<Sprechgruppe>;
  /** Die eigene Führungsstelle (LFH-849): eine Angabe, keine Liste. */
  fuehrungsstelle: FuehrungsstelleQuelle;
}

export const SAMMEL_STELLE = 'Ohne Abschnitt / Einheit';

function leitungAus(name: string | null | undefined): Leitung {
  return name ? { art: 'name', namen: [name] } : { art: 'leer' };
}

function funk(sprechgruppen: readonly Sprechgruppe[]): Pick<FunkplanZeile, 'tmo' | 'dmo'> {
  const { tmo, dmo } = teileSprechgruppen(sprechgruppen);
  return { tmo: tmo.map((s) => s.bezeichnung), dmo: dmo.map((s) => s.bezeichnung) };
}

function mitKindern(zeile: FunkplanZeile, kinder: FunkplanZeile[]): FunkplanZeile {
  // Ohne Kinder KEIN leeres Feld: antd zeichnet sonst einen Aufklapppfeil ins Leere.
  return kinder.length > 0 ? { ...zeile, children: kinder } : zeile;
}

function gruppiere<T, K>(liste: readonly T[], schluessel: (x: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of liste) {
    const k = schluessel(x);
    const bisher = m.get(k);
    if (bisher) bisher.push(x);
    else m.set(k, [x]);
  }
  return m;
}

/** Die Zeile der eigenen Führungsstelle — nur, wenn sie geladen und erfasst ist (D4). */
function fuehrungsstelleZeile(q: FuehrungsstelleQuelle): FunkplanZeile | null {
  const fs = q.zustand === 'daten' ? q.daten : null;
  if (!fs || !fuehrungsstelleErfasst(fs)) return null;
  return {
    key: 'fs',
    art: 'fuehrungsstelle',
    id: null,
    stelle: FUEHRUNGSSTELLE_STELLE,
    stelleZusatz: null,
    rufname: fs.rufname ?? null,
    // Wer die Führungsstelle besetzt, steht in der Besetzung des Stabs, nicht hier.
    leitung: { art: 'leer' },
    ...funk(fs.sprechgruppen),
    kommunikationsmittel: kommunikationsmittelLabel(fs.kommunikationsmittel),
    erreichbarkeit: fs.erreichbarkeit ?? null,
  };
}

export function baueFunkplan(q: FunkplanQuellen): FunkplanZeile[] {
  const abschnitteDa = q.abschnitte.zustand === 'daten';
  const einheitenDa = q.einheiten.zustand === 'daten';
  const fahrzeugeDa = q.fahrzeuge.zustand === 'daten';
  const abschnitte = abschnitteDa ? q.abschnitte.daten : [];
  const einheiten = einheitenDa ? q.einheiten.daten : [];
  const fahrzeuge = fahrzeugeDa ? q.fahrzeuge.daten : [];

  // ── Fahrzeugführer: Besatzung mit Position „Führer“ (Migration 0072) ─────────────────────────
  const fuehrerJeFahrzeug = gruppiere(
    q.personal.zustand === 'daten'
      ? q.personal.daten.filter((p) => p.fahrzeug_id != null && p.staerke_position === 'fuehrer')
      : [],
    (p) => p.fahrzeug_id!,
  );
  const fahrzeugLeitung = (ef: EinsatzFahrzeug): Leitung => {
    if (q.personal.zustand !== 'daten') return { art: 'zustand', zustand: q.personal.zustand };
    const namen = (fuehrerJeFahrzeug.get(ef.id) ?? []).map((p) => p.name);
    return namen.length > 0 ? { art: 'name', namen } : { art: 'leer' };
  };

  const fahrzeugZeile = (ef: EinsatzFahrzeug): FunkplanZeile => ({
    key: `fz-${ef.id}`,
    art: 'fahrzeug',
    id: ef.id,
    stelle: ef.funkrufname,
    stelleZusatz: ef.fahrzeugtyp ?? null,
    rufname: ef.opta ?? null,
    leitung: fahrzeugLeitung(ef),
    tmo: [],
    dmo: [],
    kommunikationsmittel: null,
    erreichbarkeit: null,
  });

  // ── Einheiten: Untereinheiten unter ihrer Einheit, Fahrzeuge unter ihrer Einheit ─────────────
  const einheitIds = new Set(einheiten.map((e) => e.id));
  const fahrzeugeJeEinheit = gruppiere(
    fahrzeuge.filter((f) => f.einheit_id != null && einheitIds.has(f.einheit_id)),
    (f) => f.einheit_id!,
  );
  const istUntereinheit = (e: Einheit) =>
    e.ueber_einheit_id != null && einheitIds.has(e.ueber_einheit_id);
  const untereinheiten = gruppiere(einheiten.filter(istUntereinheit), (e) => e.ueber_einheit_id!);

  const einheitZeile = (e: Einheit): FunkplanZeile =>
    mitKindern(
      {
        key: `eh-${e.id}`,
        art: 'einheit',
        id: e.id,
        stelle: e.name,
        stelleZusatz: null,
        rufname: e.funkrufname ?? null,
        leitung: leitungAus(e.fuehrer_name),
        ...funk(e.sprechgruppen),
        kommunikationsmittel: kommunikationsmittelLabel(e.kommunikationsmittel),
        erreichbarkeit: e.erreichbarkeit ?? null,
      },
      [
        ...(untereinheiten.get(e.id) ?? []).map(einheitZeile),
        ...(fahrzeugeJeEinheit.get(e.id) ?? []).map(fahrzeugZeile),
      ],
    );

  // ── Abschnitte: Waisen-Promotion wie `baueKraeftebild` ───────────────────────────────────────
  const abschnittIds = new Set(abschnitte.map((a) => a.id));
  const istUnterabschnitt = (a: Einsatzabschnitt) =>
    a.ueber_abschnitt_id != null && abschnittIds.has(a.ueber_abschnitt_id);
  const unterabschnitte = gruppiere(
    abschnitte.filter(istUnterabschnitt),
    (a) => a.ueber_abschnitt_id!,
  );
  const obersteEinheiten = einheiten.filter((e) => !istUntereinheit(e));
  const einheitenJeAbschnitt = gruppiere(
    obersteEinheiten.filter((e) => e.abschnitt_id != null && abschnittIds.has(e.abschnitt_id)),
    (e) => e.abschnitt_id!,
  );

  const abschnittZeile = (a: Einsatzabschnitt): FunkplanZeile =>
    mitKindern(
      {
        key: `ab-${a.id}`,
        art: 'abschnitt',
        id: a.id,
        stelle: a.name,
        stelleZusatz: null,
        rufname: a.kurzbezeichnung ?? null,
        leitung: leitungAus(a.leiter_name),
        // Aus den Zuordnungen (0073), nie aus `sprechgruppe_tmo/_dmo` (0047, eingefroren).
        ...funk(a.sprechgruppen),
        kommunikationsmittel: kommunikationsmittelLabel(a.kommunikationsmittel),
        erreichbarkeit: a.erreichbarkeit ?? null,
      },
      [
        ...(unterabschnitte.get(a.id) ?? []).map(abschnittZeile),
        ...(einheitenJeAbschnitt.get(a.id) ?? []).map(einheitZeile),
      ],
    );

  // ── Wurzeln und Sammelknoten ─────────────────────────────────────────────────────────────────
  // Fehlt eine ganze Ebene (gesperrt/nicht geladen), rücken ihre Kinder an die Wurzel: sie sind
  // nicht heimatlos, ihre Heimat ist nur nicht sichtbar. Den Grund nennt die Seite oberhalb.
  const wurzeln: FunkplanZeile[] = abschnitte
    .filter((a) => !istUnterabschnitt(a))
    .map(abschnittZeile);
  const heimatlos: FunkplanZeile[] = [];

  const einheitenOhneAbschnitt = obersteEinheiten.filter(
    (e) => e.abschnitt_id == null || !abschnittIds.has(e.abschnitt_id),
  );
  (abschnitteDa ? heimatlos : wurzeln).push(...einheitenOhneAbschnitt.map(einheitZeile));

  const fahrzeugeOhneEinheit = fahrzeuge.filter(
    (f) => f.einheit_id == null || !einheitIds.has(f.einheit_id),
  );
  (einheitenDa ? heimatlos : wurzeln).push(...fahrzeugeOhneEinheit.map(fahrzeugZeile));

  if (heimatlos.length > 0) {
    wurzeln.push({
      key: 'sammel',
      art: 'sammel',
      id: null,
      stelle: SAMMEL_STELLE,
      stelleZusatz: null,
      rufname: null,
      leitung: { art: 'leer' },
      tmo: [],
      dmo: [],
      kommunikationsmittel: null,
      erreichbarkeit: null,
      children: heimatlos,
    });
  }
  // Die Führungsstelle steht VOR den Wurzeln, nicht über ihnen: der Baum bleibt gleich dem
  // Organigramm, die Verbindung zu den obersten Abschnitten urteilt die Lücke (D5).
  const fs = fuehrungsstelleZeile(q.fuehrungsstelle);
  return fs ? [fs, ...wurzeln] : wurzeln;
}

/** Schlüssel aller Knoten mit Kindern — der Druck klappt alles auf. */
export function aufklappbareSchluessel(zeilen: readonly FunkplanZeile[]): string[] {
  return zeilen.flatMap((z) => (z.children ? [z.key, ...aufklappbareSchluessel(z.children)] : []));
}

// ── Lücken ─────────────────────────────────────────────────────────────────────────────────────

export interface FunkplanLuecken {
  abschnitteOhneSprechgruppe: Luecke<Einsatzabschnitt>;
  einheitenOhneSprechgruppe: Luecke<Einheit>;
  einheitenOhneErreichbarkeit: Luecke<Einheit>;
  /** Stelle und übergeordnete Stelle ohne gemeinsame Sprechgruppe (LFH-625 D3). */
  verbindungenOhneGemeinsameSprechgruppe: Luecke<Verbindung>;
  lokaleSprechgruppenOhneZuordnung: Luecke<Sprechgruppe>;
}

export function funkplanLuecken(q: FunkplanQuellen): FunkplanLuecken {
  return {
    abschnitteOhneSprechgruppe: abschnitteOhneSprechgruppe(q.abschnitte),
    einheitenOhneSprechgruppe: einheitenOhneSprechgruppe(q.einheiten),
    einheitenOhneErreichbarkeit: einheitenOhneErreichbarkeit(q.einheiten),
    verbindungenOhneGemeinsameSprechgruppe: verbindungenOhneGemeinsameSprechgruppe(
      q.abschnitte,
      q.einheiten,
      q.fuehrungsstelle,
    ),
    lokaleSprechgruppenOhneZuordnung: lokaleSprechgruppenOhneZuordnung(
      q.sprechgruppen,
      q.abschnitte,
      q.einheiten,
      q.fuehrungsstelle,
    ),
  };
}

/** Warum eine Zahl oder Zelle fehlt — derselbe Wortlaut auf Seite, Druck und Lagebericht. */
export const ZUSTAND_GRUND: Record<Exclude<AbrufZustand, 'daten'>, string> = {
  gesperrt: 'nicht freigegeben',
  fehler: 'nicht geladen',
  laden: 'lädt',
};

/** Die Quellen, deren Fehlen eine Ebene oder Spalte leert — mit ihrem Namen für Seite und Bericht. */
export const QUELLEN_NAME: Record<
  Exclude<keyof FunkplanQuellen, 'sprechgruppen' | 'fuehrungsstelle'>,
  string
> = {
  abschnitte: 'Abschnitte',
  einheiten: 'Einheiten',
  fahrzeuge: 'Fahrzeuge',
  personal: 'Personal (Fahrzeugführer)',
};

export interface FehlendeQuelle {
  quelle: keyof typeof QUELLEN_NAME;
  name: string;
  zustand: Exclude<AbrufZustand, 'daten'>;
}

/**
 * Quellen ohne Daten (gesperrt, gescheitert, noch ladend), in fester Reihenfolge. Was hier steht,
 * fehlt im Plan; Seite und Bericht nennen es, statt eine leere Ebene als Bestand auszugeben.
 */
export function fehlendeQuellen(q: FunkplanQuellen): FehlendeQuelle[] {
  return (Object.keys(QUELLEN_NAME) as (keyof typeof QUELLEN_NAME)[]).flatMap((quelle) => {
    const { zustand } = q[quelle];
    return zustand === 'daten' ? [] : [{ quelle, name: QUELLEN_NAME[quelle], zustand }];
  });
}

/** Sind Abschnitte, Einheiten und Fahrzeuge geladen? Erst dann heißt „keine Zeile“ „kein Bestand“. */
export function strukturVollstaendig(q: FunkplanQuellen): boolean {
  return (
    q.abschnitte.zustand === 'daten' &&
    q.einheiten.zustand === 'daten' &&
    q.fahrzeuge.zustand === 'daten'
  );
}

/** Der Hinweis auf die eigene Gegenstelle, solange sie fehlt (LFH-849 D4). */
export const GEGENSTELLE_HINWEIS = 'Eigene Gegenstelle (Führungsstelle)';

/**
 * Was der Hinweis auf die eigene Gegenstelle sagt: „nicht erfasst“, der Grund, warum sie nicht
 * vorliegt, oder `null` — dann ist sie erfasst und steht als erste Zeile im Plan. Seite und
 * Bericht fragen nur hier.
 */
export function gegenstelleHinweis(q: FunkplanQuellen): string | null {
  const { zustand, daten } = q.fuehrungsstelle;
  if (zustand !== 'daten') return ZUSTAND_GRUND[zustand];
  return fuehrungsstelleErfasst(daten) ? null : 'nicht erfasst';
}

// ── Markdown für den Lagebericht ───────────────────────────────────────────────────────────────

/**
 * Entschärft, was `components/Markdown.tsx` (remark-gfm) als Auszeichnung läse: Backslash,
 * Backtick, Stern, Unterstrich, eckige Klammern und die Tilde (GFM streicht schon `~x~` durch).
 * Auch die Vorbereitung der Lagebesprechung (`stab/vorbereitung.ts`) maskiert hierüber.
 */
export function md(text: string): string {
  return text.replace(/[\\`*_[\]~]/g, (z) => `\\${z}`);
}

function leitungMarkdown(z: FunkplanZeile): string | null {
  const wort = z.art === 'abschnitt' ? 'Leitung' : 'Führer';
  if (z.leitung.art === 'name') return `${wort} ${z.leitung.namen.map(md).join(', ')}`;
  if (z.leitung.art === 'zustand') return `${wort} ${ZUSTAND_GRUND[z.leitung.zustand]}`;
  return null;
}

function zeileMarkdown(z: FunkplanZeile, tiefe: number): string[] {
  const kopf =
    z.art === 'sammel'
      ? md(z.stelle)
      : `**${md(z.stelle)}**${z.stelleZusatz ? ` (${md(z.stelleZusatz)})` : ''}`;
  // Die Erreichbarkeit fehlt hier mit Absicht: personenbezogen, und der Lagebericht geht bei
  // Freigabe ins ETB und in die Aufbewahrung (Entscheidung 30.09.2026).
  const teile = [
    kopf,
    z.rufname ? `${z.art === 'fahrzeug' ? 'OPTA' : 'Rufname'} ${md(z.rufname)}` : null,
    leitungMarkdown(z),
    z.tmo.length > 0 ? `TMO ${z.tmo.map(md).join(', ')}` : null,
    z.dmo.length > 0 ? `DMO ${z.dmo.map(md).join(', ')}` : null,
    z.kommunikationsmittel ? md(z.kommunikationsmittel) : null,
  ].filter((t): t is string => t != null);
  const zeile = `${'  '.repeat(tiefe)}- ${teile.join(' · ')}`;
  return [zeile, ...(z.children ?? []).flatMap((k) => zeileMarkdown(k, tiefe + 1))];
}

function lueckeMarkdown<T>(titel: string, l: Luecke<T>, name: (x: T) => string): string {
  if (l.zustand !== 'daten') return `- ${titel}: — (${ZUSTAND_GRUND[l.zustand]})`;
  const namen = l.treffer.length > 0 ? ` (${l.treffer.map((x) => md(name(x))).join(', ')})` : '';
  return `- ${titel}: ${l.treffer.length}${namen}`;
}

function gegenstelleMarkdown(q: FunkplanQuellen): string[] {
  const hinweis = gegenstelleHinweis(q);
  if (hinweis == null) return [];
  // Wie jede andere Lücke: ohne Daten „—“ mit Grund.
  return [
    q.fuehrungsstelle.zustand === 'daten'
      ? `- ${GEGENSTELLE_HINWEIS}: ${hinweis}`
      : `- ${GEGENSTELLE_HINWEIS}: — (${hinweis})`,
  ];
}

export function rendereFunkplanMarkdown(
  zeilen: readonly FunkplanZeile[],
  stand: string,
  luecken: FunkplanLuecken,
  quellen: FunkplanQuellen,
): string {
  const fehlend = fehlendeQuellen(quellen);
  // Der Bericht geht bei Freigabe unveränderlich ins ETB: was fehlt, steht darin, sonst läse
  // sich eine gesperrte Ebene später als „keine Fahrzeuge“.
  const quellenAbschnitt =
    fehlend.length > 0
      ? [
          '## Quellen',
          '',
          ...fehlend.map((f) => `- ${f.name}: ${ZUSTAND_GRUND[f.zustand]} — diese Angaben fehlen`),
          '',
        ]
      : [];
  const leer = strukturVollstaendig(quellen)
    ? '_(keine Kräfte erfasst)_'
    : '_(keine Zeilen: Quellen fehlen, siehe oben)_';
  return [
    '# Funkplan',
    '',
    `**Stand:** ${stand}`,
    '',
    '## Lücken',
    '',
    lueckeMarkdown(
      'Abschnitte ohne Sprechgruppe',
      luecken.abschnitteOhneSprechgruppe,
      (a) => a.name,
    ),
    lueckeMarkdown('Einheiten ohne Sprechgruppe', luecken.einheitenOhneSprechgruppe, (e) => e.name),
    lueckeMarkdown(
      'Einheiten ohne Erreichbarkeit',
      luecken.einheitenOhneErreichbarkeit,
      (e) => e.name,
    ),
    lueckeMarkdown(
      'Verbindungen ohne gemeinsame Sprechgruppe',
      luecken.verbindungenOhneGemeinsameSprechgruppe,
      (v) => `${v.unten.name} → ${v.oben.name}`,
    ),
    lueckeMarkdown(
      'Einsatzlokale Sprechgruppen ohne Zuordnung',
      luecken.lokaleSprechgruppenOhneZuordnung,
      (s) => s.bezeichnung,
    ),
    ...gegenstelleMarkdown(quellen),
    '',
    ...quellenAbschnitt,
    '## Gliederung',
    '',
    ...(zeilen.length > 0 ? zeilen.flatMap((z) => zeileMarkdown(z, 0)) : [leer]),
    '',
  ].join('\n');
}
