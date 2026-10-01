# Design

## Context

LFH-22 hat die Druckmechanik gebaut, die jedes neue Druckstück trägt (`frontend/src/druck/`,
Regeln in `frontend/src/druck/AGENTS.md`): eine Druckwurzel (`data-lfh="druckwurzel"`),
`druck.css` für Fluss und Umbruch, den `Druckkopf` und `DruckKnopf`/`useDrucken`. Der ETB-Druck
(`pages/EtbDruckPage.tsx`) ist das Vorbild für eine eigene Druckansicht. Er hat eine eigene
Route, einen nicht-live Schnappschuss-Key und sperrt das Drucken, solange etwas fehlt.

Jeder Inhalt des Berichts hat heute schon einen GET-Endpunkt mit Modul-Gate
(`EinsatzLesezugriff<Modul>`). Ein gesperrtes **oder** im Einsatz ausgeblendetes Modul liefert
dort 403 (`src/einsatz/berechtigung.rs`). Das Frontend unterscheidet beides vorab über die
Modul-Overrides (`einsatz/modulRegistry.ts`: `istModulSichtbar`, `istModulGesperrt`).

Motivation und Umfang: `proposal.md`. Verhalten: `specs/einsatzbericht/spec.md`.

## Goals / Non-Goals

**Goals:**

- Der Bericht entsteht ohne neuen Endpunkt und ohne zweite Gate-Logik. Er liest über die
  bestehenden Endpunkte mit ihren Gates.
- Die Verdichtung (Zahlen, Verzeichnisse, Abdeckung) ist rein und ohne DOM testbar.
- Die Freigabe-Weiche („vollständig oder gar nicht“, „nicht genutzt“) steht an genau einer
  Stelle.

**Non-Goals:**

- Eine Server-Aggregation „Einsatzbericht“. Siehe D2.
- Neue Druckmechanik. Der Bericht nutzt `druck.css` unverändert, eine eigene CSS-Datei trägt
  nur Eigenheiten.
- Den Freitext in ETB-Entscheidungen und Lageberichten auf Namen filtern. Siehe Risiken.

## Decisions

### D1 Route unter Einsatzdaten

Die Druckansicht liegt unter `/einsaetze/:id/einsatzdaten/bericht`, mit dem Pfadhelfer
`einsatzberichtPfad(einsatzId)` in `routing/deeplinks.ts`. Die Route steht in `App.tsx` neben
`etb/druck`. `modulAusPfad` ordnet sie über das erste Segment dem Modul Einsatzdaten zu. Dieses
Modul ist nie ausblendbar und nie gesperrt (`NICHT_AUSBLENDBARE_MODULE`). Damit ist die Seite für
jedes Einsatzmitglied erreichbar, und die Rechte prüft der Bericht selbst je Quelle (D3).

Der Einstieg ist ein sekundärer Knopf „Einsatzbericht drucken“ im Seitenkopf von
`EinsatzdatenPage`, außerhalb des Bearbeiten-Modus. Er ist ein Link mit Knopfgestalt wie
„Zurück zum ETB“. Dazu kommt ein Eintrag in `command-palette/befehle.ts`.

*Verworfen:*
- **Eigenes Modul in der Registry:** bringt Override, Rollensperre und Kategorie mit. Ein
  Druckstück ist aber kein Arbeitsbereich, und ein sperrbarer Bericht wäre eine zweite
  Rechteachse neben denen der Quellen.
- **Unter `lage-dashboard/`:** Die Route erbte dessen Sperre. Wer das Dashboard nicht sieht,
  käme nicht an den Bericht, obwohl er alle Quellen lesen darf.

### D2 Komposition im Client statt Server-Aggregat

Der Bericht ruft die bestehenden Listen parallel ab und verdichtet im Client. Das sind etwa
fünfzehn Anfragen, einmal beim Öffnen und je „Neu laden“, nicht live.

*Verworfen: ein Endpunkt `GET …/einsatzbericht`.* Er müsste jedes Modul-Gate nachbauen, und eine
zweite Gate-Auswertung ist genau die Stelle, an der ein Bericht ein gesperrtes Modul verriete
(vgl. `erlaubte_module`, LFH-612). Dazu kämen ein neuer DTO samt Typ-Codegen und doppelte
Verdichtungen, die heute schon im Client liegen (`personenBilanz`, `staerke`, `zeitachse`).

### D3 Freigabe-Weiche vor dem Abruf

Eine reine Funktion `berichtFreigabe(benutzer, overrides)` liefert je Quelle einen von drei
Werten:

- `nicht-genutzt`, wenn `!istModulSichtbar`;
- `gesperrt`, wenn `istModulGesperrt`;
- `abrufen` in allen anderen Fällen.

Die Zuordnung Block → Quellen → Modul-Key steht als Tabelle in
`druck/einsatzbericht/quellen.ts`. Jeder Eintrag nennt den Endpunkt und den Modul-Key seines
Gates im Backend:

