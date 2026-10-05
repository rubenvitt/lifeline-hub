# Proposal

## Why

Die Fläche der gewählten Option (antds `colorPrimaryBg`, daraus `controlItemBgActive`) leitet
antd aus `bedien` ab. Seit dem dunkleren `bedien` ist sie am Tag ein trüber Grauton `#b9c1c4`,
nachts ein heller Blauton `#253a4e`, und auf beiden reißen Text und Rand den Boden aus
Kriterium 5. Gerechnet mit den aufgelösten Tokens (antd 6.6.5):

| Paar auf der Auswahlfläche | Tag (`#b9c1c4`) | Nacht (`#253a4e`) | Boden |
| --- | --- | --- | --- |
| `text` | 10,10 | 9,78 | 7 · 5 |
| `gedaempft` (Beschreibung) | **6,01** | **4,53** | 7 · 5 |
| `schwach` (Platzhalter, Meta) | **4,92** | **3,39** | 7 · 5 |
| `bedien` (Schrift des gewählten Menüeintrags) | **4,68** | **3,64** | 7 · 5 |
| `steuerRahmen` (Rand) | **2,16** | **2,13** | 3 |

Unter dem Zeiger (`controlItemBgActiveHover`, Tag `#93abb8`, Nacht `#2e4e6b`) liegt die Schrift
des gewählten Menüeintrags bei 3,57 bzw. 2,70.

Getroffen ist vor allem die **Statuswahl** (`StatusWahl`, ein `Dropdown` mit gewähltem Eintrag in
`bedien`) und die Typwahl der ETB-Schnellerfassung, dazu die gewählte Option jeder Auswahlliste
(`Select`/`AutoComplete`), der gewählte Knoten im Abschnittsbaum und vier Stellen, die
`token.colorPrimaryBg` selbst lesen (Gefahrengebiete, Bild platzieren in der Lagekarte,
Drop-Ziel im UHS-Grundriss, Slash-Menü im ETB).

## What Changes

- **Neue Farbrolle `auswahlFlaeche`** in beiden Modi (Tag `#dbe7f5`, Nacht `#08172b`): ein klar
  blau getönter Ton, auf dem jede Textstufe und `bedienText` den Textboden halten und
  `steuerRahmen` ≥ 3 : 1, und der sich von Ruhe und Zeiger deutlicher abhebt als `bedienFlaeche`.
- **Global gesetzt** in `antdToken`: `colorPrimaryBg` und `colorPrimaryBgHover` lesen
  `auswahlFlaeche`. Damit folgen `controlItemBgActive`/`controlItemBgActiveHover` und jede Stelle,
  die die Tokens selbst liest, aus einer Stelle.
- **Schrift des gewählten Dropdown-Eintrags** in `bedienText` statt `bedien` (Komponenten-Token
  `Dropdown.colorPrimary`): `bedien` hielte am Tag auch auf der neuen Fläche nur 6,83.
- **Sichtbar:** Am Tag wird die gewählte Option hellblau statt grau, nachts dunkelblau statt
  mittelblau. Unter dem Zeiger ändert sich der gewählte Eintrag nicht mehr (s. design.md E3).
- **Neuer Nachweis:** Unit-Test der Paare auf der Auswahlfläche, Browser-Spec an Statuswahl und
  Auswahlliste, Tag und Nacht.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `farbrollen-kontrast`: Neue Anforderungen, dass Text und Rand auf der Auswahlfläche den Boden
  halten, die Auswahlfläche app-weit aus einer Rolle kommt und sich von Ruhe und Zeiger abhebt.

## Impact

- `frontend/src/theme/tokens.ts` (`Farbrollen`, beide Paletten, `antdToken`, `antdKomponenten`:
  `Dropdown`; Kontrast-Kommentare)
- `frontend/src/theme/rollen.css` (`--lfh-auswahl-flaeche` in beiden Modi),
  `theme/rollen.guard.test.ts` (Zuordnung)
- `frontend/src/theme/statusFarben.test.ts` (die Zusicherung, `colorPrimaryBg` bleibe antds
  Ableitung, fällt)
- `frontend/src/theme/` neuer Unit-Test `auswahlKontrast.test.ts`
- `frontend/e2e/` neuer Spec `auswahl-kontrast.spec.ts`
- Kommentare an den vier Stellen, die `token.colorPrimaryBg`/`controlItemBgActive` lesen
- `frontend/AGENTS.md` (Farbachsen: Auswahlfläche)
- Kein Backend, keine API, keine Migration.
