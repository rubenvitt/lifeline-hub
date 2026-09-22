# Dokumentenablage (LFH-632) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein neues Fachmodul „Dokumente“ (Kategorie Führung): Dateien je Einsatz ablegen (Upload mit Kategorie, Titel, optionalem Bezug), gefiltert listen, herunterladen und soft-löschen — einsatz- und modulgebunden, AV-gescannt, mit System-ETB-Nachweis.

**Architecture:** Die Bytes bleiben in der bestehenden `anhang`-Tabelle (BLOB, Scan, ETag, Backup). Eine neue Metadaten-Tabelle `einsatz_dokument` ist der **zweite Linker** auf `anhang` (1:1, `anhang_id UNIQUE`). Die drei heute chat-lokalen Linker-Stellen (Orphan-Sweep, Tombstone-Download-Sperre, Chat-Verknüpfung) werden dafür verallgemeinert, **bevor** das erste Dokument entstehen kann. Eigene Routen unter `/api/einsaetze/{id}/dokumente` mit Modul-Marker `Dokumente`. Die generischen `/anhaenge`-Routen verweigern dokument-gebundene Anhänge, sonst wären sie ein Modul-Gate-Bypass. Frontend: Seite nach dem Vorbild `SchaedenPage` (EinsatzSeite + Datensicht), Ablegen über `ErfassungsModal`.

**Tech Stack:** Rust/axum/sqlx (SQLite), utoipa-Codegen → TypeScript, React/antd 6, TanStack Query, Vitest, Playwright.

**Spec:** ClickUp LFH-632 (Beschreibung unten wörtlich zusammengefasst) plus Entscheidungen des Menschen vom 22.09.2026 (Abschnitt „Entscheidungen“). Scope-Map: fünf Reader-Agenten (Anhang-Backend, Modul-Registry, ETB/Live, Frontend-Muster, Entwurf).

> LFH-632: Dokumentenablage je Einsatz: Upload, Kategorie (Lagekarte/Plan, Befehl, Formular, Foto, Sonstiges), Titel, Bezug (optional: Abschnitt/Einheit/ETB-Eintrag), Verfasser, Zeit. Wiederverwendung der Anhang-Infrastruktur mit AV-Scan. Die Anhang-Freigabe nach Chat-Tombstone (LFH-116) muss einen zweiten Linker berücksichtigen. Eintrag in der Modul-Registry (Führung) plus Backend-`MODUL_KEYS`/`PFAD_KEY`. ETB-Kopplung beim Ablegen (Pattern B). **AK:** ablegen, filtern, herunterladen; einsatzgebunden (fremder Einsatz → 404); Seite hat die Prüfliste Einsatztauglichkeit.

## Entscheidungen

| # | Frage | Entscheidung | Quelle |
|---|---|---|---|
| E1 | Löschen | **Soft-Delete** (`geloescht_at`, `geloescht_von_id`), darf jeder mit Einsatz-Schreibrecht; im UI eine Rückfrage per `Popconfirm` mit `okButtonProps={{ danger: true }}`, weil aus Bediensicht unumkehrbar | Mensch |
| E2 | ETB | **Jedes Ablegen** erzeugt in derselben Transaktion einen ETB-Eintrag vom Typ **`system`** über `etb::system_audit_tx`. Das Entfernen erzeugt ebenfalls einen, als Beweisspur | Mensch (+ Entfernen abgeleitet) |
| E3 | Umfang | **Nur hochgeladene Dateien**; **Zähler im Modulpanel** aus der Listen-Query (Anzahl nicht gelöschter Dokumente) | Mensch |
| E4 | Formate | Für Dokumente zusätzlich **HEIC/HEIF und TIFF**; Limit bleibt 25 MiB. Chat-Allowlist unverändert | Mensch |
| E5 | AK „fremder Einsatz → 404“ | = *Dokument-ID eines anderen Einsatzes → 404* (Ownership-Query `AND einsatz_id = ?`). Eine fremde **Org** bleibt 403 aus dem Extractor (Bestand aller Module) | abgeleitet |
| E6 | Upload-Form | **Ein** Multipart-Request (Datei + Metadaten), Vorbild `karte_hintergrundbild::hochladen`. Kein zweistufiger Upload, also kein Orphan-Fenster | abgeleitet |
| E7 | Bezug | Drei nullable FK-Spalten mit Zähl-CHECK ≤ 1 (Muster `einsatz_schaden`), `ON DELETE SET NULL` für Abschnitt/Einheit (die werden hart gelöscht, LFH-237). Einsatzzugehörigkeit prüft der Handler, fremdes Ziel → 400 | abgeleitet |
| E8 | Generische Anhang-Routen | Ein **dokument-gebundener** Anhang ist über `/anhaenge/{aid}` nicht ladbar (404) und nicht löschbar (422). Eine Chat-Nachricht kann ihn nicht verknüpfen (400) | abgeleitet |
| E9 | FK `einsatz_dokument.anhang_id` | `ON DELETE CASCADE`: die Schwärzung löscht `anhang` per `ZeileLoeschen`, mit RESTRICT schlüge sie fehl. Der generische DELETE ist durch E8 gesperrt, also reißt nichts ungewollt mit | abgeleitet |
| E10 | Tabellenname | `einsatz_dokument` (Konvention `einsatz_schaden`, `einsatz_einheit`, `einsatz_stabsfunktion`) | abgeleitet |

## Global Constraints

- Integrationsbasis ist `origin/alpha`. PR mit `--base alpha`.
- Deutsche Texte mit echten Umlauten; Bezeichner, Dateinamen und Wire-Werte ASCII.
- Wire-Werte `DokumentKategorie`: `lagekarte_plan`, `befehl`, `formular`, `foto`, `sonstiges` (in dieser Reihenfolge; das ist die Anzeigereihenfolge). Labels: „Lagekarte/Plan“, „Befehl“, „Formular“, „Foto“, „Sonstiges“.
- Wire-Werte `bezug_typ` (nur Eingabe): `abschnitt`, `einheit`, `etb_eintrag`.
- Modul-Key `dokumente`, Marker-Typ `Dokumente`, LiveEvent `Dokument` mit Wire `dokument`, Query-Key-Prefix `einsatz-dokumente`, FE-Route `dokumente`.
- Statuscodes nach CLAUDE.md: unbekannter Enum-Wert / fehlendes oder leeres Pflichtfeld / zu langer Titel → **400**; `bezug_typ` ohne `bezug_id` (oder umgekehrt) → **422**; fremdes Bezugsziel → **400** (Präzedenz `chat::bezug_setzen`); fremde oder gelöschte Dokument-ID → **404**; abgeschlossener Einsatz beim Schreiben → **409** (Extractor).
- `TITEL_MAX = 200` Zeichen (nach `trim`).
- Handler-Bodies nur `JsonBody`, IDs nur `PfadParam`. Multipart ist kein JSON-Body und bleibt `axum::extract::Multipart`.
- Response-DTO: `Option<T>`-Felder mit `#[serde(skip_serializing_if = "Option::is_none")]`.
- Kein neues punktuelles `size=` an interaktiven antd-Elementen, kein Emoji als Ikone, keine Inline-Query-Keys, keine Inline-Einsatz-Pfade.
- Gate-Kommandos ohne `| tail`. `rtk` wird im Hauptloop verwendet, in Subagenten-/Hintergrund-Shells fehlt es: dort die Befehle ohne `rtk` ausführen.
- pnpm: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-lfh-78-0056aa/frontend <cmd>` (immer absoluter `-C`-Pfad).
- Migrationsnummer `0104` **unmittelbar vor dem Merge** erneut gegen `origin/alpha` prüfen (`git fetch && git ls-tree origin/alpha migrations/ | tail -3`).

## Datei-Landkarte

| Datei | Verantwortung | Task |
|---|---|---|
| `migrations/0104_einsatz_dokument.sql` | Tabelle + Index | 1 |
| `src/anhang/repo.rs` | `LinkerStand`, `linker_stand`, Sweep mit zweitem Linker, `anlegen_tx` | 1 |
| `src/anhang/mod.rs` | `ERLAUBTE_MIME_DOKUMENT`, `ermittle_mime_fuer(…)` | 2 |
| `src/routes/anhang.rs` | Download-/Delete-Sperre für Dokument-Anhänge | 1 |
| `src/chat/repo.rs` | Tombstone-Funktion entfernt (nach `anhang::repo` gehoben), Link-Guard | 1 |
| `src/einsatz/schwaerzung_registry.rs` | Regel `einsatz_dokument` | 1 |
| `src/dokument/mod.rs` | `DokumentKategorie`, `DokumentAnzeige`, Konstanten | 2 |
| `src/dokument/repo.rs` | anlegen (Tx: anhang + dokument + ETB), liste, laden, download_meta, entfernen | 2 |
| `src/routes/dokument.rs` | 4 Handler | 2 |
| `src/lib.rs`, `src/routes/mod.rs`, `src/app.rs`, `src/zulassung.rs`, `src/einsatz/modul.rs`, `src/live/mod.rs`, `src/api_doc.rs` | Registrierung | 2 |
| `tests/dokument.rs` | Integrationstests | 2 |
| `tests/modul_override.rs`, `tests/enum_wire_kontrakt.rs` | Guard-Nachzüge | 2 |
| `frontend/src/einsatz/modulRegistry.ts` (+ `.test.ts`), `sprungmarken.test.ts` | Registry-Eintrag + Pins | 2 (Eintrag), 3 (Zähler) |
| `frontend/src/api/queryKeys.ts` (+ `.test.ts`) | Keys + Stream-Mapping | 2 |
| `frontend/src/api/openapi.json`, `types.generated.ts`, `types.ts` | Codegen | 2 |
| `frontend/src/api/client.ts` | `apiUpload`-Timeout parametrisierbar | 3 |
| `frontend/src/api/dokumente.ts` (+ `.test.ts`) | API-Funktionen + Download-Pfad | 3 |
| `frontend/src/routing/deeplinks.ts` (+ `.test.ts`) | `dokumentePfad` | 3 |
| `frontend/src/einsatz/useModulZaehler.ts` (+ Test) | Zähler `dokumente` | 3 |
| `frontend/src/dokumente/kategorien.ts` | Kategorie-Labels (Record über das Enum) | 3 |
| `frontend/src/dokumente/DokumentAblegenModal.tsx` (+ `.test.tsx`) | Erfassung | 4 |
| `frontend/src/pages/DokumentePage.tsx` (+ `.test.tsx`) | Seite | 4 |
| `frontend/src/App.tsx`, `components/datensicht.guard.test.ts` | Element + Guard-Konsument | 4 |
| `e2e/dokumente.spec.ts` | Browser-Nachweis Ablegen/Filtern/Herunterladen | 5 |
| `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md` | Prüfliste Einsatztauglichkeit | 5 |

---

### Task 1: Zweiter Linker auf `anhang` (Sweep, Download-Sperre, Chat-Guard) + Tabelle

Der Datenverlustpfad kommt zuerst. Ohne diesen Task löscht der Purge-Scheduler jedes Dokument 24 h nach dem Upload, still und ohne roten Test.

**Files:**
- Create: `migrations/0104_einsatz_dokument.sql`
- Modify: `src/anhang/repo.rs` (Sweep `:135-160`, neue `LinkerStand`/`linker_stand`/`anlegen_tx`, Tests)
- Modify: `src/chat/repo.rs:394-420` (Funktion entfernen), `:276-288` (Link-Guard)
- Modify: `src/routes/anhang.rs:69-129` (Download), `:131-141` (Delete)
- Modify: `src/einsatz/schwaerzung_registry.rs` (neue Regel direkt hinter `anhang`, `:494`)
- Test: `src/anhang/repo.rs` (Unit), `tests/anhang.rs` (Integration)

**Interfaces:**
- Produces:
  - `pub struct LinkerStand { pub chat_gesamt: i64, pub chat_lebend: i64, pub dokument_gesamt: i64 }` mit `pub fn ist_dokument(&self) -> bool` und `pub fn generischer_download_gesperrt(&self) -> bool`
  - `pub async fn linker_stand(pool: &SqlitePool, anhang_id: i64) -> Result<LinkerStand, AppError>`
  - `pub async fn anlegen_tx(conn: &mut SqliteConnection, einsatz_id: i64, hochgeladen_von: i64, dateiname: &str, mime: &str, daten: &[u8]) -> Result<i64, AppError>` (liefert die neue `anhang.id`)
  - Tabelle `einsatz_dokument` (Spalten siehe Step 1)

- [ ] **Step 1: Migration schreiben**

`migrations/0104_einsatz_dokument.sql`:

```sql
-- LFH-632: Dokumentenablage je Einsatz. Die Bytes liegen in `anhang` (BLOB, AV-Scan,
-- ETag, Backup); diese Tabelle ist der ZWEITE Linker auf `anhang` neben
-- `chat_nachricht_anhang`. 1:1 (anhang_id UNIQUE): ein Dokument, eine Datei.
--
-- anhang_id ON DELETE CASCADE: die DSGVO-Schwärzung löscht `anhang` per ZeileLoeschen —
-- mit RESTRICT schlüge sie fehl. Der generische DELETE /anhaenge/{aid} verweigert
-- dokument-gebundene Anhänge (422), deshalb reißt die CASCADE nichts ungewollt mit.
--
-- Bezug: höchstens EINES von Abschnitt/Einheit/ETB-Eintrag. Abschnitt und Einheit werden
-- hart gelöscht → ON DELETE SET NULL (sonst blockiert der FK deren Löschen, LFH-237).
-- Die Einsatzzugehörigkeit des Ziels prüft der Handler; die FKs sichern sie nicht.
--
-- Soft-Delete (geloescht_at): Beweissicherung, die Datei bleibt bis zum Einsatz-Purge.
CREATE TABLE einsatz_dokument (
    id                   INTEGER PRIMARY KEY,
    einsatz_id           INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    anhang_id            INTEGER NOT NULL UNIQUE REFERENCES anhang(id) ON DELETE CASCADE,
    kategorie            TEXT    NOT NULL
        CHECK (kategorie IN ('lagekarte_plan','befehl','formular','foto','sonstiges')),
    titel                TEXT    NOT NULL,
    bezug_abschnitt_id   INTEGER REFERENCES einsatzabschnitt(id) ON DELETE SET NULL,
    bezug_einheit_id     INTEGER REFERENCES einsatz_einheit(id) ON DELETE SET NULL,
    bezug_etb_eintrag_id INTEGER REFERENCES etb_eintrag(id),
    etb_eintrag_id       INTEGER NOT NULL REFERENCES etb_eintrag(id),
    abgelegt_von_id      INTEGER NOT NULL REFERENCES benutzer(id),
    abgelegt_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    geloescht_at         TEXT,
    geloescht_von_id     INTEGER REFERENCES benutzer(id),
    CHECK ((bezug_abschnitt_id IS NOT NULL)
         + (bezug_einheit_id IS NOT NULL)
         + (bezug_etb_eintrag_id IS NOT NULL) <= 1)
);
CREATE INDEX idx_einsatz_dokument_einsatz ON einsatz_dokument(einsatz_id, abgelegt_at);
```

- [ ] **Step 2: Schwärzungsregel ergänzen** (sonst wird `jede_einsatz_scoped_spalte_ist_klassifiziert` rot)

In `src/einsatz/schwaerzung_registry.rs` direkt nach der `anhang`-Regel:

```rust
    TabellenRegel {
        // LFH-632: ganze Zeile löschen wie `anhang` — der Titel ist Freitext (kann PII tragen,
        // „Foto Familie Müller“), und die Datei, die die Zeile beschreibt, ist ohnehin weg
        // (CASCADE von `anhang`). Der ETB-Nachweis („Dokument abgelegt: …“) folgt der
        // ETB-Regel (G_ETB), nicht dieser.
        tabelle: "einsatz_dokument",
        scoping: Scoping::EinsatzId,
        zeilenfilter: None,
        spalten: &[
            scrub("id", Strategie::ZeileLoeschen),
            scrub("einsatz_id", Strategie::ZeileLoeschen),
            scrub("anhang_id", Strategie::ZeileLoeschen),
            scrub("kategorie", Strategie::ZeileLoeschen),
            scrub("titel", Strategie::ZeileLoeschen),
            scrub("bezug_abschnitt_id", Strategie::ZeileLoeschen),
            scrub("bezug_einheit_id", Strategie::ZeileLoeschen),
            scrub("bezug_etb_eintrag_id", Strategie::ZeileLoeschen),
            scrub("etb_eintrag_id", Strategie::ZeileLoeschen),
            scrub("abgelegt_von_id", Strategie::ZeileLoeschen),
            scrub("abgelegt_at", Strategie::ZeileLoeschen),
            scrub("geloescht_at", Strategie::ZeileLoeschen),
            scrub("geloescht_von_id", Strategie::ZeileLoeschen),
        ],
    },
