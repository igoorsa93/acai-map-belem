"""
Consolida os 370 estabelecimentos recuperados da Rodada 2 no dashboard.
"""
import csv, json, math, re, sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT    = Path(__file__).resolve().parents[1]
DASH_JS = ROOT / "web" / "data" / "dashboard_data.js"
R2_MODEL = ROOT / "data" / "model" / "recuperacao_r2" / "estabelecimentos_recuperados.csv"

# ── Classificação de tipo ─────────────────────────────────────────────────────
RE_ACAI_NOME = re.compile(r'a[çc]a[ií]|acai|ice.?a[çc]a[ií]|tigela', re.I)
RE_ACAI_CAT  = re.compile(r'a[çc]a[ií]|sorveteria|ice.cream|frozen|gelato|smoothie|suco|juic', re.I)
RE_NAO_ACAI  = re.compile(r'restaurante|lanchonete|padaria|mercado|supermercado|atacad|hortifruti|farmácia|banco|hotel|posto', re.I)

def classificar_tipo(nome, cat):
    if RE_ACAI_NOME.search(nome or ""):
        if RE_NAO_ACAI.search(cat or "") and not RE_ACAI_CAT.search(cat or ""):
            return "Açaí + Outro segmento"
        return "Especializado em açaí"
    if RE_ACAI_CAT.search(cat or ""):
        return "Especializado em açaí"
    return "Açaí + Outro segmento"

# ── Lógica de bairro (replicada de auditoria_bairros.py) ─────────────────────
NORM = {
    "Icoaraci":"Icoaraci","Cruzeiro":"Icoaraci","Agulha":"Icoaraci",
    "Paracuri":"Icoaraci","Campina de Icoaraci":"Icoaraci","Campina":"Icoaraci",
    "Maracacuera":"Icoaraci","Ponta Grossa":"Icoaraci","Brasília":"Icoaraci",
    "Tapanã":"Tapanã","Conjunto Satelite":"Tapanã",
    "Coqueiro":"Coqueiro","Tenoné":"Tenoné","Parque Verde":"Parque Verde",
    "Cabanagem":"Cabanagem","Pratinha":"Pratinha","Pratinha 1":"Pratinha",
    "Pratinha 2":"Pratinha","Benguí":"Benguí","Mangueirão":"Mangueirão",
    "Una":"Una","Parque Guajará":"Parque Guajará",
    "Águas Negras":"Parque Guajará","Maracangalha":"Parque Guajará",
    "Águas Lindas":"Parque Guajará",
}
CENTROIDES = {
    "Parque Verde":   (-1.410, -48.425),
    "Tenoné":         (-1.420, -48.430),
    "Icoaraci":       (-1.305, -48.475),
    "Pratinha":       (-1.355, -48.465),
    "Coqueiro":       (-1.333, -48.447),
    "Una":            (-1.385, -48.430),
    "Parque Guajará": (-1.322, -48.448),
    "Cabanagem":      (-1.395, -48.420),
    "Tapanã":         (-1.345, -48.462),
    "Benguí":         (-1.378, -48.452),
    "Mangueirão":     (-1.380, -48.445),
}
_PREFIXOS_INV = re.compile(
    r'^(R\.|Av\.|Tv\.|Rua |Avenida |Travessa |Passagem |Estrada |Estr\.|'
    r'Rod\.|Rodovia |Pç\.|Praça |QD |Quadra |Lote |Lt\.|Box |Cj\.|'
    r'Conj\.|N\d|n\.|Q\.\d|R\s|estrada |Conjunto roraima)', re.I)
_INV_EXATOS = {'com','de','da','do','a','e','n','na','no','box1','box 3','box','Cans','Cj','QD 5 LT 21','Guajar'}

def _hav_m(lat1, lon1, lat2, lon2):
    R, p = 6371000, math.pi/180
    a = (math.sin((lat2-lat1)*p/2)**2
         + math.cos(lat1*p)*math.cos(lat2*p)*math.sin((lon2-lon1)*p/2)**2)
    return 2*R*math.asin(math.sqrt(a))

def eh_ananindeua(endereco):
    if not endereco: return False
    m = re.search(r'(\d{5})-\d{3}', endereco)
    if m:
        cep = int(m.group(1))
        if 67000 <= cep <= 67999: return True
        if 66000 <= cep <= 66999: return False
    if re.search(r',\s*Ananindeua\s*-\s*PA', endereco):
        if not re.search(r',\s*Bel[eé]m\s*-\s*PA', endereco):
            return True
    return False

def extrai_bairro_end(endereco):
    if not endereco: return None
    if eh_ananindeua(endereco): return "__ANANINDEUA__"
    m = re.search(r'-\s*([^-,]{3,45}),\s*Bel[eé]m', endereco)
    if not m: return None
    b = m.group(1).strip()
    if _PREFIXOS_INV.match(b): return None
    if re.match(r'^\d', b): return None
    if b.lower() in {t.lower() for t in _INV_EXATOS}: return None
    if re.search(r'\bn[°º]|\blote\b|\bqd\b|\blt\b', b, re.I): return None
    if len(b) < 3: return None
    return b

