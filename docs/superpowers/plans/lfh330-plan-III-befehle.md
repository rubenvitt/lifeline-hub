# Bündel III — Befehle + Lageberichte auf Kartenmuster

# Umsetzungsplan — Bündel III · Befehle + Lageberichte auf Kartenmuster (LFH-330 · B2)

Alle Angaben am Code von `a06cd0f` nachgeschlagen. Absolute Pfade relativ zu
`/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive`.

---

## 0. Vorab: die Frage aus dem Auftrag — was v-Nummer und Schema wirklich sind

**Die v-Nummer ist ein Kettenindex über ZEILEN, kein Änderungszähler an einer Zeile.**
`befehl_repo::fortschreiben` (`src/befehl/repo.rs:266-297`) macht ein `INSERT` einer **neuen
Zeile** mit `version + 1` (`:292`), `vorgaenger_id = id` (`:293`), **demselben `titel`** (`:288`),
**derselben `vorlage`** (`:287`) und den kopierten `abschnitte` des Vorgängers (`:290`); der
Vorgänger bleibt unverändert `freigegeben` liegen. `befehl_repo::liste` (`src/befehl/repo.rs:99`)
gibt **alle** Zeilen des Einsatzes zurück, `ORDER BY l.zeitstand DESC, l.id DESC`.

Folgen, die den ganzen Entwurf tragen:

1. Die Liste enthält legitim **mehrere Zeilen mit identischem Titel** und verschiedenen
   Versionen. Die v-Nummer ist damit **das einzige Merkmal, das zwei Zeilen unterscheidet** —
   sie ist kein Zierrat und darf nicht „nur bei `version > 1`" gezeigt werden.
2. Die Gruppierung Entwürfe/Freigegeben **zerschneidet die Kette**: v2 (Entwurf) steht oben,
   v1 (freigegeben) unten. Das ist fachlich richtig — nur der Entwurf ist bearbeitbar.
3. `findByRole('link', { name: 'Befehl A' })` (Singular) **wirft bei mehreren Treffern**. Jeder
   Test mit Kettenfixture muss `findAllByRole` nutzen oder auf eine Gruppe einschränken.

**Das Schema ist die SKK-Befehlsform, nicht ein Formatierungsstil.** `vorlage:
BefehlVorlageKey` (`frontend/src/api/types.generated.ts:210` ff.; Enum-Werte `befehl_lad`,
`befehl_ladef`, `befehl_schnee`, `befehl_ea_zmw`) bestimmt **welche Abschnitte** der Befehl trägt
— `frontend/src/befehle/vorlagen.ts:19-61`, gepinnt gegen `src/befehl/mod.rs::VORLAGEN`
(`vorlagen.ts:16`). Es ist über die Fortschreibung **unveränderlich** (`repo.rs:287`), also ein
Merkmal der Kette, nicht der Fassung. Lageberichte haben dieselbe Achse unter dem Namen
`Vorlage` (`frontend/src/lageberichte/vorlagen.ts:17-50`, drei Werte). Deshalb ist das Schema ein
Filterkandidat (4 bzw. 3 Werte, geschlossene Menge) und kein Freitext.

---

## 1. Harte Vorbedingung: `Datensicht` existiert nicht

`grep -rn "Datensicht" frontend/src frontend/e2e docs` → **0 Treffer**;
`frontend/src/components/` enthält kein `Datensicht.tsx`. Bündel III ist **Konsument** von AP1,
nicht Erbauer. Aus §8 der festgelegten API folgt zwingend: beide Dateien laufen über
`<Datensicht form="karte" …>` und stehen im `form="karte"`-Inventar von
`frontend/src/components/datensicht.guard.test.ts`.

**Schritt 0 (kein Test, kein Code): Vertrag gegen die gelieferte Datei prüfen.**

```bash
grep -n "export function spaltenFuer\|art: 'plan'\|TitelBezug\|sekundaer\|Gruppierung\|leerText\|aria-label" \
  frontend/src/components/Datensicht.tsx
grep -n "BefehlListe\|LageberichtePage\|form=\"karte\"\|KARTEN_EIGENBAU" \
  frontend/src/components/datensicht.guard.test.ts
```

Bündel III konsumiert genau sechs Zusicherungen. Weicht eine ab, ändert sich der Plan, **nicht**
der Konsument:

| Zusicherung | Wo im Plan tragend |
|---|---|
| `spaltenFuer<T>()([…])` curried, bewahrt `const K` | Schritt 2/5, Tippfehlersicherheit der Slots |
| `karte.titel.ziel` erzeugt einen echten `<Link>`, Accessible Name = Ausgabe des Titel-`render` | T1/T4 (`href`-Assertion, LFH-25) |
| `sekundaer`-Tupel ≤ 3, Inhalt über `zelle()` aus dem Spalten-`render` | Slotbelegung Schritt 2 |
| `gruppen` rendert im **Kartenzweig** echte Gruppenköpfe mit Zähler | T1/T4 (Gruppenzähler) |
| `leerText` → `Liste emptyText`, **kein** neuer `<Empty>`-Knoten | E1, T3 |
| `bezeichnung` → `<section aria-label>` (Rolle `region`) | jede Assertion, AP8-Anker |

**Was ein roter Test beweist und was nicht.** Ein Test, der rot ist, weil
`components/Datensicht` nicht auflösbar ist, beweist **nichts** — er misst einen fehlenden
Import. Deshalb ist die Reihenfolge in §2 so gebaut, dass jeder Konsumententest **gegen die
noch bestehende Tabellen-Implementierung** rot ist: `BefehlListe.tsx` kompiliert vor dem Umbau
weiter, der Test scheitert an fehlender `region`-Rolle, fehlenden Gruppenköpfen und fehlendem
`v`-Präfix — an der Sache, nicht am Modulpfad.

---

## 2. Reihenfolge der Schritte — erst der Test, dann der Code

### Schritt 1 — Status-Deskriptoren für Befehl/Lagebericht

**Test zuerst:** `frontend/src/kommunikation/phase.test.ts`, neuer `it`-Block im bestehenden
`describe('Status-Deskriptoren')` (heute `:30-58`), Muster der vier Vorbild-Blöcke `:31-57`:

