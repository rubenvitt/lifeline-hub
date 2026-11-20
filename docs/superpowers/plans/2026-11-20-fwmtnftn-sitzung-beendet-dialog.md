# Sitzung beendet als Dialog über der Seite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine 401 im laufenden Betrieb baut die Seite nicht mehr ab, sondern legt eine
Anmeldung als Dialog über die verdeckte Seite; dieselbe Person arbeitet danach mit ihren
Eingaben weiter (LLH-1770).

**Architecture:** Neuer Zwischenzustand `unterbrechung` im `AuthProvider`: der Benutzer bleibt
gesetzt (die Seite bleibt montiert), die Platte wird sofort geräumt, Leseanfragen warten an
einer Sitzungssperre statt zu scheitern. Ein nicht schließbarer Dialog trägt die aus der
`LoginPage` gezogene Anmeldekomponente. Die Anmeldewege des `AuthProvider` entscheiden selbst:
gleiche Person → auflösen, andere Person → Seite neu laden.

**Tech Stack:** React 19, TypeScript, TanStack Query v5, antd, Vitest + MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-fwmtnftn-sitzung-beendet-dialog-design.md`

## Global Constraints

- Frist: `UNTERBRECHUNG_FRIST_MS = 15 * 60_000` ab Eintritt.
- Dialogkopf wörtlich: „Sitzung beendet“.
- Dialogtext wörtlich: „Melde dich erneut an. Deine Eingaben auf dieser Seite bleiben erhalten.“
- SSO-Hinweis wörtlich: „Verlässt die Seite, Eingaben auf dieser Seite gehen verloren“.
- Restlaufzeit wörtlich: „Ohne Anmeldung wird diese Seite in {n} min geschlossen“ (`n` aufgerundet,
  mindestens 1).
- Hinweis der Anmeldeseite wörtlich: „Sitzung beendet – bitte erneut anmelden“; ausgelöst über
  `location.state.grund === 'sitzung-beendet'`.
- Abdeckung undurchsichtig (Flächenfarbe aus `theme/tokens`), über jedem antd-Overlay der Seite.
- Gilt nur für Personen; gekoppeltes Gerät, kein Benutzer, angekündigtes Abmelden, 401 auf das
  erste `/me` beim Start: heutiger Weg unverändert.
- Benutzerwechsel nie im laufenden Baum (LFH-387): andere Person → `seiteNeuLaden(aktuelle URL)`.
- Bezeichner: Fachbegriffe deutsch, Technik englisch (LLH-1312); Prosa deutsch.
- Prettier über `frontend/`; Gate `./scripts/check-all.sh --geaendert --ohne-e2e`.

## Review Focus

1. 401 bei offenem antd-Dialog („Auftrag erteilen“): Abdeckung liegt darüber, Fokus bleibt im
   Sitzungsdialog, der Auftrag-Dialog behält seine Werte → Test in Task 7 (z-index/`zIndex`-Prop
   größer als der antd-Modal-Standard 1000, Fokus im Dialog).
2. Mehrere gleichzeitige 401 (Seite mit fünf Abfragen): genau eine Unterbrechung, jede Abfrage
   wartet und läuft nach der Auflösung genau einmal neu → Test in Task 2.
3. Eine Abfrage, die nach der Auflösung wieder 401 bekommt (Anmeldung sofort wieder beendet):
   kein endloses Warten-Wiederholen → Test in Task 2 (höchstens ein Wiederholversuch je Anfrage).
4. Andere Person meldet sich im Dialog an: B wird nie im laufenden Baum übernommen, kein
   Lagebild von B gespeichert, Seite lädt neu → Test in Task 4.
5. Frist läuft ab, während der Tab verdeckt war: beim nächsten Tick sofort voller Ausgang, keine
   negative Restzeit → Test in Task 7 (Restzeit aus `seit` berechnet, nicht hochgezählt).

---

### Task 1: Sitzungssperre und Signal „wiederhergestellt“

**Files:**
- Create: `frontend/src/auth/sitzungsSperre.ts`, `frontend/src/auth/sitzungsSperre.test.ts`
- Modify: `frontend/src/auth/sitzungsEvent.ts`

**Interfaces:**
- Produces:
  - `sitzungSperren(): void` — idempotent; legt ein offenes Versprechen an.
  - `sitzungEntsperren(ergebnis: 'wiederhergestellt' | 'beendet'): void` — löst das Versprechen
    mit `true` bzw. `false`, danach keine Sperre.
  - `warteAufSitzung(): Promise<boolean> | null` — `null` ohne Sperre.
  - `istSitzungGesperrt(): boolean`
  - in `sitzungsEvent.ts`: `SITZUNG_WIEDERHERGESTELLT = 'lfh:sitzung-wiederhergestellt'`,
    `meldeSitzungWiederhergestellt(): void` (Fensterereignis, ohne Sperre).

- [ ] **Step 1: Failing tests** — `sitzungsSperre.test.ts`: ohne Sperre `warteAufSitzung()` ist
  `null`; nach `sitzungSperren()` zweimal liefert `warteAufSitzung()` dasselbe Versprechen;
  `sitzungEntsperren('wiederhergestellt')` → `true`, `'beendet'` → `false`; danach
  `istSitzungGesperrt()` `false`; `meldeSitzungWiederhergestellt()` feuert
  `SITZUNG_WIEDERHERGESTELLT` genau einmal je Aufruf.
- [ ] **Step 2:** `cd frontend && mise exec -- pnpm exec vitest run src/auth/sitzungsSperre.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren (Modulzustand, kein React).
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** Commit `feat(auth): Sitzungssperre und Signal „Sitzung wiederhergestellt“`.

