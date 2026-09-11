# LFH-336 · Prüfliste Einsatztauglichkeit

Angelegt an die zwei in LFH-336 umgebauten Seiten: `pages/lage-dashboard/LageDashboardPage.tsx`
und `pages/EinsaetzePage.tsx`. Kriterien wörtlich aus
`2026-07-25-bedien-leitlinie-einsatzkontexte.md` (Festlegung 7). „Nicht geprüft" ist kein
Verdikt (CLAUDE.md) — jede Zeile trägt `erfüllt` / `teilweise erfüllt` (mit ausbuchstabiertem
Rest) / `offen → Ticket` / `nicht anwendbar`, je mit Beleg oder Begründung. „Teilweise erfüllt"
ist keine vierte, freie Kategorie — sie folgt derselben Konvention wie die A0-Referenzvalidierung
in `2026-07-25-bedien-leitlinie-einsatzkontexte.md:425-441` und die übrigen Modul-Prüflisten
(`docs/superpowers/specs/2026-07-2*-*-pruefliste.md`): der erfüllte Teil trägt einen Beleg, der
offene Teil ein Ziel.

| # | Kriterium | LageDashboardPage | EinsaetzePage |
|---|---|---|---|
| 1 | **1 · Treffläche** — Boden ≥ 24 × 24 CSS px oder 24-px-Umkreis frei (WCAG 2.5.8 AA); zeitkritische Aktion ≥ 48 × 48 px mit ≥ 8 px Abstand (WCAG 2.5.5 / Material 48 dp). | **erfüllt** — `.lfh-kz`, `.lfh-kachel__mehr`, `.lfh-knopf` und die neuen Kurzlisten-Zeilen (`a.lfh-zeile`) lesen alle `min-height: var(--lfh-zeilenhoehe)` (kompakt 30 px ≥ 24-px-Boden), belegt `theme/sprache.css:207-222` (`.lfh-kz`), `:320-330` (`.lfh-kachel__mehr`), `:447-455` (`.lfh-zeile`), `:488-491` (`a.lfh-zeile`) und `:603-608` (`.lfh-knopf`), sowie Quellpin-Test `LageDashboardPage.test.tsx` „keine harte min-height mehr in sprache.css — die Hoehen lesen die Staffel" (Zeile 667). `size="small"` = 0 Treffer (`grep -c 'size="small"' LageDashboardPage.tsx` → 0). | **erfüllt** — kein neues `size="small"` (`grep -c` → 0), kein `controlHeight` außerhalb der Theme-Schicht; Button und Input erben die Steuerhöhe vom `ConfigProvider`. Die Karte selbst (`KACHEL_MIN_HOEHE = 120`, `EinsaetzePage.tsx`) überschreitet in jeder Dichtestufe (30/48/72) jeden geforderten Boden deutlich. **Korrektur aus LFH-396 (05.09.2026):** die frühere Fassung dieser Zelle schrieb „Card-Link erbt die Steuerhöhe vom `ConfigProvider`" — das war eine Annahme, keine Messung. Gemessen (`e2e/gate3-trefflaeche.spec.ts`, erster Lauf) maß der Titel-Link der Einsatzkarte **17 px in jeder Stufe**: ein Inline-`<a>` im Kartenkopf ist so hoch wie seine Zeile, ein `<a>` erbt keine `controlHeight`. Damit lag das Tastaturziel der Karte UNTER dem 24-px-Boden. Behoben in LFH-396 über `kartenTitelStil` (`EinsaetzePage.tsx`, zwei Angaben nach LFH-365, rein und exportiert; Vitest „Titel-Link der Einsatzkarte — Bedienziel auf der Dichte-Staffel"). Gemessen danach 39,5 / 49,6 / 72 px. |
| 2 | **2 · Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px (= 19,05 mm [abgeleitet], MIL-STD-1472F Fig. 12), Abstand ≥ 16 px [abgeleitet aus Fig. 24, last contact]. | **erfüllt** (seit LFH-396, 05.09.2026) — der Mechanismus war vorhanden (`--lfh-zeilenhoehe` 72 px in der Handschuh-Stufe, `theme/rollen.css`, gegen `tokens.ts` gepinnt in `rollen.guard.test.ts`); der Browser-Nachweis liegt jetzt in `e2e/gate3-trefflaeche.spec.ts`, Test „Lage-Dashboard: Kurzlisten-Zeile, Kennzahl-Knopf und Mehr-Knopf folgen der Dichte-Staffel". Gemessen per `boundingBox()` in allen drei Stufen, Untergrenze (≥) mit 0,5 px Subpixel-Spielraum: Kurzlisten-Zeile `a.lfh-zeile` **30 / 48 / 72**, Kennzahl-Knopf `button.lfh-kz` 81,9 / 99,9 / 119,9, Mehr-Knopf `.lfh-kachel__mehr` **30 / 48 / 72** (je kleinstes Maß über alle Knoten; Meldung und Auftrag gesät, damit die Zeilen überhaupt stehen). Böden als Literale im Spec. **Mutationsprobe** (Ticket-AK): Stufe im Test auf `kompakt` festgenagelt bei Handschuh-Erwartung → rot an der `data-dichte`-Wache; zusätzlich ohne Wache → rot an der ersten Höhenmessung („Kurzlisten-Zeile #1 gemessen 30px, Soll ≥ 72"). Abstand ≥ 16 px zwischen Zeilen ist damit nicht gemessen — die Zeilen stehen bündig mit `border-top`, ein Abstandsmaß gehört zu Festlegung 3 (Spacing-Ausnahme) und war in keiner Modul-Prüfliste des Repos je gemessen; Baseline 0, kein neuer Befund. | **erfüllt** (seit LFH-396, 05.09.2026) — `e2e/gate3-trefflaeche.spec.ts`, Test „Einsatzauswahl: Einsatzkarten-Titel-Link und Suchfeld folgen der Dichte-Staffel". Gemessen in allen drei Stufen: Titel-Link der Karte 39,5 / 49,6 / **72**, Suchfeld (`.ant-input-affix-wrapper`, die sichtbare Feldhülle) 30,1 / 48 / **72**, Such-Knopf 30 / 48 / **72**. Das Suchfeld erscheint erst ab `SUCHE_AB = 8` aktiven Einsätzen, der Spec sät deshalb acht per `POST /api/einsaetze`. **Der Nachweis hat einen Befund geliefert**, siehe Kriterium 1: der Titel-Link maß vor dem Fix 17 px. Mutationsprobe wie links (ohne Wache: „Titel-Link gemessen 39,47px, Soll ≥ 72"). Abstand ≥ 16 px ist wie links nicht gemessen: die Karten stehen mit `gap: abstand.lg` im Raster, das ist ein Token, kein Messwert — Baseline 0, kein neuer Befund. |
| 3 | **3 · Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms (MIL 5.4.6.4); Kommandoreaktion ≤ 2 s (Tab. XXII); > 15 s nur mit Fortschrittsmeldung (MIL 5.14.9). | **teilweise erfüllt** — Ladezustand ist sofort sichtbar: Skelett mit `aria-busy` je Kachel (`LageDashboardPage.tsx:128-133`), und die Kennzahlenleiste stellt ihre sechs Plätze schon während des Einsatz-Abrufs (Test „die Kennzahlenleiste stellt schon während des Einsatz-Abrufs sechs Plätze", Zeile 550). Optimistische Updates gibt es nicht — der „Erneut abrufen"-Knopf zeigt während des Nachladens keinen sichtbaren Zwischenzustand (Baseline weiterhin 0, wie in jeder anderen Modul-Prüfliste des Repos) → offen → **LFH-334 (B6)** | **teilweise erfüllt** — `anlegen.isPending` läuft als `laeuft` in `ErfassungsModal` und zeigt sofort einen Lade-Knopf (`EinsaetzePage.tsx:325`); der Fokus-Fehlerpfad zeigt `role="alert"` sofort. Kein sichtbarer Zwischenzustand am „Erneut abrufen"-Knopf während des Nachladens, keine optimistischen Updates (Baseline 0) → offen → **LFH-334 (B6)** |
| 4 | **4 · Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung (MIL 5.4.6.6). | **nicht anwendbar** — das Dashboard führt keine kritische oder irreversible Aktion aus, es liest und navigiert (unverändert seit A0-Referenzvalidierung). | **nicht anwendbar** — die Seite legt Einsätze an (`grep -n "danger\|Popconfirm"` → 0 Treffer) und trägt keine Storno-/Abschluss-/Löschen-/Alarmierungsaktion; Abschluss/Storno eines Einsatzes liegt in einem anderen Modul. |
| 5 | **5 · Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1 (MIL 5.2.4.2.2.2; WCAG 1.4.6/1.4.3); Zustände, Rahmen, Fokusring ≥ 3 : 1 (WCAG 1.4.11). | **erfüllt** — alle Farben kommen aus den A0-gemessenen Token (`--lfh-*`): Text 13,47:1 dunkel / 18,17:1 hell, Fokusring 7,67/6,59, Alarm 6,80/6,78, tragende Linie 3,04/3,07 (unverändert). Die neuen Kurzlisten-Zeilen nutzen dieselben, bereits gemessenen Sekundärfarben `--lfh-gedaempft`/`--lfh-schwach` (`theme/rollen.css:32-33,103-104`, seit LFH-352 unverändert) — keine neue Farbe eingeführt. | **erfüllt** — geerbt aus dem antd-Theme (A0); die neue Ortszeile/Zeitstand-Zeile nutzt `Typography.Text type="secondary"` (bereits gemessene antd-Sekundärfarbe, unverändert durch diesen Umbau). |
| 6 | **6 · Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen (WCAG 1.4.1 Level A; MIL 5.4.6.8; 1 von 12 Männern, NEI). | **teilweise erfüllt** — die Aggregat-Plaketten tragen Text (`N überfällig`), die Kennzahlkante nutzt Breite UND Farbe (zwei Kanäle, `sprache.css` Test „die Stufenregeln der Kennzahl ändern Farbe und Kantenbreite"). **Aber**: die neuen Kurzlisten-Zeilen-Marker `.lfh-zeichen--{alarm,achtung,normal}` (`LageDashboardPage.tsx:554,594`) sind immer dasselbe Dreieck — nur `border-bottom-color` unterscheidet die drei Stufen (`theme/sprache.css:79-96`), Breite/Form bleiben gleich. Eine einzelne Zeile trägt keinen Text, der eine überfällige von einer normalen Meldung unterscheidet (nur der Gesamtzähler „N überfällig" außerhalb der Liste tut das). Für farbenblinde Nutzer ist die Dringlichkeit EINER Zeile nicht ablesbar. → offen → **LFH-395** (<https://app.clickup.com/t/86cb2q93b>) | **erfüllt** — `StatusTag` trägt `label` als Pflichtfeld aus dem `StatusDarstellung`-Vertrag (`EinsaetzePage.tsx:54-57`, Text als zweiter Kanal); der Einsatzart-Tag ist reiner Text ohne Farbcodierung; kein Farbwert ohne begleitende Beschriftung. |
| 7 | **7 · Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche aus A0 (weder `#000000` noch `#ffffff`) — ASM Consortium. | **erfüllt** — `grep -rniE '#(b02318\|ff7a7f\|f5b942\|5cc48d\|1c6640\|7a5200\|1a5fa0\|6fb4ec\|a8071a\|e04552)'` → 0 Treffer in der Datei; unverändert aus A0. | **erfüllt** — gleicher Befund, 0 Treffer. |
| 8 | **8 · Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre (MIL 5.2.2.1.9, 5.2.4.2.2.3). | **offen → LFH-397** (<https://app.clickup.com/t/86cb2qcq9>) — app-weite, bereits in A1 dokumentierte Lücke, kein Regler existiert; A1 verweist ihn ausdrücklich auf einen eigenen Folge-Task (`bedien-leitlinie-einsatzkontexte.md`, Abschnitt „Was diese Leitlinie nicht entscheidet"). Nicht im Scope von LFH-336. | **offen → LFH-397** (<https://app.clickup.com/t/86cb2qcq9>) — dieselbe app-weite Lücke, nicht seitenspezifisch. |
| 9 | **9 · Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand (MIL 5.2.2.1.7). | **erfüllt** — das Instrumentenband (`.lfh-band`) liegt oben, immer an derselben Stelle, Kennzahlen im oberen Drittel (unverändert seit A0). | **nicht anwendbar** — die Seite ist eine Auswahl-/Listenseite ohne Lagebild-Kennzahlen; es gibt keine „kritischen Anzeigen" im Sinne des Kriteriums. |
| 10 | **10 · Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, < 10 in den ersten 10 min einer Großlage, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen (EEMUA 191 S. 96/97; ISA-18.2). | **nicht anwendbar** — das Dashboard erzeugt keine Alarme, es zeigt Zustände (unverändert). | **nicht anwendbar** — die Seite erzeugt keine Alarme. |
| 11 | **11 · Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten (schnellere ≤ 5 Hz, langsamere ≥ 0,8 Hz), jede Warnung quittierbar, jeder Ton mit visueller Entsprechung (MIL 5.2.1.5.5.3/.4/.5, 5.3.6.3). | **erfüllt** — kein Blinken auf der Seite (`grep -n "animation\|blink" LageDashboardPage.tsx theme/sprache.css` liefert nur den Puls-Indikator, der aria-hidden ist und keinen Text betrifft); der Fehlerzustand trägt `role="alert"` mit Text statt Bewegung. | **erfüllt** — kein Blinken; Fehlerzustand über `SeitenFehler` mit `role="alert"`. |
| 12 | **12 · Kein Sprung unter dem Cursor** — CLS ≤ 0,1 (75. Perzentil, web.dev); neue Datensätze nur als opt-in-Sammelbanner (WCAG 3.2.5 / G76). | **offen → LFH-334 (B6)** — `einsatzKeys.meldungen`/`einsatzKeys.auftraege` sind Teil des SSE-Fan-outs (`api/queryKeys.ts:86,88,119-121`): eine eingehende Meldung oder ein neuer Auftrag lässt react-query die Abfrage automatisch neu laden, wodurch die Top-3-Kurzliste (`meldungszeilen`/`auftragszeilen`, sortiert nach Ereigniszeit/Frist) ohne Sammelbanner umsortiert. Kein `layout-shift`-Observer im Repo, CLS-Wert nirgends gemessen. | **CLS-Teil erfüllt und gemessen (LFH-514); Sammelbanner-Teil unten bewertet** — `globalKeys.einsaetze()` ist **kein** Teil des einsatzgebundenen SSE-Fan-outs (`EINSATZ_STREAM_EVENTS` bildet nur `einsatzKeys` ab, `globalKeys` liegt außerhalb) — die Liste bekommt also keine Live-Ereignisse über SSE, die unter dem Cursor umsortieren könnten. Korrektur aus dem Abschluss-Review (Befund M5): „strukturell nicht" ist damit für den Sammelbanner-Teil zu viel behauptet — `refetchOnWindowFocus` ist an dieser Query nicht abgeschaltet (Vorgabewert `true` gilt, kein Override in `EinsaetzePage.tsx:126-129`), und mit der in diesem Branch neu eingeführten `begonnen_at`-desc-Sortierung (`EinsaetzePage.tsx:165-167`) kann ein Fensterfokus-Refetch klickbare Karten umsortieren. Praktisch selten (Fensterfokus ist seltener als ein SSE-Ereignis), aber kein struktureller Ausschluss. Der Skelett→Karte-Wechsel selbst nutzt dieselbe Kachelhöhe (`KACHEL_MIN_HOEHE`) für beide Zustände (Test „zeigt beim Laden Karten-Skelette im Raster … Die Skelett-Kacheln liegen im SELBEN Rasterknoten"), ein CLS-Zahlenwert ist aber nicht gemessen (kein Observer im Repo) — CLS lässt sich wie die Trefflächenhöhe nur im Browser messen (jsdom rechnet kein Layout). **Korrektur aus LFH-396 (05.09.2026):** die frühere Fassung verwies hierfür auf LFH-396 als „denselben Messtask" — das war eine Vermutung über den Zuschnitt eines anderen Tickets. LFH-396 trägt nur die Trefflächenhöhe (Gate 3, `boundingBox()`), keinen `layout-shift`-Observer. **gemessen und erfüllt (LFH-514, 11.09.2026)** — `e2e/einsatzauswahl-cls.spec.ts` registriert einen `PerformanceObserver` für `layout-shift` (`buffered: true`, Einträge mit `hadRecentInput` verworfen) über `addInitScript` und summiert die Shifts eines Dokuments. Gemessen im Fükw-Maß 1366 × 768: Ladewechsel Skelett → Karten **0,0022**, Ladewechsel ab acht aktiven Einsätzen **0,0204** (Suchfeld-Einschub über dem Raster UND Zuwachs von einer Skelett- auf drei Kartenreihen — dieselbe Shift-Quelle, nicht aufteilbar), Fensterfokus-Refetch mit unveränderten Daten **0,0000** bei belegtem zweiten Listen-Abruf — alle drei unter dem web.dev-Budget von 0,1 (75. Perzentil). Der Befund M5 („Fensterfokus-Refetch kann klickbare Karten umsortieren") ist damit für unveränderte Daten ausgeräumt; der verbleibende Fall ist ein Refetch mit **geänderter** Datenlage, und der gehört zum Sammelbanner-Teil unten. **Zwei Einschränkungen, beide gemessen statt behauptet:** (1) Die Shift-Summe ist nicht identisch mit CLS — web.dev misst das größte Sitzungsfenster, die Summe ist die strengere Größe, ein grüner Test hier ist also auch ein grüner CLS. (2) **Ein CLS-Wert allein prüft die Kachelhöhe NICHT:** `layout-shift` meldet nur Elemente, die in zwei Frames existieren und sich bewegen — verschwindende Skelette und erscheinende Karten sind kein Shift, und im Ladezustand steht unter dem Raster nichts (die Abgeschlossen-Sektion hängt an `abgeschlossene.length > 0`). Mit halbierter Skeletthöhe blieb die Summe deshalb unverändert bei 0,0022. Der Spec trägt darum als zweite Zusicherung den **gemessenen Kachelboden** (Skelett 120 px, Einsatzkarte 129,5 px, Soll ≥ 120) — diese Zusicherung färbt die Mutationsprobe rot („Skelett-Kachel #1 gemessen 108px, Soll ≥ 120"). Der Sammelbanner-Teil des Kriteriums (neue Datensätze als opt-in-Banner) bleibt hiervon unberührt und ist für diese Seite mangels SSE-Fan-out nicht einschlägig. |
| 13 | **13 · Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter fixierten Köpfen, Fußleisten oder Drawern (WCAG 2.4.11 AA). | **erfüllt** — `grep -n "position:" theme/sprache.css` → 0 Treffer, kein `position: fixed`/`sticky` auf der Seite (unverändert). | **erfüllt** — keine fixierten Köpfe/Fußleisten/Drawer auf der Seite; per RTL belegt: „macht jede geladene Einsatzkarte per Titel-Link erreichbar und navigiert per Enter" tabbt bis zur letzten Karte durch, ohne dass ein Ziel verdeckt bliebe. |
| 14 | **14 · Tabellenseite vollständig** — fixierte Kopfzeile, fixierte menschenlesbare Identifierspalte, umschaltbarer Spaltensatz mit Zähler ausgeblendeter Spalten, keine Auflösung in Karten, wo verglichen wird (NN/g Data Tables / Mobile Tables). | **nicht anwendbar** — keine `<Table>` auf dem Dashboard (`grep -n "Table"` → 0 Treffer); Kacheln sind Level-1-Überblick. | **nicht anwendbar** — keine `<Table>` auf der Seite (`grep -n "Table"` → 0 Treffer); die Seite ist bewusst eine Kartenliste (Festlegung 2: „wird gelesen, nicht verglichen"). |
| 15 | **15 · Erfassungsmaske vollständig** — Defaults vorbelegt, sichtbar und einzeln überschreibbar (MIL 5.14.7.1/.3), „Speichern und nächsten anlegen" mit gehaltenem Kontext (5.14.7.4), Sammelliste mit Ändern/Entfernen je Zeile (DWP „Add another thing"), Labels über dem Feld (50 ms statt 500 ms Sakkade, Penzo), volle Tastaturbedienung (WCAG 2.1.1). | **nicht anwendbar** — keine Erfassungsmaske auf dem Dashboard. | **teilweise erfüllt** — die anwendbaren Teile sind erfüllt: Defaults vorbelegt und einzeln überschreibbar (`initialValues={{ einsatzart: 'realeinsatz', begonnen_at: dayjs() }}`, `EinsaetzePage.tsx:326`); Labels über dem Feld (`layout="vertical"`, `components/Erfassung.tsx:320`); volle Tastaturbedienung (Fokus im ersten Feld beim Öffnen, Enter sendet ab — Test „setzt den Fokus beim Öffnen ins erste Feld und sendet per Enter"). „Speichern und nächsten anlegen" mit gehaltenem Kontext und die Sammelliste mit Ändern/Entfernen je Zeile sind **nicht anwendbar**: der Dialog legt EINEN Einsatz an, kein Minutentakt-Vorgang wie Aufnahme/BHP/BTP — `serie` ist bewusst nicht gesetzt (CLAUDE.md, Abschnitt „Erfassungs-Norm"). |

## AK-Nachweis

Alle sechs Akzeptanzkriterien des Tickets, mit tatsächlichem Kommando und tatsächlicher
Ausgabe.

### AK1 — kein statischer Live-Tag, Band meldet Verbindungsabriss

```
$ grep -c 'Tag color="blue">Live' frontend/src/pages/lage-dashboard/LageDashboardPage.tsx
0
```

Erwartet 0 — erfüllt. Die Substanz liefert der Vitest-Test, der einen simulierten
`lfh:live-status`-Abriss über `setzeLiveStatusFuerTest('lost')`
(`frontend/src/live/liveStatusStore.ts`) gegen das Band prüft:

- `frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx` → Test
  **„bei abgerissener Live-Verbindung meldet das Band NICHT „Live""** (Zeile 601): setzt den
  Status auf `lost` und prüft, dass „Live verbunden" NICHT im Dokument steht und stattdessen
  „Verbindung unterbrochen" erscheint.
- Gegenprobe im selben `describe`-Block: **„das Band meldet die Live-Verbindung, solange sie
  steht"** (Zeile 593, Status `open`) und **„während des Wiederverbindens meldet das Band den
  Zwischenstand"** (Zeile 610, Status `connecting`) — beide Zweige sind geprüft, nicht nur der
  Abriss-Fall allein.

Ergebnis: siehe Vitest-Lauf unter „Volles Gate", Schritt 5 — alle drei Tests grün (Details dort).

### AK2 — Meldungs- und Auftrags-Kurzlisten

`frontend/src/pages/lage-dashboard/LageDashboardPage.test.tsx`:

- **„Meldungen: die Kurzliste nennt lfd. Nummer, Zeit, Absender und Inhalt"** (Zeile 313):
  mindestens eine Zeile mit `lfd_nr`, Zeit (`uhrzeit()`), Absender und Sprungziel
  (`href="/einsaetze/1/meldungen?meldung=77"`).
- **„Aufträge: die Kurzliste nennt Auftragstext und Frist und springt auf den Auftrag"**
  (Zeile 332): Zeile mit Auftragstext, `formatUhrzeitMitTag()`-Frist, Sprungziel
  (`href="/einsaetze/1/auftraege?auftrag=88"`).
- **„ohne Aufträge zeigt die Kachel den Leerzustand und KEINE Zeile"** (Zeile 352) und
  **„sind alle Aufträge vollzogen, zeigt die Kachel den Leerzustand statt eines leeren
  Kastens"** (Zeile 364): Leerzustand unterscheidbar gerendert (Text „Keine offenen Aufträge."
  statt einer leeren Kachel), auch wenn der rohe Response nicht leer ist, aber gefiltert leer
  wird.
- **„sind alle Meldungen erledigt, zeigt die Kachel den Leerzustand"** (Zeile 377): Analogfall
  für Meldungen.

Ergebnis: siehe Vitest-Lauf, Schritt 5 — alle vier Tests grün.

### AK3 — keine Inline-Pfade in EinsaetzePage und lage-dashboard

```
$ grep -rn '/einsaetze/\${' frontend/src/pages/EinsaetzePage.tsx frontend/src/pages/lage-dashboard/
(keine Treffer, Exit-Code 1)
```

Erwartet leer — erfüllt. `EinsaetzePage.tsx` war laut Self-Review von Task 6 im Brief bereits
sauber (nutzt `einsatzPfad` aus `routing/deeplinks.ts`); `lage-dashboard/` nutzt
`einsatzModulPfad`/`auftraegePfad`/`meldungenPfad`. Zusätzlich gepinnt in
`LageDashboardPage.test.tsx`, `describe('Deeplinks des Dashboards (LFH-336 · AK3)')`
(Zeile 783): Quelltext-Test „baut keinen Einsatz-Pfad als Template-Literal" und „nutzt den
Modul-Builder".

### AK4 — Tab erreicht Karte, Enter navigiert

`frontend/src/pages/EinsaetzePage.test.tsx`:

- **„macht jede geladene Einsatzkarte per Titel-Link erreichbar und navigiert per Enter"**
  (Zeile 196): zwei Karten, Tab-Reihenfolge (Anlegen-Knopf → Karte 1 → Karte 2), Enter auf der
  fokussierten Karte navigiert zur Zielroute.
- **„die Tabulatortaste erreicht die Einsatzkarte, Enter navigiert"** (Zeile 508, im
  LFH-336-eigenen `describe`-Block): tabbt bis zur Karte durch (bis zu 10 Tabs, robust gegen
  Rechte-Variation), Enter navigiert zur mitgerenderten Zielroute — mit Kommentar zur
  MemoryRouter-Falle („`window.location` bewegt sich dort nie").

Ergebnis: siehe Vitest-Lauf, Schritt 5 — beide Tests grün.

### AK5 — Ort, Zeitstand, Suchfeld bei 9/3 aktiven Einsätzen

`frontend/src/pages/EinsaetzePage.test.tsx`, `describe('Einsatzkarte — Lagebild statt vier
Felder (LFH-336 · M4/M5)')`:

- **„die Karte nennt den Einsatzort"** (Zeile 351) und **„ohne Einsatzort bleibt die Ortszeile
  ganz weg statt leer zu stehen"** (Zeile 381).
- **„die Karte nennt einen aus begonnen_at abgeleiteten Zeitstand"** (Zeile 363, gegen
  `formatZeitKurz`).
- **„bei 9 aktiven Einsätzen erscheint das Suchfeld"** (Zeile 399) und **„bei 3 aktiven
  Einsätzen erscheint kein Suchfeld"** (Zeile 409) — Schwelle `SUCHE_AB = 8`.

Ergebnis: siehe Vitest-Lauf, Schritt 5 — alle vier Tests grün.

### AK6 — Lint und volles Gate grün

**Erfüllt.** `./scripts/check-all.sh` läuft mit `GATE_EXIT=0` vollständig durch — alle sieben
Schritte: rustfmt, `pnpm lint --max-warnings 0`, Typ-Codegen inkl. `tsc`,
`cargo test --workspace`, Vitest **2771/2771** über 262 Dateien, `check-deps` (nach dem
nanoid-Override) und **e2e 47/47 in 53 s**.

**Eine Zwischendiagnose in dieser Datei war falsch und ist hier korrigiert.** Frühere Fassungen
führten Schritt 7 als „rot, aber Bestandsproblem". Das stimmte in der Abgrenzung (kein
LFH-336-Bezug) und war in der Ursache verkehrt: die Suite ist nicht kaputt, sondern
**lastempfindlich**. Gemessen über vier Läufe — im Gate auf freier Maschine 53 s und 47/47;
einzeln auf freier Maschine 1,5 min und 45/47; einzeln mit einem parallel arbeitenden Subagenten
4,2 min und 24/47; derselbe belastete Lauf auf dem Merge-Base 27/47. Die Laufzeit ist der
Indikator: bei 4,2 min stehen die Fehlschläge in 10- bzw. 35-Sekunden-Timeouts, nicht in
fachlichen Assertions. Der als „ohne Nebenlast" protokollierte Lauf war keiner — es lief ein
Review-Subagent mit. Die Empfindlichkeit selbst bleibt ein echter Befund und behält ihr Ticket:
**LFH-398** (<https://app.clickup.com/t/86cb2qdz1>).

## Volles Gate

`./scripts/check-all.sh`, Arbeitsverzeichnis
`/Users/rubeen/dev/personal/lifeline-hub/.claude/worktrees/dev-clickup-execution-eed38c`, ohne
`| tail` oder sonstige Pipe, die den Exit-Code maskieren würde.

Der Lauf brauchte drei Anläufe, zwei davon von mir gesehen, der dritte (abschließende) vom
Coordinator selbst gefahren. Der vollständige Verlauf steht in `task-6-report.md` — hier die
Kurzfassung mit dem Endstand:

**Lauf 1** (vor dem nanoid-Fix, von mir vollständig gesehen): Schritte 1–5 grün (rustfmt, Lint,
Typ-Codegen, `cargo test --workspace`, Vitest — 262 Testdateien / 2765 Tests). Schritt 6
(`check-deps.sh`) brach mit `EXIT_CODE=1` an einem `pnpm audit --audit-level=high`-Fund
(GHSA-2v37-7h3g-55p8, nanoid, Build-/Test-Zeit-Tooling) — ein Bestandsproblem ohne
LFH-336-Bezug (siehe `fix(deps)`-Commit oben). Schritt 7 (e2e) lief wegen `set -euo pipefail`
nicht mehr an.

**Lauf 2** (nach dem Fix, von mir NICHT vollständig gesehen): meine Session wurde während des
Wartens auf diesen Lauf beendet, bevor er über Schritt 4 hinauskam. Isoliert außerhalb von
`check-all.sh` bestätigt: `pnpm audit --audit-level=high` im Frontend meldet „No known
vulnerabilities found".

**Lauf 3 (vom Coordinator gefahren, parallel zu laufenden Subagenten):** Schritte 1–6 grün,
Schritt 7 rot mit 23 failed / 24 passed. Die Gegenprobe auf dem Merge-Base `dd91460a` — für die
`frontend/src` zurückgedreht und dieselbe Suite gefahren wurde — lieferte 20 failed / 27 passed
und schloss damit eine LFH-336-Regression aus. Die daraus gezogene Folgerung „die Suite ist im
Bestand rot" war jedoch **verfrüht**: sie beruhte auf zwei Läufen, die beide unter Fremdlast
standen.

**Lauf 4 (abschließend, nach der Fix-Welle, Maschine sonst frei) — der Endstand:** alle sieben
Schritte grün, `GATE_EXIT=0`. Vitest **2771/2771** über 262 Dateien, **e2e 47/47 in 53 s**.

**Was der Vergleich der vier Läufe zeigt:** die e2e-Suite ist lastempfindlich, nicht defekt.

| Bedingung | Dauer | Ergebnis |
|---|---|---|
| Im Gate als Schritt 7, Maschine frei | 53 s | 47 / 47 |
| `pnpm e2e` einzeln, Maschine frei | 1,5 min | 45 / 47 |
| `pnpm e2e` einzeln, ein Subagent parallel | 4,2 min | 24 / 47 |
| dasselbe auf dem Merge-Base | 4,2 min | 27 / 47 |

Die Laufzeit ist der Indikator: bei 4,2 min stehen die Fehlschläge in Timeouts, nicht in
fachlichen Assertions, und die Fehlermenge wandert zwischen Läufen. Die Empfindlichkeit ist ein
echter Befund und behält ihr Ticket — **LFH-398** (<https://app.clickup.com/t/86cb2qdz1>), dort
mit der vollständigen Messreihe und dem korrigierten Ursachenbild. Sie ist kein Hindernis für
den Abschluss von LFH-336: das Gate ist auf freier Maschine vollständig grün.
