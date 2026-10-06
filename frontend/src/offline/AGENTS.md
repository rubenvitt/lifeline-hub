# Lagebild ohne Netz lesen (LFH-723) und schreiben (LFH-705) — Regeln

Gilt für `frontend/src/offline/`, `api/queryKeys.ts`, `api/queryClient.ts` und den
`AuthProvider`, ergänzt `frontend/AGENTS.md`. Der Abschnitt „Schreiben ohne Netz“ gilt
außerdem für jede Mutation, die eine `erfasse…OfflineFaehig`-Funktion ruft, für
`api/client.ts`, für `setzeOnline` in `test/utils.tsx` und für jede Stelle, die beim Erfassen
„jetzt“ nimmt (ETB-Erfassung, Meldungsformular, `anzeige/ZeitpunktEingabe.tsx`). Pfade relativ
zu `frontend/src/`.

**Was ohne Netz lesbar bleibt, steht in der Registry, nicht im Persister:** `LAGEBILD_OFFLINE`
und `istLagebildOfflineKey` in `api/queryKeys.ts`. Das sind ETB, Meldebild, Betroffene,
Aufträge und Lagekarte samt Rahmendaten (Einsatzkopf, Modulfreigaben `modulFreigaben` — seit
LFH-669 statt der Overrides —, Einstellungen, Zähler,
Einsatzliste, Kartenkonfiguration, Organisation, Fahrzeugstatus) und die Präferenzen der Person:
ohne den Standard-Rufnamen hielte die Von/An-Pflicht jede Erfassung nach einem Kaltstart auf
(LFH-894). Von den Meldungen zählen nur die Rückmeldungen. Gespeichert wird in einer eigenen IndexedDB `lifeline-lagebild`
(`offline/lagebildSpeicher.ts`, genau ein Datensatz je Gerät), nie über Workbox auf URL-Ebene.
`lagebildOffline.guard.test.ts` vergleicht die Liste mit **jedem** verwalteten Prefix. Ein neuer
Prefix landet also nicht still auf der Platte, er muss aufgenommen oder ausdrücklich
draußen gelassen werden.

- **Die Lagekarte liest Schäden als Marker** (`schadenMarker`, LFH-931, ohne Freitexte). Beide
  Prefixe stehen in `LAGEBILD_OFFLINE`: die Marker für Karte und Dashboard, die Volltextliste für
  die Schadenseite.
- **Das ETB nur in festen Ansichten** (LFH-939, D4, Entscheidung Ruben 06.10.2026): Ein
  ETB-Key geht nur auf die Platte, wenn sein Filter allein `typ` und `limit` trägt
  (`istFesteEtbAnsicht`, Positivliste), dazu Zähler und Lesemarke. Ergebnisse freier Eingaben
  (Volltext, Zeitraum, Einheit, Nummernsprung, Bezugssuche, Lageentwicklung) bleiben draußen
  und liegen nur `ETB_FREI_GC_MS` (5 min) im Speicher: `api/queryClient.ts` ergänzt dafür
  `defaultQueryOptions`, weil `setQueryDefaults` nur per Prefix matcht. Ein eigenes `gcTime`
  des Aufrufers gewinnt. Ein neues Filterfeld kommt nur über die Positivliste offline.
- **Gedrosselt wird vor dem Dehydrieren** (LFH-939, D1): `abonnieren` hört nur auf den
  Query-Cache und übergibt dem Persister einen Erzeuger (`vormerken`); erst dessen Durchlauf
  dehydriert. Der Persister ist Single-Flight: höchstens ein laufender Schreibvorgang und ein
  wartender Erzeuger, keine `.then`-Kette. Der Vorrat schrumpft bei jeder Speicherung auf das,
  was zulässig und nicht live überdeckt ist (D3).
- **Kopf und Stand liegen getrennt** (D2): `kopf` (Identität, `bestaetigtAt`, `buster`) und
  `client`, im v1-Store; den Altdatensatz `aktuell` nehmen Anlegen und Löschen mit.
  Bestätigung und Identitätsprüfung lesen nur den Kopf, in derselben Transaktion wie das
  Schreiben (Mehrtab-Schutz). Herleitung:
  `openspec/changes/archive/2026-10-06-lfh-939-941-offline-speicher-begrenzen/design.md`.
