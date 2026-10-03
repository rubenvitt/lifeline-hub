# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst rot, dann grün.
- Vitest: `mise exec -- pnpm -C <abs>/frontend test -- <datei>`
- Rust: `cargo test --test <datei>` bzw. `cargo test <modul>::tests`

Vor „fertig“ stehen `verification-before-completion` und `requesting-code-review`.

## 1. Breite vor dem Bau messen (D5)

- [x] 1.1 Messspec `e2e/kommunikationsplan-breite.spec.ts` (vorläufig, geht in 7.1 auf): bei
  1366 × 768 mit offenem Modulpanel die Contentbreite unter `stab` messen, dazu die Laufweite der
  längsten Funktionsbezeichnung („Führungshilfspersonal · Lagekartenführer“), einer
  Rufnummer in `monoStil` und eines Hinweises von 60 Zeichen.
  - Nachweis: Spec grün, Messwerte und daraus gewählte Spaltenbreiten samt `mindestBreite` als
    Nachtrag in `design.md` D5.

## 2. Backend: Datenmodell und Schwärzung (D2, D10)

- [x] 2.1 Migration `NNNN_einsatz_kommunikationsplan.sql` mit beiden Tabellen und dem partiellen
  Index. Nummer per `git fetch origin alpha && scripts/check-migrationen.sh` (größer als jede auf
  `alpha`).
  - Nachweis: `db::tests::migrationsnummern_sind_eindeutig` grün, `check-migrationen.sh` grün.
- [x] 2.2 `wire_enum! Stellenart` und `Verbindungsmittel` in `src/stab/kommunikation.rs`,
  registriert in `src/api_doc.rs` und `tests/enum_wire_kontrakt.rs`.
  - Nachweis: Wire-Kontrakt-Test zuerst rot (Enum fehlt), dann grün; Inventar-Guard grün.
- [x] 2.3 Schwärzungsregister für beide Tabellen nach D10.
  - Nachweis: Registry-Guard zuerst rot (Tabelle fehlt), dann grün; ein Test in `tests/` legt
    Verbindungsperson und Verbindung an, schwärzt den Einsatz und prüft: Name und Nummer weg,
    `stellenart`, `funktion`, `mittel` erhalten (Spec „Personenbezug wird … geschwärzt“).

## 3. Backend: Repo und Routen (D3)

- [x] 3.1 Tests zuerst in `tests/stab_kommunikationsplan.rs` für jedes Szenario der Spec
  `stab-kommunikationsplan`, das am Server hängt:
  - Lesen mit Stab-Leserecht 200, ohne 403; Schreiben ohne Stab-Schreibrecht 403
  - Stelle Funktion `s3` anlegen, zweite `s3` → 409; `s9` → 400; Fachberater ohne Bezeichnung → 422;
    S7 ausgeschaltet → 422; Leitstelle mit leerer Bezeichnung → 400; Länge > 200 → 400
  - Verbindung anlegen, unbekanntes Mittel → 400, leerer Wert → 400; Reihenfolge der Anlage
  - PATCH der Bezeichnung; PATCH der Stellenart wird nicht angenommen
  - Stelle entfernen nimmt ihre Verbindungen mit
  - fremde `sid`/`vid` (anderer Einsatz) → 404
  - Sortierung: EL vor S4 vor Fachberater, dann Leitstelle vor Behörde
  - `funktion_label` trägt das Mandantenlabel
  - jede wirksame Schreibaktion sendet `LiveEvent::Stab`
  - Response-Presence per `contains_key`
  - Nachweis: rot belegt.
- [x] 3.2 Umsetzung: Repo `src/stab/kommunikation.rs` (Laden mit Join, Anlegen mit
  `sortier = MAX+1` unter `write_retry!`, Ändern, Entfernen), Validierung über
  `fuehrung::pruefe_funktion`, Routen in `src/routes/stab.rs`, Registrierung in `app.rs` und
  `api_doc.rs`.
  - Nachweis: Tests aus 3.1 grün, `cargo test` im Workspace grün.
