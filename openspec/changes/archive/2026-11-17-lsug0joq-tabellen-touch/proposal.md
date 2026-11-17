# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/lsug0joqlwscutgl361fszyb (LLH-1721, „Listen und
Tabellen auf Touch und Handy“) mit den Unteraufgaben LLH-1789 (`cq38dy2l`), LLH-1795
(`j10okn8m`), LLH-1790 (`i7lwykpt`) und LLH-1787 (`i5c54naq`). Thema 7 der UI/UX-Analyse vom
12.11.2026 (LLH-1714), Welle „Tabellen“.

## Why

Die Tabellen der Lifeline Hub brechen im Handschuh-Betrieb, am Tablet und am Handy an vier
Stellen. Die Hauptaktion einer Zeile liegt hinter dem Querscrollen. Ein Tipp auf einen Stift
verteilt die Spalten neu. Der Spaltenschalter meldet ausgeblendete Spalten, obwohl niemand etwas
ausgeblendet hat, und der Fahrzeugtyp verschwindet still. Am Handy setzt die Einheitenliste die
Namen Buchstabe für Buchstabe senkrecht. Alle vier Fehler sitzen in den gemeinsamen
Tabellen-Primitiven (`Datensicht`, `KatalogTabelle`, `SpaltenSchalter`, `InlineAngabe`). Deshalb
behebt sie eine Change gemeinsam und nicht jede Seite für sich.

## What Changes

- **Hauptaktion immer im Bild** (`cq38dy2l`): Ab `md` steht die Aktionsspalte einer Tabelle
  rechts fixiert. Unter `md` sitzen Primäraktion und ⋮ in der fixierten Kennung, so wie heute
  bei Evakuierung und Betreuung. Beides ist ein Opt-in der `Datensicht`-Spalte und kein Bau je
  Seite. Ausgerollt wird es auf Evakuierung, Betreuung, Material, Betroffene und Fahrzeuge.
- **Bearbeiten in der Zelle ohne Sprung** (`j10okn8m`): In einer Tabellenzelle öffnet eine
  `InlineAngabe` ihre Eingabe als Popover an der Zelle. Die Zelle behält Breite und Höhe, und die
  übrigen Spalten bleiben, wo sie sind. Karten und Ansichten behalten die Bearbeitung im Fluss,
  und die mehrzeilige Bemerkung bleibt in der Zelle.
- **Fahrzeugtyp sichtbar, Zähler nur nach eigener Wahl** (`i7lwykpt`): Unter `xxl` steht der Typ
  als gedämpfte zweite Zeile unter dem Funkrufnamen, auch in der Karte. Ab `xxl` hat er weiter
  seine eigene Spalte. Jeder Spaltenschalter heißt nur „Spalten“, solange die Vorgabe gilt (die
  voreingestellt ausgeblendeten Spalten und der Wegfall nach Breite). Erst nach eigener Wahl
  heißt er „Spalten · n ausgeblendet“ und zählt dann alle verborgenen Spalten.
- **Einheiten am Handy als Karten** (`i5c54naq`): Unter `md` zeigt die Einheitenliste den Baum
  als Karten (Name mit Zeichen, Ist/Soll mit Urteil, Einheitsführer, Untereinheiten
  aufgeklappt). Damit fällt die Festlegung LLH-1029 („Tabelle in jeder Breite“) für den
  Handschirm. Ab `md` bleibt die Tabelle.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `einsatztauglichkeit-layout`: neue Anforderungen „Die Hauptaktion einer Tabellenzeile bleibt im
  Bild“, „Bearbeiten in einer Tabellenzelle verschiebt die Tabelle nicht“ und „Die
  Einheitenliste steht am Handschirm als Karten“. In „Kein Fokusziel vollständig verdeckt“
  kommt die rechts fixierte Aktionsspalte hinzu, und das Szenario der Einheitenliste gilt erst ab
  `md`.
- `katalogtabelle-spaltenschalter`: Der Zähler im Namen erscheint erst nach eigener Wahl und gilt
  für jeden Spaltenschalter, nicht nur für die Kartenverwaltungen.
- `fahrzeug-bearbeitung`: neue Anforderung „Typ eines Fahrzeugs in der Liste“.

## Impact

- Frontend-Primitive: `components/Datensicht.tsx`, `components/KatalogTabelle.tsx`,
  `components/SpaltenSchalter.tsx`, `components/InlineAngabe.tsx`, `components/menueSpalte.ts`,
  neu ein Baustein für die Aktionsspalte.
- Seiten: `betreuung/BezirkTabelle.tsx`, `betreuung/StellenBlock.tsx`, `pages/MaterialPage.tsx`,
  `personen/personenSpalten.tsx`, `pages/FahrzeugePage.tsx`, `pages/EinheitenPage.tsx`,
  `pages/PersonalPage.tsx` (nur der Zähler).
- Wächter und Nachweise: `components/datensicht.guard.test.ts` (`NUR_TABELLE`),
  `e2e/gate1-ueberlauf.spec.ts`, `e2e/fokus-verdeckung.spec.ts`,
  `e2e/kartenverwaltung-spaltenschalter.spec.ts`, neu eine e2e-Messung „Bearbeiten ohne Sprung“.
- Regeln: `frontend/AGENTS.md`, „Tabelle und Dichte“ und „Inline-Bearbeitung und Status“.
- Anwenderdoku: Kapitel Fahrzeuge, Einheiten, Evakuierung, Betreuung und Material samt Bildern.
- Kein Backend, keine Migration, keine API-Änderung.
- Voraussetzung: LLH-1788 (Spaltenköpfe des klebenden Kopfs, Route `bug-unklar`, ohne Change) wird
  im selben Branch vorher behoben, denn er trifft dieselbe Kopf-Körper-Mechanik der
  `KatalogTabelle`.