```ts
it('BEFEHL/LAGEBERICHT mappen entwurf→offen, freigegeben→abgeschlossen', () => {
  expect(BEFEHL_STATUS.entwurf).toEqual({ label: 'Entwurf', phase: 'offen' });
  expect(BEFEHL_STATUS.freigegeben).toEqual({ label: 'Freigegeben', phase: 'abgeschlossen' });
  expect(LAGEBERICHT_STATUS).toEqual(BEFEHL_STATUS);   // eine Achse, zwei Module
});

it('reproduziert die Bestandsfarben der beiden Listen byte-genau', () => {
  // BefehlListe.tsx:40 / LageberichtePage.tsx:83 heute: green für freigegeben, sonst default.
  expect(PHASE_META[BEFEHL_STATUS.entwurf.phase].color).toBe('default');
  expect(PHASE_META[BEFEHL_STATUS.freigegeben.phase].color).toBe('success');
});
```

**Warum rot, nicht trivial grün:** `BEFEHL_STATUS`/`LAGEBERICHT_STATUS` existieren nicht
(`phase.ts` hat genau vier Deskriptoren, `:40-69`) → TS-Auflösungsfehler, die Datei fällt
komplett. Der zweite Block ist die eigentliche Aussage: er pinnt die Behauptung „kein
sichtbarer Farbwechsel gegen heute" gegen `PHASE_META` (`phase.ts:12-17`) statt sie zu behaupten.
Es gibt **keinen** Vollständigkeits-Guard über die Deskriptor-Menge — ohne diesen `it`-Block
ginge die neue Registry ungepinnt raus.

**Dann Code:**
- `frontend/src/kommunikation/phase.ts`: zwei `StatusDeskriptor`-Konstanten nach `:69`
  einfügen (`entwurf: { label: 'Entwurf', phase: 'offen' }`,
  `freigegeben: { label: 'Freigegeben', phase: 'abgeschlossen' }`), je mit Doc-Kommentar im
  Stil `:39/:47/:55/:64` und dem Vermerk, dass `BefehlStatus`/`LageberichtStatus`
  (`api/types.generated.ts:210` / `:1307`) beide `'entwurf' | 'freigegeben'` sind.
- `frontend/src/kommunikation/index.ts`: beide Namen in die Export-Liste `:5-15`.

**Warum hier und nicht in `theme/statusFarben.ts` — gemessen, nicht gemeint.**
`theme/statusFarben.test.ts:22-43` leitet sein Inventar **aus dem Modul** ab (jede Map, deren
Werte `rolle` tragen) und vergleicht gegen eine 9-Elemente-Liste. Eine zehnte Map in
`statusFarben.ts` macht `:32` sofort rot — der Guard arbeitet wie entworfen, aber Bündel III
wäre damit Schreiber in `theme/`, das laut Kritik §6 schon drei Schreiber hat. `statusFarben.ts`
selbst nennt `kommunikation/phase.ts` in `:44-49` **ausdrücklich als bewusst außerhalb des
A2-Vertrags**; es hineinzuziehen „wäre der Bestands-Sweep, den A2 ausdrücklich verbietet".
E6 („Statusdarstellung nur über `StatusDarstellung`/`StatusTag`") steht im Satz mit
`KAT_FARBE`→`statusKategorie` und zielt auf die **Kräfte**-Achse; auf `phase.ts` reicht es
nicht. Ein erfundener Brücken-Typ `phaseDarstellung: Record<KommPhase, StatusDarstellung>`
wäre der erste Schritt genau dieses Sweeps für zwei von sechs Modulen und ist damit
ausgeschlossen.

**Konsequenz, die im Plan sichtbar bleiben muss:** `karte.status` (Slot der `Datensicht`) nimmt
nur eine `StatusDarstellung` und bleibt deshalb **unbenutzt**; der `StatusBadge` belegt einen
der drei `sekundaer`-Slots. Das ist der Preis dafür, auf der Kommunikations-Achse zu bleiben und
im Nachbar-Tab (`AuftragKarte.tsx:115`) identisch auszusehen.

---

### Schritt 2 — `BefehlListe` auf Kartenmuster (der tragende Schritt)

**Test zuerst**, `frontend/src/auftraege/BefehlListe.test.tsx`. Die Fixture `:25-30` wird von
einer Zeile auf eine **Fortschreibungskette** erweitert (Server-Reihenfolge
`zeitstand DESC, id DESC` nachgebildet):

```ts
const KETTE = [
  { ...BASIS, id: 9, titel: 'Befehl A', version: 2, status: 'entwurf',
    zeitstand: '2026-06-02 12:00:00', vorgaenger_id: 7 },
  { ...BASIS, id: 7, titel: 'Befehl A', version: 1, status: 'freigegeben',
    zeitstand: '2026-06-02 10:00:00', vorgaenger_id: null },
  { ...BASIS, id: 4, titel: 'EA 2. Zug', version: 1, status: 'freigegeben',
    vorlage: 'befehl_ea_zmw', zeitstand: '2026-06-02 09:00:00' },
];
```

**T1 — „die Fortschreibungskette ist als Kette lesbar"** (der eine Test, der alles Neue
gleichzeitig trägt):

```ts
const sicht = await screen.findByRole('region', { name: 'Befehle' });
// Kette: zwei Karten mit demselben Titel, unterscheidbar nur über die v-Nummer.
const links = screen.getAllByRole('link', { name: 'Befehl A' });
expect(links.map((l) => l.getAttribute('href'))).toEqual([
  '/einsaetze/1/auftraege/befehle/9', '/einsaetze/1/auftraege/befehle/7',
]);
expect(sicht).toHaveTextContent('v2');
expect(sicht).toHaveTextContent('v1');
// Gruppen mit Zähler, Entwürfe zuerst (gruppen.reihenfolge).
expect(sicht).toHaveTextContent(/Entwürfe\s*[·(]\s*1/);
expect(sicht).toHaveTextContent(/Freigegeben\s*[·(]\s*2/);
const t = sicht.textContent ?? '';
expect(t.indexOf('Entwürfe')).toBeLessThan(t.indexOf('Freigegeben'));
```

