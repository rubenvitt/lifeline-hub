# Bündel V — Gates, e2e, Prüfliste, Doku (Nachlaufstufe)

# Umsetzungsplan — Bündel V (Gates, e2e, Prüfliste, Doku) · LFH-330 · B2

Alle Pfade absolut ab Worktree-Wurzel `/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive`.

## 0. Am Code nachgeprüft — Korrekturen an den Vorgaben, bevor irgendetwas gebaut wird

| Vorgabe | Gemessen | Konsequenz |
|---|---|---|
| §9.10: „13er-Inventar wächst auf **18**", fünf Dateien genannt | 16 Konsumentendateien, 17 rohe `<Table>`-Stellen (`pages/PersonenPage.tsx` 2×). Aufteilung nach E3/E5/§5/§8: **9 Datensicht** (BefehlListe, FahrzeugePage, KraefteuebersichtPage, LageberichtePage, MaterialPage, PersonalPage, PersonenPage, TierePage, uhs/BewegungenTab) · **6 KatalogTabelle** (BereitstellungsraeumePage, MitgliederAbschnitt, PersonenDetailPage, SchaedenPage, uhs/MaterialTab, UnfallhilfsstellenPage) · **1 Ausnahme** (GefahrenMatrix) | Inventar wächst auf **19**, nicht 18. §9.10 hat fünf gezählt, `LageberichtePage` fälschlich eingerechnet (E5/§8 schicken sie auf `form="karte"`) und `MitgliederAbschnitt` + `uhs/MaterialTab` vergessen. **Steht als Korrektur im Guard-Kopfkommentar**, sonst rechnet der nächste Leser 18 gegen 19 und rät. |
| Advisor-Prüfauftrag: Container-Scroll bei den zwei „stillen" Neuzugängen | `pages/MitgliederAbschnitt.tsx:124` steht in einem `<section>` innerhalb `pages/EinsatzdatenPage.tsx:248` — **Seitenfluss, kein Drawer**. `pages/PersonenDetailPage.tsx:511` steht in einem nackten `<div>` innerhalb eines `<Space>` — **ebenfalls Seitenfluss**. | `sticky` (fensterbezogen) wirkt in beiden. Keine Caveat-Zeile nötig. `MitgliederAbschnitt` trägt `size="small"` **am `<Table>`** (:126) — Bestand, kommt durch `KatalogTabelleProps` unverändert durch, Abbau ist B5. |
| `pages/gefahren/GefahrenMatrix.tsx` | 94 Zeilen; `:92` setzt **schon** `scroll={{ x: 'max-content' }}`, `:53` **schon** `fixed: 'left'` + `width: 180`. Fehlt nur `sticky`. Tests (`GefahrenMatrix.test.tsx`) fahren `renderMitProviders` und sichern **keine** Tabellenstruktur zu. | Migration wäre 2 Zeilen — **ich mache sie nicht** (fremde Datei, Flächencodierung statt Listenvergleich). Sie wird **deklarierte Ausnahme mit Totmeldung**: migriert sie jemand, meldet der Guard den toten Eintrag und erzwingt seine Streichung. |
| AP8: „AK (c) ist heute grün" | Kritik §4(1) ist präziser: `sorter` = 0, `filters:` = 0, `defaultSortOrder` = 0, `Input.Search` = 3 (`etb/EtbFilterleiste.tsx:39`, `pages/SchaedenPage.tsx:126`, `pages/KraefteuebersichtPage.tsx:324`), keines davon in einer der Zieldateien | AK 3 ist **heute rot und nach B2 unerfüllbar** — beides. Neuformulierung in §6 unten. |
| `pages/KraefteuebersichtPage.tsx` | `<Table<MeldebildZeile>` **:333** ✓, `Input.Search style={{ width: 220 }}` **:324** ✓, `Statistic title="Personal"` **:249** / `"Fahrzeuge"` **:256** ✓, Kennzahlen-Card `styles={{ body: { overflowX: 'auto' } }}` **:243** + `flexWrap:'nowrap'` **:245** ✓. Filter-Card `:294` mit `Space wrap` | Die Kennzahlenleiste ist ein **eigener Bildlaufbesitzer** — `gate1-ueberlauf.spec.ts:95-101` weist sie als `[eigener Bildlauf]` aus und meldet sie nicht. Der Überlauf-Kandidat ist allein die Tabelle. |
| `pages/AuftraegePage.tsx:37-51` | `<Tabs defaultActiveKey="auftraege">` **ohne `forceRender`**, **ohne URL-Param** | Ein `goto('/einsaetze/:id/auftraege')` misst den **Aufträge**-Tab. Die Befehle-Liste ist nicht im Baum. Die `routen`-Schleife braucht einen Vorbereitungsschritt. |
| Z13-Vorbild im Repo | `press(`/`keyboard.` trifft ausschließlich `frontend/e2e/command-palette.spec.ts`. `'Tab'` = **0 Treffer** in `frontend/e2e/` | Neubau, kein Muster zum Kopieren. Deshalb trägt der Spec einen **Positivnachweis** (§2 Schritt 1c). |
| `page.request` / API-Seeding in e2e | **0 Vorkommen** in `frontend/e2e/`. Session ist Cookie-basiert (`api/client.ts:35/46/56` `credentials: 'same-origin'`) → `page.request` teilt den Cookie-Jar des Kontexts | Neues Muster, braucht Begründung im Dateikopf. Body-Formen am API-Modul verifiziert: `POST /api/benutzer` `{anzeigename,benutzername,passwort}` (`api/benutzer.ts:8-17`), `POST /api/einsaetze/{id}/personal` `{adhoc:{name,funktion?,traegerorganisation?}}` (`api/einsatzPersonal.ts:7-12/29-31`), `POST /api/einsaetze/{id}/befehle` `{vorlage,titel}` (`api/befehle.ts:12-20`, gültiger Schlüssel `befehl_lad` aus `BefehlListe.tsx:68`). |
| Listenform-Regel-Doku | `CLAUDE.md:57-61` trägt sie **schon** (von A1 eingezogen), inkl. „Karten-Fallback ist die Ausnahme mit Begründung im Task" (`:61`). `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md:56-64` (AK3-Tabelle) trägt sie **nicht** | **Nur** der Drawer-Spec wird ergänzt. Kein Doppelschreiben in CLAUDE.md. |
| Kollision mit `e2e/katalogtabelle-schmal.spec.ts` bei Benutzer-Seeding | Alle dortigen Zusicherungen sind **abgeleitet**, nicht literal: `:135` `restweg > 50` (waagerecht, unberührt), `:184` `toBeCloseTo(ziel)` mit `ziel = kopfVor.y + 20`, `:192` `> hoeheVor`, `:200` `<= 1`. Mehr Zeilen erhöhen die Bildlaufreserve → macht sie **sicherer** | Kein Konflikt. Nur die **Zahlen in den Kommentaren** (`:134` „gemessen 206 px", `:160-165` „Dokument 884 px hoch") werden ungenau. Ich fasse die Datei nicht an; die Ungenauigkeit steht als benannter Nebenbefund im Kopf von `fokus-verdeckung.spec.ts`. |

---

## 1. Reihenfolge der Schritte

Die Stufe ist Nachlauf — aber **nicht durchgehend**. Schritt 1 hängt an keiner Zeile B2-Code und läuft **zuerst**, vor jedem anderen Bündel. Schritt 2 (a) läuft ebenfalls sofort. Alles Übrige folgt der Migration.

### Schritt 1 — Z13: `frontend/e2e/fokus-verdeckung.spec.ts` (NEU, der einzige echt rot-fähige Schritt)

Erst der Test, und er ist **heute** lauffähig, weil `docs/…/2026-07-28-katalogtabellen-pruefliste.md:36/65` Z13 mit genau dieser Begründung an B2 delegiert hat: *„genau dieses Paket zieht eine fixierte Kopfzeile und eine fixierte erste Spalte ein"* — das Konstrukt existiert seit B1 in `components/KatalogTabelle.tsx:74` und ist auf `/admin/benutzer` erreichbar.

