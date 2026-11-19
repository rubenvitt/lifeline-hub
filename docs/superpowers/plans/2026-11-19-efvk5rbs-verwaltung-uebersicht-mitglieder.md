# Verwaltungs-Übersicht und Mitglieder beim Anlegen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` öffnet eine Übersicht, die den Bestand der Bereitschaft zählt und sagt, was
für einen Einsatz fehlt. Im Dialog „Neuen Einsatz anlegen“ lassen sich Mitglieder wählen, die
atomar mit dem Einsatz aufgenommen werden.

**Architecture:**
- Backend: ein Zähl-Endpunkt `GET /api/verwaltung/bereitschaft` und ein Auswahl-Endpunkt
  `GET /api/einsaetze/mitglied-auswahl`. `POST /api/einsaetze` nimmt optional `mitglieder` an und
  schreibt sie in derselben `write_retry!`-Transaktion wie `anlegen_tx`.
- Frontend: eine reine Wertungsfunktion `admin/bereitschaft.ts`, eine Seite „Übersicht“ als
  Einstieg der Verwaltung und ein eingeklappter Teil „Mitglieder“ im Dialog.

**Tech Stack:** Rust (axum, sqlx/SQLite, utoipa), React 19 + antd, TanStack Query, Vitest,
Playwright.

**Spec:** `docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/efvk5rbs30e82bwhir4hlxjl

## Global Constraints

- Bezeichner: Fachwort deutsch, Technik englisch (Wurzel-`AGENTS.md`, „Bezeichner-Sprache“).
  Kommentare, Testnamen, Commits und UI-Texte sind deutsch.
- Statuscodes nach `src/AGENTS.md`, „Statuscode-Konvention“. Fehlende Berechtigung ist 403,
  ungültige Eingabe ist 400 (`AppError::Validation`).
- Antwort-DTOs: `#[derive(Serialize, ToSchema)]`, eingetragen in `src/api_doc.rs`, danach
  `scripts/check-typ-codegen.sh`. `openapi.json` und `types.generated.ts` werden mitcommittet.
- Konten, die nirgends zählen und nirgends auswählbar sind: `aktiv = 0`,
  `crate::geraet::repo::OHNE_GERAETEKONTEN`, `crate::instanz::spiegel::OHNE_STELLVERTRETER`
  (beide erwarten den Alias `b`).
- Demo-Zeilen (`demo_herkunft`, Tabellen `fahrzeug`, `personal`, `einheit_vorlage`) zählen nicht
  zum Bestand. Sie werden getrennt gezählt.
- Wortlaut genau so:
  - „Für einen Einsatz fehlt: …“
  - „Bereit für einen Einsatz.“
  - „weitere Benutzer“
  - „Fahrzeuge oder Personal“
  - „+ N aus der Demo“
  - „nur du (Einsatzleitung)“
  - „du + N Personen“ (bei N = 1: „du + 1 Person“)
- Node und pnpm nur über `mise exec -- …`.
- **Reihenfolge:** Task 7 (Dialog) beginnt erst, wenn LLH-1816 auf `alpha` gemergt ist. Dann
  vorher `git fetch origin alpha && git merge origin/alpha`. Der PR entsteht erst nach Task 9.

## Review Focus

1. **Org-Grenze beim Anlegen:** Eine `benutzer_id` aus einer fremden Organisation in `mitglieder`
   gibt 400, und kein Einsatz entsteht. Pin: Task 3, `fremde_person_bricht_anlegen_ab`.
2. **Halb geschrieben:** Ist die dritte von drei Personen ungültig, gibt es weder Einsatz noch
   Mitgliedschaft noch Benachrichtigung. Pin: Task 3, `ungueltige_person_hinterlaesst_nichts`.
3. **Eine Führungskraft ohne Systemrolle** bekommt die Übersicht mit Benutzerzahl, aber keine
   Namen, und in ihrer Zeile keinen Sprung zur Benutzerseite. Pin: Task 1,
   `fuehrungskraft_bekommt_nur_zahlen`, und Task 6, `fuehrungskraft_ohne_sprung_zu_benutzern`.
