## ADDED Requirements

### Requirement: Gefahrengebiet zeichnen aus der Palette
Die Sprungpalette SHALL im Einsatz die Schnellaktion „Gefahrengebiet zeichnen“ anbieten. Ausgeführt
MUST sie auf die Lagekarte dieses Einsatzes springen und dort den Zeichenmodus für ein
Gefahrengebiet betreten. Die Zeile MUST nur erscheinen, wenn die Person im Einsatz schreiben darf
und die Lagekarte für sie freigegeben ist; auf die Freigabe des Moduls Gefahren MUST sie nicht
warten, weil das Zeichnen auf der Lagekarte geschieht. Sie MUST wie jede Schnellaktion im neuen Tab
öffnen können. Die bestehenden Schnellaktionen MUST ihre Reihenfolge behalten; die neue Zeile steht
hinter ihnen.

Jede Schnellaktion MUST auf eine Seite ihres Trägermoduls zeigen, die den Auftrag ihres Ziels
wirklich liest: eine Erfassungsaktion den Auftrag `neu=1`, eine Zeichen-Aktion den Auftrag
`zeichnen`. Eine Zeile, deren Zielseite den Auftrag nicht liest, MUST es nicht geben.

#### Scenario: Zeile ausführen
- **WHEN** eine Person mit Schreibrecht im Einsatz „Gefahrengebiet zeichnen“ wählt
- **THEN** zeigt die Lagekarte des Einsatzes den Zeichenmodus für ein Gefahrengebiet

#### Scenario: Ohne Schreibrecht
- **WHEN** eine beobachtende Person oder ein abgeschlossener Einsatz die Palette öffnet
- **THEN** fehlt die Zeile „Gefahrengebiet zeichnen“

#### Scenario: Lagekarte nicht freigegeben
- **WHEN** die Lagekarte im Einsatz nicht freigegeben ist
- **THEN** fehlt die Zeile „Gefahrengebiet zeichnen“

#### Scenario: Gefahren-Modul nicht freigegeben
- **WHEN** die Lagekarte freigegeben ist, das Modul Gefahren aber nicht
- **THEN** erscheint die Zeile „Gefahrengebiet zeichnen“

#### Scenario: Im neuen Tab
- **WHEN** die Zeile mit Strg/⌘+↵ ausgeführt wird
- **THEN** öffnet ein neuer Tab die Lagekarte im Zeichenmodus für ein Gefahrengebiet

#### Scenario: Reihenfolge der Schnellaktionen
- **WHEN** alle Schnellaktionen angeboten werden
- **THEN** stehen die bisherigen Zeilen in unveränderter Folge vorn und „Gefahrengebiet zeichnen“ dahinter
