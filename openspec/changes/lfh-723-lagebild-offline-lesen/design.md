# Design

## Context

Zur Motivation siehe proposal.md. Die Anforderungen stehen in
`specs/lagebild-offline-lesen/spec.md`. Der Bestand, auf dem die Änderung aufsetzt, am
28.09.2026 gemessen:

- **Ein QueryClient je Tab.** Er entsteht in `main.tsx:31` über `erzeugeQueryClient()`
  (`api/queryClient.ts`).
  - Gesetzt sind `staleTime` 10 s und `retry` nur bei `NetzFehler` mit höchstens zwei
    Versuchen.
  - `gcTime` steht auf dem Default von 5 min, `networkMode` auf `'online'`. Ohne Netz
    pausieren Queries (`fetchStatus: 'paused'`) und werden nie `isError`.
  - Der globale Fehler-Seam `behandleFehler` kennt nur 401.
  - Im Produktivcode gibt es weder `persistQueryClient` noch `clear`, `removeQueries` oder
    `resetQueries`.
- **Auth.** `AuthProvider` sitzt in `App.tsx`, also *unter* dem `QueryClientProvider`.
  - `useQueryClient` ist dort erreichbar.
  - `me()` macht aus jedem Fehler „anonym“, auch aus einem `NetzFehler`. Ein Offline-Reload
    endet deshalb auf `/login`.
  - `logout()` setzt nur `benutzer = null`.
  - Bei 401 läuft die Sitzungswache (`auth/useSitzungsWache.ts`) → `logout()` → `/login`.
- **Registry.** `api/queryKeys.ts` teilt die einsatzbezogenen Keys XOR in live
  (`EINSATZ_STREAM_EVENTS`) und `NICHT_LIVE_KEYS` ein. Jeder einsatzbezogene Key trägt die
  `einsatzId` an Stelle 1. `istKeyDesEinsatzes` existiert.
  - Zwei Kommentare knüpfen die erste Mengen-Räumung im Produktivcode an eine Auflage: die
    Gliederung von `GLOBAL_KEYS` in eine XOR-Partition zu heben (`queryKeys.ts:282`, `:466`).
- **IndexedDB.** Die Offline-Queue nutzt `idb` (DB `lifeline-offline`, Bindung an
  `benutzer_id`). Die neue Vorhaltung ist eine eigene DB und fasst die Queue nicht an.
- **Service Worker.**
  - `vite-plugin-pwa` precacht die Shell samt Lazy-Chunks.
  - `/api/*` ist davon ausgenommen (`navigateFallbackDenylist`), und es gibt kein
    `runtimeCaching`.
  - Belegt ist nur die Shell (`e2e/lagekarte-offline-precache.spec.ts`). Der React-Root blieb
    dort nach dem Offline-Reload leer.
- **Datenstand.**
  - `components/Datenstand.tsx` zeigt „Stand HH:mm“ aus `dataUpdatedAt`.
  - `EinsatzSeite` reicht `dataUpdatedAt` durch: ETB, Personen, Meldebild
    (`gemeinsamerDatenstand`), Aufträge, Befehle.
  - Die Lagekarte baut ihren Kopf selbst (`seitenkopfStil`/`seitenMetaStil`) und zeigt bisher
    keinen Datenstand.
- **Hydrate** (query-core 5.10x) übernimmt `dataUpdatedAt` und setzt `fetchStatus: 'idle'`.
  `defaultShouldDehydrateQuery` nimmt nur `status === 'success'`.

## Goals / Non-Goals

**Goals:**
- Eine Quelle für „was wird gespeichert“: die Registry in `api/queryKeys.ts`. Invalidierung,
  SSE-Fan-out und Vorhaltung sprechen über dieselben Keys.
- Kein Fremdstand im Speicher, bevor die Identität geklärt ist. Das gilt auch nicht für einen
  Bruchteil einer Sekunde und auch nicht bei einer 401 beim Start.
- Löschen an **jedem** Weg hinaus: Abmelden, 401, Benutzerwechsel, Rechteentzug,
  Höchstliegezeit.

