-- LFH-461: dieselbe Person kann in jedem Einsatz eine andere Führungsstelle haben.
ALTER TABLE einsatz_mitgliedschaft ADD COLUMN fuehrungsstelle TEXT;
