# Design

## Context

Den Anlass nennt proposal.md unter „Why“. Die Anforderungen stehen in
`specs/betreuung-meldeverlauf/spec.md`. Der Bestand, auf dem diese Änderung aufsetzt:

- **Datenmodell** (`migrations/0117_betreuung.sql`): `evakuierung_stand` und
  `betreuungsstelle_belegung` tragen bereits alles, was der Verlauf braucht (`zeitpunkt_at`,
  `erfasst_at`, `erfasst_von_id`, `etb_eintrag_id`, `zurueckgenommen_at`,
  `zurueckgenommen_von_id`). Es gibt **keine Migration**.
- **„Aktuell“** ist genau einmal definiert, im Makro `juengste_meldung!` in
  `src/betreuung/repo.rs`. Gespeichert wird das Ergebnis als Zeiger `stand_id` bzw.
  `belegung_id` am Objekt (LFH-639 D1/D2).
- **Rücknahme-Routen** gibt es schon (`POST …/staende/{sid}/zuruecknehmen`,
  `POST …/belegungen/{mid}/zuruecknehmen`). Ihr Verhalten ändert sich nicht: 422 bei
  doppelter Rücknahme oder geschlossener Stelle, 409 am stornierten Objekt, eine
  ETB-Berichtigung mit „wieder N“ oder „bleibt N“.
- **Seite:** Der Block „Evakuierung“ ist `Datensicht form="karte"` im Plan-Modus, der Block
  „Betreuungsstellen“ ist `Datensicht form="tabelle"`. Die Plan-Karte hat keinen
  Aufklappbereich. `aufklappzeile` läuft nur im Tabellenzweig und nutzt dort das Symbol von
  antd. Einziger Konsument ist heute `FahrzeugePage` (Besatzung).

## Goals / Non-Goals

**Goals:**
- Die Meldereihen lesen, mit denselben Rechten wie die Übersicht.
- Ein beschrifteter, zugänglicher Aufklappbereich, der in Karte und Tabelle gleich arbeitet.
- Rücknahme jeder einzelnen Meldung über die bestehenden Routen.

**Non-Goals:**
- Kein Sprung „ETB ↗“ je Meldung. Er bräuchte eine Rechteprüfung auf das Modul ETB am
  Deeplink, das ist ein eigener Nachzug.
- Keine Paginierung. Meldungen entstehen von Hand im Minuten- bis Stundentakt, eine Reihe
  bleibt im Einsatz bei Dutzenden Einträgen.
- Keine Umstellung von `FahrzeugePage` auf den neuen Aufklappbereich (siehe D3, Nachzug).
- Kein „Wieder-Einsetzen“ einer zurückgenommenen Meldung. Eine Korrektur ist eine neue
  Meldung.
- Keine Änderung an Melde- oder Rücknahme-Semantik aus LFH-639.

## Decisions

### D1 — Zwei Lese-Endpunkte am Objekt, Antwort als Liste

```
GET /api/einsaetze/{id}/betreuung/bezirke/{bid}/staende    → StandVerlaufEintrag[]
GET /api/einsaetze/{id}/betreuung/stellen/{sid}/belegungen → BelegungVerlaufEintrag[]
```

Die Routen liegen neben den POST-Routen auf denselben Pfaden, das Gate ist
`EinsatzLesezugriff<Betreuung>`, die Sub-ID kommt über `PfadParam`. Ob das Objekt zum Einsatz
gehört, prüft das Repo zuerst und antwortet sonst mit 404. Eine leere Liste bedeutet dann
„Objekt vorhanden, keine Meldung“. Ohne diese Prüfung wäre ein fremder Bezirk nicht von einem
Bezirk ohne Meldung zu unterscheiden.

Felder je Eintrag, nach der Optionalitätsnorm aus LFH-265
(`skip_serializing_if = "Option::is_none"`):

| Feld | Stand | Belegung |
|---|---|---|
| `id`, `zeitpunkt_at`, `erfasst_at`, `erfasst_von` (Anzeigename) | ✓ | ✓ |
| `evakuiert`, `erhebung` | ✓ | — |
| `belegt` | — | ✓ |
| `aktuell: bool` | ✓ | ✓ |
| `zurueckgenommen_at?`, `zurueckgenommen_von?` | ✓ | ✓ |

- **`aktuell` kommt aus dem Zeiger** (`b.stand_id = st.id`), nicht aus einer zweiten
  Rechnung. So bleibt `juengste_meldung!` die einzige Definition, und Verlauf und Karte können
  nicht auseinanderlaufen.
