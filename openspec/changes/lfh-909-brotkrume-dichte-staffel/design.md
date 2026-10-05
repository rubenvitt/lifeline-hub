# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderung: `specs/einsatztauglichkeit-layout/spec.md`.

So steht der Ortspfad heute:

- `components/EinsatzSeite.tsx`, `Ortspfad`: ein verschachtelter `ConfigProvider` setzt
  `fontSize: 12`, die Farben und den Chevron als Trenner. Der Breadcrumb selbst ist ein
  `ReactNode` der Seite; rund 45 Seiten bauen ihn als `<Breadcrumb items={[{ title: <Link …> }, …]} />`.
  Der Wrapper `div.lfh-seitenkopf__pfad` steht im Titelblock neben dem `h1`.
- antd 6.6.5 (`node_modules/antd/es/breadcrumb/style/index.js`) zeichnet den Link als
  `.ant-breadcrumb-item a { display: inline-block; height: fontHeight; padding: 0 paddingXXS;
  margin-inline: -marginXXS }`, mit `colorBgTextHover` als Hinterlegung unter dem Zeiger und
  antds Fokusstil. `fontHeight` bei 12 px ist 20 px. `controlHeight` kommt dort nicht vor. Die
  Liste `ol` ist `flex` mit `wrap`, ohne `align-items`.
- `EinsatzSeite.css` blendet den letzten Eintrag aus (der Seitenname steht als Titel daneben)
  und legt den Ortspfad unter `md` auf eine eigene, nicht umbrechende Zeile mit Auslassung.
- Der Seitenkopf hat `minHeight` 44 px und `paddingBlock` `paddingXS`. Aktionen im Kopf tragen
  `controlHeight`, ein Kopf mit Aktionen ist in `komfortabel`/`handschuh` also heute schon höher.
- Muster für handgebaute Ziele (`frontend/AGENTS.md`, „Handgebautes Bedienziel“): Boden aus dem
  aufgelösten Token `controlHeight`, geprüft über eine reine exportierte Stilfunktion, Böden im
  Test als Literale, Messung im Gate 3.

## Goals / Non-Goals

**Goals:**
- Jeder Link im Ortspfad erreicht in jeder Stufe `controlHeight` (30 / 48 / 72 px), am Fükw und
  auf dem Handschirm, gemessen mit `boundingBox()`.
- Die Optik in Ruhe bleibt: 12-px-Schrift, Ton `schwach`, Chevron-Trenner, Ausblenden des
  letzten Eintrags, Auslassung auf schmalem Schirm.
- Eine Stelle (`Ortspfad`) trägt das; keine Seite ändert ihren Breadcrumb.

**Non-Goals:**
- Breite der Pfad-Links. Beschriftete Ziele brauchen den Boden nur in der Höhe (Spec).
- Zielabstand zwischen zwei Pfad-Links. Die Spec verlangt ihn nur für Kennzahlen und
  Kartenknöpfe; der Chevron mit `separatorMargin` liegt ohnehin dazwischen.
- Brotkrumen außerhalb des Seitenkopfs (Stammdaten-Detailseiten über `AdminPage`), siehe
  `proposal.md`, Impact.
- Die eingefrorenen Prüflisten unter `docs/superpowers/` werden nicht fortgeschrieben.

## Decisions

### E1 — Die Brotkrume folgt der Staffel, keine benannte Ausnahme

Das Ticket ließ zwei Wege offen. Gewählt ist der Boden.

- **Verworfen: benannte Spacing-Ausnahme mit gleichwertigem Ziel über Rail und Modul-Panel.**
  Ein gleichwertiges Ziel gibt es zwar fast überall: „Einsätze“ erreicht auch die Wortmarke der
  Kopfleiste, die Liste eines Moduls auch die Rail. Auf dem Handschirm liegt die Rail aber im
  Drawer, der Weg von der Detailseite zurück zur Liste kostet dort zwei Tipps mehr, und genau
  dieser Rückweg ist mit Handschuh der häufigste. Eine Ausnahme müsste das gleichwertige Ziel je
  Pfad-Eintrag benennen und pflegen; der Boden braucht eine Stelle. Und der Navigationsrahmen
  hat bewusst keine Dichte-Ausnahme (LFH-384); die Brotkrume ist Navigation derselben Art.
- **Verworfen: größere Schrift im Pfad je Stufe.** Das Ticket verlangt die 12-px-Optik, und der
  Pfad stünde dann gleich groß wie der Titel (14/600).

### E2 — Trefffläche über Polster im Block, Boden aus dem aufgelösten Token

`Ortspfad` setzt am Wrapper eine CSS-Variable aus `token.controlHeight` (reine exportierte
Stilfunktion, etwa `ortspfadStil(token)` → `{ '--lfh-ortspfad-ziel': '48px' }`). Die
`EinsatzSeite.css` liest sie für den Link:

