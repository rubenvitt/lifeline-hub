# Tasks

## 1. Schritt 15 im Sammel-Gate

- [ ] 1.1 Lücke vorher belegen: in `src/dev/seed.rs` den Test
  `seed_benutzer_enthaelt_erwartete_konten` kippen (`"admin"` → `"admin-x"`) und das Kommando
  von Schritt 4 (`cargo test --workspace --exclude lifeline-desktop`) fahren. Erwartet: grün,
  weil heute kein Schritt den Test baut. Mutation zurückdrehen.
- [ ] 1.2 `scripts/check-all.sh`: `schritt_15` nach design.md D1 bis D3 (Build-Ziel prüfen,
  `ohne_dev_env`, ein `--no-run`-Bau und zwei Läufe mit dem Paketzuschnitt von Schritt 4 und
  `--features lifeline-hub/dev-seeds`; Kommentar nennt, warum nicht `-p`), `SCHRITTE=15`,
  `BUENDEL_rust="4 15"`, `BUENDEL_alle` bis 15, Kopfkommentar und Bündelbeschreibung
  (`--nur rust`) nachziehen, Abschnittstitel „Die fünfzehn Schritte“. Die Bündel-Selbstprüfung
  bleibt grün: `./scripts/check-all.sh --nur schnell` startet ohne „FEHLER: die Bündel …“.
- [ ] 1.3 Mutationsproben, jede muss Schritt 15 rot und den Lauf mit Exit-Code ungleich 0
  enden lassen, danach zurückdrehen: (a) die Kippung aus 1.1 · (b) in `src/dev/seed.rs` einen
  Aufruf einer Repo-Funktion mit falscher Argumentzahl · (c) in `src/app.rs` die
  Registrierung von `/api/dev/users` entfernen · (d) im `#[cfg(feature = "dev-seeds")]`-Zweig
  von `src/main.rs` einen Bezeichner verschreiben. Ergebnis mit Laufzeit hier notieren.
- [ ] 1.4 `scripts/check-all.sh`: `BUENDEL_rust` testweise auf `"4"` setzen, die
  Selbstprüfung muss vor dem ersten Schritt abbrechen; zurückdrehen.

## 2. Arbeitsanleitung

- [ ] 2.1 `scripts/AGENTS.md`: Schritt 15 in die Gate-Kette aufnehmen, eine Zeile zur Regel mit
  Verweis auf diese Change. Verweise auf „vierzehn Schritte“ per
  `grep -rn "vierzehn\|14 Schritte\|SCHRITTE=14" scripts .github AGENTS.md .claude` suchen und
  nachziehen.

## 3. Nachweis

- [ ] 3.1 `./scripts/check-all.sh --nur rust` vollständig: Schritt 15 grün (Schritt 4 nur an
  der in der Cloud-Sitzung fehlenden GTK-Umgebung der Desktop-Hülle rot, gegen `alpha`
  gegengeprüft). Mehrlaufzeit von Schritt 15 nach warmem Schritt 4 in der PR-Beschreibung
  nennen.
- [ ] 3.2 `./scripts/check-all.sh --nur schnell` vollständig grün.
- [ ] 3.3 CI des PRs: Job `Rust-Suite` zeigt `[15/15]` grün (Verweis auf den Lauf).
