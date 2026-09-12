/**
 * Vertrags-Guards des Statusfarb-Vertrags (LFH-358).
 *
 * ── WAS HIER AUF DEM SPIEL STEHT ────────────────────────────────────────────────
 *
 * `theme/statusFarben.ts` sagt von sich, er sei „EINE Quelle für welche Bedeutung hat
 * welche Statusfarbe". Zwei Löcher haben das relativiert, beide im Code-Review zu
 * LFH-328 · A2 gefunden:
 *
 * 1. **Eine Karte mit dem Vertragstyp lag außerhalb der Vertragsdatei.** Das ist nicht
 *    bloß unordentlich: `statusFarben.test.ts` leitet die geprüfte Map-Liste BEWUSST aus
 *    den Exporten des Moduls ab, „damit eine zehnte Map nicht still durchrutscht". Eine
 *    Karte ANDERSWO läuft an genau diesem Wächter vorbei — der Präzedenzfall untergräbt
 *    die Aussage, die der Test schützen soll. Gemessen lagen zwei draußen
 *    (`einsatz/einsatzStatus.ts`, `pages/lage-dashboard/lagebild.ts`), beide mit
 *    derselben Begründung: der Abdeckungstest zählt gegen ein `toHaveLength`, ein
 *    Eintrag mehr sei eine Vertragsänderung. Das war richtig — und es ist genau die
 *    Entscheidung, die LFH-358 trifft. Beide sind drin, dieser Guard hält die Tür zu.
 *
 * 2. **Eine Farbkarte über einem Vertrags-Enum blieb unbemerkt, bis ein Mensch sie
 *    fand.** `pages/lagekarte/ZonenInspector.tsx` färbte ein Status-Etikett mit
 *    `warnstufeFarbe()`; Gate 5 (`theme/gate5.guard.test.ts`) sieht das nicht, weil kein
 *    A0-Rollenwert im Quelltext steht. Dieser Guard ist die maschinelle Fassung dieser
 *    Grenze, und er hat beim Bau geliefert: ZEHN Seiten malten
 *    `<Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>`
 *    — antd-Farbnamen plus roher Wire-Wert, also derselbe Befund, den LFH-345 · M14 an
 *    `EinsatzdatenPage` einzeln behoben hatte (gemessen am 12.09.2026). Dazu ein elfter
 *    Fall in `pages/gefahren/GefahrenPage.tsx`, der die Rolle zwar aus dem Vertrag las,
 *    den Wert aber an antds `color`-Prop gab — wogegen `components/StatusTag.tsx`
 *    ausdrücklich gebaut ist (antd 6 rechnet für einen Nicht-Preset ein STATISCHES
 *    Farbpaar; der Modus erreicht es nicht mehr).
 *
 * ── WARUM ZWEI GUARDS UND NICHT EINE ESLINT-REGEL ───────────────────────────────
 *
 * Dieselbe Erwägung wie bei `components/dichte.guard.test.ts`: `pnpm lint` läuft mit
 * `--max-warnings 0`, eine Regel mit elf Funden am Liefertag wird abgeschaltet statt
 * befolgt. Hier sind die elf Funde stattdessen behoben, der Guard startet bei null —
 * es gibt deshalb bewusst KEINE Schuldmenge: ein leerer Ausnahmetopf „für später"
 * sichert nichts zu (dieselbe Linie wie beim fehlenden `auditConfig.ignoreGhsas`,
 * CLAUDE.md · Qualitäts-Gates).
 *
 * ── WAS DIESE GUARDS NICHT SEHEN ────────────────────────────────────────────────
 *
 * Teil des Vertrags, nicht Beiwerk — jeder Punkt mit gemessener Fundstelle vom
 * 12.09.2026, keiner hypothetisch:
 *
 *   • **Eine EINZELNE `StatusDarstellung`**, kein `Record`: `kraefte/statusAchse.ts:58`
 *     (`OHNE_STATUS`) trägt „kein Status" als Darstellung. Bewusst draußen, denn es ist
 *     die ABWESENHEIT eines Enum-Werts und damit gerade keine Enum-Achse (die Datei
 *     begründet das über 20 Zeilen). Wer eine ganze Achse als lauter Einzel-Konstanten
 *     danebenbaut, umgeht den Guard — das ist Aufwand, keine Nachlässigkeit.
 *   • **Ein anderer Wert-Typ als `StatusDarstellung` selbst**: `Record<X,
 *     StatusDarstellung | null>` oder `Record<X, StatusDarstellung>[]`. Das Muster
 *     verlangt den Typ als LETZTES Typargument, und das ist kein Versehen — die
 *     naheliegende Lockerung (`Record<[^>]*StatusDarstellung[^>]*>`) macht aus
 *     `components/StatusTag.tsx:6` (`Record<NonNullable<StatusDarstellung['form']>,
 *     string>`) einen Fehlalarm, also aus einem Konsumenten einen Verstoß. Im Bestand
 *     kommt keine der beiden Formen vor.
 *   • **Eine FUNKTION, die eine `StatusDarstellung` baut**: `pages/MaterialPage.tsx:74`,
 *     `pages/FahrzeugePage.tsx:103`, `pages/PersonalPage.tsx:79`. Alle drei liegen auf
 *     der DB-Achse (`status_farbe`, mandantengepflegter Freitext), die der Kopf von
 *     `statusFarben.ts` namentlich AUSSERHALB des Vertrags führt. Ein Verbot träfe hier
 *     die dokumentierte Grenze statt eines Verstoßes.
 *   • **Eine Farbe, die den Tag nicht über `color` erreicht**: `style={{ background }}`,
 *     eine Klasse, ein anderes Element als `<Tag>`. Die Matrix-Zellhinterlegung
 *     (`pages/gefahren/GefahrenMatrix.tsx`, `flaechenFarbe`) ist genau das und darf
 *     bleiben — sie ist die dritte DARSTELLUNGSSORTE (Fläche statt Etikett), im Vertrag
 *     als {@link Flaechendarstellung} benannt. Sie wird hier nicht als Ausnahme
 *     GELISTET, sondern vom Schnitt gar nicht erst erfasst: eine Ausnahmeliste, die den
 *     legitimen Fall nennt, veraltet mit ihm.
 *   • **Ein Wire-Wert aus einer Variablen**: `color={AKTIV === e.status ? …}` mit
 *     `const AKTIV = 'aktiv'` woanders. Im Bestand kommt das an keiner der 132
 *     `<Tag color=`-Stellen vor.
 *   • **Ein Regex-Literal in einer Nachbar-Prop** desselben Tags: {@link tagEnde} kennt
 *     Zeichenketten, aber keine Regex-Literale, und beendet das Tag dort zu früh.
 *     Altlast, wortgleich mit dem Blindfleck von `dichte.guard.test.ts`.
 *
 * ── EINE ZWEITE KOPIE VON `tagEnde`, UND WARUM SIE HIER TROTZDEM STEHT ──────────
 *
 * Gemessen: `components/dichte.guard.test.ts` und `components/aktionsabstand.guard.test.ts`
 * tragen die Funktion bereits je einmal — dies ist die dritte. Sie zu vereinen ist
 * richtig und hier bewusst NICHT getan: beide Bestandsguards hängen mit Schuldmengen und
 * Mutationsproben daran, und ein Scanner-Umbau in einem Vertrags-Ticket wäre ein
 * Nebenprodukt statt einer Entscheidung. Eigener Befund, eigenes Ticket. Importieren
 * ginge ohnehin nicht: ein `import` aus einer `*.test.ts` führte deren `describe`-Blöcke
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

/** Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen. Kopie aus
 *  `components/dichte.guard.test.ts` — ohne sie zählte dieser Dateikopf seine eigenen
 *  Beispiele als Verstoß. Zeilenzahl bleibt erhalten (Index = Zeile − 1). */
