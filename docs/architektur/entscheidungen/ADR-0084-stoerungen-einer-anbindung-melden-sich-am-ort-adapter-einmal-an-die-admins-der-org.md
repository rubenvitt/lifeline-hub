---
id: ADR-0084
titel: Störungen einer Anbindung melden sich am Ort Adapter einmal an die Admins der Org
status: vorgeschlagen
datum: 2026-11-22
gilt_fuer:
  - src/benachrichtigung/**
  - src/adapter/lauf.rs
  - src/adapter/zustand.rs
  - src/routes/adapter.rs
herleitung:
  - docs/superpowers/specs/2026-11-22-k5fdiw6n-adapter-stoerung-melden-design.md
  - https://zunder.rubeen.dev/#/aufgabe/k5fdiw6n15wrlvkgqdn0dlpw
---

# ADR-0084: Störungen einer Anbindung melden sich am Ort Adapter einmal an die Admins der Org

## Regeln

- MUST: Eine Benachrichtigung hängt an genau einem Ort, einem Einsatz oder einem Adapter
  (`benachrichtigung::Ort`, CHECK der Tabelle). Ein weiterer Anlass ohne Einsatz bekommt seinen
  eigenen Ort, er nutzt `adapter_id` nicht mit.
- MUST: Ein Anlass am Adapter erreicht nur aktive System-Admins der Org des Adapters; Empfänger,
  Leserecht und Text stehen nur in `src/benachrichtigung/adapter.rs`. Er reist nie zum Hub.
- MUST: Eine Störung meldet sich einmal: der Lauf setzt den Merker `adapter.gemeldet` in
  seiner Transaktion und meldet nur, wenn er ihn gesetzt hat. „Gestört“ erst ab
  `MELDESCHWELLE_GESTOERT_S` (30 Minuten seit `fehler_seit`), `geheimnisspeicher_gesperrt` nie.
- MUST: Ein Erfolg nach einer Meldung erledigt sie und entwarnt; ein Eingriff eines Admins
  erledigt sie ohne Entwarnung (`benachrichtigung::erledigen_adapter`).
- MUST NOT: Die Detailzeile liest Einstellungen oder Geheimnisse des Adapters; nur
  `DETAIL_ADAPTER_SPALTEN`.
- Regeln zu Melden und Zustellen allgemein: `src/AGENTS.md`, „Benachrichtigungen“.

## Prüfung

```sh
verlange 'Adapter \{ org_id: i64, adapter_id: String \}' 'src/benachrichtigung/mod.rs'
verlange 'MELDESCHWELLE_GESTOERT_S: i64 = 30 \* 60' 'src/adapter/zustand.rs'
verlange 'CHECK \(\(einsatz_id IS NULL\) <> \(adapter_id IS NULL\)\)' 'migrations/*.sql'
verbiete '"adapter", "einstellungen"' 'src/benachrichtigung/adapter.rs'
```

## Kontext

Ein Adapter ruft ein Fremdsystem im Hintergrund ab, etwa eine Alarmierungsquelle. Hält er an
oder ist er lange gestört, sah das nur, wer die Seite „Anbindungen“ öffnete. Benachrichtigungen
hingen bis dahin an einem Einsatz (`einsatz_id NOT NULL`); ein Adapter gehört zur Org. Erwogen
waren ein eigener schmaler Weg am Melden vorbei und eine reine Anzeige.

## Konsequenzen

Toast, Eingang, Web Push, Abschalten je Art und Nachreichen gelten auch ohne Einsatz, ohne
zweiten Zustellweg. Dafür ist `einsatz_id` auf dem Wire `number | null`, und jeder Leser einer
Benachrichtigung muss den Ort beachten. Die Tabelle wurde neu gebaut (Migration 0363).
