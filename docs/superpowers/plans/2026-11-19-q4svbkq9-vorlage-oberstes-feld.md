# Vorlage als oberstes Feld im Anlegedialog — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Einsatz-Vorlage wird oberstes Feld des Dialogs „Neuen Einsatz anlegen“, und die
Start-Stichworte kommen an Vorlagen gekoppelt, für neue Organisationen ab Werk und für bestehende
per Migration.

**Architecture:** Backend: eine Namenssuche im Vorlagen-Repo, eine Paar-Startliste im Bootstrap
(Vorlagen vor Stichworten), Migration `0357` für Bestandsorgs, Demo-Einsatz mit Vorlage. Frontend:
das bestehende `vorlageWahl`-State bleibt, nur die Darstellung wandert in ein `Form.Item` oben;
das Stichwort-AutoComplete zeigt Optionen erst bei Eingabe.

**Tech Stack:** Rust (axum, sqlx/SQLite), React + antd, vitest/msw, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-q4svbkq9-vorlage-oberstes-feld-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/q4svbkq9xdsd2tarix8busg8

## Global Constraints

- Zuordnung (D1): MANV, MANV7, MANV15, MANV50 → „MANV“ · B2, B2Y, B3, B3Y → „Kleinlage“ · B4, B4Y →
  „Evakuierung und Betreuung“ · Sonderlage, Übung → keine.
- Vorgabe ohne gekoppeltes Stichwort: „Alle Module“ (`vorlageId: null`).
- Migration koppelt nur: exakter Starttext, `vorlage_id IS NULL`, Vorlage mit exaktem Startnamen
  in derselben Org (kleinste ID), keine Zeile mit `stammdaten_herkunft` (`art =
  'stichwort_vorschlag'`).
- Migrationsnummer: nächste freie auf `origin/alpha` (heute `0357`), Regeln `migrations/AGENTS.md`.
- Feldbudget-Ausnahme „Neuen Einsatz anlegen“: sechs Felder, Vorlage zuerst.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (Wurzel-`AGENTS.md`); Kommentare,
  Testnamen, Commits deutsch. Commit-Body mit `Zunder:`-Zeile und den Attributionszeilen.
- Keine Änderung an `openspec/` (eingefroren).

## Review Focus

1. Bestandsorg hat das Stichwort von Hand auf eine andere Vorlage gekoppelt → Migration lässt es
   stehen (Test in Task 2).
2. Bestandsorg hat die Vorlage „MANV“ umbenannt oder gelöscht → Stichwort bleibt ungekoppelt, kein
   Fehler (Task 2).
3. Hub-verteilter Vorschlag → Migration bricht nicht mit `stammdaten_vom_hub` ab und lässt ihn aus
   (Task 2).
4. Org ohne Vorlage „Unwetter“ → Demo-Import läuft durch, Einsatz ohne Vorlage (Task 3).
5. Leeres Stichwortfeld fokussiert → keine Vorschlagsliste offen, Einsatzart bleibt bedienbar
   (Task 4).

---

### Task 1: Bootstrap koppelt die Start-Stichworte

**Files:**
- Modify: `src/einsatz_vorlage/repo.rs` (neue Funktion nach `load_for_anlage_tx`)
- Modify: `src/auth/bootstrap.rs:13-28` (Startliste), `:106-115` (Insert), `:202-203` (Reihenfolge), Test `:464-497`

**Interfaces:**
- Produces: `pub async fn find_id_by_bezeichnung_tx(conn: &mut SqliteConnection, org_id: i64, bezeichnung: &str) -> Result<Option<i64>, AppError>` in `src/einsatz_vorlage/repo.rs` — kleinste ID mit exakt dieser Bezeichnung in der Org, sonst `None`.
- Produces: `const STICHWORT_STARTLISTE: [(&str, Option<&str>); 12]` (Text, Vorlagenname).

- [ ] **Step 1: Test umschreiben** — `seedet_einsatz_vorlagen_ohne_stichwort_kopplung_fuer_neue_org` wird `seedet_einsatz_vorlagen_und_koppelt_die_start_stichworte`. Die Bezeichnungs- und MANV-Prüfungen bleiben; neu:

