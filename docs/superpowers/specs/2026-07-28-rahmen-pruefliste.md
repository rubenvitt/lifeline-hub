# Prüfliste Einsatztauglichkeit — Rahmen (LFH-329 · B1 / H11, M12, M34, M28, H24)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an **jeder** umgebauten Seite. B1 hat zwei Familien angefasst; dies ist
die zweite. Die erste — die dreizehn Katalogtabellen — steht in
`2026-07-28-katalogtabellen-pruefliste.md` und wird hier nicht wiederholt.

**Der Rahmen ist keine Seite, sondern das, was um jede Seite herum steht.** Er wird als eine
Familie geführt, weil seine Teile eine gemeinsame Entscheidung tragen und nur zusammen
bewertbar sind: **eine** Breitenweiche (antds `lg`, 992 px) entscheidet, ob der
Navigationsrahmen inline steht oder hinter dem Griff liegt, ob die Kopfzeile ihre Umschalter
trägt oder ablegt, und ob das Benutzermenü sie aufnimmt. Diese Weiche wird an **einer** Stelle
gestellt (`components/useViewport.ts`); eine Prüfliste je Datei bewertete dreimal dieselbe
Entscheidung und übersähe genau die Stellen, an denen die Teile aneinander hängen.

**Umfang:** `einsatz/EinsatzLayout.tsx`, `einsatz/ModulAkkordeon.tsx`, `einsatz/ModulPanel.tsx`,
`einsatz/IconRail.tsx`, `components/AppLayout.tsx`, `components/BenutzerMenu.tsx`,
`einsatz/EinsatzSwitcher.tsx`, `components/ThemeToggle.tsx`, `theme/ThemeModeProvider.tsx`,
`theme/rollen.css`. Zehn Dateien — überall dort, wo unten „die zehn Dateien" steht, ist genau
diese Menge gemessen.

**Was B1 an ihnen geändert hat:** der Navigations-Drawer mit flachem Akkordeon unterhalb `lg`
(H11), die Kopfzeile mit eigener Polsterung, Restbreiten-Rahmen für den Einsatznamen und
abgelegten Umschaltern (M12), die Seitenrinne als Viewport-Achse (M34), die dreistufige
Dichteachse vom Träger zum bedienbaren Schalter (M28) und das Viewport-Primitiv als einziger
Zugang zu Breiten- und Zeigerfragen (H24). **`einsatz/IconRail.tsx` hat B1 nicht angefasst**
(gemessen: die Datei steht nicht im Diff gegen `main`) — sie gehört zum Rahmen und wird hier
bewertet, nicht angefasst. Dasselbe gilt für alles Übrige, was unten als „Bestand" benannt ist.

Die Liste ist **absichtlich nicht durchgehend grün.** Verdikte: erfüllt / teilweise erfüllt /
offen → Zielticket / nicht anwendbar. „Nicht geprüft" ist kein Verdikt und kommt nicht vor.

