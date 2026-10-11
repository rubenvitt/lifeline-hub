# einsatzdaten-bearbeitung Specification

## Purpose

Regelt, wie die Kopfdaten eines Einsatzes auf der Seite Einsatzdaten geändert werden:
einzelne Angaben direkt in der Leseansicht, viele Angaben auf einmal über das Vollformular.

## Requirements

### Requirement: Einzelne Angabe in der Leseansicht bearbeiten
Die Seite Einsatzdaten SHALL die folgenden Angaben einzeln in der Leseansicht bearbeitbar
machen: Einsatzstichwort, Alarmzeit, Einsatzort (Adresse), Koordinate des Einsatzorts,
Einsatzart, Nächste Lagebesprechung, Meldende Stelle, Sachverhalt / Meldebild, Anzahl
Betroffene (initial) und Leitstellen-Nr. Während eine Angabe bearbeitet wird, MUST die Seite in
der Leseansicht bleiben; alle übrigen Angaben bleiben sichtbar. Bezeichnung, Einsatzleitung,
Einsatznummer und „Angelegt am" MUST NOT zeilenweise bearbeitbar sein. Adresse und Koordinate
des Einsatzorts MUST in einem Paneel „Einsatzort“ bearbeitet werden; die Kopfleiste zeigt den
Einsatzort nur an.

#### Scenario: Leitstellen-Nr. nachtragen
- **WHEN** eine schreibberechtigte Person an der Zeile „Leitstellen-Nr." die Bearbeitung öffnet, `ILS-4711` eingibt und speichert
- **THEN** zeigt die Zeile `ILS-4711`, und Einsatzstichwort, Alarmzeit, Einsatzort und die übrigen Angaben standen währenddessen durchgehend in der Leseansicht

#### Scenario: Abbrechen lässt den Wert stehen
- **WHEN** eine Person die Bearbeitung einer Zeile öffnet, den Wert ändert und mit Escape oder „Abbrechen" verlässt
- **THEN** zeigt die Zeile den bisherigen Wert, und es geht keine Anfrage an den Server

#### Scenario: Nicht inline bearbeitbare Angaben
- **WHEN** eine schreibberechtigte Person die Seite öffnet
- **THEN** tragen Einsatzleitung, Einsatznummer, „Angelegt am" und der Einsatzort in der Kopfleiste keine Bearbeiten-Aufforderung, und die Bezeichnung ist weiter nur über das Vollformular änderbar

#### Scenario: Koordinate nachtragen
- **WHEN** eine schreibberechtigte Person an der Zeile „Koordinate" im Paneel „Einsatzort" eine MGRS-Angabe eingibt und speichert
- **THEN** sendet die Seite `einsatzort_lat` und `einsatzort_lon` gemeinsam, und der Kartenausschnitt zeigt den Punkt

### Requirement: Eine Zeile schickt nur ihr eigenes Feld
Das Speichern einer Zeile SHALL nur die Felder ihrer Angabe an `PATCH /api/einsaetze/{id}`
senden. Eine Zeile trägt genau ein Feld, mit zwei Ausnahmen: Die Zeile „Koordinate“ sendet
`einsatzort_lat` und `einsatzort_lon` als Paar. Die Zeile „Adresse“ des Einsatzorts sendet mit
einem gewählten Treffer der Ortssuche `einsatzort`, `einsatzort_lat` und `einsatzort_lon` in einer
Anfrage; ohne gewählten Treffer sendet sie nur `einsatzort`, und die Koordinate bleibt. Ist der
neue Wert gleich dem bisherigen, MUST keine Anfrage gesendet werden. Eine leer gespeicherte
optionale Angabe MUST als `null` gesendet werden; eine geleerte Koordinate als Paar aus `null`.

#### Scenario: Zwei Personen, zwei Zeilen
- **WHEN** Person A die Leitstellen-Nr. und Person B kurz danach aus einem älteren Seitenstand die Meldende Stelle speichert
- **THEN** enthält der Einsatz beide Änderungen, weil B's Anfrage die Leitstellen-Nr. nicht mitsendet

