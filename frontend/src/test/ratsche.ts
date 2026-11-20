import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Gemeinsame Mechanik der Ratschen-Wächter (`theme/abstandsraster.guard.test.ts`,
 * `theme/schriftgroesse.guard.test.ts`; Change `hzru8iq7-text-stapel-meta-feld`, design.md D7):
 * Quellbaum lesen, Funde je Datei gegen eine Schuld halten, die nur sinken darf. Was ein Fund ist,
 * bringt jeder Wächter selbst mit.
 */

/**
 * Flächen, die bewusst nicht der Bediendichte folgen (Specs `abstandsraster` und `schriftstufen`,
 * „Feste Ausnahmen mit Grund“). Präfix eines Pfads relativ zu `src/` → Grund.
 */
export const DICHTE_AUSNAHMEN: Readonly<Record<string, string>> = {
  'geraet/Lagemonitor': 'Großbild: Betrachtungsabstand statt Bedienhand',
  'geraet/lagemonitor': 'Großbild: Betrachtungsabstand statt Bedienhand',
  'hilfe/Hilfe.css': 'Prosa der Hilfe: Lesetypografie, keine Bedienziele',
  'pages/LoginPage': 'Anmeldeseite: eigene Bühne vor der Dichtewahl',
  'auth/AnmeldeFormular': 'Stufen der Anmeldeseite, auch im Dialog „Sitzung beendet“ (LLH-1770)',
  'druck/': 'Druck: Papiermaß, keine Bildschirmdichte',
};

/**
 * Druckansichten außerhalb von `druck/` (`pages/befehlPrint.css`, `pages/EtbDruckPage.tsx`,
 * `personen/PersonDruckBlatt.tsx` …): dieselbe Ausnahme wie `druck/`, erkannt am Dateinamen. Nur
 * Druck-CSS und Druckseiten; Bausteine am Bildschirm (`components/druck/DruckKnopf.tsx`) zählen.
 */
export const DRUCKDATEI =
  /(?:[Pp]rint|[Dd]ruck)\.css$|(?:DruckPage|DruckSeite|DruckBlatt|DruckInhalt|DruckTabelle)\.tsx$/;

/** Pfad von `frontend/src`, egal ob der Lauf in `frontend/` oder in der Wurzel startet. */
export function quellwurzel(wer: string): string {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'theme', 'rollen.css'))) return pfad;
  }
  throw new Error(`${wer} findet frontend/src nicht (cwd: ${process.cwd()})`);
}

/** Alle TS-, TSX- und CSS-Dateien unter `verzeichnis` ohne Tests, Typdeklarationen und `test/`. */
export function liesBaum(verzeichnis: string, praefix = ''): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    const rel = praefix ? `${praefix}/${eintrag.name}` : eintrag.name;
    if (eintrag.isDirectory()) {
      if (rel !== 'test') Object.assign(treffer, liesBaum(pfad, rel));
    } else if (
      /\.(tsx?|css)$/.test(eintrag.name) &&
      !/\.test\.tsx?$/.test(eintrag.name) &&
      !eintrag.name.endsWith('.d.ts')
    ) {
      treffer[rel] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/** Zeile (1-basiert) eines Index im verbundenen Text. */
export function zeileVon(text: string, index: number): number {
  let zeile = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) zeile += 1;
  return zeile;
}

export interface Fund {
  zeile: number;
  wert: number;
}

export interface Ratsche {
  /** Funde einer Datei. */
  funde: (pfad: string, inhalt: string) => Fund[];
  /** Ist die Datei von der Prüfung ausgenommen? */
  ausgenommen: (pfad: string) => boolean;
  /** Was gezählt wird, im Plural („Abstands-Literale“). */
  was: string;
  /** Was stattdessen zu tun ist, für die Meldung bei einem neuen Fund. */
  hinweis: string;
  /** Dateiname der Schuld-Liste, für die Meldung beim Senken. */
  schuldDatei: string;
}

/**
 * Befunde über eine Menge Dateien (Pfad relativ zu `src/` → Inhalt). Leer = in Ordnung. Mehr Funde
 * als die Schuld sind rot (neuer Fund), weniger auch (Schuld senken), damit die Liste nie still
 * wieder wächst.
 */
export function ratschenBefunde(
  ratsche: Ratsche,
  dateien: Readonly<Record<string, string>>,
  schuld: Readonly<Record<string, number>>,
): string[] {
  const meldungen: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (ratsche.ausgenommen(pfad)) continue;
    const funde = ratsche.funde(pfad, inhalt);
    const erlaubt = schuld[pfad] ?? 0;
    if (funde.length > erlaubt) {
      const liste = funde.map((f) => `  ${pfad}:${f.zeile}  ${f.wert}`).join('\n');
      meldungen.push(
        `${pfad}: ${funde.length} ${ratsche.was}, Schuld ${erlaubt} — neues Literal? ` +
          `${ratsche.hinweis}:\n${liste}`,
      );
    } else if (funde.length < erlaubt) {
      meldungen.push(
        `${pfad}: Schuld senken — ${funde.length} statt ${erlaubt} Literale; in ` +
          `${ratsche.schuldDatei} auf ${funde.length} setzen${funde.length === 0 ? ' (Eintrag streichen)' : ''}`,
      );
    }
  }
  for (const pfad of Object.keys(schuld)) {
    if (!(pfad in dateien)) meldungen.push(`${pfad}: Datei fehlt — Schuld-Eintrag streichen`);
    else if (ratsche.ausgenommen(pfad)) {
      meldungen.push(`${pfad}: ist Ausnahme — Schuld-Eintrag streichen`);
    }
    if (schuld[pfad] <= 0) meldungen.push(`${pfad}: Schuld 0 — Eintrag streichen`);
  }
  return meldungen;
}
