# lage-verdichtung Specification

## Purpose
Jede Zahl, die das Lage-Dashboard und der Führungsüberblick zeigen, hat genau einen
Rechenweg. Dieselbe Zahl zeigt an jeder Stelle denselben Wert, damit eine Lagebesprechung nicht
zwei Wahrheiten vorträgt.

## Requirements

### Requirement: Handlungsmengen kommen vom Modulzähler
Der Führungsüberblick und die Alarmzeile SHALL diese Zahlen ausschließlich aus
`GET /api/einsaetze/{id}/modul-zaehler` anzeigen: Aufträge offen, Aufträge in Arbeit, Aufträge
überfällig, Meldungen offen, Meldungen neu, Meldungen mit überfälliger Bestätigung, offene
Sofortmeldungen und offene dringende Meldungen. Sie MUST NOT diese Zahlen aus einer Modulliste
zählen.
- „Aufträge überfällig“ MUST die überfälligen unter den offenen Aufträgen meinen.
- „Bestätigung überfällig“ MUST `meldungen.bestaetigung_ueberfaellig` meinen, also auch eskalierte
  unbestätigte Meldungen.
- Fehlt ein Modul in der Antwort (nicht erlaubt), MUST die Kennzahl „nicht freigegeben“ sagen und
  MUST NOT 0 zeigen.
- Solange der Zähler lädt oder gescheitert ist, MUST die Kennzahl keinen Wert zeigen.

#### Scenario: Dashboard und Modulpanel stimmen überein
- **WHEN** der Modulzähler `auftraege: { offen: 5, in_arbeit: 2, ueberfaellig: 1 }` liefert
- **THEN** zeigt der Überblick „Offene Aufträge“ 5 mit der Notiz „1 überfällig“, und das
  Modulpanel zeigt an „Aufträge“ dieselbe 5

#### Scenario: Überblick und Dashboard stimmen überein
- **WHEN** der Modulzähler `auftraege.ueberfaellig: 2` liefert
- **THEN** nennt die Alarmzeile auf Überblick und Lagebild „2 Aufträge überfällig“, und die
  Notiz der Kennzahl im Überblick sagt „2 überfällig“

#### Scenario: Vollzogener Auftrag mit abgelaufener Frist
- **WHEN** ein Auftrag vollzogen ist, seine Frist abgelaufen ist und ein Empfänger nicht quittiert hat
- **THEN** zählt der Überblick ihn nicht als überfällig, und die Alarmzeile nennt ihn nicht

#### Scenario: Eskalierte Meldung
- **WHEN** eine bestätigungspflichtige, unbestätigte Meldung eskaliert ist, ihre Frist aber noch
  nicht abgelaufen ist
- **THEN** zählt der Überblick sie unter „Bestätigung überfällig“

#### Scenario: Meldungen nicht freigegeben
- **WHEN** die Antwort des Modulzählers kein Feld `meldungen` enthält
- **THEN** sagt die Kennzahl „Meldungen offen“ „nicht freigegeben“ und zeigt keine 0

### Requirement: Stärke zählt jede Einheit höchstens einmal
Eine Stärkesumme über eine Menge von Einheiten SHALL die kumulierte Ist-Stärke nur der Einheiten
addieren, deren übergeordnete Einheit nicht selbst in derselben Summe steckt. Die Stärke eines
Einsatzabschnitts SHALL zählen, wer in ihm steht: jede aktive Einheit mit ihrer eigenen Stärke bei
ihrem wirksamen Abschnitt, also dem eigenen oder, ohne eigenen, dem ihrer nächsten Obereinheit mit
Abschnitt. Eine unterstellte Einheit in einem anderen Abschnitt zählt dort und nicht bei ihrer
Obereinheit.
- Die Seite Einsatzabschnitte (Gliederung, Detail, Organigramm), die Abschnittsvorschau, die
  Abschnittsansicht am Gerät, das Meldebild und der Führungsüberblick MUST für denselben Abschnitt
  dieselbe Stärke zeigen.
