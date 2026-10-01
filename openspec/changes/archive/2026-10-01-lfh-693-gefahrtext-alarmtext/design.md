# Design

## Context

Motivation: `proposal.md`, „Why“. Anforderungen: `specs/farbrollen-kontrast/spec.md`.

So zeichnet antd 6.6.5 Gefahrrot (Quellen unter `node_modules/antd/es/`):

- **Menüeintrag** (`dropdown/style/status.js`): `.ant-dropdown-menu-item-danger` hat in Ruhe die
  Farbe `colorError`. Unter dem Zeiger zeigt er `colorTextLightSolid` (Weiß) auf `colorError`. Die
  Menüfläche ist `colorBgElevated` (= `flaeche2`). antds `Menu`-Komponente hat eigene
  `danger…`-Tokens. In der App trägt aber kein `Menu` einen Gefahreintrag, alle stehen im
  `Dropdown`.
- **Gefahrknopf** (`button/style/variant.js`, `.ant-btn-color-dangerous`): Die Grundfarbe ist
  `colorError`, unter dem Zeiger `colorErrorHover`, beim Drücken `colorErrorActive`. Gefüllt
  (`solid`) ist das die Fläche, die Beschriftung kommt aus `Button.dangerColor` (= `aufBedien`,
  schon gesetzt). Umrandet, `text` und `link` färben mit **denselben** Werten die Schrift.
  `text` legt unter dem Zeiger zusätzlich `colorErrorBg` darunter.
- `theme/tokens.ts:antdToken` setzt `colorError = alarm`. Hover und Aktiv leitet antd ab, am Tag
  aus `#b02318` (`#bd4639`, `#8a110c`), nachts aus `#ff6b6b` (`#e88a87`, `#ad4d4d`).
- **Vorbild Formularmeldung** (LFH-652/667): `antdKomponenten` setzt `Form.colorError` auf
  `alarmText`, das globale `colorError` bleibt. Ein globales Token lässt sich so je Komponente
  überschreiben.

Rechenwerte heute (WCAG):

| Stelle | Tag | Nacht |
| --- | --- | --- |
| Menüeintrag, Ruhe (`alarm` auf `flaeche2`) | **6,27** | 6,48 |
| Menüeintrag, Zeiger (Weiß auf `alarm`) | **6,78** | **2,78** |
| Gefüllter Knopf, Ruhe (`aufBedien` auf `alarm`) | **6,78** | 7,18 |
| Gefüllter Knopf, Zeiger | **5,12** | 7,98 |
| Gefüllter Knopf, gedrückt | 9,69 | **3,74** |
| Umrandeter Knopf, Ruhe / Zeiger (Text auf `flaeche`) | **6,78** / **5,12** | 6,77 / 7,53 |

## Goals / Non-Goals

**Goals:**
- Jede Zeile der Tabelle hält am Tag ≥ 7 : 1 und nachts ≥ 5 : 1. Das wird aus den Tokens
  gerechnet und im Browser gemessen.
- Eine Stelle trägt das app-weit: `antdKomponenten`. Kein Menü und kein Knopf bekommt ein
  eigenes `style`.
- Die Ausnahme „Rot am Tag → LFH-693“ in `betreuung-pruefliste.spec.ts` fällt.

**Non-Goals:**
- Das globale `colorError`. Ränder, Ikonen, Feldränder, `Alert` und `Badge` behalten die
  Füllfarbe `alarm`.
- Der gedrückte Primärknopf in der Nacht (`aufBedien` auf antds `colorPrimaryActive`). Er ist
  vermutlich ebenso knapp, gehört aber zu LFH-661. Beim Umsetzen messen und bei Bedarf als
  Nachzug erfassen.
- Gefahrknöpfe vom Typ `link`: In der App gibt es keinen. Sie folgen denselben Tokens und
  sind damit mit abgedeckt, werden aber nicht eigens gemessen.
- Die eingefrorenen Prüflisten unter `docs/superpowers/` werden nicht fortgeschrieben.

## Decisions

### E1 — Komponenten-Tokens statt globalem `colorError`

`antdKomponenten` bekommt:

- `Dropdown: { colorError: alarmText, colorTextLightSolid: aufBedien }`
- `Button: { …, colorError: alarmText, colorErrorHover: alarmHover, colorErrorActive: alarmHover }`

