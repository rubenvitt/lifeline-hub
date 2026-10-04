# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/farbrollen-kontrast/spec.md`.

So zeichnet antd 6.6.5 den Zustand gedrückt (`node_modules/antd/es/button/style/variant.js`):

- **Primärknopf** (`.ant-btn-color-primary.ant-btn-variant-solid`): Die Fläche ist beim Drücken
  `colorPrimaryActive`, die Beschriftung `primaryColor` (= `aufBedien`, schon gesetzt).
  `theme/tokens.ts:antdToken` setzt nur `colorPrimary` und `colorPrimaryHover`. Den Aktivton
  leitet antd ab: am Tag `#0a335e` (dunkler, Weiß darauf 12,74), nachts `#396792` (ebenfalls
  dunkler, die dunkle Schrift `aufBedien` darauf 3,35). Nachts kehrt sich die Richtung also um,
  denn die Schrift ist dunkel, und eine dunklere Fläche nimmt ihr den Kontrast.
- **Gefahrknopf ohne Rahmen** (`.ant-btn-color-dangerous.ant-btn-variant-text`): Die Schrift ist
  beim Drücken `colorErrorActive` (= `alarmHover`, seit LFH-693). Die Hinterlegung ist
  `color-light-active` = `colorErrorBgActive`, und die leitet antd aus dem globalen `colorError`
  satt ab: am Tag `#d69285` (4,13), nachts `#5b2e2e` (4,49). Unter dem Zeiger liegt dagegen die
  zarte Tönung `colorErrorBg` (8,46 bzw. 6,62).
- `colorErrorBgActive` liest im `Button` sonst nur die Variante `filled` beim Drücken. Die App
  hat keinen Knopf mit `variant="filled"`.
- **Vorbild LFH-693**: `antdKomponenten` überschreibt globale Tokens je Komponente
  (`Button.colorError…`). Für den gefüllten Gefahrknopf gilt dort schon gedrückt = Zeigerton
  (`colorErrorActive: alarmHover`).

Rechenwerte (WCAG, Beschriftung gegen Fläche):

| Stelle | Tag heute | Nacht heute | Tag neu | Nacht neu |
| --- | --- | --- | --- | --- |
| Primärknopf gedrückt | 12,74 | **3,35** | 7,32 | 9,00 |
| Gefahrknopf ohne Rahmen gedrückt | **4,13** | **4,49** | 8,52 | 7,66 |
| Umrandeter Gefahrknopf gedrückt (`alarmHover` auf `flaeche`) | 10,45 | 7,53 | unverändert | unverändert |

## Goals / Non-Goals

**Goals:**
- Jede Zeile der Tabelle hält gedrückt am Tag ≥ 7 : 1 und nachts ≥ 5 : 1. Das wird aus den
  Komponenten-Tokens gerechnet und im Browser gemessen.
- Eine Stelle trägt das app-weit: `antdKomponenten`. Kein Knopf bekommt ein eigenes `style`.

**Non-Goals:**
- Das globale `colorPrimaryActive`. Es färbt außerhalb des Knopfs andere Teile (etwa den
  Aktivzustand von Eingaben und Auswahlen), die keinen Text auf satter Fläche tragen. Sie
  gehören nicht zu diesem Ticket.
- Gruppen aus Auswahlknöpfen (`Radio` mit `optionType="button"`). In der App sind sie umrandet,
  nicht gefüllt (`buttonStyle="solid"` kommt nicht vor). Sie zeichnen keine Beschriftung auf
  satter Fläche.
- Knöpfe vom Typ `link`: Sie färben gedrückt mit `colorLinkActive` (nachts `bedienText`), nicht
  mit `colorPrimaryActive`.
- Die eingefrorenen Prüflisten unter `docs/superpowers/` werden nicht fortgeschrieben.

## Decisions

### E1 — „gedrückt“ fällt unter den Textboden

Der Zustand gedrückt bekommt keinen eigenen Boden. Antippen ohne Zeiger ist auf dem Tablet der
Normalfall, und dort ist das Drücken die einzige Rückmeldung. Mit Handschuh dauert es merklich.
WCAG 1.4.3 kennt keine Ausnahme für Zustände.

- **Verworfen: in der Spec begründen, warum gedrückt nicht zählt** (die Alternative aus dem
  Ticket). Das wäre ein zweiter, niedrigerer Boden für denselben Text, genau das, was LFH-661
  ausgeschlossen hat („kein eigener Knopfboden“). Es wäre auch unstimmig: Der gefüllte
  Gefahrknopf hält den Boden gedrückt schon seit LFH-693.

### E2 — Gedrückt trägt den Zeigerton, keine neue Rolle

`antdKomponenten` → `Button` bekommt:

- `colorPrimaryActive: farben.bedienHover`
- `colorErrorBgActive: farben.alarmFlaeche`

