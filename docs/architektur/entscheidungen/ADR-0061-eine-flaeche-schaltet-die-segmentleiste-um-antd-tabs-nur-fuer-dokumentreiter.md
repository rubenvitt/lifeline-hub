---
id: ADR-0061
titel: Eine Fläche schaltet die Segmentleiste um, antd-Tabs nur für Dokumentreiter
status: akzeptiert
datum: 2026-11-16
gilt_fuer:
  - frontend/src/**/*.tsx
herleitung:
  - openspec/changes/archive/2026-11-16-gyidpati-wann-was-umschalten-bearbeiten/design.md
  - Zunder LLH-1808 (Reiterform „nur Segmentleiste“ und Prüfung im Gate abgestimmt mit Ruben am 16.11.2026)
---

# ADR-0061: Eine Fläche schaltet die Segmentleiste um, antd-Tabs nur für Dokumentreiter

## Regeln

- MUST: Eine Wahl, die die Fläche darunter umschaltet, ist eine `Segmentleiste rolle="tablist"`
  mit Reiterfläche; Tabelle: `frontend/AGENTS.md`, „Bausteinwahl“, Gruppe „Umschalten“.
- MUST NOT: antd `Tabs` außerhalb der Dokumentreiter des ETB (`frontend/src/etb/entwuerfe/`).
- MUST NOT: `Radio.Group optionType="button"`; eine kurze Wahl im Formular ist ein `SegmentFeld`.
- SHOULD: Über einer Liste steht höchstens eine Segmentleiste; weitere Einschränkungen sind Filter.
- MUST: Führt ein Reiter auf eine andere Seite, wählt die Leiste mit Enter, nicht mit der
  Pfeiltaste (`aktivierung="manuell"`).

## Prüfung

```sh
verbiete '<Tabs\b' 'frontend/src/**/*.tsx' ':(exclude,glob)frontend/src/etb/entwuerfe/**' ':(exclude,glob)frontend/src/**/*.test.tsx'
verbiete '^[[:space:]]*optionType="button"|<Radio\.Group [^>]*optionType="button"' 'frontend/src/**/*.tsx'
```

## Kontext

Für das Umschalten einer Fläche standen antd-`Tabs` (5 Stellen) und die Segmentleiste als Reiter
(11 Stellen) nebeneinander, dazu Knopfgruppen aus `Radio.Group` für dieselbe Aufgabe wie die
Segmentleiste. Löst LLH-1180 D5 ab, nach der das Fernmeldewesen bewusst `Tabs` nahm.

## Konsequenzen

Reiter sehen überall gleich aus und folgen der Dichte-Staffel der Segmentleiste. Eine neue
Reiterfläche baut das Muster aus Leiste und `role="tabpanel"` nach; die Dokumentreiter des ETB
bleiben, weil sie Reiter anlegen und schließen.