```

Reihenfolge: die Regel läuft nach `anhang`. Deren CASCADE hat die Zeilen dann schon entfernt, der DELETE trifft 0 Zeilen. Das ist korrekt und idempotent.

- [ ] **Step 3: Fehlschlagende Unit-Tests in `src/anhang/repo.rs` schreiben**

Im bestehenden `mod tests` einen Helfer und drei Tests ergänzen:

```rust
    /// Hängt einen Anhang als Dokument an (direkter INSERT, inkl. ETB-Pflicht-FK).
    async fn als_dokument(pool: &SqlitePool, einsatz_id: i64, von: i64, anhang_id: i64, geloescht: bool) {
        let etb_id: i64 = sqlx::query_scalar(
            "INSERT INTO etb_eintrag (einsatz_id, lfd_nr, typ, inhalt, erfasser_id) \
             VALUES (?, (SELECT COALESCE(MAX(lfd_nr), 0) + 1 FROM etb_eintrag WHERE einsatz_id = ?), \
                     'system', 'Dokument abgelegt', ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(einsatz_id)
        .bind(von)
        .fetch_one(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO einsatz_dokument \
               (einsatz_id, anhang_id, kategorie, titel, etb_eintrag_id, abgelegt_von_id, geloescht_at) \
             VALUES (?, ?, 'foto', 'Titel', ?, ?, CASE WHEN ? THEN datetime('now') END)",
        )
        .bind(einsatz_id)
        .bind(anhang_id)
        .bind(etb_id)
        .bind(von)
        .bind(geloescht)
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn sweep_verwaiste_haelt_dokument_gebundene_anhaenge() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;
        let dok = anhang_mit_zeit(&pool, einsatz, von, "plan.pdf", "2026-01-01 00:00:00").await;
        let geloeschtes_dok =
            anhang_mit_zeit(&pool, einsatz, von, "alt.pdf", "2026-01-01 00:00:00").await;
        als_dokument(&pool, einsatz, von, dok, false).await;
        als_dokument(&pool, einsatz, von, geloeschtes_dok, true).await;

        let geloescht = sweep_verwaiste(&pool, t("2026-06-16 00:00:00")).await.unwrap();

        assert_eq!(geloescht, 0, "ein Dokument ist kein Orphan — auch ein soft-gelöschtes nicht");
        assert!(anzeige_laden(&pool, dok).await.is_ok());
        assert!(anzeige_laden(&pool, geloeschtes_dok).await.is_ok());
    }

    #[tokio::test]
    async fn linker_stand_zaehlt_beide_linker() {
        let pool = crate::db::test_pool().await;
        let (von, einsatz) = setup(&pool).await;
        let frei = anhang_mit_zeit(&pool, einsatz, von, "a.pdf", "2026-01-01 00:00:00").await;
        let dok = anhang_mit_zeit(&pool, einsatz, von, "b.pdf", "2026-01-01 00:00:00").await;
        als_dokument(&pool, einsatz, von, dok, false).await;

        let s = linker_stand(&pool, frei).await.unwrap();
        assert_eq!((s.chat_gesamt, s.chat_lebend, s.dokument_gesamt), (0, 0, 0));
        assert!(!s.ist_dokument());
        assert!(!s.generischer_download_gesperrt(), "verwaist bleibt ladbar (Upload→Senden)");

        let s = linker_stand(&pool, dok).await.unwrap();
        assert_eq!(s.dokument_gesamt, 1);
        assert!(s.ist_dokument());
        assert!(s.generischer_download_gesperrt(), "Dokument-Anhang nur über die Modul-Route");
    }

    #[test]
    fn generischer_download_gesperrt_folgt_dem_chat_tombstone() {
        let nur_tot = LinkerStand { chat_gesamt: 2, chat_lebend: 0, dokument_gesamt: 0 };
        let einer_lebt = LinkerStand { chat_gesamt: 2, chat_lebend: 1, dokument_gesamt: 0 };
        assert!(nur_tot.generischer_download_gesperrt());
        assert!(!einer_lebt.generischer_download_gesperrt());
    }
```

Hinweis: vor dem Schreiben die Pflichtspalten von `etb_eintrag` in `migrations/0004_etb.sql` gegenprüfen. Kennt der INSERT eine Spalte nicht oder fehlt eine NOT-NULL-Spalte ohne Default, den INSERT anpassen. Die Aussage des Tests bleibt dieselbe.

- [ ] **Step 4: Tests laufen lassen, Fehlschlag sehen**

Run: `cargo test --lib anhang::repo::tests`
Expected: Kompilierfehler (`linker_stand`/`LinkerStand` unbekannt). Nach einem Stub: `sweep_verwaiste_haelt_dokument_gebundene_anhaenge` FAIL mit `geloescht == 2`.

- [ ] **Step 5: Implementieren in `src/anhang/repo.rs`**

Den Sweep-Kommentar und das SQL ersetzen:

```rust
/// Löscht „verwaiste" Anhänge — an KEINEN Linker gebunden (weder `chat_nachricht_anhang`
/// noch `einsatz_dokument`), z. B. hochgeladen aber nie gesendet —, deren Upload länger als
/// [`VERWAISTE_KARENZ_STUNDEN`] zurückliegt. Gegen monotones BLOB-Wachstum (LFH-250).
///
/// **Jeder Linker gehört in dieses `NOT EXISTS`** (LFH-632 hat den zweiten ergänzt). Ein
/// fehlender Linker macht keinen Fehler, sondern löscht dort gebundene Dateien nach der
/// Karenz still — der Test `sweep_verwaiste_haelt_dokument_gebundene_anhaenge` pinnt das.
/// Ein soft-gelöschtes Dokument ist bewusst KEIN Orphan (Beweissicherung, LFH-632 E1).
pub async fn sweep_verwaiste(pool: &SqlitePool, jetzt: DateTime<Utc>) -> Result<u64, AppError> {
    let grenze = (jetzt - Duration::hours(VERWAISTE_KARENZ_STUNDEN))
        .format("%Y-%m-%d %H:%M:%S")
        .to_string();
    let betroffen = sqlx::query(
        "DELETE FROM anhang \
         WHERE erstellt_at < ? \
           AND NOT EXISTS \
               (SELECT 1 FROM chat_nachricht_anhang cna WHERE cna.anhang_id = anhang.id) \
           AND NOT EXISTS \
               (SELECT 1 FROM einsatz_dokument d WHERE d.anhang_id = anhang.id)",
    )
    .bind(grenze)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(betroffen)
}
```

Neu dazu (oberhalb des Sweeps):

```rust
/// Wer einen Anhang referenziert — über ALLE Linker aggregiert (LFH-116 → LFH-632).
/// Vorher lag diese Frage chat-lokal in `chat::repo` und kannte nur einen Linker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LinkerStand {
    /// Verknüpfungen über `chat_nachricht_anhang`.
    pub chat_gesamt: i64,
    /// Davon an nicht soft-gelöschten Nachrichten.
    pub chat_lebend: i64,
    /// Verknüpfungen über `einsatz_dokument` (0 oder 1, `anhang_id UNIQUE`), gelöscht oder nicht.
    pub dokument_gesamt: i64,
}

impl LinkerStand {
    /// Der Anhang gehört zur Dokumentenablage (LFH-632).
    pub fn ist_dokument(&self) -> bool {
        self.dokument_gesamt > 0
    }

    /// Ob der **generische** Download (`GET /anhaenge/{aid}`) gesperrt ist:
    /// (a) ein Dokument-Anhang ist nur über die modul-gegatete Dokument-Route ladbar —
    ///     die generische Route ist modul-los (`PFAD_KEY … None`) und wäre sonst ein Bypass
    ///     für ein ausgeblendetes Dokumente-Modul und für soft-gelöschte Dokumente;
    /// (b) Chat-Tombstone (LFH-116): an ≥ 1 Nachricht verknüpft und ALLE tragen den
    ///     Tombstone. Ein verwaister Anhang (Upload→Senden) bleibt ladbar.
    pub fn generischer_download_gesperrt(&self) -> bool {
        self.ist_dokument() || (self.chat_gesamt > 0 && self.chat_lebend == 0)
    }
}

