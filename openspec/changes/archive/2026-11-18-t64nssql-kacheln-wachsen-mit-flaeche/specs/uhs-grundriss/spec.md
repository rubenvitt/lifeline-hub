## MODIFIED Requirements

### Requirement: Kartengröße und Layout sind dichteunabhängig
Die Platzkarte SHALL in jeder Dichtestufe dieselbe Grundgröße haben, die in das Platzraster
des Servers passt: Sie bleibt schmaler als der Spaltenabstand und niedriger als der
Zeilenabstand. Der Grundriss SHALL Positionen, Karten und Plan gemeinsam mit einem Faktor
zwischen 1 und 2 strecken, so weit die sichtbare Fläche es ohne Bildlauf zulässt; passt der
Inhalt nicht, gilt der Faktor 1. Der Faktor folgt nur der Fläche, nicht der Dichtestufe.
Gespeicherte Positionen von Plätzen MUST beim Wechsel der Dichtestufe und der Fenstergröße
unverändert gelten. Weder Server noch Client dürfen sie umrechnen oder migrieren.

#### Scenario: Wechsel auf Handschuh
- **WHEN** ein Grundriss mit zehn im Raster angelegten Plätzen in der Stufe „Handschuh“ geöffnet wird
- **THEN** stehen die Karten in derselben Anordnung wie in „kompakt“, mit demselben Faktor gestreckt, soweit die freie Fläche gleich groß ist, und überlappen einander nicht

#### Scenario: Verschobenes Layout
- **WHEN** Plätze im Bearbeiten-Modus verschoben und gespeichert wurden und danach die Dichtestufe wechselt
- **THEN** zeigt der Grundriss die gespeicherten Positionen unverändert, und der Server erhält keinen Schreibzugriff

#### Scenario: Leere Fläche
- **WHEN** ein Grundriss mit vier Plätzen in einer Reihe in einer Fläche angezeigt wird, die mehr als doppelt so breit und hoch ist wie sein Inhalt
- **THEN** ist jede Karte doppelt so breit und hoch wie ihre Grundgröße, die Abstände zwischen den Karten wachsen im selben Maß, und die Fläche hat keinen Bildlauf

#### Scenario: Volle Fläche
- **WHEN** der Inhalt eines Grundrisses breiter ist als die sichtbare Fläche
- **THEN** behalten die Karten ihre Grundgröße, und die Fläche läuft wie bisher in sich über

#### Scenario: Plan wächst mit
- **WHEN** ein Grundriss mit Plan gestreckt angezeigt wird
- **THEN** deckt jede Karte dieselbe Stelle des Plans wie ungestreckt

#### Scenario: Fenster ändert sich
- **WHEN** das Fenster nach dem Laden breiter oder schmaler wird
- **THEN** passt sich die Größe der Karten ohne Neuladen an, und der Server erhält keinen Schreibzugriff

#### Scenario: Zug in gestreckter Fläche
- **WHEN** im Bearbeiten-Modus bei Faktor 2 ein Platz um 200 px nach rechts gezogen wird
- **THEN** speichert der Server eine um 100 Einheiten größere Position, und der Platz steht danach dort, wo er losgelassen wurde
