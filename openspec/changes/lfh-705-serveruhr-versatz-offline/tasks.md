# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. „Verifiziert“ heißt, der genannte Test läuft grün **und** war vorher rot.

## 1. Versatz zur Serveruhr messen

- [ ] 1.1 `frontend/src/offline/serveruhr.ts` mit `merkeServerzeit(res: Response, empfangenMs?: number)`, `serverJetzt(): Dayjs` und einem Test-Reset. Messung `(Date + 500 ms) − Empfang`, jüngste Messung gilt (D2), Rauschgrenze 5 s (D3), `localStorage` `lifeline-serveruhr` mit 24 h Frist und `try/catch` (D4). Verifiziert mit `serveruhr.test.ts` (Fake-Timer auf `Date`): Gerät +5 min und eine Antwort mit `Date` der Serverzeit liefern `serverJetzt()` = Serverzeit ±1 s; ohne Messung gilt die Geräteuhr; Versatz 3 s korrigiert nicht; eine jüngere Messung ersetzt die ältere; ein Wert aus `localStorage` gilt nach Modul-Reset, nach 24 h nicht mehr; ein werfender `localStorage` bricht nichts; fehlender oder unlesbarer `Date` misst nicht.
- [ ] 1.2 Cache-Regel aus D2 in `merkeServerzeit`: keine Messung bei `Cache-Control` mit `max-age`/`s-maxage` > 0 oder `immutable` und bei `Expires`/`Last-Modified` ohne `no-cache`/`no-store`. Verifiziert mit `serveruhr.test.ts`: je ein Fall pro Merkmal misst nicht, `no-cache` mit `Last-Modified` und eine Antwort ohne Cache-Header messen.
- [ ] 1.3 `frontend/src/api/client.ts`: `apiGet`, `apiSend` und `apiUpload` rufen `merkeServerzeit(res)` direkt nach `fetch`, auch vor `fehlerWerfen`. Verifiziert mit `client.test.ts` (msw): eine 200 aus `apiGet`, eine 422 aus `apiSend` und eine Antwort aus `apiUpload` mit `Date` 5 min vor der Geräteuhr setzen `serverJetzt()` um 5 min zurück; ein Netzfehler ändert nichts.

## 2. Erfassungszeitpunkt beim Vormerken korrigieren

- [ ] 2.1 `frontend/src/offline/schreiben.ts`, `betreuungsmeldungOfflineFaehig`: `erfasst = alsBackendZeit(serverJetzt())`, weiter vor dem Online-Versuch genommen; ein eingetragener `zeitpunkt_at` bleibt (D5). Den Kommentar über der Funktion um die Serveruhr ergänzen. Verifiziert mit `schreiben.test.ts`: Gerät +5 min nach einer Messung, offline vorgemerkte Stand- und Belegungsmeldung tragen die Serverzeit; ohne Messung die Geräteuhr (Bestandstest bleibt grün); eingetragenes „09:30“ bleibt „09:30“; der Online-Versuch trägt weiter keinen `zeitpunkt_at`; transienter Fehler nach 15 s Timeout merkt mit dem Zeitpunkt **vor** dem Versuch vor.
- [ ] 2.2 Regelzeile in `frontend/src/betreuung/AGENTS.md`, Absatz „Meldungen offline“: Erfassungszeit der vorgemerkten Kopie nach Serveruhr (`offline/serveruhr.ts`, LFH-705), Verweis auf diese Change. Verifiziert per Prettier-Lauf über `frontend/` und Sichtprüfung des Diffs.

## 3. Ende zu Ende

- [ ] 3.1 `frontend/e2e/betreuung-offline-uhrversatz.spec.ts`: Geräteuhr per `page.clock` 5 min vor die echte Zeit stellen, Betreuungsseite eines Einsatzes mit Bezirk laden (Messung über echte API-Antworten), `context.setOffline(true)`, Standmeldung melden, „Offline vorgemerkt“ abwarten, nach einem kurzen Ausfall `setOffline(false)`. Verifiziert, wenn der Stand im Bezirk erscheint, der Drawer leer bleibt und der Zeitpunkt der Meldung (API) höchstens 60 s von der Serverzeit abweicht. Die Mutationsprobe (Korrektur in 2.1 zurückgedreht) macht den Test rot, weil die Meldung mit 400 im Drawer landet.
- [ ] 3.2 Beleg für den `Date`-Header am echten Server: Handprobe `curl -sI` gegen `cargo run` auf eine API-Route. Verifiziert, wenn die Antwort einen `date`-Header trägt (Ergebnis hier eintragen). 3.1 deckt dasselbe automatisch ab.

## 4. Abschluss

- [ ] 4.1 Nachzug für ETB- und Meldungs-Ereigniszeit aus der Geräteuhr (Non-Goal in `design.md`) per `clickup-task-anlegen` aufs Board. Verifiziert, wenn die Task-ID hier und in `design.md` steht.
- [ ] 4.2 `./scripts/check-all.sh` vollständig grün. Verifiziert durch Exit-Code 0 ohne `| tail`, Ergebnis hier eintragen.
