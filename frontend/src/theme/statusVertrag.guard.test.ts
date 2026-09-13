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
 *   • **Ein Alias als Wert-Typ**: `type Karte = StatusDarstellung` und dann
 *     `Record<X, Karte>`. Der Parser vergleicht den letzten Typparameter dem NAMEN nach —
 *     seine Vereinigungsglieder einzeln (`| null` fällt auf), den letzten Punkt-Abschnitt
 *     (`sf.StatusDarstellung` fällt auf) und den Kern unter durchsichtigen Hüllen
 *     (`Readonly<StatusDarstellung>` fällt auf). Aliase löst er nicht auf; das wäre ein
 *     Typchecker, kein Guard. Im Bestand gibt es keinen solchen Alias.
 *   • **Eine unbekannte formerhaltende Hülle** um den Werttyp (`DeepReadonly<…>` o. ä.).
 *     {@link FORMERHALTEND} ist eine Liste, kein Kriterium — bewusst, siehe die Begründung
 *     dort: alles abzuschälen meldet `Record<Gruppe, Array<StatusDarstellung>>` und wäre
 *     ein Fehlalarm. Im Bestand kommt keine Hülle ausserhalb der Liste vor.
 *   • **Eine gespreizte Prop**: `<Tag {...{ color: rollenFarbe(rolle, token) }}>` oder
 *     `<Tag {...props}>`. {@link farbAusdruck} überspringt jede Prop-Expression als
 *     Ganzes — das ist genau der Schritt, der das verschachtelte `color` einer
 *     Nachbar-Prop draussen hält, und beides ist dieselbe Klammer. Der Nachbar-Guard
 *     `components/dichte.guard.test.ts:39` führt den Spread aus demselben Grund als
 *     Blindfleck. Im Bestand trägt kein `<Tag` eine gespreizte Prop (gemessen).
 *   • **Ein Namensraum-Import von antd** (`import * as antd from 'antd'`, dann
 *     `<antd.Tag color=…>`). {@link tagNamenIn} löst die Umbenennung beim benannten
 *     Import auf, nicht die Qualifizierung im JSX-Namen. Im Bestand kommt weder das eine
 *     noch das andere vor (gemessen).
 *   • **Ein Vertragsname, der über EINE ZWEITE Datei umbenannt weitergereicht wird**:
 *     `personen/personMeta.ts:31` exportiert `personStatus as STATUS_META` weiter.
 *     {@link vertragsNamenIn} löst die Umbenennung beim DIREKTEN Import auf, folgt aber
 *     keiner Re-Export-Kette. Gemessen am 12.09.2026 geht kein Konsument dieser
 *     Re-Exporte über `<Tag color=` — alle nutzen `StatusTag` oder nur `.label`.
 *   • **Ein mehrzeiliges Template-Literal mit einem Kommentarzeichen darin.** Der
 *     Kommentar-Stripper erkennt eine Zeichenkette nur, wenn sie auf ihrer Zeile schließt —
 *     die Beschränkung verhindert, dass ein Apostroph in JSX-Text den halben Rest
 *     verschluckt (siehe {@link stringEnde}). Im Bestand ohne Fundstelle.
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
 *   • **JEDE Indirektion über eine Bindung** — in beiden Fühlern dieselbe Grenze:
 *     `const AKTIV = 'aktiv'` und dann `color={AKTIV === e.status ? …}` (Wire-Wert), oder
 *     `const farbwert = rollenFarbe(…)` und dann `color={farbwert}` (Vertragsname). Der
 *     Ausdruck nennt dann weder das eine noch das andere, und was hier steht, ist wahr:
 *     der Scanner sieht Zeichen, keine Auswertung. Das ist keine Lücke IM Scanner,
 *     sondern die Fähigkeit, die er nicht hat — sie käme mit dem Syntaxbaum, nicht mit
 *     einem weiteren Sonderfall. Im Bestand kommt beides an keiner der 132
 *     `<Tag color=`-Stellen vor (gemessen: kein `color={<bezeichner>}` ausserhalb der
 *     Tests).
 *   • **Ein Regex-Literal in einer Nachbar-Prop** desselben Tags: {@link tagEnde} kennt
 *     Zeichenketten, aber keine Regex-Literale, und beendet das Tag dort zu früh.
 *     Altlast, wortgleich mit dem Blindfleck von `dichte.guard.test.ts`.
 *
 * ── ZWEI RICHTUNGEN, IN DENEN DIESE GUARDS ZU VIEL MELDEN KÖNNEN ───────────────
 *
 * (1) EIN GLEICHNAMIGER TYP. Guard 1 vergleicht den Werttyp dem NAMEN nach. Gäbe es
 * irgendwo einen zweiten, unverwandten Typ `StatusDarstellung`, würde eine Karte darüber
 * gemeldet. Der naheliegende Gegenvorschlag — den Typ nur zählen, wenn die Datei ihn
 * nachweislich importiert, wie {@link vertragsNamenIn} es für die WERTE tut — ist hier
 * bewusst NICHT umgesetzt, und der Unterschied ist gemessen, nicht geahnt:
 *
 *   • Der Bestand kennt **eine** Deklaration dieses Namens (`statusFarben.ts:94`). Ein
 *     zweiter Typ gleichen Namens wäre in diesem Repo selbst ein Befund, kein Normalfall.
 *   • Bei den WERTEN war die Namensgleichheit real und belegt (`STATUS_META` liegt einmal
 *     im Vertrag und einmal als eigene Tier-Karte, `dringlichkeit`/`sichtung` sind
 *     gewöhnliche Fachwörter). Bei einem erfundenen Typnamen ist sie es nicht.
 *   • Vor allem: der Import-Nachweis ist bei einem TYP löchriger als bei einem Wert. Der
 *     Bestand schreibt ihn schon in zwei Formen (`import type { StatusDarstellung }` und
 *     `import { …, type StatusDarstellung }`), dazu kämen Re-Export-Ketten. Jede Form, die
 *     der Nachweis verfehlt, wird zum FALSCH-NEGATIV — und zwar an der Hauptzusicherung
 *     dieses Guards. Bei den Werten trägt daneben noch der Wire-Wert-Fühler; hier gäbe es
 *     nichts, was den Ausfall auffängt.
 *
 * Ein Fehlalarm nennt Datei, Zeile und Ausdruck und ist in Minuten geklärt; ein
 * verpasster Vertragsbruch bleibt unsichtbar. Taucht je ein echtes Homonym auf, ist das
 * der Anlass, hier neu zu entscheiden — dann aber mit dem Syntaxbaum, nicht mit einem
 * zweiten Import-Regex.
 *
 * (2) EIN WIRE-WERT, DEN EINE NICHT-VERTRAGS-ACHSE TEILT.
 *
 * Der Wire-Wert-Fühler ist eine HEURISTIK über Zeichenketten, kein Typurteil. Gemessen
 * am 12.09.2026: `TierStatus` ist `'aktiv' | 'vermisst' | 'abgeschlossen'` und teilt damit
 * ALLE DREI Werte mit Vertragskarten (`einsatzStatus`, `personStatus`) — obwohl der Kopf
 * von `statusFarben.ts` die Tier-Achse ausdrücklich draussen führt. Ein
 * `<Tag color={t.status === 'aktiv' ? 'green' : 'default'}>` über einem TIER würde hier
 * also als Einsatz-Status gemeldet, und das wäre ein Fehlalarm (im Codex-Review benannt).
 *
 * Er tritt heute nicht auf, und zwar nicht zufällig: `pages/TierePage.tsx` und
 * `pages/TiereDetailPage.tsx` färben über eine eigene `STATUS_META`-Karte statt über ein
 * Literal — das ist die Bauform, die das Repo auch für Achsen ausserhalb des Vertrags
 * fährt. Wer sie durch einen Inline-Vergleich ersetzt, bekommt diesen Guard rot; die
 * Abhilfe ist dann die Karte, nicht eine Ausnahme hier.
 *
 * Sauber trennen liesse sich das nur über den TYP des Ausdrucks, also über den
 * TypeScript-Syntaxbaum. Das ist die benannte Grenze dieses Guards und der Grund, warum
 * die Umstellung als eigener Befund geführt wird (siehe nächster Abschnitt) — nicht als
 * Nebenprodukt. Den Fühler dafür aufzugeben ist keine Option: er hat die ZEHN
 * Bestandsfunde geliefert, die dieses Ticket überhaupt sichtbar gemacht haben.
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

