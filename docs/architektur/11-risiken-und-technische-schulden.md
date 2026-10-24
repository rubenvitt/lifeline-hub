# 11. Risiken und technische Schulden

Stand: 23.10.2026 (alpha dcc500f5).

Grundlage ist das [Architektur-Review vom 11.07.2026](../architektur-review-2026-07-11.html)
mit 46 Befunden (F01 bis F36, G01 bis G10). Jeder Befund ist am Code und in Zunder (Projekt
„Dev: Lifeline-Hub“, Stränge LLH-208 bis LLH-214) geprüft. In Zunder sind alle 46 Aufgaben
erledigt; im Code sind 39 Befunde behoben, bei sieben bleibt ein Rest (Abschnitt 11.1). Dazu
kommen Risiken, die das Review nicht kannte (Abschnitt 11.2). Jede Zeile nennt den Beleg im
Repository; was sich nicht belegen ließ, fehlt hier.

## 11.1 Offene Reste aus dem Review

| Nr | Beschreibung | Auswirkung | Beleg | Aufgabe |
|---|---|---|---|---|
| R01 | F04: Die Module `befehl` und `lagebericht` stehen noch in `DEFERRED_MODULE`; ihre Einsatz-Handler tragen keinen typisierten Gate-Extractor, sondern prüfen per `fordere_lesezugriff`/`darf_lesen`. | Der Guard erzwingt dort weder Gate noch passenden Modul-Marker; eine vergessene Prüfung fiele keinem Test auf. Org-sicher sind die Module seit LFH-115. | `tests/einsatz_kontext_guard.rs` (Kopf und `DEFERRED_MODULE`), [ADR-0005](entscheidungen/ADR-0005-einsatz-autorisierung-ueber-typisierte-extractor.md) | Folge-Migration laut Guard-Kommentar; LLH-220 erledigt |
| R02 | F21: Jeder Tab hält eine eigene SSE-Verbindung; tab-übergreifendes Teilen fehlt. | Über HTTP/1.1 teilen sich alle Tabs eines Origins das Verbindungslimit des Browsers; viele offene Tabs blockieren weitere Anfragen. `--tls` (HTTP/2) mildert das. | `frontend/src/live/useEinsatzLiveStream.ts` (Kopfkommentar), [`docs/betrieb-tls.md`](../betrieb-tls.md) | LFH-264 laut Code; in Zunder nicht auffindbar |
| R03 | F15: `frontend/src/pages/LagekartePage.tsx` hat 2137 Zeilen und steuert die Exklusiv-Modi weiter selbst (`exklusiverModusAktiv`). | Jede Änderung an der Lagekarte läuft durch eine sehr große Komponente. | `frontend/src/pages/LagekartePage.tsx` | LLH-233 erledigt |
| R04 | F25: `src/routes/karte.rs` hat 2753 Zeilen, obwohl die Kartenlogik inzwischen auf Module unter `src/karte/` verteilt ist. | Der Route-Layer der Karte bleibt schwer überschaubar. | `src/routes/karte.rs`, `src/karte/` | LLH-242 erledigt |
| R05 | F26: Der Ordnerzyklus ist behoben (SSE-Infrastruktur in `frontend/src/live/`), aber Seiten liegen weiter teils in `frontend/src/pages/`, teils in Feature-Ordnern wie `frontend/src/etb/`. | Für neuen Frontend-Code gibt es zwei Ablageorte. | `frontend/src/pages/`, `frontend/src/live/` | LLH-244 erledigt |
| R06 | G03: Anhänge und Kartenhintergründe liegen als BLOB in der Kern-Datenbank; das ist bewusst beibehalten, damit das Backup sie vollständig erfasst. Uploads sind auf 25 MiB gedeckelt. | Mit dem Volumen wachsen Datenbank, Backup-Dauer und Schreiblast des einzigen Schreibers (R09). Neubewertung bei Volumendruck, dann eigene Anhang-SQLite statt Object-Store. | `src/anhang/mod.rs` (Kopf, `MAX_GROESSE`), `migrations/0052_anhang.sql`, `migrations/0075_karte_hintergrundbild.sql` | LLH-238 „akzeptiert und zurückgestellt“ |
| R07 | G05: Der Virenscan ist ohne `--clamav-addr` ein No-op; mit clamd ist er fail-closed (503). | Ohne konfigurierten clamd landen Uploads ungeprüft in der Datenbank. | `src/AGENTS.md` (Abschnitt zum Scan), `src/anhang/mod.rs` | LLH-228 erledigt |

