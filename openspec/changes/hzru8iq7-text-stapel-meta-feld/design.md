# Design

## Context

Siehe `proposal.md`, „Why“. Vorhanden sind: `schriftskala` und `schrift` in `theme/tokens.ts`
mit CSS-Spiegel in `theme/rollen.css` (deckungsgleich per `rollen.guard.test.ts`),
`schriftStil(stufe)` und `monoStil(groesse)` in `components/instrument/rollenwerte.ts`,
`useRollen()` für die Farbrollen des aktiven Modus, das Abstandsraster `dichten[*].abstand` mit
den antd-Token `paddingXXS…XL`/`marginXXS…XL` und `--lfh-luft-0…5` (LLH-1809) samt Ratschen-Wächter
`abstandsraster.guard.test.ts` und Schuld-Datei. Der Feldbreiten-Wächter
`components/feldbreiten.guard.test.ts` verbietet im Verwaltungsteil `width: <Zahl>`, sieht aber nur
die Zahlform. Der Entwurf liegt unter `docs/design/2026-11-18-text-stapel-meta-feld/`.

Messwerte im Pilotbereich (`stammdaten/`, `karten/`, `pages/einstellungen/`,
`pages/BenutzerPage.tsx`): 283 `style={`, 23 `fontSize`, `maxWidth` 200 ×19 und 120 ×7.

## Goals / Non-Goals

**Goals:**
- Vier Bausteine, deren Props nur erlaubte Werte zulassen (Stufe, Ton, Rasterstufe, Breitenstufe).
- Pilot im Verwaltungsteil, der zeigt, dass die Bausteine die Inline-Stile dort tragen.
- Regeltext und einen Wächter abbauen, die die Bausteine überflüssig machen.

**Non-Goals:**
- Umstellung der übrigen Bereiche (ETB, Einsatzmodule, Rahmen, Lagekarte): Folgeaufgaben je
  Bereich.
- `monoStil(<Zahl>)` (366 Aufrufe) und `aktionsabstand`/`aktionenSpace`: bräuchten eine Mono-Stufe
  bzw. einen Knopfreihen-Baustein; eigene Aufgaben.
- Farbe, Rahmen oder Layout ganzer Seiten.

## Decisions

### D1 Kartentitel als eigene Stufe, 13 rastet ein (abgestimmt 18.11.2026)

15 px steht fast nur an fetten Titeln von Karten und Listeneinträgen; das ist eine eigene Rolle
zwischen `seitentitel` (14/600) und den Datenwerten. 13 px liegt zwischen `text` (14) und
`textKlein` (12) und ist von beiden kaum zu unterscheiden. Regel beim Einrasten: Lauftext und
Namen in einer Zeile → `text`; Hinweis, Beschreibung, Nebenangabe → `textKlein`.
*Verworfen:* beide als neue Stufen (Zwischenstufe ohne sichtbaren Unterschied), beide einrasten
(Kartentitel so groß wie der Seitentitel).

### D2 Stufen fest, nicht dichteabhängig (abgestimmt)

antds Grundschrift steigt schon mit der Dichte (13,5 → 15); die Regel in `tokens.ts` lautet „der
Handschuh ändert die Hand, nicht das Auge“. `Textstufe` liest deshalb nur `schriftStil(stufe)`.
*Verworfen:* Skalierung mit der Grundschrift (mehr Umbruch, jeder Baustein müsste die Dichte
lesen).

### D3 `Textstufe` als dünner Baustein über `schriftStil`

`<Textstufe stufe="textKlein" ton="gedaempft" als="p">`. Props: `stufe` (Schlüssel der Skala,
Vorgabe `text`), `ton` (Vorgabe `text`), `als` (`span` Vorgabe, `p`, `div`, `h2`–`h6`, `label`,
`dt`, `dd`), `className`, `id`, `title`, `children`. Kein `style`-Prop, damit keine Größe durch die
Hintertür kommt; Spielraum für Umbruch über `umbruch="ueberall"` (`overflowWrap: anywhere`),
weil das an den 15-px-Titeln heute nötig ist. Bei Familie `zahl` setzt der Baustein
`tabular-nums`. `margin: 0`, Zeilenhöhe 1.5 bzw. 1.4 für `kartentitel`.
*Verworfen:* antds `Typography.Text` mit Stil-Fabrik: `type="secondary"` setzt eine eigene Farbe,
die nicht den Rollen folgt, und ließe `style` offen.

### D4 `Stapel` liest das Raster über antds Token

`<Stapel abstand="md" richtung="zeile" umbruch ausrichten="center" verteilen="between" als="ul">`.
Die Lücke kommt aus `theme.useToken()` (`paddingXXS…XL`, MD = LG wie in `antdToken`), damit sie
mit der Dichte wächst (Spec `abstandsraster`). `abstand` ist ein Union-Typ der Stufen, Vorgabe
`sm`. `richtung` `spalte` (Vorgabe) | `zeile`. `minWidth: 0` auf dem Container, damit
Flex-Kinder schrumpfen. Kein `style`-Prop; für Breite oder Raster gibt es `wachsen` (flex 1).
*Verworfen:* antds `Flex gap="small|middle|large"`: kennt nur drei Stufen und nimmt Zahlen an.

### D5 `MetaZeile` mit Unterbaustein `Teil`

