# Präsenzanzeige Implementation Plan (LLH-1946)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An einer Einzelangabe von Einsatzkopf, Führungsstelle und Einheit erscheint „Wird gerade bearbeitet von …“, solange jemand anderes sie offen hat.

**Architecture:** Ein Präsenzspeicher im `LiveHub` (nur Speicher, Ablauf 45 s) wird über zwei `PUT`/`DELETE`-Routen gefüllt. Ändert sich der Stand eines Einsatzes, geht er über einen eigenen Broadcast am Replay-Ring vorbei als drittes Teilstück in den Einsatzstrom (`merge` wie der Org-Anteil), gefiltert je Eintrag über ein Bezugsereignis. Im Frontend liest ein Store den Stand; `InlineAngabe` meldet sich beim Öffnen und alle 15 s und zeigt den Hinweis anstelle der Vermerkzeile.

**Tech Stack:** Rust (axum, tokio broadcast, `wire_enum!`, utoipa), React/TypeScript (antd, TanStack Query, Vitest, Playwright).

**Spec:** `docs/superpowers/specs/2026-11-19-errkrb6m-praesenzanzeige-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/errkrb6mxojuxpps7hljdbtt

## Global Constraints

- Ablauf 45 s nach dem letzten `PUT`, Takt des Clients 15 s, Aufräumtakt 5 s.
- Höchstens 16 Einträge je Benutzer (darüber 429), 2 000 insgesamt (darüber 503), kein Verdrängen.
- Ein Fenster hat höchstens einen Eintrag; `fenster` ist 1–64 Zeichen `[A-Za-z0-9_-]`, sonst 400.
- `felder`: 1–4 Namen aus der festen Liste des Objekts, sonst 400.
- Feldlisten: `einsatz` = `bezeichnung, stichwort, einsatzart, leitstellen_nr, einsatzort, einsatzort_koordinate, meldende_stelle, sachverhalt`; `einheit` = `name, typ_id, funkrufname, abschnitt_id, ueber_einheit_id, fuehrer_id, soll, quali_soll, bemerkung, verbindungen`; `fuehrungsstelle` = `art, bezeichnung, standort_adresse, standort_koordinate, rufname, verbindungen, fahrzeug_ids, einsatzleiter`.
- Wire-Name `praesenz`, SSE-Frame **ohne** `id:`; Daten `{"einsatz_id":…,"eintraege":[{objekt,einheit_id?,felder,benutzer_id,von,fenster}]}`.
- Geräte senden (Route verboten) und empfangen (kein Teilstrom) keine Präsenz; Org-Strom bekommt keine.
- Wortlaute exakt: „Wird gerade bearbeitet von Anna“, „… von Anna und Ben“, „… von Anna und 2 weiteren“, „Wird gerade von dir in einem anderen Fenster bearbeitet“, „Wird gerade bearbeitet von Anna und von dir in einem anderen Fenster“.
- Anzeige: Rolle `meta`, Farbrolle `text`; ersetzt die `VermerkZeile`, solange Präsenz besteht; `data-lfh="feld-praesenz"`; keine Live-Region.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Prosa deutsch.
- Gate vor dem PR: `./scripts/check-all.sh --geaendert --ohne-e2e`; nach DTO-/Enum-Änderung `scripts/check-typ-codegen.sh`.

## Review Focus

1. **Tab stürzt ab, ohne `pagehide`:** Der Hinweis bei anderen verschwindet nach höchstens 45 s + 5 s. Test in Task 1 (`raeume_entfernt_abgelaufene_und_meldet_einsatz`).
2. **Strom bricht ab und baut neu auf:** Der Store wird geleert, und der Stand beim Verbinden füllt ihn neu. Kein Geisterhinweis aus der alten Verbindung. Tests in Task 4 (`leert_stand_bei_abbruch`) und Task 2 (`neuer_strom_bekommt_stand_beim_verbinden`).
3. **Leser ohne Modul `einheiten`:** Er bekommt keinen Einheit-Eintrag, auch nicht im Stand beim Verbinden. Test in Task 2 (`ohne_einheiten_kein_einheit_eintrag`).
4. **Dasselbe Konto in zwei Fenstern an derselben Angabe:** Das eigene Fenster sieht „von dir in einem anderen Fenster“ und nie sich selbst. Test in Task 4 (`eigenes_fenster_ausgenommen_anderes_ist_du`).
5. **Fenster wechselt die Angabe, ohne zu schließen** (Sperre, Navigation): Der alte Eintrag verschwindet, weil das Fenster nur einen Eintrag hat. Test in Task 1 (`zweites_put_ersetzt_eintrag_des_fensters`).

---

### Task 1: Präsenzspeicher im Backend

**Files:**
- Create: `src/live/praesenz.rs`
- Modify: `src/live/mod.rs` (Modul, Feld im `LiveHub`, Methoden, Sweep)
- Modify: `src/main.rs:238` (Aufräumtakt starten)
- Test: Unit-Tests in `src/live/praesenz.rs`

**Interfaces:**
- Produces:
  - `wire_enum! pub enum PraesenzObjekt { Einsatz => "einsatz", Einheit => "einheit", Fuehrungsstelle => "fuehrungsstelle" }` mit `Serialize, Deserialize, ToSchema`; `fn felder(self) -> &'static [&'static str]` (Listen aus Global Constraints); `fn bezug(self) -> LiveEvent` (`Einsatz`/`Fuehrungsstelle` → `LiveEvent::Einsatz`, `Einheit` → `LiveEvent::Einheit`).
  - `#[derive(Clone, Serialize, ToSchema)] pub struct PraesenzEintrag { objekt: PraesenzObjekt, #[serde(skip_serializing_if = "Option::is_none")] einheit_id: Option<i64>, felder: Vec<String>, benutzer_id: i64, von: String, fenster: String }`
  - `#[derive(Clone, Serialize, ToSchema)] pub struct PraesenzStand { einsatz_id: i64, eintraege: Vec<PraesenzEintrag> }`
  - `pub struct PraesenzSpeicher` mit `fn setze(&self, einsatz_id: i64, eintrag: PraesenzEintrag, jetzt: Instant) -> Result<bool, AppError>` (true = Stand geändert; 429 `AppError::TooManyRequests` bzw. 503 `ServiceUnavailable` laut vorhandenen Varianten), `fn entferne(&self, einsatz_id: i64, benutzer_id: i64, fenster: &str) -> bool`, `fn raeume(&self, jetzt: Instant) -> Vec<i64>` (Einsätze mit Änderung), `fn stand(&self, einsatz_id: i64) -> PraesenzStand`; Konstanten `PRAESENZ_ABLAUF = 45 s`, `PRAESENZ_RAEUM_TAKT = 5 s`, `JE_BENUTZER = 16`, `GESAMT = 2000`.
  - `LiveHub`: `pub fn praesenz_setzen(&self, einsatz_id, eintrag) -> Result<(), AppError>`, `pub fn praesenz_entfernen(&self, einsatz_id, benutzer_id, fenster: &str)`, `pub fn praesenz_stand(&self, einsatz_id) -> PraesenzStand`, `pub fn abonniere_praesenz(&self) -> broadcast::Receiver<PraesenzStand>`, `pub fn starte_praesenz_sweep(&self)`. Gesendet wird nur, wenn `setze`/`entferne`/`raeume` eine Änderung melden.

