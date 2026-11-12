# Tasks

Vor 1.1: LLH-1653 (`h5zpb97t-oeffentliche-api-vertrag`) liegt auf `alpha`, und der Branch ist
darauf rebast. Weicht dessen Gerüst von design.md ab, läuft vor dem Bauen `/opsx:update`. Jede
Aufgabe entsteht per TDD: zuerst der Test, der rot ist, dann der Code.

## 1. Geteilte Signatur und Code-Ableitung (Profil)

- [x] 1.1 `src/instanz/signatur.rs`:
  - `Profil` mit den Konstanten `INSTANZ` und `MACHINE`;
  - generisches `sign`/`verify` (`pub(crate)`) und `check_bindung`;
  - Claims `MachineAnfrage` und `MachineAntwort` ohne `pv`, mit `req`.

  Verifizieren:
  - `cargo test instanz::signatur` und `cargo test --test instanz_kopplung` laufen ohne eine
    Änderung an bestehenden Tests grün;
  - ein neuer Test zeigt, dass ein JWS des einen Profils am anderen mit `Algorithmus` scheitert.
- [x] 1.2 `verify_machine_anfrage` liefert bei Ablehnung `MachineAblehnung` mit Fehler und, sobald
  die Signatur gilt, der Uhrabweichung `iat - jetzt`; `AblehnungGrund::aus_signatur` bildet den
  Fehler auf den Grund ab (D6). `SignaturError` bleibt unverändert, damit kein bestehender Test sich
  ändert. Verifizieren: Unit-Tests „nach“, „vor“ und „fremde Signatur ohne Abweichung“; die
  Instanzkopplung bleibt 401 wie bisher.
- [x] 1.3 `src/instanz/code.rs`: `derive_mit_salz(code, salz)` und `SALZ_MACHINE` (`derive(code)`
  bleibt für die Instanz), dazu die Transkripte für Einlöser und Aussteller einer Maschine. Verifizieren:
  - die bestehenden Code-Tests sind unverändert grün;
  - ein neuer Test zeigt, dass derselbe Code je Salz eine andere `suche` ergibt und ein Prüfwert
    der Instanz für die Maschine nicht gilt.

## 2. Datenmodell und Repo

- [x] 2.1 Migrationen mit Nummern über allen auf `origin/alpha`
  (`scripts/check-migrationen.sh`):
  - `maschinenzugang`, `maschinenzugang_code`, `maschine_jti`, `maschine_abruf` mit CHECKs aus
    D2;
  - neu gebauter CHECK von `admin_audit` mit den fünf Aktionen.

  Verifizieren: `cargo test db::tests` und `jede_aktion_passiert_den_db_check` sind grün.
- [x] 2.2 `AdminAktion` um die fünf `maschinenzugang_*`-Werte erweitern, dazu `Ziel::Maschinenzugang`
  und die Angaben (Zugang, Name, Scopes, Fingerabdruck, Quell-IP). Verifizieren:
  - Eintrag in `tests/enum_wire_kontrakt.rs`;
  - `tests/admin_audit.rs` deckt jede Aktion ab;
  - das Zugangsprotokoll zeigt sie in Klartext (Vitest der Klartext-Tabelle).
- [x] 2.3 Enum `Scope` (`wire_enum!` mit `lage:read` … `rechner:use`) und Enum `AblehnungGrund`
  (`wire_enum!`, D6). Verifizieren: Kontrakt-Test der Wire-Werte; `Scope::parse("alles:write")`
  ist `None`.
- [x] 2.4 Repo `src/public_api/zugang.rs`:
  - anlegen, laden mit Org-Prüfung, Liste, ändern, widerrufen;
  - Code ausstellen (ersetzt offene Codes), Code einlösen (atomar), Schlüssel binden und
    wechseln (D7);
  - `jti` merken, Abruf zählen, Ablehnung festhalten (gedrosselt, D6).

  Verifizieren: Repo-Tests je Funktion, darunter „zweites Einlösen scheitert“, „neuer Code macht
  den alten ungültig“ und „Ablehnung wird höchstens einmal je 60 s geschrieben“.
- [x] 2.5 Aufräumen in Phase C von `purge_scheduler`: `maschine_jti` nach `bis`, Codes nach einem
  Tag, `maschine_abruf` nach 365 Tagen. Verifizieren: Test mit eingefügten alten Zeilen nach
  `tick_einmal`.

## 3. Drosselung

- [x] 3.1 `src/auth/rate_limit.rs`: zweite Tabelle `maschine` mit denselben Regeln (10 in 5 min je
  Quelle, ohne Konto) neben der Anmeldesperre, deren Funktionen unverändert bleiben. Verifizieren:
  - die bestehenden Tests der Anmeldesperre sind unverändert grün;
  - ein neuer Test zeigt, dass Fehlversuche in `MASCHINE` `ist_gesperrt` der Anmeldung nicht
    berühren und umgekehrt.
- [x] 3.2 `src/public_api/drossel.rs`: `TokenBucket` mit Zeit als Parameter und die Tabelle je
  Zugang mit Aufräumen. Verifizieren: Unit-Tests für die 61. Anfrage, `Retry-After` ≥ 1,
  Nachfüllen nach Wartezeit und das Aufräumen ungenutzter Einträge.

