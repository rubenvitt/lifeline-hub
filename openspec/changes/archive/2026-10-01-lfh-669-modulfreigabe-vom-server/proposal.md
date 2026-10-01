# Proposal

## Why

Der Client entscheidet selbst, ob ein Modul frei ist (`istModulGesperrt`/`istModulFreigegeben`
in `frontend/src/einsatz/modulRegistry.ts`). Dafür rechnet er Einsatz-Override, sonst
Registry-Vorgabe. Das Backend (`fordere_modul_zugriff` in `src/einsatz/berechtigung.rs`) rechnet
Einsatz-Override, sonst **Org-Vorgabe**. Die Org-Vorgaben darf ein normales Mitglied nicht lesen
(`GET /api/org-modul-einstellungen` verlangt `darf_admin_bereich`). Setzt eine Organisation ein
Modul per Vorgabe auf `fuehrungskraft`, hält der Client es deshalb für frei. Die Navigation zeigt
es bedienbar, und fremde Seiten laden seine Liste und bekommen 403. Auf der Lagekarte erscheint
dann ein Ausfallhinweis, obwohl nichts ausgefallen ist. LFH-648 hat das für die Ebene
„Betroffene“ still abgefangen. Die Ursache bleibt bestehen: Die Regel existiert zweimal, und nur
eine Kopie kennt alle Eingaben (ClickUp LFH-669).

## What Changes

- Neuer Endpunkt `GET /api/einsaetze/{id}/modul-freigaben`. Er liefert für den anfragenden
  Benutzer je Modul-Key `{ sichtbar, zugriff }`. `zugriff` stammt aus derselben Auswertung wie
  das Modul-Gate jedes Listen-Endpunkts. Damit gibt es keine zweite Rangfolge.
- Das Backend zieht die Auswertung in **eine** reine Funktion zusammen. Diese Funktion tragen
  `fordere_modul_zugriff`, `erlaubte_module` (Live-Feed, Modulzähler) und der neue Endpunkt.
- Das Client-Gate (`istModulSichtbar`, `istModulGesperrt`, `istModulFreigegeben`,
  `istKeyFreigegeben`, `erstesFreigegebenesModul`) liest diese Freigaben und rechnet keine
  Rollen mehr nach. **BREAKING (intern):** Die Funktionen nehmen `ModulFreigaben` statt
  `ModulOverrides` und keinen `benutzer` mehr. Das Registry-Feld `benoetigteRolle` entfällt.
  Kein Eintrag setzt es heute.
- Alle Konsumenten des Gates laden die Freigaben statt der Overrides. Das sind Navigation,
  Modulzähler, Warnsperre, Sprungpalette, Stab, Lagekarte, Verpflegung, Überblick,
  Lage-Dashboard, Funkplan, Infotelefon, Organigramm und Verbleib-Erfassung. Nur der Editor
  „Einsatz › Module“ liest weiter die rohen Overrides.
- Solange die Freigaben unbekannt sind (Laden, Fehler), stellt kein Konsument eine Anfrage an die
  Liste eines fremden Moduls.
- Die Lagekarte lädt eine modulgebundene Quelle nur, wenn ihr Modul frei ist. Das betrifft
  Unfallhilfsstellen, Schäden, Einheiten, Fahrzeuge, Abschnitte, Zonen, Lagemeldungen und die
  übrigen Quellen nach `PFAD_KEY`. Eine gesperrte Quelle bleibt leer und erzeugt keinen
  Ausfallhinweis. Der 403-Abfang aus LFH-648 bleibt als Netz.
- Wer einen Override oder eine Org-Vorgabe ändert, invalidiert die Freigaben.

## Capabilities

### New Capabilities

- `modul-freigabe`: Die effektive Modulfreigabe je Benutzer und Einsatz. Der Server liefert sie,
  und der Client übernimmt sie ohne eigene Regel. Konsumenten fragen gesperrte Module nicht ab.

### Modified Capabilities

Keine. `modul-zaehler`, `lagekarte-betroffene` und `betreuung-lagekarte` behalten ihre
Anforderungen. Ihr 403-Netz bleibt gültig, es greift nur seltener.

## Impact

- **Backend:** `src/einsatz/berechtigung.rs` (Auswertung, neuer Typ `ModulFreigabe`),
  `src/routes/einsatz.rs` (Handler), `src/app.rs` (Route), `src/einsatz/modul.rs`
  (`PFAD_KEY`: Route ohne Modul-Gate), `src/api_doc.rs`, `tests/` (Route, Enum-/DTO-Kontrakt).
- **Typ-Codegen:** `frontend/src/api/openapi.json`, `frontend/src/api/types.generated.ts`.
- **Frontend:** `einsatz/modulRegistry.ts`, `api/einsaetze.ts`, `api/queryKeys.ts` (neuer
  Prefix, Live- und Offline-Klassifizierung) sowie die rund 20 Konsumenten aus „What Changes“.
  Dazu `pages/einstellungen/EinsatzModule.tsx` und `EinsatzDefaults.tsx` für die Invalidierung.
- **Bereichsregeln:** `frontend/src/pages/lagekarte/AGENTS.md` bekommt eine Regel zur
  Modulgrenze der Kartenquellen. Kommentare, die auf `istModulGesperrt` und „Org-Defaults
  unbekannt“ verweisen, werden angepasst.
- Keine Migration und keine Änderung an der Zugriffsentscheidung des Servers.
