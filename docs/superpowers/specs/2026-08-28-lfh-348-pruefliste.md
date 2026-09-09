# Prüfliste Einsatztauglichkeit — Lagebericht, Berichtsliste, Lagemeldungen (LFH-348 · C13)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. C13 fasst **drei Flächen** an,
und sie sind drei verschiedene Formen — deshalb drei Tabellen mit je 15 Zeilen.

| Fläche | Stellvertreter | Mitgeprüft |
| --- | --- | --- |
| **Detailseite (Entwurf)** | `frontend/src/pages/LageberichtDetailPage.tsx` — Vollseite mit Formular (LFH-19) | `lageberichte/AbschnittsAkkordeon.tsx` (**neu**), `entwurf/useEntwurfVerlustschutz.ts` (**neu**, gehoben aus `BefehlDetailPage`) |
| **Berichtsliste** | `frontend/src/pages/LageberichtePage.tsx` — Kartensicht auf `Datensicht` | `lageberichte/ketten.ts` (**neu**), Anlege-Modal auf `components/Erfassung.tsx` |
| **Lagemeldungen** | `frontend/src/pages/LagemeldungenPage.tsx` — Kartensicht auf `Datensicht` (zwölfte Konsumentin) | `lagemeldungen/zeitachse.ts` (**neu**) |

**`BefehlDetailPage` erbt die Verdikte der Detailseite in Zeile 3, 9 und 12 vollständig**: der
Verlustschutz ist seit C13 ein gemeinsamer Hook, die Seite rendert wie der Lagebericht mit
`key={id}`. Was **nicht** überträgt, ist das Akkordeon — der Befehl hat es nicht bekommen
(nicht im Ticket, andere Vorlagen, eigene Messung nötig).

**Verdikte:** erfüllt · teilweise erfüllt · offen → Zielticket · nicht anwendbar → Begründung.
„Nicht geprüft" ist keins. Gerechnetes trägt **[abgeleitet]**.

---

## Die gemessenen Zahlen

| Größe | Wert | Ort |
| --- | --- | --- |
| `body.scrollHeight` der Detailseite, Vorlage „Lagevortrag zur Entscheidung" (8 Abschnitte, leer), 1366 × 768, **Bestand vor C13** (Commit `f184da4c`) | **2108 px** (zweimal identisch; Formular 1833 px, ein Textfeld 180 px) | `frontend/e2e/lagebericht-schmal.spec.ts`, Kopfkommentar zu `MAX_HOEHE` |
| dieselbe Messung **nach C13** | **938 px** (Formular 687 px, offenes Textfeld 137 px) | derselbe Test, Annotation `gemessen` |
| Schwelle im Test | **≤ 1054 px** (= Hälfte des Bestands, AK des Tickets) | `MAX_HOEHE` |
| Boden, unter den keine Seite fallen kann | **768 px** (`minHeight: 100vh` an `AppLayout`/`EinsatzLayout`) | gemessen als `innerHeight` im selben Lauf |
| Waagerechter Überlauf bei 390 px, `/lageberichte` und `/lagemeldungen`, je mit gesätem Datensatz | **keiner** (`scrollWidth ≤ clientWidth + 1`) | dieselbe Datei, zwei Fälle |

**Wie gemessen wurde, und warum das dazugehört:** ein Griff nach `scrollHeight` direkt nach
dem Einhängen las **1324 px** auf demselben Stand, der stabil 2108 px hat — `autoSize` misst
die Textfelder erst nach dem Einhängen nach. Der Test wartet deshalb, bis drei Messungen im
Abstand von 250 ms gleich sind (`stabileHoehe`). Ein Test ohne dieses Warten wäre grün
gewesen, ohne dass die Seite kürzer ist.

### AK-Korrekturen (drei Ticket-Aussagen, die gemessen anders sind)

1. **„≈ 2500–3000 px Scrollstrecke"** — gemessen **2108 px**. Die Halbierung ist mit dieser Zahl
   gerechnet (1054), nicht mit der geschätzten.