```rust
let paare: Vec<(String, Option<String>)> = sqlx::query_as(
    "SELECT s.text, v.bezeichnung FROM einsatz_stichwort_vorschlag s \
     LEFT JOIN einsatz_vorlage v ON v.id = s.vorlage_id ORDER BY s.sortier",
).fetch_all(&pool).await.unwrap();
let erwartet = [
    ("B2", Some("Kleinlage")), ("B2Y", Some("Kleinlage")), ("B3", Some("Kleinlage")),
    ("B3Y", Some("Kleinlage")), ("B4", Some("Evakuierung und Betreuung")),
    ("B4Y", Some("Evakuierung und Betreuung")), ("MANV", Some("MANV")), ("MANV7", Some("MANV")),
    ("MANV15", Some("MANV")), ("MANV50", Some("MANV")), ("Sonderlage", None), ("Übung", None),
];
// assert_eq! über die in (String, Option<String>) umgewandelte erwartet-Liste
```

  Dazu ein Test `find_id_by_bezeichnung_tx_liefert_none_fuer_unbekannte_vorlage` im Testmodul von `src/einsatz_vorlage/repo.rs` (bzw. dessen Testdatei): Org gebootstrapt, `"MANV"` → `Some(_)`, `"Gibt es nicht"` → `None`, `"MANV"` mit fremder `org_id` → `None`.

- [ ] **Step 2: Rot prüfen** — `cargo test --lib auth::bootstrap::tests::seedet_einsatz_vorlagen_und_koppelt einsatz_vorlage` → FAIL (Kopplung `None` / Funktion fehlt).

- [ ] **Step 3: Umsetzen** — `find_id_by_bezeichnung_tx` (`SELECT MIN(id) … WHERE org_id = ? AND bezeichnung = ?`). Startliste als Paare; Doc-Kommentar: Kopplung ab Werk seit LLH-1816 (Verweis aufs Design-Doc, D1), ersetzt die Regel „keine mitgelieferte Kopplung“ der eingefrorenen Spec `einsatz-vorlagen`. `seed_startliste_tx` vor die Stichwort-Schleife ziehen (Kommentar an der alten Stelle entfernen); Insert mit Spalte `vorlage_id`, aufgelöst über `find_id_by_bezeichnung_tx`, `None` wenn kein Name oder nicht gefunden.

- [ ] **Step 4: Grün prüfen** — gleicher Befehl → PASS; dazu `cargo test --lib auth::bootstrap` → PASS.

- [ ] **Step 5: Commit** — `feat: Start-Stichworte kommen an Einsatz-Vorlagen gekoppelt (LLH-1816)`.

### Task 2: Migration koppelt Bestandsorgs behutsam

**Files:**
- Create: `migrations/0357_stichwort_vorlage_kopplung.sql` (Nummer vorher gegen `origin/alpha` prüfen)
- Test: `src/db/tests.rs` (neuer Test am Ende, Muster `migration_0320_planschicht_person_id` mit `pool_bis`)

**Interfaces:**
- Consumes: Zuordnung aus Global Constraints (in SQL als `VALUES`-Tabelle wiederholt; Migrationen dürfen nicht auf Rust-Konstanten zugreifen).

- [ ] **Step 1: Test schreiben** — `migration_0357_koppelt_start_stichworte_behutsam` mit `const VERSION: i64 = 357;`, `pool_bis(…, VERSION - 1)`. Aufbau mit zwei Orgs:
  - Org A: Vorlagen „MANV“ (zwei Zeilen, kleinere ID erwartet), „Kleinlage“; Vorschläge „MANV15“ (ohne Vorlage), „B2“ (ohne), „B3“ von Hand auf „MANV“ gekoppelt, „Übung“ (ohne), „H1“ (ohne), „B4“ (ohne; Vorlage „Evakuierung und Betreuung“ fehlt), „MANV7“ (ohne) mit `stammdaten_herkunft`-Zeile (`art='stichwort_vorschlag'`, `lokaler_schluessel` = ID als Text).
  - Org B: Vorlage „MANV“; Vorschlag „MANV50“ (ohne).
  - Migration bis `VERSION` laufen lassen; Erwartung: A/„MANV15“ → kleinste MANV-ID von A; A/„B2“ → Kleinlage A; A/„B3“ unverändert (Handkopplung); A/„Übung“, „H1“, „B4“, „MANV7“ → `NULL`; B/„MANV50“ → MANV von B (nie die von A).

- [ ] **Step 2: Rot prüfen** — `cargo test --lib db::tests::migration_0357` → FAIL (Migration fehlt / Panik bei Version).

- [ ] **Step 3: Migration schreiben** — Kopfkommentar (deutsch, LLH-1816, Verweis Design-Doc D2). Ein `UPDATE einsatz_stichwort_vorschlag SET vorlage_id = (SELECT MIN(v.id) FROM einsatz_vorlage v WHERE v.org_id = einsatz_stichwort_vorschlag.org_id AND v.bezeichnung = (Zuordnung für text))` mit `WHERE vorlage_id IS NULL AND text IN (<10 gekoppelte Texte>) AND NOT EXISTS (SELECT 1 FROM stammdaten_herkunft h WHERE h.art = 'stichwort_vorschlag' AND h.org_id = einsatz_stichwort_vorschlag.org_id AND h.lokaler_schluessel = CAST(einsatz_stichwort_vorschlag.id AS TEXT))` und Zusatzbedingung, dass die Vorlage existiert (sonst bliebe `NULL` ohnehin, aber kein unnötiger Log-Eintrag des `_log_u`-Triggers). Zuordnung als CTE oder `CASE text WHEN … END`.

