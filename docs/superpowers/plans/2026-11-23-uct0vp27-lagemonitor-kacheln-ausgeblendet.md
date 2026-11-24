# Lagemonitor: Kacheln lassen ausgeblendete Module weg — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der gekoppelte Lagemonitor lässt Kacheln weg, deren Modul im Einsatz ausgeblendet ist,
und der Server liest deren Werte nicht.

**Architecture:** `verdichte` bekommt eine Variante mit der Menge ausgeblendeter Module; nur der
Handler `lagebild` übergibt eine nicht leere Menge und nennt die fehlenden Kacheln im neuen Feld
`ausgeblendet`. Der Client rendert danach.

**Tech Stack:** Rust/axum/sqlx (SQLite), utoipa-Typ-Codegen, React/TypeScript, Vitest + MSW.

**Spec:** `docs/superpowers/specs/2026-11-23-uct0vp27-lagemonitor-kacheln-ausgeblendet-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/uct0vp27hghnxr9b2pixf9s1

## Global Constraints

- Zuordnung: `betroffene` ← `personen`; `meldungen` ← `meldungen`; `kraefte` ← `personal` ODER
  `einheiten`; `uhs` ← `unfallhilfsstellen`. Ablauf nie.
- Wirksame Sichtbarkeit über `crate::einsatz::berechtigung::load_ausgeblendete_module`, keine
  Rollenschranke.
- Lagebild für Externe und API v1 unverändert (gleiche Zahlen, kein neues Feld in ihrer Antwort).
- Wire: Feld `ausgeblendet` an `LagemonitorAnzeige`, Enum `LagemonitorKachel` snake_case
  (`betroffene`, `meldungen`, `kraefte`, `uhs`), feste Folge, leer nicht serialisiert.
- Kachel fehlt ganz: kein „—“, keine 0, kein Hinweis.
- Prosa, Kommentare, Testnamen deutsch; Bezeichner nach `AGENTS.md`, „Bezeichner-Sprache“.

## Review Focus

1. Nur `einheiten` ausgeblendet, `personal` sichtbar → Kräfte fehlt trotzdem (Regel wie
   `kraefteZustand`) — Test in Task 1 und Task 2.
2. Älterer Server ohne Feld `ausgeblendet` → Monitor unverändert — bestehende Tests (Fixture ohne
   Feld) decken es; in Task 2 nicht anfassen.
3. Alle Kacheln der rechten Spalte fehlen → linke Spalte volle Breite, keine leere Spalte — Test in
   Task 2.
4. `meldungen` ausgeblendet und kein anstehender Programmpunkt → untere Zeile entfällt, Karte
   wächst — Test in Task 2.
5. Externe/API v1 zählen bei ausgeblendetem Modul weiter — Test in Task 1.

---

### Task 1: Server — Kacheln ausgeblendeter Module nicht lesen

**Files:**
- Modify: `src/routes/lagemonitor.rs` (`LagemonitorAnzeige`, neues `LagemonitorKachel`,
  `verdichte`, `lagebild`, `alarm`)
- Modify: generierte Typen per `scripts/check-typ-codegen.sh` (beide Dateien mitcommitten)
- Test: `tests/geraet_kopplung.rs`, `tests/public_api_lage.rs`

**Interfaces:**
- Produces: `pub enum LagemonitorKachel { Betroffene, Meldungen, Kraefte, Uhs }` (Serialize,
  ToSchema, snake_case) mit `fn is_ausgeblendet(self, aus: &HashSet<&'static str>) -> bool` und
  `const ALL`; Feld `LagemonitorAnzeige.ausgeblendet: Vec<LagemonitorKachel>`
  (`skip_serializing_if = "Vec::is_empty"`); `pub async fn verdichte_ohne(pool, einsatz_id,
  aus: &HashSet<&'static str>) -> Result<LagemonitorAnzeige, AppError>`; `verdichte` ruft sie mit
  leerer Menge. `alarm` nimmt die Menge statt `org_id` und lädt sie nicht mehr selbst.
- TS-Typ danach: `LagemonitorAnzeige.ausgeblendet?: LagemonitorKachel[]`.

- [x] **Step 1: Failing test** `lagemonitor_kacheln_lassen_ausgeblendete_module_weg` in
  `tests/geraet_kopplung.rs` (Helfer `modul_ausblenden` von LLH-1964 nutzen): vermisste Person,
  offene Sofortmeldung, Einheit, eine UHS anlegen; ohne Ausblendung fehlt `ausgeblendet` im JSON
  (`v.get("ausgeblendet").is_none()`). Dann `personen`, `meldungen`, `unfallhilfsstellen`,
  `einheiten` ausblenden → `v["ausgeblendet"] == json!(["betroffene","meldungen","kraefte","uhs"])`,
  `v["betroffene"]["vermisst"] == 0`, `v["sofortmeldungen_offen"] == 0`,
  `v["kraefte"]["einheiten"] == 0`, `v["uhs"] == json!([])`.
- [x] **Step 2: Failing test** `lagemonitor_kraefte_fehlt_schon_wenn_nur_einheiten_ausgeblendet`:
  nur `einheiten` aus → `v["ausgeblendet"] == json!(["kraefte"])`.
- [x] **Step 3:** Bestehenden Test `lagemonitor_alarm_nennt_ausgeblendete_quellen` anpassen: letzte
  Zeile erwartet jetzt `v["sofortmeldungen_offen"] == 0` und `v["ausgeblendet"]` enthält
  `"betroffene"`, `"meldungen"`, `"kraefte"` (Kommentar: Kachel fehlt seit LLH-2072).
- [x] **Step 4: Failing test** in `tests/public_api_lage.rs`
  `lage_zaehlt_weiter_wenn_meldungen_im_einsatz_ausgeblendet`: Sofortmeldung anlegen, `meldungen`
  per `PUT /api/einsaetze/{id}/modul-overrides/meldungen` `{"sichtbar":false,"benoetigte_rolle":null}`
  ausblenden → `e["sofortmeldungen_offen"] == 1`, `e.get("ausgeblendet").is_none()`.
- [x] **Step 5: Tests laufen lassen, rot**
  Run: `cargo test --test geraet_kopplung lagemonitor_ && cargo test --test public_api_lage lage_zaehlt_weiter`
  Expected: neue Tests FAIL (Step 4 darf schon grün sein; er hält den Vertrag fest).
- [x] **Step 6: Umsetzen** in `src/routes/lagemonitor.rs`: `LagemonitorKachel` neben
  `AlarmQuelle`; `verdichte_ohne` überspringt je ausgeblendeter Kachel ihre Abfragen
  (`betroffene`: Personenzeilen, Sanitätsdienst-Wahl, Vermisste → Standardwerte, `sanitaetsdienst`
  `None`; `kraefte`: Einheiten- und Personal-Abfrage → 0 und leere Stärke; `uhs`: UHS-Abfrage →
  leer; `meldungen`: `meldung::repo::zaehlen` → 0). `lagebild` lädt die Menge einmal, ruft
  `verdichte_ohne` und `alarm` damit und setzt `anzeige.sofortmeldungen_offen = alarm.sofort_offen`
  ohne die Sonderregel von LLH-1964. Doc-Kommentare verweisen auf `frontend/src/geraet/AGENTS.md`,
  Lagemonitor.
- [x] **Step 7: Tests grün**
  Run: `cargo test --test geraet_kopplung lagemonitor_ && cargo test --test public_api_lage && cargo test --test lagebild_extern && cargo test --lib lagemonitor`
  Expected: PASS
- [x] **Step 8: Codegen** `scripts/check-typ-codegen.sh` (schreibt neu), dann erneut ohne Diff.
- [x] **Step 9: Commit** `fix: Lagemonitor liest Kacheln ausgeblendeter Module nicht (LLH-2072)`

### Task 2: Client — Kacheln weglassen, Layout nachziehen

**Files:**
- Modify: `frontend/src/geraet/LagemonitorPage.tsx`
- Test: `frontend/src/geraet/LagemonitorPage.test.tsx`

**Interfaces:**
- Consumes: `LagemonitorAnzeige.ausgeblendet?: LagemonitorKachel[]` aus Task 1.

- [x] **Step 1: Failing tests** in neuem `describe('Lagemonitor — ausgeblendete Module (LLH-2072)')`:
  - `rechte Spalte fehlt ganz, die linke nimmt die volle Breite`: `ausgeblendet:
    ['betroffene','kraefte','uhs']` → `queryByRole('region', {name:'Betroffene'|'Kräfte'|'Belegung
    der Unfallhilfsstellen'})` null; `main` hat `gridTemplateColumns` `minmax(0, 1fr)`.
  - `Kräfte fehlt, wenn nur Kräfte genannt ist; Betroffene und Belegung bleiben`.
  - `uhs ausgeblendet: Belegung und „an UHS“ fehlen, Kräfte bleibt`: `queryByText(/an UHS/)` null.
  - `Meldungen ausgeblendet: Ablauf nimmt die Zeile allein` (ein Programmpunkt nach `JETZT`):
    Region „Meldungen“ fehlt, „Ablauf“ da.
  - `Meldungen ausgeblendet ohne Programmpunkt: keine untere Zeile`: weder „Meldungen“ noch „Ablauf“.
- [x] **Step 2: rot**
  Run: `mise exec -- pnpm -C frontend exec vitest run src/geraet/LagemonitorPage.test.tsx`
  Expected: neue Tests FAIL
- [x] **Step 3: Umsetzen**: Menge `new Set(lage?.ausgeblendet ?? [])` einmal in der Seite;
  `Kacheln` bekommt sie und lässt je Kachel ihre `KachelGrenze` weg, den Zusatz „an UHS“ bei `uhs`;
  `MeldungenKachel` nur ohne `meldungen`, die Zeile nur, wenn eine der beiden steht; ohne Kachel
  der rechten Spalte (und mit geladenem Lagebild) `gridTemplateColumns: 'minmax(0, 1fr)'` und keine
  rechte Spalte. Kommentar verweist auf `geraet/AGENTS.md`, Lagemonitor.
- [x] **Step 4: grün** — Kommando wie Step 2, Expected PASS (alle Tests der Datei).
- [x] **Step 5: Commit** `fix: Lagemonitor lässt Kacheln ausgeblendeter Module weg (LLH-2072)`

### Task 3: Regel und Anwenderdoku

**Files:**
- Modify: `frontend/src/geraet/AGENTS.md` (Absatz Lagemonitor, nach der Alarmzeilen-Regel)
- Modify: `docs/anwender/kapitel/lagemonitor.md` (Abschnitt „Was der Monitor zeigt und was nicht“)

- [x] **Step 1:** AGENTS-Regel: Kacheln fehlen bei ausgeblendetem Modul (Zuordnung wie oben, Kräfte
  wie `kraefteZustand`, Ablauf nie); der Server liest sie nicht, nennt sie in `ausgeblendet`, nur
  `lagebild`, nicht `verdichte` für Externe/API v1 (LLH-2072). Den Satz über die Kachel
  „Sofortmeldungen“ aus LLH-1964 streichen, falls vorhanden.
- [x] **Step 2:** Anwenderdoku: „die Kacheln „Meldungen“ und „Betroffene“ zählen dagegen weiter“
  ersetzen durch: auch die Kachel des Moduls fehlt (Betroffene bzw. Hilfeleistungen, Meldungen,
  Kräfte, Belegung samt Marken auf der Karte), die übrigen Kacheln nehmen den Platz; „Ablauf“ bleibt.
- [x] **Step 3:** Prettier/Doku-Wächter: `mise exec -- pnpm -C frontend exec prettier --check AGENTS.md src/geraet/AGENTS.md` und `./scripts/check-all.sh --geaendert --ohne-e2e` (Task 4) decken den Rest.
- [x] **Step 4: Commit** `docs: Regel und Anwenderdoku – Monitorkacheln ausgeblendeter Module (LLH-2072)`

### Task 4: Gates

- [x] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` (ein Aufruf), Expected: grün.
- [x] **Step 2:** Plan abhaken, Commit `docs: Plan LLH-2072 abgehakt`.

## Ergebnis (23.11.2026)

- Task 4, Gate: Das Plattenkontingent der Cloud-Sitzung fasst nicht alle Rust-Testbinaries
  zugleich. Gefahren: `check-all.sh --nur schnell` und `--nur frontend` grün (Vitest 1430 Dateien,
  22 920 Tests); Rust-Suite in Portionen (`cargo test` für lib, bins, übrige Workspace-Crates, je
  40 Testdateien, doc) grün, 9 041 Tests. Nicht gefahren: Dev-Seed-Schritt und Server-Binary aus
  `--nur rust` (vom Diff nicht berührt).
- Review (Anlass: was der Monitor sieht, Server und Client mit neuer Schnittstelle): Befund
  „Anstieg nach Wiedereinblenden“ behoben (Test „wieder eingeblendet (LLH-2072)“), neue Lader
  englisch benannt (`load_anzeige`, `load_*`; `verdichte` bleibt), Anwenderdoku zur Kartenkachel
  ergänzt. Zurückgestellt: eigener Test für das Lagebild für Externe, kurzes Aufblitzen der
  Meldungskachel beim ersten Laden.
