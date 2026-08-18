# LFH-340 · C5 Betroffene-Module bedienbar machen — Umsetzungsplan

> **Für agentische Bearbeiter:** REQUIRED SUB-SKILL: `superpowers:executing-plans`.
> Schritte tragen Checkbox-Syntax (`- [ ]`).

**Ziel:** Die drei Betroffenen-Module (Personen, Tiere, Schäden) auf die vorhandenen
Band-B-Primitive ziehen, die Personen-Aufnahme auf ≤ 4 Interaktionen ohne Seitenwechsel
bringen und die Personen-Detailseite auf eine Primäraktion plus zwei Startabfragen reduzieren.

**Architektur:** Kein neues Primitiv. `EinsatzSeite` (Seitenkopf), `Datensicht` (Tabelle/Karte),
`SeitenZustand` (Fehler/Leer/Stale) und `ErfassungsModal` (Serie) liegen alle vor; C5 ist
Konsumarbeit plus **eine** Backend-Erweiterung (Sichtung beim Anlegen) und **ein** neues
Formular-Bauteil, das an zwei Stellen montiert wird (Modal + Route).

**Tech-Stack:** React 19 · antd 6 · TanStack Query 5 · Vitest 4/jsdom 29 · Playwright · Rust/axum/sqlx.

**Spec:** ClickUp LFH-340 (Board 901523554968) · `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`

## Gemessener Ausgangsstand (18.08.2026, HEAD = fbea94a0)

**Bereits abgetragen durch Band B — nicht erneut bauen:**

| Ticketpunkt | Beleg |
|---|---|
| Fehler-/Stale-Zustand aller drei Listen | `SeitenFehler`/`SeitenStandVeraltet` in allen drei Seiten |
| AK1 (Fehlertest je Seite, inkl. Negativaussage) | `PersonenPage.test.tsx:894-897`, `TierePage.test.tsx:650-652`, `SchaedenPage.test.tsx:594-596` — Knopf heißt **„Erneut abrufen"**, nicht „Erneut versuchen" |
| Tab-Wechsel nach dem Anlegen | `PersonenPage.tsx:137` (`zielSicht`), `TierePage.tsx` (`frischAngelegt` + `scrolleZurZeile`) |
| Registriernummer-Quittung (H30) | `PersonenPage.tsx:162` „Erfasst als R-…", stehende `Alert`, sogar offline-persistiert |
| Serienerfassung (H32) | `serie` + `uebernahme` in allen drei Erfassungsmasken |
| „seit"-Spalte, Sortierung, Suche (M35) | `personenSpalten.tsx:126`, `TierePage.tsx:129` — **nur Schäden fehlt** |
| `size="small"` an Aktionsknöpfen (M36) | 0 Treffer an `<Button`/`<Select`; die 3 Restbefunde sind `Descriptions` und laut CLAUDE.md ausdrücklich draußen |
| Seitenkopf-Primitiv (M41) | `components/EinsatzSeite.tsx` existiert mit 15 Konsumenten — **C5 ist nicht mehr Eigentümer, sondern Konsument** |

**Rest, den dieser Plan abarbeitet:** SchaedenPage als Ausreißerseite · die drei Listenköpfe
auf `EinsatzSeite` · Kopfleiste der Personen-Detailseite · Ladehoheit der Detailseite ·
Sichtungskategorie in der Aufnahme · Aufnahme-Route · Verortungsstatus Schäden · e2e 390 px ·
Prüfliste.

## Globale Randbedingungen

- **Dichte:** kein neues punktuelles `size="small"` an interaktiven Elementen
  (`components/dichte.guard.test.ts`, Schuldmenge darf nur schrumpfen). `Descriptions`/`Card`
  bleiben ausdrücklich draußen — nicht „aufräumen".
- **Aktionsabstand:** eine `<Space>`-Reihe mit `danger`-Knopf **und** weiterer Aktion trägt
  `size="middle"` (`components/aktionsabstand.guard.test.ts`). Wandert das Löschen in ein
  **Menü**, gehört die Datei in **keine** der beiden Guard-Listen — der Scanner sieht
  `danger`-Menüeinträge nicht; geprüft wird dann der Menü-Trenner im Komponententest.
- **Bündelung:** ab drei Aktionen (**nach** der Rechteprüfung gezählt) ein `Dropdown` mit
  `menu={{ items }}`, `trigger={['click']}`, `autoFocus`, `onClick` am **`menu`**, icon-only
  `<Button type="text">` mit Zeilenkennung im zugänglichen Namen. Rückfrage im Menü = `<Modal>`
  mit eigenem State, **nie** `Popconfirm`.
- **Routen-URLs** ausschließlich über `frontend/src/routing/deeplinks.ts`.
- **Query-Keys** ausschließlich über `frontend/src/api/queryKeys.ts`.
- **Statuscodes:** Feld isoliert unbrauchbar → 400; Feld-*Kombination*/Zustand → 422.
- **Backend-Typänderung** → `scripts/check-typ-codegen.sh` laufen lassen, `openapi.json` +
  `types.generated.ts` **mitcommitten**.
- **Gate:** `./scripts/check-all.sh`, kein `| tail` um Gate-Kommandos.
- **Tests:** `test/utils.tsx` rendert ein nacktes `ConfigProvider` — Höhen-/Trefferflächen-
  Behauptungen gehören nach Playwright, nicht nach Vitest.

---

### Task 1: SchaedenPage auf `EinsatzSeite` + `Datensicht`

Räumt M41 (Layout-Ausreißer), H33 (kein Karten-Fallback) und M35 (keine Zeit/Sortierung) für
die Schadensliste in einem Zug. Vorbild ist `TierePage` — dieselbe Bauform, dieselben Namen.