- Die Zahl der Einheiten eines Abschnitts MUST dieselbe Menge zählen wie seine Stärke.
- Ein Bereitstellungsraum MUST jede in ihm stehende Einheit höchstens einmal zählen.
- Eine leere Menge MUST weiter „keine Einheit zugeordnet“ bedeuten, nicht 0/0/0.

#### Scenario: Unterstellte Einheit im selben Abschnitt
- **WHEN** Einheit A (1/1/2) im Abschnitt X steht und ihr die Einheit B (0/1/3) unterstellt ist,
  die ebenfalls im Abschnitt X steht
- **THEN** zeigt der Abschnitt X die Stärke 1/2/5//8, nicht 1/3/8//12

#### Scenario: Unterstellte Einheit in anderem Abschnitt
- **WHEN** Einheit B (0/1/1) der Einheit A (1/1/2) unterstellt ist, A im Abschnitt X und B im
  Abschnitt Y steht
- **THEN** zeigt Y die Stärke 0/1/1//2 und X die Stärke 1/1/2//4, auf der Seite Einsatzabschnitte
  wie im Meldebild
- **AND** zeigt ein Abschnitt über X und Y „inkl. Unterabschnitte“ beide zusammen, 1/2/3//6

#### Scenario: Unterstellte Einheit ohne eigenen Abschnitt
- **WHEN** Einheit B der Einheit A unterstellt ist, A im Abschnitt X steht und B keinen eigenen
  Abschnitt trägt
- **THEN** zählt B bei X

#### Scenario: Abschnittsansicht am Gerät mit geerbter Untereinheit
- **WHEN** ein Gerät an den Abschnitt X gekoppelt ist, Einheit A (1/1/2) in X steht und die ihr
  unterstellte Einheit B (0/1/8) keinen eigenen Abschnitt trägt
- **THEN** zeigt das Gerät für X die Stärke 1/2/10//13 wie die Seite Einsatzabschnitte und führt B in
  seiner Einheitenliste

#### Scenario: Abschnitt mit nur einer abgestellten Einheit
- **WHEN** im Abschnitt „UHS Turnhalle“ nur die Sanitätsgruppe (0/1/1) steht, die dem Zug in einem
  anderen Abschnitt unterstellt ist
- **THEN** zeigen Gliederung und Organigramm für „UHS Turnhalle“ 0/1/1//2 und „1 Einheit“, nicht
  0/0/0//0

#### Scenario: Bereitstellungsraum mit Einheit und Untereinheit
- **WHEN** im Bereitstellungsraum Einheit A und die ihr unterstellte Einheit B stehen
- **THEN** zählt die Summe B genau einmal

#### Scenario: Meldebild mit kumulierter Elternzeile
- **WHEN** das Meldebild Einheit A (1/1/2) mit der unterstellten Einheit B (0/1/3) im selben
  Abschnitt als Kind zeigt
- **THEN** zeigt A 1/2/5//8, B 0/1/3//4, und der Seitenkopf zählt 1/2/5//8

