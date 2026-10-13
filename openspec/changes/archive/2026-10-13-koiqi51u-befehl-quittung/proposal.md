# Proposal

## Why

Seit LLH-1172 trägt ein Einsatzbefehl einen Verteiler. Ob die Empfänger den Befehl bekommen
haben, hält aber nichts fest. Beim Einzelauftrag quittiert jeder Empfänger den Empfang, beim
Befehl gibt es das nicht. Die Befehlskarte zeigt außerdem keinen Verteiler, und der Reiter
„Einsatzbefehle“ hat keinen Empfängerfilter. So sehen die beiden Reiter des gemeinsamen Musters
aus LLH-1084 weiter verschieden aus. Ausgegliedert aus LLH-1084 und zurückgestellt bis zum Merge
von LLH-1172 (Ruben, 12.10.2026), Aufgabe LLH-1173. Die Entscheidungen vom 13.10.2026 stehen
an der Aufgabe.

## What Changes

- **Quittung je Verteiler-Empfänger** an einem freigegebenen Befehl: „Quittieren“ heißt
  „Empfang bestätigt“ (LFH-959). Zeitpunkt und quittierende Person stehen an der Verteiler-Zeile.
  Quittiert wird nur die jüngste freigegebene Fassung einer Befehlskette. Ist eine neuere Fassung
  freigegeben, lehnt der Server Quittieren und Zurücknehmen an der älteren ab. Deren Quittungen
  bleiben als Verlauf stehen. Eine fortgeschriebene Fassung beginnt ohne Quittung.
- **Die Quittung ist umkehrbar:** Ein eigener Endpunkt nimmt sie zurück. Damit gilt die Regel
  „Erst die Umkehrbarkeit, dann der Rückgängig-Knopf“ (LFH-343): Quittieren geht mit einem Klick,
  danach erscheint ein Hinweis mit „Rückgängig“, keine Rückfrage.
- **ETB:** Jede Quittung schreibt einen Systemeintrag „Empfang quittiert“ mit dem Empfänger als
  `von`. Jede Rücknahme schreibt einen Gegeneintrag „Quittung zurückgenommen“. Das ETB bleibt so
  fortlaufend.
- **Live:** Quittung und Rücknahme melden den Befehl als geändert, Liste und Detail in anderen
  Tabs ziehen nach.
- **Befehlskarte:** Sie zeigt den Verteiler, und ein freigegebener Befehl zeigt zusätzlich den
  Quittungsstand „n Empfänger · q/n quittiert“. Beides kommt aus denselben Kartenbausteinen wie beim
  Auftrag. Die Liste liefert dafür den Verteiler samt Quittung im Kopf jedes Befehls.
- **Detail eines Befehls:** Es zeigt den Verteiler wie den Empfängerblock eines Auftrags:
  quittierte Empfänger als Chip mit ✓ und offene Empfänger mit dem Knopf „Quittieren“.
- **Empfängerfilter auch im Reiter „Einsatzbefehle“**, mit derselben Komponente, denselben
  Optionen (Einsatzabschnitte, Einheiten) und derselben Wirkung wie bei den Aufträgen.
- Das Anwenderkapitel `auftraege-befehle.md` und das Bild des Befehlsdetails werden nachgezogen.

Nicht enthalten:

- Quittung am Lagebericht. Die Spalten liegen auch in `lagebericht_verteiler`, damit der
  gemeinsame Kern generisch bleibt, aber es gibt dort keinen Endpunkt und keine Anzeige.
- Quittieren durch Abschnittsgeräte. Befehle bleiben für Geräte unsichtbar. Dafür gibt es eine
  Folgeaufgabe auf dem Board.
- Eine Rücknahme außerhalb des Rückgängig-Hinweises, eine Rücknahme der Auftragsquittung und
  ein Quittungsblock im Ausdruck des Befehls.

## Capabilities

### New Capabilities

- `befehl-quittung`: Quittung je Verteiler-Empfänger am Einsatzbefehl. Wer, wann, an welcher
  Fassung, Rücknahme, ETB-Einträge, Live-Ereignis, Anzeige und Bedienung im Detail.

### Modified Capabilities

- `auftraege-befehle`: Der Empfängerfilter gilt in beiden Reitern, nicht mehr nur bei den
  Aufträgen. Die Befehlskarte zeigt Verteiler und Quittungsstand. Das Detail eines Befehls trägt
  den Verteiler mit Quittungsstand und die Handlung „Quittieren“.
- `dokument-verteiler`: Fortschreiben übernimmt den Verteiler ohne Quittung. Der Verteiler in der
  Liste der Befehle.

## Impact

- **Backend:** neue Migration `0187` mit `quittiert_at` und `quittiert_von_id` an
  `befehl_verteiler` und `lagebericht_verteiler`. Erweitert werden `src/vorlagendokument/verteiler.rs`
  (Lesen der Quittung, Quittieren, Zurücknehmen, Kopieren ohne Quittung) und
  `src/vorlagendokument/repo.rs` (Verteiler im Listenkopf, Fassungsprüfung). Neue Routen in
  `src/routes/befehl.rs` und `src/app.rs`. Erweitert werden auch `BefehlKopf`, `BefehlAnzeige`
  und `VerteilerEintragAnzeige`. Dazu kommen Schwärzungsregister, Ausnahmen für System-ETB
  (`tests/aufbewahrung_e2e.rs`) und Typ-Codegen.
- **Frontend:** `auftraege/BefehlListenKarte.tsx`, `auftraege/BefehlDetail.tsx` und
  `auftraege/BefehlListe.tsx`. Ein Empfängerfilter und ein Quittungsblock, die Auftrag und Befehl
  teilen und die aus `AuftraegeListe.tsx` und `AuftragTeile.tsx` herausgelöst werden. Dazu
  `api/befehle.ts` und die generierten Typen.
- **Doku:** Kapitel `docs/anwender/kapitel/auftraege-befehle.md`, Bild `befehl-detail.png` (hell
  und dunkel).
- **Keine Änderung** an der Auftragsquittung, am Wortlaut der Freigabe und an bestehenden
  ETB-Einträgen.
