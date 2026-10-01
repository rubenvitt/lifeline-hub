# Design

## Context

Befund und Reproduktion stehen in `proposal.md` (Why). Für den Entwurf zählen diese Stellen:

- `frontend/src/abloesung/AbloesungKarte.tsx`: Die Karte ist ein Flex mit Zeitspalte
  (`minWidth: 64`, `paddingInline: token.padding`) und Inhaltsspalte. Die Zeitspalte zeigt
  `ZeitAnzeige format="kurz"` in `monoStil(13, 500)`. Die Sekundärzeile ist **ein**
  `Text type="secondary"`: Abschnitt · „im Einsatz seit“ Beginn (`kurz`) · „Rhythmus“
  `rhythmusText` „(Vorgabe des Abschnitts | eigener Wert)“.
- `formatZeitKurz` (`anzeige/format.ts`) liefert `HHmm` für heute und sonst `DDHHmm`, „heute“
  in der Anzeigezone.
- Die Seite friert die **Folge** der Karten ein, der **Inhalt** bleibt frisch (LFH-660,
  `abloesung/zufluss.ts`). Höhe und Breite der Karte schützt bisher nichts außer Reserve.
- Projektregel (`frontend/AGENTS.md`): Was in fester Breite steht, bricht um, statt zu kürzen.

Gemessen im Browser (e2e-Backend, Chromium, Schrift „LFH Archivo“ geladen). „Inhalt“ ist der
Platz für Text in der Inhaltsspalte bei fester Zeitspalte (sechs Ziffern):

| Fläche | Zeitspalte heute → anderer Tag | Inhalt bei fester Spalte |
| --- | --- | --- |
| Fükw 1366 px `kompakt` | 64 → 71 px | ≈ 950 px |
| Tablet 1024 px `handschuh` | 89 → 101 px | ≈ 560 px |
| mobil 390 px `kompakt` | 64 → 71 px | 274 px |
| mobil 390 px `komfortabel` | 73 → 85 px | 252 px |
| mobil 390 px `handschuh` | 89 → 101 px | 226 px |
| 360 px `handschuh` | 89 → 101 px | 196 px |

Textbreiten bei 15 px (`komfortabel`/`handschuh`; `kompakt` 13,5 px ist schmaler):

| Text | Breite |
| --- | --- |
| Rhythmus 30 min (eigener Wert) | 210 px |
| Rhythmus 167 h 59 min (eigener Wert) | 249 px |
| Rhythmus 6 h (Vorgabe des Abschnitts) | 261 px |
| Rhythmus 6 h 30 min (Vorgabe des Abschnitts) | 309 px |
| Rhythmus 167 h 59 min (eigen) | 203 px |
| Rhythmus 167 h 59 min (Vorgabe) | 224 px |
| Deichwache Nord · im Einsatz seit 302335 | 279 px |

## Goals / Non-Goals

**Goals:**

- Die Breite der Zeitspalte hängt nicht mehr an der Uhrzeit. Damit gilt eine Messung am Tag
  auch für die Nacht.
- Eine fremde Rhythmusänderung (Wert oder Quelle) ändert die Zeilenzahl der Karte nicht, auf
  allen Flächen ab 226 px Inhaltsbreite.
- Der e2e-Beleg ist deterministisch gegen die Uhr und deckt den Tageswechsel ab.

**Non-Goals:**

- Fremde Änderungen anderer Felder (Beginn, geplante ablösende Einheit) und der Wechsel der
  Einstufung im Kopf der Karte. Sie stehen unter „Risks“ als benannte Reste.
- Breiten unter 226 px Inhalt (z. B. 360 px in `handschuh`). Dort darf die Rhythmuszeile
  weiter umbrechen.
- Das Format `kurz` selbst bleibt unverändert, ebenso alle anderen Nutzer von `ZeitAnzeige`.
- Der ETB-Nachweis im Backend (`src/abloesung/repo.rs`, „(Vorgabe des Abschnitts)“) bleibt
  wörtlich.

## Decisions

### E-1 Zeitspalte in fester Breite statt Mindestbreite

Die Zeit bekommt eine Mindestbreite von `6ch` in ihrer eigenen Mono-Schrift
(`display: inline-block` am `abloesung-zeit`-Span), die Spalte behält ihr Padding. `ch` bezieht
sich auf die Ziffernbreite der Mono-Schrift, deshalb passt sich das an jede Dichte an, ohne
Pixelkonstante. Die Spalte ist damit immer so breit wie in der Nacht. Mobil heißt das:
`komfortabel` 85 px statt 73 px am Tag, also 12 px weniger Inhalt.

*Verworfen:* `minWidth` als Pixelwert je Dichte, weil er an Schriftgröße und Font hängt und
still veraltet. Ebenso verworfen: das Format für die Karte auf immer `DDHHmm` zu stellen. Das
ändert die Anzeige ohne Not, und für eine Uhrzeit von heute ist `HHmm` die Konvention der Seite.

### E-2 Rhythmus in eigener Zeile

