# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/a13nxa2kw0cmscsasc5mg6x0 (LLH-1702, Befund 2 aus dem
Review zu LLH-1672)

## Why

Der Anzeigename eines Kontos hat keine Obergrenze und steht als Unterzeichner in der Erklärung
einer Notübernahme. Wird die Erklärung größer, als das Gegenüber annimmt (4096 Byte), schickt
der Sender die Akte seit LLH-1672 nicht mehr. Die Notübernahme gilt lokal aber schon: Beide
Seiten halten sich für die führende Instanz, bis sich die Akte wieder ändert.

## What Changes

- Der Anzeigename eines Kontos ist beim Anlegen und Ändern auf 200 Zeichen begrenzt, mit 400 und
  dem üblichen Text der Eingabegrenzen. Das Ticket nennt 422; entschieden ist 400 nach der
  Projektregel (Abstimmung 12.11.2026).
- Die Maske der Benutzerverwaltung lässt beim Anlegen und Bearbeiten nicht mehr zu als der Server
  und zeigt die Zählanzeige.
- Ein Anzeigename, der von außen kommt (Konto aus den Stammdaten des Hubs, erste Anmeldung über
  SSO), wird still auf 200 Zeichen gekürzt.
- Eine Notübernahme nennt als Unterzeichner höchstens die ersten 200 Zeichen des Anzeigenamens.
  Passt die Erklärung trotzdem nicht in die Grenze des Gegenübers, lehnt der Server mit 422 ab,
  bevor die Führung lokal wechselt.
- Bestandsnamen über 200 Zeichen bleiben stehen (keine Migration). Sie werden erst beim nächsten
  Bearbeiten des Kontos gekürzt; die Notübernahme kürzt sie für die Erklärung selbst.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `eingabegrenzen`: neue Anforderung, dass der Anzeigename eines Kontos begrenzt ist (Eingabe,
  Maske, Namen von außen).
- `instanz-fuehrung`: neue Anforderung, dass eine Notübernahme nie eine Erklärung erzeugt, die
  das Gegenüber wegen ihrer Größe ablehnt.

## Impact

- Backend: `src/auth/` (Grenze), `src/routes/benutzer.rs` (Anlegen, PATCH),
  `src/auth/oidc/provisioning.rs`, `src/instanz/stammdaten/uebernehmen.rs`,
  `src/instanz/spiegel/abbildung.rs` (Kürzung über dieselbe Konstante),
  `src/instanz/fuehrung/dienst.rs` und `austausch.rs` (Erklärung).
- Frontend: `frontend/src/pages/BenutzerPage.tsx`, `frontend/src/api/eingabegrenzen.ts`.
- API: `POST /api/benutzer` und `PATCH /api/benutzer/{id}` antworten bei einem Anzeigenamen über
  200 Zeichen mit 400; die vier Routen der Notübernahme können neu mit 422 antworten. Keine
  Änderung an Wire-Feldern, keine Migration.
- Doku: Anwenderkapitel `benutzer` und `instanzkopplung`, eine ADR für die Entscheidung
  „kürzen, dann ablehnen“.
