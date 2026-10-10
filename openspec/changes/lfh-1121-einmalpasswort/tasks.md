# Tasks

Jede Aufgabe entsteht per TDD: erst rot, dann grün, dann eine Mutationsprobe, wo die Aufgabe sie
nennt. Die Nummern der Migrationen werden erst beim Anlegen vergeben, als nächste freie über der
höchsten auf `origin/alpha`.

## 1. Datenmodell und Admin-Spur (LFH-1121)

- [x] 1.1 Migration `0172_benutzer_passwort_wechsel_pflicht.sql`: neue Spalte mit Default 0 und CHECK
      (0, 1), wie in design.md unter „Migration Plan“ beschrieben. Prüfung: Ein Test in `src/db.rs`
      zeigt, dass bestehende Zeilen 0 tragen und der CHECK den Wert 2 abweist.
      `scripts/check-migrationen.sh` endet grün.
- [x] 1.2 Migration `0173_admin_audit_einmalpasswort.sql`: Neuaufbau von `admin_audit` mit
      `'einmalpasswort_vergeben'` im CHECK, nach dem Muster von `0170`. Dazu kommen der Rebuild-Test
      neben dem von 0170 in `src/db.rs`, die neue Variante `AdminAktion::EinmalpasswortVergeben` und
      der Eintrag in `tests/enum_wire_kontrakt.rs`. Prüfung: Zuerst ist
      `admin_audit::tests::jede_aktion_passiert_den_db_check` rot, mit der Migration grün. Danach
      laufen `cargo test --test enum_wire_kontrakt` und `scripts/check-typ-codegen.sh` grün, und die
      generierten Dateien werden mitcommittet.

## 2. Backend: Einmalpasswort vergeben (D4, D5)

- [x] 2.1 Erzeuger des Einmalpassworts (D5) als reine Funktion mit Unit-Tests. Die Tests prüfen die
      Form `xxxx-xxxx-xxxx`, das Alphabet ohne `0 o 1 l i` und dass zwei Aufrufe verschiedene Werte
      liefern. Mutationsprobe: Ein Alphabet mit `0` macht den Test rot.
- [x] 2.2 Integrationstests zuerst, rot, in `tests/einmalpasswort.rs` (neue Datei, zusammen mit
      denen aus 3.2). Sie decken ab:
      - 200 samt `Cache-Control: no-store` und Passwort-Form;
      - altes Passwort 401;
      - beide Sitzungen der Person danach 401;
      - Nicht-Admin 403;
      - fremde Organisation 404;
      - Gerätekonto 404;
      - eigenes Konto 422 mit weiter gültiger Sitzung;
      - SSO-only-Konto 422;
      - Passwort-Provider aus 403.
      Es steht genau ein Eintrag `einmalpasswort_vergeben` ohne Detail in der Admin-Spur, bei einer
      Abweisung keiner. Prüfung: `cargo test --test einmalpasswort` ist rot.
- [x] 2.3 Route `POST /api/benutzer/{id}/einmalpasswort` umsetzen (`routes/benutzer.rs`), mit dem
      DTO `Einmalpasswort` (`ToSchema`) und der Registrierung in `src/app.rs`. Prüfung: Die Tests aus
      2.2 sind grün, und `scripts/check-typ-codegen.sh` ist grün, mit mitcommitteten generierten
      Dateien. Mutationsproben: Ohne Org-Bedingung wird der 404-Test rot, ohne
      `session::alle_loeschen` der Sitzungstest.

## 3. Backend: Änderungszwang beim Login (D1, D2, D3, D6, D7)

- [x] 3.1 Pending-Speicher `auth/passwort_wechsel.rs` (mit dem Erzeuger aus 2.1) nach dem Muster von `totp/state.rs`. Er
      hält `benutzer_id` und den Hash, hat eine TTL von 10 min und eine Obergrenze. Die Unit-Tests
      von dort werden übertragen: einmal entnehmbar, Ablauf, Obergrenze.
