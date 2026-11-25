# Copernicus-Aktivierungen vor 2023 — Umsetzungsplan (LLH-2022)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** EMSR517 (Ahrtal 2021) und künftige Katalogeinträge erscheinen mit „Ältere Aktivierungen“
in der Copernicus-Fachebene, in derselben Normalform wie die neuen Aktivierungen.

**Architecture:** Ein kuratierter Katalog (`src/karte/copernicus_altbestand.json`) wird zu
`Details` mit `Produkt.zip`. `build_antwort` lädt die Vector Packages über einen zweiten Abrufer
(`fetch_paket`), der Bytes holt und mit `read_vector_package` zu einem kleinen JSON-Teilstand
macht. Alle Copernicus-Features werden auf den Ausschnitt gefiltert.

**Tech Stack:** Rust (axum, sqlx/SQLite, serde_json, `zip` 9 mit deflate, reqwest), React/TS
(Vitest).

**Spec:** `docs/superpowers/specs/2026-11-24-pjfe442j-copernicus-aeltere-aktivierungen-design.md`

## Global Constraints

- Altbestand nur mit `archiv`; ohne `archiv` wird kein ZIP geladen.
- ZIP-Präfix fest: `https://cems-mapping-website.s3.eu-west-1.amazonaws.com/static/activations/`
  (gilt auch für die URL nach Weiterleitungen).
- Grenzen: 6 MiB Features je Antwort (bestehend), 40 Ebenen-Dateien (bestehend),
  `MAX_ZIPS = 6` je Antwort, Download-Deckel `DECKEL_PAKET = 48 MiB` (größtes ZIP von EMSR517:
  36,6 MB, AOI05), gebrauchte Einträge zusammen entpackt höchstens 32 MiB, je Eintrag 16 MiB,
  höchstens 200 Einträge im Verzeichnis. *(Abweichung vom Entwurf: dort 16 MiB Download und
  64 MiB entpackt. Gemessen sind die gebrauchten Einträge höchstens 9,8 MB, die ZIPs aber bis
  36,6 MB.)*
- Schadensebenen (`builtUp`, `transportation`) nur aus `GRA`.
- Zeit, die zählt: `aufnahme`, ersatzweise `geliefert`.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, „Bezeichner-Sprache“);
  Wire-Felder bleiben unverändert.
- Prosa, Testnamen als deutscher Satz; Kommentare verweisen auf Regeln mit Datei und Abschnitt.
- Gate vor dem PR: `./scripts/check-all.sh --geaendert --ohne-e2e`.

## Review Focus

1. ZIP mit lügender Größe im Verzeichnis (klein angegeben, groß entpackt) → Ablehnung, kein
   Speicherwachstum über die Grenze. Test in Task 2.
2. Weiterleitung von S3 auf einen fremden Host → Abruf scheitert, Gebiet `unvollstaendig`.
   Test in Task 4 (Prüffunktion der End-URL).
3. Neue Aktivierung mit gleichem Code wie ein Katalogeintrag → nur einmal in der Antwort.
   Test in Task 4.
4. Ausschnitt am Rand eines gerundeten Cache-Schlüssels → ein Feature knapp außerhalb des
   angefragten, aber innerhalb des Schlüssel-Ausschnitts bleibt drin. Test in Task 3.
5. Altaktivierung ohne Aufnahmezeit → Liste und Inspector zeigen die Lieferzeit und warnen
   „älter als 24 h“. Test in Task 5.

---

### Task 1: Katalog des Altbestands

**Files:**
- Create: `src/karte/copernicus_altbestand.json`
- Create: `src/karte/copernicus_alt.rs`
- Modify: `src/karte/mod.rs` (Modul eintragen)
- Modify: `src/karte/copernicus.rs` (`Produkt` um `zip: Option<String>`; alle Konstruktoren,
  `parse_produkt` setzt `None`)

**Interfaces:**
- Produces: `pub(crate) const PAKET_BASIS: &str` (Präfix oben);
  `pub(crate) fn load_katalog() -> &'static [Details]` (per `OnceLock`, parst
  `include_str!("copernicus_altbestand.json")`; bei Formatfehler `panic!` mit Meldung, der Test
  hält ihn grün); `pub(crate) fn parse_katalog(v: &Value) -> Option<Vec<Details>>`.
