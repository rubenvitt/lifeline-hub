# Erfassungsmuster, Sendeverb, Enter-Vertrag, Pflichtfehler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Zunder: https://zunder.rubeen.dev/#/aufgabe/bn81riye7chdw1gjh5665ga1 (LLH-1766)

**Goal:** Ein Sendeverb, ein Enter-Vertrag und eine Pflichtfehler-Form „‹Feld› fehlt“ in allen
Erfassungen, festgeschrieben in `frontend/AGENTS.md` und im Design System, gehalten von zwei
Wächtern.

**Architecture:** Zwei kleine Helfer (`components/pflichtRegel.ts`, `components/enterVertrag.ts`),
ein globaler antd-Standardtext im `ConfigProvider`, dann mechanisches Nachziehen des Bestands
(Textliterale, Regelzeilen), zuletzt zwei Wächter nach dem Muster von `anredeText.guard.test.ts`
(`import.meta.glob` über die Quellen). Keine Oberfläche wird umgebaut.

**Tech Stack:** React 19, TypeScript, antd 5 (`Form`, `Mentions`), Vitest, Playwright (e2e,
Bildlauf), pnpm über `mise exec`.

**Spec:** `docs/superpowers/specs/2026-11-20-bn81riye-erfassung-verb-enter-design.md`

## Global Constraints

- Pflichtfehler genau „‹Feld› fehlt“: Hauptwort des sichtbaren Labels, ohne Artikel, ohne „Bitte“,
  ohne Anrede, ohne Zusätze wie „(optional)“.
- Sendeverb nach R2 der Spec; „Erfassen“ ohne Objekt; Bearbeiten bleibt „Speichern“.
- Enter-Vertrag nach R3 der Spec (Tabelle); `etb/Schnellerfassung.tsx` wird **nicht** geändert.
- UI-Texte ohne Anrede (`anredeText.guard.test.ts`), Prosa deutsch, neue Bezeichner nach LFH-1312.
- Kein Gate-Kommando mit `| tail`; Node/pnpm nur über `mise exec --` aus dem Repo.
- Commit-Body trägt `Zunder: https://zunder.rubeen.dev/#/aufgabe/bn81riye7chdw1gjh5665ga1`.

## Review Focus

1. **JSX-Label:** Ein Pflichtfeld mit `FeldLabel`/JSX-Label zeigt „Inhalt fehlt“, nie den
   technischen Namen („inhalt fehlt“). Test in Task 1 (globaler Text mit Text-Label) und Task 2
   (eine Stelle mit JSX-Label, `meldungen/MeldungFormular`).
2. **Nur Leerzeichen:** Wo heute `whitespace: true` steht, lehnt die Regel „   “ weiter ab. Test in
   Task 1.
3. **Chat, Vorschlagsliste offen:** Enter übernimmt den Vorschlag und sendet nicht, auf jedem
   Zeiger. Bestehender Test bleibt grün (Task 4).
4. **Chat am Desktop:** Enter sendet, Umschalt+Enter bricht um, unverändert. Test in Task 4.
5. **Doppelter Dialog:** Stammdaten-Dialoge zeigen beim Bearbeiten weiter „Speichern“, beim
   Anlegen „Anlegen“. Test in Task 5 (Fahrzeug).

---

### Task 1: Pflichtregel-Helfer und globaler Standardtext

**Files:**
- Create: `frontend/src/components/pflichtRegel.ts`
- Create: `frontend/src/components/pflichtRegel.test.tsx`
- Modify: `frontend/src/theme/ThemeModeProvider.tsx` (`ConfigProvider`, Prop `form`)

**Interfaces:**
- Produces: `pflicht(feld: string, optionen?: { whitespace?: boolean }): RuleObject`
  (antd `RuleObject` aus `antd/es/form`), Ergebnis
  `{ required: true, message: \`${feld} fehlt\`, ...(whitespace ? { whitespace: true } : {}) }`.
- Produces: Konstante `PFLICHT_STANDARD = '${label} fehlt'` (in `pflichtRegel.ts`, exportiert).

- [ ] **Step 1: Failing tests** in `pflichtRegel.test.tsx`:
  - `pflicht('Absender')` gleicht `{ required: true, message: 'Absender fehlt' }`.
  - `pflicht('Name', { whitespace: true })` hat `whitespace: true`.
  - Ein `<Form>` mit `Form.Item label="Ort" rules={[pflicht('Ort', { whitespace: true })]}` zeigt
    nach Eingabe „   “ und `form.validateFields()` den Text „Ort fehlt“.
  - Unter `ThemeModeProvider` zeigt ein `Form.Item label="Titel" rules={[{ required: true }]}`
    nach dem Absenden „Titel fehlt“ (nicht „Bitte geben Sie Titel an“).