## 4. Extractor und v1-Routen

- [x] 4.1 `src/public_api/machine.rs`: `impl FromRequest<AppState> for MachineClient` mit der
  Prüfreihenfolge aus D3. Dazu `ScopeAnforderung` über `route_layer` (fail closed, D8) und
  `antwort()` mit dem Kopf `Lifeline-Signature`. Verifizieren: Integrationstests in
  `tests/maschinenzugang.rs` für:
  - gültig;
  - Body, Pfad, Methode, `aud`, Algorithmus;
  - Wiederholung 401;
  - unbekannter `kid` 401 und Zählung im Maschinenzähler;
  - Uhr ±7 min 401 mit Grund und Abweichung am Zugang;
  - widerrufen und abgelaufen 401;
  - fehlender Scope 403 `missing_scope`;
  - 61. Anfrage 429 mit `Retry-After`, ohne verbrauchte `jti`;
  - Route ohne Scope-Angabe 500.
- [x] 4.2 `POST /api/v1/zugang/redeem` mit Body-Grenze 4 KiB, Maschinenzähler bei Fehlschlag,
  Admin-Spur `schluessel_gebunden` ohne Akteur und `#[utoipa::path]`. Verifizieren:
  Integrationstests für:
  - Einlösen;
  - zweites Einlösen 401;
  - abgelaufen 401;
  - falscher Prüfwert 401, und der Code bleibt einlösbar;
  - zehn Fehlversuche ergeben 429, und die Passwort-Anmeldung derselben IP bleibt möglich.
- [x] 4.3 `GET /api/v1/me` (Scope `Keine`) und `GET /api/v1/instanz/jwks.json` (ohne Anmeldung),
  beide mit `#[utoipa::path]`. Im Dokument kommen das Sicherheitsschema `machine` und `servers`
  hinzu (D12). Verifizieren:
  - Integrationstest „Code einlösen, dann signiert `me`“ mit Zugang, Org, Scopes, Serverzeit
    und `clock_offset_s`;
  - die Antwortsignatur prüft mit dem Schlüssel aus dem Einlösen;
  - `docs/api/public-v1.json` ist neu geschrieben, und der Drift-Test ist grün.
- [x] 4.4 Kein Bearer und keine Sitzung unter `/api/v1/`, und `CurrentUser` nimmt
  `Authorization: Machine` nicht an. Verifizieren:
  - Integrationstests mit Lagemonitor-Bearer und mit Admin-Cookie gegen `me` ergeben 401;
  - `Authorization: Machine …` gegen eine Route der Oberfläche ergibt 401.
- [x] 4.5 Schlüsselwechsel über die Routen (D7). Verifizieren: Integrationstest „neuer Code
  eingelöst, alter Schlüssel gilt, neuer Schlüssel signiert, alter Schlüssel 401“.
- [x] 4.6 Gekoppelter ELW (D10). Verifizieren: Integrationstest mit aktiver meldender Kopplung
  der Org: Anlegen 409, Anfrage eines vorher angelegten Zugangs 401 mit Grund
  `instanz_gekoppelt`.

## 5. Admin-Routen

- [x] 5.1 Routen `/api/admin/anbindungen…` aus D11 mit `AdminUser` (schreiben),
  `darf_admin_bereich` (lesen), Org-Prüfung, `JsonBody`/`PfadParam` und Grenzen `*_MAX`
  (gespiegelt in `frontend/src/api/eingabegrenzen.ts`). Dazu die DTOs in `src/api_doc.rs`.
  Verifizieren:
  - Integrationstests: anlegen mit Code, unbekannter Scope 400, fremde Org 404, kein Admin 403,
    ändern, widerrufen, widerrufen und dann ändern 409;
  - Admin-Spur je Aktion;
  - `scripts/check-typ-codegen.sh` ist grün, beide erzeugten Dateien sind mitcommittet.

## 6. Kommando und Referenz-Clients

- [x] 6.1 Crate `crates/lifeline-machine-client`: Schlüsseldatei, `sign_request`,
  `verify_response`, `redeem` hinter dem Feature `http`, als Workspace-Mitglied. Verifizieren:
  `cargo test -p lifeline-machine-client` mit den Testvektoren.
- [x] 6.2 Testvektoren `docs/api/machine-auth-testvektoren.json`. Die Crate schreibt sie im Test
  neu und scheitert bei Abweichung; ein Server-Test prüft das Vektor-JWS mit `verify` bei fester
  Zeit. Verifizieren: Beide Tests sind grün, eine geänderte Claim-Reihenfolge macht sie rot.
- [x] 6.3 Kommandos `lifeline-hub zugang redeem <url> <code> [--out]` und
  `lifeline-hub zugang me <datei>`: Datei mit `0600`, nie überschreiben, Fingerabdruck ausgeben.
  Verifizieren:
  - Test des Arguments-Parsers;
  - ein Integrationstest, der gegen einen Testserver einlöst und `me` aufruft;
  - eine vorhandene Datei bleibt unverändert.
