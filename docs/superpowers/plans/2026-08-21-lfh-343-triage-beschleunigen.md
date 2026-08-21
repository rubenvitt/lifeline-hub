# LFH-343 · C8 — Triage beschleunigen, Neues sichtbar machen

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die vier Kommunikations-Karten trennen „unbearbeitet" sichtbar von „gesichtet",
jede umkehrbare Statusaktion kostet einen Klick mit echtem Rückgängig-Weg, das
Auftrags-Modal ist wieder LFH-19-konform, der Chat-Strom scrollt in einem eigenen
Container, und Auftrag/Erinnerung/Nachforderung erfassen in Serie.

**Architecture:** Sechs Frontend-Bündel entlang der **Dateien**, nicht der Ticket-Punkte,
plus **ein Backend-Bündel** vorweg: die Rückwärts-Übergänge, ohne die „Direktaktion +
Rückgängig-Toast" für drei der vier Karten nicht baubar ist (gemessen, s. §Vorbefund).
Träger der Neu-Kennzeichnung ist ein Flag am bestehenden `StatusDeskriptor` — **keine
fünfte `KommPhase`**, weil `BEFEHL_STATUS.entwurf`, `LAGEBERICHT_STATUS.entwurf`,
`ERINNERUNG_STATUS.offen` und `NACHFORDERUNG_STATUS.angefordert` alle auf `offen` liegen und
eine neue Phase sie stillschweigend zu „neu" umklassifizieren würde.

**Tech Stack:** Rust/axum/sqlx (Backend), React 19 + antd 6 + TanStack Query (Frontend),
Vitest + Playwright, `./scripts/check-all.sh` als Gate.

