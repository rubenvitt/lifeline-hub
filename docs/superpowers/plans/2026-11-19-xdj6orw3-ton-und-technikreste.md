# Ton und Technikreste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unpersönliche Anrede in der App, keine serde-Texte in Fehlermeldungen, kein
Layoutsprung beim Erstaufruf von Meldebild, ETB und Betroffene.

**Architecture:** Drei unabhängige Teile in einem Branch. (1) Textänderungen und eine Regel in
`frontend/AGENTS.md`. (2) `rejection_zu_app_error` in `src/extract.rs` gibt für 400 einen
festen Text zurück und loggt die Einzelheiten. (3) Die Frühausstiege der drei Seiten geben
`ModulGerippeSeite` mit einem Gerippe in Zielhöhe zurück, belegt durch einen e2e-Test mit
verzögerter Einsatz-Antwort.

**Tech Stack:** Rust/axum, React/antd, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-xdj6orw3-ton-und-technikreste-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/xdj6orw3n3wzx7b7rb543ihi

## Global Constraints

- UI-Texte sprechen niemanden an: kein du/dein/dich/dir, kein Sie/Ihr/Ihnen.
- Neuer JSON-Fehlertext, wörtlich: `Die Eingabe hat ein unerwartetes Format und wurde nicht
  gespeichert. Seite neu laden; tritt es wieder auf, bitte über Rückmeldung melden.`
- `Anfrage ist zu groß.` (413) bleibt unverändert. Der Statuscode für Formatfehler bleibt 400.
- CLS-Grenze < 0,1, gemessen ohne anstehenden Alarm.
- Prosa deutsch, neue Bezeichner nach `AGENTS.md`, „Bezeichner-Sprache“.

## Review Focus

- Ein Erstaufruf mit langsamer Einsatz-Antwort: Der Titel steht im ersten Bild am Endplatz
  (Task 3/4, e2e).
- Ein Einsatz, den es nicht gibt (404): Der Fehlerzustand erscheint weiterhin, nicht ein
  ewiges Gerippe (Task 4, Unit-Test je Seite bleibt grün).
- Ein falsch getyptes JSON an eine interne Route: Im `error` steht kein „deserialize“ und kein
  Feldpfad (Task 2).
- Ein ETB ohne ungesichtete Einträge: Die reservierte Lesemarke-Zeile verschwindet, ohne dass
  die Messung reißt (Task 4, e2e).
- Schmale Breite (unter `xl`) in Betroffene: Die Sichtungszeile springt nicht (Task 4, e2e mit
  zweitem Viewport).

---

### Task 1: Anrede-Regel und Texte

**Files:**
- Modify: `frontend/AGENTS.md` (neuer Punkt bei der Bedien-Leitlinie/UI-Texte)
- Modify: `frontend/src/etb/lesemarkeModell.ts:20-35`
- Modify: `frontend/src/aufbewahrung/FristPaneel.tsx:203`
- Modify: `frontend/src/etb/RufnameAbfrage.tsx:121`
- Modify: `frontend/src/instanz/fuehrungText.ts:37`
- Modify: `frontend/src/neuigkeiten/NeuigkeitenPage.tsx:71`
- Modify: `frontend/src/pages/ProfilPage.tsx:234,387`
- Modify: `frontend/src/pages/LoginPage.tsx:395,540`
- Modify: `frontend/src/pages/AppAnmeldungPage.tsx:85`
- Modify: `frontend/src/pages/EinsaetzePage.tsx:475`
- Modify: `frontend/src/einsatz/ModulGesperrt.tsx:67`
- Modify: `frontend/src/geraet/KoppelnPage.tsx:63`
- Modify: `frontend/src/command-palette/befehle.ts:128` („Betroffene erfassen“, „Person erfassen“ in die `schlagworte`)
- Modify: `frontend/src/kraefte/Statusband.tsx:162` (Zähler `zaehler(personal, 'Person', 'Personen')`)
- Modify: `frontend/src/stammdaten/PersonalDetailPage.tsx:114`, `FahrzeugDetailPage.tsx:126`, `EinheitVorlageDetailPage.tsx:225` → `Nicht gefunden: entfernt oder nicht in dieser Organisation.`
- Modify: `frontend/src/karten/OnlineQuelleFormModal.tsx:178` → `Über den Server abrufen`
- Modify: die Tests und e2e-Specs, die die alten Texte finden (per grep)
- Modify: `docs/anwender/kapitel/einsatz-oberflaeche.md`, `instanzkopplung.md`,
  `geraet-bedienen.md`, `rueckmeldung.md` (Zitate), `docs/anwender/AGENTS.md:53` (Verweis auf
  die Regel)
- Create: `frontend/src/anredeText.guard.test.ts`

