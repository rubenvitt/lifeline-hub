# Design

## Context

Warum: `proposal.md`. Verhalten: Delta-Spec `specs/einsatztauglichkeit-layout/spec.md`.

Heute rollt das Dokument, und was stehen bleibt, klebt per `position: sticky` (LFH-952,
Herleitung `openspec/changes/archive/2026-10-06-lfh-952-app-rahmen-stehen-bleiben/design.md`):

- Die Kopfleiste (`EinsatzLayout`, `AppLayout`, ab `md`) und unter `md` die Betriebszeile bei
  Störung (`LiveStatusBanner`) melden ihre Höhe über `useRahmenObenQuelle` an
  `components/rahmenOben.ts`. Die Summe steht als `--lfh-rahmen-oben` am `<html>` und als
  `useRahmenOben()`.
- Rund 40 Abnehmer hängen sich darunter: klebende Tabellenköpfe (`offsetHeader`), Filterleisten,
  die klebende Detailspalte von `ListeDetail`, `Datensicht`, `restHoehe` (Kurzzeile der Ausgabe),
  der Fokusabstand `scroll-padding-block-start` (`index.css`), die Alarmkante (`alarmOben.ts`).
  Der Guard `rahmenOben.guard.test.ts` hält das fest.
- Die Rail klebt als eine Spalte (`data-lfh="rail-spalte"`: `top` und Höhe aus
  `--lfh-rahmen-oben`, rollt in sich, LLH-1273). Das Verwaltungsmenü klebt ebenso
  (`admin/AdminLayout.tsx`, `seitenleistenStil`).
- Das Modulpanel klebt nicht; nur sein Fuß „Einsatzdauer“ klebt mit `bottom: 0` am Fensterrand,
  mit eigenem Fokusabstand (`einsatz/fussFokusabstand.ts`, Regel in `index.css`, LLH-1241).
- Der Seitenkopf klebt nur im ETB (`EinsatzSeite kopfKlebt`, `etb/etbKopfKleben.ts`, kwc2yszv D8):
  Seitenkopf, Filterleiste und Spaltenkopf kleben dort nur, wenn sie samt Rahmen höchstens ein
  Drittel der Fensterhöhe nehmen (`KLEBEN_HOECHSTENS`). Ihre Höhen stehen in eigenen Variablen
  (`--lfh-etb-seitenkopf-hoehe` u. a.), die Filterleiste rechnet `rahmen-oben + seitenkopf`.

## Goals / Non-Goals

**Goals:**

- Modulpanel und Seitenkopf bleiben ab `md`/`lg` stehen, ohne dass einer der rund 40 Abnehmer
  von `--lfh-rahmen-oben` angefasst werden muss.
- Kein Element verdeckt ein anderes oder ein Fokusziel (WCAG 2.4.11), auch bei 1366 × 520 im
  Handschuh-Betrieb.
- Der ETB-Sonderweg für die Seitenkopfhöhe entfällt.

**Non-Goals:**

- Handy unter `md` (LLH-1728), Offline-Band (LLH-1734), Gerätehülle, Druck.
- Optik von Panel, Rail und Seitenkopf; nur ihr Verhalten beim Rollen ändert sich. Deshalb kein
  Entwurf per `/design`.

## Decisions

### D1 Kleben im Dokument, kein eigener Rollbereich

Das Dokument rollt weiter; Panel und Seitenkopf kleben wie Kopf und Rail.

- *Verworfen: ein Scrollcontainer nur für die Inhaltsfläche* (Kopf, Rail, Panel außerhalb, `main`
  mit `overflow: auto`). Er trifft die Aufgabe wörtlich, bricht aber alles, was heute am
  Fenster-Bildlauf hängt: `window.scrollY` in „Nach oben“ (`etb/nachOben.ts`), der Fokusabstand am
  Dokument, `restHoehe` (rechnet das Dokument und einen eigenen Bereich verschieden), die
  Alarmkante (hört auf `window`-scroll), Ankersprünge, die Wiederherstellung der Bildlaufposition
  beim Zurück-Navigieren und viele e2e-Messungen. Die Abwägung lag am 15.11.2026 vor, der Mensch
  wählte das Kleben.

### D2 Zwei Höhen: Kopf und Rahmen

