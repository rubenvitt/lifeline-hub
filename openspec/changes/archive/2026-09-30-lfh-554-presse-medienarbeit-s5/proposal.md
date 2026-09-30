# Proposal

## Why

FwDV 100 (Anlage 2, S. 59) weist dem Sachgebiet S5 diese Aufgaben zu:
- Presse- und Medienlage
- Presseinformationen
- Pressekonferenzen
- Abstimmung mit der Pressestelle der Polizei
- Informationstelefone
- Warn- und Suchhinweise

Die Stab-Spec LFH-46 zeigt für S5 bis heute nur die Besetzungszeile, im Code gibt es dazu nichts.
Im Stabsraum führt S5 deshalb eine Strichliste auf Papier:
- Wer hat angefragt, und was wurde gesagt?
- Wer hat die Aussage freigegeben?
- Welche Pressemitteilung ist draußen?
- Was wollten die Anruferinnen und Anrufer am Bürgertelefon?

In den Lagevortrag geht davon nichts ein, obwohl die Gliederung dort einen eigenen Punkt III
„Medienlage“ vorsieht (DRK RLP, Lagevortrag).

Das Ticket hatte sich selbst gesperrt: nicht vor dem Feldbefund und nicht vor einer
Stabsraum-Version. Beides gibt es noch nicht. Der User hat die Sperre am 30.09.2026 aufgehoben.
Diese Change zielt deshalb ausdrücklich auf den Stabsraum (Führungsstufe C/D, ortsfeste Stelle,
mehrere Arbeitsplätze) und nicht auf das Führungsfahrzeug. Der fehlende Feldbefund steht als Risiko
im Design.

## What Changes

- **Presse-Log** (`/einsaetze/:id/stab/presse`): Medienkontakte des Einsatzes mit drei Arten.
  - Anfrage einer Redaktion
  - Abstimmung mit einer Behörden-Pressestelle
  - Termin: Pressekonferenz, Interview, Dreh vor Ort
  
  Jeder Kontakt trägt Medium, Ansprechperson und Erreichbarkeit (personenbezogen), Thema, Eingang
  und Status. Eine Anfrage wird beantwortet oder abgelehnt, mit der gegebenen Antwort und der
  Angabe, wer die Aussage freigegeben hat. Abstimmungen und Termine werden erledigt. Jeder
  Statusschritt lässt sich eine Stufe zurücknehmen.
- **Pressemitteilungen** als dritte Art des Vorlagendokuments neben Lagebericht und Befehl.
  - Entwurf, Freigabe und Fortschreibung (Folgemeldung) laufen wie bei den beiden anderen Arten.
  - Es gibt vier Vorlagen: Erstinformation, Folgeinformation, Hinweis an die Bevölkerung
    (Warnhinweis) und Freitext.
  - **Freigeben darf nur die Einsatzleitung.** Bei Lagebericht und Befehl darf das jede Person mit
    Schreibrecht, bei der Pressemitteilung nicht.
  - Die Freigabe schreibt den Snapshot ins ETB.
  - Die Mitteilung ist druckbar und hat eine eigene Detailseite
    (`/einsaetze/:id/stab/presse/mitteilungen/:mitteilungId`).
- **Informationstelefon** (`/einsaetze/:id/stab/infotelefon`): ein Protokoll der Anrufe von
  Bürgerinnen und Bürgern.
  - Erfasst wird in einer Schnellerfassung mit Anliegen, Notiz und „Rückruf nötig“.
  - Anrufername, Rückrufnummer und Uhrzeit liegen eingeklappt.
  - Offene Rückrufe lassen sich gezielt anzeigen.
  - Die Zahl der Anrufe je Anliegen steht als Kennzahl über dem Protokoll.
  - Bei Anrufen zur Vermisstensuche führt ein Sprung zu den Vermissten. Einen Abgleich mit den
    Betroffenen gibt es nicht.
