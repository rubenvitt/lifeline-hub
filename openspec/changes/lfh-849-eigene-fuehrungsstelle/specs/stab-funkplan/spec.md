# Spec Delta

## MODIFIED Requirements

### Requirement: Fehlende eigene Gegenstelle wird benannt
Ist die eigene Führungsstelle des Einsatzes erfasst, SHALL der Funkplan sie als erste Zeile vor den
Abschnitten zeigen: Stelle „Führungsstelle“, Rufname, TMO- und DMO-Sprechgruppen,
Kommunikationsmittel und Erreichbarkeit aus ihren Angaben, ohne Leiter/Führer. Die Zeile MUST
ohne Kinder stehen; der Baum darunter bleibt unverändert. Ist sie nicht erfasst, SHALL der Funkplan
oberhalb der Tabelle ausdrücklich sagen, dass die eigene Gegenstelle nicht erfasst ist, und MUST NOT
eine Zeile dafür erfinden oder aus anderen Daten vermuten. Ist ihr Abruf gesperrt oder gescheitert,
MUST der Hinweis den Grund nennen statt „nicht erfasst“.

#### Scenario: Hinweis auf die Gegenstelle
- **WHEN** der Funkplan eines Einsatzes ohne erfasste Führungsstelle geöffnet wird
- **THEN** steht oberhalb der Tabelle der Hinweis „Eigene Gegenstelle (Führungsstelle) nicht
  erfasst“, und die Tabelle enthält keine erfundene Zeile dafür

#### Scenario: Erfasste Führungsstelle
- **WHEN** die Führungsstelle mit Rufname „Florian Musterstadt 10/1“ und der Sprechgruppe „TMO 311“ erfasst ist
- **THEN** steht vor dem ersten Abschnitt die Zeile „Führungsstelle“ mit diesem Rufnamen und „311“ in der Spalte TMO, und der Hinweis „nicht erfasst“ fehlt

#### Scenario: Führungsstelle im Druck
- **WHEN** der Funkplan mit erfasster Führungsstelle gedruckt wird
- **THEN** ist die Zeile der Führungsstelle die erste Zeile des Ausdrucks, samt Erreichbarkeit

### Requirement: Lücken oberhalb der Tabelle
Oberhalb der Tabelle SHALL der Funkplan diese Lücken als Anzahl zeigen:
- Abschnitte ohne Sprechgruppe
- Einheiten ohne Sprechgruppe
- Einheiten ohne Erreichbarkeit
- einsatzlokale Sprechgruppen, die weder einem Abschnitt noch einer Einheit noch der eigenen
  Führungsstelle zugeordnet sind
- Verbindungen ohne gemeinsame Sprechgruppe: eine Stelle und ihre übergeordnete Stelle haben beide
  Sprechgruppen, aber keine gemeinsame. Übergeordnete Stelle eines obersten Abschnitts ist die
  eigene Führungsstelle.

Jede Zahl MUST aus denselben geladenen Listen gerechnet werden wie die Tabelle. Hängt eine Zahl an
einer gesperrten, nicht geladenen oder noch ladenden Liste, MUST sie „—“ mit Grund zeigen und
MUST NOT „0“ zeigen. Bei einer Zahl größer null MUST der Funkplan die betroffenen Datensätze
nennen: Abschnitte und Einheiten als Verweis auf die Stelle, an der sie gepflegt werden,
einsatzlokale Sprechgruppen mit ihrer Bezeichnung, Verbindungen als Verweis auf die untere Stelle.
Die Lücken MUST im ersten Bild stehen, bei 1366 × 768 px mit offenem Modulpanel. Sie MUST in
beiden Darstellungen des Funkplans (Tabelle und Skizze) dieselben sein.

#### Scenario: Abschnitt ohne Sprechgruppe
- **WHEN** einem von drei Abschnitten keine Sprechgruppe zugeordnet ist
- **THEN** zeigt der Funkplan „1“ bei „Abschnitte ohne Sprechgruppe“

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** im Einsatz die lokale Sprechgruppe „DMO 999“ angelegt, aber nirgends zugeordnet ist
- **THEN** zählt sie bei „einsatzlokale Sprechgruppen ohne Zuordnung“ und wird dort mit ihrer
  Bezeichnung genannt

#### Scenario: Einsatzlokale Sprechgruppe nur an der Führungsstelle
- **WHEN** die lokale Sprechgruppe „DMO 999“ nur der eigenen Führungsstelle zugeordnet ist
- **THEN** zählt sie nicht bei „einsatzlokale Sprechgruppen ohne Zuordnung“

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigen „Einheiten ohne Sprechgruppe“, „Einheiten ohne Erreichbarkeit“,
  „einsatzlokale Sprechgruppen ohne Zuordnung“ und „Verbindungen ohne gemeinsame Sprechgruppe“
  „—“ mit Grund, nicht „0“

