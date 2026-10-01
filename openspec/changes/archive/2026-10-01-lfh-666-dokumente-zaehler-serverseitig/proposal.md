# Proposal

## Why

LFH-612 hat die Modulzähler des Navigationsrahmens auf den Server-Endpunkt
`GET /api/einsaetze/{id}/modul-zaehler` gezogen, damit der Rahmen keine vollen Modullisten nur
zum Zählen lädt. Der Dokumente-Zähler (LFH-632) kam parallel auf `alpha` dazu und zählt noch
im Browser: Der Rahmen lädt dafür die ganze Dokumentliste samt Anzeige-Joins. Anders als der
Ablösungszähler hängt er nicht an der Uhr. Er ist eine reine Menge, ein `COUNT(*)`, und gehört
deshalb auf den Server.

## What Changes

- Die Antwort von `GET /api/einsaetze/{id}/modul-zaehler` bekommt das Feld
  `dokumente: { gesamt }` mit der Zahl der lebenden (nicht gelöschten) Dokumente des Einsatzes.
  Es fehlt wie jedes andere Feld, wenn der Benutzer das Modul `dokumente` nicht sehen darf.
- Der Navigationsrahmen zeigt den Dokumente-Zähler aus dieser Antwort und lädt die
  Dokumentliste nicht mehr. Der Wortlaut bleibt „n abgelegte Dokumente“ bzw.
  „1 abgelegtes Dokument“.
- Das Live-Ereignis `dokument` frischt den Modulzähler auf, nicht mehr nur die Dokumentliste.
- Ablösung und Betreuung bleiben Browser-Zähler. Für die Ablösung ist das bewusst so, weil
  sie an der Uhr hängt (LFH-635).

## Capabilities

### New Capabilities

<!-- keine -->

### Modified Capabilities

- `modul-zaehler`: Die Tabelle der gezählten Module bekommt `dokumente`. Der Navigationsrahmen
  zeigt den Dokumente-Zähler aus dem Endpunkt, und der Live-Feed frischt ihn auf.

## Impact

- **Backend:** `src/einsatz/zaehler.rs` (neues Feld, Zählung), `tests/modul_zaehler.rs`.
  OpenAPI-Schema `ModulZaehlerAnzeige` wächst um ein optionales Feld (additiv, nicht brechend).
- **Typ-Codegen:** die beiden generierten Typdateien (`scripts/check-typ-codegen.sh`).
- **Frontend:** `einsatz/modulRegistry.ts` (Quelle wechselt von Client nach Server),
  `einsatz/useModulZaehler.ts` (Abbildung, Listen-Key, Dokumentabfrage entfällt),
  `api/queryKeys.ts` (`EINSATZ_STREAM_EVENTS.dokument`) und die zugehörigen Tests.
- Weniger Last: Der Rahmen stellt je Einsatzansicht eine Listenabfrage weniger. Die Liste
  bekommt nur noch die Dokumentenseite selbst.