## 11.2 Weitere Risiken und Schulden

| Nr | Beschreibung | Auswirkung | Beleg | Aufgabe |
|---|---|---|---|---|
| R08 | SQLite und OpenSSL sind ins Binary eingebacken (`bundled`, `vendored`). Ob gehärtete Installationen eine vom Betriebssystem gepflegte `libsqlite` bekommen, ist bewusst offen. | Eine CVE schließt nur ein Rebuild mit neuem Rollout; ein System-Update auf dem Zielrechner erreicht die Kopien nie. | [`docs/betrieb/packaging.md`](../betrieb/packaging.md) („Eingebettetes SQLite“, Patch-Pfad), `Cargo.toml` (`openssl` mit `vendored`), `tests/sqlite_version.rs` | – |
| R09 | SQLite hat einen Schreiber. Schreibtransaktionen laufen über `write_retry!` mit `BEGIN IMMEDIATE`, nach `MAX_VERSUCHE` (4) antwortet der Server 503; der Pool hat fünf Verbindungen und 10 s `acquire_timeout`. | Unter dichter Schreiblast oder auf langsamen Datenträgern steigen Latenz und 503-Antworten. Die Mindest-Schreibrate des Datenträgers ist deshalb Betriebsvorgabe. | `src/tx.rs`, `src/db.rs` (`connect`), `docs/betrieb/packaging.md` („Mindest-Schreibrate“, LFH-1052), [ADR-0002](entscheidungen/ADR-0002-sqlite-eingebettet-als-einzige-datenbank.md) | – |
| R10 | Der Server läuft als genau eine Instanz: Live-Verteilung (`tokio::sync::broadcast` im `LiveHub`), WebAuthn- und OIDC-Zeremonien und Ratenbegrenzung liegen im Prozessspeicher. Eine Sperre gegen einen zweiten Prozess auf derselben Datenbank gibt es nicht; nur der Restore prüft auf `-wal`/`-shm`. | Ein zweiter Prozess auf derselben Datei sähe die Live-Ereignisse und Zeremonien des ersten nicht. Horizontal skalieren lässt sich der Server nicht. | `src/live/mod.rs`, `src/auth/webauthn/state.rs`, `src/auth/oidc/state.rs`, `src/backup/restore.rs` (`ziel_moeglicherweise_in_benutzung`) | – |
| R11 | sqlx spielt eine nachträglich eingeschobene kleinere Migrationsnummer still nach. Zwei Branches mit derselben oder einer überholten Nummer laufen so auf bestehenden Datenbanken in falscher Reihenfolge. | Abgesichert durch `scripts/check-migrationen.sh`, den Status `Migrationsnummern` und `scripts/migrationen-autofix.sh`. Fehlt der Pflicht-Check im Ruleset, warnt nur der Push-Lauf. | `src/db.rs` (`sqlx_spielt_eingeschobene_kleinere_version_still_nach`), `.github/workflows/migrationen.yml`, Wurzel-`AGENTS.md` („Backend — Migrationsvergabe“) | – |
| R12 | Ein Entzug eines Modulrechts wirkt auf einen offenen Live-Strom erst beim nächsten Verbindungsaufbau, spätestens nach `STROM_LEBENSDAUER + STROM_LEBENSDAUER_STREUUNG` (45 min). Das Ende der Sitzung wirkt sofort. | Im Restfenster sieht der Nutzer Ereignis-Metadaten (nur IDs); der Inhaltsabruf antwortet sofort 403. | `src/routes/live.rs` (Kopfkommentar, LFH-920, LFH-1092) | – |
| R13 | Der Offline-Kartenkatalog ist ein Platzhalter: `OFFLINE_KATALOG_MANIFEST_URL` zeigt auf `https://TODO-karten-build-release/…`, die einkompilierten Einträge in `default_offline_katalog` tragen keine `sha256`, und `remote_eintrag_ist_gueltig` verwirft solche Einträge. | Ohne `--offline-katalog-manifest-url` (`LIFELINE_OFFLINE_KATALOG_MANIFEST_URL`) bietet der Server keine ladbaren Offline-Karten an. | `src/karte/katalog.rs`, `src/config.rs` (`default_offline_katalog`, `offline_katalog_manifest_url`), `crates/karten-katalog/src/lib.rs` | Release von `karten-build` (Operator-Pin laut `src/config.rs`) |
| R14 | Die User-Agents der ausgehenden Abrufe enden auf den Platzhalter `(+https://github.com/)` ohne Projektadresse. Ohne eigene `geocoder_url` der Organisation fragt der Server den öffentlichen Nominatim. | Die Nutzungsregeln von Nominatim verlangen eine Kennung, über die der Betreiber erreichbar ist; ohne sie droht eine Sperre der Ortssuche. | `src/geocoding/mod.rs` (`user_agent`, `NOMINATIM_DEFAULT`), `src/karte/mod.rs`, `src/karte/download.rs`, `src/karte/proxy.rs`, `src/routes/ort_suche.rs` | – |
| R15 | Der Kartenbau zieht `versatiles/versatiles-planetiler:latest` ohne Digest. | Zwei Builds desselben Stands können verschiedene Kacheln liefern; eine neue Image-Version wirkt unbemerkt. | `karten-build/Makefile` (`IMAGE`) | – |
| R16 | Die KRITIS-Fachebene ist per Vorgabe an und lädt alle 168 Stunden den Deutschland-Extrakt von Geofabrik, rund 4–5 GB je neuem Extrakt. | Jede Instanz erzeugt diesen Verkehr, auch im Entwicklungsbetrieb, bis `--kritis-extrakt false` oder ein eigener Spiegel (`--kritis-extrakt-url`) gesetzt ist. | `src/config.rs` (`kritis_extrakt`, `kritis_extrakt_url`, `kritis_extrakt_intervall_stunden`) | – |
| R17 | Das Ausrollen übernimmt ein Pull-Agent auf dem Zielserver, der nicht im Repository liegt. | Den letzten Schritt der Auslieferung kann hier niemand prüfen oder ändern. | `.github/workflows/deployment.yml` (Kopfkommentar) | – |
| R18 | Der Windows-Installer der Desktop-App ist nicht signiert; macOS ist signiert und notarisiert. | SmartScreen warnt bei der Installation; Nutzer müssen die Warnung übergehen. | `docs/betrieb/desktop-app.md` („Signierung unter Windows“), `.github/workflows/desktop.yml` | LFH-875, Zunder LLH-745 (offen) |
| R19 | Die Datenbank liegt im Klartext auf der Platte, samt Anhängen; die Anwendung verschlüsselt nicht selbst. Datenträgerverschlüsselung ist Pflicht, der Server prüft sie stündlich, warnt aber nur. | Ein verlorenes Gerät ohne Verschlüsselung gibt alle Einsatzdaten preis. | `docs/betrieb/packaging.md` („Datenträgerverschlüsselung ist Pflicht“, LFH-1004, LFH-1100), `src/datentraeger/` | – |
| R20 | Die Schuldmenge `OFFEN` des Zeitdarstellungs-Guards ist leer; er findet `.format(…)` und `formatiere(…)` mit Zeit-Token außerhalb von `frontend/src/anzeige/`. Er liest Quelltext: ein Format aus einer Konstanten, `Intl.DateTimeFormat` oder ein eigener Helfer anderen Namens (`replace(':', '')`) entgeht ihm. | Eine solche Stelle zeigt Zeiten immer taktisch statt in der gewählten Darstellung; nur das Review fängt sie. | `frontend/src/anzeige/zeitDarstellung.guard.test.ts` (Kopfkommentar, `OFFEN`), [ADR-0012](entscheidungen/ADR-0012-zeit-utc-auf-dem-wire-anzeigezone-im-client.md) | LLH-1061 erledigt, LLH-1437 |
| R21 | Die Betriebsdoku nennt für den Kachel-Proxy „kein Single-Flight“, der Code bündelt gleichzeitige Erst-Abrufe derselben URL seit LFH-930. | Die Doku beschreibt ein überholtes Verhalten. | `docs/betrieb/packaging.md` (Abschnitt „Lagekarte / Basemap“, v1-Grenzen), `src/karte/tile_cache.rs` (`INFLIGHT`) | – |

