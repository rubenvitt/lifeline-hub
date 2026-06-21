# Befehlsgebung (LFH-64) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Strukturierte Befehlsgebung als dokument-shaped Modul (eigenes `befehl`-Entity), das die LFH-48-Lagebericht-Mechanik spiegelt und UI-seitig als Tab im bestehenden `auftraege`-Modul erscheint.

**Architecture:** Eigenes `befehl`-Entity (Tabelle, Repo, Routes) als 1:1-Mirror von `lagebericht` — Lebenszyklus Entwurf→Freigabe→unveränderlicher ETB-Snapshot→Druck, inkl. Fortschreibung (version/vorgaenger_id). Snapshot landet als `etb_eintrag` mit `typ='anordnung'` (BOS: Befehl = Anordnung; kein CHECK-Rebuild). Frontend: API-Client + 4 Code-Vorlagen (LAD/LADEF/SCHNEE/EA-ZMW) + Detail-Page (Mirror von LageberichtDetailPage) + Befehls-Liste als zweiter Tab in der AuftraegePage.

**Tech Stack:** Rust (axum, sqlx-sqlite), React + TypeScript (antd, @tanstack/react-query, react-router), Vitest.

## Global Constraints

- Backend-`VORLAGEN` (`src/befehl/mod.rs`) und Frontend-`VORLAGEN` (`frontend/src/befehle/vorlagen.ts`) MÜSSEN synchron bleiben: **identische Schlüssel + Reihenfolge je Vorlage**. Labels/Hilfetexte dürfen kosmetisch abweichen.
- ETB-Snapshot-Typ ist `etb::TYP_ANORDNUNG` (`"anordnung"`) — NICHT `"lage"`.
- Schreibrecht nur Einsatzleitung/Führungspersonal; Lesezugriff inkl. Beobachter. Modul-Key für Berechtigung: `"auftraege"` (Befehlsgebung lebt im Aufträge-Modul).
- Abschnitts-`hilfetext` ist **Frontend-only** (Eingabehilfe). Das Backend rendert nur `label` + Inhalt — die Backend-`AbschnittDef` bleibt `{schluessel, label}`.
- Commit-Messages enden mit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` und referenzieren `LFH-64`.
- Backend-Tests: `cargo test befehl`. Frontend-Tests gezielt mit `mise exec pnpm@<ver> -- pnpm -C <abs> vitest run <datei>` (volle Suite ist unter Last flaky).

---

### Task 1: Migration — `befehl`-Tabelle + ETB-Rückverweis

**Files:**
- Create: `migrations/0073_befehl.sql`
- Test: `src/befehl/mod.rs` (temporärer Smoke-Test, in Task 2 ersetzt)

**Interfaces:**
- Produces: Tabelle `befehl` (Spalten wie unten), additive Spalte `etb_eintrag.befehl_id`.

- [ ] **Step 1: Migration schreiben**

Create `migrations/0073_befehl.sql` (gespiegelt von `0038_lagebericht.sql`, `vorlage`-CHECK angepasst):

```sql
-- LFH-64: strukturierte Befehlsgebung. Eigenes dokument-shaped Entity (Mirror von
-- lagebericht/0038); editierbarer Entwurf, bei Freigabe unveränderlicher Snapshot als
-- etb_eintrag (typ='anordnung'). UI-seitig im auftraege-Modul (Tab), datenmodell eigenständig.
CREATE TABLE befehl (
    id                 INTEGER PRIMARY KEY,
    einsatz_id         INTEGER NOT NULL REFERENCES einsatz(id) ON DELETE CASCADE,
    vorlage            TEXT NOT NULL
                       CHECK (vorlage IN ('befehl_lad','befehl_ladef','befehl_schnee','befehl_ea_zmw')),
    titel              TEXT NOT NULL,
    zeitstand          TEXT NOT NULL,            -- beschriebener Befehls-Zeitpunkt (SQLite-Format)
    status             TEXT NOT NULL DEFAULT 'entwurf'
                       CHECK (status IN ('entwurf','freigegeben')),
    -- Gefüllte Abschnitte als JSON-Array [{schluessel, text}], Reihenfolge = Vorlage.
    abschnitte         TEXT NOT NULL,
    version            INTEGER NOT NULL DEFAULT 1,
    vorgaenger_id      INTEGER REFERENCES befehl(id),  -- Fortschreibungs-Kette
    ersteller_id       INTEGER NOT NULL REFERENCES benutzer(id),
    erstellt_at        TEXT NOT NULL DEFAULT (datetime('now')),
    aktualisiert_at    TEXT NOT NULL DEFAULT (datetime('now')),
    freigegeben_von_id INTEGER REFERENCES benutzer(id),
    freigegeben_at     TEXT,
    etb_eintrag_id     INTEGER REFERENCES etb_eintrag(id)   -- gesetzt bei Freigabe
);

CREATE INDEX idx_befehl_einsatz ON befehl(einsatz_id, status, zeitstand);