- [x] 3.2 Integrationstests zuerst, rot, in der neuen Datei `tests/einmalpasswort.rs`. Sie decken
      ab:
      - Login mit Einmalpasswort ergibt `{"passwort_wechsel_erforderlich":true}` ohne
        Sitzungs-Cookie, und `/me` antwortet 401;
      - Festlegen ergibt eine Sitzung samt `BenutzerAnzeige`, das neue Passwort meldet danach direkt
        an, das Einmalpasswort nicht mehr;
      - gleiches Passwort 422, danach gelingt ein zweiter Versuch ohne neuen Login;
      - zu kurz 400, danach gelingt ein Versuch;
      - ohne Cookie 401;
      - zweites Einmalpasswort während des Zwischenschritts 401;
      - Konto mit TOTP: Login, dann `totp/finish` antwortet `passwort_wechsel_erforderlich`, dann
        Festlegen;
      - Passkey bzw. eine Sitzung ohne Passwortweg bleibt unberührt: Das Konto mit Zwang wechselt
        per `POST /api/auth/passwort`, danach meldet es sich ohne Zwischenschritt an;
      - Audit: der Zwischenschritt ohne `login_ok`, das Festlegen mit `passwort_geaendert` und
        `login_ok`;
      - falsches Passwort bei offenem Zwang 401 ohne Hinweis.
      Prüfung: `cargo test --test einmalpasswort` ist rot.
- [x] 3.3 `login`: Die Zwangsprüfung kommt neben `totp_aktiviert` in eine Abfrage, dazu der neue Zweig
      und die Variante in `LoginAntwort`. Prüfung: Die Login-Fälle aus 3.2 sind grün.
- [x] 3.4 `POST /api/auth/passwort/festlegen` (D3), mit Body-Limit 4 KiB in `src/app.rs`. Prüfung: Die
      Festlegen-Fälle aus 3.2 sind grün. Mutationsprobe: Ohne `passwort_hash = ?` im `WHERE` wird der
      Fall „zweites Einmalpasswort“ rot.
- [x] 3.5 `totp_pruefen` und `totp_finish` umbauen (D2): Die Sitzung entsteht erst nach der
      Zwangsprüfung, und die Antwort wird ein untagged Enum. Prüfung: Der TOTP-Fall aus 3.2 ist grün,
      und die bestehenden TOTP-Suiten (`cargo test --test totp` bzw. die betroffenen Dateien) bleiben
      grün.
- [x] 3.6 `anlegen` setzt den Zwang (D6), `passwort_aendern` hebt ihn auf (D7). Prüfung: Ein neuer
      Fall in `tests/einmalpasswort.rs` zeigt, dass ein frisch angelegtes Konto in den
      Zwischenschritt führt und `bootstrap_admin` nicht. Der Fall „Wechsel im Profil“ aus 3.2 ist
      grün.

## 4. Testhelfer nachziehen (D8)

- [x] 4.1 `tests/common/mod.rs`: `benutzer_anlegen` hebt den Zwang mit dem neuen
      `zwang_aufheben(name)` direkt in der Test-Datenbank auf (Design D8). `login_cookie` bricht bei
      offenem Zwang mit klarer Meldung ab. Jede Stelle mit direktem `POST /api/benutzer` plus
      Login ruft `zwang_aufheben` selbst. Prüfung: `cargo test` ist komplett grün (lokal
      10.10.2026, ohne Debug-Info, `--workspace --exclude lifeline-desktop`).
- [x] 4.2 e2e-Helfer `frontend/e2e/konto-anlegen.ts` (Anlage plus Erstwechsel per API). Die Specs und
      Bildskripte mit eigenem `POST /api/benutzer` stellen darauf um, auch `rollen-kern.ts`. Prüfung:
      Ein Grep auf `post('/api/benutzer'` außerhalb des Helfers findet nur noch Stellen ohne
      anschließende Anmeldung. Die betroffenen Specs laufen grün (lokal, Chromium: `aufbewahrung`,
      `sitzung-beenden`, `sitzung-mehrere-tabs`, `verbleib-betreuungsstelle`, `lagekarte-*`,
      `verwaltungstabellen-schmal`). Die Regel steht in `frontend/e2e/AGENTS.md`.

## 5. Frontend (D9)

- [x] 5.1 Die Passwortfelder („Neues Passwort“ und „Neues Passwort wiederholen“, Regeln, Validator
      für die Wiederholung) aus `auth/PasswortAendernDialog.tsx` in einen gemeinsamen Baustein
      ziehen. Prüfung: Die bestehenden Tests des Dialogs bleiben grün.
- [x] 5.2 `api/auth.ts` und `AuthContext`: `LoginErgebnis` bekommt `passwort_wechsel`, `totpFinish`
      liefert dasselbe Ergebnis, `passwortFestlegen()` kommt neu dazu. Übernahme, Vorhaltung und
      Tab-Meldung laufen erst danach. Vitest zuerst rot: Nach `login` mit Zwang ist niemand
      übernommen und `meldeAuthWechsel` nicht gerufen, nach `passwortFestlegen` schon.
