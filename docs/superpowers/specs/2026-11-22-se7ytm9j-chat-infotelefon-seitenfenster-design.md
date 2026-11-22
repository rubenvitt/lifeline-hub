# Chat und Infotelefon: Seitenfenster in beide Richtungen (LLH-1886)

Stand: 22.11.2026 · Zunder: https://zunder.rubeen.dev/#/aufgabe/se7ytm9j3545m41rao0xi8a9 ·
Herkunft: LLH-1687 (Review-Befunde als Kommentar dort) · Vorbild: ETB-Seitenfenster LFH-947
(`frontend/src/etb/seitenfenster.ts`,
`openspec/changes/archive/2026-10-06-lfh-947-etb-zeitachse-seitenfenster/design.md`) ·
Freigabe: offen

## Absicht

Chat und Infotelefon blättern bisher nur nach unten und halten jede je geladene Seite. TanStack
lädt bei jedem Live-Ereignis alle gehaltenen Seiten einer `useInfiniteQuery` nacheinander neu: wer
im Lagekanal 20 Seiten zurückgeblättert hat, löst mit jeder neuen Nachricht 20 Abrufe aus, in jedem
Tab. Das ETB löst dasselbe mit einem Fenster von höchstens fünf Seiten, das in beide Richtungen
blättert. Dieser Entwurf überträgt das Muster auf Chat-Nachrichten und Infotelefon-Anrufe, ohne die
drei Stellen zu brechen, an denen der Review zu LLH-1687 einen einfachen Deckel scheitern sah.

## Abgestimmt am 22.11.2026 (Phase-1-Checkpoint)

- **Gelesen im Chat:** markiert wird nur, wenn die neueste Seite im Fenster liegt. Der Endpunkt
  bleibt, wie er ist (ganzer Kanal).
- **Helfer:** ein generischer Zwei-Richtungen-Helfer unter `frontend/src/components/` für Chat und
  Infotelefon. `etb/seitenfenster.ts` bleibt unverändert; die Umstellung des ETB ist eine
  Folgeaufgabe.
- **Schleuse und „Neuere laden“:** Eine Seite, die „Neuere laden“ bei eingefrorener Schleuse holt,
  wird übernommen wie eine aus „Ältere laden“ (Antwort auf eine eigene Handlung).

## Ziele

- Ein Live-Ereignis lädt im Chat und im Infotelefon höchstens fünf Seiten neu, gleich wie tief
  jemand geblättert hat.
- Wer tief geblättert hat, kommt lückenlos zurück nach unten („Neuere laden“) oder mit einer
  Handlung direkt ans Ende (eigenes Senden bzw. Erfassen, Pille, Sammelbanner).
- Die Zufluss-Schleuse des Infotelefons hält fremde neue Anrufe weiter zurück, auch wenn vorn
  Seiten aus dem Fenster fallen.
- Der Chat markiert nichts als gelesen, was im Fenster gar nicht vorkommen kann.
- Ein Fenster ohne Kopf bleibt nicht im Cache stehen, wenn man die Ansicht verlässt.

## Nicht-Ziele

- Kein Umbau des ETB-Fensters (Folgeaufgabe, s. u.).
- Kein Gelesen-Stand bis zu einer bestimmten Nachricht (`bis_id`).
- Keine Zahl „x von y geladen“ im Chat oder Infotelefon; die Zählungen bleiben wie sie sind
  (Infotelefon: `…/infotelefon/zaehler`, Chat: `ungelesen_anzahl`).
- Keine Änderung an Meldungen, Aufträgen und Erinnerungen (`components/listenFenster.ts`).
- Kein Offline-Bezug: beide Listen stehen nicht in `LAGEBILD_OFFLINE`.

## Ansätze

**Helfer (E1)**

- **Gewählt: generisch, ETB bleibt.** Ein Modul `components/fensterBeideRichtungen.ts`
  mit Seitenparameter `{ aelter: C } | { neuer: C } | undefined` und einem Cursor-Adapter je
  Liste. Chat und Infotelefon teilen die Logik; das ETB ist eingespielt und hat eigene
  Sonderfälle (Filter, Sprungrichtung über die Kennung), deshalb später.
- Verworfen: ETB gleich mit umstellen (mehr Diff am meistgenutzten Modul, ohne Nutzen für diese
  Aufgabe). Verworfen: je Modul eigene Kopien (dreimal dieselbe Randfall-Logik).

**Gelesen im Chat (E1)**

- **Gewählt: nur mit Kopf im Fenster.** Der Effekt in `ChatPage` bekommt die Bedingung
  `!nachrichtenQuery.hasPreviousPage`. Wer zurück ans Ende kommt, lädt die neueste Seite, die
  Daten ändern sich, und der bestehende Effekt markiert.
- Verworfen: `bis_id` am Endpunkt (genauer, aber Schnittstelle, Zählung und Modulzähler müssten
  mit). Verworfen: wie bisher (Ungesehenes gälte als gelesen).

