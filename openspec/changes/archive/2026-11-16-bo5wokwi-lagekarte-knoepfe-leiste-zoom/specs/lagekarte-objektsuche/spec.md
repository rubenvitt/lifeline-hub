# Spec Delta

## MODIFIED Requirements

### Requirement: Treffer springt an und wählt aus
Ein Tipp auf eine verortete Zeile SHALL die Karte auf das Objekt fliegen lassen und das Objekt
auswählen; die Leiste zeigt dann die Ansicht „Auswahl“. Der Anflug MUST nur heranzoomen: Steht die
Karte weiter draußen als der Anflugmaßstab, zoomt sie auf ihn, sonst behält sie ihren Zoom. Eine nicht
verortete Zeile SHALL rechts „Platzieren“ (Abschnitt: „Fläche zeichnen“, Einsatzort: „Platzieren“,
verortet „Verschieben“) tragen, ohne Schreibrecht das Wort „nicht verortet“, und MUST selbst kein
Ziel sein. Ausgenommen ist der Abschnitt ohne Fläche: seine Zeile MUST ihn auswählen, ohne
Anflug; sein Inspector zeigt keine Koordinate und bietet „Abschnitt fokussieren“. Jede Zeile und
jeder Zeilenknopf MUST ein Bedienziel mit dem Trefflächenboden der aktiven Dichtestufe sein. Das
laufende Platzierungsziel MUST bei jedem Suchbegriff und Filter in der Liste stehen bleiben, seine
Gruppe offen, und nur „wird platziert“ zeigen; „Abbrechen“ steht im Modus-Band.

#### Scenario: Klick auf einen Treffer
- **WHEN** die Person auf den Treffer „Florian Nord 1“ tippt
- **THEN** fliegt die Karte zur Einheit, und die Leiste zeigt ihren Inspector in der Ansicht „Auswahl“

#### Scenario: Treffer bei nahem Ausschnitt zoomt nicht heraus
- **WHEN** die Karte näher als der Anflugmaßstab steht und die Person auf einen Treffer tippt
- **THEN** fliegt die Karte zum Objekt und behält ihren Zoom

#### Scenario: Treffer bei weitem Ausschnitt zoomt heran
- **WHEN** die Karte das ganze Einsatzgebiet zeigt und die Person auf einen Treffer tippt
- **THEN** fliegt die Karte zum Objekt und zoomt bis zum Anflugmaßstab heran

#### Scenario: Laufendes Ziel bleibt stehen
- **WHEN** ein Fahrzeug platziert wird und die Person einen Begriff tippt, der es nicht trifft
- **THEN** steht seine Zeile mit „wird platziert“ weiter in der Liste

#### Scenario: Abschnitt ohne Fläche fokussieren
- **WHEN** der Abschnitt „EA Süd“ keine Fläche hat und die Person seine Zeile tippt
- **THEN** zeigt die Leiste seinen Inspector ohne Koordinate mit „Abschnitt fokussieren“, und die Zeile trägt daneben „Fläche zeichnen“, keinen Fokus-Knopf
