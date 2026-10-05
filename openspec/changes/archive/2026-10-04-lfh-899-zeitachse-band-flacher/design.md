# Design

## Context

Siehe `proposal.md` (Why). Ausgangslage, gemessen auf `alpha` am 04.10.2026 mit zwei Ständen
(`[data-lfh="zeitachse"]`, Leiste ausgeblendet):

| Fläche / Stufe | Band (Höhe × Breite) | Karte | Anteil |
| --- | --- | --- | --- |
| Fükw 1366 × 768 / kompakt | 115 × 730 | 671 | 17 % |
| Fükw / handschuh | 198 × 677 | 651 | 30 % |
| Tablet 1024 × 768 / handschuh | 282 × 335 | 579 | 49 % |
| Handschirm 390 × 844 / kompakt | 157 × 322 | 678 | 23 % |
| Handschirm / handschuh | 282 × 282 | 582 | 49 % |

Zwei Befunde tragen den Entwurf:

1. **Das Band ist schmal.** Es endet vor der Knopfspalte der Karte (`fussStil(knopfKante)`, LFH-355).
   Am Handschirm ist es 282 px breit, am Tablet 335 px. Mit der Polsterung `paddingSM` (16 px in
   `handschuh`) bleiben am Handschirm 250 px Innenbreite, Platz für drei 72-px-Knöpfe mit zwei
   16-px-Lücken (248 px).
2. **Mehr als zwei Reihen passen nicht unter den Deckel.** In `handschuh` am Handschirm liegt der
   Deckel bei 291 px. Zwei Reihen mit Staffel-Abständen brauchen 2 × 72 + 26 (`margin`) + 2 × 16
   (`paddingSM`) = 202 px. Drei Reihen brauchen schon mit nur einer Gruppenlücke
   3 × 72 + 26 + 16 + 32 = 290 px. Das liegt am Handschirm 1 px unter dem Deckel und am Tablet
   (289,5 px) darüber.

Das Band muss also unter `handschuh` am Handschirm und Tablet in **zwei Reihen** passen. Heute
belegt allein das Sichern (Feld und Knopf) eine ganze Reihe, die Stände-Knöpfe eine weitere, und die
Zeitleiste bricht in sich noch einmal um (Schieber und Beschriftung unter Aktuell und Abspielen).

## Goals / Non-Goals

**Goals:**

- Höchstens zwei Reihen in jeder Fläche und Stufe, eine Reihe im Fükw.
- Alle Abstände des Bands aus der Staffel; kein Wert mehr im Guard als Ausnahme.
- Bedienziele im Band ≥ 16 px auseinander in `handschuh` (LFH-630, Bedien-Leitlinie Kriterium 2).

**Non-Goals:**

- Keine Änderung an Snapshot-Daten, Replay-Takt (`ANZEIGE_MS`), Vorladen oder Historien-Modus.
- Keine Änderung am eingeklappten Zustand (Knopf „Zeitachse einblenden“ unten links) und an der
  gemerkten Klapp-Wahl.
- Kein Löschen oder Umbenennen von Ständen im Band.

## Decisions

### D1 — Eine Auswahl „Stand“ statt Knopfreihe, Beschriftung und „Aktuell“

Die Knopfreihe der Stände, die Beschriftung neben dem Schieber („Live“ bzw. Bezeichnung) und der
Knopf „Aktuell“ beantworten dieselbe Frage: welcher Stand ist zu sehen, und wie wähle ich einen
anderen? Eine antd-`Select` beantwortet beides in einem Bedienziel. Ihr Wert ist `live` oder die Id
des Stands. Die Optionen lauten „Live“, dann die Stände absteigend nach `stand_at`: „Live“ ist der
jüngste Stand und steht deshalb oben, ein frisch gesicherter Stand direkt darunter. Die Beschriftung
kommt aus `chipLabel` wie bisher; eine `notiz` steht als `title` der Option. Die Wahl ruft
`onWaehle` und hält eine laufende Wiedergabe an, wie heute ein Stand-Knopf.

