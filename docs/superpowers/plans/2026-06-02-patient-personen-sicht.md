# LFH‑10 — Begriff „Patient" als eigene Personen-Sicht — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den BOS-Fachbegriff „Patient" (Person mit Sichtung ∈ {SK I–IV, tot}) als eigene Sicht und durchgängige Fachsprache in der Personen-UI einführen, ohne den Admin-Status zu ersetzen.

**Architecture:** Rein additiv auf der E‑2-Schicht. Ein abgeleiteter Frontend-Begriff (`istPatient`) auf dem schon vorhandenen Cache-Feld `aktuelle_sichtung` — keine DB-/Modell-/Routen-Änderung. Vier Touchpoints: neuer Tab mit SK-Abschnitten, Lagebild-Kennzahl, Drawer-Badge, plus eine `sichtung`-Spalte im CSV-Export (einzige Backend-Änderung).

**Tech Stack:** Rust/axum (Backend-Export), React + TypeScript + Ant Design (Frontend), Vitest + MSW (Frontend-Tests), `cargo test` (Backend-Tests).

**Spec:** `docs/superpowers/specs/2026-06-02-patient-personen-sicht-design.md`

---

## File Structure

- `src/routes/einsatz_person.rs` — CSV-Export `export()`: Header + Zeilenformat um `sichtung` erweitern.
- `tests/einsatz_person.rs` — neuer Backend-Test für die `sichtung`-Spalte.
- `frontend/src/pages/PersonenPage.tsx` — `istPatient`-Helper, `PATIENT_SK`-Konstante, neuer Tab + SK-Abschnitte, Lagebild-Kennzahl, Drawer-Badge.
- `frontend/src/pages/PersonenPage.test.tsx` — neue Komponententests.
- `frontend/src/einsatz/modulRegistry.ts` — nur Konsistenz-Check (keine Änderung erwartet).

---

## Task 1: Backend — CSV-Export um `sichtung`-Spalte erweitern

**Files:**
- Modify: `src/routes/einsatz_person.rs:435-448`
- Test: `tests/einsatz_person.rs` (neuer Test, neben `export_entschaerft_formel_injektion`)

- [ ] **Step 1: Failing test schreiben**

In `tests/einsatz_person.rs` direkt nach `export_entschaerft_formel_injektion` (nach Zeile 510) einfügen. Nutzt die bestehenden Helfer `setup`, `login_cookie`, `einsatz_anlegen`, `person_anlegen`, `sichten`:

```rust
#[tokio::test]
async fn export_enthaelt_sichtung_spalte() {
    let app = setup().await;
    let admin = login_cookie(&app, "admin", "startpw12").await;
    let e = einsatz_anlegen(&app, &admin).await;
    // Eine gesichtete Person (SK I) und eine ungesichtete:
    let p1 = person_anlegen(&app, &admin, e, r#"{"name":"Gesichtet"}"#).await;
    sichten(&app, &admin, e, p1, r#"{"kategorie":"sk1"}"#).await;
    person_anlegen(&app, &admin, e, r#"{"name":"Ungesichtet"}"#).await;

    let resp = app.clone().oneshot(
        Request::builder().method("GET").uri(format!("/api/einsaetze/{e}/personen/export"))
            .header(header::COOKIE, admin.clone()).body(Body::empty()).unwrap(),
    ).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
    let csv = String::from_utf8(bytes.to_vec()).unwrap();

    // Header trägt `sichtung` an Position 3 (direkt nach `status`):
    assert_eq!(
        csv.lines().next().unwrap(),
        "registrier_nr;status;sichtung;name;vorname;geschlecht;alter;antreff_ort"
    );
    // Gesichtete Person trägt den SK-Code in der sichtung-Spalte:
    assert!(csv.contains(";\"sk1\";"), "gesichtete Person muss sk1 tragen, CSV:\n{csv}");
    // Ungesichtete Person hat ein leeres sichtung-Feld:
    assert!(
        csv.lines().any(|z| z.contains("Ungesichtet") && z.contains(";\"\";\"Ungesichtet\"")),
        "ungesichtete Person muss ein leeres sichtung-Feld haben, CSV:\n{csv}"
    );
}
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `cargo test --test einsatz_person export_enthaelt_sichtung_spalte`
Expected: FAIL — der Header-`assert_eq!` schlägt fehl (Header enthält noch kein `sichtung`).

- [ ] **Step 3: Export implementieren**

In `src/routes/einsatz_person.rs` den Header (Zeile 435) ersetzen:

```rust
    let mut csv = String::from("registrier_nr;status;sichtung;name;vorname;geschlecht;alter;antreff_ort\n");
