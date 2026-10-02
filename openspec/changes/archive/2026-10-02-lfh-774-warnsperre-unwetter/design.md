# Design

## Context

Motivation und Umfang stehen in `proposal.md`, die Anforderung in
`specs/bedien-helligkeit/spec.md`. Maßgeblich ist der Bestand auf `origin/alpha` `7bec54c`
vom 02.10.2026.

**Warnquelle (LFH-397, D3).** `einsatz/useAktiveWarnung.ts` liest zwei Abfragen, die es im
Rahmen ohnehin gibt: die Gefahrengebiete, nur mit Freigabe über `istModulFreigegeben`, und den
Modulzähler. Die Merkmale reicht es an die reine Regel `einsatz/aktiveWarnung.ts` weiter.
`EinsatzLayout` meldet das Ergebnis über `useWarnsperre` an den Provider. Wenn die Freigaben
scheitern, meldet der Hook fail-safe `true` (LFH-669).

**Wetter im Rahmen (LFH-663).** `einsatz/useModulZaehler.ts` fragt
`useQuery({ ...wetterAbfrage(einsatzId), enabled: darfZaehlerZeigen('wetter-pegel', …) })` ab:
Schlüssel `einsatzKeys.wetter`, alle 5 min, kein Stream-Ereignis. Ein Ausfall der Quelle ist
kein HTTP-Fehler, er steht als `zustand` (`ok` · `kein_ort` · `ausfall`) im Teil `warnungen`.
`wetter/wetterStand.ts` liefert `teilStand` (aktuell · veraltet · unbekannt · kein_ort, mit
Obergrenze des Alters) und `teileWarnungen` (gilt jetzt gegen angekündigt, Abgelaufenes fällt
heraus). `wetter/unwetter.ts` baut darauf `unwetterLage` auf und filtert mit der eigenen Liste
`UNWETTER_STUFEN = ['schwer', 'extrem']`. `wetter/useUnwetterUhr.ts` weckt den Rahmen an Beginn,
Ende und Obergrenze einer Unwetterwarnung.

**Statusvertrag.** `theme/statusFarben.ts:dwdWarnstufe` legt `schwer` und `extrem` auf
`alarm`, `gering` und `maessig` auf `achtung`.

## Goals / Non-Goals

**Goals:**

- Die Sperre greift bei einer jetzt geltenden Unwetterwarnung, ohne dass eine Anfrage
  hinzukommt.
- Welche Stufe sperrt, sagt allein der Statusvertrag. So verlangt es das Ticket, und so ist es
  schon beim Merkmal (a).

**Non-Goals:**

- Keine Änderung an `wetter/unwetter.ts`, am Modulzähler, am Unwetterhinweis oder an der
  Überblick-Marke (LFH-663).
- Kein Stream-Ereignis und kein Server-Poller für das Wetter. Der 5-min-Takt bleibt.
- Das Benutzermenü nennt die Quelle der Warnung weiterhin nicht (Bestand LFH-397).
- NINA-/CAP-Warnungen (`capSchwere`) sperren nicht. Sie sind nicht Teil des Wetter-Abrufs.

## Decisions

### D1 Der Abruf ist vertretbar, weil er schon läuft

Das Ticket fragt, ob ein Wetterabruf im Layout für jeden Einsatz vertretbar ist. Die Frage ist
seit LFH-663 beantwortet: Der Rahmen fragt schon ab. `useAktiveWarnung` nutzt
`wetterAbfrage(einsatzId)` mit demselben Schlüssel und derselben Abruffunktion, und TanStack
Query teilt das Cache-Fach mit `useModulZaehler` und der Modulseite. Pro Einsatz bleibt es bei
einer Anfrage alle 5 min. Die Last beim DWD bleibt ebenfalls gleich, weil der Server
`/wetter` je Organisation und Ort 5 min cacht.

Zum Verhalten offline und bei DWD-Ausfall: Ein gescheiterter Abruf und fehlendes Netz liefern
keine Daten, also kein Merkmal. Ein Ausfall, ein Einsatz ohne Ort und ein Stand jenseits der
Obergrenze ergeben bei `teilStand` weder `aktuell` noch `veraltet`, also ebenfalls kein Merkmal.
Das folgt der bestehenden Regel „Lade- oder Fehlerzustand ist keine Warnung“. Eine Sperre ohne
sichtbaren Beleg würde das Dimmen verbieten, ohne dass jemand sieht, warum.

*Verworfen:* das Ticket ein weiteres Mal vertagen. Der Grund dafür, ein zusätzlicher
Dauerabruf, besteht nicht mehr.

