# Prüfliste Einsatztauglichkeit — Einsatztagebuch (LFH-342 · C7)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. C7 baut die **Seite ETB** an vier
Stellen um und fasst zusätzlich `pages/BefehlDetailPage.tsx` an; die Liste bewertet die Seite
als Ganzes und **schreibt die Vorgängerin aus B5e fort**
(`2026-07-30-etb-pruefliste.md`, 30.07.2026) statt sie zu wiederholen. Wo sich ein Verdikt
gegenüber dort ändert, steht der Grund dabei.

**Umfang:** `pages/EtbPage.tsx` mit `etb/EtbTabelle.tsx`, `etb/etbZeile.ts`,
`etb/EtbFilterleiste.tsx`, `etb/filterZeit.ts`, `etb/WiedervorlageModal.tsx`,
`routing/deeplinks.ts` · dazu `pages/BefehlDetailPage.tsx` (Befund N18) · unverändert
mitbewertet: `etb/Schnellerfassung.tsx`, `etb/MetaChip.tsx`, `etb/SlashMenu.tsx`,
`etb/BuchstabierHilfe.tsx`, `etb/entwuerfe/EtbEntwurfsTabs.tsx`.

**Gemessene Baseline am 21.08.2026:**

| Größe | vorher | nachher |
| --- | --- | --- |
| Breite des Meldungstextes im Fükw (1033 px Contentbreite, ModulPanel offen) | 149 px = 14 % (Ticket-Messung) | **≥ 50 %**, e2e-belegt · rechnerisch 1033 − (88+180+130+96) = **539 px = 52 %** `[abgeleitet]` |
| Abrufe je 13 getippter Zeichen im Volltextfeld | 13 | **≤ 2** (`EtbFilterleiste.test.tsx`, Fake-Timer) |
| Darstellungsformen der Chronologie | 1 (Tabelle auf jedem Schirm) | **2** (Tabelle ab `md`, Ereigniszeilen darunter) |
| Gepufferte Einträge in der Chronologie | 0 (nur Banner) | **alle**, Banner bleibt Zusammenfassung |
| Klein-Angaben auf interaktiven Elementen in `etb/` + `pages/EtbPage.tsx` (Scan-Funktion des Dichte-Guards) | 0 (seit B5e) | **0** |
| Vitest-Fälle auf `etb/` + `pages/EtbPage.tsx` (gezählt, beide Stände gefahren) | 172 in 18 Dateien | **205 in 21 Dateien** |
| Vitest-Fälle auf `pages/BefehlDetailPage.tsx` | 4 | **11** |
| Katalogtabellen-Inventar (`katalogTabelle.guard.test.ts`) | 18 + ETB als Restposten AP8 | **18**, ETB nach oben herausgefallen |

