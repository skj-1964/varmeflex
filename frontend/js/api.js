/* api.js — API-klient for varmeflex.dk.
 *
 * Eneste sted, der taler med backenden (/api/*). Same-origin: Apache
 * reverse-proxyer /api til FastAPI, så session-cookien flyder med uden CORS.
 * Vi sender altid credentials: 'same-origin', så den signerede cookie følger med.
 *
 * Genbrugelig på tværs af increments: login + scenarie-opslag nu, chat senere
 * (tilføj blot en metode — intet her skal rives ned).
 *
 * Sessionsdetektering: cookien er HttpOnly, så JS kan ikke læse den. I stedet
 * afslører et beskyttet kald (401) en udløbet/manglende session. Den fejl
 * pakkes som AuthFejl, så UI-laget kan falde tilbage til login-view.
 */
(function (global) {
  "use strict";

  var BASIS = "/api";

  /** Kastes når et beskyttet kald svarer 401/403 — session mangler/udløbet. */
  function AuthFejl(besked) {
    this.name = "AuthFejl";
    this.message = besked || "Ikke logget ind.";
  }
  AuthFejl.prototype = Object.create(Error.prototype);

  /** Kastes ved øvrige API-fejl (netværk, 4xx/5xx med en server-detalje). */
  function ApiFejl(besked, status) {
    this.name = "ApiFejl";
    this.message = besked || "Der opstod en fejl.";
    this.status = status || 0;
  }
  ApiFejl.prototype = Object.create(Error.prototype);

  /** Træk en pæn fejltekst ud af et FastAPI-fejlsvar ({detail: "..."}). */
  function laesDetalje(respons, fallback) {
    return respons.json().then(
      function (krop) { return (krop && krop.detail) ? krop.detail : fallback; },
      function () { return fallback; }
    );
  }

  /** Fælles fetch-indpakning: JSON ind/ud, cookie med, auth-fejl normaliseret. */
  function hent(sti, indstillinger) {
    var opt = Object.assign({
      credentials: "same-origin",
      headers: { "Accept": "application/json" },
    }, indstillinger || {});

    return fetch(BASIS + sti, opt).then(function (respons) {
      if (respons.status === 401 || respons.status === 403) {
        return laesDetalje(respons, "Log ind med din medlemskode.").then(function (m) {
          throw new AuthFejl(m);
        });
      }
      if (!respons.ok) {
        return laesDetalje(respons, "Uventet fejl (" + respons.status + ").").then(function (m) {
          throw new ApiFejl(m, respons.status);
        });
      }
      return respons.json();
    }, function (netvaerksfejl) {
      // fetch afviser kun ved netværks-/CORS-fejl — ikke ved HTTP-fejlkoder.
      throw new ApiFejl("Kunne ikke nå serveren. Tjek forbindelsen.", 0);
    });
  }

  function postJson(sti, krop) {
    return hent(sti, {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(krop),
    });
  }

  var API = {
    AuthFejl: AuthFejl,
    ApiFejl: ApiFejl,

    /** Byt medlemskode til en session-cookie. 403 → ApiFejl (forkert kode). */
    login: function (kode) {
      return postJson("/login", { kode: kode }).catch(function (fejl) {
        // Forkert kode kommer som 403 → her er det en almindelig brugerfejl,
        // ikke en "udløbet session". Map til ApiFejl, så login-view viser den inline.
        if (fejl instanceof AuthFejl) { throw new ApiFejl(fejl.message, 403); }
        throw fejl;
      });
    },

    /** Kataloget af scenarier. Kræver session (401 → AuthFejl). */
    scenarier: function () {
      return hent("/scenarier").then(function (d) { return d.scenarier || []; });
    },

    /** Ét manifest. inkluderSerier=false i increment 1 (ingen figurer endnu). */
    scenarie: function (id, inkluderSerier) {
      var q = inkluderSerier ? "?inkluder_serier=true" : "";
      return hent("/scenarie/" + encodeURIComponent(id) + q);
    },

    /** Letvægts-sundhedstjek (ingen session krævet). */
    sundhed: function () {
      return hent("/sundhed");
    },
  };

  global.VarmeflexAPI = API;
})(window);
