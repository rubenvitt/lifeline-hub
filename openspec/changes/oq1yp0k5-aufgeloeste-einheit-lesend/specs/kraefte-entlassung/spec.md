## MODIFIED Requirements

### Requirement: Einheit auflösen

Das System SHALL eine Einheit auflösen können, ohne ihre Zeile zu löschen. Auflösen MUST zuerst
alle Kräfte von der Einheit lösen und danach das Ereignis `entlassung` an der Einheit schreiben,
das keine Person erreicht. Zeitachse, abgelöste Schichten, ETB-Verknüpfungen und
Verpflegungsausgaben an die Einheit MUST erhalten bleiben. Eine Einheit ohne Zeitachse, Schicht,
ETB-Verknüpfung, Belegung eines Bereitstellungsraums, ohne Auftrag, Meldung, Dokument, Verteiler
und Verpflegungsausgabe (auch eine zurückgenommene) mit Verweis auf sie und ohne jede (auch
beendete) Kraft mit Verweis auf sie MAY stattdessen gelöscht werden.
Bleibt die Einheit als aufgelöst stehen, MUST das Auflösen in derselben Transaktion ihre letzte
Besetzung festhalten, wie sie vor dem Lösen war: jede Person mit Führer-Kennzeichen und dem
Fahrzeug, auf dem sie saß, jedes Fahrzeug und jeden Materialposten mit seiner Menge. Eine
gelöschte oder stornierte Einheit MUST nichts festhalten.

#### Scenario: Aufgelöste Einheit bleibt im Nachweis
- **WHEN** die Einheit „Florian 1“ mit Eintreffen 06:40 um 15:00 aufgelöst wird
- **THEN** trägt ihre Zeitachse Eintreffen und Entlassung, und ihre ETB-Einträge nennen sie weiter

#### Scenario: Leere Einheit gelöscht
- **WHEN** eine eben angelegte Einheit ohne Kräfte und ohne Spur aufgelöst wird
- **THEN** ist sie gelöscht

#### Scenario: Verpflegte Einheit bleibt
- **WHEN** eine Einheit ohne Kräfte und ohne andere Spur, an die eine Verpflegungsausgabe ging, aufgelöst wird
- **THEN** bleibt sie als aufgelöst stehen, und die Ausgabe nennt sie weiter als Empfänger

#### Scenario: Verpflegte Einheit stornieren
- **WHEN** eine Einheit ohne andere Spur, an die eine Verpflegungsausgabe ging, als Fehldisposition storniert werden soll
- **THEN** antwortet das System mit 422 und dem Grund, dass eine Verpflegungsausgabe die Einheit nennt

#### Scenario: Letzte Besetzung festgehalten
- **WHEN** die Einheit „Florian 1“ mit Führerin Anna Beck und Ben Kurz auf dem Fahrzeug
  „Florian 1-83-1“ und einem Materialposten „Trage“ mit Menge 2 aufgelöst wird
- **THEN** liefert die Liste der aufgelösten Einheiten für „Florian 1“ als letzte Besetzung beide
  Personen, Anna Beck als Führerin, beide auf „Florian 1-83-1“, das Fahrzeug und „Trage“ mit
  Menge 2, obwohl keine dieser Kräfte der Einheit noch angehört

#### Scenario: Festgehaltene Kraft wird später storniert
- **WHEN** eine Person nach dem Auflösen ihrer Einheit als Fehldisposition storniert wird
- **THEN** fehlt sie in der letzten Besetzung der aufgelösten Einheit

#### Scenario: Vor der Änderung aufgelöst
- **WHEN** eine Einheit abgefragt wird, die aufgelöst wurde, bevor das System die letzte
  Besetzung festhielt
- **THEN** trägt sie keine letzte Besetzung, statt einer leeren

### Requirement: Beendete Kräfte in Listen und Zahlen

Das System SHALL entlassene und stornierte Kräfte sowie aufgelöste Einheiten aus jeder Liste,
Auswahl, Karte, Stärke, Statusverteilung und jedem Zähler herauslassen. Entlassene Kräfte und
aufgelöste Einheiten MUST auf Anfrage getrennt abrufbar sein. Personal- und Fahrzeugliste MUST
sie als eingeklappten Block „Entlassen“ mit der Aktion „Erneut disponieren“ zeigen, die
Materialliste als Block „Aus dem Einsatz genommen“, die Einheitenliste aufgelöste Einheiten als
eingeklappten Block „Aufgelöst“, in dem jeder Name auf die Ansicht der Einheit führt. Jeder
Schreibweg an einer beendeten Kraft außer dem erneuten
Disponieren MUST mit 409 antworten. Ein Test MUST fehlschlagen, wenn eine Abfrage der vier
Kräftetabellen (Personal, Einheiten, Fahrzeuge, Material) außerhalb einer Ausnahmeliste den
Zustand nicht prüft.

#### Scenario: Stärke ohne Entlassene
- **WHEN** von zwölf Personen einer Einheit zwei entlassen sind
- **THEN** zählen Meldebild, Statusband und Lagemonitor zehn

#### Scenario: Block Entlassen
- **WHEN** die Personalliste zwei Entlassene hat
- **THEN** zeigt sie unter den aktiven einen eingeklappten Block „Entlassen (2)“

#### Scenario: Status an Entlassener
- **WHEN** der Status einer entlassenen Person gesetzt werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Besatzung an entlassenem Fahrzeug
- **WHEN** einem entlassenen Fahrzeug eine Person als Besatzung zugeordnet werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Aufgelöste Einheit aus dem Block öffnen
- **WHEN** jemand im aufgeklappten Block „Aufgelöst“ den Namen „Florian 1“ wählt
- **THEN** öffnet die Ansicht der aufgelösten Einheit „Florian 1“
