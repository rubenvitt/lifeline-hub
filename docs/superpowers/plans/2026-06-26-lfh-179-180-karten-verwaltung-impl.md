# LFH-179 + LFH-180 — Umsetzungsplan (Karten-Verwaltung Backend + Online-Frontend)

**Datum:** 2026-06-26 · **Epic:** LFH-178 · **Branch:** feat/lfh-178-karten-verwaltung
**Design (abgenommen):** `docs/superpowers/specs/2026-06-26-karten-verwaltung-admin-ui-design.md`

Basis: Design-Workflow-Sieger **„db-direkt-sauber"** (fresh-from-DB pro Request wie `benutzer.rs`,
kein Cache) + Nutzer-Entscheidungen vom 2026-06-26.

## Abweichungen vom abgenommenen Design (Nutzer-Entscheidung 2026-06-26)

1. **Backend vollständig jetzt** (inkl. Offline-CRUD-Endpunkte), obwohl das Offline-Manager-
   *Frontend* erst LFH-181 ist → Vermerk in LFH-181.
2. **Kein ENV-Seeding; ENV-Kartenkonfig entfällt ganz.** Die DB startet leer; Quellen kommen
   ausschließlich über die Admin-UI / den Katalog (`default_online_styles`). Karte startet
   **blind, bis ein Admin aus dem Katalog hinzufügt** (statt eingebauter Shortlist out-of-box).
   Konsequenz bewusst akzeptiert (Prep-Phasen-System, trivial reversibel).
3. **`karten_dir`** wird aus `db_path` abgeleitet (`<dir>/karten`), **keine eigene ENV/CLI-Option**.

## LFH-179 — Backend (TDD)

### Migration `migrations/0076_karte_registry.sql` (0075 ist höchste; vor Merge re-prüfen)
- `karte_online_quelle`: id PK; name NOT NULL; url NOT NULL; typ NOT NULL DEFAULT 'vektor'
  CHECK(typ IN('vektor','raster')); attribution TEXT; sortier INT NOT NULL DEFAULT 0;
  aktiv INT NOT NULL DEFAULT 1 CHECK(aktiv IN(0,1)) [enabled/soft-delete];
  erstellt_at/geaendert_at TEXT NOT NULL DEFAULT (datetime('now')).
- `karte_offline_karte`: id PK; name NOT NULL; pfad NOT NULL (absolut ODER relativ zu karten_dir);
  quell_url TEXT; lizenz TEXT; kachel_schema TEXT NOT NULL DEFAULT 'protomaps' (OHNE CHECK,
  erweiterbar); groesse INT; sha256 TEXT; download_at TEXT; status TEXT NOT NULL DEFAULT 'bereit'
  CHECK(status IN('registriert','laedt','bereit','fehler')); aktiv_basemap INT NOT NULL DEFAULT 0
  CHECK(aktiv_basemap IN(0,1)); erstellt_at/geaendert_at.
- `CREATE UNIQUE INDEX idx_offline_eine_aktive ON karte_offline_karte(aktiv_basemap) WHERE aktiv_basemap=1`.
- **Kein Daten-Seed.** Rein additiv (kein CHECK-Rebuild). Kommentar: global/kein org_id, weil
  config/tiles unauthentifiziert sind.

### `src/config.rs`
- ENTFERNEN: `struct KarteConfig`; CLI/ENV-Args `pmtiles_path`, `karte_online_style_url`,
  `karte_styles`; `fn online_styles_aufloesen` + Tests (`aufloesen_*`); Tests
  `karte_flags_werden_geparst`, `default_karte_config_ist_leer_blind`.
- BEHALTEN: `OnlineStyle`, `OnlineStyleTyp`, `default_online_styles` (Katalog-Quelle).
- NEU: `default_karten_dir(db_path: &str) -> PathBuf` (= Parent(db_path)/karten; ohne Parent → ./karten).

### `src/karte/registry/` (neu, in `karte/mod.rs` + lib registrieren)
- `repo.rs`: online-CRUD + offline-CRUD-Queries (runtime-queries, Muster `benutzer.rs`).
  FromRow-Helfer `OnlineStyleRow{name,url,typ:String,attribution:Option<String>} -> OnlineStyle`.
- **Kein `seed.rs`.**