### Requirement: Eine Formatierung und eine Sichtungsverteilung
Die BOS-Schreibweise einer Stärke („F/UF/M//Σ“) SHALL an jeder Stelle aus derselben Formatierung
kommen. Die Verteilung der Betroffenen auf die Sichtungskategorien SHALL an jeder Stelle aus
derselben Zählung kommen: im Lage-Dashboard, in der Betroffenen-Seitenleiste und in der
Vorbereitung der Lagebesprechung.

#### Scenario: Gleiche Sichtungsverteilung
- **WHEN** Lage-Dashboard und Betroffenen-Seitenleiste dieselbe Personenliste zeigen
- **THEN** stimmen die Zahlen je Sichtungskategorie und „ohne Sichtung“ überein

### Requirement: Gemeinsames Fixture für Regeln beider Sprachen
Jede Zählregel, die sowohl der Server als auch der Client anwendet, SHALL durch ein gemeinsames
Fixture belegt sein. Das Fixture ist eine Datei mit Eingaben und erwarteten Zahlen, gelesen von
einem Rust-Test und von einem Vitest-Test. Es MUST mindestens diese Regeln abdecken:
- Auftrag offen und davon überfällig;
- Meldung offen, neu und Bestätigung überfällig;
- kumulierte Ist-Stärke einer Einheit über ihre Unterstellung;
- Stärke eines Abschnitts;
- entlassene und stornierte Kräfte zählen in keiner Stärke und keiner Statusverteilung;
- Versorgungszustand einer Person aus ihrem jüngsten Verbleib, und abgeschlossene Patienten
  zählen in keiner Sichtungsverteilung der Lage.

Eine Änderung an einer Regel, die nur eine Seite nachzieht, MUST einen der beiden Tests rot machen.

#### Scenario: Server weicht ab
- **WHEN** die Server-Regel für „Auftrag überfällig“ geändert wird und das Fixture nicht
- **THEN** schlägt der Rust-Test fehl

#### Scenario: Client weicht ab
- **WHEN** die Client-Regel für „Bestätigung überfällig“ geändert wird und das Fixture nicht
- **THEN** schlägt der Vitest-Test fehl

#### Scenario: Entlassene mitgezählt
- **WHEN** eine Seite entlassene Personen in die Stärke zählt
- **THEN** schlägt der Test ihrer Sprache fehl

#### Scenario: Versorgungszustand weicht ab
- **WHEN** eine Seite einen Transport mit `angemeldet` als abgeschlossen ableitet
- **THEN** schlägt der Test ihrer Sprache fehl

### Requirement: Abgeschlossene Patienten zählen nicht als Patienten
Lage-Dashboard, Vorbereitung der Lagebesprechung und Lagemonitor SHALL in der Zahl „Patienten“
und in der Sichtungsverteilung nur Personen zählen, deren Versorgungszustand nicht
`abgeschlossen` ist. Unterwegs befindliche Patienten MUST mitzählen. Druck und Einsatzbericht
MUST weiter alle Personen zählen.

#### Scenario: Lagemonitor nach Entlassung
- **WHEN** drei Personen in SK II erfasst sind und eine davon an ein fremdes Rettungsmittel übergeben wurde
- **THEN** zeigt der Lagemonitor „SK II 2“, und das Lage-Dashboard zeigt in der Sichtungsverteilung SK II 2

#### Scenario: Einsatzbericht bleibt vollständig
- **WHEN** der Einsatzbericht für denselben Einsatz gedruckt wird
- **THEN** zählt seine Personenbilanz SK II 3

### Requirement: Abschnitt im Überblick nennt Rückmeldung und Ausfall wie das Meldebild
Die Abschnittskarte im Überblick SHALL die Rückmeldung jeder Einheit ihres Teilbaums mit derselben
Regel beurteilen wie das Meldebild und überfällige oder fehlende Rückmeldungen als Etikett in der
Alarmrolle nennen, die überfällige mit Dauer. Ihr Ausfall MUST aus derselben Zählung kommen wie im
Meldebild (Mittel und Material der Einheiten). Ein gepflegter Lagezustand MUST unverändert
stehen bleiben; das Etikett steht daneben.

#### Scenario: Eine Einheit schweigt
- **WHEN** im Abschnitt Logistik die Rückmeldung des Logistiktrupps seit 47 Minuten fällig ist und eine andere Einheit vor 5 Minuten zurückgemeldet hat
- **THEN** zeigt die Abschnittskarte „Rückm. überfällig seit 47 min“ in der Alarmrolle

#### Scenario: Mehrere Einheiten überfällig
- **WHEN** im Teilbaum drei Einheiten überfällig sind, die längste seit 47 Minuten
- **THEN** zeigt die Abschnittskarte „3 Einh. Rückm. überfällig, längste seit 47 min“

#### Scenario: Ausfall wie im Meldebild
- **WHEN** das Meldebild für eine Einheit im Abschnitt „1 Ausfall“ und „1 Ausfall Material“ zeigt
- **THEN** zeigt die Abschnittskarte „1 Ausfall“ und „1 Ausfall Material“ in der Alarmrolle, und die Statusverteilung nennt ihre dritte Zelle „nicht verfügbar“

#### Scenario: Planmäßig mit überfälliger Rückmeldung
- **WHEN** der Abschnitt den Lagezustand „planmäßig“ trägt und eine Rückmeldung darin überfällig ist
- **THEN** bleiben Kante und Etikett „planmäßig“ unverändert, und direkt daneben steht das Alarm-Etikett zur Rückmeldung

#### Scenario: Rückmeldungen nicht abrufbar
- **WHEN** die Rückmeldungen nicht geladen oder nicht abrufbar sind
- **THEN** zeigt die Abschnittskarte kein Rückmeldungs-Etikett, statt jede Einheit als schweigend zu melden

### Requirement: Überblick führt, Lagebild zeigt die Lage
Der Überblick SHALL zeigen, was zu tun ist: Aufträge, Meldungen, Abschnitte, offene Vorgänge,
nächste Marken und Entscheidungen. Das Lagebild SHALL zeigen, was los ist: Betroffene, Kräfte,
Vermisste, Gefahren, Sichtung, Einsatzdauer, Lagebericht und Unfallhilfsstellen. Eine Kennzahl MUST
auf genau einer der beiden Seiten stehen; ausgenommen ist die Alarmzeile, die auf beiden steht.

#### Scenario: Betroffene nur im Lagebild
- **WHEN** jemand den Überblick öffnet
- **THEN** zeigt dessen Kennzahlenband weder Betroffene noch Kräfte noch Einsatzdauer

#### Scenario: Aufträge nur im Überblick
- **WHEN** jemand das Lagebild öffnet
- **THEN** zeigt es keine Kennzahl „Aufträge offen“ und keine Kennzahl „Meldungen offen“

### Requirement: Die Übersichten verweisen aufeinander
Der Überblick SHALL im Seitenkopf einen Sprung zum Lagebild tragen und das Lagebild einen Sprung
zum Überblick, sofern der Betrachter das Ziel öffnen darf.

#### Scenario: Vom Überblick ins Lagebild
- **WHEN** jemand im Überblick auf „Lagebild“ im Seitenkopf klickt
- **THEN** öffnet sich das Lagebild desselben Einsatzes

### Requirement: Kräfte heißt Köpfe
Eine Zahl, die mit „Kräfte“ beschriftet ist, SHALL Personen zählen. Fahrzeuge, Einheiten und
Material MUST NOT in eine Zahl „Kräfte“ eingehen; nennt eine Stelle sie mit, dann als eigene Zahl
mit eigenem Wort.

#### Scenario: Zeile über dem Meldebild ohne Filter
- **WHEN** der Einsatz 12 Personen und 8 Fahrzeuge führt und kein Filter gesetzt ist
- **THEN** steht in der Werkzeugzeile des Meldebilds keine Auswahlzahl, und nirgends „20 von 20
  Kräften“; die Zahlen nennen Statusband und Seitenkopf

#### Scenario: Gefilterte Auswahl
- **WHEN** ein Filter 5 der 12 Personen und 2 der 8 Fahrzeuge durchlässt
- **THEN** steht dort „5 von 12 Kräften · 2 von 8 Fahrzeugen“

### Requirement: Kräfte an Unfallhilfsstellen nur an aktiven UHS
Die Zahl der Kräfte an Unfallhilfsstellen SHALL das aktive Personal zählen, das einer UHS im
Status „aktiv“ zugeordnet ist. Geplante und aufgelöste UHS MUST NOT mitzählen. Lagebild und
Lagemonitor MUST dieselbe Zahl zeigen und sie als Kräfte „an UHS“ beschriften.

#### Scenario: Geplante UHS mit zugeordnetem Personal
- **WHEN** der aktiven UHS „Turnhalle“ drei Kräfte zugeordnet sind und der geplanten UHS „Sporthalle“
  zwei
- **THEN** nennt das Lagebild in der Kennzahl „UHS aktiv“ „1 geplant · 3 Kräfte an UHS“
- **AND** nennt der Lagemonitor in der Kachel „Kräfte“ „3 an UHS“