- [ ] **Step 2:** `mise exec -- pnpm -C frontend vitest run src/components/pflichtRegel.test.tsx` → FAIL.
- [ ] **Step 3:** Helfer schreiben; im `ConfigProvider` `form={{ validateMessages: { required: PFLICHT_STANDARD } }}` mit Kommentar auf `frontend/AGENTS.md`, „Erfassungs-Norm“.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5:** Commit `feat(erfassung): Pflichtregel-Helfer und Standardtext „‹Feld› fehlt“`.

### Task 2: Bestand auf `pflicht()` umstellen

**Files:** jede Quelldatei unter `frontend/src` mit `required: true` (rund 205 Regeln in 120
Dateien; Liste: `grep -rlE "required:\s*true" frontend/src --include=*.ts --include=*.tsx | grep -v '\.test\.'`),
dazu jede Test- und e2e-Datei, die einen alten Pflichtfehler prüft.

**Interfaces:** Consumes `pflicht` aus Task 1.

- [ ] **Step 1:** Je Regel `{ required: true, message: '…' }` bzw. nacktes `{ required: true }` →
  `pflicht('‹Feld›')`, `whitespace: true` als Option übernehmen. Feldname = Hauptwort des Labels
  (bei „Bitte eine Sichtungskategorie wählen“ → `pflicht('Sichtungskategorie')`). Eine bedingte
  Pflicht (`required: ausdruck`) bleibt eine eigene Regel und bekommt
  `message: \`‹Feld› fehlt\`` von Hand. Objekte, die keine antd-Regel sind (andere
  `required`-Felder), unverändert lassen und für Task 3 notieren.
- [ ] **Step 2:** Tests und e2e mit alten Texten nachziehen
  (`grep -rnE "ist erforderlich|ist Pflicht|darf nicht leer sein|Bitte (eine?n? )?\\w+ (angeben|eingeben|wählen|eintragen)|erforderlich'|fehlt'" frontend/src frontend/e2e`).
  Eine Stelle mit JSX-Label bekommt einen Test (Review Focus 1): `MeldungFormular` ohne Inhalt
  zeigt „Inhalt fehlt“.
- [ ] **Step 3:** `mise exec -- pnpm -C frontend vitest run` → PASS; `mise exec -- pnpm -C frontend exec tsc -b` → ohne Fehler.
- [ ] **Step 4:** Commit `refactor(erfassung): Pflichtregeln über pflicht() mit „‹Feld› fehlt“`.

### Task 3: Wächter Pflichtregel

**Files:**
- Create: `frontend/src/components/pflichtRegel.guard.test.ts`

- [ ] **Step 1:** Wächter nach Muster `anredeText.guard.test.ts` (Kopfkommentar „sieht / sieht
  nicht“). Quellen ohne Tests, ohne `pflichtRegel.ts`. Verstoß: (a) `required:\s*true` in einer
  Quelle außer `pflichtRegel.ts` und bewerteten `AUSNAHMEN` (Pfad → Grund, aus Task 2, Schritt 1);
  (b) in einer Zeichenkette die Formen `ist erforderlich`, `ist Pflicht`, `darf nicht leer sein`,
  oder `^Bitte .*(angeben|eingeben|wählen|eintragen)$` innerhalb eines `message:`.
- [ ] **Step 2:** Gegenprobe: ein Testfall mit einer Beispielquelle als String liefert je Form einen
  Treffer (Funktion `pflichtVerstoesse(inhalt: string): string[]` exportieren und direkt testen).
- [ ] **Step 3:** `vitest run src/components/pflichtRegel.guard.test.ts` → PASS auf dem Bestand.
- [ ] **Step 4:** Commit `test(erfassung): Wächter für Pflichtfehler „‹Feld› fehlt“`.

### Task 4: Enter-Vertrag als Helfer, Chat auf Touch

**Files:**
- Create: `frontend/src/components/enterVertrag.ts`, `frontend/src/components/enterVertrag.test.ts`
- Modify: `frontend/src/chat/NachrichtEingabe.tsx` (`onPressEnter`), Test `chat/NachrichtEingabe.test.tsx`
- Modify: `frontend/src/components/SchnellAnlegen.tsx` (`enterKeyHint="send"`),
  `frontend/src/infotelefon/AnrufErfassung.tsx` (Hauptfeld `enterKeyHint="send"`)

