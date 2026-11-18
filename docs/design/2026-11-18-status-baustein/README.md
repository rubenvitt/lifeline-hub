# Status-Baustein, Statusknopf, Quittung und FMS-Tableau (18.11.2026)

Dieser Ordner enthält den Entwurf für Welle 2 von LLH-1720 („Design System: Farbe, Status und Affordanz“) mit den
Unteraufgaben LLH-1779, 1780, 1781 und 1782. Der Lösungsweg wurde am 16.11.2026 mit Ruben
abgestimmt, die Change am 18.11.2026 freigegeben:
`openspec/changes/archive/2026-11-18-eon26eat-status-und-bedienung/` (Entscheidungen D1–D11 in `design.md`).

**Stand dieses Ordners:** Er enthält die Zeichenflächen des Canvas
https://claude.ai/artifact/Ru8XsxoHtYRvKhfNyN6b57 (Artifact-Typ „Design“, Design System „Lifeline
Hub“, Stand 1794985882-be3d). Die Schriften lädt der Canvas über Google Fonts; im Repo fallen die
Flächen auf die Systemschrift zurück. Die Farben sind die Werte aus `tokens.json` des Design
Systems.

| Datei             | Zeichenfläche                                                                        |
| ----------------- | ------------------------------------------------------------------------------------ |
| `Main.dc.html`    | `Status` (klein, normal), `Marke` (mit und ohne Entfernen), Statusknopf, Nacht und Tag |
| `Menue.dc.html`   | Statusmenü mit Rufname als Kopf, kompakt und Handschuh mehrspaltig, Quittung        |
| `Tableau.dc.html` | FMS-Tableau: Kacheln mit großem Statusblock, Rufname 22 px, Typ und Einheit          |

Abweichungen vom Design der Change: keine. Die `Marke` trägt die zweite Textstufe (`gedaempft`) auf
`flaeche2` mit leichter Sperrung, damit sie neben einem neutralen Status (`flaeche3`, `text2`) als
Kennzeichnung erkennbar bleibt.
