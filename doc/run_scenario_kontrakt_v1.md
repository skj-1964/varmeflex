# `run_scenario` — kontrakt og manifest-skema (v1, opdateret efter implementering)

> Arbejdsdokument. Fundamentet for både fase 1 (cache) og fase 2 (live solver) på varmeflex.dk.
> Forudsætter projektkonteksten (`varmeflex_projektkontekst.md`); gentager den ikke. Tal i eksempler er pladsholdere, ikke resultater.
>
> **Status:** Implementeret og valideret på rigtige github-data (2025, session 1). Manifest-skriveren ligger i `src/manifest.py`; alle felter på nær det udskudte `spotresultat_dkk` udfyldes korrekt. Se `STATUS_session1.md` for valideringsresultater og kendte modelfejl i balance-tallene.

---

## 1. Grundidé: `output/` er sandheden, manifestet er følgesedlen

Modellen ligger på serveren. Hver gang en kørsel udføres — manuelt af dig i fase 1, af Claude live i fase 2 — skriver den sine resultater til `output/`. Det, der ligger i `output/`, *er* det katalog af scenarier, hjemmesidens bruger kan vælge imellem. Der er ingen separat liste at vedligeholde ved siden af.

For at hver kørsel skal være selvbeskrivende, skriver den — ud over de CSV/PNG-filer den allerede laver — én **følgeseddel** per kørsel: `{stem}_manifest.json`. Manifestet samler menutekst, kørselsparametre, sporbarhed og nøgletal ét sted, så både hjemmesiden og `run_scenario` kan læse alt fra én fil uden at parse filnavne eller skrabe skærm-output.

Filnavn-stammen er den entydige nøgle og følger modellens eksisterende format:

```
{case_name}__{datakilde}__{periode}[__bal][__{overrides}]
```

Den samme opdagelsesmekanisme — "læs manifesterne i `output/`" — gælder i **begge faser**. Det er kernen i to-fase-snittet: kontrakten og opdagelseslaget ændrer sig ikke, kun bagsiden af værktøjet.

---

## 2. Værktøjsgrænsefladen

To kald deler samme bagside. Begge læser `output/` i fase 1; i fase 2 kan `run_scenario` desuden generere en manglende kørsel live. Signaturen er uændret mellem faserne.

### 2.1 `list_scenarier() -> [resumé]`

Returnerer kataloget: et resumé per tilgængelig kørsel (nøgle, titel, beskrivelse, gruppe, kerneparametre), bygget ved at læse alle `*_manifest.json` i `output/`. Det er denne liste, hjemmesiden viser brugeren, og som Claude vælger ud fra.

### 2.2 `run_scenario(...) -> manifest`

Peger på én kørsel — enten direkte via nøgle, eller via parametre der opløses til en nøgle:

```
run_scenario(
    scenarie_id: str | None = None,     # direkte nøgle (output-stem), hvis allerede valgt fra kataloget
    # — eller — parametre der opløses til en nøgle:
    case: str = "billund_2025",         # hvilken YAML i cases/
    periode: dict | str = "standard",   # {start, slut} eller navngivet periode
    med_balancering: bool = False,      # svarer til --with-balancing
    enheder_fra: list[str] = [],        # svarer til --disable (fx ["tank_eksisterende"])
    overrides: dict = {},               # svarer til --set (fx {"prices.natural_gas.value": 500})
    inkluder_serier: bool = False,      # om timeserierne (til figurer) skal med i svaret
) -> Manifest
```

**Returværdi:** manifestet (skema i afsnit 3). Hvis `inkluder_serier=True`, vedhæftes timeserierne fra `{stem}_hourly.csv` parset; ellers refereres de blot via filsti, så de kan hentes når en figur skal tegnes.

**Adfærd, fase 1:** opløs parametre → stamme → hvis `output/{stem}_manifest.json` findes, returnér det. Findes det ikke, returnér `{fundet: false, foreslåede_nærmeste: [...]}`, så Claude ærligt kan sige "den kørsel er ikke forhåndsberegnet — det nærmeste er …".

**Adfærd, fase 2:** som fase 1, men hvis kørslen mangler, sættes den i kø, køres live, manifestet skrives til `output/`, og resultatet returneres. Samme returformat.

### 2.3 Differensen beregnes ovenpå

