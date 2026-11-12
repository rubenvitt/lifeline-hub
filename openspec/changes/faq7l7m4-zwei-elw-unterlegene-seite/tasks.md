# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der Test, der ohne die Änderung rot
ist, dann der Code. Tests im Backend mit `cargo test --test instanz_fuehrung <name>`.

## 1. Erkennen an der meldenden Seite (design.md D2, D3, D6)

- [ ] 1.1 Testhelfer für drei Instanzen in `tests/instanz_fuehrung.rs`: Hub und zwei ELW derselben Hub-Org, je eine Hilfe „ohne Verbindung“ und „wieder verbunden“ (Adresse der Kopplung). Ein Einsatz am Hub mit unterschiedlichem Kenntnisstand der Zähler je ELW ohne rohes `UPDATE`, also über echte Übergaben und Anfragen. Verifikation: Der Helfer läuft im ersten Test unten.
- [ ] 1.2 Test `zwei_elw_die_spaetere_mit_groesserer_epoche_haelt_die_fuehrung_der_anderen_offen`: ELW B kennt Zähler 1, ELW A Zähler 3. Beide erklären ohne Verbindung die Notübernahme ((2,B) und (4,A)), B meldet sich zuerst, dann A zweimal. Erwartet: Der Hub führt mit B, an A ist eine Übernahme offen mit `konflikt: true`, A schreibt weiter (ETB 200), und die Einsatzleitung von A hat `fuehrung_uebernommen`. Belegt den Zweig `Less`. Verifikation: rot auf dem Stand vor 1.5, grün danach.
- [ ] 1.3 Test `zwei_elw_die_spaetere_mit_kleinerer_epoche_haelt_die_fuehrung_der_anderen_offen`: wie 1.2, aber A meldet sich zuerst. Erwartet: Der Hub führt mit A, an B ist eine Übernahme offen. Belegt den Zweig `Greater`, `!von_sender`. Verifikation: rot vor 1.5, grün danach.
- [ ] 1.4 Test `nach_der_uebergabe_an_elw_1_haelt_elw_2_ihre_fuehrung_offen_ohne_alarm`: Der Hub gibt auf Anfrage an ELW 1 ab und ist dabei so weit gezählt, dass seine Epoche größer ist als die Notübernahme von ELW 2 vom alten Stand. Erwartet: An ELW 2 ist die Übernahme offen mit `konflikt: true`, kein `fuehrung_ungueltig`, keine Admin-Spur `fuehrung_verworfen`, Art nicht `verworfen`. Belegt den Zweig `Greater`, `von_sender`. Verifikation: rot vor 1.5, grün danach.
- [ ] 1.5 `apply_eingang` in `src/instanz/fuehrung/austausch.rs`: An der meldenden Seite gilt „ich führe, der Hub nennt einen Dritten“ als Konflikt. Die Prüfung steht vor der Fallunterscheidung nach der Epoche und hält die Akte über denselben Weg offen wie `Entscheid::OffenHalten`, ohne neue Schreibung bei gleichem Inhalt. Dazu `ist_konflikt(&AkteMeldung, &Ich)` als einzige Ableitung (D3), mit Unit-Tests für die drei Fälle: gültige Erklärung gegen mich, keine Erklärung, Erklärung gegen eine andere Instanz. Verifikation: 1.2 bis 1.4 und `cargo test --lib instanz::fuehrung` grün.
- [ ] 1.6 Test und Umsetzung „Konflikt erlischt“ (D6): Nennt der Hub danach wieder den Hub oder die ELW selbst als Führer, leert die ELW `offen` und meldet den Kopf. Nachbauen über ELW 1, die an den Hub zurück übergibt. Verifikation: Test `der_konflikt_erlischt_wenn_der_hub_keinen_dritten_mehr_nennt` rot vor der Änderung, danach grün. Danach nimmt der Hub die Epoche der ELW an.
- [ ] 1.7 Den alten Test `gleichstand_entscheidet_die_groessere_kennung_an_beiden_seiten` entfernen. Er baut einen Zustand per rohem `UPDATE`, der zwischen zwei Instanzen nicht entstehen kann (design.md, Context); 1.2 und 1.3 ersetzen ihn. `ein_elw_nimmt_einem_anderen_elw_die_fuehrung_nicht` bleibt unverändert grün. Verifikation: `cargo test --test instanz_fuehrung` grün.

