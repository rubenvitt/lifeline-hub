# Spec Delta

## Purpose

Jeder neue ETB-Eintrag trägt einen Absender (Von) und einen Empfänger (An). Ein
Standard-Rufname je Person belegt beide vor, damit die Pflicht beim Schreiben keinen Handgriff
kostet, und Einträge, die das System selbst schreibt, bekommen eine feste Kennung.

## ADDED Requirements

### Requirement: Standard-Rufname je Person
Das System SHALL je Person einen Standard-Absender und einen Standard-Empfänger speichern. Der
Wert MUST an der Person hängen, nicht am Einsatz und nicht am Gerät, und MUST nach einer
Anmeldung an einem anderen Gerät derselbe sein. Eine Person MUST nur ihren eigenen Standard
lesen und ändern können.

#### Scenario: Geräteübergreifend
- **WHEN** eine Person an Gerät A den Standard „ELW 1“ für Von und An setzt und sich danach an
  Gerät B anmeldet
- **THEN** belegt das ETB an Gerät B Von und An mit „ELW 1“ vor

#### Scenario: Zwei Personen
- **WHEN** Person A den Standard „ELW 1“ und Person B den Standard „Florian Stadt 1/11-1“ hat
- **THEN** sieht jede in ihrer Erfassung nur ihren eigenen Standard

#### Scenario: Unterschiedliche Seiten
- **WHEN** eine Person „ELW 1“ als Absender und „Einsatzleitung“ als Empfänger festlegt
- **THEN** belegt ein neuer Eintrag Von mit „ELW 1“ und An mit „Einsatzleitung“ vor

### Requirement: Abfrage und Änderung in der Erfassung
Wer im ETB eines laufenden Einsatzes schreiben darf und keinen Standard hat, SHALL in der
Erfassung nach dem Rufnamen gefragt werden. Die Abfrage MUST das Lesen des ETB nicht
blockieren. Ist ein Standard gesetzt, SHALL er in der Erfassung sichtbar stehen und dort
änderbar sein. Die Auswahl MUST Funkrufnamen und Sachgebiete vorschlagen und Freitext erlauben;
„Empfänger wie Absender“ MUST wählbar und die Vorgabe sein.

#### Scenario: Erster Besuch
- **WHEN** eine Person ohne Standard das ETB eines laufenden Einsatzes mit Schreibrecht öffnet
- **THEN** fragt die Erfassung nach ihrem Rufnamen, und die Zeitachse bleibt lesbar und
  bedienbar

#### Scenario: Beobachter wird nicht gefragt
- **WHEN** eine Person ohne Schreibrecht das ETB öffnet
- **THEN** erscheint keine Abfrage

#### Scenario: Empfänger wie Absender
- **WHEN** eine Person in der Abfrage „ELW 1“ wählt und „Empfänger wie Absender“ gewählt lässt
- **THEN** ist „ELW 1“ ihr Standard für Von und An

#### Scenario: Freitext
- **WHEN** eine Person in der Abfrage „Abschnitt Nord“ tippt, das in keinem Vorschlag steht
- **THEN** wird „Abschnitt Nord“ als Standard übernommen

#### Scenario: Ändern
- **WHEN** eine Person mit dem Standard „ELW 1“ in der Erfassung ihren Standard auf „ELW 2“
  ändert
- **THEN** belegen neue Einträge Von und An mit „ELW 2“ vor

### Requirement: Vorbelegung neuer Einträge
Ein neuer Eintrag SHALL Von und An aus dem Standard übernehmen und beide als Chips in der
Erfassung zeigen. Ein ausdrücklich gesetztes Von oder An, auch per `@Funkrufname`, MUST den
Standard nur für diesen Eintrag ersetzen. `@` MUST bei einer Anordnung An und sonst Von setzen;
die andere Seite MUST den Standard behalten. Eine Berichtigung SHALL ebenso vorbelegt werden.

#### Scenario: Ohne Angabe
- **WHEN** eine Person mit dem Standard „ELW 1“ „Lage ruhig“ erfasst, ohne Von oder An zu
  setzen
- **THEN** wird der Eintrag mit Von „ELW 1“ und An „ELW 1“ gespeichert

#### Scenario: Meldung mit @
- **WHEN** eine Person mit dem Standard „ELW 1“ eine Meldung mit `@Florian 1` erfasst
- **THEN** wird sie mit Von „Florian 1“ und An „ELW 1“ gespeichert

