# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. „Verifiziert“ heißt: Der genannte Test läuft grün **und** war vorher rot.

## 1. Schema und Schwärzung

- [x] 1.1 `git fetch origin alpha` und `scripts/check-migrationen.sh`, um die nächste freie Nummer zu bestätigen (Stand Entwurf: `0131`). Verifiziert, wenn das Skript die Nummer als frei meldet.
- [x] 1.2 `migrations/0131_verpflegung_ausgabe_client_id.sql`: `ADD COLUMN client_id TEXT` an `verpflegung_ausgabe` und partieller UNIQUE-Index `(einsatz_id, client_id) WHERE client_id IS NOT NULL` (D1). Verifiziert mit einem `db`-Test nach dem Muster der Betreuung (0122): Mehrere NULL sind erlaubt, dieselbe `client_id` im selben Einsatz verletzt UNIQUE, in einem anderen Einsatz nicht.
- [x] 1.3 `src/einsatz/schwaerzung_registry.rs`: `retain("client_id", G_IDEMPOTENZ)` in der Regel `verpflegung_ausgabe` (D10). Verifiziert, wenn die Vollständigkeits-Tests der Registry grün sind. Nach 1.2 und ohne den Eintrag sind sie rot.

## 2. Repo: idempotentes Erfassen

- [x] 2.1 `laden_nach_client_id(pool, einsatz_id, client_id)` in `src/verpflegung/repo.rs`. Die Funktion ist einsatzgebunden und liefert Ausgabe- und Zeitfensterkennung. Verifiziert mit Repo-Tests: Der Lookup findet die Ausgabe im eigenen Einsatz und findet im anderen Einsatz nichts.
- [x] 2.2 `AusgabeEingabe` trägt `client_id: Option<String>`, `AusgabeGeschrieben` trägt `neu: bool`. Erster Schritt in `ausgabe_erfassen_tx` ist der Lookup. Bei einem Treffer am selben Zeitfenster gibt er `neu: false` ohne INSERT zurück, bei einem Treffer an einem anderen Zeitfenster 422 (D2, D3). Verifiziert mit Repo-Tests: Ein Replay erzeugt keine zweite Zeile, und die Deckung bleibt gleich. Ein Replay einer zurückgenommenen Ausgabe liefert sie, ohne Neuanlage (D4). Ein fremdes Zeitfenster ist 422.
- [x] 2.3 Bestandsaufrufer (`src/verpflegung/repo/tests.rs`, `src/einsatz/purge_scheduler.rs`) übergeben `client_id: None`. Verifiziert, wenn `cargo test` für die bestehenden Verpflegungs- und Purge-Tests ohne geänderte Erwartungen grün bleibt.

## 3. Route

- [x] 3.1 `AusgabeErfassen` um `client_id: Option<String>` erweitern. Normalisierung: trimmen, leer gilt als fehlend, mehr als 64 Zeichen sind 400. Verifiziert in `tests/verpflegung.rs`: 65 Zeichen ergeben 400, und nichts ist gespeichert.
- [x] 3.2 `ausgabe_erfassen` auf `EinsatzSchreibfreigabe<Verpflegung>` umstellen. Reihenfolge: `fordere_offline_queue_benutzer`, Normalisierung, Vorab-Lookup samt Pfadprüfung, `fordere_aktiv`, Zeitpunkt, Nachforderung, Transaktion. Das Live-Ereignis geht nur bei `neu` hinaus (D2, D5). Verifiziert in `tests/verpflegung.rs`: Ein Replay ist 201 mit derselben `ausgabe_id`, und das Zeitfenster hat genau eine Ausgabe. Ein Replay nach dem Einsatzabschluss ist 201, eine neue Ausgabe dort bleibt 409 (`abgeschlossener_einsatz_ist_409` bleibt grün). Ein abweichender Queue-Header ergibt 412. Ein Beobachter mit bekannter `client_id` bekommt 403. Ein fremdes Zeitfenster ist 422.
- [x] 3.3 Live-Test: Ein Replay sendet kein zweites `verpflegung`-Ereignis. Verifiziert in `tests/verpflegung.rs` nach dem Muster `live_ereignis_nur_an_leser_mit_modulrecht`: Die Erstausgabe erzeugt ein Ereignis, der Replay keines.

## 4. Frontend: API und Queue

