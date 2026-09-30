# Tasks

## 1. Server: Einmalcode ausstellen und einlösen

- [x] 1.1 `src/auth/huelle/` anlegen:
  - `pkce.rs`: Formprüfung von `challenge` und `verifier`, `challenge_aus(verifier)`,
    Vergleich in konstanter Zeit.
  - `state.rs`: Code-Speicher nach dem Muster von `oidc/state.rs`, TTL 60 s, `speichere`,
    `entnehme`, `speichere_mit_ablauf` nur unter `cfg(test)`.

  Nachweis: Unit-Tests für den RFC-7636-Vektor (Anhang B), die Formgrenzen (42/43/128/129
  Zeichen, fremde Zeichen) sowie für einmaliges Entnehmen, Ablauf und unbekannten Code
  (`cargo test -p lifeline-hub auth::huelle`).
- [x] 1.2 `POST /api/auth/app-code` (`CurrentUser`, Body `{challenge}` über `JsonBody`,
  Antwort-DTO `{code}` mit `ToSchema`) und `POST /api/auth/app-code/einloesen` (Body
  `{code, verifier}`, Ablauf nach design.md Entscheidung 5) in `routes/auth.rs` anlegen und in
  `src/app.rs` registrieren. Nachweis: neuer Integrationstest `tests/app_anmeldung.rs` mit:
  - Ausstellen ohne Sitzung → 401, falsche `challenge` → 400.
  - Einlösen mit passendem `verifier` → 204 und Set-Cookie `lifeline_sid`, danach `/api/auth/me` 200 als ausstellende Person.
  - Zweites Einlösen → 401, falscher `verifier` → 401, danach mit dem richtigen ebenfalls 401 (verbraucht).
  - Abgelaufen → 401 (über den Test-Hook).
  - Deaktiviertes Konto → 401.
  - Unbekannt und falsch gebunden: Status und Text sind gleich.
  - Leerer oder fehlender `verifier` → 400.
  - Die Browsersitzung bleibt gültig.
  - Eine alte `lifeline_sid` in der Einlöse-Anfrage wird gelöscht.
- [x] 1.3 Audit und Rate-Limit an der Einlösung ergänzen: `login_ok` bzw.
  `login_fehlgeschlagen` mit dem Anbieter `systembrowser`, `fehlversuch` bei Scheitern, 429 bei
  gesperrter Adresse. Nachweis: Fälle in `tests/app_anmeldung.rs`, die die `auth_audit`-Zeilen
  und 429 nach zehn Fehlversuchen prüfen.
- [x] 1.4 Typ-Codegen nachziehen (`scripts/check-typ-codegen.sh`, `openapi.json` und
  `types.generated.ts` mitcommitten), Request-DTOs von Hand in `frontend/src/api/auth.ts`.
  Nachweis: `check-typ-codegen.sh` grün.

## 2. Webanwendung: Bestätigungsseite, Anmeldeseite, Profil

- [x] 2.1 `frontend/src/api/auth.ts` um `appCodeAusstellen(challenge)` erweitern. Nachweis:
  Vitest für Pfad und Body.
- [x] 2.2 Seite `pages/AppAnmeldungPage.tsx` und Route `/app-anmeldung` in `App.tsx` anlegen:
  - Ohne Sitzung navigiert die Seite zu `/login` mit `von=/app-anmeldung?challenge=…`.
  - Mit Sitzung zeigt sie „In der Mac-App anmelden als <Anzeigename>“ mit „In der App
    anmelden“ (primär) und „Mit anderem Konto“ (Abmelden, dann Anmeldung mit Rückweg).
  - Nach dem Klick fordert sie den Code an, setzt `location.href = 'lifeline://anmeldung?code=…'`
    und sagt danach „Du kannst dieses Fenster schließen“.
  - Eine ungültige oder fehlende `challenge` erzeugt einen Hinweis und keine Anfrage.
  - Ein Fehler beim Ausstellen landet an der Seite, nicht als Toast.

  Nachweis: Vitest für jeden dieser Fälle. Der Code erscheint nicht im DOM.
- [x] 2.3 Prüfen, dass OIDC (`?von=` über `ziel_pfad_aus_query`), Passwort, TOTP und Passkey
  auf `/app-anmeldung?challenge=…` zurückführen. Nachweis: Vitest der `LoginPage` mit
  `location.state.von` inklusive Query, dazu ein Rust-Test `ziel_pfad_aus_query` mit Query.
