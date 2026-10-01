# Proposal

## Why

Rot, das antd app-weit als Gefahr zeichnet, hält am Tag den Textboden aus Kriterium 5 (7 : 1)
nicht: der rote Menüeintrag („Löschen“, „Stornieren“) misst in Ruhe 6,27 : 1, die Beschriftung
des gefüllten Gefahrknopfs in Rückfragen (Weiß auf `alarm`) 6,78, unter dem Zeiger 5,12. Nachts
ist der rote Menüeintrag unter dem Zeiger mit Weiß auf `#ff6b6b` sogar nur 2,78 : 1 lesbar.
Gerade diese Stellen tragen die unumkehrbaren Handlungen (LFH-363), und
`e2e/betreuung-pruefliste.spec.ts` führt sie deshalb als app-weite Ausnahme mit Untergrenze 4,5.

## What Changes

- **Rot als Text am Tag nimmt `alarmText`** (LFH-618, Regel 1), zentral über die
  Komponenten-Tokens von `Dropdown` und `Button` in `theme/tokens.ts:antdKomponenten`, nicht je
  Menü. Betroffen: roter Menüeintrag (Ruhe), umrandeter Gefahrknopf und Gefahrknopf vom Typ
  `text`. Das globale `colorError` bleibt Füllfarbe für Ränder, Ikonen und Feldränder.
- **Gefüllter Gefahrknopf am Tag auf `alarmText`**: Weiß darauf 8,96.
- **Neue Rolle `alarmHover`** für den Gefahrknopf unter dem Zeiger und beim Drücken. Am Tag ist sie
  **dunkler** als die Ruhe (`#7d1810`, Weiß darauf 10,45, als Text auf `grund` 8,75), nachts
  wertgleich mit antds heutiger Ableitung (`#e88a87`, dunkle Schrift darauf 7,98). Damit hält
  auch der gedrückte Knopf nachts den Boden (heute 3,74).
- **Roter Menüeintrag unter dem Zeiger**: Beschriftung `aufBedien` statt antds festem Weiß.
  Nachts wird daraus dunkle Schrift auf `alarm` mit 7,18 (heute 2,78), am Tag Weiß auf
  `alarmText` mit 8,96.
- **Ausnahme fällt:** „Rot am Tag → LFH-693“ verschwindet aus
  `e2e/betreuung-pruefliste.spec.ts`. Menüeintrag „Stornieren“ und Storno-Knopf messen dort gegen
  den vollen Textboden.
- **Neuer Nachweis:** Ein Unit-Test rechnet die Paare aus Tokens und Komponenten-Tokens. Ein
  Browser-Spec misst den roten Menüeintrag, den gefüllten und den umrandeten Gefahrknopf, jeweils
  in Ruhe und unter dem Zeiger, im Tag- und im Nachtmodus.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `farbrollen-kontrast`: Neue Anforderungen für Text in Gefahrrot und für die Beschriftung auf
  der Gefahrfläche, in Ruhe und unter dem Zeiger. Gemeint ist das Gegenstück zum Primärknopf,
  das LFH-661 hier als Heimat für „Rot am Tag (LFH-693)“ vorgesehen hat.

## Impact

- `frontend/src/theme/tokens.ts` (`Farbrollen.alarmHover`, beide Paletten,
  `antdKomponenten`: `Dropdown`, `Button`; Kontrast-Kommentare)
- `frontend/src/theme/rollen.css` (`--lfh-alarm-hover`), `rollen.guard.test.ts` (Rollenliste),
  `gate5.guard.test.ts` (Rollenwert-Muster)
- `frontend/src/theme/` neuer Unit-Test der Gefahrpaare
- `frontend/e2e/betreuung-pruefliste.spec.ts` (Ausnahme entfernt), neuer
  `frontend/e2e/gefahr-kontrast.spec.ts`
- `frontend/AGENTS.md` (Farbachsen: wo Rot als Text und die Gefahrfläche getragen werden)
- Sichtbar: Am Tag wird jedes Gefahrrot in Menüs und Knöpfen einen Ton dunkler, und der
  Gefahrknopf dunkelt unter dem Zeiger nach, statt aufzuhellen. Nachts wird der rote Menüeintrag
  unter dem Zeiger mit dunkler statt weißer Schrift lesbar. Kein Backend, keine API, keine
  Migration.
