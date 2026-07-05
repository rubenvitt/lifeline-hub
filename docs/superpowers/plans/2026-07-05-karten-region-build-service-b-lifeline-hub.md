# lifeline-hub-Trigger/UI (Komponente B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** lifeline-hub erweitern, sodass ein Admin in der Prep-Phase einen Region-Rebuild am zentralen
`karten-service` anstößt, dessen Status sieht, und das Ergebnis über den **bestehenden** Katalog-/
Download-/Update-Pfad (LFH-181/199) nutzt.

**Architecture:** Rein **additiv**. Ein server-seitiger Proxy in lifeline-hub (`_admin`) ruft die
`karten-service`-API (Bearer-Token bleibt server-side); das Frontend triggert/pollt nur lifeline-hub.
Der Manifest-Konsum + Download + Auto-Register + Update-Check existieren bereits (LFH-199) und
bleiben unverändert — hier kommen nur Trigger, Status-Spiegelung und das UI hinzu. Voraussetzung ist
ein `GET /regions` am Service (Task B0, ein kleiner Nachtrag zu Plan A Task 12).

**Tech Stack:** Rust/axum (Bestand), `reqwest` (Bestand, SSRF-gepinnt), clap-Config (Bestand);
Frontend React + antd + react-query + msw (Bestand). Konventionen: CLAUDE.md (UI-Form, Lint-Disziplin).

## Global Constraints

- **Manifest-URL bleibt kompiliert-gepinnt** (`katalog::OFFLINE_KATALOG_MANIFEST_URL`) → LFH-199-Trust.
  Neu operator-konfigurierbar sind **nur** Service-URL + Token (kein admin-UI-editierbares URL-Feld).
- **Token nie im Browser:** der Trigger läuft Browser → lifeline-hub (`_admin`) → Service.
- **Feature-Gate:** ohne konfigurierte Service-URL+Token ist die Bau-UI unsichtbar; alle bestehenden
  Karten-Funktionen bleiben unberührt.
- **Frontend-Gate:** `pnpm lint` mit `--max-warnings 0` (LFH-168); `pnpm build` (Prod) + Typecheck
  (`tsc --noEmit`, ES2020-lib) als eigene Gates; Vitest via `--no-file-parallelism` für ein sauberes
  Gate. pnpm läuft über `mise exec` mit absoluten `-C`-Pfaden.
- **Rust-Gate:** `cargo test -p lifeline-hub`. Im Bestandsstil editieren (Repo nicht rustfmt/clippy-clean).
- **AppState-Churn beachten:** neue AppState-Pflichtfelder brechen die vielen inline-Test-Konstruktionen
  (kein zentraler Helfer) — jede Konstruktion mitziehen (siehe Task B1).

---

## File Structure

- Service (Nachtrag): `karten-service/src/api.rs` (+`GET /regions`), `karten-service/src/regions.rs` (Serialize).
- Backend: `src/config.rs` (2 Felder), `src/app.rs` (AppState + Routen), `src/routes/karte.rs`
  (Proxy-Handler `offline_bauen`, `offline_baubare_regionen`, `offline_bau_status`; Config-Flag).
- Frontend: `frontend/src/api/offlineKarten.ts` (Seam), `frontend/src/karten/OfflineRegionBauenModal.tsx`
  (neu), `frontend/src/karten/OfflineKartenVerwaltung.tsx` (4. Aktion + Status-Spiegelung),
  Tests `*.test.tsx`.
- Katalog-Nachzug: `src/config.rs` (`default_offline_katalog` — kein unbaubares DACH mehr).

---

## Task B0: Service-Nachtrag — `GET /regions` (karten-service)

**Files:** Modify `karten-service/src/regions.rs`, `karten-service/src/api.rs`.

**Interfaces:**
- Produces: `GET /regions` (Bearer) → `[{slug, name, region, gruppe}]` aus `regions::alle()`.

- [ ] **Step 1: Failing test** (`api.rs`)