- [x] 2.4 `huelle/faehigkeiten.ts` um `huelleAnmeldungImBrowser()` erweitern, einzige
  Lesestelle. Nachweis: Vitest gegen das ausgelieferte `faehigkeiten.js` (`test/huelle.ts`,
  `__TAURI_INTERNALS__` als Stub) für diese drei Fälle:
  - Browser liefert `null`.
  - Mac-Hülle liefert eine Funktion, die `invoke('anmeldung_im_browser')` ruft.
  - Ein Objekt ohne Feld liefert `null`.
- [x] 2.5 `LoginPage.tsx` anpassen:
  - „Im Browser anmelden“ (umrandet) unter Formular und SSO, wenn die Hülle es meldet.
  - Ersetzt den LFH-817-Hinweis bei nur-Passkey.
  - Hört auf `lifeline:app-anmeldung`:
    - `angemeldet` → `aktualisiere()` und `navigate(zielPfad)`,
    - `abgelehnt`/`fehler` → Hinweis an der Seite,
    - `abgebrochen` → Signal ohne Wirkung auf den Knopf.
  - Doppelklick-Riegel nur, solange der `invoke` läuft.
  - Der Passkey-Knopf bleibt in der Hülle aus.

  Nachweis: Vitest mit `starteMacHuelle()` für jeden Zweig und die Gegenprobe im Browser (kein
  Knopf). Mutationsprobe: Der Knopf ohne Hüllenbedingung macht den Browserfall rot.
- [x] 2.6 Den Profil-Hinweis in `ProfilPage.tsx` auf den Weg „Im Browser anmelden“
  umschreiben. Die Einrichtung bleibt ausgeblendet. Nachweis: Vitest für den Hinweistext und die
  weiterhin fehlende Einrichtung.
- [x] 2.7 Prüfliste Einsatztauglichkeit (15 Kriterien) für `AppAnmeldungPage` (neu),
  `LoginPage` und `ProfilPage` (umgebaut), je Zeile ein Verdikt, abgelegt unter
  `docs/superpowers/specs/2026-09-30-lfh-818-pruefliste.md`. Nachweis: Datei mit 3 × 15
  Verdikten, keins „nicht geprüft“.
- [x] 2.8 Die neue Route in die Routenlisten der Layout-Gates aufnehmen, sofern sie dort geführt
  werden. Ergebnis: Gate 1 und Gate 3 führen Einsatz- und Verwaltungsrouten, auch `/login` steht
  in keiner Liste (Gate 3 nutzt es nur zum Anmelden). `/app-anmeldung` teilt die Login-Karte
  (`LoginPage.css`) und bleibt deshalb wie `/login` draußen. Die Trefflächen stehen in der
  Prüfliste (2.7) [abgeleitet].

## 3. Hülle: Anmeldung im Systembrowser

- [ ] 3.1 Abhängigkeiten in `src-tauri/Cargo.toml` ergänzen:
  - nur macOS: `objc2`, `objc2-foundation`, `objc2-authentication-services` (Features
    `ASWebAuthenticationSession`, `ASFoundation`, `block2`), `block2`,
  - für alle: `sha2`, `base64`, `getrandom`.

  Nachweis: `cargo build -p lifeline-desktop` und `scripts/check-deps.sh` grün.
- [x] 3.2 `src-tauri/src/pkce.rs` (rein): `neuer_verifier()`, `challenge_aus(verifier)`.
  Nachweis: RFC-7636-Vektor, Länge 43, zwei Aufrufe liefern verschiedene `verifier`.
- [x] 3.3 Deeplink: `deute` bleibt auf `verbinden` beschränkt, ein `lifeline://anmeldung` von
  außen ergibt also nichts. `anmeldecode_aus(url)` in `anmeldung.rs` akzeptiert nur
  `lifeline://anmeldung?code=<64 hex>` und liest ausschließlich den Rücksprung der Sitzung.
  `deeplinks_verarbeiten` protokolliert verworfene Links über `fuers_protokoll`, ohne Query.
  Nachweis: Unit-Tests `anmeldung_von_aussen_bewirkt_nichts`,
  `verworfener_anmeldelink_landet_ohne_code_im_protokoll` und `code_nur_aus_dem_anmelde_ruecksprung`,
  dazu die bestehenden `verbinden`-Tests grün.
