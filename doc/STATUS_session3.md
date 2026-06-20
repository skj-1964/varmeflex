# STATUS — Session 3 (varmeflex.dk)

> Primær kontekstbærer til næste session. Henviser til hoveddokumenterne
> (`varmeflex_projektkontekst.md`, `run_scenario_kontrakt_v1.md`, `CLAUDE.md`,
> `STATUS_session1.md`, `STATUS_session2.md`) frem for at gentage dem.
> Leverancer denne session: frontend **increment 1** bygget og verificeret;
> **gated demo er nu LIVE over HTTPS** på varmeflex.dk (uden chat); increment 2-
> prompten formuleret (bilag).

## Hvor vi er
Frontend increment 1 (stillads + login-gate + scenarie-menu + manifest-
detaljevisning) er bygget i `/opt/varmeflex/frontend` og verificeret mod ægte
data. Deploy-trinnet fra session 2 er gennemført: siden serveres af Apache over
HTTPS med systemd-styret uvicorn bagved. Den eneste udestående handling før
login virker, er at udfylde medlemskoden (se "Udestående handling"). Næste store
stykke er increment 2 (figurer).

## Beslutninger truffet
- **Figurer tegnes i browseren** fra ægte timeserier med uPlot (vendéret lokalt),
  ikke via backend-fil-servering. Valgt frem for et nyt PNG-endpoint: undgår en
  fil-sti-sikkerhedsflade, og figurerne matcher sidens design.
- **Balance-tal vises under udvikling/test**, men markeret med badge
  "under validering — ikke gyldige tal" (ét sted i `app.js`, let at fjerne).
  `tank_arbitrage_dkk = null` vises som "ikke gældende ved MILP".
- **Visuelt udtryk: nøgtern/teknisk**, ikke marketing. Off-white baggrund, mørk
  tekst, én afdæmpet teal-accent, tabular-nums overalt, tynde borders. Ingen
  gradienter, hero-billeder eller animation.
- **Hele siden er gated — ikke kun chatten.** Probe af `GET /api/scenarier`
  svarer 401 uden session. Dette afgør det tidligere åbne punkt "offentlig vs.
  adgangsbeskyttet": medlemskoden kræves for at se noget som helst.
- **"Log ud" bevidst droppet** i increment 1: HttpOnly-cookie + intet logout-
  endpoint → en knap ville være kosmetik. Lav værdi med en delt kode.
- **Sessionsdetektering ved load** via probe af `GET /api/scenarier`
  (200 → app-view, 401 → login-view). Intet ekstra endpoint; gyldig session
  slipper for at taste koden igen.
- **Deploy:** Apache-vhosten var allerede aktiveret i en tidligere session
  (identisk med `deploy/varmeflex.apache.conf`) — derfor ingen Apache-ændring
  eller reload denne session. Backenden køres nu via systemd, ikke manuelt.

## Frontend (as-built, increment 1)
Fire filer i `/opt/varmeflex/frontend/` — rent statisk, vanilla JS, ingen
byggekæde:

| Fil | Rolle |
| --- | --- |
| `index.html` | Stillads: topbar, view-skift login↔app (menu + detaljepanel), footer |
| `css/varmeflex.css` | Nøgtern palet, tabular-nums, tynde borders |
| `js/api.js` | Genbrugelig API-klient: `credentials:'same-origin'`, 401/403→`AuthFejl`, øvrige→`ApiFejl`. Chat tilføjes senere som én metode |
| `js/app.js` | Login-flow, menu, detaljevisning, auth-fallback, dansk talformat (`Intl.NumberFormat('da-DK')`) |

Verificeret af Claude Code via en test-proxy, der gengiver Apaches same-origin-
opsætning (statisk `frontend/` + `/api`-proxy): hele HTTP-sekvensen browseren
udfører blev kørt mod ægte backend (login 403/200, scenarier, scenarie-detalje
med alle felter, ukendt id → 404).
**Forbehold:** JS/DOM-laget er kun gennemgået statisk — endnu intet tjek i en
rigtig browser (ingen browser på serveren). Det er nu muligt, da siden er live.

## Deploy (as-built) — gated demo LIVE over HTTPS
- **Secrets:** `/etc/varmeflex/varmeflex.env` (root:steen, 640, uden for git/
  docroot). `VARMEFLEX_SECRET` sat (32 random bytes); `VARMEFLEX_KODER` **tom**
  (udestående); `ANTHROPIC_API_KEY` tom (increment 3);
  `MODEL_OUTPUT_DIR=/opt/fjernvarme-businesscase/output`;
  `VARMEFLEX_COOKIE_SECURE=1`.
