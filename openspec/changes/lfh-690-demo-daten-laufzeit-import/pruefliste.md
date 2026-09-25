# Prüfliste Einsatztauglichkeit — Demo-Daten zur Laufzeit (LFH-690)

Gate 7 der Bedien-Leitlinie (`docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`,
Festlegung 7) verlangt diese Liste an jeder neuen Seite. Planung und Spec liegen in diesem
Verzeichnis (`design.md` D13, `specs/demo-daten/spec.md`), Task 7.1 in `tasks.md`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/admin/demo-daten` (`frontend/src/admin/DemoDatenPage.tsx`, Menüeintrag in `admin/AdminLayout.tsx`) und der Hinweis in `/einsaetze` (`frontend/src/pages/EinsaetzePage.tsx`, `demoHinweis`) |
| Stand | **Zwei Messstände.** Tabelle 1 und 2 sind am Code-Stand `b13c555b` gemessen (Arbeitsbaum sauber, Backend ein Debug-Build aus dem Scratchpad-Target, Commit am Binary nicht ablesbar). **Tabelle 3 ist nach der Fix-Welle am Code-Stand `e2c17ac7` neu gemessen** (Stufe 5/5b): Vite (Port 15690) aus diesem Worktree, Backend (Port 18690, `--demo-daten`, Feature `dev-seeds`) um 11:36 aus demselben Stand neu gebaut, **auf einer neuen Datenbank**. Die alte `pruef.db` trug `0121_demo_daten`; nach der Umnummerierung auf `0123` bricht der Start mit „migration 121 was previously applied but has been modified“ (gemessen). Sie liegt unter `/private/tmp/claude-501/-Users-rubeen-dev-personal-lifeline-hub--claude-worktrees-lfh-358-b548bd/3ab845e7-a246-4402-a9d7-2046a4db40ee/scratchpad/pruef-db-vor-merge/`. Die Nachmessung betrifft nur Fläche 3; Tabelle 1 und 2 sind vom Fix-Code nicht berührt, bis auf die Invalidierung nach jedem Fehler (Vitest, siehe Nachweise) |
| Zielkontext | Fükw (1366 px, Tastatur + Maus) und ortsfeste Stelle. Die Sektion ist Verwaltung: Demo-Daten werden vor einer Vorführung oder Schulung eingespielt und danach entfernt, nie unter Einsatzdruck. Führungs-Tablet (1024 px) und mobil (390 px) sind mitgemessen, weil die Verwaltung dort erreichbar ist; die Handschuhstufe ist gemessen, auch wenn sie hier selten gebraucht wird |
| Nicht enthalten | Demo-Marke an Stammdaten in Katalogen, org-weites Live-Ereignis für Einsatzliste und Stammdaten, Endlos-Reconnect des Live-Hooks bei 404 (Nachzüge aus Task 7.3) |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Verwaltungssektion „Demo-Daten"** in den Zuständen *nicht importiert* (ohne und mit Bericht), *importiert mit Bericht* und *Fehler (409)*, dazu der Menüeintrag | `admin/DemoDatenPage.tsx`, `admin/useDemoDaten.ts`, `admin/AdminLayout.tsx` | ja: Gate 1, Gate 3, Kontrast, Fokus, CLS, Klickweg |
| **2 · Rückfragen** „Demo-Daten neu importieren?" und „Demo-Daten entfernen?" | `Modal` in `admin/DemoDatenPage.tsx` | ja: Gate 3, Kontrast, Fokus |
| **3 · Hinweis in der Einsatzliste** | `pages/EinsaetzePage.tsx` (`demoHinweis`, unter dem Kachelraster, Verweis-Knopf „Zu den Demo-Daten“) | ja: Gate 1, Gate 3, Kontrast, Fokus, CLS — nachgemessen in Stufe 5 |

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
Entfernen, 409), 4 (409-Alert über 12 s), **5** (Nachmessung Fläche 3 nach der Fix-Welle: je
Breite × Dichte drei Kaltladungen und zwei Gegenproben mit erzwungener Reihenfolge, Überlauf,
Geometrie, Kontrast, Fokus, Klick) und **5b** (Hover-Vergleich mit anderen Standardknöpfen).
Die Nachweiszeilen vor „Vitest“ sind am Stand `b13c555b` gemessen. Werte zum Hinweis darin
(Hinweis-Link, Hinweis ↔ Raster, CLS) gelten **vor der Fix-Welle** und sind durch den Block
„Nachmessung Fläche 3“ darunter ersetzt; reine Hinweis-Zeilen tragen die Marke im Namen.

| Nachweis | Ergebnis |
| --- | --- |
| Gate 1, waagerechter Überlauf (`scrollWidth − clientWidth` der Wurzel) | **0 px in allen 33 Messungen**: `/einsaetze` mit Hinweis und `/admin/demo-daten` *nicht importiert ohne Bericht* je 1366 / 1024 / 390 px × drei Dichten (18); *importiert mit Bericht* 1366 / 1024 / 390 × drei Dichten (9); *nicht importiert mit Bericht* 1366 / 1024 / 390 × `kompakt`/`handschuh` (6) |
| Gate 3, Höhe (kompakt / komfortabel / handschuh; Sektion und Rückfragen bei 1366, 1024 und 390 px, Hinweis und Menü bei 1366 und 390 px, jeweils auf allen Breiten gleich) | „Importieren" **30 / 48 / 72** · „Neu importieren" **30 / 48 / 72** · „Entfernen" **30 / 48 / 72** · Einsatz-Link **30 / 48 / 72** (Breite 166–195 px) · Rückfrage „Ersetzen" / „Endgültig entfernen" / „Abbrechen" / Schließkreuz je **30 / 48 / 72** · Hinweis-Link **30 / 48 / 72** (Breite 77–86 px) · Menüeintrag „Demo-Daten" **37,5 / 60 / 90** · Expander „Verwaltung: …" unter `lg` **30 / 48 / 72** |
| Gate 3, Abstand | „Neu importieren" ↔ „Entfernen" **11 / 18 / 26 px** (auf allen drei Breiten). Einsatz-Link ↔ „Neu importieren" bei 390 px **19 / 30 / 43 px**. Hinweis ↔ Kachelraster 44 px in `handschuh` [abgeleitet aus den Kästen: Alert 161 + 148,6 → Raster 353,6]. **Rückfrage „Abbrechen" ↔ rote Bestätigung 3 / 5 / 7 px** |
| Hinweis-Link im Fließtext **(vor der Fix-Welle)** | `verweisStil` setzt `display: inline-flex; min-height: controlHeight` ohne Polsterung (`padding 0`). Die Zeile, in der der Link steht, wächst dadurch auf die Staffel: bei 390 px in `handschuh` liegen die Textzeilen 23 px auseinander, die Linkzeile beginnt 48 px unter der vorigen, die Beschreibung ist 118 px hoch statt rund 69 [abgeleitet: 3 × 23]. Bildschirmfoto `aus/hinweis-handschuh-390.png` zeigt die Lücke vor „Verwaltung anlegen: Demo-Daten" |
| Kontrast Text (Durchlauf über jedes sichtbare Element mit eigenem Textknoten, gesperrte Knöpfe ausgenommen, 0 nicht messbare) | **Nacht:** alle Texte ≥ 5 : 1, Minimum 5,03 (Feldbeschriftung „Status") auf der Sektion, 7,18 im Dialog, 8,99 am Hinweis-Link, Fehler-Alert 13,81. **Tag, unter 7 : 1:** Seitenbeschreibung 5,33 · Paneelkopf „Stand"/„Letzter Vorgang" und Meta „Import · …" 5,84 · Feldbeschriftungen (Augenbraue) 6,37 · „Importieren" (weiß auf `bedien`) 6,59 · „Neu importieren"/„Entfernen"/„Endgültig entfernen" (antds Fehlerrot als Schrift) 6,78, im Hover 5,12 · **Hinweis-Link 6,04** auf der Info-Fläche. Alle übrigen Tagtexte ≥ 7, darunter Einsatz-Link, Statuswert, Datum, Berichtszeilen, Titel und Beschreibung des Hinweises, Fehler-Alert 14,95. Nie unter 4,5 : 1 |
| Kontrast Ränder und Zustände | Rand der roten Knöpfe gegen Fläche/Umgebung Tag 6,78 / 6,21, Nacht 6,77 / 7,06. Rand des Info-Hinweises 1,76 / 2,06 (Tag), 1,45 / 1,70 (Nacht), nicht tragend: der Hinweis ist über Fläche, Symbol und Titel erkennbar. **Fokusring** (antd, `outline 3px` in `colorPrimaryBorder`, per Tastatur als `:focus-visible` bestätigt) gegen den Grund: Knöpfe Tag 2,06–2,25 / Nacht 1,67–1,70, Einsatz-Link 2,46 / 1,61, Hinweis-Link 1,76 / 1,45. Bildschirmfotos `aus/fokusring-*.png` |
| Link gegen umgebenden Text (WCAG 1.4.1) **(vor der Fix-Welle)** | Hinweis-Link `rgb(22,79,134)` gegen Fließtext `rgb(17,20,24)`: **2,20 : 1** (Tag), **1,58 : 1** (Nacht), `text-decoration: none`, gleiches Schriftgewicht 400 |
| Fokus nie verdeckt (`pruefeFokusVerdeckung`, `handschuh`) | **0 verdeckte Ziele** in allen Läufen. Sektion *nicht importiert* 52 Stopps (1366 und 390), *importiert* 63 Stopps; markierte Ziele „Importieren" bzw. Einsatz-Link, „Neu importieren", „Entfernen" alle erreicht; fixierte Knoten 1 (Kopfleiste). Einsatzliste 36 Stopps, Hinweis-Link erreicht. Rückfrage: 5 Stopps, „Abbrechen" und „Endgültig entfernen" erreicht, fixierte Knoten 2 (Maske, Dialog). Escape schließt den Dialog, der Fokus steht danach wieder auf „Entfernen" |
| CLS `/admin/demo-daten` | **0** beim Laden (3 Läufe, Skelett → Inhalt) |
| **CLS `/einsaetze` mit Hinweis (vor der Fix-Welle)** (Layout-Shift-Beobachter aus `betroffene-layout.spec.ts`, je 3–5 Kaltladungen, Werte in allen Läufen gleich) | 1366 px: **0,041 / 0,056 / 0,086** · 1024 px: **0,054 / 0,074 / 0,120** · 390 px: **0,174 / 0,212 / 0,214** (kompakt / komfortabel / handschuh). Einzige Quelle: das Kachelraster rutscht um die Hinweishöhe nach unten (1366 kompakt y 115 → 233). **Gegenprobe:** mit abgefangenem Status 404 (kein Hinweis) **0** in allen Stufen; mit 1 s verzögertem Status dieselben Werte (0,041 / 0,061 / 0,099 bei 1366) — der Hinweis erscheint also regelmäßig nach dem Raster |
| Klickweg im Browser (1366, kompakt, Tag) | Importieren → Ladezustand am Knopf nach **15,2 ms**, POST 201 nach 81 ms, Status „Importiert", Bericht „Import · …", Einsatz-Link. Neu importieren → Dialog nach **11,6 ms**; Abbrechen: **0** schreibende Anfragen. Neu importieren → Ersetzen → Ladezustand nach **8,3 ms**, POST `/neu` 200 nach 106 ms, Einsatz 5 → 6, neues Datum, Toast. Entfernen → Endgültig entfernen → Ladezustand nach **5,8 ms**, DELETE 200 nach 38 ms, „Nicht importiert", Kopf trägt wieder „Importieren", Bericht „8 / 12 / 4 entfernt · 0 behalten". `/einsaetze`: Hinweis wieder sichtbar, kein Link auf die Demo-Einsätze 5 oder 6 |
| 409 im Browser (fremder Import und fremdes Entfernen per API, dann Klick) | DELETE 409; roter Alert „Entfernen fehlgeschlagen" mit Servertext „Für diese Organisation sind keine Demo-Daten importiert." bei y = 171,5 px unter der Seitenbeschreibung, **0** Toasts, Status neu geladen („Nicht importiert", „Importieren" im Kopf). Der Alert steht in Stufe 4 über 12 s in jeder Halbsekunde und nach einem Vollbild-Foto noch da; der nächste Import per Klick räumt ihn (0 Alerts) |
| Grep `admin/DemoDatenPage.tsx`, `admin/useDemoDaten.ts` | Farbliterale **0** · `animation`/`blink`/`keyframes`/`transition` **0** (ein Treffer im Kommentar) · `sticky`/`fixed` **0** · `danger` **3** (zwei Knöpfe, `okButtonProps`) · `size=` **1** (`Space size="middle"`, Abstandsmaß) [abgeleitet] |
| Vitest | `admin/DemoDatenPage.test.tsx` (26 Fälle, u. a. unten zitiert; neu seit der Fix-Welle „Netzfehler beim Import, der Server hat doch committet: die Seite zeigt den neuen Stand“, „500 beim Entfernen: Stand neu geladen, Abfragen des alten Demo-Einsatzes invalidiert“, „Netzfehler: Fehlerbild mit „Erneut abrufen“, keine Aktion, keine Umleitung, kein Menüeintrag“), `pages/EinsaetzePage.test.tsx` (zehn Fälle zum Hinweis; neu „der Verweis steht als eigenes Bedienziel außerhalb des Satzes, ohne punktuelle Größe“, „ein Klick auf den Verweis navigiert in der App, ohne Seitenwechsel des Browsers“, „der Hinweis steht unter dem Raster und unter den abgeschlossenen Einsätzen“, „der Hinweis wartet auf die Einsatzliste, auch wenn der Status zuerst da ist“), `admin/adminNav.test.tsx` |
| **Nachmessung Fläche 3 (Stufe 5, `e2c17ac7`)** | |
| Gate 1, Hinweis | **0 px in allen 9 Messungen** (1366 / 1024 / 390 × drei Dichten) |
| CLS `/einsaetze` mit Hinweis | **0 in allen 63 Ladungen**: je Breite (1366 / 1024 / 390) × Dichte drei Kaltladungen, dazu je zwei mit **1 s verzögertem Status** (Hinweis sicher nach dem Raster) und je zwei mit **1 s verzögerter Einsatzliste** (Status sicher zuerst). Kein einziger Layout-Shift-Eintrag. Vorher 0,041 – 0,214 |
| Gate 3, Verweis-Knopf | „Zu den Demo-Daten“ **30 / 48 / 72 px** hoch auf allen drei Breiten, 154 / 167 / 167 px breit, Polsterung waagerecht 15 px (antds `Button`, Höhe aus `controlHeight`, kein `size`). Einziges Ziel im Hinweis. Abstand zum nächsten Ziel darüber ≥ 94 px [abgeleitet: Knopf-y 637,4 − Hinweis-y 542,8 bei 1366 `handschuh`, alles dazwischen gehört zum Hinweis], darunter steht keines |
| Satz des Hinweises | Die Zeilen des Satzes stehen im Takt der Zeilenhöhe: bei 390 px drei Zeilen, Satz **65 / 69 / 69 px** hoch (kompakt / komfortabel / handschuh), vorher 118 in `handschuh`. Bildschirmfotos `aus/s5-hinweis-*.png` |
| Kontrast Hinweis (Durchlauf, 0 nicht messbar) | **Tag:** Titel und Satz 13,26, Knopfbeschriftung **18,47** (`colorText` auf der Knopffläche). **Nacht:** 14,18 bzw. **15,70**. Im **Hover** 5,62 (Tag) / 8,49 (Nacht) — Stufe 5b: derselbe Wert an „Neuer Einsatz“ auf derselben Seite und an „Abbrechen“ im Anlegedialog, also antds `colorPrimaryHover` als Schrift jedes Standardknopfs, app-weit |
| Kontrast Knopfrand (`randKontrast`, oben, 1 px `colorBorder`) | **Tag:** gegen die eigene Fläche 3,95, **gegen die Info-Fläche 2,84**. **Nacht:** 3,43 bzw. 3,09. Im Hover (Rand in Bedienblau) Tag 5,62 / 4,04, Nacht 8,49 / 7,66 |
| Fokusring Knopf | Per Tastatur erreicht, `:focus-visible` bestätigt, Umriss `solid 1px` in antds `colorPrimaryBorder` (Tag `rgb(127,171,199)`, Nacht `rgb(37,58,78)`), gegen den Grund **1,76 / 1,45**. Über `focus()` ohne Tastatur zeichnet antd keinen Umriss (0 px). Bildschirmfotos `aus/s5-fokus-*.png` |
| Fokus nie verdeckt, Hinweis | `handschuh`, 1366 und 390 px: je 36 Stopps, Knopf erreicht, **0 verdeckt**, ein fixierter Knoten vorhanden |
| Klick auf den Verweis | Navigiert auf `/admin/demo-daten`, ein Marker am `window` überlebt den Sprung: **kein Neuladen** der Seite (`useLinkClickHandler`) |
| Blickfeld | Der Hinweis steht unter dem Raster. Oberkante bei 1366 × 768: 392 / 429 / 543 px, im Bild. Bei 390 × 844: **654 / 691 / 911 px**, in `komfortabel` und `handschuh` also ganz oder teilweise unter dem Rand (erreichbar per Scrollen) |

---

## Tabelle 1 — Verwaltungssektion „Demo-Daten"

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** ≥ 24 × 24 px; zeitkritische Aktion ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Gate 3: „Importieren", „Neu importieren", „Entfernen" und Einsatz-Link 30 / 48 / 72 px, der Menüeintrag 37,5 / 60 / 90, der Expander 30 / 48 / 72; die schmalste Breite ist 91 px. Zeitkritisch ist hier nichts (Verwaltung); der Abstand der beiden roten Knöpfe liegt trotzdem in `komfortabel` bei 18 px. Der Einsatz-Link trägt `verweisStil` (Boden `controlHeight`) ohne Polsterung, wie die Verweise der ETB-Zeitachse; die zweite Angabe der Bedien-Leitlinie für handgebaute Ziele fehlt, die gemessene Fläche hält die Staffel trotzdem | — |
| 2 | **Handschuh-Modus** — Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt** | Gate 3 `handschuh`: 72 px an allen Zielen der Seite, Menüeintrag 90. Abstand „Neu importieren" ↔ „Entfernen" 26 px (`Space size="middle"`), Einsatz-Link ↔ „Neu importieren" bei 390 px 43 px. Die Rückfrage ist Fläche 2 | — |
| 3 | **Rückmeldung vor der Serverantwort** ≤ 100 ms; Kommandoreaktion ≤ 2 s | **erfüllt** | Browser: Ladezustand am auslösenden Knopf nach 15,2 / 8,3 / 5,8 ms (Import / Neu / Entfernen), Serverantwort nach 81 / 106 / 38 ms (Debug-Build, lokal); `design.md` (c) misst 40–61 ms über HTTP. Kein Vorgang nähert sich 2 s, eine Fortschrittsanzeige (> 15 s) ist nicht nötig. Gesperrt wird sichtbar: `DemoDatenPage.test.tsx` „während DELETE läuft, sind „Neu importieren" und „Entfernen" gesperrt", „zwei Klicks im selben Takt senden genau einen POST". Erfolg per Toast, Fehler an der Seite: „409 beim Import: Alert an der Seite mit Servertext, nicht in der Message-Queue", „nennt unter „Import fehlgeschlagen" die Erreichbarkeit, nicht „Speichern fehlgeschlagen"" | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | „Neu importieren" und „Entfernen" löschen den Demo-Einsatz samt Änderungen seit dem Import (unumkehrbar) und stehen hinter einer Rückfrage mit rotem Bestätigungsknopf. Im Browser: Abbrechen sendet 0 schreibende Anfragen, erst „Ersetzen" bzw. „Endgültig entfernen" sendet. Vitest: „Entfernen: Rückfrage mit danger-Knopf, DELETE erst nach Bestätigung", „Entfernen abbrechen sendet nichts", „Neu importieren: Rückfrage mit danger-Knopf, POST /neu erst nach Bestätigung". „Importieren" legt nur an und ist über „Entfernen" rückholbar; eine Rückfrage dort wäre Reibung ohne Schutz (LFH-363) | — |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1; Zustände, Rahmen, Fokusring ≥ 3 : 1 | **offen** | **Nacht erfüllt** (Minimum 5,03). **Tag unter 7 : 1, alles geerbte Rollen:** Seitenbeschreibung (`schwach` auf `grund`) 5,33 und Paneelkopf/Meta (`schwach` auf `paneel`) 5,84 → LFH-643; Feldbeschriftungen (`colorTextSecondary`) 6,37, „Importieren" (weiß auf `bedien`) 6,59 und die roten Knöpfe (antds `colorError` als Schrift) 6,78, im Hover 5,12 → LFH-652. Nie unter 4,5. Ränder der roten Knöpfe ≥ 6,2. **Fokusring unter 3 : 1:** antds Umriss in `colorPrimaryBorder` misst an den Knöpfen 2,06–2,25 (Tag) / 1,67–1,70 (Nacht), am Einsatz-Link 2,46 / 1,61 — app-weit, kein Modulwert | LFH-643, LFH-652, LFH-737 |
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
| 5 | Kontrast | **offen** | Titel und Text ≥ 7 (Tag) bzw. ≥ 5 (Nacht). „Endgültig entfernen" (antds Fehlerrot als Schrift) Tag 6,78, Nacht 7,18; Fokusring wie Tabelle 1 | LFH-652, LFH-737 |
| 9 | Blickfeld | **nicht anwendbar** | Dialog ohne kritische Anzeige; der Text nennt Folgen und Unumkehrbarkeit | — |
| 12 | Kein Sprung | **nicht anwendbar** | Dialog ohne Live-Inhalt | — |
| 13 | Fokus nie verdeckt | **erfüllt** | Fünf Stopps im offenen Dialog bei 1366 und 390 px (`handschuh`), beide Knöpfe erreicht, 0 verdeckt, zwei fixierte Knoten vorhanden. Escape schließt, der Fokus kehrt auf „Entfernen" zurück | — |
| 14 | Tabellenseite | **nicht anwendbar** | Keine Menge | — |
| 15 | Erfassungsmaske | **nicht anwendbar** | Keine Eingabe, reine Bestätigung | — |

**Bilanz** über alle 15 Zeilen, die aus Tabelle 1 übernommenen mitgezählt: 7 erfüllt (Nr. 1, 3, 4, 6, 7, 11, 13; davon 1 [abgeleitet]) · 3 offen (Nr. 2, 5, 8) · 5 nicht anwendbar (Nr. 9, 10, 12, 14, 15).

## Tabelle 3 — Hinweis in der Einsatzliste

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt** | Stufe 5: der Verweis-Knopf „Zu den Demo-Daten“ misst 30 / 48 / 72 px, 154–167 px breit, auf 1366, 1024 und 390 px. Er ist das einzige Ziel im Hinweis | — |
| 2 | Handschuh-Modus | **erfüllt** | Stufe 5: 72 px in `handschuh`. Zum nächsten Ziel darüber liegen ≥ 94 px [abgeleitet aus den Kästen: Knopf-y 637,4 − Hinweis-y 542,8], darunter steht keines. Die Höhe gehört jetzt dem Knopf, nicht der Textzeile: der Satz steht bei 390 px in drei Zeilen zu 23 px (69 px statt vorher 118), Bildschirmfoto `aus/s5-hinweis-handschuh-390.png` | — |
| 3 | Rückmeldung | **nicht anwendbar** | Der Hinweis löst nichts aus, der Verweis navigiert nur (kein Direktimport aus der Liste, benannte Abweichung in `EinsaetzePage.tsx`), und zwar ohne Neuladen (Stufe 5) | — |
| 4 | Zweite Handlung | **nicht anwendbar** | Keine kritische Aktion an dieser Stelle | — |
| 5 | Kontrast | **offen** | Stufe 5. **Text erfüllt:** Titel und Satz 13,26 (Tag) / 14,18 (Nacht), die Knopfbeschriftung **18,47 / 15,70** (vorher der Link 6,04 am Tag). **Offen, alles am Knopf:** (a) der **Fokusring** (`:focus-visible`, 1 px `colorPrimaryBorder`) 1,76 / 1,45 gegen den Grund, app-weit; (b) die Beschriftung im **Hover** 5,62 am Tag (Nacht 8,49), gemessen gleich an „Neuer Einsatz“ und am „Abbrechen“ des Anlegedialogs (Stufe 5b), also antds `colorPrimaryHover` als Schrift jedes Standardknopfs, app-weit; (c) der **Knopfrand** (`colorBorder`) hält gegen die eigene Fläche 3,95 (Tag) / 3,43 (Nacht), **gegen die Info-Fläche am Tag nur 2,84** (Nacht 3,09). `steuerRahmen` ist gegen die üblichen Gründe abgestimmt, nicht gegen `colorInfoBg`; das ist ein Wert dieser Stelle, kein geerbter. Rand des Hinweises selbst < 3 : 1, nicht tragend (kein Bedienziel) | LFH-737 (a), LFH-652 (b, zu erweitern um den Hover des Standardknopfs), LFH-NEU-hinweis-verweis (c) |
| 6 | Kein Status allein über Farbe | **erfüllt** | Stufe 5: der Verweis steht nicht mehr im Satz, sondern in eigener Zeile darunter, als Knopf mit eigener Fläche und Rand; vom Text trennt ihn die Form, nicht die Farbe. Vitest „der Verweis steht als eigenes Bedienziel außerhalb des Satzes, ohne punktuelle Größe“. Vorher unterschied ihn nur die Farbe vom Fließtext (2,20 / 1,58 : 1) | — |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Info-Blau für eine Bedienaufforderung ohne Gefahr (wie der Sammelbanner), kein Rot. Der Knopf ist ein antd-Standardknopf (`colorText` auf `colorBgContainer`, Rand `colorBorder`), keine zweite Primäraktion; der Seitenkopf der Einsatzliste trägt keine | — |
| 8 | Helligkeitsregler | **offen** | App-weite Lücke | LFH-397 |
| 9 | Blickfeld | **nicht anwendbar** | Der Hinweis ist keine kritische Anzeige, sondern eine Aufforderung ohne Eile. Er steht seit der Fix-Welle unter dem Raster (Kriterium 12). Oberkante bei 1366 × 768: 392 / 429 / 543 px, im Bild; bei 390 × 844: 654 / 691 / 911 px, in `komfortabel` und `handschuh` also ganz oder teilweise unter dem Rand, per Scrollen erreichbar | — |
| 10 | Alarmbudget | **nicht anwendbar** | Der Hinweis ist ein ruhender Zustand, keine Meldung; er erscheint nur für den System-Admin bei Freischaltung ohne Import: „System-Admin + 200 + nicht importiert: Hinweis mit Link auf /admin/demo-daten", „404: kein Hinweis und keine Fehlermeldung", „importiert: kein Hinweis", „andere Rolle: kein Hinweis und keine Anfrage an /api/demo-daten" | — |
| 11 | Warnverhalten | **erfüllt [abgeleitet]** | Kein Blinken, keine Animation, kein Ton (Grep über den Hinweisblock 0) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Stufe 5: **CLS 0 in allen 63 Ladungen**, 1366 / 1024 / 390 px × drei Dichten, je drei Kaltladungen und je zwei Gegenproben mit 1 s verzögertem Status und mit 1 s verzögerter Einsatzliste. Der Hinweis steht unter allem, was die Liste zeichnet, und erscheint erst, wenn die Liste steht. Vitest „der Hinweis steht unter dem Raster und unter den abgeschlossenen Einsätzen“, „der Hinweis wartet auf die Einsatzliste, auch wenn der Status zuerst da ist“. Vorher 0,041–0,214 | — |
| 13 | Fokus nie verdeckt | **erfüllt** | Stufe 5: 36 Stopps bei 1366 und 390 px in `handschuh`, Verweis-Knopf erreicht, 0 verdeckt, ein fixierter Knoten vorhanden | — |
| 14 | Tabellenseite | **nicht anwendbar** | Kachel-Überblick, vom Hinweis nicht berührt | — |
| 15 | Erfassungsmaske | **nicht anwendbar** | Der Hinweis ändert den Anlegedialog nicht; der Leerzustand bleibt aktionslos: „der Hinweis steht NEBEN dem Leerzustand, nicht in ihm (LFH-331 · AK3)" | — |

**Bilanz:** 7 erfüllt (davon 1 [abgeleitet]) · 2 offen (Nr. 5, 8) · 6 nicht anwendbar.

## Offene Punkte

| Zeile | Befund | Zielticket |
| --- | --- | --- |
| T3-5 | Rand des Verweis-Knopfs (`colorBorder`) gegen die Info-Fläche am Tag 2,84 : 1 (gegen die eigene Fläche 3,95; Nacht 3,09 / 3,43). Kontrast, Farbkanal und Zeilenhöhe aus dem ursprünglichen Befund sind behoben (Stufe 5) | LFH-NEU-hinweis-verweis |
| T1-5, T2-5, T3-5 | Fokusring antds (`colorPrimaryBorder`) 1,45–2,46 : 1 gegen den Grund, app-weit; am Verweis-Knopf 1,76 / 1,45 | LFH-737 |
| T1-5, T2-5 | geerbte Textrollen am Tag: `schwach` 5,33 / 5,84 | LFH-643 |
| T1-5, T2-5, T3-5 | geerbte Textrollen am Tag: `colorTextSecondary` 6,37, weiß auf `bedien` 6,59, `colorError` als Knopfschrift 6,78 (Hover 5,12), `colorPrimaryHover` als Schrift des Standardknopfs im Hover 5,62 | LFH-652 |
| T2-2 | Fuge im antd-Modal-Fuß 3 / 5 / 7 px, Rot fast bündig neben „Abbrechen" | LFH-653 |
| T1-8, T3-8 | kein Helligkeitsregler | LFH-397 |