- **Offline-Identität nur bei einem Leitungsfehler.** Scheitert `/api/auth/me` an einem
  Netzfehler oder an einer Gateway-Antwort 502/503/504, gilt der zuletzt bestätigte Benutzer
  aus dem Datensatz. Jede Antwort des Servers selbst, auch eine 500, löscht. Die Frist beträgt
  **24 h ab der letzten Serverbestätigung** (`bestaetigtAt`, bewegt nur von Fetch-Erfolgen,
  nie von `setQueryData` oder `hydrate`), nicht ab dem letzten Speichern.
- **Serverbestätigt wird nichts hydriert.** Der Stand bleibt als Vorrat und wird bei jeder
  Speicherung mit dem Live-Stand zusammengeführt (Live gewinnt, Filter bei jeder Speicherung).
  Gemessen in der CI: Ein hydrierter älterer Stand ließ die ETB-Deeplink-Logik `?eintrag=`
  räumen, bevor der neue Eintrag geladen war (`e2e/lagebild-offline-deeplink.spec.ts`).
  Hydriert wird nur ohne Serverbestätigung. `benutzer` und `laedt` wechseln serverbestätigt im
  selben Takt wie vorher: Ein Takt später färbte elf, zwei getrennte Takte sieben
  Bestandstests rot.
- **Ein Fehler mit Daten ist ein Stand.** Fällt der Server im Tab weg, behalten die Queries
  auf `error` ihren letzten Stand. Nur `success` zu schreiben nähme ihn von der Platte.
- **Gelöscht wird Speicher und Platte** bei Abmelden, 401 (über `logout()`) und
  Benutzerwechsel (`offline/lagebildSitzung.ts`). Die Offline-Queue bleibt, sie ist
  Beweissicherung. Beim **Start** löscht ein Verwerfen nur die Platte: Ein `clear()` dort
  räumte die Abfragen einer schon eingehängten Seite ab (130 rote Tests).
- **Rechteentzug im Fehler-Seam** (`api/queryClient.ts`): 403/404 auf den Einsatzkopf räumt
  den ganzen Einsatz, 403 auf einen anderen Key dessen Prefix im Einsatz. Die Trennlinie
  verläuft zwischen **beobachtet und unbeobachtet**: Beobachtete Queries verlieren nur ihre
  Daten und stehen auf `error` (`setState`), unbeobachtete werden entfernt. Entfernte beobachtete Geschwister (ETB-
  Liste und -Zähler) stießen sich sonst gegenseitig neu an, eine Abrufschleife.
  `resetQueries` scheidet aus demselben Grund aus. Eine Sperrmarke je Bereich hält die
  geleerten Queries bis zum nächsten Erfolg von der Platte, aus dem Vorrat und von der
  Offline-Wiederherstellung fern. Die läuft als eigener Schritt (Filter unmittelbar vor
  `hydrate`), nicht über `persistQueryClientRestore`.
- **Keine Mutationen, kein Einzelstand über 24 h** (`lagebildDehydrierOptionen`): Pausierte
  Mutationen trügen sonst ihre `variables` (Chat, Personen) auf die Platte.
- **„· offline“ entscheidet `Datenstand` selbst** (`useOhneVerbindung`,
  `offline/verbindung.ts`). Es gilt, wenn der Browser offline ist **oder** Abrufe an der Leitung
  scheitern. `navigator.onLine` allein trägt nicht: Chromium meldet nach einem Neuladen unter
  Playwrights Offline-Schalter `true` (gemessen), im Feld steht oft das WLAN ohne Server.
  Eine 502/503/504 **mit** dem `{error}`-Umschlag des eigenen Servers
  (`ApiError.vomAnwendungsserver`) ist keine Unerreichbarkeit, sonst setzte eine gescheiterte
  Pegel-Vorhersage die ganze App auf „offline“.
- **Die erste Speicherung erfolgt beim Abonnieren.** Das Abonnement sieht nur künftige
  Änderungen. Hatte die Seite ihre Abfragen schon fertig, blieb der Stand sonst leer
  (gemessen an der Lagekarte).
- **Testfallen:** `gcTime: 0` des Testclients räumt wiederhergestellte Einträge sofort. Wer
  sie prüft, nimmt einen eigenen `QueryClient`. Das Test-Setup räumt die Lagebild-DB ohne
  `await`, ein wartendes `afterEach` verschob den Takt zwischen Tests. Eine Mutationsprobe
  am Prod-Bundle baut mit `vite build`, nicht mit `pnpm build`: Dessen `tsc -b` bricht an
  einem ungenutzten Import ab, und `dist` bleibt still der alte Stand.
