# Design

## Context

Der Anlass steht in `proposal.md`, die Anforderungen in
`specs/lagekarte-fachebenen/spec.md`. Hier steht nur der Stand, der den Weg bestimmt.

- **Neun Quellen, drei Lieferwege.** `liefere_mit_swr` trägt NINA, DWD, PEGELONLINE,
  Hochwasser, ODL und Luftqualität. Autobahn liest `cache::eintrag` selbst (`fetch_autobahn`),
  Energie setzt zwei Cache-Teile zusammen (`liefere_geloest`, `baue_energie_antwort`). KRITIS
  liest einen eigenen Bestand (`kritis::bestand::abfrage`) mit `ImportMeta.importiert_at`
  (Unix-Sekunden, von `bestaetige_unveraendert` auch ohne neuen Extrakt fortgeschrieben).
- **`stand` ist schon belegt.** Das Ticket nahm an, keine Quelle fülle `stand`. Inzwischen
  füllen es KRITIS (Extrakt-Datum, per Spec festgelegt), Energie (MaStR-Abzug) und
  Luftqualität (jüngster Messzeitpunkt). Diese Aussage bleibt richtig und nützlich. Sie ist
  aber eine andere als „wie alt ist unser Abruf“.
- **Der Cache kennt das Alter.** `fachebenen_cache.gespeichert_at` wird beim Upsert gesetzt,
  unmittelbar nach dem Abruf. `cache::eintrag` liefert das Alter schon. Der Deckel liegt bei
  48 h (`MAX_ALTER_SEKUNDEN`), älteres räumt das Prune weg.
- **Der Client hält Daten über Fehler hinweg.** `useFachebenen` meldet eine Ebene bei
  `isError` als `offline`, zeichnet aber weiter `q.data.features`. Genau dann sieht der
  Bediener heute ebenfalls einen Stand unbekannten Alters.
- **Bausteine im Bestand:** `taktischeDtg`/`taktischeDtgVoll`/`formatZeitKurz`
  (`anzeige/format.ts`), `useMinutenTakt` (`components/Kopfleiste.tsx`, tickt zur vollen
  Minute), `rollen.achtungText` (Tagmodus-tauglicher Achtung-Text, LFH-618), das Zeichen ⧖
  als erlaubtes `aria-hidden`-Textzeichen (CLAUDE.md, „Ein Emoji ist keine Ikone“).

## Goals / Non-Goals

**Goals:**

- Ein Abrufzeitpunkt je Antwort, gleich gebildet für alle Quellen, ohne Migration.
- Die Veraltung entscheidet eine reine Funktion mit Schwellen aus einer Tabelle, damit sie
  sich an der Grenze testen lässt.
- Die Anzeige altert ohne neuen Abruf mit.

**Non-Goals:**

- Kein neuer `FachebeneStatus` und keine Änderung an Poll-Takt, Attribution oder Ausgrauen.
- Keine Markierung auf der Karte selbst (Einfärben, Ausgrauen veralteter Punkte). Das Panel
  erfüllt „ohne Klick in ein Detailpanel“. Eine Kartenmarke wäre eine eigene Entscheidung.
- Keine Zeitangabe je Feature aus der Quelle. Wo die Quelle eine liefert (DWD-Gültigkeit,
  ODL-Messende, Pegel-Messzeit), zeigt der Inspector sie schon.
- Kein Umbau von `Datenstand`. Diese Komponente spricht über `dataUpdatedAt` des Clients, hier
  geht es um den Abruf durch den Server.

## Decisions

### D1 — Eigenes Feld `abgerufen` statt `stand`

`FachebeneAntwort` bekommt `abgerufen: Option<String>` (RFC 3339, UTC, Sekunden),
`#[serde(default, skip_serializing_if = "Option::is_none")]` nach LFH-265. `stand` bleibt
unverändert.

*Alternative:* `stand` mit dem Abrufzeitpunkt füllen, wie im Ticket vorgeschlagen. Verworfen:
das bräche die KRITIS-Anforderung („`stand` MUST den Datenstand des Extrakts nennen“) und
nähme Energie und Luftqualität ihren Quellstand. Zwei Aussagen in einem Feld wären für den
Bediener nicht unterscheidbar.

### D2 — `abgerufen` wird beim Abruf gesetzt und reist im Cache mit

