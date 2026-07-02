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
	docker run --rm -v "$(CURDIR)/$(OUT):/app/data" $(IMAGE) \
	  --area $(AREA) --format $(FORMAT) --checksum
	@echo "Fertig. Output (osm*.$(FORMAT) + .sha256) in $(CURDIR)/$(OUT)/."
	@echo "Die .mbtiles hosten und URL + Groesse + SHA256 in src/config.rs::default_offline_katalog() pinnen."

validate:
	@f=$$(ls "$(CURDIR)/$(OUT)"/osm*.mbtiles 2>/dev/null | head -1); \
	if [ -z "$$f" ]; then echo "keine osm*.mbtiles in $(OUT)/ — erst 'make tiles'"; exit 1; fi; \
	echo "Datei: $$f"; \
	sqlite3 "$$f" "SELECT 'tiles=' || count(*) FROM tiles;"; \
	sqlite3 "$$f" "SELECT name||'='||substr(value,1,120) FROM metadata WHERE name IN ('format','minzoom','maxzoom','json');"
