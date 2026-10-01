# Proposal

## Why

Die Deeplink-Hervorhebung einer Zeile (`.zeile-hervorgehoben`, LFH-25) hält in
`frontend/src/index.css` zwei hartkodierte antd-Gelbtöne (`#fffbe6` Tag, `#2b2611` Nacht) statt
einer Rolle. Das verstößt gegen die Festlegung aus LFH-352/A0 („Farbwerte kommen ausschließlich
aus `theme/tokens.ts` / `theme/rollen.css`“). Am Tag hebt sich das Gelb zudem nur 1,04 : 1 von
der weißen Tabellenfläche ab, ist also kaum sichtbar. Dass es durchrutschte, liegt an einer
Lücke im Gate: `gate5.guard.test.ts` sucht in CSS nur nach A0-Rollenwerten, nicht nach
beliebigen Farbliteralen.

Die naheliegenden Rollen tragen nicht allein:

- `flaeche3` ist der Hover-Ton der Katalogtabelle (`rowHoverBg`), die angesprungene Zeile sähe
  aus wie eine gehoverte.
- `achtungFlaeche` bedeutet „Warnzustand“ (Kriterium 7: eine Farbe, eine Bedeutung).
- Nachts hebt sich keine vorhandene Fläche allein sichtbar vom Tabellengrund ab (`flaeche3`
  1,07 : 1, `bedienFlaeche` 1,03 : 1 gegen `flaeche`).

## What Changes

- Die Hervorhebung bekommt **zwei Kanäle aus vorhandenen Rollen**: die Fläche `bedienFlaeche`
  („aktive Beziehung“: die Zeile ist das Ziel eines Sprungs) und eine Ober- und Unterlinie in
  `bedien` (2 px, `inset box-shadow`). Die Linien tragen die Sichtbarkeit in der Nacht und die
  Unterscheidung von Hover, Fokusring und den linken ETB-Typkanten.
- Die Regel zieht ihre Spezifität über antds Zellregel, nach dem Muster der Lückentönung in
  `personen/betroffene.css`. Ob die heutige Regel (0,1,1) gegen antd überhaupt greift, wird
  vorher im Browser gemessen und im Design festgehalten.
- Die Farbverschiebung von Gelb auf Bedienblau ist eine **gewollte Korrektur**: Gelb stand für
  nichts, Blau steht für die Beziehung zwischen Sprungquelle und Ziel.
- Neuer Guard `theme/cssFarbquelle.guard.test.ts`: In handgeschriebenem CSS unter
  `frontend/src/` steht außer in `theme/rollen.css` kein Farbliteral (Hex, `rgb()`/`rgba()`,
  `hsl()`/`hsla()`). Eine Schuldmenge (`components/Markdown.css`,
  `components/MarkdownEditor.css`, je vier `rgba()`-Werte) darf nur schrumpfen.
- Neuer Kontrastnachweis im Browser: Zeilentext auf der Hervorhebung (Tag ≥ 7 : 1,
  Nacht ≥ 5 : 1), Linie gegen die Fläche (≥ 3 : 1), Abgrenzung zur Ruhe- und zur Hover-Zeile.

## Capabilities

### New Capabilities

- `deeplink-hervorhebung`: wie eine per Deeplink angesteuerte Zeile oder Karte markiert wird
  (Rollen, zwei Kanäle, Unterscheidbarkeit von Hover und Fokus, Kontrastböden).
- `css-farbquelle`: handgeschriebenes CSS bezieht Farben nur über die Rollen-Properties aus
  `theme/rollen.css`; ein Guard hält Farbliterale fern, mit einer nur schrumpfenden Schuldmenge.

### Modified Capabilities

(keine)

## Impact

- `frontend/src/index.css` (Regel `.zeile-hervorgehoben`).
- Neu: `frontend/src/theme/cssFarbquelle.guard.test.ts`, `frontend/e2e/deeplink-hervorhebung-kontrast.spec.ts`.
- `frontend/AGENTS.md`, Abschnitt Farbachsen: eine Zeile zur Hervorhebung und zum CSS-Guard.
- Konsumenten der Klasse (`components/Datensicht.tsx`, `etb/EtbZeitachse.tsx`,
  `pages/{Fahrzeuge,Personal,Personen,Tiere}Page.tsx` u. a.) ändern sich nicht.
- Keine neue Farbrolle, kein Backend, keine Abhängigkeit.