- **Die Ordnung ist die von `juengste_meldung!`** (`zeitpunkt_at DESC, id DESC`), nur ohne
  Filter auf zurückgenommene. Der erste nicht zurückgenommene Eintrag ist damit immer der
  aktuelle. Ein Test pinnt das gegen `aktuell`.
- **`erfasst_von` ist der Anzeigename**, per Join auf `benutzer.anzeigename`, wie
  `erfasser_name` im ETB. Personenbezug entsteht dadurch nicht neu: derselbe Name steht am
  ETB-Eintrag der Meldung.
- **Verworfen:** die Reihe als Feld an `EvakuierungsbezirkAnzeige`. Die Übersicht lädt bei jedem
  Live-Ereignis alle Bezirke neu. Den Verlauf braucht nur, wer ihn
  aufklappt.
- **Verworfen:** ein Wrapper-Objekt `{ bezirk, meldungen }`. Die Seite hat den Bezirk schon aus
  der Übersicht, eine zweite Kopie wäre eine zweite Wahrheit für dieselben Bytes.

### D2 — „Nachgetragen“ ist Zeitarithmetik im Client, dieselbe wie im ETB

Der Verlauf kennzeichnet eine Meldung als nachgetragen, wenn `erfasst_at − zeitpunkt_at ≥ 60 s`.
Das ist `istNachgetragen` aus `etb/typFarben.ts`, das der ETB-Eintrag derselben Meldung
schon für sein ⧖ nutzt. Der ETB-Eintrag trägt `ereigniszeit = zeitpunkt_at`, die Schwelle
ist also dieselbe Aussage an zwei Stellen.

**Verworfen:** „nachgetragen“ im Sinn von LFH-639 D5, also „Zeitpunkt strikt vor dem
damals aktuellen“. Diese Eigenschaft wurde beim Schreiben entschieden und nicht gespeichert.
Nachträglich ließe sie sich nur rekonstruieren, wenn man die Rücknahmen in ihrer zeitlichen
Folge nachspielt. Eine neue Spalte hätte für Bestandszeilen keinen Wert. Die D5-Nachtragung
ist ohnehin eine Teilmenge: wer vor einer jüngeren Meldung einsortiert wird, ist Minuten
später erfasst und trägt das ⧖. Dass eine solche Meldung den Stand nicht bestimmt hat, zeigt
die Ordnung zusammen mit der Marke „aktuell“.

### D3 — `Datensicht` bekommt den Aufklappbereich `aufklappen`, für beide Zweige

```ts
aufklappen?: {
  etikett: string;                           // sichtbar, z. B. „Verlauf"
  zugaenglicherName: (zeile: T) => string;   // „Verlauf zu Bezirk Uferstraße"
  inhalt: (zeile: T) => ReactNode;           // wird erst beim Aufklappen gerendert
};
```

- **Ein Zustand für beide Zweige:** Die Sicht hält die aufgeklappten Zeilenschlüssel selbst.
  Ein Wechsel zwischen Karte und Tabelle (Breite, `form="auto"`) behält, was offen ist.
- **Kartenzweig (Plan-Modus):** Unter den Sekundärfeldern steht ein Textknopf mit Etikett,
  `aria-expanded`, `aria-controls` und dem zugänglichen Namen. Aufgeklappt folgt darunter
  eine Region (`role="region"`, `aria-labelledby` auf den Knopf) in der Karte. Er zählt
  **nicht** gegen „eine Primäraktion + `weitere`“. Aufklappen ändert nichts, es ist Lesen wie
  ein Sprung (LFH-616). Der Plan-Modus bleibt bei Titel + Status + höchstens drei
  Sekundärfeldern + einer Primäraktion.
- **Tabellenzweig:** `expandable.expandIcon` rendert denselben beschrifteten Knopf statt des
  16-px-Symbols von antd, mit kontrollierten `expandedRowKeys` aus demselben Zustand. Das
  Symbol hätte zwei Mängel. Sein Name aus der Locale ist in jeder Zeile gleich (Regel aus
  LFH-369: die Zeilenkennung gehört in den zugänglichen Namen). Seine Trefffläche liegt fest
  bei etwa 16 px, die Dichte-Staffel verlangt aber 30/48/72.
- **Beide Knöpfe sind antd-`Button`** und erben `controlHeight` (keine zwei Angaben nach
  LFH-365 nötig).
- **Ausschlüsse im DEV-Befund** (`pruefeKartenplan`): `aufklappen` schließt `baum` und
  `aufklappzeile` aus.
- **Verworfen:** den Verlauf über einen Menüeintrag in `weitere` öffnen. Ein aufklappbarer
  Zustand in einem Menü hat keinen `aria-expanded`-Träger, und Lesen stünde hinter einem
  Knopf, der „Aktionen zu …“ heißt.
