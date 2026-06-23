# PersonenPage-Drawer → Vollseite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den überladenen Personen-Detail-Drawer (`?person=`) in eine eigene Vollseiten-Route `/einsaetze/:id/personen/:personId` mit Zwei-Spalten-Layout überführen — als Referenzmuster für die Drawer-Reduktion (LFH-19, AK2).

**Architecture:** Neue Komponente `PersonenDetailPage.tsx` nach dem Muster von `BefehlDetailPage.tsx` (Breadcrumb → Header mit Tags/Aktionen → `bearbeiten`-Boolean für Read/Edit). Der heutige `drawerInhalt`-Code (PersonenPage.tsx:289–534) und die Detail-Mutations (175–229) wandern dorthin, aufgeteilt in zwei Spalten (Stammdaten/Zuordnungen/Audit links, med. Verlauf rechts). `PersonenPage` wird List-only; der schlanke `PersonDetailDrawer`-Quick-View bleibt und verlinkt auf die neue Route. Der alte `?person=`-Deep-Link leitet rückwärtskompatibel weiter.

**Tech Stack:** React 18, TypeScript, antd 5, react-router-dom v6, @tanstack/react-query, Vitest + Testing Library + MSW, Playwright (e2e).

## Global Constraints

- pnpm via mise: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend <cmd>`. ABS = `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/feat+lfh-19-drawer-nutzung-reduzieren`.
- **Rules of Hooks:** Alle `useQuery`/`useMutation` stehen oben in der Komponente, *vor* den early-return-Guards (wie in `BefehlDetailPage`). Hooks oben dürfen nur `einsatzId`/`personId`/`navigate` + Literale referenzieren — **niemals** post-guard-Consts (`einsatz`, `zurueck`, `p`, `darfSchreiben`). `enabled`-Bedingungen daher über `einsatzQuery.data?.…` formulieren, nicht über `einsatz.…`.
- **Gating bis Task 6:** Die Drawer→Vollseite-Migration lässt die volle Suite zwischen Task 1 und Task 6 absichtlich teil-rot (alte PersonenPage-Drawer-Tests). Pro Task daher nur die `-t`-gefilterten Tests des jeweiligen Schritts als Gate werten; die **volle** Suite erst in Task 9. Erwartetes Interim-Rot ist kein Task-Fehler.
- Vitest-Gate immer mit `--no-file-parallelism` (Suite sonst flaky).
- Typecheck (`tsc --noEmit`) ist ein eigenes Gate — esbuild/Vitest prüft keine Typen. lib = ES2020: kein `.at()`/`.findLast()`/`Object.hasOwn`.
- Sprache: deutsche UI-Strings/Kommentare, korrekte Umlaute. Fachbegriffe beibehalten (Sichtung, Verbleib, SK, Vermisstenabgleich).
- Keine neuen API-Calls/Backend-Endpunkte — alle Mutations existieren in `../api/einsatzPerson`.
- antd statisches `message`/`Modal` nur über `App.useApp()` (kein Import-Singleton) — sonst Test-Leaks.
- Query-Keys exakt wiederverwenden (Cache-Sharing mit Liste + `PersonDetailDrawer`):
  `['einsatz', einsatzId]`, `['einsatz-person', einsatzId, personId]`,
  `['einsatz-tiere', einsatzId, 'halter', personId]`,
  `['einsatz-schaeden', einsatzId, 'geschaedigt', personId]`,
  `['einsatz-person-audit', einsatzId, personId]`.

---

## File Structure

- **Create** `frontend/src/pages/PersonenDetailPage.tsx` — Vollseiten-Detailansicht einer Person (Read/Edit, Status-FSM, med. Verlauf, Zuordnungen, Audit).
- **Create** `frontend/src/pages/PersonenDetailPage.test.tsx` — Tests der Detailseite (übernimmt die Detail-bezogenen Fälle aus PersonenPage.test.tsx).
- **Modify** `frontend/src/App.tsx:126` — neue Route registrieren.
- **Modify** `frontend/src/pages/PersonenPage.tsx` — Drawer + `drawerInhalt` + Detail-Mutations entfernen; Zeilen-Klick navigiert; `?person=`-Redirect.
- **Modify** `frontend/src/pages/PersonenPage.test.tsx` — Drawer-Tests auf Navigation/Redirect umstellen, Detail-Tests entfernen (umgezogen).
- **Modify** `frontend/src/personen/PersonDetailDrawer.tsx:82` — „Vollständig öffnen" → neue Route.
- **Modify** `CLAUDE.md` — Frontend-Abschnitt mit Drawer-Leitlinie.
- **Create** `frontend/e2e/personen-detail.spec.ts` — e2e: Navigation Liste→Detail + Zwei-Spalten-Layout.

---

## Task 1: Route + DetailPage-Gerüst + Navigation von der Liste

Liefert eine erreichbare (noch minimale) Detailseite und schaltet die Listen-Navigation um. Read/Edit-Inhalt folgt in Task 2/3.

**Files:**
- Create: `frontend/src/pages/PersonenDetailPage.tsx`
- Create: `frontend/src/pages/PersonenDetailPage.test.tsx`
- Modify: `frontend/src/App.tsx` (Import nach Zeile 29, Route nach Zeile 126)
- Modify: `frontend/src/pages/PersonenPage.tsx` (Navigation statt Drawer-State)

**Interfaces:**
- Produces: `export default function PersonenDetailPage()` — liest `useParams() → {id, personId}`, rendert Breadcrumb + Header `Person R-<nr>` + `<Spin>`/`<Alert>`.
- Consumes: `ladeEinsatz` (`../api/einsaetze`), `ladePerson`, `registrierAnzeige` (`../api/einsatzPerson`), `SK_META`/`STATUS_META` (`../personen/personMeta`).

- [ ] **Step 1: Failing test — Klick auf Listenzeile navigiert zur Detail-Route**

In `frontend/src/pages/PersonenPage.test.tsx` die bestehende Route-Definition in der `render`-Hilfe (Zeile 54–61) erweitern, sodass die Detail-Route mitgerendert wird, und einen neuen Test hinzufügen. Zunächst nur diesen Test:

```tsx
// imports oben ergänzen:
import PersonenDetailPage from './PersonenDetailPage';

