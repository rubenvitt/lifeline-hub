# Bedien-Leitlinie für die vier Einsatzkontexte (LFH-327 · A1)

**Stand:** 2026-07-27 · **Status: verbindlich.** Dies ist keine Empfehlung. Ein Vorschlag, der
gegen eine der sieben Festlegungen verstößt, ist per Leitlinie falsch — unabhängig davon, wie
gut er aussieht.

**Die drei Achsen der Oberfläche.** Diese Leitlinie ist die zweite von dreien und ersetzt keine
der anderen:

| Achse           | Frage                             | Wo sie steht                                     |
| --------------- | --------------------------------- | ------------------------------------------------ |
| **Form**        | Vollseite, Modal, Inline, Drawer? | LFH-19 · `2026-06-22-drawer-nutzung-reduzieren-design.md` |
| **Kontext**     | Welches Gerät, welche Hand, welche Dichte? | **dieses Dokument** (LFH-327 · A1)      |
| **Erscheinung** | Welche Farbe, Form, Schrift?      | LFH-352 · `2026-07-25-gestaltungssprache.md`     |

Dieselbe Form kann je Kontext eine andere Dichte, Treffläche und Spaltenzahl haben. Ein Drawer
bleibt ein Drawer — am Führungs-Tablet trägt er aber 48-px-Zeilen statt 30-px-Zeilen, im
Handschuh-Modus 72-px-Zeilen (Festlegung 4).

**Was A1 nicht tut: Farben entscheiden.** Farbrollen, Kontrastwerte und die Rolle von Signalrot
sind in A0 (`2026-07-25-gestaltungssprache.md`) entschieden und gemessen. A1 nimmt sie als
Eingabe und macht Bedienregeln daraus. Ein Farbwert, der von der A0-Spec abweicht, ist ein
Fehler und kein Vorschlag.

## Beweisregel

**Keine Zahl ohne Beleg.** Jede Zahl in diesem Dokument trägt Quelle und Abschnitts- bzw.
Kriteriumsnummer. Wo gerechnet statt zitiert wurde, steht **[abgeleitet]** — auch dann, wenn die
Rechnung trivial ist.

