# Tasks

Jede Aufgabe entsteht per TDD: zuerst der Test, der rot ist, dann der Code. Rust-Tests laufen im
eigenen `target/` des Checkouts; Node und pnpm nur über `mise exec --`. Bezeichner nach LFH-1312
(Fachbegriff deutsch, Technik englisch).

## 1. Tabellen und Admin-Spur

- [x] 1.1 Migration mit der nächsten Nummer über allen auf `origin/alpha` (voraussichtlich
  0346): `maschine_webhook` und `maschine_webhook_versuch` (D1). Dazu die Einordnung, die der
  Bestand für neue Tabellen verlangt (Schwärzungs-Registry, `spiegel::art`; Wächter zeigen sie).
  Verifizieren: `scripts/check-migrationen.sh`, `cargo test db::tests`, die Wächter für
  Schwärzung und Spiegel-Arten sind grün, und ein Test belegt `UNIQUE (zugang_id)` und das
  Löschen mit dem Zugang.
- [x] 1.2 Sechs neue `AdminAktion`-Varianten (D8) samt Migration, die den CHECK von
  `admin_audit` nach Muster 0340 neu baut. Verifizieren: `jede_aktion_passiert_den_db_check`,
  `tests/admin_audit.rs` und `tests/enum_wire_kontrakt.rs` sind grün.

## 2. Signatur

- [x] 2.1 Profil Webhook in `src/instanz/signatur.rs` (D4): `EVENT_TYP`, `WebhookClaims`,
  `sign_webhook` und `verify_webhook`. Verifizieren mit Unit-Tests: Hin- und Rückweg gültig;
  fremder Schlüssel, geänderter Body, falsche `aud`, `exp` vorbei, `exp − iat > 300`, falscher
  `typ` und `alg` `none` scheitern; ein Token des Profils `MACHINE` scheitert am `typ`.

## 3. Ziel-Schutz

- [x] 3.1 `public_api::webhook::ziel::klasse` (D5). Verifizieren mit Tabellen-Tests je Bereich:
  öffentlich v4 und v6; privat `10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `fc00::/7`;
  gesperrt Loopback, `169.254.169.254`, `fe80::1`, `224.0.0.1`, `ff02::1`, `255.255.255.255`,
  `0.0.0.0`, `240.0.0.1`, `198.18.0.1`; eingebettetes IPv4 in mapped, compatible, NAT64 und 6to4.
- [x] 3.2 `url_pruefen(url, lan_erlaubt)`. Verifizieren: `http`, Userinfo, Fragment,
  `localhost`, `x.localhost`, `https://127.0.0.1/`, `https://[::1]/` und ohne Ausnahme
  `https://10.0.0.5/` ergeben je den passenden `ZielFehler`; mit Ausnahme ist
  `https://10.0.0.5/` erlaubt und `https://169.254.169.254/` weiter gesperrt.
- [x] 3.3 `WebhookResolver` fail-closed und die zwei Clients über
  `ausgehend::client_builder(Zweck::Webhook)` mit `.no_proxy()`, ohne Weiterleitung, nur https;
  Deckel `WEBHOOK` in `http_begrenzt`. Verifizieren: Unit-Test der Filterfunktion des Resolvers
  (gemischtes Ergebnis ergibt nichts; privat nur mit Ausnahme); `tests/ausgehend_kennung_guard.rs`
  grün; die Testliste der Zwecke in `ausgehend.rs` enthält `Webhook`.
- [x] 3.4 `Zusteller`-Trait mit dem echten HTTP-Weg (D5): Kopf `Lifeline-Signature`,
  `Content-Type`, `Lifeline-Event-Id`, Antwort begrenzt gelesen und verworfen, Abbildung auf
  `WebhookFehler` (D6). Verifizieren: Unit-Test der Abbildung von Status, 3xx und
  reqwest-Fehlerarten; ein Test belegt, dass ein Ziel `https://127.0.0.1:<port>/` ohne
  Verbindungsaufbau mit `ziel_intern` scheitert (lauschender Socket bekommt keine Verbindung).

## 4. Lesen aus der Outbox und Zustellungslogik