#### Scenario: Anordnung mit @
- **WHEN** eine Person mit dem Standard „ELW 1“ eine Anordnung mit `@EA-Süd` erfasst
- **THEN** wird sie mit Von „ELW 1“ und An „EA-Süd“ gespeichert

#### Scenario: Nur für diesen Eintrag
- **WHEN** eine Person mit dem Standard „ELW 1“ einen Eintrag mit `/von S2` erfasst und danach
  einen zweiten ohne Angabe
- **THEN** trägt der zweite Eintrag Von „ELW 1“

#### Scenario: Entwurf ohne Von/An
- **WHEN** eine Person einen Entwurf ohne gesetztes Von/An liegen lässt und danach ihren
  Standard ändert
- **THEN** zeigt der Entwurf den neuen Standard und wird mit ihm gespeichert

### Requirement: Pflicht im Client
Die Erfassung MUST einen Eintrag ohne Von oder An nicht absenden. Sie SHALL sagen, welches Feld
fehlt, und Text, Felder und Anhänge des Eintrags stehen lassen. Ein Entwurf MUST ohne Von und
An gespeichert werden können.

#### Scenario: Kein Standard, kein Von
- **WHEN** eine Person ohne Standard „Lage ruhig“ mit `/an ELW 1`, aber ohne Von absenden will
- **THEN** wird nichts gesendet, die Erfassung nennt das fehlende Von, und der Text bleibt stehen

#### Scenario: Entwurf bleibt
- **WHEN** eine Person ohne Standard einen Text tippt und die Seite neu lädt
- **THEN** steht der Entwurf mit seinem Text wieder da

### Requirement: Pflicht im Server
`POST /api/einsaetze/{id}/etb` MUST einen Eintrag ohne `von` oder ohne `an` mit 400 ablehnen
und nichts anlegen. Ein Wert aus Leerzeichen MUST als fehlend gelten. Die Pflicht MUST für jeden
Typ gelten, den ein Client erfassen kann, auch für die Berichtigung.

#### Scenario: Ohne An
- **WHEN** ein Client einen Eintrag mit `von` „ELW 1“ und ohne `an` sendet
- **THEN** antwortet der Server mit 400, und das ETB ist unverändert

#### Scenario: Leerzeichen
- **WHEN** ein Client einen Eintrag mit `von` „  “ sendet
- **THEN** antwortet der Server mit 400

#### Scenario: Berichtigung
- **WHEN** ein Client eine Berichtigung ohne `von` sendet
- **THEN** antwortet der Server mit 400

### Requirement: Von und An der Systemeinträge
Ein ETB-Eintrag, den das System aus einem anderen Modul schreibt, SHALL Von und An tragen. Was
das Modul selbst an Absender oder Empfänger kennt, MUST übernommen werden; eine fehlende Seite
MUST die feste Kennung „System“ tragen. Wer die Aktion ausgelöst hat, bleibt über den Erfasser
und dessen Funktion am Eintrag erkennbar.

#### Scenario: Auftrag
- **WHEN** jemand einen Auftrag an „EA-Süd“ erteilt und dabei ein ETB-Eintrag entsteht
- **THEN** trägt der Eintrag Von „System“ und An „EA-Süd“

#### Scenario: Ohne bekannte Seite
- **WHEN** jemand eine Ablösung vollzieht und dabei ein ETB-Eintrag entsteht
- **THEN** trägt der Eintrag Von „System“ und An „System“

#### Scenario: Demo-Import
- **WHEN** ein Demo-Szenario importiert wird
- **THEN** hat jeder dabei entstandene ETB-Eintrag ein nicht leeres Von und An

### Requirement: Bestand bleibt
Einträge, die vor dieser Regel entstanden sind, MUST unverändert bleiben, auch ohne Von oder
An. Eine Änderung am Standard MUST NOT auf gespeicherte Einträge wirken.

#### Scenario: Altbestand
- **WHEN** ein Einsatz einen Eintrag ohne Von aus der Zeit vor dieser Regel enthält
- **THEN** zeigt das ETB ihn unverändert ohne Von

#### Scenario: Standard geändert
- **WHEN** eine Person ihren Standard von „ELW 1“ auf „ELW 2“ ändert
- **THEN** tragen ihre schon gespeicherten Einträge weiter „ELW 1“
