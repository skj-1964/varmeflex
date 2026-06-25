/* markdown.js — minimal, SIKKER markdown→HTML for chat-svar.
 *
 * Claude svarer i markdown; den skal vises pænt uden at åbne for HTML-injektion.
 * Strategien er bevidst defensiv: ALT råtekst HTML-escapes først, og derefter
 * genskabes kun et lille, kendt subset af tags via regler vi selv styrer. Der
 * sættes ALDRIG rå HTML fra svaret ind i DOM'en — kun <p>, <h1..6>, <ul>/<ol>/
 * <li>, <pre>/<code>, <strong>/<em>, <blockquote> og <a> til http(s)/mailto.
 *
 * Brugen er afgrænset til assistent-bobler (app.js). Bruger-input og fejlbeskeder
 * forbliver textContent — de røres ikke af denne fil.
 */
(function () {
  "use strict";

  // Sentinel-tegn (NUL/SOH) til at parkere inline-kode. De kan ikke optræde i
  // chat-tekst, så de kolliderer aldrig med rigtigt indhold.
  var SENT_A = "\u0000";
  var SENT_B = "\u0001";

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // Inline-formatering. Input er RÅ tekst; vi escaper her, så alt indhold er
  // neutraliseret, før vi indfører vores egne (sikre) tags.
  function inline(raw) {
    var s = esc(raw);

    // Inline-kode tages først ud og parkeres bag sentinels, så *, _ og []
    // inde i kode ikke bliver fortolket bagefter.
    var koder = [];
    s = s.replace(/`([^`]+)`/g, function (_, c) {
      koder.push(c);
      return SENT_A + (koder.length - 1) + SENT_B;
    });

    // Links: kun http(s) og mailto. text og url er allerede escaped.
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g,
      function (_, t, u) {
        return '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + "</a>";
      });

    // Fed før kursiv; ** og __ konsumeres først, så enkelt-* / _ ikke kolliderer.
    s = s.replace(/\*\*([\s\S]+?)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([\s\S]+?)__/g, "<strong>$1</strong>");
    s = s.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
    // _kursiv_ kun ved ordgrænser, så snake_case-ord ikke bliver kursiveret.
    s = s.replace(/(^|[\s(])_([^_\n]+?)_(?=[\s).,!?:;]|$)/g, "$1<em>$2</em>");

    // Genindsæt inline-kode (indholdet er escaped fra optagelsen ovenfor).
    s = s.replace(new RegExp(SENT_A + "(\\d+)" + SENT_B, "g"), function (_, n) {
      return "<code>" + koder[Number(n)] + "</code>";
    });
    return s;
  }

  // --- GFM-tabeller --------------------------------------------------------
  // Del en tabel-linje i celler. Ydre | fjernes; \| er en escaped pipe (literal).
  function celler(linje) {
    var s = linje.trim().replace(/^\|/, "").replace(/\|$/, "");
    var ud = [], cur = "";
    for (var k = 0; k < s.length; k++) {
      var ch = s.charAt(k);
      if (ch === "\\" && s.charAt(k + 1) === "|") { cur += "|"; k++; continue; }
      if (ch === "|") { ud.push(cur); cur = ""; continue; }
      cur += ch;
    }
    ud.push(cur);
    return ud.map(function (x) { return x.trim(); });
  }

  // Skillelinjen under tabel-hovedet: kun |, -, : og mellemrum, mindst én bindestreg.
  function erSkillelinje(linje) {
    return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(linje);
  }

  // Byg <table> ud fra hoved-celler, align-celler (fra skillelinjen) og body-rækker.
  function byggTabel(hoved, align, raekker) {
    var just = align.map(function (c) {
      var v = c.charAt(0) === ":", h = c.charAt(c.length - 1) === ":";
      if (v && h) return "center";
      if (h) return "right";
      if (v) return "left";
      return "";
    });
    function celle(tag, indhold, idx) {
      var a = just[idx];
      return "<" + tag + (a ? ' style="text-align:' + a + '"' : "") + ">" +
        inline(indhold) + "</" + tag + ">";
    }
    var h = '<div class="md-tabel-rul"><table class="md-tabel"><thead><tr>';
    hoved.forEach(function (c, idx) { h += celle("th", c, idx); });
    h += "</tr></thead><tbody>";
    raekker.forEach(function (r) {
      h += "<tr>";
      for (var c = 0; c < hoved.length; c++) {
        h += celle("td", r[c] !== undefined ? r[c] : "", c);
      }
      h += "</tr>";
    });
    h += "</tbody></table></div>";
    return h;
  }

  // Blok-parsing linje for linje. Strukturen (overskrift, liste, kodeblok,
  // tabel, citat, afsnit) genkendes på RÅ tekst — escaping sker i inline()/esc().
  function tilHtml(src) {
    var lines = String(src === null || src === undefined ? "" : src)
      .replace(/\r\n?/g, "\n").split("\n");
    var ud = [];
    var listeType = null;   // "ul" | "ol" | null
    var afsnit = [];
    var i = 0;

    function tomAfsnit() {
      if (afsnit.length) { ud.push("<p>" + inline(afsnit.join(" ")) + "</p>"); afsnit = []; }
    }
    function lukListe() {
      if (listeType) { ud.push("</" + listeType + ">"); listeType = null; }
    }

    while (i < lines.length) {
      var line = lines[i];

      // Fenced kodeblok ``` … ```
      if (/^\s*```/.test(line)) {
        tomAfsnit(); lukListe();
        var kode = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { kode.push(lines[i]); i++; }
        i++; // spring afsluttende ``` over
        ud.push("<pre><code>" + esc(kode.join("\n")) + "</code></pre>");
        continue;
      }

      // GFM-tabel: en header-linje med | efterfulgt af en skillelinje (---|---)
      if (line.indexOf("|") !== -1 && i + 1 < lines.length &&
          erSkillelinje(lines[i + 1]) && lines[i + 1].indexOf("|") !== -1) {
        tomAfsnit(); lukListe();
        var hoved = celler(line);
        var align = celler(lines[i + 1]);
        i += 2;
        var raekker = [];
        while (i < lines.length && !/^\s*$/.test(lines[i]) && lines[i].indexOf("|") !== -1) {
          raekker.push(celler(lines[i]));
          i++;
        }
        ud.push(byggTabel(hoved, align, raekker));
        continue;
      }

      // Overskrifter # … ######
      var ho = /^(#{1,6})\s+(.*)$/.exec(line);
      if (ho) {
        tomAfsnit(); lukListe();
        var n = ho[1].length;
        ud.push("<h" + n + ">" + inline(ho[2]) + "</h" + n + ">");
        i++; continue;
      }

      // Punktliste  - …  / * …
      var pl = /^\s*[-*]\s+(.*)$/.exec(line);
      if (pl) {
        tomAfsnit();
        if (listeType !== "ul") { lukListe(); ud.push("<ul>"); listeType = "ul"; }
        ud.push("<li>" + inline(pl[1]) + "</li>");
        i++; continue;
      }

      // Nummereret liste  1. …
      var nl = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (nl) {
        tomAfsnit();
        if (listeType !== "ol") { lukListe(); ud.push("<ol>"); listeType = "ol"; }
        ud.push("<li>" + inline(nl[1]) + "</li>");
        i++; continue;
      }

      // Citat  > …
      var ci = /^\s*>\s?(.*)$/.exec(line);
      if (ci) {
        tomAfsnit(); lukListe();
        ud.push("<blockquote>" + inline(ci[1]) + "</blockquote>");
        i++; continue;
      }

      // Tom linje afslutter afsnit/liste
      if (/^\s*$/.test(line)) { tomAfsnit(); lukListe(); i++; continue; }

      // Almindelig afsnitslinje
      lukListe();
      afsnit.push(line.trim());
      i++;
    }
    tomAfsnit(); lukListe();
    return ud.join("\n");
  }

  window.VarmeflexMarkdown = { tilHtml: tilHtml };
})();
