# Tasks

## 1. Abschnittsstärke über den wirksamen Abschnitt (D1, D4, D7)

- [x] 1.1 Fixture `tests/fixtures/verdichtung/regeln.json`: `_regel` neu, `erwartet_abschnitte` nach D1 (10: eigene 1/2/6, inkl. 2/2/10; 11: 0/0/2; 12: 1/0/4). `lage/verdichtungFixture.test.ts` ist danach rot. `cargo test --test verdichtung_fixture` bleibt grün (Rust prüft die Abschnitte nicht).
- [x] 1.2 `pages/einsatzabschnitte/abschnittStaerke.ts`: `staerkeIn` summiert `ist` der aktiven Einheiten nach `abschnittDerEinheit` über die aktiven allein. Neu `einheitenImAbschnitt(einheiten, abschnittId)`. Tests zuerst: Fixture grün, Unit-Tests für eine Untereinheit ohne eigenen Abschnitt (erbt), eine unter einer aufgelösten Obereinheit (erbt nicht) und eine leere Menge (`null`).
- [x] 1.3 Gliederung: `EinsatzabschnittePage.tsx` zählt „n Einheiten direkt“ über `einheitenImAbschnitt`. Das Detail listet „Zugeordnete Einheiten“ aus derselben Menge, mit „eigene“ (`ist`) und „über <Obereinheit>“ bei geerbtem Abschnitt. Seitentest mit dem Fall UHS Turnhalle: Knoten „0/1/1//2“ und „1 Einheit direkt“, Liste summiert zur Stärke.

## 2. Meldebild und Überblick (D2)

- [x] 2.1 `kraefte/kraeftebaumKern.ts`: `loeseAbgestellte(einheiten, abschnitte, alle)` und `abgestelltVon` mit `abgestelltAus` am Knoten. Tests in `kraeftebaumKern.test.ts`: abgestellte Gruppe wird Wurzel samt Kindern, Gruppe ohne eigenen Abschnitt bleibt, Gruppe mit gleichem Abschnitt bleibt, Zyklus und Waise unverändert.
- [x] 2.2 `kraefte/kraeftebild.ts`: `baueKraeftebild` nutzt `loeseAbgestellte`, die abgestellte Zeile trägt „aus <Obereinheit>“ (Name aus `quelle`). `filtereKraefte` filtert nach `abschnittDerEinheit`, `abschnittDerObersten` entfällt samt Verweisen. Tests in `kraeftebild.test.ts`: Abschnittszeilen gleich `abschnittStaerken`, Zug ohne Gruppe, Kopf unverändert, Filter EA 1 / EA 1.1. Fixture `erwartet_wurzeln_je_abschnitt` ergänzen und in `verdichtungFixture.test.ts` prüfen.
- [x] 2.3 Überblick: `ueberblickDaten.test.ts` um den Fall ergänzen, dass eine abgestellte Gruppe mit Ausfall den Abschnitt ihres Einsatzes tönt und nicht den ihres Zugs (bei verschiedenen obersten Abschnitten). Grün ohne Codeänderung in `ueberblickDaten.ts`, sonst nachziehen.

## 3. Organigramm (D3)

- [x] 3.1 `pages/einsatzabschnitte/fuehrungsorganisation.ts`: abgestellte Untereinheit unter ihrem Abschnitt mit „aus <Obereinheit>“. Einheitknoten-Stärke = `ist` über den gezeigten Teilbaum. Schlüssel bleiben `eh-<id>`. Tests in `fuehrungsorganisation.test.ts` zuerst. Organigramm-Ansicht zeigt den Zusatz, Komponententest. Die Prüfung der Fernmeldeskizze (Auto-Layout) bleibt grün.

## 4. Kräfte und UHS-Kräfte (D5, D6)

- [x] 4.1 `pages/KraefteuebersichtPage.tsx`: Zeile „p von P Kräften · f von F Fahrzeugen“, unbekannte Zahl „—“ je Liste, gesperrte Mittel ohne Fahrzeugzahl. Seitentest mit gesetztem Filter und ohne Filter.
- [x] 4.2 `pages/lage-dashboard/lageVerdichtung.ts`: `zaehltKraefteAnUhs(status)`, `verdichteUhs` nutzt sie. `LageDashboardPage.tsx`: Notiz „n geplant · n Kräfte an UHS“. Tests: geplante UHS mit Personal zählt nicht, Wortlaut der Notiz.
- [x] 4.3 `geraet/LagemonitorPage.tsx`: `anUhs` nur über UHS mit `zaehltKraefteAnUhs`. Test: geplante UHS mit Kräften fehlt in „n an UHS“, steht aber weiter in der Belegungsliste.

