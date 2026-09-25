# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. „Verifiziert“ heißt, der genannte Test läuft grün **und** war vorher rot.

## 1. Schema und Schwärzung

- [x] 1.1 `scripts/check-migrationen.sh` gegen frisches `origin/alpha` laufen lassen und die nächste freie Nummer bestätigen (Stand Entwurf: `0121`). Verifiziert, wenn das Skript die Nummer als frei meldet.
- [x] 1.2 `migrations/0122_betreuung_client_id.sql`: `ADD COLUMN client_id TEXT` an `evakuierung_stand` und `betreuungsstelle_belegung`, je ein partieller UNIQUE-Index `(einsatz_id, client_id) WHERE client_id IS NOT NULL` (D1). Verifiziert mit einem `db`-Test nach dem Muster `etb_client_id_migration_partieller_unique`: mehrere NULL erlaubt, dieselbe `client_id` im selben Einsatz verletzt UNIQUE, in einem anderen Einsatz nicht.
- [x] 1.3 `src/einsatz/schwaerzung_registry.rs`: `retain("client_id", G_IDEMPOTENZ)` in beiden Tabellenregeln (D9). Verifiziert, wenn die Vollständigkeits-Tests der Registry grün sind. Sie sind nach 1.2 ohne den Eintrag rot.

## 2. Repo: idempotentes Melden

- [x] 2.1 `Gemeldet` um `neu: bool` erweitern. Lese-Funktionen `stand_nach_client_id` / `belegung_nach_client_id` (einsatzgebunden, liefern Meldungs- und Objektkennung) ergänzen. Verifiziert mit einem Repo-Test „Lookup in anderem Einsatz findet nichts“.
- [x] 2.2 `StandEingabe`/`BelegungEingabe` tragen `client_id: Option<String>`, `stand_melden_tx` wertet ihn aus. Erster Schritt ist der Lookup in der Transaktion: bei Treffer am selben Bezirk `Gemeldet { neu: false, … }` ohne ETB, Zeile und Zeigerschreiben; bei Treffer an anderem Bezirk 422 (D2, D3). Verifiziert mit Repo-Tests: Replay erzeugt keine zweite Zeile und keinen zweiten ETB-Eintrag, Stand unverändert; Replay nach Stornieren des Bezirks liefert die Meldung; fremder Bezirk ist 422.
- [x] 2.3 Wie 2.2 für `belegung_melden_tx`. Verifiziert mit Repo-Tests: Replay ohne Dublette; Replay nach Schließen der Stelle liefert die Meldung statt 422; neue `client_id` an geschlossener Stelle bleibt 422.
- [x] 2.4 Beleg „absolute Meldungen machen Replays unkritisch“: Repo-Test, der „200 @ 10:00“ nach „480 @ 10:15“ einspielt und danach dieselbe „200“ noch einmal. Verifiziert, wenn der aktuelle Stand 480 bleibt, genau eine „200“-Zeile existiert und der ETB-Eintrag „nachgetragen“ nennt.
- [x] 2.5 Leermeldung und Bestandsaufrufer von `belegung_melden_tx`/`stand_melden_tx` übergeben `None`. Verifiziert mit `cargo test` für die bestehenden Betreuungs-Tests (`src/betreuung/repo/tests.rs`, `tests/betreuung.rs`), die ohne Änderung an ihren Erwartungen grün bleiben.

## 3. Routen

- [x] 3.1 `StandMelden`/`BelegungMelden` um `client_id: Option<String>` erweitern. Normalisierung: trim, leer heißt fehlend, mehr als 64 Zeichen ist 400. Verifiziert in `tests/betreuung.rs` (65 Zeichen → 400, nichts gespeichert).
- [x] 3.2 `stand_melden`/`belegung_melden` auf `EinsatzSchreibfreigabe<Betreuung>` umstellen. Reihenfolge: Header-Prüfung `fordere_offline_queue_benutzer`, Vorab-Lookup samt Pfadprüfung, `fordere_aktiv`, Validierung, Transaktion. Live-Ereignis nur bei `neu` (D2, D5). Verifiziert in `tests/betreuung.rs`: Replay ist 201 mit derselben `meldung_id` und genau einem ETB-Eintrag; Replay nach Einsatzabschluss ist 201, eine neue Meldung dort bleibt abgelehnt; abweichender Queue-Header wird abgewiesen; Beobachter ohne Schreibrecht bleibt 403.
- [x] 3.3 Live-Test: Ein Replay sendet kein zweites `betreuung`-Ereignis. Verifiziert in `tests/betreuung.rs` nach dem Muster `live_ereignis_nur_an_leser_mit_modulrecht` (Erstmeldung: ein Ereignis; Replay: keines).

## 4. Frontend: API und Queue

