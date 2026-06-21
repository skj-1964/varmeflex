# STATUS — Session 6 (varmeflex.dk)

> Primær kontekstbærer til næste session. Henviser til hoveddokumenterne
> (`CLAUDE.md`, `run_scenario_kontrakt_v1.md`, `STATUS_session1`–`5`) frem for
> at gentage dem. Leverance denne session: **increment 4 — sammenligning
> (reference vs alternativ)**, backend + frontend, verificeret mod kørende
> service. Intet revet ned fra increment 1–3.

## Hvor vi er
Sammenlignings-tilstand er bygget og virker. Brugeren vælger to vilkårlige
kørsler (reference + alternativ) fra kataloget; backenden returnerer differensen
(alternativ − reference), frontenden tegner alternativets drift med den
eksisterende `figurer.js` og viser Δ-tallene med fortegn. Realiserer kontraktens
§2.3 (differens beregnes ovenpå ved at parre to manifester) — to-fase-snittet
holder: en sammenligning kræver kun to manifester, uanset cache eller live
solver.

## TRIN 0 — bekræftet felt-kort (mod rigtige manifester i output/)
- **Differentielle (Δ=alt−ref):** `objektiv_dkk`, `co2_ton`,
  `samlet_produktion_mwh`, `nettab_mwh`; pr. enhed `produktion_mwh`.
- **Procentpoint:** `nettab_pct` → `nettab_pct_point`.
- **Invariant:** `varmeefterspoergsel_mwh` (identisk 122241.6 i A/B/C → Δ≈0).
- **Forbeholds-ramt:** `balanceindtaegt_dkk` — **null** når `med_balancering=false`
  (A og B har null; kun C har dict). Diff-logikken behandler null som 0.

## Backend (as-built)
- **`scenarios.py`:** ny rammefri `sammenlign_manifester(ref, alt, output_dir)`
  + hjælpere (`_balance_som_tal`, `_enheds_produktion`, `_variant_label_index`).
  Generisk over felterne, ingen viden om A/B/C. Enheds-**union**: en enhed der
  kun findes i den ene kørsel får produktion 0 i den anden (gør "installér ekstra
  motor og sammenlign"-casen mulig uden kodeændring).
- **`app.py`:** nyt endpoint `GET /api/sammenlign?reference=&alternativ=` —
  skrivebeskyttet, bag samme gate, **ikke** rate-limitet (kalder ikke Anthropic).
  Ukendt id → 404 dansk ("Ukendt scenarie: …"). Henter ingen `_serier`.
- **Forbehold manifest-drevet:** `forbehold.balance_under_validering = true` hvis
  ENTEN ref eller alt har `koersel.med_balancering=true`. Gælder både balance-Δ
  og objektiv-Δ. A−B (begge uden balancering) er derfor rent præsentabelt.
- **Sammenlignelighed (soft):** advarsler ved forskellig case/periode/varmebehov
  (tolerance 1 MWh). Blokerer aldrig — differensen beregnes altid.

## Frontend (as-built) — rent additivt
| Fil | Ændring |
| --- | --- |
| `js/api.js` | Ny `sammenlign(refId, altId)` → `GET /api/sammenlign`, fælles fetch-mønster |
| `index.html` | Sammenlign-blok i menu-aside: to select-lister + "Sammenlign"-knap |
| `js/app.js` | Parallel render-vej `vaelgSammenligning`/`tegnSammenligning`; fylder select-lister fra kataloget; Δ-tal med fortegn (U+2212), badge ved balancering, rolig note ved advarsler. Kalder den EKSISTERENDE `VarmeflexFigurer.tegn(alternativManifest)` — nul ændring i `figurer.js` |
| `css/varmeflex.css` | Sammenlign-styling (select, noter, Δ-tabel) — samme palet |

- Enkelt-visningen (`vaelgScenarie`) er **uændret**. Begge render-veje skriver i
  samme `#detalje`-panel (gensidigt udelukkende), så de deler de faste figur-id'er.
- Resultater og kurver er tydeligt adskilt: "Resultater: forskel (alternativ −
  reference)" vs "Kurver: alternativets drift (…)".

## Verificeret
- **Backend-testsuite (`tests/test_app.py`):** 25/25 OK, inkl. ny Sammenlign-
  sektion (C vs A forbehold+felter, A vs B intet forbehold, enheds-union med ny
  enhed, ukendt id→404, samme-i-begge→0-diff).
- **Mod kørende service** (genstartet, real output/): C vs A → forbehold=true,
  Δobjektiv −220.219.554, Δbalance 292.123.161, 7 enheder i union; A vs B →
  forbehold=false, Δobjektiv −6.018.402 (tankens værdi); ukendt id → 404 dansk;
  uden cookie → 401.
- **Frontend-JS:** parser rent (esprima) — `app.js`, `api.js`.

## Kun verificerbart i en rigtig browser (ikke afprøvet headless)
- De to select-lister fyldt fra kataloget; valg af ref+alt + "Sammenlign"-klik.
- Kurver = alternativets dispatch/tank/spot/balance via eksisterende `tegn()`;
  periodevælgeren (fra/til + presets) virker i sammenlignings-tilstand.
- Δ-tal med synligt fortegn (`tabular-nums`); "under validering"-badge på
  Δobjektiv + balance-Δ når balancering indgår; rolig advarselsnote ved
  usammenlignelige par.

## Uændret / forbehold
- Balance-tallene er stadig urimeligt høje (modelfejl fra session 1). Δobjektiv
  arver forbeholdet automatisk når en balancering-kørsel indgår — vist som badge.
- Ingen revenue-/balance-split-figur. Ingen ekstern runtime-URL, ingen
  hemmeligheder i frontend.
- **Ikke committet** (afventer din bekræftelse). Stadig ingen git-remote.

## Åbne punkter (fra session 5, uændret)
1. Modelvalg i chat env-styret (aftalt, ikke implementeret).
2. Balance-modelfejl — fixes før balance præsenteres som resultat.
3. Chat + balance-forbehold-konsistens (grounding vs badge).
4. Git-remote endnu ikke valgt.
5. Evt. aktiveringspris-figur.