#### Scenario: Einheit ohne gemeinsamen Kanal mit ihrem Abschnitt
- **WHEN** der Abschnitt „EA Nord“ die Sprechgruppe „TMO 311“ trägt und die ihm zugeordnete
  Einheit „1. Zug“ nur „DMO 505“
- **THEN** zeigt der Funkplan „1“ bei „Verbindungen ohne gemeinsame Sprechgruppe“ und nennt
  „1. Zug“ als Verweis auf die Einheit

#### Scenario: Oberster Abschnitt ohne gemeinsamen Kanal mit der Führungsstelle
- **WHEN** die Führungsstelle nur „TMO 311“ trägt und der oberste Abschnitt „EA Nord“ nur „DMO 505“
- **THEN** zählt „EA Nord“ bei „Verbindungen ohne gemeinsame Sprechgruppe“ und wird als Verweis auf den Abschnitt genannt

#### Scenario: Führungsstelle ohne Sprechgruppe
- **WHEN** die Führungsstelle nicht erfasst ist oder keine Sprechgruppe trägt
- **THEN** zählt kein oberster Abschnitt bei „Verbindungen ohne gemeinsame Sprechgruppe“

#### Scenario: Stelle ohne Sprechgruppe zählt nicht doppelt
- **WHEN** eine Einheit gar keine Sprechgruppe trägt
- **THEN** zählt sie bei „Einheiten ohne Sprechgruppe“, aber nicht bei „Verbindungen ohne
  gemeinsame Sprechgruppe“

### Requirement: Deeplink je Zeile, keine Bearbeitung
Jede Zeile SHALL zum Datensatz führen, an dem ihre Angaben gepflegt werden:
- die Führungsstelle zur Seite Einsatzdaten,
- der Abschnitt zum ausgewählten Abschnitt der Abschnittsseite,
- die Einheit zu ihrer Detailseite,
- das Fahrzeug zum ausgewählten Fahrzeug der Fahrzeugseite.

Der Funkplan MUST keine Bearbeitungsmöglichkeit bieten.

#### Scenario: Sprung zur Einheit
- **WHEN** die Person auf die Kennung einer Einheitszeile tippt
- **THEN** öffnet sich die Detailseite dieser Einheit, auf der die Sprechgruppen zugeordnet werden

#### Scenario: Sprung zur Führungsstelle
- **WHEN** die Person auf die Kennung der Zeile „Führungsstelle“ tippt
- **THEN** öffnet sich die Seite Einsatzdaten, auf der die Führungsstelle gepflegt wird

### Requirement: In Lagebericht übernehmen
Personen mit Schreibrecht im Einsatz SHALL den aktuellen Funkplan mit einer Aktion in einen neuen
Lagebericht (Vorlage Freitext) mit dem Titel „Funkplan <DTG>“ übernehmen können.
- Der Inhalt MUST den Baum mit allen Spalten außer der Erreichbarkeit wiedergeben, eine erfasste
  Führungsstelle als erste Zeile. Fehlt eine Quelle (gesperrt, nicht geladen), MUST der Bericht sie
  mit Grund nennen. „Keine Kräfte erfasst“ MUST er nur schreiben, wenn Abschnitte, Einheiten und
  Fahrzeuge geladen sind.
- Namen und Kennungen MUST als Text erscheinen, nie als Auszeichnung des Renderers (etwa `~x~`
  als Durchstreichung).
- Die Aktion MUST gesperrt sein, solange eine Quelle noch lädt. Sie MUST fehlen, wenn das Modul
  Lageberichte für die Person nicht freigegeben ist.
- Die Übernahme MUST in einem einzigen Schritt geschehen, nach `dokument-uebernahme`.
- Nach dem Erfolg SHALL der neue Lagebericht geöffnet werden.
- Scheitert die Übernahme, MUST der Fehler an der Seite stehen, und es MUST kein leerer Entwurf
  entstehen.
- Ohne Schreibrecht MUST die Aktion fehlen.

#### Scenario: Übernahme gelingt
- **WHEN** eine Person mit Schreibrecht „In Lagebericht übernehmen“ wählt
- **THEN** entsteht genau ein Lagebericht „Funkplan <DTG>“ mit dem Funkplan als Text, ohne
  Erreichbarkeit, und er wird geöffnet

#### Scenario: Führungsstelle im Lagebericht
- **WHEN** die Führungsstelle mit Rufname und Erreichbarkeit erfasst ist und der Funkplan übernommen wird
- **THEN** beginnt die Gliederung des Lageberichts mit der Führungsstelle samt Rufname, und ihre Erreichbarkeit steht nirgends im Text

#### Scenario: Übernahme scheitert
- **WHEN** das Anlegen des Lageberichts abgelehnt wird
- **THEN** zeigt die Seite den Fehler, und im Einsatz ist kein neuer Lagebericht entstanden
