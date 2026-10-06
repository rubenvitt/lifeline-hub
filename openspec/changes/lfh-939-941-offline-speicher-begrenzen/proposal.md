# Proposal

## Why

Feld-Tablets und Rechner der Führungsstelle laufen 24–72 h im selben Tab und über viele
Einsätze. Das Audit vom 01.10.2026 fand im Offline-Speicher des Frontends sechs Stellen, die mit
der Laufzeit wachsen oder unnötig viel tragen:

- **Lagebild-Persister (LFH-939, L38):** Jeder Schreibauftrag hängt sich ungeprüft an eine
  `.then`-Kette, jedes Glied hält seinen eigenen Stand fest. Dehydriert wird ungedrosselt bei
  jedem Cache-Ereignis. Die Bestätigung schreibt alle 30 s den ganzen Datensatz neu, obwohl nur
  `bestaetigtAt` sich ändert, und die Identitätsprüfung liest dafür den ganzen Stand.
- **ETB-Filtervarianten (LFH-939, L39):** Jede Volltext-Tipp-Pause, jeder Zeitraum und jede
  Einheit erzeugt einen eigenen Key, der 24 h im Speicher bleibt und mit auf die Platte geht,
  obwohl ihn offline niemand wieder aufruft. LFH-723 hat das bewusst offen gelassen („messen,
  wenn es auffällt“). Diese Change kehrt das um (Entscheidung E1).
- **Queue-Zähler (LFH-939, L40):** Jede Zähleraktualisierung liest alle vier Queue-Stores samt
  Payload, nur um Altzeilen ohne Benutzer zu zählen, und das bei jeder Queue-Änderung. Beim
  Abgleich nach Netzrückkehr wird das quadratisch.
- **Erfassungsquittung (LFH-941, L41):** Die Quittung einer offline erfassten Person trägt das
  ganze `Person`-Objekt samt Name und Sichtung, obwohl die Anzeige nur Kennung und R-Nr braucht.
- **Ortscache (LFH-941, L48):** Wächst ohne Frist und Obergrenze, solange niemand sich abmeldet.
- **ETB-Entwürfe (LFH-941, L51):** Leere Altentwürfe (vor LFH-894 wurden leere, vorbelegte
  Entwürfe gesichert) und Aktiv-Merker bleiben je besuchtem Einsatz liegen.

Das Räumen beim Abmelden, Sitzungsende und Benutzerwechsel hat LFH-767 schon umgesetzt
(`geraetRaeumung.ts`); diese Change ergänzt nur, was **während** einer langen Sitzung wächst.

## What Changes

- **Persister mit Single-Flight und gedrosseltem Dehydrieren:** ein eigenes Abo nur auf den
  Query-Cache (Mutationen werden nie geschrieben) mit Drossel vor dem Dehydrieren. Der Persister
  hält höchstens einen laufenden und einen wartenden Stand. Die erste Speicherung beim
  Abonnieren bleibt.
- **Kopf und Stand getrennt** in `lifeline-lagebild`: Identität und `bestaetigtAt` unter
  `kopf`, der dehydrierte Stand unter `client`, beide im selben Store und in einer Transaktion
  (Mehrtab-Schutz aus D1 bleibt). Die Bestätigung liest und schreibt nur noch den Kopf. Den
  Altdatensatz nehmen Anlegen und Löschen mit (er trägt ohnehin den alten `buster`).
- **Vorrat schrumpft:** Nach jeder Speicherung bleibt im Vorrat nur, was zulässig und nicht live
  überdeckt ist.
- **ETB offline nur in festen Ansichten** (entschieden 06.10.2026): Auf die Platte gehen
  nur ETB-Keys ohne freie Eingabe, also die Gesamtliste, die Typ-Reiter und die festen
  Ausschnitte (Überblick, Lage-Dashboard) samt Zählern und Lesemarke. Varianten mit Volltext,
  Zeitraum, Einheit, Erfasser oder Bezugssuche bleiben nur 5 min im Speicher und nie auf der
  Platte.
- **Queue-Zähler ohne Payload:** Altzeilen werden per `count()` je Store gezählt, in einer
  Lesetransaktion. Der Zähler-Hook lädt höchstens einmal je Drosselfenster neu, egal wie viele
  Queue-Ereignisse ein Abgleich auslöst.
- **Quittung nur mit Kennungen** (`lifeline-offline`): `person_id` und `registrier_nr` statt
  `person`; Bestandsquittungen werden beim Öffnen gekürzt. Die Personenseite holt die
  volle Person aus dem Cache; fehlt sie, bleibt die Sicht stehen und nur die Hervorhebung wird
  gesetzt.
- **Ortscache befristet** (`lifeline-ortcache`): Wert `{ name, at }`. Beim
  ersten Öffnen gehen Einträge älter als 30 Tage, die Anzahl ist auf 5 000 gedeckelt (älteste
  zuerst).
- **Leere ETB-Entwürfe** (entschieden 06.10.2026): Beim Laden der Entwürfe gehen
  einsatzübergreifend die eigenen Entwürfe ohne Inhalt, die länger als 24 h unverändert sind,
  und jeder eigene Aktiv-Merker eines Einsatzes ohne Entwurf. Entwürfe mit Text bleiben wie in
  LFH-767 D4 unabhängig vom Alter.
- **Unverändert:** die vier Queue-Stores (Beweissicherung), das Räumen beim Ausgang (LFH-767).

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `lagebild-offline-lesen`: Das ETB bleibt offline nur in seinen festen Ansichten lesbar;
  Varianten aus freier Eingabe erreichen die Platte nicht. Speichern läuft gedrosselt und ohne
  Rückstau.
- `geraetedaten-raeumung`: Erfassungsquittungen tragen nur Kennungen. Der Ortscache hat Frist
  und Obergrenze. Leere Entwürfe und verwaiste Aktiv-Merker werden auch während einer Sitzung
  geräumt.

## Impact

- Frontend (`frontend/src/`): `offline/lagebildPersister.ts`, `lagebildSpeicher.ts`,
  `lagebildSitzung.ts`, `queue.ts`, `useOfflineQueueZaehler.ts`, `geraetRaeumung.ts`;
  `api/queryKeys.ts`; `pages/EtbPage.tsx`, `dokumente/bezugswahl.ts`; `pages/PersonenPage.tsx`;
  `anzeige/ortCache.ts`; `etb/entwuerfe/entwurfStore.ts`.
- IndexedDB: kein Versionssprung (design.md D9); `lifeline-lagebild`, `lifeline-offline` und
  `lifeline-ortcache` geben ihre Verbindung bei einem künftigen Upgrade frei (`blocking`).
- Regeln: `frontend/src/offline/AGENTS.md`, `frontend/src/etb/AGENTS.md`.
- Kein Backend, keine Migration, keine API-Änderung.
