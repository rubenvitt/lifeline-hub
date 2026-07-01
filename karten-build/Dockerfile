# karten-build/Dockerfile
# Bau-zeitig — NICHT Teil der App. Erzeugt Shortbread-MBTiles aus einem Geofabrik-Extract.
FROM ghcr.io/versatiles-org/planetiler-shortbread:latest
# Image bringt Planetiler + Shortbread-Profil mit; wir setzen nur die Defaults.
WORKDIR /data
ENTRYPOINT ["java", "-jar", "/planetiler.jar"]
