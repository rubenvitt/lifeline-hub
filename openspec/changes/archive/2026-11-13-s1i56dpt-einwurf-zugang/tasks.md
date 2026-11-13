# Tasks

Jede Aufgabe entsteht per TDD: zuerst der Test, der rot ist, dann der Code. Vor einer Änderung
`scripts/adr-fuer.sh <pfad>…` und die `AGENTS.md` auf dem Weg zur Datei. Neue Bezeichner folgen
der Bezeichner-Sprache der Wurzel-`AGENTS.md` (Fachbegriffe deutsch, Technik englisch).

## 1. Schlüssel, Datenmodell und Repo

- [x] 1.1 Migrationen mit Nummern über allen auf `origin/alpha` (`git fetch origin alpha`, dann
  `scripts/check-migrationen.sh`): `einwurf_zugang`, `alarmmeldung` und `position_letzte` samt
  Indizes nach design.md D3. Verifizieren: `cargo test db::tests` ist grün, und ein Test belegt
  den CHECK auf `scope` (ein dritter Wert scheitert).
- [x] 1.2 `src/public_api/einwurf.rs`: `SCHLUESSEL_PRAEFIX = "llh_ew_"`, `neuer_schluessel()` (32
  Bytes `OsRng`, base64url ohne Auffüllung), `hash()` und die Formprüfung (Präfix, 50 Zeichen).
  Verifizieren: Unit-Tests „zwei Schlüssel unterscheiden sich“, „Länge und Präfix“, „falsche
  Form wird ohne Datenbank abgelehnt“.
- [x] 1.3 Repo in `einwurf.rs`: anlegen, Liste je Org, laden in der Org (fremd wie unbekannt),
  über den Hash suchen, Schlüssel wechseln, widerrufen (idempotent, meldet die Wirkung),
  `zuletzt_genutzt_at` höchstens minütlich. Verifizieren: Repo-Tests je Funktion, darunter
  „Wechsel macht den alten Hash unauffindbar“, „Wechsel an einem widerrufenen Zugang scheitert“
  und „zweiter Widerruf hat keine Wirkung“.

## 2. Drosselung

- [x] 2.1 `src/public_api/drossel.rs`: Vorrat und Nachfüllrate als Werte von `TokenBucket` und
  `Drossel`; zwei prozessweite Instanzen (Maschinenzugang 60 und 1 je Sekunde, Einwurf 30 und
  0,5 je Sekunde) mit je eigener Funktion. Verifizieren: Die bestehenden Tests bleiben ohne
  Änderung ihrer Erwartung grün; neu „der 31. Einwurf wird gedrosselt, nach 2 Sekunden geht
  einer“ und „ein leerer Einwurf-Vorrat berührt den Maschinenzugang gleicher ID nicht“.

## 3. TLS-Nachweis und Schalter

- [x] 3.1 `src/extract.rs`: `is_tls_nachgewiesen(tls_direkt, gegenstelle, headers, vertraut)` nach
  design.md D7. Verifizieren: Unit-Tests für „direktes TLS“, „vertrauter Proxy mit https“,
  „fremde Gegenstelle mit https-Kopf“, „https, http vom vertrauten Proxy“, „Kopf fehlt“,
  „Gegenstelle unbekannt“ und eine IPv4-gemappte Gegenstelle.
- [x] 3.2 `--einwurf-allow-http` / `LIFELINE_EINWURF_ALLOW_HTTP` in `src/config.rs`;
  `RouterOptionen` bekommt `tls` und `einwurf_allow_http`; `build_router_mit` legt sie als
  `Extension` an den Router; `src/main.rs` füllt sie und schreibt bei gesetztem Schalter eine
  Warnzeile. Verifizieren: Config-Test „Vorgabe aus, per Flag und per Umgebung an“;
  `cargo test --test env_config_guard` ist grün.
