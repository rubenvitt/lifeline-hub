## Context

Motivation und Schnitt: `proposal.md`. Bestand aus LLH-1596
(`openspec/changes/archive/2026-11-08-om9oxxiq-kontextmenue-baustein/design.md`):

- **`components/useKontextMenue.ts`** liefert je Fläche eine Fabrik `ausloeser(schluessel)`. Jede
  Instanz legt beim Einhängen einen Nachklick-Riegel (`erzeugeNachklickRiegel`, Hörer am
  Dokument) und rund neun Fensterhörer an (Tasten-Nachlauf, Stift-Riegel, Abheben am `window`).
  D1 ging von einer Instanz je Liste aus.
- **`components/KontextMenue.tsx`** zeigt `MenueEintrag[]` über `menueEintraege()` in
  `PunktankerMenue` am Fensterpunkt. Die Rückfrage einer Primäraktion stellt
  `datensichtKontext.ts` per `modal.confirm` (Spec „Rückfrage im Dialog“).
- **Die Karten dieser Change zeichnen ihre Knöpfe selbst.** Meldung, Nachforderung, Auftrag und
  Zeitfenster bauen die Knopfzeile als `ReactNode[]` und das ⋮ aus einer zweiten Liste; unter drei
  Aktionen gibt es kein ⋮. Bestätigen (Meldung) und Abnehmen (Auftrag) tragen ein `Popconfirm`.
  Nachforderung zeigt gesperrte Übernahmen als `GesperrterKnopf` mit sichtbarem Grund. Ablösung
  und Verpflegungsstelle führen ihre Aktionen schon als Daten.
- **Chat:** eine `Liste` mit `ListenEintrag` je Nachricht; `ListenEintrag` reicht keine fremden
  Props an sein `<li>` durch. Anhänge sind `DownloadAnker` (`<a href download>`).
- **Betreuung:** `StellenBlock` und `BezirkTabelle` nutzen die `Datensicht` mit `form="tabelle"`,
  zeichnen „Belegung melden“/„Stand melden“ und ⋮ aber in einer eigenen Spalte. Ihr Kartenplan
  trägt weder `aktion` noch `weitere`, deshalb hat die Zeile heute kein Kontextmenü.
- Keine der Kartenlisten hält ihre Folge, solange ein ⋮ offen ist (kein `onOffenAenderung` an
  diesen Auslösern). Das Kontextmenü hält deshalb auch nicht mehr als das ⋮ (Spec „Ein offenes
  Kontextmenü hält die Liste“: „wie bei einem offenen ⋮-Menü“).

## Goals / Non-Goals

**Goals:**

- Jede Karte beschreibt ihre Handlungen genau einmal; Knopfzeile, ⋮ und Kontextmenü entstehen
  daraus.
- Viele Karten mit eigenem Kontextmenü kosten nicht je Karte einen Satz Fensterhörer.

**Non-Goals:**

- Keine neuen Aktionen, keine geänderten Etiketten, keine geänderte Bündelgrenze (drei).
- Keine Schleuse für Kartenlisten (sie halten auch für das ⋮ nicht).
- Keine Änderung an `Datensicht`, `KontextMenue` oder `PunktankerMenue` über das Nötige hinaus.

## Decisions

### D1 Geteilte Hörer im Baustein, Schnittstelle bleibt

Der Zustand, den die Fensterhörer lesen, ist ohnehin global: es gibt einen Zeiger, eine Tastatur
und ein nachgeschobenes `contextmenu`. `useKontextMenue.ts` legt deshalb Tasten-Zeitpunkt,
Stift-Riegel und Nachklick-Riegel auf Modulebene ab und hängt die Fensterhörer beim ersten
eingehängten Hook an, beim letzten ab (Zählung). Das Abheben am `window` ruft die `druckEnde` der
Instanzen, die gerade einen Druck halten (eine Menge, kein Durchlauf über alle). Die Rückgabe
`ausloeser(schluessel)` und alle Optionen bleiben gleich; `Datensicht` und Skizze ändern nichts.