Die Sekundärzeile wird zwei Zeilen: „Abschnitt · im Einsatz seit …“ und „Rhythmus …
(Quelle)“. Eine fremde Rhythmusänderung berührt nur noch die zweite. Wie die erste umbricht,
ändert sie nicht mehr. Am Fükw kostet das eine Zeile je Karte (≈ 21 px bei `kompakt`). Mobil
kostet es nichts, denn dort brach die gemeinsame Zeile ohnehin in zwei Zeilen um.

*Verworfen:* eine Zeile mit Segmenten als nicht umbrechende Blöcke (`inline-block`). Ein
breiter werdendes Segment kann trotzdem in die nächste Zeile rutschen, die Garantie fehlt also.

### E-3 Quellenwort „Vorgabe“ / „eigen“

Mit „(Vorgabe des Abschnitts)“ passt die Rhythmuszeile mobil nie in eine Zeile (261–317 px gegen
252 px). Mit „(eigener Wert)“ reicht es nur knapp (249 px). Ein Wechsel der Quelle, etwa „zurück
zur Vorgabe“ durch eine andere Person, änderte dann die Zeilenzahl. „(Vorgabe)“ und „(eigen)“
halten den längsten zulässigen Rhythmus bei 224 px. Den Abschnitt nennt die Zeile darüber, und
die Spec verlangt nur die Kennzeichnung „Vorgabe oder eigener Wert“. Die Dialoge behalten ihre
ausführlichen Wörter, denn dort erklären sie ein leeres Feld.

### E-4 Optionen, die zur Wahl standen

- **A (gewählt):** E-1 + E-2 + E-3. Bricht nicht ab, hält die Projektregel ein und garantiert
  die Rhythmuszeile ab 226 px Inhalt.
- **B:** E-1, dazu jede Zeile einzeilig mit Ellipse und vollem Text im `title`. Das garantiert
  jede Breite, kürzt aber sichtbar, gegen „brechen um, statt zu kürzen“, und auf dem Handy liest
  niemand einen `title`.
- **C:** Nur den Test gegen die Uhr absichern (feste Uhr mittags). Damit wäre der Test grün, der
  Sprung in der Nacht bliebe aber bestehen. Verworfen, denn der Befund ist echt.
- **D:** E-1 und E-2 ohne kürzeres Quellenwort. Hält den geprüften Fall (eigener Wert,
  30 min). Ein Wechsel der Quelle springt mobil aber weiter.

### E-5 e2e mit fester Uhr

`test.use({ timezoneId: 'Europe/Berlin' })` und `page.clock.setFixedTime(T)` vor dem ersten
`goto`. `T` ist der jüngste vergangene Zeitpunkt 12:00 bzw. 23:40 in Europe/Berlin, berechnet
über `Intl` (Sommer- und Winterzeit). Die drei Schichten beginnen per `beginn_at` bei `T − 5 min`.
Die Fälligkeit liegt dadurch relativ zur Browser-Uhr wie im echten Lauf (6 h bzw. 25 min
voraus), und die mittlere Karte steht nach der Änderung auf „Vorwarnung“. `setFixedTime` hält nur
`Date` fest, die Timer laufen weiter (SSE, `useUhr`). Der Server rechnet mit seiner echten Uhr,
die Karte rechnet die Einstufung aber im Client nach, und nur diese prüft der Test. Gemessen
wird zusätzlich die Höhe jeder Karte, nicht nur die Oberkante.

Ein eigener kleiner Fall belegt Scenario 3: Rhythmus 10079 min (167 h 59 min) als Vorgabe des
Abschnitts, mobil in `komfortabel` und `handschuh`. Die Rhythmuszeile ist dann so hoch wie eine
Zeilenhöhe.

## Risks / Trade-offs

- [Reserve in `handschuh` mobil nur 2 px (224 gegen 226 px)] → Der e2e-Fall „längster
  Rhythmus“ misst genau dort. Kippt eine Schriftänderung das, wird er rot.
- [Fükw-Karten werden eine Zeile höher] → Bewusst. Die Zeile trägt den Rhythmus, der bei
  fremder Änderung wechselt. Am Fükw ist Platz, mobil kostet es nichts.
- [Rest: fremde Beginnänderung] → „seit 2335“ ↔ „seit 302335“ kann die erste Zeile umbrechen
  lassen, je nach Länge des Abschnittsnamens. Bleibt benannter Rest in der Prüfliste.
- [Rest: fremd geplante ablösende Einheit] → fügt eine Zeile „Ablösung geplant durch …“ hinzu,
  die Karte wächst. Bleibt benannter Rest. Eine Lösung bräuchte reservierten Platz für eine
  Zeile, die meist leer ist.
- [Rest: Einstufungswort im Kopf] → „planmäßig“ → „Ablösung bald fällig“ ist länger und kann
  bei langem Einheitennamen den Kopf umbrechen lassen. Das löst auch die Zeit allein aus, nicht
  nur eine fremde Änderung. Bleibt benannter Rest.
- [Server-Uhr ≠ Browser-Uhr im e2e] → Der Server stuft die Schichten am Tag-Fall evtl. anders
  ein und kann Hinweise an die AlarmZentrale schicken. Toasts liegen über dem Inhalt
  (fixiert) und verschieben keine Karte. In der Reproduktion war das so.