**Die Umrechnung CSS-Pixel ↔ Millimeter** kommt in diesem Dokument oft vor. Sie beruht auf dem
CSS-Referenzpixel = 1/96 Zoll (W3C CSS Values and Units 4, §5.2,
<https://www.w3.org/TR/css-values-4/#reference-pixel>), also **1 px = 0,2646 mm**. Sie gilt nur,
solange das Gerät korrekt skaliert; ein Tablet mit falsch gesetztem `viewport`-Meta oder
Browser-Zoom ≠ 100 % bricht sie. Jede so gewonnene Millimeter-Angabe ist deshalb **[abgeleitet]**,
auch wenn der Ausgangswert belegt ist.

**Rechtlicher Boden ≠ Gestaltungsziel.** Bindend ist BITV 2.0 → EN 301 549 → WCAG Level AA
(§ 3 Abs. 2 BITV 2.0, Vermutungswirkung). WCAG AA verlangt 24 × 24 CSS px Treffläche
(SC 2.5.8) = **6,35 mm [abgeleitet]** — das liegt unter jedem empirisch ermittelten Minimum für
den bloßen Finger (NN/g: 1 cm) und weit unter jedem Handschuh-Wert. Für diese Anwendungsklasse
ist WCAG AA der Boden, gegen den geprüft wird, und nicht das Ziel, gegen das gestaltet wird.

---

## Festlegung 1 — Die vier Einsatzkontexte

Jede Fläche der Anwendung wird gegen diese vier Kontexte entworfen. Wer eine Seite baut, nennt
im Task, welche Kontexte sie tragen muss — „alle vier" ist eine zulässige, aber teure Antwort.

**Die Zielauflösungen sind eine Festlegung dieser Leitlinie, keine zitierte Zahl.** Sie beschreiben
den Gerätebestand, gegen den entworfen wird; es gibt dafür keine externe Quelle und es soll auch
keine geben — ändert sich der Bestand, ändert sich diese Tabelle.

| Kontext              | Zielauflösung        | Bedienart                            | Dichtestufe                   | Funktionsumfang                     |
| -------------------- | -------------------- | ------------------------------------ | ----------------------------- | ----------------------------------- |
| **Fükw** (primär)    | 1366 × 768 (13–15")  | Tastatur + Maus, sitzend             | kompakt                       | voll                                |
| **Führungs-Tablet**  | 1024–1280 px         | Touch, oft Handschuhe, stehend       | komfortabel / Handschuh       | voll außer Mehrfach-Bearbeitung     |
| **Ortsfeste Stelle** | 1366 px +            | Tastatur, Dauerbetrieb, Hochfrequenz | kompakt + voller Tastaturfluss | voll, erfassungslastig             |
| **Mobil**            | ~390 px              | Touch, einhändig, kurze Interaktion  | komfortabel                   | lesen, melden, Status setzen        |

**Fükw** — *Wofür er da ist:* die Führungsstelle im Fahrzeug, an der die Lage geführt wird;
maximale Informationsdichte bei einem Nutzer, der sitzt und beide Hände frei hat.
*Was er ausdrücklich nicht kann:* im Freien bei Sonne bedient werden — der Nachtmodus ist hier
der Regelfall, nicht die Ausnahme.

**Führungs-Tablet** — *Wofür es da ist:* Lage lesen und punktuell fortschreiben, während man
steht, geht oder mit Handschuh arbeitet; der Zugriff auf Karte, Kräfte und Meldungen ohne
Fahrzeug. *Was es ausdrücklich nicht kann:* Massenerfassung und Mehrfach-Bearbeitung — wer 40
Personen erfasst, tut das an einer ortsfesten Stelle oder im Fükw.

**Ortsfeste Stelle** — *Wofür sie da ist:* BHP, BTP, Aufnahme, Registrierung: derselbe
Vorgang hundertfach, im Dauerbetrieb, mit geübtem Personal am vollen Tastaturfluss.
*Was sie ausdrücklich nicht kann:* mit „ein Feld pro Seite"-Assistenten bedient werden — die
GOV.UK-Grundregel „one thing per page" nennt genau diesen Fall als ihre Ausnahme
(<https://design-system.service.gov.uk/patterns/question-pages/>: „if you're designing an
internal service for government users who need to repeat and switch between tasks quickly").

**Mobil** — *Wofür es da ist:* der Einsatzkraft draußen den aktuellen Stand zeigen und eine
kurze Rückmeldung abnehmen — Status, Meldung, Standort. *Was es ausdrücklich nicht kann:*
Vergleichsansichten tragen. Eine Kräfteübersicht auf 390 px ist kein Ziel dieser Anwendung.

> **Gate 1:** Bei den drei Prüfbreiten **1366 / 1024 / 390 px** entsteht kein horizontaler
> Überlauf des Dokuments: `document.body.scrollWidth <= window.innerWidth` ist an jeder
> geprüften Route wahr. Horizontales Scrollen **innerhalb** eines dafür vorgesehenen
> Containers (Tabelle, Kartenband) ist erlaubt und zählt nicht.
> *Baseline aus dem UI/UX-Sweep vom 2026-07-25 (`UIUX-Sweep-Befunde.md`, Anhang an LFH-326):
> 5 von 177 Komponenten tragen überhaupt Breakpoint-Logik, 0 davon in JS.*

---

## Festlegung 2 — Tabelle, Liste oder Kachel

Die Entscheidung ist keine Geschmacksfrage. Sie fällt an **einer** Frage:

> **Werden mehrere Datensätze anhand derselben Merkmale miteinander verglichen?**
>
> - **Ja → Tabelle.** Belegt: NN/g „Data Tables" — „two adjacent data points are easy to
>   compare"; kartenbasierte Layouts erzwingen weite Blicksprünge und belasten das
>   Arbeitsgedächtnis (<https://www.nngroup.com/articles/data-tables/>).
> - **Nein, es wird gelesen oder ein Objekt einzeln betrachtet → Liste oder Karte.**
> - **Nein, es ist ein Einstieg oder Überblick → Kachel.** Level 1 der vierstufigen
>   ASM-Display-Hierarchie (Überblick → Bereichssicht → Detail → Diagnose/Rohdaten) —
>   ASM Consortium **[sekundär: referiert nach Control Engineering, die ASM-Guidelines selbst
>   liegen nicht im Volltext vor]**,
>   <https://www.controleng.com/creating-an-asm-compliant-hmi-goes-deeper-than-screen-color-selection/>.

**Wenn Tabelle, dann vollständig.** Eine Tabelle ohne diese vier Eigenschaften ist keine
Tabelle, sondern ein Gitter (alle vier: NN/g „Data Tables" / „Mobile Tables"):

1. **Kopfzeile fixiert**, sobald die Tabelle höher als der sichtbare Bereich ist.
2. **Identifierspalte fixiert** und **menschenlesbar** — Funkrufname, Ordnungsnummer,
   Kennzeichen. Nie die DB-`id`.
3. **Spaltensatz umschaltbar**, mit sichtbarem **Zähler ausgeblendeter Spalten**
   („3 Spalten ausgeblendet"). Ein stiller Spaltenfilter ist eine Falle.
4. **Sichtbarer Abschneide-Indikator**, wenn horizontal gescrollt werden kann.

**Eine Tabelle wird auf schmalem Schirm angepasst, nicht in Karten aufgelöst.** NN/g „Mobile
Tables" ist hier ausdrücklich: fixierte Kopfzeile, fixierte linke Spalte, Vorfilterung statt
Zerlegung; bei rein numerischen Spalten tragen auch kleine Schirme viele Spalten (Beleg dort:
11 numerische Spalten ohne Scrollen), bei komplexem Text rund 2
(<https://www.nngroup.com/articles/mobile-tables/>). Ein Karten-Fallback ist die **Ausnahme mit
schriftlicher Begründung im Task**, nicht der Standardweg.

**Die Regel am Bestand geprüft** — beide Fälle ohne Rückfrage entscheidbar:

| Seite                                | Frage: wird verglichen?                                             | Regel sagt | Bestand tut                    |
| ------------------------------------ | ------------------------------------------------------------------- | ---------- | ------------------------------ |
| `pages/KraefteuebersichtPage.tsx`    | ja — Einheiten nach Stärke, Status, Abschnitt gegeneinander          | Tabelle    | `<Table>` ✓                    |
| `pages/BefehlDetailPage.tsx`         | nein — **ein** Befehl wird gelesen                                   | Leseansicht | Vollseite, Sektionen, keine Tabelle ✓ |
| `pages/EinheitenPage.tsx`            | nein — die Gliederung wird **navigiert**, die Einheit einzeln gelesen | Master-Detail-Liste | `<Card>`-Master-Detail ✓ |

> **Gate 2:** Jede Datei, die `<Table` rendert, trägt (a) eine fixierte Kopfzeile
> (antd: `sticky`) und (b) genau eine Spalte mit `fixed: 'left'`, deren `dataIndex` **nicht**
> `id` ist. Prüfung je geänderter Datei:
> `grep -c "sticky" <datei>` ≥ 1 **und**
> `grep -cE "dataIndex: *['\"]id['\"]" <datei>` = 0 — der Zeichenklassen-Ausdruck ist Absicht:
> ein auf einfache Anführungszeichen gepinntes Literal ginge an `dataIndex: "id"` vorbei und
> das Gate wäre still grün (dieselbe Falle, die `CLAUDE.md` für den Query-Key-Scanner
> beschreibt). *Gemessen 2026-07-27: 0 Treffer im Bestand, beide Schreibweisen geprüft.*
> *Baseline 2026-07-27: 16 Seiten rendern `<Table>`, `grep -rn "sticky" frontend/src` findet
> ausschließlich `.etb-erfassung-sticky` — kein einziger fixierter Tabellenkopf im Bestand.*

---

## Festlegung 3 — Mindest-Trefflächen je Kontext

| Ebene                     | Wert                                | Quelle                                   |
| ------------------------- | ----------------------------------- | ---------------------------------------- |
| **Rechtlicher Boden**     | 24 × 24 CSS px (= 6,35 mm [abgeleitet]) | WCAG 2.2 SC 2.5.8 (AA)               |
| **Ziel Maus/Tastatur**    | = Steuerhöhe der kompakten Stufe, 30 px | A0, Festlegung 4                     |
| **Ziel Touch**            | ≥ 44 × 44 px (WCAG) / ≥ 48 × 48 px (Material), Abstand ≥ 8 px | WCAG SC 2.5.5 (AAA), Material <https://m1.material.io/usability/accessibility.html> |
| **Ziel Handschuh**        | ≥ 19 mm belegt / ≈ 30 mm abgeleitet, Separation s. u. | MIL-STD-1472F Fig. 12 / Fig. 24 |

**Die Spacing-Ausnahme von SC 2.5.8** bleibt gültig: ein kleineres Ziel ist konform, wenn ein
24-px-Kreis um seine Bounding-Box kein anderes Ziel und keinen anderen solchen Kreis schneidet
(<https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html>). Sie ist der
Rechtfertigungsweg für einzelne kleine Zeichen — **nicht** für Icon-Leisten in Tabellenzeilen.

**Die 24-px-Schaltflächen im Bestand sind rechtskonform und trotzdem falsch.** Der Sweep zählt
104 davon. Sie erfüllen SC 2.5.8, liegen aber unter jedem empirischen Minimum für den bloßen
Finger (NN/g: **1 cm × 1 cm**, gestützt auf Parhi/Karlson/Bederson 2006; Fingerkuppen im Mittel
1,6–2,0 cm breit, <https://www.nngroup.com/articles/touch-target-size/>) und damit unterhalb des
Gestaltungsziels dieser Anwendung. Sie sind Bestand, kein Vorbild.

**Handschuh — die belegbare Zahl und der ehrliche Bruch.** Eine Norm für *kapazitive
Touchscreens mit Schutzhandschuh* existiert nicht. Belegt sind zwei Nachbarwerte aus
MIL-STD-1472F (23.08.1999,
<https://www.denix.osd.mil/soh/denix-files/sites/21/2016/03/02_MIL-STD-1472F-Human-Engineering.pdf>):

- **Fig. 12** (mechanischer Druckknopf): Fingerkuppe MIN bloß 10 mm → **mit Handschuh 19 mm
  (0,75")**; Separation MIN bloß 13 mm → **mit Handschuh 25 mm**.
- **Fig. 24** (Touchscreen, ohne Handschuhbezug): „other applications" MIN **16 × 16 mm**,
  Separation MIN 3 mm / MAX 6 mm; Fußnote: bei *first-contact*-Auslösung ≥ 5 mm, bei
  *last-contact* genügen ≥ 3 mm.

Daraus folgt die Staffel dieser Anwendung:

- **Höhe: 72 px.** 72 CSS px = 0,75 Zoll = **19,05 mm [abgeleitet: Umrechnung]** — das trifft den
  belegten Fig.-12-Handschuhwert von 19 mm exakt. Die aus Fig. 24 abgeleiteten ≈ 30 mm
  (16 mm × Aufschlagfaktor 1,9 aus Fig. 12) entsprächen 113 px [abgeleitet] und sind auf einem
  1024-px-Tablet flächendeckend nicht darstellbar; 72 px ist die belegte, tragbare Untergrenze.
- **Abstand: ≥ 16 px [abgeleitet].** Die 25 mm Separation aus Fig. 12 gelten für *mechanische*
  Druckknöpfe, bei denen die Nachbartaste mitgedrückt wird. Ein Touchscreen löst bei
  *last contact* aus — dort nennt Fig. 24 selbst ≥ 3 mm (= 11,3 px [abgeleitet]) als
  ausreichend. 16 px ist dieser Wert mit Aufschlag. **Wer die 25 mm für einen Touch-Fall
  einfordert, zitiert die falsche Figur.**

**Kritische Aktionen brauchen eine zweite Handlung.** MIL-STD-1472F 5.4.6.6: wird ein
Touch-Bedienelement für eine **kritische Aufgabe** genutzt, ist eine zusätzliche
Bestätigungshandlung Pflicht. Das gilt in dieser Anwendung für: **Storno, Abschluss, Löschen,
Alarmierung** und jede Aktion, die einen abgeschlossenen Zustand wiedereröffnet.

> **Gate 3:** Auf jeder umgebauten Route misst ein Browser-Test die `boundingBox()` aller
> fokussierbaren Elemente. Kein Element unterschreitet die Dichtestufe der Route:
> **kompakt ≥ 24 px, komfortabel ≥ 48 px, Handschuh ≥ 72 px** in der kurzen Achse — es sei
> denn, die Spacing-Ausnahme greift und ist im Task benannt.

---

## Festlegung 4 — Die Dichte-Staffel

**Drei Stufen, ein Träger.** Die kompakte Stufe ist in A0 gesetzt und gemessen; A1 legt die
beiden anderen fest.

| Rolle                                   | **kompakt** (A0)   | **komfortabel**       | **Handschuh**         |
| --------------------------------------- | ------------------ | --------------------- | --------------------- |
| Steuerhöhe (antd `controlHeight`)       | **30 px** (A0)     | **48 px**             | **72 px**             |
| Listen-/Tabellenzeile                   | 30 px (A0)         | 48 px                 | 72 px                 |
| Grundschrift                            | **13,5 px** (A0)   | **15 px** [abgeleitet] | 15 px [abgeleitet]   |
| Polsterung `md` / `lg`                  | 11 / 18 px (A0)    | 18 / 28 px [abgeleitet] | 26 / 44 px [abgeleitet] |
| Abstand zwischen Zielen                 | Spacing-Ausnahme   | ≥ 8 px (Material)     | ≥ 16 px [abgeleitet]  |
| Kennzahl                                | 62 px (A0)         | 62 px                 | 62 px                 |

**Woher die Werte kommen.** Die kompakte Spalte ist wertgleich mit `frontend/src/theme/tokens.ts`
(A0: `form.zeilenhoehe = 30`, `form.schriftgroesse = 13.5`, `abstand.md/lg = 11/18`) — sie wird
hier zitiert, nicht neu entschieden. Die komfortable Steuerhöhe von **48 px** ist der
Material-Wert (48 dp ≈ 9 mm) und deckt WCAG SC 2.5.5 (44 × 44) mit ab. Die Handschuh-Stufe von
**72 px** ist in Festlegung 3 hergeleitet. Die Polsterungen skalieren mit der Steuerhöhe
(× 1,6 bzw. × 2,4, gerundet auf gerade Werte) — **[abgeleitet]**, es gibt dafür keinen Normwert.

**Die Kennzahl bleibt in allen drei Stufen 62 px** (A0). Sie ist kein Bedienelement, sondern
eine Anzeige — Dichte betrifft, was man trifft und liest, nicht was man aus zwei Metern erkennt.

**Die Grundschrift steigt nur einmal, nicht zweimal.** 13,5 → 15 px zwischen kompakt und
komfortabel ist **[abgeleitet]** und folgt der Trefffläche, nicht umgekehrt: keine der geprüften
Quellen belegt eine Schriftgröße nach Betrachtungsabstand für diesen Fall. Der Handschuh-Modus
behält 15 px — **er ändert die Hand, nicht das Auge.** Wer für den Handschuh-Modus größere
Schrift einfordert, verwechselt zwei Probleme.

**Träger ist ein Dichte-Token am `ConfigProvider`, nicht `componentSize`.** Der Task nannte beide
Wege; `componentSize` scheidet aus, weil es nur `small`/`middle`/`large` kennt und `large` bei
antd auf `controlHeightLG` = 40 px endet — die 48- und 72-px-Stufen sind damit nicht
darstellbar. Der Weg ist: `tokens.ts` bekommt eine `dichte`-Staffel, `antdToken()` nimmt sie als
Parameter und setzt `controlHeight`/`padding*`/`fontSize` daraus, `rollen.css` spiegelt sie als
`--lfh-*`-Properties. Der Umbau selbst gehört nach **A2 (LFH-328)** und **B5**; die Werte stehen
ab hier fest.

**Ab sofort verboten: neues punktuelles `size="small"` auf interaktiven Elementen.**

**Was die Baseline-Zahl genau ist**, damit der erste B5-Task sie nicht für etwas anderes hält:
`grep -rn 'size="small"' frontend/src --include='*.tsx' | wc -l` = **236** (gemessen
2026-07-27; der Sweep vom 25.07. zählte 241). Das sind **Zeilen**, keine Elemente, und keine
davon liegt in einer `.test.tsx`. Davon sitzen **37** auf Container-Komponenten (`Card`,
`Descriptions`, `Table`, `Tag`, `List`, …), wo `size="small"` **keine Trefffläche** verkleinert,
sondern nur Polsterung. Die Teilmenge auf tatsächlich interaktiven Elementen ist also kleiner als
236 und **nicht ausgezählt** — sie zu ermitteln ist Arbeit von B5, nicht von A1. Die 236 taugen
als Drift-Wächter, nicht als Umbau-Umfang.

> **Gate 4:** In jeder neu angelegten oder umgebauten Datei gilt
> `grep -c 'size="small"' <datei>` = 0. Repo-weit darf
> `grep -rn 'size="small"' frontend/src --include='*.tsx' | wc -l` die Baseline **236** nicht
> überschreiten. Zusätzlich kommt `controlHeight` ausschließlich aus der Theme-Schicht:
> `grep -rn "controlHeight" frontend/src | grep -v '/theme/'` = 0 Treffer (ohne
> `--include`-Filter — `tokens.ts` ist `.ts`, ein `*.tsx`-Filter würde die Datei nie sehen und
> das Gate zur Attrappe machen).

---

## Festlegung 5 — Statusfarben-Semantik

**Die Werte sind in A0 entschieden.** Sie stehen in `frontend/src/theme/tokens.ts` und
`frontend/src/theme/rollen.css`, begründet und gemessen in
`docs/superpowers/specs/2026-07-25-gestaltungssprache.md`. A1 fügt keine Farbe hinzu und ändert
keine — A1 schreibt die Regeln, nach denen sie eingesetzt werden.

**Die Ampel-Achse** (MIL-STD-1472F 5.2.1.1.4.1/.2; IEC 60073 [sekundär: Normtext hinter
Paywall]):

| Rolle     | Bedeutung                  | hell      | dunkel    |
| --------- | -------------------------- | --------- | --------- |
| `alarm`   | Gefahr, sofort handeln     | `#b02318` | `#ff7a7f` |
| `achtung` | abnormer Zustand           | `#7a5200` | `#f5b942` |
| `normal`  | Normalzustand              | `#1c6640` | `#5cc48d` |
| `bedien`  | Bedienung, Fokus — **blau, nie rot** | `#1a5fa0` | `#6fb4ec` |
| `marke`   | Akzentstrich, Marke        | `#a8071a` | `#e04552` |

**Rot bedient nichts.** Das ist die A0-Entscheidung, die LFH-315 auflöst: die Bedienfarbe und der
Fokusring laufen blau, Rot lebt nur noch als Gefahr (`alarm`) und als Markenakzent (`marke`).

Die verbindlichen Sätze:

1. **Immer ein zweiter Kanal.** Jede Statusfarbe trägt zusätzlich Text, Symbol oder Form.
   Farbe allein verletzt WCAG SC 1.4.1 (Level A,
   <https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html>); **1 von 12 Männern** trennt
   Rot und Grün nicht sicher (NEI,
   <https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness>);
   MIL 5.4.6.8 verlangt Farbcodierung auf Touch-Targets ausdrücklich nur redundant.
2. **Eine Farbe = eine Bedeutung.** Keine Doppelbelegung. ASM Consortium, wörtlich: „if red
   means critical alarm state then it should not also mean a pump is off."
3. **Gesättigte Farbe nur für abnorme Zustände.** Der Normalzustand ist ruhig; Salienz ist eine
   knappe Ressource (ASM Consortium).
4. **Zwei Kontrastziele, nicht ein invertiertes Theme.** Tag/Sonne **≥ 7 : 1**, Nacht/Fahrzeug
   **≥ 5 : 1**, nie unter 4,5 : 1 (MIL 5.2.4.2.2.2; WCAG SC 1.4.6/1.4.3). Alles, was
   Bedienelement-Identität oder **Zustand** trägt — Rahmen, Häkchen, Fokusring, tragende
   Trennlinien — **≥ 3 : 1** (WCAG SC 1.4.11). A0 hat das für die Referenzseite erfüllt: Text
   auf Fläche 13,47 : 1 dunkel / 18,17 : 1 hell, Bedienfarbe und Fokusring 7,67 / 6,59, Alarm
   6,80 / 6,78, tragende Linie 3,04 / 3,07.
5. **Ein 21 : 1-Weiß-auf-Schwarz im Fükw ist ein Fehler, kein Bestwert.** MIL 5.2.4.2.2.2 setzt
   für dunkle Umgebung ein **Ziel** von ≥ 5 : 1 bei niedriger Absolutleuchtdichte, keinen
   Maximalwert. Genau deshalb ist die A0-Grundfläche `#0b0e13` und nicht `#000000`, die helle
   `#e7ebf0` und nicht `#ffffff`. Die ASM-Empfehlung „hellgrauer Grund statt schwarz oder weiß"
   ist damit im hellen Modus erfüllt; für den Nachtmodus gilt sie nicht unverändert, weil sie
   für dauerbeleuchtete Kontrollräume geschrieben ist und nicht für ein abgedunkeltes Fahrzeug.

> **Gate 5:** Kein Statusfarbwert außerhalb der Theme-Dateien.
> `grep -rniE '#(b02318|ff7a7f|f5b942|5cc48d|1c6640|7a5200|1a5fa0|6fb4ec|a8071a|e04552)' frontend/src | grep -v '/theme/'`
> = 0 Treffer. Zusätzlich bleibt `frontend/src/theme/rollen.guard.test.ts` grün (43 Prüfungen
> gegen Drift zwischen TS- und CSS-Fassung).

---

## Festlegung 6 — Live-Aktualisierung unter Zeitdruck

Betrifft den SSE-Fan-out (siehe Query-Key-Registry in `CLAUDE.md`). Ein Live-Kanal ohne Budget
ist keine Funktion, sondern eine Belastung.

**Nichts springt unter dem Cursor.** Eingehende Datensätze werden **gesammelt** und als Banner
angeboten („12 neue Meldungen"), nicht in die sichtbare Liste eingeschoben. Belegt doppelt:
CLS-Ziel **≤ 0,1** am 75. Perzentil (<https://web.dev/articles/cls>; Verschiebungen < 500 ms nach
einer Nutzerinteraktion tragen `hadRecentInput` und zählen nicht mit) und WCAG SC 3.2.5 Change on
Request mit Technik G76 — statt automatisch zu aktualisieren einen „Jetzt aktualisieren"-Auslöser
anbieten (<https://www.w3.org/WAI/WCAG22/Understanding/change-on-request.html>).

**Sammelbanner statt Einzel-Toast.** Ein Toast pro Ereignis skaliert nicht und ist flüchtig; der
Sweep zählt 83 Fehlerpfade, die heute nur als Toast erscheinen.

**Alarmbudget pro Nutzer** (EEMUA 191 3. Aufl. S. 96/97; ANSI/ISA-18.2 Suggested Target Values):

| Kennzahl                                  | Zielwert                 |
| ----------------------------------------- | ------------------------ |
| Dauerbetrieb, je 10 min und Nutzer        | **1–2** (1/10 min akzeptabel, 1/5 min noch handhabbar, > 1/min inakzeptabel) |
| Erste 10 min einer Großlage               | **< 10** (20–100 schwer bewältigbar, > 100 führt zum Abschalten des Systems) |
| Maximum in einem 10-min-Fenster           | **≤ 10**                 |
| Prioritätsverteilung niedrig/mittel/hoch  | **~80 / 15 / 5 %**       |
| Flatternde („chattering") Alarme          | **0**                    |
| Eskalationsstufen                         | **höchstens 3**          |

Warum das kein Zierrat ist: die Joint Commission zählt zwischen Januar 2009 und Juni 2012
**98 alarmbezogene Ereignisse, davon 80 mit Todesfolge**; häufigster beitragender Faktor ist
Alarm-Müdigkeit, Grundlage sind geschätzte **85–99 % Alarme ohne Handlungsbedarf**
(<https://www.jointcommission.org/en-us/knowledge-library/newsletters/sentinel-event-alert/issue-50>).

**Darstellungsregeln** (MIL-STD-1472F):

- **Kein Blinken auf lesbarem Text** — 5.2.1.5.5.4: „Characters that must be read should not
  flash." Funkrufname und Meldungstext blinken nie; wenn Aufmerksamkeit nötig ist, blinkt ein
  Symbol daneben.
- Höchstens **zwei Blinkraten**, Unterschied ≥ 2 Hz, die schnellere ≤ 5 Hz, die langsamere
  ≥ 0,8 Hz (5.2.1.5.5.3); Blinken nur für missionskritische Ereignisse (5.14.3.3.2).
- **Jede Warnung ist quittierbar** (5.2.1.5.5.5).
- **Jeder Ton hat eine visuelle Entsprechung**, die den Zustand benennt (5.3.6.3).
- **Antwortzeiten** (Tab. XXII, für Command-and-Control-Systeme): Bedien-Rückmeldung **≤ 100 ms**
  (auch 5.4.6.4), Kommandoreaktion **≤ 2 s**, ab **> 15 s** nur mit Fortschrittsmeldung (5.14.9).
  Eine optimistische Anzeige mit sichtbarem Pending-Zustand ist der Weg, die 100 ms zu halten,
  wenn der Server länger braucht. *Baseline aus dem Sweep vom 2026-07-25: 0 optimistische
  Updates im Bestand, Offline-Puffer für 1 von 62 schreibenden Dateien.*

**Die eine Ausnahme, die die Norm selbst macht:** WCAG SC 2.2.4 Interruptions verlangt, dass
Unterbrechungen aufschiebbar oder unterdrückbar sind — „**except interruptions involving an
emergency**" (<https://www.w3.org/WAI/WCAG22/Understanding/interruptions.html>). Das ist die
Rechtfertigung, echte Alarme durchzustellen, und zugleich die Verpflichtung, **alles andere**
unterdrückbar zu machen.

> **Gate 6:** Nach einem eingespielten SSE-Ereignis meldet der `layout-shift`-PerformanceObserver
> **0 Einträge mit `hadRecentInput === false` und `value > 0`** über der sichtbaren Liste; der
> kumulierte CLS der Route bleibt **≤ 0,1**. Zusätzlich: die Route erzeugt pro eingehendem
> Ereignis **höchstens ein** sichtbares Element (Banner), nicht eines je Datensatz.

---

## Festlegung 7 — Prüfliste Einsatztauglichkeit

Diese Liste wird an **jede** neue oder umgebaute Seite angelegt. **Ein Modul-Task ohne
ausgefüllte Prüfliste gilt nicht als fertig** — jede der 15 Zeilen trägt ein Verdikt
(erfüllt / offen → Zielticket / nicht anwendbar → Begründung). „Nicht geprüft" ist kein Verdikt.

- [ ] **1 · Treffläche** — Boden ≥ 24 × 24 CSS px oder 24-px-Umkreis frei (WCAG 2.5.8 AA);
  zeitkritische Aktion ≥ 48 × 48 px mit ≥ 8 px Abstand (WCAG 2.5.5 / Material 48 dp).
- [ ] **2 · Handschuh-Modus** vorhanden und geprüft — Zeilenhöhe ≥ 72 px (= 19,05 mm
  [abgeleitet], MIL-STD-1472F Fig. 12), Abstand ≥ 16 px [abgeleitet aus Fig. 24, last contact].
- [ ] **3 · Rückmeldung vor der Serverantwort** — sichtbar ≤ 100 ms (MIL 5.4.6.4);
  Kommandoreaktion ≤ 2 s (Tab. XXII); > 15 s nur mit Fortschrittsmeldung (MIL 5.14.9).
- [ ] **4 · Kritische Aktion hat eine zweite Handlung** — Storno, Abschluss, Löschen,
  Alarmierung: je 1 zusätzliche Bestätigung (MIL 5.4.6.6).
- [ ] **5 · Kontrast in beiden Modi** — Text Tag ≥ 7 : 1, Nacht ≥ 5 : 1, nie < 4,5 : 1
  (MIL 5.2.4.2.2.2; WCAG 1.4.6/1.4.3); Zustände, Rahmen, Fokusring ≥ 3 : 1 (WCAG 1.4.11).
- [ ] **6 · Kein Status allein über Farbe** — jede Statusfarbe zusätzlich mit Text, Symbol oder
  Form, 0 Ausnahmen (WCAG 1.4.1 Level A; MIL 5.4.6.8; 1 von 12 Männern, NEI).
- [ ] **7 · Eine Farbe = eine Bedeutung** — Palette auf Doppelbelegung geprüft, gesättigte Farbe
  nur für abnorme Zustände, Grundfläche aus A0 (weder `#000000` noch `#ffffff`) — ASM Consortium.
- [ ] **8 · Helligkeits-/Kontrastregler** vorhanden und bei aktiver Warnung nicht bis AUS
  dimmbar — 1 Regler, 1 Sperre (MIL 5.2.2.1.9, 5.2.4.2.2.3).
- [ ] **9 · Kritische Anzeigen im Blickfeld** — innerhalb 15° der normalen Blickachse, nicht am
  Layoutrand (MIL 5.2.2.1.7).
- [ ] **10 · Alarmbudget eingehalten** — 1–2 je 10 min im Dauerbetrieb, < 10 in den ersten 10 min
  einer Großlage, ≤ 10 je 10-min-Fenster, ~80/15/5 %, 0 flatternde Alarme, ≤ 3 Eskalationsstufen
  (EEMUA 191 S. 96/97; ISA-18.2).
- [ ] **11 · Warnverhalten** — kein Blinken auf lesbarem Text, ≤ 2 Blinkraten (schnellere ≤ 5 Hz,
  langsamere ≥ 0,8 Hz), jede Warnung quittierbar, jeder Ton mit visueller Entsprechung
  (MIL 5.2.1.5.5.3/.4/.5, 5.3.6.3).
- [ ] **12 · Kein Sprung unter dem Cursor** — CLS ≤ 0,1 (75. Perzentil, web.dev); neue Datensätze
  nur als opt-in-Sammelbanner (WCAG 3.2.5 / G76).
- [ ] **13 · Fokus nie verdeckt** — 0 vollständig verdeckte Fokusziele beim Tab-Durchlauf hinter
  fixierten Köpfen, Fußleisten oder Drawern (WCAG 2.4.11 AA).
- [ ] **14 · Tabellenseite vollständig** — fixierte Kopfzeile, fixierte menschenlesbare
  Identifierspalte, umschaltbarer Spaltensatz mit Zähler ausgeblendeter Spalten, keine Auflösung
  in Karten, wo verglichen wird (NN/g Data Tables / Mobile Tables).
- [ ] **15 · Erfassungsmaske vollständig** — Defaults vorbelegt, sichtbar und einzeln
  überschreibbar (MIL 5.14.7.1/.3), „Speichern und nächsten anlegen" mit gehaltenem Kontext
  (5.14.7.4), Sammelliste mit Ändern/Entfernen je Zeile (DWP „Add another thing"), Labels über
  dem Feld (50 ms statt 500 ms Sakkade, Penzo), volle Tastaturbedienung (WCAG 2.1.1).

> **Gate 7:** Jeder Band-B- und Band-C-Task bringt diese Tabelle mit **15 Zeilen** und je einem
> Verdikt mit. 0 Zeilen ohne Verdikt; jede offene Zeile nennt das Zielticket.

---

## Validierung an der Referenzseite

Die Prüfliste wird an der A0-Referenzseite `frontend/src/pages/lage-dashboard/LageDashboardPage.tsx`
validiert, bevor sie verbindlich wird. **Das Ergebnis ist absichtlich nicht durchgehend grün** —
eine Prüfliste, die am ersten Fall nichts findet, misst nichts.

| #  | Verdikt                | Beleg / Zielticket                                                                                       |
| -- | ---------------------- | -------------------------------------------------------------------------------------------------------- |
| 1  | **teilweise erfüllt**  | `.lfh-knopf` hat `min-height: 32px` ✓; `.lfh-kachel__mehr` erbt `.lfh-knopf-blank` mit `padding: 0` und 10,5 px Schrift ≈ 15 px hoch — konform **nur** über die Spacing-Ausnahme, nicht über die Fläche → **B5** |
| 2  | **offen**              | Es gibt heute keine Dichtestufen — E setzt eine einzige (kompakt) → **A2 (LFH-328) / B5**                  |
| 3  | **teilweise erfüllt**  | Ladezustand ist sofort sichtbar (`.lfh-skelett`, `aria-busy`) ✓; optimistische Updates gibt es nirgends (Baseline: 0) → **B6** |
| 4  | **nicht anwendbar**    | Das Dashboard führt keine kritische oder irreversible Aktion aus — es liest und navigiert            |
| 5  | **erfüllt**            | A0 gemessen: 13,47 : 1 dunkel / 18,17 : 1 hell; tragende Linie 3,04 / 3,07; Fokusring 7,67 / 6,59      |
| 6  | **erfüllt**            | Stufenkante an der Kennzahl (seit LFH-329 · B1 **abgestuft**: 6 px Alarm gegen 3 px Achtung — vorher unterschieden sich die beiden bewerteten Stufen ausschließlich in der Farbe), Text in jeder Plakette, Dreiecksform am Zeilenmarker (A0, zweiter Kanal). Größe und Schriftschnitt wurden als dritter Kanal geprüft und **verworfen**: die Größe, weil sie die Zeilenhöhe bei jedem Statuswechsel springen ließe (Festlegung 6, CLS ≤ 0,1); der Schnitt, weil er gemessen leer ist (Vorschubbreite in Chromium 96,33 px bei 400/500 und 96,00 px bei 600/700/800 — über 600 liefert `schriften.css` keinen Schnitt, die Zahl steht bereits dort). Pin: `die Stufenregeln der Kennzahl ändern Farbe und Kantenbreite, nicht Schriftgröße oder -schnitt` |
| 7  | **erfüllt**            | Grund `#0b0e13` / `#e7ebf0` — weder reines Schwarz noch reines Weiß; `alarm` ausschließlich Gefahr     |
| 8  | **offen**              | Kein Helligkeits-/Kontrastregler in der Anwendung; A0 verweist ihn ausdrücklich weiter → **eigener Folge-Task, siehe „Was diese Leitlinie nicht entscheidet"** |
| 9  | **erfüllt**            | Das Instrumentenband (`.lfh-band`) liegt oben, immer an derselben Stelle; Kennzahlen im oberen Drittel |
| 10 | **nicht anwendbar**    | Das Dashboard erzeugt keine Alarme — es zeigt Zustände. Gilt ab **B6**                                 |
| 11 | **erfüllt**            | Kein Blinken auf der Seite; der Fehlerzustand trägt `role="alert"` mit Text statt Bewegung             |
| 12 | **offen**              | Die Kacheln aktualisieren über den SSE-Fan-out ohne Sammelbanner → **B6**                              |
| 13 | **erfüllt**            | Das Instrumentenband `.lfh-band` liegt **im Fluss**, nicht über dem Inhalt: `sprache.css` enthält kein einziges `position:` (geprüft 2026-07-27), das einzige `position: sticky` im Frontend ist `.etb-erfassung-sticky` in `index.css` und gehört nicht zu dieser Seite |
| 14 | **nicht anwendbar**    | Keine Tabelle auf dem Dashboard — Kacheln sind Level-1-Überblick                                       |
| 15 | **nicht anwendbar**    | Keine Erfassungsmaske auf dem Dashboard                                                                 |

**Gate 1 am Lage-Dashboard belegt (LFH-329 · B1).** Die Kennzahlenleiste ist auf den drei
Prüfbreiten im Browser gemessen — `frontend/e2e/lage-dashboard-schmal.spec.ts`, Chromium,
`4 passed`. Sie bricht um, statt waagerecht zu scrollen; auf 390 px stehen alle sechs
Kennzahlen in 2 Spalten × 3 Zeilen.

Die Staffel hängt an der **Container**-Breite (`.lfh-flaeche` trägt `container-type:
inline-size`), nicht am Viewport — was zählt, ist die Fläche nach Abzug von
Navigationsrahmen und Seitenrinne. Gemessen: Viewport 1366 → Container **1036** px ·
1024 → **694** px · 390 → **366** px.

Daraus zwei Befunde, die ohne Messung nicht zu haben waren:

- **Die Schwelle 1100 px bleibt.** Der Entwurf sah eine Senkung auf 1000 vor, damit der Fükw
  sechs statt drei Spalten bekommt. Gegenmessung mit erzwungenen sechs Spalten: ab Container
  950 px läuft das längste Etikett um 14 px aus seinem Knopf, erst ab 1036 px gar nicht mehr.
  Eine Schwelle bei 1000 gäbe also genau dem Band 1000–1036 sechs Spalten mit abgeschnittenen
  Etiketten — und abgeschnittene Etiketten sind im Einsatz schlimmer als eine zweite Zeile.
  Der Fükw steht damit bei 3 Spalten × 2 Zeilen, vollständig lesbar. Keine der drei
  Prüfbreiten fängt eine spätere stille Senkung; das tut der Quellpin
  `die Spaltenstaffel der Kennzahlenleiste steht in sprache.css: 6 → 3 → 2`.
- **Offen für den Parent:** bei 1024 px — der dokumentierten Breite des Führungs-Tablets —
  bleiben nur 694 px Container, also 6 px unter der 700er-Schwelle. Das Tablet bekommt dort
  die Zweispalten-Ansicht des Handschirms, während ein 768-px-Tablet (Container 720, Rahmen
  bereits hinter dem Griff) drei Spalten zeigt. Ursache ist nicht die Leiste, sondern der
  Navigationsrahmen: unterhalb `lg` (992 px) liegt er hinter dem Griff, bei 1024 px steht er
  inline und nimmt ~330 px. Am selben 700er-Block hängt auch `.lfh-raster`, die Entscheidung
  gehört also nicht in dieses Paket.

**Was die Validierung an der Prüfliste selbst geändert hat.** Zwei Kriterien waren in der
Rohfassung (`ergebnis.md`, Anhang an LFH-327) nicht anlegbar und wurden geschärft:

- **Kriterium 7** lautete „Grundfläche hellgrau, nicht schwarz/weiß" (ASM). Angelegt an das
  Dashboard hätte es die **in A0 entschiedene und gemessene** Nachtfläche `#0b0e13` als Verstoß
  markiert. Die ASM-Empfehlung ist für dauerbeleuchtete Kontrollräume geschrieben; MIL
  5.2.4.2.2.2 setzt für die dunkle Umgebung ≥ 5 : 1 als **Ziel**, nicht das Maximum. Das
  Kriterium trägt jetzt den Teil, der trägt — eine Farbe = eine Bedeutung, gesättigte Farbe nur
  für abnorme Zustände, weder reines Schwarz noch reines Weiß — und verweist für den Grundton
  auf A0.
- **Kriterium 2** nannte „≥ 19 mm belegt / ≈ 30 mm abgeleitet, Abstand ≥ 25 mm". Die 25 mm
  stammen aus MIL Fig. 12 (mechanische Druckknöpfe) und sind auf einem 1024-px-Tablet nicht
  flächendeckend darstellbar; für Touchscreens nennt Fig. 24 selbst ≥ 3 mm bei
  last-contact-Auslösung. Das Kriterium trägt jetzt CSS-Pixel-Werte (72 px / 16 px), die man an
  einer Seite tatsächlich messen kann, mit der Herleitung in Festlegung 3.

---

## Verhältnis zu den bestehenden Leitlinien

Diese Leitlinie steht **neben** den bestehenden Regeln, nicht über ihnen. Ein Vorschlag, der eine
davon bricht, ist per Leitlinie falsch — auch wenn er eine der sieben Festlegungen besser
erfüllt:

| Regel                                                        | Quelle der Wahrheit                          |
| ------------------------------------------------------------ | -------------------------------------------- |
| Form: Vollseite / Modal / Inline / Drawer (≤ 480 px, read-only Quick-View oder ≤ 4 Felder) | LFH-19, `CLAUDE.md` |
| Deeplinks ausschließlich über zentrale Builder               | `frontend/src/routing/deeplinks.ts`          |
| Query-Keys ausschließlich über die Registry                  | `frontend/src/api/queryKeys.ts`              |
| Lint ohne Warnungen                                          | `pnpm lint --max-warnings 0`                 |
| Gate vor dem Merge                                           | `./scripts/check-all.sh`                     |
| Farbe, Form, Schrift                                         | LFH-352, `2026-07-25-gestaltungssprache.md`  |

Der häufigste zu erwartende Konflikt: **Dichte gegen Drawer-Breite.** Ein Drawer mit 72-px-Zeilen
im Handschuh-Modus wird schnell breiter als die 480 px aus LFH-19. Die Auflösung ist **nicht**,
den Drawer zu verbreitern — sie ist, den Inhalt auf eine eigene Route zu heben. Genau das sagt
LFH-19 bereits.

## Was diese Leitlinie nicht entscheidet

Diese Punkte sind **offen**, nicht vergessen. Wer hier eine Lücke findet, hat eine offene Frage
gefunden und keine Entscheidungsfreiheit:

- **Der Helligkeits-/Kontrastregler** (MIL 5.2.2.1.9 macht ihn zur Pflicht, ebenso 5.2.4.2.2.3
  für das Kontrastverhältnis; Prüflisten-Kriterium 8). Gehört in einen eigenen Folge-Task —
  er berührt Theme-Provider, Persistenz je Nutzer und die Sperre gegen Dimmen bis AUS bei
  aktiver Warnung. A1 legt nur fest, **dass** er kommen muss.
- **Ob der Handschuh-Modus automatisch oder nur manuell umgeschaltet wird.** Eine automatische
  Erkennung (Touch-Fläche, Druckverteilung) ist plattformabhängig und nicht belegt; ein
  Fehlschalten mitten im Einsatz wäre teurer als ein Schalter. A1 entscheidet das nicht.
- **Wie die Dichtestufe je Kontext gewählt wird** — automatisch nach Container-Breite,
  manuell, oder als Nutzereinstellung je Gerät. Die Werte stehen (Festlegung 4), der Auslöser
  nicht. Gehört zu A2 (LFH-328) / B5.
- **`cssVar: true` am `ConfigProvider`.** App-weiter Rendering-Radius, in A0 bewusst nach A2
  vertagt. `LoginPage.css:83` läuft heute still auf seinen Fallback.
- **Taktische Zeichen als vollständige Modul-Ikonografie.** A0 nimmt die Formensprache in Marker
  und Sektionsmarken auf; die Ableitung echter DV-102-Signaturen aus
  `frontend/src/pages/lagekarte/taktischesZeichen.ts` für Modulnavigation und Listenzeilen steht
  aus.
- **Die konkreten Schwellen des Alarmbudgets je Ereignistyp.** Festlegung 6 gibt das Budget vor;
  welches SSE-Ereignis welche Priorität trägt (die ~80/15/5-Verteilung), entscheidet **B6** am
  konkreten Ereignis-Inventar.

## Quellen

- **BITV 2.0 / EN 301 549 / WCAG AA** — bindender Rechtsrahmen, Vermutungswirkung nach
  § 3 Abs. 2 BITV 2.0:
  <https://www.barrierefreiheit-dienstekonsolidierung.bund.de/Webs/PB/DE/gesetze-und-richtlinien/bitv2-0/bitv2-0-node.html>
- **WCAG 2.2** — SC 2.5.8 Target Size (Minimum, 24 × 24 + Spacing-Ausnahme) ·
  SC 2.5.5 (Enhanced, 44 × 44) · SC 1.4.11 Non-text Contrast (3 : 1) ·
  SC 1.4.3 / 1.4.6 Contrast · SC 1.4.1 Use of Color (Level A) · SC 2.1.1 Keyboard ·
  SC 2.4.11 Focus Not Obscured · SC 3.2.5 Change on Request · SC 2.2.4 Interruptions —
  jeweils unter <https://www.w3.org/WAI/WCAG22/Understanding/>
- **W3C CSS Values and Units 4 §5.2** — CSS-Referenzpixel = 1/96 Zoll:
  <https://www.w3.org/TR/css-values-4/#reference-pixel>
- **MIL-STD-1472F** (DoD Human Engineering, 23.08.1999) — Fig. 12 (Handschuh 19/25 mm),
  Fig. 24 (Touchscreen 16 mm, Separation 3–6 mm), 5.4.6.4 (≤ 100 ms), 5.4.6.6 (zweite
  Bestätigung), 5.4.6.8 (Farbe nur redundant), 5.2.4.2.2.2 (≥ 7 : 1 hell / ≥ 5 : 1 dunkel),
  5.2.2.1.7 (15° Blickachse), 5.2.2.1.9 (Dimmregler), 5.2.1.5.5.3/.4/.5 (Blinken, Quittierung),
  5.3.6.3 (Ton mit visueller Entsprechung), Tab. XXII (Antwortzeiten), 5.14.7.1/.3/.4 (Defaults),
  5.14.9 (> 15 s):
  <https://www.denix.osd.mil/soh/denix-files/sites/21/2016/03/02_MIL-STD-1472F-Human-Engineering.pdf>
- **Material / Google** — 48 × 48 dp ≈ 9 mm, Abstand ≥ 8 dp:
  <https://m1.material.io/usability/accessibility.html>
- **NN/g** — „Touch Target Size" (1 cm, Fingerkuppe 1,6–2,0 cm):
  <https://www.nngroup.com/articles/touch-target-size/> · „Data Tables":
  <https://www.nngroup.com/articles/data-tables/> · „Mobile Tables":
  <https://www.nngroup.com/articles/mobile-tables/>
- **EEMUA 191 (3. Aufl.) S. 96/97 · ANSI/ISA-18.2** — Alarmlast im Dauerbetrieb:
  <https://www.processvue.com/downloads/Alarm_system_performance_KPIs_V1_0.pdf> ·
  <https://isa.ie/wp-content/uploads/2016/06/Alarm_System_Performance_Metrics_Kim_Van_camp.pdf>
- **Joint Commission, Sentinel Event Alert 50** — 98 Ereignisse, 80 mit Todesfolge:
  <https://www.jointcommission.org/en-us/knowledge-library/newsletters/sentinel-event-alert/issue-50>
- **ASM Consortium** — Kontrollraum-Farbgebung, „eine Farbe = eine Bedeutung":
  <https://process.honeywell.com/content/dam/process/en/documents/document-lists/doc_asm-consortium/white-papers/February%2028%202011%20-%20Why%20Gray%20Backgrounds%20for%20DCS%20Operating%20Displays.pdf>
- **GOV.UK Design System** — „Question pages" mit der Ausnahme für interne Dienste:
  <https://design-system.service.gov.uk/patterns/question-pages/> · **DWP Design System** —
  „Add another thing": <https://design-system.dwp.gov.uk/patterns/add-another-thing>
- **Penzo (UXmatters, 2006)** — Label-Platzierung, Sakkadendauer 50 ms vs. 500 ms:
  <https://www.uxmatters.com/mt/archives/2006/07/label-placement-in-forms.php>
- **NEI** — 1 von 12 Männern mit Farbsehschwäche:
  <https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness>
- **web.dev** — CLS ≤ 0,1 am 75. Perzentil: <https://web.dev/articles/cls>
- **Vollständige Recherche mit allen Seitenzitaten:** Anhang `ergebnis.md` an LFH-327
- **Gestaltungssprache (A0):** `docs/superpowers/specs/2026-07-25-gestaltungssprache.md`
- **UI-Form (LFH-19):** `docs/superpowers/specs/2026-06-22-drawer-nutzung-reduzieren-design.md`
- **Rohbefunde des Sweeps:** `UIUX-Sweep-Befunde.md`, Anhang an LFH-326
