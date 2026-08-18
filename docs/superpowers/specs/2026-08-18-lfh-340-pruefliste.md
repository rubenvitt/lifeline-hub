# LFH-340 · Prüfliste Einsatztauglichkeit

Angelegt an die fünf Flächen, die LFH-340 (C5) umgebaut oder neu angelegt hat:

| Kürzel | Fläche | Was C5 daran getan hat |
|---|---|---|
| **F1** | `pages/PersonenPage.tsx` | Kopf auf `EinsatzSeite`, Liste auf `Datensicht` |
| **F2** | `pages/TierePage.tsx` | Kopf auf `EinsatzSeite` |
| **F3** | `pages/SchaedenPage.tsx` | Ausreißerseite abgetragen: Kopf, `Datensicht`, „seit"-Spalte, Sortierung, Suche, Spaltenfilter Typ/Ausmaß, Verortet-Spalte |
| **F4** | `pages/personen/AufnahmePage.tsx` | **neu** — zweiter Mount von `personen/AufnahmeFelder.tsx` auf eigener Route |
| **F5** | `pages/PersonenDetailPage.tsx` | eine Primäraktion im Kopf, Rest gebündelt, Ladehoheit (2 statt 6 Startabfragen) |

Kriterien wörtlich aus `docs/superpowers/specs/2026-07-25-bedien-leitlinie-einsatzkontexte.md`
(Festlegung 7). Form nach dem Präzedenzfall
`docs/superpowers/specs/2026-08-17-lfh-339-pruefliste-einsatztauglichkeit.md` —
**15 Zeilen, nicht fünf Spalten**: Gate 7 verlangt die Tabelle mit 15 Zeilen und je einem
Verdikt; die Fläche wird in der Begründung benannt, wo sie sich unterscheidet.

