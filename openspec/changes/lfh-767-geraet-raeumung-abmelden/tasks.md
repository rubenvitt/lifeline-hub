# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: zuerst der rote Test, dann der
Code. Pfade relativ zu `frontend/src/`.

## 1. Verzeichnis der Speicherorte (D1)

- [ ] 1.1 `offline/geraetRaeumung.ts` mit `GERAETESPEICHER` (Ort, Datei, Entscheidung, Grund)
  für jeden Ort aus der Bestandstabelle in `design.md` anlegen. Prüfen: Typprüfung grün, jeder
  Eintrag hat einen nicht leeren `grund`.
- [ ] 1.2 Guard-Test `offline/geraetRaeumung.guard.test.ts`: Er findet jede Nicht-Test-Datei mit
  `openDB(` oder `localStorage.setItem`/`sessionStorage.setItem` und verlangt einen Eintrag.
  Prüfen: Der Test ist rot, solange eine Datei fehlt (Mutationsprobe: einen Eintrag
  auskommentieren → rot mit Dateinamen), danach grün.

## 2. Räumen bei jedem Ausgang (D2, D6)

- [ ] 2.1 `queue.ts`: `personErfassungsQuittungenRaeumen()` leert nur den Quittungs-Store und
  lässt die vier Queue-Stores unberührt. Prüfen: Test gegen die rohe IndexedDB (eigene
  Verbindung) zeigt eine leere Quittungsmenge und unveränderte Queue-Zeilen.
- [ ] 2.2 `anzeige/ortCache.ts`: `ortCacheRaeumen()` als Produktionsfunktion (bisher nur
  `leereOrtCache` für Tests), Kommentar „keine Eviction“ präzisieren. Prüfen: Test gegen die rohe
  IndexedDB `lifeline-ortcache`.
- [ ] 2.3 `components/erfassungsSitzung.ts`: `erfassungsSitzungRaeumen()` entfernt alle
  Schlüssel `lfh:erfassung:*` und lässt fremde Schlüssel stehen. Prüfen: Unit-Test.
- [ ] 2.4 `geraetRaeumen(anlass)` in `offline/geraetRaeumung.ts` versucht jeden Ort einzeln
  (ein Fehler hält die anderen nicht auf). Prüfen: Test mit einem werfenden Ort, die übrigen
  sind trotzdem leer.

## 3. ETB-Entwürfe binden (D3, D5)

- [ ] 3.1 `EtbEntwurf.benutzer_id`, Entwurfs-DB v2 mit Index `by-benutzer-einsatz` und
  `blocking`-Handler. `entwuerfeLaden(benutzerId, einsatzId)` liest nur über den Index.
  Prüfen: Test, dass Benutzer B im selben Einsatz keinen Entwurf von A lädt, auch nicht aus
  dem Vorlauf. Test, dass ein v1-Bestand das Upgrade unverändert übersteht.
- [ ] 3.2 `entwuerfeRaeumen()` (alle Entwürfe, Vorlauf, `etb-entwurf-aktiv-*`) und
  `entwuerfeFuerBenutzerRaeumen(benutzerId | null, jetzt)` mit den Regeln aus D4/D5
  (fremde löschen, eigene behalten, Altbestand ≤ 24 h übernehmen, sonst > 24 h verwerfen).
  Prüfen: tabellarischer Test über die Fälle aus D4/D5 gegen die rohe IndexedDB.
- [ ] 3.3 `useEtbEntwuerfe`: Person aus `useAuth()`, Aktiv-Schlüssel
  `etb-entwurf-aktiv-<benutzer>-<einsatz>`, ohne Person kein Laden/Speichern. Bestandstests
  (`useEtbEntwuerfe.test.tsx`, `EtbEntwurfsTabs.test.tsx`) auf eine angemeldete Person umstellen.
  Prüfen: diese Tests und die ETB-Seitentests grün.
- [ ] 3.4 `frontend/src/etb/AGENTS.md`, Abschnitt Entwurfsspeicher: Bindung an `benutzer_id`,
  Abmelden löscht, Sitzungsende behält (Verweis auf diesen Change). Prüfen: Prettier grün.

## 4. Einhängen in den AuthProvider (D2, D4)

- [ ] 4.1 `abmeldenLokal(anlass)`: `logout()` → `'abmelden'`, `pruefe` und
  `useSitzungsWache` → `'sitzungsende'`. Nach `lagebildLoeschen` läuft `geraetRaeumen(anlass)`,
  Fehler werden geloggt. Fixture `test/fixtures.ts` nachziehen. Prüfen: AuthContext-Test, dass
  ein Fehler beim Räumen die Abmeldung nicht aufhält.
- [ ] 4.2 Nach `lagebildStarten` und `lagebildAnmelden` läuft
  `geraetFuerBenutzerRaeumen(benutzer?.id ?? null)`. Prüfen: Test „B meldet sich nach Ablauf
  von A an“ → Entwürfe und Quittungen von A sind von der Platte weg.
- [ ] 4.3 **Akzeptanztest 1** (`auth/geraetRaeumung.integration.test.tsx`): Person mit
  Entwurf, Quittung, Ortscache-Eintrag, Erfassungswert und vorgemerktem Queue-Eintrag meldet
  sich über den echten `AuthProvider` ab. Die rohe IndexedDB zeigt danach keinen Entwurf, keine
  Quittung, keinen Ortsnamen und kein Lagebild, die Queue-Zeile steht noch. Zweiter Fall:
  `sitzungsende` → Entwurf bleibt, Quittung und Ortscache weg. Prüfen: Mutationsprobe
  (`geraetRaeumen`-Aufruf entfernen → Test rot).
- [ ] 4.4 `frontend/src/offline/AGENTS.md`: Den Punkt „Offen: LFH-767“ durch die Regel ersetzen
  (Verzeichnis + Guard, ein Weg hinaus mit Anlass, Grundsatz „Server liefert wieder → geht,
  nur hier → gebunden und befristet, Queue bleibt“). Prüfen: Prettier grün, Verweise mit `grep`
  auf `LFH-767` geprüft.

## 5. Ende-zu-Ende und Abschluss

- [ ] 5.1 e2e `e2e/geraet-raeumung.spec.ts` (**Akzeptanztest 2**): A schreibt einen
  ETB-Entwurf, meldet sich ab. Ein zweiter Benutzer (angelegt wie in
  `sitzung-mehrere-tabs.spec.ts`) meldet sich an und sieht im ETB desselben Einsatzes keinen
  Entwurf von A. Zweiter Fall: A bekommt einen Sitzungsablauf (Cookie gelöscht) und findet nach
  der Wiederanmeldung seinen Entwurf. Prüfen: Spec lokal grün.
- [ ] 5.2 `./scripts/check-all.sh` grün (bzw. die Schritte, die in der Umgebung laufen, mit
  Verweis auf die CI des PRs).
