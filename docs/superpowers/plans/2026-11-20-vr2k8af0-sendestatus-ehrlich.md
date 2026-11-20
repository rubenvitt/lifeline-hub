# Sendestatus ehrlich und dauerhaft sichtbar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Ein Vormerken nach einem Serverfehler heißt nicht mehr „offline“, und was nicht gesendet ist, steht dauerhaft und antippbar im Kopf, im Wiederherstellungsbereich, im Erfassungszähler und in den Meldungslisten.

**Architecture:** `OfflineSchreibErgebnis` 'vorgemerkt' trägt `grund`; eine Funktion bildet den Wortlaut. Ein kleiner Store öffnet den Drawer, den `LiveStatusBanner` schon besitzt; der Kopf und die Betriebszeile rufen ihn. Der Drawer bekommt eine eigene Komponente für Ausstehendes.

**Tech Stack:** React 19, antd, TanStack Query, IndexedDB (`idb`), Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-vr2k8af0-sendestatus-ehrlich-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/vr2k8af0scf921ui4pi5lgwb

## Global Constraints

- Wortlaut offline: `Offline vorgemerkt: ${was}`; Serverfehler: `Server-Fehler – ${was} vorgemerkt, wird erneut gesendet` (Gedankenstrich U+2013). Serverfehler-Toast 8 s.
- Kopf: `${n} NICHT GESENDET`; Betriebszeile: `n nicht gesendet`; Erfassung: `Erfasst: n · nicht gesendet: m`; Listen- und Drawer-Titel: `Nicht gesendet`.
- Grund `serverfehler` genau bei `ApiError` mit `vomAnwendungsserver` und Status 408, 429 oder ≥ 500; alles andere Vormerkbare ist `offline`.
- `istOfflineTransient` bleibt unverändert; nichts Neues wird in der Queue gespeichert.
- Bezeichner nach `AGENTS.md` „Bezeichner-Sprache“ (neue Technikwörter englisch, Fachwörter deutsch). Kommentare, UI, Testnamen deutsch.
- Befehle im Frontend über `mise exec -- pnpm …` aus `frontend/`.

## Review Focus

1. 502/503/504 vom Gateway **ohne** Umschlag des eigenen Servers → `offline`, nicht `serverfehler` (Task 1, Test).
2. Kopf ohne Netz mit ausstehenden Einträgen: OFFLINE behält Vorrang, kein zweiter Knopf, Zahl bleibt in der Betriebszeile (Task 4, Test auf `syncZustand`).
3. Ein am Spiegel **beantragter** Eintrag (Queue-Zeile mit `antrag`) erscheint nicht zusätzlich unter „Nicht gesendet“ in Meldungen (Task 6, Test).
4. Erfassung im Serienlauf: zwei vorgemerkte und ein gesendeter Satz ergeben `Erfasst: 1 · nicht gesendet: 2`; nur vorgemerkte ergeben `nicht gesendet: 2` ohne `Erfasst: 0` (Task 3, Test).
5. Drawer-Abschnitt aktualisiert sich, wenn der Sync eine Zeile sendet, während der Drawer offen ist (Task 5, Test über `OFFLINE_QUEUE_EVENT`).

---

### Task 1: Grund des Vormerkens

**Files:**
- Modify: `frontend/src/offline/fehler.ts`, `frontend/src/offline/schreiben.ts`
- Test: `frontend/src/offline/fehler.test.ts`, `frontend/src/offline/schreiben.test.ts`

**Interfaces:**
- Produces: `export type VormerkGrund = 'offline' | 'serverfehler'` und `export function vormerkGrund(e: unknown): VormerkGrund` in `offline/fehler.ts`; `OfflineSchreibErgebnis<T>` Zweig `{ zustand: 'vorgemerkt'; client_id: string; grund: VormerkGrund }` (die Zweige der Lese-Funktionen ohne `client_id` erhalten ebenfalls `grund`).

