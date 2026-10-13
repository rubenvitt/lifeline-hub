## MODIFIED Requirements

### Requirement: Einzelne Angabe in der Leseansicht bearbeiten
Die Seite Einsatzdaten SHALL die folgenden Angaben einzeln in der Leseansicht bearbeitbar
machen: Bezeichnung, Einsatzstichwort, Alarmzeit, Einsatzort (Adresse), Koordinate des
Einsatzorts, Einsatzart, Meldende Stelle, Sachverhalt / Meldebild,
Anzahl Betroffene (initial) und Leitstellen-Nr. Während eine Angabe bearbeitet wird, MUST die
Seite in der Leseansicht bleiben; alle übrigen Angaben bleiben sichtbar. Einsatzleitung,
Einsatznummer und „Angelegt“ MUST NOT zeilenweise bearbeitbar sein. Adresse und Koordinate des
Einsatzorts MUST in einem Paneel „Einsatzort“ bearbeitet werden; die Kopfleiste zeigt den
Einsatzort nur an. Die Zeile ist der einzige Bearbeitungsweg der Seite; ein Formular, das die
Leseansicht ersetzt, MUST es nicht geben. Den Termin der nächsten Lagebesprechung MUST die
Seite weder zeigen noch bearbeiten; er gehört dem Modul Lagebesprechung.

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
- **THEN** tragen Einsatzleitung, Einsatznummer, „Angelegt“ und der Einsatzort in der Kopfleiste keine Bearbeiten-Aufforderung, und es gibt keinen Knopf „Bearbeiten“, der ein Formular öffnet

#### Scenario: Koordinate nachtragen
- **WHEN** eine schreibberechtigte Person an der Zeile „Koordinate" im Paneel „Einsatzort" eine MGRS-Angabe eingibt und speichert
- **THEN** sendet die Seite `einsatzort_lat` und `einsatzort_lon` gemeinsam, und der Kartenausschnitt zeigt den Punkt

#### Scenario: Kein Termin der Lagebesprechung
- **WHEN** eine schreibberechtigte Person die Seite eines Einsatzes mit gesetztem Termin der nächsten Lagebesprechung öffnet
- **THEN** zeigt die Seite keine Zeile „Nächste Lagebesprechung“

### Requirement: Zeitpunkte ohne Zonenversatz
Die Alarmzeit SHALL in der Zeilenbearbeitung in der Anzeigezone
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

### Requirement: Gliederung der Seite
Die Seite Einsatzdaten SHALL ihre Angaben in dieser Reihenfolge zeigen: Kopfleiste
(Einsatzstichwort, Alarmzeit, Einsatzort, Einsatzleitung), Paneel „Einsatz“, Paneel
„Einsatzort“, Paneel „Erstmeldung“, Paneel „Eigene Führungsstelle“, zuletzt der
Einsatzabschluss. Kopfleiste und Paneele MUST keine Angabe wiederholen; die Kennungen im
Seitenkopf sind eine Lesekopie aus dem Paneel „Einsatz“, der Einsatzort in der Kopfleiste eine aus
dem Paneel „Einsatzort“. Die Seite MUST die volle Inhaltsbreite nutzen.

#### Scenario: Angaben je Paneel
- **WHEN** eine Person die Seite öffnet
- **THEN** trägt „Einsatz“ Bezeichnung, Einsatzart, Einsatznummer, Leitstellen-Nr. und Angelegt, „Einsatzort“ Adresse und Koordinate und „Erstmeldung“ Meldende Stelle, Sachverhalt / Meldebild und Anzahl Betroffene (initial)

#### Scenario: Handschirm ohne Querlauf
- **WHEN** die Seite bei 390 px Breite geöffnet wird
- **THEN** endet das Dokument bei 390 px, und die Paneele stehen untereinander
