# Spec Delta

## ADDED Requirements

### Requirement: Weitere Abschnitte des Lagevortrags zur Information
Im Lagevortrag zur Information SHALL je eine Übernahme in den Abschnitten „Besondere
(Führungs-)Probleme“, „Gefahren-/Schadenlage“ und „Lageentwicklung“ stehen. Die Abschnitte
„Auftrag“, „Anträge und Vorschläge“ und „Zusammenfassung“ MUST ohne Übernahme bleiben.

#### Scenario: Knopf in der Gefahren-/Schadenlage
- **WHEN** eine Person mit Schreibrecht einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** steht im Abschnitt „Gefahren-/Schadenlage“ ein Übernahme-Knopf mit einem Nebentext,
  der die Herkunft nennt

#### Scenario: Kein Knopf im Auftrag
- **WHEN** eine Person einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** zeigt der Abschnitt „Auftrag“ keinen Übernahme-Knopf

### Requirement: Stand und kein Freitext in den weiteren Abschnitten
Der übernommene Text dieser Abschnitte MUST mit dem Stand als taktische DTG beginnen; der Stand
MUST der älteste Datenstand der gelesenen Quellen sein. Der Text MUST keinen Freitext aus
Auftrags-, Meldungs-, ETB-, Personen- oder Schadensfeldern und keine Angaben zu Betroffenen außer
Zahlen enthalten.

#### Scenario: Stand aus dem Zwischenspeicher
- **WHEN** die Listen seit 10 Minuten im Zwischenspeicher liegen und die Person die
  Gefahren-/Schadenlage übernimmt
- **THEN** nennt die erste Zeile den Stand dieser Listen, nicht die Uhrzeit des Klicks

#### Scenario: Auftragstext bleibt draußen
- **WHEN** ein überfälliger Auftrag den Text „Familie Müller evakuieren“ trägt
- **THEN** nennt die Übernahme den Auftrag mit Nummer und Frist, und der Text kommt nicht vor

### Requirement: Zahlen wie Dashboard, Vorbereitung und Funkplan
Jede Zahl in diesen Abschnitten MUST nach derselben Regel entstehen wie die gleichnamige Angabe im
Lage-Dashboard, in der Vorbereitung der Lagebesprechung bzw. im Funkplan; aus denselben Daten MUST
derselbe Wert folgen. Eine gesperrte oder nicht geladene Quelle MUST als „—“ mit Grund stehen, nie
als 0.

#### Scenario: Überfällige Aufträge
- **WHEN** die Vorbereitung „3 überfällig“ an den offenen Aufträgen zeigt
- **THEN** nennt die Übernahme der Führungsprobleme 3 überfällige Aufträge und listet genau diese
  drei

#### Scenario: Betroffene gesperrt
- **WHEN** das Modul Personen für die Person gesperrt ist und sie die Gefahren-/Schadenlage
  übernimmt
- **THEN** stehen Betroffene, Vermisste und Sichtung als „— (nicht freigegeben)“, und es wurde
  keine Personenliste angefragt

### Requirement: Inhalt der Besonderen (Führungs-)Probleme
Die Übernahme SHALL überfällige offene Aufträge (Zahl und je Auftrag Nummer und Frist), Meldungen
mit überfälliger Bestätigung (Zahl und je Meldung Nummer, Art und Frist), die Zahl noch nicht
gesichteter Meldungen und die Lücken des Funkplans enthalten. Ein Teil ohne Befund MUST „keine“
sagen.

#### Scenario: Keine Probleme
- **WHEN** kein Auftrag überfällig ist, keine Bestätigung aussteht und der Funkplan keine Lücke
  hat
- **THEN** sagt jeder der drei Teile „keine“

#### Scenario: Funkplan-Lücke
- **WHEN** der Einheit „ELW 1“ keine Sprechgruppe zugeordnet ist
- **THEN** nennt der Teil Funkplan „Einheiten ohne Sprechgruppe: 1 (ELW 1)“ wie der Funkplan im
  Lagebericht

### Requirement: Inhalt der Gefahren-/Schadenlage
Die Übernahme SHALL Betroffene, Vermisste, Sichtung nach Kategorien, offene Schäden, die höchste
Warnstufe mit der Zahl der Gebiete, geltende und angekündigte Wetterwarnungen, die aktuellen
Bedingungen am Einsatzort und je maßgeblichem Pegel Stand und Trend enthalten. Fehlt ein
Einsatzort oder ein Pegel, MUST der Text das sagen statt einer leeren Zeile.

#### Scenario: Ohne Einsatzort
- **WHEN** der Einsatz keinen Ort hat und die Person die Gefahren-/Schadenlage übernimmt
- **THEN** sagt der Teil Wetter „kein Einsatzort“, und die übrigen Teile tragen ihre Werte

#### Scenario: Pegel
- **WHEN** zwei maßgebliche Pegel festgelegt sind
- **THEN** nennt der Text beide mit Gewässer, Stand, Trend und Messzeit in der festgelegten
  Reihenfolge

### Requirement: Inhalt der Lageentwicklung
Die Übernahme SHALL die ETB-Einträge seit dem Eintrag der letzten abgehaltenen Lagebesprechung
zusammenfassen, gemessen an der laufenden Nummer. System-Einträge und die Einträge freigegebener
Lageberichte MUST ausgenommen sein. Der Text SHALL die Zahl der neuen Einträge je Typ und die neuen
Entscheidungen mit Nummer und Zeit nennen, ohne Wortlaut. Ohne abgehaltene Lagebesprechung MUST er
„seit Einsatzbeginn“ sagen.

#### Scenario: Nachgetragener Eintrag
- **WHEN** nach der Lagebesprechung ein Eintrag mit einer früheren Ereigniszeit erfasst wird
- **THEN** zählt er zu den Neuerungen

#### Scenario: Früherer Lagevortrag
- **WHEN** seit der Lagebesprechung ein Lagevortrag freigegeben wurde
- **THEN** zählt sein ETB-Eintrag nicht zu den Neuerungen

#### Scenario: Noch keine Lagebesprechung
- **WHEN** im Einsatz noch keine Lagebesprechung abgehalten wurde
- **THEN** beginnt die Zusammenfassung mit „seit Einsatzbeginn“
