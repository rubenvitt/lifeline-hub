# Proposal

## Why

Im Einsatz ändert man an einem Abschnitt meist eine einzige Angabe: den Lagezustand, den
Abschnittsleiter bei einer Ablösung, die Sprechgruppe. Heute öffnet „Bearbeiten“ dafür ein
Formular mit elf Feldern. Ruben am 10.10.: „Das geht nicht. ‚Fortschritt‘ ist unwichtig.“
Das Formular hat außerdem einen Fehler. Es schickt beim Speichern den ganzen Stand vom Öffnen
mit und überschreibt so still, was ein anderer Arbeitsplatz oder die Fernmeldeskizze
inzwischen am Abschnitt geändert hat. Die Einsatzdaten haben denselben Fehler mit LFH-839
behoben.

## What Changes

- **Detail = Ansicht und Bearbeitung.** Im Detailpaneel der Seite Einsatzabschnitte wird jede
  Angabe an ihrem Wert bearbeitet: Name (Pflicht), Kurzbezeichnung, Über-Abschnitt,
  Abschnittsleiter, Abschnittsauftrag, Sprechgruppen, Kommunikationsmittel,
  Erreichbarkeit / Nummer und Bemerkung. Ein Speichern schickt genau das eine geänderte Feld.
  Ein Fehler steht an der Zeile.
- **Lagezustand mit einem Klick.** Eine Segmentleiste am Wert bietet „nicht beurteilt“,
  „planmäßig“, „angespannt“ und „kritisch“, jeweils als Wort mit Farbpunkt. Der Wechsel speichert
  sofort. Wie bisher schreibt nur ein Wechsel einen System-Eintrag ins ETB.
- **Kein „Bearbeiten“, kein Langformular** mehr im Detail. „Auflösen“ bleibt rot, abgesetzt und
  mit Rückfrage.
- **Anlegen als kurze Erfassung.** „Abschnitt anlegen“ (Kopfknopf, Leerzustand, Sprungpalette
  `?neu=1`) öffnet ein Erfassungsmodal mit Name, Kurzbezeichnung und Über-Abschnitt. Danach ist
  der neue Abschnitt im Detail gewählt und wird dort ergänzt. Der lokale Entwurf in der
  Gliederung („Neuer Abschnitt (ungespeichert)“) entfällt.
- **Fortschritt entfällt in der Oberfläche**, also in Erfassung, Detail, Abschnittsvorschau der
  Sprungpalette, Funktionsansicht Einsatzabschnitt und Führungsüberblick. Spalte und API bleiben
  für Altdaten; das Frontend schreibt den Wert nicht mehr.
- Regeln in `frontend/AGENTS.md` (Lagezustand/Fortschritt, „Abschnitt anlegen ist ein lokaler
  Entwurf“) und das Anwenderkapitel `docs/anwender/kapitel/einsatzabschnitte.md` samt Bildern
  werden fortgeschrieben.

## Capabilities

### New Capabilities

- `einsatzabschnitt-bearbeitung`: wie ein Einsatzabschnitt auf der Seite Einsatzabschnitte
  angelegt, an seinen Angaben geändert und aufgelöst wird. Dazu gehören das Bearbeiten in der
  Ansicht, der Teil-Patch je Angabe, der Lagezustand mit einem Klick, das kurze Anlegen und der
  Wegfall des Fortschritts in der Oberfläche.

### Modified Capabilities

(keine — `fuehrungsorganisation`, `lage-verdichtung`, `sprungpalette` und `funktionsansichten`
nennen den Fortschritt nicht und behalten ihre Anforderungen. Die Schnellaktion „Einsatzabschnitt
anlegen“ liest weiter `neu=1`, öffnet jetzt aber das Erfassungsmodal.)

## Impact

- **Frontend:** `pages/EinsatzabschnittePage.tsx` (Formular und Entwurf entfallen; neues
  Detail und neues Anlegen-Modal unter `pages/einsatzabschnitte/`),
  `pages/einsatzabschnitte/AbschnittDaten.tsx` (ohne Fortschritt),
  `pages/fuehrung/UeberblickPage.tsx` und `pages/fuehrung/ueberblickDaten.ts` (Balken und Feld
  entfallen), `api/einsatzabschnitte.ts` (`aktualisiereAbschnitt` hat keinen Aufrufer mehr und
  entfällt), Tests daneben.
- **Regeln:** `frontend/AGENTS.md` (Farbachse Lagezustand, Formularseiten).
- **e2e und Doku:** `e2e/doku-bilder/einsatzabschnitte.bilder.ts`, die Prüfflächen C12 in
  `e2e/trefflaeche-pruefflaechen.spec.ts`, eine neue e2e für die Bedienwege in `kompakt` und
  `handschuh`, das Kapitel `docs/anwender/kapitel/einsatzabschnitte.md` und seine Bilder.
- **Backend:** keine Änderung, keine Migration, kein Typ-Codegen. `fortschritt` bleibt in
  Tabelle, DTO und PATCH.