- [x] 4.1 `api/types.ts`: `client_id?: string` an `StandmeldungEingabe` und `BelegungsmeldungEingabe`. `meldeStand`/`meldeBelegung` in `api/betreuung.ts` nehmen die Request-Optionen (`offlineQueueBenutzerId`) wie `legeMeldungAn`. Verifiziert mit `tsc` (`scripts/check-typ-codegen.sh`).
- [x] 4.2 `offline/queue.ts`: `OfflineSchreibaktion` um `stand` (`bezirk_id`, `bezeichnung`, `daten`) und `belegung` (`stelle_id`, `bezeichnung`, `daten`) erweitern, ohne Versionssprung (D7). Verifiziert mit `schreiben.test.ts` (vorgemerkte `stand`-/`belegung`-Aktion wird unverändert zurückgelesen) und `tsc`.
- [x] 4.3 `offline/schreiben.ts`: `erfasseStandOfflineFaehig` / `erfasseBelegungOfflineFaehig` nach dem Muster `erfasseMeldungOfflineFaehig`, dazu der Erfassungszeitpunkt nur in der vorgemerkten Kopie (D6). Verifiziert mit `schreiben.test.ts`: offline → `vorgemerkt` mit `zeitpunkt_at` der Erfassung; online-Erfolg → gesendet **ohne** zugesetzten `zeitpunkt_at`; transienter Fehler → vorgemerkt mit derselben `client_id` wie der Versuch; fachlicher Fehler wirft.
- [x] 4.4 `offline/useOfflineSync.ts`: exhaustive `if`-Kette über `aktion.art` mit `never`-Zweig (kein `switch`, siehe D7); `stand`/`belegung` senden mit `offlineQueueBenutzerId`, entfernen die Zeile und invalidieren `einsatzKeys.betreuung` und `einsatzKeys.etb` (D7). Verifiziert mit `useOfflineSync.test.tsx`: Erfolg entfernt die Zeile und invalidiert beide Keys; 422 legt sie unter `abgelehnt` ab; transienter Fehler lässt sie stehen.
- [x] 4.5 `offline/OfflineRecoveryDrawer.tsx`: `aktionsTitel` exhaustiv um „Standmeldung“/„Belegungsmeldung“ erweitern. Verifiziert mit `OfflineRecoveryDrawer.test.tsx`: eine abgelehnte `stand`-Aktion erscheint als „Abgelehnte Standmeldung“ mit Grund und Bezeichnung im Inhalt.

## 5. Frontend: Seite

- [x] 5.1 `pages/BetreuungPage.tsx`: `standMut`/`belegungMut` über die offline-fähigen Funktionen; `vorgemerkt` → Warn-Toast ohne Rückgängig, Dialog schließt; `gesendet` unverändert mit Rückgängig; `leermeldungMut` bleibt direkt (D8). Verifiziert mit `BetreuungPage.test.tsx`: offline gemeldete Belegung zeigt „Offline vorgemerkt“ und keinen Rückgängig-Knopf; online bleibt der Rückgängig-Toast.

## 6. Abschluss

- [x] 6.1 Doku: Nachtrag in `CLAUDE.md` im Absatz zur Betreuung bzw. im Offline-Kontext (eine knappe Zeile: Stand/Belegung offline-fähig, Replay vor Zustandsprüfung, Erfassungszeitpunkt nur in der Kopie) und in `openspec/changes/lfh-639-fachmodul-betreuung/design.md` beim Non-Goal einen Verweis „eingelöst durch LFH-675“. Verifiziert per Sichtprüfung des Diffs.
- [x] 6.2 `./scripts/check-all.sh` vollständig grün (inkl. Prettier, Lint, Typ-Codegen, `cargo test`, Vitest, e2e, `check-migrationen.sh`). Verifiziert durch Exit-Code 0 ohne `| tail`. **Ergebnis:** Schritte 1–6 grün (5969 Vitest-Tests), e2e 247/248. Rot war `e2e/dokumente.spec.ts:423` (Timeout beim Warten auf `filechooser`, Last ~150), einzeln 3/3 grün in je ~2,7 s, das Modul ist unberührt. Schritte 8–10 danach einzeln grün. Nach dem Merge von `origin/alpha` (LFH-678/679) erneut grün: Typ-Drift, Lint, Prettier, Betreuungs-Tests in Rust und Frontend.
- [x] 6.3 Handprobe im Dev-Stack: Belegung bei abgeschaltetem Netz (DevTools offline) melden, Toast „vorgemerkt“ prüfen, Netz an, Belegung erscheint mit Erfassungszeitpunkt und genau einem ETB-Eintrag. Verifiziert per Screenshot bzw. ETB-Zählung. **Ergebnis:** gegen das frisch gebaute Binary per API und nicht im Browser, weil die Anmeldung im Browser ein Passwort verlangt. Doppelter Flush einer um −30 min erfassten „200“ nach online „480 @ −15 min“: eine Meldung, ein ETB-Eintrag „nachgetragen, bleibt 480“ mit Erfassungszeit. Fremder Queue-Besitzer 412, Replay an geschlossener Stelle 201, neue Meldung dort 422. Den Oberflächenweg (offline → Toast → Queue) belegt `BetreuungPage.test.tsx`.
