Zunder: https://zunder.rubeen.dev/#/aufgabe/

<!--
Vollständiger Link auf die Aufgabe, mit UUID. Eine Integration liest die Zeile nicht: sie ist
für Menschen. Die Gegenrichtung trägt die Aufgabe selbst (`pr_url`, gesetzt von
`dev-zunder-ausfuehren`), ebenso den Status — `review` bei offenem PR, `done` nach dem Merge.

Branch `<typ>/<kurz>-<slug>` mit den ersten 8 Hex-Zeichen der UUID; Commit-Bodys tragen dieselbe
`Zunder:`-Zeile. Ältere PRs nennen `#LFH-<n>` aus der ClickUp-Zeit, die bleiben gültig.
Konvention: `AGENTS.md`, Abschnitt „Zunder“.
-->

## Was ändert sich

<!-- Aus Bediensicht: was sieht oder kann jemand danach, was vorher nicht ging? Rein interne
     Änderungen als solche benennen statt sie zum Feature aufzublasen. -->

## Warum so

<!-- Die eine Entscheidung, die beim Lesen des Diffs nicht offensichtlich ist. Verworfene
     Alternativen gehören hierher, nicht in den Code. -->

## Geprüft

<!-- `./scripts/check-all.sh` ist die Untergrenze, nicht der Nachweis. Was wurde GEMESSEN
     statt angenommen? Bei UI-Änderungen: welcher Klickweg, welche Dichtestufe, welcher
     Browser? -->

- [ ] `./scripts/check-all.sh` grün
- [ ] Bei Backend-Typänderungen: `openapi.json` + `types.generated.ts` mitcommittet
- [ ] Bei neuer/umgebauter Seite: Prüfliste Einsatztauglichkeit ausgefüllt (15 Kriterien)
- [ ] Anwenderdoku (`docs/anwender/`) nachgezogen oder nicht betroffen, Bilder neu erzeugt
      (`pnpm doku:bilder --grep <kapitel>`) oder keine fotografierte Ansicht geändert
      (Mitänderungsregel in `docs/anwender/AGENTS.md`)