---

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche | **erfüllt** | Unverändert gegenüber B5e: kein Element im Umfang trägt eine Klein-Angabe, alle erben `controlHeight` (30 / 48 / 72 px). C7 fügt vier Auslöser hinzu, alle ohne `size`-Prop: die vier Schnellwahl-Knöpfe der Wiedervorlage, „Erneut senden" und „Verwerfen" an einer abgelehnten Zeile. Der Kartenzweig baut seine Zeile selbst, seine Aktionen sind aber dieselben antd-`Button` wie im Tabellenzweig — dieselbe Funktion `zeilenAktionen`, damit die Zweige nicht auseinanderlaufen. **Grenze unverändert:** `test/utils.tsx` mountet ein nacktes `ConfigProvider`, Höhenmessungen in Vitest ergäben antd-Vorgaben; die Staffel misst `e2e/datensicht-schmal.spec.ts` am Primitiv |
| 2 · Handschuh-Modus | **teilweise erfüllt, unverändert** | Die Stufe greift auf der ganzen Seite. Offen bleibt dasselbe wie in B5e: die Ableitung der Stufe aus dem Einsatzkontext hängt an `localStorage['lifeline-hub.dichte']` (B5-Restpunkt), und die gerenderte Zeilenhöhe der ETB-Fläche ist nur im Browser messbar → **LFH-373**. C7 verschlechtert nichts und misst es auch nicht neu: die neue e2e-Spec prüft Breiten, nicht Höhen |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt, verbessert** | Bestand unverändert (`isPending` an Abschluss, Nachladen, Auftragsmodal; `ladend` bis an die Chronologie). **Neu:** ein gepufferter Eintrag ist jetzt selbst die Rückmeldung — er steht als Zeile mit dem Etikett „wird gesendet …" in der Chronologie, statt nur in einem Banner darüber. Das ist die Rückmeldung an dem Ort, an dem der Erfasser das Ergebnis erwartet. Optimistische Updates gibt es weiterhin nicht → **B6 (LFH-334)**. **Neu am Befehlsentwurf:** der stille Autosave meldet sich nicht per Toast (eine Meldung alle 30 s wäre eine Alarmquelle nach EEMUA 191), sondern über den Zeitstempel „zuletzt gespeichert HH:MM" neben dem Knopf — der Fehlerfall dagegen meldet sich sehr wohl |
| 4 · Kritische Aktion hat eine zweite Handlung | **erfüllt** | Das Tagebuch bleibt append-only. **Neu bewertet — „Verwerfen" an einer abgelehnten Zeile ist unumkehrbar** und trägt trotzdem keine Rückfrage: der Eintrag wurde vom Server bereits **abgelehnt und nicht gespeichert**, verworfen wird also eine gescheiterte Sendung, nicht ein Datensatz. Die Umkehrung steht als „Erneut senden" unmittelbar daneben, und beide stehen offen statt in einem Menü — eine Ablehnung verlangt eine Entscheidung. Nach der Trennlinie aus LFH-363 wäre eine zusätzliche Rückfrage hier Reibung ohne Schutzwirkung. **Neu am Befehlsentwurf:** der Verlust-Fall, den N18 beschreibt, ist die kritische Stelle — der Schutz ist der Autosave selbst plus `beforeunload` |
| 5 · Kontrast in beiden Modi | **erfüllt für C7, ein Bestandsbefund unverändert** | C7 führt **keinen** Farbwert ein. Die Marken der gepufferten Zeilen kommen aus `StatusTag` mit den Rollen `achtung` (ausstehend) und `alarm` (abgelehnt), also aus `theme/statusFarben.ts`; die gestrichelte Zeilenmarkierung nimmt `colorSplit`/`colorBorder` aus dem Token, keinen Hexwert. `theme/gate5.guard.test.ts` ist grün. **Bestandsbefund unverändert:** `.etb-erfassung-sticky` (`index.css:51-66`) hält vier hartkodierte Werte → **LFH-375** |
| 6 · Kein Status allein über Farbe | **erfüllt** | Jede neue Zustandsaussage trägt ein Wort: „wird gesendet …", „abgelehnt", „Nachtrag" (aus B5e). `StatusDarstellung.label` ist Pflichtfeld, die Farbe ist der zweite, nicht der erste Kanal. Die Kennungsspalte einer gepufferten Zeile trägt bewusst **kein** „—" und keine erfundene Nummer, sondern das Zustandsetikett: die laufende Nummer vergibt der Server, und ihr Fehlen ist die Aussage |
| 7 · Eine Farbe = eine Bedeutung | **erfüllt** | Keine neue Farbbelegung. Das einzige neue `danger` ist „Verwerfen" an der abgelehnten Zeile — Gefahr, nicht Bedienung —, und es steht in einer `<Space size="middle">` neben „Erneut senden", also mit dem Abstand aus LFH-363. Der Guard `aktionsabstand.guard.test.ts` sieht `etb/EtbTabelle.tsx` heute nicht (er ist auf die in LFH-363 bewerteten Dateien gescopt); die Angabe steht trotzdem, weil die Regel gilt und nicht der Scanner |
| 8 · Helligkeits-/Kontrastregler | **offen, unverändert** | Weiterhin keiner in der Anwendung → **LFH-397**, app-weit |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt, verbessert** | Der Erfassungskopf bleibt oben und sticky, die Chronologie darunter. **Neu:** was noch nicht gesendet ist, steht am **Kopf** der Chronologie (abgelehnt vor ausstehend vor gesendet) — die Liste läuft neueste-zuerst, und ein ungesendeter Eintrag ist der jüngste. Vorher stand er nur im Banner und in der Chronologie gar nicht; wer das Tagebuch las, sah einen Stand ohne die eigene gerade erfasste Meldung. Die Fehlermeldung des Abrufs steht weiter **über** der Liste und tauscht sie nicht aus. **Abweichung von der B5e-Zeile 9 („das Zeilenmenü sitzt am rechten Zeilenende, wo es vorher auch saß"), damit die beiden Listen nicht als Widerspruch gelesen werden:** im **Kartenzweig** steht das Menü **unter** dem Meldungstext, nicht daneben. Absicht — neben ihm nähme es genau die Breite weg, für die dieser Umbau gebaut ist. Im Tabellenzweig sitzt es unverändert rechts |
| 10 · Alarmbudget | **nicht anwendbar, unverändert** | Das Tagebuch erzeugt keine Alarme. Die Wiedervorlage legt eine Erinnerung an; deren Fälligkeits-Verhalten gehört dem Erinnerungs-Scheduler. **Randnotiz zu C7:** die Vorgabe „+30 min" statt „jetzt" senkt die Zahl sofort fälliger Erinnerungen — bisher war jede beim Anlegen bereits überfällig |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton. Die Offline-Zustände stehen doppelt: als Alert (Zusammenfassung) und als Zeile (Ort). Das ist Absicht und eigens getestet — ein Test, der nur die Zeile prüft, ließe das Entfernen des Banners unbemerkt durch |
| 12 · Kein Sprung unter dem Cursor | **erfüllt — die Bestandslücke aus B5e ist geschlossen** | B5e führte hier „offen, Bestand: neue Einträge fahren über den SSE-Fan-out direkt in die Liste, ohne Sammelbanner → B6". Mit dem Umbau auf `Datensicht` gilt jetzt dessen Zusicherung 5: bei `zufluss: 'sammelbanner'` (Vorgabe) sind Zeilenmenge und -reihenfolge eingefroren, **solange der Fokus in der Sicht liegt**; Zellinhalte laufen weiter, Zufluss erscheint als Banner in der Werkzeugzeile. Im Betrieb liegt der Fokus beim Erfassen in der Schnellerfassung, also außerhalb — eine dort erfasste Meldung erscheint sofort, und genau das ist eigens geprüft (`EtbTabelle.test.tsx`, „nimmt eine nachträglich eintreffende Zeile auf"). **Benannt und in Kauf genommen, unverändert aus B5e:** die Chip-Leiste des Erfassungskopfs kann im Handschuh-Betrieb auf 390 px umbrechen und den sticky Kopf wachsen lassen; nicht gemessen → **LFH-373** |
| 13 · Fokus nie verdeckt | **offen, unverändert** | Die Seite trägt das einzige `position: sticky` des Frontends. C7 verbessert die Lage im Kartenzweig (die Zeile ist kein Tabellen-Scrollcontainer mehr, der Fokus kann nicht in einer inneren Scrollregion hinter dem Kopf landen), misst es aber nicht → **LFH-373** |
| 14 · Tabellenseite vollständig | **erfüllt — die zwei offenen Punkte aus B5e sind eingelöst** | Über `Datensicht` → `KatalogTabelle`: Scrollcontainer, stehende Kopfzeile, fixierte **menschenlesbare** Kennung ✓. **Neu (a):** der **Spaltenschalter mit Zähler ausgeblendeter Spalten** existiert jetzt — er war der offene Punkt der B5e-Zeile 14 (**LFH-374**) und ist der Träger der ≥50-%-Zusicherung: `Von → An` und `Erfasser` tragen `abBreite: 'xxl'`, sind bei 1366 px aus, werden als „2 ausgeblendet" gezählt und lassen sich von Hand einblenden. Beide Ausblendungsgründe laufen durch dieselbe Funktion, der Zähler kann also nicht lügen. **Neu (b):** die Chronologie löst sich unter `md` in Ereigniszeilen auf. Das ist die **begründete Ausnahme** zu „keine Auflösung in Karten" — die Begründung steht unten in eigenem Abschnitt, und sie ist eine **Korrektur** des B5e-Verdikts („die Chronologie wird verglichen, sie bleibt eine Tabelle") |
| 15 · Erfassungsmaske vollständig | **erfüllt, erweitert** | Die Schnellerfassung steht seit LFH-332/B4 auf dem Erfassungsvertrag (Bewertung dort, `2026-07-29-schnellerfassung-pruefliste.md`). **Neu von C7:** `etb/WiedervorlageModal.tsx` ist von einem handgebauten `<Modal onOk>` + `<Form>` auf `ErfassungsModal` gezogen — Absende-Knopf im Formular (Enter sendet, strukturell geprüft), Rücksetzen auf allen vier Auswegen, `mutateAsync` statt `mutate`, also bleiben die Eingaben bei einem 422 stehen. Das Feldbudget bleibt bei drei; die Schnellwahl ist eine Vorbelegung desselben Feldes, kein viertes |

**0 Zeilen ohne Verdikt.** Zwei offene, eine teilweise erfüllte — jede mit Ziel:

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 2, 12, 13 | Dichtestufe aus dem Einsatzkontext; gerenderte Zeilenhöhe und Fokusverdeckung am sticky Kopf | **LFH-373** — Ticket existiert |
| 8 | kein Helligkeitsregler in der Anwendung | **LFH-397**, app-weit |
| 5 | vier Hexwerte in `.etb-erfassung-sticky` | **LFH-375** — Ticket existiert |

---

## Die begründete Ausnahme: warum die Chronologie unter `md` Karten wird

CLAUDE.md und A1/Festlegung 2 sagen: „Auf schmalem Schirm wird eine Tabelle **angepasst,
nicht in Karten aufgelöst** — Karten-Fallback ist die Ausnahme mit Begründung im Task." Die
B5e-Prüfliste hat für das ETB entschieden „die Chronologie wird verglichen, sie bleibt eine
Tabelle". **C7 dreht das um, und zwar mit Beleg statt mit Geschmack:**

1. **Die Formfrage ist „wird verglichen oder wird gelesen?"** (LFH-330/B2). Ein Tagebuch wird
   **gelesen** — die Frage lautet „was ist passiert?", nicht „welcher von diesen Einträgen ist
   der richtige?". Es gibt keine Sortierung, keinen Spaltenfilter und keine Suche über die
   Spalten; die Ordnung ist die Zeit, und die ist serverseitig festgelegt.
2. **Das ETB stand nie im Katalogtabellen-Inventar.** `katalogTabelle.guard.test.ts` führte es
   ausdrücklich als „neunzehnte Konsumentin … steht bewusst NICHT hier" und ihre Aufnahme als
   benannten Restposten **LFH-330 · AP8**. Der Satz „Keine der 13 Katalogtabellen wird zu
   Karten" trifft es also nicht — es war keine der dreizehn.
3. **Die Zahl:** sieben Spalten mit 884 px festem Gerüst gegen 278 px verfügbare Breite bei
   390 px. Eine Anpassung innerhalb der Tabelle heißt dort Scrollen in beide Richtungen an
   einem Text, der die eigentliche Aussage trägt.

**Und der Kartenzweig ist ein Eigenbau** (erster und einziger Eintrag in `KARTEN_EIGENBAU`).
Auch das ist begründungspflichtig und hier gemessen: der Plan-Modus des Primitivs trägt Titel
+ Status + höchstens **drei** Sekundärfelder + genau **eine** Primäraktion. Die Ereigniszeile
braucht fünf Kopffelder, einen Markdown-Block über die volle Breite und **drei**
Zeilenaktionen. Im Plan-Modus fielen Berichtigen, Wiedervorlage und Auftrag unter `md`
ersatzlos weg — an einer beweissichernden Fläche kein hinnehmbarer Verlust.

Was der Eigenbau dafür selbst tragen muss, ist eine gemessene Falle und steht im Dateikopf von
`etb/EtbTabelle.tsx`: `Datensicht` gibt beim Eigenbau `karte.render(...)` **roh** zurück, der
Wrapper mit Klasse und Marke entsteht nur im Plan-Modus. Ohne
`data-lfh="datensicht-karte"` fände `scrolleZurZeile` die Karte nicht, und der Deeplink
`?eintrag=` liefe unter `md` still ins Leere — genau auf dem Gerät, auf dem eine lange Liste
am wenigsten überschaubar ist.

## Wo dieses Ticket dem Ticket-Text widerspricht

Vier Stellen, jede mit Messung — Entscheidungen, keine Auslassungen.

1. **„≥ 44 × 44 px" ist durch die Dichte-Staffel abgelöst.** Seit LFH-333/B5 misst ein
   korrekter Knopf in der Vorgabestufe `kompakt` **30 px**; 48 px gilt für `komfortabel`,
   72 px für `Handschuh` (MIL-STD-1472F Fig. 12). Ein e2e gegen 44 px wäre rot ohne Fehler im
   Code. Die tragfähige Zusicherung lautet „gleich `controlHeight` der aktiven Stufe" und wird
   am Primitiv gemessen (`e2e/datensicht-schmal.spec.ts`).
2. **„`grep -rn 'size=\"small\"' frontend/src/etb/` liefert 0 Treffer" ist wörtlich
   unerfüllbar.** Der einzige Treffer (`etb/MetaChip.tsx:76`) ist **Prosa in einem
   Blockkommentar**, die erklärt, warum die Angabe weg ist. Der AST-Scanner des Dichte-Guards
   meldet für `etb/` **0** interaktive Verstöße. Das ist dieselbe Falle wie in
   `gate-kommentar-fuellt-eigenes-gate`: ein Grep-Kriterium zählt seine eigene Begründung mit.
3. **`erfasst_lokal_at` gibt es an einem gepufferten Eintrag nicht.** Der Zeitstempel heißt
   `erstellt_at` (`offline/queue.ts:59`, `AusstehenderEintrag`); `erfasst_lokal_at` ist ein
   Feld des **gesendeten** Eintrags.
4. **Der Router-Blocker aus dem N18-Punkt ist nicht gebaut, und das ist gemessen.**
   `useBlocker` verlangt einen **Data Router**; die Anwendung hängt an `<BrowserRouter>`
   (`main.tsx:37`), und der Aufruf wirft dort beim Rendern („useBlocker must be used within a
   data router") — nicht erst im Blockierfall. Die Umstellung auf `createBrowserRouter`
   betrifft die gesamte Routenlandschaft und ist keine Nebenwirkung eines
   Befehlsentwurf-Punkts. Gebaut ist stattdessen, was den Verlust praktisch verhindert:
   Autosave bei jedem Feld-Blur (ein Klick auf die Brotkrume verlässt das Feld zuerst) plus
   Frist alle 30 s, dazu `beforeunload` für Reload und Tab-Schluss — mit Gegenaussage, dass er
   ohne offene Fassung schweigt.

## Nicht gebaut, mit Begründung

- **„Nächste Lagebesprechung" als Wiedervorlage-Schnellwahl.** Das Frontend kennt keine Quelle
  für den nächsten Besprechungstermin (`grep -rn "lagebesprechung" frontend/src` = 0 Treffer).
  Ein Chip, der raten müsste, wäre in einer beweissichernden Anwendung eine falsche
  Tatsachenbehauptung → Nachzug.
- **`an` aus dem Einsatz-/Benutzerkontext vorbelegen** (Teil von H61). Gemessen: weder
  `BenutzerAnzeige` noch `EinsatzAnzeige` trägt eine Führungsstelle
  (`api/types.generated.ts:242` bzw. `:536`); `meldende_stelle` ist die Stelle, die den Einsatz
  gemeldet hat, nicht die eigene. Die Vorbelegung braucht ein Backend-Feld → Nachzug. **Der
  Kern von H61 ist davon unberührt:** „Werte behalten" hält `von`/`an`/`meldeweg` über das
  Absenden (LFH-332/B4), das Ziel „1 Anschlag je Folgeeintrag" gilt ab dem zweiten Eintrag.
- **Umbruchpunkt `lg` statt `md`.** Die Formachse der `Datensicht` kennt genau einen
  Umbruchpunkt (`Datensicht.tsx:1049`). Der Bereich zwischen `md` (768) und `lg` (992) ist von
  keinem Akzeptanzkriterium adressiert — die Zusicherungen liegen bei 390 px und 1366 px —,
  und eine zweite Umbruchachse im Primitiv wäre eine Änderung an allen elf Konsumenten für
  einen ungeprüften Zwischenbereich → Nachzug, falls das Führungs-Tablet quer die Karten
  braucht.

## Offene Nachzüge

1. **Führungsstelle am Benutzer oder Einsatz** (Backend-Feld + Codegen), damit der `an`-Chip
   beim ersten Eintrag vorbelegt werden kann → **LFH-461**.
2. **Router-Blocker** — verlangt die Umstellung auf `createBrowserRouter`; app-weit →
   **LFH-462**.
3. **„Nächste Lagebesprechung"** als Termin-Quelle, dann als fünfter Schnellwahl-Chip →
   **LFH-463**.
4. **Zweiter Umbruchpunkt an der `Datensicht`**, falls der Bereich `md`–`lg` Karten braucht →
   **LFH-464**.
