# Körperschema (Lesen)

Der Baustein „Körperschema“ (LLH-1120, Spec `koerperschema`, design.md D13): Verletzungen einer
Person auf einer Figur nach Geschlecht, vorn und hinten, mit nummerierten Sternchen und der
Liste als zweitem Kanal daneben.

MARKIEREN MIT ZWEI TIPPS: der erste Tipp auf eine Region öffnet daneben die Wahl der Art als
Flächen (`FlaechenWahl`), der zweite auf eine Fläche speichert, mit der Tippstelle als Lage
(`sternLage`: außerhalb der Silhouette der Mittelpunkt der Region). Die Schwere ist optional und
steht als Segmentleiste über den Flächen; sie kostet keinen Pflichttipp. Ein Tipp auf ein
Sternchen bietet „Aufheben“ an, der zweite hebt auf. Eine Ablehnung bleibt am Schema stehen, die
Wahl offen; Einhängen und Abbrechen räumen sie (LFH-1077). Jede Region beginnt ohne Schwere.
Nach Speichern, Aufheben und Abbrechen kehrt der Fokus an die Region bzw. das Sternchen zurück.

LAYOUT nach der gemessenen Breite (`schemaLayout`): vorn und hinten stehen nur nebeneinander,
wenn die Spalte daneben mitpasst, sonst eine Ansicht mit Umschaltung. Die Wahl der Art steht
neben der Figur und klebt unter dem Rahmen, damit sie nach dem Tipp ohne Bildlauf im Bild steht,
auch in der Handschuh-Stufe am Tablet; reicht die Breite nicht einmal dafür, steht sie darunter
und rückt nach dem Tipp ins Bild. Die Figur schrumpft beim Markieren nie unter ihren Maßstab,
sie rollt waagerecht (Trefferzonen halten die Stufe).

Die Mutationen hält der Aufrufer (Patientenkopf: Wechselsperre, ein Schreibweg je Handlung);
am UHS-Gerät nennt `BestaetigtVonFeld` die bestätigende Person.

LESEN UND DRUCK zeigen Figur und Liste ohne Bedienung; der Druck zeichnet ohne Fläche in
`currentColor` (schwarz auf weiß), vorn und hinten immer nebeneinander.

Quelle: `frontend/src/personen/koerperschema/Koerperschema.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
