## MODIFIED Requirements

### Requirement: Rechte und Lebenszyklus
Lesen SHALL jedes Einsatzmitglied mit Leserecht auf die Presse, auch die Beobachtung. Erfassen,
Bearbeiten und Statuswechsel MUST Schreibrecht im Einsatz und die Freigabe des Moduls Presse
verlangen. Am abgeschlossenen Einsatz ist das Presse-Log schreibgeschützt. Ein Medienkontakt eines
anderen Einsatzes MUST mit 404 beantwortet werden. Fehlendes Schreibrecht wird in der Oberfläche
erklärt, nicht still weggeschaltet.

#### Scenario: Beobachtung liest
- **WHEN** eine Person mit Rolle Beobachtung das Presse-Log öffnet
- **THEN** sieht sie die Kontakte, die Erfassung ist gesperrt, und ein Hinweis nennt den Grund

#### Scenario: Presse gesperrt
- **WHEN** das Modul Presse für den Einsatz ausgeblendet ist
- **THEN** antworten die Endpunkte des Presse-Logs mit der Modulsperre, und die Seite ist nicht
  erreichbar

#### Scenario: Stab gesperrt
- **WHEN** das Stab-Modul für den Einsatz ausgeblendet ist und die Presse nicht
- **THEN** ist das Presse-Log erreichbar und für Berechtigte bearbeitbar
