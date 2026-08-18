# Ops-Runbook: `karten-service` (LFH-204)

Betrieb des zentralen, dauerhaft laufenden Region-Build-Service (**Komponente A** aus
`docs/superpowers/specs/2026-07-05-karten-region-build-service-design.md`). Er baut die
kuratierten Offline-Karten-Regionen (Shortbread-MBTiles), publiziert sie in ein
S3-kompatibles Object-Storage und hält dort ein Manifest aktuell, das lifeline-hub
(Client, LFH-199/LFH-203) konsumiert. Kein Laufzeit-Docker in lifeline-hub selbst — dieser
Service ist die einzige Stelle, die `docker`/`make` ausführt.

Dieses Dokument ist reine Betriebsanleitung — keine Infrastruktur wird hier provisioniert,
aber jeder Schritt ist so konkret gehalten, dass ein Operator ihn 1:1 ausführen kann.
Platzhalter sind **GROSS_MIT_UNTERSTRICHEN** markiert.

## Inhaltsverzeichnis

1. [Object-Storage (S3/R2)](#1-object-storage-s3r2)
2. [Build-Host](#2-build-host)
3. [`karten-service` konfigurieren](#3-karten-service-konfigurieren)
4. [DNS/TLS + Service-Token](#4-dnstls--service-token)
5. [lifeline-hub verdrahten](#5-lifeline-hub-verdrahten)
6. [Erstbau + Scheduler](#6-erstbau--scheduler)
7. [Verifikation](#7-verifikation)
8. [Security-/Ops-Hinweise](#8-security-ops-hinweise)
9. [Bekannte Lücken / TODOs](#9-bekannte-lücken--todos)

---

## 1. Object-Storage (S3/R2)

Der Service lädt sowohl die gebauten `.mbtiles`-Dateien als auch das Manifest
(`offline-katalog-manifest.json`) über das `object_store`-Crate
(`karten-service/src/storage/s3.rs`, `AmazonS3Builder::from_env()`) — S3-kompatibel, also
AWS S3 **oder** Cloudflare R2.

### 1.1 Bucket anlegen

- Bucket-Name: **BUCKET_NAME** (z.B. `lifeline-karten`).
- **Public-Read**, da Manifest + `.mbtiles` unkritische ODbL-Daten sind (kein Signing nötig
  — Integrität kommt über den per-Eintrag-`sha256`-Pin im Manifest, LFH-183/199).
- Object Ownership **„Bucket owner enforced"** (keine ACLs) — Zugriff ausschließlich über
  Bucket-Policy, nicht per Objekt-ACL (der Service setzt beim Hochladen keine ACL).

**AWS S3 — Bucket-Policy (Public-Read, Beispiel):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::BUCKET_NAME/*"
    }
  ]
}
```

„Block Public Access" auf Account-/Bucket-Ebene muss **Bucket-Policies** erlauben (sonst
greift obige Policy nicht), ACL-basierten Public-Zugriff kann/soll trotzdem geblockt bleiben.

**Cloudflare R2 (Alternative):** Bucket anlegen, dann *Settings → Public Access* aktivieren
— entweder der `r2.dev`-Dev-Subdomain (laut Cloudflare-Doku nicht für Produktivbetrieb
gedacht, ratenbegrenzt) oder einer eigenen Custom-Domain via Cloudflare-DNS (empfohlen,
liefert automatisch HTTPS + Range über Cloudflares Edge). R2 kennt keine granulare
AWS-Bucket-Policy-Syntax — der Public-Access-Toggle ersetzt sie.

### 1.2 HTTPS + HTTP-Range

- **AWS S3:** liefert nativ HTTPS + `Accept-Ranges: bytes` auf den Standard-Endpunkt
  (`https://BUCKET_NAME.s3.REGION.amazonaws.com/…`) oder über eine CloudFront-Distribution
  davor (falls eine eigene Domain gewünscht ist — CloudFront muss dazu `Range`-Header
  durchreichen, Default-Verhalten ist ok).
- **R2:** HTTPS + Range kommen automatisch über Cloudflares Edge (r2.dev-Domain oder Custom
  Domain), keine Zusatzkonfiguration nötig.
- Range ist Pflicht: der bestehende Download-Pfad in lifeline-hub (LFH-181) lädt die
  Multi-GB-`.mbtiles` per Range-Requests (Resume/Chunking) — ohne Range bricht der Download.

### 1.3 Credentials für den Service

`AmazonS3Builder::from_env()` (Crate `object_store` 0.11) liest **alle** `AWS_*`-Env-Vars
des Prozesses (jede `AWS_`-Variable wird lowercased als Config-Key geparst — siehe
`karten-service/src/storage/s3.rs`). Für den Build-Host relevant:

| Env-Var | Zweck |
|---|---|
| `AWS_ACCESS_KEY_ID` | Access-Key |
| `AWS_SECRET_ACCESS_KEY` | Secret-Key |
| `AWS_REGION` bzw. `AWS_DEFAULT_REGION` | Region (bei R2: `auto`) |
| `AWS_ENDPOINT` | **nur für R2/Nicht-AWS-S3 nötig**, z.B. `https://ACCOUNT_ID.r2.cloudflarestorage.com` |
| `AWS_SESSION_TOKEN` | optional, falls STS/temporäre Credentials |
| `AWS_ALLOW_HTTP` | nur für lokales Testen gegen einen Nicht-TLS-Mock; in Produktion nicht setzen |

Der Bucket-Name selbst ist **kein** `AWS_*`-Var, sondern kommt über den Service-eigenen
Parameter `KS_STORAGE_BUCKET` (Abschnitt 3). Credentials gehören in eine Prozess-Umgebung
(systemd `EnvironmentFile=`, Secret-Store o.ä.) — **niemals ins Repo**.

Erzeuge für AWS einen IAM-User/eine Rolle mit minimalen Rechten (`s3:PutObject`,
`s3:GetObject`, `s3:ListBucket` — reicht für Publish + `seed_bestand`-Read beim Start) auf
`arn:aws:s3:::BUCKET_NAME` und `arn:aws:s3:::BUCKET_NAME/*`. Für R2: API-Token mit
„Object Read & Write" auf den Bucket über *R2 → Manage API Tokens*.

---

## 2. Build-Host

### 2.1 Voraussetzungen

- **Docker** (der `MakeRunner` in `karten-service/src/build/make_runner.rs` shellt zu
  `make -C <KS_KARTEN_BUILD_DIR> tiles AREA=<geofabrik_area>`, was wiederum
  `docker run … versatiles/versatiles-planetiler` aufruft — Docker-Daemon muss laufen und
  für den Service-Prozess erreichbar sein).
- **GNU Make** und die **`sqlite3`-CLI** (der Runner liest nach dem Bau die `bounds` aus
  der `metadata`-Tabelle per `sqlite3 <datei> "select value from metadata where
  name='bounds';"` — ohne das Binary im `PATH` bricht jeder Build am Bounds-Check).
- **Internet-Egress** zu Docker Hub (Image-Pull, einmalig/bei Updates) und zu Geofabrik
  (Region-Extrakt je Build) sowie zum konfigurierten Object-Storage-Endpunkt (Upload).
- Repo bzw. mindestens `karten-build/` (Makefile + README) am erwarteten Pfad — Default ist
  der **relative** Pfad `karten-build` (`KS_KARTEN_BUILD_DIR`, Default-Value in
  `karten-service/src/config.rs`), der Service-Prozess muss also mit `cwd` = Repo-Wurzel
  gestartet werden, **oder** `KS_KARTEN_BUILD_DIR` auf einen absoluten Pfad setzen.

Image vorab ziehen (einmalig, spart Zeit beim ersten Build):
```bash
docker pull versatiles/versatiles-planetiler:latest
```

### 2.2 Plattenplatz

Laut `karten-build/README.md`: das Wasser-Polygon-ZIP (`out/sources/`, bleibt über Builds
gecacht) ist **~880 MB**; das Design-Dokument veranschlagt zusätzlich **~1 GB** für Region-
Extrakt + `tmp/` **pro laufendem Build** (Disk-Guard-Sollwert — s. Abschnitt 9, dieser Guard
ist im Code **nicht implementiert**). Über die Zeit sammeln sich außerdem die fertigen
`.mbtiles`-Ergebnisse pro Region in `out/result/` an, bis sie hochgeladen sind. Ein
Deutschland-weiter Shortbread-Bau liegt üblicherweise im niedrigen bis mittleren
GB-Bereich; kleinere Bundesländer entsprechend weniger.

**Empfehlung:** dedizierte Platte/Volume mit **mindestens 20–30 GB** frei einplanen (Puffer
für Wasser-Polygone + größtes Regions-Ergebnis + `tmp` gleichzeitig, plus Marge, da es
aktuell keinen automatisierten Disk-Guard gibt). `out/` ist gitignored und kann bei Bedarf
manuell geleert werden (`out/sources/` außer den `.osm.pbf`/`renumbered.osm.pbf` bleibt
sinnvoll gecacht, siehe README/Makefile-Kommentar zu LFH-200).

### 2.3 Binary bauen

```bash
cargo build --release -p karten-service
# Binary: target/release/karten-service
```

Es existiert **kein** Dockerfile/Compose-File/systemd-Unit für `karten-service` im Repo
(nur `karten-build/`s eigenes Docker-Image für den Tile-Bau selbst; das `compose.yml` im
Repo-Root ist reine lokale Dev-Infrastruktur — MinIO als S3-Ersatz, siehe `mise run minio` —
und kein Deployment-Artefakt) — Paketierung/Deployment
des Service-Binaries ist Operator-Sache (s. Abschnitt 9). Beispiel-systemd-Unit unten unter
Abschnitt 3.3 ist ein Vorschlag, kein Repo-Artefakt.

---

## 3. `karten-service` konfigurieren

Alle Parameter sind `clap`-Flags **mit** Env-Var-Bindung (`karten-service/src/config.rs`) —
Flag und Env-Var sind austauschbar.

| CLI-Flag | Env-Var | Default | Zweck |
|---|---|---|---|
| `--bind` | `KS_BIND` | `0.0.0.0:8088` | HTTP-Bind-Adresse (kein TLS, s. Abschnitt 4) |
| `--token` | `KS_TOKEN` | `""` (leer) | Bearer-Token für `/builds`, `/regions`. **Leer = jeder authentifizierte Request scheitert mit 401** (`auth()` in `api.rs` verlangt ein nicht-leeres Token) |
| `--base-url` | `KS_BASE_URL` | `""` | Öffentliche Basis-URL des Object-Storage **ohne** End-Slash — wird sowohl für `.mbtiles`- als auch für die Manifest-URL verwendet (`public_url()` in `storage/s3.rs`) |
| `--karten-build-dir` | `KS_KARTEN_BUILD_DIR` | `karten-build` (relativ!) | Pfad zum `karten-build/`-Checkout |
| `--schedule` | `KS_SCHEDULE` | `"0 0 3 1 1,4,7,10 *"` | 6-Feld-Cron (inkl. Sekunden): quartalsweise, 03:00 am 1. Jan/Apr/Jul/Okt, **in der Zeitzone des Server-Prozesses** (`TZ`-Env beachten) |
| `--storage-bucket` | `KS_STORAGE_BUCKET` | `""` | Bucket-Name (S3/R2) |
| Subkommando | — | — | `serve` (Dauerbetrieb: API+Worker+Scheduler) oder `build --slug <x>` / `build --all` (einmaliger Lauf ohne HTTP) |

**Wichtig zur Storage-URL-Verdrahtung:** Der Service legt sowohl die `.mbtiles`-Dateien als
auch `offline-katalog-manifest.json` **auf Bucket-Root-Ebene** ab (Keys wie
`bayern.20260705.shortbread.mbtiles` bzw. `offline-katalog-manifest.json`, **ohne**
`maps/`-Präfix im Code — das Design-Dokument nennt exemplarisch `maps/<slug>…`, das ist
Doc/Code-Drift, kein implementiertes Verhalten). `KS_BASE_URL` muss also direkt auf die
Bucket-Root zeigen (bzw. auf einen Reverse-Proxy/eine CDN-Domain, die 1:1 auf Bucket-Root
mappt). Der Hinweis-Text im `--base-url`-Hilfetext (`z.B. https://cdn.example/maps`) ist
irreführend, wenn dein CDN diesen `/maps`-Pfad nicht selbst auf Bucket-Root umschreibt —
teste die tatsächliche URL-Struktur (Abschnitt 7), bevor du sie in lifeline-hub pinnst.

### 3.1 Service-Token erzeugen

Kein eingebauter Generator — ein zufälliger Hex-String reicht (Bearer-Vergleich ist ein
einfacher String-Vergleich, kein Hashing):

```bash
openssl rand -hex 32
```

Dieses Token wird **identisch** in `KS_TOKEN` (Service) **und** in
`LIFELINE_KARTEN_SERVICE_TOKEN` (lifeline-hub, Abschnitt 5) hinterlegt.

### 3.2 Start

```bash
# einmalig, Erstbau (Abschnitt 6) — läuft ohne HTTP-Server, terminiert nach Abschluss:
KS_STORAGE_BUCKET=BUCKET_NAME \
KS_BASE_URL=https://BUCKET_PUBLIC_DOMAIN \
KS_KARTEN_BUILD_DIR=/abs/pfad/zu/karten-build \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=... \
./target/release/karten-service build --all

# Dauerbetrieb (API + In-Service-Worker + Cron-Scheduler):
KS_BIND=0.0.0.0:8088 \
KS_TOKEN=<erzeugtes Token> \
KS_STORAGE_BUCKET=BUCKET_NAME \
KS_BASE_URL=https://BUCKET_PUBLIC_DOMAIN \
KS_KARTEN_BUILD_DIR=/abs/pfad/zu/karten-build \
KS_SCHEDULE="0 0 3 1 1,4,7,10 *" \
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_REGION=... \
./target/release/karten-service serve
```

Beide Subkommandos brauchen die Storage-Credentials — auch `serve` liest beim Start das
bestehende Manifest (`seed_bestand`), damit ein einzelner On-Demand-Rebuild nicht die
übrigen bereits publizierten Regionen aus dem Manifest wirft. Ein Storage-Lesefehler beim
Start bricht den Prozessstart hart ab (`?`-Propagation in `main.rs`) — bewusst, um kein
korruptes/unlesbares Manifest fälschlich als „leer" zu interpretieren.

**Beispiel-systemd-Unit (Vorschlag, kein Repo-Artefakt):**

```ini
[Unit]
Description=karten-service (Region-Build-Service)
After=network-online.target docker.service
Requires=docker.service

[Service]
WorkingDirectory=/opt/lifeline/karten-service-repo
EnvironmentFile=/etc/lifeline/karten-service.env
ExecStart=/opt/lifeline/karten-service-repo/target/release/karten-service serve
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/lifeline/karten-service.env` enthält `KS_*` + `AWS_*` (Dateirechte `600`, nur der
Service-User lesbar).

---

## 4. DNS/TLS + Service-Token

`karten-service` terminiert **kein eigenes TLS** — `main.rs` bindet einen rohen
`tokio::net::TcpListener` und serviert Klartext-HTTP über `axum::serve`. Für eine feste
HTTPS-Service-URL ist ein **Reverse-Proxy** (nginx/Caddy/Traefik) oder ein Cloud-Loadbalancer
davor nötig:

1. DNS: **SERVICE_DOMAIN** (z.B. `karten-service.example.org`) → Build-Host (A/AAAA-Record
   oder LB).
2. Reverse-Proxy terminiert TLS (Let's Encrypt o.ä.) und proxied nach `127.0.0.1:8088`
   (bzw. dem Wert aus `KS_BIND`).
3. Service-Token aus Abschnitt 3.1 bereithalten — er wird jetzt in Abschnitt 5 in
   lifeline-hub hinterlegt.

Die resultierende URL (`https://SERVICE_DOMAIN`) ist der Wert für
`LIFELINE_KARTEN_SERVICE_URL` unten.

---

## 5. lifeline-hub verdrahten

Zwei getrennte Anker, beide server-side in lifeline-hub, keiner davon im Browser sichtbar:

### 5.1 Trigger/Status-Anker (Laufzeit-Config)

`src/config.rs` (lifeline-hub-Hauptbinary):

| CLI-Flag | Env-Var | Typ |
|---|---|---|
| `--karten-service-url` | `LIFELINE_KARTEN_SERVICE_URL` | `Option<String>` |
| `--karten-service-token` | `LIFELINE_KARTEN_SERVICE_TOKEN` | `Option<GeheimesPasswort>` (Debug-maskiert, wie `admin_password`) |

```bash
LIFELINE_KARTEN_SERVICE_URL=https://SERVICE_DOMAIN \
LIFELINE_KARTEN_SERVICE_TOKEN=<gleiches Token wie KS_TOKEN> \
./lifeline-hub  # oder die entsprechenden --karten-service-url/--karten-service-token-Flags
```

Fehlt eine der beiden (URL **oder** Token), meldet `GET /api/karte/config` künftig
`karten_bau_verfuegbar: false` (`src/routes/karte.rs::karte_config`) — die „Region neu
bauen"-Aktion bleibt im Admin-UI **unsichtbar**, der normale Katalog-Download läuft davon
unberührt weiter. Sind beide gesetzt, proxyt lifeline-hub server-side:

- `POST /api/karte/offline-karten/bauen` → `POST {url}/builds` (Bearer-Token, das Token
  verlässt den Server nie zum Browser)
- `GET /api/karte/offline-karten/baubare-regionen` → `GET {url}/regions`
- `GET /api/karte/offline-karten/bau-status` → `GET {url}/builds`

Diese drei Endpunkte sind bereits fertig verdrahtet (LFH-203) — dieser Runbook-Schritt ist
reines Ops (Werte setzen + Service erreichbar machen), kein Code.

### 5.2 Manifest-Anker — **kompiliert, kein Env-Var**

`src/karte/katalog.rs`:

```rust
pub const OFFLINE_KATALOG_MANIFEST_URL: &str =
    "https://TODO-karten-build-release/offline-katalog-manifest.json";
```

Das ist bewusst ein **Rust-`const`**, kein Laufzeit-Flag (Trust-Modell aus LFH-199: die
Manifest-URL ist admin-nicht-editierbar, kompiliert-gepinnt). Sobald der Bucket steht:

1. Konstante ersetzen mit `{KS_BASE_URL}/offline-katalog-manifest.json` (exakt die URL, die
   in Abschnitt 7.2 verifiziert wird).
2. lifeline-hub-Backend **neu bauen** (`cargo build --release`) **und neu starten** — eine
   reine Config-/Env-Änderung reicht hier NICHT, weil der Wert zur Compile-Zeit eingebrannt
   wird. Nach dem Rebuild greift der bestehende Fetch/Merge/TTL-Cache-Mechanismus
   unverändert (`effektiver_katalog`, TTL 300 s, Größenlimit 1 MiB — `katalog.rs`).

---

## 6. Erstbau + Scheduler

### 6.1 Initialer Vollbau (stundenlang)

Regionssatz ist im Service selbst kodiert (`karten-service/src/regions.rs`), aktuell 7
Einträge: `germany`, `bayern`, `baden-wuerttemberg`, `nordrhein-westfalen`,
`niedersachsen`, `austria`, `switzerland` (kein `dach`-Kombi — bewusst, s. Design-Doc §A.1;
neue Region = Code-Zeile + Deploy, kein UI). Einmaliger Lauf **ohne** HTTP-Server:

```bash
./target/release/karten-service build --all
```

Baut alle Regionen **seriell** (ein Build gleichzeitig, geteilter `out/sources/`-Cache
verträgt keine Parallelität, LFH-200), validiert nach jedem Bau die `bounds` gegen die
erwartete Region (Falschregion-Schutz) und published Datei + volles Manifest **atomar**
(erst Datei hochladen, dann Manifest aktualisieren — ein fehlgeschlagener Einzel-Build
lässt Manifest/Files unberührt). Je nach Hostleistung/Netz realistisch **mehrere Stunden**
für den ganzen Satz (Deutschland-weit dominiert die Laufzeit). Ein einzelner
fehlgeschlagener Slug bricht **nicht** den Rest ab (`main.rs::build_lokal` sammelt Fehler
und meldet sie am Ende gesammelt, exitet non-zero wenn mindestens einer scheiterte).

Danach den Prozess im `serve`-Modus starten (Abschnitt 3.2) — `seed_bestand` liest das
gerade publizierte Manifest zurück, sodass der Bestand nicht verloren geht.

### 6.2 Scheduler-Kadenz

In-Service-Cron (`KS_SCHEDULE`, Default `"0 0 3 1 1,4,7,10 *"` = **quartalsweise**, 03:00 am
1. Januar/April/Juli/Oktober) — läuft nur im `serve`-Prozess, enqueued dieselbe Build-Queue
wie On-Demand-Trigger (ein Lock, kein Cross-Prozess-Race, `main.rs`/`scheduler.rs`). Das
deckt sich mit der Aufgabenvorgabe „quartalsweise" — Default muss i.d.R. **nicht** verändert
werden. Anpassung nur über `KS_SCHEDULE` (6-Feld-Cron inkl. Sekunden).

Fallback ohne Dauerbetrieb (falls 24/7-Hosting zu schwer wiegt, Design-Doc „Severability"):
`karten-service build --all` unter System-Cron aufrufen — dann existiert kein On-Demand-
Trigger/Admin-UI-Button (Komponente B), der Cron-Kern hält die Karten aber weiterhin
automatisch aktuell.

---

## 7. Verifikation

### 7.1 Service erreichbar

```bash
curl -s https://SERVICE_DOMAIN/healthz                         # → "ok", kein Auth nötig
curl -s https://SERVICE_DOMAIN/regions \
  -H "Authorization: Bearer $TOKEN"                             # → Liste der baubaren Regionen
curl -s https://SERVICE_DOMAIN/builds \
  -H "Authorization: Bearer $TOKEN"                             # → Job-Liste (ggf. leer)
```

`/regions` und `/builds*` verlangen **beide** dasselbe Bearer-Token wie `/builds` POST (nur
`/healthz` ist auth-frei) — ohne/mit falschem Token: `401`.

### 7.2 Manifest publiziert + HTTPS/Range

```bash
curl -sI https://KS_BASE_URL/offline-katalog-manifest.json      # 200, Content-Type json
curl -s  https://KS_BASE_URL/offline-katalog-manifest.json | jq length   # Anzahl publizierter Regionen

# Range-Support der .mbtiles-Auslieferung (Pflicht für den LFH-181-Downloadpfad):
curl -sI -r 0-1 "$(curl -s https://KS_BASE_URL/offline-katalog-manifest.json | jq -r '.[0].url')"
# erwartet: HTTP/1.1 206 Partial Content, Accept-Ranges: bytes
```

Prüfe, dass die URL in `[0].url` exakt zur geplanten `OFFLINE_KATALOG_MANIFEST_URL`-Basis
passt (Abschnitt 3, Storage-URL-Hinweis).

### 7.3 lifeline-hub sieht buildbare Regionen

Mit `LIFELINE_KARTEN_SERVICE_URL`/`_TOKEN` gesetzt und Backend neu gestartet:

```bash
curl -s https://<lifeline-hub>/api/karte/config | jq .karten_bau_verfuegbar   # → true
```

Als Admin im Frontend: *Offline-Karten-Verwaltung* → Button **„Region neu bauen"** ist
sichtbar (`frontend/src/karten/OfflineKartenVerwaltung.tsx`), öffnet einen Picker mit den
über `/regions` gemeldeten Slugs, Trigger zeigt den Job-Status (2-Sekunden-Poll, solange ein
Bau aktiv ist). Nach einem erfolgreichen Bau: Katalog-Fetch (bis zu 5 Minuten TTL,
`CACHE_TTL` in `katalog.rs`) zeigt die neue, datierte URL → normaler
Update-/Download-Flow (unverändert, LFH-181/183).

---

## 8. Security-/Ops-Hinweise

- **Admin-only auf lifeline-hub-Seite:** `POST /api/karte/offline-karten/bauen` und die
  beiden Status-Proxies verlangen den `_admin`-Guard (`AdminUser`-Extractor,
  `src/routes/karte.rs`) — kein Nicht-Admin kann einen Bau anstoßen oder Job-Status lesen.
- **Ein Build gleichzeitig:** `jobs::Registry::try_lock_build` — ein globaler
  In-Process-Lock; weitere Trigger landen `queued` (Cap = Anzahl konfigurierter Regionen,
  aktuell 7) oder werden mit **`409 Conflict`** abgelehnt, wenn die Queue voll ist (nicht
  `429`, wie im Design-Doc noch erwogen — Code-Stand ist `409`).
- **Token bleibt server-side:** Browser → lifeline-hub (Session-Cookie/Admin-Guard) →
  lifeline-hub hält `LIFELINE_KARTEN_SERVICE_TOKEN` (`GeheimesPasswort`, Debug-maskiert) und
  reicht es serverseitig als Bearer an den Service weiter. Der Browser sieht das Token nie.
- **Status ist in-memory, nicht persistent:** Ein Service-Neustart verwirft die komplette
  Job-Historie (`Registry::neu(...)` legt bei jedem Prozessstart eine leere Registry an —
  es gibt **keine** explizite „als failed markieren"-Logik für einen zuvor laufenden Job,
  wie es das Design-Dokument suggeriert; er verschwindet schlicht). Praktische Konsequenz:
  nach einem Neustart mitten in einem Bau ist der Job nicht mehr sichtbar/abfragbar — der
  nächste Cron-Tick bzw. manuelle Trigger baut die Region erneut, ohne Datenverlust (Builds
  sind idempotent wiederholbar, keine Nutzerdaten betroffen).
- **Manifest-Publish ist atomar:** Datei zuerst, Manifest zuletzt — ein gescheiterter Build
  hinterlässt weder ein halb-verweisendes Manifest noch verwaiste Katalog-Einträge.
- **Kein Multi-Tenant/Rollen-Auth am Service:** ein einziges Bearer-Token für alle
  Operationen (`/builds`, `/regions`) — bewusst minimal, YAGNI laut Design-Doc.

---

## 9. Bekannte Lücken / TODOs

Punkte, die das Design-Dokument beschreibt, aber im aktuellen Code-Stand
(`karten-service/src/`) **nicht** vorhanden sind — nicht raten, sondern hier als offene
Posten mitführen:

- **Disk-Guard vor dem Bau fehlt.** Design §A.2 verlangt einen Plattenplatz-Check vor jedem
  Build; im Code (`build/make_runner.rs`, `build/mod.rs`) gibt es **keinen** Disk-Space-Check.
  Ein voller Build-Host würde den Bau erst mitten im Docker-Lauf scheitern lassen. Operator-
  Workaround bis dahin: großzügige Plattenreserve (Abschnitt 2.2) + externes Monitoring
  (`df`-Alarm) auf dem Build-Host.
- **`make validate` wird nicht aufgerufen.** Der `MakeRunner` liest die `bounds` selbst per
  `sqlite3`-Query (Falschregion-Schutz bleibt aktiv), ruft aber **nicht** `make -C
  karten-build validate` (Tile-Anzahl/`vector_layers`-Sanity-Check aus dem README) auf. Bei
  Verdacht auf einen kaputten Bau empfiehlt sich ein manueller Lauf von `make -C
  karten-build validate` gegen `out/result/`.
- **Kein TLS im Service selbst** — muss über einen Reverse-Proxy/LB gelöst werden
  (Abschnitt 4), ist keine Service-Eigenschaft.
- **Kein Dockerfile/Compose/systemd-Unit für `karten-service` im Repo** — nur das
  `versatiles/versatiles-planetiler`-Image für den eigentlichen Kartenbau. Paketierung des
  Service-Binaries ist Operator-Sache (Beispiel-Unit in Abschnitt 3.2 ist ein Vorschlag).
- **`OFFLINE_KATALOG_MANIFEST_URL` ist noch der TODO-Platzhalter** im Repo-Stand
  (`https://TODO-karten-build-release/offline-katalog-manifest.json`, `src/karte/katalog.rs`)
  — muss im Rahmen dieses Runbooks per Code-Änderung + Rebuild gepinnt werden (Abschnitt 5.2).
- **Retention/GC alter `.mbtiles`-Versionen ist nicht automatisiert** — alte, datierte
  Objekte bleiben im Storage liegen (bewusst YAGNI laut Design-Doc, „Ops-Politik"). Ohne
  manuelle/Lifecycle-Policy-Bereinigung wächst der Bucket unbegrenzt.
- **Design-Doc-Abweichungen (Doc/Code-Drift, zur Kenntnis, kein Blocker):** Keys liegen auf
  Bucket-Root statt unter `maps/`-Präfix (s. Abschnitt 3); Queue-voll liefert `409` statt der
  im Design-Doc erwogenen `429`; die `JobStatus::Uploading`-Variante existiert im Enum, wird
  aber vom aktuellen Code nie gesetzt (Datei-Upload läuft noch unter `Building`, bevor direkt
  nach `Publishing` gesprungen wird) — Operator sieht praktisch nur
  `queued→building→publishing→done/failed`.