4. **Nur Demo-Daten:** Eine Organisation mit eingespielter Demo und ohne eigene Fahrzeuge oder
   eigenes Personal liest „Für einen Einsatz fehlt: …“. Pin: Task 1,
   `demo_zaehlt_getrennt`, und Task 4, `nur_demo_ist_nicht_bereit`.
5. **Route-Kollision:** `GET /api/einsaetze/mitglied-auswahl` wird nicht als Einsatz-ID gelesen,
   und `GET /api/einsaetze/{id}` funktioniert weiter. Pin: Task 2,
   `auswahl_pfad_ist_kein_einsatz`.

---

### Task 1: Zähl-Endpunkt `GET /api/verwaltung/bereitschaft`

**Files:**
- Create: `src/routes/verwaltung.rs`
- Modify: `src/routes/mod.rs` (Modul eintragen), `src/app.rs` (Route neben `/api/benutzer`,
  ~Zeile 237), `src/api_doc.rs` (Pfad und Schema)
- Generiert: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`
- Test: `tests/verwaltung_bereitschaft.rs`

**Interfaces:**
- Produces:
  - `pub struct Bereitschaft { benutzer: i64, fahrzeuge: i64, fahrzeuge_demo: i64, personal: i64,
    personal_demo: i64, einheit_vorlagen: i64, einheit_vorlagen_demo: i64,
    einsatz_vorlagen: i64 }` (`Serialize, ToSchema, sqlx::FromRow`)
  - `pub async fn bereitschaft(State, Benutzer) -> Result<Json<Bereitschaft>, AppError>`
  - TS-Typ `components['schemas']['Bereitschaft']`

- [x] **Step 1: Die Tests schreiben, die scheitern sollen.** Hilfen aus `tests/common`
  (`setup_mit_pool`, `login_cookie`, `benutzer_anlegen`, `fremde_org_anlegen`, `anfrage`).
  Fahrzeuge, Personal und Vorlagen über ihre bestehenden POST-Routen anlegen; ein
  `dienststatus = 'ausser_dienst'` und eine Vorlage mit `aktiv = 0` direkt per SQL.
  - `zaehlt_den_bestand_der_eigenen_org`
    - Aufbau: 2 Fahrzeuge im Dienst, 1 außer Dienst; 3 Personal im Dienst; 1 aktive und 1 inaktive
      Einheiten-Vorlage; 1 Einsatz-Vorlage; dazu ein deaktiviertes Konto, ein Gerätekonto
      (SQL wie in `tests/einsatz_mitglieder_auswahl.rs::geraetekonto_anlegen`) und eine fremde
      Organisation mit eigenem Fahrzeug.
    - Erwartet: `fahrzeuge == 2`, `personal == 3`, `einheit_vorlagen == 1`,
      `einsatz_vorlagen == 1`, `benutzer` = Admin plus die angelegten aktiven Personen, alle
      `*_demo == 0`.
  - `fuehrungskraft_bekommt_nur_zahlen`
    - Eine Führungskraft ohne Systemrolle bekommt 200.
    - Die JSON-Schlüssel sind genau die acht Felder oben, ohne Namen.
  - `ohne_verwaltungszugang_403`: Ein Konto mit `org_rolle = 'keine'` bekommt 403.
  - `demo_zaehlt_getrennt`
    - Aufbau: `POST /api/demo-daten/starkregen` als Admin (Weg wie in `tests/demo_daten.rs`).
    - Erwartet: `fahrzeuge == 0`, `fahrzeuge_demo > 0`, `personal == 0`, `personal_demo > 0`.

- [x] **Step 2: Die Tests laufen lassen und das Scheitern sehen.**
  `cargo test --test verwaltung_bereitschaft`, erwartet: FAIL, die Route gibt 404.

- [x] **Step 3: `bereitschaft` umsetzen.**
  - Gate: `benutzer.darf_admin_bereich()`, sonst `AppError::Forbidden`.
  - Eine `SELECT` mit acht Unterabfragen, alle gebunden an `benutzer.org_id`.
  - Benutzer wie `routes::benutzer::liste` mit `aktiv = 1` (Alias `b`).
  - Der Demo-Anteil über
    `EXISTS (SELECT 1 FROM demo_herkunft d WHERE d.tabelle = '<tab>' AND d.datensatz_id = x.id)`.
    Der eigene Bestand ist dieselbe Abfrage mit `NOT EXISTS`.
  - Route in `app.rs` eintragen, Pfad und Schema in `api_doc.rs`.
  - Kopfkommentar mit Verweis auf das Design-Doc.

- [x] **Step 4: Prüfen, dass die Tests durchlaufen.**
  `cargo test --test verwaltung_bereitschaft`, erwartet: PASS. Danach
  `scripts/check-typ-codegen.sh`, erwartet: exit 0, die generierten Dateien sind aktualisiert.

- [x] **Step 5: Commit.**
  `feat(verwaltung): Bestand der Bereitschaft zählen (LLH-1820)`, mit Zunder-Zeile.

### Task 2: Auswahl beim Anlegen `GET /api/einsaetze/mitglied-auswahl`

**Files:**
- Modify: `src/einsatz/repo.rs`
  - `mitglied_auswahl` auf eine gemeinsame Basis umstellen;
  - neu `mitglied_auswahl_fuer_anlage`.
- Modify: `src/routes/einsatz.rs` (Handler), `src/app.rs` (Route **vor** `/api/einsaetze/{id}`
  eintragen), `src/api_doc.rs`
- Test: `tests/einsatz_mitglieder_auswahl.rs` (erweitern)

**Interfaces:**
- Consumes: `MitgliedAuswahl { benutzer_id, anzeigename }` (`src/einsatz/mod.rs:441`)
- Produces:
  - `fn auswahl_sql(zusatz: &str) -> String` (privat; enthält die Grundmenge aktiv, ohne
    Geräte- und Stellvertreterkonten, sortiert nach Anzeigename)
  - `pub async fn mitglied_auswahl_fuer_anlage(pool, org_id: i64, ohne: i64) -> Result<Vec<MitgliedAuswahl>, AppError>`
  - `pub(crate) async fn ist_aufnehmbar_tx(conn, org_id: i64, benutzer_id: i64) -> Result<bool, AppError>`
    über dieselbe Grundmenge. Task 3 braucht sie.
  - Handler `routes::einsatz::mitglied_auswahl_anlage`

- [x] **Step 1: Die Tests schreiben, die scheitern sollen.**
  - `anlage_auswahl_bietet_die_org_ohne_mich`: Eine Führungskraft ohne Systemrolle bekommt die
    aktiven Personen der Org ohne sich selbst. Kein deaktiviertes Konto, kein Gerätekonto, keine
    fremde Org.
  - `anlage_auswahl_ohne_anlegerecht_403`: `org_rolle = 'keine'` bekommt 403.
  - `auswahl_pfad_ist_kein_einsatz`: Die neue Route gibt 200 und ein Array. Gleichzeitig gibt
    `GET /api/einsaetze/{id}` für einen bestehenden Einsatz weiter 200.
  - Die bestehenden Tests der Datei bleiben unverändert grün. Sie sichern den Umbau von
    `mitglied_auswahl` ab.

- [x] **Step 2: Die Tests laufen lassen und das Scheitern sehen.**
  `cargo test --test einsatz_mitglieder_auswahl`, erwartet: die neuen FAIL, die alten PASS.

- [x] **Step 3: Umsetzen.**
  - `mitglied_auswahl` (pro Einsatz) nutzt `auswahl_sql` mit der bisherigen Bedingung für
    Mitgliedschaft und Org des Einsatzes.
  - `mitglied_auswahl_fuer_anlage` nutzt `b.org_id = ? AND b.id <> ?`.
  - Gate im Handler: `darf_einsatz_anlegen()`, sonst 403.

- [x] **Step 4: Prüfen, dass die Tests durchlaufen.**
  - `cargo test --test einsatz_mitglieder_auswahl --test einsatz_kontext_guard`, erwartet: PASS.
  - Meldet der Wächter die neue Route, gilt die Ausweichadresse
    `/api/einsatz-anlage/mitglied-auswahl` aus dem Design-Doc. Dann auch den Test darauf
    umstellen.
  - Danach `scripts/check-typ-codegen.sh`.

- [x] **Step 5: Commit.** `feat(einsatz): Personenauswahl schon beim Anlegen (LLH-1820)`

### Task 3: `POST /api/einsaetze` mit `mitglieder`

**Files:**
- Modify: `src/routes/einsatz.rs`
  - `NeuerEinsatz` (~:63) um `mitglieder: Option<Vec<NeuesMitglied>>` erweitern;
  - Prüfung und Benachrichtigung in `anlegen` (~:132).
- Modify: `src/einsatz/repo.rs`: neu `anlegen_mit_mitgliedern` und `mitglieder_aufnehmen_tx`.
- Test: `tests/einsatz_anlegen_mitglieder.rs` (neu)

**Interfaces:**
- Consumes: `ist_aufnehmbar_tx` (Task 2), `anlegen_tx` (unverändert), `EinsatzRolle::parse`
- Produces:
  - `#[derive(Deserialize, ToSchema)] pub struct NeuesMitglied { pub benutzer_id: i64, pub rolle: String }`
  - `pub async fn anlegen_mit_mitgliedern(pool, daten: NeuerEinsatzDaten<'_>, ersteller_id: i64, mitglieder: &[(i64, EinsatzRolle)]) -> Result<Einsatz, AppError>`.
    Eine `write_retry!`-Transaktion: zuerst `anlegen_tx`, dann `mitglieder_aufnehmen_tx`.
  - `async fn mitglieder_aufnehmen_tx(conn, einsatz_id: i64, org_id: i64, mitglieder: &[(i64, EinsatzRolle)]) -> Result<(), AppError>`
  - Konstante `MITGLIEDER_MAX: usize = 500`

