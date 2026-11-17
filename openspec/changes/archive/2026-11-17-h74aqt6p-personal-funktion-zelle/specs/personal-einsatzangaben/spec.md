# Spec Delta

## MODIFIED Requirements

### Requirement: Einsatzfunktion vor Qualifikation
Wo eine Person mit nur einer Funktionsangabe erscheint (Meldebild, Lagebericht-Übernahme,
Druck-Anlage Personal, Auswahllisten samt „Bestätigt von“, Unterzeile der Lagekarte), SHALL die
Einsatzfunktion stehen und, wenn sie leer ist, die Qualifikation. Die Personalliste MUST beide
zeigen, die Qualifikation nicht nur als Tooltip. Ist die Einsatzfunktion leer, MUST die
Personalliste die Qualifikation als Wert zeigen und daneben einen Stift-Knopf zum Eintragen der
Funktion, ohne eine wortgleiche Aufforderung je Zeile. Das taktische Zeichen einer Person auf der
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

#### Scenario: Personalliste ohne Einsatzfunktion
- **WHEN** Anna Beispiel mit der Qualifikation „Zugführer, Sprechfunker“ ohne Einsatzfunktion in der Personalliste steht und die Rolle Personal schreiben darf
- **THEN** steht in ihrer Zelle „Funktion“ „Zugführer, Sprechfunker“ als Wert, daneben ein Knopf „Funktion zu Anna Beispiel eintragen“, und die Zeile zeigt den Text „Funktion eintragen“ nicht sichtbar (ein Tooltip darf ihn ergänzen)

#### Scenario: Personalliste mit Einsatzfunktion
- **WHEN** dieselbe Person die Einsatzfunktion „Gruppenführerin“ bekommt
- **THEN** steht „Gruppenführerin“ als bearbeitbarer Wert und „Zugführer, Sprechfunker“ gedämpft darunter

#### Scenario: Personalliste ohne Schreibrecht
- **WHEN** die Rolle Personal nur lesen darf und die Einsatzfunktion leer ist
- **THEN** steht nur „Zugführer, Sprechfunker“, ohne Knopf
