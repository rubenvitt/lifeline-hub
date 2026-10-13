## MODIFIED Requirements

### Requirement: Strg/⌘+↵ öffnet das Ziel in einem neuen Tab
Die Palette SHALL auf Strg+↵ (unter macOS ⌘+↵) das Navigationsziel der markierten Zeile in
einem neuen Browser-Tab öffnen, die Palette schließen und die aktuelle Seite unverändert
lassen. Das gilt für jede Zeile mit Navigationsziel. Ein Navigationsziel haben Datensätze,
der ETB-Sammeltreffer, die Koordinate, Module, Ansichten, Zuletzt-Einträge, Schnellaktionen,
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

#### Scenario: Ansicht im neuen Tab
- **WHEN** „Kommunikationsplan“ markiert ist und Strg+↵ gedrückt wird
- **THEN** öffnet sich der Kommunikationsplan in einem neuen Tab, und die aktuelle Route bleibt unverändert

### Requirement: Sprungmarken stehen als Ansichten in der Palette
Im Einsatz SHALL die Palette jede Sprungmarke des Modulmenüs als Zeile der Gruppe „Ansichten“
führen, mit dem Namen der Marke, Icon und Namen ihres Zielmoduls als Kontext. Angeboten MUST
eine Marke nur werden, wenn ihr Zielmodul fertig, sichtbar und nicht gesperrt ist. ↵ MUST
dorthin springen, wohin die Marke im Menü springt. Jede Marke MUST über ihre Schlagworte und
ihr Ziel auffindbar sein.

#### Scenario: Funk findet den Funkplan
- **WHEN** jemand mit Freigabe des Fernmeldewesens im Einsatz „Funk“ tippt
- **THEN** ist „Fernmeldewesen“ der erste Treffer, und ↵ öffnet den Funkplan

#### Scenario: Schlagwort ohne Namensteil
- **WHEN** jemand „bürgertelefon“ tippt
- **THEN** steht „Informationstelefon“ unter den Treffern

#### Scenario: Bestehende Marke
- **WHEN** jemand mit ETB-Freigabe „entscheid“ tippt
- **THEN** steht „Entscheidungen“ mit dem Kontext „ETB“ unter den Treffern

#### Scenario: Ohne Freigabe kein Eintrag
- **WHEN** der Stab für die Person gesperrt oder im Einsatz ausgeblendet ist
- **THEN** führt die Palette weder Pressearbeit noch Informationstelefon, aber Fernmeldeskizze und
  Kommunikationsplan, wenn das Fernmeldewesen frei ist

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Fernmeldewesen für die Person gesperrt oder im Einsatz ausgeblendet ist
- **THEN** führt die Palette weder das Modul Fernmeldewesen noch Fernmeldeskizze oder
  Kommunikationsplan

#### Scenario: Startansicht
- **WHEN** die Palette im Einsatz mit leerem Suchfeld geöffnet wird
- **THEN** steht die Gruppe „Ansichten“ direkt unter „Module“, und eine Marke aus „Zuletzt ausgeführt“ fehlt dort
