ClickUp: #LFH-

<!--
DIE RAUTE GEHÖRT DAZU, UND DIE KENNUNG WIRD GROSS GESCHRIEBEN.

Die ClickUp-Integration sucht eine Task-Kennung in PR-Titel, PR-Beschreibung, Branch-Namen
und Commit-Nachrichten. Ohne die Raute erkennt sie nichts — die Zeile ist dann bloß Text, und
der Task bleibt auf „in development" stehen, während der PR längst gemergt ist. Custom-IDs
tragen in ClickUp immer Großbuchstaben (`LFH-527`), ein kleingeschriebenes `lfh-527` wird
nicht gefunden.

Das ist auch der Grund, warum die Verknüpfung hier steht und nicht am Branch-Namen hängt: die
Branch-Konvention `<typ>/lfh-<nnn>-<slug>` ist kleingeschrieben, wie in Git üblich. Die
Commit-Nachrichten dieses Projekts tragen die Kennung ohnehin groß im Body — das ist der
zweite Weg, auf dem ClickUp den Task findet.

Optional lässt sich ein Zielstatus anhängen: `#LFH-527[in review]` setzt den Task beim
Erkennen direkt dorthin.
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