`<MetaZeile><MetaZeile.Teil mono>{kennzeichen}</MetaZeile.Teil>…</MetaZeile>`. Der Baustein
filtert Kinder, deren Inhalt `null`, `undefined`, `false` oder leerer String ist, und setzt
zwischen den übrigen `<span aria-hidden="true">·</span>`. Layout als `Stapel richtung="zeile"
umbruch abstand="xs"` mit `baseline`. Teile in `textKlein`/`schwach`; `mono` nimmt die Stufe
`meta` (11, Zahlenfamilie). Ein Teil darf einen eigenen `ton` haben (etwa `alarm` für „nicht
erreichbar“).
*Verworfen:* Trenner per CSS `::before`: liest mancher Vorleser vor und lässt sich in Tests
schlecht prüfen.

### D6 `Feld` als Hülle um `Form.Item` (abgestimmt)

`<Feld name label breite="mittel" …FormItemProps>` reicht alle Form.Item-Props außer `style`
durch und setzt `style={{ maxWidth: FELDBREITE[breite] }}` auf das Form.Item. antds Steuerelemente
sind in einem Form.Item schon 100 % breit (`Input`, `Select`); für `InputNumber`, `DatePicker`
und `TimePicker`, die das nicht sind, setzt `Feld` per Klasse `lfh-formfeld` in `index.css` (`lfh-feld` ist der Werteblock in `theme/sprache.css`)
`width: 100%` auf das Steuerelement. Breiten: `kurz` 120 (Zahlen, Kürzel), `schmal` 200 (häufigste
Obergrenze im Pilot), `mittel` 320, `voll` ohne Obergrenze; Konstante `FELDBREITE` in
`theme/tokens.ts`, gespiegelt als `--lfh-feld-*` (Gate wie Rollen). Gegenüber dem Gespräch kam
`kurz` dazu und `schmal` liegt bei 200 statt 160, weil 120 und 200 die belegten Obergrenzen sind.
*Verworfen:* eigenes Feld-Layout neben Form.Item (zweiter Weg zu 618 Form.Items).

### D7 Wächter: Feldbreite statt Zahlform, Schriftgröße als Ratsche

- `components/feldbreiten.guard.test.ts` wird ersetzt durch `components/feld.guard.test.ts`:
  im Verwaltungsteil kein `width` (Zahl, String oder Konstante) an `Input`, `InputNumber`,
  `Select`, `DatePicker`, `TimePicker`, `AutoComplete` und kein `<Form.Item` mehr (dort nur
  `Feld`). Damit fällt die bekannte Grenze 1 des alten Wächters weg. Ausnahmen bleiben
  Tabellenspalten und der Download-Fortschrittsbalken.
- `theme/schriftgroesse.guard.test.ts` mit `schriftgroesse.schuld.ts` nach dem Muster von
  `abstandsraster`: zählt `fontSize: <Zahl>` in TS/TSX und `font-size: <Zahl>px` in CSS je Datei;
  neue Literale rot, Schuld sinkt nur. Ausnahmen wie beim Abstandsraster plus `theme/`. Die
  Scan-Hilfen (Kommentare entfernen, Dateien sammeln, Schuld vergleichen) teilt er mit dem
  Abstandsraster-Wächter über ein gemeinsames Modul `test/ratsche.ts`, statt sie zu kopieren.
*Verworfen:* Wächter nur auf `Feld`-Pflicht ohne Breitenprüfung (ein `Input style={{width}}`
außerhalb von Form.Item entginge ihm).

### D8 Regeltext

`frontend/AGENTS.md`: Bausteine-Liste um die vier ergänzen, die Skala um `kartentitel`;
Bausteinwahl: neue Zeilen „Text in einer Stufe“, „Elemente mit Abstand reihen“, „Angaben zu einem
Datensatz in einer Zeile“, Feld-Zeile auf `Feld` umgestellt; Karten `Text`, `Stapel`,
`MetaZeile` im Design System, `Eingabefeld` zeigt `Feld`. Der Verweis auf den alten Wächter in
den Kommentaren von `karten/OnlineQuellenVerwaltung*` und `pages/einstellungen/EinsatzVerhalten.tsx`
wird nachgezogen.

## Risks / Trade-offs

- [Einrasten 13 → 14/12 verschiebt Zeilenhöhen um 1–2 px] → Pilot nur im Verwaltungsteil;
  Bilder vorher/nachher im PR; Kontrasttests laufen mit.
- [`Feld` ohne `style` blockiert Sonderfälle] → `className` bleibt offen; ein echter Sonderfall
  wird eine neue Breitenstufe, keine Ausnahme.
- [Ratsche mit großer Anfangsschuld (rund 240 Literale in 100 Dateien)] → sinkt mit jeder
  Folgeaufgabe; die Zahl steht im Wächter.
- [Kollision mit parallelen PRs im Verwaltungsteil] → kleiner Pilot, Merge von `alpha` vor dem
  Auto-Merge.
- [Neues Prop-Vokabular] → Bausteinwahl-Zeilen und Karten; Typen lassen nur gültige Werte zu.

## Migration Plan

Kein Daten- oder API-Wechsel. Rückweg: Bausteine bleiben, Pilotdateien lassen sich einzeln
zurücksetzen. Nach dem Merge Design System neu veröffentlichen (`frontend/AGENTS.md`,
„Größere UI-Entwürfe“).