- **Verworfen:** `aufklappzeile` selbst auf ein Objekt umstellen. Das träfe die
  Besatzungs-Aufklappzeile der Fahrzeugseite mitten in einem Betreuungs-Ticket. Die
  Umstellung und das Streichen von `aufklappzeile` stehen als Nachzug LFH-697 auf dem Board,
  damit es nicht dauerhaft zwei Aufklappwege gibt.

### D4 — Laden beim Aufklappen, Schlüssel unter dem Präfix `betreuung`

`einsatzKeys.betreuungVerlauf(einsatzId, art, id)` = `[EINSATZ_KEYS.betreuung, einsatzId,
'verlauf', art, id]` mit `art: 'bezirk' | 'stelle'` als getyptem Token (Sub-Key-Konvention).
Durch den Präfix invalidiert `LiveEvent::Betreuung` den Verlauf ohne neuen Eintrag in
`EINSATZ_STREAM_EVENTS`. Dasselbe gilt für die Invalidierung, die die Seite nach jeder eigenen
Mutation schon auf `einsatzKeys.betreuung(einsatzId)` setzt. Die Abfrage steht in der
Inhaltskomponente, und die wird erst beim Aufklappen gerendert, D3. Damit lädt nur, wer
aufklappt.

### D5 — Darstellung als Zeitachse aus dem Baustein `Zeitachseneintrag`

Eine Meldereihe ist ein zeitlich gelesener Strom. CLAUDE.md sieht für jede Zeile eines
solchen Stroms `components/instrument/Zeitachseneintrag` vor.

| Teil | Inhalt |
|---|---|
| Zeit | `zeitpunkt_at` über `ZeitAnzeige format="kurz"` (`formatZeitKurz`: taktisch „1430“ heute, sonst „161430“, in der Anzeigezone, liest den Draht als UTC, nie `dayjs(s)`) — dieselbe Schreibweise wie die Stand-Spalte daneben |
| Kante + Typwort | nicht zurückgenommen: `typ="meldung"`, Wort „Meldung“ · zurückgenommen: `typ="berichtigung"`, Wort „zurückgenommen“, Zeilentönung `berichtigung` |
| Meta | „aktueller Stand“ bzw. „aktuelle Belegung“ an genau der aktuellen Meldung |
| Text | „480 evakuiert (gezählt)“ bzw. „89 untergebracht“, Zahlen Mono |
| Hinweiszeile | „⧖ nachgetragen um 1105“ (Glyphe `aria-hidden`, erlaubt seit Neuentwurf) · „zurückgenommen 1112 von Name“, Zeiten wie die Zeit-Spalte |
| Verfasser | `erfasst_von` |
| Aktion | „Zurücknehmen“ (D6) |

Die Typfarben sind die des ETB, denn Meldung und Berichtigung sind genau die ETB-Typen der
zugehörigen Einträge. Eine neue Statusfarbkarte entsteht nicht (`ALLE_MAPS` bleibt bei 24).
Den zweiten Kanal tragen jeweils die Wörter.

Zustände des Bereichs: „Verlauf wird geladen“ (Skelett mit `aria-busy`), „Verlauf konnte
nicht geladen werden“ (`role="alert"`, „Erneut abrufen“) und „Noch keine Meldung.“ Der
Fehlerzustand hat Vorrang vor Altdaten. **Nicht über `PaneelZustand`** (Umsetzung,
24.09.2026): dessen Leerzustand verlangt eine eigene Aktion, und die steht im Verlauf schon
daneben („Stand melden“ an der Karte, „Belegung melden“ in der Zeile). Den Wortlaut des
Fehlerzweigs übernimmt der Verlauf aus dem Baustein.

### D6 — Rücknahme mit Rückfrage, Grund im Dialog

- **Rückfrage ja:** Eine Rücknahme hat keinen serverseitigen Rückweg. Nach LFH-363/LFH-343
  bekommt Unumkehrbares eine Rückfrage. Der Rückgängig-Toast nach dem Melden ist ein anderer
  Fall, dort ist die Rücknahme selbst der Rückweg.
- **Bauform:** ein `<Modal>` mit eigenem State außerhalb der Eintrags-`map` (LFH-365), der
  OK-Knopf `danger`. Text: „Meldung 300 evakuiert von 1030 zurücknehmen?“, darunter
  „Das ist der aktuelle Stand. Danach gilt die vorherige Meldung.“ oder „Der aktuelle Stand
  ändert sich dadurch nicht.“ Die Rückfrage nennt **keine** vorhergesagte neue Zahl. Die
  bestimmt der Server beim Schreiben, und eine Vorhersage aus dem Client wäre eine zweite
  Definition von „aktuell“.