// In der render()-Hilfe die <Routes> um die Detail-Route erweitern:
//   <Route path="/einsaetze/:id/personen" element={<PersonenPage />} />
//   <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />

it('navigiert beim Klick auf eine Zeile zur Detailseite', async () => {
  server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
  render(einsatzAktiv, [person]);
  await userEvent.click((await screen.findAllByText('Mustermann, Max'))[0]);
  // Detailseite zeigt den Personen-Titel als Heading:
  expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run — fails (PersonenDetailPage existiert nicht)**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenPage.test.tsx -t "navigiert beim Klick"`
Expected: FAIL — Modul `./PersonenDetailPage` nicht auflösbar.

- [ ] **Step 3: PersonenDetailPage-Gerüst anlegen**

```tsx
// frontend/src/pages/PersonenDetailPage.tsx
import { Alert, Breadcrumb, Button, Space, Spin, Tag, Typography } from 'antd';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ladeEinsatz } from '../api/einsaetze';
import { ladePerson, registrierAnzeige } from '../api/einsatzPerson';
import { ApiError } from '../api/client';
import { SK_META, STATUS_META } from '../personen/personMeta';

export default function PersonenDetailPage() {
  const { id, personId: personIdParam } = useParams();
  const einsatzId = Number(id);
  const personId = Number(personIdParam);
  const navigate = useNavigate();

  const einsatzQuery = useQuery({ queryKey: ['einsatz', einsatzId], queryFn: () => ladeEinsatz(einsatzId) });
  const detailQuery = useQuery({
    queryKey: ['einsatz-person', einsatzId, personId],
    queryFn: () => ladePerson(einsatzId, personId),
  });

  if (einsatzQuery.isLoading || detailQuery.isLoading) {
    return <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin size="large" /></div>;
  }
  if (einsatzQuery.isError || !einsatzQuery.data) {
    return <Alert type="error" message="Einsatz nicht gefunden oder kein Zugriff" showIcon />;
  }
  const einsatz = einsatzQuery.data;
  const zurueck = `/einsaetze/${einsatzId}/personen`;

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <Alert
        type="error" showIcon
        message="Person konnte nicht geladen werden"
        description={detailQuery.error instanceof ApiError ? detailQuery.error.message : undefined}
        action={<Button size="small" onClick={() => detailQuery.refetch()}>Erneut versuchen</Button>}
      />
    );
  }
  const p = detailQuery.data;

  return (
    <div>
      <Breadcrumb
        style={{ marginBottom: 12 }}
        items={[
          { title: <Link to="/einsaetze">Einsätze</Link> },
          { title: einsatz.bezeichnung },
          { title: <Link to={zurueck}>Personen</Link> },
          { title: registrierAnzeige(p.registrier_nr) },
        ]}
      />
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }} align="start">
        <Space>
          <Typography.Title level={3} style={{ margin: 0 }}>
            Person {registrierAnzeige(p.registrier_nr)}
          </Typography.Title>
          <Tag color={STATUS_META[p.status].color}>{STATUS_META[p.status].label}</Tag>
          {p.aktuelle_sichtung && <Tag color={SK_META[p.aktuelle_sichtung].color}>{SK_META[p.aktuelle_sichtung].label}</Tag>}
          {p.storniert_at && <Tag color="default">storniert</Tag>}
        </Space>
        <Button onClick={() => navigate(zurueck)}>Zurück zur Liste</Button>
      </Space>
    </div>
  );
}
```

- [ ] **Step 4: Route in App.tsx registrieren**

Import nach `frontend/src/App.tsx:29` (`import SchaedenPage ...`):
```tsx
import PersonenDetailPage from './pages/PersonenDetailPage';
```
Route nach `frontend/src/App.tsx:126` (`<Route path="auftraege/befehle/:bid" ... />`), vor `</Route>`:
```tsx
          <Route path="personen/:personId" element={<PersonenDetailPage />} />
```

- [ ] **Step 5: PersonenPage — Zeilen-Klick navigiert statt Drawer zu öffnen**

In `frontend/src/pages/PersonenPage.tsx` beide `onRow`-Handler (Zeile 603 und 621) ersetzen:
```tsx
onRow={(p) => ({ onClick: () => navigate(`/einsaetze/${einsatzId}/personen/${p.id}`), style: { cursor: 'pointer' } })}
```
(`navigate` ist bereits in PersonenPage vorhanden, Zeile 84.)

- [ ] **Step 6: Run — Navigations-Test grün**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenPage.test.tsx -t "navigiert beim Klick"`
Expected: PASS.