- [x] **Step 1: Failing tests** in `fehler.test.ts`: `vormerkGrund` liefert `'serverfehler'` für `new ApiError(500, …, { vomAnwendungsserver: true })`, 503 mit Umschlag, 408 und 429 mit Umschlag; `'offline'` für 502/503/504 ohne Umschlag, `NetzFehler`, `TypeError`, 401, 412. In `schreiben.test.ts`: `erfasseMeldungOfflineFaehig` liefert bei `navigator.onLine = false` `grund: 'offline'`, bei einer 500-Antwort des eigenen Servers `grund: 'serverfehler'`; dasselbe für `erfasseStandOfflineFaehig` (gemeinsamer Pfad `mitErfassungszeitOfflineFaehig`).
- [x] **Step 2:** `mise exec -- pnpm vitest run src/offline/fehler.test.ts src/offline/schreiben.test.ts` → FAIL.
- [x] **Step 3:** `vormerkGrund` implementieren (`ApiError`-Konstruktor-Form aus `api/client.ts` ablesen); `vormerken(…, grund)` und jede Vormerk-Stelle in `schreiben.ts` reichen den Grund durch (`!navigator.onLine` → `'offline'`, `catch (e)` → `vormerkGrund(e)`). `merkeVerpflegungsausgabeVor` (Abschluss ohne Sendeversuch) liefert `'offline'`.
- [x] **Step 4:** Tests grün, `mise exec -- pnpm tsc -b --noEmit` grün (Aufrufer, die das Ergebnis nur weiterreichen, brauchen nichts).
- [x] **Step 5:** Commit `fix(offline): Vormerken kennt seinen Grund (Serverfehler oder offline)`.

### Task 2: Wortlaut an jeder Rückmeldung

**Files:**
- Create: `frontend/src/offline/vorgemerktText.ts`, Test `frontend/src/offline/vorgemerktText.test.ts`
- Modify (Toast-Stellen mit `zustand === 'vorgemerkt'`): `pages/MeldungenPage.tsx:414,551`, `pages/LagemeldungenPage.tsx:264`, `geraet/GeraetMeldungen.tsx:143`, `betreuung/useBezirkHandlungen.tsx:214`, `betreuung/registrierung/RegistrierungPaneel.tsx:157,177`, `pages/BetreuungPage.tsx:197`, `pages/BetreuungsstelleDetailPage.tsx:326`, `pages/PersonenPage.tsx:406`, `pages/personen/AufnahmePage.tsx:105`, `pages/bereitstellungsraum/EintreffenDialog.tsx:299`, `verpflegung/useAusgabeNachtragen.ts:100`, `verpflegung/AusgabeAnsicht.tsx:355`, `geraet/GeraetBetreuungsstellePage.tsx:107`, `geraet/GeraetPatientenPage.tsx:106`, `geraet/GeraetKontaktePage.tsx:183`; ihre Seitentests, die den alten Satz prüfen.

**Interfaces:**
- Consumes: `VormerkGrund` (Task 1).
- Produces: `vorgemerktText(grund: VormerkGrund, was: string): string` und `vorgemerktDauer(grund: VormerkGrund): number | undefined` (8 bei `serverfehler`, sonst `undefined` = antd-Vorgabe).

- [x] **Step 1: Failing test** `vorgemerktText.test.ts`: `vorgemerktText('offline', 'Meldung von Leitstelle')` = `'Offline vorgemerkt: Meldung von Leitstelle'`; `vorgemerktText('serverfehler', 'Meldung von Leitstelle')` = `'Server-Fehler – Meldung von Leitstelle vorgemerkt, wird erneut gesendet'`; ohne `was` (leerer String) → `'Offline vorgemerkt'` bzw. `'Server-Fehler – vorgemerkt, wird erneut gesendet'`.
- [x] **Step 2:** FAIL, dann implementieren, PASS.
- [x] **Step 3: Failing Seitentest** in `MeldungenPage`-Test: Server antwortet beim Anlegen mit 500 und `{error}`-Umschlag → Toast `Server-Fehler – Meldung von <Absender> vorgemerkt, wird erneut gesendet`; offline (`setzeOnline(false)`) → `Offline vorgemerkt: Meldung von <Absender>`.
- [x] **Step 4:** Alle Toast-Stellen oben auf `message.warning(vorgemerktText(ergebnis.grund, <bisheriger Objektteil>), vorgemerktDauer(ergebnis.grund))` umstellen (Objektteil = der Text nach „Offline vorgemerkt: “; Stellen ohne Objekt geben `''`). Bleibende Marken am Ort (`ZeilenSichtung`, `personenSpalten`, `Patientenkopf`, `ZeitfensterKarte`, `AusgabeAnsicht:586`, `EingaengeKnopf`) bleiben unverändert (Spec, Entscheidung 3).
- [x] **Step 5:** `mise exec -- pnpm vitest run` für die berührten Tests grün; bestehende Tests mit altem Satz bleiben grün (offline-Fall unverändert).
- [x] **Step 6:** Commit `fix(offline): Serverfehler meldet „Server-Fehler – … wird erneut gesendet“`.

### Task 3: Erfassungszähler zählt nur Angenommenes

**Files:**
- Modify: `frontend/src/components/Erfassung.tsx:286,355-397,508-510`
- Test: `frontend/src/components/Erfassung.test.tsx`

