# Design

## Context

Ausgangslage am 12.11.2026 (`origin/alpha` 7e5c39e5), Motivation in proposal.md.

- **Signatur der Instanzkopplung** (`src/instanz/`):
  - Das kompakte JWS ist selbst geschrieben und nutzt `ed25519_dalek::verify_strict`.
  - In `signatur.rs` sind `TYP_ANFRAGE`, `SCHEMA` und `ANTWORT_KOPF` fest verdrahtet. Die
    Claim-Structs `Anfrage` und `Antwort` tragen `pv` fest; `sign` und `verify` sind privat.
  - `code.rs` leitet per HKDF-SHA256 die Werte `suche`, `k_einloeser` und `k_aussteller` ab, mit
    privatem `SALZ`. Dazu kommen Prüfwerte (HMAC) über Transkripte mit Längenpräfix.
  - Instanz-UUID und Instanzschlüssel liegen in `instanz_identitaet` (`identitaet::load_or_create`).
  - `extractor.rs` (`GekoppelteInstanz`) ist die Vorlage für einen Extractor, der den Body liest.
- **Anmeldesperre:** `src/auth/rate_limit.rs` ist eine Tabelle im Prozessspeicher je Quelle
  (IPv6 /64), 10 Fehlversuche in 300 s. Sie gehört der Anmeldung (ADR-0016) und ist hier tabu.
- **Token-Bucket:** Einen gibt es nur in `geocoding::TokenBucket`. Er liest `Instant::now()`
  intern und ist deshalb nicht testbar.
- **Admin-Spur:** `AdminAktion` ist ein `wire_enum!`. Den CHECK baut jede Erweiterung per
  Migration neu, zuletzt 0317. Aufgeräumt wird in Phase C von `purge_scheduler`.
- **v1-Gerüst aus LLH-1653** (Change `h5zpb97t-oeffentliche-api-vertrag`):
  - `public_api::router()` ist ein `utoipa_axum::OpenApiRouter`. Jeder Handler trägt
    `#[utoipa::path]`.
  - Dazu kommen `ApiError`/`ErrorCode` und eine Schicht, die `code` und `no-store` ergänzt.
  - Die Body-Grenze ist `PUBLIC_API_BODY_MAX` = 64 KiB, das Dokument liegt in
    `docs/api/public-v1.json`.
- **Kommandozeile:** clap mit derive, `Command` in `src/config.rs`, Verzweigung in `main.rs`.
- **Cargo-Workspace** mit `crates/karten-katalog` als Vorbild für eine weitere Crate.

## Goals / Non-Goals

**Goals:**

- Eine Krypto-Implementierung im Server für Instanzen und Maschinen. Die Profile unterscheiden
  sich nur in Werten.
- Der Extractor schließt bei fehlender Scope-Angabe ab (fail closed). Eine v1-Route kann nicht
  versehentlich ohne Scope-Prüfung entstehen.
- Ein Fremdsystem mit falscher Uhr sperrt niemanden aus, und der Admin sieht, warum es scheitert.

**Non-Goals:**

- Einsatzfreigabe für Scopes mit Einsatzbezug (LLH-1638).
- `geocoding::TokenBucket` umstellen. Der neue Bucket ist eigenständig; der alte kann später
  folgen.
- Eine geteilte Krypto-Crate für Server und Client. Der Referenz-Client implementiert absichtlich
  selbst (D9).
- Der Unterschriftsschlüssel des Admins (`org-admin-unterschrift`) als Bedingung. Die
  Instanzkopplung braucht ihn, weil die Gegenseite Admin-Schlüssel kennen muss. Ein Fremdsystem
  braucht das nicht; es gilt dieselbe Rechteprüfung wie bei den Lagemonitor-Zugängen
  (`AdminUser`, eigene Org).

## Decisions

### D1 Profil statt Kopie in `src/instanz/signatur.rs` und `code.rs`

`signatur.rs` bekommt `pub struct Profil { typ_anfrage, typ_antwort, schema, antwort_kopf }` mit
den Konstanten `INSTANZ` und `MACHINE`.

- `sign` und `verify` werden generisch über die Claims (`C: Serialize`/`DeserializeOwned`) und
  sind im Crate sichtbar (`pub(crate)`).
- Der Abgleich von Ziel, Methode, Pfad, Body und Zeit wandert in eine gemeinsame Funktion
  `check_bindung(…)`. Die Claims der Instanz behalten `pv`.
