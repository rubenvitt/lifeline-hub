# Proposal

## Why

Der Demo-Import (LFH-690) legt echte Stammdaten an: Fahrzeuge, Personal und Material,
markiert in `demo_herkunft`. Diese Marke sieht heute niemand. In den Stammdaten-Katalogen
der Verwaltung und in den Dispositions-Auswahllisten eines Einsatzes steht ein
Demo-Fahrzeug wie jedes andere. Wer einen echten Einsatz führt, kann es deshalb unbemerkt
disponieren. Das Entfernen fängt den Fall zwar ab (LFH-690, D7: die Zeile bleibt stehen,
verliert die Marke und zählt als „behalten“), die Verwechslung selbst verhindert es aber
nicht. LFH-690 hat die sichtbare Marke ausdrücklich als Non-Goal und Nachzug gesetzt
(LFH-733).

## What Changes

- **Backend:** `FahrzeugAnzeige`, `PersonalAnzeige` und `MaterialAnzeige` bekommen ein
  Pflichtfeld `demo: bool`. Es ist `true`, solange die Zeile in `demo_herkunft` steht. Es
  wird beim Lesen aus der Marke abgeleitet (keine neue Spalte, keine Migration) und gilt
  für die Liste und die Antworten von Anlegen, Ändern und Dienststatuswechsel.
- **Verwaltung:** Die Kataloge Fahrzeuge, Personal und Material zeigen neben der Kennung
  (Funkrufname bzw. Name bzw. Bezeichnung) eine Marke „Demo“. Ihr Wortlaut trägt die
  Bedeutung, ein Rahmen ist der zweite Kanal (WCAG 1.4.1). Dieselbe Marke steht im Kopf der
  Detailseiten von Fahrzeug und Personal.
- **Einsatz-Auswahllisten:** Demo-Stammdaten werden in den drei Dispositions-Auswahllisten
  (Fahrzeug, Personal, Material) **gekennzeichnet, nicht ausgeblendet**. Der Eintrag
  trägt das Wort „Demo“ im Wortlaut der Option, ist danach suchbar und steht am Ende der
  Liste. Die Kennzeichnung gilt in jedem Einsatz, auch im Demo-Einsatz selbst.
- Nach dem Entfernen trägt eine „behaltene“ Zeile keine Marke mehr. Sie erscheint danach
  ohne „Demo“, ohne weitere Regel.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `demo-daten`: neue Anforderung „Sichtbare Demo-Marke an Stammdaten“. Sie umfasst das Feld
  im Lese-Vertrag, die Marke in den Katalogen und auf den Detailseiten sowie die
  Kennzeichnung samt Sortierung in den Dispositions-Auswahllisten.

## Impact

- **Backend:** `src/fahrzeug/{mod,repo}.rs`, `src/personal/{mod,repo}.rs`,
  `src/material/{mod,repo}.rs` (abgeleitete Spalte in `SPALTEN`, Feld in `FromRow` und
  `*Anzeige`). Keine Route und kein Rechtepfad ändert sich, keine Migration.
- **Vertrag:** `frontend/src/api/openapi.json` und `frontend/src/api/types.generated.ts`
  neu erzeugt (`scripts/check-typ-codegen.sh`). Das Feld ist additiv, kein Breaking Change.
  Test-Fixtures mit vollständigen `Fahrzeug`/`Personal`/`Material`-Objekten brauchen das neue
  Pflichtfeld.
- **Frontend:** `stammdaten/{Fahrzeuge,Personal,Material}Tab.tsx`,
  `stammdaten/{Fahrzeug,Personal}DetailPage.tsx`, `pages/{Fahrzeuge,Personal,Material}Page.tsx`,
  eine geteilte Marke samt Darstellung in `theme/statusFarben.ts`.
- **Nicht betroffen:** Demo-Import und Entfernen, Offline-Lagebild, Druck, die
  Dispositionstabellen im Einsatz (s. design.md, Non-Goals).
