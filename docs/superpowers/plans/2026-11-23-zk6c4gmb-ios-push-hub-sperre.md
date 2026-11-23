# iOS-Push: ELW zeigt Relais-Sperre des Hubs – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein am Push-Relais gesperrter Hub meldet die Sperre dem gekoppelten ELW, und der ELW zeigt
sie der Einsatzleitung im Einsatz und an der Kopplung.

**Architecture:** Ein additives Feld in `MeldenAntwort` trägt `gesperrt_at` des Hubs. Der ELW
speichert es an `instanz_kopplung`. Eine korrelierte Spalte (Makro, in `laden` und `liste_fuer`
wortgleich) liefert je Einsatz die gesperrten Hubs. Im Frontend zeigt ein Band unter dem
Führungsband den Zustand, auf der Seite „Instanzkopplung“ eine Hinweiszeile.

**Tech Stack:** Rust (axum, sqlx/SQLite), React + antd, vitest.

**Spec:** `docs/superpowers/specs/2026-11-23-zk6c4gmb-ios-push-hub-sperre-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/zk6c4gmbvmsg8eggqh2xkutb

## Global Constraints

- Kopplungsprotokoll additiv: `#[serde(default)]`, ein älterer Hub heißt „nicht gesperrt“.
- Neue Felder in bestehenden Typen deutsch (`ios_push_gesperrt_seit`,
  `gegenueber_ios_push_gesperrt_seit`, `ios_push_hub_gesperrt`); der neue Typ
  `IosPushHubSperre` hat englische Wire-Felder `hub_name`, `since`.
- Migration anhängen: `migrations/0369_ios_push_hub_sperre.sql` (größer als jede auf `alpha`;
  vor dem PR `scripts/check-migrationen.sh`).
- Band: `warning`, nicht rot; sichtbar nur bei `darfFuehrungBedienen(einsatz, benutzer)`.
- Nach DTO-Änderungen `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten.
- Prosa, Kommentare, Testnamen deutsch.

## Review Focus

1. Hub ohne `--ios-push`, aber mit alter Zeile in `ios_push_relais` → meldet keine Sperre (Task 1).
2. Sperre fällt am Hub → ELW löscht den Wert bei der nächsten Meldung, Band verschwindet (Task 1, 2).
3. Hub hat `gegenueber_ios_push = 0` (bietet iOS-Push nicht an) → keine Anzeige, obwohl eine
   Sperrzeit gespeichert ist (Task 2).
4. Widerrufene Org-Zuordnung, nicht aktive Kopplung, Demo-Einsatz, abzuräumender Einsatz →
   kein Eintrag (Task 2).
5. Der Spiegel am Hub (erreichte Seite) zeigt nichts (Task 2, Integrationstest).

---

### Task 1: Sperre reist im Abgleich und wird am ELW gespeichert

**Files:**
- Create: `migrations/0369_ios_push_hub_sperre.sql`
- Modify: `src/instanz/melden.rs` (`MeldenAntwort`, `handle_meldung`, Aufruf von `save_faehigkeiten` ~Z. 908)
- Modify: `src/instanz/repo.rs` (`KopplungZeile`, `KOPPLUNG_SPALTEN`, `save_faehigkeiten`)
- Modify: `src/routes/instanz.rs` (`melden`)
- Modify: `src/instanz/spiegel/tests.rs` (4 Aufrufe `save_faehigkeiten`), `tests/instanz_fuehrung.rs:4892` (Aufruf `handle_meldung`)
- Test: `tests/instanz_hinweise.rs`, Unit-Test in `src/instanz/melden.rs`

**Interfaces:**
- Produces: Spalte `instanz_kopplung.gegenueber_ios_push_gesperrt_seit TEXT` (NULL = nicht gesperrt);
  `KopplungZeile.gegenueber_ios_push_gesperrt_seit: Option<String>`;
  `MeldenAntwort.ios_push_gesperrt_seit: Option<String>`;
  `handle_meldung(pool, identitaet, kopplung, anfrage, web_push: bool, ios_push: bool, ios_push_gesperrt_seit: Option<String>)`;
  `save_faehigkeiten(conn, kopplung_id, hinweise, web_push, ios_push, ios_push_gesperrt_seit: Option<&str>, rolle_mitarbeit)`.

- [x] **Step 1: Failing tests**
  - In `melden.rs`, `antwort_eines_aelteren_hubs_nennt_keine_faehigkeiten`: zusätzlich
    `assert_eq!(a.ios_push_gesperrt_seit, None);`
  - In `tests/instanz_hinweise.rs` neuer Test `gesperrter_hub_meldet_seine_sperre_an_den_elw`:
    `hub = seite_mit(false, true)`, `elw = seite(false)`, `schluessel`, `koppeln`, `melden`;
    am Hub `INSERT INTO ios_push_relais (id, server_id, geheimnis, gesperrt_at) VALUES (1, 's', 'g', '2026-11-23 08:15:00')`;
    `melden(&elw.i)` → `SELECT gegenueber_ios_push_gesperrt_seit FROM instanz_kopplung` am ELW
    `== Some("2026-11-23 08:15:00")`; am Hub `UPDATE ios_push_relais SET gesperrt_at = NULL`,
    `melden` → `None`.
  - Neuer Test `hub_ohne_ios_push_meldet_keine_sperre`: `hub = seite(false)`, dieselbe Zeile
    einfügen, `melden` → `None`.
- [x] **Step 2:** `cargo test --test instanz_hinweise sperre` und `cargo test --lib melden::tests::antwort_eines_aelteren` → FAIL (Kompilierfehler/Feld fehlt).
- [x] **Step 3: Implementieren**
  - Migration: `ALTER TABLE instanz_kopplung ADD COLUMN gegenueber_ios_push_gesperrt_seit TEXT;` mit
    Kommentarzeile (LLH-2074).
  - `MeldenAntwort`: Feld mit `#[serde(default, skip_serializing_if = "Option::is_none")]` und
    Doc-Kommentar (Sperre des Relais am Hub, UTC; zählt, solange `gesperrt_at` steht).
  - Route `melden`: `ios_push_gesperrt_seit = match state.live.ios_push() { Some(_) => ios_push::repo::relais_gesperrt_seit(&state.pool).await?, None => None }`.
  - Meldende Seite speichert `a.ios_push_gesperrt_seit.as_deref()` in `save_faehigkeiten`.
  - Bestehende Aufrufe nachziehen (`None`).
