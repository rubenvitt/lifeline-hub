## ADDED Requirements

### Requirement: Kennungen im Seitenkopf
Die Seite Einsatzdaten SHALL Einsatznummer und Leitstellen-Nr. ohne Aufklappen im Seitenkopf
neben dem Titel zeigen, in Mono und in dieser Reihenfolge, getrennt durch „ · “. Fehlt eine der
beiden, MUST nur die vorhandene stehen; fehlen beide, MUST der Kopf keine leere Kennung zeigen.
Einen einklappbaren Bereich „Technische Angaben“ MUST es nicht geben.

#### Scenario: Beide Kennungen vorhanden
- **WHEN** eine Person die Einsatzdaten eines Einsatzes mit Einsatznummer `E-2026-0001` und Leitstellen-Nr. `ILS-4711` öffnet
- **THEN** zeigt der Seitenkopf `E-2026-0001 · ILS-4711`, ohne dass sie etwas aufklappt

#### Scenario: Nur die Einsatznummer
- **WHEN** der Einsatz keine Leitstellen-Nr. hat
- **THEN** zeigt der Seitenkopf nur die Einsatznummer, ohne Trennzeichen

#### Scenario: Kein Klappbereich mehr
- **WHEN** eine Person die Seite öffnet
- **THEN** gibt es keinen Auslöser „Technische Angaben“, und Einsatznummer, Leitstellen-Nr. und „Angelegt“ stehen sichtbar im Paneel „Einsatz“

### Requirement: Gliederung der Seite
Die Seite Einsatzdaten SHALL ihre Angaben in dieser Reihenfolge zeigen: Kopfleiste
(Einsatzstichwort, Alarmzeit, Einsatzort, Einsatzleitung), Paneel „Einsatz“, Paneel
„Einsatzort“, Paneel „Erstmeldung“, Paneel „Eigene Führungsstelle“, zuletzt der
Einsatzabschluss. Jede Angabe MUST genau einmal auf der Seite stehen. Die Seite MUST die volle
Inhaltsbreite nutzen.

#### Scenario: Angaben je Paneel
- **WHEN** eine Person die Seite öffnet
- **THEN** trägt „Einsatz“ Bezeichnung, Einsatzart, Einsatznummer, Leitstellen-Nr., Angelegt und Nächste Lagebesprechung, „Einsatzort“ die Koordinate und „Erstmeldung“ Meldende Stelle, Sachverhalt / Meldebild und Anzahl Betroffene (initial)

#### Scenario: Handschirm ohne Querlauf
- **WHEN** die Seite bei 390 px Breite geöffnet wird
- **THEN** endet das Dokument bei 390 px, und die Paneele stehen untereinander

## MODIFIED Requirements

### Requirement: Einzelne Angabe in der Leseansicht bearbeiten
Die Seite Einsatzdaten SHALL die folgenden Angaben einzeln in der Leseansicht bearbeitbar
machen: Bezeichnung, Einsatzstichwort, Alarmzeit, Einsatzort (Adresse), Koordinate,
Einsatzart, Nächste Lagebesprechung, Meldende Stelle, Sachverhalt / Meldebild, Anzahl
Betroffene (initial) und Leitstellen-Nr. Während eine Angabe bearbeitet wird, MUST die Seite in
der Leseansicht bleiben; alle übrigen Angaben bleiben sichtbar. Einsatzleitung, Einsatznummer
und „Angelegt“ MUST NOT zeilenweise bearbeitbar sein. Die Zeile ist der einzige
Bearbeitungsweg der Seite; ein Formular, das die Leseansicht ersetzt, MUST es nicht geben.

#### Scenario: Leitstellen-Nr. nachtragen
- **WHEN** eine schreibberechtigte Person an der Zeile „Leitstellen-Nr." die Bearbeitung öffnet, `ILS-4711` eingibt und speichert
- **THEN** zeigt die Zeile `ILS-4711`, der Seitenkopf nennt `ILS-4711`, und Einsatzstichwort, Alarmzeit, Einsatzort und die übrigen Angaben standen währenddessen durchgehend in der Leseansicht

#### Scenario: Bezeichnung ändern
- **WHEN** eine schreibberechtigte Person an der Zeile „Bezeichnung“ die Bearbeitung öffnet, „Hochwasser Nord“ eingibt und speichert
- **THEN** zeigt die Zeile „Hochwasser Nord“, und es ging genau `{ "bezeichnung": "Hochwasser Nord" }` an den Server

