# Tasks

Jede Aufgabe mit fachlicher Logik entsteht testgetrieben (`superpowers:test-driven-development`):
zuerst der rote Test, dann der Code. Die Mutationsproben stehen jeweils an der Aufgabe, deren
Aussage sie belegen.

## 1. Abhängigkeit und Speicherschicht

- [x] 1.1 `@tanstack/query-persist-client-core` exakt auf die installierte `@tanstack/query-core`-Version pinnen (`mise exec pnpm@11.10.0 -- pnpm -C <abs>/frontend add -E …`). Prüfen: Lockfile zeigt genau eine `query-core`-Version, `scripts/check-deps.sh` bleibt grün.
- [x] 1.2 `offline/lagebildSpeicher.ts`: DB `lifeline-lagebild` über `idb`, Store `stand`, Datensatz `'aktuell'` mit `{ benutzer, bestaetigtAt, buster, client }`, dazu `lesen`/`schreiben`/`loeschen`. Prüfen: Vitest mit `fake-indexeddb` (liegt es nicht vor, als Dev-Abhängigkeit exakt gepinnt ergänzen); Schreiben → Lesen gibt denselben Datensatz zurück, Löschen → `undefined`; die DB `lifeline-offline` wird nicht angefasst.
- [x] 1.3 Persister (`Persister`-Interface) mit abbrechbarer 1-s-Drosselung. Er legt keinen Datensatz an, sondern schreibt nur in einen bestehenden derselben `benutzer.id` (design.md D1). Prüfen: Vitest unter Fake-Timern. Zwei Speicherungen innerhalb 1 s ergeben einen Schreibvorgang. Nach `abbrechen()` schreibt ein ausstehender Durchlauf **nichts** mehr. Ohne vorhandenen Datensatz (anderer Tab hat gelöscht) schreibt `persistClient` nichts. Ohne IndexedDB (Zugriff wirft) gibt es keinen Fehler nach außen. Mutationsprobe: Ohne Abbruch bzw. ohne Existenzprüfung wird der jeweilige Test rot.

## 2. Allowlist in der Registry

- [x] 2.1 `LAGEBILD_OFFLINE` und `istLagebildOfflineKey(key)` in `api/queryKeys.ts` nach design.md D3 anlegen. Die Rückmeldungen laufen als Sub-Key-Regel, die Meldungsliste bleibt draußen. Prüfen: Unit-Tests je Zweig, darunter `['einsatz-meldungen', 7, 'rueckmeldungen']` ja und `['einsatz-meldungen', 7]` nein.
- [x] 2.2 Guard `api/lagebildOffline.guard.test.ts`: Er baut einen Erfolgsstand für jeden Prefix aus `EINSATZ_KEYS` und `GLOBAL_KEYS`, dehydriert mit dem Persister-Filter und vergleicht die geschriebenen Prefixe exakt mit der Allowlist. Ein Fehler- und ein Ladezustand eines gelisteten Keys werden nicht geschrieben. Prüfen: grün, und zwei Mutationsproben (zusätzlicher Prefix, `shouldDehydrateQuery: () => true`) färben ihn rot.
- [x] 2.3 Die beiden Auflage-Kommentare in `queryKeys.ts` (`istKeyDesEinsatzes`, Kopf `GLOBAL_KEYS`) auf den gemessenen Stand bringen: `clear()` beim Abmelden, Einsatz-Räumung bei Rechteentzug, kein Konsument der Org-Gliederung (design.md D5). Prüfen: `pnpm lint` und `queryKeys.guard.test.ts` grün.

## 3. Bestätigung, Liegezeit und `gcTime`

- [x] 3.1 `HOECHSTLIEGEZEIT_MS` (24 h) und die reine `startEntscheidung(meErgebnis, datensatz, jetzt, buster)` nach der Tabelle in design.md D2. Prüfen: ein Vitest-Fall je Tabellenzeile, dazu die Grenze genau 24 h (noch gültig) gegen 24 h + 1 ms (verworfen).
- [x] 3.2 Den Bestätigungs-Tracker am QueryCache bauen: `bestaetigtAt` bewegt sich nur bei `success` ohne `manual` (design.md D4). Prüfen: Vitest. Ein Fetch-Erfolg bewegt den Zeitstempel. `setQueryData` bewegt ihn **nicht**. `hydrate` bewegt ihn **nicht**. Mutationsprobe: Ohne `manual`-Prüfung wird der zweite Fall rot.
- [x] 3.3 `erzeugeQueryClient` setzt für jeden Allowlist-Prefix `gcTime = HOECHSTLIEGEZEIT_MS`, aber nur mit Produktions-Defaults (design.md D8). Prüfen: `api/queryClient.test.ts` pinnt den Wert für einen gelisteten und die Abwesenheit für einen ungelisteten Prefix. Die volle Vitest-Suite bleibt grün (`test/utils.tsx` unverändert bei `gcTime: 0`).

