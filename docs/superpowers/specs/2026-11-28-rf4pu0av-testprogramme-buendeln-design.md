# Integrationstests in Bündeln (LLH-2150)

Zunder: https://zunder.rubeen.dev/#/aufgabe/rf4pu0avo4rju2ssqeamgc8o · abgestimmt 28.11.2026

## Warum

`cargo test` baut je Datei in `tests/` ein eigenes Programm, und jedes linkt die ganze
Bibliothek statisch. Bei 302 Dateien waren das rund 300 Programme zu je ~300 MB, zusammen gut
95 GB. Am 26.11. lief der Runner damit voll, am 27.11. starb er zweimal beim Linken.
LLH-2153 hat die Suite in GitHub Actions in Teile zerlegt und nach jedem Teil gelöscht. Damit
läuft sie durch, aber jede neue Testdatei kostet weiter ~300 MB und einen Linkvorgang. Bei
`cargo llvm-cov` (`coverage.yml`) hilft das Teilen gar nicht, denn es braucht alle Programme
gleichzeitig.

## Ziele

- Die Suite hat auf `ubuntu-latest` deutlich Reserve, auch ohne den Aufräumschritt im Rust-Job.
- Die Laufzeit wird nicht schlechter. Es wird viel seltener gelinkt, und das Schema-Abbild aus
  `db::test_pool` wird einmal je Programm gebaut statt einmal je Datei.

Kein Ziel ist es, Tests umzuschreiben oder Testdateien zu verschieben.

## Wege

1. **Bündeln (gewählt).** Mehrere Testdateien werden Module eines Testprogramms.
2. Nur die Debug-Infos kürzen (strip oder split-debuginfo in der CI). Wie viel das bringt, ist
   unklar, und es bleiben 300 Linkvorgänge. Verworfen.
3. Teilen und Löschen (LLH-2153). Das bleibt bestehen, löst aber den Gesamtbedarf nicht.

Für die Ablage gab es zwei Möglichkeiten:

- **(a) gewählt:** Die Dateien bleiben in `tests/`. `Cargo.toml` setzt `autotests = false`, die
  Bündelwurzeln `tests/buendel_<bereich>/main.rs` binden die Dateien per `#[path]` ein.
- **(b) verworfen:** Die Dateien nach `tests/<bündel>/` verschieben. Das zieht rund 400 Verweise
  in Code, ADRs, e2e und AGENTS.md nach sich und kollidiert mit allen Aufgaben, die gerade
  parallel laufen.

Das Risiko von (a) ist eine Datei, die nicht eingetragen ist und deshalb **still nie läuft**.
Das fängt ein Wächter ab (unten).

## Zuschnitt

Neun Bündel nach Fachbereich: `einsatz`, `kommunikation`, `kraefte`, `lage`, `personen`,
`zugang`, `plattform`, `benachrichtigung`, `scan`. Es gibt bewusst kein einzelnes
Riesenprogramm, aus zwei Gründen: Der Runner hat 15 GB Speicher, und lokal baut jede Änderung an
einer Testdatei ihr ganzes Bündel neu.

**Eigenständig bleiben die Dateien, die nicht in einen geteilten Prozess passen.** Die Einteilung
ist statisch. Ein grüner Probelauf belegt nichts, denn welcher Test eine prozessweite Einstellung
zuerst setzt, entscheidet der Scheduler.

- **Prozessweite Setzer** (`let _ = X.set(..)` an einem `OnceLock`, der erste Aufruf gewinnt):
  - `init_scan_config`, `set_oidc_konfiguriert`, `set_webauthn_konfiguriert`,
    `init_oidc_settings`, `set_webauthn`, `init_vertraute_proxys`, `init_cdn_proxys`,
    `set_betreiber_kontakt`, `set_cookie_secure`, `init_karte_config`, `stammdaten::set_live`,
    `melden::set_abstand`, `takt::set_abstand`, `instanz::set_name`, `unterschrift::set_rp`.
  - Eigenständig bleiben deshalb: `admin_audit`, `anmelde_audit`, `anmelde_start_grenzen`,
    `anmeldung_benutzername`, `auth`, `oidc_discovery_ausfall`, `login_sperre_proxy`, `karte`,
    `karte_fremdebene_scan` und die fünf `instanz_*_live`.
  - **Ausnahme gleicher Wert:** Die sieben `*_scan`-Dateien setzen alle dieselbe
    Scan-Konfiguration und teilen sich das Bündel `scan`. Kein anderes Bündel setzt diesen Wert,
    die Leser dort sehen also
    weiter den Vorgabezustand (etwa `karte_fremdebene` und `organisation_logo`, die ausdrücklich
    keinen Scan-Setzer neben sich vertragen).