```

und das Zeilenformat (Zeilen 438-447) um die Sichtung erweitern:

```rust
        csv.push_str(&format!(
            "{};{};{};{};{};{};{};{}\n",
            registrier_anzeige(p.registrier_nr),
            csv_feld(&p.status),
            csv_feld(p.aktuelle_sichtung.as_deref().unwrap_or("")),
            csv_feld(p.name.as_deref().unwrap_or("")),
            csv_feld(p.vorname.as_deref().unwrap_or("")),
            csv_feld(p.geschlecht.as_deref().unwrap_or("")),
            alter,
            csv_feld(p.antreff_ort.as_deref().unwrap_or("")),
        ));
```

(`PersonAnzeige.aktuelle_sichtung: Option<String>` ist bereits vorhanden — kein Repo-Eingriff.)

- [ ] **Step 4: Tests laufen lassen, Erfolg bestätigen**

Run: `cargo test --test einsatz_person`
Expected: PASS — `export_enthaelt_sichtung_spalte` grün, `export_entschaerft_formel_injektion` und `export_schreibt_export_audit` weiterhin grün.

- [ ] **Step 5: Commit**

```bash
git add src/routes/einsatz_person.rs tests/einsatz_person.rs
git commit -m "feat(be): CSV-Export trägt SK-Sichtungsspalte (LFH-10)"
```

---

## Task 2: Frontend — `istPatient`-Helper + Patienten-Tab mit SK-Abschnitten

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx` (Helper/Konstante; `Sicht`-Typ + `SICHTEN`; Tabellen-Render)
- Test: `frontend/src/pages/PersonenPage.test.tsx`

- [ ] **Step 1: Failing tests schreiben**

In `frontend/src/pages/PersonenPage.test.tsx` innerhalb von `describe('PersonenPage', …)` ergänzen (z. B. nach dem Lagebild-Test bei Zeile 115):

```tsx
  it('Patienten-Tab gruppiert SK I–IV + tot in Abschnitte, ohne unverletzt/ungesichtet', async () => {
    const sk2 = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    const totVerstorben = { ...person, id: 13, registrier_nr: 4, status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    const unverletzt = { ...person, id: 14, registrier_nr: 5, status: 'betroffen' as const,
      aktuelle_sichtung: 'unverletzt' as const, aktuelle_sichtung_at: '2026-05-27 09:50:00' };
    render(einsatzAktiv, [person, sk2, totVerstorben, unverletzt]);
    await screen.findByText('R-001'); // ungesichtete Person im „Neu"-Tab
    await userEvent.click(screen.getByRole('tab', { name: 'Patienten' }));
    // SK-II-Abschnitt + tot-Abschnitt: beide Patienten sichtbar:
    expect(await screen.findByText('R-003')).toBeInTheDocument();
    expect(screen.getByText('R-004')).toBeInTheDocument();
    // Zwei Abschnitte mit je einem Patienten:
    expect(screen.getAllByText('1 Patient')).toHaveLength(2);
    // unverletzt (R-005) und ungesichtet (R-001) sind KEINE Patienten:
    expect(screen.queryByText('R-005')).not.toBeInTheDocument();
    expect(screen.queryByText('R-001')).not.toBeInTheDocument();
  });

  it('Patienten-Tab zeigt einen Leer-Hinweis, wenn niemand gesichtet ist', async () => {
    render(einsatzAktiv, [person, unbekannt]); // beide ungesichtet
    await screen.findByText('R-001');
    await userEvent.click(screen.getByRole('tab', { name: 'Patienten' }));
    expect(await screen.findByText(/Keine Patienten/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Tests laufen lassen, Fehlschlag bestätigen**

Run: `pnpm --dir frontend test src/pages/PersonenPage.test.tsx`
Expected: FAIL — es gibt keinen Tab „Patienten" (`getByRole('tab', { name: 'Patienten' })` wirft).

- [ ] **Step 3: Helper + Konstante ergänzen**

In `frontend/src/pages/PersonenPage.tsx` direkt nach dem `SK_META`-Block (nach Zeile 22) einfügen:

```tsx
/** Patient = gesichtet mit behandlungsrelevanter Kategorie (SK I–IV oder tot);
 *  unverletzt und ungesichtet zählen nicht (LFH-10, rein medizinische Achse). */