- `height: auto` (hebt antds `fontHeight` auf), `min-height: var(--lfh-ortspfad-ziel)`,
  `display: inline-flex; align-items: center` → die Schrift bleibt senkrecht mittig.
- Die Liste `ol` bekommt `align-items: center`, damit Trenner und Einsatzname (Text ohne Link)
  auf der Mittellinie der hohen Links stehen.
- Polster im Block statt bloßem `min-height`, damit die Hinterlegung unter dem Zeiger auf der
  Textzeile bleibt: `padding-block` rechnet die Differenz zwischen Boden und Zeilenhöhe
  (`calc((var(--lfh-ortspfad-ziel) - 1lh) / 2)`, nicht unter 0) und `background-clip:
  content-box` begrenzt den Hover-Ton auf die Inhaltsbox. Der Fokusring liegt am Außenrand und
  zeigt damit die ganze Trefffläche.

Warum die Variable aus dem Token und nicht aus `var(--lfh-*)` der Dichte-CSS: die Regel
„aufgelöste Tokens“ gilt, damit ein Test die Stilfunktion ohne Layout prüfen kann. Die
Stilfunktion liefert den aufgelösten Pixelwert; die CSS liest nur, was sie bekommt.

- **Verworfen: Pseudo-Element mit negativem Inset als unsichtbare Trefffläche.** Es verändert
  das Layout nicht, aber `boundingBox()` misst es nicht. Das Gate könnte den Boden nicht
  belegen, und der Fokusring zeigte die alte, kleine Fläche.
- **Verworfen: Komponenten-Token `lineHeight` am verschachtelten `ConfigProvider`.** antd
  rechnet `fontHeight` daraus, der Link würde hoch genug. Aber die Zeilenhöhe trüge dann auch
  der Text ohne Link und der Umbruch auf schmalem Schirm, und die Hinterlegung wüchse auf die
  volle Höhe.
- **Verworfen: Breadcrumb je Seite umbauen.** 45 Aufrufer, und jede neue Seite müsste daran
  denken.

### E3 — Nachweis im Gate 3

Ein neuer Block in `e2e/gate3-trefflaeche.spec.ts` misst die Pfad-Links einer Detailseite mit
zwei Links (Auftrag/Befehl-Detail: „Einsätze“ und „Aufträge/Befehle“) in allen drei Stufen, am
Fükw und auf dem Handschirm, mit den Helfern aus `trefflaeche-kern.ts` (`stelleDichte`,
`alleHaltenStufe` mit Mindestzahl 2). Locator gescopt auf `.lfh-seitenkopf__pfad a`, damit
Rail-Links nicht mitzählen. Dazu: berechnete Schriftgröße 12 px je Link, und in `kompakt` am
Fükw die Kopfhöhe 44 px (`[data-lfh="seitenkopf"]`). Die Gegenprobe der Stufen läuft über
`gegenprobe` (kompakt kleiner als handschuh). Fällt keine passende Saat leicht, wird eine andere
Detailseite mit zwei Pfad-Links genommen (etwa die Druckansicht einer Modulliste); das ändert die
Spec nicht.

Vitest (`EinsatzSeite.test.tsx`) prüft die reine Stilfunktion mit Böden als Literalen für alle
drei Stufen. jsdom rechnet kein Layout, den Boden belegt nur der Browser.

## Risks / Trade-offs

- [Seitenkopf ohne Aktionen wächst in `komfortabel`/`handschuh`] → Gewollt; mit Aktionen ist er
  dort heute schon so hoch. `kompakt` am breiten Schirm bleibt bei 44 px (Szenario in der Spec).
- [Handschirm: die eigene Pfadzeile wird in `kompakt` 30 statt 20 px hoch] → Akzeptiert. Telefone
  starten ohne Wahl in `komfortabel` (Zeigerart grob), `kompakt` ist dort die Ausnahme.
- [CLS beim Laden] → Die Höhe steht vom ersten Bild an fest (`min-height`), der spät eintreffende
  Einsatzname ändert nur die Breite. Prüfen mit `e2e/lagebild-cls-schmal.spec.ts` und
  `e2e/einsatzauswahl-cls.spec.ts`.
- [Specs, die den Seitenkopf messen oder fotografieren] → `e2e/uhs-hoehe.spec.ts`,
  `lagebild-offline-kopf.spec.ts`, Druck-Specs (der Kopf ist im Druck ausgeblendet) laufen mit.
- [`1lh` in der Desktop-Hülle] → Chromium, WebKit und WebView2 unterstützen `lh` seit 2023. Die
  `min-height` hält den Boden auch dann, wenn das Polster ausfällt; nur der Hover-Ton wüchse.
