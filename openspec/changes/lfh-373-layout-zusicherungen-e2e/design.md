# Design

## Context

Die Motivation steht in proposal.md unter „Why“. Die Anforderungen stehen in
`specs/einsatztauglichkeit-layout/spec.md`. Hier geht es um das Vorgehen.

**Vorab-Messung (24./25.09.2026, Wegwerf-Spikes, Playwright-Chromium, Maschinenlast
120–180):**

| Messung | kompakt | handschuh |
|---|---|---|
| ETB-Erfassungsleiste 390 × 844 / 390 × 600 / 1366 × 768 | 298 / 298 / 259 px | 497 / 497 / 440 px |
| davon Reiterzeile · Karte (390 px) | 38 · 225 | 90 · 372 |
| Textfeld-Breite bei 390 px (zwischen Präfix und „Erfassen“) | — | 124 px |
| Zeitachsenband 390 × 844 ohne Leiste: Band / Karte | 130 / 695 | 256 / 612 |
| Knopfblock 390 × 844 ohne Leiste: oben · Höhe | 161 · 166 | 244 · 366 (Unterkante 610, Band ab 576) |
| „Abspielen“ Breite × Höhe (390 px) | 16 × 30 | 17 × 72 |
| Matrix-Hülle `scrollWidth`/`clientWidth` 390 · 1024 · 1366 | 583/342 · 583/433 · 775/775 | 838/312 · 838/388 · 838/730 |

**Nicht gemessen, Hypothesen:** die ETB-Leiste bei 1024 × 768 und die CLS-Summe beim
Laden aller drei Routen. Beide stehen als MUST in der Spec. Ein roter Befund dort wird im
Change gefixt (Aufgaben 6.1 und 6.5).

Die e2e-Suite hat Bausteine für diese Arbeit, die vorhandenen Messkerne reichen aber
nicht an allen Stellen:

- `e2e/gate3-trefflaeche.spec.ts` stellt `STAFFEL`, `stelleDichte` (localStorage plus
  Neuladen plus `data-dichte`-Wache), `haeltStufe` und `alleHaltenStufe`. Beide Helfer
  prüfen nur Untergrenzen und nur die Höhe.
- `e2e/fokus-kern.ts` (`pruefeFokusVerdeckung`) wertet ausschließlich `position: sticky|fixed`
  als Verdecker. Die Kartenaufbauten sind `absolute`. Ein Lauf über die Lagekarte wäre
  deshalb durch Konstruktion grün, und der Zähler `fixierteKandidaten` würde von den
  angepinnten Füßen der Rail und des Modulpanels gefüllt. Der Kern ist mit
  `fokus-verdeckung`, `befehl-aktionsleiste`, `dokumente` und `pegel-pruefliste` geteilt.
- Der CLS-Beobachter liegt dreimal lokal vor (`einsatzauswahl-cls`, `pegel-pruefliste`,
  `betroffene-layout`).
- `:root { scroll-padding-block-end: var(--lfh-befehl-fokusabstand, 0px) }` in
  `pages/befehlAktionsleiste.css` ist die einzige Fokusabstand-Regel. Ein zweiter
  `:root`-Block mit derselben Eigenschaft würde sie überschreiben.

## Goals / Non-Goals

**Goals:**
- Jede Zusicherung der Spec kann im e2e rot werden: Dichte-Wache, Gegenprobe in `kompakt`
  und Vorbedingungszähler (Bildlaufreserve, Überlauf der Tabelle, besuchte Ziele).
- Die Fixes folgen aus dem Layout und nicht aus einer geratenen Zahl. Wo eine Zahl nötig
  ist, kommt sie aus einer exportierten Konstante oder einer gemessenen Höhe.
- Die geteilten Kerne ändern ihr Verhalten für Bestandsaufrufer nicht.

**Non-Goals:**
- Die Stufenableitung aus dem Einsatzkontext (LFH-724).
- Die zwei übrigen CLS-Kopien (`pegel-pruefliste`, `betroffene-layout`). Sie bleiben
  lokal, nur die Neuen lesen aus `cls-kern.ts`.