**Spec:** ClickUp LFH-343 (`https://app.clickup.com/t/86cawrqzg`) · Leitlinien:
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`, `CLAUDE.md`

---

## Vorbefund — was gemessen bereits erledigt ist

Drei der zehn Ticket-Punkte sind durch Band B abgetragen. **Sie werden nicht angefasst**,
sondern in der Prüfliste (Task 8) per Messung ausgebucht:

| Punkt | Befund am 21.08.2026 | Träger |
| --- | --- | --- |
| **M68** Trefferflächen | Jedes verbliebene `size="small"` in `meldungen/ auftraege/ erinnerung/ nachforderungen/ chat/` sitzt auf `Card`/`Descriptions`/`Space`/`Liste` — nach CLAUDE.md ausdrücklich **kein** Verstoß (nicht-interaktiv; auf `Liste` ist `size` ein Abstandsmaß). Das „quittieren" steht seit LFH-364 in eigener Zeile als vollwertiger `<Button>` mit Empfänger im zugänglichen Namen. Das AK („= 0 auf interaktiven Elementen") ist **erfüllt**. | LFH-362/364, Dichte-Token |
| **M70** BefehlListe | `auftraege/BefehlListe.tsx` ist `Datensicht form="karte"` mit Gruppen Entwürfe/Freigegeben, `StatusBadge`, Metazeile `v… · Zeitstand · Ersteller`, Kopfzeile im `<Flex … wrap>`-Muster von `AuftraegeListe`. | LFH-330/B2 |
| **M71** Ungelesen-/Neu-Marker | `einsatz/modulRegistry.ts` trägt `zaehlerQuelle` (chat/erinnerungen/auftraege/meldungen), `einsatz/ModulPanel.tsx:181` rendert den `<Badge>`, `chat/KanalListe.tsx` hat Punkt + Zeit + `sortiereKanaele` (ungelesen zuerst). | LFH-330/B6 |

**Die Warnung des Tickets „`BefehlDetailPage.tsx` nicht parallel zu C7 fahren" ist
gegenstandslos** — C7/LFH-342 ist der HEAD-Commit dieses Branches. C7 hat aber genau die
Kopfzeile umgebaut, die M73 anfasst: der Umbau muss `zuletzt gespeichert` /
`ungespeicherte Änderungen` und den `freigabeBestaetigen`-Pfad **erhalten**.

### Die Umkehrbarkeits-Messung (Grundlage von Task 1)

`grep` gegen `src/routes/` und `src/*/repo.rs` am 21.08.2026:

| Aktion | Rückweg im Bestand | Beleg |
| --- | --- | --- |
| Meldung `neu`/`gesichtet`/`in_bearbeitung`/`erledigt` | **frei** — jeder gültige Status | `src/meldung/repo.rs:339 setze_status`, kein Übergangsriegel |
| Auftrag → `in_arbeit` | **keiner** | `src/routes/auftrag.rs:197 vollzug` kennt nur `"in_arbeit"` und `"vollzogen"` |
| Erinnerung → `erledigt`/`quittiert` | **keiner** | `src/routes/erinnerung.rs` hat nur `erledigen`/`quittieren` |
| Nachforderung Fortschaltung | **keiner** | `src/nachforderung/mod.rs:100 uebergang_erlaubt` ist streng vorwärts |

Entscheidung (vom Menschen bestätigt): **die Rückwege werden gebaut**, sonst wäre ein
Rückgängig-Knopf ein 422 und damit schlimmer als kein Rückgängig (CLAUDE.md/LFH-378: „erst
die Umkehrbarkeit, dann die Rückfrage").

## Global Constraints

- **Keine neue `KommPhase`.** Träger der Neu-Kennzeichnung ist ein optionales Feld am
  `StatusDeskriptor`-Eintrag.
- **Kein punktuelles `size` auf interaktiven Elementen.** Die Dichte kommt vom
  `ConfigProvider`; `components/dichte.guard.test.ts` erzwingt das.
- **Farbwerte ausschließlich aus `theme/tokens.ts` / `theme.useToken()`.** Rot ist Gefahr,
  Blau bedient. Jede Statusfarbe braucht einen zweiten Kanal (WCAG 1.4.1).
- **Query-Keys ausschließlich über `api/queryKeys.ts`** (`einsatzKeys`), kein
  Inline-String-Array — `queryKeys.guard.test.ts` erzwingt das.
- **Statuscodes** nach `src/error.rs`: Feld isoliert unbrauchbar → 400, Zusammenhang/
  Übergang verboten → 422.
- **Backend-Typänderung** ⇒ `scripts/check-typ-codegen.sh` laufen lassen und
  `openapi.json` + `types.generated.ts` **mitcommitten**.
- **Aktionsreihe mit `danger` + weiterer Aktion** trägt `<Space size="middle">`
  (`components/aktionsabstand.guard.test.ts`).
- **Enum-Wire-Kontrakt**: jedes in `src/api_doc.rs` registrierte Enum braucht einen Block in
  `tests/enum_wire_kontrakt.rs`.
- **Gate:** `./scripts/check-all.sh` — grün vor jedem Merge, kein `| tail` darum.
- Commit-Präfix je Bündel, Ticketnummer `LFH-343` im Body.

---

## Task 1: Rückwärts-Übergänge im Backend

**Files:**
- Modify: `src/routes/auftrag.rs:190-215` (Vollzug-Achse um `"offen"` erweitern)
- Modify: `src/auftrag/repo.rs` (neu: `setze_offen`)
- Modify: `src/routes/erinnerung.rs` (neu: `oeffnen`-Handler)
- Modify: `src/erinnerung/repo.rs` bzw. `src/kommunikation/repo.rs` (Vollzug/Quittung zurücknehmen)
- Modify: `src/routes/mod.rs` oder die jeweilige Router-Datei (Route registrieren)
- Modify: `src/nachforderung/mod.rs:100-107` (`uebergang_erlaubt` um Rücknahmen)
- Test: `tests/auftrag_vollzug.rs` (oder bestehende Auftrags-Testdatei), `src/routes/erinnerung.rs` (`mod tests`), `src/nachforderung/mod.rs` (`mod tests`)

**Interfaces:**
- Produces:
  - `POST /api/einsaetze/{id}/auftraege/{aid}/vollzug` akzeptiert zusätzlich
    `{"status": "offen"}`; erlaubt **nur** aus `in_arbeit`, sonst 422.
  - `POST /api/einsaetze/{id}/erinnerungen/{eid}/oeffnen` → `ErinnerungAnzeige` mit
    `status: "offen"`; erlaubt aus `erledigt` **und** `quittiert`, aus `offen` → 422.
  - `nachforderung::uebergang_erlaubt` erlaubt zusätzlich `zugesagt→angefordert`,
    `unterwegs→zugesagt`, `eingetroffen→unterwegs`. **`abgelehnt` bleibt terminal.**

- [ ] **Step 1: Rust-Test für die Nachforderungs-Rücknahme schreiben**

In `src/nachforderung/mod.rs`, `mod tests`:

```rust
#[test]
fn ruecknahme_um_eine_stufe_erlaubt_terminal_bleibt_zu() {
    // Vorwärts unverändert.
    assert!(uebergang_erlaubt(STATUS_ANGEFORDERT, STATUS_ZUGESAGT));
    assert!(uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_EINGETROFFEN));
    // Rücknahme genau EINE Stufe (LFH-343 · C8: Direktaktion braucht einen Rückweg).
    assert!(uebergang_erlaubt(STATUS_ZUGESAGT, STATUS_ANGEFORDERT));
    assert!(uebergang_erlaubt(STATUS_UNTERWEGS, STATUS_ZUGESAGT));
    assert!(uebergang_erlaubt(STATUS_EINGETROFFEN, STATUS_UNTERWEGS));
    // Zwei Stufen zurück NICHT — sonst wäre die Kette keine.
    assert!(!uebergang_erlaubt(STATUS_EINGETROFFEN, STATUS_ANGEFORDERT));
    // `abgelehnt` bleibt terminal: das Ablehnen trägt einen Grund und ein eigenes
    // Modal, seine Rücknahme ist eine fachliche Entscheidung, kein Undo-Klick.
    assert!(!uebergang_erlaubt(STATUS_ABGELEHNT, STATUS_ANGEFORDERT));
    assert!(!uebergang_erlaubt(STATUS_ABGELEHNT, STATUS_UNTERWEGS));
}
```

- [ ] **Step 2: Test laufen lassen — er muss scheitern**

Run: `cargo test --lib nachforderung::tests::ruecknahme_um_eine_stufe`
Expected: FAIL — `assert!(uebergang_erlaubt(STATUS_ZUGESAGT, STATUS_ANGEFORDERT))` ist false.

- [ ] **Step 3: `uebergang_erlaubt` erweitern**

```rust
pub fn uebergang_erlaubt(von: &str, nach: &str) -> bool {
    match von {
        STATUS_ANGEFORDERT => matches!(nach, STATUS_ZUGESAGT | STATUS_ABGELEHNT),
        // Rücknahme um genau eine Stufe (LFH-343 · C8). Ohne sie hätte die
        // Direktaktion ohne Rückfrage keinen Rückweg — und ein Rückgängig-Knopf,
        // der 422 liefert, ist schlechter als keiner.
        STATUS_ZUGESAGT => matches!(nach, STATUS_UNTERWEGS | STATUS_ABGELEHNT | STATUS_ANGEFORDERT),
        STATUS_UNTERWEGS => matches!(nach, STATUS_EINGETROFFEN | STATUS_ABGELEHNT | STATUS_ZUGESAGT),
        STATUS_EINGETROFFEN => matches!(nach, STATUS_UNTERWEGS),
        // `abgelehnt` bleibt terminal, siehe Test.
        _ => false,
    }
}
```

- [ ] **Step 4: Test grün**

Run: `cargo test --lib nachforderung::`
Expected: PASS. Danach `cargo test --lib` gesamt — bestehende Übergangstests dürfen nicht rot werden.

- [ ] **Step 5: Auftrag — Test für `vollzug: "offen"`**

In der bestehenden Auftrags-Integrationstestdatei (Ort per
`ls tests | grep auftrag` bestimmen; falls keine existiert, `tests/auftrag_vollzug.rs`
nach dem Muster von `tests/einsatz_schaden.rs` neu anlegen):

```rust
#[tokio::test]
async fn vollzug_offen_nimmt_in_arbeit_zurueck_und_ist_aus_vollzogen_422() {
    let (app, einsatz_id, token) = setup().await; // Muster der Nachbar-Tests
    let auftrag_id = auftrag_anlegen(&app, einsatz_id, &token).await;

    // offen → in_arbeit → offen
    post_vollzug(&app, einsatz_id, auftrag_id, &token, "in_arbeit").await.assert_ok();
    let zurueck = post_vollzug(&app, einsatz_id, auftrag_id, &token, "offen").await;
    assert_eq!(zurueck.status(), StatusCode::OK);
    assert_eq!(lade_auftrag(&app, einsatz_id, auftrag_id, &token).await.bearbeitungsstatus, "offen");

    // Aus `vollzogen` gibt es KEINEN Rückweg über diese Achse — das wäre eine
    // Rücknahme der Vollzugsmeldung, nicht ein Undo eines Triage-Klicks.
    post_vollzug(&app, einsatz_id, auftrag_id, &token, "vollzogen").await.assert_ok();
    let verboten = post_vollzug(&app, einsatz_id, auftrag_id, &token, "offen").await;
    assert_eq!(verboten.status(), StatusCode::UNPROCESSABLE_ENTITY);
}
```

- [ ] **Step 6: Test laufen — scheitert mit 400/422 auf dem ersten `"offen"`**

Run: `cargo test --test auftrag_vollzug`
Expected: FAIL beim ersten Rücknahme-Aufruf.

- [ ] **Step 7: `setze_offen` im Repo + Handler-Zweig**

In `src/auftrag/repo.rs`, direkt neben `setze_in_arbeit`:

```rust
/// Nimmt den Vollzug-Fortschritt auf 'offen' zurück (LFH-343 · C8, Undo der
/// Direktaktion). Setzt die geteilte Vollzug-Achse zurück und löscht den
/// Zeitstempel — sonst behauptete `in_arbeit_at` einen Fortschritt, den es
/// nicht mehr gibt.
pub async fn setze_offen(
    pool: &SqlitePool,
    org_id: i64,
    einsatz_id: i64,
    auftrag_id: i64,
    von_id: i64,
    jetzt: &str,
) -> Result<(), AppError> {
    krepo::setze_vollzug(
        pool, org_id, einsatz_id, OBJEKT_AUFTRAG, auftrag_id,
        VOLLZUG_OFFEN, von_id, jetzt,
    )
    .await?;
    sqlx::query("UPDATE auftrag SET in_arbeit_at = NULL WHERE id = ?")
        .bind(auftrag_id)
        .execute(pool)
        .await?;
    Ok(())
}
```

**Vor dem Schreiben prüfen:** ob `VOLLZUG_OFFEN` in `src/kommunikation/mod.rs` existiert
(`grep -n 'VOLLZUG_' src/kommunikation/mod.rs`). Fehlt die Konstante, wird sie dort
angelegt — mit demselben Wire-String, den `vollzug_status` im Ausgangszustand trägt (aus
der Migration ablesen, **nicht** raten).

Im Handler `src/routes/auftrag.rs:197 vollzug`, neuer `match`-Arm **vor** `_ =>`:

```rust
"offen" => {
    // Nur aus `in_arbeit` zurück. Aus `vollzogen`/`abgenommen` wäre das die
    // Rücknahme einer Vollzugsmeldung — ein fachlicher Vorgang mit eigenem
    // Weg, kein Undo eines Triage-Klicks (LFH-267: Zusammenhang → 422).
    if aktuell.auftrag.vollzug_status != VOLLZUG_IN_ARBEIT {
        return Err(AppError::UnprocessableEntity(
            "Zurücknehmen ist nur aus „In Bearbeitung“ möglich".into(),
        ));
    }
    repo::setze_offen(&state.pool, org_id, einsatz_id, auftrag_id, benutzer.id, &jetzt).await?;
}
```

Die genauen Namen der lokalen Variablen (`aktuell`, `org_id`, `jetzt`, `benutzer`) aus dem
umgebenden Handler übernehmen — sie stehen dort bereits.

- [ ] **Step 8: Test grün + Wire-Kommentar am `status`-Feld**

Run: `cargo test --test auftrag_vollzug`
Expected: PASS. Den Doc-Kommentar an `VollzugReq.status` (`src/routes/auftrag.rs:192`) von
`'in_arbeit' | 'vollzogen'` auf `'offen' | 'in_arbeit' | 'vollzogen'` fortschreiben.

- [ ] **Step 9: Erinnerung — Test für `oeffnen`**

In `src/routes/erinnerung.rs`, `mod tests` (Muster der dortigen Tests):

```rust
#[tokio::test]
async fn oeffnen_nimmt_erledigt_und_quittiert_zurueck() {
    let pool = crate::db::test_pool().await;
    let (benutzer_id, einsatz_id) = setup(&pool).await;
    let e = repo::anlegen(/* Muster der Nachbartests */).await.unwrap();

    repo::status_setzen(&pool, e.id, STATUS_ERLEDIGT, "2026-08-21 10:00:00").await.unwrap();
    repo::status_setzen(&pool, e.id, STATUS_OFFEN, "2026-08-21 10:01:00").await.unwrap();
    let nach = repo::laden(&pool, e.id, "2026-08-21 10:02:00").await.unwrap();
    assert_eq!(nach.status, "offen");
    // Die Vollzugs-/Quittungsachse muss MITgehen: bliebe sie stehen, zeigte die
    // Karte „offen" und trüge gleichzeitig den grünen Vollzugs-Tag.
    assert_eq!(nach.vollzug_status.as_deref(), None);
    assert!(nach.quittiert_at.is_none());
}
```

Die exakten Feldnamen aus `ErinnerungAnzeige` ablesen
(`grep -n -A 25 'struct ErinnerungAnzeige' src/erinnerung/mod.rs`) und den Test daran
anpassen, bevor er geschrieben wird.

- [ ] **Step 10: Test laufen — scheitert**

Run: `cargo test --lib routes::erinnerung::tests::oeffnen_nimmt`
Expected: FAIL — Vollzug/Quittung bleiben stehen.

- [ ] **Step 11: Repo-Rücknahme + Route**

In `src/kommunikation/repo.rs` neben `setze_vollzug`/`quittiere` je eine Rücknahme
(`loesche_vollzug`, `loesche_quittung`) für das Paar (`objekt_typ`, `objekt_id`) — die
konkrete Tabellenstruktur aus den bestehenden Funktionen ablesen.

Handler in `src/routes/erinnerung.rs`, nach `quittieren`:

```rust
/// POST /api/einsaetze/{id}/erinnerungen/{eid}/oeffnen — Rücknahme von
/// Erledigt/Quittiert (LFH-343 · C8). Der Gegenweg zur Direktaktion ohne
/// Rückfrage: ohne ihn wäre ein Fehlklick endgültig.
pub async fn oeffnen(
    State(state): State<AppState>,
    CurrentUser(benutzer): CurrentUser,
    PfadParam((einsatz_id, erinnerung_id)): PfadParam<(i64, i64)>,
) -> Result<Json<ErinnerungAnzeige>, AppError> {
    let org_id = fordere_bearbeitbar(&state, &benutzer, einsatz_id, erinnerung_id).await?;
    let now = jetzt();
    let aktuell = repo::laden(&state.pool, erinnerung_id, &now).await?;
    if aktuell.status == STATUS_OFFEN {
        // Zustandsverletzung, kein Feldfehler → 422 (src/error.rs).
        return Err(AppError::UnprocessableEntity(
            "Die Erinnerung ist bereits offen".into(),
        ));
    }
    repo::status_setzen(&state.pool, erinnerung_id, STATUS_OFFEN, &now).await?;
    krepo::loesche_vollzug(&state.pool, org_id, einsatz_id, OBJEKT_ERINNERUNG, erinnerung_id).await?;
    krepo::loesche_quittung(&state.pool, org_id, einsatz_id, OBJEKT_ERINNERUNG, erinnerung_id).await?;
    let r = repo::laden(&state.pool, erinnerung_id, &now).await?;
    sse(&state, einsatz_id);
    Ok(Json(r))
}
```

Route registrieren, wo `erledigen`/`quittieren` registriert sind
(`grep -rn 'erinnerungen/{eid}/quittieren\|quittieren))' src/`).

- [ ] **Step 12: Tests grün**

Run: `cargo test --lib erinnerung`
Expected: PASS.

- [ ] **Step 13: Typ-Codegen + volles Rust-Gate**

Run: `./scripts/check-typ-codegen.sh` und `cargo test --workspace`
Expected: beide grün; `frontend/src/api/openapi.json` und `types.generated.ts` mitcommitten,
falls sie sich geändert haben.

- [ ] **Step 14: Commit**

```bash
git add src tests frontend/src/api/openapi.json frontend/src/api/types.generated.ts
git commit -m "feat(lfh-343): oeffnet die Rueckwege fuer Auftrag, Erinnerung und Nachforderung

