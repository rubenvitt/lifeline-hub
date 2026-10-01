# Design

## Context

Motivation: `proposal.md`, Abschnitt „Why“. Anforderung: Delta-Spec `einsatztauglichkeit-layout`.

Ablösung (`pages/AbloesungPage.tsx`, `abloesung-werkzeugzeile`) und Verpflegung
(`pages/VerpflegungPage.tsx`, `verpflegung-werkzeugzeile`) bauen ihre Werkzeugzeile gleich:
Sie ist ein `Flex` ohne Umbruch und hat die Mindesthöhe `controlHeight + 2`. Links steht die
`Segmentleiste` (`flex: none`), rechts das `Sammelbanner` (`flex: 1 1 0`, `minWidth: 0`,
Text mit Auslassung, rechts der antd-Knopf „anzeigen“). Das Banner erscheint nur durch ein
Live-Ereignis, nie beim ersten Bild.

**Messung (01.10.2026)**, 390 × 844, beide Module, je drei Dichtestufen. Gesät waren 12
gezeigte und 1 fremder Eintrag, die Werkzeugzeile ist 366 px breit (x 12 bis 378). Ein
Wegwerf-Spec im Playwright-Harness hat gemessen und ist nicht committet. Die Wege A–C wurden
im DOM nachgestellt.

| Modul / Dichte | Segmentleiste | Ist: Text sichtbar / nötig, Knopf rechts, `scrollWidth` |
| --- | --- | --- |
| Ablösung `kompakt` | 146 px | 114 / 153 px · 366 · 390 |
| Ablösung `komfortabel` | 162 px | 63 / 78 px · 359 · 390 |
| Ablösung `handschuh` | 182 px | **0** / 78 px · 356 · 390 |
| Verpflegung `kompakt` | 239 px | 45 / 245 px · 366 (Knopf auf 24 px gestaucht) · 390 |
| Verpflegung `komfortabel` | 255 px | **0** / 245 px · 382 · 390 |
| Verpflegung `handschuh` | 275 px | **0** / 245 px · **449** · **449** |

Die drei Wege aus dem Ticket, einzeln:

- **A, kürzere Beschriftung** („aktuell (13)“, „vergangen (3)“): Die Segmentleiste der
  Verpflegung wird 74 px schmaler. Der Text bleibt bei 51 px (`komfortabel`) bzw. 0 px
  (`handschuh`). Bei der Ablösung bewirkt A nichts, ihre Beschriftungen sind schon kurz.
- **B, Ikone und Zahl** („1 neu“, Knopf „anzeigen“ bleibt): Bei der Ablösung passt das in
  allen Stufen (Knopf rechts ≤ 384 px). Die Verpflegung läuft über, in `komfortabel` bis
  413 px, in `handschuh` bis 477 px. Auch mit A zusammen bleiben in `handschuh` 13 px
  Überlauf (Knopf rechts 403 px). Das Banner braucht dann 173 px und bekommt 153 px.
- **C, eigene Zeile:** Das Banner bekommt die volle Breite, der Text zeigt 193 bis 254 px.
  Der Satz der Verpflegung (245 px) wird in `komfortabel` und `handschuh` trotzdem gekürzt.
  Damit nichts springt, müsste die Zeile unter `md` immer reserviert sein. Das kostet dauerhaft
  39 / 61 / 90 px Höhe, wie die Messung zeigt: Die oberste Karte rückt von y 271 / 332 / 450
  auf 310 / 393 / 540.

## Goals / Non-Goals

**Goals:**

- In beiden Modulen ist bei 390 px in jeder Dichtestufe das Banner lesbar, die Freigabe im
  Fenster und der Überlauf 0, mit Spielraum für zweistellige Zahlen.
- Die Werkzeugzeile bleibt eine Zeile mit unveränderter Höhe. Unter `md` geht kein Platz
  dauerhaft verloren.

**Non-Goals:**

- Die übrigen Sammelbanner (ETB, Lage-Dashboard, FMS-Tableau, Infotelefon) stehen in eigener
  Zeile und tragen auf 390 px. Sie bleiben unverändert.
- Die Kurzform trägt keine Zusatzangabe wie „davon 1 fällig“ oder „mit Unterdeckung“. Diese
  Angabe steht nach der Freigabe an der Karte und für Hilfstechnik im vollständigen Satz (D3).
- Keine neue Schwelle neben `md`. Ab 768 px gilt das Bisherige.

## Decisions

### D1 — Unter `md` wird das ganze Banner ein Knopf mit Kurzform (B, verschärft)

`Sammelbanner` bekommt eine Prop `kurz?: string`. Ist sie gesetzt und `aktion` vorhanden,
rendert das Banner statt „Text + Knopf rechts“ **einen** antd-`Button`. Er trägt die
Pfeilikone (`aria-hidden`), die Kurzform in Mono mit `tabular-nums` und gleichen Grund, Rand
und Farbrollen. Sein `onClick` ist `aktion.onKlick`. Der Knopf erbt `controlHeight` vom
`ConfigProvider` (LFH-365) und ist damit in jeder Stufe so hoch wie die Segmentleiste. Die
Zeilenhöhe ändert sich nicht.

Die Seiten setzen `kurz` nur bei `useViewport().istSchmal`. `useViewport` ist der einzige
erlaubte Zugang zu Breitenfragen (`useViewport.guard.test.ts`). Das „breite“ erste Bild schadet
hier nicht, weil das Banner nie im ersten Bild steht.

