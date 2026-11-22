# Adapter-Rahmen Teil B (Admin-UI) — Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paneel „Adapter“ auf `/admin/einstellungen/anbindungen`, Ansicht je Adapter (Zustand,
„Verbindung prüfen“, Anhalten/Fortsetzen, Einstellungen, LAN-Ausnahme, Verlauf, Löschen), neuer
Baustein **Geheimfeld** (nur setzen, ersetzen, entfernen; nie ein Wert im Browser-Zustand),
Anwenderkapitel mit Bildern. Kein Backend-Code.

**Architecture:** `api/adapter.ts` spricht `/api/admin/adapter*` (Teil A, `src/routes/adapter.rs`).
Die Liste (`globalKeys.adapter()`) ist die eine Quelle für Paneel und Ansicht wie bei den
Anbindungen; der Verlauf hat einen eigenen Key. Reine Hilfen in
`pages/einstellungen/adapterAnzeige.ts`. Baustein `components/Geheimfeld.tsx` hält den Wert nur in
lokalem State und leert ihn nach jedem Senden.

**Tech Stack:** React 19, antd, TanStack Query, Vitest + Testing Library, Playwright (Bildlauf).

**Spec:** `docs/superpowers/specs/2026-11-21-r19tuh60-adapter-rahmen-design.md`, „Admin-UI (Teil B)“
**Entwurf:** `docs/design/2026-11-22-adapter/` (Canvas https://claude.ai/artifact/P1fQzeMEsjoety4HMiH5jj)
**Zunder:** LLH-2018 (`lwc4r0ookq5it0h56ur98y4j`), Eltern LLH-1632.

## Abgestimmt am 22.11.2026 (Phase-1-Checkpoint)

- Bildlauf und Bilder: die Bilder-Spec bedient `/api/admin/adapter*` per `page.route` mit einer
  erfundenen Art „Beispiel-Alarmquelle“ (Vorbild `wetter-pegel.bilder.ts`). Keine Art im Backend.
- Geheimfeld: „Ersetzen“ (bzw. „Setzen“) und „Entfernen …“ mit roter Rückfrage.
- Ändert „Bearbeiten“ den Host einer URL-Einstellung (oder trägt eine erste ein), fragt die Seite
  vorher: der Server entfernt dann die Geheimnisse.
- Paneel „Letzte Versuche“ wie „Zustellungen“ beim Webhook.

## Global Constraints

- Ein Geheimnis steht nie im Query-Cache, nie in einem antd-`Form`-Store, nie in `localStorage`;
  nach dem Senden (Erfolg oder Fehler) ist der lokale State leer.
- Lesen darf, wer den Admin-Bereich sieht (Führungskraft ohne Einstellungen, ohne Aktionen);
  Schreiben nur `system_rolle === 'admin'`. Gekoppelter ELW (`gesperrt_grund`): alle Schreibwege
  aus, Hinweis „Am Hub anbinden“.
- Paneel „Adapter“ nur sichtbar, wenn `arten` nicht leer oder `adapter` nicht leer.
- Query-Keys über `globalKeys`, in `NICHT_LIVE_GLOBAL_KEYS` begründet; nicht in `LAGEBILD_OFFLINE`.
  Abruf 30 s (`ANBINDUNGEN_ABRUF_MS`). Mutationen `networkMode: 'always'` (sofort oder nie).
- Bausteine aus `components/instrument` (Paneel, Datenraster, BearbeitbaresPaneel, Status,
  Stapel), Seiten-Hinweise aus `components/SpeicherHinweis`, Rückfragen wie in `AnbindungDialoge`.
- Fehlercodes nur über eine Texttabelle (`ADAPTER_FEHLER_TEXT`), exhaustiv über `AdapterFehler`.
- Bezeichner nach Wurzel-`AGENTS.md` (Fachbegriffe deutsch, Technik englisch); Prosa deutsch.
- Prettier über `frontend/` (auch `AGENTS.md`), `pnpm lint --max-warnings 0`.

## Review Focus

- Kein Geheimnis im Cache oder Form-Store (Test liest `queryClient` und DOM nach dem Speichern).
- Rechtezweige: Führungskraft sieht keine Knöpfe, keine Einstellungen; ELW gesperrt.
- Rückfrage bei neuem Ziel greift auch bei erster URL; kein Patch ohne Bestätigung.
- CAS: 409 `veraltet` am BearbeitbarenPaneel wie bei den Anbindungen.

---

### Task 1: API, Typen, Query-Keys, Anzeige-Hilfen

**Files:** Modify `frontend/src/api/types.ts`, `frontend/src/api/queryKeys.ts`,
`frontend/src/api/globalKeys.test.ts`; Create `frontend/src/api/adapter.ts`,
`frontend/src/pages/einstellungen/adapterAnzeige.ts`, `frontend/src/pages/einstellungen/adapterAnzeige.test.ts`

**Interfaces:**
- Typen: `AdapterAnzeige`, `AdapterListe`, `AdapterArtAnzeige`, `AdapterFeld` (= `S['Feld']`),
  `AdapterPlatz` (= `S['Platz']`), `AdapterGeheimnisAnzeige`, `AdapterVersuchAnzeige`,
  `AdapterPruefErgebnis`, `AdapterZustand`, `AdapterFehler`, `GeheimnisspeicherZustand`.
- `api/adapter.ts`: `loadAdapterListe`, `createAdapter(eingabe)`, `updateAdapter(id, patch)`,
  `deleteAdapter(id)`, `setGeheimnis(id, platz, wert)`, `deleteGeheimnis(id, platz)`,
  `checkAdapter(id)`, `haltAdapter(id)`, `resumeAdapter(id)`, `loadAdapterVersuche(id)`;
  `ADAPTER_FEHLER_TEXT`, `adapterFehlerText(art, status?)`, `adapterVersuchText(v)`,
  `SOFORT_ODER_NIE`.
- `globalKeys.adapter()`, `globalKeys.adapterVersuche(id)` (Wire `adapter`, `adapter-versuche`).
- `adapterAnzeige.ts`: `adapterPath(id)`, `adapterZustandAnzeige(a)` → `{wort, ton}`,
  `isZustandSichtbar(z)` (Liste), `uebernimmAdapter(qc, a)`, `entferneAdapter(qc, id)`,
  `hostWechsel(felder, vorher, nachher)` → `{bisher, neu} | null`, `einstellungenVon(felder, werte)`.

- [ ] **Step 1 (rot):** Tests für `adapterZustandAnzeige` (alle sechs Zustände), `isZustandSichtbar`,
  `hostWechsel` (gleicher Host, anderer Host, erste URL, Groß/Klein, ungültige URL, kein URL-Feld),
  `einstellungenVon` (Zahl als Zahl, leere optionale weg), `adapterFehlerText` mit Status;
  `globalKeys`-Wire-Strings.
- [ ] **Step 2:** Umsetzen; Keys in `NICHT_LIVE_GLOBAL_KEYS` mit Begründung.
- [ ] **Step 3:** `vitest run` der berührten Tests grün, `queryKeys.guard.test.ts` grün.

### Task 2: Baustein Geheimfeld

**Files:** Create `frontend/src/components/Geheimfeld.tsx`, `frontend/src/components/Geheimfeld.test.tsx`

**Interfaces:** `Geheimfeld({ platz: AdapterGeheimnisAnzeige, darfSchreiben, gesperrt?: string,
onSetzen(wert): Promise<void>, onEntfernen(): Promise<void>, maxLaenge })`. Zustände wie
`Geheimfeld.dc.html`: nicht gesetzt (Pflicht in Achtung), gesetzt („gesetzt am … von …“), offen
(Passwortfeld `autocomplete="new-password"`, Speichern/Abbrechen, Escape), unlesbar („Neu setzen“),
gesperrt (Knopf aus mit Grund), nur lesen (keine Knöpfe). „Entfernen …“ im ⋯-Menü mit roter
Rückfrage nur bei gesetztem Platz.

- [ ] **Step 1 (rot):** Tests: Anzeige je Zustand; Speichern ruft `onSetzen` mit dem Wert und das
  Feld ist danach weg und leer, auch wenn `onSetzen` wirft (Fehler bleibt sichtbar, Wert nicht);
  Abbrechen und Escape verwerfen; leerer Wert wird nicht gesendet; `maxLength`; Entfernen nur nach
  Bestätigung; gesperrt und nur lesen ohne aktive Knöpfe.
- [ ] **Step 2:** Umsetzen (eigener `useState`, kein `Form`); JSDoc als Quelle der Design-System-README.
- [ ] **Step 3:** Tests grün; Mutationsprobe: Leeren nach Fehler entfernen → Test rot.

### Task 3: Paneel „Adapter“ auf der Seite Anbindungen

**Files:** Create `frontend/src/pages/einstellungen/AdapterPaneel.tsx`,
`frontend/src/pages/einstellungen/AdapterPaneel.test.tsx`; Modify `frontend/src/pages/einstellungen/Anbindungen.tsx`

- [ ] **Step 1 (rot):** Tests: unsichtbar bei leeren Arten und Adaptern; Zeile mit Name, Art,
  Status nur bei gestört/braucht Eingriff/aus/Art unbekannt, „zuletzt erfolgreich …“ bzw. Grund;
  Speicher-Hinweis bei `fehlt`/`passt_nicht`; Anlegen (Art wählen → Felder der Art, Name, Intervall
  mit Vorschlag) sendet die Eingabe und springt in die Ansicht; Führungskraft ohne Anlegen; ELW
  Anlegen gesperrt.
- [ ] **Step 2:** Umsetzen (`Liste`, `ErfassungsModal`), unter `<EinwurfZugaenge />` einhängen.
- [ ] **Step 3:** Tests grün, `Anbindungen.test.tsx` weiter grün.

### Task 4: Ansicht eines Adapters

**Files:** Create `frontend/src/pages/einstellungen/AdapterAnsicht.tsx`,
`frontend/src/pages/einstellungen/AdapterAnsicht.test.tsx`; Modify `frontend/src/App.tsx`
(Route `einstellungen/anbindungen/adapter/:adapterId`)

- [ ] **Step 1 (rot):** Tests: Kopf mit Name, Art, Status; Paneel „Zustand“ (Zustand, zuletzt
  erfolgreich, letzter Fehler, nächster Versuch, angehalten mit Grund); „Verbindung prüfen“ zeigt
  die Ergebniszeile und ändert die Liste nicht; Anhalten/Fortsetzen übernimmt die Antwort;
  Einstellungen bearbeiten (Felder der Art, Name, Intervall ≥ Minimum) mit CAS; neuer Host →
  Rückfrage, ohne Bestätigung kein PATCH; LAN-Schalter mit Rückfrage; Geheimnisse je Platz über
  Geheimfeld (Setzen lädt die Liste neu); Speicher `fehlt` sperrt die Geheimfelder; Verlauf mit
  „Prüfung“; Löschen mit Rückfrage führt zur Liste; nicht gefunden; Führungskraft ohne
  Einstellungen und Knöpfe; ELW gesperrt.
- [ ] **Step 2:** Umsetzen nach `AnbindungAnsicht.tsx` und `Main.dc.html`.
- [ ] **Step 3:** Tests grün; `pnpm typecheck`, `pnpm lint`.

### Task 5: Design System

**Files:** Modify `frontend/scripts/design-system/previews.tsx`; erzeugt `docs/design/design-system/project/…`

- [ ] **Step 1:** Karte `Geheimfeld` (Gruppe Formular) mit den Zuständen nicht gesetzt, gesetzt,
  offen, unlesbar, gesperrt, aus dem echten Baustein; Höhe messen.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend design-system`; Wächter `designSystem.guard.test.ts` grün;
  Erzeugtes mitcommitten.

### Task 6: Anwenderdoku und Bilder

**Files:** Modify `docs/anwender/kapitel/anbindungen.md`; Create
`frontend/e2e/doku-bilder/anbindungen.bilder.ts`, `docs/anwender/bilder/anbindungen/*.png`

- [ ] **Step 1:** Abschnitt „Adapter“: Überblick (erscheint, sobald der Server eine Art kennt),
  Abläufe „Adapter anlegen“, „Geheimnis setzen oder ersetzen“, „Verbindung prüfen“, „Anhalten und
  fortsetzen“, „Ziel im eigenen Netz erlauben“; Zustände und Fehler; Hinweis Geheimnisspeicher;
  gekoppelter ELW. `quellen:` um die neuen Dateien ergänzen.
- [ ] **Step 2:** Bilder-Spec mit `page.route` auf `/api/admin/adapter*` (Liste mit drei Adaptern,
  Ansicht gestört mit Prüfergebnis, Geheimfeld offen); höchstens ein Bild je Ablauf; Lauf
  `mise exec -- pnpm doku:bilder --grep anbindungen` nach `cargo build`.
- [ ] **Step 3:** `vitest run src/hilfe/anwenderdoku.guard.test.ts` grün.

### Task 7: Abschluss

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` grün.
- [ ] **Step 2:** Review nach Ermessen (Anlass: Geheimnisse/Rechte in der UI) als ein Agent.
- [ ] **Step 3:** Bilder der Änderung (`pr-bilder/lwc4r0oo/`), PR gegen `alpha`, Zunder `review`.
- [ ] **Step 4:** Nach dem Merge: Design System neu veröffentlichen (`frontend/AGENTS.md`).