Gefahrknöpfe in Rückfragen (`Popconfirm`, `Modal.confirm`, `okButtonProps={{ danger: true }}`)
lesen dieselben `Button`-Tokens. Damit ist jede Gefahrstelle erfasst, ohne dass ein Aufrufer
etwas ändert.

- **Verworfen: das globale `colorError` auf `alarmText` setzen.** Das träfe Feldränder, Ikonen
  in `Alert`/`Result`, `Badge` und den Fehlerrand von Eingaben, und dort ist die Füllfarbe
  richtig. Die Regel stand schon in LFH-652 so am Wert.
- **Verworfen: CSS-Regeln auf `.ant-dropdown-menu-item-danger` und `.ant-btn-dangerous`.** Das
  wäre eine zweite Quelle neben den Tokens, und ein antd-Update, das Klassen umbenennt, bräche sie
  still.
- **`colorTextLightSolid` nur im `Dropdown`**, wie `Button.primaryColor` (s. Kommentar an
  `antdKomponenten`). Global würde es Tooltip, Avatar und Badge nachts dunkel auf dunkel färben.
  Im Dropdown nutzt allein der Gefahreintrag unter dem Zeiger dieses Token. Beim Umsetzen ist
  das per grep in `dropdown/style/` zu belegen.

### E2 — Unter dem Zeiger dunkler, eine neue Rolle `alarmHover`

| Rolle | Tag | Nacht | Stelle |
| --- | --- | --- | --- |
| `alarmText` (besteht) | `#8f1c12` | `#ff6b6b` | Ruhe: Fläche des gefüllten Knopfs, Text |
| `alarmHover` (neu) | `#7d1810` | `#e88a87` | Zeiger und Drücken |

Am Tag ist das Weiß auf `alarmText` 8,96 und auf `alarmHover` 10,45. `alarmHover` als Text
misst auf `grund` 8,75, auf `colorErrorBg` 8,46 und auf `flaeche` 10,45. Der Schritt zwischen
Ruhe und Zeiger beträgt 1,17, so groß wie bei `bedien`/`bedienHover` (LFH-661). Farbton und
Sättigung sind die von `alarmText`, nur die Helligkeit sinkt. Nachts bekommt `alarmHover` den
Wert, den antd heute ableitet. Unter dem Zeiger ändert sich nachts also nichts, gedrückt steigt
die dunkle Schrift von 3,74 auf 7,98.

- **Verworfen: Zeiger heller als die Ruhe** (wie `bedienHover`, z. B. `#a11f14`, Weiß darauf
  7,72). antd färbt mit `colorErrorHover` nicht nur die Fläche des gefüllten Knopfs, sondern
  auch die **Schrift** des umrandeten Knopfs und des `text`-Knopfs. Diese Schrift stünde dann
  auf der Tönung `colorErrorBg` bei 6,2 und auf `grund` bei 6,46. Hält ein hellerer Ton auch als
  Text den Boden (Leuchtdichte ≤ 0,075), liegt er höchstens 1,07 über `alarmText`. Den Wechsel
  sähe man kaum, und die Spec verlangt einen sichtbaren. Ein getrennter Ton für Text und Fläche
  ginge nur über CSS (s. E1, verworfen).
- **Verworfen: keine eigene Rolle, antds Ableitung aus `alarmText`** (`#9c3a2d` unter dem
  Zeiger). Weiß darauf misst nur 6,87.
- **Verworfen: `marke` (`#a8071a`) als Gefahrfläche.** Weiß darauf misst 7,75. Aber `marke`
  ist Dekoration (Logo, Rail-Marke), und „Rot bedient nichts“ (`tokens.ts`, Kopf der Rollen)
  trennt sie von Gefahr.
- **Gedrückt gleich Zeiger:** antds eigene Aktivstufe wäre am Tag heller als `alarmHover`
  (`#8a110c`) und nachts zu dunkel (3,74). Ein dritter Ton bringt nur Rechenaufwand. Das Drücken
  zeigt antds Welleneffekt.

### E3 — Wo der Boden steht und wer ihn prüft