Der Nachklick-Riegel wird scharf, wenn irgendein Hook per langem Druck öffnet, und schluckt die
Ereignisse des Abhebens unabhängig davon, welche Fläche sie trifft. Das ist das bisherige Verhalten
je Instanz, nur einmal statt n-mal.

*Alternativen (mit Ruben abgewogen):* ein Hook je Karte ohne Umbau (bei 200 Meldungen rund 1.800
Fensterhörer und 200 Riegel); eine Fläche je Liste mit Anmeldung der Karten (fünf Listenseiten
umzubauen, Karten müssten ihre Einträge nach oben melden). Die geteilten Hörer nützen auch
LLH-1597 (Meta-Chips, je Chip ein Datensatz).

### D2 Kartenbaustein `useKartenKontext`

Neu `components/useKartenKontext.tsx` für einen einzelnen Datensatz, der sich selbst zeichnet:

```ts
const { ausloeser, menue } = useKartenKontext({ aktionen, zugaenglicherName });
<KommKarte {...ausloeser} …>…{menue}</KommKarte>
```

Er hält `useKontextMenue` mit festem Schlüssel, den Zustand „offen am Anker“ und rendert
`KontextMenue`. Liefert `aktionen` nichts mehr, schließt das Menü im Render (wie `Datensicht`).
`kannOeffnen` ist „mindestens eine Aktion“; ohne Aktion bleibt das Browsermenü.

*Alternative:* `useKontextMenue` + `KontextMenue` in jeder Karte von Hand. Verworfen: sieben
Kopien desselben Zustands und derselben Rückfrage-Logik.

### D3 Kartenaktionen als Daten: `KartenAktion`

```ts
interface KartenAktion<K extends string> extends MenueEintrag<K> {
  onWahl: () => void;
  /** Rückfrage wie das Popconfirm des Knopfs; im Kontextmenü als Dialog. */
  rueckfrage?: { titel: string; knopf: string; gefahr?: true };
  /** Grund einer Sperre, im Menü an das Etikett gehängt (wie LFH-966). */
  sperrgrund?: string;
}
```

Jede Karte baut eine geordnete Liste `KartenAktion[]`: erst die Knöpfe der Aktionszeile in ihrer
Reihenfolge, dann die ⋮-Einträge. Ein Feld `ort: 'knopf' | 'menue'` sagt, wo der Eintrag auf der
Karte steht; die Bündelregel (ab drei ins ⋮) bleibt in der Karte und setzt nur `ort`. Die
Knopfzeile rendert die `knopf`-Einträge, Sonderformen (gefüllter Ghost-Knopf, `Popconfirm`,
`GesperrterKnopf`) wählt die Karte am Schlüssel, Etikett, Sperre und Wirkung kommen aus dem
Eintrag. Das ⋮ rendert die `menue`-Einträge. Das Kontextmenü nimmt alle.

`kartenKontextEintraege(aktionen)` macht daraus `MenueEintrag[]`: gesperrt mit Grund im Etikett
(„Als Material übernehmen (kein Zugriff)“), wie die Karte ihn zeigt. Die Wahl ruft `onWahl`, mit
`rueckfrage` vorher `modal.confirm` (Titel, Knopf, `danger` aus `gefahr`). Die Gefahr-Regel kommt
unverändert aus `menueEintraege()`: rote Einträge hinter einem Trenner, auch wenn sie auf der
Karte als Knopf vorn stehen.

Sprünge (`SprungKnopf` „Ausgabe öffnen“) und die Zuweisungsauswahl stehen nicht in der Liste; sie
bleiben eigene Elemente der Karte (Spec, „Eine Karte mit mehreren Knöpfen …“).

*Alternative:* eine zweite Liste nur fürs Kontextmenü neben der Knopfzeile. Verworfen: genau das
soll die Spec verhindern, und die Bedingungen (Rechte, Status, Sperren) liefen auseinander.

### D4 Chat: ein Hook je Strom, `ListenEintrag` nimmt Handler