### Task 2: Leseanfragen warten an der Sperre

**Files:**
- Modify: `frontend/src/api/client.ts` (`apiGet`)
- Test: `frontend/src/api/client.sitzungsSperre.test.ts` (neu)

**Interfaces:**
- Consumes: Task 1 (`warteAufSitzung`, `meldeSitzungAbgelaufen`).
- Produces: `apiGet` wirft bei 401 auf einen anderen Pfad als `/api/auth/me` nur noch, wenn
  keine Sperre entsteht oder die Sperre mit `beendet` endet.

Ablauf in `apiGet`: vor dem Abruf eine bestehende Sperre abwarten (`false` → `ApiError(401)`
werfen). Antwort 401 (nicht `ME_PFAD`) im **ersten** Versuch: `meldeSitzungAbgelaufen()`
synchron rufen (die Wache setzt darüber synchron die Sperre), dann `warteAufSitzung()`; `true` →
genau ein Wiederholversuch, `null`/`false` → wie heute werfen. Der Wiederholversuch wirft eine
401 wie heute.

- [ ] **Step 1: Failing tests** (MSW, Sperre im Test per `window`-Listener auf
  `SITZUNG_ABGELAUFEN` gesetzt, `sitzungsMeldungZuruecksetzen()` im `afterEach`):
  - `wartet bei 401 auf die Anmeldung und wiederholt einmal` — erste Antwort 401, nach
    `sitzungEntsperren('wiederhergestellt')` 200 → Promise löst mit den Daten.
  - `wirft 401, wenn die Unterbrechung mit Abmelden endet` — `sitzungEntsperren('beendet')` →
    `ApiError` mit `status 401`.
  - `ohne Sperre wirft 401 wie bisher` — kein Listener → `ApiError 401`.
  - `fünf gleichzeitige Abrufe: ein Ereignis, jeder wiederholt genau einmal` — Zähler je Pfad = 2.
  - `401 nach der Wiederherstellung wird nicht erneut abgewartet` — zweite Antwort auch 401 →
    wirft, Server sah genau 2 Anfragen.
  - `/api/auth/me wartet nie`.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** vitest für `src/api/` → PASS (bestehende `client`-Tests unverändert grün).
- [ ] **Step 5:** Commit `feat(api): Leseanfragen warten bei Sitzungsende auf die Neuanmeldung`.

### Task 3: Platte räumen, Tab-Speicher behalten