**Schleuse (E1)** — gewählt: nachgeladene Seiten beider Richtungen zählen zum eingefrorenen
Stand. Verworfen: auf neueren Seiten weiter zurückhalten (ein Klick lüde scheinbar weniger als
verlangt).

## Entwurf

### D1 Backend: Cursor nach oben

**Chat** — `GET …/chat/kanaele/{kid}/nachrichten` nimmt neben `before_id` neu `after_id`:
Nachrichten mit `id > after_id`, **aufsteigend** gelesen (`ORDER BY n.id ASC LIMIT`), damit die
Seite direkt über dem Cursor beginnt, und **absteigend** geliefert wie jede Seite (im Repo
umgedreht). Beide Cursor zugleich → 422 (`src/AGENTS.md`, Statuscode-Konvention: der
Zusammenhang). `NachrichtFilter` bekommt `after_id: Option<i64>`.

**Infotelefon** — `GET …/stab/infotelefon` nimmt neben `vor_zeit`+`vor_id` neu
`nach_zeit`+`nach_id`: Anrufe mit `(eingang_at, id) > (nach_zeit, nach_id)`, aufsteigend gelesen,
absteigend geliefert. Halber Cursor → 422 wie bisher, beide Richtungen zugleich → 422. Die
Wire-Namen folgen der Familie des Endpunkts (`vor_…`/`nach_…` hier, `before_…`/`after_…` im Chat);
nichts Bestehendes wird umbenannt.

`kommunikation::parse_page` und `Seite` dienen auch Meldungen, Aufträgen und Erinnerungen und
bleiben, wie sie sind: ein `nach`-Feld dort würde von deren Repos still übergangen. Das
Infotelefon bekommt eine eigene Leseform (Arbeitsname `parse_fenster` mit Richtung `Vor`/`Nach`
um denselben `ZeitCursor`) in `src/kommunikation/` oder `src/infotelefon/` — Ort im Plan. Die
Zählung (`…/zaehler`) liest keinen Cursor, unverändert.

Rechte und Einsatzgrenze ändern sich nicht: dieselben Extractoren (`EinsatzLesezugriff<Chat>`,
`EinsatzLesezugriff<Infotelefon>`, ADR-0005), derselbe Kanal-zu-Einsatz-Check. Die Antworttypen
bleiben, also kein Typ-Codegen.

### D2 Frontend: generischer Fenster-Helfer

Ein Modul unter `components/` liefert für eine Liste mit Seitengröße `n` und einem
Cursor-Adapter die drei Teile, die `useInfiniteQuery` braucht: `initialPageParam: undefined`,
`maxPages: 5`, `getNextPageParam`, `getPreviousPageParam`. Regeln wie im ETB:

- `undefined` ist der Kopf (neueste Seite); `{ aelter: c }` die Seite unter `c`;
  `{ neuer: c }` die Seite direkt über `c`, absteigend geliefert.
- Nächste (ältere) Seite: nach einer `neuer`-Seite immer `{ aelter: <unterster Cursor> }` (eine
  `neuer`-Seite sagt nichts über Älteres); sonst nur bei voller Seite.
- Vorige (neuere) Seite: am Kopf keine; nach einer `neuer`-Seite nur, wenn sie voll war; nach
  einer `aelter`-Seite immer `{ neuer: <oberster Cursor> }`.
- **Leere Seite:** Das ETB rechnet mit `lfd_nr ± 1`. Der Adapter liefert dafür zwei Funktionen,
  die aus einem Cursor den Cursor „direkt daneben, ihn selbst einschließend“ machen: Chat
  `id ± 1`, Infotelefon `(zeit, id ± 1)` — die Ordnung ist lexikografisch über
  `(eingang_at, id)`, also schließt `vor (zeit, id + 1)` den Anruf `(zeit, id)` ein.
- Kopf im Fenster heißt `!hasPreviousPage`.

Dazu `kopfVerlassen`, `zumKopf` und `useKopfBeimVerlassen` aus `components/listenFenster.ts`:
sie gelten unverändert (der Kopf ist der Parameter `undefined`) und werden wiederverwendet. Der
Kommentar dort („Chat und Infotelefon tragen das Fenster bewusst nicht“) wird ersetzt.

### D3 Chat

- `nachrichtenQuery` nutzt den Helfer mit Cursor `id`; `listeNachrichten` bekommt den
  Richtungsparameter (`before_id` oder `after_id`).
- **„Neuere laden“** steht am unteren Ende des Stroms, über der Eingabe, solange der Kopf fehlt.
- **Mitlaufen und Pille:** `NachrichtenStrom` bekommt `kopfImFenster`. Ohne Kopf springt der
  Strom nicht ans Ende, wenn „Neuere laden“ unten eine Seite anfügt (das ist Lesen, kein neuer
  Zufluss), und die Pille „n neue Nachrichten“ zählt nicht. Fällt beim Weiterblättern vorn die
  älteste Seite heraus, bleibt die Lesestelle stehen; wie beim heutigen „Ältere laden“ trägt das
  der Bildlauf-Anker des Containers — der Plan prüft das im Browser und ergänzt einen Anker nach
  dem Muster `useFunkprotokollLauf`, wenn er fehlt.
