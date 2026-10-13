# Design

## Context

Motivation und Umfang: proposal.md. Verhalten: `specs/benachrichtigungen/spec.md` und
`specs/lagemonitor/spec.md`. Die Entscheidungen der Matrix hat Ruben am 13.10.2026 im Explore
getroffen (Kommentar an LLH-1187).

Bestand, der den Weg vorgibt:

- **Live-Kanal** (`src/live/mod.rs`): ein Broadcast je Einsatz mit Replay-Ring (256 Ereignisse,
  10 min). Gefiltert wird nur nach Modulrecht (`LiveEvent::modul_keys`, `sichtbar_fuer`), nie nach
  Nutzer. Nutzlasten tragen nur Kennungen (F01). Der Org-Kanal (`src/live/org.rs`) kennt schon
  Empfänger als Liste von Nutzer-Kennungen (`Einsatzleser{benutzer_ids}`). Der Einsatz-Strom
  trägt die Org-Ereignisse mit.
- **Ton und Toast** entstehen im Client: `useEinsatzLiveStream` spielt den Ton zu `sofortmeldung`,
  `erinnerung`, `abloesung`, `AlarmZentrale` zeigt Toasts mit einem Budget von drei und einem
  Sammeltoast, `desktopAlarm` zeigt OS-Meldungen nur bei verdecktem Tab.
- **Adressaten** sind fachlich da: `auftrag_empfaenger` (Funktion, Person, Einheit, Abschnitt,
  Fahrzeug, extern, Quittung je Zeile), `befehl_verteiler`/`lagebericht_verteiler` (Funktion,
  Einheit, Abschnitt, extern), `erinnerung.empfaenger_funktion_code`, `nachforderung.erstellt_von_id`.
  Die Meldung hat nur Freitext, der Chat keine Erwähnungen.
- **Wer welche Funktion hat**: `einsatz_stabsfunktion` (S1–S6 → `einsatz_personal` →
  optional `personal.benutzer_id`) und `einsatz_mitgliedschaft.fuehrungsfunktion`; die
  Einsatzleitung steht in `einsatz_fuehrungsstelle`.
- **Geräte** haben je Kopplung ein eigenes Nutzerkonto (`geraet_kopplung.benutzer_id`).
- **Desktop-Hülle** (`src-tauri/`): keine Anwendungslogik, Server-Rechte nur über
  `SERVER_RECHTE`, kein Notification-Plugin.

## Goals / Non-Goals

**Goals:**

- Eine einzige Stelle im Backend, die entscheidet, wer eine Benachrichtigung bekommt; die
  Schreibwege melden nur, *was* geschah.
- Eine einzige Stelle im Frontend, die Benachrichtigungen zeigt, mit dem bestehenden Budget.
- Bestehende Alarme laufen über denselben Weg, damit Adressierung, Ausschluss eigener Aktionen,
  Quittieren und Nachreichen überall gleich gelten.

**Non-Goals:**

- Web Push bei geschlossenem Tab (spätere Stufe, eigene Aufgabe; braucht VAPID, Abos, und auf iOS
  eine installierte PWA).
- Benachrichtigungen an Einheiten, Abschnitte, Fahrzeuge oder externe Stellen; sie haben keinen
  Nutzer. Gekoppelte Geräte bleiben still.
- Ein Benachrichtigungs-Verlauf als eigene Seite; die Module bleiben die Quelle.
- Einstellbare Lautstärke oder eigene Töne.

## Decisions

### D1 Benachrichtigungen werden je Empfänger gespeichert

Neue Tabelle `benachrichtigung` mit einer Zeile je Empfänger: Einsatz, Nutzer, Art, Stufe,
Bezugstyp und Bezugskennung, Auslöser (Nutzer oder leer beim Scheduler), Zeitpunkt, `quittiert_at`.
Der anzuzeigende Text wird nicht gespeichert, sondern beim Lesen aus dem Bezugsobjekt gebildet.

- *Warum:* Quittieren über alle Tabs, Nachreichen nach `lagged` und die spätere Stufe Web Push
  brauchen einen Zustand auf dem Server. Ohne Textspalte entsteht keine zweite Kopie von Inhalten,
  die Aufbewahrung und Schwärzung sonst mitpflegen müssten.
