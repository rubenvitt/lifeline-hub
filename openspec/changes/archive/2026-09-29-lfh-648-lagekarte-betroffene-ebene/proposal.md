# Proposal

## Why

Seit LFH-613 haben Personen eine Fundort-Koordinate. Auf der **Lagekarte** fehlen sie aber
noch. Das hat LFH-613 bewusst als Non-Goal ausgeklammert (`design.md`, Non-Goals und D8), aus
zwei Gründen: Datenschutz, weil der Aufenthaltsort personenbezogen ist, und Dichte, weil bei
200+ Betroffenen die taktische Lage zugedeckt wird. Wer führt, kann Fundorte und Kräfte
deshalb nicht auf einem Blatt sehen. Er muss zwischen der Betroffenen-Karte und der
Lagekarte hin- und herwechseln. Die Führungsentscheidung dazu ist am 23.09.2026 gefallen:
Personen erscheinen auf der Lagekarte als eigene Ebene. Die Ebene ist standardmäßig aus,
nur mit Modulzugriff „Personen“ sichtbar und getrennt von den Kräften geclustert.
**Dieser Change hebt das Non-Goal aus LFH-613 auf.**

## What Changes

- **Neue Ebene „Betroffene“** auf der Lagekarte, neben den bisher zehn Ebenen. Jede
  angetroffene, nicht stornierte Person mit Fundort-Koordinate erscheint als Marker. Das gilt
  auch für Verstorbene; Vermisste und Abgemeldete erscheinen nicht. Die Auswahl ist dieselbe
  wie auf der Betroffenen-Karte.
- **Standard aus.** Jede neue und jede bestehende gespeicherte Kartenansicht öffnet die Ebene
  ausgeschaltet, bis jemand sie einschaltet.
- **Sichtbarkeit am Datenzugriff, nicht am Schalter.** Personen werden nur geladen und
  gezeichnet, wenn das Modul „Personen“ für den Benutzer freigegeben ist. Ein eingeschalteter
  Schalter in einer geteilten Ansicht ändert daran nichts. Ohne Zugriff erscheint kein Marker
  und keine Anzahl. Ist das Modul ausgeblendet, fehlt die Zeile ganz. Ist es gesperrt, steht
  die Zeile gesperrt da, mit Grund und ohne Zahl, genauso wie in der Einsatz-Navigation.
- **Beschriftung ohne Namen.** Plakette und Inspector-Titel zeigen nur Registriernummer und
  Sichtung („R-042 · SK II“), dazu das Sichtungskürzel im Kreis. Name, Vorname und alle
  anderen personenbezogenen Felder erscheinen nie.
- **Eigenes Clustering.** Betroffene clustern nur untereinander, in einer eigenen Quelle
  unterhalb der Kräfte-Marker. Kräfte und Objekte werden nie von einem Personen-Cluster
  geschluckt.
- **Legende.** Ist die Ebene an, erklärt ein Sichtungsblock unter der Ebenen-Zeile Farben und
  Kürzel (SK I–IV, tot, unverletzt, ohne Sichtung).
- **Inspector.** Ein Klick auf einen Personen-Marker zeigt Registriernummer und Sichtung. Der
  Link „Im Fachmodul öffnen“ führt auf die Personen-Detailseite. „Verortung löschen“ entfernt
  die Fundort-Koordinate; heute steht der Knopf dort und tut nichts.
- **Historien-Modus.** Gesicherte Lagestände enthalten keine Personen. Die Zeile steht dort
  gesperrt mit Begründung, es werden keine Personen gezeichnet.
- Startausschnitt der Karte und Kopfzahl „verortet“ zählen Personen nicht mit. Die Karte
  springt also nicht, weil jemand die Ebene einschaltet, und die Zahl hängt nicht am
  Modulrecht.

## Capabilities

### New Capabilities
- `lagekarte-betroffene`: Die Ebene „Betroffene“ auf der Lagekarte. Sie umfasst
  Sichtbarkeit und Zugriffsgrenze, Vorgabe, Beschriftung, Clustering, Legende,
  Inspector und Verhalten im Historien-Modus.

### Modified Capabilities
<!-- keine: `lagekarte-fachebenen` betrifft externe Fachebenen (NINA/DWD/…), nicht
     Einsatzobjekte. Die Kartenansicht der Betroffenen-Seite (LFH-613, noch nicht archiviert)
     bleibt unverändert; ihr Non-Goal „kein Layer auf der Lagekarte“ ist ein Design-Satz,
     keine Spec-Anforderung, und wird in design.md dieses Changes aufgehoben. -->

## Impact

- **Frontend** (nur hier):
  - `pages/lagekarte/`: `useLagekarteDaten`, `marker.ts`, `markerLayer.ts`,
    `Kartenflaeche.tsx` (zweite Cluster-Quelle), `Sidebar.tsx`, `leistenDaten.ts`,
    `useKartenAnsicht.ts`, `Inspector.tsx`, `markerToUrl.ts`, `useKartenInteraktion.ts`.
  - `pages/LagekartePage.tsx`.
  - `personen/personenKarte.ts` bleibt die einzige Quelle der Signatur.
  - `personen/BetroffeneKarte.tsx` nutzt dieselbe Kartenfläche und clustert ihre Personen
    danach in der neuen Quelle, ohne sichtbaren Unterschied.
- **Backend / API**: keine Änderung. Datenquelle ist das bestehende, modul-gegatete
  `GET /api/einsaetze/{id}/personen`. `LiveEvent::Person` bleibt ausschließlich auf
  `personen` gegatet. Der gespeicherte Ebenenzustand der Kartenansicht (`layer_sichtbar`)
  ist opakes JSON und braucht keine Migration.
- **Tests**:
  - Vitest für Daten-Gate, Vorgabe, Beschriftung mit gesetztem Namen, Inspector, Ebenen-Zeile
    und Legende.
  - e2e als Nicht-Admin mit gesperrtem und freiem Modul.
  - `e2e/betroffene-karte.spec.ts` liest die Marker künftig aus der neuen Quelle.
- **Datenschutz**: Wer das Modul „Personen“ hat, lädt die Personenliste heute schon über
  Dashboard, Chat und Palette. Neu ist nur die Stelle, an der sie geladen wird, nicht der
  Personenkreis. Es entsteht keine neue Kopie: Snapshots und Ort-Vorschau bleiben ohne
  Personen.
