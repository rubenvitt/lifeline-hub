# Design

## Context

Anlass: proposal.md. Stand `alpha` 619b973, nach der zentralen Live-Bündelung (Spec
`live-abgleich`, `frontend/src/live/liveInvalidierung.ts`).

- `useEinsatzLiveStream` ordnet jedes Ereignis über `EINSATZ_STREAM_EVENTS` Prefixen zu und
  wertet die Payload nicht aus (Ausnahmen mit Seiteneffekt: Sofortmeldung, Erinnerung,
  Ablösung). Die Payload trägt aber schon die Kennung: `publiziere_objekt` sendet
  `{"einsatz_id", "<art>_id"}`.
- **Vorlagendokumente** (Lagebericht, Befehl, Pressemitteilung) teilen den Kern
  `src/vorlagendokument/`: ein `select`, ein `Row`, `zu_dokument` parst die Abschnitte je Zeile.
  `aktualisieren` (PATCH, nur Entwurf) kann Titel, Zeitstand und Abschnitte ändern und sendet
  immer dasselbe Ereignis wie Anlage, Freigabe und Fortschreibung. Den Volltext aus der Liste
  lesen nur zwei Abnehmer: die Sprungpalette (`LageberichtVorschau`) und der Einsatzbericht
  (`verdichtung.ts`, Text des letzten freigegebenen Lageberichts). Alle übrigen (Listenseiten,
  Dashboard, Chat-Bezug, Medienlage, Stab-Vorbereitung) lesen Kopffelder.
- **Presse-Log:** `repo::liste` ohne Grenze, sortiert `status='offen'` zuerst, dann
  `eingang_at DESC, id DESC`. Es gibt keinen Einzelabruf. Ein Ereignis teilt sich den Namen
  `presse` mit den Pressemitteilungen und invalidiert den ganzen Prefix `einsatz-presse`.
- **Schäden:** Die Liste trägt alle Felder plus vier Join-Felder. Modulseite, Druck,
  Einsatzbericht, Chat-Bezug und Sprungpalette filtern, suchen und zählen im Client über den
  ganzen Bestand. Lagekarte (Marker, Inspector: id, Lage, Registriernummer, Ausmaß, Status) und
  Dashboard (`verdichteSchaeden`: nur Status und Anzahl) brauchen fast nichts davon. Die
  Anhang-Routen senden dieselbe Payload wie eine Änderung am Schaden; der Purge sendet `schaden`
  ohne Kennung.

## Goals / Non-Goals

**Goals:**
- Ein Live-Ereignis kostet einen Tab höchstens die betroffene Zeile oder das betroffene Detail,
  nicht den Gesamtbestand.
- Volltexte nur dort übertragen, wo sie gezeigt werden.
- Keine sichtbare Änderung an Seiten, Zählern und Medienlage.

**Non-Goals:**
- Das Informationstelefon. Seine Kennzahlen rechnen laut Spec `stab-infotelefon` aus derselben
  geladenen Menge; der Hinweis aus dem Audit geht als Kommentar an das Ticket der
  serverseitigen Zählung.
- Feldlängen an Schreibendpunkten (eigenes Ticket „Eingabegrenzen“).
- Ein globaler `CompressionLayer`.
- Blättern der Schadenliste und der erledigten Medienkontakte (siehe „Entschieden: ohne
  Blättern“).
- Autosave und Verlustschutz der Entwürfe bleiben unverändert.

## Decisions

### D1 Kopfprojektion im Dokumentkern, ein Kopf-DTO je Art

`vorlagendokument::repo` bekommt `liste_koepfe::<T>` mit einem eigenen Select ohne
`l.abschnitte` und ohne `l.aktualisiert_at` und eine Struktur `DokumentKopf`. Jede Art bekommt
ihr Wire-DTO `LageberichtKopf`, `BefehlKopf`, `PressemitteilungKopf` (Schemanamen je Art wie
bei den Anzeige-DTOs; leere Felder gehen wie dort als `null` über die Leitung, kein
`skip_serializing_if`). Die
Listenroute im Kern liefert `Vec<T::Kopf>`; der Trait bekommt dafür einen zweiten assoziierten
Typ. `liste` (mit Abschnitten) entfällt, wenn ihn nach der Umstellung niemand mehr ruft.

`aktualisiert_at` bleibt draußen, damit ein PATCH an den Abschnitten kein Kopffeld ändert (D2).
Kein Listenabnehmer liest es.

Verworfen: `?neuester=1` für das Dashboard. LFH-550 hat einen serverseitigen Lagebild-Endpunkt
bewusst verworfen, und mit der Kopfliste ist die Liste klein genug; das Dashboard rechnet
`neuesterLagebericht` weiter im Client.

### D2 Entwurfs-PATCH kennzeichnet „nur Inhalt“

