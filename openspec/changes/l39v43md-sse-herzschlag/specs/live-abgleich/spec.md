# Spec Delta

## ADDED Requirements

### Requirement: Live-Ströme senden ein regelmäßiges Lebenszeichen

Der Einsatz-Strom und der Org-Strom SHALL spätestens alle 15 s ein eigenes Kontroll-Ereignis
`heartbeat` senden, auch wenn kein Fach-Ereignis anfällt. Das Lebenszeichen MUST NOT die Position
des Stroms (`Last-Event-ID`) ändern, MUST NOT einen Abgleich auslösen und MUST jede Verbindung
erreichen, unabhängig von ihren Modulrechten und ob sie ein gekoppeltes Gerät ist.

#### Scenario: Ruhiger Einsatz
- **WHEN** ein Tab den Einsatz-Strom offen hat und 60 s lang kein Fach-Ereignis anfällt
- **THEN** erhält der Tab in dieser Zeit mindestens drei Lebenszeichen und ruft keine Abfrage neu ab

#### Scenario: Neuverbinden nach Lebenszeichen
- **WHEN** ein Tab seine Position erhalten hat, danach nur Lebenszeichen empfängt und der Browser neu verbindet
- **THEN** schickt der Browser die Position mit, und der Server liefert nichts nach und sendet kein `lagged`

#### Scenario: Gerät ohne Modulrechte
- **WHEN** ein gekoppelter Lagemonitor den Einsatz-Strom offen hat
- **THEN** erhält er die Lebenszeichen wie jede andere Verbindung

### Requirement: Eine stumme Live-Leitung gilt als abgerissen

Hat eine Live-Verbindung einmal geöffnet und trifft danach 45 s lang kein Ereignis ein, SHALL das
Frontend sofort den Zustand „Live-Verbindung wird wiederhergestellt“ melden, die Verbindung schließen
und eine neue aufbauen; diese MUST voll abgleichen. Vor dem ersten Öffnen MUST NOT das Frontend eine
Leitung wegen Stille als abgerissen melden.

#### Scenario: Funkloch bei offener Leitung
- **WHEN** die Leitung offen scheint, der Browser keinen Fehler meldet und 45 s lang kein Ereignis eintrifft
- **THEN** zeigen Kopfleiste, Lagebild und Lagemonitor nicht mehr „live“, sondern den Wiederaufbau, und das Frontend baut eine neue Verbindung auf

#### Scenario: Neue Verbindung steht wieder
- **WHEN** die nach Stille neu aufgebaute Verbindung öffnet
- **THEN** zeigen die Anzeigen wieder „live“, und der Tab gleicht alle Abfragen genau einmal ab

#### Scenario: Lebenszeichen hält die Leitung
- **WHEN** über mehrere Minuten nur Lebenszeichen und keine Fach-Ereignisse eintreffen
- **THEN** bleibt der Zustand „live“, und das Frontend baut nichts neu auf

#### Scenario: Kaltstart
- **WHEN** ein Tab die Live-Verbindung öffnet und das erste Öffnen länger als 45 s dauert
- **THEN** bleibt der Zustand „verbinde“, und das Frontend meldet keinen Abriss wegen Stille
