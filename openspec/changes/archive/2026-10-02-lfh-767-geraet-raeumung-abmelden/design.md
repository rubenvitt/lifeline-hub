# Design

## Context

Siehe `proposal.md`, Abschnitt „Why“. Ausgangslage im Code (`frontend/src/`):

- **Ein Weg hinaus existiert schon:** `abmeldenLokal()` in `auth/AuthContext.tsx`. Ihn rufen
  `logout()` (freiwillig, auch wenn der Server nicht antwortet), die Sitzungsprüfung bei 401
  (`pruefe`) und die Sitzungswache (`auth/useSitzungsWache.ts`, 401 aus einem Abruf). Er
  setzt zuerst den Benutzer auf `null` und ruft danach `lagebildLoeschen` (LFH-723).
- **Benutzerwechsel** läuft über `lagebildAnmelden` (Login, `aktualisiere`, Übernahme aus einem
  anderen Tab). Beim **Start** läuft `lagebildStarten`. Beide kennen danach die bestätigte
  Person.
- **Geräteseitige Speicherorte, Bestand am 02.10.2026:**

| Ort | Inhalt | Personenbezug | Bindung heute |
|---|---|---|---|
| IndexedDB `lifeline-lagebild` | Lagebild | ja | geregelt durch LFH-723 |
| IndexedDB `lifeline-offline`, Stores `ausstehend`, `abgelehnt`, `schreibaktionen`, `schreibaktionenAbgelehnt` | Offline-Queue | ja | `benutzer_id` |
| IndexedDB `lifeline-offline`, Store `personErfassungsQuittungen` | volle `Person` | ja | `benutzer_id`, kein Löschweg |
| IndexedDB `lifeline-etb-entwuerfe`, Store `entwuerfe` | ETB-Entwurfstext, Von/An | ja | **keine** |
| `localStorage` `lifeline-etb-entwuerfe-ausstehend:<id>` | Vorlauf des Entwurfs (LFH-521), voller Entwurf | ja | **keine** |
| `localStorage` `etb-entwurf-aktiv-<einsatz>` | id des aktiven Entwurfs | nein | keine |
| IndexedDB `lifeline-ortcache` | Koordinate (~100 m) → Ortsname | mittelbar: Orte des Einsatzes | keine |
| `sessionStorage` `lfh:erfassung:<einsatz>:<maske>:<feld>` | letzter Antreff-/Schadensort | mittelbar | Tab |
| `localStorage` `lfh:offline-quittung-signal` | `{benutzerId, einsatzId}` | nein (datenarm, LFH-688) | — |
| `localStorage` `lfh:nav:zuletzt:<benutzer>:<einsatz>` (`einsatz/zuletztModule.ts`) | Modulnamen | nein | `benutzer_id` |
| `localStorage` `uhs:letzteAuswahl:<einsatz>`, `br:letzteAuswahl:<einsatz>` | Datensatz-id | nein | keine |
| `localStorage` Theme, Dichte, Helligkeit, Koordinatensystem, Alarm-Stummschaltung, Navigation, Lagekarte (Paneele, Leisten, Zeitachse, zuletzt verwendete Zeichen) | Geräte-Einstellungen | nein | — |
| `localStorage` `lifeline-serveruhr`, `lifeline-unwetter-gemeldet*` | Uhrversatz, Kennungen öffentlicher DWD-Warnungen | nein | — |

## Goals / Non-Goals

**Goals:**

- Eine Regel für alle Orte statt einer Einzelentscheidung je Ticket: **Was der Server wieder
  liefern kann, geht bei jedem Ausgang. Was nur auf diesem Gerät liegt, überlebt einen
  unfreiwilligen Ausgang, gebunden und befristet. Die Queue bleibt immer.**
- Genau ein Aufrufer für das Räumen, der `AuthProvider`, so wie beim Lagebild.

**Non-Goals:**

- **Die Offline-Queue** samt der Zeilen ohne Zuordnung bleibt unverändert, auch kein
  Ablaufdatum. Sie ist Beweissicherung, ihr Umgang ist in LFH-705 geregelt.
- **Geräte-Einstellungen** in `localStorage` werden nicht geräumt. Sie haben keinen
  Personenbezug, und ein gemeinsamer Fükw-Rechner soll seine Darstellung behalten.
- **Kacheln der Basiskarte und der Service-Worker-Precache** enthalten keine Einsatzdaten
  (LFH-723, Non-Goal Workbox) und bleiben draußen.
