# Spec Delta

## Purpose

Legt fest, welches bestehende Modul welche Versorgungsaufgabe des Sachgebiets S4 nach FwDV 100
Anlage 2 (S. 58) trägt: Verbrauchsgüter und Betriebsstoffe, Verpflegung, Materialerhaltung,
Unterkünfte. Außerdem gilt für Beschafftes eine einzige Mengenwahrheit, und was fehlt, steht als
benannte Lücke da und wird nicht erfunden.

## ADDED Requirements

### Requirement: Jeder Versorgungsbereich hat genau einen Träger

Jeder Versorgungsbereich von S4 SHALL genau einem bestehenden Modul zugeordnet sein:

- Verpflegung → Modul Verpflegung
- Einsatzmittel, Verbrauchsgüter und Betriebsstoffe anfordern → Modul Nachforderungen
- Materialerhaltung → Modul Material, über den Status einer Materialzeile

Die Zeile S4 der Stabseite SHALL genau diese Träger als Werkzeuge führen, und zwar
Nachforderungen, Verpflegung und Material. Das System MUST NOT ein eigenes Modul, eine eigene
Seite oder eine eigene Tabelle „Versorgung“ führen, die einen dieser Bereiche ein zweites Mal
trägt.

#### Scenario: S4 führt die Träger
- **WHEN** eine Person die Stabseite öffnet und die Module Nachforderungen, Verpflegung und
  Material zugänglich sind
- **THEN** führt die Zeile S4 genau die Werkzeuge Nachforderungen, Verpflegung und Material

#### Scenario: Es gibt kein Modul Versorgung
- **WHEN** eine Person Rail, Modulpanel oder Modulfreigabe eines Einsatzes durchsieht
- **THEN** findet sie kein Modul „Versorgung“ neben Nachforderungen, Verpflegung und Material

#### Scenario: Materialerhaltung am Material
- **WHEN** ein Gerät im Einsatz ausfällt
- **THEN** wird das an seiner Materialzeile mit dem Status `defekt` festgehalten und nicht in
  einer eigenen Versorgungsliste

### Requirement: Eine Mengenwahrheit für Beschafftes

Ein Versorgungsgut, das von außen beschafft wird, SHALL als Nachforderung geführt werden. Kein
anderes Modul MUST dafür einen eigenen Bestell- oder Lieferstatus führen. Ein Modul, das
Verbrauch oder Ausgabe erfasst, SHALL auf die Nachforderung nur verweisen und MUST deren Status
dabei nicht ändern.

#### Scenario: Nachfordern aus der Verpflegung
- **WHEN** eine Person bei einem Verpflegungszeitfenster mit Fehlmenge „Nachfordern“ wählt
- **THEN** entsteht die Beschaffung als Nachforderung über die Nachforderungs-Erfassung und
  nicht als Bestellung im Modul Verpflegung

#### Scenario: Ausgabe ändert die Nachforderung nicht
- **WHEN** eine Verpflegungsausgabe auf eine Nachforderung verweist
- **THEN** bleibt der Status der Nachforderung unverändert

### Requirement: Betriebsstoffe als Nachforderung mit freier Art

Ein Bedarf an Betriebsstoffen oder Verbrauchsgütern (z. B. Kraftstoff, Atemschutz, Löschmittel,
Trinkwasser) SHALL als Nachforderung mit einer frei beschrifteten Art erfasst werden. Das System
MUST für Betriebsstoffe keine feste Artenliste, keine eigene Bedarfsrechnung und keinen eigenen
Einstieg führen, solange kein Feldbefund aus einer Langzeitlage vorliegt.

#### Scenario: Kraftstoff nachfordern
- **WHEN** eine Person mit Schreibrecht eine Nachforderung mit der Art „Kraftstoff Diesel“, der
  Anzahl 2 und der Bezeichnung „2 × 200 l für Pumpen EA Süd“ absetzt
- **THEN** entsteht eine Nachforderung im Status `angefordert` mit genau dieser Art
- **AND** steht sie mit einem ETB-Eintrag wie jede andere Nachforderung

#### Scenario: Keine Pflichtart für Betriebsstoffe
- **WHEN** eine Nachforderung mit einer Art abgesetzt wird, die in keiner Liste steht
- **THEN** nimmt das System sie an, solange die Art nicht leer ist

### Requirement: Unterkunft für Einsatzkräfte ist eine benannte Lücke

Die Unterkunft für Einsatzkräfte SHALL als Lücke gelten, für die es keinen Träger gibt. Sie MUST
NOT als Betreuungsstelle geführt werden. Die Belegung einer Betreuungsstelle zählt Betroffene.
Sie speist die Kopfzahl „in Betreuung“ und damit den Verpflegungsbedarf der Betreuten, während
die Einsatzkräfte schon über die Personalstärke gezählt sind. Die Arten einer Betreuungsstelle
MUST auf `anlaufstelle`, `betreuungsstelle`, `betreuungsplatz` und `notunterkunft` beschränkt
bleiben.

#### Scenario: Keine Stellenart für Kräfte
- **WHEN** eine Betreuungsstelle mit einer Art außerhalb der vier festgelegten angelegt werden
  soll
- **THEN** antwortet das System mit 400 und legt nichts an

#### Scenario: Notunterkunft gehört den Betroffenen
- **WHEN** eine Person den Verbleib „Notunterkunft“ einer betroffenen Person erfasst
- **THEN** verweist er auf eine Betreuungsstelle des Einsatzes, und die Einsatzkräfte stehen in
  dieser Zählung nicht

### Requirement: Wiedervorlage nur mit Feldbefund

Eine eigene Fläche, eine feste Art, eine Bedarfsrechnung für Betriebsstoffe oder ein Träger für
die Unterkunft der Einsatzkräfte SHALL erst mit einem Feldbefund aus einer Langzeitlage neu
entschieden werden. Ein Feldbefund liegt vor, wenn in einem realen Einsatz oder einer Übung
mehr als ein Einsatztag belegt, dass die Nachforderung mit freier Art oder das Fehlen einer
Kräfte-Unterkunft die Führung behindert hat. Die neue Entscheidung MUST die eine Mengenwahrheit
aus dieser Spec erhalten oder ausdrücklich ablösen.

#### Scenario: Ohne Feldbefund keine neue Fläche
- **WHEN** ein Ticket eine Versorgungsfläche, eine Tabelle für Versorgungsposten oder eine
  Betriebsstoff-Deckung ohne Feldbefund verlangt
- **THEN** wird es gegen diese Spec zurückgestellt und nicht umgesetzt