- *Aufbewahrung:* Jede Zeile hängt an einem Einsatz und fällt mit seinem Purge. Die Spalten
  bekommen ihre Klassifikation (`klassifikation_von`). Quittierte Zeilen räumt der Scheduler nach
  24 h ab, unquittierte nach 12 h (die Spanne des Nachreichens).
- *Verworfen:* nur flüchtig über den Live-Kanal (kein Quittieren über Tabs, Alarme gehen bei
  Server-Neustart verloren); Text speichern (Kopie personenbezogener Inhalte).

### D2 Zustellung über ein neues Live-Ereignis mit Empfängerfilter

Neues `LiveEvent::Benachrichtigung` im Einsatz-Strom, Nutzlast `{einsatz_id, benachrichtigung_id,
art, stufe, bezug_typ, bezug_id}`. Intern trägt das Ereignis seine Empfänger-Nutzer. Der
Stream-Builder stellt es nur Verbindungen dieser Nutzer zu, auch beim Replay aus dem Ring. Dasselbe
Ereignis mit `quittiert: true` entfernt Toasts auf den anderen Verbindungen des Nutzers. Für die
Org-Arten (Aufnahme, neuer Einsatz) gibt es `OrgLiveEvent::Benachrichtigung` mit dem bestehenden
Empfängertyp `Einsatzleser{benutzer_ids}`. Den Text holt der Client über
`GET /api/benachrichtigungen/{id}`, das nur dem Empfänger antwortet (sonst 404), und die offene
Liste über `GET /api/benachrichtigungen?offen=true`. `POST /api/benachrichtigungen/{id}/quittieren`
quittiert.

- *Warum:* So bleibt die Nutzlast ID-arm (F01), fremde Nutzer erfahren nichts (auch kein leeres
  Ereignis), und der Replay-Ring trägt Alarme wie bisher nach.
- *Modulrecht:* Weil der Empfängerfilter enger ist als jedes Modul, ist das Ereignis in
  `modul_keys` ungegated wie `einsatz`. Das Modulrecht prüft schon die Empfängerauflösung (D3).
  Den Abschnitt „Org-Ereignisse“ in `src/AGENTS.md` und die Liste der ungegateten Ereignisse
  ziehen wir mit.
- *Verworfen:* Empfänger in die Nutzlast und im Client filtern (verrät Adressaten an alle);
  Adressat je bestehendem Ereignis (jede Art bräuchte einen eigenen Filter).

### D3 Empfängerauflösung an einer Stelle

Neues Modul `src/benachrichtigung/` mit `melden(tx_nach_commit, Anlass)`. Ein Anlass nennt Art,
Bezug, Auslöser und Adressaten als Vorgabe: `Funktion(code)`, `Person(einsatz_personal_id)`,
`Nutzer(id)` oder `ModulLeser(modul)`. Die Auflösung:

1. `Funktion` → Stab-Besetzung (`einsatz_stabsfunktion` → `einsatz_personal` →
   `personal.benutzer_id`, für EL `einsatz_fuehrungsstelle`). Ist sie leer oder ohne Nutzer, gilt
   `einsatz_mitgliedschaft.fuehrungsfunktion`.
2. `Person` → `personal.benutzer_id`; ohne Verknüpfung entfällt der Empfänger.
3. `ModulLeser` → alle Mitglieder mit Leserecht am Modul.
4. Danach entfallen: der Auslöser, Gerätekonten, Nutzer ohne Leserecht am Modul des Bezugs und
   bei Stufe Hinweis Nutzer, die die Art abgeschaltet haben (D6).

Die Schreibwege rufen `melden` nach dem Commit, wie bei den Org-Ereignissen. Der Scheduler ruft
dasselbe ohne Auslöser.

- *Warum Stab-Besetzung vor Mitgliedschaft:* Die Besetzung ist die gepflegte Stelle im Stab; die
  Mitgliedschaft dient heute nur der Vorbelegung (Rubens Entscheidung, Spec „Meine Funktion“).
- *Verworfen:* Auflösung je Schreibweg (verteilt dieselbe Regel auf ein Dutzend Routen).

### D4 Arten und Stufen als geschlossener Katalog

