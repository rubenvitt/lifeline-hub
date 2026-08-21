# Prüfliste Einsatztauglichkeit — Kommunikations-Module (LFH-343 · C8)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite. C8 fasst **fünf** Seiten an —
Meldungen, Aufträge/Befehle (beide Tabs), Erinnerungen, Nachforderungen, Chat — und dazu das
Backend, weil drei der fünf Statusschritte, die einklickbar werden sollten, keinen Rückweg
hatten.

**Umfang:** `pages/MeldungenPage.tsx`, `pages/ChatPage.tsx`, `pages/ErinnerungenPage.tsx`,
`pages/NachforderungenPage.tsx`, `pages/BefehlDetailPage.tsx` · `meldungen/MeldungKarte.tsx`,
`auftraege/AuftragKarte.tsx`, `auftraege/AuftraegeListe.tsx`, `auftraege/AuftragFormular.tsx`,
`erinnerung/ErinnerungKarte.tsx`, `erinnerung/ErinnerungFormular.tsx`,
`nachforderungen/NachforderungKarte.tsx`, `nachforderungen/NachforderungFormular.tsx`,
`chat/NachrichtenStrom.tsx`, `meldungen/AuftragErteilenModal.tsx`,
`chat/HeraufstufenAuftragModal.tsx`, `etb/AuftragAusEtbModal.tsx` · neu:
`kommunikation/rueckgaengig.tsx` · Backend: `src/routes/auftrag.rs`,
`src/routes/erinnerung.rs`, `src/nachforderung/mod.rs`, `src/auftrag/repo.rs`,
`src/erinnerung/repo.rs`, `src/kommunikation/repo.rs`.

**Gemessene Baseline am 21.08.2026** (beide Stände gefahren):

| Größe | vorher | nachher |
| --- | --- | --- |
| Klicks für Sichten / In Bearbeitung / Fortschalten / Erledigen / Quittieren | 2 (Knopf + Rückfrage) | **1** — plus 1 optional für „Rückgängig" |
| `grep -c '<Popconfirm'` MeldungKarte / AuftragKarte / ErinnerungKarte / NachforderungKarte | 1 / 3 / 2 / 1 | **1 / 2 / 0 / 0** |
| Serverseitige Rückwege für Triage-Schritte | 1 von 4 Modulen (nur Meldung) | **4 von 4** |
| Sichtbare Felder im Auftrags-Modal | 14 | **4** (Auftragstext, Empfänger, Priorität, Frist) |
| Felder für den Pflicht-Empfänger | 2 (Ziele-Select + Funktions-Freitext) | **1** (`mode="tags"`, Trennung am Präfix) |
| Chat: Scroll-Container für den Nachrichtenstrom | keiner (die Seite wuchs mit) | **einer**, e2e-belegt |
| Chat: Kanalauswahl unter `md` | Spalte 220 px neben dem Strom | **Segmented-Leiste** darüber, Spalte nicht im Baum |
| Erfassungsmasken auf der B4-Hülle (Auftrag/Erinnerung/Nachforderung) | 0 von 3 | **3 von 3** |
| Vitest-Fälle auf den fünf Modulverzeichnissen + `kommunikation/` (gezählt, beide Stände) | 103 in 19 Dateien | **124 in 23 Dateien** |
| e2e-Specs | 24 | **25** (`chat-layout.spec.ts`) |

---

