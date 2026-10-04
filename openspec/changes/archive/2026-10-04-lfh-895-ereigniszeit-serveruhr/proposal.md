# Proposal

## Why

Die Ereigniszeit eines ETB-Eintrags und einer Meldung ist, wenn niemand eine Zeit einträgt,
„jetzt“ nach der **Geräteuhr**, online wie offline. Geht die Uhr eines Geräts vor, steht der
Eintrag um den Vorlauf zu spät: Die Zeitachse ordnet ihn falsch ein, „nachgetragen“ schlägt
an, obwohl nichts nachgetragen wurde, und bei einer Meldung verschiebt sich die
Rückmeldefrist der meldenden Einheit (`faellig_at` = Ereigniszeit + Frist). Der Server lehnt
dort nichts ab, der Fehler bleibt also still. LFH-705 hat den Versatz zur Serveruhr schon gemessen
(`offline/serveruhr.ts`), ihn aber bewusst nur für vorgemerkte Betreuungsmeldungen genutzt und
diesen Befund als Nachzug ausgeklammert.

## What Changes

- Eine **vorbelegte** Ereigniszeit („jetzt“) gilt nach der Serveruhr, soweit das Gerät seinen
  Versatz kennt: im ETB, wenn kein Zeit-Chip gesetzt ist, bei einer Meldung, wenn das Feld
  „Ereigniszeit“ leer bleibt. Ohne bekannten Versatz gilt wie bisher die Geräteuhr.
- `erfasst_lokal_at` eines ETB-Eintrags folgt derselben Uhr wie die vorbelegte Ereigniszeit,
  denn beide stammen aus demselben Zeitpunkt des Absendens.
- **Was die Person sieht, ist, was gespeichert wird:** Der Zeit-Chip der ETB-Erfassung schlägt
  beim Öffnen die Serverzeit vor, und der Knopf „Jetzt“ jeder Zeiteingabe setzt die Serverzeit.
  Eine Ereigniszeit, die die Person sieht und bestätigt, wird also nie still umgerechnet; nur
  der Vorschlag kommt von der richtigen Uhr.
- Eine **von Hand eingetragene** Ereigniszeit bleibt unverändert.
- Der Server bleibt unverändert und begrenzt Ereigniszeiten in der Zukunft weiter nicht
  (Begründung in `design.md`, D4).

## Capabilities

### New Capabilities

- `ereigniszeit-vorgabe`: Woher die Ereigniszeit eines ETB-Eintrags und einer Meldung kommt,
  wenn die Person keine einträgt, und dass eine eingetragene unverändert bleibt.

### Modified Capabilities

- `zeiteingabe`: Die Anforderung „Jetzt und heute in der Anzeigezone“ setzt beim „Jetzt“ den
  aktuellen Zeitpunkt nach der Serveruhr, soweit der Versatz bekannt ist.

## Impact

- Frontend: `etb/Schnellerfassung.tsx` (Zeitpunkt des Absendens), `etb/MetaChip.tsx`
  (Vorschlag im Zeit-Editor), `meldungen/MeldungFormular.tsx` (leeres Feld = jetzt),
  `anzeige/ZeitpunktEingabe.tsx` („Jetzt“), `etb/bausteinEinsetzen.ts` (`{datum}`,
  `{uhrzeit}`). Regeltext in `frontend/src/offline/AGENTS.md` („Schreiben ohne Netz“), Verweis
  in `frontend/AGENTS.md`.
- Mit wirksam: „Jetzt“ in jeder anderen Zeiteingabe. Dafür messen die Zukunftsprüfungen im
  Client, die an einer Zeiteingabe hängen (`betreuung/BetreuungDialoge.tsx`,
  `personen/LagedatenFelder.tsx`), an derselben Uhr, sonst fiele „Jetzt“ auf einem nachgehenden
  Gerät dort durch. Die Vorbelegung des Nachtrags in der Kräfte-Zeitachse
  (`kraefte/KraftZeitachse.tsx`) nimmt ebenfalls die Serveruhr; sie scheitert auf einem
  vorgehenden Gerät heute an der Uhrentoleranz von 2 min (422).
- Weitere Vorbelegungen „jetzt“ (Auftrag, Einsatzbeginn, Erinnerung, Lagebesprechung,
  Wiedervorlage) stehen als Nachzug LFH-1031 auf dem Board.
- Backend, API, Schema, Migrationen: keine Änderung.
