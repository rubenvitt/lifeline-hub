# Spec Delta

## MODIFIED Requirements

### Requirement: Bildraster mit Textsuche
Der Zeichen-Picker SHALL Grundzeichen und, wo das Grundzeichen ein Symbol trägt, Symbole als
Raster aus Kacheln anbieten. Jede Kachel MUST das gezeichnete Zeichen und seinen Namen tragen.
Jedes Raster MUST ein eigenes Suchfeld haben, das auf Name und Kennung filtert und „Kein
Treffer“ meldet, wenn nichts passt. Das Symbolraster MUST eine Kachel „Kein Symbol“ tragen,
die jeder Filter stehen lässt. Die gewählte Kachel MUST maschinenlesbar markiert sein, nicht
nur farblich. Ein Raster MUST mit den Pfeiltasten bedienbar sein und EIN Tabstopp sein.
Organisation, Fachaufgabe, Einheit, Farbe und Bezeichnung MUST eingeklappt unter „Details“
stehen. Ein Grundzeichenwechsel MUST Overlays verwerfen, die das neue Grundzeichen nicht
darstellt.

Raster und Auswahllisten MUST nur Werte anbieten, die die Bibliothek `@einsatzzeichen` mit dem
gerade gewählten Zeichen zeichnet. Das Raster der Grundzeichen MUST eine Kachel „Kein
Grundzeichen“ tragen. Ist sie gewählt, bietet das Symbolraster freistehende Zustände und
Piktogramme an. Die Farbe MUST aus der festen Palette der Bibliothek gewählt werden und steht
nur dort zur Wahl, wo das Zeichen eine Füllung trägt.

#### Scenario: Zeichen über den Alltagsbegriff finden
- **WHEN** die Person im Grundzeichen-Suchfeld einen Teil des Namens tippt
- **THEN** stehen nur die passenden Kacheln da, jede mit Bild und Namen

#### Scenario: Pfeiltasten im Raster
- **WHEN** eine Kachel den Fokus hat und die Person ↓ oder → drückt
- **THEN** wandern Fokus und Auswahl zur nächsten Kachel

#### Scenario: Nur Zeichenbares wird angeboten
- **WHEN** die Person das Grundzeichen „Kraftfahrzeug“ gewählt hat und „Details“ öffnet
- **THEN** bietet die Auswahl „Einheit“ keine Stärke an, die die Bibliothek am Fahrzeug ablehnt

#### Scenario: Piktogramm ohne Grundzeichen
- **WHEN** die Person „Kein Grundzeichen“ wählt und im Symbolraster „Drehleiter“ sucht
- **THEN** steht die Kachel „Drehleiter“ da, und Platzieren setzt das Piktogramm ohne Grundzeichen

#### Scenario: Farbe aus der Palette
- **WHEN** die Person das Grundzeichen „Gefahr“ gewählt hat und unter „Details“ die Farbe öffnet
- **THEN** stehen nur die Farben der Palette zur Wahl, keine freie Farbeingabe

### Requirement: Zuletzt verwendete Zeichen
Der Picker SHALL eine Leiste „Zuletzt verwendet“ mit höchstens sechs Zeichen zeigen, das
zuletzt platzierte vorn. Ein Zeichen MUST erst nach erfolgreichem Platzieren eingetragen
werden, nicht beim Wählen im Picker. Ein erneut platziertes Zeichen MUST nach vorn wandern statt
doppelt zu erscheinen. Bezeichnung, Ansicht und Koordinate gehören nicht zum Zeichen; die Farbe
gehört dazu. Ein Griff in die Leiste MUST das Zeichen übernehmen und die Bezeichnung des
Entwurfs stehen lassen. Die Leiste ist eine persönliche Vorliebe auf dem Gerät; fehlender oder
kaputter Speicher MUST zu einer leeren Leiste führen, nicht zu einem Fehler.

Einträge aus der Zeit vor der Umstellung MUST übernommen werden: Sie erscheinen in derselben
Reihenfolge als Zeichen nach der neuen Darstellung. Ein Alteintrag, der sich nicht übersetzen
lässt, MUST entfallen, ohne die übrigen zu verlieren.

#### Scenario: Deckel und Reihenfolge
- **WHEN** die Person nacheinander sieben verschiedene Zeichen platziert
- **THEN** zeigt die Leiste die letzten sechs, das siebte vorn, das erste nicht mehr

#### Scenario: Wiederverwendung
- **WHEN** die Person ein Zeichen platziert, das schon weiter hinten in der Leiste steht
- **THEN** steht es danach einmal und vorn

#### Scenario: Leiste aus der Zeit vor der Umstellung
- **WHEN** auf dem Gerät eine Leiste mit drei Alteinträgen liegt und die Person den Picker öffnet
- **THEN** zeigt die Leiste diese drei Zeichen in derselben Reihenfolge
