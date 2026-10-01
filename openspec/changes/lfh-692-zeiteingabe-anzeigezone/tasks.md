# Tasks

Jede Aufgabe entsteht per TDD. Zonentests sind nur scharf, wenn Browser- und Anzeigezone
verschieden sind (D8): Entweder setzt der Test `process.env.TZ='UTC'` und nimmt Europe/Berlin als
Anzeigezone, oder er nimmt die Suiten-Zone Berlin und eine andere Anzeigezone. „Mutationsprobe“
heißt: den Baustein vorübergehend auf `.local()` zurückdrehen, der Test muss dann rot werden.

## 1. Wandlungskern und Bausteine (`anzeige/`)

- [x] 1.1 Reine Funktionen in `anzeige/zeitEingabe.ts` anlegen: `alsZeitpunkt`, `alsBackendZeit`
      (umgezogen), `zuWanduhr`, `ausWanduhr`, `heuteInZone` und `istZukunftstag`.
      `zeitEingabe.test.ts` deckt unter TZ=UTC mit Anzeigezone Europe/Berlin Hin- und Rückweg
      ab, dazu beide Umstellungen 2026, die doppelte Stunde, eine ungültige Zone (Rückfall auf
      den Browser) und die nicht darstellbare Wanduhr. Gegenprobe unter Berlin mit Anzeigezone
      UTC. Erledigt, wenn der Test grün ist.
- [x] 1.2 `useZeitEingabe()` sowie `ZeitpunktEingabe` und `ZeitraumEingabe` bauen: Zeitpunkt
      hinein und heraus, `showNow` aus, eigener Knopf „Jetzt“ und Zonenhinweis im Panel-Fuß,
      Zonenhinweis am Feld nur bei Abweichung, Prop `keineZukunftstage`. Komponententests unter
      TZ=UTC prüfen: Anzeige 12:00 für 10:00 UTC, Eingabe 13:00 ergibt 11:00 UTC, „Jetzt“, und
      der Hinweis erscheint bzw. fehlt.
- [x] 1.3 `OrgAnzeigeProvider` am bestehenden Query-Key `globalKeys.orgEinstellungen` anlegen
      (geteilt mit den Einstellungsseiten; bei 403 oder Fehler gelten die Defaults). Test: die Zone kommt aus den Org-Einstellungen, bei 403 aus
      dem Browser. `queryKeys.guard.test.ts` bleibt grün.

## 2. Verpflegung (Referenzfall LFH-634)

- [x] 2.1 `verpflegung/VerpflegungDialoge.tsx` auf `ZeitraumEingabe` und `ZeitpunktEingabe`
      umstellen, `alsOrtszeit` wird `alsZeitpunkt`. Integrationstest unter TZ=UTC mit
      Anzeigezone Europe/Berlin prüft die drei Akzeptanzkriterien:
      - der Bearbeiten-Dialog zeigt 12:00–13:30 wie die Karte,
      - Speichern mit nur geändertem Bedarf sendet keinen Zeitraum,
      - eine Eingabe von 13:00–14:30 sendet `11:00:00`–`12:30:00` (über das Anlegen: in jsdom
        übernimmt antds RangePicker eine Tastatur-Korrektur an einem schon belegten Zeitraum
        nicht ins Formular, auch ohne Baustein gemessen; die Wandlung ist dieselbe).
      Die Mutationsprobe macht den Test rot.
- [x] 2.2 `verpflegung/useBedarfsvorschlag.ts`: die Stand-Zeit über die Konventionen
      formatieren. Ein Test prüft die Uhrzeit unter abweichender Zone.

## 3. ETB

- [x] 3.1 `etb/EtbFilterleiste.tsx`: von/bis über `ZeitpunktEingabe`. `etb/filterZeit.ts` reicht
      nur noch weiter, `filterZeit.test.ts` bleibt grün. Neuer Test: Der Filter von 08:00
      Anzeigezone ergibt denselben Wire-Wert, den `druckAuswahl` als 08:00 druckt.
- [x] 3.2 `etb/WiedervorlageModal.tsx`: Feld, Vorbelegung (jetzt + 30 min) und
      Termin-Schnellwahl über den Baustein. Das Inline-`utc().format` wird `alsBackendZeit`.
      Ein Test prüft unter abweichender Zone, dass die Schnellwahl auf den Lagebesprechungstermin
      den exakten Wire-Wert setzt.
- [x] 3.3 `etb/MetaChip.tsx` und `etb/entwuerfe/entwurfModell.ts`: Chip-Text und Picker
      laufen über die Zone, der wiederhergestellte Entwurf zeigt 1200 statt 1000 (Szenario
      „Wiederhergestellter Entwurf“). Die Tests von `schnellerfassungModell` und
      `entwurfModell` bleiben grün, dazu kommt ein neuer Test für den Chip.

## 4. Kräfte, Ablösung, Betreuung, Personen

- [x] 4.1 `kraefte/KraftZeitachse.tsx`: `ZeitpunktEingabe keineZukunftstage`. Ein Test prüft
      das Szenario „Zukunftstag nach Kalender der Anzeigezone“.