- **Keine Verschlüsselung** der IndexedDB. Das Ticket verlangt Räumung, keinen Schutz bei
  laufender Sitzung.

## Decisions

### D1 — Verzeichnis `GERAETESPEICHER` mit Guard-Test, analog zu `LAGEBILD_OFFLINE`

`offline/geraetRaeumung.ts` führt ein Verzeichnis: je Eintrag `ort` (DB-Name bzw.
Schlüsselpräfix), `datei` (die schreibende Quelldatei), `entscheidung`
(`'jeder-ausgang' | 'gebunden-befristet' | 'queue' | 'bleibt'`) und `grund`. Ein Guard-Test
(`geraetRaeumung.guard.test.ts`) sucht im Quellbaum jede Datei außerhalb von Tests, die
`openDB(` aufruft oder in `localStorage`/`sessionStorage` schreibt (`setItem`). Jede solche
Datei muss im Verzeichnis stehen. Fehlt eine, nennt der Test sie.

*Alternative:* nur eine Liste in `AGENTS.md`. Verworfen, weil sie still veraltet. Der
Lagebild-Guard aus LFH-723 hat gezeigt, dass die rote Prüfung die Liste aktuell hält.
*Alternative:* den Guard an Schlüsselnamen statt an Dateien festmachen. Verworfen, weil die
Schlüssel teils zur Laufzeit gebildet werden (`${praefix}:letzteAuswahl:${id}`). Ein
Schlüsselvergleich bräuchte einen Parser, die Datei genügt.

### D2 — Ein Weg hinaus mit Anlass: `abmeldenLokal(anlass)`

`abmeldenLokal` bekommt den Anlass `'abmelden' | 'sitzungsende'`. `logout()` übergibt
`'abmelden'`, die beiden 401-Wege `'sitzungsende'`. Nach `lagebildLoeschen` ruft er
`geraetRaeumen(anlass)`:

- **beide Anlässe:** Store `personErfassungsQuittungen` leeren, `lifeline-ortcache` leeren,
  alle `sessionStorage`-Schlüssel `lfh:erfassung:*` dieses Tabs entfernen.
- **nur `'abmelden'`:** alle ETB-Entwürfe samt Vorlauf und `etb-entwurf-aktiv-*` entfernen.

Eine **Ablehnung beim Start** (`me()` → `abgelehnt`: jede Antwort des Servers außer
502/503/504, dieselbe Grenze, an der LFH-723 das Lagebild verwirft) ist ein Sitzungsende, das erst beim nächsten
Öffnen bemerkt wird, etwa weil der Browser über den Ablauf hinweg geschlossen war. Sie läuft
nicht durch `abmeldenLokal`, weil noch niemand angemeldet war. Der Start ruft deshalb selbst
`geraetRaeumen('sitzungsende')`, an derselben Stelle, an der LFH-723 das Lagebild verwirft. Ein
Netzfehler beim Start räumt nichts.

**Nicht abgewartet** (Review-Befund): Ein Tab mit älterem Bundle hält die Entwurfs-DB in v1
offen und gibt sie nicht frei. Das Upgrade auf v2 bleibt dann `blocked`, jeder Zugriff hängt.
Anmelden, Start und Abmelden rufen das Räumen deshalb mit `void` auf. IndexedDB führt die
Transaktionen trotzdem in Auftragsreihenfolge aus, und die Entwürfe anderer blendet der Index bis
dahin aus. Nachweis: `auth/geraetRaeumung.haengt.test.tsx`.

**Andere Tabs** (Review-Befund): Die Kanalmeldung `abgemeldet` trägt den Anlass. Hat ein anderer
Tab freiwillig abgemeldet, räumt die folgende 401 hier ebenfalls mit `'abmelden'`. Sonst schriebe
ein noch offenes ETB den Entwurf zurück. Ein Tab ohne Netz bleibt angemeldet (LFH-387) und
schreibt weiter, bis er den Server erreicht.

Fehler beim Räumen werden wie beim Lagebild geloggt und halten die Abmeldung nicht auf. Der
Benutzer ist zu diesem Zeitpunkt schon `null`. Jeder Ort wird einzeln versucht: Ein Fehler in
einer DB darf die anderen nicht stehen lassen.

*Alternative:* das Räumen in `lagebildLoeschen` einhängen. Verworfen, weil `lagebildLoeschen`
auch beim Benutzerwechsel innerhalb von `lagebildAnmelden` läuft und dort keinen Anlass kennt.
Außerdem wäre das Lagebild-Modul dann Besitzer fremder Speicher. Der `AuthProvider` ist ohnehin
der einzige Aufrufer beider Wege.