- [x] 3.4 `src-tauri/src/anmeldung.rs`:
  - `einloese_skript(origin, code, verifier)` (rein, JSON-Literale, innere Origin-Prüfung,
    `CustomEvent` ohne Geheimnisse) und `abbruch_skript()`,
  - `origin_passt(fenster_url, server)` und `folge(ergebnis, seite, server)` (Einlösen, Melden
    oder Nichts).

  Nachweis: Unit-Tests für diese drei Fälle:
  - Anführungszeichen und `</script>` im Code brechen das Literal nicht,
  - das Ereignis trägt weder Code noch `verifier`,
  - die Origin-Prüfung lehnt einen fremden Host und einen anderen Port ab.
- [x] 3.5 `src-tauri/src/aswas.rs` (nur macOS): `ASWebAuthenticationSession` mit Anker
  Hauptfenster, `callbackURLScheme = "lifeline"`, Schalter für ephemer, Completion-Handler als
  Rust-Closure. Nachweis: `cargo build -p lifeline-desktop` auf macOS. Das Verhalten prüft 5.2.
- [x] 3.6 Command `anmeldung_im_browser` in `main.rs`:
  - im Zustand `Mutex<Option<Ausstehend>>` mit `verifier` und Label des aufrufenden Fensters,
    ein neuer Start ersetzt den alten,
  - Ziel `<gespeicherter Server>/app-anmeldung?challenge=…`,
  - Rücksprung → `origin_passt` für das startende Fenster → `eval(einloese_skript)` dort,
    Abbruch → `eval(abbruch_skript)`,
  - auf Nicht-macOS ein Fehler.

  Eintrag in `build.rs` (`AppManifest`), `.permission("allow-anmeldung-im-browser")` in
  `server_freigeben`, `generate_handler!`. Nachweis: `cargo test -p lifeline-desktop` grün, dazu
  ein Test, dass das autogenerierte Permission-File existiert und `lokal.json` den Command nicht
  enthält.
- [x] 3.7 `faehigkeiten.js` um `anmeldungImBrowser` erweitern, eingefroren, per
  `__TAURI_INTERNALS__.invoke`. Nachweis: die Vitest-Fälle aus 2.4 und 2.5, die das
  ausgelieferte Skript ausführen.

## 4. Doku

- [x] 4.1 `docs/betrieb/desktop-app.md` aktualisieren:
  - Die Grenze „SSO-Konten mit Passkey-only-IdP“ entfernen.
  - Den Ablauf „Im Browser anmelden“ beschreiben, einschließlich der macOS-Rückfrage „…
    möchte ‚elw.local‘ zum Anmelden verwenden“ und der Bestätigungsseite.
  - Den Standardbrowser-Hinweis aufnehmen.

  Nachweis: Review gegen `messung.md` und dieses Design.
- [x] 4.2 `CLAUDE.md`, Abschnitt Desktop-Hülle: der neue Command als zweite Freigabe der
  Serverseite (neben `drucken`) und die Einlösung per `eval` mit doppelter Origin-Prüfung, in
  einer Zeile mit Verweis auf dieses Design. In `openspec/changes/lfh-783-passkey-macos-huelle/design.md`
  bei Stufe 2 auf diesen Change verweisen. Nachweis: Verweise greppen, Pfade existieren.
- [x] 4.3 Folgeticket für die fehlenden Audit-Einträge im Browser (OIDC, `totp_finish`,
  `webauthn_auth_finish`) über `clickup-task-anlegen`. Nachweis: Ticket-ID im PR. Angelegt als
  LFH-846.

## 5. Integration und Abnahme

- [ ] 5.1 `./scripts/check-all.sh` grün (alle Schritte, auch `cargo test -p lifeline-desktop`
  getrennt). Nachweis: Gesamtstatus des Laufs.
- [ ] 5.2 Abnahme von Hand auf dem Mac mit `https://elw.local:8443` und der echten Hülle
  (`cargo tauri build --debug`). Die Ergebnisse gehen als Belege nach
  `belege/macos/abnahme.md`:
  1. PocketID-Konto ohne Passwort kommt per „Im Browser anmelden“ hinein.
  2. Lifeline-Passkey aus dem Browser trägt.
  3. Abbruch lässt die Anmeldeseite stehen. Nach dem Schließen des Vivaldi-Fensters ist der
     Knopf wieder bedienbar.
  4. Ein von außen geöffneter `lifeline://anmeldung?code=…` bewirkt nichts und steht ohne Code
     im Protokoll.
  5. Zweites Einlösen desselben Codes (per `curl`) ergibt 401.
  6. `auth_audit` enthält `login_ok`/`systembrowser`.
