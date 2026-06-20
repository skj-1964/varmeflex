/* app.js — UI-laget for varmeflex.dk (increment 1).
 *
 * Én side, to views skiftet af auth-tilstand: login-view og app-view.
 * Ved load forsøges scenarie-kataloget hentet; lykkes det, er sessionen
 * gyldig (cookien er HttpOnly og kan ikke læses fra JS) → app-view. Et 401
 * (AuthFejl) → login-view.
 *
 * Omfang i increment 1: stillads + login-gate + scenarie-menu +
 * manifest-detalje som tekst/tabel. INGEN figurer, INGEN chat.
 */
(function () {
  "use strict";

  var API = window.VarmeflexAPI;

  // --- DOM-referencer ------------------------------------------------------
  var elLoginView = document.getElementById("login-view");
  var elAppView   = document.getElementById("app-view");
  var elLoginForm = document.getElementById("login-form");
  var elLoginKode = document.getElementById("login-kode");
  var elLoginFejl = document.getElementById("login-fejl");
  var elLoginKnap = document.getElementById("login-knap");
  var elListe     = document.getElementById("scenarie-liste");
  var elDetalje   = document.getElementById("detalje");
  var elDetaljeTom= document.getElementById("detalje-tom");

  var valgtId = null;

  // --- Talformatering (da-DK) ---------------------------------------------
  var nfHel  = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 });
  var nf1    = new Intl.NumberFormat("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function tal(v, decimaler) {
    if (v === null || v === undefined || v === "") return "—";
    var n = Number(v);
    if (!isFinite(n)) return "—";
    return (decimaler === 1 ? nf1 : nfHel).format(n);
  }
  /** Beløb i hele kroner (store tal → tusind-separatorer). */
  function kr(v) {
    if (v === null || v === undefined) return "—";
    var n = Number(v);
    if (!isFinite(n)) return "—";
    return nfHel.format(Math.round(n));
  }
  function jaNej(b) { return b ? "Ja" : "Nej"; }

  /** Minimal HTML-escaping til tekst fra manifestet. */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // --- View-skift ----------------------------------------------------------
  function visLogin() {
    elAppView.hidden = true;
    elLoginView.hidden = false;
    elLoginKode.focus();
  }
  function visApp() {
    elLoginView.hidden = true;
    elAppView.hidden = false;
  }

  function loginFejl(besked) {
    elLoginFejl.textContent = besked;
    elLoginFejl.hidden = false;
  }
  function ryddLoginFejl() {
    elLoginFejl.hidden = true;
    elLoginFejl.textContent = "";
  }

  // --- Scenarie-menu -------------------------------------------------------
  function tegnMenu(scenarier) {
    elListe.innerHTML = "";
    if (!scenarier.length) {
      var tom = document.createElement("li");
      tom.className = "menu__hjaelp";
      tom.textContent = "Ingen scenarier fundet i kataloget.";
      elListe.appendChild(tom);
      return;
    }
    scenarier.forEach(function (s) {
      var li = document.createElement("li");
      var knap = document.createElement("button");
      knap.type = "button";
      knap.className = "menu__knap";
      knap.dataset.id = s.scenarie_id;
      knap.setAttribute("aria-current", s.scenarie_id === valgtId ? "true" : "false");

      var titel = document.createElement("span");
      titel.className = "menu__titel";
      titel.textContent = s.titel || s.scenarie_id;
      knap.appendChild(titel);

      if (s.variant_label) {
        var v = document.createElement("span");
        v.className = "menu__variant";
        v.textContent = s.variant_label;
        knap.appendChild(v);
      }

      knap.addEventListener("click", function () { vaelgScenarie(s.scenarie_id); });
      li.appendChild(knap);
      elListe.appendChild(li);
    });
  }

  function markerAktiv(id) {
    var knapper = elListe.querySelectorAll(".menu__knap");
    Array.prototype.forEach.call(knapper, function (k) {
      k.setAttribute("aria-current", k.dataset.id === id ? "true" : "false");
    });
  }

  // --- Detaljepanel --------------------------------------------------------
  function vaelgScenarie(id) {
    valgtId = id;
    markerAktiv(id);
    elDetaljeTom.hidden = true;
    elDetalje.hidden = false;
    elDetalje.innerHTML = '<div class="tom-besked">Henter …</div>';

    // inkluder_serier=true: timeserierne skal med, så figurerne kan tegnes.
    API.scenarie(id, true).then(function (m) {
      tegnDetalje(m);
    }).catch(function (fejl) {
      if (fejl instanceof API.AuthFejl) { visLogin(); return; }
      elDetalje.innerHTML = '<div class="fejl">' + esc(fejl.message) + "</div>";
    });
  }

  function dlRaekke(navn, vaerdiHtml) {
    return "<dt>" + esc(navn) + "</dt><dd>" + vaerdiHtml + "</dd>";
  }

  function merkerHtml(liste) {
    if (!liste || !liste.length) return '<span class="tekst-svag">—</span>';
    return '<span class="merker">' + liste.map(function (x) {
      return '<span class="merke kode">' + esc(x) + "</span>";
    }).join("") + "</span>";
  }

  function kpi(navn, vaerdi, enhed, ekstraKlasse, bi) {
    return '<div class="kpi ' + (ekstraKlasse || "") + '">' +
      '<div class="kpi__navn">' + esc(navn) + "</div>" +
      '<div class="kpi__vaerdi">' + vaerdi +
        (enhed ? '<span class="kpi__enhed">' + esc(enhed) + "</span>" : "") + "</div>" +
      (bi ? '<div class="kpi__bi">' + bi + "</div>" : "") +
      "</div>";
  }

  function tegnDetalje(m) {
    var meta = m.meta || {};
    var ko   = m.koersel || {};
    var spor = m.sporbarhed || {};
    var n    = m.noegletal || {};
    var bal  = n.balanceindtaegt_dkk || {};
    var periode = ko.periode || {};

    var h = "";

    // Hoved: titel + beskrivelse
    h += '<div class="detalje__hoved">';
    h += '<h2 class="detalje__titel">' + esc(meta.titel || m.scenarie_id) + "</h2>";
    if (meta.beskrivelse) {
      h += '<p class="detalje__beskrivelse">' + esc(meta.beskrivelse.trim()) + "</p>";
    }
    h += "</div>";

    // Kørsel
    var pTekst = (periode.start || "?") + " – " + (periode.slut || "?") +
                 (periode.oploesning ? " · " + esc(periode.oploesning) : "");
    h += '<div class="sektion"><div class="sektion__titel">Kørsel</div><dl class="dl">';
    h += dlRaekke("Periode", '<span class="tal">' + esc(pTekst) + "</span>");
    h += dlRaekke("Med balancemarked", jaNej(ko.med_balancering));
    h += dlRaekke("Enheder fra", merkerHtml(ko.enheder_fra));
    h += "</dl></div>";

    // Sporbarhed
    h += '<div class="sektion"><div class="sektion__titel">Sporbarhed</div><dl class="dl">';
    h += dlRaekke("Model-commit", '<span class="kode">' + esc(spor.model_commit || "—") + "</span>");
    h += dlRaekke("Solve-status", esc(spor.solve_status || "—") +
                  (spor.model_type ? " · " + esc(spor.model_type) : ""));
    h += "</dl></div>";

    // Nøgletal
    h += '<div class="sektion"><div class="sektion__titel">Nøgletal</div><div class="kpis">';
    h += kpi("Objektiv", kr(n.objektiv_dkk), "kr.");
    h += kpi("Varmeefterspørgsel", tal(n.varmeefterspoergsel_mwh, 1), "MWh");
    h += kpi("Samlet produktion", tal(n.samlet_produktion_mwh, 1), "MWh");
    h += kpi("Nettab", tal(n.nettab_mwh, 1), "MWh", "",
             '<span class="tal">' + tal(n.nettab_pct, 1) + " %</span> af produktion");
    h += kpi("CO₂", tal(n.co2_ton, 1), "ton");
    h += kpi("Tank-arbitrage", n.tank_arbitrage_dkk == null ? "—" : kr(n.tank_arbitrage_dkk),
             n.tank_arbitrage_dkk == null ? "" : "kr.", "kpi--mat",
             n.tank_arbitrage_dkk == null ? "ikke gældende ved MILP (ingen duals)" : "");

    // Balanceindtægt — markeret "under validering" (modelfejl, jf. STATUS)
    var balBi = 'aFRR <span class="tal">' + kr(bal.afrr) + "</span> · " +
                'mFRR <span class="tal">' + kr(bal.mfrr) + "</span>";
    var balNavn = "Balanceindtægt i alt" +
                  '<span class="badge" title="Kendt modelfejl — tallene er urimeligt høje og må ikke bruges som resultat.">under validering — ikke gyldige tal</span>';
    h += kpi(balNavn, kr(bal.i_alt), "kr.", "kpi--bred kpi--validering", balBi);
    h += "</div></div>";

    // Enheder-tabel
    h += '<div class="sektion"><div class="sektion__titel">Enheder</div>';
    h += tegnEnhederTabel(m.enheder || []);
    h += "</div>";

    // Figurer (increment 2) — tegnes af figurer.js efter indsættelse i DOM.
    h += '<div class="sektion"><div class="sektion__titel">Figurer</div>';
    h += '<div id="fig-periode" class="fig-periode"></div>';
    h += '<div id="fig-dispatch" class="fig"></div>';
    h += '<div id="fig-tank" class="fig"></div>';
    h += '<div id="fig-spot" class="fig"></div>';
    h += '<div id="fig-balance" class="fig"></div>';
    h += "</div>";

    elDetalje.innerHTML = h;

    if (window.VarmeflexFigurer) {
      try { window.VarmeflexFigurer.tegn(m); }
      catch (e) {
        var fd = document.getElementById("fig-dispatch");
        if (fd) fd.innerHTML = '<p class="fig-tom">Kunne ikke tegne figuren.</p>';
      }
    }
  }

  function tegnEnhederTabel(enheder) {
    if (!enheder.length) {
      return '<p class="tom-rk">Ingen enheds-nøgletal i dette manifest.</p>';
    }
    var r = '<div class="tabel-rul"><table class="tabel"><thead><tr>' +
      "<th>Enhed</th><th>P_max (MW)</th><th>Produktion (MWh)</th>" +
      "<th>Andel (%)</th><th>Fuldlasttimer</th><th>Kapacitetsfaktor (%)</th>" +
      "</tr></thead><tbody>";
    enheder.forEach(function (e) {
      r += "<tr>" +
        '<td class="navn">' + esc(e.navn) + "</td>" +
        "<td>" + tal(e.p_max_mw, 1) + "</td>" +
        "<td>" + tal(e.produktion_mwh, 1) + "</td>" +
        "<td>" + tal(e.andel_pct, 1) + "</td>" +
        "<td>" + tal(e.fuldlasttimer, 0) + "</td>" +
        "<td>" + tal(e.kapacitetsfaktor_pct, 1) + "</td>" +
        "</tr>";
    });
    r += "</tbody></table></div>";
    return r;
  }

  // --- Datahentning med auth-fallback -------------------------------------
  function hentKatalogOgVis() {
    return API.scenarier().then(function (scenarier) {
      visApp();
      tegnMenu(scenarier);
    });
  }

  // --- Login-flow ----------------------------------------------------------
  elLoginForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    ryddLoginFejl();
    var kode = elLoginKode.value.trim();
    if (!kode) { loginFejl("Indtast en medlemskode."); return; }

    elLoginKnap.disabled = true;
    API.login(kode).then(function () {
      elLoginKode.value = "";
      return hentKatalogOgVis();
    }).then(function () {
      elLoginKnap.disabled = false;
    }).catch(function (fejl) {
      elLoginKnap.disabled = false;
      if (fejl instanceof API.ApiFejl && fejl.status === 403) {
        loginFejl("Forkert medlemskode. Prøv igen.");
      } else {
        loginFejl(fejl.message || "Login mislykkedes. Prøv igen.");
      }
    });
  });

  // --- Opstart: opdag eksisterende session --------------------------------
  hentKatalogOgVis().catch(function (fejl) {
    if (fejl instanceof API.AuthFejl) { visLogin(); return; }
    // Anden fejl (fx server nede): vis login med en diskret note.
    visLogin();
    loginFejl(fejl.message || "Kunne ikke kontakte serveren.");
  });

})();
