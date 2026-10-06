# Design

## Context

`useEinsatzLiveStream` ruft je Live-Ereignis sofort `qc.invalidateQueries({ queryKey })` auf. Das
läuft ohne Bündelung, mit TanStacks Vorgabe `cancelRefetch: true` und `refetchType: 'active'`.
`apiGet` reicht das Abbruchsignal der Abfrage nicht durch: Ein „abgebrochener“ GET läuft auf
Leitung und Server zu Ende. `liveVerbindung.ts` ruft nach jedem Folge-Open `beiWiederaufbau` und
damit einen Vollabgleich, auch wenn der Browser mit `Last-Event-ID` neu verbunden hat und der
Server das Verpasste nachliefert. Bei einer Lücke kommt danach noch `lagged` und ein zweiter
Vollabgleich.

Seit LFH-920 endet jeder Live-Strom nach 30 bis 45 Minuten, und der Browser verbindet neu (Server
sendet `retry:` von 1 bis 5 s). Ohne diese Change heißt das je Tab: kurz der gelbe Hinweis „wird
wiederhergestellt“ und ein Vollabgleich aller aktiven Abfragen.

Der Einsatz-Strom beginnt mit dem Kommentar `verbunden` ohne `id:` (LFH-624). Ein Tab, der seit dem
Aufbau kein Ereignis mit `id:` erhalten hat, schickt beim Neuverbinden keine `Last-Event-ID`; der
Server antwortet dann mit `Replay::Keine`, und verpasste Ereignisse sind weg.

## Goals / Non-Goals

**Goals**
- Je betroffenem Key höchstens ein Abruf je Sammelfenster; laufende Abrufe bleiben stehen.
- Verdeckte Tabs rufen nicht ab.
- Ein Wiederaufbau durch den Browser kostet keinen Vollabgleich der Einsatz-Abfragen.
- Das planmäßige Ende eines Stroms bleibt für die Bedienung unsichtbar.
- Ein zentraler Baustein, den spätere Live-Abnehmer übernehmen.

**Non-Goals**
- `apiGet` um ein Abbruchsignal erweitern (Ticket „mittelfristig“). Mit `cancelRefetch: false`
  bricht der Live-Pfad keine Abrufe mehr ab; die übrigen Abbrecher sind ein eigenes Thema.
- Einen langen Replay serverseitig durch `lagged` ersetzen. Die Bündelung macht aus 256
  nachgelieferten Ereignissen eine Abrufwelle; ein `lagged` wäre gröber.
- Eine Live-Verbindung über Tabs teilen (LFH-264).

## Decisions

### D1 Ein Sammler je Verbindung, festes Fenster von 300 ms

Neuer Baustein `frontend/src/live/liveInvalidierung.ts`: `erzeugeLiveSammler(qc)` liefert
`vormerken(queryKey)` und `raeumen()`. Vorgemerkte Keys liegen in einer `Map` über `hashKey`; das
erste Vormerken startet einen Timer von 300 ms, weitere Keys schließen sich an. Beim Ablauf
invalidiert der Sammler jeden Key einmal und leert die Map. `raeumen()` (Effekt-Cleanup) löscht
Timer und Map, ohne zu invalidieren: Die Verbindung ist dann ohnehin weg.

- **Festes Fenster statt nachlaufender Entprellung:** Eine Entprellung, die jedes Ereignis neu
  aufzieht, hielte bei einem Dauerstrom (Sammelerfassung) die Anzeige beliebig lange an. Das feste
  Fenster begrenzt die Verzögerung auf 300 ms.
- **300 ms:** im Ticketrahmen (250 bis 500 ms), kurz genug, dass ein Bediener keinen Unterschied
  zur Sofortanzeige bemerkt, lang genug für einen Replay-Rutsch aus einer Nachricht.
- **Ein Sammler je Verbindung**, nicht global: Der Effekt-Cleanup räumt genau seine Keys, und
  Tests bleiben isoliert.
- Beide Ströme nutzen ihn: `useEinsatzLiveStream` für Einsatz- und Org-Keys, `useOrgLiveStream`
  über `orgListener(sammler)` und `invalidiereOrgLiveKeys(sammler)`.

Verworfen: `notifyManager.setBatchNotifyFunction` oder ein globales Throttling im `QueryClient`;
das bündelt Benachrichtigungen, nicht Abrufe.

### D2 `cancelRefetch: false` und Sichtbarkeit beim Abgleich

Der Sammler ruft `qc.invalidateQueries({ queryKey, refetchType }, { cancelRefetch: false })` mit
`refetchType = document.visibilityState === 'hidden' ? 'none' : 'active'`. Dasselbe Muster steht in
`offline/useOfflineSync.ts`. Ein verdeckter Tab markiert so nur; beim Zurückwechseln holt TanStacks
`focusManager` (lauscht auf `visibilitychange`, `refetchOnWindowFocus` ist an) jede veraltete
aktive Abfrage einmal nach. Ein sichtbarer Tab auf einem zweiten Bildschirm ohne Fokus (Lagemonitor)
gilt als sichtbar und ruft ab.

Die Sichtbarkeit wird beim Ablauf des Fensters gelesen, nicht beim Ereignis: Wird der Tab im
Fenster verdeckt, ruft er nicht mehr ab.

### D3 Wiederaufbau: Browser oder Frontend

