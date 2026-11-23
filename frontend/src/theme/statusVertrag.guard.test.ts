/**
 * Vertrags-Guard des Statusfarb-Vertrags (LFH-358).
 *
 * Guard 1: kein `Record<…, StatusDarstellung>` außerhalb von `theme/statusFarben.ts`. Eine
 * Karte anderswo liefe an `ALLE_MAPS` in `statusFarben.test.ts` vorbei, das die geprüften
 * Karten aus den Exporten des Moduls ableitet.
 *
 * Die früheren Guards 2 und 3 (kein `<Tag color=…>`) sind seit LLH-1779 (Change
 * `eon26eat-status-und-bedienung`, design.md D5) eine Lint-Sperre: antds `Tag` ist außerhalb
 * der Sichtung gar nicht mehr zu importieren (`.oxlintrc.json`). Ein Zustand steht in `Status`,
 * eine Kennzeichnung in `Marke` (`components/instrument/`).
 *
 * ── WAS DIESE GUARDS NICHT SEHEN (Teil des Vertrags) ──
 *
 *   • Eine EINZELNE `StatusDarstellung` statt eines `Record` (`kraefte/statusAchse.ts`,
 *     `OHNE_STATUS`: die Abwesenheit eines Werts, keine Enum-Achse).
 *   • Einen Alias als Werttyp (`type Karte = StatusDarstellung`). Qualifizierte Namen,
 *     Vereinigungsglieder und Hüllen aus {@link FORMERHALTEND} werden erkannt, Aliase nicht.
 *   • Eine unbekannte formerhaltende Hülle (`DeepReadonly<…>`), siehe {@link FORMERHALTEND}.
 *   • Stellungen, in denen ein Bezeichner nicht gelesen wird, außer den erfassten
 *     (Eigenschaft hinter Punkt, Objektschlüssel, Methoden-Kurzform, Text in Zeichenketten).
 *     Destrukturierung, Label oder Parameternamen erkennt der Scanner nicht.
 *   • Einen Vertragsnamen, der über eine zweite Datei umbenannt weitergereicht wird
 *     (`personen/personMeta.ts`: `personStatus as STATUS_META`); aufgelöst wird nur der
 *     direkte Import.
 *   • Ein mehrzeiliges Template-Literal mit Kommentarzeichen darin (siehe {@link stringEnde}).
 *   • Eine FUNKTION, die eine `StatusDarstellung` baut (`MaterialPage`, `FahrzeugePage`,
 *     `PersonalPage`): das ist die DB-Achse `status_farbe`, die `statusFarben.ts` ausdrücklich
 *     außerhalb des Vertrags führt.
 *   • Jede Indirektion über eine Bindung (`const AKTIV = 'aktiv'`, `const f = rollenFarbe(…)`):
 *     der Scanner sieht Zeichen, keine Auswertung.
 *
 * ── WO DIESE GUARDS ZU VIEL MELDEN KÖNNEN ──
 *
 * (1) Ein gleichnamiger, unverwandter Typ `StatusDarstellung`: Guard 1 vergleicht dem Namen
 * nach. Ein Import-Nachweis wie bei den Werten ist bewusst nicht gebaut: er hätte mehrere
 * Importformen und Re-Exporte zu verfolgen, und jede verfehlte Form wäre ein Falsch-Negativ an
 * der Hauptzusicherung. Ein Fehlalarm ist in Minuten geklärt.
 *
 * (2) Ein Wire-Wert, den eine Nicht-Vertrags-Achse teilt: `TierStatus` teilt alle drei Werte
 * mit Vertragskarten. Die Tierseiten färben deshalb über eine eigene `STATUS_META`-Karte; wer
 * sie durch einen Inline-Vergleich ersetzt, bekommt diesen Guard rot, und die Abhilfe ist die
 * Karte. Sauber trennen ließe sich das nur über den Typ des Ausdrucks (Syntaxbaum).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENDUNGEN = /\.(ts|tsx)$/;

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
 * Schließendes Anführungszeichen zu `auf`, aber NUR auf derselben Zeile; sonst `-1`.
 *
 * Ein Stripper ohne Zeichenketten hält das `//` in `title="https://…"` für einen Kommentar
 * und schneidet ein `color` dahinter ab. Einer, der jedes Anführungszeichen verfolgt,
 * verschluckt am Apostroph in JSX-Text alles bis zum nächsten. Nur was auf seiner Zeile
 * schließt, gilt deshalb als Zeichenkette; mehrzeilige Template-Literale bleiben Blindfleck.
 */
