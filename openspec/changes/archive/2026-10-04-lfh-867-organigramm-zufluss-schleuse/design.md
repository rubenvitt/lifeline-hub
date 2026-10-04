# Design

## Context

Das Organigramm (`pages/einsatzabschnitte/Organigramm.tsx`, LFH-626) und die Fernmeldeskizze
(`stab/FernmeldeskizzeBild.tsx`, LFH-625) zeichnen sich über das geteilte Gerüst
`components/organigramm/HaengenderBaum.tsx`. Beide Seiten bauen ihr Modell bei jedem Live-Ereignis
(`abschnitt`, `einheit`, `sprechgruppe`, `stab`, `einsatz`) neu und reichen `wurzeln` frisch durch.
Ein neuer Knoten erscheint sofort an seinem Ort, und alles dahinter rückt: in derselben Spalte nach
unten, in der ersten Ebene (Spalten-Grid, `auto-fill`) auch in die nächste Spalte oder Zeile.

Vorhandene Schleusen im Projekt:

- **`Datensicht`** (Zeilenschleuse, Kriterium 12): friert beim Fokuseintritt die Folge der Zeilen
  ein, Inhalt fließt, Entfallenes fällt sofort weg, Zuwachs steht als Knopf „n neue Einträge —
  anzeigen“ in der Werkzeugzeile. Nur Fokus, kein Zeiger.
- **Betroffenen-Karte** (LFH-668, `personen/kartenSchleuse.ts`): hält bei Zeiger (ohne Touch),
  Tastaturfokus oder offenem Bündel Menge, Folge und Lage; Entfallene bleiben stehen; Standzeile
  fester Höhe mit „Live“, „Live pausiert“ oder Sammelbanner; der Bereich umfasst das Banner.
- **ETB-Zeitachse**: Banner als Überlagerung mit Nullhöhe (`position: sticky`).

Das Ticket verlangt „Fokus oder Zeiger“, den Sammelbanner nach dem Muster der `Datensicht`, will
den Druck nicht berühren und lässt offen, ob ein Wegfall springen darf.

## Goals / Non-Goals

**Goals**

- Kein Knoten rückt unter Fokus oder Zeiger, solange jemand mit dem Baum arbeitet.
- Ein Ort für beide Nutzer des Gerüsts; kein zweites Gerüst, keine Schleuse je Seite.
- Druck und Übernahme in den Lagebericht zeigen den Live-Stand.

**Non-Goals**

- Die Baumtabellen der `Datensicht` (Funkplan, Kommunikationsplan; s. D6).
- Wachstum eines Knotens durch fließenden Inhalt (eine zweite Sprechgruppe, ein langer
  Leitername). Das ist Inhalt, wie eine Zelle der `Datensicht`; die Schleuse hält die Struktur.
- Eine Einstellung „Live pausieren“.

## Decisions

### D1 Die Schleuse sitzt im Gerüst, ihre Logik ist rein

`HaengenderBaum` bekommt den Zustand der Schleuse; die Ableitung ist eine reine Funktion in
`components/organigramm/baumSchleuse.ts`, generisch über `BaumKnoten`:

```ts
schleuse<K extends BaumKnoten<K>>(gehalten: readonly K[] | null, frisch: readonly K[])
  → { gezeigt: Gezeigt<K>[]; wartend: { neu: number; umgehaengt: number; entfallen: number } }
```

`gehalten === null` heißt offen: `gezeigt` ist der frische Baum. Sonst läuft die Funktion den
**gehaltenen** Baum ab (Menge, Ort, Folge) und setzt je Schlüssel den frischen Knoten ein, die
Kinder aber aus dem gehaltenen Gerippe. Fehlt ein Schlüssel im frischen Baum, steht der gehaltene
Knoten mit Marke `entfallen`. Gezählt wird je frischem Schlüssel: nicht gezeigt → `neu`; gezeigt,
aber unter einem anderen Elternschlüssel → `umgehaengt`. Je fehlendem gehaltenem Schlüssel
`entfallen`. Ein Sammelknoten (`sammel`) ohne Gegenstück wird wie jeder Knoten gehalten; er trägt
keinen Link.

Verworfen: die Schleuse je Seite (Organigramm, Skizze) mit einem geteilten Hook. Zwei Aufrufer
müssten Standzeile, Bereich und Druckweiche gleich verdrahten; das Gerüst kennt die Knoten ohnehin
nur über `key` und `kinder` und bleibt damit inhaltsfrei.

### D2 Wann die Schleuse zu ist

Bereich ist die ganze `section` des Gerüsts samt Standzeile. Zu, solange
**Zeiger** (`pointerenter`/`pointerleave`, `pointerType` nicht `touch`; die erste `pointermove`
holt ein verpasstes Betreten nach, LFH-668) **oder Fokus** (`focus`/`blur` mit
`relatedTarget`-Prüfung) im Bereich liegen. Ein Menü im Portal gibt es im Baum nicht. Geschlossen
wird mit dem gerade gezeigten Stand, also bei offener Schleuse mit dem frischen.

