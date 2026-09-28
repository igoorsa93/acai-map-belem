#!/usr/bin/env python3
"""
Auditoria Rigorosa de Sanidade e Limpeza
Açaí Map Belém — pipeline de purga e validação

Saídas:
  data/reports/quarentena_invalido.csv   — registros purgados + motivo
  data/reports/master_consolidado.csv    — master limpo (sobrescreve)
  data/dashboard_data.js                 — regenerado a partir do master limpo

Critérios de purga (em ordem de prioridade):
  SEM_PLACE_ID          — place_id ausente ou vazio
  SEM_NOME              — nome ausente, vazio ou genérico
  COORDENADA_INVALIDA   — lat/lon ausente, zero ou não-numérico
  FORA_DE_BELEM         — coordenadas fora do bounding box da região
  NOME_GENERICO         — nomes que indicam teste/lixo de sistema
"""

import csv
import json
import os
import re
import sys
from pathlib import Path
from datetime import date

# ── Caminhos ────────────────────────────────────────────────────────────────
ROOT       = Path(__file__).parent.parent
MASTER_CSV = ROOT / "data/reports/master_consolidado.csv"
DIM_CSV    = ROOT / "data/model/dim_estabelecimentos.csv"
BAIRROS_DIR= ROOT / "data/coleta/bairros"
QUARENTENA = ROOT / "data/reports/quarentena_invalido.csv"
DASH_JS    = ROOT / "data/dashboard_data.js"
FOTOS_JSON = ROOT / "data/model/fotos_estabelecimentos.json"

# ── Bounding box de Belém (inclui Icoaraci, Outeiro, toda a região continental)
LAT_MIN, LAT_MAX = -1.55, -0.95
LON_MIN, LON_MAX = -48.85, -48.00

# ── Nomes genéricos / fantasmas ──────────────────────────────────────────────
NOMES_INVALIDOS = re.compile(
    r"^\s*(teste|test|loja teste|estabelecimento teste|açaí teste|"
    r"sem nome|s\.?n\.?|nome|example|mock|fake|temp|n/?a|null|none"
    r"|estabelecimento [0-9]+|local [0-9]+)\s*$",
    re.IGNORECASE | re.UNICODE
)

# ── Helpers ──────────────────────────────────────────────────────────────────
def parse_float(v):
    try:
        f = float(str(v).strip())
        return f if f != 0.0 else None
    except Exception:
        return None

def coord_valida(lat, lon):
    """Retorna True se as coordenadas caem dentro da região de Belém."""
    if lat is None or lon is None:
        return False
    return LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX

def nome_valido(nome):
    if not nome or not str(nome).strip():
        return False
    return not NOMES_INVALIDOS.match(str(nome).strip())

def auditar_registro(row, fonte="master"):
    """
    Retorna (motivo, str) se o registro deve ser purgado,
    ou (None, None) se é válido.
    """
    pid   = str(row.get("place_id","")).strip()
    nome  = str(row.get("nome","")).strip()
    lat_r = row.get("latitude") or row.get("lat")
    lon_r = row.get("longitude") or row.get("lon")
    lat   = parse_float(lat_r)
    lon   = parse_float(lon_r)

    if not pid:
        return "SEM_PLACE_ID", f"place_id vazio | nome='{nome}'"
    if not nome_valido(nome):
        return "SEM_NOME", f"nome ausente ou genérico: '{nome}' | pid={pid}"
    if lat is None or lon is None:
        return "COORDENADA_INVALIDA", f"lat='{lat_r}' lon='{lon_r}' | pid={pid}"
    if not coord_valida(lat, lon):
        return "FORA_DE_BELEM", (
            f"lat={lat:.6f} lon={lon:.6f} fora do bounding box "
            f"({LAT_MIN},{LON_MIN})→({LAT_MAX},{LON_MAX}) | pid={pid}"
        )
    return None, None

# ── 1. Carregar master ────────────────────────────────────────────────────────
print("=" * 60)
print("AÇAÍ MAP BELÉM — Auditoria Rigorosa")
print("=" * 60)

