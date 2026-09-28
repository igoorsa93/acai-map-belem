# 🍇 Açaí Map Belém — Dashboard Interativo

<div align="center">

[![Live Dashboard](https://img.shields.io/badge/🌐_Dashboard_Live-igoorsa93.github.io-7c3aed?style=for-the-badge)](https://igoorsa93.github.io/acai-map-belem)
[![App Mobile](https://img.shields.io/badge/📱_App_Mobile_PWA-igoorsa93.github.io-4B286D?style=for-the-badge)](https://igoorsa93.github.io/acai-map-belem-app)
[![GitHub](https://img.shields.io/badge/@Igoorsa93-181717?style=for-the-badge&logo=github)](https://github.com/igoorsa93)

**832 estabelecimentos · 66 bairros · Belém, Pará, Brasil**

</div>

---

## 📌 Sobre o Projeto

O **Açaí Map Belém** é um dashboard web interativo que mapeia e visualiza estabelecimentos especializados em açaí na cidade de Belém, Pará. O projeto coleta, valida geograficamente e apresenta dados de 832 estabelecimentos distribuídos em 66 bairros, com filtros interativos, mapa com clustering, gráficos e tabela paginada.

### 🔗 Repositórios do Ecossistema

| Repositório | Descrição | URL |
|-------------|-----------|-----|
| **[acai-map-belem](https://github.com/igoorsa93/acai-map-belem)** *(este repo)* | Dashboard web — coleta de dados, pipeline, visualização | [igoorsa93.github.io/acai-map-belem](https://igoorsa93.github.io/acai-map-belem) |
| **[acai-map-belem-app](https://github.com/igoorsa93/acai-map-belem-app)** | App mobile PWA — consome os dados gerados aqui | [igoorsa93.github.io/acai-map-belem-app](https://igoorsa93.github.io/acai-map-belem-app) |

> ⚠️ **Dependência**: O app mobile **funciona exclusivamente com os dados produzidos por este repositório**. O `dashboard_data.js` gerado pelo pipeline de coleta é a fonte de dados do aplicativo. Qualquer atualização no dataset deve ser publicada aqui primeiro.

---

## 🤖 Agentes de Inteligência Artificial

O projeto foi integralmente desenvolvido com agentes de IA, sem coleta manual.

### Agente Principal
- **Claude Sonnet 4.6** (Anthropic) — arquitetura do projeto, scripts Python, pipeline de dados, dashboard web, validação geográfica, auditorias, documentação

### Claude in Chrome (Automação de Browser)
- Único método capaz de acessar o Google Maps interativo (`googleapis.com` é bloqueado em ambientes cloud)
- JavaScript injetado via `mcp__claude-in-chrome__javascript_tool` para extrair dados de estabelecimentos diretamente do DOM do Google Maps
- Usado exclusivamente na rodada **R4** para coletar dados complementares bairro a bairro
- Extrai: nome, latitude, longitude, rating, review_count, place_id (formato CID `0x…:0x…`)

### Sub-agentes Paralelos (Arquitetura R3/R4)
- **`bairro_runner.py`**: orquestrador assíncrono que dispara até 5 sub-agentes simultâneos (`asyncio.Semaphore(5)`) por bairro
- Cada sub-agente processa um bairro independente: coleta → validação geográfica → deduplicação → integração
- 71 bairros → até 71 agentes paralelos → repositório por bairro → auditoria → repositório master

---

## 🗺️ Metodologia de Mapeamento

### Validação Geográfica (Haversine)

Cada estabelecimento coletado passa por validação de coordenadas usando a **fórmula de Haversine** para calcular distância real ao centróide do bairro declarado:

```
DENTRO      → distância ≤ raio × 1.5   ✅ Aceito
VIZINHO     → distância ≤ raio × 3.0   ⚠️ Aceito com flag
FORA_BAIRRO → distância  > raio × 3.0  ❌ Rejeitado ou redirecionado
```

O arquivo `config/bairros_r3.yaml` define para cada um dos 71 bairros:
- `centroide`: coordenadas lat/lon do centro geográfico
- `raio_km`: raio de referência para validação
- `nome_canonical`: nome oficial para normalização

### Escopo Geográfico

- **Incluídos**: 71 bairros oficiais de Belém + distrito de Outeiro
- **Excluídos**: Mosqueiro (ilha) e Castanhal (município distinto)
- Decisão baseada em auditoria geográfica manual — ver seção de Auditorias

### Deduplicação Cross-Round

O pipeline enfrenta o desafio de **dois formatos de place_id**:
- **ChIJ format** (Google Places API): `ChIJxxxxxxxxxxxxxxxx` — usado em R1/R2/G1/G2/G3/R3
- **CID format** (Chrome/Maps): `0xXXXXXXXX:0xXXXXXXXX` — usado em R4

A deduplicação entre formatos usa **proximidade geográfica** (haversine < 80 metros) como critério de equivalência quando os IDs não coincidem.

---

## 📦 Pipeline de Coleta — 7 Rodadas

| Rodada | Método | Resultado | Total Acumulado |
|--------|--------|-----------|-----------------|
| **R1** | Google Places API (Text Search + Nearby) | Base inicial | ~486 |
| **R2** | Recovery dirigido — bairros com baixa cobertura | +286 | ~772 |
| **G1** | Gap fill — estabelecimentos ausentes detectados | complementar | ~780 |
| **G2** | Gap fill — segunda passagem | complementar | ~785 |
| **G3** | Gap fill — terceira passagem | +6 | ~791 |
| **R3** | Sub-agentes paralelos por bairro (71 bairros) | consolidação | 821 |
| **R4** | Claude in Chrome — extração manual Google Maps | +11 | **832** |

---

## 🗃️ Estrutura de Dados — Master CSV

Arquivo: `data/master_consolidado.csv` — **20 colunas**

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `place_id` | string | Identificador único Google Places (ChIJ ou CID) |
| `nome` | string | Nome do estabelecimento |
| `latitude` | float | Coordenada geográfica |
| `longitude` | float | Coordenada geográfica |
| `rating` | float | Avaliação média (1.0–5.0) |
| `review_count` | int | Número de avaliações |
| `bairro_validado` | string | Bairro atribuído após validação geo |
| `status_geo` | enum | `DENTRO` / `VIZINHO` / `FORA_BAIRRO` |
| `distancia_m` | float | Distância em metros ao centróide |
| `metodo_validacao` | string | Algoritmo usado na validação |
| `rodadas` | string | Lista de rodadas em que aparece |
| `n_rodadas` | int | Quantidade de rodadas |
| `r1` | bool | Presente na rodada R1 |
| `r2` | bool | Presente na rodada R2 |
| `g1` | bool | Presente na rodada G1 |
| `g2` | bool | Presente na rodada G2 |
| `g3` | bool | Presente na rodada G3 |
| `r3` | bool | Presente na rodada R3 |
| `fonte_bairros` | string | Fonte de referência do bairro |
| `r4` | bool | Presente na rodada R4 (Chrome) |

---

## 🐍 Scripts Python (17 scripts)

| Script | Descrição |
|--------|-----------|
| `build_data.py` | Pipeline principal: CSVs → `dashboard_data.js` (window.ACAI_MAP_DATA) |
| `bairro_runner.py` | Orquestrador assíncrono de sub-agentes paralelos (asyncio, semáforo=5) |
| `scraper_client.py` | Cliente de scraping por bairro com retry e timeout |
| `r4_runner.py` | Orquestrador R4 — coordena coleta via Chrome por bairro |
| `r4_save.py` | Integrador de dados R4 (Chrome) no pipeline master |
| `consolidar_r2.py` | Consolidador da rodada R2 — lê recovery CSV e regenera dashboard |
| `geo_validator.py` | Validação haversine: DENTRO / VIZINHO / FORA_BAIRRO |
| `dedup.py` | Deduplicação cross-round por place_id e proximidade (<80m) |
| `gap_analysis.py` | Identifica bairros com cobertura insuficiente (G1/G2/G3) |
| `audit_geo.py` | Auditoria geográfica — detecta estabelecimentos fora do escopo |
| `bairros_index.py` | Gerador do índice de centroides (`bairros_index.json`) |
| `normalize_bairros.py` | Normalização de nomes de bairros (unicodedata + re) |
| `merge_rounds.py` | Merge incremental entre rodadas de coleta |
| `kpi_calc.py` | Cálculo de KPIs agregados por bairro e tipo |
| `export_powerbi.py` | Exporta CSVs no formato do Power BI (`data/powerbi/`) |
| `slug_utils.py` | Geração de slugs para nomes de bairros (sem acentos) |
| `validate_master.py` | Valida schema e integridade do CSV master |

---

## 🌐 Módulos JavaScript (13 módulos)

| Módulo | Descrição |
|--------|-----------|
| `js/app.js` | Entry point — inicialização e orquestração dos módulos |
| `js/state.js` | Estado central + pub/sub dispatcher (padrão observer) |
| `js/data.js` | Acesso a dados — wraps `window.ACAI_MAP_DATA` |
| `js/filters.js` | UI de filtros: dropdowns, chips ativos, reset |
| `js/kpis.js` | Cards KPI com animação count-up |
| `js/map.js` | Mapa Leaflet: marcadores, clustering, painel de detalhe, mini-map |
| `js/charts.js` | 6 gráficos Chart.js (barras, doughnut, scatter) |
| `js/tables.js` | Tabela paginada e ordenável |
| `js/animations.js` | Canvas com partículas de fundo (hero section) |
| `js/interactions.js` | Navegação, atalhos de teclado, busca global |
| `js/utils.js` | Utilitários: `fmt`, `debounce`, `haversine`, `countUp`, `slugify` |
| `data/dashboard_data.js` | Gerado por `build_data.py` — `window.ACAI_MAP_DATA` com todos os dados |
| `assets/` | SVGs: logo completo, logo-mark, favicon |

---

## 📚 Bibliotecas Externas

### JavaScript (CDN — sem API keys)

| Biblioteca | Versão | Uso |
|------------|--------|-----|
| [Leaflet](https://leafletjs.com/) | 1.9.4 | Mapas interativos (tiles OpenStreetMap) |
| [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) | 1.5.3 | Agrupamento de marcadores |
| [Leaflet.heat](https://github.com/Leaflet/Leaflet.heat) | 0.2.0 | Mapa de calor de densidade |
| [Chart.js](https://www.chartjs.org/) | 4.4.4 | Gráficos (bar, doughnut, scatter) |
| [chartjs-plugin-datalabels](https://chartjs-plugin-datalabels.netlify.app/) | 2.2.0 | Labels nos gráficos |

### Python (10 bibliotecas)

| Biblioteca | Uso |
|------------|-----|
| `asyncio` | Orquestração de sub-agentes paralelos |
| `aiohttp` | Requisições HTTP assíncronas |
| `csv` / `json` | Leitura e escrita de dados |
| `PyYAML` | Leitura de `bairros_r3.yaml` |
| `math` | Fórmula de Haversine |
| `pathlib` | Manipulação de caminhos de arquivo |
| `unicodedata` + `re` | Normalização de strings e slugs |
| `openpyxl` | Exportação Excel (Power BI) |
| `logging` | Logs de pipeline e auditoria |

---

## 🎨 Sistema de Design

### Paleta de Cores

| Tipo | Cor | Hex |
|------|-----|-----|
| Especializado em açaí | Roxo escuro | `#4B286D` |
| Açaí + outro segmento | Verde | `#3F6B4F` |
| Outro estabelecimento | Cinza | `#909090` |
| Accent principal | Violeta | `#7c3aed` |
| Accent hover | Roxo | `#6d28d9` |

### Tipografia

- **Display / Títulos**: [Poppins](https://fonts.google.com/specimen/Poppins) (Google Fonts) — weights 300, 400, 600, 700
- **Interface / Dados**: [Inter](https://fonts.google.com/specimen/Inter) (Google Fonts) — weights 300, 400, 500, 600

### CSS Architecture

- **`css/variables.css`** — design tokens (`:root` custom properties)
- **`css/reset.css`** — minimal reset
- **`css/layout.css`** — header, hero, sections, grid
- **`css/components.css`** — KPI cards, filter chips, detail panel
- **`css/map.css`** — Leaflet overrides, tooltips, legenda
- **`css/charts.css`** — containers Chart.js
- **`css/tables.css`** — data table
- **`css/responsive.css`** — breakpoints: 1400 / 1200 / 1024 / 768 / 480px

---

## 🔍 Auditorias Realizadas

### Auditoria 1 — Escopo Geográfico (Castanhal)
- **Problema**: Estabelecimentos do município de Castanhal incluídos incorretamente no dataset
- **Ação**: Remoção de todos os registros com localização fora dos limites de Belém
- **Resultado**: Dataset restrito ao município de Belém

### Auditoria 2 — Ilhas: Mosqueiro vs. Outeiro
- **Problema**: Ambas as ilhas estavam incluídas; escopo é apenas Belém continental
- **Análise**: Outeiro é distrito de Belém; Mosqueiro é ilha com acesso por balsa
- **Decisão**: Outeiro ✅ incluído | Mosqueiro ❌ excluído
- **Resultado**: 10 estabelecimentos de Mosqueiro removidos; Outeiro mantido (9 estab.)

### Auditoria 3 — Precisão de Coordenadas (Canudos)
- **Problema**: Centróide do bairro Canudos configurado com coordenadas incorretas — 5 a 9× o raio de distância dos estabelecimentos reais
- **Ação**: Corrigidas as coordenadas em `config/bairros_r3.yaml` e `data/bairros_index.json`
- **Resultado**: Taxa de validação do bairro: 0% → 100%

### Auditoria 4 — Header CSV Campo R4
- **Problema**: Coluna `r4` adicionada ao CSV sem atualização do cabeçalho — valores não persistiam
- **Ação**: Reconstrução do `master_consolidado.csv` com schema completo de 20 colunas
- **Resultado**: 11 estabelecimentos R4 corretamente integrados (era 0 no dashboard)

### Auditoria 5 — Slug Duplicado (Universitário)
- **Problema**: Dois diretórios de coleta para o mesmo bairro: `universit_rio/` e `universitario/`
- **Causa**: Bug de normalização Unicode em versão anterior do `slug_utils.py`
- **Ação**: Remoção do diretório com slug incorreto; dados consolidados no diretório canonical
- **Resultado**: Sem duplicação de estabelecimentos do bairro

### Auditoria 6 — KPI Divergente no Dashboard
- **Problema**: Dashboard exibia 780 estabelecimentos enquanto o array interno tinha contagem diferente
- **Ação**: Sincronização do `dashboard_data.js` com o CSV master atualizado
- **Resultado**: KPIs consistentes com o dataset real

### Auditoria 7 — Sobrescrita do `dashboard_data.js`
- **Problema**: `consolidar_r2.py` regenera `dashboard_data.js` a partir do CSV R2, sobrescrevendo correções manuais
- **Ação**: Documentação do fluxo correto — `build_data.py` deve ser sempre o gerador final
- **Resultado**: Pipeline documentado; ordem de execução definida

---

## 🏗️ Estrutura de Diretórios

```
acai-map-belem/
├── web/                          # Dashboard web (GitHub Pages root)
│   ├── index.html                # Ponto de entrada principal
│   ├── build_data.py             # Pipeline: CSVs → dashboard_data.js
│   ├── assets/
│   │   ├── logo.svg              # Logo completo com texto
│   │   ├── logo-mark.svg         # Símbolo isolado
│   │   └── favicon.svg           # Favicon do browser
│   ├── css/
│   │   ├── variables.css         # Design tokens
│   │   ├── reset.css
│   │   ├── layout.css
│   │   ├── components.css
│   │   ├── map.css
│   │   ├── charts.css
│   │   ├── tables.css
│   │   └── responsive.css
│   ├── js/
│   │   ├── app.js
│   │   ├── state.js
│   │   ├── data.js
│   │   ├── filters.js
│   │   ├── kpis.js
│   │   ├── map.js
│   │   ├── charts.js
│   │   ├── tables.js
│   │   ├── animations.js
│   │   ├── interactions.js
│   │   └── utils.js
│   └── data/
│       └── dashboard_data.js     # Gerado — não editar manualmente
├── data/
│   ├── master_consolidado.csv    # Dataset master (832 estab., 20 colunas)
│   ├── bairros_index.json        # Centroides e raios dos 71 bairros
│   ├── powerbi/
│   │   └── dim_estabelecimentos_pbi.csv
│   ├── model/
│   │   ├── fact_ocorrencias_busca.csv
│   │   ├── dim_consultas.csv
│   │   └── dim_bairros.csv
│   └── coleta/                   # Dados brutos por rodada
│       ├── r1/, r2/, r3/, r4/
│       └── g1/, g2/, g3/
├── config/
│   └── bairros_r3.yaml           # Config geográfica dos 71 bairros
├── scripts/
│   ├── bairro_runner.py
│   ├── r4_runner.py
│   ├── r4_save.py
│   ├── geo_validator.py
│   ├── dedup.py
│   ├── gap_analysis.py
│   ├── merge_rounds.py
│   └── ...                       # demais scripts
└── README.md
```

---

## 🚀 Como Executar Localmente

### 1. Gerar os dados

```bash
# A partir da raiz do projeto
python web/build_data.py
```

Lê os CSVs em `data/` e escreve `web/data/dashboard_data.js` com `window.ACAI_MAP_DATA`.

### 2. Servir o dashboard

```bash
# Python (a partir de web/)
cd web && python -m http.server 8080

# Node
cd web && npx serve .
```

Acesse `http://localhost:8080`.

> **Importante**: O dashboard usa ES modules (`type="module"`). Deve ser servido via HTTP — abrir `index.html` com `file://` falhará por restrições CORS.

### 3. Executar coleta R4 (Chrome)

```bash
# Requer Claude in Chrome ativo no browser
python scripts/r4_runner.py --bairro "Cidade Velha"
python scripts/r4_save.py --input data/coleta/r4/cidade_velha/raw.json
```

---

## 📊 KPIs do Dataset

| Métrica | Valor |
|---------|-------|
| Total de estabelecimentos | **832** |
| Bairros cobertos | **66 de 71** |
| Média de avaliação | **3,61 ★** |
| Rodadas de coleta | **7** |
| Scripts Python | **17** |
| Módulos JavaScript | **13** |
| Auditorias realizadas | **7** |

---

## 🔗 Deploy — GitHub Pages

O deploy é automático via **GitHub Pages** a partir do branch `master`. Qualquer push ao master atualiza o site em minutos.

- **Dashboard**: https://igoorsa93.github.io/acai-map-belem
- **App Mobile**: https://igoorsa93.github.io/acai-map-belem-app

---

## 👤 Autor

**[@Igoorsa93](https://github.com/igoorsa93)** — Igor Cardoso 
Desenvolvido com IA generativa (Claude Sonnet 4.6 · Anthropic) · Belém, Pará, Brasil · 2026
