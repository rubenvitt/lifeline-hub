# Tasks

## 1. Backend: `passwort_gesetzt` in der Benutzerdarstellung (LFH-828)

- [x] 1.1 Integrationstests zuerst, rot: in `tests/auth.rs` liefert `GET /api/auth/me`
      `passwort_gesetzt: true` für ein Konto mit Passwort und `false`, nachdem `passwort_hash`
      auf `PASSWORT_HASH_SSO_ONLY` gesetzt wurde (Muster `tests/passwort_aendern.rs`,
      `sso_only_konto_kann_kein_passwort_setzen`). Die Antwort enthält weder `passwort_hash`
      noch den Sentinel-Text. In `tests/benutzer.rs` trägt `GET /api/benutzer` für das
      SSO-only-Konto `false` und für den Admin `true`. Prüfung: `cargo test --test auth --test benutzer` wird rot.
- [x] 1.2 `BenutzerAnzeige` um `passwort_gesetzt: bool` erweitern (Doc-Kommentar mit LFH-828).
      `Benutzer::anzeige` berechnet es aus `passwort_hash != PASSWORT_HASH_SSO_ONLY` (D1).
      Prüfung: der Test zu `me` aus 1.1 wird grün.
- [x] 1.3 In `src/routes/benutzer.rs` die vier gleichen Einzelabfragen in `anzeige_laden(pool, id)`
      zusammenziehen. Liste und Hilfsfunktion lesen `passwort_hash <> ? AS passwort_gesetzt`,
      der Sentinel wird als erster Parameter gebunden (D2). Prüfung: der Test zur Admin-Liste
      aus 1.1 wird grün, `cargo test --test benutzer --test passwort_aendern` bleibt grün.
- [x] 1.4 Typ-Codegen: `scripts/check-typ-codegen.sh` laufen lassen. Prüfung: `openapi.json`
      und `types.generated.ts` enthalten `passwort_gesetzt: boolean`, das Skript endet grün.

## 2. Frontend: Abschnitt „Passwort“ nur mit lokalem Passwort (LFH-828)

- [x] 2.1 Fixtures nachziehen: `benutzerFixture` (`test/fixtures.ts`) bekommt
      `passwort_gesetzt: true`, ebenso die vier Testdateien mit vollständigem
      `BenutzerAnzeige`-Literal. Prüfung: `tsc` (Typecheck im Gate) ist sauber.
- [x] 2.2 Vitest zuerst, rot: In `pages/ProfilPage.test.tsx`, Block „Passwort ändern“, zeigt ein
      SSO-only-Konto (`passwort_gesetzt: false`) bei aktivem Passwort-Provider keinen Abschnitt
      „Passwort“ und keinen Knopf. Die Gegenprobe mit `passwort_gesetzt: true` zeigt den Knopf.
      `benutzerBody` bekommt dafür einen Parameter. Prüfung: der neue Fall ist rot.
- [x] 2.3 `ProfilPage` verknüpft `passwortAktiv` mit `benutzer?.passwort_gesetzt` (D3). Der
      Kommentar an `passwortAktiv` nennt LFH-828 und „kein toter Knopf“. Prüfung: der neue Fall
      ist grün, die übrigen Profil-Tests bleiben grün, und eine Mutationsprobe
      (Bedingung entfernt) macht ihn wieder rot.

## 3. Abschluss

- [ ] 3.1 `./scripts/check-all.sh` grün (lokal, ersatzweise die CI des PRs). Prüfung: Exit 0
      bzw. grüner CI-Lauf.
