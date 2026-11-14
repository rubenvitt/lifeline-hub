# Spec Delta

## ADDED Requirements

### Requirement: Ein PR prüft nur leicht
Ein Push auf einen offenen Pull Request gegen `alpha`, `beta` oder `main` MUST die Schnellprüfungen starten. Ohne das Label `voll` MUST er weder die Rust-, die Frontend- noch die e2e-Suite starten. Pflicht für das Mergen MUST nur sein: `Schnellprüfungen`, `Migrationsnummern`, `ADR-Nummern` und `Baut mit Ziel-Branch`.

#### Scenario: PR ohne Label
- **WHEN** auf einen PR ohne Label `voll` ein Commit gepusht wird, der Backend- und Frontend-Code ändert
- **THEN** laufen die Schnellprüfungen, und kein Job fährt die Rust-, Frontend- oder e2e-Suite

#### Scenario: Mergebar ohne Suiten
- **WHEN** an einem PR mit Auto-Merge `Schnellprüfungen`, `Migrationsnummern`, `ADR-Nummern` und `Baut mit Ziel-Branch` grün sind
- **THEN** ist er mergebar, ohne dass eine schwere Suite auf ihm lief

### Requirement: Das Label `voll` fährt alle Suiten im PR
Trägt ein PR das Label `voll`, MUST jeder Push auf ihn und das Setzen des Labels die Rust-, Frontend- und e2e-Suite ganz starten, ohne Auswahl nach geänderten Dateien. Ihre Ergebnisse MUST NOT Pflicht für das Mergen sein. Ein anderes Label MUST keine schwere Suite starten und keinen laufenden Lauf abbrechen.

#### Scenario: Label gesetzt
- **WHEN** ein PR das Label `voll` bekommt
- **THEN** laufen auf seinem Kopf-Commit Schnellprüfungen, Rust-, Frontend- und e2e-Suite

#### Scenario: Rote Suite mit Label
- **WHEN** an einem PR mit Label `voll` die Frontend-Suite rot ist und die Pflicht-Checks grün sind
- **THEN** ist der PR trotzdem mergebar, und die rote Suite steht sichtbar am PR

#### Scenario: Anderes Label
- **WHEN** ein PR ein anderes Label als `voll` bekommt, auch während seine Suiten wegen `voll` laufen
- **THEN** startet keine schwere Suite neu, und ein laufender Lauf läuft weiter

### Requirement: Ein PR ist fertig, wenn Auto-Merge an ist
Ein offener PR MUST als fertig gelten, solange Auto-Merge eingeschaltet ist. Labels, Kommentare und Reviews MUST daran nichts ändern.

#### Scenario: Auto-Merge eingeschaltet
- **WHEN** an einem PR Auto-Merge eingeschaltet wird
- **THEN** gilt er als fertig, und `Baut mit Ziel-Branch` rechnet

#### Scenario: Label ohne Auto-Merge
- **WHEN** ein PR ohne Auto-Merge das Label `voll` oder `e2e` trägt
- **THEN** gilt er nicht als fertig

### Requirement: Ein neuer Push auf einen Kanal-Branch bricht die Tests des laufenden Laufs ab
Ein Push auf `alpha`, `beta` oder `main` MUST die Testjobs (Rust-, Frontend-, e2e-Suite) eines noch laufenden Laufs auf demselben Branch abbrechen. Ein Release-Job, der schon läuft, MUST NOT abbrechen. Ein Release MUST nur aus einem Lauf entstehen, dessen Schnellprüfungen und Suiten alle grün sind.

#### Scenario: Zwei Merges kurz hintereinander
- **WHEN** während des Laufs zu Merge A auf `alpha` Merge B landet
- **THEN** brechen die Testjobs zu A ab, die zu B laufen voll, und ein Release kommt nur aus dem Lauf zu B

#### Scenario: Release läuft schon
- **WHEN** im Lauf zu A der Release-Job schon läuft und Merge B landet
- **THEN** läuft der Release zu A zu Ende, und der Release zu B wartet auf ihn

