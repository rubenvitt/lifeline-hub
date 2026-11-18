# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/zqw0kax3d399ujgt6h9eltas (LLH-1836)

## Why

Drucken heißt in jedem Modul anders und steht an einem anderen Ort: „Drucken / als PDF“ oben
rechts (ETB, Betroffene), „Einsatzbericht drucken“ (Einsatzdaten), „Druckansicht“ unten im
Detail (Auftrag) oder im Kopf (Person), „Drucken“ in einer Werkzeugzeile (Schichtplan) und
„Drucken / als PDF“ in der Werkzeugzeile im Inhalt (Meldebild, Funkplan, Kommunikationsplan,
Organigramm). Derselbe Wortlaut öffnet mal den Druckdialog und mal eine Druckseite. Wer im Stab
schnell ein Blatt braucht, muss je Modul suchen und weiß nicht, was der Knopf tut. Einheiten,
Fahrzeuge, Meldungen und die Lageberichte-Liste haben keinen Druck, ohne dass gesagt ist, warum.
(UI/UX-Analyse 12.11.2026, LLH-1813.)

## What Changes

- **Ein Wortlaut nach Wirkung.** „Drucken / als PDF“ öffnet immer sofort den Druckdialog des
  Browsers. „Druckansicht“ öffnet immer eine eigene Druckseite. Druckt diese ein anderes Dokument
  als die Seite, auf der der Einstieg steht, steht das Dokument davor:
  „Einsatzbericht – Druckansicht“, „Registrierliste – Druckansicht“.
  - ETB, Betroffene, Tiere, Schäden: „Drucken / als PDF“ → „Druckansicht“.
  - Einsatzdaten und Sprungpalette: „Einsatzbericht drucken“ → „Einsatzbericht – Druckansicht“.
  - Schichtplan (Ablösung) und Planung: „Drucken“ → „Druckansicht“.
  - Registrierliste: „Registrierliste drucken“ → „Registrierliste – Druckansicht“.
  - Person und Auftrag behalten „Druckansicht“; alle Druckseiten behalten „Drucken / als PDF“.
- **Ein Platz.** Was die ganze Seite druckt, steht als Nebenweg im Seitenkopf (ab `md` ein
  sekundärer Knopf, darunter im Menü „Weitere“). Neu dorthin: Meldebild (Kräfteübersicht),
  Funkplan, Kommunikationsplan, Organigramm der Einsatzabschnitte, Schichtplan und Planung (dort
  mit „Excel“). Was ein einzelnes Objekt in der Seite druckt, steht im Kopf dieses Objekts:
  Auftrag im Kopf seines Detailpaneels statt unten, Registrierliste im Kopf des Paneels
  „Registrierung“.
- **Bewusst ohne Druck:** Einheiten und Fahrzeuge (stehen samt Besatzung im Druck des
  Meldebilds), Meldungen (stehen im ETB), Lageberichte-Liste (jeder Lagebericht druckt sich auf
  seiner Seite). Die Hilfe nennt diese Wege.
- **Regel festschreiben:** `frontend/src/druck/AGENTS.md` und `frontend/AGENTS.md` (Nebenwege)
  tragen Wortlaut und Platz; der Satz „Kräfteübersicht, Funkplan und Kommunikationsplan tragen
  keinen Nebenweg im Kopf“ entfällt.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `druck-dokumente`: neue Anforderungen „Druckeinstiege heißen nach ihrer Wirkung“, „Druckeinstiege
  stehen im Kopf“ und „Module ohne eigenen Druck“.
- `etb-druck`: Einstieg und Ausschluss der Systemeinträge nennen „Druckansicht“.
- `modul-listen-druck`: Einstieg heißt „Druckansicht“.
- `einsatzbericht`: Einstieg heißt „Einsatzbericht – Druckansicht“.
- `auftraege-befehle`: „Druckansicht“ steht im Kopf des Auftragsdetails.
- `kraefte-schichtplan`: Einstieg „Druckansicht“ im Seitenkopf der Ansicht Schichtplan.
- `vorplanung`: Reiter „Plan“ bietet „Druckansicht“ und „Excel“ im Seitenkopf.
- `betreuung-registrierung`: Einstieg heißt „Registrierliste – Druckansicht“ und steht im Kopf des
  Paneels, an der Stabsoberfläche und am Gerät.
- `einsatztauglichkeit-layout`: Szenarien der Nebenwege nennen „Druckansicht“.

## Impact

- Frontend: `components/druck/useDruckNebenwege.ts` (synchrones Vorbereiten wie `DruckKnopf`),
  `pages/{Etb,Personen,Tiere,Schaeden,Einsatzdaten,Kraefteuebersicht,Funkplan,Kommunikationsplan,
  Einsatzabschnitte,Abloesung}Page.tsx`, `pages/einsatzabschnitte/Organigramm.tsx`,
  `auftraege/AuftragDetail.tsx`, `abloesung/schichtplan/ausgabe/SchichtplanAusgabeKnoepfe.tsx`,
  `planung/PlanungPage.tsx`/`PlanungSchichtplan.tsx`,
  `betreuung/registrierung/RegistrierungPaneel.tsx`, `command-palette/befehle.ts`.
- Tests: Unit-Tests der Seiten und e2e-Specs, die die alten Wörter oder Plätze suchen
  (`etb-druck`, `modul-listen-druck`, `einsatzbericht-druck`, `auftrag-druck`,
  `funkplan-druck`, `fuehrungsorganisation-druck`, `meldebild-druck`, `schichtplan-druck`,
  `registrierliste-druck`, `betroffene-handy`, Bildlauf `doku-bilder`).
- Doku: `docs/anwender/kapitel/drucken-export.md` und die Modulkapitel mit Druckweg, betroffene
  Bilder neu.
- Kein Backend, keine API, keine Migration.
