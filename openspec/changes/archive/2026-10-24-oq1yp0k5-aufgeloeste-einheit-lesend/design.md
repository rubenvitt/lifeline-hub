# Design

## Context

LLH-1079 hat das Auflösen eingeführt: `einheit::repo::aufloesen_tx` löst alle Kräfte
(`einheit_id = NULL` an `einsatz_personal`, `einsatz_fahrzeug`, `einsatz_material`), zieht
Untereinheiten hoch, löst Sprechgruppen und Skizze, beendet die Schicht, verlässt einen
Bereitstellungsraum und setzt zuletzt `aufgeloest_at`, `aufgeloest_von` und `fuehrer_id = NULL`.
Mit Spur bleibt die Zeile stehen, ohne Spur wird sie gelöscht. `GET …/einheiten?aufgeloeste=1`
(`list_aufgeloeste`) liefert die aufgelösten als `EinheitAnzeige` mit leeren Mitgliederlisten.

Im Frontend sucht `EinheitDetailPage` die Einheit nur in `listeEinheiten` und zeigt sonst „Diese
Einheit gibt es nicht (mehr)“. Der Block „Aufgelöst“ auf `EinheitenPage` (`EntlassenBlock`) setzt
kein `ziel`. Ein ETB-Eintrag trägt keinen Verweis auf eine Einheit; `etb_eintrag_einheit` hält
nur die Empfänger eines Auftrags beim Schreiben (LLH-1175), der Filter „betrifft Einheit“ liest
sie, und sie zählt in `SPUREN_EINHEIT` als Spur.

Befund, der den Zuschnitt bestimmt: **die letzte Besetzung ist nach dem Auflösen nirgends mehr.**
Die Zeitachse der Einheit trägt nur Eintreffen und Entlassung; die Fan-out-Kopien an Personen
nennen zwar die Einheit, aber nur für Personen mit offener Periode, Fahrzeuge und Material nie.
ETB-Texte („Einheit «X»: «Y» zugeordnet“) sind Prosa ohne Schlüssel.

## Goals / Non-Goals

**Goals:**

- Beim Auflösen festhalten, wer und was zur Einheit gehörte (Personen mit Führer und Sitz,
  Fahrzeuge, Material mit Menge).
- Eine aufgelöste Einheit unter ihrer Adresse lesend öffnen, ohne jedes Bedienelement außer Links.
- Einstieg aus dem Block „Aufgelöst“ und aus dem ETB.

**Non-Goals:**

- Keine nachträgliche Besetzung für Einheiten, die vor der Migration aufgelöst wurden: sie ist
  nicht rekonstruierbar, die Ansicht sagt das („Keine erfundenen Daten“, `frontend/AGENTS.md`).
- Kein Verweis an ETB-Einträgen der Auflösung, die vor der Migration entstanden (ein Abgleich über
  den Text träfe bei gleichnamigen Einheiten falsch).
- Kein Wiederherstellen einer aufgelösten Einheit (LLH-1079 design.md D5 bleibt).
- Keine letzte Besetzung im Meldebild-Druck, Lagebericht oder Einsatzbericht; das wäre ein
  eigener Nachzug, das Feld liegt dann schon auf dem Draht.
- Keine Untereinheiten in der festgehaltenen Besetzung: sie wandern beim Auflösen zur
  Über-Einheit und bleiben selbst offen.

## Decisions

### D1 Festhalten beim Auflösen in einer eigenen Tabelle

Neue Tabelle `einsatz_einheit_letzte_besetzung`, eine Zeile je Kraft: `einheit_id`, `art`
(`personal` · `fahrzeug` · `material`), genau einer der Verweise `personal_id`, `fahrzeug_id`,
`material_id` auf die Dispositionszeile, dazu nur, was sich nach dem Auflösen ändern kann und zum
Nachweis gehört: `ist_fuehrer` und `auf_fahrzeug_id` (Sitz der Person) an Personen, `menge` an
Material. Dazu an `einsatz_einheit` das Kennzeichen `besetzung_festgehalten` (0/1), damit „leer
festgehalten“ (Einheit ohne Kräfte, nur verpflegt) von „nicht festgehalten“ (vor der Migration)
unterscheidbar bleibt.

