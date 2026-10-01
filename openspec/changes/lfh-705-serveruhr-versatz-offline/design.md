# Design

## Context

Die Motivation steht in `proposal.md`, Abschnitt „Why“. Darauf baut die Änderung auf:

- `betreuungsmeldungOfflineFaehig` (`frontend/src/offline/schreiben.ts`) setzt
  `erfasst = alsBackendZeit(dayjs())`, bevor es irgendetwas sendet. Der Online-Versuch geht
  ohne `zeitpunkt_at` hinaus. Nur die vorgemerkte Kopie bekommt `zeitpunkt_at ?? erfasst`
  (LFH-675, D6). Beide tragen dieselbe `client_id`.
- Der Server (`meldezeitpunkt`, `src/routes/betreuung.rs`) lehnt einen Zeitpunkt mit 400 ab,
  wenn er mehr als `ZUKUNFT_TOLERANZ_SEKUNDEN` (60) nach der Serveruhr liegt. Sonst speichert
  er `min(zeitpunkt, jetzt)`. Die Nachtragsregel (LFH-639, D2) ordnet Meldungen nach diesem
  Zeitpunkt.
- Alle eigenen API-Aufrufe laufen über `apiGet`, `apiSend` und `apiUpload`
  (`frontend/src/api/client.ts`), jeweils same-origin, auch in der Desktop-Hülle (der
  Webview lädt die Server-Adresse). hyper setzt auf jede Antwort einen `Date`-Header. Das
  Lesen dieses Headers ist same-origin erlaubt.
- `apiGet` nutzt bewusst den HTTP-Cache des Browsers (ETag, LFH-594). Eine Revalidierung (304)
  aktualisiert den gespeicherten `Date`. Ein **frischer** Cache-Treffer ohne Rückfrage
  liefert aber den `Date` des ursprünglichen Abrufs.

## Goals / Non-Goals

**Goals:**
- Eine vorgemerkte Meldung trägt den Erfassungszeitpunkt nach der Serveruhr, auch auf einem
  Gerät, dessen Uhr falsch geht. Dann scheitert sie nicht am Zukunftsriegel und verdrängt
  keine neuere Meldung.

**Non-Goals:**
- **ETB- und Meldungs-Ereigniszeit.** Beide stammen ebenfalls aus der Geräteuhr
  (`schnellerfassungModell.ts`, `NeueMeldung.ereigniszeit`), auch online. Der Server lehnt
  dort keine Zukunft ab. Es scheitert also nichts, aber ein vorgehendes Gerät datiert
  Einträge zu spät, und bei Meldungen verschiebt das auch die Bestätigungsfrist. Das ist ein
  anderer Befund (Fehldatierung, nicht Ablehnung) mit eigener Entscheidung: Soll eine
  Ereigniszeit, die eine Person sieht und bestätigt, still umgerechnet werden? Er kommt als
  Nachzug aufs Board. Das Versatzmodul ist so geschnitten, dass er es wiederverwenden kann.
- Keine Änderung am Server und keine an der 60-s-Toleranz.
- Keine nachträgliche Korrektur von Aktionen, die schon in der Queue liegen. Auch
  „Erneut versuchen“ im Drawer sendet den gespeicherten Zeitpunkt unverändert.
- Keine Korrektur des Online-Versuchs. Er sendet weiter keinen Zeitpunkt.

## Decisions

### D1 — Korrektur im Client, nicht Kappen im Server

Der Client rechnet den Erfassungszeitpunkt beim Vormerken auf die Serveruhr um.

**Verworfen: Kappen im Server.** Ein Zeitpunkt mit `client_id`, der mehr als 60 s in der
Zukunft liegt, würde dann auf „jetzt“ gesetzt, mit Nachweis im ETB. Dagegen spricht dreierlei:
1. **Die Reihenfolge bricht.** Die gekappte Meldung bekommt den Sendezeitpunkt. Eine um
   10:00 erfasste „200“ stünde nach 30 s Ausfall als 10:00:30 und verdrängte eine
   „480“, die ein anderes Gerät um 10:00:20 gemeldet hat. Das verletzt das zweite
   Akzeptanzkriterium und die Nachtragsregel.
2. **`client_id` heißt nicht „aus der Queue“.** Seit LFH-675 (D6) trägt auch der
   Online-Versuch die `client_id`. Der Server würde also auch einen von Hand eingetragenen
   Zukunftszeitpunkt still kappen, statt ihn als Eingabefehler abzulehnen. Ein eigenes
   Queue-Merkmal (Header oder Feld) wäre eine neue API-Fläche nur für diesen Zweck.
3. **Der Fehler bliebe bestehen.** Bei langem Ausfall (länger als der Vorlauf) wird die
   Meldung heute angenommen, aber um den Vorlauf zu spät datiert. Das Kappen erfasst diesen
   Fall nicht. Die Korrektur im Client behebt beide Fälle.

Die Korrektur im Client braucht keinen Server-Eingriff und keine API-Änderung. Sie fällt auf
das heutige Verhalten zurück, wo sie nichts weiß (D4).

### D2 — Versatz aus dem `Date`-Header jeder eigenen API-Antwort

Ein neues Modul `offline/serveruhr.ts` hält den Versatz `versatzMs = Serveruhr − Geräteuhr`.
`apiGet`, `apiSend` und `apiUpload` übergeben ihm **jede** Antwort des Servers, auch 4xx und
5xx, denn auch eine Fehlerantwort trägt die Serveruhr. Das geschieht direkt nach `fetch`,
bevor der Body gelesen wird. Gemessen wird:

`versatzMs = (Date + 500 ms) − Empfangszeit nach Geräteuhr`

