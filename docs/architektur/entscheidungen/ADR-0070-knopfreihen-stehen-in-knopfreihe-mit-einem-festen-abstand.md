---
id: ADR-0070
titel: Knopfreihen stehen in Knopfreihe mit einem festen Abstand, nicht in Space
status: akzeptiert
datum: 2026-11-19
gilt_fuer:
  - frontend/src/components/instrument/Knopfreihe.tsx
  - frontend/src/components/knopfreihe.guard.test.ts
  - frontend/src/components/knopfreihe.schuld.ts
  - frontend/src/**/*.tsx
herleitung:
  - docs/superpowers/specs/2026-11-19-jysfxw29-knopfreihe-design.md
  - Zunder LLH-1973 (Abstand, Umfang und Wächter abgestimmt mit Ruben am 19.11.2026)
---

# ADR-0070: Knopfreihen stehen in Knopfreihe mit einem festen Abstand, nicht in Space

## Regeln

- MUST: Eine neue oder umgestellte Reihe aus zwei oder mehr Knöpfen steht in `Knopfreihe`,
  Dialogfüße mit `fuss`; der Bestand aus `<Space>` steht in der Schuldliste. Regel:
  `frontend/AGENTS.md`, „Aktionen“, „Knopfreihen über `Knopfreihe`“.
- MUST: `Knopfreihe` setzt als Abstand die Rasterstufe `md` der aktiven Dichte.
- MUST NOT: `Knopfreihe` nimmt ein `style`-Prop oder einen Abstand an.
- MUST NOT: `Knopfreihe` ordnet ihre Kinder um.
- MUST NOT: Die Schuld in `frontend/src/components/knopfreihe.schuld.ts` wächst oder bekommt einen
  neuen Eintrag.
- SHOULD: Wer eine Datei mit Knopfreihen-Schuld anfasst, stellt ihre Reihen auf `Knopfreihe` um.

## Prüfung

```sh
verlange "rasterAbstand\(token, 'md'\)" frontend/src/components/instrument/Knopfreihe.tsx
verbiete '^  (style|abstand)\??:' frontend/src/components/instrument/Knopfreihe.tsx
verbiete '\border:' frontend/src/components/instrument/Knopfreihe.tsx
test -f frontend/src/components/knopfreihe.guard.test.ts
test -f frontend/src/components/knopfreihe.schuld.ts
```

## Kontext

Knöpfe nebeneinander waren ein `<Space>`, ihr Abstand hing daran, ob die Stelle an `size`
dachte: 27 Reihen standen 4 / 4 / 8 px auseinander. Zwei Wächter hielten den Abstand für einen
Ausschnitt fest, `aktionen` im Kopf und bewertete Reihen mit rotem Knopf. ADR-0065 ließ
Knopfreihen ausdrücklich offen.

## Konsequenzen

Ein Abstand für jede Reihe: Rot steht nie bündig, die Kopfknöpfe rücken in kompakt von 8 auf
12 px. Kopf, Dialogfüße und die bewerteten Rot-Reihen sind umgestellt, die beiden Wächter
entfernt. Die übrigen Reihen hält die Schuldliste fest; ist sie leer, gehen Wächter und Liste.