> Hinweis: Andere bestehende Detail-Tests in PersonenPage.test.tsx schlagen jetzt fehl (Drawer weg). Das ist erwartet — sie werden in Task 6 migriert. Bis dahin nur den jeweils adressierten Test (`-t`) ausführen.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/PersonenDetailPage.tsx frontend/src/App.tsx frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(personen): Detailseiten-Gerüst + Route, Liste navigiert statt Drawer (LFH-19)"
```

---

## Task 2: Stammdaten-Spalte (Read/Edit) + Zuordnungen + Audit

Überführt den „Stammdaten"-Tab-Inhalt (PersonenPage.tsx:309–440) als linke Spalte auf die Detailseite, inkl. Status-Übergängen, Bearbeiten/Stornieren, Tiere-/Schäden-Zuordnung und Audit.

**Files:**
- Modify: `frontend/src/pages/PersonenDetailPage.tsx`
- Modify: `frontend/src/pages/PersonenDetailPage.test.tsx`

**Interfaces:**
- Consumes: `aktualisierePerson`, `setzePersonStatus`, `stornierePerson`, `ladePersonAudit`, `type PersonEingabe` (`../api/einsatzPerson`); `listeTiere`, `tierRegistrierAnzeige` (`../api/einsatzTier`); `listeSchaeden`, `schadenRegistrierAnzeige` (`../api/einsatzSchaden`); `useTiereStream`/`useSchaedenStream` (`../etb/...`); Typen `PersonStatus`, `PersonZugriff`, `Tier`, `Spezies`, `Schaden`.
- Produces: linke Spalte als lokale Render-Funktion `stammdatenSpalte(p)` (oder Inline-JSX).

- [ ] **Step 1: Failing test — Read-Modus zeigt Stammdaten, Edit-Button speichert**

In `frontend/src/pages/PersonenDetailPage.test.tsx` anlegen (Muster: BefehlDetailPage.test.tsx + PersonenPage.test.tsx). Vollständiges Test-Gerüst:

```tsx
import { http, HttpResponse } from 'msw';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { server } from '../test/server';
import { renderMitProviders } from '../test/utils';
import { AuthProvider } from '../auth/AuthContext';
import PersonenDetailPage from './PersonenDetailPage';
import type { PersonDetail } from '../api/types';

class FakeEventSource {
  url: string; closed = false;
  constructor(url: string) { this.url = url; }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
beforeEach(() => vi.stubGlobal('EventSource', FakeEventSource));
afterEach(() => vi.unstubAllGlobals());

const admin = {
  id: 1, anzeigename: 'Admin', benutzername: 'admin', system_rolle: 'admin',
  org_rolle: 'keine', aktiv: true, erstellt_at: '2026-05-27 10:00:00',
};
const einsatzAktiv = {
  id: 1, bezeichnung: 'Hochwasser', stichwort: null, status: 'aktiv',
  begonnen_at: '2026-05-27 08:00:00', abgeschlossen_at: null, abgeschlossen_von: null,
  einsatzart: 'realeinsatz', einsatznummer_intern: null, angelegt_at: '2026-05-27 08:00:00',
  leitstellen_nr: null, einsatzort: null, einsatzort_lat: null, einsatzort_lon: null,
  meldende_stelle: null, sachverhalt: null, anzahl_betroffene_initial: null,
  meine_rolle: 'einsatzleitung',
};
const einsatzBeobachter = { ...einsatzAktiv, meine_rolle: 'beobachter' };

const detail = {
  id: 10, einsatz_id: 1, registrier_nr: 1, status: 'erfasst',
  name: 'Mustermann', vorname: 'Max', geschlecht: 'maennlich', geburtsdatum: null,
  alter_geschaetzt: 40, herkunft_adresse: null, antreff_ort: 'Brücke', melder_kontakt: null,
  notiz: null, erfasst_at: '2026-05-27 09:00:00', erfasst_von: 1,
  geaendert_at: '2026-05-27 09:00:00', geaendert_von: 1, storniert_at: null,
  aktuelle_sichtung: null, aktuelle_sichtung_at: null, aktueller_verbleib: null,
  aktuelle_uhs_id: null, aktueller_platz_id: null,
  sichtungen: [], notizen: [], verbleib: [], abgleiche: [],
} as PersonDetail;

function render(einsatzObj: typeof einsatzAktiv, person: PersonDetail, extra: Parameters<typeof server.use> = []) {
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json(admin)),
    http.get('/api/einsaetze/1', () => HttpResponse.json(einsatzObj)),
    http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)),
    http.get('/api/einsaetze/1/tiere', () => HttpResponse.json([])),
    http.get('/api/einsaetze/1/schaeden', () => HttpResponse.json([])),
    ...extra,
  );
  return renderMitProviders(
    <AuthProvider>
      <Routes>
        <Route path="/einsaetze/:id/personen" element={<div>LISTE</div>} />
        <Route path="/einsaetze/:id/personen/:personId" element={<PersonenDetailPage />} />
      </Routes>
    </AuthProvider>,
    { route: '/einsaetze/1/personen/10' },
  );
}