| Block | Quelle | Modul |
|---|---|---|
| Stammdaten, Zeiten | `ladeEinsatz` | — (immer) |
| Führung | `ladeMitglieder` | — (Mitgliedschaft) |
| Führung | `ladeStab`, `ladeLagebesprechungen` | `stab` |
| Kräfte | `listeEinheiten`, `listeEinheitenPerioden` | `einheiten` |
| Kräfte | `listeEinsatzPersonal`, `listePersonalPerioden` | `personal` |
| Kräfte | `listeEinsatzFahrzeuge` | `fahrzeuge` |
| Lage | `listeLageberichte` | `lageberichte` |
| Bilanz | `listePersonen` | `personen` |
| Bilanz | `listeSchaeden` | `schaeden` |
| Bilanz | `ladeBetreuung` | `betreuung` |
| Bilanz | `ladeVerpflegung` | `verpflegung` |
| ETB | `ladeEtbZaehler`, `ladeEtbVollstaendig({typ: 'entscheidung'})` | `etb` |

Ist eine Quelle `gesperrt`, ruft die Seite nichts ab. Sie nennt die gesperrten Module und
bietet kein Drucken an (Spec „Vollständig oder gar nicht“). Quellen auf `nicht-genutzt` werden
nicht abgerufen und erscheinen mit dem Vermerk. Ein Test gleicht die Modul-Keys der Tabelle mit
`modulRegistry` ab, damit kein Tippfehler still „sichtbar“ ergibt. Die Gate-Typen im Backend
prüft die Aufgabe 1.2 einmal von Hand gegen die Routen.

Liefert eine Quelle trotz `abrufen` ein 403, ist das kein leerer Bestand (`abrufZustand`). Ursache
ist dann eine Rollensperre als Vorgabe der Organisation (die Overrides des Einsatzes zeigen sie
nicht) oder eine Rechteänderung nach dem Laden der Overrides. Die Ansicht sperrt das Drucken und
nennt die Module („kein Zugriff auf <Modul>“).

Nach Ablauf der Aufbewahrungsfrist sperrt der Server schon den Einsatzkopf
(`src/einsatz/berechtigung.rs`, `darf_lesen`). Ein 403 auf `GET /api/einsaetze/{id}` führt deshalb
in eine Sackgasse ohne neuen Versuch, die beide Ursachen nennt (kein Zugriff oder Frist
abgelaufen). Am Client ist nicht unterscheidbar, welche vorliegt.

*Verworfen: einfach alles abrufen und an 403 erkennen.* Dann wären „ausgeblendet“ und
„gesperrt“ nicht zu unterscheiden, und ein ausgeblendetes Modul machte den Bericht für alle
undruckbar.

### D4 Ein Schnappschuss-Key für den ganzen Bericht

Der Abruf läuft über **eine** Abfrage `einsatzKeys.einsatzberichtDruck(einsatzId)`. Ihre
`queryFn` lädt alle `abrufen`-Quellen mit `Promise.allSettled` und liefert je Quelle Daten oder
Fehler, dazu ein gemeinsames `geladenAt`. Die Optionen folgen dem ETB-Druck: `staleTime: Infinity`,
kein Nachladen bei Fokus oder Reconnect, `refetchOnMount: 'always'`, `retry: false`. Der Präfix
kommt nach `NICHT_LIVE_KEYS` und wird dort begründet.

*Verworfen: die Live-Keys der Module wiederverwenden.* SSE-Invalidierungen änderten einen
geöffneten Bericht still, und die Quellen trügen verschiedene Stände. Ein Bericht hat genau
einen Stand (Spec „Stand und Zeitzone“).

### D5 Verdichtung rein, Darstellung je Block

`druck/einsatzbericht/verdichtung.ts` baut aus den Rohdaten ein `Einsatzbericht`-Objekt mit
einem Teilobjekt je Block. Das Objekt enthält keine Felder mit Personenbezug Betroffener: Namen,
Vornamen, Geburtsdaten und Registriernummern gelangen gar nicht hinein. Die Darstellung
(`druck/einsatzbericht/Bloecke.tsx`) bekommt nur dieses Objekt und kann so nichts Verbotenes
zeigen. Wiederverwendet werden:

- **Stärke:** `summiereStaerke` und `staerkeText` (`anzeige/staerke.ts`).
- **Dauer:** `einsatzDauer` (`einsatz/einsatzDauer.ts`).
- **Personen:** `sichtungsbild`, `verbleibZaehlung` und `transportBilanz`
  (`personen/personenBilanz.ts`).
- **Evakuierung:** `evakuierungKennzahl`.
- **ETB:** `typBilanz`.
- **Funktionen und Zeiten:** `besetzungAusStab` und `taktischeDtgVoll`.

### D6 Kräfte insgesamt aus der Zeitachse

