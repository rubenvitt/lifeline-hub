# 6. Laufzeitsicht

Stand: 23.10.2026 (alpha dcc500f5).

Dieses Kapitel zeigt acht Abläufe über mehrere Bausteine. Die Bausteine heißen wie in der
[Bausteinsicht](05-bausteinsicht.md). Die Diagramme zeigen den Regelfall; Sonderfälle und Regeln
stehen in den genannten Dateien und Bereichs-`AGENTS.md` und werden hier nicht wiederholt.

| Nr. | Szenario | Tragende Bausteine |
| --- | --- | --- |
| 6.1 | Start des Servers | `src/main.rs`, `src/config.rs`, `src/db.rs` |
| 6.2 | Anmeldung und Sitzung | `src/auth`, `frontend/src/auth`, `src-tauri` |
| 6.3 | ETB-Eintrag schreiben, Live-Ereignis verteilen | `src/etb`, `src/live`, `frontend/src/live` |
| 6.4 | Schreiben ohne Netz und Nachsenden | `frontend/src/offline`, `src/routes` |
| 6.5 | Lagebild ohne Netz lesen | `frontend/src/offline`, `frontend/src/auth`, Service Worker |
| 6.6 | Gerät koppeln und Funktionsansicht | `src/geraet`, `frontend/src/geraet` |
| 6.7 | Kartenkacheln über Proxy, Cache und Offline-Karte | `src/karte`, `karten-service` |
| 6.8 | Benachrichtigung und Web Push | `src/benachrichtigung`, `src/web_push`, `frontend/src/alarm` |

„Ohne Netz“ hat zwei Bedeutungen: In 6.4 und 6.5 erreicht das Endgerät den Server nicht. In 6.7
erreicht der Server das Internet nicht, die Endgeräte erreichen ihn aber.

## 6.1 Start des Servers

```mermaid
sequenceDiagram
  participant Op as Betrieb (Shell, Container)
  participant BE as lifeline-hub (src/main.rs)
  participant DB as SQLite (lifeline.db)
  participant FS as Datenverzeichnis
  Op->>BE: Start mit Flags oder LIFELINE_* (src/config.rs)
  BE->>DB: db::connect, db::migrate, versionsstand::beim_start
  BE->>DB: physisch_bereinigen (WAL zurückschreiben, einmal VACUUM)
  BE->>DB: bootstrap_admin (Organisation, Admin, Kataloge)
  BE->>FS: karten/ anlegen, Reste von Downloads und Sicherungen räumen
  BE->>BE: LiveHub, optional Web Push, Hintergrund-Tasks
  BE->>BE: OIDC, WebAuthn, Cookie-Secure, Proxys prozessweit setzen
  alt --tls
    BE->>FS: Zertifikat beschaffen (src/tls)
    BE-->>Op: lauscht HTTPS auf --bind
  else
    BE-->>Op: lauscht HTTP auf --bind
  end
  Op->>BE: SIGTERM oder Ctrl+C
  BE->>BE: 10 s Graceful Shutdown, Sicherung bis 45 s, Pool schließen
```

- Die Reihenfolge steht in `run_server` (`src/main.rs`). `bootstrap_admin` läuft vor den
  Dev-Seeds, weil es nur auf leerer Datenbank Kataloge anlegt; ohne `--admin-password` schreibt
  es ein erzeugtes Passwort ins Log.
- `db::connect` (`src/db.rs`): WAL, `busy_timeout` 5 s, `secure_delete`, höchstens 5
  Verbindungen. Neue Migrationen: Wurzel-[`AGENTS.md`](../../AGENTS.md), „Migrationsvergabe“.
- Hintergrund-Tasks aus `run_server`: Kanal-Sweep des `LiveHub` (alle 5 min,
  `src/live/mod.rs`), Erinnerungen (30 s, `src/erinnerung/scheduler.rs`), Purge und Schwärzung
  (600 s, `src/einsatz/purge_scheduler.rs`), Sicherung (nur mit `--backup-verzeichnis`,
  `src/backup`), Datenträgerprüfung (stündlich, `src/datentraeger/mod.rs`), KRITIS-Import
  (`src/karte/kritis`), Wächter der Offline-Karten (erste Prüfung nach 60 s,
  `src/karte/auto_aktualisierung.rs`).
- Schalter, die eine Vertrauensgrenze verschieben, landen als Warnung im Log; die Liste steht in
  [`docs/betrieb/env-registry.md`](../betrieb/env-registry.md). Beide Serve-Zweige laufen über
  `axum-server` mit `verbindung::SemaphorAkzeptor` und den Fristen aus `src/verbindung.rs`.
  Ohne Serverlauf arbeiten die Unterkommandos `backup`, `restore` und `sqlite-version`.

