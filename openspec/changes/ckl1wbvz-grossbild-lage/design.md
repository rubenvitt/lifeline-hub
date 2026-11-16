# Design

## Context

Motivation: `proposal.md`, „Why“. Stand am 16.11.2026:

- **Lagebild** (`pages/lage-dashboard/LageDashboardPage.tsx`) rechnet alle Werte in der Seite selbst:
  `useLagebild` + `baueLagebild`, Gefahrenmatrix je Gebiet, Führungsstand aus dem Modulzähler
  (`fuehrungsZahlen.ts`), Zustände je Kennzahl (`kennzahlZustand`), Datenstand. Die Bausteine
  (`Kennzahl`, `Paneel`, `VerteilungsPaneel`, `MatrixPaneel`, `Datenraster`) haben feste Größen von
  10–13 px; `DashboardFlaeche` hat Inhaltshöhe, deshalb bleibt das untere Drittel leer.
- **Lagebesprechung** (`pages/LagebesprechungPage.tsx`): `TerminPaneel` (Kennzahl „Nächste
  Lagebesprechung“ mit `lagebesprechungZustand`) und `VorbereitungPaneel`, das seine Zeilen intern
  aus `useLagebild`, `baueLagebild` und `vorbereitungsZeilen` baut. Die Zeile ist ein lokales Grid
  `minmax(0, 1fr) minmax(0, 1.6fr)` mit Wert `text-align: end` (Zeile 188/199): bei voller Breite
  rund 1500 px zwischen Bezeichnung und Wert.
- **Lagemonitor** (`geraet/LagemonitorPage.tsx`): feste Größen `GROSS = {96, 72, 28, 32}`, lokale
  Bausteine `Kachel` und `Zahl`, Vollbild über `requestFullscreen`, Wachhalten über
  `useBildschirmWach`. Wird parallel in LLH-1746 umgebaut; diese Change fasst die Datei nicht an.
- Regeln: Dichte folgt dem Gerät, nie der Person (`frontend/AGENTS.md`, Spec `bedien-dichte`);
  `schriftskala` ist dichteunabhängig; Farben nur aus `theme/` (Gate 5); Übung nur über
  `UebungsMarke`/`UebungsBand` (ADR-0053); die Inhaltsfläche des Rahmens hat keinen eigenen
  Rollbereich (ADR-0054); Alarme stehen in der Alarmzone (LLH-1735).

## Goals / Non-Goals

**Goals:**

- Eine Ansicht je Seite, die bei 1920 × 1080 die Größen des Lagemonitors erreicht und auf anderen
  Schirmen im selben Verhältnis bleibt.
- Kein zweiter Rechenweg: das Großbild liest dieselben Werte, die die Seite schon hat.
- Kleiner Fußabdruck in den Seiten, damit LLH-1743 (Alarmzeile im Lagebild-Kopf) sauber
  zusammenläuft.

**Non-Goals:**

- Großbild für weitere Seiten (Überblick, Meldebild, Lagekarte). Die Hülle ist dafür offen, gebaut
  wird sie hier nur für zwei Seiten.
- Bedienung im Großbild (Sprünge, Termin setzen, Übernahme, Abschluss).
- Umbau des Lagemonitors auf die neuen Bausteine und die Alarmzeile „Was brennt“ im Großbild
  (Folgeaufgaben, s. Migration Plan).
- Eine Großbild-Stufe für Formulare oder die übrige App.

## Decisions

### D1 Großbild ist ein Zweig der Seite, keine eigene Route und keine Dichte-Stufe

Die Seite hält einen Zustand `istGrossbild` und rendert, solange er gilt, zusätzlich die
Großbild-Ansicht. Die normale Seite bleibt darunter gemountet. Damit laufen Abfragen, Live-Kanal,
gehaltener Kennzahl-Zuschnitt und Rollposition weiter, und „verlassen“ führt an dieselbe Stelle.

- *Eigene Route* (`…/lage-dashboard/grossbild`): bräuchte eine zweite Zusammenstellung derselben
  Werte oder einen Umbau der Seite in Hook + Darstellung. Beides kollidiert mit LLH-1743, das
  dieselbe Seite umbaut, und die Route müsste außerhalb des Einsatzrahmens hängen. Verworfen.
- *Vierte Dichte-Stufe*: bricht `bedien-dichte` (Stufe folgt dem Gerät), wirkt auf die ganze App
  und erreicht die festen px-Werte der Bausteine nicht. Verworfen (mit Ruben am 16.11.2026).
- *Größenachse in allen Instrument-Bausteinen*: die Seite selbst wüchse, aber jeder Baustein und
  jede Seite mit ihm wäre betroffen, samt Design System; Sprünge und Knöpfe blieben im Bild.
  Verworfen.