- [x] **Step 1: Die Tests schreiben, die scheitern sollen.**
  - `mitglieder_kommen_mit_dem_einsatz`
    - Aufbau: Eine Führungskraft legt mit zwei Personen an, Rollen `fuehrungspersonal` und
      `beobachter`.
    - Erwartet: 201 bzw. der Status, den `anlegen` heute liefert. `GET …/mitglieder` zeigt die
      anlegende Person als `einsatzleitung` und die beiden mit ihren Rollen.
  - `aufgenommene_bekommen_den_hinweis`
    - Jede der beiden hat genau eine Zeile `einsatz_aufnahme` mit `einsatz_id` des neuen
      Einsatzes.
    - Die anlegende Person hat keine (Prüfweg wie `tests/benachrichtigung_org.rs`).
  - `ohne_mitglieder_wie_bisher`: Fehlt das Feld oder ist `[]`, ist nur die anlegende Person
    Mitglied.
  - `fremde_person_bricht_anlegen_ab`
    - Eine `benutzer_id` aus `fremde_org_anlegen` ergibt 400.
    - Die Zahl der Einsätze ist unverändert.
  - `ungueltige_person_hinterlaesst_nichts`
    - Drei Personen, die dritte ist deaktiviert. Erwartet: 400.
    - Danach unverändert: Zahl der Einsätze, Zahl der Zeilen in `einsatz_mitgliedschaft` und in
      `benachrichtigung`.
  - `doppelte_person_400`, `anlegende_person_in_liste_400`, `unbekannte_rolle_400`: jeweils 400,
    und kein Einsatz entsteht.
  - `gerätekonto_400`: Ein Gerätekonto in der Liste ergibt 400.
  - `zu_viele_mitglieder_400`: `MITGLIEDER_MAX + 1` Einträge ergeben 400.
  - `fremde_und_inaktive_melden_gleich`: Der Fehlertext bei einer fremden und bei einer
    deaktivierten Person ist bis auf die Kennung gleich.