**Dateien:**
- Ändern: `frontend/src/pages/SchaedenPage.tsx` (heute `div padding:16` + `Title level={4}` + `KatalogTabelle`)
- Ändern: `frontend/src/pages/SchaedenPage.test.tsx`

**Schnittstellen:**
- Konsumiert: `EinsatzSeite` (`titel`, `breadcrumb`, `aktionen`, `hinweis`, `dataUpdatedAt`, `breite`),
  `Datensicht` (`spalten`, `daten`, `zeilenSchluessel`, `karte`, `suche`, `standardSortierung`,
  `leerText`, `onZeileKlick`), `spaltenFuer`, `Kartenplan`
- Produziert: `schadenSpalten(einsatzId)`, `schadenKarte(einsatzId)`, `SchadenSpaltenKey`

- [ ] **Schritt 1: Failing test — Kopf und Kartenzweig**

```tsx
// in pages/SchaedenPage.test.tsx
it('trägt den gemeinsamen Modulkopf: Breadcrumb, Einsatz-Status und Datenstand', async () => {
  renderMitProviders(<SchaedenPage />, { route: `/einsaetze/1/schaeden` });
  expect(await screen.findByRole('link', { name: 'Einsätze' })).toBeInTheDocument();
  // Der Titel steht als level 4 im Primitiv — nicht als handgebauter level-4-Title ohne Breadcrumb.
  expect(screen.getByRole('heading', { level: 4, name: /Schäden/ })).toBeInTheDocument();
  expect(screen.getByText('aktiv')).toBeInTheDocument();
});

it('rendert die Liste über das Datensicht-Primitiv mit „seit"-Spalte', async () => {
  renderMitProviders(<SchaedenPage />, { route: `/einsaetze/1/schaeden` });
  expect(await screen.findByRole('columnheader', { name: /seit/ })).toBeInTheDocument();
  expect(screen.getByPlaceholderText('S-Nr., Ort, Beschreibung')).toBeInTheDocument();
});
```

- [ ] **Schritt 2: Test laufen lassen — muss scheitern**