## 4. Identität, Wiederherstellen und Löschen im AuthProvider

- [x] 4.1 `lagebildLoeschen(qc)` in der Reihenfolge Abonnement abmelden → Drosselung abbrechen → `qc.clear()` → Datensatz löschen. Prüfen: Vitest gegen die IndexedDB selbst (nicht gegen den Speicher-Cache). Nach dem Löschen und dem Ablauf der Drosselung ist der Datensatz weiter leer. Die Offline-Queue behält einen vorab abgelegten Eintrag.
- [x] 4.2 `AuthProvider`-Start nach `startEntscheidung`: `laedt` bleibt bis zum Ende der Wiederherstellung `true`, danach startet das Speicher-Abonnement. Ein `NetzFehler` mit gültigem Datensatz setzt `benutzer` aus dem Datensatz. Prüfen: `AuthContext.test.tsx` mit gemocktem `me()`, je ein Fall für Netzfehler mit gültigem, veraltetem und fehlendem Datensatz, für 401 und für eine andere `benutzer.id`. Zusätzlich die Aussage: Bei 401 und bei einer anderen Person erreicht kein Eintrag des Datensatzes den QueryCache. `AuthProvider` braucht jetzt `useQueryClient`. Alle Testdateien, die ihn einhängen, prüfen (rund 60, die meisten über `test/utils.tsx` mit `QueryClientProvider`). Die volle Vitest-Suite bleibt grün, auch ohne IndexedDB in jsdom.
- [x] 4.3 `logout()` ruft `lagebildLoeschen` im `finally` auf. `login()` und `aktualisiere()` löschen bei einer anderen `benutzer.id` und setzen `bestaetigtAt`. Prüfen: Vitest. Abmelden leert die DB auch bei scheiterndem Server-Logout. Benutzer B nach A findet nach dem Neu-Einhängen des Providers keinen Stand von A. Die Sitzungswache (401) führt über `logout()` zum selben Ergebnis.

## 5. Rechteentzug

- [x] 5.1 `behandleFehler` bekommt QueryClient und Query. 403/404 auf `einsatz` räumt alle Keys des Einsatzes, 403 auf einen anderen einsatzbezogenen Key räumt dessen Prefix für diesen Einsatz. Unbeobachtete Queries des Bereichs werden entfernt, beobachtete (auch die scheiternde) verlieren nur ihre Daten per `setState`. Dazu kommt eine Sperrmarke je Bereich im Dehydrier-Filter bis zum nächsten Fetch-Erfolg (design.md D6). Prüfen: `api/queryClient.test.ts`. (a) Einsatz 7 geräumt, Einsatz 8 bleibt. (b) Personen-403 räumt nur Personen, das ETB bleibt. (c) **Zwei beobachtete Queries desselben Prefix** liefern beide 403, und die Aufrufe **aller** `queryFn` bleiben bei der Zahl, die die Retry-Regel vorgibt (keine Schleife). Mutationsprobe: Beobachtete per `removeQueries` räumen → rot. (d) Die scheiternde Query steht auf `isError && data === undefined`. (e) Eine geleerte Geschwister-Query wird trotz `success` nicht geschrieben (Sperrmarke), nach einem neuen Fetch-Erfolg wieder schon. (f) Eine 401 räumt hier nichts, weil sie weiter zur Sitzungswache geht.
- [x] 5.2 Seitenverhalten nach 403 prüfen: Personen- und ETB-Seite zeigen ihren Fehlerzweig statt „Stand veraltet“ mit alten Daten. Prüfen: je ein Vitest in `PersonenPage.test.tsx`/`EtbPage.test.tsx` mit 403 nach vorherigem Erfolg.

## 6. Offline-Kennzeichnung

- [x] 6.1 `Datenstand` nimmt `offline?: boolean` an, Text „Stand HH:MM · offline“, zugänglicher Name „Datenstand HH:MM, offline“. `EinsatzSeite` setzt die Prop zentral aus `useOnline()`. Prüfen: Vitest für `Datenstand` (beide Zustände, Name) und für `EinsatzSeite` (Ereignis `offline` → Suffix, `online` → weg).
- [x] 6.2 Die Lagekarte bekommt im eigenen Kopf einen `Datenstand` (`gemeinsamerDatenstand` der Datenebenen, `platzHalten`, `offline`). Prüfen: Vitest an `LagekartePage` bzw. am Kopfbaustein.
- [x] 6.3 Layout bei 390 px: Die Meta-Gruppe mit „Stand HH:MM · offline“ bricht nicht um, und der Rest der Seite springt nicht. Prüfen: e2e-Fall in `e2e/leisten-flaeche.spec.ts` (oder daneben) mit `context.setOffline(true)` im Dev-Server, gemessen nach `document.fonts.ready`.
- [x] 6.4 Prüfliste Einsatztauglichkeit (15 Kriterien) für die berührten Kopfzeilen anlegen: `docs/superpowers/specs/2026-09-28-lfh-723-pruefliste.md`, jede Zeile mit Verdikt. Prüfen: keine Zeile „nicht geprüft“.