function istPatient(p: Person): boolean {
  return p.aktuelle_sichtung != null && p.aktuelle_sichtung !== 'unverletzt';
}

/** Triage-Reihenfolge der Patienten-Abschnitte (SK I zuerst, tot zuletzt). */
const PATIENT_SK: Sichtungskategorie[] = ['sk1', 'sk2', 'sk3', 'sk4', 'tot'];
```

(`Person` und `Sichtungskategorie` sind bereits in Zeile 13 importiert.)

- [ ] **Step 4: `Sicht`-Typ + `SICHTEN` erweitern**

`Sicht`-Typ (Zeile 49) ersetzen:

```tsx
type Sicht = 'erfasst' | 'vermisst' | 'betroffen' | 'patienten' | 'verstorben' | 'alle';
```

`SICHTEN`-Array (Zeilen 50-56): den Patienten-Eintrag zwischen „Betroffen" und „Verstorben" einfügen:

```tsx
const SICHTEN: { key: Sicht; label: string }[] = [
  { key: 'erfasst', label: 'Neu' },
  { key: 'vermisst', label: 'Vermisst' },
  { key: 'betroffen', label: 'Betroffen' },
  { key: 'patienten', label: 'Patienten' },
  { key: 'verstorben', label: 'Verstorben' },
  { key: 'alle', label: 'Alle' },
];
```

- [ ] **Step 5: Tabellen-Render verzweigen**

Den `<Table …>`-Block (Zeilen 555-563) durch eine Fallunterscheidung ersetzen:

```tsx
      {sicht === 'patienten' ? (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {PATIENT_SK.map((sk) => {
            const gruppe = alle.filter((p) => p.aktuelle_sichtung === sk);
            if (gruppe.length === 0) return null;
            return (
              <div key={sk}>
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                  <Tag color={SK_META[sk].color}>{SK_META[sk].label}</Tag>{' '}
                  <Typography.Text type="secondary">
                    {gruppe.length} {gruppe.length === 1 ? 'Patient' : 'Patienten'}
                  </Typography.Text>
                </Typography.Title>
                <Table
                  rowKey="id"
                  dataSource={gruppe}
                  columns={spalten}
                  pagination={false}
                  onRow={(p) => ({ onClick: () => { setOffenePersonId(p.id); setBearbeiten(false); }, style: { cursor: 'pointer' } })}
                />
              </div>
            );
          })}
          {!alle.some(istPatient) && (
            <Alert type="info" showIcon message="Keine Patienten in diesem Einsatz." />
          )}
        </Space>
      ) : (
        <Table
          rowKey="id"
          loading={personenQuery.isLoading}
          dataSource={personen}
          columns={[...spalten, ...aktionsSpalte]}
          pagination={false}
          locale={{ emptyText: 'Keine Personen in dieser Sicht' }}
          onRow={(p) => ({ onClick: () => { setOffenePersonId(p.id); setBearbeiten(false); }, style: { cursor: 'pointer' } })}
        />
      )}
```

(`personen` bleibt unverändert; im Patienten-Zweig wird es nicht verwendet. `Alert` ist bereits in Zeile 1 importiert.)

- [ ] **Step 6: Tests laufen lassen, Erfolg bestätigen**

Run: `pnpm --dir frontend test src/pages/PersonenPage.test.tsx`
Expected: PASS — beide neuen Tests grün, bestehende Tests unverändert grün.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(fe): Patienten-Tab mit SK-Abschnitten (LFH-10)"
```

---

