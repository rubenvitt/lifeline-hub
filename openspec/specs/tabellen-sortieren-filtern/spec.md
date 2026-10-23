# tabellen-sortieren-filtern Specification

## Purpose
Vergleichstabellen (`Datensicht`, `KatalogTabelle`) lassen sich je Spalte im Kopf sortieren und
filtern. Die Wahl bleibt beim Zurück, beim Neuladen und in einem geteilten Link erhalten, und eine
gefilterte Liste sagt, dass sie gefiltert ist. Vorbild ist die Schadenliste; der Rollout auf alle
Listen folgt getrennt (LLH-1096).

## Requirements

### Requirement: Sortieren und Filtern im Spaltenkopf
Eine Spalte mit Sortierwert SHALL sich per Klick auf ihren Kopf sortieren lassen. Eine Spalte mit
geschlossener Wertemenge SHALL im Kopf einen Filterauslöser tragen, der die Werte zum Ankreuzen
anbietet. Im Clientmodus MUST jeder Wert die Zahl der Zeilen nennen, die er unter den übrigen
Einschränkungen träfe. Der Auslöser MUST in der Tab-Folge liegen, „<Spalte> filtern“ heißen und
gefiltert „<Spalte> filtern, gefiltert“. Die gefilterte Kopfzelle MUST eine Linie in der Rolle
`bedien` an der Unterkante tragen, die gegen den Kopf mindestens 3 : 1 hält.

#### Scenario: Filter im Kopf der Schadenliste
- **WHEN** in der Schadenliste ab der Breite `md` im Kopf „Ausmaß“ der Wert „groß“ angekreuzt und bestätigt wird
- **THEN** zeigt die Tabelle nur große Schäden, der Auslöser heißt „Ausmaß filtern, gefiltert“, und die Kopfzelle trägt die Linie

#### Scenario: Sortierklick
- **WHEN** auf den Kopf „Ort“ geklickt wird
- **THEN** stehen die Schäden nach Ort aufsteigend

### Requirement: Baum ohne Sortieren und Filtern
Eine Sicht im Baummodus (Meldebild, Funkplan, Kommunikationsplan) MUST NOT sortieren oder filtern:
ihre Folge ist die Aussage, und die Aggregate der Elternzeilen lögen, fiele eine Zeile weg. Die
Ausnahme MUST als Kommentar an der Sicht stehen; eine flache Darstellung derselben Daten (die
Sprechgruppen des Funkplans) folgt dem Muster.

#### Scenario: Funkplan und Sprechgruppen
- **WHEN** im Fernmeldewesen der Reiter „Funkplan“ und danach „Sprechgruppen“ gewählt wird
- **THEN** trägt die Funkplan-Tabelle keinen Sortier- oder Filterauslöser, die Sprechgruppen filtern im Kopf „Bedingung“ nach TMO und DMO

### Requirement: Kartenzweig zeigt dieselbe Menge
Unterhalb der Breite `md` SHALL die Sicht dieselbe Menge zeigen wie die Tabelle. Sie MUST die
Filter als Auswahlfelder und die Sortierung über ein Auswahlfeld „Sortieren“ anbieten. Ausgenommen
sind Filter, die die Seite als `ohneKartenfeld` kennzeichnet, weil jedes weitere Feld die erste
Karte aus dem ersten Bild schöbe und die Seite die Achse schon über der Liste führt; ein solcher
Filter MUST weiter wirken und als Chip erscheinen.

#### Scenario: Betroffene am Handy
- **WHEN** die Adresse `…/personen?f.sk=sk1` bei 390 px geöffnet wird
- **THEN** zeigen die Karten nur Personen mit SK I, über der Liste steht der Chip „Sichtung: SK I“, und weder Sichtung noch Status noch Verbleib haben ein Auswahlfeld

#### Scenario: Wechsel auf den Handschirm
- **WHEN** die gefilterte Schadenliste auf 390 px Breite schrumpft
- **THEN** zeigen die Karten nur die großen Schäden, und „Sortieren“ steht über der Liste

### Requirement: Filterhinweis und Chips
Wirkt eine Suche oder ein Filter, SHALL über der Liste der `Filterhinweis` stehen (Treffer von
Gesamt, Merkmale, „Filter zurücksetzen“) und je aktivem Wert ein Chip, dessen Klick genau diesen
Wert entfernt. „Filter zurücksetzen“ MUST Suche und alle Filter leeren und die Sortierung lassen.
Der Filter einer ausgeblendeten Spalte MUST NOT wirken und MUST NOT als Chip erscheinen.