- **Eigenes Senden** aus tiefem Fenster ersetzt das Fenster durch den Kopf (`zumKopf`) und
  springt ans Ende, wie im ETB (`erfassenUndZeigen`).
- **Gelesen:** nur mit Kopf im Fenster (s. Ansätze).
- **Verlassen** (Kanalwechsel, andere Seite) mit Fenster ohne Kopf: `useKopfBeimVerlassen` je
  Kanalschlüssel; der nächste Besuch holt frisch die neueste Seite.

### D4 Infotelefon

- `anrufeQuery` nutzt den Helfer mit Cursor `(eingang, id)` (`anrufCursor`); `loadAnrufe`
  bekommt `nach` neben `vor`.
- **„Neuere laden“** steht unter der Liste, über dem Sammelbanner, solange der Kopf fehlt;
  `useFunkprotokollLauf` bekommt `kopfImFenster` (wie im ETB, kein Mitlaufen ohne Kopf).
- **Eigenes Erfassen** und **„anzeigen“ im Sammelbanner** ersetzen das Fenster durch den Kopf,
  bevor sie ans Ende springen.
- **Schleuse:** Heute merkt sich die Seite `frozenPageCount` (Seitenzahl beim Einfrieren) und
  `appendedPageIds` je Seitenindex. Mit `maxPages` fällt beim Weiterblättern vorn eine Seite weg,
  die Indizes verrutschen, und eine Seite aus dem eingefrorenen Stand gälte als „angehängt“ oder
  umgekehrt: das ist die Lücke, durch die ein fremder Nachtrag ohne Kopf durchrutschte. Neu
  verfolgt die Seite die beim Einfrieren gehaltenen und die danach geholten Seiten über ihren
  **Seitenparameter** (als Text, `JSON.stringify`): Seiten, die beim Einfrieren da waren, liefern
  den Stand wie bisher (`einfrieren`); jede danach geholte Seite, gleich welcher Richtung, wird
  mit den Kennungen aufgenommen, mit denen sie **zuerst** erschien (`extendEinfrierstand`). Ein
  Live-Nachladen derselben Seite bringt so weiter keinen fremden Nachtrag in den Stand. Die
  Wassermarke bleibt die höchste beim Einfrieren gezeigte Kennung.
- **Deeplink** außerhalb des Fensters: wie bisher einzeln holen und oben anstellen.
- **Verlassen** mit Fenster ohne Kopf: `useKopfBeimVerlassen` je Sicht.

### D5 Regeln und Doku

- `frontend/src/infotelefon/AGENTS.md`, „Fenster und Zählung“: Fenster von fünf Seiten in beide
  Richtungen, Schleuse über Seitenparameter, „Neuere laden“ zählt wie „Ältere laden“.
- `components/listenFenster.ts`: Kommentar zu Chat und Infotelefon ersetzen.
- Anwenderdoku `docs/anwender/kapitel/chat.md` („Ältere laden“, Gelesen) und
  `docs/anwender/kapitel/infotelefon.md` („Ältere laden“): „Neuere laden“, Sprung ans Ende nach
  eigenem Senden/Erfassen, gelesen erst am Ende. Mitänderungsregel nach
  `docs/anwender/AGENTS.md`; Bilder nur, wenn ein bestehendes Bild den Knopf zeigt.
- Kapitel der Architekturdoku nur, wenn sie die Seitengröße oder das Fenster nennen (im Plan per
  Grep prüfen).

## Tests

- **Rust:** je Endpunkt — `after_id`/`nach_…` liefert die Seite direkt über dem Cursor, absteigend;
  Gleichstand bei gleichem Eingang über die Kennung; beide Richtungen zugleich → 422; halber
  `nach`-Cursor → 422; fremder Einsatz/Kanal unverändert 404.
- **Vitest:** Helfer (alle Übergänge wie `etb/seitenfenster.test.ts`, dazu leere Seiten mit beiden
  Cursor-Arten); Schleuse über Seitenparameter: Fenster friert ein, vorn fällt eine Seite weg, ein
  Live-Neuladen bringt einen fremden Nachtrag → bleibt zurückgehalten; „Neuere laden“ bei
  eingefrorener Schleuse → übernommen; Chat markiert ohne Kopf nicht, mit Kopf schon.
- **Gate:** `./scripts/check-all.sh --geaendert --ohne-e2e`.

## Risiken

- **Bildlauf beim Wegfallen vorn** (Chat): je nach Browser springt die Lesestelle. Abhilfe s. D3;
  Nachweis im Plan per Playwright.
- **Seitengrenzen nach Live-Neuladen:** TanStack rechnet beim Neuladen ab der ersten Seite die
  Folgeparameter neu; Überlappungen fängt im Infotelefon die bestehende Doppelprüfung, im Chat
  entsteht keine (exakte Kennungs-Cursor).

## Folgeaufgaben

- ETB auf den generischen Helfer umstellen (Zunder, nach dem Merge anlegen).
