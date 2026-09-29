/**
 * Dichte-Guard (LFH-362 · B5b): keine punktuelle Klein-Angabe an interaktiven Elementen.
 *
 * ── Warum ──────────────────────────────────────────────────────────────────────
 * Die Bediendichte hängt am `ConfigProvider` (Staffel 30 / 48 / 72 px). Eine Größen-Prop AM
 * ELEMENT schlägt den Provider und nagelt die Trefffläche auf eine Stufe fest; der
 * Handschuh-Betrieb bekommt sie nicht mehr mit.
 *
 * ── Warum ein Vitest-Guard und keine ESLint-Regel ───────────────────────────────
 * `pnpm lint` läuft mit `--max-warnings 0`; eine rot geborene Regel wird abgeschaltet. Ein Guard
 * mit SCHULDMENGE ({@link OFFEN}) hält den Bestand sichtbar, ohne das Lint-Gate rot zu färben.
 *
 * ── Warum ein Tag-Scanner und keine Regex ───────────────────────────────────────
 * `<Button\b[^>]*size="small"` ist MEHRZEILIGEN Elementen blind, und `[^>]*` überquert kein `>`:
 * eine Pfeilfunktion VOR der Größen-Prop ließe den Treffer verschwinden.
 *
 * ── Warum das Element-Muster generische Typargumente kennt (LFH-364) ────────────
 * `<Select<number | null> size="small">`: hinter dem Namen steht ein `<`. Der Lookahead allein
 * genügt nicht, `tagEnde` nähme sonst das `>` des Typarguments als Tag-Ende. Deshalb überspringt
 * {@link generikEnde} das balancierte `<…>` zuerst.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Teil des Vertrags, nicht Beiwerk:
 *   • ein gespreiztes `{...props}`, das die Größe als Objektfeld trägt;
 *   • eine Größe aus einer Variablen (`size={klein}`) oder einem Ausdruck;
 *   • eine eigene Wrapper-Komponente, die die Prop intern setzt;
 *   • Elemente, die hier nicht als interaktiv gelistet sind ({@link INTERAKTIV});
 *   • einen FUNKTIONSTYP im Typargument (`<Select<(x: N) => S> size="small">`) — dessen `=>`
 *     beendet für {@link generikEnde} die Klammer zu früh; wer es einführt, umgeht die Norm;
 *   • eine geschweifte Klammer in einem REGEX-Literal einer Prop
 *     (`onClick={() => s.replace(/}/g, '')} size="small"`) — {@link tagEnde} kennt
 *     Zeichenketten, aber keine Regex-Literale, und beendet das Tag dort zu früh.
 *
 * ── Warum die Klein-Angaben an Karten, Beschreibungen und Listen STEHEN BLEIBEN ──
 * Als Regel, nicht als Restarbeit: ein Element außerhalb {@link INTERAKTIV} (`Card`,
 * `Descriptions`, `Space`, `Spin`) oder in {@link EIGENE_SEMANTIK} (`Liste`, `KatalogTabelle`)
 * trägt mit `size` eine POLSTERUNG, keine Trefffläche. Es gehört auch nicht in {@link OFFEN}:
 * ein Eintrag ohne Fund gilt dort als tote Schuld-Ausnahme und färbt den Guard rot.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDUNGEN = /\.(ts|tsx)$/;

/**
 * Elemente, deren Größen-Prop die TREFFFLÄCHE bestimmt. Flächen ohne Bedienfunktion (`Card`,
 * `Descriptions`, `Spin`, `Progress`, `Space`) fehlen bewusst: dort steuert die Prop Polsterung.
 */
const INTERAKTIV = [
  'Button',
  'Select',
  'Input',
  'Input.Search',
  'Input.TextArea',
  'InputNumber',
  'AutoComplete',
  'Cascader',
  'TreeSelect',
  'DatePicker',
  'TimePicker',
  'RangePicker',
  'Segmented',
  'Radio.Group',
  'Checkbox.Group',
  'Switch',
  'Slider',
  'Rate',
  'Upload',
  'Tabs',
  'Collapse',
  'Steps',
  'Pagination',
  'Space.Compact',
  'Table',
  'Transfer',
] as const;

/**
 * Projekt-Primitive, an denen die Größe eine ANDERE Bedeutung hat: bei `components/Liste.tsx`
 * ist sie ein Abstandsmaß der Karte (`Liste.test.tsx` prüft das über mehrere Dichtestufen).
 */
const EIGENE_SEMANTIK = ['Liste', 'KatalogTabelle'] as const;

