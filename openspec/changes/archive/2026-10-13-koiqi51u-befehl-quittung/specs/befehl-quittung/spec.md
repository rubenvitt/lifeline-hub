# Spec Delta

## Purpose

Legt fest, wie die Empfänger im Verteiler eines freigegebenen Einsatzbefehls den Empfang
quittieren: an welcher Fassung, durch wen, wie die Quittung zurückgenommen wird, was im ETB
steht und wie Liste und Detail den Stand zeigen.

## ADDED Requirements

### Requirement: Jeder Verteiler-Eintrag eines freigegebenen Befehls ist quittierbar
Jeder Eintrag im Verteiler eines freigegebenen Einsatzbefehls SHALL einzeln quittiert werden
können. „Quittieren“ heißt „Empfang bestätigt“. Die Quittung MUST Zeitpunkt und quittierende
Person festhalten, und die Anzeige des Befehls MUST je Eintrag den Zeitpunkt der Quittung tragen.
Quittieren darf jede Person mit Schreibrecht im Einsatz und Zugriff auf das Modul
„Aufträge/Befehle“, an einem aktiven Einsatz. Ein Entwurf MUST mit 422 ablehnen. Ein Eintrag,
der nicht zu diesem Befehl gehört, oder ein Befehl eines anderen Einsatzes MUST 404 ergeben.
Ein schon quittierter Eintrag MUST beim erneuten Quittieren unverändert bleiben, mit Zeitpunkt
und Person der ersten Quittung, und die Antwort ist trotzdem erfolgreich.

#### Scenario: Empfang quittieren
- **WHEN** der freigegebene Befehl „Brandbekämpfung Halle 3“ den Verteiler „EA Süd, S3 Einsatz“ trägt und jemand „EA Süd“ quittiert
- **THEN** trägt „EA Süd“ den Zeitpunkt der Quittung, und „S3 Einsatz“ bleibt offen

#### Scenario: Entwurf
- **WHEN** jemand einen Eintrag im Verteiler eines Befehlsentwurfs quittieren will
- **THEN** antwortet der Server mit 422, und der Eintrag bleibt offen

#### Scenario: Doppelt quittiert
- **WHEN** zwei Personen kurz nacheinander „EA Süd“ quittieren
- **THEN** behält „EA Süd“ Zeitpunkt und Person der ersten Quittung, und beide Antworten sind erfolgreich

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht im Einsatz quittieren will
- **THEN** antwortet der Server mit 403

### Requirement: Nur die jüngste freigegebene Fassung ist quittierbar
Eine freigegebene Fassung SHALL quittierbar sein, solange keine andere Fassung derselben Kette
(alle Fassungen, die über das Fortschreiben zusammenhängen) später freigegeben wurde. Ist eine
spätere Fassung freigegeben, MUST der Server Quittieren und Zurücknehmen an der älteren Fassung
mit 422 ablehnen, und ihre Quittungen MUST unverändert bleiben. Die Anzeige
eines Befehls in Liste und Detail MUST sagen, ob er quittierbar ist.

#### Scenario: Nachfolgerin im Entwurf
- **WHEN** Fassung 1 freigegeben und Fassung 2 noch Entwurf ist
- **THEN** ist Fassung 1 quittierbar

#### Scenario: Nachfolgerin freigegeben
- **WHEN** Fassung 2 freigegeben ist und jemand einen Eintrag von Fassung 1 quittieren will
- **THEN** antwortet der Server mit 422, und Fassung 1 trägt weiter die Quittungen, die sie vorher hatte

#### Scenario: Überholte Fassung noch einmal fortgeschrieben
- **WHEN** Fassung 2 freigegeben ist und jemand Fassung 1 noch einmal fortschreibt und diese neue Fassung freigibt
- **THEN** ist nur die zuletzt freigegebene Fassung quittierbar, Fassung 2 nicht mehr

#### Scenario: Neue Fassung beginnt offen
- **WHEN** in Fassung 1 alle Empfänger quittiert haben und Fassung 2 freigegeben wird
- **THEN** sind alle Empfänger von Fassung 2 offen

### Requirement: Die Quittung ist zurücknehmbar
Eine Quittung SHALL zurückgenommen werden können, mit denselben Rechten und an derselben Fassung,
an der sie quittiert werden kann. Danach MUST der Eintrag wieder offen sein, ohne Zeitpunkt und
Person. Die Rücknahme an einem offenen Eintrag MUST nichts ändern und ist trotzdem erfolgreich.

