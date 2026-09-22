# Design

## Context

Ist-Stand (gemessen 22.09.2026, siehe proposal.md „Why"):

| Ticket-Punkt | Stand |
|---|---|
| Verknüpfung beim Anlegen setzen | fertig: `auftrag.quell_etb_eintrag_id` (Migration 0059), gesetzt in `auftrag::repo::erteile_aus_etb_tx`, Route `POST …/etb/{eid}/auftrag` (LFH-112). Mehrere Aufträge je Eintrag sind erlaubt und getestet. |
| Zähler im Überblick | vorhanden, aber clientseitig aus `listeAuftraege` (`folgeauftraegeJeEintrag`) — fällt bei gesperrtem Modul `auftraege` weg |
| Wire-Feld am ETB-Eintrag | fehlt |
| Hinweiszeile in der Zeitachse | fehlt; `EtbBacklinkBadges` zeigt nur die Gegenrichtung (`auftrag_id`) |

`EtbEintragAnzeige` wird per `sqlx::FromRow` aus einem festen SELECT gebaut (`etb::repo::laden`
und `etb::repo::abfrage`, letztere seitenweise, Standard 100, max. 500). Das SSE-Ereignis
`etb` trägt nur IDs, der Client lädt nach — das Feld kommt also automatisch mit.

## Goals / Non-Goals

**Goals:**
- Eine Quelle für die Folgeaufträge eines Eintrags: das Wire-Feld. Der Überblick und die
  Zeitachse lesen beide von dort.
- Konstante Anzahl Abfragen je ETB-Seite (kein N+1).

**Non-Goals:**
- Kein Sammelverweis und kein neuer Filter auf der Auftragsseite (Entscheidung
  Einzelverweise, proposal.md).
- Keine Entscheidungsübersicht, kein Befehl-aus-ETB.
- Keine Modul-Filterung der Verweise: wer das Modul `auftraege` gesperrt hat, sieht die
  Verweise trotzdem und landet beim Folgen auf der Sperrseite — genau wie beim bestehenden
  Rückverweis `auftrag_id`. Die Existenz eines Auftrags (id + Nummer) ist keine
  Inhaltsangabe; eine abweichende Regel nur für diese Richtung wäre eine zweite Wahrheit.

## Decisions

**D1 — Wire-Form `folgeauftraege: Vec<FolgeauftragVerweis { id, lfd_nr: Option<i64> }>`**
statt `folgeauftrag_anzahl: i64`. Die Einzelverweise brauchen `id` für den Deeplink und
`lfd_nr` für einen unterscheidbaren Namen (CLAUDE.md: n gleichnamige Links sind der
Fehlerfall; die DB-`id` wird nie angezeigt). Die Zahl ist `len()`. Das Feld ist kein
`Option`: immer serialisiert, leer als `[]`; utoipa führt es damit als required, die
generierte TS-Form ist `folgeauftraege: components['schemas']['FolgeauftragVerweis'][]`.
`lfd_nr` am Verweis ist `Option` mit `skip_serializing_if` (Norm LFH-265), weil
`auftrag.lfd_nr` für Altbestände nullable ist.

**D2 — Zweite, gebündelte Abfrage statt Subquery im SELECT.** Das Feld bekommt
`#[sqlx(skip)]` (Default leer), und `laden`/`abfrage` hängen danach eine Abfrage
`SELECT quell_etb_eintrag_id, id, lfd_nr FROM auftrag WHERE quell_etb_eintrag_id IN (…)
ORDER BY lfd_nr, id` über die IDs der Seite an und verteilen das Ergebnis. Alternative
`json_group_array` als korrelierte Subquery: eine Abfrage weniger, aber `sqlx(json)` plus
Null-Behandlung (`json_group_array` über null Zeilen) und eine Subquery je Zeile — die
zweite Abfrage ist einfacher zu lesen und zu testen. Die IN-Liste ist durch `MAX_LIMIT`
(500) begrenzt, weit unter SQLites Parametergrenze. Die Zuordnung läuft über
`einsatz_id`-freie IDs — sicher, weil die Seite bereits einsatzgefiltert ist und
`quell_etb_eintrag_id` vom Erteilen-Handler gegen denselben Einsatz geprüft wird.

**D3 — Index `auftrag(quell_etb_eintrag_id)`** als neue Migration (0105, partiell
`WHERE quell_etb_eintrag_id IS NOT NULL`). Ohne ihn ist die IN-Abfrage ein Scan über alle
Aufträge der Instanz je ETB-Seite. Vor dem Merge die Nummer gegen `origin/alpha` prüfen
(parallele Branches vergeben dieselbe Nummer).

**D4 — Verweise in `EtbBacklinkBadges`**, nicht in einer neuen Komponente: dort stehen
`verweisStil`, das freigegebene ↗ (CLAUDE.md nennt die Datei namentlich) und die
Hinweiszeilen-Einhängung in `EtbZeitachse`. Beschriftung „Folgeauftrag Nr. 12" gegen das
bestehende „Auftrag" (Gegenrichtung) — sonst stünden an einer Entscheidung, die selbst aus
einem Auftrag entstand, zwei gleichlautende Links in entgegengesetzte Richtungen. Der
Dateikopf-Kommentar wird um die Vorwärtsrichtung ergänzt.

**D5 — Überblick liest `e.folgeauftraege.length`.** `folgeauftraegeJeEintrag` und die
Fußnote „Aufträge nicht abrufbar — Folgeaufträge werden nicht gezählt" fallen weg;
`folgeText` bleibt. Der übrige `auftraegeFehlen`-Pfad (Paneel offene Aufträge) bleibt
unverändert. Das Zählwort bleibt ohne Link (bei n > 1 hätte es kein eindeutiges Ziel).

## Risks / Trade-offs

- [Lange Hinweiszeile bei vielen Folgeaufträgen] → Die Zeile bricht bereits um
  (`flexWrap: 'wrap'`); realistisch sind 1–3 je Entscheidung. Kein Deckel mit „+n", weil
  der Überblick die Zahl ohnehin trägt.
- [Migrationsnummer kollidiert beim Merge] → Nummer vor dem Merge gegen `origin/alpha`
  prüfen, ggf. umbenennen (noch nicht angewandt, also kein Checksum-Problem).
- [Test-Fixtures von `EtbEintragAnzeige` brechen den Typcheck] → gewollt: das Pflichtfeld
  zwingt jede Fixture zu `folgeauftraege: []`; betroffen sind wenige Dateien.

## Migration Plan

Additiv: neues Feld, neuer Index. Kein Datenumbau, Bestandsaufträge mit
`quell_etb_eintrag_id` erscheinen sofort. Rückbau = Revert.