## 5. Regeln, Doku, Abschluss

- [x] 5.1 `frontend/AGENTS.md`: „Eine Heimat je Zahl“ (Abschnittsstärke, Einheiten eines Abschnitts, UHS-Kräfte), „Eine Baumlogik der Kräfte“ (`loeseAbgestellte`), Organigramm (Platzierung nach D3), Zeile 1152 (Stärke EINMAL summieren). Grep auf `abschnittDerObersten` und „Abschnitt ihrer obersten Einheit“ in Code-Kommentaren und `docs/` ist leer.
- [ ] 5.2 Anwenderdoku nach `docs/anwender/AGENTS.md`: `meldebild.md` (Zeile „n von m“, Stärke und Filter „Abschnitt“ mit abgestellter Untereinheit), `einsatzabschnitte.md` (Stärke zählt, wer im Abschnitt steht, Liste mit eigener Stärke, Organigramm), `lagebild.md`/`lagemonitor.md` (Kräfte an UHS nur aktive). Bilder mit sichtbarer Zahl über den Bildlauf erneuern. Wächter der Anwenderdoku grün.
- [ ] 5.3 `mise exec -- openspec validate rwfa43cy-staerke-eine-zaehlweise --strict` und `./scripts/check-all.sh --geaendert --ohne-e2e` grün.

## 6. Befunde aus dem Review (16.11.2026, D3, D4, D8)

- [ ] 6.1 `src/geraet/abschnitt.rs`: `Abschnittsbereich::laden` über den wirksamen Abschnitt (D8). Rust-Test zuerst: Untereinheit ohne eigenen Abschnitt unter einer Einheit im Teilbaum gehört dazu, abgestellte mit Abschnitt außerhalb nicht, aufgelöste Obereinheit vererbt nicht, Zyklus hängt nicht. `cargo test` des Moduls grün.
- [ ] 6.2 `fuehrungsorganisation.ts`: Option `abgestellteLoesen` (Vorgabe `true`); `fernmeldewesen/fernmeldeskizze.ts:baueFernmeldenetz` ruft mit `false`. Test: in der Skizze hängt die abgestellte Gruppe am Zug, im Organigramm unter ihrem Abschnitt. Delta-Spec `fuehrungsorganisation` dazu.
- [ ] 6.3 Liste „Zugeordnete Einheiten“: Griff trägt den wirksamen Abschnitt; Test, dass Ziehen auf denselben Abschnitt gesperrt ist (`canDropEinheit`).
- [ ] 6.4 `pages/lagekarte/leistenDaten.ts`: Einheiten eines Abschnitts über `einheitenImAbschnitt`; Test mit geerbter Untereinheit und aufgelöster Einheit.
- [ ] 6.5 Kopfkommentar `kraefte/einheitenGliederung.ts`: `ist_kumuliert` gleicht Einheit-Ansicht und `summiereStaerke`, nicht der Abschnittsstärke.
- [ ] 6.6 `EinsatzabschnittePage.test.tsx`: Fall mit geerbter Gruppe, `ist` ≠ `ist_kumuliert`, Liste zeigt „eigene“ und „über <Obereinheit>“, Summe = Stärke. Mutationsprobe: mit `ist_kumuliert` rot.
- [ ] 6.7 `LageDashboardPage.test.tsx`: neuer UHS-Test nicht zwischen Kommentar und seinem Test.
- [ ] 6.8 Anwenderdoku `geraet-einsatzabschnitt.md`: Einheitenliste umfasst Untereinheiten mit geerbtem Abschnitt; Wächter grün.

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“).
- `/opsx:archive rwfa43cy-staerke-eine-zaehlweise` vor dem PR, im selben Branch.
- Bilder der Änderung in PR und Meldung (Gliederung EA 1.1, Meldebild mit abgestellter Gruppe, Zeile „n von m“, Lagebild-Notiz).