- [x] 4.1 `events::naechstes` und `sichtbare_arten` als `pub(crate)` (D2). Verifizieren in
  `tests/public_api_webhook.rs` (Zeilen direkt per SQL unter `tests/`, wie in LLH-1655): nächste
  Zeile des eigenen Zugangs nach dem Cursor; fremder Zugang nie; nicht gewählte Art
  übersprungen; Art ohne Scope übersprungen; ersetztes `lage.changed` liefert die neue Nummer;
  `Verloren` nur, wenn `offen_id` unter der Löschgrenze liegt; ein Cursor unter der
  Löschgrenze allein ist kein Verlust.
- [x] 4.2 Reine Funktion `naechster_zustand` (D6). Verifizieren mit Unit-Tests: Wartezeiten 1,
  2, 4 … 256 min, danach 6 h; Erfolg setzt zurück; der Versuch, der hinter 24 h fiele, liegt
  genau bei `fehler_seit + 24 h`; scheitert er, `angehalten`.
- [x] 4.3 Der Lauf `webhook::lauf` (D3) mit Stopp-Signal und `catch_unwind`, verdrahtet in
  `main.rs` samt `herunterfahren`. Verifizieren in `tests/public_api_webhook.rs` mit einem
  aufzeichnenden `Zusteller` und gesteuerter Zeit:
  - drei Ereignisse kommen in aufsteigender Nummer, je ein POST, Body gleich dem Abruf, und
    jede Signatur besteht `verify_webhook` mit der Webhook-ID;
  - Akzeptanzkriterium: Ziel 2 h unerreichbar, danach alle Ereignisse in Reihenfolge;
  - Akzeptanzkriterium: 24 h nur Fehlschläge ergibt `angehalten`, danach kein Versuch mehr;
  - ein widerrufener, abgelaufener oder Zugang ohne `events:read` ruht, ohne Versuch und ohne
    Cursor-Änderung;
  - mehr als 50 fällige Ereignisse verteilen sich auf mehrere Takte, ein zweiter Webhook kommt
    dazwischen dran;
  - der Verlauf hält höchstens 50 Einträge je Webhook;
  - das Stopp-Signal beendet den Lauf binnen der Frist.

## 5. Admin-API

- [x] 5.1 DTOs `WebhookAnzeige`, `WebhookVersuch`, `TestErgebnis`, Enums `WebhookZustand` und
  `WebhookFehler`; `AnbindungAnzeige.webhook`. Verifizieren: `scripts/check-typ-codegen.sh`
  grün, beide generierten Dateien mitcommittet, Einträge in `tests/enum_wire_kontrakt.rs`.
- [x] 5.2 Routen aus D8 mit `URL_MAX` (Spiegel in `frontend/src/api/eingabegrenzen.ts`), CAS und
  Admin-Spur nach dem Commit. Verifizieren in `tests/anbindungen_webhook.rs`:
  - Anlegen `201`, zweites Anlegen `409`, leere oder unbekannte Art `400`, `http` `400`;
  - Führungskraft liest Zustand und Verlauf, schreibt aber nicht (`403`);
  - PATCH mit alter `basis_geaendert_at` `409`;
  - Wieder aufnehmen aus `aktiv` `409`; aus `angehalten` mit Rückstand bleibt der Cursor, ohne
    Rückstand (`offen_id` unter der Löschgrenze) springt er und `verlust_at` ist
    gesetzt;
  - Testereignis: `ping` signiert, Cursor, Zustand und Wartezeit unverändert, ein Verlaufseintrag
    mit `test`, kein Eintrag in der Admin-Spur;
  - je Aktion genau ein Eintrag in der Admin-Spur mit Host, ohne Pfad der URL; LAN-Ausnahme
    ein- und ausschalten schreibt den eigenen Eintrag zusätzlich;
  - am gekoppelten ELW sind die Schreibwege gesperrt;
  - `tests/eingabegrenzen_spiegel.rs` grün.

## 6. Oberfläche

- [x] 6.1 API und Query-Keys in `frontend/src/api/anbindungen.ts` und `queryKeys.ts`; Anzeige der
  Zustände in `anbindungAnzeige.ts`. Verifizieren: Vitest für die Zuordnung von Zustand zu Text
  und Ton und für die Auswahl der Arten nach den Rechten.
