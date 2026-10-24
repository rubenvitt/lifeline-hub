## ADDED Requirements

### Requirement: Einstieg über das Modul Presse
Die Presseseite mit Presse-Log, Pressemitteilungen und Medienlage SHALL die Startseite des Moduls
Presse sein, das Informationstelefon sein zweiter Reiter (Fähigkeit `presse-modul`). Beide Seiten
MUST unter ihrer Adresse als Lesezeichen taugen. Die Navigation MUST dort die Presse als aktiv
zeigen. Jede Seite MUST die Freigabe der Presse ermitteln, bevor sie Daten zeigt. Ist die Freigabe
nicht ermittelbar, zeigt die Seite einen Fehler mit Wiederholen.

#### Scenario: Einstieg
- **WHEN** eine Person mit Leserecht auf die Presse im Modulmenü „Presse“ wählt
- **THEN** öffnet sich das Presse-Log des Einsatzes, und die Presse ist in der Navigation aktiv

#### Scenario: Presse gesperrt
- **WHEN** das Modul Presse für die Person gesperrt ist
- **THEN** sind Presseseite, Pressemitteilungen und Informationstelefon nicht erreichbar

## REMOVED Requirements

### Requirement: Einstieg aus der S5-Zeile
**Reason**: Die Stabseite entfällt, und die Presse ist ein eigenes Modul (LLH-1450).
**Migration**: „Einstieg über das Modul Presse“ in dieser Fähigkeit. Die Zahl der offenen
Presseanfragen zeigen das Werkzeug „Presse“ des Fachzugangs S5 und der Stabsmonitor.
