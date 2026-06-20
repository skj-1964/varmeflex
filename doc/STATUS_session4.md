# STATUS — Session 4 (varmeflex.dk)

> Primær kontekstbærer til næste session. Henviser til hoveddokumenterne
> (`varmeflex_projektkontekst.md`, `run_scenario_kontrakt_v1.md`,
> `CLAUDE.md`, `STATUS_session1.md`, `STATUS_session2.md`,
> `STATUS_session3.md`) frem for at gentage dem.
> Leverancer denne session: frontend **increment 2** (figurer) bygget,
> koblet på den live gated demo og browser-verificeret; periodevælger og
> spot-/balancepris-figurer tilføjet; Apache sat til no-cache på
> frontenden. Login er nu åbent (medlemskode sat af bruger).

## Hvor vi er
Detaljepanelet viser nu — ud over nøgletal + enhedstabel fra increment 1
— fire uPlot-figurer tegnet fra ægte `_serier` (`inkluder_serier=true`):
dispatch (stacked areal), tankniveau, spotpris og balance-kapacitetspriser.
En periodevælger zoomer alle figurer synkront. Login virker (medlemskoden
er sat), og siden er fortsat gated og live over HTTPS. Næste store stykke
er **increment 3 (chat)**, som afventer `ANTHROPIC_API_KEY`.

## Beslutninger truffet
- **uPlot 1.6.32 vendéret lokalt** i `frontend/vendor/`
  (`uPlot.iife.min.js` + `uPlot.min.css`), hentet fra npm-registret.
  Intet runtime-CDN — siden er selvbærende bag gaten.
- **Dispatch = stacked areal** via kumulativ data + uPlot-bånd (nederste
  enhed fylder til baseline). Behovslinjen er `heat_load_mw` (verificeret:
  `sum(p_*_mw) − tank_net = heat_load`). Legendeværdien de-kumuleres, så
  hver enheds egen MW vises — ikke stak-summen. `gaskedel_agg` udeladt af
  stakken i C (0 produktion).
- **Enhedspalet defineret ét sted** (`ENHEDER` i `figurer.js`), genbrugt i
  figur + legende. Dæmpede, distinkte farver.
- **Spot- og balancePRISER er markedsdata (input), ikke modelberegnet
  balance-indtægt** → ikke ramt af balance-modelfejlen, derfor ingen
  "under validering"-badge på disse figurer.
- **Balancepris-figuren viser kapacitetspris** (aFRR + mFRR, DKK/MW/h —
  samme enhed, ren akse). Aktiveringspriserne bevidst udeladt (spiker til
  20–36.000 DKK/MWh → ulæseligt); kan tilføjes som separat figur senere.
- **Y-akser:** pris-figurer bruger auto-y der rummer negative værdier
  (spot ned til −285); mængde-figurer (dispatch/tank) har fast 0-baseline.
- **Periodevælger** via uPlot `setScale('x', …)` (ingen gen-tegning):
  Fra/Til-datofelter + K1–K4 + "Hele perioden". Y-aksen genberegnes for den
  synlige periode. Figurer er linkede (træk-zoom/dobbeltklik-reset i én
  følger de andre + opdaterer datofelter), med reentrans-vagt.