function stringEnde(zeile: string, auf: number): number {
  const zeichen = zeile[auf];
  for (let i = auf + 1; i < zeile.length; i++) {
    if (zeile[i] === '\\') {
      i++;
      continue;
    }
    if (zeile[i] === zeichen) return i;
  }
  return -1;
}

/**
 * Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen; die Zeilenzahl
 * bleibt erhalten (Index = Zeile - 1). Überspringt Zeichenketten ({@link stringEnde}), sonst
 * schaltete ein `/*` in einem Literal den Rest der Datei stumm.
 */
function ohneKommentare(inhalt: string): string[] {
  const zeilen: string[] = [];
  let imBlock = false;
  for (const roh of inhalt.split('\n')) {
    let sichtbar = '';
    let i = 0;
    while (i < roh.length) {
      if (imBlock) {
        const ende = roh.indexOf('*/', i);
        if (ende === -1) break; // Rest der Zeile liegt im Block
        imBlock = false;
        i = ende + 2;
        continue;
      }
      const z = roh[i];
      if (z === '"' || z === "'" || z === '`') {
        const schluss = stringEnde(roh, i);
        if (schluss !== -1) {
          sichtbar += roh.slice(i, schluss + 1);
          i = schluss + 1;
          continue;
        }
      }
      if (z === '/' && roh[i + 1] === '/') break;
      if (z === '/' && roh[i + 1] === '*') {
        imBlock = true;
        i += 2;
        continue;
      }
      sichtbar += z;
      i++;
    }
    zeilen.push(sichtbar);
  }
  return zeilen;
}

/**
 * Der Vertrag selbst, die Tests und der Codegen sind kein Prüfgegenstand. Der Vertrag ist
 * EINE DATEI, nicht das Verzeichnis: eine Karte in einem Geschwistermodul wie
 * `theme/darstellungOptionen.ts` liefe am Abdeckungstest genauso vorbei wie eine in `pages/`.
 */
function ausserhalbDesVertrags(pfad: string): boolean {
  if (pfad === '/src/theme/statusFarben.ts') return false;
  if (/\.test\.[jt]sx?$/.test(pfad) || /\.generated\.[jt]sx?$/.test(pfad)) return false;
  return true;
}

// ──────────────────── Guard 1: Karten neben der Vertragsdatei ──────────────────

/**
 * Ein `Record<…, StatusDarstellung>`, und NUR mit `StatusDarstellung` als WERT-Typ.
 *
 * Die Typargumente werden wirklich zerlegt statt per Regex gesucht: `[^>]` überquert kein
 * verschachteltes `>` im Schlüssel (`Record<Exclude<X, null>, StatusDarstellung>`), und eine
 * gelockerte Regex meldete Konsumenten wie `Record<NonNullable<StatusDarstellung['form']>,
 * string>`. Der letzte Parameter wird als Vereinigung gelesen, damit fällt auch
 * `Record<X, StatusDarstellung | null>` auf.
 */