„Aktuell“ entfällt im Band. Im historischen Stand trägt das Historien-Banner den Knopf „Aktuell“
schon; im Live-Modus war der Knopf nur eine Anzeige (gefüllt), die jetzt die Auswahl übernimmt.

*Verworfen:*

- **Knopfreihe behalten und nur die Beschriftung in die Zeitleiste ziehen** (Vorschlag im Ticket):
  spart die halbe Zeile der Beschriftung, nicht die Reihe der Stände. Ergebnis am Handschirm drei
  Reihen, 290 px.
- **Stände-Reihe ersatzlos streichen** (Schieber und Beschriftung tragen die Wahl): der Sprung zu
  einem benannten Stand ginge nur noch über das Schieben mit Tooltip, und die Reihe des Sicherns
  bliebe. Ebenfalls drei Reihen.
- **Nur unter `handschuh` umbauen, sonst Knopfreihe:** zwei Aufbauten des Bands, beide zu testen;
  die Auswahl ist auch im Fükw nicht schlechter als die Knopfreihe, bei vielen Ständen besser
  (die Reihe rollte waagerecht).

### D2 — „Stand sichern“ als Symbolknopf mit Dialog

Das dauerhafte Feld „Bezeichnung“ belegt die Breite, die am Handschirm für den Rest fehlt. „Stand
sichern“ wird ein Symbolknopf (Kamera) mit zugänglichem Namen „Stand sichern“ und Tooltip. Er
öffnet ein `Modal` „Stand sichern“ mit dem Feld „Bezeichnung (optional)“ (Name
„Snapshot-Bezeichnung“ bleibt) und dem Primärknopf „Sichern“; Enter im Feld sichert. Das folgt der
UI-Form-Leitlinie (Modal für kurze blockierende Aktion mit ≤ 3 Feldern). Nach Erfolg schließt der
Dialog und leert das Feld, die Meldung „Stand gesichert“ bleibt. Ein Fehler lässt den Dialog offen.

*Verworfen:*

- **Popover statt Modal:** die Leitlinie kennt das Popover nicht als Form für eine Eingabe, und am
  Handschirm liegt das Band unten an der Karte, wo ein Popover die Tastatur verdeckt.
- **Sofort sichern ohne Bezeichnung:** verliert die Bezeichnung, die die Auswahl lesbar macht.
- **Feld nur in breiten Flächen inline:** zweiter Aufbau wie bei D1.

Kosten: im Fükw kostet das Sichern mit Bezeichnung einen Klick mehr. Das Sichern ist selten
(ein Stand je Lagebesprechung), das Wählen häufig.

### D3 — Zwei Gruppen, je eine Zeile

Das Band ist ein `flex` mit `flexWrap: 'wrap'` aus zwei Gruppen, die in sich nicht umbrechen:

- **Wiedergabe:** „Zeitachse ausblenden“, „Abspielen“, Schieber (`flex: 1`). Der Ausblende-Knopf
  steht links; eingeklappt steht „Zeitachse einblenden“ unten links, der Griff bleibt also auf der
  linken Seite.
- **Stand:** Auswahl (`flex: 1`, Basis 160 px), „Stand sichern“.

Nachgerechnet in `handschuh` (Innenbreite = Bandbreite − 2 × `paddingSM`):

| Fläche | Innenbreite | Reihe 1 | Reihe 2 | Bandhöhe | Anteil |
| --- | --- | --- | --- | --- | --- |
| Handschirm | 250 px | Ausblenden, Abspielen, Schieber 74 px (Schiene 42 px) | Auswahl 162 px, Sichern | 202 px | 35 % |
| Tablet | 303 px | dto., Schieber 127 px | Auswahl 215 px, Sichern | 202 px | 35 % |
| Fükw | ≈ 700 px | beide Gruppen in einer Reihe | — | 104 px | 16 % |

Ohne Stände fehlen Abspielen, Schieber und Auswahl wie heute; es bleiben Ausblenden und Sichern.
Ohne Schreibrecht fehlt Sichern, die Auswahl nimmt die Breite.