**Non-Goals:**
- **Kein Workbox-`runtimeCaching` für `/api`.** Ein URL-Cache wäre eine zweite Wahrheit neben
  dem QueryClient, ohne Invalidierung und ohne Benutzerbindung. Das schließt das Ticket
  ausdrücklich aus.
- **Kein Offline-Schreiben über das Bestehende hinaus.** Offline bleibt ein Lesezustand, und
  die Offline-Queue ist unverändert.
- **Kein eigener Leerzustand „ohne Verbindung nicht geladen“** für nie besuchte Ansichten. Sie
  zeigen ihren Bestands-Leer- oder -Fehlerzustand, siehe Risiken.
- **Kacheln der Basiskarte offline.** Die Kacheln kommen vom eigenen Server und sind nicht Teil
  dieses Change.
- **Räumung der übrigen PII auf dem Gerät.** Gemeint sind Personen-Quittungen der Queue,
  ETB-Entwürfe, Ortscache und `localStorage`. Dafür gibt es das Folgeticket LFH-767.

## Decisions

### D1 — Persistenz über `@tanstack/query-persist-client-core` mit eigenem Persister auf `idb`

- **Eigene DB.** Sie heißt `lifeline-lagebild` und hat einen Store `stand` mit genau einem
  Datensatz (Schlüssel `'aktuell'`):
  `{ benutzer: BenutzerAnzeige, bestaetigtAt: number, buster: string, client: PersistedClient }`.
  Ein Datensatz genügt, weil ein Gerät immer nur einen angemeldeten Benutzer hat. Ein Wechsel
  löscht, siehe D5.
- **Persister.** Er implementiert das `Persister`-Interface (`persistClient`, `restoreClient`,
  `removeClient`). Das Schreiben wird mit 1 s gedrosselt, und die Drosselung lässt sich
  abbrechen. Dieses Abbrechen gehört zu D5.
- **Buster** ist `__APP_VERSION__`, das bereits per `define` in `vite.config.ts` gesetzt wird.
  Nach einem Update der App wird ein Stand verworfen, dessen Form eine ältere Oberfläche
  geschrieben hat.
- **Pakete.** Nur `@tanstack/query-persist-client-core`, exakt gepinnt auf die installierte
  Version von `@tanstack/query-core`. `@tanstack/react-query-persist-client` wird nicht
  gebraucht, siehe D2.
- **Schreiben nur in einen bestehenden Datensatz derselben Identität.** `persistClient` legt
  keinen Datensatz an. Er schreibt nur, wenn schon einer mit derselben `benutzer.id`
  existiert. Angelegt wird der Datensatz ausschließlich beim Start (D2) und bei
  `login`/`aktualisiere`. Hat ein Tab gelöscht, legt ein zweiter Tab desselben Geräts ihn beim
  nächsten Speichern also nicht wieder an. Sonst verletzte „nach dem Abmelden ist der Speicher
  leer“ die Spec, sobald zwei Tabs offen sind.
- **Ohne IndexedDB keine Vorhaltung.** Das betrifft private Fenster, blockierte Website-Daten
  und jsdom. Jeder Zugriff sitzt in `try/catch`, und ein Fehlschlag heißt „kein Datensatz“. Die
  App verhält sich dann wie bisher. Das gilt auch für die rund 60 Testdateien, die über
  `test/utils.tsx` einen `AuthProvider` einhängen: Ihr Start darf an der fehlenden IndexedDB
  weder hängen noch scheitern.
- **Verworfen:**
  - `idb-keyval`: eine neue Abhängigkeit, obwohl `idb` schon vorhanden ist.
  - `localStorage`: synchron und auf etwa 5 MB begrenzt. Ein ETB mit einigen hundert
    Einträgen und die Lagekarte sprengen das.
  - Workbox: siehe Non-Goals.

### D2 — Wiederherstellen erst nach geklärter Identität, gesteuert aus `AuthProvider`