- [x] 4.2 `abloesung/AbloesungDialoge.tsx`, beide Felder: Test unter abweichender Zone für die
      Eingabe 13:00 und den gesendeten Wert.
- [x] 4.3 `betreuung/BetreuungDialoge.tsx`: `zeitpunktFeld()` auf den Baustein mit
      `keineZukunftstage` umstellen, `zeitRegel` bleibt am Zeitpunkt. Test unter abweichender
      Zone, die bestehenden Betreuungstests bleiben grün.
- [x] 4.4 `personen/LagedatenFelder.tsx` (`VermisstSeitFeld`): `getValueProps`/`normalize`
      über `alsZeitpunkt`/`alsBackendZeit` und den Baustein. Test: Speichern ohne Änderung
      lässt den Wire-String gleich.

## 5. Führung, Kommunikation, Stab

- [x] 5.1 `meldungen/MeldungFormular.tsx`, `erinnerung/ErinnerungFormular.tsx` und
      `auftraege/AuftragFormular.tsx`: die `dayjsZuWire`-Kopien entfernen, die Felder laufen
      über den Baustein. Je Formular ein Test unter abweichender Zone für den gesendeten Wert.
- [x] 5.2 `kommunikation/gruppierung.ts:faelligGruppe` bekommt die Konventionen, die Aufrufer
      `AuftraegeListe` und `ErinnerungenPage` reichen sie durch. Ein Test prüft das Szenario
      „Frist heute“.
- [x] 5.3 `stab/LagebesprechungModal.tsx` und `stab/lagebesprechungZustand.ts`:
      `terminZeitpunkt` ohne `.local()`, Felder und Schnellwahl über den Baustein, formatierende
      Aufrufer über `inZone`. `lagebesprechungZustand.test.ts` bleibt grün, neuer Test für das
      Modal unter abweichender Zone.
- [x] 5.4 `infotelefon/AnrufErfassung.tsx`, `pages/PressePage.tsx`,
      `pages/PressemitteilungDetailPage.tsx`, `pages/LageberichtDetailPage.tsx` und
      `pages/LageberichtePage.tsx`: Felder über den Baustein, Titelvorschlag in der
      Anzeigezone (Szenario „Titelvorschlag“). Je Seite ein Test für den gesendeten Wert,
      `LageberichtDetailPage.test.tsx` bleibt grün (der LFH-499-Block läuft jetzt unter TZ=UTC
      und ist damit scharf). Beim Umstellen gefunden und mitgenommen: „zuletzt gespeichert“ des
      Entwurfsschutzes (`entwurf/useEntwurfVerlustschutz.ts`) in der Anzeigezone.

## 6. Einsatz, Einstellungen, Aufbewahrung

- [x] 6.1 `pages/EinsatzdatenPage.tsx`: `wireZuPicker`/`pickerZuWire` entfallen, Zeile und
      Vollformular laufen über den Baustein. Die bestehenden Tests zu den Umstellungen bleiben
      grün, neu ist das Szenario „Browser in anderer Zone“ (Delta
      `einsatzdaten-bearbeitung`).
- [x] 6.2 `pages/EinsaetzePage.tsx` unter `OrgAnzeigeProvider`, die Alarmzeit über den
      Baustein. Test für das Szenario „Einsatz anlegen“ (Org Europe/Berlin, Browser UTC).
- [x] 6.3 `pages/einstellungen/PegelPrognoseModal.tsx` und `pegelPrognoseKern.ts`: Hinweg über
      `alsZeitpunkt`, „Übernehmen“ setzt einen Zeitpunkt. `pegelPrognoseKern.test.ts` bleibt
      grün, neuer Test unter abweichender Zone.
- [x] 6.4 `aufbewahrung/FristPaneel.tsx` und `WiederherstellenDialog.tsx` über den Baustein,
      `ArchivAktePage.tsx` unter dem `EinsatzAnzeigeProvider` des Einsatzes. Test für das
      Szenario „Archivakte“, `fristModell.test.ts` bleibt grün.
- [x] 6.5 `einsatz/EinsatzLayout.tsx`: `AlarmZentrale` unter den Einsatz-Provider legen. Test:
      Die Uhrzeit im Hinweis steht in der Anzeigezone.

## 7. Regel, Guard, Abschluss

- [ ] 7.1 `anzeige/zeitEingabe.guard.test.ts` nach D7 schreiben. Er muss auf dem Stand vor
      Gruppe 2 rot sein (Probe) und am Ende grün.
- [ ] 7.2 `frontend/AGENTS.md`, Abschnitt Inline-Bearbeitung: Die Regel „Zeiteingabe nur über
      `ZeitpunktEingabe`/`ZeitraumEingabe` (`anzeige/zeitEingabe.ts`), Formularwert ist ein
      Zeitpunkt“ ersetzt den Verweis auf `wireZuPicker`/`pickerZuWire`. Verweise per grep
      nachziehen, Prettier ist grün.
- [ ] 7.3 Gesamtlauf `./scripts/check-all.sh` grün, Typecheck und Lint eingeschlossen. Unter
      `TZ_ERZWUNGEN=UTC` läuft zusätzlich `pnpm vitest run src/anzeige src/verpflegung
      src/pages/EinsatzdatenPage.test.tsx` grün.
