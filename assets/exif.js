/* Liest Aufnahmedatum und GPS-Koordinaten aus einer Bilddatei - direkt im Browser.

   JPEG wird über die APP1-Marker gelesen, bei HEIC/HEIF und TIFF wird der eingebettete
   TIFF-Block im Dateikopf gesucht. Damit sind iPhone-Fotos (JPEG und HEIC) abgedeckt.
   Keine Fremdbibliothek, nichts verlässt das Gerät. */

const MAX_KOPF = 12 * 1024 * 1024;   // so viel vom Dateianfang wird durchsucht

function sucheMuster(bytes, muster, bis) {
  const ende = Math.min(bytes.length - muster.length, bis || bytes.length);
  for (let i = 0; i <= ende; i++) {
    let treffer = true;
    for (let k = 0; k < muster.length; k++) {
      if (bytes[i + k] !== muster[k]) { treffer = false; break; }
    }
    if (treffer) return i;
  }
  return -1;
}

function findeTiff(bytes) {
  // JPEG: die Segmente durchgehen, bis der EXIF-Block kommt
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    let pos = 2;
    while (pos + 4 <= bytes.length) {
      if (bytes[pos] !== 0xFF) { pos++; continue; }
      const marker = bytes[pos + 1];
      if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
        pos += 2;
        continue;
      }
      if (marker === 0xDA) break;                       // ab hier beginnen die Bilddaten
      const laenge = (bytes[pos + 2] << 8) | bytes[pos + 3];
      if (marker === 0xE1
          && bytes[pos + 4] === 0x45 && bytes[pos + 5] === 0x78
          && bytes[pos + 6] === 0x69 && bytes[pos + 7] === 0x66) {
        return pos + 10;
      }
      pos += 2 + laenge;
    }
    return -1;
  }
  // HEIC/HEIF und andere: den EXIF- oder TIFF-Kopf suchen
  const exif = sucheMuster(bytes, [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  if (exif !== -1) return exif + 6;
  const mm = sucheMuster(bytes, [0x4D, 0x4D, 0x00, 0x2A], 4 * 1024 * 1024);
  if (mm !== -1) return mm;
  const ii = sucheMuster(bytes, [0x49, 0x49, 0x2A, 0x00], 4 * 1024 * 1024);
  return ii;
}

function leseIfd(sicht, tiff, versatz, grossEnde, gesucht) {
  const werte = {};
  if (versatz <= 0 || tiff + versatz + 2 > sicht.byteLength) return werte;
  const basis = tiff + versatz;
  const anzahl = sicht.getUint16(basis, !grossEnde);
  if (anzahl > 512) return werte;

  const groessen = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
  for (let i = 0; i < anzahl; i++) {
    const e = basis + 2 + i * 12;
    if (e + 12 > sicht.byteLength) break;
    const tag = sicht.getUint16(e, !grossEnde);
    if (gesucht && gesucht.indexOf(tag) === -1) continue;
    const typ = sicht.getUint16(e + 2, !grossEnde);
    const menge = sicht.getUint32(e + 4, !grossEnde);
    const groesse = groessen[typ];
    if (!groesse) continue;
    const gesamt = groesse * menge;
    const datenAb = gesamt <= 4 ? e + 8 : tiff + sicht.getUint32(e + 8, !grossEnde);
    if (datenAb < 0 || datenAb + gesamt > sicht.byteLength) continue;

    if (typ === 2) {                                   // Text
      let text = "";
      for (let k = 0; k < menge; k++) {
        const z = sicht.getUint8(datenAb + k);
        if (z === 0) break;
        text += String.fromCharCode(z);
      }
      werte[tag] = text;
    } else if (typ === 5 || typ === 10) {              // Bruch
      const liste = [];
      for (let k = 0; k < menge; k++) {
        const zaehler = typ === 10 ? sicht.getInt32(datenAb + k * 8, !grossEnde)
                                   : sicht.getUint32(datenAb + k * 8, !grossEnde);
        const nenner = typ === 10 ? sicht.getInt32(datenAb + k * 8 + 4, !grossEnde)
                                  : sicht.getUint32(datenAb + k * 8 + 4, !grossEnde);
        liste.push(nenner ? zaehler / nenner : 0);
      }
      werte[tag] = menge === 1 ? liste[0] : liste;
    } else if (typ === 3) {
      const liste = [];
      for (let k = 0; k < menge; k++) liste.push(sicht.getUint16(datenAb + k * 2, !grossEnde));
      werte[tag] = menge === 1 ? liste[0] : liste;
    } else if (typ === 4 || typ === 9) {
      const liste = [];
      for (let k = 0; k < menge; k++) liste.push(sicht.getUint32(datenAb + k * 4, !grossEnde));
      werte[tag] = menge === 1 ? liste[0] : liste;
    } else if (typ === 1) {
      werte[tag] = menge === 1 ? sicht.getUint8(datenAb) : null;
    }
  }
  return werte;
}

function gradAusDms(teile, richtung) {
  if (!Array.isArray(teile) || teile.length < 3) return null;
  let grad = teile[0] + teile[1] / 60 + teile[2] / 3600;
  const r = String(richtung || "").toUpperCase();
  if (r === "S" || r === "W") grad = -grad;
  return Math.round(grad * 1e7) / 1e7;
}

/* Liefert { lat, lon, hoehe, aufgenommen, kamera } - Felder können null sein. */
async function fotoDatenLesen(datei) {
  const ergebnis = { lat: null, lon: null, hoehe: null, aufgenommen: null, kamera: null };
  let puffer;
  try {
    const teil = datei.size > MAX_KOPF ? datei.slice(0, MAX_KOPF) : datei;
    puffer = await teil.arrayBuffer();
  } catch (err) {
    return ergebnis;
  }
  const bytes = new Uint8Array(puffer);
  const tiff = findeTiff(bytes);
  if (tiff === -1 || tiff + 8 > bytes.length) return ergebnis;

  const grossEnde = bytes[tiff] === 0x4D && bytes[tiff + 1] === 0x4D;
  if (!grossEnde && !(bytes[tiff] === 0x49 && bytes[tiff + 1] === 0x49)) return ergebnis;
  const sicht = new DataView(puffer);

  try {
    const ifd0Ab = sicht.getUint32(tiff + 4, !grossEnde);
    const ifd0 = leseIfd(sicht, tiff, ifd0Ab, grossEnde, [0x8769, 0x8825, 0x0110, 0x010F, 0x0132]);
    const hersteller = ifd0[0x010F];
    const modell = ifd0[0x0110];
    if (hersteller || modell) {
      ergebnis.kamera = [hersteller, modell].filter(Boolean).join(" ").trim();
    }
    ergebnis.aufgenommen = ifd0[0x0132] || null;

    if (typeof ifd0[0x8769] === "number") {
      const unter = leseIfd(sicht, tiff, ifd0[0x8769], grossEnde, [0x9003, 0x9004]);
      ergebnis.aufgenommen = unter[0x9003] || unter[0x9004] || ergebnis.aufgenommen;
    }
    if (typeof ifd0[0x8825] === "number") {
      const g = leseIfd(sicht, tiff, ifd0[0x8825], grossEnde, [1, 2, 3, 4, 5, 6]);
      const lat = gradAusDms(g[2], g[1]);
      const lon = gradAusDms(g[4], g[3]);
      if (lat !== null && lon !== null && !(lat === 0 && lon === 0)) {
        ergebnis.lat = lat;
        ergebnis.lon = lon;
      }
      if (typeof g[6] === "number") {
        ergebnis.hoehe = Math.round((g[5] === 1 ? -g[6] : g[6]) * 10) / 10;
      }
    }
  } catch (err) {
    return ergebnis;
  }
  return ergebnis;
}

/* Entfernung zweier Punkte in Metern */
function entfernungM(lat1, lon1, lat2, lon2) {
  const r = 6371000;
  const b = Math.PI / 180;
  const p1 = lat1 * b;
  const p2 = lat2 * b;
  const dp = (lat2 - lat1) * b;
  const dl = (lon2 - lon1) * b;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
