# layout-gates-rollen Specification

## Purpose

Sichert zu, dass die Layout-Zusagen der Bedien-Leitlinie (kein waagerechter Überlauf,
Treffflächen nach Dichtestufe) nicht nur für den Administrator gelten. Sie gelten auch für
Benutzer ohne Schreib- oder Verwaltungsrecht, die andere und oft breitere Zustände sehen.

Rollen in dieser Spec:
- **Beobachter**: System-Rolle `keiner`, Org-Rolle `keine`, Einsatzrolle `beobachter`. Dieser
  Benutzer hat weder Verwaltungs- noch Schreibrecht.
- **Org-Führungskraft**: Org-Rolle `fuehrungskraft`. Sie erreicht die Verwaltung, ist dort aber
  kein System-Admin.
- **Führungspersonal**: Einsatzrolle `fuehrungspersonal`. Es darf schreiben, aber nicht leiten.

Prüfbreiten sind die von Gate 1: 1366, 1024, 768 und 390 px.

## Requirements

### Requirement: Kein Überlauf ohne Schreibrecht

Jede Einsatzroute, die Gate 1 für den Administrator misst, MUST auch für den Beobachter auf
jeder Prüfbreite ohne waagerechten Überlauf der Seite rendern (Toleranz 1 px). Das gilt auch
dann, wenn die Seite dem Beobachter einen Rechtehinweis, gesperrte Aktionen oder einen
Nur-Lese-Zweig zeigt.

#### Scenario: Beobachter auf einer Seite mit Rechtehinweis
- **WHEN** der Beobachter die Ablösungs-, Verpflegungs- oder Betreuungsseite eines Einsatzes mit gesätem, absichtlich langem Inhalt auf 390 px öffnet
- **THEN** steht der Rechtehinweis sichtbar da, und `scrollWidth` des Dokuments übersteigt seine `clientWidth` um höchstens 1 px

#### Scenario: Beobachter im Einsatztagebuch
- **WHEN** der Beobachter das ETB eines Einsatzes mit gesätem Eintrag auf einer Prüfbreite öffnet
- **THEN** fehlt die Erfassungsleiste, der gesäte Eintrag ist sichtbar, und die Seite läuft nicht waagerecht über

### Requirement: Kein Überlauf in der Verwaltung ohne Admin-Recht

Jede Verwaltungsroute, die die Org-Führungskraft erreicht und die ein Layout-Gate für den
Administrator misst, MUST auch für die Org-Führungskraft auf den Prüfbreiten des Gates ohne
waagerechten Überlauf rendern. Das gilt mit gesperrten Aktionen und dem Rechtehinweis.

#### Scenario: Führungskraft in den Stammdaten
- **WHEN** die Org-Führungskraft die Fahrzeug-Stammdaten auf 390 px öffnet
- **THEN** steht der Rechtehinweis sichtbar da, und die Seite läuft nicht waagerecht über

#### Scenario: Führungskraft bei den Anmeldeverfahren
- **WHEN** die Org-Führungskraft die Anmeldeverfahren auf dem Führungs-Tablet öffnet
- **THEN** trägt jede Zeile ihren Sperrgrund, keine Zeile läuft über, und die Kippschalter halten die Trefffläche der Dichtestufe

### Requirement: Gesperrte Kopfzeile bleibt im Rahmen

Die globale Kopfzeile MUST für einen Benutzer ohne Verwaltungsrecht auf 390 px und auf 1024 px
ohne waagerechten und senkrechten Überlauf rendern. Ihre Bedienziele MUST die Trefffläche der
gewählten Dichtestufe halten.

#### Scenario: Tag „Keine Berechtigung“ auf dem Führungs-Tablet
- **WHEN** ein Benutzer ohne Verwaltungsrecht `/einsaetze` auf 1024 px öffnet
- **THEN** steht der gedämpfte Eintrag „Verwaltung“ mit dem Tag „Keine Berechtigung“ da, es gibt keinen freien Verwaltungs-Link, und `scrollWidth` der Kopfzeile übersteigt ihre `clientWidth` nicht

### Requirement: Treffflächen im Nur-Lese-Zweig

Bedienziele, die dem Beobachter bleiben, MUST die Trefffläche der Dichtestufe halten
(30 / 48 / 72 px). Dazu gehören gesperrte Primäraktionen, Lese-Links und die Ausgänge der
Karten. Ein Ziel, das der Nur-Lese-Zweig **versteckt**, MUST im Gate als abwesend zugesichert
werden, statt still aus der Messmenge zu fallen.

