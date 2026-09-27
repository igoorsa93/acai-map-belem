"""
Auditoria Consolidada R1 + R2 + G1 + G2 + G3 + R3.

Distinção clara entre:
  foi_pesquisado  = bairro aparece em pelo menos uma tabela de busca
  dentro          = estabelecimento validado como pertencente ao bairro (bairro_detectado)

Dedup global por place_id, validação geográfica, 4 CSVs e tabela ranqueada de 71 bairros.
"""
import csv
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from src.rodada3.config_r3 import carregar_bairros, DATA
from src.rodada3.geo_validator import (
    validar_bairro,
    STATUS_DENTRO, STATUS_VIZINHO, STATUS_FORA_BAIRRO,
    STATUS_FORA_BELEM, STATUS_INCERTO,
)

REPORTS_DIR = DATA / "reports"
REPORTS_DIR.mkdir(parents=True, exist_ok=True)

# Arquivos fonte
R1R2_FILE   = DATA / "model" / "dim_estabelecimentos.csv"
R2R_FILE    = DATA / "model" / "recuperacao_r2" / "estabelecimentos_recuperados.csv"
G1_FILE     = DATA / "coverage" / "varredura_g1_filtrado.csv"
G2_FILE     = DATA / "coverage" / "varredura_g2_filtrado.csv"
G3_FILE     = DATA / "coverage" / "varredura_g3_filtrado.csv"
R3_FILE     = DATA / "processed" / "rodada_3" / "dim_estabelecimentos_r3.csv"
FACT_R3     = DATA / "processed" / "rodada_3" / "fact_ocorrencias_busca_r3.csv"
CONTROLE_R3 = DATA / "processed" / "rodada_3" / "controle_r3.csv"

ALL_STATUS = [STATUS_DENTRO, STATUS_VIZINHO, STATUS_FORA_BAIRRO, STATUS_FORA_BELEM, STATUS_INCERTO]
RODADAS    = ["r1", "r2", "g1", "g2", "g3", "r3"]


# ─── 1. Bairros de referência ─────────────────────────────────────────────────
bairros_cfg  = carregar_bairros()
bairro_set   = {b["bairro"] for b in bairros_cfg}
bairro_dist  = {b["bairro"]: b["distrito"] for b in bairros_cfg}
print(f"[config] {len(bairros_cfg)} bairros de referência")


# ─── 2. Helpers ───────────────────────────────────────────────────────────────
def _float(v):
    try:    return float(v) if v else 0.0
    except: return 0.0

def _int(v):
    try:    return int(float(v)) if v else 0
    except: return 0

def _geo(row_lat, row_lon, bairro_pesq, endereco=""):
    lat, lon = _float(row_lat), _float(row_lon)
    if lat == 0.0 and lon == 0.0:
        return STATUS_INCERTO, "", 0, "sem_coordenadas"
    r = validar_bairro(lat, lon, bairro_pesq, endereco)
    return (r.get("status", STATUS_INCERTO),
            r.get("bairro_detectado", ""),
            r.get("distancia_m", 0),
            r.get("metodo", ""))


# ─── 3. Estruturas de controle ────────────────────────────────────────────────

# master: place_id → dict canônico
master = {}

# bairro_pids_pesq: bairros_pesquisados → set de PIDs encontrados nessa busca
# (baseado em bairro_pesquisa, não em bairro_detectado)
bairro_pids_pesq = defaultdict(set)

# bairro_ocorrencias_r3: total de resultados brutos por bairro (do controle_r3)
bairro_brutos_r3 = defaultdict(int)

# bairro_foi_pesquisado_r3: bairros com ao menos 1 job ok em R3
bairros_r3_pesquisados = set()

# rodadas por bairro
bairro_rodadas = defaultdict(set)