Die Direktaktion ohne Rueckfrage braucht einen Rueckweg, sonst waere der
Rueckgaengig-Knopf ein 422. Gemessen hatte nur die Meldung einen.

LFH-343"
```

---

## Task 2: Frontend-API der Rückwege

**Files:**
- Modify: `frontend/src/api/auftraege.ts` (`setzeVollzug`-Signatur)
- Modify: `frontend/src/api/erinnerungen.ts` (neu: `oeffneErinnerung`)
- Test: `frontend/src/api/*.test.ts`, falls die Nachbarfunktionen dort getestet sind —
  sonst deckt Task 3/4 sie über die Komponententests ab.

**Interfaces:**
- Consumes: die Routen aus Task 1.
- Produces:
  - `setzeVollzug(einsatzId, auftragId, status: 'offen' | 'in_arbeit' | 'vollzogen', text?)`
  - `oeffneErinnerung(einsatzId, erinnerungId): Promise<Erinnerung>`

- [ ] **Step 1: Signatur von `setzeVollzug` erweitern**

`frontend/src/api/auftraege.ts`: den Union-Typ des `status`-Parameters um `'offen'`
ergänzen. Der Aufrufer in `AuftraegeListe.tsx` tippt heute `'in_arbeit' as const` — der
bleibt gültig.

- [ ] **Step 2: `oeffneErinnerung` ergänzen**

`frontend/src/api/erinnerungen.ts`, nach `quittiereErinnerung`, im Stil der
Nachbarfunktion (dort die exakte `post`-Hilfsfunktion und ihren Rückgabetyp ablesen):

```ts
/** Nimmt Erledigt/Quittiert zurück (LFH-343 · C8). */
export function oeffneErinnerung(einsatzId: number, erinnerungId: number) {
  return post<Erinnerung>(`/api/einsaetze/${einsatzId}/erinnerungen/${erinnerungId}/oeffnen`);
}
```

- [ ] **Step 3: Typecheck**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <worktree>/frontend exec tsc --noEmit`
Expected: keine Fehler.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api
git commit -m "feat(lfh-343): reicht die Rueckwege an das Frontend durch

LFH-343"
```

---

## Task 3: „Unbearbeitet" von „gesichtet" trennen (H47) + Wortlaut als Anker (M69)

**Files:**
- Modify: `frontend/src/kommunikation/phase.ts` (Flag am Deskriptor)
- Modify: `frontend/src/kommunikation/StatusBadge.tsx` (fettes Warn-Tag)
- Modify: `frontend/src/meldungen/MeldungKarte.tsx` (Akzent + Schriftgrade)
- Modify: `frontend/src/auftraege/AuftragKarte.tsx` (Akzent)
- Modify: `frontend/src/pages/MeldungenPage.tsx` (Gruppenkopf „Neu (n)")
- Test: `frontend/src/kommunikation/phase.test.ts`,
  `frontend/src/meldungen/MeldungKarte.test.tsx`,
  `frontend/src/auftraege/AuftragListe.test.tsx`,
  `frontend/src/pages/MeldungenPage.test.tsx` (anlegen, falls nicht vorhanden)

**Interfaces:**
- Produces:
  - `StatusDeskriptor` = `Record<string, { label: string; phase: KommPhase; unbearbeitet?: true }>`
  - `MELDUNG_STATUS.neu.unbearbeitet === true`, `AUFTRAG_STATUS.offen.unbearbeitet === true`
  - `StatusBadge`-Prop `unbearbeitet?: boolean` → Tag in `warning`-Farbe mit `fontWeight: 600`
  - `data-unbearbeitet="true"` an der Karte, wenn der Akzent gesetzt ist

### Die zwei Entscheidungen, die dieser Task trifft

**(1) Der linke Rand ist schon belegt.** Alle vier Karten tragen
`borderInlineStart: 3px solid token.colorError` für ihren Alarmzustand (Meldung:
`alarmiert`, Auftrag: `ueberfaellig`, Erinnerung: `faellig`, Nachforderung: `abgelehnt`).
„Unbearbeitet" bekommt deshalb `token.colorWarning`, und **Alarm gewinnt**: eine
unbestätigte überfällige Sofortmeldung ist rot, nicht gelb. Beide Zustände werden getestet.

**(2) Die Meldungsliste wird gruppiert, die Auftragsliste nicht.** `MeldungenPage` ist
heute bewusst flach („keine Fälligkeits-Gruppierung, flache Liste mit Badges"). Der
Gruppenkopf „Neu (n)" bricht das auf zwei Gruppen — eine gesichtete Sofortmeldung steht
danach unter einer neuen Normalmeldung. Das ist gewollt: die Frage der Triage lautet „was
hat noch niemand angefasst", nicht „was ist am dringendsten". Innerhalb jeder Gruppe bleibt
`vergleicheMeldung` (Prio → eskaliert → Ereigniszeit). **`AuftraegeListe` bekommt keinen
zweiten Gruppenkopf** — dort ist die Fälligkeit die Ordnung, und zwei gekreuzte
Gruppierungen wären keine Ordnung mehr; der Akzent allein trägt die Aussage.

- [ ] **Step 1: Failing test in `phase.test.ts`**

```ts
it('markiert genau die unbearbeiteten Eingangszustaende, nicht jede offene Phase', () => {
  // Die zwei Eingangszustaende, um die es geht.
  expect(MELDUNG_STATUS.neu.unbearbeitet).toBe(true);
  expect(AUFTRAG_STATUS.offen.unbearbeitet).toBe(true);
  // „gesichtet" ist angefasst worden — es bleibt neutral. Das ist der ganze Befund
  // H47: beide tragen `phase: 'offen'` und sahen deshalb gleich aus.
  expect(MELDUNG_STATUS.gesichtet.unbearbeitet).toBeUndefined();
  expect(MELDUNG_STATUS.gesichtet.phase).toBe('offen');
  // Und die Marke darf NICHT an der Phase hängen: Entwurf, offene Erinnerung und
  // angeforderte Nachforderung liegen ebenfalls auf `offen` und sind kein „neu".
  expect(BEFEHL_STATUS.entwurf.unbearbeitet).toBeUndefined();
  expect(LAGEBERICHT_STATUS.entwurf.unbearbeitet).toBeUndefined();
  expect(ERINNERUNG_STATUS.offen.unbearbeitet).toBeUndefined();
  expect(NACHFORDERUNG_STATUS.angefordert.unbearbeitet).toBeUndefined();
});
```

- [ ] **Step 2: Test laufen — scheitert**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <worktree>/frontend exec vitest run src/kommunikation/phase.test.ts`
Expected: FAIL — `unbearbeitet` existiert nicht.

- [ ] **Step 3: `phase.ts` erweitern**

```ts
/**
 * Status-Deskriptor eines Moduls: Fachlabel + gemeinsame Ober-Phase.
 *
 * `unbearbeitet` markiert den EINGANGSZUSTAND — den, den noch niemand angefasst hat
 * (LFH-343 · C8, Befund H47). Es ist bewusst KEINE fünfte `KommPhase`: `entwurf`,
 * `offen` (Erinnerung) und `angefordert` liegen alle auf der Phase `offen` und wären
 * von einer neuen Phase stillschweigend zu „neu" umklassifiziert worden.
 */
export type StatusDeskriptor = Record<
  string,
  { label: string; phase: KommPhase; unbearbeitet?: true }
>;
```

und in den beiden Tabellen:

```ts
export const AUFTRAG_STATUS: StatusDeskriptor = {
  offen: { label: 'Offen', phase: 'offen', unbearbeitet: true },
  // …unverändert
};

export const MELDUNG_STATUS: StatusDeskriptor = {
  neu: { label: 'Neu', phase: 'offen', unbearbeitet: true },
  gesichtet: { label: 'Gesichtet', phase: 'offen' },
  // …unverändert
};
```

- [ ] **Step 4: Test grün**

Run: wie Step 2. Expected: PASS.

- [ ] **Step 5: Failing test für `StatusBadge`**

In `frontend/src/kommunikation/badges.test.tsx`:

```tsx
it('hebt das unbearbeitete Etikett strukturell ab, nicht nur im Wortlaut', () => {
  const { rerender } = render(<StatusBadge phase="offen" label="Neu" unbearbeitet />);
  const neu = screen.getByText('Neu').closest('.ant-tag')!;
  expect(neu.className).toContain('ant-tag-warning');
  expect(getComputedStyle(neu).fontWeight).toBe('600');

  rerender(<StatusBadge phase="offen" label="Gesichtet" />);
  const gesichtet = screen.getByText('Gesichtet').closest('.ant-tag')!;
  // Der Kern von H47: „neu" und „gesichtet" tragen dieselbe Phase. Ohne die Marke
  // wären sie an derselben Klasse und demselben Gewicht nicht zu unterscheiden.
  expect(gesichtet.className).not.toContain('ant-tag-warning');
  expect(getComputedStyle(gesichtet).fontWeight).not.toBe('600');
});
```

- [ ] **Step 6: Test laufen — scheitert. Dann `StatusBadge` erweitern**

```tsx
export default function StatusBadge({ phase, label, title, unbearbeitet }: {
  phase: KommPhase;
  label: string;
  title?: string;
  /**
   * Eingangszustand (LFH-343 · C8): Warnfarbe + Fettung. Der zweite Kanal neben
   * der Farbe ist das Gewicht UND der Wortlaut — die Farbe allein trüge die
   * Aussage nicht (WCAG 1.4.1).
   */
  unbearbeitet?: boolean;
}) {
  const tag = (
    <Tag
      color={unbearbeitet ? 'warning' : PHASE_META[phase].color}
      style={unbearbeitet ? { fontWeight: 600 } : undefined}
    >
      {label}
    </Tag>
  );
  return title ? <Tooltip title={title}>{tag}</Tooltip> : tag;
}
```

