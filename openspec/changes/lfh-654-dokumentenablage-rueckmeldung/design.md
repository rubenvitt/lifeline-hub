# Design

## Context

Motivation: `proposal.md` → Why. Anforderungen: `specs/dokumentenablage/spec.md`.

Stand im Code:

- `api/client.ts` `apiUpload` sendet per `fetch` mit `AbortSignal.timeout`. Jeder Abbruch, auch
  ein Zeitlimit **nach** vollständiger Übertragung, wird zu `NetzFehler` mit dem Text „Keine
  Verbindung — die Aktion wurde NICHT abgeschickt“. Für eine Ablage, deren Bytes schon beim
  Server liegen und deren Virenscan läuft, ist das falsch.
- `DokumentAblegenModal` übergibt nur `laeuft={mutation.isPending}` an die Erfassungs-Hülle →
  drehender Knopf.
- `DokumentePage` hält eine `entfernenMutation` ohne Zeilenbezug. Die Tabellenspalte rendert
  einen eigenen `Popconfirm`; der Kartenzweig nimmt die `PrimaerAktion` der `Datensicht`, die
  keinen Ladezustand kennt.
- Die Offline-Queue (`offline/queue.ts`, `offline/schreiben.ts`) merkt JSON-Schreibaktionen mit
  `client_id` vor; sie wird beim Abmelden bewusst **nicht** geleert (Beweissicherung,
  `offline/AGENTS.md`). Personenbezogene Daten auf dem Gerät sind als LFH-767 offen.

## Goals / Non-Goals

**Goals:**

- Echter Byte-Fortschritt und eine eigene Prüfphase für die Dokumentenablage.
- Eine Fehlermeldung, die nicht mehr behauptet, als der Client weiß.
- Zeilenweiser Entfernen-Zustand in Tabelle und Karte, ohne Sprung.
- Eine begründete Entscheidung zur Offline-Ablage.

**Non-Goals:**

- ETB- und Schaden-Anhänge, Organisationslogo, Kartenhintergründe: nutzen weiter `apiUpload`.
  Der neue Weg ist wiederverwendbar; die Umstellung ist ein eigener Nachzug.
- Idempotente Wiederholung einer Ablage (`client_id` am Dokument-Endpunkt): bräuchte Backend
  und Migration (E3). Die Meldung „Ergebnis unbekannt, Liste prüfen“ deckt den Fall ehrlich ab.
- Abbrechen einer laufenden Übertragung durch die Person (eigener Knopf). „Abbrechen“ des
  Dialogs bleibt wie heute: die Anfrage läuft serverseitig zu Ende.

## Decisions

### D1 Fortschritt über `XMLHttpRequest`, nicht über `fetch`

Neuer Weg `apiUploadMitFortschritt(pfad, formData, { timeoutMs, onFortschritt })` in
`api/client.ts`, neben `apiUpload`. Er nutzt `xhr.upload.onprogress` (Bytes) und
`xhr.upload.onload` (Übertragung fertig → Phase „prüfen“). Köpfe (`schreibKoepfe`),
`credentials` und das Fehlerformat bleiben gleich: eine Nicht-2xx-Antwort wird zu einer
`Response` gebaut und durch dasselbe `fehlerWerfen` gereicht wie bei `fetch`, damit
`ApiError.vomAnwendungsserver`, 401-Behandlung und Meldungstexte nicht auseinanderlaufen.

`onFortschritt` meldet `{ phase: 'senden', anteil: number | null }` bzw. `{ phase: 'pruefen' }`.
`anteil` ist `null`, wenn `lengthComputable` falsch ist (Spec: Balken ohne Zahl). Die Monotonie
hält der Aufrufer per `Math.max`, nicht der Transport.

**Verworfen:**

- *`fetch` mit `ReadableStream`-Body (`duplex: 'half'`):* liefert keinen Upload-Fortschritt im
  Sinn gesendeter Bytes, verlangt HTTP/2 und fehlt in Safari/iOS — gerade dem Führungs-Tablet.