- [x] 3.3 `EinwurfTransport` (`wire_enum!`: `tls`, `proxy`, `http`, `keiner`) samt der Funktion,
  die die Lage aus Optionen und Proxy-Liste bestimmt. Verifizieren: Unit-Test je Lage und der
  Eintrag in `tests/enum_wire_kontrakt.rs`.
- [x] 3.4 Betriebsdoku: `docs/betrieb/env-registry.md` (neuer Schalter), `docs/betrieb-tls.md`
  (Einwurf nur über TLS, `--trusted-proxies` ist dafür Pflicht, der Proxy setzt
  `X-Forwarded-Proto` statt anzuhängen) und `docs/architektur/07-verteilungssicht.md`.
  Verifizieren: `scripts/check-architektur.sh` ist grün, und jede Aussage nennt die Datei, die
  sie belegt.

## 4. Kein Schlüssel im Protokoll

- [x] 4.1 `einwurf::maskiere_pfad` und ihr Aufruf in `pfad_fuer_protokoll` (`src/app.rs`) vor dem
  Kürzen. Verifizieren: Unit-Tests „Abschnitt nach `/einwurf/` wird `***`“, „Abschnitt mit
  `llh_ew_` an anderer Stelle“, „Pfad endet mit dem Schlüssel“, „fremder Pfad bleibt
  unverändert“, „Maskieren vor Kürzen“; `cargo test --test public_api` bleibt grün (kein
  `"/api/v1` in `app.rs`).
- [x] 4.2 `docs/betrieb/observability.md` und `docs/betrieb-tls.md`: Der Server maskiert den Pfad
  und schreibt keine Abfrage; der Reverse-Proxy darf unter `/api/v1/einwurf/` weder Pfad noch
  Abfrage protokollieren. Ein Konfigurationsbeispiel nur, wenn es an der Doku des Proxys belegt
  ist (Context7), sonst die Anforderung in einem Satz. Verifizieren: gegengelesen gegen 4.1 und
  die Doku des genannten Proxys.

## 5. Einwurf für Alarmmeldungen

- [x] 5.1 Baustein der Prüfungen in `einwurf.rs` in der Reihenfolge von design.md D6 (TLS,
  Sperre der Quelle, Form und Suche, Zustand samt gekoppeltem ELW, Zweck, Drossel). Verifizieren
  in `tests/einwurf.rs` durch den ganzen Router: „Klartext ohne Schalter ergibt 403
  `tls_required`, auch mit unbekanntem Schlüssel“, „unbekannt 401“, „widerrufen 401“,
  „abgelaufen 401“, „falsche Route 403 `missing_scope`“, „31. Einwurf 429 mit `Retry-After`“,
  „zehn unbekannte Schlüssel sperren die Quelle auf den Einwurf-Routen, die Passwort-Anmeldung
  bleibt frei“, „widerrufene Schlüssel zählen nicht“, „gekoppelter ELW 401“.
- [x] 5.2 Handler `GET` und `POST /api/v1/einwurf/{schluessel}/alarmmeldung` mit
  `#[utoipa::path]` und Eintrag in `router()`: Rohdaten nach D2 bilden, Kennungen erkennen,
  Grenzen (16 KiB Body, 8 KiB Abfrage, 200 Zeichen je Kennung), leerer Einwurf 422, Antwort 204
  ohne Body. Verifizieren: Tests „Abfrage landet unverändert in der Ablage“, „JSON-Body mit
  `external_id`“, „Formular-Body“, „unlesbares JSON wird als Text abgelegt“, „leer 422“,
  „17 KiB 413“, „Antwort trägt `no-store` und keinen Body“, „kein Einsatz entsteht“.
