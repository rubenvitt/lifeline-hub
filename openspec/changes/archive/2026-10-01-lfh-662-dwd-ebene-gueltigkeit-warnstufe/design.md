# Design

## Context

Der Anlass steht in `proposal.md`, die Anforderungen stehen in
`specs/lagekarte-fachebenen/spec.md`. Hier steht nur der Bestand, der den Weg bestimmt.

- **DWD und NINA laufen über `liefere_mit_swr`** (`src/karte/quellen.rs`).
  - Frisch (Alter < TTL): sofort ausliefern.
  - Veraltet: den alten Stand sofort ausliefern und im Hintergrund erneuern, je Schlüssel
    höchstens ein Refresh (`inflight`).
  - Kalt: blockierend abrufen, beim Scheitern `offline`.

  Eine Obergrenze gibt es nicht. Der Cache-Deckel von 48 h (`cache::MAX_ALTER_SEKUNDEN`) räumt
  nur beim Schreiben eines beliebigen Schlüssels auf. Die reine Wegwahl gibt es schon einmal,
  für die Autobahn (`autobahn_weg`).
- **`erneuere_dwd` cacht den WFS-Rohinhalt** (`hole_geojson`, unverändert durchgereicht). Die
  Properties sind die des DWD-WFS `Warnungen_Gemeinden_vereinigt`: `ONSET`, `EXPIRES` (ISO 8601
  mit Offset), `SEVERITY` (CAP: `Minor` … `Extreme`), `EC_GROUP`, `EVENT`, `HEADLINE` …
- **NINA trägt kein Ende.** `kombiniere_nina` übernimmt aus `mapData` nur `startDate` als
  `beginn`. Gültigkeit filtern lässt sich deshalb nur bei DWD, eine Obergrenze dagegen bei
  beiden.
- **Vorbild Wetter-Modul (LFH-633).**
  - `wetter::abruf` hält die Warnungen ungefiltert im Cache und filtert erst bei der Antwort
    (`quelle::gueltige`, `ende ≤ jetzt` fällt weg).
  - Die Obergrenze für Warnstände ist dort `OBERGRENZE_WARNUNGEN_S = 6 h`.
  - `stufe_aus_severity` und die Vertragskarte `dwdWarnstufe` (`theme/statusFarben.ts`) bilden
    CAP-Severity auf die vier amtlichen DWD-Stufen ab.
- **Die Lagekarte hält Daten über Fehler hinweg.** `useFachebenen` zeichnet `q.data.features`
  auch bei `isError` weiter (LFH-591, D4). Der DWD-Poll läuft alle 300 s.
- **Polygonebenen** (`fachebenenLayer.ts`) bestehen aus einem `fill` mit fester Deckkraft 0,2 und
  einer `line`, beide in der Ebenenfarbe. Einen datengetriebenen `line-dasharray` meidet das
  Projekt. `kartenLayer.ts` (Zonen) nimmt dafür zwei gefilterte Linienebenen: Arrays lassen sich
  nicht aus Properties lesen, und ein abgelehnter Layer fehlt still.
- **Inspector.** `WarnungInhalt` dient NINA und DWD und färbt `SCHWERE` per antd-`Tag color`:
  `red`/`volcano`/`gold`/`blue`. Diese Farben stehen außerhalb des Vertrags. Der Guard
  `statusVertrag.guard.test.ts` greift hier nicht, weil `SCHWERE` kein Vertrags-Enum ist.

## Goals / Non-Goals

**Goals:**

- Die Gültigkeit einer Warnung entscheidet je Seite eine reine Funktion, damit sie sich an der
  Grenze testen lässt: im Backend die Filterung, im Frontend Filterung und Markierung.
- Die Obergrenze entscheidet eine reine Wegwahl, die frisch, alt und kalt um „zu alt“ ergänzt.
- Die Karte altert ohne neuen Abruf mit, im selben Minutentakt wie die Marke „veraltet“.

**Non-Goals:**

- **Keine Gültigkeit für NINA**, weil die Quelle kein Ende liefert. Eine NINA-Warnung verschwindet,
  wenn MoWaS sie zurückzieht.
