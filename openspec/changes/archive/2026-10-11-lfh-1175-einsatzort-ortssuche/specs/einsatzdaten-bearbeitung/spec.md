## MODIFIED Requirements

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

## ADDED Requirements

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
