# Proposal

## Why

Der Neuentwurf „Instrumententafel“ (LFH-605) zeigt an drei Stellen Zahlen: „412 Einträge“ im ETB-Kopf, Summen je Typ in der ETB-Seitenleiste und einen Zähler an den Modulen im Modulpanel. Heute liefert der Server dafür keine Quelle. Das ETB lädt in Seiten zu 100, und die Bilanz zählt deshalb nur das geladene Fenster (`etb/EtbBilanz.tsx`, `etb/zeitachseModell.ts`). Die vier vorhandenen Modulzähler rechnet der Browser aus vier vollständigen Listen, die der Navigationsrahmen nur dafür lädt (`einsatz/useModulZaehler.ts`). Weitere Module haben keinen Zähler. Nach der Epic-Regel „nichts erfinden“ blieben diese Stellen leer. Dieser Change schafft die Datenquelle.

## What Changes

- **Neuer Endpunkt `GET /api/einsaetze/{id}/etb/zaehler`.** Er liefert die Gesamtzahl und die Zahl je `EtbTyp` und nimmt **dieselben Filterparameter wie die ETB-Liste** (`q`, `typ`, `von`, `bis`, `erfasser_id`). Liste und Zählung werten dieselbe WHERE-Bedingung aus. Die Gates sind dieselben wie bei der Liste: Lesezugriff und Modul `etb`.
- **Neuer Endpunkt `GET /api/einsaetze/{id}/modul-zaehler`.**
  - Er liefert einen Zähler je Modul, und zwar **nur für Module, die der Benutzer sehen darf**. Ein nicht erlaubtes Modul fehlt in der Antwort; es erscheint nicht als 0.
  - Die Bedeutung ist je Modul festgelegt und aus dem Entwurf belegt:
    - ETB: Gesamtzahl
    - Betroffene: alle nicht stornierten Personen
    - Einheiten: Anzahl
    - Einsatzabschnitte: Anzahl
    - Meldungen: offene, davon neue
    - Aufträge: offene, davon überfällige
    - Erinnerungen: fällige
    - Chat: ungelesene Nachrichten des anfragenden Benutzers
  - Module ohne belegte Bedeutung bekommen **keinen** Zähler.
- **`useModulZaehler` bekommt eine Quelle.** Der Hook liest nur noch den neuen Endpunkt; die vier Listenabfragen im Navigationsrahmen entfallen. Tooltip und zugänglicher Name bleiben wörtlich gleich („3 offene Meldungen, davon 1 ungesehen“). Die vier neuen Module bekommen eigene Beschreibungen.
- **ETB-Kopf und Bilanz werden exakt.**
  - Ohne Filter steht im Kopf „n Einträge“ mit der Gesamtzahl vom Server, mit Filter „n Treffer“ mit der exakten Trefferzahl.
  - Die Bilanz zählt über dieselbe Menge. Ihre Balken messen gegen diese Gesamtzahl, nicht mehr gegen die geladene Menge.
  - Der Umfangssatz entfällt, und die Leiste heißt „Bilanz“ bzw. „Bilanz im Filter“.
- **Live-Aktualisierung.** Beide Zähler aktualisieren sich über den bestehenden Live-Feed. Jedes Ereignis, das die Liste eines gezählten Moduls invalidiert, invalidiert auch den Modulzähler. Das Lesen eines Chat-Kanals invalidiert ihn ebenfalls.

## Capabilities

### New Capabilities
- `etb-zaehler`: exakte, filtertreue Zählung der ETB-Einträge eines Einsatzes (gesamt und je Typ) und deren Anzeige im ETB-Kopf und in der Bilanz-Leiste.
- `modul-zaehler`: berechtigungsgefilterte Zähler je Modul für den Einsatz-Navigationsrahmen, mit festgelegter Bedeutung je Modul.

### Modified Capabilities
_keine_. Die einzige bestehende Spec (`lagekarte-fachebenen`) ist nicht betroffen.

## Impact

- **Backend:**
  - `src/etb/repo.rs`: Die WHERE-Bedingung des Filters wird herausgezogen und von Liste und Zählung gemeinsam genutzt.
  - `src/etb/`: neues DTO.
  - `src/routes/etb.rs`: neuer Handler.
  - neue Datei `src/routes/modul_zaehler.rs` mit `EinsatzLesezugriff<OhneModul>`.
  - `src/einsatz/modul.rs`: Eintrag in `PFAD_KEY`.
  - `erlaubte_module` wandert aus `src/routes/live.rs` an einen gemeinsamen Ort.
  - `src/app.rs`: Routen.
  - `src/api_doc.rs`: Schemas.
  - Integrationstests.
- **Codegen:** `frontend/src/api/openapi.json` und `types.generated.ts` über `scripts/check-typ-codegen.sh`; Barrel `api/types.ts`.
- **Frontend:**
  - `api/etb.ts` und ein neues `api/modulZaehler.ts`.
  - `api/queryKeys.ts`: zwei Keys plus Einträge in `EINSATZ_STREAM_EVENTS`.
  - `einsatz/useModulZaehler.ts` und `einsatz/modulRegistry.ts`, dort `ModulZaehlerQuelle` um vier Werte erweitert.
  - `pages/EtbPage.tsx`, `etb/EtbBilanz.tsx`, `etb/zeitachseModell.ts`.
  - die Chat-Lesemutation.
  - Tests.
- **Keine Migration, keine neue Abhängigkeit.** Die Tagesgrenze bleibt Sache des Clients, weil die Bilanz dem Filter folgt. Eine Zonenbibliothek im Backend ist nicht nötig.
- **Dokumentation:** `CLAUDE.md` verweist noch auf `EtbTabelle.tsx:117-119`; diese Stelle gibt es nicht mehr. Der Verweis wird beim Anfassen richtiggestellt.