```rust
#[tokio::test]
async fn regions_listet_baubare() {
    use axum::{body::Body, http::{Request, StatusCode}};
    use tower::ServiceExt;
    let app = super::super::router(super::super::test_state());
    let req = Request::builder().method("GET").uri("/regions")
        .header("authorization","Bearer t").body(Body::empty()).unwrap();
    let r = app.oneshot(req).await.unwrap();
    assert_eq!(r.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(r.into_body(), 1<<20).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert!(v.as_array().unwrap().iter().any(|e| e["slug"]=="germany"));
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p karten-service regions_listet` → FAIL.

- [ ] **Step 3: Implementieren** — `regions.rs`: ein serialisierbares DTO ergänzen:

```rust
#[derive(serde::Serialize)]
pub struct RegionDto { pub slug: &'static str, pub name: &'static str, pub region: &'static str, pub gruppe: &'static str }
pub fn dtos() -> Vec<RegionDto> {
    alle().iter().map(|r| RegionDto { slug:r.slug, name:r.name, region:r.region, gruppe:r.gruppe }).collect()
}
```

`api.rs`: Route `.route("/regions", get(regions_liste))` + Handler:

```rust
async fn regions_liste(State(st):State<AppState>, headers:HeaderMap) -> Result<Json<Vec<regions::RegionDto>>, StatusCode> {
    if !auth(&headers, &st.token) { return Err(StatusCode::UNAUTHORIZED); }
    Ok(Json(regions::dtos()))
}
```

- [ ] **Step 4: Run → pass** — `cargo test -p karten-service regions_listet` → PASS.

- [ ] **Step 5: Commit**

```bash
git add karten-service/src/regions.rs karten-service/src/api.rs
git commit -m "feat(lfh-201): GET /regions am karten-service (baubare Regionen fürs UI)"
```

---

## Task B1: lifeline-hub-Config + AppState + Verfügbarkeits-Flag

**Files:** Modify `src/config.rs`, `src/app.rs`, `src/main.rs`, `src/routes/karte.rs` (Config-Handler), + alle inline-AppState-Test-Konstruktionen.

**Interfaces:**
- Produces: `Config.karten_service_url: Option<String>`, `Config.karten_service_token: Option<String>`
  (clap, env `LIFELINE_KARTEN_SERVICE_URL`/`_TOKEN`); `AppState.karten_service_url/-token`; im
  Karten-Config-Response (Frontend-Query `['karte-config']`) das Feld `karten_bau_verfuegbar: bool`
  (= beide gesetzt).

- [ ] **Step 1: Failing test** — der Karten-Config-Handler meldet das Flag. (Den Handler lokalisieren,
  der `['karte-config']` bedient — vermutlich `GET /api/karte/config`.) Test: mit gesetzter
  Service-Config → `karten_bau_verfuegbar == true`; ohne → `false`.

```rust
// in routes/karte.rs test-Modul, gegen den Config-Handler mit einem AppState mit/ohne Service-Config
#[tokio::test]
async fn karte_config_meldet_bau_verfuegbar() {
    let st = /* AppState mit karten_service_url=Some, token=Some */ ;
    let resp = karte_config(State(st)).await.unwrap();
    assert!(resp.0.karten_bau_verfuegbar);
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p lifeline-hub karte_config_meldet` → FAIL.

- [ ] **Step 3: Implementieren**
  - `config.rs`: zwei `#[arg(long, env=...)] pub karten_service_url: Option<String>` / `_token`.
  - `app.rs`: `AppState { …, pub karten_service_url: Option<String>, pub karten_service_token: Option<String> }`;
    in `main.rs` aus der Config befüllen. **Alle inline-Test-Konstruktionen von `AppState` mitziehen**
    (kein zentraler Helfer — siehe MEMORY „appstate-feld-bricht-test-konstruktionen"; ggf. bei der
    Gelegenheit einen `AppState::fuer_test(pool)`-Helfer einführen, der die Optionsfelder `None` setzt,
    und die Konstruktionen darauf umstellen).
  - Config-Handler: `karten_bau_verfuegbar = st.karten_service_url.is_some() && st.karten_service_token.is_some()`
    ins Response-Struct + dessen Serde-Struct.

- [ ] **Step 4: Run → pass** — `cargo test -p lifeline-hub` → PASS (inkl. der wieder-grünen Bestandstests).