/**
 * Schließendes Anführungszeichen zu `auf` — aber NUR auf derselben Zeile; sonst `-1`.
 *
 * Die Beschränkung ist der ganze Trick (Codex-Review zu diesem PR). Ein Stripper, der
 * Zeichenketten gar nicht kennt, hält das `//` in `title="https://…"` für einen Kommentar
 * und schneidet den Rest der Zeile ab — das verbotene `color` dahinter verschwindet. Einer,
 * der jedes Anführungszeichen verfolgt, verschluckt am Apostroph in JSX-TEXT alles bis zum
 * nächsten und reißt damit ein größeres Loch, als er schließt. Beides sind
 * Falsch-Negative, und genau die sieht niemand.
 *
 * Ein Literal, das auf seiner Zeile schließt, ist eine Zeichenkette; ein einzelnes
 * Apostroph in Prosa ist keine. Mehrzeilige Template-Literale bleiben damit
 * unberücksichtigt — dokumentierter Blindfleck, im Bestand ohne Fundstelle.
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
 * bleibt erhalten (Index = Zeile - 1).
 *
 * Anders als die Kopien in `components/dichte.guard.test.ts` und
 * `theme/gate5.guard.test.ts` überspringt dieser Stripper Zeichenketten
 * ({@link stringEnde}). Dort ist der Blindfleck als Falsch-Negativ hingeschrieben und für
 * einen Hex-Scan folgenlos; hier hätte ein `/*`-Literal in einer Zeichenkette den Rest der
 * Datei stummgeschaltet, und ein stummer Guard ist von einem grünen nicht zu unterscheiden.
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
 * WARUM EIN PARSER UND KEINE REGEX, gemessen im Codex-Review zu diesem PR: die erste
 * Fassung war `Record<[^>]*,\s*StatusDarstellung\s*>`, und `[^>]` überquert kein `>` —
 * ein verschachteltes Typargument im SCHLÜSSEL beendete den Ausdruck vorzeitig.
 * `Record<Exclude<MeinStatus, null>, StatusDarstellung>` ist gültiges TypeScript, ist
 * genau die verbotene Karte und lief unsichtbar durch. Die naheliegende Lockerung
 * (`Record<[^>]*StatusDarstellung[^>]*>`) tauscht das Loch gegen einen Fehlalarm: sie
 * meldet `Record<NonNullable<StatusDarstellung['form']>, string>` aus
 * `components/StatusTag.tsx:6`, also einen Konsumenten. Beides vermeidet nur, wer die
 * Typargumente wirklich zerlegt.
 *
 * NEBENEFFEKT, und er schließt einen zuvor DOKUMENTIERTEN Blindfleck: weil der letzte
 * Parameter als Vereinigung gelesen wird, fällt auch `Record<X, StatusDarstellung | null>`
 * auf. Der Kopfkommentar führte ihn bis hierher als bekannte Grenze.
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
      // Der Pfeil eines FUNKTIONSTYPS, kein schliessendes Typargument. Ohne diese
      // Ausnahme senkt `(x: X) => string` die Bilanz, das echte `>` bringt sie nie auf
      // null, `typargumente` gibt `null` zurück — und die Karte liefe unsichtbar durch
      // (im Codex-Review gefunden; `components/dichte.guard.test.ts` führt denselben Fall
      // als Blindfleck, dort ohne Folgen).
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
 * Hüllen, die die FORM des Werts erhalten — `Readonly<StatusDarstellung>` ist derselbe
 * Vertragstyp, nur anders geschrieben.
 *
 * EINE NAMENSLISTE, und das ist eine Korrektur: die erste Fassung schälte JEDE Hülle mit
 * genau einem Typargument ab, mit der Begründung, eine Liste veralte bei der nächsten
 * Hilfstype. Das war die falsche Abwägung (im Codex-Review gefunden). `Array`, `Promise`
 * und `Set` haben ebenfalls ein Typargument und sind gerade NICHT durchsichtig — ein
 * `Record<Gruppe, Array<StatusDarstellung>>` gruppiert Darstellungen, es bildet kein Enum
 * auf seine Darstellung ab, und es zu melden wäre ein Fehlalarm.
 *
 * Die zwei Fehlerrichtungen sind nicht gleich viel wert: eine unvollständige Liste lässt
 * eine neue Hilfstype durch (Falsch-Negativ, dokumentierter Blindfleck), das Abschälen
 * von allem meldet gültigen Code (Fehlalarm). Und ein Gate, das aus dem falschen Grund
 * rot wird, wird abgeschaltet statt befolgt — das wiegt hier schwerer.
 */