`mise exec pnpm@11.10.0 -- pnpm -C "$PWD/frontend" exec vitest run src/pages/SchaedenPage.test.tsx`
Erwartet: FAIL (kein Breadcrumb, kein columnheader „seit", kein Suchplatzhalter).

- [ ] **Schritt 3: Spalten + Kartenplan**

```tsx
const schadenSpalten = (einsatzId: number) => spaltenFuer<Schaden>()([
  { title: 'Reg.-Nr.', key: 'reg', immerSichtbar: true,
    sortWert: (s) => s.registrier_nr,
    suchText: (s) => schadenRegistrierAnzeige(s.registrier_nr),
    render: (_, s) => <strong>{schadenRegistrierAnzeige(s.registrier_nr)}</strong> },
  { title: 'Typ', key: 'typ', sortWert: (s) => s.typ,
    filter: { werte: (Object.keys(TYP_LABEL) as SchadenTyp[]).map((t) => ({ wert: t, etikett: TYP_LABEL[t] })) },
    render: (_, s) => <Tag>{TYP_LABEL[s.typ]}</Tag> },
  { title: 'Ausmaß', key: 'ausmass', sortWert: (s) => s.ausmass,
    render: (_, s) => <Tag color={AUSMASS_META[s.ausmass].color}>{AUSMASS_META[s.ausmass].label}</Tag> },
  { title: 'Ort', key: 'ort', suchText: (s) => s.ort, render: (_, s) => s.ort ?? '—' },
  { title: 'Status', key: 'status',
    render: (_, s) => (
      <Tag color={STATUS_META[s.status].color}>
        {STATUS_META[s.status].label}{s.status === 'uebergeben' && s.uebergeben_an ? ` (${s.uebergeben_an})` : ''}
      </Tag>) },
  // „seit": Alter des Eintrags. `erfasst_at`, NICHT `geaendert_at` — dieselbe Begründung
  // wie in `TierePage.tsx:120` (geaendert_at läuft bei jeder Notiz weiter).
  { title: 'seit', key: 'seit', sortWert: (s) => s.erfasst_at,
    render: (_, s) => <ZeitAnzeige wert={s.erfasst_at} /> },
  { title: 'Geschädigt', key: 'geschaedigt', abBreite: 'lg',
    render: (_, s) => geschaedigtAnzeige(s, einsatzId) },
]);

type SchadenSpaltenKey = ReturnType<typeof schadenSpalten>[number]['key'];

const schadenKarte = (einsatzId: number): Kartenplan<Schaden, SchadenSpaltenKey> => ({
  art: 'plan',
  titel: { spalte: 'reg', ziel: (s) => schadenDetailPfad(einsatzId, s.id) },
  sekundaer: ['ort', 'ausmass', 'seit'],
});
```

`geschaedigtAnzeige` braucht `einsatzId`, deshalb ist die Spaltenliste eine **Funktion von
`einsatzId`** und wird in der Seite per `useMemo` gehalten — genau wie in `PersonenPage`.
Der `Datensicht`-`key` trägt die Reiterachse (`key={sicht}`); Begründung wörtlich wie
`TierePage.tsx:364`: sonst überlebt der Suchbegriff den Reiterwechsel und streicht eine fremde
Menge zusammen.

- [ ] **Schritt 4: Seitenrahmen tauschen**

`<div style={{ padding: 16 }}>` entfällt ersatzlos (Padding ausschließlich im Layout,
`einsatz/EinsatzLayout.tsx:106`). Stattdessen:

```tsx
<EinsatzSeite
  breite={flaeche.seiteBreit}
  titel={<Space>Schäden <Tag color={einsatz.status === 'aktiv' ? 'green' : 'default'}>{einsatz.status}</Tag></Space>}
  dataUpdatedAt={schaedenQuery.dataUpdatedAt}
  breadcrumb={<Breadcrumb items={[
    { title: <Link to="/einsaetze">Einsätze</Link> },
    { title: einsatz.bezeichnung },
    { title: 'Schäden' },
  ]} />}
  aktionen={darfSchreiben && (
    <Button type="primary" onClick={() => setErfassenOffen(true)}>Schnellerfassung</Button>
  )}
  hinweis={!darfSchreiben && einsatz.status !== 'aktiv' && (
    <Alert type="info" showIcon title="Einsatz ist abgeschlossen — nur Ansicht." />
  )}
>
```

Die beiden Filter-`Select` (Typ, Ausmaß) und `Input.Search` wandern **ins Primitiv**:
`suche={{ platzhalter: 'S-Nr., Ort, Beschreibung' }}` plus `filter` an den Spalten.
`filterSchaeden` behält nur noch die Reiter-Achse (`sicht`) — die anderen Argumente entfallen,
`schadenHelfer.ts` und sein Test ziehen mit.

- [ ] **Schritt 5: Tests laufen lassen**

`… vitest run src/pages/SchaedenPage.test.tsx` — erwartet PASS. Bestandstests, die auf
`.ant-table` oder die alten Filter-`Select` zeigen, mitziehen (nicht löschen: auf die
Datensicht-Werkzeuge umstellen).

- [ ] **Schritt 6: Commit**

```bash
git add frontend/src/pages/SchaedenPage.tsx frontend/src/pages/SchaedenPage.test.tsx frontend/src/pages/schaeden/
git commit -m "refactor(lfh-340): zieht die Schadensliste auf Seitenkopf und Datensicht"
```

---

### Task 2: Personen- und Tiere-Liste auf `EinsatzSeite`

Beide bauen den Kopf heute von Hand (`PersonenPage.tsx:423-441`, `TierePage.tsx` analog) —
Breadcrumb, `Title level={3}`, Status-Tag, `Datenstand`, Schreibrecht-Alert. Genau das ist der
`EinsatzSeite`-Slotsatz. Ohne diesen Schritt bleibt „gemeinsamer Seitenkopf" eine Behauptung.

**Dateien:**
- Ändern: `frontend/src/pages/PersonenPage.tsx`, `frontend/src/pages/TierePage.tsx`
- Ändern: die zugehörigen `.test.tsx`

- [ ] **Schritt 1: Failing test je Seite**

```tsx
it('trägt den gemeinsamen Modulkopf statt eines handgebauten Title', async () => {
  renderMitProviders(<PersonenPage />, { route: '/einsaetze/1/personen' });
  // Das Primitiv setzt level 4 (EinsatzSeite.tsx) — ein level-3-Heading bewiese den Handbau.
  expect(await screen.findByRole('heading', { level: 4, name: /Personen/ })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
});
```

Die zweite Zeile ist die tragende: „level 4 vorhanden" allein wäre auch dann grün, wenn der
Handbau daneben stehen bliebe.

- [ ] **Schritt 2: Test laufen lassen — FAIL** (`heading level 3` steht heute)

- [ ] **Schritt 3: Kopf tauschen**

`titel` = `<Space>Personen <Tag …>{einsatz.status}</Tag></Space>`, `breadcrumb`,
`dataUpdatedAt={personenQuery.dataUpdatedAt}`, `hinweis` = Schreibrecht-Alert,
`aktionen` = die drei Erfassungsknöpfe (genau **einer** `type="primary"`, wie heute),
`breite={flaeche.seiteBreit}`.

Die Quittungs-`Alert` bleibt **im `children`-Bereich** über den Reitern, nicht im `hinweis`-Slot:
`hinweis` trägt den Schreibrecht-Zustand, beide gleichzeitig verdrängten einander.

- [ ] **Schritt 4: Tests grün** — je Seite die volle Datei fahren.

- [ ] **Schritt 5: Commit**

```bash
git add frontend/src/pages/PersonenPage.tsx frontend/src/pages/TierePage.tsx frontend/src/pages/PersonenPage.test.tsx frontend/src/pages/TierePage.test.tsx
git commit -m "refactor(lfh-340): zieht Personen- und Tiereliste auf den gemeinsamen Seitenkopf"
```

---

### Task 3: Kopfleiste der Personen-Detailseite — eine Primäraktion, Status im Menü

Löst M37. Heute stehen im `aktionen`-Slot: n Statuswechsel-Knöpfe (`naechsteStatus(p.status)`),
„Bearbeiten", „Stornieren" (danger) und „Zurück zur Liste" — **null** `type="primary"`.

**Dateien:**
- Ändern: `frontend/src/pages/PersonenDetailPage.tsx:642-688`
- Ändern: `frontend/src/pages/PersonenDetailPage.test.tsx`

**Zielform:**
- **Genau eine Primäraktion**, kontextabhängig: nicht gesichtet → `Sichten` (öffnet das
  vorhandene Sichtungs-Modal); Patient (`istPatient(p)`) → `Verbleib erfassen`;
  sonst → `Bearbeiten`.
- **Alles Weitere in ein Dropdown** „Weitere Aktionen": Statuswechsel aus
  `naechsteStatus(p.status)`, `Bearbeiten` (wenn nicht primär), `Stornieren` (danger, hinter
  Menü-Trenner).
- **„→ verstorben" und „Stornieren" tragen ein `<Modal>`** mit eigenem State — kein
  `Popconfirm` im Menü-Label, und der Dialog steht **außerhalb** jeder `map`.
- **„Zurück zur Liste" entfällt** — der Breadcrumb trägt den Rückweg (`:632-641`).

- [ ] **Schritt 1: Failing tests**

```tsx
it('Kopfleiste: genau eine Primäraktion', async () => {
  renderDetail({ status: 'erfasst', aktuelle_sichtung: null });
  await screen.findByRole('heading', { level: 4 });
  const primaer = screen.getAllByRole('button')
    .filter((b) => Array.from(b.classList).some((k) => k.endsWith('-btn-primary')));
  expect(primaer).toHaveLength(1);
  expect(primaer[0]).toHaveAccessibleName('Sichten');
});

it('bündelt die Statuswechsel im Menü und lässt „Zurück zur Liste" weg', async () => {
  renderDetail({ status: 'erfasst' });
  expect(screen.queryByRole('button', { name: 'Zurück zur Liste' })).not.toBeInTheDocument();
  // Vor dem Öffnen gibt es KEINEN menuitem — rc-dropdown mountet lazy. Die belastbare
  // Negativaussage ist deshalb „kein direkter Knopf", nicht „kein Eintrag".
  expect(screen.queryByRole('button', { name: '→ betroffen' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Weitere Aktionen/ }));
  const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]') as HTMLElement;
  expect(within(menue).getByRole('menuitem', { name: /betroffen/ })).toBeInTheDocument();
});

it('„verstorben" fragt über einen Dialog zurück, nicht über ein Popconfirm', async () => {
  renderDetail({ status: 'betroffen' });
  await userEvent.click(screen.getByRole('button', { name: /Weitere Aktionen/ }));
  const menue = document.querySelector('.ant-dropdown:not(.ant-dropdown-hidden) [role="menu"]') as HTMLElement;
  await userEvent.click(within(menue).getByRole('menuitem', { name: /verstorben/ }));
  expect(await screen.findByRole('dialog')).toHaveTextContent(/verstorben/i);
  expect(statusSpy).not.toHaveBeenCalled();          // erst nach der Bestätigung
  await userEvent.click(screen.getByRole('button', { name: 'Status setzen' }));
  expect(statusSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'verstorben' }));
});

it('ohne Schreibrecht steht gar kein Auslöser', async () => {
  renderDetail({ status: 'erfasst' }, { schreibrecht: false });
  await screen.findByRole('heading', { level: 4 });
  expect(screen.queryByRole('button', { name: /Weitere Aktionen/ })).not.toBeInTheDocument();
});
```

- [ ] **Schritt 2: Tests laufen lassen — FAIL**

- [ ] **Schritt 3: Kopfleiste umbauen**

```tsx
const [statusDialog, setStatusDialog] = useState<PersonStatus | null>(null);
const IRREVERSIBEL: PersonStatus[] = ['verstorben'];

const menueEintraege = [
  ...naechsteStatus(p.status).map((s) => ({ key: `status:${s}`, label: `→ ${STATUS_META[s].label}` })),
  { type: 'divider' as const },
  { key: 'bearbeiten', label: 'Bearbeiten' },
  { key: 'stornieren', label: 'Stornieren', danger: true },
];
```

`onClick` liegt am **`menu`**, nicht je Eintrag: ein Riegel hat dann einen Ort. Irreversible
Ziele setzen `statusDialog`, alle anderen rufen die Mutation direkt. Auslöser:
`<Button type="text" icon={<MoreOutlined />} aria-label={'Weitere Aktionen zu Person ' + registrierAnzeige(p.registrier_nr)} />`.
Bleibt nach der Rechteprüfung keine Aktion übrig, wird **gar kein** Auslöser gerendert.

- [ ] **Schritt 4: Guard-Listen prüfen (und nicht falsch füttern)**

`PersonenDetailPage.tsx` gehört nach dem Umbau in **keine** der Listen von
`components/aktionsabstand.guard.test.ts` — der Scanner matcht `<Button` mit `danger` im Tag und
sieht `danger`-**Menüeinträge** nicht. Steht die Datei dort heute drin: austragen und im Commit
begründen. Prüfen mit:
`… vitest run src/components/aktionsabstand.guard.test.ts src/components/dichte.guard.test.ts`

- [ ] **Schritt 5: Tests grün** — `… vitest run src/pages/PersonenDetailPage.test.tsx`

- [ ] **Schritt 6: Commit**

```bash
git add frontend/src/pages/PersonenDetailPage.tsx frontend/src/pages/PersonenDetailPage.test.tsx frontend/src/components/aktionsabstand.guard.test.ts
git commit -m "feat(lfh-340): gibt der Personen-Detailseite einen Anker und bündelt die Statuswechsel"
```

---

### Task 4: Ladehoheit der Personen-Detailseite (AK6: höchstens 2 Startabfragen)

Löst M40. Heute fünf unbedingte `useQuery` (`:71, :72, :81, :86, :92`) plus Audit (`:97`).

**Dateien:**
- Ändern: `frontend/src/pages/PersonenDetailPage.tsx:81-101, 490-605`
- Ändern: `frontend/src/pages/PersonenDetailPage.test.tsx`

**Zielform:** `einsatzQuery` + `detailQuery` sofort. `tiereDerPersonQuery`,
`schaedenDerPersonQuery`, `uhsListeQuery` und `auditQuery` bekommen
`enabled: idGueltig && zuordnungenOffen` bzw. `&& auditOffen`; die vier Blöcke wandern in ein
`<Collapse>` (Inline/Expander gemäß LFH-19) mit den Panels „Zuordnungen" und „Zugriffs-Audit".

Die UHS-Liste ist eingeklappt entbehrlich: `person.aktuelle_uhs_id` kommt aus dem Detail, der
Fallback `UHS #${id}` steht bereits (`:566-567`). Sie wird **zusätzlich** vom Zuweisungs-Modal
gebraucht (`:757`) — dort per `|| uhsModalOffen` mit anhängen, sonst lädt das Modal nichts.
Bauform steht im Bestand: `:265/:270` binden Queries schon an `tierModalOffen`/`schadenModalOffen`.

- [ ] **Schritt 1: Failing test — Startabfragen zählen**

```tsx
it('setzt beim Öffnen höchstens zwei Abfragen ab', async () => {
  const abfragen: string[] = [];
  server.events.on('request:start', ({ request }) => abfragen.push(new URL(request.url).pathname));
  renderDetail({ status: 'betroffen' });
  await screen.findByRole('heading', { level: 4 });
  expect(abfragen).toHaveLength(2);
});

it('lädt die Zuordnungen erst beim Aufklappen', async () => {
  renderDetail({ status: 'betroffen' });
  await screen.findByRole('heading', { level: 4 });
  expect(screen.queryByText('Zugeordnete Tiere')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /Zuordnungen/ }));
  expect(await screen.findByText('Zugeordnete Tiere')).toBeInTheDocument();
});
```

Die zweite Hälfte ist Pflicht: „höchstens 2" allein wäre auch grün, wenn die Zuordnungen gar
nicht mehr lüden.

- [ ] **Schritt 2: Test laufen lassen — FAIL** (heute 5–6 Abfragen)

- [ ] **Schritt 3: Umbau** — `useState` für `zuordnungenOffen`/`auditOffen`, `enabled` daran
hängen, die vier `<div>`-Blöcke in `<Collapse items={[…]}>` verschieben. **Kein `forceRender`**
— sonst stehen die Panels im Baum und „erst beim Aufklappen" wird bedeutungslos.

- [ ] **Schritt 4: Tests grün**

- [ ] **Schritt 5: Commit**

```bash
git commit -am "perf(lfh-340): lädt Zuordnungen und Audit der Personenseite erst beim Aufklappen"
```

---

### Task 5: Backend — Sichtung beim Anlegen

Voraussetzung für AK2 (≤ 4 Interaktionen). Der Client soll die Sichtung **nicht** als zweiten
Request nachschieben: die Personen-Erfassung hat eine Offline-Queue mit `client_id`-Idempotenz
(`einsatz_person.rs:163-172`), ein zweiter Request bräche sie auf.

**Dateien:**
- Ändern: `src/routes/einsatz_person.rs:121-246` (`AnlegenBody`, `anlegen`)
- Test: `tests/einsatz_person_anlegen_sichtung.rs` (neu)
- Generat: `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`
- Ändern: `frontend/src/api/einsatzPerson.ts` (`PersonAnlegenEingabe`, handgepflegtes Request-DTO)

**Schnittstellen:**
- Produziert: `AnlegenBody.sichtung: Option<String>`; Antwort bleibt `PersonAnzeige`, jetzt mit
  gesetztem `aktuelle_sichtung` und Status `betroffen`.

- [ ] **Schritt 1: Failing tests**

```rust
#[tokio::test]
async fn anlegen_mit_sichtung_setzt_kategorie_und_hebt_auf_betroffen() {
    // erwartet 201, person["status"] == "betroffen", person["aktuelle_sichtung"] == "sk2"
}

#[tokio::test]
async fn anlegen_mit_sichtung_und_status_vermisst_ist_422() {
    // Feld-KOMBINATION, nicht Feld für sich → 422 (LFH-267/F22).
}

#[tokio::test]
async fn anlegen_mit_unbekannter_sichtung_ist_400() {
    // Feld isoliert unbrauchbar → 400.
}

#[tokio::test]
async fn replay_derselben_client_id_legt_die_sichtung_nicht_doppelt_an() {
    // Zweimal derselbe Body mit client_id → eine Person, EINE Sichtung im Detail.
}
```

Der vierte Test ist der, der die Offline-Begründung dieser Erweiterung überhaupt einlöst.

- [ ] **Schritt 2: `cargo test --test einsatz_person_anlegen_sichtung` — FAIL**

- [ ] **Schritt 3: Implementieren**

```rust
// AnlegenBody
/// Optionale Erst-Sichtung. Schreibt die Sichtung in DERSELBEN Transaktion wie die
/// Anlage und hebt `erfasst→betroffen` — dieselbe Mechanik wie der dedizierte
/// Sichtungs-Endpunkt (`sichten`), nur ohne zweiten Request. Der zweite Request wäre
/// nicht bloß langsamer: die Erfassung hat eine Offline-Queue mit `client_id`-Idempotenz,
/// ein nachgeschobener Sichtungs-Call hätte keine.
pub sichtung: Option<String>,
```

Im Handler nach `pruefe_geschlecht`:

```rust
let sichtung = trimme(body.sichtung);
let kategorie = match sichtung.as_deref() {
    None => None,
    Some(roh) => Some(Sichtungskategorie::parse(roh).ok_or_else(|| {
        AppError::Validation("Unbekannte Sichtungskategorie".into())            // 400
    })?),
};
if kategorie.is_some() && !matches!(status_enum, PersonStatus::Erfasst | PersonStatus::Betroffen) {
    return Err(AppError::UnprocessableEntity(                                    // 422
        "Eine Erst-Sichtung ist nur mit Status erfasst oder betroffen zulässig".into(),
    ));
}
```

In der `write_retry!`-Transaktion **nach** `anlegen_tx_mit_optionen` und **nur bei `war_neu`**
(sonst dupliziert ein Offline-Replay die Sichtung), **vor** dem `repo::laden_tx` — sonst trägt
die Antwort den Vorzustand:

```rust
if war_neu {
    if let Some(k) = kategorie {
        sichtung_repo::erfassen_tx(
            conn, einsatz_id, id, k.as_str(), None, benutzer.id,
            matches!(status_enum, PersonStatus::Erfasst),   // hebe_auf_betroffen
        ).await?;
    }
}
let person = repo::laden_tx(conn, einsatz_id, id).await?;
```

Der ETB bekommt zwei Zeilen (Erfassung + Sichtung), Wortlaut wörtlich aus `sichten`
übernommen (`"Person {}: Sichtung {}"` mit `kategorie.etb_label()`).

- [ ] **Schritt 4: `cargo test --test einsatz_person_anlegen_sichtung` — PASS**, dann
`cargo test --workspace`

- [ ] **Schritt 5: Codegen**

`./scripts/check-typ-codegen.sh` — regenerierte `openapi.json` + `types.generated.ts`
**mitcommitten**. `PersonAnlegenEingabe` um `sichtung?: Sichtungskategorie` erweitern.

- [ ] **Schritt 6: Commit**

```bash
git add src/routes/einsatz_person.rs tests/einsatz_person_anlegen_sichtung.rs frontend/src/api/
git commit -m "feat(lfh-340): nimmt die Erst-Sichtung beim Anlegen einer Person entgegen"
```

---

### Task 6: Sichtungskategorie in der Schnellerfassung (AK2, AK3)

Löst H31. Heute: Person anlegen → Detailseite öffnen → sichten = 9 Interaktionen, 2 Seitenwechsel.

**Dateien:**
- Erstellen: `frontend/src/personen/AufnahmeFelder.tsx` (+ `.test.tsx`)
- Ändern: `frontend/src/personen/PersonErfassungModal.tsx` (+ Test)
- Ändern: `frontend/src/pages/PersonenPage.tsx` (Mutation reicht `sichtung` durch, Quittung nennt SK)

**Schnittstellen:**
- Produziert: `export default function AufnahmeFelder({ modus }: { modus: ErfassungsModus })` —
  reine Feldgruppe **ohne** eigenes `<Form>`, damit beide Mounts (Modal, Route) dasselbe Bauteil
  tragen; `export function skFlaechenStil(token: { controlHeight: number }): CSSProperties` —
  rein und exportiert, nach dem Muster von `bedienzielStil`.

**Zielform der SK-Auswahl:** `<Form.Item name="sichtung">` mit `Radio.Group optionType="button"`
und `name="sichtung"` (zwei Gruppen ohne `name` gruppierten nativ zusammen), sechs Flächen
(SK I–IV, tot, unverletzt) **ganz oben**. Mindesthöhe `Math.max(64, token.controlHeight)` — die
64 px aus dem Ticket sind ein **Boden**, die Dichtestufe darf darüber (Handschuh = 72). Farbe
aus `SK_META` als **Rand und Text**, nie als gefüllte Textfläche; zweiter Kanal ist das Label
selbst („SK I"), damit WCAG 1.4.1 ohne Farbe hält.

- [ ] **Schritt 1: Failing tests**

```tsx
// AufnahmeFelder.test.tsx
it('stellt die sechs Sichtungskategorien als Auswahlflächen', () => {
  render(<Form><AufnahmeFelder modus="schnell" /></Form>);
  const gruppe = screen.getByRole('radiogroup', { name: 'Sichtungskategorie' });
  expect(within(gruppe).getAllByRole('radio')).toHaveLength(6);
});

it('gibt den Flächen einen Boden von 64 px, der mit der Dichte wächst', () => {
  // Reine Funktion — kein Rendern, jsdom rechnet kein Layout.
  expect(skFlaechenStil({ controlHeight: 30 }).minHeight).toBe(64);
  expect(skFlaechenStil({ controlHeight: 72 }).minHeight).toBe(72);
});
```

```tsx
// PersonenPage.test.tsx — der AK2-Beleg in Vitest (die Interaktionszahl misst e2e in Task 9)
it('schickt die gewählte Sichtung mit dem Anlegen mit — ohne zweiten Request', async () => {
  renderMitProviders(<PersonenPage />, { route: '/einsaetze/1/personen' });
  await userEvent.click(await screen.findByRole('button', { name: 'Schnellerfassung' }));
  await userEvent.click(screen.getByRole('radio', { name: 'SK II' }));
  await userEvent.click(screen.getByRole('button', { name: 'Erfassen' }));
  expect(anlegenSpy).toHaveBeenCalledWith(1, expect.objectContaining({ sichtung: 'sk2' }), expect.anything());
  expect(sichtenSpy).not.toHaveBeenCalled();      // KEIN zweiter Request
});

it('nennt die Sichtung in der Quittung', async () => {
  // erwartet /Erfasst als R-\d+ · SK II/
});
```

- [ ] **Schritt 2: Tests laufen lassen — FAIL**

- [ ] **Schritt 3: Umsetzen**

`AufnahmeFelder.tsx` bauen, `PersonErfassungModal` darauf umstellen (die vorhandenen Felder
wandern hinein, das Feldbudget-Kommentar wandert mit). Das SK-Feld zählt zum sichtbaren Budget:
sichtbar bleiben **Sichtung, Geschlecht, Alter, Antreffort**, **Name** wandert unter „Weitere
Angaben". Begründung im Dateikopf: an der Aufnahme wird zuerst die Kategorie vergeben, der Name
ist der langsamste Teil und oft unbekannt.

`PersonenPage`: `legePersonAn(einsatzId, { …v, status, sichtung: v.sichtung })`; Quittungszeile
wird zu `Erfasst als ${registrierAnzeige(nr)}${sk ? ' · ' + SK_META[sk].label : ''}`.

- [ ] **Schritt 4: Tests grün** — `AufnahmeFelder.test.tsx`, `PersonErfassungModal.test.tsx`,
`PersonenPage.test.tsx`

- [ ] **Schritt 5: Commit**

```bash
git add frontend/src/personen/ frontend/src/pages/PersonenPage.tsx frontend/src/pages/PersonenPage.test.tsx
git commit -m "feat(lfh-340): vergibt die Sichtungskategorie in der Personen-Schnellerfassung"
```

---

### Task 7: Aufnahme-Route `/einsaetze/:einsatzId/personen/aufnahme`

Die Route ist **nicht** der Weg zu AK2 (das erledigt Task 6 ohne Seitenwechsel), sondern die
Anspring-Adresse, die C6-uhs als Abhängigkeit führt. Sie montiert **dasselbe** `AufnahmeFelder`
— ein Bauteil, zwei Mounts.

**Dateien:**
- Erstellen: `frontend/src/pages/personen/AufnahmePage.tsx` (+ `.test.tsx`)
- Ändern: `frontend/src/routing/deeplinks.ts` (+ `deeplinks.test.ts`)
- Ändern: `frontend/src/App.tsx`

**Schnittstellen:**
- Produziert: `export function personenAufnahmePfad(einsatzId: number): string`

- [ ] **Schritt 1: Failing test für den Builder**

```ts
it('baut den Aufnahme-Pfad', () => {
  expect(personenAufnahmePfad(7)).toBe('/einsaetze/7/personen/aufnahme');
});
```

- [ ] **Schritt 2: FAIL** — `personenAufnahmePfad` existiert nicht

- [ ] **Schritt 3: Builder + Route + Seite**

```ts
export function personenAufnahmePfad(einsatzId: number): string {
  return `${einsatzModulPfad(einsatzId, 'personen')}/aufnahme`;
}
```

```tsx
<Route path="personen/aufnahme" element={<AufnahmePage />} />
<Route path="personen/:personId" element={<PersonenDetailPage />} />
```

Die Reihenfolge ist bei React Router v7 durch das Ranking (statisch schlägt dynamisch) egal —
sie steht trotzdem so da, weil ein Leser das sonst prüfen muss.

`AufnahmePage` = `EinsatzSeite` + `ErfassungsFormular` (Inline-Variante des B4-Primitivs) mit
`serie`, `AufnahmeFelder` als Kinder, derselben Mutation und derselben Quittungszeile wie
`PersonenPage`. Nach „Speichern und nächste" bleibt sie stehen; „Fertig" navigiert auf
`personenPfad(einsatzId)`.

- [ ] **Schritt 4: Seitentest**

```tsx
it('erfasst in Serie, ohne die Seite zu verlassen', async () => {
  renderMitProviders(<AufnahmePage />, { route: '/einsaetze/1/personen/aufnahme' });
  await userEvent.click(screen.getByRole('radio', { name: 'SK I' }));
  await userEvent.click(screen.getByRole('button', { name: 'Speichern und nächste' }));
  expect(await screen.findByText(/Erfasst als R-/)).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'SK I' })).not.toBeChecked();
});
```

- [ ] **Schritt 5: Tests grün**

- [ ] **Schritt 6: Commit**

```bash
git add frontend/src/pages/personen/ frontend/src/routing/ frontend/src/App.tsx
git commit -m "feat(lfh-340): gibt der Personen-Aufnahme eine eigene Route"
```

---

### Task 8: Verortungsstatus im Schäden-Modul

Löst M39 **ohne** Backend-Änderung — das Koordinatenfeld in der Erfassung (`SchadenEingabe`
kennt kein lat/lon) ist ausdrücklich **vertagt** und bekommt einen Nachzug-Task; `SchadenPatch`
kann lat/lon bereits, die Verortung läuft also über die Karte.

**Dateien:**
- Ändern: `frontend/src/pages/SchaedenPage.tsx` (Spalte „verortet")
- Ändern: `frontend/src/pages/SchaedenDetailPage.tsx:152-181` (Anzeige + Aktion)
- Ändern: `frontend/src/routing/deeplinks.ts` (+ Test)

**Schnittstellen:**
- Produziert: `export function lagekarteVerortenPfad(einsatzId: number, schadenId: number): string`

- [ ] **Schritt 1: Failing tests**

```tsx
it('zeigt in der Liste, ob ein Schaden verortet ist', async () => {
  // Zwei Datensätze — einer mit lat/lon, einer ohne. Die Aussage braucht beide Seiten.
  renderMitProviders(<SchaedenPage />, { route: '/einsaetze/1/schaeden' });
  const zeilen = await screen.findAllByRole('row');
  expect(within(zeilen[1]).getByLabelText('verortet')).toBeInTheDocument();
  expect(within(zeilen[2]).getByLabelText('nicht verortet')).toBeInTheDocument();
});

it('bietet auf der Detailseite den Weg auf die Karte, wenn nichts verortet ist', async () => {
  renderDetail({ lat: null, lon: null });
  expect(await screen.findByRole('link', { name: 'Auf Karte verorten' }))
    .toHaveAttribute('href', lagekarteVerortenPfad(1, 5));
});

it('zeigt bei vorhandener Koordinate die Koordinate statt des Wegs auf die Karte', async () => {
  renderDetail({ lat: 52.1, lon: 8.5 });
  expect(await screen.findByText(/52[.,]1/)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Auf Karte verorten' })).not.toBeInTheDocument();
});
```

- [ ] **Schritt 2: FAIL**

- [ ] **Schritt 3: Umsetzen** — Spalte `verortet` mit `EnvironmentOutlined` bzw. „—"
(**Ikone, kein Emoji**, in `aria-hidden`-Hülle; der zugängliche Name kommt vom Wrapper),
auf der Detailseite `anzeige/KoordinatenAnzeige.tsx` bei vorhandener Koordinate, sonst der
Deeplink. Der Kartenzweig nimmt `verortet` **nicht** in `sekundaer` auf (Tupel deckelt auf drei).

- [ ] **Schritt 4: Tests grün**

- [ ] **Schritt 5: Commit**

```bash
git add frontend/src/pages/SchaedenPage.tsx frontend/src/pages/SchaedenDetailPage.tsx frontend/src/routing/
git commit -m "feat(lfh-340): macht den Verortungsstand der Schäden sichtbar"
```

---

### Task 9: e2e — 390 px und Aufnahmeweg

**Dateien:**
- Erstellen: `frontend/e2e/betroffene-schmal.spec.ts`
- Erstellen: `frontend/e2e/personen-aufnahme.spec.ts`

Vorbild für Bauform, Seeding (`page.request`, Cookie-Jar) und Dichte-Umstellung:
`frontend/e2e/datensicht-schmal.spec.ts` und `frontend/e2e/kraefte-schmal.spec.ts`.
Kein Device-Descriptor (zöge webkit nach, Browser-Download ist nirgends abgesichert).

- [ ] **Schritt 1: `betroffene-schmal.spec.ts`** — je Liste (personen, tiere, schaeden):
  bei 390 px **kein** `.ant-table` **und** `[data-lfh="datensicht-karte"]` vorhanden,
  `document.body.scrollWidth <= window.innerWidth`; Gegenprobe bei 1366 px: Tabelle da, Karte
  weg. Beide Breiten mit demselben gesäten Datensatz als Anker — ohne ihn erfüllt auch ein
  Lade- oder Leerzustand „kein `.ant-table`".

- [ ] **Schritt 2: `personen-aufnahme.spec.ts`** — AK2 und AK3:

```ts
// AK2: gesichtete Person in ≤ 4 Interaktionen, ohne Seitenwechsel
const vorher = page.url();
await page.getByRole('button', { name: 'Schnellerfassung' }).click();   // 1
await page.getByRole('radio', { name: 'SK II' }).click();               // 2
await page.getByRole('button', { name: 'Erfassen' }).click();           // 3
await expect(page.getByText(/Erfasst als R-\d+ · SK II/)).toBeVisible();
expect(page.url()).toBe(vorher);
```

```ts
// AK3: Serie — geleert, Fokus im ersten Feld, Zähler +1, ohne den Dialog neu zu öffnen
await page.getByRole('button', { name: 'Speichern und nächste' }).click();
await expect(page.getByRole('dialog')).toBeVisible();
await expect(page.getByRole('radio', { name: 'SK II' })).not.toBeChecked();
await expect(page.locator(':focus')).toHaveAttribute('name', 'sichtung');
await expect(page.getByText(/erfasst: 2/)).toBeVisible();
```

- [ ] **Schritt 3: Läufe**

`mise exec pnpm@11.10.0 -- pnpm -C "$PWD/frontend" e2e --grep "betroffene|aufnahme"`.
Voraussetzung: `target/debug/lifeline-hub` existiert (sonst überspringt der Harness laut).
Ein Timeout/ERR_ABORTED unter kumulierter Last ist **kein** Regressionsbeweis — im Zweifel den
Spec einzeln fahren.

- [ ] **Schritt 4: Commit**

```bash
git add frontend/e2e/
git commit -m "test(lfh-340): misst Aufnahmeweg und Kartenzweig der Betroffenen-Module"
```

---

### Task 10: Prüfliste Einsatztauglichkeit + Doku

Ein Modul-Task ohne ausgefüllte Prüfliste gilt laut CLAUDE.md nicht als fertig.

**Dateien:**
- Erstellen: `docs/superpowers/specs/2026-08-18-lfh-340-pruefliste.md`
- Ändern: `CLAUDE.md`

- [ ] **Schritt 1:** Prüfliste je Modul (Personen, Tiere, Schäden) über die 15 Kriterien aus
  `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`. Jede Zeile trägt ein
  Verdikt: erfüllt / offen → Zielticket / nicht anwendbar. „nicht geprüft" ist keins.

- [ ] **Schritt 2:** CLAUDE.md-Nachtrag — nur Festlegungen mit Bindungswirkung: Sichtung beim
  Anlegen statt zweitem Request (mit der Offline-Queue-Begründung), `AufnahmeFelder` als ein
  Bauteil an zwei Mounts, die vertagte lat/lon-Erfassung mit Ticketnummer.

- [ ] **Schritt 3: Volles Gate** — `./scripts/check-all.sh` (ohne `| tail`)

- [ ] **Schritt 4: Commit**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(lfh-340): legt die Prüfliste der Betroffenen-Module an"
```

---

## Nachzüge (als ClickUp-Tasks anlegen, nicht hier bauen)

- **Koordinatenfeld in der Schadens-Erfassung** — `SchadenEingabe` um lat/lon erweitern
  (Rust-DTO + Codegen), `KoordinatenEingabe` einhängen. Vom Auftraggeber in dieser Runde
  ausdrücklich ausgeklammert.
- Was beim Bauen sonst auffällt, wandert über `clickup-task-anlegen` aufs Board.