`aktualisieren` vergleicht Titel und Zeitstand mit dem Stand vorher. Ändert sich keines von
beiden, trägt das Ereignis zusätzlich `"nur_inhalt": true`. `LiveHub` bekommt dafür eine
Variante von `publiziere_objekt` mit Zusatzfeldern; die Payload bleibt ohne Inhalte.

Im Client wertet eine Zuordnung nach Payload (D4) das Kennzeichen aus: nur das Detail
`[<detail-prefix>, einsatz, id]`. Der schreibende Tab selbst invalidiert nach dem Speichern wie
bisher Detail und Liste; die Liste ist auf der Detailseite nicht eingehängt und wird dort nur
als veraltet markiert, nicht abgerufen.

Verworfen: ein eigener Ereignisname `lagebericht_entwurf`. Er bräuchte eine neue
`LiveEvent`-Variante je Art samt Gate-Menge und Wire-Kontrakt, für dieselbe Information.
Verworfen: die Kennung allein auswerten. Sie unterscheidet einen PATCH nicht von einer Freigabe,
die die Liste sehr wohl ändert.

### D3 Medienkontakt und Schaden: Zeilenabgleich statt Listenabgleich

Neuer Baustein `live/zeilenAbgleich.ts`, angedockt an den Sammler der Verbindung:

- `vormerkenZeile(ziel, id)` sammelt Kennungen je Liste im selben 300-ms-Fenster.
- Am Ende des Fensters je Liste: Ist der Tab verdeckt, die Liste nicht im Cache, ein
  Listenabruf oder ein Zeilenabruf dieser Liste noch unterwegs oder sind es mehr als
  `ZEILEN_GRENZE` (10) Kennungen, wird die ganze Liste über den Sammler vorgemerkt (bisheriges
  Verhalten). Sonst lädt der Baustein jede Zeile über den Einzelabruf und setzt sie per
  `setQueryData` ein: ersetzen oder einfügen, entfernen, wenn sie nicht mehr in die Liste gehört
  (stornierter Schaden), dann sortieren wie der Server.
- Scheitert ein Zeilenabruf (auch 404), wird die Liste vorgemerkt.

Ein Ziel beschreibt: Listen-Key, Einzelabruf, Zugehörigkeit (`gehoertDazu`), Sortierung und
abgeleitete Listen. Zwei Ziele:
- **Medienkontakte:** Liste `medienkontakte(e)`, Einzelabruf neu (`GET …/stab/medienkontakte/{kid}`),
  Sortierung offen zuerst, `eingang_at`, `id` absteigend.
- **Schäden:** Liste `schaeden(e)` (ungefiltert, ohne stornierte), Einzelabruf vorhanden
  (`GET …/schaeden/{sid}`), Sortierung `registrier_nr` absteigend; abgeleitet die Markerliste
  `schadenMarker(e)` (Projektion aus derselben Zeile). Die gefilterten Unterlisten
  (`schaedenGeschaedigt`) werden weiter vorgemerkt, sie sind klein.

Der Zeilenabgleich lädt mit derselben Leitung wie jeder Abruf (`apiGet`); die Einzelabrufe einer
Liste laufen parallel.

Verworfen: die Zeile in der Payload mitschicken. Die Payload ist bewusst ohne Inhalte
(Modul-Gate, Personenbezug in Freitexten, `src/live/mod.rs`).

### D4 Zuordnung nach Payload in der Registry

`api/queryKeys.ts` bekommt neben `EINSATZ_STREAM_EVENTS` (bleibt die Prefix-Menge für `lagged`
und Wiederaufbau) eine gezielte Zuordnung `EINSATZ_STREAM_ZIELE`: Ereignisname → Funktion von
Payload und Einsatz auf eine Liste von Abgleichen (`{ key }` oder `{ zeile: ziel, id }`). Gibt
sie nichts zurück (Kennung fehlt, Payload unlesbar), gilt der Prefix-Eintrag. `useEinsatzLiveStream`
leitet die Listener aus beiden Tabellen ab, die Ereignisse mit Seiteneffekt bleiben unberührt.

- `lagebericht` / `befehl`: `nur_inhalt` → Detail; sonst Liste und Detail dieser Kennung.
- `presse`: `medienkontakt_id` → Zeile Medienkontakte; `pressemitteilung_id` → mit `nur_inhalt`
  das Detail, sonst Mitteilungsliste und Detail.
- `schaden`: `anhang` → `schadenAnhaenge(e, id)`; sonst Zeile Schäden und
  `schaedenGeschaedigt`-Prefix.

### D5 Schadenmarker als eigene Route und eigener Key

