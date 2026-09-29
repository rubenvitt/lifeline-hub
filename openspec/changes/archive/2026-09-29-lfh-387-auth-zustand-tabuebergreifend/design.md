# Design

## Context

- Sitzung: ein `HttpOnly`-Cookie für den ganzen Origin (`src/auth/session.rs`). Jeder
  authentifizierte Handler löst den Benutzer über den Extractor `CurrentUser` auf; `AdminUser`
  und `EinsatzKontext` (`src/einsatz/kontext.rs`) rufen ihn intern.
- LFH-334 hat einen **optionalen, strikten** Kopf `X-Offline-Queue-Benutzer-Id` eingeführt
  (`routes::support::fordere_offline_queue_benutzer`, 412 `OfflineQueueBenutzerMismatch`),
  aber nur an fünf offlinefähigen Routen. 401 bleibt echten Auth-Fehlern vorbehalten, damit
  ein veralteter Tab die neue Sitzung nicht über die Sitzungswache abmeldet.
- Frontend: `AuthProvider` hält `benutzer` pro Tab, lädt ihn einmal über `GET /api/auth/me`.
  Die Sitzungswache (`auth/useSitzungsWache.ts`) ruft bei 401 `logout()` — also
  `POST /api/auth/logout` mit dem **aktuellen** Cookie. Alle Schreibwege laufen über
  `apiSend`/`apiUpload` in `api/client.ts` (ein weiterer `fetch` in `api/kartenbilder.ts` ist
  ein GET).

## Goals / Non-Goals

**Goals:**
- Die Zusicherung „kein Schreiben unter fremder Sitzung“ hängt am **Server**, nicht an der
  Laufzeit einer Tab-Nachricht. Die Tab-Meldungen sind Bedienkomfort, nicht Sicherheit.
- Ein Muster für alle Schreibrouten, ohne jede Route anzufassen.

**Non-Goals:**
- Lesende Anfragen binden (ein veralteter Tab kann bis zur Prüfung Daten unter B lesen; die
  Prüfung beim Wieder-Sichtbarwerden und nach jeder Meldung schließt das Fenster praktisch).
  SSE (`EventSource`) kann ohnehin keinen Kopf setzen.
- Mehrere gleichzeitige Sitzungen pro Browser (Cookie je Tab) — widerspräche dem Cookie-Modell.
- Entwürfe des bisherigen Benutzers retten; der Dialog erklärt, dass nichts mehr unter A
  gespeichert wird.

## Decisions

**D1 — Prüfung im `CurrentUser`-Extractor, nicht als Middleware und nicht je Route.**
`CurrentUser::from_request_parts` kennt nach der Sitzungsauflösung Methode und Köpfe. Bei
nicht-sicherer Methode (alles außer GET/HEAD/OPTIONS) und vorhandenem Kopf
`X-Erwarteter-Benutzer-Id` vergleicht er mit `benutzer.id`; ungültig oder abweichend →
`AppError::SitzungsBenutzerMismatch` (412). Reihenfolge: erst Sitzung (401), dann Kopf (412) —
so bleibt 401 für tote Sitzungen stehen. Weil `AdminUser` und `EinsatzKontext` über
`CurrentUser` laufen, greift das für jede authentifizierte Schreibroute, vor jedem
Handler-Body und damit vor jedem Idempotenz-Lookup.
*Alternativen:* Middleware über `/api` — bräuchte eine zweite Sitzungsabfrage je Anfrage.
Je-Route-Aufruf wie LFH-334 — skaliert nicht, jede neue Route wäre eine Lücke.
Die Tests aus D9 belegen die Abdeckung an Stichproben aus allen drei Extractor-Familien.

**D2 — Eigener Kopf und eigene Fehlervariante neben dem Queue-Kopf.**
Der Queue-Kopf bindet einen **Eintrag** an seinen Urheber (kann vom angezeigten Benutzer
abweichen, wenn der Tab zu B gewechselt hat und die Queue von A sieht); der neue Kopf bindet den
**Tab**. Beide bleiben, beide 412. Eigene Meldung „Die Sitzung gehört inzwischen einem anderen
Benutzer“, damit Logs und Fehlertexte unterscheidbar sind. Der Client muss die beiden 412 nicht
unterscheiden (s. D4).

**D3 — Logout prüft den Kopf selbst.** `logout` nutzt keinen `CurrentUser` (er muss auch mit
toter Sitzung das Cookie räumen). Neu: Kopf vorhanden **und** Sitzung gültig **und** Benutzer
abweichend → 412, Sitzung und Cookie bleiben. Tote Sitzung → wie heute 204 + Cookie weg.