- [x] **Step 2: Die Tests laufen lassen und das Scheitern sehen.**
  `cargo test --test einsatz_anlegen_mitglieder`, erwartet: FAIL. Mitglieder werden heute
  ignoriert, Einsätze entstehen trotz Fehlern.

- [x] **Step 3: Umsetzen.**
  - Im Handler, vor jedem Schreiben:
    - Länge gegen `MITGLIEDER_MAX` prüfen;
    - Rolle per `EinsatzRolle::parse` prüfen;
    - keine Kennung doppelt;
    - nicht die anlegende Person.
    - Meldungen als `AppError::Validation`, zum Beispiel „Mitglieder: Person 17 kann nicht
      aufgenommen werden.“
  - In `mitglieder_aufnehmen_tx`:
    - Für jede Person `ist_aufnehmbar_tx`. Bei `false` dieselbe Meldung. Die Transaktion bricht
      ab, `write_retry!` gibt den Fehler weiter.
    - Danach `INSERT INTO einsatz_mitgliedschaft` mit Rolle, mit Org-`EXISTS` in der SQL wie
      `setze_mitgliedschaft`.
  - Den Namen der Person sucht der Handler nach dem Abbruch heraus. Die Meldung nennt ihren
    Anzeigenamen, wenn die Person in der eigenen Org existiert, sonst nur die Kennung.
  - Nach dem Commit:
    - `publish_neuer_einsatz` wie bisher;
    - je Person `benachrichtigung::melden` mit Art `EinsatzAufnahme`,
      `.von(benutzer.id)`, `.an(Adressat::Nutzer(id))`, Aufruf wie in `mitglied_setzen`.
  - `NeuesMitglied` in `api_doc.rs` eintragen.
  - Das Frontend-Interface `NeuerEinsatz` (`frontend/src/api/einsaetze.ts:32`) bekommt
    `mitglieder?: { benutzer_id: number; rolle: EinsatzRolle }[]`.