/// Aggregiert die Linker eines Anhangs. Ein unbekannter Anhang liefert lauter Nullen —
/// die Existenz prüft der Aufrufer vorher (`gehoert_anhang_zu_einsatz`).
pub async fn linker_stand(pool: &SqlitePool, anhang_id: i64) -> Result<LinkerStand, AppError> {
    let (chat_gesamt, chat_lebend, dokument_gesamt): (i64, i64, i64) = sqlx::query_as(
        "SELECT \
           (SELECT COUNT(*) FROM chat_nachricht_anhang WHERE anhang_id = ?1), \
           (SELECT COUNT(*) FROM chat_nachricht_anhang cna \
              JOIN chat_nachricht n ON n.id = cna.nachricht_id \
             WHERE cna.anhang_id = ?1 AND n.geloescht_at IS NULL), \
           (SELECT COUNT(*) FROM einsatz_dokument WHERE anhang_id = ?1)",
    )
    .bind(anhang_id)
    .fetch_one(pool)
    .await?;
    Ok(LinkerStand { chat_gesamt, chat_lebend, dokument_gesamt })
}

/// Persistiert einen Anhang INNERHALB einer offenen Transaktion und liefert die neue `id`
/// (LFH-632: Dokument-Ablage legt Anhang, Dokument und ETB-Eintrag atomar an). Die
/// Pool-Variante [`anlegen`] bleibt für den Chat-Upload.
pub async fn anlegen_tx(
    conn: &mut sqlx::SqliteConnection,
    einsatz_id: i64,
    hochgeladen_von: i64,
    dateiname: &str,
    mime: &str,
    daten: &[u8],
) -> Result<i64, AppError> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO anhang (einsatz_id, dateiname, mime, groesse, sha256, daten, hochgeladen_von) \
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id)
    .bind(dateiname)
    .bind(mime)
    .bind(daten.len() as i64)
    .bind(sha256_hex(daten))
    .bind(daten)
    .bind(hochgeladen_von)
    .fetch_one(&mut *conn)
    .await?;
    Ok(id)
}
```

`anlegen` (Pool) bleibt unverändert. Duplizierte INSERT-SQL gibt es dann zweimal; `anlegen` darf stattdessen `pool.acquire()` + `anlegen_tx` + `anzeige_laden` nutzen, damit der INSERT nur einmal existiert. Das ist vorzuziehen.

Den Kommentar an `loeschen` (`:118-121`) ergänzen: „Dokument-gebundene Anhänge weist die Route vorher mit 422 ab (LFH-632).“

- [ ] **Step 6: `src/chat/repo.rs` umstellen**

1. `anhang_nur_an_geloeschten_nachrichten` (`:394-420`) **löschen**. Es gibt nur einen Aufrufer (`routes/anhang.rs`). Vorher per `grep -rn anhang_nur_an_geloeschten_nachrichten src tests` sicherstellen, dass es keinen weiteren gibt. Bestehende Chat-Tests, die sie direkt aufrufen, auf `anhang::repo::linker_stand(...).generischer_download_gesperrt()` umschreiben.
2. Link-Guard in `anlegen_mit_anhaengen` (`:276-288`):

```rust
        for &aid in anhang_ids {
            // Dokument-Anhänge (LFH-632) sind nicht verknüpfbar: sie gehören der
            // Dokumentenablage, ein zweiter Linker würde deren Lösch-/Rechte-Semantik aushebeln.
            let treffer: Option<i64> = sqlx::query_scalar(
                "SELECT 1 FROM anhang a WHERE a.id = ? AND a.einsatz_id = ? \
                   AND NOT EXISTS (SELECT 1 FROM einsatz_dokument d WHERE d.anhang_id = a.id)",
            )
            .bind(aid)
            .bind(einsatz_id)
            .fetch_optional(&mut *conn)
            .await?;
            if treffer.is_none() {
                return Err(AppError::Validation(
                    "Unbekannter oder fremder Anhang".into(),
                ));
            }
        }
```

- [ ] **Step 7: `src/routes/anhang.rs` umstellen**

Im `herunterladen` (Doc-Kommentar mit anpassen):

```rust
    // LFH-116 + LFH-632: Aggregation über ALLE Linker. Gesperrt, wenn der Anhang zur
    // Dokumentenablage gehört (nur über die modul-gegatete Route ladbar) oder nur noch an
    // soft-gelöschten Chat-Nachrichten hängt (Tombstone).
    if anhang::repo::linker_stand(&state.pool, anhang_id)
        .await?
        .generischer_download_gesperrt()
    {
        return Err(AppError::NotFound);
    }
```

Im `loeschen`:

```rust
    // Ownership zuerst (fremd/unbekannt → 404), dann die Linker-Frage.
    if !anhang::repo::gehoert_anhang_zu_einsatz(&state.pool, anhang_id, einsatz_id).await? {
        return Err(AppError::NotFound);
    }
    // LFH-632: ein Dokument-Anhang wird über die Dokumentenablage entfernt (Soft-Delete mit
    // ETB-Nachweis). Der generische Hard-Delete hätte beides umgangen → Zustand verbietet es.
    if anhang::repo::linker_stand(&state.pool, anhang_id).await?.ist_dokument() {
        return Err(AppError::UnprocessableEntity(
            "Anhang gehört zur Dokumentenablage und wird dort entfernt".into(),
        ));
    }
    anhang::repo::loeschen(&state.pool, einsatz_id, anhang_id).await?;
```

- [ ] **Step 8: Integrationstests in `tests/anhang.rs`**

Einen Helfer `dokument_anhang(pool, einsatz) -> i64` schreiben: legt per direktem SQL über `setup_mit_pool` einen Anhang plus eine `einsatz_dokument`-Zeile an, nach dem Muster aus Step 3. Tests:
- `dokument_anhang_generischer_download_ist_404`: GET `/anhaenge/{aid}` → 404.
- `dokument_anhang_generisches_loeschen_ist_422`: DELETE → 422, danach existiert die Zeile noch (`SELECT COUNT(*) FROM anhang WHERE id=?` = 1).
- `dokument_anhang_nicht_an_chat_verknuepfbar`: Nachricht senden mit `anhang_ids: [aid]` → 400. Muster der bestehenden Chat-Sende-Tests in `tests/anhang.rs`/`tests/chat.rs` nehmen.
- Die bestehenden Tombstone-Tests in `tests/anhang.rs` müssen unverändert grün bleiben.

- [ ] **Step 9: Tests laufen lassen**

Run: `cargo test --lib anhang:: && cargo test --test anhang && cargo test --test chat && cargo test --lib einsatz::schwaerzung_registry`
Expected: PASS.

- [ ] **Step 10: Mutationsprobe (belegt, dass der Sweep-Test die Aussage trägt)**

Die Zeile `AND NOT EXISTS (SELECT 1 FROM einsatz_dokument …)` vorübergehend entfernen, dann `cargo test --lib anhang::repo::tests::sweep_verwaiste_haelt_dokument_gebundene_anhaenge` ausführen. Erwartet: FAIL. Danach zurückdrehen und das Ergebnis im Commit-Body notieren.

- [ ] **Step 11: `cargo fmt --all` + Commit**

```bash
cargo fmt --all
rtk git add migrations/0104_einsatz_dokument.sql src/anhang/repo.rs src/chat/repo.rs src/routes/anhang.rs src/einsatz/schwaerzung_registry.rs tests/anhang.rs tests/chat.rs
rtk git commit -m "feat(anhang): zweiter Linker einsatz_dokument in Sweep, Download-Sperre und Chat-Guard (LFH-632)"
```

(Commit-Body: E8/E9 kurz, Mutationsprobe-Ergebnis, `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.)

---

### Task 2: Backend-Modul `dokument` (Routen, Registrierung, Live, Codegen) + Minimal-FE-Registrierung

Die Registrierungen sind absichtlich in einem Commit: `MODUL_KEYS`↔`modulRegistry.ts` (Drift-Test), `LiveEvent`↔`queryKeys.ts` (tsc-Kontrakt) und `openapi.json` (Drift-Gate) werden sonst zwischen zwei Commits rot.

**Files:**
- Create: `src/dokument/mod.rs`, `src/dokument/repo.rs`, `src/routes/dokument.rs`, `tests/dokument.rs`
- Modify: `src/anhang/mod.rs`, `src/lib.rs`, `src/routes/mod.rs`, `src/app.rs` (neben den Anhang-Routen `:209-221`), `src/zulassung.rs:79-100`, `src/einsatz/modul.rs` (`MODUL_KEYS` `:11`, `modul_marker!` `:112`, `PFAD_KEY` `:125`, Marker-Test), `src/live/mod.rs` (Variante, `ALLE`, `as_str`, `modul_keys`, `gate_mengen_sind_gepinnt`), `src/api_doc.rs` (Schemas), `tests/enum_wire_kontrakt.rs`, `tests/modul_override.rs:405`
- Modify FE: `frontend/src/einsatz/modulRegistry.ts` (+ `.test.ts:157`), `frontend/src/einsatz/sprungmarken.test.ts:50`, `frontend/src/api/queryKeys.ts` (+ `.test.ts`), `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`, `frontend/src/api/types.ts`

**Interfaces:**
- Consumes: `anhang::repo::anlegen_tx`, `anhang::repo::meta_fuer_download`, `anhang::repo::laden_bytes`, `anhang::content_disposition`, `anhang::scan`, `anhang::scan_config`, `anhang::pruefe_groesse`, `etb::system_audit_tx`, `routes::support::{etag_von, if_none_match_matcht, ASSET_CACHE_CONTROL}`
- Produces (HTTP):
  - `GET  /api/einsaetze/{id}/dokumente` → `200 DokumentAnzeige[]` (nur nicht gelöschte, neueste zuerst)
  - `POST /api/einsaetze/{id}/dokumente` multipart (`datei`, `titel`, `kategorie`, optional `bezug_typ` + `bezug_id`) → `201 DokumentAnzeige`
  - `GET  /api/einsaetze/{id}/dokumente/{did}/datei` → Bytes (`attachment`, ETag, 304)
  - `DELETE /api/einsaetze/{id}/dokumente/{did}` → `204`
- Produces (Rust): `pub enum DokumentKategorie { LagekartePlan, Befehl, Formular, Foto, Sonstiges }` mit `ALLE`, `as_str`, `parse`, `label`; `pub struct DokumentAnzeige`; `LiveEvent::Dokument`; Marker `crate::einsatz::modul::Dokumente`
- Produces (FE-Typ via Codegen): `Dokument` (Alias von `DokumentAnzeige`), `DokumentKategorie`

- [ ] **Step 1: Fehlschlagende Integrationstests schreiben — `tests/dokument.rs`**

Kopf und Helfer (Multipart-Bau nach dem Muster von `tests/anhang.rs:24-60`, erweitert um Textfelder):

```rust
//! Integrationstests der Dokumentenablage (LFH-632).

use axum::body::{to_bytes, Body};
use axum::http::{header, HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

mod common;
use common::*;

fn pfad(einsatz: i64) -> String {
    format!("/api/einsaetze/{einsatz}/dokumente")
}

/// Multipart mit Datei + beliebigen Textfeldern. `datei = None` lässt das Dateifeld weg.
async fn ablegen(
    app: &axum::Router,
    einsatz: i64,
    cookie: &str,
    datei: Option<(&str, &[u8])>,
    felder: &[(&str, &str)],
) -> (StatusCode, Value) {
    let b = "LFHDOKBOUNDARY";
    let mut body = Vec::new();
    for (name, wert) in felder {
        body.extend_from_slice(
            format!("--{b}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{wert}\r\n")
                .as_bytes(),
        );
    }
    if let Some((dateiname, daten)) = datei {
        body.extend_from_slice(format!(
            "--{b}\r\nContent-Disposition: form-data; name=\"datei\"; filename=\"{dateiname}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        ).as_bytes());
        body.extend_from_slice(daten);
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{b}--\r\n").as_bytes());
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(pfad(einsatz))
                .header(header::COOKIE, cookie)
                .header(header::CONTENT_TYPE, format!("multipart/form-data; boundary={b}"))
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
}

async fn datei_laden(
    app: &axum::Router,
    einsatz: i64,
    did: i64,
    cookie: &str,
) -> (StatusCode, HeaderMap, Vec<u8>) {
    let resp = app
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("{}/{did}/datei", pfad(einsatz)))
                .header(header::COOKIE, cookie)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap().to_vec();
    (status, headers, bytes)
}

const PDF: (&str, &[u8]) = ("lageplan.pdf", b"%PDF-1.4 inhalt");
```

Tests (jeder mit `setup()`/`login_cookie(&app, "admin", "startpw12")`/`einsatz_anlegen`):

