# Bündel II — UHS-Bewegungen

# Umsetzungsplan — LFH-330 · B2, Bündel II: UHS-Bewegungen

Alle Pfade absolut ab
`/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive/`
(im Folgenden `$WT`). Alle Zeilenangaben unten sind **am Code nachgeschlagen**, nicht aus bericht-5 übernommen.

---

## 0. Vorbedingungen — drei Punkte, die vor Schritt 1 geklärt sein müssen

`$WT/frontend/src/components/Datensicht.tsx` **existiert nicht** (`ls` leer). Dieses Bündel ist reiner Konsument und kann erst grün werden, wenn Bündel I das Primitiv geliefert hat. Drei Befunde an der festgelegten API, die dieses Bündel blockieren bzw. seine Umsetzung bestimmen:

### V1 — Blätterung fehlt in `DatensichtProps` (BLOCKER, nicht Komfort)

`DatensichtProps` ist eine **geschlossene** Prop-Liste; kein `pagination`, kein `blaetterung`, und keine Durchreiche fremder `TableProps`. Damit ist die Bündel-Vorgabe „Blätterung 50" nicht ausdrückbar — und schlimmer: der Tabellenzweig bekommt dann **antds Default-Blätterung mit `pageSize: 10`**, während `$WT/frontend/src/pages/uhs/BewegungenTab.tsx:79` heute `pagination={false}` setzt. Ohne Entscheidung ist die Migration also eine stille Verhaltensänderung für *jeden* Konsumenten, nicht nur für diesen.

Verlangte Amendment-Signatur an Bündel I:

```ts
/**
 * Blätterung. `false` = alles auf einer Seite (Default — heutiges Verhalten aller
 * Bestandstabellen). Gilt für BEIDE Zweige, sonst bricht Zusicherung 2 („EINE Menge"):
 * Tabellenzweig `pagination={{ pageSize, showSizeChanger: false }}`, Kartenzweig
 * dieselbe Seitengröße als Schnitt auf `effektiveDaten` plus antd-`<Pagination>` als
 * Geschwister UNTER der `Liste` (`components/Liste.tsx` kennt keine Blätterung).
 */
blaetterung?: number | false;
```

Fällt das Amendment aus: Bündel I muss im Tabellenzweig **mindestens** `pagination={false}` setzen, und dieses Bündel liefert ohne Blätterung. Das ist gegenüber heute keine Regression (5 Spalten, Protokoll je UHS) und in §5 als Nicht-Lieferung zu vermerken.

### V2 — `TitelBezug.ziel` kann „kein Ziel" nicht ausdrücken; §6 der API-Festlegung ist an dieser Stelle defekt

`ziel?: (zeile: T) => string` — Rückgabe ist zwingend ein String. Das §6-Beispiel für BewegungenTab hebt den `<Link>` aus dem `render` der Person-Spalte in `titel.ziel`. Gemessen am Code bricht das:

`$WT/frontend/src/pages/uhs/BewegungenTab.tsx:37-46` verlinkt **bedingt** — `if (!person) return '#${personId}'`. Der Fallback ist absichtlich unverlinkt, weil es kein garantiertes Ziel gibt (Kommentar `:39-40`), und genau darauf steht ein gepinnter LFH-25-Test: `$WT/frontend/src/pages/uhs/BewegungenTab.test.tsx:33` `expect(screen.queryByRole('link')).not.toBeInTheDocument()`. Mit `titel.ziel` würde jede Zeile verlinkt, auch die auf eine nicht existierende Person.