-- Additive Rückverlinkung in der ETB-Timeline (Badge "Befehl"). Nullable ADD COLUMN
-- ist sicher und berührt die FTS-Trigger nicht.
ALTER TABLE etb_eintrag ADD COLUMN befehl_id INTEGER REFERENCES befehl(id);
```

- [ ] **Step 2: Smoke-Test schreiben**

Create `src/befehl/mod.rs` mit nur diesem Test (wird in Task 2 erweitert):

```rust
#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn migration_legt_befehl_tabelle_an() {
        let pool = crate::db::test_pool().await;
        // Tabelle existiert + akzeptiert Insert mit gültiger Vorlage.
        sqlx::query("INSERT OR IGNORE INTO organisation (id, name) VALUES (1, 'O')").execute(&pool).await.unwrap();
        sqlx::query("INSERT OR IGNORE INTO benutzer (org_id, anzeigename, benutzername, passwort_hash) VALUES (1,'L','l','h')").execute(&pool).await.unwrap();
        let eid: i64 = sqlx::query_scalar("INSERT INTO einsatz (org_id, bezeichnung) VALUES (1,'E') RETURNING id").fetch_one(&pool).await.unwrap();
        let uid: i64 = sqlx::query_scalar("SELECT id FROM benutzer WHERE benutzername='l'").fetch_one(&pool).await.unwrap();
        let bid: i64 = sqlx::query_scalar(
            "INSERT INTO befehl (einsatz_id, vorlage, titel, zeitstand, abschnitte, ersteller_id) \
             VALUES (?, 'befehl_lad', 'T', '2026-06-02 10:00:00', '[]', ?) RETURNING id")
            .bind(eid).bind(uid).fetch_one(&pool).await.unwrap();
        // etb_eintrag.befehl_id existiert (additive Spalte).
        sqlx::query("SELECT befehl_id FROM etb_eintrag WHERE 0 = 1").fetch_optional(&pool).await.unwrap();
        assert!(bid > 0);
    }
}
```

Register the module: add `pub mod befehl;` to `src/lib.rs` next to `pub mod lagebericht;` (line ~24).

- [ ] **Step 3: Run test — verify it fails then passes**

Run: `cargo test -p <crate> befehl::tests::migration_legt_befehl_tabelle_an`
Expected: PASS (test_pool führt alle Migrationen inkl. 0073 aus).
If it fails to compile because `pub mod befehl;` missing → add it.

- [ ] **Step 4: Commit**

```bash
git add migrations/0073_befehl.sql src/befehl/mod.rs src/lib.rs
git commit -m "feat(befehl): Migration befehl-Tabelle + ETB-Rückverweis (LFH-64)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Backend `befehl/mod.rs` — Vorlagen, Render, Validierung

**Files:**
- Modify: `src/befehl/mod.rs` (Smoke-Test aus Task 1 ersetzen)

**Interfaces:**
- Consumes: `crate::error::AppError`.
- Produces: `STATUS_ENTWURF`, `STATUS_FREIGEGEBEN`, `AbschnittDef{schluessel,label}`, `VorlageDef{schluessel,label,abschnitte}`, `VORLAGEN`, `fn vorlage(&str)->Option<&VorlageDef>`, `struct Abschnitt{schluessel,text}` (Serialize/Deserialize), `fn leere_abschnitte`, `fn render_snapshot`, `fn validiere_freigabe`.

This is a 1:1 mirror of `src/lagebericht/mod.rs`. Copy that file's structure verbatim, replacing **only** the `VORLAGEN` registry and the test expectations.

- [ ] **Step 1: Mirror `src/lagebericht/mod.rs` into `src/befehl/mod.rs`**

Keep `pub mod repo;` at top (repo added in Task 3 — for now comment it out or add an empty repo in Task 3; to keep this task self-contained, do NOT add `pub mod repo;` yet). Copy verbatim: `STATUS_*` consts, `AbschnittDef`, `VorlageDef`, `vorlage()`, `Abschnitt`, `leere_abschnitte()`, `render_snapshot()`, `validiere_freigabe()` (identical bodies). Replace the doc comment referencing `frontend/src/lageberichte/vorlagen.ts` with `frontend/src/befehle/vorlagen.ts`.

Replace `VORLAGEN` with:

```rust
pub const VORLAGEN: &[VorlageDef] = &[
    VorlageDef {
        schluessel: "befehl_lad",
        label: "Befehl LAD (vereinfacht)",
        abschnitte: &[
            AbschnittDef { schluessel: "lage", label: "Lage" },
            AbschnittDef { schluessel: "auftrag", label: "Auftrag" },
            AbschnittDef { schluessel: "durchfuehrung", label: "Durchführung" },
        ],
    },
    VorlageDef {
        schluessel: "befehl_ladef",
        label: "Befehl LADEF (erweitert, SKK)",
        abschnitte: &[
            AbschnittDef { schluessel: "lage", label: "Lage" },
            AbschnittDef { schluessel: "auftrag", label: "Auftrag" },
            AbschnittDef { schluessel: "durchfuehrung", label: "Durchführung" },
            AbschnittDef { schluessel: "einsatzunterstuetzung", label: "Einsatzunterstützung" },
            AbschnittDef { schluessel: "fuehrung_kommunikation", label: "Führung und Kommunikation" },
        ],
    },
    VorlageDef {
        schluessel: "befehl_schnee",
        label: "Befehl SCHNEE",
        abschnitte: &[
            AbschnittDef { schluessel: "schadenlage", label: "Schadenlage" },
            AbschnittDef { schluessel: "nachbarn", label: "Nachbarn" },
            AbschnittDef { schluessel: "entschluss", label: "Entschluss / Absicht" },
            AbschnittDef { schluessel: "einzelauftrag", label: "Einzelauftrag" },
            AbschnittDef { schluessel: "eigener_standort", label: "Eigener Standort" },
        ],
    },
    VorlageDef {
        schluessel: "befehl_ea_zmw",
        label: "Einzelauftrag (EA/ZMW)",
        abschnitte: &[
            AbschnittDef { schluessel: "einheit", label: "Einheit" },
            AbschnittDef { schluessel: "auftrag_ziel", label: "Auftrag / Ziel" },
            AbschnittDef { schluessel: "mittel", label: "Mittel" },
            AbschnittDef { schluessel: "weg", label: "Weg" },
        ],
    },
];
```