function ohneKommentare(inhalt: string): string[] {
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
  return zeilen;
}

/**
 * Der Vertrag selbst, die Tests und der Codegen sind kein Prüfgegenstand — und der
 * Vertrag ist EINE DATEI, nicht das Verzeichnis.
 *
 * Die erste Fassung nahm `/src/theme/` ganz heraus. Das war falsch, und zwar genau im
 * Sinne der Zusicherung (im Codex-Review zu diesem PR gefunden): eine Karte in einem
 * Geschwistermodul wie `theme/darstellungOptionen.ts` wäre von `statusFarben.ts` nicht
 * exportiert, liefe also am selbst ableitenden {@link ALLE_MAPS} des Abdeckungstests
 * genauso vorbei wie eine Karte in `pages/` — und der Guard hätte dazu geschwiegen.
 * „Im selben Ordner" ist kein Ersatz für „im Vertrag". Gemessen am 12.09.2026 trägt
 * kein Geschwistermodul eine solche Karte; der engere Schnitt kostet also nichts und
 * schließt die Lücke, bevor sie jemand füllt.
 */
function ausserhalbDesVertrags(pfad: string): boolean {
  if (pfad === '/src/theme/statusFarben.ts') return false;
  if (/\.test\.[jt]sx?$/.test(pfad) || /\.generated\.[jt]sx?$/.test(pfad)) return false;
  return true;
}