- **Fehler bleibt im Dialog** (`SpeicherFehler`, Muster LFH-535): Das Modal bleibt offen, der
  Grund steht darin, kein Fehler-Toast. Beim Öffnen läuft `mutation.reset()`, damit ein alter
  Grund nicht in eine neue Rückfrage wandert. Ein Erfolg schließt das Modal und quittiert per
  Toast „Meldung zurückgenommen“.
- **Mutation:** Der Verlauf führt eine **eigene** Mutation über dieselben API-Funktionen
  `nimmStandZurueck`/`nimmBelegungZurueck` (Umsetzung, 24.09.2026, Abweichung vom ersten
  Plan). Die Mutationen der Seite melden ihren Fehler über `SeitenHinweise` über der Seite, weil
  der Rückgängig-Toast keinen Dialog hat. Liefe die Rücknahme aus dem Verlauf über sie, stünde
  derselbe Grund im Dialog UND über der Seite. `onSuccess` und `onError` invalidieren
  `betreuung` und `etb` wie dort; ein 422 heißt oft, dass die Reihe veraltet ist.
- **Geschlossene Stelle:** keine Auslöser, stattdessen **eine** Zeile über der Reihe:
  „Die Stelle ist geschlossen. Zurücknehmen geht erst, wenn sie wieder in Betrieb ist.“ Das
  sind die zwei Zuschnitte aus LFH-346: kein Auslöser pro Zeile, aber der Grund steht da.
- **Ohne Schreibrecht:** keine Auslöser und keine eigene Zeile. Den Grund nennt der
  `RechteHinweis` über der Seite schon.
- **Zugänglicher Name des Auslösers:** „Meldung 300 von 1030 zurücknehmen“. Das ist die
  Zeilenkennung im Namen (LFH-365/369), bei sichtbarem Wort „Zurücknehmen“.

### D7 — Rechte und Statuscodes

Die Lese-Endpunkte verhalten sich wie `uebersicht`: Beobachter lesen, ein ausgeblendetes Modul
gibt 403, eine fremde Organisation 403 oder 404 (Org-Floor des Extraktors). Eine nicht
numerische Sub-ID gibt 400 (`PfadParam`), ein fremdes oder unbekanntes Objekt 404. Ein
storniertes Objekt gibt **200**: 409 steht in diesem Modul nur für Lebenszyklus-*Aktionen*
(LFH-639 D3), und Lesen ist keine.

## Risks / Trade-offs

- [Eine neue Meldung schiebt im offenen Verlauf die Reihe nach unten, der Inhalt unter der
  Karte wandert mit] → Der Verlauf öffnet sich nur auf ausdrücklichen Klick, und er gilt genau
  dem einen Objekt, das sich gerade ändert. Die neue Meldung ist das, was die lesende Person
  sehen will. Ein Sammelbanner innerhalb eines Expanders mit einer Handvoll Einträgen wäre
  eine Alarmquelle ohne Gewinn. Außerhalb eines offenen Verlaufs verschiebt sich nichts, denn
  geänderte Zahlen an bestehenden Karten ändern kein Layout. In der Prüfliste wird
  Kriterium 12 mit genau dieser Begründung bewertet.
- [Zwei Aufklappwege in `Datensicht` (`aufklappzeile` und `aufklappen`), bis der Nachzug
  läuft] → Der Befund schließt die gleichzeitige Nutzung aus. Der Nachzug wird mit diesem
  Change auf dem Board angelegt.
- [Die Aufklapp-Spalte der Tabelle wird durch ein beschriftetes Etikett breiter] → Die
  Stellen-Tabelle nutzt kein `mindestBreite` (LFH-523). `scroll.x = 'max-content'` nimmt die
  Breite auf, der Überlauf bleibt im Scrollcontainer. Gemessen wird mit dem e2e-Test
  `gate1-ueberlauf`, dessen Betreuungsroute es schon gibt.
- [Ein Einsatz läuft über Mitternacht] → `formatZeitKurz` nimmt den Tag dazu, sobald er
  nicht heute ist („161430“). Das ist die Weiche, die die Stand-Spalte schon hat. Eine
  reine `HH:mm`-Angabe (`formatUhrzeit`) wäre hier falsch, weil ein Verlauf über Tage reicht.

## Migration Plan

Keine Migration und keine Datenänderung. Die Endpunkte kommen additiv dazu, Rollback ist ein
Revert. Die OpenAPI-Spec und die generierten Typen werden über
`scripts/check-typ-codegen.sh` mitcommittet.