Dateiname ohne `z13-`-Präfix: `gate1-` im Bestand bezeichnet ein **Gate** der Leitlinie, Z13 ist eine **Prüflistenzeile**. Der Kopf nennt die Zeile.

**1a — der Messkern (`pruefeFokusVerdeckung`)**

```ts
/** WCAG 2.4.11: ein fokussiertes Ziel darf nicht VOLLSTÄNDIG von autoreneigenem
 *  Inhalt verdeckt sein. Gemessen wird gegen jeden Knoten mit `position: sticky|fixed`,
 *  nicht gegen einen benannten Selektor: der Kopfhalter heißt bei antd
 *  `.ant-table-sticky-holder`, die fixierte Spalte `.ant-table-cell-fix-start`, und ein
 *  dritter Kandidat käme unbenannt dazu. */
async function pruefeFokusVerdeckung(page: Page, schritte: number): Promise<{
  verdeckt: string[]; stoppsInTabelle: number; stoppsGesamt: number;
}>
```

Ablauf je Schritt: `page.keyboard.press('Tab')`, dann in **einem** `page.evaluate`:
`const ziel = document.activeElement` → `getBoundingClientRect()`; über `document.querySelectorAll('*')` alle Knoten mit `getComputedStyle(el).position === 'sticky' || 'fixed'` sammeln, die **nicht** Vorfahr des Ziels sind; „vollständig verdeckt" = Zielrechteck liegt ganz im Rechteck eines solchen Knotens **und** `getComputedStyle(knoten).visibility !== 'hidden'` **und** dessen `z-index`-Stapel liegt darüber (pragmatisch: Verdeckung per `document.elementFromPoint(mittelpunkt)` gegengeprüft — liefert der Punkt nicht das Ziel oder einen seiner Nachfahren, ist es verdeckt). Beides zusammen, weil Rechteck-Enthaltensein allein bei transparenten Sticky-Hüllen falsch positiv ist und `elementFromPoint` allein bei einem Ziel mit einem Pixel Überstand falsch negativ.
`stoppsInTabelle` zählt Stopps mit `ziel.closest('.ant-table')`.

**1b — Test „Katalogtabelle: Tab-Durchlauf hinter Kopfzeile und fixierter Spalte"** (`/admin/benutzer`, 390 × 400)

Warum `/admin/benutzer` und nicht `stammdaten/QualifikationenTab`: Qualifikationen kostet weniger Seeding (**ein** Pflichtfeld, `stammdaten/QualifikationenTab.tsx:108`), trägt aber nur **3** Spalten — die fixierte Spalte hat dort keinen waagerechten Bildlaufweg und die halbe Zusicherung wäre leer. `/admin/benutzer` trägt 6 Spalten mit **gemessenen 206 px** Restweg (`katalogtabelle-schmal.spec.ts:134`) und **zwei** fokussierbare Knöpfe je Zeile.

Vorbedingungen als **Zusicherungen**, nicht als Setup (Muster `katalogtabelle-schmal.spec.ts:135/184/189-192`):

```ts
const LAUF = Date.now();
for (let i = 0; i < 8; i += 1) {
  const r = await page.request.post('/api/benutzer', { data: {
    anzeigename: `E2E Fokus ${LAUF}-${i}`, benutzername: `e2e-fokus-${LAUF}-${i}`,
    passwort: 'e2e-fokus-pw-123',
  }});
  expect(r.ok(), `Seeding Benutzer ${i}: ${r.status()} ${await r.text()}`).toBeTruthy();
}
await page.goto('/admin/benutzer');
await expect(page.locator('tr.ant-table-row')).toHaveCount(9);          // 8 + Harness-Admin
const reserve = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
const kopfHoehe = (await page.locator('.ant-table-sticky-holder').boundingBox())!.height;
expect(reserve, 'Vorbedingung: Bildlaufreserve muss die Kopfzeile überschreiten')
  .toBeGreaterThan(kopfHoehe);
```

Erst danach `pruefeFokusVerdeckung(page, 60)`, dann:

```ts
expect(ergebnis.stoppsInTabelle,
  'Vorbedingung: der Durchlauf muss überhaupt in der Tabelle landen').toBeGreaterThanOrEqual(4);
expect(ergebnis.verdeckt, `Fokusziele vollständig verdeckt:\n${ergebnis.verdeckt.join('\n')}`)
  .toEqual([]);
```

Ohne `stoppsInTabelle ≥ 4` wäre eine Tabelle **ohne** fokussierbare Zellen grün, indem der Durchlauf an ihr vorbeiläuft. Ohne `reserve > kopfHoehe` kann keine Zeile unter den Kopf wandern und die Aussage ist leer. **Beide sind die Falle, nicht die Kür.**

**1c — Test „Selbstbeweis: eine erfundene Verdeckung wird gemeldet"** (der Ersatz für „rot vor grün")

Ob 1b heute rot ist, ist offen — genau deshalb braucht der Messkern einen Positivnachweis:

```ts
await page.addStyleTag({ content: `
  .e2e-verdecker { position: fixed; inset-block-start: 0; inset-inline: 0;
                   block-size: 100vh; background: #000; z-index: 2000; }` });
await page.evaluate(() => document.body.append(
  Object.assign(document.createElement('div'), { className: 'e2e-verdecker' })));
const probe = await pruefeFokusVerdeckung(page, 10);
expect(probe.verdeckt.length, 'der Messkern muss eine echte Verdeckung finden')
  .toBeGreaterThan(0);
```

Dieser Fall ist **jetzt** rot, solange `pruefeFokusVerdeckung` nicht existiert oder falsch rechnet, und er ist von B2-Code unabhängig. Er ist der Beweis, dass 1b/1d etwas messen — genau die Rolle, die `katalogTabelle.guard.test.ts:122-135` im Vitest spielt.

**1d — Test „Datensicht-Tabellenzweig: Tab-Durchlauf" (nach Bündel Personal/Fahrzeuge)**

Eigener Einsatz, eigenes Seeding, **keine** Verschmutzung fremder Specs:

```ts
const einsatzId = await einsatzAnlegen(page, `E2E Fokus B2 ${Date.now()}`);
for (…12×…) await page.request.post(`/api/einsaetze/${einsatzId}/personal`,
  { data: { adhoc: { name: `Kraft ${i} …`, funktion: '…', traegerorganisation: '…' } } });
await page.setViewportSize({ width: 1366, height: 520 });   // Tabellenzweig + Reserve
await page.goto(`/einsaetze/${einsatzId}/personal`);
```
Gleiche Vorbedingungen, gleiche Zusicherung, zusätzlich `await expect(page.locator('.ant-table')).toHaveCount(1)` (belegt, dass hier wirklich der Tabellenzweig läuft und nicht der Kartenzweig gemessen wird).
Zusätzlich **Spaltenschalter und Sortierauslöser** als Fokusziele: `expect(ergebnis.stoppsInTabelle).toBeGreaterThanOrEqual(8)`.

**Verdikt-Gabel — vorab entschieden, damit sie nicht unter Zeitdruck weichgelesen wird:**
- 1b und 1d grün → Z13 in der neuen Prüfliste **„erfüllt"**, Beleg = dieser Spec; die Zeile `Z13 → B2` in `2026-07-28-katalogtabellen-pruefliste.md:65` wird **nicht** gestrichen, sondern bekommt einen Verweis „eingelöst in `2026-07-28-einsatzlisten-pruefliste.md`" (eine gepinnte Zeile wird nicht entsorgt, sie wird quittiert).
- 1b rot → Ursache ist der fehlende Fokus-Bildlaufabstand hinter `sticky`. Reparatur gehört **in dieses Paket**, weil sie eine Zeile CSS ist und `KatalogTabelle` betrifft: `scroll-margin-block-start` in der Höhe des Kopfhalters an `tr.ant-table-row td`. Diese eine Zeile fällt dann in `theme/`-/Primitiv-Eigentum → **Übergabe an das Primitiv-Bündel mit Zahl** (gemessene Kopfhöhe), nicht an B7. Verdikt bleibt bis dahin **„offen → B2"** mit benannter Reparatur.
- 1d rot, 1b grün → Datensicht-eigene Ursache (Werkzeugzeile als zweiter Sticky-Knoten). Verdikt **„offen → B2"**, Befund mit gemessener Zahl an das Primitiv-Bündel.
- Die **Drawer-Hälfte** derselben Zeile bleibt in jedem Fall **B7 (LFH-335)** — `2026-07-28-rahmen-pruefliste.md:47/90` trennt das ausdrücklich, und wer Z13 abhakt, muss sagen, welche Hälfte er meint.

### Schritt 2 — `frontend/src/components/katalogTabelle.guard.test.ts` (Eigentümerschaft)

Ich bin der **eine** Eigentümer dieser Datei (Kritik §6: drei Bündel wollen sie). Kein anderes Bündel fasst sie an; Inventar-Einträge werden **über mich** bestellt.

**2a — die repoweite Schließung, sofort, mit Burn-down-Liste** (rot-zuerst je Datei, ohne Rot-Plateau)

Neu in der Datei, nach dem Muster `useViewport.guard.test.ts:88-99/143-165/179-184` **kopiert, nicht importiert** (ein Import aus einer anderen `*.test.ts` registriert deren `describe` doppelt — im Repo dreifach so begründet):

```ts
/** Alle `*.ts`/`*.tsx` unter `src/`, Schlüssel RELATIV wie in KATALOGTABELLEN
 *  (`components/KatalogTabelle.tsx`) — bewusst NICHT im `/src/…`-Stil von
 *  useViewport.guard: zwei Pfadkonventionen in einer Datei driften auseinander. */
function lieseQuellen(verzeichnis: string, praefix = ''): Record<string, string>

/** Begründete Ausnahmen von der Schließung. Ein Eintrag ohne Fundstelle wird als
 *  TOT gemeldet — wer die Datei migriert, streicht ihn. */
const BEGRUENDETE_AUSNAHMEN = [
  { pfad: 'pages/gefahren/GefahrenMatrix.tsx',
    grund: 'Flächencodierung Gefahrentyp × Schutzobjekt, kein Listenvergleich. Setzt ' +
           'Bildlauf und Spaltenfixierung selbst (:53/:92), es fehlt nur die stehende ' +
           'Kopfzeile. Migration ist ein Zweizeiler und gehört nicht in LFH-330.' },
] as const;

/** Noch nicht migriert. SCHRUMPFT mit jeder Migration; ein toter Eintrag wird
 *  gemeldet. Am Ende leer — dann fällt die Liste weg. */
const NOCH_OFFEN: string[] = [ /* 15 Pfade, Startzustand */ ];

export function rohTabellen(dateien: Record<string, string>, frei: readonly string[]): string[]
export function scrollSetzer(dateien: Record<string, string>, frei: readonly string[]): string[]
```

Beide Funktionen: `*.test.*` und `*.generated.*` überspringen (`useViewport.guard.test.ts:148-149`), Kommentare strippen, `elementMuster('Table')` bzw. `SCROLL_MUSTER` zählen, Fundstellen außerhalb `frei = ['components/KatalogTabelle.tsx', …AUSNAHMEN, …NOCH_OFFEN]` melden **und tote Freistellungen melden**.

Drei neue Testfälle:
1. `it('rohes <Table> lebt nur im Primitiv (repoweite Schließung)')` → `expect(rohTabellen(dateien, frei)).toEqual([])`. **Wirkung:** jede Migration streicht einen `NOCH_OFFEN`-Eintrag; wer die Datei migriert, aber den Eintrag stehen lässt, bekommt „tote Freistellung" — die Liste kann nicht veralten. Wer eine **17.** Tabelle neu anlegt, fällt sofort auf — das schließt die im Kopf der Datei dokumentierte **Grenze 1** („eine vierzehnte Katalogseite fällt hier NICHT auf"), die bisher als Vertragsbestandteil offen war.
2. `it('den waagerechten Bildlauf setzt nur das Primitiv (repoweit)')` → `expect(scrollSetzer(dateien, ['components/KatalogTabelle.tsx', 'pages/gefahren/GefahrenMatrix.tsx'])).toEqual([])`. **Nebenwirkung, die §8 verlangt und die ich ohne fremden Schreibpunkt bekomme:** ein `components/Datensicht.tsx`, das sein eigenes `scroll={{ … }}` setzt, wird hier rot — ohne dass ich `datensicht.guard.test.ts` anfasse.
3. `it('Sentinel: mehr als 200 Dateien gescannt')` → `expect(Object.keys(dateien).length).toBeGreaterThan(200)` **plus** `expect(dateien['components/KatalogTabelle.tsx'] ?? '').not.toBe('')`. Ohne diesen Fall macht eine falsch aufgelöste Wurzel beide Schließungen still grün — der wahrscheinlichste Weg, wie diese Zusicherung wertlos wird.

Zwei Selbstbeweisfälle dazu (der bestehende `:122-135` bleibt **unangetastet**):
4. `it('Selbstbeweis: eine erfundene rohe Tabelle wird gemeldet')` — synthetischer Baum, kein Dateisystem.
5. `it('tote Freistellungen werden gemeldet')` — Baum ohne Fundstelle, `frei` mit Eintrag.

**2b — Inventar von 13 auf 19, ein Eintrag je Migrations-Commit**

`KATALOGTABELLEN` bekommt sechs Zeilen, `toHaveLength(13)` → `toHaveLength(19)`:
```
'pages/bereitstellungsraum/BereitstellungsraeumePage.tsx',
'pages/MitgliederAbschnitt.tsx',
'pages/PersonenDetailPage.tsx',
'pages/SchaedenPage.tsx',
'pages/uhs/MaterialTab.tsx',
'pages/UnfallhilfsstellenPage.tsx',
```
Jeder Eintrag wandert im **selben Commit** wie die Migration seiner Datei hinein (und derselbe Commit streicht ihren `NOCH_OFFEN`-Eintrag). Damit ist es je Datei rot-zuerst, und `check-all.sh` Schritt 5 hat **kein** Rot-Plateau für die parallel arbeitenden Bündel — das war die konkrete Gefahr der Eigentümerkollision.

**2c — Abschluss** (letzter Commit des Tickets): `NOCH_OFFEN` ist leer → Liste und ihre Verwendung entfernen, dafür `expect(BEGRUENDETE_AUSNAHMEN).toHaveLength(1)` pinnen. Erst dann ist die Schließung unbedingt. Beweis, dass sie greift: **Mutationsprobe**, eine Migration zurückdrehen, Testlauf muss rot werden, Ergebnis mit Datei und Fundstelle im Kopfkommentar protokollieren — das ist die Beweisform, die dieses Repo akzeptiert (`katalogtabelle-schmal.spec.ts:90-98`).

**2d — Querverweis in `frontend/src/components/KatalogTabelle.tsx`** (E2, eine Zeile, mein einziger Eingriff in fremden Produktivcode): der Absatz `:27-29` („Kein Spaltenschalter…") bekommt den Satz, dass der Schalter mit Zähler in `components/Datensicht.tsx` sitzt und das Z14-Verdikt der dreizehn **„nicht anwendbar"** bleibt (max. sieben Spalten). Wird mit dem Primitiv-Bündel abgestimmt, weil es dieselbe Datei liest — Schreibkonflikt vermeidbar, indem der Satz erst nach `Datensicht.tsx` landet.

### Schritt 3 — `frontend/e2e/gate1-ueberlauf.spec.ts` erweitern

**3a — Basislinie GEGEN HEAD, vor jeder Migration.** Die drei Zeilen samt Seeding und Ankern hinzufügen und **einmal laufen lassen, solange noch kein B2-Code existiert**; die Messwerte je Route × Breite als `test.info().annotations` protokollieren (Muster `lage-dashboard-schmal.spec.ts:88-97`). Begründung: meine Analyse sagt, dass alle drei Routen heute grün sind, weil ein rohes antd-`<Table>` ohne `scroll` mit `table-layout: auto` den Inhalt **quetscht** statt die Seite zu drücken. Das ist plausibel und **unbelegt** — es wird gemessen, nicht behauptet. Ohne diese Basislinie sagt der Lauf nach der Migration nichts.

**3b — die Struktur.** Der `routen`-Literaltyp bekommt einen optionalen Schritt, weil der Befehle-Tab ohne Klick nicht im Baum ist:

```ts
type Route = { pfad: string; anker: (p: Page) => Locator; vorbereiten?: (p: Page) => Promise<void> };
```
Aufgerufen in der Schleife **nach** `goto` und **vor** dem Anker (`Tabs` setzen bei jedem `goto` auf `defaultActiveKey` zurück, der Schritt läuft also je Breite erneut).

**3c — Seeding, weil eine leere Liste nicht überlaufen kann.** Der frisch angelegte Einsatz hat 0 Personal, 0 Kräfte, 0 Befehle; ein 390-px-Überlauftest auf drei Leerzustände ist grün durch Nichtstun. Nach `einsatzAnlegen`, vor der Schleife, mit **absichtlich langen** Werten (etablierte Form: `kopfzeile-schmal.spec.ts:72-91` prüft die Kopfzeile mit absichtlich langem Einsatznamen):

```ts
async function seedeUeberlaufstoff(page: Page, einsatzId: string) {
  const p = await page.request.post(`/api/einsaetze/${einsatzId}/personal`, { data: { adhoc: {
    name: 'Kirchgassner-Wohlfahrt, Maximiliane',
    funktion: 'Abschnittsleitung Technische Hilfeleistung',
    traegerorganisation: 'Freiwillige Feuerwehr Musterstadt-Nordwest',
  }}});
  expect(p.ok(), `Seeding Personal: ${p.status()} ${await p.text()}`).toBeTruthy();
  const b = await page.request.post(`/api/einsaetze/${einsatzId}/befehle`,
    { data: { vorlage: 'befehl_lad', titel: 'Befehl an den 2. Zug zur Menschenrettung im Abschnitt Nord' } });
  expect(b.ok(), `Seeding Befehl: ${b.status()} ${await b.text()}`).toBeTruthy();
}
```
Die Ad-hoc-Person erscheint im Meldebild über den Sammelknoten „Ohne Abschnitt" (`kraefte/kraeftebild.ts:575-612`, `hasOhne` über `ohneEinheitPersonal`) — die Kräfteübersicht ist damit ebenfalls nicht leer.

**3d — die drei Zeilen, Anker form-agnostisch.** `tr.ant-table-row` ist als Anker **falsch**, weil Personal bei 390 px nach B2 Karten rendert und die Zeile den Kartenzweig gar nicht sieht. Gemessen wird auf gesäten Textinhalt, mit `toHaveCount(1)` vor jeder Zusicherung (`kopfzeile-schmal.spec.ts:60-62`; ein gesäter Name kann Kartentitel **und** Sekundärfeld treffen):

```ts
{ pfad: `/einsaetze/${einsatzId}/personal`,
  anker: (p) => p.getByText('Kirchgassner-Wohlfahrt, Maximiliane').first() },
{ pfad: `/einsaetze/${einsatzId}/kraefteuebersicht`,
  anker: (p) => p.getByText('Gesamtstärke (F/UF/M//Ges)') },        // Kennzahlenkopf, projektweit einmalig
{ pfad: `/einsaetze/${einsatzId}/auftraege`,
  vorbereiten: async (p) => {
    const tab = p.getByRole('tab', { name: 'Befehle' });
    await expect(tab).toHaveCount(1);           // antd klappt Reiter bei Enge in ein Mehr-Menü
    await tab.click();
  },
  anker: (p) => p.getByRole('link', { name: /Befehl an den 2\. Zug/ }) },
```
Für die Kräfteübersicht kommt **zusätzlich** ein Datenanker (`getByText('Ohne Abschnitt')`), weil der Kennzahlenkopf auch über einer leeren Tabelle steht — sonst misst die Zeile wieder einen Leerzustand.

**3e — Mutationsprobe und ihr Protokoll.** Nach der Migration `scroll={{ x: 'max-content' }}` in `components/KatalogTabelle.tsx:74` entfernen, den Spec laufen lassen, die realen Wurzelbreiten je Route notieren, zurückdrehen. Zahlen in den Kopfkommentar der `routen`-Erweiterung, in der Form von `katalogtabelle-schmal.spec.ts:90-98` („Seite real auf 498 px"). Ohne dieses Protokoll ist die Erweiterung eine Behauptung.

**3f — Was NICHT übernommen wird.** AK (a) nennt `document.body.scrollWidth <= window.innerWidth`. Diese Formel ist im Repo **viermal begründet verworfen** (`seitenrinne.spec.ts:17-19`, `kopfzeile-schmal.spec.ts:18-22`, `lage-dashboard-schmal.spec.ts:26-28`, `nav-schmal.spec.ts:78-90`), und `gate1-ueberlauf.spec.ts:64-70` begründet zusätzlich, warum `documentElement` gemessen wird. Die drei neuen Zeilen fahren das etablierte Maß `documentElement.scrollWidth - clientWidth` mit 1-px-Toleranz. **Die Abweichung von der AK wird im Ticket protokolliert, nicht stillschweigend gedreht.**

### Schritt 4 — `docs/superpowers/specs/2026-07-28-einsatzlisten-pruefliste.md` (NEU)

Erst nach Schritt 1–3, weil jedes Verdikt eine Fundstelle oder eine Messung zitiert. Aufbau wörtlich nach den zwei B1-Listen.

**Umfang — die von der Kritik/dem Advisor benannte Gate-7-Lücke wird hier geschlossen.** `2026-07-28-katalogtabellen-pruefliste.md:9-12` zählt exakt dreizehn Dateien auf; meine sechs Neuzugänge wären sonst umgebaute Seiten **ohne jede Prüfliste**. Die neue Liste führt deshalb **zwei Gruppen** namentlich:

- **Gruppe A — `Datensicht`-Konsumenten (9 Dateien, 10 Sichten):** `auftraege/BefehlListe.tsx`, `pages/FahrzeugePage.tsx`, `pages/KraefteuebersichtPage.tsx`, `pages/LageberichtePage.tsx`, `pages/MaterialPage.tsx`, `pages/PersonalPage.tsx`, `pages/PersonenPage.tsx` (2 Sichten), `pages/TierePage.tsx`, `pages/uhs/BewegungenTab.tsx`. Volle 15 Zeilen.
- **Gruppe B — nur Überlaufschutz (6 Dateien):** `pages/bereitstellungsraum/BereitstellungsraeumePage.tsx`, `pages/MitgliederAbschnitt.tsx`, `pages/PersonenDetailPage.tsx`, `pages/SchaedenPage.tsx`, `pages/uhs/MaterialTab.tsx`, `pages/UnfallhilfsstellenPage.tsx`. Diese **erben die Verdikte der Katalogtabellen-Familie durch Konstruktion** (dasselbe Primitiv, dieselben drei Merkmale) — als eigener Abschnitt mit Kreuzverweis auf `2026-07-28-katalogtabellen-pruefliste.md`, plus je Datei die eine Abweichung, wo es eine gibt (`MitgliederAbschnitt` und `uhs/MaterialTab` tragen `size="small"` am `<Table>` → Z1/Z2 dort **teilweise erfüllt → B5**).
- **Ausnahme:** `pages/gefahren/GefahrenMatrix.tsx` mit Begründung — Flächencodierung, nicht Liste.

Die 15 Verdikte kommen aus §9 der Entscheidung, mit **drei Änderungen**:
- **Z13** trägt das Ergebnis aus Schritt 1, nicht die Vorwegnahme „erfüllt". Die Gabel aus Schritt 1 ist die Regel.
- **Z14** nennt beide Gruppen getrennt: Gruppe A Tabellenzweig erfüllt / Kartenzweig nicht anwendbar / Meldebild `form="tabelle"` als **Begründung** der Nicht-Auflösung; Gruppe B wie die Katalogtabellen (Spaltenschalter **nicht anwendbar**, max. 7 Spalten).
- **Z1** zitiert die Trefflächenmessung aus `datensicht-schmal.spec.ts` (Primitiv-Bündel) **und** aus meinem `fokus-verdeckung.spec.ts` — steht das erste bei Schreibzeit nicht, ist das Verdikt „offen", nicht „erfüllt".

Abschnitt „Was offen bleibt": Zeilen als `Z…` geschrieben, **nicht** als `| 13 |` — Gate 7 zählt die Prüflistenzeilen über ihre führende Nummer, eine Zusammenfassung im selben Format zählt doppelt (in beiden B1-Listen so notiert, `:57-58` bzw. `:79-80`).

Ein eigener Abschnitt „**Karten-Ausnahme (E7)**" wiederholt die schriftliche Begründung aus dem Dateikopf von `Datensicht.tsx` — CLAUDE.md:61 verlangt sie „im Task", und eine Prüfliste, die den Regelbruch nicht nennt, verschweigt ihn.

### Schritt 5 — `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`

Genau **eine** Ergänzung, an der AK3-Tabelle `:56-64`, plus zwei Sätze Faustregel:

- Neue Zeile in der Formentabelle: **`Liste / Karte`** — *„Ein Datensatz wird als Einheit gelesen (kein Spaltenvergleich), oder der Schirm ist ~390 px breit. Träger ist `components/Datensicht.tsx` (`form: 'auto' | 'karte'`); pro Karte eine Titelzeile, höchstens drei Sekundärfelder, genau eine Primäraktion."*
- Neue Zeile: **`Tabelle`** — *„Es wird verglichen (NN/g). Träger ist `components/KatalogTabelle.tsx` bzw. `Datensicht` mit `form: 'tabelle'`; fixierte Kopfzeile, fixierte menschenlesbare Kennung, Spaltenschalter mit Zähler. Wird auf schmalem Schirm **angepasst**, nicht in Karten aufgelöst."*
- Zwei Sätze unter der Faustregel `:63-64`: die Trennlinie aus E7 (Vergleichsfläche bleibt Tabelle, Einheit-Datensatz wird Karte) und der Verweis, dass die **Kurzfassung** in `CLAUDE.md:57-61` steht.
- Absatz „**Verhältnis zu LFH-19**": die Achse hier ist Umfang/Interaktion (Route/Modal/Inline/Drawer), die neue ist Listenform. Sie schneiden sich nicht — eine Liste ist immer Seiteninhalt, nie Drawer-Inhalt. Ohne diesen Satz liest jemand die neuen Zeilen als fünfte und sechste Drawer-Alternative.

**Kein Schreiben in `CLAUDE.md`.** Geprüft: `:57-61` trägt die Regel inklusive Karten-Fallback-Ausnahme; A1 hat sie eingezogen. Aufgabenpunkt 2 der Task ist zur Hälfte erledigt, und ein zweiter Absatz wäre Doppelung.

### Schritt 6 — AK-3-Neuformulierung (Text, kein Code)

Siehe §6. Landet als Kommentar am ClickUp-Task **und** als Abschnitt „Akzeptanzkriterium 3 — Ist-Formulierung unerfüllbar, Ersatz" in der neuen Prüfliste, damit die Entscheidung durabel ist und nicht nur im Ticketverlauf steht.

---

## 2. Je Datei: was geändert wird, was bricht, wie es angepasst wird

### `frontend/e2e/gate1-ueberlauf.spec.ts` (196 Zeilen)
- **Neu:** `type Route` mit `vorbereiten?`; `seedeUeberlaufstoff(page, einsatzId)`; drei `routen`-Einträge (:152-163 → 7 Einträge); `vorbereiten`-Aufruf in der Schleife nach `page.goto(pfad)` (:172) und vor der Ankerprüfung (:182); Kopfkommentar-Absatz zu `page.request`-Seeding samt Begründung und zur protokollierten Mutationsprobe; Anker-Begründung (:143-151) um die drei neuen Zeilen erweitert, **mit dem Satz, dass ein leerer Modul-Leerzustand überlauffrei ist und deshalb gesät wird**.
- **Nicht geändert:** `ueberlauf()` (:87-123), `PRUEFBREITEN` (:30-34), die Sammel-Meldung (:165-195), die vier Bestandsrouten.
- **Bricht:** nichts. Die Datei hat einen Test und keine Fremdkonsumenten. Laufzeit steigt von 12 auf 21 Messungen (+~10 s) plus zwei Seeding-Requests.
- **Nebenwirkung, geprüft:** der gesäte Einsatzname bleibt `E2E Gate1 <ts>` — **kein Modulname darin** (`command-palette.spec.ts` durchsucht Module und Einsätze in einer Optionsliste; „E2E Kräfteübersicht …" ließe ihn per strict-mode flaken, dokumentiert in `lagekarte-smoke.spec.ts:56-60`). Personen- und Befehlstitel stehen nicht in der Palette.

### `frontend/e2e/fokus-verdeckung.spec.ts` (NEU, ~230 Zeilen)
- Kopf: Z13 der Prüfliste + WCAG 2.4.11; warum nicht Vitest (`vite.config.ts:84` `css: false`, jsdom rechnet kein Layout — fünf B1-Specs führen das an); warum kein Muster im Repo (`press(`/`keyboard` nur in `command-palette.spec.ts`); warum `page.request`-Seeding (neues Muster, Cookie-Jar geteilt, 8 Zeilen per UI-Modal wären 40 Aktionen ohne Erkenntnisgewinn); der benannte Nebenbefund, dass die **Kommentar-Zahlen** in `katalogtabelle-schmal.spec.ts:134/160-165` durch die gesäten Benutzer ungenau werden, während **alle dortigen Zusicherungen abgeleitet und damit unberührt** sind (nachgeprüft: `:135` waagerecht, `:184/:192/:200` aus Messwerten gerechnet).
- Kopiert (nicht importiert): `anmelden`/`einsatzAnlegen` aus `kernfluss.spec.ts:6-22`; `SUBPIXEL = 0.5` und `haeltTreffflaeche` aus `nav-schmal.spec.ts:26-46` (für die Trefflächen des Spaltenschalters in 1d).
- Vier Tests: 1c Selbstbeweis · 1b Katalogtabelle · 1d Datensicht-Tabellenzweig · 1d′ Gegenprobe „bei 390 px steht kein `.ant-table` auf der Personalseite" **nur**, falls das Primitiv-Bündel `datensicht-schmal.spec.ts` nicht liefert — sonst entfällt sie, um keine zwei Eigentümer derselben Aussage zu haben.
- **Bricht:** nichts. Berührungspunkt zum Bestand ist allein die gemeinsame Temp-DB.

### `frontend/src/components/katalogTabelle.guard.test.ts` (136 Zeilen)
- **Neu:** `lieseQuellen` + `ENDUNGEN` (kopiert, Pfade **relativ** wie `KATALOGTABELLEN`); `BEGRUENDETE_AUSNAHMEN`; `NOCH_OFFEN`; `rohTabellen`; `scrollSetzer`; fünf Testfälle (2 Schließungen, 1 Sentinel, 2 Selbstbeweise); Kopfkommentar: Grenze 1 wird von „handgepflegt, Zuwachs fällt nicht auf" auf „durch die repoweite Schließung geschlossen; was der Guard **weiter nicht** sieht" umgeschrieben — nämlich: eine Datei, die ihre Tabelle **entfernt und nichts** an ihre Stelle setzt (das fängt `<Datensicht` ≥ 1 in `datensicht.guard.test.ts`), sowie jede Aussage über Layout.
- **Geändert:** `KATALOGTABELLEN` 13 → 19 Einträge; `toHaveLength(13)` → `toHaveLength(19)` (:101).
- **Unverändert:** `ohneKommentare` (:56-80), `elementMuster` (:83-85), `SCROLL_MUSTER` (:88), die drei Bestandszusicherungen (:100-120), der Bestands-Selbstbeweis (:122-135).
- **Bricht:** der eigene Test `:101` beim ersten Einfügen — das ist beabsichtigt (rot vor grün) und wird je Datei im Migrations-Commit aufgelöst. `frontend/src/components/KatalogTabelle.test.tsx` bricht **nicht** (prüft das Primitiv, nicht das Inventar).
- **Prosa-Falle, geprüft:** die Datei zählt Marken in **fremden** Dateien und in `KatalogTabelle.tsx`. Der neue Kopfkommentar darf `<Table` und `scroll={{` nicht ausschreiben — er wird umschrieben („die rohe antd-Tabelle", „das Bildlauf-Prop"). Der Kommentar-Stripper trägt den Blockzustand über Zeilengrenzen, und der Bestands-Selbstbeweis `:123-131` belegt bereits, dass Kommentar-Fundstellen 0 zählen; für die neuen Funktionen kommt derselbe Nachweis im synthetischen Baum dazu. Gegenbeispiel und Warnung im Repo: `theme/seitenrinne.guard.test.ts:35-39` notiert, dass ein Erklärtext „sein eigenes Gate reißt (im Vorläuferpaket zweimal passiert)".

### `frontend/src/components/KatalogTabelle.tsx` (75 Zeilen)
- Ein Satz in `:27-29` (Querverweis auf `Datensicht`, Z14-Verdikt „nicht anwendbar" für die dreizehn). **Bricht nichts**: der Guard strippt Kommentare, `scroll={{`-Zählung `toBe(1)` unberührt.

### `docs/superpowers/specs/2026-07-28-einsatzlisten-pruefliste.md` (NEU)
Keine Tests hängen daran. Gate 7 ist ein Lesegate: 15 Zeilen, je ein Verdikt, 0 Zeilen ohne Verdikt, jede offene Zeile mit Zielticket.

### `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md` (176 Zeilen)
Zwei Tabellenzeilen + zwei Absätze in AK3 (`:52-67`). Der Status-Kopf `:5` (`in design`) bleibt — der Task ist LFH-19, nicht LFH-330; ich schreibe **keinen** fremden Ticketstatus um. Bricht nichts.

### `docs/superpowers/specs/2026-07-28-katalogtabellen-pruefliste.md` (68 Zeilen)
Genau **eine** Zeile: `:65` (`Z13 → B2`) bekommt „eingelöst in `2026-07-28-einsatzlisten-pruefliste.md`" bzw. bei rotem Befund das dort benannte Folgeziel. `:66` (`Z14 → B2 / B5`) bekommt denselben Verweis mit dem Verdikt „für die dreizehn unverändert nicht anwendbar; Schalter mit Zähler geliefert in `Datensicht`". Eine gepinnte Delegationszeile wird **quittiert, nicht gelöscht**.

---

## 3. Die Fallen — Tests, die nach der Änderung grün bleiben, ohne etwas zu belegen

1. **Überlauf über einem Leerzustand.** Ein frischer Einsatz hat 0 Personal, 0 Kräfte, 0 Befehle. Alle drei neuen gate1-Zeilen wären grün, weil eine leere Tabelle nicht breit sein kann. → gesät wird per API, und der Anker ist der gesäte Datensatz, nicht der Seitenrahmen.
2. **`goto` auf `/auftraege` misst den falschen Reiter.** `AuftraegePage.tsx:38` `defaultActiveKey="auftraege"`, kein `forceRender`, kein URL-Param: die Befehlsliste ist gar nicht im Baum. Der Test wäre grün und hätte die Aufträge-Liste gemessen. → `vorbereiten` klickt den Reiter, je Breite neu, mit `toHaveCount(1)` davor.
3. **`tr.ant-table-row` als Anker verschwindet mit dem Kartenzweig.** Nach B2 rendert die Personalseite bei 390 px keine `<tr>`. Ein `.first()`-Locator auf eine nicht existierende Zeile lässt den Test **fehlschlagen** (gut) — aber der naheliegende „Reparaturgriff" wäre, den Anker auf `.ant-layout-content` zu lockern, und dann misst er wieder nichts (`gate1-ueberlauf.spec.ts:135-141` sagt genau das über den früheren Anker). → form-agnostischer Textanker, festgeschrieben im Kommentar.
4. **Tab-Durchlauf ohne Bildlaufreserve.** Ohne Reserve kann keine Zeile unter die stehende Kopfzeile wandern, und „0 verdeckte Ziele" ist trivial. Bei 844 px Höhe hat die Benutzerliste des Harness **40 px** Reserve (`katalogtabelle-schmal.spec.ts:160-165`). → 8 Zeilen säen, Höhe auf 400 px, `reserve > kopfHoehe` als Zusicherung.
5. **Tab-Durchlauf, der an der Tabelle vorbeiläuft.** Eine Tabelle ohne fokussierbare Zellen liefert 0 Stopps innen und 0 Verdeckungen. → `stoppsInTabelle >= 4` (bzw. 8 in 1d) über `activeElement.closest('.ant-table')`.
6. **Ein Messkern, der nichts finden kann.** Falsche Rechteck-Logik oder ein `z-index`-Irrtum macht `verdeckt` konstant leer. → Test 1c mit synthetischem `position: fixed`-Verdecker muss **> 0** melden.
7. **Nur Rechteck-Enthaltensein prüfen** ist falsch positiv (transparente Sticky-Hülle über der ganzen Fläche), **nur `elementFromPoint`** ist falsch negativ (ein Pixel Überstand). → beide Bedingungen zusammen.
8. **Repoweite Schließung mit falscher Wurzel** liefert 0 gescannte Dateien und ist grün. → Sentinel `> 200` **und** eine namentliche Datei mit nicht-leerem Inhalt (`useViewport.guard.test.ts:179-184`).
9. **Ein Datensicht-Konsument mit 0 `<Table>` und 0 `<Datensicht>`** — Tabelle entfernt, Ersatz vergessen — passiert meine Schließung. → gehört ausdrücklich in die „Was der Guard nicht sieht"-Liste; geschlossen wird es von `<Datensicht` ≥ 1 in `datensicht.guard.test.ts` (Fremdbündel).
10. **`toHaveLength(19)` ohne Schließung** wäre der alte Zustand mit größerer Zahl: eine zwanzigste Tabelle fiele weiter nicht auf. Die Zahl allein ist kein Fortschritt, die Schließung ist es.
11. **Tote Freistellung.** Migriert jemand `GefahrenMatrix`, bleibt der Ausnahme-Eintrag als dauerhafte Lücke stehen. → Totmeldung (`useViewport.guard.test.ts:161-163/214-222`).
12. **AK (e) `grep -c "<Table" BefehlListe.tsx = 0` ist ein Gate, das nicht fallen kann** — nach dem Umbau liegt das Element in `KatalogTabelle.tsx`, die Datei ist zwangsläufig bei 0. Und `<Table` = 0 gilt für eine `form="karte"`-Datei **auch dann, wenn sie eine Tabelle rendert**. → das trägt die `form="karte"`-Literalprüfung in `datensicht.guard.test.ts` (§8), nicht mein Guard. Ich protokolliere die AK als unerfüllbar.
13. **Der gate1-Lauf ohne Basislinie.** Grün nach der Migration beweist nichts, wenn grün vor der Migration nicht gemessen wurde. → 3a plus 3e.
14. **Prosa-Selbstschuss im Guard-Kopf** (Punkt 2 unter „Bricht" oben) und **doppelt gezählte Prüflistenzeilen** in der Zusammenfassung (`Z…`-Schreibweise) — beides im Repo je zweimal passiert und dort protokolliert.
15. **Verdikt „erfüllt" durch Wunschlektüre.** §9 der Entscheidung schreibt Z13 als „erfüllt — Nachweis in diesem Paket" vor, **bevor** gemessen wurde. → die Gabel in Schritt 1 ist verbindlich; „nicht geprüft" ist kein Verdikt, „erfüllt ohne grünen Lauf" auch nicht.

---

## 4. Verifikation — exakte Kommandos

Absolute Pfade, `rtk proxy` wo der Exit-Code trägt (der rtk-Hook maskiert ihn sonst), `pnpm` über `mise exec` in der von `scripts/check-all.sh:37` gepinnten Version.

```bash
W=/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/lfh-330-einsatzlisten-primitive
PNPM="mise exec pnpm@11.10.0 -- pnpm"

# ── Schritt 2 (Guard) — gescopt, schnell
rtk proxy $PNPM -C "$W/frontend" exec vitest run src/components/katalogTabelle.guard.test.ts

# Mutationsprobe zum Guard (2c): eine Migration zurückdrehen → MUSS rot werden
#   git -C "$W" stash push frontend/src/pages/UnfallhilfsstellenPage.tsx
#   rtk proxy $PNPM -C "$W/frontend" exec vitest run src/components/katalogTabelle.guard.test.ts
#   git -C "$W" stash pop

# ── e2e braucht das Debug-Binary (playwright.config.ts:17-24 bricht sonst laut)
rtk proxy cargo build --manifest-path "$W/Cargo.toml"

# ── Schritt 1 (Z13) und Schritt 3 (gate1) — gescopt
rtk proxy $PNPM -C "$W/frontend" exec playwright test e2e/fokus-verdeckung.spec.ts
rtk proxy $PNPM -C "$W/frontend" exec playwright test e2e/gate1-ueberlauf.spec.ts

# Messwerte lesen (Basislinie 3a, Annotations):
$PNPM -C "$W/frontend" exec playwright test e2e/gate1-ueberlauf.spec.ts --reporter=list

# ── Flake-Nachweis für JEDEN neuen boundingBox-Vergleich (nav-schmal.spec.ts:26-39:
#    dreimal zugeschlagen, jedes Mal NUR im vollen Sammel-Gate)
rtk proxy $PNPM -C "$W/frontend" exec playwright test \
  e2e/fokus-verdeckung.spec.ts e2e/gate1-ueberlauf.spec.ts --repeat-each=5

# ── Nachbarn, die dieselbe Temp-DB und dieselben Routen sehen — MÜSSEN mitlaufen
rtk proxy $PNPM -C "$W/frontend" exec playwright test \
  e2e/katalogtabelle-schmal.spec.ts e2e/command-palette.spec.ts e2e/personen-detail.spec.ts \
  e2e/deeplinks-smoke.spec.ts

# ── Lint (Warnings brechen: --max-warnings 0)
rtk proxy $PNPM -C "$W/frontend" lint

# ── Volles Gate, AUS DEM REPO-ROOT (aus frontend/ heraus: Exit 127 bei leerem Log,
#    sieht wie Erfolg aus — B1-Lektion)
cd "$W" && rtk proxy ./scripts/check-all.sh
```

Markdown-Dateien werden von `scripts/check-fmt.sh` (Schritt 1) mitgeprüft — ein Prettier-Bruch in der neuen Prüfliste bricht Gate 1, also wird sie vor dem Sammel-Gate einmal formatiert geprüft.

---

## 5. Was dieses Bündel NICHT liefert

1. **`frontend/src/components/Datensicht.tsx` und `datensicht.guard.test.ts`** — Primitiv-Bündel. Ich schreibe die AK-3-Inventare als **Text** (§6) und übergebe sie; ich lege die Datei nicht an. Grund: sonst zwei Schreiber auf demselben Guard, genau die Kollision, die die Kritik für `katalogTabelle.guard.test.ts` bemängelt.
2. **`frontend/e2e/datensicht-schmal.spec.ts`** — Trefflächen, Kartenzweig-Gegenprobe, 390-px-Aussagen über das Primitiv. Gehört dorthin, wo das Primitiv entsteht; sonst gibt es zwei Eigentümer für dieselbe Aussage. Meine Datei misst **Fokusverdeckung**, nicht Breite oder Trefffläche — Ausnahme: der Spaltenschalter in 1d, dessen Trefffläche ich mitnehme, weil er ein Fokusziel des Durchlaufs ist.
3. **Die Migration der 15 Dateien.** Ich liefere die Zusicherung, nicht den Umbau. `NOCH_OFFEN` ist die Burn-down-Liste, an der der Fortschritt maschinell sichtbar ist.
4. **Die Migration von `pages/gefahren/GefahrenMatrix.tsx`** (2 Zeilen: `<Table>` → `KatalogTabelle`, eigenes `scroll` weg). Fremde Datei, Flächencodierung statt Listenvergleich, kein Auftrag im Task. Sie bleibt deklarierte Ausnahme mit Totmeldung — wer sie migriert, wird vom Guard zur Streichung des Eintrags gezwungen.
5. **`pages/KraefteuebersichtPage.tsx:324` `style={{ width: 220 }}`** am Suchfeld — die von B1 abgeschaffte feste Feldbreite, in einem von `feldbreiten.guard.test.ts:44` **ungescannten** Verzeichnis. Behebung zöge die Frage nach sich, ob `BEREICHE` mitwächst (und damit weiterer Bestand auffällt, den B2 nicht besitzt). → eigenes Ticket. Ebenso `overflowX: 'auto'` + `flexWrap: 'nowrap'` am Kennzahlenkopf (`:243/:245`), das der an der Lage-Dashboard-Kennzahlenleiste validierten Umbruch-Entscheidung widerspricht.
6. **AK (d) `getByLabelText('Personal')`/`('Fahrzeuge')`** — heute nicht schreibbar: `pages/KraefteuebersichtPage.tsx:249/256` sind `<Statistic title="…">`, antd rendert den Titel in `div.ant-statistic-title` ohne `aria-label`/`aria-labelledby`, RTLs `getByLabelText` matcht kein `title`-Attribut, und `aria-label` kommt in der ganzen Datei 0× vor. Entweder die Seite bekommt Labels (UI-Änderung, fremdes Bündel) oder die AK wird auf `getByText`/`getByRole('table')` umformuliert. → **Entscheidung nötig, nicht von mir getroffen**; ich baue kein Gate auf eine nicht existierende Beschriftung.
7. **Ein geteiltes e2e-Hilfsmodul.** Fünf Specs sagen wörtlich „aus … kopiert — es gibt (noch) kein geteiltes e2e-Hilfsmodul". Es einzuführen ist eine eigene Entscheidung; ich kopiere weiter (5 + 7 Zeilen).
8. **Ein zweites Playwright-Projekt / Device-Descriptor.** Vier Specs begründen gleichlautend, dass ein `devices['iPhone …']` webkit nachzieht und ein Browser-Download im Repo nirgends abgesichert ist. 390 × 844 kommt per `setViewportSize`/`test.use` im chromium-Projekt.
9. **Ein achter Shell-Schritt in `scripts/check-all.sh`.** Im ganzen `scripts/`-Verzeichnis gibt es kein einziges grep-basiertes Gate; neue Gates gehören als Vitest-Guard in Schritt 5 bzw. als Spec in Schritt 7.
10. **CLS-Messung (Z12).** `layout-shift`-PerformanceObserver nach einem SSE-Ereignis (Gate 6 der Leitlinie) ist im Repo nirgends gebaut, und `gate1-ueberlauf.spec.ts` misst Breite, nicht Verschiebung. Die Zeilenschleuse wird strukturell zugesichert (Primitiv-Bündel, Vitest), der **Zahlenwert** geht an **B6 (LFH-334)** — dieselbe Auslassung, die `2026-07-28-rahmen-pruefliste.md:46` schon protokolliert.
11. **Die Drawer-Hälfte von Z13** (Tab-Durchlauf bei offenem Navigations-Drawer) → **B7 (LFH-335)**, so von `2026-07-28-rahmen-pruefliste.md:47/90` ausdrücklich getrennt.
12. **Provider-Hebung von `BefehlListe.test.tsx` und `KraefteuebersichtPage.test.tsx`** (rohes `render` statt `renderMitProviders`, kein `ConfigProvider`, kein `AuthProvider` → Zweigtest dort nicht erreichbar) und die `.ant-select-clear`-Reihenfolgefalle in `PersonalPage.test.tsx:125`. Vitest-Arbeit in fremden Zieldateien → deren Bündel.

---

## 6. Akzeptanzkriterium 3 — warum die Ist-Formulierung unerfüllbar ist und wie sie lauten muss

**Ist:** `grep -rnE "sorter|filters:|Input.Search"` mit **≥ 1 Treffer je Datei** über 17 Dateien.

**Drei unabhängige Gründe, warum das nach B2 nicht mehr geht:**

1. **Die Marken existieren nicht mehr.** `AntdErbe<T>` amputiert `sorter`, `sortOrder`, `defaultSortOrder`, `sortDirections`, `filters`, `filteredValue`, `onFilter` und die vier `filter*`-Haken am Spaltentyp (§2). Ein Konsument, der `sorter:` schreibt, bricht `tsc`. Das Kriterium verlangt also genau das, was der Typ verbietet.
2. **Die Suche wohnt einmal, nicht siebzehnmal.** `Input.Search` je Datei ist nicht bloß unerfüllbar, es ist die **falsche Richtung** — ein Suchfeld pro Datei ist genau das, was das Primitiv einsammelt. Gemessen liegen die drei Bestandsvorkommen (`etb/EtbFilterleiste.tsx:39`, `pages/SchaedenPage.tsx:126`, `pages/KraefteuebersichtPage.tsx:324`) in **keiner** der dreizehn Katalogdateien; das Kriterium ist heute **rot** und nach B2 **unerreichbar** — beide Zustände sind wertlos.
3. **„je Datei" ist fachlich falsch.** `pages/KraefteuebersichtPage.tsx` darf Suche, Spaltenfilter und Sortierung **nicht** haben: die Aggregate der Elternzeilen des Meldebilds sind stromaufwärts über die Vollmenge kumuliert (`kraefte/kraeftebild.ts`, `filtereKraefte`), eine im Primitiv weggefilterte Zeile ließe die Elternzahlen still lügen. Ein „≥ 1 je Datei"-Kriterium erzwingt dort einen Fehler.

**Ersatz — drei Teile, als Inventar-Guard in `frontend/src/components/datensicht.guard.test.ts` nach dem Muster `katalogTabelle.guard.test.ts:39-53/101`, nicht als Shell-grep:**

**(3a) Positiv, gruppenweise — jede Gruppe eine handgepflegte Liste mit `toHaveLength(n)`:**

| Gruppe | Marke, `≥ 1` je Datei | Dateien |
|---|---|---|
| Freitextsuche | `suche={{` | `pages/PersonalPage.tsx`, `pages/FahrzeugePage.tsx`, `pages/MaterialPage.tsx`, `pages/PersonenPage.tsx`, `pages/TierePage.tsx`, `pages/uhs/BewegungenTab.tsx`, `auftraege/BefehlListe.tsx`, `pages/LageberichtePage.tsx` |
| Spaltenfilter | `filter: {` | `pages/PersonalPage.tsx`, `pages/FahrzeugePage.tsx`, `pages/MaterialPage.tsx`, `pages/uhs/BewegungenTab.tsx` |
| Sortierung | `sortWert:` | alle acht der Suchgruppe |
| Spaltenschalter (Z14) | `spaltenAusVoreinstellung` **oder** `SpaltenSchalter` | `pages/PersonalPage.tsx` (10 Spaltentitel), `pages/FahrzeugePage.tsx` (9) |

**(3b) Negativ, über **alle** `Datensicht`-Konsumenten (9 Dateien):** `sorter:` = 0, `filters:` = 0, `defaultSortOrder` = 0, `responsive:` = 0, `scroll={{` = 0, `<Table` = 0, `<Card` = 0; **und** `spaltenFuer` ≥ 1 und `<Datensicht` ≥ 1. Das ist die Richtung, die **fallen kann** — sie fängt den Rückfall auf antd-internen Sortier-/Filterzustand, den der Kartenzweig nicht lesen könnte, und das `const K`-Widening.

**(3c) Die eine Gegenzeile, die den Regelbruch verhindert:** `pages/KraefteuebersichtPage.tsx` muss `suche={{` = 0, `filter: {` = 0, `sortWert:` = 0, `standardSortierung` = 0 **und** das Literal `form="tabelle"` ≥ 1 enthalten. Ohne diese Zeile ist §5s harte Grenze eine Absichtserklärung; mit ihr bricht der Test, sobald jemand die Filterung in das Primitiv zieht und die Elternaggregate zum Lügen bringt. `Input.Search` bleibt dort **erlaubt** (die Filter-Card liegt außerhalb von `Datensicht` und filtert weiter über `filtereKraefte`) — deshalb ist `Input.Search` = 0 **keine** repoweite Zusicherung und wird nicht als solche gebaut.

**(3d) Kommentar-Stripper mit Blockzustand plus Selbstbeweistest** in jeder dieser Zählungen — sonst zählt der Erklärtext der geprüften Datei ihr eigenes Gate voll (im Repo zweimal passiert, `theme/seitenrinne.guard.test.ts:35-39`).

**Ebenfalls umzuformulieren, im selben Zug:**
- **AK (e)** `grep -c "<Table" auftraege/BefehlListe.tsx = 0` → ein Gate, das nicht fallen kann (nach dem Umbau liegt das Element in `KatalogTabelle.tsx`, und `form="karte"` erfüllt es auch dann, wenn die Datei eine Tabelle rendert). **Ersatz:** `form="karte"`-Literalprüfung je Datei (§8) **plus** meine repoweite Schließung in `katalogTabelle.guard.test.ts`, die aussagt, dass rohe antd-Tabellen ausschließlich im Primitiv und in einer einzigen deklarierten Ausnahme leben.
- **AK (a)** `document.body.scrollWidth <= window.innerWidth` → auf das etablierte Maß `documentElement.scrollWidth - clientWidth` (1-px-Toleranz, Verursacherliste) umschreiben. Vier Specs verwerfen die AK-Formel begründet; `gate1-ueberlauf.spec.ts:64-70` nennt zusätzlich den Mechanismus (ein `body`-Klipp propagiert bei `html: visible` auf den Viewport, `documentElement.scrollWidth` wächst dann gerade **nicht**). Unverifiziert und für die Bewertung unerheblich: ob `window.innerWidth` und `documentElement.clientWidth` unter dieser Chromium-Konfiguration um die Bildlaufleistenbreite auseinanderliegen — falls ja, ist die AK-Formel die **lockerere** und kann bei echtem Überlauf grün bleiben.
- **AK (Nr. 1)** „jede in diesem Task genannte Tabellen-Datei" → auf „**alle 16** Konsumentendateien, aufgeteilt in 9 Datensicht + 6 KatalogTabelle + 1 begründete Ausnahme" umschreiben. Sonst ist das Kriterium erfüllbar, während 5 von 16 Tabellen weiter ohne Bildlaufschutz stehen: Befund H25 formal abgehakt, faktisch offen.