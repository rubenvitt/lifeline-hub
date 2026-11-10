## Why

Die gegliederten Dokumente (Lagebericht, Befehl) sind die letzte große Schreibfläche ohne
Kontextmenü (LLH-1590, Stufe 3). Ein Abschnitt hat heute keine Aktion außer dem Sprung aus der
Gliederung. Den Text eines Abschnitts weitergeben, ihn gesetzt ansehen oder neu beginnen geht
nur über Umwege: markieren und kopieren, Umschalter oben, alles markieren und löschen.

Die Abschnitte stehen fest in der Vorlage der Art (Reihenfolge und Schlüssel, Spec
`dokument-entwurf`). Umordnen, Einrücken und Entfernen, wie in der Aufgabe vorgeschlagen, setzen
ein neues Datenmodell voraus und gehören nicht hierher (abgestimmt mit Ruben am 09.11.2026).

Zunder: https://zunder.rubeen.dev/#/aufgabe/amp1au76496lxigr9gaux4rn (LLH-1601, Eltern LLH-1590)

## What Changes

- **⋮ im Abschnittskopf:** Jeder Abschnitt im Bearbeiten bekommt ein gebündeltes Menü mit
  „Text kopieren“, „In der Lesefassung zeigen“ und, rot hinter einem Trenner, „Abschnitt leeren“.
  Das sind drei Aktionen, also gebündelt (Regel ab drei, `frontend/AGENTS.md`).
- **Text kopieren:** Legt den Text des Abschnitts so, wie er im Feld steht, in die
  Zwischenablage und meldet Erfolg oder Fehlschlag. Bei leerem Abschnitt oder ohne Zwischenablage
  ist der Eintrag gesperrt.
- **In der Lesefassung zeigen:** Schaltet das Dokument auf die Lesefassung und rollt zu diesem
  Abschnitt.
- **Abschnitt leeren:** Erst nach einer Rückfrage im Dialog. Wirkt wie Löschen von Hand: Die
  Leer-Marke folgt, der Verlustschutz zählt es als ungespeicherte Änderung, und im Lagebericht
  verliert der Abschnitt seinen Stand der Übernahme.
- **Kontextmenü:** Rechtsklick, langer Druck und Kontextmenü-Taste/Umschalt+F10 öffnen auf einem
  Gliederungseintrag „Zum Abschnitt springen“ und darunter dieselben Einträge. Auf dem
  Abschnittskopf öffnen sie dieselben Einträge wie das ⋮. Im Textfeld bleibt das Browsermenü.
- **Nicht in dieser Change:** Umordnen, Einrücken und Entfernen von Abschnitten. Die Übernahme
  aus Lagedaten bleibt Knopf im Kopf und kommt nicht ins Menü. Die Lesefassung außerhalb des
  Entwurfs (freigegebene Dokumente) bekommt kein Menü.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `dokument-entwurf`: Ein Abschnitt trägt gebündelte Aktionen (Kopieren, Lesefassung, Leeren)
  im Kopf, und Gliederung und Kopf öffnen sie als Kontextmenü.

Die Regeln des Kontextmenüs selbst (Browsermenü auf Link, Eingabefeld und markiertem Text,
langer Druck, Tasten, Fokusrückgabe) stehen schon in `datensatz-aktionsmenue` und gelten
unverändert.

## Impact

- `frontend/src/entwurf/DokumentEntwurf.tsx` und `dokumentEntwurfKern.ts` (Einträge als reine
  Funktion), Tests dazu.
- `pages/LageberichtDetailPage.tsx`, `pages/BefehlDetailPage.tsx`: kein neuer Pflichtweg, solange
  das Leeren über das Feld läuft (Design D2); geprüft per Test.
- `frontend/src/entwurf/AGENTS.md`, Kapitel `docs/anwender/kapitel/lageberichte.md` und
  `auftraege-befehle.md` (Mitänderungsregel), e2e im Browser.
- Kein Backend, keine Migration, kein neues Wire-Feld.
