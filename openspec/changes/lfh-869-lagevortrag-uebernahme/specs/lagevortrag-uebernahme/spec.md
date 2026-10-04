# Spec Delta

## Purpose

Füllt einzelne Abschnitte des Lagevortrags zur Information auf Klick aus Lagedaten, die das
System schon hat, damit ein Lagevortrag ein Dokument bleibt und keine Zahl abgetippt wird.

## ADDED Requirements

### Requirement: Übernahme je Abschnitt des Lagevortrags zur Information
In einem Entwurf der Vorlage „Lagevortrag zur Information“ SHALL je ein Übernahme-Knopf in den
Abschnitten „Eigene Lage“, „Besondere (Führungs-)Probleme“, „Gefahren-/Schadenlage“,
„Lageentwicklung“ und „Medienlage“ stehen. Die Abschnitte „Auftrag“, „Anträge und Vorschläge“
und „Zusammenfassung“ sowie alle Abschnitte des „Lagevortrags zur Entscheidung“ und des freien
Berichts MUST ohne Übernahme bleiben.

#### Scenario: Knopf in der Eigenen Lage
- **WHEN** eine Person mit Schreibrecht einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** steht im Abschnitt „Eigene Lage“ ein Übernahme-Knopf mit einem Nebentext, der die
  Herkunft nennt

#### Scenario: Kein Knopf im Lagevortrag zur Entscheidung
- **WHEN** eine Person einen Entwurf „Lagevortrag zur Entscheidung“ öffnet
- **THEN** zeigt keiner seiner Abschnitte einen Übernahme-Knopf oder einen Übernahme-Hinweis

#### Scenario: Kein Knopf im Auftrag
- **WHEN** eine Person einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** zeigt der Abschnitt „Auftrag“ keinen Übernahme-Knopf

### Requirement: Übernahme nur auf Klick im Schreibzweig
Eine Übernahme MUST nur durch den Klick auf ihren Knopf geschehen und nur in einem Entwurf, den
die Person schreiben darf. Die Quelldaten MUST erst beim Klick geladen werden; ein Lagebericht,
in dem niemand übernimmt, MUST keine Quelldaten abrufen. Die Übernahme SHALL nur das Formular
ändern und den Entwurf als geändert markieren; gespeichert wird mit dem nächsten Speichern.

#### Scenario: Freigegebener Bericht
- **WHEN** eine Person einen freigegebenen Lagevortrag öffnet
- **THEN** zeigt kein Abschnitt einen Übernahme-Knopf

#### Scenario: Öffnen ohne Klick
- **WHEN** eine Person einen Entwurf öffnet und keinen Übernahme-Knopf betätigt
- **THEN** ruft die Seite keine Liste einer Übernahmequelle ab

#### Scenario: Übernahme in einen leeren Abschnitt
- **WHEN** die Person im leeren Abschnitt „Gefahren-/Schadenlage“ auf den Knopf tippt
- **THEN** steht der übernommene Text im Abschnitt, und der Entwurf gilt als ungespeichert
  geändert

### Requirement: Kein stilles Ersetzen
Enthält der Abschnitt schon Text, MUST eine Rückfrage das Ersetzen bestätigen lassen. Erst nach
Bestätigung SHALL der Text ersetzt werden; Abbrechen MUST den Abschnitt unverändert lassen.

#### Scenario: Gefüllter Abschnitt, bestätigt
- **WHEN** der Abschnitt „Eigene Lage“ Text enthält und die Person übernimmt und das Ersetzen
  bestätigt
- **THEN** steht nur der übernommene Text im Abschnitt

#### Scenario: Gefüllter Abschnitt, abgebrochen
- **WHEN** die Person die Rückfrage abbricht
- **THEN** bleibt der bisherige Text unverändert, und der Entwurf gilt nicht als geändert

### Requirement: Rechteweiche je Quelle
Jede Übernahme MUST nur Module lesen, die der Server für die Person freigibt. Ein gesperrtes
Modul MUST nicht angefragt werden; seine Angaben MUST im Text als „—“ mit Grund stehen, nie als
0. Ist kein Modul einer Übernahme freigegeben oder sind die Freigaben nicht ermittelt, MUST der
Abschnitt statt des Knopfs einen Hinweis mit dem Grund zeigen.

#### Scenario: Teilweise freigegeben
- **WHEN** für die Person das Modul Personen gesperrt und Gefahrenzonen freigegeben ist und sie
  die Gefahren-/Schadenlage übernimmt
- **THEN** stehen Betroffene, Vermisste und Sichtung als „— (nicht freigegeben)“ im Text, die
  Warnstufe mit ihrem Wert, und es wurde keine Personenliste angefragt