- [x] **Step 4: Prüfen, dass die Tests durchlaufen.**
  - `cargo test --test einsatz_anlegen_mitglieder --test benachrichtigung_org`, erwartet: PASS.
  - Dann `scripts/check-typ-codegen.sh`.

- [x] **Step 5: Commit.** `feat(einsatz): Mitglieder atomar beim Anlegen aufnehmen (LLH-1820)`

### Task 4: Wertung `admin/bereitschaft.ts`

**Files:**
- Create: `frontend/src/admin/bereitschaft.ts`, `frontend/src/admin/bereitschaft.test.ts`

**Interfaces:**
- Consumes: Typ `Bereitschaft` (generiert, Task 1)
- Produces:
  - `type BestandKey = 'benutzer' | 'fahrzeuge' | 'personal' | 'einheit_vorlagen' | 'einsatz_vorlagen'`
  - `type Zustand = 'fehlt' | 'empfohlen' | 'vorhanden'`
  - `interface BestandZeile { key: BestandKey; label: string; zahl: number; demo: number; zustand: Zustand }`
  - `function bewerteBereitschaft(b: Bereitschaft): { zeilen: BestandZeile[]; fehlt: string[]; satz: string }`
  - Labels und Reihenfolge der Zeilen: Benutzer, Fahrzeuge, Personal, Einheiten-Vorlagen,
    Einsatz-Vorlagen.

- [x] **Step 1: Die Tests schreiben, die scheitern sollen** (Tabellentest):

  | Eingabe (gekürzt) | `fehlt` | `satz` | Zustände |
  | --- | --- | --- | --- |
  | benutzer 1, alles andere 0 | `['weitere Benutzer', 'Fahrzeuge oder Personal']` | „Für einen Einsatz fehlt: weitere Benutzer, Fahrzeuge oder Personal.“ | benutzer, fahrzeuge, personal fehlt; Vorlagen empfohlen |
  | benutzer 2, fahrzeuge 1, personal 0 | `[]` | „Bereit für einen Einsatz.“ | fahrzeuge vorhanden, personal empfohlen |
  | benutzer 2, fahrzeuge 0, personal 0, fahrzeuge_demo 5, personal_demo 9 (`nur_demo_ist_nicht_bereit`) | `['Fahrzeuge oder Personal']` | „Für einen Einsatz fehlt: Fahrzeuge oder Personal.“ | Demo-Zahlen in `demo` |
  | alles ≥ 2 | `[]` | „Bereit für einen Einsatz.“ | alle vorhanden |

- [x] **Step 2: Die Tests laufen lassen und das Scheitern sehen.**
  `mise exec -- pnpm -C frontend exec vitest run src/admin/bereitschaft.test.ts`, erwartet: FAIL.

- [x] **Step 3: `bewerteBereitschaft` umsetzen.**
  - Pflicht: `benutzer >= 2`; `fahrzeuge + personal >= 1`. Fehlt der zweite Punkt, stehen
    Fahrzeuge **und** Personal auf `fehlt`.
  - Sonst ist von beiden der mit 0 `empfohlen`.
  - Vorlagen sind `empfohlen` bei 0, sonst `vorhanden`.

