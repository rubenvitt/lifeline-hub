## MODIFIED Requirements

### Requirement: Lage-Dashboard zeigt Transport und Vermisstendauer
Das Lage-Dashboard SHALL im Sichtungspaneel die Zeile „Unterwegs / offen / abgeschlossen“
zeigen. Der erste Wert MUST die angetroffenen Personen mit `versorgung: "unterwegs"` zählen, der
zweite die angetroffenen Personen ohne Verbleib und ohne Unfallhilfsstelle, der dritte die
angetroffenen Personen mit `versorgung: "abgeschlossen"`. Die Patientenzahl (Notiz der Kennzahl
„Betroffene“) MUST nur Nicht-Abgeschlossene zählen und, wenn es Abgeschlossene gibt, „· n
abgeschlossen“ anfügen. Die Notiz der Kennzahl „Verbleib offen“ MUST „wohin nicht erfasst · n unterwegs“ lauten, ohne Unterwegs nur „wohin nicht erfasst“. Die Kennzahl „Vermisste“ SHALL als Notiz „n seit über 4 h“ tragen, wenn mindestens eine
vermisste Person seit mehr als vier Stunden vermisst wird. Die Notiz MUST mit der Zeit
fortschreiben, ohne dass neue Daten eintreffen.

#### Scenario: Transportiert / offen
- **WHEN** eine angetroffene Person im Eigentransport, zwei ohne Verbleib und drei mit fremdem Transport erfasst sind
- **THEN** zeigt das Paneel „Unterwegs / offen / abgeschlossen 1 / 2 / 3“

#### Scenario: Patienten ohne Abgeschlossene
- **WHEN** fünf Personen in SK I bis SK IV erfasst sind und zwei davon vor Ort entlassen wurden
- **THEN** trägt die Kennzahl „Betroffene“ die Notiz „3 Patienten · 2 abgeschlossen“

#### Scenario: Vermisste seit über 4 h
- **WHEN** drei Personen vermisst werden, zwei davon seit mehr als vier Stunden
- **THEN** zeigt die Kennzahl „Vermisste“ den Wert 3 mit der Notiz „2 seit über 4 h“

#### Scenario: Verbleib offen erklärt sich
- **WHEN** zwei angetroffene Personen ohne Verbleib und eine im Eigentransport erfasst sind
- **THEN** zeigt die Kennzahl „Verbleib offen“ den Wert 2 mit der Notiz „wohin nicht erfasst · 1 unterwegs“