- Ein Katalog-`Gebiet` hat als `umriss` das Polygon des Rechtecks `huelle`, `huelle` als
  `Bbox`; jedes `Produkt` hat `fertig: true`, `aufnahme: None`, `sensor: None`,
  `geliefert` über `format_zeitpunkt` (Portalzeit „2021-08-11 12:48:47“ gilt als UTC),
  `ebenen: vec![]`, `zip: Some(url)`. `Details.sensibel = false`.

- [ ] **Step 1: Katalog erzeugen.** Aus der Portalseite `mapping.emergency.copernicus.eu/activations/EMSR517/`
  (Lieferzeit und ZIP je Produkt) und je ZIP `…_areaOfInterestA_…json` (Rechteck, auf 4
  Stellen nach außen gerundet; `locality` als Name) die JSON-Datei schreiben: 1 Aktivierung,
  17 Gebiete (AOI 01, 03–11, 14–18, 20, 21), 23 Produkte. Name „Flood in Western Germany“,
  Kategorie „Flood“. Schema wie im Entwurf, Feld `huelle` als `[west, süd, ost, nord]`.
- [ ] **Step 2: Failing tests** in `copernicus_alt.rs`:
  - `liest_den_katalog_mit_emsr517`: `load_katalog()` hat genau einen Eintrag `EMSR517`, 17
    Gebiete; AOI15 heißt „Bad Neuenahr-Ahrweiler“, hat zwei Produkte (GRA, monitoring 0 v1 und
    monitoring 1 v3), `huelle.west < 6.8 && huelle.ost > 7.28`.
  - `jede_zip_adresse_liegt_unter_dem_festen_praefix`: alle `zip` beginnen mit `PAKET_BASIS`
    und enden auf `_vector.zip`.
  - `kein_code_doppelt_und_jedes_gebiet_hat_produkte`.
  - `katalog_ohne_gebiete_ist_formatbruch`: `parse_katalog(&json!([{"code":"X"}]))` ist `None`.
- [ ] **Step 3: Run** `cargo test --lib karte::copernicus_alt` → FAIL (Modul fehlt).
- [ ] **Step 4: Implement** `parse_katalog`, `load_katalog`, `Produkt.zip`.
- [ ] **Step 5: Run** `cargo test --lib karte::copernicus` → PASS (auch die bestehenden).
- [ ] **Step 6: Commit** `feat: Katalog der Copernicus-Altaktivierungen (LLH-2022)`.

### Task 2: Vector Package lesen

**Files:**
- Modify: `src/karte/copernicus_alt.rs`
- Modify: `src/karte/copernicus.rs:257` (`parse_ebenen_art` überspringt einen Teil `r<n>`)
- Create: `src/karte/testdaten/copernicus-emsr517-aoi15.zip` (aus dem echten AOI15
  MONIT01 v3: `areaOfInterestA`, `observedEventA`, `builtUpP`, `transportationL` je höchstens 20
  Features, dazu `hydrographyL` und eine `.shp`, die ignoriert werden müssen; unter 100 KB)

**Interfaces:**
- Produces: `pub(crate) fn read_vector_package(bytes: &[u8]) -> Result<Value, String>` mit
  Ergebnis `{"umriss": <Geometry|null>, "ebenen": [{"art": "<wire_value>", "fc": <FeatureCollection>}]}`.
  `art` ist `EbenenArt::wire_value()` (dafür `pub(crate)`), Gegenstück
  `pub(crate) fn EbenenArt::from_wire(s: &str) -> Option<EbenenArt>`.
  Je Feature bleiben nur `geometry` und die Properties `value`, `damage_gra`, `obj_desc`,
  `info`, `notation` (das liest `normalize_ebene`/`klasse_of`). Eine Art aus mehreren Dateien
  (A/L/P) wird zu einer FeatureCollection zusammengeführt.
- Konstanten: `PAKET_MAX_EINTRAEGE = 200`, `PAKET_ENTPACKT_MAX = 32 MiB`,
  `PAKET_EINTRAG_MAX = 16 MiB`.