function typargumente(text: string, auf: number): string[] | null {
  let tiefe = 0;
  let anfuehrung: string | null = null;
  let letzter = auf + 1;
  const args: string[] = [];
  for (let i = auf; i < text.length; i++) {
    const z = text[i];
    if (anfuehrung) {
      if (z === '\\') i++;
      else if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') anfuehrung = z;
    else if (z === '<' || z === '[' || z === '(' || z === '{') tiefe++;
    else if (z === ']' || z === ')' || z === '}') tiefe--;
    else if (z === ',' && tiefe === 1) {
      args.push(text.slice(letzter, i));
      letzter = i + 1;
    } else if (z === '>' && text[i - 1] === '=') {
      // Der Pfeil eines FUNKTIONSTYPS, kein schließendes Typargument. Ohne diese Ausnahme
      // senkt `(x: X) => string` die Bilanz und die Karte liefe unsichtbar durch.
      continue;
    } else if (z === '>') {
      tiefe--;
      if (tiefe === 0) {
        args.push(text.slice(letzter, i));
        return args;
      }
    }
  }
  return null; // schließt nicht — kein Urteil, lieber kein Befund als ein erfundener
}

/**
 * Hüllen, die die FORM des Werts erhalten: `Readonly<StatusDarstellung>` ist derselbe
 * Vertragstyp. Bewusst eine Namensliste: `Array`, `Promise` oder `Set` haben ebenfalls ein
 * Typargument, aber `Record<Gruppe, Array<StatusDarstellung>>` bildet kein Enum auf seine
 * Darstellung ab, und ihn zu melden wäre ein Fehlalarm. Eine neue Hilfstype außerhalb der
 * Liste ist der dokumentierte Blindfleck.
 */
const FORMERHALTEND = ['Readonly', 'Required', 'Partial', 'NonNullable'];

/** Schält {@link FORMERHALTEND}e Hüllen ab, mehrfach geschachtelt bis zum blanken Namen. */
/** Index der zur Klammer bei 0 gehoerenden schliessenden Klammer, oder `-1`. */
function klammerPaarEnde(text: string): number {
  let tiefe = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') tiefe++;
    else if (text[i] === ')' && --tiefe === 0) return i;
  }
  return -1;
}

function blattTyp(arg: string): string {
  let rest = arg.trim();
  for (;;) {
    // Eine UMSCHLIESSENDE Klammer ist Gruppierung: `typglieder` lässt die Vereinigung in
    // `(StatusDarstellung | null) & {…}` stehen (Tiefe > 0), das Abschälen muss sie öffnen.
    // Bei `(A|B)&(C)` schließt die erste Klammer vor dem Ende, der Ausdruck bleibt stehen.
    if (rest.startsWith('(') && klammerPaarEnde(rest) === rest.length - 1) {
      rest = rest.slice(1, -1).trim();
      continue;
    }
    const auf = rest.indexOf('<');
    if (auf === -1 || !rest.endsWith('>')) return rest;
    if (!FORMERHALTEND.includes(rest.slice(0, auf).trim())) return rest;
    const args = typargumente(rest, auf);
    if (!args || args.length !== 1) return rest;
    rest = args[0].trim();
  }
}

/**
 * Zerlegt den letzten Typparameter in seine Glieder auf oberster Ebene, Vereinigung `|` UND
 * Durchschnitt `&`: `Record<X, StatusDarstellung & { icon: … }>` ist erst recht eine Karte.
 */
function typglieder(arg: string): string[] {
  const teile: string[] = [];
  let tiefe = 0;
  let letzter = 0;
  for (let i = 0; i < arg.length; i++) {
    const z = arg[i];
    if (z === '>' && arg[i - 1] === '=') continue; // Pfeil eines Funktionstyps
    if (z === '<' || z === '[' || z === '(' || z === '{') tiefe++;
    else if (z === '>' || z === ']' || z === ')' || z === '}') tiefe--;
    else if ((z === '|' || z === '&') && tiefe === 0) {
      teile.push(arg.slice(letzter, i));
      letzter = i + 1;
    }
  }
  teile.push(arg.slice(letzter));
  return teile.map((t) => t.trim());
}

/**
 * Trägt dieser Typausdruck den Vertragstyp, als Glied, unter einer Hülle oder beides?
 * Rekursiv, weil bei `Readonly<StatusDarstellung & { icon }>` das `&` erst nach dem Abschälen
 * zerlegt werden kann. Die Rekursion läuft nur, wenn {@link blattTyp} etwas abgeschält hat.
 */
function traegtVertragstyp(ausdruck: string): boolean {
  for (const glied of typglieder(ausdruck)) {
    const blatt = blattTyp(glied);
    if ((blatt.split('.').pop() ?? blatt).trim() === 'StatusDarstellung') return true;
    if (blatt !== glied.trim() && traegtVertragstyp(blatt)) return true;
  }
  return false;
}