- Das Wachsen der Gebietsliste bei einem neuen Gefahrengebiet (LFH-334, bekannt offen).
- Die Rückwärts-Hypothese an der stehenden Kopfzeile der Matrix ist kein eigenes Ziel.
  Sie wird gemessen (Aufgabe 4.3), gefixt wird nur, wenn sie rot ist.

## Decisions

### D1 · Ablage der Nachweise

Zeile 2 kommt als neue Blöcke in `gate3-trefflaeche.spec.ts`. Der Kopfkommentar lädt
dazu ein, die Helfer liegen dort, und die Datei hat kein `hasTouch` auf Dateiebene, sodass
alle drei Stufen auf einem Kontext laufen. Zeile 13 kommt in `fokus-verdeckung.spec.ts`,
weil dort der Selbstbeweis des Kerns liegt. Für Zeile 12 entsteht eine neue Datei
`e2e/leisten-flaeche.spec.ts`: Deckel, Umbruch und CLS sind eine eigene Frage, und die
Datei braucht keinen der Fokus-Helfer.
`gefahren-matrix-zelle.spec.ts` bleibt unverändert. Es belegt M51 am Tablet (44 px mit
`hasTouch`) und ist kein Staffel-Nachweis.

*Verworfen:* eine eigene Datei je Fläche. Das ergäbe drei weitere Kopien von
`anmelden`/`stelleDichte`, gegen die Einladung im gate3-Kopf.

### D2 · Messhelfer für die kurze Achse

`gate3-trefflaeche.spec.ts` bekommt eine Variante von `alleHaltenStufe`, die
`min(Breite, Höhe)` prüft und das größte Maß zurückgibt. Die Gegenprobe braucht nämlich
eine **Obergrenze** in `kompakt`: Eine reine Untergrenze bliebe grün, wenn jedes Ziel in
jeder Stufe 72 px mäße. Die Böden stehen als Literale im Test, darunter der Kartenknopf
mit 32 in `kompakt` und die Menüeinträge mit 24 in `kompakt`.

### D3 · `fokus-kern.ts` opt-in für absolute Aufbauten

`pruefeFokusVerdeckung(page, schritte, optionen?)` mit
`optionen.zusatzKandidaten: string[]` (Selektoren) und `optionen.region?: string`
(Selektor, zählt `stoppsInRegion`). Ohne `optionen` bleibt das Verhalten unverändert. Das
belegen die Bestandsspecs, die ohne Änderung grün bleiben. Die Kandidaten der Karte stehen
als explizite Liste da (`[data-lfh="karten-fuss"] > *`, `[data-lfh="karten-knoepfe"]`,
`[data-lfh="karten-ueberlagerung-links"]`).
*Verworfen:* „alles mit `position: absolute`“. Dann würden Canvas, Marker und
antd-Portale zu Kandidaten und lieferten falsche Treffer.

Ein neuer Selbstbeweis legt eine absolute Attrappe über einen Kartenknopf und verlangt
genau einen Treffer. Ohne `zusatzKandidaten` muss derselbe Lauf null Treffer liefern.
Das belegt, dass die Option wirkt und dass die Vorgabe sie nicht still enthält.

**Teilverdeckung:** Der Kern meldet nur vollständige Verdeckung, und das ist WCAG 2.4.11
(AA). Für die angepinnten Leisten (ETB) kommt zusätzlich ein Freistreifen dazu:
Unterkante des Ziels gegen Oberkante der Leiste. Liegt dafür in
`befehl-aktionsleiste.spec.ts` ein allgemeiner Helfer, zieht er als reiner Move mit nach
`fokus-kern.ts`, damit keine zweite Kopie entsteht.

**Startpunkt:** Jeder Durchlauf fokussiert sein erstes Ziel ausdrücklich mit
`locator.focus()`. Das ETB fokussiert beim Einhängen das Textfeld am Seitenfuß, ein nacktes
Tab nach `goto` liefe also an der Zeitachse vorbei.

### D4 · Fokusabstand unten, gemeinsam für Befehl und ETB

