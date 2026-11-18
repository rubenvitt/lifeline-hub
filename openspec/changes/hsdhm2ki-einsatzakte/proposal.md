# Proposal

## Why

Bei der Übergabe an die Einsatzleitung oder in der Nachbereitung braucht es das ganze
Einsatzgeschehen in einem Zug. Heute sind dafür mindestens drei getrennte Drucke nötig
(Einsatzbericht mit ETB nur als Entscheidungsauszug, ETB, Betroffenenliste), dazu der
CSV-Download der Betroffenen; Aufträge gibt es nur einzeln, Anhänge gar nicht gesammelt. Das
einzige Komplettarchiv ist die verschlüsselte SQLite-Kopie der Aufbewahrung, nur für den
Systemadmin und nicht lesbar (Zunder LLH-1835).

## What Changes

- Neue Druckansicht **„Einsatzakte“** je Einsatz (`/einsaetze/:id/einsatzdaten/akte`): ein
  Druckstück aus Kapiteln, jedes mit eigenem Druckkopf und auf neuer Seite — Einsatzbericht mit
  allen Anlagen (Kräfte, Einheiten mit Einsatzzeiten, Personal je Kopf, Materialverbrauch),
  vollständiges ETB, Betroffenenliste mit Namen, Auftragsliste, Einsatzbefehle und Lageberichte
  mit ihren Bildanlagen. Gespeichert wird über „Als PDF speichern“ im Druckdialog des Browsers.
- Neue kompakte **Auftragsliste** als Kapitel der Akte (alle Aufträge mit Nummer, Auftrag,
  Empfänger, Status und Zeiten), weil es bisher nur das Einzelblatt gibt.
- Neuer Download **„Anhänge und Tabellen (ZIP)“** auf derselben Seite:
  `GET /api/einsaetze/{id}/einsatzakte/anlagen.zip` mit allen Anhängen des Einsatzes als
  eigene Dateien (in der bereinigten Fassung des Einzel-Downloads), geordnet nach Modul und
  Datensatz, den vorhandenen Tabellen als CSV (Betroffene, Tiere, Schäden) und einem
  Inhaltsverzeichnis. Der Server schreibt den Abruf der Betroffenendaten und ihrer Anhänge ins
  Zugriffsprotokoll, bevor Daten ihn verlassen.
- **Rechte wie beim Einsatzbericht:** Akte und ZIP gibt es nur, wenn die Person jedes enthaltene
  Modul lesen darf (vollständig oder gar nicht); ein im Einsatz ausgeblendetes Modul steht als
  „nicht genutzt“ in der Akte. Die Akte steht jederzeit im Lesefenster des Einsatzes bereit, ein
  laufender Einsatz ist „vorläufig“.
- Einstieg „Einsatzakte“ auf der Seite Einsatzdaten neben „Einsatzbericht drucken“ und in der
  Sprungpalette.
- Anwenderdoku: Kapitel „Drucken und Export“ und „Einsatzabschluss“.

Ausdrücklich nicht: kein PDF auf dem Server (Spec `druck-dokumente`), keine Öffnung des
verschlüsselten Archivs der Aufbewahrung, keine Auswahl einzelner Kapitel in dieser Change.

## Capabilities

### New Capabilities

- `einsatzakte`: Sammeldruck „Einsatzakte“ eines Einsatzes und der ZIP-Download seiner Anhänge
  und Tabellen — Kapitel, Reihenfolge, Rechte, Vollständigkeit, Protokoll.

### Modified Capabilities

_keine_ — Einsatzbericht, ETB-Druck, Listendruck und Dokumentdruck bleiben unverändert; die Akte
nutzt ihre Bausteine.

## Impact

- **Frontend:** neue Seite `pages/EinsatzakteDruckPage.tsx` und Ordner `druck/einsatzakte/`
  (Kapitel, Freigabe, Abruf, Auftragsliste), Pfad in `routing/deeplinks.ts`, Route in `App.tsx`,
  Sprungpalette, Einstieg auf der Einsatzdaten-Seite, Query-Keys (nicht live), neue Druck-Spec in
  `DRUCK_SPECS`.
- **Backend:** neue Route in `src/app.rs`, Handler unter `src/routes/` (ZIP mit der vorhandenen
  `zip`-Crate, Lese-Gates je Modul), Zugriffsprotokoll für Betroffene, Integrationstests.
- **Doku:** `docs/anwender/kapitel/drucken-export.md`, `einsatzabschluss.md`.
