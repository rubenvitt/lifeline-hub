---
id: ADR-0101
titel: Geodaten verlassen das System aus dem Client, fremde kommen nur geprüft über den Server herein
status: akzeptiert
datum: 2026-11-24
gilt_fuer:
  - frontend/src/pages/lagekarte/geo*
  - frontend/src/pages/lagekarte/kml*
  - frontend/src/pages/lagekarte/kmz*
  - src/karte_fremdebene/**
  - src/adapter/ziel.rs
herleitung:
  - docs/superpowers/specs/2026-11-24-k9tkgrou-lagekarte-geo-export-design.md
  - docs/superpowers/specs/2026-11-24-qe5jrctd-fremdebenen-design.md
---

# ADR-0101: Geodaten verlassen das System aus dem Client, fremde kommen nur geprüft über den Server herein

## Regeln

- MUST: Der Export der Lagekarte (GeoJSON, KML, KMZ) entsteht nur im Client, aus der Menge, die die
  Karte gerade zeichnet; der Server schreibt keine Exportdatei.
- MUST: Der Export enthält nur Sichtbares, abschließend nach der Tabelle „Was hineinkommt“ im
  Design-Doc; ein neuer Markertyp kommt nur durch eine Zeile dort hinein.
- MUST NOT: Der Export enthält Personen-, Führungs-, Tier- oder Meldungsmarker.
- MUST NOT: Der Export enthält Freitext außer dem Namen bzw. dem Label eines Objekts.
- MUST: Fremde Geodaten (GeoJSON, KML, KMZ) parst nur der Server; der Browser bekommt normiertes
  GeoJSON und parst nie fremde Dateien.
- MUST NOT: Der Parser löst DTDs oder Entities auf.
- MUST NOT: Der Server folgt verlinkten Inhalten (`NetworkLink`, `Icon/href`, `<link>`, `xlink`,
  externe Entities).
- MUST: Eine Fremdebene aus URL holt der Server nur über `adapter::ziel` (`check_url`, keine
  Weiterleitung, gedeckeltes Lesen); jede URL besteht `check_url` vor der Anfrage.
- MUST: Es sind nur `https`-URLs erlaubt.
- MUST: Ziele im LAN sind nur mit dem Org-Schalter erreichbar, den Admins setzen.
- MUST NOT: Ein gestörter Abruf löscht den letzten guten Stand der Ebene.

## Prüfung

```sh
verlange 'check_url' src/adapter/ziel.rs
verbiete 'danger_accept_invalid_certs|redirect::Policy::(limited|permissive)' src/adapter/ziel.rs
verlange 'Event::DocType' src/karte_fremdebene/einlesen/kml.rs
verbiete 'reqwest|hyper::Client|TcpStream' src/karte_fremdebene/einlesen/**
verlange 'fetch_bedingt' src/karte_fremdebene/abruf.rs
verbiete 'reqwest::' src/karte_fremdebene/abruf.rs
verbiete 'DOMParser|parseFromString' frontend/src/pages/lagekarte/kmlWriter.ts frontend/src/pages/lagekarte/kmzPacker.ts
```

## Kontext

Die Lagekarte soll Geodaten austauschen: Export für Google Earth und GIS, Fremdebenen von
Nachbarkreisen und anderen Stellen aus Datei und URL. Eine Exportdatei verlässt das System
unkontrolliert; fremde XML-Dateien und Adressen sind ein Angriffsweg (Entities, Verweise,
Abrufe ins interne Netz). Beides soll an je einer Stelle geregelt sein.

## Konsequenzen

Der Export ist eine reine Funktion im Client und kennt keine Daten, die nicht schon auf der
Karte stehen. Jede neue Quelle für Fremdebenen läuft durch den Parser und den Abrufweg des
Servers und kann dort nichts nachladen. Akzeptiert am 24.11.2026 durch Ruben (Freigabe der
Design-Docs); die Muster für `kml*`, `kmz*` und `src/karte_fremdebene/**` sind nachgezogen.