`BenachrichtigungArt` als `wire_enum!` mit fester Stufe je Art. Alarm: `sofortmeldung`,
`sofortmeldung_eskaliert`, `auftrag_ueberfaellig`, `abloesung_faellig`. Hinweis:
`erinnerung_faellig`, `abloesung_vorwarnung`, `auftrag_erteilt`, `auftrag_quittiert`,
`auftrag_erledigt`, `befehl`, `lagebericht`, `meldung`, `lagebesprechung_vorher`,
`lagebesprechung_faellig`, `nachforderung_status`, `gefahr`, `sichtung_eins`, `wieder_verfuegbar`,
`chat_erwaehnung`, `einsatz_aufnahme`, `einsatz_neu`. Dazu `unwetter` nur für die Einstellungen,
weil der Browser Unwetter selbst erkennt.

- *Warum fest:* Die Stufe ist Teil der abgestimmten Matrix; wer sie ändern will, ändert die Spec.

### D5 Frontend: AlarmZentrale wird Benachrichtigungszentrale

`AlarmZentrale` hört auf das Live-Ereignis `benachrichtigung`, holt den Text, spielt den Ton der
Stufe und zeigt den Toast im bestehenden Budget, bei verdecktem Tab zusätzlich die OS-Meldung.
Schließen oder Öffnen quittiert auf dem Server. Die Sonderwege für `sofortmeldung`, `erinnerung`
und `abloesung` in `useEinsatzLiveStream` entfallen: diese Ereignisse frischen nur noch die Listen
auf. Unwetter bleibt im Browser erkannt, prüft aber die Einstellung und läuft durch dasselbe
Budget. Nach `lagged`, nach einem Neuaufbau durch das Frontend und beim Öffnen eines Einsatzes holt
die Zentrale die offene Liste und zeigt, was der Tab nicht schon zeigt (Nachreichen, dezenter Ton
höchstens einmal). Außerhalb eines Einsatzes zeigt eine schlanke Zentrale im Org-Layout die
Org-Arten.

### D6 Einstellungen als Schlüssel in `benutzer_einstellungen`

Neuer Schlüssel `benachrichtigungen_aus` mit der Liste abgeschalteter Arten. Der Server lehnt
Alarm-Arten in der Liste mit 422 ab. Oberfläche: Benutzermenü → „Benachrichtigungen“, je Art ein
Schalter, Alarm-Arten als „immer an“ ohne Schalter. Der Stumm-Knopf je Gerät bleibt, wie er ist.

- *Verworfen:* eigene Tabelle (für eine Liste unnötig); Einstellung im Browser (Rubens
  Entscheidung: folgt dem Nutzer über Geräte).

### D7 Desktop-App: natives Plugin, Klick holt das Fenster

`tauri-plugin-notification` in der Hülle und ein Befehl `benachrichtigung_zeigen(titel, text)`,
der die Meldung zeigt. Er kommt in `SERVER_RECHTE` und ins AppManifest (`build.rs`). Das Frontend
erkennt die Hülle und nimmt bei verdecktem Fenster diesen Befehl statt der Web-Notification. Ein
Klick auf eine native Meldung aktiviert die App; wo das Betriebssystem es nicht von selbst tut,
fokussiert die Hülle das Fenster. Den Sprung zum Bezug trägt der Toast, der dort schon steht.

- *Warum:* WKWebView auf macOS bietet die Web-Notification-API nicht verlässlich; das Plugin
  meldet auf macOS und Windows nativ. Klick-Rückrufe mit Nutzlast liefert das Plugin auf dem
  Desktop nicht, daher die Spec-Formulierung „Fenster nach vorn, Toast bereit“.
- *Regel „keine Logik in der Hülle“:* Der Befehl reicht Titel und Text nur durch und entscheidet
  nichts.

### D8 Meldung bekommt eine Empfängerfunktion

Neue Spalte `meldung.empfaenger_funktion` (Code aus dem Katalog `fuehrung::Fuehrungsfunktion`,
nullable) neben dem Freitext `empfaenger`. Die Erfassung bietet die Funktionen als Auswahl an und
füllt den Freitext vor, wenn er leer ist.

- *Verworfen:* Verteiler wie beim Befehl (eine Meldung hat einen Empfänger); Einheit oder Abschnitt
  als Empfänger (benachrichtigt niemanden, D3).