*Warum rot:* `getByRole('region', …)` wirft — die heutige `<div>`-Wurzel (`BefehlListe.tsx:47`)
hat keine Rolle und kein `aria-label`. Auch nach Behebung nur der Rolle bliebe rot: die heutige
Tabelle rendert `Version` als nackte Zahl (`:42`) → `toHaveTextContent('v2')` scheitert, und es
gibt keinerlei Gruppenköpfe (`:39-41` ist eine Statusspalte, keine Gruppierung).
*Warum nicht trivial grün:* die `href`-Assertion allein wäre **auch mit der alten Tabelle grün**
(der Titel-`Link` `:34-36` liefert beide Links in derselben Reihenfolge). Genau deshalb steht sie
zusammen mit den drei Behauptungen, die nur der Umbau erfüllt — und der
`getAllByRole`-Plural ist Pflicht: `findByRole` (Singular) wirft bei zwei Treffern, die
Kettenfixture würde den Bestandstest `:36` sonst aus dem falschen Grund rot machen.
*Warum die Gruppenkopf-Assertion ein Regex mit `[·(]` ist:* das Trennzeichen des Gruppenkopfs
gehört **AP1** (§5 schreibt „`verfügbar · 7`", der Auftrag sagt „Entwürfe (n)"). `getByText` mit
Regex prüft pro Element und scheitert, wenn der Kopf aus zwei `span` besteht;
`toHaveTextContent` auf der Region ist gegen beide Bauformen stabil.

**T2 — „die Suche filtert die Kartenliste"**:

```ts
await userEvent.type(screen.getByPlaceholderText('Titel oder Schema'), 'EA/ZMW');
expect(screen.queryAllByRole('link', { name: 'Befehl A' })).toHaveLength(0);
expect(screen.getByRole('link', { name: 'EA 2. Zug' })).toBeInTheDocument();
```
*Warum rot:* es gibt heute kein Suchfeld in `frontend/src` für Befehle
(`grep -c "Input.Search" frontend/src` → 3 Treffer, keiner in `auftraege/`).
*Nicht trivial grün:* der Filter muss über `suchText` **beider** Spalten laufen — der Suchbegriff
`EA/ZMW` steht nur im Schema-Label (`vorlagen.ts:53`), nicht im Titel. Ein nur auf den Titel
gelegter `suchText` wäre rot.

**T3 — Regressionswächter Leerzustand (kein Treiber, ehrlich als solcher benannt):**
```ts
vi.mocked(befehleApi.listeBefehle).mockResolvedValue([] as never);
const { container } = renderListe();
expect(await screen.findByText('Noch keine Befehle')).toBeInTheDocument();
expect(container.querySelector('.ant-empty')).toBeNull();   // E1
```
*Ehrlichkeit:* beide Assertions sind **heute schon grün** (antds `locale.emptyText` mit String
rendert keinen `.ant-empty`-Knoten). Der Test treibt nichts, er hält E1 fest, sobald der
Leerzustand über `Liste`s `emptyText` (`components/Liste.tsx:83-94`) läuft — dort **würde** ohne
`leerText` das Fallback-`<Empty>` (`:92`) erscheinen. Er ist der Grund, warum `leerText` nicht
weggelassen werden darf.

**Dann Code — `frontend/src/auftraege/BefehlListe.tsx`:**

| heute | nachher |
|---|---|
| `:1` Import `Table, Tag`, `:3` `TableColumnsType` | weg; dazu `Flex`, `Typography`, `PlusOutlined`, `Datensicht`, `spaltenFuer`, `StatusBadge`, `BEFEHL_STATUS`, `ZeitAnzeige` |
| `:5` `Link` aus `react-router` | **weg** — der Link entsteht in `karte.titel.ziel` |
| `:33-44` `spalten` **im Körper** | Modulkonstante `befehlSpalten` über `spaltenFuer<BefehlAnzeige>()([…])`, **oberhalb** der Komponente (möglich, weil der Titel-`render` ohne `einsatzId` auskommt) |
| `:48-50` `Space` mit nur dem Knopf | `Flex justify="space-between" align="center" gap={16} wrap` mit `Typography.Title level={3}>Befehle` + Kennzahlenzeile, Muster `AuftraegeListe.tsx:141-158` |
| `:51-58` `<Table>` | `<Datensicht form="karte" …>` |
| `:20-31`, `:59-76` Query, Mutation, Modal | **unverändert** |

Spaltenregister (vier Spalten; die Tabelle rendert nie, das Register ist Träger von
`etikett`/`sortWert`/`suchText`/`filter`):

```tsx
const befehlSpalten = spaltenFuer<BefehlAnzeige>()([
  { key: 'titel', title: 'Titel', immerSichtbar: true,
    sortWert: (b) => b.titel, suchText: (b) => b.titel,
    // KEIN <a> hier: den Link setzt karte.titel.ziel, sonst verschachtelte Links.
    render: (_t, b) => b.titel },
  { key: 'status', title: 'Status',
    render: (_t, b) => <StatusBadge phase={BEFEHL_STATUS[b.status].phase}
                                    label={BEFEHL_STATUS[b.status].label} /> },
  { key: 'schema', title: 'Schema',
    suchText: (b) => schemaLabel(b.vorlage),
    filter: { werte: VORLAGEN.map((v) => ({ text: v.label, value: v.schluessel })),
              trifft: (b, w) => b.vorlage === w },
    render: (_t, b) => schemaLabel(b.vorlage) },
  { key: 'fassung', title: 'Fassung', sortWert: (b) => b.zeitstand,
    render: (_t, b) => <>v{b.version} · <ZeitAnzeige wert={b.zeitstand} /> · {b.ersteller_name}</> },
]);
```

Aufruf:

```tsx
<Datensicht
  bezeichnung="Befehle"
  form="karte"                      // Ein Befehl wird GELESEN, nicht verglichen (E7-Trennlinie)
  spalten={befehlSpalten}
  daten={befehleQuery.data ?? []}
  zeilenSchluessel="id"
  ladend={befehleQuery.isLoading}
  leerText="Noch keine Befehle"
  suche={{ platzhalter: 'Titel oder Schema' }}
  standardSortierung={{ spalte: 'fassung', richtung: 'ab' }}
  gruppen={{ schluessel: (b) => b.status,
             etikett: (w) => (w === 'entwurf' ? 'Entwürfe' : 'Freigegeben'),
             reihenfolge: ['entwurf', 'freigegeben'] }}
  karte={{ art: 'plan',
           titel: { spalte: 'titel', ziel: (b) => befehlDetailPfad(einsatzId, b.id) },
           sekundaer: ['status', 'schema', 'fassung'] }}
/>
```