- [ ] **Step 1: Failing tests:**
  - `erkennt_die_ebenenart_im_altbestand`:
    `parse_ebenen_art("EMSR517_AOI15_GRA_MONIT01_builtUpP_r1_v3.json") == Some(SchadenGebaeude)`;
    bestehender Fall `…_floodDepthA_v2_VT` bleibt.
  - `liest_das_ahrtal_paket`: aus der Testdatei `umriss.type == "Polygon"`, Arten genau
    `beobachtet`, `schaden_gebaeude`, `schaden_verkehr`; ein Gebäude-Feature hat `damage_gra`
    und kein `or_src_id`.
  - `lehnt_ein_paket_mit_luegender_groesse_ab`: ZIP (im Test mit `zip::ZipWriter` gebaut), ein
    Eintrag `X_observedEventA_r1_v1.json`, 17 MiB Leerzeichen-gepolstertes JSON → `Err`.
  - `lehnt_zu_viele_eintraege_ab` (201 leere Einträge) → `Err`.
  - `ignoriert_eintraege_in_unterordnern`: `sub/X_observedEventA_r1_v1.json` wird nicht gelesen.
  - `kaputtes_zip_ist_ein_fehler`: `read_vector_package(b"kein zip")` → `Err`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Wie `pruefe_entpackt` in
  `src/abloesung/schichtplan/uebernahme/datei.rs`: zuerst Verzeichnis prüfen (Anzahl, Summe der
  angegebenen Größen der gebrauchten Einträge), dann jeden gebrauchten Eintrag mit
  `Read::take(PAKET_EINTRAG_MAX as u64 + 1)` lesen und über der Grenze abbrechen; die laufende
  Summe zählt die tatsächlich gelesenen Bytes.
- [ ] **Step 4: Run** `cargo test --lib karte::copernicus` → PASS.
- [ ] **Step 5: Commit** `feat: Vector Packages von Copernicus lesen (LLH-2022)`.

### Task 3: Ausschnittfilter und Zeit, die zählt

**Files:**
- Modify: `src/karte/copernicus.rs` (`normalize_ebene`, `gebiet_feature`, `stand` in
  `build_antwort`, neue Hilfen)

**Interfaces:**
- Produces: `pub(crate) fn filter_ausschnitt(bbox: &Bbox) -> Bbox`: jede Kante auf 2 Stellen
  gerundet wie `Bbox::cache_key_mit`, dann um 0,005° nach außen. 
  `normalize_ebene(fc, art, d, g, p, ausschnitt: &Bbox)`: ein Feature, dessen
  `bounding_box(geometry)` `ausschnitt` nicht schneidet (oder keine hat), fällt weg.
  `impl Produkt { pub(crate) fn zeit(&self) -> Option<&String> }` = `aufnahme` oder `geliefert`.
- `gebiet_feature` wählt das jüngste Produkt nach `zeit()`; `stand` in `build_antwort` ist das
  Maximum von `zeit()`.

- [ ] **Step 1: Failing tests:**
  - `laesst_features_ausserhalb_des_ausschnitts_weg`: zwei Polygone, eins bei Stuttgart, eins bei
    Hamburg; mit `stuttgart()` bleibt eins.
  - `filtert_gegen_den_gerundeten_ausschnitt`: Ausschnitt `9.101,48.70,9.40,48.90`, Feature bei
    lon 9.096 bleibt (Schlüssel rundet auf 9.10, Filter beginnt bei 9.095).
  - `ohne_aufnahme_zaehlt_die_lieferung`: `Produkt` ohne `aufnahme`, `geliefert`
    „2021-08-11 12:48:47“ → `stand == Some("2021-08-11 12:48:47")`, Gebiet trägt dessen Herkunft.
  - Bestehende Tests: Aufrufe von `normalize_ebene` bekommen `&stuttgart()`; alle bleiben grün.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** In `build_antwort`
  `let ausschnitt = filter_ausschnitt(&bbox);` und an `normalize_ebene` geben.
- [ ] **Step 4: Run** `cargo test --lib karte::copernicus` → PASS.
- [ ] **Step 5: Commit** `feat: Copernicus nur noch im Ausschnitt ausliefern (LLH-2022)`.

### Task 4: Altbestand in `build_antwort` und im Abruf

**Files:**
- Modify: `src/karte/copernicus.rs` (`build_antwort`, `select_produkte`, `fetch_copernicus`,
  Test-Stub `Quelle`)
- Modify: `src/karte/copernicus_alt.rs` (`fetch_paket` für den Betrieb)

**Interfaces:**
- Consumes: `load_katalog`, `read_vector_package`, `EbenenArt::from_wire`, `filter_ausschnitt`,
  `Produkt::zip`.