**D4 — Frontend: der Client trägt den Kopf, der AuthProvider setzt den Wert.**
`api/client.ts` hält modulweit `erwarteterBenutzer: number | null` (Setter
`setzeErwartetenBenutzer`), `apiSend`/`apiUpload` setzen den Kopf bei nicht-GET, wenn gesetzt.
Der `AuthProvider` setzt den Wert **synchron** an denselben Stellen wie `setBenutzer`
(Hilfsfunktion `uebernimm(b)`), nicht in einem Effekt — sonst gäbe es ein Render-Fenster mit
altem Wert. Jede 412-Antwort löst im Client das Fensterereignis `lfh:benutzer-pruefen` aus
(Muster wie `lfh:sitzung-abgelaufen`); der AuthProvider prüft daraufhin per `me()`. Damit
braucht der Client die beiden 412-Arten nicht zu trennen: bei einem Queue-412 ergibt die
Prüfung „gleicher Benutzer“ und nichts passiert.

**D5 — Tab-Meldungen über `BroadcastChannel('lfh-auth')`, Prüfung als Wahrheit.**
Neues `auth/authKanal.ts`: `meldeAuthWechsel({ art: 'angemeldet' | 'abgemeldet' })` und
`abonniereAuthWechsel(cb)`; ohne `BroadcastChannel` No-op. Die Nachricht trägt keine
Benutzerdaten — jeder Empfänger prüft selbst per `me()` (D6). Zusätzlich prüft der Tab bei
`visibilitychange` → sichtbar; das deckt eingefrorene/verworfene Tabs und Browser ohne Kanal.
*Alternative:* `storage`-Ereignis über `localStorage` — funktioniert, ist aber ein Umweg und
hinterlässt Schlüssel; `BroadcastChannel` ist in allen Zielbrowsern vorhanden.
*Nachtrag Umsetzung:* Senden und Empfangen laufen über EIN Kanalobjekt je Tab. Ein
`BroadcastChannel` stellt sich selbst nichts zu, ein zweites Objekt desselben Tabs dagegen
schon; mit getrennten Objekten prüfte sich der meldende Tab nach jedem Login selbst (im Vitest
rollte das einen frischen Login zurück). Folge für Tests: zwei `AuthProvider` im selben Realm
hören einander nicht — der zweite Tab wird im Vitest als eigenes Kanalobjekt simuliert, echte
zwei Tabs prüft e2e.

**D6 — Eine Prüfroutine `pruefe()` im AuthProvider** mit der Ergebnistabelle aus der Spec.
Läuft nur nach dem Erstladen (`laedt === false`), Aufrufe werden zu einem laufenden
zusammengefasst (ein `useRef<Promise>`) — mit genau einem Nachlauf, wenn während des Laufs ein
weiterer Anstoß kam: der Lauf kann eine Antwort von vor dem gemeldeten Wechsel bekommen haben. 401 → `abmeldenLokal()` + `meldeSitzungAbgelaufen()`
(bestehende Wache leitet mit Rückkehr-URL um). Netzfehler → nichts. Der Konflikt steht als
`konflikt: { bisher, jetzt } | null` im Context; `erwarteterBenutzer` bleibt auf `bisher`.
*Nachtrag Umsetzung (Review):* Ein Generationszähler in `uebernimm` markiert jeden
Benutzerwechsel; Erstladen und Prüfung verwerfen eine `/me`-Antwort, die vor einem Wechsel
angefragt wurde, und prüfen nach. Anstöße während des Erstladens werden vorgemerkt und danach
nachgeholt. Ein `weiterAls()` im Context gibt es nicht (s. D8).

**D7 — Logout-Pfade.**
- `logout()` (Knopf): Server-Logout mit Kopf. 412 → nicht lokal abmelden, `pruefe()` zeigt den
  Konflikt. Sonst wie heute „wirft nie, lokal immer abmelden“, dann `meldeAuthWechsel`.
- `abmeldenLokal()` (neu): nur Zustand räumen + Meldung. Die Sitzungswache nimmt diese statt
  `logout()` — der Server-Logout nach 401 traf in der Lücke „401 → Logout“ eine inzwischen
  neue Sitzung.
- `login`/`aktualisiere` melden `angemeldet`.

**D7a — Anmeldeseite folgt einer Übernahme.** Übernimmt der Provider eine Anmeldung aus einem
anderen Tab, verlässt `LoginPage` die Maske zum Rückkehrziel — nur beim Übergang „anonym →
angemeldet“. Wer angemeldet `/login` öffnet, um den Benutzer zu wechseln, bleibt dort; genau
dieser Weg erzeugt den Konflikt in den übrigen Tabs. `BenutzerMenu` navigiert nur, wenn
`logout()` `true` liefert.

**D8 — Konfliktdialog im Sitzungs-Layout.** `auth/BenutzerKonfliktDialog.tsx` neben
`useSitzungsWache`. antd `Modal` mit `closable={false}`, `keyboard={false}`,
`mask={{ closable: false }}`, eigener Fuß mit genau einem Primärknopf. „Als B weiterarbeiten“
lädt `/einsaetze` NEU (`auth/seiteNeuLaden.ts`), statt den Benutzer im laufenden Baum
umzustellen. *Nachtrag Umsetzung (Review):* Beim Umstellen im Baum bliebe die Seite von A
montiert; ihr Navigationsschutz hielte den Seitenwechsel an, und Autosave oder „Speichern und
weiter“ schrieben ihren Entwurf mit der Kennung von B — der Server nähme ihn an. Beim Neuladen
trägt alles, was die alte Seite noch absenden will, die Kennung von A und scheitert mit 412.
Der Offline-Abgleich ruht während des Konflikts (`abgleichFuer` in `offline/useOfflineSync.ts`),
sonst liefe er alle 30 s gegen 412 und stieße jedes Mal eine Prüfung an; der Dialog sagt, dass
vorgemerkte Einträge bei A bleiben. Kein Erfassungsformular, daher nicht `Erfassung.tsx`.

