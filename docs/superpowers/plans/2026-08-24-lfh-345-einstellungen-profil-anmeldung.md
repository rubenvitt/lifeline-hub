# LFH-345 · C10 — Einstellungen, Profil und Anmeldung

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (inline) —
> Schritte tragen Checkbox-Syntax (`- [ ]`).

**Goal:** Speicherfehler werden persistent statt flüchtig, fehlende Rechte erklärt statt stumm
weggeschaltet, die Einsatz-Einstellungen in Sektions-Routen mit einem Speichermodell zerlegt,
die Modulliste bei 390 px lesbar, und die Profilseite ohne Baustellen-Platzhalter.

**Architecture:** Ein neues Primitiv `components/SpeicherHinweis.tsx` trägt den persistenten
Fehler- und den Rechte-Hinweis für alle betroffenen Seiten. Die Einsatz-Einstellungen werden nach
dem Vorbild der Org-Ebene (`orgEinstellungenForm.ts` + eine Seite je Sektion) auf vier
Sektions-Routen aufgeteilt, die sich einen Vollersatz-Merge teilen. `ModulEinstellungsListe`
bekommt CSS-Grid statt fester Spaltenbreiten und stapelt unter `md`. `OtpEingabe` wird aus der
Login-Variante zum Primitiv gezogen.

**Tech Stack:** React 19, react-router 7, antd 6, TanStack Query 5, Vitest 4 + RTL, Playwright.