- [ ] **Step 5: Commit**

```bash
git add src/config.rs src/app.rs src/main.rs src/routes/karte.rs
git commit -m "feat(lfh-201): Config+AppState für karten-service (URL/Token) + karten_bau_verfuegbar-Flag"
```

---

## Task B2: Proxy `POST /api/karte/offline-karten/bauen`

**Files:** Modify `src/routes/karte.rs`, `src/app.rs` (Route).

**Interfaces:**
- Produces: `POST /api/karte/offline-karten/bauen` (`_admin: AdminUser`) `{slug}` → 202 `{job_id}` |
  400 (leerer slug) | 501 (Service nicht konfiguriert) | 502 (Service-Fehler). Forwarded an
  `POST {url}/builds` mit Bearer-Token via `state.download_client` (https-gepinnt).

- [ ] **Step 1: Failing test — nicht konfiguriert → 501; leerer slug → 400**

```rust
#[tokio::test]
async fn bauen_ohne_service_config_501() {
    let st = /* AppState ohne karten_service_url */ ;
    let err = offline_bauen(State(st), admin_stub(), Json(OfflineBauBody{ slug:"bayern".into() })).await.unwrap_err();
    assert!(matches!(err, AppError::NotImplemented(_))); // oder der im Repo übliche 501-Arm
}
#[tokio::test]
async fn bauen_leerer_slug_400() {
    let st = /* AppState MIT Service-Config */ ;
    let err = offline_bauen(State(st), admin_stub(), Json(OfflineBauBody{ slug:"".into() })).await.unwrap_err();
    assert!(matches!(err, AppError::Validation(_)));
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p lifeline-hub bauen_` → FAIL.

- [ ] **Step 3: Implementieren**

```rust
#[derive(serde::Deserialize)]
pub struct OfflineBauBody { pub slug: String }

pub async fn offline_bauen(State(st):State<AppState>, _admin:AdminUser, Json(body):Json<OfflineBauBody>)
    -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let slug = body.slug.trim();
    if slug.is_empty() { return Err(AppError::Validation("slug darf nicht leer sein".into())); }
    let (Some(url), Some(token)) = (st.karten_service_url.as_deref(), st.karten_service_token.as_deref())
        else { return Err(AppError::NotImplemented("karten-service nicht konfiguriert".into())); };
    let resp = st.download_client.post(format!("{}/builds", url.trim_end_matches('/')))
        .bearer_auth(token).json(&serde_json::json!({"slug": slug}))
        .timeout(std::time::Duration::from_secs(10)).send().await
        .map_err(|e| AppError::BadGateway(format!("karten-service unerreichbar: {e}")))?;
    let status = resp.status();
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::json!({}));
    if !status.is_success() { return Err(AppError::BadGateway(format!("karten-service {status}: {body}"))); }
    Ok((StatusCode::ACCEPTED, Json(body)))
}
```

(Die exakten `AppError`-Varianten — `NotImplemented`/`BadGateway` — an die im Repo vorhandenen
anpassen; falls es keine gibt, den nächstliegenden 5xx/501-Arm nutzen oder ergänzen.) Route in
`app.rs` im Admin-Karten-Block: `.route("/api/karte/offline-karten/bauen", post(offline_bauen))`.
**Happy-Path-Forward ist Integrations-getestet** (der SSRF-Guard blockt Loopback-Fixtures — wie bei
LFH-183; hier werden die not-configured-/Validierungs-Arme unit-getestet).

