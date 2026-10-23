/**
 * README des Design Systems aus den Regeln in `frontend/AGENTS.md` (design.md D3). Die Regeln
 * stehen weiter genau einmal im Repo; die README ist eine erzeugte Ausgabe. Fehlt ein Abschnitt,
 * bricht der Generator ab, statt still eine kürzere README zu schreiben.
 */
import type { Omitted } from './tokens';

/** Der Befehl, der das Design System neu erzeugt (Node und pnpm aus `mise.toml`, LFH-773). */
export const DESIGN_SYSTEM_COMMAND = 'mise exec -- pnpm -C frontend design-system';

/**
 * Die Abschnitte von `frontend/AGENTS.md`, die die README trägt, in dieser Reihenfolge. Ein
 * Abschnitt beginnt mit einer Zeile, die so anfängt (`## …` oder ein fetter Absatzkopf), und endet
 * vor dem nächsten `## …` oder dem nächsten fetten Absatzkopf nach einer Leerzeile. `skip` nennt
 * Spiegelstriche, die keine Gestaltungsregel sind: der Ablauf für Agenten im Repo (Entwerfen,
 * Erzeugen, Veröffentlichen) gehört nicht in die README, die ein `/design`-Agent zuerst liest.
 */
export const README_SECTIONS: readonly { head: string; title: string; skip?: readonly string[] }[] =
  [
    {
      head: '## Frontend — Gestaltungssprache',
      title: 'Gestaltungssprache',
      skip: ['Größere UI-Entwürfe über das Design System'],
    },
    { head: '**Farbachsen**', title: 'Farbachsen' },
    { head: '**Farbe und Zeichen**', title: 'Farbe und Zeichen' },
    { head: '**Tabelle und Dichte**', title: 'Dichte und Bedienziele' },
    { head: '**Texte: zeigen statt erklären**', title: 'Texte: zeigen statt erklären' },
    { head: '**Begriffe**', title: 'Begriffe' },
  ];

/**
 * Einzelne Spiegelstriche aus anderen Abschnitten von `frontend/AGENTS.md`, die ein Entwurf
 * kennen muss (Kopf `- **<head>**`), je als eigener Abschnitt hinter den obigen. Zeitdarstellung
 * (LLH-1053): ein Entwurf, der Zeiten zeigt, schreibt sie wie die App.
 */
export const README_RULES: readonly { head: string; title: string }[] = [
  { head: 'Zeitdarstellung', title: 'Zeitdarstellung' },
];

/**
 * Der Text eines Abschnitts ohne seine Überschrift, ohne die Spiegelstriche in `skip` (Kopf
 * `- **<skip>**` samt Fortsetzungszeilen). Fehlt einer davon, bricht es ab: sonst stünde eine
 * umbenannte Regel still wieder in der README.
 */
export function cutSection(source: string, head: string, skip: readonly string[] = []): string {
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
  const body = [rest, ...lines.slice(start + 1, end)];
  for (const bullet of skip) {
    const from = body.findIndex((line) => line.startsWith(`- **${bullet}**`));
    if (from < 0) {
      throw new Error(`Design System: Regel „${bullet}“ fehlt im Abschnitt „${head}“`);
    }
    let to = from + 1;
    while (to < body.length && body[to].startsWith('  ')) to += 1;
    // Stand der Spiegelstrich allein zwischen Leerzeilen, geht eine davon mit.
    if (body[to] === '' && (from === 0 || body[from - 1].trim() === '')) to += 1;
    body.splice(from, to - from);
  }
  return body.join('\n').trim();
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
    'aus den echten Bausteinen (mit dem antd-Theme der App gerendert). Neu erzeugt mit',
    `\`${DESIGN_SYSTEM_COMMAND}\`. **Änderungen auf dieser Seite werden beim nächsten`,
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
  for (const { head, title, skip } of README_SECTIONS) {
    parts.push(`## ${title}`, '', cutSection(agents, head, skip), '');
  }
  for (const { head, title } of README_RULES) {
    parts.push(`## ${title}`, '', cutBullet(agents, head), '');
  }
  return `${parts.join('\n').trimEnd()}\n`;
}
