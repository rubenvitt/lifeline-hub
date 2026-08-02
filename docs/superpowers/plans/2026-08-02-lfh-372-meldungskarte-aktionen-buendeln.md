# LFH-372 · B5k — Kartenhöhe bei vielen offenen Aktionen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Meldungskarte zeigt höchstens zwei Aktionen unmittelbar im Kartenkörper, alle
übrigen hängen an einem ⋮-Menü; die Auftragskarte zeigt offene Empfänger nur noch einmal.

**Architecture:** `meldungen/MeldungKarte.tsx` trennt die sechs Aktionen in *sichtbar*
(`Bestätigen` + genau ein Statusschritt) und *gebündelt* (antd `Dropdown` mit
`menu={{ items }}`, `trigger={['click']}`, icon-only `<Button type="text">` nach dem Muster
`chat/NachrichtenStrom.tsx` / `pages/lagekarte/Sidebar.tsx`). Die Rückfrage für „Erledigt"
trägt ein `<Modal>` mit eigenem State (LFH-366 — **kein** Popconfirm im Menü-Label);
`Sichten`/`In Bearbeitung` verlieren ihre Rückfrage, weil das Backend jeden Status frei
zurücksetzt. `auftraege/AuftragKarte.tsx` zeigt nur noch **quittierte** Empfänger als
Statuschip, offene ausschließlich in der Quittungszeile.

**Tech Stack:** React 19 · antd 6 · TypeScript · Vitest 4 + Testing Library · pnpm 11.10.0
(über `mise exec`).

## Global Constraints

- **Dichte-Norm:** kein neues punktuelles `size="small"` an interaktiven Elementen. Der
  ⋮-Trigger erbt `controlHeight` vom `ConfigProvider` (`components/dichte.guard.test.ts`).
- **Zeilenkennung im zugänglichen Namen** (LFH-365): der ⋮-Trigger heißt
  `Aktionen zu Meldung <lfd_nr>` — n Karten liefern sonst n gleichnamige Knöpfe.
- **Rot bedient nichts / Abstand** (LFH-363): bleibt `Bestätigen` (`danger`) neben einer
  weiteren Aktion, trägt die Reihe `<Space size="middle">`, und die Datei kommt in
  `MIT_NACHBARSCHAFT` in `components/aktionsabstand.guard.test.ts`.
- **Keine Pixel-/Höhen-Zusicherung in Vitest** — `test/utils.tsx` rendert ein nacktes
  `ConfigProvider`, jsdom rechnet kein Layout. Der Höhenbeleg gehört nach Playwright (B5j).
- **Menü-Abfrage im Test immer über das GEÖFFNETE Portal** — antd lässt Portale
  geschlossener Dropdowns im Baum stehen, und ein verlassendes Portal bekommt in jsdom nie
  `hidden`. Zugriff per Teilstring, nicht per exaktem Namen.
- Kommandos laufen aus `frontend/` über
  `mise exec pnpm@11.10.0 -- pnpm …` (absolute `-C`-Pfade, wenn von woanders).

**Zielform (vom Nutzer entschieden, 02.08.2026):**

| Meldungsstatus | sichtbar im Kartenkörper | im ⋮-Menü |
|---|---|---|
| `neu` | Bestätigen\* · **Sichten** | In Bearbeitung · Erledigt · An Lage übergeben† · Auftrag erteilen‡ |
| `gesichtet` | Bestätigen\* · **In Bearbeitung** | Erledigt · An Lage übergeben† · Auftrag erteilen‡ |
| `in_bearbeitung` | Bestätigen\* · **Erledigt** | An Lage übergeben† · Auftrag erteilen‡ |
| `erledigt` | Bestätigen\* | An Lage übergeben† · Auftrag erteilen‡ |

\* nur bei `bestaetigung_pflicht && !ist_bestaetigt` · † nur bei `!lagerelevant` ·
‡ nur bei `auftrag_id == null`

**Rückfragen:** `Bestätigen` behält seinen `Popconfirm` (sichtbarer Knopf, Kenntnisnahme ist
nicht umkehrbar). `Erledigt` trägt ein `<Modal>` — **auf beiden Wegen derselbe Pfad**, damit
es nicht je nach Status zwei Bauformen für dieselbe Aktion gibt. `Sichten` und
`In Bearbeitung` verlieren ihre Rückfrage (`src/meldung/repo.rs:223` setzt jeden Status frei
zurück → umkehrbar → keine zusätzliche Reibung, LFH-378).

