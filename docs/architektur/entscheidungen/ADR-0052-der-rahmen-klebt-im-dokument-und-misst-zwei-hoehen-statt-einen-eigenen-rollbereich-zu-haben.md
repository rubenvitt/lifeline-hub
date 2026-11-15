---
id: ADR-0052
titel: Der Rahmen klebt im Dokument und misst zwei Höhen, statt einen eigenen Rollbereich zu haben
status: akzeptiert
datum: 2026-11-15
gilt_fuer:
  - frontend/src/components/rahmenOben.ts
  - frontend/src/components/seitenkopfKleben.ts
  - frontend/src/components/EinsatzSeite.tsx
  - frontend/src/components/AdminPage.tsx
  - frontend/src/einsatz/EinsatzLayout.tsx
  - frontend/src/einsatz/ModulPanel.tsx
  - frontend/src/einsatz/IconRail.tsx
  - frontend/src/admin/AdminLayout.tsx
herleitung:
  - openspec/changes/archive/2026-11-15-zjt7c073-rahmen-fest-inhalt-rollt/design.md
  - Zunder LLH-1727 (Weg abgestimmt mit Ruben am 15.11.2026)
---

# ADR-0052: Der Rahmen klebt im Dokument und misst zwei Höhen, statt einen eigenen Rollbereich zu haben

## Regeln

- MUST: Im Einsatz und in der Verwaltung rollt das Dokument; was stehen bleibt (Kopfleiste, Rail,
  Modulpanel, Seitenkopf, Verwaltungsmenü), klebt per `position: sticky`.
- MUST NOT: Die Inhaltsfläche des Einsatzrahmens bekommt einen eigenen Scrollbereich
  (`overflow: auto|scroll`).
- MUST: Was neben dem Inhalt klebt, und der Seitenkopf selbst hängen an `--lfh-kopf-oben`; jeder
  klebende Inhalt hängt an `--lfh-rahmen-oben` (`frontend/AGENTS.md`, Rahmen, „Zwei Höhen“).
- MUST: Der Seitenkopf klebt nur, wenn er mit der Kopfleiste ins Drittel der Fensterhöhe passt;
  die Entscheidung liest die Kopfhöhe, nie die Rahmenhöhe.

## Prüfung

```sh
verbiete "overflow(Y)?: *'(auto|scroll)'" frontend/src/einsatz/EinsatzLayout.tsx
verlange "position: 'sticky'" frontend/src/einsatz/ModulPanel.tsx
verlange 'lfh-kopf-oben' frontend/src/einsatz/ModulPanel.tsx
verlange 'lfh-kopf-oben' frontend/src/einsatz/IconRail.tsx
verlange 'lfh-kopf-oben' frontend/src/admin/AdminLayout.tsx
verlange 'useSeitenkopfKleben' frontend/src/components/EinsatzSeite.tsx
verlange 'useSeitenkopfKleben' frontend/src/components/AdminPage.tsx
verlange 'KLEBEN_HOECHSTENS' frontend/src/components/seitenkopfKleben.ts
verlange 'useKopfOben\(\)' frontend/src/components/seitenkopfKleben.ts
```

## Kontext

Auf langen Seiten rollten Modulpanel und Seitenkopf weg; das ETB öffnet am Ende der Zeitachse,
die Modulliste stand dort leer. Ein eigener Scrollbereich nur für den Inhalt hätte das wörtlich
gelöst, aber alles gebrochen, was am Fenster-Bildlauf hängt: „Nach oben“, Fokusabstand,
Alarmkante, `restHoehe`, Bildlauf beim Zurück-Navigieren und viele e2e-Messungen.

## Konsequenzen

Rund 40 Stellen, die unter `--lfh-rahmen-oben` kleben, hängen sich ohne Änderung unter den
Seitenkopf. Dafür gibt es zwei Höhen statt einer, und der Guard
`rahmenOben.guard.test.ts` hält fest, wer die Kopfhöhe nehmen darf. Ein Element, das neben dem
Inhalt klebt, braucht künftig ausdrücklich `--lfh-kopf-oben`.
