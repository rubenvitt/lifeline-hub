# Spec Delta

## ADDED Requirements

### Requirement: Organigramm hält seine Knoten, solange jemand damit arbeitet
Solange der Mauszeiger oder ein Stift über dem Organigramm liegt oder der Fokus darin steht, SHALL
das Organigramm Menge, Ort und Reihenfolge seiner Knoten halten. Neue, umgehängte und entfallene
Knoten MUST warten; ein entfallener Knoten bleibt als Platzhalter ohne Link mit dem Wort
„entfallen“ stehen. Name, Rufname, Leitung und Stärke gezeigter Knoten MUST weiter live
aktualisieren. Der Kopf mit Einsatzleitung und Stab MUST still stehen.

#### Scenario: Fokussierter Link bleibt stehen
- **WHEN** der Fokus auf einem Namenslink im Organigramm steht und an einem anderen Arbeitsplatz
  ein oberster Abschnitt angelegt wird
- **THEN** bleibt der fokussierte Link an derselben Stelle, der neue Abschnitt steht noch nicht im
  Organigramm, und der Sammelbanner nennt einen neuen Knoten

#### Scenario: Zeiger über dem Organigramm
- **WHEN** der Mauszeiger auf einem Namenslink liegt und live ein Unterabschnitt unter einen
  anderen Abschnitt gehängt wird
- **THEN** bleibt der Link unter dem Zeiger an derselben Stelle, der Unterabschnitt steht noch am
  alten Ort, und der Sammelbanner nennt einen umgehängten Knoten

#### Scenario: Stärke fließt weiter
- **WHEN** der Mauszeiger über dem Organigramm liegt und live die Stärke einer gezeigten Einheit
  geändert wird
- **THEN** zeigen die Einheit und ihr Abschnitt sofort die neue Stärke an derselben Stelle

#### Scenario: Aufgelöster Abschnitt bleibt als Platzhalter
- **WHEN** der Fokus im Organigramm steht und live ein gezeigter Abschnitt aufgelöst wird
- **THEN** steht an seiner Stelle sein Name ohne Link mit dem Wort „entfallen“, und der
  Sammelbanner nennt einen entfallenen Knoten

#### Scenario: Ohne Zeiger und Fokus gilt der Live-Stand sofort
- **WHEN** weder Zeiger noch Fokus im Organigramm liegen und live ein Abschnitt angelegt wird
- **THEN** erscheint er sofort, und es steht kein Sammelbanner

### Requirement: Sammelbanner des Organigramms
Wartet bei geschlossener Schleuse mindestens eine Änderung, SHALL im Organigramm zwischen Kopf und
erster Ebene ein Sammelbanner stehen. Er MUST nennen, wie viele Knoten neu, umgehängt oder entfallen sind, und eine
Aktion „anzeigen“ bieten, die den Live-Stand anwendet. Die Zeile, in der er steht, MUST eine feste
Höhe haben, damit sein Erscheinen und Verschwinden das Organigramm nicht verschiebt. Der Weg des
Zeigers vom Organigramm zum Banner MUST die Schleuse nicht öffnen.

#### Scenario: „anzeigen“ wendet den Stand an
- **WHEN** Änderungen warten und die Person im Sammelbanner „anzeigen“ wählt
- **THEN** zeigt das Organigramm den Live-Stand, und der Sammelbanner verschwindet

#### Scenario: Banner verschiebt das Organigramm nicht
- **WHEN** der Sammelbanner bei 390 px oder 1366 px Breite erscheint oder verschwindet
- **THEN** bleibt die Oberkante der ersten Ebene des Organigramms auf derselben Höhe

#### Scenario: Zeiger verlässt das Organigramm
- **WHEN** Änderungen warten und Zeiger und Fokus das Organigramm verlassen
- **THEN** zeigt das Organigramm den Live-Stand, und der Sammelbanner verschwindet

### Requirement: Druck und Übernahme zeigen den Live-Stand
Druck und „In Lagebericht übernehmen“ SHALL immer den aktuellen Stand der Gliederung zeigen, auch
wenn die Schleuse am Bildschirm gerade Änderungen hält. Der Sammelbanner und seine Zeile MUST im
Ausdruck fehlen.

#### Scenario: Druck bei wartender Änderung
- **WHEN** ein neuer Abschnitt hinter dem Sammelbanner wartet und die Person „Drucken / als PDF“
  wählt
- **THEN** enthält der Ausdruck den neuen Abschnitt, und weder Banner noch Standzeile stehen darauf