### D2 Gesperrt wird über den Statusvertrag, nicht über `UNWETTER_STUFEN`

`aktiveWarnung` bekommt die Eingabe `dwdStufenJetzt?: readonly WetterWarnstufe[]`, also die
Stufen der Warnungen, die jetzt gelten. Die Regel lautet
`dwdStufenJetzt.some((s) => dwdWarnstufe[s].rolle === 'alarm')`. Eine Liste statt „höchste
Stufe“ hat einen Grund: So braucht es keine Rangfolge, und eine Rangfolge wäre eine zweite
Stufenliste neben dem Vertrag.

Die Stufen ermittelt die reine Funktion `dwdStufenJetzt(teil, jetzt)` in
`einsatz/aktiveWarnung.ts`. Sie gibt `undefined` zurück, wenn der Teil fehlt oder `teilStand`
weder `aktuell` noch `veraltet` ist. Sonst gibt sie die `stufe` aller Warnungen aus
`teileWarnungen(daten, jetzt).giltJetzt` zurück. Sie stützt sich auf dieselben Bausteine aus
`wetterStand.ts` wie `unwetterLage`, damit „gilt“ und „verwertbar“ nur einmal definiert sind.

*Verworfen:* `unwetterLage` aus `wetter/unwetter.ts` direkt zu verwenden. Das wäre ein Aufruf
weniger. Die Funktion filtert aber über `UNWETTER_STUFEN`, eine eigene Stufenliste, und das
Ticket schließt genau das aus.

*Absicherung gegen Auseinanderlaufen:* Heute stimmen `UNWETTER_STUFEN` und die
`alarm`-Stufen des Vertrags überein. Ein Test hält das fest (`aktiveWarnung.test.ts`). Ändert
jemand eines von beiden, wird der Test rot. Ohne ihn könnten Unwetterhinweis und Sperre
verschiedene Stufen meinen, ohne dass es jemand merkt. `UNWETTER_STUFEN` selbst auf den Vertrag
umzustellen, wäre eine Änderung an LFH-663 und bleibt außerhalb dieser Change.

### D3 Nur „gilt jetzt“ sperrt, die Uhr folgt Beginn und Ende

Eine angekündigte Warnung, etwa Orkanböen ab 17:00, sperrt um 14:00 noch nicht. Für diesen Fall
gibt es den Unwetterhinweis und die Überblick-Marke (LFH-663). Die Sperre schützt eine Warnung,
die jetzt ansteht.

Damit Beginn und Ende ohne neuen Abruf wirken, liest der Hook `jetzt` aus
`useUnwetterUhr(teil)`. Die Uhr weckt an Beginn, Ende und Obergrenze der Unwetterwarnungen. Das
sind dank des Tests aus D2 genau die Stufen, die sperren. Ein zweiter Wecker neben dem des
Modulzählers kostet einen `setTimeout`.

*Verworfen:* auch angekündigte Warnungen sperren zu lassen. Das würde das Dimmen Stunden vor
einer Gefahr verbieten, und die Sperre verlöre ihren Sinn als „jetzt nicht dimmen“.

### D4 Freigabe wie beim Gefahrenmodul

Abgefragt wird nur, wenn `istModulFreigegeben(<wetter-pegel>, freigaben)` gilt, also dieselbe
Frage wie bei der Navigation und beim Gefahrenmodul in diesem Hook. Ist das Modul ausgeblendet,
fällt ein noch vorhandener Cache heraus (`wetterFrei ? … : undefined`). Das Muster ist dasselbe
wie bei (a). Heute antwortet das gleich wie `darfZaehlerZeigen('wetter-pegel')` in
`useModulZaehler`, weil das Modul `status: 'fertig'` hat. `darfZaehlerZeigen` beantwortet aber
eine andere Frage: Darf ein Zähler erscheinen?

## Risks / Trade-offs

- [Bis zu 5 min Verzug nach einer neuen DWD-Warnung] → Das gilt genauso für Zähler und Hinweis.
  Ein Live-Ereignis wäre ein Server-Poller, und den hat LFH-663 (D2) verworfen.
- [`UNWETTER_STUFEN` und der Vertrag laufen auseinander] → Ein Test aus D2 macht das rot.
- [Eine veraltete Warnung, bis zur Obergrenze, sperrt noch] → Das ist gewollt und genauso wie
  beim Zähler. Jenseits der Obergrenze ist der Stand unbekannt und sperrt nicht.

## Migration Plan

Keine Migration, keine Daten, nur Frontend. Rückbau heißt, den Commit zurückzunehmen.