**Interfaces:**
- Produces:
  ```ts
  export type EnterKontext = { mehrzeilig: boolean; inZeile: boolean; istBeruehrung: boolean };
  export type EnterTaste = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'repeat'> & { isComposing?: boolean };
  export function isSendeTaste(e: EnterTaste, k: EnterKontext): boolean;
  export function enterKeyHintFuer(k: EnterKontext): 'send' | 'enter';
  ```
  Regel: kein Enter, `repeat`, `altKey` oder `isComposing` → false; Strg/⌘ → true; Umschalt →
  false; einzeilig → true; mehrzeilig in der Zeile mit feinem Zeiger → true; sonst false.
  `enterKeyHintFuer`: `'enter'` genau, wenn `isSendeTaste` für ein bloßes Enter false wäre.

- [ ] **Step 1: Failing tests** `enterVertrag.test.ts`: je Zeile der Tabelle R3 der Spec ein Fall
  (einzeilig fein/grob → true; mehrzeilig Dialog → false; mehrzeilig Zeile fein → true, grob →
  false; Strg+Enter überall true; Umschalt+Enter mehrzeilig false; `repeat` false).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementieren. **Step 4:** Run → PASS.
- [ ] **Step 5: Failing tests Chat** in `NachrichtEingabe.test.tsx`: mit `(pointer: coarse)`
  (Muster der vorhandenen `useViewport`-Tests, `matchMedia`-Stub) sendet Enter nicht und der Text
  behält einen Umbruch; der Knopf „Senden“ sendet. Mit feinem Zeiger: Enter sendet, Umschalt+Enter
  sendet nicht (Review Focus 4). Der bestehende Fall „Enter bei offener Auswahl …“ bleibt grün.
- [ ] **Step 6:** `NachrichtEingabe` nutzt `useViewport().istBeruehrung` und
  `isSendeTaste(e, { mehrzeilig: true, inZeile: true, istBeruehrung })`, setzt
  `enterKeyHint={enterKeyHintFuer(...)}`. Run → PASS.
- [ ] **Step 7:** `enterKeyHint="send"` an `SchnellAnlegen` und am Hauptfeld des Infotelefons, je
  ein Assert im vorhandenen Test der Datei.
- [ ] **Step 8:** Commit `feat(erfassung): Enter-Vertrag nach Feldart, Chat bricht auf Touch um`.

### Task 5: Sendeverben nachziehen

**Files:** die Stellen der Tabelle „Zuordnung der heutigen Abweichungen“ in der Spec (R2), dazu
Tests und e2e mit den alten Texten.

- [ ] **Step 1: Failing test** (Review Focus 5): `stammdaten/FahrzeugFormModal` zeigt ohne
  `fahrzeug` den Knopf „Anlegen“, mit `fahrzeug` „Speichern“. Run → FAIL.
- [ ] **Step 2:** Die Stammdaten-Dialoge der Tabelle (Fahrzeug, Personal, Material,
  Einsatz-Vorlage, Sprechgruppe, Externe Stelle, ETB-Baustein, Online-Quelle) auf
  `erfassenText={‹bearbeiten› ? 'Speichern' : 'Anlegen'}`; Fernmelde „Verbindung hinzufügen“ →
  „Anlegen“ (bzw. nach Modus). Run → PASS.
- [ ] **Step 3:** Übrige Zeilen der Tabelle umstellen: Meldung, Lagemeldung, Nachforderung,
  Erinnerung, ETB-Wiedervorlage, Schaden, Programmpunkt, „/person“, Patient Notiz/Verbleib/
  Maßnahme, Zusage, Gerät-Meldung → „Erfassen“; Katalog-Schnellanlage (`knopfText`), Stichworte,
  Planung/Posten/Helfer/Block → „Anlegen“. Ein Komponententest je Stelle mit eigenem `<Button>`
  (Gerät-Meldung, Patient Notiz, „/person“) prüft den Text „Erfassen“.
- [ ] **Step 4:** Tests und e2e mit alten Texten nachziehen (Grep nach jedem alten Text der
  Tabelle in `frontend/src` und `frontend/e2e`); `aria-label`s, die den Knopf mit Objekt nennen,
  dürfen das Objekt behalten, wo zwei Erfassen-Knöpfe auf einer Seite stehen.
- [ ] **Step 5:** `vitest run` → PASS; `tsc -b` → ohne Fehler.
- [ ] **Step 6:** Commit `refactor(erfassung): ein Sendeverb – Erfassen, Anlegen, Fachhandlungen`.

### Task 6: Wächter Sendeverb

**Files:** Create `frontend/src/components/erfassungsVerb.guard.test.ts`

