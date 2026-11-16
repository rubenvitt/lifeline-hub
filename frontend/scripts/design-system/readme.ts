/**
 * README des Design Systems aus den Regeln in `frontend/AGENTS.md` (design.md D3). Die Regeln
 * stehen weiter genau einmal im Repo; die README ist eine erzeugte Ausgabe. Fehlt ein Abschnitt,
 * bricht der Generator ab, statt still eine kürzere README zu schreiben.
 */
import type { Omitted } from './tokens';

/** Der Befehl, der das Design System neu erzeugt (Node und pnpm aus `mise.toml`, LFH-773). */
export const DESIGN_SYSTEM_COMMAND = 'mise exec -- pnpm -C frontend design-system';

/** Kopf des Abschnitts „Bausteinwahl“ in `frontend/AGENTS.md`: Bedarf → Baustein → Karte. */
export const BAUSTEINWAHL_HEAD = '## Frontend — Bausteinwahl (wann nehme ich was)';

/**
 * Die Abschnitte von `frontend/AGENTS.md`, die die README trägt, in dieser Reihenfolge. Ein
 * Abschnitt beginnt mit einer Zeile, die so anfängt (`## …` oder ein fetter Absatzkopf), und endet
 * vor dem nächsten `## …` oder dem nächsten fetten Absatzkopf nach einer Leerzeile. `skip` nennt
 * Spiegelstriche, die keine Gestaltungsregel sind: der Ablauf für Agenten im Repo (Entwerfen,
 * Erzeugen, Veröffentlichen) gehört nicht in die README, die ein `/design`-Agent zuerst liest.
 */
export const README_SECTIONS: readonly { head: string; title: string; skip?: readonly string[] }[] =
  [
    // Zuerst die Frage „welcher Baustein?“ (LLH-1807, Spec `design-system-artifact`).
    { head: BAUSTEINWAHL_HEAD, title: 'Bausteinwahl: wann nehme ich was' },
    {
      head: '## Frontend — Gestaltungssprache',
      title: 'Gestaltungssprache',
      // Kriterium (LLH-1807, design.md D3): Sähe ein Entwurf ohne den Strich anders aus? Wenn nein,
      // fällt er aus der README. Abläufe im Repo, Modulstruktur, Namen und Datenherkunft; die
      // Bausteinlisten trägt die Bausteinwahl, kartenbezogene Regeln stehen an ihrer Karte
      // (`regeln` bzw. `ruleHead` in `previews.tsx`).
      skip: [
        'Größere UI-Entwürfe über das Design System',
        'Bausteine',
        'Bausteine außerhalb von `instrument/`',
        'Seitenkopf',
        'Modulstruktur',
        'Synonyme',
        'Ein Name je Modul',
        'Kennzahlenband',
        'Dashboard-Baukasten',
        'Eine Heimat je Zahl',
        'Eine Baumlogik der Kräfte: `kraefte/kraeftebaumKern.ts`',
      ],
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
  ];
  // Die README beginnt mit der Bausteinwahl (Spec `design-system-artifact`): erst „welcher
  // Baustein?“, dann die Liste der Karten und die Regeln.
  const [bausteinwahl, ...regeln] = README_SECTIONS;
  parts.push(
    `## ${bausteinwahl.title}`,
    '',
    ohneVerweise(cutSection(agents, bausteinwahl.head, bausteinwahl.skip)),
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
  );
  for (const { head, title, skip } of regeln) {
    parts.push(`## ${title}`, '', ohneVerweise(cutSection(agents, head, skip)), '');
  }
  for (const { head, title } of README_RULES) {
    parts.push(`## ${title}`, '', ohneVerweise(cutBullet(agents, head)), '');
  }
  const readme = `${parts.join('\n').trimEnd()}\n`;
  pruefeOhneTicket(readme);
  return readme;
}

/**
 * Bricht ab, wenn nach dem Filter noch eine Ticketnummer, ein Spec- oder ein Herleitungsverweis in
 * der README steht: dann den Filter
 * schärfen oder in `frontend/AGENTS.md` den Verweis in eine Klammer stellen (Spec
 * `design-system-artifact`).
 */
