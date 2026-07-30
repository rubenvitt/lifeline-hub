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
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Teil des Vertrags, nicht Beiwerk:
 *   • ein gespreiztes `{...props}`, das die Größe als Objektfeld trägt;
 *   • eine Größe aus einer Variablen (`size={klein}`) oder einem Ausdruck;
 *   • eine eigene Wrapper-Komponente, die die Prop intern setzt;
 *   • Elemente, die hier nicht als interaktiv gelistet sind ({@link INTERAKTIV}).
 * Wer eine dieser Lücken nutzt, umgeht die Norm — der Guard fängt ihn nicht.
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
  // ── B5d · Kommunikationskarten (LFH-364) ──────────────────────────────────
  '/src/auftraege/AuftraegeListe.tsx',
  '/src/auftraege/AuftragKarte.tsx',
  '/src/chat/KanalListe.tsx',
  '/src/chat/NachrichtEingabe.tsx',
  '/src/chat/NachrichtenStrom.tsx',
  '/src/erinnerung/ErinnerungKarte.tsx',
  '/src/meldungen/MeldungFormular.tsx',
  '/src/meldungen/MeldungKarte.tsx',
  '/src/nachforderungen/NachforderungKarte.tsx',
  '/src/pages/ErinnerungenPage.tsx',
  '/src/pages/MeldungenPage.tsx',
  '/src/pages/NachforderungenPage.tsx',
  // ── B5e · Einsatztagebuch (LFH-365) ───────────────────────────────────────
  '/src/etb/BuchstabierHilfe.tsx',
  '/src/etb/MetaChip.tsx',
  '/src/pages/EtbPage.tsx',
  // ── B5f · Lagekarte und Kartenverwaltung (LFH-366) ────────────────────────
  '/src/karten/OfflineKartenVerwaltung.tsx',
  '/src/karten/OfflineVorhandeneModal.tsx',
  '/src/karten/OnlineQuellenVerwaltung.tsx',
  '/src/pages/lagekarte/HistorienBanner.tsx',
  '/src/pages/lagekarte/KartenDetailCard.tsx',
  '/src/pages/lagekarte/SnapshotLeiste.tsx',
  // ── B5g · UHS-Grundriss (LFH-367) ─────────────────────────────────────────
  // Die vier Knöpfe der Platzkarte hängen an der Backend-Konstante SCHRITT_Y;
  // ihre Begründung steht in `uhs/Grundriss.tsx` (LFH-328/A2).
  '/src/pages/uhs/Grundriss.tsx',
  '/src/pages/uhs/MaterialTab.tsx',
  // ── B5h · Gefahren (LFH-368) ──────────────────────────────────────────────
  '/src/pages/gefahren/GefahrenMatrix.tsx',
  '/src/pages/gefahren/GefahrenPage.tsx',
  // ── B5i · Kräfte-Listen (LFH-369) ─────────────────────────────────────────
  '/src/pages/MaterialPage.tsx',
  // ── B5j · Rest: Kopfzeile, Profil, Editor, Sonstiges (LFH-370) ────────────
  '/src/components/MarkdownEditor.tsx',
  '/src/components/SprechgruppenPicker.tsx',
  '/src/einsatz/AlarmZentrale.tsx',
  '/src/pages/LoginPage.tsx',
  '/src/pages/ProfilPage.tsx',
  '/src/pages/SchaedenDetailPage.tsx',
  '/src/pages/TiereDetailPage.tsx',
  '/src/pages/bereitstellungsraum/KraefteOhneBrSidebar.tsx',
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

/** Trägt der Tag-Text eine wörtliche Klein-Angabe? Deckt `"…"`, `'…'` und `{…}` ab. */
function tragtKleinAngabe(tag: string): boolean {
  return /\bsize\s*=\s*(?:["']small["']|\{\s*["']small["']\s*\})/.test(tag);
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
    // Punkte im Namen (`Space.Compact`) sind wörtlich zu nehmen.
    const muster = new RegExp(`<${element.replace(/\./g, '\\.')}(?=[\\s/>{])`, 'g');
    for (const treffer of text.matchAll(muster)) {
      const start = treffer.index;
      const ende = tagEnde(text, start);
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
