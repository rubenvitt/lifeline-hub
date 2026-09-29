# Design

## Context

Zum Warum siehe proposal.md. Drei Bausteine liegen auf `alpha`:

- **LFH-640** (`src/einsatz/lagekennzahl.rs`, `pages/lage-dashboard/lagebild.ts`): ein Enum
  `Lagekennzahl { Pegel }` und `lagekennzahl::ableiten(pegel_festgelegt)`. Aufgerufen wird es
  in `Einsatz::anzeige` und in `repo::liste_fuer`, beide lesen den Auslöser als
  `EXISTS`-Spalte aus ihrem SQL-Literal. Im Frontend legt `LAGEKENNZAHL`
  (`Record<Lagekennzahl, …>`) Heimatplatz und Rang fest. `kennzahlReihe` baut daraus sechs
  Etiketten. Die Seite hält ihren Zuschnitt über `zuschnitt` und bietet einen neuen per
  Sammelbanner an. Der Zustand je Kennzahl ist ein `Record<KennzahlEtikett, Datenzustand>`.
- **LFH-639** (`betreuung/evakuierungKennzahl.ts`, `useEvakuierungKennzahl.ts`,
  `betreuungText.ts`): Die Kennzahl ist eine reine Funktion über die Bezirke der Übersicht.
  Der Hook liefert vier Zustände (`aus`/`laden`/`fehler`/`daten`), gegatet über
  `darfZaehlerZeigen('betreuung', …)`. `kennzahlText` formatiert „N · von M geplant“ für den
  Blockkopf der Modulseite.
- **Randbedingungen:** `einsatzKeys.einsatz` ist `NICHT_LIVE`. `plan_personen` trägt den
  CHECK `>= 1`. `Einsatz` ist `sqlx::FromRow` mit genau einem `query_as::<_, Einsatz>` in
  `repo::laden`. Struct-Literale gibt es in `berechtigung.rs` und `mod.rs` (Tests).

## Goals / Non-Goals

**Goals:**
- Kriterium 9 nachweislich halten. Der Nachweis sind Literal-Tests auf `kennzahlReihe` für
  alle Kombinationen und ein Seitentest für das Banner.
- EINE Definition von „aktiver Bezirk“ auf beiden Seiten des Wires und EINE Formatierung für
  Modulseite und Dashboard.

**Non-Goals:**
- Kein Live-Ereignis für den Einsatz-Key. Der Pegel ist der Präzedenzfall. Eine fremde
  Entscheidung kommt beim nächsten Abruf des Einsatzes an (Fokus, Neuaufbau).
- Keine Mindestaktualität der Standmeldungen (offene Frage aus LFH-639, nicht Teil dieses
  Tickets).
- Keine weitere Lagekennzahl und kein Warnton für „Evakuiert“. Für einen Warnton gibt es
  keine festgelegte Schwelle.

## Decisions

### D1 — Auslöser: EXISTS über aktive Bezirke, im SQL der Einsatzabfragen

In `repo::laden` und `repo::liste_fuer` kommt je eine Spalte hinzu:

```sql
EXISTS (SELECT 1 FROM evakuierungsbezirk b
        WHERE b.einsatz_id = e.id AND b.storniert_at IS NULL
          AND b.raeumung <> 'aufgehoben') AS evakuierung_angeordnet
```

Sie steht als Feld `evakuierung_angeordnet: bool` am `Einsatz` und an der `Row` der Liste.
`ableiten(pegel_festgelegt, evakuierung_angeordnet)` gibt die Varianten in Enum-Reihenfolge
zurück. Das Prädikat steht wortgleich zu `istAktiverBezirk` (Frontend). Beide Stellen
verweisen im Kommentar aufeinander. Die Parität prüft der Integrationstest über die
Szenarien geräumt, aufgehoben und storniert.

- *Warum an der Einsatzabfrage:* So verlangt es LFH-640. Die Belegung muss aus der Quelle
  kommen, die zuerst da ist.
- *Verworfen: „Plangröße > 0“ wörtlich.* Der CHECK `>= 1` macht das mit „Bezirk existiert“
  gleichbedeutend. Die fachliche Aussage der LFH-640-Regel („Plangröße auf 0 oder gelöscht“)
  bilden Aufheben und Stornieren ab. Beides sind bewusste Entscheidungen, und beide schreiben
  einen ETB-Eintrag.