## 7. Nachweis ohne Netz (e2e) und Lagekarten-Entscheidung

- [x] 7.1 `e2e/lagebild-offline.spec.ts` nach design.md D10. Prod-Bundle vom Backend, SW `ready` + `controller`, Einsatz mit ETB-Eintrag, Person, Auftrag und Einheit per API. ETB, Meldebild, Betroffene und Aufträge online besuchen, auf den Datensatz in `lifeline-lagebild` warten, `setOffline(true)`, jede Route neu laden. Prüfen: Inhalt sichtbar und „Stand HH:MM · offline“ mit der Online-Uhrzeit. Vorbedingungen als `expect` gegen stilles Grün: Der Datensatz ist vor dem Offline-Schalten da, `/api/health` scheitert offline.
- [x] 7.2 Lagekarte im selben Spec messen (design.md D9, Stufe 1 → 2 → 3). Prüfen: Die Seitenleiste listet offline die Objekte des Einsatzes, der Datenstand trägt „offline“. **Ergebnis (28.09.2026): Stufe 1 trägt**, die Lagekarte bleibt im Umfang, kein Blindstil-Umbau. Ohne Netz neu aufgebaut, zeichnet sie ihre Marker, und ein Stil mit Glyphen und Sprite vom unerreichbaren Server lädt fertig (`e2e/lagekarte-offline-zeichnen.spec.ts`, Dev-Server wegen `__lfhKarte`). Trägt Stufe 2 den Nachweis, wird die `blindStyle`-Wahl ohne Netz in `baueBasemapStyle` mit Vitest-Pin eingebaut. Trägt auch Stufe 2 ihn nicht, werden die Lagekarten-Prefixe aus der Allowlist genommen (Guard 2.2 anpassen), das Spec-Szenario gestrichen und ein Folgeticket über `clickup-task-anlegen` angelegt.
- [x] 7.3 Zweiter Test im Spec: Abmelden. `page.evaluate` findet in `lifeline-lagebild` keinen Datensatz, die DB `lifeline-offline` ist unverändert. Prüfen: grün. Mutationsprobe: Ohne den Aufruf in `logout()` wird der Test rot.
- [x] 7.4 Den Kopfkommentar von `e2e/lagekarte-offline-precache.spec.ts` auf den neuen Stand bringen („Root bleibt leer“ gilt nicht mehr). Prüfen: Die Spec bleibt grün.

## 8. Doku, Folgeticket, Abschluss

- [x] 8.1 CLAUDE.md: Absatz „Lagebild offline lesen (LFH-723)“ im Frontend-Teil. Er nennt Allowlist in der Registry, Identität nur bei Netzfehler, 24 h ab Serverbestätigung, Löschwege, Rechteentzug per `setState` statt `resetQueries` und die Lagekarten-Entscheidung, mit Verweis auf dieses design.md. Prüfen: `prettier --check` grün, die Verweise zeigen auf existierende Pfade.
- [x] 8.2 Folgeticket „Übrige PII auf dem Gerät räumen“ (Personen-Quittungen der Queue, ETB-Entwürfe, Ortscache, `localStorage`) über `clickup-task-anlegen` erfassen und die Nummer in design.md unter Non-Goals nachtragen. Prüfen: Das Ticket steht auf dem Entwicklungsboard.
- [ ] 8.3 Gesamtlauf `./scripts/check-all.sh` (ohne `| tail`, Log nach „ÜBERSPRUNGEN“ durchsuchen, damit e2e und die Precache-Specs wirklich liefen). Prüfen: Exit 0.
  - **Stand 28.09.2026 (nach Rebase auf `origin/alpha`):** Die Schritte 1 bis 6 und 8 bis 10 sind grün (Rust, Vitest mit 6797 Tests, Advisories, Migrationen), nichts wurde übersprungen, der Prod-Bundle wurde neu gebaut. In Schritt 7 (e2e) sind 327 grün und 1 rot, nämlich `uhs-grundriss-touch.spec.ts:571`. Der Fehler **besteht schon auf `alpha`**: Im Wegwerf-Worktree waren dort 8 von 15 Läufen rot, auf dem Branch 7 von 15. Er ist als LFH-768 erfasst. Exit 0 steht deshalb aus. Offen bleibt diese Aufgabe, bis LFH-768 behoben ist oder ein Lauf ohne den Ausreißer durchgeht.