- [x] **Step 4:** Tests aus Step 2 → PASS; `cargo test --test instanz_hinweise` und `--test instanz_fuehrung` grün.
- [x] **Step 5: Commit** `feat: Hub meldet iOS-Push-Sperre des Relais an den ELW (LLH-2074)`

### Task 2: Einsatz trägt die gesperrten Hubs, Kopplungsanzeige die Sperre

**Files:**
- Modify: `src/instanz/spiegel/hinweis.rs` (neuer Typ `IosPushHubSperre`; Tests)
- Modify: `src/einsatz/repo.rs` (Makro `ios_push_hub_gesperrt_spalte!`, in `laden` und `LISTE_SELECT`, Feld in `Row`, Struct-Literal ~Z. 793)
- Modify: `src/einsatz/mod.rs` (`Einsatz` und `EinsatzAnzeige`), `src/einsatz/berechtigung.rs:594` (Default)
- Modify: `src/instanz/repo.rs` (`InstanzKopplungAnzeige.gegenueber_ios_push_gesperrt_seit`, `to_anzeige`)
- Modify: `src/api_doc.rs` (Schema `IosPushHubSperre`)
- Generiert: `frontend/src/api/types.generated.ts` und die zweite Codegen-Datei
- Test: `src/instanz/spiegel/hinweis.rs` (tests), `tests/instanz_hinweise.rs`

**Interfaces:**
- Consumes: Spalte aus Task 1.
- Produces: `pub struct IosPushHubSperre { pub hub_name: String, pub since: String }`
  (Serialize, Deserialize, ToSchema, Clone, Debug, PartialEq, Eq);
  `Einsatz.ios_push_hub_gesperrt: sqlx::types::Json<Vec<IosPushHubSperre>>`;
  `EinsatzAnzeige.ios_push_hub_gesperrt: Vec<IosPushHubSperre>` mit
  `#[serde(default, skip_serializing_if = "Vec::is_empty")]`;
  `InstanzKopplungAnzeige.gegenueber_ios_push_gesperrt_seit: Option<String>` (skip wenn None).