- *Verworfen: geteilte SQL-Konstante.* `query_as` nimmt unter sqlx 0.9 nur `&'static str`.
  Das Muster ist dasselbe wie beim Pegel.

### D2 — Heimatplatz: `evakuiert: { platz: 'B', rang: 0 }`

Ein Eintrag im bestehenden `LAGEKENNZAHL`-Record. Der Typ-Codegen zwingt ihn herbei, weil der
`Record` über `Lagekennzahl` sonst den Build bricht. `kennzahlReihe` bleibt unverändert: Es
ermittelt je Platz den ranghöchsten Kandidaten, unabhängig von der Eingabereihenfolge.

### D3 — Rohdaten bekommen den Zustand der Evakuierungskennzahl, nicht die Bezirke

`Rohdaten.evakuierung: EvakuierungStand` wird von der Seite aus
`useEvakuierungKennzahl({ einsatzId, benutzer, overrides, bereit })` über `evakuierungStand`
befüllt. `baueLagebild` baut daraus die Zelle. Die Seite leitet den
`kennzahlZustand['Evakuiert']` aus demselben Stand ab (`evakuierungDatenzustand`: `laden` bleibt
`laden`, `fehler` bleibt `fehler`, alles andere ist `daten`).

- *Warum der Hook und nicht die Bezirke:* Der Hook trägt die Rechteprüfung und die
  Fehler-vor-Altdaten-Regel. Zwei Stellen, die das nachbauen, liefen auseinander.
- *Solange Freigaben unbekannt sind:* Der Hook bekommt einen optionalen Parameter `bereit`
  (Vorgabe `true`). Die Seite setzt ihn erst, wenn Benutzer und Modul-Overrides geladen sind.
  Bis dahin liefert der Hook `laden` und ruft **nichts ab**. Ohne Overrides hielte
  `darfZaehlerZeigen` ein ausgeblendetes Modul für sichtbar. Der Abruf endete dann im 403, und
  „kein Zugriff“ blitzte beim Kaltstart kurz auf. Ein erster Entwurf hatte stattdessen einen
  Merker in `evakuierungStand` vorgesehen. Den Abruf verhinderte er nicht, das hat der
  Seitentest gezeigt.
- *Identität:* Der Hook gibt seinen Zustand per `useMemo` identitätsstabil zurück. Das
  `useMemo` des Lagebilds greift sonst bei keinem Render.
- *Freigaben stehen fest* heißt: Der Benutzer ist geladen **und** der Overrides-Abruf war
  **erfolgreich**. Scheitert der Overrides-Abruf, bleibt das Recht unbekannt. Die Zelle
  zeigt dann „Stand unbekannt“ und ruft nicht trotzdem ab. Nur ein fehlender Ausfall der
  Overrides macht aus dem Zustand „ausgeblendet“ ein „sichtbar“. Das hat das Review
  gefunden.
- *Ziel* (`Rohdaten.evakuierungZiel`) bekommt die Zelle nur bei bestätigtem Recht, gebaut über
  `betreuungPfad`. Beim Laden ist die Zelle kein Link, genau wie `pegelZiel` erst mit den
  Freigaben auf die Modulseite zeigt. Sonst wäre die Ladezelle für eine Person ohne Zugriff
  ein Sprung ins Leere (Review).

### D4 — Wert und Notiz aus EINER Formatierung

`betreuungText.ts` bekommt `kennzahlTeile(k) → { evakuiert: string | null; notiz: string }`.
Dabei gilt `evakuiert` = „≈ 1 320“ oder `null` ohne Meldung, `notiz` = „von ≈ 1 850 geplant ·
2 ohne Meldung“. Die ≈-Regel bleibt, wie sie ist: vor N, solange es ein N gibt, sonst vor M.
`kennzahlText` wird darauf zurückgeführt (`${evakuiert ?? 'keine Meldung'} · ${notiz}`) und
ändert seine Ausgabe nicht. Die Bestandstests bleiben der Beleg dafür. Die Dashboard-Zelle
zeigt `evakuiert ?? '—'`.

