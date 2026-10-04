# Gekoppelte Geräte und Funktionsansichten — Regeln

Gilt für `frontend/src/geraet/` und die Gerätezweige der geteilten Seiten (UHS-Detail, Grundriss,
Aufnahme, Personendetail), Client und Server (`src/geraet/`), ergänzt `frontend/AGENTS.md`. Pfade
relativ zu `frontend/src/` bzw. zur Wurzel. Specs: `geraete-kopplung`, `funktionsansichten`,
`feldgeraet-bedienung`, `lagemonitor` (LFH-892).

- **Die Schranke steht beim Server, die Oberfläche verengt nur.** Je Ansicht eine Routenliste in
  `src/geraet/mod.rs` (was fehlt, ist verboten; anderer Einsatz 404), die Stellenbindung in
  `src/geraet/stelle.rs` (fremde UHS oder Person 404, Buchung in eine fremde UHS 403). Im Client
  blendet `geraetDarf`/`useGeraetDarf` (`geraet/geraetSicht.ts`) nur aus, was der Server
  ablehnt. Eine neue Fähigkeit beginnt mit Listeneintrag und Test in `tests/geraet_kopplung.rs`,
  erst dann `geraetDarf`.
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
  Personenkennungen, auch nicht in der Serverantwort; Datenstand älter als 2 Minuten
  hervorgehoben; Gerätemenü nur nach 3 s Drücken, zu nach 30 s ohne Eingabe.
