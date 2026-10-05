## ADDED Requirements

### Requirement: Die Markierung folgt nur einem bewegten Zeiger
Die Markierung SHALL einer Zeile nur dann unter den Mauszeiger folgen, wenn sich der Zeiger
bewegt hat. Läuft die Liste beim Öffnen, Tippen oder Scrollen unter einem ruhenden Zeiger
hindurch, MUST die Markierung bleiben, wo die Tastatur sie hat: bei leerer Markierung auf dem
besten Treffer.

#### Scenario: Ruhender Zeiger beim Tippen
- **WHEN** der Mauszeiger ruhig über der Liste steht und jemand „hell“ tippt
- **THEN** ist der erste Treffer markiert und ↵ führt ihn aus

#### Scenario: Ruhender Zeiger beim Öffnen
- **WHEN** die Palette mit Strg/⌘+K geöffnet wird, während der Zeiger über der Stelle einer späteren Zeile ruht
- **THEN** ist die erste Zeile der Startansicht markiert

#### Scenario: Bewegter Zeiger markiert
- **WHEN** jemand den Zeiger über eine Zeile bewegt
- **THEN** ist diese Zeile markiert

### Requirement: Bearbeitungstasten gehören dem Suchfeld
Bei offener Palette MUST das Suchfeld die üblichen Bearbeitungstasten selbst behandeln:
⌘A/Strg+A markiert den Begriff, Strg/⌘+Rücktaste löscht nach Art des Systems. Eine Maske unter
der Palette MUST diese Tasten nicht erhalten.

#### Scenario: Wort löschen
- **WHEN** im Suchfeld „einsatz tage“ steht und jemand Strg+Rücktaste drückt
- **THEN** steht „einsatz “ im Feld und „Filter zurücksetzen“ der Seite darunter wird nicht ausgelöst

#### Scenario: Alles markieren
- **WHEN** im Suchfeld ein Begriff steht und jemand Strg+A (macOS ⌘A) drückt
- **THEN** ist der ganze Begriff markiert und das Feld behält den Fokus

### Requirement: Die Startansicht zeigt jeden Befehl einmal
In der Startansicht (leeres Suchfeld oder nacktes Präfix) MUST jeder Befehl höchstens einmal
stehen, und zwar in der obersten Gruppe, die ihn führt. Eine Zeile in „Zuletzt ausgeführt“ MUST
in ihrer Herkunftsgruppe fehlen, ein Modul in „Zuletzt besucht“ in „Module“.

#### Scenario: Gemerkte Schnellaktion
- **WHEN** „ETB-Eintrag schreiben“ in „Zuletzt ausgeführt“ steht
- **THEN** fehlt die Zeile in „Schnellaktionen“

#### Scenario: Zuletzt besuchtes Modul
- **WHEN** „Lagekarte“ in „Zuletzt besucht“ steht
- **THEN** fehlt „Lagekarte“ in „Module“

#### Scenario: Suche bleibt flach
- **WHEN** jemand einen Begriff tippt
- **THEN** zeigt die Trefferliste jeden Treffer einmal, ohne Gruppenüberschriften

### Requirement: Schnellaktionen nennen ihr Modul
Jede Schnellaktion SHALL Icon und Namen ihres Trägermoduls zeigen, den Namen als Kontext rechts.
Ihre Beschriftung MUST dem Muster Objekt + Verb folgen („Person erfassen“, „ETB-Eintrag
schreiben“, „Unfallhilfsstelle anlegen“, „Schaden erfassen“, „Lagebesprechung abschließen“,
„Dokument ablegen“, „Tier erfassen“, „Bereitstellungsraum anlegen“, „Einsatzabschnitt anlegen“,
„Gefahrengebiet zeichnen“). Die bisherige Beschriftung MUST als Suchwort weiter treffen.

#### Scenario: Zeile mit Modul
- **WHEN** die Palette im Einsatz mit Schreibrecht geöffnet wird
- **THEN** zeigt „Unfallhilfsstelle anlegen“ das Icon der Unfallhilfsstellen und rechts „Unfallhilfsstellen“

#### Scenario: Alte Beschriftung findet
- **WHEN** jemand „neuer etb“ tippt
- **THEN** steht „ETB-Eintrag schreiben“ unter den Treffern

## MODIFIED Requirements

### Requirement: Fußzeile und Zeilenmarke kündigen die Wege an
Die Fußzeile der Palette SHALL den Hinweis für den neuen Tab tragen (macOS: `⌘ ↵`, sonst
`Strg ↵`). Innerhalb eines Einsatzes SHALL sie zusätzlich den Hinweis `→ Vorschau` tragen.
Jede Zeile mit Vorschau MUST das Vorschau-Ziel zeigen, auch wenn sie nicht markiert ist; es
ist die Zeilenmarke für die Vorschau und tritt an die Stelle der `→`-Marke aus LFH-645.
Neben dem Ziel MUST keine zweite →-Marke stehen. Die Fußzeile MUST für ⇧↵ keinen Hinweis tragen. Die
Präfixe SHALL als eigene Gruppe mit Kurzwort stehen; die Fußzeile MUST bei 1440 px Fensterbreite
in jeder Dichte einzeilig bleiben und MUST keinen Hinweis auf den Koordinatensprung tragen.
Solange die Vorschau offen ist, MUST die Fußzeile die dort gültigen Wege nennen: öffnen,
neuer Tab und zurück.

#### Scenario: Marke an der Personenzeile
- **WHEN** die Trefferliste eine Person und ein Modul zeigt
- **THEN** trägt die Personenzeile das Vorschau-Ziel, markiert oder nicht, und die Modulzeile trägt keins

#### Scenario: Kein zweiter Pfeil
- **WHEN** eine Zeile mit Vorschau markiert ist
- **THEN** steht in ihr neben dem Vorschau-Ziel keine →-Marke

#### Scenario: Kein Vorschauhinweis außerhalb eines Einsatzes
- **WHEN** die Palette auf der Einsatzauswahl geöffnet wird
- **THEN** nennt die Fußzeile den neuen Tab, aber keine Vorschau

#### Scenario: Einzeilig in jeder Dichte
- **WHEN** die Palette im Einsatz bei 1440 px Fensterbreite in kompakt, komfortabel oder Handschuh geöffnet wird
- **THEN** steht die Fußzeile in einer Zeile, die Präfixe rechts als eigene Gruppe

#### Scenario: Kein Koordinatenhinweis
- **WHEN** die Palette im Einsatz geöffnet wird
- **THEN** nennt die Fußzeile den Koordinatensprung nicht

