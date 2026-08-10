# LFH-337 · Prüfliste Einsatztauglichkeit

Angelegt an den Navigationsrahmen, den LFH-337 umgebaut hat: Kategorie-Rail
(`einsatz/IconRail.tsx`), Modul-Panel (`einsatz/ModulPanel.tsx`), beide Kopfzeilen
(`components/AppLayout.tsx`, `einsatz/EinsatzLayout.tsx`) und die Befehlspalette
(`command-palette/*`). Kriterien wörtlich aus
`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md` (Festlegung 7,
Zeilen 378–412) — Nummerierung und alle inhaltlichen Klauseln sind dort übernommen,
nicht neu erfunden. Gekürzt sind ausschließlich die Standard-Zitate in runden Klammern
(MIL-STD-1472F-Absätze, WCAG-Kriteriennummern, EEMUA/ISA-Referenzen) — keine
Anforderungsklausel selbst. **Korrektur nach Review:** ein erster Entwurf dieses
Dokuments hatte für die Zeilen 8, 10, 11, 14 und 15 versehentlich auch substanzielle
Klauseln mitgekürzt (z. B. „1 Regler, 1 Sperre" bei Kriterium 8, die Blinkraten-Klausel
bei Kriterium 11); das ist in der aktuellen Fassung nachgezogen. Form nach dem
Präzedenzfall `docs/superpowers/specs/2026-08-08-lfh336-pruefliste-einsatztauglichkeit.md`.

