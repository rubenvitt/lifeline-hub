# Token-Fundament, Statusfarb-Vertrag und geteilte Seiten-Primitive (LFH-328 · A2)

> **Status: entschieden.** Diese Spec trifft die vier Entscheidungen, die LFH-328 ausdrücklich
> hierher verweist, hält den gemessenen Ist-Zustand fest und korrigiert die Akzeptanzkriterien
> des Tasks dort, wo sie gegen HEAD nicht halten.
>
> **Quellen:** A0 `2026-07-25-gestaltungssprache.md` (LFH-352, Farb-/Form-/Schriftrollen) ·
> A1 `2026-07-25-bedien-leitlinie-einsatzkontexte.md` (LFH-327, Dichte-Staffel, Gates 4/5/7).
> **Messanker:** HEAD `80eea3a`, Branch `feat/lfh-328-design-token-fundament`, gemessen 2026-07-27.

---

## Beweisregel

Jede Zahl in dieser Spec ist gegen HEAD gemessen, nicht aus dem Task übernommen. Wo Task-Text
und Repo auseinanderlaufen, steht **beides** da — die Task-Angabe als das, was sie ist (ein
Sweep-Stand von vor A0), und der gemessene Wert als der gültige. Abgeleitetes ist als
`[abgeleitet]` markiert.

Der Task nennt an sechs Stellen Pfade oder Zahlen, die gegen HEAD nicht halten. Sie sind in
§4 einzeln aufgeführt. Das ist keine Nachlässigkeit des Tasks — A0 hat zwischen Sweep und
heute große Teile der Theme-Schicht neu gebaut.

---

## 1 — Die vier Entscheidungen

### 1.1 · Die `cssVar`-Weiche: **AUS.** `rollen.css` bleibt die CSS-Wahrheit.

A0 hat diese Frage ausdrücklich hierher vertagt: „**Die Umstellung hat App-weiten
Rendering-Radius und gehört als eigene, bewusste Entscheidung in A2 (LFH-328) — nicht
nebenbei.**"

**Entscheidung: `cssVar: true` wird NICHT gesetzt.** Die Regel für das ganze Frontend lautet ab
hier:

> **TSX liest `theme.useToken()`. Handgeschriebenes CSS liest `var(--lfh-*)` aus `rollen.css`.
> `var(--ant-*)` kommt im Frontend nicht vor.**

Drei Gründe, der erste ist der tragende:

1. **`rollen.css` muss statisch bleiben — das ist unabhängig von `cssVar` entschieden und
   gemessen.** Der Kopfkommentar der Datei hält den Grund fest: `index.html` setzt `data-theme`
   **synchron vor dem React-Mount** (FOUC-Schutz). Eine Property, die erst ein `useEffect` an
   `<html>` hängt, existiert beim ersten Paint noch nicht — jede Regel, die sie liest, fiele auf
   ihren Fallback zurück, und im Nachtbetrieb wäre das ein weißer Blitz. antds `cssVar` erzeugt
   seine Custom Properties zur Laufzeit im React-Baum und ändert daran nichts. `rollen.css` wird
   also durch `cssVar` **nicht überflüssig**.
2. **`cssVar` deckt nur die antd-Teilmenge.** Von den 18 Farbrollen kennt antd 13; `marke`,
   `markeGlut`, `rasterLinie`, `alarmFuellung`/`achtungFuellung`/`normalFuellung` haben kein
   antd-Token. Ebenso `versalSperrung`, `zeilenhoehe`, die Schriftrollen. Mit `cssVar: true`
   stünden im handgeschriebenen CSS **zwei Präfixe nebeneinander** (`--ant-*` für das eine,
   `--lfh-*` für das andere) — mehr Uneindeutigkeit, nicht weniger.
3. **Der Nutzen ist gemessen klein.** Es gibt genau **einen** lebenden `var(--ant-*)`-Konsumenten
   im gesamten Frontend: `pages/EinsatzEinstellungenPage.tsx:476`
   (`var(--ant-color-text-secondary, rgba(0,0,0,0.45))`). Er greift heute nie und rendert immer
   seinen Fallback. Die zweite im Task und in der A0-Spec genannte Stelle — `LoginPage.css:83` —
   **ist gegen HEAD bereits erledigt**: sie liest seit A0 `var(--lfh-marke)`. Für eine
   App-weite Rendering-Umstellung ist ein einziger Konsument keine Begründung.

**Konsequenz für die Akzeptanzkriterien:** Es gilt der Zweig „`cssVar` bleibt aus" →
`grep -rn "var(--ant-color-" frontend/src | grep -v .test.` = **0**. Der Drift-Schutz zwischen
TS- und CSS-Fassung bleibt `theme/rollen.guard.test.ts` (43 Prüfungen) und wird um die
Dichte-Staffel erweitert.

**Was diese Entscheidung nicht ist:** kein Urteil über antd. Wird `rollen.css` eines Tages klein
genug, dass nur noch antd-Rollen darin stehen, ist die Weiche neu zu stellen. Bis dahin ist die
Zwei-Quellen-Redundanz bewusst und durch einen Guard abgesichert.

---

### 1.2 · Rot auseinandersortiert — alle acht Fundstellen einzeln zugeordnet

Der Task nennt „acht `#a8071a`-Kopien" und das AC „heute 9 Treffer". Gemessen sind es
**10 Grep-Treffer**, davon **2 legitim** (`theme/tokens.ts:57`, `theme/rollen.css:38` — das
Marken-Token selbst) und **8 außerhalb der Theme-Schicht**. Von diesen 8 sind **6 lebender
Code** und **2 Kommentar-Erwähnungen**.

Maßgeblich ist nicht das Task-AC, sondern **Gate 5 aus A1** — es ist schärfer, weil es alle
zehn Rollenfarbwerte prüft, nicht nur das Markenrot:

```
grep -rniE '#(b02318|ff7a7f|f5b942|5cc48d|1c6640|7a5200|1a5fa0|6fb4ec|a8071a|e04552)' \
  frontend/src | grep -v '/theme/'
```

**Gemessen: 8 Treffer, alle `#a8071a`. Kein einziger der übrigen neun Rollenwerte ist außerhalb
`theme/` kopiert** — die A0-Werte sind unversehrt. Was das Gate reißt, ist ausschließlich
Altbestand des Marken-Rots.