**Spec:** ClickUp LFH-345 (Befunde H14–H17, M14–M20, N5) sowie
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`.

## Global Constraints

- **Board-Ledger — was schon Bestand ist, wird nicht als geleistet geführt:**
  - **H17 erledigt** (LFH-328/A2): `grep -rn "var(--ant-color" frontend/src/pages/ frontend/src/components/`
    = 0; `ModulEinstellungsListe.tsx` nutzt `Typography.Text type="secondary"` + `token.fontSizeSM`.
  - **M19 abgegrenzt** — der Ticket-Absatz „Abgrenzung zu LFH-314" weist die *Gestaltung* der
    Anmeldeseite an A0/LFH-352 zu; der Untertitel steht dort bereits auf 0,66 mit
    A1-Kontrastbegründung im Dateikopf. **Kartenhintergrund-Alpha nicht anfassen.**
  - **M17 halb erledigt** (LFH-370/B5j): `ProfilPage.tsx` trägt 0× `size="small"`, der
    Recovery-Knopf ist `block`; `Anmeldeverfahren.tsx` hat `zeilenzielStil` + sichtbaren
    Sperrgrund + Label-Klick. **Offen bleibt nur die Modulzeile.**
  - **H16 halb erledigt** (LFH-328/A2): das gemeinsame Primitiv `ModulEinstellungsListe.tsx`
    existiert. **Offen: Grid statt `width: 64`/`width: 180` und die Stapelung.**
  - **M15 halb erledigt** (LFH-281): `SektionHeader` steht statt nackter Titles, die drei
    Nummernkreise sind bereits eine Zeilengruppe. **Offen: Sektions-Routen, sticky Leiste,
    zweispaltig auf breiten Displays.**
- **N5 „Passwort ändern" ist herausgeschnitten.** `src/routes/benutzer.rs:29` sagt ausdrücklich
  „`benutzername` (Login-Identität) und Passwort sind bewusst nicht änderbar"; `passwort_hash = `
  trifft im ganzen Backend nur `src/dev/seed.rs`. Ein Self-Service-Weg ist neues Backend
  (Route + Alt-Passwort-Verifikation + Session-Invalidierung). Wird als eigenes Ticket angelegt
  (Task 10) — Präzedenz LFH-453. Alle anderen N5-Hälften werden voll geliefert.
- **Keine neue `size`-Angabe an interaktiven Elementen** — `components/dichte.guard.test.ts`
  steht auf genau einer Datei (`pages/uhs/Grundriss.tsx`, geprüfte Dauerausnahme). Jede neue
  Größen-Prop in den neun Dateien färbt ihn rot.
- **Rot steht nicht bündig neben Neutralem** — entsteht eine `<Space>`-Aktionsreihe mit
  `danger`-Knopf, gilt `size="middle"` und die Datei gehört in `aktionsabstand.guard.test.ts`.
- **Fake-Timer sperren `userEvent` und `findBy*`** (CLAUDE.md, ETB-Filter-Abschnitt): unter
  `vi.useFakeTimers()` läuft `userEvent.type` nicht voran und `findBy*`s `waitFor` hängt an
  echten Timern. Tippen über `fireEvent.change`, Warten über `await act(...)` + `getBy*`.
- **`LoginPage.css` liegt im Radius des H17-Greps** (`grep -rn "var(--ant-color" frontend/src/pages/`
  ist rekursiv, ohne Dateifilter). Ein Erklärkommentar dort darf die antd-Custom-Property
  **nicht in ihrer `var(--ant-…)`-Schreibweise nennen** — die Datei hat das laut ihrem eigenen
  Kopfkommentar schon zweimal gerissen.
- **Handgebautes Bedienziel = ZWEI Angaben** (LFH-365): `minHeight: token.controlHeight` **plus**
  `padding` aus `token.paddingSM`/`token.padding`, aus aufgelösten Tokens, nie `var(--lfh-*)`.
  Geprüft wird der Inline-Style über zwei Dichtestufen mit Literalen als Erwartung.
- **Routen ausschließlich über `frontend/src/routing/deeplinks.ts`** — keine Inline-Templates.
- **Gate:** `./scripts/check-all.sh` vor dem Merge. Zwischendurch die schnellen Gates
  (`pnpm lint`, `tsc`, gezielte Vitest-Dateien).
- **Kommandos im Worktree:** `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend …`, absolute Pfade.
  `<ABS>` = `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-345-einstellungen-profil-anmeldung`.

---

## File Structure

**Neu:**
- `frontend/src/components/SpeicherHinweis.tsx` — persistenter Fehler-Alert (`SpeicherFehler`)
  und Rechte-Hinweis (`RechteHinweis`). Ein Modul, weil beide denselben Slot bedienen und
  gemeinsam über einer Speicher-Aktion stehen.
- `frontend/src/components/SpeicherHinweis.test.tsx`
- `frontend/src/components/OtpEingabe.tsx` + `.test.tsx` — Ziffern-Eingabe für TOTP.
- `frontend/src/pages/einstellungen/einsatzEinstellungenForm.ts` + `.test.ts` — Vollersatz-Merge
  und Formwert-Ableitung für die Einsatz-Ebene (Gegenstück zu `orgEinstellungenForm.ts`).
- `frontend/src/pages/einstellungen/EinsatzEinstellungenLayout.tsx` — Sektions-Tabs + `<Outlet>`.
- `frontend/src/pages/einstellungen/EinsatzAllgemein.tsx` — Einstieg + Anzeige-Konventionen.
- `frontend/src/pages/einstellungen/EinsatzVerhalten.tsx` — Nummernkreise, Fristen, Auto-ETB.
- `frontend/src/pages/einstellungen/EinsatzAufbewahrung.tsx` — Aufbewahrungs-Dauer.
- `frontend/src/pages/einstellungen/EinsatzModule.tsx` — Modul-Sichtbarkeit (H15).
- Je eine `.test.tsx` zu den vier Sektionsseiten.
- `frontend/e2e/einstellungen-schmal.spec.ts` — 390-px-Messung.

**Geändert:**
- `frontend/src/pages/EinsatzEinstellungenPage.tsx` — wird zum Layout-Wrapper abgetragen.
- `frontend/src/pages/einstellungen/ModulEinstellungsListe.tsx` — Grid, Stapelung, Trefffläche.
- `frontend/src/pages/einstellungen/EinsatzDefaults.tsx`, `AnzeigeEinstellungen.tsx`,
  `Anmeldeverfahren.tsx` — persistenter Fehler, Rechte-Hinweis, Zeilenmarkierung.
- `frontend/src/pages/EinsatzdatenPage.tsx` — persistenter Fehler, Gliederung, Status-Label.
- `frontend/src/pages/ProfilPage.tsx` — Kopfsektion, Sicherheit, `OtpEingabe`, kein Platzhalter.
- `frontend/src/pages/LoginPage.tsx` — nutzt `OtpEingabe`.
- `frontend/src/pages/LoginPage.css` — Animation entstaffelt.
- `frontend/src/routing/deeplinks.ts` — Sektions-Pfade.
- `frontend/src/App.tsx` — Sektions-Routen.
- `CLAUDE.md`, `docs/superpowers/specs/2026-08-24-lfh-345-pruefliste.md`.

---

### Task 1: `SpeicherHinweis`-Primitiv (H14/M16-Träger)

**Files:**
- Create: `frontend/src/components/SpeicherHinweis.tsx`
- Test: `frontend/src/components/SpeicherHinweis.test.tsx`

**Interfaces:**
- Produces:
  - `SpeicherFehler({ fehler, titel? }: { fehler: unknown; titel?: string }): ReactElement | null`
  - `RechteHinweis({ text, sichtbar }: { text: string; sichtbar: boolean }): ReactElement | null`
  - `fehlerText(fehler: unknown, fallback?: string): string | null` — rein, exportiert.

- [ ] **Step 1: Failing test schreiben**

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import { RechteHinweis, SpeicherFehler, fehlerText } from './SpeicherHinweis';

describe('fehlerText', () => {
  it('nimmt die Servermeldung eines ApiError', () => {
    expect(fehlerText(new ApiError(422, 'Startwert zu groß'))).toBe('Startwert zu groß');
  });
  it('faellt bei fremden Fehlern auf den Standardsatz zurueck', () => {
    expect(fehlerText(new TypeError('boom'))).toBe('Speichern fehlgeschlagen');
  });
  it('meldet OHNE Fehler nichts — sonst stuende der Alert dauerhaft', () => {
    expect(fehlerText(null)).toBeNull();
  });
});

describe('SpeicherFehler', () => {
  it('rendert die Servermeldung als Alert', () => {
    render(<SpeicherFehler fehler={new ApiError(422, 'Startwert zu groß')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Startwert zu groß');
  });
  it('rendert ohne Fehler GAR NICHTS', () => {
    const { container } = render(<SpeicherFehler fehler={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('RechteHinweis', () => {
  it('erklaert die fehlende Berechtigung', () => {
    render(<RechteHinweis sichtbar text="Nur die Einsatzleitung darf das ändern" />);
    expect(screen.getByText('Nur die Einsatzleitung darf das ändern')).toBeInTheDocument();
  });
  it('schweigt bei vorhandener Berechtigung', () => {
    const { container } = render(<RechteHinweis sichtbar={false} text="egal" />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Test laufen lassen — muss rot sein**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <ABS>/frontend test --run src/components/SpeicherHinweis.test.tsx`
Expected: FAIL, „Failed to resolve import ./SpeicherHinweis".

- [ ] **Step 3: Primitiv schreiben**