- [ ] **Step 4: Run → pass** — `cargo test -p lifeline-hub bauen_` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/karte.rs src/app.rs
git commit -m "feat(lfh-201): Proxy POST /offline-karten/bauen → karten-service (server-side Token)"
```

---

## Task B3: Proxy `GET /baubare-regionen` + `GET /bau-status`

**Files:** Modify `src/routes/karte.rs`, `src/app.rs`.

**Interfaces:**
- Produces: `GET /api/karte/offline-karten/baubare-regionen` (`_admin`) → forwarded `GET {url}/regions`
  (leer wenn nicht konfiguriert); `GET /api/karte/offline-karten/bau-status` (`_admin`) → forwarded
  `GET {url}/builds` (leer wenn nicht konfiguriert).

- [ ] **Step 1: Failing test — nicht konfiguriert → leere Liste (200)**

```rust
#[tokio::test]
async fn baubare_ohne_config_leer() {
    let st = /* ohne Service-Config */ ;
    let Json(v) = offline_baubare_regionen(State(st), admin_stub()).await.unwrap();
    assert!(v.as_array().unwrap().is_empty());
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p lifeline-hub baubare_` → FAIL.

- [ ] **Step 3: Implementieren** — ein gemeinsamer Helfer `service_get(&st, pfad) -> Result<Value>`
  (None-Config → `json!([])`; sonst `GET {url}{pfad}` mit Bearer, 10s-Timeout, Fehler → 502).
  Zwei dünne Handler `offline_baubare_regionen` (`/regions`) und `offline_bau_status` (`/builds`).
  Routen in `app.rs` registrieren (statische Segmente vor `/{id}`).

```rust
async fn service_get(st:&AppState, pfad:&str) -> Result<serde_json::Value, AppError> {
    let (Some(url), Some(token)) = (st.karten_service_url.as_deref(), st.karten_service_token.as_deref())
        else { return Ok(serde_json::json!([])); };
    let resp = st.download_client.get(format!("{}{}", url.trim_end_matches('/'), pfad))
        .bearer_auth(token).timeout(std::time::Duration::from_secs(10)).send().await
        .map_err(|e| AppError::BadGateway(format!("karten-service unerreichbar: {e}")))?;
    if !resp.status().is_success() { return Err(AppError::BadGateway(format!("karten-service {}", resp.status()))); }
    resp.json().await.map_err(|e| AppError::BadGateway(format!("karten-service-Antwort: {e}")))
}
pub async fn offline_baubare_regionen(State(st):State<AppState>, _admin:AdminUser) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(service_get(&st, "/regions").await?))
}
pub async fn offline_bau_status(State(st):State<AppState>, _admin:AdminUser) -> Result<Json<serde_json::Value>, AppError> {
    Ok(Json(service_get(&st, "/builds").await?))
}
```

- [ ] **Step 4: Run → pass** — `cargo test -p lifeline-hub baubare_` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/karte.rs src/app.rs
git commit -m "feat(lfh-201): Proxy GET /baubare-regionen + /bau-status → karten-service"
```

---

## Task B4: Frontend-API-Seam (`offlineKarten.ts`)

**Files:** Modify `frontend/src/api/offlineKarten.ts`; Test `frontend/src/api/offlineKarten.test.ts` (falls vorhanden, sonst in Modul-Test).

**Interfaces:**
- Produces: `starteRegionBau(slug: string): Promise<{ job_id: number }>` (POST `/api/karte/offline-karten/bauen`);
  `ladeBaubareRegionen(): Promise<BaubareRegion[]>`; `ladeBauStatus(): Promise<BauJob[]>`; Typen
  `BaubareRegion { slug; name; region; gruppe }`, `BauJob { id; slug; status; fehler?; gestartet; beendet? }`.

- [ ] **Step 1: Failing test (msw)** — `starteRegionBau('bayern')` POSTet den Slug; `ladeBauStatus`
  parst die Job-Liste.

```ts
it('starteRegionBau postet den slug', async () => {
  let gesehen: unknown;
  server.use(http.post('/api/karte/offline-karten/bauen', async ({ request }) => {
    gesehen = await request.json(); return HttpResponse.json({ job_id: 7 });
  }));
  const r = await starteRegionBau('bayern');
  expect(r.job_id).toBe(7);
  expect(gesehen).toEqual({ slug: 'bayern' });
});
```

- [ ] **Step 2: Run → fail** — `mise exec pnpm@<ver> -- pnpm -C <abs> test offlineKarten` → FAIL.

- [ ] **Step 3: Implementieren** — die drei Funktionen + Typen via `apiGet`/`apiSend` (Bestand), analog
  zu `starteOfflineDownload`/`listeVorhandeneKarten`.

