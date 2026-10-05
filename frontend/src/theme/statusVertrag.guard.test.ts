/**
 * Vertrags-Guards des Statusfarb-Vertrags (LFH-358).
 *
 * Guard 1: kein `Record<…, StatusDarstellung>` außerhalb von `theme/statusFarben.ts`. Eine
 * Karte anderswo liefe an `ALLE_MAPS` in `statusFarben.test.ts` vorbei, das die geprüften
 * Karten aus den Exporten des Moduls ableitet.
 *
 * Guard 2: kein `<Tag color={…}>`, das ein Vertrags-Enum einfärbt (Wire-Wert als Literal oder
 * gelesener Vertragsname). Dafür ist `components/StatusTag.tsx` da: antd 6 rechnet für einen
 * Nicht-Preset ein statisches Farbpaar, das den Modus nicht mehr sieht.
 *
 * Guard 3 (LFH-891, Spec `farbrollen-kontrast`): kein `<Tag>` mit dem Preset `blue`, auch nicht
 * in einem Ausdruck. Blau bedient, und antds Preset hält den Textboden nicht (Tag 5,50, Nacht
 * 4,91 an „ad-hoc“); eine Kennzeichnung ohne Status ist ein `Tag` ohne `color` wie
 * `components/DemoMarke.tsx`. Er teilt den Tag-Scan mit Guard 2 ({@link farbigeTags}) und damit
 * die Blindflecken unten.
 *
 * Guards statt ESLint-Regel wie bei `components/dichte.guard.test.ts`. Es gibt bewusst keine
 * Schuldmenge: ein leerer Ausnahmetopf „für später“ sichert nichts zu.
 *
 * ── WAS DIESE GUARDS NICHT SEHEN (Teil des Vertrags) ──
 *
 *   • Eine EINZELNE `StatusDarstellung` statt eines `Record` (`kraefte/statusAchse.ts`,
 *     `OHNE_STATUS`: die Abwesenheit eines Werts, keine Enum-Achse).
 *   • Einen Alias als Werttyp (`type Karte = StatusDarstellung`). Qualifizierte Namen,
 *     Vereinigungsglieder und Hüllen aus {@link FORMERHALTEND} werden erkannt, Aliase nicht.
 *   • Eine unbekannte formerhaltende Hülle (`DeepReadonly<…>`), siehe {@link FORMERHALTEND}.
 *   • Eine gespreizte Prop (`<Tag {...props}>`): {@link farbAusdruck} überspringt jede
 *     Prop-Expression als Ganzes.
 *   • Einen Namensraum-Import von antd (`<antd.Tag color=…>`).
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
 *   • Eine Farbe, die den Tag nicht über `color` erreicht (`style`, Klasse, anderes Element).
 *     Die Matrix-Zellfläche (`flaechenFarbe`) ist so eine legitime {@link Flaechendarstellung}.
 *   • Jede Indirektion über eine Bindung (`const AKTIV = 'aktiv'`, `const f = rollenFarbe(…)`):
 *     der Scanner sieht Zeichen, keine Auswertung.
 *   • Ein Regex-Literal in einer Nachbar-Prop: {@link tagEnde} beendet das Tag dort zu früh
 *     (derselbe Blindfleck wie in `dichte.guard.test.ts`).
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
 *
 * `tagEnde` existiert auch in `dichte.guard.test.ts` und `aktionsabstand.guard.test.ts`.
 * Importieren geht nicht: ein `import` aus einer `*.test.ts` führte deren `describe`-Blöcke
 * ein zweites Mal aus.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as sf from './statusFarben';

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
        // Genau die drei Formen, die im Bestand stehen (StatusTag, Datensicht, MaterialPage).
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

// ─────────────────── Guard 2: `<Tag color=` über einem Vertrags-Enum ────────────

/**
 * Ende des öffnenden JSX-Tags ab `start` (Index des `<`), oder `-1`. Zählt geschweifte
 * Klammern und überspringt Zeichenketten, sonst beendete das `>` einer Pfeilfunktion
 * (`onClick={() => tu()}`) das Tag zu früh.
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
 * Balanciertes Ende eines `{…}`-Ausdrucks ab `auf` (Index der öffnenden Klammer);
 * `tag.length`, wenn er nicht schließt. Überspringt Zeichenketten, damit eine Klammer IM
 * String die Bilanz nicht verschiebt.
 */
