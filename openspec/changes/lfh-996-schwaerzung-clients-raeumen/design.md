# Design

## Context

Motivation in `proposal.md`. Der Ist-Stand, auf dem der Entwurf aufsetzt:

- **Purge-Lauf** (`src/einsatz/purge_scheduler.rs`): Phase A merkt fällige Einsätze vor und
  meldet nur `einsatzliste`. Phase A2 (`aufbewahrung::antrag::vollziehe_faellige`) vollzieht
  Anträge: ein Einsatz-Antrag meldet `einsatzliste`, ein Personen-Antrag nichts. Phase K2
  (Kategorie-Schwärzung) verteilt `person`, `dokument`, `schaden`, `chat`, `etb`. Phase B
  schwärzt einen seit 30 Tagen gesperrten Einsatz und meldet nichts.
- **Live-Strom** (`src/routes/live.rs`): Die Tür wird beim Verbinden geprüft. Ein offener Strom
  bekommt die Ereignisse eines Einsatzes auch dann weiter, wenn der Einsatz inzwischen gesperrt
  ist. Das Ereignis `einsatz` ist ungegatet und trägt nur die Einsatzkennung (LFH-555).
- **Client** (`frontend/src/live/useEinsatzLiveStream.ts`): Ein Ereignis invalidiert die Keys aus
  `EINSATZ_STREAM_EVENTS`. `invalidateQueries` ruft nur beobachtete Queries neu ab. Unbeobachtete
  behalten ihre alten Daten bis zum `gcTime` und landen so weiter auf der Platte. Die
  Detail-Keys `person`, `tier`, `schaden` sind gar nicht live.
- **Offline-Lagebild** (`frontend/src/offline/lagebildSitzung.ts`, `lagebildFilter.ts`): Jede
  Speicherung führt den Live-Stand mit dem **Vorrat** zusammen, dem bei Sitzungsbeginn gelesenen
  Stand der Platte. Vorrat-Einträge leben bis zur Höchstliegezeit von 24 h weiter, auch wenn der
  Server sie längst anders liefert. Gefiltert wird über Allowlist, Sperrmarke (`lagebildSperren`)
  und Liegezeit.
- **Rechteentzug** (`frontend/src/api/queryClient.ts`, `raeumeNachRechteentzug`): 403/404 auf den
  Einsatzkopf setzt die Sperrmarke des Einsatzes, leert beobachtete Queries und entfernt
  unbeobachtete. Das greift nur, wenn jemand den Kopf abruft.
- **Einsatzliste** (`einsatz::repo::liste_fuer`): alle Einsätze, die die Person lesen darf, ohne
  Seitenteilung. Ein gesperrter Einsatz fehlt darin.

## Goals / Non-Goals

**Goals:**
- Ein Gerät erkennt eine Schwärzung an einer Antwort, die es ohnehin abruft (Kopf oder Liste),
  nicht an einem Ereignis, das es nur erhält, wenn es gerade verbunden ist.
- Speicher und Platte räumen nach derselben Regel. Was nach der Schwärzung abgerufen wurde,
  bleibt.
- Kein neues Live-Ereignis und keine neue Gate-Menge (Füll-Regel in `LiveEvent::modul_keys`).

**Non-Goals:**
- **Offline-Queue und ETB-Entwürfe.** Sie halten nur, was die Person auf diesem Gerät selbst
  eingegeben hat, keinen Serverstand. Die Queue ist Beweissicherung und bleibt immer
  (`frontend/src/offline/AGENTS.md`). An einem abgeschlossenen Einsatz lehnt der Server ihr
  Nachsenden ohnehin ab.
- **Übrige Gerätespeicher** aus `GERAETESPEICHER` (Ortscache, Quittungen, Erfassungswerte). Sie
  gehen bei jedem Sitzungsende; ein eigener Räumweg je Einsatz wäre ein eigener Entwurf.
- **Phase B und Phase D.** Ein Einsatz ist dann seit mindestens 30 Tagen gesperrt. Mit D2 hat jeder
  offene Tab ihn bei der Vormerkung geräumt, jedes andere Gerät bei seiner nächsten Einsatzliste
  (D4), und ein älterer Stand überschreitet die Höchstliegezeit. Phase B bleibt stumm.
- **Ein Gerät, das nach der Schwärzung nie mehr Kopf oder Liste abruft.** Für dieses Gerät gilt die
  Höchstliegezeit von 24 h, wie bei jedem Rechteentzug ohne Netz.

## Decisions

### D1 — Schwärzungsstand `teilschwaerzungen` am Einsatz