## File Structure

- `frontend/src/meldungen/MeldungKarte.tsx` — **modify**: Aktionsliste → sichtbare Reihe +
  Menü + Erledigt-Modal. Der veraltete „GEPRÜFT und VERWORFEN"-Kommentarblock (Z. 80–100)
  wird durch die Begründung der neuen Zielform ersetzt.
- `frontend/src/meldungen/MeldungKarte.test.tsx` — **modify**: trägt neu die
  AK-Belege auf Komponentenebene (Worst-Case-Zählung, jede Aktion auslösbar, Trigger-Name,
  Tastatur).
- `frontend/src/pages/MeldungenPage.test.tsx` — **modify**: die 10 Aufrufstellen auf den
  neuen Weg; die vier Negativ-Aussagen differenziert erhalten.
- `frontend/src/components/aktionsabstand.guard.test.ts` — **modify**: `MIT_NACHBARSCHAFT`
  um `meldungen/MeldungKarte.tsx` erweitern.
- `frontend/src/auftraege/AuftragKarte.tsx` — **modify**: Statuschips nur für quittierte
  Empfänger; offene Empfänger auch ohne Schreibrecht namentlich sichtbar.
- `frontend/src/pages/AuftraegePage.test.tsx` — **modify**: Doppelnennung wird zur
  Einmalnennung; neuer Fall „ohne Schreibrecht bleiben offene Empfänger lesbar".
- `CLAUDE.md` — **modify**: der Absatz „MeldungKarte ist die begründete Gegenausnahme …
  offen als LFH-372/B5k" behauptet nach dem Umbau das Gegenteil.

---

### Task 1: Meldungskarte — Aktionen bündeln

**Files:**
- Modify: `frontend/src/meldungen/MeldungKarte.tsx:80-154` (Aktionsliste) und `:219-223` (Reihe)
- Modify: `frontend/src/meldungen/MeldungKarte.test.tsx`
- Modify: `frontend/src/pages/MeldungenPage.test.tsx` (10 Stellen)
- Modify: `frontend/src/components/aktionsabstand.guard.test.ts:55-89`

**Interfaces:**
- Consumes: `MeldungKarteProps` unverändert — keine neue Prop. Die Zielform ist eine
  Funktion des vorhandenen `m.status` / `m.lagerelevant` / `m.auftrag_id` /
  `m.bestaetigung_pflicht` / `m.ist_bestaetigt`.
- Produces: zugänglicher Name des Triggers `Aktionen zu Meldung ${m.lfd_nr}`;
  Menüeinträge tragen unverändert die Beschriftungen `In Bearbeitung`, `Erledigt`,
  `An Lage übergeben`, `Auftrag erteilen`. Das Erledigt-Modal trägt
  `title="Meldung auf „Erledigt“ setzen?"` und `okText="Bestätigen"`.

- [ ] **Step 1: Test-Helfer + Worst-Case-Zählung als failing test schreiben**

In `frontend/src/meldungen/MeldungKarte.test.tsx` oben ergänzen (Imports erweitern auf
`within`, `userEvent`, `vi`):

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Greift das GEÖFFNETE Dropdown-Portal. antd lässt die Portale geschlossener Dropdowns
 * im Baum stehen, und ein verlassendes Portal bekommt in jsdom nie `hidden` — deshalb
 * zusätzlich über `pointerEvents` filtern und genau einen Treffer verlangen.
 */
async function oeffneAktionsmenue(lfdNr = 1): Promise<HTMLElement> {
  await userEvent.click(screen.getByRole('button', { name: `Aktionen zu Meldung ${lfdNr}` }));
  const offen = [...document.querySelectorAll<HTMLElement>('.ant-dropdown')]
    .filter((d) => !d.classList.contains('ant-dropdown-hidden') && d.style.pointerEvents !== 'none');
  expect(offen).toHaveLength(1);
  const menue = offen[0].querySelector<HTMLElement>('[role="menu"]');
  if (!menue) throw new Error(`Das Aktionsmenü zu Meldung ${lfdNr} ließ sich nicht öffnen`);
  return menue;
}