**Basislinie dieses Bündels: `titel.ziel` wird NICHT gesetzt.** Der bedingte `<Link>` bleibt im `render` der `person_id`-Spalte, und `zelle()` trägt ihn in die Kartentitelzeile — das Tastaturziel existiert also für auflösbare Zeilen in beiden Zweigen, für `#10`-Zeilen gibt es keins (korrekt: kein Ziel). Das ist mit dem Wortlaut der API vereinbar („trägt `ziel` einen Wert, darf das `render` … KEIN `<a>` erzeugen") und braucht null Koordination.

Alternative, **nur** falls Bündel I noch offen ist: `ziel?: (zeile: T) => string | undefined` (undefined = kein Link, `render`-Ausgabe unverändert durchgereicht). Dann wandert der Link nach `ziel` und der `render` liefert nur noch den Text. Sauberer, aber koordinationspflichtig.

### V3 — Die Schwelle des Spaltenschalters ist in der API nicht benannt

§6 behauptet für BewegungenTab „Der Spaltenschalter erscheint hier nicht (5 Spalten, unter der Schwelle)", aber es gibt keine exportierte Konstante und keinen Prop dafür (`MAX_SEKUNDAER` und `TIEFE_DECKEL` sind die einzigen Konstanten). Dieses Bündel kann die Aussage nur negativ prüfen (`queryByRole('button', { name: /Spalten/ })` ist `null`) und verlangt von Bündel I eine benannte, exportierte Schwelle (Vorschlag `SCHALTER_SCHWELLE = 8`). Ohne Schwelle ist der Test in Schritt 5 rot und **erzwingt** sie — das ist der bessere Ausgang.

---

## 1. Reihenfolge der Schritte — erst der Test, dann der Code

Die Reihenfolge ist so gewählt, dass **kein Schritt geboren-grün** ist. Kritischer Punkt: `karte` ist ein Pflicht-Prop, der Kartenzweig existiert also ab der ersten Codezeile. Deshalb steht der Schmal-Zweig-Test **vorn** — käme er später, wäre er beim Eintreffen grün und würde nichts beweisen.

Der Einstieg ist bewusst **kein** Import-Test auf `Datensicht`: ein Test, der an `Cannot find module '../../components/Datensicht'` scheitert, ist durch eine leere Datei trivial „reparierbar" und beweist nichts. Alle Tests unten laufen gegen `BewegungenTab` und sind gegen den **heutigen** Code rot.

---

### Schritt 1 — Zweigumschaltung (RED zuerst)

**Test** in `$WT/frontend/src/pages/uhs/BewegungenTab.test.tsx`, neuer `describe('BewegungenTab · Zweige (LFH-330)')`:

```tsx
it('unter md steht die Kartenform im Baum, nicht die Tabelle', async () => {
  setzeViewportBreite(390);                      // VOR dem Render — sonst Attrappe
  server.use(http.get('/api/einsaetze/1/personen', () =>
    HttpResponse.json([{ id: 10, registrier_nr: 7, name: 'Müller' }])));
  renderMitProviders(<BewegungenTab uhs={uhs} />, { route: '/einsaetze/1/unfallhilfsstellen/3' });
  expect(await screen.findByRole('link', { name: /Müller/ })).toBeInTheDocument();
  expect(screen.queryAllByRole('columnheader')).toHaveLength(0);
  expect(screen.getByRole('list')).toBeInTheDocument();      // Liste rendert <ul>
});

it('am Fükw-Schirm steht die Tabelle im Baum (Gegenprobe)', async () => {
  // 1024 = VIEWPORT_STANDARD, bewusst NICHT gesetzt, um den Default zu belegen
  …
  expect(await screen.findByRole('link', { name: /Müller/ })).toBeInTheDocument();
  expect(screen.getAllByRole('columnheader').length).toBeGreaterThanOrEqual(5);
});
```

**Beweist**: die Umschaltung existiert und **genau ein** Zweig steht im Baum. Die Gegenprobe ist nicht Zierde — ohne sie erfüllt „0 columnheader" auch eine Komponente, die gar nichts rendert.

**Warum rot**: heute rendert `BewegungenTab.tsx:75-82` in **jeder** Breite ein `<Table>` → 5 `columnheader` auch bei 390. Rot bei 390, grün in der Gegenprobe → beide Hälften unterscheiden.

**Warum nicht trivial grün**: der Person-Link muss in beiden Zweigen erhalten bleiben; `queryAllByRole('columnheader') === 0` allein wäre durch Weglassen erfüllbar, die Link-Assertion in derselben Zusicherung verhindert das.

**Code (Minimalgrün)**: Migration auf `Datensicht` mit den 5 Spalten (Schlüssel/Titel/Render unverändert), `zeilenSchluessel="id"`, `ladend`, `leerText`, `karte`-Plan. **Noch kein** `suche`, `filter`, `sortWert`, `standardSortierung`, `blaetterung`.

---

### Schritt 2 — Art-Filter (RED)

**Test**:

```tsx
it('filtert die Bewegungsarten über die Werkzeugzeile', async () => {
  // Fixture mit drei Arten (eintritt/wechsel/austritt), drei Personen
  … Filter auf „Austritt" setzen …
  expect(screen.getByText('Austritt')).toBeInTheDocument();
  expect(screen.queryByText('Eintritt')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Müller/ })).not.toBeInTheDocument();
});
```

**Beweist**: der Filter wirkt auf die **Zeilenmenge**, nicht nur auf ein Bedienelement. Die zweite Assertion (Person der ausgefilterten Zeile verschwindet) ist die tragende — ein Filter, der nur den `StatusTag`-Text ändert, kommt daran nicht vorbei.

**Warum rot**: es gibt heute **im ganzen Frontend** kein `filters:`/`onFilter` (gemessen; die einzigen „filter"-Treffer sind `optionFilterProp` in `components/Select.tsx`). Nach Schritt 1 existiert kein Filter-Bedienelement.

**Code**: `filter: { werte: ART_WERTE, trifft: (b, w) => b.art === w }` an der `art`-Spalte, mit

```tsx
const ART_WERTE = (Object.keys(belegungsArt) as BelegungsArt[]).map((a) => ({
  text: belegungsArt[a].label,
  value: a,
}));
```

Muster aus `$WT/frontend/src/etb/EtbFilterleiste.tsx:14-17` (`TYP_OPTIONEN` aus `etbTyp`). **Keine handgetippten Labels** — eine vierte `BelegungsArt` erscheint dann von selbst, und `$WT/frontend/src/theme/statusFarben.ts:151-155` bleibt unangetastet (A2-gepinnt durch `statusFarben.test.ts:31-43`).

---

### Schritt 3 — Sortierung (RED)

**Test** mit **absichtlich verdrehter** Fixture (siehe Falle F4):

```tsx
const uhsDreiZeilen = { …, belegungen: [
  { id: 2, zeitpunkt_at: '2026-06-23 09:00:00', art: 'wechsel',  … },  // Mitte
  { id: 3, zeitpunkt_at: '2026-06-23 11:00:00', art: 'austritt', … },  // neueste
  { id: 1, zeitpunkt_at: '2026-06-23 08:00:00', art: 'eintritt',  … },  // älteste
] } as unknown as UhsDetail;

it('zeigt die neueste Bewegung zuerst, auch wenn die Quelle unsortiert liefert', …);
it('ein Klick auf die Zeitspalte dreht auf älteste zuerst', …);
```

Ablesen über die Reihenfolge der `tr.ant-table-row` (nicht `tr` — `sticky` schiebt eine verborgene Messzeile als erste Körperzeile ein, dokumentiert in `$WT/frontend/src/components/KatalogTabelle.tsx:15-17`).

**Beweist**: die Reihenfolge kommt aus dem Primitiv, nicht aus dem Server.

**Warum rot**: nach Schritt 2 gibt es kein `sortWert` und keine `standardSortierung` → die Reihenfolge ist die Lieferreihenfolge, also `2,3,1`. Erwartet wird `3,2,1`.

**Code**: `sortWert: (b) => b.zeitpunkt_at` an der Zeitspalte (lexikographischer Vergleich von `'2026-06-23 10:00:00'` ist ordnungstreu), `standardSortierung={{ spalte: 'zeitpunkt_at', richtung: 'ab' }}`.

---

### Schritt 4 — Suche (RED)

**Test**:

```tsx
it('sucht über die angezeigte Personenkennung', async () => {
  … 'R-007' eintippen … → Müller-Zeile bleibt, die anderen zwei sind weg
});
it('sucht NICHT in der Notiz — der Suchraum ist festgelegt, nicht zufällig', async () => {
  … Fixture mit notiz: 'Transportziel Klinik' … 'Klinik' eintippen → 0 Datenzeilen,
  Leertext „Keine Bewegungen erfasst" sichtbar
});
it('findet eine nicht aufgelöste Person unter ihrem angezeigten #id', …);
```

**Beweist**: Suchraum **und** dessen Grenze. Der Negativtest ist der wertvollere: ohne ihn wäre eine „alles durchsuchen"-Implementierung ebenso grün, und der Bündel-Auftrag „Suche auf Person/Registriernummer" wäre unbelegt.

**Warum rot**: nach Schritt 3 gibt es kein Suchfeld.

**Code**: `suche={{ platzhalter: 'Person oder R-Nr.' }}` und `suchText` **nur** an der `person_id`-Spalte:

```tsx
suchText: (b) => personEtikett(b.person_id, personenById),
```

wobei `personEtikett` genau den angezeigten Text liefert (`R-007 · Müller` / `R-007` / `#10`) und aus dem heutigen `render` (`:38-45`) herausgezogen wird, damit `render` und `suchText` **eine** Quelle haben. **Festgelegtes Verhalten** (nicht Zufall): gesucht wird, was angezeigt wird. Folgen, beide getestet: `Klinik` findet nichts; `#10`-Zeilen sind nur über `#10`/`10` findbar; während `personenQuery.isLoading` greift kein Namenstreffer (das Primitiv zeigt dann `ladend`).

---

### Schritt 5 — Werkzeugzeile ohne Spaltenschalter (RED oder Pin, siehe V3)

**Test**:

```tsx
it('trägt keinen Spaltenschalter — fünf Spalten liegen unter der Schwelle', () => {
  expect(screen.queryByRole('button', { name: /Spalten/ })).not.toBeInTheDocument();
});
it('die Werkzeugzeile steht auch ohne Daten im Baum', () => {
  // leere belegungen → Suchfeld ist da, Leertext ist da, Layout springt beim
  // Eintreffen der ersten Zeile nicht (Zusicherung 5 / Lehre Sticky-Reserve B1)
});
```

**Warum rot**: hängt an V3. Rendert Bündel I den Schalter unbedingt, ist der erste Test rot und **erzwingt** die Schwelle. Ist die Schwelle schon da, ist er ein Pin — dann als solcher deklarieren, nicht als TDD-Schritt verkaufen. Der zweite Test ist gegen heute rot (heute existiert keine Werkzeugzeile).

**Code**: keiner in diesem Bündel, wenn die Schwelle existiert; sonst Rückgabe an Bündel I.

---

### Schritt 6 — Die zwei gepinnten LFH-25-Tests anpassen (nicht löschen)

Beide bleiben nach der Migration **grün** (Nachweis unten). Angepasst wird nur die Kopplung von Test 2:

`$WT/frontend/src/pages/uhs/BewegungenTab.test.tsx:33` — `screen.queryByRole('link')` ist unskopiert und koppelt damit an alles, was künftig in der immer gerenderten Werkzeugzeile landet. Verengen auf die Personen-Zelle:

```tsx
const personZelle = screen.getByText('#10');
expect(personZelle.closest('a')).toBeNull();
expect(screen.queryByRole('link', { name: /R-\d{3}/ })).not.toBeInTheDocument();
```

Test 1 (`:25-26`) bleibt wortgleich: `findByRole('link', { name: /Müller/ })` + `href === '/einsaetze/1/personen/10'`. Der accessible name der Zelle ist `R-007 · Müller`, das Regex trifft; `personDetailPfad` (`$WT/frontend/src/routing/deeplinks.ts:60-62`) bleibt die Quelle.

Die Fixture `:9-15` bleibt für diese zwei Tests unverändert (eine Belegung) — die neuen Tests bringen ihre eigene 3-Zeilen-Fixture mit. Zwei Fixtures, weil die eine Aussage „einzelne Zeile, Fallback" und die andere „Ordnung/Filter über mehrere" ist.

`$WT/frontend/src/pages/uhs/UhsDetailPage.test.tsx` bricht **nicht**: `:20` mockt `./BewegungenTab` weg (verifiziert).

---

### Schritt 7 — Guard-Eintrag (Datei gehört Bündel I)

`$WT/frontend/src/components/datensicht.guard.test.ts` wird von Bündel I angelegt. Dieses Bündel liefert den Eintrag als Text, es editiert die Datei nicht selbst (Kollisionsgefahr, vgl. Memory „Subagent-Koordination im Worktree"):

> Ins `form="auto"`-Inventar: `'pages/uhs/BewegungenTab.tsx'`
> Erwartungen dort: `<Datensicht` ≥ 1 · `<Table` = 0 · `spaltenFuer` ≥ 1 · `scroll={{` = 0 · `sorter:` = 0 · `filters:` = 0 · `responsive:` = 0.
> Hinweis für den Guard-Autor: `filter: {` (mit Leerzeichen, Singular) ist die **erlaubte** Form und stolpert nicht über die Verbotsmarke `filters:` — die Muster müssen den Doppelpunkt direkt am `filters` verlangen.

Ersatz-Akzeptanzkriterien nach §9.1 sind mit diesem Bündel **erfüllt**: `suche={{` ≥ 1, `filter: {` ≥ 1, `sortWert:` ≥ 1 in `BewegungenTab.tsx`. Das ursprüngliche Kriterium (`grep -rnE "sorter|filters:|Input.Search"` ≥ 1 je Datei) ist mit dieser API **unerfüllbar** und wird nicht nachgeliefert.

`$WT/frontend/src/components/katalogTabelle.guard.test.ts` bleibt **byte-identisch**: `KATALOGTABELLEN` (`:39-53`) enthält `pages/uhs/BewegungenTab.tsx` nicht, `toHaveLength(13)` (`:101`) bewegt sich nicht, und die drei Primitiv-Pins (`:117-119`) bleiben, weil `Datensicht` kein Scroll-Prop setzt.

---

### Schritt 8 — Browser-Nachweis (neue Datei, gehört diesem Bündel)

`$WT/frontend/e2e/bewegungen-schmal.spec.ts`, `test.use({ viewport: { width: 390, height: 844 } })` (kein Device-Descriptor).

**Aufbau ohne Drag** — das ist der entscheidende Entwurfspunkt. Der Bestandsweg zu einer Belegung ist ein dnd-Drag (`$WT/frontend/e2e/uhs-grundriss-person-scroll.spec.ts:26-59`, `setupBelegterPlatz`), und ein Drag auf 390 px ist unnötig fragil. Es gibt einen API-Weg: `POST /api/einsaetze/{id}/personen/{pid}/uhs-belegung` (`$WT/src/routes/einsatz_uhs.rs:686`, Body `{ art, uhs_id, platz_id, notiz }`, `src/routes/einsatz_uhs.rs:678-684`). Über `page.request.post` (teilt die Session-Cookies) werden drei Belegungen gesetzt: `eintritt` → `wechsel` → `austritt`. Damit liegen alle drei Arten vor, der Art-Filter ist im Browser prüfbar.

Reihenfolge, mit den gemessenen Randbedingungen:
1. Anmelden (Helfer wie `$WT/frontend/e2e/nav-schmal.spec.ts:59`).
2. Einsatz anlegen → `einsatzId` aus der URL.
3. Person per Schnellerfassung anlegen (`/einsaetze/:id/personen`, Knopf `Schnellerfassung`, Label `Name`, Knopf `Erfassen`), `personId` per `page.request.get('/api/einsaetze/:id/personen')`.
4. UHS anlegen, Platz anlegen, **„In Betrieb nehmen"** — Pflicht, nicht Kosmetik: `belegung_repo::eintritt` ruft `pruefe_uhs_aktiv` (`$WT/src/uhs/belegung_repo.rs`, im `eintritt`-Rumpf), ein POST gegen eine `geplant`-UHS scheitert.
5. Drei POSTs, dann `page.goto` auf die UHS-Detailroute und **auf den Reiter „Bewegungen" klicken** — `$WT/frontend/src/pages/uhs/UhsDetailPage.tsx:130-140` nutzt `<Tabs>` ohne `forceRender`, der Reiter ist der **zweite**, sein Panel ist vorher nicht im Baum.

Zusicherungen:
- **Kein `.ant-table` im Bewegungen-Panel** bei 390 — Locator **auf das Panel verengt** (`[role="tabpanel"]`, das die Bewegungen trägt), niemals dokumentweit. Siehe Falle F1.
- Gegenprobe bei `page.setViewportSize({ width: 1366, height: 900 })`: `.ant-table` im Panel = 1.
- Überlauf: `scrollWidth - clientWidth ≤ 1` **am `<section>` der Datensicht**, nicht an `documentElement`. Siehe F1.
- Trefffläche ≥ 48 px (Toleranz 0,5 px, Helfer `haeltTreffflaeche` aus `$WT/frontend/e2e/nav-schmal.spec.ts:24-46` **kopieren**, nicht importieren) für: Personen-Link in der Kartentitelzeile, Suchfeld, Art-Filter-Auslöser. Vor jeder Messung `toHaveCount(1)`.
- **Z13** (Prüflisten-Kriterium 13): ein Tabulatordurchlauf bei 1366 hinter der stehenden Kopfzeile und der `fixed:'left'`-Zeitspalte — der fokussierte Personen-Link darf nicht unter dem Sticky-Kopf oder unter der fixierten Spalte liegen. Neubau ohne Vorbild; `press`/`keyboard` gibt es in `$WT/frontend/e2e/` nur in `command-palette.spec.ts`.

`$WT/frontend/e2e/gate1-ueberlauf.spec.ts` wird **nicht** angefasst: seine Routentabelle (`:153-162`) trägt statische Pfade, die UHS-Detailroute braucht zwei erzeugte IDs. Die drei Routen, die §8 dort nachträgt (Kräfteübersicht, Personal, Befehle), gehören anderen Bündeln.

---

### Schritt 9 — Prüfliste Einsatztauglichkeit

15 Zeilen an die Seite anlegen, je mit Verdikt. Von der Primitiv-Prüfliste in §9 abweichend nur dort, wo dieses Bündel eigene Aussagen hat:
- **1** erfüllt (Nachweis `bewegungen-schmal.spec.ts`).
- **4** *nicht anwendbar* — die Bewegungssicht hat **keine** Primäraktion (`karte.aktion` bleibt ungesetzt): das Protokoll ist read-only, Belegungen entstehen im Grundriss.
- **6/7** erfüllt — die einzige Statusfarbe kommt aus `belegungsArt` über `StatusTag`, `label` ist Pflichtfeld, kein `Tag color=` in dieser Datei.
- **12** erfüllt über `zufluss='sammelbanner'` (Default, ungesetzt gelassen).
- **13** erfüllt, mit dem eigenen Tab-Durchlauf-Nachweis aus Schritt 8.
- **14** erfüllt im Tabellenzweig / nicht anwendbar im Kartenzweig; **Spaltenschalter: nicht anwendbar** (5 Spalten, V3).

---

## 2. Je Datei

### `$WT/frontend/src/pages/uhs/BewegungenTab.tsx` (84 → ca. 110 Zeilen)

| heute | nachher |
|---|---|
| `import { Table } from 'antd'` (`:1`) | `Datensicht`, `spaltenFuer`, Typ `Kartenplan` aus `../../components/Datensicht`; **kein** antd-`Table`-Import |
| `const columns = [ … ]` (`:26-72`), plain Array | `const spalten = useMemo(() => spaltenFuer<UhsBelegung>()([ … ]), [personenById, plaetzeById])` — muss in die Komponente, weil `personenById`/`plaetzeById` aus zwei Quellen kommen |
| `:37-46` Person-`render` mit bedingtem `<Link>` | unverändert, plus `suchText: (b) => personEtikett(b.person_id, personenById)`; die Etikett-Bildung wird in `personEtikett(personId, personenById)` (modul-lokal, nicht exportiert) herausgezogen, damit Anzeige und Suchtext **eine** Quelle sind |
| `:48-55` Art-`render` | unverändert (`StatusTag` + `belegungsArt`), plus `filter: { werte: ART_WERTE, trifft }` |
| `:28-32` Zeit-`render` | unverändert (`ZeitAnzeige format="dtgVoll"`), plus `sortWert` |
| `:56-65` Platz-`render` | unverändert. **Nicht** aufräumen: `platz_id === null` und „gesetzt, aber nicht in `uhs.plaetze`" liefern beide `'Inbox'`. Zwei Fälle, ein Text — bekannter Ist-Zustand, ein eigenes Thema |
| `:74-82` `<Table … pagination={false}>` | `<Datensicht bezeichnung="Bewegungen" spalten={spalten} daten={uhs.belegungen} zeilenSchluessel="id" ladend={personenQuery.isLoading} leerText="Keine Bewegungen erfasst" suche={{ platzhalter: 'Person oder R-Nr.' }} standardSortierung={{ spalte: 'zeitpunkt_at', richtung: 'ab' }} blaetterung={50} karte={…} />` |

Kartenplan:

```tsx
karte={{
  art: 'plan',
  // KEIN `ziel`: der bedingte <Link> bleibt im render der Person-Spalte, weil der
  // #id-Fallback kein garantiertes Ziel hat (LFH-25, gepinnt in BewegungenTab.test.tsx).
  titel: { spalte: 'person_id' },
  status: (b) => belegungsArt[b.art],
  sekundaer: ['zeitpunkt_at', 'platz_id', 'notiz'],
}}
```

Nicht gesetzt, jeweils mit einem Satz Begründung im Code:
- `form` — Default `'auto'`. Das chronologische Protokoll **wird gelesen, nicht verglichen** (A1 Festlegung 2), damit greift die E7-Ausnahme; die schriftliche Fassung steht im Dateikopf von `Datensicht.tsx`, hier nur der Verweis.
- `abBreite` an **keiner** Spalte — bewusst. Eine über `abBreite` verborgene Spalte fließt in denselben Zähler wie die Handauswahl (Zusicherung 3), und weil hier kein Schalter erscheint (V3), wäre dieser Zähler unsichtbar. Ein Zähler, der niemandem angezeigt wird, verfehlt Kriterium 14.
- `art: 'eigen'` — nicht benutzt. `Liste` rendert `<ul>/<li>` mit `colorSplit`-Trennlinien (`$WT/frontend/src/components/Liste.tsx:101-111`), also bereits die Struktur von `$WT/frontend/src/personen/PersonVerlauf.tsx:44-56`. Die im Bündeltext genannte „Zeitleiste" **ist** der Plan-Modus; `KARTEN_EIGENBAU` bleibt leer.
- `zufluss`, `onZeileKlick`, `gruppen`, `baum`, `aufklappzeile`, `zeilenKlasse`, `werkzeuge` — alle ungesetzt.

### `$WT/frontend/src/pages/uhs/BewegungenTab.test.tsx` (35 → ca. 170 Zeilen)

- Bestand `:17-34`: bleibt als `describe('BewegungenTab (LFH-25)')`, Test 2 wie in Schritt 6 verengt. Kein Test wird gelöscht.
- Neu: `describe('BewegungenTab · Datensicht (LFH-330)')` mit den Tests aus Schritten 1–5.
- Neuer Import `setzeViewportBreite` aus `../../test/viewport`. Kein `afterEach`-Rückbau nötig — `setup.ts` ruft `setzeViewportZurueck` global (`$WT/frontend/src/test/viewport.ts:157-163`).
- Zweite Fixture `uhsDreiZeilen` mit **absichtlich verdrehter** Reihenfolge und drei Arten.

### `$WT/frontend/e2e/bewegungen-schmal.spec.ts` — neu, siehe Schritt 8.

### Fremdes Eigentum — nur Text liefern, nicht editieren

- `$WT/frontend/src/components/Datensicht.tsx`, `datensicht.guard.test.ts`, `frontend/e2e/datensicht-schmal.spec.ts`: Bündel I. Amendments V1–V3 und der Guard-Eintrag gehen als Text zurück.
- `$WT/frontend/src/pages/uhs/MaterialTab.tsx`: E4 verlangt den Überlaufschutz (Tausch auf `KatalogTabelle`) für **alle 16** Tabellendateien, und diese ist eine davon — gemessen: `<Table<EinsatzMaterial>` `:90`, `size="small"` `:94`, `pagination={false}` `:95`, kein `scroll`. Der Bündeltext nennt sie **nicht**. Sie ist **kein** `Datensicht`-Konsument (Zuordnungsliste, keine Chronologie, kein Enum-Filter mit Sinn), sondern ein 2-Zeilen-Tausch. Empfehlung: dieses Bündel nimmt sie **nur**, wenn kein anderes Bündel sie beansprucht — und dann zusammen mit dem Eintrag in `KATALOGTABELLEN`, der laut §9.10 einen benannten Eigentümer braucht (drei Pakete wollen dieselbe Liste anfassen; `toHaveLength(13)` in `katalogTabelle.guard.test.ts:101` plus die Prosa in `:8` und `:38` müssen mitwandern). Bis das entschieden ist: **nicht angefasst**, und das `size="small"` in `:74`/`:94` bleibt Bestand für LFH-333/B5. Namenskollision beachten: `$WT/frontend/src/stammdaten/MaterialTab.tsx` ist eine andere Datei, steht schon in `KATALOGTABELLEN:47` und ist migriert — **mit Pfaden arbeiten, nie mit Basenames**.

---

## 3. Die Fallen — am Code gefunden

### F1 — Die Nachbartabelle auf derselben Seite macht jede dokumentweite Messung fremdverschuldet rot

`$WT/frontend/src/pages/uhs/UhsDetailPage.tsx:130-140`: `MaterialTab` ist der **erste** Reiter (Default, sofort gemountet) und trägt ein rohes `<Table>` **ohne** Scrollcontainer. Folgen:
- `expect(page.locator('.ant-table')).toHaveCount(0)` bei 390 px ist **falsch** — MaterialTabs Tabelle steht bereits im DOM. Der Locator muss auf das Bewegungen-Panel verengt werden.
- Jede Überlaufmessung an `documentElement`/`body` für diese Route ist rot **wegen MaterialTab**, nicht wegen dieses Bündels. Genau die Disziplin, die `$WT/frontend/e2e/katalogtabelle-schmal.spec.ts:9-13` festhält („der Spec wäre dann fremdverschuldet rot"): nur bündel-eigenes DOM messen.
- Diese Asymmetrie ist der Grund, warum **Vitest hier sauber und e2e verschmutzt** ist: `BewegungenTab.test.tsx` rendert die Komponente isoliert, dort gibt es kein Fremd-`<Table>`. Ein aus dem Unit-Test übernommenes `queryAllByRole('columnheader') === 0` wäre in Playwright unbrauchbar.

### F2 — Der Reiter ist lazy; ohne Klick prüft der e2e ein leeres Panel

`<Tabs>` ohne `forceRender`; „Bewegungen" ist Reiter 2. Ein `page.goto` auf die Detailroute plus Zusicherung würde gegen ein nicht existierendes Panel laufen und wäre je nach Formulierung **grün** (`toHaveCount(0)` auf einem nicht gemounteten Baum). Der Klick auf den Reiter ist Teil des Nachweises, nicht Vorbereitung. Zusätzlich: `Grundriss` bekommt `height: calc(100vh - 300px)`, `minHeight: 380` (`UhsDetailPage.tsx:126`) — die Reiter liegen bei 390×844 unterhalb des Falzes; Playwrights Auto-Scroll erledigt das, ein `boundingBox` **vor** dem Scroll nicht.

### F3 — `setzeViewportBreite` nach dem Render ist eine Attrappe

`$WT/frontend/src/test/viewport.ts:112-121` schreibt es aus: antds Beobachter ruft seinen Zuhörer beim Abonnieren **synchron** auf und liest nur `matches`; eine nachträglich gesetzte Breite ohne gefeuertes Ereignis erreicht ihn nie. Ohne den Aufruf **vor** `renderMitProviders` läuft jeder „Zeitleiste unter md"-Test bei `VIEWPORT_STANDARD = 1024` (`:31`) und prüft den Tabellenzweig — grün, und belegt das Gegenteil.

### F4 — „Erste Zeile ist die neueste" kann nicht fehlschlagen

`$WT/src/uhs/belegung_repo.rs:204` liefert `ORDER BY zeitpunkt_at DESC, id DESC` (und pinnt „neueste zuerst" bei `:761`), und `dataSource` ist genau diese Antwort (`BewegungenTab.tsx:77`). Ein Test mit einer absteigend sortierten Fixture ist **mit und ohne** `sortWert` grün. Nur zwei Formen unterscheiden: eine **verdrehte** Fixture (deshalb `uhsDreiZeilen` mit `2,3,1`) oder ein Klick auf `auf`. Beide sind in Schritt 3 drin.

### F5 — Der Kartenzweig würde die zwei gepinnten LFH-25-Tests still aushebeln, wenn `titel.ziel` gesetzt wird

Siehe V2. Der Fehler ist besonders unangenehm, weil er **nur** im Schmal-Zweig sichtbar wäre — und die beiden Bestandstests laufen bei 1024 px, also breit. Eine Umsetzung nach §6 wäre grün und lieferte trotzdem einen Link auf `/einsaetze/1/personen/10` für eine Person, die es nicht gibt.

### F6 — `queryByRole('link')` unskopiert ist nach der Migration zufällig grün

Geprüft, damit die Anpassung in Schritt 6 auf Wissen und nicht auf Vorsicht beruht: antds Blätterung rendert ihre Seitenzahlen als `<a rel="nofollow">` **ohne `href`** (`node_modules/.pnpm/@rc-component+pagination@1.4.0…/lib/Pager.js:35-36`) — ein `<a>` ohne `href` hat keine `link`-Rolle, `queryByRole('link')` trifft ihn nicht. Suchfeld, Filter und Schalter sind `textbox`/`combobox`/`button`. Der Test bleibt also grün — aber aus einem Grund, der nichts mit seiner Aussage zu tun hat. Deshalb verengen.

### F7 — Ein Filtertest, der nur den Bedien-Zustand prüft, belegt nichts

`filters`/`onFilter` sind am `DatensichtSpalte`-Typ **amputiert**; gefiltert wird im Primitiv. Ein Test, der nach dem Auswählen von „Austritt" nur prüft, dass das Auswahlfeld „Austritt" anzeigt, ist auch bei einem `trifft`, das immer `true` liefert, grün. Die tragende Assertion ist das **Verschwinden** der Zeilen und ihrer Personen-Links.

### F8 — Neue `size="small"` sind verboten, und **kein** Guard fängt sie

Gemessen: kein `size="small"`-Scanner unter `$WT/frontend/src/**/*.guard.test.ts`. In den `Datensicht`-Guard gehört die Marke für `Datensicht.tsx` (§8), nicht für Konsumenten. Für dieses Bündel heißt das: `Input.Search`, `Select` und `Button` in der Werkzeugzeile gehören dem Primitiv (deshalb der Aktions-**Deskriptor** statt eines `ReactNode`-Slots), und in `BewegungenTab.tsx` darf keins entstehen. Fällt sonst nur im Review auf.

### F9 — Die Zeilenschleuse friert die Reihenfolge, sobald der Fokus in der Sicht liegt

`zufluss='sammelbanner'` (Default) hält Zeilenmenge und -reihenfolge fest, solange der Fokus **innerhalb** des `<section>` liegt. Für dieses Bündel harmlos, weil `daten` aus `props.uhs.belegungen` kommt und die `personen`-Query nur Zellinhalte ändert. Aber: jeder künftige Test, der ins Suchfeld tippt **und danach** `uhs.belegungen` austauscht, sieht eingefrorene Zeilen und liest das als Bug im Filter. Als Kommentar im Test-`describe` festhalten.

### F10 — Die fixierte erste Spalte ist hier der Zeitstempel

`KatalogTabelle` fixiert Spalte 0 unbedingt (`$WT/frontend/src/components/KatalogTabelle.tsx:58-62`), das ist `zeitpunkt_at`. Die DEV-Warnung (`:64-72`) feuert nur bei `dataIndex === 'id'`, hier also nicht. Für ein chronologisches Protokoll ist die DTG-Zeit die menschenlesbare Kennung (Kriterium 14 erfüllt) — aber es ist eine Entscheidung, keine Selbstverständlichkeit, und die Kartentitelzeile trägt bewusst die **andere** Rolle (Person). Rollen sind orthogonal zur Spaltenreihenfolge; wer das „harmonisiert", verliert eine der beiden Aussagen.

---

## 4. Verifikation — exakte Kommandos

`WT=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive`
`PN="mise exec pnpm@11.10.0 -- pnpm -C $WT/frontend"`

Kein `| tail` um ein Gate — das maskiert den Exit-Code. Wo der Exit-Code das Verdikt ist, `rtk proxy` davor, weil der rtk-Hook ihn sonst verschluckt.

```bash
# 1 — die Tests dieses Bündels, während der Arbeit
rtk proxy $PN test -- src/pages/uhs/BewegungenTab.test.tsx

# 2 — Blast-Radius: alles unter pages/uhs + die betroffenen Guards
rtk proxy $PN test -- src/pages/uhs src/components/katalogTabelle.guard.test.ts \
  src/components/datensicht.guard.test.ts src/theme/statusFarben.test.ts

# 3 — Typecheck (fängt `const K`-Widening, Tupelüberlauf bei `sekundaer`, Schlüsseltippfehler)
rtk proxy $PN typecheck

# 4 — Lint, Warnings brechen wie Errors
rtk proxy $PN lint

# 5 — volle Vitest-Suite; unter Last flaky, deshalb einmal seriell nachziehen
rtk proxy $PN test
rtk proxy $PN test -- --pool=forks --poolOptions.forks.singleFork

# 6 — Browser: nur dieses Bündel. Binary muss existieren, sonst überspringt die Suite laut
ls -l $WT/target/debug/lifeline-hub
rtk proxy $PN e2e -- bewegungen-schmal.spec.ts
# Flake-Probe des Trefflächen- und Reihenfolge-Nachweises
rtk proxy $PN e2e -- bewegungen-schmal.spec.ts --repeat-each=5
# Nachbarschaft, die dieselbe Seite anfasst
rtk proxy $PN e2e -- uhs-grundriss-dnd.spec.ts uhs-grundriss-person-scroll.spec.ts \
  katalogtabelle-schmal.spec.ts gate1-ueberlauf.spec.ts

# 7 — Sammel-Gate vor dem Merge
rtk proxy $WT/scripts/check-all.sh
```

Zwei gezielte Mutationsproben, mit denen belegt wird, dass die neuen Tests etwas prüfen (nach dem Muster der gemessenen Fallen; jeweils zurückdrehen):

```bash
# a) sortWert entfernen → Schritt-3-Test MUSS rot werden (sonst greift F4)
# b) `filter.trifft` auf `() => true` setzen → Schritt-2-Test MUSS rot werden (sonst greift F7)
```

---

## 5. Was dieses Bündel NICHT liefert

1. **`components/Datensicht.tsx` und `datensicht.guard.test.ts`** — Bündel I. Dieses Bündel ist Konsument und blockiert auf V1 (Blätterung), V3 (Schalterschwelle) und optional V2 (`ziel`-Verbreiterung).
2. **Blätterung 50, falls V1 nicht kommt.** Ohne den `blaetterung`-Prop gibt es keinen Weg, sie von hier aus zu setzen, und der Default-Fall (antds `pageSize: 10`) ist schlechter als heute. Ersatzlieferung: `pagination={false}`-Verhalten im Primitiv, dieses Bündel ohne Blätterung. Kein Rückschritt (5 Spalten, Protokoll je UHS), aber die Bündelvorgabe ist dann offen.
3. **`pages/uhs/MaterialTab.tsx`** — E4-Pflicht, im Bündeltext nicht genannt, Eigentum offen. Damit bleibt die Seite **halb** überlaufgesichert: der Default-Reiter drückt bei 390 px weiter. Das ist die sichtbarste offene Kante dieses Bündels und der Grund, warum jede Überlaufmessung hier bündel-eigenes DOM adressiert (F1). → Zuordnung entscheiden, dann 2-Zeilen-Tausch plus `KATALOGTABELLEN`-Eintrag.
4. **`gate1-ueberlauf.spec.ts`-Erweiterung.** Die UHS-Detailroute braucht zwei erzeugte IDs und passt nicht in dessen statische Routentabelle (`:153-162`). Der Nachweis liegt in `bewegungen-schmal.spec.ts`.
5. **Serverseitiger Art-Filter / serverseitige Sortierung.** `uhs.belegungen` ist ein Feld der `uhsDetail`-Antwort (`$WT/src/routes/einsatz_uhs.rs:181-187`), keine eigene Liste. Alles läuft client-seitig. Das ist die kleine Lösung mit einer **ungeprüften Annahme**: die Bewegungszahl je UHS bleibt klein. Bei einem BHP mit tausenden Belegungen ist das falsch. → eigenes Ticket (Backend-Route + Codegen).
6. **In-Zeile-Bedienung im Kartenzweig** — hier gegenstandslos: die Sicht ist read-only, Belegungen entstehen im Grundriss. Deshalb `karte.aktion` ungesetzt und Kriterium 4 „nicht anwendbar".
7. **Ein dritter Kanal für `belegungsArt`.** `$WT/frontend/src/theme/statusFarben.ts:151-155` setzt bei keiner der drei Arten `form`; `StatusTag` unterstützt `dreieck`/`kreis`/`balken`. Farbe + Text genügt WCAG 1.4.1, aber wenn die Art in der Karte zur Hauptunterscheidung wird, wäre `form` die vorhandene, ungenutzte Option. Änderung berührt `statusFarben.test.ts:31-43` → A2-Entscheidung, nicht B2.
8. **Die „Inbox"-Doppeldeutigkeit** (`BewegungenTab.tsx:60-64`): `platz_id === null` und „gesetzt, aber unbekannt" liefern denselben Text. Bewusst unangetastet — eine Verhaltensänderung mitten in einer Formmigration wäre nicht mehr trennbar zuzuordnen.
9. **Deeplinkbarkeit von Sortier-/Filter-/Suchzustand** und **Persistenz über Navigation** — §9.4/§9.5, eigene Tickets.
10. **Der Abbau der 151 Bestands-`size="small"`** — LFH-333/B5. Dieses Bündel fügt kein neues hinzu (F8), räumt aber auch keins weg.