- Maschinen bekommen eigene Claim-Structs ohne `pv`:
  - `MachineAnfrage`: `iss aud iat exp jti htm htu bh`;
  - `MachineAntwort`: `iss aud iat exp jti req status bh`, wobei `req` die `jti` der Anfrage ist.
- `code.rs` bekommt `derive_mit_salz(code, salz)` mit `SALZ_MACHINE` =
  `lifeline-machine-client/1`. `derive(code)` bleibt mit dem heutigen Salz.
- Die Transkripte für Maschinen sind eigene Funktionen, damit kein Prüfwert zwischen den Profilen
  gilt:
  - Einlöser: `suche`, Schlüssel des Fremdsystems;
  - Aussteller: `suche`, Instanz-UUID, Instanzschlüssel, Zugangs-ID.

Die bestehenden Tests der Instanzkopplung (`tests/instanz_kopplung.rs`, Unit-Tests in
`signatur.rs` und `code.rs`) laufen unverändert grün. Ein neuer Test hält fest, dass ein JWS des
einen Profils am anderen scheitert.

**Alternativen verworfen:**

- *Im neuen Modul kopieren.* Zwei Implementierungen, die auseinanderlaufen; am Checkpoint
  verworfen.
- *Generischen Teil nach `src/signatur/` verschieben.* Das wäre sauberer, macht aber einen
  größeren Diff und viele Verweise. Es bleibt eine Möglichkeit für später.

### D2 Datenmodell: vier Tabellen und der neue CHECK

Die Nummern kommen erst beim Anlegen und liegen über allen auf `origin/alpha`
(`scripts/check-migrationen.sh`).

- **`maschinenzugang`**, eine Zeile je Zugang:
  - Stammdaten: `id` (UUID, zugleich `kid` und `iss`), `org_id`, `name`, `scopes` (JSON-Liste
    der Wire-Werte, sortiert und ohne Dopplung), `gueltig_bis` (nullable);
  - Zustand: `zustand` (CHECK `wartet`, `aktiv`, `widerrufen`);
  - Schlüssel: `schluessel` (b64, nullable) und `schluessel_neu` (b64, nullable, für den
    Wechsel, D7);
  - Spur: `angelegt_at`, `angelegt_von`, `widerrufen_at`, `widerrufen_von`;
  - Nutzung: `zuletzt_genutzt_at`, `letzte_ablehnung_at`, `letzte_ablehnung_grund`,
    `letzte_ablehnung_abweichung_s`.

  „Abgelaufen“ ist kein Zustand. Er ergibt sich aus `gueltig_bis` und wird beim Lesen berechnet.
- **`maschinenzugang_code`**: `suche` (PK), `zugang_id`, `k_einloeser` und `k_aussteller` (b64),
  `laeuft_ab_at`, `eingeloest_at`, `ausgestellt_von`. Ein neuer Code löscht offene Codes
  desselben Zugangs in derselben Transaktion.
- **`maschine_jti`**: `zugang_id`, `jti`, `bis`, PK aus `zugang_id` und `jti`.
- **`maschine_abruf`**: `zugang_id`, `route` (die Routen-Vorlage aus `MatchedPath`, nie der
  konkrete Pfad), `tag` (UTC-Datum), `anzahl`, `erster_at`, `letzter_at`, PK aus `zugang_id`,
  `route` und `tag`.
- **`admin_audit`** wird mit den Aktionen `maschinenzugang_angelegt`,
  `maschinenzugang_code_ausgestellt`, `maschinenzugang_schluessel_gebunden`,
  `maschinenzugang_geaendert` und `maschinenzugang_widerrufen` neu gebaut, nach dem Muster 0317.
  Gegenüber der Aufgabe kommt `_code_ausgestellt` hinzu, sonst bliebe ein Schlüsselwechsel ohne
  handelnde Person in der Spur. Dazu kommt `Ziel::Maschinenzugang`.

Keine dieser Tabellen hängt an einem Einsatz. Deshalb sind keine Einträge in `spiegel::art` und
`schwaerzung_registry` nötig. Prüft ein Wächter, dass jede Tabelle eingeordnet ist, gehören sie
dort zu den ausgenommenen.

**Aufräumen** in Phase C von `purge_scheduler`:

- `maschine_jti` nach `bis`;
- Codes einen Tag nach `laeuft_ab_at`;
- `maschine_abruf` nach 365 Tagen.