*Warum nicht B wie im Ticket (Zahl + eigener Knopf „anzeigen“):* Der Knopf allein braucht in
`handschuh` 72 px, dazu kommen Polsterung, Ikone und Abstände. In der Verpflegung fehlen selbst
mit A noch 20 px. Ein einziger Knopf spart die zweite Polsterung und den zweiten Abstand. Er
braucht geschätzt etwa 80 px für „1 neu“ (Text gemessen 29 px), 90 px für „12 neu“ und 110 px für „umgeordnet“. Gate 1 (D5) belegt die Werte. Dazu
wird die ganze Fläche des Banners Trefffläche, gut für Einhand- und Handschuhbedienung. *Warum
nicht C:* dauerhaft 39 bis 90 px weniger Liste auf dem kleinsten Schirm, und der Satz der
Verpflegung bleibt trotzdem gekürzt.

### D2 — Kurzform: „n neu“, sonst „umgeordnet“

Eine reine, exportierte Funktion `sammelbannerKurz(anzahl, umgeordnet)` (in `Sammelbanner.tsx`)
liefert „1 neu“ bzw. „12 neu“, wenn Einträge warten, und sonst „umgeordnet“, wenn nur die
Reihenfolge wartet. Warten Einträge und ist zugleich umgeordnet, gewinnt die Zahl. Die
Umordnung steht im vollständigen Satz. Beide Seiten rufen dieselbe Funktion auf, so bleibt der
Wortlaut eine Wahrheit.

### D3 — Der vollständige Satz bleibt für Hilfstechnik

Das Banner bleibt `role="status"`. In der Kurzform liegt der vollständige Satz
(`zuflussText(…)`) zusätzlich in einem nur für Hilfstechnik sichtbaren `span` im
Statusbereich. So wird er wie bisher höflich angesagt. Der Knopf heißt zugänglich
„1 neu anzeigen“ (Kurzform plus „anzeigen“). Damit enthält der Name den sichtbaren Text
(WCAG 2.5.3), und `getByRole('button', { name: 'anzeigen' })` in
`e2e/abloesung-zufluss.spec.ts` trifft weiter. Das `title`-Attribut entfällt in der Kurzform,
auf dem Handschirm gibt es kein Hover. Die Stilwerte des unsichtbaren Textes kommen aus dem
vorhandenen Muster (`components/instrument/Status.tsx`).

### D4 — Verpflegung kürzt ihre Segmentbeschriftung unter `md` (A, nur dort)

Unter `md` heißt „laufend & anstehend (n)“ in der Verpflegung „aktuell (n)“, „vergangen (n)“
bleibt. Ohne A bliebe neben der 275 px breiten Leiste in `handschuh` nur 79 px Platz für das
Banner, zu knapp für „12 neu“. Mit A sind es 153 px. Die Ablösung („Laufend (n)“, „Abgelöst“)
bleibt, wie sie ist. Die Beschriftung wechselt im ersten Bild noch von lang auf kurz (D1).
Das ändert nur die Breite der Leiste in einer Zeile ohne Umbruch. Die Messung zeigt keine
Höhenänderung (Zeile 74 px mit langer Beschriftung).

*Alternative:* „laufend (n)“. Verworfen, weil „anstehend“ darin verloren ginge und
„aktuell“ genau die Trennung `bis ≥ jetzt` trifft.

### D5 — Nachweis in Gate 1 mit stehendem Banner

`e2e/gate1-ueberlauf.spec.ts` bekommt im `describe('Gate 1')` einen Test „Gate 1 · mobil
(390 px): stehendes Sammelbanner in Ablösung und Verpflegung“. Er läuft über die drei
Dichtestufen und beide Module, misst ohne Banner, löst das Banner durch einen fremden
API-Aufruf aus und prüft dann:

- `scrollWidth ≤ 390`,
- die rechte Kante des Knopfes ≤ 390 und den Knopf per Klick erreichbar (LFH-355),
- den Kurztext ungekürzt (`scrollWidth ≤ clientWidth` des Textträgers),
- Zeilenhöhe und Oberkante der obersten Karte (± 0,5 px, wie `e2e/abloesung-zufluss.spec.ts`),
- den Wortlaut „1 neu“.

Gesät werden zweistellige Zahlen (12 gezeigte Einträge), damit die breiteste übliche
Beschriftung gemessen wird. Rollen (LFH-435): Die Werkzeugzeile hat keinen Rollenzweig, und der
Beobachter sieht dieselbe Leiste und dasselbe Banner. Ein zweiter Rollenlauf bewiese nichts
Neues. Diese Freistellung steht mit Rolle im Testkopf.

## Risks / Trade-offs

- [Die Kurzform verschweigt „davon 1 mit Unterdeckung“ bzw. „davon 1 fällig“ sichtbar] → Ein
  Antippen zeigt die Karte mit Einstufung. Hilfstechnik hört den vollen Satz. Ab `md` steht er
  wie bisher. Soll die Dringlichkeit auch auf dem Handschirm sichtbar sein, ist das ein eigener
  Nachzug mit eigener Messung. Er ist nicht Teil dieser Change.
- [Eine künftige dritte Segmentoption verengt die Zeile wieder] → Gate 1 misst mit stehendem
  Banner und schlägt dann rot an.
- [Antds `Button` kürzt lange Inhalte nicht] → Die Kurzform ist auf höchstens etwa 110 px
  („umgeordnet“) begrenzt. D2 lässt keinen freien Text zu.

## Migration Plan

Reine Frontend-Änderung ohne Daten. Ein Revert stellt das bisherige Verhalten wieder her.
