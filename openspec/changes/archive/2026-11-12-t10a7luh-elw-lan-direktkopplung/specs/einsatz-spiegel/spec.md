# Spec Delta

## ADDED Requirements

### Requirement: Verweise auf Stammdaten tragen ihre Ursprungskennung

Eine gelieferte Zeile SHALL zu jedem Verweis auf ein Konto oder eine Stammdatenzeile deren
Ursprungskennung nennen (Spec `stammdaten-verteilung`). Die spiegelnde Seite MUST einen Verweis,
den sie nicht über die Stammdaten dieser Kopplung abbilden kann, auf die eigene Zeile der Org mit
derselben Ursprungskennung abbilden. Gibt es keine, gelten die bisherigen Regeln: leerer Verweis
mit Schnappschuss des Namens, für Konten ein Stellvertreter.

#### Scenario: Fahrzeug vom Hub im Spiegel vor Ort
- **WHEN** ELW 1 einen Einsatz führt, in dem das Fahrzeug „Rotkreuz Nord 1/83-1“ vom Hub einer Einheit zugeordnet ist, und ELW 2, ebenfalls vom Hub beliefert, ihn über die Direktkopplung spiegelt
- **THEN** zeigt der Spiegel an ELW 2 die Einheit mit dem eigenen Fahrzeug „Rotkreuz Nord 1/83-1“, nicht nur mit dem Namen aus dem Schnappschuss

#### Scenario: Gleiches Konto an beiden ELW
- **WHEN** das Konto „Anna Berg“ vom Hub an ELW 1 einen ETB-Eintrag schreibt und ELW 2 den Einsatz über die Direktkopplung spiegelt
- **THEN** zeigt der Spiegel an ELW 2 den Eintrag mit dem eigenen Konto „Anna Berg“, ohne Stellvertreter

#### Scenario: Spontanhelfer nur an ELW 1
- **WHEN** ein an ELW 1 „nur hier“ angelegtes Personal einer Einheit zugeordnet ist
- **THEN** zeigt der Spiegel an ELW 2 es mit dem Namen aus dem Schnappschuss, ohne Verweis auf eigenes Personal

### Requirement: Rollen am Spiegel vor Ort wie am Führer

Ein Konto, das an beiden Seiten einer Direktkopplung dieselbe Ursprungskennung trägt, MUST am
Spiegel dieselbe Einsatzrolle haben wie am Führer.

#### Scenario: Einsatzleitung liest vor Ort mit
- **WHEN** „Anna Berg“ an ELW 1 Einsatzleitung eines Einsatzes ist und ELW 2 den Einsatz über die Direktkopplung spiegelt
- **THEN** hat „Anna Berg“ an ELW 2 im Spiegel die Rolle Einsatzleitung und sieht den Einsatz in ihrer Einsatzliste