def _merge(pid, rodada, nome, lat, lon, rating, reviews, sg, bd, bairro_pesq):
    if pid not in master:
        master[pid] = {
            "place_id": pid, "nome": nome,
            "latitude": lat, "longitude": lon,
            "rating": rating, "review_count": reviews,
            "status_geo": sg, "bairro_detectado": bd,
            "rodadas": set(),
        }
    e = master[pid]
    # R3 tem prioridade para status_geo; senão, qualquer DENTRO prevalece sobre INCERTO
    if rodada == "r3" or (e["status_geo"] == STATUS_INCERTO and sg != STATUS_INCERTO):
        e["status_geo"] = sg
        e["bairro_detectado"] = bd
    e["rodadas"].add(rodada)
    if bairro_pesq:
        bairro_pids_pesq[bairro_pesq].add(pid)
        bairro_rodadas[bairro_pesq].add(rodada)


# ─── 4. Carregar controle_r3 (fonte de verdade para foi_pesquisado) ───────────
print(f"\n[controle_r3] carregando...")
ctrl_rows = list(csv.DictReader(open(CONTROLE_R3, encoding="utf-8")))
for r in ctrl_rows:
    if r.get("status") == "ok":
        b = r["bairro"]
        bairros_r3_pesquisados.add(b)
        bairro_brutos_r3[b] += int(r.get("resultados_brutos") or 0)
        bairro_rodadas[b].add("r3")

print(f"  Bairros com R3 Fase A executada: {len(bairros_r3_pesquisados)}")
print(f"  Total resultados brutos R3: {sum(bairro_brutos_r3.values())}")


# ─── 5. Carregar R1/R2 ───────────────────────────────────────────────────────
print(f"\n[R1/R2] carregando {R1R2_FILE.name}...")
r1r2_rows = list(csv.DictReader(open(R1R2_FILE, encoding="utf-8")))
print(f"  {len(r1r2_rows)} registros")
for row in r1r2_rows:
    pid = row.get("place_id", "").strip()
    if not pid: continue
    bp  = row.get("bairro_pesquisa", "").strip()
    sg, bd, _, _ = _geo(row.get("latitude"), row.get("longitude"), bp, row.get("endereco",""))
    _merge(pid, "r1", row.get("nome_estabelecimento",""),
           _float(row.get("latitude")), _float(row.get("longitude")),
           _float(row.get("review_rating")), _int(row.get("review_count")),
           sg, bd, bp)
print(f"  master: {len(master)} PIDs unicos")


# ─── 6. Carregar R2 recovery ─────────────────────────────────────────────────
print(f"\n[R2 recovery] carregando {R2R_FILE.name}...")
r2r_rows = list(csv.DictReader(open(R2R_FILE, encoding="utf-8")))
print(f"  {len(r2r_rows)} registros")
for row in r2r_rows:
    pid = row.get("place_id", "").strip()
    if not pid: continue
    bp  = row.get("area_consulta_r2", "").strip()
    sg, bd, _, _ = _geo(row.get("latitude"), row.get("longitude"), bp, row.get("endereco",""))
    _merge(pid, "r2", row.get("nome",""),
           _float(row.get("latitude")), _float(row.get("longitude")),
           _float(row.get("rating")), _int(row.get("review_count")),
           sg, bd, bp)
print(f"  master: {len(master)} PIDs unicos")


# ─── 7. Carregar G1/G2/G3 ────────────────────────────────────────────────────
def _load_grid(fpath, rodada_tag):
    if not fpath.exists():
        print(f"  [AVISO] {fpath.name} nao encontrado, ignorando.")
        return 0, 0
    rows = list(csv.DictReader(open(fpath, encoding="utf-8")))
    print(f"  {len(rows)} registros")
    count = novos = 0
    for row in rows:
        pid = row.get("place_id", "").strip()
        if not pid: continue
        sg, bd, _, _ = _geo(row.get("latitude"), row.get("longitude"), "", row.get("endereco",""))
        era_novo = pid not in master
        # Grid: bairro_pesq = bairro_detectado (busca por área, não por bairro nomeado)
        _merge(pid, rodada_tag, row.get("nome",""),
               _float(row.get("latitude")), _float(row.get("longitude")),
               _float(row.get("rating")), _int(row.get("review_count")),
               sg, bd, bd)
        count += 1
        if era_novo: novos += 1
    return count, novos