## 6.2 Anmeldung und Sitzung

```mermaid
sequenceDiagram
  participant FE as frontend (frontend/src/auth)
  participant BE as lifeline-hub (src/routes/auth.rs)
  participant DB as SQLite
  FE->>BE: POST /api/auth/login {benutzername, passwort}
  BE->>BE: Anmelde-Bremse (quelle_pruefen), Passwort prüfen
  alt TOTP aktiv
    BE-->>FE: {mfa_erforderlich}, Cookie mfa_pending
    FE->>BE: POST /api/auth/totp/finish {code}
  else Einmalpasswort
    BE-->>FE: {passwort_wechsel_erforderlich}
    FE->>BE: POST /api/auth/passwort/festlegen
  end
  BE->>DB: session::anlegen (Token-Hash, 7 Tage), auth_audit login_ok
  BE-->>FE: Benutzer, Cookie lifeline_sid (HttpOnly, SameSite=Lax)
  FE->>FE: AuthContext übernimmt, Lagebild und Gerätedaten anmelden
  FE->>BE: GET /api/auth/me (Wahrheit über die Sitzung)
```

- Passwortweg: `login` in `src/routes/auth.rs`. Bei Zweitfaktor entsteht noch keine Sitzung,
  nur ein Schlüssel in `src/auth/totp/state.rs` (5 min). Cookie: `session_cookie`; Lebensdauer
  `SITZUNG_TAGE` = 7 (`src/auth/session.rs`).
- **OIDC:** `oidc_start` leitet mit PKCE, `state` und `nonce` zum Identitätsanbieter;
  `oidc_callback` prüft das `state`-Cookie, legt die Sitzung an und leitet auf den Zielpfad. Der
  Service Worker beantwortet Seitenwechsel auf `/api/` deshalb nie mit der App-Hülle
  (`navigateFallbackDenylist`, `frontend/vite.config.ts`). **Passkey:** `src/auth/webauthn`, gelistet nur bei gültigem
  `rp_id`/`rp_origin` beim Start (`src/main.rs`).
- **Desktop-App (macOS):** „Im Browser anmelden“ öffnet eine `ASWebAuthenticationSession`
  (`src-tauri/src/aswas.rs`). Der Systembrowser holt mit seiner Sitzung über
  `POST /api/auth/app-code` einen Einmalcode (`TTL` 60 s, `src/auth/huelle/state.rs`) und springt
  mit `lifeline://anmeldung?code=…` zurück; die Hülle löst ihn mit dem PKCE-`verifier` im Webview
  über `POST /api/auth/app-code/einloesen` ein (`src-tauri/src/anmeldung.rs`). Regeln:
  [`src-tauri/AGENTS.md`](../../src-tauri/AGENTS.md).
- Jede schreibende Anfrage trägt `X-Erwarteter-Benutzer-Id`; bei Abweichung antwortet
  `CurrentUser` mit 412 und der Client prüft per `/me`. Regeln und Abmeldewege:
  [`frontend/src/auth/AGENTS.md`](../../frontend/src/auth/AGENTS.md).

## 6.3 ETB-Eintrag schreiben, Live-Ereignis verteilen

```mermaid
sequenceDiagram
  participant A as frontend Tab A (useEtbErfassung)
  participant BE as lifeline-hub (src/routes/etb.rs)
  participant DB as SQLite
  participant Hub as LiveHub (src/live)
  participant B as frontend Tab B (useEinsatzLiveStream)
  B->>BE: GET /api/einsaetze/{id}/live (SSE, Last-Event-ID)
  BE->>Hub: abonniere_mit_position
  A->>BE: POST /api/einsaetze/{id}/etb {client_id, …}
  BE->>DB: laden_nach_client_id, anlegen_idempotent_mit_meldung
  BE->>Hub: publiziere(einsatz_id, etb_id), nur wenn neu
  BE-->>A: 201 Created
  Hub-->>B: event: etb (nur Kennung), gefiltert nach Modulrecht
  B->>B: Sammler 300 ms, invalidateQueries([etb, id])
  B->>BE: GET /api/einsaetze/{id}/etb
```

- `erfassen` (`src/routes/etb.rs`) prüft Schreibfreigabe, Offline-Queue-Besitzer und
  `client_id` vor dem Schreiben. Derselbe Eintrag unter derselben `client_id` ist ein Replay,
  anderer Wortlaut darunter 409 (`CLIENT_ID_KONFLIKT`).