- [x] 5.3 Doppelerkennung nach D4 in einer Transaktion, dazu die Tagesgrenze von 5 000 neuen
  Einträgen je Zugang. Verifizieren mit gesetzter Zeit: „`message_id` nach drei Stunden: ein
  Eintrag, Zähler 1“, „neue `message_id` zur selben `external_id`: zweiter Eintrag“, „nur
  `external_id` und gleicher Inhalt: Wiederholung“, „ohne Kennung dreimal in 30 s: ein Eintrag,
  Zähler 2“, „ohne Kennung nach 10 min: zweiter Eintrag mit `frueher_id`“, „anderer Zugang,
  gleiche Kennung: zwei Einträge“, „Tagesgrenze 429, Wiederholung zählt nicht“.
- [x] 5.4 Akzeptanztest über den Trace-Span: ein Einwurf mit gültigem und einer mit unbekanntem
  Schlüssel durch den ganzen Router mit `LogPuffer`. Verifizieren: Kein mitgeschnittenes Byte
  enthält den Schlüssel oder seinen Hash, und der Span nennt
  `/api/v1/einwurf/***/alarmmeldung`. Gegenprobe: Ohne den Aufruf aus 4.1 wird der Test rot.
- [x] 5.5 Kein Leseweg: Test, dass `GET /api/v1/einwurf/<schlüssel>` und ein fremder Unterpfad
  404 oder 405 ergeben und dass ein Einwurf-Schlüssel an `GET /api/v1/me` (Kopf und Abfrage) 401
  ergibt. Verifizieren: `cargo test --test einwurf` ist grün.
- [x] 5.6 Vertrag und Doku: `src/public_api/description.md` (Abschnitt „Einwurf“),
  `docs/api/einwurf.md` (Adressen, Kennungen, Antworten, Doppelerkennung, Grenzen, je ein
  Beispiel für GET und POST), Verweis in `docs/api/maschinenzugang.md`,
  `docs/architektur/05-bausteinsicht.md` und `06-laufzeitsicht.md`. Verifizieren:
  `cargo test --test public_api_spec_aktuell` ist grün und `docs/api/public-v1.json` ist
  mitcommittet; `cargo test --test public_api` (jede Operation nennt die Fehlerantwort);
  die Beispiele sind gegen einen laufenden Server ausgeführt.

## 6. Einwurf für Positionen

- [x] 6.1 Handler `GET` und `POST /api/v1/einwurf/{schluessel}/position`: Felder nach D5 lesen
  und prüfen, `timestamp` in drei Formen, schreiben mit „älter wird nicht übernommen“,
  Obergrenze 200 Kennungen. Verifizieren: Tests „OsmAnd-Aufruf legt die Position ab“, „zweite
  Position ersetzt die erste, es bleibt eine Zeile“, „älterer Zeitstempel: 204 und unverändert“,
  „ohne `timestamp` gilt der Empfang“, „Millisekunden und RFC 3339“, „30 Minuten in der Zukunft
  422“, „`lat=123` 422“, „ohne Kennung 422“, „201. Kennung 422, die 200 bleiben“, „Zugang für
  Alarmmeldungen an `…/position` 403“.
- [x] 6.2 Vertrag und Doku: Abschnitt „Position“ in `docs/api/einwurf.md` mit einem
  OsmAnd-Beispiel, `description.md`. Verifizieren: `cargo test --test public_api_spec_aktuell`
  ist grün, das Beispiel ist gegen einen laufenden Server ausgeführt.

## 7. Löschfristen

- [x] 7.1 `einwurf::purge(pool, jetzt)`: Alarmmeldungen 7 Tage nach `empfangen_at`, Positionen 24
  Stunden nach `empfangen_at`; Aufruf in Phase C von `src/einsatz/purge_scheduler.rs`.
  Verifizieren: Test mit eingefügten Zeilen nach `tick_einmal` („8 Tage alt weg, 6 Tage alt da,
  erneuter Empfang verlängert nicht“, „Position 25 Stunden alt weg, 23 Stunden alt da“).

## 8. Verwaltung im Backend

