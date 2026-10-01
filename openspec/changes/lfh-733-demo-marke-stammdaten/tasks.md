# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (erst der rote Test, dann der
Code). Vor jedem „fertig“ gelten `superpowers:verification-before-completion` und
`superpowers:requesting-code-review`.

## 1. Backend — Stammdaten melden `ist_demo` (D1, D3)

- [x] 1.1 Fahrzeug: `ist_demo` in `SPALTEN` (`EXISTS … demo_herkunft … 'fahrzeug' … fahrzeug.id`), in `Fahrzeug` und `FahrzeugAnzeige` (Pflicht-`bool`) und in `anzeige()`. Testliteral in `src/fahrzeug/mod.rs` nachziehen. Beleg: ein Repo-Test, der eine Zeile per `demo_herkunft` markiert und `liste` (alle und `nur_im_dienst`) und `laden` mit `true` bzw. eine unmarkierte Zeile mit `false` sieht. Erst rot, dann grün.
- [x] 1.2 Personal: dasselbe für `personal` (`SPALTEN`, `Personal`, `PersonalAnzeige`, `zu_anzeige`). Beleg: ein Repo-Test für `liste_anzeige` und `laden` (markiert/unmarkiert).
- [x] 1.3 Material: dasselbe für `material` (`SPALTEN`, `Material`, `MaterialAnzeige`, `anzeige()`, Testliteral in `src/material/mod.rs`). Beleg: ein Repo-Test für `liste` und `laden`.
- [x] 1.4 Durchgang über den Import: In `src/demo/stammdaten_tests.rs` gilt nach einem Import: angelegte Zeilen melden in den Stammdaten-Listen `ist_demo: true`, mitbenutzte `false`. Nach dem Entfernen meldet eine behaltene Zeile `false`. Beleg: `cargo test demo::` grün.

## 2. Backend — Dispositionen melden `ist_demo` (D2)

- [x] 2.1 `EinsatzFahrzeugAnzeige.ist_demo`: `EXISTS` gegen `ef.fahrzeug_id` in `SELECT_AUFGELOEST`, Feld in `Row` und in `zu_anzeige`. Beleg: ein Test in `disposition_repo`, in dem ein markiertes Stamm-Fahrzeug `true` meldet und ein Ad-hoc-Fahrzeug `false`.
- [x] 2.2 `EinsatzPersonalAnzeige.ist_demo` analog (`ep.personal_id`). Beleg: derselbe Testpaar-Zuschnitt.
- [x] 2.3 `EinsatzMaterialAnzeige.ist_demo` analog (`em.material_id`). Beleg: derselbe Testpaar-Zuschnitt.
- [x] 2.4 Weitere Konstruktoren der drei `Einsatz…Anzeige` suchen (`rg 'EinsatzFahrzeugAnzeige \{|EinsatzPersonalAnzeige \{|EinsatzMaterialAnzeige \{' src`) und mitziehen. Beleg: `cargo build --all-targets` ohne Fehler.

## 3. Typ-Codegen

- [x] 3.1 `scripts/check-typ-codegen.sh` laufen lassen und `frontend/src/api/openapi.json` sowie `frontend/src/api/types.generated.ts` neu erzeugen. Beleg: Das Skript ist grün, beide Dateien zeigen `ist_demo: boolean` als Pflichtfeld an den sechs Schemata.
- [x] 3.2 Frontend-Fixtures nachziehen, die `Fahrzeug`, `Personal`, `Material`, `EinsatzFahrzeug`, `EinsatzPersonal` oder `EinsatzMaterial` bauen. Vorhandene Fabriken bekommen den Default `ist_demo: false`. Beleg: `mise exec -- pnpm -C frontend exec tsc --noEmit` ohne Fehler.

## 4. Frontend — Marke und Kataloge (D5)

