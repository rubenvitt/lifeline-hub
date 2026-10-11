## Why

Unter „Einsatzdaten“ → „Zugriff“ füllt sich die Auswahl „Benutzer …“ nur für System-Admins, weil
sie die Benutzerverwaltung `GET /api/benutzer` lädt, die einen Admin verlangt. Eine Einsatzleitung
ohne Systemrolle sieht „Benutzerliste nur für Admins“ und kann niemanden in ihren Einsatz
aufnehmen, obwohl der Server ihr genau das erlaubt (`PUT /api/einsaetze/{id}/mitglieder/{benutzer_id}`
steht hinter der Einsatzleitung, nicht hinter dem Admin). Aufgefallen beim Nachklicken für die
Anwenderdoku (LFH-1127); die Doku beschreibt die Lücke heute als Einschränkung.

## What Changes

- **Neuer Lese-Endpunkt** `GET /api/einsaetze/{id}/mitglieder/auswahl`: nur für die Einsatzleitung
  eines laufenden Einsatzes. Er liefert die Personen, die sich aufnehmen lassen, mit Kennung und
  Anzeigename: aktive Personenkonten der Organisation des Einsatzes, ohne Gerätekonten und ohne
  die, die schon Mitglied sind. Kein Benutzername, keine Rollen, kein MFA-Status.
- **„Zugriff“ lädt die Auswahl aus dem neuen Endpunkt** statt aus der Benutzerverwaltung. Der
  Hinweis „Benutzerliste nur für Admins“ entfällt. Sind alle Personen schon Mitglied, sagt die
  leere Auswahl das.
- **Nebenwirkung für System-Admins:** Ihre Auswahl zeigt nur noch Personen der Organisation des
  Einsatzes. Heute bietet sie Personen fremder Organisationen an, die der Server beim Hinzufügen
  mit 404 abweist.
- **Anwenderdoku:** „Einsatzdaten und Führungsstelle“ und „Rechte im Einsatz“ verlieren den
  Abschnitt über die leere Auswahl und beschreiben, wen die Auswahl anbietet.
- Die Benutzerverwaltung `GET /api/benutzer` bleibt unverändert admin-only.

## Capabilities

### New Capabilities

- `einsatz-zugriff`: Wer den Zugriff eines Einsatzes verwaltet und wen die Einsatzleitung in den
  Einsatz aufnehmen kann, samt der Auswahl, die ihr dafür angeboten wird.

### Modified Capabilities

_keine_

## Impact

- Backend: `src/routes/einsatz.rs` (neuer Handler), `src/einsatz/repo.rs` (Abfrage),
  `src/einsatz/mod.rs` (Antworttyp), `src/app.rs` (Route), `src/api_doc.rs` (Schema); generierte
  Typen über `scripts/check-typ-codegen.sh`.
- Tests: Integrationstest unter `tests/` (Rechte, Org-Grenze, Gerätekonten, Mitglieder,
  deaktivierte Konten, abgeschlossener Einsatz).
- Frontend: `pages/MitgliederAbschnitt.tsx`, `api/einsaetze.ts`, `api/queryKeys.ts` (neuer
  Einsatz-Key, nicht live, nicht offline), `pages/MitgliederAbschnitt.test.tsx`.
- Doku: `docs/anwender/kapitel/einsatzdaten.md`, `docs/anwender/kapitel/rechte-im-einsatz.md`.
- Keine Migration, kein Schreibweg geändert.
