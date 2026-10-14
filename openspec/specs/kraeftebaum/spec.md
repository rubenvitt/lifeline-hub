# kraeftebaum Specification

## Purpose
Das Meldebild zeigt die Kräfte als einen Baum: Einheit mit Untereinheiten, darunter ihre Fahrzeuge
mit Besatzung, ihr Personal ohne Fahrzeug und ihr Material. Eine Baumlogik trägt Schirm,
Lagebericht-Text und Druck, damit jede Kraft genau einmal steht und die Stärke der Elternzeile
mit dem Seitenkopf übereinstimmt.

## Requirements
### Requirement: Gliederung des Kräftebaums

Das Meldebild SHALL die Kräfte als Baum zeigen: Einheiten mit ihren Untereinheiten als
eingerückte Kinder, unter jeder Einheit ihre Fahrzeuge mit Besatzung, ihr Personal ohne Fahrzeug
und ihr Material als eine verdichtete Gruppenzeile. Kräfte ohne Einheit MUST unter einer letzten
Wurzel „Ohne Einheit“ mit derselben Unterstruktur stehen. Hat eine Einheit kein Fahrzeug, MUST ihr
Personal direkt unter ihr stehen.

#### Scenario: Zug mit Gruppen
- **WHEN** der Einheit „Zug 1“ die Gruppen „Gr 1“ und „Gr 2“ unterstellt sind
- **THEN** stehen beide eingerückt unter „Zug 1“ und nicht als eigene Wurzeln

#### Scenario: Besatzung unter dem Fahrzeug
- **WHEN** zwei Personen der Einheit das Fahrzeug „Florian 1-44-1“ besetzen und eine dritte kein Fahrzeug hat
- **THEN** stehen die beiden unter dem Fahrzeug und die dritte unter „Ohne Fahrzeug“

#### Scenario: Material verdichtet
- **WHEN** einer Einheit drei Materialposten zugeordnet sind, einer davon defekt
- **THEN** zeigt sie eine Zeile „Material · 3 Posten · 1 Ausfall“, aufklappbar zu den Posten

### Requirement: Jede Kraft genau einmal

Jede Kraft der Auswahl SHALL genau einmal im Baum stehen. Eine Person, die ein Fahrzeug einer
anderen Einheit besetzt oder deren Fahrzeug weggefiltert ist, MUST bei ihrer Einheit unter
„Ohne Fahrzeug“ stehen und „fährt auf <Funkrufname>“ tragen. Die Besatzung Ist eines Fahrzeugs
MUST alle Personen zählen, die es besetzen, auch fremde.

#### Scenario: Person auf fremdem Fahrzeug
- **WHEN** eine Person der Einheit A das Fahrzeug der Einheit B besetzt
- **THEN** steht sie einmal, bei A mit „fährt auf <Funkrufname>“, und das Fahrzeug von B zählt sie in seiner Besatzung Ist

Der Baum MUST nur aktive Kräfte zeigen: entlassene oder stornierte Personen und Fahrzeuge,
herausgenommenes Material und aufgelöste Einheiten MUST NOT darin stehen, auch nicht über eine
veraltete Bindung (Spec `kraefte-entlassung`). Eine Einheit, deren Über-Einheit aufgelöst ist,
MUST als eigene Wurzel stehen.

#### Scenario: Nur aktive Kräfte, aufgelöste Über-Einheit macht die Untereinheit zur Wurzel
- **WHEN** die Gruppe „Gr X“ unter „Zug 1“ aufgelöst ist, ihr Trupp noch auf sie zeigt und ein Fahrzeug von „Zug 1“ entlassen ist
- **THEN** stehen „Gr X“ und das entlassene Fahrzeug nirgends im Baum, der Trupp steht als eigene Wurzel, und jede aktive Kraft steht genau einmal

### Requirement: Stärke im Kräftebaum

Die Zeile einer Einheit SHALL ihre Stärke samt aller Untereinheiten zeigen. Die Summe der Stärken
der Wurzeln MUST der Stärke im Seitenkopf gleichen. Fahrzeug-, Personen- und Gruppenzeilen MUST
keine Stärke zeigen; ein Fahrzeug zeigt stattdessen seine Besatzung Ist und Soll. Verteilung der
Mittel und Tönung einer Einheit MUST nur ihre eigenen Mittel zählen.

#### Scenario: Kumulierte Elternzeile
- **WHEN** „Zug 1“ selbst 1/1/2 hat und ihre Gruppen 0/1/8 und 0/1/8
- **THEN** zeigt „Zug 1“ 1/3/18//22, jede Gruppe ihre eigene Stärke, und der Kopf zählt 1/3/18//22 einmal