- [ ] **Step 4: Run → pass** — Vitest PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/offlineKarten.ts frontend/src/api/offlineKarten.test.ts
git commit -m "feat(lfh-201): Frontend-API-Seam für Region-Bau (Trigger/Status/Regionen)"
```

---

## Task B5: Admin-UI — „Region neu bauen" + Status-Spiegelung

**Files:** Create `frontend/src/karten/OfflineRegionBauenModal.tsx`; Modify
`frontend/src/karten/OfflineKartenVerwaltung.tsx`; Tests `OfflineKartenVerwaltung.test.tsx`.

**Interfaces:**
- Consumes: `starteRegionBau`, `ladeBaubareRegionen`, `ladeBauStatus`, `karten_bau_verfuegbar`.
- Produces: 4. Aktion „Region neu bauen" (nur wenn `karten_bau_verfuegbar` && Admin); Modal-Picker
  (gruppiert wie `OfflineDownloadKatalogModal`) → `starteRegionBau(slug)`; kompakte Bau-Status-Zeile
  (aktive `BauJob`s), gepollt solange Jobs `queued|building|uploading|publishing`.

- [ ] **Step 1: Failing test (msw)** — bei `karten_bau_verfuegbar:true` erscheint der Button; Klick
  öffnet den Picker; Auswahl triggert `starteRegionBau` mit dem richtigen Slug; bei `false` ist der
  Button nicht da.

```tsx
it('zeigt Bauen-Button nur wenn verfügbar und triggert mit slug', async () => {
  server.use(
    http.get('/api/karte/offline-karten/baubare-regionen', () =>
      HttpResponse.json([{ slug:'bayern', name:'Bayern', region:'DE-BY', gruppe:'Bundesländer' }])),
    http.post('/api/karte/offline-karten/bauen', () => HttpResponse.json({ job_id: 1 })),
  );
  // mockBasis mit karten_bau_verfuegbar:true + istAdmin:true
  renderMitProviders(<OfflineKartenVerwaltung />);
  await userEvent.click(await screen.findByRole('button', { name: /Region neu bauen/i }));
  await userEvent.click(await screen.findByRole('button', { name: /Bauen/i }));
  // Erfolg: message.success / Status-Zeile erscheint
});
```

- [ ] **Step 2: Run → fail** — Vitest FAIL.

- [ ] **Step 3: Implementieren**
  - `OfflineRegionBauenModal.tsx`: analog `OfflineDownloadKatalogModal` — `ladeBaubareRegionen`,
    Gruppierung nach `gruppe`, je Region „Bauen" → `starteRegionBau(slug)` (`useMutation`,
    `onSuccess` → `message.success` + Status-Query invalidieren). `App.useApp()` für `message`
    (kein statisches Modal — MEMORY „antd-statisches-modal-leakt-in-tests").
  - `OfflineKartenVerwaltung.tsx`: 4. Button in der Aktionsleiste (Zeile ~267), `disabled`/versteckt
    wenn `!karten_bau_verfuegbar`. Ein `useQuery(['admin-karte','bau-status'], ladeBauStatus,
    { refetchInterval: aktiveBauten ? 2000 : false })`; die aktiven `BauJob`s als kompakte Zeile/Tags
    über der Tabelle (Status + Slug). Kein neues Poll-Framework — dasselbe 2s-Muster wie der Download.
  - Deep-Link/UI-Form: Modal (bounded Auswahl, kurze Aktion) — konform CLAUDE.md-UI-Leitlinie.

- [ ] **Step 4: Run → pass** — Vitest PASS; `pnpm lint` (0 Warnings); `tsc --noEmit`; `pnpm build`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/karten/OfflineRegionBauenModal.tsx frontend/src/karten/OfflineKartenVerwaltung.tsx frontend/src/karten/OfflineKartenVerwaltung.test.tsx
git commit -m "feat(lfh-201): Admin-UI Region-Bau (Picker + Status-Spiegelung, feature-gated)"
```

---

## Task B6: Katalog-Nachzug (kein unbaubares DACH) + Manifest-URL-Pin

**Files:** Modify `src/config.rs` (`default_offline_katalog`, `OFFLINE_KATALOG_MANIFEST_URL`); Tests
`config`/`katalog`.