**Interfaces:** keine.

- [x] **Step 1: Wächtertest schreiben**: `anredeText.guard.test.ts` liest per `import.meta.glob`
  (`?raw`) alle `.ts/.tsx` unter `src/` außer Tests und `api/types.generated.ts`. Er entfernt
  Kommentare (`//…`, `/* … */`) und prüft, dass in Zeichenketten- und JSX-Text kein Treffer auf
  `/\b(du|dein\w*|dich|dir|Sie|Ihr(e[nmrs]?)?|Ihnen)\b/` steht. Eine Ausnahmeliste gibt es nur
  für ein „Sie“ am Satzanfang, das sich auf eine Sache bezieht (die zwei Stellen in
  `ExterneStellenTab.tsx`, `AnbindungWebhook.tsx:424`), je mit Begründung.
- [x] **Step 2: Test rot sehen**: `mise exec -- pnpm -C frontend exec vitest run src/anredeText.guard.test.ts`. Erwartet: FAIL mit der Liste der Stellen aus der Tabelle des Design-Docs.
- [x] **Step 3: Texte ändern** nach der Tabelle des Design-Docs und den Begriffen oben.
  lesemarkeModell: `1 noch nicht gesichteter Eintrag` / `${n} noch nicht gesichtete Einträge`,
  `${menge} seit der letzten Sichtung ${wann}`.
- [x] **Step 4: Regel eintragen** in `frontend/AGENTS.md` (Text aus dem Design-Doc, Teil 1,
  „Regel“, mit Verweis auf den Wächter). In `docs/anwender/AGENTS.md:53` auf diese Regel
  verweisen.
- [x] **Step 5: Tests grün**: Wächter plus die betroffenen Unit-Tests (`vitest run` auf die
  geänderten Dateien), dazu `grep -rn` auf die alten Texte in `frontend/e2e` und den Docs. Alle
  Treffer sind nachgezogen.
- [x] **Step 6: Commit** `feat: unpersönliche Anrede und einheitliche Begriffe (LLH-1830)`

### Task 2: Neutrale JSON-Ablehnung

**Files:**
- Modify: `src/extract.rs:183-215` (`rejection_zu_app_error`)
- Test: `tests/fehler_vertrag.rs`

**Interfaces:**
- Produces: `pub const EINGABE_FORMAT_TEXT: &str` in `src/extract.rs` (der Text aus Global
  Constraints)

- [x] **Step 1: Test schreiben**: In `falscher_feldtyp_liefert_400_im_fehler_envelope` und
  `kaputtes_json_liefert_400_im_fehler_envelope` jeweils
  `assert_eq!(json["error"], EINGABE_FORMAT_TEXT)` und
  `assert!(!json["error"].as_str().unwrap().contains("deserialize"))`. Dasselbe für
  `fehlender_content_type_liefert_fehler_envelope`.
- [x] **Step 2: Rot sehen**: `cargo test --test fehler_vertrag`. Erwartet: FAIL, weil der Text
  abweicht.
- [x] **Step 3: Umbauen**: Alle vier 400-Arme geben `AppError::Validation(EINGABE_FORMAT_TEXT.into())`
  zurück, vorher `tracing::warn!(art = "<Variante>", detail = %rejection, "JSON-Body abgelehnt")`.
  Der 413-Arm und der `Internal`-Arm bleiben. Den Doc-Kommentar anpassen. `PfadParam` und
  Query-Extraktor prüfen: Bleibt deren Text deutsch und ohne serde-Inhalt, keine Änderung, sonst
  gleich behandeln.
- [x] **Step 4: Grün**: `cargo test --test fehler_vertrag --test client_fehler --test body_limit`.
- [x] **Step 5: Commit** `fix: JSON-Ablehnung ohne serde-Text (LLH-1830)`

### Task 3: e2e-Messung für den Erstaufruf (rot)

**Files:**
- Create: `frontend/e2e/erstaufruf-cls.spec.ts`

**Interfaces:**
- Consumes: `beobachteShifts`, `ruheShifts`, `bericht` aus `e2e/cls-kern.ts`;
  `anmeldenAlsAdmin` aus `e2e/rollen-kern.ts`.

- [x] **Step 1: Spec schreiben**:
  - Einsatz per API anlegen. Dazu Daten säen, damit die Inhalte Höhe haben: 3 ETB-Einträge,
    2 Betroffene und eine Einheit samt Personal, über die vorhandenen API-Routen, wie es andere
    Specs tun.
  - `page.route('**/api/einsaetze/<id>', …)` verzögert die Einsatz-Antwort um 800 ms, ebenso die
    Listenabfragen der Seite.
  - Für `kraefteuebersicht`, `etb` und `personen` je `page.goto` und Messung wie in
    `rahmen-cls-dichte.spec.ts` `measure`.
  - `expect.soft(m.summe).toBeLessThan(0.1)`.
  - Zweiter Test bei 1024×768 nur für `personen`.
