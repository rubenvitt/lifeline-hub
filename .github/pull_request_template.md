ClickUp: LFH-

<!--
Die Zeile oben verknüpft den Pull Request mit dem Task auf dem Entwicklungsboard. Sie ist
kein Schmuck: die ClickUp-Integration liest sie (und den Branch-Namen im Format
`<typ>/lfh-<nnn>-<slug>`) und hängt PR und Status an den Task. Ohne Nummer bleibt der Task
auf „in development" stehen, während der PR längst gemergt ist.
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
