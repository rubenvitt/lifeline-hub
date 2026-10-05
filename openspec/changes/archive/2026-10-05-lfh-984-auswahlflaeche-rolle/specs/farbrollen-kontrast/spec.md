## ADDED Requirements

### Requirement: Text und Rand auf der Auswahlfläche halten den Boden

Die Fläche, die eine gewählte Option, einen gewählten Menüeintrag oder einen gewählten Knoten
hinterlegt, SHALL in beiden Modi jede Textstufe und die blaue Bedienschrift mit dem Textboden
tragen (Tag ≥ 7 : 1, Nacht ≥ 5 : 1) und den Rand eines Steuerelements mit mindestens 3 : 1. Das
gilt in Ruhe und unter dem Zeiger. Kein Kontrastnachweis MUST diese Paare unter einer Ausnahme
mit niedrigerer Schranke führen.

#### Scenario: Gewählter Eintrag der Statuswahl am Tag
- **WHEN** im Tagmodus die Statuswahl geöffnet ist und der aktuelle Status als gewählter Eintrag
  markiert ist
- **THEN** misst die Schrift des gewählten Eintrags gegen seine Fläche mindestens 7 : 1
- **AND** unter dem Zeiger ebenfalls mindestens 7 : 1

#### Scenario: Gewählter Eintrag der Statuswahl in der Nacht
- **WHEN** im Nachtmodus dieselbe Statuswahl geöffnet ist
- **THEN** misst die Schrift des gewählten Eintrags gegen seine Fläche in Ruhe und unter dem
  Zeiger mindestens 5 : 1

#### Scenario: Gewählte Option einer Auswahlliste
- **WHEN** eine Auswahlliste geöffnet ist und eine Option gewählt ist
- **THEN** misst die Schrift der gewählten Option gegen ihre Fläche im Tag mindestens 7 : 1 und
  in der Nacht mindestens 5 : 1

#### Scenario: Beschreibung und Rand auf der Auswahlfläche
- **WHEN** auf der Auswahlfläche Beschreibungstext, Tertiärtext oder der Rand eines
  Steuerelements steht
- **THEN** hält der Text den Textboden des Modus und der Rand mindestens 3 : 1

### Requirement: Auswahlfläche kommt aus einer Rolle

Die Auswahlfläche SHALL in beiden Modi app-weit aus einer Farbrolle kommen, für die Bausteine der
Oberflächenbibliothek wie für eigene Stellen, die eine Auswahl hinterlegen. Keine Stelle MUST
dafür eine eigene Farbe setzen oder die Ableitung der Bibliothek aus der Bedienfarbe übernehmen.

#### Scenario: Statuswahl und Auswahlliste tragen dieselbe Fläche
- **WHEN** im Tag- oder im Nachtmodus der gewählte Eintrag der Statuswahl und die gewählte Option
  einer Auswahlliste angezeigt werden
- **THEN** tragen beide dieselbe Farbe, die Auswahlfläche des Modus

### Requirement: Die Auswahl hebt sich von Ruhe und Zeiger ab

Die Auswahlfläche SHALL sich in beiden Modi von der Fläche eines Eintrags in Ruhe und unter dem
Zeiger sichtbar unterscheiden: Farbabstand ΔE (CIE76) mindestens 7 gegen jede der beiden, auf den
Gründen, auf denen Auswahllisten und Menüs stehen.

#### Scenario: Gewählter, ruhender und überfahrener Eintrag nebeneinander
- **WHEN** in einer geöffneten Auswahlliste eine Option gewählt ist und der Zeiger über einer
  anderen Option steht
- **THEN** liegt die Fläche der gewählten Option im Tag- und im Nachtmodus mindestens ΔE 7 von der
  ruhenden und von der überfahrenen Option entfernt