2. **„`useBlocker`/`beforeunload` hat repo-weit 0 Vorkommen"** — zum Ticketzeitpunkt richtig,
   seit LFH-342 · C7 falsch: `BefehlDetailPage` trägt Blur-Autosave + `beforeunload`, und
   `useBlocker` ist gemessen **nicht baubar** (BrowserRouter, LFH-462). C13 hat diesen Hausstil
   **geteilt**, nicht einen zweiten daneben gebaut.
3. **„`isFieldsTouched()`-Guard"** und **„`useEntwurf(schluessel)` aus `entwurfStore.ts`"** —
   beides bewusst nicht gebaut, siehe „Abweichungen" unten.

### Abweichungen vom Ticket, mit Grund

| Ticket | Gebaut | Warum |
| --- | --- | --- |
| Sticky `Anchor` über den Abschnitten, alle Editoren sichtbar | **Akkordeon** (`Collapse accordion`, `forceRender`), ein offener Editor, Kopfzeilen mit Leer-Marke sind die Navigation | Die Halbierung ist mit acht ausgeklappten Editoren **in keiner Bauform** erreichbar: schon vier Mindestzeilen je Feld ergeben > 1200 px Formular, dazu der 768-px-Boden. Ein `Anchor` neben dem Akkordeon wäre eine zweite Liste derselben acht Einträge. `Steps` entfällt: keine Vorlage hat Reihenfolge-Logik |
| Riegel über `form.isFieldsTouched()` | eigener `ungespeichert`-State | antd setzt das Flag beim Speichern nicht zurück; ein Autosave darauf schriebe alle 30 s ein PATCH samt Invalidierung und Live-Ereignis (CLAUDE.md, C7) |
| lokales `useEntwurf` (IndexedDB) + „Entwurf gesichert HH:MM" | Server-Autosave (Blur + 30 s) + „zuletzt gespeichert HH:MM" | Ein lokaler Entwurf **neben** dem Server-Autosave wäre eine zweite Wahrheit ohne Auflösungsregel nach einem Reload. Der Serverstand ist nach jedem Feldwechsel aktuell, im Zeitmaximum 30 s alt; das AK „überlebt einen Reload" ist damit erfüllt, nur über den Server statt über den Browser. Der Wortlaut folgt C7, damit beide Zwillingsseiten dasselbe sagen |
| M86 Druck-Entdopplung | nicht angefasst | liegt bei **LFH-350 (F2)**, wie das Ticket selbst sagt |
| „Vorgängerversionen als eingeklappte Historie" | Vorgänger als **Links in der Fassungszeile** der Kettenkopf-Karte | Der Plan-Modus der Karte trägt höchstens drei Sekundärfelder und keine Aufklappzeile (nur im Tabellenzweig); ein Eigenbau-Kartenzweig ist begründungspflichtig (CLAUDE.md, `KARTEN_EIGENBAU`) und für zwei Links nicht gerechtfertigt |

---

## Tabelle 1 — Detailseite (`pages/LageberichtDetailPage.tsx`)

