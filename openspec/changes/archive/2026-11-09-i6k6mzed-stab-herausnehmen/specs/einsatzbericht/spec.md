# Spec Delta

## MODIFIED Requirements

### Requirement: Inhalt der Blöcke

Stammdaten SHALL Bezeichnung, Einsatznummer, Leitstellennummer, Einsatzart, Stichwort,
Einsatzort, meldende Stelle und Sachverhalt nennen, Zeiten SHALL Beginn, Ende und Dauer nennen.
Führung SHALL die Einsatzleitung, die Führungsfunktionen und die abgehaltenen
Lagebesprechungen mit Zeitpunkt und Entschluss nennen. Als Einsatzleitung SHALL der an der eigenen
Führungsstelle erfasste Einsatzleiter mit seinem „seit“ stehen, in derselben Darstellung wie die
Kopfleiste der Einsatzdaten, sonst „nicht erfasst“. Die Konten mit der App-Rolle Einsatzleitung
MUST NOT als Einsatzleitung erscheinen. Unter „Führungsfunktionen“ SHALL je Funktion EL und S1–S7
stehen, welche Mitglieder sie in ihrer Mitgliedschaft tragen (Spec `fuehrungsfunktionen`, „Mehrere
Mitglieder mit derselben Führungsfunktion“). Lage SHALL ein Verzeichnis aller
freigegebenen Lageberichte und den letzten im Volltext zeigen. Der ETB-Auszug SHALL die Zahl der
Einträge je Typ und alle Entscheidungen zeigen.

#### Scenario: Einsatzleiter im Block Führung

- **WHEN** der Einsatzleiter „Anna Schulz“ seit 11.10.2026 14:30 Uhr erfasst ist und zwei Konten die
  App-Rolle Einsatzleitung tragen
- **THEN** nennt der Block Führung unter „Einsatzleitung“ „Anna Schulz“ mit „seit 111430okt26“ (Darstellung taktisch)
- **AND** die beiden Konten stehen dort nicht

#### Scenario: Kein Einsatzleiter erfasst

- **WHEN** an der Führungsstelle kein Einsatzleiter erfasst ist
- **THEN** steht unter „Einsatzleitung“ „nicht erfasst“

#### Scenario: Führungsfunktionen aus der Mitgliedschaft

- **WHEN** Müller und Schulz als Mitglieder S2 tragen und Weber S4
- **THEN** nennt der Block Führung unter „Führungsfunktionen“ bei S2 „Müller, Schulz“ und bei S4
  „Weber“
- **AND** es gibt keinen Abschnitt „Stab“

#### Scenario: Lage mit drei Berichten

- **WHEN** ein Einsatz drei freigegebene Lageberichte und einen Entwurf hat
- **THEN** nennt das Verzeichnis die drei freigegebenen mit Zeitstand, Titel, Version und
  freigebender Person
- **AND** der zuletzt freigegebene steht im Volltext
- **AND** der Entwurf erscheint nicht

#### Scenario: Fortgeschriebener Lagebericht

- **WHEN** ein Lagebericht in Version 2 fortgeschrieben und freigegeben wurde
- **THEN** nennt das Verzeichnis die Kette einmal, mit ihrer neuesten freigegebenen Version

#### Scenario: Entscheidungen im ETB-Auszug

- **WHEN** das ETB neun Entscheidungen enthält
- **THEN** stehen alle neun mit laufender Nummer, Zeitpunkt und Inhalt im Auszug, geordnet
  nach laufender Nummer
- **AND** eine berichtigte Entscheidung ist als berichtigt gekennzeichnet

#### Scenario: Ohne Stichwort und Leitstellennummer

- **WHEN** ein Einsatz kein Stichwort und keine Leitstellennummer hat
- **THEN** stehen die Felder mit „—“ und nicht leer im Bericht

### Requirement: Keine personenbezogenen Daten Betroffener

Die Blöcke Bilanz und Hilfeleistungen SHALL Betroffene, Patienten, Schäden, Betreuung,
Evakuierung und Verpflegung ausschließlich als Zählung zeigen. Der Bericht MUST keine Namen,
Vornamen, Geburtsdaten oder Registriernummern betroffener Personen und keine Namen Geschädigter
enthalten. Namen der Führungskräfte (Einsatzleitung, Führungsfunktionen, freigebende Personen)
SHALL genannt werden.

#### Scenario: Patienten in der Bilanz

- **WHEN** im Einsatz zwölf Patienten mit Sichtung erfasst sind
- **THEN** zeigt die Bilanz die Verteilung nach Sichtungskategorie, Verbleib und Transporten
- **AND** kein Name und keine Registriernummer einer betroffenen Person steht im Bericht

#### Scenario: Hilfeleistungen ohne Personenbezug

- **WHEN** im Einsatz zwanzig Kontakte mit Anlass, Verbleib und versorgender Einheit erfasst sind
- **THEN** zeigt der Block Hilfeleistungen nur Zahlen je Anlass, Stunde, Verbleib, Rettungsmittel,
  Ziel, Verweigerung und Einheit
- **AND** kein Name, keine Registriernummer und kein Fundort einer betroffenen Person steht im Bericht

### Requirement: Anlage Personal je Kopf

Die optionale Anlage Personal je Kopf SHALL je im Einsatz geführter Einsatzkraft Name,
Funktion, Einheit, Beginn, Ende und Einsatzzeit nennen, als Helfernachweis. Als Funktion MUST die
Einsatzfunktion stehen und, wenn sie leer ist, die Qualifikation. Sie MUST nur Daten
von Einsatzkräften enthalten, keine Kontaktdaten und nie Daten Betroffener. Ist sie gedruckt,
MUST der Druckkopf „enthält Namen von Einsatzkräften“ vermerken. Eine Kraft ohne Zeitachse
MUST ohne Zeiten stehen statt mit 0.

#### Scenario: Helfernachweis

- **WHEN** die Anlage Personal je Kopf gewählt ist und zwölf Einsatzkräfte geführt sind
- **THEN** stehen alle zwölf mit Name, Funktion, Einheit und ihren Einsatzzeiten im Bericht
- **AND** der Druckkopf vermerkt „enthält Namen von Einsatzkräften“

#### Scenario: Kraft ohne Zeitachse

- **WHEN** eine Einsatzkraft geführt ist, aber kein Zeitachsen-Ereignis hat
- **THEN** steht sie mit Name, Funktion und Einheit und bei der Einsatzzeit „keine Zeitachse“

#### Scenario: Standardumfang ohne Namen

- **WHEN** der Bericht ohne Auswahl gedruckt wird
- **THEN** enthält er keine Namen von Einsatzkräften außer denen der Führung (Einsatzleitung,
  Führungsfunktionen, freigebende Personen)

#### Scenario: Einsatzfunktion statt Qualifikation

- **WHEN** eine Kraft mit Qualifikation „Notfallsanitäter“ die Einsatzfunktion „Sprechfunker“ hat
- **THEN** nennt die Anlage bei ihr die Funktion „Sprechfunker“