`rahmenOben.ts` führt die Quellen künftig in zwei Ebenen:

- **Ebene `kopf`**: Kopfleiste und Betriebszeile, wie heute. Ihre Summe steht neu als
  `--lfh-kopf-oben` (und `useKopfOben()`).
- **Ebene `seitenkopf`**: der klebende Seitenkopf. `--lfh-rahmen-oben` (und `useRahmenOben()`)
  ist künftig die Summe beider Ebenen.

Damit bleibt die Bedeutung von `--lfh-rahmen-oben` „was über dem Inhalt klebt“, und jeder Abnehmer
im Inhalt hängt sich ohne Änderung unter den Seitenkopf. Nur was **neben** dem Inhalt oder **im**
Seitenkopf klebt, nimmt `--lfh-kopf-oben`: Rail-Spalte, Modulpanel-Spalte, Verwaltungsmenü und der
Seitenkopf selbst (sonst hinge er unter sich selbst).

- *Verworfen: neue Variable `--lfh-inhalt-oben` für Inhalt, `--lfh-rahmen-oben` bleibt Kopf.*
  Dann müssten alle rund 40 Abnehmer umziehen, und jede künftige Stelle, die die alte Variable
  nimmt, läge still hinter dem Seitenkopf.
- *Verworfen: Seitenkopf meldet sich ohne zweite Variable an.* Dann rutschten Rail und Panel um
  die Seitenkopfhöhe nach unten, und die Höhe hinge von der Seite ab.

Der Guard lässt `--lfh-kopf-oben` nur in einer festen Liste zu (Rail, Modulpanel,
Verwaltungsmenü, Seitenkopf); sonst bleibt `--lfh-rahmen-oben` Pflicht.

### D3 Wann der Seitenkopf klebt

Ein Hook (`components/seitenkopfKleben.ts`, Name im Bau festzulegen) entscheidet für
`EinsatzSeite` und `AdminPage` gleich:

- ab `md` (`useViewport`), unter `md` nie;
- nur, wenn das Dokument rollt: steht der Seitenkopf in einem eigenen Scrollbereich
  (`scrollbereichVon`, Gerätehülle), klebt er nicht;
- nur, wenn es passt: `kopf + seitenkopf ≤ fensterhöhe × KLEBEN_HOECHSTENS` (1/3, dieselbe Regel
  und Konstante wie im ETB, an einen gemeinsamen Ort gezogen).

Solange er klebt, meldet er seine gemessene Höhe als Quelle der Ebene `seitenkopf`. Gemessen wird
wie in `rahmenOben.ts` (Layout-Effekt vor dem ersten Bild, danach `ResizeObserver` und
`resize`, ein Bild später geschrieben, LLH-1335). Die Höhe ändert sich nicht dadurch, dass er
klebt; ein Hin- und Herspringen an der Grenze ist deshalb ausgeschlossen.

Es klebt nur die Seitenkopfleiste (Ortspfad, Titel, Meta, Aktionen), nicht `hinweis`,
`beschreibung` oder `bereiche` darunter. Stil: `top: var(--lfh-kopf-oben)`, Seitengrund, Ebene
`KOPF_KLEBT_EBENE` (30, unter dem Rahmen, über Inhalt und Tabellenköpfen).

`kopfKlebt` bleibt als Prop, aber als **Vorgabe von außen**: fehlt sie, entscheidet der Hook; das
ETB reicht seine eigene, strengere Entscheidung durch (D5).

- *Verworfen: immer kleben ab `md`.* Bei 1366 × 520 im Handschuh-Betrieb blieben dann zwischen
  Seitenkopf und einer angepinnten Fußleiste wenige Zeilen, ein getabbtes Ziel läge verdeckt
  (dieselbe Messung wie im ETB, `e2e/fokus-verdeckung.spec.ts`).

### D4 Modulpanel als klebende Spalte

Das Panel bekommt die Form der Rail-Spalte: eine innere Spalte mit `position: sticky`,
`top: var(--lfh-kopf-oben)`, `height: calc(100dvh - var(--lfh-kopf-oben))`. Darin Kopf (fest),
Liste (`flex: 1`, `min-height: 0`, rollt in sich) und Fuß „Einsatzdauer“ (fest am Ende).

