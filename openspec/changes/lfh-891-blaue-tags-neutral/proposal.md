# Proposal

## Why

Sechs Stellen zeichnen eine Marke mit antds Preset `<Tag color="blue">`. Die Beschriftung steht
auf der eigenen, deckenden Fläche der Marke und unterschreitet den Textboden aus Kriterium 5
(Tag ≥ 7 : 1, Nacht ≥ 5 : 1). Gemessen hat das der Browsernachweis zu LFH-696 am 01.10.2026 an
„ad-hoc“ in der Fahrzeugliste:

| Modus | Text | Fläche | Kontrast |
| --- | --- | --- | --- |
| Tag | rgb(9, 88, 217) | rgb(230, 244, 255) | 5,50 |
| Nacht | rgb(60, 137, 232) | rgb(17, 26, 44) | 4,91 |

Die Preset-Farbe kommt aus antds eigener Palette, nicht aus den Rollen (`theme/tokens.ts`). Sie
misst deshalb an jeder Stelle gleich schlecht, und keine Rolle kann sie heben. Dazu kommt die
Bedeutung: Blau bedient (`frontend/AGENTS.md`, „Farbe und Zeichen“). Keine der Marken ist
bedienbar. Sie sind Kennzeichnungen, und ein Blau suggeriert dort ein Ziel, das es nicht gibt.

## What Changes

- **Die blauen Marken werden neutral**: `Tag` ohne `color`, wie schon die Demo-Marke
  (LFH-733). Das Wort trägt die Bedeutung, die Umrandung die Form. Betroffen sind:
  - „ad-hoc“ an Fahrzeug, Personal und Material (`FahrzeugePage`, `PersonalPage`,
    `MaterialPage`)
  - die Besatzungsstärke ohne hinterlegtes Soll (`FahrzeugePage`, `BesatzungsStaerkeBadge`)
  - die Halter-Registriernummer an Tieren (`TierePage`, `TiereDetailPage`)
  - die TMO-Sprechgruppe in der Funk-Erreichbarkeit (`FunkErreichbarkeit`), mit ihr die
    DMO-Sprechgruppe im Preset `geekblue`, damit das Paar einheitlich bleibt
  - „Führungskraft“ im Benutzermenü (`BenutzerMenu`)
- **Guard:** Kein `Tag` trägt mehr das Preset `blue`, weder als Literal noch in einem
  Ausdruck. Der Guard läuft im bestehenden Tag-Scanner des Statusfarb-Vertrags.
- **Browser-Nachweis:** Die Beschriftung von „ad-hoc“ hält gegen ihre Fläche im Tagmodus
  ≥ 7 : 1 und im Nachtmodus ≥ 5 : 1, in der Personal- und in der Fahrzeugliste.
- **Regel:** `frontend/AGENTS.md` nennt neben „Nie `color="black"`“ auch „Nie `color="blue"`“
  an antds `Tag`.
- **Sichtbar:** Die Marken werden grau umrandet statt blau getönt. Die Wörter bleiben
  unverändert.

## Capabilities

### New Capabilities
- keine

### Modified Capabilities
- `farbrollen-kontrast`: Neue Anforderung, dass die Beschriftung einer Marke gegen deren eigene
  Fläche den Textboden hält und keine Marke die Bedienfarbe Blau als Preset trägt.

## Impact

- `frontend/src/pages/FahrzeugePage.tsx`, `PersonalPage.tsx`, `MaterialPage.tsx`,
  `TierePage.tsx`, `TiereDetailPage.tsx`
- `frontend/src/components/FunkErreichbarkeit.tsx`, `BenutzerMenu.tsx`
- `frontend/src/theme/statusVertrag.guard.test.ts` (Guard 3)
- `frontend/e2e/` neuer Spec `marken-kontrast.spec.ts`
- `frontend/AGENTS.md` (Farbachsen)
- Kein Backend, keine API, keine Migration, keine neue Farbrolle.
