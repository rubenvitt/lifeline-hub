## Why

Das Raster des Schichtplans (`abloesung/schichtplan/SchichtplanRaster`) ist live: Änderungen
anderer erscheinen ohne Neuladen. Bei Blöcken springt dabei nichts, sie stehen in ihrer Zeile an
ihrer Uhrzeit. Bei den **Zeilen** springt es: ein fremder Posten, der vor anderen einsortiert
wird, eine fremde Umsortierung oder ein entfallener Posten verschiebt alle Zeilen darunter um eine
Zeilenhöhe unter dem Zeiger (gemessen 39 px bei 1366 px in der Vorplanung, LLH-1595). Wer gerade
auf einen Block zielt oder ihn zieht, trifft danach den falschen Posten. Das verletzt die Regel
„Live-Updates springen nicht unter dem Cursor“ (`frontend/AGENTS.md`, WCAG 3.2.5) und lässt
Kriterium 12 der Prüfliste (LLH-1586) für `/planungen/:id` und den Schichtplan im Einsatz offen.
Im Einsatz ändern sich Posten (Einheiten, UHS) häufiger als in einer Planung (Zunder LLH-1604).

## What Changes

- Eine **Zeilenschleuse** für Raster und Handy-Liste (`SchichtplanListe`): Solange Fokus oder
  Maus- bzw. Stiftzeiger im Schichtplan steht, ein Zug im Raster läuft, eine Person auf einen
  Block gezogen wird oder ein Dialog des Schichtplans offen ist, bleiben **Menge, Folge und
  Gruppenzugehörigkeit** der Zeilen stehen.
- **Neue Posten** warten hinter einem Sammelbanner. **Entfallene Posten** bleiben als leere,
  gedämpfte Zeile „(entfallen)“ stehen, in der nichts angelegt oder abgelegt werden kann.
  **Umsortierte oder umgehängte Posten** bleiben an ihrem Platz.
- Das Sammelbanner nennt das Wartende im Wortlaut des Rasters („1 neuer Posten · 1 Posten
  entfallen · Reihenfolge geändert“) und übernimmt es mit „anzeigen“. Es liegt als Überlagerung
  mit Nullhöhe über dem Raster und schiebt selbst keine Zeile.
- **Blöcke fließen weiter direkt**, auch Zeileninhalt (Titel) bleibt frisch.
- Gilt für den Schichtplan im Einsatz und die Vorplanung gleichermaßen, über einen gemeinsamen
  Baustein im Modul `abloesung/schichtplan`. Die Schleuse ist die vorhandene
  `components/useZuflussSchleuse.ts` (Datensicht, ListeDetail); es entsteht keine zweite Logik.
- **Nicht:** kein neuer Endpunkt, keine Änderung an Server, Wire oder Codegen. Kein Zähler, kein
  Ton, kein Eintrag im Eingangsband: das Banner ist der einzige Hinweis.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `kraefte-schichtplan`: neue Anforderung „Zeilen ohne Sprung“ für Raster und Handy-Liste.
- `vorplanung`: neue Anforderung „Raster der Planung ohne Sprung“, die auf dieselbe Anforderung
  im Schichtplan verweist.

## Impact

- **Frontend:** neu `abloesung/schichtplan/zeilenSchleuse.ts` (rein, mit Test) und
  `abloesung/schichtplan/SchichtplanSchleuse.tsx` (Hülle mit Banner, mit Test).
  `raster.ts` (`RasterZeile.entfallen`, `pruefeZug` lehnt sie ab), `SchichtplanRaster.tsx`
  (Rückruf für den laufenden Zug, Darstellung der entfallenen Zeile), `SchichtplanListe.tsx`
  (Darstellung der entfallenen Zeile), `SchichtplanAnsicht.tsx` und
  `planung/PlanungSchichtplan.tsx` (Hülle um Raster und Liste).
- **e2e:** `planung.spec.ts` (fremder Posten vorn einsortiert, während der Zeiger über einem
  Block steht) und `abloesung-schichtplan.spec.ts` (fremde Einheit im ersten Abschnitt).
- **Regeln und Doku:** `frontend/src/kraefte/AGENTS.md` (Absatz Schichtplan), Anwenderkapitel
  `abloesung.md` und das Kapitel der Vorplanung (Mitänderungsregel `docs/anwender/AGENTS.md`).
- **Nebenläufig:** LLH-1595 (Branch `claude/lhh-1595-bnex9x`, noch ohne PR) ändert Raster und
  Liste an anderer Stelle (Zielabstand) und bringt `e2e/planung-kern.ts`. Diese Change sät in der
  e2e selbst; beim Zusammenführen wird der Seed auf `planung-kern.ts` umgestellt.
