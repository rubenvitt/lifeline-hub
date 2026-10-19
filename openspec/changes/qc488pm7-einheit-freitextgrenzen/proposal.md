# Proposal

## Why

Die Freitexte einer Einheit im Einsatz – Bemerkung, Funkrufname und Erreichbarkeit – haben am
Server keine Höchstlänge, gegen die Regel „Freitext an einem Schreibendpunkt hat eine Grenze“
(`src/AGENTS.md`, „Eingabegrenzen“). `POST …/einheiten` und `PATCH …/einheiten/{eid}` trimmen sie
nur. Den Namen begrenzt seit LLH-1073 Teil I die Spec `eingabegrenzen`; die drei übrigen Felder
blieben offen (Befund aus LLH-1036 Teil I). Seit die Einheit-Ansicht sie zeilenweise bearbeitet,
ist jede Zeile ein eigener Schreibweg ohne Grenze.

## What Changes

- **Server:** Bemerkung höchstens 2 000, Funkrufname höchstens 200, Erreichbarkeit höchstens 200
  Zeichen nach dem Trimmen, beim Bilden und beim Ändern einer Einheit; darüber 400 „{Feld} darf
  höchstens {max} Zeichen lang sein“, bevor etwas geschrieben wird.
- **Spiegel:** die beiden neuen Grenzen in `frontend/src/api/eingabegrenzen.ts` und im
  Spiegeltest; die Bemerkungsgrenze steht dort schon.
- **Einheit-Ansicht:** Funkrufname und Erreichbarkeit nehmen nicht mehr Zeichen an als der Server;
  die Bemerkung zeigt den Zähler ab 80 % und sperrt das Speichern bei Überlänge, ohne zu kürzen.

## Capabilities

### New Capabilities

– keine –

### Modified Capabilities

- `eingabegrenzen`: neue Anforderung „Freitexte einer Einheit sind begrenzt“ neben „Name einer
  Einheit ist begrenzt“.

## Impact

- Backend: `src/einheit/mod.rs` (Konstanten), `src/routes/einsatz_einheit.rs` (`bilden`,
  `update`), `tests/einsatz_einheit.rs`, `tests/eingabegrenzen_spiegel.rs`.
- Frontend: `api/eingabegrenzen.ts`, `pages/einheit/EinheitKopf.tsx`,
  `pages/einheit/EinheitFunk.tsx` samt Vitest.
- API: neue 400-Antworten für Werte über der Grenze. Die eigene Oberfläche sendet keine solchen
  Werte; Bestandswerte über der Grenze bleiben stehen, bis jemand das Feld ändert.
