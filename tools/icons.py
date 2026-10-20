"""Erzeugt die App-Symbole fuer den Home-Bildschirm (braucht Pillow)."""

import os

from PIL import Image, ImageDraw, ImageFont

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "assets", "icons")


def icon(groesse):
    bild = Image.new("RGB", (groesse, groesse), (29, 111, 224))
    z = ImageDraw.Draw(bild)
    for y in range(groesse):          # Verlauf von oben links nach unten rechts
        t = y / groesse
        z.line([(0, y), (groesse, y)],
               fill=(int(29 - 7 * t), int(111 - 47 * t), int(224 - 98 * t)))

    # Kartennadel
    m = groesse / 2
    r = groesse * 0.17
    oben = groesse * 0.30
    z.ellipse([m - r, oben - r, m + r, oben + r], fill=(255, 255, 255))
    z.ellipse([m - r * 0.42, oben - r * 0.42, m + r * 0.42, oben + r * 0.42],
              fill=(29, 95, 190))
    z.polygon([(m - r * 0.72, oben + r * 0.62), (m + r * 0.72, oben + r * 0.62),
               (m, groesse * 0.60)], fill=(255, 255, 255))

    try:
        schrift = ImageFont.truetype("arialbd.ttf", int(groesse * 0.19))
    except OSError:
        schrift = ImageFont.load_default()
    text = "GeoPost"
    kasten = z.textbbox((0, 0), text, font=schrift)
    z.text((m - (kasten[2] - kasten[0]) / 2, groesse * 0.66), text,
           font=schrift, fill=(255, 255, 255))
    return bild


for groesse in (180, 512):
    pfad = os.path.join(WEB, "icon-%d.png" % groesse)
    icon(groesse).save(pfad, "PNG")
    print("erstellt:", pfad)