`Date` hat Sekundenauflösung und ist abgeschnitten. Die wahre Serverzeit liegt also in
`[Date, Date + 1 s)`, und +500 ms nimmt die Mitte. Die Laufzeit der Antwort fällt dagegen
nicht ins Gewicht: Gegen 60 s Toleranz und Minuten an Uhrenfehler reicht eine Genauigkeit
von etwa einer Sekunde. Es gilt immer die **jüngste** Messung. Die Uhr eines Geräts kann
springen (NTP, Hand), und eine Mittelung über alte Werte zöge den Sprung nach.

**Nicht gemessen** wird eine Antwort, die der Browser ohne Rückfrage aus seinem Cache liefern
darf. Ihr `Date` ist alt, und der Versatz erschiene um ihr Alter falsch. Erkannt wird das an
den Antwort-Headern, die der Browser mit dem Cache-Eintrag speichert: `Cache-Control` mit
`max-age`/`s-maxage` > 0 oder `immutable`, oder `Expires` oder `Last-Modified` ohne
`no-cache`/`no-store` (heuristische Frische). Die eigenen JSON-Routen senden nichts davon und
zählen also. Eine 304-Revalidierung aktualisiert `Date` und zählt ebenfalls.

**Verworfen: ein eigener Zeit-Endpunkt** (`GET /api/zeit`). Er brauchte einen zusätzlichen
Abruf, und dessen Zeitpunkt legte fest, wie alt der Versatz beim Ausfall ist. Die laufenden
Abrufe (Sitzungswache, Live-Stream-Nachladen, Polls) messen ohnehin ständig. **Verworfen:**
nur `apiSend` messen. Das schließe Cache-Fehler sicher aus, aber ein Gerät, das nur liest
und dann offline meldet, hätte keinen Versatz.

### D3 — Rauschgrenze: unter 5 s gilt die Geräteuhr

Ist `|versatzMs|` kleiner als 5 s, korrigiert `serverJetzt()` nicht. Der Grund ist die
Messungenauigkeit von etwa einer Sekunde aus D2. Darunter wäre die Korrektur reines
Zittern und keine Information. Ein richtig gehendes Gerät verhält sich damit genau wie
heute.

### D4 — Haltbarkeit: im Speicher und 24 h in `localStorage`

Der jüngste Versatz liegt im Modul (Speicher) und zusätzlich in `localStorage` unter
`lifeline-serveruhr` als `{ versatzMs, gemessenAt }`. Er ist eine Eigenschaft des Geräts,
nicht der Person: kein Personenbezug, kein Löschen beim Abmelden oder Benutzerwechsel. Ein
Neuladen ohne Netz (Lagebild offline, LFH-723) findet so den letzten Versatz. Er gilt
**24 h** ab `gemessenAt`, dieselbe Frist wie die Offline-Identität. Ist er älter, gilt er als
unbekannt. Jeder Zugriff auf `localStorage` steht in `try/catch`. Fehlt der Speicher, zählt
nur die Messung im Speicher.

Ohne bekannten Versatz (frischer Start ohne Netz, kein `Date`, abgelaufen) gibt
`serverJetzt()` die Geräteuhr zurück. Das ist das heutige Verhalten, mit Drawer als Netz.

**Verworfen: `sessionStorage`.** Ein Neuladen in einem neuen Tab ohne Netz hätte dann
keinen Versatz. **Verworfen: IndexedDB.** Asynchron gelesen, käme der Wert beim Vormerken
direkt nach dem Start womöglich zu spät, und es gibt nur einen einzigen Wert zu speichern.

### D5 — Angewendet nur beim Vormerken

`betreuungsmeldungOfflineFaehig` ersetzt `alsBackendZeit(dayjs())` durch
`alsBackendZeit(serverJetzt())`. Der Zeitpunkt wird weiter **vor** dem Online-Versuch
genommen: Ein Timeout von 15 s darf ihn nicht verschieben. Ein eingetragener Zeitpunkt
(`daten.zeitpunkt_at`, optionales Feld unter „weitere“ in `BetreuungDialoge.tsx`) bleibt
unberührt. Ihn hat die Person bewusst gewählt, und eine stille Umrechnung machte aus
„09:30“ eine Zeit, die sie nie eingegeben hat. Geht ihr Gerät vor und trägt sie eine
Zukunftszeit ein, ist die 400 die richtige Antwort.

## Risks / Trade-offs

- [Ein Proxy entfernt `Date`] → Dann gibt es keine Messung, und es gilt das heutige
  Verhalten. Kein Fehler, nur keine Korrektur.
- [Die Geräteuhr springt zwischen Messung und Vormerken (NTP-Abgleich im Ausfall)] → Die
  Korrektur ist dann um den Sprung falsch. Online heilt die nächste Antwort das sofort.
  Offline bleibt höchstens der Sprung als Fehler, also eine Meldung, die ins Drawer fällt oder
  um den Sprung verschoben steht. Das ist nicht schlechter als heute, wo der ganze Vorlauf
  der Fehler ist.
- [Ein künftiger Endpunkt setzt `max-age` und wird über `apiGet` gelesen] → Die Cache-Regel
  aus D2 schließt ihn aus. Ein Test hält die Regel fest.
- [Eine korrigierte Zeit liegt vor der echten, wenn die Uhr nachgeht und die Messung alt ist] →
  Der Server nimmt Vergangenheit immer an. Die Abweichung ist höchstens der Gang der Uhr seit
  der Messung, also Sekunden.

## Migration Plan

Nur Frontend. Kein Schema, keine API, keine Queue-Version: Vorgemerkte Aktionen tragen wie
bisher einen fertigen `zeitpunkt_at`. Ein altes Bundle ignoriert den `localStorage`-Eintrag.
Rückbau ist das Zurückdrehen des Frontends.