Run: wie Step 5. Expected: PASS.

- [ ] **Step 7: Failing tests an `MeldungKarte.test.tsx` — Akzent, Vorrang, Schriftgrade**

```tsx
it('gibt der neuen Meldung einen eigenen Akzent, der gesichteten keinen', () => {
  const { container, rerender } = render(
    <MeldungKarte meldung={meldung({ status: 'neu' })} einsatzId={1} />,
  );
  const neu = container.querySelector('.ant-card')!;
  expect(neu.getAttribute('data-unbearbeitet')).toBe('true');

  rerender(<MeldungKarte meldung={meldung({ status: 'gesichtet' })} einsatzId={1} />);
  expect(container.querySelector('.ant-card')!.getAttribute('data-unbearbeitet')).toBeNull();
});

it('laesst den Alarm den Neu-Akzent schlagen', () => {
  // Eine unbestaetigte ueberfaellige Sofortmeldung ist BEIDES. Der linke Rand kann
  // nur eine Farbe tragen — Gefahr gewinnt, sonst faerbte C8 einen Alarm gelb.
  const { container } = render(
    <MeldungKarte
      meldung={meldung({
        status: 'neu', bestaetigung_pflicht: true, ist_bestaetigt: false, ist_ueberfaellig: true,
      })}
      einsatzId={1}
    />,
  );
  const karte = container.querySelector('.ant-card') as HTMLElement;
  expect(karte.getAttribute('data-alarm')).toBe('true');
  expect(karte.getAttribute('data-unbearbeitet')).toBeNull();
});

it('macht den Wortlaut zum groessten Text der Karte', () => {
  render(<MeldungKarte meldung={meldung({ inhalt: 'Wasser im Keller', absender: 'Florian 1' })} einsatzId={1} />);
  const inhalt = screen.getByText('Wasser im Keller');
  const absender = screen.getByText('Florian 1');
  // M69: der Wortlaut war mit 13 px der KLEINSTE Text auf der Karte, der Absender
  // mit 15 px strong der groesste — genau verkehrt herum.
  expect(parseFloat(getComputedStyle(inhalt).fontSize)).toBeGreaterThanOrEqual(15);
  expect(getComputedStyle(inhalt).lineHeight).toBe('1.5');
  expect(parseFloat(getComputedStyle(absender).fontSize))
    .toBeLessThan(parseFloat(getComputedStyle(inhalt).fontSize));
});
```

Die Hilfsfunktion `meldung(...)` aus der bestehenden Testdatei übernehmen; existiert sie
dort unter anderem Namen, diesen verwenden.

- [ ] **Step 8: Tests laufen — scheitern**

Run: `… vitest run src/meldungen/MeldungKarte.test.tsx`
Expected: FAIL (drei Fälle).

- [ ] **Step 9: `MeldungKarte.tsx` umbauen**

Nach `const alarmiert = …`:

```tsx
  // Eingangszustand (LFH-343 · C8, Befund H47): eine neue Meldung sah exakt aus wie
  // eine bereits gesichtete — beide `phase: 'offen'`, zwei graue Tags, drei Buchstaben
  // Unterschied. Der Akzent liegt auf DEMSELBEN linken Rand wie der Alarm; der kann
  // nur eine Farbe tragen, und Gefahr schlägt Eingangszustand.
  const unbearbeitet = !!status.unbearbeitet && !alarmiert;
```

Im `<Card>`:

```tsx
      data-alarm={alarmiert ? 'true' : undefined}
      data-unbearbeitet={unbearbeitet ? 'true' : undefined}
      style={{
        marginBottom: 10,
        borderInlineStart: `3px solid ${
          alarmiert ? token.colorError : unbearbeitet ? token.colorWarning : 'transparent'
        }`,
        background: alarmiert ? token.colorErrorBg : undefined,
        boxShadow: hervorgehoben ? `0 0 0 2px ${token.colorPrimary}` : undefined,
      }}
```

