# Rollen-Vokabular Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Name je Rolle überall im Frontend und je Rolle eine Darf-Zeile in jeder Rollenauswahl (LLH-1818).

**Architecture:** Eine Quelle `frontend/src/einsatz/rollenVokabular.ts` mit `Record`s je Rollenart (`{ name, darf }`); ein Options-Baustein `einsatz/rollenOption.tsx` rendert in der offenen Liste Name + Darf-Zeile, geschlossen nur den Namen. Alle bisherigen Rollentexte leiten sich daraus ab; ein Wächter-Test verbietet alte Literale.

**Tech Stack:** React 19, antd 6 (`Select` mit `optionRender`), Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-19-zlzpieaq-rollen-vokabular-design.md`

Zunder: https://zunder.rubeen.dev/#/aufgabe/zlzpieaqevkovh5k8hi99tkp

## Global Constraints

- Keine Wire-Werte, Spalten, Routen oder gespeicherten Schlüssel umbenennen; kein Backend-Diff.
- Namen: „Einsatzleitung“, „Führungspersonal“, „Beobachter“, „Keine“, „Führungskraft der Organisation“, „System-Admin“, „Frei (alle)“, „Führung im Einsatz“; „System-Admin der Organisation“ statt „Org-Admin“; ohne jede Rolle „Keine Rolle“.
- Feldnamen: „Rolle in der Verwaltung“, „Rolle in der Organisation“, „Rolle im Einsatz“.
- Darf-Texte wörtlich aus dem Spec, Abschnitt „Vokabular“; jeder ≤ 80 Zeichen (Entwurf: „etwa 70“; die freigegebene Zeile der Stufe „Führung im Einsatz“ hat 78 Zeichen, die Grenze ist deshalb 80).
- Geschlossenes Auswahlfeld zeigt nur den Namen.
- Bezeichner: Fachwörter deutsch, Technik englisch (`AGENTS.md`, LFH-1312); Prosa deutsch.
- Node/pnpm nur über `mise exec --`.

## Review Focus

- Gesperrte Option (letzte Einsatzleitung) trägt weiter `disabled`, auch mit Darf-Zeile → Test in Task 3.
- Filter am Spaltenkopf zeigt nur Namen, keine Darf-Zeile → Test in Task 3.
- Leerer Wert der Modulsperre (`''` = frei) zeigt „Frei (alle)“ und `rollenName('')` bleibt `undefined` → Test in Task 4.
- Zugangsprotokoll mit unbekanntem/fehlendem Vorher-Wert bleibt lesbar → bestehender Test in Task 5 umgestellt.
- Schmale Spalte der Modul-Einstellungen wächst nicht (geschlossen nur Name) → Test in Task 2 (gewählter Wert zeigt nur Namen).

---

### Task 1: Vokabular

**Files:**
- Create: `frontend/src/einsatz/rollenVokabular.ts`
- Test: `frontend/src/einsatz/rollenVokabular.test.ts`

**Interfaces:**
- Produces:
  - `interface RollenBegriff { name: string; darf: string }`
  - `EINSATZ_ROLLE: Record<EinsatzRolle, RollenBegriff>`
  - `ORG_ROLLE: Record<OrgRolle, RollenBegriff>`
  - `SYSTEM_ROLLE: Record<SystemRolle, RollenBegriff>`
  - `MODUL_STUFE: Record<BenoetigteRolle | 'frei', RollenBegriff>`
  - `ROLLE_IM_EINSATZ_FELD = 'Rolle im Einsatz'`, `ROLLE_IN_ORG_FELD = 'Rolle in der Organisation'`, `ROLLE_IN_VERWALTUNG_FELD = 'Rolle in der Verwaltung'`
  - `SYSTEM_ADMIN_DER_ORG = 'System-Admin der Organisation'`, `KEINE_ROLLE = 'Keine Rolle'`
  - `kontoRollenNamen(b: { system_rolle: SystemRolle; org_rolle: OrgRolle }): string[]` — Namen der gesetzten Rollen (System-Admin zuerst), sonst `[KEINE_ROLLE]`.

- [x] **Step 1: Test schreiben** — jeder Record: `name` nicht leer, `darf` nicht leer und `≤ 70` Zeichen; Stichproben `EINSATZ_ROLLE.beobachter` = `{ name: 'Beobachter', darf: 'liest nur' }`, `ORG_ROLLE.fuehrungskraft.name` = `'Führungskraft der Organisation'`, `SYSTEM_ROLLE.admin.name` = `'System-Admin'`, `MODUL_STUFE.admin.name` = `'System-Admin'`; `kontoRollenNamen({system_rolle:'admin',org_rolle:'fuehrungskraft'})` = `['System-Admin','Führungskraft der Organisation']`, `kontoRollenNamen({system_rolle:'keiner',org_rolle:'keine'})` = `['Keine Rolle']`.
- [x] **Step 2: Test laufen lassen, schlägt fehl** (`mise exec -- pnpm exec vitest run src/einsatz/rollenVokabular.test.ts`).
- [x] **Step 3: Datei anlegen** mit den Werten aus dem Spec.
- [x] **Step 4: Test grün.**
- [x] **Step 5: Commit** `feat: Rollen-Vokabular als eine Quelle (LLH-1818)`.

### Task 2: Options-Baustein

**Files:**
- Create: `frontend/src/einsatz/rollenOption.tsx`
- Test: `frontend/src/einsatz/rollenOption.test.tsx`

**Interfaces:**
- Consumes: `RollenBegriff` (Task 1).
- Produces:
  - `rollenOptionen<K extends string>(record: Record<K, RollenBegriff>, reihenfolge?: readonly K[]): { value: K; label: string; darf: string }[]`
  - `rollenOptionRender: SelectProps['optionRender']` — Name, darunter `Textstufe stufe="textKlein" ton="gedaempft"` mit `darf`.

- [ ] **Step 1: Test** — ein `Select` mit `rollenOptionen(EINSATZ_ROLLE)` und `rollenOptionRender`, `value="beobachter"`: geschlossen steht „Beobachter“, aber nicht „liest nur“; nach Öffnen stehen „Führungspersonal“ und „schreibt in Modulen, Kopfdaten und Einstellungen“ in der Liste.
- [ ] **Step 2: rot.**
- [ ] **Step 3: implementieren** (Muster `pages/lagekarte/SnapshotLeiste.tsx`, `optionRender={({ data }) => …}`).
- [ ] **Step 4: grün.**
- [ ] **Step 5: Commit.**

### Task 3: Rolle im Einsatz (Reiter Zugriff, Einsatzliste)

**Files:**
- Modify: `frontend/src/einsatz/einsatzRolle.ts` (`EINSATZ_ROLLE_LABELS`/`EINSATZ_ROLLE_OPTIONEN` aus dem Vokabular ableiten)
- Modify: `frontend/src/pages/MitgliederAbschnitt.tsx` (beide Rollen-Selects mit `rollenOptionRender`; Spaltentitel „Rolle“ → `ROLLE_IM_EINSATZ_FELD`, „Rolle · Aktion“ → „Rolle im Einsatz · Aktion“; Filter nur `label`)
- Test: `frontend/src/pages/MitgliederAbschnitt*.test.tsx`, `einsatzRolle.test.ts`

- [ ] **Step 1: Test** — offene Rollenauswahl der Aufnahmezeile zeigt „liest nur“; an der letzten Einsatzleitung bleibt die Option „Beobachter“ `aria-disabled`; Filtermenü des Kopfs enthält „Beobachter“, aber kein „liest nur“; Spaltenkopf „Rolle im Einsatz“.
- [ ] **Step 2: rot. Step 3: umsetzen. Step 4: grün** (bestehende Tests mit Kopf „Rolle“ umstellen).
- [ ] **Step 5: Commit.**

### Task 4: Modulsperre

**Files:**
- Modify: `frontend/src/pages/einstellungen/optionen.ts` (`ROLLEN_OPTIONEN` aus `MODUL_STUFE`, Wert `''` für `frei`, mit `darf`; `rollenName` unverändert in der Schnittstelle)
- Modify: `frontend/src/pages/einstellungen/ModulEinstellungsListe.tsx` (`optionRender={rollenOptionRender}`)
- Test: bestehende Tests der Modul-Einstellungen / `EinsatzModule.test.tsx`

- [ ] **Step 1: Test** — `rollenName('admin')` = `'System-Admin'`, `rollenName('')` = `undefined`; offene Stufenauswahl zeigt „Einsatzleitung, Führungspersonal, Führungskraft der Organisation, System-Admin“.
- [ ] **Step 2–4: rot, umsetzen, grün** (Tests mit „Admin“ umstellen).
- [ ] **Step 5: Commit.**

### Task 5: Benutzerverwaltung, Profil, Menü, Zugangsprotokoll

**Files:**
- Modify: `frontend/src/stammdaten/rechteText.ts` (`SYSTEM_ROLLE_FELD`/`ORG_ROLLE_FELD`/`…_TEXT` entfernen; Aufrufer nutzen Vokabular)
- Modify: `frontend/src/pages/BenutzerPage.tsx` (Felder mit neuen Namen, Selects über `rollenOptionen` + `rollenOptionRender`, Spalte „Rollen“ über `kontoRollenNamen`)
- Modify: `frontend/src/components/BenutzerMenu.tsx`, `frontend/src/pages/ProfilPage.tsx` (Namen über `kontoRollenNamen`; Menü zeigt keine Marke ohne Rolle wie bisher)
- Modify: `frontend/src/zugangsprotokoll/zugangsprotokollText.ts`
- Test: `BenutzerPage*.test.tsx`, `BenutzerMenu*.test.tsx`, `ProfilPage*.test.tsx`, `zugangsprotokollText.test.ts`, `ZugangsprotokollPage.test.tsx`

- [ ] **Step 1: Test** — `rollenText` liefert `'Rolle in der Verwaltung: Keine, Rolle in der Organisation: Keine'` und `'Rolle in der Organisation: Keine → Führungskraft der Organisation'`; Dialog zeigt Felder „Rolle in der Verwaltung“/„Rolle in der Organisation“ und offen „legt Einsätze an, liest jeden Einsatz der Organisation“; Liste zeigt „System-Admin“/„Führungskraft der Organisation“/„Keine Rolle“.
- [ ] **Step 2–4: rot, umsetzen, grün.**
- [ ] **Step 5: Commit.**

### Task 6: Gründe „Nur Ansicht“

**Files:**
- Modify: `frontend/src/components/nurAnsicht.ts` (Rollen-Gründe aus Vokabular zusammensetzen; „Org-Admin“ → `SYSTEM_ADMIN_DER_ORG`)
- Modify: `frontend/src/stammdaten/rechteText.ts` (`LETZTER_ADMIN` = „letzter aktiver System-Admin“)
- Test: `nurAnsicht.test.ts`, `EinsatzAllgemein.test.tsx`, `EinsatzModule.test.tsx`, Tests mit „letzter aktiver Admin“

- [ ] **Step 1: Test** — `NUR_LEITUNG_ORG_ADMIN` = `'nur Einsatzleitung oder System-Admin der Organisation'`, `NUR_LEITUNG_FUEHRUNG_ORG_ADMIN` = `'nur Einsatzleitung, Führungspersonal oder System-Admin der Organisation'`, `NUR_ADMIN` = `'nur System-Admin'`.
- [ ] **Step 2–4: rot, umsetzen, grün.**
- [ ] **Step 5: Commit.**

### Task 7: Wächter und Regel

**Files:**
- Create: `frontend/src/einsatz/rollenVokabular.guard.test.ts`
- Modify: `frontend/AGENTS.md` („Begriffe“: Regel Rollen-Vokabular; „Texte: zeigen statt erklären“: Ausnahme Darf-Zeile)

- [ ] **Step 1: Wächter** — liest alle `src/**/*.{ts,tsx}` ohne `*.test.*`, `types.generated.ts`, `rollenVokabular.ts`; entfernt Kommentare; Treffer für `System-Rolle`, `Org-Rolle`, `Org-Admin`, `Führungskraft (darf`, sowie `Führungskraft` als ganzer String-/JSX-Text (`['"\`>]Führungskraft['"\`<]`) und `'Admin'`/`"Admin"`/`>Admin<` → Liste muss leer sein.
- [ ] **Step 2: Probe** — vorübergehend `'Org-Rolle'` in eine Datei schreiben, Wächter rot, zurücknehmen.
- [ ] **Step 3: Regel** in `frontend/AGENTS.md`; Prettier.
- [ ] **Step 4: Commit.**

### Task 8: Anwenderdoku

**Files:**
- Modify: `docs/anwender/kapitel/rechte-im-einsatz.md`, `benutzer.md`, `einsatz-einstellungen.md` und weitere Kapitel mit „System-Rolle“, „Org-Rolle“, „Org-Admin“ oder Rollenname „Admin“/„Führungskraft“ (`grep`)
- `quellen:` um `frontend/src/einsatz/rollenVokabular.ts` ergänzen, wo die Rollen erklärt werden

- [ ] **Step 1:** Wortlaute angleichen, Darf-Texte in „Was die Rollen dürfen“ und „Rollen“ übernehmen.
- [ ] **Step 2:** Doku-Wächter laut `docs/anwender/AGENTS.md` laufen lassen.
- [ ] **Step 3: Commit.**

### Task 9: Gate

- [ ] `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Ergebnis im PR unter „Geprüft“).