Zugänge selbst bleiben, auch widerrufene.

### D3 Extractor `MachineClient` und die Prüfreihenfolge

`impl FromRequest<AppState> for MachineClient` in `src/public_api/machine.rs` prüft in dieser
Reihenfolge:

1. **Quelle gesperrt?** Maschinenzähler je IP (D5), sonst 429 `rate_limited`.
2. **Kopf und Token:** Kopf `Authorization: Machine <jws>`, `parse_kopf` mit dem Profil
   `MACHINE`. Fehlt der Kopf oder ist er unlesbar: 401.
3. **Zugang laden** über `kid`. Ist er unbekannt: Fehlversuch im Maschinenzähler, dann 401.
4. **Body lesen**, höchstens bis zur v1-Grenze.
5. **Signatur und Bindung** prüfen (`aud` = eigene Instanz-UUID). Ist ein `schluessel_neu`
   gesetzt, wird gegen ihn geprüft, sonst gegen `schluessel`; gilt der neue nicht, wird der alte
   versucht (D7). Scheitert die Prüfung: Ablehnungsgrund am Zugang (D6), dann 401.
6. **Zustand:** `aktiv`, nicht abgelaufen, Org nicht meldend gekoppelt (D10). Sonst
   Ablehnungsgrund, dann 401.
7. **Bucket des Zugangs** (D4), sonst 429 mit `Retry-After`. Das kommt vor dem `jti`, damit eine
   gedrosselte Anfrage nach Wartezeit mit demselben Token wiederholt werden kann.
8. **`jti` merken** (`INSERT OR IGNORE`). Ist sie schon gespeichert: Ablehnungsgrund
   „Wiederholung“, dann 401.
9. **Scope** (D8), sonst 403 `missing_scope`.
10. **Abruf zählen**, `zuletzt_genutzt_at` höchstens einmal je Minute fortschreiben.

Jede Ablehnung nach außen ist ein `ApiError` mit `code`. 401 trägt nur „Anmeldung
fehlgeschlagen“. Ins Log kommen Zugangs-ID und Grund, nie das Token.

`MachineClient` trägt Zugang (Kennung, Org, Scopes), Claims, Body und Instanzidentität. Er bietet
`antwort(status, &T) -> Response`: Die Antwort ist JSON und trägt im Kopf `Lifeline-Signature` ein
JWS mit `typ` `lifeline-machine-response+jwt`, an den Zugang gerichtet (`aud`) und mit `req` an
die Anfrage gebunden. Fehlerantworten bleiben unsigniert. Signiert wird nur, was das Fremdsystem
als Ergebnis verwertet.

**Warum dieser Kopf:** Das Konzept nennt `Lifeline-Signature` für Webhooks. Ein Kopfname für
beide Richtungen ist einfacher; `typ` unterscheidet Antwort und Ereignis.

### D4 Drosselung je Zugang: eigener Token-Bucket

In `src/public_api/drossel.rs` liegt ein `TokenBucket { kapazitaet, je_sekunde, stand,
zuletzt }`. `try_take(jetzt: Instant) -> Result<(), Duration>` liefert bei leerem Bucket die
Wartezeit. Daraus wird `Retry-After`, aufgerundet auf ganze Sekunden, mindestens 1.

- Kapazität 60, Nachfüllen 1 je Sekunde.
- Die Buckets aller Zugänge liegen in einer `Mutex<HashMap<Zugangs-ID, TokenBucket>>` im
  Prozessspeicher (R10). Einträge, die länger als 10 Minuten ungenutzt und voll sind, werden beim
  Zugriff aufgeräumt.
- Die Zeit kommt als Parameter herein, damit Tests ohne Warten auskommen.

### D5 Maschinenzähler je IP: eine zweite Tabelle derselben Art

`rate_limit.rs` bekommt das Untermodul `maschine` mit einer eigenen prozessweiten Tabelle. Es
nutzt dieselbe `Tabelle` wie die Anmeldesperre: 10 Fehlversuche in 300 s je Quelle (IPv6 /64),
Obergrenze, Aufräumen und Meldedrossel, aber ohne Konto. Die Funktionen der Anmeldesperre bleiben
unverändert. Parameter braucht es nicht, solange beide Tabellen dieselben Werte haben.

Gezählt werden nur zwei Fälle: ein unbekannter `kid` und ein gescheitertes Einlösen (unbekannte
`suche` oder falscher Prüfwert). Die Quelle kommt aus `PeerIp`, also mit `--trusted-proxies` wie
überall.

