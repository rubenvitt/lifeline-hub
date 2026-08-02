/**
 * Abstands-Guard (LFH-363 · B5c): eine destruktive Aktion steht nicht bündig neben
 * einer neutralen.
 *
 * ── Warum es diesen Guard gibt ──────────────────────────────────────────────────
 * In den Aktionsspalten der Stammdaten stand „Bearbeiten" unmittelbar neben
 * „Außer Dienst"/„Deaktivieren" — im Vorgabe-Abstand eines `<Space>`. Der ist hier
 * NICHT antds 8 px: antd mappt `spaceGapSmallSize` auf `token.paddingXS`
 * (`antd/es/space/style/index.js:72`), und `theme/tokens.ts` setzt das auf
 * `abstand.xs` = 3/5/7 px je Dichtestufe. Drei Pixel zwischen einem neutralen und
 * einem roten Knopf sind im Handschuh-Betrieb keine Trennung.
 *
 * `size="middle"` führt auf `token.padding` = `abstand.md` = 11/18/26 px und liegt
 * damit in JEDER Stufe über dem im Ticket geforderten `token.marginSM`
 * (= `abstand.sm` = 7/11/16). Der Test unten beweist diese Ordnung aus
 * `theme/tokens.ts` heraus, statt sie zu behaupten.
 *
 * ── Warum Quelltext und nicht gemessene Pixel ───────────────────────────────────
 * jsdom rechnet kein Layout, und `test/utils.tsx` rendert ein NACKTES
 * `ConfigProvider` ohne unser Theme — eine Pixel-Zusicherung im Vitest misse
 * antd-Vorgaben und belegte nichts (CLAUDE.md, Erfassungs-Norm). Geprüft wird
 * deshalb der Prop-Wert im Quelltext.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Teil des Vertrags, nicht Beiwerk:
 *   • einen Abstand, der über `style`/CSS statt über `size` kommt;
 *   • eine Größe aus Variable oder Ausdruck (`size={weit}`);
 *   • destruktive Aktionen, die nicht als `<Button danger>` geschrieben sind;
 *   • Nachbarschaften außerhalb der unten gelisteten Dateien ({@link BEREICH}) —
 *     der Rest des Bestands fällt mit B5d–B5j.
 *
 * ── Warum auf B5c gescopt ───────────────────────────────────────────────────────
 * Anders als beim Dichte-Guard (LFH-362) gibt es hier keine erhobene Schuldmenge
 * über den ganzen Baum: die danger-Nachbarschaft ist kein zählbares Prop, sondern
 * eine Bewertung je Stelle. Ein baumweiter Guard müsste sie für 40+ ungeprüfte
 * Dateien vorwegnehmen und entschiede damit über Geschwistertickets. Er hält
 * deshalb nur, was dieser Task bewertet hat, und wächst mit jedem Bündel.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dichten } from '../theme/tokens';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Dateien mit bewerteter NACHBARSCHAFT: dort steht eine destruktive Aktion neben
 * mindestens einer weiteren. Jede muss belegt bleiben — verschwindet die Reihe
 * beim nächsten Umbau, wird der Guard sonst still trivial grün und behauptet
 * weiter eine Deckung, die er nicht mehr hat. Gegenstück zur „toten
 * Schuld-Ausnahme" in `dichte.guard.test.ts`, nur in der anderen Richtung: dort
 * verrottet eine Ausnahmeliste, hier eine Soll-Liste.
 */
