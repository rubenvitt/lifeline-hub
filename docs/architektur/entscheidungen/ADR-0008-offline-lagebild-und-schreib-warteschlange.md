---
id: ADR-0008
titel: Ohne Netz liest der Client ein gefiltertes Lagebild und merkt Erfassungen in einer Warteschlange vor
status: akzeptiert
datum: 2026-09-30
gilt_fuer:
  - frontend/src/offline/**
  - frontend/src/api/queryKeys.ts
  - frontend/src/api/queryClient.ts
  - frontend/vite.config.ts
herleitung:
  - openspec/changes/archive/2026-09-30-lfh-723-lagebild-offline-lesen/design.md
  - openspec/changes/archive/2026-10-01-lfh-705-serveruhr-versatz-offline/design.md
  - openspec/changes/archive/2026-10-06-lfh-939-941-offline-speicher-begrenzen/design.md
---

# ADR-0008: Ohne Netz liest der Client ein gefiltertes Lagebild und merkt Erfassungen in einer Warteschlange vor

## Regeln

- MUST: Was ohne Netz lesbar bleibt, bestimmt die Registry `LAGEBILD_OFFLINE` in
  `frontend/src/api/queryKeys.ts`; gespeichert wird in der IndexedDB `lifeline-lagebild`
  (`frontend/src/offline/lagebildSpeicher.ts`), ein Datensatz je Gerät.
- MUST NOT: kein Zwischenspeichern von `/api/`-Antworten über Workbox (`runtimeCaching` in
  `frontend/vite.config.ts`).
- MUST: Erfassungen ohne Netz laufen über die `erfasse…OfflineFaehig`- und
  `save…OfflineCapable`-Funktionen in `frontend/src/offline/schreiben.ts` in die Warteschlange
  (`frontend/src/offline/queue.ts`) und tragen eine `client_id`, über die der Server ein
  Replay erkennt. Ausgenommen ist ein Lesestand, den der Server von sich aus idempotent setzt
  („Alle gelesen“, `frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“).
- MUST NOT: keine Änderung bestehender Daten (PATCH) vormerken; solche Wege sind ohne Netz
  gesperrt. Die Einzelregeln stehen in `frontend/src/offline/AGENTS.md` und werden hier nicht
  wiederholt.
- MUST: Ein neuer Query-Prefix wird in `LAGEBILD_OFFLINE` aufgenommen oder ausdrücklich
  draußen gelassen (`frontend/src/api/lagebildOffline.guard.test.ts`).

## Prüfung

```sh
verlange '^export const LAGEBILD_OFFLINE = ' frontend/src/api/queryKeys.ts
verlange "^export const LAGEBILD_DB = 'lifeline-lagebild'" frontend/src/offline/lagebildSpeicher.ts
verbiete 'urlPattern:.*/api' frontend/vite.config.ts
verlange 'export (async )?function erfasse[A-Za-z]*OfflineFaehig' frontend/src/offline/schreiben.ts
test -f frontend/src/api/lagebildOffline.guard.test.ts
test -f frontend/src/offline/clientId.guard.test.ts
```

## Kontext

Im ELW fällt das Netz aus, gerade dann muss das Lagebild lesbar und die Erfassung möglich
bleiben. Ein Cache auf URL-Ebene hätte jede Antwort samt Personendaten unkontrolliert auf die
Platte gelegt und wäre nicht nach Datenart zu kürzen gewesen. Der Review vom 11.07.2026 fand
eine Warteschlange, die Einträge verlor und Duplikate erzeugte (F03); daraus entstanden
`client_id` und das Replay.

## Konsequenzen

Was offline lesbar ist, ist eine geprüfte Liste je Datenart, gekürzt um Freitexte, statt eines
zufälligen Cache-Stands. Jede neue Datenart und jede neue offline-fähige Erfassung braucht eine
bewusste Einordnung. Vorgemerktes kennt der Server erst nach dem Abgleich; Ablehnungen landen im
Wiederherstellungsbereich.