### D9 Chat-Erwähnung als strukturierte Liste

Der Client schickt mit einer Nachricht die Liste der Erwähnungen (Nutzer oder Funktionscode); der
Text trägt `@Anzeige`. Neue Tabelle `chat_erwaehnung` (Nachricht, Nutzer oder Funktion). Die
Eingabe vervollständigt nach `@` aus Mitgliedern und besetzten Funktionen. Benachrichtigt werden
nur Nutzer, die den Kanal sehen dürfen.

- *Verworfen:* Text serverseitig parsen (mehrdeutig bei gleichen Namen).

### D10 Termine der Lagebesprechung im Scheduler

Der Erinnerungs-Scheduler prüft je Tick `naechste_lagebesprechung_at` aller laufenden Einsätze.
Zwei Merker am Termin (`angekuendigt_vorher_at`, `angekuendigt_faellig_at`) verhindern Doppel; das
Setzen eines neuen Termins leert sie. Empfänger: `Funktion` für EL und S1 bis S7, soweit besetzt.

- *Verworfen:* automatische Erinnerungen wie bei Auftragsfristen (erschienen im Modul
  Erinnerungen als Einträge, die niemand angelegt hat).

### D11 Statuswechsel auf „verfügbar“ am Fahrzeug, an der Einheit nur bei Handstatus

Benachrichtigt wird, wenn die Statuskategorie von `gebunden` oder `nicht_verfuegbar` auf
`verfuegbar` wechselt: am Fahrzeug immer, an der Einheit nur, wenn sie ihren Status von Hand trägt.
Ein abgeleiteter Einheitenstatus meldet nicht noch einmal.

### D12 Geräte und Lagemonitor

Gerätekonten fallen in D3 heraus; das Geräte-Layout spielt keinen Ton mehr (der Sonderweg in
`useEinsatzLiveStream` entfällt ohnehin, D5). Der Lagemonitor bekommt die Zahl offener
Sofortmeldungen in seine verdichtete Antwort und vergleicht im Browser mit dem letzten Stand; steigt
eine der beiden Zahlen, hebt er sie 60 s hervor (Farbe plus Wort, kein Blinken).

## Risks / Trade-offs

- [Flut bei großen Lagen: viele Hinweise in kurzer Zeit] → gemeinsames Budget mit Sammeltoast;
  Hinweis-Arten je Nutzer abschaltbar; Änderungen an bestehenden Objekten bleiben still.
- [Stab-Besetzung ohne verknüpften Nutzer: niemand bekommt die Benachrichtigung] → Ersatz über
  die Mitgliedschaft; der Zähler bleibt; die Anwenderdoku nennt die Verknüpfung als Voraussetzung.
- [Jeder Schreibweg ruft eine Empfängerauflösung mit mehreren Abfragen] → Auflösung nach dem
  Commit außerhalb der Transaktion, eine Abfrage je Adressatentyp; Stufe still erzeugt keine Zeile.
- [Wechsel der Alarme auf den neuen Weg verändert gewohntes Verhalten: der Erfasser einer
  Sofortmeldung hört nichts mehr, Erinnerungen erreichen nur noch Empfänger] → bewusst so
  entschieden, in Spec und Anwenderdoku benannt.
- [Native Meldungen der Desktop-App ohne Klick-Rückruf] → der Toast mit Sprung steht beim
  Aktivieren bereit.
- [Neues ungegatetes Live-Ereignis] → Empfängerfilter im Stream-Builder mit Test, dass Fremde es
  weder live noch im Replay erhalten.

## Migration Plan

Migrationen werden angehängt (`scripts/check-migrationen.sh`): `benachrichtigung`,
`chat_erwaehnung`, `meldung.empfaenger_funktion`, Merker am Lagebesprechungstermin. Keine
Datenübernahme nötig. Rückweg: das Frontend der Vorversion ignoriert das neue Ereignis, die neuen
Tabellen bleiben ungenutzt. Die alten Sonderwege für Ton und Toast entfernen wir erst im selben
Release, in dem die Zentrale den neuen Weg trägt, damit kein Alarm doppelt oder gar nicht kommt.

## Open Questions

- Genaue Texte der Toasts je Art: entstehen mit der Umsetzung, gegen `bedien-wortlaut` geprüft.
