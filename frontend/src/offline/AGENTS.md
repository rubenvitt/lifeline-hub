# Lagebild ohne Netz lesen (LFH-723) und schreiben (LFH-705) — Regeln

Gilt für `frontend/src/offline/`, `api/queryKeys.ts`, `api/queryClient.ts` und den
`AuthProvider`, ergänzt `frontend/AGENTS.md`. Der Abschnitt „Schreiben ohne Netz“ gilt
außerdem für jede Mutation, die eine `erfasse…OfflineFaehig`-Funktion ruft, für
`api/client.ts` und für `setzeOnline` in `test/utils.tsx`. Pfade relativ zu `frontend/src/`.

**Was ohne Netz lesbar bleibt, steht in der Registry, nicht im Persister:** `LAGEBILD_OFFLINE`
und `istLagebildOfflineKey` in `api/queryKeys.ts`. Das sind ETB, Meldebild, Betroffene,
Aufträge und Lagekarte samt Rahmendaten (Einsatzkopf, Freigaben, Einstellungen, Zähler,
Einsatzliste, Kartenkonfiguration, Organisation, Fahrzeugstatus). Von den Meldungen zählen nur
die Rückmeldungen. Gespeichert wird in einer eigenen IndexedDB `lifeline-lagebild`
(`offline/lagebildSpeicher.ts`, genau ein Datensatz je Gerät), nie über Workbox auf URL-Ebene.
`lagebildOffline.guard.test.ts` vergleicht die Liste mit **jedem** verwalteten Prefix. Ein neuer
Prefix landet also nicht still auf der Platte, er muss aufgenommen oder ausdrücklich
draußen gelassen werden.

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
- **Offen:** die übrigen personenbezogenen Daten auf dem Gerät (LFH-767). Herleitung und
  Prüfspur: `openspec/changes/archive/2026-09-30-lfh-723-lagebild-offline-lesen/design.md`, Prüfliste
  `docs/superpowers/specs/2026-09-28-lfh-723-pruefliste.md`.

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
  frischen Versatz gilt die Geräteuhr. Die Ereigniszeit von Meldung und ETB-Eintrag kommt
  weiter aus der Geräteuhr; ob sie umgerechnet wird, ist offen (LFH-895). Herleitung:
  `openspec/changes/lfh-705-serveruhr-versatz-offline/design.md`.
