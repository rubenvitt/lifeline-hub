# Prüfliste Einsatztauglichkeit — Gefahrenmatrix (LFH-368 · B5h)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. B5h baut die **Seite Gefahren** an
ihrer Kernstelle um — der Bewertung einer Zelle — und zieht dabei die Flächenfarbe in den
Farbvertrag. Die Liste bewertet deshalb die Seite als Ganzes und nennt in jeder Zeile, was von
diesem Bündel kommt und was Bestand ist.

**Umfang:** `pages/gefahren/GefahrenPage.tsx` mit `pages/gefahren/GefahrenMatrix.tsx`,
`pages/gefahren/GefahrenZelleDetails.tsx` und `pages/gefahren/gefahrenSchema.ts` · die
Farbträger `theme/statusFarben.ts` (`warnstufeFlaeche`, `flaechenFarbe`,
`Flaechendarstellung`) und die vier Füllungsrollen in `theme/tokens.ts`.

**Gemessene Baseline am 30.07.2026** (mit der Scan-Funktion des Dichte-Guards selbst
— `stellenIn` aus `components/dichte.guard.test.ts` —, nicht per Grep und nicht
fortgeschrieben):

| Größe | vorher | nachher |
| --- | --- | --- |
| Klein-Angaben auf interaktiven Elementen in `pages/gefahren/` | 5 in 2 Dateien | **0** |
| davon in `GefahrenMatrix.tsx` | 4 (2× `Button`, 1× `Select`, 1× `Table`) | **0** |
| davon in `GefahrenPage.tsx` | 1 (`Button`) | **0** |
| Schuldzeilen für B5h in `dichte.guard.test.ts` | 2 | **0** |
| Restschuld des Guards über das ganze Frontend | 24 in 13 Dateien | **19 in 11 Dateien** |
| Auslöser je bedienbarer Zelle | 2 (`Select` + Icon-Knopf für den Popover) | **1** |
| Breite des Zellinhalts | `Select` mit festem `width: 110` | **`minWidth: token.controlHeight`** (30 / 48 / 72) |
| Verhaltensfälle in `pages/gefahren/*.test.tsx` | 11 | **28** |
| Quelltext-Zusicherung auf die stehende Kopfzeile | 0 | **1** (mit Mutationsprobe) |
| Zusicherungen auf die kurze Achse des Zell-Auslösers | 0 | **4** (mit drei Proben) |

Die `Liste size="small"` in `GefahrenPage.tsx` zählt in keiner der beiden Spalten mit und ist
**keine Restarbeit**: `Liste` steht in `EIGENE_SEMANTIK` des Guards, dort ist `size` ein
Abstandsmaß der Karte und keine Trefffläche. Die Regel steht in CLAUDE.md, der Beleg über
mehrere Dichtestufen in `components/Liste.test.tsx`.

**Nicht in der Tabelle, weil nicht messbar:** die gerenderte Gesamtbreite einer Zelle. jsdom
rechnet kein Layout, und mit dem `size="small"` am `<Table>` ist auch die Zellpolsterung
gewechselt. Belegbar ist, was im Quelltext steht — der feste 110-px-Kasten ist weg, die Breite
hängt jetzt an derselben Achse wie die Höhe.