- *Zeitbasierte Schätzung:* verstößt gegen „Wert aus übertragenen Bytes“; ein stehender
  Mobilfunk-Upload sähe nach Fortschritt aus.
- *`apiUpload` selbst umbauen:* fünf Aufrufer und ihre `fetch`-basierten Tests würden mitgezogen;
  das ist der Nachzug, nicht dieser Task.

### D2 Ausgang nach der Übertragung ist „unbekannt“, nicht „nicht abgeschickt“

Neue Fehlerklasse `AusgangUnbekannt extends NetzFehler` mit eigenem Text („Keine Antwort — ob das
Dokument abgelegt wurde, ist unklar. Bitte die Liste prüfen, bevor du es erneut ablegst.“).
`apiUploadMitFortschritt` wirft sie bei Zeitlimit oder Leitungsabbruch **nach**
`upload.onload`, vorher den bekannten `NetzFehler`. `fehlerText` prüft `AusgangUnbekannt`
zuerst. Als Unterklasse bleibt sie für `istOfflineTransient` und jeden `instanceof NetzFehler`
ein Netzfehler.

**Verworfen:** *Nach Zeitlimit die Liste selbst abfragen und raten:* ein noch laufender Scan
würde als „nicht angekommen“ gelesen, das Dokument erschiene danach doch.

### D3 Fortschrittsanzeige im Dialog

`DokumentAblegenModal` hält `fortschritt` als State, setzt ihn in `mutationFn` sofort auf
„senden ohne Zahl“ und danach über `onFortschritt`, und leert ihn bei Erfolg, Fehler und
Schließen. Ein Laufzähler verwirft späte Meldungen eines abgebrochenen Laufs („Abbrechen“ lässt
die Übertragung weiterlaufen). Angezeigt wird er unter dem
`SpeicherFehler`-Slot mit antds `Progress` (Linie, kein `size`, Farbe aus dem Theme), Etikett
„Wird hochgeladen · 42 %“ bzw. „Datei wird geprüft“ und `aria-live="polite"` an einem
Textknoten, der nur bei Phasenwechsel und in 10-%-Schritten neu spricht (kein Ansagestrom bei
jedem `progress`-Ereignis). Der Knopf „Ablegen“ bleibt `loading` wie bisher.

**Verworfen:** *Prozent im Knopftext („Ablegen 42 %“):* der Knopf ändert dann bei jedem Ereignis
seine Breite (Sprung) und ist kein Ort für eine Statusmeldung.

### D4 Entfernen-Zustand zeilenweise über eine Menge laufender IDs

`DokumentePage` führt `entferntGerade: ReadonlySet<number>`, gesetzt in `onMutate`, geräumt in
`onSettled` der `entfernenMutation` (Optionsebene, damit parallele Aufrufe je ID aufräumen).
Tabelle: der Entfernen-Knopf der Zeile trägt `loading`, der Titel bekommt den Zusatz
„wird entfernt“ als Text (`Typography.Text type="secondary"`), nicht nur Farbe oder Deckkraft.
Kartenzweig: `PrimaerAktion` der `Datensicht` bekommt das optionale Feld
`laeuft?: (zeile: T) => boolean` → `loading` am Auslöser; der Zusatz kommt über dasselbe
Spalten-`render` des Titels in beide Zweige. Ein laufender Auslöser öffnet keine Rückfrage.

**Verworfen:**

- *Optimistisches Ausblenden mit Rücksetzen:* die Zeilen darunter rücken unter dem Zeiger
  (Kriterium 12), und ein Fehler ließe die Zeile wieder auftauchen — schwerer zu lesen als eine
  stehende, gekennzeichnete Zeile.
- *Nur Deckkraft der Zeile:* Zustand allein über Darstellung, verletzt Kriterium 6.

### D5 Offline-Ablage: keine Vormerkung (Entscheidung)