`PersistQueryClientProvider` stellt beim Einhängen wieder her, also **bevor** feststeht, wer
angemeldet ist. Bei einer 401 oder einem anderen Benutzer stünde der Fremdstand kurz im
Speicher. Deshalb ruft `AuthProvider` die Kernfunktionen selbst auf
(`persistQueryClientRestore`, `persistQueryClientSubscribe`). Den Start regelt eine reine,
exportierte Entscheidungsfunktion `startEntscheidung(meErgebnis, datensatz, jetzt)`:

| `me()` | Datensatz | Folge |
|---|---|---|
| ok, gleiche `benutzer.id`, frisch (≤ 24 h), gleicher Buster | vorhanden | wiederherstellen, `bestaetigtAt = jetzt` |
| ok, andere Id, veraltet oder anderer Buster | vorhanden | löschen, nicht wiederherstellen |
| `ApiError` (401 oder jeder andere Status außer 502/503/504) | beliebig | löschen, anonym |
| `NetzFehler` oder `ApiError` 502/503/504 | frisch, gleicher Buster | wiederherstellen, `benutzer = datensatz.benutzer` |
| `NetzFehler` | fehlt oder veraltet | löschen, anonym (Verhalten wie bisher) |

**502, 503 und 504 gelten wie ein Netzfehler** (Nachtrag aus der Umsetzung). Mit diesen
Codes meldet ein vorgeschalteter Proxy, dass der Server nicht erreichbar ist. Über die Sitzung
sagen sie nichts. Ohne diese Regel löschte ein ausgefallener Fükw-Server hinter einem Proxy
genau den Stand, den man in diesem Moment braucht. Ein Server ohne Proxy wäre dagegen als
Netzfehler durchgekommen. Jede andere Antwort des Servers selbst, auch eine 500, bleibt eine
Ablehnung.

Ohne Serverbestätigung bleibt `laedt` auf `true`, bis die Wiederherstellung durch ist.
`RequireAuth` zeigt so lange den Ladezustand. Serverbestätigt siehe die Festlegungen unten.
Das ersetzt `IsRestoringProvider` ohne neuen Mechanismus. Erst nach der Wiederherstellung
startet das Abonnement, das gedrosselt speichert.

**Zwei Festlegungen aus der Umsetzung** (gemessen an der Vitest-Suite):
- **Serverbestätigt wechseln `benutzer` und `laedt` sofort und zusammen**, im selben `then`
  von `me()` wie vor LFH-723. Die Wiederherstellung läuft danach. Das ist unbedenklich, weil
  sie nur den **eigenen** Stand der bestätigten Identität bringt und `hydrate` keinen Abruf
  überschreibt, der inzwischen neuer ist. Nur beim Netzfehler wartet `laedt` auf den
  Datensatz, denn erst er sagt, wer angemeldet ist.
  - Gemessen: Kam `benutzer` eine IndexedDB-Runde später, scheiterten elf knapp getaktete
    Bestandstests (`stammdaten/rechteGate.test.tsx`).
  - Wechselten `benutzer` und `laedt` in zwei Takten, hängten Oberflächen außerhalb von
    `RequireAuth` ihre Abfragen zweimal ein (`admin/DemoDatenPage.test.tsx`, sieben Tests).
- **Das Test-Setup räumt die Lagebild-DB nach jedem Test ohne `await`**
  (`test/setup.ts`). Ein wartendes `afterEach` verschob den Takt zwischen zwei Tests und
  färbte dieselben elf Tests rot. Die Reihenfolge hält trotzdem, weil IndexedDB überlappende
  Transaktionen in Erzeugungsreihenfolge ausführt.
- **Beim Start löscht ein Verwerfen nur die Platte**, nicht den Speicher. Der verworfene Stand
  wurde nie wiederhergestellt, im Speicher steht nur, was die laufende Sitzung schon abruft.
  Ein `clear()` an dieser Stelle räumte in Tests gemessen die Abfragen einer schon
  eingehängten Seite ab, 130 rote Tests. In der App wäre es Arbeit ohne Wirkung. Den Speicher
  räumen Abmelden und Benutzerwechsel (D5).

Auch `login()` und `aktualisiere()` durchlaufen den Vergleich: Eine andere `benutzer.id` als
im Datensatz löscht vor dem Setzen des Benutzers.

### D3 — Allowlist als Teil der Registry

