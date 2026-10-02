# Fixture für LFH-759: kleines HEIC, quer kodiert (64 × 48, links rot, rechts blau), mit
# Drehung über `irot` (zur Anzeige hochkant), dazu EXIF mit Gerät, GPS und XMP.
import sys
from PIL import Image
import pillow_heif

bild = Image.new("RGB", (64, 48), (20, 20, 220))
bild.paste((220, 20, 20), (0, 0, 32, 48))
exif = Image.Exif()
exif[0x010F] = "MARKER_MAKE"   # Make
exif[0x0110] = "MARKER_MODEL"  # Model
exif[0x0112] = 6               # Ausrichtung: 90° im Uhrzeigersinn
gps = exif.get_ifd(0x8825)
gps[1] = "N"
gps[2] = (52.0, 31.0, 12.0)
xmp = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
       b'<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="MARKER_XMP_GPS"/>'
       b'</rdf:RDF></x:xmpmeta>')
heif = pillow_heif.from_pillow(bild)
heif[0].info["exif"] = exif.tobytes()
heif[0].info["xmp"] = xmp
heif.save(sys.argv[1], quality=60)