**Alternative verworfen:** eine eigene Kopie der Tabelle. Dieselbe Logik zweimal hieße zwei Orte
für Grenzfälle wie Obergrenze, Aufräumen und IPv6-Präfix.

### D6 Ablehnungsgrund am Zugang

`AblehnungGrund` ist ein `wire_enum!`. Die Werte gehen in die Datenbank und an die Admin-Seite:

- Abgleich der Anfrage: `uhr`, `signatur`, `body`, `pfad`, `methode`, `ziel` (`aud` falsch),
  `form`, `wiederholung`;
- Zustand des Zugangs: `abgelaufen`, `widerrufen`, `kein_schluessel`, `instanz_gekoppelt`.

Bei `uhr` steht die Abweichung `iat - jetzt` in Sekunden daneben. Die Seite rechnet sie in
Minuten um und zeigt die Richtung („geht 7 min nach“ oder „vor“).

Geschrieben wird nur, wenn sich der Grund ändert oder der letzte Eintrag älter als 60 s ist. So
erzeugt eine Flut falscher Anfragen eines bekannten Zugangs keine Schreiblast.
`AblehnungGrund::aus_signatur` bildet `SignaturError` ab. Die Richtung der Uhr ergibt sich aus
dem Vorzeichen der Abweichung, die `verify_machine_anfrage` mitliefert, sobald die Signatur gilt.
`SignaturError` selbst bleibt unverändert.

### D7 Schlüsselwechsel

- Ein neuer Code für einen Zugang mit Schlüssel lässt den Zustand auf `aktiv`.
- Das Einlösen schreibt `schluessel_neu`. Bei einem Zugang ohne Schlüssel schreibt es direkt
  `schluessel`, und der Zustand wechselt von `wartet` auf `aktiv`.
- Die erste gültige Anfrage mit `schluessel_neu` setzt in einer Transaktion `schluessel =
  schluessel_neu` und `schluessel_neu = NULL`. Ab dann scheitert der alte Schlüssel mit
  `signatur`.
- Die Admin-Spur `schluessel_gebunden` nennt beide Fingerabdrücke.

### D8 Scope-Anforderung je Route, fail closed

Jede v1-Route mit `MachineClient` bekommt per `route_layer` eine `ScopeAnforderung` in die
Request-Extensions: `Keine` (nur `me`) oder `Scope(…)`. Der Extractor liest sie in Schritt 9. Fehlt
die Extension, antwortet er mit 500 und einer Log-Zeile „Route ohne Scope-Angabe“, nie mit 200.

Dazu kommt ein Test: Er geht alle Pfade im v1-Dokument durch, die das Sicherheitsschema `machine`
tragen, und prüft, dass ihr Aufruf ohne Scope nicht mit 500 endet.

Der Scope steht zusätzlich im `#[utoipa::path(security(("machine" = ["lage:read"])))]` der Route,
damit das Dokument ihn nennt.

**Warum nicht nur `client.require(scope)` im Handler:** Ein vergessener Aufruf wäre eine offene
Route, und kein Test fiele um. Ein generischer `MachineClient<S>` passte nicht zur Prüfung von
ADR-0022, die das Muster `impl FromRequest<AppState> for MachineClient` verlangt.

### D9 Referenz-Clients signieren selbst

**Rust:** Die Crate `crates/lifeline-machine-client` hängt nicht vom Server ab. Sie hat:

- `Schluesseldatei` (JSON: `zugang_id`, `instanz_id`, `base_url`, `private_key`,
  `instanz_public_key`, Fingerabdrücke);
- `sign_request(method, path_and_query, body, now) -> String`;
- `verify_response(…)`;
- `redeem(base_url, code)` hinter dem Feature `http` mit `reqwest`.

Das Binary nutzt sie für die Kommandos:

- `lifeline-hub zugang redeem <url> <code> [--out <datei>]`: Die Datei ist auf Unix `0600`, die
  Vorgabe ist `./lifeline-zugang.json`. Eine vorhandene Datei wird nie überschrieben.
- `lifeline-hub zugang me <datei>`: Aufruf der Prüfroute, nur für Betreiber.

**Warum unabhängig:** Teilten Client und Server die Signatur, prüften die Testvektoren den Code
gegen sich selbst. Getrennt beweisen sie, dass ein zweiter Implementierer nach der Doku auf
dasselbe JWS kommt.

