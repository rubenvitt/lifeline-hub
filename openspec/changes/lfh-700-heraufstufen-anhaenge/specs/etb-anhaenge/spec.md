# Spec Delta

## ADDED Requirements

### Requirement: Das Heraufstufen übernimmt gewählte Chat-Anhänge als Kopie
Das Heraufstufen einer Chat-Nachricht ins ETB SHALL eine optionale Liste `anhang_ids` annehmen.
Je genannter Datei SHALL eine neue Datei mit denselben Bytes, demselben Dateinamen und MIME-Typ
entstehen und an den neuen Eintrag gebunden werden. Die Datei der Nachricht SHALL unverändert
im Chat bleiben. Eintrag, Kopien, Verknüpfungen und Rückverweis SHALL ganz oder gar nicht
entstehen. Fehlt die Liste oder ist sie leer, SHALL keine Datei übernommen werden.

#### Scenario: Nachricht mit Foto heraufstufen
- **WHEN** ein Schreibberechtigter eine Nachricht mit einem Foto heraufstuft und dessen ID in `anhang_ids` nennt
- **THEN** trägt der neue ETB-Eintrag einen Anhang mit Dateiname, MIME-Typ und Größe des Fotos, aber eigener ID
- **AND** die Nachricht trägt ihr Foto weiter, und es ist über den Chat ladbar wie vorher

#### Scenario: Ohne Auswahl
- **WHEN** eine Nachricht mit Anhängen ohne `anhang_ids` heraufgestuft wird
- **THEN** entsteht der Eintrag ohne Anhang, wie bisher

#### Scenario: Kopie überlebt das Löschen der Nachricht
- **WHEN** eine Nachricht samt Foto heraufgestuft und die Nachricht danach gelöscht wird
- **THEN** bleibt die Kopie am ETB-Eintrag und ist über die ETB-Route ladbar

#### Scenario: Nachricht nur mit Foto, ohne Text
- **WHEN** eine Nachricht ohne Text, nur mit einem Foto, ohne eigenen Text im Body heraufgestuft wird
- **THEN** antwortet das System mit 400, und es entsteht kein Eintrag

#### Scenario: Kopie folgt den ETB-Regeln
- **WHEN** die übernommene Datei über die generische Anhang-Route geladen oder gelöscht wird
- **THEN** antwortet das System wie bei jedem ETB-Anhang (404 beim Laden, 422 beim Löschen)

### Requirement: Die Auswahl beim Heraufstufen ist auf die Nachricht beschränkt
Jede ID in `anhang_ids` MUST an der heraufgestuften Nachricht hängen. Eine andere ID, auch eine
Datei derselben Person oder eine andere Chat-Datei desselben Einsatzes, SHALL 400 ergeben.
Doppelte IDs SHALL als eine gelten. Mehr als 10 verschiedene IDs SHALL 400 ergeben. In jedem
Fehlerfall SHALL weder Eintrag noch Kopie noch Rückverweis entstehen.

#### Scenario: Fremde Datei in der Auswahl
- **WHEN** `anhang_ids` eine Datei nennt, die an einer anderen Nachricht hängt
- **THEN** antwortet das System mit 400
- **AND** die Nachricht ist nicht heraufgestuft, und es ist keine neue Datei entstanden

#### Scenario: Zu viele Dateien
- **WHEN** `anhang_ids` elf verschiedene Dateien der Nachricht nennt
- **THEN** antwortet das System mit 400, und die Nachricht ist nicht heraufgestuft

#### Scenario: Doppelte ID
- **WHEN** `anhang_ids` dieselbe Datei zweimal nennt
- **THEN** trägt der Eintrag genau eine Kopie dieser Datei

### Requirement: Der Dialog zeigt die Anhänge zur Auswahl
Der Dialog „Zu ETB heraufstufen“ SHALL die Anhänge der Nachricht mit Dateinamen als Auswahl
zeigen, vorgewählt bis zur Grenze von 10. Er SHALL darauf hinweisen, dass übernommene Dateien im
Tagebuch unveränderlich sind. Er SHALL nicht mehr als 10 Dateien zur Übernahme zulassen. Eine
Nachricht ohne Anhang SHALL den Dialog ohne Auswahl und ohne Hinweis zeigen.

#### Scenario: Zwei Fotos, eines abgewählt
- **WHEN** eine Person den Dialog für eine Nachricht mit zwei Fotos öffnet, eines abwählt und heraufstuft
- **THEN** sendet der Client genau die ID des gewählten Fotos in `anhang_ids`

#### Scenario: Nachricht ohne Anhang
- **WHEN** der Dialog für eine Nachricht ohne Anhang geöffnet wird
- **THEN** zeigt er nur Typ und Text, und der Client sendet keine Anhänge
