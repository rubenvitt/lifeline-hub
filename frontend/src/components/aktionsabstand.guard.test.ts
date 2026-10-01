/**
 * Abstands-Guard (LFH-363 · B5c): eine destruktive Aktion steht nicht bündig neben einer
 * neutralen.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Der Vorgabe-Abstand eines `<Space>` ist hier NICHT antds 8 px: antd mappt
 * `spaceGapSmallSize` auf `token.paddingXS`, und `theme/tokens.ts` setzt das auf `abstand.xs` =
 * 3/5/7 px. Drei Pixel zwischen einem neutralen und einem roten Knopf sind im Handschuh-Betrieb
 * keine Trennung.
 *
 * `size="middle"` führt auf `token.padding` = `abstand.md` = 11/18/26 px und liegt in JEDER
 * Stufe über `token.marginSM` (`abstand.sm` = 7/11/16). Der Test unten beweist diese Ordnung aus
 * `theme/tokens.ts` heraus.
 *
 * ── Warum Quelltext und nicht Pixel ─────────────────────────────────────────────
 * jsdom rechnet kein Layout, und `test/utils.tsx` rendert ein NACKTES `ConfigProvider` — eine
 * Pixel-Zusicherung mäße antd-Vorgaben.
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Teil des Vertrags, nicht Beiwerk:
 *   • einen Abstand, der über `style`/CSS statt über `size` kommt;
 *   • eine Größe aus Variable oder Ausdruck (`size={weit}`);
 *   • destruktive Aktionen, die nicht als `<Button danger>` geschrieben sind (z. B.
 *     Menüeinträge mit `danger: true`);
 *   • Nachbarschaften außerhalb der unten gelisteten Dateien ({@link BEREICH}).
 *
 * ── Warum gescopt ───────────────────────────────────────────────────────────────
 * Die danger-Nachbarschaft ist kein zählbares Prop, sondern eine Bewertung je Stelle. Ein
 * baumweiter Guard müsste sie für ungeprüfte Dateien vorwegnehmen; er hält deshalb nur, was
 * bewertet ist, und wächst mit.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dichten } from '../theme/tokens';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Dateien mit bewerteter NACHBARSCHAFT: eine destruktive Aktion neben mindestens einer
 * weiteren. Jede muss belegt bleiben — verschwindet die Reihe, würde der Guard still trivial
 * grün (Gegenstück zur „toten Schuld-Ausnahme" in `dichte.guard.test.ts`).
 */
