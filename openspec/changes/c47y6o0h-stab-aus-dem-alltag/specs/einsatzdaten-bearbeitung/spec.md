## MODIFIED Requirements

### Requirement: Gliederung der Seite
Die Seite Einsatzdaten SHALL ihre Angaben in dieser Reihenfolge zeigen:
1. Kopfleiste (Einsatzstichwort, Alarmzeit, Einsatzort, Einsatzleitung)
2. Paneel „Einsatz“
3. Paneel „Einsatzort“
4. Paneel „Erstmeldung“
5. Paneel „Eigene Führungsstelle“
6. Paneel „Stab“, nur mit Leserecht auf den Stab (Fähigkeiten `stab-uebersicht` und
   `stab-checkliste`)
7. zuletzt der Einsatzabschluss

Kopfleiste und Paneele MUST keine Angabe wiederholen. Die Kennungen im Seitenkopf sind eine
Lesekopie aus dem Paneel „Einsatz“, der Einsatzort in der Kopfleiste eine aus dem Paneel
„Einsatzort“. Die Seite MUST die volle Inhaltsbreite nutzen.

#### Scenario: Angaben je Paneel
- **WHEN** eine Person die Seite öffnet
- **THEN** trägt „Einsatz“ Bezeichnung, Einsatzart, Einsatznummer, Leitstellen-Nr. und Angelegt, „Einsatzort“ Adresse und Koordinate und „Erstmeldung“ Meldende Stelle, Sachverhalt / Meldebild und Anzahl Betroffene (initial)

#### Scenario: Handschirm ohne Querlauf
- **WHEN** die Seite bei 390 px Breite geöffnet wird
- **THEN** endet das Dokument bei 390 px, und die Paneele stehen untereinander

#### Scenario: Paneel Stab
- **WHEN** eine Person mit Leserecht auf den Stab die Seite öffnet
- **THEN** steht das Paneel „Stab“ mit Besetzung und Arbeitsaufnahme nach „Eigene Führungsstelle“
  und vor dem Einsatzabschluss
