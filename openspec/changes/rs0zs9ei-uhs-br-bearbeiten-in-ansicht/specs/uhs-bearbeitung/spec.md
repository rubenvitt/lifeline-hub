# Spec Delta

## Purpose

Regelt, wo und wie die Stammdaten einer Unfallhilfsstelle (Bezeichnung, Standort, Soll-Anzahl,
Qualifikationssoll, Notiz) gelesen und in ihrer Ansicht geändert werden, ohne die Änderung eines
anderen Arbeitsplatzes still zu überschreiben.

## ADDED Requirements

### Requirement: Stammdaten im Bereich „Angaben“
Die Detailseite einer UHS SHALL im Bereich „Angaben“ ein Paneel „Angaben“ mit Bezeichnung,
Standort, Soll-Anzahl, Qualifikationssoll und Notiz zeigen. Leere Angaben MUST als „—“ erscheinen.
Am gekoppelten Gerät MUST es den Bereich nicht geben.

#### Scenario: Angaben lesen
- **WHEN** jemand die UHS „BHP 50“ mit Standort „Halle 3“, Soll 6 und ohne Notiz öffnet und den
  Bereich „Angaben“ wählt
- **THEN** zeigt das Paneel „Angaben“ Bezeichnung „BHP 50“, Standort „Halle 3“, Soll-Anzahl 6 und
  bei der Notiz „—“

#### Scenario: Gerät ohne Angaben
- **WHEN** ein gekoppeltes UHS-Gerät die Seite mit `?bereich=angaben` öffnet
- **THEN** steht die Belegung, und es gibt keinen Bereich „Angaben“

### Requirement: Stammdaten im Paneel bearbeiten
Wer die UHS verwalten darf, SHALL ihre Stammdaten über „Bearbeiten“ im Kopf des Paneels „Angaben“
ändern, solange sie weder aufgelöst noch storniert ist. Das Paneel MUST dabei an seiner Stelle zu
Eingaben werden, mit „Speichern“ und „Abbrechen“ im Paneelfuß. Einen Dialog dafür und ein
„Bearbeiten“ im Seitenkopf MUST es nicht geben.

#### Scenario: Notiz ändern
- **WHEN** eine Person mit Verwaltungsrecht im Paneel „Angaben“ „Bearbeiten“ wählt, die Notiz
  „Zugang über Tor B“ einträgt und „Speichern“ wählt
- **THEN** zeigt das Paneel die Notiz, und die Beschreibungszeile im Seitenkopf nennt
  „Notiz: Zugang über Tor B“

#### Scenario: Kein Bearbeiten im Kopf
- **WHEN** eine Person mit Verwaltungsrecht eine aktive UHS öffnet
- **THEN** trägt der Seitenkopf kein „Bearbeiten“, und kein Dialog „Unfallhilfsstelle bearbeiten“
  ist erreichbar

#### Scenario: Aufgelöste Stelle
- **WHEN** jemand eine aufgelöste UHS im Bereich „Angaben“ öffnet
- **THEN** zeigt das Paneel die Angaben ohne „Bearbeiten“

#### Scenario: Ohne Verwaltungsrecht
- **WHEN** jemand ohne Recht, UHS zu verwalten, den Bereich „Angaben“ öffnet
- **THEN** zeigt das Paneel die Angaben ohne „Bearbeiten“

### Requirement: Speichern sendet nur Geändertes mit Basisstand
Das Speichern SHALL nur die geänderten Angaben senden, zusammen mit dem Stand, der beim Öffnen galt.
Ein geleertes optionales Feld MUST als `null` gehen; die Koordinate des Standorts MUST nur als Paar
und nur bei einer Änderung gehen. Hat ein anderer Arbeitsplatz die UHS seit dem Öffnen gespeichert,
MUST die Rückfrage „Zwischenzeitlich geändert“ kommen.

#### Scenario: Nur die Soll-Anzahl
- **WHEN** im offenen Paneel nur die Soll-Anzahl von 6 auf 8 geändert und gespeichert wird
- **THEN** enthält der Aufruf die Soll-Anzahl und den Basisstand, aber weder Bezeichnung noch
  Standort noch Notiz

#### Scenario: Gleichzeitig geändert
- **WHEN** nach dem Öffnen des Paneels ein anderer Arbeitsplatz die Bezeichnung speichert und hier
  danach die Notiz gespeichert wird
- **THEN** fragt die Seite „Zwischenzeitlich geändert“ mit „Meine Änderung übernehmen“ und
  „Verwerfen und neu laden“

#### Scenario: Notiz leeren
- **WHEN** im offenen Paneel die Notiz geleert und gespeichert wird
- **THEN** geht die Notiz als `null`, und das Paneel zeigt bei der Notiz „—“
