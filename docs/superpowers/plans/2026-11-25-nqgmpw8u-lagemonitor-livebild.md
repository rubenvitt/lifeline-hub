# Lagemonitor-Kachel „Livebild“ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Einsatzleitung kann das Drohnen-Livebild je Einsatz auf den Lagemonitor legen (Vorgabe aus); der Monitor zeigt es dann als stumme Kachel.

**Architecture:** Der Schalter nutzt das bestehende Flag `adapter_einsatz.lagemonitor`. `situation-monitor` meldet die Videokennungen im neuen Block `drohne`, nur bei Schalter an. Der Video-Proxy lässt den gekoppelten Lagemonitor nur bei Schalter an durch. Das Frontend zieht die HLS-Wiedergabe aus `DrohnenVideoFenster` in einen Hook und baut daraus die Kachel.

**Tech Stack:** Rust/axum/sqlx (SQLite), React/antd, hls.js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-25-nqgmpw8u-lagemonitor-livebild-design.md` (UI: `docs/design/2026-11-25-lagemonitor-livebild/`)

## Global Constraints

- Schalter Vorgabe aus; nur Einsatzleitung schaltet (`EinsatzLeitungszugriff<Lagekarte>`, schon so).
- ETB-Texte exakt: „Livebild auf dem Lagemonitor eingeschaltet“, „Livebild auf dem Lagemonitor ausgeschaltet“.
- UI-Texte exakt: „Livebild auf dem Lagemonitor“; aus: „Aus (Vorgabe): das Großbild zeigt kein Livebild.“; an: „Das Großbild zeigt das Livebild; Personen im Bild sind dort sichtbar.“; Kachel „Livebild“, leer „Kein Livebild“.
- Neuer Wire-Typ `LagemonitorDrohne { videos: Vec<String>, stand_at: String }` unter dem Feld `drohne` von `LagemonitorAnzeige`, `skip_serializing_if = "Option::is_none"`; nur der Handler `lagebild` füllt es, `verdichte` nie.
- Großbild: Text ≥ 28 px, Zahlen ≥ 72 px, keine Kachel schneidet ab, 1920 × 1080 ohne Bildlauf.
- Livebild-Zeile 440 px hoch, Kachel „Livebild“ 734 px breit, Bild 16 : 9 auf Schwarz, `muted`, `autoPlay`, `playsInline`, keine `controls`.
- Nach jeder Response-DTO-Änderung `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten.
- Commits deutsch, Body mit `Zunder: https://zunder.rubeen.dev/#/aufgabe/nqgmpw8u15lq7b7a9h2ibjkr`.

## Review Focus

- Schalter an, Einsatz danach abgeschlossen → kein Block, Proxy 404 (Task 1, 2).
- Andere Funktionsansicht (UHS-Tablet) fragt die HLS-Route → 403 über die Routenliste (Task 2).
- Gerät bei Schalter aus, Person (Admin) bei Schalter aus → Gerät 404, Person weiter durchgelassen (Task 2).
- Zweimal derselbe Wert gesendet → genau ein ETB-Eintrag (Task 3).
- Modul Lagekarte im Einsatz ausgeblendet → kein Block (Task 1).

---

### Task 1: Block `drohne` in `situation-monitor`

**Files:**
- Modify: `src/drohne/repo.rs` (neue Abfrage), `src/routes/lagemonitor.rs` (`LagemonitorAnzeige`, `lagebild`)
- Test: `tests/drohne_lagemonitor.rs` (neu; Helfer Kopplung wie `tests/geraet_kopplung.rs::lagemonitor`, Speicher wie `tests/drohne_video.rs::stand_mit_video`)

**Interfaces:**
- Produces: `repo::find_lagemonitor(conn: &mut SqliteConnection, einsatz_id: i64) -> Result<Option<Zuschaltung>, AppError>` — erste Zuschaltung (`ORDER BY zugeschaltet_at, adapter_id`) mit `lagemonitor = 1`, nur wenn der Einsatz `aktiv` ist.
- Produces: `pub struct LagemonitorDrohne { pub videos: Vec<String>, pub stand_at: String }` (Serialize, ToSchema) in `routes/lagemonitor.rs`; `LagemonitorAnzeige.drohne: Option<LagemonitorDrohne>`.

