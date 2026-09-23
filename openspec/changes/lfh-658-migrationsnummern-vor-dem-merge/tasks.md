# Tasks

## 1. Messung festhalten (sqlx)

- [ ] 1.1 Charakterisierungstest in `src/db.rs`: Zwei Hand-`Migrator` laufen gegen eine
  In-Memory-DB, der erste mit v2, der zweite mit v1+v2. Der zweite läuft ohne Fehler durch,
  v1 ist danach angewendet. Prüfen mit `cargo test --lib db::tests::`. Außerdem die
  Mutationsprobe „`set_ignore_missing` / anderes Verhalten erwartet → rot“ einmal von Hand.

## 2. Prüfskript (TDD, Selbsttest zuerst)

- [ ] 2.1 `scripts/check-migrationen.test.sh` gegen echte Git-Repos im Temp-Verzeichnis
  schreiben. Fälle: ohne Migration grün · Anhängen grün · Kollision rot mit
  Vorschlag der nächsten freien Nummer · Einschub unter eine gemergte Nummer rot · Dublette
  im Branch rot · bestehende Migration geändert rot · umbenannt rot · gelöscht rot · Basis
  vorausgelaufen ohne eigene Migration grün · `--umnummerieren` benennt um, zieht
  `include_str!` nach und die Folgeprüfung ist grün. Zuerst laufen lassen und rot sehen.
- [ ] 2.2 `scripts/check-migrationen.sh` umsetzen (Regeln und `--umnummerieren` wie in
  design.md D4), bis 2.1 grün ist. Danach gegen `origin/alpha` auf diesem Branch ausführen
  und das Ergebnis grün sehen.
- [ ] 2.3 Mutationsprobe von Hand: Regel „> max(B)“ auf „∉ B“ abschwächen, dann muss der
  Einschub-Fall rot werden. Merge-Base durch B ersetzen, dann muss „Basis vorausgelaufen“ rot
  werden. Danach zurückdrehen.

## 3. Gate und CI

- [ ] 3.1 `scripts/check-all.sh`: Selbsttest und lokale Prüfung gegen `origin/alpha` (mit
  lautem Überspringen ohne Ref) ins `schnell`-Bündel aufnehmen, Hilfetext und
  Bündel-Summenprüfung nachziehen. Prüfen mit `./scripts/check-all.sh --nur schnell`.
- [ ] 3.2 `.github/workflows/migrationen.yml` mit `pull_request`- und `push`-Auslöser wie in
  design.md D3. Actions per SHA gepinnt wie in `ci.yml`, `permissions` minimal
  (`contents: read`, `statuses: write`, `pull-requests: read`). Prüfen mit `actionlint`
  (falls vorhanden) bzw. YAML-Parse. Die Wirkung zeigt sich am eigenen PR: der Status
  `Migrationsnummern` erscheint auf dem Kopf-Commit.

## 4. Doku und Entscheidung

- [ ] 4.1 `CLAUDE.md`: neuer Abschnitt „Backend — Migrationsvergabe (LFH-658)“ mit der
  Entscheidung, den drei verworfenen Wegen samt Grund, der Regel, dem Befehl zum
  Umnummerieren und der Grenze (Rennfenster). Kurz halten, auf design.md verweisen.
- [ ] 4.2 Memory `migrations-nummernkollision-merge` auf das neue Werkzeug umstellen.

## 5. Verifikation und Einführung

- [ ] 5.1 `cargo test --workspace`, `./scripts/check-all.sh --nur schnell` sowie
  `cargo fmt --all -- --check` grün, Ausgaben gelesen.
- [ ] 5.2 PR gegen `alpha` öffnen und prüfen, dass der eigene Status `Migrationsnummern`
  gesetzt ist (`gh api repos/rubenvitt/lifeline-hub/commits/<sha>/status`).
- [ ] 5.3 Nach dem Merge prüfen, dass der Push-Lauf allen offenen PRs einen Status gesetzt
  hat. **Nur mit Freigabe des Users**: `Migrationsnummern` als Required Check (ohne
  `integration_id`) ins Ruleset 17017911 aufnehmen und die Memory
  `github-ruleset-required-checks-pin` nachziehen.