Eine Ablage ohne Verbindung wird **nicht** vorgemerkt. Der Dialog bleibt mit Datei und Feldern
offen (heute schon über `mutateAsync` + `SpeicherFehler`), die Meldung sagt „nichts abgelegt“,
„Ablegen“ versucht es erneut.

Gründe:

1. **Speicherbudget:** bis 25 MiB je Datei als Blob in IndexedDB. Das Kontingent hängt am
   freien Gerätespeicher, und Safari/iOS räumt Skript-Speicher einer Website nach sieben Tagen
   ohne Interaktion (außer als installierte Web-App). Läuft das Kontingent voll, scheitert auch
   das offline lesbare Lagebild derselben Origin (LFH-723) — eine Queue mit Fotos konkurriert
   mit dem wichtigeren Lesestand.
2. **Daten auf dem Gerät:** Die Queue wird beim Abmelden nicht geleert. Lagepläne, Befehle und
   Fotos mit Betroffenen blieben auf einem geteilten Tablet liegen; LFH-767 ist dafür offen.
3. **Prüfung erst beim Server:** Der Virenscan läuft beim Ablegen. Eine vorgemerkte Datei, die
   später abgelehnt wird, braucht eine Wiedervorlage im `OfflineRecoveryDrawer` samt Datei —
   ein zweiter Ablage-Dialog.
4. **Idempotenz:** Ohne `client_id` am Endpunkt (Backend, Migration) erzeugt ein Flush nach
   Zeitlimit Dubletten.

**Verworfen:**

- *Volle Queue mit Blob und `client_id`:* deckt den Fall, kostet Backend, Migration,
  Recovery-UI und ein Speicherkonzept. Lohnt erst, wenn aus dem Feld ein Bedarf belegt ist.
- *Gedeckelte Queue (z. B. ≤ 5 MiB, ≤ 3 Dateien):* zwei Regeln statt einer; ein Foto mit 6 MiB
  verhielte sich anders als eines mit 4 MiB, ohne dass die Person den Grund sieht.

Diese Entscheidung steht als Anforderung „Keine Vormerkung ohne Verbindung“ in der Spec, damit
ein späterer Umbau sie bewusst ändert.

## Risks / Trade-offs

- [jsdom und msw melden kein echtes `upload.onprogress`] → Transporttest mit einer
  `XMLHttpRequest`-Attrappe (`vi.stubGlobal`), Komponententest über ein gemocktes
  `legeDokumentAb`, das `onFortschritt` aufruft. Der Browserbeleg kommt aus dem e2e mit
  gedrosselter Strecke (CDP `Network.emulateNetworkConditions`): wenig Upload-Bandbreite für den
  Prozentlauf, hohe Latenz für die Prüfphase. **Gemessen beim Umsetzen:** eine Route
  (`page.route`), die die Antwort festhält, taugt nicht — solange Playwright die Anfrage hält,
  meldet Chromium kein einziges Upload-Ereignis.
- [Bis zum ersten Byte-Ereignis kein Balken] → beim Umsetzen gefunden (dieselbe Messung): ohne
  Ereignis stünde nur der drehende Knopf. Der Dialog setzt deshalb beim Absenden sofort
  `{ phase: 'senden', anteil: null }` — Balken ohne Zahl, bis Bytes gemeldet werden.
- [Proxy puffert den Request-Body] → dann springt der Balken früh auf 100 % und die Prüfphase
  dauert länger. Die Anzeige bleibt wahr (Bytes beim nächsten Hop), nur gröber.
- [Zwei Upload-Wege im Client] → Dateikopf von `apiUploadMitFortschritt` nennt `apiUpload` als
  Vorgänger; Nachzugsticket für ETB-/Schaden-Anhänge.
- [Dubletten nach „Ergebnis unbekannt“] → Meldung bittet ausdrücklich um Prüfung der Liste;
  das live einlaufende `dokument`-Ereignis zeigt ein spät angekommenes Dokument von selbst.

## Migration Plan

Reines Frontend, kein Datenformat. Rückbau = Revert.
