import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guard des Datensicht-Primitivs (LFH-330 · B2).
 *
 * ── HÄLFTE 1: das Primitiv selbst ──
 *
 * Tragend ist die POSITIVE Marke `<KatalogTabelle`: ohne sie bestünde ein `Datensicht.tsx`, das
 * ein rohes antd-Tabellenelement ohne Bildlauf-Prop rendert, jede Verbotsprüfung und nähme allen
 * Konsumenten Bildlauf, stehende Kopfzeile und fixierte Kennung.
 *
 * ── HÄLFTE 2: die Konsumenten, ABGELEITET **und** handgepflegt ──
 *
 * Die aus der Marke `<Datensicht` erschnüffelte Menge wird gegen {@link KONSUMENTEN} gestellt: ein
 * rein abgeleitetes Inventar sähe eine Datei nicht, die still herausfällt; ein rein
 * handgepflegtes müsste jedes Folgebündel editieren.
 *
 * ── DIE FÜNF GEPFLEGTEN LISTEN ──
 *
 * Drei Ausnahmemengen ({@link KARTEN_EIGENBAU}, {@link NUR_KARTE}, {@link NUR_TABELLE}), eine
 * Pflichtmenge ({@link VOLLMENGE_PFLICHT}) und eine Schuldmenge ({@link REITERSCHLUESSEL_OFFEN}).
 * Alle sind auf ihre Länge gepinnt und werden auf tote Einträge geprüft.
 *
 * ── ZWEI SCHLÜSSELREGELN für zwei Gestalten desselben Fehlers ──
 *
 * 1. {@link schluesselBefunde}: MEHRERE Sichten, EINE Baumstelle; ab zwei `<Datensicht>` je
 *    Datei distinkte `key`.
 * 2. {@link reiterBefunde}: EINE Sicht, MEHRERE Reiter; für Regel 1 unsichtbar (eine Datei mit
 *    einer Sicht fällt dort heraus).
 *
 * Regel 2 nähert „ein Schlüssel trägt eine Reiterachse“ an, verankert an drei Stellen:
 * · die ACHSE kommt aus dem Attribut eines {@link SICHTSCHALTER}-Elements
 *   (`activeKey=`/`value=`), nicht aus einer Namenskonvention;
 * · gemeldet wird nur, wenn `daten` an der Achse hängt und der `key` NICHT;
 * · der Weg von `daten` zur Achse läuft über lokale `const`-Initialisierer (Tiefe 3), weil die
 *   reale Form `daten={tiere}` mit `const tiere = filterTiere(alle, { sicht })` ist.
 * Dass die Regel noch etwas FINDET, belegt der Selbstbeweis (a) auf synthetischer Quelle.
 *
 * ── WIE ER SEINE EIGENE PROSA NICHT MITZÄHLT ──
 *
 * 1. Kommentar-Stripper mit Blockzustand vor jeder VERBOTS-Zählung, samt Selbstbeweis.
 * 2. Die verbotenen Marken stehen in den gescannten Dateien nirgends als Prosa; der Dateikopf
 *    von `Datensicht.tsx` umschreibt sie („kein Bildlauf-Prop“). Wer ihn ergänzt, schreibt keine
 *    Marke aus.
 * 3. Testdateien werden nicht gescannt.
 * Der Stripper ist aus `theme/gate5.guard.test.ts` kopiert: ein Import aus einer `*.test.ts`
 * registrierte deren `describe`-Blöcke doppelt. Die Schlüsselprüfung liest den AST und braucht
 * ihn nicht.
 *
 * ── WAS DER GUARD NICHT SIEHT (Teil des Vertrags) ──
 *
 * · Ob hinter einem Slot-Schlüssel eine Spalte steht (das können `pruefeKartenplan` und `tsc`).
 * · Einen Konsumenten, der `Datensicht` nicht kennt und wieder eine rohe antd-Tabelle einbindet
 *   (dagegen steht `katalogTabelle.guard.test.ts`).
 * · Layout: jsdom rechnet keines; Trefflächen, Überlauf und Fokusverdeckung gehören nach
 *   `frontend/e2e/`.
 * · Dynamisch zusammengesetzte Bezeichner.
 * · Die Gleichheit zweier Schlüssel misst den QUELLTEXT, nicht den Laufzeitwert; ein `key` in
 *   einem `{...spread}` wird nicht gesucht.
 * · Die Achsverfolgung von {@link reiterBefunde} ist eine Näherung an fünf Stellen:
 *   (a) sie misst QUELLTEXT per Regex, ein Achsenname in einem Zeichenkettenliteral zählt mit;
 *   (b) die Initialisierer-Karte ist FLACH, gleichnamige Bindungen fallen zusammen. Zusammen
 *   lassen (a) und (b) einen konstanten Schlüssel durch, der zufällig wie eine achsabhängige
 *   Bindung heißt (`key="tiere"` neben `const tiere = filterTiere(…)`);
 *   (c) aus dem Schalter-Attribut zählen nur BEZEICHNER links vom Punkt, keine Zeichenketten
 *   und Property-Namen (siehe {@link achsenBezeichner});
 *   (c′) die RICHTUNG erkennt die Regel nicht: ein Schalter, der die Daten LIEST, meldet
 *   fälschlich, wenn der Vergleich im Attribut steht. Abhilfe ist eine benannte
 *   Zwischenvariable (`KraefteuebersichtPage.tsx`, `alleAufgeklappt`), kein `key`, der
 *   Sortierung, Spaltenwahl und Zeilenschleuse bei jedem Schalten verwürfe;
 *   (d) Schalter sind nur die Tags in {@link SICHTSCHALTER}, keine handgebaute Reiterleiste;
 *   (e) Eingang ist das `daten`-Attribut; eine Sicht mit Zeilen aus `{...spread}` wird
 *   übersprungen.
 * · Ob ein Reiterwechsel den Zustand zurücksetzen SOLL: wer ihn bewusst mitnimmt, braucht einen
 *   Eintrag in {@link REITERSCHLUESSEL_OFFEN} mit Begründung.
 * · Die Marken aus {@link VERBOTEN_BEI_VOLLMENGE} treffen nur die wörtliche Form (keine
 *   Konstante, kein durchgereichtes Prop, kein Spread).
 */

/** Wurzel des Scans: `frontend/src`, über `process.cwd()` aufgelöst (siehe gate5.guard). */
const SRC = (() => {
  for (const kandidat of ['src', 'frontend/src']) {
    const pfad = resolve(process.cwd(), kandidat);
    if (existsSync(join(pfad, 'components', 'Datensicht.tsx'))) return pfad;
  }
  throw new Error(`Datensicht-Guard findet frontend/src nicht (cwd: ${process.cwd()})`);
})();

const PRIMITIV = '/src/components/Datensicht.tsx';
const ENDUNGEN = /\.(ts|tsx)$/;
/** Bezeichner im Quelltext — bewusst textuell, samt der Grenzen im Kopfkommentar. */
const BEZEICHNER = /[A-Za-z_$][\w$]*/g;

