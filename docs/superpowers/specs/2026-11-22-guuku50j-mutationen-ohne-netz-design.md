# Mutationen ohne Netz: sofort scheitern statt pausieren (LLH-1950)

Zunder: https://zunder.rubeen.dev/#/aufgabe/guuku50jetu1zqkmbruioj69

## Warum

Ohne Netz legt jemand bei den Unfallhilfsstellen oder Bereitstellungsräumen etwas an und drückt
„Anlegen“. Die Mutation läuft mit TanStacks Vorgabe `networkMode: 'online'` und **pausiert**,
statt zu scheitern; `isPending` bleibt `true`. Die Erfassungshülle (`components/Erfassung.tsx`,
`sperrtAbbruch`) sperrt dann Abbrechen, Kreuz, Maske und Escape. Der Dialog deckt die Seite ab,
bis das Netz zurück ist, und schickt die Erfassung danach **still** ab, obwohl die Person sie
vielleicht aufgegeben hat.

Das trifft nicht nur `AnlegenModal`, sondern jeden Dialog der Erfassungshülle (rund 130) und jede
andere Mutation ohne eigenes `networkMode`. Es widerspricht dem Grundsatz in
`api/queryClient.ts`: „sämtliche Mutationen werden nie automatisch erneut gesendet“. Niemand im
Code ruft `resumePausedMutations` oder verlässt sich auf das Pausieren; was ohne Netz gelten
soll, läuft über die Offline-Queue (`offline/schreiben.ts`) und setzt `'always'` schon selbst.

## Ziele

- Ohne Netz scheitert jede Mutation sofort mit `NetzFehler`. Die Hülle zeigt den Grund im Dialog
  („Keine Verbindung — die Aktion wurde NICHT abgeschickt“), Abbrechen bleibt möglich.
- Kein Schreibvorgang geht nach der Rückkehr des Netzes still hinaus.
- Prod und Tests verhalten sich gleich.

## Nicht-Ziele

- Kein neuer Offline-Weg für UHS oder Bereitstellungsraum (keine Vormerkung).
- Queries bleiben bei `'online'` (Lagebild ohne Netz, LFH-723, unverändert).
- Die bestehenden ausdrücklichen `networkMode: 'always'` bleiben stehen (Offline-fähige Wege
  dokumentieren damit ihre Regel aus `offline/AGENTS.md`, „Schreiben ohne Netz“).

## Ansätze

- **A — globale Vorgabe `mutations.networkMode = 'always'` (gewählt, 22.11.2026).** Ein Eingriff
  behebt alle Dialoge; die Regel steht an einer Stelle.
- **B — nur `AnlegenModal`.** Kleinster Eingriff, aber die übrigen Dialoge bleiben ohne Netz
  gesperrt und schicken später still ab.
- **C — UHS/BR über `offline/schreiben.ts` vormerken.** Neuer Offline-Weg mit Abgleich und
  Konflikten; unverhältnismäßig für ein Anlegen, das ohne Netz ohnehin selten ist.

## Entwurf

- `api/queryClient.ts`: `erzeugeQueryClient` setzt für Mutationen `networkMode: 'always'` **in
  der Fabrik selbst**, unter die übergebenen Vorgaben gelegt
  (`mutations: { networkMode: 'always', ...defaultOptions.mutations }`). So gilt es auch für den
  Testclient (`test/utils.tsx`, `neuerQueryClient`) und jeden Test, der eigene Vorgaben übergibt;
  wer ausdrücklich etwas anderes will, setzt es an der Mutation. Der Vergleich
  `defaultOptions === queryClientDefaults` (Liegezeit) prüft weiter die übergebene Eingabe.
  *Eigene Entscheidung im Entwurf.*
- Kommentar am Seam: warum Mutationen nie pausieren.
- `offline/AGENTS.md`, „Schreiben ohne Netz“: neue Regel „Mutationen pausieren nie“ (Vorgabe in
  der Fabrik; eine Mutation, die vormerken soll, geht über die Offline-Queue, nicht über den
  Mutations-Cache). Der Satz über `'always'` bei `erfasse…OfflineFaehig` bleibt.
- Kommentare, die das Pausieren als Vorgabe beschreiben (`offline/lagebildFilter.ts`,
  `lagebildOffline.guard.test.ts`, `command-palette/VorschauZustand.tsx`), an den neuen Stand
  anpassen, wo sie sonst falsch würden. Der Guard „keine Mutationen auf der Platte“ bleibt: er
  baut einen eigenen `QueryClient` mit TanStacks Vorgabe und prüft den Dehydrier-Filter, der
  weiterhin gilt.

## Tests

- `api/queryClient.test.ts`: Eine Mutation aus `erzeugeQueryClient()` (Prod-Vorgaben) und aus
  `erzeugeQueryClient({ mutations: { retry: false } })` ruft bei `onlineManager` offline ihre
  `mutationFn` sofort auf und pausiert nicht.
- `components/AnlegenModal.test.tsx`: offline (`setzeOnline(false)`), `legeAn` scheitert mit
  `NetzFehler` → der Grund steht im Dialog, „Abbrechen“ ist bedienbar und schließt.
- Mutationsprobe: ohne die Vorgabe werden beide Tests rot.

## Dem Umsetzenden überlassen

Wortlaut der Kommentare und der Regel; ob weitere Kommentare das Pausieren als Vorgabe nennen
(grep `networkMode`).
