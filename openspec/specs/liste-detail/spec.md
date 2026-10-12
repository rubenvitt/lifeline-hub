# liste-detail Specification

## Purpose
Legt das Muster „Liste + Detailpaneel“ fest: eine Liste von Objekten, deren gewähltes Objekt neben
oder unter seiner Karte im Detail gelesen und bedient wird, ohne die Seite zu verlassen. Es gilt
für jede Fläche, die den Baustein nutzt, zuerst für die zwei Reiter von „Aufträge/Befehle“.

## Requirements

### Requirement: Anordnung je Breite

Ab der Breitenstufe `lg` SHALL die Liste links und das Detail des gewählten Objekts rechts daneben
stehen. Das Detail MUST dabei beim Scrollen der Liste im Blick bleiben. Unter `lg` SHALL das Detail
unmittelbar unter der Karte des gewählten Objekts aufklappen, und die übrigen Karten folgen darunter.
Keine Breite MUST ein Overlay, einen Drawer oder einen Seitenwechsel für das Detail nutzen.

#### Scenario: Fükw-Schirm
- **WHEN** die Fläche bei 1366 × 768 px steht und ein Objekt gewählt ist
- **THEN** steht das Detail rechts neben der Liste, und die Seite scrollt nicht waagerecht

#### Scenario: Langes Scrollen ab lg
- **WHEN** ab `lg` die Liste so weit gescrollt wird, dass die gewählte Karte oben verschwindet
- **THEN** steht das Detail weiter vollständig im Sichtbereich, solange es niedriger als der Sichtbereich ist

#### Scenario: Handschirm
- **WHEN** die Fläche bei 390 px Breite steht und eine Karte gewählt wird
- **THEN** klappt das Detail direkt unter dieser Karte auf, und die nächste Karte steht unter dem Detail

### Requirement: Höchstens ein Objekt gewählt

Die Fläche SHALL höchstens ein Objekt zugleich gewählt halten. Ab `lg` MUST ohne Wahl das erste
Objekt der gezeigten Folge gewählt sein, sobald die Liste Objekte hat. Unter `lg` MUST ohne Wahl
keine Karte aufgeklappt sein. Eine erneute Wahl der aufgeklappten Karte unter `lg` SHALL sie
zuklappen.

#### Scenario: Erstes Objekt ab lg
- **WHEN** die Fläche ab `lg` mit drei Objekten öffnet und weder Deeplink noch frühere Wahl besteht
- **THEN** zeigt das Detail das erste Objekt der Folge

#### Scenario: Zuklappen auf dem Handschirm
- **WHEN** auf dem Handschirm die aufgeklappte Karte erneut gewählt wird
- **THEN** ist keine Karte mehr aufgeklappt

#### Scenario: Bedienung im aufgeklappten Detail
- **WHEN** auf dem Handschirm in das aufgeklappte Detail oder in eine Rückfrage daraus getippt wird
- **THEN** bleibt das Detail aufgeklappt

#### Scenario: Wechsel der Wahl
- **WHEN** ein anderes Objekt gewählt wird
- **THEN** zeigt das Detail nur noch dieses Objekt, und die vorige Karte gilt nicht mehr als gewählt

### Requirement: Wahl per Zeiger und Tastatur

Jede Karte SHALL genau ein Auswahlziel tragen, das per Zeiger, Tipp und Tastatur (Enter, Leertaste)
wählt und dessen zugänglicher Name die Kennung des Objekts nennt. Die gewählte Karte MUST ihren
Zustand ohne Farbe zugänglich machen (ab `lg` als aktuelles Element, unter `lg` als aufgeklappt).
Die Karte MUST NOT weitere Bedienziele tragen außer Kennungs-Links. Ab `lg` MUST ein Sprung per
Tastatur von der gewählten Karte direkt ins Detail führen, ohne die übrigen Karten zu durchlaufen.

#### Scenario: Tastatur
- **WHEN** der Fokus auf dem Auswahlziel einer Karte steht und Enter gedrückt wird
- **THEN** ist das Objekt gewählt, und das Detail zeigt es

#### Scenario: Zustand ohne Farbe
- **WHEN** ab `lg` ein Objekt gewählt ist
- **THEN** meldet sein Auswahlziel den Zustand „aktuell“, und genau ein Auswahlziel der Liste tut das

#### Scenario: Ins Detail springen
- **WHEN** ab `lg` der Fokus auf dem Auswahlziel der gewählten Karte steht und Tab gedrückt wird
- **THEN** steht ein sichtbarer Sprung „Zum Detail“ im Fokus, und er setzt den Fokus ins Detail

#### Scenario: Keine Handlung in der Karte
- **WHEN** eine Karte mit Schreibrecht gerendert ist
- **THEN** enthält sie keinen Knopf, der Daten ändert

### Requirement: Gewählte Karte trägt die Auswahlfläche

Die gewählte Karte SHALL die Auswahlfläche der Farbrollen tragen. Eine Karte mit eigenem
Gefahrzustand MUST ihre Gefahrfläche und ihre linke Statuskante behalten, auch wenn sie gewählt ist.

#### Scenario: Gewählt
- **WHEN** im Tag- oder Nachtmodus eine Karte ohne Gefahrzustand gewählt ist
- **THEN** steht sie auf der Auswahlfläche des Modus

