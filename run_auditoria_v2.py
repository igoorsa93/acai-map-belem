"""
run_auditoria_v2.py — Gera auditoria_consolidada_v2.csv

Regras:
  - Prioridade de status: DENTRO > BAIRRO_VIZINHO > FORA_BAIRRO > FORA_BELEM > INCERTO
  - R3 tem prioridade INCONDICIONAL sobre outras rodadas
  - Não toca em auditoria_consolidada.csv (v1)
  - Não toca em dashboard_data.js
  - Não executa novas buscas

Fontes de dados (leitura):
  - data/model/dim_estabelecimentos.csv  → R1 + R2 (com bairro_pesquisa)
  - data/model/recuperacao_r2/estabelecimentos_recuperados.csv → R2 recuperados
  - data/coverage/varredura_g3_resumo.csv → cobertura G (resumo, sem place_id individual — ignorar)
  - data/processed/rodada_3/dim_estabelecimentos_r3.csv → R3
  - data/reports/auditoria_consolidada.csv → v1 (referência, rodadas flags)
"""
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

sys.path.insert(0, str(ROOT))

from src.rodada3.geo_validator import (
    validar_bairro,
    STATUS_DENTRO, STATUS_VIZINHO, STATUS_FORA_BAIRRO,
    STATUS_FORA_BELEM, STATUS_INCERTO,
)

# Ordem de prioridade (menor índice = maior prioridade)
STATUS_PRIORITY = {
    STATUS_DENTRO:      0,
    STATUS_VIZINHO:     1,
    STATUS_FORA_BAIRRO: 2,
    STATUS_FORA_BELEM:  3,
    STATUS_INCERTO:     4,
}

def _float(v):
    try:
        return float(v) if v else 0.0
    except (TypeError, ValueError):
        return 0.0

def _geo(lat, lon, bairro_pesq, endereco=""):
    try:
        r = validar_bairro(lat, lon, bairro_pesq, endereco)
        return (
            r.get("status", STATUS_INCERTO),
            r.get("bairro_detectado", ""),
            r.get("distancia_m", -1),
            r.get("metodo", "inconclusivo"),
        )
    except Exception as e:
        raise RuntimeError(f"GEO_VALIDATOR_ERROR: {e}") from e

master = {}  # place_id → dict

def _update(pid, rodada_key, nome, lat, lon, rating, reviews, sg, bd):
    """Insere/atualiza com prioridade de status."""
    if pid not in master:
        master[pid] = {
            "place_id": pid,
            "nome": nome,
            "latitude": lat,
            "longitude": lon,
            "rating": rating,
            "review_count": reviews,
            "status_geo": sg,
            "bairro_detectado": bd,
            "rodadas": set(),
            "r1": False, "r2": False, "g1": False,
            "g2": False, "g3": False, "r3": False,
        }
    e = master[pid]
    # Atualizar metadados sempre
    if nome and not e["nome"]:
        e["nome"] = nome
    try:
        if float(rating or 0) > float(e["rating"] or 0):
            e["rating"] = rating
            e["review_count"] = reviews
    except Exception:
        pass
    # Prioridade de status
    cur_pri = STATUS_PRIORITY.get(e["status_geo"], 99)
    new_pri = STATUS_PRIORITY.get(sg, 99)
    if new_pri < cur_pri:
        e["status_geo"] = sg
        e["bairro_detectado"] = bd
    e["rodadas"].add(rodada_key)
    e[rodada_key] = True

# ── Carregar v1 para preservar flags de rodada e coordenadas ─────────────────
v1_path = ROOT / "data/reports/auditoria_consolidada.csv"
v1_data = {}
if v1_path.exists():
    with open(v1_path) as f:
        for row in csv.DictReader(f):
            v1_data[row["place_id"]] = row

print("✓ v1 carregado:", len(v1_data), "PIDs")

# ── Carregar dim_estabelecimentos.csv (R1 + R2) ───────────────────────────────
dim_path = ROOT / "data/model/dim_estabelecimentos.csv"
r1_count = r2_count = 0
if dim_path.exists():
    with open(dim_path) as f:
        for row in csv.DictReader(f):
            pid = row.get("place_id", "")
            if not pid:
                continue
            lat = _float(row.get("latitude"))
            lon = _float(row.get("longitude"))
            bp  = row.get("bairro_pesquisa", "")
            end = row.get("endereco", "")
            sg, bd, _, _ = _geo(lat, lon, bp, end)
            # Determinar se é R1 ou R2 a partir de v1
            v1 = v1_data.get(pid, {})
            rod = "r2" if v1.get("r2") == "True" else "r1"
            _update(pid, rod,
                    row.get("nome_estabelecimento",""),
                    lat, lon,
                    row.get("review_rating",""),
                    row.get("review_count",""),
                    sg, bd)
            if rod == "r1": r1_count += 1
            else: r2_count += 1

print(f"✓ dim_estabelecimentos: {r1_count} R1, {r2_count} R2")

# ── Recuperados R2 ────────────────────────────────────────────────────────────
rec_path = ROOT / "data/model/recuperacao_r2/estabelecimentos_recuperados.csv"
rec_count = 0
if rec_path.exists():
    with open(rec_path) as f:
        hdrs = None
        reader = csv.DictReader(f)
        for row in reader:
            pid = row.get("place_id", "")
            if not pid:
                continue
            lat = _float(row.get("latitude"))
            lon = _float(row.get("longitude"))
            bp  = row.get("bairro_pesquisa", "")
            end = row.get("endereco", "")
            sg, bd, _, _ = _geo(lat, lon, bp, end)
            _update(pid, "r2",
                    row.get("nome_estabelecimento", row.get("nome","")),
                    lat, lon,
                    row.get("review_rating", row.get("rating","")),
                    row.get("review_count", row.get("reviews","")),
                    sg, bd)
            rec_count += 1