- Produces: `build_antwort(pool, fetch, fetch_paket, bbox, archiv, jetzt, grenzen)`;
  `fetch_paket: P` mit `P: Fn(String) -> Fut2 + Send + Sync`,
  `Fut2: Future<Output = Result<Value, String>> + Send` (liefert schon das Ergebnis von
  `read_vector_package`). `Grenzen` bekommt `zips: usize` (`STANDARD`: `MAX_ZIPS = 6`).
  Betrieb: `pub(crate) async fn fetch_paket(client: &reqwest::Client, url: &str) -> Result<Value, String>`
  (Präfix vor und nach dem Abruf über `resp.url()` prüfen, Status, `lies_begrenzt` mit
  `DECKEL_PAKET = 48 MiB`, dann `read_vector_package` in `spawn_blocking`).
- Abläufe:
  - `select_produkte`: ein Produkt zählt als „mit Ebenen“, wenn `!ebenen.is_empty() || zip.is_some()`.
  - Mit `archiv`: `load_katalog()`-Einträge, deren Code nicht in der Liste steht, kommen zu den
    geladenen `details` hinzu (zählen nicht als Kandidaten für `vollstaendig`).
  - Je gewähltem Produkt mit `zip`: ein Paket-Auftrag, höchstens `grenzen.zips`; darüber
    `gekuerzt`. Teilstand `copernicus-teil:paket:<url>`, `COPERNICUS_EBENE_TTL`, gültig, wenn
    `ebenen` ein Array ist.
  - Aus dem Paket: `ebenen` je `art` über `from_wire`; bei `typ != "GRA"` fallen
    `SchadenGebaeude` und `SchadenVerkehr` weg; dann `normalize_ebene` wie bei Dateien und die
    6-MiB-Rechnung.
  - Umriss: `umriss` des Pakets vom jüngsten gewählten Produkt (höchste `(monitoring, version)`)
    ersetzt den Rechteck-Umriss; fehlt das Paket, bleibt das Rechteck und das Gebiet ist
    `unvollstaendig` (und die Antwort nicht `vollstaendig`).

- [ ] **Step 1: Failing tests** (Stub `Quelle` bekommt `fetch_paket()`, das für URLs mit
  `AOI15` `read_vector_package` auf die Testdatei anwendet, sonst `Err("HTTP 404")`; Ausschnitt
  `ahrtal() = Bbox::parse("7.05,50.52,7.15,50.56")`):
  - `zeigt_emsr517_im_archiv_ueber_dem_ahrtal`: Gebiet „Bad Neuenahr-Ahrweiler“, `emsr`
    „EMSR517“, `monitoring` 1, `version` 3, `geliefert` gesetzt, Umriss vom Typ Polygon mit mehr als
    5 Punkten, Features mit `klasse` aus der Testdatei vorhanden (`art == "schaden_gebaeude"`).
  - `laedt_ohne_archiv_kein_paket`: `q.count_paket() == 0`, keine EMSR517-Features.
  - `fehlendes_paket_zeigt_das_rechteck_als_unvollstaendig`: Ausschnitt über AOI07 (Erftstadt),
    Stub liefert 404 → Gebiet mit 5-Punkt-Polygon, `unvollstaendig == true`, `vollstaendig == false`.
  - `del_paket_liefert_keine_schadensebenen` (Paket-Stub mit `schaden_gebaeude` für ein DEL-Produkt).
  - `katalogeintrag_mit_code_der_liste_kommt_nicht_doppelt` (Liste im Stub um `EMSR517` ergänzt).
  - `mehr_pakete_als_erlaubt_kuerzen_das_gebiet` (`Grenzen { zips: 0, .. }`).
  - `fetch_paket_lehnt_fremde_adressen_ab`: `fetch_paket(&client, "https://example.org/x.zip")`
    → `Err` ohne Netz.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, auch die bestehenden Aufrufe von
  `build_antwort` (Tests: `q.fetch_paket()`), und `fetch_copernicus` mit
  `copernicus_alt::fetch_paket`.
- [ ] **Step 4: Run** `cargo test --lib karte::` → PASS; `cargo clippy --all-targets` ohne
  neue Warnungen in den geänderten Dateien.
- [ ] **Step 5: Commit** `feat: Copernicus-Altaktivierungen in der Fachebene (LLH-2022)`.

### Task 5: Frontend zeigt die Lieferzeit als Ersatz

