-- LLH-1649: Der Spiegel räumt seine Bruchstelle, wenn beim Führer geschwärzt wird.
--
-- `einsatz.schwaerzung_marke` bekommt bei jeder Schwärzung am Einsatz einen neuen Zufallswert:
-- eine Datenkategorie, ein Löschersuchen je Person, die Schwärzung des ganzen Einsatzes. Der Kopf
-- wird gespiegelt, die Marke reist also mit der nächsten Lieferung. Bringt sie eine andere Marke
-- als die eigene, räumt der Spiegel seine ganze `einsatz_bruchstelle` und fragt nicht mehr
-- (`einsatz_spiegel.bruch_offen = 0`), wie der Führer es bei jeder Schwärzung tut (LLH-1641).
-- Eine Marke statt eines Zählers: Schwärzen zwei Seiten während einer Trennung je einmal, stünden
-- zwei Zähler gleich, zwei Marken nicht. NULL: nie geschwärzt.
ALTER TABLE einsatz ADD COLUMN schwaerzung_marke TEXT;