- **Am Wert:** Die Kontrast-Kommentare über `farbenHell` und `farbenDunkel` nennen die
  Gefahrpaare und den Boden. `antdKomponenten` begründet `Dropdown` und `Button`.
  `rollen.css` spiegelt `--lfh-alarm-hover` in beiden Blöcken (`rollen.guard.test.ts`), und
  `gate5.guard.test.ts` kennt `7d1810` und `e88a87` als Rollenwerte.
- **Gerechnet:** neuer Unit-Test `theme/gefahrKontrast.test.ts` nach dem Muster von
  `bedienKontrast.test.ts`. Er nimmt die Farben aus `antdKomponenten(farben, …)`, nicht aus den
  Rollen direkt, damit ein vergessenes Komponenten-Token rot wird. Paare: Menüeintrag Ruhe auf
  `flaeche2`, Menüeintrag unter dem Zeiger, Knopffläche in Ruhe, unter dem Zeiger und gedrückt,
  Knopftext umrandet auf `flaeche`. Tag ≥ 7, Nacht ≥ 5. Außerdem: Zeigerfläche ≠ Ruhefläche.
- **Gemessen:** neuer Browser-Spec `e2e/gefahr-kontrast.spec.ts` mit dem Messkern
  `kontrast-kern.ts`, Tag und Nacht. Der Ablauf:
  1. Verpflegung, Zeitfenster ohne gültige Ausgabe, gebündeltes Menü „Weitere Aktionen“: roter
     Eintrag „Löschen“ in Ruhe und unter dem Zeiger.
  2. Die Rückfrage „Löschen“: roter Bestätigungsknopf in Ruhe und unter dem Zeiger.
  3. Ein umrandeter Gefahrknopf, etwa „Deaktivieren“ eines Katalogs der Stammdaten, in Ruhe und
     unter dem Zeiger.

  Das Warten auf das stehende Bild (`stehend`) und die Zusicherung „Fläche wechselt“ stammen
  aus `primaerknopf-kontrast.spec.ts`. Ist der Helfer dort lokal, wird er nach
  `kontrast-kern.ts` gezogen statt kopiert, aus demselben Grund, aus dem der Messkern geteilt ist.
- **Ausnahme fällt:** In `betreuung-pruefliste.spec.ts` entfallen die Zweige „Rot als Text“
  und „Weiß auf alarm“ samt Kopfkommentar. „Stornieren“ im Zeilenmenü und im Storno-Dialog wird
  von „nur am Tag unter Ausnahme gesehen“ auf „ohne Ausnahme gesehen“ umgestellt, damit der
  Nachweis nicht still schrumpft. Damit entfallen auch die Merkmale `rotText`/`weissAufAlarm`
  im Textbaum, sofern nichts anderes sie liest.

## Risks / Trade-offs

- [Gefahrknopf dunkelt unter dem Zeiger, der Primärknopf hellt auf] → Beide Zustände sind
  sichtbar verschieden (Schritt 1,17). Die Richtung folgt hier aus der Rolle als Textfarbe
  (E2). Das steht am Wert, damit niemand „vereinheitlicht“.
- [Am Tag wird jedes Gefahrrot in Menüs und Knöpfen dunkler (`#b02318` → `#8f1c12`)] → Es ist
  derselbe Ton wie Etiketten und Statusflächen, die schon `alarmText` tragen. Ränder und Ikonen
  bleiben `alarm`. Die Kante eines umrandeten Knopfs wird mit dunkler, sie hielt vorher schon 3 : 1.
- [`text`-Gefahrknopf auf getöntem Grund, etwa im Live-Banner] → `alarmText` auf `bannerGrund`
  misst 7,66. Beim Umsetzen messen. Bleibt eine Stelle unter dem Boden, kommt sie als Nachzug aufs
  Board.
- [Andere Kontrast-Specs] → `betroffene-`, `hellmodus-`, `kraefte-`, `fachebenen-`,
  `abloesung-`, `verpflegung-kontrast.spec.ts` und `primaerknopf-kontrast.spec.ts` laufen gegen
  die neuen Tokens.

## Migration Plan

Nur Frontend-Werte, kein Datenbestand. Rückweg: die Einträge in `antdKomponenten` entfernen
und die Rolle `alarmHover` streichen.
