# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: zuerst der rote Test, dann der
Code, dazu eine Mutationsprobe (Kernzeile zurückdrehen → Test rot). Pfade relativ zu
`frontend/src/`.

## 1. Lagebild-Persister (D1–D3)

- [x] 1.1 `offline/lagebildPersister.ts`: Single-Flight. Prüfen: Test mit einem Schreibweg,
  der langsamer ist als die Drossel — höchstens ein laufender und ein wartender Stand, am Ende
  ist der jüngste geschrieben; `abbrechen()` wartet den laufenden ab und verwirft den wartenden.
- [x] 1.2 `offline/lagebildSitzung.ts`: eigenes Abo nur auf den Query-Cache, Drossel vor dem
  Dehydrieren, erste Speicherung beim Abonnieren. Prüfen: viele Cache-Ereignisse in einem
  Drosselfenster → genau ein Dehydrieren; ein Mutations-Ereignis löst keins aus; bestehende
  Sitzungstests grün.
- [x] 1.3 `offline/lagebildSpeicher.ts`: v2 mit `kopf` und `client`, Upgrade verwirft
  `aktuell`. Prüfen: `lagebildBestaetigen` lässt den `client`-Satz unverändert (rohe IDB);
  Mehrtab: nach einem Löschen schreibt weder Bestätigung noch Stand etwas zurück; ein
  v1-Datensatz ist nach dem Upgrade weg.
- [x] 1.4 Vorrat kürzen (D3). Prüfen: nach einer Speicherung mit live überdecktem Eintrag
  enthält der Vorrat ihn nicht mehr; ein nicht überdeckter, zulässiger bleibt.

## 2. ETB-Allowlist (D4)

- [x] 2.1 `api/queryKeys.ts`: feste ETB-Ansicht als Positivliste (`typ`, `limit`), in
  `istLagebildOfflineKey`; Kommentar an `LAGEBILD_OFFLINE` richtigstellen. Prüfen:
  `lagebildOffline.guard.test.ts` umgedreht — `etbListe(7, { q: 'x' })` ist `false`,
  `etbListe(7, {})`, `etbListe(7, { typ: 'meldung' })`, Zähler `{}` und Lesemarke sind `true`.
- [x] 2.2 `api/queryClient.ts`: freie ETB-Keys ohne eigenes `gcTime` bekommen 5 min. Prüfen:
  Produktionsclient — freie Variante 5 min, feste 24 h, Palette behält 30 s.

## 3. Queue-Zähler (D5)

- [x] 3.1 `offline/queue.ts`: `queueNichtZugeordnetZaehlen` per `count()`. Prüfen: zählt
  Altzeilen korrekt über alle vier Stores; `getAll` wird nicht gerufen (Spion).
- [x] 3.2 `offline/useOfflineQueueZaehler.ts`: Single-Flight mit Drosselfenster. Prüfen: 50
  Ereignisse in schneller Folge → höchstens zwei Ladevorgänge, der letzte Stand wird angezeigt.

## 4. Erfassungsquittung (D6)

- [x] 4.1 `offline/queue.ts`: v6, Quittung mit `person_id`/`registrier_nr`, Upgrade schreibt
  v5-Quittungen um. Prüfen: gespeicherte Quittung ohne Name und Sichtung (rohe IDB); eine
  v5-Quittung ist nach dem Öffnen umgeschrieben.
- [x] 4.2 `pages/PersonenPage.tsx`: Personen aus dem Cache, Fallback nur Hervorhebung.
  Prüfen: Sammelquittung zeigt weiter „Erfasst als …“; ohne Person im Cache bleibt die Sicht.
- [x] 4.3 `offline/geraetRaeumung.ts`: Grund der Quittung im Verzeichnis nachführen.

## 5. Ortscache (D7)

- [x] 5.1 `anzeige/ortCache.ts`: v2 mit `{ name, at }`, Frist 30 Tage, Obergrenze 5 000.
  Prüfen: abgelaufener Eintrag nach dem Öffnen weg; bei 5 010 Einträgen bleiben die 5 000
  jüngsten; `holeOrt` liefert den Namen.

## 6. ETB-Entwürfe (D8)

- [x] 6.1 `etb/entwuerfe/entwurfStore.ts`: leere eigene Entwürfe älter als 24 h und verwaiste
  Aktiv-Merker beim Laden räumen. Prüfen: leerer Altentwurf in Einsatz 3 samt Merker weg beim
  Laden von Einsatz 7; Entwurf mit Text bleibt; frischer leerer bleibt; offener Vorlauf geht
  nicht verloren.

## 7. Regeln und Abschluss

- [x] 7.1 `frontend/src/offline/AGENTS.md`: Persister-Drossel und Kopf, ETB-Allowlist,
  Quittung nur mit Kennungen, Ortscache-Frist. `frontend/src/etb/AGENTS.md`: Räumen leerer
  Entwürfe.
- [ ] 7.2 Vitest der berührten Bereiche (TZ=Europe/Berlin), `./scripts/check-all.sh` (in der
  Cloud-Sitzung: Bündel ohne die umgebungsbedingt roten Schritte, siehe Projektnotiz), e2e
  `lagebild-offline.spec.ts`.
- [ ] 7.3 `requesting-code-review`, dann `/opsx:archive` im selben Branch.