„Nicht geprüft" ist kein Verdikt (CLAUDE.md). Jede Zeile trägt `erfüllt` / `offen →
Zielticket` / `nicht anwendbar`, je mit Beleg oder Begründung.

**Zählregel:** eine geteilte Zeile („erfüllt für X, offen für Y") zählt als **offen**.
Sonst ist die Bilanz unter der Tabelle nicht lesbar.

**Keine Suite wurde für diese Liste gefahren.** Belegt wird über Datei:Zeile und Testnamen;
„Suite grün" steht hier nirgends, weil es in dieser Sitzung nicht gemessen wurde.

**F1–F3 stehen zusätzlich in `2026-07-28-einsatzlisten-pruefliste.md`.** Diese Liste hier
bewertet, was C5 **geändert** hat; F4 ist neu und hatte vorher keine.

## Prüfliste

| # | Kriterium | Verdikt | Begründung |
|---|---|---|---|
| 1 | **Treffläche** — Boden ≥ 24 × 24 CSS px oder 24-px-Umkreis frei; zeitkritische Aktion ≥ 48 × 48 px mit ≥ 8 px Abstand. | **erfüllt für die Aufnahme-Maske (F4/F1-Modal), offen für die drei Listenrouten → LFH-454** | Die sechs Sichtungs-Auswahlflächen sind die zeitkritische Aktion dieses Tickets, und sie sind die einzige Stelle mit einer eigenen Zusicherung: `skFlaechenStil` (`personen/AufnahmeFelder.tsx:31-40`) setzt `Math.max(64, token.controlHeight)` — **rein und exportiert** nach dem Muster von `bedienzielStil`, damit die Zusage ohne Rendern über zwei Dichtestufen prüfbar ist. Gepinnt in `AufnahmeFelder.test.tsx` („hält 64 px als Boden und folgt darüber der Dichtestufe" / „wächst über zwei Dichtestufen — ein Festwert fiele hier durch"). Kein punktuelles `size="small"` ist hinzugekommen: die Schuldmenge von `components/dichte.guard.test.ts` führt **keine** der fünf Dateien (`OFFEN` enthält seit LFH-339 nur noch `pages/uhs/Grundriss.tsx`). **Was fehlt, ist die Pixelmessung auf den drei Listenrouten:** `e2e/datensicht-schmal.spec.ts` misst die Staffel 30/48/72 am Primitiv, fährt dafür aber `/einsaetze/:id/personal` an — eine Kräfteroute, nicht `/personen`, `/tiere`, `/schaeden`. Der Mechanismus greift (alle Elemente hängen am `ConfigProvider`), die Pixel auf diesen drei Routen sind es nicht. |
| 2 | **Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px, Abstand ≥ 16 px. | **offen → LFH-454** | Für die Sichtungsflächen ist die Handschuh-Stufe belegt (`skFlaechenStil({controlHeight: 72}).minHeight === 72`, siehe Zeile 1) — das ist eine **reine Funktion**, kein gerendertes Pixel. Für die Flächen selbst gilt: `e2e/betroffene-schmal.spec.ts` enthält **keinen** `stelleDichte`-Aufruf und misst damit genau eine Dichtestufe (die Vorgabe). Ohne einen zweiten Durchgang bestünde ein hartkodierter Wert den Test — dieselbe Begründung, mit der `kraefte-schmal.spec.ts` seinen zweiten Durchgang führt. Der Nachzug liegt mit Zeile 1 in **einem** Ticket (LFH-454): `betroffene-schmal.spec.ts` um die Staffel-Schleife aus `datensicht-schmal.spec.ts:257` erweitern, mit `data-dichte`-Wache vorweg. **Nicht** an LFH-446 hängen: das ist namentlich auf `EinheitDetailPage` gescopt und kennt diese Routen nicht — ein Zielticket, das den Posten nicht kennt, ist ein toter Verweis. |
| 3 | **Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms; Kommandoreaktion ≤ 2 s; > 15 s nur mit Fortschrittsmeldung. | **erfüllt** | Zwei verschiedene Mechanismen, je nach Fläche, beide sofort sichtbar. **Erfassung (F1–F4):** die B4-Hülle setzt `loading` auf beide Knöpfe (`components/Erfassung.tsx:366` und `:373`), gespeist aus `laeuft` — verdrahtet in `personen/PersonErfassungModal.tsx:99`, `pages/TierePage.tsx:454`, `pages/schaeden/SchadenErfassenModal.tsx:116` und `pages/personen/AufnahmePage.tsx` (`laeuft={anlegenMutation.isPending}`). Der Riegel gegen doppeltes Absenden sitzt in der Hülle, nicht am Knopf. **Statuswechsel (F5):** echtes optimistisches Schreiben — `PersonenDetailPage.tsx:147-160` setzt Listen- **und** Detailstand per `setQueryData`, bevor der Server antwortet, und rollt in `onError` zurück. Gepinnt in `PersonenDetailPage.test.tsx`: „rollt nur den Status zurück und bewahrt neuere Listen- und Detailfelder" und „überschreibt beim Fehler keinen inzwischen neueren Statusstand". **Klarstellung, damit niemand mehr behauptet als dasteht:** `PersonenPage.tsx:132` und `TierePage.tsx:242` tragen zwar ein `onMutate`, das aber nur `cancelQueries` ruft — kein optimistischer Schreibvorgang. Für die Listen trägt die Rückmeldung der Ladezustand der Hülle, nicht ein vorweggenommener Datensatz. |
| 4 | **Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen, Alarmierung: je 1 zusätzliche Bestätigung. | **erfüllt** | Die einzige irreversible Aktion der fünf Flächen ist der Statuswechsel „→ verstorben" plus „Stornieren", beide auf F5. Beide tragen ein `<Modal>` mit eigenem Zustand (`PersonenDetailPage.tsx:877-922`), **außerhalb** jeder `map` und mit `okButtonProps={{ danger: true }}` — kein `Popconfirm` im Menü-Label, das dort nur mit `stopPropagation` das Auto-Schließen überlebte. Gepinnt: „„verstorben" fragt über einen Dialog zurück, nicht über ein Popconfirm" und, als notwendige Gegenaussage, „ein umkehrbarer Statuswechsel läuft ohne Rückfrage". Die drei Listen tragen **keine** destruktive Aktion: sie legen an und navigieren; ihre einzige Mutation ist das Erfassen. Das ist keine Auslassung, sondern der Grund, warum keine Rückfrage dort steht. |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1; Zustände, Rahmen, Fokusring ≥ 3 : 1. | **offen → LFH-455 (Farbachse Betroffene)** | Kein gerechneter Wert liegt vor — jsdom rechnet keine Farbmischung, und der Playwright-Topf führt diesen Nachweis für keine Fläche. Dazu ein **gemessener Mechanismus-Befund**, der über „nur nicht nachgewiesen" hinausgeht: `SK_META.tot.color = 'black'` (`personen/personMeta.ts`) ist **kein** antd-Preset — `antd/es/theme/interface/presetColors.js` führt 13 Namen, `black` ist keiner davon. `antd/es/tag/hooks/useColor.js` rechnet für Nicht-Presets ein **statisches** Farbpaar aus der Zeichenkette selbst (Variante `filled`: Grund = derselbe Ton auf `hsl.l = 0.95`, Text = der Ton). Dieses Paar kennt weder `theme/tokens.ts` noch den Nachtmodus; es steht im Dunkelmodus unverändert hell. Dieselben Preset-Namen tragen `AUSMASS_META`/`STATUS_META` in `pages/schaeden/schadenHelfer.tsx:17-36`. **Bestand, nicht von C5 verursacht** — aber C5 hat die Belichtung erhöht: dieselben SK-Farben stehen jetzt in sechs großen Auswahlflächen auf einer neuen Fläche. Nicht belegt ist der Satz im Dateikopf von `AufnahmeFelder.tsx`, die Regel „nie als Textfläche" halte hier wörtlich: `useColor` rechnet in **jedem** Zweig einen Hintergrund. |
| 6 | **Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder Form, 0 Ausnahmen. | **erfüllt** | Jedes farbtragende Element der fünf Flächen trägt seinen Wortlaut mit: die Sichtungsflächen zeigen „SK I" … „unverletzt" (`AufnahmeFelder.tsx:100-104`, gepinnt in `AufnahmeFelder.test.tsx` „trägt die Farbe im Etikett, nicht als Fläche"), die Schadensliste `TYP_LABEL`/`AUSMASS_META[…].label`/`STATUS_META[…].label` (`SchaedenPage.tsx:59-95`). „unverletzt" mit `color: 'default'` ist deshalb vollwertig und braucht keinen erfundenen Ton. Die **neue** Verortet-Spalte trägt beide Kanäle ohne jede Farbe: eine `@ant-design/icons`-Ikone in einer `aria-hidden`-Hülle, der zugängliche Name kommt vom Wrapper (`SchaedenPage.tsx:140-146`, `aria-label="verortet"` / `"nicht verortet"`) — **kein Emoji**, dessen Zeichnung und Farbe aus der Systemschrift käme. |
| 7 | **Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe nur für abnorme Zustände, Grundfläche weder `#000000` noch `#ffffff`. | **offen → LFH-455 (Farbachse Betroffene, gemeinsam mit Zeile 5)** | Blau ist in den Betroffenen-Modulen **dreifach belegt** und liegt zugleich quer zum A0-System: `SK_META.sk4` (Sichtungskategorie IV), `STATUS_META.betroffen` (Personenstatus) und `schadenHelfer.STATUS_META.uebergeben` (Schadensstatus) tragen `'blue'`, der Geschädigt-Bezug zusätzlich `'blue'`/`'geekblue'` (`schadenHelfer.tsx:77-91`). CLAUDE.md reserviert Blau für `bedien` („Rot bedient nichts"). Das ist dieselbe Klasse wie `im_einsatz` beim Material in C4 — und wie dort ist eine Rollenzuordnung eine **Farbentscheidung**, keine Aufräumarbeit: es gibt in der A0-Rollenmenge keine ehrliche Entsprechung für „Kategorie IV" neben „übergeben". Deshalb wurde hier keine erfunden. **Bestand, nicht von C5 verursacht**; C5s Anteil ist die erhöhte Belichtung aus Zeile 5. Wer das Ticket nimmt, entscheidet zuerst, ob die Sichtungsachse überhaupt in den A2-Farbvertrag gehört oder wie der Materialkatalog ausdrücklich daneben steht. |
| 8 | **Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS dimmbar — 1 Regler, 1 Sperre. | **offen → LFH-397** | App-weite Lücke, bereits unter LFH-336/337/338/339 dokumentiert und dort gebündelt: in der ganzen Anwendung existiert kein Regler. Nicht flächenspezifisch und nicht im Umfang von C5. |
| 9 | **Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am Layoutrand. | **erfüllt** | Gemessen, nicht behauptet. `e2e/betroffene-schmal.spec.ts` fährt **alle drei** Listen auf 390 px und auf 1366 px und prüft je Route `documentElement.scrollWidth − clientWidth ≤ 0,5` — mit einem gesäten Datensatz als **Anker vor jeder Messung**, weil eine Messung vor dem Inhalt den Ladezustand prüft und ohne Zeilen kein Überlauf entstehen kann (die Lehre aus C4, dort wörtlich vermerkt). Der stärkere Beleg ist die Bestandsliste: `e2e/gate1-ueberlauf.spec.ts:176` führt `BESTAND_OFFEN` seit C5 als **leer**. Der letzte Eintrag war `/personen` bei 390 px mit 120 px Überlauf — eine `Space`-Reihe ohne `wrap` mit drei Kopfknöpfen; der Umzug auf `EinsatzSeite` (dessen Aktionen-Slot in einem `Flex wrap` mit `minWidth: 0` an beiden Kindern liegt) hat ihn nicht gedeckelt, sondern beseitigt, und der Guard hat die Freistellung **selbst als tot gemeldet**. `/schaeden` steht bewusst **nicht** zusätzlich in jenem Gate: eine zweite Messung derselben Zusicherung an zwei Orten veraltet an einem davon. |
| 10 | **Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen. | **nicht anwendbar** | Keine der fünf Flächen erzeugt Alarme. Die einzigen Meldungen sind `message.error` auf den eigenen Fehlschlag einer Mutation (`AufnahmePage.tsx` `onError`, `SchadenErfassenModal.tsx` `onError`) und die stehende Erfolgs-Quittung — beides Quittungen auf eine Benutzeraktion, keine Zustandsmeldungen aus der Lage. |
| 11 | **Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten, jede Warnung quittierbar, jeder Ton mit visueller Entsprechung. | **erfüllt** | `grep -niE "animation\|blink\|keyframes"` über alle fünf Flächen plus `personen/AufnahmeFelder.tsx` liefert **0 Treffer** — kein Blinken, keine Bewegung, kein Ton. |
| 12 | **Kein Sprung unter dem Cursor** — CLS ≤ 0,1; neue Datensätze nur als opt-in-Sammelbanner. | **erfüllt** | Alle drei Listen laufen über `Datensicht` und übernehmen dessen Vorgabe `zufluss = 'sammelbanner'` (`components/Datensicht.tsx:754`) — keine der drei setzt die Prop, anders als `KraefteuebersichtPage.tsx:615` mit begründetem `"sofort"`. Neuer Zufluss erscheint als Banner in der Werkzeugzeile („7 neue Einträge — anzeigen", `Datensicht.tsx:1164-1168`), und die Zeilenschleuse friert Menge und Reihenfolge ein, solange der Fokus in der Sicht liegt (`:805-926`). Das ist für die Betroffenen-Module der Regelfall, nicht die Kür: `personen`, `tier` und `schaden` sind live-verdrahtete Wire-Events (`api/queryKeys.ts:87-107`), die Listen bewegen sich also ohne Zutun. **F4 hat keine Liste**; dort ist die einzige Verschiebung die stehende Quittung über dem Formular — sie erscheint als Folge der **eigenen** Erfassung, und der Fokus geht im Serienlauf ins erste Feld zurück (in `e2e/personen-aufnahme.spec.ts` mitgeprüft). |
| 13 | **Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter fixierten Köpfen, Fußleisten oder Drawern. | **erfüllt** | C5 hat **kein** verdeckendes Element hinzugefügt: `grep -n "sticky"` über die fünf Flächen, `components/EinsatzSeite.tsx`, `components/Datensicht.tsx`, `components/AppLayout.tsx` und `einsatz/EinsatzLayout.tsx` liefert 0 Treffer; das einzige `position: sticky` im Spiel ist die stehende Kopfzeile von `components/KatalogTabelle.tsx:319` (plus `.etb-erfassung-sticky` in `index.css`, das zum ETB gehört). Genau dieses Element misst `e2e/fokus-verdeckung.spec.ts:282` („Datensicht-Tabellenzweig: Tabulaturdurchlauf hinter Werkzeugzeile, Kopfzeile und fixierter Spalte"), samt Selbstbeweis des Messkerns (`:156`). **Grenze der Aussage, ausdrücklich:** jener Durchlauf fährt `/einsaetze/:id/personal`, nicht die drei Betroffenen-Routen. Er prüft aber dasselbe Bauteil in derselben Verdrahtung — anders als bei Zeile 1/2 hängt hier kein Wert an der einzelnen Fläche. F4 und F5 tragen gar kein überlagerndes Element. |
| 14 | **Tabellenseite vollständig** — fixierte Kopfzeile, fixierte menschenlesbare Identifierspalte, umschaltbarer Spaltensatz mit Zähler, keine Auflösung in Karten, wo verglichen wird. | **erfüllt** | Alle vier Teile kommen aus `Datensicht`/`KatalogTabelle` und gelten seit C5 auch für die Schadensliste, die bis dahin eine handgebaute Tabelle war. Stehende Kopfzeile: `KatalogTabelle.tsx:319`. Fixierte Identifierspalte: `:229-230` fixiert die erste Spalte links, und die erste Spalte ist überall die **menschenlesbare** Registriernummer, nicht die DB-`id` (`SchaedenPage.tsx:49`, `TierePage.tsx:77`, `personen/personenSpalten.tsx:82` — je `immerSichtbar: true`, also auch nicht wegschaltbar). Spaltenschalter mit Zähler: unverändert im Primitiv, eine Wahrheit für Handauswahl und `abBreite`. Keine Auflösung, wo verglichen wird: `betroffene-schmal.spec.ts` belegt bei 1366 px die Tabelle **und** die Abwesenheit der Karten auf allen drei Listen — die Gegenprobe, ohne die der Kartenzweig unbemerkt in jede Breite kippen könnte. Der Kartenzweig unter `md` bleibt die begründete Ausnahme aus AK3b des Drawer-Specs und ist nicht ausgeweitet worden. Für **F4/F5** ist die Zeile gegenstandslos: dort steht keine Vergleichsliste. |
| 15 | **Erfassungsmaske vollständig** — Defaults vorbelegt, sichtbar und einzeln überschreibbar, „Speichern und nächsten anlegen" mit gehaltenem Kontext, Sammelliste mit Ändern/Entfernen je Zeile, Labels über dem Feld, volle Tastaturbedienung. | **erfüllt** | Alle vier Erfassungswege liegen auf der B4-Hülle, keiner ist handgebaut: `PersonErfassungModal.tsx:91-104` (`serie`, `uebernahme={['antreff_ort']}`), `TierePage.tsx:450-459` (`uebernahme={['spezies','antreff_ort']}`), `schaeden/SchadenErfassenModal.tsx` (`serie` plus sitzungsweit gemerkter Ort) und `AufnahmePage.tsx` (`ErfassungsFormular`, `serie`, `uebernahme={['antreff_ort']}`). Daraus folgen Labels über dem Feld (`Erfassung.tsx:320` `layout="vertical"`), Absende-Knopf **im** `<form>` und Zurücksetzen auf allen vier Auswegen. Feldbudget: vier sichtbare Felder, der Name ist unter „Weitere Angaben" gewandert — gepinnt mit **beiden** Hälften in `AufnahmeFelder.test.tsx` („zeigt vier Felder, und der Name liegt unter „Weitere Angaben""). Tastaturbedienung und Serie sind am laufenden Browser gemessen: `e2e/personen-aufnahme.spec.ts` — „AK 2: eine gesichtete Person in ≤ 4 Interaktionen und ohne Seitenwechsel", „AK 3: „Speichern und nächste" leert, fokussiert zurück und zählt hoch" (leer, Fokus auf der ersten Auswahlfläche, Zähler auf 2, ohne den Dialog neu zu öffnen) und „die Aufnahme-Route zeigt dieselbe Maske und erfasst in Serie". Die **Sichtung steht ausdrücklich nicht in `uebernahme`**: sie ist die eine Angabe, die je Person neu erhoben wird — auch das ist gepinnt, als `toHaveCount(0)` auf die gewählte Fläche. |

**Bilanz: 9 × erfüllt · 5 × offen · 1 × nicht anwendbar.** Offen sind die Zeilen 1, 2, 5, 7
und 8; geteilte Zeilen zählen nach der Regel oben als offen.

## Was dieses Ticket am Zustand geändert hat

Der Ausgangsbefund von AK 2 war eine Zahl: **9 Interaktionen und 2 Vollseiten-Wechsel** je
gesichteter Person, weil die Sichtungskategorie in der Schnellerfassung fehlte — anlegen,
Detailseite öffnen, sichten. `e2e/personen-aufnahme.spec.ts` misst jetzt **3**.

Vier Dinge sind dabei über die Prüfliste hinaus bemerkenswert:

- **Die Bestandsliste des Überlauf-Gates ist leer geworden** — und zwar durch Totmeldung,
  nicht durch Streichen von Hand. Das als Zielticket notierte B5 (LFH-333) hat den Fall
  `/personen` nicht erledigt; der Umzug des Seitenkopfs hat ihn nebenbei mitgenommen.
- **Die Ladehoheit der Detailseite** ist von sechs auf zwei Startabfragen gefallen
  (`PersonenDetailPage.tsx:122-141`, `enabled` an `zuordnungenOffen`/`auditOffen`), und die
  Zusicherung ist mit **beiden** Hälften gepinnt: „setzt beim Öffnen höchstens zwei Abfragen
  ab" **und** „lädt die Zuordnungen erst beim Aufklappen". Die erste allein wäre auch grün,
  wenn die Zuordnungen gar nicht mehr lüden.
- **Kein `forceRender` am `Collapse`** der Detailseite — sonst stünden die Panels im Baum und
  „erst beim Aufklappen" wäre bedeutungslos. Dieselbe Falle wie beim Feldbudget von F4, nur
  mit umgekehrtem Vorzeichen: dort erzwingt der Test `forceRender`, damit die Zählung „≤ 4"
  überhaupt etwas misst.
- **Die Verortung der Schäden läuft ohne Backend-Änderung**: `SchadenPatch` kann lat/lon
  bereits, der Weg geht über den Deeplink `?platzieren=schaden:<id>` in den Platzier-Modus der
  Lagekarte (`routing/deeplinks.ts`, gepinnt inklusive Rückrichtung und „verwirft Unbrauchbares
  statt halb zu füllen"). Das Koordinatenfeld **in der Erfassung** ist ausdrücklich vertagt.

## Wo dieses Ticket dem Ticket-Text widerspricht

Eine Stelle, mit Beleg — sie ist eine Entscheidung, keine Auslassung:

**AK 2 („≤ 4 Interaktionen UND ohne Seitenwechsel") und die geforderte eigene Aufnahme-Route
sind wörtlich zugleich nicht erfüllbar** — eine angesprungene Route *ist* ein Seitenwechsel.
Aufgelöst ist der Widerspruch durch Aufteilung statt Umbenennung: den Zählweg erfüllt das
Modal auf der Personenliste (offen → Kategorie → speichern, URL vor und nach dem Erfassen
identisch), die Route ist die **Anspring-Adresse** für andere Module (UHS-Kopfzeile aus C6).
Beide zeigen dieselbe Feldgruppe — ein Bauteil, zwei Mounts —, weil zwei Kopien zwei
Feldbudgets, zwei Tastaturwege und zwei Stellen wären, an denen die Sichtung fehlen kann.
Die Begründung steht im Kopf von `pages/personen/AufnahmePage.tsx` und im Kopf des e2e-Specs.

## Offene Nachzüge

1. **Zeilen 1 + 2 — Trefflächen der drei Betroffenen-Routen über die Dichte-Staffel.**
   → **LFH-454.** Zu tun: `e2e/betroffene-schmal.spec.ts` um die
   Staffel-Schleife 30 / 48 / 72 aus `datensicht-schmal.spec.ts:257` erweitern, mit
   `data-dichte`-Wache vor jeder Messung (ohne sie hat jedes „zu klein" zwei mögliche
   Ursachen) und einem Ziel je Route — Titel-Link der Karte bei 390 px, Spaltenschalter bei
   1366 px. **Nicht** an LFH-446 anhängen: das ist auf `EinheitDetailPage` gescopt.
2. **Zeilen 5 + 7 — Farbachse der Betroffenen-Module.**
   → **LFH-455.** Zu tun: entscheiden, ob Sichtung, Personenstatus und
   Schadensstatus in den A2-Farbvertrag gehören oder wie der Materialkatalog ausdrücklich
   daneben stehen; als erstes und unabhängig davon `SK_META.tot.color = 'black'` ersetzen —
   es ist kein antd-Preset, `useColor` rechnet daraus ein statisches, nachtmodus-blindes
   Farbpaar. Der gerechnete Kontrastnachweis in beiden Modi gehört in denselben Playwright-
   Topf, der ihn heute für keine Fläche führt (gleiche Lage wie bei den Warnstufen-Füllungen
   aus LFH-368/B5h und den Rollenfarben aus LFH-339/C4).
3. **Zeile 8 — Helligkeits-/Kontrastregler.** → **LFH-397**, unverändert app-weit.
4. **Koordinatenfeld in der Schadens-Erfassung** (`SchadenEingabe` um lat/lon, Rust-DTO +
   Codegen, `KoordinatenEingabe` einhängen) — **LFH-453**, vom Auftraggeber in dieser Runde ausdrücklich
   ausgeklammert, im Umsetzungsplan als Nachzug notiert. Bis dahin ist die Karte der einzige
   Verortungsweg; die Prüfliste bewertet das nicht als Mangel, weil der Weg vorhanden und
   sichtbar ist (Zeile 6).
