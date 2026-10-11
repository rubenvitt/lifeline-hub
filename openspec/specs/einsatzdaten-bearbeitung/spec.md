# einsatzdaten-bearbeitung Specification

## Purpose

Regelt, wie die Seite Einsatzdaten gegliedert ist und wie die Kopfdaten eines Einsatzes dort
geändert werden: jede Angabe einzeln in der Leseansicht, ohne zweiten Bearbeitungsweg (LFH-1170).

## Requirements

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

### Requirement: Zeitpunkte ohne Zonenversatz
Alarmzeit und Nächste Lagebesprechung SHALL in der Zeilenbearbeitung in der Anzeigezone
angezeigt werden, in der die Leseansicht sie zeigt (Fähigkeit `zeiteingabe`), und als
UTC-Zeitpunkt (`YYYY-MM-DD HH:mm:ss`) gesendet werden. Der gesendete Zeitpunkt MUST derselbe
absolute Zeitpunkt sein, den die Person gewählt hat, auch beidseits einer Sommerzeit-Umstellung
und auch dann, wenn die Zone des Browsers von der Anzeigezone abweicht.

#### Scenario: Alarmzeit an der Umstellung im März
- **WHEN** eine Person mit Anzeigezone `Europe/Berlin` die Alarmzeit auf 29.03.2026 03:30 Ortszeit setzt (01:30 UTC, nach der Umstellung)
- **THEN** sendet die Seite `begonnen_at: "2026-03-29 01:30:00"`

#### Scenario: Alarmzeit an der Umstellung im Oktober
- **WHEN** eine Person mit Anzeigezone `Europe/Berlin` die Alarmzeit auf 25.10.2026 01:30 Ortszeit setzt (23:30 UTC am Vortag, vor der Umstellung)
- **THEN** sendet die Seite `begonnen_at: "2026-10-24 23:30:00"`

#### Scenario: Unveränderte Alarmzeit
- **WHEN** eine Person die Alarmzeit-Bearbeitung öffnet und ohne Änderung speichert
- **THEN** geht keine Anfrage hinaus, weil der Wert beim Öffnen ohne Versatz übernommen wurde

#### Scenario: Browser in anderer Zone
- **WHEN** der Browser auf UTC steht, die Anzeigezone `Europe/Berlin` ist und die Leseansicht die Alarmzeit 14.07.2026 12:00 zeigt
- **THEN** zeigt die Zeilenbearbeitung ebenfalls 14.07.2026 12:00, und ein Setzen auf 13:00 sendet `begonnen_at: "2026-07-14 11:00:00"`

### Requirement: Ohne Schreibrecht keine Aufforderung
Ohne Schreibrecht im Einsatz (Beobachter, abgeschlossener Einsatz) MUST keine Zeile eine
Bearbeiten- oder Eintragen-Aufforderung tragen; leere Angaben zeigen „—". Mit Schreibrecht
SHALL jede zeilenweise bearbeitbare Angabe eine Aufforderung tragen, deren zugänglicher Name
die Angabe nennt; eine leere Angabe zeigt sichtbar eine Aufforderung zum Eintragen.

#### Scenario: Beobachter
- **WHEN** eine Person mit der Rolle Beobachter die Seite öffnet
- **THEN** gibt es keinen Knopf „… bearbeiten" oder „… eintragen" an einer Zeile

#### Scenario: Leere Angabe mit Schreibrecht
- **WHEN** eine schreibberechtigte Person die Seite eines Einsatzes ohne Meldende Stelle öffnet
- **THEN** zeigt die Zeile eine Aufforderung „Meldende Stelle eintragen"

### Requirement: Speicherfehler an der Zeile
Scheitert das Speichern einer Zeile, MUST der Fehler an dieser Zeile stehen und die Eingabe
mit dem eingegebenen Wert offen bleiben. Ein Erfolg SHALL die Zeile mit dem gespeicherten
Wert anzeigen und den Fokus auf die Zeile zurückgeben.

#### Scenario: Server lehnt ab
- **WHEN** der Server das Speichern der Leitstellen-Nr. ablehnt
- **THEN** steht der Fehler an der Zeile, die Eingabe zeigt weiter den eingegebenen Wert, und es erscheint kein Fehler-Toast

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
Einsatzabschluss. Kopfleiste und Paneele MUST keine Angabe wiederholen; die Kennungen im
Seitenkopf sind eine Lesekopie aus dem Paneel „Einsatz“. Die Seite MUST die volle
Inhaltsbreite nutzen.

#### Scenario: Angaben je Paneel
- **WHEN** eine Person die Seite öffnet
- **THEN** trägt „Einsatz“ Bezeichnung, Einsatzart, Einsatznummer, Leitstellen-Nr., Angelegt und Nächste Lagebesprechung, „Einsatzort“ die Koordinate und „Erstmeldung“ Meldende Stelle, Sachverhalt / Meldebild und Anzahl Betroffene (initial)

#### Scenario: Handschirm ohne Querlauf
- **WHEN** die Seite bei 390 px Breite geöffnet wird
- **THEN** endet das Dokument bei 390 px, und die Paneele stehen untereinander