- [x] 6.2 Paneel „Webhook“ in `AnbindungAnsicht.tsx` (D9): Einrichten im `ErfassungsModal`,
  Bearbeiten im `BearbeitbaresPaneel`, Aktionen „Testereignis senden“, „Wieder aufnehmen“,
  „Webhook entfernen“, Hinweise zu Verlust und Ruhen. Verifizieren: Vitest in
  `AnbindungAnsicht.test.tsx` für Admin und Führungskraft (keine Bedienknöpfe),
  ausgegraute Arten ohne Recht und die Warnung der LAN-Ausnahme; `mise exec -- pnpm -C frontend
  lint` und `typecheck` grün.
- [x] 6.3 Paneel „Zustellungen“ mit den letzten 50 Versuchen und der Hinweis in der Liste der
  Anbindungen. Verifizieren: Vitest für die Liste (angehalten im Ton `achtung`) und für den
  Verlauf ohne Rumpf.
- [x] 6.4 e2e in `frontend/e2e/anbindungen.spec.ts`: Webhook an ein unerreichbares öffentliches
  Ziel einrichten, Testereignis senden, Fehlschlag im Verlauf sehen, Webhook entfernen.
  Verifizieren: die Spec läuft lokal grün.

## 7. Referenz-Clients und Testvektoren

- [x] 7.1 Rust-Crate: `verify_webhook` und der Abschnitt `webhooks` der Vektoren (D10), neu
  geschrieben mit `LIFELINE_TESTVEKTOREN_SCHREIBEN=1`. Verifizieren: `cargo test -p
  lifeline-machine-client` grün; der Server-Test in `src/instanz/signatur.rs` prüft die neuen
  Vektoren und erzeugt den gültigen Fall byte-gleich.
- [x] 7.2 TypeScript `verifyWebhook` und Python `verify_webhook`. Verifizieren:
  `machineClient.vektoren.test.ts` und `scripts/check-api-clients.sh` prüfen gültige und alle
  ungültigen Webhook-Vektoren.

## 8. Doku, ADR und Regeln

- [ ] 8.1 Neue ADR nach `docs/architektur/AGENTS.md` (Nummer, Vorlage, Prüfungen aus D11).
  Verifizieren: `scripts/adr-fuer.sh src/public_api/webhook/ziel.rs` nennt sie, und der
  ADR-Wächter des Gates ist grün.
- [ ] 8.2 `src/AGENTS.md` Abschnitt „Webhooks“; Architektur Kapitel 3 und 5. Verifizieren: die
  Wächter der Architekturdoku sind grün.
- [ ] 8.3 Entwicklerdoku `docs/api/maschinenzugang.md`: Abschnitt „Webhooks empfangen“ mit Body,
  Köpfen, Prüfschritten, Entdoppeln über `id`, Wiederholung, Anhalten, `ping` und kurzen
  Empfänger-Beispielen für TypeScript und Python. Verifizieren: Prettier grün, die Beispiele
  nutzen die Funktionen aus 7.2.
- [ ] 8.4 Anwenderkapitel `docs/anwender/kapitel/anbindungen.md`: Abläufe „Webhook einrichten“,
  „Testereignis senden“ und „Webhook wieder aufnehmen“, Hintergrund zu Zuständen, 24 h, Verlust,
  HTTPS und LAN-Ausnahme samt Zertifikat; neue Pfade unter `quellen:`. Verifizieren:
  `anwenderdoku.guard.test.ts` grün.

## 9. Abschluss

- [ ] 9.1 `./scripts/check-all.sh` grün (bzw. `--geaendert` lokal, voller Lauf in der CI des
  PRs). Verifizieren: Ausgabe des Laufs ohne roten Schritt.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-orchestrieren`, Phase 4).
- Folgeaufgabe auf dem Board: `karte::download::ip_ist_intern` kennt Multicast und `198.18/15`
  nicht (D5).
- `/opsx:archive z6ds0ed9-webhooks-outbox` im selben Branch vor dem PR.
- Bilder des Paneels „Webhook“ (Zustände aktiv, Fehler, angehalten) für PR und Meldung.