print(f"\n[G1] carregando {G1_FILE.name}...")
c, n = _load_grid(G1_FILE, "g1")
print(f"  {c} proc -> {n} novos -> master: {len(master)}")

print(f"\n[G2] carregando {G2_FILE.name}...")
c, n = _load_grid(G2_FILE, "g2")
print(f"  {c} proc -> {n} novos -> master: {len(master)}")

print(f"\n[G3] carregando {G3_FILE.name}...")
c, n = _load_grid(G3_FILE, "g3")
print(f"  {c} proc -> {n} novos -> master: {len(master)}")


# ─── 8. Carregar R3 ──────────────────────────────────────────────────────────
print(f"\n[R3] carregando {R3_FILE.name}...")
r3_rows = list(csv.DictReader(open(R3_FILE, encoding="utf-8")))
print(f"  {len(r3_rows)} registros")
for row in r3_rows:
    pid = row.get("place_id", "").strip()
    if not pid: continue
    bp = row.get("bairro_pesquisa_primeiro", "").strip()
    sg = row.get("status_geo", STATUS_INCERTO)
    bd = row.get("bairro_detectado", "")
    era_novo = pid not in master
    _merge(pid, "r3", row.get("nome",""),
           _float(row.get("latitude")), _float(row.get("longitude")),
           _float(row.get("rating")), _int(row.get("review_count")),
           sg, bd, bp)
print(f"  master: {len(master)} PIDs unicos")

# Complementar bairro_pids_pesq com fact_ocorrencias (PIDs por bairro_pesquisa em R3)
if FACT_R3.exists():
    fact_rows = list(csv.DictReader(open(FACT_R3, encoding="utf-8")))
    for r in fact_rows:
        pid = r.get("place_id", "").strip()
        bp  = r.get("bairro_pesquisa", "").strip()
        if pid and bp:
            bairro_pids_pesq[bp].add(pid)
            bairro_rodadas[bp].add("r3")
    print(f"  fact_ocorrencias: {len(fact_rows)} entradas adicionadas ao indice")

total_pids = len(master)
print(f"\n[dedup global] {total_pids} place_ids unicos total")


# ─── 9. Diagnostico 528 vs 531 ────────────────────────────────────────────────
print("\n[diagnostico 528 vs 531]")
r3_set = {pid for pid, e in master.items() if "r3" in e["rodadas"]}
print(f"  PIDs com R3 entre suas rodadas: {len(r3_set)}")
print(f"  dim_estabelecimentos_r3.csv = 528 PIDs (dedup por bairro_pesquisa_primeiro)")
print(f"  fact_ocorrencias conta ocorrencias por job; 3 PIDs aparecem")
print(f"  em 2 bairros distintos -> 528 PIDs + 3 extra = 531 linhas no relatorio geografico R3")


# ─── 10. Construir tabela por bairro ─────────────────────────────────────────
def classif_bairro(foi_pesq, dentro, pids_unicos, vizinhos_fora):
    if not foi_pesq:
        return "GAP_NAO_PESQUISADO"
    if dentro >= 10:
        return "COBERTURA"
    if dentro >= 3:
        return "ATENCAO"
    # GAP: dentro <= 2
    if pids_unicos == 0:
        return "GAP_BAIXA_COBERTURA"   # pesquisado mas Google retornou so ja-conhecidos
    if vizinhos_fora > 0:
        return "GAP_COM_RESULTADOS_FORA"  # encontrou coisas mas fora do poligono
    return "GAP_BAIXA_COBERTURA"


