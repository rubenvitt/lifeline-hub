## Purpose

Das Einsatzmodul Presse bündelt Presse-Log, Pressemitteilungen, Medienlage und
Informationstelefon mit eigener Freigabe. Eine Einsatzleitung beantwortet Presseanfragen damit
auch ohne Stab. Die Inhalte regeln `stab-presse-log`, `stab-pressemitteilung`, `stab-medienlage`
und `stab-infotelefon`; diese Fähigkeit regelt die Hülle.

## ADDED Requirements

### Requirement: Eigenes Modul in der Kategorie Kommunikation
Das System SHALL ein Einsatzmodul führen mit:
- dem Schlüssel `presse`
- dem Namen „Presse“
- der Beschreibung „Presse-Log, Mitteilungen, Infotelefon“
- der Kategorie Kommunikation, vor dem Fernmeldewesen

Es SHALL wie jedes Fachmodul je Einsatz und je Organisation ausblendbar und auf eine Rolle
beschränkbar sein.

#### Scenario: Menüeintrag
- **WHEN** eine Person mit Freigabe der Presse die Kategorie Kommunikation öffnet
- **THEN** steht dort „Presse“ mit der Zeile „Presse-Log, Mitteilungen, Infotelefon“, direkt vor
  „Fernmeldewesen“

#### Scenario: Palette findet das Modul
- **WHEN** jemand mit Freigabe der Presse im Einsatz „Presse“ in die Sprungpalette tippt
- **THEN** ist „Presse“ der erste Treffer unter den Modulen, und ↵ öffnet das Presse-Log

### Requirement: Freigabe unabhängig vom Stab
Die Freigabe der Presse MUST allein nach den Regeln der Fähigkeit `modul-freigabe` gelten. Ist der
Stab ausgeblendet oder gesperrt, MUST die Presse nach ihrer eigenen Freigabe nutzbar bleiben. Eine
Stab-Freigabe MUST eine gesperrte Presse nicht öffnen.

#### Scenario: Stab ausgeblendet
- **WHEN** der Einsatz den Stab ausblendet und die Presse nicht
- **THEN** zeigt das Modulmenü „Presse“, und Presse-Log, Pressemitteilungen und
  Informationstelefon sind lesbar und für Berechtigte bearbeitbar

#### Scenario: Presse gesperrt, Stab frei
- **WHEN** die Presse auf Führungskräfte beschränkt ist und ein normales Mitglied mit Stab-Leserecht
  `/einsaetze/:id/presse` aufruft
- **THEN** zeigt der Rahmen den einheitlichen Hinweis für „Presse“

### Requirement: Modulseite mit zwei Reitern
Die Modulseite SHALL im h1 „Presse“ tragen und darunter die Reiter „Presse“ und
„Informationstelefon“ in dieser Reihenfolge. Die Adressen sind:
- `/einsaetze/:id/presse`: Presse-Log, Pressemitteilungen und Medienlage
- `/einsaetze/:id/presse/infotelefon`: das Informationstelefon
- `/einsaetze/:id/presse/mitteilungen/:mitteilungId`: die Detailseite einer Pressemitteilung, mit
  „Presse“ als aktivem Modul

Jede dieser Adressen MUST als Lesezeichen taugen.

#### Scenario: Reiter wechseln
- **WHEN** eine Person im Reiter „Presse“ auf „Informationstelefon“ tippt
- **THEN** zeigt die Seite das Anrufprotokoll unter `…/presse/infotelefon`, und das h1 bleibt „Presse“

#### Scenario: Handy
- **WHEN** eine Person bei 390 px Breite das Modul öffnet
- **THEN** stehen die Reiter ohne waagerechten Überlauf der Seite

### Requirement: Alte Adressen leiten dauerhaft um
Diese alten Adressen MUST dauerhaft auf die neuen umleiten, mit erhaltener Query:
- `/einsaetze/:id/stab/presse`
- `/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId`
- `/einsaetze/:id/stab/infotelefon`

Die Umleitung MUST ohne zusätzlichen Eintrag im Browserverlauf geschehen und nach der Freigabe der
Presse, nicht der des Stabs. Jeder Verweis der Anwendung auf diese Seiten MUST die neuen Adressen
nennen.

#### Scenario: Alter Kontakt-Link
- **WHEN** eine Person `/einsaetze/:id/stab/presse?kontakt=12` aufruft
- **THEN** zeigt die App das Modul Presse mit dem Kontakt 12 hervorgehoben, und „Zurück“ im Browser
  führt nicht erneut auf die alte Adresse

#### Scenario: Alte Adresse bei ausgeblendetem Stab
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Person `/einsaetze/:id/stab/infotelefon`
  aufruft