- **Keine Schwere-Färbung auf der Karte.** Die Fläche behält die Ebenenfarbe (LFH-593), die
  Schwere steht im Inspector.
- **Kein neuer `FachebeneStatus` und kein Feld im Umschlag.** Die Obergrenze nutzt das bestehende
  `offline`.
- **Keine Obergrenze im Client für gehaltene Daten.** Fällt der eigene Server aus, zeichnet die
  Karte den letzten Stand weiter, markiert ihn als „offline“ und „veraltet“ (LFH-591) und filtert
  abgelaufene Warnungen heraus. Mehr verlangt das Akzeptanzkriterium nicht.
- **`ZUSTAND` (PEGELONLINE) und `DRINGLICHKEIT` im Inspector bleiben.** `ZUSTAND` hat dasselbe
  Muster eigener antd-Farben, gehört aber nicht zur Warnstufe. Es kommt als eigener Task auf das
  Board.

## Decisions

### D1 — Obergrenze als Parameter von `liefere_mit_swr`, Weg als reine Funktion

`liefere_mit_swr` bekommt `obergrenze: Option<Duration>`. Die Wahl trifft
`swr_weg(alter: Option<i64>, ttl, obergrenze) -> SwrWeg { Frisch, AltUndErneuern, Kalt }`:

- `alter < ttl` → `Frisch`
- `alter ≤ obergrenze` (bzw. keine Obergrenze) → `AltUndErneuern`
- sonst, oder ohne Eintrag → `Kalt`

`Kalt` heißt: blockierend abrufen, beim Scheitern `offline`. Das ist der heutige Weg für einen
fehlenden Eintrag. DWD und NINA übergeben `Some(WARN_OBERGRENZE)` mit 6 h, alle anderen Aufrufer
`None`.

*Alternative A:* Jenseits der Obergrenze sofort `offline` antworten und im Hintergrund erneuern,
wie `AutobahnWeg::LeerUndErneuern`. Verworfen: Ist die Quelle erreichbar, sähe der Bediener einen
ganzen Poll-Takt lang `offline` (bis zu 5 min bei DWD), obwohl ein frischer Stand nur einen Abruf
entfernt ist. Der Autobahn-Weg existiert nur, weil ihr voller Fächer etwa 25 s dauert. Ein DWD-
oder NINA-Abruf passt in die Frist.

*Alternative B:* Alte Einträge im Cache löschen (Prune je Schlüssel). Verworfen: Das hängt die
Aussage an einen Schreibvorgang, wie heute beim Deckel, und genau das ist der Mangel aus dem
Ticket.

*Alternative C:* Eine eigene Konstante je Ebene in der Frontend-Registry, die den Stand
ausblendet. Verworfen: Dann käme ein alter Stand weiter über die API, und jeder andere Konsument
(Lagebild ohne Netz, Druck) müsste die Regel wiederholen.

### D2 — Abgelaufene DWD-Warnungen filtert der Server bei jeder Auslieferung

Eine reine Funktion `dwd_gueltige(antwort, jetzt) -> FachebeneAntwort` entfernt Features mit
lesbarem `EXPIRES ≤ jetzt` und setzt `status` neu (`leer`, wenn nichts bleibt). `abgerufen`,
`stand` und `attribution` bleiben erhalten. `fetch_dwd` wendet sie auf das Ergebnis von
`liefere_mit_swr` an, also auf frische, alte und kalte Wege gleich. Die Uhr wird erst nach dem
Abruf gelesen, weil der kalte Weg bis zu 8 s wartet und „Ende erreicht“ zum Zeitpunkt der Antwort
gilt. Der Cache hält den Rohstand.
Würde vor dem Cachen gefiltert, blieben Warnungen stehen, die zwischen zwei Abrufen ablaufen.

Zeitvergleich mit `chrono::DateTime::parse_from_rfc3339`. Ist `EXPIRES` unlesbar oder fehlt es,
bleibt die Warnung („lieber zu viel als verschwiegen“, wie `gueltige` im Wetter-Modul).