- **Apache `Cache-Control: no-cache`** på `<Directory frontend>` (revalidér
  altid → billige 304'er), så ny frontend-kode vises uden hard-reload. Sat i
  både `deploy/varmeflex.apache.conf` og live
  `sites-available/varmeflex.dk.conf` (holdt identiske).

**Scope-note:** spot-/balancepris-figurerne og periodevælgeren gik ud over
den oprindelige increment 2-prompt (kun dispatch + tank). Bevidst udvidelse
— de er fysisk-/markedsgyldige og rører ikke balance-modelfejlen.

## Frontend (as-built, increment 2)
- **Ny fil:** `js/figurer.js` — palet, kumulativ stak-helper,
  dispatch/tank/spot/balance, periodevælger + zoom-link, resize.
- **Ændret:** `index.html` (vendor-CSS/JS + `figurer.js`, rækkefølge
  uPlot→api→figurer→app); `js/app.js` (henter nu `inkluder_serier=true`;
  tilføjer figur-containere `#fig-periode`/`#fig-dispatch`/`#fig-tank`/
  `#fig-spot`/`#fig-balance` og kalder `VarmeflexFigurer.tegn(m)`);
  `css/varmeflex.css` (figur- + periodevælger-styling, uPlot-tema,
  tabular-nums).
- **Kolonnekort (TRIN 0):** produktion `p_<enhed>_mw` (7 enheder); behov
  `heat_load_mw`; tank `tank_eksisterende_level_mwh`; spot
  `spot_price_dkk_mwh`; balance-kapacitet `afrr_cap_up_dkk_mw_h` /
  `mfrr_cap_up_dkk_mw_h`.

## Verificeret
- **Stak-matematik** valideret uafhængigt i Python: de-kumuleringen
  reproducerer enhedens MW eksakt; top-stak − behov = tank op/afladning.
- **Mod kørende backend over HTTPS (loopback):** `_serier` leveret for
  C/A/B; spot i alle; balance-kapacitet kun i C (A/B → "Ingen
  balancemarked").
- **Vendor + `figurer.js`** serveres 200; ingen ekstern runtime-URL i
  frontend.
- **Apache:** configtest grøn, graceful reload; `Cache-Control: no-cache`
  sat; betinget GET → 304; `varmeflex.dk` → 200; `kramerjensen.dk` + `www`
  uberørt → 200.
- **Bruger:** figurer + periodevælger + pris-figurer bekræftet i rigtig
  browser efter hard reload.

## Versionsstyring (as-built)
Websitet er nu under git. Repoet fandtes ikke som git endnu, så det blev
initialiseret med en samlet første import.
- **Repo:** `/opt/varmeflex`, branch `main`. Ingen remote endnu — intet er
  pushet nogen steder.
- **Commit:** `2771169` — *Initial commit: varmeflex.dk website (increment
  1+2, deploy)*. 22 filer / 2.969 linjer: hele websitet (`backend/`,
  `frontend/` inkl. vendéret uPlot, `deploy/`, `doc/`, `CLAUDE.md`).
- **`.gitignore`:** `backend/venv/` (71M), `__pycache__`, og `*.env`
  udelades — miljø og hemmeligheder havner aldrig i git. Verificeret:
  `venv/` og `.env` er ikke med; secrets ligger fortsat kun i
  `/etc/varmeflex` uden for repoet; modelrepoet er urørt.
- **NB:** initial import → alt i én commit (ingen historik at dele op mod).
  Fremover laves mindre, tematiske commits pr. ændring.

## Referencetal
Uændret fra session 2/3: tre ægte A/B/C-manifester i `output/`
(C `…__bal-av`, A `…__2025`, B `…__off-tank_eksisterende`). Konkrete
værdier i `STATUS_session1.md`/`STATUS_session2.md`.

**Balance-tallene er stadig urimeligt høje (modelfejl fra session 1,
uændret).** Bemærk dog: increment 2 viser kun fysiske figurer (dispatch,
tank) og markedspriser (spot, balance-kapacitet) — altså inputdata, ikke
modelberegnet balance-indtægt. Balance-fejlen rører derfor ikke noget af
det viste. En revenue-/balance-split-figur er fortsat udskudt, til fejlen
er fixet.

## Åbne punkter
1. **`ANTHROPIC_API_KEY` tom** → increment 3 (chat) ikke startet. Sættes i
   `/etc/varmeflex/varmeflex.env` + `systemctl restart varmeflex.service`.
2. **Balance-modelfejl** (fra session 1, uændret) — kun fysiske +
   markedspris-figurer vises; ingen revenue-/balance-split-figur. Skal fixes
   før balance-indtægt præsenteres. Diagnose i `STATUS_session1.md`.
3. **Aktiveringspriser** (aFRR/mFRR, DKK/MWh) ikke vist — valgfri separat
   figur.
4. **Ingen git-remote endnu** → repoet ligger kun lokalt på serveren,
   intet er pushet. Afventer brugerens bekræftelse af hvor (fx GitHub),
   før en remote sættes op og der pushes.
5. **Lukket siden session 3:** medlemskode sat (login virker), LAN-adgang
   åbnet, increment 1 + figurer browser-verificeret.

## Næste skridt
1. **Sæt `ANTHROPIC_API_KEY`** → **increment 3:** chat mod `/api/chat`
   (fuld beskedhistorik ind; `svar` + evt. `manifester` ud). `api.js` er
   forberedt — der mangler kun én metode.
2. **Evt. aktiveringspris-figur**, hvis ønsket.
3. **Model-bane (uden for website-sporet):** balance-indtægt-fejlen.

## Kommandoer til reference
```bash
# Sæt API-nøgle og genstart (systemd læser env-filen kun ved start)
sudoedit /etc/varmeflex/varmeflex.env       # udfyld ANTHROPIC_API_KEY=
sudo systemctl restart varmeflex.service

# Service-status og logs
systemctl status varmeflex.service
journalctl -u varmeflex.service -f

# Sundhedstjek
curl -s https://varmeflex.dk/api/sundhed

# Frontend-iteration: hard reload i Firefox bypasser cache
#   Ctrl+Shift+R  (eller F12 → Netværk → "Deaktivér cache")
```