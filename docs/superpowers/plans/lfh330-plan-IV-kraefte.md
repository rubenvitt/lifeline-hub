# Bündel IV — Kräfte-Module + Kräfteübersicht (zusammen, geteilte Dateien)

# Umsetzungsplan — Bündel IV (Kräfte-Module + Kräfteübersicht), LFH-330/B2

Alle Zeilenangaben unten sind **am HEAD des Worktrees nachgeschlagen**, nicht aus bericht-3/5/6 übernommen. Wo ein Bericht falsch lag, steht das dabei.

---

## 0. Zwei Vorentscheidungen, die vor dem ersten Commit fallen müssen

### 0.1 `Datensicht.tsx` existiert nicht (gemessen: `grep -rn "Datensicht" frontend/src frontend/e2e` → 0 Treffer)

Bündel IV ist der **Konsument**, nicht der Erbauer. Es fasst `frontend/src/components/Datensicht.tsx` **nicht an** — sonst kollidiert es mit dem Paket, das das Primitiv baut. Daraus folgt der Phasenschnitt in §1: **Phase A braucht `Datensicht` nicht** und liefert Teil 2 vollständig; Phase B setzt es voraus.

### 0.2 Drei Verträge, die die festgelegte API **nicht** erfüllt

Diese drei werden **nicht als Prosa-Bitte** an den Erbauer weitergegeben, sondern als **Konsumententests in meinen eigenen Dateien** geschrieben. Sie sind rot, bis der Erbauer liefert, und sie erzeugen keinen Merge-Konflikt in seiner Datei.

**(a) Die Zeilenschleuse ist mit `gruppen` inkohärent — das ist die Antwort auf Kriterium 12 und sie fehlt in der Spec.**

Die Spec friert „Zeilenmenge und Zeilenreihenfolge" ein und lässt Zellinhalte weiterlaufen. Mit `gruppen` werden Gruppenzugehörigkeit **und** Zählerstreifen aus den **frischen** Daten abgeleitet. Folge, gemessen am echten Ablauf von `FahrzeugePage.tsx:207-212` (`statusMutation` → `invalidate()` → Refetch von `einsatzKeys.fahrzeuge`):

> Der Nutzer stellt in Zeile „Florian 1" den Status von *verfügbar* auf *gebunden*. Die Zeile ist eingefroren, bleibt also im Block „verfügbar" stehen — ihr eigenes Statusetikett liest aber schon „gebunden", und der Zählerstreifen sagt „verfügbar · 0". Drei Aussagen, die sich widersprechen. **Kein Test sieht das**, weil kein Test heute Reihenfolge und Zähler gemeinsam prüft.