| #  | Verdikt | Beleg / Zielticket |
| -- | ------- | ------------------ |
| 1 · Treffläche | **erfüllt** | Jedes verbliebene `size="small"` im Umfang sitzt auf `Card`/`Descriptions`/`Space`/`Liste` — nach CLAUDE.md ausdrücklich **kein** Verstoß (nicht-interaktiv; auf `Liste` ist `size` ein Abstandsmaß). Interaktive Elemente tragen keine Größen-Prop und erben `controlHeight` (30 / 48 / 72 px). C8 fügt Knöpfe hinzu (Rückgängig im Toast, Segmented-Leiste, Collapse-Auslöser) — alle ohne `size`. **Das ist der Ticket-Punkt M68, und er war bereits abgetragen**: die Umstellung kam mit LFH-362 (Dichte-Token) und LFH-364 (das „quittieren" steht seit dort in eigener Zeile als vollwertiger Knopf mit Empfänger im zugänglichen Namen, nicht mehr als 12-px-Link im Tag). C8 hat dafür keine Zeile Code gebraucht — belegt durch den Scan oben, nicht behauptet |
| 2 · Handschuh-Modus | **teilweise erfüllt** | Die Dichtestufe greift auf allen fünf Seiten (`ConfigProvider`). C8 verbessert die Lage an zwei Stellen konkret: das Auftrags-Modal trägt statt 14 nur noch 4 Felder, und jede Routine-Statusaktion kostet einen Klick statt zweier — beides senkt die Zahl der Ziele, die auf 72 px getroffen werden müssen. Offen bleibt wie überall die Ableitung der Stufe aus dem Einsatzkontext (`localStorage`-gebunden) → **LFH-373**; gerenderte Zeilenhöhen misst C8 nicht neu |
| 3 · Rückmeldung vor der Serverantwort | **erfüllt, verbessert** | Bestand unverändert (`isPending` an allen Mutationen, optimistischer Cache beim Quittieren eines Auftragsempfängers). **Neu:** die Erfassungshülle zeigt den Serienzähler („Erfasst: n") und hält den Knopf im Ladezustand; der Rückgängig-Toast erscheint erst **nach** der Serverantwort, also nie für etwas, das nicht angekommen ist. Optimistische Updates für die Statusschritte gibt es weiterhin nicht → **B6 (LFH-334)** |
| 4 · Kritische Aktion hat eine zweite Handlung | **erfüllt — und zwar durch Umkehrbarkeit statt durch Reibung** | Das ist der Kern von C8. Die Regel aus LFH-378 lautet „erst die Umkehrbarkeit, dann die Rückfrage" — C8 hat sie zum ersten Mal in die andere Richtung angewandt: statt Rückfragen zu entfernen und zu hoffen, wurden **erst die Rückwege gebaut** (`POST …/vollzug` mit `status: 'offen'`, `POST …/erinnerungen/{eid}/oeffnen`, `uebergang_erlaubt` um eine Stufe rückwärts), dann die Rückfragen. Wo kein Rückweg existiert, bleibt die Rückfrage — siehe die zwei benannten Abweichungen unten. Der Rückgängig-Toast ist **handlungsfähig** und deshalb keine Alarmquelle (Zeile 10) |
| 5 · Kontrast in beiden Modi | **erfüllt** | C8 führt **keinen** Farbwert ein. Der Neu-Akzent nimmt `token.colorWarning`, der Alarm weiterhin `token.colorError`; das Etikett läuft über antds `warning`-Preset. Kein Hexwert, kein `var(--lfh-*)` in TSX. `theme/gate5.guard.test.ts` grün |
| 6 · Kein Status allein über Farbe | **erfüllt** | Der Eingangszustand trägt **drei** Kanäle: den Akzent (Farbe), das Schriftgewicht 600 am Etikett (Form) und den Wortlaut „Neu" bzw. „Offen" (Text). Das ist eigens geprüft — `badges.test.tsx` misst Klasse **und** `fontWeight`, weil „neu" und „gesichtet" auf derselben `KommPhase` liegen und ohne die Marke an nichts zu unterscheiden wären. Der Gruppenkopf „Neu (n)" ist der vierte Kanal und der einzige, der auch ohne Blick auf die Karte trägt |
| 7 · Eine Farbe = eine Bedeutung | **erfüllt** | Der linke Kartenrand kann nur EINE Farbe tragen, und C8 belegt ihn zum zweiten Mal. Die Vorrangregel ist deshalb ausdrücklich entschieden und in beide Richtungen getestet: **Gefahr schlägt Eingangszustand** — eine unbestätigte überfällige Sofortmeldung ist rot, nicht gelb (`MeldungKarte.test.tsx`, „lässt den Alarm den Neu-Akzent schlagen"). Das **Etikett** bleibt davon unberührt: vergeben ist der Rand, nicht die Aussage |
| 8 · Helligkeits-/Kontrastregler | **offen, unverändert** | Weiterhin keiner in der Anwendung → **LFH-397**, app-weit |
| 9 · Kritische Anzeigen im Blickfeld | **erfüllt — die Chat-Lücke ist geschlossen** | Der Befund H51 war genau diese Zeile: das Eingabefeld wanderte nach jeder Nachricht aus dem Bild, weil die Seite mit dem Strom mitwuchs. Der Strom hat jetzt einen eigenen Scroll-Container, die Eingabe ist ein nicht scrollendes Geschwister darunter — e2e-belegt mit `toBeInViewport()` nach zwölf gesendeten Nachrichten auf 390 × 844. **`toBeVisible()` wäre auch im kaputten Zustand grün gewesen**, das ist der Unterschied zwischen der Zusicherung und ihrer Attrappe. Ebenfalls hier: die Befehls-Kopfzeile bricht um (M73), „Freigeben" bleibt erreichbar |
| 10 · Alarmbudget | **erfüllt, mit Begründung** | Der Rückgängig-Toast erhöht die Zahl der Meldungen — und senkt trotzdem die Zahl der Unterbrechungen. Die Abgrenzung, die das trägt und die auch nach CLAUDE.md wandert: ein **handlungsfähiger** Toast ist ein Bedienelement mit begrenzter Lebensdauer, keine Zustandsmeldung. Er erscheint ausschließlich nach einer Nutzeraktion, nie nach einem Live-Ereignis, und er ersetzt eine Rückfrage, die vorher **zwei** Interaktionen kostete. Das EEMUA-191-Budget (1–2 Alarme je 10 min) zielt auf ungefragte Zustandsmeldungen; die Rücknahme ist die Fortsetzung derselben Handlung. Ein fester Schlüssel sorgt dafür, dass eine zweite Aktion den stehenden Toast **ersetzt** statt zu stapeln — wer in Serie sichtet, erzeugt sie im Sekundentakt |
| 11 · Warnverhalten | **erfüllt** | Kein Blinken, kein Ton, keine neue Eskalationsstufe. Der Neu-Akzent ist statisch |
| 12 · Kein Sprung unter dem Cursor | **erfüllt** | Der Chat-Strom springt nur bei einer **neuen** Nachricht ans Ende, nicht beim Nachladen älterer: der Effekt hängt an der **id der jüngsten** Nachricht, nicht an der Länge. Beim Anbau vorne bleibt die id gleich, obwohl die Länge steigt — ein Effekt auf `length` risse den Lesenden aus dem, was er gerade liest. Die Meldungsliste bekommt mit dem Gruppenkopf eine zweite Gruppe; die Zuordnung folgt dem Status und wechselt nur, wenn jemand ihn ändert |
| 13 · Fokus nie verdeckt | **erfüllt für C8, ein AK-Punkt bewusst nicht umgesetzt** | C8 führt **kein** neues `position: sticky` ein. Der AK-Halbsatz „unterhalb des Tablet-Breakpoints die Aktionsleiste am unteren Rand verankern" ist **bewusst nicht** umgesetzt: der gemessene Befund M73 („Freigeben rutscht aus dem sichtbaren Bereich") war ein **waagerechtes** Problem — ein `<Space>` ohne `wrap` — und ist mit dem Umbruch behoben. Eine sticky Aktionsleiste auf einer Seite mit langem Markdown-Formular ist dagegen genau die Konstruktion, auf die WCAG 2.4.11 zielt: das unterste fokussierte Feld läge dahinter. Sie bräuchte einen Verdeckungsnachweis nach dem Muster von `e2e/fokus-verdeckung.spec.ts` und ist damit ein eigener Vorgang → **Nachzug, s. u.** `e2e/fokus-verdeckung.spec.ts` ist mit den C8-Änderungen grün (3/3) |
| 14 · Tabellenseite vollständig | **nicht anwendbar** | Keine der fünf Seiten ist eine Vergleichsfläche. Meldungen, Aufträge, Erinnerungen und Nachforderungen sind kartenbasiert (LFH-112), die Befehlsliste seit LFH-330/B2 `Datensicht form="karte"`, der Chat ist ein Strom. **Das ist der Ticket-Punkt M70, und er war bereits abgetragen** — `BefehlListe.tsx` trägt Titel, `StatusBadge`, Metazeile aus Schema/Zeitstand/Version und die Gruppen „Entwürfe"/„Freigegeben", die Kopfzeile folgt dem Muster von `AuftraegeListe` |
| 15 · Erfassungsmaske vollständig | **erfüllt** | Alle drei verbliebenen handgebauten Masken sind auf `ErfassungsFormular` gezogen: Auftrag, Erinnerung, Nachforderung (die Meldung war seit LFH-332/B4 dort). Damit gilt für sie der Erfassungsvertrag — Absende-Knopf im Formular, Fokus im ersten Feld, Rücksetzen auf jedem Weg hinaus, `mutateAsync` statt `mutate`, Serienmodus mit Wiederholfeldern. **Das Feldbudget ist eingehalten und nicht bloß behauptet:** das Auftrags-Modal zeigt im Ausgangszustand ≤ 4 Felder, und die zweite Hälfte der Zusicherung — Aufklappen bringt die sieben SKK-Felder namentlich — steht daneben. Ohne sie wäre die Zahl trivial erfüllt, weil ein `Collapse` ohne `forceRender` seinen Inhalt ohnehin nicht rendert |

**0 Zeilen ohne Verdikt.** Eine offene, eine teilweise erfüllte, eine nicht anwendbare:

| Zeile | offen woran | Ziel |
| --- | --- | --- |
| 2 | Dichtestufe aus dem Einsatzkontext, gerenderte Zeilenhöhen | **LFH-373** — Ticket existiert |
| 8 | kein Helligkeitsregler in der Anwendung | **LFH-397**, app-weit |
| 13 | verankerte Aktionsleiste am Befehlsentwurf + Verdeckungsnachweis | **LFH-465** |

---

## Zwei benannte Abweichungen vom Akzeptanzkriterium

Das AK verlangt, `grep -c Popconfirm` in den vier Kartendateien entspreche „nur noch der Zahl
der endgültigen Schritte (Abnahme/Freigabe)". Gemessen sind es **drei** Instanzen, und nur
eine davon ist eine Abnahme. Die anderen zwei bleiben — mit Grund, nicht aus Versehen:

1. **„Bestätigen" an der Meldungskarte** (Kenntnisnahme einer Sofortmeldung, LFH-97).
   `src/routes/meldung.rs:346 bestaetigen` ist **atomar einmalig** (`quittiere_einmalig`);
   eine zweite Bestätigung antwortet 422. Es gibt keine Ent-Bestätigung und es soll sie nicht
   geben: die Kenntnisnahme ist ein beweissichernder Vermerk mit Person und Zeitstempel.
2. **„quittieren" an der Auftragskarte** (Empfangsbestätigung eines Empfängers). `grep` über
   `src/` findet **keine** Ent-Quittierungs-Route — dieselbe Lage aus demselben Grund.

Nach der Regel, die C8 selbst anwendet, wäre ein Rückgängig-Knopf hier ein 422, und den
`Popconfirm` ersatzlos zu streichen machte eine unumkehrbare Handlung einklickbar. Die
Abweichung ist damit **die Anwendung des Kriteriums, nicht seine Verletzung** — das AK war
formuliert, bevor gemessen war, welche Schritte überhaupt einen Rückweg haben.

**Gezählt wird `<Popconfirm` (öffnendes Tag), nicht `Popconfirm`.** Der reine Wortlaut zählt
Prosa mit: die Kommentare, die den Umbau erklären, nennen das Wort. Beim ersten Zählen stand
`ErinnerungKarte` deshalb auf 2, obwohl keine Instanz mehr da war (dieselbe Falle wie in
`gate-kommentar-fuellt-eigenes-gate`). Die Kommentare sprechen jetzt von „Rückfrage-Dialog";
die Zählweise steht hier, damit die nächste Messung nicht wieder Prosa trifft.

---

## Drei Ticket-Punkte waren bereits abgetragen

Sie sind **gemessen** ausgebucht, nicht angenommen — C8 hat für sie keine Zeile Code geändert:

| Punkt | Träger | Messung am 21.08.2026 |
| --- | --- | --- |
| **M68** Trefferflächen | LFH-362 (Dichte-Token), LFH-364 (Quittungszeile) | Kein interaktives `size="small"` in den fünf Verzeichnissen; die verbliebenen sitzen auf `Card`/`Descriptions`/`Space`/`Liste` |
| **M70** BefehlListe als Karte | LFH-330 · B2 | `Datensicht form="karte"` mit Gruppen, `StatusBadge`, Metazeile; Kopfzeile im `<Flex … wrap>`-Muster |
| **M71** Ungelesen-/Neu-Marker | LFH-330 · B6 | `zaehlerQuelle` in `modulRegistry.ts` für chat/erinnerungen/auftraege/meldungen, `<Badge>` in `ModulPanel.tsx:181`, Punkt + Zeit + `sortiereKanaele` in `KanalListe.tsx` |

Die Warnung des Tickets, `BefehlDetailPage.tsx` nicht parallel zu C7 zu fahren, ist
**gegenstandslos**: C7/LFH-342 war der HEAD-Commit dieses Zweigs. C7 hatte allerdings genau
die Kopfzeile umgebaut, die M73 anfasst — der Autosave-Beleg („zuletzt gespeichert HH:MM" /
„ungespeicherte Änderungen") und der `freigabeBestaetigen`-Pfad sind erhalten und weiterhin
getestet.

---

## Nachzüge

| Nummer | Inhalt |
| --- | --- |
| **LFH-465** | Verankerte Aktionsleiste am Befehlsentwurf unterhalb des Tablet-Breakpoints, samt Verdeckungsnachweis nach dem Muster von `e2e/fokus-verdeckung.spec.ts` (Prüflisten-Zeile 13) |
| **LFH-466** | „n neue Nachrichten"-Pille im Chat, wenn der Lesende weiter oben steht: heute springt der Strom bei jeder neuen Nachricht ans Ende, unabhängig von der Scrollposition. Der Fall ist im Betrieb selten (wer liest, sendet meist gerade nicht) und braucht eine eigene Messung der Scrollposition |
