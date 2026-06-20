# STATUS — Session 1 (varmeflex.dk)

> Primær kontekstbærer til næste session. Henviser til hoveddokumenterne frem for at gentage dem.
> Leverancer fra sessionen: `run_scenario_kontrakt_v1.md`, `src/manifest.py`, `cases/billund_2025.yaml`.

## Hvor vi er
Fundamentet for fase 1 er på plads og **valideret på rigtige data**: kontrakten `run_scenario`/`output/`, manifest-skemaet, og manifest-skriveren kører i modellen og producerer korrekte felter på ægte 2025-github-kørsler. Næste skridt er at bygge selve `list_scenarier`/`run_scenario`-backenden mod `output/`.

## Beslutninger truffet
- **Anlægssandhed:** YAML-filerne er autoritative for anlægget — ikke projektkontekstens flådebeskrivelse. Rapporten (`doc/rapport_billund_v3`) bruges kun som *metode*-kontekst, aldrig til konkrete tal.
- **Cache-arkitektur:** `output/` er den eneste sandhed om hvilke kørsler findes. Hver kørsel skriver en selvbeskrivende `{stem}_manifest.json`. Hjemmesiden og `run_scenario` læser kun derfra. Samme opdagelsesmekanisme i fase 1 (manuelle kørsler) og fase 2 (live solver) — kun bagsiden af `run_scenario` skifter.
- **Kontrakt (detaljer i `run_scenario_kontrakt_v1.md`):** model 1 = navngivne/parametriserede kørsler, ikke frie kontinuerte værdier (de hører til fase 2). Differensen mellem parrede scenarier beregnes i fortolkningslaget fra to kald, så hver cache-post er atomar.
- **Manifest-implementering:** lagt i en **ny, selvstændig** `src/manifest.py` (ikke ændring i `reporting.py` — lav risiko). To linjers tilføjelse i `run_case.py` (import + kald efter `dispatch_plot`). Feltnavne i økonomien er verificeret mod `balancing.summarize_reserves` og tank-dual-logikken.
- **DRY for A/B/C:** én baseline-YAML som anlægssandhed; A/B/C dannes via CLI-flag; scenarie-identitet udledes af manifestets `koersel`-felter (`med_balancering`, `enheder_fra`). Dedikerede YAML'er kun når et scenarie er et *reelt andet anlæg* (fx post-2026-topologi).
- **Forenkling:** periode-nøjagtig anlægstilgængelighed er bevidst nedprioriteret — modellen demonstrerer det rigtige værk og de rigtige enheder, ikke nøjagtig drift i en given periode.

## Referencetal (fra valideringskørsler — IKKE troværdige endnu)
Begge kørsler: `billund_2025.yaml`, hele 2025, github-data, model_commit `6f4ba6e`, MILP, status optimal. Varmebehov 122.242 MWh, nettab 20.398 MWh (16,7%).

| Felt | activation_value | legacy |
| --- | --- | --- |
| objektiv_dkk | −194.660.038 | −18.660.942 |
| balanceindtægt i alt | 292.123.161 | 64.314.456 |
| — aFRR / mFRR | 216,4M / 75,8M | 26,7M / 37,6M |
| produktion (MWh) | 187.730 | 141.880 |
| VP andel | 28,1% | 42,2% |
| co2_ton | 12,6 | 16,0 |

**Vigtigt:** balance-tallene er urimeligt høje (modelfejl, se nedenfor). De står her som arbejdsreference, ikke som gyldige resultater. Brug dem ikke i kommunikation.

## Åbne punkter
1. **Balance-indtægt urimeligt høj (modelfejl, parallel model-bane).** Diagnose fra sammenligningen: legacy giver sundt dispatch (VP grundlast 42%, produktion ≈ behov + nettab = 142 GWh), mens activation_value overforpligter elkedlerne og overproducerer (188 GWh) for at høste reservebetaling. Hovedmistanke: kovarians-/aktiveringsværdi-beregningen. Sandsynlig resterende løftestang i begge metoder: `total_mw: 33` mod Billunds bekræftede prækvalifikation ~9 MW/marked (VP 2,65 + elkedler 6, baseline 24-apr-2026). Næste diagnostik: kør med caps på bekræftede niveauer; inspicér activation_value-beregningen; sammenlign mod realiseret facit.
2. **`[BEKRÆFT]`-værdier i `billund_2025.yaml`** (markeret inline): priser gas/halm/flis for 2025, `co2_eua`-niveau, tank (14.000 vs backtests 12.000 m³; Δt 45), `gaskedel_agg` 16,3 vs baseline-bekræftede 26,3 MW, samt `var_om` på gasmotor (608) og gaskedel (89) der ser ~10× for høje ud vs baseline.
3. **`spotresultat_dkk`** mangler i manifest (udskudt til v1.1). Kræver bekræftelse af spot-dekomponeringskilden; reneste løsning er en lille refaktor, så `kpi_summary` returnerer headline-tal frem for kun at printe dem.
4. **`tank_arbitrage_dkk` = null ved MILP** (ingen duals) — forventet. Tank-værdien aflæses i stedet som objektiv-differens A−B.
5. **Projektkontekst skal opdateres** (flåde: fliskedel findes; storage 14.000 m³; caps) — separat opgave; kan ikke skrives til projektvidenbasen fra chatten.
6. **Stadig uafklaret fra projektkontekst:** offentlig vs adgangsbeskyttet site, hosting, video-omfang, hvilke scenarier der skal i cachen.

## Næste skridt
1. **Website-spor:** kør A/B/C på `billund_2025`-basen (toggles: med/uden `--with-balancing`; med/uden `--disable tank_eksisterende`) → tre rigtige cache-poster. Afvent evt. model-fix før tallene præsenteres.
2. **Website-spor:** byg `list_scenarier` + `run_scenario` mod `output/` (backend, fase 1).
3. **Opdatér `run_scenario_kontrakt_v1.md`** så den matcher implementeringen (separat `manifest.py`; `spotresultat` udskudt til v1.1).
4. **Model-bane (parallelt):** fejlsøg balance-indtægten jf. punkt 1 ovenfor.

## Kommandoer til reference
```bash
# Basiscase 2025, fuld flåde, activation_value-balancering
python run_case.py cases/billund_2025.yaml --data-source github --with-balancing
# Samme, men gammel balancemetode
python run_case.py cases/billund_2025.yaml --data-source github --with-balancing --balancing-method legacy
# A/B/C: C = ovenstående (med bal); A = uden --with-balancing; B = A + --disable tank_eksisterende
```
