# Spec Delta

## ADDED Requirements

### Requirement: Eine Akte ohne Spiegel endet mit dem Einsatz beim Gegenüber

Hält eine Instanz bei eingeschaltetem Schalter eine Führungsakte ohne lokalen Einsatz, SHALL sie
deren Kennung beim Abgleich jedem Gegenüber nennen, über das die Akte gekommen sein kann. Meldet
das Gegenüber den Einsatz als gelöscht, MUST die Instanz die Akte samt Verlauf löschen; sie
erscheint danach nicht mehr unter „Einsätze beim Gegenüber“. Ein Gegenüber, das die Nennung nicht
kennt, MUST weiter abgleichen können; die Akte bleibt dann stehen.

#### Scenario: Der Hub löscht einen nie gespiegelten Einsatz
- **WHEN** der Hub einen Einsatz führt, der beim Koppeln schon abgeschlossen war, der ELW ihn unter „Einsätze beim Gegenüber“ zeigt und der Hub ihn endgültig löscht
- **THEN** zeigt der ELW ihn nach dem nächsten Abgleich nicht mehr

#### Scenario: Der ELW löscht einen nie gespiegelten Einsatz
- **WHEN** der ELW einen Einsatz führt, der beim Koppeln schon abgeschlossen war, der Hub ihn unter „Einsätze beim Gegenüber“ zeigt und der ELW ihn endgültig löscht
- **THEN** zeigt der Hub ihn nach dem nächsten Abgleich nicht mehr

#### Scenario: Der Einsatz besteht weiter
- **WHEN** der ELW eine Akte ohne Spiegel nennt und der Hub den Einsatz noch hält
- **THEN** bleibt die Akte am ELW stehen

#### Scenario: Älteres Gegenüber
- **WHEN** das Gegenüber die Nennung von Akten ohne Spiegel nicht kennt
- **THEN** läuft der Abgleich wie bisher, und die Akte bleibt stehen

#### Scenario: Schalter aus
- **WHEN** die Führung je Einsatz an einer Instanz ausgeschaltet ist
- **THEN** nennt sie im Abgleich keine Akten und löscht keine auf die Meldung eines Gegenübers hin

### Requirement: Gelöscht meldet eine Instanz nur mit Beleg

Eine Instanz MUST eine genannte Kennung nur dann als gelöscht melden, wenn sie das Ende des
Einsatzes festgehalten hat und weder einen Einsatz noch eine Akte mit dieser Kennung hält. Den
Beleg SHALL sie festhalten, wenn sie einen Einsatz mit Kennung endgültig löscht oder zur
Verwahrung abgibt und wenn sie eine Akte auf eine solche Meldung hin löscht. Eine Kennung, die
sie nicht kennt, MUST sie übergehen.

#### Scenario: Rückkehr aus einer Sicherung
- **WHEN** der Hub aus einer Sicherung zurückkehrt, die einen Einsatz noch nicht kannte, und der ELW dessen Akte ohne Spiegel nennt
- **THEN** meldet der Hub nichts, und die Akte bleibt am ELW stehen

#### Scenario: Verwahrter Einsatz mit der Kennung des ELW
- **WHEN** der Hub einen zur Verwahrung übernommenen Einsatz des ELW 1 endgültig löscht und ELW 2 dessen Akte ohne Spiegel nennt
- **THEN** meldet der Hub ihn als gelöscht, obwohl die Kennung mit der des ELW 1 beginnt

#### Scenario: Die Akte kommt wieder
- **WHEN** eine Instanz das Ende einer Kennung festgehalten hat und danach wieder eine Akte mit dieser Kennung bekommt
- **THEN** meldet sie die Kennung nicht als gelöscht, solange sie die Akte hält

#### Scenario: Spiegel nach der Nachbereitung abgeräumt
- **WHEN** der ELW den Spiegel eines Einsatzes nach der Nachbereitung abräumt, den der Hub weiter hält
- **THEN** hält der ELW kein Ende fest und meldet den Einsatz niemandem als gelöscht

#### Scenario: Einsatz einer anderen Organisation
- **WHEN** ein Gegenüber eine Kennung nennt, deren Einsatz hier gelöscht wurde, aber zu einer Org gehörte, die dieser Kopplung nicht zugeordnet ist
- **THEN** meldet die Instanz nichts

### Requirement: Die erreichte Seite löscht eine Akte nur auf Meldung ihres Führers