/**
 * Liegt `spalte` INNERHALB einer Zeichenkette dieser Zeile?
 *
 * {@link ohneKommentare} lässt Zeichenketten absichtlich stehen, weil der Tag-Guard ihren
 * Inhalt (die Wire-Werte) braucht. Für den ANFANG einer Deklaration oder Auszeichnung ist das
 * falsch: `'Record<X, StatusDarstellung>'` und `'<Tag color={…}>'` sind Text. Beide Guards
 * filtern deshalb die POSITION ihrer Marke, nicht deren Inhalt. Geschlossene Zeichenketten
 * davor werden übersprungen, weil ein zweites `<Tag>` hinter dem `"green"` eines ersten auf
 * derselben Zeile echt ist. Wie in {@link stringEnde} gilt nur, was auf seiner Zeile schließt.
 */
function inZeichenkette(zeile: string, spalte: number): boolean {
  for (let i = 0; i < spalte; i++) {
    const z = zeile[i];
    if (z !== '"' && z !== "'" && z !== '`') continue;
    // Ein Anführungszeichen direkt hinter einem Bezeichnerzeichen öffnet keine Zeichenkette
    // (`<div>geht's <Tag color={…}`); in JavaScript gibt es diese Stellung nicht.
    // Heuristik: ein Apostroph am Anfang eines JSX-Textknotens (`<div>'tis`) gilt weiter als
    // Öffner; ihn zu erkennen hieße, JSX zu parsen.
    if (/[A-Za-z0-9_$]/.test(zeile[i - 1] ?? '')) continue;
    const zu = stringEnde(zeile, i);
    if (zu === -1) continue;
    if (spalte < zu) return true;
    i = zu;
  }
  return false;
}

/**
 * Stellen, an denen ein `Record<…>` den Vertragstyp als WERT trägt (Index des `Record`).
 *
 * Die Marke braucht eine Wortgrenze davor, sonst würden `CustomRecord<K, StatusDarstellung>`
 * oder `parseRecord<…>()` gemeldet. Ein Punkt davor zählt nicht als Grenze:
 * `sf.Record<…>` ist derselbe Abbildungstyp.
 */
export function kartenStellen(text: string): number[] {
  const treffer: number[] = [];
  const zeilen = text.split('\n');
  for (let i = text.indexOf('Record<'); i !== -1; i = text.indexOf('Record<', i + 7)) {
    if (/[A-Za-z0-9_$]/.test(text[i - 1] ?? '')) continue;
    const davor = text.slice(0, i).split('\n');
    const zeile = zeilen[davor.length - 1] ?? '';
    if (inZeichenkette(zeile, davor[davor.length - 1].length)) continue;
    const args = typargumente(text, i + 'Record'.length);
    if (!args || args.length < 2) continue;
    // Der letzte Punkt-Abschnitt zählt, damit `sf.StatusDarstellung` nicht vorbeiläuft.
    // Aliase löst der Guard nicht auf.
    if (traegtVertragstyp(args[args.length - 1])) {
      treffer.push(i);
    }
  }
  return treffer;
}

export function kartenBefunde(dateien: Record<string, string>): string[] {
  const verstoesse: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (!ausserhalbDesVertrags(pfad)) continue;
    if (!inhalt.includes('StatusDarstellung')) continue;
    const sichtbar = ohneKommentare(inhalt).join('\n');
    for (const stelle of kartenStellen(sichtbar)) {
      const zeile = sichtbar.slice(0, stelle).split('\n').length;
      const auszug = sichtbar.slice(stelle, stelle + 120).replace(/\s+/g, ' ');
      verstoesse.push(`${pfad}:${zeile}  ${auszug.slice(0, 80)}`);
    }
  }
  return verstoesse;
}