`aufloesen_tx` liest die Mitglieder **vor** dem Lösen (gleiche Transaktion) und schreibt die
Zeilen und das Kennzeichen erst nach der Entscheidung „bleibt stehen“ (`!geloescht`); eine
gelöschte oder stornierte Einheit hält nichts fest.

Namen, Funktion, Funkrufname, Fahrzeugtyp und Bezeichnung werden **beim Lesen** aus den
Dispositionszeilen geholt, nicht kopiert: die tragen ihre Namen schon als Snapshot, ihre
Schwärzung (Aufbewahrung, Art. 17) greift so ohne neue Regel, und eine später stornierte Kraft
fällt heraus (Spec: stornierte Kräfte in keinem Nachweis).

Verworfen:
- **Rekonstruktion aus Zeitachse oder ETB-Texten:** unvollständig (Material, Fahrzeuge, Personen
  ohne Periode) und raten aus Prosa.
- **JSON-Spalte mit Namen an `einsatz_einheit`:** Personennamen als Kopie außerhalb der
  geschwärzten Tabellen, eigene Schwärzungsregel, keine Links.
- **Bindung nicht lösen, nur als „historisch“ markieren:** bricht „Bindungen lösen“ und jeden
  Zähler, der heute `einheit_id` liest.

### D2 Auf dem Draht als Feld der aufgelösten Liste

`EinheitAnzeige` bekommt `letzte_besetzung: Option<LetzteBesetzung>`, gefüllt nur in
`list_aufgeloeste` und nur bei `besetzung_festgehalten = 1`; fehlt sonst (aktive Einheiten nie).
`LetzteBesetzung { personal: Vec<LetztePerson>, fahrzeuge: Vec<LetztesFahrzeug>,
material: Vec<LetztesMaterial> }`, je mit der Dispo-Kennung (`ep_id`, `ef_id`, `em_id`) für Links,
gebündelt mit einer Abfrage je Art über alle aufgelösten Einheiten (kein N+1). Die Mitglieder-
listen und Stärken der aufgelösten bleiben leer bzw. null: kein Zähler und kein Einsatzbericht,
der `?aufgeloeste=1` liest, rechnet mit der letzten Besetzung.

Verworfen: **eigener Endpunkt `GET …/einheiten/{eid}`** — die Detailseite lädt ohnehin Listen,
die aufgelösten sind wenige, und ein zweiter Leseweg müsste den Teilbaum-Filter des
Abschnittsgeräts (`geraet::abschnitt::bereich`) doppeln. **Mitgliederlisten mit der letzten
Besetzung füllen:** dieselben Felder hießen dann je nach Abfrage „jetzt“ oder „damals“, und Stärke
und Einsatzbericht zählten sie.

### D3 Eigene lesende Ansicht statt Lesemodus der aktiven

`EinheitDetailPage` fragt die aufgelösten (`einsatzKeys.einheitenAufgeloeste`) nur, wenn die
aktive Liste angekommen ist und die Einheit nicht enthält, und rendert dann
`EinheitAufgeloestAnsicht` (neu, `pages/einheit/`). Erst wenn auch dort nichts steht, bleibt
„Diese Einheit gibt es nicht (mehr)“. Wird eine geöffnete Einheit anderswo aufgelöst, verliert
die aktive Liste sie, und die Seite fällt von selbst auf die lesende Ansicht.

Die Ansicht baut nur aus `components/instrument/`: Seitenkopf mit Name, Meta „aufgelöst
<Zeit>“ (über `useAnzeigeKonventionen`), Paneel „Kopfdaten“ als `Datenraster` (Typ, Abschnitt,
Funkrufname, Bemerkung, „—“ für leer), Paneel „Letzte Besatzung“ gegliedert nach Fahrzeugen (eine
Person mit `auf_fahrzeug_id` eines festgehaltenen Fahrzeugs unter ihm, übrige unter „ohne
Fahrzeug“, Führer markiert), Paneel „Material“ mit Menge, Paneel „Zeitachse“. Ohne
`letzte_besetzung` ersetzt ein `PaneelZustand` die drei Kräfte-Paneele: „Letzte Besetzung nicht
festgehalten (vor dem Festhalten aufgelöst)“. Links auf Person und Fahrzeug nur mit Freigabe des
jeweiligen Moduls (`buildEinheitRechte`: `hasPersonalLink`, `hasFahrzeugLink`), sonst Text.