| # | Stelle | Heute | Bedeutung | Ziel |
|---|---|---|---|---|
| 1 | `einsatz/IconRail.tsx:33` | `background: aktiv ? '#a8071a'` | **Bedienung** — aktiver Zustand der Modul-Navigation | `token.colorPrimary` (blau) |
| 2 | `index.css:59` | `border-left: 3px solid #a8071a` | **Bedienung** — ETB-Erfassungsleiste markiert die aktive Schreibfläche | `var(--lfh-bedien)` |
| 3 | `components/BenutzerMenu.tsx:14` | `AVATAR_FARBE = '#a8071a'` | **Marke** — Markenzeichen im Avatar | `var(--lfh-marke)` bzw. Token |
| 4 | `components/Markdown.css:6` | `--md-akzent: #a8071a` | **Marke** — Akzent in gerendertem Markdown | `var(--lfh-marke)` |
| 5 | `components/Markdown.css:15` | Kommentar über die Dunkelmodus-Korrektur | — | entfällt (siehe unten) |
| 6 | `pages/LoginPage.css:80` | Kommentar über den erledigten Umbau | — | Erwähnung bleibt, Wert ist schon weg |
| 7 | `pages/lagekarte/marker.ts:36` | `EINSATZORT_FARBE = '#a8071a'` | **Marke** — Ortssignatur des eigenen Einsatzes | `farbenX.marke` |
| 8 | `pages/lagekarte/zonenStil.ts:58` | `akut: '#a8071a'` (in `WARNSTUFE_KARTE`) | **Gefahr** — höchste Warnstufe | Statusrolle `alarm`, über `statusFarben.ts` |