#### Scenario: Abbrechen lässt den Wert stehen
- **WHEN** eine Person die Bearbeitung einer Zeile öffnet, den Wert ändert und mit Escape oder „Abbrechen" verlässt
- **THEN** zeigt die Zeile den bisherigen Wert, und es geht keine Anfrage an den Server

#### Scenario: Nicht inline bearbeitbare Angaben
- **WHEN** eine schreibberechtigte Person die Seite öffnet
- **THEN** tragen Einsatzleitung, Einsatznummer und „Angelegt“ keine Bearbeiten-Aufforderung, und es gibt keinen Knopf „Bearbeiten“, der ein Formular öffnet

### Requirement: Eine Zeile schickt nur ihr eigenes Feld
Das Speichern einer Zeile SHALL genau die Felder ihrer Angabe an `PATCH /api/einsaetze/{id}`
senden: ein Feld je Zeile, die Koordinate als Paar `einsatzort_lat` und `einsatzort_lon`. Ist
der neue Wert gleich dem bisherigen, MUST keine Anfrage gesendet werden. Eine leer gespeicherte
optionale Angabe MUST als `null` gesendet werden, die geleerte Koordinate als beide Felder
`null`.

#### Scenario: Zwei Personen, zwei Zeilen
- **WHEN** Person A die Leitstellen-Nr. und Person B kurz danach aus einem älteren Seitenstand die Meldende Stelle speichert
- **THEN** enthält der Einsatz beide Änderungen, weil B's Anfrage die Leitstellen-Nr. nicht mitsendet

#### Scenario: Unveränderter Wert
- **WHEN** eine Person die Bearbeitung öffnet und ohne Änderung speichert
- **THEN** geht keine Anfrage an den Server, und die Zeile kehrt in die Anzeige zurück

#### Scenario: Optionale Angabe leeren
- **WHEN** eine Person den Einsatzort leert und speichert
- **THEN** sendet die Seite `{ "einsatzort": null }`, und die Zeile zeigt danach die Aufforderung zum Eintragen

#### Scenario: Koordinate setzen
- **WHEN** eine Person an der Zeile „Koordinate“ 52.52, 13.405 einträgt und speichert
- **THEN** sendet die Seite genau `{ "einsatzort_lat": 52.52, "einsatzort_lon": 13.405 }`

#### Scenario: Koordinate leeren
- **WHEN** eine Person die Koordinate leert und speichert
- **THEN** sendet die Seite `{ "einsatzort_lat": null, "einsatzort_lon": null }`

### Requirement: Pflichtangabe wird nicht leer gespeichert
Bezeichnung und Alarmzeit sind Pflichtangaben. Wird eine von ihnen in der Zeilenbearbeitung
geleert und gespeichert, MUST die Seite keine Anfrage senden, den bisherigen Wert wieder
anzeigen und an der Zeile sagen, dass die Angabe Pflicht ist. Die Einsatzart MUST NOT leer
auswählbar sein. Eine unlesbare Koordinate MUST NOT gesendet werden; die Eingabe bleibt offen,
und die Zeile nennt den Fehler.

#### Scenario: Alarmzeit geleert
- **WHEN** eine Person in der Zeile „Alarmzeit" den Wert leert und speichert
- **THEN** geht kein PATCH hinaus, die Zeile zeigt die bisherige Alarmzeit, und ein Hinweis an der Zeile nennt die Alarmzeit als Pflichtangabe

#### Scenario: Bezeichnung geleert
- **WHEN** eine Person in der Zeile „Bezeichnung“ nur Leerzeichen stehen lässt und speichert
- **THEN** geht kein PATCH hinaus, die Zeile zeigt die bisherige Bezeichnung, und ein Hinweis an der Zeile nennt die Bezeichnung als Pflichtangabe

#### Scenario: Unlesbare Koordinate
- **WHEN** eine Person in der Zeile „Koordinate“ einen Text eingibt, der sich nicht als Koordinate lesen lässt, und speichert
- **THEN** geht kein PATCH hinaus, die Eingabe zeigt weiter den Text, und die Zeile nennt den Fehler

## REMOVED Requirements

### Requirement: Vollformular bleibt
**Reason**: Zwei Bearbeitungswege für dieselben Angaben machten die Seite unübersichtlich (LFH-1170). Seit Bezeichnung und Koordinate eine Zeile haben, trägt das Formular keine Angabe mehr, die nur dort änderbar wäre.
**Migration**: Jede Angabe wird an ihrer Zeile bearbeitet; die gleichzeitige Änderung mehrerer Angaben entfällt. Den Schutz vor stillem Überschreiben (LFH-839) trägt die Zeile ohnehin, weil sie nur ihr Feld sendet.