CAMPOS_BAIRRO = [
    "bairro", "distrito",
    "foi_pesquisado",
    "total_ocorrencias_r3",
    "place_ids_unicos",
    "dentro",
    "bairro_vizinho", "fora_bairro", "fora_belem", "incerto",
    "total_validos_dentro",
    "r1", "r2", "g1", "g2", "g3", "r3",
    "rodadas_com_resultado",
    "novos_r3",
    "rating_medio", "reviews_totais",
    "classificacao",
]

rows_bairro = []
for b_cfg in bairros_cfg:
    bairro   = b_cfg["bairro"]
    distrito = b_cfg["distrito"]

    # foi_pesquisado = aparece em controle_r3 OU em qualquer bairro_pids_pesq
    foi_pesq = (bairro in bairros_r3_pesquisados) or (bairro in bairro_pids_pesq)

    # place_ids encontrados quando se buscou ESTE bairro (bairro_pesquisado == bairro)
    pids_pesq_bairro = bairro_pids_pesq.get(bairro, set())

    # total_validos_dentro = PIDs cujo bairro_detectado == este bairro (estão dentro do polígono)
    pids_dentro_bairro = {pid for pid, e in master.items() if e["bairro_detectado"] == bairro}

    n_dentro   = len(pids_dentro_bairro)
    n_pids_pesq = len(pids_pesq_bairro)

    # Status geo para os PIDs pesquisados neste bairro
    sg_cnt = {s: 0 for s in ALL_STATUS}
    sg_cnt[STATUS_DENTRO] = n_dentro
    for pid in pids_pesq_bairro:
        sg = master[pid]["status_geo"]
        if sg != STATUS_DENTRO:
            sg_cnt[sg] += 1

    vizinhos_fora = sg_cnt[STATUS_VIZINHO] + sg_cnt[STATUS_FORA_BAIRRO]

    # Contagem por rodada (PIDs pesquisados neste bairro, por rodada)
    cnt_rodada = {r: 0 for r in RODADAS}
    for pid in pids_pesq_bairro:
        for r in master[pid]["rodadas"]:
            if r in cnt_rodada:
                cnt_rodada[r] += 1
    # Para R3: incluir todos os PIDs cujo bairro_pesquisa_primeiro == bairro
    # (dim_r3 já incluído via _merge; apenas garantir r3 se foi_pesquisado)
    if bairro in bairros_r3_pesquisados and cnt_rodada["r3"] == 0:
        # bairro foi pesquisado em R3 mas todos resultados eram conhecidos
        # -> 0 novos PIDs sob este bairro, mas foi pesquisado
        pass  # cnt_rodada["r3"] permanece 0 (correto: nenhum PID novo)

    # rodadas_com_resultado = rodadas que encontraram ao menos 1 PID neste bairro
    rodadas_resultado = bairro_rodadas.get(bairro, set()) & set(RODADAS)

    # novos R3 = PIDs cujo primeiro bairro é este E não existia em R1/R2/G
    novos_r3 = sum(
        1 for pid in pids_pesq_bairro
        if "r3" in master[pid]["rodadas"]
        and not (master[pid]["rodadas"] & {"r1","r2","g1","g2","g3"})
    )

    # rating e reviews baseados nos PIDs pesquisados neste bairro
    ratings  = [master[pid]["rating"] for pid in pids_pesq_bairro if master[pid]["rating"] > 0]
    avg_r    = round(sum(ratings)/len(ratings), 2) if ratings else 0.0
    reviews  = sum(master[pid]["review_count"] for pid in pids_pesq_bairro)

    classif  = classif_bairro(foi_pesq, n_dentro, n_pids_pesq, vizinhos_fora)

    rows_bairro.append({
        "bairro":   bairro,
        "distrito": distrito,
        "foi_pesquisado":       "SIM" if foi_pesq else "NAO",
        "total_ocorrencias_r3": bairro_brutos_r3.get(bairro, 0),
        "place_ids_unicos":     n_pids_pesq,
        "dentro":               n_dentro,
        "bairro_vizinho":       sg_cnt[STATUS_VIZINHO],
        "fora_bairro":          sg_cnt[STATUS_FORA_BAIRRO],
        "fora_belem":           sg_cnt[STATUS_FORA_BELEM],
        "incerto":              sg_cnt[STATUS_INCERTO],
        "total_validos_dentro": n_dentro,
        "r1":   cnt_rodada["r1"], "r2": cnt_rodada["r2"],
        "g1":   cnt_rodada["g1"], "g2": cnt_rodada["g2"],
        "g3":   cnt_rodada["g3"], "r3": cnt_rodada["r3"],
        "rodadas_com_resultado": "|".join(sorted(rodadas_resultado)) if rodadas_resultado else "",
        "novos_r3":      novos_r3,
        "rating_medio":  avg_r,
        "reviews_totais":reviews,
        "classificacao": classif,
    })