In `api/queryKeys.ts` steht `LAGEBILD_OFFLINE` mit zwei Teilen:

- **Einsatzbezogene Prefixe:**
  - Rahmen: `einsatz`, `modulOverrides`, `einstellungen`, `modulZaehler`
  - ETB: `etb`
  - Meldebild: `einheiten`, `personal`, `fahrzeuge`, `material`, `abschnitte`, `auftraege`
  - Aufträge: `befehle`
  - Betroffene: `personen`, `uhs`
  - Lagekarte: `zonen`, `freieZeichen`, `gefahrengebiete`, `schaeden`, `lagemeldungen`,
    `fuehrungskraefte`, `betreuung`, `kartenAnsicht`, `kartenbilder`, `lageSnapshot`
  - Dazu der Sub-Key `['einsatz-meldungen', id, 'rueckmeldungen']`. Nur die Rückmeldungen,
    nicht die Meldungsliste.
- **Globale Prefixe:** `einsaetze`, `karteConfig`, `organisation`, `fahrzeugStatus`.

Die reine Funktion `istLagebildOfflineKey(key)` ist der einzige Filter. Der Persister nutzt
sie als `shouldDehydrateQuery` zusammen mit `defaultShouldDehydrateQuery`, also nur
Erfolgsstände.

**Bewusst mitgenommen:** Die Palette legt unter demselben Prefix `etb` Nummern-Abfragen ab
(`etbNummerSchluessel`). Das ist dieselbe Datenklasse mit denselben Rechten, und die Palette
setzt ein eigenes `gcTime` von 30 s. Sie fallen also ohnehin schnell heraus.

**Bewusst draußen:**
- `etbDruck`, weil ein Druck ein Schnappschuss ist.
- `personAudit`, `chat*`, `dokumente`, `lageSnapshotDokument`, `pegel`, `wetter`, alle
  `fachebene*`, alle Einstellungs- und Admin-Keys.

**Guard `lagebildOffline.guard.test.ts`:**
- Er baut einen QueryClient mit einem Erfolgsstand für **jeden** verwalteten Prefix aus
  `EINSATZ_KEYS` und `GLOBAL_KEYS`, dehydriert ihn und vergleicht die Menge der
  geschriebenen Prefixe mit der Allowlist.
- Ein zweiter Fall prüft, dass ein Fehler- und ein Ladezustand eines gelisteten Keys **nicht**
  geschrieben werden.
- Mutationsprobe: Ein zusätzlicher Prefix in der Liste muss den Test rot färben, ebenso ein
  `shouldDehydrateQuery: () => true`.

### D4 — Bestätigungszeitstempel getrennt vom Speicherzeitpunkt

`maxAge` des Persisters misst ab dem letzten **Speichern**, und gespeichert wird bei **jeder**
Änderung im Cache, auch bei einer ohne Server. Heute schreibt der Client zwar nur nach einer
Serverantwort per `setQueryData` in den Cache (gemessen: `offline/useOfflineSync.ts:84` beim
Flush, `etb/EtbLesemarkeBanner.tsx:58`, beide in einem `onSuccess`). Vorgemerkte ETB-Einträge
zeigt die Seite aus der Queue selbst und nicht aus dem Cache. Die Frist an das Speichern zu
hängen, machte ihre Einhaltung aber davon abhängig, dass niemand künftig ein optimistisches
Update einbaut. Deshalb gilt:

- **`bestaetigtAt`** wird nur gesetzt bei `me()`-Erfolg, bei `login` und `aktualisiere`
  sowie bei einem **Fetch-Erfolg** im QueryCache. Letzterer ist ein `updated`-Ereignis mit
  `action.type === 'success'` und `action.manual !== true`. Ein `setQueryData` trägt
  `manual: true`, und `hydrate` erzeugt keine `success`-Aktion. Die beiden Bestandsstellen
  oben zählen damit bewusst nicht als Bestätigung. Sie folgen einer Mutation, und deren
  Serverantwort bestätigt die Sitzung ohnehin nicht über den Cache.
  - Beide Annahmen werden in Vitest belegt und nicht nur behauptet: `setQueryData` darf
    `bestaetigtAt` nicht bewegen, ein Fetch muss es bewegen.