- [x] 4.1 `components/DemoMarke.tsx`: antd-`Tag` ohne `color`, Text „Demo“, `title="Stammdaten aus dem Demo-Import"`. Beleg: Komponententest, der den Text „Demo“ findet und kein `color`-Attribut bzw. keine Farbklasse `ant-tag-<farbe>` sieht.
- [x] 4.2 `stammdaten/FahrzeugeTab.tsx`, `PersonalTab.tsx`, `MaterialTab.tsx`: Marke neben der Leitspalte bei `ist_demo`. Der Suchkorpus über `dataIndex` bleibt unverändert. Beleg: je Tab ein Test mit einer Demo-Zeile und einer echten Zeile, nur die Demo-Zeile zeigt „Demo“.
- [x] 4.3 `stammdaten/FahrzeugDetailPage.tsx` und `PersonalDetailPage.tsx`: Marke im Seitenkopf bei `ist_demo`. Beleg: je ein Test, der „Demo“ für einen Demo-Datensatz zeigt und für einen echten nicht.

## 5. Frontend — Auswahllisten gruppieren (D4)

- [x] 5.1 `stammdaten/demoAuswahl.tsx`: reine Funktion, die echte Einträge flach und in der Eingangsreihenfolge vorn liefert, danach (nur wenn vorhanden) die Gruppe „Demo-Daten“ mit Labels aus Text und `DemoMarke`. Am Kopf steht der Hinweis auf `optionFilterProp`, falls später `showSearch` kommt. Beleg: Unit-Tests für gemischt, nur echte (keine Gruppe) und nur Demo.
- [x] 5.2 `pages/FahrzeugePage.tsx`, `PersonalPage.tsx`, `MaterialPage.tsx`: Die Pool-Optionen kommen aus dem Helfer. Der Disponier-Filter (`disponierteIds`) bleibt vor dem Helfer. Beleg: In den bestehenden Seiten-Tests zeigt das geöffnete Auswahlfeld mit einem echten und einem Demo-Eintrag die Gruppe „Demo-Daten“ hinter dem echten Eintrag. Das Wählen des Demo-Eintrags löst die Disposition mit seiner ID aus.

## 6. Frontend — Einsatz-Tabellen

- [x] 6.1 `pages/FahrzeugePage.tsx`, `PersonalPage.tsx`, `MaterialPage.tsx`: `DemoMarke` neben Funkrufname, Name bzw. Bezeichnung bei `ist_demo`, neben der `ad-hoc`-Marke. Beleg: je Seite ein Test, in dem eine Demo-Disposition „Demo“ zeigt und eine echte nicht.

## 7. Regeln und Abschluss

- [x] 7.1 Regel zweigeteilt (Review-Finding): `src/AGENTS.md`, Abschnitt „Demo-Daten zur Laufzeit“, trägt die Server-Hälfte („ist Demo“ nur live aus `demo_herkunft`, `ist_demo` in Stamm- und Dispositions-Antworten). `frontend/AGENTS.md`, „Farbe und Zeichen“, trägt die Darstellung (nur `components/DemoMarke.tsx`, Gruppierung nur über `stammdaten/demoAuswahl.tsx`). Beide verweisen auf das Archiv dieser Change. Beleg: `rg DemoMarke frontend/AGENTS.md` und `rg demo_herkunft src/AGENTS.md` treffen.
- [ ] 7.2 `./scripts/check-all.sh` grün (Format, Lint, Typen, Codegen, Tests, OpenSpec-Archiv-Wächter). Beleg: Ausgabe des Laufs bzw. die CI des PRs.
- [ ] 7.3 Prüfung im laufenden Stack (`cargo run --features dev-seeds -- --demo-daten`, Vite-Dev-Server): importieren, Fahrzeugkatalog zeigt „Demo“, in einem echten Einsatz steht die Gruppe „Demo-Daten“ am Ende der Fahrzeugauswahl, ein disponiertes Demo-Fahrzeug zeigt „Demo“ in der Tabelle, nach dem Entfernen ist die Marke am behaltenen Fahrzeug weg. Beleg: Notiz mit dem Ergebnis im PR.
