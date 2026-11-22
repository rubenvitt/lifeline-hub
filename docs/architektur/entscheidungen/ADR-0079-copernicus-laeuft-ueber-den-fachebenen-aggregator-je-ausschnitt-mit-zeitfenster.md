---
id: ADR-0079
titel: Copernicus EMS läuft als Fachebene je Kartenausschnitt über den Aggregator, Ältere nur auf Wahl
status: akzeptiert
datum: 2026-11-21
gilt_fuer:
  - src/karte/copernicus.rs
  - frontend/src/pages/lagekarte/useFachebenen.ts
  - frontend/src/pages/lagekarte/useKartenAnsicht.ts
herleitung:
  - docs/superpowers/specs/2026-11-21-wqafyn8u-copernicus-ems-fachebene-design.md
  - LLH-1200 (mit Ruben am 21.11.2026 abgestimmt)
  - docs/konzepte/2026-11-10-schnittstellen-ausbau.md
---

# ADR-0079: Copernicus EMS läuft als Fachebene je Kartenausschnitt über den Aggregator, Ältere nur auf Wahl

## Regeln

- MUST: Copernicus wird über `GET /api/karte/fachebenen/copernicus` mit Pflicht-`bbox` abgerufen,
  im Fachebenen-Cache und über `quellen::hole_json` (`http_begrenzt`); nicht über den
  Adapter-Rahmen (LLH-1632), solange die Quelle weder Schlüssel noch Freigabe braucht.
- MUST: Ohne `archiv=1` zählen nur laufende Aktivierungen und solche, die höchstens 30 Tage zuvor
  geändert wurden.
- MUST NOT: Der Archiv-Schalter wird nicht gespeichert, weder in der Kartenansicht noch im
  Browser.
- MUST: Jede Antwort trägt den Umriss jedes gezeigten Auswertungsgebiets (`klasse: gebiet`), und
  jedes Objekt trägt die Aufnahmezeit seines Produkts.
- MUST NOT: Modellierte Flächen (`modelledEvent`) werden nicht gezeigt.

## Prüfung

```sh
# Exit 0, solange die Regeln gelten (Hilfen und Grenzen: docs/architektur/AGENTS.md).
verlange 'quellen::hole_json' 'src/karte/copernicus.rs'
verlange 'const ZEITFENSTER_TAGE: i64 = 30;' 'src/karte/copernicus.rs'
verlange 'fn gebiet_feature' 'src/karte/copernicus.rs'
verbiete '"modelledEvent"' 'src/karte/copernicus.rs'
verbiete 'copernicusArchiv|archiv' 'frontend/src/pages/lagekarte/useKartenAnsicht.ts'
verbiete 'localStorage|sessionStorage' 'frontend/src/pages/lagekarte/useFachebenen.ts'
```

## Kontext

Copernicus EMS wertet bei Großschadenslagen Satellitenbilder aus. Die Quelle ist öffentlich und
braucht keinen Schlüssel. Das Konzept zum Schnittstellen-Ausbau sah sie hinter dem
Adapter-Rahmen vor, der noch nicht gebaut ist. Öffentlich abrufbar sind Aktivierungen ab März 2023
(EMSR656); ältere wie EMSR517 (Ahrtal) liefern 403. Ein Satellitenbild ist Stunden bis Tage alt, und eine Flut von 2024
gehört nicht in eine neue Lage.

## Konsequenzen

Die Ebene steht sofort bereit und erbt Cache, ETag, Offline-Verhalten und die Marke „veraltet“
der Fachebenen. Historische Aktivierungen sind nur über den Schalter „Ältere Aktivierungen“ zu
sehen, nach einem Neuladen ist er wieder aus. Was vor 2023 lag, fehlt, bis eine Folgeaufgabe
Produkt-ZIPs mit Shapefiles liest. Zieht der Adapter-Rahmen ein, ist ein Umzug möglich, aber
nicht nötig.