Aus der seitenlokalen Regel wird **eine** globale Regel,
`:root { scroll-padding-block-end: var(--lfh-fokusabstand-unten, 0px) }`, und ein Hook
`useFokusabstandUnten(ref)`. Der Hook beobachtet die Höhe der angepinnten Leiste per
`ResizeObserver`, setzt die Variable und räumt sie beim Aushängen weg. `BefehlDetailPage`
und `EtbPage` nutzen ihn. Da nie beide Seiten gleichzeitig eingehängt sind, gibt es keinen
Streit um die Variable.
*Verworfen:* ein zweiter `:root`-Block in einer ETB-CSS-Datei. Er würde den Block der
Befehlsseite still überschreiben, weil beide dieselbe Eigenschaft setzen.
`befehlAktionsleiste.css:26-34` verlangt, genau das zu prüfen.
*Verworfen:* `scroll-margin` an den Zielen. In LFH-465 blieb das im Browser gemessen
wirkungslos.
`e2e/befehl-aktionsleiste.spec.ts` bleibt der Regressionsnachweis für die Befehlsseite.
Dort ändert sich nur der Name der Variable.

### D5 · Gefahrenmatrix: Scroll-Abstand der fixierten Spalte

Die Tabelle bekommt eine Klasse. Ihr Scrollcontainer (`.ant-table-body`, mit `sticky`
statt `.ant-table-content`) erhält `scroll-padding-inline-start` in der Breite der
fixierten Spalte. Die Breite 180 wird als Konstante aus `GefahrenMatrix.tsx` exportiert,
dieselbe Konstante trägt die Spaltendefinition und die Regel (Inline-Stil oder
CSS-Variable). So kann die Zahl nicht auseinanderlaufen.
*Verworfen:* die Spalte „Gefahr“ auf schmalem Schirm nicht mehr fixieren. Die Zeilen
verlören dann ihre Beschriftung, sobald man seitlich scrollt, und das ist der Grund für die
Fixierung.

### D6 · Lagekarte: Knopfspalte und Fuß teilen sich die Breite

Der Fußrahmen endet rechts vor der Knopfspalte:
`right = FUSS_ABSTAND + knopfKante + FUSS_ABSTAND`. Damit wird `fussStil` zu einer reinen
Funktion der Knopfkante (`kartenKnopfKante(token)`). Knopfblock und Fußbänder können sich
dann bei keiner Höhe mehr überschneiden. Das folgt aus der Breitenaufteilung, nicht aus
einem `zIndex`, derselbe Grundsatz wie beim Stapeln der Bänder in LFH-355. Wo die
Personenkarte (`BetroffeneKarte.tsx`) einen Fuß trägt, gilt dieselbe Funktion.
*Verworfen:* ein höherer `zIndex` für den Knopfblock. Er würde das Band verdecken, nur
andersherum.
*Verworfen:* dem Knopfblock eine Höchsthöhe mit eigenem Bildlauf geben. Dann wären
Kartenknöpfe versteckt, gerade im Handschuh-Betrieb.

### D7 · Zeitachsenband: Deckel in Hebelstufen

Das schmalere Band aus D6 bricht öfter um. Die Hebel werden in dieser Reihenfolge
gezogen, und nach jedem wird gemessen. Aufgehört wird, sobald der Deckel in allen Stufen
hält:

1. Das Bezeichnungsfeld verliert seine feste Breite von 180 px (`flex: 1 1 120px;
   minWidth: 0`). Das nicht umbrechbare `Space.Compact` ragte sonst über das Band hinaus.
2. „Abspielen“ bekommt `flexShrink: 0`. Heute schrumpft der Knopf auf 16 px, das ist
   ein eigener Befund zu Zeile 2 und wird unabhängig vom Deckel gefixt. **Dieser Hebel
   allein bricht die Breite:** Der Zeitleisten-Block ist eine innere Flex-Zeile ohne
   Umbruch (`minWidth: 260`, darin „Aktuell“, „Abspielen“, Schieber mit `minWidth: 120`
   plus Rand und „Live“ mit `minWidth: 96`). Mit einem 72 px breiten Knopf braucht er im
   Handschuh-Betrieb rund 400 px. Heute stehen 342 px zur Verfügung, nach D6 noch etwa
   258 px. Deshalb gehört zu Hebel 2 zwingend, dass der Block umbrechen darf: Schieber und
   „Live“ bilden unter `md` eine eigene Zeile. Das kostet eine Zeile.