- **Höchstliegezeit:** `HOECHSTLIEGEZEIT_MS = 24 h` ist eine Konstante neben der
  Entscheidungsfunktion. Die Prüfung läuft beim Start (D2). `maxAge` des Persisters steht
  zusätzlich auf demselben Wert. Da jedes Speichern nach der letzten Bestätigung liegt, ist er
  nie strenger und dient nur als zweiter Gurt.
- Eine Prüfung **während** eines laufenden Tabs gibt es nicht. Wer 24 h ohne Netz im selben
  Tab bleibt, sieht seinen Stand weiter, und zwar gekennzeichnet (D7). Beim nächsten Start
  wird verworfen. Das ist bewusst so: Ein Stand, der mitten im Einsatz unter der Hand
  verschwindet, ist gefährlicher als ein gekennzeichnet alter.

### D5 — Löschen: eine Funktion, drei Auslöser

`lagebildLoeschen(qc)`:

1. Das Speicher-Abonnement abmelden und die gedrosselte Speicherung abbrechen. Sonst
   schriebe ein noch ausstehender Durchlauf den alten Stand nach dem Löschen zurück.
2. `qc.clear()`.
3. Den Datensatz in `lifeline-lagebild` löschen.

**Aufrufer:**
- `logout()` im `finally`, vor `setBenutzer(null)`. Damit ist der 401-Pfad über die
  Sitzungswache mit abgedeckt.
- Der Benutzerwechsel in `login` und `aktualisiere`.
- Die Startentscheidung (D2), dort nur Schritt 1 und 3: Speicher siehe D2.

**`qc.clear()` räumt den ganzen Cache, nicht nur die Allowlist.** Nach dem Abmelden gehört
nichts vom alten Benutzer in den Speicher.

**Zur Auflage an `GLOBAL_KEYS`:** Die Kommentare verlangen die XOR-Partition, sobald ein
Konsument „alle Org-Keys als Menge“ braucht. `clear()` braucht keine Menge, sondern räumt
alles. Die Räumung bei Rechteentzug (D6) wählt ausschließlich **einsatzbezogene** Keys. Deren
Partition live/nicht-live ist schon maschinell erzwungen. Die Gliederung org/instanz/extern
bleibt damit weiter ohne Konsument. Beide Kommentare werden auf den neuen Stand gebracht
(„gemessen: `clear()` beim Abmelden, Einsatz-Räumung bei Rechteentzug; kein Konsument der
Org-Gliederung“), statt stillschweigend veraltet stehen zu bleiben.

### D6 — Rechteentzug im globalen Fehler-Seam

`behandleFehler` bekommt den QueryClient (Closure in `erzeugeQueryClient`) und die `query`.

- **403 oder 404 auf `EINSATZ_KEYS.einsatz`** räumt alle Keys dieses Einsatzes
  (`istKeyDesEinsatzes`).
- **403 auf einen anderen einsatzbezogenen Key** räumt alle Keys mit demselben Prefix und
  derselben `einsatzId`. „Modul“ heißt dabei Prefix. So trifft ein Entzug der Personen auch
  deren Sub-Keys.

**So wird geräumt:** Die Unterscheidung verläuft zwischen *beobachtet* und *unbeobachtet*,
nicht zwischen „scheiternd“ und „Rest“.
- **Unbeobachtete** Queries des Bereichs (`getObserversCount() === 0`) entfernt
  `qc.removeQueries({ predicate })`, nicht per Inline-Key. Der AST-Guard aus `queryKeyScan.ts`
  kennt `removeQueries`.
- **Beobachtete** Queries des Bereichs werden nie entfernt, auch die scheiternde nicht. Ein
  entfernter, aber beobachteter Key wird beim nächsten Render vom Observer neu gebaut und neu
  abgerufen. Auf der ETB-Seite hängen Liste und Zähler beide am Prefix `etb`: Das `onError` der
  Liste entfernte den Zähler, dessen Neuabruf gäbe 403, dessen `onError` entfernte die Liste,
  und so weiter. Stattdessen verlieren sie ihre Daten per
  `query.setState({ data: undefined, dataUpdatedAt: 0 })`. Die scheiternde behält Status
  `error`, eine beobachtete Geschwister-Query ihren Status.