- [x] **Step 1: Failing tests:** `onErfassen` liefert `{ zustand: 'vorgemerkt', client_id: 'x', grund: 'serverfehler' }` → Fußzeile zeigt `nicht gesendet: 1`, kein `Erfasst:`; danach ein `{ zustand: 'gesendet', daten: … }` → `Erfasst: 1 · nicht gesendet: 1`; ein `undefined`-Ergebnis (nicht offline-fähiger Aufrufer) zählt als erfasst.
- [x] **Step 2:** FAIL.
- [x] **Step 3:** zweiter Zustand `nichtGesendet`; `istVorgemerkt(ergebnis)` entscheidet, welcher Zähler steigt (Formular wird in beiden Fällen geleert, `onErfasst` läuft weiter in beiden). Anzeige: Teile `Erfasst: n` (n > 0) und `nicht gesendet: m` (m > 0, in `rollen.achtungText` bzw. der Achtung-Rolle aus `useRollen`) mit ` · ` verbunden; Dateikopf-Kommentar zum Zähler ergänzen.
- [x] **Step 4:** PASS. **Step 5:** Commit `fix(erfassung): „Erfasst: n“ zählt nur, was der Server angenommen hat`.

### Task 4: Kopf und Betriebszeile öffnen den Wiederherstellungsbereich

**Files:**
- Create: `frontend/src/offline/wiederherstellungOeffnen.ts`, Test dazu
- Modify: `frontend/src/components/Kopfleiste.tsx:240-420`, `frontend/src/live/LiveStatusBanner.tsx:139-153`
- Test: `frontend/src/components/Kopfleiste.test.tsx`, `frontend/src/live/LiveStatusBanner.test.tsx`; e2e `frontend/e2e/rahmen-cls-dichte.spec.ts:248-294` (Text `WARTET 2` → `2 NICHT GESENDET`)

**Interfaces:**
- Produces: `openWiederherstellung(): void` und `subscribeWiederherstellung(listener: () => void): () => void` (Modul-Store, keine Persistenz).

- [x] **Step 1: Failing tests:** Store ruft Listener bei `openWiederherstellung`. `SYNC_DARSTELLUNG.ausstehend.satz({ausstehend: 2, …})` = `'2 Offline-Aktionen nicht gesendet — antippen für Details'`. `SyncAnzeige` im Zustand `ausstehend` rendert einen `button` mit Text `2 NICHT GESENDET`; Klick ruft `openWiederherstellung`; im Zustand `abgelehnt` ebenfalls ein Knopf; in `verbunden` kein Knopf (`role="img"`). `kompakt`: Icon plus `2`, kein Wort. `syncZustand({ online: false, …, queue: {ausstehend: 2} })` bleibt `'offline'`. Betriebszeile: Knopf `2 nicht gesendet` öffnet den Drawer; `openWiederherstellung()` von außen öffnet ihn ebenfalls.
- [x] **Step 2:** FAIL.
- [x] **Step 3:** Store anlegen; `SyncAnzeige` rendert in `ausstehend`/`abgelehnt` ein `<button type="button">` mit demselben Zellenstil (Zielgröße nach `frontend/AGENTS.md`, Bedien-Leitlinie; ohne Rahmen/Hintergrund), sonst wie bisher. `syncZeigtWort` bleibt; im kompakten `ausstehend` steht die Zahl. `LiveStatusBanner` abonniert den Store (`useEffect` → `setRecoveryOffen(true)`) und macht aus „ausstehend“ einen `Button type="text"` mit `n nicht gesendet`. Kommentare am `SyncAnzeige`-Kopf (Anzeige → Knopf) und `GERAETESPEICHER` unberührt (kein Speicher).
- [x] **Step 4:** Unit-Tests PASS; e2e-Erwartung in `rahmen-cls-dichte.spec.ts` auf `2 NICHT GESENDET` umstellen (läuft in der Suite auf `alpha`).
- [x] **Step 5:** Commit `feat(kopf): „n nicht gesendet“ als Knopf zum Wiederherstellungsbereich`.

### Task 5: Abschnitt „Nicht gesendet“ im Wiederherstellungsbereich

**Files:**
- Create: `frontend/src/offline/NichtGesendetListe.tsx`, Test `frontend/src/offline/NichtGesendetListe.test.tsx`
- Modify: `frontend/src/offline/OfflineRecoveryDrawer.tsx` (Abschnitt oben einhängen, Leerzustand berücksichtigt ihn)

