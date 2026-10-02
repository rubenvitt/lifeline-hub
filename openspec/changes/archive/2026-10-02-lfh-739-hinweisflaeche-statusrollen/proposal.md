# Proposal

## Why

Ein Knopf auf einem Hinweis (antds `Alert`) hat am Tag einen Rand unter 3 : 1 gegen die
Hinweisfläche (WCAG 1.4.11, Kriterium 5). Die Prüfliste zu LFH-690 maß am Demo-Hinweis der
Einsatzliste 2,84. Seit LFH-661 ist es schlechter: antd leitet die Hinweisflächen aus den
Signalfarben ab, und das dunklere `bedien` macht die Info-Fläche am Tag trüb (`#b9c1c4`). Der
Rand `steuerRahmen` misst darauf nachgerechnet nur noch **2,16**. Es trifft drei der vier
Hinweistypen, nachts Warnung und Erfolg:

| Hinweistyp | Fläche heute (Tag) | Rand Tag | Rand Nacht |
| --- | --- | --- | --- |
| Info | `#b9c1c4` | 2,16 | 3,09 |
| Warnung | `#bab7a8` | 1,96 | 2,83 |
| Fehler | `#f0e5e1` | 3,20 | 3,01 |
| Erfolg | `#9ca69f` | 1,57 | 2,98 |

Knöpfe auf Hinweisen sind häufig: „Erneut abrufen“/„Erneut laden“ an jedem Ladefehler, der
Live-Banner, „Zu den Demo-Daten“.

## What Changes

- **Hinweisflächen lesen die Statusflächen-Rollen**: Info `bedienFlaeche`, Warnung
  `achtungFlaeche`, Fehler `alarmFlaeche`, Erfolg `normalFlaeche`. Das geschieht zentral über die
  Komponenten-Tokens des `Alert` in `theme/tokens.ts:antdKomponenten`, nicht je Hinweis.
  `steuerRahmen` hält darauf Tag ≥ 3,22 und Nacht ≥ 3,26, Text ≥ 14,95.
- **`steuerRahmen` bleibt unverändert**, ebenso die globalen antd-Flächen `colorInfoBg` usw.,
  die außerhalb des `Alert` in Knopf, Eingabefeld, Menü, Auswahl und Schritten wirken.
- **Sichtbar:** Am Tag werden die Hinweise heller und klarer getönt statt grau-trüb. Nachts
  ändert sich der Ton kaum.
- **Neuer Nachweis:** Ein Unit-Test rechnet den Knopfrand gegen jede Hinweisfläche. Ein
  Browser-Spec misst den Rand am Demo-Hinweis (Info) und an einem Ladefehler (Fehler), Tag und
  Nacht, mit `randKontrast`.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `farbrollen-kontrast`: Neue Anforderung, dass der Rand eines Steuerelements auf einer
  Hinweisfläche in beiden Modi mindestens 3 : 1 hält und die Hinweisflächen app-weit aus einer
  Stelle kommen.

## Impact

- `frontend/src/theme/tokens.ts` (`antdKomponenten`: `Alert`; Kontrast-Kommentare)
- `frontend/src/theme/` neuer Unit-Test der Hinweispaare
- `frontend/e2e/` neuer Spec `hinweis-kontrast.spec.ts`
- `frontend/AGENTS.md` (Farbachsen: Hinweisflächen lesen die Statusflächen-Rollen)
- Kein Backend, keine API, keine Migration, keine neue Farbrolle.
