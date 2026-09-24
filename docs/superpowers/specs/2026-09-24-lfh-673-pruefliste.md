# Prüfliste Einsatztauglichkeit — Betreuung auf der Lagekarte (LFH-673)

Gate 7 der Bedien-Leitlinie (`2026-07-25-bedien-leitlinie-einsatzkontexte.md`, Festlegung 7)
verlangt diese Liste an jeder umgebauten Seite. Planung und Spec liegen in
`openspec/changes/lfh-673-betreuung-auf-der-lagekarte/`.

## Geltungsbereich

| Angabe | Wert |
| --- | --- |
| Routen | `/einsaetze/:id/lagekarte` (Ebene „Betreuungsstellen", Zonentyp „Evakuierungsbezirk", Zonen-Inspector, Deeplinks `?platzieren=betreuungsstelle:<id>`, `?evakuierungsbezirk=<id>`) · `/einsaetze/:id/betreuung` (Einstiege „Auf Karte verorten" / „Auf Karte zeigen") |
| Stand | Code-Stand `7a4ca27e` auf `feat/lfh-673-betreuung-auf-der-lagekarte`; die Prüfliste ist der Commit danach |
| Zielkontext | Fükw (1366 px) zum Verorten und Zuordnen; Führungs-Tablet lesend auf der Karte; mobil nur lesend (die Lagekarte hat unter 390 px keine eigene Bedienform, siehe LFH-355) |
| Nicht enthalten | Zeichnen-Deeplink aus der Betreuungsseite, Farbe nach Räumungszustand, Geokodierung des Freitexts `standort` — Non-Goals aus design.md |

| Fläche | Stellvertreter | Browser-Messung |
| --- | --- | --- |
| **1 · Lagekarte** (Marker, Ebenenzeile, Bezirksfläche, Inspector, Deeplinks) | `pages/lagekarte/*`, `pages/LagekartePage.tsx` | ja: `e2e/lagekarte-betreuung.spec.ts` (drei Durchstiche, Sichtbelege Nacht/Tag) |
| **2 · Einstiege auf der Betreuungsseite** | `betreuung/StellenBlock.tsx`, `betreuung/EvakuierungBlock.tsx`, `pages/BetreuungPage.tsx` | ja: derselbe Spec (Menü → Karte) |

**Verdikte:** **erfüllt** (mit Beleg) · **offen → Zielticket** · **nicht anwendbar** (mit
Begründung). Gerechnetes und aus Quelltext Geschlossenes trägt **[abgeleitet]**.

## Die Nachweise

| Nachweis | Ergebnis |
| --- | --- |
| `e2e/lagekarte-betreuung.spec.ts` „Betreuungsstelle: aus dem Modul verorten, Marker live auf einer zweiten Karte" | Menü → Platziermodus, Auftrag aus der Adresse geräumt, Klick setzt die Koordinate; Marker `betreuungsstelle-<id>` in `marker-cluster` auf BEIDEN Karten, die zweite ohne Neuladen; genau ein ETB-Eintrag zur Stelle (Anlage, keiner für die Verortung); Datenraster „Betreuungsstelle · Notunterkunft"; Sprung ins Modul `?stelle=` |
| derselbe Spec „Evakuierungsbezirk: Fläche mit Räumung, Sprung aus dem Modul, Storno löst" | „Auf Karte zeigen" wählt die Fläche, Parameter geräumt; Beschriftung „Uferstraße 12–40 · Räumung: angeordnet" → live „… läuft"; nach Storno nur „Evakuierungsbezirk" |
| derselbe Spec „ohne Modul Betreuung: Sperrzeile, Fläche nur mit Typwort" | Zeile „Betreuungsstellen – Keine Berechtigung" gesperrt; Fläche nur „Evakuierungsbezirk" |
| Kontrast der Bezirkslinie `#a0522d` gegen die Blindkarte | **3,36 : 1** nachts (`#0f1115`), **4,58 : 1** tags (`#e8e8e8`) [abgeleitet, WCAG-Formel]. Der erste Entwurf `#722ed1` lag nachts bei 2,72 : 1 und war zudem der Abschnittsstil — verworfen |
| Mutationsproben | Live-Weiche `still_geaendert` entfernt → `verortung_speichert_ohne_etb_und_ist_live` rot; Modulprüfung der Zuordnung wirkungslos → `zuordnung_ohne_modul_betreuung_ist_403_loesen_bleibt_erlaubt` rot; Deeplink auf gefilterte Zonenliste → „Fläche in einer anderen Ansicht" rot |
| Grep über die neuen/geänderten Quellen (ohne Tests) | Farbliterale nur in den bewusst rollenfreien Tabellen `CLUSTER_TYP_FARBE` und `STILE` (Dateiköpfe begründen es) · `animation`/`blink`/`keyframes` 0 · neues `size=` 0 |