Forretningscasen er forskellen mellem parrede scenarier (med/uden tank, med/uden balancering). Den beregnes i fortolkningslaget ved at kalde `run_scenario` to gange og trække nøgletal fra hinanden — ikke i værktøjet. Det holder hver cache-post atomar: én YAML-kørsel = ét manifest = én post.

---

## 3. Manifest-skemaet (`{stem}_manifest.json`)

Alle pengebeløb i DKK, energi i MWh, medmindre andet er angivet.

```json
{
  "schema_version": "1.0",
  "scenarie_id": "billund_2025__gh__2025__bal-av",

  "meta": {
    "case_name": "billund_2025",
    "titel": "Billund 2025 — fuld flåde",
    "beskrivelse": "Basiscase 2025 — fuld flåde mod 2025's markedsforhold.",
    "gruppe": "billund_2025",
    "rolle_i_gruppe": null
  },

  "koersel": {
    "datakilde": "github",
    "periode": { "start": "2025-01-01", "slut": "2025-12-31", "oploesning": "1h" },
    "med_balancering": true,
    "enheder_til": ["vp_luft_vand", "elkedel_ny", "elkedel_gl", "fliskedel", "halmkedel", "gasmotor", "gaskedel_agg"],
    "enheder_fra": ["overskudsvarme"],
    "overrides": [],
    "foresight_haircut_pct": null
  },

  "sporbarhed": {
    "model_commit": "6f4ba6e",
    "koert_tidspunkt": "2026-06-17T11:27:17Z",
    "solve_status": "optimal",
    "model_type": "MILP"
  },

  "noegletal": {
    "objektiv_dkk": 0,
    "varmeefterspoergsel_mwh": 0,
    "samlet_produktion_mwh": 0,
    "nettab_mwh": 0,
    "nettab_pct": 0,
    "balanceindtaegt_dkk": { "i_alt": 0, "afrr": 0, "mfrr": 0 },
    "tank_arbitrage_dkk": null,
    "co2_ton": 0
  },

  "enheder": [
    { "navn": "vp_luft_vand", "p_max_mw": 16.0, "produktion_mwh": 0, "andel_pct": 0, "fuldlasttimer": 0, "kapacitetsfaktor_pct": 0 }
  ],

  "filer": {
    "manifest": "billund_2025__gh__2025__bal-av_manifest.json",
    "hourly_csv": "billund_2025__gh__2025__bal-av_hourly.csv",
    "kpi_csv": "billund_2025__gh__2025__bal-av_kpi.csv",
    "monthly_csv": "billund_2025__gh__2025__bal-av_monthly.csv",
    "dispatch_png": "billund_2025__gh__2025__bal-av_dispatch.png"
  }
}
```

### Felt-noter

- **`meta.titel` / `beskrivelse`** er teksten, hjemmesidens bruger ser i valgmenuen; hentes fra YAML'ens `meta:`-sektion (afsnit 4). `titel` falder tilbage til `case_name`.
- **`meta.gruppe` / `rolle_i_gruppe`** er valgfri parringshjælp. For A/B/C på én delt YAML udledes rollen i praksis af `koersel` (`med_balancering`, `enheder_fra`) — `rolle_i_gruppe` er typisk `null`.
- **`koersel.overrides`** er en liste af `--set`-strenge (modellens faktiske format), ikke en dict.
- **`foresight_haircut_pct`** er `null`, når kørslen viser modellens rå (perfekt-forudseende) balanceindtægt. Haircut'et er en *fortolknings*-justering, ikke en del af solve'et; påføres det i kommunikationen, noteres procenten her.
- **`enheder`** kommer direkte fra `kpi`-DataFramen — felterne er 1:1 med `kpi_summary` (`fuldlasttimer` er heltal).
- **`balanceindtaegt_dkk`** summeres per marked fra `balancing.summarize_reserves` (`capacity_revenue_dkk` + `activation_price_revenue_dkk`); `null` uden balancering.
- **`tank_arbitrage_dkk`** er dual-baseret og derfor `null` ved MILP-kørsler (ingen duals). Tank-værdien aflæses i stedet som objektiv-differens A−B.
- **`co2_ton`** er fysiske udledninger: gasforbrug × `co2_emissions_per_mwh_fuel` (biomasse neutralt).
- **`solve_status`** normaliseres til `"optimal"` (modellen gemmer rå en tuple).
- **`spotresultat_dkk` er udskudt til v1.1** og udelades af v1.0-skemaet. En ren spot-dekomponering (el-flow × spotpris) skal bekræftes først; objektiv, balance og tank dækker den differentielle business case imens.

