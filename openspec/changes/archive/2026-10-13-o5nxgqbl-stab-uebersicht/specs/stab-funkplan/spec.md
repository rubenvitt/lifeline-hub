# Spec Delta

## ADDED Requirements

### Requirement: Zahl der Lücken
Das Lücken-Paneel des Funkplans SHALL in seinem Kopf die Zahl der Lücken zeigen („3 Lücken“). Sie
ist die Summe der Zahlen aus „Lücken oberhalb der Tabelle“, die Leitstelle ohne Verbindung zählt
dabei als eine Lücke. Die fehlende eigene Gegenstelle zählt nicht mit, sie ist ein Hinweis auf den
Pflegeort. Ein Datensatz, der unter zwei Lücken fällt, zählt bei jeder. Zeigt auch nur eine der
summierten Zahlen „—“, MUST die Zahl der Lücken entfallen bzw. „—“ mit dem Grund der schlechtesten
Quelle zeigen und MUST NOT eine Teilsumme zeigen. Die Stab-Seite MUST dieselbe Zahl aus derselben
Rechnung zeigen. Sie MUST in jeder Darstellung des Funkplans dieselbe sein.

#### Scenario: Summe
- **WHEN** das Lücken-Paneel „1“ bei „Abschnitte ohne Sprechgruppe“, „1“ bei „Einheiten ohne Sprechgruppe“ und „1“ bei „Einheiten ohne Erreichbarkeit“ zeigt, für dieselbe Einheit, und sonst keine Lücke
- **THEN** zeigt der Kopf des Lücken-Paneels „3 Lücken“, und die S6-Kachel der Stab-Seite zeigt „3“ am Funkplan

#### Scenario: Keine Lücke
- **WHEN** keine der Lücken zutrifft und alle Quellen geladen sind
- **THEN** zeigt der Kopf „0 Lücken“

#### Scenario: Quelle gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigt der Kopf keine Teilsumme, und die S6-Kachel zeigt „—“ mit dem Grund „nicht freigegeben“
