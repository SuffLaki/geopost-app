/* GeoPost - eigenständige App. Alles bleibt auf dem Gerät: keine Anmeldung, kein Server. */

const VERSION = "1.1";
const SCHLUESSEL = { regeln: "geopost_regeln", opt: "geopost_optionen",
                     verlauf: "geopost_verlauf" };
const PLATZHALTER = ["dateiname", "datum", "koordinaten", "ort", "karte", "regel",
                     "hoehe", "kamera", "heute"];
const STANDARD_BETREFF = "Foto {dateiname} - {ort}";
const STANDARD_TEXT =
  "Automatisch weitergeleitetes Foto\n\n"
  + "Datei:        {dateiname}\n"
  + "Aufgenommen:  {datum}\n"
  + "Koordinaten:  {koordinaten}\n"
  + "Ort:          {ort}\n"
  + "Karte:        {karte}\n"
  + "Regel:        {regel}\n";

let regeln = [];
let optionen = { geocode: false, standort: false, kleiner: true, stempel: true };
let verlauf = [];
let fotos = [];
let laufendeId = 1;
let editorId = null;
let ortCache = {};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------------------------------------------------------------- Speicher */
function lies(schluessel, ersatz) {
  try {
    const roh = localStorage.getItem(schluessel);
    return roh ? JSON.parse(roh) : ersatz;
  } catch (e) { return ersatz; }
}
function schreib(schluessel, wert) {
  try { localStorage.setItem(schluessel, JSON.stringify(wert)); } catch (e) {
    toast("Speicher voll – Regeln konnten nicht gesichert werden.", true);
  }
}
const regelnSichern = () => schreib(SCHLUESSEL.regeln, regeln);
const optionenSichern = () => schreib(SCHLUESSEL.opt, optionen);
const verlaufSichern = () => schreib(SCHLUESSEL.verlauf, verlauf.slice(0, 200));

let toastTimer = null;
function toast(text, fehler) {
  const el = $("toast");
  el.textContent = text;
  el.classList.toggle("fehler", !!fehler);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, fehler ? 7000 : 3200);
}

function neueRegel(name) {
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: name || "Neue Regel",
    aktiv: true,
    empfaenger: [],
    geofence: { aktiv: true, lat: null, lon: null, radius_m: 300 },
    betreff: STANDARD_BETREFF,
    text: STANDARD_TEXT,
  };
}

/* ---------------------------------------------------------------- Hilfen */
function datumText(roh) {
  if (!roh) return "unbekannt";
  const m = String(roh).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return String(roh);
  return `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}`;
}

async function ortsname(lat, lon) {
  if (lat === null || lon === null) return "";
  const schluessel = lat.toFixed(4) + "," + lon.toFixed(4);
  if (ortCache[schluessel] !== undefined) return ortCache[schluessel];
  if (!optionen.geocode) return "";
  try {
    const antwort = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18"
      + "&lat=" + lat.toFixed(6) + "&lon=" + lon.toFixed(6), { headers: { Accept: "application/json" } });
    const daten = await antwort.json();
    const a = daten.address || {};
    const name = [a.road, a.house_number, a.postcode, a.city || a.town || a.village]
      .filter(Boolean).join(" ") || daten.display_name || "";
    ortCache[schluessel] = name;
    return name;
  } catch (err) {
    ortCache[schluessel] = "";
    return "";
  }
}