- [x] 3.3 Typ-Codegen: `scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts`
  mitcommitten; Request-DTOs `NeueKommunikationsStelle`, `KommunikationsStellePatch`,
  `NeueVerbindung`, `VerbindungPatch` handgepflegt in `frontend/src/api/types.ts`.
  - Nachweis: Codegen-Skript grün, `pnpm exec tsc -b` grün.

## 4. Frontend: API, Keys, Ableitung (D4, D9)

- [x] 4.1 `api/kommunikationsplan.ts` (Laden und sechs Schreibaufrufe) und
  `einsatzKeys.stabKommunikationsplan(id)` unter dem Prefix `stab`.
  - Nachweis: Vitest für die Pfade; `queryKeys`-Guards grün.
- [x] 4.2 `LAGEBILD_OFFLINE.einsatzUnterKeys` um `[EINSATZ_KEYS.stab, 'kommunikationsplan']`.
  - Nachweis: `lagebildOffline.guard.test.ts` grün; Test in `queryKeys`, dass
    `istLagebildOfflineKey` den Kommunikationsplan nimmt und `einsatzKeys.stab(id)` nicht.
- [x] 4.3 `stab/kommunikationsplan.test.ts` zuerst, gegen `baueKommunikationsplan`:
  - Gruppenfolge und Katalogfolge
  - Abschnitt/Einheit nur mit Kommunikationsmittel oder Erreichbarkeit
  - Besetzung als Nebentext für S1–S6 (Person, extern, rückwärtig, „bei der Einsatzleitung“,
    „nicht vergeben“), keiner für EL, S7, FHP, FB
  - Quelle gesperrt/nicht geladen → Gruppe mit Grund, nie leer
  - `personal.telefon` taucht nie auf
  - keine Zeile „Führungsstelle“
  - Nachweis: rot, dann grün.
- [x] 4.4 Verweisbildung `verbindungsVerweis(mittel, wert)` (`tel:` nur Ziffern und `+`, `mailto:`
  nur mit `@`, sonst kein Verweis) mit Vitest; Lücke „Leitstelle“ als Filter in `stab/luecken.ts`
  mit Vitest (Treffer, Leitstelle ohne Verbindung zählt als fehlend, nicht geladen → „—“).
  - Nachweis: grün.

## 5. Frontend: Seite, Bearbeitung, Einstieg (D1, D5)

- [x] 5.1 `kommunikationsplanPfad(id)` in `routing/deeplinks.ts`, Eintrag in
  `stab/unterseiten.ts` (S6: Funkplan, Kommunikationsplan), Route in `App.tsx`.
  - Nachweis: Deeplink-Vitest, `inlinePfade.guard.test.ts` grün, `StabPage.test.tsx`: S6 trägt
    beide Verweise, andere Zeilen nicht; App-Routentest: Stab aktiv.
- [x] 5.2 `pages/KommunikationsplanPage.test.tsx` zuerst:
  - Gruppen, Stellen, Verbindungen, `tel:`-Verweis
  - Freigabe offen → keine Daten; Freigabe-Fehler → Wiederholen
  - Lücke „Leitstelle“
  - Beobachter: keine Aktionsspalte, kein „Stelle hinzufügen“
  - ohne Netz: Knöpfe gesperrt, Daten sichtbar
  - Stelle anlegen (Funktion vergeben → ausgegraut; FHP/FB verlangt Bezeichnung), Verbindung im
    Serienmodus, Bearbeiten vorbelegt, Fehler an der Seite
  - Stelle mit zwei Verbindungen entfernen fragt nach und nennt „2“
  - keine Übernahme in den Lagebericht
  - abgeleitete Zeile führt zur Einheit und hat keine Aktion
  - Nachweis: rot belegt.
- [x] 5.3 `pages/KommunikationsplanPage.tsx` bauen (`EinsatzSeite`, Lücken-`Paneel`,
  `Datensicht form="tabelle"`, `ErfassungsModal` für Stelle und Verbindung, `Popconfirm`,
  `useStabFreigabe`, `setQueryData` aus der Schreibantwort).
  - Nachweis: Tests aus 5.2 grün, `pnpm lint` grün.
