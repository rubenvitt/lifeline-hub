# Paneel

Paneel — die Grundfläche für Seitenleisten, Kachel-Paneele und Listenblöcke.

Rahmen `linie`, Grund `paneel`, Kopf 38 px mit Augenbraue links und optionalem Mono-Meta bzw.
einer Aktion rechts, Haarlinie darunter, Radius 0. Der Körper trägt keine eigene Polsterung —
Zeilen bringen sie mit (Trenner `flaeche3`, siehe `paneelZeileStil`); wer Fließinhalt
hineinlegt, setzt `koerperPolster`.

Die Überschrift ist SEMANTISCH (`ueberschrift="h2"` … `"h6"`), die Augenbraue nur ihre Optik;
das `<section>` wird über sie benannt (`aria-labelledby`). Die Ebene folgt der Gliederung:
ein Paneel in einem Paneel ist eine Ebene tiefer, sieht aber gleich aus. Ein Paneel ohne
Überschrift gibt es nicht.

Die 38 px sind eine MINDESThöhe: steht rechts eine Aktion, wächst der Kopf mit deren
Dichte-Staffel mit.

ENGER KOPF: der Kopf BRICHT UM (`flexWrap`), der rechte Block rückt als Ganzes in eine zweite
Zeile und bleibt rechtsbündig (`marginInlineStart: auto`); reicht selbst die nicht, kürzt das
Meta mit Auslassung (`paneelMetaStil`), die Aktion nie — ein abgeschnittener Link ist kein
Ziel. Das volle Meta steht dann im `title`, wenn es ein Text ist.

Quelle: `frontend/src/components/instrument/Paneel.tsx` im Repo `rubenvitt/lifeline-hub`. Die Vorschau ist aus
dem echten Baustein gerendert, mit dem antd-Theme der App, Nacht und Tag, Dichte `kompakt`.