`EinsatzAnzeige` bekommt `teilschwaerzungen: Option<i64>`, ausgelassen bei 0
(`skip_serializing_if`, Norm LFH-265). Berechnet beim Lesen in derselben Abfrage wie die
`EXISTS`-Spalten des Kopfs und der Liste:

```sql
(SELECT COUNT(*) FROM schwaerzung_antrag a
  WHERE a.einsatz_id = e.id AND a.ziel_art <> 'einsatz' AND a.vollzogen_at IS NOT NULL)
+ (SELECT COUNT(*) FROM einsatz_aufbewahrung_kategorie k
  WHERE k.einsatz_id = e.id AND k.geschwaerzt_at IS NOT NULL)
```

Beide Mengen wachsen nur (Vollzug und Kategorie-Schwärzung sind irreversibel, die Zeilen gehen nur
mit dem Einsatz). Der Client vergleicht nur „größer als bekannt“.

- Wer den Kopf lesen darf, erfährt damit, **dass** und **wie oft** an diesem Einsatz geschwärzt
  wurde, nicht wer, wann oder in welchem Modul. Das ist weniger als der ETB-Eintrag des Vollzugs.
  Der Lagemonitor bekommt das Feld auch: eine Zahl ist kein Freitext.
- *Verworfen:* eine Spalte am Einsatz mit Migration (zwei Schreibwege müssten sie pflegen, die
  Zählung braucht keinen). Ein Zeitstempel statt der Zahl (verrät den Zeitpunkt, und Geräte- und
  Serveruhr müssten verglichen werden). Ein eigenes Live-Ereignis `schwaerzung` (welche
  Gate-Menge? Jede Wahl verriete Lesern eines Moduls eine Schwärzung in einem anderen).
  Modul-Ereignisse mit einer Markierung in der Nutzlast (erreicht nur verbundene Tabs, nicht
  den Vorrat eines Geräts, das den Einsatz gerade nicht zeigt).

### D2 — Der Purge-Lauf meldet den Kopf

Eine gemeinsame Funktion `live::org::kopf_melden(pool, live, einsatz_id, zusaetzlich)` verteilt
`einsatz` und meldet `einsatzliste`. `routes::einsatz::kopf_geaendert_fuer` ruft sie, der Purge-Lauf
auch. So bleibt die Regel „jeder `einsatz`-Emitter meldet beide“ (`src/AGENTS.md`,
Org-Ereignisse) an einer Stelle.

| Weg | heute | neu |
| --- | --- | --- |
| Phase A, Vormerkung | `einsatzliste` | `kopf_melden` |
| A2, Einsatz-Antrag | `einsatzliste` | `kopf_melden` |
| A2, Personen-Antrag | nichts | `kopf_melden` |
| K2, Kategorie | fünf Modul-Ereignisse | dieselben plus `kopf_melden` |
| A2 ohne Wirkung, B, D | nichts | nichts |

Gemeldet wird nach dem Commit und nur bei Erfolg (Muster LFH-756). Bei gesperrtem Einsatz
(Phase A, Einsatz-Antrag) ruft ein offener Tab den Kopf ab, bekommt 404, und der bestehende
Rechteentzug räumt.

### D3 — Wächter im Speicher: Räummarke je Einsatz

Neues Modul `frontend/src/offline/schwaerzungsWaechter.ts`, eingehängt in `erzeugeQueryClient`
(auch gekoppelte Geräte zeigen Personen im Speicher). Es abonniert den `QueryCache` und liest
nur zwei Keys: den Kopf `[einsatz, X]` und die Liste `[einsaetze]`.

- Je QueryClient (WeakMap wie `SPERREN`) eine Karte `bekannt: Einsatz → Stand` und eine Karte
  `raeummarke: Einsatz → Zeitpunkt`. Der Zeitpunkt ist Geräteuhr wie `dataUpdatedAt`; es wird nie
  gegen die Serveruhr verglichen.
- Erstes Sehen eines Einsatzes (auch durch `hydrate` oder den Vorrat, D5) setzt nur `bekannt`.
- Liefert ein Erfolg einen höheren Stand als `bekannt`: `raeummarke[X] = dataUpdatedAt` dieser
  Antwort, dann für jede Query des Einsatzes außer dem Kopf: unbeobachtet entfernen, beobachtet
  neu abrufen (`invalidateQueries`, `refetchType: 'active'`). Die Detail-Keys sind damit
  eingeschlossen, ohne live zu werden.
- **Kein `resetQueries`** und kein Leeren beobachteter Queries: die Seite behält bis zur neuen
  Antwort ihren Stand und springt nicht in einen Lade- oder Fehlerzweig. Auf die Platte kommt der
  alte Stand in dieser Zeit trotzdem nicht (D5).