`GET /api/einsaetze/{id}/schaeden/marker` liefert `Vec<SchadenMarker>`: id, registrier_nr, typ,
ausmass, status, lat, lon, nur nicht stornierte, ohne Joins, gleiches Gate wie die Liste.
Neuer Prefix `EINSATZ_KEYS.schadenMarker`, live über `schaden`, in `LAGEBILD_OFFLINE` neben
`schaeden` (Lagekarte). `schaeden` bleibt offline, damit die Modulseite nichts verliert.

Lagekarte (`useLagekarteDaten`, `marker.ts`, `leistenDaten.ts`, Objektsuche) und Dashboard
(`LAGEBILD_QUELLEN.schaeden`, damit auch `ladeLagebasis` und die Übernahme der Schadenlage)
lesen den Marker. Im Snapshot-Modus der Lagekarte kommen weiter volle Zeilen aus dem Snapshot;
sie werden auf den Marker abgebildet. Die Lagekarte invalidiert nach Verorten zusätzlich den
Marker.

Die Anhang-Routen senden `schaden` mit `"anhang": true` (Variante aus D2).

### D6 Volltext-Abnehmer lesen das Detail

- `LageberichtVorschau` liest `einsatzKeys.lagebericht(e, id)` über `ladeLagebericht`. Der
  Detail-Key ist live (`EINSATZ_STREAM_EVENTS.lagebericht`).
- Einsatzbericht: die Quelle `lageberichte` lädt die Kopfliste und dazu das Detail des zuletzt
  freigegebenen Kettenkopfs (eine zusätzliche Anfrage). `verdichtung.ts` bekommt Kopfliste und
  diesen einen Volltext getrennt.

### Entschieden: ohne Blättern (Umkehr aus LFH-554 vermieden)

Das Ticket verlangt außerdem: erledigte Medienkontakte nur geblättert (`?vor_id=`,
`LIMIT 200`) und die Schaden-Modulliste per Cursor nach Registriernummer. Beides ist in diesem
Entwurf **nicht** enthalten, weil es sichtbares Verhalten ändert:

- **Presse-Log:** Der S5-Entwurf (LFH-554) hat die Vollabfrage ausdrücklich nur für das
  Informationstelefon begründet; für das Presse-Log setzt er sie still voraus: Die Medienlage
  (Spec `stab-medienlage`) rechnet „Medienkontakte gesamt, nach Art, Namen der Medien“ aus der
  geladenen Liste, die Seite zeigt „N Medienkontakte“, und der Deeplink `?kontakt=` findet nur
  geladene Zeilen. Blättern heißt: serverseitige Kennzahlen für die Medienlage, ein Knopf
  „Ältere laden“, Deeplink mit Nachladen. Das kehrt die Festlegung um.
- **Schäden:** Modulseite, Druck, Einsatzbericht, Chat-Bezug und Sprungpalette filtern, suchen
  und zählen im Client über den ganzen Bestand. Blättern heißt serverseitige Suche, Filter,
  Sortierung und Zähler und ein Nachladen in der Liste.

Mit D3 kostet ein Ereignis nur noch eine Zeile; Blättern spart danach nur noch am ersten Laden
einer Seite. Empfehlung: erst messen (Feldbefund), Blättern als eigenes Ticket, wenn das erste
Laden bei echten Beständen stört.

Entscheidung (Ruben, 06.10.2026): ohne Blättern umsetzen; das Blättern wird nach einem
Feldbefund ein eigenes Ticket. Die Festlegung aus LFH-554 bleibt damit unverändert.

## Risks / Trade-offs

- [Zeilenabgleich überholt einen Listenabruf] → Ist ein Listenabruf unterwegs, wird nicht
  gemergt, sondern vorgemerkt (wie im Sammler). Ein Zeilenabruf, der während eines neuen
  Listenabrufs zurückkommt, schreibt nicht mehr: Vor `setQueryData` prüft der Baustein
  `isFetching` erneut und merkt sonst vor.
- [Zwei Ereignisse zur selben Zeile kurz nacheinander] → Läuft für eine Liste noch ein
  Zeilenabruf, wandert die Kennung ins nächste Fenster.
- [Sortierung im Client weicht vom Server ab] → Dieselben Schlüssel wie im SQL, Tests mit
  Gleichstand (gleicher Eingang, gleiche Kennung) und Statuswechsel in beide Richtungen.
- [Offline-Bestand der Befehle ohne Volltext] → Offline zeigt die Befehlsliste nur Kopffelder;
  das Detail war nie offline. Kein Verlust.
- [Abnehmer liest künftig wieder Volltext aus der Liste] → Der Kopf-Typ hat kein Feld
  `abschnitte`; `tsc` verhindert es.

## Migration Plan

Keine Datenmigration. Server und Frontend gehen im selben Binary aus. Ein alter Client gegen den
neuen Server gibt es durch das eingebettete Frontend nur bis zum Neuladen; er bekäme Listen ohne
`abschnitte` und Ereignisse mit Zusatzfeldern, die er ignoriert. Rücknahme durch Revert.