**Der `IconRail`-Fall ist der wichtigste.** Er ist genau das, was „Rot bedient nichts"
(LFH-315/A0) meint: eine **Bedienfläche** in Gefahrenrot. Der Task ordnet ihn unter „Marke"
ein — das ist gegen HEAD falsch. `IconRail.tsx:33` färbt nicht ein Markenzeichen, sondern den
**aktiven Zustand eines Navigations-Buttons**. Er gehört auf `colorPrimary`.
Der Task hat für `index.css:59` genau diese Begründung selbst geliefert („markiert die aktive
Schreibfläche — das ist Bedienung, nicht Gefahr"); sie gilt hier gleichermaßen.

**Die zwei Karten-Stellen, die der Task nicht mechanisch umgezogen haben will:**

- **`marker.ts:36` — Einsatzort → Marke.** Der Einsatzort ist der Ankerpunkt des eigenen
  Einsatzes, kein Gefahrenobjekt. Auf `alarm` gezogen läse er sich als Gefahr, und „eine
  Farbe = eine Bedeutung" (A1 Festlegung 5, ASM Consortium) wäre verletzt: `alarm` trüge dann
  Gefahrengebiet **und** Ortssignatur. Marke ist die richtige Rolle — sie bedeutet „das hier
  ist unser Einsatz", genau wie der Akzentstrich „das hier ist unsere Anwendung" bedeutet.
  Nebenbefund derselben Datei: `UHS_FARBE = '#1677ff'` (`marker.ts:37`) ist antd-v5-Default-Blau
  und **nicht** der A0-Wert `bedien` — geht mit auf die Bedienrolle.
- **`zonenStil.ts:58` — Warnstufe → Statusskala, als Ganzes.** Nicht die eine `akut`-Zeile
  umziehen: `WARNSTUFE_KARTE` ist eine **fünfstufige Skala über dem Enum `Warnstufe`**, und
  `Warnstufe` ist eines der Enums, die der Statusfarb-Vertrag ohnehin abdecken muss. Die Skala
  wandert komplett nach `theme/statusFarben.ts`. Details und die Auflösungsfrage in §1.3.

**Die Dunkelmodus-Sonderfälle in `Markdown.css` entfallen.** A0 liefert für jede Rolle einen
eigenen Hell- und Dunkelwert; die parallele `--md-*`-Schicht mit eigenem
`[data-theme='dark']`-Block braucht für den Akzent keine eigene Korrektur mehr. **Nicht im
Auftrag von A2:** die übrigen `--md-*`/`--me-*`-Werte (Flächen, Rahmen) und die zweite
Custom-Property-Schicht als solche — das ist ein eigener Befund, Zielticket in §5.

---

### 1.3 · Der Statusfarb-Vertrag und **seine Grenze**

**Umfang des Vertrags.** `frontend/src/theme/statusFarben.ts` deckt die im Task genannten
Domänen-Enums plus `Warnstufe`:

| Enum | Varianten | Herkunft |
|---|---|---|
| `StatusKategorie` | `verfuegbar` · `gebunden` · `nicht_verfuegbar` | generiert |
| `Verfuegbarkeit` | `frei` · `defekt` · `aufbereitung` · `gesperrt` · `reserviert` | generiert |
| `Warnstufe` | `keine` · `niedrig` · `mittel` · `hoch` · `akut` | generiert |
| `EtbTyp` | `meldung` · `anordnung` · `lage` · `entscheidung` · `system` · `berichtigung` | generiert |
| `UhsStatus` | `geplant` · `aktiv` · `aufgeloest` | generiert |
| `UhsTyp` | `patientenablage` · `behandlungsplatz` · `verletztensammelstelle` · `sonstige` | generiert |
| `BrStatus` | `geplant` · `aktiv` · `aufgeloest` | generiert |
| `BelegungsArt` | `eintritt` · `wechsel` · `austritt` | generiert |

**Die Form eines Eintrags erzwingt den zweiten Kanal.** Das AC verlangt: „ein Eintrag, der nur
eine Farbe liefert, bricht den Typcheck." Also ist `label` **Pflichtfeld**, nicht optional:

```ts
/** Eine A0-Statusrolle. Farbwerte stehen ausschließlich in tokens.ts/rollen.css. */
export type Statusrolle = 'alarm' | 'achtung' | 'normal' | 'neutral' | 'bedien' | 'marke';

/** Zweiter Kanal ist Pflicht (WCAG 1.4.1): `label` trägt ihn immer, `form` optional zusätzlich. */
export interface StatusDarstellung {
  rolle: Statusrolle;
  label: string;                       // Pflicht — nie weglassbar
  form?: 'dreieck' | 'kreis' | 'balken';
}
```

Ein `Record<Enum, StatusDarstellung>` bricht damit bei einer neuen Enum-Variante (fehlender
Schlüssel) **und** bei einem Eintrag ohne Text (fehlendes `label`).

**Die Vertragsgrenze — sie ist Teil des Vertrags, nicht Beiwerk.** Für Fahrzeug- und
Personalstatus kommt die Farbe **aus der Datenbank**:

- `pages/FahrzeugePage.tsx:30` — `const farbe = ef.status_farbe ?? KATEGORIE_FALLBACK[ef.status_kategorie];`
- `pages/PersonalPage.tsx:31` — dieselbe Form mit `ep.status_farbe`
- `types.generated.ts:598/694` — `status_farbe?: string | null`
- Backend `src/routes/fahrzeug_status.rs:18/27/84` und `personal_status.rs:19/27/71` —
  `farbe: Option<String>`, nur `trimme`/`trimme_tri`, **keine Wertevalidierung, kein Enum,
  kein Hex-Format-Check**. Freitext, mandantengepflegt über die Stammdaten-Tabs.

Ein getypter `Record` kann das nicht einfangen — der Tag rendert einen beliebigen String. **Der
Vertrag deckt die Fallback-Achse** (`KATEGORIE_FALLBACK` in beiden Dateien, byte-identisch),
**die DB-Achse bleibt außen** und steht als benannte Grenze im Kopfkommentar von
`statusFarben.ts`. Ohne diesen Satz behauptet das Exhaustivitäts-AC etwas, das nicht gilt.
Dass die DB-Farbe gegen die A0-Rollen validiert werden sollte, ist ein eigener Befund —
Zielticket in §5.

**Das Lage-Dashboard ist nicht Referenz, sondern das fertige Zielmuster.** `lagebild.ts:45`
definiert bereits `type Dringlichkeit = 'alarm' | 'achtung' | 'normal'` — die A0-Rollennamen —
und `lagebild.ts:93` bildet `WARNSTUFE_STUFE: Record<Warnstufe, Dringlichkeit>` ab. Das ist
genau die Abbildung Domänen-Enum → Rolle, die `statusFarben.ts` bauen soll; sie existiert schon,
für `Warnstufe`. Der Vertrag **konsumiert sie**, statt daneben zu leben — sonst entstünde eine
sechste Migrationsklasse.

**Damit löst sich die eigentliche Doppelpflege an dieser Stelle:**

| | `zonenStil.ts:51` `WARNSTUFE_KARTE` | `lagebild.ts:93` `WARNSTUFE_STUFE` |
|---|---|---|
| Auflösung | 5 rohe Hex-Werte | 3 Rollen |
| `keine` | `#cf1322` (Rot!) | `normal` |
| `niedrig` | `#faad14` | `normal` |
| `mittel` | `#fa8c16` | `achtung` |
| `hoch` | `#f5222d` | `alarm` |
| `akut` | `#a8071a` | `alarm` |

**Zwei Abbildungen desselben Enums, die sich bei `keine` widersprechen.** `zonenStil` färbt
`keine` bewusst rot (Kommentar :52-53: „ein noch unbewertetes Gefahrengebiet wird
vorsichtshalber als Gefahr dargestellt, nicht ‚ruhiger' als niedrig"), `lagebild` stuft es auf
`normal`. Beides ist für seinen Kontext begründet — die Karte zeigt ein **Objekt**, das
Dashboard eine **Kennzahl**. Der Vertrag führt sie deshalb **nicht** zu einer Zeile zusammen,
sondern zu einer Quelle mit zwei benannten Lesarten: `warnstufeKarte` (Objektsignatur, `keine`
→ `alarm`) und `warnstufeKennzahl` (Verdichtung, `keine` → `normal`), beide über dieselben
A0-Rollen, beide mit Pflicht-`label`. Der Widerspruch wird damit sichtbar statt zufällig.

**Was NICHT in den Vertrag kommt.** Gemessen existieren rund 30 Farb-/Label-Maps im Frontend.
Die ~20 außerhalb des Task-Auftrags (`personen/personMeta.ts`, `pages/schaeden/schadenHelfer.tsx`,
`kommunikation/phase.ts`, `MaterialPage`, `TierePage`/`TiereDetailPage`, `clusterDonut.ts`,
`taktischesZeichen.ts` u. a.) bleiben **draußen** — sie hineinzuziehen wäre der Bestands-Sweep,
den der Task zweimal ausdrücklich verbietet. Inventar und Zielticket in §5.

**Nachtrag LFH-357 (2026-09-12): die Auflösungs-Begründung oben war auf der Kartenfläche
falsch — korrigiert, nicht umformuliert.**

Diese Spec (und der Doc-Kommentar, den sie erzeugt hat) verteidigte den Auflösungsverlust bei
`warnstufeKarte` mit: *„wer die fünf Stufen unterscheiden muss, nutzt `label` (immer vorhanden)
oder `form`."* Gegen HEAD nachgemessen hielt auf der Lagekarte **keine der beiden Hälften**:

| Behauptung | Gemessener Zustand |
|---|---|
| `label` ist „immer vorhanden" | `pages/lagekarte/kartenLayer.ts:83` setzte `label: z.label ?? ''` — das ist der **Zonenname**. `ZoneStil` hatte kein Feld für Text oder Form. |
| `form` steht als dritter Kanal bereit | In **keinem** Vertragseintrag gesetzt — und grundsätzlich untauglich: `FORM_ZEICHEN` (`components/StatusTag.tsx`) kennt **drei** Zeichen für **fünf** Stufen. |

Operative Folge: `niedrig` und `mittel` sahen auf der Karte identisch aus, ebenso `hoch`,
`akut` und ein Gebiet ohne gesetzte Stufe. Die Rechtfertigung stützte sich damit auf eine
Mitigation, die es an dieser Fläche nicht gab.

**Gegangen ist Weg 2 des Tickets (Warnstufe in den Zonen-Labeltext), und zwar weil Weg 1 die
Zusicherung nicht einlösen kann:** `form` trägt drei Werte, die AK verlangt fünf
unterscheidbare Stufen. `form` bleibt deshalb ungesetzt — ein dritter Kanal, der die Auflösung
gar nicht herstellt, wird nicht gesetzt, bloss weil er existiert. Träger ist die reine,
exportierte `zonenBeschriftung` in `pages/lagekarte/zonenStil.ts`; sie setzt
„Warnstufe: \<label\>" unter den Zonennamen und liest `label` **aus `warnstufeKarte`**, nicht
aus einem eigenen Literal. Zonen ohne Warnstufe (jede andere Zonenart) behalten ihren Namen
unverändert.

**Der Wortlaut `Warnstufe: keine` ist eine Messung, keine Verlegenheit.** „unbewertet" wäre die
naheliegende Formulierung und wäre falsch: `src/gefahr/repo.rs` bildet die höchste Warnstufe
über ein Severity-`MAX`, in dem `'keine'` auf denselben Rang **0** fällt wie *gar keine
Bewertung*. Die Abfrage kann „nichts gesetzt" und „lauter `keine`-Zellen" nicht trennen; ein
Wort, das die Unterscheidung behauptet, behauptet mehr als die Daten hergeben. Die rote Fläche
bleibt davon unberührt — sie ist die Vorsichtsentscheidung von `gefahrengebietStil`, und der
Text sagt jetzt dazu, worauf sie sich stützt.

**Was damit NICHT zugesichert ist:** MapLibre lässt Symbol-Labels bei Kollision weg
(`zonen-label` fährt ohne `text-allow-overlap`). Steht ein Zonenlabel dicht an einem anderen,
kann der Text ausfallen — dann trägt wieder nur die Farbe. Das ist der Bestand seit es die
Zonenbeschriftung gibt und mit Weg 2 nicht schlechter geworden; wer es schliessen will,
braucht einen **graphischen** Kanal (Linienform je Stufe — `line-dasharray` ist in
maplibre-gl 6.8.0 gemessen `cross-faded-data-driven`, also feature-abhängig setzbar). Das ist
eine eigene Entscheidung mit eigener Messung, kein Nebenprodukt dieses Fixes.


---

### 1.4 · Prüfliste Einsatztauglichkeit: **bindet A2 formal nicht — wird für `EinsaetzePage` trotzdem angelegt**

A1 **Gate 7** lautet wörtlich: „Jeder **Band-B- und Band-C-Task** bringt diese Tabelle mit 15
Zeilen und je einem Verdikt mit." A2 ist ein Band-A-Task (Fundament) — die Prüfliste bindet
ihn nicht. Der Satz in `CLAUDE.md` („wird an jede neue oder umgebaute Seite angelegt") ist die
Kurzfassung von Festlegung 7 und meint dort dieselbe Bandgrenze.

**Entscheidung: für die eine Seite, die A2 substantiell im Verhalten umbaut — `EinsaetzePage`
(Lade-/Fehler-/Leer-Zustand) — wird die Prüfliste angelegt** (§6). Begründung: der Umbau ändert
dort, was der Nutzer sieht, nicht nur womit es gestylt ist; und A1 hat die Liste an genau einer
Seite validiert, ein zweiter Anlagefall härtet sie. Für die rein technischen Umzüge
(Token-Bezug, Primitiv-Extraktion, Optionslisten) wird sie **nicht** angelegt — dort ändert
sich das Bedienverhalten nicht.

---

## 2 — Das Token-Fundament

### 2.1 · Die Dichte-Staffel — A1 hat den Weg vorgeschrieben

A1 Festlegung 4, wörtlich: „**Der Weg ist: `tokens.ts` bekommt eine `dichte`-Staffel,
`antdToken()` nimmt sie als Parameter und setzt `controlHeight`/`padding*`/`fontSize` daraus,
`rollen.css` spiegelt sie als `--lfh-*`-Properties.** Der Umbau selbst gehört nach A2
(LFH-328) und B5; die Werte stehen ab hier fest."

A2 baut **den Träger**, nicht die Umschaltung. Die Werte sind zitiert, nicht neu entschieden:

| Rolle | kompakt (A0) | komfortabel | Handschuh |
|---|---|---|---|
| `controlHeight` / Zeilenhöhe | **30** | **48** | **72** |
| Grundschrift | **13,5** | **15** `[abgeleitet]` | 15 `[abgeleitet]` |
| `abstand.md` / `abstand.lg` | 11 / 18 | 18 / 28 `[abgeleitet]` | 26 / 44 `[abgeleitet]` |
| `abstand.xs` / `abstand.sm` | 3 / 7 | 5 / 11 `[abgeleitet]` | 7 / 16 `[abgeleitet]` |
| Kennzahl | 62 | 62 | 62 |

Die `xs`/`sm`-Zeile ist in A1 nicht tabelliert; sie skaliert nach demselben Faktor
(× 1,6 / × 2,4, auf ganze Pixel gerundet) — `[abgeleitet]`, und als solches im Code markiert.

**`componentSize` scheidet aus** (A1): es kennt nur `small`/`middle`/`large`, und `large` endet
bei antd auf `controlHeightLG` = 40 px. Die 48- und 72-px-Stufen sind damit nicht darstellbar.

**Die aktive Stufe bleibt in A2 fest `kompakt`.** Ein Umschalter (Kontext-Erkennung,
Benutzereinstellung) ist **B5**, nicht A2. A2 liefert den Parameter und beweist mit einem Test,
dass die drei Stufen unterschiedliche Tokens erzeugen — mehr nicht.

### 2.2 · Der Nicht-antd-Block `abstand` / `flaeche`

`abstand` existiert bereits (A0). A2 ergänzt `flaeche` — die wiederkehrenden Flächen- und
Breitenmaße, die heute als Inline-Pixel verstreut sind (`maxWidth: 900` in `AdminPage`,
`maxWidth: 960` in `EinsaetzePage`, `paddingTop: 80` an 32 Stellen, `minmax(260px…)`/`(220px…)`
in den zwei Kartenrastern derselben Seite).

**Kein Bestands-Sweep.** `flaeche` ist die Norm für Neues und ohnehin Angefasstes; die
gemessenen Baselines stehen in §5.

---

## 3 — Die Primitive

### 3.1 · `EinsatzSeite` und die Spannung zur A0-Referenzseite

Der Task will `components/EinsatzSeite.tsx` nach dem Muster von `components/AdminPage.tsx` mit
den Slots `titel`, `beschreibung`, `breadcrumb`, `aktionen`, `hinweis`, `children` — und es soll
den Akzentstrich bzw. die Dreiecks-Sektionsmarke aus E tragen.

**Die Spannung:** A0 hat auf der Referenzseite die Seitenüberschrift **entfernt** — „Die
Seitenüberschrift ist weg. Die Bezeichnung steht im Instrumentenband; die Überschriften-Ebene
gehört den Kachelköpfen."

**Auflösung:** Das Lage-Dashboard ist eine **Überblicksfläche** — dort trägt das Instrumentenband
die Identität, und eine Seitenüberschrift wäre eine zweite Nennung derselben Sache. Die
Modul-Arbeitsseiten (Einsatzeinstellungen, Personen, Schäden …) haben kein Instrumentenband und
brauchen die Ortsangabe. `EinsatzSeite` behält deshalb den `titel`-Slot, trägt aber den
**Akzentstrich** als Signatur statt eines schmückenden `Typography.Title` allein.
**`EinsatzSeite` wird nicht auf das Lage-Dashboard angewandt** — das ist die begründete
Abweichung von der Referenzseite, die das AC verlangt.

**Der harte Pin, den man dabei nicht bricht:** `components/AdminPage.test.tsx:21` pinnt
`expect(heading.tagName).toBe('H4')`. `SektionHeader.test.tsx` pinnt seine Ebene **nicht**.
`EinsatzSeite` ist eine **neue** Komponente und lässt beide unberührt; ihre eigene Ebene wird
im eigenen Test gepinnt (H4, gleiche Ebene wie `AdminPage` — eine Seite ist eine Seite).

**Der `aktionen`-Vertrag wird von `AdminPage` übernommen, inklusive seiner Falle:** der Slot
wird **außerhalb jedes `<Form>`** gerendert; ein Speichern-Button dort darf **kein**
`htmlType="submit"` tragen, sondern verdrahtet über `form.submit()`. `AdminPage.test.tsx:28`
pinnt das; `EinsatzSeite` bekommt denselben Test.

### 3.2 · `GeoKennzahlen` — die zwei Distanzformatierer bleiben unberührt

Es existieren **zwei** konkurrierende Formatierer, beide durch Tests gepinnt:

| | `pages/lagekarte/geo.ts` | `anzeige/format.ts:123` |
|---|---|---|
| Funktion | `formatLaenge` / `formatFlaeche` | `formatDistanz` |
| `1500` → | `'1,5 km'` (Intl, de-DE, 1 Nachkomma) | `'1.50 km'` (`toFixed`, 2 Nachkomma) |
| Einheitensystem | hart metrisch | respektiert `AnzeigeKonventionen` (metrisch/imperial) |
| Test | `geo.test.ts:122-128` | `format.test.ts:117-126` |

**`GeoKennzahlen` benutzt weiterhin `geo.ts`** und trägt `tabular-nums` in der Zahlenschrift
(Signatur-Element 3 aus A0). Die Vereinheitlichung der beiden Formatierer bricht zwangsläufig
einen gepinnten Erwartungswert und ist **nicht A2** — Zielticket in §5. Dass die Kartenzahlen
das Einheitensystem des Nutzers ignorieren, ist der eigentliche Befund darunter.

**Korrektur am Task:** `AnsichtSwitcher.tsx:186` ist **kein** GeoKennzahlen-Kandidat — dort steht
ein Radio-Optionsstapel im Lösch-Bestätigungsmodal. Die dort geforderte Änderung
(`Space direction=` → `orientation=`) ist trotzdem richtig und bleibt im Auftrag: es ist die
**letzte verbliebene `direction=`-Stelle** im Frontend gegen 32× `orientation=` — ein
übersehener Rest der antd-6-Migration.

### 3.3 · `FeldLabel` — drei Bauweisen, eine davon im Dunkelmodus defekt

| | Wrapper | Label-Element | Größe | Farbe | `<label>`? |
|---|---|---|---|---|---|
| `Inspector.tsx:107-130` | `<label display:block>` | rohes `<div>` | `12` | **`rgba(0,0,0,0.45)` hart** | ✅ |
| `ZonenInspector.tsx:106` | keiner (Space-Geschwister) | `Typography.Text secondary` | default | Token | ❌ |
| `AnsichtZuordnung.tsx:24-27` | `<div marginTop:8>` | `Typography.Text secondary` | `12` | Token | ❌ |

`Inspector.tsx:109` und `:120` sind der im Task genannte Dunkelmodus-Defekt: schwarze
Beschriftung auf dunklem Grund. `FeldLabel` trägt die **Metadaten-Stimme aus E** (gesperrte
Versalien 2,2 px, `colorTextSecondary`) und das `<label>`-Element **aus der Inspector-Variante**
— sie ist die einzige der drei mit korrekter Assoziation, und A1 Kriterium 15 verlangt „Labels
über dem Feld".

---

## 4 — Wo der Task gegen HEAD nicht hält

| Task-Angabe | Gemessen an HEAD `80eea3a` |
|---|---|
| `pages/lage-dashboard/KennzahlenLeiste.tsx:8` | **existiert nicht.** A0 hat die Kachel-Komponenten entfernt; die Kennzahlen sind inline in `LageDashboardPage.tsx` und fahren bereits über CSS-Rollenklassen (`lfh-kz--alarm`) |
| `pages/stammdaten/StatusKatalogTab.tsx`, `…/PersonalStatusTab.tsx` | `stammdaten/…` (kein `pages/`) |
| `personen/PersonenDetailPage.tsx` | `pages/PersonenDetailPage.tsx` |
| „104 rohe `Typography.Title` in 36 Dateien" | **51 öffnende Tags in 35 Dateien**, davon 2 die Primitive selbst → **49 rohe Call-Sites**. Die 104 zählte Schluss-Tags mit. Weder `<Title`-Kurzform noch `const { Title } = Typography` existieren |
| „viermal kopiertes `<Spin size=\"large\">`" | **32×** `paddingTop: 80` (22 Einzeiler + 10 mehrzeilig) plus 8 Ausreißer mit anderen Zahlen; `AdminLayout.tsx:31` ist eine vierte Layout-Form (`flex` statt `textAlign`). Der Fehler-Zweig daneben ist genauso oft kopiert |
| „`AdminPage` mit 7 Konsumenten" | 7 direkte Import-Sites, **effektiv 17 Seiten** — 11 Stammdaten-Tabs laufen über `adminNav.tsx:42` |
| „`AnsichtSwitcher.tsx:186`" als GeoKennzahlen-Stelle | Radio-Optionsstapel im Lösch-Modal; die `direction`→`orientation`-Änderung bleibt trotzdem richtig |
| AC „heute 9 `a8071a`-Treffer" | **10** Grep-Treffer, davon 2 legitim in `theme/` → **8** außerhalb, 6 lebend |
| `Sidebar.tsx:390` / `:459` | `:393` / `:462`. Und `:462` ist **kein Hex**, sondern `rgba(22,119,255,.06)` = `#1677ff` in rgba-Schreibweise — durch jedes Hex-Grep unsichtbar |
| Task ordnet `IconRail.tsx:33` unter „Marke" ein | Es ist eine **Bedienfläche** (aktiver Navigations-Zustand) → `colorPrimary`. Siehe §1.2 |
| A0-Spec: „`LoginPage.css:83` läuft still auf den Fallback" | **erledigt** — liest seit A0 `var(--lfh-marke)`. Die Aussage über `cssVar` selbst bleibt gültig |

---

## 5 — Was A2 **nicht** tut (Baselines und Zielticket)

Der Task sagt zweimal „**Kein Bestands-Sweep** — verbindliche Norm für Neues und ohnehin
Angefasstes". Diese Zahlen sind gemessene Baselines, kein Auftrag:

| Befund | Baseline (2026-07-27) | A2 macht | Rest |
|---|---|---|---|
| `paddingTop: 80`-Ladezustände | **32** + 8 Ausreißer | Primitiv + die **4** im Task genannten Stellen | **B3** (Datenzustands-Primitive) |
| Rohe `Typography.Title` | **49** außerhalb der Primitive | Primitiv + `EinsatzEinstellungenPage` | Norm; Modul-Umbauten in Band B/C |
| `size="small"` | **236** (Gate-4-Baseline) | keine neuen; angefasste Dateien auf 0 | **B5** |
| Inline-Styles | **729** in 137 Dateien | nur angefasste | Norm |
| Farb-/Label-Maps außerhalb des Vertrags | ~20 | keine | eigenes Ticket, s. u. |
| Hex-Literale außerhalb `theme/` | **165** in 35 Dateien (~54 davon MapLibre-Kartenstil) | nur die im Task genannten | Norm |

**Neue Befunde, die A2 nicht löst — als Ticket zu erfassen:**

1. **DB-Statusfarbe ohne Validierung** — `status_farbe` ist Freitext ohne Format-Check
   (Backend `fahrzeug_status.rs`, `personal_status.rs`); ein Mandant kann eine Farbe pflegen,
   die die A0-Kontrastziele verfehlt oder eine Rollenbedeutung doppelt belegt.
2. **Zwei Distanzformatierer** — `formatLaenge` vs. `formatDistanz`, unterschiedliches Format,
   und die Kartenzahlen ignorieren das Einheitensystem des Nutzers.
3. **Zweite Custom-Property-Schicht** — `--md-*` (`Markdown.css`) und `--me-*`
   (`MarkdownEditor.css`) mit eigenem `[data-theme='dark']`-Block neben `rollen.css`.
4. **Dritte Kopie der Koordinaten-Optionen** — `command-palette/befehle.ts:24-30`
   (`KOORD_BEFEHLE`) mit **abweichenden Labels** gegenüber den zwei Listen, die A2 zusammenführt.
5. **`darfAdmin` existiert dreimal** — `AppLayout.tsx:30` (privat), `AdminLayout.tsx:11`
   (exportiert, wird nicht importiert), `EinsaetzePage.tsx:22` (byte-gleiche Formel, anderer
   Name). A2 löst die ersten beiden über `darfVerwaltung`; die 24 inline
   `system_rolle === 'admin'`-Stellen bleiben (der bestehende Guard scannt `system_rolle`
   bewusst nicht).
6. **`rgba`-getarnte Hex-Werte** — `Sidebar.tsx:462` und die `,.5`-Kurznotation in
   `bildHandles.ts` fallen durch jedes Hex-Grep. Betrifft die Verlässlichkeit von Gate 5.
7. **Der App-Shell fehlt eine Farbrolle** *(im Lauf gefunden, 2026-07-27)* —
   `components/AppLayout.tsx` trägt `'#fff'` (2×), `rgba(255,255,255,0.35)`, `fontSize: 18`,
   `padding: 24`, `gap: 16`. Für **Text auf dunkler Kopfzeile** gibt es in `Farbrollen` keine
   Rolle, und das Abstandsraster ist 3/7/11/18 — `abstand.lg` für `padding: 24` wäre eine
   **visuelle Änderung der App-Shell**, kein Token-Tausch. Die Norm „ohnehin Angefasstes" wurde
   hier deshalb bewusst **nicht** angewandt: einen Wert zu erfinden oder der Shell still ein
   anderes Aussehen zu geben, wäre schlechter als der Befund. Braucht eine Rolle
   `textAufMarke` und eine Entscheidung über den Kopfzeilen-Abstand.

> **Die Norm hat eine Grenze, und Befund 7 zeigt sie.** „Ohnehin Angefasstes vollständig ziehen"
> heißt: auf **vorhandene** Rollen und Token ziehen. Wo keine Rolle existiert, ist der Fund ein
> Befund — keine Einladung, einen Wert zu erfinden. A0 hat die Rollen gemessen; ein
> danebengesetzter Wert wäre genau die Ad-hoc-Entscheidung, gegen die dieser Task antritt.

---

## 6 — Prüfliste Einsatztauglichkeit · `pages/EinsaetzePage.tsx`

Angelegt für die eine Seite, deren **Verhalten** A2 ändert (§1.4). Verdikte beziehen sich auf
den **Zustand nach dem A2-Umbau**.

| # | Kriterium | Verdikt | Beleg / Zielticket |
|---|---|---|---|
| 1 | Treffläche ≥ 24 px, zeitkritisch ≥ 48 px | **erfüllt** | Kacheln sind ganzflächig klickbar (weit über 24 px); der Anlegen-Knopf trägt `controlHeight` = 30 px aus der Theme-Schicht mit ≥ 24 px Umkreis. Kein Element der Seite ist zeitkritisch |
| 2 | Handschuh-Modus, Zeilenhöhe ≥ 72 px | **offen** | A2 legt die Staffel als Token an, schaltet sie aber nicht um → **B5** |
| 3 | Rückmeldung ≤ 100 ms | **erfüllt** | Der A2-Umbau ist genau das: Skeleton statt leerer Fläche, sofort beim ersten Render |
| 4 | Kritische Aktion hat zweite Handlung | **nicht anwendbar** | Die Seite listet und legt an; Anlegen ist nicht irreversibel, Löschen gibt es hier nicht |
| 5 | Kontrast in beiden Modi | **erfüllt** | Alle Farben kommen nach dem Umbau aus den A0-Rollen; deren Werte sind in A0 gemessen (Text 13,47 : 1 dunkel / 18,17 : 1 hell) |
| 6 | Kein Status allein über Farbe | **erfüllt** | Der Status-Tag trägt nach dem Umbau `label` als Pflichtfeld aus `statusFarben.ts` — heute rendert er den rohen Enum-String, was zufällig auch ein Text ist, aber kein Vertrag |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | `aktiv` → `normal`, `abgeschlossen` → `neutral`; keine gesättigte Farbe für den Normalfall |
| 8 | Helligkeits-/Kontrastregler | **offen** | Gibt es in der ganzen Anwendung nicht; A0 und A1 verweisen ihn auf einen eigenen Folge-Task |
| 9 | Kritische Anzeigen im Blickfeld | **nicht anwendbar** | Die Seite zeigt keine kritische Anzeige — sie ist die Einstiegsliste |
| 10 | Alarmbudget | **nicht anwendbar** | Die Seite erzeugt keine Alarme |
| 11 | Warnverhalten | **erfüllt** | Kein Blinken; der neue Fehlerzustand ist ein `Alert` mit Text und Wiederholen-Aktion |
| 12 | Kein Sprung unter dem Cursor | **offen** | Die Liste hängt nicht am SSE-Fan-out, aber der Wechsel Skeleton → Karten ist ein Layoutwechsel; die Skeletons liegen im selben Raster mit derselben Kachelhöhe, CLS ist damit klein, aber **nicht gemessen** → **B6** |
| 13 | Fokus nie verdeckt | **erfüllt** | Die Seite hat kein `position: sticky`/`fixed`; das einzige `sticky` im Frontend ist `.etb-erfassung-sticky` und gehört nicht hierher |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | Kartenraster, keine Tabelle — hier wird gelesen, nicht verglichen (A1 Festlegung 2) |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | Das Anlegen läuft über ein Modal mit einem Feld; die Maske selbst ist nicht Gegenstand von A2 |

**Zwei Zeilen, die der Umbau erst erzeugt hat** (12) und die ohne die Liste niemand gefragt
hätte (6) — die Prüfliste hat an ihrem zweiten Anlagefall wieder etwas gefunden.

---

## 7 — Akzeptanzkriterien, korrigiert

| # | Kriterium | Status gegen Task |
|---|---|---|
| 1 | **Gate 5** (A1): `grep -rniE '#(b02318\|ff7a7f\|f5b942\|5cc48d\|1c6640\|7a5200\|1a5fa0\|6fb4ec\|a8071a\|e04552)' frontend/src \| grep -v '/theme/'` = **0** | **verschärft** — ersetzt das Task-AC „höchstens 2 `a8071a`-Treffer". Gate 5 prüft alle zehn Rollenwerte. Heute: 8 Treffer |
| 2 | `grep -rn "var(--ant-color-" frontend/src \| grep -v .test.` = **0** | unverändert (cssVar-Zweig „AUS", §1.1) |
| 3 | In den angefassten Dateien: `grep -cE "rgba\(0,0,0,0\.\|#f0f0f0\|#1677ff"` = **0** | unverändert |
| 4 | Statusfarb-Vertrag exhaustiv, **per Mutationsprobe belegt** | **erfüllt** — durchgeführt 2026-07-28, Protokoll in §8 |
| 5 | `grep -rn "KATEGORIE_FARBEN\|KAT_FARBE\|STATUS_META\|STATUS_LABEL\|UHS_TYP_LABEL" …` = 0 | **eingeschränkt** auf die Vertrags-Enums. `STATUS_META` benennt 7 fachlich unabhängige Maps (Material, Tier ×2, UHS, BR, Person, Schaden) — die außerhalb des Vertrags bleiben draußen (§5) |
| 6 | Jeder Eintrag trägt einen zweiten Kanal — `label` ist Pflichtfeld | unverändert, Form in §1.3 |
| 7 | `grep -rl "SektionHeader\|EinsatzSeite" … \| wc -l` ≥ 10 | **gilt.** Erreicht über die konsequente Anwendung der Norm auf alle ohnehin angefassten Dateien, siehe unten |
| 8 | Vitest belegt für `EinsaetzePage` drei unterscheidbar gerenderte Zustände (Laden / Fehler / Leer) | unverändert |
| 9 | Guard-Test schlägt fehl, sobald `befehle.ts` die Verwaltungs-Berechtigung selbst beurteilt | unverändert |
| 10 | **Gate 4** (A1): `grep -rn "controlHeight" frontend/src \| grep -v '/theme/'` = 0; `size="small"` ≤ 236 | **ergänzt** — heute grün, muss grün bleiben |
| 11 | Keine angefasste Seite weicht unbegründet von der Referenzseite ab | erfüllt durch §3.1 (Begründung für den `titel`-Slot) |
| 12 | `pnpm lint --max-warnings 0` und `./scripts/check-all.sh` grün | unverändert |

### 7.1 · Zu AC 7 — die Norm gilt für „ohnehin Angefasstes", und das wird ernst genommen

Heute nutzen 2 Dateien `SektionHeader` (1 Konsument + Testdatei). Die naheliegende Lesart —
nur die im Task **wörtlich genannten** Zeilen umzuziehen — landet bei 4–6 Dateien und verfehlt
das AC.

**Die Auflösung liegt in der Task-Norm selbst.** Sie lautet zweimal wörtlich: „Kein
Bestands-Sweep — verbindliche Norm für **Neues und ohnehin Angefasstes**." Der Riegel steht
gegen das *Aufsuchen* fremder Dateien, nicht gegen das *Fertigmachen* der eigenen. A2 öffnet
aus anderen Gründen (Statusfarbe, Token, Primitiv-Extraktion, Zustandslogik) rund **40
Dateien**. Wer eine davon öffnet, um eine Farb-Map zu ersetzen, und den rohen
`Typography.Title` drei Zeilen darüber stehen lässt, wendet die Norm nicht an — er umgeht sie.

**Verbindliche Auslegung für diesen Task:**

> Jede Datei, die A2 aus irgendeinem Grund ändert, wird **vollständig** auf die Zielzustände
> gezogen: Seiten-/Sektionskopf über `EinsatzSeite`/`SektionHeader`, Farben aus den Rollen,
> Abstände aus `abstand`/`flaeche`, Lade- und Fehlerzustand über die Zustands-Primitive,
> `size="small"` auf 0 (Gate 4). Eine Datei, die A2 **nicht** aus anderem Grund öffnet, wird
> nicht aufgesucht.

Damit ist AC 7 erreichbar, ohne den Riegel zu brechen — und die Baselines in §5 bleiben
gültig: was übrig bleibt, bleibt Baseline für Band B/C, nicht weil es zu mühsam wäre, sondern
weil A2 diese Dateien schlicht nicht anfasst.

**Erwarteter Umfang** (die Menge ergibt sich aus §5 und dem Plan, nicht aus einer Zielzahl):
`EinsatzEinstellungenPage` · `EinsatzDefaults` · `AnzeigeEinstellungen` · `EinsatzdatenPage` ·
`EinsaetzePage` · `UnfallhilfsstellenPage` · `uhs/UhsDetailPage` ·
`bereitstellungsraum/BereitstellungsraeumePage` · `bereitstellungsraum/BrDetailPage` ·
`KraefteuebersichtPage` · `PersonenDetailPage` · `MaterialPage` (nur falls von einem anderen
A2-Punkt berührt). Das sind ≥ 10 auch dann, wenn zwei davon wegfallen.

---

## 8 — Mutationsprobe: der Exhaustivitäts-Beweis (durchgeführt 2026-07-28)

Das Akzeptanzkriterium verlangt, dass eine neue Enum-Variante den Typcheck bricht. Eine
**Behauptung** wäre hier wertlos, und ein handgeschriebenes lokales Union-Widening ebenso:
die Varianten kommen aus `types.generated.ts` und ändern sich **nur** über eine
Rust-Änderung plus Regeneration. Der Beweis muss also den ganzen Weg gehen.

**Eine Falle im Ablauf, die vorher nicht bekannt war.** `scripts/check-typ-codegen.sh`
bricht in **Schritt 3** (`git diff --exit-code` auf die regenerierten Dateien), also
**bevor `tsc` in Schritt 4 überhaupt läuft**. Das erfüllt das AC wörtlich — beweist aber
nicht, was es beweisen soll. Der `tsc`-Lauf muss deshalb separat angestoßen werden.

**Durchgeführter Ablauf** (Ziel: `UhsStatus`, `src/uhs/mod.rs:67`):

1. Variante `Mutationsprobe` zu `UhsStatus` ergänzt, `as_str()` und `parse()` mitgezogen.
2. **Erster Fang, noch in Rust:** `cargo build --lib` bricht mit **E0004** an
   `src/uhs/mod.rs:115` (`uhs_status_uebergang_erlaubt`) — der Bestand hat dort einen
   exhaustiven `match`. Für die Probe ergänzt, um bis zum eigentlichen Prüfpunkt zu kommen.
3. `cargo test --test openapi_spec_aktuell` → schlägt an (erwartet), schreibt
   `openapi.json` neu; `grep -c mutationsprobe openapi.json` = 1.
4. `pnpm gen:types` → `types.generated.ts:2114` trägt
   `UhsStatus: "geplant" | "aktiv" | "aufgeloest" | "mutationsprobe"`.
5. **`tsc --noEmit` — der eigentliche Beweis.** Drei Fehler, wörtlich:

```
src/theme/statusFarben.ts(105,14): error TS2741: Property 'mutationsprobe' is missing in
  type '{ geplant: …; aktiv: …; aufgeloest: … }' but required in type
  'Record<"geplant" | "aktiv" | "aufgeloest" | "mutationsprobe", StatusDarstellung>'.

src/pages/uhs/UhsSwitcher.tsx(22,7): error TS2741: Property 'mutationsprobe' is missing in
  type '{ aktiv: number; geplant: number; aufgeloest: number; }' but required in type
  'Record<"geplant" | "aktiv" | "aufgeloest" | "mutationsprobe", number>'.

src/pages/lage-dashboard/lageVerdichtung.ts(118,24): error TS7053: Element implicitly has
  an 'any' type … Property 'mutationsprobe' does not exist on type 'UhsVerdichtung'.
```

6. Rückbau per `git checkout` auf `src/uhs/mod.rs`, `openapi.json`, `types.generated.ts`;
   `git status` sauber; `./scripts/check-typ-codegen.sh` läuft alle vier Schritte grün
   („OK: Backend↔Frontend-Typen sind in Sync").

**Was die Probe zusätzlich gezeigt hat.** Der Vertrag ist nicht das einzige Netz — die
Kette fängt an **vier** unabhängigen Stellen: dem exhaustiven `match` in Rust (E0004), dem
`Record` in `statusFarben.ts`, dem lokal gehaltenen `STATUS_RANG` in `UhsSwitcher` und der
Verdichtung im Lagebild. Der zweite Fund ist der interessanteste: `STATUS_RANG` wurde
bewusst **nicht** in den Vertrag gezogen (fachliche Sortierung, keine Darstellung) — und ist
trotzdem exhaustiv getypt. Die Entscheidung, ihn lokal zu lassen, hat also keine Lücke
aufgerissen.

---

## 9 — Abschluss: gemessen am fertigen Stand (2026-07-28)

`./scripts/check-all.sh` läuft alle sieben Schritte grün durch (Exit 0), inklusive
`cargo test --workspace`, Vitest und der Playwright-Suite (19 e2e-Tests).

| Kriterium | Ziel | Vorher | Erreicht |
|---|---|---|---|
| **Gate 5** — Rollenfarbwerte außerhalb `frontend/src/theme/` | 0 | 8 | **0** |
| `var(--ant-color-` im Frontend (cssVar-Zweig „AUS") | 0 | 3 | **0** |
| **Gate 4** — `controlHeight` außerhalb `theme/` | 0 | 0 | **0** |
| **Gate 4** — `size="small"` repo-weit | ≤ 236 | 236 | **152** |
| `Space direction=` (antd-6-Rest) | 0 | 1 | **0** |
| **AC 7** — Dateien mit `SektionHeader`/`EinsatzSeite` | ≥ 10 | 2 | **15** |
| Vitest | grün | — | **217 Dateien / 1695 Tests** |
| Exhaustivität des Vertrags | belegt | behauptet | **Mutationsprobe, §8** |

**Zur `size="small"`-Zahl.** Die 152 sind kein Sweep-Ergebnis, sondern die Folge der Norm auf
ohnehin Angefasstes: gefallen sind die Vorkommen auf **interaktiven** Elementen in den von A2
geöffneten Dateien. Ein Teil der Container-Vorkommen (`Card` in der Lagekarten-Sidebar) blieb
mit Begründung an der Stelle stehen — dort verkleinert `size="small"` keine Trefffläche,
sondern nur Polsterung, und die Sidebar ist eine schmale Fläche, auf der Kompaktheit gewollt
ist. Das ist die Unterscheidung, die A1 Festlegung 4 selbst zieht. Der Rest bleibt **B5**.

**Zur AC-7-Zahl.** 15 Dateien, davon 3 die Primitive selbst
(`EinsatzSeite.tsx`, `SektionHeader.tsx`, `SeitenZustand.tsx`) — also **12 echte Konsumenten**
gegen vorher 1. Der Grep im Task zählt die Definitionsdatei mit (er tat es auch bei der
Ausgangszahl 2), die Messmethode ist damit unverändert.

**Drei Dinge, die im Lauf gefunden wurden und ohne den Lauf unentdeckt geblieben wären:**

1. **`check-typ-codegen.sh` bricht vor dem `tsc`-Schritt** (§8) — ein Gate, das aus dem
   richtigen Grund rot wird, aber nicht aus dem geprüften.
2. **Ein Erklärkommentar kann sein eigenes Gate reißen.** Zweimal passiert
   (`LoginPage.css`, `SlashMenu.tsx`): erst nannte der Text den Farbwert im Klartext, dann die
   antd-Variable in `var(…)`-Schreibweise. Beide Male war der Code längst richtig und nur die
   Prosa daneben. **Regel: verbotene Konstrukte umschreiben, nicht zitieren** — ein Gate, das
   an seinem eigenen Erklärtext scheitert, erzieht dazu, es abzuschalten.
3. **Ein Parse-Fehler reißt Nachbardateien mit, ohne dass ein Test rot meldet.** Der Lauf
   bricht ab, bevor er beginnt; wer nur seine eigene Testdatei fährt, sieht das nie. Deshalb
   ist die Zahl der **Testdateien** die belastbare Kennzahl, nicht „passed".
