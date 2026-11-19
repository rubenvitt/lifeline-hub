# Ansprechpartner bei fehlendem Recht — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die drei Sackgassen bei fehlendem Recht (leere Einsatzliste, Direktlink mit 403, gesperrtes Modul) sagen, wer den Zugriff vergibt, und bieten kein nutzloses „Erneut abrufen“ mehr.

**Architecture:** Der Server hängt an den 403 der Einsatz-Lesesperre einen `grund` (`kein_mitglied` / `nachlauf_abgelaufen` / `nicht_mehr_lesbar`), nach dem Muster von `NichtInListe`. Das Frontend wählt daraus in einer reinen Funktion Titel, Hinweis und ob ein Neuversuch angeboten wird. Das gesperrte Modul liest die Namen der Einsatzleitung aus dem bestehenden `GET /api/einsaetze/{id}/mitglieder`.

**Tech Stack:** Rust (axum, sqlx, `wire_enum!`), React + TypeScript (antd, TanStack Query, Vitest).

**Spec:** `docs/superpowers/specs/2026-11-19-zbihthkr-ansprechpartner-bei-fehlendem-recht-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/zbihthkruxvgv5ih4hhccgz5 (LLH-1819)

## Global Constraints

- Wer lesen darf und wer nicht, ändert sich für **keine** Eingabe; nur der Grund kommt dazu.
- Reihenfolge der Gründe: `kein_mitglied` vor `nicht_mehr_lesbar` vor `nachlauf_abgelaufen` (kein Leck an Fremde).
- Nur die Lesesperre (`fordere_lesezugriff`, `fordere_org_zugehoerigkeit`) bekommt einen Grund; jeder andere 403 bleibt `AppError::Forbidden`.
- Body des 403: `{"error": "Keine Berechtigung", "grund": "<wert>"}`.
- Am Direktlink nie ein Name.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (Wurzel-`AGENTS.md`, LFH-1312); Prosa deutsch.
- Query-Keys nur über `einsatzKeys.*` (`frontend/AGENTS.md`, Wächter `queryKeys.guard.test.ts`).
- Gates vor dem PR: `./scripts/check-all.sh --geaendert --ohne-e2e`; Node/pnpm über `mise exec --`.

## Review Focus

- Fremder (andere Org, kein Mitglied) ruft einen gelöschten oder abgelaufenen Einsatz auf → muss `kein_mitglied` bekommen, nie `nicht_mehr_lesbar` (Task 2, Test `lese_sperre_fremder_mit_tombstone_ist_kein_mitglied`).
- Admin/Führungskraft mit Fremdeinsatz-Lesezugriff auf abgelaufenen Einsatz → `nicht_mehr_lesbar`, nicht `kein_mitglied` (Task 2).
- 403 ohne `grund` (älterer Server, anderer 403-Pfad) → Frontend zeigt den Text für `kein_mitglied`, ohne „Erneut abrufen“ (Task 3).
- Mehrere Einsatzleitungen / keine Einsatzleitung / Mitgliederabruf scheitert → alle Namen, bzw. Satz ohne Namen, nie leere Aufzählung „: “ (Task 4).
- Netzfehler am Direktlink → „Erneut abrufen“ bleibt (Task 3).

---

### Task 1: Fehlervariante `KeinLesezugriff` mit Grund

**Files:**
- Modify: `src/error.rs` (Enum `AppError`, `Display`, Status, `into_response`, Tests am Dateiende)
- Modify: `tests/enum_wire_kontrakt.rs` (neuer Block neben `zeilen_art_wire`)

**Interfaces:**
- Produces: `lifeline_hub::error::LeseSperre` (`wire_enum!`, Varianten `KeinMitglied => "kein_mitglied"`, `NachlaufAbgelaufen => "nachlauf_abgelaufen"`, `NichtMehrLesbar => "nicht_mehr_lesbar"`, derives wie `ZeilenArt`), `AppError::KeinLesezugriff(LeseSperre)`.

- [ ] **Step 1: Failing tests** in `src/error.rs` (`mod tests`), nach `nicht_in_liste_ist_404_mit_grund`:

```rust
#[tokio::test]
async fn kein_lesezugriff_ist_403_mit_grund() {
    let resp = AppError::KeinLesezugriff(LeseSperre::NachlaufAbgelaufen).into_response();
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(resp.into_body(), usize::MAX).await.unwrap()).unwrap();
    assert_eq!(body["error"], "Keine Berechtigung");
    assert_eq!(body["grund"], "nachlauf_abgelaufen");
}
```

und in `tests/enum_wire_kontrakt.rs`:

```rust
#[test]
fn lese_sperre_wire() {
    enum_wire!(lifeline_hub::error::LeseSperre {
        KeinMitglied => "kein_mitglied",
        NachlaufAbgelaufen => "nachlauf_abgelaufen",
        NichtMehrLesbar => "nicht_mehr_lesbar",
    } in lifeline_hub::error::LeseSperre::ALLE);
}
```

- [ ] **Step 2: Fail prüfen** — `cargo test --lib error::tests::kein_lesezugriff` → Kompilierfehler (Variante fehlt).
- [ ] **Step 3: Implementieren** — `LeseSperre` per `wire_enum!` mit Doc-Kommentar je Variante (Bedeutung wie Spec); `AppError::KeinLesezugriff(LeseSperre)` mit Doc-Verweis auf LLH-1819; `Display` → „Keine Berechtigung“; Status `FORBIDDEN` (in den Arm von `Forbidden`); in `into_response` ein Zweig wie bei `NichtInListe` mit `"grund": sperre.as_str()`. Danach `grep -rn "AppError::Forbidden" src` und jeden `match`/`matches!`, der „kein Recht“ erkennt, um die Variante ergänzen (bekannt: `src/einsatz/kontext.rs` `darf_zielmodul`; `src/public_api/error.rs` `From<AppError>` prüfen, ob Status oder Code am Variantennamen hängt).
- [ ] **Step 4: Grün prüfen** — `cargo test --lib error::tests` und `cargo test --test enum_wire_kontrakt` → PASS.
- [ ] **Step 5: Commit** — `feat(berechtigung): 403 der Lesesperre trägt einen Grund (LLH-1819)`.

### Task 2: Grund an der Lesesperre

**Files:**
- Modify: `src/einsatz/berechtigung.rs` (`darf_lesen`, `fordere_lesezugriff`, `fordere_org_zugehoerigkeit`, Tests im selben File)
- Modify: `tests/einsatz.rs` (`detail_fuer_nicht_mitglied_ist_403`, `geloescht_at_tombstone_sperrt_detail_export_stream_403`)

**Interfaces:**
- Consumes: `LeseSperre`, `AppError::KeinLesezugriff` (Task 1).
- Produces: `pub fn lese_sperre(benutzer: &Benutzer, einsatz_org_id: i64, status: &str, abgeschlossen_at: Option<&str>, retention_bis: Option<&str>, geloescht_at: Option<&str>, rolle: Option<EinsatzRolle>, jetzt: DateTime<Utc>) -> Option<LeseSperre>`; `darf_lesen(...)` bleibt mit gleicher Signatur = `lese_sperre(...).is_none()`.

- [ ] **Step 1: Failing tests** in `berechtigung.rs` (`mod tests`, vorhandene Helfer für Benutzer/Zeit nutzen):
  - `lese_sperre_nicht_mitglied_ist_kein_mitglied` — ohne Rolle, aktiv → `Some(KeinMitglied)`.
  - `lese_sperre_fremder_mit_tombstone_ist_kein_mitglied` — ohne Rolle, `geloescht_at` gesetzt → `Some(KeinMitglied)`.
  - `lese_sperre_fremder_mit_abgelaufener_aufbewahrung_ist_kein_mitglied` → `Some(KeinMitglied)`.
  - `lese_sperre_mitglied_mit_tombstone_ist_nicht_mehr_lesbar` → `Some(NichtMehrLesbar)`.
  - `lese_sperre_fremdleser_mit_abgelaufener_aufbewahrung_ist_nicht_mehr_lesbar` (System-Admin) → `Some(NichtMehrLesbar)`.
  - `lese_sperre_mitglied_nach_nachlauf_ist_nachlauf_abgelaufen` (Rolle ≠ Einsatzleitung, abgeschlossen, außerhalb der Frist) → `Some(NachlaufAbgelaufen)`.
  - `lese_sperre_einsatzleitung_nach_nachlauf_ist_none` → `None`.
  - `fordere_org_zugehoerigkeit_ohne_rolle_ist_kein_mitglied` → `Err(AppError::KeinLesezugriff(LeseSperre::KeinMitglied))`.
- [ ] **Step 2: Fail prüfen** — `cargo test --lib einsatz::berechtigung` → Kompilierfehler.
- [ ] **Step 3: Implementieren** — `lese_sperre` in der Reihenfolge: (1) weder `rolle.is_some()` noch `benutzer.darf_fremdeinsatz_lesen(org)` → `KeinMitglied`; (2) Tombstone oder (abgeschlossen ∧ Aufbewahrung abgelaufen) → `NichtMehrLesbar`; (3) Fremdleser → `None`; (4) aktiv oder in Nachlauffrist → `None`; (5) Einsatzleitung → `None`, sonst `NachlaufAbgelaufen`. Doc-Kommentar von `darf_lesen` auf `lese_sperre` umziehen, Reihenfolge-Begründung (kein Leck) ergänzen. `fordere_lesezugriff` → `Err(KeinLesezugriff(grund))`; `fordere_org_zugehoerigkeit` → `Err(KeinLesezugriff(KeinMitglied))`. Bestehende Tests, die `AppError::Forbidden` aus diesen beiden erwarten, auf die neue Variante umstellen (Inhalt prüfen, nicht nur Variante).
- [ ] **Step 4: Routentests** in `tests/einsatz.rs`: `detail_fuer_nicht_mitglied_ist_403` liest zusätzlich den Body, `assert_eq!(json["grund"], "kein_mitglied")`; im Tombstone-Test für das Mitglied `assert_eq!(json["grund"], "nicht_mehr_lesbar")` (am Detail-Abruf).
- [ ] **Step 5: Grün prüfen** — `cargo test --lib einsatz::berechtigung`, `cargo test --test einsatz`, `cargo test --test einsatz_kontext_guard`, `cargo test --test aufbewahrung` → PASS.
- [ ] **Step 6: Commit** — `feat(berechtigung): Lesesperre nennt kein_mitglied, nachlauf_abgelaufen, nicht_mehr_lesbar (LLH-1819)`.

### Task 3: Direktlink ohne Recht

**Files:**
- Modify: `frontend/src/api/client.ts` (Konstanten neben `GRUND_VERALTET`)
- Create: `frontend/src/einsatz/sackgasse.ts`, Test `frontend/src/einsatz/sackgasse.test.ts`
- Modify: `frontend/src/components/SeitenZustand.tsx` (`SeitenSackgasse`), Test `SeitenZustand.test.tsx`
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx:432-440`, Test `EinsatzLayout.test.tsx`

