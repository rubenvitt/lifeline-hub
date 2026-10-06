# bedien-begriffe Specification

## Purpose
Legt Begriffe der Oberfläche fest, die über ein einzelnes Modul hinaus gelten, damit dieselbe
Sache überall gleich heißt und Gelegenheitshelfer sie unter Druck wiedererkennen.

## Requirements

### Requirement: Voreingestellte Werte heißen „Vorgabe“
Ein Wert, der gilt, wenn niemand etwas wählt oder einträgt, SHALL in jedem sichtbaren Text der
Oberfläche „Vorgabe“ heißen: in Platzhaltern, Feld- und Abschnittsnamen, Seitentiteln,
Hinweisen, Tooltips und Erfolgsmeldungen. Die Wörter „Default“ und „Fallback“ MUST NOT im
sichtbaren Text stehen; „Standard“ MUST NOT in dieser Bedeutung stehen. Ausgenommen sind
benannte Dinge mit eigener Spec („Standard-Rufname“, „Standardansicht“).

#### Scenario: Platzhalter einer Org-Einstellung
- **WHEN** ein Admin die Anzeige-Konventionen öffnet und das Feld „Zeitformat“ leer ist
- **THEN** lautet der Platzhalter „24 Stunden (Vorgabe)“, und die Seite enthält weder „Default“ noch „Fallback“

#### Scenario: Verwaltungsseite der Einsatz-Vorgaben
- **WHEN** ein Admin im Verwaltungsmenü die Vorgaben für neue Einsätze öffnet
- **THEN** heißen Menüeintrag und Seitentitel „Einsatz-Vorgaben“, die Rollenspalte „Benötigte Rolle (Vorgabe)“

#### Scenario: Eigenname bleibt
- **WHEN** ein Mitglied im ETB seinen Standard-Rufnamen ändert
- **THEN** heißt der Menüeintrag weiter „Standard-Rufname ändern“

### Requirement: Die Ebene einer Vorgabe ist erkennbar
Die Oberfläche SHALL unterscheiden, woher eine Vorgabe kommt. Ein leeres Feld in den
Org-Einstellungen MUST erklären „Leer = Vorgabe des Systems“. Ein leeres Feld in den
Einsatz-Einstellungen, für das die Organisation einen Wert gesetzt hat, MUST diesen Wert als
„Vorgabe der Organisation: <Wert>“ zeigen.

#### Scenario: Org-Vorgabe im Einsatz
- **WHEN** die Organisation das Zeitformat „12 Stunden (AM/PM)“ vorgibt und der Einsatz keines gesetzt hat
- **THEN** steht unter dem Feld „Vorgabe der Organisation: 12 Stunden (AM/PM)“, der Platzhalter lautet „12 Stunden (AM/PM) (Vorgabe)“, und der Einsatz speichert weiter `null`

#### Scenario: Keine Org-Vorgabe
- **WHEN** die Organisation für ein Feld keinen Wert gesetzt hat
- **THEN** steht unter dem Einsatz-Feld kein Org-Hinweis

### Requirement: Der Platzhalter nennt den Wert, der wirklich gilt
Platzhalter und Tooltip eines Feldes mit Vorgabe SHALL denselben Wert nennen, und dieser Wert
MUST dem Verhalten bei leerem Feld entsprechen.

#### Scenario: Zeitzone leer
- **WHEN** das Feld „Zeitzone“ in den Anzeige-Konventionen leer ist, oder im Einsatz leer ist und die Organisation keine Zeitzone vorgibt
- **THEN** lautet der Platzhalter „Gerätezeit (Vorgabe)“, der Tooltip nennt die Gerätezeit als Wert bei leerem Feld, und Zeiten erscheinen in der Zeitzone des Geräts

#### Scenario: Frist im Einsatz mit Org-Vorgabe
- **WHEN** die Organisation eine Bestätigungsfrist von 30 Minuten vorgibt und das Einsatz-Feld leer ist
- **THEN** lautet der Platzhalter „30 (Vorgabe)“ und nicht der System-Wert „5 (Vorgabe)“