- [x] **Step 1: Failing tests**
  - Unit (hinweis.rs tests) `ios_push_sperre_steht_nur_am_gelieferten_einsatz_eines_gesperrten_hubs`:
    `kopplung(&pool, "meldet_sich")`, `einsatz(&pool)`; `UPDATE instanz_kopplung SET gegenueber_ios_push = 1, gegenueber_ios_push_gesperrt_seit = '2026-11-23 08:15:00'`;
    `crate::einsatz::repo::laden(&pool, e).await.unwrap().ios_push_hub_gesperrt.0 == vec![IosPushHubSperre { hub_name: "Hub".into(), since: "2026-11-23 08:15:00".into() }]`.
    Danach je Fall leer: `gegenueber_ios_push = 0`; `gegenueber_ios_push_gesperrt_seit = NULL`;
    `gegenueber_hinweise = 0`; `zustand = 'getrennt'` (oder ein anderer nicht aktiver Wert aus
    dem Schema); `instanz_kopplung_org.widerrufen_at` gesetzt; Einsatz in `demo_import`; Einsatz
    in `einsatz_abraeumen`; Richtung `wird_gemeldet` (jeweils vom gefüllten Zustand aus, nach
    dem Muster der Schleife `for (sql, grund)` im Nachbartest).
  - Integration `gesperrter_hub_zeigt_die_sperre_am_einsatz_und_an_der_kopplung` in
    `tests/instanz_hinweise.rs`: `w = welt_mit((false, true), (false, false))`; Sperrzeile am Hub
    wie in Task 1; `melden(&w.elw.i)`; `GET /api/einsaetze/{w.einsatz}` am ELW →
    `v["ios_push_hub_gesperrt"] == json!([{"hub_name": <Name des Hubs aus der Kopplung>, "since": "2026-11-23 08:15:00"}])`;
    `GET /api/einsaetze` → derselbe Wert am Eintrag `w.einsatz`; `GET /api/admin/instanz` →
    `kopplungen[0]["gegenueber_ios_push_gesperrt_seit"] == "2026-11-23 08:15:00"`; am Hub
    `GET /api/einsaetze/{w.spiegel}` → Feld fehlt. Sperre am Hub aufheben, `melden` → Feld
    fehlt am ELW-Einsatz.
- [x] **Step 2:** `cargo test --lib ios_push_sperre_steht` und `cargo test --test instanz_hinweise zeigt_die_sperre` → FAIL.
- [x] **Step 3: Implementieren**
  - Makro neben `spiegel_spalten!` mit Doc-Kommentar (Menge wie `spiegel::hinweis::ziele`, dazu
    iOS-Push angeboten und gesperrt; wortgleich in `laden` und `liste_fuer`):
    `COALESCE((SELECT json_group_array(json_object('hub_name', ik.gegenueber_name, 'since', ik.gegenueber_ios_push_gesperrt_seit)) FROM instanz_kopplung_org io JOIN instanz_kopplung ik ON ik.id = io.kopplung_id WHERE io.org_id = e.org_id AND io.widerrufen_at IS NULL AND e.spiegel = 0 AND ik.richtung = 'meldet_sich' AND ik.zustand = 'aktiv' AND ik.gegenueber_hinweise = 1 AND ik.gegenueber_ios_push = 1 AND ik.gegenueber_ios_push_gesperrt_seit IS NOT NULL AND NOT EXISTS (SELECT 1 FROM demo_import d WHERE d.einsatz_id = e.id) AND NOT EXISTS (SELECT 1 FROM einsatz_abraeumen m WHERE m.einsatz_id = e.id) ORDER BY io.id), '[]') AS ios_push_hub_gesperrt`
    (Hinweis: `ORDER BY` innerhalb eines Aggregats geht in SQLite erst ab 3.44; sonst ohne
    `ORDER BY` und die Reihenfolge nicht zusichern.)
  - In `ziele()` einen Kommentar ergänzen, dass das Makro dieselbe Menge liest.
  - `to_anzeige` übernimmt `k.gegenueber_ios_push_gesperrt_seit` nur bei `richtung == meldet_sich`.
  - `scripts/check-typ-codegen.sh` laufen lassen, generierte Dateien übernehmen.
- [x] **Step 4:** Tests aus Step 2 → PASS; `cargo test --lib einsatz` grün.
- [x] **Step 5: Commit** `feat: Einsatz und Kopplung zeigen die iOS-Push-Sperre des Hubs (LLH-2074)`

### Task 3: Hinweisband im Einsatz und Zeile an der Kopplung

**Files:**
- Create: `frontend/src/instanz/IosPushHubBand.tsx`, `frontend/src/instanz/IosPushHubBand.test.tsx`
- Modify: `frontend/src/instanz/instanzText.ts` (+ `instanzText.test.ts`)
- Modify: `frontend/src/einsatz/EinsatzLayout.tsx` (unter dem Block des `FuehrungHinweisband`)
- Modify: `frontend/src/instanz/InstanzkopplungSeite.tsx` (Aufruf `kopplungHinweise` mit `zeit`)

