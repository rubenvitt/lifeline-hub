# Proposal

## Why

`Typography.Text` vom Typ `danger`, `warning` oder `success` färbt Text mit antds abgeleiteten
Statustext-Tokens (`colorErrorText`, `colorWarningText`, `colorSuccessText`). Gerechnet mit dem
echten Algorithmus je Modus halten sie den Textboden aus Kriterium 5 nicht: am Tag sind sie die
Füllfarben `alarm`/`achtung`/`normal` (5,31–6,94 : 1 auf den deckenden Flächen), nachts leitet antd
eigene Töne ab, die in keiner Rolle stehen (`#dc5e5e` mit 4,88 auf `flaeche3`, `#c8b034`,
`#49aa19`). Betroffen sind Fehlerzeilen wie „Befehl nicht gefunden.“, „überfällig“ auf Auftrags-
und Meldungskarten und Hinweise wie „nicht verortet“ auf der Lagekarte, also genau die Wörter, die
gelesen werden müssen.

## What Changes

- **Statustext trägt die Textrolle des Status**: antds Statustext-Tokens werden global aus den
  Rollen gesetzt, `colorErrorText` (samt Zeiger- und Drückstufe) auf `alarmText`,
  `colorWarningText` auf `achtungText`, `colorSuccessText` auf `normalText`. Die Füllfarben
  `colorError`/`colorWarning`/`colorSuccess` bleiben unverändert für Kante, Badge, Ikone und
  Gefahrknopf.
- Damit liest jede Stelle mit `Typography` `danger`/`warning`/`success` die Textrolle, ohne
  eigene Farbe am Ort. Dieselben Tokens nutzt antd auch für Statustext in Eingabefeldern
  (Beschriftung eines Feldzusatzes, Text im gefüllten Feld mit Status), dort wirkt die Änderung
  mit.
- **Nachweis**: Einheitstest am aufgelösten Token je Modus (Rollenwert und Boden auf allen
  deckenden Flächen); Browsermessung von „Befehl nicht gefunden.“ (danger) und „nicht verortet“
  auf der Lagekarte (warning) im Tag- und im Nachtmodus gegen 7 / 5.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `textkontrast-rollen`: Neue Anforderung „Statustext in der Textrolle des Status“. Text, den antd
  als Fehler, Warnung oder Erfolg auszeichnet, trägt `alarm`/`achtung`/`normal` als Text und hält
  den Boden der Spec. Gegenstück zur Formularmeldung aus derselben Spec.

## Impact

- `frontend/src/theme/tokens.ts` (`antdToken`: drei Statustext-Tokens samt Zeiger-/Drückstufe;
  Begründung am Wert und Kontrastwerte im Kommentar über den Paletten)
- `frontend/src/theme/tokens.test.ts` bzw. ein Kontrast-Test in `frontend/src/theme/`
- neuer `frontend/e2e/statustext-kontrast.spec.ts`
- `frontend/AGENTS.md` (Eintrag „Geerbter Text auf Textrollen“ um den Statustext ergänzt)
- Sichtbar: Am Tag werden rote, gelbe und grüne Statuswörter in Fließtext einen Ton dunkler,
  nachts nehmen sie genau die Rollentöne an (Rot heller, Gelb klarer). Kein Backend, keine API,
  keine Migration, keine neue Farbe.