#### Scenario: Nichts freigegeben
- **WHEN** keines der Module, aus denen die Eigene Lage liest, für die Person freigegeben ist
- **THEN** zeigt der Abschnitt statt des Knopfs einen Hinweis, dass die Übernahme mangels
  Freigabe nicht möglich ist, und nennt die Module

#### Scenario: Freigaben nicht geladen
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt der Abschnitt einen Hinweis „Freigaben nicht geladen“ mit der Möglichkeit, es
  erneut zu versuchen, und keinen Knopf

### Requirement: Stand und Personenbezug im übernommenen Text
Jeder übernommene Text MUST mit dem Stand als taktische DTG beginnen; der Stand MUST der älteste
Datenstand der gelesenen Quellen sein, nicht der Zeitpunkt des Klicks. Der Text MUST keine Namen
von Personen, keine Erreichbarkeiten und keinen Freitext aus Personen-, Auftrags-, Meldungs- oder
ETB-Feldern enthalten.

#### Scenario: Stand aus dem Zwischenspeicher
- **WHEN** die Listen der Eigenen Lage seit 10 Minuten im Zwischenspeicher liegen und die Person
  übernimmt
- **THEN** nennt die erste Zeile des Texts den Stand dieser Listen, nicht die Uhrzeit des Klicks

#### Scenario: Leitung ohne Namen
- **WHEN** ein Abschnitt eine Leitung mit Namen hat und die Person die Eigene Lage übernimmt
- **THEN** steht „Leitung besetzt“ im Text, und der Name kommt nicht vor

### Requirement: Zahlen wie Dashboard und Vorbereitung
Jede Zahl im übernommenen Text MUST nach derselben Regel entstehen wie die gleichnamige Angabe im
Lage-Dashboard, in der Vorbereitung der Lagebesprechung bzw. im Funkplan. Aus denselben Daten
MUST derselbe Wert folgen.

#### Scenario: Gesamtstärke
- **WHEN** das Dashboard die Kennzahl „Kräfte“ mit 48 zeigt und die Person die Eigene Lage aus
  denselben Daten übernimmt
- **THEN** nennt der Text die Gesamtstärke 48 mit derselben Schreibweise F/UF/M//Ges

#### Scenario: Überfällige Aufträge
- **WHEN** die Vorbereitung „3 überfällig“ an den offenen Aufträgen zeigt
- **THEN** nennt die Übernahme der Führungsprobleme 3 überfällige Aufträge und listet genau diese
  drei

### Requirement: Inhalt der Eigenen Lage
Die Übernahme der Eigenen Lage SHALL Kräfte (Gesamtstärke, Zahl der Einheiten, Fahrzeuge nach
Verfügbarkeit, Stärke je oberstem Einsatzabschnitt) und die Führungsorganisation (Gliederung der
Abschnitte mit Rufname und ob die Leitung besetzt ist, besetzte Sachgebiete des Stabs als
Kürzel) enthalten. Einzelne Personen, Fahrzeuge und Materialien MUST nicht aufgeführt werden.

#### Scenario: Gliederung
- **WHEN** der Einsatz die Abschnitte „Nord“ (Rufname „Florian Nord 1“, Leitung besetzt) und
  „Süd“ (ohne Leitung) hat
- **THEN** nennt der Text beide Abschnitte mit Rufname bzw. „kein Rufname“ und „Leitung besetzt“
  bzw. „Leitung nicht besetzt“

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
- **THEN** nennt der Teil Funkplan „Einheiten ohne Sprechgruppe: 1 (ELW 1)“ wie die
  Funkplan-Seite

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
zusammenfassen, gemessen an der laufenden Nummer. System-Einträge und die Einträge früherer
Lageberichte MUST ausgenommen sein. Der Text SHALL die Zahl der neuen Einträge je Typ und die neuen
Entscheidungen mit Nummer und Zeit nennen, ohne deren Wortlaut. Ohne abgehaltene Lagebesprechung
MUST der Text „seit Einsatzbeginn“ sagen.

#### Scenario: Nachgetragener Eintrag
- **WHEN** nach der Lagebesprechung ein Eintrag mit einer früheren Ereigniszeit erfasst wird
- **THEN** zählt er zu den Neuerungen

#### Scenario: Früherer Lagevortrag
- **WHEN** seit der Lagebesprechung ein Lagevortrag freigegeben wurde
- **THEN** zählt sein ETB-Eintrag nicht zu den Neuerungen

#### Scenario: Noch keine Lagebesprechung
- **WHEN** im Einsatz noch keine Lagebesprechung abgehalten wurde
- **THEN** beginnt die Zusammenfassung mit „seit Einsatzbeginn“