---

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche<br>*WCAG 2.5.8 AA (≥ 24 × 24 px), WCAG 2.5.5 / Material 48 dp (zeitkritisch ≥ 48 × 48 px, ≥ 8 px Abstand)* | **erfüllt, mit einer benannten Belegbarkeitsgrenze** | Der einzige Auslöser je Zelle trägt **keine** Größen-Prop und erbt `controlHeight` — 30 / 48 / 72 px. Vorher standen in jeder der 58 bedienbaren Zellen **zwei** Ziele, beide auf der Kleingröße festgenagelt: ein `<Select size="small" style={{ width: 110 }}>` für die Stufe und ein icon-only `<Button size="small" type="text">` für den Detail-Popover. Der neue Auslöser trägt zusätzlich `style={{ minWidth: token.controlHeight }}` — bei einem Knopf, dessen Inhalt ein einzelner Buchstabe ist, entscheidet das über die **Breite** des Ziels, nicht bloß über die Höhe (WCAG 2.5.8 fordert 24 × 24, nicht 24 hoch). Dass dieser Wert wirklich im Baum ankommt **und mit der Dichtestufe wechselt**, ist seit dem Abschluss-Review zugesichert (eigener `describe`-Block in `GefahrenMatrix.test.tsx`, drei Proben unten). **Grenze:** kein gerendertes Pixel ist belegt. `test/utils.tsx` mountet ein nacktes `ConfigProvider` ohne Theme, jede Höhenmessung dort ergäbe antd-Vorgaben → **LFH-373** |
| 2 · Handschuh-Modus<br>*MIL-STD-1472F Fig. 12 (≥ 72 px ≙ 19,05 mm [abgeleitet]); Abstand ≥ 16 px [abgeleitet aus Fig. 24, last contact]* | **teilweise erfüllt** | Die Dichtestufe greift auf der ganzen Seite durch: kein Element im Umfang hält seine Größe mehr fest, weder die Matrix noch der Karten-Knopf im Kopf. Der Zell-Auslöser folgt der Staffel in **beiden** Richtungen — das ist der Punkt, an dem 65 Zellen im Handschuh-Betrieb nicht mehr in einen 110-px-Kasten gezwängt bleiben, der für 24 px entworfen war. **Offen bleibt zweierlei:** die tatsächlich gerenderte Höhe ist nur im Browser messbar (jsdom rechnet kein Layout; belegt ist die Absicht, nämlich das Fehlen jeder punktuellen Größen-Prop) → **LFH-373**; und die Ableitung der Stufe aus dem Einsatzkontext hängt weiter an `localStorage['lifeline-hub.dichte']` mit Vorbelegung über die Zeigerart (LFH-361/B5a) → **B5-Restpunkt (LFH-333)** |
| 3 · Rückmeldung vor der Serverantwort<br>*MIL 5.4.6.4 (≤ 100 ms), Tab. XXII (Kommandoreaktion ≤ 2 s), MIL 5.14.9 (> 15 s nur mit Fortschritt)* | **erfüllt, und hier liegt eine der beiden Kernverbesserungen** | Vorher sperrte ein `pending: boolean` **alle** 58 bedienbaren Zellen, solange irgendein PUT unterwegs war — ein Vollstopp pro Klick in einer Maske, die im Minutentakt bedient wird. Jetzt trägt `laufendeZelle` die Kennung genau der Zelle, deren PUT läuft (`zellSchluessel`, aus `setzen.variables` von TanStack Query — kein Parallel-State, der auseinanderlaufen kann); gepinnt von „sperrt beim laufenden PUT NUR die betroffene Zelle, nicht die anderen 57". Der Detail-Dialog reicht denselben Zustand als `laeuft` an die Erfassungshülle, die ihn am Absende-Knopf zeigt. Fehler kommen als Toast (`onError`). **Offen:** optimistische Updates gibt es im ganzen Repo nirgends → **B6 (LFH-334)** |
| 4 · Kritische Aktion hat eine zweite Handlung<br>*MIL 5.4.6.6* | **erfüllt — die Seite trägt keine unumkehrbare Aktion** | Eine Warnstufe zu setzen ist vollständig umkehrbar: alle fünf Stufen einschließlich „keine" stehen im selben Menü, der Rückweg ist derselbe Klick. Das Umbenennen eines Gefahrengebiets ist ein Inline-Edit mit demselben Weg zurück. **Gelöscht wird hier gar nichts** — ein Gefahrengebiet entsteht und vergeht auf der Lagekarte, nicht auf dieser Seite (der Leerzustand sagt das und führt dorthin). Nach der Trennlinie aus LFH-363 (umkehrbar → Abstand ja, zusätzliche Reibung nein) wäre eine Rückfrage hier **falsch, nicht fehlend**. Entsprechend gibt es auf der Seite kein `danger` und kein `Popconfirm` — **gemessen: 0 Vorkommen von `danger` in `pages/gefahren/`**. Daraus folgt bewusst ein Nicht-Eintrag: CLAUDE.md sagt, `components/aktionsabstand.guard.test.ts` wachse mit den Bündeln B5d–B5j, und B5h liegt in dieser Reihe. Seine `MIT_NACHBARSCHAFT` ist aber eine **Soll**-Liste, die tote Einträge meldet (Gegenstück zur toten Schuld-Ausnahme des Dichte-Guards) — `pages/gefahren/` dort einzutragen behauptete eine Deckung ohne Gegenstand und färbte den Guard rot. B5h trägt keine danger-Nachbarschaft, deshalb kein Eintrag |
| 5 · Kontrast in beiden Modi<br>*MIL 5.2.4.2.2.2; WCAG 1.4.6/1.4.3 (Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1); Zustände, Rahmen, Fokusring ≥ 3 : 1 (WCAG 1.4.11)* | **teilweise erfüllt — ein Nachweis steht ausdrücklich offen** | Alle Farbwerte kommen aus `theme/tokens.ts`; `theme/gate5.guard.test.ts` ist grün. B5h **verbessert** die Lage grundlegend: die Flächenfarben lagen vorher als Pastell-Literale in `pages/` und hatten **kein Nachtmodus-Paar** — im Dunkelmodus standen dort vier grelle Helligkeitsblöcke. Jetzt tragen sie vier benannte Füllungsrollen mit je einem Wert pro Modus. **Nicht gemessen und deshalb nicht als erfüllt gezählt:** der Kontrast des **Kürzels auf der Füllung**. Die Deckkräfte (hell 7–8 % für die leichte, 20 % für die starke Stufe; dunkel 10 % und 24 %) sind eine **begründete Setzung, kein Messwert** — jsdom rechnet keine Farbmischung, und eine Deckkraft über einer Tabellenzeilen-Grundfläche ergibt erst im Browser einen Farbwert. → **LFH-370 (B5j)**, mit dem Vorbehalt unten: das Ticket führt heute **keinen** Kontrastpunkt und muss einen bekommen |
| 6 · Kein Status allein über Farbe<br>*WCAG 1.4.1 Level A; MIL 5.4.6.8; 1 von 12 Männern (NEI)* | **erfüllt — und das ist die zweite Kernverbesserung** | Zwei Kanäle an jeder Zelle: das **Kürzel** (`N`/`M`/`H`/`A`) steht sichtbar im Auslöser, das **Stufenwort** im zugänglichen Namen („Bewertung Brand × Menschen: hoch"). Das ist hier nicht Kür, sondern konstruktiv notwendig: zwei Paare der fünf Stufen teilen sich denselben Farbton in zwei Intensitäten (niedrig/mittel auf `achtung`, hoch/akut auf `alarm`) — die Fläche allein könnte sie auch bei perfektem Farbsehen nicht trennen. Belegt von „zeigt die Stufe als Kürzel — die Fläche allein wäre der einzige Kanal". Die **7 ungültigen Kombinationen** tragen „n. a." als **Text** statt Blässe: eine ausgegraute Fläche ohne Wort ist von „noch nicht bewertet" nicht zu unterscheiden — und sie tragen bewusst **keinen** deaktivierten Knopf, der vorgäbe, es gäbe hier eine Entscheidung. Die Gebietsliste zeigt die höchste Warnstufe als `<Tag>` **mit** Wort |
| 7 · Eine Farbe = eine Bedeutung<br>*ASM Consortium (gesättigte Farbe nur für abnorme Zustände, Grundfläche aus A0)* | **erfüllt** | Fünf Warnstufen laufen auf **drei** Töne (`achtung`, `alarm`, leer) — es entsteht keine sechste Farbe, obwohl fünf Flächen gebraucht werden. Zwei Sortenverwechslungen sind dabei behoben: die Auswahl in der Gebietsliste stand als hartkodiertes `rgba(22,119,255,0.08)` da (antds Blau, im Nachtmodus derselbe helle Schleier auf dunklem Grund) und nimmt jetzt `token.colorPrimaryBg`, also die Rolle `bedien`; das Etikett nahm `warnstufeFarbe` — eine Flächensorte an einem Etikett — und nimmt jetzt `rollenFarbe(warnstufeKarte[…])`. Das ist dieselbe Verwechslung, die LFH-328 in `ZonenInspector.tsx` behoben hat. **Rot bedient nichts:** der einzige rote Kanal der Seite ist die Warnstufe selbst |
| 8 · Helligkeits-/Kontrastregler<br>*MIL 5.2.2.1.9, 5.2.4.2.2.3 (1 Regler, 1 Sperre gegen Dimmen bis AUS)* | **offen** | Es gibt in der ganzen Anwendung keinen; A0 hat ihn ausdrücklich weiterverwiesen → **eigener Folge-Task aus A0** („Was diese Leitlinie nicht entscheidet"). Nicht von dieser Seite verursacht und auf ihr nicht lösbar |
| 9 · Kritische Anzeigen im Blickfeld<br>*MIL 5.2.2.1.7 (innerhalb 15° der normalen Blickachse, nicht am Layoutrand)* | **erfüllt** | Ab `lg` liegen Gebietsliste und Matrix nebeneinander, darunter gestapelt — und zwar mit der **Liste zuerst**: die Wahl des Gebiets geht der Bewertung voraus, die Reihenfolge im DOM ist die Reihenfolge der Handlung. Die Kopfzeile der Matrix bleibt beim Rollen stehen (`sticky`, neu in diesem Bündel) und die Kennungsspalte links fixiert — die Zuordnung „welche Gefahr, welches Schutzobjekt" geht also auch bei 13 Zeilen auf schmalem Schirm nicht verloren. Der Lesezugriffs-Hinweis und die Fehlermeldung des Abrufs stehen **über** der Matrix, nicht am Layoutrand |
| 10 · Alarmbudget<br>*EEMUA 191 S. 96/97; ISA-18.2 (1–2 je 10 min, ≤ 3 Eskalationsstufen)* | **nicht anwendbar** | Die Seite erzeugt keine Alarme, sie trägt eine Bewertung ein. Ein Warnstufen-Wechsel löst weder Ton noch Benachrichtigung aus; die Alarmwege des Einsatzes liegen in `einsatz/AlarmZentrale.tsx` und werden von hier nicht berührt |
| 11 · Warnverhalten<br>*MIL 5.2.1.5.5.3/.4/.5, 5.3.6.3 (kein Blinken auf lesbarem Text, ≤ 2 Blinkraten, quittierbar, jeder Ton mit visueller Entsprechung)* | **erfüllt** | Kein Blinken, keine Blinkrate, kein Ton, keine Animation auf der Fläche. Die Warnstufe ist ein **stehender Zustand** und wird als solcher dargestellt — genau das, was MIL 5.2.1.5.5.3 für lesbaren Text verlangt |
| 12 · Kein Sprung unter dem Cursor<br>*CLS ≤ 0,1 (75. Perzentil, web.dev); WCAG 3.2.5 / G76 (neue Datensätze nur als opt-in-Sammelbanner)* | **teilweise erfüllt — die Lage ist eine ANDERE als beim ETB** | Die Matrix ist ein **festes 13 × 5-Raster**. Ein Live-Update über den SSE-Fan-out (`gefahr` → `gefahrenmatrix` + `gefahrengebiete`, `api/queryKeys.ts:93`) färbt eine Zelle um; es kommt keine Zeile hinzu, keine Spalte verschwindet, und die Zellbreite hängt an einem Token statt am Inhalt. Ein Sammelbanner wäre hier die falsche Antwort — es gibt nichts einzuschieben. **Was sehr wohl unter dem Cursor wachsen kann, ist die Gebietsliste links:** ein auf der Lagekarte gezeichnetes Gefahrengebiet erscheint über denselben Fan-out als neue Zeile und schiebt die darunter. Das ist der Bestandsfall → **B6 (LFH-334)**. Zweite, **nicht gemessene** Bewegung: der Umbruch bei ~390 px (Liste auf volle Breite, Matrix darunter). Belegt ist die Absicht — `flexDirection` je Breite, zwei Tests bei 800 und 1280 px —, nicht ein CLS-Wert → **LFH-373** |
| 13 · Fokus nie verdeckt<br>*WCAG 2.4.11 AA (0 vollständig verdeckte Fokusziele beim Tab-Durchlauf)* | **offen → LFH-373** | Ehrlich gesagt: **dieses Bündel führt den fraglichen Aufbau erst ein.** Vorher hatte die Matrix keine stehende Kopfzeile, jetzt hat sie eine; die fixierte erste Spalte hatte sie schon. Das sind genau die zwei Konstrukte, auf die WCAG 2.4.11 zielt, und ein Tab-Durchlauf über 58 Zell-Auslöser dahinter ist eine **Messung wert, keine Annahme**. Der Messapparat existiert bereits (`e2e/fokus-verdeckung.spec.ts` mit `pruefeFokusVerdeckung`), fährt aber `/admin/benutzer` und `/einsaetze/:id/personal` — **die Gefahren-Route ist nicht darunter**, und die Matrix ist ein rohes `<Table>`, die dortige Messung überträgt sich also nicht. Das Gegenargument (die Tabelle rollt in einem eigenen Container mit `scroll={{ x }}`) spricht für die Erfüllung und zählt gerade deshalb nicht als Beleg |
| 14 · Tabellenseite vollständig<br>*NN/g Data Tables / Mobile Tables* | **erfüllt, mit einer begründet nicht anwendbaren Teilforderung** | **Fixierte Kopfzeile ✓ — neu in diesem Bündel** (`sticky`) und seit LFH-368 nicht mehr bloß behauptet: `katalogTabelle.guard.test.ts` prüft den Prop im Quelltext, mit Mutationsprobe belegt. Damit ist der **benannte Restposten aus LFH-330 eingelöst**; die Freistellung vom Roh-`Table`-Verbot bleibt, weil die Sorte bleibt. **Fixierte menschenlesbare Kennungsspalte ✓** — `{ title: 'Gefahr', dataIndex: 'label', fixed: 'left' }` trägt das Gefahrentyp-Label, nie eine DB-`id` (`rowKey="typ"` ist der Enum-Wert und kein Anzeigetext). **Keine Auflösung in Karten ✓**, und das ist die eigentliche Entscheidung dieser Zeile: die Matrix ist eine **Flächencodierung über zwei Achsen**, kein Listenvergleich. Karten je Gefahrentyp wären 13 Karten mit je 5 Feldern und zerstörten genau die Eigenschaft, für die es die Matrix gibt — das Muster über beide Achsen auf einen Blick. Gestapelt wird deshalb der **Seitenrahmen** (Liste über Matrix), nicht die Matrix; sie liegt mit **einem** Auslöser je Zelle im Breitenbudget und trägt waagerechten Bildlauf statt eines zweiten Layouts. Ein `Collapse` je Gefahrentyp wäre eine zweite Bedienform für dieselbe Sache; der Kommentar an `GefahrenPage.tsx` verweist auf diese Zeile. **Umschaltbarer Spaltensatz mit Zähler → nicht anwendbar:** die fünf Spalten **sind** die zweite Achse. Eine ausgeblendete Spalte ist kein weggelassenes Detail, sondern ein weggelassenes **Schutzobjekt** — das Artefakt wäre unvollständig, und ein Zähler daneben reparierte das nicht. Kein Schuldposten, deshalb auch kein Ticket |
| 15 · Erfassungsmaske vollständig<br>*MIL 5.14.7.1/.3 (Defaults), 5.14.7.4 („Speichern und nächsten anlegen"), DWP „Add another thing", Penzo (Labels über dem Feld), WCAG 2.1.1 (volle Tastaturbedienung)* | **erfüllt für die anwendbaren Teilforderungen** | **Nicht mehr „nicht anwendbar":** der Detail-Dialog läuft seit diesem Bündel über `ErfassungsModal` (`components/Erfassung.tsx`). Vorher war er ein `Popover` mit einem Knopf **außerhalb** des Formulars — dort war Enter tot (Befund H69 der Erfassungs-Norm). **Labels über dem Feld ✓** (Penzo): die Hülle fährt `layout="vertical"`. **Volle Tastaturbedienung ✓** (WCAG 2.1.1): Enter sendet über die eingebaute Formularübermittlung, Escape schließt und setzt zurück, der Zell-Auslöser ist ein `Dropdown` mit `trigger={['click']}` und `autoFocus`, dessen Einträge `menuitem`-Rollen tragen — die fünf Stufen sind mit Pfeiltasten erreichbar. **Defaults vorbelegt, sichtbar und einzeln überschreibbar ✓** (MIL 5.14.7.1/.3): der Dialog belegt beim Öffnen aus dem Bestand vor und tut es **nicht** erneut, wenn nur derselbe Datensatz nachlädt — sonst überschriebe ein Nachladen den getippten Wortlaut; zwei Tests in `GefahrenZelleDetails.test.tsx` halten beide Richtungen. Die Ablehnung lässt den Wortlaut stehen, weil `onDetailsSpeichern` ein `mutateAsync` ist und kein `mutate`. **Feldbudget ✓** zwei Felder (Modal ≤ ~3, LFH-19). **Nicht anwendbar:** „Speichern und nächsten anlegen" mit gehaltenem Kontext (5.14.7.4) und die Sammelliste mit Ändern/Entfernen je Zeile (DWP) — der Dialog bearbeitet **eine** Zelle eines festen Rasters. Es gibt keine Serie anzulegen; die Serie ist die Matrix, und die steht bereits auf der Seite |

**0 Zeilen ohne Verdikt.** Zwei offene, drei teilweise erfüllte — jede mit Ziel:

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 1, 2 | Pixel-Nachweis der Trefffläche im Handschuh-Betrieb | **LFH-373** — existiert; Umfang um die Gefahrenmatrix erweitern |
| 12, 13 | Umbruch bei ~390 px (CLS) und Tab-Durchlauf hinter der **neuen** stehenden Kopfzeile | **LFH-373** — dieselbe Sorte, derselbe Messapparat |
| 5 | Kontrast Kürzel-auf-Füllung, beide Modi | **LFH-370 (B5j)** — existiert, **führt aber heute keinen Kontrastpunkt**; er muss ergänzt werden |
| 2 | Dichtestufe wird nicht aus dem Einsatzkontext abgeleitet | **B5-Restpunkt (LFH-333)** — existiert |
| 3, 12 | optimistische Updates; wachsende Gebietsliste ohne Sammelbanner | **B6 (LFH-334)** — existiert |
| 8 | kein Helligkeitsregler in der Anwendung | Folge-Task aus A0, dort ausdrücklich weiterverwiesen |

Jede Nummer wurde vor dem Schreiben nachgeschlagen und existiert. Auf LFH-365 musste genau das
nachträglich korrigiert werden (Commit `1c9aca4`) — ein Ziel, das keines ist, liest sich wie
erledigte Planung und ist schlechter als ein offen benannter Rest.

**Eine Zuordnung ist eine Entscheidung, keine Ablesung, und steht deshalb hier:** die Zeilen
1/2/12/13 zeigen auf **LFH-373**, weil dessen Titel sie wörtlich nennt („Handschuh-Zeilenhöhe,
Umbruch auf schmalem Schirm, Fokus hinter schwebenden Aufbauten") und sein Akzeptanzkriterium
schon zwei Prüflisten umspannt (ETB und Lagekarte) — diese ist die dritte. Zeile 5 zeigt auf
**LFH-370**, weil dort der Playwright-Nachweis am Tablet-Viewport gebaut wird; sein Teil 4 ist
heute aber auf Trefferflächen im Navigationsrahmen gescopt und **kennt keinen Kontrastpunkt**.
Wer LFH-370 anfasst, trägt ihn nach — sonst zeigt diese Zeile auf ein Ticket, das ihre Frage
nicht stellt.

---

## Was diese Prüfliste nicht beweist

**Die Zahlen der Baseline sind Scanner-Zahlen, keine Verhaltensbelege.** „0 Klein-Angaben in
`pages/gefahren/`" heißt: der Dichte-Guard findet dort keine mehr. Er sieht nach seinem eigenen
Kopfkommentar weiterhin kein gespreiztes `{...props}`, keine Größe aus einer Variablen, keine
Wrapper-Komponente, die die Prop intern setzt, und keinen Funktionstyp in einem generischen
Typargument. Und er sieht **kein Pixel-Padding** — der Inline-Stil `minWidth: token.controlHeight`
am Zell-Auslöser ist für ihn unsichtbar.

**Diese eine Stelle hielt zunächst gar nichts, und das ist gemessen.** In der ersten Fassung
stand hier, sie werde von „den Zusicherungen in `GefahrenMatrix.test.tsx`" gehalten — der
Abschluss-Review hat die Zeile entfernt und `vitest run src/pages/gefahren src/components/*.guard.test.ts`
gefahren: **6 Dateien, 59 Fälle, alle grün**. Weder Test noch Guard hat sie gehalten. Das wog
schwerer als ein schiefer Satz, weil Zeile 1 ihr „erfüllt" genau mit dieser Stelle begründet:
WCAG 2.5.8 fordert 24 × **24**, und bei einem Ein-Buchstaben-Kürzel ist `minWidth` das Einzige,
was die kurze Achse hält. Nachgezogen ist deshalb ein eigener `describe`-Block in
`GefahrenMatrix.test.tsx` — nach der Schablone von `etb/SlashMenu.test.tsx` und **nicht** als
Quelltext-Muster wie die `sticky`-Zusicherung: ein Inline-Style steht im Baum und ist lesbar,
und ein Quelltext-Muster wäre hier **schwächer**, weil ein dichteblindes `minWidth: 30` es
bestünde. Vier Fälle, drei Proben:

- Prop entfernt → `Tests 4 failed | 12 passed (16)` (`expected '' not to be ''`,
  `expected NaN to be greater than or equal to 30 / 48 / 72`).
- Prop entfernt, die vollständige Angabe `style={{ minWidth: token.controlHeight }}` samt
  „30/48/72" als **Kommentar** daneben → unverändert `4 failed | 12 passed`. Anders als beim
  Quelltext-Weg ist das hier keine knappe Rettung, sondern strukturell: der Fall liest den
  gerenderten Baum, in dem ein Kommentar nicht vorkommt.
- Wert auf ein **dichteblindes** `minWidth: 72` festgenagelt → `1 failed | 15 passed`. Es
  erfüllt **alle drei Böden** und wird allein von der Ungleichheit über zwei Dichtestufen
  gefangen. Deshalb stehen beide Fälle da; einer allein belegte nichts.

Was der Block **nicht** belegt, ist ein gerendertes Pixel — jsdom rechnet kein Layout. Das
bleibt Zeile 1/2 und **LFH-373**.

**Der `sticky`-Nachweis ist ein Quelltext-Nachweis, kein Layout-Nachweis** — und das ist Absicht:
jsdom rechnet kein Layout, `position: sticky` hat dort keine geometrische Wirkung, jedes Rechteck
ist 0 × 0. Geprüft wird derselbe Gegenstand wie in `aktionsabstand.guard.test.ts`: der Prop-Wert
im Quelltext. Zwei Proben belegen, dass die Zusicherung etwas hält:

- **Mutationsprobe** — `sticky` aus `GefahrenMatrix.tsx` entfernt:
  `Tests 1 failed | 17 passed (18)`, rot ist genau „die Gefahrenmatrix hat die stehende
  Kopfzeile, die ihre Ausnahme verspricht".
- **Gegenprobe auf den Kommentar-Stripper** — Prop entfernt und das Wort `sticky` allein auf
  einer Zeile **innerhalb eines Blockkommentars** über derselben Tabelle: ohne
  `ohneKommentare(…)` läuft der Fall auf `Tests 18 passed (18)` durch und ist **grün auf
  Prosa**; mit dem Stripper `Tests 1 failed | 17 passed (18)`. `KORPUS` trägt anders als
  `QUELLEN` ROHTEXT — ohne diesen Schritt füllte eine Umformatierung des erklärenden
  Kommentars über dem Prop das Gate mit seiner eigenen Begründung.

**Die Füllungswerte sind eine Setzung.** Vier Deckkräfte, je Modus ein Wert, hergeleitet aus dem
Abstand zur Grundfläche und daraus, dass zwei Intensitäten desselben Tons unterscheidbar bleiben
müssen. Kein WCAG-Verhältnis wurde dafür ausgerechnet, weil es in dieser Umgebung nicht
ausrechenbar ist. Wer den Wert ändert, ändert eine Setzung — nicht einen Messwert, und schon gar
keinen belegten.

**Es gibt keinen e2e-Fall, der die Gefahren-Route betritt.** Gemessen, nicht vermutet: das Wort
„gefahren" kommt in `frontend/e2e/` nur in zwei Spec-Dateien vor, und beide Male als Verb in
einem Prosakommentar. Alle 28 Verhaltensfälle dieses Bündels laufen in jsdom. Das trifft nicht
nur die Zeilen 1/2/12/13, sondern die Bedienform als Ganzes: dass ein Klick auf eine Zellfläche
im **Browser** ein Menü öffnet, dessen Einträge man mit einer behandschuhten Hand trifft, ist
hier nirgends belegt. Das ist die schärfste Lücke dieser Liste und der Grund, warum die Zeilen 1
und 2 trotz sauberer Quelltextlage keine unbedingte Erfüllung tragen.