/**
 * Dateien, die `art: 'eigen'` im Kartenplan setzen dürfen. LEER: das Tagebuch, der frühere
 * einzige Eintrag, ist eine Zeitachse außerhalb der `Datensicht`.
 *
 * Für einen künftigen Eintrag: das Primitiv legt beim Eigenbau keinen Wrapper um
 * `karte.render(...)`. Der Eigenbau trägt `data-lfh="datensicht-karte"` (sonst findet
 * `scrolleZurZeile` die Karte nicht) und die Zeilenklasse selbst.
 */
const KARTEN_EIGENBAU: string[] = [];

/**
 * Dateien, die `form="karte"` tragen MÜSSEN: Module, die kartenbasiert gelesen werden.
 */
const NUR_KARTE: string[] = [
  '/src/auftraege/BefehlListe.tsx',
  // Ein Evakuierungsbezirk wird GELESEN („was ist mit diesem Bezirk?“), nicht verglichen.
  '/src/betreuung/EvakuierungBlock.tsx',
  '/src/pages/LageberichtePage.tsx',
];

/**
 * Dateien, die `form="tabelle"` tragen MÜSSEN: Vergleichsflächen (Kriterium 14). Die Listen sind
 * nötig, weil eine Datei mit `form="karte"` bei `<Table` = 0 grün bliebe, auch wenn sie eine
 * Tabelle rendert (das Element liegt in `KatalogTabelle.tsx`); nur das Literal prüft die Form.
 */
const NUR_TABELLE: string[] = [
  // Aufbewahrungsübersicht, Vergleichsfläche in jeder Breite.
  '/src/aufbewahrung/AufbewahrungUebersicht.tsx',
  // Betreuungsstellen werden VERGLICHEN („welche hat noch Platz?“), Tabelle in jeder Breite.
  '/src/betreuung/StellenBlock.tsx',
  // Der Funkplan (LFH-548) wird verglichen („welche Stelle funkt auf welcher Gruppe?“) und
  // gedruckt; Tabelle in jeder Breite, auf schmalem Schirm angepasst.
  '/src/pages/FunkplanPage.tsx',
  '/src/pages/KraefteuebersichtPage.tsx',
];

/**
 * Dateien, deren `Datensicht` die ZEILENMENGE nicht antasten darf: keine Freitextsuche, kein
 * Spaltenfilter, keine Sortierung IM PRIMITIV. Die Aggregate der Elternzeilen werden stromaufwärts
 * über die VOLLMENGE kumuliert (`addKategorie`); fiele im Primitiv eine Zeile weg, lögen die
 * Ampelzahlen still.
 *
 * Statisch, weil `pruefeKartenplan` nur mit gesetztem `baum` greift, die Sortierung nicht kennt
 * und nur in DEV warnt. `Input.Search` ist ERLAUBT: die Filter-Card liegt außerhalb der
 * Datensicht und filtert die Rohlisten. Die Liste ist dateibezogen.
 */
const VOLLMENGE_PFLICHT: string[] = ['/src/pages/KraefteuebersichtPage.tsx'];

/**
 * Dateien mit einer Reiterachse, deren Sicht den Reiter NICHT im Schlüssel trägt: eine
 * SCHULDMENGE („so ist es, und es ist falsch“). Ihr Gegentest erwartet, dass ein Eintrag
 * WEITERHIN gemeldet wird. LEER; ein neuer Eintrag ist eine zweite Seite mit demselben Fehler und
 * gehört behoben, außer der Zustand soll bewusst über den Reiter hinweg stehen bleiben (dann mit
 * Begründung).
 */
const REITERSCHLUESSEL_OFFEN: string[] = [];

/**
 * Das Konsumenteninventar, handgeschrieben: der Scan sagt, WER konsumiert, diese Liste, wer es
 * SOLL. Nur gegeneinander fangen sie eine still herausgefallene und eine ungeplant hinzugekommene
 * Datei.
 */
const KONSUMENTEN = [
  '/src/auftraege/BefehlListe.tsx',
  // Die Aufbewahrungsübersicht: verglichen wird („welcher Einsatz läuft als nächstes ab?“).
  '/src/aufbewahrung/AufbewahrungUebersicht.tsx',
  // Die Betreuungsseite trägt ZWEI Sichten in zwei Dateien (Bezirke als Karten, Stellen als
  // Tabelle), je mit eigener Formbegründung und eigenem Spaltenregister.
  '/src/betreuung/EvakuierungBlock.tsx',
  '/src/betreuung/StellenBlock.tsx',
  // Die Dokumentenablage: Titel als nativer Download-Anker aus dem Spalten-`render` (kein
  // `titel.ziel`, das wäre eine Client-Navigation).
  '/src/pages/DokumentePage.tsx',
  '/src/pages/FahrzeugePage.tsx',
  // Der Funkplan S6 (LFH-548): abgeleiteter Baum Abschnitt → Einheit → Fahrzeug, schreibgeschützt.
  '/src/pages/FunkplanPage.tsx',
  '/src/pages/KraefteuebersichtPage.tsx',
  '/src/pages/LageberichtePage.tsx',
  '/src/pages/MaterialPage.tsx',
  '/src/pages/PersonalPage.tsx',
  '/src/pages/PersonenPage.tsx',
  // Das Presse-Log S5 (LFH-554): Karten, weil die Frage „was ist mit diesem?“ lautet; Status an
  // der Statusanzeige, „Beantworten“ als Primäraktion.
  '/src/pages/PressePage.tsx',
  '/src/pages/SchaedenPage.tsx',
  '/src/pages/TierePage.tsx',
  '/src/pages/uhs/BewegungenTab.tsx',
];

/** Alle Quelldateien als Rohtext, Pfad relativ zu `src/` (führendes `/src/…`). */
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
 * Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen (Kopie aus
 * `theme/gate5.guard.test.ts`).
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

/** Öffnendes JSX-Element eines Namens — `<Name` gefolgt von Leerraum, `>` oder Generik. */
function elementMuster(name: string): RegExp {
  return new RegExp(`<${name}(?=[\\s/>{<])`, 'g');
}

function treffer(text: string, muster: RegExp): number {
  return text.match(muster)?.length ?? 0;
}

function istTest(pfad: string): boolean {
  return /\.test\.[jt]sx?$/.test(pfad) || /\.generated\.[jt]sx?$/.test(pfad);
}

/** Eine `<Datensicht>`-Stelle samt dem, was AM ELEMENT als `key` und als `daten` steht. */
export interface Sichtstelle {
  /** 1-basiert, wie in Editor-/Guard-Meldungen üblich. */
  zeile: number;
  /** Quelltext des Schlüssels (`"patienten"`, `` `liste-${sicht}` ``) oder `null`. */
  schluessel: string | null;
  /** Quelltext der Zeilenmenge (`tiere`, `filterPersonen(alle, sicht)`) oder `null`. */
  daten: string | null;
}