**Files:**
- Modify: `frontend/src/offline/geraetRaeumung.ts`, `frontend/src/offline/lagebildSitzung.ts`
- Test: `frontend/src/offline/geraetRaeumung.test.ts` (bestehend erweitern; falls keiner, neu),
  `frontend/src/offline/lagebildSitzung.test.ts` (bestehend erweitern)

**Interfaces:**
- Produces:
  - `geraetPlatteRaeumen(): Promise<void>` — nur die Orte in IndexedDB/`localStorage` der
    Entscheidung `jeder-ausgang`: `personErfassungsQuittungen`, `ortCache`,
    `verpflegungsstelle`, `startlisteAusgeblendet`, `stammdatenfeldZuletzt`,
    `queueZaehlerMerker`. Wirft nie.
  - `geraetRaeumen(anlass)` ruft `geraetPlatteRaeumen` plus die Tab-Orte (unverändertes Verhalten).
  - `lagebildUnterbrechen(qc: QueryClient): Promise<void>` — in der `reihe`: Persister beenden
    (`beenden`), `lagebildLoeschenPlatte()`, **ohne** `qc.clear()`.

- [ ] **Step 1: Failing tests:**
  - `geraetPlatteRaeumen lässt sessionStorage und verlaufInhalt stehen` — vorher
    `lfh:erfassung:1:m:f`, `lfh:alarm:ausgeblendet`, `lfh:liste:x:1`, `verlaufInhalt` und
    `localStorage lfh:queue-zaehler` setzen; danach nur der `localStorage`-Schlüssel weg.
  - `geraetRaeumen('sitzungsende') räumt weiter beides` (bestehender Test bleibt grün).
  - `lagebildUnterbrechen löscht die Platte und behält den Query-Cache` — nach
    `lagebildAnmelden` + gesetzter Query: `lagebildLesen()` `undefined`, `qc.getQueryData` noch da;
    eine spätere Cache-Änderung schreibt nichts auf die Platte.
  - `lagebildAnmelden derselben Person nach der Unterbrechung legt neu an und speichert wieder`.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** vitest `src/offline/` → PASS, inkl. `geraetRaeumung.guard.test.ts`.
- [ ] **Step 5:** Commit `feat(offline): Platte räumen ohne den Speicher des Tabs`.

### Task 4: Unterbrechung im `AuthProvider`

**Files:**
- Modify: `frontend/src/auth/AuthContext.tsx`
- Test: `frontend/src/auth/AuthContext.unterbrechung.test.tsx` (neu, Muster wie
  `AuthContext.pruefen.test.tsx`: nacktes `render`, MSW für `/me`, `/login`, `/logout`)

**Interfaces:**
- Consumes: Task 1, Task 3, `seiteNeuLaden` (`auth/seiteNeuLaden.ts`), `pushAbgleichen`.
- Produces (in `AuthWert`):
  - `unterbrechung: SitzungsUnterbrechung | null` mit
    `interface SitzungsUnterbrechung { bisher: MeAntwort; seit: number }` (exportiert).
  - `unterbrechen(): boolean` — `false` (nichts getan), wenn kein Benutzer, Gerät
    (`benutzer.geraet != null`) oder schon unterbrochen. Sonst synchron: Zustand setzen,
    `sitzungSperren()`; dann ohne Abwarten `lagebildUnterbrechen(qc)` und `geraetPlatteRaeumen()`.
  - `unterbrechungBeenden(): Promise<void>` — `sitzungEntsperren('beendet')`, Zustand `null`,
    `abmeldenLokal('sitzungsende')`.
  - `UNTERBRECHUNG_FRIST_MS` exportiert (Konstante, Global Constraints).

Änderungen am Bestand:
- `angemeldet(antwort)` und `aktualisiere()`: steht eine Unterbrechung und ist
  `antwort.id !== bisher.id` → `meldeAuthWechsel({ art: 'angemeldet' })`,
  `seiteNeuLaden(location.pathname + search + hash)` und **nichts** übernehmen (kein
  `vorhaltungAnmelden`). Gleiche id → `aufloesen(antwort)`.