- [x] **Step 4: Prüfen, dass die Tests durchlaufen.** Gleiches Kommando, erwartet: PASS.

- [x] **Step 5: Commit.** `feat(verwaltung): Wertung der Bereitschaft (LLH-1820)`

### Task 5: Entwurf der Übersicht mit `/design`

**Files:**
- Create: `docs/design/2026-11-19-verwaltung-uebersicht/` (Ergebnis des Design-Artifacts,
  Inline-Styles maßgeblich, wie `docs/design/2026-11-12-anbindungen/`)

- [x] **Step 1: Entwurf anlegen.**
  - Artifact-Typ „Design“ auf Grundlage des Design Systems „Lifeline Hub“, Adresse in
    `docs/design/design-system/ARTIFACT.md` (`frontend/AGENTS.md`, „Größere UI-Entwürfe über das
    Design System“).
  - Zu zeigende Zustände: Pflicht fehlt; bereit mit offenen Empfehlungen; nur Demo; Ansicht
    einer Führungskraft (Benutzerzeile ohne Sprung); Handy-Breite.
  - Bausteine nur aus der Bausteinwahl:
    - `AdminPage`;
    - Satz als Hinweis mit Ton `achtung` bzw. neutral;
    - `Paneel`/`PaneelZeile` mit `Kennzahl`, `Status` und Sprung „… ↗“;
    - `SeitenSkeleton`/`SeitenFehler`.
- [x] **Step 2: Ablegen und committen.** `docs(design): Entwurf Verwaltungs-Übersicht (LLH-1820)`

### Task 6: Seite „Übersicht“ und Einstieg `/admin`

**Files:**
- Create: `frontend/src/admin/BereitschaftUebersicht.tsx`,
  `frontend/src/admin/BereitschaftUebersicht.test.tsx`
- Create oder Modify: `frontend/src/api/verwaltung.ts` mit
  `loadBereitschaft(): Promise<Bereitschaft>`
- Modify: `frontend/src/api/queryKeys.ts`:
  - `GLOBAL_KEYS.bereitschaft = 'bereitschaft'` und `globalKeys.bereitschaft()`;
  - eingetragen in `ORG_STREAM_EVENTS.stammdaten` und `ORG_STREAM_EVENTS.einsatzliste` (Demo
    einspielen).
- Modify: `frontend/src/admin/adminNav.tsx`:
  - `adminUebersicht = { key: 'uebersicht', label: 'Übersicht' }`;
  - `adminUebersichtPfad()`;
  - `defaultAdminPfad()` liefert `/admin/uebersicht`.
- Modify: `frontend/src/admin/AdminLayout.tsx` (Eintrag zuoberst, vor den Gruppen),
  `frontend/src/App.tsx` (`<Route path="uebersicht" …>`)
- Modify (Tests): `admin/adminNav.test.tsx:37`, `admin/AdminLayout.test.tsx`,
  `components/SprungZumInhalt.rahmen.test.tsx`, `App.fehlergrenze.test.tsx`,
  `zugangsprotokoll/ZugangsprotokollPage.test.tsx:92`,
  `aufbewahrung/AufbewahrungUebersicht.test.tsx:97,209`, `e2e/einsatz-vorlagen.spec.ts:77`.
  Angepasst wird nur, wo der Test den Einstieg meint.

**Interfaces:**
- Consumes: `bewerteBereitschaft` (Task 4), `components['schemas']['Bereitschaft']`
- Produces: `adminUebersichtPfad(): string` und `defaultAdminPfad() === '/admin/uebersicht'`

- [x] **Step 1: Die Tests schreiben, die scheitern sollen.**
  - `adminNav.test.tsx`: `expect(defaultAdminPfad()).toBe('/admin/uebersicht')`.
  - `BereitschaftUebersicht.test.tsx` mit gemocktem `loadBereitschaft`:
    - `zeigt_satz_und_fuenf_zeilen`: Satz „Für einen Einsatz fehlt: weitere Benutzer.“ und
      fünf Zeilen in fester Reihenfolge.
    - `demo_anteil_gedaempft`: Bei `fahrzeuge_demo: 12` steht „+ 12 aus der Demo“.
    - `sprung_fuehrt_zur_stammdatenseite`: Der Link der Fahrzeugzeile hat `href`
      `/admin/stammdaten/fahrzeuge`.
    - `fuehrungskraft_ohne_sprung_zu_benutzern`: Mit `system_rolle !== 'admin'` hat die
      Benutzerzeile keinen Link, alle anderen haben einen.
    - `fehler_zeigt_seitenfehler`: Lehnt der Abruf ab, erscheint `SeitenFehler`.
  - `queryKeys.guard.test.ts` muss mit dem neuen Key grün sein. Ihn nicht anfassen, nur
    ausführen.