*Andere Tabs:* `sessionStorage` gilt je Tab. Die anderen Tabs erfahren die Abmeldung über den
Auth-Kanal (LFH-387), prüfen `/me`, bekommen 401 und laufen selbst durch `abmeldenLokal`. Damit
räumt jeder Tab seinen eigenen `sessionStorage`. Ein e2e-Test belegt das nicht eigens, die
Kanalmechanik prüft schon `e2e/sitzung-mehrere-tabs.spec.ts`.

### D3 — ETB-Entwürfe: Bindung an `benutzer_id`, beim Sitzungsende behalten (Entscheidung für die Freigabe)

Das ist die eigentliche Wahl dieses Changes. Drei Wege standen zur Wahl:

| Weg | Abmelden | Sitzungsende (401) | anderer Benutzer | Folge |
|---|---|---|---|---|
| **A (empfohlen)** binden, beim Sitzungsende behalten | löschen | behalten, gebunden, max. 24 h ab letzter Änderung | löschen | Kein Textverlust, wenn die Sitzung beim Schreiben abläuft (LFH-142). Bis zu 24 h liegen Entwürfe ohne angemeldeten Besitzer auf dem Gerät. |
| B bei jedem Ausgang löschen | löschen | löschen | löschen | Am einfachsten und strengsten. Ein Sitzungsablauf beim Schreiben verliert den Text. Das ist eine Rückkehr hinter LFH-142/LFH-521. |
| C nur binden, nie löschen | behalten | behalten | ausblenden | Verletzt Akzeptanzkriterium 1, weil nach dem Abmelden Entwürfe liegen bleiben. |

Begründung für A: Ein Entwurf ist das einzige Datum, das der Server **nicht** wieder liefern
kann. Ein Sitzungsablauf ist kein Entschluss der Person. Das Lagebild darf bei 401 gehen, weil es
nach der Anmeldung zurückkommt, der Entwurf käme es nicht. Das Akzeptanzkriterium „nach dem
Abmelden“ erfüllt A wörtlich. Das zweite Kriterium (kein fremder Entwurf) erfüllt A über die
Bindung **und** das Löschen bei der Anmeldung eines anderen.

Umsetzung:

- `EtbEntwurf` bekommt `benutzer_id: number`. Die Entwurfs-DB geht auf **v2** mit Index
  `by-benutzer-einsatz` (`['benutzer_id', 'einsatz_id']`). `entwuerfeLaden(benutzerId,
  einsatzId)` liest nur über diesen Index. Der Vorlauf trägt den vollen Entwurf und damit auch
  `benutzer_id`. Beim Nachtragen gilt dieselbe Bindung, weil der Index den Besitzer prüft.
- `useEtbEntwuerfe(benutzerId, einsatzId, …)` bekommt die Person von `EtbEntwurfsTabs`, das sie
  über `useAuth()` liest. Als Parameter bleibt der Hook ohne Provider testbar. Ohne Person
  (abgemeldet) lädt und speichert der Hook nichts. `RequireAuth` lässt die Seite in diesem
  Zustand ohnehin nicht zu.
- `etb-entwurf-aktiv-<einsatz>` wird zu `etb-entwurf-aktiv-<benutzer>-<einsatz>`. Ein alter
  Schlüssel ohne Benutzer verweist auf eine id, die der Index nicht mehr liefert. Er wird nur
  nicht mehr gelesen und beim Abmelden mitgeräumt (Präfix `etb-entwurf-aktiv-`).

### D4 — Höchstliegezeit nur für Daten ohne angemeldeten Besitzer

`geraetFuerBenutzerRaeumen(benutzerId | null, jetzt)` läuft nach jedem `lagebildStarten` und
`lagebildAnmelden` im `AuthProvider`:

- Entwürfe und Quittungen **fremder** Benutzer (`benutzer_id !== benutzerId`) werden gelöscht,
  sobald eine Person bestätigt angemeldet ist. Das deckt den Benutzerwechsel ab.
- Ohne angemeldete Person (Start nach 401 oder Netzfehler ohne Stand) werden nur Entwürfe
  gelöscht, deren `geaendert_at` älter als 24 h ist. Quittungen mit `erstellt_at` älter als 24 h
  gehen ebenfalls.