/** Die Worst-Case-Meldung aus dem AK: neu · bestätigungspflichtig unbestätigt ·
 *  nicht lagerelevant · kein Auftrag → alle sechs Aktionen stehen zur Verfügung. */
const schlimmstenfalls = () => meldung({
  status: 'neu', bestaetigung_pflicht: true, ist_bestaetigt: false,
  lagerelevant: false, auftrag_id: null,
});

const alleCallbacks = () => ({
  darfSchreiben: true,
  onStatus: vi.fn(), onLagerelevant: vi.fn(), onBestaetigen: vi.fn(), onAuftragErteilen: vi.fn(),
});
```

Und den neuen Block anhängen:

```tsx
describe('MeldungKarte — Aktionsbündelung (LFH-372/B5k)', () => {
  it('zeigt im Worst-Case höchstens zwei Aktionen im Kartenkörper, den Rest hinter einem Trigger', async () => {
    const cb = alleCallbacks();
    const { container } = renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const karte = container.querySelector<HTMLElement>('[data-meldung-id="1"]')!;
    // Im Kartenkörper: die zwei Aktionen PLUS der eine Trigger — mehr nicht.
    const knoepfe = within(karte).getAllByRole('button');
    expect(knoepfe.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Bestätigen', 'Sichten', 'Aktionen zu Meldung 1',
    ]);
    // Die übrigen vier sind über GENAU EINEN Trigger erreichbar.
    const menue = await oeffneAktionsmenue();
    expect(within(menue).getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'In Bearbeitung', 'Erledigt', 'An Lage übergeben', 'Auftrag erteilen',
    ]);
  });
});
```

- [ ] **Step 2: Test laufen lassen und Fehlschlag sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm vitest run src/meldungen/MeldungKarte.test.tsx`
Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Aktionen zu Meldung 1"`.

- [ ] **Step 3: MeldungKarte.tsx umbauen**

Imports ergänzen: `Dropdown`, `Modal` aus `antd`, `MoreOutlined` aus `@ant-design/icons`,
`useState` aus `react`, `MenuProps` als Typ.

Den Kommentarblock `:80-100` **ersetzen** (er behauptet sonst das Gegenteil des Codes
darunter) und die Aktionsliste durch die Zielform ersetzen:

```tsx
  // Aktionsbündelung (LFH-372/B5k, Nachtrag zu LFH-364/B5d): die sechs Aktionen dieser
  // Karte schliessen sich NICHT aus — eine neue, bestätigungspflichtige, noch nicht
  // lagerelevante Meldung ohne Auftrag hatte sie alle gleichzeitig, auf `handschuh`
  // (72 px) also bis zu sechs Knopfzeilen. Sichtbar bleiben deshalb genau zwei:
  // „Bestätigen" (die dringlichste Aktion der Karte, Kenntnisnahme einer Sofortmeldung)
  // und die EINE sinnvolle Vorwärtsbewegung des Triage-Status. Alles Weitere hängt an
  // einem ⋮-Menü (Muster: `chat/NachrichtenStrom.tsx`, `pages/lagekarte/Sidebar.tsx`).
  //
  // Rückfragen (LFH-378: erst die Umkehrbarkeit, dann die Rückfrage):
  //  • „Sichten"/„In Bearbeitung" haben ihre verloren — `src/meldung/repo.rs:223` setzt
  //    jeden Status frei zurück, der Schritt ist folgenlos.
  //  • „Erledigt" behält eine: es räumt die Karte aus der Offen-Ansicht, und die
  //    Abgeschlossen-Ansicht trägt keine Aktion zurück. Sie ist ein `<Modal>` mit eigenem
  //    State und KEIN `Popconfirm` (LFH-366) — im Menü-Label überlebte der nur mit
  //    `stopPropagation` das Auto-Schliessen. Bewusst DERSELBE Pfad, egal ob „Erledigt"
  //    gerade sichtbar oder im Menü steht: zwei Bauformen für eine Aktion wären ein
  //    Unterschied ohne Bedeutung.
  //  • „Bestätigen" behält seinen `Popconfirm` — sichtbarer Knopf, keine Menü-Falle.
  const [erledigtOffen, setErledigtOffen] = useState(false);

  const kannBestaetigen = !!(darfSchreiben && m.bestaetigung_pflicht && !m.ist_bestaetigt && onBestaetigen);
  // Je Status genau eine Vorwärtsbewegung. `erledigt` hat keine.
  const naechster: { ziel: MeldungStatus; label: string } | null =
    m.status === 'neu' ? { ziel: 'gesichtet', label: 'Sichten' }
      : m.status === 'gesichtet' ? { ziel: 'in_bearbeitung', label: 'In Bearbeitung' }
        : m.status === 'in_bearbeitung' ? { ziel: 'erledigt', label: 'Erledigt' }
          : null;

  const menuItems: MenuProps['items'] = darfSchreiben
    ? [
        // Was der Primär-Knopf gerade NICHT zeigt, bleibt über das Menü erreichbar —
        // sonst verlöre eine neue Meldung den Direktsprung auf „Erledigt", den der
        // Bestand hatte (`m.status !== 'erledigt'`).
        ...(m.status === 'neu' && onStatus
          ? [{ key: 'ib', label: 'In Bearbeitung', onClick: () => onStatus(m.id, 'in_bearbeitung' as MeldungStatus) }]
          : []),
        ...(m.status !== 'erledigt' && m.status !== 'in_bearbeitung' && onStatus
          ? [{ key: 'er', label: 'Erledigt', onClick: () => setErledigtOffen(true) }]
          : []),
        ...(!m.lagerelevant && onLagerelevant
          ? [{ key: 'lr', label: 'An Lage übergeben', onClick: () => onLagerelevant(m.id) }]
          : []),
        ...(m.auftrag_id == null && onAuftragErteilen
          ? [{ key: 'ae', label: 'Auftrag erteilen', onClick: () => onAuftragErteilen(m) }]
          : []),
      ]
    : [];
```

