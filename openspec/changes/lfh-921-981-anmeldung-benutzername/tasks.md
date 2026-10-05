# Tasks

## 1. Benutzername: Vorverarbeitung und Protokollkürzung

- [ ] 1.1 `src/auth/benutzername.rs` (neu, in `src/auth/mod.rs` registriert): `MAX_LAENGE = 128`, `normalisiere` (Trim, dann Länge in Zeichen, 400 bei Überlänge) und `fuer_protokoll` (64 Zeichen plus „…“), design.md Entscheidung 2. Unit-Tests zuerst: `" admin "` → `admin`, 128 Zeichen ok, 129 → 400, 128 Zeichen plus Randleerzeichen ok, Mehrbyte-Zeichen zählen als eins, Kürzung bei 64/65 Zeichen. Prüfen: Tests vor der Umsetzung ROT, danach grün
- [ ] 1.2 `src/auth/audit.rs`: `schreibe` kürzt `benutzername` über `fuer_protokoll`. Test: ein 100 Zeichen langer Name landet gekürzt in `auth_audit`. Prüfen: Test grün, `tests/auth_audit.rs` grün
- [ ] 1.3 `src/auth/rate_limit.rs`: `konto` hasht `to_ascii_lowercase()` (Entscheidung 3). Test: Fehlversuche gegen `Max` räumt `erfolg(ip, "max")`. Prüfen: Test grün, Modultests grün

## 2. Login und Passkey-Start

- [ ] 2.1 `src/routes/auth.rs::login`: `benutzername::normalisiere` als erster Schritt; 429-Zweig ohne Namen; Err-Arm nur für `Unauthorized` zählend, sonst durchreichen (Entscheidung 4); Log-Felder über `fuer_protokoll`. Tests (Rust, Integrationstest neben `tests/auth.rs`/`tests/login_sperre_proxy.rs`): 129 Zeichen → 400 ohne Audit-Zeile und ohne Fehlversuch; `" admin "`, `Admin`, `ADMIN` melden an. Prüfen: Tests vor der Umsetzung ROT, danach grün
- [ ] 2.2 `src/auth/provider/password.rs`: Suche mit `COLLATE NOCASE`. Tests im Modul: `Admin`/`ADMIN`/`" admin "` über den Handlerpfad bzw. normalisiert, deaktivierter Benutzer in anderer Schreibweise bleibt 401. Prüfen: grün
- [ ] 2.3 Sperre bei Überlast: Test mit injizierten `Schranken` (ausgeschöpftes Gate) über den Login-Kern, mehr als 10 Mal 503, danach `ist_gesperrt(ip)` falsch und keine `login_fehlgeschlagen`-Zeile; Gegenprobe: 10 falsche Passwörter sperren. Wo der Handler die produktiven Schranken nutzt, den Kern so schneiden, dass der Test die Schranken setzen kann. Mutationsprobe: mit dem alten `Err(e)`-Arm wird der Test rot. Prüfen: Ergebnis der Mutationsprobe hier notieren
- [ ] 2.4 `webauthn_auth_start`: `normalisiere` vor der Suche, Suche mit `COLLATE NOCASE`. Test: Start mit `MAX` für `max` mit Passkey liefert eine Challenge; 129 Zeichen → 400. Prüfen: grün
- [ ] 2.5 `src/app.rs`: Body-Limits 4 KiB (Login, beide Starts) und 16 KiB (beide Finish), Entscheidung 6. Test in `tests/fehler_vertrag.rs`: Login-Body über 4 KiB → 400 im `{error}`-Format mit der Größen-Meldung (`JsonBody` kennt kein 413); ein Passkey-Finish-Body von 6 KiB wird nicht wegen der Größe abgewiesen. Prüfen: grün

## 3. Anlage, SSO und Migration

- [ ] 3.1 `migrations/0150_benutzername_nocase.sql` (Entscheidung 7) mit Vorprüfung per temporärem Trigger und eindeutigem `NOCASE`-Index. Tests in `src/db.rs` bzw. neben den Migrationstests: Migration auf Daten mit `max`/`Max` bricht mit der Meldung ab; ohne Kollision läuft sie durch. Prüfen: grün, `scripts/check-migrationen.sh` grün (vorher `git fetch origin alpha`)
- [ ] 3.2 `src/routes/benutzer.rs::anlegen`: `normalisiere` statt rohem `trim`, 129 Zeichen → 400; `Admin` neben `admin` → 409 (über den neuen Index). Tests in `tests/benutzer.rs`. Prüfen: grün
- [ ] 3.3 `src/auth/oidc/provisioning.rs`: Kollisionsprüfung kleingeschrieben (Entscheidung 8). Test: lokales `Max` vorhanden, SSO-Erstanmeldung mit `max` bekommt `max-2`. Prüfen: grün

## 4. Hashing unter dem KDF-Gate

- [ ] 4.1 `src/auth/provider/password.rs`: `platz_holen` herausziehen, `hash_gedrosselt` und `hash_gedrosselt_mit_schranken` (Entscheidung 5). Tests: belegtes Gate mit kurzer Wartefrist → 503; Platz fällt nach dem Hash zurück. Bestehende Gate-Tests bleiben grün. Prüfen: grün
- [ ] 4.2 `benutzer::anlegen` und `auth::passwort_aendern` auf `hash_gedrosselt` umstellen. Prüfen: `tests/benutzer.rs`, `tests/passwort_aendern.rs` grün; `rg 'password::hash\(' src` zeigt nur `bootstrap.rs`, `dev/seed.rs`, `auth/password.rs` und Tests

## 5. Login-Seite

- [ ] 5.1 `frontend/src/pages/LoginPage.test.tsx`: Feld Benutzername trägt `autocapitalize="none"`, `autocorrect="off"`, `spellcheck="false"`; Eingabe `" admin "` ruft `login('admin', …)`. Prüfen: Test vor der Umsetzung ROT
- [ ] 5.2 `frontend/src/pages/LoginPage.tsx`: Attribute setzen, Name getrimmt an `login()` (Entscheidung 9). Prüfen: 5.1 grün, Prettier, Lint, Typecheck grün

## 6. Regel und Gesamtlauf

- [ ] 6.1 `src/AGENTS.md`: kurzer Abschnitt „Backend — Benutzername und KDF (LFH-921, LFH-981)“: Namen von außen nur über `auth::benutzername::normalisiere`, Suche nach `benutzername` mit `COLLATE NOCASE`, Argon2 in Handlern nur über `hash_gedrosselt`, Herleitung auf das Archiv dieser Change. Tabelle der Wurzel-`AGENTS.md` bleibt unverändert (Bereichsdatei existiert). Prüfen: Wurzel-`AGENTS.md` unter 200 Zeilen
- [ ] 6.2 `rg "benutzername = \?" src` prüfen: jede Suche nach einem Namen von außen nutzt `COLLATE NOCASE`. Prüfen: Fundstellen hier notieren
- [ ] 6.3 `./scripts/check-all.sh` (Bündel, die in der Cloud-Sitzung laufen), `cargo test`, Vitest für die Login-Seite. Prüfen: grün oder umgebungsbedingt rot wie auf `alpha` (Gegenprobe notieren); voller Lauf über die CI des PRs
