# 9. Architekturentscheidungen

Stand: 23.10.2026 (alpha dcc500f5).

Die tragenden Entscheidungen stehen als ADRs unter [`entscheidungen/`](entscheidungen/), eine
Datei je Entscheidung, geschrieben für Agenten, die sie vor einer Änderung lesen. Form und
Pflege regelt [`AGENTS.md`](AGENTS.md), Abschnitt „Entscheidungen (ADRs)“; die Vorlage ist
[`entscheidungen/VORLAGE.md`](entscheidungen/VORLAGE.md).

- **Aufbau:** Kopf mit `gilt_fuer` (Git-Pfadmuster), Regeln als MUST, MUST NOT oder SHOULD, ein
  Prüfblock, dann Kontext und Konsequenzen in wenigen Sätzen. Die lange Begründung steht in der
  `herleitung` (Archiv-`design.md`, Superpowers-Spec, Review).
- **Prüfung:** `scripts/check-architektur.sh` führt den Prüfblock jeder akzeptierten ADR aus; ein
  Fehlschlag heißt, der Code trägt die Entscheidung nicht mehr.
- **Unveränderlich:** Eine akzeptierte ADR ändert Regeln und Kontext nicht mehr. Eine Abkehr ist
  eine neue ADR mit `ersetzt`, die alte bekommt `status: ersetzt`.
- **Vor einer Änderung:** `scripts/adr-fuer.sh <pfad>…` nennt die ADRs, deren `gilt_fuer` die
  Datei trifft, samt ihren Regeln.

Die ADRs 0001 bis 0013 sind am 23.10.2026 nachträglich erfasst. Ihr `datum` ist der Tag der
ursprünglichen Entscheidung laut Herleitung, nicht der Tag der Niederschrift.

## 9.1 Verzeichnis der ADRs

| ID | Titel | Status | Datum | gilt für |
| --- | --- | --- | --- | --- |
| [ADR-0001](entscheidungen/ADR-0001-ein-binary-liefert-api-und-frontend.md) | Ein Rust-Binary mit axum liefert API und Frontend aus | akzeptiert | 2026-05-23 | `Cargo.toml`, `src/main.rs`, `src/app.rs`, `src/static_files.rs`, `Dockerfile` |
| [ADR-0002](entscheidungen/ADR-0002-sqlite-eingebettet-als-einzige-datenbank.md) | SQLite ist eingebettet die einzige Datenbank, angesprochen über sqlx | akzeptiert | 2026-05-23 | `Cargo.toml`, `src/db.rs`, `src/db/**`, `src/cache_db.rs`, `src/tx.rs`, `migrations/**` |
| [ADR-0003](entscheidungen/ADR-0003-live-aktualisierung-ueber-sse-mit-liveevent-kontrakt.md) | Live-Aktualisierung läuft über SSE, das Enum LiveEvent ist der Kontrakt | akzeptiert | 2026-05-23 | `src/live/**`, `src/routes/live.rs`, `src/routes/support.rs`, `frontend/src/live/**`, `frontend/src/api/queryKeys.ts`, `frontend/src/api/*.contract.test.ts`, `tests/enum_wire_kontrakt.rs` |
| [ADR-0004](entscheidungen/ADR-0004-openapi-codegen-als-api-kontrakt.md) | Antworttypen kommen per Codegen aus dem Rust-Code (OpenAPI nach TypeScript) | akzeptiert | 2026-07-08 | `src/api_doc.rs`, `frontend/src/api/**`, `scripts/check-typ-codegen.sh`, `crates/karten-katalog/**` |
| [ADR-0005](entscheidungen/ADR-0005-einsatz-autorisierung-ueber-typisierte-extractor.md) | Einsatz-Autorisierung steckt in typisierten Extractoren, nicht im Handlerrumpf | akzeptiert | 2026-07-11 | `src/einsatz/kontext.rs`, `src/einsatz/berechtigung.rs`, `src/einsatz/modul.rs`, `src/routes/**`, `tests/einsatz_kontext_guard.rs`, `frontend/src/einsatz/schreibrecht.ts` |
| [ADR-0006](entscheidungen/ADR-0006-domaenenwerte-als-wire-enum.md) | Domänenwerte mit fester Wertemenge sind Rust-Enums aus wire_enum! | akzeptiert | 2026-07-10 | `src/**/*.rs`, `tests/enum_wire_kontrakt.rs` |
| [ADR-0007](entscheidungen/ADR-0007-frontend-react-antd-tanstack-query-pwa.md) | Das Frontend ist eine React-PWA mit antd und TanStack Query | akzeptiert | 2026-05-23 | `frontend/package.json`, `frontend/vite.config.ts`, `frontend/src/main.tsx`, `frontend/src/api/queryClient.ts` |
| [ADR-0008](entscheidungen/ADR-0008-offline-lagebild-und-schreib-warteschlange.md) | Ohne Netz liest der Client ein gefiltertes Lagebild und merkt Erfassungen in einer Warteschlange vor | akzeptiert | 2026-09-30 | `frontend/src/offline/**`, `frontend/src/api/queryKeys.ts`, `frontend/src/api/queryClient.ts`, `frontend/vite.config.ts` |
| [ADR-0009](entscheidungen/ADR-0009-desktop-huelle-tauri-ohne-anwendungslogik.md) | Die Desktop-App ist eine Tauri-Hülle ohne Anwendungslogik, die die Server-Adresse lädt | akzeptiert | 2026-09-25 | `src-tauri/**`, `frontend/package.json`, `frontend/src/huelle/**` |
| [ADR-0010](entscheidungen/ADR-0010-offline-karten-aus-eigenem-build-service.md) | Offline-Karten baut ein eigener Karten-Service, der Server lädt sie nur herunter | akzeptiert | 2026-07-05 | `karten-service/**`, `karten-build/**`, `crates/karten-katalog/**`, `src/karte/download.rs`, `src/karte/katalog.rs` |
| [ADR-0011](entscheidungen/ADR-0011-anmeldewege-als-provider-mit-einer-sitzung.md) | Anmeldewege sind schaltbare Provider, die alle in dieselbe Server-Sitzung münden | akzeptiert | 2026-07-14 | `src/auth/**`, `src/routes/auth.rs` |
| [ADR-0012](entscheidungen/ADR-0012-zeit-utc-auf-dem-wire-anzeigezone-im-client.md) | Zeitpunkte reisen in UTC, angezeigt und eingegeben werden sie in der Anzeigezone | akzeptiert | 2026-10-01 | `src/zeit.rs`, `src/uhrzeit.rs`, `src/**/*.rs`, `frontend/src/anzeige/**` |
| [ADR-0013](entscheidungen/ADR-0013-openspec-traegt-den-aenderungszyklus.md) | OpenSpec trägt den Änderungszyklus, Fähigkeits-Specs liegen unter openspec/specs | akzeptiert | 2026-09-20 | `openspec/**`, `scripts/check-openspec-archiv.sh` |

