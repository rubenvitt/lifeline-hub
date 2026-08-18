/**
 * Dichte-Guard (LFH-362 · B5b): keine punktuelle Klein-Angabe an interaktiven Elementen.
 *
 * ── Warum es diesen Guard gibt ──────────────────────────────────────────────────
 * Die Bediendichte hängt seit LFH-329/B1 am `ConfigProvider` und trägt alle
 * Steuerelemente auf einmal (Staffel 30 / 48 / 72 px). Eine Größen-Prop AM ELEMENT
 * schlägt den Provider (`antd/es/button/Button.js`) und nagelt die Trefffläche auf
 * eine Stufe fest — der Handschuh-Betrieb bekommt sie dann nicht mehr mit. CLAUDE.md
 * verbietet das als Norm; hier wird die Norm maschinell.
 *
 * ── Warum ein Vitest-Guard und keine ESLint-Regel ───────────────────────────────
 * `pnpm lint` läuft mit `--max-warnings 0`. Eine Regel, die am Liefertag 82-mal
 * feuert, wird abgeschaltet statt befolgt — und auf „schon saubere Verzeichnisse"
 * gescopt bewiese sie nichts über den Bestand. Ein Guard mit SCHULDMENGE
 * ({@link OFFEN}) hält den Bestand sichtbar, ohne das Lint-Gate rot zu färben, und
 * schrumpft mit jedem Verzeichnis-Bündel von LFH-333. Bauform nach
 * `datensicht.guard.test.ts`.
 *
 * ── Warum ein Tag-Scanner und keine Regex ───────────────────────────────────────
 * Das naheliegende `<Button\b[^>]*size="small"` ist MEHRZEILIGEN Elementen blind:
 * gemessen am 30.07.2026 fand es 61 Stellen, der Scanner hier 82 — 21 Knöpfe standen
 * unsichtbar da, u. a. in `SnapshotLeiste.tsx` und `uhs/Grundriss.tsx`. Schlimmer:
 * `[^>]*` überquert kein `>`, also verschwindet ein Treffer auch, sobald eine
 * Pfeilfunktion VOR der Größen-Prop steht. Ein Gate, das eine Zeilenumbruch-Änderung
 * für Fortschritt hält, misst nicht das, wofür es existiert.
 *
 * ── Warum das Element-Muster generische Typargumente kennt (LFH-364 · B5d) ──────
 * `<Select<number | null> size="small">` schrieb sich am Guard vorbei: das Muster
 * verlangte hinter dem Namen ein `[\s/>{]`, und ein `<` ist keins davon. Gemessen
 * am 30.07.2026 versteckte diese eine Lücke 4 Stellen — darunter genau den Select,
 * den LFH-364 ausdrücklich mitnehmen sollte, und einen Verstoß in
 * `personen/personenSpalten.tsx`, der in keiner Schuldzeile stand.
 * Der Lookahead allein genügt NICHT: `tagEnde` nähme dann das `>` des Typarguments
 * für das Tag-Ende, und die Prop dahinter bliebe unsichtbar. Deshalb überspringt
 * {@link generikEnde} das balancierte `<…>` zuerst.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Teil des Vertrags, nicht Beiwerk:
 *   • ein gespreiztes `{...props}`, das die Größe als Objektfeld trägt;
 *   • eine Größe aus einer Variablen (`size={klein}`) oder einem Ausdruck;
 *   • eine eigene Wrapper-Komponente, die die Prop intern setzt;
 *   • Elemente, die hier nicht als interaktiv gelistet sind ({@link INTERAKTIV});
 *   • einen FUNKTIONSTYP im Typargument (`<Select<(x: N) => S> size="small">`) —
 *     dessen `=>` beendet für {@link generikEnde} die Klammer zu früh. Im Bestand
 *     kommt das an keiner der 25 Generic-Stellen vor; wer es einführt, umgeht die
 *     Norm;
 *   • eine geschweifte Klammer in einem REGEX-Literal einer Prop
 *     (`onClick={() => s.replace(/}/g, '')} size="small"`) — {@link tagEnde} kennt
 *     Zeichenketten, aber keine Regex-Literale, und beendet das Tag dort zu früh.
 *     Altlast, unabhängig von LFH-364 (der Scanner davor war genauso blind).
 *
 * ── Warum die Klein-Angaben an Karten, Beschreibungen und Listen STEHEN BLEIBEN ──
 * Nicht als Restarbeit, sondern als Regel — sonst vergrößert der nächste Sweep
 * Flächen, die niemand antippt. Ein Element, das nicht in {@link INTERAKTIV} steht
 * (`Card`, `Descriptions`, `Space`, `Spin`) oder in {@link EIGENE_SEMANTIK}
 * (`Liste`, `KatalogTabelle`), trägt mit `size` eine POLSTERUNG, keine Trefffläche.
 * Es gehört deshalb auch nicht in {@link OFFEN}: `befunde` markiert einen Eintrag nur
 * als belegt, wenn {@link stellenIn} dort etwas findet — ein Eintrag für eine
 * nicht-interaktive Fläche wäre also sofort eine „tote Schuld-Ausnahme" und färbte
 * den Guard rot. Wer diese Ausnahme dokumentieren will, tut es hier und nicht in der
 * Schuldliste. (Das AK von LFH-364 verlangte genau das Gegenteil und war darin
 * falsch; es sprach zudem von „drei" Karten, während allein das B5d-Bündel zwölf
 * trägt — eine handgezählte Inventarliste verrottet, die Regel nicht.)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDUNGEN = /\.(ts|tsx)$/;

/**
 * Elemente, deren Größen-Prop die TREFFFLÄCHE bestimmt.
 *
 * Bewusst NICHT enthalten sind Flächen ohne Bedienfunktion (`Card`,
 * `Descriptions`, `Spin`, `Progress`, `Space`): dort steuert die Prop Polsterung,
 * keine Trefffläche, und ein Verbot vergrößerte nur die Karten.
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
 * Projekt-Primitive, an denen die Größe eine ANDERE Bedeutung hat: bei
 * `components/Liste.tsx` ist sie ein Abstandsmaß der Karte, keine antd-Trefffläche
 * — `Liste.test.tsx` prüft das über mehrere Dichtestufen ausdrücklich. Sie stehen
 * deshalb nicht in {@link INTERAKTIV}; ein elementunabhängiger Scanner drehte eine
 * getestete Entscheidung zurück.
 */
