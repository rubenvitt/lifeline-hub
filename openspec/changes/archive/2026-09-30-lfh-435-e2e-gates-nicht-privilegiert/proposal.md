# Proposal

## Why

Alle Überlauf- und Trefflächen-Gates unter `frontend/e2e/` melden sich als `admin` an. Damit
laufen sie nur durch die freien Zweige der Oberfläche. Die Zweige ohne Recht sind oft breiter
oder anders gebaut: gesperrte Einträge mit Tag, `RechteHinweis`-Banner, gesperrte statt
versteckte Primäraktionen. Diese Zweige sieht die Mehrheit der Nutzer im Einsatz, geprüft
wurden sie nie. In LFH-337 ist genau dort ein echter Überlauf entstanden (Tag „Keine
Berechtigung“ in der Kopfzeile, rund 458 px in 366 px), und das Gate blieb grün. Den
Einzelfall hat LFH-337 behoben. Die strukturelle Lücke besteht weiter (LFH-435).

## What Changes

- Eine gemeinsame e2e-Hilfe für Rollen: Benutzer mit System-/Org-Rolle anlegen, als
  Einsatzmitglied mit Einsatzrolle eintragen, die Sitzung sauber wechseln. Heute baut jede
  Spec das selbst.
- **Welle 1, die Kern-Gates:**
  - `gate1-ueberlauf`: je Prüfbreite ein zusätzlicher Durchgang als **Beobachter** über alle
    Einsatzrouten, dazu ein Durchgang als **Org-Führungskraft** über die Verwaltungsrouten, die
    sie erreicht.
  - `gate3-trefflaeche`: Beobachter-Durchgänge für die rollenabhängigen Flächen, also die
    globale Kopfzeile mit gesperrter Verwaltung ab `lg`, Stab, Ablösung, Kräfte, Betreuung,
    Verpflegung und Betroffene.
  - `trefflaeche-tablet`: Durchgang als Org-Führungskraft auf den Anmeldeverfahren, jede Zeile
    dort mit Sperrgrund.
  - `kopfzeile-schmal`: der Nicht-Admin-Durchgang läuft zusätzlich auf 1024 px, wo der Tag
    „Keine Berechtigung“ steht.
- **Welle 2, die übrigen rollenabhängigen Layout-Specs aus dem Inventar**
  (`einstellungen-schmal`, `uhs-*`, `leisten-flaeche`/Gefahren, `kraefte-schmal`,
  `betroffene-schmal`, `datensicht-schmal`, `lagebericht-schmal`, `lagekarte-leiste-dichte`,
  `katalogtabelle-schmal`/`verwaltung-vereinheitlicht`, `chat-layout`): je ein
  nicht-privilegierter Durchgang, wo der gemessene Zustand von der Rolle abhängt.
- Jeder neue Durchgang sichert seinen Rollenzweig als **Vorbedingung** zu. Ohne diese Prüfung
  wäre er grün durch Nichtstun, weil weggefallene Ziele einfach nicht gemessen würden.
- Für jeden neuen Durchgang gibt es eine **Mutationsprobe**: Wird die Ursache wieder eingebaut,
  wird der Nicht-Admin-Test rot und der Admin-Test bleibt grün.
- Die Freistellungsliste von Gate 1 (`BESTAND_OFFEN`) bekommt die Dimension **Rolle**.
- Das Inventar (Gate × Rolle × rollenabhängig?) liegt als Prüfliste im Change. Die Projektregel
  „ein Layout-Gate prüft jeden rollenabhängigen Zustand mit einer nicht-privilegierten Rolle“
  kommt nach `CLAUDE.md`.
- Wird ein neuer Durchgang rot, entscheidet die Regel in design.md (D5) zwischen Beheben im
  Change und benannter Freistellung mit Ticket. Kleine Layout-Korrekturen am Produkt sind daher
  möglich.

## Capabilities

### New Capabilities
- `layout-gates-rollen`: Überlauffreiheit und Treffflächen der Einsatz- und Verwaltungsflächen
  gelten auch für Benutzer ohne Schreib- oder Verwaltungsrecht (Beobachter, Org-Führungskraft,
  Führungspersonal), nachgewiesen durch e2e-Gates.

### Modified Capabilities
- keine. `einsatztauglichkeit-layout` (LFH-373) sichert Treffflächen und Verdeckung je Fläche;
  diese Change sichert eine eigene Achse, die Rolle, und nimmt deshalb einen eigenen Pfad statt
  die Anforderungen dort zu ändern. (Bei der Planung war LFH-373 noch nicht archiviert.)

## Impact

- `frontend/e2e/`: neue Hilfe `rollen-kern.ts`, Änderungen an rund 16 Specs. Die Laufzeit von
  `pnpm e2e` steigt; das Delta wird gemessen und in der Prüfliste festgehalten. Die Shard-Zahl
  in der CI bleibt unverändert (das Ruleset pinnt die Jobnamen).
- `frontend/src/`: nur, wenn ein neuer Durchgang einen echten Befund liefert und D5 das Beheben
  im Change vorsieht.
- `CLAUDE.md`: eine Zeile unter „Qualitäts-Gates“.
- Kein Backend, keine API, keine Migration.