*Alternative:* nur im Frontend filtern. Verworfen: Die API soll keine abgelaufene Warnung
ausliefern, gleich wer sie liest. Die Filterung im Client (D3) deckt nur die Zeit zwischen zwei
Polls und gehaltene Daten ab.

### D3 — Gültigkeit im Client: Filter plus Markierung `angekuendigt`, im Minutentakt

Die reine Funktion `dwdGueltigkeit(fc, jetztMs)` in `pages/lagekarte/dwdGueltigkeit.ts`:

- entfernt Features mit `EXPIRES ≤ jetzt`, nach derselben Regel wie D2. Gelesen wird ebenso
  streng: nur RFC 3339 mit Offset. `Date.parse` allein nähme auch einen Wert ohne Offset
  (Ortszeit) oder ein bloßes Datum an, dann entschieden Server und Karte verschieden;
- setzt auf Features mit lesbarem `ONSET > jetzt` die Property `angekuendigt: true`;
- gibt die Collection unverändert (gleiche Referenz) zurück, wenn sich nichts ändert, damit
  `setData` nicht ohne Not läuft.

`useFachebenen` wendet sie für `k === 'dwd'` an. `jetzt` kommt aus `useMinutenTakt`, das schon
`FachebeneStand` taktet (LFH-591, D4). Die Markierung gehört in den Client und nicht auf den
Draht: Der Übergang „angekündigt → geltend“ geschieht auch, wenn kein Abruf stattfindet.

*Alternative:* Der Server setzt `angekuendigt`. Verworfen: Der Wert veraltet mit der Uhr und
nicht mit dem Abruf. Der Client müsste ihn ohnehin neu rechnen.

### D4 — Gestrichelt als eigene gefilterte Linienebene, Deckkraft per `case`

Für Polygonebenen gilt:

- `fachebene-<key>-fill`: `fill-opacity` wird
  `['case', ['==', ['get', 'angekuendigt'], true], 0.08, 0.2]`.
- `fachebene-<key>-line`: bekommt den Filter `angekuendigt != true`.
- `fachebene-<key>-line-angekuendigt`: neue Ebene mit dem Filter `angekuendigt == true` und
  konstantem `line-dasharray: [3, 2]`. Das ist dasselbe Muster wie `zonen-line-gestrichelt`.

Die Ebenen gelten generisch für jede Polygonebene. Ohne Property bleibt alles beim Alten. NINA
setzt die Property nie.

Klickziele: `fachebenenLayer.ts` meldet für Polygone nur `-fill` als Klickebene
(`klickLayerIds`). Die neue Linienebene ist keine Klickebene und braucht deshalb keine Rolle in
`ordneKlickebene`. Zu prüfen ist das gegen den Guard in `klickziel.test.ts`.

0,08 statt 0,2: Die Fläche bleibt als Gebiet erkennbar, tritt aber hinter geltende Warnungen
zurück. Der zweite Kanal ist die Strichelung (WCAG 1.4.1). Die Deckkraft allein reicht nicht.

### D5 — Schwere über den Vertrag: `dwdWarnstufe` für DWD, neue Karte `capSchwere` für NINA

- **DWD:** `SEVERITY` wird über eine kleine Abbildung (`Minor`→`gering` … `Extreme`→`extrem`,
  gespiegelt von `stufe_aus_severity`) zu `WetterWarnstufe` und zeigt `dwdWarnstufe[stufe]` per
  `StatusTag`. Die Wörter sind die amtlichen („Wetterwarnung“, „Markantes Wetter“,
  „Unwetterwarnung“, „Extremes Unwetter“), dieselben wie im Wetter-Paneel. So zeigt der Einsatz
  dieselbe Warnung mit demselben Wort wie die Karte.
- **NINA:** neue Vertragskarte
  `capSchwere: Record<'extreme' | 'severe' | 'moderate' | 'minor', StatusDarstellung>` mit
  „Extrem“/„Schwer“ → `alarm` und „Mäßig“/„Gering“ → `achtung`. Begründung für eine eigene Karte
  (frontend/AGENTS.md, „Ein Status gehört in den Vertrag“): Eine NINA-Warnung ist kein Wetter.
  „Unwetterwarnung“ wäre für eine MoWaS-Gefahrstoffwarnung falsch. Die Rollen-Abbildung ist
  dieselbe wie bei `dwdWarnstufe`, damit dieselbe CAP-Stufe überall gleich gefärbt ist.
