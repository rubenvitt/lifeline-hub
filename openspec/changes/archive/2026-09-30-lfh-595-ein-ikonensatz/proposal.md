# Proposal

## Why

Die App zeichnet ihre Ikonen heute aus drei Katalogen: `@ant-design/icons` (46 Ikonen in 56
Dateien), Tabler über `react-icons/tb` (69) und Feather über `react-icons/fi` (5). Dazu kommen
Emojis als Ersatzikonen (Wetter in `FachebenenInspector.tsx`, ☎ in `FunkErreichbarkeit.tsx`,
🚧 in `Platzhalter.tsx`). Strichstärke, Raster und Formensprache wechseln deshalb von Seite zu
Seite. Tabler hat nur ein Gewicht, aktive Zustände in der Rail lassen sich also nicht über die
Ikone zeigen. Für Fachbegriffe des Einsatzes (Trage, Sirene, Funkgerät) fehlt Tabler die Ikone.
LFH-595 legt fest, dass die ganze App **einen** Ikonensatz nutzt.

Am 30.09.2026 entschied Ruben: Der Satz ist **Icons8 „iOS 27 Outlined“** mit dem Zwilling
**„iOS 27 Filled“** für aktive Zustände. Ruben schließt das Icons8-Abo ab, dessen Lizenz die
Ablage der SVGs im Repo erlaubt. Ausschlaggebend waren der Umfang des Stils (11.181 Ikonen, der
größte einfarbige Stil bei Icons8), die Abdeckung der Fachbegriffe und der deckungsgleiche
gefüllte Zwilling. Der Abgleich ergab 87 von 90 UI-Begriffen exakt (89 mit Ersatz) und 21 von 30
Fachbegriffen (27 mit Ersatz).

## What Changes

- **Ein Ikonensatz:** Jede Ikone der Oberfläche stammt aus iOS 27 Outlined oder, für einen
  aktiven Zustand, aus dem Zwilling iOS 27 Filled. Fehlt eine Ikone, gilt die Lückenregel:
  zuerst ein Ersatz aus demselben Stil, sonst eine eigene Zeichnung im Raster des Stils. Ein
  zweiter Katalog kommt nie dazu.
- **Ein Importort:** Die SVG-Quellen liegen im Repo. Ein Erzeugungsskript baut daraus
  React-Komponenten, die die Textfarbe übernehmen. Code importiert Ikonen nur von dort.
- **BREAKING (intern):** `@ant-design/icons` und `react-icons` fallen als direkte Abhängigkeiten
  weg. Alle 120 Verwendungen werden umgestellt. Der Typ `IconType` aus `react-icons` in
  `modulRegistry.ts`, `command-palette/typen.ts`, `befehle.ts`, `BenutzerMenu.tsx`,
  `darstellungOptionen.ts` und `GefahrenMatrix.tsx` wird durch den eigenen Ikonentyp ersetzt.
- **Emojis als Ikone verschwinden:** Die Bestandsliste aus CLAUDE.md („Ein Emoji ist keine
  Ikone“, bisher ohne Guard) wird abgearbeitet. Danach verhindert ein Guard neue Emojis.
- **Aktive Zustände:** Die Rail und die Stern-Auswahl (`AnsichtSwitcher.tsx`) zeigen den
  aktiven Zustand zusätzlich über die gefüllte Ikone. Farbe und Fläche bleiben als Kanal.
- **Guard mit Schuldmenge:** Der Guard verbietet Importe aus `@ant-design/icons` und
  `react-icons` außerhalb des Ikonenordners. Seine Schuldmenge schrumpft nur und ist am Ende
  leer. Danach fallen beide Pakete aus `package.json`.
- **Stilprobe vor der Umstellung:** Etwa zehn Ikonen werden in Rail, Tabellenzeile und
  Kopfleiste gezeigt, bei Tag und Nacht, in allen drei Dichten und bei 16–20 px. Fällt die
  Probe durch, entscheidet Ruben vor dem Weiterbauen (Plan B: Windows 11 Outline/Filled).
- **Nicht betroffen:** taktische Zeichen (`taktische-zeichen-react`, DV 102), die Bildmarke
  (LFH-837), die Ikonen, die antd innerhalb seiner Komponenten selbst zeichnet
  (Select-Pfeil, Modal-Kreuz, Sortierpfeile, Knopf-Spinner), und Pfeile in Text und Kommentaren
  (⧖, ↗, ⇒, ↔).

## Capabilities

### New Capabilities

- `ikonensatz`: der eine Ikonensatz der Oberfläche. Er legt fest, woher jede Ikone stammt, wie
  Lücken geschlossen werden, dass eine Ikone nie allein Bedeutung trägt, wie sich der aktive
  Zustand zeigt und dass Emojis keine Ikonen sind.

### Modified Capabilities

(keine: `lagekarte-taktische-zeichen` bleibt unberührt, `app-marke` aus LFH-837 betrifft das
Zeichen der App und keine Bedienikonen, `sprungpalette` stellt keine Anforderung an die
Herkunft einer Ikone.)

## Impact

- **Frontend:** neuer Ordner `frontend/src/ikonen/` (Quellen, erzeugte Komponenten,
  Namensregister, Guard). Umgestellt werden 56 Dateien mit Ant-Design-Ikonen und 23 Dateien mit
  `react-icons`, dazu die Emoji-Stellen. Tests, die `.anticon`/`.anticon-lock` abfragen
  (`AmpelZelle.test.tsx`, `ModulPanel.test.tsx`), und Tests mit Ikonen-`aria-label` ziehen mit.
- **Werkzeug:** `scripts/ikonen/` (Abruf- und Erzeugungsskript, Stempel `quellen.sha256`) nach
  dem Muster von `scripts/marke/`.
- **Abhängigkeiten:** `@ant-design/icons` und `react-icons` entfallen. Die antd-internen Ikonen
  bleiben, weil antd sein Ikonenpaket selbst mitbringt.
- **Lizenz und Konto:** Das Icons8-Abo (Ruben) ist Vorbedingung für den SVG-Abruf. Die
  Lizenzgrundlage wird im Ikonenordner vermerkt.
- **Doku:** Die Regel „Ein Emoji ist keine Ikone“ in CLAUDE.md und die Vorgabe
  `docs/design/2026-09-21-neuentwurf/umsetzung.md` nennen den Ikonensatz, den Importort und die
  Lückenregel. Der Hinweis „Icon-System: react-icons/tb“ im Navigationsentwurf vom 25.05.2026
  ist ein eingefrorenes Archiv und bleibt stehen.
- **Kein** Backend, keine API, keine Migration.