## 11.3 Behobene Befunde aus dem Review

Die Zunder-Kennung ist jeweils die Aufgabe zum Befund; Unteraufgaben sind nicht aufgeführt.

| ID | Befund in einem Satz | Behoben durch |
|---|---|---|
| F01 | Ein Broadcast je Einsatz verteilte Volltexte ohne Modulprüfung. | Ein Live-Feed mit Filter je Ereignis und reinen ID-Nutzlasten (`src/live/mod.rs`, `src/routes/live.rs`); LLH-217 |
| F02 | Die DSGVO-Schwärzung war eine handgepflegte Spaltenliste mit Lücken. | Registry `src/einsatz/schwaerzung_registry.rs`; LLH-219 |
| F03 | Die Offline-Warteschlange verlor Einträge und konnte Duplikate erzeugen. | Idempotenzschlüssel `client_id` (`frontend/src/offline/clientId.ts`, Migrationen 0088 und 0098); LLH-251 |
| F04 | Die Einsatz-Autorisierung war eine kopierte Konvention in den Handlern. | Typisierte Extractor (`src/einsatz/kontext.rs`) und Guard; Rest siehe R01; LLH-220 |
| F05 | Die Org-Grenze war nur halb umgesetzt. | `berechtigung::fordere_org_zugehoerigkeit`, `tests/org_scope_guard.rs`; LLH-222 |
| F06 | ETB-Einträge entstanden nicht-atomar nach dem Domain-Commit. | System-ETB-Eintrag atomar in der Domain-Transaktion (F06/LFH-244, z. B. `src/einheit/mitglied_repo.rs`); LLH-234 |
| F07 | Constraint-Verletzungen schlugen als 500 durch. | Sicherheitsnetz in `src/error.rs` (UNIQUE/FK → 409, CHECK → 422); LLH-235 |
| F08 | Hard-Deletes scheiterten an blockierenden Fremdschlüsseln. | `migrations/0089_auftrag_empfaenger_on_delete_set_null.sql`; LLH-227 |
| F09 | Read-then-Write lief in DEFERRED-Transaktionen ohne Retry. | `write_retry!` mit `BEGIN IMMEDIATE` (`src/tx.rs`); LLH-230 |
| F10 | Edit-Pfade überschrieben sich gegenseitig (Lost Update). | Optimistische Sperre über `basis_geaendert_at` (`src/AGENTS.md`); LLH-231 |
| F11 | Die Karten-Domäne umging den Typ-Codegen. | Crate `karten-katalog`, `ToSchema`-DTOs, `frontend/src/api/kartenSchema.typetest.ts`; LLH-255 |
| F12 | PATCH machte nullable Felder unlöschbar. | Drei-Zustands-PATCH (`patchTriState`, LFH-266); LLH-256 |
| F13 | SSE-Ereignisnamen hatten keinen Kontrakt zwischen Server und Client. | Enum `LiveEvent` mit Kontrakttests ([ADR-0003](entscheidungen/ADR-0003-live-aktualisierung-ueber-sse-mit-liveevent-kontrakt.md)); LLH-252 |
| F14 | Verpasste Live-Ereignisse gingen beim Reconnect verloren. | Replay-Ringpuffer und Resync mit `Last-Event-ID` (`src/live/mod.rs`, LFH-263); LLH-253 |
| F15 | `LagekartePage` war eine God-Component. | Teilweise; Rest siehe R03; LLH-233 |
| F16 | Die Schreibrecht-Regel war 30-fach kopiert. | `frontend/src/einsatz/schreibrecht.ts` mit Guard; LLH-224 |
| F17 | Qualitäts-Gates hatten keine Durchsetzung. | `scripts/check-all.sh` und `.github/workflows/ci.yml`; LLH-225 |
| F18 | Sicherheitsrelevante Umgebungsschalter liefen am Config-System vorbei. | Schalter in `src/config.rs`, `tests/env_config_guard.rs` (LFH-239); LLH-229 |
| F19 | Ein frischer Checkout brach den Backend-Build. | `frontend/.gitignore` hält `frontend/dist` für den ersten `cargo build` bereit (LFH-242/F19); LLH-232 |
| F20 | Sitzungstoken lagen im Klartext in der Datenbank. | SHA-256-Hash (`hash_token` in `src/auth/session.rs`); LLH-226 |
| F21 | Mehrere Tabs erschöpften das HTTP/1.1-Limit. | Eine Verbindung je Tab; Rest siehe R02; LLH-254 |
| F22 | 400 und 422 waren willkürlich verteilt. | Statuscode-Konvention in `src/AGENTS.md` (LFH-267); LLH-257 |
| F23 | Die Kräftelisten luden mit einer O(N²)-Query-Kaskade. | Gebündelte Abfragen je `einheit_id` (`src/einheit/mitglied_repo.rs`, LFH-225); LLH-215 |
| F24 | Fehler- und 401-Behandlung war 86-fach kopiert. | Zentrale `MutationCache`/`QueryCache` in `frontend/src/api/queryClient.ts`; LLH-258 |
| F25 | `routes/karte.rs` trug Domänenlogik im Route-Layer. | Logik nach `src/karte/` verschoben; Rest siehe R04; LLH-242 |
| F26 | Zwei Ablageschemata und ein Ordnerzyklus im Frontend. | Zyklus aufgelöst (`frontend/src/live/`); Rest siehe R05; LLH-244 |
| F27 | Kontrakt-Guards waren Closed-World. | AST-basierter Guard (LLH-302); LLH-259 |
| F28 | Der Test-Pool entsprach nicht der Produktion. | Datei-Pool mit WAL im Test (`test_pool_datei_deckt_read_then_write_busy_auf` in `src/db.rs`); LLH-237 |
| F29 | Die e2e-Suite war nicht selbsttragend. | Playwright startet den Server selbst (`webServer`); LLH-236 |
| F30 | Request-Log und Anmelde-Audit fehlten. | Anmelde-Audit `src/auth/audit.rs` (LFH-249), `tests/anmelde_audit_guard.rs`; LLH-239 |
| F31 | Das Backup lag ganz im RAM, ein automatisches fehlte. | Streaming (`Body::from_stream` in `src/routes/backup.rs`), Planer `src/backup/scheduler.rs` mit `--backup-verzeichnis`; LLH-241 |
| F32 | Eine Basename-Kollision versteckte einen Test vor `tsc`. | Doppelte Datei entfernt; LLH-245 |
| F33 | Die `einsatz_*`-Routen kopierten Hilfsfunktionen. | Gemeinsames Fundament `src/routes/support.rs`; LLH-246 |
| F34 | UNIQUE-Indizes fehlten, `debug_assert` wirkte im Release nicht. | UNIQUE-Indizes (`migrations/0090_lfd_nr_unique.sql`), Invarianten auch im Release (`src/auftrag/repo.rs`, LFH-259); LLH-249 |
| F35 | Panics rissen Anfragen ohne Abfederung ab. | `CatchPanicLayer` in `src/app.rs`; LLH-250 |
| F36 | Deeplinks wurden lokal nachgebaut. | Deeplinks über `frontend/src/routing/deeplinks.ts` (LFH-257, Tests in `frontend/src/erinnerung/`); LLH-247 |
| G01 | Abhängigkeiten wurden nicht auf Schwachstellen geprüft. | `scripts/check-deps.sh` und `.github/dependabot.yml`; LLH-243 |
| G02 | Die eingebettete SQLite war nicht versionsgenau nachverfolgt. | Abschnitt in `docs/betrieb/packaging.md`, `tests/sqlite_version.rs`; Restrisiko siehe R08; LLH-223 |
| G03 | Binäre Assets liegen als BLOB in der Kern-Datenbank. | Bewusst beibehalten; siehe R06; LLH-238 |
| G04 | Asset-Auslieferung hatte kein HTTP-Caching. | `If-None-Match`/`Cache-Control` (`src/anhang/repo.rs`, LFH-258); LLH-248 |
| G05 | Der AV-Scan war ein dauerhafter No-op. | clamd-Anbindung, fail-closed; Rest siehe R07; LLH-228 |
| G06 | Anhänge hatten keinen Freigabepfad. | Aufräumen verwaister Anhänge (`VERWAISTE_KARENZ_STUNDEN`, LFH-250); LLH-240 |
| G07 | Argon2id lief synchron und ungedrosselt auf dem Tokio-Worker. | `spawn_blocking` mit KDF-Slot (`src/auth/provider/password.rs`); LLH-260 |
| G08 | Der Router hatte keine Zulassungssteuerung. | `src/zulassung.rs`, `tests/zulassung_guard.rs`; LLH-216 |
| G09 | Der Pool wartete 30 s statt schnell 503 zu melden. | `acquire_timeout` 10 s (`src/db.rs`); LLH-218 |
| G10 | Es gab keinen Schutz gegen Slow-Loris. | `header_read_timeout` (`src/verbindung.rs`); LLH-221 |
