# Proposal

## Why

Der Abschnitt „Passwort“ auf der Profilseite hängt heute nur am aktiven Passwort-Provider
(LFH-471). Ein per OIDC angelegtes SSO-only-Konto hat aber kein lokales Passwort. Es sieht den
Knopf „Passwort ändern“ trotzdem, und der Server antwortet ihm mit 422 „Das bisherige Passwort
stimmt nicht.“ Diese Meldung ist für so ein Konto irreführend. Nach der Regel „kein toter Knopf“
(LFH-370) darf der Abschnitt dann gar nicht erscheinen (LFH-828).

## What Changes

- Die Benutzerdarstellung der API bekommt ein neues Feld **`passwort_gesetzt: bool`**. Es sagt,
  ob das Konto ein lokales Passwort hat. Der Hash und der SSO-Sentinel werden weiterhin nie
  ausgeliefert.
- Das Feld steht überall, wo die Benutzerdarstellung ausgeliefert wird: `GET /api/auth/me`,
  `POST /api/auth/login`, `POST /api/auth/totp/finish` und die Admin-Benutzerendpunkte unter
  `/api/benutzer`. So trägt der Benutzer im Client das Feld auf jedem Anmeldeweg.
- Die Profilseite zeigt den Abschnitt „Passwort“ nur noch, wenn **beides** gilt: Der
  Passwort-Provider ist aktiv, **und** das Konto hat ein lokales Passwort.
- Die generierten Typen (`openapi.json`, `types.generated.ts`) werden neu erzeugt.

Nicht Teil der Änderung: Der Server-Endpunkt `POST /api/auth/passwort` bleibt unverändert und
antwortet einem SSO-only-Konto weiter mit 422. Die Admin-Benutzerliste zeigt das neue Feld nicht
an.

## Capabilities

### New Capabilities

- `konto-passwortwechsel`: der Selbstbedienungs-Passwortwechsel des angemeldeten Benutzers. Die
  Fähigkeit legt fest, wann die Profilseite ihn anbietet und welche Angabe zum lokalen Passwort
  die API dafür liefert, ohne den Hash preiszugeben.

### Modified Capabilities

(keine: Zum Passwortwechsel und zur Profilseite gibt es bisher keine Fähigkeits-Spec. LFH-471
lief ohne OpenSpec-Change.)

## Impact

- **Backend:** `src/auth/mod.rs` (`BenutzerAnzeige`, `Benutzer::anzeige`) und
  `src/routes/benutzer.rs` (fünf `query_as::<_, BenutzerAnzeige>`-Abfragen). Die Routen
  `me`, `login` und `totp_finish` in `src/routes/auth.rs` laufen über `anzeige()` und bekommen
  das Feld ohne eigene Änderung.
- **API:** Das Feld kommt neu dazu, es fällt keins weg. Ältere Clients lesen weiter.
- **Codegen:** `frontend/src/api/openapi.json` und `frontend/src/api/types.generated.ts`
  (`scripts/check-typ-codegen.sh`).
- **Frontend:** `frontend/src/pages/ProfilPage.tsx` mit Test. Dazu kommen die Fixtures, die
  `BenutzerAnzeige` vollständig ausschreiben (`test/fixtures.ts` und vier Testdateien).
- **Keine Migration:** Das Feld leitet sich aus der bestehenden Spalte `passwort_hash` ab.