**Slotbelegung, begründet:** `status` besetzt einen `sekundaer`-Slot, weil `karte.status` nur
eine `StatusDarstellung` nimmt (Schritt 1). `fassung` bündelt v-Nummer, Zeitstand und Ersteller
in **einer** Zeile — Muster `NachforderungKarte.tsx:87-90`. Damit sind genau drei Slots belegt
(`MAX_SEKUNDAER`), und alle sechs Fakten der alten Tabelle (`:33-44`) sind erhalten.

**Kein `karte.aktion`:** die Zeile hat heute keine Aktion — Freigeben/Fortschreiben/Drucken
liegen auf `pages/BefehlDetailPage.tsx:167-186`. Die einzige Interaktion ist der Titel-Link,
und der ist laut §2/Zusicherung 4 das Tastaturziel. Ein „Öffnen"-Knopf daneben wäre
Verdopplung.

---

### Schritt 3 — Kopfzeile angleichen (im Code von Schritt 2, Test separat)

**Test:** ein `it` in `BefehlListe.test.tsx`:
```ts
expect(await screen.findByRole('heading', { name: 'Befehle', level: 3 })).toBeInTheDocument();
expect(screen.getByText(/1 im Entwurf/)).toBeInTheDocument();
```
*Rot:* heute existiert überhaupt keine Überschrift in der Datei (`:48-50` trägt nur den Knopf).

**Code:** `Flex`-Kopf nach `AuftraegeListe.tsx:141-158`, Kennzahlenzeile
`{alle.length} Befehle · {entwuerfe} im Entwurf` als `Typography.Text type="secondary"`.
Der Knopf bleibt `Befehl erteilen` (**Pflicht**: gepinnt von `BefehlListe.test.tsx:43` **und**
`pages/AuftraegePage.test.tsx:254`) mit `icon={<PlusOutlined />}`, **ohne** Toggle-Label — die
Anlage läuft über das Modal `:59-76`, nicht über ein Inline-Formular wie `AuftraegeListe.tsx:155`.

Zwei bewusste Abweichungen vom Vorbild, beide benannt:
- **kein `size="large"`** (`AuftraegeListe.tsx:151`). Träger der Dichte ist laut CLAUDE.md das
  Dichte-Token am `ConfigProvider`; `large` deckelt bei 40 px und ist derselbe punktuelle
  Override wie das verbotene `size="small"`, nur in der anderen Richtung. → Folgeauftrag an
  **B5 (LFH-333)**: `size="large"` aus `AuftraegeListe.tsx:151` entfernen, dann sind beide Tabs
  wieder identisch.
- **keine Highlight-/Selektionsmechanik.** `useQueryParamSelektion` (`AuftraegeListe.tsx:56-63`),
  `data-auftrag-id`/`data-hervorgehoben` (`AuftragKarte.tsx:102-103`) und der Scroll-Effekt
  (`:64-67`) werden **nicht** gespiegelt: einen `?befehl=`-Schlüssel gibt es in
  `frontend/src/routing/deeplinks.ts` nicht (nur `befehlDetailPfad`, `:56-58`; `auftraegePfad`
  kennt allein `{ auftrag }`, `:146-148`). Sie mitzunehmen würde einen neuen Deeplink-Schlüssel
  einführen und die Aussage „kein Deeplink berührt" kippen. → eigenes Ticket.