- [ ] **Step 1: Unit-Tests schreiben** (Zeit hineingereicht, `Instant::now()` + Offsets)
  - `setze_neu_meldet_aenderung_verlaengern_nicht`: erstes `setze` → `true`, zweites gleiches nach 10 s → `false`.
  - `zweites_put_ersetzt_eintrag_des_fensters`: gleiches `(benutzer, fenster)`, anderes Feld → `true`, `stand().eintraege.len() == 1` mit neuem Feld.
  - `raeume_entfernt_abgelaufene_und_meldet_einsatz`: Eintrag bei t0, `raeume(t0+44s)` → `[]`, `raeume(t0+46s)` → `[einsatz_id]`, Stand leer.
  - `entferne_idempotent`: zweites `entferne` → `false`.
  - `grenze_je_benutzer_429_gesamt_503`: 16 Fenster eines Benutzers ok, 17. → 429; Gesamtgrenze per Test-Konstruktor klein (`PraesenzSpeicher::mit_grenzen(je_benutzer, gesamt)`) → 503; ein bestehender Eintrag wird nie verdrängt.
  - `bezug_und_felder`: `Einheit.bezug() == LiveEvent::Einheit`, `Fuehrungsstelle.bezug() == LiveEvent::Einsatz`, `Einsatz.felder()` enthält `"leitstellen_nr"`.