1. `ablegen_listet_und_laedt_herunter`: POST mit `titel=Lageplan Nord`, `kategorie=lagekarte_plan` → 201. Erwartet: `json["kategorie"]=="lagekarte_plan"`, `json["titel"]=="Lageplan Nord"`, `json["dateiname"]=="lageplan.pdf"`, `json["mime"]=="application/pdf"`, `json["groesse"]==15`, `json["abgelegt_von_name"]` gesetzt. GET-Liste enthält genau diesen Eintrag. `datei_laden` liefert 200, die Bytes gleich `PDF.1`, `content-disposition` beginnt mit `attachment`, und ein `etag` ist gesetzt.
2. `ablegen_schreibt_system_etb_eintrag`: nach dem POST liefert `GET /etb` einen Eintrag mit `typ=="system"`, dessen `inhalt` `"Dokument abgelegt: Lageplan Nord (Lagekarte/Plan)"` enthält; `json["etb_eintrag_id"]` ist dessen `id`.
3. `unbekannte_kategorie_ist_400`, `fehlender_titel_ist_400`, `leerer_titel_ist_400` (`"   "`), `titel_ueber_200_zeichen_ist_400`, `fehlende_datei_ist_400`, `unerlaubter_typ_ist_400` (`("x.exe", b"MZ")`), `unbekannter_bezug_typ_ist_400`.
4. `bezug_typ_ohne_id_ist_422` und `bezug_id_ohne_typ_ist_422`.
5. `bezug_auf_abschnitt_wird_gespeichert`: Abschnitt anlegen (`POST /api/einsaetze/{e}/abschnitte` mit `{"name":"Abschnitt Nord"}`; den tatsächlichen Pfad aus `tests/einsatzabschnitt.rs` nehmen), ablegen mit `bezug_typ=abschnitt`, `bezug_id=<id>`. Erwartet: `json["bezug_abschnitt_id"]` und `json["bezug_abschnitt_name"]=="Abschnitt Nord"`; `bezug_einheit_id` fehlt als Key (`!json.as_object().unwrap().contains_key("bezug_einheit_id")`, Präsenzprüfung nach CLAUDE.md).
6. `bezug_auf_fremden_abschnitt_ist_400`: Abschnitt in Einsatz B, ablegen in Einsatz A → 400.
7. `heic_und_tiff_sind_erlaubt`: `("foto.heic", b"x")` und `("scan.tiff", b"x")` → 201 mit `mime` `image/heic` bzw. `image/tiff`. **Vorher messen**, was `mime_guess` für `.heic`/`.heif`/`.tif`/`.tiff` liefert (`cargo test` mit einem `dbg!`, oder in `src/anhang/mod.rs` einen Unit-Test schreiben). Liefert es für HEIC nichts, braucht Task 2 Step 3 eine explizite Endungs-Tabelle, siehe dort.
8. `chat_allowlist_bleibt_ohne_heic`: `POST /anhaenge` mit `foto.heic` → 400 (E4: der Chat bleibt unverändert).
9. `dokument_aus_fremdem_einsatz_ist_404`: Dokument in Einsatz B ablegen; `datei_laden(app, A, did_aus_B)` → 404 und `DELETE /api/einsaetze/A/dokumente/{did_aus_B}` → 404.
10. `entfernen_ist_soft_delete`: DELETE → 204. Danach fehlt das Dokument in der Liste, `datei_laden` → 404, ein zweites DELETE → 404, `GET /etb` enthält `"Dokument entfernt: …"`, und in der DB steht die `anhang`-Zeile noch (mit `setup_mit_pool`: `SELECT COUNT(*) FROM anhang` = 1).
11. `beobachter_darf_lesen_nicht_ablegen`: Benutzer als Beobachter (`benutzer_anlegen` + `rolle_setzen(..., "beobachter")`, Signaturen in `tests/common/mod.rs:117,251`): GET-Liste 200, `datei_laden` 200, POST → 403, DELETE → 403.
12. `abgeschlossener_einsatz_ablegen_ist_409`: Einsatz abschließen (Muster aus `tests/stab.rs` suchen: `grep -n abschliess tests/stab.rs tests/common/mod.rs`), POST → 409.
13. `fremde_org_ist_403_oder_404`: Muster `tests/stab.rs:128` (`status == FORBIDDEN || status == NOT_FOUND`).

Run: `cargo test --test dokument`
Expected: FAIL (404 auf allen Routen bzw. Kompilierfehler).

- [ ] **Step 2: `src/dokument/mod.rs`**

```rust
//! Dokumentenablage eines Einsatzes (LFH-632): hochgeladene Dateien mit Kategorie, Titel
//! und optionalem Bezug. Die Bytes liegen in `anhang` (Scan, ETag, Backup, Schwärzung);
//! `einsatz_dokument` ist der zweite Linker darauf — siehe `anhang::repo::LinkerStand`.
//!
//! Nur hochgeladene Dateien, keine Verweise auf Lageberichte/Befehle (Entscheidung E3).

use serde::Serialize;
use utoipa::ToSchema;

pub mod repo;

/// Höchstlänge des Titels (Zeichen, nach `trim`).
pub const TITEL_MAX: usize = 200;

/// Kategorie eines abgelegten Dokuments. Wire == `as_str()`; `ALLE` ist zugleich die
/// Anzeigereihenfolge (Vertrag, nicht Dekoration).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DokumentKategorie {
    LagekartePlan,
    Befehl,
    Formular,
    Foto,
    Sonstiges,
}

impl DokumentKategorie {
    pub const ALLE: [DokumentKategorie; 5] = [
        DokumentKategorie::LagekartePlan,
        DokumentKategorie::Befehl,
        DokumentKategorie::Formular,
        DokumentKategorie::Foto,
        DokumentKategorie::Sonstiges,
    ];

    pub fn as_str(&self) -> &'static str {
        match self {
            DokumentKategorie::LagekartePlan => "lagekarte_plan",
            DokumentKategorie::Befehl => "befehl",
            DokumentKategorie::Formular => "formular",
            DokumentKategorie::Foto => "foto",
            DokumentKategorie::Sonstiges => "sonstiges",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALLE.into_iter().find(|k| k.as_str() == s)
    }

    /// Anzeige-Label (ETB-Text). Das FE hält sein eigenes Label (`dokumente/kategorien.ts`).
    pub fn label(&self) -> &'static str {
        match self {
            DokumentKategorie::LagekartePlan => "Lagekarte/Plan",
            DokumentKategorie::Befehl => "Befehl",
            DokumentKategorie::Formular => "Formular",
            DokumentKategorie::Foto => "Foto",
            DokumentKategorie::Sonstiges => "Sonstiges",
        }
    }
}

/// Öffentliche Darstellung eines Dokuments (ohne Bytes).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct DokumentAnzeige {
    pub id: i64,
    pub einsatz_id: i64,
    pub kategorie: DokumentKategorie,
    pub titel: String,
    pub dateiname: String,
    pub mime: String,
    pub groesse: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_abschnitt_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_abschnitt_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_einheit_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_einheit_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_etb_eintrag_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bezug_etb_lfd_nr: Option<i64>,
    pub etb_eintrag_id: i64,
    pub abgelegt_von_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub abgelegt_von_name: Option<String>,
    pub abgelegt_at: String,
}

/// Der optionale Bezug, validiert (höchstens eines, Enum geprüft).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Bezug {
    Abschnitt(i64),
    Einheit(i64),
    EtbEintrag(i64),
}
```

- [ ] **Step 3: MIME-Allowlist für Dokumente in `src/anhang/mod.rs`**

```rust
/// Allowlist der Dokumentenablage (LFH-632, E4): die Chat-Liste plus HEIC/HEIF
/// (iPhone-Kamera-Standard) und TIFF (Scans). Der Chat bleibt bei [`ERLAUBTE_MIME`].
pub const ERLAUBTE_MIME_DOKUMENT: &[&str] = &[
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
    "image/tiff",
    "application/pdf",
    "text/plain",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

/// Wie [`ermittle_mime`], aber gegen eine übergebene Allowlist.
pub fn ermittle_mime_aus(dateiname: &str, erlaubt: &[&str]) -> Result<String, AppError> {
    let mime = mime_guess::from_path(dateiname)
        .first_raw()
        .ok_or_else(|| AppError::Validation("Dateityp nicht erkennbar".into()))?;
    if !erlaubt.contains(&mime) {
        return Err(AppError::Validation(format!("Dateityp {mime} ist nicht erlaubt")));
    }
    Ok(mime.to_string())
}
```

`ermittle_mime(d)` wird zu `ermittle_mime_aus(d, ERLAUBTE_MIME)`. Einen Unit-Test ergänzen: `ermittle_mime_aus("a.heic", ERLAUBTE_MIME_DOKUMENT)` → `"image/heic"`, `"a.tif"` → `"image/tiff"`, `ermittle_mime("a.heic")` → Err. **Kennt `mime_guess` `.heic` nicht** (Test-Messung), vor `mime_guess` eine kleine Endungstabelle einziehen: `heic→image/heic`, `heif→image/heif`, `tif|tiff→image/tiff` (Endung per `rsplit('.')`, kleingeschrieben). Das bleibt auf `ermittle_mime_aus` beschränkt.

- [ ] **Step 4: `src/dokument/repo.rs`**