const MIT_NACHBARSCHAFT = [
  'stammdaten/EinheitTypenTab.tsx',
  'stammdaten/EtbBausteineTab.tsx',
  'stammdaten/FahrzeugeTab.tsx',
  'stammdaten/MaterialTab.tsx',
  'stammdaten/PersonalStatusTab.tsx',
  'stammdaten/PersonalTab.tsx',
  'stammdaten/QualifikationenTab.tsx',
  'stammdaten/SprechgruppenTab.tsx',
  'stammdaten/StatusKatalogTab.tsx',
  'pages/BenutzerPage.tsx',
  'pages/EinheitenPage.tsx',
  'pages/EinsatzabschnittePage.tsx',
  // ── B5f · Kartenverwaltung (LFH-366) ──────────────────────────────────────
  // Beide tragen in ihrer Aktionsspalte „Löschen" neben mindestens einer neutralen Aktion.
  // `OfflineKartenVerwaltung` führte das Elternticket von LFH-333 irrtümlich als
  // Referenzmuster; es war dieselbe Fundstelle wie in `stammdaten/`, nur unentdeckt.
  //
  // `pages/lagekarte/Sidebar.tsx` steht bewusst in KEINER der beiden Listen: dort ist das
  // Löschen seit LFH-366 ein Menü-Eintrag mit `danger: true`, und den sieht {@link reihenIn}
  // nicht (es matcht `<Button` mit `danger` im Tag). Die Datei aufzunehmen behauptete eine
  // Deckung, die der Scanner nicht hat — die Trennung dort ist der Menü-Trenner und wird in
  // `Sidebar.test.tsx` geprüft.
  'karten/OfflineKartenVerwaltung.tsx',
  'karten/OnlineQuellenVerwaltung.tsx',
  // ── B5j · Detailseiten Schäden/Tiere (LFH-370) ────────────────────────────
  // Erst durch B5j entstanden, nicht vorher übersehen: solange die vier Knöpfe der inneren
  // Aktionsreihe `size="small"` trugen, standen sie in einer Größe, für die die Frage nach
  // dem Abstand nicht gestellt war. Mit dem Abbau der Klein-Angabe wächst „Stornieren"
  // (`danger`) auf bis zu 72 px und stünde bündig neben drei gleich hohen neutralen
  // Aktionen — genau die Nachbarschaft, die LFH-363 verboten hat.
  // Gemessen liefert der Scanner für beide Dateien {weit: false, knoepfe: 4, destruktiv: true}.
  'pages/SchaedenDetailPage.tsx',
  'pages/TiereDetailPage.tsx',
  // ── B5k · Meldungskarte (LFH-372) ─────────────────────────────────────────
  // „Bestätigen" (`danger`) bleibt als sichtbarer Knopf neben der Statusbewegung und dem
  // ⋮-Trigger stehen — die Reihe ist mit der Bündelung von `<Flex gap={8}>` (dichteblinder
  // Festwert) auf `<Space size="middle">` gewechselt. Anders als `pages/lagekarte/Sidebar.tsx`
  // gehört diese Datei sehr wohl in die Liste: die destruktive Aktion steht hier NICHT im
  // Menü, sondern in der Reihe, die {@link reihenIn} sieht.
  // Die Nachbarschaft ist dabei BEDINGT — „Bestätigen" wird nur bei
  // `bestaetigung_pflicht && !ist_bestaetigt` gerendert, bei einer gewöhnlichen Meldung
  // steht zur Laufzeit also gar kein roter Knopf in der Reihe. Der Scanner liest Quelltext
  // und kann das nicht unterscheiden; er sichert hier den Abstand für den Fall zu, in dem
  // es ihn braucht. Wer den `danger`-Knopf aus der Reihe nimmt, streicht die Zeile.
  'meldungen/MeldungKarte.tsx',
];

/**
 * Ebenfalls in LFH-363 bewertet, aber OHNE Nachbarschaft: die destruktive Aktion
 * steht dort allein in der Zelle, es gibt nichts zu trennen. Sie werden trotzdem
 * mitgescannt, damit ein später danebengestellter Knopf auffällt — und hier
 * gepinnt, damit „findet keine Reihe" eine Aussage bleibt und nicht bloß der
 * Zustand ist, in dem ein kaputter Scanner auch wäre.
 */
const OHNE_NACHBARSCHAFT = ['stammdaten/StichworteTab.tsx', 'pages/MitgliederAbschnitt.tsx'];

const BEREICH = [...MIT_NACHBARSCHAFT, ...OHNE_NACHBARSCHAFT];

/** Abstandsstufen, die über `token.marginSM` liegen. */
const WEIT = ['middle', 'large'];

/**
 * Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen.
 * Kopie aus `dichte.guard.test.ts` — ohne sie zählte dieser Dateikopf seine
 * eigenen Beispiele als Verstoß. Bewusst kopiert und nicht importiert: ein Import
 * aus einer fremden `.test.ts` zöge deren ganze Suite in jeden Lauf dieser hier.
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

/**
 * Ende des öffnenden JSX-Tags ab `start` (Index des `<`), oder `-1`.
 * Kopie aus `dichte.guard.test.ts`, siehe {@link ohneKommentare}. Zählt geschweifte
 * Klammern mit, sonst beendete das `>` einer Pfeilfunktion das Tag zu früh — und
 * genau dahinter steht in diesen Dateien reihenweise die nächste Prop.
 */
