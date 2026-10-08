# Gekoppelte Geräte und Funktionsansichten — Regeln

Gilt für `frontend/src/geraet/` und die Gerätezweige der geteilten Seiten (UHS-Detail, Grundriss,
Aufnahme, Personendetail), Client und Server (`src/geraet/`), ergänzt `frontend/AGENTS.md`. Pfade
relativ zu `frontend/src/` bzw. zur Wurzel. Specs: `geraete-kopplung`, `funktionsansichten`,
`feldgeraet-bedienung`, `lagemonitor` (LFH-892); Herleitung (`design.md`, D1–D11):
`openspec/changes/archive/2026-10-05-lfh-892-funktionsansichten-geraete/`.

- **Die Schranke steht beim Server, die Oberfläche verengt nur.** Je Ansicht eine Routenliste in
  `src/geraet/mod.rs` (was fehlt, ist verboten; anderer Einsatz 404), die Stellenbindung in
  `src/geraet/stelle.rs` (fremde Stelle oder Person 404, Buchung in eine fremde Stelle 403). Im
  Client blendet `geraetDarf`/`useGeraetDarf` (`geraet/geraetSicht.ts`) nur aus, was der Server
  ablehnt. Eine neue Fähigkeit beginnt mit Listeneintrag und Test in `tests/geraet_kopplung.rs`,
  erst dann `geraetDarf`.
- **Stellenbindung je Art** (LFH-1040): UHS, Betreuungsstelle, Bereitstellungsraum und
  Einsatzabschnitt haben je eine Spalte in `geraet_kopplung` (Migration 0158, höchstens eine
  gesetzt); `Funktionsansicht::stellenart` nennt die Art, `GeraetKontext.stelle` die Stelle. Die
  Helfer in `stelle.rs` gelten streng: ein Gerät, das nicht an eine Stelle genau dieser Art
  gebunden ist, sieht keine (`sicht` → `Keine`), Personen nur über `sichtbare_personen` /
  `fordere_person` seiner Art. Wer eine Route mehreren Ansichten öffnet, filtert über diese
  Helfer, nie über `ctx.geraet.is_none()`. Ein aufgelöster Abschnitt widerruft seine Kopplungen.
- **Abschnittsansicht** (LFH-1043): der Bereich ist der Teilbaum des gebundenen Abschnitts samt
  seiner Einheiten (`src/geraet/abschnitt.rs`, je Anfrage neu berechnet). Listen filtern über
  `abschnitt::bereich`, Aufträge im SQL (`AuftragFilter.bereich`, sonst stimmt das Blättern
  nicht); Fremdes ist 404, ein fremder Meldungsabsender 403, ohne Angabe meldet der Abschnitt.
  Quittiert wird nur die eigene Empfängerzeile (`darfQuittierenFuer` an `AuftragKarte`).
  Gefahrenzonen zeigt das Gerät einsatzweit, Bezirke und Skizzen nicht. Einsatzweite Zähler
  (`modul_zaehler.rs`) bekommt es nicht. Die Karte kommt ohne gespeicherte Kartenansicht aus,
  die steht in keiner Routenliste.
- **Eine Ansicht wird verfügbar, wenn sie fertig ist:** `Funktionsansicht::ist_verfuegbar` erst
  setzen, wenn Routenliste, Stellenfilter, Server-Test und Hülle stehen. Vorher ist das Koppeln
  422, und die Kopplungsmaske bietet nur, was `GeraeteUebersicht.ansichten` nennt;
  `geraetStartPfad` gibt für sie `null`.
- **Eigene Hülle** (`geraet/GeraeteLayout.tsx`): keine Modulleiste, kein Benutzermenü, keine
  Sprungpalette (`CommandPaletteProvider` öffnet bei `geraet` nicht), kein Org-Strom (`/api/live`
  steht in keiner Liste), kein `EinsatzAnzeigeProvider` (lädt `/einstellungen`, 403). Der
  Einsatzstrom ist Pflicht: schließt ihn der Server nach einem Widerruf, endet das Gerät ohne
  Neuladen (Nachweis `e2e/geraet-uhs-tablet.spec.ts`).
- **Vorhandene Flächen statt eigener Seiten.** Seiten, die die Hülle einbindet, führen ihre Wege
  über `useEinsatzPfade()` (`routing/EinsatzPfade.tsx`), nie direkt über `personDetailPfad`,
  `uhsDetailPfad` oder `personenAufnahmePfad`. Sprünge in fremde Module (Brotkrumen, Lagekarte,
  Tiere, Schäden) stehen hinter `darf('fremde-module')`.
- **Adressen** unter `/geraet/:id/…` (`geraet*Pfad` in `routing/deeplinks.ts`). `RequireAuth`
  hält ein Gerät dort; `GeraetEinsatzRahmen`, `GeraetUhs` und `GeraetAufnahme` führen fremde
  Einsatz- oder UHS-Kennungen auf die Startseite. Ein 401 führt über die Marke
  `geraet/geraetMarke.ts` (in `GERAETESPEICHER`) auf „Kopplung beendet“, nie auf die Anmeldung.
- **Nichts auf der Platte** (design.md D8): kein Lagebild (`offline/lagebildSitzung.ts`
  überspringt Geräte), keine gemerkte UHS; die Schreib-Warteschlange bleibt an
  (`useOfflineSync` in der Hülle).
- **Kopfzeile und Navigation** (`geraet/GeraeteKopf.tsx`): Stelle, Gerät, Verbindung und
  Kopplungsende stehen immer, unter einer Stunde mit Wort und Farbe; ohne Netz der jüngste
  Datenstand. Die Navigation sitzt am unteren Rand in Daumenreichweite, Ziele mindestens
  `Math.max(56, controlHeight)`. Die Dichte folgt dem Gerät (`theme/dichte.ts`), die
  Handschuh-Stufe wählt das Gerätemenü.
- **Lagemonitor (Großbild):** feste Kachelung ohne Bildlauf bei 1920 × 1080, Kacheln und Karte
  ohne Bedienung; Kennzahlen mindestens 72 px, jeder Text mindestens 28 px; keine Namen und keine
  Personenkennungen, auch nicht in der Serverantwort (der Einsatzkopf kommt ohne Sachverhalt,
  meldende Stelle und Ortsangabe, `routes/einsatz.rs` `detail`); Datenstand älter als 2 Minuten
  hervorgehoben; Gerätemenü nur nach 3 s Drücken, zu nach 30 s ohne Eingabe.
  Seine Zahlen kommen nur aus `GET /api/einsaetze/{id}/lagemonitor` (`src/routes/lagemonitor.rs`,
  nur für diese Ansicht); Personen-Ereignisse erreichen ihn nicht, deshalb holt
  `geraet/LagemonitorPage.tsx` zusätzlich im Takt (design.md D11). Keine Kachel schneidet ihren
  Inhalt ab (Nachweis `e2e/geraet-lagemonitor.spec.ts`).
