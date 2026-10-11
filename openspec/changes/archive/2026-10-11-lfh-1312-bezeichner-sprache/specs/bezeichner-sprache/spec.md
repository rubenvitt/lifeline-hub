# Spec Delta

## Purpose

Legt fest, in welcher Sprache Bezeichner und Texte im Repo stehen: Fachbegriffe der Domäne
deutsch, technisches Vokabular englisch, Prosa deutsch. Regelt außerdem, wie der deutsch
benannte Bestand schrittweise an die Regel herangeführt wird (LFH-1312).

## ADDED Requirements

### Requirement: Fachbegriffe der Domäne bleiben deutsch
Ein Bezeichner, der einen Begriff der BOS-Führungssprache oder der Fachlichkeit des Produkts
benennt, MUST das deutsche Fachwort tragen. Umlaute und ß MUST dabei wie im Bestand
umschrieben werden (`ae`, `oe`, `ue`, `ss`). Ein englisches Ersatzwort für einen Fachbegriff
MUST NOT entstehen.

#### Scenario: Fachbegriff im Typnamen
- **WHEN** ein neuer Typ eine Lagemeldung darstellt
- **THEN** heißt er `Lagemeldung` und nicht `SituationReport`

#### Scenario: Fachbegriff mit Umlaut
- **WHEN** ein neues Modul die Kräfte eines Einsatzes betrifft
- **THEN** trägt sein Name `kraefte` und nicht `forces` oder `kräfte`

### Requirement: Technisches Vokabular ist englisch
Ein Bestandteil eines Bezeichners, der kein Fachbegriff ist, MUST englisch sein. Dazu zählen
Verben für Programmabläufe, Präfixe für Wahrheitswerte sowie Muster- und Strukturwörter.
Fachbegriff und Technikwort MUST in einem Bezeichner kombinierbar sein.

#### Scenario: Ladefunktion für einen Fachbegriff
- **WHEN** eine neue Funktion einen Einsatz lädt
- **THEN** heißt sie `load_einsatz` (Rust) bzw. `loadEinsatz` (TypeScript) und nicht
  `lade_einsatz`

#### Scenario: Wahrheitswert
- **WHEN** eine neue Funktion prüft, ob ein Konto ein Gerätekonto ist
- **THEN** heißt sie `is_geraetekonto` und nicht `ist_geraetekonto`

#### Scenario: Strukturwort in einem React-Bauteil
- **WHEN** ein neues Bauteil `EinsatzKopf` Eigenschaften und einen Hook bekommt
- **THEN** heißen sie `EinsatzKopfProps` und `useEinsatzKopf`, wie schon im Bestand

### Requirement: Prosa bleibt deutsch
Kommentare, Commit-Nachrichten, Texte der Oberfläche, Fehlermeldungen an Nutzer,
Testbeschreibungen und Projektdokumentation MUST deutsch bleiben. Die englischen Präfixe der
Commit-Konvention (`feat`, `fix`, `chore` …) bleiben.

#### Scenario: Kommentar über englisch benanntem Code
- **WHEN** eine Funktion `load_einsatz` einen Kommentar bekommt
- **THEN** ist der Kommentar deutsch

#### Scenario: Testname als Satz
- **WHEN** ein Rust-Test einen Ablauf als Satz beschreibt
- **THEN** bleibt der Satz deutsch, etwa
  `ruecknahme_nach_zweiter_abloesung_trifft_die_richtige`

### Requirement: Grenzwerte werden nicht im Rahmen dieser Regel umbenannt
Namen, die eine Schnittstelle oder gespeicherte Daten tragen, MUST NOT allein wegen dieser
Regel umbenannt werden. Dazu zählen Wire-Felder und -Werte, Tabellen und Spalten, Migrationen,
generierte Typen, gespeicherte Schlüssel, Routen und Ereignisnamen. Eine Umbenennung dort
braucht eine eigene Änderung mit Übergangsweg.

#### Scenario: Serialisiertes Feld
- **WHEN** ein Task die Fahrzeug-Antwort mit dem JSON-Feld `ist_demo` ändert
- **THEN** bleibt der Wire-Name `ist_demo`, und der generierte TypeScript-Typ ändert sich nicht

#### Scenario: Datenbankspalte
- **WHEN** eine Abfrage die Spalte `zeitpunkt` liest
- **THEN** wird die Spalte nicht umbenannt und keine Migration nur dafür angelegt

### Requirement: Bestand wird beim Anfassen umgestellt
Neue Bezeichner MUST der Regel sofort folgen. Ein bestehender Bezeichner MUST umgestellt
werden, wenn ein Task Code ändert, der ihn deklariert, und alle Verwendungen im Diff des Tasks
liegen oder mechanisch mitziehbar sind. Eine Umstellung des ganzen Bestands in einem Zug MUST
NOT stattfinden.

#### Scenario: Funktion im geänderten Code
- **WHEN** ein Task den Rumpf von `lade_marker` ändert und die Funktion nur in zwei Dateien
  verwendet wird
- **THEN** heißt sie danach `load_marker`, und beide Dateien sind nachgezogen

#### Scenario: Unberührter Code
- **WHEN** ein Task eine Datei nicht ändert, in der `hole_style` steht
- **THEN** bleibt `hole_style` unverändert

#### Scenario: Namensfamilie in derselben Datei
- **WHEN** ein Task `lade_a` umstellt und in derselben Datei `lade_b` und `lade_c` stehen
- **THEN** werden die drei zusammen umgestellt, damit die Datei nicht gemischt benannt ist

### Requirement: Die Regel steht in der Wurzel-AGENTS.md
Die Regel MUST in der Wurzel-`AGENTS.md` stehen, weil sie jeden Bereich betrifft. Sie MUST
ausdrücklich die Sprachvorgabe der älteren Pläne unter `docs/superpowers/plans/` ablösen, ohne
diese Pläne zu ändern.

#### Scenario: Agent liest einen alten Plan
- **WHEN** ein Plan unter `docs/superpowers/plans/` „Bezeichner auf Deutsch“ vorgibt
- **THEN** gilt trotzdem die Regel aus der Wurzel-`AGENTS.md`