**D9 — Tests.**
- Rust `tests/sitzung_benutzerwechsel.rs`: Paare je Extractor-Familie (Einsatzmodul-Schreibroute
  über `EinsatzKontext`, Admin-Route über `AdminUser`, Profil-Route über `CurrentUser`): Kopf
  passend → 2xx, abweichend → 412 **und** kein Datensatz, ungültiger Wert → 412, fehlend → 2xx,
  tote Sitzung + Kopf → 401. Logout: abweichend → 412, Sitzung lebt (`/me` mit dem Cookie →
  200), passend → 204. Unit-Test in `session.rs` für GET mit abweichendem Kopf → kein 412.
- Vitest: `authKanal` (zwei Kanäle im selben Realm), `client` (Kopf an POST/Upload, nicht an
  GET, 412 feuert das Ereignis), `AuthContext` (Ergebnistabelle aus D6, Logout-412 räumt nicht,
  Wache ruft keinen Server-Logout), Dialog (nicht schließbar, eine Primäraktion, räumt Cache).
- e2e `e2e/sitzung-mehrere-tabs.spec.ts`: **zwei Seiten im selben Browserkontext** (geteiltes
  Cookie, geteilter Kanal). Zweiter Benutzer per `POST /api/benutzer`. Fälle: (a) schneller
  Wechsel A→B über die Oberfläche in Tab 2 (Anmeldeseite, ohne vorheriges Abmelden) → Tab 1
  zeigt den Dialog; (b) gleichzeitige
  Mutation: B meldet sich per `context.request` an (kein App-Code, also keine Meldung),
  Tab 1 sendet einen ETB-Eintrag → Antwort 412, kein Eintrag, Dialog, B bleibt angemeldet;
  (c) Sitzungsablauf: Logout per `context.request`, Tab 1 schreibt → Anmeldung mit
  Rückkehrziel, Tab 2 folgt ohne Neuladen.

**Nachtrag Zusammenführung mit LFH-723 (Lagebild offline lesen, 29.09.2026).** Beide
Änderungen fassen `AuthProvider` an. Es gilt: `abmeldenLokal` setzt den Benutzer zuerst (und
damit den erwarteten Benutzer der Schreibanfragen) und räumt danach das Lagebild, Speicher und
Platte; ein Fehler beim Löschen hält die Abmeldung nicht auf. `logout()` bei 412 räumt
**nichts** — der Datensatz gehört dann der neuen Sitzung (`AuthContext.pruefen.test.tsx`, mit
Gegenprobe). Übernimmt ein anonymer Tab die Sitzung eines anderen Tabs, läuft das wie ein Login
über `lagebildAnmelden`. Das Erstladen folgt dem Ablauf aus LFH-723 (Sitzungsprüfung, dann
`lagebildStarten`); jeder Schritt übernimmt nur, solange die Generation seine eigene ist. Ein
Tab im Konflikt schreibt nicht in den Datensatz von B: der Persister ändert nur einen Satz
desselben Benutzers (`lagebildSpeicher.bestehendenAendern`).

## Risks / Trade-offs

- [Ein Aufrufer außerhalb von `apiSend`/`apiUpload` schreibt ohne Kopf] → bleibt ungebunden wie
  heute. Mitigation: Vitest-Guard, der in `frontend/src` (ohne Tests) kein `fetch(` mit
  schreibender Methode außerhalb von `api/client.ts` zulässt.
- [412 aus einem anderen Grund künftig] → der Client prüft nur, meldet nie ab; schlimmstenfalls
  ein überflüssiger `me()`-Aufruf.
- [Prüfung bei jedem Sichtbarwerden kostet einen `me()`-Aufruf] → billig (ein indizierter
  SELECT); zusammengefasst, wenn schon eine läuft.
- [Konfliktdialog verwirft ungesicherte Eingaben] → bewusst; der Dialog sagt es. Schreiben
  unter A ist ohnehin unmöglich, solange B die Sitzung hält. Hat die Seite von A ungesicherte
  Änderungen, fragt der Browser beim Neuladen nach (`beforeunload`); bleibt die Person, steht
  der Dialog weiter.
- [Behaltene Erfassungswerte in `sessionStorage` (`components/erfassungsSitzung.ts`) tragen
  keinen Benutzer im Schlüssel] → überleben das Neuladen und belegen B's Masken mit A's Werten
  vor. Vorbestand, nicht Teil dieses Changes; Nachzug LFH-785.

## Migration Plan

Keine Datenmigration. Der Kopf ist optional; ein alter Frontend-Stand gegen neues Backend
verhält sich wie heute. Rollback = Revert.
