---
id: ADR-0098
titel: Copernicus-Aktivierungen vor 2023 kommen aus einem kuratierten Katalog mit Vector Packages zur Laufzeit
status: akzeptiert
datum: 2026-11-24
gilt_fuer:
  - src/karte/copernicus_alt.rs
  - src/karte/copernicus_altbestand.json
  - src/karte/copernicus.rs
herleitung:
  - docs/superpowers/specs/2026-11-24-pjfe442j-copernicus-aeltere-aktivierungen-design.md
  - LLH-2022 (mit Ruben am 24.11.2026 abgestimmt)
  - ADR-0079
---

# ADR-0098: Copernicus-Aktivierungen vor 2023 kommen aus einem kuratierten Katalog mit Vector Packages zur Laufzeit

## Regeln

- MUST: Aktivierungen vor 2023 stehen in `src/karte/copernicus_altbestand.json` und erscheinen
  nur mit `archiv=1` („Ältere Aktivierungen“). Führt die öffentliche Liste denselben Code, gilt
  die Liste.
- MUST: Vector Packages werden nur unter `PAKET_BASIS`
  (`https://cems-mapping-website.s3.eu-west-1.amazonaws.com/static/activations/`) geladen, über
  einen eigenen Client, dessen Redirect-Regel nur Weiterleitungen innerhalb des Präfixes
  verfolgt. Gelesen werden nur die GeoJSON-Dateien im Wurzelverzeichnis, mit Grenzen für
  Einträge, Größe je Eintrag und Summe, gemessen an den gelesenen Bytes.
- MUST NOT: Gebäude und Straßen aus einem Produkt, das nicht `GRA` ist, werden nicht gezeigt
  (in `DEL` sind es Referenzdaten ohne Schadensklasse).
- MUST: Jede Copernicus-Ebene liefert nur Features, die den gerundeten Ausschnitt
  (`filter_ausschnitt`) schneiden; der Gebietsumriss kommt immer mit.
- MUST: Wo ADR-0079 die Aufnahmezeit verlangt, gilt die Aufnahme, ersatzweise die Lieferung
  (`Produkt::zeit`). Das Frontend nennt dann „Lieferung“ statt „Aufnahme“.

## Prüfung

```sh
# Exit 0, solange die Regeln gelten (Hilfen und Grenzen: docs/architektur/AGENTS.md).
verlange 'const PAKET_BASIS' 'src/karte/copernicus_alt.rs'
verlange 'take\(PAKET_EINTRAG_MAX' 'src/karte/copernicus_alt.rs'
verlange 'redirect\(redirect_policy\(PAKET_BASIS' 'src/karte/copernicus_alt.rs'
verlange 'if archiv \{' 'src/karte/copernicus.rs'
verlange 'fn filter_ausschnitt' 'src/karte/copernicus.rs'
verlange 'p\.typ != "GRA"' 'src/karte/copernicus.rs'
```

## Kontext

Liste und Detail-Schnittstelle des Copernicus-Dashboards beginnen bei EMSR656 (März 2023). Für
Übungen und Nachbereitung zählen aber gerade ältere Lagen wie das Ahrtal 2021 (EMSR517). Deren
Produkte liegen als Vector Package (ZIP) auf einem S3-Host des Portals; jedes ZIP enthält je
Ebene schon GeoJSON in WGS84, ein Shapefile-Parser ist nicht nötig. Die Portalseiten haben keine
Stabilitätszusage, und die Pakete sind bis 37 MB groß.

## Konsequenzen

Der Altbestand braucht keine zweite Metadatenquelle zur Laufzeit und keine Daten im Repo; eine
weitere Aktivierung ist ein Katalogeintrag (Pflege: `docs/fachebenen-quellen.md`, Abschnitt
„Copernicus EMS“). Der Server braucht Zugang zu einem zweiten S3-Host. Der Ausschnittfilter
lässt auch große Gebiete in die 6-MiB-Grenze passen, gilt aber für neue Aktivierungen
genauso. Was nicht im Katalog steht, fehlt weiterhin.