// ──────────────────── Guard 1: Karten neben der Vertragsdatei ──────────────────

/**
 * Ein `Record<…, StatusDarstellung>` — und NUR mit `StatusDarstellung` als WERT-Typ.
 *
 * `[^>]*` überquert kein `>`, damit trifft das Muster `Record<Dringlichkeit,
 * StatusDarstellung>` (auch über mehrere Zeilen, `[^>]` schließt `\n` ein) und lässt
 * `Record<NonNullable<StatusDarstellung['form']>, string>` in Ruhe — die Schlüssel-Rolle
 * ist Konsum, keine Definition. Genau diese Form steht in `components/StatusTag.tsx:6`
 * und wäre der erste Fehlalarm gewesen.
 */
const KARTE = /Record<[^>]*,\s*StatusDarstellung\s*>/;

export function kartenBefunde(dateien: Record<string, string>): string[] {
  const verstoesse: string[] = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    if (!ausserhalbDesVertrags(pfad)) continue;
    if (!inhalt.includes('StatusDarstellung')) continue;
    const sichtbar = ohneKommentare(inhalt).join('\n');
    let rest = sichtbar;
    let versatz = 0;
    for (;;) {
      const treffer = KARTE.exec(rest);
      if (!treffer) break;
      const absolut = versatz + treffer.index;
      const zeile = sichtbar.slice(0, absolut).split('\n').length;
      verstoesse.push(`${pfad}:${zeile}  ${treffer[0].replace(/\s+/g, ' ')}`);
      versatz = absolut + treffer[0].length;
      rest = sichtbar.slice(versatz);
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

  // DIE MUTATIONSPROBE, festgeschrieben statt einmal von Hand gefahren: ohne sie wäre
  // die leere Liste oben auch dann grün, wenn der Scanner gar nichts fände.
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

    // UND im Vertragsverzeichnis selbst: ein Geschwistermodul ist nicht der Vertrag.
    // Es exportiert nichts über `statusFarben.ts`, läuft also am Abdeckungstest genauso
    // vorbei wie eine Karte in `pages/` — mit dem Verzeichnis-Schnitt der ersten Fassung
    // war genau dieser Fall unsichtbar.
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
    // Gemessen am 12.09.2026: NEUN Nicht-Test-Dateien neben dem Vertrag nennen den Typ —
    // vier Primitive (`StatusTag`, `StatusWahl`, `Datensicht`, `EinstiegSwitcher`), die drei
    // DB-Achsen-Funktionen, `kraefte/statusAchse.ts` und `lage-dashboard/lagebild.ts`. Die
    // untere Schranke hält den Scan ehrlich, ohne bei jedem neuen Konsumenten rot zu werden.
    expect(traeger.length).toBeGreaterThanOrEqual(6);
  });
});

