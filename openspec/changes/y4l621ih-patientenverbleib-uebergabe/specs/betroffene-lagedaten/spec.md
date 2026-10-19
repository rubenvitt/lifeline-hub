# Spec Delta

## ADDED Requirements

### Requirement: Abgeschlossene stehen nicht in den Standardansichten
Die Betroffenenseite SHALL Personen mit `versorgung: "abgeschlossen"` in Zeilen, Sichtungsraster
und Kartenansicht nur zeigen, wenn „Abgeschlossene zeigen“ an ist. Der Schalter MUST aus als
Vorgabe stehen, die Zahl der Abgeschlossenen nennen und in der Adresse stehen
(`?abgeschlossen=1`). Sichtungszeile und Sichtungsbild der Seitenleiste MUST nur
Nicht-Abgeschlossene zählen. Detailseite, Sprungpalette, Druck und CSV MUST alle Personen finden.

#### Scenario: Entlassener verschwindet aus der Liste
- **WHEN** für R-004 der Verbleib „Entlassung vor Ort“ gespeichert wird
- **THEN** verlässt R-004 die Zeilen, sobald niemand mehr mit der Liste arbeitet, und der Schalter nennt „Abgeschlossene zeigen (1)“

#### Scenario: Abgeschlossene zurückholen
- **WHEN** jemand „Abgeschlossene zeigen“ einschaltet
- **THEN** steht R-004 wieder in den Zeilen, und die Adresse trägt `abgeschlossen=1`

#### Scenario: Unterwegs bleibt sichtbar
- **WHEN** R-008 im Eigentransport unterwegs ist
- **THEN** steht R-008 in Zeilen, Raster und Sichtungszeile, auch mit ausgeschaltetem Schalter

#### Scenario: Sprungpalette findet Abgeschlossene
- **WHEN** jemand in der Sprungpalette „R-004“ sucht
- **THEN** findet die Palette R-004 und öffnet die Detailseite mit vollständigem Verlauf

## MODIFIED Requirements

### Requirement: Verbleib-Zählung der Betroffenen
Die Betroffenen-Seite SHALL den Verbleib der angetroffenen Personen (Status erfasst,
betroffen oder verstorben) nach Art zählen. Unterwegs (Eigentransport ohne quittierte
Übergabe), Transport (fremdes Rettungsmittel oder quittierte Übergabe), Notunterkunft,
entlassen, vor Ort und verstorben MUST je ein Posten sein. Eine Person ohne Verbleib-Art in
einer Unfallhilfsstelle MUST unter dem Namen dieser Stelle zählen. Eine Person ohne beides MUST
unter „offen“ zählen. „offen“ MUST immer erscheinen, auch mit 0. Die Zählung MUST alle
angetroffenen Personen erfassen, unabhängig vom Schalter „Abgeschlossene zeigen“.

#### Scenario: Zählung nach Art
- **WHEN** zwei angetroffene Personen mit Verbleib `transport` durch ein fremdes Rettungsmittel, eine im Eigentransport, eine mit `notunterkunft`, eine in der UHS „Weserstadion“ ohne Verbleib und eine ohne jede Angabe erfasst sind
- **THEN** zeigt die Zählung Unterwegs 1, Transport 2, Notunterkunft 1, Weserstadion 1, offen 1

### Requirement: Lage-Dashboard zeigt Transport und Vermisstendauer
Das Lage-Dashboard SHALL im Sichtungspaneel die Zeile „Unterwegs / offen / abgeschlossen“
zeigen. Der erste Wert MUST die angetroffenen Personen mit `versorgung: "unterwegs"` zählen, der
zweite die angetroffenen Personen ohne Verbleib und ohne Unfallhilfsstelle, der dritte die
angetroffenen Personen mit `versorgung: "abgeschlossen"`. Die Kennzahl „Patienten“ MUST nur
Nicht-Abgeschlossene zählen und, wenn es Abgeschlossene gibt, die Notiz „n abgeschlossen“
tragen. Die Kennzahl „Vermisste“ SHALL als Notiz „n seit über 4 h“ tragen, wenn mindestens eine
vermisste Person seit mehr als vier Stunden vermisst wird. Die Notiz MUST mit der Zeit
fortschreiben, ohne dass neue Daten eintreffen.

#### Scenario: Transportiert / offen
- **WHEN** eine angetroffene Person im Eigentransport, zwei ohne Verbleib und drei mit fremdem Transport erfasst sind
- **THEN** zeigt das Paneel „Unterwegs / offen / abgeschlossen 1 / 2 / 3“

#### Scenario: Patienten ohne Abgeschlossene
- **WHEN** fünf Personen in SK I bis SK IV erfasst sind und zwei davon vor Ort entlassen wurden
- **THEN** zeigt die Kennzahl „Patienten“ den Wert 3 mit der Notiz „2 abgeschlossen“

#### Scenario: Vermisste seit über 4 h
- **WHEN** drei Personen vermisst werden, zwei davon seit mehr als vier Stunden
- **THEN** zeigt die Kennzahl „Vermisste“ den Wert 3 mit der Notiz „2 seit über 4 h“
