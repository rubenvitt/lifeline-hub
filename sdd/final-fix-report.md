# Final Fix Report – LFH-14 BR Review Findings

## B1 (BLOCKER): Migration 0062 – FK-sicherer Umbau

### Geändertes File
`migrations/0062_uhs_typ_ohne_bereitstellungsraum.sql`

### Was getan wurde
Der ursprüngliche Plan (Tabellen-Rebuild mit `-- no-transaction` + `PRAGMA foreign_keys = OFF` + `BEGIN/COMMIT`) ist **für sqlx-sqlite 0.8.6 NICHT umsetzbar** – das ist der von der Spec antizipierte Blocker, jetzt mit Primärquellenbeleg:

**Ursache (Primärquelle):** `/Users/rubeen/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/sqlx-sqlite-0.8.6/src/migrate.rs`, Zeile 136:
```rust
fn apply<'e: 'm, 'm>(&'e mut self, migration: &'m Migration) -> ... {
    Box::pin(async move {
        let mut tx = self.begin().await?;  // ← immer, kein no_tx-Zweig
```
Das SQLite-Backend prüft `migration.no_tx` **nicht**. `-- no-transaction` wird zwar geparst (sqlx-core), vom SQLite-Executor aber ignoriert. `PRAGMA foreign_keys = OFF` innerhalb der bereits gestarteten Transaktion ist damit in SQLite ein No-op.

**Konsequenz des ursprünglichen Plans:** `DROP TABLE uhs` innerhalb der (Fake-)tx hätte:
- `uhs_platz.uhs_id` (ON DELETE CASCADE) → stille Zeilen-Vernichtung, oder
- `person_uhs_belegung.uhs_id` (NOT NULL FK) → „FOREIGN KEY constraint failed" → Deploy-Blockade

**Umgesetzter Fallback (sicherer Minimalkurs):**
Migration enthält **nur** die Datenbereinigung:
```sql
UPDATE uhs SET typ = 'sonstige' WHERE typ = 'bereitstellungsraum';
```
Der DB-CHECK erlaubt 'bereitstellungsraum' weiterhin (Defense-in-Depth-Lücke); die Ablehnung erfolgt auf App-Ebene via `UhsTyp::parse()`. Der CHECK-Nachzug ist für einen Folge-Task vorgemerkt (nach sqlx-Upgrade oder Out-of-Pipeline-Rebuild-Skript).

### Integritätstest
`src/db.rs` → neuer Test `migration_0062_uhs_fk_integritaet_nach_datenbereinigung`:
- Legt nach allen Migrationen uhs + uhs_platz + person_uhs_belegung an
- Verifiziert FK-Konsistenz aller drei Zeilen
- Beweist: End-Schema trägt eingehende FKs korrekt
- Beweist NICHT: Altdaten überleben den Rebuild (Migration enthält keinen Rebuild mehr)

### Testkommandos + Ausgaben
```
rtk proxy cargo test --lib db::
→ 30 passed, 0 failed

rtk proxy cargo test --test einsatz_uhs
→ 28 passed, 0 failed
```

---

## S1 (SOLLTE): SSE-Event `bereitstellungsraum` – Frontend-Listener

### Geändertes File
`frontend/src/etb/useEinsatzLiveStream.ts`

### Was getan wurde
Drei Stellen ergänzt, analog zu bestehenden Events:

1. **Handler-Funktion** (nach `onNachforderung`/`onMeldung`):
   ```ts
   const onBr = () => { inval('einsatz-br'); inval('einsatz-br-detail'); };
   ```
   - `inval('einsatz-br')` → invalidiert `['einsatz-br', einsatzId]` (Liste)
   - `inval('einsatz-br-detail')` → invalidiert `['einsatz-br-detail', einsatzId]` (Prefix-Match, trifft alle brIds)

2. **`onLag`-Handler**: `onBr()` ergänzt (Reconnect/Buffer-Overflow-Pfad)

3. **`addEventListener` + `removeEventListener`**: `'bereitstellungsraum'` → `onBr` eingetragen

### Verifikation
```
cd frontend && rtk proxy pnpm exec tsc --noEmit
→ sauber (keine Ausgabe)

rtk proxy pnpm exec vitest run src/pages/bereitstellungsraum src/etb --no-file-parallelism
→ 15 Test Files passed, 83 Tests passed
```

---

## Concerns

1. **CHECK-Nachzug offen:** DB-CHECK erlaubt 'bereitstellungsraum' nach Migration 0062. Das Enforce ist ausschließlich auf App-Ebene. Erfordert sqlx-Upgrade (>= 0.8 mit funktionierendem `no_tx` für SQLite) oder Out-of-Pipeline-SQL-Skript. → Folge-Task empfohlen.

2. **Kein echter „Rebuild auf befüllter Prod-DB"-Test:** Der neue Test läuft auf leerer In-Memory-DB (alle Migrations, aber keine Vor-Daten). Ein echter Regressionstest müsste die sqlx-interne `_sqlx_migrations`-Tabelle manipulieren – zu brittle. Der Test beweist End-Schema-FK-Konsistenz, nicht Daten-Überleben.

3. **`no_tx` für SQLite-Backend:** Falls ein zukünftiger PR den Tabellen-Rebuild nachzieht, muss das sqlx-Upgrade auf eine Version erfolgen, die `migration.no_tx` im SQLite-`apply()`-Zweig prüft.