**Files:**
- Modify: `frontend/src/pages/lagekarte/fachebenen.ts` (`CopernicusAktivierung.geliefert?`,
  `copernicusAktivierungen` sortiert nach `aufnahme ?? geliefert`; `geltung` →
  `'nur wo Copernicus aktiviert wurde; vor 2023 nur ausgewählte'`)
- Modify: `frontend/src/pages/lagekarte/CopernicusZusatz.tsx` (ohne `aufnahme`:
  ` · Lieferung <zeitKurz>`)
- Modify: `frontend/src/pages/lagekarte/FachebenenInspector.tsx` (`CopernicusInhalt`: Warnung
  mit `aufnahme ?? geliefert`; Text „Aufnahme älter als 24 h“ bzw. „Lieferung älter als 24 h“)
- Test: `fachebenen.test.ts`, `CopernicusZusatz.test.tsx`, `FachebenenInspector.test.tsx`
  (vorhandene Dateien; neue `it`-Fälle)

- [ ] **Step 1: Failing tests:**
  - `copernicusAktivierungen` mit Gebiet ohne `aufnahme`, `geliefert: '2021-08-11 12:48:47'`
    → `{ emsr: 'EMSR517', geliefert: '2021-08-11 12:48:47', aufnahme: undefined }`.
  - Zusatz zeigt „Lieferung“ für diese Aktivierung und kein „Aufnahme“.
  - Inspector mit nur `geliefert` von 2021 zeigt `data-lfh="copernicus-aufnahme-alt"` mit
    „Lieferung älter als 24 h“.
- [ ] **Step 2: Run** `mise exec -- pnpm -C frontend vitest run src/pages/lagekarte` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** dasselbe → PASS; `mise exec -- pnpm -C frontend exec tsc --noEmit` ohne
  Fehler.
- [ ] **Step 5: Commit** `feat: Lieferzeit für Copernicus-Altaktivierungen anzeigen (LLH-2022)`.

### Task 6: Doku, ADR und Abnahme

**Files:**
- Create: `docs/architektur/entscheidungen/ADR-0098-copernicus-altaktivierungen-kommen-aus-einem-kuratierten-katalog.md`
  (nach `VORLAGE.md`; `gilt_fuer`: `src/karte/copernicus_alt.rs`, `src/karte/copernicus.rs`;
  Regeln: Altbestand nur mit `archiv`; ZIPs nur unter `PAKET_BASIS`; Ausschnittfilter für alle;
  Ersatz der Aufnahmezeit durch die Lieferzeit, ergänzt ADR-0079 Regel 4. Prüfung:
  `verlange 'PAKET_BASIS' 'src/karte/copernicus_alt.rs'`, `verlange 'fn filter_ausschnitt'
  'src/karte/copernicus.rs'`, `verlange 'take(' 'src/karte/copernicus_alt.rs'`)
- Modify: `docs/architektur/entscheidungen/ADR-0079-…md` (Konsequenzen: Verweis auf ADR-0098)
- Modify: `docs/fachebenen-quellen.md` (Tabellenzeile Copernicus, Abschnitt „Copernicus EMS“:
  Katalog und Pflege eines Eintrags, zweiter Host, Grenzen, Ausschnittfilter, `stand`
  ersatzweise Lieferung, „Nicht angebunden“)
- Modify: `docs/anwender/kapitel/lagekarte.md:210` („Aktivierungen vor 2023 fehlen.“ → was
  jetzt gilt) samt Regeln aus `docs/anwender/AGENTS.md`
- Modify: `docs/architektur/03-kontextabgrenzung.md:123` (Modul `copernicus_alt.rs`) und, falls
  der Wächter es verlangt, Kapitel 5

- [ ] **Step 1:** Doku und ADR schreiben; `scripts/adr-fuer.sh src/karte/copernicus_alt.rs`
  nennt ADR-0098.
- [ ] **Step 2: Run** `./scripts/check-all.sh --geaendert --ohne-e2e` → alle Schritte grün.
- [ ] **Step 3: Abnahme:** Dev-Stack starten, Lagekarte über Bad Neuenahr-Ahrweiler (Zoom 13,
  um 7.10/50.54), Copernicus an, „Ältere Aktivierungen“ an; Bild bei `deviceScaleFactor: 2`
  mit Inspector auf einem zerstörten Gebäude, nach `docs/` für den PR.
- [ ] **Step 4: Commit** `docs: Copernicus-Altbestand dokumentieren (LLH-2022)`.