describe('Statusfarb-Vertrag: keine Karte neben der Vertragsdatei (LFH-358)', () => {
  it('findet keinen `Record<…, StatusDarstellung>` neben dem Vertrag', () => {
    const verstoesse = kartenBefunde(lieseQuellen(SRC));
    expect(
      verstoesse,
      'Eine Statusfarb-Karte gehört nach `theme/statusFarben.ts`. Dort greift der ' +
        'selbst ableitende Abdeckungstest (`statusFarben.test.ts`); hier draußen läuft ' +
        'sie an ihm vorbei, und der Vertrag behauptet eine Vollständigkeit, die er ' +
        `nicht hat:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  // Ohne diesen Test wäre die leere Liste oben auch dann grün, wenn der Scanner nichts fände.
  it('wird rot, sobald eine Karte neben der Vertragsdatei angelegt wird', () => {
    const einzeilig = kartenBefunde({
      '/src/pages/Irgendwas.tsx': 'const x: Record<MeinEnum, StatusDarstellung> = { a: b };',
    });
    expect(einzeilig).toHaveLength(1);
    expect(einzeilig[0]).toContain('/src/pages/Irgendwas.tsx:1');

    // Prettier bricht lange Generics um — ein zeilenweiser Scanner sähe das nicht.
    expect(
      kartenBefunde({
        '/src/pages/Mehrzeilig.ts':
          'export const k: Record<\n  Dringlichkeit,\n  StatusDarstellung\n> = {};',
      }),
    ).toHaveLength(1);

    // Auch ein Geschwistermodul im Vertragsverzeichnis ist nicht der Vertrag.
    expect(
      kartenBefunde({
        '/src/theme/darstellungOptionen.ts': 'const k: Record<X, StatusDarstellung> = {};',
      }),
    ).toHaveLength(1);
    // Die Vertragsdatei selbst bleibt draußen, sonst meldete der Guard jede echte Karte.
    expect(
      kartenBefunde({
        '/src/theme/statusFarben.ts': 'export const k: Record<X, StatusDarstellung> = {};',
      }),
    ).toEqual([]);
  });

  it('zerlegt die Typargumente, statt am ersten `>` abzubrechen', () => {
    // Ein verschachteltes Typargument im Schlüssel darf den Ausdruck nicht vorzeitig beenden.
    expect(
      kartenBefunde({
        '/src/pages/Eng.ts': 'const k: Record<Exclude<MeinStatus, null>, StatusDarstellung> = {};',
      }),
    ).toHaveLength(1);

    // Der letzte Parameter wird als Vereinigung gelesen.
    expect(
      kartenBefunde({
        '/src/pages/Union.ts': 'const k: Record<X, StatusDarstellung | null> = {};',
      }),
    ).toHaveLength(1);

    // Gegenrichtung: ein Konsument des Typs bleibt ruhig; `Partial<>` zeigt, dass Schachtelung
    // nach außen nicht stört.
    expect(
      kartenBefunde({
        '/src/components/Attrappe5.tsx': [
          "const F: Record<NonNullable<StatusDarstellung['form']>, string> = {};",
          'const G: Record<Exclude<A, B>, string> = {};',
        ].join('\n'),
      }),
    ).toEqual([]);
    expect(
      kartenBefunde({
        '/src/pages/Teil.ts': 'const k: Partial<Record<X, StatusDarstellung>> = {};',
      }),
    ).toHaveLength(1);
  });

  it('lässt Konsumenten in Ruhe — Prop, Rückgabetyp, Schlüsselrolle', () => {
    expect(
      kartenBefunde({
        // Genau die drei Formen, die im Bestand stehen (Status, Datensicht, MaterialPage).
        '/src/components/Attrappe.tsx': [
          "const FORM: Record<NonNullable<StatusDarstellung['form']>, string> = {};",
          'interface P { darstellung: StatusDarstellung }',
          'function d(x: X): StatusDarstellung { return { rolle: "neutral", label: "x" }; }',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('erkennt den Vertragstyp unter einer durchsichtigen Hülle', () => {
    // `Readonly<StatusDarstellung>` ist derselbe Vertragstyp, nur anders geschrieben.
    expect(
      kartenBefunde({
        '/src/pages/Hoh.ts': 'const k: Record<X, Readonly<StatusDarstellung>> = {};',
      }),
    ).toHaveLength(1);
    // Mehrfach geschachtelt ebenso — die Schleife läuft bis zum blanken Namen.
    expect(
      kartenBefunde({
        '/src/pages/Tief.ts': 'const k: Record<X, Readonly<Required<StatusDarstellung>>> = {};',
      }),
    ).toHaveLength(1);
    // Und die Gegenrichtung: eine Hülle um etwas ANDERES bleibt ruhig.
    expect(
      kartenBefunde({ '/src/pages/Fremd.ts': 'const k: Record<X, Readonly<TierMeta>> = {};' }),
    ).toEqual([]);

    // Eine Sammlung von Darstellungen bildet kein Enum auf SEINE Darstellung ab: kein Befund.
    expect(
      kartenBefunde({
        '/src/pages/Sammlung.ts': [
          'const a: Record<Gruppe, Array<StatusDarstellung>> = {};',
          'const b: Record<X, Promise<StatusDarstellung>> = {};',
          'const c: Record<X, Set<StatusDarstellung>> = {};',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('liest keine Zeichenkette als Deklaration', () => {
    // Zeichenketten sind Text, keine Deklaration.
    expect(
      kartenBefunde({
        '/src/pages/Text.ts': "const beispiel = 'Record<X, StatusDarstellung>';",
      }),
    ).toEqual([]);
    // Gegenprobe: dieselbe Zeile ohne Anführungszeichen wird gemeldet.
    expect(
      kartenBefunde({ '/src/pages/Echt2.ts': 'const k: Record<X, StatusDarstellung> = {};' }),
    ).toHaveLength(1);
    // Und eine Zeichenkette VOR einer echten Deklaration darf die nicht verdecken.
    expect(
      kartenBefunde({
        '/src/pages/Beides3.ts':
          "const t = 'Record<X, StatusDarstellung>'; const k: Record<Y, StatusDarstellung> = {};",
      }),
    ).toHaveLength(1);
  });

  it('lässt sich von einem Funktionstyp nicht aus dem Tritt bringen', () => {
    // Das `>` in `=>` darf die Klammerbilanz nicht senken.
    expect(
      kartenBefunde({
        '/src/pages/Pfeil.ts':
          'const k: Record<MeinStatus, StatusDarstellung & { format: (x: X) => string }> = {};',
      }),
    ).toHaveLength(1);
    // Auch als reiner Werttyp, ohne Durchschnitt daneben.
    expect(
      kartenBefunde({
        '/src/pages/Pfeil2.ts': 'const k: Record<Fn<(x: X) => Y>, StatusDarstellung> = {};',
      }),
    ).toHaveLength(1);
  });

  it('setzt Abschälen und Zerlegen zusammen — beide Bausteine, EIN Ausdruck', () => {
    // Die Kombination aus Hülle und Durchschnitt: nach dem Abschälen wird erneut geteilt.
    expect(
      kartenBefunde({
        '/src/pages/Beides.ts':
          'const k: Record<X, Readonly<StatusDarstellung & { icon: ReactNode }>> = {};',
      }),
    ).toHaveLength(1);
    // Gegenrichtung: eine Sammlung unter einer Hülle bleibt ruhig.
    expect(
      kartenBefunde({
        '/src/pages/Beides2.ts': 'const k: Record<X, Readonly<Array<StatusDarstellung>>> = {};',
      }),
    ).toEqual([]);
  });

  it('steigt in eine Klammer-Gruppierung hinab', () => {
    // Klammern sind Gruppierung, kein Typ: `(StatusDarstellung | null)` wird geöffnet.
    expect(
      kartenBefunde({
        '/src/pages/Gruppe.ts':
          'const k: Record<X, (StatusDarstellung | null) & { icon: ReactNode }> = {};',
      }),
    ).toHaveLength(1);
    // Auch einfach geklammert, ohne Durchschnitt daneben.
    expect(
      kartenBefunde({ '/src/pages/Gruppe2.ts': 'const k: Record<X, (StatusDarstellung)> = {};' }),
    ).toHaveLength(1);
    // Gegenprobe: eine Klammer ohne den Vertragstyp bleibt ruhig.
    expect(
      kartenBefunde({
        '/src/pages/Gruppe3.ts': 'const k: Record<X, (TierMeta | null) & { icon: R }> = {};',
      }),
    ).toEqual([]);
    // Ein geklammerter ARRAY-Typ bleibt eine Sammlung: die Klammer umschließt hier nicht den
    // ganzen Ausdruck.
    expect(
      kartenBefunde({ '/src/pages/Gruppe5.ts': 'const k: Record<X, (StatusDarstellung)[]> = {};' }),
    ).toEqual([]);
    // Die Sammlung bleibt draußen, auch geklammert.
    expect(
      kartenBefunde({
        '/src/pages/Gruppe4.ts': 'const k: Record<X, (Array<StatusDarstellung>)> = {};',
      }),
    ).toEqual([]);
  });

  it('erkennt den Vertragstyp auch als Glied eines Durchschnitts', () => {
    // `StatusDarstellung & { icon }` erweitert den Vertragseintrag, also eine Karte.
    expect(
      kartenBefunde({
        '/src/pages/Schnitt.ts':
          'const k: Record<MeinStatus, StatusDarstellung & { icon: ReactNode }> = {};',
      }),
    ).toHaveLength(1);
    // Gegenrichtung: ein Durchschnitt ohne den Vertragstyp bleibt ruhig.
    expect(
      kartenBefunde({ '/src/pages/Fremdschnitt.ts': 'const k: Record<X, Foo & Bar> = {};' }),
    ).toEqual([]);
  });

  it('greift nur am eigenstaendigen `Record` — `CustomRecord<…>` ist ein anderer Name', () => {
    // Die Suche darf nicht mitten in einem fremden Bezeichner beginnen.
    expect(
      kartenBefunde({
        '/src/pages/Eigen.ts': 'const k: CustomRecord<MeinStatus, StatusDarstellung> = {};',
      }),
    ).toEqual([]);
    expect(
      kartenBefunde({
        '/src/pages/Aufruf.ts': 'const k = parseRecord<Input, StatusDarstellung>(roh);',
      }),
    ).toEqual([]);
    // Gegenprobe: ein echtes `Record` in derselben Datei wird weiterhin gefunden.
    expect(
      kartenBefunde({
        '/src/pages/Beide.ts':
          'type A = CustomRecord<X, StatusDarstellung>;\nconst k: Record<Y, StatusDarstellung> = {};',
      }),
    ).toHaveLength(1);
    // Und der Punkt ist KEINE Grenze: ein Namensraum-`Record` ist derselbe Abbildungstyp.
    expect(
      kartenBefunde({ '/src/pages/NsRec.ts': 'const k: sf.Record<X, StatusDarstellung> = {};' }),
    ).toHaveLength(1);
  });

  it('erkennt den Vertragstyp auch qualifiziert — `sf.StatusDarstellung`', () => {
    // Ein Namensraum-Import ist derselbe Typ, nur anders geschrieben.
    expect(
      kartenBefunde({ '/src/pages/Ns.ts': 'const k: Record<X, sf.StatusDarstellung> = {};' }),
    ).toHaveLength(1);
  });

  it('zählt Kommentar-Beispiele nicht mit — auch nicht die aus diesem Dateikopf', () => {
    expect(
      kartenBefunde({
        '/src/pages/Reden.ts':
          '// Record<MeinEnum, StatusDarstellung> wäre hier falsch\nconst a = 1;',
      }),
    ).toEqual([]);
  });

  it('sieht den echten Baum — sonst ist die leere Liste oben eine Attrappe', () => {
    const dateien = lieseQuellen(SRC);
    const traeger = Object.entries(dateien).filter(
      ([p, i]) => ausserhalbDesVertrags(p) && i.includes('StatusDarstellung'),
    );
    // Untere Schranke als Selbsttest des Scans; sie wird nicht bei jedem neuen Konsumenten rot.
    expect(traeger.length).toBeGreaterThanOrEqual(6);
  });
});
