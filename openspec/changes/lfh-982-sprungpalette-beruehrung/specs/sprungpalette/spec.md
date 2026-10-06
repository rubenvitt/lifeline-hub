## MODIFIED Requirements

### Requirement: Fußzeile und Zeilenmarke kündigen die Wege an
Bei feinem Zeiger (Maus, Stift) SHALL die Fußzeile der Palette den Hinweis für den neuen Tab
tragen (macOS: `⌘ ↵`, sonst `Strg ↵`). Innerhalb eines Einsatzes SHALL sie zusätzlich den
Hinweis `→ Vorschau` tragen.
Jede Zeile mit Vorschau MUST das Vorschau-Ziel zeigen, auch wenn sie nicht markiert ist; es
ist die Zeilenmarke für die Vorschau und tritt an die Stelle der `→`-Marke aus LFH-645.
Neben dem Ziel MUST keine zweite →-Marke stehen. Die Fußzeile MUST für ⇧↵ keinen Hinweis tragen. Die
Präfixe SHALL als eigene Gruppe mit Kurzwort stehen; die Fußzeile MUST bei 1440 px Fensterbreite
in jeder Dichte einzeilig bleiben und MUST keinen Hinweis auf den Koordinatensprung tragen.
Solange die Vorschau offen ist, MUST die Fußzeile die dort gültigen Wege nennen: öffnen,
neuer Tab und zurück. Bei grobem Zeiger gilt statt der Tastenhinweise die Anforderung
„Bei grobem Zeiger zeigt die Palette Tippwege statt Tastenhinweisen“.

#### Scenario: Marke an der Personenzeile
- **WHEN** die Trefferliste eine Person und ein Modul zeigt
- **THEN** trägt die Personenzeile das Vorschau-Ziel, markiert oder nicht, und die Modulzeile trägt keins

#### Scenario: Kein zweiter Pfeil
- **WHEN** eine Zeile mit Vorschau markiert ist
- **THEN** steht in ihr neben dem Vorschau-Ziel keine →-Marke

#### Scenario: Kein Vorschauhinweis außerhalb eines Einsatzes
- **WHEN** die Palette mit feinem Zeiger auf der Einsatzauswahl geöffnet wird
- **THEN** nennt die Fußzeile den neuen Tab, aber keine Vorschau

#### Scenario: Einzeilig in jeder Dichte
- **WHEN** die Palette im Einsatz bei 1440 px Fensterbreite mit feinem Zeiger in kompakt, komfortabel oder Handschuh geöffnet wird
- **THEN** steht die Fußzeile in einer Zeile, die Präfixe rechts als eigene Gruppe

#### Scenario: Kein Koordinatenhinweis
- **WHEN** die Palette im Einsatz geöffnet wird
- **THEN** nennt die Fußzeile den Koordinatensprung nicht

## ADDED Requirements

### Requirement: Die Zeigerart entscheidet über Tasten- oder Tippwege
Die Palette SHALL ihre Hinweise und Bedienziele nach der Art des primären Zeigers wählen: grob
(Finger, Handschuh) oder fein (Maus, Stift). Die Fensterbreite MUST dabei keine Rolle spielen.
Ein Fükw mit schmalem Fenster behält alle Tastenhinweise, ein Tablet in voller Breite bekommt die
Tippwege. Ändert sich die Zeigerart bei offener Palette, MUST die Palette ihr folgen.

#### Scenario: Schmales Fenster am Fükw
- **WHEN** die Palette mit feinem Zeiger bei 390 px Fensterbreite geöffnet wird
- **THEN** stehen Esc-Marke, „↵ öffnen“, der Neuer-Tab-Hinweis und die Präfix-Legende wie am breiten Schirm

#### Scenario: Tablet quer
- **WHEN** die Palette mit grobem Zeiger bei 1180 px Fensterbreite geöffnet wird
- **THEN** zeigt sie den Schließknopf und die Präfix-Chips und keine Tastenhinweise

### Requirement: Bei grobem Zeiger schließt ein Knopf die Palette
Bei grobem Zeiger SHALL rechts im Palettenkopf anstelle der Esc-Marke ein Knopf mit dem
zugänglichen Namen „Sprungpalette schließen“ stehen. Er MUST in Höhe und Breite mindestens
48 px messen und in der Stufe Handschuh mit der Steuerhöhe wachsen. Ein Tipp darauf MUST die
Palette schließen. Esc und ein Tipp auf die Maske schließen sie weiterhin. Bei feinem Zeiger
MUST die Esc-Marke unverändert stehen und kein Schließknopf erscheinen.

