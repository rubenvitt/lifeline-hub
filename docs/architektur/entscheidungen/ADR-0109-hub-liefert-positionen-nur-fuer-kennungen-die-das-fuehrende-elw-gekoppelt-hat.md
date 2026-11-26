---
id: ADR-0109
titel: Der Hub liefert eingeworfene Positionen nur für Kennungen, die das führende ELW gekoppelt hat
status: akzeptiert
datum: 2026-11-25
gilt_fuer:
  - src/ortung/fern.rs
  - src/ortung/kopplung.rs
  - src/ortung/uebernahme.rs
  - src/instanz/spiegel/fuehrung.rs
  - src/instanz/spiegel/paket.rs
herleitung:
  - docs/superpowers/specs/2026-11-25-ypcadxzo-fahrzeugortung-spiegel-design.md
---

# ADR-0109: Der Hub liefert eingeworfene Positionen nur für Kennungen, die das führende ELW gekoppelt hat

Ergänzt ADR-0103; ADR-0103 gilt weiter, soweit nicht eine Regel hier es für den Weg über den Hub
ausnimmt.

## Regeln

- MUST: Positionen und Kandidaten reisen nur im Spiegelabgleich (`SpiegelPaket`), nur auf Anfrage
  des ELW (`tracking_requests`, `tracking_candidates_wanted`) und nur über die Org-Abbildung der
  Kopplung (ADR-0039).
- MUST: Der Hub liefert eine Position nur für einen Zugang der abgebildeten Org, der
  `positionen:write` trägt, nicht widerrufen und nicht abgelaufen ist, und nur bei eingeschaltetem
  Org-Schalter „Ortung im Einsatz“. Sonst entfällt der Eintrag stumm.
- MUST NOT: Die Kandidatenliste des Hubs (`RemoteTrackingCandidate`) trägt Koordinaten.
- MUST NOT: Der Hub hält Zustand dafür, welche Kennungen ein ELW gekoppelt hat. Er liest
  `position_letzte` (ADR-0023) und stellt die Antwort außerhalb der Schreibtransaktion des
  Abgleichs zusammen.
- MUST: Die neuen Felder des `SpiegelPaket` tragen `#[serde(default)]`, `PROTOKOLL_SPIEGEL` bleibt.
- MUST: Das ELW schreibt eine gelieferte Position nur über `ortung::schreibe_position` mit Quelle
  `einwurf` (ADR-0103) und nur am aktiven Fahrzeug eines aktiven, nicht gespiegelten Einsatzes;
  an einem Spiegel schreibt dieser Weg nie.
- MUST: Gibt ein Einsatz die Führung ab, löscht `beende_bei_fuehrungsabgabe_tx` in
  `fuehrung::werde_spiegel` vor dem Spiegel alle Kopplungen des Einsatzes, lokale wie Hub-Kopplungen,
  ohne ETB-Eintrag. Die Kopplung geht nicht an den neuen Führer über.
- MUST: Ausnahme von ADR-0103 „genau ein Nachlauf“: Auf dem Weg über den Hub gibt es keinen
  Nachlauf; der nächste Abgleich liefert die jüngste Position erneut.
- MUST NOT: Ein Protokoll trägt Kennung, Schlüssel oder Koordinaten; Fehler dieses Wegs zählt
  eine Sammelzeile ohne Kennung.

## Prüfung

```sh
verlange 'beende_bei_fuehrungsabgabe_tx' src/instanz/spiegel/fuehrung.rs
verlange 'schreibe_position\(' src/ortung/uebernahme.rs
verbiete 'UPDATE einsatz_fahrzeug' src/ortung/fern.rs
# Der Hub hält keinen Zustand über die Anfragen des ELW.
verbiete 'INSERT INTO|CREATE TABLE' src/ortung/fern.rs
# Kein Logfeld trägt Kennung, Schlüssel oder Koordinaten (Einzeiler und umbrochen).
verbiete 'tracing::[a-z]+!\(.*[%?( ](kennung|schluessel|lat|lon|koordinaten)[ ,=)]' src/ortung/fern.rs
verbiete '^ *[%?]?(kennung|schluessel|lat|lon|koordinaten)( =|,$)' src/ortung/fern.rs
verlange 'SammelzeileJe' src/ortung/fern.rs
# Keine Koordinaten in der Kandidatenliste: Felder des Typs `RemoteTrackingCandidate`.
if awk '/pub struct RemoteTrackingCandidate \{/,/^\}/' src/instanz/spiegel/paket.rs | grep -vE '^ *//' | grep -qE '(^|[^a-z_])(lat|lon)([^a-z_]|$)'; then echo 'Koordinaten im Kandidaten' >&2; exit 1; fi
# Die neuen Felder tragen `serde(default)`: manuell, `tracking_*` in `SpiegelPaket`.
```

## Kontext

Ein ELW, das an einen Hub gekoppelt ist, nimmt keinen Einwurf an; die Geräte melden an den Hub.
Führt das ELW den Einsatz, ist er am Hub ein Spiegel, und die Position erreichte das Fahrzeug nie.
Ein Antragsweg (ADR-0018) hätte einen Verlauf gesammelt, ein Einwurf am ELW widerspräche der
Kopplung. Entschieden am 25.11.2026 (LLH-2119).

## Konsequenzen

Koordinaten verlassen den Hub nur für Kennungen, die das führende ELW gekoppelt hat, und kommen
mit der Latenz des Abgleichs (5 s) am Fahrzeug an. Endet die Kopplung der Instanzen, kommt nichts
mehr, und die Position wird veraltet. Dieselbe Kennung kann an mehreren Instanzen gekoppelt sein,
weil der Hub bewusst nichts dazu hält.