- [ ] **Step 1:** Wächter liest alle Zeichenketten-Literale im Wert von `erfassenText=` und
  `knopfText=` (direkt `"…"`, `{'…'}` oder Literale in einem `{…}`-Ausdruck). Erlaubt:
  `ERLAUBTE_VERBEN` = „Erfassen“, „Anlegen“, „Speichern“, die Fachhandlungen aus R2.3 der Spec und
  die heutigen Aktionsverben an bestehenden Datensätzen (aus dem Bestand gesammelt, gruppiert,
  je Gruppe ein Kommentar). Ein Literal ist erlaubt, wenn es einem Eintrag gleicht oder mit
  „‹Eintrag› “ beginnt („Erfassen als …“, „Anlegen und Code zeigen“). Ausdrücklich verboten,
  auch wenn es beginnt wie ein erlaubter: „Hinzufügen“, „‹Objekt› erfassen“ außer „Berichtigung
  erfassen“, „absetzen“.
- [ ] **Step 2:** Exportierte Funktion `verbVerstoesse(inhalt: string): string[]` mit
  Gegenprobe-Fällen („Meldung erfassen“, „Hinzufügen“ → Treffer; „Erfassen“, „Anlegen und Code
  zeigen“ → keiner).
- [ ] **Step 3:** Run → PASS auf dem Bestand. **Step 4:** Commit `test(erfassung): Wächter für das Sendeverb`.

### Task 7: Regel festschreiben, Design System

**Files:**
- Modify: `frontend/AGENTS.md` („Erfassungs-Norm“: neuer erster Block R1–R4 mit LLH-1766;
  bestehende Enter-Punkte verweisen darauf; „Bausteinwahl“-Zeilen „Anlegen“ und
  „Serienerfassung neben einer Liste“; „Ort von Bearbeiten und Form des Anlegens“ verweist auf R1)
- Modify: `frontend/src/etb/AGENTS.md` (ein Satz: Leiste verschärft R3 „mehrzeilig in der Zeile“)
- Modify: `frontend/scripts/design-system/previews.tsx` (Karte „Dialog“: Regeln R2/R3)
- Generated: `docs/design/design-system/project/**`

- [ ] **Step 1:** Texte schreiben; Prettier: `mise exec -- pnpm -C frontend exec prettier --check AGENTS.md src/etb/AGENTS.md`.
- [ ] **Step 2:** `mise exec -- pnpm -C frontend design-system` → Erzeugtes ändert sich nur bei
  „Dialog“ (und README, falls sie den Abschnitt trägt); `vitest run src/designSystem` → PASS.
- [ ] **Step 3:** Commit `docs(erfassung): zwei Muster, ein Verb, ein Enter-Vertrag in Norm und Design System`.

### Task 8: Anwenderdoku

**Files:** Kapitel unter `docs/anwender/kapitel/`, die einen geänderten Knopftext oder
Pflichtfehler nennen; deren Bilder unter `docs/anwender/bilder/`.

- [ ] **Step 1:** `grep -rnE "Meldung erfassen|Lagemeldung erfassen|Nachforderung absetzen|Person erfassen|Notiz anlegen|Meldung senden|Zusage erfassen|ist Pflicht|ist erforderlich" docs/anwender frontend/src/hilfe`
  — jeden Treffer, der den Knopf meint, auf das neue Verb (Menüeinträge und Titel wie „Meldung
  erfassen“ als Einstieg bleiben, wenn sie keinen Sendeknopf meinen).
- [ ] **Step 2:** Bilder der betroffenen Kapitel neu erzeugen, nur wenn ein Bild einen geänderten
  Knopf zeigt (Kopf der Bilder-Spec): `cargo build` im Repo-Wurzelverzeichnis, dann in `frontend/`
  `mise exec -- pnpm doku:bilder e2e/doku-bilder/<kapitel>.bilder.ts`. Geht das in der Sitzung
  nicht (Plattenkontingent, Laufzeit), im PR unter „Geprüft“ benennen und eine Aufgabe anlegen.
- [ ] **Step 3:** Commit `docs(anwender): Sendeverben und Pflichtfehler nachgezogen`.

### Task 9: Gates und Abschluss

- [ ] **Step 1:** `./scripts/check-all.sh --geaendert --ohne-e2e` → grün (ein Aufruf, ggf. im Hintergrund).
- [ ] **Step 2:** e2e-Specs, deren Texte Task 2 und 5 geändert haben, gezielt laufen lassen
  (`mise exec -- pnpm -C frontend exec playwright test <specs> --trace off`), sofern das Backend in
  der Sitzung baut; sonst im PR benennen.
- [ ] **Step 3:** Review nach Ermessen (Anlass: Größe über ~600 Zeilen) — ein Agent mit
  `references/review-pruefliste.md`.
- [ ] **Step 4:** Bilder der Änderung (Chat auf Touch, ein Pflichtfehler, ein Sendeknopf) für PR
  und Meldung; PR gegen `alpha`.
