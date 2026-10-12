# Spec Delta

## ADDED Requirements

### Requirement: Sprungmarken stehen als Ansichten in der Palette
Im Einsatz SHALL die Palette jede Sprungmarke des Modulmenüs als Zeile der Gruppe „Ansichten“
führen, mit dem Namen der Marke, Icon und Namen ihres Zielmoduls als Kontext. Angeboten MUST
eine Marke nur werden, wenn ihr Zielmodul fertig, sichtbar und nicht gesperrt ist. ↵ MUST
dorthin springen, wohin die Marke im Menü springt. Jede Marke MUST über ihre Schlagworte und
ihr Ziel auffindbar sein.

#### Scenario: Funk findet den Funkplan
- **WHEN** jemand mit Stab-Freigabe im Einsatz „Funk“ tippt
- **THEN** ist „Funkplan“ der erste Treffer, und ↵ öffnet den Funkplan

#### Scenario: Schlagwort ohne Namensteil
- **WHEN** jemand „bürgertelefon“ tippt
- **THEN** steht „Informationstelefon“ unter den Treffern

#### Scenario: Bestehende Marke
- **WHEN** jemand mit ETB-Freigabe „entscheid“ tippt
- **THEN** steht „Entscheidungen“ mit dem Kontext „ETB“ unter den Treffern

#### Scenario: Ohne Freigabe kein Eintrag
- **WHEN** der Stab für die Person gesperrt oder im Einsatz ausgeblendet ist
- **THEN** führt die Palette weder Funkplan, Fernmeldeskizze, Kommunikationsplan, Pressearbeit noch Informationstelefon

#### Scenario: Startansicht
- **WHEN** die Palette im Einsatz mit leerem Suchfeld geöffnet wird
- **THEN** steht die Gruppe „Ansichten“ direkt unter „Module“, und eine Marke aus „Zuletzt ausgeführt“ fehlt dort

### Requirement: Anruf erfassen aus der Palette
Mit Schreibrecht im Einsatz und freigegebenem Stab SHALL die Palette die Schnellaktion „Anruf
erfassen“ führen. Sie MUST das Informationstelefon öffnen und den Fokus in das erste Feld der
Anruferfassung setzen; der Auftrag MUST danach aus der Adresse verschwinden, sodass ein Neuladen
keinen zweiten Fokussprung auslöst.

#### Scenario: Bürgeranruf
- **WHEN** jemand mit Schreibrecht „Anruf erfassen“ ausführt
- **THEN** steht das Informationstelefon offen, der Fokus liegt im Feld „Anliegen“ der Erfassung, und die Adresse trägt kein `neu` mehr

#### Scenario: Beobachter
- **WHEN** ein Beobachter die Palette öffnet
- **THEN** führt sie „Anruf erfassen“ nicht

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
- **WHEN** „Funkplan“ markiert ist und Strg+↵ gedrückt wird
- **THEN** öffnet sich der Funkplan in einem neuen Tab, und die aktuelle Route bleibt unverändert

### Requirement: Schnellaktionen nennen ihr Modul
Jede Schnellaktion SHALL Icon und Namen ihres Trägermoduls zeigen, den Namen als Kontext rechts.
Ihre Beschriftung MUST dem Muster Objekt + Verb folgen („Person erfassen“, „ETB-Eintrag
schreiben“, „Unfallhilfsstelle anlegen“, „Schaden erfassen“, „Lagebesprechung abschließen“,
„Dokument ablegen“, „Tier erfassen“, „Bereitstellungsraum anlegen“, „Einsatzabschnitt anlegen“,
„Gefahrengebiet zeichnen“, „Anruf erfassen“). Die bisherige Beschriftung MUST als Suchwort weiter treffen.

#### Scenario: Zeile mit Modul
- **WHEN** die Palette im Einsatz mit Schreibrecht geöffnet wird
- **THEN** zeigt „Unfallhilfsstelle anlegen“ das Icon der Unfallhilfsstellen und rechts „Unfallhilfsstellen“

#### Scenario: Alte Beschriftung findet
- **WHEN** jemand „neuer etb“ tippt
- **THEN** steht „ETB-Eintrag schreiben“ unter den Treffern
