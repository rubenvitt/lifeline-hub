# Proposal

## Why

An Sammelstelle und UHS arbeiten Einsatzkräfte einhändig am Handy. Dort zeigt die
Betroffenenliste bei 390 × 844 im ersten Bildschirm nur Kopfknöpfe, Erfassungszeile und Filter
(erste Person bei y ≈ 719 px, Sichtungsbild bei ≈ 2100 px), das Personen-Detail stellt elf
Stammdatenzeilen vor Verlaufsnotiz und Verlauf, „Schnellerfassung“ und „Betroffene/n erfassen“
öffnen dieselbe Maske mit unsichtbar verschiedenem Ergebnis, und die Tiere-Erfassung zeigt fünf
bis acht Felder offen (Audit-Befunde U17, U28, U76, U77). Die Klärungsrunde vom 06.10.2026 hat
die Begriffe dazu entschieden (Fragen 3, 8 und 9, jeweils Option A).

## What Changes

- **Seitenkopf bündelt Nebenwege unter `md` zentral:** `EinsatzSeite` bekommt einen zweiten
  Slot `weitere` für Nebenwege (Drucken, CSV-Export, Listenzugriffe). Ab `md` stehen sie wie
  bisher als sekundäre Knöpfe im Kopf, unter `md` gebündelt hinter einem Auslöser „Weitere“.
  Sichtbar bleiben unter `md` die Segmentleiste, genau eine Erfassung und, bei Betroffenen und
  Tieren, „Vermisst melden“. Umgestellt werden die Listen Betroffene, Tiere und Schäden; die
  übrigen Seiten mit Nebenwegen im Kopf folgen als eigenes Ticket.
- **Eine Personenmaske:** „Schnellerfassung“ und „Betroffene/n erfassen“ werden zu
  „Betroffene erfassen“ (Kopf und Sprungpalette über `?neu=1` öffnen dieselbe Maske). Die Person bekommt
  immer den Status „erfasst“; der Dialog sagt das und nennt „mit Sichtung → betroffen“.
  Der Statusfilter heißt „Erfasst“ statt „Neu“, wie die Tabelle.
- **Betroffenenliste am Handy:** Unter `xl` steht über der Liste eine einzeilige
  Sichtungszusammenfassung (Gesamtzahl, SK I–IV, tot); der Kürzel-Hinweis der Erfassungszeile
  klappt unter `md` ein.
- **Tiere-Erfassung im Feldbudget:** sichtbar Spezies, Rufname, Antreffort; Rasse, Notiz und die
  Vermisst-Zusatzfelder unter „Weitere Angaben“ (`forceRender`). Der Knopf heißt
  „Tier erfassen“.
- **Personen-Detail:** Stammdaten auf `Datenraster`/`Datenfeld` statt `Descriptions`, leere
  Angaben in einer Zeile „Ohne Angabe: …“; unter `lg` steht die medizinische Spalte
  (Sichtung, Verlaufsnotiz, Verlauf) vor den Stammdaten.
- **Regeln:** `frontend/AGENTS.md` (Aktionen: Nebenwege über `weitere`) und
  `frontend/src/personen/AGENTS.md` (eine Maske, Begriff „erfasst“).

## Capabilities

### New Capabilities
- `betroffene-erfassung`: Wie Personen und Tiere im Modul Betroffene erfasst werden — eine
  allgemeine Personenmaske mit sichtbarem Folgestatus, gleiche Statusbegriffe in Filter und
  Tabelle, Feldbudget der Tiere-Erfassung.

### Modified Capabilities
- `einsatztauglichkeit-layout`: neue Zusicherungen für den Seitenkopf unter `md` (Nebenwege
  gebündelt), den ersten Bildschirm der Betroffenenliste auf dem Handschirm und die
  Reihenfolge im Personen-Detail auf Handschirm und Tablet hoch.

## Impact

- Frontend: `components/EinsatzSeite.tsx`, `pages/PersonenPage.tsx`,
  `pages/PersonenDetailPage.tsx`, `pages/TierePage.tsx`, `pages/SchaedenPage.tsx`,
  `personen/PersonErfassungModal.tsx`, `personen/AufnahmeFelder.tsx`,
  `personen/personenFilter.ts`, `personen/BetroffeneZeile.tsx`, neue Sichtungszeile unter
  `personen/`; Tests (Vitest, e2e) an diesen Stellen.
- Kein Backend, keine Migration, keine API-Änderung.
- Regeldateien: `frontend/AGENTS.md`, `frontend/src/personen/AGENTS.md`.
