-- LLH-1649: Der Spiegel räumt seine Bruchstelle, wenn beim Führer geschwärzt wird.
--
-- `einsatz.schwaerzung_stand` zählt jede Schwärzung am Einsatz: eine Datenkategorie, ein
-- Löschersuchen je Person und die Schwärzung des ganzen Einsatzes. Der Kopf wird gespiegelt, der
-- Zähler reist also mit der nächsten Lieferung. Bringt sie einen höheren Zähler, räumt der Spiegel
-- seine ganze `einsatz_bruchstelle` und fragt nicht mehr (`einsatz_spiegel.bruch_offen = 0`),
-- wie der Führer es bei jeder Schwärzung tut (LLH-1641).
ALTER TABLE einsatz ADD COLUMN schwaerzung_stand INTEGER NOT NULL DEFAULT 0;