### `src/app.rs`
- `AppState` += `pub karten_dir: PathBuf`.
- `build_router_mit_karte` + Default-Wrapper → ein `build_router(state)`.
- Entfernen: `use KarteConfig`, `use ServeFile` (wandert nach routes/karte.rs),
  `.layer(Extension(karte))`, konditionaler match-Block (357-360).
- `/api/karte/tiles.pmtiles` unkonditional → `get(routes::karte::tiles)`.
- Admin-Routen mounten.

### `src/routes/karte.rs`
- `config(State<AppState>) -> Result<Json<KarteConfigAntwort>, AppError>`: SELECT online_styles
  WHERE aktiv=1 ORDER BY sortier,id; pmtiles_verfuegbar = EXISTS(aktiv_basemap=1 AND status='bereit');
  pmtiles_url. **Response-Shape BYTE-IDENTISCH** (frontend/src/api/karte.ts).
- `tiles(State, Request) -> Result<Response, AppError>`: SELECT pfad WHERE aktiv_basemap=1 AND
  status='bereit' LIMIT 1; None→404; Pfad auflösen (is_absolute? direkt : karten_dir.join);
  **Traversal-Guard** (keine `..`); `ServeFile::new(p).oneshot(req).await` → Body::new. `tiles_fehlt` löschen.
- **Admin-CRUD (AdminUser, 400/409/422 per error.rs):**
  - online: `GET /api/karte/online-quellen`, `POST …`, `PATCH …/{id}`, `DELETE …/{id}`,
    `GET …/online-quellen/katalog` (aus `default_online_styles` — **180 braucht das**).
  - offline: `GET /api/karte/offline-karten`, `POST …` (register),
    `POST …/offline-karten/{id}/aktivieren` (**TX: erst alle aktiv_basemap=0, dann diese=1**),
    `DELETE …/{id}`. Download bleibt LFH-181.

### `src/main.rs`
- KarteConfig-Block raus; `karten_dir = default_karten_dir(&config.db_path)` + `create_dir_all`;
  `build_router(state)`.

### `Cargo.toml`
- `tower` (feature `util`) von `[dev-dependencies]` → `[dependencies]`.

### Tests
- `tests/karte.rs`: 4 Tests auf DB-Seeding umstellen (**JSON-Assertions eingefroren lassen**);
  KarteConfig/build_router_mit_karte-Imports raus; `karten_dir` an AppState-Stellen.
- `karten_dir`-Feld an allen ~45 AppState-Konstruktionsstellen (Tests; temp_dir wo /tiles unberührt).
- Neue Tests: repo/CRUD-Unit (online+offline), Handler-Tests inkl. **aktivieren-Exklusivität**,
  katalog-Endpunkt, Traversal-Guard.

### Docs
- `docs/betrieb/packaging.md`: 3 Karte-ENV-Zeilen raus, auf Admin-UI verweisen.
- Design-Doc: datierter Nachtrag (ENV/Seed entfällt).

## LFH-180 — Online-Frontend (nach 179, Pfade an 179 gepinnt)
- `frontend/src/api/onlineQuellen.ts` (einziger Seam): `OnlineQuelle{id,name,url,typ,attribution,sortier}`
  + liste/lege/aktualisiere/loesche/ladeKatalog.
- `/admin/karten` eigene Seite (nicht Stammdaten-Tab): AdminLayout Tab + **activeKey-Fix**
  (startsWith-Heuristik → Segment-Match), App.tsx-Route, AdminLayout.test 3. Tab.
- `KartenVerwaltungPage` → `OnlineQuellenVerwaltung` (antd Table + react-query) +
  `OnlineQuelleFormModal` (Form-in-Modal: name/url/typ/attribution **required**/sortier;
  Key-Anbieter-Alert; typ-abh. URL-Hinweis) + `AusKatalogModal` (server-autoritativ).
- Schreibrechte admin-only (fuehrungskraft read-only). Mutationen invalidieren `['admin-karte']`
  UND `['karte-config']` (Live-Map-Sync).
- Tests Vitest/RTL+msw (renderMitProviders/AntApp; combobox-Select; Pflicht-Attribution-Block;
  `--no-file-parallelism`).

## Gates
- Backend: `rtk proxy cargo test`, `rtk proxy cargo clippy --all-targets -- -D warnings`.
- Frontend: `pnpm lint` (--max-warnings 0), `tsc --noEmit`, `vitest run --no-file-parallelism`
  (via `mise exec pnpm@<ver> -- pnpm -C <abs> …`).
- Commits referenzieren `LFH-179` / `LFH-180`.