function tagEnde(text: string, start: number): number {
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

interface Reihe {
  zeile: number;
  weit: boolean;
  knoepfe: number;
  destruktiv: boolean;
}

/**
 * Alle Aktionsreihen einer Datei, die eine destruktive UND mindestens eine weitere
 * Aktion tragen.
 *
 * Der Stack ist der Punkt: `EinheitenPage` schachtelt eine Knopfreihe in ein
 * äußeres `<Space justifyContent: space-between>`. Gezählt wird deshalb je
 * UNMITTELBAR umschließendem `<Space>` — ein Knopf im äußeren zählt nicht als
 * Nachbar eines Knopfs im inneren.
 *
 * Ein `<Space>` mit nur EINER Aktion bleibt draußen: dort gibt es keine
 * Nachbarschaft, vor der zu trennen wäre (`StichworteTab`, die
 * Zuordnungs-Zeilen in `EinheitenPage`).
 */
export function reihenIn(quelltext: string): Reihe[] {
  const text = ohneKommentare(quelltext);
  const offen: Reihe[] = [];
  const fertig: Reihe[] = [];
  const muster = /<Space(?=[\s/>{])|<\/Space>|<Button(?=[\s/>{])/g;

  for (const treffer of text.matchAll(muster)) {
    const start = treffer.index;
    if (treffer[0] === '</Space>') {
      const reihe = offen.pop();
      if (reihe && reihe.destruktiv && reihe.knoepfe >= 2) fertig.push(reihe);
      continue;
    }
    const ende = tagEnde(text, start);
    if (ende === -1) continue;
    const tag = text.slice(start, ende + 1);
    if (treffer[0] === '<Button') {
      // Kein `.at(-1)`: `tsconfig` steht auf `lib: ES2020`, dort bricht es `tsc`.
      const innerste = offen[offen.length - 1];
      if (!innerste) continue;
      innerste.knoepfe += 1;
      if (/\bdanger\b/.test(tag)) innerste.destruktiv = true;
      continue;
    }
    // Selbstschließendes `<Space />` umschließt nichts.
    if (tag.endsWith('/>')) continue;
    offen.push({
      zeile: text.slice(0, start).split('\n').length,
      weit: WEIT.some((w) => new RegExp(`\\bsize\\s*=\\s*(?:["']${w}["']|\\{\\s*["']${w}["']\\s*\\})`).test(tag)),
      knoepfe: 0,
      destruktiv: false,
    });
  }
  return fertig;
}

export function befunde(dateien: Record<string, string>): string[] {
  const meldungen: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    for (const reihe of reihenIn(inhalt)) {
      if (reihe.weit) continue;
      meldungen.push(
        `${pfad}:${reihe.zeile}  destruktive Aktion ohne Abstand zur Nachbaraktion (<Space> ohne size="middle")`,
      );
    }
  }
  return meldungen;
}

const dateien = Object.fromEntries(
  BEREICH.map((p) => [p, readFileSync(join(SRC, p), 'utf8')] as const),
);

describe('Abstands-Guard (LFH-363 · B5c)', () => {
  it('keine destruktive Aktion steht bündig neben einer neutralen', () => {
    expect(befunde(dateien)).toEqual([]);
  });

  it('jede bewertete Nachbarschaft ist noch da — die Zusicherung bleibt belegt', () => {
    const leer = MIT_NACHBARSCHAFT.filter((p) => reihenIn(dateien[p]).length === 0);
    expect(leer).toEqual([]);
  });

  it('die Einzelaktionen tragen weiterhin keinen Nachbarn', () => {
    const unerwartet = OHNE_NACHBARSCHAFT.filter((p) => reihenIn(dateien[p]).length > 0);
    expect(unerwartet).toEqual([]);
  });

  it('„middle" liegt in jeder Dichtestufe über token.marginSM', () => {
    // marginSM = abstand.sm, `size="middle"` = token.padding = abstand.md.
    for (const stufe of Object.values(dichten)) {
      expect(stufe.abstand.md).toBeGreaterThanOrEqual(stufe.abstand.sm);
    }
  });

  // ── Selbstbeweise: ein Guard, der nichts findet, ist von einem kaputten Guard
  //    nicht zu unterscheiden.
  it('meldet die Vorgabe-Nachbarschaft', () => {
    const quelle = '<Space><Button>Bearbeiten</Button><Button danger>Weg</Button></Space>';
    expect(reihenIn(quelle)).toHaveLength(1);
    expect(befunde({ x: quelle })).toHaveLength(1);
  });

  it('lässt sie in Ruhe, sobald der Abstand steht', () => {
    const quelle = '<Space size="middle"><Button>Bearbeiten</Button><Button danger>Weg</Button></Space>';
    expect(befunde({ x: quelle })).toEqual([]);
  });

  it('zählt eine Einzelaktion nicht als Nachbarschaft', () => {
    expect(reihenIn('<Space><Button danger>Weg</Button></Space>')).toEqual([]);
  });

  it('zählt je unmittelbar umschließendem Space, nicht über die Schachtelung hinweg', () => {
    const quelle = ['<Space>', '<span>x</span>', '<Space><Button danger>Weg</Button></Space>', '</Space>'].join(
      '\n',
    );
    expect(reihenIn(quelle)).toEqual([]);
  });

  it('findet die Nachbarschaft auch hinter einer Pfeilfunktion — deren > beendet das Tag nicht', () => {
    const quelle = '<Space><Button onClick={() => tu()}>Los</Button><Button danger>Weg</Button></Space>';
    expect(reihenIn(quelle)).toHaveLength(1);
  });

  it('übersieht eine Reihe im Kommentar', () => {
    expect(reihenIn('// <Space><Button>A</Button><Button danger>B</Button></Space>')).toEqual([]);
  });
});
