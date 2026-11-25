# Migrationen — Regeln

Gilt für `migrations/` und jeden Code, der Migrationen einspielt (`src/db/`), ergänzt die
Wurzel-`AGENTS.md`. Aus der Wurzel hierher verschoben (LLH-1978), damit sie unter 200 Zeilen
bleibt.

## Backend — Migrationsvergabe (LFH-658)

- **Anhängen, nicht einschieben:** neue Migrationen tragen eine Nummer **größer als jede auf dem
  Ziel-Branch**; bestehende werden nie geändert, umbenannt oder gelöscht, auch nicht im
  Kommentar: sqlx prüft die Checksumme der ganzen Datei, jede bestehende DB bräche mit
  `VersionMismatch`. Ein überholter Kommentar wird im Code berichtigt, der die Spalte schreibt.
- `scripts/check-migrationen.sh` (gegen `origin/alpha`, vorher `git fetch`), Umlegen mit
  `--umnummerieren`. Durchgesetzt über `migrationen.yml` und `migrationen-kanal.yml` (Required
  Check `Migrationsnummern`, Prüfung des Rulesets: `scripts/AGENTS.md`); Netz
  `db::tests::migrationsnummern_sind_eindeutig`.
- **Autofix nur auf dem PR-Branch** (LFH-1014): ein reiner Nummernkonflikt wird per Bot-Commit
  umgelegt (`scripts/migrationen-autofix.sh`), nie auf `alpha`. Danach vor dem nächsten Push
  den Branch holen. Herleitung:
  `openspec/changes/archive/2026-10-03-lfh-1014-migrationsnummern-autofix/design.md`.
- **Doppelte Nummer auf `alpha` reparieren** (Fenster LLH-2030, am 25.11.2026 zweimal 0381):
  die zuletzt gemergte Datei kommt auf die nächste freie Nummer, Verweise mit. Das ist die
  einzige erlaubte Umbenennung: mit doppelter Nummer startet kein Server, und
  `check-migrationen.sh` lässt sie zu, solange genau eine Datei unter der Nummer bleibt.
- **Stau-Wächter** (LLH-1660): meldet Konflikte am PR und mergt bei fehlendem CI-Lauf den
  Ziel-Branch in den PR-Branch; auch danach erst holen, dann pushen. Regeln: `scripts/AGENTS.md`.
- **Falle: sqlx spielt eine kleinere, noch nicht eingespielte Migration still nach**
  (`db::tests::sqlx_spielt_eingeschobene_kleinere_version_still_nach`).
- **Migrationen entstehen nur über `alpha`**; Freigaben als Merge-Commit, nicht Squash.
  Herleitung: `openspec/changes/archive/2026-09-29-lfh-658-migrationsnummern-vor-dem-merge/design.md`.

## Backend — Tabellenumbau und `-- no-transaction` (LLH-1659)

- **Marker nur für `PRAGMA foreign_keys = OFF`:** `-- no-transaction` (erste Zeile) braucht nur
  ein Umbau einer Tabelle, auf die andere verweisen; das Pragma wirkt in einer Transaktion
  nicht. Ein Blatt-Umbau kommt ohne Marker aus und läuft in der Transaktion von sqlx (Muster
  0208, 0324). Wächter: `db::migrationslauf::tests::neue_marker_migration_schaltet_fremdschluessel_aus`.
- **Atomar trotz Marker:** `db::migrate` rahmt jede Marker-Migration ohne eigenes `COMMIT` in
  eine Transaktion und schaltet die Fremdschlüssel bei Bedarf davor aus und danach wieder ein
  (`src/db/migrationslauf.rs`). Ein eigenes `BEGIN … COMMIT` ist nicht nötig; wer es schreibt
  (0325), läuft ohne äußere Transaktion.
- Tests, die Migrationen über einen eigenen `Migrator { … }` einspielen, laufen an diesem
  Rahmen vorbei; ein Umbau mit Marker ist dort nicht atomar.
