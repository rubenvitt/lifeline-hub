# Design

## Context

Motivation und Messwerte stehen in `proposal.md` („Why“), die Anforderung in
`specs/einsatztauglichkeit-layout/spec.md`.

Stand heute:

- `Kennzahl` (`frontend/src/components/instrument/Kennzahl.tsx`) rendert die Notiz als
  `<span data-lfh="kennzahl-notiz">` mit `fontSize: 11`, `lineHeight: 1.4`,
  `overflowWrap: anywhere`, ohne Zeilenzahl. Die Zelle ist eine Flex-Spalte; das Band ist ein
  Grid, jede Reihe so hoch wie ihre höchste Zelle.
- `Kennzahlenband` hat seit LFH-629 die Prop `notizZeilenSchmal`. Sie setzt die
  Custom-Property `--lfh-kennzahl-notizzeilen` und die Klasse
  `lfh-kennzahlenband--notizzeilen`. `theme/sprache.css` gibt der Notiz darüber **unter `md`**
  eine `min-height` (Boden, kein Deckel). Lage-Dashboard und Überblick setzen sie auf 2.
- Ab `md` gilt nichts davon. Dort hängt die Bandhöhe an der längsten Notiz der Reihe.
- Vorbild für die Kürzung: der Meldungsstrom (`pages/lage-dashboard/LagePaneele.tsx`) kürzt
  den Eintrag mit `-webkit-line-clamp: 2` und trägt den vollen Text im `title`.

## Goals / Non-Goals

**Goals**

- Ab `md` eine feste Notizhöhe je Band, vom ersten Bild an (auch im Ladezustand mit
  „wird abgerufen“), also ohne Messung in JS und ohne Neurendern beim Größenwechsel.
- Gekürzter Text bleibt für Maus und Screenreader vollständig.
- Bänder ohne die neue Angabe bleiben pixelgleich.

**Non-Goals**

- Kein allgemeiner „Text kürzen“-Baustein. Die Regel bleibt eine Eigenschaft des
  Kennzahlenbands.
- Keine Änderung unter `md` (LFH-629 bleibt, der Spec `lagebild-cls-schmal` misst das weiter).

## Decisions

### D1 · Drei Zeilen als Boden und Deckel (Entscheidung des Menschen, 01.10.2026)

Ab `md` bekommt jede Notiz eines Bands mit fester Notizhöhe `min-height: N · 1,4em` und
`-webkit-line-clamp: N` (mit `display: -webkit-box`, `-webkit-box-orient: vertical`,
`overflow: hidden`). Boden und Deckel zusammen machen die Notiz genau N Zeilen hoch, egal wie
lang ihr Text ist. Für „Lage in Zahlen“ ist N = 3.

Warum 3: Nach der Messung passt damit jede heute erzeugte Notiz ab 1440 px ganz, auch der
Pegel mit Prognose und „+1 weitere“ (3 Zeilen bei 186 px). Bei 1200 px braucht diese Notiz
4 Zeilen; gekürzt wird dann ihr Ende. Der Browserblick der Umsetzung zeigt die dritte Zeile
bei „Prognose 7,10 m bis…“, Uhrzeit der Prognose und „+1 weitere“ stehen nur im `title` und im
zugänglichen Namen (am Checkpoint war nur „+1 weitere“ angenommen). „Evakuiert“
braucht höchstens 2 Zeilen und wird nie gekürzt.

Erwogene Alternativen:

- **2 Zeilen fest:** das kompakteste Band (etwa 15 px niedriger). Bei 1200 und 1440 px stünden
  aber Prognose, „veraltet“ und „+n weitere“ des Pegels nur noch im `title`. Das verletzt das
  zweite Akzeptanzkriterium („keine Aussage geht verloren“). Verworfen.
- **Nur Boden von 2 Zeilen, kein Deckel:** keine Kürzung, und der Fall „Evakuiert“ wäre
  behoben. Aber eine Prognose, die erscheint oder abläuft, ließe das Band unter 1920 px weiter
  springen, um 1 bis 2 Zeilen. Das erste Akzeptanzkriterium wäre nur für einen Auslöser erfüllt.
  Verworfen.
- **Kürzere Notizen:** würde die Pegel-Notiz umformulieren (Spec `lage-wetter-pegel`, Tests in
  `pegel/`), ohne eine Obergrenze zu garantieren: Gewässernamen und „+n weitere“ bleiben
  variabel. Verworfen; das Ticket zielt auf den Baustein.
- **„Nur wachsen, nie schrumpfen“** (Band misst seine Notizen per `ResizeObserver` und hält
  die größte Höhe): ohne Kürzung, aber das Band wüchse beim ersten langen Text trotzdem,
  bräuchte JS-Messung und nach jedem Breitenwechsel einen Neuanfang. Verworfen.

### D2 · Neue Band-Prop `notizZeilen` neben `notizZeilenSchmal`

`Kennzahlenband` bekommt `notizZeilen?: number` („Notizhöhe ab `md` in Zeilen, Boden und
Deckel“). Die Prop setzt die Klasse `lfh-kennzahlenband--notizfest` und die Custom-Property
`--lfh-kennzahl-notizzeilen-fest`. Die Regel steht in `sprache.css` unter
`@media (min-width: 768px)`, gegenüber der Schwelle von LFH-629 (`max-width: 767.98px`).
Die beiden Bereiche überschneiden sich also nicht.

