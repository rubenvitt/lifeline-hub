# Spec Delta

## MODIFIED Requirements

### Requirement: Ein Baustein für alle gegliederten Dokumente

Lagebericht und Befehl SHALL ihren Entwurf über denselben Baustein schreiben: ein Paneel „Entwurf“ mit dem Füllstand („n/m Abschnitte“), einem Kopfblock mit den Feldern der
Seite (Titel, Zeitstand, Verteiler, soweit die Art sie hat), einer Gliederung und allen Abschnitten.
Keine dieser Seiten MUST eine eigene Abschnittsmechanik (Akkordeon, Reiter, Vorschau-Spalte je
Abschnitt) daneben tragen.

#### Scenario: Gleiche Bedienung
- **WHEN** eine Person mit Schreibrecht einen Lagebericht- oder Befehlsentwurf öffnet
- **THEN** stehen Gliederung, Umschalter „Bearbeiten | Lesefassung“ und die Abschnitte in
  derselben Anordnung und Bedienung

## REMOVED Requirements

### Requirement: Rückfrage vor dem Verlassen eines Entwurfs
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Die Pressemitteilung ist keine Dokumentart mehr; das Szenario „Pressemitteilung über die Brotkrume verlassen“ hätte keinen Gegenstand, und OpenSpec erlaubt nicht, es in einem MODIFIED-Block wegzulassen.
**Migration**: Die Rückfrage gilt unverändert für Lagebericht und Befehl unter „Rückfrage vor dem Verlassen eines Lagebericht- oder Befehlsentwurfs“.

## ADDED Requirements

### Requirement: Rückfrage vor dem Verlassen eines Lagebericht- oder Befehlsentwurfs

Hat ein Lagebericht- oder Befehlsentwurf eine ungespeicherte Fassung und die Person Schreibrecht, SHALL jeder Wechsel auf einen anderen Pfad in der App (Brotkrume, Seitenmenü,
Link, Browser-Zurück) angehalten werden. Beide Seiten SHALL dieselbe Rückfrage „Ungespeicherte
Änderungen“ mit „Verwerfen“, „Bleiben“ und „Speichern und weiter“ zeigen. „Speichern und weiter“
MUST erst nach gelungenem Speichern wechseln. Ohne ungespeicherte Fassung MUST NOT nachgefragt
werden.

#### Scenario: Lagebericht über die Brotkrume verlassen
- **WHEN** eine Person im Lagebericht-Entwurf den Titel ändert und vor dem Speichern
  „Lageberichte“ in der Brotkrume wählt
- **THEN** erscheint die Rückfrage „Ungespeicherte Änderungen“ wie im Befehl, und nach „Bleiben“
  steht die Eingabe unverändert im Feld

#### Scenario: Speichern und weiter ohne Titel
- **WHEN** der Titel des Entwurfs leer ist und in der Rückfrage „Speichern und weiter“ gewählt wird
- **THEN** steht der Feldfehler am Titel, und die Seite bleibt beim Entwurf

#### Scenario: Speichern und weiter scheitert
- **WHEN** in der Rückfrage „Speichern und weiter“ gewählt wird und der Server das Speichern
  ablehnt
- **THEN** steht der Grund im Dialog, und die Seite bleibt beim Entwurf

#### Scenario: Autosave während der Rückfrage
- **WHEN** die Rückfrage offen steht und der Autosave die Fassung sichert
- **THEN** folgt der angehaltene Wechsel ohne weiteren Klick

#### Scenario: Ohne offene Fassung
- **WHEN** ein unveränderter Entwurf oder ein freigegebenes Dokument verlassen wird, oder sich nur
  Suchparameter oder Anker ändern
- **THEN** erscheint keine Rückfrage