- Herleitung und Prüfspur: `openspec/changes/archive/2026-09-30-lfh-723-lagebild-offline-lesen/design.md`,
  Prüfliste `docs/superpowers/specs/2026-09-28-lfh-723-pruefliste.md`. Die übrigen Gerätedaten
  regelt der nächste Abschnitt.

## Räumen nach einer Schwärzung (LFH-996)

- **Erkannt wird an Antworten, nicht an Ereignissen:** Einsatzkopf und Einsatzliste tragen
  `teilschwaerzungen` (fehlt = 0, wächst nur). `offline/schwaerzungsWaechter.ts` hängt an jedem
  QueryClient aus `erzeugeQueryClient`, auch an gekoppelten Geräten. Ein höherer Stand setzt die
  **Räummarke** des Einsatzes (`lagebildRaeummarkeSetzen`, Geräteuhr = Zeitpunkt der Antwort),
  entfernt unbeobachtete Queries des Einsatzes und ruft beobachtete neu ab, auch Detail-Keys.
  Kein `resetQueries`. Erstes Sehen (Abruf, `hydrate`, Vorrat) merkt nur den Stand.
- **Die Marke gilt in `lagebildStandZulaessig`:** ein Stand vor ihr kommt nicht auf die Platte,
  nicht aus dem Vorrat und nicht ins `hydrate`. `abonnieren` belegt den Wächter aus dem Vorrat
  vor, sonst fiele eine Schwärzung zwischen zwei Sitzungen nicht auf.
- **Ein Einsatz, den die vorige Liste kannte und die neue nicht, wird geräumt wie beim 404 auf
  den Kopf** (Sperrmarke, unbeobachtete weg, der beobachtete Kopf lädt neu). Ohne vorige Liste
  wird nichts geräumt; `clear()` vergisst sie.
- Die Offline-Queue und die ETB-Entwürfe bleiben (eigene Eingaben, Beweissicherung).
- Herleitung: `openspec/changes/archive/2026-10-05-lfh-996-schwaerzung-clients-raeumen/design.md`.

## Gerätedaten beim Abmelden (LFH-767)

- **Jeder Speicherort steht in `GERAETESPEICHER`** (`offline/geraetRaeumung.ts`) mit
  Entscheidung und Grund. `geraetRaeumung.guard.test.ts` findet jede Datei, die `openDB`
  aufruft oder in `localStorage`/`sessionStorage` schreibt, und wird ohne Eintrag rot.
- **Grundsatz:** Was der Server wieder liefern kann, geht bei jedem Ausgang (Quittungen,
  Ortscache, Erfassungswerte). Was nur auf dem Gerät liegt (ETB-Entwürfe), überlebt ein
  Sitzungsende, gebunden an `benutzer_id` und ohne angemeldeten Besitzer höchstens 24 h. Die
  Offline-Queue bleibt immer. Geräte-Einstellungen ohne Personenbezug bleiben.
- **Ein Weg hinaus:** `abmeldenLokal(anlass)` im `AuthProvider` ruft nach `lagebildLoeschen`
  `geraetRaeumen(anlass)`. `logout()` übergibt `'abmelden'`, die beiden 401-Wege
  `'sitzungsende'`; eine 401 schon beim Start räumt mit demselben Anlass. Nach Start und jeder Anmeldung räumt `geraetFuerBenutzerRaeumen` fremde und
  abgelaufene Daten. Beide werfen nie, jeder Ort wird einzeln versucht, und **keiner wird abgewartet**: Ein Tab mit altem Bundle hält eine DB im alten Schema offen, dann hinge das Upgrade und mit ihm der Login (`auth/geraetRaeumung.haengt.test.tsx`). Die Kanalmeldung `abgemeldet` trägt den Anlass, damit andere Tabs beim Abmelden auch die Entwürfe räumen.