- [x] 5.3 `LoginPage`: Schritt „Neues Passwort festlegen“ mit Knopf „Passwort festlegen“, „Zurück“ und
      Fehleranzeige wie im TOTP-Schritt. Vitest zuerst rot, und zwar für den Schritt nach dem
      Passwort-Login, den Schritt nach dem TOTP-Schritt, einen Feldfehler bei ungleicher Wiederholung
      ohne Request und die Navigation nach Erfolg. Der Test zum Hinweis „Passwort vergessen?“
      (`LoginPage.test.tsx:177`) bleibt grün, und `LoginPage.animation.test.ts` bleibt grün.
- [x] 5.4 `BenutzerPage`: „Einmalpasswort vergeben“ im Bearbeiten-Dialog
      (`auth/EinmalpasswortVergeben.tsx`), mit Sperrgründen (`stammdaten/rechteText.ts`),
      Rückfrage per `Popconfirm` und einmaliger Anzeige samt Kopierknopf. Vitest zuerst rot für diese Fälle:
      - Rückfrage, dann Anzeige des Passworts;
      - eigenes Konto gesperrt mit Grund;
      - SSO-only gesperrt mit Grund;
      - Serverfehler im Dialog;
      - Passwort nicht im Query-Cache.
      Die Mutation invalidiert nur `globalKeys.benutzer()` und legt nichts in den Cache.
- [x] 5.5 `zugangsprotokoll/zugangsprotokollText.ts`: Label „Einmalpasswort vergeben“. Prüfung: `tsc`
      ist sauber, denn der Record ist erschöpfend.
- [x] 5.6 e2e: ein neuer Spec `e2e/einmalpasswort.spec.ts` über die Oberfläche. Der Admin vergibt das
      Einmalpasswort, die Person meldet sich in einem zweiten Kontext damit an, legt ein neues fest und
      landet auf `/einsaetze`. Ihre vorherige Sitzung ist beendet. Prüfung: Der Spec läuft grün.

## 6. Anwenderdoku (Mitänderungsregel)

- [ ] 6.1 `docs/anwender/kapitel/anmelden-abmelden.md`: Der Abschnitt „Erste Anmeldung und
      vergessenes Passwort“ beschreibt Einmalpasswort und Wechselschritt, und die Liste der
      Sitzungsenden bekommt „Administration vergibt ein Einmalpasswort“. Das Bild des neuen Schritts
      kommt per `anmelden-abmelden.bilder.ts`. Prüfung: `hilfe/anwenderdoku.guard.test.ts` ist grün,
      und `pnpm doku:bilder --grep anmelden-abmelden` erzeugt das Bild.
- [ ] 6.2 `docs/anwender/kapitel/benutzer.md`: Die Anlage nennt den Wechsel bei der ersten Anmeldung,
      die neue Handlungsfolge „Einmalpasswort vergeben“ kommt dazu, und der Abschnitt „Passwort und
      zweiter Faktor“ wird berichtigt. Bilder per `benutzer.bilder.ts` (Bearbeiten-Dialog), Prüfung
      wie in 6.1.
- [ ] 6.3 `docs/anwender/kapitel/zugangsprotokoll.md`: Die Liste der Admin-Aktionen bekommt
      „Einmalpasswort vergeben“. Prüfung: Der Guard ist grün.

## 7. Abschluss

- [x] 7.1 Folgetickets per `clickup-task-anlegen`, falls nicht schon vorhanden: die Org-Prüfung in
      `totp_reset` und die Oberfläche für den TOTP-Reset. Prüfung: Die Ticketnummern stehen in der
      PR-Beschreibung. Beide gibt es schon: LFH-1123 (Org-Prüfung der Benutzerverwaltung, im Review)
      und LFH-1122 (TOTP-Reset bedienbar, in Arbeit).
- [ ] 7.2 `./scripts/check-all.sh` grün, lokal oder ersatzweise in der CI des PRs. Prüfung: Exit 0
      bzw. ein grüner CI-Lauf.

## Workflow follow-up

- `/opsx:archive lfh-1121-einmalpasswort` im selben Branch vor dem PR. Der Spec-Sync legt
  `openspec/specs/konto-einmalpasswort/` an.
- PR gegen `alpha` mit `LFH-1121`, danach der Board-Status.
