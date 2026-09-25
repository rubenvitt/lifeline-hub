# Prüfliste Einsatztauglichkeit — Demo-Daten zur Laufzeit (LFH-690)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen Seite. Planung und Spec liegen in diesem
Verzeichnis (`design.md` D13, `specs/demo-daten/spec.md`), Task 7.1 in `tasks.md`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/admin/demo-daten` (`frontend/src/admin/DemoDatenPage.tsx`, Menüeintrag in `admin/AdminLayout.tsx`) und der Hinweis in `/einsaetze` (`frontend/src/pages/EinsaetzePage.tsx`, `demoHinweis`) |
| Stand | Code-Stand Commit `b13c555b` auf `feat/lfh-690-demo-daten-laufzeit-import`, Arbeitsbaum sauber. Vite (Port 15690) läuft nachweislich aus diesem Worktree (`lsof … -d cwd`). Das Backend (Port 18690, `--demo-daten`, Feature `dev-seeds`) ist ein Debug-Build aus dem Scratchpad-Target dieser Session; den Commit, aus dem es gebaut ist, gibt das Binary nicht her. Die Prüfliste selbst ist der Commit danach |
| Zielkontext | Fükw (1366 px, Tastatur + Maus) und ortsfeste Stelle. Die Sektion ist Verwaltung: Demo-Daten werden vor einer Vorführung oder Schulung eingespielt und danach entfernt, nie unter Einsatzdruck. Führungs-Tablet (1024 px) und mobil (390 px) sind mitgemessen, weil die Verwaltung dort erreichbar ist; die Handschuhstufe ist gemessen, auch wenn sie hier selten gebraucht wird |
| Nicht enthalten | Demo-Marke an Stammdaten in Katalogen, org-weites Live-Ereignis für Einsatzliste und Stammdaten, Endlos-Reconnect des Live-Hooks bei 404 (Nachzüge aus Task 7.3) |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Verwaltungssektion „Demo-Daten"** in den Zuständen *nicht importiert* (ohne und mit Bericht), *importiert mit Bericht* und *Fehler (409)*, dazu der Menüeintrag | `admin/DemoDatenPage.tsx`, `admin/useDemoDaten.ts`, `admin/AdminLayout.tsx` | ja: Gate 1, Gate 3, Kontrast, Fokus, CLS, Klickweg |
| **2 · Rückfragen** „Demo-Daten neu importieren?" und „Demo-Daten entfernen?" | `Modal` in `admin/DemoDatenPage.tsx` | ja: Gate 3, Kontrast, Fokus |
| **3 · Hinweis in der Einsatzliste** | `pages/EinsaetzePage.tsx` (`demoHinweis`) | ja: Gate 1, Gate 3, Kontrast, Fokus, CLS |

**Verdikte:** **erfüllt** (nur mit Beleg: Messung oder Testdatei + Testname) · **offen →
Zielticket** · **nicht anwendbar** (mit Begründung). Gerechnetes und aus Quelltext
Geschlossenes trägt **[abgeleitet]**. Platzhalter `LFH-NEU-…` legt der Controller an.

## Die Nachweise

**Messskript** (temporär, nicht committet): `pruefliste-lfh690.spec.ts` mit eigener
`playwright.config.ts` (ohne `webServer`, `baseURL http://127.0.0.1:15690`, Chromium,
`de-DE`, `Europe/Berlin`) unter
`/private/tmp/claude-501/-Users-rubeen-dev-personal-lifeline-hub--claude-worktrees-lfh-358-b548bd/3ab845e7-a246-4402-a9d7-2046a4db40ee/scratchpad/pruefliste/`.
Rohwerte in `aus/ergebnisse.jsonl`, Bildschirmfotos in `aus/`. Die Messkerne
`frontend/e2e/kontrast-kern.ts` (`kontrast`, `randKontrast`) und `frontend/e2e/fokus-kern.ts`
(`pruefeFokusVerdeckung`) sind unverändert importiert. Die Überlaufrechnung aus
`gate1-ueberlauf.spec.ts` (`ueberlauf`, dort nicht exportiert) und die Höhen- und
Abstandsrechnung aus `gate3-trefflaeche.spec.ts` (`boundingBox`, `max(Δx, Δy)` zwischen zwei
Kästen) sind übernommen. Der Fokusring wird mit einer eigenen Rechnung nach derselben
Luminanzformel gemessen, weil der Kern nur `border-*` kennt. Stufen: 1 (Ausgangszustand
ohne Bericht, nur einmal messbar), 1b/1c (Gegenproben per Route-Abfang, ohne
Zustandsänderung), 2 (Import per Klick, Zustand *importiert*), 3 (Neu importieren,
Entfernen, 409), 4 (409-Alert über 12 s).

