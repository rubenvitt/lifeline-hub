# Fehlergrenze je Kachel (LLH-1958) — Entwurf

Zunder: https://zunder.rubeen.dev/#/aufgabe/ft74hjivesqlac82pjb85h3h

## Absicht

Seit LLH-1822 hat jeder Rahmen eine Fehlergrenze (`components/Fehlergrenze.tsx`). Wirft auf dem
Überblick, im Lagebild oder auf dem Lagemonitor eine einzelne Kachel, ersetzt diese Grenze die
ganze Seite. Im Einsatz verliert die Führung dann wegen eines Fehlers in einem Paneel alle anderen
Lageinformationen. Auf dem Lagemonitor ist es am schlimmsten, denn dort steht niemand, der „Neu
laden“ drückt. Künftig fällt nur die betroffene Kachel aus, und die übrigen bleiben stehen und
bedienbar.

## Ziele

- Wirft eine Kachel beim Zeichnen, zeigt nur sie einen Hinweis. Alle anderen Kacheln bleiben
  stehen.
- Je Wurf geht genau ein Bericht über `meldeClientFehler` an den Server.
- Ein Wächter-Test hält fest, dass jede Kachel von Überblick und Lagebild in einer Grenze steht.
- Abgedeckt sind Überblick, Lagebild, Lagebild-Großbild und Lagemonitor.

## Nicht-Ziele

- Würfe im Rumpf einer Seite, also in den Ableitungen von `UeberblickPage` vor dem JSX, fängt
  weiterhin die Rahmengrenze. Die Ableitungen werden nicht in die Kacheln verschoben.
- Andere Dashboard-Flächen bekommen die Grenze in diesem Task nicht. Die Regel gilt aber für jede
  neue Kachel auf den vier Flächen.
- Fehler beim Laden von Daten (Abfragefehler) bleiben Sache von `PaneelZustand` (Zustand
  `fehler`). Die Grenze fängt nur Würfe beim Zeichnen.

## Anti-Ziele

- Meldung oder Stack des Wurfs im DOM. Wie bei der Rahmengrenze gehen sie nur an den Server.
- Doppelte Berichte: Rahmengrenze und Kachelgrenze dürfen nicht beide für denselben Wurf melden.
- Eine Grenze, die das Fugenraster oder das Kachelraster des Monitors verschiebt. Sie fügt keine
  eigene Box ins Layout ein.

## Ansätze

1. **`KachelGrenze` am Aufrufort (gewählt).** Eine eigene Klasse mit `getDerivedStateFromError`
   und `componentDidCatch`. Die Seite schließt jede Kachel einzeln darin ein. So fängt sie auch
   Würfe in den Hooks und im Kopf einer Paneel-Komponente (etwa `OffeneVorgaengePaneel`), dazu in
   Alarmzeile und Kennzahlenband. Preis: Jeder Aufrufort muss daran denken, und das deckt der
   Wächter ab.
2. **Grenze im Körper von `DashboardPaneel`.** Sie gälte automatisch auf jeder Dashboard-Fläche.
   Sie fängt aber nichts aus Kopf und Hooks der Paneel-Komponenten, nichts aus Alarmzeile und
   Kennzahlenband und nichts aus den Kacheln des Lagemonitors. Verworfen.
3. **Wächter als Quelltext-Scan** statt als Render-Test. Er wäre billiger, bricht aber beim
   Umformatieren und übersieht ausgelagerte Kacheln. Verworfen zugunsten des Render-Wächters.

Am 19.11.2026 gewählt: Ansatz 1, alle vier Flächen, Render-Wächter.

## Entwurf

### Komponente `components/KachelGrenze.tsx`

- Eine Klassenkomponente, denn eine Error-Boundary gibt es nur als Klasse. Sie hängt nicht am
  Router (`errorElement`).
- Props:
  - `titel: string` gibt den Namen der Kachel für den Hinweis.
  - `form?: 'paneel' | 'gross'` hat die Vorgabe `paneel`.
  - `neuversuch?: unknown` ist ein Schlüssel. Ändert er sich, setzt die Grenze ihren Fehler
    zurück und zeichnet die Kachel neu, wie `resetKeys`.
  - `children`.
- Umhüllung: `<div data-lfh-kachelgrenze="" style={{ display: 'contents' }}>`. Grid und Flex der
  Reihe sehen weiterhin die Kachel als Kind, und der Wächter findet die Grenze über `closest`.
- Bericht: `componentDidCatch(fehler)` ruft `meldeClientFehler(fehler, window.location.pathname)`.
  Das `WeakSet` dort hält den Bericht auch unter StrictMode bei einem einzigen. Weil die
  Kachelgrenze den Wurf fängt, erreicht er die Rahmengrenze nie, und es geht genau ein Bericht ab.
