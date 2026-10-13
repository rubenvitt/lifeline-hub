# fernmeldewesen Specification

## Purpose
Das Einsatzmodul Fernmeldewesen bündelt die Werkzeuge des Sachgebiets S6 (Funkplan,
Fernmeldeskizze, Sprechgruppen, Kommunikationsplan) mit eigener Freigabe, damit eine Führung ohne
Stab funken, Sprechgruppen planen und einen Kommunikationsplan pflegen kann. Die Inhalte der
Werkzeuge regeln `stab-funkplan`, `stab-fernmeldeskizze`, `stab-fernmeldeskizze-bearbeitung` und
`stab-kommunikationsplan`; diese Fähigkeit regelt die Hülle.

## Requirements

### Requirement: Eigenes Modul in der Kategorie Kommunikation
Das System SHALL ein Einsatzmodul mit dem Schlüssel `fernmeldewesen`, dem Namen „Fernmeldewesen“,
der Beschreibung „Funkplan, Skizze, Kommunikationsplan“ und der Kategorie Kommunikation führen, in
der Kategorie nach den bestehenden Modulen. Es SHALL wie jedes Fachmodul je Einsatz und je
Organisation ausblendbar und auf eine Rolle beschränkbar sein.

#### Scenario: Menüeintrag
- **WHEN** eine Person mit Freigabe des Fernmeldewesens die Kategorie Kommunikation öffnet
- **THEN** steht dort „Fernmeldewesen“ mit der Zeile „Funkplan, Skizze, Kommunikationsplan“

#### Scenario: Palette findet das Modul über Funk
- **WHEN** jemand mit Freigabe des Fernmeldewesens im Einsatz „Funk“ in die Sprungpalette tippt
- **THEN** steht „Fernmeldewesen“ unter den Modulen, und ↵ öffnet den Funkplan

### Requirement: Freigabe unabhängig vom Stab
Die Freigabe des Fernmeldewesens MUST allein nach den Regeln der Fähigkeit `modul-freigabe` gelten.
Ist der Stab ausgeblendet oder gesperrt, bleibt das Fernmeldewesen nach seiner eigenen Freigabe
nutzbar, und eine Stab-Freigabe öffnet ein gesperrtes Fernmeldewesen nicht.

#### Scenario: Stab ausgeblendet
- **WHEN** der Einsatz den Stab ausblendet und das Fernmeldewesen nicht
- **THEN** zeigt das Modulmenü „Fernmeldewesen“ in der Kategorie Kommunikation, und Funkplan,
  Fernmeldeskizze, Sprechgruppen und Kommunikationsplan sind lesbar und für Berechtigte bearbeitbar

#### Scenario: Fernmeldewesen gesperrt, Stab frei
- **WHEN** das Fernmeldewesen auf Führungskräfte beschränkt ist und ein normales Mitglied mit
  Stab-Leserecht `/einsaetze/:id/fernmeldewesen` aufruft
- **THEN** zeigt der Rahmen den einheitlichen Hinweis für „Fernmeldewesen“

### Requirement: Modulseite mit vier Reitern
Die Modulseite SHALL im h1 „Fernmeldewesen“ tragen und darunter die Reiter „Funkplan“,
„Fernmeldeskizze“, „Sprechgruppen“ und „Kommunikationsplan“ in dieser Reihenfolge. Die Modulroute
`/einsaetze/:id/fernmeldewesen` SHALL den Funkplan zeigen, `?ansicht=skizze` bzw.
`?ansicht=sprechgruppen` die jeweilige Darstellung und
`/einsaetze/:id/fernmeldewesen/kommunikationsplan` den Kommunikationsplan.

#### Scenario: Reiter wechseln
- **WHEN** eine Person im Reiter „Funkplan“ auf „Kommunikationsplan“ tippt
- **THEN** zeigt die Seite den Kommunikationsplan unter `…/fernmeldewesen/kommunikationsplan`, und
  das h1 bleibt „Fernmeldewesen“

#### Scenario: Handy
- **WHEN** eine Person bei 390 px Breite das Modul öffnet
- **THEN** stehen die vier Reiter ohne waagerechten Überlauf der Seite

