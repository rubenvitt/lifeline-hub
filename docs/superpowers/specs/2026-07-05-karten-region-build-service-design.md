# Zentraler Karten-Region-Build-Service + lifeline-hub-Trigger — Design

**Task-Herkunft:** LFH-201 („Region im Admin-UI bauen"). Das Brainstorming hat den ursprünglichen
Ansatz (der *laufende lifeline-hub-Server* stößt `docker run` an) verworfen — er bricht das
In-App-/kein-Laufzeit-Docker-Prinzip (LFH-178, `docs/betrieb/packaging.md`, `karten-build/README`).
Stattdessen: ein **eigenständiger, zentral gehosteter Build-Service** baut die Region-Packs,
hostet sie und hält sie per Zeitplan aktuell; lifeline-hub bleibt Client. Dieses Design wächst
über LFH-201 hinaus (eigener Dienst) — neue ClickUp-Tasks werden nach Freigabe der Spec angelegt
(siehe „Task-Home").

## Kontext & Lineage

Die **Client-Hälfte ist bereits gebaut und geshippt:**

- **LFH-181** — Offline-Karten-Download-Manager: `FortschrittMap`, FSM/Persistenz
  (`karte_offline_karte`: `registriert/laedt/bereit/fehler`, partieller Unique-Index „eine aktive
  Basemap"), In-Place-Hot-Swap, Crash-Recovery (`reset_haengende_downloads`).
- **LFH-183** — Eigen-Mirror-Entscheidung + per-Eintrag-`sha256`-Pin (im Download verifiziert) +
  One-Click-Update (`ersetzt_karte_id` → `ersetze_aktive_offline_karte`).
- **LFH-195/197** — Shortbread-MBTiles + Pin-Mechanik/Operator-Runbook.
- **LFH-199** — Hybrid-Katalog: `default_offline_katalog()` (compiled-in Baseline) **∪** optionales
  **Remote-Manifest** (`Vec<OfflineKatalogEintrag>` an gepinnter Mirror-URL, best-effort, TTL-Cache,
  Merge-per-`name`, Offline-Fallback, Halb-Pin-Verwerfen) + geführter Regions-Picker. Die Design-Doc
  schnitt die Arbeit in **A (Dev-Backend Hybrid) — fertig**, **B (Dev-Frontend Picker) — fertig**,
  **C (Operator/Content: Packs bauen+hosten+pinnen + Manifest pflegen) — „Nicht-Dev", offen.**
- **LFH-200** — `make tiles AREA=x` liefert jetzt die echte Region (stale Region-PBFs vor Bau löschen;
  Renumber-Schritt wählte sonst per `find | head -1` die falsche/erste Region).

**Kern-Erkenntnis:** Der Client-Vertrag steht und funktioniert — lifeline-hub holt das Manifest,
merged es, prüft Updates per URL-Vergleich, lädt per HTTPS/Range und verifiziert sha256. Was fehlt,
ist **LFH-199 Subtask C als System**: der produzierende/publizierende Teil. Genau das ist dieser
Service.

## Getroffene Entscheidungen (Brainstorming 2026-07-05)

1. **Kaufen statt Bauen-in-App:** kein Laufzeit-Docker in lifeline-hub. Packs kommen von einem
   projektkontrollierten Mirror; der Download-Pfad (LFH-181) lädt sie.
2. **Aktiver Build-Service (nicht nur statischer Mirror):** ein Dienst mit API — er baut on-demand
   **und** (vor allem) per Zeitplan; er meldet Build-Status zurück.
3. **Zentral gehostet (Internet):** eine dauerhaft laufende Instanz, erreichbar über feste HTTPS-URL;
   jede prep-fähige lifeline-hub-Instanz nutzt sie. **Prep-Zeit-Facility** — der ELW ist im Feld
   offline, Trigger/Download gehen nur mit Netz.
4. **Fixer kuratierter Regionssatz (~5–20):** DE, DACH, Bundesländer. Cron baut turnusweise **alle**
   neu; on-demand = Force-Refresh eines bestehenden Eintrags. **Keine Freitext-Regionen.**
5. **Ein Design-Dokument** für beide Komponenten (diese Spec), interne Grenzen klar benannt.
6. **Rust-Service im Monorepo + Object-Storage:** Rust/axum-Crate `karten-service/`, teilt die
   `OfflineKatalogEintrag`-Struct (Vertrag ohne Drift), reuse `karten-build` + sha256-Muster. Files →
   S3-kompatibles Object-Storage (keine 2-GB/Datei-Grenze, Range/Bandbreite ausgelagert).

## Architektur-Überblick

Drei Bausteine, zwei Code-Deliverables:

```
                 ┌───────────────────────── karten-service (neu, zentral) ─────────────────────┐
                 │  Scheduler ─┐                                                                │
  System/Cron ──►│  (in-svc)   ├─► Build-Runner ─► Publisher ─► Manifest-Generator             │
  bzw. on-demand │  API /builds┘   (karten-build   (→ Object-   (offline-katalog-manifest.json)│
                 │  (+Auth)         /Docker, seriell) Storage)                                  │
                 └───────────────────────────────┬──────────────────────┬──────────────────────┘
                                                 ▼                      ▼
                                        Object-Storage (S3/R2, public-read, HTTPS+Range)
                                          maps/<slug>.<YYYYMMDD>.shortbread.mbtiles
                                          offline-katalog-manifest.json  ◄── stabile URL
                                                 ▲                      ▲
                 ┌───────────── lifeline-hub (Client, Erweiterung) ─────┼──────────────────────┐
                 │  Manifest-Fetch/Merge/Update-Check (LFH-199, da) ────┘                       │
                 │  Download/Register/Aktivieren/Hot-Swap (LFH-181/183, da)                     │
                 │  NEU: Proxy-Trigger + Status-Spiegelung + Admin-UI ──► POST /builds (Service)│
                 └──────────────────────────────────────────────────────────────────────────────┘
```

**Wichtiger Vereinfacher:** Manifest + Files liegen im **Object-Storage** und werden von dort
direkt ausgeliefert (stabile Public-URLs). Der always-on-Service muss deshalb **nur** die
Trigger/Status-API + Auth + den Build/Publish/Manifest-Lauf tragen — **nicht** die GB-Files servieren.

## Komponente A — `karten-service`

Ein Rust-Crate im Repo (Cargo-Workspace). Zwei Betriebsarten aus **einem** Code:
der always-on-Prozess (`karten-service serve`) trägt die API + den in-service-Scheduler; alle
Build-Läufe (Cron wie on-demand) laufen durch **denselben Prozess** und **einen** Build-Lock.

### A.1 Katalog-Definition (autoritativ im Service)

Der Service besitzt die Quelle der Wahrheit für den fixen Satz: je Region
`slug` (Dateiname/Manifest-Key), `geofabrik_area` (Argument für `make`), `name`, `region`, `gruppe`,
`lizenz`. Konfiguriert als eingebettete Liste (analog `default_offline_katalog`, gleiche Slugs).
Neue Region = eine Zeile ergänzen (bewusst Code-/Deploy-Änderung, kein UI).

**Constraint — nur einzelne Geofabrik-Extrakte:** `geofabrik_area` muss ein **gültiger einzelner**
Geofabrik-Gebietsname sein (z. B. `germany`, `bayern`, `bremen`, `austria`, `switzerland`).
**Kombi-Regionen wie „DACH" (DE+AT+CH) sind KEIN einzelner Extrakt** und daher in v1 **nicht als
`make tiles AREA=dach` baubar**. Für v1: DACH aus dem baubaren Satz nehmen (stattdessen DE/AT/CH
einzeln anbieten) — ein DACH-Kombi-Pack bräuchte einen eigenen Merge-Schritt (mehrere Extrakte
zusammenführen) und ist bewusst verschoben (siehe „NICHT in Scope"). `default_offline_katalog()`
in lifeline-hub muss entsprechend nachgezogen werden (keine unbaubaren Platzhalter anbieten).

### A.2 Build-Runner

- Kapselt `make -C karten-build tiles AREA=<geofabrik_area>` (Docker/Planetiler-Shortbread) via
  `tokio::process`. **Genau ein Build gleichzeitig** (globaler In-Process-Lock/Queue) — der geteilte
  `out/sources/`-Cache verträgt keine parallelen Regionen (LFH-200).
- Nach dem Bau: `make validate` **und** die `metadata`-`bounds` gegen die erwartete Region prüfen
  (LFH-200-Falschregion-Schutz: Dateiname ist nicht vertrauenswürdig). Liest die `.sha256`-Sidecar.
- Disk-Guard **vor** dem Bau (Arbeitsraum ~1 GB Wasser-Polygone + Region + tmp).
- Abbruch (optional, YAGNI-nah): Prozessgruppen-Kill des `make`/Docker-Kindes; für v1 nicht zwingend,
  da Builds turnusweise und selten on-demand laufen.

### A.3 Publisher (Object-Storage)

- Lädt die gebaute `osm*.mbtiles` unter **versioniertem Key** `maps/<slug>.<YYYYMMDD>.shortbread.mbtiles`
  ins S3-kompatible Storage (public-read), misst Größe, übernimmt sha256 aus der Sidecar.
- S3-Zugriff über ein S3-SDK/`object_store`-Crate; Credentials aus ENV (nie im Repo).
- Alte Versionen bleiben zunächst liegen (Retention = Ops-Politik, nicht v1-Code).

### A.4 Manifest-Generator

- Regeneriert `offline-katalog-manifest.json` = `Vec<OfflineKatalogEintrag>` mit **allen** Regionen
  des Satzes in ihrer **aktuellen** Version (url = volle Public-URL der datierten Datei, groesse,
  sha256, name, region, lizenz = ODbL, kachel_schema = `"shortbread"`, quelle = Eigen-Service, gruppe).
  Ein on-demand-Rebuild einer einzelnen Region aktualisiert deren Eintrag und publisht das **komplette**
  Manifest neu (immer der volle aktuelle Stand, nie ein Teil-Manifest).
- **Atomar publishen:** erst Datei hochladen, dann Manifest aktualisieren — nie ein Manifest, das auf
  eine noch nicht vollständig hochgeladene Datei zeigt. Ein fehlgeschlagener Build lässt Manifest +
  bestehende Files unberührt.
- Wird an die **stabile Manifest-URL** geladen (die lifeline-hub kompiliert-pinnt).

### A.5 Scheduler

- **In-service** (Cron-Expression, Default quartalsweise): der `serve`-Prozess plant „build-all"
  und legt die Läufe in dieselbe Build-Queue wie on-demand → ein Prozess, ein Lock, **kein
  Cross-Prozess-Race** um den geteilten Cache.
- Alternative (nicht empfohlen): System-Cron auf ein `karten-service build --all`-Subkommando —
  bräuchte dann einen OS-weiten Lock (flock/Storage-Lock) gegen die API-Builds. Wir nehmen die
  in-service-Variante.

### A.6 API & Auth

- `POST /builds` **(Bearer-Token Pflicht)** — Body: `{ slug }` aus dem fixen Satz (validiert gegen
  die Katalog-Definition; unbekannter Slug → 400). Legt einen Job an (queued wenn busy), liefert
  `{ job_id, slug, status }`. Serialisiert.
- `GET /builds` / `GET /builds/{job_id}` — Job-Status/Phase (`queued`→`building`→`uploading`
  →`publishing`→`done`/`failed`), Zeitstempel, Zielversion. Für das Status-Polling; darf auth-frei
  lesbar sein (kein Geheimnis) — Entscheidung: gleiche Bearer-Auth wie Trigger, minimalste Fläche.
- `GET /healthz` — Liveness.
- **Manifest + Files: keine Service-Endpunkte** (Object-Storage). **Public-read** (ODbL-Daten,
  unkritisch); nur der Trigger ist auth-pflichtig. Ein einziges Service-Token genügt (kein
  Multi-Tenant).

### A.7 Nebenläufigkeit, Fehler, Crash-Recovery

- Ein Build zur Zeit (globaler Lock); weitere Trigger → `queued` oder 409 (Design-Detail für den
  Plan; Vorschlag: kurze Queue mit Cap, darüber 429).
- Build-Fehler → Job `failed` + Artefakt-Cleanup (`out/tmp`, partielle Uploads), Manifest/Files
  unberührt.
- **Status ist in-memory** (kein DB-Persist). Service-Neustart mitten im Build: laufender Job gilt als
  `failed` (Startup-Reset, analog `reset_haengende_downloads`); der nächste Cron/Trigger baut neu.
  Bewusst akzeptiert — Builds sind idempotent wiederholbar, keine Nutzerdaten betroffen.

## Manifest-Vertrag & Versionierung

- **Geteilte Struct:** `OfflineKatalogEintrag` (heute `src/config.rs`) wird zur gemeinsamen Quelle der
  Wahrheit — via kleinem Workspace-Crate **oder** Service-Abhängigkeit auf die lib des Hauptbinaries
  (Mechanik im Umsetzungsplan; Ziel: **eine** Definition, kein JSON-Schema-Duplikat).
- **Versionierung über die URL:** der Client-Update-Check vergleicht `name` (stabil) + `url`
  (versioniert). Neuer Build → neue datierte URL im Manifest → lifeline-hub zeigt „Update verfügbar" →
  bestehender Hot-Swap-Download (`ersetzt_karte_id`) greift. sha256 im Manifest → Download verifiziert
  automatisch (`HashMismatch` → `fehler`, kein stilles Ausliefern).
- **Halb-Pin-Regel bleibt:** ein Manifest-Eintrag ist entweder vollständig gepinnt (64-hex-sha256 +
  echte https-URL + Größe>0 + Lizenz) oder wird beim Merge verworfen (`remote_eintrag_ist_gueltig`,
  unverändert).

## Komponente B — lifeline-hub-Erweiterung

### B.1 Config (operator-set)

- Neu: `--karten-service-url` + `--karten-service-token` (je mit `LIFELINE_*`-ENV) — Basis + Bearer
  für Trigger/Status. Fehlt die Config → die Build-Trigger-UI ist **nicht sichtbar/deaktiviert**
  (der normale Katalog-Download bleibt unberührt).
- Die **Manifest-URL bleibt kompiliert-gepinnt** (`OFFLINE_KATALOG_MANIFEST_URL`, jetzt auf die
  Object-Storage-Manifest-URL) → LFH-199-Trust-Modell (kein admin-editierbares URL-Feld) bleibt intakt.

### B.2 Proxy-Trigger (server-side)

- Browser → **lifeline-hub** (`_admin`-Guard) → lifeline-hub ruft **serverseitig** `POST /builds` am
  Service (Bearer-Token bleibt server-side, nie im Browser). Outbound-URL läuft durch den bestehenden
  SSRF-Guard-Geist (`validiere_download_url`-Disziplin: nur https, keine internen Ziele).
- lifeline-hub pollt `GET /builds/{id}` und **spiegelt** den Service-Status in die bestehende
  Karten-Tabelle (2s-`refetchInterval`, Status-Tag `baut`). Kein neues Frontend-Poll-Framework.

### B.3 Admin-UI

- Vierte Aktion „Region neu bauen" in `OfflineKartenVerwaltung.tsx` (neben „Region aufs Gerät
  bringen"/„Per URL"/„Gebaute Region übernehmen"), sichtbar nur bei konfiguriertem Service + `admin`.
  Der Picker nutzt den **bereits geladenen Katalog** (die triggerbaren Regionen sind genau die
  Katalog-Einträge; Trigger per `slug`) — kein neuer Client-Datenpfad. Ein `GET /regions` am Service
  ist optional/YAGNI, falls der triggerbare Satz je vom ausgelieferten Katalog abweichen sollte.
- Fertig-Zustand: der nächste Manifest-Fetch trägt die neue URL → normaler „Update/Herunterladen"-Flow
  (unverändert). Der Build-Fortschritt selbst ist reiner Service-Status (nicht die Byte-Semantik des
  Downloads).

### B.4 Reuse (unverändert)

Download/`FortschrittMap`/Registry-FSM/Aktivierung/Hot-Swap/Auto-Register + Manifest-Merge/Cache/
Update-Check bleiben **wie sie sind**. Die Erweiterung ist additiv.

## Trust-Modell

- **Manifest-URL kompiliert-gepinnt** (Object-Storage, HTTPS) — einziger unveränderter Anker aus
  LFH-199.
- **Download-Integrität per-Eintrag-sha256** (bestehend) — die GB-Datei wird gegen den Manifest-Hash
  verifiziert, egal woher der Eintrag stammt. **Kein Manifest-Signing nötig.**
- **Neuer Anker:** die operator-gesetzte Trigger-URL + Token. Bewusst als Config (nicht admin-UI-
  editierbar), server-side gehalten, Outbound-SSRF-geguardet. Das ist die einzige neue
  Vertrauens-/Angriffsfläche und ist minimal gehalten.

## Testing

- **Service:** Build-Runner-Integrations-Smoke gegen eine **kleine** Region (Bremen) inkl.
  Bounds-Validierung (Falschregion → Fehler); Manifest-Generator (Serialisierung + Versions-Diff
  erzeugt neue URL) unit; Queue/Serialisierung (zweiter Trigger während Build) unit; Auth (fehlendes/
  falsches Token → 401) unit. S3-Publish gegen einen lokalen S3-Mock oder hinter einem
  Storage-Trait gestubbt.
- **lifeline-hub:** Proxy-Trigger (msw: `_admin` → Service-Call mit Token; ohne Config → keine UI)
  + Status-Spiegelung in die Tabelle; Manifest-Merge/Update-Check bereits getestet (LFH-199).

## Bewusst NICHT in Scope (YAGNI)

- Beliebige Freitext-/Ad-hoc-Regionen; Landkreis-Granularität; Such-/Hierarchie-UX.
- Manifest-Signing (URL gepinnt + per-Eintrag-sha256 genügt).
- Additive Online+Offline-Overlays (Basemap bleibt umschaltbar).
- Multi-Tenant-/Rollen-Auth am Service (ein Service-Token).
- Alte-Versionen-Retention/GC im Storage (Ops-Politik, nicht v1-Code).
- Byte-genauer Build-Fortschritt (Phasen-Status genügt; Planetiler liefert keinen 0–100-Progress).
- Build-Abbruch on-demand (Prozessgruppen-Kill) — optional, in v1 verzichtbar.

## Ops (deine Seite — nicht Code)

- S3-kompatibles Object-Storage (AWS S3 / Cloudflare R2): Bucket, **public-read**, HTTPS + Range;
  Credentials für den Service.
- Docker-fähiger, always-on Host mit dem Repo (bzw. `karten-build/` + dem
  `versatiles/versatiles-planetiler`-Image) + Multi-GB-Arbeits-/Cache-Platte.
- DNS/TLS für die Service-URL; das Service-Token erzeugen + in lifeline-hub-Config hinterlegen.
- Der erstmalige, stundenlange Vollbau des Regionssatzes; danach turnusweise per Scheduler.

## Task-Home / ClickUp

Dieses Design wächst über **LFH-201** (in-Admin-UI-bauen) hinaus. Nach Freigabe der Spec werden neue
Tasks angelegt (via `clickup-task-anlegen`), Vorschlag:
- **Service (Komponente A)** — neues Feature (baut auf `karten-build`, Object-Storage, Scheduler, API).
- **lifeline-hub-Trigger (Komponente B)** — Feature (Config + Proxy-Trigger + Admin-UI).
- **Operator-Runbook/Ops** — Doc-Task (Bucket/Host/Cron/Erst-Bau).
LFH-201 wird auf dieses Design referenziert (die ursprüngliche in-App-Bau-Idee ist damit ersetzt).

## Referenzen

- Vorlauf: LFH-181 (Download-Manager), LFH-183 (Eigen-Mirror + sha256-Pin), LFH-195/197
  (Shortbread + Pin-Mechanik), LFH-199 (Hybrid-Katalog + Picker), LFH-200 (AREA-Fix).
- Code: `src/karte/katalog.rs`, `src/config.rs` (`default_offline_katalog`, `OfflineKatalogEintrag`,
  `merge_offline_katalog`, `OFFLINE_KATALOG_MANIFEST_URL`), `src/karte/download.rs`,
  `src/routes/karte.rs`, `src/karte/registry/repo.rs`, `karten-build/` (Makefile, README),
  `frontend/src/karten/` (`OfflineKartenVerwaltung.tsx`, `OfflineDownloadKatalogModal.tsx`).
- Verwandte Specs: `docs/superpowers/specs/2026-06-27-offline-karten-eigenmirror.md`,
  `docs/superpowers/specs/2026-07-04-offline-region-katalog-hybrid-design.md`.
