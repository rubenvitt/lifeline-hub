# Prüfliste Einsatztauglichkeit — Modul „Wetter & Pegel" (LFH-633)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen Seite. Planung, Spec und Entwurf liegen in
`openspec/changes/lfh-633-fachmodul-wetter-pegel/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/wetter-pegel` (`frontend/src/pages/WetterPegelPage.tsx`) |
| Stand | Commit `c1acab7d` auf `feat/lfh-633-wetter-pegel-modul` |
| Zielkontext | Fükw (1366 px, Tastatur + Maus, Nachtmodus als Regelfall); Führungs-Tablet in `komfortabel`/`handschuh`; mobil 390 px lesend |
| Nicht enthalten | DWD-Kartenebene der Lagekarte (→ LFH-662), Modulzähler oder Hinweis bei Unwetter (→ LFH-663), Pflege der Pegel (bleibt in Einstellungen › Pegel, dort LFH-606/628) |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Pegel mit Verlauf** | `wetter/PegelPaneel.tsx`, `wetter/Verlaufslinie.tsx` | ja: Gate 1, Gate 3 (Primäraktion), Sichtprüfung |
| **2 · Warnungen und Vorhersage** | `wetter/WetterPaneele.tsx`, `wetter/wetterStand.ts`, `wetter/wetterText.ts` | ja: Ausfall, veraltet, Gate 1, Gate 3 (Umschalter), Kontrast der Stufen-Chips |
| **3 · Wege aus Dashboard und Überblick** | `pages/lage-dashboard/lagebild.ts`, `pages/fuehrung/UeberblickPage.tsx`, `routing/deeplinks.ts:pegelZielPfad` | Sichtprüfung (Ziel der Kennzahl), sonst Vitest |

**Verdikte:** **erfüllt** gilt nur mit Beleg (Testdatei + Testname oder Messung + Commit).
**offen → Zielticket**. **nicht anwendbar** gilt nur mit Begründung. Gerechnetes und aus dem
Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis | Stand |
| --- | --- | --- |
| `e2e/wetter-pegel.spec.ts` „Quellausfall: …" | beide Wetter-Paneele zeigen „Stand unbekannt“ im Sichtbereich (`toBeInViewport`), 0 Warnungen, 0 Vorhersagezeilen; der Leitpegel zeigt weiter „6,84“ und seine Verlaufslinie | `c1acab7d` |
| `e2e/wetter-pegel.spec.ts` „Alter Warnstand: …" (45 min) | Liste bleibt (2 Warnungen), Hinweis „… · veraltet — die Aktualisierung gelingt gerade nicht“ | `c1acab7d` |
| `e2e/wetter-pegel.spec.ts` „Gate 1: …", lange Stations- und Gemeindenamen, Beschreibung aufgeklappt | Querlauf **0 / 0 / 0 px** auf 1366 / 1024 / 390 | `c1acab7d` |
| `e2e/gate1-ueberlauf.spec.ts` „Gate 1: keine tragende Route …" mit der Route `/wetter-pegel` | kein Querlauf auf 1366 / 1024 / 390 px | `c1acab7d` |
| `e2e/wetter-pegel.spec.ts` „Gate 3: …" | Primäraktion „Pegel festlegen“ **30 / 48 / 72** px · Umschalter „Beschreibung und Handlungsempfehlung“ **30 / 48 / 72** px | `c1acab7d` |
| `e2e/wetter-pegel.spec.ts` „Kontrast der Warnstufen-Chips im Modus light/dark" | Wort im Chip „Markantes Wetter“ (`achtung`) und „Unwetterwarnung“ (`alarm`): Tag ≥ 7 : 1, Nacht ≥ 5 : 1 (`kontrast-kern.ts`, Alpha gemischt) | `c1acab7d` |
| Browser-Sichtprüfung gegen die echten Quellen (Playwright-Skript, Einsatz „Hochwasser Weser“ in Bremen, Pegel HOYA und INTSCHEDE) | Nacht und Tag, 1366 und 390 px: zwei Verlaufslinien mit je 96 Punkten, „Keine gültigen Warnungen für Stadt Bremen.“, acht Vorhersagezeilen, „Station Bremen, 3,3 km“. Einsatz ohne Ort: Erklärung in beiden Paneelen, **ein** Weg zu den Einsatzdaten. Dashboard-Kennzahl „Pegel“ zeigt auf `/einsaetze/1/wetter-pegel` | `c1acab7d` |
| Grep über `wetter/*.ts(x)` und `pages/WetterPegelPage.tsx` (ohne Tests) | Farbliterale **0** · `animation`/`blink`/`keyframes`/`transition` **0** · `danger` **0** · `sticky`/`fixed` **0** · `size=` nur `Spin size="large"` (Ladeanzeige) | `c1acab7d` [abgeleitet] |

---