### Requirement: Alte Adressen leiten dauerhaft um
Die alten Adressen `/einsaetze/:id/stab/funkplan` (mit und ohne `?ansicht=`) und
`/einsaetze/:id/stab/kommunikationsplan` MUST dauerhaft auf die neuen umleiten, mit erhaltener
Sichtvorgabe, ohne zusätzlichen Eintrag im Browserverlauf und nach der Freigabe des
Fernmeldewesens, nicht der des Stabs. Jeder Verweis der Anwendung auf diese Werkzeuge MUST die
neuen Adressen nennen.

#### Scenario: Alte Skizzen-Adresse
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=skizze` aufruft
- **THEN** zeigt die App das Modul Fernmeldewesen mit dem Reiter „Fernmeldeskizze“, und „Zurück“
  im Browser führt nicht erneut auf die alte Adresse

#### Scenario: Alte Adresse bei ausgeblendetem Stab
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Person `/einsaetze/:id/stab/kommunikationsplan`
  aufruft
- **THEN** zeigt die App den Kommunikationsplan im Modul Fernmeldewesen, nicht den Hinweis „Stab
  ausgeblendet“

### Requirement: Bestehende Schnittstellen gehören dem Fernmeldewesen
Die Endpunkte unter `/api/einsaetze/{id}/stab/kommunikationsplan` und
`/api/einsaetze/{id}/stab/fernmeldeskizze` SHALL ihre Adressen behalten und MUST Lesen und Schreiben
an der Freigabe und den Rechten des Moduls Fernmeldewesen prüfen, nicht an denen des Stabs. Ist das
Fernmeldewesen ausgeblendet oder für die Rolle gesperrt, MUST der Server mit 403 antworten, ein
fremder oder unbekannter Einsatz mit 404. Alle übrigen Endpunkte unter `/api/einsaetze/{id}/stab`
SHALL weiter am Stab hängen.

#### Scenario: Stab ausgeblendet, Lesen und Schreiben
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Führungskraft den Kommunikationsplan und
  die Fernmeldeskizze liest und eine Verbindung anlegt
- **THEN** antwortet der Server mit 200 bzw. 201, und `GET /api/einsaetze/{id}/stab` antwortet 403

#### Scenario: Fernmeldewesen ausgeblendet
- **WHEN** das Fernmeldewesen im Einsatz ausgeblendet ist und ein Mitglied ohne Admin-Rechte
  Kommunikationsplan oder Fernmeldeskizze liest oder ändert
- **THEN** antwortet der Server mit 403, und `GET /api/einsaetze/{id}/stab` antwortet weiter 200

#### Scenario: Beobachter
- **WHEN** eine Person mit Leserecht, aber ohne Schreibrecht auf das Fernmeldewesen eine Komponente
  der Skizze anlegen will
- **THEN** antwortet der Server mit 403, und nichts wird gespeichert

### Requirement: Freigaben übernehmen nur die Rolle des Stabs
Bei der Einführung des Moduls MUST das System jede Rollen-Vorgabe, die für den Stab gilt, je
Einsatz und je Organisation auf das Fernmeldewesen übertragen. Eine Ausblendung des Stabs MUST NOT
übertragen werden. Ohne Vorgabe für den Stab MUST für das Fernmeldewesen keine entstehen.

#### Scenario: Stab auf eine Rolle beschränkt
- **WHEN** ein Einsatz vor der Einführung den Stab auf Führungskräfte beschränkt hat
- **THEN** ist danach auch das Fernmeldewesen dieses Einsatzes auf Führungskräfte beschränkt und
  sichtbar

#### Scenario: Stab ausgeblendet
- **WHEN** ein Einsatz vor der Einführung den Stab ausgeblendet hat, ohne Rolle
- **THEN** ist danach das Fernmeldewesen dieses Einsatzes sichtbar und frei, und der Stab bleibt
  ausgeblendet

#### Scenario: Vorgabe der Organisation
- **WHEN** eine Organisation vor der Einführung den Stab für alle Einsätze auf Führungskräfte
  beschränkt hat
- **THEN** gilt dieselbe Beschränkung danach für das Fernmeldewesen ihrer Einsätze

### Requirement: Live-Verteilung mit dem Gate des Fernmeldewesens
Jede Änderung an Kommunikationsplan oder Fernmeldeskizze SHALL ein Live-Ereignis `fernmeldewesen`
verteilen, das nur Personen mit Freigabe des Fernmeldewesens erreicht. Sie MUST NOT das Ereignis
`stab` auslösen. Änderungen an Besetzung und Checkliste des Stabs MUST NOT `fernmeldewesen`
auslösen.

#### Scenario: Verbindung angelegt
- **WHEN** eine Verbindung im Kommunikationsplan angelegt wird
- **THEN** erhalten Personen mit Freigabe des Fernmeldewesens `fernmeldewesen`, und niemand erhält
  dafür `stab` oder einen ETB-Eintrag

#### Scenario: Leser nur des Stabs
- **WHEN** eine Person den Stab, aber nicht das Fernmeldewesen lesen darf und die Skizze geändert
  wird
- **THEN** erhält sie kein Ereignis

### Requirement: Stab-Daten im Fernmeldewesen haben eine eigene Weiche
Was das Fernmeldewesen aus dem Stab zeigt, SHALL es nur bei Freigabe des Stabs abrufen: die
Besetzung als Nebentext im Kommunikationsplan und die besetzten Sachgebiete im Kasten
„Einsatzleitung“ der Fernmeldeskizze. Ohne Stab-Freigabe MUST an dieser Stelle „—“ bzw. die
benannte Lücke mit dem Grund stehen, und das Übrige MUST vollständig bleiben. Die Seite MUST NOT
deshalb als Ganzes gesperrt sein.

#### Scenario: Ohne Stab
- **WHEN** der Stab ausgeblendet ist und eine Person den Kommunikationsplan öffnet
- **THEN** zeigen die Zeilen der Führungsfunktionen ihre Verbindungen und als Besetzung „—“ mit
  Grund, und es geht keine Anfrage an den Stab

### Requirement: Abnehmer folgen der Freigabe des Fernmeldewesens
Wer Daten des Fernmeldewesens anderswo nutzt, SHALL die Freigabe des Fernmeldewesens prüfen, nicht
die des Stabs:
- „Fernmeldeskizze anfügen“ an Dokumenten,
- die Funkplan-Lücken und den Kommunikationsplan in der Lagebericht-Übernahme „Führungsprobleme“,
- die Offline-Lesbarkeit des Kommunikationsplans.

Ist das Fernmeldewesen nicht frei, MUST die Aktion fehlen bzw. die Quelle mit Grund als fehlend
benannt sein.

#### Scenario: Skizze anfügen ohne Stab
- **WHEN** der Stab ausgeblendet ist und eine Person mit Freigabe des Fernmeldewesens an einem
  Lagebericht „Fernmeldeskizze anfügen“ wählt
- **THEN** wird die Skizze angefügt

#### Scenario: Führungsprobleme ohne Stab
- **WHEN** der Stab ausgeblendet ist und die Übernahme „Führungsprobleme“ läuft
- **THEN** enthält sie die Funkplan-Lücken und die Lücken des Kommunikationsplans

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Fernmeldewesen für die Person gesperrt ist, der Stab nicht
- **THEN** fehlt „Fernmeldeskizze anfügen“, und die Übernahme „Führungsprobleme“ nennt Funkplan und
  Kommunikationsplan als nicht freigegeben

### Requirement: Einstiege von der Stab-Seite erben die Sperre ihres Ziels
Die S6-Zeile der Stab-Seite SHALL Funkplan, Fernmeldeskizze und Kommunikationsplan als Sprünge in
das Modul Fernmeldewesen führen. Ist das Fernmeldewesen für die Person gesperrt, MUST jeder dieser
Sprünge gesperrt erscheinen und den Grund nennen; ist es ausgeblendet, MUST er fehlen.

#### Scenario: Sprung gesperrt
- **WHEN** eine Person den Stab öffnen darf, das Fernmeldewesen aber nicht
- **THEN** stehen die S6-Sprünge gesperrt mit Grund, und ein Klick springt nicht
