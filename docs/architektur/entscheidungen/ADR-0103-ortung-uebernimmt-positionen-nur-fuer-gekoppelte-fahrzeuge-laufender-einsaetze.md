---
id: ADR-0103
titel: Die Ortung übernimmt eingeworfene Positionen nur für gekoppelte Fahrzeuge laufender Einsätze
status: akzeptiert
datum: 2026-11-25
gilt_fuer:
  - src/ortung/kopplung.rs
  - src/ortung/uebernahme.rs
  - src/routes/ortung.rs
  - src/public_api/einwurf/routen.rs
herleitung:
  - docs/superpowers/specs/2026-11-24-fjftaovq-fahrzeugortung-design.md
  - docs/superpowers/specs/2026-11-24-vakwvkpg-helfer-app-design.md
---

# ADR-0103: Die Ortung übernimmt eingeworfene Positionen nur für gekoppelte Fahrzeuge laufender Einsätze

## Regeln

- MUST: Die Übernahme ist ein eigener Schritt nach dem Commit des Einwurfs (`apply_position`); sie
  wirkt nicht auf dessen Antwort, Fehler der Übernahme werden verworfen. ADR-0023 gilt unverändert.
- MUST: Eine Position wird nur übernommen, wenn der Org-Schalter „Ortung im Einsatz“
  (`org_einstellungen.ortung_im_einsatz`, Helfer-App, ADR-0101) an ist und die Kennung an ein
  aktives Einsatzfahrzeug eines aktiven, nicht gespiegelten Einsatzes gekoppelt ist.
- MUST: Koppeln (PUT und Rücknahme einer Entlassung) verlangt denselben Schalter; aus ist ein
  Zustand und antwortet 422 (`src/AGENTS.md`, Statuscode-Konvention).
- MUST: Geschrieben wird nur über den Positionsbaustein `ortung::schreibe_position` mit Quelle
  `einwurf` und der Messzeit des Geräts, geklemmt mit `klemme_zeitpunkt`. Vorrang hat dessen
  Regel: der jüngere Zeitpunkt gewinnt, eine manuelle Position gilt beim Setzen immer.
- MUST: Je Fahrzeug schreibt die Übernahme höchstens alle 15 s (gemessen an
  `position_aktualisiert_at` der Einwurf-Position) und merkt sonst genau einen Nachlauf vor.
- MUST NOT: Es entsteht ein Positionsverlauf; je Fahrzeug und je Kennung gilt nur die letzte Position.
- MUST: Eine Kopplung endet mit Trennen, Entlassen, Stornieren, Ablehnen der Einheit und
  Einsatzabschluss, jeweils mit ETB-Eintrag in derselben Transaktion.
- MUST: Der Einsatzabschluss löscht die Positionen der Quelle `einwurf` über
  `ortung::loesche_position`, in derselben Transaktion wie `helfer::ende::beende_ortung_im_einsatz`;
  manuelle und Helfer-Positionen bleiben.
- MUST: Die Kandidatenliste und die Kopplung verlangen Schreibrecht am Einsatz
  (`EinsatzSchreibzugriff<Fahrzeuge>`); die Liste trägt keine Koordinaten.
- MUST NOT: Ein Protokoll trägt Kennung, Schlüssel oder Koordinaten.
- MUST: Die Live-Meldung folgt nach dem Commit, außerhalb von `write_retry!` (`ortung::publiziere`).

## Prüfung

```sh
verlange 'apply_position\(&state' src/public_api/einwurf/routen.rs
verlange "e.status = 'aktiv' AND e.spiegel = 0" src/ortung/uebernahme.rs
verlange 'o.ortung_im_einsatz = 1' src/ortung/uebernahme.rs
verlange 'schreibe_position\(' src/ortung/uebernahme.rs
verlange 'klemme_zeitpunkt\(' src/ortung/uebernahme.rs
verbiete 'UPDATE einsatz_fahrzeug' src/ortung/uebernahme.rs src/ortung/kopplung.rs
verlange 'is_schalter_an_tx' src/ortung/kopplung.rs
verlange 'beende_im_einsatz_tx' src/einsatz/repo.rs
verlange 'delete_kopplung_tx' src/fahrzeug/disposition_repo.rs src/routes/ortung.rs
verbiete 'EinsatzLesezugriff' src/routes/ortung.rs
verbiete '\b(lat|lon)\b' src/routes/ortung.rs
# Kein Logfeld trägt Kennung, Schlüssel oder Koordinaten (Einzeiler und umbrochen).
verbiete 'tracing::[a-z]+!\(.*[%?( ](kennung|schluessel|lat|lon|koordinaten)[ ,=)]' src/ortung src/routes/ortung.rs
verbiete '^ *[%?]?(kennung|schluessel|lat|lon|koordinaten)( =|,$)' src/ortung src/routes/ortung.rs
verbiete 'tracing::' src/ortung/kopplung.rs src/routes/ortung.rs
# Kein Verlauf: manuell, `keine_tabelle_haelt_einen_positionsverlauf` in tests/ortung.rs.
```

## Kontext

Der Einwurf (ADR-0023) legt nur die letzte Position je Kennung ab und ändert keinen Einsatz. Die
Lagekarte soll Fahrzeuge zeigen, ohne dass jemand die Position von Hand setzt. Positionen von
Einsatzkräften sind personenbezogen, deshalb darf die Übernahme nur mit Freigabe der Organisation,
bei bewusster Kopplung und nur während des Einsatzes laufen. Entschieden am 24.11.2026; am
25.11.2026 auf den Org-Schalter und den Positionsbaustein der Helfer-App umgestellt (LLH-2091).

## Konsequenzen

Die Einsatzakte hält nach dem Abschluss keine Einwurf-Orte; ausgenommen sind eingefrorene
Lagestände (`lage_snapshot`), die ihre Positionen als Momentaufnahme bis zur Löschung des
Einsatzes behalten. Ohne Schalter oder ohne Kopplung ändert ein Einwurf nichts am Einsatz. Die
frühere Bestätigung „Besatzung ist ehrenamtlich“ entfällt; die Grundlage hält der Admin beim
Einschalten fest. Ein Verlauf ist ausgeschlossen und bräuchte eine neue ADR samt Datenschutzprüfung.
