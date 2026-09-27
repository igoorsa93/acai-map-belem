"""
Recuperação direcionada dos 380 estabelecimentos da Rodada 2.

Estratégia:
  - API não suporta lookup por place_id diretamente
  - Para cada registro: busca pelo NOME como keyword nas COORDENADAS originais,
    raio 300m, depth=1 (apenas o local mais próximo)
  - Confirma: place_id_recuperado == place_id_origem_r2
  - Se mismatch: marca e não incorpora automaticamente

Prioridade:
  1. 362 com coordenadas válidas em Belém
  2. 18 outliers geográficos (processados separadamente)

Não faz nova varredura ampla.
"""
import csv, io, json, math, sys, time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from src.coverage.scraper_geo import api_viva, criar_job, aguardar, baixar

BASE_PLACE_IDS = ROOT / "data" / "coverage" / "base_place_ids.csv"
OUT_RAW_DIR    = ROOT / "data" / "raw" / "recuperacao_r2"
OUT_CTRL       = ROOT / "data" / "processed" / "controle_recuperacao_r2.csv"
OUT_OUTLIERS   = ROOT / "data" / "review" / "r2_outliers.csv"
OUT_DIR        = ROOT / "data" / "model" / "recuperacao_r2"

BELEM = {"s": -1.52, "n": -1.25, "w": -48.55, "e": -48.35}

CAMPOS_CTRL = [
    "place_id", "nome_original", "latitude_original", "longitude_original",
    "area", "consulta_utilizada", "job_id", "status", "resultado",
    "dados_completos", "place_id_recuperado", "place_id_match",
    "latitude_recuperada", "longitude_recuperada",
    "distancia_revalidacao_m", "coerencia_geo",
    "rating_recuperado", "review_count_recuperado",
    "erro", "data", "hora",
]

CAMPOS_ESTAB = [
    "place_id", "cid", "nome", "categoria", "endereco", "complete_address",
    "telefone", "website", "latitude", "longitude", "rating", "review_count",
    "status", "price_range", "horario", "link",
    "origem", "area_consulta_r2", "place_id_origem_r2",
    "data_coleta", "hora_coleta",
]


def em_belem(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
    except (ValueError, TypeError):
        return False
    return BELEM["s"] <= lat <= BELEM["n"] and BELEM["w"] <= lon <= BELEM["e"]


def haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p)
         * math.sin((lon2 - lon1) * p / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))


def log(msg):
    try:
        print(f"[{datetime.now():%H:%M:%S}] {msg}", flush=True)
    except UnicodeEncodeError:
        safe = msg.encode("ascii", errors="replace").decode("ascii")
        print(f"[{datetime.now():%H:%M:%S}] {safe}", flush=True)