| Nachweis | Ergebnis |
| --- | --- |
| Gate 1, waagerechter Überlauf (`scrollWidth − clientWidth` der Wurzel) | **0 px in allen 33 Messungen**: `/einsaetze` mit Hinweis und `/admin/demo-daten` *nicht importiert ohne Bericht* je 1366 / 1024 / 390 px × drei Dichten (18); *importiert mit Bericht* 1366 / 1024 / 390 × drei Dichten (9); *nicht importiert mit Bericht* 1366 / 1024 / 390 × `kompakt`/`handschuh` (6) |
| Gate 3, Höhe (kompakt / komfortabel / handschuh; Sektion und Rückfragen bei 1366, 1024 und 390 px, Hinweis und Menü bei 1366 und 390 px, jeweils auf allen Breiten gleich) | „Importieren" **30 / 48 / 72** · „Neu importieren" **30 / 48 / 72** · „Entfernen" **30 / 48 / 72** · Einsatz-Link **30 / 48 / 72** (Breite 166–195 px) · Rückfrage „Ersetzen" / „Endgültig entfernen" / „Abbrechen" / Schließkreuz je **30 / 48 / 72** · Hinweis-Link **30 / 48 / 72** (Breite 77–86 px) · Menüeintrag „Demo-Daten" **37,5 / 60 / 90** · Expander „Verwaltung: …" unter `lg` **30 / 48 / 72** |
| Gate 3, Abstand | „Neu importieren" ↔ „Entfernen" **11 / 18 / 26 px** (auf allen drei Breiten). Einsatz-Link ↔ „Neu importieren" bei 390 px **19 / 30 / 43 px**. Hinweis ↔ Kachelraster 44 px in `handschuh` [abgeleitet aus den Kästen: Alert 161 + 148,6 → Raster 353,6]. **Rückfrage „Abbrechen" ↔ rote Bestätigung 3 / 5 / 7 px** |
| Hinweis-Link im Fließtext | `verweisStil` setzt `display: inline-flex; min-height: controlHeight` ohne Polsterung (`padding 0`). Die Zeile, in der der Link steht, wächst dadurch auf die Staffel: bei 390 px in `handschuh` liegen die Textzeilen 23 px auseinander, die Linkzeile beginnt 48 px unter der vorigen, die Beschreibung ist 118 px hoch statt rund 69 [abgeleitet: 3 × 23]. Bildschirmfoto `aus/hinweis-handschuh-390.png` zeigt die Lücke vor „Verwaltung anlegen: Demo-Daten" |
| Kontrast Text (Durchlauf über jedes sichtbare Element mit eigenem Textknoten, gesperrte Knöpfe ausgenommen, 0 nicht messbare) | **Nacht:** alle Texte ≥ 5 : 1, Minimum 5,03 (Feldbeschriftung „Status") auf der Sektion, 7,18 im Dialog, 8,99 am Hinweis-Link, Fehler-Alert 13,81. **Tag, unter 7 : 1:** Seitenbeschreibung 5,33 · Paneelkopf „Stand"/„Letzter Vorgang" und Meta „Import · …" 5,84 · Feldbeschriftungen (Augenbraue) 6,37 · „Importieren" (weiß auf `bedien`) 6,59 · „Neu importieren"/„Entfernen"/„Endgültig entfernen" (antds Fehlerrot als Schrift) 6,78, im Hover 5,12 · **Hinweis-Link 6,04** auf der Info-Fläche. Alle übrigen Tagtexte ≥ 7, darunter Einsatz-Link, Statuswert, Datum, Berichtszeilen, Titel und Beschreibung des Hinweises, Fehler-Alert 14,95. Nie unter 4,5 : 1 |
| Kontrast Ränder und Zustände | Rand der roten Knöpfe gegen Fläche/Umgebung Tag 6,78 / 6,21, Nacht 6,77 / 7,06. Rand des Info-Hinweises 1,76 / 2,06 (Tag), 1,45 / 1,70 (Nacht), nicht tragend: der Hinweis ist über Fläche, Symbol und Titel erkennbar. **Fokusring** (antd, `outline 3px` in `colorPrimaryBorder`, per Tastatur als `:focus-visible` bestätigt) gegen den Grund: Knöpfe Tag 2,06–2,25 / Nacht 1,67–1,70, Einsatz-Link 2,46 / 1,61, Hinweis-Link 1,76 / 1,45. Bildschirmfotos `aus/fokusring-*.png` |
| Link gegen umgebenden Text (WCAG 1.4.1) | Hinweis-Link `rgb(22,79,134)` gegen Fließtext `rgb(17,20,24)`: **2,20 : 1** (Tag), **1,58 : 1** (Nacht), `text-decoration: none`, gleiches Schriftgewicht 400 |
| Fokus nie verdeckt (`pruefeFokusVerdeckung`, `handschuh`) | **0 verdeckte Ziele** in allen Läufen. Sektion *nicht importiert* 52 Stopps (1366 und 390), *importiert* 63 Stopps; markierte Ziele „Importieren" bzw. Einsatz-Link, „Neu importieren", „Entfernen" alle erreicht; fixierte Knoten 1 (Kopfleiste). Einsatzliste 36 Stopps, Hinweis-Link erreicht. Rückfrage: 5 Stopps, „Abbrechen" und „Endgültig entfernen" erreicht, fixierte Knoten 2 (Maske, Dialog). Escape schließt den Dialog, der Fokus steht danach wieder auf „Entfernen" |
| CLS `/admin/demo-daten` | **0** beim Laden (3 Läufe, Skelett → Inhalt) |
| **CLS `/einsaetze` mit Hinweis** (Layout-Shift-Beobachter aus `betroffene-layout.spec.ts`, je 3–5 Kaltladungen, Werte in allen Läufen gleich) | 1366 px: **0,041 / 0,056 / 0,086** · 1024 px: **0,054 / 0,074 / 0,120** · 390 px: **0,174 / 0,212 / 0,214** (kompakt / komfortabel / handschuh). Einzige Quelle: das Kachelraster rutscht um die Hinweishöhe nach unten (1366 kompakt y 115 → 233). **Gegenprobe:** mit abgefangenem Status 404 (kein Hinweis) **0** in allen Stufen; mit 1 s verzögertem Status dieselben Werte (0,041 / 0,061 / 0,099 bei 1366) — der Hinweis erscheint also regelmäßig nach dem Raster |
| Klickweg im Browser (1366, kompakt, Tag) | Importieren → Ladezustand am Knopf nach **15,2 ms**, POST 201 nach 81 ms, Status „Importiert", Bericht „Import · …", Einsatz-Link. Neu importieren → Dialog nach **11,6 ms**; Abbrechen: **0** schreibende Anfragen. Neu importieren → Ersetzen → Ladezustand nach **8,3 ms**, POST `/neu` 200 nach 106 ms, Einsatz 5 → 6, neues Datum, Toast. Entfernen → Endgültig entfernen → Ladezustand nach **5,8 ms**, DELETE 200 nach 38 ms, „Nicht importiert", Kopf trägt wieder „Importieren", Bericht „8 / 12 / 4 entfernt · 0 behalten". `/einsaetze`: Hinweis wieder sichtbar, kein Link auf die Demo-Einsätze 5 oder 6 |
| 409 im Browser (fremder Import und fremdes Entfernen per API, dann Klick) | DELETE 409; roter Alert „Entfernen fehlgeschlagen" mit Servertext „Für diese Organisation sind keine Demo-Daten importiert." bei y = 171,5 px unter der Seitenbeschreibung, **0** Toasts, Status neu geladen („Nicht importiert", „Importieren" im Kopf). Der Alert steht in Stufe 4 über 12 s in jeder Halbsekunde und nach einem Vollbild-Foto noch da; der nächste Import per Klick räumt ihn (0 Alerts) |
| Grep `admin/DemoDatenPage.tsx`, `admin/useDemoDaten.ts` | Farbliterale **0** · `animation`/`blink`/`keyframes`/`transition` **0** (ein Treffer im Kommentar) · `sticky`/`fixed` **0** · `danger` **3** (zwei Knöpfe, `okButtonProps`) · `size=` **1** (`Space size="middle"`, Abstandsmaß) [abgeleitet] |
| Vitest | `admin/DemoDatenPage.test.tsx` (23 Fälle, u. a. unten zitiert), `pages/EinsaetzePage.test.tsx` (sechs Fälle zum Hinweis), `admin/adminNav.test.tsx` |

---

## Tabelle 1 — Verwaltungssektion „Demo-Daten"

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** ≥ 24 × 24 px; zeitkritische Aktion ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Gate 3: „Importieren", „Neu importieren", „Entfernen" und Einsatz-Link 30 / 48 / 72 px, der Menüeintrag 37,5 / 60 / 90, der Expander 30 / 48 / 72; die schmalste Breite ist 91 px. Zeitkritisch ist hier nichts (Verwaltung); der Abstand der beiden roten Knöpfe liegt trotzdem in `komfortabel` bei 18 px. Der Einsatz-Link trägt `verweisStil` (Boden `controlHeight`) ohne Polsterung, wie die Verweise der ETB-Zeitachse; die zweite Angabe der Bedien-Leitlinie für handgebaute Ziele fehlt, die gemessene Fläche hält die Staffel trotzdem | — |
| 2 | **Handschuh-Modus** — Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt** | Gate 3 `handschuh`: 72 px an allen Zielen der Seite, Menüeintrag 90. Abstand „Neu importieren" ↔ „Entfernen" 26 px (`Space size="middle"`), Einsatz-Link ↔ „Neu importieren" bei 390 px 43 px. Die Rückfrage ist Fläche 2 | — |
| 3 | **Rückmeldung vor der Serverantwort** ≤ 100 ms; Kommandoreaktion ≤ 2 s | **erfüllt** | Browser: Ladezustand am auslösenden Knopf nach 15,2 / 8,3 / 5,8 ms (Import / Neu / Entfernen), Serverantwort nach 81 / 106 / 38 ms (Debug-Build, lokal); `design.md` (c) misst 40–61 ms über HTTP. Kein Vorgang nähert sich 2 s, eine Fortschrittsanzeige (> 15 s) ist nicht nötig. Gesperrt wird sichtbar: `DemoDatenPage.test.tsx` „während DELETE läuft, sind „Neu importieren" und „Entfernen" gesperrt", „zwei Klicks im selben Takt senden genau einen POST". Erfolg per Toast, Fehler an der Seite: „409 beim Import: Alert an der Seite mit Servertext, nicht in der Message-Queue", „nennt unter „Import fehlgeschlagen" die Erreichbarkeit, nicht „Speichern fehlgeschlagen"" | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | „Neu importieren" und „Entfernen" löschen den Demo-Einsatz samt Änderungen seit dem Import (unumkehrbar) und stehen hinter einer Rückfrage mit rotem Bestätigungsknopf. Im Browser: Abbrechen sendet 0 schreibende Anfragen, erst „Ersetzen" bzw. „Endgültig entfernen" sendet. Vitest: „Entfernen: Rückfrage mit danger-Knopf, DELETE erst nach Bestätigung", „Entfernen abbrechen sendet nichts", „Neu importieren: Rückfrage mit danger-Knopf, POST /neu erst nach Bestätigung". „Importieren" legt nur an und ist über „Entfernen" rückholbar; eine Rückfrage dort wäre Reibung ohne Schutz (LFH-363) | — |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1; Zustände, Rahmen, Fokusring ≥ 3 : 1 | **offen** | **Nacht erfüllt** (Minimum 5,03). **Tag unter 7 : 1, alles geerbte Rollen:** Seitenbeschreibung (`schwach` auf `grund`) 5,33 und Paneelkopf/Meta (`schwach` auf `paneel`) 5,84 → LFH-643; Feldbeschriftungen (`colorTextSecondary`) 6,37, „Importieren" (weiß auf `bedien`) 6,59 und die roten Knöpfe (antds `colorError` als Schrift) 6,78, im Hover 5,12 → LFH-652. Nie unter 4,5. Ränder der roten Knöpfe ≥ 6,2. **Fokusring unter 3 : 1:** antds Umriss in `colorPrimaryBorder` misst an den Knöpfen 2,06–2,25 (Tag) / 1,67–1,70 (Nacht), am Einsatz-Link 2,46 / 1,61 — app-weit, kein Modulwert | LFH-643, LFH-652, LFH-NEU-fokusring-kontrast |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Der Stand steht als Wort („Importiert" / „Nicht importiert") ohne Farbe; der Vorgang im Bericht als Wort („Import" / „Entfernen") samt Zahlen je Art. Die roten Knöpfe tragen ihre Handlung als Text, der Fehler-Alert Titel, Symbol und Servertext. Der Einsatz-Link steht allein in seinem Feld unter der Beschriftung „Einsatz", nicht im Fließtext. Vitest: „Status mit Datum in Ortszeit und Einsatz als Link, Bericht je Art", „verwaister Kopf (Einsatz fehlt): neutraler Ersatztext statt leerem Link" | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Genau eine blaue Primäraktion im Kopf und nur ohne Import: „genau eine Primäraktion „Importieren" im Kopf, keine Aktion im Inhalt". Rot nur an den beiden löschenden Knöpfen und an den Bestätigungen, dazu am Fehler-Alert (Gefahr bzw. gescheitert). Keine Farbliterale (Grep 0), alle Werte aus Rollen und antd-Token | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Der Stand ist das erste Feld des ersten Paneels direkt unter dem Seitenkopf. Ein Fehler erscheint als Alert über dem Paneel, im Browser bei y = 171,5 px (1366 × 768), und bleibt stehen, bis der nächste Vorgang ihn räumt (Stufe 4: 12 s beobachtet); Vitest „409: der Stand wird neu geladen, der Alert bleibt stehen", „der Alert geht beim nächsten Vorgang weg" | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Die Sektion erzeugt keine Alarme. Toasts erscheinen nur als Quittung einer eigenen Handlung („Demo-Daten importiert" usw.), ein Fehler geht nie in den Toast (Browser: 0 Toasts beim 409). Es gibt kein Live-Ereignis für den Status (Nachzug aus Task 7.3) | — |
| 11 | **Warnverhalten** — kein Blinken, jede Warnung quittierbar, jeder Ton mit visueller Entsprechung | **erfüllt [abgeleitet]** | Kein Blinken und kein Ton (Grep `animation`/`blink`/`keyframes`/`transition` 0 außerhalb eines Kommentars); die Drehung im Ladeknopf ist antds Ladesymbol, kein blinkender Text. Der Fehler-Alert ist Zustand der Seite und geht mit dem nächsten Vorgang | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | CLS beim Laden 0 (drei Läufe). Die Seite zeigt keinen Strom neuer Datensätze. Layoutwechsel (Knopf im Kopf entfällt, Stand und Bericht wachsen) folgen nur einer eigenen Handlung. Nach einem 409 lädt der Stand neu und die Aktionen wechseln; auch das folgt auf den eigenen Klick. Den Stand eines anderen Admins holt die Seite nur beim nächsten Abruf (Fensterfokus, react-query-Vorgabe), nicht unter der Hand [abgeleitet] | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | `pruefeFokusVerdeckung` in `handschuh` bei 1366 und 390 px: 0 verdeckte Ziele bei 52 bzw. 63 Stopps, alle markierten Ziele erreicht, ein fixierter Knoten (Kopfleiste) vorhanden, die Aussage ist also nicht trivial. Die Seite selbst trägt nichts Fixiertes (Grep 0) | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Menge, kein Vergleich: Stand und Bericht sind je ein `Datenraster` (Detail-Optik, `<dl>`) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Eingabe: drei Aktionsknöpfe ohne Felder | — |

