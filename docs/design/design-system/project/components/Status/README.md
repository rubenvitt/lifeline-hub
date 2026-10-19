# StatusZelle, StatusChip und StatusTag

Quelle: `frontend/src/components/instrument/Status.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.

StatusZelle und StatusChip — Status als getönte Fläche (Neuentwurf S1 „Statuszelle",
S2 Abschnittsraster, S6 Einheitenliste). Die Farbwerte und ihre Kontrastrechnung stehen
in `statusFlaeche`; hier wird nur angeordnet.

DER ZWEITE KANAL IST PFLICHT, und zwar im Typ: `wort` ist ein Pflicht-Prop. Die Zelle
zeigt oft nur eine Zahl (die Legende über dem Raster bzw. im Spaltenkopf nennt die Bedeutung
fürs Auge); deshalb trägt sie das Wort unsichtbar hinter der Zahl und als `title` — ein
Vorleser hört „2 bereit", nicht „2".

KEIN Bedienziel: beide sind Anzeige. Wer eine Zelle klickbar braucht, legt einen Link
oder Knopf DARUM (mit den zwei Angaben aus LFH-365), statt hier einen `onClick` zu
erwarten.