- [ ] **Step 4: Grün prüfen** — `cargo test --lib db::tests::migration_0357 db::tests::migrationsnummern_sind_eindeutig` → PASS.

- [ ] **Step 5: Commit** — `feat: Migration koppelt Start-Stichworte bestehender Organisationen (LLH-1816)`.

### Task 3: Demo-Einsatz mit Vorlage „Unwetter“

**Files:**
- Modify: `src/demo/import.rs:103-118` (`vorlage_id: None`)
- Test: `src/demo/import_tests.rs`

**Interfaces:**
- Consumes: `find_id_by_bezeichnung_tx` (Task 1).

- [ ] **Step 1: Tests schreiben** — `demo_einsatz_bekommt_die_vorlage_unwetter`: nach dem Import (bestehende Hilfen aus `src/demo/test_hilfen.rs`) sind am Demo-Einsatz genau die ausgeblendeten Module der Vorlage „Unwetter“ ausgeblendet: `SELECT modul_key FROM einsatz_modul_override WHERE einsatz_id = ? AND sichtbar = 0` (Schreibweg `write_vorlage_overrides_tx`, `src/einsatz/repo.rs:248`) gleich der gültigen, ausblendbaren Menge aus `einsatz_vorlage_modul` der Vorlage — mindestens ein Modul, sonst ist der Test wertlos. `demo_ohne_vorlage_unwetter_legt_einsatz_ohne_vorlage_an`: Vorlage „Unwetter“ vorher löschen, Import läuft durch.

- [ ] **Step 2: Rot prüfen** — `cargo test --lib demo::import_tests::demo_einsatz_bekommt` → FAIL.

- [ ] **Step 3: Umsetzen** — `vorlage_id: find_id_by_bezeichnung_tx(conn, org_id, "Unwetter").await?`; Kommentar mit LLH-1816.

- [ ] **Step 4: Grün prüfen** — `cargo test --lib demo` → PASS.

- [ ] **Step 5: Commit** — `feat: Demo-Einsatz wird mit der Vorlage „Unwetter“ angelegt (LLH-1816)`.

### Task 4: Dialog — Vorlage als oberstes Feld, Stichwortliste erst beim Tippen

**Files:**
- Modify: `frontend/src/pages/EinsaetzePage.tsx:246` (Stichwortoptionen), `:636-641` (Kommentar), `:659` (neues erstes `Form.Item`), `:695-733` (Zeile nur noch Schichtmodell)
- Test: `frontend/src/pages/EinsaetzePage.vorlage.test.tsx`

**Interfaces:**
- Consumes: `vorlagenOptionen`, `auswahlWert`, `vorlageAusWert`, `moduleText`, `MODUL_ANZAHL` aus `frontend/src/stammdaten/einsatzVorlageModule.ts`; `vorlageWahl`/`setzeVorlage` unverändert.

- [ ] **Step 0: Ursache bestätigen** — Dev-Stack starten (Skill `run` bzw. Projektanleitung), Dialog öffnen, Stichwortfeld fokussieren; Screenshot (für sich, Skalierung 1): klappt die leere Liste über „Einsatzart“? Befund als Kommentar an die Zunder-Aufgabe. Liegt die Ursache woanders, diese beheben und hier vermerken.

- [ ] **Step 1: Tests anpassen und ergänzen** — Doc-Kommentar oben auf LLH-1816 aktualisieren. Ersetzt wird der erste Test durch:

```tsx
it('steht als oberstes Feld „Vorlage“ mit Vorgabe „Alle Module“ und Modulzahl; sechs Felder', async () => {
  setup();
  const dialog = await oeffneDialog();
  expect(gewaehlt('Vorlage')).toBe('Alle Module');
  const felder = dialog.querySelectorAll('.ant-form-item');
  expect(felder.length).toBe(6);
  expect(within(felder[0] as HTMLElement).getByText('Vorlage')).toBeInTheDocument();
  expect(within(dialog).getByText(`${MODUL_ANZAHL} von ${MODUL_ANZAHL} Modulen`)).toBeInTheDocument();
  expect(within(dialog).queryByText('Module:')).toBeNull();
});
it('zeigt die Modulzahl der gewählten Vorlage', async () => { /* waehle Vorlage „Kleinlage“ → moduleText(['lagebesprechung']) sichtbar */ });
it('das leere Stichwortfeld klappt keine Vorschläge auf, Tippen schon', async () => {
  /* Fokus/Klick ins Stichwortfeld → keine role="option" „MANV15“; tippe „MAN“ → Option „MANV15“ sichtbar, „H1“ nicht */
});
```

  In allen übrigen Tests `gewaehlt('Module')` / `name: 'Module'` → `'Vorlage'`. „ohne Vorlagen der Organisation keine Auswahl“ erwartet fünf Felder und kein Feld „Vorlage“.