**Bilanz:** 10 erfüllt (davon 1 [abgeleitet]) · 2 offen (Nr. 5, 8) · 3 nicht anwendbar.

## Tabelle 2 — Rückfragen „neu importieren" und „entfernen"

Nur die Zeilen, die sich von Tabelle 1 unterscheiden. Nr. 3, 6, 7, 8, 10 und 11 gelten wie dort.

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt** | „Ersetzen", „Endgültig entfernen", „Abbrechen" und Schließkreuz je 30 / 48 / 72 px, Breite ≥ 30 px. Nicht zeitkritisch; der Boden 24 × 24 hält ohne Abstandsregel | — |
| 2 | Handschuh-Modus | **offen** | Höhe 72 px an allen vier Zielen. **Die Fuge zwischen „Abbrechen" und der roten Bestätigung misst 3 / 5 / 7 px** (antds eigener Modal-Fuß) statt ≥ 16 in `handschuh`; damit steht Rot auch in `kompakt` nahezu bündig neben Neutralem (Regel aus LFH-363, die `aktionsabstand.guard.test.ts` nur an `Space`-Reihen sieht). Dieselbe Fuge 3 / 5 / 7 hat LFH-653 an der Erfassungs-Hülle gemessen; hier trifft sie jeden antd-`Modal`-Fuß der Anwendung | LFH-653 |
| 4 | Zweite Handlung | **erfüllt** | Der Dialog IST die zweite Handlung; Abbrechen, Schließkreuz und Escape senden nichts (Browser: 0 schreibende Anfragen nach Abbrechen), der OK-Knopf ist rot (`okButtonProps={{ danger: true }}`) und anders benannt als der Auslöser. Der Dialog schließt beim Bestätigen sofort, ein Fehler steht dann an der Seite statt hinter der Maske (LFH-535): „422 beim Neu-Import: Alert an der Seite, der Dialog ist zu" | — |
| 5 | Kontrast | **offen** | Titel und Text ≥ 7 (Tag) bzw. ≥ 5 (Nacht). „Endgültig entfernen" (antds Fehlerrot als Schrift) Tag 6,78, Nacht 7,18; Fokusring wie Tabelle 1 | LFH-652, LFH-NEU-fokusring-kontrast |
| 9 | Blickfeld | **nicht anwendbar** | Dialog ohne kritische Anzeige; der Text nennt Folgen und Unumkehrbarkeit | — |
| 12 | Kein Sprung | **nicht anwendbar** | Dialog ohne Live-Inhalt | — |
| 13 | Fokus nie verdeckt | **erfüllt** | Fünf Stopps im offenen Dialog bei 1366 und 390 px (`handschuh`), beide Knöpfe erreicht, 0 verdeckt, zwei fixierte Knoten vorhanden. Escape schließt, der Fokus kehrt auf „Entfernen" zurück | — |
| 14 | Tabellenseite | **nicht anwendbar** | Keine Menge | — |
| 15 | Erfassungsmaske | **nicht anwendbar** | Keine Eingabe, reine Bestätigung | — |