- *Warum „—“ statt „keine Meldung“ im Wert:* Die Zelle hat eine Zahlstufe von 32 px Mono. Ein
  Satz passt dort nicht, „—“ ist die Vorlage aus `pegelKennzahl` (kein Messwert).

### D5 — Modul Betreuung für die Person nicht frei: Zelle bleibt, ohne Zahl und Link

Bei `aus` (nach geladenen Overrides) zeigt Platz 3 das Etikett „Evakuiert“ mit Wert „—“, Notiz
„Modul Betreuung nicht freigegeben“, ohne Ton und **ohne Ziel**. Ein Link auf ein
ausgeblendetes Modul wäre ein Sprung ins Leere, wie beim `pegelZiel`.

Abgewogen gegen zwei Invarianten aus LFH-640: **(i)** Die Reihe kommt allein aus der
Einsatzabfrage. **(ii)** Einzelabruf und Liste liefern dasselbe, und die Liste bleibt bei
O(1) Abfragen.

- *Verworfen: Overrides in die Reihe einrechnen* (bei fehlendem Zugriff „Schäden offen“
  zeigen). Das bricht (i). Die Reihe hinge an einer zweiten, ebenfalls nicht live gehaltenen
  Abfrage. Entweder stehen die Ladeplätze länger da, oder die Reihe springt beim Eintreffen der
  Overrides.
- *Verworfen: Backend filtert `lagekennzahlen` je Person* über `erlaubte_module`. Das bricht
  (ii) oder macht die Liste zu N+1. Außerdem hinge die Reihe am Rollenzuschnitt statt an der
  Lage.
- *Was die Zelle verrät:* nur, dass eine Evakuierung angeordnet ist. Diese Entscheidung steht
  ohnehin als `entscheidung` im ETB.

### D6 — Eigene Bezirksänderung ruft den Einsatz neu ab

`BetreuungPage` bekommt eine zweite Invalidierung, `einsatzKeys.einsatz(einsatzId)`. Sie
greift nach Anlegen, Ändern (Räumung, Plangröße) und Stornieren eines Bezirks. Die Stellen-
und Meldungs-Mutationen bleiben ohne sie, weil sie den Auslöser nicht kippen können. Der
Einsatz-Key kommt **nicht** ins SSE-Ereignis `betreuung`: Er ist `NICHT_LIVE`, und der Guard
verlangt genau eine Klassifikation.

### D7 — Doku: Lückenvermerke abräumen, eingefrorene Spec nicht anfassen

Nachgezogen werden die Dateiköpfe und `umsetzung.md` Punkt 4 sowie der CLAUDE.md-Absatz („Bei
Evakuiert ist die Datenquelle seit LFH-639 da; eingetragen wird sie mit LFH-607 …“). Die
LFH-640-Spec unter `docs/superpowers/specs/` bleibt unangetastet (eingefrorenes Archiv). Die
Prüfliste Einsatztauglichkeit steht in `tasks.md` (Abschnitt Prüfliste) und wird bei der
Umsetzung mit Verdikten gefüllt.

## Risks / Trade-offs

- [Auslöser (Einsatz, nicht live) und Kennzahl (Betreuung, live) sind zwei Abrufe und können
  kurz auseinanderlaufen] → Die Zelle zeigt dann ehrlich „—“ mit „keine geplante
  Evakuierung“ (Spec „Datenzustände“) bzw. eine Zahl ohne Platz, bis das Banner übernommen
  wird. Beides ist durch Tests gepinnt.
- [Der SQL-Ausdruck und `istAktiverBezirk` können auseinanderlaufen] → Querverweis in beiden
  Kommentaren. Der Integrationstest deckt jede Räumungsstufe ab.
- [Eine Formatänderung in `kennzahlText` bräche die Modulseite] → `kennzahlText` wird auf
  `kennzahlTeile` zurückgeführt, die Bestandstests bleiben unverändert grün.
- [Die Zelle ohne Zugriff ist eine Zelle ohne Zahl] → Sie benennt den Grund und behauptet
  keinen Wert. Das bleibt mit „Weglassen statt erfinden“ verträglich.

## Migration Plan

Keine Migration. Die Enum-Variante ist additiv auf dem Wire. Ältere Clients kennen
`evakuiert` nicht. Da Frontend und Backend als ein Binary ausgeliefert werden, tritt der Fall
nicht auf. Rollback ist ein Revert.
