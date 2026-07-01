# karten-build/Makefile
AREA ?= germany
MAXZOOM ?= 14
OUT ?= out
IMAGE := lifeline-karten-build

.PHONY: image tiles validate
image:
	docker build -t $(IMAGE) .

tiles: image
	mkdir -p $(OUT)
	docker run --rm -v "$(PWD)/$(OUT):/data" $(IMAGE) \
	  --download --area=$(AREA) --maxzoom=$(MAXZOOM) \
	  --output=/data/$(AREA).shortbread.mbtiles
	@echo "Fertig: $(OUT)/$(AREA).shortbread.mbtiles"

validate:
	sqlite3 $(OUT)/$(AREA).shortbread.mbtiles \
	  "SELECT 'tiles=' || count(*) FROM tiles; SELECT name||'='||value FROM metadata;"