# Ordenar por dentro desc, depois total_place_ids desc
rows_bairro.sort(key=lambda x: (-x["dentro"], -x["place_ids_unicos"]))


# ─── 11. auditoria_consolidada.csv ────────────────────────────────────────────
CAMPOS_AUDIT = [
    "place_id", "nome", "latitude", "longitude",
    "rating", "review_count",
    "status_geo", "bairro_detectado",
    "rodadas", "n_rodadas",
    "r1", "r2", "g1", "g2", "g3", "r3",
]
rows_audit = []
for pid, e in sorted(master.items()):
    rs = e["rodadas"]
    rows_audit.append({
        "place_id": pid, "nome": e["nome"],
        "latitude": e["latitude"], "longitude": e["longitude"],
        "rating": e["rating"], "review_count": e["review_count"],
        "status_geo": e["status_geo"], "bairro_detectado": e["bairro_detectado"],
        "rodadas": "|".join(sorted(rs)), "n_rodadas": len(rs),
        "r1": 1 if "r1" in rs else 0, "r2": 1 if "r2" in rs else 0,
        "g1": 1 if "g1" in rs else 0, "g2": 1 if "g2" in rs else 0,
        "g3": 1 if "g3" in rs else 0, "r3": 1 if "r3" in rs else 0,
    })

out_audit = REPORTS_DIR / "auditoria_consolidada.csv"
with open(out_audit, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=CAMPOS_AUDIT); w.writeheader(); w.writerows(rows_audit)
print(f"\n[CSV] {out_audit.name} -> {len(rows_audit)} PIDs")


# ─── 12. cobertura_final_por_bairro.csv ───────────────────────────────────────
out_bairro = REPORTS_DIR / "cobertura_final_por_bairro.csv"
with open(out_bairro, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=CAMPOS_BAIRRO); w.writeheader(); w.writerows(rows_bairro)
print(f"[CSV] {out_bairro.name} -> {len(rows_bairro)} bairros")


# ─── 13. cobertura_final_por_distrito.csv ─────────────────────────────────────
CAMPOS_DIST = [
    "distrito", "n_bairros", "pesquisados", "nao_pesquisados",
    "total_pids", "dentro_total",
    "gap_baixa", "gap_resultados_fora", "atencao", "cobertura",
    "rating_medio_dist", "reviews_totais_dist",
]
dist_acc = defaultdict(lambda: {
    "n_bairros":0,"pesquisados":0,"nao_pesq":0,
    "total_pids":0,"dentro":0,
    "gap_baixa":0,"gap_fora":0,"atencao":0,"cob":0,
    "ratings":[],"reviews":0,
})
for rb in rows_bairro:
    d = rb["distrito"]
    dist_acc[d]["n_bairros"]  += 1
    dist_acc[d]["pesquisados"] += 1 if rb["foi_pesquisado"] == "SIM" else 0
    dist_acc[d]["nao_pesq"]   += 1 if rb["foi_pesquisado"] == "NAO" else 0
    dist_acc[d]["total_pids"] += rb["place_ids_unicos"]
    dist_acc[d]["dentro"]     += rb["dentro"]
    cl = rb["classificacao"]
    if   cl == "GAP_BAIXA_COBERTURA":    dist_acc[d]["gap_baixa"] += 1
    elif cl == "GAP_COM_RESULTADOS_FORA":dist_acc[d]["gap_fora"]  += 1
    elif cl == "ATENCAO":                dist_acc[d]["atencao"]   += 1
    elif cl == "COBERTURA":              dist_acc[d]["cob"]       += 1
    if rb["rating_medio"] > 0:
        dist_acc[d]["ratings"].append(rb["rating_medio"])
    dist_acc[d]["reviews"] += rb["reviews_totais"]