- [x] 5.4 `datensicht.guard.test.ts`: Seite in `KONSUMENTEN` und `NUR_TABELLE`.
  - Nachweis: Guard grün; Gegenprobe `form="auto"` → rot.

## 6. Druck, Sprechgruppen-Darstellung, Führungsstelle (D6, D7, D8)

- [x] 6.1 Druck des Kommunikationsplans: `Druckkopf` „Kommunikationsplan“, `DruckKnopf`,
  `pages/kommunikationsplanPrint.css` (Aktionsspalte und Knöpfe aus), Regeln sonst aus `druck.css`.
  - Nachweis: Formtest analog `funkplanPrint.test.ts`; e2e in 7.1.
- [x] 6.2 Darstellung „Sprechgruppen“: `stab/sprechgruppenplan.test.ts` zuerst (Menge = zugeordnete
  plus einsatzlokale, Katalog ohne Zuordnung fehlt, TMO vor DMO, Teilnehmer mit Rufnamen,
  gesperrte Quelle → „—“ bzw. „unvollständig“ statt „keine“), dann `stab/sprechgruppenplan.ts`;
  `parseFunkplanAnsicht` um `sprechgruppen`, dreistelliger Umschalter und Tabelle in
  `FunkplanPage.tsx`, Druckkopf nennt die Darstellung.
  - Nachweis: Vitest grün; `FunkplanPage.test.tsx` um Umschalten, `?ansicht=sprechgruppen` und
    Druckkopf erweitert, grün; `datensicht.guard.test.ts` grün.
- [x] 6.3 Führungsstelle (D7): Ist LFH-849 auf `alpha`, abgeleitete erste Zeile „Führungsstelle“ aus
  den Einsatzfeldern mit Test in `stab/kommunikationsplan.test.ts`. Sonst Kommentar in LFH-849,
  dass der Kommunikationsplan die Zeile nachziehen muss.
  - Nachweis: Test grün bzw. Kommentar-Link in der Abschlussmeldung.

## 7. e2e und Prüfliste

- [x] 7.1 `e2e/kommunikationsplan.spec.ts` (nimmt 1.1 auf): Fükw ohne waagerechten Überhang, Lücke im
  ersten Bild (`toBeInViewport`), 390 px Tabelle mit fixierter Kopfzelle, Anlegen von Stelle und
  Verbindung und Live bei einer zweiten Seite, Druck bei A4 ohne Überhang und ohne Knöpfe,
  Offline-Neuladen zeigt den Stand und sperrt die Knöpfe.
  - Nachweis: Spec mit `--repeat-each=5 --workers=2 --retries=0` grün.
- [x] 7.2 `e2e/funkplan.spec.ts` um die Darstellung „Sprechgruppen“ (Umschalten, Druck ohne
  Überhang); Gate 1 (`gate1-ueberlauf.spec.ts`) und Gate 3 (`gate3-trefflaeche.spec.ts`) um die
  Route `stab/kommunikationsplan`, als Admin und als Beobachter.
  - Nachweis: die drei Specs grün.
- [x] 7.3 `pruefliste.md` dieser Change: 15 Kriterien der Prüfliste Einsatztauglichkeit für die neue
  Seite und die neue Darstellung, mit Beleg je Verdikt, plus Mutationsproben (u. a. Lücke ohne
  Ladezustand, Telefon aus Personal übernommen, Schwärzung ohne `wert`).
  - Nachweis: Datei liegt vor, jede Probe ist rot geworden und wieder grün.
- [x] 7.4 `frontend/src/stab/AGENTS.md`: Abschnitt „Kommunikationsplan S6“ (Ort, Datenmodell,
  abgeleitete Zeilen, kein Lagebericht, offline) und Ergänzung der Funkplan-Regel um die dritte
  Darstellung; Kopf der Datei um die neuen Pfade.
  - Nachweis: Prettier grün, Verweise per `grep` geprüft.
- [ ] 7.5 `./scripts/check-all.sh` grün, Vitest und Rust-Tests grün.
  - Nachweis: Lauf dieses Branches (lokal bzw. CI des PRs).