- `FachebeneAntwort::ok(…)` setzt `abgerufen = jetzt`. Jeder `erneuere_*` baut über `ok`,
  der Wert landet damit im `antwort_json` des Caches. Frischer und veralteter Weg liefern ihn
  unverändert aus, ohne Änderung an `liefere_mit_swr`.
- `offline(…)` lässt das Feld weg.
- **Rückfall für Bestandseinträge:** Einträge, die vor dem Deploy geschrieben wurden, tragen
  das Feld nicht. `cache::eintrag`, `frisch` und `stale` füllen ein fehlendes `abgerufen` aus
  `gespeichert_at` (SQL liefert den Zeitpunkt mit). Nach höchstens 48 h ist das Thema durch
  das Prune erledigt, der Rückfall bleibt aber als Netz.
- **KRITIS:** `abfrage` setzt `abgerufen` aus `meta.importiert_at`.
- **Energie:** `baue_energie_antwort` nimmt das kleinere `abgerufen` der Teile, die nicht
  `offline` sind. Das ist konservativ: ein Teil ohne Beitrag im Ausschnitt zählt trotzdem.
  Die Energie-Antwort baut über `ok` und bekäme sonst „jetzt“.

*Alternative:* `abgerufen` bei jeder Auslieferung aus `jetzt − alter` rechnen
(in `liefere_mit_swr`). Verworfen: drei Lieferwege müssten es einzeln tun (Autobahn und
Energie gehen an `liefere_mit_swr` vorbei), und der Wert wäre an zwei Stellen gebildet.

### D3 — Schwelle je Ebene in der Frontend-Registry

`FachebeneDef` bekommt `veraltetNachMin: number`. Die Tabelle leitet sich aus dem Takt der
Quelle ab: veraltet ist ein Stand, wenn mehrere reguläre Erneuerungen ausgefallen sind **und**
der Inhalt dem Bediener in dieser Zeit etwas Neues hätte sagen können.

| Ebene | Server-TTL | Takt der Quelle | Schwelle | Begründung |
|---|---|---|---|---|
| NINA | 90 s | Warnungen, ereignisgetrieben | **15 min** | Eine neue Warnung muss schnell sichtbar sein; ~10 ausgefallene Erneuerungen |
| DWD | 300 s | Warnungen, ereignisgetrieben | **30 min** | Wie NINA, gröberer Takt |
| PEGELONLINE | 300 s | Messwerte ~15 min | **60 min** | Vier Messwerte verpasst |
| Hochwasser | 300 s | Meldeklassen, ~15 min | **60 min** | Anlass des Tickets; amtliche Aussage |
| Autobahn | 600 s | Baustellen/Sperrungen | **60 min** | Sechs Läufe verpasst |
| ODL | 600 s | Stundenwerte | **3 h** | Zwei Stundenwerte verpasst, plus Verzug der Quelle |
| Luftqualität | 900 s | Stundenwerte, ~2 h Verzug | **4 h** | Verzug der Quelle zählt nicht als Veraltung |
| Energie | 24 h | Bestandsdaten | **36 h** | 1,5 × TTL; liegt unter dem Cache-Deckel von 48 h |
| KRITIS | Import 168 h | Extrakt wöchentlich | **14 d** | Zwei Importläufe verpasst (Vorgabe-Intervall) |

Eine Schwelle von mindestens 15 min liegt über jeder Zeitdifferenz zwischen Server- und
Browseruhr, die im Betrieb zu erwarten ist.

*Alternative A:* Der Server schickt `veraltet: bool` oder eine Schwelle mit. Verworfen: das
Alter wächst, während die Karte offen steht und der Client nichts abruft (etwa nach einem
Serverausfall). Der Client muss ohnehin selbst rechnen. Eine Schwelle auf dem Draht wäre
zusätzlicher Vertrag, obwohl die Registry schon je Ebene `pollMs` trägt.

*Alternative B:* Eine Formel (z. B. 3 × TTL). Verworfen: NINA käme auf 4,5 min und flackerte
bei jeder Quellstörung; Luftqualität träfe ihren eigenen Verzug. Eine Tabelle lässt sich je
Zeile begründen.