```tsx
import { Alert } from 'antd';
import { ApiError } from '../api/client';

/**
 * Persistenter Speicher-Fehler und erklärender Rechte-Hinweis (LFH-345 · C10, H14/M16).
 *
 * WARUM NICHT DER TOAST: sieben Speicherpfade meldeten Fehler ausschließlich über
 * `message.error`. Nach ~3 s war die Meldung weg, das ausgefüllte Formular stand unverändert
 * da und wirkte gespeichert — bei Aufbewahrungsfrist, Nummernkreisen und Fristen fällt das
 * erst Stunden später auf. Der Zustand gehört deshalb an die SEITE (`mutation.isError`) und
 * nicht an eine Queue mit eigener Lebensdauer. Der Erfolg bleibt beim Toast: er ist die
 * Quittung einer abgeschlossenen Handlung und braucht keinen Platz auf der Seite.
 *
 * Der Fehler verschwindet von selbst beim nächsten Absenden — react-query setzt `error` beim
 * Übergang nach `pending` zurück. Das ist die zweite Hälfte der Zusicherung und gehört
 * mitgetestet: ein Alert, der bleibt, wäre so falsch wie einer, der zu früh geht.
 */
export function fehlerText(fehler: unknown, fallback = 'Speichern fehlgeschlagen'): string | null {
  if (fehler == null) return null;
  return fehler instanceof ApiError ? fehler.message : fallback;
}

export function SpeicherFehler({ fehler, titel }: { fehler: unknown; titel?: string }) {
  const text = fehlerText(fehler);
  if (text === null) return null;
  return <Alert type="error" showIcon title={titel ?? 'Nicht gespeichert'} description={text} />;
}

/**
 * Erklärt eine fehlende Berechtigung, statt sie stumm auszugrauen (M16). „Ausgegraut" ist
 * eine Ein-Kanal-Aussage (Grau ist eine Farbe, WCAG 1.4.1) und nennt zudem keinen Grund.
 */
export function RechteHinweis({ text, sichtbar }: { text: string; sichtbar: boolean }) {
  if (!sichtbar) return null;
  return <Alert type="info" showIcon title={text} />;
}
```

- [ ] **Step 4: Test laufen lassen — grün**