#### Scenario: Unveränderter Wert
- **WHEN** eine Person die Bearbeitung öffnet und ohne Änderung speichert
- **THEN** geht keine Anfrage an den Server, und die Zeile kehrt in die Anzeige zurück

#### Scenario: Optionale Angabe leeren
- **WHEN** eine Person den Einsatzort leert und speichert
- **THEN** sendet die Seite `{ "einsatzort": null }`, und die Zeile zeigt danach die Aufforderung zum Eintragen

#### Scenario: Treffer speichert Adresse und Koordinate
- **WHEN** eine Person an der Zeile „Adresse“ nach „Bahnhofstraße 1“ sucht, den Treffer bei 51.1, 10.4 wählt und speichert
- **THEN** geht genau eine Anfrage mit `einsatzort`, `einsatzort_lat: 51.1` und `einsatzort_lon: 10.4` hinaus

#### Scenario: Nur die Adresse geändert
- **WHEN** eine Person an der Zeile „Adresse“ den Text ändert, ohne einen Treffer zu wählen, und speichert
- **THEN** sendet die Seite nur `einsatzort`, und die bisherige Koordinate bleibt

### Requirement: Pflichtangabe wird nicht leer gespeichert
Die Alarmzeit ist eine Pflichtangabe. Wird sie in der Zeilenbearbeitung geleert und
gespeichert, MUST die Seite keine Anfrage senden, den bisherigen Wert wieder anzeigen und an
der Zeile sagen, dass die Angabe Pflicht ist. Die Einsatzart MUST NOT leer auswählbar sein.

#### Scenario: Alarmzeit geleert
- **WHEN** eine Person in der Zeile „Alarmzeit" den Wert leert und speichert
- **THEN** geht kein PATCH hinaus, die Zeile zeigt die bisherige Alarmzeit, und ein Hinweis an der Zeile nennt die Alarmzeit als Pflichtangabe

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

### Requirement: Vollformular bleibt
Die Seite SHALL das Vollformular über „Bearbeiten" im Seitenkopf unverändert anbieten; es
ändert alle Kopfdaten einschließlich Bezeichnung und Koordinate auf einmal.

#### Scenario: Bezeichnung und Koordinate ändern
- **WHEN** eine schreibberechtigte Person „Bearbeiten" im Seitenkopf wählt
- **THEN** öffnet das Vollformular mit allen Kopfdaten, und Speichern sendet sie wie bisher

### Requirement: Paneel Einsatzort mit Kartenausschnitt
Die Seite Einsatzdaten SHALL ein Paneel „Einsatzort“ zeigen mit den Zeilen „Adresse“ und
„Koordinate“ und darunter einem Kartenausschnitt des Einsatzorts. Ist der Einsatzort verortet und
darf die Person die Lagekarte sehen, SHALL das Paneel den Sprung „Auf Lagekarte zeigen ↗“ tragen,
der die Lagekarte um den Einsatzort öffnet. In der Zeile „Koordinate“ direkt unter der Adresse
SHALL der Ortsname der Koordinate stehen, wie die Koordinatenanzeige ihn liefert, damit auffällt,
wenn Adresse und Koordinate auseinanderfallen.

#### Scenario: Verorteter Einsatz
- **WHEN** eine Person die Einsatzdaten eines Einsatzes mit Adresse und Koordinate öffnet
- **THEN** zeigt das Paneel „Einsatzort“ Adresse, Koordinate, den Kartenausschnitt mit Nadel und „Auf Lagekarte zeigen ↗“

#### Scenario: Nicht verortet
- **WHEN** der Einsatz eine Adresse, aber keine Koordinate trägt
- **THEN** zeigt der Ausschnitt „Nicht verortet“, und der Sprung zur Lagekarte fehlt

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person mit der Rolle Beobachter die Seite öffnet
- **THEN** zeigt das Paneel Adresse, Koordinate und Ausschnitt ohne Bearbeiten-Aufforderung und ohne Suche