Warum zwei Props statt einer: Unter `md` ist die Bandbreite halbiert, dort kürzen hieße den
Pegel schon nach dem Gewässer abzuschneiden; LFH-629 hat deshalb bewusst nur einen Boden
gesetzt. Die beiden Bereiche haben verschiedene Regeln, also zwei Angaben. Eine einzige Prop
mit Breitenstufen-Objekt wäre allgemeiner, aber kein Verbraucher braucht mehr als diese zwei
Stufen.

Warum CSS statt `abBreite('md')` in JS: Die Media-Query gilt vom ersten Bild an und ohne
Neurendern. Ein Hook-Wert käme nach dem ersten Paint und erzeugte genau den Sprung, den die
Change verhindern soll. Dasselbe Argument trug LFH-629.

### D3 · `title` nur an der gekürzten Notiz eines festen Bands

Der vollständige Text bleibt im DOM: `line-clamp` kürzt nur die Darstellung. Der zugängliche
Name des Kennzahl-Links (sein Textinhalt) enthält ihn also ganz, Screenreader lesen alles.

Für den Mauszeiger braucht die gekürzte Notiz einen `title`. `Kennzahl` erfährt über einen
React-Kontext des Bands, dass es eine feste Notizhöhe hat, und setzt dann im Zustand `daten`
an eine Notiz aus Text (`string`) `title={notiz}`. Warum nicht immer: Im Zustand `fehler`
trägt schon die Zahl `title="Stand unbekannt"`, ein zweites Element mit demselben `title`
machte `getByTitle` in bestehenden Tests mehrdeutig. Außerdem bekäme jedes andere Band
Hinweistexte, die nichts verbergen.

Warum nicht nur bei tatsächlicher Kürzung (Messung `scrollHeight > clientHeight`): das hieße
Messen nach dem Layout und bei jedem Größenwechsel. Ein `title`, der den sichtbaren Text
wiederholt, schadet nicht; der Meldungsstrom macht es genauso.

### D4 · Nachweis im Browser, nicht in Vitest

Vitest läuft ohne CSS (siehe Test zu LFH-629 in `Kennzahl.test.tsx`). Vitest belegt deshalb
nur Klasse, Custom-Property und `title`. Höhe und Kürzung belegt ein neuer Playwright-Spec
`e2e/kennzahlenband-notizhoehe.spec.ts` bei 1200, 1440 und 1920 px:

1. **Standmeldung:** Einsatz mit einem Evakuierungsbezirk (Plan 1 850, geschätzt, ohne Stand),
   Notiz „von ≈ 1 850 geplant · 1 ohne Meldung“. Höhe des Bands messen, Stand per API melden,
   warten, bis „ohne Meldung“ verschwindet, erneut messen. Die Höhe ist gleich, und die obere
   Kante der Paneelreihe (`data-lfh="lagebild-paneele"`) bleibt, wo sie war.
2. **Pegel:** dieselbe Breite einmal mit kurzer, einmal mit langer Pegel-Notiz (Pegel-Abruf
   per `page.route` aus einem Literal, wie in `lagebild-cls-schmal`). Die Bandhöhe ist gleich.
3. **Keine Aussage verloren:** Die Notiz „… ohne Meldung“ ist nicht gekürzt
   (`scrollHeight ≤ clientHeight` am Notiz-Element) und enthält „≈“.
4. **Kürzung trägt den Text:** Bei 1200 px ist die lange Pegel-Notiz gekürzt, ihr `title`
   enthält „+1 weitere“, und der zugängliche Name des Links enthält es ebenso.

Die Mutationsprobe: `notizZeilen` am Lage-Dashboard entfernen → (1) und (2) rot.

## Risks / Trade-offs

- [Das Band ist immer drei Notizzeilen hoch, auch wenn alle Notizen einzeilig sind (bei
  1920 px fast immer), etwa 31 px mehr als heute im Einzeilenfall.] → Bewusst gewählt: eine
  feste Höhe ist der Preis für „kein Sprung“. Der Spec annotiert die gemessene Bandhöhe je
  Breite, damit eine spätere Verdichtung den Wert kennt.
- [Eine künftige, noch längere Notiz wird gekürzt, ohne dass ein Test rot wird.] → Der
  `title` und der zugängliche Name tragen den Text weiter. Die Regel in `frontend/AGENTS.md`
  sagt, dass die tragende Aussage einer Notiz vorn steht.
- [`-webkit-line-clamp` braucht `display: -webkit-box`; das Element ist ein Flex-Kind der
  Zelle.] → Das Muster läuft im Meldungsstrom schon in derselben Seite. Der Spec misst die
  Höhe im echten Chromium. Die Desktop-Hülle nutzt WebKit/WebView2, beide unterstützen
  `-webkit-line-clamp`.
- [Gate 1 (`gate1-ueberlauf`) prüft Querlauf über `scrollWidth`.] → Die Kürzung wirkt nur
  senkrecht und erzeugt keinen Querlauf.