- [x] **Step 2: Die Tests laufen lassen und das Scheitern sehen.**
  `mise exec -- pnpm -C frontend exec vitest run src/admin`, erwartet: FAIL.

- [x] **Step 3: Seite, Navigation und Route nach dem Entwurf aus Task 5 umsetzen.**
  - Die Sprungziele nach dem Design-Doc, Abschnitt „Seite“.
  - Dann die Tests mit altem Literal anpassen.

- [x] **Step 4: Prüfen, dass die Tests durchlaufen.**
  `mise exec -- pnpm -C frontend exec vitest run`, `mise exec -- pnpm -C frontend lint`,
  `mise exec -- pnpm -C frontend typecheck` (Skriptname aus `frontend/package.json`). Erwartet:
  alles grün.

- [x] **Step 5: Commit.** `feat(verwaltung): Übersicht als Einstieg der Verwaltung (LLH-1820)`

### Task 7: Teil „Mitglieder“ im Dialog „Neuen Einsatz anlegen“

> Beginnt erst nach dem Merge von LLH-1816 nach `alpha`. Zuerst `git merge origin/alpha`, dann
> die aktuelle Form des Dialogs in `frontend/src/pages/EinsaetzePage.tsx` lesen.

**Files:**
- Create: `frontend/src/pages/einsatzAnlegen/MitgliederKlappteil.tsx`,
  `frontend/src/pages/einsatzAnlegen/MitgliederKlappteil.test.tsx`. Liegt das Dialog-Umfeld nach
  LLH-1816 woanders, kommen die Dateien neben den Dialog.
- Modify: `frontend/src/pages/EinsaetzePage.tsx` (Klappteil unter den Feldern, Werte in
  `legeEinsatzAn`)
- Modify: `frontend/src/api/einsaetze.ts`: `loadMitgliedAuswahlAnlage()`
- Modify: `frontend/src/api/queryKeys.ts`: `globalKeys.mitgliedAuswahlAnlage()`, eingetragen in
  `NICHT_LIVE_GLOBAL_KEYS`
- Modify: den Feldbudget-Test des Dialogs, falls es einen gibt
  (`grep -rn "forceRender" frontend/src/pages/Einsaetze*`); sonst einen neuen Test in
  `MitgliederKlappteil.test.tsx`.

**Interfaces:**
- Consumes: `GET /api/einsaetze/mitglied-auswahl` (Task 2), `NeuerEinsatz.mitglieder`
  (Task 3), `EINSATZ_ROLLE_OPTIONEN` (`frontend/src/einsatz/einsatzRolle.ts`)
- Produces: Formularfeld `mitglieder: { benutzer_id: number; rolle: EinsatzRolle }[]`

- [x] **Step 1: Die Tests schreiben, die scheitern sollen.**
  - `kopf_nennt_die_wahl`: zuerst „nur du (Einsatzleitung)“, nach zwei Personen „du + 2
    Personen“, nach einer „du + 1 Person“.
  - `vorgabe_fuehrungspersonal_je_person_aenderbar`: Eine neu gewählte Person steht auf
    „Führungspersonal“ und lässt sich auf „Beobachter“ stellen.
  - `auswahl_laedt_erst_beim_aufklappen`: Der Mock von `loadMitgliedAuswahlAnlage` wird vor dem
    Aufklappen nicht aufgerufen.
  - `sendet_mitglieder_beim_anlegen`: Der Payload von `legeEinsatzAn` enthält
    `mitglieder: [{ benutzer_id: 7, rolle: 'fuehrungspersonal' }]`.
  - `feldbudget_bleibt_fuenf`: Mit `forceRender` sind zugeklappt fünf Felder sichtbar,
    aufgeklappt mehr.
  - `serverablehnung_in_fehlerzeile`: Ein 400 mit „Mitglieder: Anna Beispiel kann nicht
    aufgenommen werden.“ erscheint in der Fehlerzeile des Dialogs.