- [ ] **Step 1: Tests schreiben** (`tests/drohne_lagemonitor.rs`)
  - `ohne_schalter_kein_block`: zugeschaltet mit `lagemonitor:false`, Stand mit Video `v1` → Antwort des Monitors hat kein Feld `drohne`.
  - `mit_schalter_block_mit_videos_und_stand`: `PUT … {"lagemonitor":true}`, Stand `stand_ms = 1_764_000_000_000`, Video `v1` → `drohne.videos == ["v1"]`, `drohne.stand_at == "2025-11-24 16:00:00"` (Format wie `stand_at` der Anzeige; den Erwartungswert aus `zeit::`-Formatierer des Projekts ableiten).
  - `mit_schalter_ohne_stand_leere_liste`: kein `put` im Speicher → `drohne.videos == []`, `stand_at` = `zugeschaltet_at`.
  - `abgeschlossener_einsatz_kein_block`: Einsatz abschließen → kein `drohne` (Monitor-Sitzung endet ggf.; dann über `load_anzeige`-Pfad prüfen oder 401 akzeptieren und nur `find_lagemonitor` direkt testen).
  - `ausgeblendete_lagekarte_kein_block`: Modul `lagekarte` im Einsatz ausblenden (Weg wie in den LLH-2072-Tests in `tests/geraet_kopplung.rs`) → kein `drohne`.
- [ ] **Step 2:** `cargo test --test drohne_lagemonitor` → FAIL (Feld fehlt).
- [ ] **Step 3:** `find_lagemonitor` implementieren; in `lagebild` nach `alarm`: wenn `lagekarte` nicht in `aus`, Zuschaltung holen, `state.drohne.get(&z.adapter_id)` → `videos` aus `lage.videos[].key`, `stand_at` aus `lage.stand_ms` (sonst `z.zugeschaltet_at`). `verdichte`/`load_anzeige` setzen `drohne: None`.
- [ ] **Step 4:** `cargo test --test drohne_lagemonitor` → PASS; `cargo test --test geraet_kopplung lagemonitor` → PASS.
- [ ] **Step 5:** `scripts/check-typ-codegen.sh` (generiert `frontend/src/api/types.generated.ts` u. a.), Commit `feat: Lagemonitor erfährt das Livebild nur bei eingeschaltetem Schalter (LLH-2109)`.

### Task 2: Video-Proxy für den gekoppelten Lagemonitor

**Files:**
- Modify: `src/geraet/mod.rs` (`LAGEMONITOR`, Routenlisten-Test), `src/routes/drohne.rs::video`
- Test: `tests/drohne_lagemonitor.rs`

**Interfaces:**
- Consumes: Zuschaltung aus `repo::load_for_einsatz` (Feld `lagemonitor`).

- [ ] **Step 1: Tests schreiben**
  - `monitor_bei_schalter_aus_404`: Monitor-Cookie, Schalter aus, Stand mit `v1` → `GET …/drone/video/v1/hls/index.m3u8` = 404.
  - `monitor_bei_schalter_an_erreicht_den_abruf`: Schalter an → Status ≠ 404 und ≠ 403 (ohne Geheimnisspeicher 503, wie `ohne_zugang_503_ohne_seriennummer`).
  - `tablet_erreicht_den_proxy_nie`: UHS-Tablet-Cookie, Schalter an → 403.
  - `person_braucht_den_schalter_nicht`: Admin-Cookie, Schalter aus → 503 (wie heute).
  - In `src/geraet/mod.rs`: Test, dass `darf_route(Lagemonitor, "GET", "/api/incidents/{id}/drone/video/{key}/hls/{*file}")` gilt und für jede andere `Funktionsansicht` nicht.
- [ ] **Step 2:** Tests laufen lassen → FAIL.
- [ ] **Step 3:** Route in `LAGEMONITOR`; in `video` nach dem Zuschaltungs-Check: `if ctx.geraet.is_some() && !z.lagemonitor { return Err(AppError::NotFound) }`.
- [ ] **Step 4:** `cargo test --test drohne_lagemonitor --test drohne_video --test geraet_routen_guard` und `cargo test --lib geraet::` → PASS.
- [ ] **Step 5:** Commit `feat: Lagemonitor liest das Livebild über den Proxy, nur bei Schalter an (LLH-2109)`.