function standortHolen() {
  return new Promise((erfolg, fehler) => {
    const sicher = location.protocol === "https:" || location.hostname === "localhost"
      || location.hostname === "127.0.0.1";
    if (!navigator.geolocation || !sicher) {
      fehler(new Error("Der Standort ist über diese Verbindung gesperrt. Nimm die Geodaten "
        + "aus dem Foto oder wähle die Regel von Hand."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => erfolg({ lat: +pos.coords.latitude.toFixed(6),
                        lon: +pos.coords.longitude.toFixed(6),
                        genauigkeit: Math.round(pos.coords.accuracy) }),
      (err) => fehler(new Error(err.code === 1
        ? "Standort ist nicht erlaubt. In den iPhone-Einstellungen für Safari freigeben."
        : "Standort konnte nicht ermittelt werden.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

function regelFuer(daten) {
  for (const r of regeln) {
    if (!r.aktiv) continue;
    const f = r.geofence || {};
    if (!f.aktiv) return { regel: r, grund: "Regel ohne Umkreis" };
    if (daten.lat === null || f.lat === null || f.lat === undefined) continue;
    const abstand = entfernungM(f.lat, f.lon, daten.lat, daten.lon);
    if (abstand <= (f.radius_m || 0)) {
      return { regel: r, grund: "Im Umkreis (" + Math.round(abstand) + " m vom Mittelpunkt)" };
    }
  }
  if (daten.lat === null) return { regel: null, grund: "Keine Geodaten im Foto" };
  return { regel: null, grund: "Kein Umkreis passt zu diesem Foto" };
}

function werteFuer(regel, foto) {
  const lat = foto.daten.lat;
  const koord = lat === null ? "keine Geodaten"
    : lat.toFixed(6) + ", " + foto.daten.lon.toFixed(6)
      + (foto.standortVomHandy ? " (Standort des Handys)" : "");
  return {
    dateiname: foto.name,
    datum: datumText(foto.daten.aufgenommen),
    koordinaten: koord,
    ort: foto.ort || (lat === null ? "unbekannt" : koord),
    karte: lat === null ? "-"
      : "https://www.google.com/maps?q=" + lat.toFixed(6) + "," + foto.daten.lon.toFixed(6),
    regel: regel ? regel.name : "-",
    hoehe: foto.daten.hoehe === null ? "-" : Math.round(foto.daten.hoehe) + " m",
    kamera: foto.daten.kamera || "-",
    heute: new Date().toLocaleDateString("de-DE"),
  };
}

const fuelle = (vorlage, werte) =>
  Object.keys(werte).reduce((t, k) => t.split("{" + k + "}").join(werte[k]), vorlage || "");

/* Zeilen, die unten ins Foto geschrieben werden */
function stempelZeilen(foto) {
  if (foto.daten.lat === null) return [];
  const koord = foto.daten.lat.toFixed(6) + ", " + foto.daten.lon.toFixed(6)
    + (foto.standortVomHandy ? "  (Standort des Handys)" : "");
  const zweite = [datumText(foto.daten.aufgenommen),
                  foto.daten.hoehe === null ? "" : Math.round(foto.daten.hoehe) + " m ü. NN"]
    .filter(Boolean).join("   ·   ");
  const dritte = [foto.ort, foto.regel ? foto.regel.name : ""].filter(Boolean).join("   ·   ");
  return [koord, zweite, dritte].filter(Boolean);
}

/* Foto aufbereiten: auf Wunsch verkleinern und die Geodaten sichtbar einbrennen */
async function fotoAufbereiten(foto) {
  const datei = foto.datei;
  const zeilen = optionen.stempel ? stempelZeilen(foto) : [];
  const verkleinern = optionen.kleiner && datei.size >= 900 * 1024;
  if (!zeilen.length && !verkleinern) return datei;

  try {
    const bild = await createImageBitmap(datei);
    const faktor = verkleinern ? Math.min(1, 1600 / Math.max(bild.width, bild.height)) : 1;
    const flaeche = document.createElement("canvas");
    flaeche.width = Math.round(bild.width * faktor);
    flaeche.height = Math.round(bild.height * faktor);
    const stift = flaeche.getContext("2d");
    stift.drawImage(bild, 0, 0, flaeche.width, flaeche.height);

    if (zeilen.length) {
      const grund = Math.max(13, Math.round(flaeche.width / 44));
      const luft = Math.round(grund * 0.9);
      const hoeheErste = Math.round(grund * 1.6);
      const hoeheWeitere = Math.round(grund * 1.25);
      const abstand = Math.round(grund * 0.3);
      const textHoehe = hoeheErste
        + (zeilen.length - 1) * (hoeheWeitere + abstand);
      const balken = luft * 2 + textHoehe;
      const oben = flaeche.height - balken;

      const verlauf = stift.createLinearGradient(0, oben - grund, 0, flaeche.height);
      verlauf.addColorStop(0, "rgba(0, 0, 0, 0)");
      verlauf.addColorStop(1, "rgba(0, 0, 0, 0.72)");
      stift.fillStyle = verlauf;
      stift.fillRect(0, oben - grund, flaeche.width, balken + grund);

      stift.textBaseline = "top";
      stift.shadowColor = "rgba(0, 0, 0, 0.85)";
      stift.shadowBlur = Math.round(grund / 3);
      stift.fillStyle = "#ffffff";

      const links = Math.round(luft * 1.2);
      const platz = flaeche.width - links * 2;
      let y = oben + luft;
      zeilen.forEach((zeile, i) => {
        if (i === 0) {
          stift.font = "600 " + Math.round(grund * 1.3)
            + "px -apple-system, Segoe UI, Arial, sans-serif";
          stift.fillStyle = "#ffffff";
        } else {
          stift.font = Math.round(grund) + "px -apple-system, Segoe UI, Arial, sans-serif";
          stift.fillStyle = "rgba(255, 255, 255, 0.92)";
        }
        let text = zeile;
        while (text.length > 4 && stift.measureText(text).width > platz) {
          text = text.slice(0, -2);            // zu lange Zeile kürzen statt überlaufen
        }
        if (text !== zeile) text = text.replace(/[\s·]+$/, "") + "…";
        stift.fillText(text, links, y);
        y += i === 0 ? hoeheErste + abstand : hoeheWeitere + abstand;
      });
      stift.shadowBlur = 0;
    }

    const fertig = await new Promise((f) => flaeche.toBlob(f, "image/jpeg", 0.85));
    if (!fertig) return datei;
    if (!zeilen.length && fertig.size >= datei.size) return datei;
    return new File([fertig], datei.name.replace(/\.(hei[cf]|png|tiff?|webp)$/i, ".jpg"),
                    { type: "image/jpeg" });
  } catch (err) {
    return datei;
  }
}

/* ---------------------------------------------------------------- Fotos */
async function fotosAufnehmen(dateien) {
  for (const datei of dateien) {
    if (!datei.type.startsWith("image/")
        && !/\.(hei[cf]|jpe?g|png|tiff?|webp)$/i.test(datei.name)) continue;
    const eintrag = {
      id: laufendeId++, datei, name: datei.name || "foto.jpg",
      vorschau: URL.createObjectURL(datei), daten: { lat: null, lon: null, hoehe: null,
      aufgenommen: null, kamera: null }, ort: "", zustand: "liest", grund: "",
      regel: null, standortVomHandy: false,
    };
    fotos.push(eintrag);
  }
  zeichneFotos();

  for (const f of fotos.filter((x) => x.zustand === "liest")) {
    f.daten = await fotoDatenLesen(f.datei);
    if (f.daten.lat === null && optionen.standort) {
      try {
        const s = await standortHolen();
        f.daten.lat = s.lat;
        f.daten.lon = s.lon;
        f.standortVomHandy = true;
      } catch (err) { /* ohne Standort weiter */ }
    }
    f.ort = await ortsname(f.daten.lat, f.daten.lon);
    zuordnen(f);
    f.fertig = await fotoAufbereiten(f);
    if (f.fertig !== f.datei) {
      URL.revokeObjectURL(f.vorschau);
      f.vorschau = URL.createObjectURL(f.fertig);     // Vorschau zeigt das fertige Foto
    }
    zeichneFotos();
  }
}

function zuordnen(f) {
  const wahl = $("ziel").value;
  if (wahl) {
    f.regel = regeln.find((r) => r.id === wahl) || null;
    f.grund = "von Hand gewählt";
  } else {
    const treffer = regelFuer(f.daten);
    f.regel = treffer.regel;
    f.grund = treffer.grund;
  }
  f.zustand = f.regel ? "bereit" : "offen";
}

$("kamera").onchange = (ev) => { fotosAufnehmen(ev.target.files); ev.target.value = ""; };
$("galerie").onchange = (ev) => { fotosAufnehmen(ev.target.files); ev.target.value = ""; };

function kopfhoeheSetzen() {
  const kopf = document.querySelector(".kopf");
  document.documentElement.style.setProperty("--kopfhoehe",
    (kopf ? kopf.offsetHeight : 58) + "px");
}

function zeichneFotos() {
  $("leer").hidden = fotos.length > 0;
  document.querySelector(".waehlen").classList.toggle("kompakt", fotos.length > 0);
  kopfhoeheSetzen();
  $("sendeleiste").hidden = fotos.length === 0
    || document.querySelector(".tab.aktiv").dataset.seite !== "senden"
    || !$("editor").hidden;
  const bereit = fotos.filter((f) => f.zustand === "bereit").length;
  $("senden").disabled = bereit === 0;
  $("senden").textContent = bereit ? "An Mail übergeben (" + bereit + ")" : "An Mail übergeben";

  $("liste").innerHTML = fotos.map((f) => {
    const lat = f.daten.lat;
    const koord = lat === null ? "keine Geodaten"
      : lat.toFixed(5) + ", " + f.daten.lon.toFixed(5);
    const zustandText = { liest: "wird gelesen …", bereit: "bereit", offen: "keine Regel",
                          fertig: "übergeben" }[f.zustand];
    return `
    <div class="foto">
      <img src="${f.vorschau}" alt="">
      <div class="mitte">
        <span class="name">${esc(f.name)}</span>
        <div class="meta">${esc(datumText(f.daten.aufgenommen))} ·
          ${(f.datei.size / 1048576).toFixed(1)} MB</div>
        <div class="meta">${esc(koord)}${f.standortVomHandy ? " (Handy-Standort)" : ""}${
          f.ort ? " · " + esc(f.ort) : ""}</div>
        <span class="zustand z-${f.zustand}">${zustandText}</span>
        <div class="meta">${f.regel ? "An: " + esc(f.regel.name) + " · "
          + esc((f.regel.empfaenger || []).join(", ")) : esc(f.grund)}</div>
      </div>
      <button class="weg" data-weg="${f.id}" aria-label="Entfernen">×</button>
    </div>`;
  }).join("");

  $("liste").querySelectorAll("[data-weg]").forEach((b) => {
    b.onclick = () => {
      const id = parseInt(b.dataset.weg, 10);
      const f = fotos.find((x) => x.id === id);
      if (f) URL.revokeObjectURL(f.vorschau);
      fotos = fotos.filter((x) => x.id !== id);
      zeichneFotos();
    };
  });
}

/* ---------------------------------------------------------------- Übergabe an Mail */
async function anMailUebergeben(gruppe, regel) {
  const werte = werteFuer(regel, gruppe[0]);
  const betreff = fuelle(regel.betreff || STANDARD_BETREFF,
    gruppe.length > 1 ? Object.assign({}, werte, { dateiname: gruppe.length + " Fotos" }) : werte);
  const text = gruppe.map((f) => fuelle(regel.text || STANDARD_TEXT, werteFuer(regel, f)))
    .join("\n" + "-".repeat(40) + "\n");
  const an = (regel.empfaenger || []).join(", ");

  const dateien = [];
  for (const f of gruppe) dateien.push(f.fertig || await fotoAufbereiten(f));

  try { await navigator.clipboard.writeText(an); } catch (e) { /* ohne Zwischenablage */ }

  if (navigator.canShare && navigator.canShare({ files: dateien })) {
    await navigator.share({ files: dateien, title: betreff, text: an + "\n\n" + text });
    return "geteilt";
  }
  // Ohne Teilen-Funktion: Mail mit Empfänger und Text öffnen, Fotos von Hand anhängen
  location.href = "mailto:" + encodeURIComponent(an)
    + "?subject=" + encodeURIComponent(betreff)
    + "&body=" + encodeURIComponent(text);
  return "mailto";
}

$("senden").onclick = async () => {
  const bereit = fotos.filter((f) => f.zustand === "bereit");
  if (!bereit.length) return;
  $("senden").disabled = true;

  const gruppen = new Map();
  for (const f of bereit) {
    if (!gruppen.has(f.regel.id)) gruppen.set(f.regel.id, []);
    gruppen.get(f.regel.id).push(f);
  }

  for (const [rid, gruppe] of gruppen) {
    const regel = regeln.find((r) => r.id === rid);
    if (!(regel.empfaenger || []).length) {
      toast("In der Regel „" + regel.name + "“ fehlt die Empfängeradresse.", true);
      continue;
    }
    try {
      const art = await anMailUebergeben(gruppe, regel);
      gruppe.forEach((f) => { f.zustand = "fertig"; });
      verlauf.unshift({
        zeit: new Date().toLocaleString("de-DE"),
        regel: regel.name, an: (regel.empfaenger || []).join(", "),
        dateien: gruppe.map((f) => f.name),
        ort: gruppe[0].ort || werteFuer(regel, gruppe[0]).koordinaten,
        art: art === "mailto" ? "Mail geöffnet (Fotos von Hand anhängen)" : "an Mail übergeben",
      });
      verlaufSichern();
      zeichneVerlauf();
      toast("Adresse ist in der Zwischenablage – im Empfängerfeld einfügen.");
    } catch (err) {
      if (err && err.name === "AbortError") toast("Abgebrochen.");
      else toast("Übergabe nicht möglich: " + err.message, true);
    }
  }
  zeichneFotos();
};

$("leeren").onclick = () => {
  fotos.forEach((f) => URL.revokeObjectURL(f.vorschau));
  fotos = [];
  zeichneFotos();
};

$("ziel").onchange = () => {
  const rid = $("ziel").value;
  if (!rid) {
    $("ziel-hinweis").textContent = "Automatisch: GeoPost liest die Geodaten aus jedem Foto "
      + "und nimmt die erste Regel, deren Umkreis passt.";
  } else {
    const r = regeln.find((x) => x.id === rid);
    $("ziel-hinweis").textContent = "Alle Fotos gehen an: "
      + ((r.empfaenger || []).join(", ") || "– in dieser Regel fehlt die Adresse –");
  }
  fotos.filter((f) => f.zustand !== "fertig").forEach(zuordnen);
  zeichneFotos();
  fotosNeuAufbereiten();
};

/* ---------------------------------------------------------------- Regeln */
function zeichneZiele() {
  const vorher = $("ziel").value;
  $("ziel").innerHTML = '<option value="">Automatisch nach Umkreis</option>'
    + regeln.filter((r) => r.aktiv).map((r) => `<option value="${r.id}">${esc(r.name)} → ${
      esc((r.empfaenger || []).join(", ") || "keine Adresse")}</option>`).join("");
  if (vorher) $("ziel").value = vorher;
}

function zeichneRegeln() {
  $("regeln").innerHTML = regeln.length ? regeln.map((r, i) => {
    const f = r.geofence || {};
    return `
    <div class="regel ${r.aktiv ? "" : "aus"}" data-bearbeiten="${r.id}">
      <div class="regel-kopf">
        <span class="nr">${i + 1}</span>
        <div class="mitte">
          <div class="titel">${esc(r.name)}${r.aktiv ? "" : " (aus)"}</div>
          <div class="detail">An: ${esc((r.empfaenger || []).join(", ") || "keine Adresse")}</div>
          <div class="detail">${f.aktiv
            ? (f.lat === null || f.lat === undefined
               ? "Umkreis ohne Mittelpunkt – bitte setzen"
               : "Umkreis " + esc(f.radius_m) + " m um " + Number(f.lat).toFixed(4) + ", "
                 + Number(f.lon).toFixed(4))
            : "nimmt jedes Foto"}</div>
        </div>
        <span class="pfeil">›</span>
      </div>
    </div>`;
  }).join("") : `<div class="leer"><p><strong>Noch keine Regel.</strong></p>
      <p class="hinweis">Lege eine an: Empfängeradresse eintragen, Umkreis um die Baustelle
      setzen – fertig.</p></div>`;

  $("regeln").querySelectorAll("[data-bearbeiten]").forEach((el) => {
    el.onclick = () => editorOeffnen(el.dataset.bearbeiten);
  });
}

$("regel-neu").onclick = () => {
  const r = neueRegel("Regel " + (regeln.length + 1));
  regeln.push(r);
  regelnSichern();
  zeichneRegeln();
  zeichneZiele();
  editorOeffnen(r.id);
};

/* ---------------------------------------------------------------- Regel-Editor */
const regel = () => regeln.find((r) => r.id === editorId);

function editorOeffnen(rid) {
  editorId = rid;
  const r = regel();
  if (!r) return;
  const f = r.geofence || (r.geofence = { aktiv: true, lat: null, lon: null, radius_m: 300 });
  $("editor-titel").textContent = r.name || "Regel";
  $("e-name").value = r.name || "";
  $("e-aktiv").checked = !!r.aktiv;
  $("e-empfaenger").value = (r.empfaenger || []).join(", ");
  $("e-geo-aktiv").checked = !!f.aktiv;
  $("e-geo-felder").hidden = !f.aktiv;
  $("e-lat").value = f.lat === null || f.lat === undefined ? "" : f.lat;
  $("e-lon").value = f.lon === null || f.lon === undefined ? "" : f.lon;
  $("e-radius").value = f.radius_m || 300;
  $("e-betreff").value = r.betreff || STANDARD_BETREFF;
  $("e-text").value = r.text || STANDARD_TEXT;
  $("e-karte").href = "https://www.google.com/maps?q=" + (f.lat || 0) + "," + (f.lon || 0);
  $("e-platzhalter").innerHTML = PLATZHALTER.map((p) =>
    `<button class="chip" data-platz="${p}">{${p}}</button>`).join("");
  $("e-platzhalter").querySelectorAll("[data-platz]").forEach((b) => {
    b.onclick = () => {
      const feld = $("e-text");
      const marke = "{" + b.dataset.platz + "}";
      const pos = feld.selectionStart != null ? feld.selectionStart : feld.value.length;
      feld.value = feld.value.slice(0, pos) + marke + feld.value.slice(pos);
      feld.focus();
      try { feld.selectionStart = feld.selectionEnd = pos + marke.length; } catch (e) { /* egal */ }
      regel().text = feld.value;
      regelnSichern();
    };
  });
  $("editor").hidden = false;
  $("sendeleiste").hidden = true;
}

function editorBinden() {
  const setz = (id, feld, art) => {
    const el = $(id);
    el.oninput = el.onchange = () => {
      const r = regel();
      if (!r) return;
      let wert = el.type === "checkbox" ? el.checked : el.value;
      if (art === "liste") {
        wert = String(wert).split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      } else if (art === "zahl") {
        wert = parseInt(wert, 10) || 0;
      } else if (art === "koordinate") {
        const paar = String(wert).split(",").map((s) => parseFloat(s.trim()));
        if (paar.length === 2 && !isNaN(paar[0]) && !isNaN(paar[1])) {
          r.geofence.lat = paar[0];
          r.geofence.lon = paar[1];
          $("e-lat").value = paar[0];
          $("e-lon").value = paar[1];
          regelnSichern();
          zeichneRegeln();
          return;
        }
        wert = wert === "" ? null : (parseFloat(wert) || 0);
      } else if (art === "kommazahl") {
        wert = wert === "" ? null : (parseFloat(wert) || 0);
      }

      if (feld.startsWith("geofence.")) r.geofence[feld.split(".")[1]] = wert;
      else r[feld] = wert;

      if (feld === "name") $("editor-titel").textContent = wert || "Regel";
      if (feld === "geofence.aktiv") $("e-geo-felder").hidden = !wert;
      regelnSichern();
      zeichneRegeln();
      zeichneZiele();
    };
  };
  setz("e-name", "name");
  setz("e-aktiv", "aktiv");
  setz("e-empfaenger", "empfaenger", "liste");
  setz("e-geo-aktiv", "geofence.aktiv");
  setz("e-lat", "geofence.lat", "koordinate");
  setz("e-lon", "geofence.lon", "kommazahl");
  setz("e-radius", "geofence.radius_m", "zahl");
  setz("e-betreff", "betreff");
  setz("e-text", "text");
}
editorBinden();

$("editor-zu").onclick = () => {
  $("editor").hidden = true;
  zeichneRegeln();
  zeichneZiele();
  fotos.filter((f) => f.zustand !== "fertig").forEach(zuordnen);
  zeichneFotos();
};

$("editor-loeschen").onclick = () => {
  const r = regel();
  if (!r || !confirm('Regel "' + (r.name || "") + '" wirklich löschen?')) return;
  regeln = regeln.filter((x) => x.id !== editorId);
  regelnSichern();
  $("editor").hidden = true;
  zeichneRegeln();
  zeichneZiele();
};

function verschieben(richtung) {
  const idx = regeln.findIndex((x) => x.id === editorId);
  const ziel = idx + richtung;
  if (ziel < 0 || ziel >= regeln.length) { toast("Geht nicht weiter."); return; }
  regeln.splice(ziel, 0, regeln.splice(idx, 1)[0]);
  regelnSichern();
  zeichneRegeln();
  toast("Jetzt an Platz " + (ziel + 1) + ".");
}
$("e-hoch").onclick = () => verschieben(-1);
$("e-runter").onclick = () => verschieben(1);

$("e-mein-standort").onclick = async () => {
  const knopf = $("e-mein-standort");
  knopf.disabled = true;
  knopf.textContent = "Standort wird ermittelt …";
  try {
    const s = await standortHolen();
    const r = regel();
    r.geofence.lat = s.lat;
    r.geofence.lon = s.lon;
    $("e-lat").value = s.lat;
    $("e-lon").value = s.lon;
    $("e-karte").href = "https://www.google.com/maps?q=" + s.lat + "," + s.lon;
    regelnSichern();
    zeichneRegeln();
    toast("Mittelpunkt gesetzt (auf " + s.genauigkeit + " m genau).");
  } catch (err) {
    toast(err.message, true);
  }
  knopf.disabled = false;
  knopf.textContent = "Mein jetziger Standort als Mittelpunkt";
};

$("e-koord-foto").onchange = async (ev) => {
  const datei = ev.target.files[0];
  ev.target.value = "";
  if (!datei) return;
  const daten = await fotoDatenLesen(datei);
  if (daten.lat === null) { toast("In diesem Foto stecken keine Geodaten.", true); return; }
  const r = regel();
  r.geofence.lat = daten.lat;
  r.geofence.lon = daten.lon;
  $("e-lat").value = daten.lat;
  $("e-lon").value = daten.lon;
  $("e-karte").href = "https://www.google.com/maps?q=" + daten.lat + "," + daten.lon;
  regelnSichern();
  zeichneRegeln();
  toast("Mittelpunkt aus dem Foto übernommen.");
};

/* ---------------------------------------------------------------- Verlauf */
function zeichneVerlauf() {
  $("verlauf").innerHTML = verlauf.length ? verlauf.slice(0, 60).map((e) => `
    <div class="eintrag">
      <div class="kopf"><span class="art">${esc(e.art)}</span><span>${esc(e.zeit)}</span></div>
      <div><strong>${esc(e.dateien.join(", "))}</strong></div>
      <div class="meta">An: ${esc(e.an)} · Regel: ${esc(e.regel)}</div>
      ${e.ort ? `<div class="meta">${esc(e.ort)}</div>` : ""}
    </div>`).join("")
    : "<p class='hinweis'>Noch nichts übergeben.</p>";
}

$("verlauf-leeren").onclick = () => {
  if (!verlauf.length || !confirm("Verlauf löschen?")) return;
  verlauf = [];
  verlaufSichern();
  zeichneVerlauf();
};

/* ---------------------------------------------------------------- Einstellungen */
function zeichneOptionen() {
  $("opt-geocode").checked = !!optionen.geocode;
  $("opt-standort").checked = !!optionen.standort;
  $("opt-kleiner").checked = !!optionen.kleiner;
  $("opt-stempel").checked = !!optionen.stempel;
}

async function fotosNeuAufbereiten() {
  for (const f of fotos) {
    if (f.zustand === "liest" || f.zustand === "fertig") continue;
    const neu = await fotoAufbereiten(f);
    if (neu !== f.fertig) {
      URL.revokeObjectURL(f.vorschau);
      f.fertig = neu;
      f.vorschau = URL.createObjectURL(neu);
    }
  }
  zeichneFotos();
}

["geocode", "standort", "kleiner", "stempel"].forEach((name) => {
  $("opt-" + name).onchange = () => {
    optionen[name] = $("opt-" + name).checked;
    optionenSichern();
    if (name === "stempel" || name === "kleiner") fotosNeuAufbereiten();
  };
});

$("export").onclick = () => {
  const inhalt = JSON.stringify({ app: "GeoPost", version: VERSION, regeln, optionen }, null, 2);
  const blob = new Blob([inhalt], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "geopost-regeln.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast("Sicherung erstellt.");
};

$("import").onchange = async (ev) => {
  const datei = ev.target.files[0];
  ev.target.value = "";
  if (!datei) return;
  try {
    const daten = JSON.parse(await datei.text());
    if (!Array.isArray(daten.regeln)) throw new Error("keine Regeln in der Datei");
    if (!confirm("Sicherung einlesen? Die jetzigen Regeln werden ersetzt.")) return;
    regeln = daten.regeln;
    if (daten.optionen) optionen = Object.assign(optionen, daten.optionen);
    regelnSichern();
    optionenSichern();
    zeichneRegeln();
    zeichneZiele();
    zeichneOptionen();
    toast(regeln.length + " Regel(n) eingelesen.");
  } catch (err) {
    toast("Datei konnte nicht gelesen werden.", true);
  }
};

/* ---------------------------------------------------------------- Rahmen */
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("aktiv", x === t));
    document.querySelectorAll(".seite").forEach((s) =>
      s.classList.toggle("aktiv", s.id === "seite-" + t.dataset.seite));
    zeichneFotos();
    window.scrollTo(0, 0);
  };
});

function zeichneInstallation() {
  const schon = window.navigator.standalone
    || window.matchMedia("(display-mode: standalone)").matches;
  $("install-status").textContent = schon
    ? "GeoPost läuft bereits als App auf diesem Gerät."
    : "";
  $("version").textContent = "Fassung " + VERSION;
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* ohne Offline-Betrieb */ });
}

window.addEventListener("resize", kopfhoeheSetzen);

regeln = lies(SCHLUESSEL.regeln, []);
optionen = Object.assign(optionen, lies(SCHLUESSEL.opt, {}));
verlauf = lies(SCHLUESSEL.verlauf, []);
zeichneZiele();
zeichneRegeln();
zeichneVerlauf();
zeichneOptionen();
zeichneFotos();
zeichneInstallation();