- **systemd:** `varmeflex.service`, `User=steen`, **én** uvicorn-worker, bind
  kun `127.0.0.1:8001`, `EnvironmentFile`, `Restart=on-failure`, let hærdning,
  enabled + active.
- **Apache:** vhost allerede aktiveret tidligere (moduler aktive, configtest
  grøn). DocumentRoot=`frontend/`, `/api` → `127.0.0.1:8001`. Ingen ændring
  denne session.
- **DNS:** `varmeflex.dk` + `www` → `87.52.102.26` (serverens offentlige IP).
  Ingen DNS-handling nødvendig.
- **Cert:** begge navne er SAN i `kramerjensen.dk`-certet; stier matcher;
  gyldigt til **15. sep 2026**.
- **App uden API-nøgle:** booter fint; nøglen kræves først i increment 3.
- **NAT/hairpin:** indefra LAN'et fejler hairpin → til browser-test indefra
  bruges hosts-linje `192.168.0.5  varmeflex.dk  www.varmeflex.dk`.
  Udefra LAN'et virker rigtig DNS allerede.

## Verificeret
- systemd aktiv, én worker, lytter kun `127.0.0.1:8001`.
- `https://varmeflex.dk/api/sundhed` → `{"ok":true,"antal_scenarier":3}` gennem
  Apache-proxyen.
- Statiske filer over HTTPS → 200 (index/css/api.js/app.js).
- Gate lukket: login afviser enhver kode → 403; beskyttet endpoint uden session
  → 401.
- `kramerjensen.dk` + `www` uberørt → 200; `apachectl configtest` → Syntax OK.

## Referencetal
Uændret fra session 2: tre ægte A/B/C-manifester i `output/` (C `…__bal-av`,
A `…__2025`, B `…__off-tank_eksisterende`). **Balance-tallene er stadig
urimeligt høje (modelfejl fra session 1, uændret) — brug dem IKKE som
resultater.** Konkrete værdier står i `STATUS_session1.md`/`STATUS_session2.md`.

## Udestående handling (bruger)
Siden er en låst login-væg, indtil medlemskoden er sat. Rediger
`VARMEFLEX_KODER=` i `/etc/varmeflex/varmeflex.env` og kør derefter:

```bash
sudo systemctl restart varmeflex.service
```

(systemd læser env-filen kun ved start.) Derefter login + browser-test af hele
increment 1-flowet.

## Åbne punkter
1. **Medlemskoden ikke sat endnu** → login afviser alt, indtil `VARMEFLEX_KODER`
   udfyldes + servicen genstartes (brugerhandling ovenfor).
2. **`ANTHROPIC_API_KEY` tom** → `/api/chat` + relevansfilter ikke live endnu.
   Sættes inden increment 3.
3. **Increment 1 mangler et rigtigt browser-tjek** (kun HTTP-kontrakt + statisk
   JS-gennemgang hidtil). Nu muligt, da siden er live.
4. **Balance-modelfejl** (fra session 1, uændret) — balance-tal ikke gyldige;
   vises med badge under udvikling. Skal fixes før tal præsenteres som
   resultater. Diagnose i `STATUS_session1.md`.
5. **Increment 2 (figurer)** — prompt klar (bilag), ikke udført endnu. Immediate
   næste skridt på website-sporet.
6. **Fra tidligere, stadig uafklaret:** hvilke scenarier ud over A/B/C i cachen
   (pris-akse via `--set` senere), video-omfang; `[BEKRÆFT]`-værdier i
   `billund_2025.yaml` (session 1).

## Næste skridt
1. **(Bruger)** Sæt medlemskode + genstart service → browser-test increment 1.
2. **Increment 2:** dispatch- + tankniveau-figurer med uPlot (vendéret lokalt
   fra npm) tegnet fra `inkluder_serier=true`. Prompt i bilag. Trin 0: grund dig
   i de faktiske `hourly.csv`-/`_serier`-kolonner, FØR du tegner.
3. **Sæt `ANTHROPIC_API_KEY`** → **increment 3:** chat-grænseflade mod
   `/api/chat` (fuld beskedhistorik ind; `svar` + evt. `manifester` ud).

