# fernmeldewesen Specification

## Purpose
Das Einsatzmodul Fernmeldewesen bündelt die Werkzeuge des Sachgebiets S6 (Funkplan,
Fernmeldeskizze, Sprechgruppen, Kommunikationsplan) mit eigener Freigabe, damit eine Führung
funken, Sprechgruppen planen und einen Kommunikationsplan pflegen kann. Die Inhalte der
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
Fernmeldewesens. Jeder Verweis der Anwendung auf diese Werkzeuge MUST die neuen Adressen nennen.

#### Scenario: Alte Skizzen-Adresse
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=skizze` aufruft
- **THEN** zeigt die App das Modul Fernmeldewesen mit dem Reiter „Fernmeldeskizze“, und „Zurück“
  im Browser führt nicht erneut auf die alte Adresse

#### Scenario: Alte Adresse bei ausgeblendetem Stab
- **WHEN** eine Person mit Freigabe des Fernmeldewesens `/einsaetze/:id/stab/kommunikationsplan`
  aufruft
- **THEN** zeigt die App den Kommunikationsplan im Modul Fernmeldewesen und leitet nicht auf die
  Seite des Einsatzes um

### Requirement: Bestehende Schnittstellen gehören dem Fernmeldewesen
Die Endpunkte unter `/api/einsaetze/{id}/stab/kommunikationsplan` und
`/api/einsaetze/{id}/stab/fernmeldeskizze` SHALL ihre Adressen behalten und MUST Lesen und Schreiben
an der Freigabe und den Rechten des Moduls Fernmeldewesen prüfen. Ist das Fernmeldewesen
ausgeblendet oder für die Rolle gesperrt, MUST der Server mit 403 antworten, ein fremder oder
unbekannter Einsatz mit 404.

#### Scenario: Stab ausgeblendet, Lesen und Schreiben
- **WHEN** eine Führungskraft mit Freigabe des Fernmeldewesens den Kommunikationsplan und die
  Fernmeldeskizze liest und eine Verbindung anlegt
- **THEN** antwortet der Server mit 200 bzw. 201, und `GET /api/einsaetze/{id}/stab` antwortet
  404

#### Scenario: Fernmeldewesen ausgeblendet
- **WHEN** das Fernmeldewesen im Einsatz ausgeblendet ist und ein Mitglied ohne Admin-Rechte
  Kommunikationsplan oder Fernmeldeskizze liest oder ändert
- **THEN** antwortet der Server mit 403

#### Scenario: Beobachter
- **WHEN** eine Person mit Leserecht, aber ohne Schreibrecht auf das Fernmeldewesen eine Komponente
  der Skizze anlegen will
- **THEN** antwortet der Server mit 403, und nichts wird gespeichert

### Requirement: Live-Verteilung mit dem Gate des Fernmeldewesens
Jede Änderung an Kommunikationsplan oder Fernmeldeskizze SHALL ein Live-Ereignis `fernmeldewesen`
verteilen, das nur Personen mit Freigabe des Fernmeldewesens erreicht.

#### Scenario: Verbindung angelegt
- **WHEN** eine Verbindung im Kommunikationsplan angelegt wird
- **THEN** erhalten Personen mit Freigabe des Fernmeldewesens `fernmeldewesen`, und niemand erhält
  dafür einen ETB-Eintrag

#### Scenario: Leser nur des Stabs
- **WHEN** eine Person den Einsatz, aber nicht das Fernmeldewesen lesen darf und die Skizze geändert
  wird
- **THEN** erhält sie kein Ereignis

### Requirement: Abnehmer folgen der Freigabe des Fernmeldewesens
Wer Daten des Fernmeldewesens anderswo nutzt, SHALL die Freigabe des Fernmeldewesens prüfen:
- „Fernmeldeskizze anfügen“ an Dokumenten,
- die Funkplan-Lücken und den Kommunikationsplan in der Lagebericht-Übernahme „Führungsprobleme“,
- die Offline-Lesbarkeit des Kommunikationsplans.

Ist das Fernmeldewesen nicht frei, MUST die Aktion fehlen bzw. die Quelle mit Grund als fehlend
benannt sein.

#### Scenario: Skizze anfügen ohne Stab
- **WHEN** eine Person mit Freigabe des Fernmeldewesens an einem Lagebericht „Fernmeldeskizze
  anfügen“ wählt
- **THEN** wird die Skizze angefügt

#### Scenario: Führungsprobleme ohne Stab
- **WHEN** das Fernmeldewesen für die Person frei ist und die Übernahme „Führungsprobleme“ läuft
- **THEN** enthält sie die Funkplan-Lücken und die Lücken des Kommunikationsplans

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Fernmeldewesen für die Person gesperrt ist
- **THEN** fehlt „Fernmeldeskizze anfügen“, und die Übernahme „Führungsprobleme“ nennt Funkplan und
  Kommunikationsplan als nicht freigegeben
