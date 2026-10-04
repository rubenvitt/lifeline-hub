# Proposal

## Why

`Typography.Text` vom Typ `warning` oder `success` färbt Text mit antds abgeleiteten
Statustext-Tokens (`colorWarningText`, `colorSuccessText`). Gerechnet mit dem echten Algorithmus je
Modus halten sie den Textboden aus Kriterium 5 am Tag nicht: dort sind sie die Füllfarben
`achtung`/`normal` (5,43–6,94 : 1 auf den deckenden Flächen). Nachts leitet antd eigene Töne ab, die
in keiner Rolle stehen (`#c8b034`, `#49aa19`). Betroffen sind Hinweise wie „nicht verortet“ und
„näher heranzoomen“ auf der Lagekarte oder die Warnung zur Aufbewahrungsdauer in den Einstellungen.

Den roten Statustext (`danger`, `colorErrorText`) trägt die Change `lfh-874-fehlertext-alarmtext`
auf demselben Weg. Diese Change ergänzt Gelb und Grün und setzt auf deren Stand auf.

## What Changes

- **Warn- und Erfolgstext tragen die Textrolle des Status**: antds Statustext-Tokens werden
  global aus den Rollen gesetzt, `colorWarningText` auf `achtungText`, `colorSuccessText` auf
  `normalText`. Die Füllfarben `colorWarning`/`colorSuccess` bleiben unverändert für Kante, Badge
  und Ikone.
- Damit liest jede Stelle mit `Typography` `warning`/`success` die Textrolle, ohne eigene Farbe
  am Ort. Dieselben Tokens nutzt antd auch für Statustext in Eingabefeldern
  (Beschriftung eines Feldzusatzes, Text im gefüllten Feld mit Status), dort wirkt die Änderung
  mit.
- **Nachweis**: Einheitstest am aufgelösten Token je Modus (Rollenwert und Boden auf allen
  deckenden Flächen); Browsermessung von „nicht verortet“ auf der Lagekarte (warning) im Tag- und
  im Nachtmodus gegen 7 / 5. Eine Stelle mit `success` gibt es heute nicht, sie wird nur
  gerechnet.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `textkontrast-rollen`: Neue Anforderung „Warn- und Erfolgstext in der Textrolle des Status“.
  Text, den antd als Warnung oder Erfolg auszeichnet, trägt `achtung`/`normal` als Text und hält
  den Boden der Spec. Gegenstück zum Fehlertext und zur Formularmeldung aus derselben Spec.

## Impact

- `frontend/src/theme/tokens.ts` (`antdToken`: zwei Statustext-Tokens neben den roten;
  Begründung am Wert und Kontrastwerte im Kommentar über den Paletten)
- `frontend/src/theme/tokens.test.ts` bzw. ein Kontrast-Test in `frontend/src/theme/`
- neuer `frontend/e2e/statustext-kontrast.spec.ts`
- `frontend/AGENTS.md` (Eintrag „Geerbter Text auf Textrollen“ um den Statustext ergänzt)
- Sichtbar: Am Tag werden gelbe und grüne Statuswörter in Fließtext einen Ton dunkler, nachts
  nehmen sie genau die Rollentöne an (Gelb klarer, Grün heller). Kein Backend, keine API,
  keine Migration, keine neue Farbe.
