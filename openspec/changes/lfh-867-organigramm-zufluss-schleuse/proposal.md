# Proposal

## Why

Das Organigramm der Führungsorganisation (LFH-626) und die Fernmeldeskizze des S6 (LFH-625)
folgen der Gliederung live. Ein neuer, umgehängter oder aufgelöster Abschnitt und eine neue oder
umgehängte Einheit verschieben die Knoten dahinter sofort, auch wenn gerade jemand auf einen
Namenslink zielt. Beide Prüflisten führen Kriterium 12 „Kein Sprung unter dem Cursor“ deshalb auf
**offen** an LFH-867; die Prüfliste der Fernmeldeskizze sagt ausdrücklich, das Zielticket gelte
für das geteilte Gerüst `HaengenderBaum` und damit für beide Nutzer.

Für Listen und die Betroffenen-Karte hat das Projekt die Antwort schon: die Zeilenschleuse der
`Datensicht` und die Schleuse der Betroffenen-Karte (LFH-668), jeweils mit Sammelbanner (WCAG
3.2.5, Bedien-Leitlinie „Live-Updates springen nicht unter dem Cursor“).

## What Changes

- **Schleuse im Gerüst `HaengenderBaum`:** Solange die Maus (oder ein Stift) über dem Baum liegt
  oder der Fokus darin steht, hält der Baum **Menge, Ort und Reihenfolge** seiner Knoten. Name,
  Rufname, Leitung, Stärke und Sprechgruppen der gezeigten Knoten aktualisieren weiter. Neue,
  umgehängte und entfallene Knoten warten.
- **Entfallene Knoten bleiben bis zum Anwenden stehen**, als Platzhalter ohne Link mit dem Wort
  „entfallen“: ein Wegfall rückte sonst alles dahinter nach oben.
- **Der Kopf** (Einsatzleitung, Stabsstelle, Funkangaben der Führungsstelle) steht während der
  Schleuse still: eine neue Stabszeile verlängerte ihn und schöbe den ganzen Baum.
- **Standzeile mit fester Höhe** über dem Baum: „Live“, „Live pausiert“ oder der Sammelbanner
  („2 neu · 1 umgehängt — anzeigen“). Ihr Wechsel verschiebt den Baum nicht. Sie liegt im Bereich
  der Schleuse, der Weg zum Banner taut also nicht auf.
- Die Schleuse öffnet, wenn Zeiger und Fokus den Baum verlassen, oder auf „anzeigen“.
- **Druck und Übernahme zeigen immer den aktuellen Stand:** im Druck gilt die Schleuse nicht, die
  Übernahme in den Lagebericht liest wie bisher das frische Modell.
- Beide Nutzer bekommen das ohne eigenen Code: Organigramm und Fernmeldeskizze.
- Prüflisten LFH-626 und LFH-625, Kriterium 12, werden mit Verdikt und Belegen nachgetragen.

## Nicht enthalten

- Die Baumtabellen der `Datensicht` (Funkplan-Tabelle, Kommunikationsplan): ihre Schleuse hält
  nur die oberste Ebene, und sie reagiert nur auf den Fokus, nicht auf den Zeiger. Die Prüfliste
  LFH-848 verweist dafür ebenfalls auf LFH-867. Vorschlag: eigenes Ticket (s. design.md D6).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `fuehrungsorganisation`: Live-Änderungen der Gliederung warten, solange jemand mit dem
  Organigramm arbeitet, und erscheinen im Sammelbanner.
- `stab-fernmeldeskizze`: dasselbe für die Skizze.

## Impact

- Frontend: `components/organigramm/HaengenderBaum.tsx` (Schleusenbereich, Standzeile,
  Platzhalter), neue reine Logik `components/organigramm/baumSchleuse.ts` mit Tests,
  `components/organigramm/haengenderBaumPrint.css` (Standzeile aus). Organigramm und
  Fernmeldeskizze ändern sich nur, soweit der Kopf es braucht.
- e2e: `e2e/fuehrungsorganisation.spec.ts` (Fokus, Zeiger, ohne beides, Mutationsprobe), ein
  Zeigerfall für die Skizze.
- Regeln: `frontend/AGENTS.md` (Organigramm-Absatz).
- Doku: Prüflisten in `openspec/changes/archive/2026-10-01-lfh-626-…` und `…-lfh-625-…`.
- Kein Backend, keine API, keine Migration.