**Interfaces:**
- Produces: `GRUND_KEIN_MITGLIED = 'kein_mitglied'`, `GRUND_NACHLAUF_ABGELAUFEN = 'nachlauf_abgelaufen'`, `GRUND_NICHT_MEHR_LESBAR = 'nicht_mehr_lesbar'` (Kommentar: `src/error.rs`, `LeseSperre`);
  `export interface SackgassenLage { titel: string; hinweis?: string; wiederholbar: boolean; gesperrt: boolean }`;
  `export function sackgasseBeiFehler(error: unknown): SackgassenLage`;
  `SeitenSackgasse` neue optionale Prop `neutral?: boolean` (keine `alarm`-Kante).

- [ ] **Step 1: Failing tests** `sackgasse.test.ts` — je Fall `expect(sackgasseBeiFehler(e)).toEqual(...)`:
  - 403 `kein_mitglied` und 403 ohne `grund` → `{ titel: 'Kein Zugriff auf diesen Einsatz', hinweis: 'Zugriff vergibt die Einsatzleitung dieses Einsatzes.', wiederholbar: false, gesperrt: true }`
  - 403 `nachlauf_abgelaufen` → `{ titel: 'Einsatz nicht mehr einsehbar', hinweis: 'Die Lesefrist nach Abschluss ist abgelaufen. Einsehen kann ihn nur noch die Einsatzleitung.', wiederholbar: false, gesperrt: true }`
  - 403 `nicht_mehr_lesbar` → `{ titel: 'Einsatz nicht mehr einsehbar', hinweis: 'Die Aufbewahrungsfrist ist abgelaufen.', wiederholbar: false, gesperrt: true }`
  - 404 → `{ titel: 'Einsatz nicht gefunden', wiederholbar: false, gesperrt: true }`
  - 500 `ApiError` → `{ titel: 'Einsatz konnte nicht geladen werden', hinweis: <message>, wiederholbar: true, gesperrt: false }`
  - `new TypeError('Failed to fetch')` → `{ titel: 'Einsatz konnte nicht geladen werden', wiederholbar: true, gesperrt: false }` (kein `hinweis`)
  `ApiError` wie in bestehenden Tests bauen: `new ApiError(403, 'Keine Berechtigung', { grund: 'kein_mitglied' })`.
