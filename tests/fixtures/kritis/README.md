# KRITIS-Extrakt-Fixture (LFH-83)

`mini.osm` ist handgeschrieben und enthält je einen Fall, den der Extrakt-Import
unterscheiden muss: getaggter Node, fremd getaggter Node, getaggter Way,
Multipolygon-Relation über einen ungetaggten Way und einen fremd getaggten Way.

`mini.osm.pbf` ist daraus erzeugt (Dense Nodes, wie in den Geofabrik-Extrakten):

```bash
osmium cat tests/fixtures/kritis/mini.osm -o tests/fixtures/kritis/mini.osm.pbf -O
```

Wer `mini.osm` ändert, erzeugt die PBF-Datei neu und committet beide.