- [ ] **Step 2: Replace the test module**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vorlagen_haben_erwartete_abschnittszahl() {
        assert_eq!(vorlage("befehl_lad").unwrap().abschnitte.len(), 3);
        assert_eq!(vorlage("befehl_ladef").unwrap().abschnitte.len(), 5);
        assert_eq!(vorlage("befehl_schnee").unwrap().abschnitte.len(), 5);
        assert_eq!(vorlage("befehl_ea_zmw").unwrap().abschnitte.len(), 4);
        assert!(vorlage("unsinn").is_none());
    }

    #[test]
    fn abschnitts_schluessel_sind_eindeutig_pro_vorlage() {
        for v in VORLAGEN {
            let mut keys: Vec<&str> = v.abschnitte.iter().map(|a| a.schluessel).collect();
            keys.sort_unstable();
            let vorher = keys.len();
            keys.dedup();
            assert_eq!(keys.len(), vorher, "Doppelter Abschnitts-Schlüssel in {}", v.schluessel);
        }
    }

    #[test]
    fn leere_abschnitte_folgt_vorlagen_reihenfolge() {
        let v = vorlage("befehl_lad").unwrap();
        let leer = leere_abschnitte(v);
        assert_eq!(leer.len(), 3);
        assert_eq!(leer[0].schluessel, "lage");
        assert_eq!(leer[2].schluessel, "durchfuehrung");
        assert!(leer.iter().all(|a| a.text.is_empty()));
    }

    #[test]
    fn render_ist_deterministisch_und_in_reihenfolge() {
        let v = vorlage("befehl_lad").unwrap();
        let abschnitte = vec![Abschnitt { schluessel: "lage".into(), text: "Hochwasser.".into() }];
        let a = render_snapshot(v, "Befehl 1", "2026-06-02 10:00:00", &abschnitte);
        let b = render_snapshot(v, "Befehl 1", "2026-06-02 10:00:00", &abschnitte);
        assert_eq!(a, b);
        assert!(a.contains("# Befehl 1"));
        assert!(a.contains("## Lage"));
        assert!(a.contains("Hochwasser."));
        // Reihenfolge: Lage vor Auftrag vor Durchführung.
        assert!(a.find("## Lage").unwrap() < a.find("## Auftrag").unwrap());
    }

    #[test]
    fn validierung_verlangt_alle_abschnitts_schluessel() {
        let v = vorlage("befehl_lad").unwrap();
        assert!(validiere_freigabe(v, &[]).is_err());
        let teil = vec![Abschnitt { schluessel: "lage".into(), text: "X".into() }];
        assert!(validiere_freigabe(v, &teil).is_err(), "fehlende Abschnitte → Fehler");
        let voll = v.abschnitte.iter()
            .map(|d| Abschnitt { schluessel: d.schluessel.into(), text: "x".into() })
            .collect::<Vec<_>>();
        assert!(validiere_freigabe(v, &voll).is_ok());
    }
}
```

- [ ] **Step 3: Run tests**

Run: `cargo test befehl::tests`
Expected: PASS (5 tests).

- [ ] **Step 4: Commit**

```bash
git add src/befehl/mod.rs
git commit -m "feat(befehl): Befehlsschemata LAD/LADEF/SCHNEE/EA-ZMW + Render/Validierung (LFH-64)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Backend `befehl/repo.rs` — CRUD, Freigabe, Fortschreibung

**Files:**
- Create: `src/befehl/repo.rs`
- Modify: `src/befehl/mod.rs` (add `pub mod repo;` at top)

**Interfaces:**
- Consumes: `super::{leere_abschnitte, vorlage, Abschnitt, STATUS_ENTWURF, STATUS_FREIGEGEBEN}`, `crate::etb::{self, repo as etb_repo}`.
- Produces: `BefehlAnzeige` (same fields as `LageberichtAnzeige`), `BefehlPatch<'a>`, `liste`, `laden`, `anlegen`, `aktualisiere`, `freigeben`, `fortschreiben`.

1:1 mirror of `src/lagebericht/repo.rs`. Copy verbatim and apply these exact replacements:
- Type rename: `LageberichtAnzeige` → `BefehlAnzeige`, `LageberichtPatch` → `BefehlPatch`.
- Table name in all SQL: `lagebericht` → `befehl`; SELECT alias `l` may stay `l` (or rename to `b`, but then update `b1`/`b2` benutzer-aliases to avoid clash — **keep `l` to be safe**).
- In `freigeben`: ETB type `etb::TYP_LAGE` → **`etb::TYP_ANORDNUNG`**; reverse-link column `lagebericht_id` → **`befehl_id`** (i.e. `UPDATE etb_eintrag SET befehl_id = ? WHERE id = ?`).
- Test module: rename helper expectations; use befehl vorlagen.

- [ ] **Step 1: Add `pub mod repo;`**

In `src/befehl/mod.rs`, add as the first line: `pub mod repo;`

- [ ] **Step 2: Write `src/befehl/repo.rs`**

Mirror `src/lagebericht/repo.rs` exactly (struct `BefehlAnzeige` with identical fields, `BefehlPatch`, `Row`, `SELECT` from `befehl l`, `zu_anzeige`, `liste`, `laden`, `anlegen`, `aktualisiere`, `freigeben`, `fortschreiben`). Critical diffs in `freigeben`:

