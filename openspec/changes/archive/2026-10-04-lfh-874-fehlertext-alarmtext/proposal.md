# Proposal

## Why

Roter Text außerhalb von Formularen hält den Textboden aus Kriterium 5 nicht. antd färbt ihn mit
dem abgeleiteten Token `colorErrorText`, nicht mit der Textrolle `alarmText`. Am Tag ist das die
Füllfarbe `alarm` (`#b02318`), die auf `grund` 5,67 : 1 misst und auf der Karte eines überfälligen
Auftrags (`alarmFlaeche`) 5,52. Nachts leitet antds `darkAlgorithm` `#dc5e5e` ab. Das liegt in der
Schublade (`flaeche2`, z. B. `OfflineRecoveryDrawer`) bei 4,97 und auf `flaeche3` bei 4,88, also
sogar unter dem Nachtboden 5. Betroffen sind die Stellen, die einen Fehler oder einen Verzug
melden: „Befehl nicht gefunden.“, „Lagebericht nicht gefunden.“, „Einsatz nicht gefunden oder kein
Zugriff.“, die ungültige Koordinate in `KoordinatenEingabe`, der Ablehnungsgrund im
`OfflineRecoveryDrawer`, „Abgelehnt“ an der Nachforderung sowie „Überfällig“ und „Alarm“ an Auftrags-
und Meldungskarten. Es ist derselbe Fall wie bei der Feldmeldung im Formular und beim Gefahrrot in
Menü und Knopf: eine Füllfarbe trägt als TEXT den Tagesboden nicht.

## What Changes

- **`colorErrorText` wird app-weit die Textrolle**: `theme/tokens.ts:antdToken` setzt
  `colorErrorText` auf `alarmText` und `colorErrorTextHover`/`colorErrorTextActive` auf
  `alarmHover`, in beiden Modi. antd liest diese drei Tokens nur als Schriftfarbe (`Typography`
  `danger`, Schrift und Beiwerk eines Eingabefelds oder Selects der Variante `filled` im Fehlerzustand).
  Deshalb ist der globale Weg hier richtig, anders als beim globalen `colorError`.
- **Unverändert bleibt das globale `colorError`**: Gefahrknöpfe (gefüllt), Fehlerränder von
  Feldern, der linke Rand einer alarmierten Karte, Ikonen, `Badge` und die Formen von `StatusTag`
  behalten die Füllfarbe `alarm`.
- **Kein Aufrufer ändert sich**: Die Stellen mit `type="danger"` bekommen den neuen Wert über das
  Token. Die Aufrufer von `token.colorError` färben heute keine Schrift (Ränder, `Badge`, Punkte,
  Formzeichen). Das wird beim Umsetzen belegt.
- **Neuer Nachweis**: Ein Unit-Test rechnet `colorErrorText` samt Hover- und Aktivstufe gegen
  jede deckende Fläche, beide Modi. Ein Browser-Spec misst „Befehl nicht gefunden.“ auf dem
  Seitengrund und „Überfällig“ auf der Karte eines überfälligen Auftrags, Tag und Nacht.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `textkontrast-rollen`: neue Anforderung „Fehlertext außerhalb von Formularen in der Textrolle“,
  Gegenstück zur Formularmeldung. Roter Fehler- und Verzugstext trägt `alarmText` statt der
  Füllfarbe und hält Tag ≥ 7 : 1 und Nacht ≥ 5 : 1.

## Impact

- `frontend/src/theme/tokens.ts` (`antdToken`: drei Tokens; Kontrast-Kommentare über beiden
  Paletten und an `antdKomponenten`, das die Grenze zwischen Füll- und Textrolle erklärt)
- `frontend/src/theme/` neuer Unit-Test `fehlertextKontrast.test.ts`
- `frontend/e2e/` neuer Spec `fehlertext-kontrast.spec.ts`
- `frontend/AGENTS.md` (Eintrag „Geerbter Text auf Textrollen“)
- Sichtbar: Roter Fehlertext wird am Tag einen Ton dunkler (`#b02318` → `#8f1c12`), nachts
  heller (`#dc5e5e` → `#ff6b6b`). Ränder und Knöpfe bleiben, wie sie sind. Kein Backend, keine
  API, keine Migration.