**Testvektoren** stehen in `docs/api/machine-auth-testvektoren.json`:

- Seed des Schlüssels, Instanz-UUID, Zugangs-ID, `iat`, `jti`, Methode, Pfad, Body;
- erwartete Werte: JWS, Code mit `suche` und Prüfwert, Antwort-JWS.

Kopf und Claims haben eine feste Reihenfolge der Schlüssel. Nur so ist das JWS bytegleich. Der
Server verlangt keine Reihenfolge; die Doku sagt das.

Geprüft wird an vier Stellen:

1. Unit-Test der Crate: erzeugt alles neu und vergleicht.
2. Server-Test: prüft das Vektor-JWS mit `verify` bei fester Zeit.
3. Vitest im Frontend: importiert `docs/api/clients/typescript/machineClient.ts`. Es nutzt nur
   WebCrypto und läuft in Node 26 und modernen Browsern.
4. Python-Selbsttest: `docs/api/clients/python/machine_client.py --selftest`, auf
   `cryptography`.

Der Python-Selbsttest ist ein Schritt im Bündel `schnell` von `check-all.sh`. Fehlt `cryptography`,
wird er **laut übersprungen**, wie heute die e2e-Suite ohne Binary. Er wird nicht rot, damit kein
Gate rot geboren wird.

### D10 Ein gekoppelter ELW nimmt keine Fremdsysteme an

Maßgeblich ist `instanz::repo::list_meldend_aktiv`, gefiltert auf die Org: eine aktive Zuordnung,
bei der diese Instanz die meldende Seite ist.

- Anlegen und Code ausstellen antworten dann mit 409 und dem Text „Diese Instanz meldet sich für
  die Org bei <Adresse>; Anbindungen gehören dorthin.“
- Der Extractor lehnt mit `instanz_gekoppelt` ab.
- Die Seite holt den Zustand über das Listen-DTO (`gesperrt_grund`) und zeigt ihn mit
  `RechteHinweis`.

### D11 Admin-Routen und Seite „Anbindungen“

**Routen** (Body über `JsonBody`, IDs über `PfadParam`, Grenzen als `*_MAX` und gespiegelt in
`frontend/src/api/eingabegrenzen.ts`):

| Methode und Pfad | Wirkung | Antwort |
| --- | --- | --- |
| `GET /api/admin/anbindungen` | Liste der Zugänge | Liste |
| `POST /api/admin/anbindungen` | Zugang anlegen | Zugang und Code |
| `PATCH /api/admin/anbindungen/{id}` | Name, Scopes, „gültig bis“ ändern | Zugang |
| `POST /api/admin/anbindungen/{id}/code` | neuer Code | Code |
| `POST /api/admin/anbindungen/{id}/widerrufen` | Widerruf | Zugang |

Lesen erlaubt `darf_admin_bereich()`, schreiben nur `AdminUser`, beides mit Org-Prüfung. Ein
widerrufener Zugang ist nicht mehr änderbar (409).

**Seite** `frontend/src/pages/einstellungen/Anbindungen.tsx`, Sektion `anbindungen` in der Gruppe
`einstellungen`. Vorlagen sind das Listengerüst von `LagemonitorZugaenge.tsx` sowie Code-Dialog
und Fingerabdruck aus `InstanzkopplungSeite.tsx`.

- **Anlegen** im `ErfassungsModal` mit drei Feldern: Name, Scopes als Kästchen mit Klartext,
  „gültig bis“.
- **Code-Dialog:** Code in Vierergruppen, Ablaufzeit, Hinweis auf das Kommando.
- **Ändern** in der Ansicht des Zugangs (LLH-1139).
- **Je Zugang sichtbar:** Zustand, Fingerabdruck in Mono, Scopes, „gültig bis“, zuletzt genutzt
  und letzte Ablehnung mit Klartext und Zeit.
- **Query-Key** `globalKeys.anbindungen` in `NICHT_LIVE_GLOBAL_KEYS`. Kein Live-Strom, weil sich
  Ablehnungen sonst je Anfrage verbreiteten. Die Seite lädt beim Öffnen und nach jeder eigenen
  Aktion neu.

Die Seite ist neu und fällt damit unter „Größere UI-Entwürfe über das Design System“
(`frontend/AGENTS.md`). Vor dem Bau entsteht der Entwurf unter
`docs/design/2026-11-<tt>-anbindungen/`.

