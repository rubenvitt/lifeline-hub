# Prüfliste Einsatztauglichkeit: Lagebild ohne Netz lesen (LFH-723)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder umgebauten Seite. Planung und Spec liegen in
`openspec/changes/lfh-723-lagebild-offline-lesen/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | ETB, Meldebild, Betroffene, Aufträge, Lagekarte eines Einsatzes (`/einsaetze/:id/{etb,kraefteuebersicht,personen,auftraege,lagekarte}`) |
| Stand | Branch `feat/lfh-723-lagebild-offline-lesen` |
| Zielkontext | Führungs-Tablet und mobil im Funkloch, Fükw bei ausgefallenem Server. Gelesen wird, geschrieben nur über die bestehende Offline-Queue. |
| Nicht enthalten | Kacheln der Basiskarte ohne Netz, Räumung der übrigen personenbezogenen Daten auf dem Gerät (LFH-767), eigener Leerzustand für nie geladene Ansichten (Non-Goals, design.md) |

**Was sich an der Oberfläche ändert, ist genau eine Anzeige:** der Datenstand. Er lautet ohne
Verbindung „Stand 14:32 · offline“ statt „Stand 14:32“. Das gilt im Seitenkopf
(`EinsatzSeite`), in den Abschnittsköpfen (`Bereichskopf`, `SektionHeader`) und neu im Kopf
der Lagekarte. Alles andere ist Datenhaltung ohne neue Bedienfläche. Die Kriterien werden
deshalb gegen diese Anzeige und gegen das Verhalten der fünf Seiten ohne Netz gelegt.

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Ticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus Quelltext Geschlossenes trägt im Beleg **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/lagebild-offline.spec.ts` (Prod-Bundle, Service Worker) | Einsatz mit ETB-Eintrag, Einheit mit Position, Person und Auftrag. Die fünf Seiten werden innerhalb der App besucht, danach liegt der Stand nachweislich in `lifeline-lagebild` (ohne Druck, Chat, Audit). Netz weg, `/api/health` scheitert, jede Seite neu geladen: Inhalt steht, Datenstand zeigt die **Online-Uhrzeit** mit „· offline“, keine Seitenausnahme. |
| derselbe Spec, Abmelden | Ohne Netz abgemeldet: `lifeline-lagebild` leer, die Offline-Queue (ein vorgemerkter ETB-Eintrag) unverändert. Mutationsprobe: ohne das Löschen in `logout()` wird der Test rot. |
| `e2e/lagekarte-offline-zeichnen.spec.ts` (Dev) | Karte ohne Netz neu aufgebaut, der Marker steht in der Quelle `marker-cluster`. Ein Stil mit Glyphen und Sprite vom unerreichbaren Server lädt fertig. |
| `e2e/lagebild-offline-kopf.spec.ts` | 390 × 844, kompakt und Handschuh, ETB/Betroffene/Lagekarte: Kopfhöhe beim Wechsel auf offline unverändert, Datenstand-Zeile einzeilig und im Fenster. |
| Vitest | `lagebildOffline.guard.test.ts` (Allowlist gegen jeden verwalteten Prefix, Mutationsproben), `lagebildSitzung.test.ts`, `AuthContext.test.tsx` (Netzfehler/503/401/Benutzerwechsel/Abmelden, IndexedDB geprüft), `queryClient.test.ts` (Rechteentzug ohne Abrufschleife, Mutationsprobe), `verbindung.test.ts`, `Datenstand.test.tsx`, `EinsatzSeite.test.tsx`, `LagekartePage.test.tsx`, `EtbPage`/`PersonenPage` (403 zeigt den Fehler statt des entzogenen Stands) |
| Grep über die neuen/geänderten Quellen (ohne Tests) | Farbliterale 0 · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 · Emoji 0 |

---

## Tabelle — Datenstand ohne Verbindung auf den fünf Seiten

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **nicht anwendbar** | Kein neues Bedienziel. Der Datenstand ist Text (`Typography.Text`), keine Aktion. | — |
| 2 | **Handschuh-Modus** | **erfüllt** | Die Kopfzeile bleibt bei 390 px in Handschuh einzeilig (e2e `lagebild-offline-kopf`), kein punktuelles `size`. | — |
| 3 | **Rückmeldung vor der Serverantwort** | **nicht anwendbar** | Keine neue Aktion. Die Kennzeichnung erscheint mit dem ersten gescheiterten Abrufversuch, nicht erst nach den Wiederholungen (Vitest `verbindung.test.ts`). | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **nicht anwendbar** | Keine neue Aktion. Das Löschen des vorgehaltenen Stands beim Abmelden folgt der Abmeldung selbst und ist gewollt (Spec). | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | „· offline“ steht im selben Element, in derselben Farbe und Schrift wie „Stand 14:32“ davor (`Datenstand`, `type="secondary"` bzw. `farben.gedaempft` am Kopf). Am Kontrast ändert sich nichts gegenüber dem Bestand, eine neue Farbpaarung gibt es nicht. | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Der Zustand ist ein Wort („offline“), auch im zugänglichen Namen („Datenstand 14:32, offline“, Vitest). Farbe trägt er gar nicht. | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Keine neue Farbe. | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen → LFH-397** | App-weite Lücke. | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Die Kennzeichnung steht am Datenstand jeder Seite, dort, wo die Uhrzeit gelesen wird. Kopfleiste („OFFLINE“) und Betriebszeile melden den Zustand zusätzlich wie bisher. Ein Rechteentzug (403) zeigt den Fehlerzweig der Seite, nicht den entzogenen Stand unter „veraltet“ (Vitest ETB, Personen). | — |
| 10 | **Alarmbudget** | **erfüllt** | Kein neuer Toast, kein neuer Banner, kein Alarm. Die Kennzeichnung ist ein stilles Wort am vorhandenen Datenstand. | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep). | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Beim Wechsel auf offline bleibt die Kopfhöhe gleich, gemessen bei 390 px in zwei Dichten auf drei Seiten. Der Inhalt darunter rückt nur um die Betriebszeile, die offline schon vor LFH-723 erschien. | — |
| 13 | **Fokus nie verdeckt** | **nicht anwendbar** | Kein neues Fokusziel. | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle geändert. | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Keine Erfassungsmaske geändert. Offline-Schreiben läuft unverändert über die Queue. | — |

**Bilanz:** 8 erfüllt · 1 offen · 6 nicht anwendbar.
