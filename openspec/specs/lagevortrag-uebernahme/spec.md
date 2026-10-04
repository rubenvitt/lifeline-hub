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

### Requirement: Weitere Abschnitte des Lagevortrags zur Information
Im Lagevortrag zur Information SHALL je eine Übernahme in den Abschnitten „Besondere
(Führungs-)Probleme“, „Gefahren-/Schadenlage“ und „Lageentwicklung“ stehen. Die Abschnitte
„Auftrag“, „Anträge und Vorschläge“ und „Zusammenfassung“ MUST ohne Übernahme bleiben.

#### Scenario: Knopf in der Gefahren-/Schadenlage
- **WHEN** eine Person mit Schreibrecht einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** steht im Abschnitt „Gefahren-/Schadenlage“ ein Übernahme-Knopf mit einem Nebentext,
  der die Herkunft nennt

#### Scenario: Kein Knopf im Auftrag
- **WHEN** eine Person einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** zeigt der Abschnitt „Auftrag“ keinen Übernahme-Knopf

### Requirement: Stand und kein Freitext in den weiteren Abschnitten
Der übernommene Text dieser Abschnitte MUST mit dem Stand als taktische DTG beginnen; der Stand
MUST der älteste Datenstand der gelesenen Quellen sein. Der Text MUST keinen Freitext aus
Auftrags-, Meldungs-, ETB-, Personen- oder Schadensfeldern und keine Angaben zu Betroffenen außer
Zahlen enthalten.

#### Scenario: Stand aus dem Zwischenspeicher
- **WHEN** die Listen seit 10 Minuten im Zwischenspeicher liegen und die Person die
  Gefahren-/Schadenlage übernimmt
- **THEN** nennt die erste Zeile den Stand dieser Listen, nicht die Uhrzeit des Klicks

#### Scenario: Auftragstext bleibt draußen
- **WHEN** ein überfälliger Auftrag den Text „Familie Müller evakuieren“ trägt
- **THEN** nennt die Übernahme den Auftrag mit Nummer und Frist, und der Text kommt nicht vor

### Requirement: Zahlen wie Dashboard, Vorbereitung und Funkplan
Jede Zahl in diesen Abschnitten MUST nach derselben Regel entstehen wie die gleichnamige Angabe im
Lage-Dashboard, in der Vorbereitung der Lagebesprechung bzw. im Funkplan; aus denselben Daten MUST
derselbe Wert folgen. Eine gesperrte oder nicht geladene Quelle MUST als „—“ mit Grund stehen, nie
als 0.

#### Scenario: Überfällige Aufträge
- **WHEN** die Vorbereitung „3 überfällig“ an den offenen Aufträgen zeigt
- **THEN** nennt die Übernahme der Führungsprobleme 3 überfällige Aufträge und listet genau diese
  drei

#### Scenario: Betroffene gesperrt
- **WHEN** das Modul Personen für die Person gesperrt ist und sie die Gefahren-/Schadenlage
  übernimmt
- **THEN** stehen Betroffene, Vermisste und Sichtung als „— (nicht freigegeben)“, und es wurde
  keine Personenliste angefragt

### Requirement: Inhalt der Besonderen (Führungs-)Probleme
Die Übernahme SHALL überfällige offene Aufträge (Zahl und je Auftrag Nummer und Frist), Meldungen
mit überfälliger Bestätigung (Zahl und je Meldung Nummer, Art und Frist), die Zahl noch nicht
gesichteter Meldungen und die Lücken des Funkplans enthalten. Ein Teil ohne Befund MUST „keine“
sagen.

#### Scenario: Keine Probleme
- **WHEN** kein Auftrag überfällig ist, keine Bestätigung aussteht und der Funkplan keine Lücke
  hat
- **THEN** sagt jeder der drei Teile „keine“

#### Scenario: Funkplan-Lücke
- **WHEN** der Einheit „ELW 1“ keine Sprechgruppe zugeordnet ist
- **THEN** nennt der Teil Funkplan „Einheiten ohne Sprechgruppe: 1 (ELW 1)“ wie der Funkplan im
  Lagebericht

### Requirement: Inhalt der Gefahren-/Schadenlage
Die Übernahme SHALL Betroffene, Vermisste, Sichtung nach Kategorien, offene Schäden, die höchste
Warnstufe mit der Zahl der Gebiete, geltende und angekündigte Wetterwarnungen, die aktuellen
Bedingungen am Einsatzort und je maßgeblichem Pegel Stand und Trend enthalten. Fehlt ein
Einsatzort oder ein Pegel, MUST der Text das sagen statt einer leeren Zeile.

#### Scenario: Ohne Einsatzort
- **WHEN** der Einsatz keinen Ort hat und die Person die Gefahren-/Schadenlage übernimmt
- **THEN** sagt der Teil Wetter „kein Einsatzort“, und die übrigen Teile tragen ihre Werte

#### Scenario: Pegel
- **WHEN** zwei maßgebliche Pegel festgelegt sind
- **THEN** nennt der Text beide mit Gewässer, Stand, Trend und Messzeit in der festgelegten
  Reihenfolge

### Requirement: Inhalt der Lageentwicklung
Die Übernahme SHALL die ETB-Einträge seit dem Eintrag der letzten abgehaltenen Lagebesprechung
zusammenfassen, gemessen an der laufenden Nummer. System-Einträge und die Einträge freigegebener
Lageberichte MUST ausgenommen sein. Der Text SHALL die Zahl der neuen Einträge je Typ und die neuen
Entscheidungen mit Nummer und Zeit nennen, ohne Wortlaut. Ohne abgehaltene Lagebesprechung MUST er
„seit Einsatzbeginn“ sagen.

#### Scenario: Nachgetragener Eintrag
- **WHEN** nach der Lagebesprechung ein Eintrag mit einer früheren Ereigniszeit erfasst wird
- **THEN** zählt er zu den Neuerungen

#### Scenario: Früherer Lagevortrag
- **WHEN** seit der Lagebesprechung ein Lagevortrag freigegeben wurde
- **THEN** zählt sein ETB-Eintrag nicht zu den Neuerungen

#### Scenario: Noch keine Lagebesprechung
- **WHEN** im Einsatz noch keine Lagebesprechung abgehalten wurde
- **THEN** beginnt die Zusammenfassung mit „seit Einsatzbeginn“