Der Zustand steht nur im React-State: nicht in der Adresse, nicht im Speicher (Spec, „Ausstieg“). Vollbild braucht ohnehin eine Geste; eine Adresse, die nach dem Neuladen ein Großbild
ohne Vollbild zeigt, brächte nichts außer einem neuen Deeplink.

### D2 Hülle `GrossbildFlaeche`: Portal, Element-Vollbild, Wachhalten, Esc

`components/grossbild/GrossbildFlaeche.tsx` rendert per Portal in `document.body` eine Fläche mit
`position: fixed; inset: 0`, eigener Ebene über dem Rahmen (über der Alarmzone, unter nichts, denn
im Großbild öffnet sich kein Dialog) und `overflow: hidden`. Beim Öffnen fordert sie
`element.requestFullscreen()` **für diese Fläche** an, nicht für das Dokument: im Element-Vollbild
zeigt der Browser nur sie, Rahmen und Alarmzone sind ohne weiteres Zutun weg. Scheitert die
Anforderung oder fehlt die API (iPhone), füllt die feste Fläche das Fenster.

- `fullscreenchange` ohne Vollbild-Element → `onVerlassen()`. Deckt Esc im Vollbild und den
  Ausstieg über Browsermittel ab.
- `keydown` Esc ohne Vollbild → `onVerlassen()`.
- Hat der Browser das Vollbild beim Öffnen abgelehnt (die Fläche füllt dann nur das Fenster),
  zeigt die Kopfzeile „Vollbild“, solange `document.fullscreenElement` nicht die Fläche ist; ein
  Klick ist die Geste, die der Browser für einen zweiten Versuch braucht. Ohne Vollbild-API fehlt
  der Knopf.
- Solange die Fläche steht, trägt `<html>` `overflow: hidden` (ein Rad über der Fläche rollte sonst
  das unsichtbare Dokument), beim Verlassen wird der vorige Wert wiederhergestellt.
- ADR-0054 bleibt gewahrt: die Inhaltsfläche des Rahmens bekommt keinen Rollbereich, die Hülle liegt
  außerhalb des Rahmens und rollt gar nicht.
- Wachhalten: `components/grossbild/useBildschirmWach.ts`, inhaltsgleich mit dem Hook des
  Lagemonitors. Importieren aus `geraet/LagemonitorPage.tsx` hieße, die Seite samt Kartenbibliothek
  in den Lagebild-Chunk zu ziehen; die Datei verschieben hieße, sie gegen LLH-1746 anzufassen. Die
  Doppelung räumt die Folgeaufgabe „Lagemonitor auf Großbild-Bausteine“ ab. Kein Hinweis zum
  Bildschirmschoner im Großbild: es läuft am Bedienplatz, nicht unbeaufsichtigt.

Die Kopfzeile der Hülle trägt links den Titel der Seite (Menüname) und `meta` (Uhrzeit, Stand),
rechts die Alarmzahl (D6), die Übungsmarke (`UebungsMarke`, `groesse="monitor"`) und die Knöpfe
„Vollbild“ (nur ohne Vollbild) und „Großbild verlassen“. Der Fokus springt beim Öffnen auf
„Großbild verlassen“ und kehrt beim Verlassen auf den Knopf „Großbild“ zurück. Die Fläche ist ein
`role="dialog"` mit `aria-modal` und dem Titel als Namen.

### D3 Mitwachsende Größen über eine Großbild-Skala

`components/grossbild/grossMass.ts` führt die Bezugsgrößen des Lagemonitors für 1920 × 1080
(Zahl 96, Zahl klein 72, Titel 32, Text 28, dazu Abstände) und rechnet sie in CSS-Längen um, die
mit dem Fenster gehen:

```ts
GROSS_EINHEIT = 'var(--lfh-gross-einheit, min(0.05208333vw, 0.09259259vh))'
grossMass(px) === `calc(${GROSS_EINHEIT} * ${px})`
```

Ein Vorfahr kann die Einheit über `--lfh-gross-einheit` festsetzen: die Vorschau im Design System
(kein ganzes Fenster), später der Lagemonitor, wenn er bei festen Pixeln bleiben soll.

Bei 1920 × 1080 ist das genau `px`, bei 1280 × 720 zwei Drittel, bei 3840 × 2160 das Doppelte; das
kleinere Verhältnis gewinnt, ein schmales oder flaches Fenster bricht also nicht über den Rand. Ein
JS-Messwert (`useViewport`) ist nicht nötig, die Regel `useViewport.guard` bleibt unberührt.
`schriftskala`, `rollen.css` und die Dichte-Staffel ändern sich nicht.

