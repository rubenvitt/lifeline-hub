# Prüfliste Einsatztauglichkeit — Verwaltung vereinheitlichen (LFH-346 · C11)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. C11 fasst **66 Dateien** an
(`git diff main --stat`), und die verteilen sich auf **drei verschiedene Flächenarten**.

**Deshalb drei Tabellen mit je 15 Zeilen und nicht eine mit fünfzehn.** Eine gemeinsame Liste
über „die Verwaltung" verwischt genau die Unterschiede, für die die Liste existiert: die
Katalogseite ist eine Vergleichsfläche mit Zeilenaktionen, die Detailseite ein langes Formular
mit klebender Speicherleiste, die Einstellungsseite eine Schalterliste mit Sofort-Speichern.
Kriterium 4 (zweite Handlung), 9 (Blickfeld), 13 (Fokusverdeckung), 14 (Tabelle) und 15
(Erfassungsmaske) fallen an den drei Flächen **verschieden** aus — wären sie es nicht, hätte
der Zuschnitt nichts gebracht.

| Fläche | Stellvertreter | Familie |
| --- | --- | --- |
| **Katalogseite** | `frontend/src/stammdaten/FahrzeugeTab.tsx` | 11 Stammdaten-Tabs + `BenutzerPage` + 2 Karten-Verwaltungen |
| **Detailseite** | `frontend/src/stammdaten/FahrzeugDetailPage.tsx` (**neu in C11**) | Schwester: `PersonalDetailPage.tsx` |
| **Einstellungsseite** | `frontend/src/pages/einstellungen/EinsatzDefaults.tsx` | mit `ModulEinstellungsListe.tsx` |

**Die Schwester der Detailseite trägt dieselben Verdikte.** `PersonalDetailPage.tsx` ist in
derselben Runde (A7) nach derselben Bauform entstanden — gleicher `speicherLeisteStil`,
gleiche `SeitenHinweise`, gleiche Listen-Query statt Einzel-GET; sie trägt acht Felder statt
elf. Übertragbar sind alle fünfzehn Zeilen; die einzige Zahl, die nicht überträgt, ist die
Feldzahl (und damit die Bildlaufreserve, die nur für die Fahrzeugseite gemessen ist).

**Verdikte:** erfüllt · teilweise erfüllt · offen → Zielticket · nicht anwendbar → Begründung.
„Nicht geprüft" ist keins. Gerechnetes trägt **[abgeleitet]**.

---

## Die gemessenen Zahlen

Alle Pixel-Aussagen stammen aus `frontend/e2e/verwaltung-vereinheitlicht.spec.ts` (Commit
`dc93f924`, Chromium). Sie sind hier **zitiert, nicht nachgerechnet**.

| Größe | Wert | Ort |
| --- | --- | --- |
| Zeilenaktion `/admin/stammdaten/fahrzeuge`, Stufe kompakt | **30,0 px** (Gleichheit, ohne Subpixelrest) | Test „Stufe kompakt: die Zeilenaktion misst 30 px …" |
| dieselbe, Stufe komfortabel | **48,0 px** | Test „Stufe komfortabel: …" |
| Abstand neutral → destruktiv, kompakt / komfortabel | **11 px / 18 px** gegen gefordert `marginSM` **7 / 11** | derselbe Test, Teil (b) |
| Rollen-Auswähler `/admin/einstellungen/einsatz` bei 390 px | **317 px** in einer **348 px** breiten Zeile | Test „bei 390 px stapelt die Modulzeile …" |
| Rollen-Auswähler bei 1280 px | **56,3 px** (Spuren 790,7 / 87,3 / 0) — **Befund, nicht behoben** | Test „BEFUND (Bestand seit LFH-345) …" |
| Fahrzeug-Detailseite per Deeplink | **vier Sektionen**, `scrollHeight` 908 gegen `innerHeight` 420 = **488 px Reserve**, Speichern `toBeInViewport()` | Test „die Fahrzeug-Detailseite ist per Deeplink erreichbar …" |

### Korrektur, kein Mangel: die Schwelle ist die Staffel, nicht die 32 aus dem AK

