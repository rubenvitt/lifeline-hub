/**
 * Kapitel der Anwenderdokumentation (LFH-1096, `docs/anwender/AGENTS.md`).
 *
 * Die Texte liegen als Markdown unter `docs/anwender/kapitel/` und werden beim Bauen in den
 * Chunk der Hilfe-Seite eingebunden: ohne Netz lesbar, immer passend zur ausgelieferten Version.
 * Dieselben Dateien baut die Website (`website/`) unter `/doku/`.
 *
 * Jede Datei trägt einen Kopf aus genau vier Schlüsseln (Titel, Gruppen, Reihenfolge, Quellen).
 * Gelesen wird er hier mit wenigen Zeilen statt mit einem YAML-Paket; was nicht passt, wirft —
 * der Wächter `anwenderdoku.guard.test.ts` macht das vor dem Bauen rot.
 */

import { istGruppe, type Gruppe } from './gruppen';

export interface Kapitel {
  /** Dateiname ohne `.md`; zugleich der Pfadteil in `/hilfe/<slug>` und `/doku/<slug>/`. */
  slug: string;
  titel: string;
  gruppen: Gruppe[];
  /** Global eindeutig; ordnet die Kapitel in jeder Gruppe. */
  reihenfolge: number;
  /** Code-Pfade, deren Verhalten das Kapitel beschreibt (Mitänderungsregel). */
  quellen: string[];
  /** Markdown ohne Kopf. */
  text: string;
}

const SCHLUESSEL = ['titel', 'gruppen', 'reihenfolge', 'quellen'] as const;

function liste(wert: string, schluessel: string, slug: string): string[] {
  const m = /^\[(.*)\]$/.exec(wert);
  if (!m) throw new Error(`${slug}: „${schluessel}“ ist keine Liste [a, b]`);
  return m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Liest Kopf und Text eines Kapitels; wirft bei jedem Fehler im Kopf. */
export function leseKapitel(slug: string, roh: string): Kapitel {
  const quelle = roh.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n/.exec(quelle);
  if (!m) throw new Error(`${slug}: Kopf (--- … ---) fehlt`);
  const kopf = new Map<string, string>();
  for (const zeile of m[1].split('\n')) {
    if (!zeile.trim()) continue;
    const z = /^([a-z]+):\s*(.*)$/.exec(zeile);
    if (!z) throw new Error(`${slug}: Kopfzeile „${zeile}“ unlesbar`);
    if (!(SCHLUESSEL as readonly string[]).includes(z[1])) {
      throw new Error(`${slug}: unbekannter Schlüssel „${z[1]}“`);
    }
    kopf.set(z[1], z[2].trim());
  }
  for (const s of SCHLUESSEL) {
    if (!kopf.get(s)) throw new Error(`${slug}: „${s}“ fehlt`);
  }
  const gruppen = liste(kopf.get('gruppen')!, 'gruppen', slug);
  if (gruppen.length === 0) throw new Error(`${slug}: keine Gruppe`);
  const fremd = gruppen.filter((g) => !istGruppe(g));
  if (fremd.length > 0) throw new Error(`${slug}: unbekannte Gruppe ${fremd.join(', ')}`);
  const reihenfolge = Number(kopf.get('reihenfolge'));
  if (!Number.isInteger(reihenfolge)) throw new Error(`${slug}: Reihenfolge ist keine Zahl`);
  const quellen = liste(kopf.get('quellen')!, 'quellen', slug);
  if (quellen.length === 0) throw new Error(`${slug}: keine Quelle`);
  return {
    slug,
    titel: kopf.get('titel')!,
    gruppen: gruppen as Gruppe[],
    reihenfolge,
    quellen,
    text: quelle.slice(m[0].length).replace(/^\n+/, ''),
  };
}

/**
 * Kapitel verweisen aufeinander mit relativen Links (`[…](ohne-netz.md)`), damit sie auch auf
 * GitHub tragen. Die App und die Website setzen ihre eigenen Adressen ein. Sprungmarken gibt es
 * nicht: GitHub, Astro und die App bilden Überschriften-Anker verschieden (Wächter).
 */
export function verlinke(text: string, ziel: (slug: string) => string): string {
  return text.replace(/\]\(([a-z0-9-]+)\.md\)/g, (_m, slug: string) => `](${ziel(slug)})`);
}

const ROHTEXTE = import.meta.glob<string>('../../../docs/anwender/kapitel/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export const KAPITEL: readonly Kapitel[] = Object.entries(ROHTEXTE)
  .map(([pfad, roh]) => leseKapitel(pfad.replace(/^.*\/|\.md$/g, ''), roh))
  .sort((a, b) => a.reihenfolge - b.reihenfolge);

export function kapitelDerGruppe(gruppe: Gruppe): Kapitel[] {
  return KAPITEL.filter((k) => k.gruppen.includes(gruppe));
}

export function findeKapitel(slug: string | undefined): Kapitel | undefined {
  return slug === undefined ? undefined : KAPITEL.find((k) => k.slug === slug);
}