```rust
use super::{Bezug, DokumentAnzeige, DokumentKategorie};
use crate::error::AppError;
use sqlx::{FromRow, SqliteConnection, SqlitePool};

/// Rohzeile vor der Enum-Umwandlung (`kategorie` kommt als TEXT).
#[derive(FromRow)]
struct Zeile {
    id: i64,
    einsatz_id: i64,
    kategorie: String,
    titel: String,
    dateiname: String,
    mime: String,
    groesse: i64,
    bezug_abschnitt_id: Option<i64>,
    bezug_abschnitt_name: Option<String>,
    bezug_einheit_id: Option<i64>,
    bezug_einheit_name: Option<String>,
    bezug_etb_eintrag_id: Option<i64>,
    bezug_etb_lfd_nr: Option<i64>,
    etb_eintrag_id: i64,
    abgelegt_von_id: i64,
    abgelegt_von_name: Option<String>,
    abgelegt_at: String,
}

impl TryFrom<Zeile> for DokumentAnzeige {
    type Error = AppError;
    fn try_from(z: Zeile) -> Result<Self, AppError> {
        let kategorie = DokumentKategorie::parse(&z.kategorie)
            .ok_or_else(|| AppError::Internal(format!("Unbekannte Kategorie in DB: {}", z.kategorie)))?;
        Ok(DokumentAnzeige {
            id: z.id, einsatz_id: z.einsatz_id, kategorie, titel: z.titel,
            dateiname: z.dateiname, mime: z.mime, groesse: z.groesse,
            bezug_abschnitt_id: z.bezug_abschnitt_id, bezug_abschnitt_name: z.bezug_abschnitt_name,
            bezug_einheit_id: z.bezug_einheit_id, bezug_einheit_name: z.bezug_einheit_name,
            bezug_etb_eintrag_id: z.bezug_etb_eintrag_id, bezug_etb_lfd_nr: z.bezug_etb_lfd_nr,
            etb_eintrag_id: z.etb_eintrag_id, abgelegt_von_id: z.abgelegt_von_id,
            abgelegt_von_name: z.abgelegt_von_name, abgelegt_at: z.abgelegt_at,
        })
    }
}

/// SELECT über die lebenden Dokumente eines Einsatzes samt Anzeige-Joins.
const SELECT: &str = "SELECT d.id, d.einsatz_id, d.kategorie, d.titel, \
        a.dateiname, a.mime, a.groesse, \
        d.bezug_abschnitt_id, ab.name AS bezug_abschnitt_name, \
        d.bezug_einheit_id, eh.name AS bezug_einheit_name, \
        d.bezug_etb_eintrag_id, et.lfd_nr AS bezug_etb_lfd_nr, \
        d.etb_eintrag_id, d.abgelegt_von_id, b.anzeigename AS abgelegt_von_name, d.abgelegt_at \
     FROM einsatz_dokument d \
     JOIN anhang a ON a.id = d.anhang_id \
     LEFT JOIN einsatzabschnitt ab ON ab.id = d.bezug_abschnitt_id \
     LEFT JOIN einsatz_einheit eh ON eh.id = d.bezug_einheit_id \
     LEFT JOIN etb_eintrag et ON et.id = d.bezug_etb_eintrag_id \
     LEFT JOIN benutzer b ON b.id = d.abgelegt_von_id \
     WHERE d.einsatz_id = ? AND d.geloescht_at IS NULL";

pub async fn liste(pool: &SqlitePool, einsatz_id: i64) -> Result<Vec<DokumentAnzeige>, AppError> {
    let zeilen = sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(format!(
        "{SELECT} ORDER BY d.abgelegt_at DESC, d.id DESC"
    )))
    .bind(einsatz_id)
    .fetch_all(pool)
    .await?;
    zeilen.into_iter().map(DokumentAnzeige::try_from).collect()
}

/// Ein lebendes Dokument dieses Einsatzes; fremd, unbekannt oder gelöscht → `NotFound`.
pub async fn laden(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<DokumentAnzeige, AppError> {
    sqlx::query_as::<_, Zeile>(sqlx::AssertSqlSafe(format!("{SELECT} AND d.id = ?")))
        .bind(einsatz_id)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)?
        .try_into()
}

/// `anhang_id` eines lebenden Dokuments dieses Einsatzes (Download); sonst `NotFound`.
pub async fn anhang_id(pool: &SqlitePool, einsatz_id: i64, id: i64) -> Result<i64, AppError> {
    sqlx::query_scalar(
        "SELECT anhang_id FROM einsatz_dokument \
         WHERE id = ? AND einsatz_id = ? AND geloescht_at IS NULL",
    )
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound)
}

/// Eingabe für [`ablegen`] — vom Handler validiert.
pub struct Ablage<'a> {
    pub kategorie: DokumentKategorie,
    pub titel: &'a str,
    pub bezug: Option<Bezug>,
    pub dateiname: &'a str,
    pub mime: &'a str,
    pub daten: &'a [u8],
}

/// Prüft, dass das Bezugsziel zu diesem Einsatz gehört (FK-Ersatz für die Isolation);
/// fremd/unbekannt → 400 wie `chat::bezug_setzen`.
async fn bezug_pruefen(conn: &mut SqliteConnection, einsatz_id: i64, bezug: Bezug) -> Result<(), AppError> {
    let (tabelle, id) = match bezug {
        Bezug::Abschnitt(id) => ("einsatzabschnitt", id),
        Bezug::Einheit(id) => ("einsatz_einheit", id),
        Bezug::EtbEintrag(id) => ("etb_eintrag", id),
    };
    let treffer: Option<i64> = sqlx::query_scalar(sqlx::AssertSqlSafe(format!(
        "SELECT 1 FROM {tabelle} WHERE id = ? AND einsatz_id = ?"
    )))
    .bind(id)
    .bind(einsatz_id)
    .fetch_optional(&mut *conn)
    .await?;
    if treffer.is_none() {
        return Err(AppError::Validation("Unbekanntes oder fremdes Bezugsziel".into()));
    }
    Ok(())
}

/// Legt Anhang, Dokument und System-ETB-Eintrag in EINER Transaktion an (Pattern B,
/// kein Orphan-Fenster). Liefert `(dokument_id, etb_id)`; SSE macht der Aufrufer NACH dem Commit.
pub async fn ablegen(
    pool: &SqlitePool,
    einsatz_id: i64,
    benutzer_id: i64,
    ablage: &Ablage<'_>,
) -> Result<(i64, i64), AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    let inhalt = format!("Dokument abgelegt: {} ({})", ablage.titel, ablage.kategorie.label());
    crate::write_retry!(pool, |conn| {
        if let Some(b) = ablage.bezug {
            bezug_pruefen(conn, einsatz_id, b).await?;
        }
        let anhang_id = crate::anhang::repo::anlegen_tx(
            conn, einsatz_id, benutzer_id, ablage.dateiname, ablage.mime, ablage.daten,
        )
        .await?;
        let etb_id =
            crate::etb::system_audit_tx(conn, einsatz_id, benutzer_id, etb_startwert, &inhalt).await?;
        let (ab, eh, et) = match ablage.bezug {
            Some(Bezug::Abschnitt(i)) => (Some(i), None, None),
            Some(Bezug::Einheit(i)) => (None, Some(i), None),
            Some(Bezug::EtbEintrag(i)) => (None, None, Some(i)),
            None => (None, None, None),
        };
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO einsatz_dokument \
               (einsatz_id, anhang_id, kategorie, titel, bezug_abschnitt_id, bezug_einheit_id, \
                bezug_etb_eintrag_id, etb_eintrag_id, abgelegt_von_id) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        )
        .bind(einsatz_id)
        .bind(anhang_id)
        .bind(ablage.kategorie.as_str())
        .bind(ablage.titel)
        .bind(ab)
        .bind(eh)
        .bind(et)
        .bind(etb_id)
        .bind(benutzer_id)
        .fetch_one(&mut *conn)
        .await?;
        Ok((id, etb_id))
    })
}

/// Soft-Delete mit System-ETB-Nachweis. Fremd/unbekannt/schon gelöscht → `NotFound`.
/// Liefert die ETB-id.
pub async fn entfernen(
    pool: &SqlitePool,
    einsatz_id: i64,
    id: i64,
    benutzer_id: i64,
) -> Result<i64, AppError> {
    let etb_startwert = crate::einsatz::einstellungen::laden_oder_default(pool, einsatz_id)
        .await?
        .etb_startwert();
    crate::write_retry!(pool, |conn| {
        let (titel, kategorie): (String, String) = sqlx::query_as(
            "SELECT titel, kategorie FROM einsatz_dokument \
             WHERE id = ? AND einsatz_id = ? AND geloescht_at IS NULL",
        )
        .bind(id)
        .bind(einsatz_id)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(AppError::NotFound)?;
        let label = DokumentKategorie::parse(&kategorie).map(|k| k.label()).unwrap_or("Sonstiges");
        sqlx::query(
            "UPDATE einsatz_dokument SET geloescht_at = datetime('now'), geloescht_von_id = ? \
             WHERE id = ?",
        )
        .bind(benutzer_id)
        .bind(id)
        .execute(&mut *conn)
        .await?;
        crate::etb::system_audit_tx(
            conn, einsatz_id, benutzer_id, etb_startwert,
            &format!("Dokument entfernt: {titel} ({label})"),
        )
        .await
    })
}
```

Hinweis: prüfen, dass `write_retry!` das `Ok((id, etb_id))` als Ausdruckswert zurückgibt (Muster `src/tx.rs:66-71`). Falls `sqlx::AssertSqlSafe` mit einer Tabellennamen-Interpolation gegen einen Guard läuft (Memory `sqlx-09-sqlsafestr`), `bezug_pruefen` in drei literale Queries aufspalten.

- [ ] **Step 5: `src/routes/dokument.rs`**

```rust
//! Routen der Dokumentenablage (LFH-632). Gates strukturell über die Extractor-Typen:
//! `EinsatzLesezugriff<Dokumente>` (alle Mitglieder inkl. Beobachter),
//! `EinsatzSchreibzugriff<Dokumente>` (Schreibrecht + aktiver Einsatz).

use axum::extract::{Multipart, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;

use crate::anhang;
use crate::app::AppState;
use crate::dokument::repo::{self, Ablage};
use crate::dokument::{Bezug, DokumentAnzeige, DokumentKategorie, TITEL_MAX};
use crate::einsatz::kontext::{EinsatzLesezugriff, EinsatzSchreibzugriff};
use crate::einsatz::modul::Dokumente;
use crate::error::AppError;
use crate::extract::PfadParam;
use crate::live::LiveEvent;

use super::support::{etag_von, if_none_match_matcht, ASSET_CACHE_CONTROL};

fn sse(state: &AppState, einsatz_id: i64) {
    state.live.publiziere_event(
        einsatz_id,
        LiveEvent::Dokument,
        serde_json::json!({ "einsatz_id": einsatz_id }).to_string(),
    );
}

/// GET /api/einsaetze/{id}/dokumente — lebende Dokumente, neueste zuerst.
pub async fn liste(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Dokumente>,
) -> Result<Json<Vec<DokumentAnzeige>>, AppError> {
    Ok(Json(repo::liste(&state.pool, ctx.einsatz.id).await?))
}

/// Validiert die Textfelder. 400 = Feld für sich, 422 = Zusammenhang (LFH-267).
fn validiere(
    titel: Option<String>,
    kategorie: Option<String>,
    bezug_typ: Option<String>,
    bezug_id: Option<String>,
) -> Result<(String, DokumentKategorie, Option<Bezug>), AppError> {
    let titel = titel.map(|t| t.trim().to_string()).unwrap_or_default();
    if titel.is_empty() {
        return Err(AppError::Validation("Titel darf nicht leer sein".into()));
    }
    if titel.chars().count() > TITEL_MAX {
        return Err(AppError::Validation(format!("Titel ist länger als {TITEL_MAX} Zeichen")));
    }
    let roh = kategorie.map(|k| k.trim().to_string()).unwrap_or_default();
    if roh.is_empty() {
        return Err(AppError::Validation("Kategorie fehlt".into()));
    }
    let kategorie = DokumentKategorie::parse(&roh)
        .ok_or_else(|| AppError::Validation(format!("Unbekannte Kategorie '{roh}'")))?;
    let leer = |o: Option<String>| o.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    let bezug = match (leer(bezug_typ), leer(bezug_id)) {
        (None, None) => None,
        (Some(_), None) | (None, Some(_)) => {
            return Err(AppError::UnprocessableEntity(
                "bezug_typ und bezug_id nur gemeinsam".into(),
            ))
        }
        (Some(typ), Some(id)) => {
            let id: i64 = id
                .parse()
                .map_err(|_| AppError::Validation(format!("bezug_id ist keine Zahl: {id}")))?;
            Some(match typ.as_str() {
                "abschnitt" => Bezug::Abschnitt(id),
                "einheit" => Bezug::Einheit(id),
                "etb_eintrag" => Bezug::EtbEintrag(id),
                _ => return Err(AppError::Validation(format!("Unbekannter bezug_typ '{typ}'"))),
            })
        }
    };
    Ok((titel, kategorie, bezug))
}

/// POST /api/einsaetze/{id}/dokumente — Datei + Metadaten in EINEM Multipart (E6).
pub async fn ablegen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Dokumente>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<DokumentAnzeige>), AppError> {
    let einsatz_id = ctx.einsatz.id;
    let (mut datei, mut titel, mut kategorie, mut bezug_typ, mut bezug_id) =
        (None::<(String, Vec<u8>)>, None, None, None, None);
    while let Some(feld) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::Validation(format!("Multipart-Fehler: {e}")))?
    {
        let name = feld.name().map(str::to_string);
        let text = |e| AppError::Validation(format!("Feld lesen fehlgeschlagen: {e}"));
        match name.as_deref() {
            Some("datei") => {
                let dateiname = feld
                    .file_name()
                    .map(str::to_string)
                    .ok_or_else(|| AppError::Validation("Datei ohne Dateinamen".into()))?;
                let b = feld.bytes().await.map_err(|e| {
                    AppError::Validation(format!("Datei lesen fehlgeschlagen: {e}"))
                })?;
                datei = Some((dateiname, b.to_vec()));
            }
            Some("titel") => titel = Some(feld.text().await.map_err(text)?),
            Some("kategorie") => kategorie = Some(feld.text().await.map_err(text)?),
            Some("bezug_typ") => bezug_typ = Some(feld.text().await.map_err(text)?),
            Some("bezug_id") => bezug_id = Some(feld.text().await.map_err(text)?),
            _ => {}
        }
    }
    let (dateiname, daten) = datei.ok_or_else(|| AppError::Validation("Keine Datei im Upload".into()))?;
    let (titel, kategorie, bezug) = validiere(titel, kategorie, bezug_typ, bezug_id)?;
    let mime = anhang::ermittle_mime_aus(&dateiname, anhang::ERLAUBTE_MIME_DOKUMENT)?;
    anhang::pruefe_groesse(daten.len())?;
    // AV-Scan vor dem Persistieren (LFH-114); ohne clamd ein No-op, sonst fail-closed.
    anhang::scan(anhang::scan_config(), &daten).await?;

    let (id, etb_id) = repo::ablegen(
        &state.pool,
        einsatz_id,
        ctx.benutzer.id,
        &Ablage { kategorie, titel: &titel, bezug, dateiname: &dateiname, mime: &mime, daten: &daten },
    )
    .await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse(&state, einsatz_id);
    Ok((StatusCode::CREATED, Json(repo::laden(&state.pool, einsatz_id, id).await?)))
}

/// GET /api/einsaetze/{id}/dokumente/{did}/datei — Download (modul-gegatet, E8).
pub async fn datei(
    State(state): State<AppState>,
    ctx: EinsatzLesezugriff<Dokumente>,
    PfadParam((_einsatz_id, dokument_id)): PfadParam<(i64, i64)>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let anhang_id = repo::anhang_id(&state.pool, ctx.einsatz.id, dokument_id).await?;
    let (dateiname, mime, sha256) = anhang::repo::meta_fuer_download(&state.pool, anhang_id).await?;
    let etag = etag_von(&sha256);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::ETAG,
        HeaderValue::from_str(&etag).map_err(|e| AppError::Internal(format!("Ungültiger ETag: {e}")))?,
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(ASSET_CACHE_CONTROL));
    if if_none_match_matcht(&req_headers, &etag) {
        return Ok((StatusCode::NOT_MODIFIED, headers).into_response());
    }
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(&mime).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&anhang::content_disposition(&dateiname))
            .map_err(|e| AppError::Internal(format!("Ungültiger Header: {e}")))?,
    );
    let (_, _, daten) = anhang::repo::laden_bytes(&state.pool, anhang_id).await?;
    Ok((headers, daten).into_response())
}

/// DELETE /api/einsaetze/{id}/dokumente/{did} — Soft-Delete mit ETB-Nachweis (E1).
pub async fn entfernen(
    State(state): State<AppState>,
    ctx: EinsatzSchreibzugriff<Dokumente>,
    PfadParam((_einsatz_id, dokument_id)): PfadParam<(i64, i64)>,
) -> Result<StatusCode, AppError> {
    let einsatz_id = ctx.einsatz.id;
    let etb_id = repo::entfernen(&state.pool, einsatz_id, dokument_id, ctx.benutzer.id).await?;
    state.live.publiziere(einsatz_id, etb_id);
    sse(&state, einsatz_id);
    Ok(StatusCode::NO_CONTENT)
}
```

