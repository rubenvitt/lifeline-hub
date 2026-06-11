# Funk-/Kommunikations-Stammdaten (LFH-86) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Funk-/Kommunikationsdaten (Sprechgruppen TMO/DMO, Kommunikationsmittel, Erreichbarkeit) je Einsatzabschnitt pflegen und anzeigen, und beim ETB-Erfassen den Absender/Empfänger per Funkrufname auswählbar machen (Freitext bleibt Fallback).

**Architecture:** Funk-Attribute sind **einsatz-scoped** und leben direkt an der bestehenden `einsatzabschnitt`-Tabelle (analog zu `flaeche_geojson`/`tz_*` aus Migration 0035). Gepflegt werden sie im bestehenden Abschnitts-Formular (`EinsatzabschnittePage`) über den vorhandenen PATCH-Pfad (`AbschnittBody → AbschnittDaten → aktualisiere`, Voll-Ersatz wie `bemerkung`). Funkrufname/OPTA bleiben Fahrzeug-Stammdaten (existieren bereits an `fahrzeug`); der ETB-Absender-Dropdown wird aus den **im Einsatz disponierten** Fahrzeugen (`funkrufname`) und Einheiten (`name`) gespeist — keine neue Stammdaten-Tabelle, keine Doppelpflege. Der „Status verfügbar/im Einsatz" ist der bestehende Fahrzeug-FMS-Status und wird **nicht** neu modelliert.

**Tech Stack:** Rust (axum, sqlx/SQLite, Migrations als nummerierte `.sql`), React + TypeScript + antd + TanStack Query, Vitest + Testing Library + MSW.

**Designentscheidungen (vom User bestätigt):**
1. Schicht: Funk-Attribute einsatz-scoped am Einsatzabschnitt.
2. ETB-Absender-Quelle: im aktuellen Einsatz disponierte Fahrzeuge/Einheiten; Freitext bleibt Fallback.
3. Feld-Decomposition (Implementierungsdetail, im Plan getroffen): `sprechgruppe_tmo`, `sprechgruppe_dmo` (zwei getrennte Sprechgruppen-Felder — eine EA kann TMO-Netzbetrieb **und** DMO-Direktbetrieb führen), `kommunikationsmittel` (Digitalfunk/Mobil/Festnetz), `erreichbarkeit` (Nummer/Freitext). Alle nullable TEXT, kein CHECK.