Der Primärknopf übernimmt damit die Regel, die LFH-693 für den gefüllten Gefahrknopf gezogen
hat: Der gedrückte Knopf zeigt den Zeigerton. Die gedrückte Fläche unterscheidet sich von der
Ruhe (Schritt `bedien` → `bedienHover`: Tag 1,17, Nacht 1,45), aber nicht vom Zeiger. Den
Unterschied zur Ruhe verlangt die Spec. Beim Antippen ohne Zeiger ist er der einzige, der
sichtbar wird.

Der Gefahrknopf ohne Rahmen liegt gedrückt auf `alarmFlaeche`. Das ist die Statusfläche
„Fehler“, die auch der Fehlerhinweis trägt (LFH-739). Sie ist fast so zart wie antds
Zeigertönung `colorErrorBg` (Unterschied Tag 1,01, Nacht 1,16). Gedrückt und Zeiger sehen also
auch hier gleich aus, beide klar abgesetzt vom Grund in Ruhe.

- **Verworfen: eine neue Rolle `bedienAktiv`** (Tag antds `#0a335e`, nachts ein Ton zwischen
  `bedien` und `bedienHover`). Damit bliebe der Tag unverändert, und gedrückt wäre vom Zeiger
  unterscheidbar. Dafür bräuchte es aber eine Rolle in beiden Paletten, in `rollen.css`, im
  Rollen-Guard und im Gate-5-Muster, nur für einen Zustand, den ein Finger nie vom Zeiger trennt.
  Außerdem liefe das gegen die Regel, die LFH-693 für den Gefahrknopf gewählt hat.
- **Verworfen: `colorPrimaryActive` global in `antdToken` setzen.** Das träfe Eingaben, Auswahlen
  und weitere Komponenten, die nicht zu diesem Ticket gehören. Der Fokusring ist davon nicht
  betroffen, er liest `colorPrimaryBorder`. Gesetzt wird deshalb im `Button`, so wie bei
  `Button.colorError` in LFH-693.
- **Verworfen: `colorErrorBgActive` auf `alarmFuellungStark`** (die Alpha-Tönung). Ihr Kontrast
  hängt vom Untergrund ab, auf dem der Knopf steht (Banner, Tabelle, Dialog). Eine deckende Rolle
  lässt sich rechnen.

### E3 — Nachweis im Browser: Drücken halten, ohne zu klicken

`e2e/kontrast-kern.ts` bekommt eine Messung des Zustands gedrückt neben `ruheUndZeiger`: Zeiger
auf die Knopfmitte, `mouse.down()`, stehendes Bild messen, Zeiger vom Knopf wegziehen und erst
dann `mouse.up()`. So löst der Knopf keinen Klick aus (weder Anmeldung noch Rückfrage). Vor der
Messung sichert der Test zu, dass die Fläche gewechselt hat, sonst wäre „gedrückt gemessen“
trivial wahr.

Getragen wird die Messung so:

- **Primärknopf**: „Anmelden“ auf der Anmeldeseite in `primaerknopf-kontrast.spec.ts`.
- **Gefahrknopf ohne Rahmen**: Der Papierkorb „Dokument … entfernen“ in der Dokumentenliste
  (`DokumentePage`), in `gefahr-kontrast.spec.ts`. Er liest dieselben Tokens wie
  „abgelehnt – prüfen“ im Live-Banner. Das Banner braucht eine abgelehnte Offline-Aktion in der
  Warteschlange, und die lässt sich im e2e nur umständlich herstellen. Es bleibt deshalb beim
  gerechneten Nachweis. Der Papierkorb trägt ein Ikon, keine Schrift. Gemessen wird trotzdem
  die Farbe des Knopfs (`color`) gegen die Hinterlegung, also genau das Paar, das die
  Beschriftung des Banners trägt.

## Risks / Trade-offs

- [Am Tag hellt der gedrückte Primärknopf auf, statt nachzudunkeln] → Das ist eine sichtbare
  Änderung, die das Ticket nicht verlangt. Sie hält aber den Boden (7,32), und sie gleicht den
  Primärknopf dem gefüllten Gefahrknopf an. Das spricht für eine Regel statt zwei.
- [Gedrückt ist mit der Maus nicht mehr vom Zeiger zu unterscheiden] → Wie beim gefüllten
  Gefahrknopf seit LFH-693. Die Rückmeldung beim Klicken ist der Klick selbst (Dialog, Navigation,
  Ladezustand). Wer später einen eigenen Drückton will, führt eine Rolle ein (E2, verworfene
  Variante).
- [Komponenten-Token `colorPrimaryActive` im `Button` erreicht auch den Rand des Standardknopfs
  beim Drücken (`defaultActiveBorderColor`)] → Er wird dann `bedienHover`, wie der Rand unter
  dem Zeiger (`defaultHoverBorderColor`), also stimmig. Beim Umsetzen im Browser einmal
  ansehen, nicht eigens messen: Der Rand trägt den Boden 3 : 1, und `bedienHover` hält ihn auf
  jeder Fläche.
