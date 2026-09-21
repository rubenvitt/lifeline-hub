# Spec Delta

## Purpose

Externe Lagedaten-Ebenen der Lagekarte: amtliche und offene Fremdquellen, die das
Backend abruft, vereinheitlicht und der Karte als zuschaltbare Ebenen bereitstellt —
hier zunächst das Strahlungs-/ODL-Messnetz des Bundesamts für Strahlenschutz.

## ADDED Requirements

### Requirement: ODL-Sonden sind als Fachebene abrufbar
Das System SHALL unter `GET /api/karte/fachebenen/odl` die ortsfesten Sonden des
ODL-Messnetzes des Bundesamts für Strahlenschutz als GeoJSON-`FeatureCollection` von
Punkten im einheitlichen Fachebenen-Umschlag (`quelle`, `status`, `attribution`, `stand`,
`features`) liefern. Jedes Feature MUST mindestens Kennung, Standortname, Messwert in
µSv/h (oder dessen Fehlen), Messende, Betriebsstatus der Sonde und die Bewertungsstufe
tragen. Die Route MUST keinen `bbox`-Parameter verlangen.

#### Scenario: Sonden mit Messwert werden ausgeliefert
- **WHEN** ein angemeldeter Benutzer `GET /api/karte/fachebenen/odl` aufruft und die Quelle erreichbar ist
- **THEN** antwortet das System mit HTTP 200, `quelle: "odl"`, `status: "ok"` und je Sonde einem Punkt-Feature mit Messwert, Einheit µSv/h, Messende und Bewertungsstufe

#### Scenario: Sonde ohne Messwert bleibt enthalten
- **WHEN** die Quelle eine Sonde als defekt oder im Testbetrieb und ohne Messwert meldet
- **THEN** ist die Sonde als Feature enthalten, ihr Messwert fehlt, ihr Betriebsstatus ist benannt und ihre Stufe ist `keine_messung`

### Requirement: Bewertungsstufe nach festen Bändern
Das System SHALL jeder Sonde genau eine Stufe aus diesen Bändern zuweisen:
`keine_messung` (kein Messwert), `normal` (Messwert ≤ 0,2 µSv/h), `erhoeht`
(0,2 < Messwert ≤ 0,6 µSv/h), `stark_erhoeht` (Messwert > 0,6 µSv/h). Die Stufenwörter
sind Teil der Schnittstelle und MUST unverändert bleiben.

#### Scenario: Grenzwerte werden der unteren Stufe zugeschlagen
- **WHEN** eine Sonde genau 0,2 µSv/h bzw. genau 0,6 µSv/h meldet
- **THEN** trägt sie die Stufe `normal` bzw. `erhoeht`

#### Scenario: Werte oberhalb der Bänder
- **WHEN** eine Sonde 0,21 µSv/h bzw. 0,61 µSv/h meldet
- **THEN** trägt sie die Stufe `erhoeht` bzw. `stark_erhoeht`

### Requirement: Die Einteilung gibt sich als Projekt-Einteilung zu erkennen
Das System MUST überall dort, wo es eine Sonde als „erhöht" bezeichnet, erkennbar machen,
dass die Bänder eine Einteilung des Lifeline Hub auf Grundlage des vom BfS genannten
natürlichen Bereichs (0,05–0,2 µSv/h) sind und kein amtlicher Schwellenwert des BfS. Die
Quellendokumentation MUST dasselbe festhalten.

#### Scenario: Hinweis im Inspector
- **WHEN** ein Benutzer auf der Lagekarte eine ODL-Sonde anwählt
- **THEN** zeigt der Inspector Messwert, Messende, Stufe als Wort und einen sichtbaren Hinweis, dass die Einteilung keine BfS-Schwelle ist

### Requirement: Stufe ist nicht allein über die Farbe erkennbar
Die Lagekarte SHALL die Stufe einer Sonde über die Farbrolle des Statusfarb-Vertrags
(`keine_messung` neutral, `normal` normal, `erhoeht` achtung, `stark_erhoeht` alarm)
UND über einen je Stufe verschiedenen Punktdurchmesser darstellen, der mit der Stufe
wächst.

#### Scenario: Erhöhte Sonde sticht heraus
- **WHEN** die Ebene sichtbar ist und eine Sonde die Stufe `stark_erhoeht` trägt
- **THEN** ist ihr Punkt in der Alarm-Rollenfarbe und größer als der Punkt jeder Sonde mit niedrigerer Stufe

### Requirement: Ausfall der Quelle bricht die Karte nicht
Ist die BfS-Quelle nicht erreichbar oder liefert sie Unbrauchbares, SHALL das System mit
HTTP 200 und `status: "offline"` bei leerer Collection antworten, sofern kein
zwischengespeicherter Stand vorliegt; liegt einer vor, SHALL es diesen ausliefern. Das
System MUST dabei keinen 5xx-Fehler liefern.

#### Scenario: Quelle weg, kein Cache
- **WHEN** der BfS-Dienst nicht antwortet und noch kein Stand zwischengespeichert ist
- **THEN** antwortet die Route mit HTTP 200, `status: "offline"` und leerer Collection, und das Panel zeigt die Ebene als offline

#### Scenario: Quelle weg, alter Stand vorhanden
- **WHEN** der BfS-Dienst nicht antwortet, aber ein früher gespeicherter Stand vorliegt
- **THEN** liefert die Route diesen Stand aus

### Requirement: Quellennennung
Solange die ODL-Ebene sichtbar und nicht offline ist, SHALL die Kartenattribution
„Bundesamt für Strahlenschutz (BfS)" samt Lizenzkennung der Datenlizenz Deutschland –
Namensnennung 2.0 nennen.

#### Scenario: Attribution bei sichtbarer Ebene
- **WHEN** ein Benutzer die ODL-Ebene zuschaltet und Daten geladen sind
- **THEN** erscheint die BfS-Quellennennung in der Kartenattribution

### Requirement: Sichtbarkeit der Ebene wird gespeichert
Das Panel SHALL die ODL-Ebene als zuschaltbare Fachebene mit sichtbarem Geltungshinweis
anbieten (nur ortsfeste BfS-Sonden, Stundenwerte). Ihre Sichtbarkeit SHALL wie bei den
übrigen Fachebenen gespeichert werden; ein vor dieser Änderung gespeicherter Stand ohne
Angabe zur ODL-Ebene MUST als „aus" gelesen werden.

#### Scenario: Alter gespeicherter Stand
- **WHEN** eine Kartenansicht geladen wird, deren gespeicherte Fachebenen-Sichtbarkeit den Schlüssel `odl` nicht kennt
- **THEN** ist die ODL-Ebene ausgeschaltet und die übrigen Ebenen behalten ihren gespeicherten Zustand

#### Scenario: Zuschalten überlebt Neuladen
- **WHEN** ein Benutzer die ODL-Ebene zuschaltet und die Ansicht speichert
- **THEN** ist die Ebene nach dem Neuladen wieder zugeschaltet