- `aufloesen(b)` (intern): `vorhaltungAnmelden(b)`, `uebernimm(b)`, Zustand `null`,
  `sitzungsMeldungZuruecksetzen()`, `sitzungEntsperren('wiederhergestellt')`,
  `meldeSitzungWiederhergestellt()`, `queryClient.invalidateQueries()`,
  `void pushAbgleichen(b.id, { nurBeiBedarf: true })`, `meldeAuthWechsel({ art: 'angemeldet' })`.
- `pruefe`, 401-Zweig: angekündigtes Abmelden → wie heute; sonst nur `meldeSitzungAbgelaufen()`
  (die Wache entscheidet, Task 5). Ok-Zweig mit lokalem Benutzer und Unterbrechung: gleiche id →
  `aufloesen`; andere id → Zustand `null` **ohne Räumen**, `sitzungEntsperren('beendet')`,
  `setKonflikt(...)`.
- `abmeldenLokal` setzt eine stehende Unterbrechung auf `null` und entsperrt mit `beendet`.

- [ ] **Step 1: Failing tests** (je ein `it`, deutsch als Satz):
  - `401 im Betrieb unterbricht: Benutzer bleibt, Platte leer, Query-Cache bleibt`.
  - `Gerät wird nicht unterbrochen` (`unterbrechen()` → `false`).
  - `Anmeldung derselben Person löst auf ohne Neuladen` — `login('anna', …)` → `unterbrechung`
    `null`, `benutzer.id` 1, `seiteNeuLaden` nicht gerufen, `SITZUNG_WIEDERHERGESTELLT` gefeuert,
    Sperre gelöst mit `true`.
  - `Anmeldung einer anderen Person lädt neu und übernimmt nicht` — `seiteNeuLaden` mit der
    aktuellen URL, `benutzer.id` bleibt 1, `lagebildLesen()` bleibt `undefined`.
  - `Passkey-Weg (aktualisiere) verhält sich gleich` (gleiche und andere Person).
  - `Anmeldung derselben Person in einem anderen Tab löst über die Prüfung auf`.
  - `Andere Person in einem anderen Tab: Konflikt, Unterbrechung endet ohne Räumen`.
  - `angekündigtes Abmelden in einem anderen Tab räumt wie bisher`.
  - `unterbrechungBeenden meldet lokal ab und entsperrt mit beendet`.
  - `Push wird nach der Auflösung abgeglichen` (`pushAbgleichen` gemockt).
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Implementieren.
- [ ] **Step 4:** vitest `src/auth/` → PASS; bestehende `AuthContext*.test.tsx` angepasst, wo sie
  das alte 401-Verhalten im Betrieb festhalten (nur diese Erwartungen ändern, nicht die übrigen).
- [ ] **Step 5:** Commit `feat(auth): Sitzungsende im Betrieb unterbricht statt abzumelden`.

### Task 5: Sitzungswache, Offline-Abgleich

**Files:**
- Modify: `frontend/src/auth/useSitzungsWache.ts`, `frontend/src/App.tsx` (`BetriebsLayout`),
  `frontend/src/offline/useOfflineSync.ts` (`abgleichFuer`)
- Test: `frontend/src/auth/useSitzungsWache.test.tsx`, `useOfflineSync`-Test zu `abgleichFuer`

**Interfaces:**
- Consumes: `unterbrechen()` aus Task 4.
- Produces: `abgleichFuer(benutzer, ruht: boolean)` — Parameter umbenannt von `konflikt`;
  Aufruf `abgleichFuer(benutzer, konflikt !== null || unterbrechung !== null)`.

`beiAblauf`: Gerät → wie heute; sonst `if (unterbrechen()) return;`; sonst wie heute
(`abmeldenLokal('sitzungsende')`, `/login` mit `von`).

- [ ] **Step 1: Failing tests:** `Ablauf mit Benutzer unterbricht und navigiert nicht`;
  `Ablauf ohne Benutzer führt wie bisher zur Anmeldung`; `Gerät führt wie bisher zu Kopplung
  beendet`; `abgleichFuer ruht während der Unterbrechung`.