*Verworfen:* auf das Live-Ereignis `einsatz` reagieren statt auf die Antwort (der Kopf ändert sich
aus vielen Gründen; erst seine Daten sagen, ob geschwärzt wurde).

### D4 — Wächter im Speicher: verschwundener Einsatz

Bei jedem Erfolg der Einsatzliste vergleicht der Wächter die Menge der Einsatz-IDs mit der des
Vorgängers (vorige Daten derselben Query, ersatzweise die Liste im Vorrat). Für jeden Einsatz, der
fehlt: `lagebildSperren(qc, [einsatz, X], 'einsatz')`, unbeobachtete Queries entfernen, den
beobachteten Kopf neu abrufen. Den Rest erledigt der bestehende Rechteentzug am 404.

Ein Einsatz, den der Vorgänger nicht kannte (gerade angelegt, noch nicht in der Liste), bleibt
unberührt. Ohne Vorgänger (erste Liste der Sitzung ohne Vorrat) wird nichts entfernt.

### D5 — Platte und Vorrat lesen dieselben Marken

`lagebildStandZulaessig` bekommt eine vierte Bedingung: ein Stand eines Einsatzes mit Räummarke
gilt nur, wenn `dataUpdatedAt >= raeummarke[X]`. Diese Funktion filtert schon das Dehydrieren, den
Vorrat bei jeder Speicherung und das `hydrate`. Damit gilt:

- Ein beobachteter Query, der nach dem Anstoß noch alte Daten hält, wird nicht gespeichert.
- Der Vorrat verliert seine alten Einträge des Einsatzes bei der nächsten Speicherung.
- Der Kopf selbst ist neu (seine Antwort setzt die Marke) und bleibt.

Bei Sitzungsbeginn belegt `abonnieren` den Wächter aus dem Vorrat vor (`bekannt` aus Kopf- und
Listeneinträgen des Vorrats, die Vorgänger-Liste aus dem Listeneintrag). So fällt eine
Schwärzung zwischen zwei Sitzungen bei der ersten Antwort auf, die einen höheren Stand bringt.
Ein Einsatz, dessen Stand im Vorrat fehlt, zählt als 0.

### D6 — Personendetail und Lese-Audit

Das Personendetail ist bewusst nicht live, weil jeder Abruf eine Zeile in
`person_zugriff_audit` schreibt. D3 ruft es nach einer Schwärzung trotzdem neu ab, wenn es offen
ist. Das ist eine Zeile je offener Detailseite und Schwärzung. Der Abruf zeigt der Person am Schirm
die Daten erneut, das Protokoll ist also richtig. Schwärzungen sind selten; ein
Detail-Abruf ohne Handlung bei jedem `person`-Ereignis bleibt weiter ausgeschlossen.

## Risks / Trade-offs

- [Ein Gerät ruft nach der Schwärzung weder Kopf noch Liste ab] → Höchstliegezeit 24 h, wie beim
  Rechteentzug ohne Netz. Die Liste laden die Einsatzauswahl und die Sprungpalette, der Kopf jede
  Einsatzseite.
- [Die Räumung trifft mehr als die geschwärzte Person] → gewollt: der ganze Einsatz lädt neu, das
  ist ein Abruf je beobachteter Query an einem abgeschlossenen Einsatz. Was ohne Netz danach fehlt,
  sind nur Stände, die seit der Schwärzung nicht mehr besucht wurden.
- [Liste ohne einen Einsatz, der doch lesbar ist] → `liste_fuer` filtert mit derselben
  `darf_lesen`-Policy wie der Kopf; fehlt er dort, liefert der Kopf 403/404. Ein Fehlerabruf der
  Liste setzt keine Daten und löst nichts aus.
- [Zählung im Kopf kostet zwei Unterabfragen je Abruf] → die Kategorie über ihren
  Primärschlüssel, der Antrag ohne passenden Index (beide bestehenden sind Teilindizes auf offene
  bzw. fällige Anträge). Ein Einsatz hat höchstens eine Handvoll Anträge; die Liste zählt je
  Einsatz. Reicht das nicht, ist ein Index eine eigene Migration über `alpha`.
- [Wächter bei `gcTime: 0` im Test] → Wächtertests nehmen einen eigenen `QueryClient` (Testfalle
  aus `frontend/src/offline/AGENTS.md`).

## Migration Plan

Keine Migration. Ältere Clients ignorieren das neue Feld. Rückbau: Feld und Wächter entfernen,
die zusätzlichen Meldungen schaden nicht.
