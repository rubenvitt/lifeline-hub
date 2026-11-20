# Handy: Hauptaktion unten festkleben, Auftragsdetail in den Blick holen (LLH-1761)

Zunder: https://zunder.rubeen.dev/#/aufgabe/j45fvu8l47a0snwv5gxrrsje · Eltern-Aufgabe LLH-1718
(Erfassung: stille Fehlwege schließen) · Größe: kleine Änderung, kurzes Design-Doc.

## Absicht

Am Handy verschwindet der Weg zum Ziel unter dem Rand. „Erfassen“ in der Aufnahme liegt bei
y ≈ 1100 einer 1149 px hohen Seite, „Meldung erfassen“ bei 1218. Am Handschuh-Tablet ist die
Aufnahme 1204 px hoch, der Schirm 820 px. Tippt man einen Auftrag an, klappt sein Detail bei
y = 825 von 844 auf, „Quittieren“ liegt bei etwa 1170. Gerollt wird nicht, also wirkt der Tipp
wirkungslos. Wer mit einer Hand oder mit Handschuhen erfasst, soll die Hauptaktion immer sehen.
Nach einem Tipp auf einen Auftrag soll sichtbar sein, dass etwas passiert ist.

## Ziele

1. **Der Fuß klebt auch auf der Seite.** `ErfassungsFormular` klebt seinen Fuß mit
   „Erfassen“ und „Speichern und nächste“ am unteren Rand, solange das Formular über den Schirm
   hinausreicht. Das gilt jetzt auch auf der Seite (Aufnahme, Meldung erfassen), nicht nur im
   Dialog (LLH-1274). Die Regel gilt in jeder Breite. `sticky` wirkt nur, wenn das Formular
   länger als der Schirm ist, und davon profitiert auch das Handschuh-Tablet.
2. **Der Fuß bleibt über der Bildschirmtastatur.** Steht der Fokus in einem Feld dieses
   Formulars und schiebt sich die Tastatur über das Layout-Viewport, rückt der klebende Fuß um
   die verdeckte Höhe nach oben. Gemessen wird mit der VisualViewport-API (Android und iOS).
3. **Das Auftragsdetail kommt in den Blick.** `ListeDetail` holt unter `lg` nach einer Wahl von
   Hand die gewählte Karte samt aufgeklapptem Detail in den Blick, aber nur, wenn das Detail
   unter den Rand fällt. Die Karte steht dann oben unter dem Rahmen (`--lfh-rahmen-oben`). Das
   gilt für jede Nutzung des Bausteins (Aufträge, Befehle).

## Nicht-Ziele

- Kein „Quittieren“ auf der Karte: das bricht die Regel „Karte trägt keine Handlung“
  (`frontend/AGENTS.md`, Liste + Detailpaneel). Am Checkpoint verworfen.
- Kein Vollbild-Detail: das bricht die Leitlinie, die Overlay und Seitenwechsel ausschließt.
- Keine Änderung am Viewport-Meta in `index.html`. Das ETB und die übrigen Fußleisten bleiben
  unverändert.
- Der Versatz über den Reitern des gekoppelten Geräts gehört zu LLH-1760 (andere Sitzung).

## Anti-Ziele

- Ein klebender Fuß, der Felder verdeckt, in die man gerade tippt (Fokus nicht verdeckt,
  WCAG 2.4.11).
- Ein Rollen, das bei jedem Rendern, beim Zufluss oder beim Zuklappen anspringt. Gerollt wird
  nur einmal je Wahl von Hand.
- Ein Rollen ab `lg`: dort steht das Detail daneben und klebt.

## Ansätze

| Frage | Gewählt | Verworfen |
| --- | --- | --- |
| Tastatur | **VisualViewport-Versatz am Fuß**: wirkt auf Android und iOS und nur auf diesen Fuß | `interactive-widget=resizes-content` im Viewport-Meta: eine Zeile, aber global und von iOS ignoriert · nur kleben, Tastatur später: verfehlt „über der Tastatur“ |
| Auftrag | **In den Blick rollen** in `ListeDetail`: keine Regeländerung, wirkt auch für Befehle | Quittieren auf der Karte (Regelbruch, Knopf rutscht beim Zufluss unter dem Finger weg) · Vollbild (Regelbruch) |
| LLH-1760 | **Parallel**, den Konflikt löst der spätere Merge | Auf 1760 warten |

Gewählt am 20.11.2026 vom Menschen, jeweils die Empfehlung.

## Entscheidungen zum Wie

- **Fuß:** `fussKlebt` gilt künftig auch für `ErfassungsFormular` auf der Seite. Am besten wird
  es dort Vorgabe, damit alle Seitenformulare es bekommen (bisher Aufnahme und Meldung). Ein
  `false` bleibt möglich, wo ein Formular in einem eigenen Scrollbereich steht. Der Seitenfuß
  nimmt den Grund seines Behälters (`colorBgContainer`). Der negative Rand des Dialogpolsters
  entfällt dort.
- **Fokusabstand:** dieselbe Messung `useFokusabstandUnten`. Die Variable wird für die Seite am
  Dokument verbraucht (`scroll-padding-block-end` über `:has`, wie die Speicherleiste LFH-475)
  und für den Dialog wie bisher an `.ant-modal-wrap`. Die Meldung als untere Leiste
  (Eingangsband weicht aus) kommt damit ohne Zusatz mit.
- **Tastatur:** ein kleiner Hook (`components/tastaturVersatz.ts`) liefert die verdeckte Höhe
  `max(0, innerHeight − visualViewport.height − visualViewport.offsetTop)`. Er hört auf
  `resize` und `scroll` des VisualViewport und ist nur aktiv, solange der Fokus im Formular
  steht. Der Fuß setzt sie als `bottom`. Ohne VisualViewport (alte Browser, jsdom) bleibt der
  Versatz 0.
- **Rollen im Detail:** `ListeDetail` merkt sich die Wahl von Hand (die Karte klickt `onClick`
  des Auswahlziels), nicht die Vorauswahl und nicht den Deeplink-Sprung. Nach dem Rendern des
  Details prüft der Baustein: liegt dessen Unterkante unter dem Fensterrand, rollt er den
  Eintrag mit `scrollIntoView({ block: 'start' })`. Der Abstand zum klebenden Kopf kommt aus dem
  vorhandenen `scroll-padding-block-start` des Rahmens. Bei „reduzierter Bewegung“ wird nicht
  geglättet.
- **Regel:** In `frontend/AGENTS.md`, Erfassungs-Norm, kommt ein Punkt dazu: der Fuß klebt im
  Dialog und auf der Seite und bleibt über der Tastatur. In „Liste + Detailpaneel“ ein
  Halbsatz: unter `lg` holt die Wahl von Hand das Detail in den Blick. Der Dateikopf von
  `Erfassung.tsx` wird entsprechend umgeschrieben.

## Nachweis

- Unit: der Versatz-Hook (mit gefälschtem VisualViewport), `fussKlebt` auf der Seite (Attribut
  und Stil), das Rollen in `ListeDetail` nur bei einer Wahl von Hand und nur unter `lg`.
- e2e (Handy-Projekt): Aufnahme und Meldung erfassen haben „Erfassen“ ohne Rollen im Bild;
  nach einem Tipp auf einen Auftrag liegt „Quittieren“ im Fenster.
- Bilder vorher und nachher für den PR (390 × 844).

## Dem Bauenden überlassen

Name und genaue Signatur des Hooks; ob `fussKlebt` auf der Seite Vorgabe wird oder an den beiden
Aufrufern gesetzt; in welche e2e-Datei die Prüfungen gehören.
