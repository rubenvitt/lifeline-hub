-- LLH-1649: Der Spiegel räumt seine Bruchstelle, wenn beim Führer geschwärzt wird.
--
-- `einsatz.schwaerzung_marke` bekommt bei jeder Schwärzung am Einsatz einen neuen Zufallswert:
-- eine Datenkategorie, ein Löschersuchen je Person, die Schwärzung des ganzen Einsatzes. Der Kopf
-- wird gespiegelt, die Marke reist also mit der nächsten Lieferung. Bringt sie eine andere Marke
-- als die eigene, räumt der Spiegel seine `einsatz_bruchstelle` wie der Führer bei jeder
-- Schwärzung (LLH-1641): Jede Kopie geht, Geklärtes ganz (`instanz::spiegel::fuehrung`).
-- Eine Marke statt eines Zählers: Schwärzen zwei Seiten während einer Trennung je einmal, stünden
-- zwei Zähler gleich, zwei Marken nicht. NULL: nie geschwärzt.
ALTER TABLE einsatz ADD COLUMN schwaerzung_marke TEXT;

-- Offene Zeilen der Bruchstelle verlieren beim Räumen nur ihre Kopie und werden weiter geklärt;
-- `geraeumt = 1` sagt, dass sie danach ganz gehen, statt als leerer Eintrag stehen zu bleiben.
ALTER TABLE einsatz_bruchstelle ADD COLUMN geraeumt INTEGER NOT NULL DEFAULT 0;