- [ ] **Step 2: Fail prüfen** — `mise exec -- pnpm -C frontend vitest run src/einsatz/sackgasse.test.ts` → FAIL (Modul fehlt).
- [ ] **Step 3: Implementieren** `sackgasse.ts` und Konstanten in `client.ts`. Die Texte stehen als Konstanten in `sackgasse.ts`.
- [ ] **Step 4: `SeitenSackgasse`** — Test in `SeitenZustand.test.tsx`: ohne `onWiederholen` ist der Rückweg-Knopf `type="primary"` (Klasse `ant-btn-primary`); mit `neutral` keine `alarm`-Kante (`boxShadow` fehlt). Implementieren: Rückweg primär, wenn kein `onWiederholen`; `boxShadow` nur ohne `neutral`.
- [ ] **Step 5: `EinsatzLayout`** — Test in `EinsatzLayout.test.tsx` (bestehende 403-/Fehler-Fälle anpassen): bei 403 mit `grund: 'kein_mitglied'` stehen „Kein Zugriff auf diesen Einsatz“ und „Zugriff vergibt die Einsatzleitung dieses Einsatzes.“, kein Knopf „Erneut abrufen“, Knopf „Zur Einsatzliste“ da; bei 500 bleibt „Erneut abrufen“. Implementieren: `const lage = sackgasseBeiFehler(einsatzQuery.error)`; `titel={lage.titel} hinweis={lage.hinweis} neutral={lage.gesperrt} onWiederholen={lage.wiederholbar ? () => void einsatzQuery.refetch() : undefined}`; `ursache` nur noch, wenn kein `hinweis` (sonst doppelt).
- [ ] **Step 6: Grün prüfen** — `mise exec -- pnpm -C frontend vitest run src/einsatz src/components/SeitenZustand.test.tsx` → PASS.
- [ ] **Step 7: Commit** — `feat(einsatz): Direktlink ohne Recht nennt den Weg statt „Erneut abrufen“ (LLH-1819)`.