**Interfaces:**
- Consumes: `EinsatzAnzeige.ios_push_hub_gesperrt?: IosPushHubSperre[]`,
  `InstanzKopplungAnzeige.gegenueber_ios_push_gesperrt_seit?: string`.
- Produces: `iosPushHubBandTitel(hubName: string): string`,
  `iosPushHubBandText(seit: string): string`,
  `kopplungHinweise(k, datentraegerBestaetigt = true, zeit: (wert: string) => string = (w) => w)`;
  Komponente `IosPushHubBand({ einsatz }: { einsatz: EinsatzAnzeige })`, `data-lfh="ios-push-hub-band"`.

- [x] **Step 1: Failing tests**
  - `instanzText.test.ts`: `iosPushHubBandTitel('Hub Nord')` →
    `'iOS-Push über den Hub „Hub Nord“ wird nicht zugestellt'`;
    `iosPushHubBandText('08:15')` →
    `'Das Push-Relais sperrt den Hub seit 08:15. Alarme erreichen iPhones von Hub-Konten nicht; Web Push und die offene App bleiben. Wichtiges auf anderem Weg absichern und den Betreiber des Hubs informieren.'`;
    `kopplungHinweise(kopplung({ gegenueber_ios_push_gesperrt_seit: 'X' }), true, () => '08:15')`
    enthält `'iOS-Push an Hub-Konten kommt nicht an: das Push-Relais sperrt den Hub (seit 08:15)'`.
  - `IosPushHubBand.test.tsx`: mit einem gesperrten Hub und `meine_rolle: 'einsatzleitung'` →
    Titel und Text sichtbar (Rolle `role="status"` oder Alert); Rolle `fuehrungspersonal` ohne
    Admin → nichts gerendert; Admin der Einsatz-Org ohne Rolle → sichtbar; Admin einer anderen
    Org → nichts; leeres/fehlendes Feld → nichts. Zwei Hubs → zwei Titel.
- [x] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/instanz` → FAIL.
- [x] **Step 3: Implementieren** – Band: je Sperre ein antd `Alert` (`type="warning"`,
  `showIcon`, `banner`), Zeit über `zeitKurz(since, konv)` wie im `FuehrungHinweisband`; Sichtbarkeit über
  `darfFuehrungBedienen(einsatz, benutzer)`. In `EinsatzLayout` direkt unter dem Führungsband
  einhängen, mit Kommentar (LLH-2074). Vorher `frontend/AGENTS.md` nach „Hinweisband“/„banner“
  greppen und die dortigen Regeln befolgen.
- [x] **Step 4:** vitest aus Step 2 → PASS; `mise exec -- pnpm -C frontend exec tsc --noEmit` (bzw. das Typecheck-Skript aus `package.json`) und Lint grün.
- [x] **Step 5: Commit** `feat: Hinweisband zur iOS-Push-Sperre des Hubs am ELW (LLH-2074)`

### Task 4: Doku und Gates

**Files:**
- Modify: `docs/architektur/11-risiken-und-technische-schulden.md` (R54, Spalte Auswirkung/Maßnahme: der gekoppelte ELW zeigt die Sperre; kein Rückfall, LLH-2074)
- Modify: `docs/architektur/06-laufzeitsicht.md` oder `08-querschnittliche-konzepte.md`, wo der Abgleich von `ios_push` beschrieben ist: neues Feld nennen
- Modify (falls Kapitel vorhanden): Anwenderdoku zur Instanzkopplung bzw. zu Benachrichtigungen, ein Satz (Regeln: `docs/anwender/AGENTS.md`)

- [x] **Step 1:** Doku ändern; `docs/architektur/AGENTS.md` (Mitänderungsregel, Prüfungen) beachten.
- [x] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (Ausgabe im PR unter „Geprüft“).
  Abgehakt mit Verweis auf den Lauf: Das Plattenkontingent der Cloud-Sitzung trägt den vollen
  Rust-Testbau (Schritt 4) nicht. Gefahren: `--nur schnell`, `--nur frontend`, `--nur binaer` grün;
  Rust gezielt (Bibliotheksmodule der Änderung, 76 betroffene Integrationstests) grün. Details im PR.
- [x] **Step 3: Commit** `docs: iOS-Push-Sperre des Hubs am ELW (LLH-2074)`