Verlangt wird: **die gefrorene Einheit ist das Ergebnis von `effektiveDaten` + `gruppiere` zusammen** — Reihenfolge *und* Gruppenzuordnung *und* Zähler. Und: das Sammelbanner braucht eine **zweite Ursache** („Reihenfolge veraltet — neu ordnen"), weil hier *null* Zeilen neu sind und ein Banner „0 neue Einträge" nie erschiene.

**(b) `DatensichtProps` hat kein `className`, und die Werkzeugzeile wird immer gerendert.**
`kraefteuebersichtPrint.css` arbeitet über `body * { visibility: hidden }` + `.kraefte-no-print { display:none }` (Datei hat 6 Zeilen, vollständig gelesen). Ein Knoten *innerhalb* von `Datensicht` ist damit nicht markierbar. Konsequenz für Teil 3: **`handleDrucken` bleibt in `EinsatzSeite aktionen`** (dort trägt es schon `kraefte-no-print`, `KraefteuebersichtPage.tsx:235`) und wandert **nicht** in `werkzeuge` — Abweichung von Spec §6, begründet. Ask an den Erbauer: eine stabile Klasse auf Werkzeugzeile/Banner (`datensicht-werkzeuge`). Bis dahin gepinnt durch einen Test, dass die leere Werkzeugzeile **keine sichtbaren Kinder** hat (`childElementCount === 0`) — dann druckt sie auch nichts.

**(c) Die Schwelle des Spaltenschalters ist in der Spec unbenannt** („5 Spalten, unter der Schwelle", §6 BewegungenTab). Bündel IV braucht sie aus Konsumentensicht: **PersonalPage (9) und FahrzeugePage (8) zeigen ihn, Meldebild (6) und MaterialPage (6) nicht.** Die Zahl (⇒ 8 sichtbare Spalten) gehört dem Erbauer; mein Beitrag sind zwei Tests in beide Richtungen.

---

## 1. Reihenfolge der Schritte — je Schritt „erst der Test, dann der Code"

### PHASE A — ohne `Datensicht`, liefert Teil 2 vollständig

Diese Phase ist der Risikopuffer: sie erfüllt den gesamten Ampelspalten-Auftrag auf dem heutigen rohen `<Table>` (`KraefteuebersichtPage.tsx:333`) und ist unabhängig davon, ob `Datensicht` rechtzeitig landet.

---

**A1 · `frontend/src/kraefte/statusAchse.ts` — die eine Statusachse der vier Seiten**

*Neue Datei.* `kraeftebild.ts` wird **nicht** angefasst (Gegenentscheidung zu bericht-3, das „Gruppierung/Zählen aus `baueKraeftebild` extrahieren" fordert: `Gruppierung`/`gruppiere()` gehören nach der festgelegten API dem Primitiv, nicht der Datenschicht).

Inhalt:
```ts
export type KategorieOderOhne = StatusKategorie | 'ohne';
export const KATEGORIE_WERTE: readonly { text: string; value: KategorieOderOhne }[]
export function kategorieEtikett(w: KategorieOderOhne): string
export const OHNE_STATUS: StatusDarstellung   // { rolle:'neutral', label:'ohne Status' }
export interface AmpelFeld { etikett: string; titel: string; wert: number; stufe?: 'alarm' | 'achtung' | 'normal' }
export function verteilungFelder(v: StatusVerteilung | null): readonly AmpelFeld[]
```

*Test zuerst: `frontend/src/kraefte/statusAchse.test.ts`*

| `it(...)` | beweist | rot, weil |
|---|---|---|
| `KATEGORIE_WERTE trägt vier Eimer, den vierten für „kein Status"` | die Daten haben **vier** Eimer (beide DTOs führen `status_kategorie?: null \| StatusKategorie`, und die eigene Fixture `FahrzeugePage.test.tsx:44` setzt `status_kategorie: null`), `statusKategorie` in `theme/statusFarben.ts:88-92` hat **drei** Schlüssel. Ohne den vierten verschwinden Zeilen aus der gruppierten Ansicht. | Datei existiert nicht |
| `die drei Vertragslabel kommen aus statusKategorie, nicht aus einer Kopie` | Erwartungswerte als **handgeschriebene Literale** `['verfügbar','gebunden','nicht verfügbar','ohne Status']`. Gegen `statusKategorie.x.label` zu prüfen prüfte die Konstante gegen sich selbst (Repo-Lektion aus `globalKeys.test.ts`). | dito |
| `verteilungFelder liefert vier Felder in fester Folge, auch bei 0` | Ausrichtung ist der Zweck einer Vergleichsspalte (Kriterium 14). Der Bestand (`verteilungTags`, `KraefteuebersichtPage.tsx:85-96`) rendert **nur `> 0`** — Spalten fluchten dann nicht. | dito |
| `eine 0 trägt KEINE Stufe` | `.lfh-feld--alarm .lfh-zahl { color: var(--lfh-alarm) }` (`theme/sprache.css:331-334`) machte aus „0 nicht verfügbar" eine rote Zahl. Rot heißt Gefahr; 0 n.v. ist das Gegenteil (Kriterium 7). | dito |
| `verteilungFelder(null) ist leer` | `MeldebildZeile.personalVerteilung` ist `StatusVerteilung \| null` (`kraeftebild.ts:40`); `mittel`-Zeilen tragen `null`. | dito |

Nicht trivial grün: jede Zusicherung nennt eine Zahl oder ein Literal, das nirgends im Repo steht; ein leeres Modul wirft schon beim Import.

---

**A2 · `frontend/src/kraefte/AmpelZelle.tsx` — die Bauform des zweiten Kanals**

*Neue Datei.* Vorbild ist `pages/lage-dashboard/LageDashboardPage.tsx:346-353`, aber **ohne `.lfh-felder`**: das ist ein `grid-template-columns: repeat(4, 1fr)` mit Rahmen (`sprache.css:315-321`) und in einer Tabellenzelle falsch. Übernommen werden nur `.lfh-feld`, `.lfh-etikett`, `.lfh-zahl lfh-zahl--mittel`; der Umschließer ist ein Inline-Flex. **Damit wird in `theme/` nichts geschrieben** — kein Eigentümerstreit, kein Guard berührt (geprüft: `seitenrinne.guard.test.ts` liest `index.css`, `kopfpolsterung.guard.test.ts`/`rollen.guard.test.ts` lesen `rollen.css`; `sprache.css` liest nur `EinsatzSeite.test.tsx:73`).

```tsx
import '../theme/sprache.css';   // Präzedenz: components/SeitenZustand.tsx:8

export default function AmpelZelle({ bezeichnung, symbol, verteilung }: {
  bezeichnung: 'Personal' | 'Fahrzeuge'; symbol: string; verteilung: StatusVerteilung | null;
}) { … }
```

Bauform, und damit die Auflösung des Emoji-Widerspruchs der Task („`aria-hidden`" **und** „`aria-label`" — kein Widerspruch, zwei verschiedene Knoten):
```html
<span role="group" aria-label="Personal">
  <span aria-hidden="true">👤</span>
  <span class="lfh-feld lfh-feld--normal"><span class="lfh-etikett" title="verfügbar">frei</span><b class="lfh-zahl lfh-zahl--mittel">7</b></span>
  … 4 Felder …
</span>
```

*Test zuerst: `frontend/src/kraefte/AmpelZelle.test.tsx`*

- `trägt aria-label auf der Zählgruppe und blendet das Symbol für Screenreader aus` — `getByRole('group', { name: 'Personal' })`, `container.querySelector('[aria-hidden="true"]')` enthält 👤. Rot: Komponente fehlt.
- `jede Zahl trägt ein Textetikett — die Farbe ist Verstärkung, nicht Kanal` — vier `.lfh-etikett` mit `['frei','geb.','n.v.','o.A.']`. **Das ist die Antwort auf den Kriterium-6-Einwand aus bericht-6**, und zwar in der Sache statt per Ausnahme: `.lfh-feld` ist ein **Verbund** aus `.lfh-etikett` (Text) und `.lfh-zahl`; nur `alarm`/`achtung` haben überhaupt eine Farbregel (`sprache.css:331-334`), `normal`/`neutral` keine. Der Text trägt die Bedeutung, die Farbe die Dringlichkeit.
- `eine 0 bekommt keine Stufenklasse` — `.lfh-feld--alarm` fehlt bei `nicht_verfuegbar: 0`.
- `enthält keinen StatusTag` — sonst wären es wieder bis zu 8 Tags. Rot heute nicht messbar, aber der Regressionsanker.

---

**A3 · `pages/KraefteuebersichtPage.tsx` — Statusspalte auftrennen (Teil 2)**

*Test zuerst, in `pages/KraefteuebersichtPage.test.tsx`* — heute hat die Datei **keine** Assertion auf die Statusspalte, die Emoji oder `verteilungTags` (nachgeschlagen: 8 `it`-Blöcke, keiner davon). Der Umbau wäre ohne neue Tests **unbelegt**.

1. `zeigt Personal und Fahrzeuge als eigene Spalten mit Textkopf`
   `getByRole('columnheader', { name: 'Personal' })` und `… 'Fahrzeuge'`. **Rot heute**: die Datei hat vier Spaltenköpfe (`Bezeichnung`, `Typ / Rolle`, `Stärke`, `Status`, `KraefteuebersichtPage.tsx:101-134`), „Personal"/„Fahrzeuge" existieren nur als `Statistic title` im Kopf (`:249`, `:256`) — und antd rendert die in `div.ant-statistic-title`, ohne `role`. Kein Fehlalarm möglich.
2. `die Zählgruppen der Abschnittszeile sind über ihr Etikett erreichbar`
   ```tsx
   const zeile = container.querySelector('[data-row-key="ab-10"]') as HTMLElement;
   expect(within(zeile).getByLabelText('Personal')).toHaveTextContent('frei');
   ```
   **Ungescopet wäre der Test aus dem falschen Grund grün**: die Fixture hat mit `ABSCHNITT_A1` + `EINHEIT_E10` zwei Zeilen mit Zählgruppen, aber die Einheitszeile ist bei `expandedRowKeys=[]` eingeklappt — es existiert *zufällig* genau ein Knoten. Beim ersten zweiten Abschnitt oder ersten `fireEvent.click` auf das Aufklapp-Icon wirft `getByLabelText` mit strict-mode-Verletzung. **Deshalb `within(zeile)`, immer.**
   Rot heute: `aria-label` kommt in der ganzen Datei **0×** vor (gemessen).
3. `die Statusspalte trägt nur noch den Einzelstatus der Mittel`
   Mittel-Zeile (`FAHRZEUG_F1`, `status_kategorie: 'verfuegbar'`) → `within(mittelZeile).getByText('verfügbar')`; Abschnittszeile → `within(abschnittZeile).queryByText(/frei|geb\.|n\.v\./)` liegt **nicht** in der Statuszelle. Beantwortet die offene Frage aus bericht-6 („wo landet der Status der `mittel`-Zeilen?"): **„Status" bleibt als dritte Spalte stehen und wird zur letzten Spalte**, weil sie nur Blätter betrifft. Neue Spaltenfolge: `Bezeichnung · Typ/Rolle · Stärke · Personal · Fahrzeuge · Status`.

*Dann der Code:*
- `verteilungTags` (`:81-99`) **entfällt** und wird durch `AmpelZelle` ersetzt. Der Begründungskommentar `:77-80` („die vollen Vertragslabels würden die Statusspalte sprengen") wandert mit nach `statusAchse.ts` — die Abkürzungen bleiben, weil `.lfh-etikett` versal + gesperrt setzt (`sprache.css:177-185`) und lange Wörter dort noch breiter werden. Der Volltext kommt als `title` dazu.
- `spalten` (`:101`) bleibt **Modul-Konstante**: `AmpelZelle` holt Farbe über CSS-Klassen, nicht über `theme.useToken()`. bericht-6s Befürchtung „muss ins `useMemo` im Rumpf, trifft `exhaustive-deps` unter `--max-warnings 0`" **entfällt damit** — nachgeprüft: die Konstante braucht weder `token` noch `useViewport`.
- `Space size={8}` (`:127`) verschwindet mit dem Zweig; kein neues rohes Pixelmaß (Norm „ohnehin Angefasstes").
- `Input.Search style={{ width: 220 }}` (`:327`): fest auf `flex: '1 1 220px', minWidth: 0, maxWidth: 320`. Die Datei liegt außerhalb der vier `BEREICHE` von `feldbreiten.guard.test.ts:44`, der Guard bricht also nicht — Grenze 3 desselben Guards sagt, die Regel gilt trotzdem.
- Die drei handgeschriebenen Statusfilter-Optionen (`:317-321`) werden auf `KATEGORIE_WERTE` gezogen. Damit ist die von bericht-3 gemeldete Duplikation aufgelöst statt in drei weitere Dateien kopiert.

**Ende Phase A: Teil 2 ist vollständig, gemessen und unabhängig lieferbar.**

---

### PHASE B — vier Seiten auf `Datensicht`

**B0 · Koordination (kein Code).** §0.2 (a)/(b)/(c) an den `Datensicht`-Eigentümer, mit den drei Konsumententests aus B1 als Abnahmekriterium. Wer B1 startet, bevor (a) beantwortet ist, baut die Kriterium-12-Antwort zweimal.

---

**B1 · `pages/FahrzeugePage.tsx` — zuerst, weil sie die härteste Kombination trägt**

Gruppen **+** `aufklappzeile` **+** SSE-live-Statuswechsel in der Zeile **+** Spaltenschalter. Sie erzwingt Vertrag (a) und (c) früh.

*Tests zuerst, in `pages/FahrzeugePage.test.tsx`:*

1. **`ein Statuswechsel unter dem Cursor verschiebt weder Zeile noch Zähler` — der Kriterium-12-Beweis.**
   ```tsx
   const { container, client } = render(einsatz(), [], ef);        // renderMitProviders gibt `client` zurück
   await screen.findByText('Florian 1');
   const select = within(container.querySelector('[data-row-key="10"]')!).getByRole('combobox');
   select.focus();                                                 // Fokus liegt IN der Sicht
   const vorher = [...container.querySelectorAll('tr.ant-table-row')].map((r) => r.getAttribute('data-row-key'));
   const zaehlerVorher = screen.getByText(/gebunden · \d+/).textContent;
   act(() => { client.setQueryData(einsatzKeys.fahrzeuge(7), [{ ...ef, status_kategorie: 'verfuegbar', status_label: 'einsatzbereit' }]); });
   expect(await screen.findByText('einsatzbereit')).toBeInTheDocument();   // Zellinhalt AKTUALISIERT
   expect([...container.querySelectorAll('tr.ant-table-row')].map(…)).toEqual(vorher);  // Reihenfolge EINGEFROREN
   expect(screen.getByText(/gebunden · \d+/).textContent).toBe(zaehlerVorher);          // Zähler EINGEFROREN
   fireEvent.click(await screen.findByRole('button', { name: /neu ordnen|anzeigen/i })); // Banner übernimmt
   await waitFor(() => expect(screen.getByText(/verfügbar · 1/)).toBeInTheDocument());
   ```
   Rot ohne den Code (kein `Datensicht`, keine Gruppen, kein Banner) **und** rot bei einer Schleuse, die nur die Schlüsselfolge friert: dann bewegt sich der Zähler. Das ist die Zusicherung, die §0.2(a) einklagt.
   *Warum `neuerQueryClient()` hier erlaubt ist:* die Komponente ist gerendert, es gibt einen Observer — die `gcTime: 0`-Falle aus CLAUDE.md greift nur ohne mounted Observer.
   *Trag-Beweis:* `select.focus()` weglassen ⇒ derselbe Test muss die Umsortierung **sehen**. Diese Gegenprobe ist ein zweiter `it` („ohne Fokus in der Sicht ordnet sich die Liste sofort neu"), sonst belegt der erste nichts über die Fokusbedingung.

2. `gruppiert nach Statuskategorie, mit Zähler im Etikett` — `getByText('gebunden · 1')` als **eine** Zeichenkette. Rot: keine Gruppen heute.
3. `zeigt den Spaltenschalter mit Zähler ausgeblendeter Spalten` — 8 Spalten ⇒ Schalter sichtbar; `getByRole('button', { name: /Spalten/ })`. Vertrag (c), Richtung „zeigt".
4. `unter md steht keine Tabelle, sondern Karten` — eigenes `describe('unter md', () => { beforeEach(() => setzeViewportBreite(390)); … })`, Muster wörtlich aus `einsatz/EinsatzLayout.test.tsx:212-213`. Zusicherungen: `container.querySelector('.ant-table')` ist `null`; „Florian 1" steht da; **genau ein** Zweig im Baum (kein `display:none`-Doppel).
5. `Gegenprobe: ab md steht die Tabelle` — im Default 1024. Ohne diesen Test wäre (4) auch grün, wenn die Weiche bei **jeder** Breite anspringt (`EinsatzLayout.test.tsx:119-120` formuliert die Regel).
6. `die Karte trägt genau eine Primäraktion, und die fragt nach` — schmal: `getByRole('button', { name: 'Entfernen' })` → Klick → `Popconfirm`-Rückfrage sichtbar. Kriterium 4; `PrimaerAktion.bestaetigung`.

*Dann der Code.* Spaltenplan (Schlüssel sind der Kartenplan-Adressraum, `spaltenFuer<EinsatzFahrzeug>()`):

| key | heute | neu |
|---|---|---|
| `funkrufname` | `:258-267` | `immerSichtbar`, `sortWert`, `suchText` |
| `typ` (`dataIndex: 'fahrzeugtyp'`) | `:268` | `suchText`, `sortWert` |
| `kennzeichen` | `:269` | `abBreite: 'xl'`, `suchText` |
| `traeger` (`dataIndex: 'traegerorganisation'`) | `:270` | `filter` aus den eigenen Daten (Muster `KraefteuebersichtPage.tsx:160-163`) |
| `status` | `:271-286` | `filter: { werte: KATEGORIE_WERTE, … }`, Render unverändert dreiwegig |
| `besatzung` | `:287-296` | unverändert |
| `bemerkung` | `:297-310` | unverändert |
| `aktionen` | `:311-323` | `immerSichtbar`; `danger` **entfällt** („Rot bedient nichts") |

**Regel, die ich für das ganze Bündel setze — `abBreite` nur für lesende Spalten.** `abBreite` versteckt eine Spalte, ohne dass der Nutzer sie zurückholen kann. Schreibtragende Spalten (`position`, `status`, `bemerkung`, `menge`, `aktionen`) bekommen deshalb **nie** `abBreite`; wenn sie weichen sollen, dann über `spaltenAusVoreinstellung` — dann sind sie im Schalter mit Zähler sichtbar. Das ist zugleich die Auflösung der ersten harten Bruchstelle, siehe §3.1.

Weiter: `gruppen` mit vierter Eimer-Reihenfolge `['verfuegbar','gebunden','nicht_verfuegbar','ohne']`; `suche={{ platzhalter: 'Funkrufname, Typ, Träger' }}`; `standardSortierung={{ spalte:'funkrufname', richtung:'auf' }}`; `zeilenKlasse` ← das heutige `rowClassName` (`:374`); `aufklappzeile` ← der heutige `expandable.expandedRowRender` (`:376-388`); `leerText` ← `locale.emptyText` (`:375`); `karte` mit `titel: { spalte: 'funkrufname' }` — **ohne `ziel`**, siehe §3.2.

---

**B2 · `pages/PersonalPage.tsx`**

*Tests zuerst* (`pages/PersonalPage.test.tsx`): dieselben sechs Muster wie B1, plus
- `der Spaltenschalter meldet die ausgeblendete Bemerkungsspalte als Text` — `getByRole('button', { name: /Spalten · 1 ausgeblendet/ })`. **Kein `Badge count`**: ein `count`-Badge ohne `color` rendert auf `token.colorError` (antd `badge/style/index.js`) — Rot für einen Spaltenzähler bricht Kriterium 7.
- `Gegenprobe zur Schalter-Schwelle` in `MaterialPage.test.tsx`: 6 Spalten ⇒ `queryByRole('button', { name: /Spalten/ })` ist `null`. Vertrag (c), Richtung „zeigt nicht". Ohne diese Gegenprobe wäre ein Schalter, der immer erscheint, ebenfalls grün.

Spaltenplan: 9 Schlüssel `name · funktion · traeger · fahrzeug · einheit · position · status · bemerkung · aktionen`, alle Renderer byte-nah aus `:161-253`. **Die zwei Deeplink-Spalten `fahrzeug`/`einheit` behalten ihre `<Link>` in der Zelle** (`:174-192`) — sie wandern *nicht* nach `titel.ziel` (§3.2). `spaltenAusVoreinstellung={['bemerkung']}`. `filter` auf `traeger` und `status`.

---

**B3 · `pages/MaterialPage.tsx`**

E3 bestätigt am Typ: `EinsatzMaterialAnzeige` hat kein `status_kategorie`, nur `status: MaterialStatus` (5 Werte, `MaterialPage.tsx:18-24`) — dieselbe Grenze, die `filtereKraefte` schon zieht (`kraeftebild.ts:386-387`, wörtlich nachgelesen). Also: **Gruppen auf der eigenen 5-Werte-Achse**, Reihenfolge = `Object.keys(STATUS_META)`; `filter` auf `status` und `kategorie` (Werte aus den eigenen Daten); **kein `karte.status`-Slot** — `STATUS_META` sind rohe antd-Preset-Farbnamen und liegen ausdrücklich außerhalb des A2-Vertrags (`theme/statusFarben.ts` nennt MaterialPage als draußen); sie in `StatusDarstellung` zu zwingen wäre der Bestands-Sweep, den A2 verbietet. Status steht als Sekundärfeld.

Beim Anfassen der zwei Zellen entfällt `size="small"` am Status-`Select` (`:148`) und am Aktions-`Button` (`:177`) — kein neues, und ein ohnehin angefasstes weniger. `MengeZelle` (`:30-47`, `size="small"` auf `:41`) wird **nicht** angefasst; ihr Abbau ist LFH-333/B5.

`MaterialPage` bleibt in ihrem rohen `<div style={{ padding: 16 }}>` (`:186`) statt `EinsatzSeite` — der Rahmenumbau ist in B2 nicht beauftragt und wäre ein zweiter, unabhängiger Diff. Folge, die ich benenne: `sprache.css` ist auf dieser Seite **nicht** im Scope — deshalb liegt `AmpelZelle` mit eigenem CSS-Import bei sich (A2) und `Datensicht` selbst darf keine `lfh-*`-Klasse verwenden.

---

**B4 · `pages/KraefteuebersichtPage.tsx` → `Datensicht form="tabelle"` (Teil 3)**

*Tests zuerst:*
1. `der Meldebild-Baum bleibt in jeder Breite eine Tabelle` — schmal-`describe` mit `setzeViewportBreite(390)`: `container.querySelector('.ant-table')` ist **nicht** null. Begründung im Code: A1/Festlegung 2 führt diese Seite als kanonisches „wird verglichen: ja", Kriterium 14 verbietet dort die Auflösung in Karten. Das beantwortet die offene Frage aus bericht-6 („Kriterium-14-Konflikt") mit **nein, kein Kartenzweig** — und macht die Ausnahmebegründung überflüssig.
2. `Unter-Einheiten bleiben aufklappbar` — der Bestandstest `:116-128` (`.ant-table-row-expand-icon-collapsed` → Klick → „1. Zug") **bleibt unverändert stehen** und ist damit der Regressionsanker über den Umbau. Nachgeprüft, dass er das kann: `KatalogTabelle.test.tsx:41-53` belegt, dass `sticky` genau **eine** `th.ant-table-cell-fix-start` erzeugt und Kopf/Körper in zwei `<table>` trennt — die verborgene Messzeile trägt kein Aufklapp-Icon und kein `data-row-key`, der erste Treffer bleibt die Datenzeile.
3. `die leere Werkzeugzeile schiebt nichts und druckt nichts` — `childElementCount === 0`. Vertrag (b).
4. `Drucken klappt alle Knoten auf` — `fireEvent.click(getByRole('button', {name:/Drucken/}))`, dann alle vier Fixture-Zeilen sichtbar, `window.print` (in `beforeEach:78` gestubbt) einmal gerufen.

*Dann der Code:*
- `<Table>` (`:333-341`) → `<Datensicht form="tabelle" baum={{ kinder:'children', aufgeklappt: expandedKeys, onAufgeklappt: setExpandedKeys }} zeilenSchluessel="key" daten={bild.baum} />`. Gemessen: alle drei Bausteine liegen heute schon in `expandable={{…}}` (`:336-340`) — Umzug, kein Umbau. `KinderFeld<MeldebildZeile>` löst zu `'children'` auf (`kraeftebild.ts:42`).
- `zufluss="sammelbanner"`: eine **neue Disposition** schiebt eine Mittel-Zeile in den Baum und verschiebt alles darunter. `'sofort'` wäre hier falsch — der Statuswechsel allein sortiert nichts um (die Folge ist fachlich: Abschnitt → Einheit → Mittel, über `sortier`), aber die Einfügung schon.
- **Kein `suche`, kein Spaltenfilter, keine `gruppen`, keine `standardSortierung`.** Nachgelesen und bestätigt: `personalVerteilung`/`fahrzeugVerteilung` werden über `addKategorie` (`kraeftebild.ts:97-102`) stromaufwärts über die **Vollmenge** kumuliert, während `filtereKraefte` (`:368-389`) die Rohlisten filtert und `baueKraeftebild` den Baum neu baut. Fiele im Primitiv eine Zeile weg, behielten die Elternzeilen Aggregate über nicht mehr sichtbare Kinder — die Ampelzahlen lügen still. Die Filter-Card (`:294-332`, `className="kraefte-no-print"`) bleibt **außerhalb**.
- `handleDrucken` bleibt in `aktionen` (§0.2 b) und **unverändert**: `baum.aufgeklappt` ist kontrolliert, `effektiveDaten` gibt im Baummodus `daten` unangetastet zurück, also adressiert `alleKeys(bild.baum)` (`:136-138`, `:203-206`) weiter genau die gerenderten Zeilen.
- `pages/kraefteuebersichtPrint.css` bekommt die Druck-Neutralisierer — siehe §3.4. **Ohne sie ist Teil 3 kaputt ausgeliefert.**

---

**B5 · e2e — die Aussagen, die jsdom prinzipiell nicht treffen kann** (`vite.config.ts:84`, `css: false`)

- `e2e/gate1-ueberlauf.spec.ts`: drei Zeilen in `routen` (`:152-163`), je **seiteneigener** Anker — Kräfteübersicht `getByRole('columnheader', { name: 'Personal' })`, Personalseite `tr.ant-table-row` bei 1366/1024 bzw. der Kartentitel bei 390, Material analog. Kein `.ant-layout-content` (der Kommentar `:135-151` verbietet es begründet). Maß bleibt `documentElement.scrollWidth - clientWidth` mit 1-px-Toleranz; die AK-Formel `body.scrollWidth <= innerWidth` ist in diesem Repo **viermal begründet verworfen** (`nav-schmal.spec.ts:78-90` u. a.) und wird als Abweichung protokolliert, nicht umgesetzt.
- **Neu `e2e/datensicht-schmal.spec.ts`**, `test.use({ viewport: { width: 390, height: 844 } })` (kein Device-Descriptor — vier Specs begründen das mit dem ungesicherten webkit-Download): kein `.ant-table` auf `/einsaetze/:id/personal`, Gegenprobe bei 1366; Trefffläche von Aktionsknopf und Spaltenschalter ≥ 48 px über das kopierte `haeltTreffflaeche` + `SUBPIXEL = 0.5` (`nav-schmal.spec.ts:24-46`); `toHaveCount(1)` vor jeder Zusicherung.
- **Neu `e2e/kraefte-meldebild.spec.ts`** — die zwei Nachweise, die **Lieferbedingung** sind:
  1. `fixed:'left'` × Aufklapp-Icon: bei 390 das Icon klicken, Kindzeile erscheint; dann `scrollTo(300, 0)` im `.ant-table-body` und die fixierte Zelle **relativ zum Bildlaufcontainer** messen (Muster `katalogtabelle-schmal.spec.ts:123-153`; ein `toBeVisible()` war dort per Mutationsprobe wirkungslos). Keiner der 14 Bestandskonsumenten von `KatalogTabelle` ist ein Baum — diese Kombination ist im Repo unbelegt.
  2. Druckpfad: `page.emulateMedia({ media: 'print' })`, „Drucken" klicken, dann die **letzte** Spaltenzelle messen und zusichern, dass ihre Bounding-Box **innerhalb** von `.kraefte-print-root` liegt. Stärker als `getComputedStyle(...).overflowX === 'visible'` — das belegt nur, dass die Regel geparst wurde.
- **Neu, Kriterium 13** (von `2026-07-28-katalogtabellen-pruefliste.md:65` an B2 delegiert, in **keinem** der acht Berichte besetzt): Tabulatordurchlauf hinter stehender Kopfzeile und fixierter Spalte 0 — nach jedem `page.keyboard.press('Tab')` die Box des fokussierten Elements gegen die Box von `.ant-table-sticky-holder` und `.ant-table-cell-fix-start` prüfen. Neubau ohne Vorbild: `press`/`keyboard` trifft in `frontend/e2e/` nur `command-palette.spec.ts`.
- e2e-Fixture-Namen **ohne Modulnamen** („E2E Meldebild …" ist verboten, weil die Kommandopalette Module und Einsätze in derselben Optionsliste sucht — `lagekarte-smoke.spec.ts:56-60`, gemessen 1/0/2 Fehlschläge in 3 Läufen). Anmelden und Anlegen laufen **breit**, erst danach `setViewportSize`.

---

## 2. Je Datei: was geändert wird und welche Tests brechen

### `frontend/src/kraefte/statusAchse.ts` · `statusAchse.test.ts` · `AmpelZelle.tsx` · `AmpelZelle.test.tsx`
Neu. Nichts bricht.

### `frontend/src/kraefte/kraeftebild.ts`
**Unverändert.** Gegen bericht-3s Empfehlung, `addKategorie`/die Gruppierung zu exportieren: `gruppiere()`/`Gruppierung` gehören dem Primitiv. `staerkeText` (`:394-396`) wird von drei weiteren Dateien konsumiert und bleibt tabu. `kraeftebild.test.ts` (13 `it`) bleibt vollständig grün.

### `frontend/src/pages/KraefteuebersichtPage.tsx`
Phase A: Statusspalte auftrennen, `verteilungTags` → `AmpelZelle`, Statusfilter-Optionen aus `KATEGORIE_WERTE`, Suchfeldbreite fluide. Phase B: `<Table>` → `<Datensicht form="tabelle">`.

**`KraefteuebersichtPage.test.tsx` — kein Bestandstest bricht durch Phase A** (keine Assertion auf Statusspalte/Emoji, gemessen). Durch Phase B potenziell `:116-128`; dagegen der Nachweis oben (nur **eine** `fix-start`-Kopfzelle, Messzeile ohne Icon). Zwei Anpassungen, keine Löschung:
- **Auf `renderMitProviders` heben** (`setup()`, `:87-100`, baut heute QueryClient/AntApp/MemoryRouter selbst, **ohne `ConfigProvider`**). Grund: `Datensicht` liest die Dichte am `ConfigProvider` (B5-Vorbereitung) und `renderMitProviders` gibt `client` zurück, den der Zufluss-Test braucht. Die sechs `vi.mock` auf die API-Module bleiben; `vi.mock('react-router', …)` (`:28`) ist partiell und behält `MemoryRouter`. Die eigene `AuthProvider`-Schachtel entfällt (sonst doppelt).
- `vi.mock('../live/useEinsatzLiveStream')` (`:23`) ist **toter Bestand** — die Page importiert es nicht (nachgeprüft: 0 Treffer in der Datei). Beim Anfassen entfernen; die Aussage dahinter (diese Seite hat keinen eigenen Stream) gehört als Kommentar an den Zufluss-Test.

### `frontend/src/pages/FahrzeugePage.tsx`
`<Table>` (`:368-389`) → `<Datensicht>`; Spalten (`:257-324`) auf `spaltenFuer` mit `key`/`sortWert`/`suchText`/`filter`/`abBreite`; `danger` am Entfernen-Button (`:318`) entfällt; `karte`-Plan neu.

**`FahrzeugePage.test.tsx` — sechs Assertionsfamilien, die überleben, und warum:**
| Stelle | hält, weil |
|---|---|
| `:97` `[data-row-key="10"]` + `.zeile-hervorgehoben` | `zeilenKlasse` → `rowClassName`; die Sticky-Messzeile trägt kein `data-row-key` |
| `:130` `getByRole('columnheader', {name:'Besatzung'})` | `besatzung` bekommt kein `abBreite`; Sticky duplizieren keine Kopfzellen (`KatalogTabelle.test.tsx:44-47`) |
| `:131,142,152-153,166,175-176` `.ant-tag-red/-green/-blue` | `BesatzungsStaerkeBadge` (`:90-102`) wird **nicht** auf `StatusTag` gehoben — das würde die Farbklasse entfernen (`StatusTag.tsx:29-30`) und fünf Assertionen brechen. Der Umbau ist nicht beauftragt. |
| `:187-189`, `:203` `.ant-table-row-expand-icon-collapsed` | `aufklappzeile` → `expandable.expandedRowRender`, gleiche Klasse; `gruppen` erzeugt im Tabellenzweig **keine** synthetischen Zeilen (§9(8)), also keinen zweiten Icon-Kandidaten |
| `:114` `getByText('disponiert')` | Gruppenetikett ist `gebunden · 1`, das Statusetikett `disponiert` — kein Mehrfachtreffer |
| `:104-106` Aktionsknöpfe | unverändert im `aktionen`-Slot des `EinsatzSeite` |

Neu dazu: die sechs Tests aus B1.

### `frontend/src/pages/PersonalPage.tsx`
`<Table>` (`:294-302`) → `<Datensicht>`; 9 Spalten (`:161-253`) auf `spaltenFuer`; `spaltenAusVoreinstellung={['bemerkung']}`; `danger` (`:247`) entfällt.

**`PersonalPage.test.tsx` — zwei echte Bruchstellen, beide angepasst statt gelöscht:**
- `:125` `container.querySelector('.ant-select-clear')` → `container.querySelector('[data-row-key="10"] .ant-select-clear')`. Begründung im Test: der Selektor greift den **ersten** Treffer in Dokumentordnung, und die Werkzeugzeile steht davor. **Wichtige Präzisierung gegen bericht-3, gemessen:** heute bricht das noch *nicht* — `useAllowClear` (`@rc-component/select@1.8.2/lib/hooks/useAllowClear.js`) rendert den Löschknoten nur bei `displayValues.length || mergedSearchValue`, ein leerer Filter-`Select` erzeugt also kein `.ant-select-clear`, und `Input.Search allowClear` erzeugt `.ant-input-clear-icon` (anderer Präfix, `@rc-component/input/lib/BaseInput.js:68`). Der Test wäre also grün geblieben, **bis irgendwann ein Filter einen Wert hält** — genau die Sorte Test, die aufhört zu prüfen, ohne rot zu werden. Deshalb scopen, nicht abwarten.
- `:164` `within(zeile).getAllByText('—')).toHaveLength(2)` → zwei gezielte Zusicherungen auf die Fahrzeug- und Einheit-**Zelle** (`getAllByRole('cell')` indexiert oder per `columnheader`-Index). Der Zähler hält rechnerisch auch nach dem Umbau (bemerkung ist ausgeblendet, Position rendert im Schreibmodus einen `Select`), aber er pinnt eine Platzhalterzahl statt einer Aussage.
- `:139-143` (`getByRole('link', 'Florian 1 (FW-1234)')` / `'Zugtrupp'`) und `:161` (`queryByRole('link')` in Zeile 11 ist `null`) **halten** — genau deshalb bekommt `titel` kein `ziel`, siehe §3.2.

### `frontend/src/pages/MaterialPage.tsx`
`<Table>` (`:224-231`) → `<Datensicht>`; 6 Spalten (`:122-183`); `size="small"` an `:148`/`:177` entfällt; Gruppen auf `MaterialStatus`.

**`MaterialPage.test.tsx`** — `:67` `getByText('einsatzbereit')` hält **nur**, wenn das Gruppen-/Zählerstreifen-Etikett **ein** Textknoten ist (`einsatzbereit · 1`): RTL-String-Matching ist standardmäßig exakt auf den normalisierten Textinhalt, `'einsatzbereit'` trifft `'einsatzbereit · 1'` also nicht. Wäre der Kopf `<span>einsatzbereit</span> · <span>1</span>`, würde derselbe Test mit strict-mode-Verletzung werfen. Als Kommentar in den Test.
`:52` `getByDisplayValue('50')` hält (MengeZelle unangetastet).

### `frontend/src/pages/kraefteuebersichtPrint.css`
Neuer `@media print`-Block, siehe §3.4.

### `frontend/e2e/gate1-ueberlauf.spec.ts` · neu `datensicht-schmal.spec.ts` · neu `kraefte-meldebild.spec.ts`
Siehe B5.

### **Nicht angefasst — bewusst**
`components/KatalogTabelle.tsx`, `components/katalogTabelle.guard.test.ts` (keine meiner vier Dateien steht in der handgepflegten 13er-Liste `:39-53`, `toHaveLength(13)` `:101` bewegt sich nicht; `scroll={{` im Primitiv bleibt exakt 1, weil `Datensicht` kein Scroll-Prop setzt), `components/Liste.tsx`, `theme/*`, `pages/MitgliederAbschnitt.tsx` (E3: `MitgliedAnzeige` hat 5 Felder, weder Träger noch Status — bekommt nur den Überlaufschutz, und der gehört nicht in dieses Bündel).

---

## 3. Die Fallen — am Code gefunden

### 3.1 `abBreite: 'xl'` bricht `PersonalPage.test.tsx:114-131` hart (Spec §6 hat sie eingebaut)
`VIEWPORT_STANDARD = 1024` (`test/viewport.ts:31`), antd `screenXL = 1200` (nachgeschlagen: `node_modules/antd/es/theme/util/alias.js:31`). ⇒ `abBreiteAus(screens,'xl')` = `screens.xl !== false` = **false** ⇒ **jede `abBreite:'xl'`-Spalte fehlt in jedem Standard-Vitest-Render.** Spec §6 setzt `abBreite:'xl'` auf `position` — dann findet `:125` gar kein `.ant-select-clear` und `expect(clear, 'Position-Select muss allowClear haben').not.toBeNull()` schlägt fehl.
**Entschieden: `position` bekommt kein `abBreite`.** Nicht wegen des Tests, sondern weil A1s Führungs-Tablet **1024–1280 px** ist und Position eine von nur zwei Schreib-Bedienungen dieser Seite; sie genau in diesem Kontext zu verstecken ist eine Funktionsregression — und §9(6) hält fest, dass es keine Detailroute gibt, auf die man sie verlagern könnte. Wer die Spalte weghaben will, nimmt `spaltenAusVoreinstellung`; dann steht sie im Schalter mit Zähler. Als Kommentar an den Spaltenplan, sonst baut sie der Nächste zurück ein.

### 3.2 `titel.ziel` würde eine gepinnte LFH-139-Aussage lautlos umdrehen
Setzt man laut Spec §6 `titel: { spalte:'name', ziel: (ep) => personalPfad(...) }`, rendert die Titelzelle in **beiden** Zweigen einen `<Link>` — und `PersonalPage.test.tsx:161` `expect(within(zeile).queryByRole('link')).toBeNull()` bricht, obwohl fachlich nichts gewonnen ist: `personalPfad`/`fahrzeugePfad` sind Query-Param-Selektionen **auf dieselbe Seite** (CLAUDE.md, Deeplink-Muster), der Link zeigt auf sich selbst.
**Entschieden: kein `ziel` auf FahrzeugePage/PersonalPage/MaterialPage/Meldebild.** Das Tastaturziel der Karte ist die Primäraktion; `fahrzeug`/`einheit` behalten ihre echten Fremd-Links in der Zelle. **Benannte Folge:** eine Karte im Nur-Lese-Modus hat unter 768 px kein fokussierbares Element. Das ist kein a11y-Mangel (es gibt nichts zu bedienen), aber es heißt, dass Kriterium 1 im Kartenzweig **nur** am Aktionsknopf und am Spaltenschalter gemessen wird — steht so in der Prüfliste.

### 3.3 `within(zeile)` bei `getByLabelText('Personal')`
Die Fixture hat mit `ABSCHNITT_A1` + `EINHEIT_E10` **zwei** Zeilen mit Zählgruppen; nur weil `expandedRowKeys=[]` die Einheitszeile eingeklappt hält, existiert zufällig ein Knoten. `getByLabelText('Personal')` ohne Scope ist damit **grün aus dem falschen Grund** und wirft beim ersten zweiten Abschnitt oder beim ersten Aufklapp-Klick.

### 3.4 Der Druckpfad geht durch den Bildlaufcontainer kaputt — und kein Test sähe es
`kraefteuebersichtPrint.css` (vollständig, 6 Zeilen) schaltet **nur `visibility`**. Es neutralisiert weder `.ant-table-body { overflow: auto }` noch den Sticky-Holder noch `position: sticky` der `fix-start`-Zellen — alles Dinge, die `KatalogTabelle` unbedingt setzt (`:74`). Nach dem Umbau wird der Ausdruck also **rechts abgeschnitten**, und weil jsdom kein Layout rechnet und `@media print` schon gar nicht, bleibt jeder Vitest grün.
```css
@media print {
  .kraefte-print-root .ant-table-body,
  .kraefte-print-root .ant-table-content { overflow: visible !important; max-height: none !important; }
  .kraefte-print-root .ant-table-body table { width: 100% !important; }
  .kraefte-print-root .ant-table-sticky-holder { position: static !important; }
  .kraefte-print-root .ant-table-sticky-scroll { display: none !important; }
  .kraefte-print-root .ant-table-cell-fix-start,
  .kraefte-print-root .ant-table-cell-fix-end { position: static !important; }
}
```
Beleg: `emulateMedia({ media: 'print' })` + Bounding-Box der letzten Spaltenzelle innerhalb `.kraefte-print-root` (§B5).

### 3.5 Zwei Zahlenwege auf dieselbe Frage — die neue Ampelzeile verdoppelt ihn
Der Kennzahlenkopf (`:243-293`) liest `bild.verdichtung`, gerechnet **aus den Rohlisten**; die Baumzeilen kumulieren über `addKategorie`. Eine Ampelzeile in der Zeile und eine Kennzahl im Kopf können bei kaputter Kumulation auseinanderlaufen, **ohne dass ein Test es merkt**. `kraeftebild.test.ts:29` („Invariante: Kopf zählt jede Kraft genau einmal") deckt den Kopf, nicht den Vergleich. Neuer Test in `kraeftebild.test.ts`: Summe der `personalVerteilung` über die Wurzelzeilen == `verdichtung.personalStatus`. Kein Produktivcode-Diff, aber die Brücke zwischen den zwei Wegen.

### 3.6 Tests, die nach dem Umbau grün bleiben, ohne etwas zu belegen
- **`FahrzeugePage.test.tsx:73`** (`findByText('Florian 1')`) ist in **beiden** Zweigen grün — als Zweignachweis wertlos. Deshalb prüft der Schmal-Test die **Abwesenheit** von `.ant-table` und der Breit-Test ihre Anwesenheit.
- **Ein `standardSortierung`-Test gegen die Serverordnung.** Das Backend liefert schon sortiert; „erste Zeile ist X" kann bei kaputter Sortierung grün bleiben. Beweiskräftig ist nur eine absichtlich unsortierte Fixture **oder** ein Klick auf die Gegenrichtung. Gilt für alle drei Kräfteseiten.
- **Ein Filtertest mit einer einzeiligen Fixture.** Filtern auf den einzigen Wert lässt die einzige Zeile stehen — auch ohne Filterlogik. Jede Filter-Fixture braucht **mindestens zwei Zeilen mit verschiedenen Werten** und prüft, dass die andere **verschwindet**.
- **Der Zufluss-Test ohne Fokus-Gegenprobe** (§B1.1): friert die Sicht *immer* ein, bleibt er grün. Die Gegenprobe „ohne Fokus ordnet sich sofort neu" ist Pflicht.
- **`useViewport.guard.test.ts` bindet mich**: `MARKE = /matchMedia|\buseBreakpoint\b/` (`:75`) mit dateiweiser Allowlist aus drei Einträgen (`:78-85`). Weder `AmpelZelle` noch eine meiner vier Seiten darf `Grid.useBreakpoint()` oder `window.matchMedia` anfassen — die Breitenfrage kommt ausschließlich aus `Datensicht`. Zweite Falle desselben Guards: er meldet **tote** Allowlist-Einträge (`:161-163`).
- **Der Vitest-matchMedia-Stub kennt keinen Sender für Breiten-Ereignisse** (nur `sendeZeigerAenderung`, `test/viewport.ts:137`). Ein Umschalten Tabelle↔Karte **zur Laufzeit** ist in Vitest nicht prüfbar; baulich zugesichert wird es durch „genau ein Zweig im Baum", gemessen wird es in Playwright.

### 3.7 Der Tabellenzweig hat **keine** Gruppenköpfe — Teil 1 sagt „Zähler im Gruppenkopf"
Nach §5/§9(8) wird die Gruppenachse im Tabellenzweig zur **führenden Sortierachse** plus **Zählerstreifen in der Werkzeugzeile**; echte Gruppenköpfe gibt es nur im Kartenzweig unter 768 px. Bei Fükw- und Tablet-Breite existiert also kein Gruppenkopf. Das muss dastehen, weil der wahrscheinliche Fehler ist, dass jemand synthetische `colSpan`-Gruppenzeilen in eine Tabelle einzieht, deren Spalte 0 **unbedingt** `fixed:'left'` trägt (`KatalogTabelle.tsx:58-62`) — genau die ungeprüfte antd-Kombination, die §9(8) vertagt.

### 3.8 Zwei ID-Räume beim Status
Der Zeilen-`Select` schreibt `status_id` aus dem **Mandanten**-Katalog (`FahrzeugePage.tsx:280`, `PersonalPage.tsx:219`); Gruppierung und Filter laufen über die **Kategorie** (3 Vertragswerte + `ohne`). Ein Filter auf `status_id` filterte je Mandant anders und stimmte nicht mit den Gruppen überein. `KATEGORIE_WERTE` ist die einzige Quelle.

---

## 4. Verifikation

Absolute Pfade, weil das Arbeitsverzeichnis zwischen Aufrufen zurückgesetzt wird; `rtk proxy` für ehrliche Exit-Codes.

```bash
W=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive

# (1) gescopte Vitest — nach jedem Schritt
rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$W/frontend" exec vitest run \
  src/kraefte/statusAchse.test.ts \
  src/kraefte/AmpelZelle.test.tsx \
  src/kraefte/kraeftebild.test.ts \
  src/pages/KraefteuebersichtPage.test.tsx \
  src/pages/FahrzeugePage.test.tsx \
  src/pages/PersonalPage.test.tsx \
  src/pages/MaterialPage.test.tsx

# (2) die Guards, die dieses Bündel binden
rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$W/frontend" exec vitest run \
  src/components/useViewport.guard.test.ts \
  src/components/katalogTabelle.guard.test.ts \
  src/components/feldbreiten.guard.test.ts \
  src/theme/gate5.guard.test.ts \
  src/theme/statusFarben.test.ts \
  src/components/KatalogTabelle.test.tsx

# (3) Lint (--max-warnings 0) und Typecheck
rtk proxy mise exec pnpm@11.10.0 -- pnpm -C "$W/frontend" lint
rtk proxy "$W/scripts/check-typ-codegen.sh"

# (4) e2e — vom Repo-Root, braucht target/debug/lifeline-hub
cd "$W" && rtk proxy mise exec pnpm@11.10.0 -- pnpm -C frontend exec playwright test \
  e2e/gate1-ueberlauf.spec.ts e2e/datensicht-schmal.spec.ts e2e/kraefte-meldebild.spec.ts \
  e2e/katalogtabelle-schmal.spec.ts e2e/nav-schmal.spec.ts e2e/deeplinks-smoke.spec.ts e2e/command-palette.spec.ts

# (5) Sammel-Gate zum Schluss, aus dem Repo-Root
cd "$W" && rtk proxy ./scripts/check-all.sh
```

Zwei Bedingungen, die still versagen:
- **`check-all.sh` muss aus dem Repo-Root laufen** — aus `frontend/` heraus gibt es Exit 127 bei leerem Log, was wie Erfolg aussieht (B1-Lektion).
- **Schritt 7 überspringt ohne `target/debug/lifeline-hub` mit Exit 0.** Praktisch baut Schritt 4 (`cargo test --workspace`) es mit; ein verkürzter Lauf verliert die e2e-Abdeckung lautlos. Und: stammt `target/debug` aus einem `bacon`-Lauf mit `--features dev-seeds`, sind 18/18 e2e rot (Login) — dann `cargo build` ohne Features.
- Die volle Vitest-Suite nur mit `--no-file-parallelism` (so fährt sie `check-all.sh` Schritt 5); parallel ist sie unter Last flaky.

---

## 5. Was dieses Bündel NICHT liefert

1. **`components/Datensicht.tsx` selbst.** Fremdes Paket (§0.1). Bündel IV liefert stattdessen drei rote Konsumententests, die die drei Vertragslücken einklagen.
2. **Die Gruppenköpfe im Tabellenzweig** (§3.7) — führende Sortierachse + Zählerstreifen, keine synthetischen `colSpan`-Zeilen. Ein Browsernachweis für `colSpan` × `fixed:'left'` fehlt; → eigenes Ticket.
3. **In-Zeile-Bedienung im Kartenzweig.** Unter 768 px verlieren die drei Seiten: die zwei `Select` von PersonalPage (`:193-209` Position, `:210-225` Status), FahrzeugePages Status-`Select` (`:271-286`), MaterialPages `MengeZelle` (`:30-47`), alle drei inline editierbaren Bemerkungen und FahrzeugePages `BesatzungsBlock` samt Frei-Pool-Picker und Freigeben-Knopf (`:110-157`, `aufklappzeile` läuft nur im Tabellenzweig). Der Verlust ist **real**, weil es für Personal und Fahrzeuge keine Detailroute gibt. → **B5 (LFH-333)** holt den Statuswechsel ohnehin aus der 24-px-Zelle in einen Quick-View; dann passt er in den Aktionsslot.
4. **`BesatzungsStaerkeBadge` bleibt auf antd-Preset-Farben** (`FahrzeugePage.tsx:90-102`, `blue`/`green`/`red`). Der Umbau auf `StatusTag` brach fünf Assertionen (`:131,142,152-153,166,175-176`) und wäre der Bestands-Sweep, den A2 verbietet. Zweiter Kanal ist heute die Soll-Klammer + `title`. → Folgeticket „modul-lokale Farbmaps in den A2-Vertrag", zusammen mit `MaterialPage.STATUS_META` (`:18-24`) und `MAT_STATUS_ANZEIGE` (`KraefteuebersichtPage.tsx:53-59`).
5. **`MitgliederAbschnitt.tsx`** — E3: `MitgliedAnzeige` hat 5 Felder, weder Träger noch Status; es ist eine Zugriffsliste, kein Kräfte-Modul. Nur Überlaufschutz, und der gehört zu E4, nicht hierher.
6. **MaterialPage bleibt ohne `EinsatzSeite`-Rahmen** (`:186-222` rohes `div` + eigener Breadcrumb/`Spin`/`Alert` statt `SeitenSkeleton`/`SeitenFehler`). Rahmenumbau ist nicht beauftragt. → eigenes Ticket.
7. **Sortier-/Filterzustand ist nicht deeplinkbar und überlebt keine Navigation** (§4/§9 der API-Festlegung: kein `localStorage`, kein `?sort=`). Das Deeplink-Muster des Repos reserviert Query-Params für Selektion. → eigenes Ticket, gemeinsam mit einer Sicht-Registry nach dem Muster von `api/queryKeys.ts`.
8. **Kriterium 2 (Handschuh ≥ 72 px)** — kein `size`-Prop im Bündel, Höhen hängen am Dichte-Token; die Staffel selbst kommt in **B5 (LFH-333)**. **Kriterium 3** (Lade-/Fehlerweiche) → **B3 (LFH-331)**. **Kriterium 8** (Helligkeitsregler) → nicht anwendbar/Folge-Task, wie in beiden B1-Prüflisten. **Kriterium 12s Banner-Gestaltung und „Stand hh:mm"** → **B6 (LFH-334)**; hier entsteht nur der Mechanismus.
9. **Der `size="small"`-Bestand.** Abgebaut werden nur die zwei ohnehin angefassten Stellen in `MaterialPage` (`:148`, `:177`); `MengeZelle` (`:41`) bleibt. Der Rest ist LFH-333/B5. Es gibt dafür **kein Gate** — gemessen 151 Vorkommen und kein `*.guard.test.ts`, das `small` erwähnt; das Verbot ist Konvention, und eine neue Filterleiste mit Select/Search ist genau die Stelle, an der jemand danach greift.
10. **Die zweite Bestätigung für „In Lagebericht übernehmen"** (`KraefteuebersichtPage.tsx:180-192`, `:237`) — legt einen Lagebericht an und patcht ihn ohne Rückfrage, und ein fehlgeschlagener PATCH hinterlässt laut Kommentar `:185-186` einen leeren Entwurf. Kriterium 4, aber ein eigener Befund. → eigenes Ticket.
11. **`MeldebildZeile.soll` / `Verdichtung.soll`** (`kraeftebild.ts:36`, `:47`) werden berechnet und nirgends gerendert. Ein Soll/Ist-Vergleich ist verlockend und gehört nicht hierher.
12. **Ein Nachtrag von `KraefteuebersichtPage` in die 13er-Liste von `katalogTabelle.guard.test.ts`** — dieselbe handgepflegte Liste (`:39-53`, `toHaveLength(13)` `:101`) wollen drei Pakete anfassen; sie braucht **einen** benannten Eigentümer, und der ist nicht Bündel IV. Die Kopplung meiner Seiten an die unbedingte Fixierung von Spalte 0 macht der **neue** `datensicht.guard.test.ts` sichtbar, nicht der alte.
13. **Die Klippen-Blindstelle von Gate 1** (`gate1-ueberlauf.spec.ts:57-85`: jedes `overflow-x: hidden` an einem Vorfahren nimmt den Überlauf aus der Wurzelmetrik) bleibt offen. Ich füge Routen hinzu, ich repariere das Maß nicht.