# Proposal

## Why

Die Passwortanmeldung hat zwei Schwächen, die im Einsatz die Führung lahmlegen können. Erstens
nimmt `/api/auth/login` Benutzernamen beliebiger Länge an (bis 2 MiB Body), schreibt sie ungekürzt
in `auth_audit` (90 Tage) und ins WARN-Log und zählt einen 503 aus dem KDF-Gate als Fehlversuch;
eine Anmeldewelle hinter einer NAT-IP sperrt sich so selbst aus (LFH-921). Zweitens scheitert die
Anmeldung am Handy oder Tablet, weil die Bildschirmtastatur den ersten Buchstaben groß schreibt
oder ein Leerzeichen anhängt und der Server exakt vergleicht (LFH-981). Beide Tickets berühren
denselben frühen Schritt des Login-Handlers; die Normalisierung des Namens gehört an eine Stelle.

## What Changes

- Eine gemeinsame Vorverarbeitung des Benutzernamens im Backend: Leerzeichen am Rand abschneiden,
  Höchstlänge 128 Zeichen prüfen (400 ohne Audit, ohne Log des Namens, ohne Fehlversuch).
  Gilt für Passwort-Login, Passkey-Start mit Namen, Benutzeranlage.
- **Benutzernamen werden ohne Groß-/Kleinschreibung verglichen** (Entscheidung, s. `design.md`):
  Login und Passkey-Start finden `admin` auch als `Admin`; ein zweiter Name, der sich nur in der
  Schreibweise unterscheidet, ist vergeben (409). Neue Migration `0150` mit eindeutigem Index
  `benutzer(benutzername COLLATE NOCASE)`, die bei vorhandener Kollision mit klarer Meldung
  abbricht.
- Öffentliche Auth-Routen bekommen ein eigenes Body-Limit (4 KiB für Login und Starts).
- Benutzernamen in `auth_audit` und Log-Feldern werden auf 64 Zeichen plus „…“ gekürzt; der
  429-Zweig loggt den Namen nicht mehr.
- Nur ein 401 (falsches Passwort, unbekannter Name) zählt als Fehlversuch und schreibt
  `login_fehlgeschlagen`; ein 503 aus Andrang oder KDF-Wartefrist bleibt 503 ohne Zählung.
- Benutzeranlage und Self-Service-Passwortwechsel hashen über eine neue Funktion
  `hash_gedrosselt` unter dem KDF-Gate und per `spawn_blocking`.
- Login-Seite: Feld Benutzername mit `autocapitalize="none"`, `autocorrect="off"`,
  `spellcheck="false"`; der Name geht getrimmt an `login()`.

## Capabilities

### New Capabilities
- `passwort-anmeldung`: Wie der Server einen Benutzernamen bei Anmeldung und Anlage annimmt,
  vergleicht und protokolliert, und wann ein Anmeldeversuch als Fehlversuch zählt.

### Modified Capabilities
- keine

## Impact

- Backend: `src/routes/auth.rs` (login, webauthn_auth_start, passwort_aendern),
  `src/auth/provider/password.rs`, `src/auth/audit.rs`, `src/auth/rate_limit.rs`,
  `src/routes/benutzer.rs`, `src/auth/oidc/provisioning.rs`, `src/app.rs`, neue Migration
  `migrations/0150_benutzername_nocase.sql`.
- Frontend: `frontend/src/pages/LoginPage.tsx` samt Test.
- Regel in `src/AGENTS.md`: Benutzernamen nur über die gemeinsame Vorverarbeitung und mit
  `COLLATE NOCASE` suchen; Argon2 in Handlern nur über `hash_gedrosselt`.
- Betrieb: Die Migration bricht ab, wenn eine Installation bereits zwei Konten hat, die sich nur in
  Groß-/Kleinschreibung unterscheiden; dann muss ein Admin vorher eines umbenennen.
