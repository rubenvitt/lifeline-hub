/**
 * Architekturdokumentation (LLH-1435) auf der Website: Hilfen für die Seiten unter
 * `src/pages/architektur/`. Die Quellen liegen in `docs/architektur/` und tragen auf GitHub; hier
 * wird ihr gerendertes HTML für die Website aufbereitet, am HTML statt per Remark-Plugin (wie
 * `src/pages/doku/[kapitel].astro`, Astro 7 rendert Markdown mit Sätteri).
 *
 * Was die Aufbereitung tut:
 * - Titelzeile (`# 6. Laufzeitsicht`) und `Stand:`-Zeile fallen weg; die Seite zeigt beides im Kopf.
 * - Relative Links werden Adressen: Kapitel → `/architektur/<datei>/`, Entscheidungen →
 *   `/architektur/entscheidungen/<datei>/`, Kapitel der Anwenderdoku → `/doku/<name>/`, alles
 *   andere im Repo → GitHub (Zweig `alpha`).
 * - Ein Pfad in Backticks (`src/live/mod.rs`), den es im Repo gibt, verlinkt auf GitHub.
 * - Codeblöcke werden einfarbig (Shiki färbt fest dunkel, die Seite hat Nacht und Tag);
 *   ```` ```mermaid ```` wird eine Abbildung, die `components/ArchitekturDiagramme.astro` im
 *   Browser zeichnet. Ohne Skript bleibt der Diagrammtext lesbar stehen.
 *
 * `set:html` ist sicher: die Dateien stammen aus dem Repo, und ihr HTML entsteht aus Markdown.
 */
import { existsSync } from 'node:fs';
import { posix, resolve } from 'node:path';

export const REPO = 'https://github.com/rubenvitt/lifeline-hub';
const ZWEIG = 'alpha';
/** Beim Bauen ist das Arbeitsverzeichnis `website/` (lokal wie auf Cloudflare Pages). */
const WURZEL = resolve(process.cwd(), '..');

export const STATUS_NAME: Record<string, string> = {
  akzeptiert: 'Akzeptiert',
  vorgeschlagen: 'Vorgeschlagen',
  ersetzt: 'Ersetzt',
  verworfen: 'Verworfen',
};

export function githubAdresse(pfad: string): string {
  return `${REPO}/blob/${ZWEIG}/${pfad}`;
}

export interface KapitelKopf {
  nummer: number;
  titel: string;
  stand: string;
}

/** Nummer und Titel aus `# 6. Laufzeitsicht`, Stand aus `Stand: 23.10.2026 (…).` */
export function kopfVon(text: string): KapitelKopf {
  const titel = /^#\s+(\d+)\.\s+(.+)$/m.exec(text);
  const stand = /^Stand:\s*(.+?)\.?\s*$/m.exec(text);
  return {
    nummer: titel ? Number(titel[1]) : 0,
    titel: titel ? titel[2].trim() : '',
    stand: stand ? stand[1] : '',
  };
}