- **Während der Sitzung begrenzt** (LFH-941): Die Personen-Erfassungsquittung trägt nur
  `person_id` und `registrier_nr` (Bestand wird beim Öffnen und beim Lesen gekürzt); die
  Personenseite holt die Person aus dem Cache. Der Ortscache (`{ name, at }`) löscht
  beim Öffnen, was älter als 30 Tage ist, und hält höchstens 5 000 Einträge. Leere Entwürfe:
  `etb/AGENTS.md`. Der Queue-Zähler zählt Altzeilen per `count()` ohne Payload, der Hook lädt
  höchstens einmal je `ZAEHLER_DROSSEL_MS` (LFH-939, D5). Herleitung: `openspec/changes/archive/2026-10-06-lfh-939-941-offline-speicher-begrenzen/design.md`.
- **Kein IndexedDB-Versionssprung ohne Not** (LFH-941, D9): Ein Tab mit altem Bundle hält die
  alte Version offen, das Upgrade im neuen Tab hinge, mit ihm Anmeldung, Queue oder
  Ortsvorschau. Neuer Inhalt geht in die bestehenden Stores, der Bestand wird beim Öffnen
  umgeschrieben und beim Lesen toleriert. `lifeline-lagebild`, `lifeline-offline` und
  `lifeline-ortcache` tragen einen `blocking`-Handler (Verbindung schließen und vergessen), damit
  ein künftiges Upgrade nicht auf sie wartet; Nachweis je DB ein Test, der aus einem zweiten
  Öffner hochstuft.
- **Testfalle:** Ein Räumtest liest die Platte über `test/rohIdb.ts` (eigene Verbindung), nicht
  über die Modulfunktionen — ein Index blendet fremde Zeilen nur aus.
- Herleitung: `openspec/changes/archive/2026-10-02-lfh-767-geraet-raeumung-abmelden/design.md`.

## Schreiben ohne Netz (LFH-705)

- **Eine Mutation, die eine `erfasse…OfflineFaehig`-Funktion aus `offline/schreiben.ts` ruft,
  läuft mit `networkMode: 'always'`.** Die Funktion entscheidet selbst, ob sie sendet oder
  vormerkt. TanStacks Vorgabe `'online'` hielte die Mutation ohne Netz an: Dann erschiene
  nie „Offline vorgemerkt“, und nach der Rückkehr des Netzes ginge die Erfassung online
  hinaus. Bis LFH-705 galt das für alle fünf solchen Mutationen.
- **Seitentests schalten offline über `setzeOnline` (`test/utils.tsx`)**, nicht nur über
  `navigator.onLine`. Ein Browser führt beim Ereignis `offline` auch TanStacks `onlineManager`
  nach. Der alte Testaufbau blieb gegen den Fehler grün. Geladen wird dabei online, dann fällt
  das Netz weg.
- **Der Erfassungszeitpunkt (`zeitpunkt_at`) einer vorgemerkten Stand- oder
  Belegungsmeldung gilt nach der Serveruhr** (`serverJetzt()` aus `offline/serveruhr.ts`,
  Versatz aus dem `Date`-Header jeder Antwort von `apiGet`, `apiSend` und `apiUpload`). Ohne
  frischen Versatz gilt die Geräteuhr. Herleitung:
  `openspec/changes/archive/2026-10-01-lfh-705-serveruhr-versatz-offline/design.md`.
- **„Jetzt“ beim Erfassen gilt nach der Serveruhr** (LFH-895), online wie offline: die
  vorbelegte Ereigniszeit von ETB-Eintrag (samt `erfasst_lokal_at`) und Meldung, der Vorschlag
  im Zeit-Chip der ETB-Erfassung, der Knopf „Jetzt“ jeder `ZeitpunktEingabe`, die Bausteine
  `{datum}`/`{uhrzeit}` und der Nachtrag der Kräfte-Zeitachse. Alle nehmen `serverJetzt()`, nie
  `dayjs()`, damit „Chip öffnen, OK“ und „Chip weglassen“ dieselbe Zeit ergeben. Eine
  Zukunftsprüfung im Client an einer Zeiteingabe misst an derselben Uhr, sonst fällt „Jetzt“ auf
  einem nachgehenden Gerät durch. Eine eingetragene Zeit geht unverändert hinaus. Der Server
  begrenzt ETB- und Meldungs-Ereigniszeiten bewusst nicht. Weitere Vorbelegungen aus `dayjs()`
  sind offen (LFH-1031). Herleitung:
  `openspec/changes/archive/2026-10-04-lfh-895-ereigniszeit-serveruhr/design.md`.