- **THEN** zeigt die App das Informationstelefon im Modul Presse, nicht den Hinweis „Stab
  ausgeblendet“

### Requirement: Bestehende Schnittstellen gehören der Presse
Die Endpunkte unter diesen Pfaden SHALL ihre Adressen behalten:
- `/api/einsaetze/{id}/stab/medienkontakte`
- `/api/einsaetze/{id}/stab/pressemitteilungen`
- `/api/einsaetze/{id}/stab/infotelefon`

Sie MUST Lesen und Schreiben an der Freigabe und den Rechten des Moduls Presse prüfen, nicht an
denen des Stabs. Ist die Presse ausgeblendet oder für die Rolle gesperrt, MUST der Server mit 403
antworten, bei einem fremden oder unbekannten Einsatz mit 404. Die Freigabe einer Pressemitteilung
MUST der Einsatzleitung vorbehalten bleiben (Fähigkeit `stab-pressemitteilung`). Die übrigen
Endpunkte unter `/api/einsaetze/{id}/stab` SHALL am Stab hängen.

#### Scenario: Stab ausgeblendet, Lesen und Schreiben
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Führungskraft das Presse-Log liest, einen
  Medienkontakt anlegt und einen Anruf erfasst
- **THEN** antwortet der Server mit 200 bzw. 201, und `GET /api/einsaetze/{id}/stab` antwortet 403

#### Scenario: Presse ausgeblendet
- **WHEN** die Presse im Einsatz ausgeblendet ist und ein Mitglied ohne Admin-Rechte das Presse-Log
  oder das Informationstelefon liest
- **THEN** antwortet der Server mit 403, und `GET /api/einsaetze/{id}/stab` antwortet weiter 200

### Requirement: Freigaben übernehmen Rolle und Sichtbarkeit des Stabs
Bei der Einführung des Moduls MUST das System jede Vorgabe des Stabs auf die Presse übertragen,
Rolle und Sichtbarkeit, und zwar:
- je Einsatz
- je Organisation
- je Einsatz-Vorlage, die den Stab ausblendet

Ohne Vorgabe für den Stab MUST für die Presse keine entstehen. Eine neue Organisation MUST die
mitgelieferten Vorlagen mit ausgeblendeter Presse bekommen, wie den Stab.

#### Scenario: Stab ausgeblendet
- **WHEN** ein Einsatz vor der Einführung den Stab ausgeblendet hat
- **THEN** ist danach auch die Presse dieses Einsatzes ausgeblendet

#### Scenario: Stab auf eine Rolle beschränkt
- **WHEN** eine Organisation vor der Einführung den Stab für alle Einsätze auf Führungskräfte
  beschränkt hat
- **THEN** gilt dieselbe Beschränkung danach für die Presse ihrer Einsätze

#### Scenario: Vorlage
- **WHEN** eine Einsatzleitung nach der Einführung einen Einsatz aus der Vorlage „MANV“ anlegt
- **THEN** ist die Presse in diesem Einsatz ausgeblendet und lässt sich einschalten

### Requirement: Live-Verteilung mit dem Gate der Presse
Änderungen an Medienkontakten und Pressemitteilungen SHALL das Live-Ereignis `presse` verteilen,
Änderungen an Anrufen das Ereignis `infotelefon`. Beide MUST nur Personen und Geräte mit Freigabe
der Presse erreichen. Sie MUST NOT von der Stab-Freigabe abhängen.

#### Scenario: Leser nur des Stabs
- **WHEN** eine Person den Stab, aber nicht die Presse lesen darf und ein Anruf erfasst wird
- **THEN** erhält sie kein Ereignis

### Requirement: Abnehmer folgen der Freigabe der Presse
Diese Abnehmer MUST die Freigabe der Presse prüfen, nicht die des Stabs:
- die Übernahme „Aus S5 übernehmen“ der Medienlage im Lagevortrag
- die Schnellaktion „Anruf erfassen“ der Sprungpalette
- der Sprung „Zu den Vermissten“ aus einem Anruf, der zusätzlich die Freigabe der Personen prüft

#### Scenario: Medienlage ohne Stab
- **WHEN** der Stab ausgeblendet ist, die Presse frei und eine Person im Lagevortrag die Medienlage
  übernimmt
- **THEN** übernimmt sie die Medienlage aus dem Modul Presse

#### Scenario: Presse gesperrt
- **WHEN** die Presse für die Person gesperrt ist
- **THEN** nennt die Übernahme der Medienlage die Presse als nicht freigegeben, und die Palette
  führt „Anruf erfassen“ nicht