- **Unbekannte Schwere** (`Unknown`, leer, fremd): ein `Tag` ohne Farbe mit dem Rohwert, wie
  heute. Anders als das Wetter-Modul wird hier nicht auf `gering` gerundet. Der Inspector zeigt
  das Objekt selbst, und ein erfundenes Wort wäre eine Aussage, die die Quelle nicht macht.
- `SCHWERE` entfällt. `ALLE_MAPS` in `statusFarben.test.ts` wächst von 29 auf 30, die Zahl in
  `frontend/AGENTS.md` zieht nach.

### D6 — Inspector-Zeile „angekündigt“

`WarnungInhalt` bekommt `jetzt` (Minutentakt). Für DWD mit `ONSET > jetzt` steht vor „Gültig“
eine Zeile `Descriptions.Item label="Status"` mit dem Wort „angekündigt“ und „ab <DTG voll>“.
Die Zeile ist Text, keine Farbe. Grundlage ist allein `istAngekuendigt(p, jetzt)`, dieselbe
Funktion, mit der D3 die Karte markiert, und **nicht** die Property `angekuendigt`.

*Korrektur nach dem Review (01.10.2026):* Der erste Entwurf nahm die Property als Grundlage und
rechnete nur ohne sie selbst nach. Die Properties im Inspector sind aber eine Momentaufnahme vom
Klick (`useKartenInteraktion`). Blieb der Inspector über den Beginn hinaus offen, meldete er
weiter „angekündigt“, während die Karte die Warnung schon durchgezogen zeichnete. Ohne lesbares
`ONSET` setzt D3 die Property ohnehin nie. Eine abgelaufene Warnung im offenen Inspector bleibt
stehen. Das verlangt die Spec nicht, es ist eine eigene Entscheidung.

## Risks / Trade-offs

- **[Kalter Weg nach der Obergrenze blockiert bis 8 s je Anfrage, solange die Quelle weg ist]**
  → Das ist derselbe Weg wie bei leerem Cache heute. Der Client-Timeout liegt bei 15 s
  (`api/client.ts`), der reqwest-Timeout bei 8 s. NINA ruft N+1 Geometrien ab, gedeckelt auf 8
  gleichzeitig. Eine Abkühlung wie bei Autobahn oder Wetter wird nicht gebaut: Der Poll von 90 s
  bzw. 300 s je offenem Client begrenzt die Last, und nach der Obergrenze ist die Ebene ohnehin
  `offline`.
- **[Uhrenversatz Server ↔ Browser]** → Die Server-Filterung nutzt die Serveruhr, die
  Client-Filterung die Browseruhr. Geht der Browser nach, zeichnet er eine Warnung kurz weiter,
  die der Server schon entfernt hätte. Das bleibt folgenlos, weil die nächste Antwort sie nicht
  mehr enthält.
- **[`ONSET`/`EXPIRES`-Format des WFS ändert sich]** → Unlesbar heißt geltend und nicht
  abgelaufen. Eine Formatänderung macht die Ebene also nicht leer, sondern höchstens zu voll.
  Die Tests pinnen das Format.
- **[Schwächere Fläche auf hellem Kartengrund kaum sichtbar]** → Die gestrichelte Kontur in
  voller Ebenenfarbe trägt die Erkennbarkeit, die Fläche ist Zugabe. Der Nachweis läuft über
  einen e2e-Lauf mit einer angekündigten Warnung (Task 4).
- **[Die Lagekarte zeigt nach 6 h `offline` statt alter Warnungen]** → So gewollt (Entscheidung
  am Phase-1-Checkpoint, 01.10.2026). Ein sechs Stunden alter Warnstand ist für die Lage keine
  Aussage mehr.

## Migration Plan

Keine Datenbank-Migration und keine Änderung an Umschlag oder Typ-Codegen. Rückbau: Obergrenze
auf `None` setzen und den Filter entfernen. Der Cache hält ohnehin den Rohstand.
