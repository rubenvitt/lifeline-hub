# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/m4i2tooruqk2d2widlsyl6tr (LLH-1746, Epic LLH-1717)

## Why

Die Karte des Lagemonitors füllt die halbe Wand. Die Gefahrengebiete darauf sind gleichfarbige
Flächen ohne Namen und ohne Stufe, weil die Monitor-Schnittstelle Zonen nur mit Typ und Geometrie
liefert. Wer vor der Wand steht, sieht also, dass es Gefahrengebiete gibt, aber nicht, welches
gefährlich ist. Eine überbelegte Unfallhilfsstelle („8/5“) steht in derselben neutralen Farbe wie
eine halb leere, und niemand erklärt die Zahl.

## What Changes

- Die Verdichtung des Lagemonitors liefert zu jeder Gefahrenzone des Typs Gefahrengebiet die
  Bezeichnung ihres Gefahrengebiets, dessen höchste Warnstufe und ob die Beurteilung bestätigt
  ist. Der Freitext der Zone selbst (Beschriftung, Notiz) und der Name dessen, der beurteilt hat,
  bleiben draußen.
- Die Monitorkarte färbt Gefahrengebiete nach ihrer Warnstufe wie die Lagekarte und beschriftet
  jede Gefahrenzone in Großbild-Schrift: Gefahrengebiete mit Name und Stufe, bei offener
  Beurteilung mit „unbestätigt“, Absperrungen und Sperrgebiete mit ihrem Artwort.
- Eine überbelegte Unfallhilfsstelle (mehr Belegte als Plätze) steht in der Kachel „Belegung der
  Unfallhilfsstellen“ in Alarmrolle und vor den anderen, die Titelzeile der Kachel nennt
  „n überbelegt“. Die Kartenmarke einer UHS zeigt Belegte und Plätze, bei Überbelegung in
  Alarmrolle.
- Nicht in dieser Change: die Kachel „Achtung“ (Warnstufe, Abschnittszustände, Überfälliges).
  Sie ist an LLH-1743 abgegeben, das die Alarmzeile „Was brennt“ auch für den Monitor baut
  (Entscheidung Ruben, 16.11.2026).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lagemonitor`: neue Anforderungen „Gefahrenzonen mit Name und Warnstufe“ und „Überbelegte
  Unfallhilfsstelle in Alarmrolle“; die Grenze „keine Freitexte der Zonen“ wird als Szenario
  festgehalten.

## Impact

- Backend: `src/routes/lagemonitor.rs` (`LagemonitorZone`, `verdichte`), dazu Typ-Codegen
  (`frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`) und die Tests in
  `tests/geraet_kopplung.rs`. Das Lagebild für Externe und `GET /api/v1/lage` bauen ihre Karte
  aus eigenen, ausdrücklich gewählten Feldern (`KartenFeature`) und ändern sich nicht.
- Frontend: `geraet/LagemonitorPage.tsx`, `geraet/LagemonitorKarte.tsx`,
  `geraet/lagemonitorFlaechen.ts` samt Tests; `extern/lagebildKarte.ts` nur im Typ. Die
  UHS-Marke der Karte gilt auch im Lagebild für Externe, das dieselbe Kartenkomponente nutzt.
- Regeln und Doku: `frontend/src/geraet/AGENTS.md` (Lagemonitor: was der Monitor von Zonen
  erhält), Anwenderkapitel `docs/anwender/kapitel/lagemonitor.md` und dessen Bilder
  (`frontend/e2e/doku-bilder/lagemonitor.bilder.ts`), e2e `frontend/e2e/geraet-lagemonitor.spec.ts`.
- Keine Migration, keine neue Route, keine neue Berechtigung.