// ─────────────────── Guard 2: `<Tag color=` über einem Vertrags-Enum ────────────

/**
 * Ende des öffnenden JSX-Tags ab `start` (Index des `<`), oder `-1`. Zählt geschweifte
 * Klammern und überspringt Zeichenketten — sonst beendete das `>` einer Pfeilfunktion
 * (`onClick={() => tu()}`) das Tag zu früh, und die `color`-Prop dahinter bliebe
 * unsichtbar. Siehe Dateikopf, Abschnitt „zweite Kopie".
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
 * Der Wert der `color`-Prop eines Tag-Textes, oder `null`.
 *
 * Nur auf ATTRIBUT-Ebene: `style={{ color: farbe }}` ist keine `color`-Prop, und ein
 * verschachteltes Element in einer Nachbar-Prop soll nicht mitzählen. Deshalb wird die
 * geschweifte Klammer balanciert gegriffen (Zeichenketten übersprungen, damit ein `}`
 * IM String die Bilanz nicht verschiebt — der Fehler, der in LFH-364 gemessen wurde).
 */
export function farbAusdruck(tag: string): string | null {
  const treffer = /(?:^|[\s{])color\s*=\s*/.exec(tag);
  if (!treffer) return null;
  const ab = treffer.index + treffer[0].length;
  const erstes = tag[ab];
  if (erstes === '"' || erstes === "'") {
    const zu = tag.indexOf(erstes, ab + 1);
    return zu === -1 ? tag.slice(ab) : tag.slice(ab, zu + 1);
  }
  if (erstes !== '{') return null;
  let tiefe = 0;
  let anfuehrung: string | null = null;
  for (let i = ab; i < tag.length; i++) {
    const z = tag[i];
    if (anfuehrung) {
      if (z === '\\') i++;
      else if (z === anfuehrung) anfuehrung = null;
      continue;
    }
    if (z === '"' || z === "'" || z === '`') anfuehrung = z;
    else if (z === '{') tiefe++;
    else if (z === '}' && --tiefe === 0) return tag.slice(ab, i + 1);
  }
  return tag.slice(ab);
}

/**
 * Die Wire-Werte ALLER Vertragskarten, aus dem Modul abgeleitet statt handgepflegt.
 *
 * Selbst ableitend wie {@link ALLE_MAPS} in `statusFarben.test.ts`: eine neue
 * Enum-Variante ist damit sofort mit abgedeckt. Die Gegenprobe („der Topf ist nicht
 * leer") steht als eigene Zusicherung unten — ohne sie wäre ein kaputter Ableitungsweg
 * von einem sauberen Bestand nicht zu unterscheiden.
 *
 * KEINE Kollision mit antds Farbnamen, und das ist der Grund, warum ein Stringliteral
 * im `color`-Ausdruck überhaupt als Signal taugt: `green`/`blue`/`gold`/`processing`/
 * `default`/… kommen in keiner Vertragskarte als Schlüssel vor (unten geprüft).
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

/** Die Karten und Auflöser des Vertrags beim Namen. Wer sie liest und den Wert dann
 *  selbst an antds `color` gibt, umgeht `StatusTag` — genau der LFH-446-Fall. */
const VERTRAGS_NAMEN: readonly string[] = [
  ...Object.keys(sf).filter((k) => k !== 'default'),
  'rollenFarbe',
  'flaechenFarbe',
];

const LITERAL = /(['"`])([^'"`]*)\1/g;

export function tagBefunde(dateien: Record<string, string>): string[] {
  const verstoesse: string[] = [];
  for (const [pfad, roh] of Object.entries(dateien)) {
    if (!ausserhalbDesVertrags(pfad)) continue;
    if (!roh.includes('<Tag')) continue;
    const inhalt = ohneKommentare(roh).join('\n');
    for (let i = inhalt.indexOf('<Tag'); i !== -1; i = inhalt.indexOf('<Tag', i + 4)) {
      if (!/[\s/>]/.test(inhalt[i + 4] ?? '')) continue; // `<Tagline` o. ä.
      const ende = tagEnde(inhalt, i);
      if (ende === -1) continue;
      const tag = inhalt.slice(i, ende + 1);
      const farbe = farbAusdruck(tag);
      if (!farbe) continue;
      const grund = grundFuerBefund(farbe);
      if (!grund) continue;
      const zeile = inhalt.slice(0, i).split('\n').length;
      verstoesse.push(`${pfad}:${zeile}  ${grund}  ${tag.replace(/\s+/g, ' ').slice(0, 110)}`);
    }
  }
  return verstoesse;
}

/** Warum dieser `color`-Ausdruck ein Befund ist — oder `null`. Der Grund steht in der
 *  Meldung, weil die zwei Fälle verschiedene Abhilfen haben. */
function grundFuerBefund(farbe: string): string | null {
  for (const name of VERTRAGS_NAMEN) {
    if (new RegExp(`\\b${name}\\b`).test(farbe)) return `liest \`${name}\``;
  }
  // `[, , wert]`, nicht `[, wert]`: Gruppe 1 ist das Anführungszeichen, Gruppe 2 der
  // Inhalt. Die kürzere Schreibweise verglich den Quote gegen den Wire-Topf, fand nie
  // etwas — und der Bestands-Scan war dadurch still halb blind (gemessen: beide
  // Mutationsproben rot, der echte Baum trotzdem grün).
  for (const [, , wert] of farbe.matchAll(LITERAL)) {
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
      '/src/pages/Attrappe2.tsx': '<Tag color={rollenFarbe(warnstufeKarte[g.stufe].rolle, token)}>',
    });
    expect(gelesen).toHaveLength(1);
    // Welchen der beiden Namen die Meldung nennt, hängt an der Exportreihenfolge des
    // Moduls — festzunageln hieße, sie zum Vertrag zu machen. Geprüft wird, DASS der
    // Grund benannt ist.
    expect(gelesen[0]).toMatch(/liest `(rollenFarbe|warnstufeKarte)`/);
  });

  it('sieht die Prop auch hinter einer Pfeilfunktion im selben Tag', () => {
    // Ohne `tagEnde` endete der Tag-Text am `>` von `=>`, und die Prop dahinter wäre
    // unsichtbar. Genau der Blindfleck, an dem `dichte.guard.test.ts` 21 Stellen verlor.
    expect(
      tagBefunde({
        '/src/pages/Attrappe3.tsx':
          "<Tag onClick={() => tu(x)} color={s === 'abgeschlossen' ? 'default' : 'green'}>",
      }),
    ).toHaveLength(1);
  });

  it('lässt die legitimen Nachbarn in Ruhe', () => {
    expect(
      tagBefunde({
        // Presets ohne Enum-Bezug, ein Nicht-Vertrags-Enum, eine Fläche statt eines
        // Etiketts (Matrix-Zellhinterlegung) und ein `<StatusTag>` — alle vier Formen
        // stehen so im Bestand.
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

  it('sieht den echten Baum — die 132 Tag-Stellen des Bestands', () => {
    const dateien = lieseQuellen(SRC);
    const stellen = Object.entries(dateien)
      .filter(([p]) => ausserhalbDesVertrags(p))
      .flatMap(
        ([, i]) =>
          ohneKommentare(i)
            .join('\n')
            .match(/<Tag(?=[\s/>])/g) ?? [],
      );
    // Gemessen am 12.09.2026: 132 `<Tag`-Stellen neben dem Vertrag und außerhalb der Tests
    // (Kommentarinhalt abgezogen, roh sind es 134). Die untere Schranke ist der Selbsttest
    // gegen einen Schnitt, der nichts mehr findet und deshalb trivial grün wäre.
    expect(stellen.length).toBeGreaterThanOrEqual(100);
  });
});