rows_dist = []
for dist, v in sorted(dist_acc.items()):
    avg = round(sum(v["ratings"])/len(v["ratings"]), 2) if v["ratings"] else 0.0
    rows_dist.append({
        "distrito": dist, "n_bairros": v["n_bairros"],
        "pesquisados": v["pesquisados"], "nao_pesquisados": v["nao_pesq"],
        "total_pids": v["total_pids"], "dentro_total": v["dentro"],
        "gap_baixa": v["gap_baixa"], "gap_resultados_fora": v["gap_fora"],
        "atencao": v["atencao"], "cobertura": v["cob"],
        "rating_medio_dist": avg, "reviews_totais_dist": v["reviews"],
    })

out_dist = REPORTS_DIR / "cobertura_final_por_distrito.csv"
with open(out_dist, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=CAMPOS_DIST); w.writeheader(); w.writerows(rows_dist)
print(f"[CSV] {out_dist.name} -> {len(rows_dist)} distritos")


# ─── 14. inconsistencias_geograficas.csv ─────────────────────────────────────
CAMPOS_INC = [
    "place_id","nome","latitude","longitude",
    "bairro_detectado","status_geo","tipo_inconsistencia",
]
rows_inc = []
for pid, e in master.items():
    sg = e["status_geo"]
    tipo = None
    if   sg == STATUS_FORA_BELEM:   tipo = "FORA_DE_BELEM"
    elif sg == STATUS_INCERTO:       tipo = "INCERTO"
    elif sg == STATUS_FORA_BAIRRO:   tipo = "FORA_DO_BAIRRO_PESQUISADO"
    elif sg == STATUS_VIZINHO:       tipo = "BAIRRO_VIZINHO"
    elif sg == STATUS_DENTRO and e["bairro_detectado"] not in bairro_set:
        tipo = "BAIRRO_DETECTADO_FORA_DOS_71"
    if tipo:
        rows_inc.append({
            "place_id": pid, "nome": e["nome"],
            "latitude": e["latitude"], "longitude": e["longitude"],
            "bairro_detectado": e["bairro_detectado"],
            "status_geo": sg, "tipo_inconsistencia": tipo,
        })

out_inc = REPORTS_DIR / "inconsistencias_geograficas.csv"
with open(out_inc, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=CAMPOS_INC); w.writeheader(); w.writerows(rows_inc)
print(f"[CSV] {out_inc.name} -> {len(rows_inc)} registros")


# ─── 15. Tabela final ─────────────────────────────────────────────────────────
print("\n" + "=" * 110)
print("  TABELA CONSOLIDADA R1+R2+G1+G2+G3+R3 — 71 BAIRROS")
print("=" * 110)
print(f"  {'#':>3}  {'BAIRRO':<22} {'DIST':<7} {'PESQ':>5} {'OCORR':>6} {'PIDs':>5} "
      f"{'DENTRO':>7} {'VIZIN':>6} {'FORA':>5} {'R1':>4} {'R2':>4} {'G':>4} {'R3':>4}  "
      f"CLASSIFICACAO")
