# Spec Delta

## Purpose

An einem Spiegel wird nicht geschrieben, sondern beantragt. Die Erfassungen, die ohne Netz
vormerkbar sind, gehen als Antrag an die führende Instanz, und der Antrag zeigt seinen Zustand,
bis sie ihn übernommen oder abgelehnt hat.

## ADDED Requirements

### Requirement: Beantragbar ist genau, was ohne Netz vormerkbar ist

An einem Spiegel SHALL genau die Erfassungen zum Antrag werden, die ohne Netz vormerkbar sind,
heute 18. Jede andere Schreibaktion MUST am Spiegel gesperrt sein (Spec `einsatz-spiegel`).

#### Scenario: Die 18 Erfassungen
- **WHEN** jemand am Spiegel einen ETB-Eintrag, eine Meldung, eine Person, einen Personeneintrag (Sichtung, Verbleib, Notiz, Transport, Anlass, Maßnahme, Verletzung), eine Stand- oder Belegungsmeldung, eine Registrierung oder Abmeldung, ein Eintreffen, eine Verpflegungsausgabe, „Eingänge gelesen“ oder eine Quittung einer Benachrichtigung erfasst
- **THEN** wird daraus ein Antrag

#### Scenario: Maßnahme aufheben am Spiegel
- **WHEN** jemand am Spiegel eine Maßnahme aufheben will
- **THEN** ist die Bedienung gesperrt, weil das Aufheben auch ohne Netz nicht vormerkbar ist

### Requirement: Neue vormerkbare Erfassungen werden eingeordnet

Eine Erfassung, die künftig ohne Netz vormerkbar wird, MUST auch beantragbar sein oder
ausdrücklich mit Grund ausgenommen werden.

#### Scenario: Neue Art in der Warteschlange
- **WHEN** die Offline-Warteschlange eine neue Art bekommt, die weder beantragbar noch ausgenommen ist
- **THEN** schlägt der Wächter-Test fehl

### Requirement: Ein Antrag steht ausstehend, bis der Führer entscheidet

Eine beantragbare Erfassung am Spiegel SHALL mit 202 und einem Antrag „ausstehend“ beantwortet
werden. Sie MUST NOT in die Daten des Spiegels geschrieben werden. Der Antrag MUST das Konto, die
Erfassungszeit nach der Serveruhr der spiegelnden Seite und die `client_id` der Erfassung
tragen. Ohne Verbindung zum Führer MUST er ausstehend bleiben, unbegrenzt.

#### Scenario: Ohne Verbindung
- **WHEN** der ELW einen Antrag stellt und zwei Stunden keine Verbindung zum Hub hat
- **THEN** bleibt der Antrag ausstehend und wird mit dem ersten Abgleich danach zugestellt

### Requirement: Anträge stehen dort, wo Vorgemerktes steht

Die Oberfläche MUST einen ausstehenden Antrag an der Stelle der Erfassung zeigen, wo diese
Vorgemerktes zeigt (ETB, Meldungen, Person, Betreuungsstelle, Bereitstellungsraum, Verpflegung),
getrennt von den Daten und nicht in deren Kennzahlen. Das Hinweisband MUST ausstehende und
abgelehnte Anträge zählen.

#### Scenario: ETB-Eintrag am Hub
- **WHEN** jemand im Verwaltungsstab am Hub im Spiegel eines ELW-Einsatzes einen ETB-Eintrag erfasst
- **THEN** erscheint der Eintrag im ETB des Hubs als „ausstehend“, ohne laufende Nummer, und der Zähler der Einträge bleibt gleich

### Requirement: Der Führer übernimmt im Namen des Kontos

Der Führer SHALL einen Antrag ausführen, als hätte das Konto die Erfassung bei ihm selbst
gemacht: mit denselben Rechten, Prüfungen und Wirkungen, einschließlich Live-Aktualisierung und
Admin-Spur. Die Erfassungszeit des Antrags MUST als Erfassungszeit gelten, wo die Erfassung
eine trägt. Kennt der Führer das Konto nicht oder hat es dort keine Schreibrolle, MUST der
Antrag abgelehnt werden. Derselbe Antrag MUST höchstens einmal wirken, auch wenn er doppelt
ankommt.

#### Scenario: Doppelte Zustellung
- **WHEN** ein Antrag zweimal beim Führer ankommt, weil die Quittung verloren ging
- **THEN** gibt es den ETB-Eintrag einmal, und beide Zustellungen werden mit demselben Ergebnis quittiert

#### Scenario: Konto nur am ELW
- **WHEN** ein Konto, das nur am ELW existiert, am ELW einen Antrag in einem Einsatz stellt, den der Hub führt
- **THEN** wird der Antrag abgelehnt mit „Konto am Führer unbekannt“

### Requirement: Übernahme und Ablehnung kommen zurück

Der Führer SHALL jeden Antrag mit „übernommen“ oder „abgelehnt“ samt Grund quittieren. Ein
übernommener Antrag MUST am Spiegel verschwinden, sobald der Spiegel die entstandene Zeile hat,
nicht früher. Ein abgelehnter Antrag MUST mit Grund und erfassten Daten stehen bleiben, damit
jemand ihn neu erfassen oder verwerfen kann. Abgelehnte Anträge MUST nach 30 Tagen verschwinden,
wie abgelehnte Einträge der Offline-Warteschlange.

#### Scenario: Abgeschlossener Einsatz
- **WHEN** ein Antrag ankommt, nachdem der Führer den Einsatz abgeschlossen hat
- **THEN** quittiert der Führer ihn als abgelehnt mit „Einsatz ist abgeschlossen“, und der Spiegel zeigt den Antrag mit diesem Grund

#### Scenario: Übernommen
- **WHEN** der Führer einen Antrag auf eine Meldung übernimmt
- **THEN** steht die Meldung nach dem nächsten Abgleich im Spiegel, und der Antrag ist dort verschwunden

### Requirement: Verweise im Antrag zeigen auf die Zeilen des Führers

Ein Antrag, der auf Zeilen des Einsatzes verweist (Person, Betreuungsstelle, Bezirk,
Bereitstellungsraum, Zeitfenster, Meldung), SHALL beim Führer auf dieselben Zeilen wirken. Fehlt
dem Führer eine dieser Zeilen, MUST der Antrag abgelehnt werden. Er MUST NOT auf einer anderen
Zeile landen.

#### Scenario: Person inzwischen gelöscht
- **WHEN** am Hub eine Sichtung für eine Person beantragt wird, die der ELW inzwischen gelöscht hat
- **THEN** wird der Antrag abgelehnt mit „Bezug nicht mehr vorhanden“