#### Scenario: Zurücknehmen
- **WHEN** „EA Süd“ quittiert hat und jemand die Quittung zurücknimmt
- **THEN** ist „EA Süd“ wieder offen

#### Scenario: Offener Eintrag
- **WHEN** jemand die Quittung von „S3 Einsatz“ zurücknimmt, der nie quittiert hat
- **THEN** bleibt „S3 Einsatz“ offen, und es entsteht kein ETB-Eintrag

### Requirement: Quittung und Rücknahme stehen im ETB
Jede Quittung, die einen Eintrag von offen auf quittiert setzt, SHALL einen ETB-Eintrag vom Typ
System mit dem Inhalt „Empfang quittiert: Einsatzbefehl v<Fassung> (ETB <Nr.>)“ schreiben. Dabei
ist <Nr.> die laufende Nummer des ETB-Eintrags, mit dem die Fassung freigegeben wurde. Sein `von`
ist der Anzeigename des Empfängers, `an` ist „System“. Jede Rücknahme, die eine Quittung aufhebt,
SHALL entsprechend einen ETB-Eintrag „Quittung zurückgenommen: Einsatzbefehl v<Fassung> (ETB <Nr.>)“
mit demselben `von` schreiben. Der Titel des Befehls MUST NOT im Inhalt stehen: er ist ein
Dokumenttitel, den die Schwärzung entfernt (Spec `aufbewahrung`, „Ausnahmeliste wird nicht
länger“). Quittung bzw. Rücknahme und ETB-Eintrag MUST ganz oder gar nicht gelingen. Ein Aufruf,
der nichts ändert, MUST keinen ETB-Eintrag schreiben.

#### Scenario: ETB nach Quittung
- **WHEN** „EA Süd“ Fassung 2 eines Befehls quittiert, die mit ETB-Eintrag 17 freigegeben wurde
- **THEN** steht im ETB ein Systemeintrag „Empfang quittiert: Einsatzbefehl v2 (ETB 17)“ mit `von` „EA Süd“

#### Scenario: ETB nach Rücknahme
- **WHEN** die Quittung von „EA Süd“ zurückgenommen wird
- **THEN** steht im ETB zusätzlich „Quittung zurückgenommen: Einsatzbefehl v2 (ETB 17)“ mit `von` „EA Süd“, und der Eintrag der Quittung bleibt stehen

### Requirement: Quittung und Rücknahme sind live
Nach Quittung und Rücknahme SHALL das Live-Ereignis des Befehls mit seiner id gehen, ohne den
Vermerk „nur Inhalt“, damit Liste und Detail in anderen Tabs nachziehen. Der neue ETB-Eintrag
MUST wie jeder andere live erscheinen.

#### Scenario: Zweiter Tab
- **WHEN** in Tab A „EA Süd“ quittiert wird und Tab B die Liste der Einsatzbefehle zeigt
- **THEN** zählt die Karte des Befehls in Tab B eine Quittung mehr, ohne Neuladen

### Requirement: Quittieren im Detail mit Rückgängig
Das Detail eines quittierbaren Befehls SHALL je offenem Verteiler-Eintrag den Knopf „Quittieren“
tragen, nur mit Schreibrecht. Ein Klick MUST ohne Rückfrage quittieren und danach einen Hinweis
„Empfang quittiert“ mit „Rückgängig“ zeigen. „Rückgängig“ MUST die Quittung zurücknehmen. Der
zugängliche Name des Knopfs MUST den Empfänger nennen. Lehnt der Server ab, MUST der Grund am
Verteiler im Detail stehen, nicht als Toast. Ein nicht mehr quittierbarer Befehl MUST seine offenen
Empfänger ohne Knopf zeigen.

#### Scenario: Quittieren und rückgängig
- **WHEN** im Detail „Quittieren“ bei „EA Süd“ gewählt und im Hinweis „Rückgängig“ bedient wird
- **THEN** steht „EA Süd“ wieder unter den offenen Empfängern

#### Scenario: Überholte Fassung
- **WHEN** das Detail von Fassung 1 geöffnet wird, nachdem Fassung 2 freigegeben ist
- **THEN** stehen die offenen Empfänger von Fassung 1 ohne Knopf „Quittieren“ da

#### Scenario: Beobachter
- **WHEN** eine Person ohne Schreibrecht das Detail eines freigegebenen Befehls öffnet
- **THEN** sieht sie Verteiler und Quittungsstand, aber keinen Knopf „Quittieren“