## 9.2 Weitere Entscheidungen ohne eigene ADR

Diese Entscheidungen sind in Archiv-Designs hergeleitet und in einer `AGENTS.md` oder einer
Fähigkeits-Spec als Regel verankert. Sie bekommen eine ADR, sobald jemand von ihnen abweichen
will.

| Design | Entscheidung |
| --- | --- |
| [`lfh-658-migrationsnummern-vor-dem-merge`](../../openspec/changes/archive/2026-09-29-lfh-658-migrationsnummern-vor-dem-merge/design.md) | Migrationen behalten die fortlaufende Nummer; Kollisionen fängt ein Check gegen `alpha` vor dem Merge, weil sqlx eine kleinere fehlende Version still nachspielt. |
| [`lfh-1014-migrationsnummern-autofix`](../../openspec/changes/archive/2026-10-03-lfh-1014-migrationsnummern-autofix/design.md) | Ein reiner Nummernkonflikt wird per Bot-Commit auf dem PR-Branch umgelegt, nie auf `alpha`. |
| [`lfh-387-auth-zustand-tabuebergreifend`](../../openspec/changes/archive/2026-09-29-lfh-387-auth-zustand-tabuebergreifend/design.md) | Jede Schreibanfrage trägt den Benutzer, den der Tab zeigt; gehört die Sitzung inzwischen jemand anderem, antwortet der Server 412. |
| [`lfh-1312-bezeichner-sprache`](../../openspec/changes/archive/2026-10-11-lfh-1312-bezeichner-sprache/design.md) | Fachbegriffe deutsch, Technik englisch; Wire-Werte, Tabellen und Routen bleiben, wie sie sind. |
| [`lfh-23-retention-rest`](../../openspec/changes/archive/2026-09-29-lfh-23-retention-rest/design.md) | Aufbewahrung: Frist, Soft-Delete, 30 Tage Karenz, dann irreversible Schwärzung; der Org-Admin liest das pseudonyme Skelett und kann in der Karenz wiederherstellen. |
| [`lfh-749-fristen-je-datenkategorie`](../../openspec/changes/archive/2026-10-02-lfh-749-fristen-je-datenkategorie/design.md) | Aufbewahrungsfristen gelten je Datenkategorie statt einer Frist je Einsatz. |
| [`lfh-725-schwaerzung-physisch-ueberschreiben`](../../openspec/changes/archive/2026-10-01-lfh-725-schwaerzung-physisch-ueberschreiben/design.md) | Der Produktions-Pool läuft mit `secure_delete = ON`, damit geschwärzte Bytes nicht in Freelist und WAL überleben. |
| [`lfh-996-schwaerzung-clients-raeumen`](../../openspec/changes/archive/2026-10-05-lfh-996-schwaerzung-clients-raeumen/design.md) | Nach einer Schwärzung meldet der Purge-Lauf `einsatz` und `einsatzliste` an offene Clients, damit sie geschwärzte Werte nicht weiter zeigen. |
| [`lfh-767-geraet-raeumung-abmelden`](../../openspec/changes/archive/2026-10-02-lfh-767-geraet-raeumung-abmelden/design.md) | Beim Abmelden räumt das Gerät alle personenbezogenen Daten, nicht nur das Lagebild. |
| [`lfh-942-browserspeicher-abgesichert`](../../openspec/changes/archive/2026-10-06-lfh-942-browserspeicher-abgesichert/design.md) | Jeder Zugriff auf Browserspeicher ist abgesichert; ohne `localStorage` startet die App trotzdem. |
| [`lfh-937-eingabegrenzen`](../../openspec/changes/archive/2026-10-06-lfh-937-eingabegrenzen/design.md) | Freitexte und Listen von außen haben feste Grenzen (`*_MAX`), geprüft, bevor eine Abfrage läuft; darüber antwortet der Server 400. |
| [`lfh-669-modulfreigabe-vom-server`](../../openspec/changes/archive/2026-10-01-lfh-669-modulfreigabe-vom-server/design.md) | Ob ein Modul frei ist, rechnet nur der Server und liefert das Ergebnis an den Client. |
| [`lfh-612-serverseitige-zaehler`](../../openspec/changes/archive/2026-09-29-lfh-612-serverseitige-zaehler/design.md) | Zahlen im ETB-Kopf und an den Modulen liefert der Server, nur für Module, die der Benutzer sehen darf. |
| [`lfh-922-live-neuladeflut`](../../openspec/changes/archive/2026-10-06-lfh-922-live-neuladeflut/design.md) | Live-Ereignisse lösen gebündelte Neuabrufe aus, verdeckte Tabs rufen erst beim Zurückwechseln ab, und nach einem Wiederaufbau ersetzt der Replay über `Last-Event-ID` den Vollabgleich. |
| [`lfh-931-listen-gezielt-nachladen`](../../openspec/changes/archive/2026-10-06-lfh-931-listen-gezielt-nachladen/design.md) | Lagebericht-, Befehls- und Pressemitteilungslisten liefern nur Kopfdaten; ändert sich nur ein Abschnittstext, laden andere Tabs nur das Detail. |
| [`lfh-892-funktionsansichten-geraete`](../../openspec/changes/archive/2026-10-05-lfh-892-funktionsansichten-geraete/design.md) | Ausgegebene Geräte melden sich über eine Kopplung an, gebunden an eine Stelle und eine Funktionsansicht statt an eine Person. |
| [`kcjecn9e-benachrichtigungskonzept`](../../openspec/changes/archive/2026-10-15-kcjecn9e-benachrichtigungskonzept/design.md) | Ein Gesamtkonzept legt fest, welches Ereignis wen wie laut erreicht. |
| [`lfh-690-demo-daten-laufzeit-import`](../../openspec/changes/archive/2026-09-29-lfh-690-demo-daten-laufzeit-import/design.md) | Demo-Daten spielt ein System-Admin im laufenden Betrieb ein, freigeschaltet über `--demo-daten`, im selben Binary. |
| [`lfh-1053-schreibweisen-waechter`](../../openspec/changes/archive/2026-10-05-lfh-1053-schreibweisen-waechter/design.md) | Ein Wächter verbietet Dateinamen, die sich nur in der Groß- und Kleinschreibung unterscheiden. |
| [`uzfj5f43-design-system-aus-code`](../../openspec/changes/archive/2026-10-19-uzfj5f43-design-system-aus-code/design.md) | Das Design System wird aus dem Code erzeugt und versioniert unter `docs/design/design-system/` abgelegt; ein Wächter macht Drift rot. |

Ohne datierbare Herleitung im Repo und deshalb ohne ADR: die Regelablage je Bereich in
`AGENTS.md`-Dateien (LFH-556, Wurzel-[`AGENTS.md`](../../AGENTS.md), „Wo die Regeln stehen“) und
das Sammel-Gate `scripts/check-all.sh` als einzige Wahrheit der CI (LFH-235/F17, ebenda,
„Qualitäts-Gates“).
