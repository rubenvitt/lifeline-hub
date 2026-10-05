# Tasks

## 1. Schritt 15 im Sammel-Gate

- [x] 1.1 Lücke vorher belegen: in `src/dev/seed.rs` den Test
  `seed_benutzer_enthaelt_erwartete_konten` kippen (`"admin"` → `"admin-x"`) und das Kommando
  von Schritt 4 (`cargo test --workspace --exclude lifeline-desktop`) fahren. Erwartet: grün,
  weil heute kein Schritt den Test baut. Mutation zurückdrehen. Ergebnis 05.10.2026 (mit
  Filter `seed_benutzer`, um nicht die ganze Suite zu fahren): Exit 0, in der Bibliothek
  „0 passed … 2406 filtered out“, der Test wird ohne Feature nicht einmal gebaut.
- [x] 1.2 `scripts/check-all.sh`: `schritt_15` nach design.md D1 bis D3 (Build-Ziel prüfen,
  `ohne_dev_env`, ein `--no-run`-Bau und zwei Läufe mit dem Paketzuschnitt von Schritt 4 und
  `--features lifeline-hub/dev-seeds`; Kommentar nennt, warum nicht `-p`), `SCHRITTE=15`,
  `BUENDEL_rust="4 15"`, `BUENDEL_alle` bis 15, Kopfkommentar und Bündelbeschreibung
  (`--nur rust`) nachziehen, Abschnittstitel „Die fünfzehn Schritte“. Die Bündel-Selbstprüfung
  bleibt grün: `./scripts/check-all.sh --nur schnell` startet ohne „FEHLER: die Bündel …“.
- [x] 1.3 Mutationsproben, jede muss Schritt 15 rot und den Lauf mit Exit-Code ungleich 0
  enden lassen, danach zurückdrehen: (a) die Kippung aus 1.1 · (b) in `src/dev/seed.rs` einen
  Aufruf einer Repo-Funktion mit falscher Argumentzahl · (c) in `src/app.rs` die
  Registrierung von `/api/dev/users` entfernen · (d) im `#[cfg(feature = "dev-seeds")]`-Zweig
  von `src/main.rs` einen Bezeichner verschreiben. Ergebnis mit Laufzeit hier notieren.
  Ergebnis 05.10.2026, gefahren über eine Wegwerfkopie des Skripts mit `BUENDEL_rust="15"`,
  sonst unverändert: alle vier „Schritt 15 ROT (Exit 101)“, Gesamt-Exit 1. (a) Testfehler in
  `dev::seed::tests`, 125 s · (b) E0061 in der Bibliothek, 76 s · (c) `dev_present` scheitert
  an Zeile 31 (Status ungleich 200), 129 s · (d) E0425 im Binary, 119 s.
- [x] 1.4 `scripts/check-all.sh`: `BUENDEL_rust` testweise auf `"4"` setzen, die
  Selbstprüfung muss vor dem ersten Schritt abbrechen; zurückdrehen. Ergebnis: „FEHLER: die
  Bündel decken nicht genau die 15 Schritte ab.“, Exit 2, kein Schritt gestartet.

- [x] 1.5 Nachzug aus dem Review (design.md D5, D6): beim Verlassen von Schritt 15 das Binary
  ohne Feature zurücklegen, und einen Filter ohne Treffer rot machen. Vorher belegt: nach dem
  Lauf `--nur rust` enthielt `target/debug/lifeline-hub` „dev-seeds AKTIV“. Nachher, je über
  die Wegwerfkopie: grüner Lauf → Exit 0, Binary ohne die Zeichenkette · Kippung aus 1.1 →
  Exit 1, Binary ohne die Zeichenkette · Filter `devx::` in der Zählung → „FEHLER: Der Filter
  'dev::' trifft in der Bibliothek keinen Test“, Exit 1.

## 2. Arbeitsanleitung

- [x] 2.1 `scripts/AGENTS.md`: Schritt 15 in die Gate-Kette aufnehmen, eine Zeile zur Regel mit
  Verweis auf diese Change. Verweise auf „vierzehn Schritte“ per
  `grep -rn "vierzehn\|14 Schritte\|SCHRITTE=14" scripts .github AGENTS.md .claude` suchen und
  nachziehen.

## 3. Nachweis

- [x] 3.1 `./scripts/check-all.sh --nur rust` vollständig: Schritt 15 grün (Schritt 4 nur an
  der in der Cloud-Sitzung fehlenden GTK-Umgebung der Desktop-Hülle rot, gegen `alpha`
  gegengeprüft). Mehrlaufzeit von Schritt 15 nach warmem Schritt 4 in der PR-Beschreibung
  nennen. Ergebnis 05.10.2026: Schritt 15 grün (12 Tests unter `dev::`, 1 in `dev_present`),
  Schritt 4 rot nur an `gdk-sys` (GTK fehlt in der Cloud-Sitzung, auf `alpha` ebenso), alle
  143 Testläufe des Backends grün; Gesamtlauf 518 s. Den Nachzug aus 1.5 belegt der grüne Lauf
  dort. Mehrlaufzeit des Schritts nach warmem Schritt 4: Bau 116 s, Läufe 3 s, Zurücklegen
  unter 1 s (design.md, Sweep).
- [x] 3.2 `./scripts/check-all.sh --nur schnell` vollständig grün. Ergebnis 05.10.2026: elf
  Schritte grün, 274 s.
- [x] 3.3 CI des PRs: Job `Rust-Suite` zeigt `[15/15]` grün. Belegt der Lauf `Rust-Suite` des
  PRs zu LFH-912; vor dem Merge dort nachsehen.