const EIGENE_SEMANTIK = ['Liste', 'KatalogTabelle'] as const;

/**
 * SCHULDMENGE — Dateien, die die Norm heute noch verletzen (Stand 30.07.2026,
 * LFH-362). Jede Zeile fällt mit ihrem Verzeichnis-Bündel aus LFH-333:
 * B5c stammdaten/+Verwaltung · B5d Kommunikationskarten · B5e ETB ·
 * B5f Lagekarte/Karten · B5g UHS · B5h Gefahren · B5i Kräfte-Listen · B5j Rest.
 *
 * Die Liste ist eine SCHULD, kein Freibrief: sie darf nur schrumpfen. Ein Eintrag
 * ohne Verstoß gilt als Verstoß (siehe „tote Einträge"), damit sie nicht
 * stillschweigend zur Dauerausnahme wird.
 */
const OFFEN: string[] = [
  // B5c (stammdaten/ und Verwaltung) ist mit LFH-363 abgetragen — 24 Stellen in
  // 10 Dateien. Der Abstand zur destruktiven Nachbaraktion, der dort auf denselben
  // Zeilen saß, hält seither `aktionsabstand.guard.test.ts`.
  // ── B5d · Kommunikationskarten (LFH-364) ── ABGERÄUMT, 24 Stellen in 12 Dateien.
  // ── B5e · Einsatztagebuch (LFH-365) ── ABGERÄUMT, 8 Stellen in 3 Dateien.
  // Darunter der `Space.Compact`-Wrapper in `etb/MetaChip.tsx`: er trug die Kleingröße
  // auch den Kindern OHNE eigene Größen-Prop auf (`antd/es/space/Compact.js` über
  // `SpaceCompactItemContext`), ein Entfernen nur am Knopf darin wäre also wirkungslos
  // geblieben. Der Wrapper steht in {@link INTERAKTIV} und war damit ein gezählter
  // Verstoß, keine Ermessensfrage.
  // ── B5f · Lagekarte und Kartenverwaltung (LFH-366) ── ABGERÄUMT, 16 Stellen in 6 Dateien.
  // Die sechs schwierigen Entscheidungen stehen als Kommentar an ihrer jeweiligen Stelle, weil
  // keine von ihnen aus einer Prop-Zählung folgt: die schwebende `SnapshotLeiste` (grössere
  // Knöpfe verdecken Kartenfläche — sie klappt dafür ein), das Eingabefeld im Titel einer
  // Listenzeile (`OfflineVorhandeneModal`), der Schliess-Knopf einer `Card`, die weiterhin
  // klein bleibt (`KartenDetailCard`), und zwei danger-Nachbarschaften, die jetzt
  // `aktionsabstand.guard.test.ts` hält. `Sidebar.tsx` stand hier NIE — der Befund M61 des
  // Elterntickets („38× size=small") war zum Liefertag überholt; die Datei trug 0 Verstöße,
  // ihre 15 Angaben sitzen auf `Card`/`Liste`/`Spin` und bleiben nach der Regel oben stehen.
  // ── B5g · UHS-Grundriss (LFH-367) ── TEILWEISE ABGERÄUMT ──────────────────
  // `MaterialTab.tsx` ist raus (1 Stelle): der Lösen-Knopf sass in einer Tabellenzelle,
  // die mit der Dichtestufe wachsen darf. Was bleibt, sind die VIER Knöpfe der
  // Platzkarte — und die sind kein Ermessen: ihre Höhe hängt an der Backend-Konstante
  // SCHRITT_Y, die Rechnung steht im Dateikopf von `uhs/Grundriss.tsx` (LFH-328/A2).
  // Die Karte kann in KEINER Dichtestufe ein Element auf voller Zeilenhöhe tragen —
  // „alles ins Dropdown" löst es deshalb auch nicht, dessen Auslöser bräuchte sie
  // ebenfalls. Diese Zeile fällt erst mit einer Änderung an `raster_position`.
  '/src/pages/uhs/Grundriss.tsx',
  // ── B5h · Gefahren (LFH-368) ── ABGERÄUMT, 5 Stellen in 2 Dateien.
  // Darunter das rohe `<Table>` selbst (`Table` steht in {@link INTERAKTIV}) und der
  // `Select` je Zelle, den ein einziger dichte-treuer Auslöser ersetzt hat. Die
  // `Liste size="small"` in `GefahrenPage.tsx` zählte korrekt NICHT mit — sie steht in
  // {@link EIGENE_SEMANTIK} und trägt dort ein Abstandsmaß, keine Trefffläche.
  // ── B5i · Kräfte-Listen (LFH-369) ── ABGERÄUMT mit LFH-339 · C4 ───────────
  // Die eine verbliebene Stelle war das Mengen-Eingabefeld in `MaterialPage.tsx`. Sie
  // fiel, weil C4 die Datei ohnehin anfasste (Statuswechsel) — die Breite von 80 px
  // bleibt, sie trägt eine zweistellige Menge und keine Trefffläche.
  //
  // Damit ist die Schuldmenge auf die EINE geprüfte Dauerausnahme geschrumpft: die vier
  // Knöpfe der UHS-Platzkarte, deren Höhe an der Backend-Konstante SCHRITT_Y hängt.
  // ── B5j · Rest: Kopfzeile, Profil, Editor, Sonstiges (LFH-370) ────────────
  // ABGERÄUMT: 14 Stellen in 9 Dateien (MarkdownEditor, SprechgruppenPicker, AlarmZentrale,
  // LoginPage, ProfilPage, SchaedenDetailPage, TiereDetailPage, KraefteOhneBrSidebar,
  // personenSpalten).
  //
  // Drei Dinge, die dabei gelernt wurden und die nächste Stelle betreffen:
  //  - Die zwei danger-Nachbarschaften (SchaedenDetailPage, TiereDetailPage) sind ERST durch
  //    den Abbau entstanden und hängen seither an `aktionsabstand.guard.test.ts`. Eine
  //    Klein-Angabe zu entfernen kann eine Abstandsfrage aufwerfen, die vorher keine war.
  //  - `personenSpalten.tsx` war der Fund des Scanner-Fix von LFH-364 (`<Select<…>` schrieb
  //    sich am Lookahead vorbei), nicht neu entstanden.
  //  - Der Dev-Schnellanmeldungs-Knopf in `LoginPage.tsx` steht hinter `import.meta.env.DEV`
  //    und folgt trotzdem der Staffel: der Dev-Build ist derselbe Betrieb, und ein Knopf, der
  //    nur für Entwickler zu klein ist, ist immer noch zu klein.
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
 * Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen.
 * Kopie aus `datensicht.guard.test.ts` — ohne sie zählte dieser Dateikopf seine
 * eigenen Beispiele als Verstoß.
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
 * Zählt geschweifte Klammern mit und überspringt Zeichenketten — sonst beendete
 * das `>` einer Pfeilfunktion (`onClick={() => tu()}`) das Tag zu früh, und genau
 * dahinter versteckt sich die Prop, die wir suchen.
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
 * Index HINTER dem balancierten `<…>` eines generischen Typarguments; `start` zeigt
 * auf das öffnende `<`. `-1`, wenn es nicht schließt.
 *
 * Nötig, weil `tagEnde` das erste `>` auf Klammertiefe 0 nimmt — und das ist bei
 * `<Select<number | null> size="small">` das des TYPARGUMENTS, nicht das des Tags.
 * Ohne diesen Vorlauf endete der Tag-Text vor der Prop.
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
 * Reduziert einen Tag-Text auf seine ATTRIBUT-Ebene: jeder `{…}`-Ausdruck, der mehr
 * als ein nacktes Stringliteral enthält, wird zu `{}`.
 *
 * Ohne diesen Schritt zählte eine Klein-Angabe aus einem VERSCHACHTELTEN Element dem
 * äußeren zu. Gemessen an `auftraege/AuftragKarte.tsx` (LFH-364): das `<Collapse>`
 * trägt seine Kinder in `items={[{ children: <Descriptions size="small" …> }]}` —
 * `tagEnde` überspringt die Klammer richtig, aber der Tag-Text ENTHÄLT sie, und der
 * Guard meldete den Collapse noch, als dessen eigene Angabe längst weg war. Ein Gate,
 * das einen Verstoß nicht wieder loslässt, ist von einem kaputten nicht zu
 * unterscheiden.
 *
 * `{'small'}` bleibt erhalten — die geklammerte Schreibweise ist ein echter Verstoß.
 * Alles Berechnete (`size={klein}`) fällt hier weg und ist ohnehin dokumentierter
 * Blindfleck (siehe Dateikopf).
 */
export function attributEbene(tag: string): string {
  let raus = '';
  let anfuehrung: string | null = null;
  for (let i = 0; i < tag.length; i++) {
    const z = tag[i];
    if (anfuehrung) {
      raus += z;
      if (z === '\\') { raus += tag[++i] ?? ''; continue; }
      if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') { anfuehrung = z; raus += z; continue; }
    if (z !== '{') { raus += z; continue; }
    // Balancierten Ausdruck greifen und entscheiden, ob er wörtlich genug ist.
    // Die Bilanz MUSS Zeichenketten überspringen — genau wie `tagEnde` und
    // `generikEnde`. Sonst verschiebt eine Klammer INNERHALB eines Strings die Tiefe,
    // der Ausdruck wird über sein Ende hinaus verschluckt und der Rest des Tags samt
    // Klein-Angabe verschwindet: `<Button title={x ? "{" : ""} size="small" />` war so
    // unsichtbar (gemessen im LFH-364-Review) — ein Fix, der ein neues Loch reißt.
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
 * Alle Verstöße einer Datei. Rein, damit der Selbstbeweis unten sie ohne
 * Dateisystem prüfen kann.
 */
export function stellenIn(pfad: string, quelltext: string): Stelle[] {
  const text = ohneKommentare(quelltext);
  const gefunden: Stelle[] = [];
  for (const element of INTERAKTIV) {
    // Punkte im Namen (`Space.Compact`) sind wörtlich zu nehmen. Das `<` im Lookahead
    // lässt generische Typargumente zu (`<Select<T> …>`), siehe Dateikopf.
    const muster = new RegExp(`<${element.replace(/\./g, '\\.')}(?=[\\s/>{<])`, 'g');
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

  // Ein Eintrag ohne Verstoß ist selbst einer: sonst überlebt die Schuldmenge ihre
  // Schuld und niemand merkt, dass das Verzeichnis längst sauber ist.
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

  // ── Selbstbeweise: ein Guard, der nichts findet, ist von einem kaputten Guard
  //    nicht zu unterscheiden. Die drei Fälle sind die, an denen eine Regex scheitert.
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

  // LFH-364/B5d: die Lücke, die `MeldungKarte.tsx:183` unsichtbar machte. Ein reiner
  // Lookahead-Fix ließe den ersten Fall durch und den zweiten scheitern — das
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

  // LFH-364/B5d: die Angabe eines VERSCHACHTELTEN Elements gehört nicht dem äußeren.
  // Ohne `attributEbene` blieb `AuftragKarte`s Collapse gemeldet, nachdem seine eigene
  // Angabe entfernt war — der Verstoß saß im `items`-Ausdruck.
  it('rechnet eine Angabe aus einer Prop-Expression nicht dem äußeren Element zu', () => {
    const quelle = '<Collapse ghost items={[{ children: <Descriptions size="small" /> }]} />';
    expect(stellenIn('/src/x.tsx', quelle)).toEqual([]);
  });

  it('meldet das äußere Element dennoch, wenn es SELBST eine Angabe trägt', () => {
    const quelle = '<Collapse size="small" items={[{ children: <Descriptions size="small" /> }]} />';
    expect(stellenIn('/src/x.tsx', quelle)).toHaveLength(1);
  });

  // Die Kehrseite von `attributEbene`: seine Klammer-Bilanz muss Zeichenketten
  // überspringen. Ohne das verschluckt eine Klammer IM STRING den Rest des Tags und
  // die Angabe dahinter wird unsichtbar — ein Fix, der ein neues Loch reißt, ist
  // schlimmer als der Fehlalarm, den er behebt.
  it('lässt sich von einer geschweiften Klammer in einer Zeichenkette nicht abschütteln', () => {
    expect(stellenIn('/src/x.tsx', '<Button title={x ? "{" : ""} size="small" />')).toHaveLength(1);
    expect(stellenIn('/src/x.tsx', '<Button title={"}"} size="small" />')).toHaveLength(1);
  });

  it('gilt auch für ein Schablonen-Literal mit Klammer', () => {
    expect(stellenIn('/src/x.tsx', '<Button aria-label={`a { b`} size="small" />')).toHaveLength(1);
  });

  it('lässt Flächen ohne Bedienfunktion und die Projekt-Primitive in Ruhe', () => {
    const quelle = ['<Card size="small" />', ...EIGENE_SEMANTIK.map((e) => `<${e} size="small" />`)].join(
      '\n',
    );
    expect(stellenIn('/src/x.tsx', quelle)).toEqual([]);
  });

  it('übersieht eine Angabe im Kommentar', () => {
    expect(stellenIn('/src/x.tsx', '// <Button size="small" />')).toEqual([]);
  });
});
