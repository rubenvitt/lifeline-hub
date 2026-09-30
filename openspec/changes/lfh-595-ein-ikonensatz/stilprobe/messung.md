# Stilprobe iOS 27 Outlined — Messung (30.09.2026)

Erzeugt mit `PW_STILPROBE=1 pnpm exec playwright test e2e/ikonen-stilprobe.spec.ts` auf der
Meldungsseite eines Einsatzes, je Breite (390/1024/1440) × Betriebsart (Nacht/Tag) × Dichte
(kompakt/komfortabel/handschuh). Rohdaten: `messung.json`, Aufnahmen: `<breite>-<modus>-<dichte>.png`.
Vergleichsbogen bisher ↔ neu: `vergleich-dpr1.png`, `vergleich-dpr2.png` (16 und 20 px, einfache
und doppelte Pixeldichte).

## Kantenlänge und Kontrast je sichtbarer Ikone

Kontrast = kleinster Wert über alle 18 Aufnahmen, Farbe der Ikone gegen ihren komponierten Grund
(`e2e/kontrast-kern.ts`). Er sagt nichts über die Linienstärke.

| Ikone | Kantenlänge px | Kontrast min | Anmerkung |
|---|---|---|---|
| `chevron-runter` | 10 | — | Deckkraft 0,65, nicht modelliert |
| `funkbalken` | 16 | 8,53 |  |
| `hierarchie` | 20 | 8,04 |  |
| `karte` | 20 | 8,04 |  |
| `klemmbrett` | 20 | 8,04 |  |
| `lkw` | 20 | 8,04 |  |
| `lupe` | 15, 20 | 7,47 |  |
| `menue` | 22 | 16,15 |  |
| `plus` | 13,5, 15 | 6,19 |  |
| `punkte-senkrecht` | 13,5, 15 | 16,37 |  |
| `sprechblase.gefuellt` | 20 | 14,74 |  |
| `zahnrad` | 20 | 8,04 |  |

## Befund

- **Linienstärke:** Die Quellen sind auf 50 px gezeichnet, Konturen 2 Einheiten breit. Bei 20 px
  sind das 0,8 px, bei 16 px 0,64 px. Bisher (Tabler 2/24, antd) lagen die Linien bei 1,3–1,7 px.
  Auf einfacher Pixeldichte (Fükw) wirken die neuen Ikonen deutlich heller und feiner als die
  bisherigen, auf doppelter Dichte sauber, aber immer noch leichter (`vergleich-dpr1.png`).
- **Doppelte Konturen:** Im Stil „Outlined“ sind auch Chevrons und die drei Punkte als Umriss
  gezeichnet (`chevron-down`, `menu-2`); sie wirken bei 16 px wie Doppelstriche bzw. Ringe.
- **Zustand „getrennt“:** `no-connection` unterscheidet sich von `high-connection` nur durch
  leere statt volle Balken, nicht durch eine Durchstreichung. Bei 16 px sind beide kaum zu
  trennen (Farbe und Wort tragen den Zustand weiter, die Ikone verliert ihren Beitrag).
- **Gefüllte Zwillinge:** klar und kräftig, als aktiver Zustand der Rail gut erkennbar.
- **Kontrast:** alle gemessenen Ikonen ≥ 6,19 : 1 (Plus auf dem blauen Primärknopf), die Rail
  ≥ 8,04 : 1. Der Chevron im Benutzermenü steht mit Deckkraft 0,65 und ist nicht messbar.