**Bilanz** über alle 15 Zeilen, die aus Tabelle 1 übernommenen mitgezählt: 7 erfüllt (Nr. 1, 3, 4, 6, 7, 11, 13; davon 1 [abgeleitet]) · 3 offen (Nr. 2, 5, 8) · 5 nicht anwendbar (Nr. 9, 10, 12, 14, 15).

## Tabelle 3 — Hinweis in der Einsatzliste

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt** | Hinweis-Link 30 / 48 / 72 px hoch, 77–86 px breit (1366 und 390). Er ist das einzige Ziel im Hinweis | — |
| 2 | Handschuh-Modus | **erfüllt** | 72 px in `handschuh`; zum nächsten Ziel (Kachelraster) liegen 44 px [abgeleitet aus den Kästen]. **Beobachtung:** die 72 px entstehen über `min-height` am `inline-flex`-Verweis ohne Polsterung und blähen die Textzeile auf (bei 390 px beginnt die Linkzeile 48 px statt 23 px unter der vorigen, `aus/hinweis-handschuh-390.png`); das Kriterium hält, der Satz liest sich zerrissen — mitbehandelt in LFH-NEU-hinweis-verweis | — |
| 3 | Rückmeldung | **nicht anwendbar** | Der Hinweis löst nichts aus, der Link navigiert nur (kein Direktimport aus der Liste, benannte Abweichung in `EinsaetzePage.tsx`) | — |
| 4 | Zweite Handlung | **nicht anwendbar** | Keine kritische Aktion an dieser Stelle | — |
| 5 | Kontrast | **offen** | Titel und Beschreibung ≥ 7 (Tag) / ≥ 5 (Nacht). **Der Link misst am Tag 6,04 : 1** auf der Info-Fläche (Nacht 8,99): `rollen.bedienText` ist gegen `paneel`/`grund` abgestimmt, nicht gegen `colorInfoBg`. Fokusring am Link 1,76 (Tag) / 1,45 (Nacht). Rand des Hinweises < 3 : 1, nicht tragend | LFH-NEU-hinweis-verweis, LFH-NEU-fokusring-kontrast |
| 6 | Kein Status allein über Farbe | **offen** | Der Verweis im Satz unterscheidet sich vom umgebenden Text **nur durch die Farbe**: 2,20 : 1 (Tag) bzw. 1,58 : 1 (Nacht) gegen den Fließtext, keine Unterstreichung, gleiches Gewicht. WCAG 1.4.1 (auf das sich das Kriterium stützt) verlangt dafür 3 : 1 gegen den Text plus einen Zweitkanal beim Fokus/Hover, oder einen Nicht-Farb-Kanal | LFH-NEU-hinweis-verweis |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Info-Blau für eine Bedienaufforderung ohne Gefahr (wie der Sammelbanner), kein Rot. Farben aus antds `info`-Preset und `rollen.bedienText` | — |
| 8 | Helligkeitsregler | **offen** | App-weite Lücke | LFH-397 |
| 9 | Blickfeld | **erfüllt** | Der Hinweis steht über dem Kachelraster direkt unter dem Seitenkopf; er ist keine kritische Anzeige | — |
| 10 | Alarmbudget | **nicht anwendbar** | Der Hinweis ist ein ruhender Zustand, keine Meldung; er erscheint nur für den System-Admin bei Freischaltung ohne Import: „System-Admin + 200 + nicht importiert: Hinweis mit Link auf /admin/demo-daten", „404: kein Hinweis und keine Fehlermeldung", „importiert: kein Hinweis", „andere Rolle: kein Hinweis und keine Anfrage an /api/demo-daten" | — |
| 11 | Warnverhalten | **erfüllt [abgeleitet]** | Kein Blinken, keine Animation, kein Ton (Grep über den Hinweisblock 0) | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen** | **Der Hinweis erscheint nach dem Kachelraster und schiebt es um seine Höhe nach unten.** CLS beim Laden 1366: 0,041 / 0,056 / 0,086 · 1024: 0,054 / 0,074 / **0,120** · 390: **0,174 / 0,212 / 0,214** (kompakt / komfortabel / handschuh); ohne Hinweis 0. Bei 1366 in `handschuh` liegt der Wert nur mit einer Kachelreihe unter 0,1; füllt das Raster den Schirm, steigt er auf rund 0,108 [abgeleitet: Einflussfläche 607 × 1318 / (1366 × 768) × Verschiebung 193 / 1366]. Wer nach dem ersten Bild auf eine Kachel zielt, trifft 118–266 px darüber | LFH-NEU-hinweis-cls |
| 13 | Fokus nie verdeckt | **erfüllt** | 36 Stopps bei 1366 und 390 px in `handschuh`, Hinweis-Link erreicht, 0 verdeckt, ein fixierter Knoten vorhanden | — |
| 14 | Tabellenseite | **nicht anwendbar** | Kachel-Überblick, vom Hinweis nicht berührt | — |
| 15 | Erfassungsmaske | **nicht anwendbar** | Der Hinweis ändert den Anlegedialog nicht; der Leerzustand bleibt aktionslos: „der Hinweis steht NEBEN dem Leerzustand, nicht in ihm (LFH-331 · AK3)" | — |

