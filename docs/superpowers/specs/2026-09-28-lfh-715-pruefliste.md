# LFH-715 · Prüfliste Einsatztauglichkeit — Kartenleiste ab `lg` ausblendbar

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/lagekarte` (Umschalter „Leiste ausblenden/einblenden“: ab `lg` unten im Knopfblock der Karte, darunter im Seitenkopf) |
| Stand | Branch `feat/lfh-715-kartenleiste-einklappbar` |
| Zielkontext | Fükw (1366 px) wegen der Kartenfläche; Tablet und Handschirm behalten ihr Verhalten, merken die Wahl aber jetzt |
| Nicht enthalten | Wahl in der geteilten Kartenansicht (bewusst nicht, `umsetzung.md`); Tastenkürzel für den Umschalter |

## Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/lagekarte-leiste-einklappen.spec.ts`, 1366 × 768 | Canvas der Karte **798 px** mit Leiste, **1098 px** ausgeblendet (Boden 1000); nach Neuladen weiter ausgeblendet, `aria-expanded="false"` |
| derselbe Spec, Breitenklassen | Ausblenden bei 1366 lässt 900 px offen; dort ausgeblendet, zurück auf 1366 und neu geladen: beide Wahlen stehen; Einblenden bei 900 lässt 1366 unberührt |
| `e2e/leisten-flaeche.spec.ts` (Zeitachse ≤ 50 % der Karte) | grün. **Gemessener Befund beim Bau:** mit dem Umschalter im Seitenkopf ab `lg` wuchs der Kopf in Handschuh um 43 px (Karte 579 → 536 px), die Zeitachse belegte am Tablet 53 %. Deshalb sitzt er ab `lg` im Knopfblock (Entscheidung 28.09.2026). Der Spec setzt die Leisten-Vorbedingung jetzt über `localStorage` statt per Klick, weil die Wahl das Neuladen der Dichtestufe überlebt |
| derselbe Spec, Stift | Bei ausgeblendeter Leiste öffnet „Zeichenwerkzeuge“ Leiste und Paneel „Zeichnen“; nach dem Neuladen ist sie wieder aus (nur für die Sitzung) |
| `fokus-verdeckung.spec.ts` | Bei 1024 px/Handschuh bekommt der Umschalter als unterster Knopf des Blocks die Trefferprobe; die Leisten-Wahl wird je Lage gesetzt statt geklickt |
| `gate1-ueberlauf`, `gate3-trefflaeche`, `fokus-verdeckung`, `lagekarte-smoke`, `lagekarte-leiste-dichte`, `lagekarte-betreuung`, `lagekarte-betroffene`, `lagekarte-marker-plaketten` | 73/73 grün (zusammen mit den beiden Specs oben) |
| Vitest | `leistenWahl.test.ts` (Vorrang: gemerkt ?? Vorgabe, Auswahl/Platzieren erzwingt; je Klasse eigener Platz; Einhängen schreibt nichts; `zeige` speichert nichts und weicht dem nächsten Umschalten; kaputter Eintrag = keine Wahl), `KartenUeberlagerung.test.tsx` (Umschalter unten im Block, `aria-expanded`/`aria-controls`, gesperrt per `aria-disabled` und fokussierbar, Grund als zugängliche Beschreibung, ohne `leiste` kein Knopf) |

## Kriterien

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** | Kartenknopf: Kante `max(32, controlHeight)` (`kartenKnopfKante`, Vitest mit Literalen); unter `lg` antd-`Button` | — |
| 2 | **Handschuh-Modus** | **erfüllt** | 72 px in beiden Formen; der Ort ab `lg` ist gerade wegen der Handschuh-Höhe gewählt (s. o.) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **nicht anwendbar** | Keine Serveraktion, das Umschalten wirkt sofort lokal | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Umkehrbar, ändert keine Daten | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** `[abgeleitet]` | Ikone ist Nicht-Text (Boden 3 : 1), gerechnet aus `tokens.ts`: Tag `gedaempft`/`flaeche` 8,42, Hover auf `flaeche3` 6,60, gesperrt `schwach` 6,37 · Nacht 7,27 / 6,83 / 5,03. Nicht im Browser gemessen | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Zustand im Namen („ausblenden“/„einblenden“), in `aria-expanded` und in der Ikone (Einklappen/Ausklappen). Gesperrt ab `lg`: `aria-disabled`, fokussierbar, Grund als zugängliche Beschreibung. Unter `lg` bleibt der Kopfknopf (Bestand) ein natives `disabled` mit Grund nur im `title`. Auf Touch erscheint der `title` nicht; dann steht die erzwingende Auswahl bzw. der Platzier-Modus selbst sichtbar in der Leiste | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | `gedaempft` wie Zoom und Nordung, kein Blau (bedient nichts Primäres), kein Rot | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen → LFH-397** | App-weite Lücke, unverändert | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Eine Auswahl und ein Platzier-Modus holen die Leiste zurück; der einzige „Abbrechen“-Knopf der Platzier-Modi bleibt damit erreichbar | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme | — |
| 11 | **Warnverhalten** | **nicht anwendbar** | Kein Blinken, kein Ton | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Die Kartenbreite ändert sich nur auf eine eigene Handlung, nie durch ein Live-Ereignis. **Benannt:** bei ausgeblendeter Leiste holt ein Markerklick oder ein Platzier-Modus sie zurück; die Karte wird 300 px schmaler und der Inhalt rückt um rund 150 px. Endet die Auswahl, wächst sie zurück. Das ist die Folge der erzwungenen Leiste, unter `lg` gab es dasselbe senkrecht | — |
| 13 | **Fokus nie verdeckt** | **erfüllt** | `fokus-verdeckung.spec.ts` grün; der Fuß endet vor der Knopfspalte (`fussStil(knopfKante)`), der Block wird dabei nur länger. **Nicht gemessen:** sechs Knöpfe à 72 px ergeben in Handschuh rund 451 px Block; belegt ist 1024 × 768, niedrigere Fensterhöhen (Tablet mit Browserleiste) und der Fall mit Historienbanner nicht | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Erfassung | — |

**Bilanz:** 8 erfüllt · 1 offen · 6 nicht anwendbar.