- [ ] **Step 2:** vitest → FAIL. **Step 3:** implementieren. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(auth): Sitzungswache unterbricht statt umzuleiten`.

### Task 6: Live-Ströme nach der Wiederherstellung

**Files:**
- Modify: `frontend/src/live/liveVerbindung.ts` (`probeUndReconnect`)
- Test: `frontend/src/live/liveVerbindung.test.ts` (bestehend erweitern)

**Interfaces:**
- Consumes: `SITZUNG_WIEDERHERGESTELLT` (Task 1).

Nach `meldeSitzungAbgelaufen()` im Zweig `!sessionGueltig`: einmalig auf
`SITZUNG_WIEDERHERGESTELLT` hören; dann (sofern nicht `abgebrochen`) `verbinde()` mit
`backoffStufe = 0`. Das Abräumen der Verbindung entfernt den Listener.

- [ ] **Step 1: Failing tests:** `nach 401 und Wiederherstellung baut die Verbindung neu auf und
  gleicht ab` (`beiWiederaufbau` gerufen); `abgeräumte Verbindung reagiert nicht mehr`.
- [ ] **Step 2–4:** FAIL → implementieren → PASS.
- [ ] **Step 5:** Commit `feat(live): Ströme nach wiederhergestellter Sitzung neu aufbauen`.

### Task 7: Anmeldekomponente ziehen, Dialog bauen, Anmeldeseite nennt den Grund

**Files:**
- Create: `frontend/src/auth/AnmeldeFormular.tsx` (Stufen, Zustand und Handler aus
  `pages/LoginPage.tsx`), `frontend/src/auth/SitzungBeendetDialog.tsx`,
  `frontend/src/auth/SitzungBeendetDialog.test.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx` (Rahmen, Titel, Grund-Hinweis, nutzt
  `AnmeldeFormular`), `frontend/src/App.tsx` (`SitzungsLayout`: Dialog neben
  `BenutzerKonfliktDialog`), `frontend/src/pages/LoginPage.test.tsx` (Grund-Hinweis)

**Interfaces:**
- Consumes: Task 4 (`unterbrechung`, `unterbrechungBeenden`, `UNTERBRECHUNG_FRIST_MS`).
- Produces:
  ```ts
  interface AnmeldeFormularProps {
    zielPfad: string;               // Rückweg für SSO (`von`)
    onAngemeldet: () => void;       // Seite: navigate(zielPfad); Dialog: nichts
    benutzernameVorgabe?: string;
    ssoHinweis?: string;
    mitDevBenutzern?: boolean;      // nur Seite
    mitAnonymUebernahme?: boolean;  // „anonym → angemeldet aus anderem Tab“, nur Seite
  }
  export default function SitzungBeendetDialog(): JSX.Element | null
  ```
  Das Formular trägt alle Wege der Seite (Passwort, Zweitfaktor/Recovery, Passwort festlegen,
  Passkey, „Im Browser anmelden“, SSO, OIDC-Fehler aus `?fehler=oidc` nur auf der Seite). Es
  ruft `login`/`aktualisiere`/`passwortFestlegen` des Providers und danach `onAngemeldet`.

Dialog: antd `Modal` `open` nur bei `unterbrechung`, `closable={false}`, `keyboard={false}`,
`mask={{ closable: false }}`, `zIndex` über 1000, Maske mit undurchsichtiger Flächenfarbe; Kopf,
Text und Restlaufzeit wörtlich (Global Constraints). Restzeit je Sekunde aus
`unterbrechung.seit + UNTERBRECHUNG_FRIST_MS - Date.now()`; ≤ 0 oder Klick „Abmelden“ →
`await unterbrechungBeenden()`, dann `navigate('/login', { replace: true, state: { von, grund:
'sitzung-beendet' } })`. Benutzername vorbelegt mit `bisher.benutzername`. Bei gekoppeltem Gerät
nie sichtbar (die Wache unterbricht es nicht).

- [ ] **Step 1:** `LoginPage`-Tests laufen lassen (Ausgangslage grün).
- [ ] **Step 2:** `AnmeldeFormular` ziehen, `LoginPage` darauf umstellen; `LoginPage`-Tests →
  PASS ohne Änderung ihrer Erwartungen. Commit `refactor(auth): Anmeldeformular aus der
  Anmeldeseite ziehen`.
- [ ] **Step 3: Failing tests** `SitzungBeendetDialog.test.tsx`:
  - `zeigt Kopf, Text und vorbelegten Benutzernamen bei Unterbrechung`.
  - `lässt sich weder mit Escape noch per Maske schließen`.
  - `liegt über einem offenen Dialog der Seite und behält dessen Eingabe` — Seite rendert ein
    `Modal` mit `Input` (Wert „Wasserschaden Keller“); nach Unterbrechung und Anmeldung derselben
    Person steht der Wert noch im Input.
  - `Restzeit: 15 min zu Beginn, bei abgelaufener Frist voller Ausgang zur Anmeldeseite mit Grund`
    (`vi.useFakeTimers`, `seit` 16 min zurück → sofort Ausgang).
  - `„Abmelden“ führt zur Anmeldeseite mit Grund`.
  - `SSO-Knopf zeigt den Hinweis`.
  - `LoginPage.test.tsx`: `nennt den Grund nach Sitzungsende`.
- [ ] **Step 4:** FAIL → Dialog bauen, in `SitzungsLayout` einhängen, Hinweis auf der
  Anmeldeseite → PASS.
- [ ] **Step 5:** Commit `feat(auth): Anmeldung als Dialog über der Seite nach Sitzungsende`.

### Task 8: Regeln und e2e

**Files:**
- Modify: `frontend/src/auth/AGENTS.md`, `frontend/src/offline/AGENTS.md`; Kommentare in
  `AuthContext.tsx` und `RequireAuth.tsx`, die das alte 401-Verhalten beschreiben
- Create: `frontend/e2e/sitzung-beendet-dialog.spec.ts`
- Modify (nur wo sie das alte Verhalten festhalten): `frontend/e2e/sitzung-beenden.spec.ts`,
  `frontend/e2e/sitzung-mehrere-tabs.spec.ts`, `frontend/e2e/lagebild-offline.spec.ts`
- Prüfen: `docs/anwender/` nach Beschreibungen des Sitzungsendes (`grep -ri "sitzung"`); wo eine
  steht, nachziehen (Mitänderungsregel `docs/anwender/AGENTS.md`).

- [ ] **Step 1:** `auth/AGENTS.md`: neuer Abschnitt „Sitzung beendet im Betrieb (LLH-1770)“ mit
  Unterbrechung, Auflösungstabelle (Kurzform), Frist 15 min, undurchsichtige Abdeckung,
  Lesesperre; den Satz zur Sitzungswache anpassen. `offline/AGENTS.md`: 401 im Betrieb → Platte
  sofort, Speicher und `sessionStorage` mit der Frist. Verweis auf das Design-Doc.
- [ ] **Step 2:** e2e `Meldung bleibt nach erneuter Anmeldung erhalten`: anmelden, Meldungen
  öffnen, Formular ausfüllen, Sitzung über `context.clearCookies()` beenden, eine Leseanfrage
  auslösen (Seite fokussieren/Abfrage invalidieren), Dialog „Sitzung beendet“ sichtbar, mit
  demselben Benutzer anmelden, Text im Formular unverändert, Senden legt die Meldung an.
- [ ] **Step 3:** betroffene e2e-Specs anpassen; Lauf soweit in der Umgebung möglich
  (`mise exec -- pnpm exec playwright test e2e/sitzung-*.spec.ts --trace off`), sonst im PR
  benennen.
- [ ] **Step 4:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün.
- [ ] **Step 5:** Commit `docs: Regeln zum Sitzungsende im Betrieb` und
  `test(e2e): Sitzung beendet als Dialog`.