- Über den Kanal geht nur die Kennung; der Client lädt mit seinen eigenen Rechten nach. Welches
  Ereignis welchem Modul gehört, legt `LiveEvent::modul_keys` fest (`src/live/mod.rs`).
- Puffer `KANAL_KAPAZITAET` und `REPLAY_KAPAZITAET` je 256, `REPLAY_KARENZ` 10 min
  (`src/live/mod.rs`). Nach einem Abriss liefert `Last-Event-ID` das Verpasste nach; nach einem
  Überlauf kommt `lagged`, und der Client gleicht alle Keys ab. Je Benutzer höchstens 16 Ströme,
  Lebensdauer 30 min plus Streuung (`src/live/strom.rs`).
- Der Client hält **eine** `EventSource` je Einsatz (`frontend/src/live/useEinsatzLiveStream.ts`)
  und verteilt über `EINSATZ_STREAM_EVENTS` (`frontend/src/api/queryKeys.ts`).
  `liveInvalidierung.ts` bündelt in Fenstern von 300 ms (Modulzähler 1000 ms). Scheitert die
  Verbindung, prüft `liveVerbindung.ts` `/api/auth/me` und übergibt bei 401 an die
  Sitzungswache. Spec: [`openspec/specs/live-abgleich/`](../../openspec/specs/live-abgleich/spec.md).

## 6.4 Schreiben ohne Netz und Nachsenden

```mermaid
sequenceDiagram
  participant H as frontend (useEtbErfassung)
  participant Q as IndexedDB lifeline-offline
  participant BE as lifeline-hub
  H->>H: client_id = neueClientId() (einmal)
  H->>BE: POST …/etb
  BE--xH: Netzfehler, 401, 408, 429 oder 5xx
  H->>Q: queueEinreihen, Anzeige „vorgemerkt“ ohne Nummer
  Note over H: online-Ereignis, Mount oder Backoff 1/5/15/30 s
  H->>H: navigator.locks offline-flush-{einsatz}
  loop je Eintrag aus queueLaden, in Reihenfolge
    H->>BE: POST …/etb (X-Offline-Queue-Benutzer-Id, gleiche client_id)
    alt 201 oder Replay
      H->>Q: queueEntfernen
    else 400, 403, 404, 409, 422
      H->>Q: queueAblehnen (Wiederherstellungsbereich)
    end
  end
  H->>H: invalidateQueries([etb, id])
```

- Ablauf und Fehlerklassen: `frontend/src/offline/useEtbErfassung.ts`. Person, Meldung, Stand,
  Belegung, Eintreffen und Verpflegung gehen über die `erfasse…OfflineFaehig`-Funktionen
  (`frontend/src/offline/schreiben.ts`) und den Abgleich in `useOfflineSync.ts`.
- Die `client_id` steht vor dem ersten Versuch fest: ein Commit mit verlorener Antwort wird beim
  Nachsenden zum Replay (6.3). Den Header `X-Offline-Queue-Benutzer-Id` prüft
  `fordere_offline_queue_benutzer` (`src/routes/support.rs`) gegen die Sitzung, Abweichung 412.
- Änderungen bestehender Daten (PATCH) sind ohne Netz gesperrt statt vorgemerkt; online schützt
  sie ein optimistisches Lock, etwa `basis_geaendert_at` an der Person
  (`src/routes/einsatz_person.rs`). Zeitstempel vorgemerkter Erfassungen folgen der Serveruhr
  (`frontend/src/offline/serveruhr.ts`).
- Regeln: [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md), „Schreiben
  ohne Netz“ und „Gerätedaten beim Abmelden“.

## 6.5 Lagebild ohne Netz lesen

```mermaid
sequenceDiagram
  participant SW as Service Worker (Precache)
  participant FE as frontend (AuthContext)
  participant LB as IndexedDB lifeline-lagebild
  participant BE as lifeline-hub
  FE->>SW: App-Hülle laden
  SW-->>FE: index.html und Bundles aus dem Precache
  FE->>BE: GET /api/auth/me
  alt Erfolg
    BE-->>FE: Benutzer, bestaetigtAt neu
    FE->>LB: Stand nur als Vorrat, kein hydrate
  else andere Antwort des Servers (auch 401 oder 500)
    FE->>LB: Offline-Identität und Lagebild verwerfen
  else Netzfehler oder 502/503/504
    FE->>LB: Kopf lesen (Identität, bestaetigtAt)
    alt jünger als 24 h
      LB-->>FE: Benutzer und Lagebild, hydrate, „· offline“
    else älter
      FE->>LB: verwerfen, Anmeldemaske
    end
  end
  Note over FE,LB: laufend: Cache-Änderung → gedrosselt dehydrieren
```