#### Scenario: Tipp auf den Schließknopf
- **WHEN** die Palette auf dem Handy bei 390 px geöffnet ist und der Schließknopf angetippt wird
- **THEN** schließt sich die Palette und die Seite darunter bleibt unverändert

#### Scenario: Trefffläche
- **WHEN** die Palette mit grobem Zeiger in den Stufen komfortabel und Handschuh geöffnet wird
- **THEN** misst der Schließknopf in Höhe und Breite mindestens 48 bzw. 72 px

#### Scenario: Feiner Zeiger
- **WHEN** die Palette mit feinem Zeiger geöffnet wird
- **THEN** steht im Kopf die Marke „Esc“ und es gibt keinen Knopf „Sprungpalette schließen“

### Requirement: Bei grobem Zeiger zeigt die Palette keine Tastenhinweise
Bei grobem Zeiger MUST die Palette keinen Hinweis auf ↵, Strg/⌘+↵, →, Esc oder ein anderes
Tastenkürzel zeigen, weder in der Fußzeile noch an den Zeilen. Das betrifft die Kürzelmarken der
Aktionszeilen (etwa „Strg + Rücktaste“ an „Filter zurücksetzen“) und die ↵-Marke der aktiven
Zeile. Die Zeilen selbst, ihr Kontext, das Vorschau-Ziel und die Markierung der aktiven Zeile
bleiben stehen. Die Tasten wirken weiter, wenn eine Tastatur angeschlossen ist.

#### Scenario: Fußzeile ohne Tasten
- **WHEN** die Palette mit grobem Zeiger im Einsatz geöffnet wird
- **THEN** nennt die Fußzeile weder „öffnen“ mit ↵ noch „neuer Tab“ noch „→ Vorschau“ noch Esc

#### Scenario: Aktionszeile ohne Kürzel
- **WHEN** mit grobem Zeiger „Filter zurücksetzen“ gesucht wird
- **THEN** steht die Zeile ohne die Marke „Strg + Rücktaste“ in der Liste

#### Scenario: Aktive Zeile ohne Enter-Marke
- **WHEN** die Palette mit grobem Zeiger geöffnet ist
- **THEN** trägt die markierte Zeile die Markierung, aber keine ↵-Marke

### Requirement: Bei grobem Zeiger sind die Präfixe antippbare Chips
Bei grobem Zeiger SHALL die Fußzeile der Trefferliste jedes Präfix (`>`, `#`, `@`) als
Chip mit Zeichen und Kurzwort tragen. Ein Tipp MUST das Präfix vor den Suchbegriff setzen, ein
anderes Präfix dabei ersetzen und dem Suchfeld den Fokus geben. Der Chip des aktiven Modus MUST
als gedrückt erkennbar sein; ein Tipp darauf nimmt das Präfix weg. Jeder Chip MUST den Boden der
Dichtestufe tragen. Die Chips MUST in einer Zeile stehen.

#### Scenario: Chip setzt das Präfix
- **WHEN** mit grobem Zeiger „müller“ getippt ist und der Chip „@“ angetippt wird
- **THEN** steht im Suchfeld „@müller“, die Palette sucht nur Personen und Kräfte und das Suchfeld hat den Fokus

#### Scenario: Chip ersetzt ein anderes Präfix
- **WHEN** im Suchfeld „>spei“ steht und der Chip „#“ angetippt wird
- **THEN** steht im Suchfeld „#spei“

#### Scenario: Aktiver Chip nimmt das Präfix weg
- **WHEN** im Suchfeld „#42“ steht und der gedrückte Chip „#“ angetippt wird
- **THEN** steht im Suchfeld „42“ und kein Chip ist gedrückt

#### Scenario: Fußzeile wird flacher
- **WHEN** die Palette auf dem Handy bei 390 px in der Stufe komfortabel geöffnet wird
- **THEN** stehen die drei Chips in einer Zeile und die Fußzeile ist niedriger als die bisherige dreizeilige Legende

### Requirement: Bei grobem Zeiger öffnet ein Knopf den Datensatz aus der Vorschau
Bei grobem Zeiger SHALL die Fußzeile der Vorschau statt der Tastenhinweise einen Knopf „Öffnen“
tragen. Ein Tipp darauf MUST wie ↵ in der Vorschau den gezeigten Datensatz öffnen und die Palette
schließen. Der Weg zurück zur Trefferliste bleibt der Knopf „Zurück“ im Kopf der Vorschau.

#### Scenario: Öffnen aus der Vorschau auf dem Tablet
- **WHEN** auf dem Tablet die Vorschau einer Person über ihr Vorschau-Ziel geöffnet und „Öffnen“ angetippt wird
- **THEN** zeigt die App die Detailseite der Person und die Palette ist geschlossen
