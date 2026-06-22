/* figurer.js — figurer for varmeflex.dk (increment 2).
 *
 * Tegner dispatch (stacked areal), tankniveau, spotpris og balancepriser med
 * uPlot (vendéret lokalt i vendor/, intet runtime-CDN). Alle serier kommer fra
 * manifestets ægte _serier (inkluder_serier=true) — aldrig pyntetal.
 *
 * Periodevælger: Fra/Til-datofelter + hurtigknapper (hele året, kvartaler)
 * zoomer ALLE figurer via uPlot's x-skala (y-aksen genberegnes for den synlige
 * periode). Træk-zoom i én figur følger de andre og opdaterer datofelterne.
 *
 * Bygger ovenpå increment 1 uden at røre api.js/app.js' eksisterende logik:
 * app.js kalder VarmeflexFigurer.tegn(manifest) efter nøgletal + tabel.
 *
 * Fysisk-gyldige + markedspris-figurer. IKKE balance-REVENUE/-split — den er
 * ramt af modelfejlen (jf. STATUS). Spot- og balancePRISER er markedsdata
 * (input), ikke modelberegnede indtægter, og er derfor gyldige at vise.
 */
(function (global) {
  "use strict";

  // --- Enhedspalet: ÉT sted, genbrugt i figur + legende -------------------
  // Stak-rækkefølge = definitionsrækkefølge (grundlast/VE nederst).
  var ENHEDER = [
    { key: "p_vp_luft_vand_mw",  navn: "Varmepumpe (luft/vand)", farve: "#2f6f5e" },
    { key: "p_elkedel_ny_mw",    navn: "Elkedel (ny)",           farve: "#3d6da8" },
    { key: "p_elkedel_gl_mw",    navn: "Elkedel (gl.)",          farve: "#7d9cc0" },
    { key: "p_fliskedel_mw",     navn: "Fliskedel",              farve: "#8a6d3b" },
    { key: "p_halmkedel_mw",     navn: "Halmkedel",              farve: "#c2a14d" },
    { key: "p_gasmotor_mw",      navn: "Gasmotor",               farve: "#b5694e" },
    { key: "p_gaskedel_agg_mw",  navn: "Gaskedel",               farve: "#8c8c8c" },
  ];
  var BEHOV_KEY = "heat_load_mw";
  var TANK_KEY = "tank_eksisterende_level_mwh";
  var SPOT_KEY = "spot_price_dkk_mwh";
  var AFRR_CAP_KEY = "afrr_cap_up_dkk_mw_h";
  var MFRR_CAP_KEY = "mfrr_cap_up_dkk_mw_h";
  var AFRR_ACT_KEY = "afrr_act_up_dkk_mwh";
  var MFRR_ACT_KEY = "mfrr_act_up_dkk_mwh";

  // --- Talformat (da-DK, tabulær i tooltips via CSS) -----------------------
  var nf1 = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nf0 = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 });

  function rgba(hex, a) {
    var n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }

  // --- Konvertering: _serier (strenge) → tal-arrays ------------------------
  function tal(arr) {
    var n = arr ? arr.length : 0, ud = new Float64Array(n);
    for (var i = 0; i < n; i++) { var v = parseFloat(arr[i]); ud[i] = isFinite(v) ? v : 0; }
    return ud;
  }
  // Positiv-kun variant til log-skala: værdier ≤ 0 (eller ikke-endelige) → null,
  // så linjen får et HUL i timer uden (positiv) aktivering frem for at vælte
  // log-skalaen. Bruger almindelig Array (ikke Float64Array), da null skal bevares.
  function talPositiv(arr) {
    var n = arr ? arr.length : 0, ud = new Array(n);
    for (var i = 0; i < n; i++) { var v = parseFloat(arr[i]); ud[i] = (isFinite(v) && v > 0) ? v : null; }
    return ud;
  }
  function tidssekunder(ts) {
    var n = ts ? ts.length : 0, ud = new Float64Array(n);
    for (var i = 0; i < n; i++) { ud[i] = Date.parse(ts[i]) / 1000; }
    return ud;
  }
  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }

  // --- Dato <-> sekunder (lokal tid; matcher <input type=date>) -----------
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function isoFraSek(sek) {
    var d = new Date(sek * 1000);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function sekFraDato(str, slutPaaDagen) {
    var p = str.split("-");
    var d = slutPaaDagen
      ? new Date(+p[0], +p[1] - 1, +p[2], 23, 59, 59)
      : new Date(+p[0], +p[1] - 1, +p[2], 0, 0, 0);
    return d.getTime() / 1000;
  }

  // --- Tilstand -----------------------------------------------------------
  var instanser = [];     // [{u, el}] — alle figurer
  var tFuld = null;       // [min, max] sekunder for hele perioden
  var laasSync = false;   // reentrans-vagt ved skala-synkronisering

  function ryd() {
    instanser.forEach(function (o) { try { o.u.destroy(); } catch (e) {} });
    instanser = [];
  }

  // Dansk dato-akse.
  var datoFmt = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" });
  function aksedatoer(u, splits) {
    return splits.map(function (s) { return datoFmt.format(new Date(s * 1000)); });
  }
  function bredde(el) { return Math.max(280, el.clientWidth); }

  // Fælles akser + cursor + skala-sync-hook. yFra0=true tvinger 0-baseline
  // (mængder); false giver auto-range der også rummer negative priser.
  function basisOpts(el, hoejde, yLabel, yFra0) {
    var opts = {
      width: bredde(el),
      height: hoejde,
      cursor: { drag: { x: true, y: false } },
      hooks: { setScale: [function (u, key) {
        if (key !== "x" || laasSync) return;
        // Træk-zoom/reset i én figur → synkronisér de andre + datofelterne.
        laasSync = true;
        var sc = u.scales.x;
        instanser.forEach(function (o) { if (o.u !== u) o.u.setScale("x", { min: sc.min, max: sc.max }); });
        opdaterInputs(sc.min, sc.max);
        laasSync = false;
      }] },
      axes: [
        { values: aksedatoer, grid: { stroke: "#ededea" }, ticks: { stroke: "#d8d8d4" }, stroke: "#5b6168" },
        { label: yLabel, grid: { stroke: "#ededea" }, ticks: { stroke: "#d8d8d4" }, stroke: "#5b6168",
          values: function (u, s) { return s.map(function (v) { return nf0.format(v); }); } },
      ],
    };
    if (yFra0) {
      opts.scales = { y: { range: function (u, min, max) { return [0, (max || 1) * 1.05]; } } };
    }
    return opts;
  }

  function tilfoej(opts, data, el) { instanser.push({ u: new global.uPlot(opts, data, el), el: el }); }

  // --- Dispatch: stacked areal + behovslinje -------------------------------
  function tegnDispatch(el, serier, x) {
    var aktive = ENHEDER
      .filter(function (e) { return serier[e.key]; })
      .map(function (e) { return { def: e, vals: tal(serier[e.key]) }; })
      .filter(function (e) { return sum(e.vals) > 0.01; });

    var data = [x];
    var prev = null;
    aktive.forEach(function (e) {
      var n = x.length, cum = new Float64Array(n);
      for (var j = 0; j < n; j++) cum[j] = (prev ? prev[j] : 0) + e.vals[j];
      data.push(cum);
      prev = cum;
    });
    data.push(tal(serier[BEHOV_KEY]));

    var series = [{}];
    aktive.forEach(function (e) {
      series.push({
        label: e.def.navn,
        stroke: e.def.farve,
        fill: rgba(e.def.farve, 0.5),
        width: 1,
        points: { show: false },
        // Legendeværdi = enhedens EGEN MW (de-kumuleret), ikke stak-summen.
        value: function (self, _v, si, di) {
          if (di == null) return "–";
          var egen = self.data[si][di] - (si > 1 ? self.data[si - 1][di] : 0);
          return nf1.format(egen) + " MW";
        },
      });
    });
    series.push({
      label: "Varmebehov", stroke: "#1c1f23", width: 1.5, dash: [4, 3], fill: null,
      points: { show: false },
      value: function (self, v) { return v == null ? "–" : nf1.format(v) + " MW"; },
    });

    var bands = [];
    for (var m = 2; m <= aktive.length; m++) bands.push({ series: [m, m - 1] });

    var opts = basisOpts(el, 340, "MW", true);
    opts.title = "Varmeproduktion pr. enhed (dispatch)";
    opts.series = series;
    opts.bands = bands;
    tilfoej(opts, data, el);
  }

  // --- Tankniveau: linje (eller pæn besked uden tank) ----------------------
  function tegnTank(el, serier, x) {
    if (!serier[TANK_KEY]) {
      el.innerHTML = '<p class="fig-tom">Ingen tank i dette scenarie.</p>';
      return;
    }
    var opts = basisOpts(el, 220, "MWh", true);
    opts.title = "Tankniveau (lager)";
    opts.series = [
      {},
      { label: "Tankniveau", stroke: "#2f6f5e", fill: rgba("#2f6f5e", 0.12), width: 1.25,
        points: { show: false },
        value: function (self, v) { return v == null ? "–" : nf0.format(v) + " MWh"; } },
    ];
    tilfoej(opts, [x, tal(serier[TANK_KEY])], el);
  }

  function prisVaerdi(enhed) {
    return function (self, v) { return v == null ? "–" : nf0.format(v) + " " + enhed; };
  }

  // --- Spotpris (elmarked) — alle scenarier; kan være negativ -------------
  function tegnSpot(el, serier, x) {
    if (!serier[SPOT_KEY]) {
      el.innerHTML = '<p class="fig-tom">Ingen spotpris i dette manifest.</p>';
      return;
    }
    var opts = basisOpts(el, 220, "kr./MWh", false);
    opts.title = "Spotpris (elmarked)";
    opts.series = [
      {},
      { label: "Spotpris", stroke: "#3d6da8", width: 1, points: { show: false },
        value: prisVaerdi("kr./MWh") },
    ];
    tilfoej(opts, [x, tal(serier[SPOT_KEY])], el);
  }

  // --- Balancepriser (kapacitet, aFRR/mFRR) — kun med balancemarked -------
  function tegnBalance(el, serier, x) {
    if (!serier[AFRR_CAP_KEY] && !serier[MFRR_CAP_KEY]) {
      el.innerHTML = '<p class="fig-tom">Ingen balancemarked i dette scenarie.</p>';
      return;
    }
    var opts = basisOpts(el, 220, "kr./MW/h", false);
    opts.title = "Balancepriser — kapacitet (aFRR/mFRR)";
    opts.series = [
      {},
      { label: "aFRR kapacitet", stroke: "#2f6f5e", width: 1, points: { show: false },
        value: prisVaerdi("kr./MW/h") },
      { label: "mFRR kapacitet", stroke: "#b5694e", width: 1, points: { show: false },
        value: prisVaerdi("kr./MW/h") },
    ];
    tilfoej(opts, [x, tal(serier[AFRR_CAP_KEY]), tal(serier[MFRR_CAP_KEY])], el);
  }

  // --- Balancepriser (aktivering, aFRR/mFRR) på log-skala — kun balancemarked
  // Aktiveringsprisen spænder fra ~10 til titusinder kr./MWh; log-aksen med faste
  // dekade-ticks (10–100.000) gør både det normale bånd og spidserne læselige.
  // Timer uden positiv aktivering (0 eller de få negative ned-pris-timer) bliver
  // huller — log-skalaen kan ikke vise ≤ 0. Figurteksten siger det ærligt.
  function tegnAktivering(el, serier, x) {
    var harA = !!serier[AFRR_ACT_KEY], harM = !!serier[MFRR_ACT_KEY];
    if (!harA && !harM) {
      el.innerHTML = '<p class="fig-tom">Ingen balancemarked i dette scenarie.</p>';
      return;
    }
    var opts = basisOpts(el, 220, "kr./MWh", false);
    opts.title = "Balancepriser — aktivering (aFRR/mFRR), log-skala";
    // Log-skala med fast bund (10) og top mindst 100.000, så dekaderne er stabile
    // også ved zoom; ≤ 0 er allerede filtreret til null af talPositiv.
    opts.scales = {
      y: { distr: 3, log: 10, range: function (u, _min, max) { return [10, Math.max(100000, max * 1.1)]; } },
    };
    // Faste dekade-ticks; nf0-formatering arves fra basisOpts (→ "100.000").
    opts.axes[1].splits = function () { return [10, 100, 1000, 10000, 100000]; };

    var series = [{}], data = [x];
    if (harA) {
      series.push({ label: "aFRR aktivering", stroke: "#2f6f5e", width: 1, points: { show: false },
        value: prisVaerdi("kr./MWh") });
      data.push(talPositiv(serier[AFRR_ACT_KEY]));
    }
    if (harM) {
      series.push({ label: "mFRR aktivering", stroke: "#b5694e", width: 1, points: { show: false },
        value: prisVaerdi("kr./MWh") });
      data.push(talPositiv(serier[MFRR_ACT_KEY]));
    }
    opts.series = series;
    tilfoej(opts, data, el);

    // Figurtekst (ærlig om hullerne) — inline-stylet, ingen ny CSS.
    el.insertAdjacentHTML("beforeend",
      '<p style="margin:2px 2px 0;font-size:12px;font-style:italic;color:var(--tekst-mat)">' +
      "Log-skala. Kun timer med positiv op-aktivering vises; timer uden aktivering " +
      "(og de få timer med negativ pris) fremstår som huller, da log-skalaen ikke " +
      "kan vise nul eller negative værdier.</p>");
  }

  // --- Periodevælger -------------------------------------------------------
  function saetPeriode(t0, t1) {
    if (!(t1 > t0)) return;
    laasSync = true;
    instanser.forEach(function (o) { o.u.setScale("x", { min: t0, max: t1 }); });
    laasSync = false;
    opdaterInputs(t0, t1);
  }

  function opdaterInputs(t0, t1) {
    var fra = document.getElementById("fig-fra");
    var til = document.getElementById("fig-til");
    if (fra) fra.value = isoFraSek(t0);
    if (til) til.value = isoFraSek(t1);
  }

  function kvartaler() {
    var aar = new Date(tFuld[0] * 1000).getFullYear();
    return [
      { navn: "K1", fra: aar + "-01-01", til: aar + "-03-31" },
      { navn: "K2", fra: aar + "-04-01", til: aar + "-06-30" },
      { navn: "K3", fra: aar + "-07-01", til: aar + "-09-30" },
      { navn: "K4", fra: aar + "-10-01", til: aar + "-12-31" },
    ];
  }

  function monterPeriodevaelger() {
    var el = document.getElementById("fig-periode");
    if (!el) return;
    var d0 = isoFraSek(tFuld[0]), d1 = isoFraSek(tFuld[1]);
    var knapper = kvartaler().map(function (k) {
      return '<button type="button" class="fig-preset" data-fra="' + k.fra + '" data-til="' + k.til + '">' + k.navn + "</button>";
    }).join("");
    el.innerHTML =
      '<span class="fig-periode__navn">Periode</span>' +
      '<label class="fig-periode__felt">Fra <input type="date" id="fig-fra" min="' + d0 + '" max="' + d1 + '" value="' + d0 + '"></label>' +
      '<label class="fig-periode__felt">Til <input type="date" id="fig-til" min="' + d0 + '" max="' + d1 + '" value="' + d1 + '"></label>' +
      '<span class="fig-presets">' + knapper +
      '<button type="button" class="fig-preset" id="fig-nulstil">Hele perioden</button></span>';

    function fraInputs() {
      var fra = document.getElementById("fig-fra").value;
      var til = document.getElementById("fig-til").value;
      if (!fra || !til) return;
      saetPeriode(sekFraDato(fra, false), sekFraDato(til, true));
    }
    document.getElementById("fig-fra").addEventListener("change", fraInputs);
    document.getElementById("fig-til").addEventListener("change", fraInputs);
    document.getElementById("fig-nulstil").addEventListener("click", function () {
      saetPeriode(tFuld[0], tFuld[1]);
    });
    Array.prototype.forEach.call(el.querySelectorAll(".fig-preset[data-fra]"), function (b) {
      b.addEventListener("click", function () {
        saetPeriode(sekFraDato(b.dataset.fra, false), sekFraDato(b.dataset.til, true));
      });
    });
  }

  // --- Offentlig API -------------------------------------------------------
  function tegn(manifest) {
    ryd();
    var serier = manifest && manifest._serier;
    var elP = document.getElementById("fig-periode");
    var elD = document.getElementById("fig-dispatch");
    var elT = document.getElementById("fig-tank");
    var elS = document.getElementById("fig-spot");
    var elB = document.getElementById("fig-balance");
    var elA = document.getElementById("fig-aktivering");
    if (!serier || !serier.timestamp || !elD) {
      if (elP) elP.innerHTML = "";
      if (elD) elD.innerHTML = '<p class="fig-tom">Ingen timeserier i dette manifest.</p>';
      return;
    }
    var x = tidssekunder(serier.timestamp);
    tFuld = [x[0], x[x.length - 1]];
    tegnDispatch(elD, serier, x);
    if (elT) tegnTank(elT, serier, x);
    if (elS) tegnSpot(elS, serier, x);
    if (elB) tegnBalance(elB, serier, x);
    if (elA) tegnAktivering(elA, serier, x);
    monterPeriodevaelger();
  }

  // Tilpas bredde ved vinduesændring (uPlot kræver eksplicit størrelse).
  var resizeTimer = null;
  global.addEventListener("resize", function () {
    if (!instanser.length) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      instanser.forEach(function (o) { o.u.setSize({ width: bredde(o.el), height: o.u.height }); });
    }, 150);
  });

  global.VarmeflexFigurer = { tegn: tegn, ENHEDER: ENHEDER };
})(window);