## 2. Bestätigen und Widersprechen (design.md D4, D5)

- [ ] 2.1 Test `bestaetigen_des_konflikts_macht_die_unterlegene_elw_zum_spiegel`: Auf dem Stand aus 1.2 (Epoche des Hubs kleiner als die eigene) bestätigt die Einsatzleitung an A. Erwartet: A führt nicht mehr, Epoche und Führer wie am Hub, Verlauf mit Bruchstelle, ETB-Schreiben 409. Zwei weitere Meldungen ändern an keiner Seite die Akte (ruhiger Takt). Verifikation: rot vor 2.3, grün danach.
- [ ] 2.2 Test `widerspruch_gegen_den_dritten_ist_422`: auf dem Stand aus 1.3. Verifikation: rot vor 2.3 (heute antwortet der Server 200), grün danach.
- [ ] 2.3 `bestaetigen` und `widersprechen` in `src/instanz/fuehrung/dienst.rs` für den Konflikt nach D4 und D5. Der Grund im Verlauf lautet „Notübernahme hat am Hub nicht gegriffen, Führung bei <Name>“. Die bisherigen Prüfungen für gültige Übernahmen bleiben unverändert. Verifikation: 2.1 und 2.2 grün, dazu `notuebernahme_mit_unterschrift_wartet_am_elw_auf_bestaetigung` und `widerspruch_heisst_rueckuebernahme`.

## 3. Anzeige (design.md D3)

- [ ] 3.1 `FuehrungOffen.konflikt: bool` in `dienst::anzeige` aus `ist_konflikt` füllen. Danach `scripts/check-typ-codegen.sh` laufen lassen und `frontend/src/api/openapi.json` sowie `types.generated.ts` mitcommitten. Verifikation: Der Codegen-Check ist grün, und 1.2 prüft `konflikt` in der Antwort.
- [ ] 3.2 `FuehrungHinweisband.tsx` und `UebernahmeEntscheidung` (`FuehrungPaneel.tsx`): Bei `konflikt` lautet der Titel „Deine Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei <Name>“ und die einzige Aktion „Übernahme bestätigen“. Ohne `konflikt` bleibt alles wie bisher. Verifikation: neue Fälle in `FuehrungHinweisband.test.tsx` und `FuehrungPaneel.test.tsx` (Titel, kein `fuehrung-widersprechen`), dazu `mise exec -- pnpm -C frontend test --run src/instanz` und Lint grün.

## 4. Doku

- [ ] 4.1 `docs/anwender/kapitel/instanzkopplung.md`: Den Satz zum Gleichstand ersetzen. Neu beschrieben wird der Fall zweier ELW am selben Hub mit Band, „Übernahme bestätigen“ und dem fehlenden Widerspruch. Zeigt ein Bild des Kapitels das Hinweisband, die Bilder neu erzeugen (`docs/anwender/AGENTS.md`, Mitänderungsregel). Verifikation: `anwenderdoku.guard.test.ts` grün.
- [ ] 4.2 Neue ADR `ADR-<nächste freie>-unter-mehreren-elw-gilt-die-zuerst-angenommene-fuehrung.md` (Nummer nach `git fetch origin alpha` und einem Blick auf offene PRs), `status: akzeptiert`, `gilt_fuer` `src/instanz/fuehrung/**`, Regeln aus D1 bis D5, Herleitung auf das Archiv-`design.md` dieser Change. Kapitel 6.6c (`docs/architektur/06-laufzeitsicht.md`) bekommt einen Satz zur unterlegenen ELW. Verifikation: `scripts/check-architektur.sh` grün.

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh` ist grün. Belegt durch den Lauf vor dem PR oder die CI des PRs; das Kästchen wird mit Verweis auf diesen Lauf abgehakt.

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde behandeln.
- `/opsx:archive faq7l7m4-zwei-elw-unterlegene-seite` im selben Branch vor dem PR, Verweise auf den Pfad der Change nachziehen (Herleitung der ADR).
- PR gegen `alpha` mit dem Abschnitt „Review“ und Bildern des Hinweisbands im Konflikt.