## Task 3: Frontend — Lagebild-Streifen „Patienten: N"

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx:539-553`
- Test: `frontend/src/pages/PersonenPage.test.tsx`

- [ ] **Step 1: Failing test schreiben**

In `frontend/src/pages/PersonenPage.test.tsx` ergänzen:

```tsx
  it('Lagebild-Streifen zeigt „Patienten: N" (SK I–IV + tot)', async () => {
    const sk2 = { ...person, id: 12, registrier_nr: 3, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk2' as const, aktuelle_sichtung_at: '2026-05-27 09:30:00' };
    const tot = { ...person, id: 13, registrier_nr: 4, status: 'verstorben' as const,
      aktuelle_sichtung: 'tot' as const, aktuelle_sichtung_at: '2026-05-27 09:40:00' };
    const unverletzt = { ...person, id: 14, registrier_nr: 5, status: 'betroffen' as const,
      aktuelle_sichtung: 'unverletzt' as const, aktuelle_sichtung_at: '2026-05-27 09:50:00' };
    render(einsatzAktiv, [person, sk2, tot, unverletzt]);
    await screen.findByText('R-001');
    // Patienten = sk2 + tot = 2 (unverletzt + ungesichtet zählen nicht):
    expect(await screen.findByText(/Patienten:\s*2/)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `pnpm --dir frontend test src/pages/PersonenPage.test.tsx`
Expected: FAIL — kein Element mit Text „Patienten: 2".

- [ ] **Step 3: Lagebild-Block erweitern**

Im Lagebild-IIFE (Zeilen 539-553) die Patienten-Summe berechnen und als Tag ausgeben:

```tsx
      {(() => {
        const z = lagebildZaehlung(alle);
        const patientenAnzahl = z.sk.sk1 + z.sk.sk2 + z.sk.sk3 + z.sk.sk4 + z.sk.tot;
        const skTags = (Object.keys(z.sk) as Sichtungskategorie[])
          .filter((k) => z.sk[k] > 0)
          .map((k) => (
            <Tag key={k} color={SK_META[k].color}>{SK_META[k].label}: {z.sk[k]}</Tag>
          ));
        return (
          <Space wrap style={{ marginBottom: 12 }}>
            <Typography.Text type="secondary">Lagebild:</Typography.Text>
            <Tag color="geekblue">Patienten: {patientenAnzahl}</Tag>
            {skTags.length > 0 ? skTags : <Typography.Text type="secondary">noch keine Sichtungen</Typography.Text>}
            <Tag>ungesichtet: {z.ungesichtet}</Tag>
          </Space>
        );
      })()}
```

- [ ] **Step 4: Tests laufen lassen, Erfolg bestätigen**

Run: `pnpm --dir frontend test src/pages/PersonenPage.test.tsx`
Expected: PASS — neuer Test grün; der bestehende Test „zeigt SK-Badge und Lagebild-Zählungen" weiterhin grün.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(fe): Lagebild-Streifen zeigt Patientenzahl (LFH-10)"
```

---

## Task 4: Frontend — Patient-Tag im Detail-Drawer

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx` (Stammdaten-Kopf ~Zeile 289-292; Med-Tab-Badge-Zeile ~Zeile 421-426)
- Test: `frontend/src/pages/PersonenPage.test.tsx`

- [ ] **Step 1: Failing test schreiben**

In `frontend/src/pages/PersonenPage.test.tsx` ergänzen:

```tsx
  it('Detail-Drawer zeigt das „Patient"-Tag bei gesichteter Person', async () => {
    const patient = { ...person, status: 'betroffen' as const,
      aktuelle_sichtung: 'sk1' as const, aktuelle_sichtung_at: '2026-05-27 10:00:00' };
    const detail = { ...patient, sichtungen: [], notizen: [], verbleib: [], abgleiche: [] };
    render(einsatzAktiv, [patient]);
    server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(detail)));
    await userEvent.click(screen.getByRole('tab', { name: 'Alle' }));
    await userEvent.click(await screen.findByText('R-001'));
    const tags = await screen.findAllByText('Patient');
    expect(tags.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag bestätigen**

Run: `pnpm --dir frontend test src/pages/PersonenPage.test.tsx`
Expected: FAIL — kein Element mit Text „Patient" im Drawer.

- [ ] **Step 3: Patient-Tag im Stammdaten-Kopf ergänzen**

Den Status-Tag-Block (Zeilen 289-292) ersetzen:

```tsx
                <Space>
                  <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
                  {istPatient(p) && <Tag color="geekblue">Patient</Tag>}
                  {p.storniert_at && <Tag color="default">storniert</Tag>}
                </Space>
```

- [ ] **Step 4: Patient-Tag in der Med-Tab-Badge-Zeile ergänzen**

Die Badge-`Space` im „Medizinischer Verlauf"-Tab (Zeilen 421-426) ersetzen:

```tsx
                <Space wrap>
                  {istPatient(p) && <Tag color="geekblue">Patient</Tag>}
                  {p.aktuelle_sichtung
                    ? <Tag color={SK_META[p.aktuelle_sichtung].color}>SK: {SK_META[p.aktuelle_sichtung].label}</Tag>
                    : <Tag>ungesichtet</Tag>}
                  {p.aktueller_verbleib && <Tag color="purple">{p.aktueller_verbleib}</Tag>}
                </Space>
```

(`PersonDetail` erweitert `Person`, daher akzeptiert `istPatient` den Drawer-Parameter `p`.)

- [ ] **Step 5: Tests laufen lassen, Erfolg bestätigen**

Run: `pnpm --dir frontend test src/pages/PersonenPage.test.tsx`
Expected: PASS — neuer Test grün; bestehende Drawer-Tests unverändert grün.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(fe): Patient-Tag im Personen-Drawer (LFH-10)"
```

---

## Task 5: Modul-Beschreibung — Konsistenz-Check (keine Änderung erwartet)

**Files:**
- Verify: `frontend/src/einsatz/modulRegistry.ts:59`

- [ ] **Step 1: Bestehende Beschreibung prüfen**

Run: `rg -n "vermisst → betroffen → Patient → verstorben" frontend/src/einsatz/modulRegistry.ts`
Expected: genau ein Treffer (Zeile 59). Der Fluss nennt „Patient" bereits konsistent mit der Definition (Sichtung ∈ SK I–IV, tot).

- [ ] **Step 2: Entscheidung**

Stimmt der Treffer (erwarteter Normalfall): keine Änderung, kein Commit — der Touchpoint ist bereits erfüllt. Weicht der Text ab: den Satzteil auf „vermisst → betroffen → Patient → verstorben" angleichen und committen mit `docs(fe): Modul-Beschreibung an Patient-Definition angleichen (LFH-10)`.

---

## Task 6: Gesamt-Gate — beide Testsuiten grün

**Files:** keine Änderung (reine Verifikation).

- [ ] **Step 1: Backend-Suite**

Run: `cargo test --test einsatz_person`
Expected: PASS (alle Personen-Tests inkl. `export_enthaelt_sichtung_spalte`).

- [ ] **Step 2: Frontend-Suite (deterministisch, ohne Parallel-Flakiness)**

Run: `pnpm --dir frontend test -- --no-file-parallelism`
Expected: PASS (alle Suiten). Hinweis: Die volle Vitest-Suite ist unter Last parallel flaky — `--no-file-parallelism` ist das saubere Gate.

- [ ] **Step 3: Spec-Coverage final abhaken**

Run: `git log --oneline feat/lfh-10-patient-sicht` (oder aktuelle Branch-Historie)
Expected: Commits für CSV-Spalte, Patienten-Tab, Lagebild, Drawer vorhanden; alle Spec-Touchpoints (Tab, Lagebild, Drawer, CSV, Modul-Beschreibung) abgedeckt.

---

## Self-Review (vom Autor durchgeführt)

- **Spec coverage:** Tab (Task 2), Lagebild (Task 3), Drawer (Task 4), CSV (Task 1), Modul-Beschreibung (Task 5), Tests beidseitig (Tasks 1–4 + Gate Task 6), Definition `istPatient` als Single Source of Truth (Task 2 Step 3). Keine Lücke.
- **Placeholder-Scan:** keine TBD/TODO; jeder Code-Schritt enthält vollständigen Code.
- **Typ-Konsistenz:** `istPatient(p: Person)` (Task 2) wird in Task 3 (über `lagebildZaehlung`-Summe äquivalent) und Task 4 (`PersonDetail extends Person`) verwendet; `PATIENT_SK: Sichtungskategorie[]` deckt sich mit `Sichtungskategorie`-Union; CSV-Feld `aktuelle_sichtung: Option<String>` stimmt mit `PersonAnzeige`.
