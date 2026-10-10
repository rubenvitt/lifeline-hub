import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { leseKapitel, type Kapitel } from './kapitel';

/**
 * Strukturwächter der Anwenderdokumentation (LFH-1096, LFH-1128, `docs/anwender/AGENTS.md`).
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * Dieselben Dateien rendern drei Werkzeuge: die App (react-markdown), die Website (Astro) und
 * GitHub. Was nur eines davon kann, zeigte an einer Stelle etwas anderes als an der anderen. Ein
 * Kapitel nennt die Code-Pfade, deren Verhalten es beschreibt; wer einen davon umbenennt, soll
 * das Kapitel sehen. Bilder entstehen per Skript (`pnpm doku:bilder`); ein Bild, das fehlt,
 * verwaist liegt oder ohne Alt-Text steht, fiele sonst erst beim Lesen auf.
 *
 * ── Was er prüft ───────────────────────────────────────────────────────────────
 *   • Kopf vollständig und lesbar (`leseKapitel`), Reihenfolge eindeutig;
 *   • jeder Pfad unter `quellen:` existiert;
 *   • Links auf `*.md` treffen ein Kapitel und tragen keine Sprungmarke;
 *   • nur reines GFM: kein HTML, keine MDX-Importe — Codeblöcke und Inline-Code ausgenommen;
 *   • Gliederung: `## Überblick`, `## Abläufe`, `## Hintergrund`, optional
 *     `## Grundlagen und Quellen`, genau in dieser Reihenfolge und ohne weitere `##`; unter
 *     „Abläufe“ mindestens ein `###`, jeder mit nummerierten Schritten und höchstens einem Bild;
 *   • Bilder nur als `![Alt](../bilder/<eigenes-kapitel>/<name>.png)`, Alt-Text nicht leer, die
 *     Datei existiert und ist höchstens {@link BILD_GRENZE} Bytes groß;
 *   • unter `docs/anwender/bilder/` liegt nichts, was kein Kapitel zeigt (keine Waisen, nur PNG).
 *
 * ── Was er NICHT prüft (Teil des Vertrags) ─────────────────────────────────────
 * Ob ein Kapitel nach einer Verhaltensänderung noch stimmt und ob ein Bild noch die aktuelle
 * Ansicht zeigt. Das trägt die Mitänderungsregel im Review; ein Gate auf Änderungen unter
 * `quellen:` wäre bei jedem Bugfix rot und würde abgeschaltet, ein Pixelvergleich wäre zwischen
 * Rechnern instabil (Design LFH-1127, D2).
 */

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const KAPITEL_ORDNER = join(WURZEL, 'docs', 'anwender', 'kapitel');
const BILDER_ORDNER = join(WURZEL, 'docs', 'anwender', 'bilder');

/** Größte erlaubte Bilddatei: 300 KB (Design LFH-1127, D2). */
export const BILD_GRENZE = 300 * 1024;

/** Die vier Abschnitte eines Kapitels in ihrer Reihenfolge; der letzte darf fehlen (D1). */
export const ABSCHNITTE = ['Überblick', 'Abläufe', 'Hintergrund', 'Grundlagen und Quellen'];

