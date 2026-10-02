# Proposal

## Why

LFH-723 räumt das vorgehaltene Lagebild bei jedem Weg hinaus vom Gerät. Daneben bleiben aber
weitere personenbezogene Daten **ohne Räumung** liegen. Die Personen-Erfassungsquittungen der
Offline-Queue tragen volle `Person`-Objekte. Die ETB-Entwürfe haben keine Benutzerbindung. Ein
zweiter Benutzer am selben Fükw-Rechner sieht deshalb die Entwürfe des ersten. Dazu kommen der
Ortscache und Sitzungswerte der Erfassungsmasken. Für ein Gerät, an dem im Einsatz mehrere
Personen arbeiten, ist das eine Datenschutzlücke. LFH-723 hat sie ausdrücklich als Non-Goal an
dieses Ticket weitergereicht.

## What Changes

- **Ein Verzeichnis aller geräteseitigen Speicherorte** mit einer Entscheidung je Ort:
  *räumen*, *binden und befristen* oder *bewusst stehen lassen*, jeweils mit Begründung. Ein
  Guard-Test hält das Verzeichnis vollständig: Ein neuer Speicherort landet nicht still auf
  der Platte.
- **Ein Weg hinaus:** `abmeldenLokal()` im `AuthProvider` räumt nach dem Lagebild auch die
  übrigen Orte (`offline/geraetRaeumung.ts`). Der Anlass wird dabei unterschieden: freiwilliges
  Abmelden oder Sitzungsende (401).
- **Was der Server wieder liefern kann, geht bei jedem Ausgang:** Personen-Erfassungsquittungen,
  Ortscache und die Sitzungswerte der Erfassungsmasken (`lfh:erfassung:*` in
  `sessionStorage`).
- **ETB-Entwürfe werden an `benutzer_id` gebunden** (Entwurfs-DB v2, Index
  `by-benutzer-einsatz`). Beim Abmelden und beim Benutzerwechsel werden sie gelöscht. Ein
  Sitzungsende (401) überleben sie, aber gebunden und höchstens **24 h ab der letzten
  Änderung**. Die Entwürfe sind ungesendete Arbeit, die nur auf diesem Gerät liegt (Schutz aus
  LFH-142).
- **Die Höchstliegezeit von 24 h** gilt für Daten ohne angemeldeten Besitzer, also für Entwürfe
  und Quittungen. Sie greift beim Start und beim Anmelden.
- **Unverändert:** die Queue selbst (`ausstehend`, `abgelehnt`, `schreibaktionen`,
  `schreibaktionenAbgelehnt`, auch Zeilen ohne Zuordnung). Sie ist Beweissicherung. Ebenso
  unverändert bleiben die Geräte-Einstellungen in `localStorage`.

## Capabilities

### New Capabilities

- `geraetedaten-raeumung`: Welche personenbezogenen Daten ein Gerät nach Abmelden,
  Sitzungsende und Benutzerwechsel noch tragen darf, wie lange und an wen gebunden. Dazu kommt
  das Verzeichnis der geräteseitigen Speicherorte.

### Modified Capabilities

Keine. Das Lagebild (`lagebild-offline-lesen`) behält seine Anforderungen unverändert. Die neue
Fähigkeit regelt die übrigen Speicherorte daneben.

## Impact

- **Frontend:** `auth/AuthContext.tsx` (`abmeldenLokal` mit Anlass, Räumen nach Anmelden und
  Start), neu `offline/geraetRaeumung.ts` samt Verzeichnis und Guard-Test,
  `offline/queue.ts` (Quittungen räumen), `etb/entwuerfe/entwurfStore.ts` und
  `useEtbEntwuerfe.ts` (Bindung, DB v2, Vorlauf mit Besitzer), `anzeige/ortCache.ts`,
  `components/erfassungsSitzung.ts`.
- **Regeln:** `frontend/src/offline/AGENTS.md` (der Punkt „Offen: LFH-767“ wird eine Regel),
  `frontend/src/etb/AGENTS.md` (Entwurfsspeicher).
- **Kein Backend, keine Migration, keine API-Änderung.**
- **Daten beim Ausrollen:** Altentwürfe ohne `benutzer_id` übernimmt einmalig die erste
  bestätigte Sitzung. Das entspricht dem bisherigen Verhalten. Altentwürfe, die älter als 24 h
  sind, werden verworfen.
