---
id: ADR-0098
titel: Die Ortung übernimmt eingeworfene Positionen nur für gekoppelte Fahrzeuge laufender Einsätze
status: akzeptiert
datum: 2026-11-25
gilt_fuer:
  - src/ortung/**
  - src/routes/ortung.rs
  - src/public_api/einwurf/routen.rs
herleitung:
  - docs/superpowers/specs/2026-11-24-fjftaovq-fahrzeugortung-design.md
---

# ADR-0098: Die Ortung übernimmt eingeworfene Positionen nur für gekoppelte Fahrzeuge laufender Einsätze

## Regeln

- MUST: Die Übernahme ist ein eigener Schritt nach dem Commit des Einwurfs (`apply_position`); sie
  wirkt nicht auf dessen Antwort, Fehler der Übernahme werden verworfen. ADR-0023 gilt unverändert.
- MUST: Eine Position wird nur übernommen, wenn die Kennung an ein aktives Einsatzfahrzeug eines
  aktiven, nicht gespiegelten Einsatzes gekoppelt ist.
- MUST: Es gewinnt die jüngste Serverzeit des Empfangs (`position_gesetzt_at`); die Geräteuhr
  (`position_gemessen_at`) trägt nur das Alter der Anzeige.
- MUST NOT: Es entsteht ein Positionsverlauf; je Fahrzeug und je Kennung gilt nur die letzte Position.
- MUST: Eine Kopplung endet mit Trennen, Entlassen, Stornieren und Einsatzabschluss, jeweils mit
  ETB-Eintrag in derselben Transaktion.
- MUST: Der Einsatzabschluss löscht die GPS-Positionen des Einsatzes (`position_quelle = 'ortung'`);
  manuelle Positionen bleiben.
- MUST: Ohne Org-Schalter „Ortung auch bei hauptamtlicher Besatzung“ verlangt das Koppeln die
  Bestätigung ehrenamtlicher Besatzung (`is_ehrenamt_ok`).
- MUST: Die Kandidatenliste und die Kopplung verlangen Schreibrecht am Einsatz
  (`EinsatzSchreibzugriff<Fahrzeuge>`); die Liste trägt keine Koordinaten.
- MUST NOT: Ein Protokoll trägt Kennung, Schlüssel oder Koordinaten.
- MUST: Die Live-Meldung folgt nach dem Commit, außerhalb von `write_retry!`.

## Prüfung

```sh
verlange 'apply_position\(&state' src/public_api/einwurf/routen.rs
verlange "e.status = 'aktiv' AND e.spiegel = 0" src/ortung/uebernahme.rs
verlange 'position_gesetzt_at' src/ortung/uebernahme.rs
verlange 'delete_kopplungen_einsatz_tx' src/einsatz/repo.rs
verlange 'delete_kopplung_tx' src/fahrzeug/disposition_repo.rs src/routes/ortung.rs
verlange "position_quelle = 'ortung'" src/einsatz/repo.rs
verlange 'is_ehrenamt_ok' src/routes/ortung.rs
verbiete 'EinsatzLesezugriff' src/routes/ortung.rs
verbiete '\b(lat|lon)\b' src/ortung/kopplung.rs src/routes/ortung.rs
# Kein Logfeld trägt Kennung, Schlüssel oder Koordinaten (Einzeiler und umbrochen).
verbiete 'tracing::[a-z]+!\(.*[%?( ](kennung|schluessel|lat|lon|koordinaten)[ ,=)]' src/ortung src/routes/ortung.rs
verbiete '^ *[%?]?(kennung|schluessel|lat|lon|koordinaten)( =|,$)' src/ortung src/routes/ortung.rs
verbiete 'tracing::' src/ortung/kopplung.rs src/routes/ortung.rs
# Kein Verlauf: manuell, `keine_tabelle_haelt_einen_positionsverlauf` in tests/ortung.rs.
```

## Kontext

Der Einwurf (ADR-0023) legt nur die letzte Position je Kennung ab und ändert keinen Einsatz. Die
Lagekarte soll Fahrzeuge zeigen, ohne dass jemand die Position von Hand setzt. Positionen von
Einsatzkräften sind personenbezogen, deshalb darf die Übernahme nur bei bewusster Kopplung und
nur während des Einsatzes laufen. Entschieden am 24.11.2026 (LLH-2091).

## Konsequenzen

Die Einsatzakte hält nach dem Abschluss keine GPS-Orte, und ohne Kopplung ändert ein Einwurf
nichts am Einsatz. Wer Fahrzeuge ortet, koppelt sie im Einsatz und trennt sie dort wieder oder
lässt sie mit Entlassen, Stornieren oder Abschluss enden. Ein Verlauf ist ausgeschlossen und
bräuchte eine neue ADR samt Datenschutzprüfung.