### Requirement: Zeilenarten ohne Farbe unterscheidbar

Einheit, Fahrzeug, Person und Gruppenzeile SHALL sich durch Zeichen, Einzug und Schrift
unterscheiden, nicht nur durch Farbe oder ein Kürzel. Personen MUST ihre Stärkeposition (F, UF,
M) als Marke tragen, der Einheitsführer zusätzlich „EF“.

#### Scenario: Zeilenart im Graustufendruck
- **WHEN** das Meldebild in Graustufen gedruckt wird
- **THEN** ist jede Zeile als Einheit, Fahrzeug, Person oder Gruppe erkennbar

### Requirement: Einstiege aus dem Meldebild

Das Meldebild SHALL eine Lesefläche bleiben. Einheitenname, Funkrufname und Personenname MUST in
die Einheit-Ansicht, die Fahrzeugzeile bzw. die Personalzeile springen; fehlt das Recht auf das
Zielmodul, MUST der Name als Text stehen. Der Handstatus einer Einheit ohne Fahrzeug bleibt.

#### Scenario: Sprung zur Fahrzeugzeile
- **WHEN** die Person im Meldebild den Funkrufnamen „Florian 1-44-1“ wählt
- **THEN** öffnet sich die Fahrzeugseite mit dieser Zeile hervorgehoben

#### Scenario: Modul gesperrt
- **WHEN** die Person kein Leserecht auf Personal hat
- **THEN** stehen Personennamen als Text ohne Sprung

### Requirement: Ausklappstufen

Das Meldebild SHALL drei Ausklappstufen bieten: „Einheiten“ (Untereinheiten sichtbar),
„mit Fahrzeugen“ (zusätzlich Fahrzeuge, Personal ohne Fahrzeug und Material) und „alles“. Beim
Öffnen MUST „Einheiten“ gelten, der Druck MUST alles aufklappen. Die Stufe MUST NOT die Zeilen
filtern, nur auf- und zuklappen.

#### Scenario: Vorgabe beim Öffnen
- **WHEN** die Person das Meldebild öffnet
- **THEN** sind Untereinheiten sichtbar und Fahrzeuge zugeklappt

### Requirement: Statusband ohne Füllkacheln

Das Statusband SHALL die Einheiten je FMS-Status und das Personal je Zustand als Zahl mit
Aufgliederung zeigen und MUST NOT leere Kacheln zum Auffüllen zeigen. „Keine Rückmeldung“ MUST nur
erscheinen, wenn es sie gibt.

#### Scenario: Wenige Status
- **WHEN** alle zwölf Personen gebunden sind
- **THEN** zeigt das Band „Personal 12“ mit einem Segment „gebunden“ und keine leere Kachel

### Requirement: Lagebericht-Text folgt dem Kräftebaum

Der Text, den „In Lagebericht übernehmen“ aus dem Meldebild erzeugt, SHALL dieselbe Gliederung
tragen wie der Schirm: Fahrzeug mit Besatzung als Unterpunkt, Personal ohne Fahrzeug, Material
verdichtet, gegliedert nach Abschnitten.

#### Scenario: Besatzung im Text
- **WHEN** das Meldebild mit einem besetzten Fahrzeug übernommen wird
- **THEN** nennt der Text die Besatzung als Unterpunkt des Fahrzeugs

### Requirement: Sprung auf eine Einheit

Das Meldebild SHALL einen Deeplink `?einheit=<id>` annehmen. Für eine aktive Einheit des
Einsatzes MUST es deren übergeordnete Einheiten und ihren Teilbaum bis zur Stufe „mit Fahrzeugen“
aufklappen, die Zeile ins Bild holen und sie nach Spec `deeplink-hervorhebung` markieren. Die
übrigen Zeilen MUST in der Vorgabestufe bleiben. Eine unbekannte oder fremde ID MUST die
Vorgabestufe ohne Markierung lassen.

#### Scenario: Nach dem Bilden aus einer Vorlage
- **WHEN** das Meldebild mit `?einheit=` eines gerade gebildeten Zugs öffnet
- **THEN** sind Zug, Staffel und ihre Fahrzeuge aufgeklappt, und die Zeile des Zugs ist markiert

#### Scenario: Unbekannte Einheit
- **WHEN** das Meldebild mit `?einheit=` einer nicht vorhandenen Einheit öffnet
- **THEN** zeigt es die Vorgabestufe „Einheiten“ ohne Markierung