Jeder Fokus zählt, auch einer per Klick auf ein Klappziel: er sitzt auf einem echten Bedienziel
(anders als der Canvas der Karte in LFH-668, den jeder Klick fokussiert). Das ist das Verhalten
der `Datensicht`. Touch zählt nur über den Fokus.

Sicherheitsnetz nach jedem Render wie in LFH-668 und `FmsTableau`: entfernt ein Render den
fokussierten Knoten (ein entfallener Abschnitt wird zum Platzhalter ohne Link), fällt der Fokus auf
`body`, und kein `focusout` kommt an. Dann **fängt die Standzeile** (`tabIndex={-1}`) den Fokus, und
die Schleuse hält weiter (WCAG 2.4.3); ein Öffnen ließe genau den Platzhalter wegrücken, auf den die
Person zielte (Nachtrag aus dem Review). Liegt der Fokus sonst außerhalb, oder fängt die Standzeile
nicht (im Druck ist sie aus), gilt er als gegangen. „anzeigen“ setzt den Fokus vorher selbst auf die
Standzeile.

Ein leerer Baum schließt nicht: ohne Knoten kann nichts rücken, und der erste Zugang soll nicht
hinter dem Banner landen (wie die `Datensicht`).

### D3 Gehalten wird die Struktur, der Inhalt fließt; Entfallenes bleibt stehen

Gehalten: welche Knoten, unter welchem Elternknoten, in welcher Folge. Frisch: alles, was der
Aufrufer im `inhalt` zeichnet (Name, Rufname, Leitung, Stärke, Sprechgruppen, Kante).

**Ein umgehängter Knoten steht am alten Ort mit seinem gehaltenen Inhalt** (Nachtrag aus dem
Review): die Kante der Skizze urteilt gegen den Elternknoten; frisch hieße sie am alten Ort das
Urteil gegen den neuen. Was vom Ort abhängt, bleibt so beim Ort.

**Eine geänderte Folge wartet gezählt**: steht ein Knoten unter denselben Geschwistern frisch an
anderem Platz (etwa nach einer Umbenennung), zählt er als „umsortiert“; sonst stünde „Live
pausiert“ ohne „anzeigen“, und die Folge spränge beim Öffnen unangekündigt.

**Entfallenes bleibt als Platzhalter stehen** — Abweichung von der `Datensicht`, wie in LFH-668.
Ein aufgelöster Abschnitt in der ersten Ebene zöge sonst alle Spalten dahinter um eine Stelle nach
vorn; das ist genau der Sprung, den das Ticket prüfen lässt. Der Platzhalter zeichnet das Gerüst
selbst, nicht der Aufrufer: `knotenName(alt)` als Text ohne Link in `gedaempft`, daneben das Wort
„entfallen“. So führt kein Link auf einen gelöschten Datensatz, und der Aufrufer braucht keine
zweite Darstellung. Gehaltene Kinder eines entfallenen Knotens stehen weiter unter ihm, mit
frischem Inhalt.

Verworfen: Entfallenes fällt sofort weg (Ticket-Vorgabe „darf“, Muster `Datensicht`). Einfacher,
aber der Wegfall springt.

### D4 Kopf still, Standzeile fester Höhe

**Kopf:** Das Gerüst hält beim Schließen auch das `kopf`-Element und zeichnet es, bis die Schleuse
öffnet. Eine neu besetzte Stabsfunktion verlängert die Stabsstelle um eine Zeile und schöbe den
ganzen Baum. Der Kopf wird nicht gezählt (das Gerüst kennt seinen Inhalt nicht); er zieht beim
Öffnen nach.

**Standzeile** zwischen Kopf und erster Ebene, im Bereich: „Live“, „Live pausiert“ oder der
`Sammelbanner` mit „anzeigen“. Feste Höhe = Höhe des Sammelbanners (Knopf `controlHeight` +
`2 × paddingXS` + Rand, wie `BetroffeneKarte`). Der Text des Banners bleibt einzeilig und endet
schmal mit „…“ (voller Satz im `title` und im Statusbereich), wie in `BetroffeneKarte`; die
Kurzform `sammelbannerKurz` (LFH-694) sagt „n neu“ und passte nicht zu „umgehängt“. Wortlaut: nur Teile über 0, feste Folge, „2 neu · 1 umgehängt · 1 umsortiert · 1 entfallen“; nur der
Banner trägt `role="status"`.

Verworfen: Überlagerung mit Nullhöhe (ETB). Sie deckte die oberste Zeile ab, also womöglich genau
den fokussierten Link (Kriterium 13). Verworfen: Knopf in der Werkzeugzeile der Seite (Muster
`Datensicht`): die Zeile bricht bei 390 px um, und sie liegt außerhalb des Bereichs, der Weg zum
Knopf taute auf.

### D5 Druck und Übernahme

Im Druck gilt die Schleuse nicht: das Gerüst liest `useDruckModus()` und zeichnet bei `druckt`
den frischen Baum und den frischen Kopf. `beforeprint` setzt den Zustand per `flushSync`, der Knopf
(`useDrucken`) und Strg+P laufen beide darüber. Die Standzeile (`data-lfh="org-stand"`)
blendet `haengenderBaumPrint.css` aus. Die Übernahme in den Lagebericht liest schon heute das
frische Modell der Seite (`rendereFuehrungsorganisationMarkdown(org, …)`), daran ändert sich
nichts.