- [x] 8.1 Admin-Spur: `AdminAktion` um `einwurf_zugang_angelegt`,
  `einwurf_zugang_schluessel_gewechselt` und `einwurf_zugang_widerrufen`, `Ziel::EinwurfZugang`,
  Migration mit neu gebautem CHECK (Muster 0334). Verifizieren:
  `jede_aktion_passiert_den_db_check`, Eintrag in `tests/enum_wire_kontrakt.rs`,
  `scripts/check-migrationen.sh`.
- [x] 8.2 `src/routes/einwurf_zugaenge.rs` mit den vier Routen aus D11, registriert in
  `src/app.rs`, Schemas in `src/api_doc.rs`. Verifizieren in `tests/einwurf.rs`: „Anlegen gibt
  den Schlüssel einmal aus, die Liste nie“, „unbekannter Zweck 422“, „ohne Admin 403, lesen
  geht“, „fremde Org 404“, „Wechsel: alter Schlüssel 401, neuer 204“, „Wechsel nach Widerruf
  409“, „Widerruf wirkt sofort“, „gekoppelter ELW: Anlegen und Wechsel 409, Widerruf geht“,
  „Liste nennt `transport` und `zuletzt_genutzt_at`“.
- [x] 8.3 Spur-Einträge nach dem Commit und nur bei Wirkung. Verifizieren: Tests „Anlegen,
  Wechsel und Widerruf schreiben je einen Eintrag mit Zugang und Zweck“, „zweiter Widerruf
  schreibt keinen“, „kein Eintrag enthält Schlüssel oder Hash“.
- [x] 8.4 Typ-Codegen: `scripts/check-typ-codegen.sh`. Verifizieren: Das Skript ist grün, und
  `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts` und
  `docs/api/public-v1.json` sind mitcommittet.

## 9. Oberfläche

- [x] 9.1 `frontend/src/api/einwurfZugaenge.ts`, `GLOBAL_KEYS.einwurfZugaenge` in
  `NICHT_LIVE_GLOBAL_KEYS`, Typ-Aliase in `api/types.ts`. Verifizieren: `globalKeys.test.ts` und
  `queryKeys.guard.test.ts` sind grün.
- [x] 9.2 Klartext der drei Aktionen in `zugangsprotokoll/zugangsprotokollText.ts`. Verifizieren:
  Vitest der Klartext-Tabelle; der Typecheck erzwingt die Vollständigkeit.
- [x] 9.3 `EinwurfZugaenge.tsx` als Paneel unter „Zugänge“ in `Anbindungen.tsx`: Liste mit Name,
  Zweck, Zustand, „gültig bis“, „zuletzt genutzt“; Hinweis bei `transport` `http` und `keiner`;
  Sperrgrund am gekoppelten ELW; ohne Admin-Recht keine Aktionen. Verifizieren: Vitest „zeigt
  die Zugänge“, „Hinweis je Lage“, „ohne Admin nur lesen“, „ELW gesperrt“; `adminNav.test.tsx`
  und `erklaertext.guard.test.ts` bleiben grün.
- [x] 9.4 Anlegen (`ErfassungsModal`, drei Felder) und der Dialog, der die Adresse einmal zeigt
  und nur über „Fertig“ schließt. Verifizieren: Vitest „Anlegen sendet Name, Zweck und Gültig
  bis“, „Dialog zeigt die Adresse mit dem Unterpfad des Zwecks“, „Escape und Klick daneben
  schließen nicht“, „Speicherfehler bleibt im Dialog“.
- [x] 9.5 Zeilenaktionen „Schlüssel wechseln …“ und „Widerrufen …“ aus einer
  `WeitereAktionen`-Quelle, je mit Rückfrage. Verifizieren: Vitest „Widerruf erst nach
  Rückfrage“, „Wechsel zeigt die neue Adresse einmal“, „widerrufener Zugang hat keine Aktionen“,
  dazu der Wortlaut-Test der Seite.
