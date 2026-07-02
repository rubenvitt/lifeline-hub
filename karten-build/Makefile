# karten-build/Makefile — Shortbread-MBTiles bau-zeitig erzeugen (VersaTiles-Planetiler).
# Läuft NUR beim Bau, nie in der App. Nutzt das fertige Upstream-Image direkt (kein Custom-Build).
#
# AREA in Geofabrik-Notation: "germany" bzw. Unterregion wie "europe/germany/bremen".
AREA  ?= germany
OUT   ?= out
IMAGE := versatiles/versatiles-planetiler:latest

.PHONY: tiles validate
tiles:
	mkdir -p $(OUT)
	docker run --rm -v "$(PWD)/$(OUT):/app/data" $(IMAGE) -a geofabrik:$(AREA)
	@echo "Fertig. Output (osm-*.mbtiles + osm-*.versatiles) in $(OUT)/."
	@echo "Die .mbtiles hosten und URL + Groesse + SHA256 in src/config.rs::default_offline_katalog() pinnen."

validate:
	@f=$$(ls $(OUT)/osm-*.mbtiles 2>/dev/null | head -1); \
	if [ -z "$$f" ]; then echo "keine osm-*.mbtiles in $(OUT)/ — erst 'make tiles'"; exit 1; fi; \
	echo "Datei: $$f"; \
	sqlite3 "$$f" "SELECT 'tiles=' || count(*) FROM tiles;"; \
	sqlite3 "$$f" "SELECT name||'='||substr(value,1,120) FROM metadata WHERE name IN ('format','minzoom','maxzoom','json');"
