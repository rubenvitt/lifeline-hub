# Spec Delta

## Purpose

Zeigt angemeldeten Personen die Neuigkeiten der Anwendung je Versionskanal: als Archiv aller
Versionen und als Übersicht seit der zuletzt gelaufenen Version. Die Einträge stammen aus den
Release Notes und sind vollständig offline lesbar.

## ADDED Requirements

### Requirement: Die Neuigkeiten kommen aus den Release Notes der Anwendung

Die Anwendung SHALL ihre Neuigkeiten zur Build-Zeit aus den Release Notes lesen, die im Repository
liegen. Jeder Eintrag MUST eine Version, ein Datum und einen Text tragen. Die Anwendung MUST die
Neuigkeiten ohne Verbindung zu einem externen Dienst anzeigen können.

#### Scenario: Offline-Betrieb

- **GIVEN** der Server hat keine Verbindung zum Internet
- **WHEN** eine angemeldete Person die Neuigkeiten-Seite öffnet
- **THEN** sieht sie alle Einträge ohne Fehlermeldung

#### Scenario: Eintrag ohne Datum

- **WHEN** ein Release-Eintrag kein Datum trägt
- **THEN** wird er trotzdem angezeigt, und die Version bleibt sichtbar

### Requirement: Der Kanal ergibt sich aus der Versionsnummer

Die Anwendung SHALL jeden Eintrag einem Kanal zuordnen: `alpha` bei einer Vorabkennung `-alpha.N`,
`beta` bei `-beta.N`, sonst `stabil`. Die Neuigkeiten-Seite MUST nach Kanal filtern können.

#### Scenario: Filter Alpha

- **GIVEN** das Archiv enthält Einträge der Kanäle alpha, beta und stabil
- **WHEN** eine Person den Filter auf „alpha“ setzt
- **THEN** zeigt die Seite nur Einträge mit `-alpha.` in der Version

#### Scenario: Beta ohne Einträge

- **GIVEN** es gibt noch keinen Eintrag mit `-beta.` in der Version
- **WHEN** eine Person den Filter auf „beta“ setzt
- **THEN** zeigt die Seite einen Hinweis, dass es noch keine Beta-Versionen gibt

### Requirement: Die Seite zeigt die Änderungen seit der letzten Version

Die Neuigkeiten-Seite SHALL oben den Abschnitt „Seit deiner letzten Version“ zeigen. Er umfasst alle
Einträge desselben Kanals wie die laufende Version, die nach der zuletzt gestarteten Version liegen,
neueste zuerst. Die Seite MUST darunter das vollständige Archiv zeigen.

#### Scenario: Update über mehrere Alpha-Versionen

- **GIVEN** die laufende Version ist `1.0.0-alpha.106` und die zuletzt gestartete ist `1.0.0-alpha.100`
- **WHEN** eine angemeldete Person die Neuigkeiten-Seite öffnet
- **THEN** zeigt der Abschnitt die Einträge `1.0.0-alpha.106` bis `1.0.0-alpha.101`, neueste zuerst

#### Scenario: Kein Versionswechsel

- **GIVEN** es gab keinen Versionswechsel
- **WHEN** eine angemeldete Person die Neuigkeiten-Seite öffnet
- **THEN** blendet die Seite den Abschnitt „Seit deiner letzten Version“ aus und zeigt nur das Archiv

#### Scenario: Wechsel in den stabilen Kanal

- **GIVEN** die laufende Version ist `1.0.0` und die zuletzt gestartete ist `1.0.0-alpha.106`
- **WHEN** eine angemeldete Person die Neuigkeiten-Seite öffnet
- **THEN** zeigt der Abschnitt den stabilen Eintrag `1.0.0`, der die Änderungen aller Vorabversionen seit dem letzten stabilen Release enthält

### Requirement: Der erste stabile Eintrag wird nur als Vorschau gezeigt

