# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/eon26eatq8w8wfhe44142chu (LLH-1720), Welle 1 mit den
Unteraufgaben LLH-1778 (`qim1zbwk`), LLH-1783 (`la80rtj2`), LLH-1784 (`wnha7f8n`) und LLH-1785
(`q7tef1db`). Thema 6 der UI/UX-Analyse vom 12.11.2026 (LLH-1714). Welle 2 (Status-Baustein,
Quittung, FMS-Tableau) folgt als eigene Change.

## Why

Gelb ist verbraucht: 40 Zuordnungen in `theme/statusFarben.ts` tragen `achtung`, mehr als `alarm`
oder `normal`. Ursache ist vor allem, dass die Statuskategorie „gebunden“ (Auf Anfahrt, Am
Einsatzort, alarmiert, im Einsatz) gelb ist. Im laufenden Einsatz ist die Kräfte-Seite deshalb
fast ganz gelb, und echter Handlungsbedarf („ohne Leiter“, „Verbleib offen“) fällt nicht mehr auf.
„gebunden“ ist im Meldebild gelb und im Überblick blau.

Rot ist an der falschen Stelle: Die aktive Rail-Kategorie trägt eine rote Marke, obwohl gilt „Rot
bedient nichts“, und diese Marke liegt mit 2,3 : 1 unter dem Kontrastboden für Bedienzustände.

Bei Nacht verschwinden die Unterschiede: Das gewählte Segment hebt sich mit 1,07 : 1 ab, die
sechs Flächenstufen liegen 1,01 bis 1,05 : 1 auseinander. In der Sichtungswahl sind „tot“ und
„unverletzt“ nachts kaum zu unterscheiden, und nach einer Wahl verlieren alle übrigen Kacheln ihre
Farbe.

## What Changes

- **Statusrollen haben eine feste Bedeutung** (`qim1zbwk`): Gelb heißt „jemand muss bald handeln“,
  Rot „überfällig, Ausfall, Gefahr“. Ein Normalzustand trägt nie Gelb. „gebunden“ wird überall
  neutral, auch in der Verteilung des Meldebilds und im Überblick. Sprechwunsch (FMS 5 und 0)
  bleibt gelb, weil dort jemand antworten muss. „Neu“ (Meldung) und „Offen“ (Auftrag) werden ein
  neutrales Etikett, ihre Kartenkante bleibt als leise neutrale Marke. Weitere Normalzustände in
  Gelb werden einzeln umgestellt (Liste in `design.md`, D3).
- **Gewählt ist nachts sichtbar** (`la80rtj2`): Das gewählte Segment einer Segmentleiste trägt
  unten eine 2-px-Kante in der Bedienfarbe. Statt sechs Flächenwerten gibt es vier, die je Schritt
  einen Mindestabstand halten.
- **Die Ortsmarke ist blau** (`wnha7f8n`): Rail, Navigations-Drawer am Handy und die Reiter der
  Gerätehülle markieren „hier bist du“ mit der Bedienfarbe statt mit Markenrot, wie Modulpanel
  und Sprungpalette es schon tun.
- **Die Sichtungswahl behält ihre Farben** (`q7tef1db`): Nicht gewählte Kacheln behalten nach
  einer Wahl ihre Farbe als Innenrahmen mit Tönung statt des 8-px-Streifens. „tot“ trägt in jedem
  Zustand eine Schraffur, „unverletzt“ steht ohne Fläche. Der Startfokus liegt auf der Gruppe,
  nicht auf „SK I“.

## Capabilities

### New Capabilities
- `statusrollen`: Bedeutung der Statusrollen (Gelb, Rot, Grün, neutral) und welche Zustände
  welche Rolle tragen, insbesondere „gebunden“, Sprechwunsch und der Eingangszustand der
  Kommunikation.

### Modified Capabilities
- `farbrollen-kontrast`: neue Anforderungen „Das gewählte Segment trägt eine Bedienkante“,
  „Vier Flächenstufen mit Mindestabstand“ und „Die Ortsmarke im Rahmen trägt die Bedienfarbe“;
  „Sichtungsfläche hält den Textboden“ gilt auch für die getönten, nicht gewählten Kacheln.
- `sichtungswahl`: „unverletzt“ ohne Fläche, keine Randform mehr nach der Wahl, „tot“ und
  „unverletzt“ ohne Lesen unterscheidbar, Startfokus auf der Gruppe.

## Impact

- Frontend: `theme/statusFarben.ts`, `theme/tokens.ts`, `theme/rollen.css`, `theme/sprache.css`,
  `kraefte/` (Meldebild, Status der Mittel, FMS-Tableau-Kern), `pages/KraefteuebersichtPage.tsx`,
  `pages/fuehrung/UeberblickPage.tsx`, `kommunikation/kartenKante.ts`,
  `components/instrument/Segmentleiste.tsx`, `einsatz/IconRail.tsx`, `einsatz/ModulAkkordeon.tsx`,
  `geraet/GeraeteLayout.tsx`, `personen/SichtungsWahl.tsx`, `components/Erfassung.tsx`, dazu die
  Kontrast- und Wächtertests in `theme/` und die e2e-Kontrastprüfungen.
- Regeln: `frontend/AGENTS.md` (Gestaltungssprache, „Farbe und Zeichen“, Sichtung),
  `docs/design/2026-09-21-neuentwurf/umsetzung.md` (Rail-Marke, Palette „gebunden“).
- Erzeugt: Design System (`pnpm -C frontend design-system`), Anwenderbilder der Kapitel Kräfte,
  Arbeitsfläche, Betroffene und Kommunikation.
- Kein Backend, keine Migration, keine API-Änderung.