- Kopf und Fuß bleiben so immer im Bild, und kein Teil liegt über einem anderen: die Liste ist der
  einzige Bereich, der rollt. Der Fokus in der Liste rollt nur die Liste, deren Ränder die Kanten
  von Kopf und Fuß sind; der eigene Fokusabstand für den Fuß (`fussFokusabstand.ts` samt Regel in
  `index.css`, LLH-1241) entfällt. Die Rail lässt ihren Fuß dagegen den Kategorien folgen
  (LLH-1273), weil dort Griff und Einstellungen Ziele sind; „Einsatzdauer“ ist reine Anzeige.
- *Verworfen: die ganze Panel-Spalte rollt in sich wie die Rail.* Dann rollte der Kopf mit der
  Kategorie aus dem Bild, und der Fuß folgte den Einträgen; die Anzeige „Einsatzdauer“ wäre in
  niedrigen Fenstern verschwunden.

Die Rail-Spalte und das Verwaltungsmenü ziehen von `--lfh-rahmen-oben` auf `--lfh-kopf-oben` um,
sonst sprängen sie mit dem Seitenkopf nach unten.

### D5 ETB auf der allgemeinen Mechanik

Das ETB behält seine Entscheidung (Seitenkopf, Filterleiste und Spaltenkopf kleben nur gemeinsam,
wenn alle drei ins Drittel passen) und reicht sie als `kopfKlebt` an `EinsatzSeite`. Der
Seitenkopf meldet sich dann wie überall als Quelle, also entfallen:

- `--lfh-etb-seitenkopf-hoehe` (Filterleiste `top: var(--lfh-rahmen-oben)`; Unterkante
  `rahmen-oben + filterleiste`);
- der Seitenkopf-Anteil in `useEtbKopfHoehe` („Nach oben“ rechnet ihn über `useRahmenOben` mit)
  und im Fokusabstand der Marke `etb-kopf-klebt` in `index.css`.

Für die Entscheidung misst das ETB den Seitenkopf weiter selbst (Summe gegen das Drittel), damit
es nicht von der Anmeldung des Seitenkopfs abhängt (sonst Henne und Ei).

### D6 Fokusabstand

`scroll-padding-block-start` am Dokument bleibt `var(--lfh-rahmen-oben)`, wächst also mit dem
klebenden Seitenkopf. Die Ausnahme „Fokus im Rahmen“ (`index.css`) bekommt den Seitenkopf dazu:
steht der Fokus im Seitenkopf, gilt nur `var(--lfh-kopf-oben)`, sonst rollte jeder Tab durch die
Seitenaktionen die Seite. Die bestehende ETB-Ausnahme nimmt dafür ebenfalls `--lfh-kopf-oben`.

## Risks / Trade-offs

- [Weniger Platz für den Inhalt auf mittleren Fenstern: ein klebender Seitenkopf nimmt 44 px und
  mehr, mit Meta-Zeile oder umgebrochenen Aktionen deutlich mehr] → Drittel-Regel; der Kopf
  bricht schon heute erst spät um (`BreiteHalten`, `metaPlatzhalter`).
- [Ein Abnehmer, der `--lfh-rahmen-oben` für etwas neben dem Inhalt nutzt, rutscht um den
  Seitenkopf] → die Liste der Abnehmer beim Bau einmal durchgehen (rund 40 Stellen); der Guard
  benennt die Ausnahmen.
- [Konflikt mit LLH-1725 (Übungsmarke im Rahmen), das `EinsatzLayout`/Kopfleiste ändert] → die
  Marke liegt in der Kopfleiste und zählt damit zur Ebene `kopf`; beim Zusammenführen nur
  Textkonflikte zu erwarten. Wer zuletzt mergt, gleicht ab.
- [Druck] → `position: sticky` wirkt im Druck nicht; die Druck-e2e bleiben der Nachweis.
- [Stehender Alarm unter dem Seitenkopf] → `alarmOben.ts` misst die Unterkante des Seitenkopfs
  schon heute und nimmt das Maximum mit `--lfh-rahmen-oben`; keine Änderung nötig.

## Migration Plan

Reine Frontend-Änderung ohne Daten. Rückweg: Revert des Branches.