Ein stabiler Eintrag, dessen Text die Grenze von 20 000 Zeichen überschreitet, MUST zunächst nur als
Vorschau mit den ersten Abschnitten erscheinen. Die vollständige Fassung MUST sich auf Anforderung
der Person aufklappen lassen.

#### Scenario: Erstes stabiles Release

- **GIVEN** der Eintrag `1.0.0` ist länger als 20 000 Zeichen
- **WHEN** eine Person die Neuigkeiten-Seite öffnet
- **THEN** erscheint `1.0.0` als Vorschau mit einem Schalter „Vollständig anzeigen“

### Requirement: Hinweiskarte nach einem Versionswechsel

Die Einstiegsseite SHALL nach einem Versionswechsel eine Hinweiskarte mit der Anzahl der seit dem
Lesestand neuen Einträge des laufenden Kanals zeigen, etwa „Neu seit 1.0.0-alpha.100: 6 Versionen“.
Die Karte MUST nicht modal sein und den Arbeitsfluss nicht unterbrechen. Sie MUST sich schließen
lassen und einen Link zur Neuigkeiten-Seite enthalten.

#### Scenario: Karte erscheint nach einem Update

- **GIVEN** `gelesen_bis` liegt vor der laufenden Version
- **WHEN** eine angemeldete Person die Einstiegsseite öffnet
- **THEN** erscheint die Hinweiskarte oben, ohne dass sich etwas davor blockieren lässt

#### Scenario: Karte schließen

- **WHEN** eine Person die Hinweiskarte schließt
- **THEN** verschwindet sie und `gelesen_bis` gilt als aktuell

#### Scenario: Keine Karte ohne neue Einträge

- **GIVEN** `gelesen_bis` entspricht der laufenden Version
- **WHEN** eine angemeldete Person die Einstiegsseite öffnet
- **THEN** erscheint keine Hinweiskarte

### Requirement: Punkt im Benutzermenü

Der Eintrag „Neuigkeiten“ im Benutzermenü SHALL einen Punkt zeigen, solange `gelesen_bis` vor der
laufenden Version liegt. Der Punkt MUST verschwinden, sobald die Neuigkeiten-Seite geöffnet oder die
Hinweiskarte geschlossen wurde.

#### Scenario: Ungelesene Version

- **GIVEN** `gelesen_bis` liegt vor der laufenden Version
- **WHEN** eine Person das Benutzermenü öffnet
- **THEN** zeigt der Eintrag „Neuigkeiten“ einen Punkt

#### Scenario: Gelesen

- **GIVEN** `gelesen_bis` entspricht der laufenden Version
- **WHEN** eine Person das Benutzermenü öffnet
- **THEN** zeigt der Eintrag „Neuigkeiten“ keinen Punkt

#### Scenario: Rückkehr auf eine ältere Version

- **GIVEN** die laufende Version ist `1.0.0-alpha.100` und `gelesen_bis` ist `1.0.0-alpha.106`
- **WHEN** eine Person das Benutzermenü öffnet
- **THEN** zeigt der Eintrag „Neuigkeiten“ keinen Punkt

### Requirement: Gelesen ist nur, was die App zeigen kann

Kennt die ausgelieferte App die Notizen der laufenden Version nicht, weil sie nach einem
Server-Update noch nicht aktualisiert wurde, MUST das Öffnen der Neuigkeiten-Seite den Lesestand
unverändert lassen. Die Seite SHALL dann darauf hinweisen, dass die Notizen mit der Aktualisierung
der App kommen. Die Hinweiskarte MUST in diesem Fall ausbleiben.

#### Scenario: Altes Bundle nach einem Server-Update

- **GIVEN** die laufende Version ist `1.0.0-alpha.107` und die App führt Notizen nur bis `1.0.0-alpha.106`
- **WHEN** eine angemeldete Person die Neuigkeiten-Seite öffnet
- **THEN** bleibt `gelesen_bis` unverändert und die Seite nennt die fehlende Aktualisierung