#### Scenario: Zurücksetzen
- **WHEN** die Liste nach „groß“ gefiltert und nach Ort sortiert ist und „Filter zurücksetzen“ gewählt wird
- **THEN** stehen alle Schäden da, kein Chip und kein Hinweis, weiterhin nach Ort sortiert

### Requirement: Zustand in der Adresse und in der Sitzung
Sortierung, Filter und Suche SHALL in der Adresse stehen (`sort=<spalte>:auf|ab`, `sort=aus`
für bewusst unsortiert, `f.<spalte>=<wert>,…`, `q=`), geschrieben ohne neuen Verlaufsschritt.
Die Vorgabesortierung MUST NOT in der Adresse stehen; fremde Parameter MUST erhalten bleiben.
Ohne Listenparameter in der Adresse MUST der Stand der Sitzung gelten (je Seite und Einsatz) und
in die Adresse geschrieben werden. Unbekannte Spalten und Werte MUST verworfen werden. Der Stand
der Sitzung MUST bei jedem Ausgang geräumt werden. Die Spaltenwahl SHALL je Seite am Gerät
gemerkt werden.

#### Scenario: Zurück aus dem Detail
- **WHEN** die Schadenliste gefiltert und sortiert ist, ein Schaden geöffnet und Zurück gewählt wird
- **THEN** steht dieselbe gefilterte und sortierte Liste da

#### Scenario: Neuladen und geteilter Link
- **WHEN** die Adresse `…/schaeden?sort=ort:auf&f.ausmass=gross` neu geladen oder von einer anderen Person geöffnet wird
- **THEN** zeigt die Liste die großen Schäden nach Ort aufsteigend

#### Scenario: Rückweg über das Modulmenü
- **WHEN** die Schadenliste ohne Parameter erneut geöffnet wird, nachdem in dieser Sitzung gefiltert wurde
- **THEN** steht der gemerkte Filter da und auch in der Adresse

#### Scenario: Voreinstellung ohne gemerkte Spaltenwahl
- **WHEN** die Personalliste auf einem Gerät geöffnet wird, das für sie noch keine Spaltenwahl gemerkt hat
- **THEN** sind die voreingestellt ausgeblendeten Spalten „Träger“, „Ruhe“ und „Bemerkung“ ausgeblendet

#### Scenario: Suche mit Personendaten bleibt aus der Adresse
- **WHEN** in der Betroffenenliste nach einem Namen gesucht und nach Verbleib gefiltert wird
- **THEN** steht der Filter in der Adresse, der Suchbegriff nur im Stand der Sitzung; eine Suche in einer alten Adresse wird beim Öffnen weggeräumt

#### Scenario: Filter auf Werte aus den Daten
- **WHEN** die Adresse `…/fahrzeuge?f.traeger=ASB` neu geladen wird, bevor die Fahrzeuge geladen sind
- **THEN** bleibt der Filter stehen und zeigt nach dem Laden nur die Fahrzeuge des ASB

### Requirement: Servermodus filtert nicht doppelt
Im Servermodus SHALL die Sicht Kopffilter, Suche und Sortierung an die Seite melden und MUST NOT
selbst filtern oder sortieren. Das Kopfmenü MUST NOT zählen. Die Zahlen des Filterhinweises MUST
aus einer Serverzählung kommen; fehlt sie, steht keine Zahl.

#### Scenario: Kopffilter am Server
- **WHEN** in der seitenweise geladenen Schadenliste im Kopf „Ausmaß“ „katastrophal“ gewählt wird
- **THEN** fragt die Seite den Server mit diesem Filter und zeigt einen Schaden weit hinten ohne Nachladen

### Requirement: KatalogTabelle übernimmt das Muster
Eine `KatalogTabelle` mit Spaltenfiltern SHALL dieselben Chips und denselben Filterhinweis
zeigen, sofern der Aufrufer Filter und Sortierung nicht selbst kontrolliert. Mit `gedaechtnis`
MUST sie ihren Zustand wie die `Datensicht` in Adresse und Sitzung halten.

#### Scenario: Aufrufer kontrolliert selbst
- **WHEN** eine Spalte `filteredValue` vom Aufrufer bekommt
- **THEN** zeigt die `KatalogTabelle` dafür weder Chip noch Hinweis