---

## Tabelle 1 — Lagekarte

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1 | **Treffläche** | **erfüllt** [abgeleitet] | Keine handgebauten Bedienziele: Bezirksauswahl ist `components/Select`, der Sprung ein antd-`Button` im `Link`, die Ebenenzeile und „Platzieren" in „Nicht verortet" sind Bestandsbausteine (Gate 3 misst sie für die übrigen Ebenen). Marker-Treffer über das bestehende Symbol-Layer | — |
| 2 | **Handschuh-Modus** | **erfüllt** [abgeleitet] | Alle neuen Ziele erben `controlHeight` vom `ConfigProvider`; kein punktuelles `size` (Grep) | — |
| 3 | **Rückmeldung vor der Serverantwort** | **erfüllt** | Platzieren quittiert „Objekt verortet" und beendet den Modus erst nach dem PATCH (`useKartenInteraktion.test.tsx` „Betreuungsstelle … Platzier-Auftrag"); der Zonen-Inspector zeigt „speichert …"/„nicht gespeichert" für die Zuordnung (Bestandsmechanik `speicherStatus`) | — |
| 4 | **Kritische Aktion hat eine zweite Handlung** | **erfüllt** | „Verortung löschen" ist umkehrbar (erneut platzieren) und bleibt ohne Rückfrage (LFH-363). Das Lösen einer Bezirkszuordnung ebenso. Unumkehrbares (Zone aufheben) behält seinen Bestandsweg | — |
| 5 | **Kontrast in beiden Modi** | **erfüllt** [abgeleitet] | Neue Grafik: Bezirkslinie 3,36 / 4,58 : 1 (siehe Nachweise). Neuer Text steht ausschließlich in Bestandsbausteinen (Zonenplakette, `Datenraster`, `StatusTag`), deren Paare `hellmodus-kontrast.spec.ts` bzw. die Kontrast-Specs abdecken; Sichtbelege Nacht/Tag im e2e-Spec | — |
| 6 | **Kein Status allein über Farbe** | **erfüllt** | Räumungszustand steht als Wort in der Beschriftung („Räumung: läuft", `zonenStil.test.ts`), Stellenstatus als `StatusTag` mit Label, Auslastung mit Wort (`leistenDaten.test.ts` „Betreuungsstelle"). Die Bezirksfarbe sagt nur „Bezirk", das Typwort steht daneben | — |
| 7 | **Eine Farbe = eine Bedeutung** | **erfüllt** | Siena-Braun ist auf der Karte sonst unbelegt (Entscheidung 24.09.2026; Abschnitt-Violett und Hochwasser-Petrol per Test ausgeschlossen, `zonenStil.test.ts`). Marker in `bedien` wie die UHS (Beziehung „dort wird betreut"), Rot kommt nicht vor | — |
| 8 | **Helligkeits-/Kontrastregler** | **offen** | App-weite Lücke | LFH-397 |
| 9 | **Kritische Anzeigen im Blickfeld** | **erfüllt** | Der Räumungszustand steht AUF der Fläche, nicht nur im Inspector; eine gesperrte Ebene sagt ihren Grund in der Ebenenliste statt still zu fehlen | — |
| 10 | **Alarmbudget** | **nicht anwendbar** | Keine Alarme; die Live-Ereignisse `betreuung`/`lage_zone` invalidieren nur Queries | — |
| 11 | **Warnverhalten** | **erfüllt** | Kein Blinken, kein Ton (Grep) | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Neue Marker erscheinen am Ort, ohne das Layout zu verschieben; eine fremde Zuordnung ändert nur die Beschriftung. Der Inspector-Entwurf wird bei gleicher Zone nicht überschrieben (Bestandsriegel `entwurfZoneId`, um das neue Feld erweitert) | — |
| 13 | **Fokus nie verdeckt** | **nicht anwendbar** | Keine neue stehende Fläche auf der Karte; Inspector und Ebenen liegen in der scrollenden Leiste | — |
| 14 | **Tabellenseite vollständig** | **nicht anwendbar** | Keine Tabelle auf der Karte | — |
| 15 | **Erfassungsmaske vollständig** | **nicht anwendbar** | Verortung ist ein Kartenklick, die Zuordnung ein einzelnes Auswahlfeld | — |

**Bilanz:** 10 erfüllt · 1 offen · 4 nicht anwendbar.

## Tabelle 2 — Einstiege auf der Betreuungsseite

| Nr. | Kriterium | Verdikt | Beleg / Begründung | Zielticket |
| --- | --- | --- | --- | --- |
| 1–2 | **Treffläche / Handschuh** | **erfüllt** | Beide Einstiege sind Menüeinträge im bestehenden Auslöser (Gate 3 misst den Dreipunkt 30 / 48 / 72 px, LFH-639); kein neuer Knopf in der Zeile | — |
| 3 | **Rückmeldung** | **erfüllt** | Sprung = Navigation, sofort sichtbar | — |
| 4 | **Zweite Handlung** | **nicht anwendbar** | Beide Einträge sind Sprünge, keine Handlungen (LFH-616) | — |
| 5 | **Kontrast** | **offen** | Die Seite hat noch keinen Kontrast-Spec | LFH-677 |
| 6–7 | **Farbe** | **nicht anwendbar** | Keine neue Farbe | — |
| 8 | **Regler** | **offen** | App-weit | LFH-397 |
| 9 | **Blickfeld** | **erfüllt** | „Auf Karte verorten" erscheint nur an unverorteten Stellen, „Auf Karte zeigen" nur bei Fläche (`BetreuungPage.test.tsx` „LFH-673"-Fälle) — der Eintrag selbst ist die Aussage | — |
| 10–11 | **Alarm / Warnung** | **nicht anwendbar** | — | — |
| 12 | **Kein Sprung unter dem Cursor** | **erfüllt** | Menüinhalt hängt an `flaechen`/Koordinate der Zeile; die Aktionsspalte ändert ihre Form nicht (LFH-639-Entscheidung (a)) | — |
| 13 | **Fokus nie verdeckt** | **offen** | Unverändert wie in der LFH-639-Prüfliste | LFH-677 |
| 14 | **Tabellenseite** | **erfüllt** | Stellentabelle unverändert, der Eintrag liegt im Menü (LFH-365) | — |
| 15 | **Erfassungsmaske** | **nicht anwendbar** | — | — |

**Bilanz:** 6 erfüllt · 3 offen · 6 nicht anwendbar (Mehrfachzeilen einzeln gezählt).

## Was ausdrücklich nicht behauptet wird

- Gate 3 hat die neuen Zonen-Inspector-Felder nicht einzeln gemessen; das Verdikt stützt sich
  auf die Bausteine [abgeleitet].
- Die Kontrastzahlen der Bezirkslinie gelten für die Blindkarte. Auf Online-Kacheln (Luftbild)
  hängt der Grund am Kachelinhalt; das gilt für jede Zonenfarbe gleich.