3. Unter `md` wird „Stand sichern“ zu einem Knopf, der die Bezeichnung in einem
   `ErfassungsModal` abfragt (ein Feld, LFH-19 „Modal ≤ 3 Felder“), statt das Feld
   inline zu führen. Wegen der zusätzlichen Zeile aus Hebel 2 ist das voraussichtlich
   Pflicht und keine Reserve.

**Sind alle Hebel gezogen und der Deckel hält noch nicht, wird zurückgefragt.** Der
Deckel wird dann nicht still gesenkt und nicht eigenmächtig mit weiteren Umbauten
erkauft.

### D8 · ETB-Erfassungsleiste: Deckel in Hebelstufen

Die `Schnellerfassungszeile` wird auch von der Personenseite benutzt. Die Umbrüche kommen
deshalb über eine **opt-in-Eigenschaft**, die das ETB setzt. Die Personenseite bleibt
unberührt. Hebel in dieser Reihenfolge, nach jedem wird gemessen:

1. Unter `md` steht das Textfeld auf eigener, voller Breite. Typ-Präfix und „Erfassen“
   folgen in einer Zeile darunter. Heute ist das Feld auf 124 px eingezwängt, und der
   Platzhalter bricht es auf 133 px Höhe.
2. Der Umschalter „Vorschau“ des `MarkdownEditor` (`layout="toggle"`) wandert aus der
   eigenen Zeile unter dem Feld in die Aktionszeile neben „Erfassen“. Dafür bekommt der
   Editor eine Eigenschaft, die den Umschalter nach außen reicht (Render-Prop oder
   gesteuerter Zustand). Die übrigen Aufrufer behalten ihre Zeile. Das spart im Fükw eine
   volle Steuerhöhe und ist der einzige Hebel, der dort auf 50 % führt (440 → etwa 360 px).
3. Unter `md` wird die Hinweiszeile verkürzt. Befehle und Einheit stehen schon im
   Platzhalter („/ für Typ, Felder & Bausteine · @ für Einheit“). Der
   **Tastaturvertrag** (`ENTER_HINWEIS`) steht dort aber nicht, und CLAUDE.md
   (Erfassungs-Norm, Nacharbeit LFH-335) trennt beide Aussagen ausdrücklich. Die Form ist
   am Checkpoint (25.09.2026) entschieden: **einzeilige Kurzform nur mit dem Vertrag**
   („↵ senden · ⇧↵ neue Zeile“). Verworfen ist, die Zeile unter `md` ganz entfallen zu
   lassen, weil der Vertrag dann auf dem Gerät fehlte, auf dem Enter auf der
   Bildschirmtastatur am ehesten überrascht.

**Sind alle Hebel gezogen und der Deckel hält noch nicht, wird zurückgefragt**, nicht
still gesenkt.

Der Deckel wird in einem Ruhezustand gemessen, den der Test herstellt: ein Entwurf,
keine gesetzten Felder, Menüs zu.

### D9 · CLS

`beobachteShifts`, `leseShifts`, `setzeShiftsZurueck` und `ruheShifts` ziehen als reiner
Move aus `einsatzauswahl-cls.spec.ts` nach `e2e/cls-kern.ts`. `einsatzauswahl-cls` bleibt
grün und belegt damit den Move. Gemessen wird ohne `hadRecentInput`, nach
`document.fonts.ready`, dazu je Messung eine Vorbedingung (Zelle trägt die neue
`data-warnstufe`, 58 Zellen stehen), sonst wäre „kein Sprung“ trivial wahr. Für den
Chip-Umbruch des ETB ist CLS blind, weil er einer Eingabe folgt. Dort wird die Geometrie
gemessen: die y-Lage der Zeitachsenzeilen vor und nach dem Umbruch.