**Scope-Bezeichnungen** in der Oberfläche:

| Scope | Klartext |
| --- | --- |
| `lage:read` | Lage lesen |
| `einsaetze:read` | Einsätze lesen |
| `events:read` | Ereignisse abrufen |
| `alarmmeldungen:write` | Alarmmeldungen einliefern |
| `positionen:write` | Positionen einliefern |
| `rechner:use` | Rechner nutzen |

Darunter steht der Wire-Wert in Mono, damit der Admin ihn mit der Doku des Fremdsystems
vergleichen kann.

### D12 Wire-Namen der neuen v1-Routen

Nach D9 des Konzepts und den Kommentaren vom 11.11.2026:

- **`POST /api/v1/zugang/redeem`:**
  - Anfrage: `{lookup, public_key: JWK, proof}`;
  - Antwort: `{zugang_id, instanz_id, instanz_public_key: JWK, proof}`.
  - Die Body-Grenze ist `AUTH_CODE_BODY_MAX` (4 KiB) am Route-Layer, weil sie öffentlich ist.
- **`GET /api/v1/me`:** `{zugang_id, name, org: {id, name}, scopes, valid_until_at,
  server_time_at, clock_offset_s}`.
- **`GET /api/v1/instanz/jwks.json`:** `{keys: [{kty: "OKP", crv: "Ed25519", x, kid: <Instanz-UUID>,
  use: "sig", alg: "EdDSA"}]}`.
- **Im Dokument:** Sicherheitsschema `machine` (`type: http`, `scheme: Machine`) mit einer
  Beschreibung des JWS und Verweis auf die Testvektoren. Dazu `servers` mit relativer URL `/`.

## Risks / Trade-offs

- [Der Umbau von `signatur.rs` und `code.rs` bricht die Instanzkopplung still.] → Ihre Tests
  bleiben unverändert und müssen grün sein. Ein Test prüft, dass ein JWS des einen Profils am
  anderen scheitert.
  `check_bindung` wird nur verschoben, nicht neu geschrieben.
- [LLH-1653 ändert sein Gerüst nach dieser Planung.] → `/opsx:apply` beginnt erst auf dessen
  gemergtem Stand. Abweichungen gehen per `/opsx:update` in diese Change.
- [Eine Flut gültig signierter Anfragen eines Zugangs erzeugt Schreiblast durch `jti` und
  Abrufprotokoll.] → Der Bucket greift vor dem `jti`, also höchstens 60 Schreibvorgänge je
  Minute und Zugang. `zuletzt_genutzt_at` wird höchstens einmal je Minute geschrieben.
- [Drosselung im Prozessspeicher geht beim Neustart verloren (R10).] → Bewusst, wie bei der
  Anmeldesperre. Ein Neustart gibt höchstens einen vollen Bucket zurück.
- [Uhrabweichung bei TLS-Terminierung im Proxy.] → Kein Einfluss, die Zeit kommt aus dem
  Serverprozess.
- [Der Python-Selbsttest läuft in der CI womöglich nie (ohne `cryptography`).] → Der Schritt ist
  laut übersprungen und steht in der Gate-Ausgabe. Die TypeScript- und Rust-Vektoren laufen
  immer.

## Migration Plan

- **Rein additiv:** neue Tabellen, neue Routen, neue Aktionen im CHECK. Die Migration des CHECK
  folgt dem erprobten Muster (`-- no-transaction`, Kopie, Rename, Indizes).
- **Rücknahme:** Der Revert des Merge-Commits nimmt Routen und Seite heraus. Die Tabellen bleiben
  leer stehen, weil Migrationen nie entfernt werden (`AGENTS.md`, Migrationsvergabe).
- **ADR-0022** wird im selben PR `akzeptiert`. Ihre Prüfung läuft danach in Schritt 16 von
  `check-all.sh` und muss grün sein.
- **R33** in Kapitel 11 bleibt stehen, weil der Lagemonitor-Bearer bis LLH-1638 bleibt. Sein
  Text wird fortgeschrieben: Die Instanzrouten bleiben ungedrosselt, die Maschinenwege sind es.
  Dazu kommt ein Verweis auf LLH-1638.

## Open Questions

- Klartext der Seite für den Ablehnungsgrund `ziel` („Anfrage für eine andere Instanz“) und
  `form` („Anfrage unlesbar“). Wird mit dem Design-Entwurf festgelegt; Spec und Schnitt ändern
  sich dadurch nicht.