- [ ] **Step 2: Rot prüfen** — `mise exec -- pnpm --dir frontend vitest run src/pages/EinsaetzePage.vorlage.test.tsx` → FAIL.

- [ ] **Step 3: Umsetzen** —
  - Neues erstes `<Form.Item label="Vorlage" htmlFor={vorlageFeldId} extra={…}>` nur wenn `vorlagen.length > 0`, **ohne** `name` (kein Formularwert); darin das bisherige `Select` ohne `variant="borderless"`, `aria-label="Vorlage"`. `extra`: `moduleText(ausgeblendet der Wahl)`, ohne Wahl `moduleText([])`.
  - Stichwortoptionen: leer, solange der eingegebene Text leer ist; sonst Vorschläge, deren Text den Teiltext ohne Groß/Klein enthält. Eingabetext als State aus dem vorhandenen `onChange` (oder `onSearch`) halten.
  - Gedämpfte Zeile: nur noch `schichtmodellText`.
  - Dialog-Kommentar: sechs Felder, Vorlage zuerst (LLH-1816), Verweis `frontend/AGENTS.md`, Feldbudget.

- [ ] **Step 4: Grün prüfen** — gleicher Befehl → PASS; `mise exec -- pnpm --dir frontend exec tsc --noEmit -p .` und Lint der Datei → sauber.

- [ ] **Step 5: Commit** — `feat: Vorlage als oberstes Feld im Anlegedialog, Stichwortliste erst beim Tippen (LLH-1816)`.

### Task 5: Regeln, Doku und e2e mitziehen

**Files:**
- Modify: `frontend/AGENTS.md:1595-1601` (Feldbudget-Ausnahme)
- Modify: `docs/anwender/kapitel/einsatz-oberflaeche.md:55-70`, ggf. `docs/anwender/kapitel/stammdaten.md` (Stichworte gekoppelt ab Werk)
- Modify: `frontend/e2e/einsatz-vorlagen.spec.ts` (Combobox `Module` → `Vorlage`), `frontend/e2e/einsatz-kern.ts` und weitere Treffer von `grep -rn "'Module'\|Module:" frontend/e2e`

- [ ] **Step 1: `frontend/AGENTS.md`** — Ausnahme lautet: sechs Felder; zuerst die Einsatz-Vorlage, weil sie das Menü des ganzen Einsatzes bestimmt und das Stichwort sie einstellt (LLH-1816, Entscheidung 19.11.2026); dann wie bisher bis zum optionalen Einsatzort; ein siebtes gehört in die Kopfdaten. Den Satz „gedämpfte Zeile … kein Feld (LLH-1375)“ streichen. Verweise auf den alten Satz greppen (`grep -rn "kein Feld (LLH-1375)\|Zeile unter den Feldern" frontend/src docs`) und mitziehen.

- [ ] **Step 2: Anwenderdoku** — Schritt „Vorlage“ wird der erste Schritt im Dialog („Oben unter ‚Vorlage‘ …“), Hinweis, dass die Start-Stichworte gekoppelt sind. Bildlauf/Wächter nach `docs/anwender/AGENTS.md` (Bild des Dialogs erneuern, falls das Kapitel eines führt).

- [ ] **Step 3: e2e anpassen** — Namen umstellen; `einsatz-vorlagen.spec.ts` prüft zusätzlich, dass „MANV15“ ab Werk „MANV“ einstellt, ohne vorher per API zu koppeln, sofern der Testaufbau eine frisch gebootstrapte Org hat (sonst Hinweis im Test lassen).

- [ ] **Step 4: Prüfen** — `mise exec -- pnpm --dir frontend exec prettier --check AGENTS.md e2e` und der Doku-Wächter aus `docs/anwender/AGENTS.md` → sauber.

- [ ] **Step 5: Commit** — `docs: Feldbudget, Anwenderdoku und e2e für die Vorlage als oberstes Feld (LLH-1816)`.

### Task 6: Gesamtprüfung

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` (ein Aufruf, ggf. im Hintergrund) → grün.
- [ ] **Step 2:** Bilder des Dialogs vorher/nachher (deviceScaleFactor 2) für PR und Meldung.
- [ ] **Step 3:** Review-Anlass prüfen (Migration → Anlass „Daten“: ein Review-Agent mit `references/review-pruefliste.md`), Befunde abarbeiten.
