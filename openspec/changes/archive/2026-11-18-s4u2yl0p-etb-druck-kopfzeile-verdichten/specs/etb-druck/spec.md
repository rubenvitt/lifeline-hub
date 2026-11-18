## ADDED Requirements

### Requirement: Einsatz und Stand auf jeder Seite

Jede Druckseite des Tagebuchs SHALL über den Spaltenköpfen eine Laufzeile tragen mit der Dokumentart
„Einsatztagebuch“, dem Einsatz (Bezeichnung, interne Einsatznummer falls vorhanden, wie im Druckkopf)
und dem Stand des Schnappschusses (Zeitpunkt und höchste laufende Nummer, falls vorhanden). Die Zeile
gehört zum Tabellenkopf und MUST sich überall dort wiederholen, wo er es tut (Chromium, Firefox;
WebKit wiederholt keinen Tabellenkopf). Sie MUST NOT über das Randfeld der Seite entstehen.

#### Scenario: Folgeseite eines langen Tagebuchs

- **GIVEN** der Einsatz „Hochwasser Elbe“ mit interner Nummer „2026-042“ und ein Ausdruck über mehrere
  Seiten, Stand 181400nov26 bis Nr. 220
- **WHEN** die zweite Seite gedruckt wird
- **THEN** steht über den Spaltenköpfen „Einsatztagebuch“, „Hochwasser Elbe (2026-042)“ und
  „Stand 181400nov26 · bis Nr. 220“

#### Scenario: Einsatz ohne interne Nummer

- **WHEN** ein Einsatz ohne interne Nummer gedruckt wird
- **THEN** nennt die Laufzeile nur die Bezeichnung, ohne leere Klammern

#### Scenario: Leere Auswahl

- **WHEN** die Auswahl keine Einträge enthält
- **THEN** gibt es keine Tabelle und damit keine Laufzeile; der Druckkopf nennt Einsatz und Stand

### Requirement: Systemeinträge verdichtet

Ein Systemeintrag SHALL im Druck immer in verdichteter Form an seiner laufenden Nummer stehen: Nummer
und Ereigniszeit in ihren Spalten, danach in einer Zelle über die übrigen Spalten das Typwort
„System“, der Inhalt und der Erfasser, kleiner gesetzt als ein gewöhnlicher Eintrag. Es gibt keinen
Schalter für eine ausführliche Form. Hinweise auf Nachtrag und Berichtigung MUST erhalten bleiben.

#### Scenario: Lauf von Systemeinträgen

- **WHEN** die Einträge Nr. 86 (Meldung), Nr. 87 und 88 (System) und Nr. 89 (Auftrag) gedruckt werden
- **THEN** stehen 86 bis 89 lückenlos in dieser Folge, 87 und 88 je als verdichtete Zeile mit
  „System“, Inhalt und Erfasser, 86 und 89 in voller Form

#### Scenario: Ausschluss der Systemeinträge

- **WHEN** die Druckadresse `system=aus` trägt
- **THEN** fehlen die Systemeinträge ganz, wie bisher

## MODIFIED Requirements

### Requirement: Inhalt je Eintrag

Jeder Eintrag SHALL mit laufender Nummer, Ereigniszeit, Typwort, Von und An (falls
vorhanden), Meldeweg (falls vorhanden), Inhalt und Erfasser samt Funktion (falls vorhanden)
gedruckt werden; ein Systemeintrag steht dabei in der verdichteten Form der Anforderung
„Systemeinträge verdichtet“. Alle Zeiten MUST in der Zeitzone der Organisation stehen. Die Ereigniszeit SHALL
in der Rolle „Zeitpunkt“ der Spec `zeitdarstellung` stehen, taktisch also als volle DTG
(`101430okt26`), in der Darstellung von Einsatz bzw. Organisation; die Wahl am Gerät MUST NOT in
den Ausdruck eingehen (LLH-1061). Ein Eintrag MUST NOT
über einen Seitenrand geteilt werden, solange er auf eine Seite passt; der Tabellenkopf SHALL
sich auf jeder Seite wiederholen.

#### Scenario: Eintrag im Ausdruck

- **WHEN** ein Meldungseintrag von „Florian 1“ an „ELW“ gedruckt wird
- **THEN** stehen Nummer, Ereigniszeit, „Meldung“, Von, An, Inhalt und Erfasser im Ausdruck

#### Scenario: Volle DTG in der Zeitspalte

- **WHEN** der Einsatz taktisch vorgibt, das Gerät „Datum und Uhrzeit“ gewählt hat und ein Eintrag
  mit Ereigniszeit 10.10.2026 14:30 Uhr Ortszeit gedruckt wird
- **THEN** steht in seiner Zeitspalte `101430okt26`
