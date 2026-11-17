# Design

## Context

- **Einsatzrahmen** (`einsatz/EinsatzLayout.tsx`): Kopfleiste, IconRail und Modulpanel stehen im
  DOM vor dem antd-`Content`, und der rendert ein `<main>`.
- **Ebene 1** (`components/AppLayout.tsx`): eigenes `Content`/`<main>`.
- **Verwaltung** (`admin/AdminLayout.tsx`): liegt in diesem `<main>` und rendert darin ein
  zweites `Content`, also `<main>` im `<main>`, mit dem Menü davor.
- **Hilfe** (`hilfe/HilfePage.tsx`): liegt außerhalb von `BetriebsLayout`, mit eigenem `<main>`.
- **Betriebszeile:** `BetriebsLayout` in `App.tsx` stellt `LiveStatusBanner` vor jeden Rahmen;
  bei einer Störung trägt die Zeile Knöpfe.
- **Vorbild:** der Sprunglink „Zum Detail“ in `components/ListeDetail.tsx`, mit der Klasse
  `.lfh-sprung-detail` (ohne Fokus aus dem Bild genommen), `preventDefault` und `focus()` auf ein
  Ziel mit `tabIndex -1`.
- **Spec `einsatztauglichkeit-layout`:** verlangt „Kein Fokusziel vollständig verdeckt“ und „Der
  App-Rahmen springt beim Laden nicht“.

## Goals / Non-Goals

**Goals:**
- Ein Sprunglink an einer Stelle für alle Rahmen-Seiten, als allererster Halt.
- Ein Sprungziel, das ohne Seitenkopf funktioniert.

**Non-Goals:**
- Die Gerätehülle (wenige Halte, eigenes rollendes `<main>`).
- Ein Tastenkürzel zum Inhalt oder ein automatischer Fokus nach jedem Modulwechsel.
- Weitere Sprunglinks („Zum Menü“).

## Decisions

### D1 Einmal in `BetriebsLayout`, vor der Betriebszeile

`<SprungZumInhalt />` wird erstes Kind von `BetriebsLayout`, vor `LiveStatusBanner`. So ist er der
erste Halt für Ebene 1, Verwaltung, Planungen und Einsatz, auch bei einer Störung, und es gibt
genau eine Stelle. Die Hilfe liegt außerhalb und bindet denselben Baustein selbst ein.

*Alternative:* je Rahmen als erstes Kind des Headers. Das wären mehrere Stellen, und die Knöpfe
der Betriebszeile lägen davor.

### D2 Das Ziel ist ein markiertes Element, das innerste gewinnt

Jeder Rahmen markiert sein Inhaltsgebiet mit `data-lfh="sprungziel-inhalt"` und `tabIndex={-1}`:
das `main` von Einsatz und Ebene 1, den Inhalt neben dem Menü in der Verwaltung und das `main`
der Hilfe. Der Link nimmt das **letzte** markierte Element in DOM-Reihenfolge. Das ist bei
Verschachtelung das innere, also in der Verwaltung der Inhalt neben dem Menü.

Ein `href="#inhalt"` bleibt als Rückfall ohne Skript stehen. Der Klick ruft `preventDefault`,
sonst schriebe der Router einen Hash in die Adresse. Danach folgt `focus({ preventScroll: false
})`. Ein Wächter-Test prüft, dass jeder Rahmen ein Ziel trägt.

*Alternative:* `h1` des Seitenkopfs als Ziel. Nicht jede Seite hat einen Seitenkopf. Das Ziel
`main` sagt der Screenreader als Hauptbereich an.

### D3 Das verschachtelte `<main>` der Verwaltung wird ein `<div>`

Der Inhalt der Verwaltung bekommt statt antd-`Content` ein `div` mit denselben Stilen. Danach
gibt es je Seite genau ein `<main>`, nämlich das des Ebene-1-Rahmens. Das Ziel der Verwaltung ist
dieses `div`.

### D4 Sichtbar nur mit Fokus, über dem Rahmen, ohne Sprung

Eine neue Klasse `.lfh-sprung-inhalt` in `theme/sprache.css` gilt in zwei Zuständen:
- **Ohne Fokus:** dieselbe Ausblendung wie `.lfh-sprung-detail`.
- **Mit Fokus:** `position: fixed` oben links, `z-index` über `RAHMEN_EBENE`, Grund `paneel`,
  Fokusring in `bedien`, Mindesthöhe `controlHeight`.

`fixed` nimmt keinen Platz im Fluss, also springt nichts. Die `scroll-padding`-Regeln in
`index.css` bekommen den Link als Ausnahme, damit sein Fokus die Seite nicht rollt. Der Text
lautet „Zum Inhalt springen“, unpersönlich wie alle neuen Texte.

## Risks / Trade-offs

- **[Ein neuer Rahmen vergisst das Ziel, und der Link läuft ins Leere]** → Der Wächter-Test über
  die Rahmen schützt davor. Ohne Ziel tut der Link nichts Schädliches.
- **[Der Fokus auf `main` zeigt einen Ring um die ganze Fläche]** → Das Ziel bekommt
  `outline: none`, denn der folgende Tab-Halt zeigt den Fokus ohnehin. Ein Ziel mit
  `tabIndex -1` ist kein Bedienelement.
- **[Fokus-Verdeckung durch den klebenden Kopf]** → Die Fokusform liegt `fixed` über dem Kopf.
  Die e2e-Probe `fokus-verdeckung` misst sie mit.