- [ ] **Step 2:** `cargo test --lib live::praesenz` → FAIL (Modul fehlt).
- [ ] **Step 3:** `praesenz.rs` umsetzen (`Mutex<HashMap<i64, Vec<(PraesenzEintrag, Instant)>>>`), Hub-Feld `praesenz: Arc<PraesenzSpeicher>` und `praesenz_tx: broadcast::Sender<PraesenzStand>` (Kapazität 256) in `mit_stromgrenzen`, Sweep wie `starte_kanal_sweep`, Aufruf in `main.rs` neben `starte_kanal_sweep`.
- [ ] **Step 4:** `cargo test --lib live::praesenz` → PASS.
- [ ] **Step 5:** Commit `feat: Präsenzspeicher im Live-Hub (LLH-1946)`.

### Task 2: Ereignis `praesenz` im Einsatzstrom, Gate je Eintrag

**Files:**
- Modify: `src/live/mod.rs` (Variante `Praesenz => "praesenz"`, `modul_keys` `&[]` mit Kommentar, Wächtertest `ungegatet_sind_nur_…` um `praesenz` erweitern, Gate-Pin in `gate_mengen_sind_gepinnt`)
- Modify: `src/live/praesenz.rs` (`PraesenzStand::fuer(&self, erlaubt: &HashSet<&'static str>) -> PraesenzStand`, behält Einträge mit `objekt.bezug().sichtbar_fuer(erlaubt)`)
- Modify: `src/routes/support.rs` (`pub fn sse_praesenz_stream(start: Option<PraesenzStand>, rx: Receiver<PraesenzStand>, einsatz_id: i64, erlaubt: HashSet<&'static str>) -> impl Stream<…>`: Frames ohne `id:`, nur für `einsatz_id`, ein gefilterter leerer Stand wird nur gesendet, wenn der zuletzt gesendete nicht leer war; `Lagged` wird übersprungen, weil jeder Stand vollständig ist und der nächste ihn ersetzt)
- Modify: `src/routes/live.rs::stream` (bei `ctx.geraet == None` dritter `merge`; Startstand = `state.live.praesenz_stand(einsatz_id)` als erstes Frame des Präsenzteils, nur wenn er gefiltert nicht leer ist; die Reihenfolge zur `position` ist gleichgültig, weil das Frame kein `id:` trägt)
- Modify: `tests/enum_wire_kontrakt.rs` (`live_event_wire` um `praesenz`, neuer Fall `praesenz_objekt_wire`)
- Modify: `frontend/src/api/liveEvent.contract.test.ts` (`NICHT_REGISTRY` um `'praesenz'`)
- Generated: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts` (Schemas `PraesenzStand`, `PraesenzEintrag`, `PraesenzObjekt` registrieren, Muster `FeldVermerk`)
- Test: `tests/praesenz_live.rs` (neu)

**Interfaces:**
- Consumes: Task 1 (`PraesenzStand`, `abonniere_praesenz`, `praesenz_stand`, `PraesenzObjekt::bezug`).
- Produces: SSE-Ereignis `praesenz` (Form siehe Global Constraints); TS-Typen `PraesenzStand`, `PraesenzEintrag`, `PraesenzObjekt` aus `api/types`.

- [ ] **Step 1: Tests schreiben** (`tests/praesenz_live.rs`, Helfer wie `tests/live_feed.rs::sse_frames`; Einträge direkt über `live.praesenz_setzen` gesetzt)
  - `neuer_strom_bekommt_stand_beim_verbinden`: Eintrag gesetzt, Strom geöffnet → ein Frame `praesenz` ohne `id:` mit `"leitstellen_nr"`; die `Last-Event-ID` des Stroms ist die der `position`.
  - `aenderung_wird_verteilt_herzschlag_nicht`: offener Strom; `setze` neu → ein Frame; gleiches `setze` erneut → kein weiterer Frame binnen 300 ms.
  - `ohne_einheiten_kein_einheit_eintrag`: Benutzer ohne Modul `einheiten` (Muster vorhandener Gate-Tests) sieht Einsatz-Eintrag, nicht den Einheit-Eintrag — auch im Startstand.
  - `geraetestrom_ohne_praesenz`: Gerätesitzung (Helfer aus `tests/geraet_kopplung.rs`) bekommt kein `praesenz`-Frame.
  - `fremder_einsatz_nicht`: Stand eines anderen Einsatzes erscheint nicht.
  - `praesenz_ist_ungegatet_nur_mit_bezug` im Wächtertest von `mod.rs`.
- [ ] **Step 2:** `cargo test --test praesenz_live` und `cargo test --test enum_wire_kontrakt` → FAIL.
- [ ] **Step 3:** Umsetzen wie unter Files beschrieben.
- [ ] **Step 4:** Beide Tests PASS; `scripts/check-typ-codegen.sh` → grün nach Mitcommit der zwei generierten Dateien; `mise exec -- pnpm -C frontend exec vitest run src/api/liveEvent.contract.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: Präsenz im Einsatzstrom am Replay-Ring vorbei (LLH-1946)`.

### Task 3: Schreibwege `PUT`/`DELETE …/praesenz`

**Files:**
- Create: `src/routes/praesenz.rs`
- Modify: `src/routes/mod.rs`, `src/app.rs` (Routen neben `…/fuehrungsstelle` bzw. `…/einheiten/{eid}`)
- Test: `tests/praesenz_live.rs` (weitere Fälle), `tests/geraet_kopplung.rs` (ein Fall)

**Interfaces:**
- Consumes: Task 1 (`praesenz_setzen`, `praesenz_entfernen`, `PraesenzObjekt::felder`).
- Produces:
  - `PUT|DELETE /api/einsaetze/{id}/praesenz`, Gate `EinsatzVerwaltungszugriff`, Body PUT `PraesenzEinsatzBody { objekt: PraesenzObjekt, felder: Vec<String>, fenster: String }` (nur `einsatz`/`fuehrungsstelle`, `einheit` → 400), Body DELETE `PraesenzEndeBody { fenster: String }`.
  - `PUT|DELETE /api/einsaetze/{id}/einheiten/{eid}/praesenz`, Gate `EinsatzSchreibzugriff<Einheiten>`, Body PUT `PraesenzFeldBody { felder: Vec<String>, fenster: String }`; Einheit nicht im Einsatz → 404.
  - Antworten 204. `von` = `ctx.benutzer.anzeigename`. Einsatz nicht aktiv / Spiegel: dieselbe Prüfung wie der jeweilige PATCH (Helfer dort wiederverwenden).

- [ ] **Step 1: Tests schreiben**
  - `put_setzt_und_strom_zeigt_namen`: PUT Einsatz `leitstellen_nr` → 204, offener Strom eines zweiten Benutzers erhält Eintrag mit `von` = Anzeigename.
  - `delete_beendet_und_ist_idempotent`: DELETE → 204, Strom erhält leeren Stand; zweites DELETE → 204.
  - `unbekanntes_feld_400`, `leere_oder_fuenf_felder_400`, `fenster_ungueltig_400`, `einheit_ueber_einsatzroute_400`.
  - `ohne_schreibrecht_403`, `fremde_org_404`, `fremde_einheit_404`.
  - `abgeschlossener_einsatz_wie_patch` (gleicher Status wie PATCH daneben).
  - `tests/geraet_kopplung.rs`: `geraet_darf_keine_praesenz_melden` → 403 auf beiden Routen.
- [ ] **Step 2:** `cargo test --test praesenz_live --test geraet_kopplung` → FAIL.
- [ ] **Step 3:** Handler umsetzen (`JsonBody`, `PfadParam`; Prüfungen vor dem Setzen; Feldliste und `fenster`-Regel als Funktion `pruefe_meldung(objekt, &felder, &fenster) -> Result<(), AppError>` in `praesenz.rs` des Hubs).
- [ ] **Step 4:** Tests PASS; `scripts/check-typ-codegen.sh` grün (Routen in OpenAPI, falls Muster es verlangt).
- [ ] **Step 5:** Commit `feat: Präsenz melden und beenden (LLH-1946)`.

### Task 4: Frontend-Anbindung: API, Store, Listener

**Files:**
- Modify: `frontend/src/api/client.ts` (`export async function apiSendKeepaliveMethode(pfad: string, methode: 'DELETE', body: unknown): Promise<void>` mit `schreibKoepfe()`; Doku wie `apiSendKeepalive`)
- Create: `frontend/src/live/praesenz.ts` (Store + Listener + API)
- Create: `frontend/src/live/praesenz.test.ts`
- Modify: `frontend/src/live/useEinsatzLiveStream.ts` (`listeners.push(...praesenzListener(einsatzId))`; bei Wiederaufbau/Endzustand `leerePraesenz(einsatzId)`)
- Modify: `frontend/src/api/schreibwege.guard.test.ts` falls die Liste erlaubter Helfer dort steht

**Interfaces:**
- Consumes: Task 2/3 (Wire-Form, Routen), `api/types` (`PraesenzStand`, `PraesenzObjekt`).
- Produces:
  - `export type PraesenzSchluessel = { einsatzId: number; objekt: PraesenzObjekt; einheitId?: number; felder: readonly string[] }`
  - `export const FENSTER_ID: string` (einmal je Tab, `crypto.randomUUID()`)
  - `export function praesenzListener(einsatzId: number): [string, EventListener][]`
  - `export function leerePraesenz(einsatzId: number): void`
  - `export function usePraesenzAnderer(s: PraesenzSchluessel, feld?: string): { andere: string[]; du: boolean }` (`feld` grenzt auf eine Zeile ein; ohne `feld` zählt jede Überschneidung mit `s.felder`; eigener Eintrag = `benutzer_id === me && fenster === FENSTER_ID` ausgenommen; `du` = `benutzer_id === me && fenster !== FENSTER_ID`; Namen eindeutig, Reihenfolge wie Wire)
  - `export function meldePraesenz(s: PraesenzSchluessel): Promise<void>` (PUT über `apiSend`, Fehler verschluckt) und `export function beendePraesenz(s: PraesenzSchluessel, beimVerlassen?: boolean): void` (DELETE über `apiSend` bzw. `apiSendKeepaliveMethode`)
  - `export function praesenzSatz(andere: string[], du: boolean): string | null` (Wortlaute aus Global Constraints)

- [ ] **Step 1: Tests schreiben** (`praesenz.test.ts`)
  - `praesenzSatz`: alle fünf Wortlaute exakt, `([], false)` → `null`.
  - `eigenes_fenster_ausgenommen_anderes_ist_du`: Stand mit eigenem Fenster und eigenem Konto in anderem Fenster → `{ andere: [], du: true }`.
  - `feld_trifft_ueberschneidung`: Eintrag `felder: ['einsatzort','einsatzort_koordinate']`, Abfrage `feld='einsatzort_koordinate'` → Treffer.
  - `leert_stand_bei_abbruch`: Listener füttert Stand, `leerePraesenz` → Hook liefert leer.
  - `fremder_einsatz_ignoriert`: Frame mit anderer `einsatz_id` ändert nichts.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/live/praesenz.test.ts` → FAIL.
