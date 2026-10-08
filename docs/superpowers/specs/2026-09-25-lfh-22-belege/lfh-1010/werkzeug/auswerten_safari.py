# LFH-813: Auswertung der Druck-PDFs je Browser (Text je Seite, Bilder je Seite, Papierhelligkeit).
import json, re, subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

BASIS = Path(sys.argv[1])
LB = ['Auftrag', 'Gefahren-/Schadenlage', 'Eigene Lage', 'Lageentwicklung',
      'Besondere (Führungs-)Probleme', 'Anträge und Vorschläge', 'Medienlage', 'Zusammenfassung']
BEF = ['Lage', 'Auftrag', 'Durchführung']
RAHMEN = ['Drucken / als PDF', 'Entwurf speichern', 'Vorschau neben dem Text', 'Abmelden',
          'Neu laden', 'Zurück zum ETB', 'Nur Einheiten', 'In Lagebericht übernehmen', 'Suche...']
KOPF = ['DRK KV Musterstadt', 'E-2026-0001', 'Gedruckt von', 'Administrator', 'Gedruckt am']


def seiten(pdf):
    n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout)[1])
    return [subprocess.run(['pdftotext', '-f', str(i), '-l', str(i), '-layout', pdf, '-'],
                           capture_output=True, text=True).stdout for i in range(1, n + 1)]


def bilder(pdf):
    zeilen = subprocess.run(['pdfimages', '-list', pdf], capture_output=True, text=True).stdout.splitlines()[2:]
    out = {}
    for z in zeilen:
        t = z.split()
        out.setdefault(int(t[0]), []).append(f'{t[3]}x{t[4]}')
    return out


def inhalt(text):
    return [z.strip() for z in text.splitlines() if z.strip() and not re.fullmatch(r'Seite \d+ von \d+', z.strip())]


def dunkelanteil(pdf):
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(['pdftoppm', '-r', '30', '-png', '-f', '1', '-l', '1', pdf, f'{tmp}/s'], check=True)
        im = Image.open(next(Path(tmp).glob('s*.png'))).convert('L')
    px = list(im.get_flattened_data()) if hasattr(im, 'get_flattened_data') else list(im.getdata())
    return round(sum(1 for v in px if v < 128) / len(px), 3)


def titel_am_ende(s, titel):
    """Seiten, deren letzte Inhaltszeile ein Abschnittstitel ist (Titel allein am Seitenende)."""
    treffer = []
    for i, t in enumerate(s[:-1]):
        z = inhalt(t)
        if z and any(re.search(rf'(^|\s){re.escape(x)}$', z[-1]) for x in titel):
            treffer.append((i + 1, z[-1][-60:]))
    return treffer


def zerrissen(s):
    """Seitenübergänge, an denen ein Absatz mitten im Satz bricht (Absätze enden auf 'befahrbar.')."""
    n = 0
    for t in s[:-1]:
        z = inhalt(t)
        if z and not z[-1].rstrip().endswith(('befahrbar.', 'befahrbar.  Administrator', 'EL')):
            n += 1
    return n


