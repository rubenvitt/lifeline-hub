# LFH-346 · C11 — Verwaltung vereinheitlichen · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Verwaltungsflächen (11 Stammdaten-Tabs, 2 Karten-Verwaltungen, Benutzer,
Einsatz-Defaults) verhalten sich bei Rechten, Ladezuständen, Erfassungsmasken und
Spaltenbreiten gleich — und Fahrzeug/Personal bekommen die Detailroute, die ihre
Feldzahl verlangt.

**Architecture:** Kein neues Tabellen-Primitiv — `KatalogTabelle` (LFH-329/330),
`SeitenFehler` (LFH-331), `Erfassung`/`SchnellAnlegen` (LFH-332) und `SpeicherHinweis`
(LFH-345) tragen die Zusicherungen bereits. C11 zieht die **Aufrufstellen** auf diese
Primitive nach und ergänzt zwei Detailseiten. Reines Frontend — kein neuer Endpunkt.

**Tech Stack:** React 19, antd 6, TanStack Query 5, react-router 7, Vitest 4 + Testing
Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-25-lfh-346-bestandsverdikte.md` (Verdikte gegen die
15 Befunde und die korrigierten Akzeptanzkriterien — **zuerst lesen**, das Ticket ist stale)

---

## Global Constraints

- **Kein neuer Backend-Endpunkt.** `FahrzeugAnzeige` (`src/fahrzeug/mod.rs:92-108`) und die
  Personal-Entsprechung tragen **alle** Stammdatenfelder; ein `GET /api/fahrzeuge/{id}` läge
  Byte für Byte auf dem, was die Liste schon liefert. Die Detailseiten lesen
  `globalKeys.fahrzeuge()` / `globalKeys.personal()` und selektieren die Zeile — ein
  Cache-Fach, eine Invalidierung. Den 404-Fall erzeugt die Seite selbst.
- **Admin-Pfade kommen aus `frontend/src/admin/adminNav.tsx`**, nicht aus
  `routing/deeplinks.ts` (das trägt Einsatz-Pfade). Das Ticket-AC sagt das Gegenteil und ist
  falsch adressiert — siehe Spec.
- **Keine neue punktuelle `size`-Angabe** an interaktiven Elementen
  (`components/dichte.guard.test.ts`). Die Höhe erbt vom `ConfigProvider`.
- **Rot bedient nichts**: `danger` nur an destruktiven Aktionen, jede `<Space>`-Aktionsreihe
  mit `danger`-Knopf **und** mindestens einer weiteren Aktion trägt `size="middle"`
  (`components/aktionsabstand.guard.test.ts`). Wer in dieser Runde eine solche Reihe in
  `stammdaten/`/`karten/` anfasst, nimmt die Datei in den Scope des Guards auf — **im selben
  Commit**.
- **Enter-Absenden ist bei `Select`-lastigen Masken nicht per Tastendruck prüfbar**
  (`@rc-component/select` ruft `preventDefault()`). Geprüft wird die Struktur: kein
  `.ant-modal-footer` **und** `knopf.closest('form') !== null`.
- **jsdom rechnet kein Layout.** Pixel-Aussagen gehören nach Playwright oder werden als
  Inline-Style/Prop-Wert geprüft, nie als `getBoundingClientRect`.
- **Gates:** `./scripts/check-all.sh` vor dem Merge. Während der Umsetzung reicht der
  gescopte Vitest-Lauf plus `tsc`.
- Query-Keys ausschließlich über `frontend/src/api/queryKeys.ts`.

---

## File Structure

**Neu:**
- `frontend/src/stammdaten/FahrzeugDetailPage.tsx` — Vollseite, Sektionen Identität / Funk /
  Kapazität / Bemerkung
- `frontend/src/stammdaten/PersonalDetailPage.tsx` — dito
- `frontend/src/stammdaten/stammdatenDetail.ts` — die zwei Pfad-Builder + `parseRouteId`-Nutzung
- `frontend/src/stammdaten/rechteText.ts` — die eine Formulierung des Rechte-Hinweises

**Geändert (nach Task gruppiert, disjunkt):**
- A1: `FahrzeugeTab`, `MaterialTab`, `PersonalTab`, `StichworteTab`, `pages/BenutzerPage`
- A2/A3: `admin/adminNav.tsx` + alle 11 Stammdaten-Tabs + `karten/KartenOnlineSektion`,
  `karten/KartenOfflineSektion`
- A4: `EtbBausteineTab`, `SprechgruppenTab`, `karten/OnlineQuellenVerwaltung`,
  `karten/OfflineKartenVerwaltung`
- A5: `karten/OfflineKartenVerwaltung`
- A6: `FahrzeugFormModal`, `MaterialFormModal`, `EtbBausteinFormModal`,
  `SprechgruppeFormModal`, `karten/OnlineQuelleFormModal`,
  `karten/OfflineDownloadUrlModal`, `pages/BenutzerPage`
- A7: `FahrzeugFormModal`, `PersonalFormModal`, `admin/adminNav.tsx`, neue Detailseiten
- A8: `karten/OnlineQuelleFormModal`
- A9: `pages/einstellungen/ModulEinstellungsListe`, `EinsatzDefaults`, `EinsatzModule`

**Reihenfolge:** A1 → A2 → A3 → (A4 ‖ A9) → A6 → (A7 ‖ A8) → A10. A2 muss vor A3 laufen (A3
braucht den `hinweis`-Slot, den A2 füllt); A6 muss vor A7 **und** A8 laufen (beide kürzen
Masken, die A6 gerade auf die Hülle zieht); A4 und A9 sind unabhängig und können parallel.
A5 ist entfallen — siehe dort.

---

## Task A1: Zeilen-Scoping bei Statuswechsel und Löschen

Befunde H35 (Rest) und M50 (Rest). `loading` ist bereits zeilen-gescopt; `disabled` ist es
nicht — `const gesperrt = dienststatusMutation.isPending` sperrt **jede** Zeile der Tabelle,
während eine einzige Mutation läuft. Bei 150 Personalzeilen ist das eine Vollsperre wegen
eines Klicks.

**Files:**
- Modify: `frontend/src/stammdaten/FahrzeugeTab.tsx:91`,
  `frontend/src/stammdaten/MaterialTab.tsx:80`, `frontend/src/stammdaten/PersonalTab.tsx:94`
- Modify: `frontend/src/stammdaten/StichworteTab.tsx:93`
- Modify: `frontend/src/pages/BenutzerPage.tsx:126` (Deaktivieren ohne gescoptes `loading`)
- Test: die je zugehörigen `.test.tsx`

**Interfaces:**
- Produces: nichts für spätere Tasks — rein lokale Änderung.

- [ ] **Step 1: Failing test in `FahrzeugeTab.test.tsx`**

```tsx
it('sperrt beim Statuswechsel NUR die betroffene Zeile', async () => {
  // Zwei Fahrzeuge, die Mutation bleibt hängen (nie aufgelöst) — so steht der
  // laufende Zustand still und ist prüfbar.
  let aufloesen: (() => void) | undefined;
  vi.mocked(setzeDienststatus).mockImplementation(
    () => new Promise((res) => { aufloesen = () => res(fahrzeugB); }),
  );
  renderMitProvidern(<FahrzeugeTab />, { benutzer: adminBenutzer });

  const zeilen = await screen.findAllByRole('row');
  const zeileA = zeilen.find((r) => within(r).queryByText('Florian 1'))!;
  const zeileB = zeilen.find((r) => within(r).queryByText('Florian 2'))!;

  await userEvent.click(within(zeileA).getByRole('button', { name: 'Außer Dienst' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Ja' }));

  // Die eigene Zeile ist gesperrt …
  expect(within(zeileA).getByRole('button', { name: 'Bearbeiten' })).toBeDisabled();
  // … die FREMDE Zeile bleibt bedienbar. Das ist die Aussage, die vorher rot ist.
  expect(within(zeileB).getByRole('button', { name: 'Bearbeiten' })).toBeEnabled();
  aufloesen?.();
});
```

- [ ] **Step 2: Test laufen lassen — erwartet FAIL**

Run: `mise exec pnpm@11.10.0 -- pnpm -C <worktree>/frontend exec vitest run src/stammdaten/FahrzeugeTab.test.tsx`
Expected: FAIL — „expected element to be enabled" an der Zeile-B-Zusicherung.

- [ ] **Step 3: `gesperrt` auf die Zeile ziehen**

```tsx
// Vorher: const gesperrt = dienststatusMutation.isPending;   // sperrt ALLE Zeilen
// Eine laufende Mutation gehört GENAU EINER Zeile. Die Sperre der übrigen Zeilen war
// eine Vollsperre der Tabelle wegen eines Klicks — bei 150 Zeilen Personal der Regelfall,
// nicht die Ausnahme. Der Riegel gegen ein zweites Absenden DERSELBEN Zeile bleibt; ein
// zweiter Klick auf eine ANDERE Zeile ist kein Doppelklick, sondern die nächste Aufgabe.
const laeuft = dienststatusMutation.isPending && dienststatusMutation.variables?.id === f.id;
const gesperrt = laeuft;
```

Dieselbe Ersetzung in `MaterialTab.tsx` und `PersonalTab.tsx` (dort heißt der Datensatz `m`
bzw. `p`).

- [ ] **Step 4: Test laufen lassen — erwartet PASS**

- [ ] **Step 5: `StichworteTab` — Löschen zeilenweise**

Test zuerst:

```tsx
it('zeigt den Ladezustand nur an der gelöschten Zeile', async () => {
  vi.mocked(loescheStichwortVorschlag).mockImplementation(() => new Promise(() => {}));
  renderMitProvidern(<StichworteTab />, { benutzer: adminBenutzer });
  const zeilen = await screen.findAllByRole('row');
  const zeileA = zeilen.find((r) => within(r).queryByText('H1'))!;
  const zeileB = zeilen.find((r) => within(r).queryByText('H2'))!;
  await userEvent.click(within(zeileA).getByRole('button', { name: 'Löschen' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Ja' }));
  expect(within(zeileA).getByRole('button', { name: 'Löschen' })).toHaveClass('ant-btn-loading');
  expect(within(zeileB).getByRole('button', { name: 'Löschen' })).not.toHaveClass('ant-btn-loading');
});
```

Dann die Änderung:

```tsx
<Button danger loading={loeschenMutation.isPending && loeschenMutation.variables === v.id}>
```

- [ ] **Step 6: `BenutzerPage` — Deaktivieren gescopt**

```tsx
<Button danger loading={deaktivieren.isPending && deaktivieren.variables === b.id}>
  Deaktivieren
</Button>
```

Test analog Step 5 gegen zwei Benutzerzeilen.

- [ ] **Step 7: Guard-Scope entscheiden — im selben Commit**

`components/aktionsabstand.guard.test.ts` ist auf die je Bündel bewerteten Dateien gescopt
und „wächst mit den Bündeln". C11 ist ein neues Bündel und fasst in `FahrzeugeTab`,
`MaterialTab` und `PersonalTab` Aktionsreihen an, die einen `danger`-Knopf neben neutralen
Aktionen tragen.

Run: `vitest run src/components/aktionsabstand.guard.test.ts`

**Die Entscheidung gehört in diesen Commit, nicht in den nächsten.** Prüfen: tragen die drei
Reihen bereits `size="middle"` (dann steht die Datei entweder schon im Scope oder gehört
hinein), und ändert A1 an `Space` oder `danger` etwas? A1 ändert nur `disabled`/`loading` —
die Antwort ist also vermutlich „schon im Scope, nichts zu tun". Das Ergebnis wird
festgehalten, nicht offen gelassen.

- [ ] **Step 8: Gescopter Vitest-Lauf über die fünf Dateien — alles grün**

- [ ] **Step 9: Commit**

```bash
git add frontend/src/stammdaten/FahrzeugeTab.tsx frontend/src/stammdaten/MaterialTab.tsx \
        frontend/src/stammdaten/PersonalTab.tsx frontend/src/stammdaten/StichworteTab.tsx \
        frontend/src/pages/BenutzerPage.tsx frontend/src/stammdaten/*.test.tsx \
        frontend/src/pages/BenutzerPage.test.tsx
git commit -m "fix(lfh-346): sperrt beim Statuswechsel die Zeile statt der Tabelle"
```

---

## Task A2: Fehlende Berechtigung wird erklärt, nicht stumm weggeschaltet

Befund M45. Zehn Tabs tragen dasselbe `istAdmin`-Gate und **verstecken** damit Aktionsspalte
und Primäraktion; `OrganisationTab` hat gar kein Gate und speichert für jeden.

**Entscheidung — zwei Zuschnitte, nicht einer.** C10/M16 hat für den **einen**
Speichern-Knopf einer Seite entschieden: sichtbar, gesperrt, mit `RechteHinweis` darüber.
Das gilt hier für die **Primäraktion**. Für die **Zeilenaktionsspalte** gilt es nicht: n
Zeilen × 2 Knöpfe ergäben eine Spalte toter Knöpfe, die waagerechten Platz für null
Handlungsmöglichkeit kostet — und der Grund steht bereits einmal oben im Hinweis. Das
Argument aus M16 („ein fehlender Knopf ist von ‚diese Seite kann das gar nicht' nicht zu
unterscheiden") greift genau dann nicht mehr, wenn ein Satz auf der Seite den Grund nennt.
Die Spalte entfällt also weiterhin — **begründet**, nicht beiläufig. Das weicht vom
Ticket-AC ab; die Abweichung steht in der Spec.

**Files:**
- Create: `frontend/src/stammdaten/rechteText.ts`
- Modify: alle 11 Stammdaten-Tabs, `karten/KartenOnlineSektion.tsx`,
  `karten/KartenOfflineSektion.tsx`
- Test: `frontend/src/stammdaten/rechteGate.test.tsx` (neu, sektionsübergreifend)

**Interfaces:**
- Produces: `STAMMDATEN_RECHTE_TEXT: string` — von A3 mitbenutzt.

- [ ] **Step 1: Den Hinweistext an eine Stelle legen**

```ts
// frontend/src/stammdaten/rechteText.ts
/**
 * EIN Wortlaut für alle Verwaltungssektionen (M45). Vorher hatte jede Sektion ihre eigene
 * Ausprägung von „nur lesen" — vier gezählt, drei davon stumm. Ein Satz, der den Grund
 * nennt, ist der zweite Kanal zur Sperre (WCAG 1.4.1): Grau allein ist eine Farbe.
 */
export const STAMMDATEN_RECHTE_TEXT =
  'Nur Benutzer mit der Systemrolle „Admin“ dürfen die Stammdaten ändern — die Werte stehen hier zum Nachlesen.';
```

- [ ] **Step 2: Failing test — sektionsübergreifend**

```tsx
// frontend/src/stammdaten/rechteGate.test.tsx
import { STAMMDATEN_RECHTE_TEXT } from './rechteText';

const SEKTIONEN = [
  { name: 'Fahrzeuge', Komp: FahrzeugeTab },
  { name: 'Material', Komp: MaterialTab },
  { name: 'Personal', Komp: PersonalTab },
  { name: 'Stichworte', Komp: StichworteTab },
  { name: 'Qualifikationen', Komp: QualifikationenTab },
  { name: 'Personal-Status', Komp: PersonalStatusTab },
  { name: 'Fahrzeug-Status', Komp: StatusKatalogTab },
  { name: 'ETB-Bausteine', Komp: EtbBausteineTab },
  { name: 'Einheitstypen', Komp: EinheitTypenTab },
  { name: 'Sprechgruppen', Komp: SprechgruppenTab },
  { name: 'Organisation', Komp: OrganisationTab },
];

describe.each(SEKTIONEN)('$name ohne Admin-Recht', ({ Komp }) => {
  it('nennt den Grund statt stumm auszugrauen', async () => {
    renderMitProvidern(<Komp />, { benutzer: fuehrungskraftBenutzer });
    expect(await screen.findByText(STAMMDATEN_RECHTE_TEXT)).toBeInTheDocument();
  });
});

it('OrganisationTab speichert für Nicht-Admins nicht', async () => {
  renderMitProvidern(<OrganisationTab />, { benutzer: fuehrungskraftBenutzer });
  // Der Knopf ist DA (M16: ein fehlender Knopf sagt nichts) und gesperrt.
  expect(await screen.findByRole('button', { name: 'Speichern' })).toBeDisabled();
  expect(setzeOrgDefault).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Test laufen lassen — erwartet FAIL** (11 × „Unable to find text")

- [ ] **Step 4: Je Tab den Hinweis rendern**

Die Tabs haben heute **keinen** `hinweis`-Slot — `adminNav.tsx` wickelt sie. Bis A3 den
Rahmen umstellt, rendert jeder Tab den Hinweis **selbst über seinem Inhalt**:

```tsx
<RechteHinweis sichtbar={!istAdmin} text={STAMMDATEN_RECHTE_TEXT} />
```

A3 zieht ihn in den Slot. Der Zwischenschritt ist bewusst — er hält A2 auf einer
Dateimenge, die ohne A3 lauffähig ist.

- [ ] **Step 5: `OrganisationTab` bekommt sein Gate**

```tsx
const { benutzer } = useAuth();
const istAdmin = benutzer?.system_rolle === 'admin';
// …
<Form … disabled={!istAdmin}>
  …
  <Button type="primary" htmlType="submit" loading={speichern.isPending} disabled={!istAdmin}>
```

Zusätzlich fehlt hier der Speicherfehler an der Seite (derselbe Befund wie C10/H14, eine
Datei weiter): `<SpeicherFehler fehler={speichern.error} />` über dem Formular, und das
`onError` der Mutation entfällt.

- [ ] **Step 6: Test laufen lassen — erwartet PASS**

- [ ] **Step 7: Commit**

```bash
git add frontend/src/stammdaten/ frontend/src/karten/KartenOnlineSektion.tsx \
        frontend/src/karten/KartenOfflineSektion.tsx
git commit -m "fix(lfh-346): erklaert die fehlende Berechtigung in jeder Verwaltungssektion"
```

---

## Task A3: Primäraktion in den Kopf-Slot — der Rahmen wandert in die Sektion

Befund M46. `adminNav.tsx:42` wickelt die Stammdaten-Tabs in `<AdminPage titel={label}>` —
die Tabs **können** `aktionen` und `hinweis` deshalb gar nicht erreichen. Die Karten- und
Einstellungssektionen bringen ihren Rahmen längst selbst mit; C11 gleicht die Stammdaten an
und löscht `stammdatenSektion()`.

**Der Preis ist eine Dopplung:** der Titel steht dann in der Registry (`label`, fürs Menü)
**und** in der Sektion (`titel`, für den Kopf). Diese Dopplung existiert heute schon bei den
fünf selbstwickelnden Sektionen, unbemerkt und ungeprüft. Sie wird hier mit einem Guard
geschlossen, statt sie um elf Fälle zu vergrößern.

**Files:**
- Modify: `frontend/src/admin/adminNav.tsx`, alle 11 Stammdaten-Tabs
- Test: `frontend/src/admin/adminNav.test.tsx`

**Interfaces:**
- Consumes: `STAMMDATEN_RECHTE_TEXT` aus A2.
- Produces: jede Sektion rendert ihren eigenen `<AdminPage titel=… aktionen=… hinweis=…>`.

- [ ] **Step 1: Failing test — Titel-Drift und Slot-Nutzung**

```tsx
// frontend/src/admin/adminNav.test.tsx
// GESCOPT auf die 11 Stammdaten-Sektionen — die fuenf selbstwickelnden (Karten,
// Einstellungen) tragen die Dopplung laengst und stehen nicht im Diff dieses Tasks.
// Ueber alle 16 zu iterieren zoege deren Queries in diese Datei und faerbte sie aus
// Mock-Gruenden rot, die mit Titel-Drift nichts zu tun haben.
const STAMMDATEN = adminGruppen.find((g) => g.key === 'stammdaten')!.sektionen;

it.each(STAMMDATEN.map((s) => [s.label, s] as const))(
  'Sektion %s traegt ihren Registry-Titel im Seitenkopf',
  async (label, sektion) => {
    renderMitProvidern(sektion.element, { benutzer: adminBenutzer });
    // Der Kopf von AdminPage ist ein level-4-Heading. Driftet der Sektionstitel gegen
    // das Menue-Label, zeigt die Sidebar auf einen anderen Namen als die Seite.
    expect(await screen.findByRole('heading', { level: 4, name: label })).toBeInTheDocument();
  },
);

it('legt die Primaeraktion jeder Katalog-Sektion in den Kopf-Slot', async () => {
  renderMitProvidern(<FahrzeugeTab />, { benutzer: adminBenutzer });
  const knopf = await screen.findByRole('button', { name: 'Fahrzeug anlegen' });
  // NUR diese Aussage diskriminiert. Eine Positionspruefung „Knopf vor Tabelle" waere
  // eine Attrappe: der Knopf stand VORHER schon ueber der Tabelle, und der `aktionen`-Slot
  // von AdminPage steht ohnehin vor `children` — sie ist in beiden Baeumen gruen.
  expect(knopf.closest('[data-lfh="adminpage-aktionen"]')).not.toBeNull();
});
```

- [ ] **Step 2: Test laufen lassen — erwartet FAIL**

- [ ] **Step 3: `AdminPage` bekommt die Marke am Aktionen-Slot**

```tsx
{aktionen && <div data-lfh="adminpage-aktionen">{aktionen}</div>}
```

Dieselbe Bauform wie `data-lfh="seitenkopf-aktionen"` an `EinsatzSeite` (LFH-340 · C5): eine
Zusicherung über „genau eine Primäraktion im Kopf" ist nur am Kopf prüfbar, nicht global.

- [ ] **Step 4: `stammdatenSektion` entfernen**

```tsx
// adminNav.tsx — vorher:
//   function stammdatenSektion(key, label, tab) {
//     return { key, label, element: <AdminPage titel={label}>{tab}</AdminPage> };
//   }
// Entfaellt. Die Tabs bringen ihren Rahmen jetzt selbst mit — wie die Karten- und
// Einstellungssektionen seit LFH-281. Der Grund ist nicht Symmetrie: nur die Sektion
// weiss, WAS ihre Primaeraktion ist und OB sie gerade gesperrt gehoert; ein Wrapper
// von aussen kann den Slot nicht fuellen, und ein durchgereichter Context waere ein
// neuer Mechanismus fuer einen Fall, den die Bauform daneben schon loest.
{ key: 'fahrzeuge', label: 'Fahrzeuge', element: <FahrzeugeTab /> },
```

- [ ] **Step 5: Je Tab den Rahmen setzen (Muster `FahrzeugeTab`)**

```tsx
return (
  <AdminPage
    titel="Fahrzeuge"
    aktionen={
      // Der Knopf verschwindet nicht mehr (M16) — er steht gesperrt, den Grund nennt
      // der Hinweis darunter.
      <Button type="primary" disabled={!istAdmin} onClick={() => { setBearbeite(null); setModalOffen(true); }}>
        Fahrzeug anlegen
      </Button>
    }
    hinweis={<SeitenHinweise rechteFehlt={!istAdmin} rechteText={STAMMDATEN_RECHTE_TEXT} />}
  >
    {fahrzeugeQuery.isError ? <SeitenFehler … /> : <KatalogTabelle … />}
    <FahrzeugFormModal … />
  </AdminPage>
);
```

Bei den vier Sektionen mit Inline-Quick-Add (`SchnellAnlegen`) bleibt die Zeile **über der
Liste** stehen und der Kopf-Slot bleibt leer — ein zweiter Anlegen-Weg im Kopf wäre zwei
Primäraktionen für dieselbe Sache. Das ist der vom Ticket vorgesehene Fall („Inline-Quick-Add
darf zusätzlich bleiben, dann aber über der Liste").

- [ ] **Step 6: Den Hinweis aus A2 in den Slot ziehen**

Das freistehende `<RechteHinweis>` aus A2/Step 4 entfällt in jeder Datei — es steht jetzt im
`hinweis`-Slot. Der Test aus A2 bleibt unverändert grün (er fragt nach dem Text, nicht nach
dem Ort).

- [ ] **Step 7: Volle Testrunde über `src/stammdaten` und `src/admin`**

- [ ] **Step 8: Commit**

```bash
git add frontend/src/admin/ frontend/src/stammdaten/ frontend/src/components/AdminPage.tsx
git commit -m "refactor(lfh-346): legt die Primaeraktion jeder Verwaltungssektion in den Kopf"
```

---

## Task A4: Freitext-Spalten begrenzen

Befund N13 — `grep -rn ellipsis frontend/src/stammdaten/ frontend/src/karten/` = 0. Inhalt,
URL, Attribution und Hinweis sprengen die Zeilenhöhe.

**Files:**
- Modify: `frontend/src/stammdaten/EtbBausteineTab.tsx`,
  `frontend/src/stammdaten/SprechgruppenTab.tsx`,
  `frontend/src/karten/OnlineQuellenVerwaltung.tsx`,
  `frontend/src/karten/OfflineKartenVerwaltung.tsx`
- Test: die je zugehörigen `.test.tsx`

- [ ] **Step 1: Failing test (Muster `OnlineQuellenVerwaltung.test.tsx`)**

```tsx
it('kuerzt die URL-Spalte und haelt den vollen Wert im Titel', async () => {
  const lang = 'https://tiles.example.org/' + 'sehr-langer-pfad/'.repeat(12) + '{z}/{x}/{y}.png';
  vi.mocked(listeOnlineQuellen).mockResolvedValue([{ ...quelleA, url: lang }]);
  renderMitProvidern(<OnlineQuellenVerwaltung />, { benutzer: adminBenutzer });
  const zelle = await screen.findByTitle(lang);
  // jsdom rechnet kein Layout — geprueft wird die KLASSE, die antd fuer die Kuerzung
  // setzt, plus der Titel als zweiter Kanal (ohne ihn ist der Wert unerreichbar).
  expect(zelle).toHaveClass('ant-table-cell-ellipsis');
});
```

- [ ] **Step 2: Test laufen lassen — erwartet FAIL**

- [ ] **Step 3: Spalten begrenzen**

```tsx
{
  title: 'URL',
  dataIndex: 'url',
  key: 'url',
  // Eine Kachel-URL ist 60–200 Zeichen lang und traegt ihre Aussage vorn (Host, Schema);
  // ungekuerzt schiebt sie jede andere Spalte aus dem Blick. `showTitle` haelt den vollen
  // Wert erreichbar — die Kuerzung ist eine Anzeige-, keine Datenentscheidung.
  ellipsis: { showTitle: true },
  width: 280,
}
```

Analog: `attribution` (200), `hinweis` in `SprechgruppenTab` (240), `inhalt` in
`EtbBausteineTab` (320).

- [ ] **Step 4: ETB-Bausteine bekommen die Zwei-Zeilen-Zelle**

Muster `karten/OfflineKartenVerwaltung.tsx:151-172` — Label fett, Inhalt gedämpft einzeilig,
damit Label und Inhalt eine Zelle teilen statt zwei Spalten zu belegen:

```tsx
{
  title: 'Baustein',
  key: 'baustein',
  // Label und Inhalt gehoeren zusammen gelesen („was fuegt dieser Baustein ein?"), nicht
  // verglichen — zwei Spalten nebeneinander zwingen den Blick zum Springen.
  render: (_, b) => (
    <>
      <div style={{ fontWeight: token.fontWeightStrong }}>{b.label}</div>
      <Typography.Text type="secondary" ellipsis={{ tooltip: b.inhalt }} style={{ display: 'block' }}>
        {b.inhalt}
      </Typography.Text>
    </>
  ),
}
```

**Achtung, gemessen (LFH-369):** mehrzeilige Kürzung gibt es in antd 6 nur über `Paragraph`;
`Text ellipsis` kürzt einzeilig — was hier gewollt ist. Die Spalte verliert damit ihren
`dataIndex` und fällt aus dem Suchkorpus des Primitivs; der Suchplatzhalter
(`'Label oder Inhalt'`) wird dann zur Lüge. Deshalb: `dataIndex: 'label'` **behalten** und
den Inhalt im `render` ergänzen — dann sucht das Primitiv weiter über `label`, und der
Platzhalter wird auf `'Label'` korrigiert.

- [ ] **Step 5: Tests grün**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stammdaten/EtbBausteineTab.tsx frontend/src/stammdaten/SprechgruppenTab.tsx \
        frontend/src/karten/OnlineQuellenVerwaltung.tsx frontend/src/karten/OfflineKartenVerwaltung.tsx \
        frontend/src/stammdaten/EtbBausteineTab.test.tsx frontend/src/karten/*.test.tsx
git commit -m "fix(lfh-346): begrenzt die Freitext-Spalten der Verwaltungstabellen"
```

---

## Task A5 — entfällt: die Bündelungsschwelle wird nie erreicht

Befund N19 verlangt ein Überlauf-Menü für die Zeilenaktionen der beiden Karten-Tabellen.
**Gemessen am 25.08.2026 ist das nicht anwendbar**, und zwar nicht knapp:

`OfflineKartenVerwaltung.tsx:300-345` — die drei Knöpfe liegen in **einander ausschließenden**
Zweigen. „Neu laden" und „Aktualisieren" sind ein Ternär über `k.aktiv_basemap`, es steht also
immer nur einer davon; „Abbrechen" hängt an `laeuft`, „Löschen" an `!laeuft`. Maximum je
Zustand:

| Zustand | sichtbare Aktionen | Zahl |
| --- | --- | --- |
| `bereit` + Update + Katalog-URL, kein Lauf | Neu laden **oder** Aktualisieren, Löschen | **2** |
| lädt (`laedt` oder `geladen != null`) | Abbrechen | **1** |
| sonst | Löschen | **1** |

`OnlineQuellenVerwaltung.tsx:134-144` — Bearbeiten, Löschen: **2**.

Die Schwelle aus LFH-365/366 ist **drei Aktionen nach der Rechteprüfung**; darunter ist ein
Menü ausdrücklich „kein Zusammenfassen, sondern ein Umweg". Ein Dropdown hier zu bauen
verletzte also die Norm, auf die sich das Ticket beruft. N19 gilt damit als **nicht
anwendbar** (Bündelung) bzw. **erfüllt** (Scroll-Gate, das Primitiv setzt es selbst).

Beide Dateien behalten ihre `<Space size="middle">`-Reihe und bleiben im Scope von
`components/aktionsabstand.guard.test.ts`, wo sie seit LFH-366 stehen.

---

## Task A6: Die Erfassungsmasken auf die Hülle heben

Befunde M42, M43. Sieben Masken sind rohes `<Modal onOk={() => form.submit()}>` — der Knopf
liegt **außerhalb** des `<form>`, Enter ist dort tot (Befund H69), es gibt kein `autoFocus`
und kein symmetrisches Zurücksetzen.

**Gemessene Falle (LFH-378):** eine Maske auf `ErfassungsModal` zu ziehen **baut die
rc-field-form-Lücke erst ein** — `destroyOnHidden` hängt die Kinder ab, aber der Speicher
überlebt und gewinnt beim nächsten Öffnen gegen `initialValues`. Die Hülle schließt das
selbst (Reset auf allen vier Auswegen); ein zurückgebliebenes `resetFields()` beim Aufrufer
ist danach doppelt und **muss weg**.

**Files:**
- Modify: `FahrzeugFormModal.tsx`, `MaterialFormModal.tsx`, `EtbBausteinFormModal.tsx`,
  `SprechgruppeFormModal.tsx`, `karten/OnlineQuelleFormModal.tsx`,
  `karten/OfflineDownloadUrlModal.tsx`, `pages/BenutzerPage.tsx` (zwei Modale)
- Test: je Datei

- [ ] **Step 1: Failing test — die Struktur, aus der Enter folgt**

```tsx
it('legt den Absende-Knopf INS Formular und rendert keine antd-Fusszeile', async () => {
  renderMitProvidern(<FahrzeugFormModal offen onClose={vi.fn()} />, { benutzer: adminBenutzer });
  const knopf = await screen.findByRole('button', { name: 'Speichern' });
  // Die eingebaute Formularuebermittlung des Browsers traegt Enter — sie greift nur,
  // wenn der Knopf IM <form> liegt. Ein Knopf in antds Fusszeile ist ein DOM-Geschwister
  // ausserhalb und kann nichts uebermitteln (Befund H69).
  expect(knopf.closest('form')).not.toBeNull();
  expect(document.querySelector('.ant-modal-footer')).toBeNull();
});

it('fokussiert beim Oeffnen das erste Feld', async () => {
  renderMitProvidern(<FahrzeugFormModal offen onClose={vi.fn()} />, { benutzer: adminBenutzer });
  await waitFor(() => expect(screen.getByLabelText('Funkrufname')).toHaveFocus());
});

it('traegt beim Anlegen NICHT die Werte des zuletzt bearbeiteten Datensatzes', async () => {
  const { rerender } = renderMitProvidern(
    <FahrzeugFormModal offen fahrzeug={fahrzeugA} onClose={vi.fn()} />, { benutzer: adminBenutzer },
  );
  await waitFor(() => expect(screen.getByLabelText('Funkrufname')).toHaveValue('Florian 1'));
  rerender(<FahrzeugFormModal offen={false} onClose={vi.fn()} />);
  rerender(<FahrzeugFormModal offen onClose={vi.fn()} />);
  // rc-field-form haelt seinen Speicher ueber `destroyOnHidden` hinweg — ohne den Reset
  // der Huelle stuende hier „Florian 1" und der naechste Klick legte eine Dublette an.
  expect(screen.getByLabelText('Funkrufname')).toHaveValue('');
});
```

- [ ] **Step 2: Tests laufen lassen — erwartet FAIL**

- [ ] **Step 3: Je Maske umstellen (Muster `PersonalFormModal.tsx:113-125`)**

```tsx
<ErfassungsModal<FormWerte>
  offen={offen}
  titel={fahrzeug ? 'Fahrzeug bearbeiten' : 'Fahrzeug anlegen'}
  form={form}
  erfassenText="Speichern"
  laeuft={mutation.isPending}
  // `mutateAsync`, nicht `mutate`: bei Ablehnung muss die Zusage BRECHEN, sonst leert
  // die Huelle die Felder trotz 422 (LFH-332).
  onErfassen={(w) => mutation.mutateAsync(w)}
  onFertig={onClose}
  onAbbrechen={onClose}
>
```

Und beim Aufrufer: jedes `form.resetFields()` in `onCancel`/`onSuccess` **entfernen** — die
Hülle macht das auf allen vier Auswegen.

- [ ] **Step 4: `serie` an den drei Serien-Masken**

Fahrzeug, Personal und Material werden im Bestand angelegt, nicht einzeln:

```tsx
// `serie` nur im ANLEGEN-Modus: „Speichern und naechstes" ergibt beim Bearbeiten eines
// bestehenden Datensatzes keinen Sinn und stuende dort als toter Knopf.
serie={fahrzeug == null}
uebernahme={['traegerorganisation', 'standort']}
```

`uebernahme` trägt genau die Felder, die über eine Erfassungsserie hinweg gleich bleiben —
Trägerorganisation und Standort sind bei einer Einheit dieselben, Funkrufname und Kennzeichen
nie. Der „Werte behalten"-Schalter steht **aus** (Vorgabe der Hülle).

Test dazu:

```tsx
it('haelt beim Serien-Speichern die Uebernahmefelder und leert den Rest', async () => {
  renderMitProvidern(<FahrzeugFormModal offen onClose={vi.fn()} />, { benutzer: adminBenutzer });
  await userEvent.click(screen.getByRole('switch', { name: /Werte behalten/ }));
  await userEvent.type(screen.getByLabelText('Funkrufname'), 'Florian 1');
  await userEvent.type(screen.getByLabelText('Trägerorganisation'), 'FF Musterstadt');
  await userEvent.click(screen.getByRole('button', { name: /Speichern und nächstes/ }));
  await waitFor(() => expect(screen.getByLabelText('Funkrufname')).toHaveValue(''));
  expect(screen.getByLabelText('Trägerorganisation')).toHaveValue('FF Musterstadt');
  expect(screen.getByLabelText('Funkrufname')).toHaveFocus();
});
```

- [ ] **Step 5: Tests grün**

- [ ] **Step 6: Commit**

```bash
git add frontend/src/stammdaten/ frontend/src/karten/ frontend/src/pages/BenutzerPage.tsx
git commit -m "feat(lfh-346): zieht die Verwaltungs-Erfassungsmasken auf die Erfassungs-Huelle"
```

---

## Task A7: Fahrzeug und Personal auf eigene Routen

Befund H36. Elf bzw. acht Felder in einem 520-px-Modal verletzen die UI-Form-Leitlinie
(LFH-19: Modal ≤ ~3, Schnellerfassung ≤ ~4). Die Faustregel greift wörtlich: „Sobald ein
Drawer/Modal einen Edit-Modus mit vielen Feldern trägt, gehört der Inhalt auf eine eigene
Route."

**Files:**
- Create: `frontend/src/stammdaten/stammdatenDetail.ts`,
  `frontend/src/stammdaten/FahrzeugDetailPage.tsx`,
  `frontend/src/stammdaten/PersonalDetailPage.tsx` (+ Tests)
- Modify: `frontend/src/admin/adminNav.tsx` (Routen), `FahrzeugFormModal.tsx`,
  `PersonalFormModal.tsx`, `FahrzeugeTab.tsx`, `PersonalTab.tsx`

**Interfaces:**
- Produces: `fahrzeugDetailPfad(id: number): string`,
  `personalDetailPfad(id: number): string`

- [ ] **Step 1: Failing test der Pfad-Builder**

```ts
// frontend/src/stammdaten/stammdatenDetail.test.ts
it('baut die Detailpfade unter der Stammdaten-Sektion', () => {
  expect(fahrzeugDetailPfad(42)).toBe('/admin/stammdaten/fahrzeuge/42');
  expect(personalDetailPfad(7)).toBe('/admin/stammdaten/personal/7');
});

it('faellt bei ungueltiger Route-ID auf die Liste zurueck', () => {
  // Gleiche Regel wie `parseRouteId` in routing/deeplinks.ts: positive Ganzzahl, sonst
  // Redirect — eine „0"- oder „abc"-Route ist ein toter Link, kein leerer Datensatz.
  expect(parseRouteId('0')).toBeNull();
  expect(parseRouteId('abc')).toBeNull();
  expect(parseRouteId('42')).toBe(42);
});
```

- [ ] **Step 2: Builder schreiben**

```ts
// frontend/src/stammdaten/stammdatenDetail.ts
import { adminSektionPfad } from '../admin/adminNav';

/**
 * Admin-Detailpfade. Sie haengen an `adminSektionPfad` und NICHT an
 * `routing/deeplinks.ts`: dort liegen die Einsatz-Pfade, hier die Verwaltung. Zwei
 * Quellen fuer dieselbe Adressfamilie waeren die Lage, gegen die LFH-25 gebaut wurde.
 */
export function fahrzeugDetailPfad(id: number): string {
  return `${adminSektionPfad('stammdaten', 'fahrzeuge')}/${id}`;
}
export function personalDetailPfad(id: number): string {
  return `${adminSektionPfad('stammdaten', 'personal')}/${id}`;
}
```

`parseRouteId` wird aus `routing/deeplinks.ts` **importiert**, nicht kopiert.

- [ ] **Step 3: Test grün, dann die Detailseite (failing test zuerst)**

```tsx
it('zeigt das Fahrzeug aus der Liste und meldet eine unbekannte id', async () => {
  vi.mocked(listeFahrzeuge).mockResolvedValue([fahrzeugA]);
  renderMitRoute(`/admin/stammdaten/fahrzeuge/${fahrzeugA.id}`);
  expect(await screen.findByRole('heading', { name: /Florian 1/ })).toBeInTheDocument();

  renderMitRoute('/admin/stammdaten/fahrzeuge/999');
  // Kein serverseitiges 404 — den Fall erzeugt die Seite selbst, weil sie aus der
  // geladenen Liste selektiert. Ohne diese Aussage zeigte ein toter Deeplink ein
  // leeres Formular, das beim Speichern einen fremden Datensatz traefe.
  expect(await screen.findByText('Fahrzeug nicht gefunden')).toBeInTheDocument();
});
```

- [ ] **Step 4: Detailseite bauen**

```tsx
export default function FahrzeugDetailPage() {
  const { fahrzeugId } = useParams();
  const id = parseRouteId(fahrzeugId);
  // Dieselbe Query wie die Liste — TanStack fuehrt gleiche Keys zusammen, es entsteht
  // kein zweiter Request. `FahrzeugAnzeige` traegt alle Stammdatenfelder, ein
  // Einzel-GET laege Byte fuer Byte darauf.
  const query = useQuery({ queryKey: globalKeys.fahrzeuge(), queryFn: () => listeFahrzeuge() });
  if (id === null) return <Navigate to={adminSektionPfad('stammdaten', 'fahrzeuge')} replace />;
  if (query.isError) return <SeitenFehler … />;
  const fahrzeug = query.data?.find((f) => f.id === id);
  if (query.isSuccess && !fahrzeug) return <Empty description="Fahrzeug nicht gefunden">…</Empty>;
  …
}
```

**Nicht `components/Platzhalter.tsx`** für den Nicht-gefunden-Zweig: das trägt in Zeile 49
ein `🚧` im Titel und steht damit auf der Liste der ~15 Emoji-Bestandsstellen, die CLAUDE.md
führt. Die Regel („ein Emoji ist keine Ikone") ist für **Neues** verbindlich — eine brandneue
Seite darf sich die Altlast nicht einhandeln. `Empty` mit einem Link zurück auf die Liste
kommt ohne Bildzeichen aus.

Aufbau: `AdminPage` mit Brotkrume zur Liste, vier Sektionen (`SektionHeader`) — Identität,
Funk, Kapazität, Bemerkung — zweispaltig über `Row`/`Col` ab `lg`, gestapelt darunter, und
die Speicherleiste **sticky am unteren Rand im `<form>`** (Bauform aus C10: nur dort trägt
der Knopf `htmlType="submit"` und Enter sendet).

- [ ] **Step 5: Routen eintragen**

In der Routen-Definition unter `/admin` die zwei Kind-Routen ergänzen:
`stammdaten/fahrzeuge/:fahrzeugId` und `stammdaten/personal/:personalId`.

- [ ] **Step 6: Beide Modale auf Schnellerfassung kürzen**

Sichtbar bleiben genau die Felder, ohne die der Datensatz nicht angelegt werden kann bzw.
ohne die er im Einsatz nicht auffindbar ist. Der Rest wandert **nicht weg**, sondern auf die
Detailseite — „Mehr Details…" führt dorthin. Gemessene Aufteilung:

| Maske | heute | Schnellerfassung (≤ 4) | nur auf der Detailseite |
| --- | --- | --- | --- |
| `FahrzeugFormModal` | 11 | Funkrufname (Pflicht) · Fahrzeugtyp · Trägerorganisation · Kennzeichen | OPTA · Standort · FMS-ISSI · Sonder-/Wegerecht · Tragenkapazität · Soll-Stärke · Bemerkung |
| `PersonalFormModal` | 8 | Name (Pflicht) · Personalnummer · Trägerorganisation · Qualifikationen | Telefon · Stärke-Position · Benutzer-Konto · Bemerkung |

**Die Soll-Stärke muss auf der Detailseite zusammenbleiben.** `src/routes/fahrzeug.rs:267`
prüft das Trio gegen den Effektivzustand (`staerke_roh`, Mehrspalten-CHECK) — eine Maske, die
F/UF/M über zwei Sektionen verteilt und teilweise sendet, kann eine Kombination erzeugen, die
der CHECK ablehnt. Das Feld bleibt deshalb **ein** `Form.Item` in der Sektion „Kapazität",
genau wie heute (`FahrzeugFormModal.tsx:151`), und die Detailseite sendet **ein** Formular
mit allen Feldern (`aktualisiereFahrzeug` nimmt ohnehin das volle `FahrzeugEingabe`).

Der Link „Mehr Details…" erscheint **nur im Bearbeiten-Modus** — beim Anlegen gibt es noch
keine id und damit keine Route.

Test:

```tsx
it('zeigt in der Schnellerfassung hoechstens vier Felder', async () => {
  renderMitProvidern(<FahrzeugFormModal offen onClose={vi.fn()} />, { benutzer: adminBenutzer });
  // forceRender waere hier sinnlos — es GIBT keinen Collapse mehr, die Felder sind weg.
  expect(await screen.findAllByRole('textbox')).toHaveLength(4);
  expect(screen.queryByLabelText('Bemerkung')).not.toBeInTheDocument();
});
```

- [ ] **Step 7: Zeile verlinken**

Die Leitspalte (`funkrufname` / `name`) wird zum `<Link to={fahrzeugDetailPfad(f.id)}>`.
`KatalogTabelle` hat **kein** `onZeileKlick` — der Anker-Riegel aus LFH-340 betrifft nur
`Datensicht` und ist hier nicht anwendbar.

- [ ] **Step 8: Tests grün, Commit**

```bash
git add frontend/src/stammdaten/ frontend/src/admin/
git commit -m "feat(lfh-346): hebt Fahrzeug- und Personal-Stammdaten auf eigene Routen"
```

---

## Task A8: Die drei Collapse-Masken auf ≤ 3 sichtbare Felder

Befund N20 und der Rest von H36. Drei Masken liegen über der Schwelle, ohne dass ihr
Feldbestand eine eigene Route rechtfertigte — sie bekommen einen „Erweitert"-Collapse
statt einer Seite. **Gemessene Feldlisten** (25.08.2026):

| Maske | heute | sichtbar bleibt | hinter „Erweitert" |
| --- | --- | --- | --- |
| `karten/OnlineQuelleFormModal` | 7 | Name · URL · Typ | Attribution · Zoom-Grenzen · Proxy-Schalter · Aktiv-Schalter |
| `stammdaten/EtbBausteinFormModal` | 6 | Label · Typ · Inhalt | Meldeweg · Veranlassung · Sortierung |
| `stammdaten/MaterialFormModal` | 6 | Bezeichnung · Kategorie · Bestandsnummer | Trägerorganisation · Standort · Bemerkung |

`SprechgruppeFormModal` trägt 3 Felder und ist bereits konform — kein Task.

**Pflichtfeld-Regel (LFH-343 · H49):** kein Feld, das eine Ablehnung auslösen kann, wandert
hinter den Collapse. Bei allen drei Masken sind genau die Pflichtwerte die sichtbaren.

**Files:**
- Modify: `frontend/src/karten/OnlineQuelleFormModal.tsx:107-161`,
  `frontend/src/stammdaten/EtbBausteinFormModal.tsx:82-118`,
  `frontend/src/stammdaten/MaterialFormModal.tsx:80-106`
- Test: je Datei

**Interfaces:**
- Consumes: die `ErfassungsModal`-Hülle aus A6 — A8 läuft **nach** A6, sonst würde die
  Kürzung auf einer Maske landen, die A6 gleich wieder umbaut.

- [ ] **Step 1: Failing test — beide Hälften, je Maske**

```tsx
it('zeigt drei Felder und deckt den Rest auf', async () => {
  renderMitProvidern(<OnlineQuelleFormModal offen onClose={vi.fn()} />, { benutzer: adminBenutzer });
  // KEIN `forceRender` am Collapse: mit ihm stuenden die eingeklappten Felder im DOM und
  // die Zaehlung waere trivial erfuellt (Testfalle aus LFH-332/B4).
  const vorher = screen.getAllByRole('textbox').length;
  expect(vorher).toBe(3);
  await userEvent.click(screen.getByRole('button', { name: /Erweitert/ }));
  // Die zweite Haelfte: aufklappen laesst die Zahl STEIGEN. Ohne sie ist „≤ 3" nicht
  // widerlegbar — ein Modal ohne jedes Feld erfuellte es auch.
  expect((await screen.findAllByRole('textbox')).length).toBeGreaterThan(vorher);
});
```

Für `MaterialFormModal` und `EtbBausteinFormModal` dieselbe Bauform mit deren Zahlen.
Achtung: `role="textbox"` erfasst `Input` und `TextArea`, **nicht** `Select`/`Switch`/
`InputNumber` — wo ein Select unter den sichtbaren Feldern ist (Material: Kategorie, ETB:
Typ), zählt der Test stattdessen `container.querySelectorAll('.ant-form-item')` innerhalb
des sichtbaren Bereichs.

- [ ] **Step 2: Tests laufen lassen — erwartet FAIL**

- [ ] **Step 3: Umbauen**

Der Erklär-Alert zum Proxy (OnlineQuelle) wandert als `tooltip` an das `Form.Item` des
Schalters — ein Alert erklärt einen Zustand der **Seite**, ein Tooltip erklärt ein **Feld**.

- [ ] **Step 4: Tests grün, Commit**

```bash
git add frontend/src/karten/OnlineQuelleFormModal.tsx frontend/src/stammdaten/EtbBausteinFormModal.tsx \
        frontend/src/stammdaten/MaterialFormModal.tsx frontend/src/karten/*.test.tsx \
        frontend/src/stammdaten/*.test.tsx
git commit -m "fix(lfh-346): kuerzt die drei ueberlangen Katalog-Masken auf ihre Pflichtfelder"
```

---

## Task A9: Einsatz-Defaults — Gruppierung, Filter, Speicherleiste, Verlassen-Guard

Befunde M48 und M49 (Reste). C10 hat die Bereiche sichtbar getrennt und das Listen-Grid
gebaut; offen sind die Kategorie-Gruppierung, das Filterfeld, der „immer sichtbar"-Text, die
Speicherleiste im Fuß und der Verlassen-Guard.

**`useBlocker` steht nicht zur Verfügung** — gemessen in C7: er verlangt einen Data Router,
die Anwendung hängt an `<BrowserRouter>` (`main.tsx`), der Aufruf wirft beim Rendern. Den
In-App-Wechsel trägt deshalb nichts; Reload und Tab-Schluss trägt `beforeunload`.

**Files:**
- Modify: `frontend/src/pages/einstellungen/ModulEinstellungsListe.tsx`,
  `EinsatzDefaults.tsx`, `EinsatzModule.tsx`
- Test: je Datei

- [ ] **Step 1: Failing test — Gruppierung und Filter**

```tsx
it('gruppiert die Module in die sechs Registry-Kategorien', async () => {
  renderMitProvidern(<ModulEinstellungsListe {...basisProps} />);
  const koepfe = await screen.findAllByRole('heading', { level: 5 });
  // Die Reihenfolge stammt aus modulNachKategorie (modulRegistry.ts:89) und ist die der
  // Icon-Rail — eine eigene Sortierung hier waere eine zweite Wahrheit.
  expect(koepfe.map((h) => h.textContent)).toEqual(Object.keys(modulNachKategorie()));
});

it('filtert die Liste und laesst leere Kategorien ganz weg', async () => {
  renderMitProvidern(<ModulEinstellungsListe {...basisProps} />);
  await userEvent.type(screen.getByLabelText('Modul filtern'), 'lagekarte');
  expect(screen.getByText('Lagekarte')).toBeInTheDocument();
  expect(screen.queryByText('Einsatztagebuch')).not.toBeInTheDocument();
  // Eine Kategorie-Ueberschrift ohne Zeilen darunter behauptet eine Gruppe, die die
  // gefilterte Liste nicht hat.
  expect(screen.queryByRole('heading', { name: 'Kommunikation' })).not.toBeInTheDocument();
});

it('benennt die nicht ausblendbaren Module als solche', async () => {
  renderMitProvidern(<ModulEinstellungsListe {...basisProps} />);
  const zeile = (await screen.findByText('Einsatzdaten')).closest('[data-modul]')!;
  expect(within(zeile as HTMLElement).getByText('immer sichtbar, nicht ausblendbar')).toBeInTheDocument();
});
```

- [ ] **Step 2: Tests laufen lassen — erwartet FAIL**

- [ ] **Step 3: Umbauen**

Gruppierung über `modulNachKategorie()`, je Block ein `SektionHeader` (level 5), Filterfeld
über der Liste mit echtem `<label htmlFor>`. Die Spaltenköpfe fallen unter `md` bereits weg
(C10/H16) — daran ändert die Gruppierung nichts.

- [ ] **Step 4: Speicherleiste in den Fuß**

```tsx
// Der Knopf wandert aus dem Kopf-Slot IN das <form> (Bauform C10, EinsatzAllgemein):
// nur dort traegt er `htmlType="submit"`, und damit sendet Enter (Erfassungs-Norm B4).
// Ein Knopf im Kopf-Slot ist ein DOM-Geschwister ausserhalb des <form> und kann nichts
// uebermitteln. „Genau eine Primaeraktion im Kopf" (LFH-340) ist damit trivial erfuellt.
<div style={speicherLeisteStil(token)}>
  <Button type="primary" htmlType="submit" loading={speichernMutation.isPending} disabled={!istAdmin}>
    Speichern
  </Button>
</div>
```

`speicherLeisteStil` wird aus `einstellungen/einsatzEinstellungenForm.ts` **wiederverwendet**
(rein und exportiert, C10) — nicht neu geschrieben.

- [ ] **Step 5: Verlassen-Guard**

```tsx
// `useBlocker` ist hier NICHT baubar: er verlangt einen Data Router, die Anwendung haengt
// an <BrowserRouter> (main.tsx) und der Aufruf wirft beim Rendern (gemessen, LFH-342/C7).
// Was bleibt, ist der Weg aus dem Dokument heraus.
useEffect(() => {
  if (!hatFassung) return;
  const handler = (e: BeforeUnloadEvent) => e.preventDefault();
  window.addEventListener('beforeunload', handler);
  return () => window.removeEventListener('beforeunload', handler);
}, [hatFassung]);
```

`hatFassung` ist ein eigener State, **nicht** `form.isFieldsTouched()` — antd setzt das Flag
beim Speichern nicht zurück (C7).

Test dazu als **Paar**:

```tsx
it('warnt beim Verlassen nur mit ungespeicherter Fassung', async () => {
  renderMitProvidern(<EinsatzDefaults />, { benutzer: adminBenutzer });
  await screen.findByLabelText(/Präfix ETB/);

  // Geprueft wird das VERHALTEN, nicht ein `addEventListener`-Spy: der haenge sonst daran,
  // dass sonst niemand im Baum je dasselbe Ereignis registriert — eine Zusicherung ueber
  // fremden Code, die beim naechsten Hook still bricht.
  const feuern = () => {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  };

  // Gegenaussage zuerst: ohne offene Fassung schweigt der Guard.
  expect(feuern()).toBe(false);
  await userEvent.type(screen.getByLabelText(/Präfix ETB/), 'X');
  await waitFor(() => expect(feuern()).toBe(true));
});
```

- [ ] **Step 6: Tests grün, Commit**

```bash
git add frontend/src/pages/einstellungen/
git commit -m "feat(lfh-346): gruppiert die Modulzeilen und sichert die Einsatz-Defaults gegen Verlassen"
```

---

## Task A10: Prüfliste Einsatztauglichkeit + Ticket nachziehen

Ein Modul-Task ohne ausgefüllte Prüfliste gilt nicht als fertig (Gate 7).

- [ ] **Step 1: Prüfliste anlegen**

`docs/superpowers/specs/2026-08-25-lfh-346-pruefliste.md` — 15 Zeilen, je ein Verdikt
(erfüllt / offen → Zielticket / nicht anwendbar → Begründung). Zuschnitt: **je Fläche**, weil
C11 drei verschiedene Flächenarten anfasst — Katalogseite (stellvertretend `FahrzeugeTab`),
Detailseite (`FahrzeugDetailPage`, neu) und Einstellungsseite (`EinsatzDefaults`). Eine
Prüfliste über „die Verwaltung" als Ganzes verwischt genau die Unterschiede, für die die
Liste existiert.

- [ ] **Step 2: Playwright — die Pixel-Aussagen**

Was jsdom nicht messen kann, misst ein e2e-Fall: Zeilenaktion ≥ 32 px hoch, Abstand zur
destruktiven Nachbaraktion ≥ `marginSM`, Modul-Rollenspalte fällt bei 390 px nicht auf ihre
Pfeil-Ikone zusammen. Gemessen wird gegen die **Contentbreite**, nie gegen die
Tabellenbreite (`KatalogTabelle` rendert mit `width: max-content`).

- [ ] **Step 3: CLAUDE.md fortschreiben**

Die vier Festlegungen, die dieser Task neu trifft und die kein Guard hält:

1. **Rechte-Darstellung mit zwei Zuschnitten** — die Primäraktion steht gesperrt mit
   `RechteHinweis`, die Zeilenaktionsspalte entfällt weiterhin. Warum das kein Widerspruch
   ist, steht in A2.
2. **Der Kopf-Slot trägt, was ÖFFNET — nie, was ABSENDET.** A3 legt die Anlegen-Knöpfe
   **in** den Slot, A9 holt den Speichern-Knopf **heraus**. Beides ist richtig, und der
   Unterschied ist die Ursache: „Fahrzeug anlegen" öffnet ein Modal bzw. eine Route und
   braucht kein `<form>`; ein Speichern-Knopf **muss** im `<form>` liegen, sonst sendet
   Enter nicht (Erfassungs-Norm B4, und `AdminPage` sagt es im eigenen Doc-Kommentar).
   Ohne diesen Satz wird die nächste Runde die beiden „harmonisieren" und dabei die
   Enter-Zusicherung töten.
3. **Admin-Detailpfade hängen an `adminNav`**, nicht an `deeplinks.ts`.
4. **Warum kein Einzel-GET entstanden ist** — `FahrzeugAnzeige` trägt die vollen
   Stammdaten, ein zweiter Endpunkt wäre ein zweites Cache-Fach für dieselben Bytes.

- [ ] **Step 4: Ticket nachziehen**

Verdikt-Tabelle und korrigierte ACs in die ClickUp-Beschreibung.

- [ ] **Step 5: `./scripts/check-all.sh` — alle sieben Gates grün**

- [ ] **Step 6: Commit**

---

## Self-Review

**Spec-Abdeckung:** 15 Befunde → A1 (H35, M50), A2 (M45), A3 (M46), A4 (N13),
A6 (M42, M43), A7 (H36 · Fahrzeug + Personal), A8 (N20 + H36 · Material, ETB-Baustein),
A9 (M48, M49).

- **H34, M44, M47** sind erfüllter Bestand (Spec) und haben zu Recht keinen Task.
- **N19** ist zweigeteilt: Scroll-Gate erfüllt (das Primitiv setzt es), Bündelung **nicht
  anwendbar** — gemessen maximal 2 Zeilenaktionen je Zustand, die Schwelle liegt bei 3
  (A5, entfallen).
- **H36 ist vollständig abgedeckt**, aber über zwei Tasks: was eine Route braucht (Fahrzeug
  11, Personal 8) liegt in A7, was ein Collapse löst (Material 6, ETB-Baustein 6) in A8.
  `SprechgruppeFormModal` trägt 3 Felder und war nie über der Schwelle. Damit hält die
  korrigierte Zusicherung „kein Katalog-Modal über 4 sichtbare `Form.Item`" nach A8
  tatsächlich — vorher behauptete dieser Abschnitt eine Deckung, die der Plan nicht hatte.

**Reihenfolge-Korrektur:** A8 läuft **nach** A6 (die Hülle zuerst, dann die Kürzung), nicht
parallel dazu. A4 und A9 bleiben unabhängig.

**Platzhalter:** keine — jeder Code-Schritt trägt den Code, jeder Test die Assertion.

**Typkonsistenz:** `STAMMDATEN_RECHTE_TEXT` (A2 → A3), `fahrzeugDetailPfad`/
`personalDetailPfad` (A7), `speicherLeisteStil` (aus C10, A9). `parseRouteId` wird
importiert, nicht nachgebaut.
