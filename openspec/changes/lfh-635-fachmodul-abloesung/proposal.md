# Proposal

## Why

Der Neuentwurf „Instrumententafel“ zeigt unter Kräfte & Mittel ein Modul „Ablösung“ mit
Zähler und eine Überblick-Marke „15:30 Ablösung Deichwache Nord, 2 Einheiten“. LFH-620 hat
entschieden, das als eigenes Fachmodul zu bauen (LFH-635). Heute kennt das System keinen
Einsatzbeginn einer Einheit und keinen Ablösungsrhythmus. Wann eine Einheit abgelöst werden
muss, steht deshalb nur im Kopf der Führung oder auf Papier, und eine verpasste Ablösung
fällt niemandem auf.

## What Changes

- Neues Fachmodul **Ablösung** (Modul-Key `abloesung`, Kategorie Kräfte & Mittel, Route
  `/einsaetze/:einsatzId/abloesung`). Backend und Frontend sind vollständig, keine
  Sprungmarke.
- Neue Entität **Schicht** je Einheit: Beginn (Einsatzbeginn der Einheit), Rhythmus, daraus
  berechnete Fälligkeit, geplante ablösende Einheit, Vollzug. Je Einheit gibt es höchstens
  eine laufende Schicht.
- **Rhythmus-Vorgabe am Einsatzabschnitt.** Eine neue Schicht übernimmt die Vorgabe ihres
  Abschnitts. Eine eigene Angabe an der Einheit überschreibt sie. Ändert sich die Vorgabe,
  wandern alle laufenden Schichten mit, die ihr folgen. Die Änderung wird als
  ETB-Entscheidung festgehalten.
- **Vollzug** über einen Erfassungsdialog mit Zeitpunkt und ablösender Einheit. Ist eine
  ablösende Einheit angegeben, entsteht für sie automatisch die Folgeschicht (Beginn =
  Vollzug, gleicher Rhythmus). Frist, Folgeschicht und ETB-Eintrag laufen in derselben
  Transaktion.
- **Rückweg:** Ein Vollzug lässt sich zurücknehmen, solange die Folgeschicht unberührt ist.
  Die Schicht ist dann wieder laufend, die Frist ist wieder offen, und eine ETB-Berichtigung
  wird geschrieben. Die Oberfläche bietet den Rückweg als Rückgängig-Toast an.
- **Kopplung an den Erinnerungs-Scheduler:** Je laufender Schicht gibt es eine Auto-Frist
  zur Fälligkeit und eine Vorwarn-Frist 30 min vorher. Beide lösen genau einmal einen
  Hinweis in der AlarmZentrale aus, die schon ein Budget hat (höchstens drei Toasts, der Rest
  wird gebündelt). Danach bleibt „überfällig“ als Wort und Alarmfarbe stehen, ohne Blinken.
- **Überblick:** Fällige Ablösungen erscheinen als Marken unter „Nächste Marken“. Einheiten
  desselben Abschnitts mit gleicher Fälligkeit werden zu einer Marke zusammengefasst.
- **Modulzähler** im Modulpanel: Ablösungen, die überfällig sind oder in die Vorwarnzeit
  fallen.
- Neues Live-Ereignis `abloesung`, Codegen der Response-Typen, Schwärzungsregel,
  Registry-Eintrag, `MODUL_KEYS`/`PFAD_KEY`/Marker.
- **Prüfliste Einsatztauglichkeit** für die neue Seite.

## Capabilities

### New Capabilities

- `kraefte-abloesung`: Schichten und Ablösungen von Einheiten im Einsatz, also Rhythmus je
  Abschnitt oder Einheit, Fälligkeit, Vorwarnung und Überfälligkeit, Vollzug mit
  Folgeschicht und Rücknahme, ETB-Nachweis und die Anzeige in Modul, Modulzähler und
  Überblick.

### Modified Capabilities

(keine: `lagekarte-fachebenen` ist nicht berührt)

## Impact

- **Datenbank:** neue Migration (Tabelle `einsatz_abloesung`, Spalte
  `einsatzabschnitt.abloesung_rhythmus_minuten`). Nummer `0113` (bei drei Rebases auf `alpha`
  nachgezogen: `0104`–`0112` sind dort inzwischen belegt).
- **Backend:** neues Modul `src/abloesung/` und neue Routen in `src/routes/abloesung.rs`.
  Berührt werden außerdem `src/einsatz/modul.rs`, `src/live/mod.rs`,
  `src/erinnerung/{repo,scheduler}.rs` (transaktionsfähiges Anlegen und Verschieben einer
  Auto-Frist, Live-Hinweis an Ablösungs-Leser), `src/kommunikation/mod.rs`
  (Bezugskonstanten), `src/einheit/repo.rs` (Auflösen einer Einheit schließt ihre Fristen),
  `src/einsatz/schwaerzung_registry.rs`, `src/api_doc.rs` und `src/app.rs`.
- **API:** neue Endpunkte unter `/api/einsaetze/{id}/abloesungen`. Bestehende Endpunkte
  bleiben unverändert.
- **Frontend:** neue Seite und API-Client. Berührt werden `modulRegistry.ts`, `App.tsx`,
  `deeplinks.ts`, `queryKeys.ts`, `useModulZaehler.ts`, `live/useEinsatzLiveStream.ts`,
  `einsatz/AlarmZentrale.tsx`, `pages/fuehrung/ueberblickDaten.ts` + `UeberblickPage.tsx`
  und `theme/statusFarben.ts`, dazu die generierten Typen.
- **Tests und Guards:** `tests/modul_override.rs`, `tests/einsatz_kontext_guard.rs`,
  `tests/enum_wire_kontrakt.rs`, `liveEvent.contract.test.ts`, `queryKeys`-Guards,
  `statusFarben.test.ts`. Eine neue e2e-Route kommt dazu.
