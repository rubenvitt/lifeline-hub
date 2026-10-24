## MODIFIED Requirements

### Requirement: Liste auf der Presseseite und eigene Detailseite
Die Presseseite SHALL die Pressemitteilungen des Einsatzes als Liste zeigen, mit Titel,
Status, Version und Zeitstand. Jede Pressemitteilung MUST unter einer eigenen Adresse
`/einsaetze/:id/presse/mitteilungen/:mitteilungId` erreichbar sein. Die Navigation zeigt dort
die Presse als aktiv. „Neue Pressemitteilung“ ist die Primäraktion im Kopf der Presseseite.

#### Scenario: Direkter Aufruf
- **WHEN** die Adresse einer Pressemitteilung direkt aufgerufen wird
- **THEN** erscheint ihre Detailseite ohne Umweg über die Presseseite

#### Scenario: Alte Adresse
- **WHEN** die Adresse `/einsaetze/:id/stab/presse/mitteilungen/7` aufgerufen wird
- **THEN** erscheint die Detailseite der Pressemitteilung 7 unter `/einsaetze/:id/presse/mitteilungen/7`

### Requirement: Rechte, Isolation, Lebenszyklus der Pressemitteilung
Lesen SHALL jedes Einsatzmitglied mit Leserecht auf die Presse, auch die Beobachtung. Anlegen und
Bearbeiten MUST Schreibrecht und die Freigabe des Moduls Presse verlangen. Die Freigabe des Stabs
MUST dafür keine Rolle spielen. Eine Pressemitteilung eines anderen Einsatzes MUST mit 404
beantwortet werden. Am abgeschlossenen Einsatz ist alles schreibgeschützt. Pressemitteilungen MUST
NOT im Offline-Lagebild gespeichert werden.

#### Scenario: Fremder Einsatz
- **WHEN** eine Pressemitteilung über die Adresse eines anderen Einsatzes abgerufen wird
- **THEN** antwortet das System mit 404

#### Scenario: Ohne Stab
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Führungskraft mit Freigabe der Presse eine
  Pressemitteilung anlegt
- **THEN** legt das System den Entwurf an, und freigeben kann ihn weiter nur die Einsatzleitung