/**
 * SCHULDMENGE — Dateien, die die Norm noch verletzen. Sie darf nur schrumpfen: ein Eintrag ohne
 * Verstoß gilt als Verstoß (siehe „tote Einträge").
 */
const OFFEN: string[] = [
  // UHS-Platzkarte (LFH-367/359/379): die VIER Knöpfe werden nur in `kompakt` gerendert, wo 24 px
  // der Gate-3-Boden sind; in `komfortabel`/`handschuh` ist die Karte selbst das eine Ziel mit
  // Aktionsmenü (`platzBedienform`). Die Zeile bleibt, weil dieser Guard Quelltext zählt und keine
  // Dichte kennt. Sie fiele erst, wenn die Zeilenform volle Steuerhöhe trüge, und die passt nicht
  // in den festen Innenraum der Karte (Rechnung im Dateikopf von `uhs/Grundriss.tsx`).
  '/src/pages/uhs/Grundriss.tsx',
  // Wer eine Klein-Angabe entfernt, prüft `aktionsabstand.guard.test.ts` mit: der Abbau kann eine
  // danger-Nachbarschaft erst entstehen lassen.
];

function lieseQuellen(verzeichnis: string, praefix = '/src'): Record<string, string> {
  const treffer: Record<string, string> = {};
  for (const eintrag of readdirSync(verzeichnis, { withFileTypes: true })) {
    const pfad = join(verzeichnis, eintrag.name);
    if (eintrag.isDirectory()) {
      Object.assign(treffer, lieseQuellen(pfad, `${praefix}/${eintrag.name}`));
    } else if (ENDUNGEN.test(eintrag.name)) {
      treffer[`${praefix}/${eintrag.name}`] = readFileSync(pfad, 'utf8');
    }
  }
  return treffer;
}

/**
 * Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen — ohne das zählte dieser
 * Dateikopf seine eigenen Beispiele.
 */
function ohneKommentare(inhalt: string): string {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of inhalt.split('\n')) {
    let rest = roh;
    let sichtbar = '';
    while (rest.length > 0) {
      if (imBlock) {
        const ende = rest.indexOf('*/');
        if (ende === -1) break;
        imBlock = false;
        rest = rest.slice(ende + 2);
        continue;
      }
      const block = rest.indexOf('/*');
      const einzeilig = rest.indexOf('//');
      if (block === -1 && einzeilig === -1) {
        sichtbar += rest;
        break;
      }
      if (einzeilig !== -1 && (block === -1 || einzeilig < block)) {
        sichtbar += rest.slice(0, einzeilig);
        break;
      }
      sichtbar += rest.slice(0, block);
      rest = rest.slice(block + 2);
      imBlock = true;
    }
    zeilen.push(sichtbar);
  }
  return zeilen.join('\n');
}

function istTest(pfad: string): boolean {
  return /\.test\.[jt]sx?$/.test(pfad) || /\.generated\.[jt]sx?$/.test(pfad);
}

/**
 * Ende des öffnenden JSX-Tags ab `start` (Index des `<`), oder `-1`.
 *
 * Zählt geschweifte Klammern mit und überspringt Zeichenketten — sonst beendete das `>` einer
 * Pfeilfunktion (`onClick={() => tu()}`) das Tag vor der gesuchten Prop.
 */
