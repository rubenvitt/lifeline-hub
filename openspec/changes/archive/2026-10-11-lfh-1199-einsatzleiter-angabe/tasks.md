# Tasks

Jede Aufgabe entsteht per TDD: zuerst der Test, rot belegt, dann die Umsetzung.

## 1. Sofortschritt Kopfleiste (Route `klar`, eigener Commit)

- [x] 1.1 Test zuerst in `pages/EinsatzdatenPage.test.tsx`: Ein Mitglied „Administrator“ trägt
  die Rolle `einsatzleitung`, und die Führungsstelle hat keinen Einsatzleiter. Erwartet unter
  „Einsatzleitung“ gedämpft „nicht erfasst“, „Administrator“ fehlt dort, und es gibt keine
  Bearbeiten-Aufforderung. Nachweis: rot belegt.
- [x] 1.2 `EinsatzdatenPage.tsx`: Die Ableitung aus `einsatz_rolle` entfällt, `KopfAngabe` bekommt
  die gedämpfte Form „nicht erfasst“, und ein Code-Kommentar verweist auf LFH-1199. Nachweis:
  1.1 grün, bestehende Seitentests grün.

## 2. Backend: Datenhaltung und API (D1, D2)

- [x] 2.1 Migration `0177_einsatz_fuehrungsstelle_einsatzleiter.sql` nach D1 anlegen. Nachweis:
  `scripts/check-migrationen.sh` grün gegen `origin/alpha`, und `db::tests` grün.
- [x] 2.2 Test zuerst in `tests/einsatz_fuehrungsstelle.rs`. Abgedeckt sind:
  - Setzen als Person und als Freitext, Leeren mit `null`, fehlendes Feld lässt den Wert stehen,
  - fehlendes „seit“ ergibt die Serverzeit,
  - 400 für unbekannte Art, leeren oder zu langen Namen und unlesbares „seit“,
  - 422 für eine Person eines anderen Einsatzes, Person und Freitext zugleich und „seit“ in der
    Zukunft,
  - 409 an einem abgeschlossenen Einsatz,
  - ein Beobachter ohne Freigabe Personal liest den Namen,
  - eine entlassene Person bleibt mit `personal_noch_disponiert: false`,
  - ein abgelehnter Patch speichert nichts und meldet nichts.

  Nachweis: rot belegt.
- [x] 2.3 `src/einsatz/fuehrungsstelle.rs` und `src/routes/einsatz_fuehrungsstelle.rs` umsetzen.
  Dazu gehören `EinsatzleiterArt` per `wire_enum!` samt Pin in `tests/enum_wire_kontrakt.rs`,
  `EinsatzleiterAnzeige`, das Patch-Feld, `EINSATZLEITER_NAME_MAX` mit Spiegel in
  `api/eingabegrenzen.ts` und `tests/eingabegrenzen_spiegel.rs` sowie der Aktiv-Check in der
  Transaktion (`stab::repo::fordere_aktiv_in_tx`, auf `pub(crate)` erweitert, D3). Nachweis: 2.2
  grün, bestehende Tests der Führungsstelle und des Stabs grün.

## 3. Backend: Übergabe im ETB (D3)

- [x] 3.1 Test zuerst. Folgende Fälle sind abgedeckt:
  - Erstes Setzen, Wechsel und Leeren erzeugen je genau einen System-Eintrag im Wortlaut der Spec,
    mit Ereigniszeit = „seit“ (beim Leeren jetzt).
  - Gleiche Person mit anderem „seit“ erzeugt keinen Eintrag, ebenso eine Änderung nur am
    Rufnamen.
  - Nach dem Commit kommt das ETB-Ereignis, bei einem Fehler nichts.
  - Scheitert das ETB, scheitert die ganze Änderung.

  Nachweis: rot belegt.
- [x] 3.2 Umsetzung im `write_retry!` des PATCH: Vorher-Stand, Snapshot, Vergleich des
  Fachstands, `etb::repo::anlegen_tx`, nach dem Commit `publiziere`. Nachweis: 3.1 grün.

## 4. Backend: Schwärzung, Aufbewahrung, Codegen (D4)

- [x] 4.1 Test zuerst: Der Schwärzungstest der Führungsstelle leert Name und Erreichbarkeit und
  behält Art, Seit, FK, Rufname und Sprechgruppen. Nachweis: rot belegt, die Guards des Registers
  rot ohne Einträge.
- [x] 4.2 Einträge im Register, in `PERSONENBEZUEGE` und in `AUSNAHMEN_SYSTEM_ETB`. Nachweis: 4.1
  grün, ebenso `jede_einsatz_scoped_spalte_ist_klassifiziert`,
  `jeder_personenverweis_ist_als_bezug_deklariert` und `tests/aufbewahrung_e2e.rs`.
- [x] 4.3 `scripts/check-typ-codegen.sh`, danach `openapi.json`, `types.generated.ts` und
  `FuehrungsstellePatch` in `api/types.ts` nachziehen. Nachweis: Skript grün, beide generierten
  Dateien im Commit.

## 5. Frontend: eine Darstellung (D5)

- [x] 5.1 Test zuerst `stab/einsatzleiter.test.ts`. Fälle: Person, extern, „nicht mehr
  disponiert“, nicht erfasst, gesperrt, nicht geladen und lädt. Dazu der Markdown-Text mit
  Zeitzone und Markdown-Zeichen im Namen als Text, außerdem `fuehrungsstelleErfasst` mit nur einem
  Einsatzleiter. Nachweis: rot belegt.