- **Eigene** Entwürfe der angemeldeten Person bleiben unabhängig vom Alter. Ein Einsatz dauert
  oft Tage, und ein offener Reiter ist kein Datenleck gegenüber Dritten.

*Offline-Start:* Mit der Offline-Identität aus dem Lagebild (LFH-723) gilt die zuletzt
bestätigte Person als angemeldet. Ihre Entwürfe bleiben, fremde gehen. Das ist dieselbe Person,
die der Lagebild-Datensatz trägt.

*Alternative:* eine 24-h-Frist auch für eigene Entwürfe. Verworfen, weil das Text der
angemeldeten Person still löschte, ohne dass ein Dritter beteiligt wäre.

### D5 — Altbestand ohne `benutzer_id`

Entwürfe aus v1 tragen keinen Besitzer. Das Upgrade auf v2 lässt sie unverändert, sie erscheinen
nur in keinem Index. `geraetFuerBenutzerRaeumen` mit bestätigter Person übernimmt Altentwürfe,
die höchstens 24 h alt sind, einmalig für diese Person und verwirft ältere. Ohne Person werden
nur die älteren verworfen. Diese Übernahme entspricht genau dem Verhalten vor dem Change, bei
dem jeder Benutzer alle Entwürfe sah. Sie gilt nur für den ersten Start nach dem Ausrollen. Beim
Abmelden geht der Altbestand mit.

*Alternative:* Altbestand sofort verwerfen. Verworfen, weil ein Ausrollen während eines
Einsatzes ungesendete Entwürfe kosten würde.

### D6 — Ortscache und Sitzungswerte bei jedem Ausgang

Der Ortscache trägt keinen Besitzer, verrät aber, welche Orte im Einsatz nachgeschlagen wurden.
Er füllt sich über die Ortsvorschau des Servers (`ladeOrtVorschau`) von selbst wieder. Deshalb gilt *jeder Ausgang*, ohne
Bindung. Der Kommentar „keine Eviction“ in `ortCache.ts` wird präzisiert: keine Eviction im
Betrieb, Räumung beim Ausgang. Die Sitzungswerte `lfh:erfassung:*` (Antreff- und
Schadensort) gehen aus demselben Grund. Ein zweiter Benutzer im selben Tab bekäme sonst den
Antreffort des ersten vorbelegt.

## Risks / Trade-offs

- [Bis zu 24 h liegen Entwürfe einer abgelaufenen Sitzung auf dem Gerät] → gebunden, für keinen
  anderen Benutzer sichtbar und bei dessen Anmeldung gelöscht. Wer das nicht will, meldet sich
  ab. Das ist der dokumentierte Unterschied zwischen Abmelden und Ablauf.
- [Die Quittung einer offline erfassten Person geht bei 401 verloren, bevor sie angezeigt
  wurde] → Die Person liegt auf dem Server und steht in der Personenliste. Die Quittung ist nur
  der Hinweis „offline erfasst, jetzt registriert“.
- [Ein Räumfehler in einer DB (Kontingent, gesperrte Transaktion) lässt Daten liegen] → Jeder
  Ort wird einzeln versucht. Der nächste Start räumt fremde und abgelaufene Daten nach (D4).
- [Ein offener Tab mit altem Bundle hält die Entwurfs-DB in v1, und das Upgrade auf v2 bleibt
  `blocked`] → Der Auth-Pfad wartet nie auf das Räumen (D2). Die ETB-Seite des neuen Tabs wartet,
  bis der alte schließt. Das gilt für jedes IndexedDB-Upgrade, auch für `lifeline-offline`. Ab v2
  gibt ein `blocking`-Handler die Verbindung für künftige Upgrades frei, `blocked` wird
  protokolliert.
- [Ein Test prüft den Speicher-Cache statt der Platte und bleibt grün] → Die Akzeptanztests
  öffnen die IndexedDB mit eigener Verbindung über `openDB` bzw. `indexedDB.open` und lesen
  roh, nicht über die Modulfunktionen.

## Migration Plan

- Entwurfs-DB v1 → v2 beim ersten Öffnen: neuer Index, keine Datenänderung. Den Altbestand regelt
  D5.
- Rückweg: Ein älteres Bundle öffnet die DB mit Version 1 und scheitert an der höheren Version
  (`VersionError`). Die Entwürfe sind dann für dieses Bundle nicht lesbar, aber nicht verloren.
  Ein Rückrollen über diese Grenze ist im Einsatz nicht vorgesehen. Das ist derselbe Umgang wie
  bei `lifeline-offline` v4/v5.