- Ersatz in der Form `paneel` (Überblick, Lagebild):
  - Ein `Paneel` mit dem Kacheltitel als Augenbraue, im Fugenraster ohne eigenen Rand (`IM_RASTER`).
  - Die Kante steht in `alarm`, wie bei der Rahmengrenze.
  - Text: „Diese Kachel konnte nicht angezeigt werden“, darunter „Der Fehler wurde gemeldet.“
  - Ein Knopf „Neu laden“ ruft `window.location.reload()`, wie die Rahmengrenze. Das holt auch
    einen neuen Chunk.
  - Marke: `data-lfh="kachelgrenze"`.
- Ersatz in der Form `gross` (Lagemonitor, Lagebild-Großbild):
  - Ohne Knopf, denn auf dem Monitor bedient niemand etwas (`pointer-events: none`).
  - Titel und Text in Großbildmaß (`grossMass`, mindestens 28 px; `geraet/AGENTS.md`).
  - Text: „Diese Kachel konnte nicht angezeigt werden.“
  - Die Seite reicht ihren Datenstand als `neuversuch` durch. Mit jedem neuen Datenstand versucht
    die Kachel es also von selbst noch einmal.

### Wo die Grenzen stehen

| Fläche | Kacheln, jede in einer eigenen `KachelGrenze` |
| --- | --- |
| Überblick (`pages/fuehrung/UeberblickPage.tsx`) | Alarmzeile, Startliste, Nächste Marken, Offene Vorgänge, Einsatzabschnitte, Entscheidungen |
| Lagebild (`pages/lage-dashboard/LageDashboardPage.tsx`) | Alarmzeile, Kennzahlenband „Lage in Zahlen“, Verlauf bzw. Gefahrenmatrix, Sichtung, Meldungsstrom, Kennzahlenband „Stand“ |
| Lagebild-Großbild (`LagebildGrossbild.tsx`, Form `gross`) | Alarmzeile, Kennzahlen, Verlauf- bzw. Gefahrenblock, Sichtungsblock, Stand |
| Lagemonitor (`geraet/LagemonitorPage.tsx`, Form `gross`, `neuversuch` = `lageQuery.dataUpdatedAt`) | Alarmzeile, Lagekarte, Meldungen, Ablauf, jede Kachel aus `Kacheln` (Sanitätsdienst bzw. Betroffene, Kräfte, …) |

Das Sammelbanner im Lagebild ist keine Kachel und bleibt ohne Grenze.

### Wächter

- Marke `data-lfh-kachel` am äußeren Element von `DashboardPaneel`, `AlarmZeile`, `Kennzahlenband`
  und an der `Kachel` des Lagemonitors.
- Der Render-Test zeichnet Überblick und Lagebild mit den vorhandenen Test-Fixtures, mit möglichst
  vielen sichtbaren Kacheln (Startliste an). Er prüft:
  - Es gibt mindestens so viele Kacheln wie erwartet.
  - Jedes Element mit `[data-lfh-kachel]` hat `closest('[data-lfh-kachelgrenze]')`.
  - Keine Grenze steht um zwei Kacheln derselben Reihe.
- Für den Lagemonitor gibt es denselben Test, wenn die vorhandenen Fixtures das billig hergeben.
  Das entscheidet, wer baut.

### Regel

Neue Regel in `frontend/AGENTS.md` bei „Jede Rahmenebene hat eine Fehlergrenze“: **Jede Kachel
einer Lagefläche hat ihre eigene Fehlergrenze.** Sie gilt für Überblick, Lagebild, Großbild und
Lagemonitor. Jede Kachel steht einzeln in `KachelGrenze` (`components/KachelGrenze.tsx`). Die
Form `gross` ohne Knopf, mit Neuversuch über den Datenstand, gilt für Flächen ohne Bedienung.
Wächter sind die Render-Tests, Nachweis ist der Komponententest. Den Lagemonitor nennt zusätzlich
ein Satz in `frontend/src/geraet/AGENTS.md`, wenn dort Kachelregeln stehen.

### Tests

- Komponententest `KachelGrenze`:
  - Ein werfendes Kind zeigt den Ersatz, und das Geschwister daneben bleibt bedienbar.
  - `meldeClientFehler` wird genau einmal gerufen.
  - Weder Meldung noch Stack stehen im DOM.
  - `neuversuch` setzt die Grenze zurück.
  - Die Form `gross` zeigt keinen Knopf.
- Die Render-Wächter wie oben.

## Dem Bauenden überlassen

- Die genaue Optik des Ersatzes innerhalb der Gestaltungssprache (Abstände, Höhe). Er soll die
  Höhe der Reihe nicht sprengen.
- Den Schlüssel `neuversuch` im Großbild nimmt der Bauende aus dem Datenstand, den die Seite
  schon hat.
- Ob der Lagemonitor einen eigenen Render-Wächter bekommt (s. o.).
