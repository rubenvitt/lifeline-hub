# stab-pressemitteilung Specification

## Purpose

Pressemitteilungen sind die Presseinformationen des Sachgebiets S5. Sie entstehen als Entwurf nach
einer Vorlage und werden von der Einsatzleitung freigegeben. Mit der Freigabe sind sie im
Einsatztagebuch belegt, und sie lassen sich als Folgemeldung fortschreiben und drucken.

## Requirements

### Requirement: Vorlagen der Pressemitteilung
Das System SHALL Pressemitteilungen nach einer von vier festen Vorlagen anlegen:
- **Erstinformation:** Sachverhalt, Maßnahmen, Hinweise an die Bevölkerung, Nächste Information,
  Rückfragen
- **Folgeinformation:** Neue Entwicklung, Maßnahmen, Hinweise an die Bevölkerung, Nächste
  Information, Rückfragen
- **Hinweis an die Bevölkerung:** Gefahr, Betroffenes Gebiet, Verhaltenshinweise, Weitere
  Informationen
- **Freitext:** ein Abschnitt

Eine unbekannte Vorlage und ein unbekannter oder doppelter Abschnittsschlüssel MUST mit 400
abgelehnt werden. Die Vorlagen sind nicht je Organisation konfigurierbar.

#### Scenario: Erstinformation anlegen
- **WHEN** eine Person mit Schreibrecht eine Pressemitteilung „Hochwasser Musterstadt – Evakuierung
  Nord“ mit der Vorlage Erstinformation anlegt
- **THEN** entsteht ein Entwurf mit den fünf Abschnitten der Vorlage in ihrer Reihenfolge

#### Scenario: Unbekannte Vorlage
- **WHEN** eine Pressemitteilung mit der Vorlage `suchhinweis` angelegt wird
- **THEN** antwortet das System mit 400

### Requirement: Entwurf bearbeiten wie Lagebericht und Befehl
Ein Entwurf SHALL sich bearbeiten lassen, mit Titel, Zeitstand und Abschnitten. Es gelten
Verlustschutz, Autosave und der Hinweis „zuletzt gespeichert“ wie bei Lagebericht und Befehl. Eine
freigegebene Pressemitteilung MUST unveränderlich sein. Ein Änderungsversuch MUST mit 422
abgelehnt werden.

#### Scenario: Freigegebene ändern
- **WHEN** eine freigegebene Pressemitteilung per PATCH geändert werden soll
- **THEN** antwortet das System mit 422, und der Inhalt bleibt unverändert

### Requirement: Freigabe nur durch die Einsatzleitung
Die Freigabe einer Pressemitteilung MUST der Einsatzleitung des Einsatzes vorbehalten sein, nach
derselben Regel wie die übrigen Leitungsaktionen. Führungspersonal darf Entwürfe anlegen und
bearbeiten, aber nicht freigeben. Der Versuch MUST mit 403 abgelehnt werden. Die Oberfläche MUST die gesperrte
Freigabe sichtbar lassen und den Grund nennen. Die Freigabe einer Pressemitteilung ohne gefüllten
Abschnitt MUST mit 422 abgelehnt werden.

Lagebericht und Befehl behalten ihre bisherige Freigaberegel.

#### Scenario: Einsatzleitung gibt frei
- **WHEN** die Einsatzleitung einen gefüllten Entwurf freigibt
- **THEN** ist die Pressemitteilung `freigegeben`, mit Person und Zeitpunkt der Freigabe

#### Scenario: Führungspersonal kann nicht freigeben
- **WHEN** eine Person mit Rolle Führungspersonal einen Entwurf freigeben will
- **THEN** antwortet das System mit 403, und in der Oberfläche ist „Freigeben“ gesperrt und nennt
  die Einsatzleitung als zuständig

#### Scenario: Lagebericht unverändert
- **WHEN** eine Person mit Rolle Führungspersonal einen Lagebericht freigibt
- **THEN** gelingt die Freigabe wie bisher

### Requirement: ETB-Beleg der Freigabe
Die Freigabe MUST in derselben Transaktion einen ETB-Eintrag vom Typ `meldung` schreiben. Er trägt
den gerenderten Inhalt der Pressemitteilung als Snapshot und verweist auf sie zurück. Scheitert
einer der Schritte, MUST keiner wirksam werden.

#### Scenario: Snapshot im ETB
- **WHEN** eine Pressemitteilung freigegeben wird
- **THEN** enthält das ETB einen Eintrag vom Typ `meldung` mit Titel und Text der Mitteilung und
  einem Verweis auf die Pressemitteilung

### Requirement: Fortschreiben als Folgemeldung
Eine freigegebene Pressemitteilung SHALL sich fortschreiben lassen. Dabei entsteht ein neuer
Entwurf mit dem Inhalt der Vorgängerin, der nächsten Versionsnummer und dem Verweis auf sie. Die
Liste der Pressemitteilungen MUST je Kette nur die jüngste Fassung zeigen, und keine Fassung darf
verloren gehen.

#### Scenario: Folgemeldung
- **WHEN** eine freigegebene Erstinformation fortgeschrieben wird
- **THEN** entsteht ein Entwurf Version 2 mit ihrem Inhalt, und die Liste zeigt die Kette einmal

### Requirement: Liste auf der Presseseite und eigene Detailseite
Die Presseseite SHALL die Pressemitteilungen des Einsatzes als Liste zeigen, mit Titel,
Status, Version und Zeitstand. Jede Pressemitteilung MUST unter einer eigenen Adresse
`/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId` erreichbar sein. Die Navigation zeigt dort
den Stab als aktiv. „Neue Pressemitteilung“ ist die Primäraktion im Kopf der Presseseite.

#### Scenario: Direkter Aufruf
- **WHEN** die Adresse einer Pressemitteilung direkt aufgerufen wird
- **THEN** erscheint ihre Detailseite ohne Umweg über die Presseseite

### Requirement: Druck
Eine Pressemitteilung SHALL sich über die Druckmechanik des Browsers drucken lassen, mit Druckkopf
„Pressemitteilung“, Einsatz, Organisation, Version und Freigabestand. Ein Entwurf MUST im Druck als
Entwurf gekennzeichnet sein.

#### Scenario: Entwurf drucken
- **WHEN** ein Entwurf gedruckt wird
- **THEN** trägt der Ausdruck die Kennzeichnung „Entwurf“, und nur die Druckwurzel wird gedruckt

### Requirement: Rechte, Isolation, Lebenszyklus der Pressemitteilung
Lesen SHALL jedes Einsatzmitglied mit Leserecht auf den Stab, auch die Beobachtung. Anlegen und
Bearbeiten MUST Schreibrecht und die Freigabe des Stab-Moduls verlangen. Eine Pressemitteilung
eines anderen Einsatzes MUST mit 404 beantwortet werden. Am abgeschlossenen Einsatz ist alles
schreibgeschützt. Pressemitteilungen MUST NOT im Offline-Lagebild gespeichert werden.

#### Scenario: Fremder Einsatz
- **WHEN** eine Pressemitteilung über die Adresse eines anderen Einsatzes abgerufen wird
- **THEN** antwortet das System mit 404
