# personal-einsatzangaben Specification

## Purpose

Angaben einer disponierten Einsatzkraft, die nur im Einsatz gelten: die Einsatzfunktion (was die
Person gerade tut), getrennt von der Qualifikation (was sie kann), und die im Einsatz änderbaren
Angaben einer Ad-hoc-Person. Eingeführt mit LLH-1067.

## Requirements

### Requirement: Einsatzfunktion einer Einsatzkraft
Das System SHALL für jede disponierte Person eine optionale Einsatzfunktion als Freitext führen,
getrennt von ihren Qualifikationen. Die Einsatzfunktion MUST im Einsatz gesetzt, geändert und
geleert werden können, für Stamm- und Ad-hoc-Personen gleich. Eine Einsatzfunktion über 200
Zeichen MUST mit 400 abgelehnt werden.

#### Scenario: Sprechfunker setzen
- **WHEN** die Einsatzfunktion einer Stamm-Person auf „Sprechfunker“ gesetzt wird
- **THEN** meldet die Personalliste „Sprechfunker“ als Einsatzfunktion und ihre Qualifikationen unverändert

#### Scenario: Leeren
- **WHEN** die Einsatzfunktion mit `null` oder leerem Text geschickt wird
- **THEN** ist sie leer, und die Anzeige fällt auf die Qualifikation zurück

#### Scenario: Zu lang
- **WHEN** eine Einsatzfunktion mit 201 Zeichen geschickt wird
- **THEN** antwortet der Server mit 400 und ändert nichts

### Requirement: Ad-hoc-Angaben änderbar
Das System SHALL bei Ad-hoc-Personen Name, Trägerorganisation und Qualifikation im Einsatz
ändern lassen. Bei Stamm-Personen MUST eine Änderung dieser drei Angaben mit 422 und dem Grund
„im Stamm pflegen“ abgelehnt werden, ohne etwas zu schreiben.

#### Scenario: Tippfehler im Ad-hoc-Namen
- **WHEN** der Name einer Ad-hoc-Person von „Maier“ auf „Meier“ geändert wird
- **THEN** zeigen Personalliste, Einheit und Meldebild „Meier“

#### Scenario: Stamm-Person umbenennen
- **WHEN** der Name einer Stamm-Person über den Einsatz geändert werden soll
- **THEN** antwortet der Server mit 422 „im Stamm pflegen“, und nichts ist geändert

### Requirement: Änderungen stehen im ETB
Jede Änderung von Einsatzfunktion, Ad-hoc-Name, Qualifikation oder Träger SHALL genau einen
ETB-Systemeintrag schreiben, der jede geänderte Angabe mit altem und neuem Wert nennt. Ändert sich
nichts, MUST kein Eintrag entstehen.

#### Scenario: Funktionswechsel
- **WHEN** die Einsatzfunktion von leer auf „Sprechfunker“ wechselt
- **THEN** steht im ETB „Person «Max Mustermann»: Funktion «—» → «Sprechfunker»“

### Requirement: Einsatzfunktion vor Qualifikation
Wo eine Person mit nur einer Funktionsangabe erscheint (Meldebild, Lagebericht-Übernahme,
Druck-Anlage Personal, Auswahllisten samt „Bestätigt von“, Unterzeile der Lagekarte), SHALL die
Einsatzfunktion stehen und, wenn sie leer ist, die Qualifikation. Die Personalliste MUST beide
zeigen, die Qualifikation nicht nur als Tooltip. Das taktische Zeichen einer Person auf der
Lagekarte MUST allein aus der Qualifikation abgeleitet werden, nie aus der Einsatzfunktion
(LLH-1239).

#### Scenario: Meldebild
- **WHEN** eine Notfallsanitäterin die Einsatzfunktion „Gruppenführerin“ hat
- **THEN** steht im Meldebild „Gruppenführerin“ an ihrer Zeile

#### Scenario: Vorschau zeigt Funktion und Qualifikation getrennt
- **WHEN** die Vorschau eine Person mit der Einsatzfunktion „Sprechfunker“ und der Qualifikation
  „Sanitäter“ zeigt
- **THEN** steht „Sprechfunker“ im Feld „Funktion“ und „Sanitäter“ im Feld „Qualifikation“, nicht
  zu einer Angabe zusammengezogen

#### Scenario: Lagekarte lenkt das Zeichen nicht um
- **WHEN** auf der Lagekarte eine Notfallsanitäterin mit der Einsatzfunktion „Sprechfunker“ steht
- **THEN** trägt ihr Zeichen die Fachaufgabe Rettungswesen, nicht IuK, und die Leiste nennt
  „Sprechfunker“ als Funktion und „Notfallsanitäter“ als Qualifikation

#### Scenario: Bestätigt von
- **WHEN** am UHS-Gerät eine Person mit der Einsatzfunktion „Sprechfunker“ zur Auswahl steht
- **THEN** lautet ihr Eintrag „Name · Sprechfunker“