/**
 * Ein Attribut AM Element — Spreads werden nicht durchsucht (siehe Kopfkommentar).
 * Zeichenkettenliterale kommen mit Anführungszeichen zurück, damit `key="a"` und `key={a}`
 * in der Meldung unterscheidbar bleiben.
 */
function attributVon(
  element: ts.JsxOpeningLikeElement,
  name: string,
  quelle: ts.SourceFile,
): string | null {
  for (const attribut of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribut) || attribut.name.getText(quelle) !== name) continue;
    const wert = attribut.initializer;
    if (wert == null) return name; // bloßes `key` ohne Wert — formal da, praktisch leer
    if (ts.isStringLiteral(wert)) return JSON.stringify(wert.text);
    if (ts.isJsxExpression(wert)) return wert.expression?.getText(quelle) ?? `${name}={}`;
    return wert.getText(quelle);
  }
  return null;
}

/**
 * Elemente, die eine Sicht-/Reiterachse schalten, je mit dem Attribut der AKTIVEN Achse. Nur diese
 * drei; der Bezeichner kommt aus dem ATTRIBUT, weil `activeKey={…}` die Stelle ist, an der die
 * Achse nachweislich gebunden wird.
 */
const SICHTSCHALTER: Readonly<Record<string, string>> = {
  Tabs: 'activeKey',
  Segmented: 'value',
  'Radio.Group': 'value',
};

/**
 * Die Bezeichner, die ein Schalter-Attribut als ACHSE beisteuert, aus dem AST.
 *
 * Ausgeschlossen sind Zeichenketten und PROPERTY-Namen: aus
 * `<Segmented value={expandedKeys.length > 0 ? 'alle' : 'abschnitte'} />` würde sonst `abschnitte`
 * zur Achse, ein Name fast jeder Einsatz-Seite, und die Regel meldete einen Reiter an einem
 * Aufklapp-Umschalter. Die naheliegende „Behebung“ (ein `key` am Umschalter) verwürfe bei jedem
 * Aufklappen Sortierung, Spaltenwahl und Zeilenschleuse.
 */
function achsenBezeichner(
  knoten: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
  attributName: string,
): string[] {
  const attribut = knoten.attributes.properties.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText() === attributName,
  );
  const wert = attribut?.initializer;
  if (wert == null || !ts.isJsxExpression(wert) || wert.expression == null) return [];
  const gefunden: string[] = [];
  const sammle = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      sammle(n.expression); // NUR links vom Punkt — `n.name` ist der Property-Name.
      return;
    }
    if (ts.isIdentifier(n)) gefunden.push(n.text);
    ts.forEachChild(n, sammle);
  };
  sammle(wert.expression);
  return gefunden;
}

/** Was EIN AST-Durchlauf über eine Datei hergibt. */
export interface Dateilage {
  stellen: Sichtstelle[];
  /** Bezeichner aus dem Schalter-Attribut eines {@link SICHTSCHALTER}-Elements. */
  achsen: Set<string>;
  /** `const x = …` der ganzen Datei, FLACH — ohne Gültigkeitsbereiche (siehe Kopf). */
  initialisierer: Map<string, string>;
}

/**
 * Ein Durchlauf, drei Ausbeuten, per AST (Muster `api/queryKeyScan.ts`): ein Zählen aller `key=`
 * der Datei träfe vor allem Spalten-Renderer (`<Tag key={w}>`) und übersähe zwei Sichten ohne
 * Schlüssel oder mit demselben. `ohneKommentare` läuft hier nicht, Kommentare sind keine
 * AST-Knoten.
 */
