# Spec Delta

## Purpose

Die Kopfleiste des Einsatzes sagt zuerst, in welchem Einsatz man arbeitet. Diese Fähigkeit legt
fest, wie sie ihren Platz zwischen Einsatzname, Suche und Daueranzeigen verteilt und wann eine
Anzeige ein Wort trägt.

## ADDED Requirements

### Requirement: Der Einsatzname hat Vorrang in der Kopfleiste

Der Einsatzname in der Kopfleiste des Einsatzes SHALL in Schrift von 16 px stehen, in jeder
Stufe der Dichte-Staffel und in jeder Breite. Reicht die Breite der Kopfzeile nicht für Name und
Suchfeld, MUST zuerst das Suchfeld schmaler werden, bis nur das Suchsymbol bleibt; erst danach
MUST der Name mit „…“ kürzen. Ein gekürzter Name MUST ganz im Titel des Wechslers stehen.

#### Scenario: Arbeitsplatz 1280 px
- **WHEN** der Überblick des Demo-Einsatzes „ÜBUNG – Starkregen Musterstadt“ bei 1280 × 800 in `kompakt` geöffnet ist und alle Anzeigen im Ruhezustand stehen
- **THEN** steht der Einsatzname ungekürzt in 16 px Schrift in der Kopfzeile

#### Scenario: Handschuh-Betrieb 1180 px
- **WHEN** derselbe Einsatz bei 1180 × 820 in `handschuh` geöffnet ist und alle Anzeigen im Ruhezustand stehen
- **THEN** steht der Einsatzname ungekürzt in der Kopfzeile

#### Scenario: Zu schmal für Name und Suchtext
- **WHEN** die Kopfzeile ab `lg` nicht breit genug ist für den ganzen Namen und den Hinweistext im Suchfeld
- **THEN** kürzt zuerst der Hinweistext des Suchfelds, und der Name kürzt erst, wenn vom Suchfeld nur das Suchsymbol bleibt

### Requirement: Ruhezustände stehen in der Kopfleiste nur als Symbol

Benachrichtigung, Alarmton und Live-Verbindung SHALL in der Kopfleiste des Einsatzes einen
Zustand ohne Handlungsbedarf nur als Symbol zeigen, in jeder Breite und Dichte: Benachrichtigung
„erlaubt“, „aus“, „nicht verfügbar“, Ton „bereit“, „wird geprüft“, Verbindung „steht“, „wird
aufgebaut“. Zugänglicher Name und Tooltip MUST den Zustand nennen. Ein Zustand, der sich beim
Start ohne Zutun einstellt, MUST die Breite der Kopfleiste nicht ändern; der Alarmton hält dafür
auch im Ruhezustand die Breite von „Ton blockiert“ frei.

#### Scenario: Alles in Ordnung
- **WHEN** ein Einsatz bei 1440 × 900 geöffnet ist, Benachrichtigungen erlaubt sind, der Ton bereit ist und die Live-Verbindung steht
- **THEN** stehen Benachrichtigung, Ton und Verbindung als Symbole ohne Wort, und ihre zugänglichen Namen nennen „Benachrichtigung erlaubt“, „Ton bereit“ und „Live-Verbindung steht“

#### Scenario: Start ohne Sprung
- **WHEN** ein Einsatz geladen wird und Tonprüfung und Verbindungsaufbau ohne Störung enden
- **THEN** erscheint in der Kopfleiste kein Wort „Ton wird geprüft“ oder „VERBINDE“, und die Kopfleiste ändert dabei weder Breite noch Zeilenzahl

#### Scenario: Ton beim Start gesperrt
- **WHEN** ein Einsatz in `handschuh` zwischen 1100 und 1440 px mit Maus geladen wird und der Browser den Ton bis zur ersten Bediengeste sperrt
- **THEN** erscheint nach der Frist „Ton blockiert“, und die Kopfleiste behält dabei ihre Zeilenzahl

### Requirement: Eine Störung in der Kopfleiste trägt ihr Wort

Eine Störung von Benachrichtigung, Alarmton oder Live-Verbindung MUST in der Kopfleiste des
Einsatzes ab `md` ihr Wort neben dem Symbol zeigen: „Ton stumm“, „Ton blockiert“,
„Benachrichtigung blockiert“, „GETRENNT“, „OFFLINE“, „WARTET“ und „PRÜFEN“. Unter `md` trägt die
Betriebszeile die Verbindungsstörung, die Alarmzentrale nennt ihre Störung im gebündelten Knopf.

#### Scenario: Ton blockiert
- **WHEN** der Browser den Alarmton blockiert
- **THEN** steht neben der durchgestrichenen Glocke das Wort „Ton blockiert“ in der Farbe `achtung`

#### Scenario: Verbindung verloren
- **WHEN** die Live-Verbindung abreißt
- **THEN** steht „GETRENNT“ als Wort neben dem Symbol

### Requirement: Tastenhinweise im Suchfeld nur bei feinem Zeiger

Das Suchfeld der Kopfleiste SHALL das Tastenkürzel der Sprungpalette („Strg+K“, am Mac „⌘K“) nur
zeigen, wenn der primäre Zeiger fein ist. Bei grobem Zeiger MUST der Hinweis fehlen. Das
Kürzel MUST weiter wirken, wenn eine Tastatur angeschlossen ist.

#### Scenario: Touch-Tablet
- **WHEN** ein Einsatz auf einem Tablet mit Finger als primärem Zeiger ab `lg` geöffnet ist
- **THEN** zeigt das Suchfeld Symbol und Hinweistext, aber kein „Strg+K“

#### Scenario: Laptop mit Maus
- **WHEN** derselbe Einsatz am Laptop mit Maus geöffnet ist
- **THEN** zeigt das Suchfeld rechts „Strg+K“

### Requirement: Die Zählplakette verdeckt kein Wort

Die Zahl der ungelesenen Eingänge an einem Symbol der Kopfleiste SHALL über dem Symbol stehen und
MUST NOT ein Wort desselben Knopfs überdecken. Sie MUST NOT die Breite des Knopfs ändern, wenn
sie erscheint oder verschwindet.

#### Scenario: Handy mit Störung und Eingängen
- **WHEN** am Handy (390 × 844) die gebündelte Alarmzentrale „Ton blockiert“ zeigt und drei Eingänge ungelesen sind
- **THEN** überlappt die Plakette „3“ das Wort „Ton blockiert“ nicht, und der Knopf ist so breit wie ohne ungelesene Eingänge
