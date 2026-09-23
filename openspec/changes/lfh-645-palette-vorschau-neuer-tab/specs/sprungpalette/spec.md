# Spec Delta

## Purpose

Öffnungswege der Sprungpalette (Strg/⌘+K). Diese Spec legt fest, wie die markierte Zeile
außer mit ↵ geöffnet wird: in einem neuen Browser-Tab oder als Lese-Vorschau in der Palette.
Außerdem regelt sie, welche Fußhinweise diese Wege ankündigen.

## ADDED Requirements

### Requirement: Strg/⌘+↵ öffnet das Ziel in einem neuen Tab
Die Palette SHALL auf Strg+↵ (unter macOS ⌘+↵) das Navigationsziel der markierten Zeile in
einem neuen Browser-Tab öffnen, die Palette schließen und die aktuelle Seite unverändert
lassen. Das gilt für jede Zeile mit Navigationsziel. Ein Navigationsziel haben Datensätze,
der ETB-Sammeltreffer, die Koordinate, Module, Zuletzt-Einträge, Schnellaktionen,
Einsatzwechsel, Navigationseinträge und Gedächtniszeilen. Hat die markierte Zeile kein
Navigationsziel (Aktionen, Einstellungen, Abmelden), MUST die Taste wirkungslos bleiben:
Sie führt die Zeile nicht aus, schließt die Palette nicht und löst keine
Anwendungs-Tastaturaktion aus. Die Zeile MUST sich in beiden Fällen gleich merken lassen:
Befehlsgedächtnis und Modulgedächtnis zeichnen die Öffnung in einem neuen Tab genauso auf
wie ein ↵.

#### Scenario: Datensatz im neuen Tab
- **WHEN** eine Person als Treffer markiert ist und Strg+↵ gedrückt wird
- **THEN** öffnet sich ihre Detailseite in einem neuen Tab, die Palette schließt sich und die aktuelle Route bleibt unverändert

#### Scenario: Zeile ohne Ziel
- **WHEN** die Aktion „Speichern“ markiert ist und Strg+↵ gedrückt wird
- **THEN** öffnet sich kein Tab, die Aktion wird nicht ausgeführt, die Palette bleibt offen und die Speichern-Aktion der Seite wird nicht ausgelöst

#### Scenario: Strg/⌘+Klick
- **WHEN** eine Zeile mit Navigationsziel mit gedrückter Strg- oder ⌘-Taste angeklickt wird
- **THEN** verhält sich die Palette wie bei Strg/⌘+↵

#### Scenario: Gedächtnis zeichnet auf
- **WHEN** ein merkbarer Befehl, etwa „Stammdaten“, mit Strg+↵ geöffnet wird
- **THEN** steht er beim nächsten Öffnen der Palette in „Zuletzt ausgeführt“ wie nach ↵

#### Scenario: Neuer Tab als Kaltstart
- **WHEN** das Ziel im neuen Tab lädt
- **THEN** zeigt der Tab den Datensatz bzw. die Seite angemeldet und vollständig, ohne dass der Nutzer erneut anmelden oder navigieren muss

### Requirement: → öffnet eine Vorschau in der Palette
Die Palette SHALL auf → eine Lese-Vorschau der markierten Zeile anstelle der Trefferliste
zeigen. Voraussetzung ist, dass die Zeile eine Vorschau hat und der Cursor am Ende des
Suchfelds ohne Textauswahl steht. In jedem anderen Fall MUST → sich im Suchfeld wie gewohnt
verhalten, also den Cursor bewegen. Die Vorschau MUST nur lesen und darf keinen Datensatz
verändern. Sie MUST benennen, welcher Datensatz gezeigt wird, und einen sichtbaren,
klickbaren Weg zurück zur Trefferliste haben.

#### Scenario: Personenvorschau
- **WHEN** eine Person als Treffer markiert ist, der Cursor am Textende steht und → gedrückt wird
- **THEN** zeigt die Palette anstelle der Treffer Status, Sichtung, Stammdaten und Verlauf dieser Person, das Suchfeld bleibt fokussiert

#### Scenario: Cursor nicht am Textende
- **WHEN** der Cursor mitten im Suchbegriff steht und → gedrückt wird
- **THEN** rückt der Cursor um ein Zeichen vor und es öffnet sich keine Vorschau

#### Scenario: Zeile ohne Vorschau
- **WHEN** ein Modul markiert ist und → gedrückt wird
- **THEN** bleibt die Trefferliste stehen

### Requirement: Rückweg und Aktionen aus der Vorschau
Solange eine Vorschau offen ist, SHALL Esc oder ← zur Trefferliste zurückführen. Dabei
bleiben Suchbegriff und markierte Zeile erhalten, und die Palette bleibt offen. Ein
weiteres Esc schließt die Palette. ↵ MUST den gezeigten Datensatz öffnen, Strg/⌘+↵ ihn in
einem neuen Tab. Eine Änderung des Suchbegriffs MUST die Vorschau verlassen und die
Trefferliste für den neuen Begriff zeigen.

#### Scenario: Esc führt zurück
- **WHEN** die Vorschau einer Person offen ist und Esc gedrückt wird
- **THEN** steht die Trefferliste mit demselben Suchbegriff und derselben markierten Person wieder da und die Palette ist offen

#### Scenario: Zweites Esc schließt
- **WHEN** nach dem Rückweg aus der Vorschau erneut Esc gedrückt wird
- **THEN** schließt sich die Palette

#### Scenario: Öffnen aus der Vorschau
- **WHEN** die Vorschau einer Person offen ist und ↵ gedrückt wird
- **THEN** navigiert die App auf die Detailseite der Person und die Palette schließt sich

#### Scenario: Weitertippen verlässt die Vorschau
- **WHEN** die Vorschau offen ist und ein Zeichen getippt wird
- **THEN** zeigt die Palette die Trefferliste für den geänderten Begriff

### Requirement: Fußzeile und Zeilenmarke kündigen die Wege an
Die Fußzeile der Palette SHALL den Hinweis für den neuen Tab tragen (macOS: `⌘↵`, sonst
`Strg+↵`). Innerhalb eines Einsatzes SHALL sie zusätzlich den Hinweis `→ Vorschau` tragen.
Die markierte Zeile MUST eine `→`-Marke zeigen, wenn sie eine Vorschau hat. Die Fußzeile
MUST für ⇧↵ keinen Hinweis tragen. Solange die Vorschau offen ist, MUST die Fußzeile die
dort gültigen Wege nennen: öffnen, neuer Tab und zurück.

#### Scenario: Marke an der Personenzeile
- **WHEN** eine Person markiert ist
- **THEN** trägt ihre Zeile neben der ↵-Marke eine →-Marke, eine markierte Modulzeile trägt keine

#### Scenario: Kein Vorschauhinweis außerhalb eines Einsatzes
- **WHEN** die Palette auf der Einsatzauswahl geöffnet wird
- **THEN** nennt die Fußzeile den neuen Tab, aber keine Vorschau
