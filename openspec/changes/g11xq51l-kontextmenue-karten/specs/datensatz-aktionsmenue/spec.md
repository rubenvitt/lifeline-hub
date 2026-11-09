## MODIFIED Requirements

### Requirement: Kontextmenü und ⋮-Menü zeigen dieselben Aktionen

Das Kontextmenü SHALL zuerst die sichtbare Primäraktion des Datensatzes zeigen, danach die
Einträge seines ⋮-Menüs in derselben Reihenfolge, mit demselben Sperrzustand und derselben
Wirkung. Unumkehrbares MUST auch hier rot hinter genau einem Trenner stehen. Fragt die
Primäraktion als Knopf vor dem Auslösen nach, MUST sie es aus dem Kontextmenü im Dialog mit
demselben Titel und derselben Knopfbeschriftung tun.

#### Scenario: Primäraktion und gebündelte Aktionen
- **WHEN** eine Person mit Schreibrecht das Kontextmenü eines Dokuments öffnet, dessen Zeile die Primäraktion „Bearbeiten“ und im ⋮-Menü rot „Entfernen“ trägt
- **THEN** stehen darin „Bearbeiten“, ein Trenner und rot „Entfernen“

#### Scenario: Nur Primäraktion
- **WHEN** eine Zeile nur eine Primäraktion und kein ⋮-Menü trägt und jemand ihr Kontextmenü öffnet
- **THEN** steht darin genau dieser eine Eintrag

#### Scenario: Primäraktion mit Rückfrage
- **WHEN** die Primäraktion einer Zeile als Knopf vor dem Auslösen nachfragt und jemand sie im Kontextmenü wählt
- **THEN** schließt das Menü, und ein Dialog stellt dieselbe Rückfrage mit derselben Knopfbeschriftung; erst die Bestätigung löst die Aktion aus

#### Scenario: Aktion läuft
- **WHEN** für eine Zeile eine Aktion aus dem ⋮-Menü noch läuft und jemand ihr Kontextmenü öffnet
- **THEN** stehen die Einträge des ⋮-Menüs gesperrt im Menü, und die Primäraktion bleibt wählbar wie ihr Knopf

#### Scenario: Betreuungsstelle in der Tabelle
- **WHEN** eine Person mit Schreibrecht in der Tabelle der Betreuungsstellen auf die Zeile einer geöffneten, unverorteten Stelle mit gezählter Belegung rechtsklickt
- **THEN** stehen darin „Belegung melden“, „Auf Karte verorten“, ein Trenner und rot „Stornieren“

## ADDED Requirements

### Requirement: Eine Karte mit mehreren Knöpfen zeigt alle ihre Handlungen

Trägt eine Karte mehrere Knöpfe, SHALL ihr Kontextmenü alle Knöpfe zeigen, die etwas tun, in der
Reihenfolge der Knopfzeile, danach die Einträge ihres ⋮-Menüs. Das MUST auch gelten, wenn die Karte
unter drei Aktionen kein ⋮-Menü zeigt. Ein gesperrter Knopf MUST gesperrt mit seinem Grund im Menü
stehen. Sprünge zu einer anderen Ansicht und Auswahlfelder der Karte MUST NOT im Menü stehen.

#### Scenario: Neue Sofortmeldung
- **WHEN** eine Person mit Schreibrecht auf eine neue, unbestätigte Sofortmeldung rechtsklickt, deren Karte „Bestätigen“, „Sichten“ und das ⋮-Menü trägt
- **THEN** stehen im Menü zuerst „Bestätigen“ und „Sichten“, danach die Einträge des ⋮-Menüs in dessen Reihenfolge

#### Scenario: Karte unter drei Aktionen
- **WHEN** eine Verpflegungsstelle im Status „aktiv“ die Knöpfe „Bearbeiten …“ und rot „Auflösen …“ ohne ⋮-Menü trägt und jemand auf sie rechtsklickt
- **THEN** stehen im Menü „Bearbeiten …“, ein Trenner und rot „Auflösen …“

#### Scenario: Knopf mit Rückfrage
- **WHEN** jemand im Kontextmenü eines vollzogenen Auftrags „Abnehmen“ wählt
- **THEN** schließt das Menü, ein Dialog fragt „Auftrag abnehmen?“ mit dem Knopf „Auftrag abnehmen“, und erst die Bestätigung nimmt den Auftrag ab

#### Scenario: Gesperrte Übernahme
- **WHEN** eine eingetroffene Nachforderung „Als Material übernehmen“ gesperrt trägt, weil das Materialmodul für die Person gesperrt ist, und jemand ihr Kontextmenü öffnet
- **THEN** steht „Als Material übernehmen“ gesperrt im Menü und nennt den Grund

#### Scenario: Sprung bleibt draußen
- **WHEN** jemand auf ein laufendes Zeitfenster rechtsklickt, dessen Karte „Ausgabe öffnen“ und „Ausgabe nachtragen“ trägt
- **THEN** steht „Ausgabe nachtragen“ im Menü und „Ausgabe öffnen“ nicht

#### Scenario: Zuweisung bleibt an der Karte
- **WHEN** jemand das Kontextmenü einer Meldung öffnet, an der die Auswahl „Bearbeiter zuweisen“ steht
- **THEN** enthält das Menü keinen Eintrag zur Zuweisung

### Requirement: Eine Chat-Nachricht öffnet ihr Kontextmenü

Eine Nachricht im Chat mit Aktionen SHALL per Rechtsklick, langem Druck und Tastatur dasselbe Menü
öffnen wie ihr ⋮-Auslöser. Auf einem Anhang MUST das Browsermenü bleiben, weil er ein Link zum
Herunterladen ist.

#### Scenario: Rechtsklick auf eine eigene Nachricht
- **WHEN** eine Person mit Schreibrecht neben den Text ihrer eigenen Nachricht rechtsklickt
- **THEN** öffnet am Zeiger ein Menü mit „Zu ETB“, „Zu Auftrag“, „Bearbeiten“, einem Trenner und rot „Löschen“, soweit diese Einträge auch im ⋮-Menü stehen

#### Scenario: Rechtsklick auf einen Anhang
- **WHEN** jemand auf den Anhang einer Nachricht rechtsklickt
- **THEN** erscheint das Browsermenü mit „Link speichern unter“

#### Scenario: Gelöschte Nachricht
- **WHEN** jemand auf eine gelöschte Nachricht rechtsklickt
- **THEN** erscheint das Browsermenü

### Requirement: Ein Zählschirm hat kein Kontextmenü

Ein Schirm, auf dem in schneller Folge Tasten gezählt werden, SHALL kein eigenes Kontextmenü
öffnen. Ein langer Druck auf eine Zähltaste MUST wie bisher wirken und kein Menü öffnen. Eine
Auswahl hinter einem ⋮-Knopf auf diesem Schirm ist kein Menü eines Datensatzes.

#### Scenario: Langer Druck im Ausgabe-Zählschirm
- **WHEN** eine Person am Tablet im Zählschirm einer Verpflegungsausgabe 600 ms auf eine Zähltaste drückt
- **THEN** öffnet kein Kontextmenü