### D6 Die Baumtabellen der Datensicht bleiben draußen

Die Prüfliste des Kommunikationsplans (LFH-848) verweist für Tabelle, Skizze und
Sprechgruppen-Tabelle ebenfalls auf LFH-867. Die Skizze ist das Gerüst und damit hier erledigt.
Die beiden Tabellen sind `Datensicht`-Bäume: deren Schleuse friert nur die oberste Ebene ein (ein
neues Kind springt), und sie kennt keinen Zeiger. Das ist eine Änderung an der `Datensicht` mit
eigenen Guards und allen Listen als Nutzern. Entschieden am 04.10.2026: eigenes Ticket
[LFH-1020](https://app.clickup.com/t/123zgec6jkz); das LFH-848-Verdikt zeigt dorthin.

### D7 Nachweise

- Vitest `baumSchleuse.test.ts`: offen = frisch (dieselbe Referenz); neu, umgehängt, entfallen
  gezählt; Inhalt frisch, Ort und Folge gehalten; Kinder eines Entfallenen bleiben; Sammelknoten.
- Vitest `HaengenderBaum.test.tsx`: Zeiger (mouse) schließt, Touch nicht; Fokus schließt,
  `focusout` nach außen öffnet; Banner mit Wortlaut und `role="status"`; „anzeigen“; Platzhalter
  ohne Link; Kopf gehalten; `beforeprint` zeigt frisch; leerer Baum schließt nicht;
  Sicherheitsnetz fängt den Fokus (auch auf einem Knoten, der zum Platzhalter wird).
- e2e `fuehrungsorganisation.spec.ts`: Fokus auf einem Namenslink, Abschnitt per API anlegen →
  Link-Rechteck unverändert (Δ 0 px), Banner „1 neu“, neuer Abschnitt nicht da; „anzeigen“ → da.
  Zeiger auf einem Link, Unterabschnitt umhängen → Rechteck unverändert; Zeiger raus → am neuen
  Ort. Ohne beides → sofort, kein Banner (der bestehende Live-Test). Banner bei 390 und 1366 px:
  Oberkante des Baums Δ 0 px. Druck mit wartendem Abschnitt (`beforeprint` ausgelöst) → enthalten.
  Fokus auf einem Abschnitt, der aufgelöst wird → Platzhalter, Spalte Δ 0 px, Fokus auf der
  Standzeile. Gehaltener Kopf bei 1366 → 390 px untereinander. Mutationsproben: Schleuse fest offen
  → alle Schleusenfälle rot; ohne Druckweiche → der Druckfall rot; ohne Fangen im Sicherheitsnetz →
  der Platzhalterfall rot; Kopf im Elternteil gebaut → der Kopffall rot.
- e2e Skizze (`funkplan.spec.ts`): Zeigerfall mit Zuordnung einer Einheit.

## Risks / Trade-offs

- **Gehaltene Ansicht wird alt**, solange jemand den Zeiger auf dem Baum parkt. Die Standzeile sagt
  „Live pausiert“, der Banner zählt; Druck und Übernahme sind nie alt.
- **Fokus per Klick hält** (D2), auch nachdem die Maus gegangen ist. Bewusst wie die `Datensicht`;
  der Banner macht es sichtbar.
- **Der Kopf zählt nicht im Banner.** Eine neue Stabszeile erscheint erst beim Öffnen, ohne
  Ankündigung. Selten (Stabsbesetzung), und der Kopf ist kein Ziel der Gliederung. Gehalten wird
nur sein Inhalt: der Kopf des Organigramms ist eine eigene Komponente mit `useViewport`, seine
Anordnung folgt der Breite auch gehalten (sonst liefe er nach einer Drehung auf 390 px über).
- **Inhalt kann einen Knoten verlängern** (Non-Goal). Die Struktur springt nicht, die Höhe eines
  Knotens kann wachsen.
- Die Standzeile kostet eine Zeile Höhe über dem Baum, auch ohne Live-Änderung. Im Druck fehlt
  sie; die erste Ebene hat dort wieder den alten Abstand zum Kopf (`marginLG`).
- **Fokus nach „anzeigen“ per Maus** bleibt auf der Standzeile und hält die Schleuse, auch wenn die
  Maus geht (D2: jeder Fokus hält). Ohne ihn hielte in Safari ein Klick gar nicht.
- **`role="status"` erscheint mit seinem Text** (Muster `Sammelbanner`, wie `BetroffeneKarte`):
  manche Screenreader übergehen die erste Ansage. Eine dauerhafte Live-Region sagte dagegen jedes
  „Live pausiert“ beim bloßen Überfahren an; eine Änderung gehört in den `Sammelbanner` selbst,
  für alle Nutzer.

## Migration Plan

Keine Daten, keine API. Rückweg: die Schleuse im Gerüst entfernen.