Die Aktionsreihe (`:219-223`) ersetzen. `<Space size="middle">` statt `<Flex gap={8}>`:
`Bestätigen` ist `danger` und steht neben mindestens einer weiteren Aktion — der
Vorgabeabstand wäre `abstand.xs` = 3/5/7 px (LFH-363).

```tsx
      {(kannBestaetigen || naechster || menuItems.length > 0) && (
        <Space size="middle" wrap style={{ marginTop: 8, width: '100%', justifyContent: 'flex-end' }}>
          {kannBestaetigen && (
            <Popconfirm
              title="Sofortmeldung bestätigen (Kenntnis genommen)?"
              okText="Bestätigen"
              cancelText="Abbrechen"
              onConfirm={() => onBestaetigen!(m.id)}
            >
              <Button danger>Bestätigen</Button>
            </Popconfirm>
          )}
          {naechster && onStatus && (
            naechster.ziel === 'erledigt'
              ? <Button type="primary" ghost onClick={() => setErledigtOffen(true)}>{naechster.label}</Button>
              : <Button onClick={() => onStatus(m.id, naechster.ziel)}>{naechster.label}</Button>
          )}
          {menuItems.length > 0 && (
            <Dropdown trigger={['click']} menu={{ items: menuItems }}>
              <Button type="text" aria-label={`Aktionen zu Meldung ${m.lfd_nr}`} icon={<MoreOutlined />} />
            </Dropdown>
          )}
        </Space>
      )}
      <Modal
        open={erledigtOffen}
        title="Meldung auf „Erledigt“ setzen?"
        okText="Bestätigen"
        cancelText="Abbrechen"
        onOk={() => { setErledigtOffen(false); onStatus?.(m.id, 'erledigt'); }}
        onCancel={() => setErledigtOffen(false)}
      />
```