„Nicht geprüft" ist kein Verdikt (CLAUDE.md). Jede Zeile trägt `erfüllt` / `offen →
Zielticket` / `nicht anwendbar`, je mit Beleg oder Begründung in einem Satz. Anders als
bei einer Datenseite trägt der Navigationsrahmen keine Alarme, Tabellen, Erfassungsmasken
oder kritischen Aktionen — mehrere Zeilen sind deshalb ehrlich `nicht anwendbar`, nicht
`erfüllt` durch Auslassung.

## Prüfliste

| # | Kriterium | Verdikt | Begründung |
|---|---|---|---|
| 1 | **Treffläche** — Boden ≥ 24 × 24 CSS px oder 24-px-Umkreis frei; zeitkritische Aktion ≥ 48 × 48 px mit ≥ 8 px Abstand. | **erfüllt** | Die Rail trägt den Boden über die reine, exportierte Funktion `railZielStil` mit `Math.max(48, token.controlHeight)` — direkt als Rückgabewert gepinnt in `IconRail.test.tsx` (`hoehe('kompakt')` = 48, `hoehe('komfortabel')` = 48, `hoehe('handschuh')` = 72), kein Rendering nötig, da die Funktion pur ist. `CommandPaletteTrigger.tsx` trägt unter `lg` einen festen 48-px-Boden (Test „bleibt unter lg eine benannte 48-px-Icon-Trefflaeche"). Modul-Panel-Zeilen (inkl. der neuen „Zuletzt"-Zeile, die dieselbe `ModulListe` nutzt) erben den Boden unverändert aus LFH-329/365. |
| 2 | **Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px, Abstand ≥ 16 px. | **offen → LFH-396** (<https://app.clickup.com/t/86cb2q96u>) | Der Mechanismus ist vorhanden und in Vitest gepinnt (siehe Zeile 1: `hoehe('handschuh')` = 72, Padding `16px 8px`). Im Browser ist er für diese Route nicht gemessen: `e2e/trefflaeche-tablet.spec.ts` grenzt sich ausdrücklich gegen die IconRail ab („Alle drei sind an ihrer Fundstelle ausdrücklich als Trefffläche und NICHT als Dichte-Angabe festgeschrieben"), `e2e/nav-schmal.spec.ts` misst nur die 48-px-Stufe auf schmalem Schirm, kein Test in beiden Dateien setzt `handschuh`-Dichte. Dieselbe Lücke, die LFH-336 für Lage-Dashboard/Einsatzliste bereits unter LFH-396 gebündelt hat — hier gehört die Rail/das Panel/die Kopfzeilen/die Palette dazu. Zusätzlicher Befund dazu unten unter „Offene Nachzüge". |
| 3 | **Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms; Kommandoreaktion ≤ 2 s; > 15 s nur mit Fortschrittsmeldung. | **nicht anwendbar** | Rail-Klick, Panel-Klick, Kopfzeilen-Klick und Paletten-Öffnen sind reine Client-Navigationen (`react-router`) ohne Serverantwort im Bedienpfad selbst — es gibt keine Wartezeit, die eine Rückmeldung bräuchte. |
| 4 | **Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung. | **nicht anwendbar** | Der Navigationsrahmen führt keine kritische oder irreversible Aktion aus — er navigiert und merkt Besuche (`localStorage`). |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1; Zustände, Rahmen, Fokusring ≥ 3 : 1. | **offen → Zielticket** (neu anzulegen) | Der gesperrte Link nutzt `farbenDunkel.schwach` = 5,30 : 1 gegen den Kopfzeilengrund `#001529` (Rechnung unten bei AK6/Nachweis). Das erreicht die Nacht-/Minimalschwelle (≥ 5 : 1, nie < 4,5 : 1), **verfehlt aber die Tag-Schwelle (≥ 7 : 1) deutlich**. Ein erster Entwurf dieser Zeile trug „erfüllt" mit der Begründung, die Kopfzeile bleibe in beiden App-Farbmodi dunkel (`farbenDunkel`, nicht der moduswechselnde Token) — das hält der Prüfung nicht stand: die Tag-Schwelle existiert wegen der **Umgebungshelligkeit** (Fükw bei Tageslicht gelesen), nicht wegen des gewählten Farbtokens. Eine dauerhaft dunkle Fläche wird tagsüber trotzdem bei Tageslicht gelesen. **Offene Frage fürs Zielticket:** Gilt für eine app-modus-unabhängig dunkle Fläche wie die Kopfzeile die Tag- oder die Nacht-Schwelle aus Kriterium 5? Falls Tag: `farbenDunkel.schwach` (5,30 : 1) reicht dann nicht — es bräuchte einen helleren Wert, der trotzdem als „gesperrt" von der weißen aktiven Beschriftung unterscheidbar bleibt. **Kein Rückbau von Task 2:** 5,30 : 1 ist gegenüber dem abgelösten `rgba(255,255,255,0.35)` (≈ 3,17 : 1) eine klare Verbesserung und liegt über der harten Untergrenze 4,5 : 1 — die Umsetzung ist nicht falsch, die Schwellenfrage ist ungeklärt. Der Rail-Aktivzustand nutzt unverändert `farbenDunkel.bedien` (8,67 : 1, aus LFH-328/A2 gemessen, in `IconRail.test.tsx` per Rollenvergleich gepinnt) — diese Zahl liegt über beiden Schwellen und ist von der offenen Frage nicht betroffen. |
| 6 | **Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen. | **nicht anwendbar** | Der Navigationsrahmen zeigt keine Statusfarben im Sinne von Festlegung 5 (Alarm/Achtung/Normal). Der aktive Rail-Zustand trägt zusätzlich `aria-current="true"` und die sichtbare Beschriftung bleibt in jedem Zustand gleich lesbar — kein Zustand ist nur über Farbe unterscheidbar. |
| 7 | **Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche weder `#000000` noch `#ffffff`. | **erfüllt** | `grep -rniE '#([0-9a-f]{3}){1,2}\b'` über `IconRail.tsx`, `ModulPanel.tsx`, `AppLayout.tsx`, `EinsatzLayout.tsx`, `CommandPaletteTrigger.tsx`, `command-palette/*.tsx` liefert nur `#fff` (Logo/freier Link) und `#001529` in Kommentaren — keine gesättigte Statusfarbe, keine Doppelbelegung. Der Kopfzeilengrund `#001529` ist weder reines Schwarz noch reines Weiß. |
| 8 | **Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre. | **offen → LFH-397** (<https://app.clickup.com/t/86cb2qcq9>) | App-weite, bereits unter LFH-336 dokumentierte Lücke — kein Regler existiert irgendwo in der Anwendung, also erst recht keine Sperre gegen Herunterdimmen bei aktiver Warnung. Nicht seitenspezifisch und nicht im Scope von LFH-337; dasselbe Ticket trägt sie bereits. |
| 9 | **Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand. | **nicht anwendbar** | Der Navigationsrahmen zeigt keine Lagebild-Kennzahlen — er ist reine Navigationsstruktur (Rail, Panel, Kopfzeilen, Palette), keine „kritische Anzeige" im Sinne des Kriteriums. |
| 10 | **Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, < 10 in den ersten 10 min einer Großlage, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen. | **nicht anwendbar** | Der Navigationsrahmen erzeugt keine Alarme — weder im Dauerbetrieb noch in den ersten 10 Minuten einer Großlage; es gibt kein Alarmvolumen, keine Eskalationsstufen und keine Flatter-Alarme zu bemessen. |
| 11 | **Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten (schnellere ≤ 5 Hz, langsamere ≥ 0,8 Hz), jede Warnung quittierbar, jeder Ton mit visueller Entsprechung. | **erfüllt** | `grep -rn "animation\|blink\|@keyframes"` über die fünf Kerndateien liefert 0 Treffer — kein Blinken, keine Animation auf lesbarem Text. Die Blinkraten-Klausel ist damit gegenstandslos, nicht gesondert geprüft: ohne jede Animation gibt es keine Rate zu messen. Warnungen/Töne kommen im Navigationsrahmen nicht vor. |
| 12 | **Kein Sprung unter dem Cursor** — CLS ≤ 0,1; neue Datensätze nur als opt-in-Sammelbanner. | **erfüllt** | Kein SSE-getriebenes Nachladen verändert Reihenfolge oder Position von Rail-, Panel- oder Kopfzeilen-Elementen, während sie sichtbar sind. Die „Zuletzt"-Liste liest `localStorage` nur beim Mounten von `EinsatzLayout` (Navigationswechsel), nicht live während des Lesens; ein Wechsel entsteht ausschließlich durch die eigene Klickaktion der Person, nicht durch ein externes Ereignis unter dem Cursor. Die (bestehenden, nicht in diesem Branch geänderten) WIP-Zähler im Modul-Panel aktualisieren einen Zahlenwert in fester Zeilenposition, keine Layoutverschiebung. Anders als bei Kriterium 3/4/9/10 (wo das Konzept selbst nicht greift) gibt es hier tatsächlich live nachladende Elemente im Bezugsraum — sie wurden geprüft und für unschädlich befunden, das ist ein positiver Befund, kein Wegfall des Kriteriums. Kein CLS-Zahlenwert gemessen (kein Observer im Repo), aber kein struktureller Mechanismus, der unter dem Cursor umsortieren könnte. |
| 13 | **Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter fixierten Köpfen, Fußleisten oder Drawern. | **erfüllt** | `grep -n "position:"` über die fünf Kerndateien liefert 0 Treffer — kein selbst gesetztes `position: fixed`/`sticky`. Der mobile Navigations-Drawer (`EinsatzLayout.tsx`, antds `Drawer`) ist die dokumentierte Ausnahme aus CLAUDE.md („Der Navigations-Drawer"): er zeigt Navigation statt einer Entität, verdeckt Inhalt nur während er offen ist, und antds `Drawer` trägt einen eingebauten Fokus-Trap — kein Fokusziel bleibt unerreichbar verdeckt. |
| 14 | **Tabellenseite vollständig** — fixierte Kopfzeile, fixierte menschenlesbare Identifierspalte, umschaltbarer Spaltensatz mit Zähler ausgeblendeter Spalten, keine Auflösung in Karten, wo verglichen wird. | **nicht anwendbar** | Keine `<Table>` im Navigationsrahmen (`grep -rn "<Table"` über die fünf Kerndateien → 0 Treffer; ein loses `grep "Table"` liefert zwei Fehltreffer aus „Führungs-**Tablet**" in Kommentaren, kein Komponenten-Treffer). Ohne Tabelle entfallen Kopfzeile, Identifierspalte, Spaltenschalter und die Vergleichsfrage („wo verglichen wird") gemeinsam — der Navigationsrahmen ist Navigation, kein Vergleichsinstrument. |
| 15 | **Erfassungsmaske vollständig** — Defaults vorbelegt, sichtbar und einzeln überschreibbar, „Speichern und nächsten anlegen" mit gehaltenem Kontext, Sammelliste mit Ändern/Entfernen je Zeile, Labels über dem Feld, volle Tastaturbedienung. | **nicht anwendbar** | Keine Erfassungsmaske im Navigationsrahmen; das Suchfeld der Befehlspalette ist ein Filter über bestehende Befehle/Module, kein Datenerfassungsformular — es legt nichts an, hat keine Defaults, kein „Speichern und nächsten" und keine Sammelliste im Sinne des Kriteriums. |

**Verteilung:** 5 erfüllt (1, 7, 11, 12, 13), 3 offen (2, 5, 8 — je mit Zielticket, zwei
davon bestehend), 7 nicht anwendbar (3, 4, 6, 9, 10, 14, 15).

Eine Prüfliste, die hier 15-mal „erfüllt" behauptet hätte, wäre unglaubwürdig — der
Navigationsrahmen berührt naturgemäß nur einen Teil der 15 Kriterien inhaltlich (keine
Tabellen, Formulare, Alarme, kritischen Aktionen), und selbst innerhalb der berührten
Kriterien bleiben zwei echte Lücken: Kriterium 2 (kein Browser-Test in
Handschuh-Dichte) und Kriterium 5 (die Kontrastschwelle für eine app-modus-unabhängig
dunkle Fläche ist selbst ungeklärt, nicht nur ihr Nachweis).

## AK-Korrekturen

Sechs Korrekturen an den ursprünglichen Akzeptanzkriterien des Tickets — je mit
Begründung, warum das **AK** und nicht die Umsetzung falsch war.

**1. AK2 ist durch LFH-335/B7 überholt.** Der im Ticket geforderte Grep

```bash
grep -rc 'Strg+K\|⌘K' frontend/src/components/AppLayout.tsx frontend/src/einsatz/EinsatzLayout.tsx
```

liefert tatsächlich (siehe Nachweis unten) 0 in beiden Dateien — und das ist **richtig
so**: der Wortlaut („Suchen", `⌘K`/`Strg+K`, `Tastenkuerzel`-Marke, `aria-keyshortcuts`,
48-px-Trefffläche unter `lg`) steht seit LFH-335 in der gemeinsamen
`components/CommandPaletteTrigger.tsx`, die in **beiden** Kopfzeilen hängt
(`AppLayout.tsx`, `EinsatzLayout.tsx`). Zwei Kopien desselben Textes in den Layouts
wären eine Verschlechterung — genau die Art Duplikat, die eine gemeinsame Komponente
verhindern soll. Das AK hat die falsche Datei geprüft, nicht die Umsetzung war falsch.
Ersatz-Grep, der dieselbe Sache misst (Nachweis unten): `CommandPaletteTrigger.tsx`
trägt den Wortlaut, und beide Layout-Dateien binden die Komponente ein.

**2. To-do 2 des Tickets** („Such-Trigger in beide Topbars", inkl. „RTL-Test: Klick
öffnet die Palette") **war bei Ticketbeginn bereits erfüllt.** `git log -S"haelt den
A1-Boden"` u. Ä. zeigt: `CommandPaletteTrigger.test.tsx` samt Test „öffnet die Palette
per Klick und übergibt ihr den Fokus" existiert seit Commit `d425e969`
(`feat(lfh-335): verbessere Tastaturbedienung und Enter-Vertrag`) — vor dem ersten
LFH-337-Commit (`9b9c2a66`). Kein Umsetzungsfehler in LFH-337; das Ticket beschrieb
etwas, das ein Vorgänger-Ticket bereits geliefert hatte.

**3. `einsatz/ModulRedirect.tsx` kam zum Umfang hinzu** — nicht im Ticket genannt, aber
im Grep-Radius von AK3 (`frontend/src/einsatz`). Die Datei baut einen
Einsatz-Modul-Pfad für einen Deep-Link-Redirect und hätte, wäre sie ausgelassen worden,
die geforderte Null-Treffer-Zahl für Inline-Pfade verfehlt. Kein AK-Fehler im engeren
Sinn, aber eine Lücke in der Aufzählung, die die Umsetzung schließen musste, um das AK
überhaupt erfüllbar zu machen.

**4. Die beschriftete Rail-Spalte ab ≥ 1280 px entfällt.** Im Ticket ausdrücklich als
„optional" markiert; vom Menschen im Vorab-Klärungsblock des Plans bestätigt entschieden
(`docs/superpowers/plans/2026-08-10-lfh-337-navigationsrahmen-direktzugriff.md:58-60`).
Begründung: eine Darstellung für alle Breiten ist einfacher als eine dritte
Breitenweiche im Navigationsrahmen (neben der bestehenden Drawer-Grenze aus LFH-329),
und das Ticket verlangte die breitere Variante nicht verbindlich. Kein
Umsetzungsdefizit — eine bewusst nicht gebaute Option.

**5. Die Kontrastzahl aus AK6 ist gerechnet, nicht getestet** — jsdom rechnet keine
Farbmischung, ein Vitest-Test kann das Verhältnis nicht direkt prüfen. Nachrechnung
(Zwischenwerte):

- `farbenDunkel.schwach` = `#7d8b9b` → relative Leuchtdichte `L = 0,2520` (via
  sRGB-Linearisierung, WCAG-Formel).
- `#001529` (Kopfzeilengrund) → `L = 0,006964`.
- Kontrast = `(0,2520 + 0,05) / (0,006964 + 0,05) = 5,30 : 1`.
- Zum Vergleich der abgelöste Wert `rgba(255,255,255,0.35)` über `#001529` (Alpha-Blend
  gegen den Grund vor der Luminanzrechnung): gemischtes RGB ≈ `(89, 103, 116)`,
  `L ≈ 0,1308`, Kontrast `≈ 3,17 : 1` — passt zur im Plan/Brief genannten „~3,2:1".

Eigene Nachrechnung bestätigt exakt **5,30 : 1** aus dem Brief (siehe Report für die
vollständige `python3`-Rechnung). Über dem geforderten 4,5 : 1, ohne jsdom-Test möglich.

**6. Umfangserweiterung, im Brief noch nicht dokumentiert: Doppelnennung im
„Zuletzt"-Pfad gegen die offene Kategorie gefiltert.** Das Review von Task 5 fand einen
Bedienbefund, den das Ticket nicht vorsah: ohne Filter hätte die „Zuletzt"-Zeile ein
Modul doppelt gezeigt, sobald ein zuletzt besuchtes Modul in der gerade offenen
Kategorie liegt — zwei Bedienziele mit identischem Namen im selben Panel
(`einsatz/ModulPanel.tsx`). Controller-Entscheidung (Ledger, Task 5): gegen die
**offene** Kategorie filtern, weil „Zuletzt" die Abkürzung zu dem ist, was **nicht**
ohnehin sichtbar ist — ein Modul zwei Zeilen tiefer in derselben aufgeklappten Liste
verkürzt keinen Weg, es verdoppelt nur ein Bedienziel. Umgesetzt in Commit `6eb1df5a`
(`fix(lfh-337): filtert Zuletzt-Module gegen die offene Kategorie`). Diese
Umfangserweiterung war zum Ticketbeginn nicht vorhersehbar — sie entstand erst aus der
tatsächlichen Interaktion von „Zuletzt" mit einer bereits aufgeklappten Kategorie.

## AK-Nachweis (tatsächliche Grep-Ausgaben)

Alle vier im Brief geforderten Kommandos, mit der **tatsächlichen** Ausgabe (nicht der
erwarteten):

```
$ grep -rc '/einsaetze/\${' frontend/src/einsatz frontend/src/command-palette
```
Alle 44 aufgelisteten Dateien: `0` (kein einziger Treffer über beide Verzeichnisse) —
erwartet 0, **erfüllt**. Zusätzlich durch den Quelltext-Guard
`routing/inlinePfade.guard.test.ts` maschinell gepinnt (Test „baut keinen Pfad als
Inline-Template-Literal").

```
$ grep -c 'rgba(255,255,255,0.35)' frontend/src/components/AppLayout.tsx
0
```
Erwartet 0 — **erfüllt**.

```
$ grep -c 'einsatzPfad' frontend/src/routing/deeplinks.ts frontend/src/routing/deeplinks.test.ts
frontend/src/routing/deeplinks.ts:1
frontend/src/routing/deeplinks.test.ts:3
```
Erwartet > 0 in beiden Dateien — **erfüllt**.

```
$ grep -c 'Strg+K\|⌘K' frontend/src/components/CommandPaletteTrigger.tsx
3
```
Erwartet > 0 — **erfüllt**. Alle vier Greps stimmen exakt mit der Erwartung überein,
keine Abweichung.

### AK2-Ersatz-Grep (siehe Korrektur 1)

```
$ grep -rc 'Strg+K\|⌘K' frontend/src/components/AppLayout.tsx frontend/src/einsatz/EinsatzLayout.tsx
frontend/src/components/AppLayout.tsx:0
frontend/src/einsatz/EinsatzLayout.tsx:0

$ grep -c 'Strg+K\|⌘K' frontend/src/components/CommandPaletteTrigger.tsx
3

$ grep -lc 'CommandPaletteTrigger' frontend/src/components/AppLayout.tsx frontend/src/einsatz/EinsatzLayout.tsx
frontend/src/components/AppLayout.tsx
frontend/src/einsatz/EinsatzLayout.tsx
```

Der ursprüngliche Grep liefert 0 in beiden Layout-Dateien (wie im Ticket erwartet, aber
aus dem falschen Grund — dort steht der Wortlaut nie). Der Ersatz-Grep zeigt: die
Kürzel-Marke existiert (3 Treffer in `CommandPaletteTrigger.tsx`), und beide
Layout-Dateien binden die Komponente ein (`grep -l` listet beide). Damit ist dieselbe
fachliche Aussage — „ein Such-Trigger mit Kürzel hängt in beiden Kopfzeilen" — belegt,
nur an der richtigen Stelle gemessen.

## Offene Nachzüge

Was beim Umsetzen liegen geblieben ist. Formuliert so, dass daraus eigenständige
Tickets werden können.

1. **`#001529` ist antds `Layout.Header`-Default, kein Token.** Der Wert steht nur in
   Kommentaren (`AppLayout.tsx:37`, `AppLayout.test.tsx:141`), nicht in
   `theme/tokens.ts` und durch keinen Test gepinnt (`grep -rn '#001529' frontend/src/`
   findet ihn ausschließlich in Kommentaren). Die 5,30 : 1-Kontrastaussage für den
   gesperrten Link hängt an diesem ungeprüften Wert — ein künftiges
   `Layout.Header`-Theme-Override entwertete die Aussage lautlos, ohne dass ein Test
   rot würde. Zielticket-Kandidat: `#001529` als benannten Token führen oder den
   tatsächlich gerenderten Grund per Browser-Test messen.
2. **`einsatz/ModulRedirect.tsx:13` nutzt `Number(id)` statt `parseRouteId`.** Der
   projektweite Deep-Link-Vertrag (`routing/deeplinks.ts`) verlangt validierte,
   positive Ganzzahl-IDs über `parseRouteId`; `ModulRedirect` liest den Route-Param
   direkt und wandelt ihn roh um. Bei einer nicht-numerischen Route-ID liefert
   `Number(id)` `NaN`, was vor wie nach dieser Änderung bereits kaputt war (kein neuer
   Fehlerzustand) — aber die Stelle weicht vom übrigen Muster ab und sollte beim
   nächsten Anfassen auf `parseRouteId` umgestellt werden.
3. **Kommentar-Nummerierung in `command-palette/befehle.ts:121-152` liest sich
   1, 0, 2, 3, 4, 5.** Der „Zuletzt besucht"-Block wurde als `// 0.` vor den
   bestehenden `// 1. Module`-Kommentar eingeschoben, ohne die Folgekommentare
   (`// 2. Schnellaktionen`, `// 3. Einsatz-Wechsel`, …) umzunummerieren. Rein
   kosmetisch — die tatsächliche Ausführungsreihenfolge im Code ist korrekt (Zuletzt
   vor Module vor Schnellaktionen), nur die Kommentarzahlen stimmen nicht mehr mit der
   Lesereihenfolge überein.
4. **Latenter `verweistAuf`-Fall im neuen Resolver.** `erstesFreigegebenesModul`
   (`einsatz/modulRegistry.ts:177-187`) filtert nach `m.kategorie`, der Aufrufer
   (`EinsatzLayout.tsx`, Rail-Klick-Handler) navigiert anschließend über
   `modulZielRoute(m)`, die bei gesetztem `modul.verweistAuf` in eine **andere**
   Kategorie umleiten kann (`modulRegistry.ts:97`: `verweistAuf ?? route`). Heute nutzt
   kein Registry-Eintrag `verweistAuf`, der Fall ist also nicht erreichbar — aber ein
   künftiger Eintrag mit `verweistAuf` in einer anderen Kategorie würde den
   Rail-Klick-Sprung auf eine Kategorie außerhalb der angeklickten führen, ohne dass
   ein Test das auffinge.
5. **Kein `EinsatzLayout`-Integrationstest für den Null-Zweig des Resolvers**
   (Kategorie ohne freigegebenes Modul). `erstesFreigegebenesModul` gibt in diesem Fall
   `null` zurück; was der Rail-Klick-Handler dann tut, ist auf Unit-Ebene
   (`modulRegistry.test.ts`) geprüft, aber nicht im gemounteten `EinsatzLayout`.
6. **Fünf ASCII-transliterierte Testnamen aus diesem Branch, trotz angekündigtem
   Sweep nicht behoben.** Der Ledger (`progress.md`, Eintrag nach Task 4) vermerkt:
   „SYSTEMATISCH: dasselbe Problem steckt in den Testdateien von Task 1-3 … Sweep NUR
   ueber die in diesem Branch neu geschriebenen Zeilen, als eigener Fix-Dispatch VOR
   dem Final Review." Ein Abgleich (`git log -S` je Testname) zeigt: dieser Sweep hat
   für zwei Dateien nicht stattgefunden. Neu in diesem Branch eingeführt und weiterhin
   ASCII statt Umlaut:
   - `einsatz/IconRail.test.tsx:120,128,132` — „haelt den A1-Boden", „waechst mit der
     Staffel", „traegt ZWEI Angaben" (Commit `5c5d4298`, Task 3).
   - `components/AppLayout.test.tsx:133,147` — „faerbt den gesperrten Link", „zeigt
     fuer Berechtigte" (Commit `b62faab7`, Task 2).
   Andere ASCII-Testnamen in denselben Dateien (z. B. `ModulPanel.test.tsx:37` „listet
   Module, markiert WIP") stammen nachweislich aus dem Bestand vor LFH-337
   (`git log -S` zeigt ältere Commits wie `8b216b4c`/`7d764ea0`) und sind kein
   LFH-337-Befund — nur die fünf oben genannten sind in diesem Branch neu entstanden.
7. **`e2e/trefflaeche-tablet.spec.ts`s Ausschlussbegründung für die Rail ist seit
   Task 3 sachlich überholt.** Der Datei-Kopfkommentar (Zeile ~35) nennt
   `IconRail.tsx:43-45` als Beispiel für eine „bewusst FESTE" 48-px-Trefffläche, die dem
   Handschuh-Test deshalb absichtlich nicht folgt. Seit Commit `5c5d4298` (Task 3) trägt
   `railZielStil` aber `Math.max(48, token.controlHeight)` — die Rail folgt der
   Dichte-Staffel und wächst in Handschuh-Dichte auf 72 px (siehe Kriterium 1 oben,
   Vitest-Beleg). Der Kommentar beschreibt damit nicht mehr den aktuellen Code, und es
   fehlt weiterhin ein Browser-Test, der die jetzt dichte-folgende Rail in
   Handschuh-Dichte tatsächlich auf 72 px misst (derselbe Befund wie Kriterium 2 oben).
   Zielticket-Kandidat: Kommentar korrigieren UND die Rail in den nächsten
   Gate-3-Handschuh-Test aufnehmen — beides gehört unter LFH-396.

**Commit-Message-Sprache (zur Vollständigkeit, nicht als offener Punkt).** Die
Commit-Messages der Tasks 1–5 tragen ASCII-Transliteration statt Umlauten
(„Aufgeloest", „draussen", „Abkuerzung" u. Ä.), weil der Controller zu Beginn eine
falsche Konvention vorgab. Nachgeprüft an `git log 721f4b4e -30`: der Bestand schreibt
Umlaute korrekt. Ab dem Fix-Commit von Task 5 (`6eb1df5a`) korrigiert; die bestehenden
Commit-Messages 1–5 wurden **bewusst nicht** per History-Rewrite umgeschrieben — der
Aufwand stünde in keinem Verhältnis zum Nutzen einer bereits gemergten Historie.