#### Scenario: Gesperrte Primäraktion
- **WHEN** der Beobachter die Ablösungsseite in `handschuh` öffnet
- **THEN** ist die Primäraktion sichtbar gesperrt und misst mindestens 72 px in der Höhe

#### Scenario: Versteckte Aktion
- **WHEN** der Beobachter die Stabsseite öffnet
- **THEN** gibt es keinen Knopf „Besetzung ändern“, und die übrigen Ziele der Seite halten die Stufe

### Requirement: Nachweis trägt die Rolle als Ursache

Jeder nicht-privilegierte Durchgang eines Layout-Gates MUST vor der Messung zusichern, dass der
Rollenzweig tatsächlich steht (zum Beispiel Rechtehinweis sichtbar, kein freier Link, Aktion
gesperrt oder abwesend). Für jeden solchen Durchgang MUST eine Mutationsprobe festgehalten sein,
bei der nur der Nicht-Admin-Zweig verbreitert wird. Unter dieser Probe wird der
Nicht-Admin-Durchgang rot, der Admin-Durchgang bleibt grün.

#### Scenario: Vorbedingung fällt weg
- **WHEN** der Rollenzweig entfernt wird, etwa weil die Seite den Rechtehinweis nicht mehr rendert
- **THEN** schlägt der nicht-privilegierte Durchgang an der Vorbedingung fehl und nicht erst später oder gar nicht

#### Scenario: Mutationsprobe
- **WHEN** der Rechtehinweis für die Probe eine Mindestbreite über der Prüfbreite bekommt
- **THEN** meldet der Beobachter-Durchgang von Gate 1 den Überlauf, und der Admin-Durchgang derselben Breite bleibt grün

### Requirement: Freistellung nennt die Rolle

Eine namentliche Freistellung eines bekannten Überlaufs in Gate 1 MUST neben Route und Breite die
Rolle nennen. Eine Freistellung für eine Rolle MUST die Messung der anderen Rollen auf derselben
Route und Breite unberührt lassen.

#### Scenario: Freistellung nur für den Beobachter
- **WHEN** ein Verstoß nur für den Beobachter freigestellt ist
- **THEN** ist derselbe Verstoß im Admin-Durchgang rot, und der Eintrag gilt als tot, sobald der Beobachter-Durchgang ihn nicht mehr misst

### Requirement: Modulsperre per Override ist eine eigene Achse

Ist ein Modul eines Einsatzes per Override einer Rolle vorbehalten, die der Benutzer nicht hat,
MUST der Navigationsrahmen (Drawer auf 390 px, Rail und Modulpanel auf 1024 px) für diesen
Benutzer ohne waagerechten Überlauf rendern. Dasselbe MUST für das Lage-Dashboard auf seinen
Prüfbreiten gelten, und zwar mit denselben Zusicherungen wie für den Administrator. Der
Nachweis MUST vor der Messung zusichern, dass der Sperrzweig steht.

#### Scenario: Gesperrte Zeile im Navigations-Drawer
- **WHEN** ein Beobachter auf 390 px den Navigations-Drawer eines Einsatzes öffnet, in dem ein Modul per Override nur Administratoren freisteht
- **THEN** steht die Zeile dieses Moduls gesperrt mit dem Grund „Keine Berechtigung“ da, und weder der geschlossene noch der offene Drawer erzeugt waagerechten Überlauf

#### Scenario: Gesperrte Zeile in Rail und Modulpanel
- **WHEN** derselbe Beobachter den Einsatz auf 1024 px öffnet
- **THEN** steht die Navigation inline, die gesperrte Zeile ist gesperrt, und der Navigationsrahmen läuft nicht waagerecht über

#### Scenario: Gesperrte Kennzahlen im Lage-Dashboard
- **WHEN** ein Beobachter das Lage-Dashboard eines Einsatzes öffnet, dessen Personen-, Gefahren- und ETB-Modul per Override nur Administratoren freistehen
- **THEN** zeigen die betroffenen Kennzahlplätze „—“ mit dem Grund „nicht freigegeben“ statt einer Zahl, die Paneele tragen ihren Sperrsatz, Band und Paneele haben die Spaltenzahl der Prüfbreite, und keine Kennzahl läuft aus ihrer Zelle

#### Scenario: Mutationsprobe am Sperrzweig
- **WHEN** für die Probe nur der gesperrte Zweig der Modulzeile bzw. des Kennzahlplatzes eine Mindestbreite über der Prüfbreite bekommt
- **THEN** wird der Durchgang mit Modulsperre rot, und der Administrator-Durchgang derselben Spec und Breite bleibt grün
