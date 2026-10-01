# Design

## Context

LFH-690 führt die Herkunft jeder neu angelegten Demo-Stammdatenzeile in
`demo_herkunft (import_id, tabelle, datensatz_id)`, Primärschlüssel
`(tabelle, datensatz_id)` (`migrations/0123_demo_daten.sql`). Mitbenutzte Zeilen tragen
keine Marke. Beim Entfernen verliert jede Zeile ihre Marke, auch eine „behaltene“
(`src/demo/entfernen.rs`). Die Marke ist damit schon heute genau die Menge, die eine Anzeige
braucht. Sie verlässt nur nie die Datenbank.

Lesepfade, gemessen am 01.10.2026:

| Art | DTO | Liste / Einzel | Katalog (Verwaltung) | Auswahlliste im Einsatz |
| --- | --- | --- | --- | --- |
| Fahrzeug | `FahrzeugAnzeige` (`src/fahrzeug/mod.rs:90`) | `repo::liste`/`laden`, beide über `SPALTEN` | `stammdaten/FahrzeugeTab.tsx` | `pages/FahrzeugePage.tsx`, „Stamm-Fahrzeug disponieren“ |
| Personal | `PersonalAnzeige` (`src/personal/mod.rs:72`) | `repo::liste_anzeige`/`laden`, beide über `SPALTEN` | `stammdaten/PersonalTab.tsx` | `pages/PersonalPage.tsx` |
| Material | `MaterialAnzeige` (`src/material/mod.rs:45`) | `repo::liste`/`laden`, beide über `SPALTEN` | `stammdaten/MaterialTab.tsx` | `pages/MaterialPage.tsx` |

Alle drei Auswahllisten rufen die Liste mit `nur_im_dienst=true`, nutzen den Wrapper
`components/Select.tsx` (Suche über `optionFilterProp: 'label'`) und bauen ihr `label` als
Zeichenkette. Die Listen-Endpunkte sind jedem Mitglied der Organisation offen. Der
Demo-Status (`GET /api/demo-daten`) ist dagegen nur dem System-Admin offen und nur mit
Freischaltung registriert. Eine Disponentin kann heute also nicht erfahren, welcher Einsatz
der Demo-Einsatz ist.

## Goals / Non-Goals

**Goals**

- Wer eine Stammdatenzeile sieht, sieht auch, ob sie aus dem Demo-Import stammt: in den
  Katalogen, auf den Detailseiten und in den Dispositions-Auswahllisten.
- Eine Quelle der Wahrheit: die Marke in `demo_herkunft`, keine zweite Spalte.
- Die Kennzeichnung trägt ohne Farbe (WCAG 1.4.1).

**Non-Goals**

- **Ausblenden** von Demo-Stammdaten in irgendeiner Liste (D1).
- **Dispositionstabellen im Einsatz** (bereits disponierte Fahrzeuge, Personal, Material).
  Sie lesen Einsatz-DTOs, nicht die Stammdaten-DTOs. Die Verwechslung entsteht bei der Wahl,
  und dort greift diese Change. Eine Marke an der Disposition wäre ein Nachzug.
- Lagekarte, Druck, Offline-Lagebild, Kräfteübersicht.
- Ein Katalogfilter „nur Demo“ oder „ohne Demo“.
- Änderungen an Import oder Entfernen.

## Decisions

### D1 — Kennzeichnen statt ausblenden (E1)

Das Ticket lässt offen, ob Demo-Stammdaten in den Auswahllisten echter Einsätze
ausgeblendet oder nur gekennzeichnet werden.

**Gewählt: A — überall kennzeichnen, in Auswahllisten hinten einsortieren.** Jede Option mit
`demo: true` trägt „Demo“ im Wortlaut und steht hinter allen Optionen ohne Marke. Das gilt
in jedem Einsatz, auch im Demo-Einsatz.

Gründe:

- **Kein neuer Vertrag.** Ausblenden „außerhalb des Demo-Einsatzes“ braucht, dass jede
  Rolle erfährt, welcher Einsatz der Demo-Einsatz ist. Das hieße ein neues Feld am Einsatz
  oder ein Einsatzbezug am Listen-Endpunkt (`?fuer_einsatz=`), samt neuem Cache-Schlüssel.
  Beides erweitert den Demo-Vertrag über den System-Admin hinaus.
- **Keine stille Leere.** Wer einen Funkrufnamen sucht, den er im Katalog „in Dienst“ sieht,
  findet ihn in der Auswahl auch. Eine ausgeblendete Zeile erklärt sich nicht.
- **Der Fehlgriff ist schon heilbar.** LFH-690, D7 fängt ein disponiertes Demo-Fahrzeug
  beim Entfernen ab. Die Marke verhindert die Verwechslung an der Quelle. Ein vollständiges
  Verbot ist dafür nicht nötig.
- **Hinten statt vorn:** Ein Demo-Eintrag fällt nicht mehr als erster Treffer in die Hand.
  Die Reihenfolge innerhalb beider Gruppen bleibt die des Servers.

**Verworfen:**

- **B — außerhalb des Demo-Einsatzes ausblenden.** Am sichersten gegen den Fehlgriff, aber
  mit den Kosten oben (neuer Einsatzbezug, Rollenfrage, Cache-Schlüssel). Dazu kommt ein
  Randfall ohne gute Antwort: Eine Übung, die ein Admin bewusst mit Demo-Fahrzeugen fahren
  will, käme an sie nicht heran.
- **C — überall ausblenden, Schalter „Demo zeigen“.** Blendet die Fahrzeuge auch im
  Demo-Einsatz aus, wo sie hingehören, und braucht ein neues Bedienelement je Auswahl.
- **D — nur kennzeichnen, ohne Umsortieren.** Billiger, aber die Demo-Fahrzeuge
  („Musterstadt 11-1“ …) stünden alphabetisch mitten unter den echten, je nach
  Funkrufnamen der Organisation auch ganz oben.

Will der Mensch B, wird diese Change per `/opsx:update` angepasst (neuer Einsatzbezug in
D2, Szenarien der dritten Anforderung).

### D2 — Ableitung beim Lesen, keine Spalte

`SPALTEN` der drei Repos bekommt eine abgeleitete Spalte, etwa für das Fahrzeug:

```sql
EXISTS (SELECT 1 FROM demo_herkunft h
        WHERE h.tabelle = 'fahrzeug' AND h.datensatz_id = fahrzeug.id) AS demo
```

Der Primärschlüssel `(tabelle, datensatz_id)` macht den Test zu einem Indexzugriff.
`tabelle` ist ein festes Literal je Repo (dieselben drei Werte, die der CHECK erlaubt). Weil
`laden` und `liste` dieselbe `SPALTEN` nutzen, trägt jede Antwort das Feld, auch die von
Anlegen, Ändern und Dienststatuswechsel, die über `laden` zurücklesen. Einen
Einzelabruf gibt es nicht; die Detailseiten lesen die Liste (`'alle'`). Alle Abfragen über `SPALTEN` lesen heute
`FROM <tabelle>` ohne Alias. Das prüft 1.1 nach.

Verworfen:

- **Spalte `ist_demo` an `fahrzeug`/`personal`/`material`.** Eine zweite Wahrheit neben
  `demo_herkunft`. Das Entfernen müsste sie mitpflegen, und eine Migration wäre fällig.
- **Eigener Endpunkt mit den markierten IDs.** Ein zweiter Abruf je Liste und, wenn er dem
  Demo-Status folgt, nur für den System-Admin sichtbar. Die Disponentin ist aber die, die
  die Marke braucht.

### D3 — Feld `demo: bool`, Pflichtfeld

