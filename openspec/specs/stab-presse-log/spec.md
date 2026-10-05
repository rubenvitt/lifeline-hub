# stab-presse-log Specification

## Purpose

Das Presse-Log des Sachgebiets S5 hält fest, welche Medien den Einsatz angefragt haben, was ihnen
gesagt wurde und wer die Aussage freigegeben hat. Es führt auch Abstimmungen mit anderen
Pressestellen und Pressetermine. Zielkontext ist der Stabsraum.

## Requirements

### Requirement: Medienkontakt erfassen
Das System SHALL je Einsatz Medienkontakte führen. Ein Medienkontakt MUST diese Angaben tragen:
- **Art:** `anfrage` (Anfrage einer Redaktion), `abstimmung` (Abstimmung mit einer Behörden- oder
  Organisations-Pressestelle) oder `termin` (Pressekonferenz, Interview, Dreh vor Ort)
- **Medium:** Pflicht, Freitext, etwa „NDR 1 Niedersachsen“ oder „Polizeiinspektion Pressestelle“
- **Thema:** Pflicht, Freitext
- **Eingang:** Zeitpunkt. Fehlt er, gilt der Zeitpunkt der Erfassung.

Optional sind die Ansprechperson und ihre Erreichbarkeit. Ein fehlendes oder leeres Pflichtfeld
MUST mit 400 abgelehnt werden, ebenso eine unbekannte Art. Ein neuer Kontakt MUST im Status `offen`
beginnen.

#### Scenario: Anfrage erfassen
- **WHEN** eine Person mit Schreibrecht eine Anfrage von „NDR 1“ zum Thema „Zahl der Evakuierten“
  mit der Ansprechperson „M. Beispiel“ erfasst
- **THEN** steht die Anfrage mit Eingang = jetzt und Status `offen` im Presse-Log

#### Scenario: Thema fehlt
- **WHEN** ein Medienkontakt ohne Thema oder mit leerem Thema angelegt wird
- **THEN** antwortet das System mit 400 und legt nichts an

#### Scenario: Unbekannte Art
- **WHEN** ein Medienkontakt mit der Art `leserbrief` angelegt wird
- **THEN** antwortet das System mit 400

### Requirement: Statusweg mit Antwort und Freigabeangabe
Der Statusweg eines Medienkontakts MUST von seiner Art abhängen:
- Eine `anfrage` geht von `offen` nach `beantwortet` oder `abgelehnt`.
- Eine `abstimmung` und ein `termin` gehen von `offen` nach `erledigt`.

Ein Übergang nach `beantwortet` MUST die gegebene Antwort als nichtleeren Text tragen. Optional
trägt er die Angabe, wer die Aussage freigegeben hat (Freitext, etwa „EL mündlich 14:20“), und den
Bezug auf eine freigegebene Pressemitteilung desselben Einsatzes.

Das System MUST speichern, wer den Übergang vorgenommen hat und wann. Jeder Zielstatus MUST sich
eine Stufe zurück nach `offen` nehmen lassen. Die Antwort bleibt dabei stehen.

Ein Übergang, der zur Art nicht passt, MUST mit 422 abgelehnt werden. Das gilt auch für
`beantwortet` ohne Antwort und für einen Bezug auf eine nicht freigegebene oder fremde
Pressemitteilung.

#### Scenario: Anfrage beantworten
- **WHEN** eine offene Anfrage mit der Antwort „Derzeit 240 Personen in der Notunterkunft“ und der
  Freigabeangabe „EL“ beantwortet wird
- **THEN** steht sie auf `beantwortet`, mit Antwort, Freigabeangabe, Person und Zeitpunkt

#### Scenario: Beantworten ohne Antwort
- **WHEN** eine Anfrage ohne Antworttext auf `beantwortet` gesetzt wird
- **THEN** antwortet das System mit 422 und der Status bleibt `offen`

#### Scenario: Termin kann nicht beantwortet werden
- **WHEN** ein Termin auf `beantwortet` gesetzt wird
- **THEN** antwortet das System mit 422

#### Scenario: Rücknahme
- **WHEN** eine beantwortete Anfrage nach `offen` zurückgesetzt wird
- **THEN** ist sie wieder offen, die bisherige Antwort bleibt sichtbar, und die Oberfläche stellt
  dafür keine Rückfrage

### Requirement: Presse-Log bearbeiten, nicht löschen
Medium, Thema, Ansprechperson, Erreichbarkeit und Eingang eines Medienkontakts SHALL sich
bearbeiten lassen. Ein Medienkontakt MUST NOT gelöscht werden können. Während des Einsatzes ist
das Log der Arbeitsstand der Pressearbeit; über die Schwärzung hinaus bleibt als Nachweis nur die
freigegebene Pressemitteilung im ETB.