## MODIFIED Requirements

### Requirement: Kanal-Branches prüfen immer voll
Ein Push auf `alpha`, `beta` oder `main` MUST alle Suiten einschließlich e2e voll fahren, unabhängig von Auto-Merge, Labels und geänderten Dateien. Der Release-Job MUST auf alle vier Prüfjobs (Schnellprüfungen, Rust, Frontend, e2e) dieses Laufs warten und MUST entfallen, wenn einer davon abgebrochen wurde.

#### Scenario: Merge auf alpha
- **WHEN** ein PR auf `alpha` gemergt wird
- **THEN** laufen auf dem Merge-Commit Schnellprüfungen, Rust-, Frontend- und e2e-Suite, und ein Release entsteht nur, wenn alle grün sind

### Requirement: Ein fertiger PR muss mit dem aktuellen Ziel-Branch bauen
Ein fertiger PR MUST den Pflicht-Check `Baut mit Ziel-Branch` tragen. Er MUST den Kopf-Commit des
PRs mit dem aktuellen Stand des Ziel-Branches zusammenführen und das Ergebnis kompilieren: das
Backend mit allen Testzielen und das Frontend per Typprüfung. Grün ist er nur, wenn beides
kompiliert. Solange der PR nicht fertig ist, MUST der Check auf dem Kopf-Commit fehlen oder warten.

#### Scenario: Zwei PRs, einzeln grün, zusammen kein Build
- **WHEN** PR A die Signatur einer Funktion ändert und gemergt wird, und PR B mit Auto-Merge einen Test enthält, der die alte Signatur aufruft
- **THEN** ist `Baut mit Ziel-Branch` an PR B rot, und PR B mergt nicht

#### Scenario: Nur das Frontend bricht
- **WHEN** ein fertiger PR einen Typ verwendet, den ein inzwischen auf dem Ziel-Branch gemergter PR umbenannt hat
- **THEN** ist `Baut mit Ziel-Branch` rot

#### Scenario: PR in Arbeit
- **WHEN** ein PR ohne Auto-Merge ist und auf ihn gepusht wird
- **THEN** kompiliert der Check nicht, und der PR ist nicht mergebar

#### Scenario: Konflikt mit dem Ziel-Branch
- **WHEN** sich ein fertiger PR nicht konfliktfrei mit dem Ziel-Branch zusammenführen lässt
- **THEN** ist der Check rot und nennt den Konflikt als Grund

## REMOVED Requirements

### Requirement: Jeder Push auf einen PR prüft die erste Stufe
**Reason**: Im PR laufen keine schweren Suiten mehr (LLH-1889, Ruben 14.11.2026).
**Migration**: „Ein PR prüft nur leicht“ und „Das Label `voll` fährt alle Suiten im PR“.

### Requirement: Ein PR ist fertig, wenn Auto-Merge an ist oder das Label `e2e` trägt
**Reason**: Das Label `e2e` entfällt mit der zweiten Stufe.
**Migration**: „Ein PR ist fertig, wenn Auto-Merge an ist“. Wer Testrückmeldung im PR will, setzt `voll`.

### Requirement: Ein fertiger PR fährt die zweite Stufe auf seinem Kopf-Commit
**Reason**: Die zweite Stufe entfällt, e2e läuft auf Kanal-Branches und mit `voll`.
**Migration**: Label `voll`, oder der Lauf auf `alpha` nach dem Merge.

### Requirement: Vor der zweiten Stufe fehlen ihre Pflicht-Checks
**Reason**: Die e2e-Checks sind keine Pflicht mehr.
**Migration**: Ruleset 17017911 ohne `e2e-Binary` und `e2e 1/4`–`4/4`.

### Requirement: Wer die Markierung zurücknimmt, beendet die zweite Stufe
**Reason**: Die zweite Stufe entfällt.
**Migration**: Keine.