const MIT_NACHBARSCHAFT = [
  'stammdaten/EtbBausteineTab.tsx',
  'stammdaten/SprechgruppenTab.tsx',
  // Die Aktionsspalte von Fahrzeugen, Personal und Material („Bearbeiten" neben
  // „Außer Dienst") steht nur noch im gemeinsamen Baustein.
  'stammdaten/dienststatus.tsx',
  // Die Aktionsspalte von Qualifikationen, Einheitstypen, Personal- und Fahrzeug-Status
  // steht nur noch hier, in der gemeinsamen Hülle.
  'stammdaten/KatalogVerwaltung.tsx',
  'pages/BenutzerPage.tsx',
  // Reihe Speichern + Auflösen(danger) in der sticky Aktionsleiste der Detailroute.
  'pages/EinheitDetailPage.tsx',
  'pages/EinsatzabschnittePage.tsx',
  // Dokumentenablage (LFH-656): „Bearbeiten“ neben „Entfernen“ (`danger`) in der Aktionsspalte.
  // Im Kartenzweig steht Entfernen im Menü; dessen Trenner prüft `Datensicht`.
  'pages/DokumentePage.tsx',
  // ── Kartenverwaltung (LFH-366) ────────────────────────────────────────────
  // Beide tragen „Löschen" neben mindestens einer neutralen Aktion.
  //
  // `pages/lagekarte/Sidebar.tsx` steht bewusst in KEINER Liste: dort ist Löschen ein Menüeintrag
  // mit `danger: true`, den {@link reihenIn} nicht sieht. Die Trennung dort ist der Menü-Trenner,
  // geprüft in `Sidebar.test.tsx`.
  'karten/OfflineKartenVerwaltung.tsx',
  'karten/OnlineQuellenVerwaltung.tsx',
  // ── Detailseiten Schäden/Tiere (LFH-370) ──────────────────────────────────
  // „Stornieren" (`danger`) steht in der inneren Aktionsreihe neben drei gleich hohen neutralen
  // Aktionen.
  'pages/SchaedenDetailPage.tsx',
  'pages/TiereDetailPage.tsx',
  // ── Meldungskarte (LFH-372) ───────────────────────────────────────────────
  // „Bestätigen" (`danger`) steht als Knopf neben Statusbewegung und ⋮-Trigger in
  // `<Space size="middle">` — anders als `Sidebar.tsx` in der Reihe, nicht im Menü.
  // Die Nachbarschaft ist BEDINGT („Bestätigen" nur bei `bestaetigung_pflicht && !ist_bestaetigt`);
  // der Scanner liest Quelltext und sichert den Abstand für den Fall zu, in dem es ihn braucht.
  // Beide Renderformen (⋮-Menü ab drei Aktionen, darunter Direktknöpfe) liegen in derselben
  // `<Space size="middle">` — ein eigenes `<Flex gap>` für den Direktzweig fiele aus dem Scanner.
  'meldungen/MeldungKarte.tsx',
  // ── Personen-Detailseite (LFH-340) ────────────────────────────────────────
  // ZWEI Reihen: Abgleich („Bestätigen" neben „Verwerfen"/`danger`) und UHS-Zuordnung
  // („UHS ändern" neben „Austragen"/`danger`). Das Stornieren steht im Kopfmenü; dessen Trenner
  // prüft der Komponententest und ersetzt diese Zeile nicht.
  'pages/PersonenDetailPage.tsx',
  // ── UHS-Kopfzeile (LFH-341) ───────────────────────────────────────────────
  // Je Zustand steht ein Knopf neben einem `danger`-Knopf („Auflösen" bzw. „Stornieren"); der
  // Scanner sieht alle vier `<Button>` im selben unmittelbar umschließenden `<Space>`.
  'pages/uhs/UhsDetailPage.tsx',
  // ── Fuß der Erfassungs-Hülle (LFH-653) ───────────────────────────────────
  // Der Primärknopf trägt `danger={unumkehrbar}` und steht neben „Abbrechen" (und im Serienmodus
  // „Speichern und nächste"). Der Fuß jeder Erfassungsmaske hängt an dieser einen Reihe.
  'components/Erfassung.tsx',
];

/**
 * BEWERTET, ABER FÜR DEN SCANNER UNSICHTBAR (LFH-343 · C8).
 *
 * `nachforderungen/NachforderungKarte.tsx` trägt „Ablehnen" (`danger`) neben der
 * Status-Fortschaltung, mit Abstand. Die Karte baut ihre Aktionen als `ReactNode[]` und spreizt
 * sie mit `{aktionen}` in die Reihe; {@link reihenIn} findet dort keine Reihe.
 *
 * Ein Eintrag in `MIT_NACHBARSCHAFT` färbte den Guard rot, einer in {@link OHNE_NACHBARSCHAFT}
 * behauptete das Gegenteil des Wahren. Die Zusicherung steht deshalb als Kommentar in der Karte
 * selbst; der Test unten pinnt beide Hälften.
 */
const BEWERTET_OHNE_SCANNER_DECKUNG = ['nachforderungen/NachforderungKarte.tsx'];

/**
 * Bewertet, aber OHNE Nachbarschaft: die destruktive Aktion steht allein. Mitgescannt, damit
 * ein später danebengestellter Knopf auffällt, und gepinnt, damit „findet keine Reihe" eine
 * Aussage bleibt und nicht der Zustand eines kaputten Scanners.
 */
const OHNE_NACHBARSCHAFT = ['stammdaten/StichworteTab.tsx', 'pages/MitgliederAbschnitt.tsx'];

const BEREICH = [...MIT_NACHBARSCHAFT, ...OHNE_NACHBARSCHAFT];

/** Abstandsstufen, die über `token.marginSM` liegen. */
const WEIT = ['middle', 'large'];