## Kommandoer til reference
```bash
# Sæt medlemskode og genstart
sudoedit /etc/varmeflex/varmeflex.env      # udfyld VARMEFLEX_KODER=
sudo systemctl restart varmeflex.service

# Service-status og logs
systemctl status varmeflex.service
journalctl -u varmeflex.service -f

# Sundhedstjek
curl -s https://varmeflex.dk/api/sundhed

# Browser-test indefra LAN'et (NAT/hairpin) — hosts-linje:
# 192.168.0.5  varmeflex.dk  www.varmeflex.dk
```

---

## Bilag: Increment 2-prompt (klar til Claude Code)

```
Increment 2 af frontenden: figurer (dispatch + tankniveau) tegnet med uPlot
fra ægte timeserier. Byg ovenpå increment 1 (index.html, css/varmeflex.css,
js/api.js, js/app.js) — riv intet ned.

Læs først: CLAUDE.md, doc/run_scenario_kontrakt_v1.md §3, og increment 1's
frontend-filer.

TRIN 0 — grund dig i de faktiske data FØRST, rapportér før du tegner
- Kald GET /api/scenarie/{id}?inkluder_serier=true mod den kørende backend og
  inspicér _serier-strukturen. Inspicér også header-rækken i
  /opt/fjernvarme-businesscase/output/*_hourly.csv.
- Kortlæg hvilke kolonner der findes: tidsstempel, varmeproduktion pr. enhed,
  tankniveau/lager-SOC, varmebehov, evt. spotpris, nettab. GÆT ALDRIG på
  kolonnenavne — brug de faktiske. Rapportér kolonne-kortet.

uPLOT — vendér lokalt, ingen runtime-CDN
- Hent uPlot via npm-registret (tilladt fra serveren) og læg dist-filerne i
  frontend/vendor/ (uPlot.iife.min.js + uPlot.min.css). INGEN hot-link til CDN:
  siden skal være selvbærende bag gaten, intet må lække til tredjepart ved
  runtime. (Dette er ikke en byggekæde — bare én vendéret fil.)
- uPlot stakker IKKE areal selv. Stacked dispatch laves ved at summere serier
  kumulativt og tegne fyldte bånd (uPlot's stack-mønster) — skriv den lille
  stack-helper.

FIGURER (i detaljepanelet, under nøgletal + enhedstabel)
- Når et scenarie vælges, hentes nu med inkluder_serier=true; render nøgletal +
  tabel som før PLUS figurerne.
- Dispatch-figur (centrum): stacked areal, ét bånd pr. producerende enhed, over
  perioden. Læg varmebehov som en linje oven på stakken (standard, letlæselig —
  viser at stakken dækker behovet). Konsistent enhedsfarve-palet defineret ÉT
  sted, genbrugt i figur + legende. Dæmpede, distinkte farver, teknisk udtryk.
- Tankniveau-figur: linje for lagerniveau over tid. For scenarie uden tank (B):
  vis pænt "ingen tank i dette scenarie" — tegn ikke en tom figur.
- Dansk på akser og labels; enheder MWh/MW/m³. tabular-nums i tooltips.
- uPlot's indbyggede zoom/pan må gerne være slået til. ~8760 punkter × ~7 serier
  — uPlot klarer det uden problemer.

RAMMER (uændret fra increment 1)
- Rent statisk, vanilla JS. Alt på dansk. Ingen hemmeligheder i frontend.
  credentials: 'same-origin'.
- Figurer KUN fra ægte _serier. Ingen pyntetal, intet tegnet af en billedmodel.
- Vi tegner kun fysisk-gyldige figurer (dispatch, tank, behov) — de er IKKE
  ramt af balance-modelfejlen. Tegn IKKE en revenue-/balance-split-figur endnu.
- Stadig INGEN chat — det er increment 3.

ACCEPTKRITERIER (verificér mod kørende backend; markér hvad der kun kan ses i
en rigtig browser)
- Trin 0-kolonnekort rapporteret.
- Scenarie C → dispatch-stak med alle producerende enheder + behovslinje, plus
  tankniveau-linje. Farver og tal konsistente.
- Scenarie B (uden tank) → tankfigur erstattet af pæn "ingen tank"-besked;
  dispatch uændret.
- uPlot indlæst lokalt fra vendor/ — intet CDN-kald i netværksfanen.
- Ingen chat, ingen hemmeligheder.
- Rapportér hvad du byggede, hvordan du testede, og præcist hvad der kræver et
  rigtigt browser-tjek (uPlot-rendering kan ikke fuldt verificeres uden browser).
```