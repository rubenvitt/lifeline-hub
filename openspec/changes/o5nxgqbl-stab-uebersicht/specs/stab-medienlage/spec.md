# Spec Delta

## MODIFIED Requirements

### Requirement: Einstieg aus der S5-Zeile
Die Kachel S5 der Stabseite SHALL zwei Werkzeuge tragen: „Pressearbeit“ auf
`/einsaetze/:id/stab/presse` und „Informationstelefon“ auf `/einsaetze/:id/stab/infotelefon`.
„Pressearbeit“ SHALL die Zahl der offenen Presseanfragen zeigen, gezählt vom Server über den ganzen
Bestand des Presse-Logs. Beide Seiten MUST unter ihrer Adresse als Lesezeichen taugen. Die
Navigation MUST dort den Stab als aktiv zeigen. Keine der Seiten erscheint als eigenes Modul in Rail,
Modulpanel, Modulfreigabe oder Modulzähler.

Jede Seite MUST die Freigabe des Stabs ermitteln, bevor sie Daten zeigt. Ist die Freigabe nicht
ermittelbar, zeigt die Seite einen Fehler mit Wiederholen.

#### Scenario: Einstieg
- **WHEN** eine Person mit Leserecht auf den Stab in der Kachel S5 auf „Informationstelefon“ tippt
- **THEN** öffnet sich das Anrufprotokoll des Einsatzes, und das Stab-Modul ist in der Navigation
  aktiv

#### Scenario: Offene Anfragen
- **WHEN** im Presse-Log zwei Anfragen offen sind und eine erledigt ist
- **THEN** zeigt „Pressearbeit“ in der Kachel S5 „2“

#### Scenario: Stab gesperrt
- **WHEN** das Stab-Modul für die Person gesperrt ist
- **THEN** sind Presseseite, Pressemitteilungen und Informationstelefon nicht erreichbar