- [ ] **Step 3:** Umsetzen (Store als `Map<number, PraesenzStand>` + Abonnenten, `useSyncExternalStore`; kein Query-Key).
- [ ] **Step 4:** Test PASS; `mise exec -- pnpm -C frontend exec vitest run src/api` → PASS (Schreibwege-Wächter).
- [ ] **Step 5:** Commit `feat: Präsenz-Store und Listener im Frontend (LLH-1946)`.

### Task 5: `InlineAngabe` meldet und zeigt; `VermerkZeile` weicht

**Files:**
- Modify: `frontend/src/components/InlineAngabe.tsx` (Prop `praesenz?: PraesenzSchluessel`; Takt; Hinweis)
- Modify: `frontend/src/components/FeldVermerkAnzeige.tsx` (`VermerkZeile({ vermerk, praesenz?, feld? })` rendert `null`, solange `usePraesenzAnderer` jemanden liefert; `export function PraesenzZeile({ praesenz, feld? })`)
- Test: `frontend/src/components/InlineAngabe.praesenz.test.tsx` (neu), `frontend/src/components/FeldVermerkAnzeige.test.tsx`

**Interfaces:**
- Consumes: Task 4 (`PraesenzSchluessel`, `usePraesenzAnderer`, `meldePraesenz`, `beendePraesenz`, `praesenzSatz`), `useOhneVerbindung` (`offline/verbindung.ts`).
- Produces: `InlineAngabe` mit `praesenz`; `PraesenzZeile`; `VermerkZeile` mit optionalem `praesenz`/`feld`.