Die ETag-/Header-Sequenz ist dann mit `routes/anhang.rs:94-128` identisch. **Diese Dopplung auflösen**: einen Helfer `pub async fn asset_antwort(pool, anhang_id, req_headers) -> Result<Response, AppError>` in `routes/support.rs` einziehen und von beiden Handlern (sowie von `datei`) aufrufen. Prüfen, ob `karte_hintergrundbild` eine eigene Bytes-Quelle hat; wenn ja, bleibt sie außen vor.

- [ ] **Step 6: Registrierung Backend**

1. `src/lib.rs`: `pub mod dokument;` (alphabetisch einsortieren). `src/routes/mod.rs`: `pub mod dokument;`.
2. `src/einsatz/modul.rs`: `MODUL_KEYS: [&str; 27]` und `"dokumente"` nach `"stab"` im Führungs-Block. `modul_marker!` bekommt `Dokumente => "dokumente",`. In `PFAD_KEY` `("/api/einsaetze/{id}/dokumente", Some("dokumente")),` eintragen. Den Unit-Test `marker_key_werte_stimmen` (`:219-225`) um `assert_eq!(Dokumente::KEY, Some("dokumente"));` ergänzen.
3. `src/app.rs` direkt nach den Anhang-Routen:

```rust
        // Dokumentenablage (LFH-632): eigener Präfix mit Modul-Gate; Upload/Download wie Anhänge
        // mit Body-Limit und Download-Concurrency-Cap.
        .route(
            "/api/einsaetze/{id}/dokumente",
            get(routes::dokument::liste)
                .post(routes::dokument::ablegen)
                .layer(DefaultBodyLimit::max(26 * 1024 * 1024)),
        )
        .route(
            "/api/einsaetze/{id}/dokumente/{did}",
            delete(routes::dokument::entfernen),
        )
        .route(
            "/api/einsaetze/{id}/dokumente/{did}/datei",
            get(routes::dokument::datei).layer(ConcurrencyLimitLayer::new(
                MAX_GLEICHZEITIGE_ASSET_DOWNLOADS,
            )),
        )
```

   `tests/einsatz_kontext_guard.rs` parst die `.route(`-Kette. Wenn sein Parser verkettete Methoden (`get(..).post(..)`) nicht erkennt, auf zwei `.route(`-Aufrufe splitten, so wie die Nachbarn es tun.
4. `src/zulassung.rs` in `OHNE_ZULASSUNGSGRENZE`:

```rust
    // Dokumentenablage (LFH-632): Multipart bis 26 MiB + clamd-Scan; Voll-BLOB-Download.
    // NUR POST bzw. GET — die Liste (GET auf dem POST-Pfad) und das DELETE bleiben geregelt.
    ("POST", "/api/einsaetze/{id}/dokumente"),
    ("GET", "/api/einsaetze/{id}/dokumente/{did}/datei"),
```

5. `src/live/mod.rs`: Variante `Dokument` nach `Stab`. `ALLE: [LiveEvent; 28]` bekommt den Eintrag. `as_str`: `LiveEvent::Dokument => "dokument"`. `modul_keys`: mit Kommentar „Nur `dokumente`: das Dokument ist ein Datenobjekt der Dokumentenablage; der ETB-Nachweis läuft über das eigene `etb`-Ereignis.“ `LiveEvent::Dokument => &["dokumente"]`. In `gate_mengen_sind_gepinnt` `(LiveEvent::Dokument, &["dokumente"]),` ergänzen.
6. `src/api_doc.rs` bei den Schemas: `crate::dokument::DokumentAnzeige, crate::dokument::DokumentKategorie,`.
7. `tests/enum_wire_kontrakt.rs`: einen `enum_wire_as_str!`-Block für `crate::dokument::DokumentKategorie` mit allen fünf Varianten (voll qualifizierte Pfade, Muster des Sachgebiet-Blocks) plus `Dokument => "dokument",` im LiveEvent-Block (`:559`).
8. `tests/modul_override.rs:405` in `MODUL_GET_PFADE`: `("dokumente", "dokumente"),`.

- [ ] **Step 7: Minimal-FE-Registrierung (im selben Commit, damit Drift-/tsc-Kontrakte grün bleiben)**

1. `frontend/src/einsatz/modulRegistry.ts` nach `stab`:

```ts
  {
    key: 'dokumente',
    kategorie: 'fuehrung',
    label: 'Dokumente',
    icon: TbFiles,
    route: 'dokumente',
    status: 'fertig',
    beschreibung: 'Abgelegte Dateien des Einsatzes: Lagepläne, Befehle, Formulare, Fotos.',
  },
```

   `TbFiles` in den `react-icons/tb`-Import-Block aufnehmen. Wenn es die Ikone nicht gibt: `grep -o "TbFiles\b" node_modules/react-icons/tb/index.d.ts`, sonst `TbFolder`.
2. Die Pins `modulRegistry.test.ts:157-164` und `sprungmarken.test.ts:50-57` um `'dokumente'` an der Führungs-Folge ergänzen. Vorher lesen, welche Form der Sprungmarken-Pin hat (inkl. `'↗entscheidungen'`).
3. `frontend/src/api/queryKeys.ts`: `EINSATZ_KEYS.dokumente: 'einsatz-dokumente'`; in `EINSATZ_STREAM_EVENTS` `dokument: [EINSATZ_KEYS.dokumente],` mit Kommentar im Stab-Stil; Factory `dokumente: (einsatzId: number) => [EINSATZ_KEYS.dokumente, einsatzId] as const,`.
4. `frontend/src/api/queryKeys.test.ts`: Byte-Pins als **Literale** `expect(EINSATZ_KEYS.dokumente).toBe('einsatz-dokumente')` und `expect(einsatzKeys.dokumente(1)).toEqual(['einsatz-dokumente', 1])`.
5. App-Element fehlt noch → `ModulStub` rendert, das ist bis Task 4 in Ordnung.

- [ ] **Step 8: Codegen**

Run: `./scripts/check-typ-codegen.sh`
Beim ersten Lauf bricht es am `git diff`. Das ist gewollt: `frontend/src/api/openapi.json` und `types.generated.ts` sind regeneriert. In `frontend/src/api/types.ts` den Barrel-Alias ergänzen: `export type Dokument = components['schemas']['DokumentAnzeige'];` und `export type DokumentKategorie = components['schemas']['DokumentKategorie'];` (dem vorhandenen Stil folgen). Danach das Skript erneut laufen lassen, nachdem die Artefakte gestaged sind. Erwartet: grün.

- [ ] **Step 9: Tests laufen lassen**

Run: `cargo test --test dokument && cargo test --test modul_override && cargo test --test einsatz_kontext_guard && cargo test --test zulassung_guard && cargo test --test enum_wire_kontrakt && cargo test --test openapi_spec_aktuell && cargo test --lib live:: && cargo test --lib einsatz::`
Danach: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-lfh-78-0056aa/frontend exec vitest run src/api src/einsatz`
Expected: PASS. Wenn `tests/einsatz.rs` einen weiteren Drift-Test enthält: `cargo test --test einsatz`.

- [ ] **Step 10: fmt + Commit**

```bash
cargo fmt --all
rtk git add -A src tests frontend/src/einsatz frontend/src/api
rtk git commit -m "feat(dokumente): Backend-Modul Dokumentenablage mit Modul-Gate, System-ETB und Live-Ereignis (LFH-632)"
```

---

### Task 3: FE-API, Upload-Timeout, Deeplink, Kategorien, Zähler

**Files:**
- Modify: `frontend/src/api/client.ts:95-108`
- Create: `frontend/src/api/dokumente.ts`, `frontend/src/api/dokumente.test.ts`, `frontend/src/dokumente/kategorien.ts`
- Modify: `frontend/src/routing/deeplinks.ts` (+ `deeplinks.test.ts`), `frontend/src/einsatz/modulRegistry.ts:36` (`ModulZaehlerQuelle`) + Eintrag `zaehlerQuelle: 'dokumente'`, `frontend/src/einsatz/useModulZaehler.ts` (+ vorhandenen Test)

**Interfaces:**
- Consumes: Typen `Dokument`, `DokumentKategorie` (Task 2), `einsatzKeys.dokumente`
- Produces:
  - `apiUpload<T>(pfad: string, formData: FormData, optionen?: { timeoutMs?: number }): Promise<T>` (Default 15 000)
  - `DOKUMENT_UPLOAD_TIMEOUT_MS = 120_000`
  - `listeDokumente(einsatzId: number): Promise<Dokument[]>`
  - `legeDokumentAb(einsatzId: number, eingabe: DokumentAblage): Promise<Dokument>` mit `interface DokumentAblage { datei: File; titel: string; kategorie: DokumentKategorie; bezug?: { typ: 'abschnitt' | 'einheit' | 'etb_eintrag'; id: number } }`
  - `entferneDokument(einsatzId: number, dokumentId: number): Promise<void>`
  - `dokumentDownloadPfad(einsatzId: number, dokumentId: number): string`
  - `DOKUMENT_KATEGORIEN: Record<DokumentKategorie, { label: string }>` und `DOKUMENT_KATEGORIE_REIHENFOLGE: DokumentKategorie[]`
  - `dokumentePfad(einsatzId: number, opts?: { neu?: boolean }): string`
  - `berechneDokumentZaehler(dokumente: unknown[]): ModulZaehlerWert`

- [ ] **Step 1: Fehlschlagende Tests**

`frontend/src/api/dokumente.test.ts` (Muster der bestehenden API-Tests mit `fetch`-Mock ansehen, z. B. `api/kartenbilder.test.ts`, falls vorhanden):

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dokumentDownloadPfad, legeDokumentAb } from './dokumente';

afterEach(() => vi.restoreAllMocks());

describe('dokumente-API', () => {
  it('schickt Datei und Metadaten in EINEM Multipart', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), { status: 201 }),
    );
    const datei = new File(['x'], 'plan.pdf', { type: 'application/pdf' });
    await legeDokumentAb(7, {
      datei,
      titel: 'Plan',
      kategorie: 'lagekarte_plan',
      bezug: { typ: 'abschnitt', id: 3 },
    });
    const [pfad, init] = fetchMock.mock.calls[0];
    expect(pfad).toBe('/api/einsaetze/7/dokumente');
    const fd = init?.body as FormData;
    expect(fd.get('datei')).toBe(datei);
    expect(fd.get('titel')).toBe('Plan');
    expect(fd.get('kategorie')).toBe('lagekarte_plan');
    expect(fd.get('bezug_typ')).toBe('abschnitt');
    expect(fd.get('bezug_id')).toBe('3');
  });

  it('lässt den Bezug ohne Angabe ganz weg', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 1 }), { status: 201 }),
    );
    await legeDokumentAb(7, { datei: new File(['x'], 'a.pdf'), titel: 'A', kategorie: 'foto' });
    const fd = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(fd.has('bezug_typ')).toBe(false);
    expect(fd.has('bezug_id')).toBe(false);
  });

  it('baut den Download-Pfad', () => {
    expect(dokumentDownloadPfad(7, 42)).toBe('/api/einsaetze/7/dokumente/42/datei');
  });
});
```

