## MODIFIED Requirements

### Requirement: Katalog der Funktionsansichten

Das System SHALL genau diese Funktionsansichten kennen: `uhs-tablet`, `uhs-laptop`,
`lagemonitor`, `betreuungsstelle`, `bereitstellungsraum`, `einsatzabschnitt` und `verpflegung`.
Die beiden UHS-Ansichten MUST an genau eine UHS des Einsatzes gebunden sein, `betreuungsstelle`
an genau eine Betreuungsstelle, `bereitstellungsraum` an genau einen Bereitstellungsraum und
`einsatzabschnitt` an genau einen Einsatzabschnitt. `lagemonitor` und `verpflegung` MUST an
keine Stelle gebunden sein. Ein unbekannter Ansichtswert MUST beim Anlegen einer Kopplung 400
sein, ebenso eine fehlende Stelle bei einer gebundenen und eine angegebene Stelle bei einer
ungebundenen Ansicht.

#### Scenario: Unbekannte Ansicht

- **WHEN** die Einsatzleitung eine Kopplung mit der Ansicht `kiosk` anlegt
- **THEN** antwortet der Server mit 400

#### Scenario: Alle Ansichten wählbar

- **WHEN** die Einsatzleitung die Kopplungsmaske öffnet
- **THEN** bietet sie alle sieben Ansichten an, jede mit der Stellenart, an die sie gebunden ist, oder ohne Stelle

#### Scenario: Gebundene Ansicht ohne Stelle

- **WHEN** die Einsatzleitung ein UHS-Tablet ohne Angabe einer UHS koppeln will
- **THEN** antwortet der Server mit 400

#### Scenario: Ungebundene Ansicht mit Stelle

- **WHEN** die Einsatzleitung einen Lagemonitor mit einer UHS koppeln will
- **THEN** antwortet der Server mit 400

#### Scenario: UHS aus fremdem Einsatz

- **WHEN** die Einsatzleitung eine UHS-Ansicht an eine UHS eines anderen Einsatzes binden will
- **THEN** antwortet der Server mit 404

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
| `personen`: Aufnahme in die eigene UHS, Stammdaten, Sichtung, Verbleib, Notizen, Auswahl „Bestätigt von“ | S | S | — |
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

### Requirement: Stellenbindung

Ein Gerät mit stellengebundener Ansicht SHALL nur Daten der eigenen UHS sehen und schreiben.
Eine fremde UHS MUST 404 sein. Eine Person MUST für das Gerät sichtbar sein, wenn sie mindestens
eine Belegung in der eigenen UHS hat, auch nach ihrem Austritt. Für die übrigen Stellenarten
gilt dasselbe Muster; was dort „eigene Stelle“ und „sichtbare Person“ heißt, regelt die
Anforderung der jeweiligen Ansicht.

#### Scenario: Fremde UHS

- **WHEN** das Tablet der UHS Nord die UHS Süd abruft
- **THEN** antwortet der Server mit 404

#### Scenario: UHS-Liste

- **WHEN** das Tablet der UHS Nord die UHS-Liste abruft
- **THEN** enthält sie nur die UHS Nord

#### Scenario: Person der anderen UHS

- **WHEN** das Tablet der UHS Nord eine Person abruft, die nie in der UHS Nord war
- **THEN** antwortet der Server mit 404

#### Scenario: Verbleib nach Austritt

- **WHEN** eine Person die UHS Nord verlassen hat
- **AND** das Tablet der UHS Nord ihren Verbleib einträgt
- **THEN** speichert der Server den Verbleib

#### Scenario: Belegung in fremde UHS

- **WHEN** das Tablet der UHS Nord eine Person in die UHS Süd buchen will
- **THEN** antwortet der Server mit 403

## ADDED Requirements

### Requirement: Ansicht Betreuungsstelle

Die Funktionsansicht `betreuungsstelle` SHALL an genau eine Betreuungsstelle gebunden sein, die
Einsatzrolle Führungspersonal tragen und genau diese Rechte haben; was die Tabelle nicht nennt,
MUST verboten sein. Sichtbar MUST eine Person sein, die je mit Verbleib „Notunterkunft“ an der
eigenen Stelle war, auch nach ihrer Entlassung.

| Modul / Bereich | Betreuungsstelle |
| --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L |
| `betreuung`: eigene Stelle mit Belegung und „davon namentlich“, Meldeverlauf der eigenen Stelle | L |
| `betreuung`: Belegung der eigenen Stelle melden, eine Belegungsmeldung der eigenen Stelle zurücknehmen | S |
| `betreuung`: Bezirke und Stände, Kopfzahl, Stelle anlegen, ändern, stornieren | — |
| `personen`: Personen der eigenen Stelle | L |
| `personen`: Aufnahme in die eigene Stelle, Stammdaten, Verbleib, Notizen | S |
| `personen`: Sichtung, UHS-Belegung, Export, Druck, Abgleich, Anhänge | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen, eigene Meldungen lesen | L/S |
| alle übrigen Module, Einstellungen, Verwaltung | — |

#### Scenario: Nur die eigene Stelle

- **WHEN** das Gerät der Notunterkunft Nord die Betreuungsübersicht abruft
- **THEN** enthält sie nur die Notunterkunft Nord und keine Bezirke

#### Scenario: Fremde Stelle

- **WHEN** das Gerät der Notunterkunft Nord eine Belegung der Notunterkunft Süd meldet, deren Meldeverlauf abruft oder eine ihrer Belegungsmeldungen zurücknimmt
- **THEN** antwortet der Server mit 404