- [ ] **Step 1: Tests schreiben** (Fake-Timer, `meldePraesenz`/`beendePraesenz` gemockt)
  - `meldet_beim_oeffnen_und_alle_15s`: öffnen → 1 Aufruf; +15 s → 2; +15 s → 3.
  - `beendet_beim_schliessen_und_aushaengen`: Abbrechen → `beendePraesenz` 1×; erneut öffnen und unmount → 1× mehr.
  - `pagehide_beendet_mit_keepalive`: `window.dispatchEvent(new Event('pagehide'))` bei offenem Feld → `beendePraesenz(s, true)`.
  - `ohne_netz_nichts`: `useOhneVerbindung` → true: öffnen sendet nichts.
  - `ohne_prop_nichts`: ohne `praesenz` kein Aufruf.
  - `hinweis_geschlossen_und_offen`: Store mit „Anna“ → `[data-lfh="feld-praesenz"]` zeigt „Wird gerade bearbeitet von Anna“ im geschlossenen Zustand und im offenen unter der Eingabe; Wertknopf hat `aria-describedby` auf den Hinweis; kein `role="status"`/`aria-live` am Hinweis.
  - `vermerk_weicht`: `VermerkZeile` mit Vermerk und Präsenz → nur Präsenztext, ohne Präsenz → „Geändert von …“.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend exec vitest run src/components/InlineAngabe.praesenz.test.tsx src/components/FeldVermerkAnzeige.test.tsx` → FAIL.
- [ ] **Step 3:** Umsetzen: Takt in einem `useEffect` an `offen && praesenz && !ohneNetz`, Aufräumen ruft `beendePraesenz`; `pagehide`-Listener nur solange offen; Hinweis über `PraesenzZeile` (Rolle `meta`, Farbe `rollen.text`).
- [ ] **Step 4:** Tests PASS; vorhandene `InlineAngabe`-Tests PASS.
- [ ] **Step 5:** Commit `feat: InlineAngabe meldet Präsenz und zeigt den Hinweis (LLH-1946)`.

### Task 6: Aufrufstellen und e2e

**Files:**
- Modify: `frontend/src/pages/EinsatzdatenPage.tsx` (Kopfangaben `objekt: 'einsatz'`, Einsatzort-Adresse `felder: ['einsatzort','einsatzort_koordinate']`, Koordinate `['einsatzort_koordinate']`, Führungsstellen-Angaben `objekt: 'fuehrungsstelle'`, `StandortAngabe` `['standort_adresse','standort_koordinate']` sofern über `InlineAngabe`; `VermerkZeile` jeweils mit demselben Schlüssel)
- Modify: `frontend/src/pages/einheit/EinheitKopf.tsx`, `frontend/src/pages/einheit/EinheitFunk.tsx`, `frontend/src/pages/EinsatzleiterAngabe.tsx` (nur Angaben über `InlineAngabe`; `objekt: 'einheit'`, `einheitId: e.id`)
- Create: `frontend/e2e/praesenz.spec.ts`

**Interfaces:**
- Consumes: Task 5.

- [ ] **Step 1: e2e schreiben** `praesenz.spec.ts`: zwei Browserkontexte (zwei Benutzer, Helfer der Suite), beide auf Einsatzdaten; A öffnet „Leitstellen-Nr.“ → bei B `[data-lfh="feld-praesenz"]` mit „Wird gerade bearbeitet von <A>“ binnen 5 s; A bricht ab → Hinweis bei B binnen 5 s weg. Dasselbe einmal an Einheit › Bemerkung.
- [ ] **Step 2:** Lauf nach `frontend/e2e/AGENTS.md` → FAIL.
- [ ] **Step 3:** Props an den Aufrufstellen setzen.
- [ ] **Step 4:** e2e PASS; `mise exec -- pnpm -C frontend exec tsc -b` und Lint grün.
- [ ] **Step 5:** Commit `feat: Präsenz an Einsatzdaten, Führungsstelle und Einheit (LLH-1946)`.

### Task 7: Regeln, Architektur- und Anwenderdoku

**Files:**
- Modify: `src/AGENTS.md` (Live-Abschnitt: flüchtiger Zustand am Ring vorbei, Gate je Eintrag über Bezugsereignis, nie Org-Strom, nie Geräte)
- Modify: `frontend/AGENTS.md:1558` (zweite Ausnahme: Präsenzhinweis an einer Angabe ohne Vermerk; Live-Abschnitt: Präsenz-Store außerhalb des Query-Caches, kein Query-Key)
- Modify: nach `docs/architektur/AGENTS.md` die betroffenen arc42-Kapitel; ADR-0003/0064 fortschreiben oder neue ADR (Nummer nach der Regel dort), `scripts/adr-fuer.sh` nennt sie danach für `src/live/praesenz.rs`
- Modify: Anwenderkapitel zu Einsatzdaten und Einheit nach `docs/anwender/AGENTS.md` (ein Satz mit Wortlaut)

- [ ] **Step 1:** Regeln und Doku schreiben.
- [ ] **Step 2:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (Prettier, Doku- und ADR-Wächter eingeschlossen).
- [ ] **Step 3:** Commit `docs: Präsenzanzeige in Regeln und Doku (LLH-1946)`.