## Tabelle 1 — Pegel mit Verlauf

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Trefffläche** ≥ 24 × 24 px; zeitkritische Aktion ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Gate 3: Primäraktion 30 / 48 / 72 px. Auf der Seite gibt es keine zeitkritische Aktion, sie liest nur. Der Knopf im Leerzustand ist ein antd-`Button` und erbt die Staffel [abgeleitet]. Die Verlaufslinie ist kein Bedienziel: der Zeiger zeigt nur eine Ablesung, ein Klick bewirkt nichts | — |
| 2 | **Handschuh-Modus** — Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt** | Gate 3 `handschuh`: 72 px. In keiner Zeile stehen zwei Bedienziele nebeneinander, die Abstandsfrage stellt sich also nicht [abgeleitet] | — |
| 3 | **Rückmeldung vor der Serverantwort** ≤ 100 ms | **erfüllt** | `PaneelZustand` zeigt beim Laden ein Skelett statt einer leeren Liste. Ein Neuladen nach einem Fehler läuft über den Knopf „Erneut abrufen“ (Bestandsbaustein) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Die Seite schreibt nichts. Festlegen und Prognose liegen in Einstellungen › Pegel (LFH-606/628, dort geprüft) | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt [abgeleitet]** | Wert, Trend und Stand stehen in `rollen.text`/`text2`, „veraltet“ in `achtungText`. Das sind dieselben Rollen, die `pegel-pruefliste.spec.ts` an der Pegel-Kennzahl misst. Die Verlaufslinie trägt `rollen.text` auf `paneel`. Ein eigener Browsernachweis für diese Fläche fehlt; gemessen sind die Chips in Fläche 2 | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | „veraltet“ und „Stand unbekannt“ stehen als Wort, die Kante `achtung` ist der zweite Kanal. Die Richtung steht als Wort („steigend +9 cm/h“), nicht als Linienfarbe. `WetterPegelPage.test.tsx` „ein alter Messwert bleibt mit ‚veraltet' und Kante stehen“; `Verlaufslinie.test.tsx` „keine Farbe als einziger Träger …“ | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Die Linie ist neutral (Textfarbe). Die Kante `achtung` steht nur für „Stand nicht aktuell“, wie an der Kennzahl. Die Prognose ist eine gestrichelte Hilfslinie ohne eigene Farbe | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke, wie in allen Prüflisten seit LFH-336 | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Das Pegel-Paneel steht oben über die volle Breite, der Leitpegel zuerst. In der Sichtprüfung (1366 × 900) stehen beide Pegel, die Warnungen und die ganze Vorhersage ohne Scrollen im Bild | — |
| 10 | **Alarmbudget** | **erfüllt** | Die Seite erzeugt keinen Hinweis, keinen Toast und keinen Ton. Ob eine Unwetterwarnung einen Hinweis bekommt, ist bewusst ausgelagert | LFH-663 (Entscheidung) |
| 11 | **Warnverhalten** — kein Blinken | **erfüllt** | Grep `animation`/`blink` 0. Die Ablesung am Zeiger springt, sie animiert nicht | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt [abgeleitet]** | Die Pegelliste ändert ihre Zeilen nur bei einer Pflege in den Einstellungen, also nicht während man hier liest. Ein Nachladen alle 5 min tauscht nur Werte, nicht die Reihenfolge | — |
| 13 | **Fokus nie verdeckt** | **erfüllt [abgeleitet]** | Keine fixierte Konstruktion (Grep `sticky`/`fixed` 0), kein Überlagerer | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle: 1 bis 5 Pegel, gefragt ist „was ist mit diesem Pegel?“ (Dateikopf `PegelPaneel.tsx`) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Erfassung | — |

**Bilanz:** 11 erfüllt (davon 3 [abgeleitet]: Nr. 5, 12, 13) · 1 offen · 3 nicht anwendbar; Nr. 10 mit Folgeentscheidung in LFH-663.

## Tabelle 2 — Warnungen und Vorhersage

