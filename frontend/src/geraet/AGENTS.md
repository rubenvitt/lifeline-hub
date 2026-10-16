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
  Einsatzabschnitt haben je eine Spalte in `geraet_kopplung` (Migration 0159, höchstens eine
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
  Einsatzbefehle (LLH-1190) liest und quittiert das Gerät über die geteilten Befehlsrouten, aber
  nur die geltende Fassung mit einem eigenen Verteiler-Eintrag (`routes/befehl.rs`,
  `is_sichtbar_im_bereich`); Entwurf, überholte Fassung und fremder Eintrag sind 404. Im Client
  stehen sie unter den Aufträgen (`geraet/GeraetBefehle.tsx`), „Quittieren“ nur an eigenen
  Einträgen.
  Gefahrenzonen zeigt das Gerät einsatzweit, Bezirke und Skizzen nicht. Einsatzweite Zähler
  (`modul_zaehler.rs`) bekommt es nicht. Die Karte kommt ohne gespeicherte Kartenansicht aus,
  die steht in keiner Routenliste.
- **Eine Ansicht wird verfügbar, wenn sie fertig ist:** `Funktionsansicht::ist_verfuegbar` erst
  setzen, wenn Routenliste, Stellenfilter, Server-Test und Hülle stehen. Vorher ist das Koppeln
  422, und die Kopplungsmaske bietet nur, was `GeraeteUebersicht.ansichten` nennt;
  `geraetStartPfad` gibt für sie `null`.
- **Betreuungsstelle** (LFH-1041): Personen sind, wer je mit Verbleib „Notunterkunft“ an der
  eigenen Stelle war. Die Aufnahme bucht diesen Verbleib im selben Schritt (Status `betroffen`,
  keine Sichtung, `geraetDarf('person-sichtung')`); sie ändert die Mengenmeldung nicht, nur
  „davon namentlich“. Eine Notunterkunft nur an der eigenen Stelle (sonst 403). Eigene Pfade
  (`GERAET_BETREUUNG_PFADE`, `geraetBetroffene*Pfad`), Meldungen über `geraet/GeraetMeldungen.tsx`
  wie am UHS-Laptop; der Betreuungszähler fehlt wie Personen- und Meldungszähler.
- **Eigene Hülle** (`geraet/GeraeteLayout.tsx`): keine Modulleiste, kein Benutzermenü, keine
  Sprungpalette (`CommandPaletteProvider` öffnet bei `geraet` nicht), kein Org-Strom (`/api/live`
  steht in keiner Liste), kein `EinsatzAnzeigeProvider` (lädt `/einstellungen`, 403), kein Ton
  und keine Benachrichtigung: beide Hüllen öffnen den Einsatzstrom mit `stumm` (Spec
  `benachrichtigungen`, „Gekoppelte Geräte bleiben still“; Nachweis `geraet/GeraetAbschnitt.test.tsx`,
  `geraet/LagemonitorPage.test.tsx`). Der Einsatzstrom ist Pflicht: schließt ihn der Server nach einem Widerruf, endet das Gerät ohne
  Neuladen (Nachweis `e2e/geraet-uhs-tablet.spec.ts`).
- **Vorhandene Flächen statt eigener Seiten.** Seiten, die die Hülle einbindet, führen ihre Wege
  über `useEinsatzPfade()` (`routing/EinsatzPfade.tsx`), nie direkt über `personDetailPfad`,
  `uhsDetailPfad` oder `personenAufnahmePfad`. Sprünge in fremde Module (Brotkrumen, Lagekarte,
  Tiere, Schäden) stehen hinter `darf('fremde-module')`.
- **Adressen** unter `/geraet/:id/…` (`geraet*Pfad` in `routing/deeplinks.ts`). `RequireAuth`
  hält ein Gerät dort; `GeraetEinsatzRahmen`, `GeraetUhs` und `GeraetAufnahme` führen fremde
  Einsatz- oder UHS-Kennungen auf die Startseite. Ein 401 führt über die Marke
  `geraet/geraetMarke.ts` (in `GERAETESPEICHER`) auf „Kopplung beendet“, nie auf die Anmeldung.
- **Bediener am Gerät** (LFH-1046, Spec `geraete-kopplung`): Sichtung, Erst-Sichtung und Verbleib
  nehmen am UHS-Gerät optional `bestaetigt_personal_id` aus dem Einsatzpersonal an
  (`src/geraet/bestaetigung.rs`). Die Angabe ist ein Datenfeld, keine Anmeldung: keine Sitzung,
  keine Rechte über die Ansicht hinaus; eine Person schickt sie nie (422). Im Client nur über
  `geraet/BestaetigtVonFeld.tsx`, ohne Vorauswahl. ETB-Text und Verlauf nennen „bestätigt: Name“,
  Erfasser bleibt das Gerät.
- **Nichts auf der Platte** (design.md D8): kein Lagebild (`offline/lagebildSitzung.ts`
  überspringt Geräte), keine gemerkte UHS; die Schreib-Warteschlange bleibt an
  (`useOfflineSync` in der Hülle).
- **Kopfzeile und Navigation** (`geraet/GeraeteKopf.tsx`): Stelle, Gerät, Verbindung und
  Kopplungsende stehen immer, unter einer Stunde mit Wort und Farbe; ohne Netz der jüngste
  Datenstand. Den Namen der Stelle liest `useStellenName` (`geraet/stellenName.ts`) aus der live
  geführten Abfrage der Stelle, `geraet.stelle` aus `/me` nur als Rückfall: die Sitzung lädt nach
  einer Umbenennung nicht neu (LLH-1155). Auch Seitenkopf und Meldungsabsender lesen dort. Die Navigation sitzt am unteren Rand in Daumenreichweite, Ziele mindestens
  `Math.max(56, controlHeight)`. Die Dichte folgt dem Gerät (`theme/dichte.ts`), die
  Handschuh-Stufe wählt das Gerätemenü.
- **Lagemonitor (Großbild):** feste Kachelung ohne Bildlauf bei 1920 × 1080, Kacheln und Karte
  ohne Bedienung; Kennzahlen mindestens 72 px, jeder Text mindestens 28 px; keine Namen und keine
  Personenkennungen, auch nicht in der Serverantwort (der Einsatzkopf kommt ohne Sachverhalt,
  meldende Stelle und Ortsangabe, `routes/einsatz.rs` `detail`); Datenstand älter als 2 Minuten
  hervorgehoben; Gerätemenü nur nach 3 s Drücken, zu nach 30 s ohne Eingabe.
  Seine Zahlen kommen nur aus `GET /api/einsaetze/{id}/lagemonitor` (`src/routes/lagemonitor.rs`,
  nur für diese Ansicht), auch Gefahrenzonen (Typ und Geometrie) und Abschnittsflächen
  (Bezeichnung und Fläche) für die Karte (LLH-1153) und die offenen Sofortmeldungen nur als
  Zahl (`sofortmeldungen_offen`, D12 der Change `kcjecn9e-benachrichtigungskonzept`); `/zonen`
  und `/abschnitte` bleiben ihm gesperrt, sie tragen Notizen und Leiternamen. Steigt diese Zahl
  oder SK I gegenüber dem letzten Stand, hebt `useAnstieg` sie 60 s mit Farbe und Wort hervor,
  ohne Ton und Blinken. Personen-Ereignisse erreichen ihn nicht, deshalb holt
  `geraet/LagemonitorPage.tsx` zusätzlich im Takt (design.md D11). Keine Kachel schneidet ihren
  Inhalt ab (Nachweis `e2e/geraet-lagemonitor.spec.ts`).
- **Bereitstellungsraum** (LFH-1042): Startseite ist der eigene Raum, die geteilte
  `BrDetailPage` unter `/geraet/:id/br/:brId` (`GeraetBr` hält die Kennung beim eigenen); ohne
  `br-verwalten` kein Umschalter, kein Auflösen und Stornieren, kein gemerkter Raum. Den Verlauf
  des eigenen Raums liest das Gerät mit (`…/bereitstellungsraeume/{bid}/verlauf`, Spec
  `funktionsansichten`, LLH-1095), erst beim Aufklappen (`pages/bereitstellungsraum/BrVerlauf.tsx`);
  ein Wechsel nennt den anderen Raum mit Bezeichnung, dessen Detail und Verlauf bleiben 404.
  `br-eintreffen` (LLH-1075, design.md D14, nur Ansicht `bereitstellungsraum`) öffnet
  „Eintreffen buchen“ (`pages/bereitstellungsraum/EintreffenDialog.tsx`, am Gerät vollflächig) und
  ist die einzige Stelle, an der ein Gerät Einheiten und Fahrzeuge anlegt („Unangemeldet buchen“);
  Übernehmen und Abweisen bleiben der Führung und erscheinen am Gerät nie. Die Suche kennt nur
  Kräfte des Einsatzes, keine Stammdaten. Abrufen ist eine Führungsentscheidung (LLH-1085):
  `br-abrufen` ist an keinem Gerät wahr, „Abrufen“, „Abrufen und austragen“ und „Abruf
  zurücknehmen“ fehlen dort. Das Gerät sieht abgerufene Kräfte live unter „Abgerufen“ (ohne Ton,
  Entscheidung 15.10.2026) und bucht „Ausrücken buchen“ als Austritt über `…/belegung`; „Austragen“
  steht an Desktop und Gerät im Aktionsmenü der Zeile. Meldungen an
  die Einsatzleitung baut nur `geraet/GeraetMeldungen.tsx` (UHS-Laptop, Abschnitt, Bereitstellungsraum,
  Verpflegung); das Navigationsziel heißt bei Abschnitt, Bereitstellungsraum und Verpflegung „Melden“.
- **Verpflegung** (LFH-1044): einsatzweit ohne Stelle, Startseite ist die geteilte
  `VerpflegungPage` unter `/geraet/:id/verpflegung`; ohne `verpflegung-planen` kein Anlegen,
  Bearbeiten, Löschen. Eine Fehlmenge geht als Meldung an die Einsatzleitung (`meldungVorbelegung`,
  `?inhalt=` auf der Meldungsseite), nie als Nachforderung; eine Ausgabe mit `nachforderung_id`
  lehnt der Server für jedes Gerät mit 403 ab. Ohne Stelle steht die Ansicht als Absender.
  Gezählt wird auf der Unterseite `/geraet/:id/verpflegung/:zeitfensterId/ausgabe`
  (`GeraetVerpflegungAusgabe`, LLH-1032); die Startseite bleibt die Liste, das Navigationsziel
  „Verpflegung“ bleibt dort aktiv (`NavLink` ohne `end`). Karte und Ansicht wählen den Pfad über
  `EinsatzPfade` (`verpflegung`, `verpflegungAusgabe`), nie über `useAuth().geraet`; eine neue
  Serverroute gibt es dafür nicht.
  `Funktionsansicht::ohne_personenbezug` (Lagemonitor, Verpflegung) nimmt Bearbeiter- und
  Bestätigernamen aus den Meldungen und die Freitexte aus dem Einsatzkopf. Empfänger einer Ausgabe
  (LLH-1055) liest das Gerät nur aus der Projektion `empfaenger` in `GET …/verpflegung`, **nie**
  `GET …/einheiten` (bleibt 403); Einheitennamen sind keine Namen von Einsatzkräften, Führer- und
  Mitgliedernamen bleiben draußen; Lese-Module und Routenliste `VERPFLEGUNG` unverändert. Den
  Einsatzleiter am Einsatzkopf bekommt keine Gerätesitzung (LLH-1168, `src/routes/einsatz.rs::detail`).
  Einsatzweite Zähler für Meldungen und Personen bekommt kein Gerät, auch ohne Stelle
  (`modul_zaehler.rs`).
