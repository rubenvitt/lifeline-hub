# aenderungsvermerk Specification

## Purpose
Hält je Einzelangabe von Einheit, Einsatzkopf und eigener Führungsstelle fest, wer sie zuletzt
geändert hat und wann, und zeigt das in den Ansichten, damit mehrere Arbeitsplätze fremde
Änderungen erkennen (LLH-1834).

## Requirements

### Requirement: Vermerk je Angabe bei jedem Schreiben
Ändert ein Schreibweg den gespeicherten Wert einer Angabe von Einheit, Einsatzkopf oder eigener
Führungsstelle, SHALL das System für genau diese Angabe Zeitpunkt und Benutzer der Änderung
festhalten, im selben Schreibvorgang. Das gilt mit und ohne mitgesendeten Altwert. Eine
Anfrage, die den Wert nicht ändert, MUST den Vermerk unverändert lassen. Ein abgelehntes
Schreiben MUST keinen Vermerk setzen.

#### Scenario: Leitstellen-Nr. gespeichert
- **WHEN** A an Einsatzdaten die Leitstellen-Nr. auf `ILS-4711` setzt
- **THEN** trägt die Angabe Leitstellen-Nr. den Vermerk mit A und dem Zeitpunkt des Speicherns, die übrigen Angaben behalten ihren Vermerk

#### Scenario: Gleicher Wert erneut gesendet
- **WHEN** ein Aufruf die Bemerkung einer Einheit mit ihrem schon gespeicherten Text sendet
- **THEN** bleibt der Vermerk der Bemerkung unverändert

#### Scenario: Führer entlassen
- **WHEN** B eine Person entlässt, die eine Einheit führt
- **THEN** trägt die Angabe Führer dieser Einheit den Vermerk mit B

#### Scenario: Konflikt setzt keinen Vermerk
- **WHEN** ein Speichern mit veraltetem Altwert mit 409 abgelehnt wird
- **THEN** trägt die Angabe weiter den Vermerk der Änderung, die den Konflikt ausgelöst hat

### Requirement: Vermerk kommt mit dem Datensatz
Einsatz, Einheit und eigene Führungsstelle SHALL ihre Vermerke beim Lesen mitliefern, je Angabe
mit Zeitpunkt und Anzeigename des Benutzers. Lesen darf sie, wer den Datensatz lesen darf; einen
eigenen Lesezugriff MUST es nicht geben. Eine Angabe ohne Änderung seit dem Anlegen MUST ohne
Vermerk geliefert werden. Ändert sich ein Vermerk, MUST die Änderung jeden Schirm über die
bestehende Live-Verteilung des Datensatzes erreichen.

#### Scenario: Frisch angelegte Einheit
- **WHEN** eine Einheit angelegt und noch keine Angabe geändert ist
- **THEN** liefert die Einheit keine Vermerke

#### Scenario: Zweiter Arbeitsplatz sieht die Änderung
- **WHEN** A den Funkrufnamen einer Einheit ändert, während B die Ansicht dieser Einheit offen hat
- **THEN** zeigt B's Ansicht danach den neuen Funkrufnamen und den Vermerk mit A, ohne Neuladen

### Requirement: Vermerk an der Zeile und im Paneelkopf
Die Ansichten Einheit und Einsatzdaten SHALL an jeder Angabe mit Vermerk dezent zeigen, wer sie
wann zuletzt geändert hat („Geändert von <Name>, <Zeit>“). Der Kopf eines Paneels MUST die jüngste
Änderung seiner Angaben nennen. Ein Vermerk MUST NOT die Bearbeitung sperren oder den Wert
verdecken.

#### Scenario: Paneel Einsatz
- **WHEN** im Paneel „Einsatz“ der Einsatzdaten zuletzt B die Leitstellen-Nr. um 14:05 geändert hat
- **THEN** nennt der Paneelkopf „Zuletzt geändert von B, 14:05“, und die Zeile Leitstellen-Nr. trägt denselben Vermerk

#### Scenario: Angabe in der Kopfleiste
- **WHEN** B das Einsatzstichwort um 14:05 geändert hat
- **THEN** steht unter dem Stichwort in der Kopfleiste „Geändert von B, 14:05“

#### Scenario: Ohne Vermerk
- **WHEN** an einem Paneel keine Angabe seit dem Anlegen geändert wurde
- **THEN** nennt der Paneelkopf keinen Vermerk

### Requirement: Kein ETB-Eintrag aus dem Vermerk
Der Änderungsvermerk SHALL das ETB nicht berühren: eine Feldänderung an Einheit, Einsatzkopf oder
Führungsstelle MUST NOT allein deshalb einen ETB-Eintrag erzeugen. Bestehende System-Einträge
(Führerwechsel, Abschnittswechsel, Sprechgruppen, Übergabe der Einsatzleitung) bleiben
unverändert.

#### Scenario: Bemerkung geändert
- **WHEN** A die Bemerkung einer Einheit ändert
- **THEN** entsteht ein Vermerk an der Bemerkung und kein ETB-Eintrag

### Requirement: Vermerk folgt Spiegel und Aufbewahrung
Vermerke SHALL wie die übrigen Daten des Einsatzes gespiegelt und gelöscht werden: ein Spiegel
zeigt die Vermerke des Führers, und das Löschen des Einsatzes oder der Einheit löscht ihre
Vermerke. In der Schwärzung gilt der Benutzer des Vermerks wie jeder andere Benutzerverweis am
Einsatz.

#### Scenario: Einsatz gelöscht
- **WHEN** ein Einsatz nach Ablauf der Aufbewahrung gelöscht wird
- **THEN** bleibt kein Vermerk dieses Einsatzes zurück

#### Scenario: Spiegel
- **WHEN** am Führer die Leitstellen-Nr. geändert wird und der Spiegel den Stand übernimmt
- **THEN** zeigt der Spiegel an der Leitstellen-Nr. den Vermerk des Führers