`NachrichtenStrom` hält einen `useKontextMenue<number>` (Schlüssel: Nachrichten-ID) und ein
`KontextMenue`, wie die `Datensicht`. Die Einträge baut eine Funktion, aus der auch das ⋮ der
Nachricht gespeist wird (heute inline im `renderItem`), samt `waehle`. `ListenEintrag` bekommt
eine Prop `kontext?: KontextHandler<HTMLLIElement>` und spreizt sie an sein `<li>`.
„Löschen“ öffnet wie bisher den eigenen Dialog (`fragLoeschen`), sein Bestand bleibt.

Der Anhang ist ein Link: `browsermenueBleibt` greift schon (Spec, Chat-Anforderung).

### D5 Betreuung über den Kartenplan der `Datensicht`

`StellenBlock` und `BezirkTabelle` bauen ihren Kartenplan in der Komponente (`useMemo`) mit
`aktion` („Belegung melden“ bzw. „Stand melden“, `sichtbar` nach Schreibrecht, Status und
Belegungsart) und `weitere` (`stellenMenue`/`bezirkMenue`, `onWahl` → `onAktion`). Die Spalte
„Aktionen“ und der Knopf in der Kennung (unter `md`) nehmen Etikett, Sichtbarkeit und Wirkung aus
derselben `aktion`. Der Kurzgrund „namentlich“ einer Stelle bleibt Text in der Spalte und ist keine
Aktion.

### D6 Wo das Kontextmenü hängt

| Stelle | Element | Tastatur |
| --- | --- | --- |
| Meldung, Nachforderung, Auftrag | `KommKarte` (spreizt `rest`) | Fokus auf Knopf oder Link der Karte |
| Ablösung, Verpflegungsstelle, Zeitfenster | `<article>` der Karte | ebenso |
| Chat | `<li>` des `ListenEintrag` | Fokus auf Link oder Knopf der Nachricht |
| Betreuung | Tabellenzeile über `Datensicht` | Titel-Link (Bestand) |

`AuftragHandlungen` liefert seine `KartenAktion[]` über eine reine Funktion
`auftragAktionen(…)`, die `AuftragKarte` für das Kontextmenü und `AuftragHandlungen` für die
Knöpfe nutzt; `AuftragDetail` zeigt die Knöpfe weiter ohne Kontextmenü.

### D7 Zählschirm ausgenommen

`AusgabeAnsicht` bindet keinen Auslöser an. Ein Kommentar am ⋮ „Weitere Kostform“ nennt die Spec
„Ein Zählschirm hat kein Kontextmenü“, damit niemand es für ein Datensatzmenü hält. Der Wächter
`kontextMenue.guard.test.ts` braucht keine Ausnahme (kein `onContextMenu`).

## Risks / Trade-offs

- [Am Touchgerät lässt sich Text in Karten und Nachrichten mit Aktionen nicht mehr per langem
  Druck markieren (D3 aus LLH-1596). Im Chat trifft das das Kopieren eines Nachrichtentexts.] →
  Links bleiben ausgenommen, am Rechner geht Markieren und Rechtsklick wie bisher. Eine Nachricht
  ohne Aktion (Beobachter, gelöscht) behält das Markieren.
- [Modulweiter Zustand im Hook: Tests, die mehrere Flächen einhängen, teilen ihn.] → Zählung
  setzt beim letzten Aushängen alles zurück; ein Test hängt zwei Flächen ein und prüft, dass
  Tasten-Nachlauf und Riegel genau einmal wirken und nach dem Aushängen keine Hörer bleiben.
- [Umbau der Knopfzeilen in Daten kann ein Etikett, eine Sperre oder die Bündelgrenze
  verschieben.] → Bestehende Kartentests bleiben unverändert grün; je Karte ein Test, dass Knöpfe
  plus ⋮ und Kontextmenü dieselben Etiketten in derselben Reihenfolge zeigen.
- [Ein Rechtsklick neben den Knöpfen einer Karte ändert das Gewohnte (Browsermenü).] → wie in
  LLH-1596 bewusst; auf Text-Markierung und Links bleibt es.

## Migration Plan

Reines Frontend, keine Daten. Rücknahme durch Revert des PRs.
