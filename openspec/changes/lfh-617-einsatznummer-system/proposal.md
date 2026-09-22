# Proposal

## Why

Der Neuentwurf „Instrumententafel“ zeigt im Kopf neben dem Einsatznamen eine Einsatznummer
wie `E-2026-0431`. Das System vergibt seit Mai 2026 beim Anlegen schon eine Nummer
(`2026-001`, je Organisation und Jahr, Commit `9c79e43c`). Diese Nummer lässt sich aber in den
Einsatzdaten frei überschreiben und sogar leeren. Das Format ist fest verdrahtet, und gezählt
wird, indem der String zerlegt wird (`substr(…, 6)`). Eine Systemnummer, die jeder ändern
kann, taugt nicht als Aktenzeichen. Deshalb gibt es künftig zwei getrennte Nummern: die
**Leitstellen-Nr.** (frei, von der Leitstelle vergeben) und die **Einsatznummer** (vom System
erzeugt, unveränderlich).

## What Changes

- Neue Einsätze erhalten eine Einsatznummer im Format `<Präfix><JJJJ>-<NNNN>`. Das Präfix
  ist mindestens 4-stellig, die Vorgabe `E-` ergibt z. B. `E-2026-0001`. Gezählt wird
  je Organisation und Kalenderjahr fortlaufend. Das Jahr richtet sich nach der **Zeitzone der
  Organisation** (Vorgabe `Europe/Berlin`), nicht nach UTC. Ein Einsatz um 00:30 Uhr am
  Neujahrsmorgen zählt damit schon zum neuen Jahr.
- Neue Org-Nummernkreis-Einstellung **„Präfix Einsatznummer“** (`einsatz_nummer_praefix`) steht
  neben den bestehenden Präfixen für ETB, Meldungen und Aufträge. Leer bedeutet `E-`.
  Beim Anlegen wird das Präfix in die gespeicherte Nummer **eingefroren**. Eine spätere Änderung
  trifft nur neue Einsätze.
- Die Zählung läuft über eigene Zahlenspalten (Jahr, laufende Nummer) statt über
  String-Zerlegung. Die bereits vergebenen `JJJJ-NNN`-Nummern werden in diese Spalten
  übernommen, damit die Zählung im laufenden Jahr ohne Lücke weitergeht. Ihr sichtbarer Text
  bleibt unverändert.
- **BREAKING (API):** `PATCH /api/einsaetze/{id}` weist `einsatznummer_intern` im Body mit
  **400** ab, egal ob mit Wert oder `null`. Die Einsatznummer ist nicht mehr änderbar.
- Die Einsatzdaten-Bearbeitung hat kein Eingabefeld mehr für die Einsatznummer. Sie steht nur
  noch als Anzeige da. Die Leitstellen-Nr. bleibt frei editierbar.
- Einsätze ohne Nummer (Altbestand vor Mai 2026) **bleiben ohne Nummer**. Es gibt keine
  rückwirkende Vergabe. Die Kopfzeile fällt für sie wie heute auf die Leitstellen-Nr. zurück.

## Capabilities

### New Capabilities
- `einsatznummer`: Vergabe, Format, Unveränderlichkeit und Präfix-Einstellung der vom System
  erzeugten Einsatznummer.

### Modified Capabilities
<!-- keine: für Einsatzdaten/Org-Einstellungen gibt es noch keine Main-Spec -->

## Impact

- **Datenbank:** neue Migration nach `0103`: `einsatz.nummer_jahr`, `einsatz.nummer_lfd` plus
  Unique-Index je (Org, Jahr, lfd. Nr.), Übernahme der Bestandsnummern und
  `org_einstellungen.einsatz_nummer_praefix`.
- **Abhängigkeit:** `chrono-tz` (IANA-Zeitzonendatenbank, passt zum vorhandenen `chrono`).
- **Backend:** `src/einsatz/repo.rs` (`anlegen`, `patche_kopf`), `src/routes/einsatz.rs`
  (PATCH-Validierung), `src/org/einstellungen.rs` + `src/routes/org_einstellungen.rs`
  (neues Präfix mit bestehender Whitelist), `src/einsatz/schwaerzung_registry.rs` (zwei neue
  Spalten).
- **API/Codegen:** `OrgEinstellungen*`-DTOs bekommen ein Feld; `openapi.json` +
  `types.generated.ts` werden neu erzeugt.
- **Frontend:** `pages/EinsatzdatenPage.tsx` (Eingabefeld entfällt),
  `pages/einstellungen/EinsatzDefaults.tsx` + `orgEinstellungenForm.ts` (neues Feld im
  Vollersatz-PUT). Die Kopfzeile (`einsatzKennung`) und die Kachel (`kachelKennung`) lesen
  weiter `einsatznummer_intern` und brauchen keine Änderung an der Logik.
- **Tests:** `tests/einsatz.rs` (Formattest, PATCH-409-Test wird 400-Test, `basis_kopf` ohne
  Nummer) und die Repo-Tests in `src/einsatz/repo.rs`.