`KraftZeitachse` bekommt `lesend`: ohne „Nachtragen“, ohne Streichen-Knöpfe und ohne
Rechte-Hinweis; die Ereignisse stehen wie bisher.

Verworfen: **die aktive Ansicht mit allen Rechten auf `false`** — sie liest Besatzung und
Fahrzeuge aus den Live-Listen von Personal und Fahrzeugen (`einheit_id`), die nach dem Auflösen
nichts mehr nennen, und zeigt ohne Schreibrecht deaktivierte Knöpfe statt keiner.

### D4 ETB-Verweis über `etb_eintrag_einheit`

`end_einheit` (`routes/einsatz_einheit.rs`) schreibt beim Auflösen den System-Eintrag wie bisher
und verknüpft ihn, wenn die Einheit stehen bleibt, in `etb_eintrag_einheit` mit ihr (nach
`aufloesen_tx`, in derselben Transaktion; die Spur-Prüfung ist dann schon gelaufen). Die Tabelle
heißt damit „Einheiten, die der Eintrag festhält“ statt nur „Empfänger beim Schreiben“; der
Kommentar am Filter `einheit_id` (`etb::repo`) wird berichtigt. Der Filter „betrifft Einheit“
findet dadurch auch den Eintrag der Auflösung.

`EtbEintragAnzeige` bekommt `einheiten: Vec<EtbEinheitVerweis { id, name }>`, leer statt
fehlend, nachgeladen je Seite mit einer Abfrage wie `folgeauftraege_nachladen` (auch in
`laden`). `EtbBacklinkBadges` zeigt je Einheit „Einheit «Name» ↗“ auf `einheitDetailPfad`;
`hatVerknuepfung` zählt `einheiten` mit, damit ein solcher Systemeintrag einzeln steht.

Verworfen: **neue Spalte `etb_eintrag.einheit_id`** — zweite Quelle neben der Tabelle, der
Filter müsste beide lesen, und Auftragseinträge bekämen keinen Verweis. **Namen im Text
verlinken** — Namen sind nicht eindeutig und ändern sich.

Folge, bewusst: Auftragseinträge zeigen jetzt je Empfänger-Einheit einen Verweis. Bei einem
Auftrag an viele Einheiten wird die Hinweiszeile länger (sie bricht um).

## Risks / Trade-offs

- **Lange Hinweiszeile bei Aufträgen an viele Einheiten** → bricht um; falls das stört, lässt
  sich der Verweis auf Systemeinträge beschränken, ohne Draht oder Tabelle zu ändern.
- **Neue Tabelle mit Verweisen auf Dispositionszeilen** → Schwärzungsregister, FK-Wächter,
  Zustandswächter der Kräftetabellen und Einsatz-Löschung/Demo-Import müssen sie kennen; die
  Wächter (`schwaerzung_registry`, `entlassung`-Zustandswächter, Transfer) melden das, die
  Aufgaben ziehen sie nach.
- **Zustandswächter:** das Lesen der letzten Besetzung fragt die Kräftetabellen bewusst ohne
  „aktiv“ ab (die Kräfte sind entlassen oder woanders), filtert aber `storniert` heraus; es kommt
  mit Begründung in die Ausnahmeliste.

## Migration Plan

Eine Migration mit der nächsten freien Nummer über `origin/alpha` (heute 0252, zweimal umgelegt gegen gleichzeitig gemergte 0250 und 0251): Tabelle samt
Index auf `einheit_id` und die Spalte `besetzung_festgehalten INTEGER NOT NULL DEFAULT 0`. Kein
Rückfüllen. Rückweg: Tabelle und Spalte bleiben ungenutzt stehen, wenn der Code zurückgerollt
wird.

## Open Questions

- ~~Verweise an Auftragseinträgen ja oder nur am Systemeintrag der Auflösung?~~ Entschieden bei
  der Freigabe (24.10.2026): auch an Auftragseinträgen.