#### Scenario: Gewählt und überfällig
- **WHEN** eine alarmierte Karte gewählt ist
- **THEN** steht sie weiter auf der Alarmfläche mit Alarmkante links

### Requirement: Zustände der Fläche

Solange die erste Lieferung lädt, SHALL die Fläche ein Skelett zeigen und nichts über die Menge
behaupten. Scheitert sie ohne gezeigten Bestand, MUST ein Fehlerzustand mit Ursache und
„Erneut abrufen“ stehen. Ist die Menge leer, MUST ein Leerzustand stehen, mit Schreibrecht samt
der Erfassen-Aktion der Fläche. Scheitert ein Abgleich bei gezeigtem Bestand, MUST der Bestand
stehen bleiben und ein Hinweis den veralteten Stand nennen.

#### Scenario: Erste Lieferung
- **WHEN** die Fläche öffnet und die Daten noch laden
- **THEN** steht ein Skelett, keine Zahl und kein Leerzustand

#### Scenario: Leer mit Schreibrecht
- **WHEN** die Menge leer ist und die Person schreiben darf
- **THEN** steht der Leerzustand mit genau der Erfassen-Aktion, die auch der Bereichskopf trägt

#### Scenario: Abgleich scheitert
- **WHEN** Objekte gezeigt sind und ein späterer Abruf scheitert
- **THEN** bleiben die Objekte stehen, und ein Hinweis meldet den veralteten Stand mit „Erneut abrufen“

### Requirement: Deeplink öffnet das Detail

Ein Deeplink auf ein Objekt der Fläche SHALL dieses Objekt wählen, das Detail öffnen, die Karte in
den Sichtbereich holen und sie markieren. Filter, die das Objekt verbergen würden, MUST dabei
zurückgesetzt werden. Der Deeplink-Parameter MUST nach dem Anwenden aus der Adresse verschwinden.
Eine Wahl von Hand MUST die Markierung entfernen.

#### Scenario: Deeplink bei aktivem Filter
- **WHEN** ein Filter aktiv ist, der das verlinkte Objekt ausblendet, und der Deeplink geöffnet wird
- **THEN** ist der Filter zurückgesetzt, das Objekt gewählt, seine Karte markiert und im Sichtbereich

#### Scenario: Neu laden nach dem Deeplink
- **WHEN** nach dem Anwenden des Deeplinks die Seite neu geladen wird
- **THEN** enthält die Adresse den Parameter nicht mehr, und die Markierung fehlt

#### Scenario: Wahl von Hand
- **WHEN** nach einem Deeplink eine andere Karte gewählt wird
- **THEN** trägt keine Karte mehr die Markierung

### Requirement: Zufluss hält die Folge

Solange der Fokus in der Liste steht oder ein Maus- bzw. Stiftzeiger über ihr bewegt wurde, SHALL
die Liste Menge und Folge ihrer Karten halten. Inhalte gezeigter Karten MUST weiter fließen,
entfallene Karten MUST sofort verschwinden. Ein Sammelbanner MUST Neues und Umsortiertes nennen und
es auf Wunsch einfügen. Touch MUST die Liste nicht anhalten.

#### Scenario: Neuer Eintrag unter dem Zeiger
- **WHEN** der Mauszeiger über der Liste bewegt wurde und ein neues Objekt eintrifft
- **THEN** bleibt die Folge stehen, und der Sammelbanner nennt einen neuen Eintrag

#### Scenario: Banner einfügen
- **WHEN** der Sammelbanner bedient wird
- **THEN** stehen alle Objekte in frischer Folge, und der Banner verschwindet

#### Scenario: Ohne Zeiger und Fokus
- **WHEN** weder Fokus noch Zeiger in der Liste sind und ein neues Objekt eintrifft
- **THEN** steht es sofort an seinem Platz, ohne Banner

### Requirement: Gewähltes Objekt entfällt

Entfällt das gewählte Objekt aus der gezeigten Menge (etwa weil es abgeschlossen wird und die
Ansicht nur Offenes zeigt), SHALL das Detail es weiter zeigen, bis eine andere Wahl fällt oder die
Ansicht wechselt. Das Detail MUST dann sagen, dass das Objekt nicht mehr in der Liste steht, und
den frischesten bekannten Stand zeigen (etwa die Antwort der Handlung, die es hinausgeschoben hat).
Unter `lg` MUST es an der Stelle der entfallenen Karte stehen bleiben.

#### Scenario: Auftrag wird abgenommen
- **WHEN** in der Ansicht „Offen“ der gewählte Auftrag im Detail abgenommen wird
- **THEN** zeigt das Detail ihn mit Phase „abgenommen“ und dem Hinweis, dass er nicht mehr in der Liste steht

#### Scenario: Entfällt auf dem Handschirm
- **WHEN** unter `lg` die mittlere von drei Karten aufgeklappt ist und ihr Objekt entfällt
- **THEN** steht das Detail weiter zwischen der ersten und der dritten Karte

#### Scenario: Andere Wahl
- **WHEN** danach eine Karte der Liste gewählt wird
- **THEN** zeigt das Detail diese Karte, und der Hinweis ist weg