export function tagEnde(text: string, start: number): number {
  let tiefe = 0;
  let anfuehrung: string | null = null;
  for (let i = start; i < text.length; i++) {
    const z = text[i];
    if (anfuehrung) {
      if (z === '\\') i++;
      else if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') anfuehrung = z;
    else if (z === '{') tiefe++;
    else if (z === '}') tiefe--;
    else if (z === '>' && tiefe === 0) return i;
  }
  return -1;
}

/**
 * Index HINTER dem balancierten `<…>` eines generischen Typarguments; `start` zeigt auf das
 * öffnende `<`. `-1`, wenn es nicht schließt. Nötig, weil `tagEnde` das erste `>` auf Tiefe 0
 * nimmt, bei `<Select<number | null> size="small">` also das des Typarguments.
 */
export function generikEnde(text: string, start: number): number {
  let tiefe = 0;
  let anfuehrung: string | null = null;
  for (let i = start; i < text.length; i++) {
    const z = text[i];
    if (anfuehrung) {
      if (z === '\\') i++;
      else if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') anfuehrung = z;
    else if (z === '<') tiefe++;
    else if (z === '>') {
      tiefe--;
      if (tiefe === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Reduziert einen Tag-Text auf seine ATTRIBUT-Ebene: jeder `{…}`-Ausdruck, der mehr als ein
 * nacktes Stringliteral enthält, wird zu `{}`. Sonst zählte eine Klein-Angabe eines
 * VERSCHACHTELTEN Elements (`items={[{ children: <Descriptions size="small" …> }]}`) dem
 * äußeren zu, und der Guard ließe den Verstoß nicht mehr los.
 *
 * `{'small'}` bleibt erhalten — die geklammerte Schreibweise ist ein echter Verstoß. Alles
 * Berechnete (`size={klein}`) fällt weg und ist dokumentierter Blindfleck.
 */
export function attributEbene(tag: string): string {
  let raus = '';
  let anfuehrung: string | null = null;
  for (let i = 0; i < tag.length; i++) {
    const z = tag[i];
    if (anfuehrung) {
      raus += z;
      if (z === '\\') {
        raus += tag[++i] ?? '';
        continue;
      }
      if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') {
      anfuehrung = z;
      raus += z;
      continue;
    }
    if (z !== '{') {
      raus += z;
      continue;
    }
    // Balancierten Ausdruck greifen und entscheiden, ob er wörtlich genug ist. Die Bilanz MUSS
    // Zeichenketten überspringen: sonst verschluckte `<Button title={x ? "{" : ""} size="small" />`
    // den Rest des Tags samt Klein-Angabe.
    let tiefe = 0;
    let j = i;
    let inner: string | null = null;
    for (; j < tag.length; j++) {
      const y = tag[j];
      if (inner) {
        if (y === '\\') j++;
        else if (y === inner) inner = null;
        continue;
      }
      if (y === '"' || y === "'" || y === '`') inner = y;
      else if (y === '{') tiefe++;
      else if (y === '}' && --tiefe === 0) break;
    }
    const inhalt = tag.slice(i + 1, j).trim();
    raus += /^["'][^"']*["']$/.test(inhalt) ? `{${inhalt}}` : '{}';
    i = j;
  }
  return raus;
}

/** Trägt der Tag-Text eine wörtliche Klein-Angabe? Deckt `"…"`, `'…'` und `{…}` ab. */
function tragtKleinAngabe(tag: string): boolean {
  return /\bsize\s*=\s*(?:["']small["']|\{\s*["']small["']\s*\})/.test(attributEbene(tag));
}

export interface Stelle {
  pfad: string;
  zeile: number;
  element: string;
}

/**
 * Vollständige Regex-Maskierung eines Elementnamens. Eine Maskierung nur des Punkts
 * (`Space.Compact`) erzeugte bei einem anderen Metazeichen ein still falsch zählendes Muster:
 * „nichts gefunden" ist von „kein Verstoß" nicht zu unterscheiden.
 */
function regexMaskiert(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Alle Verstöße einer Datei. Rein, damit der Selbstbeweis sie ohne Dateisystem prüfen kann. */
export function stellenIn(pfad: string, quelltext: string): Stelle[] {
  const text = ohneKommentare(quelltext);
  const gefunden: Stelle[] = [];
  for (const element of INTERAKTIV) {
    // Punkte im Namen (`Space.Compact`) sind wörtlich zu nehmen. Das `<` im Lookahead
    // lässt generische Typargumente zu (`<Select<T> …>`), siehe Dateikopf.
    const muster = new RegExp(`<${regexMaskiert(element)}(?=[\\s/>{<])`, 'g');
    for (const treffer of text.matchAll(muster)) {
      const start = treffer.index;
      // Ein Typargument zuerst überspringen, sonst endet der Tag-Text an dessen `>`.
      const nachName = start + 1 + element.length;
      const propsAb = text[nachName] === '<' ? generikEnde(text, nachName) : nachName;
      if (propsAb === -1) continue;
      const ende = tagEnde(text, propsAb);
      if (ende === -1) continue;
      const tag = text.slice(start, ende + 1);
      if (!tragtKleinAngabe(tag)) continue;
      gefunden.push({
        pfad,
        element,
        zeile: text.slice(0, start).split('\n').length,
      });
    }
  }
  return gefunden;
}

export function befunde(dateien: Record<string, string>, offen: readonly string[]): string[] {
  const meldungen: string[] = [];
  const belegt = new Set<string>();

  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (istTest(pfad)) continue;
    const stellen = stellenIn(pfad, inhalt);
    if (stellen.length === 0) continue;
    if (offen.includes(pfad)) {
      belegt.add(pfad);
      continue;
    }
    for (const s of stellen) {
      meldungen.push(`${s.pfad}:${s.zeile}  <${s.element}> trägt eine punktuelle Klein-Angabe`);
    }
  }

  // Ein Eintrag ohne Verstoß ist selbst einer: sonst überlebt die Schuldmenge ihre Schuld.
  for (const eintrag of offen) {
    if (!belegt.has(eintrag)) meldungen.push(`tote Schuld-Ausnahme: ${eintrag}`);
  }
  return meldungen;
}

const dateien = lieseQuellen(SRC);

describe('Dichte-Guard (LFH-362 · B5b)', () => {
  it('kein interaktives Element nagelt seine Trefffläche auf eine Größe fest', () => {
    expect(befunde(dateien, OFFEN)).toEqual([]);
  });

  it('die Schuldmenge schrumpft nur — jeder Eintrag ist noch belegt', () => {
    const tote = befunde(dateien, OFFEN).filter((m) => m.startsWith('tote Schuld-Ausnahme'));
    expect(tote).toEqual([]);
  });

  // ── Selbstbeweise: ein Guard, der nichts findet, ist von einem kaputten nicht zu
  //    unterscheiden. Die Fälle sind die, an denen eine Regex scheitert.
  it('findet die Angabe auch, wenn das Element über mehrere Zeilen geht', () => {
    const quelle = ['<Button', '  type="text"', '  size="small"', '>Weg</Button>'].join('\n');
    expect(stellenIn('/src/x.tsx', quelle)).toHaveLength(1);
  });

  it('findet sie auch hinter einer Pfeilfunktion — deren > beendet das Tag nicht', () => {
    const quelle = '<Button onClick={() => tu()} size="small">Weg</Button>';
    expect(stellenIn('/src/x.tsx', quelle)).toHaveLength(1);
  });

  it('nimmt die geklammerte Schreibweise mit', () => {
    expect(stellenIn('/src/x.tsx', "<Select size={'small'} />")).toHaveLength(1);
  });

  // Ein reiner Lookahead-Fix ließe den ersten Fall durch und den zweiten scheitern: das
  // Typargument-`>` verkürzte den Tag-Text vor die Prop.
  it('findet sie hinter einem generischen Typargument', () => {
    expect(stellenIn('/src/x.tsx', '<Select<number | null> size="small" />')).toHaveLength(1);
  });

  it('findet sie auch bei mehrzeiligem Element mit Typargument', () => {
    const quelle = ['<Select<number | null>', '  allowClear', '  size="small"', '/>'].join('\n');
    expect(stellenIn('/src/x.tsx', quelle)).toHaveLength(1);
  });

  it('lässt ein Typargument OHNE Klein-Angabe in Ruhe', () => {
    expect(stellenIn('/src/x.tsx', '<Select<number> allowClear />')).toEqual([]);
  });

  it('überspringt verschachtelte Typargumente balanciert', () => {
    expect(stellenIn('/src/x.tsx', '<Select<Map<string, number>> size="small" />')).toHaveLength(1);
  });

  // Die Angabe eines VERSCHACHTELTEN Elements gehört nicht dem äußeren (`attributEbene`).
  it('rechnet eine Angabe aus einer Prop-Expression nicht dem äußeren Element zu', () => {
    const quelle = '<Collapse ghost items={[{ children: <Descriptions size="small" /> }]} />';
    expect(stellenIn('/src/x.tsx', quelle)).toEqual([]);
  });

  it('meldet das äußere Element dennoch, wenn es SELBST eine Angabe trägt', () => {
    const quelle =
      '<Collapse size="small" items={[{ children: <Descriptions size="small" /> }]} />';
    expect(stellenIn('/src/x.tsx', quelle)).toHaveLength(1);
  });

  // Die Kehrseite von `attributEbene`: seine Klammer-Bilanz muss Zeichenketten überspringen,
  // sonst verschluckt eine Klammer IM STRING den Rest des Tags.
  it('lässt sich von einer geschweiften Klammer in einer Zeichenkette nicht abschütteln', () => {
    expect(stellenIn('/src/x.tsx', '<Button title={x ? "{" : ""} size="small" />')).toHaveLength(1);
    expect(stellenIn('/src/x.tsx', '<Button title={"}"} size="small" />')).toHaveLength(1);
  });

  it('gilt auch für ein Schablonen-Literal mit Klammer', () => {
    expect(stellenIn('/src/x.tsx', '<Button aria-label={`a { b`} size="small" />')).toHaveLength(1);
  });

  it('lässt Flächen ohne Bedienfunktion und die Projekt-Primitive in Ruhe', () => {
    const quelle = [
      '<Card size="small" />',
      ...EIGENE_SEMANTIK.map((e) => `<${e} size="small" />`),
    ].join('\n');
    expect(stellenIn('/src/x.tsx', quelle)).toEqual([]);
  });

  it('übersieht eine Angabe im Kommentar', () => {
    expect(stellenIn('/src/x.tsx', '// <Button size="small" />')).toEqual([]);
  });
});