- **Einheiten bzw. Personen insgesamt:** jede Kraft mit mindestens einer Periode in
  `listeEinheitenPerioden` bzw. `listePersonalPerioden`.
- **Helferstunden:** Summe von `kraftDauern(perioden, bisMs).gesamtMinuten` über alle Personen.
  `bisMs` ist der Stand, bei einem abgeschlossenen Einsatz höchstens `abgeschlossen_at`. Eine
  offen gebliebene Periode zählt so nicht über das Einsatzende hinaus.
- **Abdeckung:** die Personen mit Periode im Verhältnis zu den heute geführten Personen
  (`listeEinsatzPersonal`).
- **Ohne Periode:** Eine Kraft ohne Periode bekommt keine Zahl (`kraftDauern` liefert `null`)
  und zählt nicht als 0.

### D7 Lage: Verzeichnis je Kette, Volltext des letzten

Ein Lagebericht wird als Kette fortgeschrieben (`vorgaenger_id`). Das Verzeichnis zeigt je Kette
die neueste **freigegebene** Version. `kettenKoepfe` liefert die neueste Version überhaupt,
gegebenenfalls einen Entwurf. Deshalb filtert die Verdichtung vorher auf `status ===
'freigegeben'` und bildet die Köpfe erst dann. Geordnet wird nach `zeitstand`. Im Volltext
steht die Version mit dem spätesten `freigegeben_at`, gerendert mit `LageberichtText` und den
Abschnittstiteln aus `vorlage()`. Die Umbruchregeln aus `druck.css` greifen unverändert.

### D8 ETB-Auszug über die vorhandenen Druckbausteine

Die Zahlen je Typ liefert `ladeEtbZaehler`. Die Entscheidungen kommen vollständig über
`ladeEtbVollstaendig(einsatzId, {typ: 'entscheidung'})`, also nicht über die auf 50 begrenzte
Liste des Überblicks. Weil ein Filter gesetzt ist, liefert dieser Vollabruf die Berichtigungen
gleich mit. Dargestellt wird eine schlanke Tabelle: Nr., Zeit, Inhalt, Kennzeichen
„berichtigt durch Nr. m“. Sie folgt der Ausnahme „schlichtes `<table>`“ der `EtbDruckTabelle`
(`druck/AGENTS.md`).

### D9 Vorläufig-Vermerk und Kopfzeilen

Der Druckkopf bekommt `dokumentart="Einsatzbericht"` und `sichtbarkeit="immer"`, den Einsatz
aus demselben Schnappschuss wie die Blöcke. Seine Zeilen
sind „Stand“ (`geladenAt`) und, nur bei `status === 'aktiv'`, „Status: Vorläufig – Einsatz
läuft“. Bei einem laufenden Einsatz zeigt der Block Zeiten als Ende „läuft“, die Dauer reicht
bis `geladenAt`.

## Risks / Trade-offs

- **[Freitext enthält Namen]** Lageberichte und ETB-Entscheidungen sind Freitext, ihre
  Verfasser können Namen Betroffener hineinschreiben. → Das gilt ebenso für den
  Lageberichts- und den ETB-Druck. Die Spec sichert die strukturierten Felder zu, nicht fremden
  Freitext. In der Prüfliste wird das als Hinweis vermerkt.
- **[Gelöschte Disposition fällt aus der Zeitachse]** `einsatz_kraft_zeitachse` hängt mit
  `ON DELETE CASCADE` an `einsatz_personal`/`einsatz_einheit`. Wer aus dem Einsatz gelöscht statt
  entlassen wurde, fehlt in „insgesamt eingesetzt“. → Eine Entlassung löscht nicht, der Regelfall
  ist also gedeckt. Die Abdeckungszeile macht Lücken sichtbar. Eine Änderung am Löschverhalten
  wäre ein eigener Task.
- **[Viele Anfragen beim Öffnen]** Etwa fünfzehn parallele GETs. → Das geschieht einmal je
  Öffnen bzw. „Neu laden“, nicht live, und ist in der Größenordnung des Lage-Dashboards.
- **[Overrides ändern sich nach dem Laden]** Eine Rechteänderung zwischen Overrides und Abruf
  erzeugt ein 403. → D3 behandelt das als „kein Zugriff“ und sperrt das Drucken.
- **[Modul-Key-Drift]** Ein Frontend-Key in `quellen.ts`, der nicht zum Gate passt, ergäbe
  „sichtbar“ für ein gesperrtes Modul. → Ein Abgleichtest mit `modulRegistry` und der 403-Pfad
  aus D3 fangen das; der Server bleibt der Türsteher.

## Migration Plan

Die Änderung betrifft nur das Frontend und ist additiv: neue Route, neuer Query-Key, keine
Migration, kein API-Bruch. Rückweg ist das Entfernen von Route, Knopf und Paletteneintrag.
