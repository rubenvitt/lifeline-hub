# Spec Delta

## MODIFIED Requirements

### Requirement: Live-Verteilung

Das System MUST nach erfolgreichem Ablegen und Entfernen das Ereignis `schaden` und das
ETB-Ereignis an die Abonnenten des Einsatzes verteilen, beide ohne Dateinamen oder andere
Inhalte. Das Ereignis `schaden` MUST nur Personen mit Zugriff auf das Modul Schäden
erreichen und MUST sich als Anhang-Änderung zu erkennen geben. Andere Sitzungen MUST die
Anhangliste des Schadens daraufhin neu laden, ohne dass die Person die Seite neu lädt. Sie
MUST NOT deshalb Schadenliste oder Schadenmarker neu laden.

#### Scenario: Zweite Sitzung sieht die neue Datei
- **WHEN** Person A an S-003 eine Datei ablegt, während Person B die Detailseite von S-003 geöffnet hat
- **THEN** erscheint die Datei bei B ohne Neuladen, und das Tagebuch zeigt den neuen Eintrag

#### Scenario: Nutzlast ohne Inhalt
- **WHEN** das System nach einer Ablage die Ereignisse verteilt
- **THEN** enthalten sie nur Kennungen (Einsatz, Schaden, ETB-Eintrag), das Kennzeichen der
  Anhang-Änderung und keinen Dateinamen

#### Scenario: Foto lädt keine Liste
- **WHEN** Person A an S-003 ein Foto ablegt, während Person B Lagekarte und Schadenliste offen hat
- **THEN** ruft B weder die Schadenliste noch die Schadenmarker neu ab