- Den Precache baut `VitePWA` mit `registerType: 'prompt'` (`frontend/vite.config.ts`); ein neuer
  Stand wird erst nach einem Klick aktiv (`frontend/src/pwa/appAktualisierung.ts`). Der Service
  Worker braucht einen sicheren Kontext, also HTTPS ([Verteilungssicht](07-verteilungssicht.md)).
- Die Startentscheidung trifft `startEntscheidung` mit `HOECHSTLIEGEZEIT_MS` = 24 h
  (`frontend/src/offline/lagebildStart.ts`), aufgerufen aus `AuthContext.tsx` über
  `lagebildStarten` (`frontend/src/offline/lagebildSitzung.ts`).
- Was auf die Platte darf, bestimmen `LAGEBILD_OFFLINE` und `istLagebildOfflineKey`
  (`frontend/src/api/queryKeys.ts`), gekürzt in `frontend/src/offline/lagebildKuerzung.ts`.
  Kartenkacheln liegen nicht im Browser; die Lagekarte holt sie vom Server (6.7).
- Regeln, Fristen, Räumen: [`frontend/src/offline/AGENTS.md`](../../frontend/src/offline/AGENTS.md).
  Spec: [`openspec/specs/lagebild-offline-lesen/`](../../openspec/specs/lagebild-offline-lesen/spec.md).

## 6.6 Gerät koppeln und Funktionsansicht

```mermaid
sequenceDiagram
  participant EL as frontend Einsatzleitung
  participant BE as lifeline-hub (src/routes/geraet.rs)
  participant DB as SQLite
  participant G as frontend Gerät (frontend/src/geraet)
  participant Hub as LiveHub
  EL->>BE: POST /api/einsaetze/{id}/geraete {ansicht, stelle_id, bezeichnung, laeuft_ab_at}
  BE->>DB: Gerätekonto, geraet_kopplung, Code (10 min), ETB-Systemeintrag
  BE-->>EL: 201 KopplungMitCode
  EL->>G: QR mit /koppeln#CODE
  G->>BE: POST /api/geraete/koppeln {code}
  BE->>DB: session::anlegen_geraet (mit kopplung_id)
  BE-->>G: Cookie lifeline_sid, Neuladen auf GERAET_START_PFAD
  G->>BE: GET /api/einsaetze/{id}/live, dann Anfragen der Ansicht
  BE->>BE: CurrentUser: fordere_geraeteroute gegen die Routenliste
  EL->>BE: POST …/geraete/{gid}/widerrufen
  BE->>Hub: melde_kopplung_ende
  Hub-->>G: Strom endet, KopplungBeendetPage
```

- Konstanten in `src/geraet/mod.rs`: `CODE_MINUTEN` = 10, `STANDARD_STUNDEN` = 24,
  `HOECHSTENS_STUNDEN` = 72; der Code hat 8 Zeichen aus 32 (`src/geraet/code.rs`).
- Die Schranke steht beim Server: `CurrentUser` (`src/auth/session.rs`) prüft für eine
  Gerätesitzung Methode und Routenmuster gegen die Liste der Funktionsansicht in
  `src/geraet/mod.rs`, was fehlt, ist 403. Stellenbindung: `src/geraet/stelle.rs`.
- Ein unbekannter, abgelaufener oder verbrauchter Code ist einheitlich 401 (eine gesperrte Adresse
  vorher 429); beide Ausgänge stehen in `auth_audit` mit dem Anbieter `geraetecode`
  (`src/routes/geraet.rs`). Regeln:
  [`frontend/src/geraet/AGENTS.md`](../../frontend/src/geraet/AGENTS.md).

## 6.7 Kartenkacheln über Proxy, Cache und Offline-Karte