describe('PersonenDetailPage — Stammdaten', () => {
  it('zeigt Read-Modus mit Stammdaten', async () => {
    render(einsatzAktiv, detail);
    expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
    expect(screen.getByText('Mustermann')).toBeInTheDocument();
    expect(screen.getByText('Brücke')).toBeInTheDocument();
  });

  it('Einsatzleitung kann bearbeiten und speichern', async () => {
    // Robust: kein getByLabelText (antd Form bindet label/htmlFor nicht zuverlässig).
    // Edit-Modus öffnen, das mit initialValues={p} vorbefüllte Formular direkt speichern
    // und den PATCH-Aufruf verifizieren.
    let gesendet = false;
    render(einsatzAktiv, detail, [
      http.patch('/api/einsaetze/1/personen/10', async () => {
        gesendet = true;
        return HttpResponse.json({ ...detail });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Speichern' }));
    await vi.waitFor(() => expect(gesendet).toBe(true));
  });

  it('Beobachter sieht keinen Bearbeiten-Button', async () => {
    render(einsatzBeobachter, detail);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByRole('button', { name: 'Bearbeiten' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — fails (kein Bearbeiten-Button / keine Stammdaten)**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenDetailPage.test.tsx`
Expected: FAIL (Bearbeiten-Button/Descriptions fehlen).

- [ ] **Step 3: Stammdaten-Spalte implementieren**

Den verschobenen Code aus `PersonenPage.tsx` übernehmen und an die Detailseite anpassen. Konkret in `PersonenDetailPage.tsx`:

1. Imports erweitern: `Descriptions, Form, Input, InputNumber, Popconfirm, Select, Table, App` (antd), `useState` (react), `useMutation, useQueryClient` (react-query), plus die in **Interfaces** genannten API-/Stream-Importe und Typen. `qc`, `const { message } = App.useApp()`, `fehler`-Helper und `invalidateDetail` analog zu PersonenPage.tsx:97–106/171–174 — mit `personId` statt `offenePersonId`.
2. Streams aktivieren (für Live-Tiere/Schäden): `useTiereStream(einsatzId); useSchaedenStream(einsatzId);`
3. State: `const [bearbeiten, setBearbeiten] = useState(false); const [editForm] = Form.useForm<PersonEingabe>();`
4. Mutations aus PersonenPage.tsx:175–186 übernehmen (`statusMutation`, `editMutation`, `stornoMutation`), wobei `offenePersonId!` → `personId`. `stornoMutation.onSuccess` → `{ invalidate(); navigate(\`/einsaetze/${einsatzId}/personen\`); }` — **inline navigieren** (die post-guard-Const `zurueck` darf in einem oben deklarierten Hook nicht referenziert werden). `invalidate()` hier = `qc.invalidateQueries({ queryKey: ['einsatz-personen', einsatzId] })` + `['etb', einsatzId]` (nutzt nur `einsatzId` → guard-frei, ok).
5. Zusatz-Queries übernehmen (PersonenPage.tsx:155–169) mit `personId`:
   `tiereDerPersonQuery` (`['einsatz-tiere', einsatzId, 'halter', personId]`),
   `schaedenDerPersonQuery` (`['einsatz-schaeden', einsatzId, 'geschaedigt', personId]`),
   `auditQuery` (`['einsatz-person-audit', einsatzId, personId]`, `enabled: einsatzQuery.data?.meine_rolle === 'einsatzleitung'` — **`einsatzQuery.data?.` statt `einsatz.`**, da `einsatz` post-guard ist).
   `darfSchreiben` analog PersonenPage.tsx:238–240. `TIER_SPEZIES_LABEL`, `istPatient`, `naechsteStatus` aus PersonenPage.tsx:37–68 mitkopieren (oder gemeinsam nutzen — hier kopieren, da PersonenPage sie behält).
6. Render: Den **Stammdaten-Tab-`children`-Block** (PersonenPage.tsx:312–439, der `<Space direction="vertical">…</Space>`) 1:1 als linke Spalte verwenden — **ohne** den Status-Tag/Patient/storniert-`<Space>` (313–318, steht jetzt im Header) und **ohne** die Status-Übergänge-`<Space>` (320–329) und Bearbeiten/Stornieren (367–374): diese drei Aktionsgruppen kommen in den Header (Step 4). Der Edit/Read-Block (331–365), Tiere (376–397), Schäden (399–419) und Audit (421–438) bleiben in der Spalte. `navigate('/einsaetze/${einsatzId}/tiere')` und `…/schaeden` bleiben unverändert.

- [ ] **Step 4: Header-Aktionen ergänzen**

Im Header-`<Space>` (Task 1, rechte Seite neben „Zurück zur Liste") die Aktionen einsetzen:
```tsx
{darfSchreiben && !p.storniert_at && !bearbeiten && (
  <Space wrap>
    {naechsteStatus(p.status).map((s) => (
      <Button key={s} size="small" onClick={() => statusMutation.mutate({ personId: p.id, status: s })}>
        → {STATUS_META[s].label}
      </Button>
    ))}
    <Button onClick={() => { setBearbeiten(true); editForm.setFieldsValue(p); }}>Bearbeiten</Button>
    <Popconfirm title="Person stornieren (Soft-Delete)?" onConfirm={() => stornoMutation.mutate(p.id)}>
      <Button danger>Stornieren</Button>
    </Popconfirm>
  </Space>
)}
```
(„Zurück zur Liste" bleibt immer sichtbar.)

- [ ] **Step 5: Run — Stammdaten-Tests grün**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenDetailPage.test.tsx`
Expected: PASS (3 Tests).

- [ ] **Step 6: Typecheck**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend run typecheck`
Expected: 0 Fehler.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/PersonenDetailPage.tsx frontend/src/pages/PersonenDetailPage.test.tsx
git commit -m "feat(personen): Stammdaten-Spalte mit Read/Edit, Status-FSM, Zuordnungen, Audit (LFH-19)"
```

---

## Task 3: Med.-Verlauf-Spalte (Sichtung/Verbleib/Notiz/Timeline/Abgleich)

Überführt den „Medizinischer Verlauf"-Tab-Inhalt (PersonenPage.tsx:442–528) als rechte Spalte, inkl. der zwei Modals (Re-Sichten/Verbleib) und der Notiz-Form.

**Files:**
- Modify: `frontend/src/pages/PersonenDetailPage.tsx`
- Modify: `frontend/src/pages/PersonenDetailPage.test.tsx`

**Interfaces:**
- Consumes: `erfasseSichtung`, `erfasseVerbleib`, `legeNotizAn`, `entscheideAbgleich` (`../api/einsatzPerson`); Typen `Sichtungskategorie`, `VerbleibArt`, `Verbleib`. `kurzVerbleib` aus PersonenPage.tsx:70–79 mitkopieren.
- Produces: rechte Spalte `medSpalte(p, eintraege)` + Modals `<Modal reSichten>`, `<Modal verbleib>`.

- [ ] **Step 1: Failing test — Re-Sichten erfasst SK II**

In `PersonenDetailPage.test.tsx` ergänzen (kein Tab-Klick mehr nötig — beide Spalten sind direkt sichtbar):

```tsx
describe('PersonenDetailPage — med. Verlauf', () => {
  it('Re-Sichten ruft erfasseSichtung mit SK II', async () => {
    let gerufen: { kategorie?: string } = {};
    render(einsatzAktiv, detail, [
      http.post('/api/einsaetze/1/personen/10/sichtung', async ({ request }) => {
        gerufen = await request.json() as { kategorie?: string };
        return HttpResponse.json({ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'sk2',
          notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }, { status: 201 });
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Re-Sichten' }));
    await userEvent.click(await screen.findByRole('combobox', { name: /Kategorie/ }));
    await userEvent.click(await screen.findByText('SK II'));
    await userEvent.click(screen.getByRole('button', { name: 'Übernehmen' }));
    await vi.waitFor(() => expect(gerufen.kategorie).toBe('sk2'));
  });

  it('zeigt bei Sichtung=tot den Hinweis „Status → verstorben"', async () => {
    const totDetail = { ...detail, aktuelle_sichtung: 'tot', aktuelle_sichtung_at: '2026-05-27 10:00:00',
      sichtungen: [{ id: 1, einsatz_id: 1, person_id: 10, kategorie: 'tot',
        notiz: null, gesichtet_at: '2026-05-27 10:00:00', gesichtet_von: 1 }] } as PersonDetail;
    render(einsatzAktiv, totDetail);
    expect(await screen.findByRole('button', { name: /Status → verstorben/ })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenDetailPage.test.tsx -t "med. Verlauf"`
Expected: FAIL (kein Re-Sichten-Button).

- [ ] **Step 3: Med.-Spalte + Modals implementieren**

1. State + Mutations aus PersonenPage.tsx:189–229 übernehmen (`reSichtenOffen`/`sichtungForm`/`sichtungMutation`, `notizForm`/`notizMutation`, `verbleibOffen`/`verbleibForm`/`verbleibMutation`, `abgleichEntscheidenMutation`), `offenePersonId!` → `personId`. (`abgleichVorschlagMutation` bleibt in der Liste — sie wird nur in der Vermisst-Tabelle gebraucht; hier nicht übernehmen.)
2. `eintraege`-Liste aus PersonenPage.tsx:290–304 übernehmen.
3. Render: Den **Med.-Tab-`children`-Block** (PersonenPage.tsx:446–528) 1:1 als rechte Spalte verwenden.
4. Die zwei Modals aus PersonenPage.tsx:690–731 (Re-Sichten, Verbleib) ans Ende der Komponente übernehmen.

- [ ] **Step 4: Run — med.-Tests grün**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenDetailPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PersonenDetailPage.tsx frontend/src/pages/PersonenDetailPage.test.tsx
git commit -m "feat(personen): med.-Verlauf-Spalte mit Sichtung/Verbleib/Notiz/Abgleich (LFH-19)"
```

---

## Task 4: Zwei-Spalten-Layout + responsives Stacking

Bringt die beiden Spalten ins finale Layout (links Stammdaten, rechts med. Verlauf), responsive gestapelt auf schmalen Viewports.

**Files:**
- Modify: `frontend/src/pages/PersonenDetailPage.tsx`
- Modify: `frontend/src/pages/PersonenDetailPage.test.tsx`

- [ ] **Step 1: Failing test — beide Spalten gleichzeitig sichtbar**

```tsx
it('zeigt Stammdaten UND med. Verlauf gleichzeitig (zwei Spalten, ohne Tabs)', async () => {
  render(einsatzAktiv, detail);
  await screen.findByRole('heading', { name: /Person R-001/ });
  expect(screen.getByText('Stammdaten')).toBeInTheDocument();
  expect(screen.getByText(/Chronologischer Verlauf/)).toBeInTheDocument();
  // Keine Tab-Leiste mehr:
  expect(screen.queryByRole('tab', { name: 'Medizinischer Verlauf' })).not.toBeInTheDocument();
});
```
Dazu in den beiden Spalten je eine Abschnitts-Überschrift sicherstellen: links `Stammdaten`, rechts ist `Chronologischer Verlauf …` bereits vorhanden (PersonenPage.tsx:482). Für links eine `<Typography.Text type="secondary" …>Stammdaten</Typography.Text>`-Überschrift am Spaltenkopf ergänzen.

- [ ] **Step 2: Run — fails (noch kein Spalten-Layout / fehlende Überschrift)**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenDetailPage.test.tsx -t "zwei Spalten"`
Expected: FAIL.

- [ ] **Step 3: Row/Col-Layout einsetzen**

`Row, Col` aus antd importieren. Die beiden Spalten-Render in ein responsives Grid setzen (nach dem Header):
```tsx
<Row gutter={24}>
  <Col xs={24} lg={12}>
    <Typography.Text type="secondary" style={{ fontSize: 12, textTransform: 'uppercase' }}>Stammdaten</Typography.Text>
    {/* linke Spalte (Stammdaten/Zuordnungen/Audit) */}
  </Col>
  <Col xs={24} lg={12}>
    {/* rechte Spalte (med. Verlauf) */}
  </Col>
</Row>
```

- [ ] **Step 4: Run — Layout-Test grün + ganze Datei grün**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenDetailPage.test.tsx`
Expected: PASS (alle).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/PersonenDetailPage.tsx frontend/src/pages/PersonenDetailPage.test.tsx
git commit -m "feat(personen): Zwei-Spalten-Layout (Stammdaten | med. Verlauf), responsive (LFH-19)"
```

---

## Task 5: PersonenPage entschlacken + Deep-Link-Redirect + Quick-View-Link

Entfernt Drawer, `drawerInhalt` und die Detail-Mutations aus PersonenPage; macht den alten `?person=`-Link rückwärtskompatibel; richtet den `PersonDetailDrawer`-Link auf die neue Route.

**Files:**
- Modify: `frontend/src/pages/PersonenPage.tsx`
- Modify: `frontend/src/personen/PersonDetailDrawer.tsx`
- Modify: `frontend/src/pages/PersonenPage.test.tsx`

- [ ] **Step 1: Failing test — `?person=<id>` leitet auf die Detail-Route um**

In `PersonenPage.test.tsx` den bestehenden Deep-Link-Test (Zeile 112–118) ersetzen durch:
```tsx
it('leitet den Alt-Deep-Link ?person=<id> auf die Detailseite um', async () => {
  server.use(http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json(person)));
  render(einsatzAktiv, [person], '/einsaetze/1/personen?person=10');
  // Redirect → Detailseite rendert den Heading:
  expect(await screen.findByRole('heading', { name: /Person R-001/ })).toBeInTheDocument();
});
```
(Die `render`-Hilfe rendert die Detail-Route bereits mit, seit Task 1.)

- [ ] **Step 2: Run — fails (alter Code öffnet Drawer statt Redirect)**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenPage.test.tsx -t "Alt-Deep-Link"`
Expected: FAIL.

- [ ] **Step 3: PersonenPage entschlacken**

In `frontend/src/pages/PersonenPage.tsx`:
1. **Deep-Link-Effekt** (Zeile 126–134) umschreiben auf Redirect:
```tsx
useEffect(() => {
  const pid = searchParams.get('person');
  if (pid) navigate(`/einsaetze/${einsatzId}/personen/${pid}`, { replace: true });
}, [searchParams, einsatzId, navigate]);
```
2. Entfernen: State `offenePersonId`, `bearbeiten`, `editForm` (118–120); die Detail-/Zusatz-Queries `detailQuery`, `tiereDerPersonQuery`, `schaedenDerPersonQuery`, `auditQuery` (150–169); `invalidateDetail` (171–174); die Mutations `statusMutation`, `editMutation`, `stornoMutation` (175–186); die Sichtungs-/Notiz-/Verbleib-State+Mutations (189–217); `abgleichEntscheidenMutation` (225–229); die Funktion `drawerInhalt` (289–534); der `<Drawer>` (671–688); die zwei Modals Re-Sichten/Verbleib (690–731).
   **Behalten:** `abgleichVorschlagMutation` (219–224) — wird in der Vermisst-Aktionsspalte (277–287) gebraucht.
3. Streams `useTiereStream`/`useSchaedenStream` (88–89): bleiben nur, falls noch in der Liste genutzt — hier **entfernen** (die „Zugeordnete Tiere/Schäden"-Blöcke sind weg; die Listen-Tabelle nutzt sie nicht). `usePersonenStream` bleibt.
4. Ungenutzte Imports bereinigen: `Descriptions, Drawer, InputNumber, Popconfirm, Tabs` (sofern nicht mehr referenziert — `Tabs` bleibt für die Sicht-Tabs!), `ladePerson, ladePersonAudit, aktualisierePerson, erfasseSichtung, erfasseVerbleib, legeNotizAn, entscheideAbgleich, listeTiere, tierRegistrierAnzeige, listeSchaeden, schadenRegistrierAnzeige`, Typen `PersonDetail, PersonZugriff, Sichtungskategorie, Verbleib, VerbleibArt, Tier, Spezies, Schaden`. Helfer `kurzVerbleib`, `TIER_SPEZIES_LABEL` entfernen, falls nicht mehr referenziert. **Der Typecheck (Step 6) ist die Absicherung — er meldet jeden übrig gebliebenen/fehlenden Import.**

- [ ] **Step 4: PersonDetailDrawer-Link auf neue Route**

`frontend/src/personen/PersonDetailDrawer.tsx:82` ändern:
```tsx
<Button type="link" size="small" onClick={() => navigate(`/einsaetze/${einsatzId}/personen/${p.id}`)}>
```

- [ ] **Step 5: Run — Redirect-Test grün**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenPage.test.tsx -t "Alt-Deep-Link"`
Expected: PASS.

- [ ] **Step 6: Typecheck (fängt verwaiste Imports/Refs)**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend run typecheck`
Expected: 0 Fehler. Bei `TS6133` (unused) / `TS2304` (missing) den jeweiligen Import korrigieren.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/personen/PersonDetailDrawer.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "refactor(personen): Drawer aus Liste entfernen, ?person-Redirect, Quick-View-Link auf Route (LFH-19)"
```

---

## Task 6: Test-Migration abschließen (PersonenPage.test.tsx)

Die Drawer-gekoppelten Detail-Tests in `PersonenPage.test.tsx` sind durch die Umstellung obsolet/rot. Ihre Substanz lebt in `PersonenDetailPage.test.tsx` weiter; die Listen-Tests bleiben.

**Files:**
- Modify: `frontend/src/pages/PersonenPage.test.tsx`

- [ ] **Step 1: Detail-gekoppelte Tests entfernen/umschreiben**

In `PersonenPage.test.tsx` entfernen (Substanz ist in PersonenDetailPage.test.tsx abgedeckt):
- „öffnet den Detail-Drawer beim Klick auf eine Zeile" (95–101) → ersetzt durch „navigiert beim Klick" (Task 1).
- „zeigt eine Fehleranzeige im Drawer …" (103–110) → wandert als Detail-Fehlertest nach PersonenDetailPage.test.tsx (siehe Step 2).
- „Re-Sichten-Aktion …" (133–154), „Verdachts-Abgleich bestätigen" (156–179), „Sichtung=tot …" (181–192), „Zugeordnete Tiere"-Block (194–226), „Als Geschädigte bei Schäden"-Block (318–349), „Detail-Drawer zeigt Patient-Tag" (271–285), „… KEIN Patient-Tag" (287–302) — **entfernen** (in PersonenDetailPage abgedeckt bzw. in Step 2 ergänzt).

**Behalten** (Listen-Verhalten): Sicht „Neu" (65–71), Tab Vermisst (73–79), Anlege-Buttons (81–87), Beobachter ohne Schreibaktionen (89–93), SK-Badge/Lagebild (120–131), Patienten-Tab-Gruppierung (228–249), Patienten-Leerhinweis (251–256), Lagebild-Streifen (258–269), `?neu=1` (304–316), plus „navigiert beim Klick" und „Alt-Deep-Link …" aus Task 1/5.

- [ ] **Step 2: Fehler- + Patient-Tag-Tests in PersonenDetailPage.test.tsx ergänzen**

```tsx
describe('PersonenDetailPage — Robustheit', () => {
  it('zeigt eine Fehleranzeige, wenn der Detail-Abruf scheitert', async () => {
    render(einsatzAktiv, detail, [
      http.get('/api/einsaetze/1/personen/10', () => HttpResponse.json({ error: 'kaputt' }, { status: 500 })),
    ]);
    expect(await screen.findByText('Person konnte nicht geladen werden')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
  });

  it('zeigt das Patient-Tag bei gesichteter Person (SK I)', async () => {
    const patient = { ...detail, status: 'betroffen', aktuelle_sichtung: 'sk1',
      aktuelle_sichtung_at: '2026-05-27 10:00:00' } as PersonDetail;
    render(einsatzAktiv, patient);
    expect((await screen.findAllByText('Patient')).length).toBeGreaterThan(0);
  });

  it('zeigt KEIN Patient-Tag bei unverletzter Person', async () => {
    const unverletzt = { ...detail, status: 'betroffen', aktuelle_sichtung: 'unverletzt',
      aktuelle_sichtung_at: '2026-05-27 10:00:00' } as PersonDetail;
    render(einsatzAktiv, unverletzt);
    await screen.findByRole('heading', { name: /Person R-001/ });
    expect(screen.queryByText('Patient')).not.toBeInTheDocument();
  });
});
```
> Hinweis: Im Fehler-Test überschreibt der `extra`-Handler den Default-200-Handler dank MSW-Prepend-Semantik.

- [ ] **Step 3: Run — beide Test-Dateien grün**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run src/pages/PersonenPage.test.tsx src/pages/PersonenDetailPage.test.tsx`
Expected: PASS (beide Dateien).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/PersonenPage.test.tsx frontend/src/pages/PersonenDetailPage.test.tsx
git commit -m "test(personen): Detail-Tests auf PersonenDetailPage migriert, Liste schlank (LFH-19)"
```

---

## Task 7: Drawer-Leitlinie in CLAUDE.md verankern (AK3)

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Frontend-Leitlinie ergänzen**

An `CLAUDE.md` (Projekt-Root) anhängen:
```markdown
## Frontend — UI-Form-Leitlinie (Drawer-Nutzung)

Die UI-Form richtet sich nach Umfang/Interaktion des Inhalts (LFH-19):

- **Vollseite / eigene Route** (`/einsaetze/:einsatzId/<modul>/:id`) → umfangreiche
  Detail-/Bearbeitungsansichten: mehrere Sektionen/Tabs, >~5 Felder, Workflow, Deep-Link-würdig.
  Referenzmuster: `BefehlDetailPage`, `PersonenDetailPage`.
- **Modal / Dialog** → kurze, blockierende Aktion: Bestätigung, kleines Formular (≤~3 Felder).
- **Inline / Expander** → kontextbezogener Zusatzinhalt, der die Seite nicht verlässt.
- **Drawer** → nur schlanker, fokussierter Quick-View (read-only Vorschau) oder
  Schnellerfassung (≤~4 Felder). Referenz: `PersonDetailDrawer`. Kein Bearbeiten
  umfangreicher Entitäten, keine mehrteiligen Tabs.

Faustregel: Sobald ein Drawer Tabs bekommt, einen Edit-Modus mit vielen Feldern trägt
oder breiter als ~480 px sein muss, gehört der Inhalt auf eine eigene Route.
Details/Inventar: `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: Drawer-/UI-Form-Leitlinie im Frontend-Abschnitt verankern (LFH-19, AK3)"
```

---

## Task 8: e2e — Navigation + Zwei-Spalten-Layout (Playwright)

jsdom rechnet kein Layout; Spaltigkeit/Navigation nur per e2e prüfbar. Backend via Debug-Binary auf `.env.local`-Port.

**Files:**
- Create: `frontend/e2e/personen-detail.spec.ts`

- [ ] **Step 1: e2e-Spec schreiben**

Bestehende Specs unter `frontend/e2e/` als Muster lesen (Login-Helper, baseURL, Seed-Daten). Dann:
```ts
import { test, expect } from '@playwright/test';
// Login + Navigation zu einem Einsatz mit Personen analog bestehender e2e-Specs.

test('Personen: Liste navigiert zur Detail-Vollseite mit zwei Spalten', async ({ page }) => {
  // ... einloggen, zum Personen-Modul eines Seed-Einsatzes navigieren ...
  await page.getByRole('row').filter({ hasText: 'R-' }).first().click();
  await expect(page.getByRole('heading', { name: /Person R-/ })).toBeVisible();
  // Beide Spalten gleichzeitig sichtbar (kein Tab-Wechsel):
  await expect(page.getByText('Stammdaten')).toBeVisible();
  await expect(page.getByText(/Chronologischer Verlauf/)).toBeVisible();
  // Zurück zur Liste:
  await page.getByRole('button', { name: 'Zurück zur Liste' }).click();
  await expect(page.getByRole('heading', { name: 'Personen' })).toBeVisible();
});
```

- [ ] **Step 2: Backend (Debug-Binary) + Frontend-Build hochziehen, e2e laufen lassen**

Frontend ist via rust-embed ins Binary eingebettet → vor e2e `pnpm -C <ABS>/frontend build`, dann Debug-Backend auf `.env.local`-Port starten (Muster: bestehende e2e-Harness). Dann:
Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec playwright test personen-detail`
Expected: PASS. (Bei Harness-Problemen die bestehende e2e-README/Konvention im Repo befolgen.)

- [ ] **Step 3: Commit**

```bash
git add frontend/e2e/personen-detail.spec.ts
git commit -m "test(e2e): Personen-Detail-Vollseite Navigation + Zwei-Spalten-Layout (LFH-19)"
```

---

## Task 9: Vollständiges Gate + Abschluss

- [ ] **Step 1: Volle Vitest-Suite (stabiles Gate)**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend exec vitest run --no-file-parallelism`
Expected: alle grün (Baseline war 827 Tests; Netto leicht verändert durch Migration).

- [ ] **Step 2: Typecheck + Lint**

Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend run typecheck`
Run: `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend run lint`
Expected: je 0 Fehler.

- [ ] **Step 3: Manuelle Sicht (rust-embed)**

`pnpm -C <ABS>/frontend build` + Backend-Neustart; PersonenPage öffnen, Zeile klicken → Vollseite mit zwei Spalten; Bearbeiten/Re-Sichten/Verbleib testen; `?person=<id>` leitet um; `PersonDetailDrawer` „Vollständig öffnen" landet auf der Vollseite.

---

## Self-Review (Plan ↔ Spec)

- **AK2 (PersonenPage-Umstellung):** Tasks 1–6 — Route, Zwei-Spalten-Read/Edit, med. Verlauf, Liste entschlackt, Redirect, Quick-View-Link, Tests migriert. ✓
- **AK3 (Leitlinie):** Task 7 (CLAUDE.md) + Spec-Doc (committed). ✓
- **AK1 (Inventur):** Spec-Doc (committed); ClickUp-Kommentar an LFH-19 außerhalb dieses Plans (durch dev-clickup-ausfuehren). ✓
- **Layout zwei Spalten, ohne Tabs:** Task 4. ✓
- **Rückwärtskompatibler `?person=`-Link:** Task 5. ✓
- **Quick-View bleibt + Link angepasst:** Task 5. ✓
- **Tests (Vitest + e2e):** Tasks 1–6, 8, 9. ✓
- **Keine neuen API-Calls:** alle Mutations aus `../api/einsatzPerson` wiederverwendet. ✓
- **Type-Konsistenz:** `personId` (DetailPage) ersetzt durchgängig `offenePersonId`; `bearbeiten`/`editForm`/`statusMutation`/`editMutation`/`stornoMutation`/`sichtungMutation`/`verbleibMutation`/`notizMutation`/`abgleichEntscheidenMutation` mit identischen Signaturen wie heute. ✓

## Hinweise für den Rest (Workflow, separat)

Nach grüner Referenz dient `PersonenDetailPage` als Vorlage für TierePage/SchaedenPage
(→ Vollseite) und die Bewertung von UhsDetail-Tabs/GefahrengebietMatrix — je eigener
Subtask unter Epic `86ca33mmk`, eigener Branch/PR. Schlanke Drawer bleiben.