print("-" * 110)

for i, rb in enumerate(rows_bairro, 1):
    pesq_flag = "SIM" if rb["foi_pesquisado"] == "SIM" else "NAO"
    g_total   = rb["g1"] + rb["g2"] + rb["g3"]
    cl        = rb["classificacao"]
    icon      = "✓" if cl == "COBERTURA" else ("~" if cl == "ATENCAO" else "⚠")
    fora      = rb["bairro_vizinho"] + rb["fora_bairro"]
    print(
        f"  {i:>3}  {rb['bairro']:<22} {rb['distrito']:<7} {pesq_flag:>5} "
        f"{rb['total_ocorrencias_r3']:>6} {rb['place_ids_unicos']:>5} "
        f"{rb['dentro']:>7} {rb['bairro_vizinho']:>6} {fora:>5} "
        f"{rb['r1']:>4} {rb['r2']:>4} {g_total:>4} {rb['r3']:>4}  "
        f"{icon}{cl}"
    )

print("=" * 110)

# Resumo por classificacao
from collections import Counter
classif_counts = Counter(rb["classificacao"] for rb in rows_bairro)
print(f"\n  CLASSIFICACAO FINAL:")
print(f"  COBERTURA              (10+ DENTRO): {classif_counts['COBERTURA']}")
print(f"  ATENCAO                (3-9 DENTRO): {classif_counts['ATENCAO']}")
print(f"  GAP_COM_RESULTADOS_FORA (pesq, <3, pids>0): {classif_counts['GAP_COM_RESULTADOS_FORA']}")
print(f"  GAP_BAIXA_COBERTURA    (pesq, <3, pids=0): {classif_counts['GAP_BAIXA_COBERTURA']}")
print(f"  GAP_NAO_PESQUISADO     (nao pesquisado)  : {classif_counts['GAP_NAO_PESQUISADO']}")

print(f"\n  Total PIDs unicos (dedup global): {total_pids}")
total_dentro = sum(1 for e in master.values() if e["bairro_detectado"] in bairro_set)
print(f"  PIDs com bairro_detectado nos 71: {total_dentro}")

# Status geo global
print(f"\n  Status geo global:")
for s in ALL_STATUS:
    cnt = sum(1 for e in master.values() if e["status_geo"] == s)
    print(f"    {s:<20}: {cnt}")

# Bairros COBERTURA
cob_bairros = [rb for rb in rows_bairro if rb["classificacao"] == "COBERTURA"]
print(f"\n  Bairros com COBERTURA INICIAL:")
for rb in cob_bairros:
    print(f"    {rb['bairro']:<22} {rb['distrito']}  DENTRO={rb['dentro']}  PIDs={rb['place_ids_unicos']}")

# Bairros que precisam Fase B (GAP pesquisado)
fase_b = [rb for rb in rows_bairro if rb["classificacao"] in ("GAP_COM_RESULTADOS_FORA","GAP_BAIXA_COBERTURA") and rb["foi_pesquisado"]=="SIM"]
print(f"\n  Bairros GAP pesquisados — candidatos Fase B ({len(fase_b)}):")
for rb in fase_b:
    print(f"    {rb['bairro']:<22} {rb['distrito']}  [{rb['classificacao']}]  "
          f"OCR={rb['total_ocorrencias_r3']}  DENTRO={rb['dentro']}  PIDs={rb['place_ids_unicos']}")

print("=" * 110)
print(f"\n  CSVs em: {REPORTS_DIR}")
print(f"  1. auditoria_consolidada.csv        ({len(rows_audit)} PIDs)")
print(f"  2. cobertura_final_por_bairro.csv   ({len(rows_bairro)} bairros)")
print(f"  3. cobertura_final_por_distrito.csv ({len(rows_dist)} distritos)")
print(f"  4. inconsistencias_geograficas.csv  ({len(rows_inc)} registros)")