| #  | Verdikt               | Beleg / Zielticket                                                                                                                                                                                                                                                                    |
| -- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | **erfüllt**           | Die vier Berührungsstellen tragen 48 px und sind gepinnt: Griff (`EinsatzLayout.tsx:174`) und Drawer-Schließer (`:240`) über `EinsatzLayout.test.tsx:271-286`, die Akkordeon-Kopfzeilen (`ModulAkkordeon.tsx:75`) über `ModulAkkordeon.test.tsx:93-99`, die Rail-Knöpfe über `IconRail.tsx:45`. Darunter bleibt nichts unter dem 24-px-Boden: Benutzermenü-Trigger 40 px (`BenutzerMenu.tsx:192`), Modulknopf im inline-Rahmen 6 + 6 px Polster um ein 18-px-Symbol = 30 px [abgeleitet] (`ModulPanel.tsx:62-63` mit `:73`). Gemessen **0** punktuelle Klein-Angaben (antd-Größen-Prop mit dem Wert `small`) in allen zehn Dateien — B1 entfernt zugleich die eine, die der Farbschema-Umschalter bis dahin trug (Diff `ThemeToggle.tsx`) |
| 2  | **teilweise erfüllt** | Die Stufe **existiert und wird bedient**: 72 px in `tokens.ts:133`, am `ConfigProvider` als `controlHeight` (`ThemeModeProvider.tsx:123`, `tokens.ts:265`), literalgegengeprüft in `ThemeModeProvider.test.tsx:139`; drei Bedienwege — Kopfzeile (`ThemeToggle.tsx:94-102`), Benutzermenü (`BenutzerMenu.tsx:161-167`), Kommandopalette (`befehle.ts:29-32`/`:89`, gepinnt in `befehle.test.ts:137-150`). **Der Navigationsrahmen folgt ihr aber nicht:** 48 px stehen fest in `ModulAkkordeon.tsx:44/75` und `IconRail.tsx:45`, und `abstand` zeigt fest auf die kompakte Stufe (`tokens.ts:142`) — die Abstände bleiben damit bei 3 px im Drawer (`ModulAkkordeon.tsx:59`) und 2 px im Panel (`ModulPanel.tsx:46`), gegen die geforderten ≥ 16 px. → **B5 (LFH-333)**. Zweiter offener Punkt in derselben Zeile, weil Kriterium 2 der einzige Ort ist, an dem die Liste einen **Kontext** benennt: das Führungs-Tablet bekommt seinen Kontext heute nicht. Bei 1024 px steht der Rahmen noch inline und nimmt ~330 px, es bleiben 694 px Inhalt — die Zweispalten-Ansicht des Handschirms, während ein 768-px-Gerät drei Spalten zeigt (gemessen und hergeleitet in A1, Abschnitt „Validierung an der Referenzseite", Absatz „Offen für den Parent"). Entschieden: die Schwelle bleibt bei `lg` → **C2 (LFH-337)** |
| 3  | **teilweise erfüllt** | Der Einsatzname zeigt vor der Serverantwort einen Spinner (`EinsatzLayout.tsx:180-181`); Farbschema und Dichte wirken ohne Serverweg und damit ohne Wartezeit (`ThemeModeProvider.tsx:70/75`, `localStorage`). Die zweite Abfrage des Rahmens hat **keinen** Ladezustand: `modulOverrides` (`EinsatzLayout.tsx:133-136`) wird ohne `isLoading`/`isError` konsumiert, die Navigation steht also vollständig, bevor die Antwort da ist. Kein Fall > 15 s, ein Fortschrittsbalken ist nicht nötig → **B3 (LFH-331)**, das genau diese Stelle benennt                                                     |
| 4  | **nicht anwendbar**   | Der Rahmen navigiert und schaltet Darstellung um; keine der vier Aktionen aus dem Kriterium (Storno, Abschluss, Löschen, Alarmierung) entsteht hier. Gemessen **0** `Popconfirm`/`Modal.confirm` in den zehn Dateien. Der nächste Kandidat ist Abmelden (`BenutzerMenu.tsx:171/178-179`, ohne Rückfrage) — es ist keine der vier und durch erneute Anmeldung umkehrbar                                                                                     |
| 5  | **teilweise erfüllt** | Die Palette ist unverändert aus A0: der `rollen.css`-Diff gegen `main` enthält **keine** geänderte Farbzeile (gemessen), die A0-Werte 13,47 : 1 dunkel / 18,17 : 1 hell gelten weiter. Die Kopfzeile liegt in beiden Modi auf antds `Layout`-Vorgabe `headerBg` = `#001529` (antd 6.5.2); tragend ist dabei die Messung, nicht die Fundstelle: im Repo gibt es **0** Treffer für einen `headerBg`-Override. Darauf gerechnet [alle drei abgeleitet, Eingaben genannt] — die Umschalter-Beschriftung `rgba(255,255,255,0.65)` über dem Track `rgba(255,255,255,0.08)` (`ThemeToggle.tsx:74-75`) ergibt **7,10 : 1** ✓. Zwei Werte fallen durch. (a) Der gesperrte Verwaltungs-Link `rgba(255,255,255,0.35)` (`AppLayout.tsx:34`) ergibt aufgerechnet `#596774` = **3,18 : 1**, unter den 4,5 : 1 aus WCAG 1.4.3; ob die Ausnahme für inaktive Bedienelemente greift, ist strittig und wird hier **nicht** entschieden — das Element ist ein `Typography.Text` mit `title`, kein deaktiviertes Steuerelement. (b) Die **gewählte** Stufe hebt sich vom Track nur über `itemSelectedBg: rgba(255,255,255,0.18)` gegen `trackBg: rgba(255,255,255,0.08)` ab (`ThemeToggle.tsx:74/78`): `#2e3f50` gegen `#142839` = **1,40 : 1**, gegen die 3 : 1, die dieses Kriterium für Zustände und Rahmen nennt (WCAG 1.4.11). Beide Werte sind Bestand und von B1 unverändert (Diff) — B1 stellt aber einen **zweiten** Umschalter auf denselben Grund (`ThemeToggle.tsx:94-102`), und es ist ausgerechnet der, dem A1 das Führungs-Tablet und den Handschuhbetrieb zuweist. Beides → **B5 (LFH-333)**, das die sichtbare Beschriftung und die Berührungsbedienung führt |
| 6  | **erfüllt**           | Jede Statusfarbe der Familie trägt einen zweiten Kanal: die aktive Stufe beider Umschaltgruppen steht als **Text** im Eintrag (`✓`, `BenutzerMenu.tsx:42-59`, mit genau dieser Begründung im Kommentar), die Rollenplaketten tragen „Admin"/„Führungskraft" (`:105/:112`), die Sperre eines Moduls hängt an `disabled` + `title="Keine Berechtigung"` und nicht am Emoji (`ModulPanel.tsx:55-56`, `:89-93` ist ausdrücklich `aria-hidden`). Bewusst **nicht** hierunter gefasst: der hervorgehobene Navigationseintrag (`ModulPanel.tsx:69-70`, `ModulAkkordeon.tsx:83-84`, `IconRail.tsx:52-53`) unterscheidet sich visuell nur über Grund und Textfarbe. Er trägt `aria-current`/`aria-expanded`, was Hilfsmittel erreicht, nicht das Auge — aber er ist keine **Status**farbe im Sinn des Kriteriums (Alarm/Achtung/Normal), sondern Bedienung in Blau. Dieselbe Lesart wie in den beiden Vorgängerlisten. Ausdrücklich mitgeprüft, weil derselbe Wahlvorgang zwei Gestalten hat: im Benutzermenü trägt die aktive Stufe Text (`✓`), in der Kopfzeile rendert `etikett()` nur ein Symbol (`ThemeToggle.tsx:32-43`) — dort ist der zweite Kanal die **Form**, nämlich die Lage des gewählten Segments in einer Dreierleiste, und Form ist einer der drei vom Kriterium zugelassenen Kanäle. Dass diese Fläche zu schwach vom Track absteht, ist eine Kontrastfrage und steht als gemessene 1,40 : 1 in Zeile 5, nicht hier |
| 7  | **erfüllt**           | Der `rollen.css`-Diff führt keinen Farbwert ein oder um (gemessen, s. Zeile 5); Grund ist weder `#000000` noch `#ffffff` (`rollen.css:25/85`). Die Zuordnung bleibt eindeutig: der aktive Rail-Zustand kommt aus `farbenDunkel.bedien` mit dem im Dateikopf gemessenen 8,67 : 1 (`IconRail.tsx:47-53`) — Marke bleibt beim Avatar (`BenutzerMenu.tsx:87`), Alarm bleibt Gefahr                                                                       |
| 8  | **offen**             | Es gibt keinen Helligkeits-/Kontrastregler in der Anwendung. Diese Familie ist der Ort, an dem er entstünde — sie trägt bereits die Farbschema-Achse (`ThemeToggle.tsx:85-93`) und den Provider dahinter (`ThemeModeProvider.tsx`). A1 verweist ihn ausdrücklich weiter → **eigener Folge-Task** („Was diese Leitlinie nicht entscheidet")                                                                                                          |
| 9  | **erfüllt**           | Die Alarm-Zentrale steht oben in der Kopfzeile, an derselben Stelle wie in Ebene 1, und bleibt **auch unter `lg` stehen**, während beide Umschalter weichen (`EinsatzLayout.tsx:186-194`, gepinnt von `EinsatzLayout.test.tsx:254`). Der Verbindungsbanner sitzt direkt darunter im Fluss (`EinsatzLayout.tsx:196`), nicht am Layoutrand                                                                                                            |
| 10 | **nicht anwendbar**   | Der Rahmen erzeugt keine Alarme — er hängt den Auslöser ein (`EinsatzLayout.tsx:191`). Die Toasts kommen aus `einsatz/AlarmZentrale.tsx` (Bestand, nicht Teil dieses Pakets); welches Ereignis welche Priorität trägt, entscheidet **B6 (LFH-334)** am Ereignis-Inventar, so wie A1 es vorsieht                                                                                                                                                     |
| 11 | **erfüllt**           | Der Rahmen **selbst** setzt keine Bewegung und keinen Ton: gemessen **0** Treffer für `animation`, `keyframes`, `blink` und `Audio` in den zehn Dateien **und** in `AlarmZentrale.tsx` — also kein Blinken auf lesbarem Text, keine Blinkrate zu begrenzen, keine tonlose Warnung. Wie in Zeile 13 gilt die Messung für den eigenen Quelltext, nicht für antds Stilblatt; die eine Stelle, die dort blinken könnte, ist bewusst die statische Variante: `Badge dot status="error"` (`AlarmZentrale.tsx:118`), nicht die pulsende. Warnungen erscheinen als Text: der Verbindungsbanner als `Alert` mit Symbol (`LiveStatusBanner.tsx:29-38`), die Alarme als schließbare `notification`-Einträge (`AlarmZentrale.tsx:38-39`). Geprüft und bewusst so gelassen: der Verbindungsbanner ist **nicht** quittierbar — er spiegelt einen anhaltenden Zustand und verschwindet mit ihm (`LiveStatusBanner.tsx:26`); eine quittierte, aber weiter tote Leitung wäre die gefährlichere Anzeige |
| 12 | **teilweise erfüllt** | Die Breitenweiche selbst springt **nicht**: `Grid.useBreakpoint` korrigiert im `useLayoutEffect` (`node_modules/antd/es/grid/hooks/useBreakpoint.js`), also vor dem Paint, und `useViewport` wertet „noch unbekannt" bewusst als breit (`useViewport.ts:72-74`). Zwei Sprünge bleiben: der Verbindungsbanner wird zwischen Kopfzeile und Inhalt **eingeschoben** und schiebt die ganze Fläche nach unten (`EinsatzLayout.tsx:196` mit `LiveStatusBanner.tsx:26`) → **B6 (LFH-334)**; und `modulOverrides` kommt ohne Ladezustand nach (`EinsatzLayout.tsx:133-136` → `ModulPanel.tsx:44`), ein Navigationseintrag kann also nach der Antwort verschwinden → **B3 (LFH-331)**. Ein CLS-Wert ist für diese Familie nicht gemessen — jsdom rechnet kein Layout, und `gate1-ueberlauf.spec.ts` misst Breite, nicht Verschiebung |
| 13 | **teilweise erfüllt** | Der Rahmen setzt **selbst** kein fixiertes Element: gemessen **0** `position:`-Angaben in den zehn Dateien. Das eine Konstrukt, auf das WCAG 2.4.11 zielt, bringt antd mit — der Navigations-Drawer liegt über der Fläche. Die halbe Zusicherung ist belegt: geschlossen steht er gar nicht im Baum (`destroyOnHidden`, kein Vorab-Rendern, `EinsatzLayout.tsx:230-239`; gepinnt von `EinsatzLayout.test.tsx:240` „hinterlässt keine zweite Navigation"), es gibt also keine zweite, verdeckte Fokuskopie. Ein **Tab-Durchlauf bei offenem Drawer** ist nicht gemessen → **B7 (LFH-335)**. Bewusst ein anderes Zielticket als in der Katalogtabellen-Liste, die dasselbe Kriterium nach B2 schickt: dort ist das fixierte Konstrukt Teil des Tabellen-Primitivs, hier ist es die Fokusreihenfolge hinter einem Drawer und damit Tastaturbedienung |
| 14 | **nicht anwendbar**   | Der Rahmen trägt keine Tabelle — er trägt die Fläche, in der eine steht. Für LFH-329 wird Kriterium 14 in `2026-07-28-katalogtabellen-pruefliste.md` bewertet; die beiden Listen teilen sich das Ticket, nicht die Zeile                                                                                                                                                                                                                            |
| 15 | **nicht anwendbar**   | Der Rahmen trägt keine Erfassungsmaske. Die Umschalter in Kopfzeile und Benutzermenü sind Einstellungen mit sofortiger Wirkung, kein Formular: es gibt nichts vorzubelegen, nichts zu speichern und keine Sammelliste. Kriterium 15 ist für LFH-329 in der Katalogtabellen-Liste bewertet                                                                                                                                                          |

## Belege

Maschinell gepinnt sind die Zeilen 1, 2, 6, 9 und die belegte Hälfte von 13:

- `frontend/src/einsatz/EinsatzLayout.test.tsx` — die Breitenweiche in beiden Richtungen:
  ab `lg` inline und ohne Griff, darunter Drawer statt inline-Rahmen, Ablegen der Umschalter
  bei stehenbleibender Alarm-Zentrale, Schließen beim Modulklick **ohne** zweite Navigation
  im Baum, und die 48-px-Trefflächen an Griff und Schließer.
- `frontend/src/einsatz/ModulAkkordeon.test.tsx` — flaches Akkordeon: `aria-expanded`, Module
  nur unter der offenen Kategorie, Trefffläche der Kopfzeilen auf dem A1-Maß, fluide Breite.
- `frontend/src/theme/ThemeModeProvider.test.tsx` — die Dichteachse als Zustand (Default,
  Persistenz, Rückfall bei unbekanntem Wert) und ihre drei Austritte: `ConfigProvider`,
  `<html>`-Merkmal, Trennung von der Theme-Achse. Die Literal-Gegenprobe auf 72 px liegt hier.
- `frontend/src/components/ThemeToggle.test.tsx` · `BenutzerMenu.test.tsx` — beide Bedienwege
  der Dichte, jeweils mit eigener Beschriftung und ohne Übergriff auf die andere Achse;
  `command-palette/befehle.test.ts` deckt den dritten ab.
- `frontend/src/components/useViewport.guard.test.ts` — der Rahmen fragt die Breite an genau
  einer Stelle; eine zweite, handgeschriebene Abfrage bricht den Test.
- `frontend/src/theme/rollen.guard.test.ts` · `seitenrinne.guard.test.ts` ·
  `kopfpolsterung.guard.test.ts` — die beiden Viewport-Achsen der CSS-Seite gegen antds
  Schwellen, und die Dichteblöcke als Partition gegen einsickernde Fremdwerte.
- `frontend/e2e/gate1-ueberlauf.spec.ts` — die einzige Ebene, die Layout rechnet: vier Routen
  (Ebene-1-Shell, Lagebild, Modulseite, Verwaltung) × drei Prüfbreiten (1366 / 1024 / 390 px),
  Messung an `documentElement`, mit benannten Verursachern im Fehlerfall. Gate 1 ist damit
  belegt, nicht behauptet — der Lauf gehört zum Abschlussschritt des Pakets.

## Nachtrag 31.07.2026 — was B5j (LFH-370) an dieser Liste eingelöst hat

Diese Liste gab zwei Zeilen ausdrücklich an B5 ab. **Z2 ist eingelöst**, Z5 bleibt offen.

**Zeilenverweise nachgezogen.** Die Liste zitierte `tokens.ts:133` (72 px) und `tokens.ts:142`
(`abstand` = kompakt); beide Stellen liegen heute auf `:161` bzw. `:171`. `ModulAkkordeon.tsx:44/75`,
`IconRail.tsx:45`, `ModulPanel.tsx:46` und `ThemeToggle.tsx` stimmten weiterhin — bis B5j sie
angefasst hat (s. u.).

### Z2 — der Rahmen folgt jetzt der Stufe

| Stelle | vorher | nachher |
| --- | --- | --- |
| Modulzeile inline (`ModulPanel.tsx`) | `minHeight: undefined` — **gar kein Boden** | `Math.max(mindestTrefflaeche ?? 0, token.controlHeight)` → 30 / 48 / 72 |
| Spaltenabstand der Modulliste | `gap: 2` fest | `token.marginXS` → 3 / 5 / 7 |
| Segment-Ziel der Kopfzeile | 26×38 / 44×38 / 68×38 | 30×38 / 48×48 / 72×72 |
| Abstand der zwei Umschaltgruppen | `size={4}` | `size="large"` → 18 / 28 / 44 |
| `.lfh-knopf` (`sprache.css`) | `min-height: 32px`, gemessen 32/32/32 | `var(--lfh-zeilenhoehe)` → 30 / 48 / 72 |
| `.lfh-kachel__mehr` | **keine** Mindesthöhe, gemessen 19,6 px | `var(--lfh-zeilenhoehe)` |

**Die Auflösung des Widerspruchs in dieser Zeile.** Z2 verlangte, dass auch die 48-px-Konstanten
in `ModulAkkordeon.tsx:44` und `IconRail.tsx:45` der Stufe folgen, während beide Dateiköpfe
ausdrücklich begründen, warum die 48 dort FEST steht („das ist eine Trefffläche, keine
Dichte-Angabe"). Beides zugleich geht nicht. Entschieden ist zugunsten der Dateiköpfe, aber
ohne die Lücke zuzudecken:

- Die 48 ist ein **Boden**, kein Ersatz für die Stufe. `mindestTrefflaeche` hebt die Zeile an,
  senkt sie aber nie — in `handschuh` gilt 72, nicht 48. Genau daran wäre die naheliegende
  Formel `mindestTrefflaeche ?? token.controlHeight` gescheitert; sie hätte im Handschuh-Betrieb
  auf 48 gedeckelt.
- **Was offen bleibt:** IconRail, Hamburger, Drawer-Schliesser und `ModulAkkordeon` stehen
  weiterhin fest auf 48 und unterschreiten damit in `handschuh` die geforderten 72. Das ist keine
  stille Dauerausnahme, sondern ein benannter Rest → **LFH-384**. Der e2e-Nachweis nimmt diese
  vier Stellen im Handschuh-Durchgang ausdrücklich aus; er wäre dort per Konstruktion rot.

### Was diese Prüfliste nicht beweist

- Der e2e-Nachweis (`e2e/trefflaeche-tablet.spec.ts`) misst die Modulzeilen des **inline**-Rahmens
  und die Aktionsknöpfe **einer** Bestätigungsblase, nicht jedes fokussierbare Element jeder Route.
- Die `sprache.css`-Messungen stammen aus einer Chromium-Probe mit derselben Verschachtelung wie
  `LageDashboardPage.tsx`, nicht aus der laufenden Seite: Rasterwirkungen der sechsspaltigen Leiste
  sind damit **nicht** gemessen.
- Die **Breite** beschrifteter Knöpfe folgt der Beschriftung, nicht der Dichteachse (antds
  `paddingInlineSM` ist ein Literal). Der OK-Knopf einer Bestätigungsblase bleibt rund 38 px breit
  in jeder Stufe. Verdikt: **offen → LFH-381** (Systemlösung ist ein Komponenten-Token oder ein
  `minWidth` am kleinen Knopf, nicht ein `okText` je Aufrufstelle).
- Der **Switch** folgt der Staffel ebenfalls nicht: antd rechnet seine Höhe aus der Schrift
  (`fontSize × lineHeight`), gemessen 21 / 24 / 24 px. B5j hat die ZEILE um den Schalter auf den
  Boden gehoben, das Steuerelement selbst bleibt darunter. Verdikt: **offen → LFH-380**.

### Gemessene Baseline am 31.07.2026

| Gemessen mit | vorher | nachher |
| --- | --- | --- |
| `dichte.guard.test.ts` — Schuldmenge `OFFEN` | 24 Stellen in 13 Dateien | **10 Stellen in 4 Dateien** |
| davon Bündel B5j | 14 Stellen in 9 Dateien | **0** |
| harte `min-height`-Pixel in `sprache.css` | 2 | **0** |

Rest sind `pages/uhs/Grundriss.tsx` (geprüfte Dauerausnahme aus B5g), `pages/gefahren/*` (B5h /
LFH-368, noch in Arbeit) und `pages/MaterialPage.tsx` (B5i).

## Was offen bleibt und wohin es geht

Die Zeilennummern stehen hier als `Z…`: das Gate zählt die Zeilen der Prüfliste über ihre
führende Nummer, und eine Zusammenfassung im selben Format zählte doppelt.

| Zeile   | Offener Punkt                                                          | Zielticket |
| ------- | ---------------------------------------------------------------------- | ---------- |
| ~~Z2~~  | ~~Rahmen-Trefflächen und -Abstände folgen der gewählten Stufe nicht~~ — **erledigt in B5j (LFH-370)**, siehe Nachtrag unten | B5j ✓      |
| Z2      | 1024 px bekommt die Zweispalten-Ansicht des Handschirms                 | C2         |
| Z3, Z12 | Modul-Overrides ohne Lade- und Fehlerzustand                           | B3         |
| Z5      | gesperrter Verwaltungs-Link 3,18 : 1; gewähltes Segment 1,40 : 1       | B5         |
| Z8      | kein Helligkeits-/Kontrastregler                                       | Folge-Task |
| Z12     | Verbindungsbanner schiebt die Fläche; kein CLS-Wert gemessen           | B6         |
| Z13     | Tab-Durchlauf bei offenem Navigations-Drawer nicht gemessen            | B7         |