- **Echte Verbindungen von 127.0.0.1 mit Fehlversuchen:** Die Sperre in `auth::rate_limit` (10
  Fehlversuche je 300 s) gilt je Quelle und Prozess.
  - Geplant war ein Bündel `kopplung`, weil alle 13 Kopplungsdateien denselben `set_rp`-Wert
    setzen. Es scheiterte im ersten Lauf mit 48 Fehlern (429 „lehnt gerade weitere Versuche ab“):
    Über `instanz_hilfen` starten diese Dateien echte Instanzen auf Loopback, und ihre
    absichtlichen Fehlversuche summierten sich.
  - Alle 13 sind deshalb eigenständig (`einsatz_anbindungen`, `instanz_*`, `lagebild_extern`,
    `ortung_spiegel`, `public_api_ereignis_trigger`).
  - Die übrigen Dateien mit echtem Server (`ios_push`, `web_push`, Stub-Server für Fremdquellen)
    erzeugen keine Fehlversuche und laufen gebündelt grün.
- **Globaler Subscriber:** `listen_abfragen` und `modul_zaehler_abfragen` setzen
  `tracing::subscriber::set_global_default` und zählen SQL-Anweisungen. Fremde Tests im selben
  Prozess verfälschten die Zählung.
- **Per Name aufgerufen:** `dev_present`/`dev_absent` (Schritt 15) sowie `openapi_spec_aktuell`
  und `public_api_spec_aktuell` (`check-typ-codegen.sh`, `src/AGENTS.md`).

Geprüft und unkritisch:

- Die Login-Sperre in Router-Tests: Ohne `ConnectInfo` zählen sie keinen Fehlversuch, und die
  Dateien mit `ConnectInfo` nutzen eigene TEST-NET-Adressen. Die echten Verbindungen stehen oben.
- Kein Test setzt Umgebungsvariablen, das Arbeitsverzeichnis oder einen Panic-Hook.
- Kein Test nutzt `crate::` außerhalb von Zeichenketten.

## Mechanik

- In jeder gebündelten Datei werden `mod common;`, `mod instanz_hilfen;` und
  `mod adapter_testart;` zu `use crate::…;`. Die Bündelwurzel bindet die Hilfsmodule einmal ein.
  Eigenständige Dateien behalten `mod common;`.
- `Cargo.toml` führt jedes Testprogramm als `[[test]]`: 9 Bündel und 33 eigenständige Dateien.
- **Wächter** `tests/testprogramme_guard.rs` (Bündel `plattform`):
  - (1) Jede `tests/*.rs` steht genau einmal, als `[[test]]` in `Cargo.toml` oder als
    `#[path]`-Modul in einer Bündelwurzel.
  - (2) Eine gebündelte Datei ruft keinen prozessweiten Setzer auf und nutzt kein
    `instanz_hilfen`. Erlaubt ist nur `scan` → `init_scan_config`.
  - (3) Jeder Setzer der Liste existiert als `pub fn` in `src/`. So macht eine Umbenennung den
    Wächter nicht blind.
  - Die Mutationsproben belegen alle drei.
- Lokal: `cargo test --test buendel_<bereich> <datei>::` statt `cargo test --test <datei>`.

## CI

- `rust_tests_in_teilen` (`check-all.sh`) bleibt unverändert, es bekommt nur 42 statt 302 Ziele.
- Der Aufräumschritt „Plattenplatz schaffen“ in `suiten.yml` fällt weg. Weil der PR `suiten.yml`
  ändert, läuft er mit dem Label `voll` (`scripts/AGENTS.md`, „Wann `voll`“) und misst so den
  Fall ohne Aufräumen.
- `coverage.yml` profitiert ohne eigene Änderung. Reicht es dort trotzdem nicht, kommt ein
  Nachzug.

## Messung

Vorher und nachher, lokal (macOS, nur das Verhältnis zählt) und im PR-Lauf auf `ubuntu-latest`:
Größe von `target/debug/deps`, Anzahl der Programme, Laufzeit von Schritt 4. Die Werte stehen am
Ticket und im PR.

## Dem Bauenden überlassen

- Die genaue Zuordnung einzelner Dateien zu Fachbündeln. Das Kriterium ist der Bereich, Bündel
  sollen in etwa gleich groß sein.
- Ob ein Fachbündel geteilt wird, entscheidet der gemessene Spitzenspeicher beim Bauen.