- [x] 6.4 `docs/api/clients/typescript/machineClient.ts` (nur WebCrypto) mit Vitest gegen die
  Testvektoren im Frontend-Lauf. Verifizieren: `mise exec -- pnpm -C frontend vitest run
  <testdatei>` ist grün.
- [x] 6.5 `docs/api/clients/python/machine_client.py` mit `--selftest` gegen die Testvektoren,
  dazu ein Schritt im Bündel `schnell` von `check-all.sh`, laut übersprungen ohne
  `cryptography`. Verifizieren:
  - `python3 -I docs/api/clients/python/machine_client.py --selftest` ist grün;
  - `./scripts/check-all.sh --nur schnell` zeigt den Schritt.
- [ ] 6.6 `docs/api/maschinenzugang.md`: Ablauf Einlösen und Signieren, Claims, Reihenfolge der
  Schlüssel in den Testvektoren, Fehlercodes, Uhr, `me` als erster Aufruf, Verweise auf die
  Clients. Verifizieren: Die Befehle im Dokument laufen gegen einen lokalen Dev-Server (einmal
  von Hand, Ergebnis im PR).

## 7. Seite „Anbindungen“

- [x] 7.1 Design-Entwurf mit `/design` auf Grundlage des Design Systems „Lifeline Hub“ unter
  `docs/design/<datum>-anbindungen/` (`frontend/AGENTS.md`, „Größere UI-Entwürfe über das Design
  System“). Verifizieren: Der Entwurf zeigt Liste, Anlegen, Code-Dialog, Ablehnungsgrund und den
  gesperrten Zustand (D10).
- [x] 7.2 API-Modul `frontend/src/api/anbindungen.ts` und Query-Key `globalKeys.anbindungen` in
  `NICHT_LIVE_GLOBAL_KEYS`. Verifizieren: `globalKeys.test.ts` ist grün, und der Wire-String ist
  eingefroren.
- [x] 7.3 Seite `frontend/src/pages/einstellungen/Anbindungen.tsx` und Sektion `anbindungen` in
  `adminNav.tsx`:
  - Liste, Anlegen im `ErfassungsModal`, Code-Dialog;
  - Ändern in der Ansicht, Widerruf, neuer Code;
  - Ablehnungsgrund in Klartext mit Uhrabweichung in Minuten und Richtung;
  - `RechteHinweis` bei fehlender Berechtigung und am gekoppelten ELW.

  Verifizieren:
  - Vitest der Seite: Klartext je Grund, Scope-Bezeichnungen, gesperrte Aktionen mit Grund;
  - `adminNav.test.tsx` ist grün.
- [ ] 7.4 e2e `frontend/e2e/anbindungen.spec.ts`:
  - Admin legt einen Zugang an und sieht den Code;
  - ein signiertes `me` aus dem Test macht „zuletzt genutzt“ sichtbar;
  - ein Konto ohne Admin sieht die gesperrte Aktion mit Grund.

  Verifizieren: `mise exec -- pnpm -C frontend exec playwright test e2e/anbindungen.spec.ts` ist
  grün.

## 8. Doku und Architektur

- [ ] 8.1 Anwender-Kapitel `docs/anwender/kapitel/anbindungen.md` (Reihenfolge 795, Gruppe
  Administration, Überblick, Abläufe, Hintergrund), dazu die Zeile in `docs/anwender/README.md`.
  Verifizieren: `anwenderdoku.guard.test.ts` ist grün.
- [ ] 8.2 Architektur:
  - Kap. 3: Schnittstelle `/api/v1` für Fremdsysteme;
  - Kap. 5: `src/public_api`, `crates/lifeline-machine-client` und die Seite;
  - Kap. 6: Ablauf „Fremdsystem anbinden“ neben 6.6a;
  - Kap. 8: 8.17 Anmeldung um Maschinen ergänzen;
  - Kap. 11: R33 fortschreiben.

  Verifizieren: `scripts/check-architektur.sh` ist grün.
- [ ] 8.3 ADR-0022 auf `status: akzeptiert`; `gilt_fuer` um `src/public_api/**` ergänzen, falls
  nötig vor dem Akzeptieren. Verifizieren: Der Prüfblock läuft in `scripts/check-architektur.sh`
  grün (kein „Bearer“ unter `src/public_api/`, `MachineClient` und `lifeline-machine+jwt`
  vorhanden).

## 9. Abschluss

- [ ] 9.1 `./scripts/check-all.sh` ist grün (Verweis auf den CI-Lauf des PRs).
- [ ] 9.2 Bilder der Seite „Anbindungen“ (Liste mit Ablehnungsgrund, Code-Dialog, gesperrter
  Zustand) per Wegwerf-Spec im Bildlauf, für PR und Meldung.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (Skelett „Review-find-verify“, Backend und Frontend).
- `/opsx:archive quf3qdil-maschinenzugang` vor dem PR, im selben Branch.
- PR gegen `alpha` mit Plan, Umsetzung und Archiv zusammen; Zunder LLH-1652 auf `review`.
- Danach entsperrt: LLH-1638 (mit Einsatzfreigabe), LLH-1655, LLH-1524, LLH-1192.