```rust
    let etb_id = etb_repo::anlegen_tx(
        &mut *tx,
        einsatz_id,
        freigeber_id,
        etb_startwert,
        etb_repo::EintragDaten {
            typ: etb::TYP_ANORDNUNG,   // Befehl = Anordnung (NICHT TYP_LAGE)
            inhalt: render,
            von: None, an: None, meldeweg: None, veranlassung: None,
            ereigniszeit: Some(zeitstand),
            erfasst_lokal_at: None,
            berichtigt_eintrag_id: None,
        },
    ).await?;

    // Rückverweis vom ETB-Eintrag auf den Befehl.
    sqlx::query("UPDATE etb_eintrag SET befehl_id = ? WHERE id = ?")
        .bind(id).bind(etb_id).execute(&mut *tx).await?;
```
The `UPDATE befehl SET status = ? ...` block and rollback logic stay identical (table `befehl`).

- [ ] **Step 3: Write the test module**

Mirror the `lagebericht/repo.rs` tests (`setup`, `anlegen_erzeugt_entwurf_mit_skelett`, `fremder_einsatz_ist_notfound`, `aktualisiere_setzt_abschnitte`, `aktualisiere_nach_freigabe_ist_notfound`, `freigeben_schreibt_etb_und_macht_immutable`, `fortschreiben_erzeugt_version_2_mit_vorgaenger`, `fortschreiben_nur_aus_freigegebenem`). Replace vorlage keys: use `"befehl_ladef"` where a multi-section template is needed and `"befehl_lad"` for the simple one (there is no `freitext` here). For the single-section assertions use a real key, e.g. for `aktualisiere_setzt_abschnitte` set abschnitt `{schluessel:"lage", text:"Inhalt"}` on a `"befehl_lad"` befehl. The ETB count assertion changes to:

```rust
        let anzahl: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM etb_eintrag WHERE einsatz_id = ? AND typ = 'anordnung' AND befehl_id = ?",
        ).bind(einsatz).bind(b.id).fetch_one(&pool).await.unwrap();
        assert_eq!(anzahl, 1);
```

Note: a fully-filled befehl for freigabe must fill **all** vorlage sections (validiere_freigabe requires structure). Use a helper that maps `vorlage(key).abschnitte` to filled `Abschnitt`s.

- [ ] **Step 4: Run tests**

Run: `cargo test befehl::repo`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/befehl/mod.rs src/befehl/repo.rs
git commit -m "feat(befehl): Repo CRUD + Freigabe-Snapshot (typ=anordnung) + Fortschreibung (LFH-64)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Backend `routes/befehl.rs` + Router-Verdrahtung

**Files:**
- Create: `src/routes/befehl.rs`
- Modify: `src/routes/mod.rs` (add `pub mod befehl;` near line 23), `src/app.rs` (add 6 routes after line 226)

**Interfaces:**
- Consumes: `befehl::repo::{BefehlAnzeige, BefehlPatch}`, `befehl::{render_snapshot, validiere_freigabe, vorlage, Abschnitt, STATUS_ENTWURF}`.
- Produces: `liste`, `detail`, `anlegen`, `aktualisieren`, `freigeben`, `fortschreiben` handlers.

1:1 mirror of `src/routes/lagebericht.rs`. Apply replacements:
- imports/paths `lagebericht` → `befehl`, types `Lagebericht*` → `Befehl*`.
- `const MODUL_KEY: &str = "lageberichte";` → **`"auftraege"`**.
- SSE event tag `"lagebericht"` → `"befehl"`; JSON key `"lagebericht_id"` → `"befehl_id"`; fn `sse_lagebericht` → `sse_befehl`.
- The ETB live-publish block in `freigeben` stays identical (uses `anzeige.etb_eintrag_id`).

- [ ] **Step 1: Write `src/routes/befehl.rs`** — mirror of `src/routes/lagebericht.rs` with the replacements above. Keep all `fordere_*` authorization calls identical.

- [ ] **Step 2: Wire the module** — in `src/routes/mod.rs` add `pub mod befehl;` next to `pub mod lagebericht;`.

- [ ] **Step 3: Add routes in `src/app.rs`** (immediately after the lagebericht routes, ~line 226):

```rust
.route("/api/einsaetze/{id}/befehle", get(routes::befehl::liste))
.route("/api/einsaetze/{id}/befehle", post(routes::befehl::anlegen))
.route("/api/einsaetze/{id}/befehle/{bid}", get(routes::befehl::detail))
.route("/api/einsaetze/{id}/befehle/{bid}", patch(routes::befehl::aktualisieren))
.route("/api/einsaetze/{id}/befehle/{bid}/freigeben", post(routes::befehl::freigeben))
.route("/api/einsaetze/{id}/befehle/{bid}/fortschreiben", post(routes::befehl::fortschreiben))
```

- [ ] **Step 4: Compile + full backend test**

Run: `cargo test befehl` then `cargo build`
Expected: PASS, builds clean (no unused-import warnings on befehl).

- [ ] **Step 5: Commit**

```bash
git add src/routes/befehl.rs src/routes/mod.rs src/app.rs
git commit -m "feat(befehl): HTTP-Routen /api/einsaetze/{id}/befehle (LFH-64)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend — Typen, API-Client, Vorlagen (mit Hilfetext)

**Files:**
- Modify: `frontend/src/api/types.ts` (add Befehl block after the Lagebericht block ~line 960)
- Create: `frontend/src/api/befehle.ts`
- Create: `frontend/src/befehle/vorlagen.ts`
- Test: `frontend/src/befehle/vorlagen.test.ts`

**Interfaces:**
- Produces: `BefehlVorlageKey`, `BefehlStatus`, `BefehlAbschnitt`, `BefehlAnzeige`; client fns `listeBefehle/ladeBefehl/legeBefehlAn/aktualisiereBefehl/gibBefehlFrei/schreibeBefehlFort`; `VORLAGEN`, `vorlage`, `leereAbschnitte`, `AbschnittDef{schluessel,label,hilfetext?}`.

- [ ] **Step 1: Add types** to `frontend/src/api/types.ts` (mirror the Lagebericht block, fields identical):

```typescript
// ============================== LFH-64 Befehlsgebung ==============================
export type BefehlVorlageKey = 'befehl_lad' | 'befehl_ladef' | 'befehl_schnee' | 'befehl_ea_zmw';
export type BefehlStatus = 'entwurf' | 'freigegeben';