---

## 4. Lille udvidelse af YAML'ens `meta:`-sektion

`meta.case_name` og `meta.description` findes allerede i alle cases. Tre valgfrie felter giver pænere menutekst og muliggør parring:

```yaml
meta:
  case_name: "billund_2025"
  description: "Fuld flåde mod 2025's markedsforhold."
  titel: "Billund 2025 — fuld flåde"   # NY (valgfri) — kort menutekst
  gruppe: "billund_2025"               # NY (valgfri) — parringsgruppe
  rolle: "C"                           # NY (valgfri) — rolle i gruppen
```

Manglende felter falder pænt tilbage (`titel` → `case_name`, ingen `gruppe` → scenariet står alene). Intet eksisterende brydes.

---

## 5. Implementering (as-built)

Manifest-skriveren er implementeret som et **selvstændigt modul, `src/manifest.py`** (ikke en ændring i `reporting.py` — lavere risiko). `run_case.py` er udvidet med to linjer: en import (`from src.manifest import write_manifest`) og et kald umiddelbart efter `dispatch_plot(...)`. `src/manifest.py` er den autoritative kilde til manifest-logikken; dette dokument gentager ikke koden.

De økonomiske felter, der i den oprindelige plan stod som `TODO`, er nu løst med verificerede feltnavne:

- **balanceindtægt:** `balancing.summarize_reserves` → `capacity_revenue_dkk` + `activation_price_revenue_dkk`, summeret per marked (aFRR/mFRR).
- **tank-arbitrage:** −`storage_net` · `shadow_price_heat` · dt (kun ved LP-duals; `null` ved MILP).
- **CO₂:** varme_MWh / `eta_fuel_to_heat` × `co2_emissions_per_mwh_fuel` for brændselsenheder.
- **spotresultat:** udskudt til v1.1 (se afsnit 3).

To fejl fundet og rettet under validering på Windows: datofeltet håndterer nu både `datetime` (fra YAML) og `str` (efter `--start/--end`-override), og skrivningen tvinger UTF-8 (ellers mangede `Path.write_text` æ/ø/å i cp1252).

---

## 6. Første kørsler til cachen

Base: **`cases/billund_2025.yaml`** (fuld flåde, hele 2025). DRY-princip: én YAML som anlægssandhed; A/B/C dannes via CLI-flag, og scenariets identitet udledes af manifestets `koersel`-felter — ikke af `meta.rolle`.

| Rolle | Beskrivelse | Kommando (på serveren) |
| --- | --- | --- |
| C | Med tank, med balancemarked | `python run_case.py cases/billund_2025.yaml --data-source github --with-balancing` |
| A | Med tank, uden balancemarked | `… (samme, uden --with-balancing)` |
| B | Uden tank, uden balancemarked | `… --disable tank_eksisterende` |

Heraf aflæses: **C − A** = værdien af balancemarkedet, **A − B** = værdien af tanken. Næste udvidelse er en pris-akse (fx gas lav/mellem/høj via `--set prices.natural_gas.value=…`) — hver som sin egen kørsel, uden at kontrakten ændres.

**NB:** balance-tallene er pt. urimeligt høje (modelfejl, se `STATUS_session1.md`) — afvent fix før cache-poster præsenteres.

---

## 7. Status og næste skridt

Gennemført (session 1): skema og kontrakt fastlagt; `src/manifest.py` + kald i `run_case.py` implementeret; valideret på rigtige github-data for både `activation_value` og `legacy`.

Næste:

1. Kør A/B/C på `billund_2025`-basen → tre manifester i `output/` (afvent evt. model-fix før præsentation).
2. Byg `run_scenario` + `list_scenarier` mod `output/` (backend, fase 1).
3. v1.1: tilføj `spotresultat_dkk`, når spot-dekomponeringskilden er bekræftet.
4. Model-bane (uden for denne kontrakt): balance-tallene er urimeligt høje — se `STATUS_session1.md`.