`liveVerbindung.ts` unterscheidet zwei Arten von Folge-Opens:

- **Browser-Neuaufbau:** dieselbe `EventSource` öffnet erneut. Der Browser schickt die zuletzt
  bekannte `Last-Event-ID`; der Server liefert nach oder sendet `lagged`. Neue Option
  `beiNachlieferung` (Vorgabe: `beiWiederaufbau`). Der Einsatz-Strom gleicht darin nur die
  Org-Keys ab, der Org-Strom wie bisher seine Org-Keys.
- **Frontend-Neuaufbau:** eine neue `EventSource` nach `probeUndReconnect` oder nach einem
  Endzustand. Sie hat keine `Last-Event-ID`; `beiWiederaufbau` gleicht voll ab (F14 bleibt).

Verworfen: die `lastEventId` der empfangenen Ereignisse mitzuführen (Ticketvorschlag). Mit D4 hat
jede Einsatz-Verbindung ab dem Aufbau eine Position; der Browser hält sie selbst, und ein `id:`
ohne Daten erreicht keinen Listener. Die Art des Opens ist das verlässlichere Merkmal.

### D4 Position beim Aufbau des Einsatz-Stroms

`LiveHub::abonniere_mit_position` liefert neben Replay und Empfänger die Kennung der zuletzt
vergebenen Nummer des Kanals (`"{epoch}-{naechste_id - 1}"`), ermittelt unter derselben Sperre wie
Replay und `subscribe()`; `abonniere_mit_replay` bleibt als dünner Wrapper ohne Position. `sse_stream_mit_replay` sendet sie nach dem Replay-Vorspann als Ereignis nur mit
`id:` (kein `event:`, kein `data:`). Der Browser übernimmt sie als `Last-Event-ID`, ein Listener
feuert nicht.

- Das erste Frame bleibt der Kommentar `verbunden` (LFH-624), danach `retry:` (LFH-920), dann der
  Replay, dann die Position, dann der Live-Teil.
- Ein Kanal ohne Nachricht hat die Position `erste_id - 1`; ein Neuverbinden damit ergibt
  „nichts verpasst“ (`bestimme_replay`, Zweig `n + 1 >= naechste_id`), nicht `Luecke`.
- Nach einem Neustart hat die Position eine fremde Epoch → `Luecke` → `lagged`.
- Der Modulfilter ist unberührt: Die Position verrät nur eine Zahl, die jedes gefilterte Ereignis
  ohnehin trägt.
- Der Org-Strom bekommt keine Position: Org-Ereignisse haben keine Nummer und keinen Replay
  (LFH-734, D4).

### D5 Schonfrist für den Hinweis „wird wiederhergestellt“

`onerror` mit `readyState === CONNECTING` meldet `connecting` nicht mehr sofort, sondern startet
einen Timer von 8 s. Ein `open` davor löscht ihn, und der Status bleibt `open`. Läuft er ab, meldet
er `connecting`. Ein `onerror` mit `CLOSED` meldet `lost` wie bisher sofort und löscht den Timer.

- 8 s liegt über der längsten Wartezeit aus `retry:` (5 s) plus Verbindungsaufbau.
- Verworfen: ein eigenes Ereignis `neuverbinden` vor dem planmäßigen Ende. Es bräuchte einen neuen
  Wire-Tag samt Kontrakt und deckte den kurzen Funkabriss nicht ab, den die Schonfrist mit erfasst.
- Nebenwirkung: Bei einem echten Abriss erscheint der gelbe Hinweis 8 s später. Rot („unterbrochen“)
  kommt unverändert sofort, sobald der Browser aufgibt.

### D6 Zufallsaufschlag beim manuellen Neuaufbau

`RECONNECT_BACKOFF_MS` bekommt je Versuch einen Aufschlag von 0 bis 50 % (`Math.random`). Tabs, die
nach einem Neustart gemeinsam aufgeben, kommen so verteilt zurück. Den Browser-Neuaufbau streut
schon das `retry:` des Servers.

### D7 Regel

`frontend/AGENTS.md`, „Query-Key-Registry“: Live-Ereignisse invalidieren nur über den Sammler aus
`live/liveInvalidierung.ts`; Seiteneffekte (Ton, Toast, Status) bleiben sofort. Spätere
Live-Abnehmer (Modulzähler, ETB-Zeitachse, Meldungen) übernehmen ihn, statt eigene Timer zu bauen.

## Risks / Trade-offs

- **Bis zu 300 ms spätere Anzeige** eines Live-Ereignisses. Für Lagedaten unerheblich; Alarme
  bleiben sofort.
- **Tests, die Invalidierung synchron erwarten**, brauchen `waitFor` oder Fake-Timer. Die
  bestehenden Fälle in `useEinsatzLiveStream.test.tsx` werden entsprechend angepasst, nicht
  gelockert.
- **Verlass auf den Replay:** Fällt ein Ereignis aus dem Ring (mehr als 256 verpasst) oder startet der
  Server neu, kommt `lagged`; das deckt den Vollabgleich. Der Kanal überlebt seinen letzten
  Empfänger zehn Minuten (LFH-918); ein Tab, der länger weg ist, bekommt `Luecke`.

## Migration Plan

Keine Datenmigration. Frontend und Server werden zusammen ausgeliefert (eingebettetes Frontend).

## Open Questions

Keine.