Die **Überschriften-Dopplung** (Tab „Befehle", `AuftraegePage.tsx:47` + Heading „Befehle" +
`region`-Label „Befehle") wird bewusst gespiegelt — `AuftraegeListe.tsx:143` hat sie ebenso.
`getByRole('tab', { name: 'Befehle' })` in `AuftraegePage.test.tsx:250` ist rollenbeschränkt und
bleibt eindeutig.

---

### Schritt 4 — Zeitstand-Format: Liste **und** die zwei Detailseiten, in einem Schritt

Dies ist die eine Entscheidung, die über die Dateiliste des Bündels hinausgeht, und sie wird
**laut** getroffen, nicht mitgenommen.

**Befund:** `zeitstand` ist ein UTC-String `YYYY-MM-DD HH:MM:SS` ohne Zonenmarke
(`src/routes/befehl.rs:23-25` `jetzt()`, `src/etb/mod.rs:206-218` `normalisiere_zeit`). Heute
wird er **roh** ausgegeben: `BefehlListe.tsx:38`, `LageberichtePage.tsx:78`,
`pages/BefehlDetailPage.tsx:190`, `pages/LageberichtDetailPage.tsx:191`.
Nur die Liste zu formatieren erzeugt nicht zwei Formate, sondern **zwei Uhrzeiten** für ein Feld:
die Liste zeigte lokal `021200JUN2026`, die Detailseite den rohen UTC-Wert `2026-06-02 10:00:00`.
Das ist schlimmer als der Ist-Zustand.

**Entscheidung:** alle vier Stellen auf `<ZeitAnzeige wert={…} />` (Default `dtgVoll`,
`frontend/src/anzeige/ZeitAnzeige.tsx:25-30`). Begründung: die taktische DTG ist die
BOS-Konvention für Zeitangaben (LFH-141, `anzeige/format.ts:83-91`), `ZeitAnzeige` ist
zeitzonen-**bewusst** (`format.ts:45-53`) und ohne Provider byte-identisch zum Default
(`anzeige/AnzeigeKonventionenContext.tsx:7-8`, `:43-45` — kein Throw).
**Was das mitverändert, ausdrücklich:** `BefehlDetailPage.tsx:190` liegt **innerhalb** des
Druckbereichs (`:147` `<div className="befehl-print-root">`, `pages/befehlPrint.css:6-9`
schaltet nur diesen sichtbar; `befehl-no-print` `:158` markiert nur die Werkzeugleiste). Ein
gedruckter Befehl trägt danach `021200JUN2026` statt eines unbeschrifteten UTC-Zeitstempels.
Das ist für ein Befehlsdokument die richtigere Angabe — es ist eine fachliche Entscheidung am
Dokument und wird deshalb hier notiert und getestet, nicht stillschweigend gemacht.

**Test zuerst** (TZ-sicher, Erwartung im Test gerechnet — Muster `kommunikation/badges.test.tsx:41-45`;
`frontend/vite.config.ts:82-87` setzt **kein `TZ`**, ein Literal wäre maschinenabhängig):

```ts
import { taktischeDtgVoll } from '../anzeige/format';
// pages/BefehlDetailPage.test.tsx
expect(await screen.findByText(/^Zeitstand:/))
  .toHaveTextContent(taktischeDtgVoll('2026-06-02 10:00:00'));
```
Analog in `pages/LageberichtePage.test.tsx` (`describe('LageberichtDetailPage')`, `setupDetail`
`:64-78`) für `pages/LageberichtDetailPage.tsx:191`.
*Rot:* beide Seiten geben heute den Rohstring aus. *Kein Bestandstest bricht:*
`grep -rn "Zeitstand" --include="*.test.tsx" frontend/src` trifft **keine** Assertion; die
fünf Fixtures mit `zeitstand:` (`BefehlListe.test.tsx:26`, `LageberichtePage.test.tsx:28`,
`BefehlDetailPage.test.tsx:41`, `LageberichtDetailPage.test.tsx:16`,
`lage-dashboard/lageVerdichtung.test.ts:125`) sind reine Eingabedaten.

Der `v{version}`-Tag der Detailseiten (`BefehlDetailPage.tsx:165`,
`LageberichtDetailPage.tsx:166`) bleibt unverändert — die Liste übernimmt seine Schreibweise,
nicht umgekehrt.

---

### Schritt 5 — `LageberichtePage` (E5: der Zwilling wird mitgezogen)

**Test zuerst**, `frontend/src/pages/LageberichtePage.test.tsx`: T1/T2/T3 gespiegelt mit
`bezeichnung="Lageberichte"`, Kettenfixture aus `bericht` (`:27-33`) + einer zweiten Fassung
(`id: 12, version: 2, status: 'entwurf', vorgaenger_id: 11`, gleicher `titel: 'Lage 10:00'`),
Suchplatzhalter `'Titel oder Vorlage'`, Filterwerte aus `lageberichte/vorlagen.ts:17-50`.
`setup()` (`:35-49`) nimmt die Liste bereits als Parameter — keine Änderung nötig.

**Code** — `frontend/src/pages/LageberichtePage.tsx`:
- `:1` `Table, Tag` und `:3` `TableColumnsType` aus den Imports; `Flex`, `Datensicht`,
  `spaltenFuer`, `StatusBadge`, `LAGEBERICHT_STATUS`, `ZeitAnzeige` dazu. `Link` (`:5`) bleibt —
  der Breadcrumb `:97` braucht ihn.
- `:65-90` `spalten` → Modulkonstante `lageberichtSpalten` per `spaltenFuer<LageberichtAnzeige>()`,
  Spalte 2 heißt `vorlage`/„Vorlage" (bestehende Bezeichnung `:74` beibehalten, nicht auf
  „Schema" umbenennen).
- `:102-111` `Space` → `Flex justify="space-between" align="center" gap={16} wrap`; die
  vorhandene `Typography.Title level={3}` (`:103-105`) bleibt, darunter die Kennzahlenzeile.
  Knopf-Label `Neuer Bericht` **unverändert** (gepinnt `:241`).
- `:113-120` `<Table>` → `<Datensicht form="karte" bezeichnung="Lageberichte"
  leerText="Noch keine Lageberichte" …>`.
- `:50-59` Lade-/Fehlerweiche, `:94-101` Breadcrumb, `:122-144` Modal: **unverändert**.

**Kein neues `<Empty>`** (E1) — `leerText` trägt den Text, den `:119` heute als
`locale.emptyText` liefert. Der Test `:246` bleibt damit wörtlich gültig.

---

## 3. Je Datei: Änderung, brechende Tests, Anpassung

| Datei | Änderung | brechende Tests → Anpassung |
|---|---|---|
| `frontend/src/auftraege/BefehlListe.tsx` (79 Z.) | `:1,3,5` Imports, `:33-44` → `spaltenFuer`-Register, `:48-50` Kopfzeile, `:51-58` → `<Datensicht form="karte">`. Query `:20-23`, Mutation `:27-31`, Modal `:59-76`, `einsatzKeys.befehle` **unberührt** | — |
| `frontend/src/auftraege/BefehlListe.test.tsx` (45 Z.) | Fixture `:25-30` → Kette; T1/T2/T3 + Kopfzeilentest neu | **`:36-37`** `findByRole('link', …)` Singular **wirft** an der Kettenfixture → `getAllByRole` + `href`-Array (der Beweis der v-Nummer). **`:38`** `getByText('Befehl LAD (vereinfacht)')` verlangt ein Element mit **exakt** diesem Gesamttext; ob `Datensicht` das Sekundärfeld mit `etikett`-Präfix oder in einem zweiten Knoten rendert, gehört AP1 → ersetzt durch `expect(sicht).toHaveTextContent('Befehl LAD (vereinfacht)')` auf der `region`. **`:41-44`** unverändert grün (Knopf-Label bleibt) |
| `frontend/src/pages/LageberichtePage.tsx` (147 Z.) | wie Schritt 5 | — |
| `frontend/src/pages/LageberichtePage.test.tsx` (248 Z.) | Kettenfixture + T1/T2/T3-Spiegel; Zeitstand-Assertion im Detail-`describe` | **`:236`** `findByText('Lage 10:00')` → an der Kettenfixture **zwei** Treffer → `findAllByText` bzw. Assertion über die `region`. **`:241`**, **`:246`** bleiben grün. Die zehn `LageberichtDetailPage`-Tests `:80-231` bleiben unberührt (`getAllByText('—')` `:226` misst leere Abschnitte, nicht den Zeitstand) |
| `frontend/src/kommunikation/phase.ts` (77 Z.) | `BEFEHL_STATUS` + `LAGEBERICHT_STATUS` nach `:69` | — (additiv) |
| `frontend/src/kommunikation/phase.test.ts` (73 Z.) | zwei `it` im `describe` `:30-58` | — |
| `frontend/src/kommunikation/index.ts` (25 Z.) | zwei Namen in `:5-15` | — |
| `frontend/src/pages/BefehlDetailPage.tsx` | `:190` → `<ZeitAnzeige>` | — (keine Assertion im Bestand) |
| `frontend/src/pages/LageberichtDetailPage.tsx` | `:191` → `<ZeitAnzeige>` | — |
| `frontend/src/pages/BefehlDetailPage.test.tsx` | eine Zeitstand-Assertion (gerechnet) | — |
| `frontend/src/pages/AuftraegePage.test.tsx` | **keine Änderung** | `:243-254` bleibt grün: initiales Knopf-Label unverändert, kein Toggle gespiegelt. Alle `getByPlaceholderText`-Aufrufe (`:90,113,115,149`) tragen spezifische Literale, keiner davon `Titel oder Schema`; es gibt kein unqualifiziertes `getByRole('textbox')`. antd `Tabs` rendert den Befehle-Tab ohne `forceRender` erst beim Wechsel → das neue Suchfeld ist während der Aufträge-Tests nicht im Baum |
| `frontend/src/components/katalogTabelle.guard.test.ts` | **keine Änderung — ausdrücklich** | bleibt bei `toHaveLength(13)` (`:101`). §9.10 der API-Festlegung listet `LageberichtePage` als KatalogTabelle-Tausch; das ist **veraltet** gegen E5 + §8 (dort steht sie im `form="karte"`-Inventar). Nach dem Umbau hat die Datei kein `<Table` mehr und braucht kein `scroll` |
| `frontend/src/components/datensicht.guard.test.ts` | **AP1s Datei — nicht hineinschreiben** | Vorprüfen, ob `auftraege/BefehlListe.tsx` und `pages/LageberichtePage.tsx` im `form="karte"`-Inventar stehen (§8 sagt ja). Fehlen sie, an AP1s Eigentümer melden statt selbst zu ergänzen. Erwartungen, die Bündel III erfüllen muss: `<Datensicht` ≥ 1, `<Table` 0, `spaltenFuer` ≥ 1, `form="karte"` ≥ 1, `scroll={{`/`sorter:`/`filters:`/`responsive:` je 0 |
| **nicht angelegt:** `frontend/src/auftraege/BefehlKarte.tsx` | — | Auflösung eines Widerspruchs im Auftragstext: eine eigene Kartenkomponente bräuchte `karte = { art: 'eigen', render }`, und §8 pinnt `KARTEN_EIGENBAU` am Tag 1 auf `toHaveLength(0)`. Die „Befehl-Karte" **ist** der `Kartenplan`; `AuftragKarte.tsx`s Struktur bildet sich 1:1 auf die Slots ab (Kopfleiste `:112-129` → `status`, Titelzeile `:131` → `titel`, Metazeile `:134-136` → `sekundaer`) |

**Zwei Dateien werden bewusst NICHT angefasst:** `frontend/src/components/Liste.tsx` (der
Leerzustands-Pfad `:83-94` reicht; die `<Empty>`-Ablösung ist B3/LFH-331) und
`frontend/src/kommunikation/StatusBadge.tsx` (`:8-14` genügt unverändert).

---

## 4. Die Fallen — insbesondere Tests, die grün bleiben und nichts belegen

1. **`findByRole` (Singular) an der Fortschreibungskette wirft.** Nicht „bleibt grün", sondern
   bricht aus dem falschen Grund: `BefehlListe.test.tsx:36` und
   `LageberichtePage.test.tsx:236` scheitern an *zwei* Treffern, nicht am Umbau. Wer die
   Kettenfixture ohne `getAllBy*` einführt, debuggt den falschen Fehler.
2. **Die `href`-Assertion allein ist blind.** `BefehlListe.test.tsx:36-37` ist mit der **alten**
   Tabelle grün (`:34-36` liefert denselben Link mit demselben Namen). Ein Test, der nur sie
   enthält, belegt den Umbau nicht. Beweiskräftig sind `region`-Rolle, Gruppenköpfe und das
   `v`-Präfix.
3. **`standardSortierung: 'ab'` spiegelt die Server-Ordnung — ein Sortiertest kann nicht
   fehlschlagen.** `src/befehl/repo.rs:99` liefert `ORDER BY l.zeitstand DESC, l.id DESC`; ein
   Test „erste Karte ist die neueste" ist auch bei völlig defekter Sortierung grün. Wer sie
   prüfen will, braucht eine **absichtlich unsortierte** Fixture oder einen Klick auf `auf`.
   (Deshalb steht in T1 keine Sortier-, sondern eine **Gruppenreihenfolge**-Assertion — die
   fixture-unabhängig aus `gruppen.reihenfolge` kommt.)
4. **Zeitzone ist im Testlauf nicht gepinnt.** `frontend/vite.config.ts:82-87` (`test:`) setzt
   kein `TZ`, `src/test/setup.ts` auch nicht, `DEFAULT_KONVENTIONEN.zeitzone` ist `null`
   (`anzeige/format.ts:29-34`) → lokale Maschinenzeit. `zeitstand: '2026-06-02 10:00:00'` wird
   in Europe/Berlin zu `021200JUN2026`, auf einer UTC-Maschine zu `021000JUN2026`. **Jede
   Literal-Erwartung auf eine formatierte Zeit ist maschinenabhängig** — im Test rechnen
   (`taktischeDtgVoll(...)`).
5. **`getByText(/Entwürfe \(1\)/)` ist die falsche Form.** Das Trennzeichen des Gruppenkopfs
   gehört AP1 (§5: `„verfügbar · 7"`), der Auftrag sagt `„Entwürfe (n)"`. Zusätzlich prüft
   `getByText` mit Regex **pro Element** und findet nichts, wenn Etikett und Zähler in zwei
   `span` liegen. `toHaveTextContent` auf der `region` mit `[·(]` ist gegen beide Bauformen
   stabil.
6. **Der Leerzustands-Test belegt heute nichts.** `.ant-empty` fehlt sowohl bei antds
   `locale.emptyText` als auch bei `Liste`s `emptyText` — beide Assertions in T3 sind vor **und**
   nach dem Umbau grün. Er ist Wächter für E1, kein Treiber; wer ihn als Nachweis führt, führt
   eine Attrappe. Der echte Riss entstünde erst, wenn `leerText` **weggelassen** wird: dann
   greift `Liste.tsx:92` und rendert ein `<Empty>` — genau das fängt T3.
7. **Eine Map in `theme/statusFarben.ts` bricht `theme/statusFarben.test.ts:32` sofort.** Das
   Inventar wird aus dem Modul abgeleitet (`:22-29`) und gegen neun Namen verglichen (`:33-43`).
   Kein Grund, es zu „reparieren" — es ist der Grund, warum die Deskriptoren in `phase.ts`
   liegen.
8. **`spaltenFuer` ist umgehbar, und tsc merkt es nicht.** Wird das Register als
   `readonly DatensichtSpalte<BefehlAnzeige>[]` **annotiert** statt durch `spaltenFuer<T>()`
   geführt, weitet `K` auf `string`; danach nimmt `sekundaer: ['fassng']` jeden Tippfehler
   **ohne Fehler** an, alle Tests bleiben grün, und das Sekundärfeld fehlt still. Zwei Netze:
   `tsc --noEmit` bei intaktem `const K` und `pruefeKartenplan` als DEV-`console.warn` (§2).
   Der Guard verlangt die Marke `spaltenFuer` je Konsumentendatei — deshalb bleibt das Register
   **in** `BefehlListe.tsx`/`LageberichtePage.tsx` und wandert nicht in eine
   `befehlSpalten.tsx` (die stünde in keinem Inventar).
9. **`<Link>` im Spalten-`render` bei gesetztem `titel.ziel` = verschachtelte Links.** Der
   heutige `Link` (`BefehlListe.tsx:35`, `LageberichtePage.tsx:70`) muss **verschwinden**, nicht
   umziehen. Bleibt er stehen, ist der Accessible Name des äußeren Links weiter `Befehl A` und
   `T1` bleibt **grün** — der Fehler ist nur im DOM sichtbar. Prüfbar über
   `expect(link.querySelector('a')).toBeNull()`; diese Assertion gehört in T1.
10. **Kennzahlenzeile vs. Gruppenzähler divergieren bei aktiver Suche.** Die Kopfzeile zählt den
    **Bestand** (wie `AuftraegeListe.tsx:145`), die Gruppenköpfe das **Angezeigte**. Gewollt,
    aber verwirrend — gehört als Codekommentar an die Kennzahlenzeile, sonst „korrigiert" es
    jemand in die falsche Richtung.
11. **`LageberichtePage.test.tsx` trägt zehn `LageberichtDetailPage`-Tests** (`:80-231`) im
    selben File. Eine Änderung an `setup()`/den Fixtures dort trifft sie mit; `bericht` (`:27-33`)
    wird von `setupDetail` über `lagebericht7Abschnitte` (`:51-62`) weiterverwendet. Die
    Kettenfixture deshalb **additiv** neben `bericht` anlegen, nicht `bericht` umbauen.
12. **`BefehlListe.test.tsx` rendert ohne `ConfigProvider`** (rohes `render` `:13-21` statt
    `renderMitProviders`). Für `form="karte"` unschädlich — `theme.useToken()` (`Liste.tsx:65`,
    `StatusTag.tsx:36`) fällt auf antds Default zurück, `useAnzeigeKonventionen` wirft ohne
    Provider nicht (`AnzeigeKonventionenContext.tsx:7-8`, `:43-45`). Ein **Zweigtest** (Tabelle
    vs. Karte) wäre hier aber nicht erreichbar; er ist auch nicht nötig, weil `form="karte"`
    breitenunabhängig ist. Nicht auf `renderMitProviders` migrieren: das zöge `AuthProvider` +
    MSW (`onUnhandledRequest: 'error'`, `setup.ts:94`) in einen Test, der `../api/befehle`
    modulweit mockt.
13. **Kein Grep-Gate mit Marke im eigenen Prosatext.** Kommt für dieses Bündel eine Zählung
    hinzu, gilt die Regel aus §8: verbotene Marken (`<Table`, `scroll={{`, `size="small"`) in
    Kommentaren **umschreiben**, nie zitieren. Der Kommentar zur Karten-Ausnahme in
    `Datensicht.tsx` ist AP1s Sache; die zwei Konsumentendateien dürfen die Marken nirgends
    ausschreiben.

---

## 5. Verifikation — exakte Kommandos

`pnpm` läuft über mise (`scripts/check-all.sh:37`: `PNPM="mise exec pnpm@11.10.0 -- pnpm"`), Pfade
absolut. `rtk` maskiert Exit-Codes → Gates über `rtk proxy` oder direkt aufrufen.

```bash
FE=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive/frontend

# (1) TRAGENDES GATE — nur tsc sieht ein aufgeweitetes `const K` und einen Slot-Tippfehler.
mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec tsc --noEmit

# (2) Die berührten Suiten, ohne Datei-Parallelität (wie check-all.sh:59)
mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run --no-file-parallelism \
  src/auftraege/BefehlListe.test.tsx \
  src/pages/LageberichtePage.test.tsx \
  src/pages/AuftraegePage.test.tsx \
  src/pages/BefehlDetailPage.test.tsx \
  src/pages/LageberichtDetailPage.test.tsx \
  src/kommunikation/phase.test.ts

# (3) Guards: der neue muss grün werden, der alte darf sich NICHT bewegen
mise exec pnpm@11.10.0 -- pnpm -C "$FE" exec vitest run --no-file-parallelism \
  src/components/datensicht.guard.test.ts \
  src/components/katalogTabelle.guard.test.ts \
  src/components/useViewport.guard.test.ts \
  src/theme/statusFarben.test.ts

# (4) Lint mit --max-warnings 0 (package.json:14)
mise exec pnpm@11.10.0 -- pnpm -C "$FE" lint

# (5) Handprüfungen der Zusicherungen dieses Bündels
grep -c '<Table' "$FE"/src/auftraege/BefehlListe.tsx "$FE"/src/pages/LageberichtePage.tsx   # je 0
grep -c 'spaltenFuer\|form="karte"' "$FE"/src/auftraege/BefehlListe.tsx                     # >= 2
grep -rn '<Empty' --include='*.tsx' "$FE"/src/auftraege "$FE"/src/pages/LageberichtePage.tsx  # 0
grep -rn 'size="small"' "$FE"/src/auftraege/BefehlListe.tsx "$FE"/src/pages/LageberichtePage.tsx  # 0
grep -n "toHaveLength(13)" "$FE"/src/components/katalogTabelle.guard.test.ts                # unverändert

# (6) Volles Gate vor dem Merge
/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive/scripts/check-all.sh
```

Kein Rust-Anteil: `src/befehl/` und `src/lagebericht/` werden nicht angefasst,
`scripts/check-typ-codegen.sh` ist ohne Backend-Typänderung ein reiner Drift-Nachweis (läuft in
(6) mit). Kein `| tail` um eines dieser Kommandos.

---

## 6. Was dieses Bündel NICHT liefert

1. **Kein `frontend/src/auftraege/BefehlKarte.tsx`** — die Kartenform gehört `Datensicht`
   (`art: 'plan'`); eine eigene Komponente bräuchte `art: 'eigen'`, das §8 am Tag 1 auf
   `toHaveLength(0)` pinnt. Ein Widerspruch im Auftragstext, hier aufgelöst.
2. **Keinen Tabellenzweig, keinen Spaltenschalter, keine fixierte Kopfzeile** für diese zwei
   Flächen. `form="karte"` heißt Karten auf **jeder** Breite; Prüflisten-Zeilen 13 und 14 sind
   für sie „nicht anwendbar". Der Spaltenschalter mit Zähler (Z14) bleibt bei
   `PersonalPage`/`FahrzeugePage` (Bündel AP3) — dort sitzen die 9 bzw. 8 Spalten.
3. **Keine Erweiterung von `frontend/e2e/gate1-ueberlauf.spec.ts`.** Die Datei hat einen
   Eigentümer (AP8, Kritik §6); Bündel III schreibt nicht hinein. **Handover-Anker, ohne neues
   `data-testid`:** `page.getByRole('region', { name: 'Befehle' })` bzw. `{ name: 'Lageberichte' }`
   — steht auf allen drei Prüfbreiten, weil `form="karte"` breitenunabhängig ist. Damit ist der
   Überlauf der Befehlsseite auf 390 px heute ungemessen und bleibt es bis AP8.
4. **Keine `datensicht-schmal.spec.ts`-Zeilen** (Trefflächen von Titel-Link/Aktionsknopf,
   Z13-Tabulatordurchlauf). Das sind AP1/AP8-Nachweise am Primitiv; Bündel III liefert nur
   Konsumenten.
5. **Keinen `?befehl=`/`?lagebericht=`-Deeplink, keine Highlight-/Scroll-Mechanik** — es gibt
   keinen Schlüssel dafür in `frontend/src/routing/deeplinks.ts` (`:56-58`, `:146-148`). →
   eigenes Ticket, gemeinsam mit dem Sortier-/Filter-Deeplink aus §9.4.
6. **Keinen persistenten Such-/Filter-/Sortierzustand.** §4 der Festlegung: nichts persistiert,
   kein `localStorage`, kein Query-Param. Ein Tabwechsel in `AuftraegePage` (kein `forceRender`,
   `AuftraegePage.tsx:37-51`) **verwirft** den Suchbegriff — bewusst, kein Fehler. → §9.5.
7. **Keine Zeilenaktion im Kartenzweig.** Freigeben/Fortschreiben/Drucken bleiben auf
   `pages/BefehlDetailPage.tsx:167-186` bzw. der Lagebericht-Detailseite. Der Kartenplan hat
   keinen `aktion`-Slot besetzt; „genau eine Primäraktion" ist der Titel-Link.
8. **Kein `size="large"` am Primary-Knopf**, also keine pixelgleiche Angleichung an
   `AuftraegeListe.tsx:151`. → B5 (LFH-333) entfernt es dort.
9. **Keine Ablösung der `<Empty>`-Knoten der vier Vorbild-Listen**
   (`AuftragListe.tsx:26`, `MeldungListe.tsx:37`, `ErinnerungListe.tsx:19`,
   `NachforderungListe.tsx:19`). Bündel III legt keinen neuen an (E1), räumt die bestehenden
   aber nicht ab — das ist B3 (LFH-331), dessen Akzeptanzkriterium `grep "<Empty" = 0` lautet.
10. **Keine Migration der vier bestehenden Kommunikations-Module auf den A2-Statusfarb-Vertrag.**
    `BEFEHL_STATUS`/`LAGEBERICHT_STATUS` bleiben auf der `PHASE_META`-Preset-Achse
    (`phase.ts:12-17`), die `theme/statusFarben.ts:44-49` ausdrücklich außerhalb des Vertrags
    führt. → Folgeticket „`kommunikation/phase.ts` in den A2-Vertrag", zusammen mit den
    modul-lokalen Farbmaps aus §9.7 (`personen/personMeta.ts`, `TierePage`, `MaterialPage`).
11. **Keine Listenform-Regel in `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`.**
    Kritik-Lücke A ist unbesetzt; die CLAUDE.md-Hälfte steht seit A1 in `CLAUDE.md:57-59`. Gehört
    in LFH-330, aber nicht in dieses Bündel.
12. **Keine Prüfliste Einsatztauglichkeit** für die zwei Seiten. Bündel III liefert die Verdikte
    als Zulieferung: 1 erfüllt (Titel-Link über `controlHeight`, Nachweis bei AP1) · 2 offen → B5 ·
    3 offen → B3 · 4 **nicht anwendbar** (keine kritische Aktion in der Liste) · 5 erfüllt
    (`StatusBadge` nutzt antd-Presets, dark-safe) · 6 erfüllt (Tag-Text „Entwurf"/„Freigegeben" ist
    der zweite Kanal) · 7 erfüllt (kein Rot im Spiel: `default`/`success`, `phase.ts:13/15`) ·
    8 nicht anwendbar → Folge-Task · 9–11 nicht anwendbar · 12 erfüllt über die Zeilenschleuse des
    Primitivs · **13/14 nicht anwendbar** (kein Tabellenzweig) · 15 nicht anwendbar. Das Ausfüllen
    des Dokuments gehört zum Abschluss von LFH-330.