Das Ticket verlangt „Zeilenaktion ≥ 32 px". Bindend ist Gate 3 mit **30 / 48 / 72**
(`theme/tokens.ts`); die Zeilenknöpfe tragen keine `size`-Angabe und erben `controlHeight`
vom `ConfigProvider`. Ein Test auf „≥ 32" wäre **schwächer als der Bestand**: er liefe in
jeder Stufe durch (30 fiele durch, 48 und 72 trivial hindurch) und könnte weder eine
Regression auf eine punktuelle Klein-Angabe (24 px) noch ein Durchgreifen der falschen Stufe
zeigen. Gepinnt ist deshalb die Stufe selbst, als Gleichheit. Dieselbe Korrektur haben
`einstellungen-schmal.spec.ts:20-26` (gegen „≥ 44"), `kraefte-schmal.spec.ts` und
`trefflaeche-tablet.spec.ts` bereits begründet. **Das AK ist übererfüllt, nicht verfehlt.**

---

## Tabelle 1 — Katalogseite (`stammdaten/FahrzeugeTab.tsx`)

| # | Verdikt | Beleg |
| --- | --- | --- |
| **1 · Treffläche** | **erfüllt** | Gemessen **30,0 px** kompakt / **48,0 px** komfortabel als Gleichheit, beide Knöpfe; Abstand zur destruktiven Nachbarin **11 / 18 px** gegen geforderte `marginSM` **7 / 11**. Damit über WCAG 2.5.8 (24 px) und über den 8-px-Abstand aus Material [abgeleitet: 30 > 24, 11 > 8]. Die Vorbedingung der Abstandsmessung ist eigens geprüft — ein frisches Fahrzeug muss `in_dienst` sein, sonst hieße der Nachbar „Wieder in Dienst", wäre neutral, und der Test verglich zwei harmlose Knöpfe. Zum AK-Wert „32" siehe die Korrektur oben |
| **2 · Handschuh-Modus** | **teilweise erfüllt** | Die `STAFFEL` dieser Spec-Datei trägt **zwei** Stufen (`verwaltung-vereinheitlicht.spec.ts:66-69`), die dritte (72 px) ist an **keiner** Verwaltungs-Katalogfläche gemessen. Die Weitergabe selbst ist route-unabhängig belegt (`dichte.spec.ts:57-83`, gespeicherte Stufe `handschuh` trägt sich bis in die Trefffläche) und die Zeilenknöpfe tragen keine `size`-Angabe (`FahrzeugeTab.tsx:126/140/143`). **Kein eigenes Ticket:** die offene Hälfte ist ein dritter Eintrag in `STAFFEL`, kein Umbau — sie gehört in die nächste Berührung dieser Datei. Die **Wahl** der Stufe aus dem Einsatzkontext bleibt app-weit offen → **LFH-373** |
| **3 · Rückmeldung vor der Serverantwort** | **erfüllt, verbessert** | Der Ladezustand der Tabelle steht sofort (`:190`), Leertext und Laden schließen sich im Primitiv aus. **Neu in A1:** eine laufende Mutation gehört genau einer Zeile (`laeuft`, `:122-123`) statt der ganzen Tabelle — bei 150 Personalzeilen war das vorher eine Vollsperre wegen eines Klicks. Beleg: `FahrzeugeTab.test.tsx:74` „sperrt beim Dienststatuswechsel NUR die betroffene Zeile". Der bewusst gezahlte Preis steht im Quellkommentar (`:114-120`): ein `useMutation`-Observer meldet nur den jüngsten Aufruf, die Marke **wandert** |
| **4 · Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Die Seite führt **keine unumkehrbare** Aktion aus: „Außer Dienst" hat seinen Rückweg als Knopf im Gegenzweig (`:143` „Wieder in Dienst"), und der Endpunkt **setzt** den Status idempotent. Nach LFH-363/378 ist das die umkehrbare Sorte — Abstand und `danger` ja, zusätzliche Reibung nein. **Befund dazu:** die Rückfrage steht trotzdem (`Popconfirm`, `:130-141`). Sie ist **Bestand** (`git show main:…/FahrzeugeTab.tsx` zeigt sie an derselben Stelle) und C11 hat sie bewusst nicht entschieden — das Entfernen einer bestehenden Rückfrage ist eine Bedienentscheidung, kein Nebenprodukt eines Vereinheitlichungs-Tickets (dieselbe Trennung wie LFH-367 → LFH-378) → **Nachzug N3** |
| **5 · Kontrast in beiden Modi** | **erfüllt** | **In jsdom nicht messbar** (kein Layout, keine Farbmischung) und in Playwright nicht gemessen — belegbar ist die **Abwesenheit neuer Farbwerte**: `grep '#[0-9a-f]{3,6}\|rgb(' ` über alle 66 geänderten Quelldateien = **0** neue Werte (die zwei Treffer `#22aa55` in `PersonalStatusTab.tsx:236` / `StatusKatalogTab.tsx:289` sind Bestands-**Platzhalter** in Farbfeldern, keine Gestaltung). Alles Farbige kommt aus antd-Presets oder `token.*`; die Werte selbst sind in A0/LFH-352 gemessen |
| **6 · Kein Status allein über Farbe** | **erfüllt** | Der Dienststatus trägt das **Wort** in der Plakette (`:94-95`, „in Dienst" / „außer Dienst"), die Filterwerte ebenso (`:89-92`). Die Ikonen-Frage stellt sich nicht: die Tabelle führt kein Bildzeichen |
| **7 · Eine Farbe = eine Bedeutung** | **teilweise erfüllt** | Rot bedient nichts — der einzige rote Träger ist die destruktive Aktion samt `okButtonProps={{ danger: true }}` (`:133`). **Offene Hälfte:** die Achse `Dienststatus` hat **keinen Eintrag** in `theme/statusFarben.ts` (dort stehen `statusKategorie`, `verfuegbarkeit`, `materialStatus` u. a., aber kein `dienststatus`); drei Tabs rendern stattdessen direkt ein antd-Preset — `FahrzeugeTab.tsx:95`, `MaterialTab.tsx:75`, `PersonalTab.tsx:100`, dazu `SprechgruppenTab.tsx:59` mit `blue`/`orange` für die Betriebsart. Damit gibt es für **eine** Achse zwei Behandlungswege, und Blau ist in der Rollen-Sprache `bedien`. Das ist derselbe Befund, den LFH-341/C6 für `MaterialStatus` entschieden hat („EIN Behandlungsweg") — für `Dienststatus` steht die Entscheidung aus → **Nachzug N6** |
| **8 · Helligkeits-/Kontrastregler** | **offen, unverändert** | Weiterhin keiner in der Anwendung; die Leitlinie verweist ihn ausdrücklich weiter → **LFH-397**, app-weit |
| **9 · Kritische Anzeigen im Blickfeld** | **offen** | Der Statuswechsel meldet seinen **Fehlschlag nur als Toast** (`:38`, `onError: message.error`). Nach ~3 s ist die Meldung weg, die Zeile steht unverändert da und **wirkt geschaltet** — genau der Befund H14, den C10 für die Einstellungsgruppe gelöst hat (`EinsatzDefaults.tsx:50-52` trägt das seit C10, es ist **kein** Ergebnis dieses Tickets) und den C11 auf der **neuen** Detailseite gleich richtig baut (`FahrzeugDetailPage.tsx:91-93`). In der **Katalogfamilie** ist der Toast weiterhin der einzige Meldeweg — `grep -rn "message.error" src/stammdaten/*.tsx` = **24 Stellen in 15 Dateien** (Zeilenaktionen **und** Erfassungsdialoge), darunter die Zeilenaktionen `FahrzeugeTab:38`, `MaterialTab:30`, `PersonalTab:32`, `SprechgruppenTab:32`, `EtbBausteineTab:31`, `EinheitTypenTab:56/77/83`, `QualifikationenTab:49/66/72`, `PersonalStatusTab:57/75/81`, `StatusKatalogTab:61`. Der `SeitenHinweise`-Slot ist an denselben Seiten bereits montiert (`FahrzeugeTab:174`) und trägt heute nur den Rechte-Hinweis → **Nachzug N1** |
| **10 · Alarmbudget** | **nicht anwendbar** | Die Seite erzeugt keine Alarme und hängt an keinem Live-Kanal — Stammdaten laufen über `globalKeys`, nicht über den SSE-Fan-out der Einsatz-Keys. Der einzige ungefragte Kanal ist der Fehler-Toast aus Zeile 9 und wird dort geführt |
| **11 · Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton, keine Eskalationsstufe; kein `animation`/`blink` in der Datei. Der einzige bewegte Zustand ist antds `loading`-Spinner am geklickten Knopf |
| **12 · Kein Sprung unter dem Cursor** | **erfüllt** | Keine Live-Aktualisierung (s. Zeile 10), also kein Einschub ohne Nutzeraktion. Die Blätterleiste rechnet gegen `dataSource.length` und **nicht** gegen die gefilterte Menge (`KatalogTabelle.tsx`, Kopfabschnitt „Blätterung") — genau, damit sie beim Tippen nicht verschwindet und den Sprung erzeugt, gegen den dieses Kriterium existiert. Belegt in `FahrzeugeTab.test.tsx:169` (Suche verkleinert die Zeilenmenge) und `:129` (Statusfilter) |
| **13 · Fokus nie verdeckt** | **erfüllt** | `fokus-verdeckung.spec.ts:187-215` fährt den Tabulaturdurchlauf „hinter stehender Kopfzeile und fixierter erster Spalte" auf `/admin/benutzer` — dieselbe `KatalogTabelle`, dieselben zwei fixierten Konstruktionen, die hier verdecken könnten [abgeleitet: Übertrag über das Primitiv, nicht über die Route]. C11 fügt dieser Fläche **kein** neues `position: sticky` hinzu |
| **14 · Tabellenseite vollständig** | **teilweise erfüllt** | Drei von vier Teilforderungen hält das Primitiv unbedingt: stehende Kopfzeile und Scrollcontainer (`KatalogTabelle.tsx:318-319`), fixierte **menschenlesbare** Kennung (`:229-230`, hier der Funkrufname — `FahrzeugeTab.tsx:43-65`, mit `numeric: true`, weil „Florian 10" sonst vor „Florian 2" stünde), keine Auflösung in Karten (`katalogtabelle-schmal.spec.ts:62`). **Der Spaltenschalter mit Zähler fehlt** — als dokumentierte Ausnahme mit Begründung im Dateikopf (`KatalogTabelle.tsx:50`: „höchstens sieben Spalten, alle sichtbar"). `FahrzeugeTab` trägt mit der Aktionsspalte **genau sieben** [abgeleitet: Funkrufname · Typ · Träger · Kennzeichen · Stärke · Status · Aktionen]. Die Ausnahme steht damit **an ihrer Obergrenze**: eine achte Spalte macht sie neu entscheidungsbedürftig, und das hat bisher niemand aufgeschrieben. **Kein Ticket, weil** heute sieben von sieben gelten — diese Zeile ist der Merker |
| **15 · Erfassungsmaske vollständig** | **erfüllt** | `FahrzeugFormModal` liegt seit A6/A7 auf der `Erfassung`-Hülle und trägt **vier** sichtbare `Form.Item` (`FahrzeugFormModal.test.tsx:226`) — bewusst **ohne** Collapse für den Rest (`:22`: „ein eingeklapptes Feld ist immer noch in diesem Dialog"), der Rest steht auf der Detailseite. Fokus im ersten Feld (`Test:99`), Serienmodus nur beim **Anlegen** (`:104`, Tests `:109`/`:116` als Paar), Wiederholfeld `traegerorganisation` (`:109`) mit sichtbarem Schalter, Ablehnung behält den Wortlaut (`Test:167`), Zurücksetzen auf jedem Ausweg (`Test:203`), Labels über dem Feld (`Erfassung.tsx:320`, `layout="vertical"`). **Die Bibliothek blockiert das Absenden hier nicht:** die drei `AutoComplete`-Felder laufen im **Combobox-Modus** (`antd/es/auto-complete/AutoComplete.js:152`) und sind damit von der `preventDefault`-Regel des `BaseSelect` ausgenommen (`@rc-component/select/es/BaseSelect/index.js:243-246`: `isEnterKey && !isCombobox`) — die Bestandsverdikte nennen die Regel für `Select`, für `AutoComplete` gilt sie **nicht**, gemessen im Bibliothekscode. Das ist eine Aussage über die Bibliothek, keine über jeden Tastendruck: bei **offener** Vorschlagsliste verbraucht die Liste das Enter für die Auswahl. Gepinnt ist deshalb die **Struktur**, aus der die Zusicherung folgt — Knopf im `<form>`, keine antd-Fußzeile (`Test:90`) |

**Verdikt-Bilanz:** 8 erfüllt · 3 teilweise erfüllt · 2 offen · 2 nicht anwendbar.

---

## Tabelle 2 — Detailseite (`stammdaten/FahrzeugDetailPage.tsx`, neu)

| # | Verdikt | Beleg |
| --- | --- | --- |
| **1 · Treffläche** | **erfüllt [abgeleitet]** | `grep 'size="' FahrzeugDetailPage.tsx` = **0** — jedes Steuerelement erbt `controlHeight` vom `ConfigProvider`; `dichte.guard.test.ts` bleibt bei einer Datei (die UHS-Platzkarte). **Kein Pixelmaß auf dieser Route:** der e2e-Fall misst die *Lage* der Speicherleiste, nicht die Höhe der Felder. Die Ableitung stützt sich auf `dichte.spec.ts:57-83` (Stufe kommt an der Trefffläche an) — deshalb [abgeleitet] und nicht „gemessen" wie in Tabelle 1 |
| **2 · Handschuh-Modus** | **teilweise erfüllt** | Wie Tabelle 1: 72 px sind an dieser Fläche nicht gemessen. Der Zuschnitt ist hier günstiger — bei 72-px-Zeilen wächst ein `layout="vertical"`-Formular in die **Höhe**, und die Höhe hat die Seite (`Col xs={24} lg={12}`, `:182 ff.`), sie hat schon 488 px Bildlaufreserve bei 420 px Sichtfeld. **Kein eigenes Ticket für die fehlende Messung:** wie in Tabelle 1 ist sie ein dritter Eintrag in `STAFFEL`, kein Umbau. Die Stufen**wahl** aus dem Kontext bleibt app-weit offen → **LFH-373** |
| **3 · Rückmeldung vor der Serverantwort** | **erfüllt** | `SeitenSkeleton` beim Laden (`:108`), `loading={speichern.isPending}` am Absende-Knopf (`:281`), und der Fehler steht **stehend** statt als Toast (`:91-93` — kein `onError`; `:149-155` `SeitenHinweise fehler={speichern.error}`). Das ist H14 auf einer neuen Fläche gleich richtig gebaut statt nachträglich korrigiert |
| **4 · Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Die Seite kennt genau **eine** schreibende Aktion: Speichern. Kein Löschen, kein Statuswechsel, keine Alarmierung — der Dienststatus bleibt bewusst in der Liste (Tabelle 1, Zeile 4). Ein PATCH auf Stammdatenfelder ist durch erneutes Speichern umkehrbar |
| **5 · Kontrast in beiden Modi** | **erfüllt** | Kein eigener Farbwert in der Datei; Abstände über `token.marginSM`/`token.margin` (`:140`, `:181`). Zur Messbarkeit gilt dieselbe Einschränkung wie in Tabelle 1 |
| **6 · Kein Status allein über Farbe** | **nicht anwendbar** | Die Seite zeigt **keinen Status**. Sie trägt Stammdatenfelder; die einzige farbige Zustandsaussage ist der Speicherfehler, und der ist Kriterium 9. Das ist der sichtbarste Unterschied zur Katalogseite und der Grund, warum drei Tabellen und nicht eine |
| **7 · Eine Farbe = eine Bedeutung** | **erfüllt** | Genau zwei Farbträger: der Primär-Knopf (`bedien`, blau) und der Fehler-Alert (`error`, rot). Rot bedient nichts, blau warnt nicht — und beide tragen Text |
| **8 · Helligkeits-/Kontrastregler** | **offen, unverändert** | → **LFH-397**, app-weit |
| **9 · Kritische Anzeigen im Blickfeld** | **erfüllt, gemessen** | Der Speicherfehler steht im `hinweis`-Slot **über** dem Formular, an dem er entsteht, und verfällt nicht (`:149-155`). Der Speichern-Knopf steht bei 1280 × 420 px im Blickfeld — geprüft mit `toBeInViewport()` und **nicht** mit `toBeVisible()` (ein Element unterhalb des Sichtfelds gilt für `toBeVisible` als sichtbar, LFH-343 · H51), bei eigens geprüfter Bildlaufreserve: `scrollHeight` **908** gegen `innerHeight` **420** = **488 px**. Ohne diese Vorbedingung bewiese `toBeInViewport` nichts, weil eine kurze Seite die Leiste ohnehin zeigte |
| **10 · Alarmbudget** | **nicht anwendbar** | Kein Live-Kanal, keine Zustandsmeldung. Die einzige Meldung ist der Erfolgs-Toast **nach** einer Nutzeraktion (`:89`) — eine Quittung, keine ungefragte Zustandsmeldung im Sinne von EEMUA 191 (dieselbe Abgrenzung wie beim Rückgängig-Toast in C8 und beim Erfolgs-Toast in C10) |
| **11 · Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton, keine Eskalation |
| **12 · Kein Sprung unter dem Cursor** | **erfüllt — und das war Arbeit** | Der Effekt, der Serverdaten ins Formular schrieb, ist **weg** (`:160-171`): die Listen-Query wird auch von **fremden** Änderungen invalidiert, und wer gerade tippte, sah seinen Text ohne Vorwarnung ersetzt (derselbe Befund wie LFH-342 · C7). Gesät wird nur beim Mount, mit `key={id}` für den Fall, dass dieselbe Seite auf einen anderen Datensatz umgehängt wird (`:173`). Beleg: `FahrzeugDetailPage.test.tsx:167` „ersetzt einen getippten Entwurf NICHT, wenn die Liste neu geladen wird" (Commit `7613eab5`) |
| **13 · Fokus nie verdeckt** | **offen** | Die Speicherleiste ist ein **neues** `position: sticky` (`:280`, `speicherLeisteStil`) — genau die Konstruktion, auf die WCAG 2.4.11 zielt: eine unten verankerte Leiste über einem langen Formular mit 488 px Bildlaufreserve. `fokus-verdeckung.spec.ts` kennt diese Route **nicht** (seine Fälle liegen auf `/admin/benutzer` `:215` und `/einsaetze/:id/einstellungen/verhalten` `:373`). Dass die Leiste dieselbe Stilfunktion nutzt wie der geprüfte C10-Fall, belegt die **Geometrie**, nicht die Tabulaturordnung über **diesem** Formular — C10 hat genau diese Zeile schon einmal ohne tragenden Beleg geführt und im eigenen Review nachgeholt → **Nachzug N2** |
| **14 · Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle. Die Seite trägt einen einzelnen Datensatz in vier Sektionen (`Identität`, `Funk & Sonderrechte`, `Kapazität`, `Bemerkung` — e2e-geprüft über die Überschriften-Rolle, weil „Bemerkung" zweimal auf der Seite steht) |
| **15 · Erfassungsmaske vollständig** | **nicht anwendbar als B4-Maske · übertragbare Hälften erfüllt** | Es ist ein **Bearbeitungs**formular eines bestehenden Satzes: keine Anlage, keine Serie, kein „Speichern und nächsten anlegen" (das wäre hier ein toter Knopf — es gibt keinen nächsten). Was überträgt und hält: Labels **über** dem Feld (`:175`, Penzo), Defaults sind der Bestandswert und einzeln überschreibbar (`initialValues`, `:177`), volle Tastaturbedienung, und der Absende-Knopf liegt **im** `<form>` mit `htmlType="submit"` (`:280-284`) — ein Knopf im Kopf-Slot von `AdminPage` wäre ein DOM-Geschwister außerhalb des Formulars und könnte nichts übermitteln. Die drei `AutoComplete`-Felder blockieren das Absenden nicht (Combobox-Ausnahme, Beleg in Tabelle 1, Zeile 15) — bei offener Vorschlagsliste verbraucht die Liste das Enter; gepinnt ist die **Struktur**, nicht der Tastendruck |

**Verdikt-Bilanz:** 7 erfüllt · 1 teilweise erfüllt · 2 offen · 5 nicht anwendbar.

---

## Tabelle 3 — Einstellungsseite (`pages/einstellungen/EinsatzDefaults.tsx`)

| # | Verdikt | Beleg |
| --- | --- | --- |
| **1 · Treffläche** | **offen** | Die **Höhe** hält: die Modulzeile ist ein handgebautes Bedienziel und trägt die zwei Angaben aus LFH-365 (`ModulEinstellungsListe.tsx:28-38`, `minHeight: token.controlHeight` **plus** Polsterung, rein und exportiert). Die **Breite** hält nicht: bei 1280 px fällt die `auto`-Spalte des Rasters `minmax(0, 1fr) auto auto` auf **56,3 px** zusammen (Spuren 790,7 / 87,3 / 0 auf `/admin/einstellungen/einsatz`) — unter der 120-px-Schwelle, ab der die längste Option („Führungskraft") lesbar statt abgeschnitten steht [abgeleitet: 56,3 < 120]. Bei 390 px dagegen 317 px in einer 348 px breiten Zeile. **Bestand seit LFH-345 · C10, nicht von C11 verursacht** (`git diff main` zeigt an Raster und `Select` nur eine Umsortierung; beide Routen messen denselben Wert, obwohl die eine drei und die andere zwei Kinder im Raster hat). Festgehalten als **grüner Fenster-Pin**, nicht als `test.fail()` — das verlangte nur, dass *irgendetwas* fällt, und ein gebrochener Locator wäre dann ebenfalls „erwartet" → **Nachzug N4** |
| **2 · Handschuh-Modus** | **erfüllt** | **72 px sind an dieser Komponente gemessen** — `einstellungen-schmal.spec.ts:195-230` fährt `komfortabel` (48) und `handschuh` (72) gegen die Beschriftung derselben `ModulEinstellungsListe`, samt Gegenprobe, dass die Zeile auch **schaltet** (ein Ziel der richtigen Größe, das nichts tut, wäre die halbe Aussage). Der Fall liegt auf der Schwester-Route `/einsaetze/:id/einstellungen/module` [abgeleitet: Übertrag über das gemeinsame Bauteil, nicht über die Route]. Die **Wahl** der Stufe aus dem Einsatzkontext bleibt offen → **LFH-373** |
| **3 · Rückmeldung vor der Serverantwort** | **erfüllt** | `SeitenSkeleton` beim Laden (`:83`), `loading` am Speichern-Knopf (`:200`). Die Sofort-Speichern-Zeile sperrt und markiert **genau eine** Zeile (`laeuftKey`/`fehlerKey`, `:236-237`; Tests `ModulEinstellungsListe.test.tsx:118` „sperrt NUR die gerade mutierende Zeile", `:125` „markiert NUR die fehlgeschlagene Zeile", `:134` „markiert ohne Fehler gar keine Zeile"). Die Quelle ist `mutation.variables`, kein eigener State |
| **4 · Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar für eine unumkehrbare Aktion · die eine echte Verlustgefahr ist gesichert** | Die Seite löscht nichts und alarmiert nichts; jeder Wert ist durch erneutes Speichern umkehrbar. Was verloren gehen **kann**, ist eine ungespeicherte Fassung — dagegen steht der `beforeunload`-Guard (`:74-81`) mit eigenem State statt `form.isFieldsTouched()` (antd setzt das Flag beim Speichern nicht zurück). Als **Paar** geprüft: `EinsatzDefaults.test.tsx:279` „warnt beim Verlassen nur mit ungespeicherter Fassung" und `:297` „schweigt wieder, sobald gespeichert ist" — ein Guard, der immer hält, wäre so falsch wie keiner |
| **5 · Kontrast in beiden Modi** | **erfüllt** | Kein eigener Farbwert; der Fehlerrand nimmt `token.colorError` (`ModulEinstellungsListe.tsx`, `borderInlineStart`). Messbarkeit wie in Tabelle 1 |
| **6 · Kein Status allein über Farbe** | **erfüllt** | Die gescheiterte Zeile trägt **drei** Kanäle: den linken Rand (Farbe), `data-fehler` und den Fehlertext **bei der Liste** (`:219-221`) statt im Seitenkopf — Text und Rand zeigen damit auf denselben Vorgang; die frühere `??`-Verkettung erzeugte einen Zustand, in dem sie auseinanderliefen (`Test:214` „haelt Formular- und Modulfehler auseinander"). Zweiter Fall in derselben Datei: die zwei nicht ausblendbaren Module standen grau da **ohne Grund** und sagen es jetzt im Klartext („immer sichtbar, nicht ausblendbar", Tests `:241`/`:251`) — Grau allein ist eine Ein-Kanal-Aussage |
| **7 · Eine Farbe = eine Bedeutung** | **erfüllt** | Der linke Zeilenrand trägt hier genau eine Bedeutung — „hier ist das Speichern gescheitert" —, dieselbe Bauform wie an den Kommunikations-Karten (C8), dort mit Vorrangregel, hier ohne zweiten Anwärter |
| **8 · Helligkeits-/Kontrastregler** | **offen, unverändert** | → **LFH-397**, app-weit |
| **9 · Kritische Anzeigen im Blickfeld** | **erfüllt** | Zwei Speichersemantiken, zwei Orte: der Formular-Fehler im Kopf-Hinweis (`:114-118`), die Ablehnung der Sofort-Speichern-Liste **bei der Liste** (`:219-221`). Der Rechte-Hinweis nennt den Grund und der Knopf verschwindet nicht, er steht gesperrt (`:193-204`; Tests `:192` „erklaert der Fuehrungskraft den Grund UND laesst den Knopf stehen", `:231` „schweigt ueber Berechtigungen, wenn welche da sind") |
| **10 · Alarmbudget** | **teilweise erfüllt** | Die Seite erzeugt keine Alarme. Aber jede geschaltete Modulzeile quittiert mit einem eigenen Erfolgs-Toast (`:68` „Modul-Default gespeichert"), und **A9 hat das Serienschalten erst bequem gemacht** — Gruppierung nach den sechs Registry-Kategorien plus Filterfeld (`ModulEinstellungsListe.tsx:100-115`, Tests `:205`/`:216`). Wer nach dem Filtern fünf Zeilen umstellt, erzeugt fünf Toasts im Sekundentakt, und sie **stapeln**. C8 hat für genau diesen Fall den festen Toast-Schlüssel eingeführt (`kommunikation/rueckgaengig.tsx`), damit die zweite Aktion die stehende Meldung **ersetzt** statt sie zu stapeln; hier ist er nicht gesetzt. Es bleibt eine Quittung nach Nutzeraktion (also außerhalb des EEMUA-Zustandsbudgets), aber die Zahl der Unterbrechungen steigt mit der Bequemlichkeit → **Nachzug N5** |
| **11 · Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton, keine Eskalationsstufe. Der einzige Dialog ist die Browser-Rückfrage beim Verlassen, und die ist quittierbar |
| **12 · Kein Sprung unter dem Cursor** | **erfüllt** | Keine Live-Aktualisierung. Die einzige Umordnung folgt der **Eingabe** des Benutzers (WCAG 3.2.5): eine Kategorie ohne Treffer fällt **ganz** weg statt als leere Überschrift stehen zu bleiben (`Test:216` „filtert die Liste und laesst leere Kategorien GANZ weg"), und trifft der Filter nirgends, sagt die Liste das, statt eine leere Fläche unter dem Feld zu lassen (`Test:232`) |
| **13 · Fokus nie verdeckt** | **offen** | A9 hat den Speichern-Knopf aus dem Kopf-Slot in eine **sticky Leiste im Fuß** geholt (`:196`, `speicherLeisteStil`) — ein neues `position: sticky` über einem Formular mit sieben Feldern und einer 25-zeiligen Liste darunter. `fokus-verdeckung.spec.ts` prüft nur die Einsatz-Sektion (`:373`), nicht `/admin/einstellungen/einsatz`. Gleiche Lücke wie auf der Detailseite und derselbe Nachzug → **Nachzug N2** |
| **14 · Tabellenseite vollständig** | **nicht anwendbar** | Die Modulliste ist eine **Schalterliste** („was ist mit diesem hier?"), keine Vergleichsfläche („welcher von diesen ist der richtige?") — sie wird gelesen und geschaltet, nicht verglichen. Dieselbe Begründung wie in C10. Die Spaltenköpfe fallen unter `md` folgerichtig **ganz** weg (`Test:178`/`:189`): ein Kopf über gestapelten Zeilen benennt keine Spalten mehr, sondern behauptet eine Ordnung, die es nicht gibt |
| **15 · Erfassungsmaske vollständig** | **nicht anwendbar als B4-Maske · übertragbare Hälften erfüllt** | Kein Anlage-Dialog, sondern ein Einstellungsformular mit Sammel-Speichern plus einer Sofort-Speichern-Liste. Was überträgt: Labels über dem Feld (`:123`), Defaults vorbelegt aus `initialEinsatz` (`:124`) und einzeln überschreibbar, die Leerbedeutung steht als Platzhalter im Feld („keine", „kein Default", `:139`/`:174`/`:181`) statt nur im Tooltip, und der Speichern-Knopf liegt **im** `<form>` — eigens gepinnt in `EinsatzDefaults.test.tsx:257` „traegt den Speichern-Knopf IM Formular, nicht im Kopf-Slot". **Der PUT ist Vollersatz**, deshalb fährt jede Sektion die Felder der anderen als Bestandswert mit (`:101`, `zuUpdate`); ein Speichern hier nullt sonst still die Nummernkreise |

**Verdikt-Bilanz:** 8 erfüllt · 1 teilweise erfüllt · 3 offen · 3 nicht anwendbar.

---

## Was der Zuschnitt sichtbar gemacht hat

Wären die drei Flächen in **einer** Tabelle gelandet, hätte jede dieser fünf Zeilen ein
Mischverdikt bekommen und keine Aussage getragen:

- **Kriterium 4** ist an der Katalogseite eine *überschüssige* Rückfrage (Popconfirm an einer
  umkehrbaren Aktion), an der Detailseite gegenstandslos, an der Einstellungsseite über den
  Verlassen-Guard gelöst. Drei Sachverhalte, ein Kriterium.
- **Kriterium 9** ist an zwei Flächen erfüllt und an der dritten offen — **innerhalb desselben
  Tickets**. Die Detailseite und die Einstellungsseite bauen H14 richtig; die Katalog-Tabs
  melden ihre Zeilen-Fehlschläge weiter als Toast. Eine gemeinsame Zeile hätte „teilweise"
  gesagt und die 24 Fundstellen verschluckt.
- **Kriterium 13** ist an der Katalogseite geprüft und an **beiden** neuen Flächen offen — weil
  C11 dort zwei neue `sticky`-Leisten eingeführt hat. Genau die Sorte Zeile, die C10 schon
  einmal ohne Beleg geführt hat.
- **Kriterium 14** ist nur an einer der drei Flächen überhaupt anwendbar, und dort steht die
  dokumentierte Spaltenschalter-Ausnahme an ihrer eigenen Obergrenze (sieben von sieben).
- **Kriterium 2** ist an der Einstellungsseite über drei Stufen gemessen und an den beiden
  Stammdaten-Flächen über zwei. Der Unterschied ist keine Nachlässigkeit, sondern die
  Reichweite zweier verschiedener Spec-Dateien — und er ist nur sichtbar, wenn man ihn
  getrennt hinschreibt.

**Gesamtbilanz über 45 Zeilen:** 23 erfüllt · 5 teilweise erfüllt · 7 offen · 10 nicht
anwendbar. Kein Feld ohne Verdikt.

---

## Nachzüge

Zwei Nummern existieren bereits und werden aus C10 unverändert übernommen; die sechs neuen
tragen bewusst **keine** Nummer — die vergibt A10 · Schritt 4 beim Nachziehen des Tickets.
Jede Zeile ist so geschrieben, dass sie ohne erneute Herleitung angelegt werden kann.

| Kürzel | Fläche | Inhalt | Fundstelle |
| --- | --- | --- | --- |
| **N1** | Katalogseiten (15 Dateien) | H14 auf die **Zeilen-Mutationen** der Kataloge anwenden: Fehlschläge als stehender `SpeicherFehler` im bereits montierten `SeitenHinweise`-Slot statt als 3-Sekunden-Toast | `grep -rn "message.error" src/stammdaten/*.tsx` = 24 Stellen in 15 Dateien; Slot z. B. `FahrzeugeTab.tsx:174` |
| **N2** | Detailseite **und** Einstellungsseite | Zwei neue `position: sticky`-Speicherleisten in `fokus-verdeckung.spec.ts` aufnehmen — Tabulaturdurchlauf mit den drei Vorbedingungen (Bildlaufreserve > 0, `sticky`-Knoten im Baum, ≥ 8 Stopps), sonst ist „0 verdeckte Ziele" trivial wahr | `FahrzeugDetailPage.tsx:280` · `EinsatzDefaults.tsx:196` · Spec-Fälle heute `:215`/`:373` |
| **N3** | Katalogseiten | Entscheiden, ob die Rückfrage vor „Außer Dienst" bleibt. Die Aktion ist umkehrbar (Gegenknopf daneben, Endpunkt setzt idempotent) → nach LFH-363/378 ist sie Reibung. Das Entfernen ist eine **Bedienentscheidung**, kein Nebenprodukt | `FahrzeugeTab.tsx:130-141`, gleichartig in `MaterialTab`/`PersonalTab` |
| **N4** | Einstellungsseite | Die `auto`-Spalte des Modulzeilen-Rasters fällt bei 1280 px auf **56,3 px**. Naheliegend: `minmax()`-Spur statt `auto`, oder Mindestbreite am Auswähler. **Bestand seit LFH-345 · C10**, betrifft Admin- **und** Einsatz-Route. Beim Beheben: den Befund-Test entfernen und die Zusicherung regulär (`>= 120`) in den 390-px-Fall heben — der Test sagt das selbst in seiner Fehlermeldung | `ModulEinstellungsListe.tsx` (Raster) · Fenster-Pin in `verwaltung-vereinheitlicht.spec.ts` |
| **N5** | Einstellungsseite | Erfolgs-Toast der Sofort-Speichern-Zeile auf einen **festen Schlüssel** legen (Bauform `kommunikation/rueckgaengig.tsx`, C8), damit Serienschalten nach dem Filtern nicht n Meldungen stapelt | `EinsatzDefaults.tsx:68` |
| **N6** | Katalogseiten | Die Achse `Dienststatus` in `theme/statusFarben.ts` aufnehmen — heute rendern drei Tabs ein antd-Preset direkt, es gibt also zwei Behandlungswege für ein Enum. Entscheidung wie bei `MaterialStatus` (LFH-341 · C6), inkl. der Frage, ob `SprechgruppenTab`s `blue`/`orange` für die Betriebsart mitgeht (Blau ist `bedien`) | `FahrzeugeTab.tsx:95` · `MaterialTab.tsx:75` · `PersonalTab.tsx:100` · `SprechgruppenTab.tsx:59` |
| **LFH-373** | app-weit | Dichtestufe aus dem Einsatzkontext ableiten (Zeile 2 aller drei Tabellen) | aus C10 übernommen |
| **LFH-397** | app-weit | Helligkeits-/Kontrastregler (Zeile 8 aller drei Tabellen) | aus C10 übernommen |