**Scope-Schnitt für LFH-86:**
- IN: Funk-Felder am Abschnitt (Pflege + Anzeige), Funkrufname-Auswahl beim ETB-Erfassen (von/an).
- OUT (bewusst, da bereits vorhanden oder optional): Funkrufname/OPTA an Fahrzeug (existiert), FMS-Status (existiert), Buchstabieralphabet als Eingabehilfe (im Task als „optional" markiert — separater Folge-Task).

---

## File Structure

**Backend:**
- `migrations/0047_einsatzabschnitt_funk.sql` — Create: vier nullable TEXT-Spalten.
- `src/einsatzabschnitt/mod.rs` — Modify: vier Felder an `EinsatzabschnittAnzeige`.
- `src/einsatzabschnitt/repo.rs` — Modify: `AbschnittDaten`, `Row`, `zu_anzeige`, `SELECT_AUFGELOEST`, INSERT, UPDATE + Test.
- `src/routes/einsatzabschnitt.rs` — Modify: `AbschnittBody` + Verdrahtung in `anlegen`/`aktualisieren`.

**Frontend:**
- `frontend/src/api/types.ts` — Modify: `Einsatzabschnitt`-Interface.
- `frontend/src/api/einsatzabschnitte.ts` — Modify: `AbschnittEingabe`-Interface.
- `frontend/src/pages/EinsatzabschnittePage.tsx` — Modify: Form-Werte, Form-Items, `setFieldsValue`, Mutation-Transform, Detail-Anzeige.
- `frontend/src/etb/funkrufnamen.ts` — Create: Hook `useFunkrufnamen(einsatzId)`.
- `frontend/src/etb/schnellerfassungModell.ts` — Modify: optionale `optionen` für von/an-Editor.
- `frontend/src/etb/MetaChip.tsx` — Modify: AutoComplete statt Input, wenn Optionen vorliegen.
- `frontend/src/etb/Schnellerfassung.tsx` — Modify: Funkrufnamen laden, an MetaChip durchreichen.
- Tests jeweils neben der Quelldatei (`*.test.tsx` / `#[cfg(test)]`).

---

## Phase 1 — Backend: Funk-Felder am Einsatzabschnitt

### Task 1: Migration — vier Funk-Spalten

**Files:**
- Create: `migrations/0047_einsatzabschnitt_funk.sql`

- [ ] **Step 1: Migration schreiben**

Muster: Migration 0035 (`ALTER TABLE einsatzabschnitt ADD COLUMN ... TEXT`, nullable, kein Default, kein CHECK). Nächste freie Nummer ist 0047 (höchste vorhandene: 0046).

```sql
-- LFH-86: Funk-/Kommunikations-Stammdaten je Einsatzabschnitt (einsatz-scoped,
-- entity-gekoppelt analog 0035_lage_taktik). Alle Spalten nullable TEXT, kein
-- Default, kein CHECK. Sprechgruppe getrennt nach Betriebsart (TMO Netz / DMO
-- Direkt); Kommunikationsmittel als Freitext-Schlüssel (Digitalfunk/Mobil/Festnetz);
-- erreichbarkeit = Nummer/Freitext. Funkrufname/OPTA leben an `fahrzeug` (Stammdaten),
-- der Status verfügbar/im Einsatz ist der bestehende Fahrzeug-FMS-Status.
ALTER TABLE einsatzabschnitt ADD COLUMN sprechgruppe_tmo TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN sprechgruppe_dmo TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN kommunikationsmittel TEXT;
ALTER TABLE einsatzabschnitt ADD COLUMN erreichbarkeit TEXT;
```

- [ ] **Step 2: Migration läuft (über Test-Pool)**

Run: `cargo test -p lifeline-hub einsatzabschnitt::repo::tests::abschnitt_flaeche_setzen_und_loeschen`
Expected: PASS (der Test-Pool wendet alle Migrations an; läuft die neue Migration fehlerhaft, scheitert er beim Setup).

- [ ] **Step 3: Commit**

```bash
git add migrations/0047_einsatzabschnitt_funk.sql
git commit -m "feat(einsatzabschnitt): Migration für Funk-Felder (LFH-86)"
```

---

### Task 2: Repo + Modell — Funk-Felder lesen/schreiben

**Files:**
- Modify: `src/einsatzabschnitt/mod.rs:8-21`
- Modify: `src/einsatzabschnitt/repo.rs` (mehrere Stellen, s.u.)
- Test: `src/einsatzabschnitt/repo.rs` (`#[cfg(test)] mod tests`)

- [ ] **Step 1: Failing test schreiben**

In `src/einsatzabschnitt/repo.rs` im `mod tests` (nach `abschnitt_flaeche_setzen_und_loeschen`, ~Zeile 258) einfügen. Der Test legt einen Abschnitt mit Funk-Feldern an, liest sie zurück und überschreibt sie via `aktualisiere` (inkl. Leeren eines Feldes → NULL, Voll-Ersatz-Semantik wie `bemerkung`).

```rust
    #[tokio::test]
    async fn funk_felder_anlegen_und_aktualisieren() {
        let pool = crate::db::test_pool().await;
        let einsatz = setup(&pool).await;

        let a = anlegen(&pool, einsatz, AbschnittDaten {
            name: "Nord", ueber_abschnitt_id: None, leiter_id: None, bemerkung: None, sortier: 0,
            sprechgruppe_tmo: Some("412_F_DRK"), sprechgruppe_dmo: Some("DMO 31"),
            kommunikationsmittel: Some("digitalfunk"), erreichbarkeit: Some("0151 23456"),
        }).await.unwrap();
        assert_eq!(a.sprechgruppe_tmo.as_deref(), Some("412_F_DRK"));
        assert_eq!(a.sprechgruppe_dmo.as_deref(), Some("DMO 31"));
        assert_eq!(a.kommunikationsmittel.as_deref(), Some("digitalfunk"));
        assert_eq!(a.erreichbarkeit.as_deref(), Some("0151 23456"));

        // Voll-Ersatz: tmo geändert, dmo geleert (→ None), rest neu gesetzt.
        let b = aktualisiere(&pool, einsatz, a.id, AbschnittDaten {
            name: "Nord", ueber_abschnitt_id: None, leiter_id: None, bemerkung: None, sortier: 0,
            sprechgruppe_tmo: Some("420_F_ASB"), sprechgruppe_dmo: None,
            kommunikationsmittel: Some("mobil"), erreichbarkeit: None,
        }).await.unwrap();
        assert_eq!(b.sprechgruppe_tmo.as_deref(), Some("420_F_ASB"));
        assert_eq!(b.sprechgruppe_dmo, None);
        assert_eq!(b.kommunikationsmittel.as_deref(), Some("mobil"));
        assert_eq!(b.erreichbarkeit, None);
    }
```

Die bestehende Test-Helper `daten(...)` (Zeile 233-235) muss um die vier neuen Felder ergänzt werden (sonst kompilieren die Alt-Tests nicht):

```rust
    fn daten<'a>(name: &'a str, parent: Option<i64>, leiter: Option<i64>) -> AbschnittDaten<'a> {
        AbschnittDaten {
            name, ueber_abschnitt_id: parent, leiter_id: leiter, bemerkung: None, sortier: 0,
            sprechgruppe_tmo: None, sprechgruppe_dmo: None, kommunikationsmittel: None, erreichbarkeit: None,
        }
    }
```

- [ ] **Step 2: Test schlägt fehl (kompiliert nicht)**

Run: `cargo test -p lifeline-hub einsatzabschnitt::repo::tests::funk_felder_anlegen_und_aktualisieren`
Expected: FAIL — `AbschnittDaten` hat keine Felder `sprechgruppe_tmo` etc.; `EinsatzabschnittAnzeige` hat keine Felder `sprechgruppe_tmo` etc.

- [ ] **Step 3: `EinsatzabschnittAnzeige` erweitern**

In `src/einsatzabschnitt/mod.rs`, vor `pub sortier: i64,` (Zeile 20) einfügen:

```rust
    pub sprechgruppe_tmo: Option<String>,
    pub sprechgruppe_dmo: Option<String>,
    pub kommunikationsmittel: Option<String>,
    pub erreichbarkeit: Option<String>,
```

- [ ] **Step 4: `AbschnittDaten` erweitern**

In `src/einsatzabschnitt/repo.rs`, in `struct AbschnittDaten<'a>` (Zeile 8-14), nach `pub sortier: i64,` einfügen:

```rust
    pub sprechgruppe_tmo: Option<&'a str>,
    pub sprechgruppe_dmo: Option<&'a str>,
    pub kommunikationsmittel: Option<&'a str>,
    pub erreichbarkeit: Option<&'a str>,
```

- [ ] **Step 5: `SELECT_AUFGELOEST` erweitern**

In `src/einsatzabschnitt/repo.rs`, Zeile 16-21. Die vier Spalten in die Selektliste aufnehmen (vor `a.sortier`):

```rust
const SELECT_AUFGELOEST: &str = "\
    SELECT a.id, a.einsatz_id, a.ueber_abschnitt_id, a.name, a.leiter_id, \
           p.snap_name AS leiter_name, a.bemerkung, \
           a.flaeche_geojson, a.tz_fachaufgabe, a.tz_organisation, \
           a.sprechgruppe_tmo, a.sprechgruppe_dmo, a.kommunikationsmittel, a.erreichbarkeit, \
           a.sortier \
    FROM einsatzabschnitt a \
    LEFT JOIN einsatz_personal p ON p.id = a.leiter_id";
```

- [ ] **Step 6: `Row` + `zu_anzeige` erweitern**

In `struct Row` (Zeile 23-36), vor `sortier: i64,` einfügen:

```rust
    sprechgruppe_tmo: Option<String>,
    sprechgruppe_dmo: Option<String>,
    kommunikationsmittel: Option<String>,
    erreichbarkeit: Option<String>,
```

In `zu_anzeige` (Zeile 38-52), vor `sortier: row.sortier,` einfügen:

```rust
        sprechgruppe_tmo: row.sprechgruppe_tmo,
        sprechgruppe_dmo: row.sprechgruppe_dmo,
        kommunikationsmittel: row.kommunikationsmittel,
        erreichbarkeit: row.erreichbarkeit,
```

- [ ] **Step 7: INSERT (`anlegen`) erweitern**

In `anlegen` (Zeile 140-146), Spaltenliste, Platzhalter und Bindings ergänzen:

```rust
    let id = sqlx::query_scalar::<_, i64>(
        "INSERT INTO einsatzabschnitt \
            (einsatz_id, ueber_abschnitt_id, name, leiter_id, bemerkung, \
             sprechgruppe_tmo, sprechgruppe_dmo, kommunikationsmittel, erreichbarkeit, sortier) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    )
    .bind(einsatz_id).bind(daten.ueber_abschnitt_id).bind(daten.name)
    .bind(daten.leiter_id).bind(daten.bemerkung)
    .bind(daten.sprechgruppe_tmo).bind(daten.sprechgruppe_dmo)
    .bind(daten.kommunikationsmittel).bind(daten.erreichbarkeit)
    .bind(daten.sortier)
    .fetch_one(pool).await?;
```

- [ ] **Step 8: UPDATE (`aktualisiere`) erweitern**

In `aktualisiere` (Zeile 156-162), SET-Klausel und Bindings ergänzen (Voll-Ersatz, wie `bemerkung`):

```rust
    let resultat = sqlx::query(
        "UPDATE einsatzabschnitt SET ueber_abschnitt_id = ?, name = ?, leiter_id = ?, \
                bemerkung = ?, sprechgruppe_tmo = ?, sprechgruppe_dmo = ?, \
                kommunikationsmittel = ?, erreichbarkeit = ?, sortier = ? \
         WHERE id = ? AND einsatz_id = ?",
    )
    .bind(daten.ueber_abschnitt_id).bind(daten.name).bind(daten.leiter_id)
    .bind(daten.bemerkung)
    .bind(daten.sprechgruppe_tmo).bind(daten.sprechgruppe_dmo)
    .bind(daten.kommunikationsmittel).bind(daten.erreichbarkeit)
    .bind(daten.sortier).bind(id).bind(einsatz_id)
    .execute(pool).await?;
```

- [ ] **Step 9: Test grün**

Run: `cargo test -p lifeline-hub einsatzabschnitt::repo`
Expected: PASS (neuer Test + alle bestehenden Abschnitt-Tests).

- [ ] **Step 10: Commit**

```bash
git add src/einsatzabschnitt/mod.rs src/einsatzabschnitt/repo.rs
git commit -m "feat(einsatzabschnitt): Funk-Felder im Repo lesen/schreiben (LFH-86)"
```

---

### Task 3: Route — Funk-Felder im Request-Body annehmen

**Files:**
- Modify: `src/routes/einsatzabschnitt.rs:66-74` (`AbschnittBody`), `:88-99` (`anlegen`), `:118-129` (`aktualisieren`)

- [ ] **Step 1: `AbschnittBody` erweitern**

In `src/routes/einsatzabschnitt.rs`, `struct AbschnittBody` (Zeile 66-74), vor `#[serde(default)] pub sortier: i64,` einfügen:

```rust
    pub sprechgruppe_tmo: Option<String>,
    pub sprechgruppe_dmo: Option<String>,
    pub kommunikationsmittel: Option<String>,
    pub erreichbarkeit: Option<String>,
```

- [ ] **Step 2: `anlegen`-Handler verdrahten**

In `anlegen` (Zeile 88-99): nach `let bemerkung = trimme(body.bemerkung);` die vier Felder trimmen und an `AbschnittDaten` übergeben. Der bestehende `trimme`-Helper (Zeile 50-52) macht aus leerem/Whitespace-String `None`.

```rust
    let bemerkung = trimme(body.bemerkung);
    let tmo = trimme(body.sprechgruppe_tmo);
    let dmo = trimme(body.sprechgruppe_dmo);
    let mittel = trimme(body.kommunikationsmittel);
    let erreichbar = trimme(body.erreichbarkeit);
    let anzeige = abschnitt_repo::anlegen(
        &state.pool, einsatz_id,
        AbschnittDaten {
            name: &name, ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id, bemerkung: bemerkung.as_deref(),
            sprechgruppe_tmo: tmo.as_deref(), sprechgruppe_dmo: dmo.as_deref(),
            kommunikationsmittel: mittel.as_deref(), erreichbarkeit: erreichbar.as_deref(),
            sortier: body.sortier,
        },
    ).await?;
```

- [ ] **Step 3: `aktualisieren`-Handler verdrahten**

In `aktualisieren` (Zeile 118-129): analog nach `let bemerkung = trimme(body.bemerkung);`:

```rust
    let bemerkung = trimme(body.bemerkung);
    let tmo = trimme(body.sprechgruppe_tmo);
    let dmo = trimme(body.sprechgruppe_dmo);
    let mittel = trimme(body.kommunikationsmittel);
    let erreichbar = trimme(body.erreichbarkeit);
    let anzeige = abschnitt_repo::aktualisiere(
        &state.pool, einsatz_id, aid,
        AbschnittDaten {
            name: &name, ueber_abschnitt_id: body.ueber_abschnitt_id,
            leiter_id: body.leiter_id, bemerkung: bemerkung.as_deref(),
            sprechgruppe_tmo: tmo.as_deref(), sprechgruppe_dmo: dmo.as_deref(),
            kommunikationsmittel: mittel.as_deref(), erreichbarkeit: erreichbar.as_deref(),
            sortier: body.sortier,
        },
    ).await?;
```

- [ ] **Step 4: Backend baut + Tests grün**

Run: `cargo test -p lifeline-hub einsatzabschnitt`
Expected: PASS. Zusätzlich `cargo build` muss fehlerfrei sein (alle `AbschnittDaten`-Konstruktionen vollständig).

- [ ] **Step 5: Clippy sauber**

Run: `cargo clippy -- -D warnings`
Expected: keine Warnungen.

- [ ] **Step 6: Commit**

```bash
git add src/routes/einsatzabschnitt.rs
git commit -m "feat(einsatzabschnitt): Funk-Felder im Route-Body (LFH-86)"
```

---

## Phase 2 — Frontend: Abschnitt-Formular + Anzeige

### Task 4: API-Typen erweitern

**Files:**
- Modify: `frontend/src/api/types.ts:279-292` (`Einsatzabschnitt`)
- Modify: `frontend/src/api/einsatzabschnitte.ts:4-10` (`AbschnittEingabe`)

- [ ] **Step 1: `Einsatzabschnitt`-Type erweitern**

In `frontend/src/api/types.ts`, im `Einsatzabschnitt`-Interface, vor `}` (nach `tz_organisation`) einfügen:

```typescript
  sprechgruppe_tmo: string | null;
  sprechgruppe_dmo: string | null;
  kommunikationsmittel: string | null;
  erreichbarkeit: string | null;
```

- [ ] **Step 2: `AbschnittEingabe`-Type erweitern**

In `frontend/src/api/einsatzabschnitte.ts`, im `AbschnittEingabe`-Interface (Zeile 4-10), vor `sortier?: number;` einfügen:

```typescript
  sprechgruppe_tmo?: string | null;
  sprechgruppe_dmo?: string | null;
  kommunikationsmittel?: string | null;
  erreichbarkeit?: string | null;
```

- [ ] **Step 3: TypeScript-Check**

Run: `cd frontend && pnpm tsc --noEmit`
Expected: keine neuen Fehler (die Typen werden in Task 5 verwendet).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/einsatzabschnitte.ts
git commit -m "feat(frontend): Funk-Felder in Einsatzabschnitt-Typen (LFH-86)"
```

---

### Task 5: Abschnitts-Formular — Funk-Felder pflegen

**Files:**
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx` (Form-Werte-Interface ~Zeile 61-66, Form-Items ~Zeile 172-179, `setFieldsValue` ~Zeile 115-122, Mutation-Transform ~Zeile 92-98)
- Test: `frontend/src/pages/EinsatzabschnittePage.test.tsx` (falls vorhanden; sonst Create)

- [ ] **Step 1: Failing test schreiben**

Zunächst prüfen, ob `frontend/src/pages/EinsatzabschnittePage.test.tsx` existiert. Falls ja: einen Test ergänzen, der ein Abschnitt-Objekt mit Funk-Feldern mockt (MSW `GET /api/einsaetze/:id/abschnitte`) und prüft, dass die Felder im Formular vorbelegt werden, nachdem der Abschnitt im Baum gewählt wurde. Falls die Testdatei fehlt, neu anlegen nach dem Muster aus `frontend/src/stammdaten/FahrzeugeTab.test.tsx` (MSW `server.use(...)`, `renderMitProviders`).

Test-Kern (Feld-Vorbelegung):

```tsx
it('zeigt Funk-Felder eines Abschnitts im Formular', async () => {
  server.use(
    http.get('/api/einsaetze/1/abschnitte', () =>
      HttpResponse.json([{
        id: 10, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord',
        leiter_id: null, leiter_name: null, bemerkung: null,
        flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null,
        sprechgruppe_tmo: '412_F_DRK', sprechgruppe_dmo: null,
        kommunikationsmittel: 'digitalfunk', erreichbarkeit: '0151 23456', sortier: 0,
      }]),
    ),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
  );
  renderMitProviders(<EinsatzabschnittePage />, { route: '/einsaetze/1/abschnitte' });
  await userEvent.click(await screen.findByText('Nord'));
  expect(await screen.findByDisplayValue('412_F_DRK')).toBeInTheDocument();
  expect(screen.getByDisplayValue('0151 23456')).toBeInTheDocument();
});
```

> Hinweis: `route`/Router-Param-Setup an das bestehende Muster der Datei anpassen (die Page liest `einsatzId` via `useParams`). Wenn die Page weitere Endpunkte beim Mount lädt (z. B. `personal`), diese ebenfalls mit `server.use(...)` mocken — am vorhandenen Test orientieren.

- [ ] **Step 2: Test schlägt fehl**

Run: `cd frontend && pnpm vitest run src/pages/EinsatzabschnittePage.test.tsx`
Expected: FAIL — die Funk-Felder werden noch nicht gerendert.

- [ ] **Step 3: Form-Werte-Interface erweitern**

In `EinsatzabschnittePage.tsx` das `AbschnittWerte`-Interface (~Zeile 61-66) um die vier Felder erweitern:

```tsx
interface AbschnittWerte {
  name: string;
  ueber_abschnitt_id?: number | null;
  leiter_id?: number | null;
  bemerkung?: string;
  sprechgruppe_tmo?: string;
  sprechgruppe_dmo?: string;
  kommunikationsmittel?: string;
  erreichbarkeit?: string;
}
```

- [ ] **Step 4: Form-Items einfügen**

In `EinsatzabschnittePage.tsx` zwischen dem Leiter-Feld und dem Bemerkung-Feld (~Zeile 178/179) einfügen. `kommunikationsmittel` als `Select` mit drei Optionen + `allowClear`; die Sprechgruppen + Erreichbarkeit als `Input`. (`Select` ist bereits aus antd importiert, da Leiter ein Select ist; sonst Import ergänzen.)

```tsx
<Form.Item label="Sprechgruppe TMO" name="sprechgruppe_tmo">
  <Input placeholder="z. B. 412_F_DRK" allowClear />
</Form.Item>
<Form.Item label="Sprechgruppe DMO" name="sprechgruppe_dmo">
  <Input placeholder="z. B. DMO 31" allowClear />
</Form.Item>
<Form.Item label="Kommunikationsmittel" name="kommunikationsmittel">
  <Select
    allowClear
    placeholder="Digitalfunk / Mobil / Festnetz"
    options={[
      { value: 'digitalfunk', label: 'Digitalfunk' },
      { value: 'mobil', label: 'Mobil' },
      { value: 'festnetz', label: 'Festnetz' },
    ]}
  />
</Form.Item>
<Form.Item label="Erreichbarkeit / Nummer" name="erreichbarkeit">
  <Input placeholder="z. B. 0151 23456" allowClear />
</Form.Item>
```

- [ ] **Step 5: `setFieldsValue` erweitern**

Im `useEffect`/Auswahl-Handler, der das Formular mit dem gewählten Abschnitt füllt (~Zeile 115-122), die vier Felder ergänzen (antd erwartet `undefined` statt `null` für leere Controlled-Felder):

```tsx
form.setFieldsValue({
  name: aktuell.name,
  ueber_abschnitt_id: aktuell.ueber_abschnitt_id ?? undefined,
  leiter_id: aktuell.leiter_id ?? undefined,
  bemerkung: aktuell.bemerkung ?? undefined,
  sprechgruppe_tmo: aktuell.sprechgruppe_tmo ?? undefined,
  sprechgruppe_dmo: aktuell.sprechgruppe_dmo ?? undefined,
  kommunikationsmittel: aktuell.kommunikationsmittel ?? undefined,
  erreichbarkeit: aktuell.erreichbarkeit ?? undefined,
});
```

> Die exakten bestehenden Schlüssel beibehalten — nur die vier Funk-Schlüssel hinzufügen. Falls die Page `resetFields()` für „neuer Abschnitt" nutzt, dort nichts ändern (leere Felder sind korrekt).

- [ ] **Step 6: Mutation-Transform erweitern**

In der `speichern`-Mutation (`mutationFn`, ~Zeile 92-98), wo `AbschnittEingabe` (`daten`) gebaut wird, die vier Felder mit Trim/Null-Logik ergänzen (leere Strings → `null`):

```tsx
const daten: AbschnittEingabe = {
  name: werte.name.trim(),
  ueber_abschnitt_id: werte.ueber_abschnitt_id ?? null,
  leiter_id: werte.leiter_id ?? null,
  bemerkung: werte.bemerkung?.trim() || null,
  sprechgruppe_tmo: werte.sprechgruppe_tmo?.trim() || null,
  sprechgruppe_dmo: werte.sprechgruppe_dmo?.trim() || null,
  kommunikationsmittel: werte.kommunikationsmittel || null,
  erreichbarkeit: werte.erreichbarkeit?.trim() || null,
};
```

> Die bestehenden Felder (`name`/`ueber_abschnitt_id`/`leiter_id`/`bemerkung`/`sortier`) so lassen, wie die Datei sie bereits baut — nur die vier Funk-Felder ergänzen.

- [ ] **Step 7: Test grün**

Run: `cd frontend && pnpm vitest run src/pages/EinsatzabschnittePage.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/EinsatzabschnittePage.tsx frontend/src/pages/EinsatzabschnittePage.test.tsx
git commit -m "feat(frontend): Funk-Felder im Abschnitts-Formular pflegen (LFH-86)"
```

---

### Task 6: Abschnitts-Detail — „über welche Sprechgruppe/welches Mittel ist EA X erreichbar"

**Files:**
- Modify: `frontend/src/pages/EinsatzabschnittePage.tsx` (Detail-Bereich ~Zeile 166-211)
- Test: `frontend/src/pages/EinsatzabschnittePage.test.tsx`

- [ ] **Step 1: Failing test schreiben**

Test ergänzen: nach Auswahl eines Abschnitts mit Funk-Daten erscheint eine kompakte Erreichbarkeits-Anzeige (read-only), die TMO-Sprechgruppe und Kommunikationsmittel nennt.

```tsx
it('zeigt eine Funk-Erreichbarkeits-Zusammenfassung im Detail', async () => {
  server.use(
    http.get('/api/einsaetze/1/abschnitte', () =>
      HttpResponse.json([{
        id: 10, einsatz_id: 1, ueber_abschnitt_id: null, name: 'Nord',
        leiter_id: null, leiter_name: null, bemerkung: null,
        flaeche_geojson: null, tz_fachaufgabe: null, tz_organisation: null,
        sprechgruppe_tmo: '412_F_DRK', sprechgruppe_dmo: null,
        kommunikationsmittel: 'digitalfunk', erreichbarkeit: null, sortier: 0,
      }]),
    ),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
  );
  renderMitProviders(<EinsatzabschnittePage />, { route: '/einsaetze/1/abschnitte' });
  await userEvent.click(await screen.findByText('Nord'));
  const zusammenfassung = await screen.findByTestId('funk-erreichbarkeit');
  expect(zusammenfassung).toHaveTextContent('412_F_DRK');
  expect(zusammenfassung).toHaveTextContent(/Digitalfunk/i);
});
```

- [ ] **Step 2: Test schlägt fehl**

Run: `cd frontend && pnpm vitest run src/pages/EinsatzabschnittePage.test.tsx`
Expected: FAIL — `funk-erreichbarkeit` existiert nicht.

- [ ] **Step 3: Anzeige-Komponente einfügen**

Im Detail-Bereich (rechts, ~zwischen Formular und Einheiten-Liste, ~Zeile 190) eine kompakte read-only Zusammenfassung rendern. Label-Mapping für `kommunikationsmittel` lokal halten (gleiche drei Schlüssel wie das Select).

```tsx
{aktuell && (aktuell.sprechgruppe_tmo || aktuell.sprechgruppe_dmo
  || aktuell.kommunikationsmittel || aktuell.erreichbarkeit) && (
  <div data-testid="funk-erreichbarkeit" style={{ marginTop: 8 }}>
    <Space size={[4, 4]} wrap>
      {aktuell.sprechgruppe_tmo && <Tag color="blue">TMO: {aktuell.sprechgruppe_tmo}</Tag>}
      {aktuell.sprechgruppe_dmo && <Tag color="geekblue">DMO: {aktuell.sprechgruppe_dmo}</Tag>}
      {aktuell.kommunikationsmittel && (
        <Tag>{({ digitalfunk: 'Digitalfunk', mobil: 'Mobil', festnetz: 'Festnetz' }
          as Record<string, string>)[aktuell.kommunikationsmittel] ?? aktuell.kommunikationsmittel}</Tag>
      )}
      {aktuell.erreichbarkeit && <Tag>☎ {aktuell.erreichbarkeit}</Tag>}
    </Space>
  </div>
)}
```

> `Tag` und `Space` aus antd importieren, falls nicht bereits vorhanden.

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm vitest run src/pages/EinsatzabschnittePage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/EinsatzabschnittePage.tsx frontend/src/pages/EinsatzabschnittePage.test.tsx
git commit -m "feat(frontend): Funk-Erreichbarkeit im Abschnitts-Detail anzeigen (LFH-86)"
```

---

## Phase 3 — AC#1: Funkrufname-Auswahl beim ETB-Erfassen (von/an)

### Task 7: Funkrufnamen-Hook aus disponierten Fahrzeugen + Einheiten

**Files:**
- Create: `frontend/src/etb/funkrufnamen.ts`
- Test: `frontend/src/etb/funkrufnamen.test.tsx`

- [ ] **Step 1: Failing test schreiben**

Der Hook `useFunkrufnamen(einsatzId)` liefert eine deduplizierte, sortierte String-Liste: Fahrzeug-`funkrufname` (mit OPTA in Klammern, falls vorhanden) plus Einheit-`name`.

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from '../test/server';
import { neuerQueryClient } from '../test/utils';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFunkrufnamen } from './funkrufnamen';

function wrapper(client = neuerQueryClient()) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

it('sammelt Funkrufnamen aus Fahrzeugen (mit OPTA) und Einheiten', async () => {
  server.use(
    http.get('/api/einsaetze/1/fahrzeuge', () =>
      HttpResponse.json([
        { id: 1, funkrufname: 'Florian Musterstadt 1', opta: 'FL MUST 1' },
        { id: 2, funkrufname: 'RTW 1', opta: null },
      ]),
    ),
    http.get('/api/einsaetze/1/einheiten', () =>
      HttpResponse.json([{ id: 9, name: 'Zug 1' }]),
    ),
  );
  const { result } = renderHook(() => useFunkrufnamen(1), { wrapper: wrapper() });
  await waitFor(() => expect(result.current.length).toBeGreaterThan(0));
  expect(result.current).toContain('Florian Musterstadt 1 (FL MUST 1)');
  expect(result.current).toContain('RTW 1');
  expect(result.current).toContain('Zug 1');
});
```

> Test-Helper an die vorhandene Test-Infrastruktur anpassen: prüfen, wie `server` und `neuerQueryClient` exportiert werden (`frontend/src/test/server.ts`, `frontend/src/test/utils.tsx`). Falls `neuerQueryClient` nicht exportiert ist, einen lokalen `new QueryClient({ defaultOptions: { queries: { retry: false } } })` verwenden.

- [ ] **Step 2: Test schlägt fehl**

Run: `cd frontend && pnpm vitest run src/etb/funkrufnamen.test.tsx`
Expected: FAIL — `./funkrufnamen` existiert nicht.

- [ ] **Step 3: Hook implementieren**

```tsx
import { useQuery } from '@tanstack/react-query';
import { listeEinsatzFahrzeuge } from '../api/einsatzFahrzeuge';
import { listeEinheiten } from '../api/einheiten';

/**
 * Funkrufnamen-Vorschläge für die ETB-Absender/Empfänger-Auswahl: im aktuellen
 * Einsatz disponierte Fahrzeuge (Funkrufname, OPTA in Klammern) + Einheiten (Name).
 * Reine Eingabehilfe — Freitext bleibt erlaubt (AC#1).
 */
export function useFunkrufnamen(einsatzId: number): string[] {
  const fahrzeuge = useQuery({
    queryKey: ['einsatz-fahrzeuge', einsatzId],
    queryFn: () => listeEinsatzFahrzeuge(einsatzId),
  });
  const einheiten = useQuery({
    queryKey: ['einheiten', einsatzId],
    queryFn: () => listeEinheiten(einsatzId),
  });

  const namen = new Set<string>();
  for (const f of fahrzeuge.data ?? []) {
    namen.add(f.opta ? `${f.funkrufname} (${f.opta})` : f.funkrufname);
  }
  for (const e of einheiten.data ?? []) {
    if (e.name) namen.add(e.name);
  }
  return [...namen].sort((a, b) => a.localeCompare(b, 'de'));
}
```

> Query-Keys mit bestehenden abgleichen (`['einsatz-fahrzeuge', einsatzId]`, `['einheiten', einsatzId]`) — die Page-Komponenten nutzen genau diese Keys; gleiche Keys teilen den Cache.

- [ ] **Step 4: Test grün**

Run: `cd frontend && pnpm vitest run src/etb/funkrufnamen.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/etb/funkrufnamen.ts frontend/src/etb/funkrufnamen.test.tsx
git commit -m "feat(etb): Funkrufnamen-Hook aus disponierten Fahrzeugen/Einheiten (LFH-86)"
```

---

### Task 8: MetaChip-AutoComplete + Verdrahtung in der Schnellerfassung

**Files:**
- Modify: `frontend/src/etb/schnellerfassungModell.ts` (`MetaFeldDef`/Editor-Konfiguration)
- Modify: `frontend/src/etb/MetaChip.tsx:36-48` (Text-Editor)
- Modify: `frontend/src/etb/Schnellerfassung.tsx` (Funkrufnamen laden + durchreichen)
- Test: `frontend/src/etb/MetaChip.test.tsx`, `frontend/src/etb/Schnellerfassung.test.tsx`

- [ ] **Step 1: Failing test (MetaChip) schreiben**

In `frontend/src/etb/MetaChip.test.tsx` ergänzen: bei übergebenen `optionen` rendert das `von`-Feld eine AutoComplete, deren Vorschlag wählbar ist, **und** Freitext bleibt erlaubt (Enter committet beliebigen Text).

```tsx
it('Text-Feld mit Optionen: AutoComplete schlägt Funkrufnamen vor, Freitext bleibt möglich', async () => {
  const onCommit = vi.fn();
  renderMitProviders(
    <MetaChip
      feld="von"
      editing
      wert={undefined}
      optionen={['Florian 1', 'RTW 1']}
      onCommit={onCommit}
      onCancel={vi.fn()}
      onStartEdit={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  const input = screen.getByLabelText('Von');
  await userEvent.type(input, 'Eigener Text{Enter}');
  expect(onCommit).toHaveBeenCalledWith('von', 'Eigener Text');
});
```

> Die exakten Props von `MetaChip` aus der bestehenden Datei/Tests übernehmen (Signatur in `MetaChip.tsx` und `MetaChip.test.tsx` prüfen) — nur `optionen` als neue, **optionale** Prop ergänzen. Keine bestehende Prop umbenennen.

- [ ] **Step 2: Test schlägt fehl**

Run: `cd frontend && pnpm vitest run src/etb/MetaChip.test.tsx`
Expected: FAIL — `optionen`-Prop unbekannt / AutoComplete nicht gerendert.

- [ ] **Step 3: MetaChip um optionale AutoComplete erweitern**

In `MetaChip.tsx`: Props-Typ um `optionen?: string[]` erweitern. Im `editor === 'text'`-Zweig (Zeile 36-48): wenn `optionen?.length`, eine antd `AutoComplete` statt `Input` rendern; sonst unverändert `Input`. AutoComplete erlaubt Freitext von Haus aus (Auswahl = Vorbelegung, Enter = Commit).

```tsx
if (d.editor === 'text') {
  if (optionen && optionen.length > 0) {
    return (
      <AutoComplete
        size="small"
        autoFocus
        aria-label={d.label}
        style={{ width: 200 }}
        value={text}
        onChange={(v) => setText(v)}
        onSelect={(v) => onCommit(feld, v)}
        options={optionen.map((o) => ({ value: o }))}
        filterOption={(input, option) =>
          (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
        }
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (text.trim()) onCommit(feld, text.trim()); else onCancel(feld); }
          if (e.key === 'Escape') onCancel(feld);
        }}
      />
    );
  }
  return (
    <Input
      size="small"
      autoFocus
      aria-label={d.label}
      style={{ width: 160 }}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onPressEnter={() => (text.trim() ? onCommit(feld, text.trim()) : onCancel(feld))}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel(feld); }}
    />
  );
}
```

> `AutoComplete` aus `antd` importieren. `aria-label` muss `d.label` bleiben (Tests selektieren per `getByLabelText('Von')`). Hinweis: antd `AutoComplete` legt `aria-label` ggf. auf das innere Input; falls `getByLabelText` nicht greift, im Test auf `getByRole('combobox', { name: 'Von' })` ausweichen — beim Grünmachen verifizieren.

- [ ] **Step 4: MetaChip-Test grün**

Run: `cd frontend && pnpm vitest run src/etb/MetaChip.test.tsx`
Expected: PASS (neuer Test + bestehende Text-/Tag-Tests).

- [ ] **Step 5: `optionen` an von/an durchreichen (Schnellerfassung)**

In `schnellerfassungModell.ts` prüfen, wie `METADATEN_FELDER` und die Editor-Wahl strukturiert sind. Die Optionen pro Feld werden **nicht** statisch im Modell hinterlegt (sie sind dynamisch), sondern zur Render-Zeit übergeben. In `Schnellerfassung.tsx`:

1. Funkrufnamen laden: `const funkrufnamen = useFunkrufnamen(einsatz.id);`
2. Beim Rendern der MetaChips (dort wo `<MetaChip ... />` instanziiert wird) für die Felder `von` und `an` `optionen={funkrufnamen}` setzen, für andere Felder nichts (oder `undefined`):

```tsx
<MetaChip
  // ...bestehende Props...
  feld={feld}
  optionen={feld === 'von' || feld === 'an' ? funkrufnamen : undefined}
/>
```

> Die exakte Stelle/Schleife in `Schnellerfassung.tsx` aus der Datei ablesen (MetaChips werden über die aktiven Metadaten-Felder gerendert). Nur `optionen` ergänzen.

- [ ] **Step 6: Failing test (Schnellerfassung) schreiben**

In `Schnellerfassung.test.tsx`: der bestehende `von`-Test bleibt grün (Freitext-Fallback). Neuen Test ergänzen, der die Funkrufnamen-Endpunkte mockt und prüft, dass ein disponierter Funkrufname als Option erscheint/auswählbar ist und mitgesendet wird.

```tsx
it('bietet disponierte Funkrufnamen als Absender-Vorschlag (Freitext bleibt Fallback)', async () => {
  server.use(
    http.get('/api/einsaetze/1/fahrzeuge', () =>
      HttpResponse.json([{ id: 1, funkrufname: 'Florian 1', opta: null }]),
    ),
    http.get('/api/einsaetze/1/einheiten', () => HttpResponse.json([])),
  );
  const p = props(); // einsatz mit id: 1
  renderMitProviders(<Schnellerfassung {...p} />);
  const feld = screen.getByPlaceholderText(/Inhalt/);
  await userEvent.type(feld, 'Lage /von');
  await userEvent.click(await screen.findByText('Von'));
  const chip = await screen.findByLabelText('Von');
  await userEvent.type(chip, 'Florian');
  // Klick auf den Vorschlag committet sofort via AutoComplete onSelect → onCommit.
  await userEvent.click(await screen.findByText('Florian 1'));
  await userEvent.type(feld, '{Enter}');
  await waitFor(() => expect(p.erfassen).toHaveBeenCalledTimes(1));
  expect((p.erfassen as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ von: 'Florian 1' });
});
```

> `props()` so anpassen, dass `einsatz.id === 1` (am bestehenden `einsatz`-Mock orientieren). Den vorhandenen Freitext-`von`-Test (`'ELW 1'`) **nicht** löschen — er sichert den Fallback. Falls dieser Test jetzt MSW-Mocks für `/fahrzeuge`+`/einheiten` braucht (weil der Hook immer lädt), die Mocks im `beforeEach`/Setup global bereitstellen (leere Arrays als Default).

- [ ] **Step 7: Tests grün**

Run: `cd frontend && pnpm vitest run src/etb/Schnellerfassung.test.tsx src/etb/MetaChip.test.tsx`
Expected: PASS (inkl. Alt-Tests, insb. Freitext-Fallback).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/etb/MetaChip.tsx frontend/src/etb/schnellerfassungModell.ts frontend/src/etb/Schnellerfassung.tsx frontend/src/etb/MetaChip.test.tsx frontend/src/etb/Schnellerfassung.test.tsx
git commit -m "feat(etb): Funkrufname-Auswahl für Absender/Empfänger, Freitext bleibt Fallback (LFH-86)"
```

---

## Phase 4 — Abschluss-Verifikation

### Task 9: Volle Suite + Build + Frontend-Embed

**Files:** keine (nur Verifikation)

- [ ] **Step 1: Backend vollständig**

Run: `cargo test` und `cargo clippy -- -D warnings`
Expected: alle Tests PASS (Baseline war 819), keine Clippy-Warnung.

- [ ] **Step 2: Frontend-Tests (stabil, ohne Parallel-Flakiness)**

Run: `cd frontend && pnpm vitest run --no-file-parallelism`
Expected: alle PASS. (Die volle Suite ist unter Parallel-Last flaky — Gate mit `--no-file-parallelism`.)

- [ ] **Step 3: Frontend bauen (rust-embed)**

Run: `cd frontend && pnpm build`
Expected: Build erfolgreich (`dist/` aktualisiert). Pflicht, weil das Frontend ins Binary eingebettet wird; ohne Neubau zeigt ein laufendes Backend das alte Bundle.

- [ ] **Step 4: Akzeptanzkriterien gegenprüfen (manuell/Review)**

- AC#1: Beim ETB-Erfassen ist der Absender per Funkrufname auswählbar; Freitext bleibt Fallback. → Task 7+8, Tests in `Schnellerfassung.test.tsx`.
- AC#2: keine Doppelpflege. → Funkrufname = **Auswahl** statt Freitext (erfüllt; einzige Quelle `fahrzeug`/Einheit, ETB referenziert nur). Sprechgruppe = **Freitext pro Abschnitt** (kein Katalog) — bewusst, da der User die eigene Funk-Stammdaten-Tabelle verworfen hat; „genau einmal definiert" gilt für den Funkrufnamen, ein Sprechgruppen-Katalog mit Auswahl wäre eine Folgestufe. Nicht als voll abgedeckt verkaufen.

- [ ] **Step 5: Verifikations-Skill**

REQUIRED SUB-SKILL: `superpowers:verification-before-completion` vor jeder „fertig"-Aussage.

---

## Self-Review (vom Plan-Autor durchgeführt)

**Spec-Abdeckung:**
- „Stammdaten je Einheit/Einsatzabschnitt: Funkrufname, OPTA, Sprechgruppe (TMO/DMO), Kommunikationsmittel, Erreichbarkeit, Status" → Sprechgruppe/Mittel/Erreichbarkeit: Task 1-6, **nur am Einsatzabschnitt, nicht an der Einheit** (User-Wahl „opt. Einheit" → bewusst gedroppt, additiv nachrüstbar). Funkrufname/OPTA: bereits an `fahrzeug` vorhanden (kein Task nötig, im Scope dokumentiert). Status: bestehender FMS-Status (kein neues Feld, dokumentiert).
- „Pflege in den Stammdaten" → bewusst am Abschnitt (einsatz-scoped) statt Stammdaten-Tab, weil Einheit/Abschnitt einsatz-scoped sind (User-Entscheidung). Task 5.
- „Auswahl von Absender/Empfänger per Funkrufname statt Freitext" → Task 7-8 (von **und** an erhalten Optionen).
- „Buchstabieralphabet (optional)" → bewusst OUT (Task markiert es als optional; Folge-Task).
- „Anzeige: über welche Sprechgruppe/Mittel ist EA X erreichbar" → Task 6.
- AC#1, AC#2 → abgedeckt (Task 8 bzw. Architektur).

**Platzhalter-Scan:** keine TODO/TBD; alle Code-Schritte mit konkretem Code oder exaktem Datei:Zeile-Verweis + Snippet.

**Typ-Konsistenz:** Feldnamen identisch über alle Schichten: `sprechgruppe_tmo`, `sprechgruppe_dmo`, `kommunikationsmittel`, `erreichbarkeit` (Migration → Rust-Struct → SQL → Route-Body → TS-Type → Form). Query-Keys `['einsatz-fahrzeuge', id]` / `['einheiten', id]` mit bestehenden Page-Komponenten abgeglichen.

**Bekannte Verifikationspunkte für den Executor (beim Grünmachen prüfen, nicht raten):**
1. `getByLabelText('Von')` vs. `getByRole('combobox', { name: 'Von' })` bei antd AutoComplete (Task 8, Step 3).
2. Exakte MetaChip-Render-Schleife + Props in `Schnellerfassung.tsx` (Task 8, Step 5) — aus der Datei ablesen.
3. Ob `frontend/src/pages/EinsatzabschnittePage.test.tsx` existiert + welche Endpunkte die Page beim Mount lädt (Task 5/6 Mocks).
4. Export-Form von `server`/`neuerQueryClient` in der Test-Infrastruktur (Task 7).