Dazu ein `client`-Test: `apiUpload` übergibt das Timeout (mit `vi.spyOn(AbortSignal, 'timeout')` prüfen: ohne Option `15_000`, mit Option `120_000`). `deeplinks.test.ts`: `dokumentePfad(5)` → `'/einsaetze/5/dokumente'`, `dokumentePfad(5, { neu: true })` → `'/einsaetze/5/dokumente?neu=1'`. Das exakte Format aus `schaedenPfad` übernehmen, samt Round-Trip-Stil der Nachbartests. Zähler-Test in der bestehenden `useModulZaehler`-Testdatei: `berechneDokumentZaehler([{},{},{}])` → `{ wert: 3, beschreibung: '3 abgelegte Dokumente' }` und für ein Element `'1 abgelegtes Dokument'`.

Run: `mise exec pnpm@11.10.0 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-lfh-78-0056aa/frontend exec vitest run src/api/dokumente.test.ts src/api/client src/routing src/einsatz`
Expected: FAIL (Module fehlen).

- [ ] **Step 2: Implementieren**

`client.ts`:

```ts
export interface UploadOptionen {
  /** Abbruch nach dieser Zeit. Default 15 s; große Dateien mit AV-Scan brauchen mehr. */
  timeoutMs?: number;
}

export async function apiUpload<T>(
  pfad: string,
  formData: FormData,
  optionen: UploadOptionen = {},
): Promise<T> {
  try {
    const res = await fetch(pfad, {
      method: 'POST',
      credentials: 'same-origin',
      body: formData,
      signal: AbortSignal.timeout(optionen.timeoutMs ?? 15_000),
    });
    if (!res.ok) return fehlerWerfen(res);
    return (await res.json()) as T;
  } catch (e) {
    netzFehlerWerfen(e);
  }
}
```

`api/dokumente.ts`:

```ts
import { apiGet, apiSend, apiUpload } from './client';
import type { Dokument, DokumentKategorie } from './types';

/** 25 MiB + clamd-Scan über eine Mobilfunkstrecke: 15 s reichen nicht (LFH-632). */
export const DOKUMENT_UPLOAD_TIMEOUT_MS = 120_000;

export type DokumentBezugTyp = 'abschnitt' | 'einheit' | 'etb_eintrag';

export interface DokumentAblage {
  datei: File;
  titel: string;
  kategorie: DokumentKategorie;
  bezug?: { typ: DokumentBezugTyp; id: number };
}

const basis = (einsatzId: number) => `/api/einsaetze/${einsatzId}/dokumente`;

export function listeDokumente(einsatzId: number): Promise<Dokument[]> {
  return apiGet<Dokument[]>(basis(einsatzId));
}

export function legeDokumentAb(einsatzId: number, eingabe: DokumentAblage): Promise<Dokument> {
  const fd = new FormData();
  fd.append('datei', eingabe.datei);
  fd.append('titel', eingabe.titel);
  fd.append('kategorie', eingabe.kategorie);
  if (eingabe.bezug) {
    fd.append('bezug_typ', eingabe.bezug.typ);
    fd.append('bezug_id', String(eingabe.bezug.id));
  }
  return apiUpload<Dokument>(basis(einsatzId), fd, { timeoutMs: DOKUMENT_UPLOAD_TIMEOUT_MS });
}

export function entferneDokument(einsatzId: number, dokumentId: number): Promise<void> {
  return apiSend<void>(`${basis(einsatzId)}/${dokumentId}`, 'DELETE');
}

/** Download über die modul-gegatete Route — nie über `/anhaenge` (dort 404, LFH-632 E8). */
export function dokumentDownloadPfad(einsatzId: number, dokumentId: number): string {
  return `${basis(einsatzId)}/${dokumentId}/datei`;
}
```

Die Signaturen von `apiGet`/`apiSend` (DELETE mit 204, Rückgabe `void`) in `client.ts` gegenprüfen und dem Muster eines bestehenden DELETE-Aufrufs folgen, z. B. `grep -n "'DELETE'" frontend/src/api/*.ts | head`. Falls `inlinePfade.guard.test.ts` `api/` erfasst: den Pfad-Bau dort zulassen oder über `deeplinks.ts` führen. Das zeigt der Guard-Lauf.

`dokumente/kategorien.ts`:

```ts
import type { DokumentKategorie } from '../api/types';

/** Label je Kategorie. Ein Record über das generierte Enum: eine neue Backend-Variante bricht
 *  den Typcheck, statt still ohne Label zu erscheinen. */
export const DOKUMENT_KATEGORIEN: Record<DokumentKategorie, { label: string }> = {
  lagekarte_plan: { label: 'Lagekarte/Plan' },
  befehl: { label: 'Befehl' },
  formular: { label: 'Formular' },
  foto: { label: 'Foto' },
  sonstiges: { label: 'Sonstiges' },
};

export const DOKUMENT_KATEGORIE_REIHENFOLGE: DokumentKategorie[] = [
  'lagekarte_plan',
  'befehl',
  'formular',
  'foto',
  'sonstiges',
];
```

`deeplinks.ts`: `dokumentePfad` nach dem Muster von `schaedenPfad` (`:246`).

Zähler: in `ModulZaehlerQuelle` `'dokumente'` ergänzen und im Registry-Eintrag `zaehlerQuelle: 'dokumente'`. In `useModulZaehler.ts`:

```ts
export function berechneDokumentZaehler(dokumente: readonly unknown[]): ModulZaehlerWert {
  const n = dokumente.length;
  return { wert: n, beschreibung: plural(n, 'abgelegtes Dokument', 'abgelegte Dokumente') };
}
```

plus `dokumenteAktiv`, eine `useQuery` mit `einsatzKeys.dokumente(einsatzId)` / `listeDokumente` und der Rückgabeschlüssel `dokumente`. Danach prüfen, ob `ModulPanel.tsx` die Quelle generisch rendert (`grep -n zaehlerQuelle frontend/src/einsatz/ModulPanel.tsx`). Enthält es eine eigene Liste der Quellen, dort ergänzen.

- [ ] **Step 3: Tests laufen lassen** (Kommando aus Step 1) → PASS. Dazu `mise exec pnpm@11.10.0 -- pnpm -C …/frontend exec tsc -b` bzw. das Typecheck-Skript aus `package.json`.

- [ ] **Step 4: Commit**

```bash
rtk git add frontend/src/api frontend/src/dokumente frontend/src/routing frontend/src/einsatz
rtk git commit -m "feat(dokumente): Frontend-API, Upload-Timeout, Deeplink und Modulzähler (LFH-632)"
```

---

### Task 4: Seite „Dokumente“ und Ablegen-Dialog

**Files:**
- Create: `frontend/src/dokumente/DokumentAblegenModal.tsx`, `frontend/src/dokumente/DokumentAblegenModal.test.tsx`, `frontend/src/pages/DokumentePage.tsx`, `frontend/src/pages/DokumentePage.test.tsx`
- Modify: `frontend/src/App.tsx:79-120` (`MODUL_ELEMENTE`), `frontend/src/components/datensicht.guard.test.ts:273-292` (`KONSUMENTEN`)

**Interfaces:**
- Consumes: alles aus Task 3; `ErfassungsModal` (`components/Erfassung.tsx:447`), `EinsatzSeite`, `Datensicht`/`spaltenFuer`, `SeitenZustand`, `SpeicherHinweis`, `darfImEinsatzSchreiben`, `formatGroesse` (`karten/formatGroesse.ts`), Abschnitts-/Einheiten-/ETB-Listen-APIs (`grep -n "export function liste" frontend/src/api/{einsatzabschnitte,einheiten,etb}.ts`)
- Produces: `DokumentePage` (default export wie die Nachbarseiten), `DokumentAblegenModal` mit Props `{ einsatzId: number; offen: boolean; onSchliessen: () => void }`

**Referenz, vorher vollständig lesen:** `frontend/src/pages/SchaedenPage.tsx` und `frontend/src/pages/schaeden/SchadenErfassenModal.tsx`. Die Seite wird **strukturgleich** gebaut.

- [ ] **Step 1: Fehlschlagende Modal-Tests** (`DokumentAblegenModal.test.tsx`, Render-Helfer aus `test/utils.tsx` wie im `SchadenErfassenModal`-Test)

Zu belegende Aussagen, jede als eigener `it`:
1. Sichtbar sind genau **drei** Felder: Datei, Kategorie, Titel. Der Bezug liegt in einem `Collapse` mit `forceRender`. Zähler der Formularsteuerelemente vor dem Aufklappen = 3 (Datei-Input + Kategorie-Select + Titel-Input), **nach** dem Aufklappen > 3. Beide Hälften prüfen (CLAUDE.md Feldbudget).
2. Die Dateiwahl füllt einen **leeren** Titel mit dem Dateinamen ohne Endung (`Lageplan Nord.pdf` → `Lageplan Nord`), überschreibt aber keinen schon getippten Titel. Das ist ein Paar.
3. Absenden ruft `legeDokumentAb` mit `{ datei, titel, kategorie }` und ohne `bezug`; mit gewähltem Abschnitt kommt `bezug: { typ: 'abschnitt', id }` dazu (Select-Wert `abschnitt:<id>`, am Präfix getrennt).
4. Eine abgelehnte Mutation (`mockRejectedValue(new ApiError(400, 'Dateityp … nicht erlaubt'))`) lässt Titel und Datei stehen, der Fehltext steht **im Dialog** (`SpeicherFehler`), nicht nur im Toast.
5. Nach Erfolg schließt der Dialog, und beim erneuten Öffnen sind alle Felder leer (Reset über die Hülle, `fileList` inklusive).
6. Struktur statt Tastendruck: kein `.ant-modal-footer`, und `knopf.closest('form')` ist nicht `null` (Muster `components/Erfassung.test.tsx`).

Run: `mise exec pnpm@11.10.0 -- pnpm -C …/frontend exec vitest run src/dokumente`
Expected: FAIL.

- [ ] **Step 2: `DokumentAblegenModal.tsx` implementieren**

Bauform:
- `ErfassungsModal` mit `titel="Dokument ablegen"`, `onErfassen={(werte) => mutation.mutateAsync(zuAblage(werte))}` (**`mutateAsync`**, damit eine Ablehnung die Felder stehen lässt), `erfassenText="Ablegen"`, kein `serie`.
- Feld `datei`: `Form.Item name="datei" label="Datei" valuePropName="fileList" getValueFromEvent={(e) => (Array.isArray(e) ? e : e?.fileList)} rules={[{ required: true, message: 'Bitte eine Datei wählen' }]}` mit `<Upload beforeUpload={() => false} maxCount={1} accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.txt,.csv,.docx,.xlsx,.pptx">` und einem `<Button icon={<UploadOutlined />}>Datei wählen</Button>` (ohne `size`). Die Datei ist Pflicht und steht **nie** hinter dem Collapse.
- Titel-Vorbelegung: `onChange` am Upload → wenn `form.getFieldValue('titel')` leer ist, `form.setFieldValue('titel', name.replace(/\.[^.]+$/, ''))`.
- Feld `kategorie`: `Select` mit Optionen aus `DOKUMENT_KATEGORIE_REIHENFOLGE`/`DOKUMENT_KATEGORIEN`, Pflicht. **Keine** Vorbelegung, damit der Mensch bewusst wählt.
- Feld `titel`: `Input` mit `maxLength={200}` und Pflicht.
- `Collapse` mit `forceRender`, Kopf „Bezug (optional)“, darin **ein** `Select` `bezug` mit `allowClear`, `showSearch`, `optionFilterProp="label"` und drei Options-Gruppen: „Abschnitte“ (`abschnitt:<id>`), „Einheiten“ (`einheit:<id>`), „ETB-Einträge“ (`etb_eintrag:<id>`, Label `ETB <lfd_nr> · <inhalt gekürzt 60>`). Die Daten kommen aus den bestehenden Listen-Queries (`einsatzKeys.*`, keine neuen Keys). Die ETB-Query nur laden, wenn der Collapse offen ist (`enabled`), damit der Dialog nicht das ganze Tagebuch zieht.
- `zuAblage(werte)` trennt `bezug` am `:`.
- Erfolg: `queryClient.invalidateQueries({ queryKey: einsatzKeys.dokumente(einsatzId) })` und `einsatzKeys.etb(einsatzId)` (den Accessor-Namen prüfen), Toast „Dokument abgelegt“ über `App.useApp().message` (nicht statisch, Memory `antd-statisches-modal-leakt-in-tests`).

- [ ] **Step 3: Modal-Tests → PASS**

- [ ] **Step 4: Fehlschlagende Seiten-Tests** (`DokumentePage.test.tsx`, Muster `SchaedenPage.test.tsx`)

