# Prüfliste Einsatztauglichkeit — Modul „Verpflegung“ (LFH-634)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen Seite. Planung und Spec liegen in
`openspec/changes/lfh-634-fachmodul-verpflegung/` (Aufgaben 6.3 und 6.4).

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/verpflegung` (`frontend/src/pages/VerpflegungPage.tsx`) |
| Stand | Commit `8fa82c29` auf `feat/lfh-634-fachmodul-verpflegung` |
| Zielkontext | Fükw (1366 px, Tastatur + Maus, Nachtmodus als Regelfall); Führungs-Tablet in `komfortabel`/`handschuh`; mobil 390 px zum Lesen und für die Ausgabe-Erfassung |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Zeitfensterliste mit Kopf** | `pages/VerpflegungPage.tsx`, `verpflegung/ZeitfensterKarte.tsx` | ja: Gate 1 (Überlauf), Gate 3 (Trefffläche, Abstand), Kontrast-Spec, Sichtprüfung, Messung des Sammelbanners |
| **2 · Erfassungsdialoge und Rückfragen** („Zeitfenster anlegen/Bedarf bearbeiten“, „Ausgabe erfassen“, „Ausgabe zurücknehmen?“, „Zeitfenster … löschen?“) | `verpflegung/VerpflegungDialoge.tsx` | Kontrast-Spec an den zwei Erfassungsdialogen; die zwei Rückfragen in der Sichtprüfung gemessen; sonst Vitest |
| **3 · Nachforderungs-Sprung und Stab-S4** | `verpflegung/verpflegungText.ts` (`nachforderungVorbelegung`), `pages/NachforderungenPage.tsx`, `stab/sachgebiete.ts`, `pages/StabPage.tsx` | Sichtprüfung samt Kontrastmessung, sonst Vitest |

**Verdikte:** **erfüllt** (nur mit Beleg: Testdatei + Testname oder Messung + Commit) ·
**offen → Zielticket** · **nicht anwendbar** (mit Begründung). Gerechnetes und aus Quelltext
Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis | Stand |
| --- | --- | --- |
| Gate 3, `e2e/gate3-trefflaeche.spec.ts` „Verpflegung: Kartenaktionen folgen der Dichte-Staffel 30 / 48 / 72 px“, 1366 px, zwei gesäte Zeitfenster (eines mit Menü, eines mit zwei Knöpfen und zwei Ausgaben) | „Ausgabe erfassen“ (2 Knoten), Dreipunkt, „Bedarf bearbeiten“, „Zurücknehmen“ (2 Knoten) und Kopfaktion **30 / 48 / 72** px · Abstand Kartenaktion ↔ Nachbar **7 / 11 / 16** px · „Zurücknehmen“ ↔ nächstes Ziel der Karte **26 / 23 / 33** px | `822449ec` |
| Gate 1, `e2e/gate1-ueberlauf.spec.ts` „Gate 1: keine tragende Route läuft auf 1366, 1024 oder 390 px waagerecht über“, Zeitfenster mit langer Bezeichnung, vier Kostformen und langem Ausgabeort | **0 px** waagerechter Überlauf auf 1366 / 1024 / 390 px (ohne Sammelbanner, siehe Befund S1) | `822449ec` |
| Kontrast, `e2e/verpflegung-kontrast.spec.ts` „Verpflegung: Zeitfensterkarten, Kopf und Dialoge — Text und Rand im Modus light/dark“, 1366 px; gesät je Einstufung ein Zeitfenster, dazu eine zurückgenommene Ausgabe und eine Sonderkost-Fehlmenge. Gemessen wird **jeder** Text aus dem Textbaum (Seitenkopf, Karten, Dialoge „Zeitfenster anlegen“ und „Ausgabe erfassen“ mit aufgeklapptem Bereich), dazu Karten- und Etikettrand. Messkern `e2e/kontrast-kern.ts` | **Text, Minimum ohne Ausnahme:** Tag 7,05 (Kopf-Meta), Nacht 6,19 · **der kritische Fall Unterdeckung** (Tag / Nacht): Etikett „Unterdeckung“ 7,31 / 6,89 · Fehlmenge im Kennzahlenband 8,96 / 6,77 · „fehlt 8 vegan“ 8,22 / 7,06 · **Zustandsrand** Unterdeckung gegen Seitengrund / Kartenfläche: Tag 6,21 / 5,67, Nacht 7,06 / 7,18 · **Ausnahmen** (Untergrenze 4,5): Tertiärtext `schwach` Tag ≥ 5,33, Nacht ≥ 4,81 → LFH-643; Weiß auf `bedien` im Primärknopf Tag 6,59 → LFH-661. **Mutationsprobe** `alarmText` → `alarm` an drei Stellen: der Taglauf wird an allen drei benannten Zusicherungen rot (5,52 / 6,78 / 6,21), der Nachtlauf kann sie nicht sehen (dort ist `alarmText` wertgleich mit `alarm`) | `822449ec`, Nachschärfung `8fa82c29` (die Deckungszeile im Dialog „Ausgabe erfassen“ läuft als tragender Text statt als Tertiärtext) |
| Browser-Sichtprüfung (Wegwerf-Spec im Playwright-Harness, nicht committet), Tag und Nacht bei 1366 × 768, Liste und Ausgabedialog zusätzlich bei 390 px | Siehe Abschnitt „Sichtprüfung“ unten: 40 Aufnahmen, vier Befunde (S1–S4) | `8fa82c29` |
| Messung in derselben Sichtprüfung: Rückfragen, Menü, Nachforderungsformular, Stab-S4, Sammelbanner | Werte stehen an den Zeilen 5 und 12 | `8fa82c29` |
| Grep über `verpflegung/*.ts(x)` und `pages/VerpflegungPage.tsx` (ohne Tests) | Farbliterale (`#…`, `rgb(`) **0** · `animation`/`blink`/`keyframes`/`transition` im Code **0**; 2 Treffer, beide Kommentare („Nichts blinkt.“) · `sticky`/`fixed` **0** · `size=` nur `Spin size="large"` (Ladeanzeige; der zweite Treffer `autoSize` ist keine Größen-Prop) · `danger` nur am Menüeintrag „Löschen“ (hinter dem Trenner), am Knopf „Löschen“, wenn es weniger als drei Aktionen sind und deshalb nicht gebündelt wird, und an beiden Rückfragen (`okButtonProps`) | `8fa82c29` [abgeleitet] |

## Sichtprüfung (Aufgabe 6.3)

Gesät per API: vier Zeitfenster, nämlich „Frühstück Deich“ (läuft, Unterdeckung, Sonderkost-Fehlmenge
„fehlt 8 vegan“, eine gültige und eine zurückgenommene Ausgabe), „Mittag Deich“ (läuft,
gedeckt), „Abendessen Deich“ (Beginn in drei Stunden, offen) und „Nachtverpflegung Deich“
(vergangen). Dazu sieben Personen im Personal und eine Betreuungsstelle mit 42 gemeldeten
Personen als Quellen der Vorschläge, außerdem ein Beobachter ohne Schreibrecht. Die Aufnahmen
liegen nur im Arbeitsverzeichnis der Prüfung und sind nicht committet.

| Was | Gesehen |
| --- | --- |
| Liste, Tag und Nacht | Drei Karten in Zeitordnung. Der Rand ist rot, grün oder trägt die Linienfarbe, das Etikett nennt „Unterdeckung“, „gedeckt“ bzw. „offen“. Die Unterdeckung zeigt „fehlt 8 vegan“ in `alarmText`, die zurückgenommene Ausgabe steht durchgestrichen unter dem Typwort „zurückgenommen“. Der Kopf meldet „4 Zeitfenster · 1 mit Unterdeckung“. Kein englischer Text, kein Platzhalter |
| Ansicht „vergangen“ | Eine gedeckte Karte mit ihrer Ausgabe, die Segmentleiste zählt „laufend & anstehend (3)“ und „vergangen (1)“ |
| „Zeitfenster anlegen“ | Einsatzkräfte ist mit **7** vorbelegt („Vorschlag: Personal im Einsatz, Stand hh:mm“), Betreute mit **42** („Vorschlag: in Betreuung, Stand jetzt“). **Beide Vorschläge sind sichtbar.** Der aufgeklappte Bereich zeigt „Weitere Personen (EP)“, den Hinweis zur Teilmenge und die fünf Kostformen; „Abbrechen“ und „Anlegen“ stehen im Dialog |
| „Ausgabe erfassen“ | Die Deckungszeile „Bedarf 90 · ausgegeben 30 · fehlt 60 EP“ steht in voller Textfarbe. Menge, Ort und Zeitpunkt („Leer: jetzt“) sind sichtbar, „Weitere Angaben“ ist eingeklappt. Bei 390 px passt der Dialog in die Breite |
| Nach dem Erfassen | Oben mittig der Hinweis „Ausgabe erfasst: 20 EP zu ‚Frühstück Deich‘ · Rückgängig“; die Ausgabe steht sofort in der Karte, „fehlt“ fällt von 60 auf 40 |
| Rückfragen | „Ausgabe zurücknehmen?“ nennt die Ausgabe („40 EP um hh:mm (Feldküche Süd) zu ‚Mittag Deich‘“) und die Folge. „Zeitfenster ‚Abendessen Deich‘ löschen?“ nennt den ETB-Eintrag. Der Knopf ist in beiden Modi rot gefüllt; bei Nacht mit dunkler Schrift |
| Aktionsmenü | Bei „Frühstück Deich“ stehen „Bedarf bearbeiten“ und „Nachfordern“, „Löschen“ fehlt, weil eine gültige Ausgabe existiert. Bei „Abendessen Deich“ steht zusätzlich „Löschen“, rot hinter dem Trenner; das Menü öffnet dort nach oben |
| Nachforderungs-Sprung | Die Seite „Nachforderung Kräfte/Mittel“ öffnet die Erfassung vorbelegt: Art „Verpflegung“, Anzahl 40, Bezeichnung „Essensportionen ‚Frühstück Deich‘ hh:mm–hh:mm“, Begründung „Unterdeckung Verpflegung ‚Frühstück Deich‘: Bedarf 90, ausgegeben 50. Es fehlt Sonderkost: 8 vegan.“ Danach ist die Adresse ohne Parameter (`…/nachforderungen`), die Vorbelegung wird also übernommen und dann aus der URL geräumt. **Befund S2** |
| ETB | Vier System-Einträge „Verpflegung ‚…‘ … angelegt: Bedarf n EP (… Kräfte, … Betreute), davon n Sonderkost.“ Für Ausgabe und Rücknahme gibt es bewusst keinen Eintrag (design.md D5) |
| Stab | Die Zeile „S4 · Versorgung“ führt die Werkzeuge Nachforderung · Verpflegung · Material. **Befund S4** |
| 390 px | Kein waagerechter Überlauf (0 px). Das Kennzahlenband bricht in zwei Zeilen um, die Sonderkost-Fehlmenge rückt unter die Zeile |
| Leerzustand | „Noch kein Zeitfenster“ mit Erklärsatz und „Zeitfenster anlegen“ |
| Beobachter | Über der Liste steht „Nur Einsatzleitung und Führungspersonal können Zeitfenster anlegen und Ausgaben erfassen.“ Die Kopfaktion ist gesperrt, an den Karten gibt es keinen Knopf (0 Knöpfe gezählt). Im leeren Modul steht der Leerzustand ohne Aktion |
| Sammelbanner (fremd angelegtes Zeitfenster) | Siehe Zeile 12. **Befund S1** |

**Befunde** und ihre Entscheidung (Controller, 24.09.2026):

- **S1 — Sammelbanner bei 390 px (`komfortabel`) unlesbar.** Die Segmentleiste
  „laufend & anstehend (4) | vergangen (1)“ lässt dem Banner 107 px. Sein Text („1 neues
  Zeitfenster, davon 1 mit Unterdeckung“) schrumpft auf **0 px**, zu sehen ist nur der Pfeil.
  Der Knopf „anzeigen“ reicht bis x = 391,5 und wird am Rand abgeschnitten, die Seite läuft
  dann **2 px** waagerecht über (`scrollWidth` 390 → 392). Bei 1366 und 1024 px steht der
  Text vollständig da. Gate 1 sieht das nicht, weil dort kein Banner steht. **→ LFH-694**
  (gemeinsam mit der Ablösung, die dasselbe Muster der Segmentzeile trägt).
- **S2 — Vorbelegte Begründung nur zur Hälfte sichtbar.** `NachforderungFormular` führt die
  Begründung als `TextArea rows={1}` (Bestand). Von der Vorbelegung sieht man nur „…
  ausgegeben 50. Es fehlt“; der Satz „Es fehlt Sonderkost: 8 vegan.“ steht erst nach dem
  Scrollen im Feld. **→ behoben** in diesem Ticket: Die Begründung wächst jetzt bis vier
  Zeilen (`autoSize={{ minRows: 1, maxRows: 4 }}`).
- **S3 — Gefüllter roter Knopf am Tag unter 7 : 1.** Weiß auf `alarm` (#b02318) misst im
  Tagmodus **6,78 : 1** („Zurücknehmen“ und „Löschen“ in den Rückfragen). Die Rolle ist
  app-weit (`antdKomponenten`, `dangerColor: aufBedien`). Sie gehört in dieselbe Familie wie
  LFH-661 (Weiß auf `bedien`) und LFH-693 (roter Menüeintrag), wird aber von keinem der beiden
  Tickets erfasst. Nachts liegt der Wert bei 7,18. **→ LFH-693**, per Kommentar erweitert
  (Menüeintrag und gefüllter `danger`-Knopf sind dieselbe Rolle).
- **S4 — Werkzeug-Links im Stab laufen über antds `colorLink`.** Die Links in
  `pages/StabPage.tsx`, auch „Verpflegung“, messen am Tag **6,04** und nachts **4,75 : 1**.
  Das ist Bestand der Stabseite. Nach LFH-650 nimmt blauer Bedien-Text `rollen.bedienText`.
  **→ LFH-695**.

**Kosmetik ohne Verdikt:** Das Kennzahlenband lässt bei 390 px eine leere Rasterzelle neben
„fehlt“ stehen; das ist das geteilte Bauteil. Im ETB stehen zwei Zitatstile nebeneinander,
‚…‘ aus der Verpflegung und «…» aus dem Personal (Bestand). Das runde Palmensymbol unten rechts
auf allen Aufnahmen ist `ReactQueryDevtools`. Es wird nur im Dev-Modus gerendert
(`process.env.NODE_ENV !== 'development'` → leere Komponente) und fehlt im Prod-Bundle.

---

## Tabelle 1 — Zeitfensterliste mit Kopf

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** ≥ 24 × 24 px; zeitkritische Aktion ≥ 48 px mit ≥ 8 px Abstand | **erfüllt** | Gate 3: alle Ziele 30 / 48 / 72 px. „Ausgabe erfassen“ ist die zeitkritische Aktion; in `komfortabel` misst sie 48 px bei 11 px Abstand zum Nachbarn. Alle Ziele sind antd-`Button`, handgebaute Bedienziele gibt es nicht. Die Segmentleiste ist ein geteilter Baustein mit handgebautem Bedienziel; ihr Boden kommt aus `segmentStil` (`minHeight: token.controlHeight` plus Polsterung): `components/instrument/Segmentleiste.test.tsx` „Bedienziel: Boden 30 / 48 / 72 aus controlHeight, plus Polsterung, die mitwächst“. Auf dieser Seite ist sie im Browser nicht gemessen **[abgeleitet]** | — |
| 2 | **Handschuh-Modus** — Ziel ≥ 72 px, Abstand ≥ 16 px | **erfüllt** | Gate 3 `handschuh`: 72 px an allen Zielen. Der Abstand Kartenaktion ↔ Nachbar beträgt 16 px, „Zurücknehmen“ ↔ nächstes Ziel 33 px; der Test erzwingt ≥ 16 | — |
| 3 | **Rückmeldung vor der Serverantwort** ≤ 100 ms | **erfüllt** | Die Dialogknöpfe laufen mit `loading` (`laeuft` an `ErfassungsModal`). Die Liste zeigt beim Laden eine Ladeanzeige statt einer leeren Liste. Nach dem Erfassen erscheint der Rückgängig-Hinweis, und die Ausgabe steht in der Karte (Sichtprüfung). `VerpflegungPage.test.tsx` „Ausgabe erfassen: POST, dann ruft „Rückgängig" die Rücknahme — ohne ETB-Invalidierung“ | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | **Löschen** eines Zeitfensters: Rückfrage mit rotem Knopf. Der Server lehnt mit 422 ab, solange eine gültige Ausgabe existiert. **Rücknahme** aus der Liste: rote Rückfrage, die Rücknahme ist endgültig. **Ausgabe erfassen:** umkehrbar über den Rückgängig-Hinweis (LFH-343). `VerpflegungPage.test.tsx` „Zurücknehmen aus der Liste fragt rot zurück; Abbrechen sendet nichts“; `VerpflegungDialoge.test.tsx` › Rückfragen „Rücknahme: Modal mit rotem Knopf, nennt die Ausgabe; Abbrechen sendet nichts“, „Löschen: Modal mit rotem Knopf; der Server-Grund steht im Dialog“; `tests/verpflegung.rs` `durchstich_anlegen_ausgabe_ruecknahme_loeschen`, `statuscodes_422` | — |
| 5 | **Kontrast in beiden Modi** — Text Tag ≥ 7:1, Nacht ≥ 5:1; Zustände ≥ 3:1 | **offen** | Gemessen mit `e2e/verpflegung-kontrast.spec.ts`, Werte unter „Die Nachweise“. Offen ist das Verdikt allein wegen app-weiter Rollen, nicht wegen der Seite. Jeder Text ohne Ausnahme hält am Tag ≥ 7 (Minimum 7,05) und nachts ≥ 5 (Minimum 6,19), der kritische Fall Unterdeckung eingeschlossen (am Tag über `alarmText`, per Mutationsprobe belegt). Zustandsrand und Etikettrand liegen ≥ 3 gegen beide Flächen. **Der Rand der offenen Karte ist nicht anwendbar:** Er trägt die Linienfarbe, weil „offen“ kein Zustand ist. Der Spec sichert zu, dass er keinem Zustandsrand gleicht. **Ausnahmen, alle nicht seitenspezifisch:** Tertiärtext `schwach` (Augenbrauen, Einheit „EP“, Bemerkung der Ausgabe, „Stand“, Ortspfad) liegt am Tag ≥ 5,33 und nachts ≥ 4,81 → LFH-643. Weiß auf `bedien` im Kopfknopf misst am Tag 6,59 → LFH-661. Der rote Menüeintrag „Löschen“ misst am Tag 6,27 → LFH-693. Das Menü selbst liegt am Tag bei 15,65 / 17,08 und nachts bei 12,11 / 15,02 (Sichtprüfung) | LFH-643, LFH-661, LFH-693 (app-weit) |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Jede Einstufung trägt ein Wort („gedeckt“, „offen“, „Unterdeckung“), die Fehlmenge steht als Zahl, die Sonderkost-Fehlmenge als Satz („fehlt 8 vegan“). Die zurückgenommene Ausgabe hat Wort und Durchstreichung. `ZeitfensterKarte.test.tsx` „Unterdeckung im laufenden Zeitfenster: Fehlmenge 20, Wort, Alarmrand und data-Marke, ohne Animation“, „Sonderkost fehlt trotz Gesamtdeckung: die Kostform wird genannt, Einstufung Unterdeckung“, „eine zurückgenommene Ausgabe steht mit dem Wort und ohne Rücknahme-Knopf da“; `theme/statusFarben.test.ts` › „verpflegungDeckung (LFH-634, design.md D3)“ und Kanaltest „gibt jedem Eintrag einen zweiten Kanal (WCAG 1.4.1)“ | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Rot steht nur für Unterdeckung (Rand, Etikett, Fehlmenge, Sonderkost-Fehlmenge) und für Destruktives (Löschen, Rücknahme-Rückfrage). Grün steht nur für „gedeckt“. „offen“ ist `neutral`, auch mit Fehlmenge; vor dem Beginn gibt es keinen Alarm: `ZeitfensterKarte.test.tsx` „vor Beginn „offen" ohne Alarm — die Fehlmenge steht trotzdem als Zahl da“. Die Aufgliederung des Bedarfs läuft in neutralen Tönen (`text2`/`gedaempft`/`linieStark`). Die Kartenaktion ist bewusst kein Primärknopf; die eine Primäraktion steht im Kopf. Grep: Farbliterale 0 | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke, wie in allen Prüflisten seit LFH-336 | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Der Kopf nennt „n Zeitfenster · m mit Unterdeckung“: `VerpflegungPage.test.tsx` „trennt laufend & anstehend von vergangen; Kopf zählt alle und die Unterdeckungen“. **[abgeleitet]** Die Liste ist nach Beginn geordnet (`ORDER BY von_at, id`, `src/verpflegung/repo.rs`). Unterdeckung gibt es nur bei begonnenen Zeitfenstern; vor dem Beginn heißt eine Fehlmenge „offen“ (`deckung.test.ts` „eine Fehlmenge vor Beginn ist offen, auch die volle“). Deshalb steht jede laufende Unterdeckung in der Ansicht „laufend & anstehend“ vor allen anstehenden Karten, also oben | — |
| 10 | **Alarmbudget** — 1–2 je 10 min, ≤ 3 Eskalationsstufen | **nicht anwendbar** | Das Modul erzeugt keinen Alarm. Es gibt keinen Modulzähler, keine Marke im Überblick, keinen Hinweis in der AlarmZentrale und keinen Ton. Unterdeckung ist ein Zustand auf der Seite, kein Alarmereignis (design.md, Non-Goals) | — |
| 11 | **Warnverhalten** — kein Blinken, jede Warnung quittierbar, jeder Ton mit visueller Entsprechung | **erfüllt** | Kein Blinken: Grep 0 im Code (2 Treffer, beide Kommentare „Nichts blinkt.“). `ZeitfensterKarte.test.tsx` prüft die Unterdeckungskarte ausdrücklich „ohne Animation“. Es gibt weder Ton noch Warnung, die quittiert werden müsste | — |
| 12 | **Kein Sprung unter dem Cursor** | **offen** | **Erfüllt auf Fükw und Tablet.** Ein fremd angelegtes Zeitfenster wartet hinter dem Sammelbanner, auch wenn es vor den gezeigten einsortiert würde. Eigene Anlagen stehen sofort da. Gemessen in der Sichtprüfung: Werkzeugzeile und Oberkante der obersten Karte vor und nach dem Banner bei 1366 px `kompakt` 32 → 32 px, y 158 → 158 und bei 1024 px `handschuh` 74 → 74 px, y 428 → 428. Die oberste Karte bleibt dieselbe, der Kopf zählt die zurückgehaltene mit („5 Zeitfenster · 2 mit Unterdeckung“), nach „anzeigen“ steht die neue oben. Vitest: `VerpflegungPage.test.tsx` › „Live-Zufluss (Spec „Live-Verteilung")“ mit den Tests „ein fremd angelegtes Zeitfenster verschiebt keine Karte, bis das Banner bedient wird“, „geänderte Mengen an bestehenden Karten erscheinen sofort, ohne Banner“, „ein eigenes neues Zeitfenster steht sofort an seinem Platz“, „ein Ansichtswechsel gibt die zurückgehaltenen frei“. **Offen auf mobil (390 px, `komfortabel`):** Dort bleiben Zeile (50 → 50) und Karte (y 331,6) zwar stehen, aber das Banner ist nicht lesbar und läuft 2 px über (**Befund S1**). Der e2e-Nachweis im Spec fehlt; die Werte stammen aus der nicht committeten Sichtprüfung | LFH-694 (Befund S1) |
| 13 | **Fokus nie verdeckt** | **erfüllt [abgeleitet]** | Keine fixierte Konstruktion auf der Seite (Grep `sticky`/`fixed` 0). Der einzige Überlagerer ist der Rückgängig-Hinweis oben mittig. Er verdeckt den oberen Rand für 6 s (`DAUER_S` in `kommunikation/rueckgaengig.tsx`). Ein Tab-Durchlauf ist nicht gemessen | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle: Die Frage lautet „was ist mit diesem Zeitfenster?“, die Ordnung ist die Zeit (LFH-330/B2, design.md D7) | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Auf der Fläche wird nichts erfasst; die Masken sind Fläche 2 | — |

**Bilanz:** 9 erfüllt · 3 offen · 3 nicht anwendbar. Kriterium 5 ist gemessen und bleibt nur
wegen app-weiter Rollen offen (LFH-643/661/693). Kriterium 12 ist auf mobil offen → LFH-694.

## Tabelle 2 — Erfassungsdialoge und Rückfragen

Hier stehen nur die Zeilen, die von Tabelle 1 abweichen. Nr. 6, 7, 8, 10 und 11 gelten wie
dort.

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1/2 | Trefffläche, Handschuh | **erfüllt [abgeleitet]** | Die Masken bestehen nur aus antd-Feldern in `ErfassungsModal`, die Rückfragen aus antd-`Modal`. Beide erben die Staffel vom `ConfigProvider`. Im Browser ist das hier nicht gemessen; dieselbe Hülle ist in Gate 3 an anderen Masken belegt | — |
| 3 | Rückmeldung | **erfüllt** | Der Knopf zeigt `loading`, Fehler bleiben **im** Dialog (`SpeicherFehler`), die Felder bleiben stehen (`mutateAsync`). `VerpflegungDialoge.test.tsx` „eine Ablehnung (422) lässt die Felder stehen und zeigt den Grund im Dialog“, „Sonderkost über der Menge: der 422-Grund steht im Dialog, die Felder bleiben“, „Löschen: Modal mit rotem Knopf; der Server-Grund steht im Dialog“ | — |
| 4 | Zweite Handlung | **erfüllt** | Siehe Tabelle 1, Nr. 4 | — |
| 5 | Kontrast | **offen** | **Erfassungsdialoge:** Gemessen, nicht geerbt. `e2e/verpflegung-kontrast.spec.ts` öffnet „Zeitfenster anlegen“ und „Ausgabe erfassen“ samt aufgeklapptem Bereich und misst jeden Text. Tragende Wortlaute ohne Ausnahme: Feldbeschriftungen, „Säugling/Kleinkind“ und die Deckungszeile „Bedarf … · ausgegeben … · fehlt … EP“, die seit `8fa82c29` tragend ist. Ausnahmen: Feldhilfe, Vorschlagshinweis, Sonderkost-Hinweis und „Leer: jetzt“ (`schwach`) → LFH-643; der Absende-Knopf (Weiß auf `bedien`, Tag 6,59) → LFH-661. **Rückfragen**, gemessen nur in der Sichtprüfung und nicht im Spec: Titel und Text liegen am Tag bei 17,08, nachts bei 15,02; „Abbrechen“ bei 18,47 bzw. 15,70; der rote Knopf nachts bei 7,18 (dunkle Schrift auf `alarm`), **am Tag bei 6,78** (Weiß auf `alarm`, **Befund S3**). Das ist unter 7, aber über 4,5 | LFH-643, LFH-661 (app-weit); S3: LFH-693 |
| 12 | Kein Sprung | **nicht anwendbar** | Dialog ohne Live-Inhalt | — |
| 13 | Fokus nie verdeckt | **erfüllt [abgeleitet]** | Modaler Dialog mit eigenem Fokusbereich. Auf 1366 × 768 reicht der aufgeklappte Anlegen-Dialog über die Sichthöhe hinaus. Er scrollt im Modal-Wrap, „Anlegen“ bleibt erreichbar (Sichtprüfung, Aufnahme nach `scrollIntoViewIfNeeded`) | — |
| 15 | **Erfassungsmaske vollständig** | **offen** | Die Teilkriterien sind erfüllt. **Vorbelegt, sichtbar und einzeln überschreibbar:** Die Vorschläge nennen ihre Herkunft, „Zeitpunkt“ zeigt „Leer: jetzt“. Belege: `VerpflegungDialoge.test.tsx` „belegt beide Bedarfe mit den Vorschlägen vor und nennt die Herkunft“, „ohne Vorschlag bleiben die Felder leer — nie 0 als Ersatz“, „nach eigener Eingabe bleibt die Zahl der Person stehen“, „ein spät eintreffender Kräftevorschlag überschreibt keine eigene Eingabe“; beim Bearbeiten „zeigt den Vorschlag als Hinweis und überschreibt den gespeicherten Bedarf nicht“. **Feldbudget** 4 bzw. 3 sichtbar, der Rest eingeklappt, **Knopf im `<form>`**: „vier Felder sichtbar, der Rest eingeklappt; Knopf im <form>; sendet den Body“, „drei Felder sichtbar, der Rest eingeklappt; Knopf im <form>; sendet Menge und Ort“. **Beschriftung über dem Feld** (Sichtprüfung). **Sammelliste mit Entfernen je Zeile:** Die Ausgaben stehen an der Karte, jede mit „Zurücknehmen“; bearbeitet wird eine Ausgabe bewusst nicht (design.md, Non-Goals). **Kein Serienmodus:** Ein Zeitfenster entsteht je Mahlzeit, Serien sind ausdrücklich kein Ziel (design.md, Non-Goals); Ausgaben kommen je Mahlzeit einzeln **[abgeleitet]**. **Offen ist die Zeiteingabe:** Zeitraum und Zeitpunkt werden in der Browserzone gelesen, nicht in der Anzeigezone. Das wirkt nur, wenn beide auseinanderliegen; dann stimmt die eingetippte Uhrzeit nicht mit der gezeigten überein | LFH-692 |

## Tabelle 3 — Nachforderungs-Sprung und Stab-S4

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1/2 | Trefffläche, Handschuh | **erfüllt [abgeleitet]** | Der Sprung beginnt am Menüeintrag „Nachfordern“ (antd-`Dropdown`, Staffel vom `ConfigProvider`). Das Zielformular ist Bestand (`ErfassungsFormular`). Die Stab-Werkzeuge nehmen `stabZeilenzielStil(token)`. Hier ist nichts neu gemessen | — |
| 3 | Rückmeldung | **erfüllt** | Der Sprung ist eine clientseitige Navigation; die Erfassung steht beim Mount offen und vorbelegt (Sichtprüfung). `NachforderungenPage.test.tsx` › „Vorbelegung per Deeplink (LFH-634)“ „öffnet die Erfassung vorbelegt und räumt die Adresse“ | — |
| 5 | Kontrast | **offen** | Gemessen in der Sichtprüfung. **Nachforderungsformular:** Beschriftungen Tag 16,93, Nacht 16,37. Vorbelegte Feldwerte (Art, Anzahl, Bezeichnung, Begründung) Tag 18,47, Nacht 15,70. „Werte behalten“ (`schwach`) 5,84 / 5,24 → LFH-643. „Nachforderung absetzen“ Tag 6,59 → LFH-661. **Stab-S4:** Titel 16,93 / 16,37, „nicht vergeben“ 10,30 / 10,89, Aufgabentext (`schwach`) 5,84 / 5,24 → LFH-643. **Die Werkzeug-Links „Nachforderung · Verpflegung · Material“ messen am Tag 6,04 und nachts 4,75** (**Befund S4**, Bestand der Stabseite) | LFH-643, LFH-661 (app-weit); S4: LFH-695 |
| 6 | Nicht nur Farbe | **erfüllt** | Die Vorbelegung ist Text (Art, Anzahl, Bezeichnung, Begründung mit Bedarf, Ausgabe und fehlender Sonderkost). `verpflegungText.test.ts` › „nachforderungVorbelegung (design.md D9)“ mit fünf Tests, darunter „Fehlmenge nur in einer Kostform: Anzahl ist die fehlende Sonderkost, Begründung nennt sie“ | — |
| 9 | Blickfeld | **erfüllt** | S4 führt „Nachforderung · Verpflegung · Material“ in einer Zeile: `stab/sachgebiete.test.ts` „S4 führt Nachforderungen, Verpflegung und Material“, „führt höchstens drei Werkzeuge je Zeile“ | — |
| 12 | Kein Sprung | **nicht anwendbar** | Der Sprung ist eine Nutzerhandlung, kein Live-Zufluss | — |
| 15 | **Erfassungsmaske vollständig** | **erfüllt** [abgeleitet] | Vorbelegt und einzeln überschreibbar: Art, Anzahl = Fehlmenge, Bezeichnung mit Zeitraum, Begründung. **Apply-then-clean:** Nach dem Sprung ist die Adresse `…/nachforderungen` ohne Parameter (Sichtprüfung). `NachforderungenPage.test.tsx` „öffnet die Erfassung vorbelegt und räumt die Adresse“, „eine unbrauchbare Vorbelegung wird ganz verworfen, die Erfassung öffnet leer“, „nach dem Absetzen füllt sich die Erfassung NICHT erneut mit der Vorbelegung“; `deeplinks.test.ts` › „deeplinks — Nachforderung mit Vorbelegung (LFH-634)“. Die einzeilige Begründung verbarg „Es fehlt Sonderkost: 8 vegan.“ (**Befund S2**). Seit dem Fix wächst das Feld bis vier Zeilen; die Vorbelegung umfasst rund 100 Zeichen und passt damit ganz hinein. Das ist aus Feldbreite und Zeilenzahl geschlossen und nicht erneut im Browser gemessen | — |
| — | Sichtbarkeit | **erfüllt** | „Nachfordern“ gibt es nur bei Fehlmenge und bedienbarem Modul Nachforderungen. Ohne das Modul wird nichts angefragt, an der Ausgabe steht „Nachforderung #n“ statt des Namens. `VerpflegungPage.test.tsx` „Modul ausgeblendet: keine Anfrage, kein „Nachfordern", nur „Nachforderung #n"“, „eine abgelehnte Liste (403) bleibt still: kein Fehler, nur „Nachforderung #n"“; `tests/verpflegung.rs` `ausgabe_mit_nachforderung_traegt_nur_die_kennung` | — |

## Außerhalb der 15 Kriterien

- **Offline/Netzverlust:** Ausgaben lassen sich offline nicht erfassen. Die Seite hat in v1
  keine Offline-Queue (design.md, Non-Goals) → LFH-688.
- **Rechte:** Der Beobachter liest, schreibt aber nicht; er sieht einen `RechteHinweis`, die
  Primäraktion ist gesperrt und die Karten haben keine Aktionen. Belege:
  `VerpflegungPage.test.tsx` „ohne Schreibrecht: Grund im Kopf, Primäraktion gesperrt, keine
  Kartenaktionen“, „ohne Schreibrecht im leeren Modul: Leerzustand ohne Aktion“;
  `tests/verpflegung.rs` `beobachter_liest_aber_schreibt_nicht`,
  `ausgeblendetes_modul_ist_403_fuer_mitglieder`, `abgeschlossener_einsatz_ist_409`,
  `live_ereignis_nur_an_leser_mit_modulrecht`. Im Browser mit einem angelegten Beobachter
  gesehen (Sichtprüfung).