export interface BefehlAbschnitt {
  schluessel: string;
  text: string;
}

export interface BefehlAnzeige {
  id: number;
  einsatz_id: number;
  vorlage: BefehlVorlageKey;
  titel: string;
  zeitstand: string;
  status: BefehlStatus;
  abschnitte: BefehlAbschnitt[];
  version: number;
  vorgaenger_id: number | null;
  ersteller_id: number;
  ersteller_name: string;
  erstellt_at: string;
  aktualisiert_at: string;
  freigegeben_von_id: number | null;
  freigegeben_von_name: string | null;
  freigegeben_at: string | null;
  etb_eintrag_id: number | null;
}
```

- [ ] **Step 2: Write `frontend/src/api/befehle.ts`** — mirror `api/lageberichte.ts`, replace `Lagebericht`→`Befehl`, path `/lageberichte`→`/befehle`, `NeuerLagebericht`→`NeuerBefehl`, `LageberichtPatch`→`BefehlPatch`, key `LageberichtVorlageKey`→`BefehlVorlageKey`.

- [ ] **Step 3: Write `frontend/src/befehle/vorlagen.ts`** (adds optional `hilfetext`):

```typescript
import type { BefehlVorlageKey } from '../api/types';

export interface AbschnittDef {
  schluessel: string;
  label: string;
  /** Frontend-only Eingabehilfe (SKK-Unterpunkte); nicht im Backend. */
  hilfetext?: string;
}
export interface VorlageDef {
  schluessel: BefehlVorlageKey;
  label: string;
  abschnitte: AbschnittDef[];
}

/**
 * Befehlsschemata — MUSS synchron zu src/befehl/mod.rs::VORLAGEN bleiben
 * (Schlüssel + Reihenfolge; Labels/Hilfetexte dürfen kosmetisch abweichen).
 */
export const VORLAGEN: VorlageDef[] = [
  {
    schluessel: 'befehl_lad',
    label: 'Befehl LAD (vereinfacht)',
    abschnitte: [
      { schluessel: 'lage', label: 'Lage' },
      { schluessel: 'auftrag', label: 'Auftrag' },
      { schluessel: 'durchfuehrung', label: 'Durchführung' },
    ],
  },
  {
    schluessel: 'befehl_ladef',
    label: 'Befehl LADEF (erweitert, SKK)',
    abschnitte: [
      { schluessel: 'lage', label: 'Lage', hilfetext: 'a. Allgemeine Lage · b. Schadenlage · c. Eigene Lage' },
      { schluessel: 'auftrag', label: 'Auftrag', hilfetext: 'Erhaltener Auftrag' },
      { schluessel: 'durchfuehrung', label: 'Durchführung', hilfetext: 'a. Eigene Absicht · b. Einzelaufträge · c. Zusammenarbeit/Koordinierung · d. Zeitangaben · e. Schutzmaßnahmen' },
      { schluessel: 'einsatzunterstuetzung', label: 'Einsatzunterstützung', hilfetext: 'Verpflegung · Betriebsstoffe · Materialerhaltung · Medizinische Versorgung' },
      { schluessel: 'fuehrung_kommunikation', label: 'Führung und Kommunikation', hilfetext: 'Kommunikationsverbindungen & Meldewesen · Meldeköpfe · Befehlsstellen · Standort der/des Führenden' },
    ],
  },
  {
    schluessel: 'befehl_schnee',
    label: 'Befehl SCHNEE',
    abschnitte: [
      { schluessel: 'schadenlage', label: 'Schadenlage' },
      { schluessel: 'nachbarn', label: 'Nachbarn' },
      { schluessel: 'entschluss', label: 'Entschluss / Absicht' },
      { schluessel: 'einzelauftrag', label: 'Einzelauftrag' },
      { schluessel: 'eigener_standort', label: 'Eigener Standort' },
    ],
  },
  {
    schluessel: 'befehl_ea_zmw',
    label: 'Einzelauftrag (EA/ZMW)',
    abschnitte: [
      { schluessel: 'einheit', label: 'Einheit' },
      { schluessel: 'auftrag_ziel', label: 'Auftrag / Ziel' },
      { schluessel: 'mittel', label: 'Mittel' },
      { schluessel: 'weg', label: 'Weg' },
    ],
  },
];

export function vorlage(schluessel: BefehlVorlageKey): VorlageDef | undefined {
  return VORLAGEN.find((v) => v.schluessel === schluessel);
}

export function leereAbschnitte(v: VorlageDef): { schluessel: string; text: string }[] {
  return v.abschnitte.map((a) => ({ schluessel: a.schluessel, text: '' }));
}
```

- [ ] **Step 4: Write `frontend/src/befehle/vorlagen.test.ts`** (the sync guard — must match the backend section counts/keys from Task 2):

```typescript
import { describe, it, expect } from 'vitest';
import { VORLAGEN, vorlage } from './vorlagen';

