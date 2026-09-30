# einsatzdaten-bearbeitung Specification

## Purpose

Regelt, wie die Kopfdaten eines Einsatzes auf der Seite Einsatzdaten geändert werden:
einzelne Angaben direkt in der Leseansicht, viele Angaben auf einmal über das Vollformular.

## Requirements

### Requirement: Einzelne Angabe in der Leseansicht bearbeiten
Die Seite Einsatzdaten SHALL die folgenden Angaben einzeln in der Leseansicht bearbeitbar
machen: Einsatzstichwort, Alarmzeit, Einsatzort (Adresse), Einsatzart, Nächste
Lagebesprechung, Meldende Stelle, Sachverhalt / Meldebild, Anzahl Betroffene (initial) und
Leitstellen-Nr. Während eine Angabe bearbeitet wird, MUST die Seite in der Leseansicht bleiben;
alle übrigen Angaben bleiben sichtbar. Bezeichnung, Koordinate, Einsatzleitung, Einsatznummer
und „Angelegt am" MUST NOT zeilenweise bearbeitbar sein.

#### Scenario: Leitstellen-Nr. nachtragen
- **WHEN** eine schreibberechtigte Person an der Zeile „Leitstellen-Nr." die Bearbeitung öffnet, `ILS-4711` eingibt und speichert
- **THEN** zeigt die Zeile `ILS-4711`, und Einsatzstichwort, Alarmzeit, Einsatzort und die übrigen Angaben standen währenddessen durchgehend in der Leseansicht

#### Scenario: Abbrechen lässt den Wert stehen
- **WHEN** eine Person die Bearbeitung einer Zeile öffnet, den Wert ändert und mit Escape oder „Abbrechen" verlässt
- **THEN** zeigt die Zeile den bisherigen Wert, und es geht keine Anfrage an den Server

#### Scenario: Nicht inline bearbeitbare Angaben
- **WHEN** eine schreibberechtigte Person die Seite öffnet
- **THEN** tragen Koordinate, Einsatzleitung, Einsatznummer und „Angelegt am" keine Bearbeiten-Aufforderung, und die Bezeichnung ist weiter nur über das Vollformular änderbar

### Requirement: Eine Zeile schickt nur ihr eigenes Feld
Das Speichern einer Zeile SHALL genau ein Feld an `PATCH /api/einsaetze/{id}` senden, das
Feld dieser Zeile. Die Koordinate MUST NOT Teil einer Zeilenspeicherung sein. Ist der neue
Wert gleich dem bisherigen, MUST keine Anfrage gesendet werden. Eine leer gespeicherte
optionale Angabe MUST als `null` gesendet werden.

#### Scenario: Zwei Personen, zwei Zeilen
- **WHEN** Person A die Leitstellen-Nr. und Person B kurz danach aus einem älteren Seitenstand die Meldende Stelle speichert
- **THEN** enthält der Einsatz beide Änderungen, weil B's Anfrage die Leitstellen-Nr. nicht mitsendet

#### Scenario: Unveränderter Wert
- **WHEN** eine Person die Bearbeitung öffnet und ohne Änderung speichert
- **THEN** geht keine Anfrage an den Server, und die Zeile kehrt in die Anzeige zurück

#### Scenario: Optionale Angabe leeren
- **WHEN** eine Person den Einsatzort leert und speichert
- **THEN** sendet die Seite `{ "einsatzort": null }`, und die Zeile zeigt danach die Aufforderung zum Eintragen

### Requirement: Pflichtangabe wird nicht leer gespeichert
Die Alarmzeit ist eine Pflichtangabe. Wird sie in der Zeilenbearbeitung geleert und
gespeichert, MUST die Seite keine Anfrage senden, den bisherigen Wert wieder anzeigen und an
der Zeile sagen, dass die Angabe Pflicht ist. Die Einsatzart MUST NOT leer auswählbar sein.

#### Scenario: Alarmzeit geleert
- **WHEN** eine Person in der Zeile „Alarmzeit" den Wert leert und speichert
- **THEN** geht kein PATCH hinaus, die Zeile zeigt die bisherige Alarmzeit, und ein Hinweis an der Zeile nennt die Alarmzeit als Pflichtangabe

### Requirement: Zeitpunkte ohne Zonenversatz
Alarmzeit und Nächste Lagebesprechung SHALL in der Zeilenbearbeitung in der lokalen Zeit
angezeigt werden, in der die Leseansicht sie zeigt, und als UTC-Zeitpunkt
(`YYYY-MM-DD HH:mm:ss`) gesendet werden. Der gesendete Zeitpunkt MUST derselbe absolute
Zeitpunkt sein, den die Person gewählt hat, auch beidseits einer Sommerzeit-Umstellung.

#### Scenario: Alarmzeit an der Umstellung im März
- **WHEN** eine Person in `Europe/Berlin` die Alarmzeit auf 29.03.2026 03:30 Ortszeit setzt (01:30 UTC, nach der Umstellung)
- **THEN** sendet die Seite `begonnen_at: "2026-03-29 01:30:00"`

#### Scenario: Alarmzeit an der Umstellung im Oktober
- **WHEN** eine Person in `Europe/Berlin` die Alarmzeit auf 25.10.2026 01:30 Ortszeit setzt (23:30 UTC am Vortag, vor der Umstellung)
- **THEN** sendet die Seite `begonnen_at: "2026-10-24 23:30:00"`

#### Scenario: Unveränderte Alarmzeit
- **WHEN** eine Person die Alarmzeit-Bearbeitung öffnet und ohne Änderung speichert
- **THEN** geht keine Anfrage hinaus, weil der Wert beim Öffnen ohne Versatz übernommen wurde

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

### Requirement: Vollformular bleibt
Die Seite SHALL das Vollformular über „Bearbeiten" im Seitenkopf unverändert anbieten; es
ändert alle Kopfdaten einschließlich Bezeichnung und Koordinate auf einmal.

#### Scenario: Bezeichnung und Koordinate ändern
- **WHEN** eine schreibberechtigte Person „Bearbeiten" im Seitenkopf wählt
- **THEN** öffnet das Vollformular mit allen Kopfdaten, und Speichern sendet sie wie bisher