```mermaid
sequenceDiagram
  participant ML as frontend Lagekarte (MapLibre)
  participant BE as lifeline-hub (src/karte)
  participant TC as tile-cache.db
  participant Up as Online-Kartenanbieter
  participant MB as MBTiles in karten/
  ML->>BE: GET /api/karte/config
  BE-->>ML: Quellen, bei Proxy relative /api/karte/proxy/{id}/…
  alt Online-Quelle über Proxy
    ML->>BE: GET /api/karte/proxy/{id}/tile/{slot}/{z}/{x}/{y}
    BE->>TC: nachschlagen
    opt fehlt oder veraltet
      BE->>Up: GET (SSRF-Prüfung, If-None-Match)
      BE->>TC: speichern (LRU unter 256 MB)
    end
    BE-->>ML: Kachel (fällt der Anbieter aus, der alte Stand)
  else Offline-Karte
    ML->>BE: GET /api/karte/offline/tiles/{z}/{x}/{y}
    BE->>MB: Kachel lesen (TMS-Y-Flip)
    BE-->>ML: Kachel gzip, ohne aktive Karte 204
  end
```

- Proxy `src/karte/proxy.rs`: ein Schlüssel in der URL des Anbieters bleibt auf dem Server.
  Cache `src/karte/tile_cache.rs`: `TILE_CACHE_CAP_BYTES` = 256 MB in `<karten_dir>/tile-cache.db`;
  gleichzeitige Fehlgriffe auf dieselbe URL teilen sich einen Abruf (LFH-930, Modulkopf).
- Offline-Karten `src/karte/mbtiles.rs`; Glyphs und Sprite sind eingebettet
  (`/api/karte/offline/{fonts,sprites}/…`). Das Frontend wählt online, dann offline, sonst den
  Blind-Modus ([`docs/betrieb/packaging.md`](../betrieb/packaging.md), „Lagekarte / Basemap“).
- Bezug: Der Admin lädt eine Karte aus dem Katalog (`src/karte/katalog.rs`,
  `crates/karten-katalog`) per SHA256-Pin nach `karten/` (`src/karte/download.rs`).
  `POST /api/karte/offline-karten/bauen` reicht einen Bauauftrag mit Token an
  `POST {url}/builds` des `karten-service` weiter (`src/routes/karte.rs`). Der baut mit `make`
  und Docker aus `karten-build` (`karten-service/src/build/make_runner.rs`) und lädt Ergebnis und
  Manifest in den Objektspeicher (`karten-service/src/storage/s3.rs`). Spec:
  [`openspec/specs/offline-karten-aktualisierung/`](../../openspec/specs/offline-karten-aktualisierung/spec.md).

## 6.8 Benachrichtigung und Web Push

```mermaid
sequenceDiagram
  participant BE as lifeline-hub (Schreibweg, Scheduler)
  participant N as src/benachrichtigung
  participant Hub as LiveHub
  participant WP as src/web_push
  participant PD as Push-Dienst des Browsers
  participant FE as frontend (Tab offen)
  participant SW as Service Worker (alarm-sw.js)
  BE->>N: melden(Anlass) nach dem Commit
  N->>N: aufloesung::empfaenger, je Empfänger eine Zeile
  N->>Hub: zustellen: event benachrichtigung
  Hub-->>FE: nur an Verbindungen der Empfänger
  FE->>FE: Zentrale: Toast, Ton, ggf. OS-Meldung
  opt --web-push
    N->>WP: versenden (nur Kennungen, RFC 8291)
    WP->>PD: POST an den Abo-Endpunkt
    PD-->>SW: push
    SW->>BE: GET /api/benachrichtigungen/{id} (mit Sitzung)
    SW->>SW: showNotification (Tag wie im Tab)
  end
```

- Wer eine Benachrichtigung bekommt, entscheidet allein `melden` (`src/benachrichtigung/mod.rs`);
  den Text bildet der Server erst beim Lesen (`src/benachrichtigung/text.rs`).
- `frontend/src/live/benachrichtigungListener.ts` leitet nur weiter; Ton, Toast und Meldung
  entscheidet `frontend/src/alarm/useBenachrichtigungen.ts`. In der Desktop-App zeigt
  `benachrichtigung_zeigen` die Meldung über das Betriebssystem (`src-tauri/AGENTS.md`).
- Web Push nur mit `--web-push` (`src/main.rs`): höchstens 8 Versände gleichzeitig, 10 s
  Zeitlimit, der Push-Dienst hält die Nachricht 12 h, Abos nur bei Hosts in `PUSH_DIENSTE`
  (`src/web_push/mod.rs`). Erreicht der Service Worker den Server nicht, zeigt er den Titel der
  Stufe (`frontend/public/alarm-sw.js`).
- Specs: [`benachrichtigungen`](../../openspec/specs/benachrichtigungen/spec.md),
  [`web-push`](../../openspec/specs/web-push/spec.md); Betrieb:
  [`docs/betrieb/web-push.md`](../betrieb/web-push.md).
