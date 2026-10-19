## MODIFIED Requirements

### Requirement: Scope-Matrix

Die Ansichten `uhs-tablet`, `uhs-laptop` und `lagemonitor` SHALL genau die folgenden Rechte
haben, je Modul getrennt nach Lesen (L) und Schreiben (S). Was die Tabelle nicht nennt, MUST
verboten sein. „Eigene UHS“ heißt die UHS der Kopplung. Die übrigen Ansichten regelt je eine
eigene Anforderung („Ansicht Betreuungsstelle“, „Ansicht Bereitstellungsraum“, „Ansicht
Einsatzabschnitt“, „Ansicht Verpflegung“).

| Modul / Bereich | UHS-Tablet | UHS-Laptop | Lagemonitor |
| --- | --- | --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L | L | L |
| `unfallhilfsstellen`: eigene UHS mit Plätzen und Belegung | L | L | — |
| `unfallhilfsstellen`: Belegung (Eintritt, Wechsel in der eigenen UHS, Austritt), Platzverfügbarkeit | S | S | — |
| `unfallhilfsstellen`: Plätze anlegen, ändern, stornieren; Stammdaten der eigenen UHS; Anhänge der eigenen UHS | — | L/S | — |
| `unfallhilfsstellen`: Kräfte der eigenen UHS zuordnen, ad hoc erfassen, lösen | — | L/S | — |
| `unfallhilfsstellen`: UHS anlegen, Status wechseln, stornieren | — | — | — |
| `personen`: Personen der eigenen UHS | L | L | — |
| `personen`: Aufnahme in die eigene UHS, Stammdaten, Sichtung, Verbleib, Notizen, Verletzungen, Maßnahmen, Transport, Auswahl „Bestätigt von“ | S | S | — |
| `personen`: Export, Druck, Abgleich, Anhänge | — | — | — |
| `material`: Material der eigenen UHS | — | L | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen, eigene Meldungen lesen | — | L/S | — |
| Lagemonitor-Lagebild (verdichtete Zahlen) | — | — | L |
| `lagekarte`, `gefahrenzonen`, `einsatzabschnitte` ohne personenbezogene Ebenen | — | — | L |
| alle übrigen Module, Einstellungen, Verwaltung | — | — | — |

Der Lagemonitor MUST NOT schreiben dürfen, in keinem Modul.

#### Scenario: Tablet liest das ETB nicht

- **WHEN** ein UHS-Tablet das ETB seines Einsatzes abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Tablet bearbeitet den Grundriss nicht

- **WHEN** ein UHS-Tablet in seiner UHS einen Platz anlegt
- **THEN** antwortet der Server mit 403

#### Scenario: Laptop bearbeitet den Grundriss

- **WHEN** ein UHS-Laptop in seiner UHS einen Platz anlegt
- **THEN** legt der Server den Platz an

#### Scenario: Laptop wechselt den UHS-Status nicht

- **WHEN** ein UHS-Laptop seine UHS auf „aufgelöst“ setzen will
- **THEN** antwortet der Server mit 403

#### Scenario: Lagemonitor schreibt nichts

- **WHEN** ein Lagemonitor irgendeine schreibende Anfrage an eine Einsatzroute schickt
- **THEN** antwortet der Server mit 403

#### Scenario: Lagemonitor liest keine Personen

- **WHEN** ein Lagemonitor die Personenliste oder eine UHS-Detailseite abruft
- **THEN** antwortet der Server mit 403

#### Scenario: Lagemonitor zeigt Gefahrenzonen und Abschnittsflächen

- **WHEN** der Einsatz einen Absperrbereich, einen Evakuierungsbezirk, eine freie Skizze und einen Abschnitt mit Fläche hat
- **THEN** zeigt die Karte des Lagemonitors den Absperrbereich und die Fläche des Abschnitts, aber weder den Bezirk noch die Skizze
- **AND** enthält die Antwort des Servers dafür weder Beschriftung und Notiz der Zone noch Leitung und Bemerkung des Abschnitts
- **AND** bleiben Zonenliste und Abschnittsliste für den Lagemonitor gesperrt (403), denn sie tragen Notizen und Leiternamen

#### Scenario: Tablet markiert eine Verletzung

- **WHEN** ein UHS-Tablet an einer Person seiner UHS eine Verletzung markiert
- **THEN** speichert der Server sie
