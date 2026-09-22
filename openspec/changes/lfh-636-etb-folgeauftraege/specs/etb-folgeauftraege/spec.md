# Spec Delta

## Purpose

Ein Eintrag im Einsatztagebuch weist die Aufträge aus, die aus ihm erteilt wurden, damit
die Führung von einer Entscheidung direkt zu deren Umsetzung springen und im Überblick
sehen kann, wie viele Aufträge eine Entscheidung ausgelöst hat.

## ADDED Requirements

### Requirement: ETB-Eintrag führt seine Folgeaufträge auf dem Wire
Jede API-Antwort, die einen ETB-Eintrag ausliefert (Liste, Einzelladen, Antwort auf das
Erfassen), SHALL das Feld `folgeauftraege` tragen: die Liste aller Aufträge, deren
Quell-Eintrag dieser Eintrag ist, je Auftrag mit `id` und `lfd_nr` (die `lfd_nr` darf bei
Altbeständen fehlen). Die Liste SHALL nach laufender Nummer aufsteigend geordnet sein und
SHALL leer (nicht fehlend) sein, wenn kein Folgeauftrag existiert. Das Feld SHALL
unabhängig vom Typ des Eintrags und vom Bearbeitungsstatus der Aufträge befüllt werden.

#### Scenario: Eintrag ohne Folgeauftrag
- **WHEN** ein ETB-Eintrag abgefragt wird, aus dem kein Auftrag erteilt wurde
- **THEN** trägt er `folgeauftraege: []`

#### Scenario: Zwei Aufträge aus einer Entscheidung
- **WHEN** aus einem Entscheidungs-Eintrag zwei Aufträge erteilt wurden und die ETB-Liste abgefragt wird
- **THEN** trägt genau dieser Eintrag beide Aufträge mit `id` und `lfd_nr`, aufsteigend nach `lfd_nr`
- **AND** die vom Auftrag selbst erzeugten Anordnungs-Einträge tragen keinen Folgeauftrag

#### Scenario: Abgeschlossener Auftrag zählt weiter
- **WHEN** ein Folgeauftrag abgenommen ist
- **THEN** steht er weiter in `folgeauftraege` seines Quell-Eintrags

#### Scenario: Seitenweise Abfrage
- **WHEN** die ETB-Liste mit Cursor und Limit abgefragt wird
- **THEN** trägt jeder Eintrag der Seite seine vollständigen Folgeaufträge, auch wenn der Auftrag nach dem Eintrag auf einer anderen Seite angelegt wurde

### Requirement: Zeitachse verweist auf jeden Folgeauftrag einzeln
Die ETB-Zeitachse SHALL in der Hinweiszeile eines Eintrags je Folgeauftrag einen Verweis
zeigen, der auf die Auftragsliste mit diesem Auftrag selektiert führt. Die Beschriftung
SHALL „Folgeauftrag Nr. <lfd_nr>" lauten, bei fehlender Nummer „Folgeauftrag"; das
Pfeilzeichen ↗ SHALL nicht Teil des zugänglichen Namens sein. Die Beschriftung SHALL sich
vom bestehenden Rückverweis „Auftrag" (Eintrag wurde von einem Auftrag erzeugt)
unterscheiden. Ohne Folgeauftrag SHALL kein Verweis erscheinen.

#### Scenario: Ein Folgeauftrag
- **WHEN** ein Eintrag einen Folgeauftrag mit `lfd_nr` 12 trägt
- **THEN** zeigt seine Hinweiszeile einen Link „Folgeauftrag Nr. 12" auf die Auftragsliste mit `?auftrag=<id>`

#### Scenario: Mehrere Folgeaufträge
- **WHEN** ein Eintrag drei Folgeaufträge trägt
- **THEN** zeigt seine Hinweiszeile drei Links mit drei verschiedenen zugänglichen Namen

#### Scenario: Kein Folgeauftrag
- **WHEN** ein Eintrag keinen Folgeauftrag trägt
- **THEN** enthält seine Hinweiszeile keinen Folgeauftrag-Verweis

### Requirement: Überblick zählt Folgeaufträge aus dem ETB-Eintrag
Die Liste „Entscheidungen" im Einsatz-Überblick SHALL die Zahl der Folgeaufträge je
Entscheidung aus dem ETB-Eintrag selbst lesen („1 Auftrag" / „<n> Aufträge", nichts bei
null). Die Zahl SHALL auch dann erscheinen, wenn die Auftragsliste für den Nutzer nicht
abrufbar ist.

#### Scenario: Auftragsliste nicht abrufbar
- **WHEN** die Auftragsliste mit einem Fehler antwortet und eine Entscheidung zwei Folgeaufträge trägt
- **THEN** zeigt der Überblick an dieser Entscheidung „2 Aufträge"
- **AND** kein Hinweis „Folgeaufträge werden nicht gezählt" erscheint
