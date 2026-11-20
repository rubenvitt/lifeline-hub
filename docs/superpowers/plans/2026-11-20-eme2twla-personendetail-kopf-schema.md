# Personendetail: Kopf, Körperschema, Bearbeiten — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Name im Seitentitel des Personendetails, Körperschema rollt ins Bild und zeigt seine
Regionen, „Bearbeiten“ im Patientenkopf hat eine Form.

**Architecture:** Nur Frontend, nur Personendetail. Titel in `pages/PersonenDetailPage.tsx` aus
`nameText`; Anlass/Transport im `personen/Patientenkopf.tsx` als Wertknopf (gesetzt) oder
Wort-Knopf (leer); Umrandung der Zonen in `personen/koerperschema/KoerperFigur.tsx`.

**Tech Stack:** React, antd, Vitest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-20-eme2twla-personendetail-kopf-schema-design.md`

Pfade relativ zu `frontend/src/`, Befehle in `frontend/`.

## Global Constraints

- Breadcrumb und Tab-Titel ohne Namen.
- Keine Änderung an `components/InlineAngabe.tsx`; deren Stile (`wertAngabeStil`, `leerKnopfStil`)
  nur importieren.
- Farben nur aus `koerperschemaFarben` (`theme/tokens.ts`); Umrandung in `kontur`, Wahl/Fokus
  weiter in `bedien`.
- Zugängliche Namen: leer „Anlass festlegen“ / „Transport festlegen“, gesetzt „Anlass bearbeiten“ /
  „Transport bearbeiten“.
- Prosa deutsch, Bezeichner nach `AGENTS.md` „Bezeichner-Sprache“.

## Review Focus

- Person nur mit Vorname (kein Nachname): Titel „, Erika“ wäre falsch → `nameText` liefert dann
  „, Erika“? Prüfen und im Titel so zeigen, wie die Liste es tut (Test in Task 1).
- Stornierte Person / ohne Schreibrecht: Anlass und Transport ohne Stift, nur Lesetext (Task 2).
- Wertknopf darf kein Ziel im Knopf tragen (Transporttext mit `ZeitAnzeige` ist reiner Text) (Task 2).
- Paneel „Verletzung markieren“ auf Handy-Breite: Rollen trifft das Paneel, nicht die Seite oben (Task 3).
- Nachtbetrieb: gestrichelte Zonen erkennbar, Sterne darüber weiter lesbar (Bilder, Task 4).

---

### Task 1: Name im Seitentitel

**Files:**
- Modify: `pages/PersonenDetailPage.tsx` (Titel ~Z. 853)
- Test: `pages/PersonenDetailPage.test.tsx`
- Modify (Erwartungen): `pages/PersonenDetailPage.speicherfehler.test.tsx`, `e2e/personen-detail.spec.ts`,
  `e2e/personen-anhaenge.spec.ts`, `e2e/palette-oeffnung.spec.ts`, `e2e/palette-datensaetze.spec.ts`,
  `e2e/betroffene-handy.spec.ts` — nur wo die Person einen Namen hat: Regex auf die Kennung.

**Interfaces:** Consumes `nameText(p: Pick<Person,'name'|'vorname'>): string | null` aus
`personen/personenSpalten.tsx`.

- [x] Test: `zeigt Name, Vorname und klein die Kennung im Titel` — heading level 1 enthält
  „Mustermann, Erika“ und „R-001“; das Element mit der Kennung trägt `data-lfh="titel-kennung"`.
- [x] Test: `bleibt ohne Namen „Person R-001“` — heading-Name beginnt mit „Person R-001“.
- [x] Test: Breadcrumb-Letztglied bleibt „R-001“ ohne Namen.
- [x] Rot sehen: `mise exec -- pnpm exec vitest run src/pages/PersonenDetailPage.test.tsx`
- [x] Umsetzen: Titel = `nameText(p)` gefolgt von `<span data-lfh="titel-kennung">` (Mono über
  `monoStil('mono')`, `Typography.Text type="secondary"`) mit `registrierAnzeige(p.registrier_nr)`;
  ohne Namen „Person {Kennung}“ wie bisher.
- [x] Grün; betroffene Vitest/e2e-Erwartungen anpassen; Commit `feat: Name im Kopf des Personendetails (LLH-1769)`.

### Task 2: Anlass und Transport — Stift am Wert, Wort wenn leer

**Files:**
- Modify: `personen/Patientenkopf.tsx` (Datenfelder Anlass ~Z. 268, Transport ~Z. 362; `PaneelKnopf` ~Z. 752)
- Test: `personen/Patientenkopf.test.tsx`

**Interfaces:** Produces `function StandKnopf(props: { name: string; offen: boolean; gesperrt: boolean;
onClick: () => void; children: ReactNode }): JSX.Element` (Wertknopf: `wertAngabeStil` + `IconStift`,
`aria-label={name}`, `aria-expanded`), und `PaneelKnopf` für leere Angaben im Link-Stil
(`type="link"`, `leerKnopfStil`). Die Rahmenknöpfe „Maßnahme erfassen“/„Verletzung markieren“
bekommen einen eigenen kleinen Baustein `EintragKnopf` (bisheriges `PaneelKnopf`-Aussehen).

- [x] Test: `bietet an einem gesetzten Anlass den Stift am Wert an` — button „Anlass bearbeiten“
  enthält das Anlasswort, kein button „Anlass festlegen“; Klick öffnet region „Anlass festlegen“.
- [x] Test: `fordert ohne Anlass als Wort auf` — button „Anlass festlegen“ hat Klasse `ant-btn-link`.
- [x] Gleiche zwei Tests für Transport („Transport bearbeiten“ / „Transport festlegen“).
- [x] Test: ohne `darfBehandeln` bzw. storniert: weder „Transport bearbeiten“ noch „… festlegen“,
  Lesetext steht.
- [x] Rot sehen: `mise exec -- pnpm exec vitest run src/personen/Patientenkopf.test.tsx`
- [x] Umsetzen; bestehende Tests, die bei gesetztem Transport „Transport festlegen“ klicken, auf
  „Transport bearbeiten“ umstellen.
- [x] Grün; `src/test/verschachtelteZiele.ts` greift (kein Ziel im Wertknopf); Commit
  `feat: ein Bearbeiten im Patientenkopf (LLH-1769)`.

### Task 3: Körperschema ins Bild, Regionen umrandet

**Files:**
- Modify: `personen/koerperschema/KoerperFigur.tsx` (Zonen-`rect`), `personen/Patientenkopf.tsx`
  (section „Verletzung markieren“)
- Test: `personen/koerperschema/Koerperschema.test.tsx`, `personen/Patientenkopf.test.tsx`

- [x] Test (Koerperschema): `umrandet beim Markieren jede Region gestrichelt in der Konturfarbe` —
  jedes `[data-lfh="koerperzone"] rect` hat `stroke` = `koerperschemaFarben(farbenHell).kontur`
  und ein `stroke-dasharray`; gewählte Zone `stroke` = `bedien` ohne `stroke-dasharray`.
- [x] Test: im Modus `lesen` gibt es keine `koerperzone`.
- [x] Test (Patientenkopf): `rollt das Paneel „Verletzung markieren“ beim Öffnen ins Bild` —
  `Element.prototype.scrollIntoView` gemockt, nach Klick einmal mit `{ block: 'nearest' }`
  (Verhalten `smooth`, bei `prefers-reduced-motion` `auto`) auf der region aufgerufen.
- [x] Rot sehen (beide Dateien).
- [x] Umsetzen: nicht aktive Zone `stroke={farben.kontur}`, `strokeDasharray={\`${3*einheit} ${3*einheit}\`}`,
  `strokeWidth={einheit}`; aktive wie bisher. Im Kopf `useRef` auf die section + `useEffect` beim
  Wechsel auf `offen === 'verletzung'`.
- [x] Grün; Commit `feat: Körperschema rollt ins Bild und zeigt Regionen (LLH-1769)`.

### Task 4: Regel, Doku-Bilder, Gates

**Files:**
- Modify: `frontend/src/personen/AGENTS.md` (Abschnitte „Personen-Detail“, „Patientenkopf…“, „Körperschema“)
- Regenerate: `docs/anwender/bilder/betroffene/*.png` (+ `.dunkel.png`)
- Check: `docs/anwender/kapitel/betroffene.md` nennt „Anlass festlegen“/„Transport festlegen“? ggf. Wortlaut anpassen.

- [x] Sätze laut Design-Doc „Regel (E2)“ eintragen; Prettier über `frontend/`.
- [x] `mise exec -- pnpm doku:bilder e2e/doku-bilder/betroffene.bilder.ts` (Spec ggf. auf neue
  Knopfnamen anpassen); Bilder ansehen (hell und dunkel).
- [x] `./scripts/check-all.sh --geaendert --ohne-e2e` grün; zusätzlich
  `pnpm exec playwright test e2e/personen-detail.spec.ts e2e/betroffene-handy.spec.ts --trace off`.
- [x] Commit `docs: Regel Bearbeiten im Patientenkopf, Bilder Betroffene (LLH-1769)`.
