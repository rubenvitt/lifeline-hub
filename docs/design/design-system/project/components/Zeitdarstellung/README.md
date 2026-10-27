# Zeitdarstellung (taktisch und Datum mit Uhrzeit)

**Zeitdarstellung** (LLH-1053, Spec `zeitdarstellung`, Entscheidungen E1–E4 aus LLH-1045): eine
Zeit für Menschen formatiert nur `anzeige/zeitDarstellung.ts`, in drei Rollen — `zeitpunkt`
(`101430okt26` bzw. `10.10.26 14:30`), `zeitKurz` (heute `1430`, sonst `091430` bzw. `14:30` /
`09.10. 14:30`) und `uhrzeit` (`1430` bzw. `14:30`, nur wo der Tag aus dem Zusammenhang folgt);
in Komponenten über `ZeitAnzeige rolle=…` oder die gebundenen Rollen aus
`useAnzeigeKonventionen()`. Die volle DTG schreibt Monat klein ohne Umlaut und das Jahr
zweistellig (FwDV/DV 810, Ausgabe 2018, Teil I 5.1.1.12). Die Darstellung (`taktisch`,
Vorgabe, oder `datum_uhrzeit`) steht in den Konventionen; wirksam ist Gerät vor Einsatz vor
Organisation vor Vorgabe (`wirksameZeitdarstellung`), die Gerätewahl liegt in
`anzeige/zeitDarstellungStore.ts` (Profil „Darstellung auf diesem Gerät“, Sprungpalette).
**Der Druck nimmt nie die Gerätewahl:** die Provider in `AnzeigeKonventionenContext.tsx` lassen
sie unter `useDruckModus` weg. Ausnahmen: Uhr im Kopf (Gerätezeit) und Dauern. Kein
`.format('…')` und kein `formatiere(…, '…')` mit `HH`/`mm`/`DD`/`YYYY` außerhalb von `anzeige/`
(Maschinenformate ab `YYYY-MM-DD` ausgenommen); Wächter `anzeige/zeitDarstellung.guard.test.ts`,
Schuldmenge `OFFEN` seit LLH-1061 leer. Titelvorschlag und Startinhalt eines Lagevortrags werden
gespeichert und nehmen `konventionenOhneGeraet` (Einsatz vor Organisation, ohne Gerätewahl, wie
Druck und Servertexte; LLH-1437); ein Eingabefeld zeigt seinen Wert taktisch. Nebenformen im Kern:
`datum`/`kalendertag` (Tag ohne Uhrzeit, `10okt26` bzw. `10.10.26`), `uhrzeitOhneDatum`
(Wanduhrzeit `HH:MM` ohne Tag: Verpflegungsplan, Wechselzeiten), `tagUndUhrzeit` (Anfang eines
Zeitraums), `leereUhrzeit` (Lücke in Ziffernbreite); „heute“ einer Nebenzeit (Nachtrag, Übergabe,
Zeitraumende) über das `jetzt` von `zeitKurz`. Der Datenstand rechnet in Gerätezeit
(`components/Datenstand.tsx`), die Uhr des Lagemonitors nimmt `formatiereUhr` der Kopfleiste.

Quelle: `frontend/src/anzeige/zeitDarstellung.ts` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