#### Scenario: Stelle verwalten

- **WHEN** das Gerät die Kopfzahl abruft, seine Stelle ändert, eine Stelle anlegt oder storniert
- **THEN** antwortet der Server mit 403

#### Scenario: Aufnahme

- **WHEN** das Gerät der Notunterkunft Nord eine Person aufnimmt
- **THEN** ist die Person „betroffen“ mit Verbleib „Notunterkunft“ an der Notunterkunft Nord
- **AND** bleibt die gemeldete Belegung der Stelle gleich, und „davon namentlich“ steigt um eins

#### Scenario: Aufnahme mit Sichtung

- **WHEN** das Gerät eine Person mit Sichtung oder mit UHS aufnehmen will
- **THEN** antwortet der Server mit 403

#### Scenario: Person einer anderen Stelle

- **WHEN** das Gerät eine Person abruft, die nie mit Verbleib „Notunterkunft“ an der eigenen Stelle war
- **THEN** antwortet der Server mit 404

#### Scenario: Fremde Notunterkunft

- **WHEN** das Gerät einer Person den Verbleib „Notunterkunft“ an einer anderen Stelle oder ohne Stelle gibt
- **THEN** antwortet der Server mit 403

#### Scenario: Widerruf

- **WHEN** die Einsatzleitung die Kopplung widerruft
- **AND** das Gerät danach seine Stelle abruft oder eine Belegung meldet
- **THEN** antwortet der Server mit 401

### Requirement: Ansicht Einsatzabschnitt

Die Funktionsansicht `einsatzabschnitt` SHALL an genau einen Einsatzabschnitt gebunden sein,
die Einsatzrolle Führungspersonal tragen und genau diese Rechte haben; was die Tabelle nicht
nennt, MUST verboten sein. Der Bereich MUST der Teilbaum des eigenen Abschnitts samt seiner
Einheiten sein, bei jeder Anfrage neu bestimmt. Löst die Einsatzleitung den Abschnitt auf, MUST
die Kopplung enden.

| Modul / Bereich | Einsatzabschnitt |
| --- | --- |
| Einsatzkopf, Modulfreigaben, Modulzähler, Live-Kanal | L |
| `einsatzabschnitte`: eigener Abschnitt mit seinen Unterabschnitten | L |
| `einsatzabschnitte`: anlegen, ändern, Fläche setzen, auflösen | — |
| `einheiten`: Einheiten im Bereich | L |
| `einheiten`: anlegen, ändern, Status, Position | — |
| `auftraege`: Aufträge mit mindestens einem Empfänger im Bereich | L |
| `auftraege`: die eigene Empfängerzeile quittieren, Vollzug melden | S |
| `auftraege`: erteilen, abnehmen, Kennzahlen | — |
| `meldungen`: Meldung an die Einsatzleitung anlegen (Absender aus dem Bereich), eigene Meldungen lesen | L/S |
| `lagekarte`: Gefahrenzonen des ganzen Einsatzes | L |
| `lagekarte`: Evakuierungsbezirke, Skizzen, Zonen anlegen, gespeicherte Kartenansichten | — |
| alle übrigen Module, Einstellungen, Verwaltung | — |

#### Scenario: Teilbaum

- **WHEN** das Gerät des Abschnitts Nord Abschnitte und Einheiten abruft
- **THEN** enthalten die Listen nur den Abschnitt Nord, seine Unterabschnitte und deren Einheiten

#### Scenario: Umgehängter Unterabschnitt

- **WHEN** die Einsatzleitung einen Unterabschnitt von Nord unter Süd hängt
- **THEN** sieht das Gerät des Abschnitts Nord dessen Einheiten bei der nächsten Anfrage nicht mehr

#### Scenario: Verwaltung am Gerät

- **WHEN** das Gerät einen Abschnitt ändert, einen Einheitenstatus setzt oder einen Auftrag erteilt
- **THEN** antwortet der Server mit 403

#### Scenario: Fremder Auftrag

- **WHEN** das Gerät einen Auftrag abruft, dessen Empfänger alle außerhalb des Bereichs liegen
- **THEN** antwortet der Server mit 404

#### Scenario: Quittieren nur die eigene Zeile

- **WHEN** ein Auftrag an eine Einheit des Bereichs und an den Abschnitt Süd geht
- **AND** das Gerät die Empfängerzeile des Abschnitts Süd quittieren will
- **THEN** antwortet der Server mit 404, und die eigene Zeile lässt sich quittieren

#### Scenario: Absender einer Meldung

- **WHEN** das Gerät eine Meldung ohne Absender anlegt
- **THEN** ist der eigene Abschnitt der Absender
- **AND** antwortet der Server mit 403, wenn als Absender ein Abschnitt oder eine Einheit außerhalb des Bereichs steht

#### Scenario: Zonen ohne Bezirke

- **WHEN** im Einsatz ein Absperrbereich, ein Evakuierungsbezirk und eine Skizze liegen
- **THEN** sieht das Gerät nur den Absperrbereich

#### Scenario: Aufgelöster Abschnitt

- **WHEN** die Einsatzleitung den Abschnitt des Geräts auflöst
- **THEN** antwortet der Server auf die nächste Anfrage des Geräts mit 401, und das ETB nennt das Gerät

#### Scenario: Widerruf

- **WHEN** die Einsatzleitung die Kopplung widerruft
- **AND** das Gerät danach seinen Abschnitt abruft
- **THEN** antwortet der Server mit 401
