# Tasks

## 1. Backend: Nachweis, wer storniert

- [x] 1.1 Migration (nächste freie Nummer, `scripts/check-migrationen.sh` grün):
  `storniert_von INTEGER REFERENCES benutzer(id)` an `einsatz_person` und `einsatz_tier` (D1).
  Die Schwärzungs-Registry bekommt für beide Tabellen `retain("storniert_von", G_FK)`. Prüfen:
  Registry- und Spiegel-Tests grün.
- [x] 1.2 `src/person/repo.rs` und `src/tier/repo.rs` stornieren mit
  `Vermerk::GeaendertUndStorniert`. Test je Repo: nach dem Storno ist `storniert_von` der
  stornierende Benutzer, wie im Schaden-Test.
- [x] 1.3 DTO-Feld `storniert_von_name` (Join `benutzer.anzeigename`) an `PersonAnzeige`, am
  Tier-DTO und am Schaden-DTO (D2). `scripts/check-typ-codegen.sh` laufen lassen und beide
  erzeugten Dateien mitnehmen. Test: das Detail einer stornierten Person, eines Tiers und eines
  Schadens trägt den Namen; ein Altbestand ohne `storniert_von` liefert `null`.

## 2. Backend: Stand-Abfragen

- [x] 2.1 `GET …/personen/{pid}/stand` → `StornoStand` (D3): dieselben Schranken wie das Detail,
  kein Audit, eine stornierte Person ist 200. Route in die Geräte-Routenliste wie `…/zeile`.
  Tests:
  - keine neue Zeile in `person_zugriff_audit`;
  - fremder Einsatz 404;
  - Gerät einer fremden Stelle 404;
  - storniert 200 mit Name.
- [x] 2.2 `GET …/betreuung/stellen/{sid}/stand` → `StornoStand` (D3). Tests:
  - stornierte Stelle 200 mit Name;
  - unbekannte oder fremde Stelle 404;
  - ohne Modulrecht 403.

## 3. Frontend: Banner und Sperre

- [x] 3.1 `components/StornoBanner.tsx` (D7): Text mit Name bzw. ohne Name, mit Datum außerhalb
  von heute, `role="status"`, Farben aus dem Statusvertrag. Unit-Test der drei Wortlaute.
- [x] 3.2 Schreibschutz an `InlineAngabe` (D8): fällt `darfSchreiben` bei offenem, geändertem
  Entwurf weg, bleibt das Feld `readOnly` mit dem Text stehen, „Speichern“ verschwindet,
  „Schließen“ verwirft ohne Rückfrage, und der Merker `offeneBearbeitung` gibt frei. Eine
  unveränderte Bearbeitung schließt. Test in `InlineAngabe.test.tsx`. `BearbeitbaresPaneel` steht
  auf keiner der vier Seiten; die Bearbeiten-Formulare von Tier und Schaden folgen in 5.2.

## 4. Frontend: Personen-Detail

- [x] 4.1 `einsatzKeys.personStand` mit Loader `loadPersonStand`. Live über
  `EINSATZ_STREAM_ZIELE.person` und den Präfix in `EINSATZ_STREAM_EVENTS.person` (D4). Prüfen:
  `queryKeys.guard.test.ts` grün; Test, dass ein `person`-Ereignis mit `person_id` den Stand
  dieser Person und nicht das Detail abgleicht.
- [x] 4.2 `PersonenDetailPage`:
  - Stand abfragen, `gesperrt` ableiten;
  - Banner zeigen, Kopfaktionen, Patientenkopf, Personendaten, Notiz, Anhänge und Bezüge sperren;
  - `refetchOnWindowFocus: false` am Detail.

  Tests:
  - Stand liefert `storniert_at` → Banner, keine Schreibaktion, eine offene Notiz bleibt lesbar;
  - Fokuswechsel ruft das Detail nicht neu ab.

## 5. Frontend: Tier und Schaden live

- [x] 5.1 `tier` und `schaden` aus `NICHT_LIVE_KEYS`; `tier` in `EINSATZ_STREAM_EVENTS.tier`,
  `schaden` in `EINSATZ_STREAM_EVENTS.schaden` und `EINSATZ_STREAM_ZIELE.schaden` (D5). Prüfen:
  Guard grün; Test, dass ein `schaden`-Ereignis das Detail dieses Schadens abgleicht.
- [x] 5.2 `TiereDetailPage` und `SchaedenDetailPage`: Banner und Sperre aus `storniert_at` und
  `storniert_von_name`. Tests:
  - Banner nach einem Neuabruf mit `storniert_at`;
  - eine offene Bearbeitung behält Entwurf und Basisstand über einen Live-Neuabruf.

## 6. Frontend: Betreuungsstelle

- [x] 6.1 `einsatzKeys.betreuungsstelleStand` (live über `betreuung`) und
  `BetreuungsstelleDetailPage` nach D6:
  - verschwindet eine gesehene Stelle, Stand abfragen;
  - mit `storniert_at` letzten Stand gesperrt mit Banner zeigen;
  - sonst `StelleNichtGefunden`.

  Tests für beide Ausgänge und für den Direktaufruf.

## 7. Ende zu Ende, Doku, Gate

- [x] 7.1 e2e (zwei Kontexte): A storniert eine Person, B hat ihr Detail mit einer Notiz in Arbeit
  offen. B zeigt binnen weniger Sekunden „Storniert von …“, der Notiztext steht noch, und es gibt
  keinen Knopf „Notiz anlegen“. Das Zugriffsprotokoll der Person hat danach genau den einen
  Eintrag vom Öffnen bei B.
- [x] 7.2 Regeln nachziehen:
  - `frontend/src/personen/AGENTS.md`: Detail nicht live, Stand-Abfrage, kein Fokus-Neuladen;
  - `frontend/AGENTS.md`: Query-Key-Registry, Storno-Banner;
  - Anwenderdoku zu Betroffenen, Tieren und Schäden, falls dort das Stornieren beschrieben ist.

  - ADR-0065 (protokolliertes Detail nie live, protokollfreier Stand), weil Route `entwurf` mit E1
    (`docs/architektur/AGENTS.md`, Mitänderungsregel).

  Prüfen: Doku-Wächter grün.
- [x] 7.3 `./scripts/check-all.sh --geaendert --ohne-e2e` lokal grün. Dazu Bilder der Änderung
  (Personendetail vorher und nachher, Tier, Schaden, Betreuungsstelle) für PR und Meldung.

## Workflow follow-up

- `/opsx:archive qm3orral-storno-sperrt-offene-seiten` im selben Branch vor dem PR
- PR gegen `alpha` mit Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/qm3orralugfn7007r4koowbf`
