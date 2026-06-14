-- Polymorpher Sachbezug einer Chat-Nachricht (LFH-103): optionaler Verweis auf ein
-- bereits bestehendes Domänenobjekt (Lageobjekt: schaden/uhs/person/lagebericht;
-- sowie meldung/auftrag). Anders als die Heraufstufungs-Rückverweise
-- (etb_eintrag_id 0043, auftrag_id 0051) wird hier NICHTS erzeugt, sondern auf ein
-- vorhandenes Objekt referenziert — daher bewusst getrennte Spalten.
--
-- Polymorph wie kommunikation_zustellung (0045): KEIN DB-FK auf die Zieltabelle.
-- Integrität und Einsatz-Isolation prüft der Code beim Setzen (repo::bezug_setzen,
-- Muster anlegen_mit_anhaengen). both-or-neither (bezug_typ und bezug_id gemeinsam
-- gesetzt bzw. gemeinsam NULL) und die Typ-Allowlist werden ebenfalls im Code
-- erzwungen (analog auftrag.prioritaet/meldung.status) — ein DB-CHECK ließe sich
-- per ALTER TABLE ADD COLUMN ohnehin nicht nachrüsten.
ALTER TABLE chat_nachricht ADD COLUMN bezug_typ TEXT;
ALTER TABLE chat_nachricht ADD COLUMN bezug_id INTEGER;
