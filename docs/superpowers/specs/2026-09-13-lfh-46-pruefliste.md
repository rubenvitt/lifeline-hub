# Prüfliste Einsatztauglichkeit — Modul „Stab" (LFH-46 · ST4 LFH-542 · ST5 LFH-543)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder neuen oder umgebauten Seite; ein Modul-Task ohne ausgefüllte
Prüfliste gilt nicht als fertig. Anlass ist der Review an PR #62: `stab` steht in der Registry
auf `fertig`, eine Prüfliste gab es nicht.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Route | `/einsaetze/:id/stab` (`frontend/src/pages/StabPage.tsx`) |
| Stand | Commit `bdba173c` auf `feat/lfh-46-stab-frontend` (PR #62 gegen `alpha`) |
| Zielkontext | Fükw der Führungsstufe B/C (ELW-1-Klasse), 1366 × 768 px mit offenem Modul-Panel, Tastatur + Maus, Nachtmodus als Regelfall (Spec `2026-09-12-lfh-46-stab-s1-s6-design.md`, Entscheidung 1 und Abschnitt 3); Führungs-Tablet in Stufe `komfortabel` (Spec §10) |
| Nicht enthalten | Lücken-Kennzahlen (ST6 → LFH-544), Stabsvorschläge und ETB-Vorbelegung (ST7 → LFH-545), `e2e/stab.spec.ts` (ST9 → LFH-547) |

Die vier Flächen stammen aus Spec §12.1. **Nur zwei davon sind in `bdba173c` im Browser
gemessen** (Besetzungsliste, Kopfblock); die beiden Masken öffnet der Gate-3-Test nicht, ihre
Zahlen gelten dort nicht.

| Fläche | Stellvertreter | Browser-Messung Gate 3 (`bdba173c`) |
| --- | --- | --- |
| **1 · Besetzungsliste** (sechs feste Zeilen) | `pages/StabPage.tsx`, Sektion „Besetzung S1–S6" | ja: Werkzeug-Links, „Besetzung ändern" |
| **2 · Kopfblock Lagebesprechung** (Stand + Historie) | `stab/LagebesprechungStand.tsx`, `stab/LagebesprechungHistorie.tsx`, Kopfaktion in `StabPage.tsx` | ja: ETB-Links, Kopfaktion |
| **3 · Modal „Besetzung ändern"** | `stab/BesetzungModal.tsx` | nein |
| **4 · Modal „Lagebesprechung abschließen"** | `stab/LagebesprechungModal.tsx`, `stab/abschlussToast.tsx` | nein |

**Verdikte:** **erfüllt** (nur mit Beleg: Testdatei + Testname, oder Messung + Commit) ·
**offen → Zielticket** · **nicht anwendbar** (nur mit Begründung). „Nicht geprüft" ist keins.
Gerechnetes und aus Quelltext/Grep Geschlossenes trägt **[abgeleitet]**. Eine Annahme wie
„erbt vom `ConfigProvider`" ist kein Beleg (LFH-396).

---

## Die Nachweise

| Nachweis | Ergebnis | Stand |
| --- | --- | --- |
| Volles Gate `scripts/check-all.sh` | grün, e2e 168 passed | `c8c56666` (Ende ST4) |
| Volles Gate `scripts/check-all.sh` | grün, Vitest 344 Dateien / 4063, e2e 168 passed | `5e6d9c76` (Ende ST5, vor der Fix-Welle) |
| typecheck, lint, prettier, Vitest | grün, 344 Dateien / 4080 Tests (TZ=Europe/Berlin) | `e52bc6c7` (Merge `alpha`) |
| Gate 3, `e2e/gate3-trefflaeche.spec.ts`, Test „Stab: ETB-Links, Werkzeug-Links, „Besetzung ändern" und Kopfaktion folgen der Dichte-Staffel 30 / 48 / 72 px", 1366 × 768 | ETB-Links **35,5 / 48 / 72** px (3 Knoten) · Werkzeug-Links **35,5 / 48 / 72** (14) · „Besetzung ändern" **30 / 48 / 72** (6) · Kopfaktion **30 / 48 / 72** (1); gemessen wird die **Höhe**, nicht die Breite | `bdba173c` |
| Mutationsprobe Gate 3 | `stab/zeilenziel.ts` `minHeight: token.controlHeight` → `minHeight: 30`: `komfortabel` rot (45 px < 48), `handschuh` rot (55 px < 72); zurückgedreht | `bdba173c`, Kopfkommentar des Tests |
| Grep über `frontend/src/stab/`, `pages/StabPage.tsx` (ohne Tests) | `size=` nur `Descriptions size="small"` (`LagebesprechungStand.tsx:50`, nicht interaktiv, außerhalb von `dichte.guard.test.ts`) · Farbliterale (`#…`, `rgb(`, `color=`) **0** · `danger` **0** · `animation`/`blink`/`keyframes`/`transition` im Code **0** · Toast-Aufrufe genau **einer** (`abschlussToast.tsx:30`) | `bdba173c` [abgeleitet] |
| Grep `sticky`/`position: fixed` über `stab/`, `StabPage.tsx`, `components/EinsatzSeite.tsx`, `components/Erfassung.tsx`, `components/Liste.tsx`, `components/AppLayout.tsx`, `einsatz/*.tsx` | **0**; einziger Treffer app-weit `.etb-erfassung-sticky` in `index.css` (nur ETB) | `bdba173c` [abgeleitet] |

Die Zahl 14 der Werkzeug-Links ist **[abgeleitet]** aus `stab/sachgebiete.ts`: 3 + 3 + 3 + 3 +
0 + 2 Registry-Schlüssel, alle `fertig`; der Test prüft sie exakt, nicht als Untergrenze.

---

## Tabelle 1 — Besetzungsliste (`pages/StabPage.tsx`, Sektion „Besetzung S1–S6")

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt** | Gate 3 `bdba173c`: Werkzeug-Links 35,5 / 48 / 72 px (14 Knoten), „Besetzung ändern" 30 / 48 / 72 px (6) — in jeder Stufe über dem 24-px-Boden. Mutationsprobe belegt, dass der Test die Staffel misst, nicht sich selbst. Die **Breite** ist nicht gemessen; ≥ 24 px ist **[abgeleitet]** aus der Polsterung (2 × 11 px in `kompakt`, `stab/zeilenziel.test.ts` „trägt die ZWEITE Angabe (Polsterung) dichteabhängig mit") plus Beschriftung. Keine zeitkritische Aktion auf der Fläche, der 48-px-Teil greift nicht | — |
| 2 | Handschuh-Modus | **offen** | Höhe in `handschuh` gemessen: 72 px an allen 20 Zielen (Gate 3). **Nicht gemessen ist der Abstand ≥ 16 px.** Die Werkzeug-Links stehen in einem `Flex wrap` **ohne `gap`** (`StabPage.tsx:236`), benachbarte Ziele stoßen also voraussichtlich bündig aneinander — ein wahrscheinlicher Befund, kein Messwert | LFH-547 |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt** | `StabPage.test.tsx` „behauptet während des Ladens keine Besetzung und keinen Termin, sperrt die Kopfaktion" (Ladezustand der `Liste`, kein Tag vor den Daten); „Fehler ist nicht leer: ein gescheiterter Abruf behauptet keine sechs leeren Zeilen". Die Maske meldet ihr Speichern selbst (Tabelle 3, Nr. 3) | — |
| 4 | Kritische Aktion hat eine zweite Handlung | **nicht anwendbar** | Die Fläche trägt keine kritische Aktion: die einzige Aktion „Besetzung ändern" **öffnet** eine Maske, und eine Besetzung ist umkehrbar (erneut setzen, Spec §10; LFH-378 „erst die Umkehrbarkeit") | — |
| 5 | Kontrast in beiden Modi | **offen** | Entlastend, aber ungemessen: keine Farbliterale (Grep `bdba173c`: 0), alle Besetzungszustände über `StatusTag` mit `neutral` (Rand trägt die Rolle, `token.colorText` die Beschriftung, LFH-446). Für die Stab-Route gibt es keinen Kontrast-Spec (`e2e/` kennt nur `betroffene-kontrast.spec.ts`, `kraefte-kontrast.spec.ts`); der Nachtkontrast der StatusTags ist übergeben | LFH-547 |
| 6 | Kein Status allein über Farbe | **erfüllt** | Jeder Besetzungszustand ist ein Wort und durchweg `neutral`: `stab/besetzung.test.ts` „nennt jeden Zustand beim Wort und bleibt neutral", „hängt „nicht mehr disponiert" nur an eine Person, deren Disposition weg ist"; `StabPage.test.tsx` „nennt die Besetzung beim Wort", „zeigt sechs feste Zeilen auch ohne jede Besetzung" | — |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Nur `neutral` an der Besetzung (Entscheidung 3: „nicht vergeben" ist keine Alarmfarbe — Test oben); Links in der Bedienrolle; Grep `bdba173c`: `danger` 0, Farbliterale 0. `theme/statusVertrag.guard.test.ts` scannt `/src` ganz — kein eigener `Record<…, StatusDarstellung>`, `lagebesprechungZustand` ist bewusst eine Funktion | — |
| 8 | Helligkeits-/Kontrastregler | **offen** | Spec §12.1 führt 8 hier als „Rahmen-Thema". Ein „nicht anwendbar" verdeckte aber eine app-weit offene Lücke: es gibt nirgends einen Regler. Wie in allen Prüflisten seit LFH-336 dem app-weiten Ticket zugeordnet | LFH-397 |
| 9 | Kritische Anzeigen im Blickfeld | **nicht anwendbar** | Die Fläche trägt keine kritische Anzeige: alle Zustände sind `neutral` (Nr. 6). Der einzige `achtung`-Zustand der Seite („überfällig") steht im Kopfblock (Tabelle 2, Nr. 9) | — |
| 10 | Alarmbudget | **nicht anwendbar** | Die Fläche erzeugt keine Meldung: kein Toast und kein Ton im Besetzungspfad (Grep `bdba173c`: der einzige Toast-Aufruf des Moduls ist `abschlussToast.tsx:30`, Fläche 4); Live-Ereignisse ändern nur den Wortlaut der Tags | — |
| 11 | Warnverhalten | **erfüllt** | Kein Blinken und keine Bewegung auf Text: Grep `bdba173c` (`animation`/`blink`/`keyframes`/`transition` 0), `Skeleton` ohne `active`. Kein Ton | — |
| 12 | Kein Sprung unter dem Cursor | **offen** | Die sechs Zeilen sind fest (`StabPage.test.tsx` „zeigt sechs feste Zeilen auch ohne jede Besetzung"). Die Liste steht aber **unter** dem Kopfblock, und dort wächst die Historie bis zum dritten Eintrag bei jedem Live-Abschluss um eine Zeile — neue Einträge **oben** und ohne Sammelbanner (Spec §10 ging von „wächst unten" aus). Die Begrenzung auf drei Einträge ist belegt (`LagebesprechungHistorie.test.tsx` „zeigt die drei jüngsten; die älteren liegen eingeklappt im Expander mit Anzahl" / „drei Einträge → kein Expander (Gegenfall)"), die Verschiebung der Besetzung darunter ist nicht gemessen. Nach ST6 kommen je Zeile Kennzahlen dazu | LFH-547 |
| 13 | Fokus nie verdeckt | **erfüllt [abgeleitet]** | Keine fixierte Konstruktion über der Fläche: Grep `sticky`/`fixed` `bdba173c` über Seite, `EinsatzSeite`, `Liste`, `AppLayout`, `einsatz/*.tsx` = 0. Kein Tab-Durchlauf gemessen; der einzige fixierte Überlagerer des Moduls ist der Abschluss-Toast (Tabelle 4, Nr. 13) | — |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | Keine Tabelle: `components/Liste.tsx` mit sechs festen Zeilen, hier wird nichts verglichen, sortiert oder gefiltert (Spec Entscheidung 16, LFH-330/B2) | — |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | Keine Erfassung auf der Fläche; die Maske ist Fläche 3 (Spec §12.1) | — |

**Verdikt-Bilanz:** 6 erfüllt · 4 offen · 5 nicht anwendbar.

---

## Tabelle 2 — Kopfblock Lagebesprechung (Stand + Historie + Kopfaktion)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **offen** | Gemessen (Gate 3 `bdba173c`): ETB-Links 35,5 / 48 / 72 px (3 Knoten — Stand „Letzte" + zwei Historien-Einträge) und Kopfaktion „Lagebesprechung abschließen" 30 / 48 / 72 px, freigegeben gemessen. **Nicht gemessen:** der Kopf des Expanders „Frühere Lagebesprechungen (N)" und die ETB-Links darin — beides erscheint erst ab vier Besprechungen, gesät waren zwei. Deckt sich mit der übergebenen Messung „Seitenhöhe mit > 3 Besprechungen" | LFH-547 |
| 2 | Handschuh-Modus | **offen** | 72 px in `handschuh` an ETB-Links und Kopfaktion gemessen; Abstand ≥ 16 px zwischen den Zielen nicht gemessen, Expander-Kopf nicht gemessen (Nr. 1) | LFH-547 |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt** | Skeleton statt Termin vor den Daten: `StabPage.test.tsx` „behauptet während des Ladens keine Besetzung und keinen Termin, sperrt die Kopfaktion"; `LagebesprechungHistorie.test.tsx` „behauptet während des Ladens weder leer noch Fehler"; Fehler ≠ leer: `StabPage.test.tsx` „Fehler ist nicht leer: ohne Stand kein „kein Termin"", `LagebesprechungHistorie.test.tsx` „leer geladen, dann scheitert das Neuladen → Fehler, kein Leer-Text" / „befüllt geladen, dann scheitert das Neuladen → Stand veraltet, Zeilen bleiben (Gegenfall)" | — |
| 4 | Kritische Aktion hat eine zweite Handlung | **nicht anwendbar** | Die Kopfaktion **öffnet** die Maske und schreibt nichts (`StabPage.test.tsx` „ist mit Schreibrecht die eine Primäraktion und öffnet die Maske"); die kritische Handlung „Abschließen" liegt in Fläche 4 und ist dort geprüft (Tabelle 4, Nr. 4). Stand und Historie tragen nur Links | — |
| 5 | Kontrast in beiden Modi | **offen** | Entlastend, aber ungemessen: `StatusTag` für „in … min" (`neutral`) und „seit … überfällig"/„jetzt fällig" (`achtung`), keine Farbliterale (Grep 0). Nachtkontrast der StatusTags auf dieser Route ist übergeben | LFH-547 |
| 6 | Kein Status allein über Farbe | **erfüllt** | Das Wort ist der zweite Kanal: `stab/lagebesprechungZustand.test.ts` „ohne Termin: „kein Termin", neutral", „vergangen: „seit 5 min überfällig", achtung", „genau am Termin „jetzt fällig" (achtung) — eine Sekunde davor „in < 1 min" (neutral)", „ein unlesbarer Termin behauptet NICHT „kein Termin""; `LagebesprechungStand.test.tsx` „zukünftig: „in 23 min", neutral" / „vergangen: …, achtung" / „ohne Termin: …" | — |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Genau zwei Rollen: `neutral` für einen kommenden oder fehlenden Termin, `achtung` für überfällig (Tests Nr. 6) — kein Alarmrot für eine versäumte Besprechung; `danger` 0, Farbliterale 0 (Grep `bdba173c`) | — |
| 8 | Helligkeits-/Kontrastregler | **offen** | Kein Regler in der Anwendung; hier trägt die Fläche mit „überfällig" eine aktive Warnung, die Sperre gegen Herunterdimmen fehlt damit ebenso | LFH-397 |
| 9 | Kritische Anzeigen im Blickfeld | **offen** | Aus dem Quelltext **[abgeleitet]**: die Sektion „Lagebesprechung" steht vor der Besetzung, „Nächste" ist ihre erste Zeile (`StabPage.tsx:157-176`, `LagebesprechungStand.tsx:51-56`). Dass „überfällig" bei 1366 × 768 mit offenem Panel im ersten Bild und innerhalb der Blickachse liegt, ist nicht gemessen (gehört zur übergebenen Breitenmessung) | LFH-547 |
| 10 | Alarmbudget | **erfüllt** | Bezogen auf den 30-s-Zustandswechsel (Spec §12.1): der Countdown erzeugt keine Meldung — `LagebesprechungStand.test.tsx` „aktualisiert im 30-s-Takt — nicht früher, ohne Remount und ohne Toast" zählt `.ant-message` = 0 | — |
| 11 | Warnverhalten | **erfüllt** | Bezogen auf den 30-s-Zustandswechsel: kein Blinken — derselbe Test prüft, dass der `Descriptions`-Knoten derselbe bleibt und nur der Wortlaut wechselt; kein Ton. „Überfällig" ist ein Zustand, der sich durch die Handlung (Abschluss mit neuem Termin) auflöst, keine quittierpflichtige Meldung | — |
| 12 | Kein Sprung unter dem Cursor | **offen** | Die Höhe ist begrenzt (drei sichtbare Einträge, Rest im eingeklappten Expander — Testpaar in Tabelle 1, Nr. 12), aber ein Live-Abschluss setzt bis zum dritten Eintrag eine neue Zeile **oben** in die Historie, ohne Sammelbanner; ab dem vierten ändert sich nur die Zahl im Expander-Titel. Die Seitenhöhe mit > 3 Besprechungen ist übergeben, die Verschiebung bei ≤ 3 gehört in dieselbe Messung. Geringe Häufigkeit (eine Besprechung je 30–120 min, [abgeleitet] aus der Schnellwahl) mildert, ersetzt aber keine Messung | LFH-547 |
| 13 | Fokus nie verdeckt | **erfüllt [abgeleitet]** | Keine fixierte Konstruktion auf der Seite (Grep `sticky`/`fixed` `bdba173c` = 0); die Kopfaktion liegt im Fluss des Seitenkopfs. Der Toast nach dem Abschluss ist in Tabelle 4, Nr. 13 behandelt | — |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | `Descriptions` mit drei Zeilen plus Historie als `Liste` — gelesen, nicht verglichen (Spec Entscheidung 16, LFH-330/B2) | — |
| 15 | Erfassungsmaske vollständig | **nicht anwendbar** | Keine Erfassung auf der Fläche; die Maske ist Fläche 4 (Spec §12.1) | — |

**Verdikt-Bilanz:** 6 erfüllt · 6 offen · 3 nicht anwendbar.

---

## Tabelle 3 — Modal „Besetzung ändern" (`stab/BesetzungModal.tsx`)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **erfüllt [abgeleitet]** | Die Maske ist im Browser **nicht** gemessen. Abgeleitet aus zwei Messungen: kein interaktives Element trägt eine `size`-Angabe (Grep `bdba173c`, einzige Fundstelle im Modul ist die nicht-interaktive `Descriptions`), und die Stufe trägt sich route-unabhängig bis in eine antd-Steuerfläche (`e2e/dichte.spec.ts` „gespeicherte Stufe handschuh trägt sich bis in die Trefffläche" / „ohne Seed bleibt es kompakt"); ein plain `Button` desselben Baums misst auf dieser Route 30 / 48 / 72 (Gate 3, „Besetzung ändern"). Boden 24 px damit in jeder Stufe gehalten; keine zeitkritische Aktion in der Maske | — |
| 2 | Handschuh-Modus | **offen** | Keine Messung in der Maske: weder Höhe von `Select`/`Input`/Knöpfen noch Abstand ≥ 16 px zwischen „Abbrechen" und „Übernehmen" | LFH-547 |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt [abgeleitet]** | `laeuft={mutation.isPending}` (`BesetzungModal.tsx`) → `loading` am Primärknopf der Hülle (`components/Erfassung.tsx:407`); Doppel-Absenden gesperrt (`components/Erfassung.test.tsx` „sendet bei gehaltener Taste nicht doppelt"). Der sichtbare Ladezustand ist in `BesetzungModal.test.tsx` nicht eigens geprüft | — |
| 4 | Kritische Aktion hat eine zweite Handlung | **nicht anwendbar** | Setzen **und** Entfernen („nicht vergeben") sind umkehrbar — erneut setzen (Spec §10: „Umkehrbar → keine Rückfrage"; LFH-378 „erst die Umkehrbarkeit"), der Verlauf steht als System-ETB-Eintrag mit Vorher/Nachher (Spec Entscheidung 7). Der Weg ist ohnehin zweistufig: Wahl im `Select`, dann „Übernehmen" (`BesetzungModal.test.tsx` „belegte Zeile, „nicht vergeben" → genau ein DELETE") | — |
| 5 | Kontrast in beiden Modi | **offen** | Keine eigenen Farben (Grep 0); ungemessen sind im Nachtmodus u. a. der Platzhalter „disponierte Person", das Fehler-`Alert` und die Optionsliste im Portal | LFH-547 |
| 6 | Kein Status allein über Farbe | **erfüllt** | Die Wahl ist ein Wort je Option (`BESETZUNG_OPTIONEN`), der Fehler ein Satz im Dialog: `BesetzungModal.test.tsx` „abgelehnter PUT: Grund steht im Dialog, Felder bleiben; erneutes Übernehmen räumt ihn"; Pflichtmeldung als Text: „abgebrochene Ad-hoc-Anlage: Person leer, Übernehmen meldet die Pflicht, kein Request" | — |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Rot nur für den Fehler (`SpeicherFehler`), kein `danger`-Knopf (Grep `bdba173c` 0) — „nicht vergeben" ist eine Option, kein roter Knopf | — |
| 8 | Helligkeits-/Kontrastregler | **offen** | app-weite Lücke, kein Regler | LFH-397 |
| 9 | Kritische Anzeigen im Blickfeld | **erfüllt** | Ein abgelehnter PUT (409) steht **im** Dialog, nicht nur im Toast, und die Maske bleibt offen: `BesetzungModal.test.tsx` „abgelehnter PUT: Grund steht im Dialog, Felder bleiben; erneutes Übernehmen räumt ihn" | — |
| 10 | Alarmbudget | **nicht anwendbar** | Die Maske erzeugt keine Meldung: kein Erfolgs- und kein Fehler-Toast (Grep `bdba173c`: kein Toast-Aufruf in `BesetzungModal.tsx`); der Fehler steht im Dialog (Nr. 9) | — |
| 11 | Warnverhalten | **erfüllt** | Kein Blinken (Grep 0), kein Ton; der Fehler steht still und geht beim nächsten Absenden — Test Nr. 9, zweite Hälfte | — |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** | Ein fremder Live-Stand ändert die offene Maske nicht, die Basis ist beim Öffnen eingefroren (LFH-303): `BesetzungModal.test.tsx` „fremd gesetzt, hier ohne Änderung übernommen → 0 PUT, 0 DELETE, Maske schliesst" / „Gegenfall: fremd gesetzt, hier eine Person gewählt → genau ein PUT". Die Optionsliste der Personenwahl folgt dem Live-Key `einsatz-personal` — Bestandsverhalten jedes `Select`, keine Datensatzliste der Seite | — |
| 13 | Fokus nie verdeckt | **erfüllt [abgeleitet]** | Keine fixierte Konstruktion in Hülle oder Maske (Grep `sticky`/`fixed` in `Erfassung.tsx` und `BesetzungModal.tsx` = 0); die gestapelte Ad-hoc-Maske liegt oben und trägt den Fokus selbst. Kein Tab-Durchlauf gemessen | — |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | Maske, keine Menge | — |
| 15 | Erfassungsmaske vollständig | **offen** | **Trägt:** Hülle `ErfassungsModal`, Struktur statt „Enter sendet" (erstes Feld ist ein `Select`, `BaseSelect` ruft `preventDefault`) — `BesetzungModal.test.tsx` „trägt die Erfassungs-Norm: keine Modal-Fusszeile, Knopf im <form>"; vorbelegt mit dem aktuellen Zustand und einzeln überschreibbar (`stab/besetzung.test.ts` „belegt die Maske mit dem aktuellen Zustand vor", Wertgleichheits-Riegel „leere Zeile, „nicht vergeben" bestätigt → keine Aktion" und `BesetzungModal.test.tsx` „leere Zeile, „nicht vergeben" bestätigt → 0 Requests, kein Fehler, Maske schliesst"); Fokus ins erste Feld und Zurücksetzen auf allen Wegen aus der Hülle (`Erfassung.test.tsx` „setzt den Fokus beim Öffnen auf das erste Feld", „leert die Felder auch über Escape und das Schliesskreuz, nicht nur über den Knopf"); Labels über dem Feld (`Erfassung.tsx:345` `layout="vertical"`); die Sammelliste mit Ändern je Zeile ist die Besetzungsliste (`StabPage.test.tsx` „„Besetzung ändern" öffnet die Maske der Zeile"). **Bewusst nicht:** „Speichern und nächsten" — Einzelvorgang, sechs feste Zeilen (Spec §12.1). **Offen:** ein Tastatur-Durchlauf dieser Maske (Art wählen → Person/Bezeichnung → Übernehmen, samt Ad-hoc-Weg) ist nirgends geprüft | LFH-547 |

**Verdikt-Bilanz:** 8 erfüllt · 4 offen · 3 nicht anwendbar.

---

## Tabelle 4 — Modal „Lagebesprechung abschließen" (`stab/LagebesprechungModal.tsx` + Erfolgs-Toast)

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | Treffläche | **offen** | Die Maske ist im Browser nicht gemessen. Für `Input.TextArea`, `DatePicker`, Schnellwahl-Knöpfe und „Abschließen" gilt dieselbe Ableitung wie in Tabelle 3, Nr. 1 (keine `size`-Angabe, `e2e/dichte.spec.ts`). **Nicht ableitbar** ist der Knopf „Zum ETB-Eintrag" im Erfolgs-Toast: ein `type="link"`-Knopf im `.ant-message`-Portal, **6 s** sichtbar (`abschlussToast.tsx:10`) — eine zeitkritische Aktion ohne Größen- und Abstandsmessung. Ebenso ungemessen: der Kopf „Weitere Angaben" | LFH-547 |
| 2 | Handschuh-Modus | **offen** | Nicht gemessen. Die Schnellwahl `+30 min` / `+1 h` / `+2 h` / `kein Termin` steht in einem `Space wrap` mit Vorgabeabstand `paddingXS` = 3 / 5 / 7 px je Stufe **[abgeleitet]** (CLAUDE.md, LFH-363) — in `handschuh` also voraussichtlich 7 px statt der geforderten 16 px | LFH-547 |
| 3 | Rückmeldung vor der Serverantwort | **erfüllt [abgeleitet]** | `laeuft={mutation.isPending}` → `loading` am Primärknopf (`Erfassung.tsx:407`); Doppel-Absenden gesperrt (`Erfassung.test.tsx` „sendet bei gehaltener Taste nicht doppelt"); Quittung nach Erfolg per Toast (`LagebesprechungModal.test.tsx` „quittiert per Toast und führt über ihn zum eigenen ETB-Eintrag"). Der Ladezustand selbst ist nicht eigens getestet | — |
| 4 | Kritische Aktion hat eine zweite Handlung | **erfüllt** | Anwendbar (Spec §12.1): der Abschluss ist nicht umkehrbar (ETB-Eintrag `entscheidung` in derselben Transaktion). Zweite Handlung ist der **Pflicht-Entschluss** als bewusste Eingabe statt einer Rückfrage, nach dem Öffnen über die Kopfaktion (`StabPage.test.tsx` „ist mit Schreibrecht die eine Primäraktion und öffnet die Maske"). Pflicht clientseitig (`rules required, whitespace`, `LagebesprechungModal.tsx`) und serverseitig: `tests/stab.rs` `leerer_entschluss_ist_400_und_termin_vor_besprechung_ist_422`; Termin-Regel gespiegelt: `LagebesprechungModal.test.tsx` „Termin vor dem Zeitpunkt → Meldung AM Feld, kein POST". Kein Überschreiben fremder Termine: `stab/lagebesprechungAbschluss.test.ts`, Block „nur der gesehene Termin wird angefasst (Ruling 10)" | — |
| 5 | Kontrast in beiden Modi | **offen** | Keine eigenen Farben (Grep 0); ungemessen sind u. a. Platzhalter „kein Termin", `extra`-Text „Leer: Zeitpunkt des Abschließens", das Fehler-`Alert` und der Toast im Nachtmodus | LFH-547 |
| 6 | Kein Status allein über Farbe | **erfüllt** | Fehler mit Überschrift und Grund als Text: `LagebesprechungModal.test.tsx` „zeigt den Grund eines abgelehnten POST IM Dialog und nicht im Toast" (prüft „Abschluss fehlgeschlagen"); Feldregel als Satz am Feld: „Termin vor dem Zeitpunkt → Meldung AM Feld, kein POST"; Erfolg als Satz „Lagebesprechung Nr. 4 abgeschlossen" (Test Nr. 3) | — |
| 7 | Eine Farbe = eine Bedeutung | **erfüllt** | Rot nur für den gescheiterten Abschluss; „Abschließen" ist die gewollte Vorwärtsbewegung und kein `danger` (Grep 0, Einordnung wie „Freigeben" am Lagebericht, LFH-348) | — |
| 8 | Helligkeits-/Kontrastregler | **offen** | app-weite Lücke, kein Regler | LFH-397 |
| 9 | Kritische Anzeigen im Blickfeld | **erfüllt** | Ein abgelehnter POST steht im Dialog, der offen bleibt und den Entschluss behält: `LagebesprechungModal.test.tsx` „zeigt den Grund eines abgelehnten POST IM Dialog und nicht im Toast" (Toast-Queue gezählt = 0, `ant-zoom-leave` nicht gesetzt, Wortlaut steht); ein neues Öffnen trägt keinen alten Grund: `StabPage.test.tsx` „öffnet nach einem Fehler ohne den Grund des vorigen Versuchs" | — |
| 10 | Alarmbudget | **erfüllt** | Genau ein Toast, nur nach der Nutzeraktion, nie aus einem Live-Ereignis, mit festem Schlüssel (`abschlussToast.tsx:7`, ein zweiter Abschluss ersetzt ihn): `LagebesprechungModal.test.tsx` „quittiert per Toast …" zählt ihn genau einmal. Handlungsfähiger Toast nach Nutzeraktion ist keine Alarmmeldung (CLAUDE.md, LFH-343) | — |
| 11 | Warnverhalten | **erfüllt** | Kein Blinken (Grep 0), kein Ton; der Toast verschwindet nach 6 s oder über seinen Knopf (`api.destroy`), der Fehler steht still im Dialog | — |
| 12 | Kein Sprung unter dem Cursor | **erfüllt** | Ein live geänderter Stand ändert weder Feld noch Body: `LagebesprechungModal.test.tsx` „friert den Termin beim Öffnen ein: ein live geänderter Stand ändert weder Feld noch Body"; die Wahrheitstabelle dazu in `stab/lagebesprechungAbschluss.test.ts` (Blöcke „Tri-State von naechste_at" und „nur der gesehene Termin wird angefasst"). Maske schließt bei Rechteverlust endgültig: `StabPage.test.tsx` „schließt die Maske beim Rechteverlust und öffnet sie danach nicht von selbst" | — |
| 13 | Fokus nie verdeckt | **offen** | In der Maske keine fixierte Konstruktion (Grep 0). Nach dem Schließen liegt aber der Toast als **fixiertes** Portal (`.ant-message`) 6 s über dem oberen Seitenrand; ob er das Fokusziel nach dem Schließen (Kopfaktion im Seitenkopf) verdeckt, ist nicht gemessen — gehört zur übergebenen Messung „Tastaturweg zum Toast (6 s)" | LFH-547 |
| 14 | Tabellenseite vollständig | **nicht anwendbar** | Maske, keine Menge | — |
| 15 | Erfassungsmaske vollständig | **offen** | **Trägt:** keine Modal-Fusszeile, Knopf im `<form>`, Fokus im Entschluss (`LagebesprechungModal.test.tsx` „keine Modal-Fusszeile, Absende-Knopf im <form>, Fokus im Entschluss"; das erste Feld ist eine `TextArea`, Enter bleibt Zeilenumbruch); Feldbudget genau 2 sichtbar + 1 eingeklappt im Baum („zeigt zwei Felder; der Zeitpunkt liegt eingeklappt IM Baum", „Aufklappen erhöht die Zahl der sichtbaren Felder"); Vorbelegung sichtbar und überschreibbar („belegt einen zukünftigen Termin vor — einen vergangenen nicht", „„kein Termin" → naechste_at ist null", die drei Schnellwahl-Tests); Labels über dem Feld (`Erfassung.tsx:345`); Datumseingabe per Tastatur (die Tests tippen Termin und Zeitpunkt). **Bewusst nicht:** Serienmodus — eine Lagebesprechung entsteht nicht im Minutentakt. **Offen:** der Tastaturweg zum Knopf im Erfolgs-Toast innerhalb von 6 s und der Toast-Klick unter dem produktiven `createBrowserRouter` (Vitest prüft unter `MemoryRouter`) | LFH-547 |

**Verdikt-Bilanz:** 8 erfüllt · 6 offen · 1 nicht anwendbar.

---

## Gesamtbilanz

| Fläche | erfüllt | offen | nicht anwendbar |
| --- | --- | --- | --- |
| 1 · Besetzungsliste | 6 | 4 | 5 |
| 2 · Kopfblock Lagebesprechung | 6 | 6 | 3 |
| 3 · Modal „Besetzung ändern" | 8 | 4 | 3 |
| 4 · Modal „Lagebesprechung abschließen" | 8 | 6 | 1 |
| **Summe (60 Zeilen)** | **28** | **20** | **12** |

## Offene Punkte

| Fläche · Nr. | Was fehlt | Zielticket |
| --- | --- | --- |
| 1 · 2 | Abstand ≥ 16 px in `handschuh`; Werkzeug-Links ohne `gap` (`StabPage.tsx:236`) — wahrscheinlicher Befund | LFH-547 |
| 1 · 5 | Nachtkontrast der Besetzungs-StatusTags | LFH-547 |
| 1 · 8 | Helligkeits-/Kontrastregler (app-weit) | LFH-397 |
| 1 · 12 | Verschiebung der Besetzung durch Historien-Zuwachs (≤ 3 Einträge) und Seitenhöhe | LFH-547 |
| 2 · 1 | Expander-Kopf „Frühere Lagebesprechungen (N)" und ETB-Links darin (ab 4 Besprechungen) | LFH-547 |
| 2 · 2 | Abstand ≥ 16 px; Expander-Kopf in `handschuh` | LFH-547 |
| 2 · 5 | Nachtkontrast „in … min" / „überfällig" | LFH-547 |
| 2 · 8 | Regler inkl. Sperre bei aktiver Warnung „überfällig" (app-weit) | LFH-397 |
| 2 · 9 | Lage von „Nächste" im ersten Bild bei 1366 × 768 mit offenem Panel (Breitenmessung) | LFH-547 |
| 2 · 12 | Neue Historien-Zeile oben ohne Sammelbanner; Seitenhöhe mit > 3 Besprechungen | LFH-547 |
| 3 · 2 | Höhe und Abstand der Maskenziele in `handschuh` | LFH-547 |
| 3 · 5 | Nachtkontrast Platzhalter, Fehler-`Alert`, Optionsliste | LFH-547 |
| 3 · 8 | Regler (app-weit) | LFH-397 |
| 3 · 15 | Tastatur-Durchlauf der Maske inkl. Ad-hoc-Weg | LFH-547 |
| 4 · 1 | Trefffläche des Toast-Knopfs „Zum ETB-Eintrag" (6 s) und des Kopfs „Weitere Angaben" | LFH-547 |
| 4 · 2 | Abstand der Schnellwahl-Knöpfe in `handschuh` ([abgeleitet] 7 px statt 16) | LFH-547 |
| 4 · 5 | Nachtkontrast Platzhalter, `extra`-Text, Fehler-`Alert`, Toast | LFH-547 |
| 4 · 8 | Regler (app-weit) | LFH-397 |
| 4 · 13 | Verdeckt der fixierte Toast das Fokusziel nach dem Schließen? | LFH-547 |
| 4 · 15 | Tastaturweg zum Toast (6 s); Toast-Klick unter `createBrowserRouter` | LFH-547 |

**Bereits an LFH-547 übergeben** (Ledger LFH-543): Breitenmessung 1366 × 768 mit offenem Panel
sowie 1024 und 390 px ohne `body`-Überlauf, Kontrast der StatusTags im Nachtmodus, Toast-Klick
unter `createBrowserRouter`, Tastaturweg zum Toast (6 s), Seitenhöhe mit > 3 Besprechungen.
**Aus dieser Prüfliste neu dazu:** Abstand ≥ 16 px an Werkzeug-Links, Historien-Zielen und
Schnellwahl (1·2, 2·2, 4·2); Expander-Kopf (2·1); die beiden Masken in `handschuh` (3·2) und
im Nachtmodus (3·5, 4·5); Tastatur-Durchlauf der Besetzungsmaske (3·15); Toast über dem
Fokusziel (4·13); die Verschiebung bei ≤ 3 Historien-Einträgen (1·12, 2·12).

**Nachprüfung nach ST6/ST7 (keine eigene Zeile, aber Pflicht):** mit den Lücken-Kennzahlen
(LFH-544) bekommt die Besetzungsliste eine vierte Sorte handgebauter Ziele (Kennzahl-Deeplinks,
Spec §10) und mehr Zeilenhöhe; Tabelle 1, Nr. 1, 2 und 12 sind dann neu zu belegen, der
Gate-3-Test um die Kennzahl-Deeplinks zu erweitern. Die Stabsvorschläge (LFH-545) liegen in
fremden Masken (ETB, Erinnerung, Auftrag) und gehören in deren Prüflisten.

---

## Abbruchkriterium (Spec Entscheidung 17)

Kein Entwurf hat einen Feldbeleg für den Kern dieses Moduls (Spec §2.5), und „sechs Zeilen in
unter einer Minute gepflegt" ist **[abgeleitet]**, nicht gemessen. Die Freischaltung ist damit
eine Wette mit festgelegtem Prüfpunkt:

- **Beobachtungszeitpunkt:** die **erste Übung mit echter Fahrzeugbesatzung** nach der
  Auslieferung.
- **Gezählt wird:**
  - **(a)** ob die **Besetzung** S1–S6 im Modul gepflegt wurde;
  - **(b)** ob **mindestens eine Lagebesprechung über das Modul abgeschlossen** wurde
    (ETB-Eintrag vom Typ `entscheidung` mit Rückverweis aus `einsatz_lagebesprechung`).
- **Folgen:**
  - bleibt **(a)** aus → die **Besetzungsliste wird auf die Lagebesprechung reduziert**;
  - bleibt **(b)** aus → der **Abschluss wandert als Aktion ins ETB-Modul**, und das
    Stab-Modul geht in der Registry **zurück auf `wip`**.
- **Kein Ausbau** (Spec Abschnitt 13: Funkplan, Funktionskatalog, Termin ↔ Erinnerung u. a.)
  **vor diesem Befund.**

Der Befund gehört als Nachtrag in diese Datei, mit Datum der Übung und den beiden Zählungen.