#### Scenario: Kein Löschen
- **WHEN** eine Person versucht, einen Medienkontakt zu löschen
- **THEN** bietet die Oberfläche keine solche Aktion an, und das System hat keinen Endpunkt dafür

### Requirement: Darstellung als Liste mit offenen Kontakten zuerst
Die Presseseite SHALL die Medienkontakte als Liste zeigen, nicht als Tabelle, denn die Frage ist
„was ist mit diesem?“. Jede Zeile zeigt:
- Medium und Thema als Titel
- Art und Status als Wort
- Eingang in Mono
- die Ansprechperson

Der Status wird über die Statusanzeige der Zeile gewechselt. Die Liste SHALL sich per
Segmentleiste auf offene Kontakte einschränken lassen. Die Zahl offener Anfragen MUST als Kennzahl
über der Liste stehen. Eine Zeile MUST per Deeplink `?kontakt=<id>` ansteuerbar sein.

#### Scenario: Nur offene
- **WHEN** die Person in der Segmentleiste „offen“ wählt
- **THEN** zeigt die Liste nur Medienkontakte im Status `offen`

#### Scenario: Deeplink auf einen Kontakt
- **WHEN** die Presseseite mit `?kontakt=12` aufgerufen wird
- **THEN** rollt die Liste zu diesem Kontakt und hebt ihn hervor

### Requirement: Rechte und Lebenszyklus
Lesen SHALL jedes Einsatzmitglied mit Leserecht auf den Stab, auch die Beobachtung. Erfassen,
Bearbeiten und Statuswechsel MUST Schreibrecht im Einsatz und die Freigabe des Stab-Moduls
verlangen. Am abgeschlossenen Einsatz ist das Presse-Log schreibgeschützt. Ein Medienkontakt eines
anderen Einsatzes MUST mit 404 beantwortet werden. Fehlendes Schreibrecht wird in der Oberfläche
erklärt, nicht still weggeschaltet.

#### Scenario: Beobachtung liest
- **WHEN** eine Person mit Rolle Beobachtung das Presse-Log öffnet
- **THEN** sieht sie die Kontakte, die Erfassung ist gesperrt, und ein Hinweis nennt den Grund

#### Scenario: Stab gesperrt
- **WHEN** das Stab-Modul für den Einsatz ausgeblendet ist
- **THEN** antworten die Endpunkte des Presse-Logs mit der Modulsperre, und die Seite ist nicht
  erreichbar

### Requirement: Datenschutz der Kontaktdaten
Ansprechperson und Erreichbarkeit MUST als personenbezogen gelten. Die Schwärzung eines Einsatzes
MUST beide entfernen, ebenso die Freitexte des Presse-Logs: Medium, Thema, Antwort und
Freigabeangabe. Erhalten bleiben MUST Art, Status, Eingang, Bearbeitungs- und Änderungszeitpunkte
sowie die Verweise auf Benutzer und auf die Pressemitteilung. Der System-Eintrag der Schwärzung MUST
die Freitexte des Presse-Logs als entfernt nennen. Medienkontakte MUST NOT im Offline-Lagebild auf
dem Gerät gespeichert werden.

#### Scenario: Schwärzung
- **WHEN** ein Einsatz mit einer beantworteten Anfrage „Anfrage zu Fam. Yilmaz“ von „NDR 1“ mit
  Ansprechperson, Antwort und Freigabeangabe geschwärzt wird
- **THEN** sind Ansprechperson, Erreichbarkeit und Freigabeangabe leer
- **AND** tragen Medium, Thema und Antwort den Platzhalter
- **AND** stehen Art, Status und Eingang unverändert da

#### Scenario: Unbeantworteter Kontakt
- **WHEN** ein Einsatz mit einem offenen Medienkontakt ohne Antwort geschwärzt wird
- **THEN** bleibt die Antwort leer und die Schwärzung läuft durch

#### Scenario: Audit nennt das Presse-Log
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** nennt der System-Eintrag der Schwärzung die Freitexte des Presse-Logs unter dem
  Entfernten

#### Scenario: Kein Offline-Vorrat
- **WHEN** das Lagebild für die Offline-Lesbarkeit gespeichert wird
- **THEN** enthält der gespeicherte Stand keine Medienkontakte

### Requirement: Live-Aktualisierung
Änderungen am Presse-Log SHALL andere geöffnete Sitzungen desselben Einsatzes live erreichen.
Neue Einträge MUST dabei ohne Sprung unter dem Cursor eingereiht werden.

#### Scenario: Zweiter Arbeitsplatz
- **WHEN** an einem Arbeitsplatz eine Anfrage erfasst wird, während ein zweiter die Presseseite offen hat
- **THEN** erscheint die Anfrage am zweiten Arbeitsplatz ohne Neuladen
