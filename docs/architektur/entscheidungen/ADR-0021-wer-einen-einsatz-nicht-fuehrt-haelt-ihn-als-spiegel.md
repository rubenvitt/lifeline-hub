---
id: ADR-0021
titel: Ein Einsatz hat genau eine führende Instanz; wer ihn nicht führt, hält ihn als Spiegel
status: akzeptiert
datum: 2026-11-11
ersetzt: ADR-0020
gilt_fuer:
  - src/instanz/fuehrung/**
  - src/instanz/spiegel/fuehrung.rs
  - src/einsatz/berechtigung.rs
  - src/einsatz/repo.rs
  - src/einsatz/kontext.rs
  - frontend/src/einsatz/schreibrecht.ts
herleitung:
  - openspec/changes/archive/2026-11-09-v6hj7xl2-fuehrung-epoche/design.md
  - docs/konzepte/2026-10-29-instanzkopplung-elw-hub.md
  - LLH-1641 (Entwurf E1–E8, mit Ruben am 11.11.2026 abgestimmt)
  - LLH-1647 (Führungsakte bei Verwahrung, Entwurf E1–E4, mit Ruben am 11.11.2026 abgestimmt)
---

# ADR-0021: Ein Einsatz hat genau eine führende Instanz; wer ihn nicht führt, hält ihn als Spiegel

## Regeln

- MUST: Die Akte (`einsatz_fuehrung`) entscheidet, wer führt; der Einsatz folgt ihr in derselben
  Transaktion (`repo::save` → `spiegel::fuehrung::richte_aus`). Nennt die Akte eine andere
  Instanz, ist der Einsatz hier ein Spiegel (ADR-0018), sonst nicht. Allein der Spiegel sperrt;
  eine eigene Sperre der Führung (`einsatz.fuehrung_bei`, ADR-0020) gibt es nicht mehr.
- MUST NOT: `einsatz_spiegel` legt außerhalb der Übernahme nur `spiegel::fuehrung` an oder
  entfernt sie (Führer werden, Spiegel werden).
- MUST: Eine Akte und der Spiegel desselben Einsatzes tragen dieselbe Kennung (`einsatz.kennung`,
  `<instanz>/<id>-<zufall>`); ein Spiegel bekommt keine eigene Akte.
- MUST: Übergabe und erfüllte Anfrage nur, wenn das Gegenüber alles hat
  (`spiegel::fuehrung::fordere_abgeglichen`, 409 „Abgleich läuft noch“); eine Notübernahme nur,
  wenn der Einsatz hier als Spiegel liegt.
- MUST: Die Bedienung der Führung zieht `EinsatzFuehrungszugriff` (ohne `fordere_aktiv`), nie ein
  Schreib-Gate.
- MUST: Die meldende Seite nimmt eine Epoche des Gegenübers, die ihr die Führung nimmt, nur mit
  geprüftem Beweis an (Unterschrift eines gültigen Schlüssels der Org oder Abgabecode) und erst
  nach der Entscheidung eines Menschen; sonst verwirft sie sie und vergibt die nächste Epoche
  selbst.
- MUST: Epochen werden als Paar (Zähler, Instanzkennung) verglichen; das größere gilt.
- MUST: Die Verwahrung (LLH-1494) wechselt die Führung: `umwandeln` vergibt die nächste Epoche
  mit Art `verwahrung` (`fuehrung::repo::verwahren`). Die meldende Seite lehnt sie ohne Alarm ab,
  solange sie die Übergabe nicht quittiert bekam; einen verwahrten Einsatz gibt niemand mehr ab.

## Prüfung

```sh
verlange 'spiegel::fuehrung::richte_aus' src/instanz/fuehrung/repo.rs
verbiete 'fuehrung_bei' 'src/**/*.rs' 'frontend/src/**/*.ts' 'frontend/src/**/*.tsx'
verbiete '(INSERT INTO|DELETE FROM) einsatz_spiegel' 'src/**/*.rs' ':(exclude,glob)src/instanz/spiegel/**' ':(exclude)src/einsatz/spiegel_filter.rs'
verlange 'fn fordere_abgeglichen' src/instanz/spiegel/fuehrung.rs
verlange 'pub struct EinsatzFuehrungszugriff' src/einsatz/kontext.rs
verlange 'pub fn entscheide\(' src/instanz/fuehrung/austausch.rs
verlange 'fuehrung::repo::verwahren\(' src/instanz/spiegel/lebensende.rs
verlange 'then_with\(\|\| self\.instanz\.cmp\(&other\.instanz\)\)' src/instanz/fuehrung/mod.rs
```

## Kontext

Gekoppelte Instanzen (ELW und Hub) arbeiten oft ohne Verbindung. Ein Zusammenführen paralleler
Schreibvorgänge gibt es nicht (Konzept, Entscheidung 2); stattdessen wandert die Führung mit
einer Epoche. Ein kompromittierter Hub darf sie einem ELW nicht nehmen können (Entscheidung 9).
ADR-0020 sperrte mit einer eigenen Spalte, solange Inhalte nicht flossen; seit dem Spiegel
(ADR-0018, LLH-1492) liegt der Einsatz an beiden Seiten in denselben Tabellen, und zwei Sperren
für dieselbe Sache liefen auseinander.

## Konsequenzen

Die Sperre ist der Schutz-Trigger des Spiegels (ADR-0018): Er deckt jeden Schreibweg, auch einen,
der `fordere_aktiv` vergisst, und die Oberfläche fragt nur `istSpiegel`. Ein Wechsel kippt die
Lieferrichtung: Der neue Führer liefert ab Stand 0 und nennt zu jeder Zeile, die er vom alten
Führer bekam, dessen Schlüssel (`Zeile.gegen`), damit dort keine zweite Zeile entsteht. Offene
Anträge eines Spiegels, der Führer wird, führt er selbst aus. Was der alte Führer nach dem
letzten bestätigten Stand noch änderte (Notübernahme, Abgabe per Code), sichert er beim Wechsel
als Bruchstelle (`einsatz_bruchstelle`) und entfernt, was der neue Führer nicht kennt. Fällt der
Schalter `LIFELINE_FUEHRUNG` nach einem Wechsel, bleibt der Stand eingefroren: Ein Spiegel wird
nicht wieder beschreibbar, sonst schrieben zwei Instanzen.
