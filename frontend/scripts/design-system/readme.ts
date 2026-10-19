/**
 * README des Design Systems aus den Regeln in `frontend/AGENTS.md` (design.md D3). Die Regeln
 * stehen weiter genau einmal im Repo; die README ist eine erzeugte Ausgabe. Fehlt ein Abschnitt,
 * bricht der Generator ab, statt still eine kürzere README zu schreiben.
 */
import type { Omitted } from './tokens';

/**
 * Die Abschnitte von `frontend/AGENTS.md`, die die README trägt, in dieser Reihenfolge. Ein
 * Abschnitt beginnt mit einer Zeile, die so anfängt (`## …` oder ein fetter Absatzkopf), und endet
 * vor dem nächsten `## …` oder dem nächsten fetten Absatzkopf nach einer Leerzeile.
 */
export const README_SECTIONS = [
  { head: '## Frontend — Gestaltungssprache', title: 'Gestaltungssprache' },
  { head: '**Farbachsen**', title: 'Farbachsen' },
  { head: '**Farbe und Zeichen**', title: 'Farbe und Zeichen' },
  { head: '**Tabelle und Dichte**', title: 'Dichte und Bedienziele' },
  { head: '**Texte: zeigen statt erklären**', title: 'Texte: zeigen statt erklären' },
  { head: '**Begriffe**', title: 'Begriffe' },
] as const;

/** Der Text eines Abschnitts ohne seine Überschrift. */
export function cutSection(source: string, head: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(head));
  if (start < 0) {
    throw new Error(
      `Design System: Abschnitt „${head}“ fehlt in frontend/AGENTS.md — README_SECTIONS in ` +
        '`frontend/scripts/design-system/readme.ts` nachziehen',
    );
  }
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end];
    if (line.startsWith('## ')) break;
    if (line.startsWith('**') && lines[end - 1].trim() === '') break;
    end += 1;
  }
  // Was hinter dem Kopf auf derselben Zeile steht (Datum, Verweis), bleibt als erste Zeile.
  const rest = lines[start].slice(head.length).trim();
  return [rest, ...lines.slice(start + 1, end)].join('\n').trim();
}

/**
 * Ein einzelner Spiegelstrich, der mit `- **<head>**` beginnt, bis zum nächsten Spiegelstrich,
 * Absatzkopf oder zur Leerzeile.
 */
export function cutBullet(source: string, head: string): string {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`- **${head}**`));
  if (start < 0) throw new Error(`Design System: Regel „${head}“ fehlt in frontend/AGENTS.md`);
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith('  ')) end += 1;
  return lines.slice(start, end).join('\n');
}

export interface PreviewEntry {
  name: string;
  group: string;
  title: string;
}

/** Die README des Design Systems. */
export function buildReadme(
  agents: string,
  omitted: readonly Omitted[],
  previews: readonly PreviewEntry[],
): string {
  const parts: string[] = [
    '# Lifeline Hub — Design System',
    '',
    'Aus dem Code erzeugt. Quelle der Wahrheit ist das Repo `rubenvitt/lifeline-hub`: Farbrollen,',
    'Paletten, Schrift und Dichten aus `frontend/src/theme/tokens.ts` und',
    '`frontend/src/theme/schriften.ts`, die Regeln unten aus `frontend/AGENTS.md`, die Vorschauen',
    'aus den echten Bausteinen (serverseitig gerendert mit dem antd-Theme der App). Neu erzeugt mit',
    '`pnpm -C frontend design-system`. **Änderungen auf dieser Seite werden beim nächsten',
    'Veröffentlichen überschrieben**; geändert wird im Repo.',
    '',
    'Zwei Themen: **Nacht** (Vorgabe der App, zuerst) und **Tag**, aus der Nachtpalette',
    'abgeleitet. Radius 0, Archivo für Text, JetBrains Mono für jede fachliche Zahl. Dichte-Staffel',
    'kompakt · komfortabel · Handschuh (Steuerhöhe 30 / 48 / 72 px); die Vorschauen zeigen',
    '`kompakt`. Pfade ohne Präfix in den Regeln sind relativ zu `frontend/src/`.',
    '',
    '## Bausteine',
    '',
    ...previews.map((p) => `- **${p.title}** (\`components/${p.name}/\`, Gruppe ${p.group})`),
    '',
    '## Nur im Code',
    '',
    'Diese Werte liest das Format des Design Systems nicht; sie stehen nur im Repo:',
    '',
    ...omitted.map((o) => `- \`${o.source}\`: ${o.reason}`),
    '',
  ];
  for (const { head, title } of README_SECTIONS) {
    parts.push(`## ${title}`, '', cutSection(agents, head), '');
  }
  return `${parts.join('\n').trimEnd()}\n`;
}