Beim `StatusBadge`: `unbearbeitet={!!status.unbearbeitet}` (die **rohe** Marke, nicht die
alarm-bereinigte — das Etikett bleibt „Neu" in Warnfarbe, auch wenn der Rand rot ist).

Schriftgrade (M69) — die drei Stellen tauschen:

```tsx
      <Space size={6} wrap style={{ marginBottom: 6 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{m.absender}</Text>
        {m.empfaenger && <Text type="secondary" style={{ fontSize: 12 }}>→ {m.empfaenger}</Text>}
      </Space>
```

und der Wortlaut als Anker:

```tsx
      {/* M69: der Wortlaut ist der Grund, warum die Karte existiert — er trägt den
          größten Schriftgrad, Absender/Empfänger fallen auf Metazeilen-Größe zurück.
          Muster ist die Schwesterkarte `AuftragKarte.tsx` (`auftrag_text`, 15/1.4). */}
      <Text style={{ fontSize: 15, lineHeight: 1.5, display: 'block' }}>{m.inhalt}</Text>
```

- [ ] **Step 10: Tests grün**

Run: `… vitest run src/meldungen/MeldungKarte.test.tsx`. Expected: PASS.

- [ ] **Step 11: `AuftragKarte` — Failing test + Umbau**

Test in `frontend/src/auftraege/AuftragListe.test.tsx` (oder einer neuen
`AuftragKarte.test.tsx`, falls die Karte dort nicht direkt gerendert wird):

```tsx
it('hebt den offenen Auftrag ab, den in Bearbeitung nicht — Ueberfaellig schlaegt beides', () => {
  const { container, rerender } = render(<AuftragKarte auftrag={auftrag({ bearbeitungsstatus: 'offen' })} />);
  expect(container.querySelector('.ant-card')!.getAttribute('data-unbearbeitet')).toBe('true');

  rerender(<AuftragKarte auftrag={auftrag({ bearbeitungsstatus: 'in_arbeit' })} />);
  expect(container.querySelector('.ant-card')!.getAttribute('data-unbearbeitet')).toBeNull();

  rerender(<AuftragKarte auftrag={auftrag({ bearbeitungsstatus: 'offen', ist_ueberfaellig: true })} />);
  expect(container.querySelector('.ant-card')!.getAttribute('data-unbearbeitet')).toBeNull();
});
```

Umbau analog Step 9, mit `ueberfaellig` statt `alarmiert`:

```tsx
  const unbearbeitet = !!status.unbearbeitet && !ueberfaellig;
```

- [ ] **Step 12: Failing test für den Gruppenkopf in `MeldungenPage.test.tsx`**

```tsx
it('stellt die neuen Meldungen unter einen eigenen Kopf mit korrekter Zahl', async () => {
  // Zwei neue, eine gesichtete, eine erledigte.
  server.use(meldungenHandler([
    meldung({ id: 1, status: 'neu' }), meldung({ id: 2, status: 'neu' }),
    meldung({ id: 3, status: 'gesichtet' }), meldung({ id: 4, status: 'erledigt' }),
  ]));
  renderMitRouter(<MeldungenPage />, { route: '/einsaetze/1/meldungen' });

  // Die erledigte liegt in der Abgeschlossen-Ansicht und darf nicht mitzaehlen.
  expect(await screen.findByText('Neu (2)')).toBeInTheDocument();
  expect(screen.getByText('In Arbeit (1)')).toBeInTheDocument();
});
```

Testaufbau (`server.use`, `renderMitRouter`, Fixture-Namen) aus einer bestehenden
Seiten-Testdatei desselben Moduls übernehmen — etwa `pages/uhs/MaterialTab.test.tsx` oder
`auftraege/AuftragListe.test.tsx`. Existiert `pages/MeldungenPage.test.tsx` noch nicht, wird
sie hier angelegt.

- [ ] **Step 13: Gruppierung in `MeldungenPage.tsx`**

Neben `offene`/`abgeschlossene`:

```tsx
  // Zwei Gruppen in der Offen-Ansicht (LFH-343 · C8, Befund H47). Die Seite war
  // bewusst flach; der Gruppenkopf ändert das, weil die erste Frage der Triage
  // „was hat noch niemand angefasst" lautet und nicht „was ist am dringendsten".
  // Innerhalb jeder Gruppe bleibt `vergleicheMeldung` die Ordnung.
  const neue = offene.filter((m) => MELDUNG_STATUS[m.status]?.unbearbeitet);
  const angefasste = offene.filter((m) => !MELDUNG_STATUS[m.status]?.unbearbeitet);
  const offeneGruppen = [
    { titel: `Neu (${neue.length})`, meldungen: neue },
    { titel: `In Arbeit (${angefasste.length})`, meldungen: angefasste },
  ].filter((g) => g.meldungen.length > 0);
```

Rendern nach dem Muster von `AuftraegeListe.tsx:219`:

```tsx
      {ansicht === 'offen' ? (
        offeneGruppen.length === 0 ? (
          <MeldungListe meldungen={[]} ansicht="offen" {...listenProps} />
        ) : (
          offeneGruppen.map(({ titel, meldungen }) => (
            <div key={titel} style={{ marginBottom: 16 }}>
              <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 4 }}>
                {titel}
              </Typography.Text>
              <MeldungListe meldungen={meldungen} ansicht="offen" {...listenProps} />
            </div>
          ))
        )
      ) : (
        <MeldungListe meldungen={abgeschlossene} ansicht="abgeschlossen" {...listenProps} />
      )}
```

Die bestehende `sichtbare`-Variable entfällt damit; ihre letzte Verwendung mit entfernen.

- [ ] **Step 14: Alle Tests des Bündels grün**

Run: `… vitest run src/kommunikation src/meldungen src/auftraege src/pages/MeldungenPage.test.tsx`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add frontend/src/kommunikation frontend/src/meldungen frontend/src/auftraege frontend/src/pages/MeldungenPage.tsx
git commit -m "feat(lfh-343): trennt unbearbeitet von gesichtet und macht den Wortlaut zum Anker

Der Akzent liegt auf demselben linken Rand wie der Alarm — Gefahr gewinnt.
Traeger ist ein Flag am Deskriptor, keine fuenfte KommPhase.

LFH-343"
```

---

## Task 4: Ein Klick statt zwei, mit Rückgängig (H50)

**Files:**
- Modify: `frontend/src/meldungen/MeldungKarte.tsx` (nichts zu entfernen — s. u.)
- Modify: `frontend/src/auftraege/AuftragKarte.tsx:99-107` (Popconfirm „In Bearbeitung" raus)
- Modify: `frontend/src/erinnerung/ErinnerungKarte.tsx:71-94` (beide Popconfirms raus)
- Modify: `frontend/src/nachforderungen/NachforderungKarte.tsx:47-55` (Popconfirm raus)
- Create: `frontend/src/kommunikation/rueckgaengig.tsx` (Toast-Primitiv)
- Modify: `frontend/src/pages/MeldungenPage.tsx`, `frontend/src/auftraege/AuftraegeListe.tsx`,
  `frontend/src/pages/ErinnerungenPage.tsx`, `frontend/src/pages/NachforderungenPage.tsx`
  (Undo verdrahten)
- Test: `frontend/src/kommunikation/rueckgaengig.test.tsx` (neu), die vier Karten-Tests,
  `frontend/src/pages/MeldungenPage.test.tsx`

**Interfaces:**
- Consumes: `oeffneErinnerung`, `setzeVollzug(..., 'offen')`, `setzeNachforderungStatus`,
  `setzeMeldungStatus` aus Task 2.
- Produces: `zeigeRueckgaengig(message, text, aufRueckgaengig)` aus
  `kommunikation/rueckgaengig.tsx`.

### Was hier NICHT passiert

`MeldungKarte` ist bereits auf einem Klick: „Sichten"/„In Bearbeitung" haben ihre
Rückfrage in LFH-378 verloren, „Erledigt" trägt bewusst ein `<Modal>` (es räumt die Karte
aus der Offen-Ansicht) und „Bestätigen" seinen `Popconfirm` (Kenntnisnahme einer
Sofortmeldung, fachlich endgültig). Beide bleiben. Ebenso bleiben `Abnehmen` (Auftrag) und
die Freigabe — das sind die „fachlich endgültigen Schritte", die das Ticket ausnimmt.

**Der Toast ist kein Erfolgs-Toast.** CLAUDE.md zitiert EEMUA 191 gegen eine Meldung alle
30 s beim Autosave. Der Unterschied: ein **handlungsfähiger** Undo-Toast ist ein
Bedienelement mit begrenzter Lebensdauer, keine Zustandsmeldung. Er erscheint nur nach einer
Nutzeraktion, nie nach einem Live-Ereignis, und er ersetzt eine Rückfrage, die vorher
**zwei** Interaktionen kostete — die Zahl der Unterbrechungen sinkt, sie steigt nicht.

- [ ] **Step 1: Failing test für das Toast-Primitiv**

`frontend/src/kommunikation/rueckgaengig.test.tsx`:

```tsx
it('bietet einen Rueckgaengig-Knopf an, der genau einmal ausloest und dann schliesst', async () => {
  const zurueck = vi.fn();
  const schliessen = vi.fn();
  const api = { open: vi.fn(), destroy: schliessen } as unknown as MessageInstance;
  zeigeRueckgaengig(api, 'Meldung gesichtet', zurueck);

  const inhalt = (api.open as Mock).mock.calls[0][0].content;
  render(<>{inhalt}</>);
  expect(screen.getByText('Meldung gesichtet')).toBeInTheDocument();

  const knopf = screen.getByRole('button', { name: 'Rückgängig' });
  await userEvent.click(knopf);
  await userEvent.click(knopf);
  // Zweimal geklickt, einmal ausgeloest: ein zweites PATCH schriebe denselben
  // Status noch einmal samt Invalidierung und Live-Ereignis.
  expect(zurueck).toHaveBeenCalledTimes(1);
  expect(schliessen).toHaveBeenCalled();
});
```

- [ ] **Step 2: Test laufen — scheitert (Modul fehlt)**

Run: `… vitest run src/kommunikation/rueckgaengig.test.tsx`
Expected: FAIL — „Failed to resolve import".

- [ ] **Step 3: `rueckgaengig.tsx` schreiben**

```tsx
import { Button, Space } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import { useRef } from 'react';

/** Wie lange der Rückgängig-Weg offensteht. 6 s ist antds `message`-Vorgabe (3 s)
 *  verdoppelt: die Vorgabe ist für eine Kenntnisnahme gedacht, nicht für eine
 *  Entscheidung. */
const DAUER_S = 6;

const SCHLUESSEL = 'lfh-rueckgaengig';

/**
 * Direktaktion mit Rückgängig-Weg (LFH-343 · C8, Befund H50).
 *
 * Ersetzt den `Popconfirm` bei UMKEHRBAREN Schritten: die Rückfrage kostete zwei
 * Klicks VOR der Aktion, dieser Weg kostet einen Klick — und einen zweiten nur,
 * wenn es der falsche war. Bei ~40 Meldungen je Schicht ist das der Unterschied
 * zwischen 80 und 40 Interaktionen.
 *
 * Er wird NUR gezeigt, wo der Rückweg serverseitig existiert (Task 1 hat ihn für
 * Auftrag, Erinnerung und Nachforderung erst geschaffen). Ein Knopf, der 422
 * liefert, wäre schlechter als kein Knopf.
 *
 * `key` ist fest: eine zweite Aktion ersetzt den stehenden Toast, statt einen
 * zweiten daneben zu stapeln — sonst zeigten zwei Toasts zwei verschiedene
 * Rückwege und keiner sagte, welcher zu welchem Datensatz gehört.
 */
export function zeigeRueckgaengig(
  api: MessageInstance,
  text: string,
  aufRueckgaengig: () => void,
) {
  let verbraucht = false;
  api.open({
    key: SCHLUESSEL,
    type: 'success',
    duration: DAUER_S,
    content: (
      <Space>
        <span>{text}</span>
        <Button
          type="link"
          onClick={() => {
            // Ein zweiter Klick schriebe denselben Status erneut — samt
            // Invalidierung und Live-Ereignis für nichts.
            if (verbraucht) return;
            verbraucht = true;
            aufRueckgaengig();
            api.destroy(SCHLUESSEL);
          }}
        >
          Rückgängig
        </Button>
      </Space>
    ),
  });
}
```

Den exakten Importpfad für `MessageInstance` gegen die installierte antd-Fassung prüfen
(`grep -rn 'MessageInstance' frontend/src`) und die Signatur von `api.destroy` gegen
`node_modules/antd/es/message` — nimmt sie keinen Schlüssel, `api.destroy()` ohne Argument
rufen und den Test entsprechend schreiben.

- [ ] **Step 4: Test grün**

Run: wie Step 2. Expected: PASS.

- [ ] **Step 5: Failing test „ein Klick + Rückgängig" an `ErinnerungKarte`**

```tsx
it('erledigt mit EINEM Klick und bietet den Rueckweg an', async () => {
  const onErledigen = vi.fn();
  render(<ErinnerungKarte erinnerung={erinnerung()} darfSchreiben onErledigen={onErledigen} />);
  await userEvent.click(screen.getByRole('button', { name: /Erledigt/ }));
  // Vorher stand hier ein Popconfirm: der Klick oeffnete nur ein Popover, der
  // Callback kam erst mit dem zweiten Klick.
  expect(onErledigen).toHaveBeenCalledWith(1);
  expect(document.querySelector('.ant-popconfirm')).toBeNull();
});
```

Dasselbe Muster für `Quittieren`. Der bestehende Test
`ErinnerungListe.test.tsx:35 ('löst onErledigen nach Popconfirm-Bestätigung aus')` wird
**umgeschrieben**, nicht gelöscht — er ist die Gegenaussage.

- [ ] **Step 6: Tests laufen — scheitern**

Run: `… vitest run src/erinnerung`
Expected: FAIL (der Callback kommt nicht beim ersten Klick).

- [ ] **Step 7: Popconfirms aus den drei Karten entfernen**

`ErinnerungKarte.tsx` — die beiden `Popconfirm`-Hüllen fallen weg, die `Tooltip`s
**bleiben** (sie tragen die fachliche Trennung Quittiert/Erledigt aus LFH-106):

```tsx
  const aktionen: ReactNode[] = darfSchreiben && !istAbg
    ? [
        // Kein `Popconfirm` mehr (LFH-343 · C8, Befund H50): beide Schritte sind seit
        // Task 1 umkehrbar (`POST …/oeffnen`), und der Rückweg steht im Toast. Die
        // Tooltips bleiben — sie tragen die fachliche Trennung aus LFH-106.
        <Tooltip key="q" title={TOOLTIP_QUITTIEREN}>
          <Button onClick={() => onQuittieren?.(e.id)}>Quittieren</Button>
        </Tooltip>,
        <Tooltip key="e" title={TOOLTIP_ERLEDIGT}>
          <Button type="primary" onClick={() => onErledigen?.(e.id)}>Erledigt</Button>
        </Tooltip>,
      ]
    : [];
```

`AuftragKarte.tsx`: der `Popconfirm` um „In Bearbeitung" fällt weg, `Abnehmen` behält
seinen (endgültiger Schritt). Der `Popconfirm` um „quittieren" fällt **ebenfalls** weg —
das Quittieren ist im AK ausdrücklich genannt, und die Empfangsbestätigung ist über
denselben Rückweg nicht umkehrbar … **Achtung, hier zuerst messen:**
`src/routes/auftrag.rs` prüfen, ob eine Ent-Quittierung existiert. Existiert sie nicht,
behält „quittieren" seine Rückfrage, und das wird in der Prüfliste als begründete
Abweichung notiert (dieselbe Regel wie oben: kein Undo-Knopf ohne Rückweg).

`NachforderungKarte.tsx`: der `Popconfirm` um die Fortschaltung fällt weg, „Ablehnen"
behält sein Modal.

- [ ] **Step 8: Tests grün**

Run: `… vitest run src/erinnerung src/auftraege src/nachforderungen`
Expected: PASS.

- [ ] **Step 9: Undo in den vier Seiten verdrahten**

Muster, hier für `ErinnerungenPage.tsx`:

```tsx
  const oeffnenMutation = useMutation({
    mutationFn: (eid: number) => oeffneErinnerung(einsatzId, eid),
    onSuccess: invalidiere,
    onError: fehler,
  });
  const erledigenMutation = useMutation({
    mutationFn: (eid: number) => erledigeErinnerung(einsatzId, eid),
    onSuccess: (_daten, eid) => {
      invalidiere();
      zeigeRueckgaengig(message, 'Erinnerung erledigt', () => oeffnenMutation.mutate(eid));
    },
    onError: fehler,
  });
```

Analog:
- `MeldungenPage.statusMutation`: der Rückweg ist der **vorherige** Status. Die Variablen
  der Mutation um `vorher: MeldungStatus` erweitern und beim Auslösen aus der Karte den
  aktuellen Status mitgeben — `onStatus` bekommt dafür in `listenProps` Zugriff auf
  `alleMeldungen.find(...)`. Text: `Meldung #<lfd_nr> <Ziel-Label>`.
- `AuftraegeListe.onInArbeit`: Rückweg `setzeVollzug(…, 'offen')`.
- `NachforderungenPage.statusMutation`: Rückweg der vorherige Status aus `NAECHSTER`
  rückwärts — die Mutation nimmt ihn als zweite Variable entgegen, statt ihn abzuleiten.

- [ ] **Step 10: Failing test „Auftrag aus Meldung setzt die Quelle auf in_bearbeitung"**

In `frontend/src/pages/MeldungenPage.test.tsx`:

```tsx
it('setzt die Quellmeldung auf „In Bearbeitung", wenn aus ihr ein Auftrag wird', async () => {
  const status = vi.fn();
  server.use(statusHandler(status), auftragAusMeldungHandler());
  renderMitRouter(<MeldungenPage />, { route: '/einsaetze/1/meldungen' });

  // Auftrag aus der Meldung erteilen (Weg über das ⋮-Menü, s. MeldungKarte).
  await userEvent.click(await screen.findByRole('button', { name: /Aktionen zu Meldung 1/ }));
  const menu = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]')!;
  await userEvent.click(within(menu as HTMLElement).getByText(/Auftrag erteilen/));
  await userEvent.type(screen.getByLabelText('Auftrag / Was'), 'Riegelstellung');
  await userEvent.click(screen.getByRole('button', { name: 'Auftrag erteilen' }));

  // Der Kern des Befundes: der Weg Meldung→Auftrag→erledigt kostete sechs Klicks,
  // weil die Quellmeldung nach dem Auftrag unveraendert auf „neu" stand.
  await waitFor(() => expect(status).toHaveBeenCalledWith(
    expect.objectContaining({ meldungId: 1, status: 'in_bearbeitung' }),
  ));
});
```

- [ ] **Step 11: `auftragMutation.onSuccess` erweitern**

```tsx
  const auftragMutation = useMutation({
    mutationFn: ({ meldungId, daten }: { meldungId: number; daten: NeuerAuftrag }) =>
      erteileAuftragAusMeldung(einsatzId, meldungId, daten),
    onSuccess: (_daten, { meldungId }) => {
      invalidiere();
      qc.invalidateQueries({ queryKey: einsatzKeys.auftraege(einsatzId) });
      setAuftragMeldung(null);
      // Wer aus einer Meldung einen Auftrag erteilt, HAT sie bearbeitet. Ohne
      // diesen Schritt stand sie danach weiter auf „neu", und der Weg
      // Meldung→Auftrag→erledigt kostete zwei zusätzliche Klicks (Befund H50).
      // Der Statuswechsel läuft über dieselbe Mutation wie der Knopf — inklusive
      // Rückgängig-Toast, denn er ist genauso umkehrbar.
      const quelle = alleMeldungenRef.current.find((m) => m.id === meldungId);
      if (quelle && quelle.status !== 'in_bearbeitung' && quelle.status !== 'erledigt') {
        statusMutation.mutate({ meldungId, status: 'in_bearbeitung', vorher: quelle.status });
      }
      message.success('Auftrag aus Meldung erteilt');
    },
    onError: fehler,
  });
```

`alleMeldungenRef` ist nötig, weil `alleMeldungen` erst unterhalb der Mutationsdefinition
berechnet wird; alternativ die Mutation nach unten verschieben. **Welcher Weg — beim
Umsetzen entscheiden und den Grund an die Stelle schreiben.**

- [ ] **Step 12: Alle Tests des Bündels grün**

Run: `… vitest run src/kommunikation src/meldungen src/auftraege src/erinnerung src/nachforderungen src/pages`
Expected: PASS.

- [ ] **Step 13: Popconfirm-Zählung als Beleg**

Run:
```bash
grep -c Popconfirm frontend/src/meldungen/MeldungKarte.tsx \
  frontend/src/auftraege/AuftragKarte.tsx \
  frontend/src/erinnerung/ErinnerungKarte.tsx \
  frontend/src/nachforderungen/NachforderungKarte.tsx
```
Die Zahlen in die Prüfliste (Task 8) übernehmen, mit der jeweils verbliebenen Aktion
benannt. Erwartung: `ErinnerungKarte` und `NachforderungKarte` auf 0 (Kommentarzeilen
zählen mit — beim Zählen prüfen, ob ein Treffer bloß Prosa ist, vgl.
Memory „Gate-Kommentar füllt sein eigenes Gate").

- [ ] **Step 14: Commit**

```bash
git add frontend/src
git commit -m "feat(lfh-343): macht die umkehrbaren Statusschritte einklickbar

Popconfirm raus, wo der Rueckweg existiert; Rueckgaengig-Toast statt Rueckfrage.
Der Auftrag aus einer Meldung setzt die Quelle jetzt auf in_bearbeitung.

LFH-343"
```

---

## Task 5: Auftrags-Modal auf den Pflichtkern (H49) + Serienmodus (H52, Teil 1)

**Files:**
- Modify: `frontend/src/auftraege/AuftragFormular.tsx`
- Modify: `frontend/src/meldungen/AuftragErteilenModal.tsx` (Zitat der Quellmeldung)
- Modify: `frontend/src/chat/HeraufstufenAuftragModal.tsx`
- Test: `frontend/src/auftraege/AuftragFormular.test.tsx` (anlegen, falls nicht vorhanden),
  `frontend/src/chat/HeraufstufenAuftragModal.test.tsx` (existiert)

**Interfaces:**
- Produces: `AuftragFormular`-Props zusätzlich
  - `serie?: boolean` (Vorgabe `false`)
  - `zitat?: ReactNode` (read-only Wortlaut über den Feldern)

### Der Feldschnitt

Sichtbar bleiben **vier**: Auftragstext, Empfänger (Abschnitte/Einheiten), Priorität,
Frist. Hinter den zugeklappten Collapse „Befehlsschema (optional)" wandern die sieben
SKK-Felder (Absicht, Lage, Ort, Zeit, Mittel, Verbindung, Sicherheit) **und** die drei
weiteren, die das Ticket nicht nennt, aber mitzählt: „Weitere Empfänger (Funktion)",
„Richtung" und „Erteilt am". Die zwei Extern-Felder hängen an `richtung` und wandern
**mit** — sie stehen sonst sichtbar unter einem eingeklappten Auslöser.

**`richtung` ist der Grenzfall:** sie steuert die Sichtbarkeit der Extern-Felder und ist
damit kein Detail. Sie geht trotzdem in den Collapse, weil `intern` der Normalfall ist und
der externe Auftrag der begründete Sonderfall — und weil ein sichtbares fünftes Feld das
Budget sprengt. Der Collapse-Kopf nennt das: „Befehlsschema und Richtung (optional)".

- [ ] **Step 1: Failing test — Feldzahl UND die zweite Hälfte**

`frontend/src/auftraege/AuftragFormular.test.tsx`:

```tsx
const SKK = ['Absicht / Ziel', 'Lage', 'Ort / Wo', 'Zeit / Wann', 'Mittel / Womit',
  'Verbindung / Meldewege', 'Sicherheit / Besonderes'];

it('zeigt im Ausgangszustand vier Felder und die sieben Schemafelder erst nach dem Aufklappen', async () => {
  render(<AuftragFormular senden={false} abschnitte={[]} einheiten={[]} onAnlegen={vi.fn()} card={false} />);

  // Die „<= 4"-Haelfte allein ist nicht widerlegbar: ein Collapse rendert seinen
  // Inhalt ohne `forceRender` ohnehin erst beim Aufklappen. Erst das Paar traegt.
  const vorher = screen.getAllByRole('textbox').length + screen.getAllByRole('combobox').length;
  expect(vorher).toBeLessThanOrEqual(4);
  for (const feld of SKK) expect(screen.queryByLabelText(feld)).toBeNull();

  await userEvent.click(screen.getByText(/Befehlsschema/));

  for (const feld of SKK) expect(screen.getByLabelText(feld)).toBeInTheDocument();
  const nachher = screen.getAllByRole('textbox').length + screen.getAllByRole('combobox').length;
  expect(nachher).toBeGreaterThan(vorher);
});
```

Ob die Felder über `getByLabelText` auffindbar sind, hängt an antds `Form.Item`-Bindung;
schlägt es fehl, die Abfrage auf `getByRole('textbox', { name: … })` umstellen — **nicht**
den Test entschärfen.

- [ ] **Step 2: Test laufen — scheitert (alle Felder sichtbar)**

Run: `… vitest run src/auftraege/AuftragFormular.test.tsx`
Expected: FAIL bei `vorher <= 4`.

- [ ] **Step 3: `AuftragFormular` umbauen**

Die Feldgruppen ab „Weitere Empfänger" bis „Erteilt am" (ohne Priorität und Frist) in einen
`<Collapse ghost items={[…]}>` verlagern:

```tsx
      {/* LFH-19-Feldbudget (LFH-343 · C8, Befund H49): sichtbar bleiben die vier
          Pflichtangaben. Das SKK-Schema ist die Ausarbeitung eines Befehls — an der
          Triage-Liste wird sie selten gebraucht und kostete dort ein 14-Feld-Modal.
          `forceRender` bewusst NICHT: die Felder sollen erst beim Aufklappen im DOM
          stehen, sonst wäre die Zusicherung nicht prüfbar. */}
      <Collapse
        ghost
        style={{ marginInline: -8, marginBottom: 8 }}
        items={[{ key: 'schema', label: 'Befehlsschema und Richtung (optional)', children: (<>…</>) }]}
      />
```

Der Absende-Knopf bleibt der letzte Knoten im `<Form>`.

- [ ] **Step 4: Test grün**

Run: wie Step 2. Expected: PASS. Danach `… vitest run src/chat/HeraufstufenAuftragModal.test.tsx` —
bestehende Abfragen auf die SKK-Felder brechen dort ggf. und werden ums Aufklappen ergänzt.

- [ ] **Step 5: Zitat der Quellmeldung**

`AuftragErteilenModal.tsx` übergibt ein `zitat`:

```tsx
      <AuftragFormular
        card={false}
        senden={senden}
        abschnitte={abschnitte}
        einheiten={einheiten}
        initialText={initialText(meldung)}
        zitat={meldung && (
          // Read-only: wer den Auftrag formuliert, braucht den Wortlaut im Blick,
          // darf ihn aber nicht ändern — die Meldung ist beweissichernd.
          <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
            <Typography.Text strong>{meldung.absender}:</Typography.Text> {meldung.inhalt}
          </Typography.Paragraph>
        )}
        onAnlegen={onAnlegen}
      />
```

`HeraufstufenAuftragModal` analog mit `nachricht.autor_name` / `nachricht.inhalt` (die
tatsächlichen Feldnamen aus `ChatNachricht` ablesen).

In `AuftragFormular` wird `zitat` direkt über dem ersten `Form.Item` gerendert.

- [ ] **Step 6: Serienmodus in `AuftragFormular`**

`AuftragFormular` auf `ErfassungsFormular` umstellen (Träger-Pflicht aus CLAUDE.md, da die
Datei ohnehin angefasst wird). `serie` als Prop durchreichen, **Vorgabe `false`**:

```tsx
/**
 * Serienerfassung (LFH-332/B4-Hülle). In den zwei Modal-Einbettungen bewusst AUS:
 * dort entsteht genau EIN Auftrag zu genau EINER Meldung/Nachricht, ein
 * „Speichern und nächste" hätte kein Nächstes. An der Auftragsliste ist er AN.
 */
serie?: boolean;
```

Wiederholfelder: `['ziele', 'prioritaet', 'richtung']` — an derselben Lage geht der nächste
Auftrag meist an dieselbe Einheit.

- [ ] **Step 7: Test für die Serien-Ausnahme im Modal**

```tsx
it('bietet im Modal kein „Speichern und naechste" — ein Auftrag je Meldung', () => {
  render(<AuftragErteilenModal meldung={meldung()} abschnitte={[]} einheiten={[]}
    senden={false} onAbbrechen={vi.fn()} onAnlegen={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /Speichern und n/ })).toBeNull();
});
```

- [ ] **Step 8: Tests grün, Commit**

Run: `… vitest run src/auftraege src/chat src/meldungen`

```bash
git add frontend/src/auftraege frontend/src/meldungen frontend/src/chat
git commit -m "feat(lfh-343): bringt das Auftrags-Modal auf vier Felder und in die Erfassungshuelle

Das Befehlsschema wandert hinter einen zugeklappten Collapse, die Quellmeldung
steht als Zitat darueber. Serienmodus an der Liste, im Modal aus.

LFH-343"
```

---

## Task 6: Serienerfassung für Erinnerung und Nachforderung (H52, Teil 2)

**Files:**
- Modify: `frontend/src/erinnerung/ErinnerungFormular.tsx`
- Modify: `frontend/src/nachforderungen/NachforderungFormular.tsx`
- Modify: `frontend/src/pages/ErinnerungenPage.tsx:50` (kein `setFormOffen(false)`, `mutateAsync`)
- Modify: `frontend/src/pages/NachforderungenPage.tsx:53` (dito)
- Modify: `frontend/src/auftraege/AuftraegeListe.tsx:77` (dito)
- Test: die drei zugehörigen Testdateien

**Interfaces:**
- Consumes: `ErfassungsFormular` aus `components/Erfassung.tsx` — Props `form`,
  `onErfassen` (Promise!), `onFertig`, `serie`, `uebernahme`, `initialValues`.

- [ ] **Step 1: Failing test am Muster von `MeldungFormular.test.tsx`**

```tsx
it('bleibt nach dem Speichern offen, leert den Wortlaut und behaelt die Wiederholfelder', async () => {
  const anlegen = vi.fn().mockResolvedValue({});
  render(<ErinnerungFormular senden={false} onAnlegen={anlegen} card={false} />);

  await userEvent.click(screen.getByLabelText('Werte behalten'));
  await userEvent.type(screen.getByLabelText('Titel'), 'Lagemeldung absetzen');
  await userEvent.type(screen.getByLabelText(/für/), 'S2');
  await userEvent.click(screen.getByRole('button', { name: /Speichern und n/ }));

  await waitFor(() => expect(anlegen).toHaveBeenCalledTimes(1));
  // Der Titel wechselt, der Adressat bleibt — das ist der Unterschied zwischen
  // „Formular offen lassen" und Serienerfassung.
  expect(screen.getByLabelText('Titel')).toHaveValue('');
  expect(screen.getByLabelText(/für/)).toHaveValue('S2');
});

it('laesst den Wortlaut stehen, wenn der Server ablehnt', async () => {
  const anlegen = vi.fn().mockRejectedValue(new Error('422'));
  render(<ErinnerungFormular senden={false} onAnlegen={anlegen} card={false} />);
  await userEvent.type(screen.getByLabelText('Titel'), 'Lagemeldung absetzen');
  await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
  await waitFor(() => expect(anlegen).toHaveBeenCalled());
  expect(screen.getByLabelText('Titel')).toHaveValue('Lagemeldung absetzen');
});
```

Die exakten Feld-Labels aus dem jeweiligen Formular ablesen, bevor der Test geschrieben
wird. Wiederholfelder: Erinnerung `['empfaenger_funktion', 'intervall_minuten']`,
Nachforderung `['adressat_kategorie', 'adressat_bezeichnung', 'prioritaet']`.

- [ ] **Step 2: Tests laufen — scheitern**

Run: `… vitest run src/erinnerung/ErinnerungFormular.test.tsx`
Expected: FAIL — es gibt keinen „Speichern und nächste"-Knopf.

- [ ] **Step 3: Formulare auf die Hülle umstellen**

Muster ist `meldungen/MeldungFormular.tsx`: `<Form>` durch `<ErfassungsFormular>` ersetzen,
`onAnlegen` auf `Promise<unknown>` typisieren, `serie`, `uebernahme` und `initialValues`
setzen, den eigenen Absende-Knopf entfernen (die Hülle bringt ihn mit).

- [ ] **Step 4: Seiten anpassen**

In `ErinnerungenPage.tsx`, `NachforderungenPage.tsx`, `AuftraegeListe.tsx`:
- `setFormOffen(false)` aus `anlegenMutation.onSuccess` **entfernen** — samt Kommentar,
  warum (Muster: der Block in `MeldungenPage.tsx`, LFH-332/B4).
- Der Aufruf im JSX wechselt von `mutate` auf **`mutateAsync`**: die Hülle darf die Felder
  nur leeren, wenn der Datensatz angekommen ist.
- Der Erfolgs-Toast der Mutation bleibt; der Zähler kommt aus der Hülle.

- [ ] **Step 5: Tests grün**

Run: `… vitest run src/erinnerung src/nachforderungen src/auftraege src/pages`
Expected: PASS. Bestehende Tests, die auf ein Zuklappen nach dem Speichern zeigen, werden
in ihr Gegenteil umgeschrieben statt gelöscht.

- [ ] **Step 6: Commit**

```bash
git add frontend/src
git commit -m "feat(lfh-343): erfasst Erinnerung, Nachforderung und Auftrag in Serie

Die drei Masken ziehen auf die B4-Huelle um: offen bleiben, leeren statt
schliessen, Wiederholfelder behalten, mutateAsync statt mutate.

LFH-343"
```

---

## Task 7: Chat-Layout (H51, M72) und Befehls-Kopfzeile (M73)

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx:235-290`
- Modify: `frontend/src/chat/NachrichtenStrom.tsx` (Scroll-Anker + Pille)
- Modify: `frontend/src/pages/BefehlDetailPage.tsx:252-289`
- Test: `frontend/src/chat/NachrichtenStrom.test.tsx`,
  `frontend/e2e/chat-layout.spec.ts` (neu)

### Die Höhenkette — vor dem Stylen lesen

`components/AppLayout.tsx:117` und `einsatz/EinsatzLayout.tsx:262` setzen
`minHeight: '100vh'`, der `<Content>` hat **keine** feste Höhe. `flex: 1; min-height: 0;
overflow-y: auto` scrollt in einer solchen Kette **nichts** — der Vorfahr wächst einfach
mit. Der Chat muss seine Höhe deshalb selbst begrenzen: die Seitenwurzel bekommt
`height: calc(100dvh - <Kopf + Polsterung>)` und `display: flex; flexDirection: column`,
darunter greift die Flex-Kette. **`dvh`, nicht `vh`** — auf dem Handschirm frisst die
Browserleiste sonst die Eingabe. Die Kopfhöhe steht als CSS-Variable in `theme/rollen.css`;
den Namen dort ablesen (`grep -n 'kopf' frontend/src/theme/rollen.css`), **nicht** raten.

- [ ] **Step 1: Failing test — Scroll-Anker in `NachrichtenStrom`**

```tsx
it('haelt den Blick unten, wenn eine neue Nachricht kommt — und NICHT beim Nachladen aelterer', () => {
  const { rerender } = render(<NachrichtenStrom nachrichten={[n(1), n(2)]} {...props} />);
  const container = screen.getByTestId('nachrichten-strom');
  // jsdom rechnet kein Layout: geprueft wird der AUFRUF, nicht die Pixelposition.
  const scrollen = vi.spyOn(container, 'scrollTo');

  rerender(<NachrichtenStrom nachrichten={[n(1), n(2), n(3)]} {...props} />);
  expect(scrollen).toHaveBeenCalled();

  scrollen.mockClear();
  // „Aeltere laden" stellt VORNE etwas dazu. Ein „stick to bottom" darauf risse
  // den Lesenden aus dem, was er gerade liest.
  rerender(<NachrichtenStrom nachrichten={[n(0), n(1), n(2), n(3)]} {...props} />);
  expect(scrollen).not.toHaveBeenCalled();
});
```

Die Unterscheidung läuft über die **id der letzten** Nachricht: wächst sie, ist es neu;
wächst nur die Länge bei gleicher letzter id, wurde vorne angebaut.

- [ ] **Step 2: Test laufen — scheitert. Dann Scroll-Container + Anker bauen**

`NachrichtenStrom` bekommt eine eigene Wurzel:

```tsx
    <div
      ref={containerRef}
      data-testid="nachrichten-strom"
      style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
    >
```

plus einen Effekt, der bei gewachsener letzter id ans Ende scrollt — es sei denn, der
Lesende ist weiter oben; dann erscheint stattdessen die Pille „n neue Nachrichten"
(`position: sticky; bottom: 8px`), die beim Klick nach unten springt.

- [ ] **Step 3: `ChatPage` — Höhenkette und Breakpoints**

```tsx
  const { breit } = useViewport(); // den tatsächlichen Hook-Namen aus components/useViewport.ts ablesen
```

```tsx
      <Row gutter={16} style={{ flex: 1, minHeight: 0 }}>
        <Col xs={24} md={6} lg={5} style={{ display: breit ? undefined : 'none' }}>
          <KanalListe … />
        </Col>
        <Col xs={24} md={18} lg={19} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          {/* Strom + Eingabe */}
        </Col>
      </Row>
```

Unter `md` steht statt der Spalte eine horizontale `<Segmented>`-Leiste über dem Strom, aus
denselben `sortiereKanaele(kanaele)` gespeist (ungelesene zuerst) — der Ungelesen-Punkt
wandert als `<Badge dot>` ins Segment-Label.

Die Seitenwurzel:

```tsx
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - var(--lfh-kopf-hoehe) - 2 * var(--lfh-seiten-polsterung))' }}>
```

Den Variablennamen aus `theme/rollen.css` verifizieren; fehlt eine Kopfhöhen-Variable, wird
sie dort angelegt und vom Layout mitbenutzt (**nicht** eine zweite Zahl daneben schreiben).

- [ ] **Step 4: e2e — der eigentliche Beleg**

`frontend/e2e/chat-layout.spec.ts`:

```ts
test('das Eingabefeld bleibt bei 100 Nachrichten und nach dem Absenden sichtbar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await anmelden(page); // Muster der Nachbar-Specs
  await page.goto(`/einsaetze/${einsatzId}/chat`);

  // 100 Nachrichten erzeugen (API-Schleife, Muster der bestehenden Fixtures).
  await erzeugeNachrichten(page, einsatzId, 100);
  await page.reload();

  const eingabe = page.getByPlaceholder('Nachricht…');
  await expect(eingabe).toBeInViewport();
  await eingabe.fill('Probe');
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(eingabe).toBeInViewport();

  // Und der Body scrollt nicht waagerecht (AK).
  const ueberstand = await page.evaluate(
    () => document.body.scrollWidth - document.body.clientWidth,
  );
  expect(ueberstand).toBeLessThanOrEqual(0);
});