master_rows = []
with open(MASTER_CSV, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    master_fields = reader.fieldnames
    for row in reader:
        master_rows.append(row)

print(f"\n[1] Master carregado: {len(master_rows)} registros")
print(f"    Campos: {master_fields}")

# ── 2. Auditar cada registro do master ───────────────────────────────────────
validos    = []
purgados   = []
motivos    = {}

for row in master_rows:
    motivo, detalhe = auditar_registro(row, "master")
    if motivo:
        purgados.append({
            **row,
            "_motivo_purga": motivo,
            "_detalhe_purga": detalhe,
            "_fonte": "master_consolidado.csv"
        })
        motivos[motivo] = motivos.get(motivo, 0) + 1
    else:
        validos.append(row)

print(f"\n[2] Resultado da auditoria do master:")
print(f"    Válidos:  {len(validos)}")
print(f"    Purgados: {len(purgados)}")
for m, n in sorted(motivos.items(), key=lambda x: -x[1]):
    print(f"      {m}: {n}")

# ── 3. Auditar bairros individuais (validado.csv) ────────────────────────────
print(f"\n[3] Auditando bairros individuais...")
pids_master = {r["place_id"] for r in validos}

bairro_stats = {}
extra_purga  = []   # encontrados só nos bairros e inválidos

for bdir in sorted(BAIRROS_DIR.iterdir()):
    val_csv = bdir / "validado.csv"
    if not val_csv.exists():
        continue
    bairro = bdir.name
    b_total = b_ok = b_purgado = 0
    with open(val_csv, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            b_total += 1
            motivo, detalhe = auditar_registro(row, f"bairros/{bairro}")
            if motivo:
                b_purgado += 1
                pid = row.get("place_id","")
                # Se estava no master como válido, mover para purga também
                if pid in pids_master:
                    extra_purga.append({
                        "place_id": pid,
                        "_motivo_purga": motivo + "_BAIRRO",
                        "_detalhe_purga": detalhe,
                        "_fonte": f"bairros/{bairro}/validado.csv"
                    })
            else:
                b_ok += 1
    bairro_stats[bairro] = (b_total, b_ok, b_purgado)

# Consolidar extra purgas (do bairro que passaram no master por ter campos diferentes)
extra_pids = {r["place_id"] for r in extra_purga}
if extra_pids:
    print(f"    → {len(extra_pids)} registros adicionais com problemas nos bairros")
    # Retira do validos e coloca em purgados
    validos_filtrados = [r for r in validos if r["place_id"] not in extra_pids]
    purgados_extra    = [r for r in validos if r["place_id"] in extra_pids]
    for r in purgados_extra:
        extra = next((e for e in extra_purga if e["place_id"] == r["place_id"]), {})
        purgados.append({**r,
            "_motivo_purga": extra.get("_motivo_purga","INCONSISTENCIA_BAIRRO"),
            "_detalhe_purga": extra.get("_detalhe_purga",""),
            "_fonte": extra.get("_fonte","")
        })
    validos = validos_filtrados

bairros_com_problema = [(b, s) for b, s in bairro_stats.items() if s[2] > 0]
if bairros_com_problema:
    print(f"    Bairros com registros inválidos ({len(bairros_com_problema)}):")
    for b, (t, ok, p) in sorted(bairros_com_problema, key=lambda x: -x[1][2])[:10]:
        print(f"      {b}: {p}/{t} purgados")
else:
    print("    Todos os bairros: registros válidos ✓")

print(f"\n    Total final válidos:  {len(validos)}")
print(f"    Total final purgados: {len(purgados)}")

# ── 4. Verificação de duplicatas por place_id ────────────────────────────────
print(f"\n[4] Verificando duplicatas por place_id...")
seen_pids = {}
dedup = []
dup_count = 0
for row in validos:
    pid = row["place_id"]
    if pid in seen_pids:
        dup_count += 1
        purgados.append({**row,
            "_motivo_purga": "DUPLICATA",
            "_detalhe_purga": f"place_id '{pid}' já existe (1ª ocorrência na linha {seen_pids[pid]})",
            "_fonte": "master_consolidado.csv"
        })
    else:
        seen_pids[pid] = len(dedup) + 1
        dedup.append(row)

validos = dedup
if dup_count:
    print(f"    {dup_count} duplicatas removidas")
else:
    print(f"    Nenhuma duplicata ✓")

# ── 5. Salvar quarentena ─────────────────────────────────────────────────────
print(f"\n[5] Salvando quarentena...")
quarentena_fields = (master_fields or []) + ["_motivo_purga", "_detalhe_purga", "_fonte"]
# Normaliza campos
quarentena_fields_set = list(dict.fromkeys(quarentena_fields))
with open(QUARENTENA, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=quarentena_fields_set, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(purgados)
print(f"    → {QUARENTENA} ({len(purgados)} registros)")

# ── 6. Salvar master limpo ───────────────────────────────────────────────────
print(f"\n[6] Salvando master limpo...")
with open(MASTER_CSV, "w", newline="", encoding="utf-8") as f:
    writer = csv.DictWriter(f, fieldnames=master_fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(validos)
print(f"    → {MASTER_CSV} ({len(validos)} registros)")

# ── 7. Carregar enriquecimento (dim) e fotos ─────────────────────────────────
print(f"\n[7] Carregando enriquecimento...")
dim = {}
with open(DIM_CSV, newline="", encoding="utf-8") as f:
    reader = csv.DictReader(f)
    for row in reader:
        pid = row.get("place_id","").strip()
        if pid:
            dim[pid] = row

fotos = {}
if FOTOS_JSON.exists():
    with open(FOTOS_JSON) as f:
        fotos = json.load(f)

print(f"    dim_estabelecimentos: {len(dim)} registros")
print(f"    fotos: {len(fotos)} registros")

# ── 8. Montar estabelecimentos para o dashboard ──────────────────────────────
print(f"\n[8] Montando objetos para o dashboard...")

def safe(v, default=""):
    if v is None: return default
    s = str(v).strip()
    return s if s and s.lower() not in ("nan", "none", "") else default

def safe_float(v, default=None):
    f = parse_float(v)
    return round(f, 6) if f is not None else default

def safe_int(v, default=0):
    try:
        i = int(str(v).strip())
        return i if i >= 0 else default
    except Exception:
        return default

def safe_bool(v):
    return str(v).strip().lower() in ("true","1","yes","sim")

estabelecimentos = []
sem_enriquecimento = 0
com_foto = 0
com_link = 0

for row in validos:
    pid = row["place_id"]
    d   = dim.get(pid, {})

    lat = safe_float(row.get("latitude"))
    lon = safe_float(row.get("longitude"))
    if lat is None or lon is None:
        continue   # coordenadas já validadas, não deve acontecer

    rating_v = safe_float(row.get("rating") or d.get("review_rating"))
    reviews_v = safe_int(row.get("review_count") or d.get("review_count"))

    foto = fotos.get(pid) or None
    link = safe(d.get("link"))
    if foto:   com_foto += 1
    if link:   com_link += 1
    if not d:  sem_enriquecimento += 1

    tipo       = safe(d.get("tipo_estabelecimento"), "Outro estabelecimento")
    categoria  = safe(d.get("categoria_padronizada"), "Não informado")
    endereco   = safe(d.get("endereco"))
    telefone   = safe(d.get("telefone"))
    website    = safe(d.get("website"))
    termos     = safe(d.get("termos_encontrado"))
    ocorrencias = safe_int(d.get("ocorrencias_total"))

    estabelecimentos.append({
        "place_id":          pid,
        "nome":              safe(row.get("nome")),
        "lat":               lat,
        "lon":               lon,
        "rating":            rating_v,
        "reviews":           reviews_v,
        "bairro":            safe(row.get("bairro_validado"), safe(d.get("bairro_pesquisa"))),
        "status_geo":        safe(row.get("status_geo"), "DENTRO"),
        "distancia_m":       safe_int(row.get("distancia_m"), -1),
        "metodo_validacao":  safe(row.get("metodo_validacao")),
        "rodadas":           safe(row.get("rodadas")),
        "n_rodadas":         safe_int(row.get("n_rodadas")),
        "r4":                safe_bool(row.get("r4")),
        "tipo":              tipo,
        "categoria":         categoria,
        "endereco":          endereco,
        "telefone":          telefone,
        "website":           website,
        "link":              link,
        "termos":            termos,
        "ocorrencias":       ocorrencias,
        "foto":              foto,
    })

# ── 9. KPIs e listas ─────────────────────────────────────────────────────────
total = len(estabelecimentos)
rated = [e for e in estabelecimentos if e["rating"] and e["rating"] > 0]
avg_rating = round(sum(e["rating"] for e in rated) / len(rated), 2) if rated else 0
total_reviews = sum(e["reviews"] for e in estabelecimentos)
bairros_set = sorted(set(e["bairro"] for e in estabelecimentos if e["bairro"]))
r4_novos = sum(1 for e in estabelecimentos if e["r4"])

kpis = {
    "total_estabelecimentos": total,
    "total_bairros": len(bairros_set),
    "total_areas":   len(bairros_set),
    "avg_rating":    avg_rating,
    "total_reviews": total_reviews,
    "r4_novos":      r4_novos,
    "com_foto":      com_foto,
    "com_link":      com_link,
}

# Tipos presentes na base
tipos_presentes = sorted(set(e["tipo"] for e in estabelecimentos if e["tipo"]))
tipos_list = [{"tipo": t} for t in tipos_presentes]

print(f"    Estabelecimentos montados: {total}")
print(f"      Sem enriquecimento dim: {sem_enriquecimento}")
print(f"      Com foto: {com_foto}")
print(f"      Com link: {com_link}")
print(f"      Com rating: {len(rated)}")
print(f"    KPIs: {kpis}")
print(f"    Tipos: {tipos_presentes}")
print(f"    Bairros: {len(bairros_set)}")

# ── 10. Serializar JSON sem trailing comma ────────────────────────────────────
def to_js_value(v):
    if v is None:    return "null"
    if v is True:    return "true"
    if v is False:   return "false"
    if isinstance(v, (int, float)): return str(v)
    escaped = str(v).replace("\\","\\\\").replace('"','\\"').replace("\n","\\n").replace("\r","")
    return f'"{escaped}"'

def obj_to_js(d):
    items = ", ".join(f'"{k}": {to_js_value(v)}' for k, v in d.items())
    return "{" + items + "}"

print(f"\n[9] Gerando dashboard_data.js...")

hoje = date.today().isoformat()
linhas = [
    f"// Gerado automaticamente — base: master_consolidado.csv + dim_estabelecimentos.csv",
    f"// {total} estabelecimentos · {len(bairros_set)} bairros · {len(tipos_presentes)} tipos",
    f"// Auditoria rigorosa: {len(purgados)} registros purgados",
    f"// Atualizado em: {hoje}",
    "window.ACAI_DATA = {",
    f"  kpis: {json.dumps(kpis, ensure_ascii=False)},",
    f"  tipos: {json.dumps(tipos_list, ensure_ascii=False)},",
    f"  areas: {json.dumps(bairros_set, ensure_ascii=False)},",
    f"  bairros: {json.dumps(bairros_set, ensure_ascii=False)},",
    "  estabelecimentos: [",
]
for i, e in enumerate(estabelecimentos):
    comma = "," if i < len(estabelecimentos) - 1 else ""
    linhas.append("    " + obj_to_js(e) + comma)
linhas.append("  ]")
linhas.append("};")

content = "\n".join(linhas) + "\n"
with open(DASH_JS, "w", encoding="utf-8") as f:
    f.write(content)

size_kb = len(content.encode("utf-8")) // 1024
print(f"    → {DASH_JS} ({size_kb} KB)")

# ── 11. Relatório final ───────────────────────────────────────────────────────
print()
print("=" * 60)
print("RELATÓRIO DE PURGA")
print("=" * 60)
print(f"Total analisado (original):  832")
print(f"Válidos após auditoria:      {total}")
print(f"Purgados / Quarentena:       {len(purgados)}")
print()
print("Motivos de purga:")
motivos_final = {}
for r in purgados:
    m = r.get("_motivo_purga","?")
    motivos_final[m] = motivos_final.get(m, 0) + 1
for m, n in sorted(motivos_final.items(), key=lambda x: -x[1]):
    print(f"  {m:35s}: {n}")
print()
print("Bairros na base limpa:", len(bairros_set))
print("Tipos de estabelecimento:")
for t in tipos_presentes:
    n = sum(1 for e in estabelecimentos if e["tipo"] == t)
    print(f"  {t}: {n}")
print()
print("KPIs finais:")
for k, v in kpis.items():
    print(f"  {k}: {v}")
print()
if purgados:
    print(f"Registros purgados (amostra):")
    for r in purgados[:10]:
        print(f"  [{r.get('_motivo_purga')}] {r.get('nome','?')} | {r.get('place_id','?')}")
        print(f"    → {r.get('_detalhe_purga','')}")
print()
print(f"Quarentena:  {QUARENTENA}")
print(f"Master limpo: {MASTER_CSV}")
print(f"Dashboard:   {DASH_JS}")
print("=" * 60)
print("AUDITORIA CONCLUÍDA")
print("=" * 60)