- [x] 9.6 e2e in `frontend/e2e/anbindungen.spec.ts`: Der Test-Server startet mit
  `--einwurf-allow-http` (`frontend/playwright.config.ts`); „Einwurf-Zugang anlegen, Adresse
  aufrufen, 204, Zeile zeigt zuletzt genutzt, widerrufen, Aufruf ergibt 401“. Verifizieren: der
  Spec läuft lokal grün (`mise exec -- pnpm -C frontend exec playwright test
  e2e/anbindungen.spec.ts --trace off`).
- [x] 9.7 Anwenderkapitel `docs/anwender/kapitel/anbindungen.md`: Abläufe „Einwurf-Zugang
  anlegen“, „Schlüssel wechseln“, „Einwurf-Zugang widerrufen“; Hintergrund (was ein Einwurf kann
  und nicht kann, TLS, doppelte Einwürfe, Löschfristen, Adresse hinter einem Proxy, Positionen
  ohne Karte bis LLH-1199); der Satz „Heute nutzt ein Fremdsystem nur die Prüfung seiner
  Anmeldung“ wird berichtigt; neue Pfade unter `quellen:`. Verifizieren:
  `mise exec -- pnpm -C frontend exec vitest run src/hilfe/anwenderdoku.guard.test.ts` ist grün,
  und jeder Ablauf ist am laufenden System nachgeklickt.

## 10. Entscheidungen und Architektur

- [x] 10.1 ADR-0023 nach design.md D14 anpassen (`gilt_fuer`, Prüfung, Wortlaut, Obergrenzen) und
  auf `akzeptiert` setzen. Verifizieren: `scripts/check-architektur.sh` führt ihre Prüfung aus
  und ist grün; `scripts/adr-fuer.sh src/public_api/einwurf.rs` nennt sie.
- [x] 10.2 Neue ADR mit der nächsten freien Nummer (`git fetch origin alpha`, offene PRs
  ansehen) und `ersetzt: ADR-0014`; ADR-0014 bekommt `status: ersetzt` und `ersetzt_durch`.
  Verweise auf ADR-0014 in arc42, `AGENTS.md`-Dateien und Code-Kommentaren nachziehen
  (`git grep 'ADR-0014'`). Verifizieren: `scripts/check-architektur.sh` und
  `scripts/check-adr-nummern.sh` sind grün; die Prüfung der neuen ADR läuft.
- [x] 10.3 arc42: Kapitel 3 (Absender ohne Signatur, Schnittstelle Einwurf), 8 (Maschinenanmeldung
  mit Ausnahme), 11 (Risiko Schlüssel in der URL, Art.-9-Daten bei GET, Positionen in der
  Ablage; R33 fortschreiben) und 12 (Einwurf-Zugang, Ablage). Verifizieren:
  `scripts/check-architektur.sh` ist grün, jede Aussage nennt ihre Datei.
- [x] 10.4 `src/AGENTS.md`, „Öffentliche API v1“: ein Punkt zum Einwurf mit Verweis auf die Spec
  `einwurf-zugang`. Verifizieren: Die Wurzel-`AGENTS.md` bleibt unter 200 Zeilen, `git grep`
  findet keinen zweiten Ort mit derselben Regel.

## 11. Gesamtprüfung

- [x] 11.1 `./scripts/check-all.sh` läuft grün (ohne `| tail`). Verifizieren: Ausgabe des Laufs;
  ein Kästchen, das erst die CI des PRs belegt, wird mit Verweis auf diesen Lauf abgehakt.
  **Beleg ist die CI des PRs** (`.github/workflows/ci.yml` ruft das Skript unverändert): In der
  Sitzung fehlte `mise`, das Skript lief dort nicht als Ganzes. Einzeln gelaufen sind die
  Schritte unter „Nachweise (13.11.2026)“.