- **Sperrmarke je Bereich** (Einsatz oder Einsatz + Prefix), die der Dehydrier-Filter
  zusätzlich zur Allowlist prüft. Eine Geschwister-Query steht nach dem Leeren auf `success`
  mit `data: undefined` und würde sonst so geschrieben. Die Marke fällt beim nächsten
  Fetch-Erfolg im Bereich (Tracker aus D4) und lebt nur im Speicher des Tabs.
  - Die Seiten sehen dann `isError && !data` und zeigen ihren Fehlerzweig statt
    „Stand veraltet“ mit alten Daten.
  - Der Einsatz landet wie bisher in der `SeitenSackgasse`.
  - Weil `status !== 'success'` gilt, wird sie ohnehin nicht geschrieben.
- Die Änderung am Cache löst das Speicher-Abonnement aus. Die Platte folgt damit innerhalb der
  Drosselung.

**Verworfen:**
- `resetQueries`: Es ruft aktive Queries neu ab, das gibt 403, dann wieder `resetQueries`, also
  eine Schleife.
- Die Räumung nur auf der Platte: Die Entscheidung des Auftraggebers lautet „Speicher und
  Platte“.

**Tests:**
- „Kein erneuter Abruf nach 403“ wird mit **zwei beobachteten Queries desselben Prefix**
  geprüft, die beide 403 liefern. Gezählt werden die Aufrufe **aller** `queryFn`, nicht nur
  der einen.
- „Einsatz 8 und ETB bleiben“ als Gegenaussage.

### D7 — Offline-Kennzeichnung am vorhandenen Datenstand

`Datenstand` zeigt ohne Verbindung „Stand 14:32 · offline“, der zugängliche Name lautet dann
„Datenstand 14:32, offline“. Das Wort ist der zweite Kanal neben der Farbe.

**Die Kennzeichnung entscheidet `Datenstand` selbst**, nicht der Aufrufer. Der Datenstand
steht im Seitenkopf (`EinsatzSeite`), in Abschnittsköpfen (`Bereichskopf`, `SektionHeader`)
und in Paneelen. Eine Kennzeichnung, die jede Stelle durchreichen muss, fehlt an der ersten
vergessenen. Gemessen: Die Aufträge führen ihren Stand im Abschnittskopf, der erste Entwurf
(nur `EinsatzSeite`) ließ sie unmarkiert. Die Prop `offline` übersteuert nur. Die Lagekarte
bekommt in ihrem eigenen Kopf einen `Datenstand` aus `gemeinsamerDatenstand` ihrer
Datenebenen, mit `platzHalten` wie der Seitenkopf. Im Snapshot-Modus hat sie keinen, dort
nennt der Historien-Banner den Stand.

**„Ohne Verbindung“ hat zwei Kanäle** (`offline/verbindung.ts`, `useOhneVerbindung`): Der
Browser ist offline **oder** der Server ist nicht erreichbar. `navigator.onLine` allein trägt
nicht. Er sagt „das Gerät hat ein Netz“, nicht „der Server antwortet“. Im Feld steht das WLAN
oft, während der Fükw-Server dahinter weg ist. Gemessen: Chromium meldet nach einem Neuladen
unter Playwrights Offline-Schalter `onLine === true`, obwohl jeder Abruf scheitert.
- **Wer meldet „nicht erreichbar“:** Der QueryClient meldet jeden Abruf, der an der Leitung
  scheitert (Netzfehler, Gateway 502/503/504), schon beim ersten Fehlversuch (`failed`),
  nicht erst nach den Wiederholungen. Dasselbe gilt für Mutationen und für die
  Sitzungsprüfung beim Start.
- **Was es aufhebt:** jeder Fetch-Erfolg.
- **Was nichts ändert:** Eine fachliche Ablehnung (403, 500) ist eine Antwort.
- Damit gilt die Kennzeichnung ausdrücklich auch für „Gerät online, Server weg“. Das
  korrigiert eine erste Fassung dieses Abschnitts, die das ausnahm.