*Verworfen:* **Ausblende-Knopf rechts außen wie heute.** Die Stand-Gruppe bräuchte dann
162 + 72 + 72 + 2 × 16 = 338 px und passte am Handschirm nicht in eine Zeile; die Wiedergabe-Gruppe
ist der einzige Ort mit nachgiebigem Inhalt (Schieber).

### D4 — Abstände aus der Staffel

| Bisher | Wert | Neu |
| --- | --- | --- |
| `BAND_LUECKE` (zwischen Gruppen) | 12 | `token.margin` (11 / 18 / 26) |
| `BAND_POLSTER` | `8px 12px` | `token.paddingSM` (7 / 11 / 16) |
| `ZEITLEISTE_LUECKE`, `STAND_LUECKE` (in der Gruppe) | 8 / 6 | `token.marginSM` (7 / 11 / 16) |
| `SCHIEBER_RAND` | `0 8px` | `marginInline: token.marginSM` (7 / 11 / 16) |

Die Polsterung ist rundum `paddingSM` statt `paddingSM`/`padding` (Ticket): mit `padding` (26 px)
sänke die Innenbreite am Handschirm auf 230 px und der Schieber auf 54 px. Der Rand des Schiebers
trägt den halben Griff an den Enden der Schiene. Geplant war `marginXS`; gemessen steht der Griff
in `handschuh` 11 px über das Schienenende, und mit 7 px Rand lag er nur 12 px neben „Abspielen“.
Mit `marginSM` hält er die 16 px (Nachtrag aus der Umsetzung). Der Guard bekommt keinen Ausnahmeabsatz mehr: die Werte sind
Token-Ausdrücke, die er nicht als Zahl liest.

### D5 — Nachweise

- **Vitest** (`SnapshotLeiste.test.tsx`): Auswahl mit Reihenfolge und Wahl, Wahl hält Wiedergabe an,
  Dialog sichert mit Bezeichnung (Enter und Knopf), Beobachter ohne Sichern, keine Knopfreihe und
  kein „Aktuell“ im Band, Stile der Gruppen (`nowrap`) als exportierte reine Stile.
- **e2e** `leisten-flaeche.spec.ts`: Deckel über alle Flächen und Stufen wie bisher, neu der
  Zielabstand ≥ 16 px in `handschuh` für Admin und Beobachter (Kästen aller `button`,
  `.ant-select` und Schieber-Griffe paarweise, Abstand der Kästen auf der trennenden Achse) und
  höchstens zwei Reihen. `gate3-trefflaeche.spec.ts`: die Zeitachse misst die Auswahl als
  beschriftetes Ziel und Ausblenden, Abspielen, Sichern als Symbolknöpfe.
  `lagekarte-smoke.spec.ts`: Stand über die Auswahl, „höchstens zwei Reihen“ bleibt.

Gemessen nach der Umsetzung (04.10.2026, zwei Stände): Handschirm und Tablet in `handschuh`
202 px (35 %), Fükw in `handschuh` 104 px (16 %), Fükw in `kompakt` 44 px in einer Reihe.

## Risks / Trade-offs

- [Schieber am Handschirm in `handschuh` nur 74 px breit, die Schiene 42 px] → bei zwei Ständen ein Umschalter, bei
  vielen Ständen grob. Die Auswahl springt direkt zu jedem Stand; der Schieber ist dort Zusatz für
  das Abspielen.
- [Ein Klick mehr beim Sichern mit Bezeichnung] → selten gegenüber dem Wählen (D2).
- [Dropdown der Auswahl unten an der Karte] → antd öffnet nach oben, wenn unten kein Platz ist;
  im Handschuh-Betrieb sind die Optionen 72 px hoch. Nachweis im Smoke-Test über die echte Wahl.
- [Andere e2e-Anker auf „Stand A“-Knöpfe] → per Grep erfasst (`leisten-flaeche`, `gate3`,
  `lagekarte-smoke`, `fokus-verdeckung`); `fokus-verdeckung` sät nur Stände und misst das Band als
  Region.

## Migration Plan

Reines Frontend, kein Datenschritt. Rückweg: Revert des Commits.