export function leseDatei(pfad: string, quelltext: string): Dateilage {
  const quelle = ts.createSourceFile(
    pfad,
    quelltext,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    pfad.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const stellen: Sichtstelle[] = [];
  const achsen = new Set<string>();
  const initialisierer = new Map<string, string>();

  const gehe = (knoten: ts.Node): void => {
    if (ts.isVariableDeclaration(knoten) && ts.isIdentifier(knoten.name) && knoten.initializer) {
      initialisierer.set(knoten.name.text, knoten.initializer.getText(quelle));
    }
    if (ts.isJsxOpeningElement(knoten) || ts.isJsxSelfClosingElement(knoten)) {
      const tag = knoten.tagName.getText(quelle);
      const schalterAttribut = SICHTSCHALTER[tag];
      if (schalterAttribut != null) {
        for (const bezeichner of achsenBezeichner(knoten, schalterAttribut)) achsen.add(bezeichner);
      }
      if (tag === 'Datensicht') {
        stellen.push({
          zeile: quelle.getLineAndCharacterOfPosition(knoten.getStart(quelle)).line + 1,
          schluessel: attributVon(knoten, 'key', quelle),
          daten: attributVon(knoten, 'daten', quelle),
        });
      }
    }
    ts.forEachChild(knoten, gehe);
  };
  gehe(quelle);
  return { stellen, achsen, initialisierer };
}

/** Alle `<Datensicht>`-Stellen einer Datei. */
export function sichtstellen(pfad: string, quelltext: string): Sichtstelle[] {
  return leseDatei(pfad, quelltext).stellen;
}

/**
 * Befunde der Schlüsselregel: ab ZWEI Sichten in einer Datei trägt jede einen `key`, paarweise
 * verschieden. Rein und exportiert, damit die Selbstbeweise ohne Dateisystem prüfen.
 */
export function schluesselBefunde(
  dateien: Record<string, string>,
  nur: readonly string[],
): string[] {
  const gefunden: string[] = [];
  for (const [pfad, roh] of Object.entries(dateien)) {
    if (!nur.includes(pfad)) continue;
    const stellen = sichtstellen(pfad, roh);
    if (stellen.length < 2) continue;

    const ohneSchluessel = stellen.filter((s) => s.schluessel == null);
    if (ohneSchluessel.length > 0) {
      gefunden.push(
        `${pfad}: ${stellen.length} Sichten, davon ${ohneSchluessel.length} ohne key ` +
          `(Zeile ${ohneSchluessel.map((s) => s.zeile).join(', ')}).`,
      );
    }

    const haeufigkeit = new Map<string, number>();
    for (const stelle of stellen) {
      if (stelle.schluessel == null) continue;
      haeufigkeit.set(stelle.schluessel, (haeufigkeit.get(stelle.schluessel) ?? 0) + 1);
    }
    for (const [schluessel, anzahl] of haeufigkeit) {
      if (anzahl > 1) gefunden.push(`${pfad}: ${anzahl} Sichten teilen den key ${schluessel}.`);
    }
  }
  return gefunden;
}

/**
 * Hängt ein Ausdruck an einem der Achsen-Bezeichner, direkt oder über lokale `const`? Die Tiefe
 * braucht die reale Form `daten={tiere}` mit `const tiere = filterTiere(alle, { sicht })`. Drei
 * Stufen als billige Reserve; `gesehen` bricht Zyklen ab.
 */
export function haengtAnAchse(
  ausdruck: string,
  achsen: ReadonlySet<string>,
  initialisierer: ReadonlyMap<string, string>,
  tiefe = 3,
): boolean {
  const gesehen = new Set<string>();
  let text = ausdruck;
  for (let stufe = 0; stufe <= tiefe; stufe++) {
    const bezeichner = text.match(BEZEICHNER) ?? [];
    if (bezeichner.some((b) => achsen.has(b))) return true;
    let naechste = '';
    for (const b of bezeichner) {
      if (gesehen.has(b)) continue;
      gesehen.add(b);
      const init = initialisierer.get(b);
      if (init != null) naechste += ` ${init}`;
    }
    if (naechste === '') return false;
    text = naechste;
  }
  return false;
}

/**
 * Befunde der Reiterregel: hängt die Zeilenmenge einer Sicht an der Reiterachse, muss der `key`
 * es auch tun. NICHT gemeldet: eine Datei ohne Schalterachse und ein konstanter Schlüssel über
 * achsunabhängigen Daten (`key="patienten"` über `alle.filter(istPatient)`).
 */
export function reiterBefunde(dateien: Record<string, string>, nur: readonly string[]): string[] {
  const gefunden: string[] = [];
  for (const [pfad, roh] of Object.entries(dateien)) {
    if (!nur.includes(pfad)) continue;
    const { stellen, achsen, initialisierer } = leseDatei(pfad, roh);
    if (achsen.size === 0) continue; // keine Reiterachse → nichts zu tragen
    for (const stelle of stellen) {
      if (stelle.daten == null) continue;
      if (!haengtAnAchse(stelle.daten, achsen, initialisierer)) continue;
      if (stelle.schluessel != null && haengtAnAchse(stelle.schluessel, achsen, initialisierer)) {
        continue;
      }
      gefunden.push(
        `${pfad}: Zeile ${stelle.zeile} — daten={${stelle.daten}} hängt an der Reiterachse ` +
          `${[...achsen].sort().join('/')}, der key (${stelle.schluessel ?? 'fehlt'}) nicht. ` +
          'React reicht beim Reiterwechsel dieselbe Instanz weiter: Suchbegriff, Spaltenfilter, ' +
          'Sortierung und Zeilenschleuse stehen danach über einer fremden Menge.',
      );
    }
  }
  return gefunden;
}

/** Verbotene Formen im Primitiv, je mit Grund für die Fehlermeldung. */
const VERBOTEN_IM_PRIMITIV: readonly { muster: RegExp; grund: string }[] = [
  {
    muster: elementMuster('Table'),
    grund: 'keine zweite Tabellenwahrheit — über KatalogTabelle rendern',
  },
  {
    muster: /\bscroll=\{\{/g,
    grund: 'der waagerechte Bildlauf gehört KatalogTabelle, nicht hierher',
  },
  {
    muster: elementMuster('Card'),
    grund: 'die Kartenform ist Liste/ListenEintrag — ein Rahmen doppelt die li-Trennlinie',
  },
  {
    // Bewusster Doppelgurt neben `dichte.guard.test.ts`: jenes greift nur an INTERAKTIVEN Elementen,
    // dieses im Primitiv an jedem, weil auch eine Fläche hier die Kartenhöhe aller Konsumenten setzt.
    muster: /size="small"/g,
    grund: 'neue Klein-Varianten auf interaktiven Elementen sind verboten',
  },
  { muster: /matchMedia|\buseBreakpoint\b/g, grund: 'die Breitenfrage läuft über useViewport' },
];

/**
 * Die Anwesenheitsmarken der schriftlichen Begründung, am ROHTEXT gemessen: sie STEHEN im
 * Dateikopf, also in einem Kommentar. Eine Anwesenheitsmarke kann ihr eigenes Gate nicht
 * auslösen.
 */
const BEGRUENDUNG = ['KARTEN-AUSNAHME', 'TRENNLINIE'];

/**
 * Verbotene Formen je Konsumentendatei. `<Card` fehlt bewusst: die Kennzahlen- und Filter-Card
 * in `pages/KraefteuebersichtPage.tsx` sind legitim. Im PRIMITIV bleibt `<Card` verboten, dort
 * doppelte der Rahmen die li-Trennlinie.
 */
const VERBOTEN_BEIM_KONSUMENTEN: readonly { muster: RegExp; grund: string }[] = [
  { muster: elementMuster('Table'), grund: 'die Tabelle kommt aus Datensicht/KatalogTabelle' },
  { muster: /\bscroll=\{\{/g, grund: 'der Bildlauf gehört dem Primitiv' },
  { muster: /\bsorter:/g, grund: 'Sortierung läuft über sortWert, nicht über antds Haken' },
  { muster: /\bfilters:/g, grund: 'Filter laufen über filter: { werte, trifft }' },
  {
    muster: /\bresponsive:/g,
    grund: 'Spaltenbreiten laufen über abBreite (sonst lügt der Zähler)',
  },
  {
    muster: /\bdefaultSortOrder\b/g,
    grund:
      'die Voreinstellung läuft über standardSortierung — `DatensichtSpalte` blendet ' +
      'antds Prop aus, ein Nachzügler säße also stumm in der Spaltenliste',
  },
];

/**
 * Verbotene Formen in einer Datei aus {@link VOLLMENGE_PFLICHT}: alles, was das Primitiv Zeilen
 * entziehen oder umordnen ließe.
 */
const VERBOTEN_BEI_VOLLMENGE: readonly { muster: RegExp; grund: string }[] = [
  {
    muster: /\bsuche=\{/g,
    grund: 'die Freitextsuche des Primitivs entfernt Zeilen — gefiltert wird außerhalb',
  },
  {
    muster: /\bfilter:\s*\{/g,
    grund: 'ein Spaltenfilter entfernt Zeilen, die Elternaggregate zählen sie weiter mit',
  },
  {
    muster: /\bsortWert:/g,
    grund:
      'im Baumzweig gibt effektiveDaten die Daten referenzgleich zurück — der Pfeil ' +
      'verspräche eine Ordnung, die nie eintritt',
  },
  { muster: /\bstandardSortierung=/g, grund: 'siehe sortWert — die Baumordnung ist die Ordnung' },
];

/**
 * Beide Hälften in EINER Befundliste, rein und exportiert für die Selbstbeweise.
 */
export function befunde(
  dateien: Record<string, string>,
  ausnahmen: {
    eigenbau: readonly string[];
    nurKarte: readonly string[];
    nurTabelle: readonly string[];
    vollmenge: readonly string[];
  },
): string[] {
  const gefunden: string[] = [];
  const roh = dateien[PRIMITIV];

  // ── Hälfte 1: das Primitiv ────────────────────────────────────────────────────────
  if (roh == null) {
    gefunden.push(`${PRIMITIV} fehlt — das Primitiv ist die Grundlage dieses Guards.`);
  } else {
    const rein = ohneKommentare(roh);
    if (treffer(rein, elementMuster('KatalogTabelle')) < 1) {
      gefunden.push(
        `${PRIMITIV}: die tragende Marke <KatalogTabelle fehlt — ohne sie besteht ein ` +
          'Primitiv mit rohem Tabellenelement jede negative Prüfung und nimmt allen ' +
          'Konsumenten still Bildlauf, Kopfzeile und fixierte Kennung.',
      );
    }
    for (const { muster, grund } of VERBOTEN_IM_PRIMITIV) {
      const anzahl = treffer(rein, muster);
      if (anzahl > 0) gefunden.push(`${PRIMITIV}: ${anzahl}× ${muster.source} — ${grund}`);
    }
    for (const marke of BEGRUENDUNG) {
      // Am ROHTEXT: die Begründung steht im Dateikopf, also in einem Kommentar.
      if (!roh.includes(marke)) {
        gefunden.push(
          `${PRIMITIV}: die schriftliche Begründung "${marke}" fehlt — die Karten-Ausnahme ` +
            'ist begründungspflichtig (A1, Festlegung 2).',
        );
      }
    }
  }

  // ── Hälfte 2: die abgeleiteten Konsumenten ────────────────────────────────────────
  const konsumenten: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (pfad === PRIMITIV || istTest(pfad)) continue;
    const rein = ohneKommentare(inhalt);
    if (treffer(rein, elementMuster('Datensicht')) < 1) {
      // Kein Konsument. Ein `art: 'eigen'` ohne Sicht wäre trotzdem ein Verstoß — geprüft unten.
      if (/\bart:\s*'eigen'/.test(rein) && !ausnahmen.eigenbau.includes(pfad)) {
        gefunden.push(`${pfad}: art: 'eigen' ohne Eintrag in KARTEN_EIGENBAU.`);
      }
      continue;
    }
    konsumenten.push(pfad);

    for (const { muster, grund } of VERBOTEN_BEIM_KONSUMENTEN) {
      const anzahl = treffer(rein, muster);
      if (anzahl > 0) gefunden.push(`${pfad}: ${anzahl}× ${muster.source} — ${grund}`);
    }
    // Schließt das `const K`-Widening: eine annotierte Spaltenliste weitet K auf `string`, der Typ
    // sieht das nicht.
    if (!/\bspaltenFuer\b/.test(rein)) {
      gefunden.push(
        `${pfad}: die Marke spaltenFuer fehlt — eine annotierte Spaltenliste weitet die ` +
          'Schlüsselliterale auf string, und der Kartenplan nimmt danach jeden Tippfehler an.',
      );
    }
    if (/\bart:\s*'eigen'/.test(rein) && !ausnahmen.eigenbau.includes(pfad)) {
      gefunden.push(`${pfad}: art: 'eigen' ohne Eintrag in KARTEN_EIGENBAU.`);
    }
    if (ausnahmen.nurKarte.includes(pfad) && !/form="karte"/.test(rein)) {
      gefunden.push(`${pfad}: steht in NUR_KARTE, trägt aber kein form="karte".`);
    }
    if (ausnahmen.nurTabelle.includes(pfad) && !/form="tabelle"/.test(rein)) {
      gefunden.push(`${pfad}: steht in NUR_TABELLE, trägt aber kein form="tabelle".`);
    }
    // Die negative Hälfte zu NUR_TABELLE: was die Sicht nicht tun darf. Die Muster greifen nur
    // Props/Spaltenschlüssel des Primitivs, `Input.Search` bleibt unangetastet.
    if (ausnahmen.vollmenge.includes(pfad)) {
      for (const { muster, grund } of VERBOTEN_BEI_VOLLMENGE) {
        const anzahl = treffer(rein, muster);
        if (anzahl > 0) gefunden.push(`${pfad}: ${anzahl}× ${muster.source} — ${grund}`);
      }
    }
  }

  // Tote Ausnahmeeinträge melden, sonst veraltet die Liste still.
  for (const [name, liste] of [
    ['KARTEN_EIGENBAU', ausnahmen.eigenbau],
    ['NUR_KARTE', ausnahmen.nurKarte],
    ['NUR_TABELLE', ausnahmen.nurTabelle],
    ['VOLLMENGE_PFLICHT', ausnahmen.vollmenge],
  ] as const) {
    for (const eintrag of liste) {
      if (dateien[eintrag] == null) gefunden.push(`tote Ausnahme in ${name}: ${eintrag}`);
      else if (name !== 'KARTEN_EIGENBAU' && !konsumenten.includes(eintrag)) {
        gefunden.push(`tote Ausnahme in ${name}: ${eintrag} ist kein Datensicht-Konsument.`);
      }
    }
  }
  return gefunden;
}

/** Die abgeleitete Konsumentenmenge — für den Sichtbarkeits-Test unten. */
export function konsumentenVon(dateien: Record<string, string>): string[] {
  return Object.entries(dateien)
    .filter(
      ([pfad, inhalt]) =>
        pfad !== PRIMITIV &&
        !istTest(pfad) &&
        treffer(ohneKommentare(inhalt), elementMuster('Datensicht')) >= 1,
    )
    .map(([pfad]) => pfad)
    .sort();
}

const dateien = lieseQuellen(SRC);
const AUSNAHMEN = {
  eigenbau: KARTEN_EIGENBAU,
  nurKarte: NUR_KARTE,
  nurTabelle: NUR_TABELLE,
  vollmenge: VOLLMENGE_PFLICHT,
};

describe('Datensicht-Guard (LFH-330 · B2)', () => {
  it('das Primitiv kennt keinen eigenen Umbruchpunkt mehr (tabelleAb) — auto bricht bei md', () => {
    /*
     * Die Prop `tabelleAb` ist gefallen; ein Konsument, der sie setzt, bricht im Typcheck. Hier wird
     * die DEKLARATION ferngehalten: wer sie zurückholt, braucht wieder eine Browsermessung.
     */
    const primitiv = ohneKommentare(dateien[PRIMITIV] ?? '');
    expect(primitiv, 'Datensicht.tsx gelesen').toContain('export default function Datensicht');
    expect(primitiv).not.toMatch(/\btabelleAb\b/);
    // Der Auto-Zweig steht fest auf md, als LITERAL, damit ein stiller Wechsel rot wird.
    expect(primitiv).toMatch(/form === 'auto' && abBreite\('md'\)/);
    // Die Zeitachse ist keine Datensicht mehr.
    expect(konsumentenVon(dateien)).not.toContain('/src/etb/EtbZeitachse.tsx');
  });

  it('das Primitiv und alle abgeleiteten Konsumenten halten den Vertrag', () => {
    expect(
      befunde(dateien, AUSNAHMEN),
      'Der Tabellenzweig läuft über KatalogTabelle, Sortierung über sortWert, Filter über ' +
        'filter: { werte, trifft }, Spaltenbreiten über abBreite — und die Spaltenliste ' +
        'immer durch spaltenFuer<T>(), nie annotiert.',
    ).toEqual([]);
  });

  it('die fünf gepflegten Listen stehen auf dem entschiedenen Stand', () => {
    // LEER. Wer einträgt, begründet wie über der Liste beschrieben, sonst wäre der Kartenplan nur
    // ein Vorschlag.
    expect(KARTEN_EIGENBAU).toHaveLength(0);
    // Drei Kartenmodule, vier Vergleichsflächen (seit LFH-548 mit dem Funkplan). Wer einträgt,
    // ohne umzubauen, fällt am Anwesenheits-Gegentest auf; wer umbaut, ohne einzutragen, an der
    // Formprüfung.
    expect(NUR_KARTE).toHaveLength(3);
    expect(NUR_TABELLE).toHaveLength(4);
    // Eine PFLICHT, dateibezogen. Ein zweiter Eintrag braucht dieselbe Herleitung wie das Meldebild.
    expect(VOLLMENGE_PFLICHT).toHaveLength(1);
    // Eine SCHULD, auf 0 geschrumpft. Ein Eintrag wäre eine zweite Seite mit demselben Fehler.
    expect(REITERSCHLUESSEL_OFFEN).toHaveLength(0);
  });

  it('Sentinel: der Scan sieht das Primitiv und mehr als 200 Dateien', () => {
    // Ohne diesen Fall wäre ein kaputtes Scan-Muster still grün.
    expect(Object.keys(dateien).length).toBeGreaterThan(200);
    expect(dateien[PRIMITIV] ?? '').not.toBe('');
    expect(dateien[PRIMITIV]).toContain('KatalogTabelle');
  });

  it('der Scan sieht genau die geplanten Konsumenten (seit LFH-554: sechzehn)', () => {
    /**
     * Die Gleichheit prüft BEIDE Richtungen: eine still herausgefallene Datei bleibt in
     * {@link KONSUMENTEN} stehen, eine ungeplant hinzugekommene fehlt dort.
     */
    expect([...konsumentenVon(dateien)].sort()).toEqual([...KONSUMENTEN].sort());
  });

  it('mehrere Sichten in einer Datei tragen distinkte key-Angaben', () => {
    /**
     * Zwei `Datensicht` in den Zweigen eines Ternärs stehen an DERSELBEN Baumstelle mit demselben
     * Komponententyp; React reicht die Instanz weiter, samt Sortierung, Suchbegriff, Spaltenauswahl
     * und Zeilenschleuse. Keine Warnung, kein roter Test. Gelesen wird der `key` AM ELEMENT, aus dem
     * AST ({@link sichtstellen}).
     */
    expect(
      schluesselBefunde(dateien, KONSUMENTEN),
      'Zwei Sichten an derselben Baumstelle teilen ihren Zustand — jede braucht ihr eigenes, ' +
        'von den anderen verschiedenes key.',
    ).toEqual([]);
  });

  it('eine reiterabhängige Sicht trägt den Reiter im Schlüssel', () => {
    /**
     * Die zweite, häufigere Gestalt: EINE Sicht über mehreren Reitern. Die Regel darüber steigt bei
     * `stellen.length < 2` aus und sieht sie nicht.
     */
    const gemeldet = reiterBefunde(dateien, KONSUMENTEN);
    const istOffen = (b: string): boolean =>
      REITERSCHLUESSEL_OFFEN.some((p) => b.startsWith(`${p}:`));
    expect(
      gemeldet.filter((b) => !istOffen(b)),
      'Wer eine Reiterachse auf die Zeilenmenge legt, trägt den Reiter in den key — sonst ' +
        'reicht React beim Wechsel dieselbe Instanz samt Suchbegriff und Spaltenfilter weiter.',
    ).toEqual([]);

    // Der Gegentest der SCHULDMENGE steht umgekehrt zu dem der Ausnahmelisten: ein Eintrag ist tot,
    // wenn er nicht mehr GEMELDET wird. Die Schleife läuft derzeit leer; dass `reiterBefunde` etwas
    // findet, belegt der Selbstbeweis (a) unten.
    for (const eintrag of REITERSCHLUESSEL_OFFEN) {
      // Die Datei-Existenz zuerst und GETRENNT, sonst nennte die Meldung bei einer gelöschten Datei
      // eine falsche Ursache.
      expect(
        dateien[eintrag] != null,
        `tote Ausnahme in REITERSCHLUESSEL_OFFEN: ${eintrag} gibt es nicht mehr — ` +
          'umbenannt oder gelöscht, Eintrag nachziehen.',
      ).toBe(true);
      expect(
        gemeldet.some((b) => b.startsWith(`${eintrag}:`)),
        `toter Eintrag in REITERSCHLUESSEL_OFFEN: ${eintrag} wird nicht mehr gemeldet. ` +
          'Entweder hat die Datei ihren Reiterschlüssel bekommen — dann den Eintrag löschen — ' +
          'oder die Regel sieht sie nicht mehr, dann ist der Scanner kaputt und die anderen ' +
          'Zeilen dieses Tests sind wertlos grün.',
      ).toBe(true);
    }
  });

  it('Selbstbeweis: die Reiterregel trifft die eine Form und verschont die drei anderen', () => {
    const reiter = ['const x = <Tabs activeKey={sicht} onChange={setSicht} />;'];
    const lauf = (zeilen: string[]): string[] =>
      reiterBefunde({ '/src/pages/R.tsx': zeilen.join('\n') }, ['/src/pages/R.tsx']);

    // (a) Der Befund: Achse gesetzt, Daten hängen daran (über eine lokale const, wie in der echten
    // Datei), der Schlüssel fehlt.
    const getroffen = lauf([
      ...reiter,
      'const zeilen = filterTiere(alle, { sicht });',
      'const y = <Datensicht daten={zeilen} suche={{ platzhalter: "x" }} />;',
    ]);
    expect(getroffen).toHaveLength(1);
    expect(getroffen[0]).toContain('der key (fehlt) nicht');

    // (b) Derselbe Aufbau MIT Reiter im Schlüssel ist still; das ist die Behebung.
    expect(
      lauf([
        ...reiter,
        'const zeilen = filterTiere(alle, { sicht });',
        'const y = <Datensicht key={`liste-${sicht}`} daten={zeilen} />;',
      ]),
    ).toEqual([]);

    // (c) KONSTANTER Schlüssel über achsunabhängigen Daten ist richtig (die Form von
    // `key="patienten"`).
    expect(
      lauf([
        ...reiter,
        'const y = <Datensicht key="patienten" daten={alle.filter(istPatient)} />;',
      ]),
    ).toEqual([]);

    // (d) Ohne Schalterachse gibt es keinen Reiter; sonst meldete die Regel jede schlüssellose Sicht.
    expect(lauf(['const y = <Datensicht daten={filterTiere(alle, { sicht })} />;'])).toEqual([]);

    /**
     * (e) EIN ZEICHENKETTENWERT IM SCHALTER IST KEINE ACHSE: der Aufklapp-Umschalter der
     * Kräfteübersicht trägt seine Zustände als Zeichenketten im `value`. Die „Behebung“ per `key` am
     * Umschalter verwürfe bei jedem Aufklappen Sortierung, Spaltenwahl und Zeilenschleuse.
     */
    expect(
      lauf([
        "const s = <Segmented value={offen.length > 0 ? 'alle' : 'abschnitte'} />;",
        'const y = <Datensicht daten={bild.abschnitte} />;',
      ]),
      'ein Zeichenkettenwert im Schalter darf keine Achse werden',
    ).toEqual([]);

    // (f) Gegenprobe zu (e): ein echter Bezeichner im selben Schalter, an dem die Daten hängen,
    // meldet weiter.
    expect(
      lauf([
        "const s = <Segmented value={sicht === 'alle' ? 'alle' : 'eng'} />;",
        'const y = <Datensicht daten={filterTiere(alle, { sicht })} />;',
      ]),
    ).toHaveLength(1);

    // (g) Ein PROPERTY-Name ist keine Achse: `offen.length` steuert `offen` bei, nicht `length`.
    expect(
      lauf([
        'const s = <Segmented value={offen.length} />;',
        'const y = <Datensicht daten={alle.length > 0 ? alle : leer} />;',
      ]),
      'ein Property-Name im Schalter darf keine Achse werden',
    ).toEqual([]);
  });

  it('Sentinel: der Schlüssel-Scan sieht die zwei Sichten von PersonenPage', () => {
    // Ein Scanner, der überall [] liefert, meldete „keine Datei hat ≥ 2 Sichten“ und wäre still grün.
    // Gepinnt gegen den echten Baum, samt Block-Kommentar im öffnenden Element (Trivia). Bewusst nicht
    // auf die Schlüsselwerte gepinnt, die Seite gehört einem anderen Bündel.
    const pfad = '/src/pages/PersonenPage.tsx';
    const stellen = sichtstellen(pfad, dateien[pfad] ?? '');
    expect(stellen).toHaveLength(2);
    expect(stellen.every((s) => s.schluessel != null)).toBe(true);
  });

  it('Selbstbeweis: fremde key= aus Zellen-Renderern decken fehlende Sichtschlüssel nicht zu', () => {
    // Zwei Sichten OHNE Schlüssel plus zwei `key=` aus Renderern: zählend wäre das grün, und es ist
    // der Normalfall einer Listenseite.
    const datei = [
      'const zellen = werte.map((w) => <Tag key={w}>{w}</Tag>);',
      'const kopf = spalten.map((s) => <th key={s.key}>{s.title}</th>);',
      'const x = offen ? <Datensicht spalten={a} /> : <Datensicht spalten={b} />;',
    ].join('\n');
    expect(schluesselBefunde({ '/src/pages/Zwei.tsx': datei }, ['/src/pages/Zwei.tsx'])).toEqual([
      '/src/pages/Zwei.tsx: 2 Sichten, davon 2 ohne key (Zeile 3, 3).',
    ]);
  });

  it('Selbstbeweis: zwei Sichten mit demselben Schlüssel fallen auf, mit verschiedenen nicht', () => {
    const gleich = 'const x = offen ? <Datensicht key="liste" /> : <Datensicht key="liste" />;';
    expect(
      schluesselBefunde({ '/src/pages/Doppelt.tsx': gleich }, ['/src/pages/Doppelt.tsx']),
    ).toEqual(['/src/pages/Doppelt.tsx: 2 Sichten teilen den key "liste".']);
    const verschieden = 'const x = offen ? <Datensicht key="a" /> : <Datensicht key="b" />;';
    expect(
      schluesselBefunde({ '/src/pages/Doppelt.tsx': verschieden }, ['/src/pages/Doppelt.tsx']),
    ).toEqual([]);
    // Auch für den AUSDRUCKS-Schlüssel (`key={…}`) gilt: gemessen wird der Quelltext, zweimal
    // derselbe Ausdruck ist eine Dublette.
    const gleicherAusdruck =
      'const x = offen ? <Datensicht key={`liste-${sicht}`} /> : <Datensicht key={`liste-${sicht}`} />;';
    expect(
      schluesselBefunde({ '/src/pages/Dyn.tsx': gleicherAusdruck }, ['/src/pages/Dyn.tsx']),
    ).toEqual(['/src/pages/Dyn.tsx: 2 Sichten teilen den key `liste-${sicht}`.']);
    const andereAusdruecke =
      'const x = offen ? <Datensicht key={`liste-${a}`} /> : <Datensicht key={`liste-${b}`} />;';
    expect(
      schluesselBefunde({ '/src/pages/Dyn.tsx': andereAusdruecke }, ['/src/pages/Dyn.tsx']),
    ).toEqual([]);
    // Eine EINZELNE Sicht braucht keinen Schlüssel: ohne Geschwister gibt es keine Verwechslung.
    expect(
      schluesselBefunde({ '/src/pages/Eine.tsx': 'const x = <Datensicht daten={d} />;' }, [
        '/src/pages/Eine.tsx',
      ]),
    ).toEqual([]);
  });

  it('Selbstbeweis: fehlende tragende Marke UND jede Verbotsform werden gemeldet', () => {
    const nurRohesElement = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <Table dataSource={x} />;',
    };
    const gemeldet = befunde(nurRohesElement, {
      eigenbau: [],
      nurKarte: [],
      nurTabelle: [],
      vollmenge: [],
    });
    expect(gemeldet.some((b) => b.includes('<KatalogTabelle fehlt'))).toBe(true);
    expect(gemeldet.some((b) => b.includes('keine zweite Tabellenwahrheit'))).toBe(true);
  });

  it('Selbstbeweis: die Begründungsmarken werden verlangt', () => {
    const ohneBegruendung = { [PRIMITIV]: 'const a = <KatalogTabelle columns={c} />;' };
    const gemeldet = befunde(ohneBegruendung, {
      eigenbau: [],
      nurKarte: [],
      nurTabelle: [],
      vollmenge: [],
    });
    expect(gemeldet.filter((b) => b.includes('schriftliche Begründung'))).toHaveLength(2);
  });

  it('Selbstbeweis: ein Konsument ohne spaltenFuer und mit antds Haken fällt auf', () => {
    const baum = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <KatalogTabelle columns={c} />;',
      '/src/pages/Schlampig.tsx': [
        'const spalten: readonly DatensichtSpalte<P>[] = [',
        "  { key: 'a', title: 'A', sorter: (x, y) => 0, filters: [], responsive: ['lg'],",
        "    defaultSortOrder: 'descend' },",
        '];',
        'const x = <Datensicht spalten={spalten} />;',
        'const y = <Table dataSource={d} scroll={{ x: 1 }} />;',
      ].join('\n'),
    };
    const gemeldet = befunde(baum, { eigenbau: [], nurKarte: [], nurTabelle: [], vollmenge: [] });
    const eigene = gemeldet.filter((b) => b.startsWith('/src/pages/Schlampig.tsx'));
    // Sechs Verbotsmarken plus die fehlende spaltenFuer-Marke; fällt ein Muster weg, fällt die Zahl
    // auf 6.
    expect(eigene).toHaveLength(7);
    expect(eigene.some((b) => b.includes('spaltenFuer'))).toBe(true);
    expect(eigene.some((b) => b.includes('defaultSortOrder'))).toBe(true);
  });

  it('Selbstbeweis: Suche, Spaltenfilter und Sortierung fallen NUR in einer Vollmengen-Pflichtdatei auf', () => {
    const baum = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <KatalogTabelle columns={c} />;',
      '/src/pages/Meldebild.tsx': [
        'const spalten = spaltenFuer<Zeile>()([',
        "  { key: 'bez', filter: { werte: [], trifft: () => true }, sortWert: (z) => z.bez },",
        ']);',
        'const x = (',
        '  <Datensicht',
        '    spalten={spalten}',
        '    form="tabelle"',
        "    suche={{ platzhalter: 'Suche…' }}",
        "    standardSortierung={{ spalte: 'bez', richtung: 'auf' }}",
        '  />',
        ');',
      ].join('\n'),
    };
    const mitPflicht = befunde(baum, {
      eigenbau: [],
      nurKarte: [],
      nurTabelle: [],
      vollmenge: ['/src/pages/Meldebild.tsx'],
    });
    expect(mitPflicht).toHaveLength(4);
    // Dieselbe Datei OHNE Eintrag ist sauber: die Liste ist dateibezogen.
    expect(befunde(baum, { eigenbau: [], nurKarte: [], nurTabelle: [], vollmenge: [] })).toEqual(
      [],
    );
  });

  it('Selbstbeweis: Input.Search bleibt in einer Vollmengen-Pflichtdatei erlaubt', () => {
    // Die Filter-Card liegt AUSSERHALB der Datensicht und filtert die Rohlisten; ein Verbot von
    // Input.Search träfe die einzige Stelle, an der das Meldebild filtern darf.
    const baum = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <KatalogTabelle columns={c} />;',
      '/src/pages/Meldebild.tsx': [
        "const spalten = spaltenFuer<Zeile>()([{ key: 'bez' }]);",
        'const f = (',
        '  <Card>',
        '    <Input.Search value={filter.suche}',
        '      onChange={(e) => setFilter((f) => ({ ...f, suche: e.target.value }))} />',
        '  </Card>',
        ');',
        'const x = <Datensicht spalten={spalten} form="tabelle" daten={bild.baum} />;',
      ].join('\n'),
    };
    expect(
      befunde(baum, {
        eigenbau: [],
        nurKarte: [],
        nurTabelle: ['/src/pages/Meldebild.tsx'],
        vollmenge: ['/src/pages/Meldebild.tsx'],
      }),
    ).toEqual([]);
  });

  it('Selbstbeweis: art eigen ohne Eintrag fällt auf, mit Eintrag nicht', () => {
    const zeile = "const p = { art: 'eigen', render: (k) => null };";
    const baum = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <KatalogTabelle columns={c} />;',
      '/src/pages/Eigen.tsx': `${zeile}\nconst x = <Datensicht spaltenFuer />;`,
    };
    expect(
      befunde(baum, { eigenbau: [], nurKarte: [], nurTabelle: [], vollmenge: [] }).some((b) =>
        b.includes("art: 'eigen' ohne Eintrag"),
      ),
    ).toBe(true);
    expect(
      befunde(baum, {
        eigenbau: ['/src/pages/Eigen.tsx'],
        nurKarte: [],
        nurTabelle: [],
        vollmenge: [],
      }),
    ).toEqual([]);
  });

  it('Selbstbeweis: eine Formliste ohne das passende Literal fällt auf', () => {
    // Eine Datei mit form="karte" bleibt bei <Table = 0 grün, auch wenn sie eine Tabelle rendert.
    const baum = {
      [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\nconst a = <KatalogTabelle columns={c} />;',
      '/src/pages/Befehle.tsx': 'const x = <Datensicht spaltenFuer form="auto" />;',
    };
    const gemeldet = befunde(baum, {
      eigenbau: [],
      nurKarte: ['/src/pages/Befehle.tsx'],
      nurTabelle: [],
      vollmenge: [],
    });
    expect(gemeldet).toEqual([
      '/src/pages/Befehle.tsx: steht in NUR_KARTE, trägt aber kein form="karte".',
    ]);
  });

  it('Selbstbeweis: tote Ausnahmeeinträge werden gemeldet', () => {
    const baum = { [PRIMITIV]: 'KARTEN-AUSNAHME TRENNLINIE\n<KatalogTabelle columns={c} />' };
    expect(
      befunde(baum, {
        eigenbau: [],
        nurKarte: ['/src/pages/Weg.tsx'],
        nurTabelle: [],
        vollmenge: [],
      }),
    ).toEqual(['tote Ausnahme in NUR_KARTE: /src/pages/Weg.tsx']);
    // Auch die vierte Liste rottet nicht still: ein Eintrag ohne Datei fällt auf.
    expect(
      befunde(baum, {
        eigenbau: [],
        nurKarte: [],
        nurTabelle: [],
        vollmenge: ['/src/pages/Weg.tsx'],
      }),
    ).toEqual(['tote Ausnahme in VOLLMENGE_PFLICHT: /src/pages/Weg.tsx']);
  });

  it('Selbstbeweis: Kommentar-Fundstellen zählen nicht, auch im Block über Zeilen', () => {
    const baum = {
      [PRIMITIV]: [
        '/* KARTEN-AUSNAHME und TRENNLINIE stehen hier, im Kommentar',
        '   und hier erwähne ich <Table und scroll={{ x }} und <Card',
        '   und size="small" — nichts davon zählt */',
        '// auch hier nicht: <Table scroll={{ x: 1 }} matchMedia',
        'const a = <KatalogTabelle columns={c} />;',
      ].join('\n'),
    };
    // Verbotsformen im Kommentar → 0 Befunde; die BEGRÜNDUNG im Kommentar wird trotzdem gefunden
    // (Rohtext). Diese Asymmetrie ist der Grund für die zwei Textquellen.
    expect(befunde(baum, { eigenbau: [], nurKarte: [], nurTabelle: [], vollmenge: [] })).toEqual(
      [],
    );
  });

  it('Selbstbeweis: die generische Schreibweise wird richtig zugeordnet', () => {
    // `<KatalogTabelle<T>` darf NICHT als antd-Tabellenelement zählen (vor `Table` steht
    // kein `<`), `<Table<T>` MUSS es. Und `useMemo<TableColumnsType<T>>` ist keins von beiden.
    const probe = 'const a = <KatalogTabelle<Uhs> c={x} />; const t: TableColumnsType<Uhs> = [];';
    expect(treffer(probe, elementMuster('Table'))).toBe(0);
    expect(treffer(probe, elementMuster('KatalogTabelle'))).toBe(1);
    expect(treffer('const b = <Table<Uhs> rowKey="id" />;', elementMuster('Table'))).toBe(1);
    expect(treffer('useMemo<TableColumnsType<T>>(() => [])', elementMuster('Table'))).toBe(0);
  });
});
