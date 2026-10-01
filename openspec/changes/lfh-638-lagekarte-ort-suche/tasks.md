# Tasks

## 1. Backend: Vorwärtssuche im Geocoding (TDD)

- [x] 1.1 `geocoding::suche_mit` neben `reverse_mit` in `src/geocoding/mod.rs` (D6): `/search` mit
      `q`, `format=jsonv2`, `limit=5`, `accept-language=de`, optionaler `viewbox` mit `bounded=0`;
      geteilter Token-Bucket mit bis zu 1 s Warten; Ergebnis `ok(Vec<Treffer>)` /
      `ausgelastet` / `nicht_erreichbar`. Tests zuerst gegen den vorhandenen Mini-Stub: Erfolg
      (Felder `lat`/`lon` als Strings geparst, `display_name`), leere Liste = `ok` ohne Treffer,
      geschlossener Port = `nicht_erreichbar`, leerer Bucket ohne Nachfüllung = `ausgelastet`,
      Viewbox-Parameter kommt am Stub an. Prüfung: `cargo test geocoding::` grün.
- [x] 1.2 In-Memory-Cache der Vorwärtssuche (D6: normalisierter Begriff + Viewbox, 24 h, 500
      Einträge, nur `ok`). Prüfung: Test „zweite gleiche Suche erreicht den Stub nicht“ und
      „`nicht_erreichbar` wird nicht gecacht“ grün.
- [x] 1.3 Datenschutz-Kopf von `src/geocoding/mod.rs` um die Vorwärtssuche ergänzen (Suchtext +
      grober Ausschnitt gehen an den Geocoder, kein Suchtext im Log). Prüfung: Review des
      Kommentars; `grep` zeigt keinen `tracing`-Aufruf mit dem Suchtext.

## 2. Backend: Route `GET /api/einsaetze/{id}/karte/ort-suche` (TDD)

- [x] 2.1 `src/routes/karte_ort_suche.rs` mit `EinsatzLesezugriff<Lagekarte>`, Validierung `q`
      3–200 Zeichen (400), Viewbox aus dem Einsatzort (`geocoding::marker`), Geocoder-URL aus den
      Org-Einstellungen; Antwort `OrtSucheAntwort { zustand, treffer }` mit `ToSchema`, immer 200.
      Route in `src/app.rs` registrieren, Typen in `src/api_doc.rs`. Integrationstests in
      `tests/karte_ort_suche.rs` zuerst: 400 bei zwei Zeichen und bei 201 Zeichen, 403 ohne
      Lagekarte-Modul (Geocoder-Stub zählt keinen Aufruf), 200 + `nicht_erreichbar` bei totem
      Geocoder, 200 + Treffer mit Stub, Viewbox nur mit verortetem Einsatzort. Prüfung:
      `cargo test --test karte_ort_suche` grün, Modul-Guard (`einsatz::modul`) grün.
- [x] 2.2 Typ-Codegen: `scripts/check-typ-codegen.sh`, `frontend/src/api/openapi.json` und
      `types.generated.ts` mitcommitten. Prüfung: Skript grün, `OrtSucheAntwort` über
      `api/karteOrtSuche.ts` erreichbar (Muster `api/ortVorschau.ts`, nicht der Barrel).

## 3. Frontend: Koordinatenerkennung teilen

- [x] 3.1 `erkenneKoordinate` samt Formen nach `anzeige/koordinatenErkennung.ts` heben (D1),
      `command-palette/koordinatenSprung.ts` importiert von dort; bestehende Tests mitziehen.
      Prüfung: `koordinatenSprung.test.ts` und der verschobene Test grün, `tsc --noEmit` grün.

## 4. Frontend: Ortsgruppen im Suchfeld (TDD)

- [x] 4.1 API-Client `api/karteOrtSuche.ts` und Query-Key `einsatzKeys.ortSuche(einsatzId, begriff)`
      in `api/queryKeys.ts` (Regeln in `frontend/AGENTS.md`, Query-Keys). Prüfung: Unit-Test
      des Clients (URL-Kodierung des Suchtexts) grün.
- [x] 4.2 `MarkerSuche`: Gruppe „Koordinate“ aus der Eingabe (Spec „Koordinate im Suchfeld“),
      beschriftet im wirksamen Format; Treffer als Bedienziel mit Trefflächenboden. Tests zuerst
      in `MarkerSuche.ortssuche.test.tsx`: Dezimalgrad, MGRS mit WGS84-Beschriftung, „12 34“ ohne
      Gruppe. Beschriftung über `useAnzeigeKonventionen().formatKoordinate`.
      Prüfung: Tests grün.