function klammerEnde(tag: string, auf: number): number {
  let tiefe = 0;
  let anfuehrung: string | null = null;
  for (let i = auf; i < tag.length; i++) {
    const z = tag[i];
    if (anfuehrung) {
      if (z === '\\') i++;
      else if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') anfuehrung = z;
    else if (z === '{') tiefe++;
    else if (z === '}' && --tiefe === 0) return i + 1;
  }
  return tag.length;
}

/**
 * Der Wert der `color`-Prop eines Tag-Textes, oder `null`, AUF ATTRIBUTEBENE.
 *
 * Das erste `color=` im Tag-Text kann in einer Nachbar-Prop stecken
 * (`<Tag icon={<Icon color="blue" />} color={…}>`): ein inneres Vertrags-`color` ergäbe einen
 * Fehlalarm, ein inneres Preset verdeckte ein verbotenes äußeres. Jede Prop-Expression wird
 * deshalb als Ganzes übersprungen ({@link klammerEnde}); `style={{ color }}` fällt damit
 * ebenfalls heraus, es ist keine `color`-Prop.
 */
export function farbAusdruck(tag: string): string | null {
  let i = 0;
  let anfuehrung: string | null = null;
  while (i < tag.length) {
    const z = tag[i];
    if (anfuehrung) {
      if (z === '\\') i++;
      else if (z === anfuehrung) anfuehrung = null;
      i++;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') {
      anfuehrung = z;
      i++;
      continue;
    }
    if (z === '{') {
      i = klammerEnde(tag, i);
      continue;
    }
    // Ein Attributname beginnt hinter Leerraum — `<Tag` selbst und `bgColor=` fallen
    // damit heraus, `<Tag\ncolor=` (Prettier bricht um) bleibt drin.
    if (/\s/.test(z) && /^color\s*=\s*/.test(tag.slice(i + 1))) {
      const wert = /^color\s*=\s*/.exec(tag.slice(i + 1))!;
      const ab = i + 1 + wert[0].length;
      const erstes = tag[ab];
      if (erstes === '"' || erstes === "'") {
        const schluss = tag.indexOf(erstes, ab + 1);
        return schluss === -1 ? tag.slice(ab) : tag.slice(ab, schluss + 1);
      }
      if (erstes !== '{') return null;
      return tag.slice(ab, klammerEnde(tag, ab));
    }
    i++;
  }
  return null;
}

/**
 * Die Wire-Werte ALLER Vertragskarten, aus dem Modul abgeleitet statt handgepflegt; eine neue
 * Enum-Variante ist damit sofort abgedeckt. Die Gegenprobe („der Topf ist nicht leer“) steht
 * unten. Kein Wert kollidiert mit antds Farbnamen (unten geprüft), nur deshalb taugt ein
 * Stringliteral im `color`-Ausdruck als Signal.
 */
const WIRE_WERTE: ReadonlySet<string> = new Set(
  Object.values(sf).flatMap((wert) =>
    wert && typeof wert === 'object' && !Array.isArray(wert)
      ? Object.entries(wert)
          .filter(([, e]) => !!e && typeof e === 'object')
          .map(([k]) => k)
      : [],
  ),
);

/** Die Karten und Auflöser des Vertrags beim Namen. Wer sie liest und den Wert selbst an
 *  antds `color` gibt, umgeht `StatusTag`. */
const VERTRAGS_NAMEN: readonly string[] = [
  ...Object.keys(sf).filter((k) => k !== 'default'),
  'rollenFarbe',
  'flaechenFarbe',
];

/**
 * Die Vertragsnamen, wie sie IN DIESER DATEI heißen, und NUR die wirklich importierten,
 * inklusive Umbenennung (`import { rollenFarbe as farbe }`, real in `pages/uhs/Grundriss.tsx`).
 *
 * Je Datei statt einer globalen Namensliste: eine lokale `dringlichkeit`-Variable oder die
 * eigene `STATUS_META` über `TierStatus` in `pages/TiereDetailPage.tsx` wären sonst Fehlalarme
 * aus reiner Namensgleichheit. Re-Export-Ketten werden nicht verfolgt (Blindfleck, siehe
 * Dateikopf).
 */
function vertragsNamenIn(inhalt: string): readonly string[] {
  const namen = new Set<string>();
  // Namensraum-Import: erreichbar sind die Vertragsnamen dann NUR über den Alias, deshalb
  // kommen sie als `sf.dringlichkeit` in den Topf. Der nackte Name meldete sonst jede fremde
  // Eigenschaft gleichen Namens.
  const raum = /import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]*statusFarben['"]/.exec(
    inhalt,
  );
  if (raum) {
    for (const name of VERTRAGS_NAMEN) namen.add(`${raum[1]}.${name}`);
  }
  // `[^'"]*statusFarben`, nicht `theme/statusFarben`: ein Geschwistermodul importiert
  // `./statusFarben` ohne Verzeichnis, und die Geschwister liegen im Schnitt von Guard 1.
  const importe = inhalt.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]*statusFarben['"]/g);
  for (const [, liste] of importe) {
    for (const teil of liste.split(',')) {
      const teile = /^\s*(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?\s*$/.exec(
        teil,
      );
      if (teile && VERTRAGS_NAMEN.includes(teile[1])) namen.add(teile[2] ?? teile[1]);
    }
  }
  return [...namen];
}

/**
 * Die INHALTE der Zeichenketten-Literale eines Ausdrucks, Maskierung beachtet (ein `\'`
 * verschöbe sonst alle folgenden Literalgrenzen). Template-Substitutionen werden
 * durchstiegen: in `` `${s.status === 'aktiv' ? 'green' : 'default'}` `` steckt der Wire-Wert
 * IN der Substitution. Der Text außerhalb bleibt ein Literal.
 */
function literalInhalte(text: string, von = 0, bis = text.length): string[] {
  const inhalte: string[] = [];
  for (let i = von; i < bis; i++) {
    const z = text[i];
    if (z !== '"' && z !== "'" && z !== '`') continue;
    let inhalt = '';
    let j = i + 1;
    for (; j < bis; j++) {
      if (text[j] === '\\') {
        inhalt += text[j + 1] ?? '';
        j++;
        continue;
      }
      if (z === '`' && text[j] === '$' && text[j + 1] === '{') {
        const zu = klammerZu(text, j + 1, bis);
        inhalte.push(...literalInhalte(text, j + 2, zu));
        j = zu;
        continue;
      }
      if (text[j] === z) break;
      inhalt += text[j];
    }
    if (j >= bis) break; // unabgeschlossen — der Rest ist kein Literal
    inhalte.push(inhalt);
    i = j;
  }
  return inhalte;
}

/**
 * Die lokalen Namen von antds `Tag` in dieser Datei: `Tag` selbst plus Umbenennungen beim
 * Import (`import { Tag as StatusLabel } from 'antd'`).
 *
 * `Tag` steht IMMER im Topf, auch ohne antd-Import. Ein Textscanner kann
 * `import { Tag } from './ui'` nicht auflösen (Sammelmodul mit antds `Tag` oder eigene
 * Komponente); wo er nicht unterscheiden kann, meldet er lieber sichtbar als still grün zu
 * bleiben. Ein handbemaltes `<Tag color={rollenFarbe(…)}>` verbietet die Regel auch auf einer
 * eigenen Komponente. Nicht erfasst: `<antd.Tag …>` nach Namensraum-Import.
 */
function tagNamenIn(inhalt: string): readonly string[] {
  const namen = new Set(['Tag']);
  for (const [, liste] of inhalt.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]antd['"]/g)) {
    for (const teil of liste.split(',')) {
      const um = /^\s*Tag\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(teil);
      if (um) namen.add(um[1]);
    }
  }
  return [...namen];
}

/**
 * Jedes `<Tag …>` einer (kommentarbereinigten) Datei mit dem Wert seiner `color`-Prop. Guard 2
 * und Guard 3 teilen diesen Scan und damit auch seine Blindflecken (Dateikopf).
 */
function farbigeTags(inhalt: string): { zeile: number; tag: string; farbe: string }[] {
  const treffer: { zeile: number; tag: string; farbe: string }[] = [];
  const zeilen = inhalt.split('\n');
  for (const element of tagNamenIn(inhalt)) {
    const marke = `<${element}`;
    for (let i = inhalt.indexOf(marke); i !== -1; i = inhalt.indexOf(marke, i + marke.length)) {
      // `<Tagline` o. ä. — der Name muss hier enden.
      if (!/[\s/>]/.test(inhalt[i + marke.length] ?? '')) continue;
      // Derselbe Filter wie bei den Karten: ein `<Tag …>` IN einer Zeichenkette ist Text.
      // Gefiltert wird die Position der Marke; die Wire-Werte in den Attributen bleiben lesbar.
      const davor = inhalt.slice(0, i).split('\n');
      if (inZeichenkette(zeilen[davor.length - 1] ?? '', davor[davor.length - 1].length)) {
        continue;
      }
      const ende = tagEnde(inhalt, i);
      if (ende === -1) continue;
      const tag = inhalt.slice(i, ende + 1);
      const farbe = farbAusdruck(tag);
      if (!farbe) continue;
      treffer.push({ zeile: davor.length, tag, farbe });
    }
  }
  return treffer;
}

export function tagBefunde(dateien: Record<string, string>): string[] {
  const verstoesse: string[] = [];
  for (const [pfad, roh] of Object.entries(dateien)) {
    if (!ausserhalbDesVertrags(pfad)) continue;
    const inhalt = ohneKommentare(roh).join('\n');
    const namen = vertragsNamenIn(inhalt);
    for (const { zeile, tag, farbe } of farbigeTags(inhalt)) {
      const grund = grundFuerBefund(farbe, namen);
      if (!grund) continue;
      verstoesse.push(`${pfad}:${zeile}  ${grund}  ${tag.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  return verstoesse;
}

/**
 * Guard 3 (LFH-891): jedes `<Tag>`, dessen `color`-Ausdruck das Preset `blue` als Literal
 * trägt, auch in einem Ausdruck. Gilt im ganzen Baum, die Vertragsdatei eingeschlossen.
 */
export function blauBefunde(dateien: Record<string, string>): string[] {
  const verstoesse: string[] = [];
  for (const [pfad, roh] of Object.entries(dateien)) {
    const inhalt = ohneKommentare(roh).join('\n');
    for (const { zeile, tag, farbe } of farbigeTags(inhalt)) {
      if (!literalInhalte(farbe).includes('blue')) continue;
      verstoesse.push(`${pfad}:${zeile}  ${tag.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  return verstoesse;
}

/** Die Bezeichner eines Ausdrucks. `$` gehört dazu — JavaScript lässt es im Namen zu. */
const BEZEICHNER = /[A-Za-z_$][\w$]*/g;

/**
 * Index der zu `auf` gehörenden schließenden Klammer, oder `bis`. Überspringt Zeichenketten
 * wie {@link klammerEnde}.
 */
function klammerZu(text: string, auf: number, bis: number): number {
  let tiefe = 0;
  let anfuehrung: string | null = null;
  for (let i = auf; i < bis; i++) {
    const z = text[i];
    if (anfuehrung) {
      if (z === '\\') i++;
      else if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') anfuehrung = z;
    else if (z === '{') tiefe++;
    else if (z === '}' && --tiefe === 0) return i;
  }
  return bis;
}

/** Markiert die Zeichenketten in `[von, bis)` als unfrei. Rekursiv, weil eine
 *  Template-Substitution wieder Code enthält — und darin wieder Zeichenketten. */
function markiereZeichenketten(text: string, von: number, bis: number, frei: boolean[]): void {
  let anfuehrung: string | null = null;
  for (let i = von; i < bis; i++) {
    const z = text[i];
    if (!anfuehrung) {
      if (z === '"' || z === "'" || z === '`') {
        anfuehrung = z;
        frei[i] = false;
      }
      continue;
    }
    frei[i] = false;
    if (z === '\\') {
      if (i + 1 < bis) frei[i + 1] = false;
      i++;
      continue;
    }
    if (anfuehrung === '`' && z === '$' && text[i + 1] === '{') {
      frei[i + 1] = false;
      const zu = klammerZu(text, i + 1, bis);
      markiereZeichenketten(text, i + 2, zu, frei);
      frei[zu] = false;
      i = zu;
      continue;
    }
    if (z === anfuehrung) anfuehrung = null;
  }
}

/**
 * Für jede Stelle: steht sie außerhalb einer Zeichenkette?
 *
 * Der Namensvergleich darf Zeichenketten nicht sehen (`mode === 'dringlichkeit'` liest den
 * Vertrag nicht), der Wire-Wert-Test braucht sie dagegen. Die beiden Hälften von
 * {@link grundFuerBefund} sehen den Ausdruck deshalb bewusst verschieden. Rekursiv, weil eine
 * Template-Substitution wieder Code ist und darin wieder Zeichenketten stehen können.
 */
function freieStellen(text: string): boolean[] {
  const frei = new Array<boolean>(text.length).fill(true);
  markiereZeichenketten(text, 0, text.length, frei);
  return frei;
}

/**
 * Die innerste zum Zeitpunkt `stelle` offene Klammer (`{`, `(`, `[`) oder `null`.
 * Zeichenketten werden übersprungen; `frei` sagt, welche Stellen Code sind.
 */
function offeneKlammer(ausdruck: string, stelle: number, frei: boolean[]): string | null {
  const stapel: string[] = [];
  for (let i = 0; i < stelle; i++) {
    if (!frei[i]) continue;
    const z = ausdruck[i];
    // Die äußerste `{` ist der JSX-Ausdruckscontainer der `color`-Prop (`farbAusdruck` liefert
    // die Klammern mit), kein Objekt-Literal. Sonst sähe `{farbe(…)}` wie eine
    // Methoden-Kurzform aus.
    if (z === '{') stapel.push(i === 0 ? 'jsx' : '{');
    else if (z === '(' || z === '[') stapel.push(z);
    else if (z === '}' || z === ')' || z === ']') stapel.pop();
  }
  return stapel[stapel.length - 1] ?? null;
}

/**
 * Die Zugriffe eines Ausdrucks, getrennt nach WURZEL und QUALIFIZIERT.
 *
 * Ein direkt importierter Name wird gelesen, wenn er als Wurzel auftaucht; als Eigenschaft
 * eines fremden Objekts ist er ein anderer Wert. Bei einem Namensraum-Import trägt erst der
 * Alias davor die Aussage. Optionales Verketten (`sf?.x`) zählt als derselbe Zugriff.
 */
function zugriffe(ausdruck: string): { wurzeln: Set<string>; qualifiziert: Set<string> } {
  const wurzeln = new Set<string>();
  const qualifiziert = new Set<string>();
  const frei = freieStellen(ausdruck);
  const treffer = [...ausdruck.matchAll(BEZEICHNER)].filter((m) => frei[m.index ?? 0]);
  // Ob der Bezeichner an Position i selbst eine Wurzel ist, um `theme.sf.x` von `sf.x` zu
  // unterscheiden.
  const istWurzel: boolean[] = [];
  for (let i = 0; i < treffer.length; i++) {
    const stelle = treffer[i].index ?? 0;
    if (!ausdruck.slice(0, stelle).trimEnd().endsWith('.')) {
      // Ein Objekt-SCHLÜSSEL (`{ dringlichkeit: x }`) nennt den Namen, liest die Bindung aber nicht;
      // die Kurzform `{ dringlichkeit }` liest sie. „Folgt ein `:`“ allein reicht nicht, weil
      // `x ? dringlichkeit : y` ein echter Zugriff ist: ein Schlüssel steht hinter `{` oder `,`.
      const davor = ausdruck.slice(0, stelle).trimEnd();
      const danach = ausdruck.slice(stelle + treffer[i][0].length).trimStart();
      // Die Methoden-Kurzform (`{ dringlichkeit() {…} }`, auch mit `get`/`set`/`async`) ist ein
      // Schlüssel, `waehle(a, dringlichkeit())` aber ein Aufruf. Unterschieden wird an der
      // innersten offenen Klammer; ein berechneter Schlüssel (`[dringlichkeit]`) liest die Bindung.
      const imObjekt = offeneKlammer(ausdruck, stelle, frei) === '{';
      const nachModifikator = /(?:^|[{,])\s*(?:get|set|async)$/.test(davor);
      const istSchluessel =
        imObjekt &&
        (danach.startsWith(':') || danach.startsWith('(')) &&
        (davor.endsWith('{') || davor.endsWith(',') || nachModifikator);
      if (istSchluessel) {
        istWurzel[i] = false;
        continue;
      }
      istWurzel[i] = true;
      wurzeln.add(treffer[i][0]);
      continue;
    }
    istWurzel[i] = false;
    const vorher = treffer[i - 1];
    // Nur ein Paar, dessen linke Seite die WURZEL der Kette ist: in `theme.sf.dringlichkeit`
    // ist `sf` eine fremde Eigenschaft, kein Import.
    if (!vorher || !istWurzel[i - 1]) continue;
    const dazwischen = ausdruck.slice((vorher.index ?? 0) + vorher[0].length, stelle);
    if (/^\s*\??\.\s*$/.test(dazwischen)) {
      qualifiziert.add(`${vorher[0]}.${treffer[i][0]}`);
    }
  }
  return { wurzeln, qualifiziert };
}

/**
 * Warum dieser `color`-Ausdruck ein Befund ist, oder `null`. Der Grund steht in der Meldung,
 * weil die zwei Fälle verschiedene Abhilfen haben.
 *
 * Verglichen wird Bezeichner gegen Bezeichner, nicht per Regex aus dem Namen: ein Alias darf
 * ein `$` tragen (`farbe$`), und auch escaped verlangte das nachgestellte `\b` eine Wortgrenze
 * hinter dem `$`, die in `farbe$(` fehlt.
 */
function grundFuerBefund(farbe: string, namen: readonly string[]): string | null {
  const { wurzeln, qualifiziert } = zugriffe(farbe);
  for (const name of namen) {
    const trifft = name.includes('.') ? qualifiziert.has(name) : wurzeln.has(name);
    if (trifft) return `liest \`${name}\``;
  }
  // `[, , wert]`: Gruppe 1 ist das Anführungszeichen, Gruppe 2 der Inhalt.
  for (const wert of literalInhalte(farbe)) {
    if (WIRE_WERTE.has(wert)) return `vergleicht Wire-Wert \`${wert}\``;
  }
  return null;
}

describe('Statusfarb-Vertrag: kein `<Tag color=` über einem Vertrags-Enum (LFH-358)', () => {
  it('findet keine handgemalte Farbe über einem Vertrags-Enum', () => {
    const verstoesse = tagBefunde(lieseQuellen(SRC));
    expect(
      verstoesse,
      'Ein Vertrags-Enum wird mit `components/StatusTag.tsx` dargestellt, nicht mit ' +
        'antds `color`-Prop: die trägt die Farbe als FLÄCHE (A2: „Statusfarbe nur als ' +
        'Punkt/Rand/Beistrich") und rechnet für einen Nicht-Preset ein statisches ' +
        `Farbpaar, das den Nachtmodus nicht mitbekommt:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it('wird rot bei beiden Bauformen — Wire-Wert-Vergleich und gelesene Vertragskarte', () => {
    const wire = tagBefunde({
      '/src/pages/Attrappe.tsx':
        "<Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>",
    });
    expect(wire).toHaveLength(1);
    expect(wire[0]).toContain('vergleicht Wire-Wert `aktiv`');

    const gelesen = tagBefunde({
      '/src/pages/Attrappe2.tsx': [
        "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
        '<Tag color={rollenFarbe(warnstufeKarte[g.stufe].rolle, token)}>',
      ].join('\n'),
    });
    expect(gelesen).toHaveLength(1);
    // Welchen Namen die Meldung nennt, hängt an der Exportreihenfolge des Moduls; geprüft wird,
    // DASS der Grund benannt ist.
    expect(gelesen[0]).toMatch(/liest `(rollenFarbe|warnstufeKarte)`/);
  });

  it('sieht die Prop auch hinter einer Pfeilfunktion im selben Tag', () => {
    // Ohne `tagEnde` endete der Tag-Text am `>` von `=>`.
    expect(
      tagBefunde({
        '/src/pages/Attrappe3.tsx':
          "<Tag onClick={() => tu(x)} color={s === 'abgeschlossen' ? 'default' : 'green'}>",
      }),
    ).toHaveLength(1);
  });

  it('liest die `color`-Prop des Tags, nicht die eines Elements in einer Nachbar-Prop', () => {
    // (a) Falsch-negativ: ein verschachteltes Preset darf das verbotene äußere `color` nicht
    //     verdecken.
    const verdeckt = tagBefunde({
      '/src/pages/Verschachtelt.tsx': [
        "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
        '<Tag icon={<Icon color="blue" />} color={rollenFarbe(warnstufeKarte[s].rolle, t)}>',
      ].join('\n'),
    });
    expect(verdeckt).toHaveLength(1);

    // (b) Falsch-positiv: ein Vertrags-`color` INNEN gehört nicht dem Tag.
    expect(
      tagBefunde({
        '/src/pages/Innen.tsx': [
          "import { warnstufeKarte } from '../theme/statusFarben';",
          '<Tag icon={<Icon color={warnstufeKarte[s].rolle} />}>{x}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);

    // `style={{ color: … }}` ist keine `color`-Prop — dieselbe Trennung, anderer Anlass.
    expect(farbAusdruck("<Tag style={{ color: 'aktiv' }}>")).toBeNull();
  });

  it('hält ein Kommentarzeichen IN einer Zeichenkette nicht für einen Kommentar', () => {
    // (a) Das `//` einer URL darf die Zeile nicht abschneiden.
    expect(
      tagBefunde({
        '/src/pages/Url.tsx': [
          "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
          '<Tag title="https://example.org" color={rollenFarbe(warnstufeKarte[s].rolle, t)}>',
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // (b) Ein `/*` im Literal darf den Rest der Datei nicht stummschalten.
    expect(
      tagBefunde({
        '/src/pages/Block.tsx': [
          "const muster = '/*';",
          "<Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>",
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // Gegenprobe: ein ECHTER Kommentar mit demselben Wortlaut bleibt unsichtbar.
    expect(
      tagBefunde({
        '/src/pages/Echt.tsx':
          "// <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}> wäre falsch\nconst a = 1;",
      }),
    ).toEqual([]);
  });

  it('löst eine Umbenennung beim Import auf — je Datei, nicht global', () => {
    // Umbenannter Import, real in `pages/uhs/Grundriss.tsx`.
    const umbenannt = tagBefunde({
      '/src/pages/Alias.tsx': [
        "import { rollenFarbe as farbe, warnstufeKarte as wk } from '../theme/statusFarben';",
        '<Tag color={farbe(wk[s].rolle, token)}>{wk[s].label}</Tag>',
      ].join('\n'),
    });
    expect(umbenannt).toHaveLength(1);
    expect(umbenannt[0]).toMatch(/liest `(farbe|wk)`/);

    // Das Geschwistermodul importiert ohne Verzeichnis und liegt im Schnitt von Guard 1.
    expect(
      tagBefunde({
        '/src/theme/nachbar.ts': [
          "import { rollenFarbe as farbe } from './statusFarben';",
          '<Tag color={farbe(rolle, token)}>x</Tag>',
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // Gegenprobe für „je Datei“: `pages/TiereDetailPage.tsx` hat eine EIGENE `STATUS_META` über
    // `TierStatus` und malt damit zu Recht.
    expect(
      tagBefunde({
        '/src/pages/EigenerName.tsx': [
          'const STATUS_META: Record<TierStatus, { label: string; color: string }> = {};',
          '<Tag color={STATUS_META[t.status].color}>{STATUS_META[t.status].label}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('vergleicht Bezeichner, nicht Muster — ein Alias mit `$` ist kein Endanker', () => {
    // Ein `$` im Alias darf keinen Regex-Endanker ergeben.
    const dollar = tagBefunde({
      '/src/pages/Dollar.tsx': [
        "import { rollenFarbe as farbe$ } from '../theme/statusFarben';",
        '<Tag color={farbe$(rolle, token)}>x</Tag>',
      ].join('\n'),
    });
    expect(dollar).toHaveLength(1);
    expect(dollar[0]).toContain('liest `farbe$`');

    // Gegenprobe: der Vergleich gilt dem ganzen Bezeichner, ein Präfix meldet nicht.
    expect(
      tagBefunde({
        '/src/pages/Praefix.tsx': [
          "import { rollenFarbe as farbe } from '../theme/statusFarben';",
          '<Tag color={farbeVonWoanders(x)}>x</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('liest Wire-Werte auch hinter einem maskierten Anfuehrungszeichen', () => {
    // Ein maskiertes `\'` darf die folgenden Literalgrenzen nicht verschieben.
    const maskiert = tagBefunde({
      '/src/pages/Maskiert.tsx':
        "<Tag color={label === 'it\\'s' && s.status === 'aktiv' ? 'green' : 'default'}>{x}</Tag>",
    });
    expect(maskiert).toHaveLength(1);
    expect(maskiert[0]).toContain('vergleicht Wire-Wert `aktiv`');
  });

  it('steigt beim Wire-Scan in eine Template-Substitution hinab', () => {
    // Literale IN einer Template-Substitution werden gelesen.
    const vorlage = tagBefunde({
      '/src/pages/WireVorlage.tsx':
        "<Tag color={`${s.status === 'aktiv' ? 'green' : 'default'}`}>{x}</Tag>",
    });
    expect(vorlage).toHaveLength(1);
    expect(vorlage[0]).toContain('vergleicht Wire-Wert `aktiv`');

    // Gegenprobe: der Text AUSSERHALB der Substitution bleibt ein Literal.
    const drumherum = tagBefunde({
      '/src/pages/WireText.tsx': '<Tag color={`aktiv`}>{x}</Tag>',
    });
    expect(drumherum).toHaveLength(1);
    expect(drumherum[0]).toContain('vergleicht Wire-Wert `aktiv`');
  });

  it('sieht Vertragsnamen NICHT in Zeichenketten — der Wire-Test dagegen schon', () => {
    // „Liest eine Bindung“ darf Literale nicht sehen, „vergleicht einen Wert“ braucht sie.
    expect(
      tagBefunde({
        '/src/pages/Wort.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          "<Tag color={mode === 'dringlichkeit' ? 'blue' : 'default'}>{y}</Tag>",
        ].join('\n'),
      }),
    ).toEqual([]);

    // Gegenprobe 1: derselbe Name als echter Zugriff bleibt ein Befund.
    expect(
      tagBefunde({
        '/src/pages/Echt3.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          '<Tag color={dringlichkeit[s].rolle}>{y}</Tag>',
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // Gegenprobe 2: der Wire-Wert-Test liest weiter aus Literalen.
    const wire = tagBefunde({
      '/src/pages/Wire2.tsx':
        "<Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{x}</Tag>",
    });
    expect(wire).toHaveLength(1);
    expect(wire[0]).toContain('vergleicht Wire-Wert `aktiv`');

    // Gegenprobe 3: eine Template-Substitution ist Code und bleibt sichtbar.
    expect(
      tagBefunde({
        '/src/pages/Vorlage.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          '<Tag color={`${dringlichkeit[s].rolle}`}>{y}</Tag>',
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // Gegenprobe 4: und eine Zeichenkette IN der Substitution ist wieder Text.
    expect(
      tagBefunde({
        '/src/pages/VorlageText.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          "<Tag color={`${x ? 'dringlichkeit' : y}`}>{y}</Tag>",
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('scannt `<Tag>` auch ohne antd-Importzeile — bewusste Über-Annäherung', () => {
    // Bewusst: `Tag` zählt auch ohne antd-Import, siehe {@link tagNamenIn}.
    const ohneImport = tagBefunde({
      '/src/pages/Sammelmodul.tsx': [
        "import { Tag } from '../components/ui';",
        "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
        '<Tag color={rollenFarbe(warnstufeKarte[s].rolle, token)}>x</Tag>',
      ].join('\n'),
    });
    expect(ohneImport).toHaveLength(1);

    // Gegenprobe: die Über-Annäherung greift nur über den Namen `Tag`, nicht über jedes Element
    // mit einer `color`-Prop.
    expect(
      tagBefunde({
        '/src/pages/Anderes.tsx': [
          "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
          '<Marker color={rollenFarbe(warnstufeKarte[s].rolle, token)}>x</Marker>',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('folgt auch einer Umbenennung des Tags selbst', () => {
    // Das bemalte Element kann umbenannt importiert sein.
    const umbenannt = tagBefunde({
      '/src/pages/TagAlias.tsx': [
        "import { Tag as StatusLabel } from 'antd';",
        "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
        '<StatusLabel color={rollenFarbe(warnstufeKarte[s].rolle, token)}>x</StatusLabel>',
      ].join('\n'),
    });
    expect(umbenannt).toHaveLength(1);

    // Gegenprobe: ein gleichnamiges Element OHNE den antd-Import bleibt unsichtbar.
    expect(
      tagBefunde({
        '/src/pages/Fremdes.tsx':
          '<StatusLabel color={rollenFarbe(warnstufeKarte[s].rolle, token)}>x</StatusLabel>',
      }),
    ).toEqual([]);
  });

  it('meldet einen gleichnamigen LOKALEN Wert nicht — Namensgleichheit ist kein Import', () => {
    // Ohne Import von `statusFarben.ts` zählt eine eigene `dringlichkeit` nicht als Vertragsname.
    expect(
      tagBefunde({
        '/src/pages/Eigen.tsx': [
          'const dringlichkeit = eigeneAchse(x);',
          '<Tag color={dringlichkeit}>{x}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);

    // Gegenprobe: MIT Import wird derselbe Ausdruck gemeldet.
    expect(
      tagBefunde({
        '/src/pages/Gelesen.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          '<Tag color={dringlichkeit}>{x}</Tag>',
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // Und der Namensraum-Import bleibt erfasst: `sf.rollenFarbe` ist derselbe Zugriff.
    expect(
      tagBefunde({
        '/src/pages/Raum.tsx': [
          "import * as sf from '../theme/statusFarben';",
          '<Tag color={sf.rollenFarbe(sf.warnstufeKarte[s].rolle, t)}>x</Tag>',
        ].join('\n'),
      }),
    ).toHaveLength(1);
  });

  it('erreicht einen Namensraum nur über seinen Alias — nicht über den nackten Namen', () => {
    // Bei `import * as sf` zählt eine fremde Eigenschaft gleichen Namens nicht.
    expect(
      tagBefunde({
        '/src/pages/Fremdfeld.tsx': [
          "import * as sf from '../theme/statusFarben';",
          'const x = sf.rollenFarbe;',
          '<Tag color={own.dringlichkeit}>{y}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);

    // Gegenprobe: derselbe Name ÜBER den Alias bleibt ein Befund.
    const ueberAlias = tagBefunde({
      '/src/pages/UeberAlias.tsx': [
        "import * as sf from '../theme/statusFarben';",
        '<Tag color={sf.dringlichkeit[s].rolle}>{y}</Tag>',
      ].join('\n'),
    });
    expect(ueberAlias).toHaveLength(1);
    expect(ueberAlias[0]).toContain('liest `sf.dringlichkeit`');

    // Der Alias muss die WURZEL der Kette sein: in `theme.sf.dringlichkeit` ist `sf` fremd.
    expect(
      tagBefunde({
        '/src/pages/Kette.tsx': [
          "import * as sf from '../theme/statusFarben';",
          '<Tag color={theme.sf.dringlichkeit}>{y}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);

    // Ein DIREKT importierter Name zählt als Wurzel, nicht als fremde Eigenschaft.
    expect(
      tagBefunde({
        '/src/pages/AlsFeld.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          '<Tag color={fremd.dringlichkeit}>{y}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('zaehlt einen Objekt-Schluessel nicht als Lesen — die Kurzform dagegen schon', () => {
    // `{ dringlichkeit: eigeneFarbe }` liest die Bindung nicht, die Kurzform
    // `{ dringlichkeit }` schon. Beide als Paar.
    expect(
      tagBefunde({
        '/src/pages/Schluessel.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          '<Tag color={waehle({ dringlichkeit: eigeneFarbe })}>{y}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);

    const kurz = tagBefunde({
      '/src/pages/Kurzform.tsx': [
        "import { dringlichkeit } from '../theme/statusFarben';",
        '<Tag color={waehle({ dringlichkeit })}>{y}</Tag>',
      ].join('\n'),
    });
    expect(kurz).toHaveLength(1);

    // Im Fragezeichen-Ausdruck steht vor dem Doppelpunkt ein echter Zugriff, kein Schlüssel.
    const frage = tagBefunde({
      '/src/pages/Frage.tsx': [
        "import { dringlichkeit } from '../theme/statusFarben';",
        '<Tag color={x ? dringlichkeit : andere}>{y}</Tag>',
      ].join('\n'),
    });
    expect(frage).toHaveLength(1);
  });

  it('kennt auch die Methoden-Kurzform als Schluessel — ohne den Aufruf zu verlieren', () => {
    // Methoden-Kurzform ist ein Schlüssel; unterschieden wird an der innersten offenen Klammer.
    expect(
      tagBefunde({
        '/src/pages/Methode.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          '<Tag color={waehle({ dringlichkeit() { return eigeneFarbe; } })}>{y}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);

    // Auch mit Modifikator davor.
    expect(
      tagBefunde({
        '/src/pages/Getter.tsx': [
          "import { dringlichkeit } from '../theme/statusFarben';",
          '<Tag color={waehle({ get dringlichkeit() { return eigeneFarbe; } })}>{y}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);

    // Gegenprobe: derselbe Text in einer Argumentliste ist ein Aufruf und bleibt ein Befund.
    const aufruf = tagBefunde({
      '/src/pages/Aufruf2.tsx': [
        "import { dringlichkeit } from '../theme/statusFarben';",
        '<Tag color={waehle(a, dringlichkeit())}>{y}</Tag>',
      ].join('\n'),
    });
    expect(aufruf).toHaveLength(1);

    // Und der BERECHNETE Schluessel liest die Bindung sehr wohl.
    const berechnet = tagBefunde({
      '/src/pages/Berechnet.tsx': [
        "import { dringlichkeit } from '../theme/statusFarben';",
        '<Tag color={waehle({ [dringlichkeit]: x })}>{y}</Tag>',
      ].join('\n'),
    });
    expect(berechnet).toHaveLength(1);
  });

  it('haelt ein Apostroph im JSX-Text nicht fuer den Anfang einer Zeichenkette', () => {
    // Das Apostroph in „geht's“ darf sich nicht mit dem Anführungszeichen vor `aktiv` paaren.
    const prosa = tagBefunde({
      '/src/pages/Prosa.tsx':
        "<div>geht's <Tag color={s.status === 'aktiv' ? 'green' : 'default'} /></div>",
    });
    expect(prosa).toHaveLength(1);
    expect(prosa[0]).toContain('vergleicht Wire-Wert `aktiv`');

    // Gegenprobe: eine ECHTE Zeichenkette schirmt weiterhin ab.
    expect(
      tagBefunde({
        '/src/pages/Doku2.tsx':
          "const beispiel = \"<Tag color={s === 'aktiv' ? 'green' : 'default'}>\";",
      }),
    ).toEqual([]);
  });

  it('liest ein `<Tag>` IN einer Zeichenkette nicht als Auszeichnung', () => {
    // Auch für Tags gilt: eine Auszeichnung in einer Zeichenkette ist Text.
    expect(
      tagBefunde({
        '/src/pages/Doku.tsx':
          "const beispiel = \"<Tag color={s === 'aktiv' ? 'green' : 'default'}>\";",
      }),
    ).toEqual([]);

    // Gegenprobe 1: dieselbe Auszeichnung als echtes JSX wird gemeldet.
    expect(
      tagBefunde({
        '/src/pages/Echt3.tsx': "<Tag color={s === 'aktiv' ? 'green' : 'default'}>{s}</Tag>",
      }),
    ).toHaveLength(1);

    // Gegenprobe 2: ein Tag HINTER einer geschlossenen Zeichenkette derselben Zeile ist echt
    // (so im Bestand, `stammdaten/SprechgruppenTab.tsx`).
    expect(
      tagBefunde({
        '/src/pages/Nachbar.tsx':
          "{sg.aktiv ? <Tag color=\"green\">Aktiv</Tag> : <Tag color={s === 'aktiv' ? 'x' : 'y'}>b</Tag>}",
      }),
    ).toHaveLength(1);
  });

  it('lässt die legitimen Nachbarn in Ruhe', () => {
    expect(
      tagBefunde({
        // Presets ohne Enum-Bezug, ein Nicht-Vertrags-Enum, eine Fläche statt eines Etiketts und
        // ein `<StatusTag>`: alle vier Formen stehen so im Bestand.
        '/src/pages/Attrappe4.tsx': [
          '<Tag color="green">in Dienst</Tag>',
          "<Tag color={ba === 'TMO' ? 'blue' : 'orange'}>{ba}</Tag>",
          '<Tag color={STATUS_META[t.status].color}>{STATUS_META[t.status].label}</Tag>',
          '<div style={{ background: flaechenFarbe(stufe, token) }} />',
          '<StatusTag darstellung={warnstufeKarte[g.stufe]} />',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('leitet die Wire-Werte wirklich ab — ein leerer Topf machte den Scan zur Attrappe', () => {
    expect(WIRE_WERTE.size).toBeGreaterThan(40);
    for (const wert of ['aktiv', 'abgeschlossen', 'katastrophal', 'sk1', 'im_einsatz']) {
      expect(WIRE_WERTE.has(wert), `${wert} fehlt im abgeleiteten Topf`).toBe(true);
    }
    expect(VERTRAGS_NAMEN).toContain('einsatzStatus');
    expect(VERTRAGS_NAMEN).toContain('rollenFarbe');
  });

  it('kollidiert mit keinem antd-Farbnamen — sonst wäre jedes Preset ein Fehlalarm', () => {
    // Die Bedingung, unter der ein Stringliteral im `color`-Ausdruck als Signal taugt.
    const presets = [
      'green',
      'blue',
      'red',
      'gold',
      'orange',
      'purple',
      'cyan',
      'geekblue',
      'magenta',
      'lime',
      'volcano',
      'pink',
      'default',
      'processing',
      'success',
      'error',
      'warning',
    ];
    expect(presets.filter((p) => WIRE_WERTE.has(p))).toEqual([]);
  });

  it('sieht den echten Baum — die Tag-Stellen des Bestands (Neuentwurf: 70)', () => {
    const dateien = lieseQuellen(SRC);
    const stellen = Object.entries(dateien)
      .filter(([p]) => ausserhalbDesVertrags(p))
      .flatMap(
        ([, i]) =>
          ohneKommentare(i)
            .join('\n')
            .match(/<Tag(?=[\s/>])/g) ?? [],
      );
    // Selbsttest gegen einen Schnitt, der nichts mehr findet. Die Zahl kann nur fallen, weil
    // Status zunehmend als `StatusChip`/`StatusZelle` erscheint; wer sie unter 50 drückt, misst
    // neu und senkt die Schranke.
    expect(stellen.length).toBeGreaterThanOrEqual(50);
  });
});

describe('Kein Preset `blue` an `Tag` (LFH-891, Spec `farbrollen-kontrast`)', () => {
  it('findet keine blaue Marke im Baum', () => {
    const verstoesse = blauBefunde(lieseQuellen(SRC));
    expect(
      verstoesse,
      'Blau bedient (`frontend/AGENTS.md`, „Farbe und Zeichen“), und antds Preset `blue` hält ' +
        'den Textboden nicht (Tag 5,50, Nacht 4,91). Eine Kennzeichnung ohne Status ist ein ' +
        `\`Tag\` ohne \`color\` wie \`components/DemoMarke.tsx\`:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it('wird rot am Literal und im Ausdruck', () => {
    expect(blauBefunde({ '/src/pages/A.tsx': '<Tag color="blue">ad-hoc</Tag>' })).toHaveLength(1);
    expect(
      blauBefunde({ '/src/pages/B.tsx': "<Tag color={x ? 'blue' : 'default'}>{y}</Tag>" }),
    ).toHaveLength(1);
    expect(
      blauBefunde({
        '/src/pages/C.tsx': [
          "import { Tag as Marke } from 'antd';",
          '<Marke',
          '  color="blue"',
          '>',
        ].join('\n'),
      }),
    ).toHaveLength(1);
    // Auch die Vertragsdatei ist nicht ausgenommen.
    expect(blauBefunde({ '/src/theme/statusFarben.ts': '<Tag color="blue">x</Tag>' })).toHaveLength(
      1,
    );
  });

  it('meldet keine Nachbar-Prop, keinen Kommentar, keine Zeichenkette und kein anderes Preset', () => {
    expect(
      blauBefunde({
        '/src/pages/D.tsx': [
          '<Tag icon={<Icon color="blue" />}>{y}</Tag>',
          '// <Tag color="blue">alt</Tag>',
          'const text = \'<Tag color="blue">\';',
          '<Tag color="geekblue">DMO</Tag>',
          '<Tag>ad-hoc</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);
  });
});
