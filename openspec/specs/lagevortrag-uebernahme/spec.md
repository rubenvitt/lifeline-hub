# lagevortrag-uebernahme Specification

## Purpose
Einzelne Abschnitte eines Lagevortrag-Entwurfs lassen sich aus Lagedaten füllen, die das System
ohnehin führt, ohne den Lagevortrag zu verlassen. Die Fähigkeit legt die gemeinsamen Bedienregeln,
die Rechteprüfung je Quelle und die angebundenen Abschnitte fest.

## Requirements

### Requirement: Übernahme in einen Abschnitt des Lagevortrags
Ein Abschnitt der Vorlage „Lagevortrag zur Information“, dem eine Quelle zugeordnet ist, SHALL
im Entwurf einen Übernahme-Knopf tragen. Für die übrigen Abschnitte und für alle anderen Vorlagen
MUST kein Übernahme-Knopf erscheinen. Die Übernahme MUST nur auf Klick geschehen und nur im
Schreibzweig (Entwurf und Schreibrecht) angeboten werden. Die Daten der Quelle MUST erst beim
Klick geladen werden. Die Übernahme setzt den Text so ein:
- Ist der Abschnitt leer, geschieht das ohne Rückfrage.
- Ist er gefüllt, MUST eine Rückfrage das Ersetzen bestätigen lassen; „Abbrechen“ lässt den Text
  unverändert.

Die Übernahme MUST nur das Formular ändern und den Entwurf als geändert melden. Gespeichert wird
mit dem nächsten Speichern oder Autosave.

#### Scenario: Leerer Abschnitt
- **WHEN** die Person im leeren Abschnitt „Eigene Lage“ auf den Übernahme-Knopf tippt
- **THEN** steht der übernommene Text im Abschnitt, und der Entwurf gilt als geändert

#### Scenario: Gefüllter Abschnitt
- **WHEN** der Abschnitt „Eigene Lage“ schon Text enthält und die Person übernimmt
- **THEN** fragt die Oberfläche, ob der Text ersetzt werden soll, und ersetzt ihn erst nach
  Bestätigung

#### Scenario: Freigegebener Bericht
- **WHEN** ein freigegebener Lagevortrag angezeigt wird
- **THEN** steht in keinem Abschnitt ein Übernahme-Knopf

#### Scenario: Lagevortrag zur Entscheidung
- **WHEN** ein Entwurf der Vorlage „Lagevortrag zur Entscheidung“ bearbeitet wird
- **THEN** trägt kein Abschnitt einen Übernahme-Knopf

### Requirement: Rechte je Quelle und Hinweis bei Sperre
Jede Quelle SHALL ihre Freigabe selbst prüfen, bevor sie Daten lädt. Ist keine Quelle eines
Abschnitts für die Person freigegeben, MUST der Knopf fehlen und an seiner Stelle ein Hinweis mit
dem Grund stehen. Solange die Freigaben nicht ermittelt sind, MUST weder Knopf noch Hinweis
stehen; ist die Freigabe nicht ermittelbar, MUST ein Hinweis das sagen. Ist nur ein Teil der
Quellen frei, MUST der Knopf stehen; der gesperrte Teil MUST im übernommenen Text mit „—“ und
Grund erscheinen, nie mit 0. Dasselbe gilt für eine Quelle, die beim Klick nicht geladen werden
kann.

#### Scenario: Alle Quellen gesperrt
- **WHEN** für die Person weder Meldebild noch Führungsorganisation freigegeben sind
- **THEN** zeigt der Abschnitt „Eigene Lage“ keinen Übernahme-Knopf, sondern einen Hinweis, der
  die fehlenden Freigaben nennt

#### Scenario: Teil gesperrt
- **WHEN** das Personal für die Person nicht freigegeben ist, Abschnitte und Einheiten aber schon
- **THEN** steht der Knopf, und der übernommene Text führt das Kräftemeldebild als „—“ mit Grund
  und die Führungsorganisation vollständig

#### Scenario: Quelle scheitert beim Klick
- **WHEN** die Abschnitte beim Klick nicht geladen werden können
- **THEN** steht für die betroffenen Teile „—“ mit Grund im Text, und der Abschnitt bleibt
  bearbeitbar

### Requirement: Eigene Lage aus Meldebild und Führungsorganisation
Der Abschnitt „Eigene Lage“ des Lagevortrags zur Information SHALL das Kräftemeldebild und die
Führungsorganisation des ganzen Einsatzes übernehmen können, in dieser Reihenfolge. Jeder Teil
MUST denselben Text tragen wie die Fassung, die „In Lagebericht übernehmen“ im Meldebild (ohne
Filter) bzw. im Organigramm erzeugt, mit derselben Zahl an jeder Stelle. Jeder Teil MUST seinen
Stand (DTG) im Text tragen; der Stand ist der älteste Abruf der Listen, aus denen der Teil
gerechnet wurde. Die Übernahme MUST keine zweite Verdichtung rechnen.

#### Scenario: Gleicher Text wie die Einzelübernahme
- **WHEN** die Person „Eigene Lage“ übernimmt und im selben Datenstand das Meldebild und das
  Organigramm in einen Lagebericht übernimmt
- **THEN** stimmen die beiden Teile in „Eigene Lage“ wörtlich mit den Texten der beiden neuen
  Freitext-Berichte überein, bis auf den Stand

#### Scenario: Stand im Text
- **WHEN** die Person „Eigene Lage“ übernimmt
- **THEN** nennt jeder Teil eine Zeile „Stand:“ mit einer taktischen DTG