- [x] **Step 2: Die Tests laufen lassen und das Scheitern sehen.**
  `mise exec -- pnpm -C frontend exec vitest run src/pages`, erwartet: FAIL.

- [x] **Step 3: Umsetzen.**
  - Klappteil mit `forceRender`.
  - `Select mode="multiple" showSearch` über die Auswahl.
  - Je Person eine Zeile mit Rollen-`Select` (`SegmentFeld`, wenn die Bausteinwahl es für drei
    Werte verlangt).
  - Eine feste Zeile „du — Einsatzleitung“.
  - Doppelte Wahl ist durch das Multiple-Select ausgeschlossen. Eine Person ohne Rolle löst eine
    Formularprüfung aus, die den Teil über `onPruefungGescheitert` öffnet.

- [x] **Step 4: Prüfen, dass die Tests durchlaufen.**
  `mise exec -- pnpm -C frontend exec vitest run`, lint, typecheck, erwartet: grün.

- [x] **Step 5: Commit.** `feat(einsatz): Mitglieder schon im Anlegedialog wählen (LLH-1820)`

### Task 8: Regeln und Doku nachziehen

**Files:**
- Modify: `frontend/AGENTS.md`
  - „Feldbudget“, Ausnahme „Neuen Einsatz anlegen“: der eingeklappte Teil „Mitglieder“, sein Kopf
    nennt die Wahl, eine Serverablehnung kommt in die Fehlerzeile mit Namen.
  - Neuer Absatz „Verwaltung — Einstieg“ beim Abschnitt zur Bedien-Leitlinie oder zum
    Dashboard-Baukasten, mit den drei Regeln aus dem Design-Doc, Abschnitt „Regeln, die sich
    ändern“.
- Modify: `src/AGENTS.md`: neuer Abschnitt „Einsatz anlegen mit Mitgliedern (LLH-1820)“ mit den
  vier Regeln aus dem Design-Doc.
- Modify: `docs/anwender/kapitel/stammdaten.md` (Einstieg Übersicht),
  `docs/anwender/kapitel/einsatz-oberflaeche.md` (Anlegen mit Mitgliedern), jeweils `quellen` im
  Kopf ergänzen. Die Kapitelform hält `docs/anwender/AGENTS.md` fest.
- Modify: das Architekturkapitel, das `docs/architektur/AGENTS.md` für eine neue Route oder
  Schnittstelle verlangt (Mitänderungsregel prüfen).
- Modify: den Bildlauf, falls ein Bild in diesen Kapiteln die Verwaltung oder den Dialog zeigt
  (`docs/anwender/AGENTS.md`, „Bilder“).

- [ ] **Step 1: Texte schreiben.**
- [ ] **Step 2: Wächter laufen lassen.** `./scripts/check-all.sh --nur schnell`, erwartet: grün,
  einschließlich der Wächter für Doku und Prettier.
- [ ] **Step 3: Commit.** `docs: Regeln und Anwenderdoku zu Übersicht und Mitgliedern (LLH-1820)`

### Task 9: Abschluss

- [ ] **Step 1: Gate laufen lassen.** `./scripts/check-all.sh --geaendert --ohne-e2e` als ein
  Aufruf, erwartet: exit 0.
- [ ] **Step 2: Review starten.** Anlass: Berechtigung und Org-Isolation, mehrere Schreibvorgänge
  in einer Transaktion. Der Review läuft nach `dev-zunder-ausfuehren`, „Review nach Ermessen“.
  Befunde einarbeiten.
- [ ] **Step 3: Bilder aufnehmen.** Übersicht in drei Zuständen und Dialog zu- und
  aufgeklappt, mit einer Wegwerf-Spec `frontend/e2e/doku-bilder/zz-efvk5rbs.bilder.ts` nach
  „Bilder der Änderung“.
- [ ] **Step 4: Push und PR gegen `alpha`.** Die Zunder-Zeile kommt in die PR-Beschreibung.
  Danach Zunder `review` mit `pr_url`.