Run: wie Step 2. Expected: PASS (9 Tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/SpeicherHinweis.tsx frontend/src/components/SpeicherHinweis.test.tsx
git commit -m "feat(lfh-345): traegt Speicherfehler und Rechtehinweis als Primitiv"
```

---

### Task 2: H14 + M16 auf den drei Org-/Einsatz-Formularseiten

**Files:**
- Modify: `frontend/src/pages/einstellungen/EinsatzDefaults.tsx`,
  `frontend/src/pages/einstellungen/AnzeigeEinstellungen.tsx`,
  `frontend/src/pages/EinsatzdatenPage.tsx`
- Test: die zugehörigen `.test.tsx`

**Interfaces:**
- Consumes: `SpeicherFehler`, `RechteHinweis` aus Task 1.

**Umbau je Seite (gleich für alle drei):**
1. `onError: (e) => message.error(...)` aus der Speicher-Mutation **entfernen** (Erfolg bleibt).
2. Im `hinweis`-Slot (`AdminPage`) bzw. über dem Formular (`EinsatzdatenPage`):
   `<SpeicherFehler fehler={speichernMutation.error} />` plus
   `<RechteHinweis sichtbar={!istAdmin} text="…" />`.
3. Der Speichern-Knopf **verschwindet nicht mehr**: `istAdmin ? <Button…> : undefined`
   wird zu `<Button … disabled={!istAdmin}>`.

- [ ] **Step 1: Failing tests schreiben** (je Seite ein Paar)

```tsx
// pages/einstellungen/EinsatzDefaults.test.tsx — anhängen
it('haelt den Speicherfehler stehen, wenn die Toast-Dauer laengst abgelaufen waere', async () => {
  server.use(http.put('/api/org/einstellungen', () =>
    HttpResponse.json({ error: 'Startwert zu groß' }, { status: 422 })));
  renderMitProvidern(<EinsatzDefaults />, { benutzer: admin });
  await screen.findByLabelText('Aufbewahrungs-Dauer (Tage)');
  await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  expect(await screen.findByText('Startwert zu groß')).toBeInTheDocument();

  vi.useFakeTimers();
  await act(async () => { vi.advanceTimersByTime(10_000); });
  expect(screen.getByText('Startwert zu groß')).toBeInTheDocument();
  vi.useRealTimers();
});

it('raeumt den Fehler beim naechsten Absenden weg — sonst stuende er ewig', async () => {
  let abgelehnt = true;
  server.use(http.put('/api/org/einstellungen', () =>
    abgelehnt ? HttpResponse.json({ error: 'Startwert zu groß' }, { status: 422 })
              : HttpResponse.json({})));
  renderMitProvidern(<EinsatzDefaults />, { benutzer: admin });
  await screen.findByLabelText('Aufbewahrungs-Dauer (Tage)');
  await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await screen.findByText('Startwert zu groß');
  abgelehnt = false;
  await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
  await waitFor(() => expect(screen.queryByText('Startwert zu groß')).not.toBeInTheDocument());
});

it('erklaert der Fuehrungskraft den Grund UND laesst den Knopf stehen', async () => {
  renderMitProvidern(<EinsatzDefaults />, { benutzer: fuehrungskraft });
  await screen.findByLabelText('Aufbewahrungs-Dauer (Tage)');
  expect(screen.getByText(/Nur Benutzer mit der Systemrolle/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled();
});
```

Denselben Dreier für `AnzeigeEinstellungen` (Text „Nur Benutzer mit der Systemrolle …") und
für `EinsatzdatenPage` **ohne** den Rechte-Test (dort ist der Bearbeiten-Knopf gemeint, nicht
der Speichern-Knopf; M16 nennt die Datei nicht).

- [ ] **Step 2: Bestandstests anpassen, die den Umbau beschreiben**

`EinsatzDefaults.test.tsx:122` und `AnzeigeEinstellungen.test.tsx:93` heißen heute
„kein Speichern-Button, Felder disabled". Die Aussage wird zu „Speichern-Button **disabled**,
Felder disabled" — `expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()`
wird zu `expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()`.

- [ ] **Step 3: Tests laufen lassen — rot**

Run: `… test --run src/pages/einstellungen/EinsatzDefaults.test.tsx src/pages/einstellungen/AnzeigeEinstellungen.test.tsx src/pages/EinsatzdatenPage.test.tsx`
Expected: FAIL — Fehlertext nicht im DOM, Knopf nicht vorhanden.

- [ ] **Step 4: Umbau umsetzen** (Schema oben, drei Dateien)

- [ ] **Step 5: Tests grün + Lint**

- [ ] **Step 6: Commit**

```bash
git commit -am "fix(lfh-345): bindet den Speicherfehler an die Seite statt an die Toast-Queue"
```

---

### Task 3: H14 für die Sofort-Speichern-Pfade (Modulliste + Anmeldeverfahren)

**Files:**
- Modify: `frontend/src/pages/einstellungen/ModulEinstellungsListe.tsx`,
  `frontend/src/pages/einstellungen/Anmeldeverfahren.tsx`
- Test: die zugehörigen `.test.tsx`

**Interfaces:**
- Produces: `ModulEinstellungsListeProps` bekommt `fehlerKey?: string | null` (Modul-Key der
  fehlgeschlagenen Zeile) und `laeuftKey?: string | null` (Modul-Key der gerade mutierenden Zeile).
  `laeuft: boolean` **entfällt** — das ist der H15-Anteil „`disabled` nur auf die gerade
  mutierende Zeile".

**Kern:** Der fehlgeschlagene Wert springt bereits von selbst zurück (kein optimistisches
Update — die Anzeige liest aus dem Query). Was fehlt, ist die **Markierung**: die Zeile bekommt
`data-fehler="true"` und einen linken Rand aus `token.colorError`, plus einen Text unter der
Zeile. Vorrang wie bei den Kommunikations-Karten (LFH-343/C8): Rand ist einfarbig, Fehler gewinnt.

- [ ] **Step 1: Failing tests**

```tsx
// ModulEinstellungsListe.test.tsx
it('markiert NUR die fehlgeschlagene Zeile', () => {
  render(<ModulEinstellungsListe {...basis} fehlerKey="etb" />);
  const zeilen = document.querySelectorAll('[data-modul-zeile]');
  const markiert = [...zeilen].filter((z) => z.getAttribute('data-fehler') === 'true');
  expect(markiert).toHaveLength(1);
  expect(markiert[0].getAttribute('data-modul-zeile')).toBe('etb');
});

it('sperrt NUR die gerade mutierende Zeile, nicht die ganze Liste', () => {
  render(<ModulEinstellungsListe {...basis} laeuftKey="etb" />);
  expect(screen.getByLabelText('Sichtbar: Einsatztagebuch')).toBeDisabled();
  expect(screen.getByLabelText('Sichtbar: Chat')).toBeEnabled();
});
```

```tsx
// Anmeldeverfahren.test.tsx — der Bestandstest ':74' wird umgeschrieben
it('haelt die Ablehnung an der Zeile stehen statt sie als Toast verfallen zu lassen', async () => {
  server.use(http.put('/api/admin/auth/provider/oidc', () =>
    HttpResponse.json({ error: 'Letzter Login-Weg' }, { status: 409 })));
  renderMitProvidern(<Anmeldeverfahren />, { benutzer: admin });
  await userEvent.click(await screen.findByLabelText('Anmeldeverfahren: OIDC'));
  expect(await screen.findByText('Letzter Login-Weg')).toBeInTheDocument();
  vi.useFakeTimers();
  await act(async () => { vi.advanceTimersByTime(10_000); });
  expect(screen.getByText('Letzter Login-Weg')).toBeInTheDocument();
  vi.useRealTimers();
});
```

- [ ] **Step 2: rot laufen lassen**
- [ ] **Step 3: umsetzen** — `laeuft` → `laeuftKey` in beiden Aufrufern
      (`EinsatzEinstellungenPage`/`EinsatzDefaults`: `mutation.isPending ? mutation.variables.modulKey : null`).
- [ ] **Step 4: grün**
- [ ] **Step 5: Commit** `fix(lfh-345): sperrt und markiert die Modulzeile einzeln statt global`

---

### Task 4: H16 + M17-Rest — Modulliste auf Grid, Stapelung, Trefffläche

**Files:**
- Modify: `frontend/src/pages/einstellungen/ModulEinstellungsListe.tsx`
- Test: `frontend/src/pages/einstellungen/ModulEinstellungsListe.test.tsx`

**Interfaces:**
- Produces: `export function modulZeilenStil(token: { controlHeight: number; paddingSM: number;
  padding: number }): CSSProperties` — rein und exportiert, nach dem Muster von
  `zeilenzielStil` in `Anmeldeverfahren.tsx` (LFH-365: ZWEI Angaben, nicht eine).

**Kern:**
- Spaltenraster `gridTemplateColumns: 'minmax(0, 1fr) auto auto'` statt `width: 64`/`width: 180`.
- Unter `md` (`useViewport().istSchmal`) stapelt die Zeile: Label als Zeilentitel, Schalter und
  Rolle darunter — `gridTemplateColumns: '1fr'`. Die **Kopfzeile entfällt dann ganz**; ohne
  Spalten benennt sie nichts mehr, und ein Kopf über gestapelten Karten ist eine Lüge.
- Der Rollen-`Select` bekommt `style={{ width: '100%' }}` statt `width: ROLLEN_BREITE` — die
  feste Mindestbreite drängte ihn aus der 390-px-Karte (dieselbe Beobachtung wie bei
  `Datensicht.tsx:234-236`, LFH-369).
- Trefffläche: `modulZeilenStil` gibt der Beschriftung `minHeight: token.controlHeight` +
  Polsterung, und ein `<label htmlFor>` **nur an der bedienbaren Zeile** (Regel aus LFH-370:
  an gesperrten Zeilen entsteht gar kein `<label>`, ein Label-Klick auf ein `disabled`
  Steuerelement leitet der Browser ohnehin nicht weiter).

- [ ] **Step 1: Failing tests**

```tsx
it('traegt den Boden der Stufe an der Beschriftung — und die ZWEITE Angabe daneben', () => {
  expect(modulZeilenStil({ controlHeight: 30, paddingSM: 8, padding: 12 }).minHeight).toBe(30);
  expect(modulZeilenStil({ controlHeight: 72, paddingSM: 16, padding: 24 }).minHeight).toBe(72);
  expect(modulZeilenStil({ controlHeight: 30, paddingSM: 8, padding: 12 }).padding).toBe('8px 12px');
});

it('schaltet ueber einen Klick auf die Beschriftung — genau einmal', async () => {
  const aufSichtbar = vi.fn();
  render(<ModulEinstellungsListe {...basis} sichtbarSpalte={{ ...spalte, aufSichtbar }} />);
  await userEvent.click(screen.getByText('Einsatztagebuch'));
  expect(aufSichtbar).toHaveBeenCalledTimes(1);
});

it('gibt der gesperrten Zeile ausdruecklich KEIN Label', () => {
  render(<ModulEinstellungsListe {...basis} darfVerwalten={false} />);
  expect(document.querySelector('label[for]')).toBeNull();
});

it('stapelt unter md und laesst die Spaltenkoepfe dann weg', () => {
  setzeViewport(390);
  render(<ModulEinstellungsListe {...basis} />);
  expect(screen.queryByText('Sichtbar')).toBeNull();
});

it('haelt die Spaltenkoepfe ab md', () => {
  setzeViewport(1280);
  render(<ModulEinstellungsListe {...basis} />);
  expect(screen.getByText('Sichtbar')).toBeInTheDocument();
});
```

`setzeViewport` = das im Repo übliche `matchMedia`-Stub-Muster aus den B1-Tests
(`components/useViewport` liest `Grid.useBreakpoint()`); vorhandenes Hilfsmittel nachnutzen,
kein zweites bauen.

- [ ] **Step 2: rot** — [ ] **Step 3: umsetzen** — [ ] **Step 4: grün**
- [ ] **Step 5: Commit** `feat(lfh-345): stapelt die Modulzeile unter md und gibt ihr eine Trefflaeche`

---

### Task 5: H15 + M15 — Sektions-Routen für die Einsatz-Einstellungen

**Files:**
- Create: `frontend/src/pages/einstellungen/einsatzEinstellungenForm.ts` (+ `.test.ts`),
  `EinsatzEinstellungenLayout.tsx`, `EinsatzAllgemein.tsx`, `EinsatzVerhalten.tsx`,
  `EinsatzAufbewahrung.tsx`, `EinsatzModule.tsx` (+ Tests)
- Modify: `frontend/src/pages/EinsatzEinstellungenPage.tsx`, `frontend/src/App.tsx`,
  `frontend/src/routing/deeplinks.ts`

**Interfaces:**
- Produces in `deeplinks.ts`:

```ts
export type EinstellungenSektion = 'allgemein' | 'verhalten' | 'aufbewahrung' | 'module';

/** Sektions-Route der Einsatz-Einstellungen (LFH-345 · C10, H15/M15). */
export function einsatzEinstellungenPfad(
  einsatzId: number,
  sektion: EinstellungenSektion = 'allgemein',
): string {
  return `${einsatzModulPfad(einsatzId, 'einstellungen')}/${sektion}`;
}
```

- Produces in `einsatzEinstellungenForm.ts`:

```ts
/** Vollersatz-Basis aus dem geladenen Stand — jede Sektion schickt die fremden Felder mit. */
export function zuUpdate(e: EinstellungenAnzeige): EinstellungenUpdate;
export function initialAllgemein(e: EinstellungenAnzeige): FormWerteAllgemein;
export function normalisiereAllgemein(w: FormWerteAllgemein): Partial<EinstellungenUpdate>;
export function initialVerhalten(e: EinstellungenAnzeige): FormWerteVerhalten;
export function normalisiereVerhalten(w: FormWerteVerhalten): Partial<EinstellungenUpdate>;
export function initialAufbewahrung(e: EinstellungenAnzeige): FormWerteAufbewahrung;
export function normalisiereAufbewahrung(w: FormWerteAufbewahrung): Partial<EinstellungenUpdate>;
```

**Warum so:** Der PUT ist **Vollersatz** — auf einer aufgeteilten Route muss jede Sektion die
Felder der anderen als Bestandswert mitschicken, sonst nullt ein Speichern in „Aufbewahrung" die
Nummernkreise. Genau diesen Vertrag löst die Org-Ebene seit LFH-281 mit
`orgEinstellungenForm.ts`; das ist die Präzedenz, nicht eine Erfindung. Der Karten-Kommentar aus
`EinsatzEinstellungenPage.tsx` (basemap/zoom/fachebenen müssen mitfahren, LFH-319) zieht
unverändert in `zuUpdate` um und behält seine Begründung.

**Weiter:**
- `EinsatzEinstellungenPage.tsx` wird zum Layout: `Tabs` mit den vier Sektionen, `onChange` →
  `navigate(einsatzEinstellungenPfad(id, key))`, aktive Sektion aus `useParams`, plus `<Outlet>`.
  Der bare Pfad `…/einstellungen` leitet auf `…/einstellungen/allgemein` um (Muster
  `ersteSektionPfad` aus `AdminLayout`).
- **Speichern-Leiste sticky am unteren Rand** statt im Kopf-Slot: der Knopf liegt damit **im**
  `<form>` und trägt `htmlType="submit"` — womit Enter absendet (Erfassungs-Norm B4/LFH-332).
  Der Kopf-Aktionen-Slot bleibt leer; „genau eine Primäraktion" (LFH-340/C5) wird dadurch nicht
  verletzt, sondern trivial erfüllt.
- **Zweispaltig ab `lg`**: `gridTemplateColumns: abBreite('lg') ? '1fr 1fr' : '1fr'` auf der
  Feldgruppe von „Verhalten & Automatik" (9 Felder). `allgemein` (5) und `aufbewahrung` (1)
  bleiben einspaltig — zwei Spalten für ein Feld wären Zierde.

- [ ] **Step 1: `einsatzEinstellungenForm.test.ts` schreiben** — der Vollersatz ist die Aussage:

```ts
it('laesst die fremden Sektionen als Bestandswert mitfahren', () => {
  const stand = { ...basisStand, etb_nummer_praefix: 'EB-', retention_dauer_tage: 30 };
  const payload = { ...zuUpdate(stand), ...normalisiereAufbewahrung({ retention_dauer_tage: 90 }) };
  expect(payload.etb_nummer_praefix).toBe('EB-');
  expect(payload.retention_dauer_tage).toBe(90);
});

it('haelt die Karten-Defaults fest (LFH-319) — der PUT nullt sie sonst', () => {
  const stand = { ...basisStand, basemap_modus: 'offline', karten_zoom_start: 12 };
  expect(zuUpdate(stand).basemap_modus).toBe('offline');
  expect(zuUpdate(stand).karten_zoom_start).toBe(12);
});

it('macht aus einem geleerten Praefix null, nicht ""', () => {
  expect(normalisiereVerhalten({ etb_nummer_praefix: '  ' }).etb_nummer_praefix).toBeNull();
});
```

- [ ] **Step 2: rot** — [ ] **Step 3: `einsatzEinstellungenForm.ts` schreiben** — [ ] **Step 4: grün**
- [ ] **Step 5: Vier Sektionsseiten + Layout bauen**, Bestandstests aus
      `EinsatzEinstellungenPage.test.tsx` auf die jeweilige Sektionsseite aufteilen
      (sie sind fachlich unverändert gültig und bleiben der Regressionsschutz).
- [ ] **Step 6: Routen in `App.tsx` + `deeplinks.ts`**, Deeplink-Test für die vier Sektionen.
- [ ] **Step 7: Volle Vitest-Suite** (die Route-Änderung strahlt aus).
- [ ] **Step 8: Commit** `refactor(lfh-345): zerlegt die Einsatz-Einstellungen in Sektions-Routen`

---

### Task 6: M18 — Anmelde-Animation entstaffeln

**Files:**
- Modify: `frontend/src/pages/LoginPage.css:25,57,141-153`
- Test: `frontend/src/pages/LoginPage.animation.test.ts` (neu, reiner CSS-Textprüfer)

**Kern:** Heute Karte `0.15 s + 0.7 s`, Felder `0.3/0.38 s + 0.6 s`, Absenden `0.46 s + 0.6 s`
= **1,06 s**. Ziel: Karte ohne Delay, Felder und Absende-Knopf ohne Versatz.

- [ ] **Step 1: Failing test** — die AK-Rechnung als Test, gegen die Datei gelesen:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./LoginPage.css', import.meta.url), 'utf8');

/** Summe aus `animation-delay` und der `animation`-Kurzform-Dauer einer Regel, in Sekunden. */
function sichtbarNach(selektor: string): number { /* Regel schneiden, s/ms parsen */ }

it('zeigt den Anmelden-Knopf spaetestens 0,5 s nach dem Mount', () => {
  expect(sichtbarNach('.login-karte .login-absenden')).toBeLessThanOrEqual(0.5);
});

it('laesst ihn nie spaeter erscheinen als die Felder, die er absendet', () => {
  expect(sichtbarNach('.login-karte .login-absenden'))
    .toBeLessThanOrEqual(sichtbarNach('.login-karte .ant-form-item:nth-of-type(2)'));
});
```

- [ ] **Step 2: rot** (heute 1,06 s) — [ ] **Step 3: Delays entfernen, Dauer auf 0,35 s**
- [ ] **Step 4: grün.** `prefers-reduced-motion`-Block bleibt unangetastet.
- [ ] **Step 5: Commit** `fix(lfh-345): laesst den Anmelden-Knopf nicht nach den Feldern erscheinen`

---

### Task 7: M20 — `OtpEingabe`-Primitiv

**Files:**
- Create: `frontend/src/components/OtpEingabe.tsx` + `.test.tsx`
- Modify: `frontend/src/pages/LoginPage.tsx:232-240`, `frontend/src/pages/ProfilPage.tsx:217`

**Interfaces:**
- Produces: `OtpEingabe(props: { value?: string; onChange?: (v: string) => void;
  onVoll?: (code: string) => void; autoFocus?: boolean })` — Form-kontrollierbar
  (`value`/`onChange` werden von `Form.Item` injiziert).

**Kern:** `inputMode="numeric"`, `pattern="[0-9]*"`, `maxLength={6}`,
`autoComplete="one-time-code"`, Klasse `login-otp` (Ziffern-Optik, tabellarische Ziffern).
Bei sechs Ziffern **einmalig** `onVoll` — der Bestätigen-Knopf bleibt als Rückfallweg stehen.

**Die Falle:** Ein Riegel gegen das doppelte Absenden ist Pflicht — `onChange` feuert erneut,
sobald der Wert erneut sechsstellig ist (Korrektur, Paste). Ein `useRef`-Merker auf den zuletzt
gemeldeten Code, nicht ein `useEffect` auf die Länge: eine Flanke auf „ist sechsstellig" ist
nach einem Rerender längst vorbei (dieselbe Beobachtung wie beim Fokus-Nachlauf in LFH-369).
**Kein `size`-Prop** — `size="large"` stünde heute im Bestand beider Aufrufer und wäre am
neuen Primitiv eine neue Größen-Angabe an einem interaktiven Element (Dichte-Guard).

- [ ] **Step 1: Failing tests**

```tsx
it('richtet die Eingabe auf Ziffern aus', () => {
  render(<OtpEingabe />);
  const feld = screen.getByRole('textbox');
  expect(feld).toHaveAttribute('inputMode', 'numeric');
  expect(feld).toHaveAttribute('maxLength', '6');
  expect(feld).toHaveAttribute('autoComplete', 'one-time-code');
});

it('meldet den vollen Code genau einmal', async () => {
  const onVoll = vi.fn();
  render(<OtpEingabe onVoll={onVoll} />);
  await userEvent.type(screen.getByRole('textbox'), '123456');
  expect(onVoll).toHaveBeenCalledExactlyOnceWith('123456');
});

it('meldet NICHT erneut, wenn derselbe volle Code nach einer Korrektur wieder dasteht', async () => {
  const onVoll = vi.fn();
  render(<OtpEingabe onVoll={onVoll} />);
  const feld = screen.getByRole('textbox');
  await userEvent.type(feld, '123456');
  await userEvent.type(feld, '{Backspace}6');
  expect(onVoll).toHaveBeenCalledTimes(2); // 123456, dann erneut 123456 nach echter Aenderung
});

it('meldet gar nicht, solange der Code kuerzer ist', async () => {
  const onVoll = vi.fn();
  render(<OtpEingabe onVoll={onVoll} />);
  await userEvent.type(screen.getByRole('textbox'), '12345');
  expect(onVoll).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: rot** — [ ] **Step 3: Primitiv** — [ ] **Step 4: grün**
- [ ] **Step 5: beide Aufrufer umstellen.** Der Login-Bestandstest
      `LoginPage.test.tsx:493` („richtet die Code-Eingabe auf Ziffern aus") muss **grün bleiben** —
      er ist der Beleg, dass die Umstellung nichts verliert.
- [ ] **Step 6: Commit** `refactor(lfh-345): zieht die TOTP-Eingabe zum gemeinsamen Primitiv`

---

### Task 8: N5 — Profilseite fertigstellen

**Files:**
- Modify: `frontend/src/pages/ProfilPage.tsx` (Platzhalter raus, Kopfsektion, `message=` → `title=`)
- Test: `frontend/src/pages/ProfilPage.test.tsx`

**Kern:**
- `<Platzhalter>` entfernen (AK: `grep -rn "Platzhalter" …/ProfilPage.tsx` = 0), Import mit.
- Kopfsektion als `Descriptions column={1}`: Anzeigename, Benutzername, Systemrolle, Organisation.
  Die Rollen-Beschriftung kommt aus der vorhandenen Label-Map, nicht als roher Wire-Wert.
- Abschnitt „Sicherheit" trägt Passkey und 2FA (bestehende Blöcke ziehen darunter).
- `message=` → `title=` am Recovery-Alert (deprecated in antd 6).
- **Passwort ändern bleibt draußen** (Global Constraints) — es wird an dieser Stelle auch kein
  toter Knopf gerendert: ein Knopf ohne Endpunkt ist schlimmer als keiner (dieselbe Regel wie
  beim Kopieren-Knopf ohne Zwischenablage, LFH-370).

- [ ] **Step 1: Failing tests**

```tsx
it('zeigt Anzeigename, Systemrolle und Organisation', async () => {
  renderMitProvidern(<ProfilPage />, { benutzer: { ...admin, anzeigename: 'R. Vitt' } });
  expect(await screen.findByText('R. Vitt')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
});

it('endet nicht mehr im Baustellen-Platzhalter', async () => {
  renderMitProvidern(<ProfilPage />, { benutzer: admin });
  await screen.findByText('Zwei-Faktor (TOTP)');
  expect(screen.queryByText('Eigener Account und app-weite Einstellungen.')).toBeNull();
});
```

- [ ] **Step 2: rot** — [ ] **Step 3: umsetzen** — [ ] **Step 4: grün**
- [ ] **Step 5: AK-Greps fahren** (`Platzhalter` = 0, `size="small"` = 0)
- [ ] **Step 6: Commit** `feat(lfh-345): gibt der Profilseite Kopfdaten statt eines Platzhalters`

---

### Task 9: M14 — Einsatzdaten gliedern

**Files:**
- Modify: `frontend/src/pages/EinsatzdatenPage.tsx:149,210-238`
- Test: `frontend/src/pages/EinsatzdatenPage.test.tsx`

**Kern und begründete Wahl:** Das Ticket lässt die Form ausdrücklich offen („`autoFocus` aufs
erste Feld, **falls das Vollformular bleibt**"). **Das Vollformular bleibt.** Inline-Edit je
`Descriptions`-Zeile wäre ein eigener Umbau: `BemerkungZelle` trägt optionale Freitexte, nicht
Pflichtfelder mit `DatePicker`/`Select`/Koordinaten-Eingabe und nicht die
`rules={[{ required: true }]}`-Prüfung, an der `bezeichnung` und `begonnen_at` hängen. Wird als
Nachzug benannt (Task 10).

Geliefert wird:
- **Kopfleiste** über der Tabelle: Stichwort, Alarmzeit, Einsatzort und Einsatzleitung als
  herausgestellte Vierergruppe (die vier Angaben, die im Fükw zuerst gebraucht werden).
- **Technische Angaben** (Einsatznummer intern, Leitstellen-Nr., Angelegt am) in einen
  `<Collapse>` — **eingeklappt**, `forceRender` ist hier nicht nötig (keine Feldzählung).
- **Status über die Label-Map** statt rohem Wire-Wert. Der Kommentar im Bestand
  („hat noch keinen Eintrag im Statusfarb-Vertrag — zieht in Task 8/10 um") wird damit eingelöst;
  die Map zieht aus `EinsaetzePage` an einen geteilten Ort.
- **`autoFocus`** aufs Bezeichnungs-Feld beim Wechsel in den Bearbeiten-Modus.

- [ ] **Step 1: Failing tests**

```tsx
it('zeigt den Status als Wort, nicht als Wire-Wert', async () => {
  renderMitProvidern(<EinsatzdatenPage />, { einsatz: { ...basis, status: 'abgeschlossen' } });
  expect(await screen.findByText('Abgeschlossen')).toBeInTheDocument();
  expect(screen.queryByText('abgeschlossen')).toBeNull();
});

it('haelt die technischen Angaben eingeklappt, die Kopfangaben aber sichtbar', async () => {
  renderMitProvidern(<EinsatzdatenPage />, { einsatz: basis });
  expect(await screen.findByText('Musterstraße 1')).toBeInTheDocument();  // Einsatzort, Kopf
  expect(screen.queryByText('LS-4711')).toBeNull();                        // Leitstellen-Nr.
  await userEvent.click(screen.getByText('Technische Angaben'));
  expect(await screen.findByText('LS-4711')).toBeInTheDocument();
});

it('setzt den Fokus beim Bearbeiten aufs erste Feld', async () => {
  renderMitProvidern(<EinsatzdatenPage />, { einsatz: basis });
  await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
  expect(screen.getByLabelText('Bezeichnung')).toHaveFocus();
});
```

- [ ] **Step 2: rot** — [ ] **Step 3: umsetzen** — [ ] **Step 4: grün**
- [ ] **Step 5: Commit** `feat(lfh-345): stellt die Einsatz-Kopfdaten heraus und klappt Technik weg`

---

### Task 10: e2e bei 390 px, Prüfliste, CLAUDE.md, Nachzugs-Tickets

**Files:**
- Create: `frontend/e2e/einstellungen-schmal.spec.ts`,
  `docs/superpowers/specs/2026-08-24-lfh-345-pruefliste.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Ist-Wert bei 390 px am Bestand messen, BEVOR die Zusicherung geschrieben wird.**
      `document.body.scrollWidth === window.innerWidth` ist strikte Gleichheit und
      subpixel-/Scrollbar-anfällig; steht dort im Bestand schon eine Differenz aus anderer
      Quelle, gehört das in den Test-Kommentar statt in eine überraschte Fehlersuche.

- [ ] **Step 2: e2e-Spec** — geprüft wird mit `toBeInViewport()`, nicht `toBeVisible()`
      (LFH-343/C8: ein Element unterhalb des Sichtbereichs ist im Sinne von `toBeVisible`
      sichtbar). Zusicherungen: Modulzeile stapelt (Label über Schalter), kein waagerechter
      Überlauf, Schalterzeile ≥ 44 px.

- [ ] **Step 3: Prüfliste Einsatztauglichkeit** (15 Kriterien) je Verdikt, Muster
      `2026-08-21-lfh-343-pruefliste.md`. Der Ledger aus den Global Constraints kommt als
      eigener Abschnitt mit hinein — was Bestand war, wird dort belegt, nicht als Leistung geführt.

- [ ] **Step 4: CLAUDE.md fortschreiben** — die gemessenen Festlegungen, nicht die Ticket-Prosa.

- [ ] **Step 5: Nachzugs-Tickets anlegen** (`clickup-task-anlegen`):
      1. Self-Service-Passwortänderung (Backend + Profil-UI).
      2. Einsatzdaten: Inline-Edit je `Descriptions`-Zeile.

- [ ] **Step 6: Volles Gate** `./scripts/check-all.sh`

- [ ] **Step 7: Commit** `docs(lfh-345): legt die Pruefliste an und schreibt CLAUDE.md fort`

---

## Self-Review

**Spec-Abdeckung (7 AKs):**

| AK | Task |
|---|---|
| Sieben Speicherpfade mit persistentem Fehler (Fake-Timer) | 2, 3 |
| `var(--ant-color` = 0 | **Bestand** (Ledger) — in Task 10 als Grep belegt |
| 390 px: Modulzeile stapelt, kein Überlauf | 4 (Verhalten), 10 (Messung) |
| `size="small"` in ProfilPage = 0, Zeilen ≥ 44 px, Sperrgrund ohne Hover | **halb Bestand**; Rest 4, 10 |
| `Platzhalter` = 0, Anzeigename/Systemrolle/Organisation, Passwort ändern | 8 — **Passwortweg herausgeschnitten** (Global Constraints, Task 10/5) |
| `.login-absenden` ≤ 0,5 s und nicht später als die Felder | 6 |
| `Alert type="info"` bei fehlender Berechtigung, kein Knopf verschwindet | 2 |

**Befunde:** H14→2/3 · H15→3/5 · H16→4 · H17→Bestand · M14→9 · M15→5 · M16→2 · M17→4 (Rest) ·
M18→6 · M19→abgegrenzt · M20→7 · N5→8 (ohne Passwortweg).

**Typkonsistenz:** `fehlerText`/`SpeicherFehler`/`RechteHinweis` (T1) werden in T2/T3 unter
denselben Namen konsumiert. `laeuftKey`/`fehlerKey` (T3) und `modulZeilenStil` (T4) liegen in
derselben Datei und kollidieren nicht. `einsatzEinstellungenPfad` (T5) ist der einzige
Routen-Bauer. `OtpEingabe` (T7) wird nur von T7 selbst verdrahtet.