### Task 4: Gesperrtes Modul nennt die Einsatzleitung

**Files:**
- Modify: `frontend/src/einsatz/ModulGesperrt.tsx`, Test `ModulGesperrt.test.tsx`
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx` (`GesperrtesModul`, ab Zeile ~873)

**Interfaces:**
- Consumes: `ladeMitglieder` (`api/einsaetze.ts`), `einsatzKeys.mitglieder(einsatzId)`.
- Produces: `ModulGesperrt` Prop `einsatzleitung?: string[]` (Anzeigenamen; `undefined` = unbekannt).

- [ ] **Step 1: Failing tests** in `ModulGesperrt.test.tsx`:
  - `einsatzleitung={['Anna Muster', 'Ben Beispiel']}` → Text „Freigabe erteilt die Einsatzleitung: Anna Muster, Ben Beispiel“.
  - `einsatzleitung={[]}` und ohne Prop → „Freigabe erteilt die Einsatzleitung.“ (kein Doppelpunkt).
  - mit `freigabenPfad` → weder „Freigabe erteilt“ noch Namen, Knopf „Modulfreigaben öffnen“ da.
  - `ausgeblendet` mit Namen → Zeile steht ebenfalls (die Einsatzleitung blendet ein).
- [ ] **Step 2: Fail prüfen** — `mise exec -- pnpm -C frontend vitest run src/einsatz/ModulGesperrt.test.tsx` → FAIL.
- [ ] **Step 3: Implementieren** — zweite `<p>` unter der Sperrzeile, gleiche Typo, nur ohne `freigabenPfad`.
- [ ] **Step 4: `GesperrtesModul`** — zweite `useQuery` mit `queryKey: einsatzKeys.mitglieder(einsatzId)`, `queryFn: () => ladeMitglieder(einsatzId)`, `enabled: !darfFreigabenVerwalten`; `einsatzleitung = data?.filter((m) => m.einsatz_rolle === 'einsatzleitung').map((m) => m.anzeigename)`; Fehler/Laden → `undefined` (deckt auch ein gekoppeltes Gerät ab, das `…/mitglieder` nicht erreicht; Geräte nutzen ohnehin die eigene Hülle unter `geraet/`). Test in `EinsatzLayout.test.tsx`: gesperrtes Modul mit gemocktem `ladeMitglieder` zeigt den Namen der Einsatzleitung, nicht den eines Führungspersonals.
- [ ] **Step 5: Grün prüfen** — `mise exec -- pnpm -C frontend vitest run src/einsatz src/api/queryKeys.guard.test.ts` → PASS.
- [ ] **Step 6: Commit** — `feat(einsatz): gesperrtes Modul nennt die Einsatzleitung (LLH-1819)`.

### Task 5: Leere Einsatzliste mit Hinweis

**Files:**
- Modify: `frontend/src/pages/EinsaetzePage.tsx:539`, Test `EinsaetzePage.test.tsx`

- [ ] **Step 1: Failing test** — leere Liste zeigt „Keine Einsätze“ und „Zu einem Einsatz nimmt dich dessen Einsatzleitung auf.“; Suche ohne Treffer zeigt den Hinweis nicht.
- [ ] **Step 2: Fail prüfen** — `mise exec -- pnpm -C frontend vitest run src/pages/EinsaetzePage.test.tsx` → FAIL.
- [ ] **Step 3: Implementieren** — `hinweis` an `SeitenLeer`, Text als Konstante in der Datei.
- [ ] **Step 4: Grün prüfen** — gleicher Befehl → PASS.
- [ ] **Step 5: Commit** — `feat(einsaetze): leere Liste sagt, wer aufnimmt (LLH-1819)`.

### Task 6: Regeln, Doku, Gates

**Files:**
- Modify: `src/AGENTS.md` (Statuscode-Konvention: 403 der Lesesperre trägt `grund`, Werte und Reihenfolge, Verweis `LeseSperre`)
- Modify: Anwenderdoku-Kapitel, die die drei Zustände zeigen (`grep -rn "Keine Berechtigung\|nicht freigegeben\|Keine Einsätze\|Erneut abrufen" docs/anwender`), nach `docs/anwender/AGENTS.md`
- Modify: arc42, falls der 403-Umschlag dort beschrieben ist (`grep -rn "nicht_in_liste\|grund" docs/architektur`), nach `docs/architektur/AGENTS.md`

- [ ] **Step 1:** Regelzeile in `src/AGENTS.md` ergänzen; Doku-Kapitel anpassen (Bildlauf laut `docs/anwender/AGENTS.md`, wenn Bilder betroffen sind).
- [ ] **Step 2: Gates** — `./scripts/check-all.sh --geaendert --ohne-e2e` → alle Schritte grün (ohne `| tail`).
- [ ] **Step 3: Bilder** — Screenshots der drei Stellen (vorher/nachher) für PR und Meldung (`dev-zunder-ausfuehren`, „Bilder der Änderung“).
- [ ] **Step 4: Plan abhaken, Commit** — `docs: Lesesperre mit Grund in Regeln und Anwenderdoku (LLH-1819)`.
