# Spec Delta

## MODIFIED Requirements

### Requirement: Fehlende eigene Gegenstelle wird benannt
Ist die eigene Führungsstelle des Einsatzes erfasst, SHALL der Funkplan sie als erste Zeile vor den
Abschnitten zeigen. Die Zeile trägt:

- die Stelle „Führungsstelle“,
- Rufname, TMO- und DMO-Sprechgruppen, Kommunikationsmittel und Erreichbarkeit aus ihren Angaben,
- in der Spalte Leiter/Führer den erfassten Einsatzleiter, in derselben Darstellung wie die
  Kopfleiste der Einsatzdaten, und „—“, wenn keiner erfasst ist.

Die Zeile MUST ohne Kinder stehen; der Baum darunter bleibt unverändert. Ist die Führungsstelle
nicht erfasst, SHALL der Funkplan oberhalb der Tabelle ausdrücklich sagen, dass die eigene
Gegenstelle nicht erfasst ist. Er MUST NOT eine Zeile dafür erfinden oder aus anderen Daten
vermuten. Ist ihr Abruf gesperrt oder gescheitert, MUST der Hinweis den Grund nennen statt „nicht
erfasst“.

#### Scenario: Hinweis auf die Gegenstelle
- **WHEN** der Funkplan eines Einsatzes ohne erfasste Führungsstelle geöffnet wird
- **THEN** steht oberhalb der Tabelle der Hinweis „Eigene Gegenstelle (Führungsstelle) nicht
  erfasst“, und die Tabelle enthält keine erfundene Zeile dafür

#### Scenario: Erfasste Führungsstelle
- **WHEN** die Führungsstelle mit Rufname „Florian Musterstadt 10/1“ und der Sprechgruppe „TMO 311“ erfasst ist
- **THEN** steht vor dem ersten Abschnitt die Zeile „Führungsstelle“ mit diesem Rufnamen und „311“ in der Spalte TMO, und der Hinweis „nicht erfasst“ fehlt

#### Scenario: Einsatzleiter in der Zeile der Führungsstelle
- **WHEN** an der Führungsstelle der Einsatzleiter „Anna Schulz“ erfasst ist
- **THEN** zeigt die Zeile „Führungsstelle“ in der Spalte Leiter/Führer „Anna Schulz“, und der übernommene Lagebericht nennt sie als Einsatzleiter dieser Zeile

#### Scenario: Ohne Einsatzleiter
- **WHEN** die Führungsstelle erfasst ist, aber kein Einsatzleiter, und ein Mitglied die Einsatzrolle Einsatzleitung trägt
- **THEN** zeigt die Spalte Leiter/Führer der Zeile „Führungsstelle“ „—“ und keinen Namen

#### Scenario: Führungsstelle im Druck
- **WHEN** der Funkplan mit erfasster Führungsstelle gedruckt wird
- **THEN** ist die Zeile der Führungsstelle die erste Zeile des Ausdrucks, samt Erreichbarkeit
