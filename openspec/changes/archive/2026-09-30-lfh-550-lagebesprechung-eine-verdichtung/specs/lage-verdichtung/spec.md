# Spec Delta

## Purpose

Jede Zahl, die das Lage-Dashboard, der Führungsüberblick und der Stab zeigen, hat genau einen
Rechenweg. Dieselbe Zahl zeigt an jeder Stelle denselben Wert, damit eine Lagebesprechung nicht
zwei Wahrheiten vorträgt.

## ADDED Requirements

### Requirement: Handlungsmengen kommen vom Modulzähler
Das Lage-Dashboard (Führungsstand) und der Führungsüberblick SHALL diese Zahlen ausschließlich aus
`GET /api/einsaetze/{id}/modul-zaehler` anzeigen: Aufträge offen, Aufträge in Arbeit, Aufträge
überfällig, Meldungen offen, Meldungen neu und Meldungen mit überfälliger Bestätigung. Sie MUST
NOT diese Zahlen aus einer Modulliste zählen.
- „Aufträge überfällig“ MUST die überfälligen unter den offenen Aufträgen meinen.
- „Bestätigung überfällig“ MUST `meldungen.bestaetigung_ueberfaellig` meinen, also auch eskalierte
  unbestätigte Meldungen.
- Fehlt ein Modul in der Antwort (nicht erlaubt), MUST die Kennzahl „nicht freigegeben“ sagen und
  MUST NOT 0 zeigen.
- Solange der Zähler lädt oder gescheitert ist, MUST die Kennzahl keinen Wert zeigen.

#### Scenario: Dashboard und Modulpanel stimmen überein
- **WHEN** der Modulzähler `auftraege: { offen: 5, in_arbeit: 2, ueberfaellig: 1 }` liefert
- **THEN** zeigt der Führungsstand „Aufträge offen“ 5 mit der Notiz „1 überfällig“, und das
  Modulpanel zeigt an „Aufträge“ dieselbe 5

#### Scenario: Überblick und Dashboard stimmen überein
- **WHEN** Dashboard und Führungsüberblick denselben Einsatz zeigen
- **THEN** zeigen beide für „Aufträge offen“ und „überfällig“ dieselben Werte

#### Scenario: Vollzogener Auftrag mit abgelaufener Frist
- **WHEN** ein Auftrag vollzogen ist, seine Frist abgelaufen ist und ein Empfänger nicht quittiert hat
- **THEN** zählt der Führungsstand ihn nicht als überfällig

#### Scenario: Eskalierte Meldung
- **WHEN** eine bestätigungspflichtige, unbestätigte Meldung eskaliert ist, ihre Frist aber noch
  nicht abgelaufen ist
- **THEN** zählt der Führungsstand sie unter „Bestätigung überfällig“

#### Scenario: Meldungen nicht freigegeben
- **WHEN** die Antwort des Modulzählers kein Feld `meldungen` enthält
- **THEN** sagt die Kennzahl „Meldungen offen“ „nicht freigegeben“ und zeigt keine 0

### Requirement: Stärke zählt jede Einheit höchstens einmal
Eine Stärkesumme über eine Menge von Einheiten SHALL die kumulierte Ist-Stärke nur der Einheiten
addieren, deren übergeordnete Einheit nicht selbst in derselben Summe steckt. Die Stärke eines
Einsatzabschnitts SHALL der Unterstellung folgen wie das Meldebild: Eine unterstellte Einheit
zählt beim Abschnitt ihrer obersten Einheit, nicht zusätzlich bei ihrem eigenen.
- Die Seite Einsatzabschnitte, die Abschnittsvorschau, das Meldebild und der Führungsüberblick
  MUST für denselben Abschnitt dieselbe Stärke zeigen.
- Ein Bereitstellungsraum MUST jede in ihm stehende Einheit höchstens einmal zählen.
- Eine leere Menge MUST weiter „keine Einheit zugeordnet“ bedeuten, nicht 0/0/0.

#### Scenario: Unterstellte Einheit im selben Abschnitt
- **WHEN** Einheit A (1/1/2) im Abschnitt X steht und ihr die Einheit B (0/1/3) unterstellt ist,
  die ebenfalls im Abschnitt X steht
- **THEN** zeigt der Abschnitt X die Stärke 1/2/5//8, nicht 1/3/8//12

#### Scenario: Unterstellte Einheit in anderem Abschnitt
- **WHEN** Einheit B der Einheit A unterstellt ist, A im Abschnitt X und B im Abschnitt Y steht
- **THEN** zählt B bei X (über A) und nicht bei Y, auf der Seite Einsatzabschnitte wie im Meldebild

#### Scenario: Bereitstellungsraum mit Einheit und Untereinheit
- **WHEN** im Bereitstellungsraum Einheit A und die ihr unterstellte Einheit B stehen
- **THEN** zählt die Summe B genau einmal

### Requirement: Eine Formatierung und eine Sichtungsverteilung
Die BOS-Schreibweise einer Stärke („F/UF/M//Σ“) SHALL an jeder Stelle aus derselben Formatierung
kommen. Die Verteilung der Betroffenen auf die Sichtungskategorien SHALL an jeder Stelle aus
derselben Zählung kommen: im Lage-Dashboard, in der Betroffenen-Seitenleiste und in der
Vorbereitung der Lagebesprechung.

#### Scenario: Gleiche Sichtungsverteilung
- **WHEN** Lage-Dashboard und Betroffenen-Seitenleiste dieselbe Personenliste zeigen
- **THEN** stimmen die Zahlen je Sichtungskategorie und „ohne Sichtung“ überein

### Requirement: Gemeinsames Fixture für Regeln beider Sprachen
Jede Zählregel, die sowohl der Server als auch der Client anwendet, SHALL durch ein gemeinsames
Fixture belegt sein. Das Fixture ist eine Datei mit Eingaben und erwarteten Zahlen, gelesen von
einem Rust-Test und von einem Vitest-Test. Es MUST mindestens diese Regeln abdecken:
- Auftrag offen und davon überfällig;
- Meldung offen, neu und Bestätigung überfällig;
- kumulierte Ist-Stärke einer Einheit über ihre Unterstellung;
- Stärke eines Abschnitts.

Eine Änderung an einer Regel, die nur eine Seite nachzieht, MUST einen der beiden Tests rot machen.

#### Scenario: Server weicht ab
- **WHEN** die Server-Regel für „Auftrag überfällig“ geändert wird und das Fixture nicht
- **THEN** schlägt der Rust-Test fehl

#### Scenario: Client weicht ab
- **WHEN** die Client-Regel für „Bestätigung überfällig“ geändert wird und das Fixture nicht
- **THEN** schlägt der Vitest-Test fehl
