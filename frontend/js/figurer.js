/* figurer.js — figurer for varmeflex.dk (increment 2).
 *
 * Tegner dispatch (stakkede søjler), tankniveau, spotpris og balancepriser med
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
  // Dispatch-figuren aggregerer søjlerne efter zoom-niveau. Vi gemmer rådata
  // her, så setScale-hook'en kan ombucke (uge/dag/time) uden at tegne om.
  var dispatch = null;    // {instans, x, aktive:[{def,vals}], behov, gran, egne, captionEl}

  function ryd() {
    instanser.forEach(function (o) { try { o.u.destroy(); } catch (e) {} });
    instanser = [];
    dispatch = null;
  }

  // --- Dispatch-aggregering (middel-effekt pr. bucket) ---------------------
  // Tærskler: helår-ish → uge; kvartal/måned → dag; under en uge → time.
  // (Et kvartal ~91 dage skal vise DAGE, så uge-tærsklen ligger over kvartalet.)
  var DAG_S = 86400, UGE_S = 7 * DAG_S;
  function vaelgGran(span) {
    if (span > 100 * DAG_S) return "uge";   // over ~3,3 mdr.
    if (span >= UGE_S)      return "dag";    // 1 uge–3 mdr. (inkl. kvartaler)
    return "time";
  }
  function dagStart(sek) {
    var d = new Date(sek * 1000);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() / 1000;
  }
  function ugeStart(sek) {
    var d = new Date(sek * 1000);
    var ma = (d.getDay() + 6) % 7; // 0=mandag
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ma).getTime() / 1000;
  }

  // Byg uPlot-data for en granularitet. Returnerer {data, egne}: data =
  // [x, top_topførst…, behov]; egne = {uPlot-serieindeks → enhedens egen
  // middel-effekt} (til legendeværdier, da data kun bærer kumulerede toppe).
  function byggDispatchData(gran) {
    var units = dispatch.aktive, rx = dispatch.x, behov = dispatch.behov;
    var xb, ownArrs, behovB;
    if (gran === "time") {
      xb = rx;
      ownArrs = units.map(function (u) { return u.vals; });
      behovB = behov;
    } else {
      var keyFn = gran === "uge" ? ugeStart : dagStart;
      var off = (gran === "uge" ? UGE_S : DAG_S) / 2;   // bucket-CENTER → søjlen tiler pænt
      var n = rx.length, idxOf = {}, keys = [], bidx = new Int32Array(n);
      for (var i = 0; i < n; i++) {
        var ks = keyFn(rx[i]); var bi = idxOf[ks];
        if (bi === undefined) { bi = keys.length; idxOf[ks] = bi; keys.push(ks); }
        bidx[i] = bi;
      }
      var B = keys.length;
      xb = new Float64Array(B);
      for (var b = 0; b < B; b++) xb[b] = keys[b] + off;
      var cnt = new Float64Array(B);
      for (var i2 = 0; i2 < n; i2++) cnt[bidx[i2]]++;
      var middel = function (vals) {
        var s = new Float64Array(B);
        for (var i3 = 0; i3 < n; i3++) s[bidx[i3]] += vals[i3];
        for (var b2 = 0; b2 < B; b2++) s[b2] = cnt[b2] ? s[b2] / cnt[b2] : 0;
        return s;
      };
      ownArrs = units.map(function (u) { return middel(u.vals); });
      behovB = middel(behov);
    }
    // Kumulerede toppe i stak-rækkefølge (bund-først), derefter top-først til paint-order.
    var L = xb.length, prev = null, tops = [];
    ownArrs.forEach(function (own) {
      var c = new Float64Array(L);
      for (var j = 0; j < L; j++) c[j] = (prev ? prev[j] : 0) + own[j];
      tops.push(c); prev = c;
    });
    var data = [xb], egne = {};
    for (var k = tops.length - 1; k >= 0; k--) { data.push(tops[k]); egne[data.length - 1] = ownArrs[k]; }
    data.push(behovB);
    return { data: data, egne: egne };
  }

  function granTekst(gran) {
    var hvad = gran === "uge" ? "uge" : gran === "dag" ? "dag" : "time";
    return "Søjler aggregeret pr. " + hvad + " (gennemsnitlig effekt). Zoom for finere opløsning.";
  }

  function opdaterDispatchAgg(t0, t1) {
    if (!dispatch || !dispatch.instans) return;
    var gran = vaelgGran(t1 - t0);
    if (gran === dispatch.gran) return;     // uændret granularitet → intet at gøre
    dispatch.gran = gran;
    var r = byggDispatchData(gran);
    dispatch.egne = r.egne;
    var u = dispatch.instans, xmin = u.scales.x.min, xmax = u.scales.x.max;
    laasSync = true;
    u.setData(r.data);                       // nulstiller skalaer (y fitter hele)…
    u.setScale("x", { min: xmin, max: xmax }); // …gendan zoom; y re-fitter det synlige
    laasSync = false;
    if (dispatch.captionEl) dispatch.captionEl.textContent = granTekst(gran);
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
        opdaterDispatchAgg(sc.min, sc.max);  // ombuk dispatch-søjlerne til nyt zoom-niveau
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

  // --- Dispatch: stakkede søjler (adaptiv aggregering) + behovslinje --------
  // Søjle-stak uden bands: hver enheds serie er den KUMULEREDE top, tegnet som
  // søjle fra 0. Serierne lægges TOP-først, så den nederste enhed tegnes sidst
  // og overmaler den lave del af de højere søjler (paint-order-stak) — korrekt
  // uafhængigt af uPlots band-opførsel med søjle-paths.
  // Søjlerne aggregeres efter zoom-niveau (uge/dag/time, se opdaterDispatchAgg),
  // så bredden altid passer skalaen. size 0.9 → brede søjler ved få buckets.
  var soejler = (global.uPlot.paths && global.uPlot.paths.bars)
    ? global.uPlot.paths.bars({ size: [0.9, Infinity] }) : null;

  function tegnDispatch(el, serier, x) {
    var aktive = ENHEDER
      .filter(function (e) { return serier[e.key]; })
      .map(function (e) { return { def: e, vals: tal(serier[e.key]) }; })
      .filter(function (e) { return sum(e.vals) > 0.01; });

    // Dispatch-tilstand: rådata til ombucketing ved zoom.
    dispatch = { instans: null, x: x, aktive: aktive, behov: tal(serier[BEHOV_KEY]),
                 gran: vaelgGran(tFuld[1] - tFuld[0]), egne: null, captionEl: null };
    var r = byggDispatchData(dispatch.gran);
    dispatch.egne = r.egne;

    // Serier (top-først, så de matcher data fra byggDispatchData). Legendeværdi
    // læses fra dispatch.egne[si], der opdateres ved hver ombucketing.
    var rev = aktive.slice().reverse();
    var series = [{}];
    rev.forEach(function (e, ri) {
      var si = ri + 1;
      series.push({
        label: e.def.navn,
        stroke: e.def.farve,
        // OPAK fyld: paint-order-stakken overmaler, så halvgennemsigtigt fyld
        // ville lægge sig oven på sig selv og gøre bunden mørkere.
        fill: e.def.farve,
        width: 0,
        paths: soejler || undefined,
        points: { show: false },
        value: (function (idx) {
          return function (self, _v, _si, di) {
            var a = dispatch.egne && dispatch.egne[idx];
            return (di == null || !a) ? "–" : nf1.format(a[di]) + " MW";
          };
        })(si),
      });
    });
    series.push({
      label: "Varmebehov", stroke: "#1c1f23", width: 1.5, dash: [4, 3], fill: null,
      points: { show: false },
      value: function (self, v) { return v == null ? "–" : nf1.format(v) + " MW"; },
    });

    var opts = basisOpts(el, 340, "MW", true);
    opts.title = "Varmeproduktion pr. enhed (dispatch)";
    opts.series = series;
    var u = new global.uPlot(opts, r.data, el);
    instanser.push({ u: u, el: el });
    dispatch.instans = u;
    // Aggregerede buckets har et lidt smallere x-spænd end råtimerne; lås x til
    // hele perioden, så dispatch er synkron med de øvrige (time-)figurer fra start.
    laasSync = true;
    u.setScale("x", { min: tFuld[0], max: tFuld[1] });
    laasSync = false;
    // Lille caption der fortæller den aktuelle aggregering (opdateres ved zoom).
    el.insertAdjacentHTML("beforeend",
      '<p style="margin:2px 2px 0;font-size:12px;font-style:italic;color:var(--tekst-mat)">' +
      granTekst(dispatch.gran) + "</p>");
    dispatch.captionEl = el.lastElementChild;
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
    opdaterDispatchAgg(t0, t1);  // ombuk dispatch-søjlerne til nyt zoom-niveau
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
