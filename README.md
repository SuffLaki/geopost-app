# GeoPost

**Fotos mit Geodaten an die richtige Adresse weitergeben — als App auf dem Smartphone.**

Du wählst ein Foto, GeoPost liest die Koordinaten aus dem Bild, sucht die Regel, in deren
Umkreis es aufgenommen wurde, und übergibt Foto und fertigen Mailtext an deine Mail-App.
Du tippst nur noch auf *Senden*.

Keine Anmeldung, kein Konto, kein Server, kein PC. Fotos und Regeln bleiben auf dem Gerät.

---

## Was die App macht

- **Geodaten im Gerät auslesen** — eigener EXIF-Leser für JPEG und HEIC, ganz ohne Bibliothek
- **Regeln** — pro Baustelle ein Mittelpunkt mit Radius und eine oder mehrere Empfängeradressen;
  von oben nach unten geprüft, die erste passende gewinnt. Eine Regel ohne Umkreis fängt alles
  Übrige auf.
- **Mittelpunkt setzen** — aus dem eigenen Standort, aus einem Foto von der Baustelle oder als
  Koordinatenpaar aus Google Maps (einfach einfügen, es wird selbst aufgeteilt)
- **Mail-Vorlagen** mit Platzhaltern: `{dateiname}` `{datum}` `{koordinaten}` `{ort}` `{karte}`
  `{regel}` `{hoehe}` `{kamera}` `{heute}`
- **Geodaten im Bild** — Koordinaten, Aufnahmezeit, Höhe, Ort und Regelname werden unten ins
  Foto eingeblendet, damit sie auch im Ausdruck und in der Akte stehen (abschaltbar unter *Mehr*).
  Stammt die Koordinate nicht aus dem Foto, sondern vom Gerät, steht dort „(per GPS erfasst)“.
- **Großansicht** — ein Tipp auf das Vorschaubild zeigt das Foto so, wie es verschickt wird
- **Mehrere Fotos auf einmal** — nach Regeln gruppiert, je Regel eine Mail
- **Verlauf** — was wann an wen ging
- **Sicherung** — Regeln als Datei exportieren und auf einem anderen Gerät einlesen

## Grenzen, ehrlich benannt

- **Den letzten Tipp machst du, und iOS lässt nicht alles auf einmal zu.** Ein Browser darf
  keine Mail selbst verschicken. Für die Übergabe an die Mail-App gibt es unter *Mehr* zwei
  Wege, weil iOS keinen anbietet, der beides kann:
  - **Teilen** — das Foto geht als echter Anhang mit, auch mehrere auf einmal. Empfänger und
    Betreff kann das Teilen-Fenster nicht übernehmen; die Adresse liegt deshalb in der
    Zwischenablage, der Betreff steht oben im Text.
  - **Mail-Entwurf** — Adresse, Betreff und Text sind ausgefüllt. Das Foto liegt in der
    Zwischenablage und wird im Text eingefügt, steht dann aber im Text statt als Anhang.
- **Keine Hintergrund-Automatik.** iOS lässt keine Web-App unbeaufsichtigt in die
  Fotomediathek schauen. Du wählst die Fotos, alles danach läuft automatisch.
- **Eingebrannte Daten ersetzen EXIF.** Beim Einblenden wird das Foto neu gespeichert; die
  unsichtbaren EXIF-Daten gehen dabei verloren. Dafür sind die Koordinaten im Bild selbst
  sichtbar — und im Mailtext stehen sie ohnehin.
- **Geodaten müssen im Foto stecken.** Sonst hilft der Standort des Handys (Schalter unter
  *Mehr*) oder die Auswahl der Regel von Hand.
- **Standort und Offline-Betrieb** verlangen eine verschlüsselte Adresse (`https://…`). Über
  `http://…` im WLAN sperrt der Browser beides; die Geodaten aus den Fotos sind nicht betroffen.

## Benutzen

Die App ist eine statische Website ohne Server, Build-Schritt oder Abhängigkeiten.

- **Am PC ansehen:** `Vorschau am PC.cmd` (startet `tools/serve.py` auf Port 8777)
- **Aufs iPhone:** die Adresse in Safari öffnen, dann *Teilen → Zum Home-Bildschirm*.
  Danach liegt GeoPost mit eigenem Symbol im Vollbild auf dem Home-Bildschirm und läuft offline.
  Für die Installation mit Offline-Betrieb muss die Seite über `https://` erreichbar sein —
  etwa über GitHub Pages.

## Aufbau

```
index.html               Oberfläche
manifest.webmanifest     App-Name, Symbole, Startadresse
sw.js                    Service Worker: Offline-Betrieb (VERSION beim Ändern hochzählen)
assets/
  style.css              Gestaltung, hell und dunkel
  exif.js                liest GPS, Aufnahmedatum und Kamera aus JPEG/HEIC
  app.js                 Regeln, Zuordnung, Übergabe an die Mail-App, Verlauf
  icons/                 App-Symbole (aus tools/icons.py)
tools/
  icons.py               erzeugt die Symbole neu (braucht Pillow)
  serve.py               lokale Vorschau am PC
```

Alle Daten liegen im `localStorage` des Geräts: `geopost_regeln`, `geopost_optionen`,
`geopost_verlauf`. Nichts davon wird übertragen — die Sicherung unter *Mehr* ist der Weg auf
ein anderes Gerät.

Ortsnamen werden nur nachgeschlagen, wenn du es einschaltest; dann gehen die Koordinaten an
[Nominatim/OpenStreetMap](https://nominatim.org/). Standardmäßig ist das aus.

## Verwandt

Für den vollautomatischen Betrieb ohne Antippen gibt es die PC-Fassung: Sie überwacht Ordner
und verschickt neue Fotos selbst per SMTP.