Nur die Zeilen, die sich von Tabelle 1 unterscheiden. Nr. 3, 4, 8, 11, 13, 14 und 15 gelten wie dort.

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1/2 | Trefffläche, Handschuh | **erfüllt** | Gate 3: der Umschalter „Beschreibung und Handlungsempfehlung“ misst 30 / 48 / 72 px. Er ist ein antd-`Button type="link"`, kein handgebautes Ziel. „Einsatzort in den Einsatzdaten verorten“ ist ein antd-`Button` [abgeleitet] | — |
| 5 | **Kontrast** | **erfüllt** | Stufen-Chips gemessen: Tag ≥ 7, Nacht ≥ 5 (`wetter-pegel.spec.ts`, beide Modi). Die übrigen Texte nutzen `text`/`text2`/`achtungText` [abgeleitet] | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Jede Stufe trägt die amtliche Bezeichnung als Wort (`dwdWarnstufe`, Pflichtfeld `label`; `statusFarben.test.ts` „dwdWarnstufe (LFH-633)“ und der Kanaltest über alle Karten). Der Zustand steht als Wort: „Stand unbekannt“, „veraltet“, „Keine gültigen Warnungen für …“. Die Gruppen „Gilt jetzt“ und „Angekündigt“ sind Überschriften. Ein fehlender Einzelwert erscheint als „—“, nie als 0 (`WetterPegelPage.test.tsx` „acht 3-h-Zeilen …“, `wetterText.test.ts`) | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | `achtung` steht für Wetterwarnung/markant und für „veraltet“, `alarm` für Unwetter/extrem. Keine Stufe liegt auf Blau (`bedien`); der Test „keine Warnstufe ist Bedienblau oder neutral“ pinnt das | — |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Die schwerste Warnung steht oben (Backend sortiert nach Stufe absteigend, `src/wetter/quelle.rs` „gueltige_filtert_abgelaufene_und_sortiert“), „Gilt jetzt“ vor „Angekündigt“. Die Gemeinde steht im Paneelkopf, sodass klar ist, WO die Warnung gilt | — |
| 10 | **Alarmbudget** | **erfüllt** | Kein Hinweis, kein Ton. Eine neue Unwetterwarnung löst heute nichts aus; ob sie es soll, ist bewusst eine eigene Entscheidung | LFH-663 |
| 12 | **Kein Sprung unter dem Cursor** | **offen** | Das Nachladen alle 5 min kann eine NEUE Warnung oberhalb der gelesenen Zeile einschieben (Sortierung nach Stufe). Das ist selten, weil Warnzellen-Warnungen im Stundentakt erscheinen, aber nicht ausgeschlossen. Eine aufgeklappte Beschreibung bleibt dabei an IHRER Warnung (Schlüssel aus dem Inhalt, nicht dem Listenplatz: `warnungsSchluessel`). Ein Sammelbanner („1 neue Warnung“) gehört zur Entscheidung über den Hinweis | LFH-663 |
| — | **Quellausfall** (AK des Tickets) | **erfüllt** | „Stand unbekannt“ statt eines alten Werts ohne Kennzeichnung. Die Obergrenze prüft das Backend (6 h / 12 h → `ausfall`, `src/wetter/abruf.rs` „stand_ueber_der_obergrenze_ist_ausfall“, Ausfall über die Route `tests/wetter.rs` „tote_quelle_ist_ausfall_fuer_beide_und_trotzdem_200“), „veraltet“ ab 30 min / 3 h das Frontend (`wetterStand.test.ts` mit Grenzfällen). Eine abgelaufene Warnung fällt auch aus einem alten Stand heraus (`src/wetter/abruf.rs` „abgelaufene_warnung_verschwindet_aus_altem_stand“). e2e siehe oben | — |
| — | **Datenschutz: Koordinate an Dritte** | **erfüllt, Restrisiko bewertet** | An `api.brightsky.dev` gehen nur Breite und Länge, auf zwei Nachkommastellen (~1 km) gerundet, ohne Einsatzbezug, Namen oder Kennung. Die gerundete Koordinate steht höchstens 2 Tage im Nachschlage-Cache (Prune-Fenster) und hat dort keinen Einsatzbezug. Deshalb erfasst `schwaerze_einsatz` sie nicht und muss es auch nicht. Der Cache-Schlüssel trägt die Organisation (`src/wetter/abruf.rs` „rundung_von_schluessel_und_anfrage“). Sonst verriete `abgerufen_at` einer fremden Organisation, dass am selben Ort gerade ein Einsatz Wetter abfragt (Review-Befund, behoben) Wer das nicht will, blendet das Modul aus: ein Einsatz ohne Ort fragt nie an | — |
| — | **Quellenvermerk** | **erfüllt** | „Datenbasis: Deutscher Wetterdienst · über Bright Sky“ im Fuß beider Paneele (Nutzungsbedingungen DWD); `WetterPegelPage.test.tsx` zählt ihn zweimal | — |

## Tabelle 3 — Wege aus Dashboard und Überblick

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 9 | Blickfeld | **erfüllt** | Der Weg führt von der Kennzahl direkt auf die Seite mit Verlauf; vorher endete er in der Pflege | — |
| — | **Sichtbarkeit** | **erfüllt** | Das Ziel ist das Modul nur, wenn es für die Person frei ist (`istKeyFreigegeben`), sonst die Pflege. Bis die Overrides geladen sind, gilt die Pflege, also kein Sprung auf ein womöglich ausgeblendetes Modul. Paare: `deeplinks.test.ts` „pegelZielPfad …“, `modulRegistry.test.ts` „istKeyFreigegeben (LFH-633)“, `lagebild.test.ts` „Pegel: das Ziel kommt als Eingabe …“, `UeberblickPage.test.tsx` „Modul ‚Wetter & Pegel' frei …“ / „Modul ausgeblendet …“ (Mutationsprobe: Weiche fest auf `true` → rot) | — |
| — | **Modul-Gate** | **erfüllt** | `GET …/wetter` antwortet bei ausgeblendetem Modul mit 403 (`tests/wetter.rs` „modul_ausgeblendet_ist_403_pegel_bleiben_200“, `tests/modul_override.rs` `MODUL_GET_PFADE`). Die Pegel-Routen bleiben modul-los: Dashboard und Überblick lesen sie auch ohne das Modul | — |
