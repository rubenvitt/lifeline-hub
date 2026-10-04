# Spec Delta

## ADDED Requirements

### Requirement: Skizze hält ihre Knoten, solange jemand damit arbeitet
Solange der Mauszeiger oder ein Stift über der Fernmeldeskizze liegt oder der Fokus darin steht,
SHALL die Skizze Menge, Ort und Reihenfolge ihrer Knoten halten, mit demselben Verhalten wie das
Organigramm der Führungsorganisation: Neue, umgehängte und entfallene Knoten warten hinter einem
Sammelbanner in einer Zeile fester Höhe, Rufname, Sprechgruppen und Kante gezeigter Knoten
aktualisieren weiter, die Wurzel „Einsatzleitung“ steht still. Eine umgehängte Einheit MUST am
alten Ort ihre bisherige Kante zeigen, nicht das Urteil gegen den neuen Abschnitt. Der Druck MUST den Live-Stand zeigen.

#### Scenario: Zugang unter dem Zeiger
- **WHEN** der Mauszeiger auf einem Namenslink der Skizze liegt und live eine Einheit einem
  Abschnitt zugeordnet wird
- **THEN** bleibt der Link unter dem Zeiger an derselben Stelle, und der Sammelbanner nennt einen
  umgehängten Knoten

#### Scenario: Sprechgruppe fließt weiter
- **WHEN** der Mauszeiger über der Skizze liegt und live einer gezeigten Einheit eine Sprechgruppe
  zugeordnet wird
- **THEN** trägt ihre Kante die Sprechgruppe sofort, ohne dass ein Knoten seinen Ort ändert

#### Scenario: Ohne Zeiger und Fokus gilt der Live-Stand sofort
- **WHEN** weder Zeiger noch Fokus in der Skizze liegen und live eine Einheit einem Abschnitt
  zugeordnet wird
- **THEN** steht sie sofort unter diesem Abschnitt, und es steht kein Sammelbanner