- [x] 5.2 `stab/einsatzleiter.ts` umsetzen und `stab/fuehrungsstelle.ts:fuehrungsstelleErfasst`
  erweitern. Nachweis: 5.1 grün, ebenso die Tests von Funkplan, Lücken und Skizze.

## 6. Frontend: Paneelzeile und Kopfleiste (D6)

- [x] 6.1 Test zuerst in `EinsatzdatenPage.test.tsx`. Abgedeckt sind:
  - Person wählen und Freitext übernehmen, die Anfrage trägt nur `einsatzleiter`,
  - leeres „seit“ wird nicht gesendet,
  - unveränderte Wahl sendet nichts,
  - „Einsatzleiter leeren“ sendet `null`,
  - ohne Freigabe Personal gibt es nur Freitext mit Hinweis,
  - ein Beobachter sieht keine Aufforderung,
  - der Fehler steht an der Zeile,
  - die Kopfleiste zeigt den Namen aus der Führungsstelle.

  Nachweis: rot belegt.
- [x] 6.2 Zeile „Einsatzleiter“ im `FuehrungsstellePaneel` und die Kopfleiste über
  `einsatzleiterDarstellung`. Nachweis: 6.1 grün, ebenso `pnpm lint` und `tsc`.

## 7. Frontend: Organigramm, Lagebericht, Funkplan, Einsatzbericht

- [x] 7.1 Test zuerst:
  - `fuehrungsorganisation.test.ts` und `Organigramm.test.tsx`: Wurzel und Markdown mit
    Einsatzleiter, nicht erfasst, Grund.
  - `eigeneLageUebernahme.test.ts`: Einsatzleiter im Text, gesperrt solange die Quelle lädt.

  Nachweis: rot belegt.
- [x] 7.2 `fuehrungsorganisation.ts`, `Organigramm.tsx` und `lageberichte/eigeneLageUebernahme.ts`
  umsetzen und die D5-Kommentare auf LFH-1199 umstellen. Nachweis: 7.1 grün.
- [x] 7.3 Test zuerst in `stab/funkplan.test.tsx` und `FunkplanPage.test.tsx`: Zeile `fs` mit Name
  in Leiter/Führer, „—“ ohne Einsatzleiter, Markdown mit dem Etikett „Einsatzleiter“. Danach
  `stab/funkplan.ts` umsetzen. Nachweis: rot belegt, dann grün.
- [x] 7.4 Test zuerst `druck/einsatzbericht/verdichtung.test.ts` und `Bloecke.test.tsx`:
  Einsatzleitung = Einsatzleiter mit „seit“, Rollenkonten fehlen, „nicht erfasst“. Danach Quelle
  `fuehrungsstelle` in `quellen.ts`/`abruf.ts` und `verdichtung.ts`. Nachweis: rot belegt, dann
  grün, Druck-Guard grün.

## 8. Regeln, Herleitungen, Doku

- [x] 8.1 Die Hinweiszeilen in den archivierten Designs von LFH-626 (D5) und LFH-849 (Non-Goals)
  ergänzen (D8) und `frontend/src/stab/AGENTS.md` nachziehen. Nachweis: Prettier über `frontend/`
  grün, `grep -rn "LFH-849\|D5" frontend/src` zeigt nur aktuelle Aussagen.
- [x] 8.2 Anwenderdoku nachziehen (`docs/anwender/AGENTS.md`, Mitänderungsregel):
  - `einsatzdaten.md`: Überblick zur Kopfleiste, Ablauf „Die eigene Führungsstelle erfassen“ mit
    sechs Zeilen und dem Einsatzleiter, Hintergrund mit dem ETB-Eintrag,
  - `einsatzabschnitte.md`: Organigramm,
  - `funkplan.md`: Spalte Leiter/Führer der Führungsstelle,
  - `einsatzabschluss.md`: Einsatzbericht, Block Führung.

  Nachweis: `anwenderdoku.guard.test.ts` grün.
- [x] 8.3 Bilder neu erzeugen (`pnpm doku:bilder --grep einsatzdaten|einsatzabschnitte|funkplan`,
  hell und dunkel, je höchstens 300 KB). Nachweis: Bilder im Commit, Guard grün. Geht es in der
  Sitzung nicht, steht der Grund hier, und die CI des PRs belegt die Bilder.

## 9. e2e und Gate

- [x] 9.1 e2e: Einsatzleiter auf Einsatzdaten setzen und wechseln. Danach zeigen Kopfleiste,
  Organigramm und Funkplan denselben Namen, und das ETB trägt genau einen Übergabe-Eintrag.
  Eigene Spec `e2e/einsatzleiter.spec.ts`. Nachweis: Spec grün (Chromium, Lauf 11.10.2026).
- [x] 9.2 `./scripts/check-all.sh` grün, dazu Vitest und Rust-Tests vollständig. Nachweis: Lauf
  ohne Fehler, Kästchen mit Verweis auf diesen Lauf bzw. die CI des PRs abhaken.

  Lauf 11.10.2026 (Cloud-Sitzung, Chromium): Bündel `schnell` grün; Vitest voll mit
  `TZ=Europe/Berlin` grün (ein Abruf-Mock nachgezogen); Rust: `--lib`, `einsatz_fuehrungsstelle`,
  `enum_wire_kontrakt`, `eingabegrenzen_spiegel`, `aufbewahrung_e2e`, `openapi_spec_aktuell`
  grün; e2e `einsatzleiter.spec.ts` grün. Den vollen Rust-Workspace und die ganze e2e-Suite trägt
  die CI des PRs (die Sitzung hat nicht den Platz für alle ~160 Testbinaries).