# karten-build/Makefile — Shortbread-MBTiles bau-zeitig erzeugen (VersaTiles-Planetiler).
# Läuft NUR beim Bau, nie in der App. Fertiges Upstream-Image, kein Custom-Dockerfile. Docker nötig.
#
# AREA = Geofabrik-Gebietsname (gegen den Geofabrik-Index gematcht), z. B. "germany" oder "bremen"
#        (NICHT die Pfadnotation "europe/germany/bremen").
AREA   ?= germany
FORMAT ?= mbtiles
OUT    ?= out
IMAGE  := versatiles/versatiles-planetiler:latest

.PHONY: tiles validate
tiles:
	mkdir -p "$(CURDIR)/$(OUT)"
	# LFH-200: Der geteilte sources-Cache (`out/sources/`) darf pro Build nur die AKTUELLE Region als
	# *.osm.pbf enthalten. Der Renumber-Schritt im Image nimmt `find … ! -name renumbered.osm.pbf |
	# head -1` — bei mehreren Region-PBFs immer dieselbe (erste) Datei, sodass `--area` ignoriert wird
	# und JEDER Build dieselbe Region liefert. Also die Region-PBFs (klein, werden neu geladen) +
	# renumbered.osm.pbf vor dem Build entfernen; Wasser-Polygone/Countries/tile_weights bleiben gecacht.
	rm -f "$(CURDIR)/$(OUT)/sources/"*.osm.pbf "$(CURDIR)/$(OUT)/sources/renumbered.osm.pbf"
	docker run --rm -v "$(CURDIR)/$(OUT):/app/data" $(IMAGE) \
	  --area $(AREA) --format $(FORMAT) --checksum
	@echo "Fertig. Fertige Datei liegt in $(CURDIR)/$(OUT)/result/osm*.$(FORMAT) (+ .sha256)."
	@echo "Diese .mbtiles hosten und URL + Groesse + SHA256 in src/config.rs::default_offline_katalog() pinnen."
	@echo "Rest von $(OUT)/ (Quelldaten/tmp, mehrere hundert MB) kann geloescht werden."

validate:
	@f=$$(ls "$(CURDIR)/$(OUT)"/result/osm*.mbtiles 2>/dev/null | head -1); \
	if [ -z "$$f" ]; then echo "keine osm*.mbtiles in $(OUT)/result/ — erst 'make tiles'"; exit 1; fi; \
	echo "Datei: $$f"; \
	sqlite3 "$$f" "SELECT 'tiles=' || count(*) FROM tiles;"; \
	sqlite3 "$$f" "SELECT name||'='||substr(value,1,120) FROM metadata WHERE name IN ('format','minzoom','maxzoom','json');"
