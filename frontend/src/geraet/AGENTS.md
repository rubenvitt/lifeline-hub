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
- **Stellenbindung je Art** (LFH-1040, LLH-1048): UHS, Betreuungsstelle, Bereitstellungsraum,
  Einsatzabschnitt und Verpflegungsstelle haben je eine Spalte in `geraet_kopplung` (Migration
  0213, höchstens eine gesetzt); `Funktionsansicht::stellenart` nennt die Art,
  `GeraetKontext.stelle` die Stelle. Die Helfer in `stelle.rs` gelten streng: ein Gerät, das
  nicht an eine Stelle genau dieser Art gebunden ist, sieht keine (`sicht` → `Keine`), Personen
  nur über `sichtbare_personen` / `fordere_person` seiner Art. Wer eine Route mehreren Ansichten
  öffnet, filtert über diese Helfer, nie über `ctx.geraet.is_none()`. Ein aufgelöster Abschnitt
  widerruft seine Kopplungen; eine aufgelöste UHS, ein aufgelöster BR und eine aufgelöste
  Verpflegungsstelle nicht. **Einzige wahlweise Stelle ist die Verpflegung**
  (`stelle_wahlweise`, LLH-1024 F7, `AnsichtAuswahl.stelle_pflicht = false`): ohne Stelle bleibt
  das Gerät einsatzweit. Ihre Handler fragen `sicht_wahlweise` / `ziel_stelle_wahlweise`, nie die
  strenge `sicht`; eine neue wahlweise Ansicht braucht dieselbe Entscheidung in jedem Handler.
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
- **Bediener am Gerät** (LFH-1046, Spec `geraete-kopplung`): Sichtung, Erst-Sichtung, Verbleib,
  Transport, Maßnahme und Verletzung nehmen am UHS-Gerät optional `bestaetigt_personal_id` aus dem
  Einsatzpersonal an (`src/geraet/bestaetigung.rs`; Aufheben nicht). Die Angabe ist ein
  Datenfeld, keine Anmeldung: keine Sitzung, keine Rechte über die Ansicht hinaus; eine Person
  schickt sie nie (422). Geprüft wird zur Erfassungszeit des Eintrags (Change
  `y18v58dt-pat-kern`, D7): eine danach entlassene Kraft bestätigt einen vorgemerkten Eintrag
  weiter, ohne bestimmbare Einsatzzeit gilt „aktiv jetzt“. Ein vorgemerkter Eintrag nimmt die
  Angabe in der Warteschlange mit. Im Client nur über `geraet/BestaetigtVonFeld.tsx`, ohne
  Vorauswahl; die Hülle hält die Liste beobachtet (`useKeepBestaetigerLoaded`), sonst wäre sie
  ohne Netz leer, sobald der Cache sie nach dem letzten Paneel geräumt hat (nur im Speicher des
  Tabs). ETB-Text und Verlauf nennen „bestätigt: Name“, Erfasser bleibt das Gerät.
- **Nichts auf der Platte** (design.md D8 der LFH-892): kein Lagebild
  (`offline/lagebildSitzung.ts` überspringt Geräte), keine gemerkte UHS; die
  Schreib-Warteschlange bleibt an (`useOfflineSync` in der Hülle). Ohne Netz merkt das UHS-Gerät
  Aufnahme, Nachsichtung, Verbleib, Notiz, Transport, Maßnahme und Verletzung einer schon
  geladenen Person vor (Spec `feldgeraet-bedienung`). Die Warteschlange hält dafür deren
  Eingaben samt Notiztexten auf dem Gerät, bis sie übertragen oder verworfen sind, wie beim
  Anlegen; auch ein Ende der Kopplung räumt sie nicht (Beweissicherung, Fristen in
  `frontend/src/offline/AGENTS.md`, „Gerätedaten beim Abmelden“). Was nicht im Speicher des Tabs
  geladen ist, geht ohne Netz nicht.
- **Kopfzeile und Navigation** (`geraet/GeraeteKopf.tsx`): Stelle, Gerät, Verbindung und
  Kopplungsende stehen immer, unter einer Stunde mit Wort und Farbe; ohne Netz der jüngste
  Datenstand. Den Namen der Stelle liest `useStellenName` (`geraet/stellenName.ts`) aus der live
  geführten Abfrage der Stelle (Verpflegungsstelle aus `GET …/verpflegung`), `geraet.stelle` aus `/me` nur als Rückfall: die Sitzung lädt nach
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
  Inhalt ab (Nachweis `e2e/geraet-lagemonitor.spec.ts`). Ohne Kartengrafik steht in der Kachel
  „Lagekarte“ nur der Zustand, der Rest des Monitors läuft weiter (LLH-1377, Regel in
  `pages/lagekarte/AGENTS.md`, „Karte ohne Grafik“).
