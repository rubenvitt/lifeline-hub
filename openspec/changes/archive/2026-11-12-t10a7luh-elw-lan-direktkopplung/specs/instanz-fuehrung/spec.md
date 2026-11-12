# Spec Delta

## ADDED Requirements

### Requirement: Über eine Direktkopplung wechselt die Führung nicht

Eine Instanz MUST die Führung eines Einsatzes nicht an die Gegenstelle einer Direktkopplung
übergeben, nicht bei ihr anfragen, nicht gegen sie notübernehmen und keinen Abgabecode für sie
erzeugen. Die Oberfläche MUST diese Bedienungen für eine solche Gegenstelle nicht anbieten und
den Grund zeigen; ein direkter Aufruf MUST mit 409 enden. Die Akten MUST weiter ausgetauscht und
angezeigt werden.

#### Scenario: Übergabe an ELW vor Ort
- **WHEN** die Einsatzleitung an ELW 1 im Paneel „Führung“ das Ziel für eine Übergabe wählt und ELW 2 nur über eine Direktkopplung gekoppelt ist
- **THEN** fehlt ELW 2 in der Auswahl, und das Paneel zeigt „ELW 2 ist vor Ort gekoppelt: Führungswechsel dorthin kommt später“

#### Scenario: Notübernahme per Route
- **WHEN** ein Admin an ELW 2 die Route der Notübernahme für einen Einsatz aufruft, den ELW 1 führt und den ELW 2 nur über die Direktkopplung kennt
- **THEN** antwortet der Server mit 409, und die Führung bleibt bei ELW 1

#### Scenario: Einsätze beim Gegenüber
- **WHEN** ELW 1 einen Einsatz der zugeordneten Org führt und ELW 2 sich als Direktkopplung meldet
- **THEN** zeigt ELW 2 unter „Einsätze beim Gegenüber“ den Einsatz mit „Führung: ELW 1“

### Requirement: Eine Direktkopplung nimmt keinen Führungswechsel zwischen ihren Seiten an

Erhält eine Instanz über eine Direktkopplung eine Akte, die die Führung von der einen Seite dieser
Kopplung auf die andere legt, MUST sie die Akte verwerfen, gleich in welcher Richtung die
Kopplung läuft, weiter nach ihrer bisherigen Akte verfahren und an der Kopplung einen Hinweis
zeigen.

#### Scenario: Gegenstelle beansprucht die Führung
- **WHEN** ELW 1 einen Einsatz führt und ELW 2 über die Direktkopplung eine Akte mit höherer Epoche und sich als Führer meldet
- **THEN** führt ELW 1 weiter, und die Kopplung an ELW 1 zeigt „ELW 2 beansprucht die Führung von „<Einsatz>“ über eine Direktkopplung: abgelehnt“

### Requirement: Eine Abgabe des Führers an eine dritte Instanz gilt auch vor Ort

Erhält eine Instanz über eine Direktkopplung von der Gegenstelle, die einen Einsatz bisher
führte, eine Akte mit höherer Epoche, die eine dritte Instanz als Führer nennt, SHALL sie diese
Akte annehmen, gleich in welcher Richtung die Kopplung läuft. Ihr Spiegel MUST danach der neuen
führenden Instanz folgen oder, wenn diese hier nicht gekoppelt ist, als „Abgleich beendet“
stehen bleiben.

#### Scenario: ELW übergibt an den Hub
- **WHEN** ELW 1 einen Einsatz an den Hub übergibt und ELW 2 diesen Einsatz über die Direktkopplung von ELW 1 spiegelt und selbst beim Hub gekoppelt ist
- **THEN** zeigt ELW 2 „Führung: Hub“ und spiegelt den Einsatz danach vom Hub

#### Scenario: Neuer Führer hier nicht gekoppelt
- **WHEN** ELW 1 einen Einsatz an den Hub übergibt und ELW 2 nur mit ELW 1 gekoppelt ist
- **THEN** zeigt ELW 2 „Führung: Hub“ und den Spiegel mit „Die führende Instanz ist hier nicht gekoppelt.“

### Requirement: Verwahrung nur über eine Standardkopplung

Eine Instanz MUST einen abgeschlossenen Einsatz nur über eine Standardkopplung zur Verwahrung
anbieten. Über eine Direktkopplung MUST keine Verwahrung angeboten oder angenommen werden.

#### Scenario: Nachbereitung abgelaufen, ELW mit Hub und vor Ort
- **WHEN** die Nachbereitungsfrist eines Einsatzes an ELW 2 abläuft und ELW 2 beim Hub und als Direktkopplung bei ELW 1 gekoppelt ist
- **THEN** bietet ELW 2 den Einsatz nur dem Hub zur Verwahrung an

#### Scenario: Nur vor Ort gekoppelt
- **WHEN** die Nachbereitungsfrist eines Einsatzes an ELW 2 abläuft und ELW 2 nur als Direktkopplung bei ELW 1 gekoppelt ist
- **THEN** bietet ELW 2 den Einsatz niemandem zur Verwahrung an, und ELW 1 macht aus seinem Spiegel keinen eigenen Einsatz