Ein Pflichtfeld statt `Option<bool>` oder `skip_serializing_if`. Der Client muss nicht
zwischen „fehlt“ und „false“ unterscheiden, und der generierte Typ ist `boolean`. Die Kosten:
Jede Test-Fixture mit einem vollständigen `Fahrzeug`, `Personal` oder `Material` braucht das
Feld. Das zeigt `pnpm typecheck` vollständig an.

Der Name `demo` folgt dem Wortlaut der Marke. `ist_demo` wäre im Projekt ungewohnt, die DTOs
führen Zustände ohne Präfix (`sondersignal`, `dienststatus`).

### D4 — Eine Marke, Wortlaut trägt

Eine kleine Komponente `components/DemoMarke.tsx` rendert `StatusTag` mit der Darstellung
`DEMO_MARKE = { rolle: 'neutral', label: 'Demo' }` und `darstellungsart="rand"`. Der
Wortlaut trägt die Bedeutung, der Rahmen ist der zweite Kanal, eine Farbe ist nicht nötig.

- **`neutral`, nicht `achtung`:** Die Herkunft ist kein Warnzustand. Im Katalog stünde
  sonst neben jedem Demo-Fahrzeug ein gelbes Signal, und das schwächte `achtung` dort, wo es
  einen Zustand meint.
- **Nicht `marke`:** Die Rolle ist die Signatur der Anwendung, kein Herkunftszeichen.
- **Einzeldarstellung, keine Karte:** `DEMO_MARKE` ist ein einzelner Wert ohne Enum. Der
  Wächter `ALLE_MAPS` in `theme/statusFarben.test.ts` zählt nur Records aus Darstellungen,
  und die Vorlage ist `OHNE_STATUS` in `kraefte/statusAchse.ts`. 2.1 prüft, dass
  `theme/statusVertrag.guard.test.ts` grün bleibt.

### D5 — Auswahllisten: Wortlaut im Label, reine Hilfsfunktion

Die Option behält ein Zeichenketten-`label` und hängt „ · Demo“ an, also etwa
`Musterstadt 83-1 (RTW) · Demo`. So bleibt die Suche über `optionFilterProp: 'label'` unverändert.
Das geschlossene Feld zeigt nach der Wahl dasselbe, und ein Screenreader liest das Wort mit.
Ein `optionRender` mit `DemoMarke` verworfen: Die Suche fände „Demo“ dann nicht, und das
geschlossene Feld zeigte die Marke nicht.

Kennzeichnen und Sortieren übernimmt eine reine Funktion in `stammdaten/demoMarke.ts` (Name
in 2.4 festgelegt), die alle drei Seiten rufen. Sie sortiert stabil um: zuerst alle ohne
Marke, dann alle mit Marke, die Serverreihenfolge bleibt in beiden Gruppen. Eine Funktion
statt drei Kopien, weil die Regel „Demo hinten“ sonst in drei Seiten auseinanderläuft.

## Risks / Trade-offs

- **Der Fehlgriff bleibt möglich** (D1). Wer „· Demo“ überliest, disponiert weiter falsch.
  Die Folge bleibt die aus LFH-690: Die Zeile bleibt beim Entfernen stehen und zählt als
  „behalten“.
- **Fixture-Aufwand** (D3). Einmalig, vom Typprüfer vollständig angezeigt.
- **Zwischengespeicherte Antworten ohne Feld** (etwa ein Query-Cache aus einer älteren
  Version im offenen Tab) lesen `demo` als `undefined`. Das wirkt wie `false`, also ohne
  Marke. Es ist kein Fehlerbild und vergeht mit dem nächsten Abruf.
- **Lesekosten:** ein Indexzugriff je Zeile. Die Kataloge zählen im Betrieb zwei- bis
  dreistellig.

## Migration Plan

Keine Migration. Das Feld ist additiv. Ein Server ohne je ausgeführten Import liefert überall
`demo: false`, die Oberfläche sieht dann aus wie bisher.

## Open Questions

Keine. Die Wahl in D1 legt der Mensch am Freigabe-Checkpoint fest.
