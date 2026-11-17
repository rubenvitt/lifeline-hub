# warten-ohne-wecken Specification

## Purpose
Legt fest, wie eine Sitzung auf Gates, CI und Merge wartet, ohne für nichts geweckt zu werden:
jede Runde liest den ganzen Kontext neu und kostet entsprechend.

## Requirements

### Requirement: Geweckt wird nur, wenn etwas zu tun ist
Der Main-Loop MUST die Gates in einem Aufruf abwarten (Portionen hintereinander im selben Aufruf)
und MUST NOT Zwischenstände per Monitor melden lassen, abfragen oder einen Wecker zum Nachsehen
stellen, solange das PR-Abo Ereignisse liefert. Eine Meldung ohne Handlungsbedarf MUST er ohne
Werkzeugaufruf beenden. Das PR-Abo bleibt bis zum Merge; weckt der Merge die Sitzung, MUST sie nur
den Board-Status setzen, die Reservierung lösen und die Abschlussmeldung geben.

#### Scenario: Rust-Suite in Portionen
- **WHEN** die Rust-Suite wegen des Plattenkontingents in Portionen laufen muss
- **THEN** laufen alle Portionen in einem Hintergrund-Aufruf, und die Sitzung wird einmal geweckt

#### Scenario: Cloudflare meldet die Vorschau
- **WHEN** ein Bot-Kommentar ohne Befund die Sitzung weckt
- **THEN** beendet sie die Runde ohne Werkzeugaufruf mit höchstens einem Satz

#### Scenario: PR wurde gemergt
- **WHEN** das Merge-Ereignis die Sitzung weckt
- **THEN** setzt sie `done`, löst die Reservierung und gibt die Abschlussmeldung, ohne Gates oder
  CI erneut zu prüfen