print(f"✓ recuperados R2: {rec_count}")

# ── G-rounds (via v1 flags, re-geocodificando) ────────────────────────────────
# Não temos arquivos G individuais com place_id — usar v1 para identificar
# PIDs que entraram via G e re-geocodificar com bairro_pesq=""
g_count = 0
for pid, v1row in v1_data.items():
    is_g = any(v1row.get(g) == "True" for g in ["g1","g2","g3"])
    if not is_g:
        continue
    if pid in master:
        # Já no master via R1/R2 — apenas marcar flags G
        for g in ["g1","g2","g3"]:
            if v1row.get(g) == "True":
                master[pid][g] = True
                master[pid]["rodadas"].add(g)
        continue
    # PID novo (só G)
    lat = _float(v1row.get("latitude"))
    lon = _float(v1row.get("longitude"))
    sg, bd, _, _ = _geo(lat, lon, "", v1row.get("endereco",""))
    # G-round: qualquer bairro detectado → DENTRO
    if sg == STATUS_VIZINHO:
        sg = STATUS_DENTRO
    g_flags = [g for g in ["g1","g2","g3"] if v1row.get(g) == "True"]
    rod = g_flags[0] if g_flags else "g1"
    _update(pid, rod,
            v1row.get("nome",""),
            lat, lon,
            v1row.get("rating",""),
            v1row.get("review_count",""),
            sg, bd)
    for g in g_flags:
        master[pid][g] = True
        master[pid]["rodadas"].add(g)
    g_count += 1

print(f"✓ G-rounds: {g_count} PIDs exclusivos G")

# ── R3 (prioridade incondicional) ─────────────────────────────────────────────
r3_path = ROOT / "data/processed/rodada_3/dim_estabelecimentos_r3.csv"
r3_count = 0
if r3_path.exists():
    with open(r3_path) as f:
        for row in csv.DictReader(f):
            pid = row.get("place_id","")
            if not pid:
                continue
            lat = _float(row.get("latitude"))
            lon = _float(row.get("longitude"))
            bp  = row.get("bairro_pesquisa_primeiro","")
            end = row.get("endereco","")
            # Re-geocodificar via geo_validator (v2 — sem polígono)
            sg, bd, _, _ = _geo(lat, lon, bp, end)
            # R3 tem prioridade incondicional
            if pid in master:
                master[pid]["status_geo"] = sg
                master[pid]["bairro_detectado"] = bd
                master[pid]["rodadas"].add("r3")
                master[pid]["r3"] = True
                master[pid]["rodadas"].discard("r3")
                master[pid]["rodadas"].add("r3")
            else:
                _update(pid, "r3",
                        row.get("nome",""),
                        lat, lon,
                        row.get("review_rating",""),
                        row.get("review_count",""),
                        sg, bd)
                master[pid]["status_geo"] = sg
                master[pid]["bairro_detectado"] = bd
            master[pid]["r3"] = True
            master[pid]["rodadas"].add("r3")
            r3_count += 1

print(f"✓ R3: {r3_count} PIDs")

# ── PIDs restantes do v1 que não apareceram em nenhuma fonte ─────────────────
orphan = 0
for pid, v1row in v1_data.items():
    if pid in master:
        continue
    lat = _float(v1row.get("latitude"))
    lon = _float(v1row.get("longitude"))
    sg, bd, _, _ = _geo(lat, lon, "", "")
    _update(pid, "r1",
            v1row.get("nome",""),
            lat, lon,
            v1row.get("rating",""),
            v1row.get("review_count",""),
            sg, bd)
    for rod in ["r1","r2","g1","g2","g3","r3"]:
        if v1row.get(rod) == "True":
            master[pid][rod] = True
            master[pid]["rodadas"].add(rod)
    orphan += 1

print(f"✓ PIDs órfãos recuperados do v1: {orphan}")

# ── Escrever v2 ───────────────────────────────────────────────────────────────
out_path = ROOT / "data/reports/auditoria_consolidada_v2.csv"
fieldnames = ["place_id","nome","latitude","longitude","rating","review_count",
              "status_geo","bairro_detectado","rodadas","n_rodadas",
              "r1","r2","g1","g2","g3","r3"]

with open(out_path, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
    w.writeheader()
    for pid, e in master.items():
        rods = sorted(e["rodadas"])
        w.writerow({
            **e,
            "rodadas": "|".join(rods),
            "n_rodadas": len(rods),
            "r1": e.get("r1", False),
            "r2": e.get("r2", False),
            "g1": e.get("g1", False),
            "g2": e.get("g2", False),
            "g3": e.get("g3", False),
            "r3": e.get("r3", False),
        })

print(f"\n✓ Escrito: {out_path}")
print(f"  Total PIDs: {len(master)}")

# ── Distribuição ──────────────────────────────────────────────────────────────
from collections import Counter
dist = Counter(e["status_geo"] for e in master.values())
total = len(master)
print("\n── Distribuição v2 ───────────────────────────────────────")
for s in [STATUS_DENTRO, STATUS_VIZINHO, STATUS_FORA_BAIRRO, STATUS_FORA_BELEM, STATUS_INCERTO]:
    n = dist.get(s, 0)
    print(f"  {s:<20} {n:>5}  ({n/total*100:.1f}%)")
print(f"  {'TOTAL':<20} {total:>5}")