Aussagen:
1. Die Liste zeigt Titel, Kategorie-Label, Dateigröße (`formatGroesse`), Bezug (Name bzw. `ETB <nr>`), Verfasser und Zeit. Der Titel ist ein echtes `<a>` mit `href=dokumentDownloadPfad(e, id)` (`getByRole('link', { name: 'Lageplan Nord' })`).
2. Leerzustand bei 0 Dokumenten: `leerText` „Noch keine Dokumente abgelegt.“
3. Filter: der Spaltenfilter „Kategorie“ mit Werten aus `DOKUMENT_KATEGORIEN` reduziert die Zeilen. Das Öffnen des Filters dem Muster aus `SchaedenPage.test.tsx` entnehmen.
4. Mit Schreibrecht: „Dokument ablegen“ steht im Kopf-Slot (`data-lfh="seitenkopf-aktionen"`) und öffnet den Dialog; `?neu=1` öffnet ihn ebenfalls.
5. Ohne Schreibrecht (Beobachter): der Knopf steht **gesperrt** da (nicht fehlend), darüber ein `RechteHinweis`, und es gibt **keinen** „Entfernen“-Knopf in den Zeilen. Das ist ein Paar mit Aussage 6.
6. Mit Schreibrecht: „Entfernen“ je Zeile (`danger`, zugänglicher Name `Dokument Lageplan Nord entfernen`). Der Klick öffnet eine Rückfrage, deren OK-Knopf `danger` trägt (`.ant-btn-dangerous`). Nach Bestätigung wird `entferneDokument(e, id)` aufgerufen.
7. Einsatz-Query scheitert → `SeitenFehler`; Liste scheitert ohne Daten → `SeitenFehler` an der Stelle der Liste.

- [ ] **Step 5: `DokumentePage.tsx` implementieren**

Strukturgleich zu `SchaedenPage.tsx`:
- Queries: Einsatz + `einsatzKeys.dokumente(einsatzId)`/`listeDokumente`.
- `EinsatzSeite` mit `titel="Dokumente"`, `beschreibung` wie in der Registry, `aktionen` = **ein** Primärknopf „Dokument ablegen“ (`disabled={!darfSchreiben}`), `hinweis={<SeitenHinweise rechte={!darfSchreiben ? <RechteHinweis …/> : null} …/>}` (Props aus `SpeicherHinweis.tsx` ablesen), `neueZeile` nach dem Schäden-Muster.
- `Datensicht` mit `bezeichnung="Dokumente"`, `form="auto"`, `zeilenSchluessel={(d) => d.id}`, `standardSortierung` nach `abgelegt_at` absteigend, `suche` über Titel, Dateiname und Verfasser. Spalten über `spaltenFuer<Dokument>()`:
  - `titel` (`immerSichtbar`, Identifier-Spalte): `render` = `<a href={dokumentDownloadPfad(einsatzId, d.id)}>{d.titel}</a>`. Das ist ein echter Anker, also greift der Anker-Riegel der Datensicht. Kein `onZeileKlick`.
  - `kategorie`: Label, `filter: { werte: DOKUMENT_KATEGORIE_REIHENFOLGE.map(k => ({ wert: k, text: DOKUMENT_KATEGORIEN[k].label })), trifft: (d, w) => d.kategorie === w }` (die exakte Filter-Signatur aus `Datensicht.tsx:154-192` übernehmen).
  - `bezug`: Text (`d.bezug_abschnitt_name ?? d.bezug_einheit_name ?? (d.bezug_etb_lfd_nr != null ? \`ETB ${d.bezug_etb_lfd_nr}\` : '—')`), mit Filter „mit/ohne Bezug“ und nur **ab `lg`** sichtbar (`abBreite`).
  - `datei`: `dateiname · formatGroesse(groesse)`, `abBreite: 'xl'`.
  - `abgelegt`: `abgelegt_von_name ?? '—'` + Zeit im Format der Nachbarseiten (`grep -n "formatZeit\|dayjs" pages/SchaedenPage.tsx`).
  - `aktion` (nur mit Schreibrecht): `Popconfirm title="Dokument entfernen?" description="Es verschwindet aus der Liste; der ETB-Nachweis bleibt." okText="Entfernen" okButtonProps={{ danger: true }}` um `<Button danger type="text" icon={<DeleteOutlined />} aria-label={\`Dokument ${d.titel} entfernen\`} />`. Es ist eine einzige Aktion, also keine Bündelung.
  - Karte (`form="auto"` unter `md`): Titel = derselbe Link, Status = Kategorie-Label, höchstens drei Sekundärfelder (Bezug, Datei, Abgelegt), eine Primäraktion = Entfernen (nur mit Schreibrecht). Bei den Kartenplan-Props nachsehen, wie der Titel als Link gesetzt wird. Wenn `titel.ziel` nur eine Route akzeptiert, `titel.render` o. ä. nutzen; sonst die Karte ohne Link lassen und den Download als Primäraktion anbieten. **Die Entscheidung im Dateikopf begründen.**
- Zustände: `SeitenSkeleton`/`SeitenFehler`/`SeitenStandVeraltet` wie `SchaedenPage.tsx:234-266`.
- Entfernen: `useMutation(entferneDokument)`, nach Erfolg invalidieren (Dokumente + ETB) und ein Toast „Dokument entfernt“. Einen Fehler zeigt `SpeicherFehler` im `hinweis`-Slot.
- `App.tsx`: `dokumente: <DokumentePage />` in `MODUL_ELEMENTE` (gekeyt nach Modul-Key).
- `datensicht.guard.test.ts`: `'pages/DokumentePage.tsx'` in `KONSUMENTEN` im vorhandenen Format.

- [ ] **Step 6: Seiten-Tests + Guards → PASS**

Run: `mise exec pnpm@11.10.0 -- pnpm -C …/frontend exec vitest run src/pages/DokumentePage src/dokumente src/components`
Danach die **volle** Vitest-Suite (`… exec vitest run`) und `pnpm lint`. Der Grund: Guards wie `dichte.guard`, `aktionsabstand.guard`, `queryKeys.guard`, `inlinePfade.guard` und `schreibrecht.guard` greifen repo-weit (Memory `sdd-implementer-yield-scoped-gates`: Frontend-Tasks brauchen die volle Suite).
Expected: PASS, 0 Lint-Warnungen.

- [ ] **Step 7: Commit**

```bash
rtk git add frontend/src
rtk git commit -m "feat(dokumente): Seite Dokumente mit Ablegen-Dialog, Filter, Download und Entfernen (LFH-632)"
```

---

### Task 5: Browser-Nachweis, Prüfliste, Gesamt-Gate

**Files:**
- Create: `e2e/dokumente.spec.ts`, `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`

- [ ] **Step 1: e2e-Spec schreiben**

Muster und Fixtures aus einer bestehenden Modul-Spec übernehmen (`ls frontend/e2e` bzw. `e2e/`, z. B. eine Stab- oder Schaden-Spec; Login-Helfer und Einsatz-Fixture wiederverwenden). Fixture-Namen **ohne** Modulnamen (Memory `e2e-fixture-namen-ohne-modulnamen`). Ablauf:
1. Einsatz öffnen, Modul „Dokumente“ über die Navigation ansteuern. Das Modulpanel zeigt den Zähler 0 bzw. keinen Zähler.
2. „Dokument ablegen“ → Datei per `setInputFiles` (Puffer `%PDF-1.4 e2e`, Name `Lageplan Nord.pdf`). Erwartet: der Titel ist mit „Lageplan Nord“ vorbelegt. Kategorie „Lagekarte/Plan“ wählen, „Ablegen“.
3. Zeile „Lageplan Nord“ ist sichtbar (`toBeInViewport()`), der Zähler im Modulpanel steht auf 1.
4. Zweites Dokument „Foto Zufahrt“ mit Kategorie Foto (`.jpg`). Den Kategorie-Filter auf „Foto“ setzen → nur „Foto Zufahrt“ sichtbar.
5. Download: `const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Lageplan Nord' }).click()])`, `download.suggestedFilename()` ist `Lageplan Nord.pdf`.
6. Entfernen mit Rückfrage → die Zeile ist weg.
7. Bei 1280 px und 390 px Breite messen, dass es keinen waagerechten Seiten-Scroll gibt (`document.documentElement.scrollWidth <= clientWidth`). Unter `md` erscheint die Kartenform.

Run: `mise exec pnpm@11.10.0 -- pnpm -C …/frontend e2e -- dokumente` (Script-Name in `frontend/package.json` prüfen; die Suite startet Backend und Vite selbst, das Debug-Binary muss gebaut sein → vorher `cargo build`).
Expected: PASS.

- [ ] **Step 2: Prüfliste schreiben**

`docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md` im Format von `docs/superpowers/specs/2026-09-13-lfh-46-pruefliste.md` (vorher vollständig lesen). Die 15 Kriterien stehen im Wortlaut in `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md` (Festlegung 7, ab `:372`). Zwei Flächen: **Liste** (`DokumentePage`) und **Dialog** (`DokumentAblegenModal`). Jede Zeile trägt ein Verdikt: erfüllt (mit Testdatei und Testname oder Messung und Commit), offen → Zielticket, oder nicht anwendbar (mit Begründung). „Nicht geprüft“ ist kein Verdikt. Gate 3 (Trefffläche): es gibt keine handgebauten Bedienziele, nur antd-Steuerelemente und einen Inline-Anker in der Tabellenzelle. Der Anker ist Tabellen-Text wie bei `Datensicht` (CLAUDE.md: die eine Angabe trägt in einer Zelle ohne `nowrap`-Kopf); das Verdikt dort begründen. Offene Punkte werden über den Skill `clickup-task-anlegen` als Tickets angelegt. Die Kandidaten, jeweils nur wenn sie zutreffen:
  - Offline-Ablage (Queue mit `client_id`) für große Dateien
  - Vorschau (Bild/PDF-Quick-View)
  - EXIF-/GPS-Entfernung aus Fotos
  - Metadaten nachträglich ändern

- [ ] **Step 3: Gesamt-Gate**

Run: `./scripts/check-all.sh`
Expected: alle Schritte grün, e2e inklusive. Ist etwas rot: die Ursache beheben, nicht umgehen. Flakes unter Last einzeln nachlaufen lassen und im Bericht benennen (Memory `frontend-testsuite-parallel-timeouts`).

- [ ] **Step 4: Migrationsnummer gegen `origin/alpha` prüfen**

```bash
rtk git fetch origin && git ls-tree --name-only origin/alpha migrations/ | tail -3
```

Belegt `alpha` inzwischen `0104`: rebasen, die Migration umbenennen und das Gate wiederholen.

- [ ] **Step 5: Commit**

```bash
rtk git add e2e docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md
rtk git commit -m "test(dokumente): Browser-Nachweis und Prüfliste Einsatztauglichkeit (LFH-632)"
```

---

## Self-Review (vom Planautor durchgeführt)

- **Spec-Abdeckung:** Upload (T2/T4) · Kategorie (T2 Enum, T3 Labels) · Titel (T2 Validierung, T4 Vorbelegung) · Bezug Abschnitt/Einheit/ETB (T1 Schema, T2 Prüfung, T4 Select) · Verfasser + Zeit (T2 `abgelegt_von_name`/`abgelegt_at`, T4 Spalte) · Anhang-Infra + AV-Scan (T2 `anhang::scan`, `anlegen_tx`) · zweiter Linker nach Tombstone (T1) · Registry + `MODUL_KEYS`/`PFAD_KEY` (T2) · ETB-Kopplung (T2, E2) · AK ablegen/filtern/herunterladen (T2 Tests, T4, T5 e2e) · einsatzgebunden 404 (T2 Test 9) · Prüfliste (T5). Entscheidungen E1–E4 sind in T2/T3/T4 umgesetzt.
- **Typkonsistenz:** `LinkerStand`/`linker_stand`/`ist_dokument`/`generischer_download_gesperrt` (T1) sind in T1 Step 7 verwendet; `anlegen_tx` (T1) in T2 `repo::ablegen`; `DokumentKategorie::label` (T2) im ETB-Text, übereinstimmend mit `DOKUMENT_KATEGORIEN` (T3); `dokumentDownloadPfad` (T3) in T4; `einsatzKeys.dokumente` (T2) in T3/T4.
- **Bewusst offen gelassen, im Task benannt:** Messung `mime_guess` für HEIC (T2 Step 3), Kartenplan-Titel-Link (T4 Step 5), Parser-Form der Route-Kette (T2 Step 6). Das sind Messpunkte mit festgelegter Rückfallregel, keine Platzhalter.