def auswerten(b, name, pdf):
    s = seiten(str(pdf))
    voll = '\n'.join(s)
    r = {'seiten': len(s), 'bilder': bilder(str(pdf))}
    r['rahmen_gefunden'] = [w for w in RAHMEN if w in voll]
    r['kopf_s1_fehlt'] = [w for w in KOPF if w not in s[0]]
    r['letzte_seite_leer'] = not inhalt(s[-1])
    r['seitenzaehlung'] = sum(1 for i, t in enumerate(s) if f'Seite {i + 1} von {len(s)}' in t)
    r['dunkelanteil_s1'] = dunkelanteil(str(pdf))
    if name.startswith('lagebericht'):
        r['endmarke_seite'] = next((i + 1 for i, t in enumerate(s) if 'ENDE-LAGEBERICHT' in t), None)
        r['titel_vorkommen'] = {x: len(re.findall(rf'(?m)^\s*{re.escape(x)}\s*$', voll)) for x in LB}
        r['titel_am_seitenende'] = titel_am_ende(s, LB)
        r['absatz_zerrissen'] = zerrissen(s)
        r['letzter_absatz'] = 'zusammenfassung Absatz 6' in voll
    if name.startswith('befehl'):
        r['endmarke_seite'] = next((i + 1 for i, t in enumerate(s) if 'ENDE-BEFEHL' in t), None)
        r['titel_vorkommen'] = {x: len(re.findall(rf'(?m)^\s*{re.escape(x)}\s*$', voll)) for x in BEF}
        r['titel_am_seitenende'] = titel_am_ende(s, BEF)
        r['absatz_zerrissen'] = zerrissen(s)
    if name.startswith('meldebild'):
        # Spaltenköpfe stehen gesperrt („S TAT U S“): Leerzeichen raus, Großschreibung egal.
        r['kopf_je_seite'] = sum(1 for t in s if 'STATUS' in re.sub(r'\s', '', t).upper())
        r['kraefte'] = sorted({int(m) for m in re.findall(r'(?m)^\s*ne (\d+)\b', voll)} |
                              {int(m) for m in re.findall(r'Maximiliane (\d+)', voll)})
    if name.startswith('etb'):
        r['kopf_je_seite'] = sum(1 for t in s if re.search(r'Nr\.\s+Zeit', t))
        nrn = [int(m) for m in re.findall(r'(?m)^\s{0,3}(\d{1,3})\s+\d{2}\.\d{2}\.\d{4}', voll)]
        r['nummern'] = {'anzahl': len(nrn), 'erste': nrn[:3], 'letzte': nrn[-3:],
                        'aufsteigend': nrn == sorted(nrn), 'lueckenlos': nrn == list(range(nrn[0], nrn[0] + len(nrn))) if nrn else False}
        r['nachtrag'] = 'nachgetragen um' in voll
        r['berichtigt_nr'] = len(re.findall(r'berichtigt Nr\. 43', voll))
        r['berichtigt_durch'] = len(re.findall(r'berichtigt durch Nr\. 555', voll))
        r['auswahl_kopf'] = re.search(r'Auswahl\s+(.*)', s[0])[1].strip() if re.search(r'Auswahl\s+(.*)', s[0]) else None
        r['letzte_zeile_letzte_seite'] = inhalt(s[-1])[-1][:80] if inhalt(s[-1]) else None
        r['titel_am_seitenende'] = titel_am_ende(s, LB + BEF)
        r['s1_zeilen'] = len(inhalt(s[0]))
    return r




def meta(pdf):
    info = subprocess.run(['pdfinfo', str(pdf)], capture_output=True, text=True).stdout
    feld = lambda k: (re.search(rf'(?m)^{k}:\s+(.*)$', info) or [None, None])[1]
    return {'producer': feld('Producer'), 'creator': feld('Creator'), 'seitenformat': feld('Page size'), 'titel': feld('Title')}


def leerseiten(pdf):
    return [i + 1 for i, t in enumerate(seiten(str(pdf))) if not inhalt(t)]


def minimalprobe(pdf):
    s = seiten(str(pdf))
    erg = {}
    for name in ['block', 'tabellenzelle']:
        for platz in range(840, 1001, 20):
            k = f'{name}-{platz}'
            ti = next((i for i, t in enumerate(s) if f'TITEL-MARKE-{k}' in t), None)
            ai = next((i for i, t in enumerate(s) if f'ABSATZ-{k}-0' in t), None)
            pi = next((i for i, t in enumerate(s) if f'Platzhalter {k}' in t), None)
            if ti is None:
                v = 'titel-fehlt'
            elif ti == pi and ai == ti:
                v = 'mit-text'
            elif ti == pi:
                v = 'TITEL-ALLEIN'
            else:
                v = 'titel-S2'
            erg.setdefault(name, []).append(f'{platz}:{v}')
    return {'seiten': len(s), 'ergebnis': erg}


erg = {}
for pdf in sorted(BASIS.glob('*.pdf')):
    if pdf.stem == 'minimalprobe':
        erg[pdf.stem] = {'meta': meta(pdf), **minimalprobe(pdf)}
        continue
    r = auswerten('safari', pdf.stem, pdf)
    r['meta'] = meta(pdf)
    r['leerseiten'] = leerseiten(pdf)
    letzte = seiten(str(pdf))[-1]
    for m in ['ENDE-LAGEBERICHT', 'ENDE-BEFEHL']:
        if m in '\n'.join(seiten(str(pdf))):
            r['endmarke_auf_letzter_seite'] = m in letzte
    erg[pdf.stem] = r
print(json.dumps(erg, ensure_ascii=False, indent=1))