### Task 3: ETB beim Umschalten

**Files:**
- Modify: `src/routes/drohne.rs::zuschalten`
- Test: `tests/drohne_quellen.rs`

- [ ] **Step 1: Tests schreiben** (Helfer `common::system_etb_inhalte`)
  - `schalter_an_und_aus_steht_im_etb`: zuschalten (`false`), dann `true`, dann `false` → Inhalte enthalten in Folge „Drohnenbild aus Suchlage zugeschaltet“, „Livebild auf dem Lagemonitor eingeschaltet“, „Livebild auf dem Lagemonitor ausgeschaltet“.
  - `gleicher_wert_kein_neuer_eintrag`: `true` zweimal → „eingeschaltet“ genau einmal.
  - `neu_zuschalten_mit_schalter_an_zwei_eintraege`: erster PUT mit `true` → „zugeschaltet“, dann „eingeschaltet“.
- [ ] **Step 2:** `cargo test --test drohne_quellen` → FAIL.
- [ ] **Step 3:** In der Transaktion: `vorher_wert = vorher.as_ref().map(|v| v.lagemonitor).unwrap_or(false)`; wenn `body.lagemonitor != vorher_wert` zweiter `system_audit_tx`. Rückgabe auf `Vec<i64>` der ETB-IDs umstellen, alle `state.live.publiziere`.
- [ ] **Step 4:** `cargo test --test drohne_quellen` → PASS.
- [ ] **Step 5:** Commit `feat: Ein- und Ausschalten des Livebilds am Lagemonitor steht im ETB (LLH-2109)`.

### Task 4: Schalter an der Lagekarte

**Files:**
- Modify: `frontend/src/pages/lagekarte/DrohnenQuelle.tsx`
- Test: `frontend/src/pages/lagekarte/DrohnenQuelle.test.tsx`

**Interfaces:**
- Consumes: `useDrohnenQuelleZuschalten` (bestehende Mutation, `{ adapterId, lagemonitor }`).