def normalizar(b):
    if not b: return None
    b = re.sub(r'\d{5}-\d{3}.*', '', b).strip()
    b = re.sub(r'\s+', ' ', b).strip()
    if b in NORM: return NORM[b]
    for k, v in NORM.items():
        if k.lower() == b.lower(): return v
    return b

def bairro_por_coord(lat, lon):
    melhor, dist_min = None, float('inf')
    for b, (clat, clon) in CENTROIDES.items():
        d = _hav_m(lat, lon, clat, clon)
        if d < dist_min:
            dist_min, melhor = d, b
    return melhor if dist_min <= 4000 else None

def corrigir_bairro(endereco, lat, lon, fallback):
    b_raw = extrai_bairro_end(endereco)
    if b_raw == "__ANANINDEUA__": return "Ananindeua"
    b = normalizar(b_raw) if b_raw else None
    if b: return b
    if lat and lon:
        b_coord = bairro_por_coord(lat, lon)
        if b_coord: return b_coord
    return fallback or "Belém"

# ── Leitura do dashboard ──────────────────────────────────────────────────────
def ler_dashboard():
    txt = DASH_JS.read_text(encoding="utf-8")
    json_str = txt.split("window.ACAI_DATA = ", 1)[1].rstrip(";\n")
    return json.loads(json_str)

# ── Main ──────────────────────────────────────────────────────────────────────
def main():
    data = ler_dashboard()
    existentes = data["estabelecimentos"]
    pids = {e["place_id"] for e in existentes}
    print(f"Dashboard atual: {len(existentes)} estabelecimentos")

    r2_rows = list(csv.DictReader(open(R2_MODEL, encoding="utf-8")))
    print(f"R2 a processar: {len(r2_rows)}")

    novos, pulados = [], 0
    for row in r2_rows:
        pid = row["place_id"].strip()
        if pid in pids:
            pulados += 1
            continue

        try: lat = float(row.get("latitude") or 0)
        except: lat = 0.0
        try: lon = float(row.get("longitude") or 0)
        except: lon = 0.0
        try: rating = round(float(row.get("rating") or 0), 1)
        except: rating = 0.0
        try: reviews = int(float(row.get("review_count") or 0))
        except: reviews = 0

        nome     = row.get("nome", "").strip()
        cat      = row.get("categoria", "").strip()
        tipo     = classificar_tipo(nome, cat)
        endereco = (row.get("complete_address") or row.get("endereco") or "").strip()
        bairro   = corrigir_bairro(endereco, lat, lon, row.get("area_consulta_r2", ""))

        # Excluir Ananindeua — fora do escopo do projeto (somente Belém)
        if bairro == "Ananindeua":
            pulados += 1
            continue

        novos.append({
            "place_id":   pid,
            "nome":       nome,
            "categoria":  cat or "Não informado",
            "tipo":       tipo,
            "endereco":   endereco,
            "bairro":     bairro,
            "cidade":     "Belém",
            "lat":        round(lat, 6),
            "lon":        round(lon, 6),
            "telefone":   row.get("telefone", ""),
            "website":    row.get("website", ""),
            "rating":     rating,
            "reviews":    reviews,
            "ocorrencias": 1,
            "link":       row.get("link", ""),
            "termos":     "açaí",
            "data_coleta": row.get("data_coleta", "2026-09-25"),
        })
        pids.add(pid)

    print(f"Novos: {len(novos)}  |  Duplicados ignorados: {pulados}")
    todos = existentes + novos

    # KPIs
    ratings_v = [e["rating"] for e in todos if (e.get("rating") or 0) > 0]
    avg_rating = round(sum(ratings_v)/len(ratings_v), 2) if ratings_v else 0
    total_reviews = sum(e.get("reviews") or 0 for e in todos)
    bairros_unicos = len({e.get("bairro","") for e in todos if e.get("bairro","")})

    data["estabelecimentos"] = todos
    data["kpis"]["total_estabelecimentos"] = len(todos)
    data["kpis"]["total_reviews"] = total_reviews
    data["kpis"]["avg_rating"] = avg_rating
    data["kpis"]["total_areas"] = bairros_unicos

    # Bairros
    cnt_b = Counter(e.get("bairro","Outros") for e in todos)
    data["bairros"] = [{"bairro": b, "total": t} for b, t in
                       sorted(cnt_b.items(), key=lambda x: -x[1])]

    # Tipos
    cnt_t = Counter(e.get("tipo","Outros") for e in todos)
    data["tipos"] = [{"tipo": t, "total": c} for t, c in
                     sorted(cnt_t.items(), key=lambda x: -x[1])]

    # Salvar
    json_str = json.dumps(data, ensure_ascii=False, indent=2)
    DASH_JS.write_text(f"window.ACAI_DATA = {json_str};\n", encoding="utf-8")

    print(f"\nSalvo: {DASH_JS}")
    print(f"Total: {len(todos)} estabelecimentos")
    print(f"KPIs: avg_rating={avg_rating}, reviews={total_reviews}, bairros={bairros_unicos}")
    print("\nDistribuicao de bairros (top 15):")
    for b, t in cnt_b.most_common(15):
        print(f"  {t:4d}  {b}")

    return 0

if __name__ == "__main__":
    sys.exit(main())
