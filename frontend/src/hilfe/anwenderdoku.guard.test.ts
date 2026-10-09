import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { leseKapitel, type Kapitel } from './kapitel';

/**
 * Strukturwächter der Anwenderdokumentation (LFH-1096, `docs/anwender/AGENTS.md`).
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * Dieselben Dateien rendern zwei Werkzeuge: die App (react-markdown) und die Website (Astro).
 * Was nur eines von beiden kann, zeigte an einer Stelle etwas anderes als an der anderen. Und
 * ein Kapitel nennt die Code-Pfade, deren Verhalten es beschreibt; wer einen davon umbenennt,
 * soll das Kapitel sehen.
 *
 * ── Was er prüft ───────────────────────────────────────────────────────────────
 *   • Kopf vollständig und lesbar (`leseKapitel`), Reihenfolge eindeutig;
 *   • jeder Pfad unter `quellen:` existiert;
 *   • Links auf `*.md` treffen ein Kapitel und tragen keine Sprungmarke;
 *   • nur reines GFM: kein HTML, keine Bilder (keine Bildschirmfotos, Inhaltsregel), keine
 *     MDX-Importe — Codeblöcke und Inline-Code ausgenommen.
 *
 * ── Was er NICHT prüft (Teil des Vertrags) ─────────────────────────────────────
 * Ob ein Kapitel nach einer Verhaltensänderung noch stimmt. Das trägt die Mitänderungsregel im
 * Review; ein Gate auf Änderungen unter `quellen:` wäre bei jedem Bugfix rot und würde
 * abgeschaltet.
 */

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KAPITEL_ORDNER = join(WURZEL, 'docs', 'anwender', 'kapitel');

function ohneCode(text: string): string {
  return text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
}

/** Befunde eines Kapitels; leer = in Ordnung. */
export function befunde(
  kapitel: Kapitel,
  slugs: ReadonlySet<string>,
  gibtEs: (pfad: string) => boolean,
): string[] {
  const aus: string[] = [];
  for (const quelle of kapitel.quellen) {
    if (!gibtEs(quelle)) aus.push(`Quelle ${quelle} gibt es nicht`);
  }
  const text = ohneCode(kapitel.text);
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const ziel = m[1];
    if (/^[a-z]+:/.test(ziel)) continue;
    const k = /^([a-z0-9-]+)\.md$/.exec(ziel);
    if (!k) aus.push(`Link ${ziel}: nur ganze Kapitel (name.md), ohne Sprungmarke`);
    else if (!slugs.has(k[1])) aus.push(`Link ${ziel}: kein solches Kapitel`);
  }
  if (/<[a-zA-Z/!]/.test(text)) aus.push('HTML im Text');
  if (/!\[/.test(text)) aus.push('Bild im Text');
  if (/^(import|export)\s/m.test(text)) aus.push('MDX-Import/-Export im Text');
  return aus;
}

function geladen(): Kapitel[] {
  return readdirSync(KAPITEL_ORDNER)
    .filter((d) => d.endsWith('.md'))
    .map((d) => leseKapitel(d.replace(/\.md$/, ''), readFileSync(join(KAPITEL_ORDNER, d), 'utf8')));
}

describe('Anwenderdokumentation', () => {
  it('jedes Kapitel hat einen lesbaren Kopf, die Reihenfolge ist eindeutig', () => {
    const kapitel = geladen();
    expect(kapitel.length).toBeGreaterThan(0);
    const folge = kapitel.map((k) => k.reihenfolge);
    expect(new Set(folge).size, `Reihenfolge doppelt: ${folge.join(', ')}`).toBe(folge.length);
  });

  it('Quellen, Links und Form stimmen', () => {
    const kapitel = geladen();
    const slugs = new Set(kapitel.map((k) => k.slug));
    const gibtEs = (pfad: string) => existsSync(join(WURZEL, pfad));
    const alle = kapitel.flatMap((k) => befunde(k, slugs, gibtEs).map((b) => `${k.slug}: ${b}`));
    expect(alle).toEqual([]);
  });

  it('Selbstbeweis: jeder Befund schlägt an', () => {
    const basis: Kapitel = {
      slug: 'a',
      titel: 'A',
      gruppen: ['alle'],
      reihenfolge: 1,
      quellen: ['da'],
      text: 'Siehe [B](b.md), [Netz](https://example.org) und `<code>` sowie\n\n```\n<pre>\n```\n',
    };
    const slugs = new Set(['a', 'b']);
    const gibtEs = (p: string) => p === 'da';
    expect(befunde(basis, slugs, gibtEs)).toEqual([]);
    const mit = (text: string) => befunde({ ...basis, text }, slugs, gibtEs);
    expect(befunde({ ...basis, quellen: ['weg'] }, slugs, gibtEs)).toEqual([
      'Quelle weg gibt es nicht',
    ]);
    expect(mit('[C](c.md)')).toEqual(['Link c.md: kein solches Kapitel']);
    expect(mit('[B](b.md#abschnitt)')).toHaveLength(1);
    expect(mit('Text <b>fett</b>')).toEqual(['HTML im Text']);
    expect(mit('![Schirm](schirm.png)')).toContain('Bild im Text');
    expect(mit("import X from './x'")).toEqual(['MDX-Import/-Export im Text']);
  });
});