- [ ] **Step 4: Test laufen lassen, grün sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm vitest run src/meldungen/MeldungKarte.test.tsx`
Expected: PASS (3 Tests — die zwei Deeplink-Tests plus der neue).

- [ ] **Step 5: „Jede der sechs Aktionen ist auslösbar" als Tests nachziehen**

An `describe('MeldungKarte — Aktionsbündelung …')` anhängen:

```tsx
  it('löst „Bestätigen" über den sichtbaren Knopf aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Bestätigen' }));
    const knoepfe = await screen.findAllByRole('button', { name: 'Bestätigen' });
    await userEvent.click(knoepfe[knoepfe.length - 1]);
    expect(cb.onBestaetigen).toHaveBeenCalledWith(1);
  });

  it('löst den sichtbaren Statusschritt ohne Rückfrage aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    // Kein Popconfirm mehr (LFH-378, umkehrbar): der Klick schaltet unmittelbar.
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'gesichtet');
  });

  it('löst „In Bearbeitung" aus dem Menü aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /In Bearbeitung/ }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'in_bearbeitung');
  });

  it('löst „Erledigt" aus dem Menü erst nach der Rückfrage aus', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Erledigt/ }));
    // Ohne Bestätigung passiert nichts — die Rückfrage ist kein Schmuck.
    expect(cb.onStatus).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'erledigt');
  });

  it('löst „An Lage übergeben" und „Auftrag erteilen" aus dem Menü aus', async () => {
    const cb = alleCallbacks();
    const m = schlimmstenfalls();
    const { unmount } = renderKarte(<MeldungKarte meldung={m} einsatzId={7} {...cb} />);
    await userEvent.click(within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /An Lage übergeben/ }));
    expect(cb.onLagerelevant).toHaveBeenCalledWith(1);
    unmount();
    renderKarte(<MeldungKarte meldung={m} einsatzId={7} {...cb} />);
    await userEvent.click(within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /Auftrag erteilen/ }));
    expect(cb.onAuftragErteilen).toHaveBeenCalledWith(m);
  });

  it('führt bei „in_bearbeitung" „Erledigt" sichtbar — und dann NICHT mehr im Menü', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={meldung({ status: 'in_bearbeitung' })} einsatzId={7} {...cb} />);
    await userEvent.click(screen.getByRole('button', { name: 'Erledigt' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    expect(cb.onStatus).toHaveBeenCalledWith(1, 'erledigt');
    const menue = await oeffneAktionsmenue();
    expect(within(menue).queryByRole('menuitem', { name: /Erledigt/ })).not.toBeInTheDocument();
  });

  it('erreicht den Trigger mit der Tastatur', async () => {
    const cb = alleCallbacks();
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} {...cb} />);
    const trigger = screen.getByRole('button', { name: 'Aktionen zu Meldung 1' });
    trigger.focus();
    expect(trigger).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeInTheDocument();
  });

  it('zeigt ohne Schreibrecht weder Aktionen noch Trigger', () => {
    renderKarte(<MeldungKarte meldung={schlimmstenfalls()} einsatzId={7} darfSchreiben={false} />);
    expect(screen.queryByRole('button', { name: /Aktionen zu Meldung/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sichten' })).not.toBeInTheDocument();
  });
```

- [ ] **Step 6: Testlauf**

Run: `mise exec pnpm@11.10.0 -- pnpm vitest run src/meldungen/MeldungKarte.test.tsx`
Expected: PASS. Schlägt „erreicht den Trigger mit der Tastatur" fehl, weil das Menü nicht
öffnet, ist das ein **echter** Befund (Trigger nicht per Tastatur bedienbar) — nicht den
Test aufweichen, sondern den Trigger reparieren.

- [ ] **Step 7: `MeldungenPage.test.tsx` nachziehen**

Denselben Helfer `oeffneAktionsmenue` oben in der Datei ergänzen (Kopie, kein Import aus
einer fremden `.test.tsx` — das zöge deren Suite in jeden Lauf). Dann:

1. **Zeile ~160 „sichtet eine neue Meldung":** Popconfirm entfällt.
```tsx
    await userEvent.click(screen.getByRole('button', { name: 'Sichten' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'gesichtet'));
```
2. **Zeile ~169 „setzt eine Meldung auf erledigt":** Fixture-Status ist `neu` → „Erledigt"
   liegt im Menü, die Rückfrage ist jetzt ein Dialog.
```tsx
    const menue = await oeffneAktionsmenue();
    await userEvent.click(within(menue).getByRole('menuitem', { name: /Erledigt/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(setzeMeldungStatus).toHaveBeenCalledWith(1, 1, 'erledigt'));
```
   (`within` aus `@testing-library/react` importieren.)
3. **Zeile ~180 „Beobachter sieht keine Status-Aktionen":** ohne Schreibrecht gibt es
   **gar keinen** Trigger — das ist die ehrliche Aussage, nicht „menuitem fehlt".
```tsx
    expect(screen.queryByRole('button', { name: 'Sichten' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aktionen zu Meldung/ })).not.toBeInTheDocument();
```
4. **Zeilen ~189 / ~204 „An Lage übergeben":** über das Menü.
```tsx
    await userEvent.click(within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /An Lage übergeben/ }));
```
5. **Zeile ~221 „lagerelevant … ohne erneute Übergabe-Aktion":** die Aktion muss **im
   geöffneten Menü** fehlen, sonst ist die Aussage nach dem Umbau trivial grün.
```tsx
    expect(screen.getByText('Lagerelevant ✓')).toBeInTheDocument();
    const menue = await oeffneAktionsmenue();
    expect(within(menue).getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(within(menue).queryByRole('menuitem', { name: /An Lage übergeben/ })).not.toBeInTheDocument();
```
6. **Zeile ~245 „bestätigt sie":** unverändert — `Bestätigen` bleibt ein sichtbarer Knopf.
7. **Zeile ~268 „bestätigte Sofortmeldung ohne Bestätigen-Aktion":** zusätzlich belegen,
   dass sie nicht heimlich ins Menü gewandert ist.
```tsx
    expect(screen.queryByRole('button', { name: 'Bestätigen' })).not.toBeInTheDocument();
    expect(within(await oeffneAktionsmenue()).queryByRole('menuitem', { name: /Bestätigen/ })).not.toBeInTheDocument();
```
8. **Zeile ~277 „Auftrag erteilen":** über das Menü öffnen; der Submit-Knopf des Formulars
   heißt weiterhin „Auftrag erteilen", die `findAllByRole`-Konstruktion darunter bleibt.
```tsx
    await userEvent.click(within(await oeffneAktionsmenue()).getByRole('menuitem', { name: /Auftrag erteilen/ }));
```
9. **Zeile ~298 „Backlink statt Erteilen-Aktion":** im Menü prüfen.
```tsx
    const menue = await oeffneAktionsmenue();
    expect(within(menue).getAllByRole('menuitem').length).toBeGreaterThan(0);
    expect(within(menue).queryByRole('menuitem', { name: /Auftrag erteilen/ })).not.toBeInTheDocument();
```

- [ ] **Step 8: Guard-Liste erweitern**

In `frontend/src/components/aktionsabstand.guard.test.ts` an `MIT_NACHBARSCHAFT` anhängen:

```ts
  // ── B5k · Meldungskarte (LFH-372) ─────────────────────────────────────────
  // „Bestätigen" (`danger`) bleibt als sichtbarer Knopf neben der Statusbewegung und dem
  // ⋮-Trigger stehen — die Reihe ist mit der Bündelung von `<Flex gap={8}>` (dichteblinder
  // Festwert) auf `<Space size="middle">` gewechselt. Anders als `pages/lagekarte/Sidebar.tsx`
  // gehört diese Datei damit sehr wohl in die Liste: die destruktive Aktion steht hier NICHT
  // im Menü, sondern in der Reihe, die {@link reihenIn} sieht.
  'meldungen/MeldungKarte.tsx',
```

- [ ] **Step 9: Alle betroffenen Suiten laufen lassen**

Run:
```bash
mise exec pnpm@11.10.0 -- pnpm vitest run \
  src/meldungen/MeldungKarte.test.tsx src/pages/MeldungenPage.test.tsx \
  src/components/aktionsabstand.guard.test.ts src/components/dichte.guard.test.ts
```
Expected: PASS, alle vier Dateien.

- [ ] **Step 10: Lint + Typecheck**

Run: `mise exec pnpm@11.10.0 -- pnpm lint && mise exec pnpm@11.10.0 -- pnpm exec tsc --noEmit`
Expected: beides exit 0 (`--max-warnings 0`).

- [ ] **Step 11: Commit**

```bash
git add frontend/src/meldungen/MeldungKarte.tsx frontend/src/meldungen/MeldungKarte.test.tsx \
        frontend/src/pages/MeldungenPage.test.tsx frontend/src/components/aktionsabstand.guard.test.ts
git commit -m "feat(lfh-372): die Meldungskarte trägt zwei Aktionen, der Rest hängt am Menü"
```

---

### Task 2: Auftragskarte — offene Empfänger stehen einmal

**Files:**
- Modify: `frontend/src/auftraege/AuftragKarte.tsx:63-78` (Ableitungen) und `:146-185` (Zeilen)
- Modify: `frontend/src/pages/AuftraegePage.test.tsx:147-176`

**Interfaces:**
- Consumes: nichts aus Task 1.
- Produces: keine neue API. Verhalten: `snap_anzeige` eines offenen Empfängers erscheint
  **genau einmal** im DOM (Quittungszeile), der eines quittierten **genau einmal** (Chip).

- [ ] **Step 1: Failing test schreiben**

In `frontend/src/pages/AuftraegePage.test.tsx` den Test „trennt die Quittungs-Aktionen
mehrerer Empfänger …" um die neue Aussage erweitern (direkt nach `await screen.findByText('Deich sichern')`):

```tsx
    // LFH-372/B5k: offene Empfänger standen doppelt — einmal als Statuschip, einmal in der
    // Zeile „Quittung offen:". Bei drei Empfängern kostete das auf `handschuh` eine ganze
    // Kartenzeile. Der Chip zeigt jetzt nur noch quittierte.
    expect(screen.getAllByText('EA Nord')).toHaveLength(1);
    expect(screen.getAllByText('EA Süd')).toHaveLength(1);
    expect(screen.getAllByText(/EA West/)).toHaveLength(1);
```

Und einen neuen Test anhängen — ohne Schreibrecht darf die Information nicht verschwinden:

```tsx
  it('nennt offene Empfänger auch ohne Schreibrecht, nur ohne Quittungs-Knopf', async () => {
    vi.mocked(ladeEinsatz).mockResolvedValueOnce({
      id: 1, bezeichnung: 'Lage', status: 'aktiv', meine_rolle: 'beobachter',
    } as Awaited<ReturnType<typeof ladeEinsatz>>);
    renderPage();
    await screen.findByText('Deich sichern');
    // Der Chip zeigt nur Quittiertes, der offene Empfänger steht in der Quittungszeile —
    // fiele sie ohne Schreibrecht weg, verlöre der Beobachter den Namen ganz.
    expect(screen.getByText('EA Nord')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /quittieren/ })).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Test laufen lassen, Fehlschlag sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm vitest run src/pages/AuftraegePage.test.tsx`
Expected: FAIL — „expected length 1, got 2" für `EA Nord`/`EA Süd`.

- [ ] **Step 3: AuftragKarte.tsx umbauen**

Ableitungen (`:76-78`) ersetzen — die Quittungszeile hängt nicht mehr am Schreibrecht,
nur noch ihr Knopf:

```tsx
  // LFH-372/B5k: der Statuschip zeigt nur noch QUITTIERTE Empfänger. Offene standen nach
  // LFH-364 doppelt (Chip + Zeile „Quittung offen:") und kosteten auf `handschuh` eine
  // ganze Kartenzeile. Die Zeile selbst hängt bewusst NICHT am Schreibrecht — sonst
  // verlöre ein Beobachter die Namen der offenen Empfänger vollständig; nur der Knopf tut es.
  const quittierteEmpf = sichtbareEmpf.filter((e) => e.quittiert_at);
  const offeneEmpf = sichtbareEmpf.filter((e) => !e.quittiert_at);
  const darfQuittieren = !!(darfSchreiben && onQuittieren);
```

Die Chip-Reihe (`:150-157`) auf `quittierteEmpf` umstellen (das `+N` für abgeschnittene
Empfänger bleibt, es zählt weiterhin gegen `sichtbareEmpf`):

```tsx
        <Space size={4} wrap>
          {quittierteEmpf.map((e) => (
            <Tag key={e.id} variant="filled" color="green" style={{ margin: 0, fontSize: 12 }}>
              {e.snap_anzeige} ✓
            </Tag>
          ))}
          {restEmpf > 0 && <Text type="secondary" style={{ fontSize: 12 }}>+{restEmpf}</Text>}
        </Space>
```

Die Quittungszeile (`:168-185`) auf `offeneEmpf` / `darfQuittieren` umstellen:

```tsx
      {offeneEmpf.length > 0 && (
        <Flex align="center" gap={8} wrap style={{ marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Quittung offen:</Text>
          {offeneEmpf.map((e) => (
            <Space key={e.id} size={4}>
              <Text style={{ fontSize: 13 }}>{e.snap_anzeige}</Text>
              {darfQuittieren && (
                <Popconfirm
                  title="Empfang/Kenntnis quittieren?"
                  okText="Bestätigen"
                  cancelText="Abbrechen"
                  onConfirm={() => onQuittieren?.(a.id, e.id)}
                >
                  <Button aria-label={`Empfang für ${e.snap_anzeige} quittieren`}>quittieren</Button>
                </Popconfirm>
              )}
            </Space>
          ))}
        </Flex>
      )}
```

Den `offeneQuittungen`-Kommentarblock (`:66-75`) inhaltlich behalten — die LFH-371-Lücke
(`slice(0, 3)`) bleibt unverändert bestehen — aber den Variablennamen anpassen.

- [ ] **Step 4: Test laufen lassen, grün sehen**

Run: `mise exec pnpm@11.10.0 -- pnpm vitest run src/pages/AuftraegePage.test.tsx src/auftraege/AuftragListe.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/auftraege/AuftragKarte.tsx frontend/src/pages/AuftraegePage.test.tsx
git commit -m "feat(lfh-372): offene Empfänger stehen auf der Auftragskarte einmal, nicht zweimal"
```

---

### Task 3: Doku nachziehen und Gesamt-Gate

**Files:**
- Modify: `CLAUDE.md` (Absatz zur Aktionsbündelung, „MeldungKarte ist die begründete Gegenausnahme")

**Interfaces:**
- Consumes: die Zielform aus Task 1 und die Empfängerdarstellung aus Task 2.
- Produces: nichts (Dokumentation).

- [ ] **Step 1: CLAUDE.md korrigieren**

Im Abschnitt „Datensatz-Aktionen werden gebündelt, nicht aufgereiht" den Satz
„**MeldungKarte ist die begründete Gegenausnahme** — dort wurde die Bündelung geprüft und
wegen vier Popconfirms und ~10 Testabfragen verworfen (`meldungen/MeldungKarte.tsx:75-94`,
offen als LFH-372/B5k)." ersetzen durch:

```markdown
  **Die Gegenausnahme ist eingelöst** (LFH-372/B5k): `meldungen/MeldungKarte.tsx` bündelt seit
  02.08.2026. Was die Vertagung teuer machte, war nicht die Bündelung, sondern die **Rückfragen**
  — und die Rechnung war beim Bauen kleiner als beim Schätzen: von „vier Popconfirms im Menü"
  blieb **eine** Rückfrage übrig. `Sichten`/`In Bearbeitung` haben ihre verloren, weil
  `src/meldung/repo.rs:223` jeden Status frei zurücksetzt (LFH-378: erst die Umkehrbarkeit,
  dann die Rückfrage); `Bestätigen` bleibt sichtbarer Knopf und kommt nie ins Menü; `Erledigt`
  trägt ein `<Modal>` — und zwar auf **beiden** Wegen dasselbe, ob es gerade sichtbar oder
  gebündelt steht. Zwei Bauformen für eine Aktion wären ein Unterschied ohne Bedeutung.
  Sichtbar bleiben genau zwei Aktionen: `Bestätigen` und die **eine** Vorwärtsbewegung des
  Triage-Status. Was der Primär-Knopf gerade nicht zeigt, steht im Menü — sonst verlöre eine
  neue Meldung den Direktsprung auf „Erledigt", den der Bestand hatte.
```

- [ ] **Step 2: Vollständiges Gate fahren**

Run: `./scripts/check-all.sh`
Expected: exit 0. **Kein `| tail`** um das Kommando (maskiert den Exit-Code).

Bricht Schritt 7 (e2e) mit „Binary fehlt", ist das kein Fehler dieses Tasks — dann
`cargo build` vorher fahren. Bricht e2e mit Login-Fehlern, prüfen, ob `target/debug` aus
einem `bacon`-Lauf mit `--features dev-seeds` stammt.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(lfh-372): die Gegenausnahme der Meldungskarte ist eingelöst"
```

---

## Offen gelassen (bewusst, gehört nicht hierher)

- **Der Höhenbeleg in Playwright** — laut AK zu B5j (LFH-370), nicht hierher. Vitest darf
  keine Pixel zusichern.
- **`slice(0, 3)` in `AuftragKarte`** — die Lücke „vierter Empfänger offen, Auftrag nie voll
  quittierbar" ist LFH-371 und bleibt unangetastet.