- [x] 4.3 `MarkerSuche`: Adresssuche auf Enter (D2) mit Gruppe „Adresse“, Lade-, Leer-,
      `ausgelastet`- und `nicht_erreichbar`-Zustand, Verwerfen beim Weitertippen, Direktflug bei
      genau einem Treffer (einmal je Ergebnis). Tests zuerst mit `userEvent.keyboard('{Enter}')`
      und gemocktem Client: kein Aufruf beim Tippen, kein Aufruf unter drei Zeichen, Zustände
      wörtlich nach Spec, Objektgruppen bleiben sichtbar. Prüfung: Tests grün.
- [x] 4.4 Leerzustand nach MODIFIED `lagekarte-objektsuche`: mit Koordinaten- oder Adressgruppe nur
      der knappe Hinweis „Kein Kartenobjekt zu „…““. Prüfung: neuer Test „Koordinate ohne
      Objekttreffer“ und die bestehenden Leerzustands-Tests grün.

## 5. Frontend: Suchnadel (TDD)

- [x] 5.1 `pages/lagekarte/suchnadelLayer.ts` nach dem Muster `eigenpositionLayer.ts` (D3), samt
      Wiederherstellung nach `setStyle` in `Kartenflaeche`; keine Rolle in `ordneKlickebene`, kein
      Trefferlayer. Tests zuerst: GeoJSON aus Zustand, `null` räumt die Quelle, Guard in
      `klickziel.test.ts` bleibt grün und kennt keine Suchnadel-Rolle. Prüfung: Tests grün.
- [x] 5.2 Zustand `suchnadel` in `LagekartePage`, `onOrtWaehlen` setzt Nadel + `setFlyToZiel`;
      Band `SuchnadelBand` in `KartenFuss` mit Beschriftung und Knopf „Suchnadel entfernen“
      (`bandStil`, LFH-355). Tests: `SuchnadelBand.test.tsx` (Band nur mit Nadel, Knopf räumt),
      Seiten-Test: neue Wahl ersetzt die alte, nach dem Neuladen keine Nadel (die Nadel lebt nur im
      Seitenzustand, kein Pfad in Ansicht oder Snapshot). Prüfung: Tests grün.

## 6. Frontend: Deeplinks

- [x] 6.1 `lagekartePfad` um `ort` erweitern (`routing/deeplinks.ts`), `?zentrum=`-Effekt setzt die
      Suchnadel mit Koordinatenbeschriftung, neuer `?ort=`-Effekt (Vorbelegung mit Nonce,
      Adresssuche ausgelöst, Leiste per `zeige()`, Parameter geräumt) (D4). Tests: Deeplink-Test
      für `ort` (Kodierung), Seiten-Tests für beide Parameter. Prüfung: Tests grün.

## 7. Sprungpalette: Adresszeile (TDD)

- [x] 7.1 Gruppe `ortssuche` in `command-palette/typen.ts` (exhaustive Records), Hook neben
      `useKoordinatenSprung` mit derselben Rechteprüfung (geteilt über `useLagekarteZugang`); Zeile am Ende der Treffer, nur ab drei
      Zeichen mit Buchstabe und ohne Koordinatenform, `sprungZu(lagekartePfad(id, { ort }))` (D5).
      Tests zuerst: Zeile erscheint/fehlt nach Spec (Recht, Koordinate, zu kurz), ↵ und Strg+↵
      navigieren, nicht merkbar, kein Aufruf der Adresssuche aus der Palette. Prüfung: Tests grün.

## 8. Regeln und Nachweis im Browser

- [x] 8.1 `frontend/src/pages/lagekarte/AGENTS.md` Punkt „Ortssuche“ und
      `frontend/src/command-palette/AGENTS.md` Satz zur Adresszeile (D7), Prettier über
      `frontend/`. Prüfung: `scripts/check-fmt.sh` grün.
- [ ] 8.2 e2e `frontend/e2e/lagekarte-ortssuche.spec.ts` (Regeln `frontend/e2e/AGENTS.md`):
      Koordinate tippen → Treffer → Nadel-Band sichtbar; Adresssuche mit abgefangener Route
      (ein Treffer → Direktflug); `?ort=` bei 390 px öffnet die Leiste mit Gruppe „Adresse“;
      Tipp auf Marker unter der Nadel wählt den Marker. Prüfung: Spec grün.
- [ ] 8.3 `./scripts/check-all.sh` vollständig grün (Bündel laut Skriptkopf). Prüfung: Ausgabe
      ohne rote Schritte; Kästchen, die erst die CI belegt, mit Verweis auf den PR-Lauf abhaken.