test('die Auftraege-Seite scrollt bei 390 px nicht waagerecht', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await anmelden(page);
  await page.goto(`/einsaetze/${einsatzId}/auftraege`);
  const ueberstand = await page.evaluate(
    () => document.body.scrollWidth - document.body.clientWidth,
  );
  expect(ueberstand).toBeLessThanOrEqual(0);
});
```

Fixture-Namen und Anmeldehilfe aus einer bestehenden Spec übernehmen. **Memory-Falle:**
Fixture-Namen ohne Modulnamen wählen, `toBeVisible` ist nicht dasselbe wie
`toBeInViewport`.

- [ ] **Step 5: e2e laufen**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <worktree>/frontend e2e`
Expected: alle grün. (Die Suite startet Backend und Vite selbst; `target/debug/lifeline-hub`
muss gebaut sein.)

- [ ] **Step 6: M73 — Befehls-Kopfzeile umbruchfähig**

`BefehlDetailPage.tsx`: das äußere `<Space>` wird `<Flex justify="space-between"
align="center" gap={16} wrap>` (Muster der vier Schwesterseiten), die Tag-Gruppe rutscht
**unter** den Titel, die Aktionen bilden eine eigene umbruchfähige Zeile.

**Was dabei erhalten bleiben MUSS** (C7/LFH-342): der Text
„zuletzt gespeichert HH:MM" / „ungespeicherte Änderungen" neben dem Speichern-Knopf und der
`freigabeBestaetigen`-Pfad. Ein Test in `BefehlDetailPage.test.tsx` prüft beides nach dem
Umbau — brechen die C7-Tests, ist der Umbau falsch, nicht der Test.