- *Feste px wie der Monitor*: auf einem Beamer mit 1280 × 720 liefe der Inhalt über, auf 4K wirkte
  er klein. Verworfen (Ruben, 16.11.2026).
- *`clamp()` mit Unter- und Obergrenze*: eine Untergrenze bräche bei kleinen Fenstern die Regel
  „ohne Bildlauf“. Verworfen.

Die Werte stehen bis zur Folgeaufgabe doppelt (`GROSS` im Monitor, `GROSS_BEZUG` hier).

### D4 Drei Bausteine statt Großbild-Varianten der Instrument-Bausteine

Unter `components/grossbild/` (Import über `index.ts`, Dateikopf nennt die Regel):

- `GrossKennzahl`: Bezeichnung (Text), darunter die Zahl (Mono, `tabular-nums`, `zahl` oder
  `zahlKlein`), darunter die Notiz (Text). Töne `alarm`/`achtung`/`neutral` über die Statusrollen wie
  `Kennzahl` (`statusFlaeche.ts`), Zustände `laden` (Platzhalter gleicher Höhe), `fehler`
  („nicht geladen“) und „—“ mit Grund. Kein `ziel`, kein Link.
- `GrossZeile`: Bezeichnung und Wert in einer Zeile, der Wert in einer Spalte direkt rechts der
  Bezeichnung (gemeinsames Raster der Liste, nicht `space-between`), Notiz unter dem Wert; optional
  eine Farbmarke vor der Bezeichnung (Sichtungskategorie, Warnstufe) mit Wort, nie Farbe allein.
- `GrossbildFlaeche` (D2) mit `GrossBlock` als Überschrift einer Gruppe (Augenbraue in
  Großbild-Größe).

Warum nicht `Kennzahl groesse="riesig"`: die Instrument-Bausteine tragen Links, Tooltips und
Dichteabhängigkeiten, die im Großbild alle entfallen müssten; eine eigene Familie bleibt klein und
taugt später auch für den Lagemonitor. Jeder Baustein bekommt eine Karte in `PREVIEWS`
(`frontend/scripts/design-system/previews.tsx`, Nacht und Tag), das Design System wird neu erzeugt
(`frontend/AGENTS.md`, „Größere UI-Entwürfe über das Design System“).

### D5 Inhalt und Aufteilung je Seite

**Lagebild** (`pages/lage-dashboard/LagebildGrossbild.tsx`): Die Seite reicht ihre schon
berechneten Werte durch (`lagebild`, `kennzahlZustand`, Gefahrenmatrix-Zeilen und -Zustand,
Sichtungszeilen, Verlauf bei „Sanitätsdienst“, Aufträge/Meldungen-Stand, Führungsstand,
Datenstand, `jetzt`). Die Abbildung „Kennzahl + Zustand → Anzeige“ (gesperrt → „—“ mit
`NICHT_FREIGEGEBEN`, Ton, Notiz) wird als reine Funktion neben `lagebild.ts` gezogen und von Seite
und Großbild benutzt, damit kein Ton und kein „—“ auseinanderläuft. Aufteilung bei 16:9:

