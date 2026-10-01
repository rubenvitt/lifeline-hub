# Spec Delta

## MODIFIED Requirements

### Requirement: Ein Leerzustand und keine falsche Leere
Findet die Suche nichts, SHALL genau ein Leerzustand für die ganze Fläche erscheinen, mit dem
Suchbegriff, wenn einer eingegeben ist. Ist eine Quelle der Suche ausgefallen (eine Lagebild-Quelle, bei eingeschalteter Ebene
„Betroffene“ auch die Personenliste), MUST die Fläche
statt „Nichts verortet“ bzw. „kein Kartenobjekt“ sagen, dass die Liste unvollständig ist, und
die Trefferzahlen MUST einen Gedankenstrich statt einer Zahl tragen.
Steht über den Objektgruppen ein Koordinatentreffer oder die Gruppe „Adresse“ (Ortssuche,
Spec `lagekarte-ortssuche`), MUST statt des Leerzustands der Fläche nur ein knapper Hinweis
„Kein Kartenobjekt zu „<Begriff>““ unter diesen Gruppen stehen.

#### Scenario: Suche ohne Treffer
- **WHEN** die Person „xyz“ sucht und kein Objekt passt
- **THEN** steht genau ein Leerzustand „Kein Kartenobjekt zu „xyz““ da

#### Scenario: Quelle ausgefallen
- **WHEN** eine Lagebild-Quelle nicht geladen werden konnte
- **THEN** behauptet die Fläche keine Leere, und Gruppenköpfe zeigen „—“ statt einer Zahl

#### Scenario: Koordinate ohne Objekttreffer
- **WHEN** die Person eine Koordinate tippt und kein Kartenobjekt passt
- **THEN** steht die Gruppe „Koordinate“ da und darunter nur der Hinweis „Kein Kartenobjekt zu …“, kein Leerzustand der ganzen Fläche