- [x] 11.2 Mutationsproben an drei Stellen: TLS-Prüfung entfernt, Maskierung entfernt, Bedingung
  „älter wird nicht übernommen“ umgedreht. Verifizieren: Je Probe wird mindestens ein Test rot;
  danach ist der Code wieder im Ausgangszustand (`git diff` leer).

## Nachweise (12.11.2026)

- **5.4 und 11.2, Mutationsproben:** Drei Fehler zugleich eingebaut, danach wiederhergestellt
  (`git status` sauber). Ohne den Aufruf von `einwurf::maskiere_pfad` in `pfad_fuer_protokoll`
  werden `app::tests::einwurf_schluessel_steht_in_keiner_logzeile` und
  `pfad_fuer_das_log_traegt_keinen_einwurf_schluessel` rot. Ohne die TLS-Prüfung in `check_einwurf` (damals `pruefe`) wird
  `ohne_tls_und_ohne_schalter_ist_jeder_einwurf_403` (`tests/einwurf.rs`) rot. Mit umgedrehtem
  Vergleich in `position_ablegen` werden `aeltere_position_wird_nicht_uebernommen`,
  `neue_position_ersetzt_die_alte_ohne_verlauf` und
  `position_haengt_an_der_kennung_und_ersetzt_ohne_verlauf` rot.
- **5.6, 6.2 und 9.7, am laufenden System:** Ein Wegwerf-Lauf im Browser (nicht committet) hat
  die drei Abläufe des Anwenderkapitels nachgeklickt (anlegen für beide Zwecke, Schlüssel
  wechseln, widerrufen) und die Beispiele aus `docs/api/einwurf.md` gegen den Server geschickt:
  BOSWatch-GET 204, POST mit JSON 204, OsmAnd-Position 204, falscher Zweck 403, leerer Einwurf
  422, alter Schlüssel nach Wechsel und nach Widerruf 401, neuer Schlüssel 204. Das
  Zugangsprotokoll zeigte die drei Aktionen in Klartext.
- **Umgebung der Sitzung:** `mise` fehlt und ließ sich nicht installieren. Frontend-Prüfungen
  liefen mit Node 22 statt 26.7.0, `./scripts/check-all.sh` lief nicht als Ganzes, und die volle
  Backend-Suite passt nicht auf den Datenträger der Sitzung. Gelaufen sind die Schritte einzeln
  (siehe 11.1); die volle Suite belegt die CI des PRs.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive s1i56dpt-einwurf-zugang` im selben Branch, vor dem PR.
- Bilder der Änderung in PR und Meldung; PR gegen `alpha`; Zunder auf `review`.

## Nachweise (13.11.2026)

- **Review vor dem PR:** vier Reviewer mit frischem Kontext, jeder Befund gegengeprüft; 31
  bestätigt, drei verworfen. Ein Nachreview über den Korrektur-Commit bestätigte sechs weitere.
  Behoben in `4e892cd8` und `a38be61d`; Begründungen in `design.md`, D15. Folgeaufgabe für den
  geerbten Befund: LLH-1868.
- **Einzeln gelaufen statt `check-all.sh`:** `cargo fmt --check`; `cargo test --test einwurf`
  (24), `--test public_api` (11), `--test public_api_spec_aktuell`, `--test openapi_spec_aktuell`;
  Unit-Tests zu `einwurf`, `extract`, `config`, `log_drossel` und der Maskierung in `app`;
  Vitest für das Paneel, die Seite „Anbindungen“, das Zugangsprotokoll, `globalKeys` und die
  Wächter der Anwenderdoku; `tsc --noEmit`; ESLint und Prettier der geänderten Dateien;
  Playwright `e2e/anbindungen.spec.ts` (3 Tests, Chromium); `scripts/check-migrationen.sh`;
  `scripts/check-architektur.sh`; `openspec validate --strict`.
- **Nicht gelaufen:** die übrigen Integrationstests des Backends und die übrigen e2e-Specs (zu
  groß für die Sitzung). Sie laufen in der CI des PRs.