- **Medienlage:** Aus den geladenen Listen wird im Client eine Zusammenfassung ohne Personenbezug
  abgeleitet.
  - Sie steht als Paneel auf der Presseseite.
  - Die Vorlage „Lagevortrag zur Information“ bekommt einen neuen Abschnitt **„Medienlage“** vor
    der Zusammenfassung.
  - In diesem Abschnitt setzt „Aus S5 übernehmen“ die Zusammenfassung ein.
- **Einstieg:** Die S5-Zeile der Stabseite trägt zwei Verweise, „Pressearbeit“ und
  „Informationstelefon“. Das folgt dem Muster des Funkplans an S6.
  - Beide Seiten sind keine eigenen Module.
  - Sie erben Sichtbarkeit und Sperre des Stabs.
  - Sie prüfen die Stab-Freigabe selbst.
- **Datenschutz:** Die personenbezogenen Felder stehen in der Schwärzungs-Registry, und nichts
  davon landet im Lagebild-Offline-Speicher. Die Medienlage und der Lagebericht enthalten keine
  Namen, keine Rufnummern und keine Notizen.
- Neue Migration, zwei neue Live-Ereignisse (`presse`, `infotelefon`), Codegen der Response-Typen.

## Capabilities

### New Capabilities

- `stab-presse-log`: Medienkontakte des Sachgebiets S5, also Anfragen, Abstimmungen und Termine.
  Die Capability regelt Erfassung, Statusweg mit Antwort und Freigabeangabe, Rechte und
  Datenschutz.
- `stab-pressemitteilung`: Pressemitteilungen als Vorlagendokument. Die Capability regelt Vorlagen,
  Entwurf, Freigabe nur durch die Einsatzleitung, ETB-Snapshot, Fortschreibung und Druck.
- `stab-infotelefon`: Das Anrufprotokoll des Informationstelefons. Die Capability regelt
  Schnellerfassung, Anliegen, offene Rückrufe, Kennzahlen und Datenschutz.
- `stab-medienlage`: Die abgeleitete Medienlage ohne Personenbezug und ihre Übernahme in den
  Abschnitt „Medienlage“ des Lagevortrags, dazu der Einstieg aus der S5-Zeile.

### Modified Capabilities

_keine_. Für den Lagebericht gibt es keine Capability-Spec unter `openspec/specs/`. Den neuen
Abschnitt regelt `stab-medienlage`. `dokument-uebernahme` und `druck-dokumente` gelten unverändert
auch für die Pressemitteilung.

## Impact

- **Migration** `0129_presse.sql` (nächste freie Nummer, vor dem Merge gegen `origin/alpha`
  prüfen):
  - neue Tabellen `medienkontakt`, `pressemitteilung`, `infotelefon_anruf`
  - neue Spalte `etb_eintrag.pressemitteilung_id`
- **Backend:**
  - neu: `src/presse/`, `src/infotelefon/`, `src/routes/presse.rs`, `src/routes/infotelefon.rs`
  - Vorlagendokument-Kern: Freigabe-Regel je Art (`src/routes/vorlagendokument.rs`)
  - `src/lagebericht/mod.rs`: neuer Abschnitt
  - `LiveEvent`, `api_doc.rs`, Schwärzungs-Registry, `tests/enum_wire_kontrakt.rs`
  - neue Tests unter `tests/`
- **Frontend:**
  - neue Seiten `PressePage`, `PressemitteilungDetailPage`, `InfotelefonPage`
  - `stab/medienlage.ts`
  - Deeplink-Bauer, Routen in `App.tsx`, Einstieg in `StabPage`/`sachgebiete.ts`
  - Query-Keys samt Stream-Zuordnung
  - `lageberichte/vorlagen.ts` und der Lagebericht-Editor (Übernahme-Knopf)
- **e2e:**
  - die drei Routen in Gate 1 und Gate 3, auch als Beobachter
  - Druckfluss der Pressemitteilung
- **Keine** Änderung an Rechten der Rollen oder an Modulfreigaben. Kein neuer Modul-Key, kein
  Modulzähler, keine Offline-Queue.