- [ ] **Step 1: Tests schreiben**
  - „Einsatzleitung schaltet das Livebild auf den Lagemonitor“: zugeschaltete Quelle mit `lagemonitor:false` → `getByRole('switch', { name: 'Livebild auf dem Lagemonitor' })` nicht gedrückt, Text „Aus (Vorgabe): das Großbild zeigt kein Livebild.“; Klick → PUT mit `{ lagemonitor: true }`.
  - „an zeigt den Hinweis auf Personen“: `lagemonitor:true` → Schalter gedrückt, Text „Das Großbild zeigt das Livebild; Personen im Bild sind dort sichtbar.“; Klick → PUT `{ lagemonitor: false }`.
  - „ohne Leitung kein Schalter, aber der Zustand“: `darfSchalten=false` → kein `switch`, Text des Zustands steht.
  - „nicht zugeschaltete Quelle hat keinen Schalter“.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend vitest run src/pages/lagekarte/DrohnenQuelle.test.tsx` → FAIL.
- [ ] **Step 3:** antd `Switch` mit `aria-label`/sichtbarer Beschriftung im `<label>`, `loading` während der Mutation, Zeile darunter mit `aria-describedby`.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** Commit `feat: Schalter „Livebild auf dem Lagemonitor“ an der Drohnenquelle (LLH-2109)`.

### Task 5: HLS-Wiedergabe als Hook

**Files:**
- Create: `frontend/src/pages/lagekarte/useHlsWiedergabe.ts`
- Modify: `frontend/src/pages/lagekarte/DrohnenVideoFenster.tsx`
- Test: bestehend `DrohnenVideoFenster.test.tsx` (unverändert grün)

**Interfaces:**
- Produces: `useHlsWiedergabe(einsatzId: number, videoKey: string | null, videoRef: RefObject<HTMLVideoElement | null>): 'laedt' | 'laeuft' | 'kein'` — der bisherige Effekt samt Wiederholung (`wiederholNachMs` bleibt exportiert aus `DrohnenVideoFenster.tsx` oder zieht mit um; Importe anpassen).

- [ ] **Step 1:** Effekt und Zustand unverändert in den Hook verschieben; das Fenster ruft ihn.
- [ ] **Step 2:** `vitest run src/pages/lagekarte/DrohnenVideoFenster.test.tsx` → PASS ohne Teständerung.
- [ ] **Step 3:** Commit `refactor: HLS-Wiedergabe des Livebilds als Hook (LLH-2109)`.

### Task 6: Kachel „Livebild“ und Kachelung

**Files:**
- Create: `frontend/src/geraet/LagemonitorLivebild.tsx`
- Modify: `frontend/src/geraet/LagemonitorPage.tsx` (Kachel `Kachel` exportieren oder als Prop-Slot nutzen; linke Spalte)
- Test: `frontend/src/geraet/LagemonitorPage.test.tsx`

**Interfaces:**
- Consumes: `useHlsWiedergabe` (Task 5), `LagemonitorAnzeige.drohne` (Task 1), `istVeraltet` (bestehend).
- Produces: `LagemonitorLivebild({ einsatzId, drohne, jetzt }: { einsatzId: number; drohne: LagemonitorDrohne; jetzt: number })`.

- [ ] **Step 1: Tests schreiben** (`hls.js` wie in `DrohnenVideoFenster.test.tsx` gemockt)
  - „ohne Block keine Kachel Livebild“: `queryByRole('region', { name: 'Livebild' })` null.
  - „mit Block und Video steht die Kachel mit stummem Video ohne Bedienung“: `video.muted === true`, kein `controls`-Attribut.
  - „mit leerer Liste: Kein Livebild, kein Eintrag in Was brennt“.
  - „Datenstand älter als 2 Minuten in Achtungsfarbe“ (wie bestehender Test für die Statusleiste).
  - „ohne Meldungen und Ablauf nimmt Livebild die Zeile allein“.
- [ ] **Step 2:** `vitest run src/geraet/LagemonitorPage.test.tsx` → FAIL.
- [ ] **Step 3:** Kachel bauen (Titel + Datenstand als `zusatz`, Fläche schwarz, `aspectRatio: '16 / 9'`, „Kein Livebild“ in `GROSS_BEZUG.text`); in `LagemonitorPage` bei `lage?.drohne` die untere Zeile durch `height: 440` mit `KachelGrenze titel="Livebild" form="gross"` (Breite 734) und rechts Meldungen über Ablauf (Spalte, `flex: 1 1 0`) ersetzen; ohne Block alles wie heute.
- [ ] **Step 4:** Test → PASS; `vitest run src/geraet` → PASS.
- [ ] **Step 5:** Commit `feat: Kachel „Livebild“ auf dem Lagemonitor (LLH-2109)`.

### Task 7: e2e und Regel

**Files:**
- Modify: `frontend/e2e/geraet-lagemonitor.spec.ts`, `frontend/src/geraet/AGENTS.md` (Abschnitt Lagemonitor)

- [ ] **Step 1:** Im bestehenden Test (oder einem zweiten) per `page.route` die Antwort von `situation-monitor` um `drohne: { videos: ['v1'], stand_at }` ergänzen und `**/drone/video/**` mit 503 beantworten → Kachel „Livebild“ mit „Kein Livebild“ sichtbar, die Prüfung „keine Kachel schneidet ihren Inhalt ab“ und „kein Bildlauf“ grün; ohne Ergänzung keine Kachel.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec playwright test e2e/geraet-lagemonitor.spec.ts --trace off` → PASS.
- [ ] **Step 3:** Regel nach Spec §5.6 in `frontend/src/geraet/AGENTS.md` einfügen (Satz nach „Seine Zahlen kommen nur aus …“).
- [ ] **Step 4:** Commit `test,docs: Lagemonitor mit Livebild im e2e, Regel zweite Quelle (LLH-2109)`.

### Task 8: Abschluss

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] `verify` für die Lagekarte (Schalter) und Bilder der Änderung.
- [ ] Review-Agent (Anlass: gekoppelte Geräte, Berechtigung).