**Gemessen wird:**
- Die Meta-Gruppe bei 390 px darf nicht umbrechen, geprüft in
  `e2e/lagebild-offline-kopf.spec.ts`.
- Das geht **ohne** Service Worker. `context.setOffline(true)` schaltet `navigator.onLine`
  im laufenden Dokument um.

Kein neuer Banner: Kopfleiste (`OFFLINE`) und `LiveStatusBanner` melden den Zustand schon.

### D8 — `gcTime` der Allowlist

Beim Standard von 5 min räumt der Speicher eine wiederhergestellte, aber gerade nicht
beobachtete Query ab. Die nächste Speicherung nähme sie dann auch von der Platte. Wer die
Lagekarte offen hat, verlöre so nach fünf Minuten den ETB-Stand. `erzeugeQueryClient` setzt
deshalb für jeden Prefix der Allowlist `setQueryDefaults(prefix, { gcTime: HOECHSTLIEGEZEIT_MS })`.
Ein eigenes `gcTime` am `useQuery` (Palette) geht weiter vor. Der Preis ist Arbeitsspeicher
für bis zu 24 h, begrenzt auf die Allowlist und die tatsächlich besuchten Einsätze.

`test/utils.tsx` bleibt bei `gcTime: 0`. Die Defaults je Prefix setzt die Fabrik nur, wenn
sie mit Produktions-Defaults gerufen wird. Wie genau das geschaltet wird, entscheidet die
Umsetzung. Die Tests des Bestands dürfen davon nichts merken.

### D9 — Lagekarte unter Messvorbehalt

Die Datenebenen stehen in der Allowlist. Ob die Karte offline zeichnet, hängt am Basisstil:

- Der Offline-Stil lädt Glyphen und Sprite vom eigenen Server.
- Der Blind-Stil (`blindStyle`) braucht gar kein Netz.

Reihenfolge der Messung im e2e:

1. Regulärer Stil offline: erscheinen die Ebenen?
2. Falls nicht: ohne Netz beim Aufbau `blindStyle` wählen. Das ist eine kleine,
   benannte Änderung in `baueBasemapStyle`. Die Karte zeigt dann ohne Netz Ebenen auf
   einfarbigem Grund statt einer Basiskarte. Das geht über die Entscheidung „zeichnet oder
   raus“ hinaus und ist deshalb zur Bestätigung vorgelegt.
3. Falls auch das nicht zeichnet: Lagekarten-Prefixe (`zonen` … `lageSnapshot`) aus der
   Allowlist nehmen, im Spec-Szenario streichen und ein Folgeticket anlegen.

Die Entscheidung des Auftraggebers vom 28.09.2026 lautet „mit Lagekarte, aber nur, wenn das
e2e sie offline tatsächlich zeichnet“.

Weil der Prod-Bundle den DEV-Haken `__lfhKarte` nicht trägt, teilt sich der Nachweis:
- **`lagebild-offline.spec.ts` (Prod, Service Worker)** belegt die Wiederherstellung der
  Kartendaten nach dem Offline-Neuladen: Kopfzahl „1 verortet“ und „Stand … · offline“.
- **`lagekarte-offline-zeichnen.spec.ts` (Dev)** baut die Karte ohne Netz neu auf. Die Daten
  kommen dort aus dem Speicher, was nach der Wiederherstellung dieselbe Lage ist. Geprüft
  wird, dass der Marker in der Quelle steht. Dazu setzt der Test einen Stil mit Glyphen und
  Sprite vom unerreichbaren Server und prüft, dass er fertig lädt, denn am `style.load` hängt
  das Anlegen der Ebenen.

**Ergebnis: Stufe 1 trägt.** Die Lagekarte bleibt im Umfang, der Blindstil-Umbau entfällt.

### D10 — e2e nach dem Precache-Muster

Neuer Spec `e2e/lagebild-offline.spec.ts`, gleicher Rahmen wie
`lagekarte-offline-precache.spec.ts`: Prod-Bundle vom e2e-Backend, `navigator.serviceWorker.ready`
und `controller` abwarten.

