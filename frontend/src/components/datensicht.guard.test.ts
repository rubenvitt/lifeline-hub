import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Guard des Datensicht-Primitivs (LFH-330 · B2).
 *
 * Zwei Hälften mit zwei verschiedenen Bauarten, aus einem Grund: die Zusicherungen ÜBER
 * `Datensicht.tsx` wirken ab dem ersten Tag, die über seine Konsumenten haben am ersten Tag
 * noch keinen Gegenstand.
 *
 * ── HÄLFTE 1: das Primitiv selbst ───────────────────────────────────────────────
 *
 * Tragend ist die POSITIVE Marke `<KatalogTabelle`. Ohne sie bestünde ein `Datensicht.tsx`,
 * das ein rohes antd-Tabellenelement ohne Bildlauf-Prop rendert, jede negative Prüfung —
 * und nähme allen künftigen Konsumenten still waagerechten Bildlauf, stehende Kopfzeile und
 * fixierte Kennungsspalte. Eine reine Verbotsliste kann das nicht sehen.
 *
 * ── HÄLFTE 2: die Konsumenten, ABGELEITET **und** handgepflegt ──────────────────
 *
 * Beides, gegeneinander geprüft — weil jede Hälfte für sich blind ist. Die Menge wird aus
 * der Marke `<Datensicht` ERSCHNÜFFELT und gegen das handgeschriebene {@link KONSUMENTEN}
 * gestellt: ein rein abgeleitetes Inventar sähe eine Datei nicht, die still aus dem
 * Primitiv herausfällt (es hätte sich mitverkleinert), ein rein handgepflegtes müsste von
 * jedem Folgebündel editiert werden — genau die Kollision, die für
 * `katalogTabelle.guard.test.ts` einen benannten Eigentümer nötig gemacht hat.
 *
 * Die Falsch-Positiv-Sorge, die dessen 13er-Inventar handgepflegt macht („Modals, Listen,
 * Untertabellen"), existiert für die abgeleitete Hälfte nicht: die Menge ist durch das
 * Vorkommen der Marke definiert, nicht durch eine Einschätzung.
 *
 * ── DIE FÜNF GEPFLEGTEN LISTEN ──────────────────────────────────────────────────
 *
 * Drei SEMANTISCHE Ausnahmemengen ({@link KARTEN_EIGENBAU} — leer, {@link NUR_KARTE} — zwei,
 * {@link NUR_TABELLE} — eine), eine PFLICHTMENGE ({@link VOLLMENGE_PFLICHT} — eine) und eine
 * SCHULDMENGE ({@link REITERSCHLUESSEL_OFFEN} — seit Bündel T LEER, der eine Eintrag wurde
 * getilgt statt fortgeschrieben). Alle fünf sind auf ihre Länge gepinnt und werden auf tote
 * Einträge geprüft: wer eine Datei einträgt, ohne sie umzubauen, fällt am
 * Anwesenheits-Gegentest auf — ein toter Eintrag wird gemeldet, nicht geduldet.
 *
 * ── DIE ZWEI SCHLÜSSELREGELN, und warum es zwei sein müssen ─────────────────────
 *
 * Sie fangen ZWEI verschiedene Gestalten desselben Fehlers, und keine sieht die andere.
 *
 * 1. {@link schluesselBefunde} — MEHRERE Sichten, EINE Baumstelle. Greift ab zwei
 *    `<Datensicht>` je Datei und verlangt distinkte `key`. Gemessen an `PersonenPage`.
 * 2. {@link reiterBefunde} — EINE Sicht, MEHRERE Reiter. Die häufigere Gestalt, und für
 *    Regel 1 grundsätzlich unsichtbar: eine Datei mit genau einem `<Datensicht>` fällt aus
 *    deren Filter (`stellen.length < 2`) heraus, bevor irgendetwas geprüft wird. Genau so
 *    sah der Fehler aus, gegen den dieser Guard gebaut wurde — ein Element, fünf Reiter,
 *    fünf Datenmengen.
 *
 * Regel 2 kann „ein Schlüssel trägt eine Reiterachse" nicht beweisen; das ist statisch nicht
 * sicher entscheidbar. Sie nähert an, und die Näherung ist an DREI Stellen verankert, die im
 * Quelltext nachweisbar sind statt geraten:
 *
 * · Die ACHSE kommt aus dem Attribut, das ein {@link SICHTSCHALTER}-Element bindet
 *   (`activeKey=`/`value=`) — nicht aus einer Namenskonvention wie `useState<Sicht>`. Das
 *   Attribut ist die Stelle, an der die Achse nachweislich hängt; ein Typname ist ein Vorschlag.
 * · GEMELDET wird nur, wenn `daten` an der Achse hängt und der `key` NICHT. Ein konstanter
 *   Schlüssel über achsunabhängigen Daten ist richtig, nicht verdächtig.
 * · Der Weg von `daten` zur Achse läuft über die lokalen `const`-Initialisierer der Datei
 *   (Tiefe 3), weil die reale Form `daten={tiere}` mit `const tiere = filterTiere(alle,
 *   { sicht })` eine Stufe entfernt liegt und eine direkte Prüfung sie verfehlte.
 *
 * GEMESSEN am Baum dieses Bündels, und das ist die Begründung für „bauen" statt „nur
 * dokumentieren": 9 Konsumenten, davon 2 mit Schalterachse, zusammen 3 Sichtstellen → bei
 * Auslieferung 1 Meldung, 0 Fehlalarme. Beide Sichten von `PersonenPage` bleiben still, und
 * zwar aus dem richtigen Grund: `key="patienten"` steht über `alle.filter(istPatient)`
 * (achsunabhängig, also kein Befund), `` key={`liste-${sicht}`} `` über
 * `filterPersonen(alle, sicht)` (Achse im Schlüssel). Die eine Meldung galt `TierePage` und
 * ist in Bündel T behoben — die Seite trägt jetzt `key={sicht}`, der Baum meldet 0. Dass die
 * Regel überhaupt noch etwas FINDET, hängt seither allein am Selbstbeweis (a) auf
 * synthetischer Quelle; ohne ihn wäre ein abgestumpfter Scanner still grün.
 * Zur künftigen Reichweite ehrlich: repoweit tragen 13 Dateien eine Schalterachse — die Regel
 * ist an 2 gemessen, nicht an 13.
 *
 * ── WIE ER SEINE EIGENE PROSA NICHT MITZÄHLT — dreifach ─────────────────────────
 *
 * Zweifach ist im Vorläuferpaket zweimal gerissen, deshalb drei Verteidigungen:
 * 1. **Kommentar-Stripper mit Blockzustand über Zeilengrenzen** vor jeder VERBOTS-Zählung,
 *    plus ein Selbstbeweis, dass eine verbotene Form im Kommentar genau 0 Treffer liefert.
 * 2. **Die verbotenen Marken stehen in den gescannten Dateien nirgends als Prosa.** Der
 *    Dateikopf von `Datensicht.tsx` umschreibt sie durchgehend („kein Bildlauf-Prop", „die
 *    Kartenform ist `Liste`, nicht …"). Wer den Kopf ergänzt, schreibt keine Marke aus.
 * 3. **Der Guard scannt sich selbst nicht** — Testdateien sind aus allen Mengen ausgenommen.
 *
 * Der Kommentar-Stripper ist aus `theme/gate5.guard.test.ts` BEWUSST kopiert statt
 * importiert: ein Import aus einer anderen `*.test.ts` registriert deren `describe`-Blöcke
 * ein zweites Mal.
 *
 * Die SCHLÜSSELPRÜFUNG ({@link sichtstellen}) braucht die ersten beiden nicht: sie liest den
 * AST, und Kommentare sind dort keine Knoten — auch ein ausgeschriebenes `<Datensicht` in
 * einer Prosa-Zeile ist kein JSX-Element. Die dritte gilt weiter, nur anders begründet: sie
 * läuft ausschließlich über {@link KONSUMENTEN} und kommt deshalb an keine Testdatei.
 *
 * ── WAS DER GUARD NICHT SIEHT, und das ist Teil des Vertrags ────────────────────
 *
 * · **Ob hinter einem Slot-Schlüssel überhaupt eine Spalte steht.** Das kann nur
 *   `pruefeKartenplan` zur Laufzeit und `tsc` bei intaktem `const K`.
 * · **Einen Konsumenten, der gar nichts von `Datensicht` weiß** — eine neue Einsatzliste,
 *   die wieder ein rohes antd-Tabellenelement einbindet, fällt hier nicht auf. Dagegen
 *   steht das Inventar in `katalogTabelle.guard.test.ts`, nicht dieser Guard.
 * · **Jede Aussage über Layout.** jsdom rechnet keines (`vite.config.ts`, `css: false`);
 *   Trefflächen, Überlauf und Fokusverdeckung gehören nach `frontend/e2e/`.
 * · **Dynamisch zusammengesetzte Bezeichner.** Wie in `useViewport.guard.test.ts` bewusst
 *   nicht abgedeckt.
 * · **Die Gleichheit zweier Schlüssel misst der QUELLTEXT, nicht der Laufzeitwert.** Zwei
 *   gleich geschriebene Ausdrücke gelten als Dublette, auch wenn sie zur Laufzeit
 *   auseinanderlaufen; zwei verschieden geschriebene, die denselben Wert liefern, fallen
 *   nicht auf. Ein `key` in einem `{...spread}` wird nicht gesucht — es steht nicht am
 *   Element.
 * · **Die Achsverfolgung von {@link reiterBefunde} ist eine Näherung, an fünf benannten
 *   Stellen.** (a) bis (e) — die Zahl stand vorher auf „vier" und zählte (e) nicht mit.
 *   (a) Sie misst QUELLTEXT: `haengtAnAchse` sucht Bezeichner per Regex, ein
 *   Achsenname in einem Zeichenkettenliteral zählt also mit — bei `daten` zu scharf, beim
 *   `key` zu milde. (b) Die Initialisierer-Karte ist FLACH über die ganze Datei, ohne
 *   Gültigkeitsbereiche: zwei gleichnamige lokale Bindungen fallen zusammen. Wie hart (a) und
 *   (b) zusammen sein können, ist in Bündel T bei der Mutationsprobe an `TierePage`
 *   herausgefallen: `key="tiere"` blieb STILL. Der Weg dahin ist (a) plus (b) — `BEZEICHNER`
 *   zieht `tiere` aus dem Zeichenkettenliteral HERAUS, und die flache Initialisierer-Karte
 *   löst diesen Namen anschließend über die gleichnamige lokale Bindung
 *   `const tiere = filterTiere(alle, { sicht, … })` zur Achse auf. Nicht das Attribut wird
 *   aufgelöst, sondern der Bezeichner in seinem Text. Dieselbe Stelle mit `key="liste"`
 *   meldete sofort. Ein konstanter
 *   Schlüssel, der zufällig den Namen einer achsabhängigen lokalen Bindung trägt, kommt also
 *   durch. (c) Aus dem Schalter-Attribut werden nur echte BEZEICHNER zur Achse, und zwar
 *   die links vom Punkt: `activeKey={filter.reiter}` liefert `filter`, nicht `reiter`.
 *   Zeichenketten und Property-Namen sind ausgeschlossen (Begründung an
 *   {@link achsenBezeichner}) — ein `value={x ? 'alle' : 'abschnitte'}` steuert also nur
 *   `x` bei. Wer eine Achse ausschliesslich über einen Property-Namen bindet, wird nicht
 *   gesehen; im Bestand gibt es diese Form nicht. (c′) Die RICHTUNG erkennt die Regel
 *   nicht: sie sieht „Schalterwert und Zeilenmenge teilen einen Bezeichner", nicht „die
 *   Zeilenmenge hängt vom Schalter ab". Ein Schalter, der die Daten LIEST — etwa ein
 *   Aufklapp-Umschalter, dessen Zustand aus der Vollzähligkeit des Baums folgt — meldet
 *   deshalb fälschlich, wenn der Vergleich im Attribut steht. Abhilfe an der Fundstelle ist
 *   eine benannte Zwischenvariable (`KraefteuebersichtPage.tsx`, `alleAufgeklappt`), die
 *   die Richtung ohnehin lesbarer macht; ein `key` am Element wäre hier die FALSCHE
 *   Behebung und verwürfe Sortierung, Spaltenwahl und Zeilenschleuse bei jedem Schalten. (d) Als Schalter gelten nur die drei Tags in {@link SICHTSCHALTER};
 *   eine handgebaute Reiterleiste aus `<Button>`n ist keiner. (e) Der EINGANG der Regel ist
 *   das `daten`-Attribut am Element — eine Sicht, die ihre Zeilen aus einem `{...spread}`
 *   bezieht, hat für den Guard keine Daten und wird stillschweigend übersprungen. Dieselbe
 *   Spread-Grenze wie beim `key` eine Zeile höher, hier aber folgenreicher: beim `key` fehlt
 *   dann eine Angabe, hier fällt die ganze Prüfung aus. Die Näherung ist gemessen
 *   (0 Fehlalarme auf 3 Sichtstellen), nicht bewiesen.
 * · **Ob ein Reiterwechsel den Zustand überhaupt zurücksetzen SOLL.** Der Guard verlangt nur,
 *   dass die Entscheidung im Schlüssel steht. Wer den Zustand bewusst mitnimmt, trägt sie
 *   nicht dort ein und braucht einen Eintrag in {@link REITERSCHLUESSEL_OFFEN} mit Begründung.
 * · **Die vier Marken aus {@link VERBOTEN_BEI_VOLLMENGE} treffen nur die wörtliche Form.**
 *   Ein `filter: WERTE_FILTER` aus einer Konstanten, ein durch einen Wrapper gereichtes
 *   `suche={props.suche}` oder ein `{...datensichtProps}` mit einer dieser Angaben darin
 *   kommen durch. Dieselbe Lücke wie bei jedem Regex-Gate des Repos — hier benannt, weil
 *   diese Liste Teil des Vertrags ist und nicht später entdeckt werden soll.
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
 * Dateien, die `art: 'eigen'` im Kartenplan setzen dürfen.
 *
 * Am Tag 1 LEER, und das war der Unterschied zu Entwurf 2, dessen Ausnahme schon am ersten
 * Tag belegt war und über das Band auf etwa fünf gewachsen wäre. Die UHS-Zeitleiste läuft
 * über den Plan-Modus, weil `Liste` mit ihren Trennlinien bereits die Struktur von
 * `personen/PersonVerlauf.tsx` liefert.
 *
 * ── DER ERSTE EINTRAG, UND WARUM DER PLAN-MODUS IHN NICHT TRÄGT (LFH-342 · C7) ──
 *
 * Die ETB-Chronologie braucht **fünf** Kopffelder (Nr. · Zeit · Typ · Von→An · Erfasser),
 * einen Markdown-Block über die **volle Breite** und **drei** Zeilenaktionen. Der
 * Plan-Modus bietet Titel + Status + höchstens DREI Sekundärfelder + genau EINE
 * Primäraktion — im Plan-Modus fielen Berichtigen, Wiedervorlage und Auftrag unter `md`
 * also ersatzlos weg, und der Meldungstext stünde als Etikett/Wert-Paar neben den
 * anderen Feldern statt darunter. An einem beweissichernden Tagebuch ist beides kein
 * hinnehmbarer Verlust; genau H59/H64 war der Anlass des Umbaus.
 *
 * Was der Eigenbau dafür SELBST tragen muss, steht im Dateikopf von `etb/EtbTabelle.tsx`:
 * `data-lfh="datensicht-karte"` (sonst findet `scrolleZurZeile` die Karte nicht) und die
 * Zeilenklasse (sonst gilt sie nur im Tabellenzweig). Das Primitiv legt beim Eigenbau
 * keinen Wrapper darum — wer den zweiten Eintrag hier hinzufügt, prüft beides mit.
 */
const KARTEN_EIGENBAU: string[] = ['/src/etb/EtbTabelle.tsx'];

/**
 * Dateien, die `form="karte"` tragen MÜSSEN — Module, die heute schon kartenbasiert gelesen
 * werden (Befehle, Lageberichte). Dort ist die Tabelle der Befund, nicht der Zielzustand.
 */
const NUR_KARTE: string[] = [
  '/src/auftraege/BefehlListe.tsx',
  '/src/pages/LageberichtePage.tsx',
  // Zwölfte Konsumentin seit LFH-348 · C13: ein Lageobjekt wird gelesen, nicht verglichen.
  '/src/pages/LagemeldungenPage.tsx',
];

/**
 * Dateien, die `form="tabelle"` tragen MÜSSEN — Vergleichsflächen, die Kriterium 14
 * ausdrücklich nicht in Karten auflösen darf.
 *
 * WARUM DIESE ZWEI LISTEN ÜBERHAUPT: eine Datei mit `form="karte"` bleibt bei `<Table` = 0
 * grün, AUCH wenn sie eine Tabelle rendert — das Tabellenelement liegt in
 * `KatalogTabelle.tsx`. Die Verbotsmarke allein kann die Formwahl also nicht prüfen; nur die
 * Anwesenheit des Literals kann es.
 */
const NUR_TABELLE: string[] = ['/src/pages/KraefteuebersichtPage.tsx'];

/**
 * Dateien, deren `Datensicht` die ZEILENMENGE nicht antasten darf — keine Freitextsuche,
 * kein Spaltenfilter, keine Sortierung IM PRIMITIV.
 *
 * Die Gegenzeile zu {@link NUR_TABELLE}: dort steht, welche Form das Meldebild trägt, hier,
 * was es nicht tun darf. Der Grund ist die Rechenrichtung — die Aggregate der Elternzeilen
 * werden stromaufwärts über die VOLLMENGE kumuliert (`addKategorie`), während
 * `filtereKraefte` die Rohlisten filtert und den Baum neu baut. Fiele im Primitiv eine Zeile
 * weg, behielten die Eltern Zahlen über nicht mehr sichtbare Kinder: die Ampelzahlen lügen
 * still, ohne Fehler und ohne roten Test.
 *
 * WARUM STATISCH, obwohl `pruefeKartenplan` zwei der vier Marken kennt: dessen Prüfung
 * greift nur, SOLANGE `baum` gesetzt ist, kennt die Sortierung gar nicht — und sie ist ein
 * `console.warn` hinter `import.meta.env.DEV` (`Datensicht.tsx`, gemessen bei Zeile 971).
 * Sie färbt keinen Test rot.
 *
 * `Input.Search` ist hier ausdrücklich ERLAUBT: die Filter-Card der Seite liegt AUSSERHALB
 * der Datensicht und filtert die Rohlisten, aus denen die Aggregate danach neu entstehen.
 * Diese Liste ist deshalb dateibezogen und KEINE repoweite Zusicherung.
 */
const VOLLMENGE_PFLICHT: string[] = ['/src/pages/KraefteuebersichtPage.tsx'];

/**
 * Dateien mit einer Reiterachse, deren Sicht den Reiter NICHT im Schlüssel trägt.
 *
 * KEINE Ausnahmemenge, sondern eine SCHULDMENGE: die vier Listen oben sagen „so ist es
 * richtig", diese sagt „so ist es, und es ist falsch". Deshalb steht in ihrem Gegentest die
 * umgekehrte Erwartung — ein Eintrag muss WEITERHIN GEMELDET WERDEN. Verschwindet die
 * Meldung, ist entweder die Datei repariert (Eintrag löschen) oder die Regel kaputt.
 *
 * LEER, und das ist die Aussage. Der eine Eintrag bei Auslieferung des Guards war
 * `pages/TierePage.tsx`: vier Reiter (`aktiv`/`vermisst`/`abgeschlossen`/`alle`) über
 * `filterTiere(alle, { sicht, spezies })` auf die Zeilenmenge, dafür EINE `<Datensicht>` ohne
 * `key` — Wort für Wort die an `PersonenPage` gemessene Falle. Bündel T hat ihn behoben
 * (`key={sicht}`) statt fortgeschrieben, und damit ist die Schuld getilgt, nicht verwaltet.
 *
 * Ein neuer Eintrag ist deshalb kein Vermerk, sondern eine zweite Seite mit demselben Fehler
 * — er gehört behoben. Wer trotzdem einen braucht, weil der Zustand über den Reiter hinweg
 * bewusst stehen bleiben soll, schreibt die Begründung daneben (Regel im Kopfkommentar).
 */
const REITERSCHLUESSEL_OFFEN: string[] = [];

/**
 * Das Konsumenteninventar von LFH-330 · B2, handgeschrieben — nicht aus dem Scan abgeleitet.
 *
 * Der Scan sagt, WER heute konsumiert; diese Liste sagt, wer es SOLL. Beides gegeneinander
 * zu prüfen ist der einzige Weg, zwei verschiedene Fehler zu fangen: eine Datei, die still
 * aus dem Primitiv herausfällt (steht hier, fehlt im Scan), und eine, die ungeplant
 * hinzukommt (steht im Scan, fehlt hier). Ein abgeleitetes Inventar kann das erste nicht
 * sehen — es hätte sich einfach mitverkleinert.
 */
const KONSUMENTEN = [
  '/src/auftraege/BefehlListe.tsx',
  // Elfte seit LFH-342 · C7: die ETB-Chronologie lief als neunzehnte Konsumentin direkt
  // auf `KatalogTabelle` und war damit auf jedem Schirm eine Tabelle mit sieben Spalten.
  // Sie ist damit — wie `SchaedenPage` in C5 — nach OBEN aus dem Katalogtabellen-Inventar
  // herausgefallen; der Restposten LFH-330 · AP8 ist eingelöst.
  '/src/etb/EtbTabelle.tsx',
  '/src/pages/FahrzeugePage.tsx',
  '/src/pages/KraefteuebersichtPage.tsx',
  '/src/pages/LageberichtePage.tsx',
  // Zwölfte seit LFH-348 · C13: die Lagemeldungen lagen auf einer nackten `Liste` ohne
  // Zeit, Sortierung, Gruppen und Rückweg (Befund M85).
  '/src/pages/LagemeldungenPage.tsx',
  '/src/pages/MaterialPage.tsx',
  '/src/pages/PersonalPage.tsx',
  '/src/pages/PersonenPage.tsx',
  // Zehnter seit LFH-340 · C5: die Schadensliste war die letzte der drei Betroffenen-Listen
  // auf einer handgebauten `KatalogTabelle` — ohne Karten-Fallback, ohne Zeitachse, ohne
  // Sortierung, und mit drei eigenen Filterelementen über der Tabelle.
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
 * Blendet Kommentarinhalt aus, Blockzustand über Zeilengrenzen getragen.
 * Kopie aus `theme/gate5.guard.test.ts` — Begründung im Dateikopf.
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
 * Elemente, die eine Sicht-/Reiterachse schalten, je mit dem Attribut, das die AKTIVE Achse
 * trägt.
 *
 * Nur diese drei — eine handgebaute Reiterleiste aus `<Button>`n erkennt der Guard nicht
 * (im Kopf benannt). Der Bezeichner kommt aus dem ATTRIBUT, nicht aus einer Namenskonvention:
 * `useState<Sicht>` heißt anderswo `modus` oder `tab`, aber `activeKey={…}` ist die Stelle,
 * an der die Achse nachweislich gebunden wird.
 */
const SICHTSCHALTER: Readonly<Record<string, string>> = {
  Tabs: 'activeKey',
  Segmented: 'value',
  'Radio.Group': 'value',
};

/**
 * Die Bezeichner, die ein Schalter-Attribut als ACHSE beisteuert — aus dem AST, nicht per
 * Regex über den Attributtext.
 *
 * Gemessen an LFH-338: `<Segmented value={expandedKeys.length > 0 ? 'alle' : 'abschnitte'} />`
 * lieferte über {@link BEZEICHNER} vier Achsen — `expandedKeys`, `length`, **`alle`** und
 * **`abschnitte`**. Die letzten beiden sind der Inhalt von ZEICHENKETTEN, und `abschnitte`
 * kommt in fast jeder Einsatz-Seite als Variable vor: der Guard meldete daraufhin eine
 * Reiterachse an einer Fläche, die gar keinen Reiter hat, nur einen Aufklapp-Umschalter.
 *
 * Ein Gate, das an einem Zeichenkettenwert anschlägt, ist von einem kaputten nicht zu
 * unterscheiden — und die naheliegende „Behebung" (dem `Datensicht` einen Schlüssel geben,
 * der am Umschalter hängt) wäre ein echter Schaden: sie hängte die Sicht bei jedem
 * Aufklappen neu ein und verwürfe Sortierung, Spaltenwahl und Zeilenschleuse.
 *
 * Ausgeschlossen wird deshalb beides: Zeichenketten (sie sind keine Bezeichner) und
 * PROPERTY-Namen (`x.length` steuert `x` bei, nicht `length`) — ein Property-Name ist im
 * Zielausdruck ein anderer Namensraum und träfe dort zufällig gleichnamige Felder.
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
 * Ein Durchlauf, drei Ausbeuten — AST statt Regex, nach dem Muster von `api/queryKeyScan.ts`.
 *
 * Der Grund ist gemessen: die Vorgängerform zählte jedes `key=` der ganzen DATEI gegen die
 * Zahl der Sichten, und die Treffer stammen überwiegend aus Spalten-Renderern
 * (`<Tag key={w}>` in einer `.map()`). Damit blieben genau die zwei Fälle unsichtbar, gegen
 * die die Zusicherung überhaupt gebaut wurde: zwei Sichten OHNE eigenen Schlüssel und zwei
 * mit DEMSELBEN.
 *
 * `ohneKommentare` läuft hier NICHT: Kommentare sind keine AST-Knoten, und das Strippen
 * verschöbe nur die Zeilennummern der Meldung.
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
 * Befunde der Schlüsselregel: ab ZWEI Sichten in einer Datei trägt jede einen `key`, und
 * die Schlüssel sind paarweise verschieden. Rein und exportiert, damit die Selbstbeweise
 * sie ohne Dateisystem prüfen können — Bauform aus `useViewport.guard.test.ts`.
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
 * Hängt ein Ausdruck an einem der Achsen-Bezeichner — direkt oder über lokale `const`?
 *
 * Die Tiefe ist der Grund, warum die Regel überhaupt greift: die reale Form ist nicht
 * `daten={f(sicht)}`, sondern `daten={tiere}` mit `const tiere = filterTiere(alle, { sicht })`
 * eine Stufe darüber. Bei Tiefe 0 wäre der einzige gemessene Befund unsichtbar (per Probe
 * belegt: Tiefe 0 → 0 Meldungen). Drei Stufen, weil die Kette in der Praxis eine ist und die
 * Reserve billig ist; unbegrenzt wäre sie es nicht, `gesehen` bricht Zyklen ohnehin ab.
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
 * Befunde der Reiterregel: hängt die Zeilenmenge einer Sicht an der Reiterachse, muss der
 * `key` es auch tun. Rein und exportiert wie {@link schluesselBefunde} — Bauform aus
 * `useViewport.guard.test.ts`.
 *
 * Was hier NICHT gemeldet wird, ist so wichtig wie was gemeldet wird: eine Datei ohne
 * Schalterachse, und eine Sicht mit konstantem Schlüssel über achsunabhängigen Daten. Sonst
 * schlüge die Regel an `PersonenPage`s `key="patienten"` an — richtig geschrieben, weil
 * `alle.filter(istPatient)` nicht am Reiter hängt.
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
    // Bewusster Doppelgurt neben `dichte.guard.test.ts` (LFH-362), das dieselbe Norm
    // repoweit trägt: jenes greift nur an INTERAKTIVEN Elementen, dieses hier an
    // jedem. Im Primitiv ist das enger gemeint — auch eine Fläche darf ihre
    // Polsterung nicht festnageln, weil sie die Kartenhöhe aller Konsumenten setzt.
    // Entfällt dieser Eintrag, sinkt die Abdeckung; er ist keine Dublette.
    muster: /size="small"/g,
    grund: 'neue Klein-Varianten auf interaktiven Elementen sind verboten',
  },
  { muster: /matchMedia|\buseBreakpoint\b/g, grund: 'die Breitenfrage läuft über useViewport' },
];

/**
 * Die Anwesenheitsmarken der schriftlichen Begründung.
 *
 * WICHTIG: sie werden am ROHTEXT gemessen, nicht am kommentarfreien — sie STEHEN im
 * Dateikopf, also in einem Kommentar. Und Anwesenheitsprüfungen sind hier bewusst gewählt:
 * eine solche Marke kann ihr eigenes Gate nicht auslösen, im Gegensatz zu einer Verbotszählung.
 */
const BEGRUENDUNG = ['KARTEN-AUSNAHME', 'TRENNLINIE'];

/**
 * Verbotene Formen je Konsumentendatei.
 *
 * `<Card` steht hier BEWUSST NICHT: gemessen zwei legitime Treffer (Kennzahlen- und
 * Filter-Card in `pages/KraefteuebersichtPage.tsx`), und die Filter-Card ist genau der
 * Grund, aus dem {@link VOLLMENGE_PFLICHT} dort gelten darf. Ein Verbot wäre am Liefertag
 * rot. Im PRIMITIV bleibt `<Card` verboten — dort doppelt der Rahmen die li-Trennlinie.
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
 * Verbotene Formen in einer Datei aus {@link VOLLMENGE_PFLICHT} — alles, was das Primitiv
 * Zeilen entziehen oder umordnen ließe. Begründung dort.
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
 * Beide Hälften in EINER Befundliste. Exportiert und rein, damit die Selbstbeweise sie ohne
 * Dateisystem prüfen können — Bauform aus `useViewport.guard.test.ts`.
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
      // Am ROHTEXT: die Begründung steht im Dateikopf und damit in einem Kommentar.
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
    // Schließt das `const K`-Widening: eine annotierte Spaltenliste weitet K auf `string`
    // und der Kartenplan nimmt danach jeden Tippfehler an. Der Typ kann das nicht sehen.
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
    // Die NEGATIVE Hälfte der Gegenzeile: NUR_TABELLE sagt, welche Form; das hier, was die
    // Sicht nicht tun darf. `Input.Search` bleibt unangetastet — die Muster greifen nur
    // Props/Spaltenschlüssel des Primitivs.
    if (ausnahmen.vollmenge.includes(pfad)) {
      for (const { muster, grund } of VERBOTEN_BEI_VOLLMENGE) {
        const anzahl = treffer(rein, muster);
        if (anzahl > 0) gefunden.push(`${pfad}: ${anzahl}× ${muster.source} — ${grund}`);
      }
    }
  }

  // Tote Ausnahmeeinträge melden — sonst veraltet die Liste still, wie in
  // `useViewport.guard.test.ts` begründet.
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
  it('LFH-464: ausschließlich das vermessene ETB setzt einen eigenen Umbruch', () => {
    const mitUmbruch = KONSUMENTEN.filter((pfad) =>
      /\btabelleAb\s*=/.test(ohneKommentare(dateien[pfad])),
    );
    expect(mitUmbruch).toEqual(['/src/etb/EtbTabelle.tsx']);
    expect(ohneKommentare(dateien['/src/etb/EtbTabelle.tsx'])).toContain('tabelleAb="xl"');
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
    // GENAU EINER seit LFH-342 · C7, und die Begründung steht über der Liste: die
    // ETB-Ereigniszeile passt strukturell nicht in den Plan-Modus (fünf Kopffelder,
    // Volltextblock, drei Aktionen gegen Titel + Status + drei Felder + eine Aktion).
    // Wer den zweiten einträgt, begründet ebenso — sonst wächst die Ausnahme über das
    // Band auf fünf und der Kartenplan wäre nur noch ein Vorschlag.
    expect(KARTEN_EIGENBAU).toHaveLength(1);
    // Drei Kartenmodule (Befehle, Lageberichte, seit LFH-348 · C13 die Lagemeldungen), eine
    // Vergleichsfläche. Wer einträgt, ohne umzubauen, fällt am Anwesenheits-Gegentest oben
    // auf; wer umbaut, ohne einzutragen, an der Formprüfung.
    expect(NUR_KARTE).toHaveLength(3);
    expect(NUR_TABELLE).toHaveLength(1);
    // Die vierte ist keine Ausnahme, sondern eine PFLICHT — und sie ist ausdrücklich
    // dateibezogen. Ein zweiter Eintrag braucht dieselbe Herleitung wie das Meldebild
    // (Aggregate stromaufwärts über die Vollmenge), nicht bloß den Verweis hierauf.
    expect(VOLLMENGE_PFLICHT).toHaveLength(1);
    // Die fünfte ist eine SCHULD, keine Ausnahme — sie sollte schrumpfen, und sie ist auf 0
    // geschrumpft: der eine Eintrag (`TierePage`) wurde behoben, nicht fortgeschrieben. Ein
    // Eintrag hier ist kein Vermerk, sondern eine zweite Seite mit demselben Fehler.
    expect(REITERSCHLUESSEL_OFFEN).toHaveLength(0);
  });

  it('Sentinel: der Scan sieht das Primitiv und mehr als 200 Dateien', () => {
    // Ohne diesen Fall wäre ein kaputtes Scan-Muster (falsche Wurzel, falsche Endung) still
    // grün — der Guard fände dann schlicht nichts mehr und meldete Erfolg.
    expect(Object.keys(dateien).length).toBeGreaterThan(200);
    expect(dateien[PRIMITIV] ?? '').not.toBe('');
    expect(dateien[PRIMITIV]).toContain('KatalogTabelle');
  });

  it('der Scan sieht genau die zehn geplanten Konsumenten', () => {
    /**
     * Die Gleichheit prüft BEIDE Richtungen: eine Datei, die still aus dem Primitiv
     * herausfällt, verschwindet aus dem Scan und bleibt in {@link KONSUMENTEN} stehen; eine
     * ungeplant hinzukommende steht im Scan und fehlt in der Liste. Ein rein abgeleitetes
     * Inventar sähe den ersten Fall nie — es hätte sich stillschweigend mitverkleinert.
     */
    expect([...konsumentenVon(dateien)].sort()).toEqual([...KONSUMENTEN].sort());
  });

  it('mehrere Sichten in einer Datei tragen distinkte key-Angaben', () => {
    /**
     * Die teuerste gemessene Falle dieses Pakets, und sie erzeugt keinen Fehler:
     * zwei `Datensicht` in den Zweigen eines Ternärs stehen an DERSELBEN Baumstelle mit
     * DEMSELBEN Komponententyp. React montiert dann nicht neu, sondern reicht die Instanz
     * weiter — samt Sortierung, Suchbegriff, Spaltenauswahl und Zeilenschleuse. Gemessen an
     * `pages/PersonenPage.tsx`: der Patienten-Reiter behielt die Sortierung der Listen-Sicht,
     * die eigene Voreinstellung griff nie. Keine Warnung, kein roter Test — sichtbar wurde es
     * nur, weil zufällig eine Sortierbehauptung auf dem zweiten Zweig lag.
     *
     * Gelesen wird der `key` AM ELEMENT, aus dem AST ({@link sichtstellen}). Die
     * Vorgängerform zählte stattdessen jedes `key=` der ganzen DATEI gegen die Zahl der
     * Sichten — und die Treffer stammen überwiegend aus Spalten-Renderern. Für sie waren
     * beide Fehler unsichtbar, gegen die die Zusicherung gebaut ist: zwei Sichten ohne
     * jeden Schlüssel, und zwei mit demselben.
     */
    expect(
      schluesselBefunde(dateien, KONSUMENTEN),
      'Zwei Sichten an derselben Baumstelle teilen ihren Zustand — jede braucht ihr eigenes, ' +
        'von den anderen verschiedenes key.',
    ).toEqual([]);
  });

  it('eine reiterabhängige Sicht trägt den Reiter im Schlüssel', () => {
    /**
     * Die ZWEITE Gestalt desselben Fehlers, und die häufigere: nicht zwei Sichten in einem
     * Ternär, sondern EINE Sicht über mehreren Reitern. Die Regel darüber sieht sie
     * grundsätzlich nicht — sie steigt bei `stellen.length < 2` aus, und eine Seite mit einem
     * einzigen `<Datensicht>` kommt nie an ihre Zusicherung heran. Genau so sah der an
     * `PersonenPage` behobene Fehler aus: ein Element, fünf Reiter, fünf Datenmengen.
     */
    const gemeldet = reiterBefunde(dateien, KONSUMENTEN);
    const istOffen = (b: string): boolean =>
      REITERSCHLUESSEL_OFFEN.some((p) => b.startsWith(`${p}:`));
    expect(
      gemeldet.filter((b) => !istOffen(b)),
      'Wer eine Reiterachse auf die Zeilenmenge legt, trägt den Reiter in den key — sonst ' +
        'reicht React beim Wechsel dieselbe Instanz samt Suchbegriff und Spaltenfilter weiter.',
    ).toEqual([]);

    // Der Gegentest der SCHULDMENGE steht umgekehrt zu dem der vier Ausnahmelisten: dort ist
    // ein Eintrag tot, wenn er NICHT mehr zutrifft — hier, wenn er nicht mehr GEMELDET wird.
    // Beides fängt dieselbe zwei Fehler, aber nur so herum: die Anwesenheitsprüfung oben
    // (`konsumenten.includes`) bliebe grün, sobald eine Seite ihren Schlüssel bekommt.
    //
    // Die Schleife läuft seit Bündel T LEER — genau weil `TierePage` ihn bekommen hat — und
    // beweist damit nichts mehr; sie steht für den nächsten Eintrag. Der positive Beleg, dass
    // `reiterBefunde` überhaupt noch etwas findet, liegt seither allein beim Selbstbeweis (a)
    // unten auf synthetischer Quelle. Fällt der weg, ist die erste Behauptung dieses Tests
    // wertlos grün.
    for (const eintrag of REITERSCHLUESSEL_OFFEN) {
      // Die Datei-Existenz zuerst und GETRENNT: sonst behauptete die Meldung unten bei einer
      // gelöschten oder umbenannten Datei eine von zwei Ursachen, von denen keine zutrifft.
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

    // (a) Der Befund: Achse gesetzt, Daten hängen daran — über eine lokale const, also eine
    // Stufe entfernt, wie in der echten Datei —, der Schlüssel fehlt.
    const getroffen = lauf([
      ...reiter,
      'const zeilen = filterTiere(alle, { sicht });',
      'const y = <Datensicht daten={zeilen} suche={{ platzhalter: "x" }} />;',
    ]);
    expect(getroffen).toHaveLength(1);
    expect(getroffen[0]).toContain('der key (fehlt) nicht');

    // (b) Derselbe Aufbau MIT Reiter im Schlüssel ist still — das ist die Behebung, und der
    // Test wäre wertlos, wenn er sie nicht von (a) unterscheiden könnte.
    expect(
      lauf([
        ...reiter,
        'const zeilen = filterTiere(alle, { sicht });',
        'const y = <Datensicht key={`liste-${sicht}`} daten={zeilen} />;',
      ]),
    ).toEqual([]);

    // (c) KONSTANTER Schlüssel über achsunabhängigen Daten ist richtig, nicht verdächtig —
    // die Form von `key="patienten"`. Ohne diese Zeile wäre die Regel an PersonenPage rot.
    expect(
      lauf([
        ...reiter,
        'const y = <Datensicht key="patienten" daten={alle.filter(istPatient)} />;',
      ]),
    ).toEqual([]);

    // (d) Ohne Schalterachse gibt es keinen Reiter, den ein Schlüssel tragen könnte. Ohne
    // diesen Ausstieg meldete die Regel jede schlüssellose Sicht des Repos.
    expect(lauf(['const y = <Datensicht daten={filterTiere(alle, { sicht })} />;'])).toEqual([]);

    /**
     * (e) EIN ZEICHENKETTENWERT IM SCHALTER IST KEINE ACHSE (gemessen an LFH-338).
     *
     * Der Umschalter „Alles aufklappen / Nur Abschnitte" der Kräfteübersicht trägt seine
     * beiden Zustände als Zeichenketten im `value`. Über einen Regex-Scan des Attributtexts
     * wurde daraus die Achse `abschnitte` — ein Bezeichner, den fast jede Einsatz-Seite
     * führt —, und die Regel meldete eine Reiterachse an einer Fläche ohne jeden Reiter.
     *
     * Die naheliegende „Behebung" wäre ein Schlüssel gewesen, der am Umschalter hängt: die
     * Sicht hinge bei jedem Aufklappen neu ein und verlöre Sortierung, Spaltenwahl und
     * Zeilenschleuse. Ein Gate, das zu so einer Änderung drängt, ist schlimmer als keins.
     */
    expect(
      lauf([
        "const s = <Segmented value={offen.length > 0 ? 'alle' : 'abschnitte'} />;",
        'const y = <Datensicht daten={bild.abschnitte} />;',
      ]),
      'ein Zeichenkettenwert im Schalter darf keine Achse werden',
    ).toEqual([]);

    // (f) …und die Gegenprobe zu (e): steht im selben Schalter ein echter Bezeichner, an dem
    // die Daten hängen, meldet die Regel weiter. Ohne diese Zeile hätte (e) den Scanner auch
    // ganz abschalten können.
    expect(
      lauf([
        "const s = <Segmented value={sicht === 'alle' ? 'alle' : 'eng'} />;",
        'const y = <Datensicht daten={filterTiere(alle, { sicht })} />;',
      ]),
    ).toHaveLength(1);

    // (g) Ein PROPERTY-Name ist ebenfalls keine Achse: `offen.length` steuert `offen` bei,
    // nicht `length`. Sonst träfe die Regel jede Datenmenge, in deren Ausdruck irgendwo ein
    // `.length` steht — und das ist praktisch jede.
    expect(
      lauf([
        'const s = <Segmented value={offen.length} />;',
        'const y = <Datensicht daten={alle.length > 0 ? alle : leer} />;',
      ]),
      'ein Property-Name im Schalter darf keine Achse werden',
    ).toEqual([]);
  });

  it('Sentinel: der Schlüssel-Scan sieht die zwei Sichten von PersonenPage', () => {
    // Ein Scanner, der überall [] liefert (falsche ScriptKind, danebengreifender tagName,
    // geschluckter Parse-Fehler), meldete „keine Datei hat ≥ 2 Sichten" und wäre still grün.
    // Gepinnt gegen den echten Baum — samt des Block-Kommentars, der IM öffnenden Element
    // vor `key="patienten"` steht: Kommentare sind Trivia, das Attribut bleibt sichtbar.
    // BEWUSST nicht auf die Schlüsselwerte gepinnt: die Seite gehört einem anderen Bündel.
    // Ein Pin auf `"patienten"` ginge bei einer legitimen Umbenennung rot, und der nächste
    // repariert dann den Guard statt die Seite. Wogegen der Sentinel steht — ein Scanner,
    // der überall nichts findet — belegen Anzahl und Anwesenheit vollständig.
    const pfad = '/src/pages/PersonenPage.tsx';
    const stellen = sichtstellen(pfad, dateien[pfad] ?? '');
    expect(stellen).toHaveLength(2);
    expect(stellen.every((s) => s.schluessel != null)).toBe(true);
  });

  it('Selbstbeweis: fremde key= aus Zellen-Renderern decken fehlende Sichtschlüssel nicht zu', () => {
    // Der Blindfleck der Vorgängerform als Fixture: zwei Sichten OHNE Schlüssel, dazu zwei
    // `key=` aus Renderern. Zählend („2 key= ≥ 2 Sichten") war das grün — und genau diese
    // Konstellation ist der Normalfall einer Listenseite, nicht der Sonderfall.
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
    // Dieselbe Regel für den AUSDRUCKS-Schlüssel (`key={…}`, die Form von PersonenPage):
    // gemessen wird der Quelltext, nicht der Laufzeitwert — zweimal derselbe Ausdruck ist
    // eine Dublette, zwei verschiedene sind es nicht.
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
    // Eine EINZELNE Sicht braucht keinen Schlüssel: ohne Geschwister an derselben Baumstelle
    // gibt es nichts, womit React sie verwechseln könnte.
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
    // Sechs Verbotsmarken (Table, scroll, sorter, filters, responsive, defaultSortOrder) plus
    // die fehlende spaltenFuer-Marke. Die Zahl ist der Mutationsbeweis jedes einzelnen
    // Musters: fällt eines weg, fällt sie auf 6.
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
    // Dieselbe Datei OHNE Eintrag ist sauber. Das ist die Aussage der Liste: sie ist
    // dateibezogen, keine repoweite Zusicherung — Suche und Filter sind das Normale.
    expect(befunde(baum, { eigenbau: [], nurKarte: [], nurTabelle: [], vollmenge: [] })).toEqual(
      [],
    );
  });

  it('Selbstbeweis: Input.Search bleibt in einer Vollmengen-Pflichtdatei erlaubt', () => {
    // Die Filter-Card liegt AUSSERHALB der Datensicht und filtert die Rohlisten, aus denen
    // die Aggregate danach neu entstehen. Ein Verbot von Input.Search wäre am Liefertag rot —
    // und würde die einzige Stelle treffen, an der das Meldebild überhaupt filtern DARF.
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
    // Der Grund für diese Liste: eine Datei mit form="karte" bleibt bei <Table = 0 grün,
    // AUCH wenn sie eine Tabelle rendert — das Element liegt in KatalogTabelle.tsx.
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
    // Auch die vierte Liste rottet nicht still: ein Eintrag ohne Datei fällt genauso auf.
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
    // Die Verbotsformen liegen im Kommentar → 0 Befunde. Die BEGRÜNDUNG liegt ebenfalls im
    // Kommentar und wird trotzdem gefunden, weil sie am Rohtext gemessen wird — genau diese
    // Asymmetrie ist der Grund für die zwei Textquellen.
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