**Bilanz:** 6 erfüllt (davon 1 [abgeleitet]) · 4 offen (Nr. 5, 6, 8, 12) · 5 nicht anwendbar.

## Offene Punkte

| Zeile | Befund | Zielticket |
| --- | --- | --- |
| T3-12 | Hinweis erscheint nach dem Raster, CLS 0,12 (Tablet, `handschuh`) und 0,17–0,21 (mobil) | LFH-NEU-hinweis-cls |
| T3-5, T3-6, T3-2 (Beobachtung) | Hinweis-Link: 6,04 : 1 am Tag auf der Info-Fläche, nur Farbe trennt ihn vom Text (2,20 / 1,58), `min-height` ohne Polsterung bläht die Textzeile | LFH-NEU-hinweis-verweis |
| T1-5, T2-5, T3-5 | Fokusring antds (`colorPrimaryBorder`) 1,45–2,46 : 1 gegen den Grund, app-weit | LFH-NEU-fokusring-kontrast |
| T1-5, T2-5 | geerbte Textrollen am Tag: `schwach` 5,33 / 5,84 | LFH-643 |
| T1-5, T2-5 | geerbte Textrollen am Tag: `colorTextSecondary` 6,37, weiß auf `bedien` 6,59, `colorError` als Knopfschrift 6,78 (Hover 5,12) | LFH-652 |
| T2-2 | Fuge im antd-Modal-Fuß 3 / 5 / 7 px, Rot fast bündig neben „Abbrechen" | LFH-653 |
| T1-8, T3-8 | kein Helligkeitsregler | LFH-397 |
