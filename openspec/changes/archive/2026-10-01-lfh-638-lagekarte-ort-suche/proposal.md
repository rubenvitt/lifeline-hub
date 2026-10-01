# Proposal

## Why

Auf der Lagekarte lässt sich heute nur ansteuern, was schon verortet ist (Suchfeld „Kartenobjekte
suchen“), und eine Koordinate nur über die Sprungpalette. Wer eine gemeldete Adresse („Hauptstraße
12, Musterstadt“) oder eine durchgegebene Koordinate auf der Karte sehen will, sucht von Hand. Das
kostet im Einsatz Zeit, und am Ziel bleibt nichts stehen, was die Stelle markiert (LFH-638).

## What Changes

- Das Suchfeld der Kartenleiste („Kartenobjekte suchen“) erkennt zusätzlich **Koordinaten** in
  jeder Form, die der Koordinatensprung kennt (Dezimalgrad, MGRS, UTM, Gauß-Krüger, Grad/Minuten/
  Sekunden), und bietet sie sofort als eigene Gruppe „Koordinate“ über den Objektgruppen an.
- Dasselbe Feld sucht per **Enter** nach einer **Adresse**: neue Gruppe „Adresse“ mit bis zu fünf
  Treffern des Geocoders. Kein Autovervollständigen, keine Abfrage beim Tippen.
- Ein Klick auf einen Koordinaten- oder Adresstreffer lässt die Karte hinfliegen und setzt eine
  **vorläufige Suchnadel** mit Beschriftung (Adresse bzw. Koordinate im eingestellten Format). Die
  Nadel wird nicht gespeichert, verschwindet mit „Schließen“ oder der nächsten Suche und ist kein
  Klickziel.
- Der bestehende Koordinatensprung der Sprungpalette (`?zentrum=`) setzt dieselbe Suchnadel.
- Die **Sprungpalette** bekommt eine Zeile „Adresse auf Lagekarte suchen · „…““, die auf die
  Lagekarte springt und dort die Adresssuche mit dem getippten Text auslöst (`?ort=`).
- Neuer Backend-Endpunkt `GET /api/einsaetze/{id}/karte/ort-suche?q=` (Modul Lagekarte):
  Forward-Geocoding über den org-konfigurierten Geocoder (Default Nominatim `/search`), mit
  Bevorzugung der Einsatzumgebung, gemeinsamem Rate-Limit mit dem Reverse-Geocoding, kurzem
  Prozess-Cache und hartem Timeout. Fehler des Geocoders brechen die Anfrage nie ab, sie stehen
  als Zustand in der Antwort.

## Capabilities

### New Capabilities

- `lagekarte-ortssuche`: Ansteuern eines Ortes auf der Lagekarte über eine eingegebene Adresse
  oder Koordinate, samt Suchnadel, Adressauflösung über den Geocoder und deren Grenzen
  (Rate-Limit, Datenschutz, Ausfall).

### Modified Capabilities

- `lagekarte-objektsuche`: Das Suchfeld bleibt die eine Eingabe; der Leerzustand „Kein
  Kartenobjekt zu …“ darf nicht mehr erscheinen, wenn die Eingabe als Koordinate erkannt wurde
  oder eine Adresssuche läuft bzw. Treffer hat.
- `sprungpalette`: neue Zeile „Adresse auf Lagekarte suchen“ (ADDED). Dass der
  Koordinatensprung die Suchnadel setzt, regelt `lagekarte-ortssuche` (Verhalten der Karte bei
  `?zentrum=`).

## Impact

- **Backend:** `src/geocoding/` (neue Vorwärtssuche, gemeinsamer Token-Bucket), neue Route unter
  `src/routes/karte*`, `src/app.rs`, `src/api_doc.rs`; Typ-Codegen (`openapi.json`,
  `types.generated.ts`). Keine Migration, kein neues Feld in den Org-Einstellungen.
- **Frontend:** `pages/lagekarte/MarkerSuche.tsx`, `objektsuche.ts`, `Sidebar.tsx`,
  `Kartenflaeche.tsx` (Suchnadel-Ebene), `pages/LagekartePage.tsx` (`?zentrum=`, `?ort=`),
  `routing/deeplinks.ts`, `command-palette/` (neue Zeile), `api/` (Client + Query-Key).
- **Datenschutz:** Der Suchtext geht an den eingestellten Geocoder (Default: öffentlicher
  Nominatim), wie heute schon die Koordinate der Ort-Vorschau. Koordinaten verlassen den Server
  bei der Koordinatensuche nicht.
- **Regeln:** `frontend/src/pages/lagekarte/AGENTS.md` (Suchnadel ist keine Klickebene),
  `frontend/src/command-palette/AGENTS.md` (neue Gruppe).