- [x] 4.1 `api/types.ts`: `client_id?: string` an `AusgabeEingabe`. `erfasseAusgabe` in `api/verpflegung.ts` nimmt die Request-Optionen (`offlineQueueBenutzerId`) wie `meldeStand`. Verifiziert mit `tsc` und `scripts/check-typ-codegen.sh`.
- [x] 4.2 `offline/queue.ts`: `OfflineSchreibaktion` um `{ art: 'ausgabe'; zeitfenster_id; bezeichnung; daten: AusgabeEingabe }` erweitern, ohne Versionssprung (D7). Verifiziert mit `schreiben.test.ts` (eine vorgemerkte `ausgabe`-Aktion wird unverändert zurückgelesen) und `tsc`.
- [x] 4.3 `offline/schreiben.ts`: den Ablauf von `betreuungsmeldungOfflineFaehig` zu einem Helfer mit Erfassungszeitpunkt verallgemeinern, darauf `erfasseVerpflegungsausgabeOfflineFaehig` (D6). Verifiziert mit `schreiben.test.ts`: Offline ergibt `vorgemerkt` mit dem `zeitpunkt_at` der Erfassung. Ein eingetragener Zeitpunkt bleibt unverändert. Ein Online-Erfolg ergibt `gesendet` **ohne** zugesetzten `zeitpunkt_at`. Ein transienter Fehler ergibt `vorgemerkt` mit derselben `client_id` wie der Versuch. Ein fachlicher Fehler wirft. Die bestehenden Stand- und Belegungstests bleiben grün.
- [x] 4.4 `offline/useOfflineSync.ts`: ein Zweig `ausgabe` in der exhaustiven Kette. Er sendet mit `offlineQueueBenutzerId`, schreibt das zurückgegebene Zeitfenster per `setQueryData` in `einsatzKeys.verpflegung` (nur bei vorhandenen Daten), entfernt erst danach die Zeile und invalidiert anschließend `einsatzKeys.verpflegung` (D7). Verifiziert mit `useOfflineSync.test.tsx`: Ein Erfolg ersetzt das Zeitfenster im Cache vor dem Entfernen, entfernt die Zeile und invalidiert den Key. Eine 404 legt die Zeile unter `abgelehnt` ab. Ein transienter Fehler lässt sie stehen.
- [x] 4.5 `offline/OfflineRecoveryDrawer.tsx`: `aktionsTitel` um `case 'ausgabe'` mit dem Titel „Abgelehnte Verpflegungsausgabe: ‹bezeichnung›“ erweitern. Verifiziert mit `OfflineRecoveryDrawer.test.tsx`: Eine abgelehnte `ausgabe`-Aktion erscheint mit Titel, Grund und Inhalt.

## 5. Frontend: Anzeige „ausstehend“ und Seite

- [ ] 5.1 `offline/useVorgemerkteAusgaben.ts`: liest `schreibaktionenLaden(benutzerId, einsatzId)`, filtert `art === 'ausgabe'` und lädt bei `OFFLINE_QUEUE_EVENT` neu, mit Generationszähler und Scope wie `useOfflineQueueZaehler` (D8). Verifiziert mit einem Hook-Test: Eine vorgemerkte Ausgabe erscheint, nach `schreibaktionEntfernen` verschwindet sie. Eine Ausgabe eines anderen Benutzers oder Einsatzes erscheint nicht, abgelehnte ebenfalls nicht.
- [ ] 5.2 `verpflegung/ZeitfensterKarte.tsx`: neue Prop `ausstehend`. Ausstehende Ausgaben stehen in der Ausgabenliste mit dem Typwort „ausstehend“ und `data-lfh="verpflegung-ausgabe-ausstehend"`, ohne „Zurücknehmen“. Kopfzahlen, Fehlmenge und Einstufung bleiben unverändert (D8). Verifiziert mit `ZeitfensterKarte.test.tsx`: Bedarf 250, ausgegeben 100, ausstehend 120 zeigen weiter Fehlmenge 150. Die ausstehende Zeile trägt das Wort „ausstehend“ und keinen Knopf.
- [ ] 5.3 `pages/VerpflegungPage.tsx`: `ausgabeMut` über `erfasseVerpflegungsausgabeOfflineFaehig`. `vorgemerkt` ergibt einen Warn-Toast ohne „Rückgängig“, und der Dialog schließt. `gesendet` bleibt unverändert mit Rückgängig. Die Seite reicht `ausstehend` je Zeitfenster aus `useVorgemerkteAusgaben` an die Karten (D8, D9). Verifiziert mit `VerpflegungPage.test.tsx`: Eine offline erfasste Ausgabe zeigt „Offline vorgemerkt“ ohne Rückgängig-Knopf und steht danach als „ausstehend“ an ihrer Karte. Online bleibt der Rückgängig-Toast.

## 6. Abschluss

- [ ] 6.1 Doku: In `frontend/src/betreuung/AGENTS.md` bekommt die Zeile Verpflegung einen knappen Nachtrag (Ausgabe offline-fähig, Replay vor der Aktiv-Prüfung, Erfassungszeitpunkt nur in der Kopie, „ausstehend“ außerhalb der Deckung). In `openspec/changes/archive/2026-09-29-lfh-634-fachmodul-verpflegung/design.md` bekommt das Non-Goal den Verweis „eingelöst durch LFH-688“. Verifiziert per Sichtprüfung des Diffs.
- [ ] 6.2 `./scripts/check-all.sh` läuft vollständig grün (Prettier, Lint, Typ-Codegen, `cargo test`, Vitest, e2e, `check-migrationen.sh`). Verifiziert durch Exit-Code 0, ohne `| tail`.
- [ ] 6.3 Handprobe gegen das frisch gebaute Binary: dieselbe Ausgabe mit `client_id` zweimal senden, sie ist genau einmal gespeichert. Dann den Einsatz abschließen und den Replay erneut senden: 201, eine neue `client_id` ergibt 409. Ein fremder Queue-Besitzer ergibt 412. Verifiziert per Protokoll der Antworten und Zählung der Ausgaben.