**Offene Stelle KRITIS:** Das Import-Intervall ist konfigurierbar
(`--kritis-extrakt-intervall-stunden`), die Schwelle nicht. Wer das Intervall über 14 Tage
hebt, sieht KRITIS schon vor dem nächsten Lauf als veraltet. Das steht in
`docs/fachebenen-quellen.md`.

### D4 — Einstufung als reine Funktion, Takt aus `useMinutenTakt`

`fachebeneAlter(key, abgerufen, jetztMs)` in `pages/lagekarte/fachebenen.ts` liefert
`{ abgerufen, veraltet }` oder `null` (kein oder unlesbarer Zeitpunkt). Die Grenze gilt als
„> Schwelle“ (genau auf der Schwelle: nicht veraltet). Ein Zeitpunkt in der Zukunft
(Uhrenversatz) zählt als Alter 0. `useMinutenTakt` wandert dafür aus `Kopfleiste.tsx` in eine
eigene Datei (`components/useMinutenTakt.ts`), damit die Lagekarte keinen Kopfleisten-Import
braucht. `Kopfleiste` importiert von dort.

`useFachebenen` liefert zusätzlich `fachebenenAbgerufen: Partial<Record<Quelle, string>>`
aus `q.data?.abgerufen`, **unabhängig von `isError`**. Damit bleibt die Zeitangabe stehen,
solange die Karte die gehaltenen Daten zeichnet (Spec: „Eigener Server nicht erreichbar“).

### D5 — Anzeige: eigene Zeile unter dem Namen, kein neuer Statusvertrag

- In `Sidebar.tsx` steht unter Label und `geltung` eine Mono-Zeile (`schriftskala.meta`,
  `tabular-nums`): „Stand 1430“ bzw. an einem Vortag „Stand 291430“ (`formatZeitKurz`). Die
  Statusmarke rechts („offline“, „keine Daten“, Spinner, Zoom-Hinweis) bleibt, wo sie ist.
- Veraltet: davor „⧖ veraltet ·“ in `rollen.achtungText`, ⧖ in einer `aria-hidden`-Hülle. Das
  Wort ist der zweite Kanal. Die ganze Zeile ist Text im DOM, ein Vorleser liest
  „veraltet · Stand 291430“.
- Kein `Tooltip`: auf dem Tablet gibt es kein Hovern (gleiche Begründung wie bei `geltung`).
- **Keine neue Karte in `theme/statusFarben.ts`.** Die Marke ist ein Zweiwert (veraltet ja/nein),
  kein Enum mit Darstellung je Wert. Sie nimmt die Rolle direkt aus `useRollen`, wie andere
  Einzelhinweise.
- Inspector: neue Prop `abgerufen?: string` an `FachebenenInspector`, eine Zeile
  „Ebene abgerufen“ mit `taktischeDtgVoll` und gegebenenfalls „veraltet“, unter dem
  quellenspezifischen Inhalt. `LagekartePage` reicht den Wert aus `useFachebenen` durch.

## Risks / Trade-offs

- [Uhrenversatz Server ↔ Browser] → Schwellen ab 15 min, Zukunftswerte auf 0 geklemmt.
- [Energie-Sammlung zeigt Punkte älterer Antworten] → `abgerufen` gilt für die letzte
  Antwort des aktuellen Ausschnitts. Bei 24-h-Bestandsdaten ist das hinnehmbar; im Design
  festgehalten, nicht gebaut.
- [Aufwärmphase Autobahn meldet `offline`] → unverändert (bewusste Entscheidung, siehe
  `docs/fachebenen-quellen.md`); ohne Stand gibt es keine Zeitangabe.
- [Panelzeile wird höher] → eine Meta-Zeile mit 11 px, nur bei zugeschalteter Ebene mit Stand.
  Gate 1 (`e2e/gate1-ueberlauf.spec.ts`) und `lagekarte-leiste-dichte.spec.ts` laufen mit.
- [Rückfall über `gespeichert_at` und Wert aus `ok()` weichen ab] → beide entstehen im selben
  Lauf, Abstand Millisekunden. Der Rückfall greift nur, wenn das Feld fehlt.

## Migration Plan

Keine Datenbank-Migration. Das Feld ist additiv, alte Cache-Einträge bekommen es über den
Rückfall. Rückbau: Feld und Anzeige entfernen. Der Cache verträgt das dann überzählige Feld,
weil `FachebeneAntwort` kein `deny_unknown_fields` trägt.