```
┌ LAGEBILD 1430 · Stand vor 12 s            1 Alarm offen · ÜBUNG · [Großbild verlassen] ┐
│  Kennzahl 1   │ Kennzahl 2    │ Kennzahl 3      (Band 3 × 2, Zahl 96, lange Werte 72)   │
│  Kennzahl 4   │ Kennzahl 5    │ Kennzahl 6                                              │
│  Gefahren je Typ (GrossZeile) │ Sichtung SK I–IV, ohne │ Führungsstand 2 × 2 (Zahl 72)  │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Das Band steht in drei Spalten statt sechs: die Stärke („0/12/58//70“) braucht in 72 px rund
475 px, eine von sechs Spalten hat bei 1920 px nur rund 300. Werte ab sieben Zeichen stehen in der
kleinen Zahl. Der Entwurf zeigt noch die Reihe aus sechs.

Die Fläche füllt die Höhe (Raster mit `1fr` für die untere Reihe), es bleibt kein leeres Drittel.
Der Meldungsstrom entfällt: ETB-Text ist aus 3 m in 28 px nur in wenigen Zeilen lesbar und kein
Lagewert. Die Gefahrenzeilen zeigen höchstens so viele Typen, wie hineinpassen, absteigend nach
Warnstufe, darunter „+ n weitere“.

**Lagebesprechung** (`lagebesprechung/LagebesprechungGrossbild.tsx`): oben der Termin groß
(`GrossKennzahl` mit `ZeitAnzeige` und dem Wort aus `lagebesprechungZustand`, Ton `achtung` nach
Spec), daneben „Abgeschlossen“; darunter die Vorbereitungszeilen als `GrossZeile` in zwei Spalten
(Reihenfolge spaltenweise), mit „Stand HH:MM“. Die Zeilen kommen aus `useVorbereitung` (D7).

### D6 Alarme als Zahl, nicht als Liste

Das Element-Vollbild verdeckt die Alarmzone. Damit ein Alarm nicht ungesehen bleibt, zeigt die
Kopfzeile die Zahl der Einträge, Alarme als „n Alarm(e) offen“ in Alarmrolle, Org-Hinweise als
„n Hinweis(e) offen“ in Bedienrolle, ohne Titel: die
Einträge können Namen tragen, und das Großbild steht vor allen im Raum. Ton spielt die App wie
sonst. Quittiert wird nach dem Verlassen. Erwogen: die Alarmzone im Großbild mitzeichnen; sie ist
eine Rahmenquelle mit Stapel-Logik (`useRahmenObenStapel`) und Bedienknöpfen, beides gehört nicht
in eine Ansicht ohne Bedienung.

### D7 `useVorbereitung` statt zweiter Zusammenstellung

Die Zeilenberechnung aus `VorbereitungPaneel` (Lagebild, Zustände, Zähler, Stand) wird als Hook
`lagebesprechung/useVorbereitung.ts` herausgezogen; `VorbereitungPaneel` und das Großbild rufen ihn
auf. Zwei Aufrufe teilen sich über TanStack Query dieselben Abfragen, es entsteht kein zweiter Abruf.
Übernahme in den Lagebericht und ihre Rechte bleiben im Paneel.

### D8 Zeilenraster der Vorbereitung

Spalten `minmax(0, min(16em, 40%)) minmax(0, 1fr)`, beide linksbündig: Zeile 1 Bezeichnung | Wert,
Zeile 2 Quelle | Notiz. Bei voller Breite beginnt der Wert damit höchstens 16 em (≈ 216 px bei
13,5 px) rechts der Bezeichnung, auf 390 px nimmt die Bezeichnung höchstens 40 %. Die Attribute
`data-lfh="vorbereitung-zeile"` und `data-teil="wert"` bleiben, die e2e-Suite findet die Werte
weiter.

### D9 Knopf „Großbild“

Sekundär (umrandet) im Slot `aktionen` des Seitenkopfs, mit Symbol und Wort, erst ab `md`: auf dem
Handy gibt es keinen Beamer-Fall, und der Kopf hat dort keinen Platz. Im Lagebild steht er hinter
Datenstand und Warnhinweis, in der Lagebesprechung links vom Primärknopf. Kein Eintrag in der
Sprungpalette.

## Risks / Trade-offs

- [LLH-1743 baut den Kopf des Lagebilds um] → Großbild-Änderungen an `LageDashboardPage.tsx` auf
  drei Stellen begrenzt (Zustand, Knopf im `aktionen`-Slot, Zweig nach `</EinsatzSeite>`); wer
  zuletzt mergt, holt `alpha` und löst. Die Alarmzeile kommt per Folgeaufgabe ins Großbild.
- [Doppelte Bezugswerte und Wachhalten neben dem Lagemonitor] → Folgeaufgabe „Lagemonitor auf
  Großbild-Bausteine“, nach dem Merge von LLH-1746 anzulegen und im PR verlinkt.
- [Element-Vollbild in jsdom nicht vorhanden] → Unit-Tests stubben `requestFullscreen` wie
  `LagemonitorPage.test.tsx`; die echte Größe prüft eine e2e-Spec bei 1920 × 1080 und 1280 × 720
  (Schriftgröße per `getComputedStyle`, kein Bildlauf).
- [Viele Gefahrentypen oder lange Notizen sprengen die Höhe] → Gefahrenzeilen begrenzt mit „+ n
  weitere“, Notizen einzeilig mit Auslassung; die e2e-Spec prüft mit den Demo-Daten.
- [vh in mobilen Browsern mit Leiste] → im Großbild unkritisch (Vollbild); ohne Vollbild am Handy
  ist der Knopf ohnehin nicht da (D9).
- [Neue Ansicht verändert die Bilder der Anwenderdoku] → Kapitel `lagebild` und `lagebesprechung`
  im selben PR anpassen und ihre Bilder neu aufnehmen (Mitänderungsregel).

## Migration Plan

Reines Frontend, keine Migration, kein Schalter. Rückweg: Revert des PRs. Nach dem Merge:

- Design System aus `alpha` neu veröffentlichen (neue Karten `GrossKennzahl`, `GrossZeile`,
  `GrossbildFlaeche`).
- Folgeaufgaben über `zunder-task-anlegen`: „Lagemonitor auf Großbild-Bausteine“ (nach LLH-1746),
  „Alarmzeile ‚Was brennt‘ im Großbild“ (nach LLH-1743).