1. Einen Einsatz per API mit ETB-Eintrag, Person, Auftrag und Einheit anlegen.
2. ETB, Meldebild, Betroffene, Aufträge und Lagekarte online besuchen, jeweils bis Inhalt und
   „Stand“ stehen.
3. Die Drosselung abwarten, und zwar über den Datensatz in der IndexedDB, nicht über eine
   feste Pause.
4. `setOffline(true)` und jede Route neu laden. Erwartet werden Inhalt und
   „Stand HH:MM · offline“ mit der Online-Uhrzeit.
5. Zweiter Test: Abmelden. `page.evaluate` öffnet `lifeline-lagebild` und findet keinen
   Datensatz. Die Queue-DB ist unverändert.

Der Kopfkommentar von `lagekarte-offline-precache.spec.ts` („der React-Root bleibt leer“) wird
auf den neuen Stand gebracht. Eine Zusicherung darauf gibt es dort nicht, gemessen:
nur Kommentarzeile 28.

## Risks / Trade-offs

- **[PII dauerhaft auf dem Gerät]** → Bindung an `benutzer_id`, Löschen an allen Wegen hinaus
  (D5, D6), Höchstliegezeit 24 h (D4), nur die Allowlist (D3).
  - Restrisiko: Ein Gerät, das nie wieder startet, behält den Stand. Die IndexedDB ist nicht
    verschlüsselt, das ist dieselbe Lage wie bei der Offline-Queue.
  - Die übrige PII auf dem Gerät ist ein Folgeticket.
- **[Rechteentzug ohne Netz unsichtbar]** → Ohne Server keine Antwort. Das ist die
  Höchstliegezeit, so auch im Spec formuliert.
- **[Nie besuchte Ansicht offline]** → Eine kalte, pausierte Query führt auf manchen Seiten
  zum Bestandstext „Einsatz nicht gefunden oder kein Zugriff“, sobald der Einsatzkopf fehlt.
  Das kommt nur vor, wenn der Einsatz selbst nie geladen war. Wer eine Seite des Einsatzes
  besucht hat, hat auch den Kopf. Ein eigener Zustand „ohne Verbindung nicht geladen“ (Muster
  `VorschauZustand`) wäre ein Folgeticket, falls es im Feld stört.
- **[Speichern kostet bei großen Einsätzen]** → Drosselung 1 s. Das Dehydrieren eines
  ETB-Infinite-Querys mit vielen Seiten läuft auf dem Hauptthread. Messen, wenn es bei
  1 000+ Einträgen auffällt. Die Grenze ist nicht Teil dieses Change.
- **[Drosselung verliert den letzten Stand vor einem sofortigen Neuladen]** → Höchstens 1 s.
  Das e2e wartet deshalb auf den Datensatz statt auf eine Uhr.
- **[Hydrierter Stand älterer App-Version]** → Der Buster ist `__APP_VERSION__`.
- **[Mehrere Tabs]** → Jeder Tab hat seinen QueryClient und schreibt denselben Datensatz. Es
  gewinnt der zuletzt speichernde Tab. Das ist unkritisch, weil beide denselben Benutzer
  haben. Nach dem Löschen in einem Tab legt der andere den Datensatz nicht wieder an (D1,
  „Schreiben nur in einen bestehenden Datensatz“). Sein Speicher-Cache hält den Stand, bis er
  bei seinem nächsten Abruf in die 401 läuft und selbst löscht.
- **[Tab länger als 24 h ohne Netz]** → Der Stand bleibt im laufenden Tab sichtbar,
  gekennzeichnet als offline, und wird erst beim nächsten Start verworfen (D4). Das ist eine
  bewusste Abwägung und zur Bestätigung vorgelegt.

## Migration Plan

Kein Schema, kein Backend. Beim ersten Start nach dem Update gibt es keinen Datensatz, also
das bisherige Verhalten. Rückweg: Change zurücknehmen. Eine verwaiste DB `lifeline-lagebild`
bliebe dann liegen. Der Rückweg-Commit löscht sie deshalb einmalig per
`indexedDB.deleteDatabase`.