- [x] **Step 2: Rot sehen**: `cargo build`, dann im Ordner `frontend/` `mise exec -- pnpm exec playwright test e2e/erstaufruf-cls.spec.ts --trace off`. Erwartet: FAIL. Den Bericht der Quellen ins Ledger übernehmen, er zeigt, was springt.
- [x] **Step 3: Commit** (rot ist erlaubt, nur lokal; zusammen mit Task 4 pushen) `test: CLS beim Erstaufruf messen (LLH-1830)`

### Task 4: Kopf sofort und Gerippe in Zielgröße

**Files:**
- Modify: `frontend/src/einsatz/ModulWechselGerippe.tsx` (`ModulGerippeSeite`)
- Modify: `frontend/src/components/SeitenZustand.tsx` (Zielhöhe)
- Modify: `frontend/src/pages/KraefteuebersichtPage.tsx:1303`, `EtbPage.tsx:804`, `PersonenPage.tsx:891,1075,1026/1275`
- Modify: `frontend/src/etb/EtbLesemarkeBanner.tsx` bzw. dessen Platz in `EtbPage.tsx:1248`
- Modify: `frontend/AGENTS.md:174-181` (Regel „Modulwechsel …“ um den Erstaufruf erweitern)
- Test: `frontend/src/einsatz/ModulWechselGerippe.test.tsx` (vorhanden oder neu), die Seiten-Tests

**Interfaces:**
- Produces: `ModulGerippeSeite({ modulKey, verzoegert = true }: { modulKey: string; verzoegert?: boolean })`.
  Unter dem Kopf steht `<SeitenSkeleton verzoegert={verzoegert} zielhoehe />`.
- Produces: `SeitenSkeleton({ zeilen = 3, verzoegert, zielhoehe }: { …; zielhoehe?: boolean })`.
  `zielhoehe` setzt `min-height: calc(100dvh - var(--lfh-kopf-oben) - <Seitenkopfhöhe>)` über
  eine CSS-Klasse mit Luft-Token. Der Wert kommt aus dem gemessenen Kopf, nicht als Zahl im TSX.

- [x] **Step 1: Unit-Test**: Die drei Seiten zeigen bei ladendem Einsatz `data-testid="modul-gerippe"`
  mit `h1` = Modulname (`Meldebild`/`ETB`/`Betroffene`, wie `modulName`).
- [x] **Step 2: Rot sehen** (vitest auf die drei Seiten-Tests).
- [x] **Step 3: Umsetzen**:
  - Frühausstiege geben `<ModulGerippeSeite modulKey="kraefteuebersicht|etb|personen" />`
    zurück.
  - Die inneren Ladezustände bekommen `zielhoehe`: `EtbZeitachse` ladend und die Karten- und
    Kachelansicht in Betroffene. Bei `Datensicht ladend` reicht eine Mindesthöhe am Container,
    falls die Messung es verlangt.
  - Betroffene bekommt `metaPlatzhalter` wie das ETB (`EtbPage.tsx:1132-1140`).
  - Die Lesemarke-Zeile im ETB wird reserviert, solange die Abfrage lädt.
  - Die Sichtungszeile in Betroffene steht ab dem ersten Bild.
- [x] **Step 4: Grün**: vitest auf die geänderten Dateien, dann die e2e-Specs aus Task 3 sowie
  `rahmen-cls-dichte`, `betroffene-layout`, `modulwechsel*` (vorhandene Gerippe-Specs per
  `ls e2e | grep -i gerippe`).
- [x] **Step 5: Regel**: `frontend/AGENTS.md` nach Design-Doc Teil 3, Punkt 4. Zunder-Nachzug
  für die übrigen Modulseiten mit nacktem Frühausstieg (Skill `zunder-task-anlegen`).
- [x] **Step 6: Commit** `fix: Seitenkopf und Gerippe in Zielgröße beim Erstaufruf (LLH-1830)`

### Task 5: Abschluss

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` als ein Aufruf. Erwartet: grün.
- [ ] **Step 2:** Review nach Ermessen am Diff entscheiden. Der Vermerk kommt in den PR.
- [ ] **Step 3:** Bilder: ETB-Lesemarke-Text, Einsatzkachel „Eigene Rolle“ und das Gerippe mit
  Kopf beim Erstaufruf (verzögerte Route), aufgenommen per Wegwerf-Spec.
- [ ] **Step 4:** Push, PR gegen `alpha`, Zunder `review` mit `pr_url`.