Die erreichte Seite MUST die Meldung einer meldenden Seite, ein Einsatz sei gelöscht, nur für
eine Akte ohne Spiegel annehmen, die diese meldende Seite als Führer nennt, und SHALL ihr nur
solche Akten nennen. Die meldende Seite SHALL die Meldung der erreichten für jede Akte ohne
Spiegel einer Org annehmen, die dieser Kopplung zugeordnet ist.

#### Scenario: Ein ELW meldet den Einsatz eines anderen
- **WHEN** der Hub eine Akte ohne Spiegel hält, die „ELW 1“ als Führer nennt, und „ELW 2“ deren Kennung als gelöscht meldet
- **THEN** bleibt die Akte am Hub stehen

#### Scenario: Org einer anderen Kopplung
- **WHEN** ein Gegenüber eine Kennung als gelöscht meldet, deren Akte zu einer Org gehört, die dieser Kopplung nicht zugeordnet ist
- **THEN** bleibt die Akte stehen

### Requirement: An mehreren erreichten Seiten entscheidet nur der Führer der Akte

Hängt die Org einer meldenden Seite an mehr als einer erreichten Seite, MUST die meldende Seite
die Meldung, ein Einsatz sei gelöscht, nur für Akten ohne Spiegel annehmen, die die meldende
erreichte Seite selbst führt, und SHALL ihr nur solche nennen. Akten, die eine dritte Instanz
führt, bleiben dann stehen.

#### Scenario: ELW an zwei Hubs
- **WHEN** die Org eines ELW an „Hub A“ und „Hub B“ hängt, der ELW die Akte eines Einsatzes hält, den eine andere ELW führt, und „Hub B“ ihn als gelöscht meldet
- **THEN** bleibt die Akte am ELW stehen

#### Scenario: Der Hub löscht seinen eigenen Einsatz
- **WHEN** die Org eines ELW an „Hub A“ und „Hub B“ hängt und „Hub B“ einen Einsatz endgültig löscht, den er selbst führte und den der ELW nur als Akte kennt
- **THEN** zeigt der ELW ihn nach dem nächsten Abgleich mit „Hub B“ nicht mehr

### Requirement: Die erreichte Seite reicht das Ende eines Einsatzes weiter

Löscht die erreichte Seite eine Akte, weil ihr Führer den Einsatz als gelöscht meldet, oder räumt
sie deshalb ihren Spiegel ab, MUST sie den Einsatz danach jeder weiteren meldenden Seite derselben
Org als gelöscht melden, die seine Akte ohne Spiegel nennt.

#### Scenario: Zwei ELW an einem Hub
- **WHEN** „ELW 1“ einen Einsatz führt, den „ELW 2“ nur als Akte über den Hub kennt, und „ELW 1“ ihn endgültig löscht
- **THEN** zeigt nach dem Abgleich von „ELW 1“ der Hub und nach dem folgenden Abgleich von „ELW 2“ auch „ELW 2“ den Einsatz nicht mehr unter „Einsätze beim Gegenüber“

### Requirement: Widerruf entfernt die Akten ohne Spiegel des Gegenübers

Endet die Org-Zuordnung einer Kopplung, hier oder beim Gegenüber, SHALL die Instanz jede Akte
ohne Spiegel dieser Org löschen, die das widerrufene Gegenüber als Führer nennt, und ihr Ende
festhalten, auch bei ausgeschaltetem Schalter. Akten, die eine andere Instanz als Führer nennen,
MUST sie behalten. Nach einer neuen Zuordnung zeigt sie die Akten wieder, die das Gegenüber ihr
dann übergibt.

#### Scenario: Ein ELW von zweien wird widerrufen
- **WHEN** eine Org am Hub „ELW 1“ und „ELW 2“ zugeordnet ist, der Hub Akten ohne Spiegel beider hält und der Admin die Zuordnung zu „ELW 1“ widerruft
- **THEN** zeigt der Hub unter „Einsätze beim Gegenüber“ nur noch die Einsätze von „ELW 2“, und „ELW 2“ zeigt die Einsätze von „ELW 1“ nach seinem nächsten Abgleich nicht mehr

#### Scenario: Neue Zuordnung
- **WHEN** die widerrufene Zuordnung zu „ELW 1“ neu angelegt wird und „ELW 1“ sich meldet
- **THEN** zeigt der Hub die Einsätze von „ELW 1“ wieder