Die Aktionsleiste unterhalb des Tablet-Breakpoints am unteren Rand verankern
(`position: sticky; bottom: 0`, Hintergrund aus `token.colorBgContainer`), damit
„Freigeben" erreichbar bleibt.

- [ ] **Step 7: Tests grün, Commit**

Run: `… vitest run src/chat src/pages` und `… pnpm e2e`

```bash
git add frontend/src frontend/e2e
git commit -m "feat(lfh-343): gibt dem Chat einen Scroll-Container und der Befehlskopfzeile Umbruch

Die Hoehenkette endet nicht am Layout — die Chat-Wurzel begrenzt sich selbst
(dvh, nicht vh). Stick-to-bottom nur bei neuer Nachricht, nicht beim Nachladen.

LFH-343"
```

---

## Task 8: Prüfliste, CLAUDE.md und Gate

**Files:**
- Create: `docs/superpowers/specs/2026-08-21-lfh-343-pruefliste.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Volles Gate**

Run: `./scripts/check-all.sh`
Expected: alle sieben Schritte grün. Kein `| tail`.

- [ ] **Step 2: Prüfliste schreiben**

Format nach `docs/superpowers/specs/2026-08-21-lfh-342-pruefliste.md`: Kopf mit Umfang,
gemessene Baseline-Tabelle (vorher/nachher), dann die 15 Kriterien mit je einem Verdikt
(erfüllt / offen → Zielticket / nicht anwendbar). Die Seiten im Umfang: Meldungen,
Aufträge/Befehle (beide Tabs), Erinnerungen, Nachforderungen, Chat.

Zahlen, die dort belegt gehören:
- Klicks für Sichten / In Bearbeitung / Erledigt / Quittieren / Fortschaltung: vorher 2,
  nachher 1 (plus optional 1 für Rückgängig).
- Sichtbare Felder im Auftrags-Modal: vorher 14, nachher 4.
- `grep -c Popconfirm` je Kartendatei, mit der verbliebenen Aktion benannt.
- Vitest-Fälle auf den fünf Modulverzeichnissen, **beide Stände gefahren**.
- Die drei ausgebuchten Punkte (M68/M70/M71) mit ihrem Träger-Ticket.
- Die begründeten Abweichungen: `AuftraegeListe` ohne zweiten Gruppenkopf; ggf.
  „quittieren" mit Rückfrage, falls Task 4/Step 7 keinen Rückweg gefunden hat.

- [ ] **Step 3: CLAUDE.md fortschreiben**

In die Bedien-Leitlinie aufnehmen, jeweils mit dem gemessenen Grund:
- **„Der linke Rand trägt eine Farbe, und Gefahr gewinnt"** — die vier Karten, die
  Vorrangregel, `data-alarm`/`data-unbearbeitet` als prüfbare Marken.
- **„Erst die Umkehrbarkeit, dann der Rückgängig-Knopf"** — die Fortschreibung von
  LFH-378: ein Undo ohne serverseitigen Rückweg ist ein 422; C8 hat die Rückwege deshalb
  zuerst gebaut. Mit der Tabelle, welche Schritte umkehrbar sind.
- **„Ein handlungsfähiger Toast ist keine Alarmmeldung"** — die Abgrenzung zum
  EEMUA-191-Budget, das gegen Erfolgs-Toasts steht.
- **„Eine Höhenkette endet nicht am Layout"** — `minHeight: 100vh` am `<Layout>` trägt
  keinen `overflow-y: auto`-Nachfahren; die begrenzende Höhe muss die Seite selbst setzen,
  in `dvh`.
- **„Die Marke sitzt am Deskriptor, nicht an der Phase"** — warum keine fünfte
  `KommPhase`, mit der Liste der vier Status, die sonst mitgerissen worden wären.

- [ ] **Step 4: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs(lfh-343): legt die Pruefliste an und schreibt CLAUDE.md fort

LFH-343"
```

---

## Self-Review

**Spec-Abdeckung:** H47 → Task 3 · M71 → Vorbefund (erledigt) · H50 → Task 1, 2, 4 ·
H49 → Task 5 · H51/M72 → Task 7 · H52 → Task 5 (Auftrag), Task 6 (Erinnerung,
Nachforderung); Meldung war seit LFH-332 fertig · M68 → Vorbefund · M69 → Task 3 ·
M70 → Vorbefund · M73 → Task 7. Prüfliste → Task 8. **Kein Ticket-Punkt ohne Task.**

**Akzeptanzkriterien:** AK1 → Task 3/Step 7+12 · AK2 → Task 4/Step 5+13 · AK3 →
Task 4/Step 10 · AK4 → Task 5/Step 1 · AK5 → Task 7/Step 4 · AK6 → Vorbefund + Task 8/Step 1.

**Offene Messung, die beim Umsetzen entschieden wird:** ob eine Ent-Quittierung des
Auftrags-Empfängers existiert (Task 4/Step 7). Findet sie sich nicht, behält „quittieren"
seine Rückfrage — und das AK weicht begründet ab, statt einen 422-Knopf zu bauen.