const ENTITAETEN: Record<string, string> = {
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
};
export const entschluesselt = (text: string) =>
  text.replace(/&(quot|#39|#x27|lt|gt|amp);/g, (m) => ENTITAETEN[m] ?? m);
const maske = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Klartext aus HTML (für Suche und Kurztexte). */
export function klartext(html: string): string {
  return entschluesselt(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Repo-Pfad der Datei, auf die ein relativer Link aus `quelle` zeigt, oder `undefined`. */
function zielPfad(href: string, quelle: string): string | undefined {
  if (/^([a-z]+:|#|\/)/i.test(href)) return undefined;
  const pfad = posix.normalize(posix.join(posix.dirname(quelle), decodeURI(href)));
  return pfad.startsWith('..') ? undefined : pfad;
}

/** Adresse auf der Website für einen Repo-Pfad, sonst GitHub. */
export function adresseFuer(pfad: string): { adresse: string; extern: boolean } {
  let m = /^docs\/architektur\/(\d\d-[^/]+)\.md$/.exec(pfad);
  if (m) return { adresse: `/architektur/${m[1]}/`, extern: false };
  if (pfad === 'docs/architektur/README.md') return { adresse: '/architektur/', extern: false };
  if (pfad === 'docs/architektur/entscheidungen') {
    return { adresse: '/architektur/#entscheidungen', extern: false };
  }
  m = /^docs\/architektur\/entscheidungen\/(ADR-[^/]+)\.md$/.exec(pfad);
  if (m) return { adresse: `/architektur/entscheidungen/${m[1]}/`, extern: false };
  m = /^docs\/anwender\/kapitel\/([^/]+)\.md$/.exec(pfad);
  if (m) return { adresse: `/doku/${m[1]}/`, extern: false };
  return { adresse: githubAdresse(pfad.replace(/\/$/, '')), extern: true };
}

const EXTERN = 'target="_blank" rel="noopener noreferrer" data-extern';

function linksUmschreiben(html: string, quelle: string): string {
  return html.replace(/<a href="([^"]+)"/g, (ganz, roh: string) => {
    const href = entschluesselt(roh);
    if (/^https?:/.test(href)) return `<a href="${roh}" ${EXTERN}`;
    const [teil, anker] = href.split('#');
    const pfad = zielPfad(teil, quelle);
    if (pfad === undefined) return ganz;
    const { adresse, extern } = adresseFuer(pfad);
    const voll = anker && !extern ? `${adresse}#${anker}` : adresse;
    return `<a href="${maske(voll)}"${extern ? ` ${EXTERN}` : ''}`;
  });
}

/** Ein Pfad in Backticks, den es im Repo gibt, wird ein Link auf GitHub. */
function pfadeVerlinken(html: string): string {
  // Nur außerhalb bestehender Links: dort steht der Code schon in einem <a>.
  return html
    .split(/(<a\b[\s\S]*?<\/a>)/)
    .map((teil, i) =>
      i % 2 === 1
        ? teil
        : teil.replace(/<code>([^<\s]+)<\/code>/g, (ganz, roh: string) => {
            const pfad = entschluesselt(roh).replace(/^\.\//, '');
            if (!/[/.]/.test(pfad) || /^[a-z]+:/.test(pfad) || pfad.includes('..')) return ganz;
            const sauber = pfad.replace(/\/$/, '');
            if (!sauber || !existsSync(resolve(WURZEL, sauber))) return ganz;
            return `<a class="arch-pfad" href="${maske(githubAdresse(sauber))}" ${EXTERN}><code>${roh}</code></a>`;
          }),
    )
    .join('');
}

/** Codeblöcke einfarbig, Mermaid als Abbildung. Platzhalter schützen sie vor `pfadeVerlinken`. */
function codeBloecke(html: string, bloecke: string[]): string {
  return html.replace(
    /<pre class="astro-code[^"]*"([^>]*)>([\s\S]*?)<\/pre>/g,
    (_m, attribute: string, inhalt: string) => {
      const sprache = /data-language="([^"]*)"/.exec(attribute)?.[1];
      // Shikis Spans weg, nur der Text bleibt; `maske` setzt ihn danach vollständig maskiert ein.
      const text = entschluesselt(inhalt.split(/<[^>]*>/).join('')).replace(/\n$/, '');
      const block =
        sprache === 'mermaid'
          ? `<figure class="arch-diagramm" data-mermaid><pre class="arch-diagramm__quelle">${maske(text)}</pre></figure>`
          : `<pre class="arch-code"${sprache ? ` data-sprache="${maske(sprache)}"` : ''}><code>${maske(text)}</code></pre>`;
      bloecke.push(block);
      return `<!--block:${bloecke.length - 1}-->`;
    },
  );
}

/**
 * Bereitet das gerenderte HTML einer Datei aus `docs/architektur/` für die Website auf.
 * `quelle`: Repo-Pfad der Markdown-Datei (für relative Links).
 */
export function aufbereiten(html: string, quelle: string): string {
  const bloecke: string[] = [];
  let aus = html
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>\s*/, '')
    .replace(/<p>Stand:[\s\S]*?<\/p>\s*/, '');
  aus = codeBloecke(aus, bloecke);
  aus = linksUmschreiben(aus, quelle);
  aus = pfadeVerlinken(aus);
  return aus.replace(/<!--block:(\d+)-->/g, (_m, i: string) => bloecke[Number(i)]);
}

export interface Gliederung {
  id: string;
  titel: string;
  unter: { id: string; titel: string }[];
}

/** `##` mit den `###` darunter, IDs wie der Renderer sie setzt. */
export function gliederungVon(html: string): Gliederung[] {
  const aus: Gliederung[] = [];
  for (const m of html.matchAll(/<h([23]) id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g)) {
    const titel = klartext(m[3]);
    if (m[1] === '2') aus.push({ id: m[2], titel, unter: [] });
    else aus.at(-1)?.unter.push({ id: m[2], titel });
  }
  return aus;
}

/** Kurzbeschreibung der Kapitel aus der Tabelle in `docs/architektur/README.md` (Spalte „Inhalt“). */
export function inhaltAusReadme(readme: string): Record<string, string> {
  const aus: Record<string, string> = {};
  for (const m of readme.matchAll(/^\|\s*\d+\s*\|\s*\[[^\]]+\]\((\d\d-[^)]+)\.md\)\s*\|\s*(.+?)\s*\|\s*$/gm)) {
    aus[m[1]] = m[2];
  }
  return aus;
}

export function leseminuten(html: string): number {
  return Math.max(1, Math.round(klartext(html).split(' ').length / 200));
}

/**
 * Regelzeilen einer Entscheidung: das Schlüsselwort am Anfang (`MUST NOT:`, `MUST:`, `SHOULD:`,
 * auch fett) wird eine Marke, damit Pflicht und Empfehlung auf einen Blick auseinandergehen.
 */
export function regelnHervorheben(html: string): string {
  return html.replace(
    /<li>(\s*(?:<p>)?\s*)(?:<strong>)?(MUST NOT|MUST|SHOULD NOT|SHOULD|MAY)(?:<\/strong>)?:?\s*/g,
    (_m, vor: string, wort: string) => {
      const art = wort.startsWith('MUST') ? 'muss' : wort.startsWith('SHOULD') ? 'soll' : 'kann';
      return `<li class="arch-regel arch-regel--${art}">${vor}<span class="arch-regel__wort mono">${wort}</span> `;
    },
  );
}