### D10 · Prüflisten und Verweise

Die Juli-Prüflisten (ETB, Lagekarte, Gefahrenmatrix) bleiben als Dokument ihres Stands
erhalten. Jede bekommt einen datierten Abschnitt „Nachtrag LFH-373 (Messung,
TT.MM.2026)“ mit einem Verdikt je betroffener Zeile, der Messgröße und der Spec-Datei.
Dasselbe gilt für die LFH-613-Prüfliste (1·13, 4·13) und die LFH-342-Prüfliste
(Zeile 12 wird von „erfüllt“ korrigiert, Zeile 13 aufgelöst). Die sechs Verweise auf die
Stufenableitung werden auf LFH-724 umgeschrieben. Zum Schluss steht
`grep -rn "LFH-373" docs frontend openspec CLAUDE.md`, und jeder Treffer braucht ein
Verdikt oder einen neuen Verweis. CLAUDE.md verliert zwei überholte Aussagen: dass die
Lagekarte bei 390 px nicht messbar sei, und die implizite Annahme im LFH-355-Absatz. Dazu
kommen zwei Zeilen zu den neuen Mechanismen (Fokusabstand unten, Knopfspalte).

### D11 · Mutationsprobe je neuem Nachweis

Nach dem Muster aus LFH-396 wird je neuem Test mindestens eine Mutation gefahren:
Kopien `*-mut*.tmp.spec.ts` per Skript, ein gemeinsamer Lauf mit `--reporter=json`, die
Kopien werden danach gelöscht. Die tragenden Mutationen sind der jeweils zurückgedrehte
Fix (muss rot werden), die festgenagelte Dichte (die Wache muss rot werden), die
Obergrenze der Gegenprobe (hartkodierte 72 px müssen rot werden) und der Kern ohne
`zusatzKandidaten` auf der Karte (muss rot werden, solange der Fix fehlt). Das Ergebnis
steht im Kopfkommentar der Spec.

## Risks / Trade-offs

- [Laufzeit von `check-all.sh` Schritt 7 steigt: drei Stufen × mehrere Breiten ×
  Tab-Läufe] → Seiten werden je Test einmal geseedet und die Stufen im selben Kontext
  umgeschaltet. Tab-Läufe starten gezielt beim ersten Ziel, nicht am Dokumentanfang.
- [Flakes unter Last: Schriftentausch, Menüanimation, langsamer Kaltstart von Vite] →
  `document.fonts.ready` vor Positionsvergleichen, `expect.poll` auf eingeschwungene
  Kästen, Inhaltsanker statt `networkidle` (die Einsatzroute hält SSE offen).
- [D8 greift in `Schnellerfassung` ein, deren Vitest-Suite Struktur und Tastaturwege
  prüft] → die Hebel sind opt-in, die bestehenden Tests müssen unverändert grün bleiben.
  Neue Struktur wird als reine Stilfunktion geprüft (Muster `bedienzielStil`).
- [D6 macht das Zeitachsenband in jeder Breite um die Knopfspalte schmaler, im Fükw 86 px]
  → gemessen und hingenommen. Die Alternative ist eine Überlagerung, die Knöpfe unbedienbar
  macht.
- [D7 Hebel 3 ändert die Bedienung auf dem Handschirm: „Stand sichern“ braucht einen
  Klick mehr] → nur unter `md` und nur, wenn Hebel 1 und 2 nicht reichen.
- [Ein Deckel von 50 % ist eine gesetzte Zahl, keine Norm] → er steht in der Spec, im
  Test als Literal mit Herleitung und in der Prüfliste. Wer ihn ändert, ändert alle drei.

## Migration Plan

Reine Frontend- und Teständerung ohne Datenmigration. Das Rollback läuft über den
Revert der Commits. Einzige Verhaltensänderung für Bestehendes: Die Variable der
Befehlsseite heißt `--lfh-fokusabstand-unten` statt `--lfh-befehl-fokusabstand`. Beide
Seiten wechseln im selben Commit.