function ohneCode(text: string): string {
  return text.replace(/^```[\s\S]*?^```/gm, '').replace(/`[^`\n]*`/g, '');
}

/** Jede Bildstelle `![…](…)`, auch eine falsch geformte. */
const BILD = /!\[([^\]]*)\]\(([^)]*)\)/g;
/** Die einzige erlaubte Form des Ziels: eigener Ordner, Name aus Kleinbuchstaben, PNG. */
const BILD_ZIEL = /^\.\.\/bilder\/([a-z0-9-]+)\/([a-z0-9-]+\.png)$/;

export interface BildVerweis {
  alt: string;
  ziel: string;
}

/** Alle Bildstellen eines Kapiteltexts (ohne Code). */
export function bildVerweise(text: string): BildVerweis[] {
  return [...ohneCode(text).matchAll(BILD)].map((m) => ({ alt: m[1], ziel: m[2] }));
}

/** Pfad unter `docs/anwender/bilder/` (`<kapitel>/<name>.png`), wenn das Ziel gültig ist. */
export function bildPfad(ziel: string): string | undefined {
  const m = BILD_ZIEL.exec(ziel);
  return m ? `${m[1]}/${m[2]}` : undefined;
}

/** Befunde zu Quellen, Links und Form eines Kapitels; leer = in Ordnung. */
export function befunde(
  kapitel: Kapitel,
  slugs: ReadonlySet<string>,
  gibtEs: (pfad: string) => boolean,
): string[] {
  const aus: string[] = [];
  for (const quelle of kapitel.quellen) {
    if (!gibtEs(quelle)) aus.push(`Quelle ${quelle} gibt es nicht`);
  }
  // Bilder prüft `bildBefunde`; hier zählen nur Links.
  const text = ohneCode(kapitel.text).replace(BILD, '');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const ziel = m[1];
    if (/^[a-z]+:/.test(ziel)) continue;
    const k = /^([a-z0-9-]+)\.md$/.exec(ziel);
    if (!k) aus.push(`Link ${ziel}: nur ganze Kapitel (name.md), ohne Sprungmarke`);
    else if (!slugs.has(k[1])) aus.push(`Link ${ziel}: kein solches Kapitel`);
  }
  if (/<[a-zA-Z/!]/.test(text)) aus.push('HTML im Text');
  if (/!\[[^\]]*\](?!\()/.test(text)) aus.push('Bild nur als ![Alt](../bilder/…), ohne Verweis');
  if (/^(import|export)\s/m.test(text)) aus.push('MDX-Import/-Export im Text');
  return aus;
}

/**
 * Befunde zu den Bildern eines Kapitels. `groesse` liefert die Dateigröße eines Pfads unter
 * `docs/anwender/bilder/` in Bytes, `undefined`, wenn es die Datei nicht gibt.
 */
export function bildBefunde(
  kapitel: Kapitel,
  groesse: (pfad: string) => number | undefined,
): string[] {
  const aus: string[] = [];
  for (const { alt, ziel } of bildVerweise(kapitel.text)) {
    if (!alt.trim()) aus.push(`Bild ${ziel}: Alt-Text fehlt`);
    const pfad = bildPfad(ziel);
    if (!pfad) {
      aus.push(`Bild ${ziel}: nur ../bilder/${kapitel.slug}/<name>.png`);
      continue;
    }
    if (!pfad.startsWith(`${kapitel.slug}/`)) {
      aus.push(`Bild ${ziel}: liegt nicht im eigenen Ordner bilder/${kapitel.slug}/`);
      continue;
    }
    const bytes = groesse(pfad);
    if (bytes === undefined) aus.push(`Bild ${ziel}: Datei fehlt`);
    else if (bytes > BILD_GRENZE) {
      aus.push(`Bild ${ziel}: ${Math.ceil(bytes / 1024)} KB, Grenze ${BILD_GRENZE / 1024} KB`);
    }
  }
  return aus;
}

interface Abschnitt {
  titel: string;
  text: string;
}

/** Zerlegt einen Text an Überschriften der Stufe `stufe` (2 = `##`); Vorspann ohne Titel. */
function zerlege(text: string, stufe: 2 | 3): { vorspann: string; teile: Abschnitt[] } {
  const marke = `${'#'.repeat(stufe)} `;
  const teile: Abschnitt[] = [];
  const vorspann: string[] = [];
  let aktuell: Abschnitt | undefined;
  let imCode = false;
  for (const zeile of text.split('\n')) {
    if (zeile.startsWith('```')) imCode = !imCode;
    if (!imCode && zeile.startsWith(marke)) {
      aktuell = { titel: zeile.slice(marke.length).trim(), text: '' };
      teile.push(aktuell);
    } else if (aktuell) aktuell.text += `${zeile}\n`;
    else vorspann.push(zeile);
  }
  return { vorspann: vorspann.join('\n'), teile };
}

/** Befunde zur Gliederung eines Kapitels (Design LFH-1127, D1); leer = in Ordnung. */
export function gliederungBefunde(kapitel: Kapitel): string[] {
  const aus: string[] = [];
  const { vorspann, teile } = zerlege(kapitel.text, 2);
  if (vorspann.trim()) aus.push('Text vor „## Überblick“');
  const titel = teile.map((t) => t.titel);
  const soll = ABSCHNITTE.slice(0, titel.length);
  const passt = (titel.length === 3 || titel.length === 4) && titel.every((t, i) => t === soll[i]);
  if (!passt) {
    aus.push(
      `Abschnitte ${titel.map((t) => `„${t}“`).join(', ') || '(keine)'}: verlangt ` +
        `${ABSCHNITTE.slice(0, 3)
          .map((t) => `„${t}“`)
          .join(', ')}, optional „${ABSCHNITTE[3]}“, in dieser Reihenfolge`,
    );
  }
  const ablaeufe = teile.find((t) => t.titel === 'Abläufe');
  if (ablaeufe) {
    const { teile: einzeln } = zerlege(ablaeufe.text, 3);
    if (einzeln.length === 0) aus.push('„Abläufe“ ohne Ablauf (### …)');
    for (const ablauf of einzeln) {
      if (!/^\d+\.\s/m.test(ohneCode(ablauf.text))) {
        aus.push(`Ablauf „${ablauf.titel}“: keine nummerierten Schritte`);
      }
      if (bildVerweise(ablauf.text).length > 1) {
        aus.push(`Ablauf „${ablauf.titel}“: mehr als ein Bild`);
      }
    }
  }
  return aus;
}

/** Dateien unter `bilder/`, die kein Kapitel zeigt, und alles, was kein PNG ist. */
export function waisen(dateien: readonly string[], kapitel: readonly Kapitel[]): string[] {
  const gezeigt = new Set(
    kapitel.flatMap((k) =>
      bildVerweise(k.text)
        .map((b) => bildPfad(b.ziel))
        .filter((p): p is string => p !== undefined),
    ),
  );
  return dateien
    .filter((d) => !d.endsWith('.png') || !gezeigt.has(d))
    .map((d) =>
      d.endsWith('.png') ? `bilder/${d}: von keinem Kapitel gezeigt` : `bilder/${d}: kein PNG`,
    );
}

function geladen(): Kapitel[] {
  return readdirSync(KAPITEL_ORDNER)
    .filter((d) => d.endsWith('.md'))
    .map((d) => leseKapitel(d.replace(/\.md$/, ''), readFileSync(join(KAPITEL_ORDNER, d), 'utf8')));
}

/** Alle Dateien unter `docs/anwender/bilder/`, relativ und mit `/` getrennt. */
function bildDateien(): string[] {
  if (!existsSync(BILDER_ORDNER)) return [];
  return (readdirSync(BILDER_ORDNER, { recursive: true }) as string[])
    .map((d) => d.split('\\').join('/'))
    .filter((d) => statSync(join(BILDER_ORDNER, d)).isFile());
}

function dateiGroesse(pfad: string): number | undefined {
  const voll = join(BILDER_ORDNER, pfad);
  return existsSync(voll) ? statSync(voll).size : undefined;
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

  it('jedes Kapitel steht in den vier Abschnitten', () => {
    const alle = geladen().flatMap((k) => gliederungBefunde(k).map((b) => `${k.slug}: ${b}`));
    expect(alle).toEqual([]);
  });

  it('Bilder: eigener Ordner, Alt-Text, Datei da und klein genug, keine Waisen', () => {
    const kapitel = geladen();
    const alle = [
      ...kapitel.flatMap((k) => bildBefunde(k, dateiGroesse).map((b) => `${k.slug}: ${b}`)),
      ...waisen(bildDateien(), kapitel),
    ];
    expect(alle).toEqual([]);
  });

  describe('Selbstbeweis: jeder Befund schlägt an', () => {
    const basis: Kapitel = {
      slug: 'a',
      titel: 'A',
      gruppen: ['alle'],
      reihenfolge: 1,
      quellen: ['da'],
      text: [
        '## Überblick',
        '',
        'Siehe [B](b.md), [Netz](https://example.org) und `<code>` sowie',
        '',
        '```',
        '<pre>',
        '## Kein Abschnitt',
        '```',
        '',
        '## Abläufe',
        '',
        '### Etwas tun',
        '',
        '1. „Speichern“ wählen.',
        '',
        '   ![Die Maske](../bilder/a/maske.png)',
        '',
        '## Hintergrund',
        '',
        'Wissen.',
        '',
      ].join('\n'),
    };
    const slugs = new Set(['a', 'b']);
    const gibtEs = (p: string) => p === 'da';
    const groesse = (p: string) => (p === 'a/maske.png' ? 1000 : undefined);
    const mit = (text: string) => befunde({ ...basis, text }, slugs, gibtEs);
    const bild = (text: string) => bildBefunde({ ...basis, text }, groesse);
    const gliederung = (text: string) => gliederungBefunde({ ...basis, text });

    it('das Muster ist sauber', () => {
      expect(befunde(basis, slugs, gibtEs)).toEqual([]);
      expect(bildBefunde(basis, groesse)).toEqual([]);
      expect(gliederungBefunde(basis)).toEqual([]);
      expect(waisen(['a/maske.png'], [basis])).toEqual([]);
      expect(
        gliederung(`${basis.text}\n## Grundlagen und Quellen\n\nFwDV 100.\n`),
        '„Grundlagen und Quellen“ darf stehen',
      ).toEqual([]);
    });

    it('Quellen, Links und Form', () => {
      expect(befunde({ ...basis, quellen: ['weg'] }, slugs, gibtEs)).toEqual([
        'Quelle weg gibt es nicht',
      ]);
      expect(mit('[C](c.md)')).toEqual(['Link c.md: kein solches Kapitel']);
      expect(mit('[B](b.md#abschnitt)')).toHaveLength(1);
      expect(mit('Text <b>fett</b>')).toEqual(['HTML im Text']);
      expect(mit("import X from './x'")).toEqual(['MDX-Import/-Export im Text']);
      expect(mit('![Schirm][verweis]')).toEqual(['Bild nur als ![Alt](../bilder/…), ohne Verweis']);
    });

    it('Bilder', () => {
      expect(bild('![ ](../bilder/a/maske.png)')).toEqual([
        'Bild ../bilder/a/maske.png: Alt-Text fehlt',
      ]);
      expect(bild('![Maske](../bilder/a/fehlt.png)')).toEqual([
        'Bild ../bilder/a/fehlt.png: Datei fehlt',
      ]);
      expect(bild('![Maske](../bilder/b/maske.png)')).toEqual([
        'Bild ../bilder/b/maske.png: liegt nicht im eigenen Ordner bilder/a/',
      ]);
      for (const ziel of [
        'maske.png',
        '../bilder/a/maske.jpg',
        '../bilder/a/Maske.png',
        'https://example.org/maske.png',
        '../bilder/a/maske.png "Titel"',
      ]) {
        expect(bild(`![Maske](${ziel})`), ziel).toEqual([
          `Bild ${ziel}: nur ../bilder/a/<name>.png`,
        ]);
      }
      const gross = (p: string) => (p === 'a/maske.png' ? 300 * 1024 + 1 : undefined);
      expect(bildBefunde({ ...basis, text: '![Maske](../bilder/a/maske.png)' }, gross)).toEqual([
        'Bild ../bilder/a/maske.png: 301 KB, Grenze 300 KB',
      ]);
      const genau = (p: string) => (p === 'a/maske.png' ? 300 * 1024 : undefined);
      expect(bildBefunde({ ...basis, text: '![Maske](../bilder/a/maske.png)' }, genau)).toEqual([]);
      expect(bild('```\n![](egal.png)\n```')).toEqual([]);
    });

    it('Waisen', () => {
      expect(waisen(['a/maske.png', 'a/alt.png'], [basis])).toEqual([
        'bilder/a/alt.png: von keinem Kapitel gezeigt',
      ]);
      expect(waisen(['a/notiz.txt'], [basis])).toEqual(['bilder/a/notiz.txt: kein PNG']);
      expect(waisen(['b/maske.png'], [basis])).toEqual([
        'bilder/b/maske.png: von keinem Kapitel gezeigt',
      ]);
    });

    it('Gliederung', () => {
      const ohne = (titel: string) =>
        basis.text.replace(new RegExp(`^## ${titel}$`, 'm'), `## Anderes`);
      expect(gliederung(ohne('Abläufe'))).toHaveLength(1);
      expect(gliederung(ohne('Überblick'))).toHaveLength(1);
      // Vertauscht: Hintergrund vor Abläufen.
      const [vor, rest] = basis.text.split('## Abläufe');
      const [ablaeufe, hintergrund] = rest.split('## Hintergrund');
      expect(gliederung(`${vor}## Hintergrund${hintergrund}\n## Abläufe${ablaeufe}`)).toHaveLength(
        1,
      );
      expect(gliederung(`${basis.text}\n## Mehr\n\nText.\n`)).toHaveLength(1);
      expect(gliederung(`Vorweg.\n\n${basis.text}`)).toEqual(['Text vor „## Überblick“']);
      expect(
        gliederung(basis.text.replace('### Etwas tun\n', 'Nur Text.\n').replace('1. ', '')),
      ).toEqual(['„Abläufe“ ohne Ablauf (### …)']);
      expect(gliederung(basis.text.replace('1. „Speichern“', '„Speichern“'))).toEqual([
        'Ablauf „Etwas tun“: keine nummerierten Schritte',
      ]);
      expect(
        gliederung(
          basis.text.replace(
            '## Hintergrund',
            '   ![Noch eins](../bilder/a/x.png)\n\n## Hintergrund',
          ),
        ),
      ).toEqual(['Ablauf „Etwas tun“: mehr als ein Bild']);
    });
  });
});