describe('Befehlsvorlagen', () => {
  it('hat die vier Schemata mit erwarteter Abschnittszahl (Sync zu Backend)', () => {
    expect(vorlage('befehl_lad')!.abschnitte).toHaveLength(3);
    expect(vorlage('befehl_ladef')!.abschnitte).toHaveLength(5);
    expect(vorlage('befehl_schnee')!.abschnitte).toHaveLength(5);
    expect(vorlage('befehl_ea_zmw')!.abschnitte).toHaveLength(4);
  });

  it('hat eindeutige Schlüssel je Vorlage', () => {
    for (const v of VORLAGEN) {
      const keys = v.abschnitte.map((a) => a.schluessel);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('LADEF beginnt mit Lage und endet mit Führung/Kommunikation (Reihenfolge)', () => {
    const ks = vorlage('befehl_ladef')!.abschnitte.map((a) => a.schluessel);
    expect(ks[0]).toBe('lage');
    expect(ks[ks.length - 1]).toBe('fuehrung_kommunikation');
  });
});
```

- [ ] **Step 5: Run test**

Run: `mise exec pnpm@<ver> -- pnpm -C <abs-frontend> vitest run src/befehle/vorlagen.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/befehle.ts frontend/src/befehle/
git commit -m "feat(befehl): Frontend-Typen, API-Client, Befehlsvorlagen mit Hilfetext (LFH-64)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Frontend — `BefehlDetailPage` + Print-CSS + Detail-Route

**Files:**
- Create: `frontend/src/pages/BefehlDetailPage.tsx`
- Create: `frontend/src/pages/befehlPrint.css`
- Modify: `frontend/src/App.tsx` (import + Detail-Route)
- Test: `frontend/src/pages/BefehlDetailPage.test.tsx`

**Interfaces:**
- Consumes: `api/befehle.ts` fns, `befehle/vorlagen.ts` `vorlage`, `BefehlAbschnitt`/`BefehlAnzeige`.
- Produces: route `auftraege/befehle/:bid`.

1:1 mirror of `LageberichtDetailPage.tsx`. Replacements: `Lagebericht`→`Befehl`, `lagebericht`→`befehl`, CSS classes `lagebericht-*`→`befehl-*`, import `./lageberichtPrint.css`→`./befehlPrint.css`, params `lbId`→`bid`, query keys `einsatz-lagebericht(e)`→`einsatz-befehl(e)`, breadcrumb link target `/lageberichte`→`/auftraege` (label "Aufträge/Befehle"), navigate target on fortschreiben → `/einsaetze/${einsatzId}/auftraege/befehle/${neu.id}`, "Zum ETB-Eintrag" link stays `/einsaetze/${einsatzId}/etb`, dialog/title text "Lagebericht"→"Befehl".

**One real addition — render `hilfetext` under each editor field.** In the Entwurf form, change the `Form.Item` to pass `extra`:

```tsx
{v?.abschnitte.map((a) => (
  <Form.Item key={a.schluessel} label={a.label} name={a.schluessel} extra={a.hilfetext}>
    <MarkdownEditor layout="split" variante="dokument" autoSize={{ minRows: 8 }} />
  </Form.Item>
))}
```

- [ ] **Step 1: Create `frontend/src/pages/befehlPrint.css`** — mirror `lageberichtPrint.css`, replace all `lagebericht-`→`befehl-` class prefixes.

- [ ] **Step 2: Create `frontend/src/pages/BefehlDetailPage.tsx`** — mirror per the replacements above, including the `extra={a.hilfetext}` addition. Root `className="befehl-print-root"`, no-print class `befehl-no-print`, read-only container `befehl-druck`.

- [ ] **Step 3: Wire the route** in `frontend/src/App.tsx`:
  - Add import after line 31: `import BefehlDetailPage from './pages/BefehlDetailPage';`
  - Add route next to the lagebericht detail route (~line 124): `<Route path="auftraege/befehle/:bid" element={<BefehlDetailPage />} />`
  - Do NOT add a MODUL_ELEMENTE entry (the list lives inside AuftraegePage, Task 7).

- [ ] **Step 4: Write `frontend/src/pages/BefehlDetailPage.test.tsx`**

Mirror the structure of `LageberichtDetailPage.test.tsx` if it exists; otherwise write a focused test. It must use `MemoryRouter` with the route, mock `../api/befehle` and `../api/einsaetze`, and assert: (a) an Entwurf renders the editable form with the LADEF section labels and the hilfetext (e.g. `getByText(/a\. Allgemeine Lage/)`); (b) a freigegebener Befehl renders read-only with the "Fortschreiben" button and no editor. Wrap render in antd `App` (for `App.useApp()`).

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlDetailPage from './BefehlDetailPage';
import * as befehleApi from '../api/befehle';
import * as einsaetzeApi from '../api/einsaetze';

vi.mock('../api/befehle');
vi.mock('../api/einsaetze');

const einsatz = { id: 1, bezeichnung: 'Übung', status: 'aktiv', meine_rolle: 'einsatzleitung' };

function renderAt(bid: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter initialEntries={[`/einsaetze/1/auftraege/befehle/${bid}`]}>
          <Routes>
            <Route path="/einsaetze/:id/auftraege/befehle/:bid" element={<BefehlDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(einsaetzeApi.ladeEinsatz).mockResolvedValue(einsatz as never);
});

function befehl(status: 'entwurf' | 'freigegeben') {
  return {
    id: 7, einsatz_id: 1, vorlage: 'befehl_ladef', titel: 'Befehl 1',
    zeitstand: '2026-06-02 10:00:00', status, abschnitte: [],
    version: 1, vorgaenger_id: null, ersteller_id: 1, ersteller_name: 'EL',
    erstellt_at: '', aktualisiert_at: '', freigegeben_von_id: null,
    freigegeben_von_name: null, freigegeben_at: null, etb_eintrag_id: status === 'freigegeben' ? 5 : null,
  };
}

describe('BefehlDetailPage', () => {
  it('zeigt im Entwurf editierbare Felder mit Hilfetext', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('entwurf') as never);
    renderAt(7);
    expect(await screen.findByText('Einsatzunterstützung')).toBeInTheDocument();
    expect(screen.getByText(/a\. Allgemeine Lage/)).toBeInTheDocument();
  });

  it('zeigt freigegeben read-only mit Fortschreiben', async () => {
    vi.mocked(befehleApi.ladeBefehl).mockResolvedValue(befehl('freigegeben') as never);
    renderAt(7);
    expect(await screen.findByRole('button', { name: 'Fortschreiben' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 5: Run test**

Run: `mise exec pnpm@<ver> -- pnpm -C <abs-frontend> vitest run src/pages/BefehlDetailPage.test.tsx`
Expected: PASS (2 tests). Fix selectors against the actual rendered markup if needed (don't loosen assertions to force green).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/BefehlDetailPage.tsx frontend/src/pages/befehlPrint.css frontend/src/pages/BefehlDetailPage.test.tsx frontend/src/App.tsx
git commit -m "feat(befehl): Detail-Page (Entwurf/Freigabe/Fortschreibung/Druck) mit Hilfetext (LFH-64)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Frontend — `BefehlListe` + AuftraegePage-Tab-Integration

**Files:**
- Create: `frontend/src/auftraege/BefehlListe.tsx`
- Modify: `frontend/src/pages/AuftraegePage.tsx` (Tabs wrapper)
- Test: `frontend/src/auftraege/BefehlListe.test.tsx`; verify `frontend/src/pages/AuftraegePage.test.tsx` still passes

**Interfaces:**
- Consumes: `api/befehle.ts`, `befehle/vorlagen.ts` `VORLAGEN`, `BefehlAnzeige`.
- Produces: `<BefehlListe einsatzId darfSchreiben />` component; tab "Befehle" in AuftraegePage.

`BefehlListe` is the body of `LageberichtePage` (Table + "Befehl erteilen" modal) without the Breadcrumb/page-title (the AuftraegePage already has those), and links to `/einsaetze/${einsatzId}/auftraege/befehle/${b.id}`.

- [ ] **Step 1: Write `frontend/src/auftraege/BefehlListe.tsx`**

```tsx
import { App, Button, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/client';
import { legeBefehlAn, listeBefehle, type NeuerBefehl } from '../api/befehle';
import type { BefehlAnzeige } from '../api/types';
import { VORLAGEN } from '../befehle/vorlagen';

export default function BefehlListe({ einsatzId, darfSchreiben }: { einsatzId: number; darfSchreiben: boolean }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [anlegenOffen, setAnlegenOffen] = useState(false);
  const [form] = Form.useForm<NeuerBefehl>();

  const befehleQuery = useQuery({
    queryKey: ['einsatz-befehle', einsatzId],
    queryFn: () => listeBefehle(einsatzId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['einsatz-befehle', einsatzId] });
  const fehler = (e: unknown) => message.error(e instanceof ApiError ? e.message : 'Aktion fehlgeschlagen');

  const anlegenMutation = useMutation({
    mutationFn: (daten: NeuerBefehl) => legeBefehlAn(einsatzId, daten),
    onSuccess: () => { invalidate(); setAnlegenOffen(false); form.resetFields(); },
    onError: fehler,
  });

  const spalten: TableColumnsType<BefehlAnzeige> = [
    { title: 'Titel', dataIndex: 'titel', render: (titel: string, b) => (
        <Link to={`/einsaetze/${einsatzId}/auftraege/befehle/${b.id}`}>{titel}</Link>
      ) },
    { title: 'Schema', dataIndex: 'vorlage', render: (v: string) => VORLAGEN.find((x) => x.schluessel === v)?.label ?? v },
    { title: 'Zeitstand', dataIndex: 'zeitstand' },
    { title: 'Status', dataIndex: 'status', render: (s: string) => (
        <Tag color={s === 'freigegeben' ? 'green' : 'default'}>{s === 'freigegeben' ? 'Freigegeben' : 'Entwurf'}</Tag>
      ) },
    { title: 'Version', dataIndex: 'version' },
    { title: 'Ersteller', dataIndex: 'ersteller_name' },
  ];

  return (
    <div>
      <Space style={{ width: '100%', justifyContent: 'flex-end', marginBottom: 16 }}>
        {darfSchreiben && <Button type="primary" onClick={() => setAnlegenOffen(true)}>Befehl erteilen</Button>}
      </Space>
      <Table<BefehlAnzeige>
        rowKey="id"
        loading={befehleQuery.isLoading}
        dataSource={befehleQuery.data ?? []}
        columns={spalten}
        pagination={false}
        locale={{ emptyText: 'Noch keine Befehle' }}
      />
      <Modal
        open={anlegenOffen}
        title="Neuen Befehl anlegen"
        okText="Anlegen"
        confirmLoading={anlegenMutation.isPending}
        onOk={() => form.submit()}
        onCancel={() => setAnlegenOffen(false)}
        destroyOnHidden
      >
        <Form<NeuerBefehl> form={form} layout="vertical" initialValues={{ vorlage: 'befehl_lad' }} onFinish={(w) => anlegenMutation.mutate(w)}>
          <Form.Item label="Schema" name="vorlage" rules={[{ required: true }]}>
            <Select options={VORLAGEN.map((v) => ({ value: v.schluessel, label: v.label }))} />
          </Form.Item>
          <Form.Item label="Titel" name="titel" rules={[{ required: true, message: 'Titel erforderlich' }]}>
            <Input placeholder="z. B. Befehl an 2. Zug 10:30" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 2: Integrate Tabs in `AuftraegePage.tsx`**

Import `Tabs` from antd and `BefehlListe`. Wrap the existing content. The existing Auftrags-content (everything from the filters `<div>` down through `<VollzugMeldenModal>`) moves into the "Aufträge" tab; keep the Breadcrumb + page header (`Aufträge/Befehle` title + "Auftrag erteilen" button + inline form) **above** the Tabs so they stay shared. Add:

```tsx
import { Tabs } from 'antd';
import BefehlListe from '../auftraege/BefehlListe';
```

Insert directly above the existing filter `<div style={{ display: 'flex', flexWrap: 'wrap' ...}}>` a Tabs wrapper. Concretely, replace the block from that filter `<div>` … through the closing of the offen/abgeschlossen render and `<VollzugMeldenModal/>` with:

```tsx
      <Tabs
        defaultActiveKey="auftraege"
        items={[
          {
            key: 'auftraege',
            label: 'Aufträge',
            children: (
              <>
                {/* ...existing filter <div>, offen/abgeschlossen render, VollzugMeldenModal... */}
              </>
            ),
          },
          {
            key: 'befehle',
            label: 'Befehle',
            children: <BefehlListe einsatzId={einsatzId} darfSchreiben={darfSchreiben} />,
          },
        ]}
      />
```

Keep the "Auftrag erteilen" header button + inline `formOffen` Card above the Tabs (they belong to the Aufträge workflow; acceptable to leave shared for now). Note: antd Tabs renders only the active panel by default, so the existing AuftraegePage tests (default tab = Aufträge) keep seeing their elements.

- [ ] **Step 3: Write `frontend/src/auftraege/BefehlListe.test.tsx`**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntApp } from 'antd';
import BefehlListe from './BefehlListe';
import * as befehleApi from '../api/befehle';

vi.mock('../api/befehle');

function renderListe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AntApp>
        <MemoryRouter>
          <BefehlListe einsatzId={1} darfSchreiben />
        </MemoryRouter>
      </AntApp>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(befehleApi.listeBefehle).mockResolvedValue([
    { id: 7, einsatz_id: 1, vorlage: 'befehl_lad', titel: 'Befehl A', zeitstand: '2026-06-02 10:00:00',
      status: 'entwurf', abschnitte: [], version: 1, vorgaenger_id: null, ersteller_id: 1,
      ersteller_name: 'EL', erstellt_at: '', aktualisiert_at: '', freigegeben_von_id: null,
      freigegeben_von_name: null, freigegeben_at: null, etb_eintrag_id: null },
  ] as never);
});

describe('BefehlListe', () => {
  it('listet Befehle mit Schema-Label und Detail-Link', async () => {
    renderListe();
    const link = await screen.findByRole('link', { name: 'Befehl A' });
    expect(link).toHaveAttribute('href', '/einsaetze/1/auftraege/befehle/7');
    expect(screen.getByText('Befehl LAD (vereinfacht)')).toBeInTheDocument();
  });

  it('zeigt "Befehl erteilen" bei Schreibrecht', async () => {
    renderListe();
    expect(await screen.findByRole('button', { name: 'Befehl erteilen' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests (new + existing AuftraegePage)**

Run:
```
mise exec pnpm@<ver> -- pnpm -C <abs-frontend> vitest run src/auftraege/BefehlListe.test.tsx src/pages/AuftraegePage.test.tsx
```
Expected: PASS. If AuftraegePage tests break due to the Tabs wrapper, adjust the test (e.g. it may need to find elements within the default Aufträge tab) — do not remove coverage.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auftraege/BefehlListe.tsx frontend/src/auftraege/BefehlListe.test.tsx frontend/src/pages/AuftraegePage.tsx
git commit -m "feat(befehl): Befehls-Liste als Tab in AuftraegePage (LFH-64)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final Verification (after all tasks)

- [ ] Backend: `cargo test befehl` (alle Backend-Befehl-Tests grün) + `cargo build` clean.
- [ ] Frontend: gezielte Vitest-Läufe der neuen Dateien grün; danach Gate via
      `mise exec pnpm@<ver> -- pnpm -C <abs-frontend> vitest run --no-file-parallelism`
      (volle Suite ist unter Last flaky — `--no-file-parallelism` für ehrliches Pass/Fail).
- [ ] Lint/Typecheck: `pnpm -C <abs-frontend> tsc --noEmit` (oder Projekt-Lint-Skript).
- [ ] Smoke: Frontend bauen (`pnpm -C <abs-frontend> build`) + Backend starten, in einem aktiven Einsatz unter „Aufträge/Befehle" → Tab „Befehle" → Befehl anlegen, befüllen, freigeben, ETB-Eintrag (typ Anordnung) prüfen, drucken, fortschreiben. (rust-embed: Frontend-Build vor Backend-Start nötig.)

## Self-Review Notes (Plan vs. Spec)

- Spec „eigenes Entity, in auftraege integriert (Tab)" → Tasks 1–4 (Entity) + Task 7 (Tab). ✓
- Spec 4 Schemata flach + Hilfetext → Task 2 (Backend, ohne hilfetext) + Task 5/6 (Frontend hilfetext via `extra`). ✓ (Hilfetext bewusst Frontend-only — Abweichung vom Spec-Wortlaut „AbschnittDef + hilfetext im Backend", da das Backend den Hilfetext nicht rendert; im Plan dokumentiert.)
- Spec ETB-Snapshot `typ=anordnung` + Reverse-FK `befehl_id` → Task 1 + Task 3. ✓
- Spec Fortschreibung → Task 3 (repo) + Task 6 (Button). ✓
- Spec Druck → Task 6 (`befehlPrint.css`). ✓
- Spec SSE `"befehl"` → Task 4. ✓
