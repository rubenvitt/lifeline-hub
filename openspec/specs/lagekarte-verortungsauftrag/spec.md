# lagekarte-verortungsauftrag Specification

## Purpose
Legt fest, wie die Lagekarte einen Verortungsauftrag von außen ausführt (Person, Schaden,
Betreuungsstelle, Bereitstellungsraum, Tier). Das Verortete muss danach sichtbar sein, und es gibt
einen sicheren Rückweg zum Datensatz.

## Requirements

### Requirement: Die Ebene des Auftrags ist eingeblendet

Läuft ein Verortungsauftrag, SHALL die Karte die Ebene des Objekttyps zeichnen, auch wenn ihr
Schalter aus ist. Danach MUST sie gezeichnet bleiben, bis die Kartenseite verlassen wird. Dieser
Vorrang MUST NOT den Schalter umstellen, die Kartenansicht als geändert markieren oder gespeichert
werden. Zugriffsgrenzen MUST weiter gelten: ohne freigegebenes Modul „Personen“ erscheinen keine
Personenmarker.

#### Scenario: Person verorten bei ausgeschalteter Ebene
- **WHEN** die Ebene „Betroffene“ aus ist und jemand auf der Detailseite von R-005 „Auf Lagekarte
  verorten“ wählt und auf die Karte tippt
- **THEN** zeigt die Karte den Personenmarker von R-005
- **AND** der Schalter „Betroffene“ steht weiter auf aus, und die Ansicht gilt nicht als geändert

#### Scenario: Ohne Modulfreigabe
- **WHEN** das Modul „Personen“ für den Benutzer nicht frei ist
- **THEN** startet kein Platzier-Modus für eine Person, und die Karte zeigt keine Personenmarker

### Requirement: Rückmeldung und Rückweg nach dem Verorten

Nach erfolgreichem Verorten SHALL die Karte den neuen Marker hervorheben und eine Rückmeldung
„<Kennung> verortet“ zeigen. Kam der Auftrag von einer Datensatzseite, MUST die Rückmeldung die
Primäraktion „Zurück zu <Kennung>“ und den Nebenweg „Auf der Karte bleiben“ tragen. Das Ziel des
Rückwegs MUST sich allein aus Typ und Kennung ergeben; ein Pfad oder eine Adresse MUST NOT aus dem
Auftrag übernommen werden. Unter `lg` MUST jede Handlung genau einen Knopf haben.

#### Scenario: Zurück zur Person
- **WHEN** R-005 aus dem Detail verortet wurde und jemand „Zurück zu R-005“ wählt
- **THEN** steht die Detailseite von R-005 offen und zeigt die neue Koordinate

#### Scenario: Auf der Karte bleiben
- **WHEN** jemand nach dem Verorten „Auf der Karte bleiben“ wählt
- **THEN** schließt die Rückmeldung, die Karte bleibt offen, und die Ebene bleibt gezeichnet

#### Scenario: Neu verorten
- **WHEN** eine Person mit vorhandener Koordinate erneut verortet wird
- **THEN** erscheinen Hervorhebung, Rückmeldung und Rückweg wie beim ersten Verorten

#### Scenario: Auftrag ohne Herkunft
- **WHEN** die Karte mit `?platzieren=person:<id>` ohne `zurueck` geöffnet und verortet wird
- **THEN** zeigt die Rückmeldung „<Kennung> verortet“ ohne „Zurück zu …“

#### Scenario: Schaden und Betreuungsstelle
- **WHEN** ein Schaden aus seinem Detail oder eine Betreuungsstelle aus der Betreuungsseite
  verortet wird
- **THEN** führt „Zurück zu …“ auf die Seite, von der der Auftrag kam