- **Bereitstellungsraum** (LFH-1042): Startseite ist der eigene Raum, die geteilte
  `BrDetailPage` unter `/geraet/:id/br/:brId` (`GeraetBr` hält die Kennung beim eigenen); ohne
  `br-verwalten` kein Umschalter, kein Auflösen und Stornieren, kein gemerkter Raum. Den Verlauf
  des eigenen Raums liest das Gerät mit (`…/bereitstellungsraeume/{bid}/verlauf`, Spec
  `funktionsansichten`, LLH-1095), erst beim Aufklappen (`pages/bereitstellungsraum/BrVerlauf.tsx`);
  ein Wechsel nennt den anderen Raum mit Bezeichnung, dessen Detail und Verlauf bleiben 404.
  Material des eigenen Raums liest es nur (LLH-1252, Entscheidung 22.10.2026, `br-material`):
  `GET …/material` steht in der Routenliste, der Handler schneidet für jedes Gerät auf `br_id` =
  eigener Raum (`stelle::sicht`), die Sektion „Material“ steht ohne Bedienung. Zuordnen, Lösen,
  Status, Ausgeben und Erfassen bleiben der Führungsstelle; ein Schreibweg käme als eigener
  Listeneintrag mit Stellenprüfung auf Quelle und Ziel.
  `br-eintreffen` (LLH-1075, design.md D14, nur Ansicht `bereitstellungsraum`) öffnet
  „Eintreffen buchen“ (`pages/bereitstellungsraum/EintreffenDialog.tsx`, am Gerät vollflächig) und
  ist die einzige Stelle, an der ein Gerät Einheiten und Fahrzeuge anlegt („Unangemeldet buchen“);
  Übernehmen und Abweisen bleiben der Führung und erscheinen am Gerät nie. Die Suche kennt nur
  Kräfte des Einsatzes, keine Stammdaten. Erwartete Kräfte aus Nachforderungen mit Ziel = eigener
  Raum (LLH-1387, Gruppe „Aus Nachforderungen“) liest das Gerät nur über
  `…/bereitstellungsraeume/{bid}/erwartet` (Projektion `nachforderung::erwartet`, von den Freitexten
  nur Art und Rufnamen); `GET …/nachforderungen` und `nachforderungen` in den Lese-Modulen bleiben
  gesperrt. Beim Buchen trägt `nachforderung_id` den Verweis an die Einheit; eine Stufe schaltet
  das Gerät nie. Ohne Netz merkt der Dialog vor (Teil III; Regeln in
  `frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“). Abrufen ist eine Führungsentscheidung
  (LLH-1085): `br-abrufen` ist an keinem Gerät wahr, „Abrufen“, „Abrufen und austragen“ und „Abruf
  zurücknehmen“ fehlen dort. Das Gerät sieht abgerufene Kräfte live unter „Abgerufen“ (ohne Ton,
  Entscheidung 15.10.2026) und bucht „Ausrücken buchen“ als Austritt über `…/belegung`; „Austragen“
  steht an Desktop und Gerät im Aktionsmenü der Zeile. Meldungen an
  die Einsatzleitung baut nur `geraet/GeraetMeldungen.tsx` (UHS-Laptop, Abschnitt, Bereitstellungsraum,
  Verpflegung); das Navigationsziel heißt bei Abschnitt, Bereitstellungsraum und Verpflegung „Melden“.
  Neben der Priorität wählt die `Segmentleiste` „Art“ zwischen Meldung und Lagemeldung (LLH-1031):
  Lagemeldung sendet `meldungsart = 'lagemeldung'` auch mit Priorität sofort, Meldung wie bisher
  (`sofortmeldung` bei sofort, sonst `sonstige`); nach dem Senden steht wieder „Meldung“. Der
  Server macht die Lagemeldung lagerelevant; das Gerät bekommt dafür keine neue Route, keine Liste
  der Lagemeldungen, keine Kenntnisnahme und keinen Zähler (Nachweis `tests/geraet_kopplung.rs`).
- **Verpflegung** (LFH-1044): einsatzweit oder an einer Verpflegungsstelle (LLH-1048, s. u.),
  Startseite ist die geteilte
  `VerpflegungPage` unter `/geraet/:id/verpflegung`; ohne `verpflegung-planen` kein Anlegen,
  Bearbeiten, Löschen. Eine Fehlmenge geht als Meldung an die Einsatzleitung (`meldungVorbelegung`,
  `?inhalt=` auf der Meldungsseite), nie als Nachforderung; eine Ausgabe mit `nachforderung_id`
  lehnt der Server für jedes Gerät mit 403 ab. Ohne Stelle steht die Ansicht als Absender.
  Gezählt wird auf der Unterseite `/geraet/:id/verpflegung/:zeitfensterId/ausgabe`
  (`GeraetVerpflegungAusgabe`, LLH-1032); die Startseite bleibt die Liste, das Navigationsziel
  „Verpflegung“ bleibt dort aktiv (`NavLink` ohne `end`). Karte und Ansicht wählen den Pfad über
  `EinsatzPfade` (`verpflegung`, `verpflegungAusgabe`), nie über `useAuth().geraet`; eine neue
  Serverroute gibt es dafür nicht.
  Stellen (LLH-1040 Teil II): das Gerät liest die Verpflegungsstellen (Ansicht „Stellen“) und
  wählt beim Buchen eine (Stellenwahl der Ausgabeansicht, Feld „Stelle“ im Nachtrag), plant sie
  aber nicht: ohne `verpflegung-planen` gibt es weder „Stelle anlegen“ noch Zeilenaktionen, und
  die Ortszeile zur Koordinate fehlt (`fremde-module`). Die Wahl wird am Gerät nicht gemerkt.
  **An einer Stelle** (LLH-1048 Teil I, Server; Spec `funktionsansichten`, „Verpflegungsgerät an
  einer Verpflegungsstelle“): die Kopplung nimmt wahlweise eine geplante oder aktive
  Verpflegungsstelle. Gebunden schneidet `verpflegung::stellensicht` die Lesung nach der
  Deckungsrechnung zu: Zeitfenster der Stelle und einsatzweite, Soll/Ist/Fehlmenge des ganzen
  Zeitfensters, im Einzelnen nur die eigene Stelle (`ausgaben`, `je_stelle`, `stelle_ids`,
  `stellen`), Ausgaben anderswo nur als `verpflegt_anderswo` (Kennung der Einheit und Menge,
  gepinnt in `tests/geraet_kopplung.rs`). Gebucht wird immer an der eigenen Stelle (ohne Angabe
  setzt der Server sie, eine andere 403), ein Zeitfenster nur fremder Stellen und eine fremde
  Ausgabe sind 404; der Replay läuft vor der Zeitfensterprüfung. Absender und Erfasser ist die
  Stelle über den Anzeigenamen des Gerätekontos und `geraet.stelle`. Oberfläche (LLH-1048 Teil
  II): die Kopplungsmaske liest das Feld aus `stellenFeldVon` (`stellenart` und `stelle_pflicht`);
  eine wahlweise Stelle hat die Vorgabe „ohne Stelle (einsatzweit)“ als eigene Option (kein
  Löschkreuz, Handschuh), zur Wahl stehen die Stellen aus `GET …/verpflegung`. Am gebundenen Gerät
  steht die Stelle fest (`verpflegung/stellenKern.ts:eigeneStelle`): keine Stellenwahl in
  Ausgabeansicht und Nachtrag, jedes Bündel trägt sie; „Noch nicht verpflegt“ verrechnet
  `verpflegt_anderswo` nur so, wie der Server es liefert. Eine geplante Stelle mit laufender
  Kopplung (wartend oder aktiv) storniert der Server nicht (409 „Gerät gekoppelt“, Feld
  `geraet_gekoppelt` der Stelle, Nachweis `tests/geraet_kopplung.rs`).
  `Funktionsansicht::ohne_personenbezug` (Lagemonitor, Verpflegung) nimmt Bearbeiter- und
  Bestätigernamen aus den Meldungen und die Freitexte aus dem Einsatzkopf. Empfänger einer Ausgabe
  (LLH-1055) liest das Gerät nur aus der Projektion `empfaenger` in `GET …/verpflegung`, **nie**
  `GET …/einheiten` (bleibt 403); Einheitennamen sind keine Namen von Einsatzkräften, Führer- und
  Mitgliedernamen bleiben draußen; Lese-Module und Routenliste `VERPFLEGUNG` unverändert. Das
  Gerät wählt den Empfänger wie der Stab (Ausgabeansicht und Nachtrag) und zeigt daraus „Noch
  nicht verpflegt“; gemerkt wird auch der Empfänger nicht. Den
  Einsatzleiter am Einsatzkopf bekommt keine Gerätesitzung (LLH-1168, `src/routes/einsatz.rs::detail`).
  Einsatzweite Zähler für Meldungen und Personen bekommt kein Gerät, auch ohne Stelle
  (`modul_zaehler.rs`).

**Meldungsmodell (LLH-1027, Entscheidung 21.10.2026) — Zielbild, gilt ab LLH-1066; bis dahin gilt
das Bestehende**

Begriffe und Datenfluss: `docs/design/2026-10-21-meldungsmodell/README.md`. Das Ticket, das einen
Punkt baut, schreibt die Regeln oben fort und streicht ihn hier.

- **Keine Korrektur am Gerät (LLH-1066):** der PATCH einer Meldung steht in keiner Routenliste;
  Art, Priorität, Bezug und Lage-Angaben korrigiert nur die Führung.