**Interfaces:**
- Produces: `default_offline_katalog()` ohne den `dach`-Platzhalter (nicht als einzelner Extrakt
  baubar, Spec §A.1) — stattdessen AT/CH einzeln (falls als Offline-Karte gewünscht) oder schlicht
  entfernt; `OFFLINE_KATALOG_MANIFEST_URL` auf die echte Object-Storage-Manifest-URL (operator-geliefert).

- [ ] **Step 1: Failing test** — der Katalog enthält keinen `dach`-Slug/Eintrag mehr, aber die
  Konsistenz-/Serde-Tests bleiben grün.

```rust
#[test]
fn katalog_ohne_unbaubares_dach() {
    assert!(!default_offline_katalog().iter().any(|e| e.url.contains("dach")),
            "DACH ist kein einzelner Extrakt (v1)");
}
```

- [ ] **Step 2: Run → fail** — `cargo test -p lifeline-hub katalog_ohne` → FAIL.

- [ ] **Step 3: Implementieren** — den `platzhalter("DACH …", …, "dach", …)`-Eintrag aus
  `default_offline_katalog()` entfernen; die bestehenden Konsistenztests
  (`katalog_eintrag_sha256_pin_konsistent_und_serialisiert`) anpassen, falls sie die Anzahl fixieren.
  `OFFLINE_KATALOG_MANIFEST_URL`: den `TODO`-Platzhalter durch die echte, operator-gelieferte
  Manifest-URL ersetzen (bis dahin bleibt der `TODO`-Platzhalter — best-effort-Fetch schlägt sauber
  fehl, compiled-in-Fallback greift; s. `katalog.rs`).

- [ ] **Step 4: Run → pass** — `cargo test -p lifeline-hub katalog` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.rs
git commit -m "feat(lfh-201): Katalog-Nachzug (kein unbaubares DACH) + Manifest-URL-Pin vorbereitet"
```

---

## Self-Review

**Spec-Coverage (§B):** §B.1 Config (URL/Token) + Manifest gepinnt → Task B1/B6; §B.2 Proxy-Trigger
(server-side Token, SSRF) → Task B2; Status-Spiegelung → Task B3/B5; §B.3 Admin-UI (4. Aktion,
feature-gated, Picker, `baut`-Status) → Task B5; §B.4 Reuse (Download/Register/Aktivieren unverändert)
→ implizit (nichts angefasst); Versionierung/Update-Check → Bestand (LFH-199); baubare-Slugs → Task B0
(`GET /regions`). Katalog-Nachzug (Spec §A.1) → Task B6.

**Placeholder-Scan:** Die Test-Skizzen mit `/* AppState … */` und `admin_stub()` sind bewusst
Repo-spezifisch (die genaue AppState-Test-Konstruktion + der `AdminUser`-Test-Stub existieren im
Repo bzw. werden in Task B1 als Helfer eingeführt) — der Umsetzer nutzt das im Repo übliche Muster.
Der Happy-Path-Forward (B2/B3) ist als integrations-getestet markiert (SSRF-Guard blockt
Loopback-Fixtures, wie LFH-183).

**Typ-Konsistenz:** `karten_service_url/-token: Option<String>` (B1) in B2/B3; `OfflineBauBody{slug}`
(B2); `service_get(&AppState, &str)` (B3); Frontend `BaubareRegion{slug,name,region,gruppe}` (=
Service-`RegionDto` aus B0) + `BauJob{id,slug,status,…}` (= Service-`BuildJob`) durchgängig B4/B5.

## Offene Umsetzungs-Details (Nicht-Blocker)

- Exakter `AppError`-Arm für 501/502 (B2/B3) an den Repo-Bestand anpassen (ggf. Varianten ergänzen).
- Den genauen Karten-Config-Handler für `karten_bau_verfuegbar` (B1) im Repo lokalisieren
  (Query-Key `['karte-config']`).
- Ob AT/CH als eigene Offline-Katalog-Einträge erscheinen sollen (B6) — Produktentscheidung; v1
  mindestens: kein unbaubares DACH.
```
