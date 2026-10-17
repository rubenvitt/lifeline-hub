# Proposal

## Why

Rubens App-Durchgang vom 10.10.2026 (Zunder LLH-1017) hat im Einsatztagebuch sechs Brüche
gezeigt, die im Einsatz Aufmerksamkeit kosten oder ein unvollständiges Bild für vollständig
halten lassen. Erfasst wird unten, der eigene Eintrag erscheint oben. Filter stehen an drei Orten.
Ein aktiver Filter ist kaum zu sehen. Ein berichtigter Eintrag sieht unter Filter wie gültig aus.
Systemeinträge überdecken die Handeinträge, und Zeiten einzutragen ist mühsam. Die acht
Untertickets liegen in denselben Dateien und derselben Fähigkeit. Deshalb kommen sie als eine
Change mit einer gemeinsamen Leserichtung.

## What Changes

- **Funkprotokoll-Ordnung (LLH-1149):** ETB-Zeitachse und Informationstelefon zeigen die älteste
  Zeile oben und die neueste direkt über der Erfassung. Beim Öffnen steht die Seite am Ende. Steht
  die Seite am Ende, läuft sie neuen Einträgen nach; wer hochgerollt hat, bekommt unten das
  Sammelbanner „N neue Einträge ↓“. „Ältere laden“ steht oben, „Neuere laden“ unten. Die
  Lesemarke wird eine Trennlinie in der Achse. Serverordnung und Cursor bleiben gleich.
  **BREAKING** (Bedienung): Die Leserichtung beider Seiten dreht sich um.
- **Eine Filterleiste (LLH-1065):** Typ-Segmente, ein Umschaltknopf für Systemeinträge, Zeitraum,
  Einheit und Volltext stehen ab `md` in einer Leiste über der Zeitachse. Der Seitenkopf trägt
  keinen Filter mehr. Die Mehrzahl von „Lage“ heißt in Bilanz und Lageentwicklung
  „Lagefeststellungen“.
- **Zeitraum-Schnellwahl (LLH-1080):** Ein Bedienziel „Zeitraum“ ersetzt die Felder von/bis. Es
  bietet „Letzte Stunde“, „Letzte 4 Stunden“, „Seit letzter Lagebesprechung“, „Heute“ und einen
  eigenen Zeitraum im Zeiteingabe-Baustein. In der URL stehen immer absolute Grenzen.
- **Filterband (LLH-1071):** Ein neuer Baustein `Filterhinweis` steht bei jedem aktiven Filter
  direkt über der Erfassung: „Gefiltert · n von m Einträgen sichtbar“, die Merkmale und
  „Filter zurücksetzen“. Er nennt auch einen eigenen Eintrag außerhalb des Filters und Nachträge
  vor der Lagebesprechung.
- **Berichtigt-Kennzeichnung (LLH-1099):** Ein berichtigter Eintrag trägt in der Kopfzeile den
  Chip „berichtigt → Nr. n“, auch unter Filter und außerhalb des Fensters. Er liest dafür das
  Server-Feld `berichtigt_durch`. Eine Berichtigung lässt sich berichtigen.
- **Leise Systemeinträge (LLH-1106):** Systemeinträge stehen leiser, ohne „System → System“. Drei
  oder mehr direkt aufeinanderfolgende in einer Stundengruppe werden zu einer aufklappbaren Zeile
  gebündelt. Der Druck bündelt nie.
- **Typ in der Erfassung (LLH-1112):** Das Präfix zeigt das Typwort mit Typkante statt
  „/meldung“. „Werte behalten“ behält auch den Typ.
- **Nachtrag (LLH-1088):** `/zeit <Zeit>` am Zeilenanfang setzt die Ereigniszeit direkt.
  Ereigniszeiten in der Zukunft sperrt der Client. Der Nachtrag-Hinweis nennt bei Tageswechsel
  den Tag.

## Capabilities

### New Capabilities
- `etb-filterleiste`: eine Filterleiste und das Filterband des ETB. Sie sagt, wo der Filter steht,
  wie er sichtbar bleibt, was die Zeitraum-Schnellwahl in die URL schreibt und wie man ihn
  zurücksetzt.

### Modified Capabilities
- `etb-zeitachse-darstellung`: Leserichtung, Lesemarke als Trennlinie, Systemschalter als
  Umschaltknopf, leise und gebündelte Systemeinträge, Kennzeichnung „berichtigt“ unabhängig vom
  Fenster, Nachtrag-Hinweis mit Tag.
- `etb-zeitachse-fenster`: „Neuere laden“ unter den Zeilen, der eigene Eintrag steht unten,
  Zufluss und Mitlaufen am Ende.
- `stab-infotelefon`: Protokoll in derselben Leserichtung, „Ältere laden“ oben.
- `etb-schnellerfassung-tastatur`: Kurzeingabe `/zeit`, Sperre einer Ereigniszeit in der Zukunft,
  Typwort statt Slash-Präfix, „Werte behalten“ nimmt den Eintragstyp mit (das Szenario in
  `etb-anhaenge` bleibt richtig und unverändert).

## Impact

- **Frontend:** `pages/EtbPage.tsx`, `etb/` (Zeitachse, Zeitachsenmodell, Seitenfenster, Lesemarke,
  Filterleiste, Schnellerfassung, MetaChip, Entwürfe, Erfassungsmodell),
  `pages/InfotelefonPage.tsx`, `infotelefon/zufluss.ts`, `components/instrument/` (neu
  `Filterhinweis`, Variante der `Segmentleiste`, `Zeitachseneintrag` mit leiser Variante),
  `anzeige/` (neue reine Funktion für Zeitfenster), `theme/statusFarben.ts`. Dazu Vitest, e2e
  (`etb-chronologie`, `etb-zeilenhoehe`, `leisten-flaeche`, `etb-seitenfenster`,
  `fokus-verdeckung`, `palette-datensaetze`, `hinweis-kontrast`, Bilder-Specs).
- **Regeln:** `frontend/AGENTS.md` (Bausteinliste, Erfassungs-Norm „Werte behalten“),
  `frontend/src/etb/AGENTS.md`, `frontend/src/stab/AGENTS.md`.
- **Doku:** Kapitel `einsatztagebuch.md` und `presse-infotelefon.md` samt Bildern.
- **Kein Backend, keine Migration, kein Typ-Codegen.** Die Serverordnung, die Cursor und
  `berichtigt_durch` gibt es schon. Die Zukunftssperre bleibt im Client (LFH-895 D4 gilt weiter).