def carregar_r2():
    validos, outliers = [], []
    with open(BASE_PLACE_IDS, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r.get("fonte") != "rodada_2":
                continue
            lat = r.get("latitude", "")
            lon = r.get("longitude", "")
            if em_belem(lat, lon):
                validos.append(r)
            else:
                outliers.append(r)
    return validos, outliers


def carregar_ja_processados():
    """Retorna set de place_ids já processados no controle."""
    ja = set()
    if OUT_CTRL.exists():
        with open(OUT_CTRL, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("place_id"):
                    ja.add(r["place_id"].strip())
    return ja


def processar_batch(registros, batch_tag, ctrl_w, ctrl_f, estab_rows, total, offset=0):
    """Processa lista de registros. Retorna métricas."""
    recuperados = falhas = mismatches = 0

    for i, r in enumerate(registros, 1):
        pid_orig   = r["place_id"].strip()
        nome_orig  = r.get("nome", "").strip()
        lat_orig   = r.get("latitude", "0")
        lon_orig   = r.get("longitude", "0")
        area       = r.get("area", "")
        agora      = datetime.now()

        log(f"-- [{i+offset}/{total}]  {nome_orig[:45]}  [{area}]")

        # Consulta: nome como keyword nas coordenadas originais, raio 300m
        keyword = nome_orig if nome_orig else f"açaí {area}"
        raio    = 300

        try:
            jid = criar_job(keyword, lat_orig, lon_orig, raio,
                            depth=1, max_time=120, zoom=17,
                            nome=f"recup-r2-{batch_tag}-{i+offset}")
        except Exception as e:
            log(f"  ERRO criar job: {e}")
            ctrl_w.writerow({
                "place_id": pid_orig, "nome_original": nome_orig,
                "latitude_original": lat_orig, "longitude_original": lon_orig,
                "area": area, "consulta_utilizada": keyword,
                "job_id": "", "status": "create_error", "resultado": "falha",
                "dados_completos": "nao", "place_id_recuperado": "",
                "place_id_match": "", "latitude_recuperada": "",
                "longitude_recuperada": "", "distancia_revalidacao_m": "",
                "coerencia_geo": "", "rating_recuperado": "",
                "review_count_recuperado": "", "erro": str(e)[:200],
                "data": f"{agora:%Y-%m-%d}", "hora": f"{agora:%H:%M:%S}",
            })
            ctrl_f.flush()
            falhas += 1
            time.sleep(5)
            continue

        log(f"  job {jid}")
        st = aguardar(jid, tentativas=30, intervalo=10)
        log(f"  status={st}")

        if st != "ok":
            ctrl_w.writerow({
                "place_id": pid_orig, "nome_original": nome_orig,
                "latitude_original": lat_orig, "longitude_original": lon_orig,
                "area": area, "consulta_utilizada": keyword,
                "job_id": jid, "status": st, "resultado": "falha",
                "dados_completos": "nao", "place_id_recuperado": "",
                "place_id_match": "", "latitude_recuperada": "",
                "longitude_recuperada": "", "distancia_revalidacao_m": "",
                "coerencia_geo": "", "rating_recuperado": "",
                "review_count_recuperado": "", "erro": f"status={st}",
                "data": f"{agora:%Y-%m-%d}", "hora": f"{agora:%H:%M:%S}",
            })
            ctrl_f.flush()
            falhas += 1
            time.sleep(5)
            continue

        try:
            rows = baixar(jid)
        except Exception as e:
            log(f"  ERRO download: {e}")
            falhas += 1
            time.sleep(5)
            continue

        # Salvar raw
        raw_path = OUT_RAW_DIR / f"recup_{batch_tag}_{i+offset:04d}_{jid[:8]}.csv"
        if rows:
            keys = list(rows[0].keys())
            with open(raw_path, "w", newline="", encoding="utf-8") as rf:
                w = csv.DictWriter(rf, fieldnames=keys)
                w.writeheader(); w.writerows(rows)

        # Encontrar o resultado que melhor casa com o place_id original
        match_row = None
        for row in rows:
            if row.get("place_id", "").strip() == pid_orig:
                match_row = row
                break

        # Se não achou por place_id exato, pegar o mais próximo geograficamente
        if not match_row and rows:
            def dist_to_orig(row):
                try:
                    return haversine_m(float(lat_orig), float(lon_orig),
                                       float(row.get("latitude", 0) or 0),
                                       float(row.get("longitude", 0) or 0))
                except Exception:
                    return 99999
            rows_ord = sorted(rows, key=dist_to_orig)
            match_row = rows_ord[0] if rows_ord else None

        if not match_row:
            log(f"  sem resultado para {nome_orig}")
            ctrl_w.writerow({
                "place_id": pid_orig, "nome_original": nome_orig,
                "latitude_original": lat_orig, "longitude_original": lon_orig,
                "area": area, "consulta_utilizada": keyword,
                "job_id": jid, "status": "ok", "resultado": "sem_resultado",
                "dados_completos": "nao", "place_id_recuperado": "",
                "place_id_match": "nao", "latitude_recuperada": "",
                "longitude_recuperada": "", "distancia_revalidacao_m": "",
                "coerencia_geo": "", "rating_recuperado": "",
                "review_count_recuperado": "", "erro": "0 resultados",
                "data": f"{agora:%Y-%m-%d}", "hora": f"{agora:%H:%M:%S}",
            })
            ctrl_f.flush()
            falhas += 1
            time.sleep(10)
            continue

        pid_recup   = match_row.get("place_id", "").strip()
        lat_recup   = match_row.get("latitude", "")
        lon_recup   = match_row.get("longitude", "")
        pid_match   = "sim" if pid_recup == pid_orig else "mismatch"
        dados_ok    = "sim" if pid_recup else "parcial"

        try:
            dist = round(haversine_m(float(lat_orig), float(lon_orig),
                                      float(lat_recup or 0), float(lon_recup or 0)))
            coer = "coerente" if dist <= 200 else "revisar"
        except Exception:
            dist, coer = "", "inconclusivo"

        if pid_match == "mismatch":
            mismatches += 1
            log(f"  MISMATCH: orig={pid_orig} recup={pid_recup}")
        else:
            recuperados += 1

        ctrl_w.writerow({
            "place_id": pid_orig, "nome_original": nome_orig,
            "latitude_original": lat_orig, "longitude_original": lon_orig,
            "area": area, "consulta_utilizada": keyword,
            "job_id": jid, "status": "ok",
            "resultado": "recuperado" if pid_match == "sim" else "mismatch",
            "dados_completos": dados_ok,
            "place_id_recuperado": pid_recup,
            "place_id_match": pid_match,
            "latitude_recuperada": lat_recup,
            "longitude_recuperada": lon_recup,
            "distancia_revalidacao_m": dist,
            "coerencia_geo": coer,
            "rating_recuperado": match_row.get("review_rating", ""),
            "review_count_recuperado": match_row.get("review_count", ""),
            "erro": "" if pid_match == "sim" else f"mismatch:{pid_recup}",
            "data": f"{agora:%Y-%m-%d}", "hora": f"{agora:%H:%M:%S}",
        })
        ctrl_f.flush()

        # Adicionar ao modelo apenas se place_id confirmado
        if pid_match == "sim":
            estab_rows.append({
                "place_id": pid_orig,
                "cid": match_row.get("cid", ""),
                "nome": match_row.get("title", nome_orig),
                "categoria": match_row.get("category", ""),
                "endereco": match_row.get("address", ""),
                "complete_address": match_row.get("address", ""),
                "telefone": match_row.get("phone", ""),
                "website": match_row.get("website", ""),
                "latitude": lat_recup or lat_orig,
                "longitude": lon_recup or lon_orig,
                "rating": match_row.get("review_rating", ""),
                "review_count": match_row.get("review_count", ""),
                "status": match_row.get("status", ""),
                "price_range": match_row.get("price_range", ""),
                "horario": match_row.get("open_hours", ""),
                "link": match_row.get("link", ""),
                "origem": "rodada_2_recuperado",
                "area_consulta_r2": area,
                "place_id_origem_r2": pid_orig,
                "data_coleta": f"{agora:%Y-%m-%d}",
                "hora_coleta": f"{agora:%H:%M:%S}",
            })

        log(f"  {pid_match} | dist={dist}m | rating={match_row.get('review_rating','?')}")

        if i < len(registros):
            time.sleep(15)

    return recuperados, falhas, mismatches


def main():
    if not api_viva():
        log("API nao respondeu em localhost:8080. Abortado.")
        return 1

    validos, outliers = carregar_r2()
    log(f"R2: {len(validos)} validos, {len(outliers)} outliers")

    ja_processados = carregar_ja_processados()
    pendentes    = [r for r in validos  if r["place_id"].strip() not in ja_processados]
    pend_out     = [r for r in outliers if r["place_id"].strip() not in ja_processados]
    log(f"Ja processados: {len(ja_processados)}  |  Pendentes: {len(pendentes)} validos + {len(pend_out)} outliers")

    total = len(pendentes) + len(pend_out)
    if total == 0:
        log("Todos ja processados.")
        return 0

    estab_rows = []

    # Controle (append para retomada)
    ctrl_novo = not OUT_CTRL.exists()
    ctrl_f = open(OUT_CTRL, "a", newline="", encoding="utf-8")
    ctrl_w = csv.DictWriter(ctrl_f, fieldnames=CAMPOS_CTRL)
    if ctrl_novo:
        ctrl_w.writeheader()

    try:
        # BATCH A: validos
        if pendentes:
            log(f"\n=== BATCH A: {len(pendentes)} validos ===")
            r, f, m = processar_batch(pendentes, "va", ctrl_w, ctrl_f,
                                      estab_rows, total, offset=0)
            log(f"Batch A: recuperados={r} falhas={f} mismatches={m}")

        # BATCH B: outliers
        if pend_out:
            log(f"\n=== BATCH B: {len(pend_out)} outliers ===")
            r2, f2, m2 = processar_batch(pend_out, "out", ctrl_w, ctrl_f,
                                          estab_rows, total, offset=len(pendentes))
            log(f"Batch B: recuperados={r2} falhas={f2} mismatches={m2}")

    finally:
        ctrl_f.close()

    # Salvar modelo
    if estab_rows:
        OUT_DIR.mkdir(parents=True, exist_ok=True)
        with open(OUT_DIR / "estabelecimentos_recuperados.csv", "w",
                  newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=CAMPOS_ESTAB)
            w.writeheader(); w.writerows(estab_rows)
        log(f"Modelo salvo: {len(estab_rows)} estabelecimentos")

    # Relatório de outliers
    with open(OUT_OUTLIERS, "w", newline="", encoding="utf-8") as f:
        campos_out = ["place_id", "nome", "latitude_original", "longitude_original",
                      "area", "classificacao"]
        w = csv.DictWriter(f, fieldnames=campos_out)
        w.writeheader()
        for r in outliers:
            w.writerow({
                "place_id": r["place_id"], "nome": r.get("nome",""),
                "latitude_original": r.get("latitude",""),
                "longitude_original": r.get("longitude",""),
                "area": r.get("area",""),
                "classificacao": "outlier_geografico_pendente",
            })

    # Métricas finais do controle
    recuperados_total = falhas_total = mismatches_total = 0
    if OUT_CTRL.exists():
        with open(OUT_CTRL, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                r_status = row.get("resultado","")
                if r_status == "recuperado":  recuperados_total += 1
                elif r_status == "falha" or r_status == "sem_resultado": falhas_total += 1
                elif r_status == "mismatch": mismatches_total += 1

    log(f"""
=== RESULTADO FINAL ===
  Esperados: 380 (362 válidos + 18 outliers)
  Processados: {len(ja_processados) + len(pendentes) + len(pend_out)}
  Recuperados com match: {recuperados_total}
  Falhas: {falhas_total}
  Mismatch place_id: {mismatches_total}
  Outliers: {len(outliers)} (processados no Batch B)
""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