const FORMERHALTEND = ['Readonly', 'Required', 'Partial', 'NonNullable'];

/** Schält {@link FORMERHALTEND}e Hüllen ab, mehrfach geschachtelt bis zum blanken Namen. */
function blattTyp(arg: string): string {
  let rest = arg.trim();
  for (;;) {
    const auf = rest.indexOf('<');
    if (auf === -1 || !rest.endsWith('>')) return rest;
    if (!FORMERHALTEND.includes(rest.slice(0, auf).trim())) return rest;
    const args = typargumente(rest, auf);
    if (!args || args.length !== 1) return rest;
    rest = args[0].trim();
  }
}

/**
 * Zerlegt den letzten Typparameter in seine Glieder auf oberster Ebene — Vereinigung `|`
 * UND Durchschnitt `&`.
 *
 * Der Durchschnitt kam im Codex-Review dazu: `Record<X, StatusDarstellung & { icon: … }>`
 * erweitert den Vertragseintrag um Zusatzfelder und ist damit erst recht eine Karte über
 * dem Vertragstyp. Beide Trennzeichen zusammen zu behandeln ist richtig, weil BEIDE den
 * Vertragstyp als Glied führen können und die Frage hier nur lautet „kommt er vor?".
 */
function typglieder(arg: string): string[] {
  const teile: string[] = [];
  let tiefe = 0;
  let letzter = 0;
  for (let i = 0; i < arg.length; i++) {
    const z = arg[i];
    if (z === '>' && arg[i - 1] === '=') continue; // Pfeil eines Funktionstyps, siehe oben
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
 * Trägt dieser Typausdruck den Vertragstyp — als Glied, unter einer Hülle, oder beides?
 *
 * REKURSIV, und das ist eine Korrektur (im Codex-Review gefunden): {@link typglieder} und
 * {@link blattTyp} griffen ineinander verzahnt, aber nur EINE Runde tief. Bei
 * `Readonly<StatusDarstellung & { icon: ReactNode }>` liegt das `&` beim Zerlegen noch
 * verschachtelt, und nach dem Abschälen wurde die Vereinigung nie erneut geteilt — der
 * Vergleich sah die ganze Zeichenkette und fand nichts. Beide Einzelfälle hatten ihre
 * Zusicherung, ihre KOMBINATION hatte keine; das ist die Sorte Lücke, die zwischen zwei
 * richtigen Bausteinen entsteht.
 *
 * Die Rekursion läuft nur, wenn {@link blattTyp} wirklich etwas abgeschält hat — sonst
 * stünde hier eine Endlosschleife statt eines Guards.
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
 * Ein FILTER auf den Fund, keine weitere Umformung der Eingabe — und das ist Absicht:
 * die Kette in diesem Guard (Kommentare strippen → `Record<` finden → Klammern
 * bilanzieren → zerlegen → abschälen) hat in diesem PR schon zweimal an ihren Nahtstellen
 * versagt. Ein Prädikat am Ende komponiert trivial, eine sechste Stufe nicht.
 *
 * Nötig, weil {@link ohneKommentare} Zeichenketten ABSICHTLICH stehen lässt — der
 * Tag-Guard braucht ihren INHALT, dort stecken die Wire-Werte. Für den ANFANG einer
 * Deklaration oder Auszeichnung ist das falsch herum: `const beispiel =
 * 'Record<X, StatusDarstellung>'` und `const beispiel = '<Tag color={…}>'` sind Text,
 * und sie zu melden wäre ein Fehlalarm (beide im Codex-Review gefunden, der zweite als
 * Hinweis darauf, dass ich die Klasse zuerst nur halb geschlossen hatte).
 *
 * BEIDE Guards filtern deshalb die POSITION ihrer Marke, nicht deren Inhalt: `Record<`
 * bzw. `<Tag`. Die Attribute dahinter bleiben lesbar — sonst verlöre der Wire-Wert-Fühler
 * genau das, wofür es ihn gibt.
 *
 * Im Bestand kommt keiner der beiden Fälle vor. Die Fundstellen mit `Record<` bzw. `<Tag`
 * hinter einem Anführungszeichen liegen entweder in KOMMENTAREN (fallen vorher weg) oder
 * HINTER einer auf derselben Zeile geschlossenen Zeichenkette — etwa
 * `stammdaten/SprechgruppenTab.tsx:94`, wo das zweite `<Tag>` dem `"green"` des ersten
 * folgt. Genau deshalb überspringt die Schleife geschlossene Zeichenketten, statt beim
 * ersten Anführungszeichen aufzugeben.
 *
 * Dieselbe Zurückhaltung wie in {@link stringEnde}: nur was auf seiner Zeile schliesst,
 * gilt als Zeichenkette.
 */
function inZeichenkette(zeile: string, spalte: number): boolean {
  for (let i = 0; i < spalte; i++) {
    const z = zeile[i];
    if (z !== '"' && z !== "'" && z !== '`') continue;
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
 * Die Marke braucht eine Wortgrenze DAVOR (im Codex-Review gefunden): ohne sie beginnt
 * die Teilstringsuche mitten in einem fremden Bezeichner, und `CustomRecord<K,
 * StatusDarstellung>` oder ein Aufruf `parseRecord<Input, StatusDarstellung>()` wären
 * gemeldet worden — beides gültiger, unverwandter Code. Heute kommt kein solcher Name im
 * Baum vor (gegengezählt: null Treffer für `[A-Za-z0-9_$]Record<`), der Fall ist also
 * latent; ein Fehlalarm, der erst beim nächsten Helfernamen zuschlägt, ist trotzdem
 * einer — und der Guard, der aus dem falschen Grund rot wird, kostet die Zeit dessen,
 * der ihn debuggt.
 *
 * Ein **Punkt** davor zählt bewusst NICHT als Grenze: `sf.Record<X, StatusDarstellung>`
 * ist derselbe eingebaute Abbildungstyp, nur über einen Namensraum geschrieben — dieselbe
 * Linie wie beim Wert-Typ eine Zeile weiter unten. `CustomRecord` dagegen ist ein ANDERER
 * Bezeichner, kein anders geschriebener gleicher.
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
    // Der letzte Punkt-Abschnitt, damit ein Namensraum-Import (`Record<X,
    // sf.StatusDarstellung>`, gültiges TypeScript) nicht am Vergleich vorbeiläuft —
    // im Codex-Review gefunden. Aliase löst der Guard weiterhin nicht auf, das wäre ein
    // Typchecker; ein QUALIFIZIERTER Name ist aber derselbe Typ, nur anders geschrieben.
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

  it('zerlegt die Typargumente, statt am ersten `>` abzubrechen', () => {
    // Im Codex-Review gefunden: ein verschachteltes Typargument im SCHLÜSSEL beendete
    // die alte Regex vorzeitig. Gültiges TypeScript, genau die verbotene Karte, unsichtbar.
    expect(
      kartenBefunde({
        '/src/pages/Eng.ts': 'const k: Record<Exclude<MeinStatus, null>, StatusDarstellung> = {};',
      }),
    ).toHaveLength(1);

    // Dieselbe Zerlegung schließt den früher DOKUMENTIERTEN Blindfleck mit: der letzte
    // Parameter wird als Vereinigung gelesen.
    expect(
      kartenBefunde({
        '/src/pages/Union.ts': 'const k: Record<X, StatusDarstellung | null> = {};',
      }),
    ).toHaveLength(1);

    // Und die Gegenrichtung bleibt ruhig — sonst hätte der Parser nur das Loch gegen
    // einen Fehlalarm getauscht. `Partial<>` daneben zeigt, dass die Schachtelung nach
    // AUSSEN nicht stört.
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

    // NICHT jede Hülle mit einem Typargument ist durchsichtig: eine Sammlung von
    // Darstellungen bildet kein Enum auf SEINE Darstellung ab. Das zu melden wäre ein
    // Fehlalarm — und ein Gate, das aus dem falschen Grund rot wird, wird abgeschaltet.
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
    // Im Codex-Review gefunden: `ohneKommentare` lässt Zeichenketten ABSICHTLICH stehen,
    // weil der Tag-Guard ihren Inhalt braucht. Für die Karten ist das falsch herum.
    expect(
      kartenBefunde({
        '/src/pages/Text.ts': "const beispiel = 'Record<X, StatusDarstellung>';",
      }),
    ).toEqual([]);
    // Gegenprobe: dieselbe Zeile OHNE Anführungszeichen wird gemeldet — sonst hätte der
    // Filter die Aussage mit weggenommen statt nur den Fehlalarm.
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
    // Das `>` in `=>` senkte die Klammerbilanz, das echte `>` brachte sie nie auf null,
    // `typargumente` gab `null` zurück — die Karte lief unsichtbar durch.
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
    // Im Codex-Review gefunden: beide Einzelfälle hatten ihre Zusicherung, ihre
    // KOMBINATION hatte keine. Beim Zerlegen liegt das `&` noch unter `Readonly<…>`,
    // und nach dem Abschälen wurde nie erneut geteilt.
    expect(
      kartenBefunde({
        '/src/pages/Beides.ts':
          'const k: Record<X, Readonly<StatusDarstellung & { icon: ReactNode }>> = {};',
      }),
    ).toHaveLength(1);
    // Und die Gegenrichtung, damit die Rekursion nicht einfach alles meldet: eine
    // Sammlung unter einer Hülle bleibt ruhig.
    expect(
      kartenBefunde({
        '/src/pages/Beides2.ts': 'const k: Record<X, Readonly<Array<StatusDarstellung>>> = {};',
      }),
    ).toEqual([]);
  });

  it('erkennt den Vertragstyp auch als Glied eines Durchschnitts', () => {
    // `StatusDarstellung & { icon }` erweitert den Vertragseintrag — erst recht eine Karte
    // über dem Vertragstyp. Im Codex-Review gefunden.
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
    // Im Codex-Review gefunden. Die Teilstringsuche begann sonst mitten im fremden
    // Bezeichner; beide Bauformen sind gueltiger, unverwandter Code.
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
    // Die Gegenprobe traegt die Aussage: ein ECHTES `Record` in derselben Datei wird
    // weiterhin gefunden — sonst waere die Wortgrenze von „Guard abgeschaltet" nicht zu
    // unterscheiden.
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
    // Im Codex-Review gefunden: ein Namensraum-Import ist gültiges TypeScript und derselbe
    // Typ, nur anders geschrieben. Der Vergleich gegen den nackten Namen lief daran vorbei.
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
 * Balanciertes Ende eines `{…}`-Ausdrucks ab `auf` (Index der öffnenden Klammer);
 * `tag.length`, wenn er nicht schließt. Überspringt Zeichenketten, damit eine Klammer
 * IM String die Bilanz nicht verschiebt (der in LFH-364 gemessene Fehler).
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
 * Der Wert der `color`-Prop eines Tag-Textes, oder `null` — AUF ATTRIBUTEBENE.
 *
 * „Attributebene" ist hier die ganze Aussage, nicht eine Feinheit (im Codex-Review zu
 * diesem PR gefunden). Die erste Fassung nahm das ERSTE `color=` im Tag-Text, und das
 * kann in einer Nachbar-Prop stecken: `<Tag icon={<Icon color="blue" />} color={…}>`.
 * Beide Richtungen gehen dann schief — ein verschachteltes Vertrags-`color` erzeugte
 * einen Fehlalarm für den Tag, und ein verschachteltes Preset verdeckte ein verbotenes
 * äußeres `color={rollenFarbe(…)}` vollständig, weil nur der erste Treffer angesehen
 * wurde. Ein Guard, der aus dem falschen Grund rot wird, kostet die Zeit dessen, der
 * ihn debuggt; einer, der aus dem falschen Grund grün bleibt, ist schlimmer.
 *
 * Der Durchlauf überspringt deshalb jede Prop-Expression als Ganzes ({@link klammerEnde})
 * und sieht nur, was zwischen den Attributen steht. `style={{ color: farbe }}` fällt
 * damit ebenfalls heraus — richtig so, das ist keine `color`-Prop.
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

/**
 * Die Vertragsnamen, wie SIE IN DIESER DATEI HEISSEN — und NUR die, die sie wirklich
 * importiert, inklusive Umbenennung (`import { rollenFarbe as farbe }`).
 *
 * „Nur die importierten" ist eine Korrektur (im Codex-Review gefunden): die erste Fassung
 * legte jeder Datei ALLE Vertragsnamen in den Topf. Eine Seite mit einer eigenen lokalen
 * `sichtung`- oder `dringlichkeit`-Variablen und `<Tag color={dringlichkeit}>` wäre damit
 * gemeldet worden, obwohl sie `statusFarben.ts` nie importiert — ein Fehlalarm aus reiner
 * Namensgleichheit, dieselbe Falle wie bei `STATUS_META` eine Ebene tiefer. Die
 * Zusicherung verliert dadurch nichts: wer einen Vertragsexport LIEST, muss ihn
 * importieren; der zweistufige Re-Export bleibt der benannte Blindfleck, der er war.
 *
 * Im Codex-Review gefunden, und es ist kein konstruierter Fall: `pages/uhs/Grundriss.tsx`
 * importiert heute `verfuegbarkeit as verfuegbarkeitVertrag`. Ohne Auflösung trägt ein
 * `<Tag color={farbe(wk[s].rolle, token)}>` weder einen bekannten Namen noch ein
 * Wire-Literal und läuft durch.
 *
 * WARUM JE DATEI UND NICHT EINE GLOBALE NAMENSLISTE — gemessen, nicht abgeleitet:
 * `personen/personMeta.ts` reicht `personStatus as STATUS_META` weiter, und
 * `pages/TiereDetailPage.tsx:44` hat eine EIGENE, gleichnamige Konstante über
 * `TierStatus` (kein Vertrags-Enum), die zu Recht `<Tag color={STATUS_META[…].color}>`
 * malt. Eine globale Liste hätte diese Zeile gemeldet — ein Fehlalarm aus reiner
 * Namensgleichheit, und der ist beim Debuggen teurer als die Lücke, die er schliesst.
 *
 * Der zweite Sprung fehlt bewusst: wer `STATUS_META` aus `personMeta` importiert, wird
 * hier nicht aufgelöst. Gemessen am 12.09.2026 geht KEIN Konsument dieser Re-Exporte
 * über `<Tag color=` — alle nutzen `StatusTag` oder nur `.label`.
 */
function vertragsNamenIn(inhalt: string): readonly string[] {
  const namen = new Set<string>();
  // Namensraum-Import: dann sind alle Vertragsnamen als `x.name` erreichbar, und die
  // Wortgrenze im Vergleich unten trifft sie auch qualifiziert.
  if (/import\s+\*\s+as\s+[A-Za-z_$][\w$]*\s+from\s*['"][^'"]*statusFarben['"]/.test(inhalt)) {
    for (const name of VERTRAGS_NAMEN) namen.add(name);
  }
  // `[^'"]*statusFarben`, NICHT `theme/statusFarben`: ein Geschwistermodul schreibt
  // `from './statusFarben'` — ohne Verzeichnis im Pfad. Dass die Geschwister im Schnitt
  // liegen, ist die Zusicherung von Guard 1; sie hier wieder auszuschliessen wäre
  // derselbe Fehler eine Ebene tiefer (im Codex-Review gefunden).
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

const LITERAL = /(['"`])([^'"`]*)\1/g;

/**
 * Die lokalen Namen von antds `Tag` in dieser Datei — `Tag` selbst plus Umbenennungen
 * beim Import (`import { Tag as StatusLabel } from 'antd'`).
 *
 * Dieselbe Auflösung wie {@link vertragsNamenIn}, nur auf der anderen Seite des
 * Ausdrucks: dort der gelesene Vertragsname, hier das bemalte Element. Im Bestand
 * benennt niemand `Tag` um (gemessen am 12.09.2026); die Maschinerie stand aber schon,
 * und sie nur einseitig anzuwenden wäre eine Lücke aus Nachlässigkeit statt aus
 * Entscheidung.
 *
 * `Tag` steht IMMER im Topf, auch ohne passenden Import — sonst hinge die Zusicherung
 * an einer Importzeile, und eine Datei mit `<Tag` ohne Import wäre ohnehin kaputt.
 * Nicht erfasst: ein Namensraum-Import (`import * as antd from 'antd'` mit
 * `<antd.Tag …>`); im Bestand kommt er an keiner Stelle vor.
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

export function tagBefunde(dateien: Record<string, string>): string[] {
  const verstoesse: string[] = [];
  for (const [pfad, roh] of Object.entries(dateien)) {
    if (!ausserhalbDesVertrags(pfad)) continue;
    const inhalt = ohneKommentare(roh).join('\n');
    const namen = vertragsNamenIn(inhalt);
    const zeilen = inhalt.split('\n');
    for (const element of tagNamenIn(inhalt)) {
      const marke = `<${element}`;
      for (let i = inhalt.indexOf(marke); i !== -1; i = inhalt.indexOf(marke, i + marke.length)) {
        // `<Tagline` o. ä. — der Name muss hier enden.
        if (!/[\s/>]/.test(inhalt[i + marke.length] ?? '')) continue;
        // Und derselbe Filter wie bei den Karten: ein `<Tag …>` IN einer Zeichenkette ist
        // Text, keine Auszeichnung. Gefiltert wird die Position der MARKE, nicht ihr
        // Inhalt — die Wire-Werte stecken in den Attributen und müssen lesbar bleiben.
        const davor = inhalt.slice(0, i).split('\n');
        if (inZeichenkette(zeilen[davor.length - 1] ?? '', davor[davor.length - 1].length)) {
          continue;
        }
        const ende = tagEnde(inhalt, i);
        if (ende === -1) continue;
        const tag = inhalt.slice(i, ende + 1);
        const farbe = farbAusdruck(tag);
        if (!farbe) continue;
        const grund = grundFuerBefund(farbe, namen);
        if (!grund) continue;
        const zeile = inhalt.slice(0, i).split('\n').length;
        verstoesse.push(`${pfad}:${zeile}  ${grund}  ${tag.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
  }
  return verstoesse;
}

/** Die Bezeichner eines Ausdrucks. `$` gehört dazu — JavaScript lässt es im Namen zu. */
const BEZEICHNER = /[A-Za-z_$][\w$]*/g;

/**
 * Warum dieser `color`-Ausdruck ein Befund ist — oder `null`. Der Grund steht in der
 * Meldung, weil die zwei Fälle verschiedene Abhilfen haben.
 *
 * Der Namensvergleich zerlegt den Ausdruck in BEZEICHNER, statt aus dem Namen eine
 * Regex zu bauen (im Codex-Review gefunden). Ein Alias darf ein `$` tragen
 * (`import { rollenFarbe as farbe$ }` ist gültiges JavaScript), und interpoliert wird
 * daraus ein Endanker — `<Tag color={farbe$(rolle, token)}>` lief durch, der Guard
 * blieb grün über einer verbotenen Darstellung.
 *
 * **Escapen allein behebt das NICHT, und das ist gemessen** (die naheliegende erste
 * Abhilfe): mit maskiertem `$` verlangt das nachgestellte `\b` eine Wortgrenze hinter
 * dem `$`, und in `farbe$(` stehen dort zwei Nicht-Wortzeichen — der Treffer bleibt
 * aus. Beide Regex-Fassungen liefern `false`, der Token-Vergleich `true`. Ein Name ist
 * ohnehin ein Bezeichner und kein Muster; ihn als Muster zu behandeln war der Fehler,
 * nicht das fehlende Escape.
 */
function grundFuerBefund(farbe: string, namen: readonly string[]): string | null {
  const bezeichner = new Set(farbe.match(BEZEICHNER) ?? []);
  for (const name of namen) {
    if (bezeichner.has(name)) return `liest \`${name}\``;
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
      '/src/pages/Attrappe2.tsx': [
        "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
        '<Tag color={rollenFarbe(warnstufeKarte[g.stufe].rolle, token)}>',
      ].join('\n'),
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

  it('liest die `color`-Prop des Tags, nicht die eines Elements in einer Nachbar-Prop', () => {
    // Im Codex-Review gefunden, und der Fall geht in BEIDE Richtungen schief.
    // (a) Falsch-negativ: ein verschachteltes Preset verdeckte das verbotene äußere
    //     `color` vollständig, weil nur der erste Treffer angesehen wurde.
    const verdeckt = tagBefunde({
      '/src/pages/Verschachtelt.tsx': [
        "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
        '<Tag icon={<Icon color="blue" />} color={rollenFarbe(warnstufeKarte[s].rolle, t)}>',
      ].join('\n'),
    });
    expect(verdeckt).toHaveLength(1);

    // (b) Falsch-positiv: ein Vertrags-`color` INNEN gehört nicht dem Tag. Ein anderes
    //     Element als `<Tag>` ist dokumentierter Blindfleck, kein Befund dieses Guards.
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
    // Im Codex-Review gefunden, beide Male als Falsch-NEGATIV — der gefährlichen Richtung.
    // (a) Das `//` einer URL schnitt die Zeile ab, das verbotene `color` dahinter verschwand.
    expect(
      tagBefunde({
        '/src/pages/Url.tsx': [
          "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
          '<Tag title="https://example.org" color={rollenFarbe(warnstufeKarte[s].rolle, t)}>',
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // (b) Ein `/*` im Literal schaltete den GANZEN Rest der Datei stumm.
    expect(
      tagBefunde({
        '/src/pages/Block.tsx': [
          "const muster = '/*';",
          "<Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag>",
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // Und die Gegenprobe, ohne die der Stripper genauso gut fehlen könnte: ein ECHTER
    // Kommentar mit demselben Wortlaut bleibt unsichtbar.
    expect(
      tagBefunde({
        '/src/pages/Echt.tsx':
          "// <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}> wäre falsch\nconst a = 1;",
      }),
    ).toEqual([]);
  });

  it('löst eine Umbenennung beim Import auf — je Datei, nicht global', () => {
    // Im Codex-Review gefunden, und der Alias ist im Bestand real:
    // `pages/uhs/Grundriss.tsx` importiert `verfuegbarkeit as verfuegbarkeitVertrag`.
    const umbenannt = tagBefunde({
      '/src/pages/Alias.tsx': [
        "import { rollenFarbe as farbe, warnstufeKarte as wk } from '../theme/statusFarben';",
        '<Tag color={farbe(wk[s].rolle, token)}>{wk[s].label}</Tag>',
      ].join('\n'),
    });
    expect(umbenannt).toHaveLength(1);
    expect(umbenannt[0]).toMatch(/liest `(farbe|wk)`/);

    // Und das Geschwistermodul, das ohne Verzeichnis importiert — genau der Schnitt,
    // den Guard 1 abdeckt, also muss die Auflösung ihn auch abdecken.
    expect(
      tagBefunde({
        '/src/theme/nachbar.ts': [
          "import { rollenFarbe as farbe } from './statusFarben';",
          '<Tag color={farbe(rolle, token)}>x</Tag>',
        ].join('\n'),
      }),
    ).toHaveLength(1);

    // DIE GEGENPROBE, und sie ist der Grund für „je Datei": `pages/TiereDetailPage.tsx`
    // hat eine EIGENE `STATUS_META` über `TierStatus` — kein Vertrags-Enum — und malt
    // damit zu Recht. Eine globale Namensliste hätte die Zeile gemeldet, sobald
    // `personen/personMeta.ts` denselben Namen für eine Vertragskarte vergibt.
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
    // Im Codex-Review gefunden. `import { rollenFarbe as farbe$ }` ist gültiges
    // JavaScript; aus dem Namen eine Regex zu bauen machte aus dem `$` einen Endanker,
    // und der Guard blieb grün über einer verbotenen Darstellung.
    const dollar = tagBefunde({
      '/src/pages/Dollar.tsx': [
        "import { rollenFarbe as farbe$ } from '../theme/statusFarben';",
        '<Tag color={farbe$(rolle, token)}>x</Tag>',
      ].join('\n'),
    });
    expect(dollar).toHaveLength(1);
    expect(dollar[0]).toContain('liest `farbe$`');

    // Die Gegenprobe zur Zerlegung: der Vergleich bleibt AM GANZEN Bezeichner. Ein
    // Alias, der bloss Präfix eines fremden Namens ist, darf nicht melden — sonst
    // tauschte der Fix den verschluckten Befund gegen einen Fehlalarm.
    expect(
      tagBefunde({
        '/src/pages/Praefix.tsx': [
          "import { rollenFarbe as farbe } from '../theme/statusFarben';",
          '<Tag color={farbeVonWoanders(x)}>x</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);
  });

  it('folgt auch einer Umbenennung des Tags selbst', () => {
    // Die andere Seite des Ausdrucks: nicht der gelesene Vertragsname, sondern das
    // bemalte Element. Im Codex-Review gefunden; im Bestand benennt niemand `Tag` um.
    const umbenannt = tagBefunde({
      '/src/pages/TagAlias.tsx': [
        "import { Tag as StatusLabel } from 'antd';",
        "import { rollenFarbe, warnstufeKarte } from '../theme/statusFarben';",
        '<StatusLabel color={rollenFarbe(warnstufeKarte[s].rolle, token)}>x</StatusLabel>',
      ].join('\n'),
    });
    expect(umbenannt).toHaveLength(1);

    // Gegenprobe: ein gleichnamiges Element OHNE den antd-Import bleibt unsichtbar —
    // sonst meldete der Guard jedes fremde `color` an irgendeinem Element.
    expect(
      tagBefunde({
        '/src/pages/Fremdes.tsx':
          '<StatusLabel color={rollenFarbe(warnstufeKarte[s].rolle, token)}>x</StatusLabel>',
      }),
    ).toEqual([]);
  });

  it('meldet einen gleichnamigen LOKALEN Wert nicht — Namensgleichheit ist kein Import', () => {
    // Im Codex-Review gefunden: der Topf wurde jeder Datei mit ALLEN Vertragsnamen
    // vorbelegt. Eine Seite mit einer eigenen `dringlichkeit` wäre damit gemeldet worden,
    // ohne `statusFarben.ts` je zu importieren — derselbe Fehlalarm aus Namensgleichheit
    // wie bei `STATUS_META`, nur eine Ebene höher.
    expect(
      tagBefunde({
        '/src/pages/Eigen.tsx': [
          'const dringlichkeit = eigeneAchse(x);',
          '<Tag color={dringlichkeit}>{x}</Tag>',
        ].join('\n'),
      }),
    ).toEqual([]);

    // Die Gegenprobe, ohne die der Topf genauso gut leer bleiben könnte: MIT Import wird
    // derselbe Ausdruck gemeldet.
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

  it('liest ein `<Tag>` IN einer Zeichenkette nicht als Auszeichnung', () => {
    // Die zweite Hälfte derselben Klasse — im Codex-Review gefunden, nachdem ich sie für
    // die Karten geschlossen hatte. Fehlalarme zählen in beiden Guards gleich.
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

    // Gegenprobe 2, und die ist die wichtigere: ein Tag HINTER einer geschlossenen
    // Zeichenkette derselben Zeile ist echt — so steht es im Bestand
    // (`stammdaten/SprechgruppenTab.tsx:94`). Ein Filter, der beim ersten
    // Anführungszeichen aufgäbe, machte den halben Bestand unsichtbar.
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