| # | Verdikt | Beleg |
| --- | --- | --- |
| **1 · Treffläche** | **erfüllt [abgeleitet]** | Kein interaktives Element trägt eine `size`-Angabe: die zwei Fundstellen sind `Spin size="large"` (`:159`) und `Space size={6}` (`:227`), beide außerhalb des Vertrags von `dichte.guard.test.ts`. Knöpfe, `Input`, `DatePicker`, `Checkbox` und die Kopfzeilen des Akkordeons (antd-`Collapse`, `controlHeight`-gebunden) erben 30 / 48 / 72. Kein Pixelmaß auf dieser Route; Ableitung über `e2e/dichte.spec.ts:57-83` |
| **2 · Handschuh-Modus** | **teilweise erfüllt** | Stufenweitergabe route-unabhängig belegt (`dichte.spec.ts`), hier nicht gemessen. Die Kopfzeile bricht um (`Flex wrap`, `:215-221` — vorher ein `Space` ohne `wrap`, auf 390 px schob der Titel die Aktionen aus dem Bild; Muster C8/M73). Die Stufen**wahl** aus dem Kontext bleibt app-weit offen → **LFH-373** |
| **3 · Rückmeldung vor der Serverantwort** | **erfüllt** | Ladebild beim Einstieg (`:157-161`), `loading` an allen drei Aktionen. **Neu:** der stille Autosave hat einen sichtbaren Beleg — „ungespeicherte Änderungen" / „zuletzt gespeichert HH:MM" neben dem Speichern-Knopf (`:243-247`); ohne ihn wäre „gespeichert" von „nicht gespeichert" nicht zu unterscheiden. Test `LageberichtePage.test.tsx` „speichert beim Verlassen eines Feldes von selbst und zeigt den Zeitstempel" |
| **4 · Kritische Aktion hat eine zweite Handlung** | **erfüllt** | „Freigeben" ist unumkehrbar (ETB-Snapshot) und trägt `modal.confirm` (`:180-197`), das **zuerst speichert** und bei Fehlschlag den Dialog offen lässt. „Entwurf speichern" braucht keine — umkehrbar durch weiteres Editieren. Der Bestätigungsknopf ist **nicht** `danger`: die Freigabe ist die gewollte Vorwärtsbewegung, kein Löschen (dieselbe Einordnung wie am Befehl) |
| **5 · Kontrast in beiden Modi** | **erfüllt** | Keine Farbliterale; das Akkordeon nimmt `token.colorSuccess` / `token.colorTextSecondary` (`AbschnittsAkkordeon.tsx:79`). `farbliteral.guard.test.ts` deckt `pages/`. In jsdom nicht messbar, in Playwright auf dieser Route nicht gemessen |
| **6 · Kein Status allein über Farbe** | **erfüllt — mit benanntem zweiten Kanal** | Die Leer-Marke je Abschnitt trägt drei Kanäle: Ikone (grün/grau, in `aria-hidden`-Hülle), **Wort „(leer)"** im Kopfzeilentext, Schriftgewicht. Getestet: `AbschnittsAkkordeon.test.tsx` „markiert leere Abschnitte im Klartext" — samt Gegenprobe, dass **unsere** Ikonen kein `img`-Vorleseziel sind (der einzige `img` je Kopfzeile ist antds Pfeil mit `aria-label="expanded/collapsed"`, eine Zustandsansage, kein Piktogramm) |
| **7 · Eine Farbe = eine Bedeutung** | **erfüllt (seit LFH-493)** | Rot bedient nichts; kein `danger` auf der Seite. Das antd-Preset `<Tag color="green">` am Wire-Status ist weg: der Kopf trägt seit LFH-493 `StatusBadge` über `LAGEBERICHT_STATUS` — derselbe Träger wie die Liste, damit **eine** Farbbehandlung je Enum (C6). Die Entscheidung, die N1 verlangte, ist damit getroffen und begrenzt: die Phasenachse bleibt außerhalb des A2-Vertrags; sie dorthin zu heben wäre der Bestands-Sweep, den `statusFarben.ts` für `kommunikation/phase.ts` namentlich ausschließt, und bleibt ein eigenes Ticket |
| **8 · Helligkeits-/Kontrastregler** | **offen, unverändert** | → **LFH-397**, app-weit |
| **9 · Kritische Anzeigen im Blickfeld** | **teilweise erfüllt** | Der **Autosave-Fehler** meldet sich als Toast (`onFehler` → `message.error`, `:85`), der Erfolg **nicht** (EEMUA 191, C7). Ein Toast verschwindet nach ~3 s; anders als bei den Einstellungsseiten (C10/H14) steht der Zustand danach aber **sichtbar in der Seite**: „ungespeicherte Änderungen" bleibt neben dem Knopf stehen, solange der Server nichts bestätigt hat. Der Beleg ist also da, nur der Grund nicht. `SpeicherFehler` im Kopf wäre die Vollform → **Nachzug N2** (gilt für beide Zwillingsseiten) |
| **10 · Alarmbudget** | **erfüllt** | Der Autosave erzeugt **keinen** Erfolgs-Toast — eine Meldung alle 30 s wäre eine Alarmquelle. Quittungen nur nach Nutzeraktion („Entwurf gespeichert", „Bericht freigegeben"). Live-Ereignisse erzeugen kein sichtbares Element (Zeile 12) |
| **11 · Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton; einziger bewegter Zustand ist antds Auf-/Zuklappen und der `loading`-Spinner |
| **12 · Kein Sprung unter dem Cursor** | **erfüllt** | Das ist der Kern von H63: eine fremde Änderung (SSE → Invalidierung → neue Objektidentität) **überschreibt keine offene Fassung mehr** (`useEntwurfVerlustschutz`, Riegel), und ohne offene Fassung wird sie übernommen — als **Paar** getestet, mit unabhängigem Zeugen (Überschrift aus der Query) und Mutationsprobe (Riegel raus → zwei Tests rot). Der Merker gehört zu EINEM Bericht: `key={lbId}` (`:32`), Test „lädt beim Wechsel der Bericht-ID neu, auch wenn im alten Bericht etwas offen war". Was die Seite **nicht** hat und nicht braucht: ein Sammelbanner — es gibt keine Zeilenmenge, nur einen Datensatz |
| **13 · Fokus nie verdeckt** | **erfüllt [abgeleitet]** | Weder Seite noch Akkordeon setzen `position: sticky`/`fixed`; der `Anchor` mit `affix`, den das Ticket nannte, ist **nicht** gebaut — damit ist auch die Verdeckungsfrage, die er aufgeworfen hätte, nicht entstanden. Fokus im zugeklappten Abschnitt: antd setzt `display: none` auf den Inhalt, ein Tab-Sprung landet dort nicht; der Klick auf die Kopfzeile öffnet ihn |
| **14 · Tabellenseite vollständig** | **nicht anwendbar** | Vollseiten-Formular, keine Menge |
| **15 · Erfassungsmaske vollständig** | **teilweise erfüllt** | Handgebautes `<Form>` (Bestand, kein `ErfassungsFormular` — die Seite ist keine Schnellerfassung, sondern eine Minuten-Schreibstrecke; Serienmodus wäre sinnlos). **Trägt:** Labels über dem Feld, `Checkbox` „Vorschau neben dem Text" als **Einstellung in eigener Zeile** mit Vorgabe AUS (`:283-289`; Memory „Schalter nicht in die Aktionsreihe"), alle acht Editoren im DOM (`forceRender`, sonst schickte ein Speichern zugeklappte Abschnitte leer — getestet über `textarea[id]` = 8), Zeitstand-`DatePicker` in Ortszeit mit UTC auf dem Wire (`etb/filterZeit`, Test „schickt ihn als UTC-Wirestring"). **Fehlt:** kein Fokus beim Einstieg (kein `autoFocus`, kein rAF-Effekt) — Bestand, und beim Öffnen eines Entwurfs ist das erste Feld der Titel, der fast nie geändert wird; wohin der Fokus gehört (erster leerer Abschnitt?), ist eine offene Bedienfrage → **Nachzug N3** |

**Verdikt-Bilanz:** 9 erfüllt · 4 teilweise erfüllt · 1 offen · 1 nicht anwendbar.

---

## Tabelle 2 — Berichtsliste (`pages/LageberichtePage.tsx`)

| # | Verdikt | Beleg |
| --- | --- | --- |
| **1 · Treffläche** | **erfüllt [abgeleitet]** | Einzige `size`-Angabe: `Spin size="large"` (`:179`). Karte, Links, Filter-`Select` und Suchfeld kommen aus `Datensicht` und sind dort über die Dichtestaffel gemessen (`e2e/datensicht-schmal.spec.ts`) |
| **2 · Handschuh-Modus** | **teilweise erfüllt** | wie Tabelle 1; Kartensicht in jeder Breite (Guard `NUR_KARTE`) → **LFH-373** |
| **3 · Rückmeldung vor der Serverantwort** | **erfüllt** | `ladend` an der Sicht, `laeuft` an der Hülle (Knöpfe auf Ladeanzeige), Kopf zählt Bestand |
| **4 · Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Die Liste hat keine destruktive Aktion; Anlegen ist umkehrbar (Entwurf) |
| **5 · Kontrast in beiden Modi** | **erfüllt** | Keine Farbliterale; `StatusBadge` aus `kommunikation/` |
| **6 · Kein Status allein über Farbe** | **erfüllt** | `StatusBadge` trägt `label` (Pflicht), Gruppenköpfe „Entwürfe"/„Freigegeben" im Klartext |
| **7 · Eine Farbe = eine Bedeutung** | **erfüllt (seit LFH-493)** | Rot bedient nichts. Der Berichtsstatus läuft über die Phasenachse (`LAGEBERICHT_STATUS`), jetzt auch im Seitenkopf über `StatusBadge` statt über ein Preset — derselbe Punkt wie Tabelle 1 Zeile 7 |
| **8 · Helligkeits-/Kontrastregler** | **offen, unverändert** | → **LFH-397** |
| **9 · Kritische Anzeigen im Blickfeld** | **teilweise erfüllt** | Der Anlege-Fehler kommt als Toast (`:162`) — bei einem 422 aus dem Modal bleibt das Modal aber **offen** mit den Werten (die Hülle leert nur bei Erfolg, `mutateAsync`), der Fehler ist also nicht mit „gespeichert" verwechselbar. Vollform (`SpeicherFehler` im Dialog) → **Nachzug N2** |
| **10 · Alarmbudget** | **erfüllt** | Keine Alarme; Live-Ereignisse gehen durch das Sammelbanner des Primitivs |
| **11 · Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton |
| **12 · Kein Sprung unter dem Cursor** | **erfüllt** | Zusicherung 5 des Primitivs (`zufluss: 'sammelbanner'`, Default). **Ketten statt Berichte** senken den Zufluss zusätzlich: eine Fortschreibung ersetzt eine Karte, statt eine zweite gleichnamige hinzuzufügen |
| **13 · Fokus nie verdeckt** | **erfüllt [abgeleitet]** | keine fixierte Konstruktion auf der Route; das Modal ist ein Überlagerer mit Fokusfang |
| **14 · Tabellenseite vollständig** | **nicht anwendbar — begründete Kartensicht** | `form="karte"` in jeder Breite, im Guard als `NUR_KARTE` gepinnt (B2/Bündel III): ein Bericht wird als Einheit gelesen. Suche (Titel, Vorlage), Filter (Vorlage), Sortierung (Fassung) und Gruppen (Status) laufen über die **Kettenköpfe**; ein Vorgänger ist über seinen Link erreichbar, aber kein eigener Treffer — das ist der Sinn der Kette, kein Verlust |
| **15 · Erfassungsmaske vollständig** | **erfüllt** | `ErfassungsModal` (`:262-282`): Absende-Knopf **im** `<form>`, kein antd-Footer (beides getestet), Fokus im ersten Feld — das ist der **Titel**, deshalb steht er vor der Vorlage; Titel aus der Uhrzeit vorbelegt (`titelVorschlag`, beim **Öffnen** gebildet, nicht beim Mount — sonst trüge ein zweites Öffnen die Uhrzeit des ersten); Zeitstand als drittes, optionales Feld mit Klartext „Leer gelassen: jetzt" (3 Felder ≤ LFH-19). Zurücksetzen auf allen vier Wegen erbt die Seite von der Hülle. Serienmodus **nicht** gesetzt — Berichte entstehen nicht im Minutentakt |

**Verdikt-Bilanz:** 9 erfüllt · 3 teilweise erfüllt · 1 offen · 2 nicht anwendbar.

---

## Tabelle 3 — Lagemeldungen (`pages/LagemeldungenPage.tsx`)

| # | Verdikt | Beleg |
| --- | --- | --- |
| **1 · Treffläche** | **erfüllt [abgeleitet]** | Einzige `size`-Angabe: `Spin size="large"` (`:96`). Links, Filter-`Select`s, Suchfeld aus `Datensicht` |
| **2 · Handschuh-Modus** | **teilweise erfüllt** | wie oben → **LFH-373** |
| **3 · Rückmeldung vor der Serverantwort** | **erfüllt** | `ladend`; Leerzustand erst **nach** dem Laden (`!lageQuery.isLoading && …`, `:122`) — vorher zeigte die Seite beim Laden kurz „Noch keine …" |
| **4 · Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Lesefläche ohne Aktion (B3: keine Primäraktion, Begründung im Quelltext) |
| **5 · Kontrast in beiden Modi** | **erfüllt** | Keine Farbliterale. Der `Tag color="gold"` „Lageobjekt" des Bestands ist **entfallen**: eine Farbfläche ohne Aussage auf einer Seite, die schon „Lagerelevante Meldungen" heißt |
| **6 · Kein Status allein über Farbe** | **erfüllt** | Es gibt keinen Status; Zeit, Herkunft und Ort sind Text |
| **7 · Eine Farbe = eine Bedeutung** | **erfüllt** | Einzige Farbe ist der Link (`bedien`) |
| **8 · Helligkeits-/Kontrastregler** | **offen, unverändert** | → **LFH-397** |
| **9 · Kritische Anzeigen im Blickfeld** | **erfüllt** | Ladefehler als `Alert` in der Seite (`:117`), kein Toast |
| **10 · Alarmbudget** | **erfüllt** | Keine Alarme; Zufluss über das Sammelbanner |
| **11 · Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton |
| **12 · Kein Sprung unter dem Cursor** | **erfüllt** | Zusicherung 5 des Primitivs — **neu für diese Fläche**: die nackte `Liste` des Bestands schob jede neue Lagemeldung sofort ein |
| **13 · Fokus nie verdeckt** | **erfüllt [abgeleitet]** | keine fixierte Konstruktion |
| **14 · Tabellenseite vollständig** | **nicht anwendbar — begründete Kartensicht** | `form="karte"`, Guard `NUR_KARTE` (zwölfte Konsumentin). Ein Lageobjekt wird gelesen („was ist passiert?"). Die Sicht trägt, was das Ticket verlangte: Zeit führend und **taktisch** (`ZeitAnzeige format="kurz"`, `:60`, kein roher Wirestring — getestet), absteigend, **Tagesgruppen** in der Anzeigezone (`lagemeldungen/zeitachse.ts`, Tagesgrenze beidseits geprüft: 23:30 UTC ist in Berlin der nächste Tag), Rückweg `Meldung #n` über `meldungenPfad` (`:71`; `grep 'einsaetze/\${'` = 0), Filter Zeitfenster (Stunde / 4 Stunden / Heute, Grenzen einschließend, getestet) und Koordinaten (mit/ohne, getestet), Suche über Text und Absender |
| **15 · Erfassungsmaske vollständig** | **nicht anwendbar** | keine Erfassung auf dieser Fläche |

**Verdikt-Bilanz:** 10 erfüllt · 1 teilweise erfüllt · 1 offen · 3 nicht anwendbar.

---

## Review-Runde (28.08.2026) — vier Befunde, alle behoben im selben Zug

Der Reviewer fand **zwei nachweislich falsche Code-Zusicherungen** und **zwei Lücken im
Verlustschutz**; alle vier sind gefixt und je mit einem Test belegt, der vorher fehlte:

1. **Titelvorschlag veraltete beim zweiten Öffnen** — der Kommentar behauptete das Gegenteil.
   Gemessen: der Speicher von rc-field-form überlebt `destroyOnHidden` und gewinnt beim
   Remount gegen `initialValues` (`useForm.js`: `merge(initialValues, store)`). Der
   Vorschlag wird jetzt beim Öffnen per `setFieldsValue` in den Store geschrieben; Test
   „trägt beim zweiten Öffnen einen frischen Titelvorschlag".
2. **`tagesEtikett` brach den Zonenvertrag seines eigenen Moduls** — der einzige Aufrufer
   reichte kein `jetzt` durch, „Heute" fiel bei abweichender Anzeigezone auf den falschen
   Tageskopf. Die Funktion nimmt jetzt die Konventionen selbst (`jetztInZone`), der Aufrufer
   kann es nicht mehr falsch machen; Test mit `Pacific/Auckland`.
3. **Verlustfenster im Verlustschutz**: blur startete den PATCH mit S1, weitergetippt zu S2,
   die Quittung für S1 räumte den Merker — S2 lag ungesichert und unangemeldet im Formular.
   Jetzt ein Änderungszähler: quittiert wird nur, wenn seit dem Start des Speicherns nichts
   geändert wurde. Test mit manuell aufgelöstem Promise; dazu der Fehlerfall-Test (Autosave
   scheitert → `onFehler`, Merker bleibt). Der Riegel gegen Doppel-Autosave ist eine Ref.
4. **Nach der Freigabe blieb der Merker stehen** — der Browser fragte beim Neuladen nach
   Änderungen an einem nicht mehr editierbaren Bericht. `quittiereGespeichert()` nach dem
   Speichern im Freigabe-Dialog, in **beiden** Zwillingsseiten.

Zwei Minor-Punkte ebenfalls mitgenommen: der Zeitstand-Picker ist nicht mehr löschbar
(`zeitstand` ist serverseitig nicht nullbar, ein geleertes Feld zeigte dauerhaft etwas
anderes als die DB), und im Entwurfszweig steht der rohe UTC-Wirestring nicht mehr direkt
über dem Picker in Ortszeit.

## Nachzüge

| # | Was | Wo |
| --- | --- | --- |
| **N4 → LFH-495** | Hook-Nachzüge aus dem Review: `autosaveLaeuft` als `loading` am Speichern-Knopf nutzen oder streichen; expliziter Speichern-Klick blurrt zuerst (Autosave-PATCH) und sendet dann (zweiter PATCH) — gemeinsamer Riegel; 30-s-Frist und „kein Autosave am freigegebenen Stand" im Hook-Test; `Form.useWatch([], form)` rendert die Seite je Anschlag — messen, ggf. auf Abschnittspfade einschränken; `kettenKoepfe` bei vollständigem Zyklus: Restmenge als Einzelköpfe statt leere Liste | `entwurf/useEntwurfVerlustschutz.ts`, `LageberichtDetailPage.tsx`, `lageberichte/ketten.ts` |
| **N1 → LFH-493 · erledigt** | Berichts-/Befehlsstatus nicht mehr als antd-Preset: beide Köpfe nehmen `StatusBadge` über `LAGEBERICHT_STATUS`/`BEFEHL_STATUS`. Die Grundsatzfrage ist entschieden — die Phasenachse wandert **nicht** in den A2-Vertrag; ein Umbau von `StatusBadge` auf `StatusTag` träfe acht Konsumenten in vier Modulen samt `unbearbeitet`-Zweikanal (C8/H47) und bleibt ein eigenes Ticket im Stil von LFH-341/C6. Gepinnt in `kommunikation/kopfStatus.guard.test.ts` | `LageberichtDetailPage.tsx`, `BefehlDetailPage.tsx`, `kommunikation/phase.ts` |
| **N2 → LFH-494** | Speicher-/Anlegefehler als `SpeicherFehler` in der Seite bzw. im Dialog statt nur als Toast (Fortschreibung von C10/H14 auf die Entwurfsseiten) | beide Detailseiten, `LageberichtePage.tsx` |
| **N3 → LFH-495** | Fokus beim Einstieg in einen Entwurf — welches Feld? (erster leerer Abschnitt wäre der Kandidat) | `LageberichtDetailPage.tsx`, `BefehlDetailPage.tsx` |

Die drei sind **je ein Ticket**; N1 und N2 betreffen beide Zwillingsseiten und gehören
gemeinsam angefasst, sonst entsteht wieder die Divergenz, die C13 mit dem Hook geschlossen hat.