**Interfaces:**
- Consumes: `schreibaktionenLaden(benutzerId, einsatzId?)`, `queueAlleLaden(benutzerId)` (ETB), `beobachteQueueAenderungen(listener)`, `OFFLINE_QUEUE_EVENT` aus `offline/queue.ts`.
- Produces: `NichtGesendetListe({ benutzerId, einsatzId }: { benutzerId?: number; einsatzId?: number })`, `aktionWort(aktion: OfflineSchreibaktion): string` (exhaustiv: „Personenerfassung“, „Meldung“, `Standmeldung: ${bezeichnung}`, …, „ETB-Eintrag“ für die ETB-Queue).

- [x] **Step 1: Failing tests:** zwei vorgemerkte Schreibaktionen (Meldung in Einsatz 7, Standmeldung „Bezirk Nord“ in Einsatz 8) und ein ETB-Eintrag → Abschnitt „Nicht gesendet“ mit drei Zeilen, je Wort, Erfassungszeit (`zeitpunkt` aus `anzeige/zeitDarstellung`) und `Einsatz 7`/`Einsatz 8` (Name aus `einsatzKeys.einsatz(id)` im Cache, falls vorhanden); Knopf „Jetzt erneut senden“ löst `OFFLINE_QUEUE_EVENT` auf `window` aus; ein `schreibaktionEntfernen` während der Anzeige lässt die Zeile verschwinden; leer → nichts gerendert. Beantragte Zeilen (`antrag != null`) zählen nicht (sie stehen am Ort als „Beantragt“).
- [x] **Step 2:** FAIL.
- [x] **Step 3:** Komponente lädt beim Mount und bei jeder Queue-Änderung neu (Generation gegen veraltete Antworten wie im Drawer); keine Verwerfen-Aktion. Im Drawer vor den abgelehnten Karten; Drawer-Titel bleibt.
- [x] **Step 4:** PASS, Drawer-Tests grün. **Step 5:** Commit `feat(offline): Wiederherstellungsbereich listet, was nicht gesendet ist`.

### Task 6: Vorgemerkte Meldungen in der Liste

**Files:**
- Modify: `frontend/src/pages/MeldungenPage.tsx:141-146,950-960`, `frontend/src/pages/LagemeldungenPage.tsx` (Listenkopf), `frontend/src/einsatz/spiegel/BeantragtListe.tsx` (Kommentar: trägt auch „Nicht gesendet“)
- Test: `frontend/src/pages/MeldungenPage.test.tsx`, `frontend/src/pages/LagemeldungenPage.test.tsx`

- [x] **Step 1: Failing tests:** eine vorgemerkte Meldung (Queue-Zeile `art: 'meldung'`, ohne `antrag`) → Abschnitt `Nicht gesendet` über der Liste mit Absender und Anfang des Wortlauts; eine beantragte Zeile erscheint nur unter `Beantragt`; nach `schreibaktionEntfernen` verschwindet die Zeile; die Kennzahlen der Seite zählen sie nicht. Lagemeldungen: dieselbe Zeile, nur für Meldungen ihrer Art (Kriterium aus `LagemeldungenPage` ablesen: das Feld, das eine Lagemeldung von einer Meldung unterscheidet).
- [x] **Step 2:** FAIL.
- [x] **Step 3:** `useVorgemerkteSchreibaktionen(…, 'meldung')` in beide Teilmengen trennen; zweite `BeantragtListe titel="Nicht gesendet"` mit Text `${absender}: ${inhalt gekürzt}` und `zeit = daten.zeitpunkt_at ?? erstellt_at`.
- [x] **Step 4:** PASS. **Step 5:** Commit `feat(meldungen): vorgemerkte Meldungen stehen als „Nicht gesendet“ über der Liste`.

### Task 7: Regel und Anwenderdoku

**Files:**
- Modify: `frontend/src/offline/AGENTS.md` (Abschnitt „Schreiben ohne Netz“), `docs/anwender/kapitel/ohne-netz.md:24-36`, `docs/anwender/kapitel/einsatz-oberflaeche.md:337`

- [x] **Step 1:** Regelpunkt „Vorgemerkt heißt nicht offline (LLH-1758)“: Grund-Regel, `vorgemerktText` als einziger Wortlaut für Rückmeldungen, Zähler-Regel der Erfassung, Kopf/Betriebszeile als Knopf zum Drawer, Abschnitt „Nicht gesendet“; Herleitung = Spec-Pfad.
- [x] **Step 2:** Anwenderdoku: „WARTET“ → „n NICHT GESENDET“ (antippbar), Serverfehler-Satz, „nicht gesendet“ in Betriebszeile und Erfassung; Bild `etb-ohne-netz.png` bleibt bis zum Bildlauf auf `alpha` (Alt-Text anpassen, wo er „ausstehend“ zitiert).
- [x] **Step 3:** `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [x] **Step 4:** Commit `docs: Regel und Anwenderdoku zu „nicht gesendet“`.