export function pruefeOhneTicket(readme: string): void {
  const zeilen = readme.split('\n');
  // Über den ganzen Text, nicht je Zeile: ein Verweis bricht in `frontend/AGENTS.md` oft um.
  const reste = [
    ...readme.matchAll(/\b(?:LFH|LLH)-\d+|\bSpec\s+`|`openspec\/changes|\bHerleitung[:\s]/g),
  ].map((m) => {
    const zeile = readme.slice(0, m.index).split('\n').length;
    return { zeile, text: zeilen[zeile - 1] };
  });
  if (reste.length > 0) {
    throw new Error(
      'Design System: Ticket-, Spec- oder Herleitungsverweis in der README nach dem Verweisfilter:\n' +
        reste.map((r) => `  README.md:${r.zeile}  ${r.text.trim()}`).join('\n'),
    );
  }
}

/**
 * Die Karten, die die Bausteinwahl nennt: Namen in Codeschrift in der dritten Spalte ihrer
 * Tabelle. Gruppenzeilen und „—“ (Bedarf ohne Karte) tragen keine.
 */
export function kartenDerBausteinwahl(agents: string): string[] {
  const karten: string[] = [];
  for (const zeile of cutSection(agents, BAUSTEINWAHL_HEAD).split('\n')) {
    if (!zeile.startsWith('|') || /^\|\s*-{3}/.test(zeile)) continue;
    const zellen = zeile.split('|').map((z) => z.trim());
    // ['', Bedarf, Baustein, Karte, '']
    const karte = zellen[3] ?? '';
    if (karte === 'Karte') continue;
    for (const m of karte.matchAll(/`([^`]+)`/g)) karten.push(m[1]);
  }
  return karten;
}

/** Die Karten, die keine Zeile der Bausteinwahl brauchen. */
const OHNE_BAUSTEINWAHL = new Set(['Cover']);

/**
 * Befunde, wenn Bausteinwahl und Karten auseinanderlaufen (Spec `design-system-artifact`,
 * „Bausteinwahl und Karten sind deckungsgleich“). Leer = in Ordnung.
 */
export function abdeckung(bausteinwahl: readonly string[], karten: readonly string[]): string[] {
  const genannt = new Set(bausteinwahl);
  const vorhanden = new Set(karten);
  return [
    ...karten
      .filter((k) => !OHNE_BAUSTEINWAHL.has(k) && !genannt.has(k))
      .map((k) => `Karte „${k}“ fehlt in der Bausteinwahl von frontend/AGENTS.md`),
    ...[...genannt]
      .filter((k) => !vorhanden.has(k))
      .map((k) => `Bausteinwahl nennt die Karte „${k}“, die es im Design System nicht gibt`),
  ];
}

const TICKET = String.raw`(?:LFH|LLH)-\d+(?:…\d+)?`;
const TICKETS = String.raw`${TICKET}(?:[ /·]+(?:[A-Z]\d+[a-z]?|${TICKET}))*(?: Punkt [\d–-]+)?(?: D\d+)?`;
/**
 * Ein Verweis: Ticket (mit Entscheidung, Punkt oder Phase), ADR, Spec, Pfad in Doku, Archiv oder
 * Tests, Wächter, Zunder-Kurzkennung, Entscheidungskürzel, Datum, „löst … ab“, „schreibt … fort“,
 * „seit …“, „Rollout …“.
 */
const VERWEIS = [
  String.raw`(?:Epic |seit |Rollout )?${TICKETS}`,
  String.raw`ADR-\d{4}`,
  String.raw`Spec\s+\`[^\`]+\``,
  String.raw`\`(?:docs|openspec|\.claude|e2e)/[^\`]*\`(?: „[^“]*“)?`,
  String.raw`(?:(?:Guard|Wächter) \d* ?in )?\`[^\`]*\.(?:guard\.)?test\.tsx?\``,
  // Zunder-Kurzkennung: 8 Zeichen mit mindestens einer Ziffer, sonst träfe es Wörter („gemessen“).
  String.raw`(?=[a-z]*\d)[a-z0-9]{8}(?: D\d+)?`,
  String.raw`D\d+`,
  String.raw`\d{1,2}\.\d{1,2}\.\d{4}`,
  String.raw`Entscheidungen? E\d+(?:–E\d+)? aus ${TICKET}`,
  String.raw`(?:löst|ersetzt) .*${TICKET}.*?(?: ab)?`,
  String.raw`schreibt .*${TICKET}.* fort`,
  String.raw`Herleitung[:\s][\s\S]*`,
].join('|');
const VERWEIS_GLIED = new RegExp(`^(?:${VERWEIS})$`);
/** Ein Verweis vor einem Doppelpunkt: der Inhalt dahinter bleibt („LFH-593: Ebenen-Identität“). */
const VERWEIS_PRAEFIX = new RegExp(`^(?:${VERWEIS}):\\s+([\\s\\S]+)$`);

/** Teilt den Inhalt einer Klammer an `, ` und `; ` (auch vor einem Zeilenumbruch) in Glieder. */
function glieder(inhalt: string): { trenner: string; text: string }[] {
  const teile: { trenner: string; text: string }[] = [];
  let trenner = '';
  let start = 0;
  let inCode = false;
  let inZitat = false;
  for (let i = 0; i < inhalt.length; i += 1) {
    const c = inhalt[i];
    if (c === '`') inCode = !inCode;
    else if (c === '„') inZitat = true;
    else if (c === '“') inZitat = false;
    else if ((c === ',' || c === ';') && /\s/.test(inhalt[i + 1] ?? '') && !inCode && !inZitat) {
      teile.push({ trenner, text: inhalt.slice(start, i).trim() });
      trenner = `${c} `;
      let j = i + 1;
      while (j < inhalt.length && /\s/.test(inhalt[j])) j += 1;
      start = j;
      i = j - 1;
    }
  }
  teile.push({ trenner, text: inhalt.slice(start).trim() });
  return teile;
}

/** Eine Klammer ohne ihre Verweise, oder `null`, wenn sie keinen trägt. */
function klammerOhneVerweise(inhalt: string): string | null {
  const teile = glieder(inhalt);
  const bleibt: { trenner: string; text: string }[] = [];
  let geaendert = false;
  let vorherSpec = false;
  for (const teil of teile) {
    const praefix = VERWEIS_PRAEFIX.exec(teil.text);
    const istVerweis: boolean =
      VERWEIS_GLIED.test(teil.text) || (vorherSpec && /^„[^“]*“$/.test(teil.text));
    vorherSpec = istVerweis && teil.text.startsWith('Spec ');
    if (istVerweis) geaendert = true;
    else if (praefix) {
      geaendert = true;
      bleibt.push({ trenner: teil.trenner, text: praefix[1] });
    } else bleibt.push(teil);
  }
  if (!geaendert) return null;
  return bleibt.map((t, i) => (i === 0 ? t.text : `${t.trenner}${t.text}`)).join('');
}

const AUF = '\u0001';
const ZU = '\u0002';

/**
 * Die README ohne Ticketnummern, Spec- und Herleitungsverweise (Spec `design-system-artifact`):
 * eine Klammer aus lauter Verweisen fällt ganz, eine gemischte verliert nur ihre Verweisglieder;
 * ein Verweis vor einem Doppelpunkt fällt, der Inhalt dahinter bleibt. Ein Zitat direkt hinter
 * einem gefallenen Spec-Verweis ist dessen Anforderung und fällt mit. Klammern werden von innen
 * nach außen gelesen. In `frontend/AGENTS.md` bleiben die Verweise als Prüfspur stehen.
 */
export function ohneVerweise(text: string): string {
  // Ein Herleitungssatz ohne Klammer („Herleitung: `openspec/…`.“) fällt ganz.
  let rest = text.replace(/\s*Herleitung:\s*`[^`]*`(?:,\s*`[^`]*`)*\.?/g, '');
  for (;;) {
    // Der Leerraum davor fällt mit einer ganz gestrichenen Klammer, auch ein Zeilenumbruch.
    const innen = /(\s*)\(([^()]*)\)/.exec(rest);
    if (!innen) break;
    const ohne = klammerOhneVerweise(innen[2]);
    const vorn = innen[1];
    const ersatz =
      ohne === null
        ? `${vorn}${AUF}${innen[2]}${ZU}`
        : ohne === ''
          ? ''
          : `${vorn}${AUF}${ohne}${ZU}`;
    rest = rest.slice(0, innen.index) + ersatz + rest.slice(innen.index + innen[0].length);
  }
  return rest.split(AUF).join('(').split(ZU).join(')');
}