/**
 * Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen. Kopie aus
 * `dichte.guard.test.ts`, nicht importiert: ein Import aus einer fremden `.test.ts` zöge deren
 * Suite in jeden Lauf dieser hier.
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
 * Ende des öffnenden JSX-Tags ab `start` (Index des `<`), oder `-1`. Kopie aus
 * `dichte.guard.test.ts`. Zählt geschweifte Klammern mit, sonst beendete das `>` einer
 * Pfeilfunktion das Tag zu früh.
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
 * Alle Aktionsreihen einer Datei, die eine destruktive UND mindestens eine weitere Aktion
 * tragen.
 *
 * Gezählt wird je UNMITTELBAR umschließendem `<Space>` (Stack): ein Knopf im äußeren zählt
 * nicht als Nachbar eines Knopfs im inneren. Ein `<Space>` mit nur EINER Aktion bleibt draußen.
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
      weit: WEIT.some((w) =>
        new RegExp(`\\bsize\\s*=\\s*(?:["']${w}["']|\\{\\s*["']${w}["']\\s*\\})`).test(tag),
      ),
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

  /**
   * Der Blindfleck ist gepinnt: der Scanner sieht die Datei NICHT (sonst gehörte sie in
   * `MIT_NACHBARSCHAFT`), und der Abstand steht trotzdem im Quelltext (sonst wäre die Ausnahme
   * eine Lücke). Schreibt die Karte ihre Knöpfe direkt in die Reihe, wird die erste Hälfte rot.
   */
  it('die bewertete Reihe ohne Scanner-Deckung ist unsichtbar UND trägt den Abstand', () => {
    for (const pfad of BEWERTET_OHNE_SCANNER_DECKUNG) {
      const inhalt = readFileSync(join(SRC, pfad), 'utf8');
      expect(reihenIn(inhalt), `${pfad}: der Scanner sieht die Reihe jetzt`).toEqual([]);
      expect(inhalt, `${pfad}: Abstand fehlt`).toContain('<Space size="middle"');
      expect(inhalt, `${pfad}: kein danger mehr in der Reihe?`).toContain('danger');
    }
  });

  it('„middle" liegt in jeder Dichtestufe über token.marginSM', () => {
    // marginSM = abstand.sm, `size="middle"` = token.padding = abstand.md.
    for (const stufe of Object.values(dichten)) {
      expect(stufe.abstand.md).toBeGreaterThanOrEqual(stufe.abstand.sm);
    }
  });

  // ── Selbstbeweise: ein Guard, der nichts findet, ist von einem kaputten nicht zu
  //    unterscheiden.
  it('meldet die Vorgabe-Nachbarschaft', () => {
    const quelle = '<Space><Button>Bearbeiten</Button><Button danger>Weg</Button></Space>';
    expect(reihenIn(quelle)).toHaveLength(1);
    expect(befunde({ x: quelle })).toHaveLength(1);
  });

  it('lässt sie in Ruhe, sobald der Abstand steht', () => {
    const quelle =
      '<Space size="middle"><Button>Bearbeiten</Button><Button danger>Weg</Button></Space>';
    expect(befunde({ x: quelle })).toEqual([]);
  });

  it('zählt eine Einzelaktion nicht als Nachbarschaft', () => {
    expect(reihenIn('<Space><Button danger>Weg</Button></Space>')).toEqual([]);
  });

  it('zählt je unmittelbar umschließendem Space, nicht über die Schachtelung hinweg', () => {
    const quelle = [
      '<Space>',
      '<span>x</span>',
      '<Space><Button danger>Weg</Button></Space>',
      '</Space>',
    ].join('\n');
    expect(reihenIn(quelle)).toEqual([]);
  });

  it('findet die Nachbarschaft auch hinter einer Pfeilfunktion — deren > beendet das Tag nicht', () => {
    const quelle =
      '<Space><Button onClick={() => tu()}>Los</Button><Button danger>Weg</Button></Space>';
    expect(reihenIn(quelle)).toHaveLength(1);
  });

  it('übersieht eine Reihe im Kommentar', () => {
    expect(reihenIn('// <Space><Button>A</Button><Button danger>B</Button></Space>')).toEqual([]);
  });
});
