# Spec Delta

## MODIFIED Requirements

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
- Sprechgruppen mit nur einem Teilnehmer (Stelle oder Komponente); eine einsatzlokale ohne
  Teilnehmer zählt nur bei „ohne Zuordnung“
- Leitstelle ohne Verbindung, nach derselben Regel wie im Kommunikationsplan

Jede Zahl MUST aus denselben geladenen Listen gerechnet werden wie die Tabelle. Hängt eine Zahl an
einer gesperrten, nicht geladenen oder noch ladenden Liste, MUST sie „—“ mit Grund zeigen und
MUST NOT „0“ zeigen. Bei einer Zahl größer null MUST der Funkplan die betroffenen Datensätze
nennen: Abschnitte und Einheiten als Verweis auf die Stelle, an der sie gepflegt werden,
einsatzlokale Sprechgruppen und Sprechgruppen mit nur einem Teilnehmer mit ihrer Bezeichnung,
Verbindungen als Verweis auf die untere Stelle, die fehlende Leitstelle als Verweis auf den
Kommunikationsplan.
Die Lücken MUST im ersten Bild stehen, bei 1366 × 768 px mit offenem Modulpanel. Sie MUST in
jeder Darstellung des Funkplans (Tabelle, Skizze und Sprechgruppen) dieselben sein.

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

#### Scenario: Sprechgruppe mit nur einem Teilnehmer
- **WHEN** „DMO 505“ nur der Einheit „1. Zug“ zugeordnet ist
- **THEN** zeigt der Funkplan „1“ bei „Sprechgruppen mit nur einem Teilnehmer“ und nennt „DMO 505“

#### Scenario: Leitstelle ohne Verbindung
- **WHEN** keine Stelle der Art Leitstelle eine Verbindung, eine Sprechgruppe oder eine Verbindung
  in der Fernmeldeskizze trägt
- **THEN** zeigt der Funkplan die Lücke „Leitstelle: keine Verbindung erfasst“ mit Verweis auf den
  Kommunikationsplan

#### Scenario: Kommunikationsplan nicht geladen
- **WHEN** der Abruf des Kommunikationsplans scheitert
- **THEN** zeigt die Lücke „Leitstelle“ „—“ mit Grund, nicht „0“

### Requirement: Darstellung „Sprechgruppen“
Der Funkplan SHALL eine dritte Darstellung „Sprechgruppen“ haben: eine Zeile je Sprechgruppe des
Einsatzes, also jede einem Abschnitt oder einer Einheit zugeordnete und jede einsatzlokale. Teilnehmer sind
auch die externen Stellen des Kommunikationsplans mit ihrem Status und die Komponenten der
Fernmeldeskizze. Spalten:
Sprechgruppe (fixiert, Festbreitenschrift), Betriebsart, Hinweis, Herkunft (Katalog oder
einsatzlokal) und Teilnehmer. Zuerst TMO, dann DMO, je in der Sortierung der Sprechgruppen. Sie ist
schreibgeschützt und aus denselben Quellen abgeleitet wie die Tabelle.

#### Scenario: Teilnehmer einer Sprechgruppe
- **WHEN** „TMO 311“ dem Abschnitt „EA Nord“ (Kurzbezeichnung „EA N“) und der Einheit „1. Zug“
  (Funkrufname „Florian Musterstadt 1“) zugeordnet ist
- **THEN** zeigt die Zeile „311“ beide Stellen mit Rufnamen als Teilnehmer, und jede führt zu ihrem
  Datensatz

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** die lokale Sprechgruppe „DMO 999“ nirgends zugeordnet ist
- **THEN** steht sie mit Herkunft „einsatzlokal“ und dem Teilnehmer „keine“ in der Darstellung

#### Scenario: Katalog-Sprechgruppe ohne Zuordnung
- **WHEN** eine Sprechgruppe des Organisationskatalogs keinem Abschnitt und keiner Einheit des
  Einsatzes zugeordnet ist
- **THEN** erscheint sie nicht

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigt die Darstellung die Sprechgruppen der Abschnitte und die einsatzlokalen, und
  oberhalb steht, dass Einheiten nicht freigegeben sind; keine Zeile behauptet, eine Sprechgruppe
  habe keine Teilnehmer, wenn sie nur an einer gesperrten Quelle hängen könnte

#### Scenario: Sichtvorgabe aus einem Link
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=sprechgruppen` öffnet
- **THEN** steht die Darstellung auf „Sprechgruppen“, und `ansicht` ist aus der Adresse entfernt

#### Scenario: Druck der Darstellung
- **WHEN** eine Person in der Darstellung „Sprechgruppen“ druckt
- **THEN** nennt der Druckkopf die Darstellung „Sprechgruppen“, und jede Zeile steht ohne
  waagerechten Überhang auf A4

#### Scenario: Leitstelle als Teilnehmer
- **WHEN** der Leitstelle „ILS Musterhausen“ „TMO SL AS“ mit Status „geplant“ zugeordnet ist
- **THEN** nennt die Zeile „TMO SL AS“ die Leitstelle als Teilnehmer mit dem Wort „geplant“, und
  sie führt zum Kommunikationsplan

### Requirement: In Lagebericht übernehmen
Personen mit Schreibrecht im Einsatz SHALL den aktuellen Funkplan mit einer Aktion in einen neuen
Lagebericht (Vorlage Freitext) mit dem Titel „Funkplan <DTG>“ übernehmen können.
- Der Inhalt MUST den Baum mit allen Spalten außer der Erreichbarkeit wiedergeben, eine erfasste
  Führungsstelle als erste Zeile. Fehlt eine Quelle (gesperrt, nicht geladen), MUST der Bericht sie
  mit Grund nennen. „Keine Kräfte erfasst“ MUST er nur schreiben, wenn Abschnitte, Einheiten und
  Fahrzeuge geladen sind.
- Nach dem Baum MUST der Inhalt einen Abschnitt „Kommunikationsskizze“ tragen: „Gültig ab“, je
  Sprechgruppe Bedingungszeichen und Teilnehmer mit Rufname (externe Stellen mit Status), danach
  die übrigen Verbindungen der Skizze mit Art, Medium und Status. Rufnummern MUST NOT darin stehen.
  Fehlen die Daten der Skizze oder die externen Stellen, MUST der Abschnitt das mit Grund nennen.
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

#### Scenario: Kanäle im Lagebericht
- **WHEN** Führungsstelle, „EA 1“ und die Leitstelle (geplant) „TMO BN_BOS“ tragen und der Funkplan
  übernommen wird
- **THEN** enthält der Lagebericht unter „Kommunikationsskizze“ die Zeile „TMO BN_BOS“ mit
  Einsatzleitung, „EA 1“ und der Leitstelle samt „geplant“, und keine Rufnummer
