# Design

## Context

- `pages/fuehrung/offeneVorgaenge.ts:139` `vorgangsMeldungen` sortiert `istAlarmiert` → `neu` →
  Eingang aufsteigend → id. `istAlarmiert` greift erst bei überfälliger Bestätigung oder
  Eskalation. Die drei sichtbaren Einträge (`VORGAENGE_JE_ABSCHNITT`) sind dann die ältesten.
  Live ist nicht die Ursache: das Ereignis `meldung` macht `einsatz-meldungen` ungültig.
- Sofort heißt Art Sofortmeldung **oder** Priorität sofort (`istSofort`,
  `meldungen/meldungKorrekturKern.ts:80`, wie am Server `MeldungAnzeige::ist_sofort`).
  `prioRang` (`kommunikation/phase.ts:32`) und `prioTon` (`kommunikation/kartenKante.ts:61`)
  gibt es schon.
- Die Meldungszeile im Paneel (`OffeneVorgaengePaneel.tsx` ~302) hat genau einen Wortplatz rechts:
  „Bestätigung überfällig“ oder das Statuswort.
- Erinnerung: Abschnitt „Erinnerungen“ schreibt `ist_faellig ? wort('fällig','achtung')`, die Marke
  (`ueberblickDaten.ts` `markenBewertung`) `abstand <= 0 → {alarm, 'überfällig'}` für jede Art außer
  Lagebesprechung (dort schon eine gemeinsame Funktion, LFH-859).

## Goals / Non-Goals

**Goals:** Sofort/Dringend ab Eingang oben und benannt; ein Zustand einer Erinnerung, ein Wort,
ein Ton im Überblick.

**Non-Goals:** Die Folge im Modul Meldungen (`vergleicheMeldung`) bleibt; der Modulzähler bleibt;
Alarmzeile „Was brennt“ (LLH-1743, Welle 2) ist nicht Teil davon.

## Decisions

1. **Rangfolge in `vorgangsMeldungen`:** Stufe = 0 alarmiert, 1 sofort (`istSofort`), 2 dringend
   (`prioritaet === 'dringend'`), 3 übrige. In Stufe 1 und 2 Eingang absteigend (neueste zuerst),
   in Stufe 0 und 3 wie bisher (`neu` vor anderen, älteste zuerst). Eine neue reine
   Hilfsfunktion `meldungsStufe(m)` neben der Sortierung.
   *Verworfen:* die Folge des Moduls (`vergleicheMeldung`) in einen Kern heben. Dann stünden
   Normalmeldungen neueste zuerst (gegen „Älteste zuerst“ des Überblicks), und eine alarmierte
   Normalmeldung stünde hinter jeder Sofortmeldung.
   *Verworfen:* nur Sofort hochziehen. Der Auftrag nennt Sofort und Dringend.
2. **Ein Wortplatz, Vorrang statt zweitem Etikett:** Der Platz rechts zeigt in dieser Folge:
   „Bestätigung überfällig“ (alarm) → „SOFORT“ (alarm) → „DRINGEND“ (achtung) → Statuswort. Ton
   aus `prioTon`. So bleibt die Zeilenbreite gleich (Spec `ueberblick-vorgaenge-cls`); den Status
   zeigt das Modul. Die Alarmkante bleibt `istAlarmiert` vorbehalten: eine frische Sofortmeldung
   ist ein Signal, aber noch kein Versäumnis.
   *Verworfen:* `PrioBadge`/`StatusChip` als zweites Element. Braucht Höhe und Breite in der
   engen Zeile und steht neben dem Statuswort doppelt.
3. **Erinnerung: eine Funktion.** `erinnerung/erinnerungZustand.ts` mit
   `erinnerungZustand(e, jetzt): { wort: 'fällig' | 'bald'; ton: 'achtung' | null }`. Fällig heißt
   `ist_faellig` oder `faellig_at <= jetzt`. Damit wird eine Erinnerung im laufenden Überblick
   gleichzeitig mit der Marke fällig, ohne Neuabruf. `markenBewertung` liest sie für
   `art === 'erinnerung'` bei verstrichener Zeit (wie heute für die Lagebesprechung), der
   Abschnitt „Erinnerungen“ liest sie für sein Wort. Vor der Fälligkeit bleibt die Marke bei
   „in 23 min“.
   *Verworfen:* fällige Erinnerungen aus den „Nächsten Marken“ nehmen. Dann ist die Liste nicht
   mehr die vollständige Fristenfolge. *Verworfen:* alles auf „überfällig“/alarm. Widerspricht der
   Spec (Erinnerung ist kein Alarm-Eintrag) und belastet das Alarmbudget (EEMUA 191).
4. **Erinnerungskarte im Modul bleibt vorerst Alarm.** Am Phase-1-Checkpoint war auch die
   Modulkarte vorgesehen. Beim Entwurf zeigte sich: Ihr Alarm hängt an zwei Stellen, am
   Kartenrand-Vertrag `KommKarte`/`kartenKante` (kennt nur alarm/unbearbeitet, keine Achtungskante)
   und an der Spec `deeplink-hervorhebung` („eine fällige behält ihre Alarmfläche“). Das ist eine
   eigene Entscheidung über alle Kommunikationskarten. Sie wird als Folgeaufgabe angelegt, nicht
   hier gebaut. Der Widerspruch „auf einer Seite“ ist mit dieser Change behoben.

## Risks / Trade-offs

- [Status einer Sofortmeldung im Überblick nicht mehr sichtbar] → Das Wort SOFORT ist die
  dringlichere Aussage; nach Bestätigung bleibt die Meldung trotzdem Sofort, der Deeplink führt
  ins Modul mit Status.
- [Mehr als drei Sofortmeldungen verdrängen eine alte Normalmeldung] → gewollt; die Zahl im
  Abschnittskopf bleibt vollständig.
- [Alarmbudget] → Das Wort SOFORT in Rot steht nur an Sofortmeldungen, die ohnehin den
  Sofortalarm auslösen; keine Kante, keine Fläche.
