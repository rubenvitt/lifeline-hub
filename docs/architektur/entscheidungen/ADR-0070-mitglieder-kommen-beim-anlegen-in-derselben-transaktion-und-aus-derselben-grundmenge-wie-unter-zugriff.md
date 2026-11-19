---
id: ADR-0070
titel: Mitglieder kommen beim Anlegen in derselben Transaktion und aus derselben Grundmenge wie unter „Zugriff“
status: akzeptiert
datum: 2026-11-19
gilt_fuer:
  - src/einsatz/repo.rs
  - src/routes/einsatz.rs
herleitung:
  - docs/superpowers/specs/2026-11-19-efvk5rbs-verwaltung-uebersicht-mitglieder-design.md
---

# ADR-0070: Mitglieder kommen beim Anlegen in derselben Transaktion und aus derselben Grundmenge wie unter „Zugriff“

## Regeln

- MUST: Mitglieder aus `NeuerEinsatz.mitglieder` werden in derselben `write_retry!`-Transaktion
  wie `anlegen_tx` geschrieben (`einsatz::repo::anlegen_mit_mitgliedern`); scheitert eine
  Person, entsteht kein Einsatz.
- MUST NOT: kein Weg, der nach dem Anlegen je Person `PUT …/mitglieder/{id}` ruft, um die Wahl
  aus dem Dialog nachzutragen.
- MUST: Jede Personenauswahl und jeder Schreibweg, der eine Person aufnimmt, nimmt die Grundmenge
  aus `einsatz::repo::auswahl_sql` (bzw. dieselbe Bedingung im INSERT); eine zweite Kopie der
  Filter für Geräte-, Stellvertreter- und deaktivierte Konten entsteht nicht.
- SHOULD: Regeln zum Schreibweg selbst stehen in `src/AGENTS.md`, „Einsatz anlegen mit
  Mitgliedern“.

## Prüfung

```sh
verlange '^pub async fn anlegen_mit_mitgliedern' 'src/einsatz/repo.rs'
verlange '^fn auswahl_sql' 'src/einsatz/repo.rs'
verlange 'repo::anlegen_mit_mitgliedern' 'src/routes/einsatz.rs'
```

## Kontext

Bis LLH-1820 nahm `anlegen_tx` nur die anlegende Person auf; alle weiteren kamen einzeln über
„Zugriff“. Der Dialog „Neuen Einsatz anlegen“ wählt jetzt Personen vorab. Nacheinander
gerufene Aufnahmen könnten einen Einsatz mit halber Besetzung hinterlassen, und eine zweite
Filterkopie liefe beim nächsten neuen Kontotyp auseinander.

## Konsequenzen

Einsatz und Besetzung entstehen ganz oder gar nicht. Die Auswahl im Dialog und unter „Zugriff“
bieten dieselben Personen an; ein neuer Kontotyp wird an einer Stelle ausgeschlossen.
`NeuerEinsatzDaten` bleibt unverändert, Demo-Import und Planungsübernahme sind nicht betroffen.
