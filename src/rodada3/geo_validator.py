"""
geo_validator.py — Validação geográfica de estabelecimentos em Belém/PA.

Determina se um estabelecimento está DENTRO do bairro pesquisado, em um
BAIRRO_VIZINHO, FORA_BAIRRO, FORA_BELEM ou INCERTO.

Estratégia (em ordem de prioridade):
  1. Extração de bairro do texto do endereço (metodo="endereco")
  2. Proximidade ao centróide do bairro dentro do raio configurado (metodo="centroide")
  3. Fora de todos os raios mas dentro de Belém (FORA_BAIRRO)
  4. Fora dos limites de Belém (FORA_BELEM)
  5. Sem coordenadas válidas (INCERTO)

Nota: o geo_validator original usa polígonos (metodo="poligono") que não
estão disponíveis neste ambiente. Este módulo utiliza centróides + raio
do bairros_r3.yaml como aproximação.
"""
import math
import re
from src.rodada3.config_r3 import carregar_bairros

# ── Constantes de status ──────────────────────────────────────────────────────
STATUS_DENTRO      = "DENTRO"
STATUS_VIZINHO     = "BAIRRO_VIZINHO"
STATUS_FORA_BAIRRO = "FORA_BAIRRO"
STATUS_FORA_BELEM  = "FORA_BELEM"
STATUS_INCERTO     = "INCERTO"

# ── Carregar config na inicialização do módulo ────────────────────────────────
_BAIRROS = carregar_bairros()

# Mapa nome_lower → nome_oficial
_NOME_LOWER  = {b["bairro"].lower(): b["bairro"] for b in _BAIRROS}

# Mapa alias_lower → nome_oficial
_ALIAS_MAP: dict[str, str] = {}
for _b in _BAIRROS:
    for _a in _b.get("aliases", []):
        _ALIAS_MAP[_a.lower()] = _b["bairro"]

# Belém bounding box (ampla — cobre distritos insulares Outeiro e Mosqueiro)
_LAT_MIN, _LAT_MAX = -1.51, -1.04
_LON_MIN, _LON_MAX = -48.62, -48.29

# Threshold: se distância ao centróide mais próximo > este valor → FORA_BELEM
_DIST_FORA_BELEM_M = 15_000  # 15 km


# ── Helpers ───────────────────────────────────────────────────────────────────
def _hav(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distância haversine em metros."""
    R = 6_371_000
    p = math.pi / 180
    a = (math.sin((lat2 - lat1) * p / 2) ** 2
         + math.cos(lat1 * p) * math.cos(lat2 * p)
         * math.sin((lon2 - lon1) * p / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(max(0.0, a)))


def _normalizar(nome: str) -> str | None:
    """Converte nome de bairro bruto → nome oficial; None se não reconhecido."""
    if not nome:
        return None
    nl = nome.strip().lower()
    if nl in _NOME_LOWER:
        return _NOME_LOWER[nl]
    if nl in _ALIAS_MAP:
        return _ALIAS_MAP[nl]
    # Correspondência parcial para sub-bairros tipo "Campina de Icoaraci"
    for k, v in _NOME_LOWER.items():
        if k in nl or nl in k:
            return v
    return None


# Regex para extração de bairro do endereço
_RE_BAIRRO_END = re.compile(
    r'-\s*([^-,]{3,50}),\s*Bel[eé]m', re.I
)
_PREFIXOS_INV = re.compile(
    r'^(R\.|Av\.|Tv\.|Rua |Avenida |Travessa |Passagem |Estrada |'
    r'Rod\.|Rodovia |Pç\.|Praça |QD |Quadra |Lote |Lt\.|Box |Cj\.|Conj\.)',
    re.I,
)
_CIDADES_EXCL = re.compile(
    r'\bAnanindeua\b|\bMarituba\b|\bBenevides\b|\bCastanhal\b'
    r'|\bSanta B[aá]rbara\b|\bBarcarena\b|\bCapanema\b',
    re.I,
)
_CEP_ANANI = re.compile(r'6[78]\d{3}-\d{3}')  # CEPs de Ananindeua (67000-67999)


def _bairro_do_endereco(endereco: str) -> tuple[str | None, bool]:
    """
    Extrai bairro do texto do endereço.

    Returns:
        (nome_bairro_oficial_ou_raw, é_fora_de_belem)
        - nome pode ser None se não encontrado
        - é_fora_de_belem=True se o endereço explicita outra cidade
    """
    if not endereco:
        return None, False

    # CEP de Ananindeua + sem "Belém" → fora
    for m in _CEP_ANANI.finditer(endereco):
        if not re.search(r'Bel[eé]m', endereco, re.I):
            return "Ananindeua", True

    # Cidade explicitamente excluída
    if _CIDADES_EXCL.search(endereco):
        if not re.search(r'Bel[eé]m', endereco, re.I):
            return "outra_cidade", True

    # Padrão "- BairroName, Belém"
    m = _RE_BAIRRO_END.search(endereco)
    if not m:
        return None, False

    raw = m.group(1).strip()

    # Descartar se começa com prefixo de logradouro ou número
    if _PREFIXOS_INV.match(raw):
        return None, False
    if re.match(r'^\d', raw):
        return None, False
    if len(raw) < 3:
        return None, False

    # Tentar normalizar
    oficial = _normalizar(raw)
    if oficial:
        return oficial, False

    # Não é bairro reconhecido — retornar raw para análise downstream
    return raw, False


# ── Função principal ──────────────────────────────────────────────────────────
def validar_bairro(lat, lon, bairro_pesq: str, endereco: str = "") -> dict:
    """
    Valida a localização de um estabelecimento.

    Args:
        lat, lon: coordenadas (float ou str)
        bairro_pesq: bairro onde foi buscado (vazio para varredura de grade)
        endereco: endereço completo do Google Maps

    Returns dict com:
        status          : STATUS_*
        bairro_detectado: nome do bairro ou ""
        distancia_m     : distância em metros (-1 se não calculada por coord)
        metodo          : "endereco" | "centroide" | "fora_belem" | "inconclusivo"
    """
    # Normalizar coordenadas
    try:
        lat = float(lat) if lat else 0.0
        lon = float(lon) if lon else 0.0
    except (TypeError, ValueError):
        lat = lon = 0.0

    if lat == 0.0 and lon == 0.0:
        return {
            "status": STATUS_INCERTO,
            "bairro_detectado": "",
            "distancia_m": -1,
            "metodo": "inconclusivo",
        }

    bp_lower = (bairro_pesq or "").strip().lower()

    # ── Passo 1: endereço ─────────────────────────────────────────────────────
    b_end, fora_belem_end = _bairro_do_endereco(endereco or "")

    if fora_belem_end:
        return {
            "status": STATUS_FORA_BELEM,
            "bairro_detectado": b_end or "",
            "distancia_m": -1,
            "metodo": "endereco",
        }

    if b_end:
        # Verificar se é bairro oficial (normalizado)
        b_oficial = _normalizar(b_end) if b_end not in _NOME_LOWER.values() else b_end
        if b_oficial:
            if not bp_lower or b_oficial.lower() == bp_lower:
                status = STATUS_DENTRO
            else:
                status = STATUS_VIZINHO
            return {
                "status": status,
                "bairro_detectado": b_oficial,
                "distancia_m": -1,
                "metodo": "endereco",
            }
        # b_end existe mas não é oficial — pode ser sub-bairro ou outro município
        # continuar para validação por coordenada

    # ── Passo 2: bounding box de Belém ───────────────────────────────────────
    em_bbox = _LAT_MIN <= lat <= _LAT_MAX and _LON_MIN <= lon <= _LON_MAX

    # ── Passo 3: centróide + raio ─────────────────────────────────────────────
    melhor_bairro = None
    melhor_dist   = float("inf")

    for b in _BAIRROS:
        d = _hav(lat, lon, b["lat"], b["lon"])
        if d <= b["raio_m"] and d < melhor_dist:
            melhor_dist  = d
            melhor_bairro = b["bairro"]

    if melhor_bairro:
        if not bp_lower or melhor_bairro.lower() == bp_lower:
            status = STATUS_DENTRO
        else:
            status = STATUS_VIZINHO
        return {
            "status": status,
            "bairro_detectado": melhor_bairro,
            "distancia_m": int(melhor_dist),
            "metodo": "centroide",
        }

    # ── Passo 4: fora de todos os raios ──────────────────────────────────────
    dist_minima = min(_hav(lat, lon, b["lat"], b["lon"]) for b in _BAIRROS)

    if not em_bbox or dist_minima > _DIST_FORA_BELEM_M:
        return {
            "status": STATUS_FORA_BELEM,
            "bairro_detectado": "",
            "distancia_m": int(dist_minima),
            "metodo": "fora_belem",
        }

    return {
        "status": STATUS_FORA_BAIRRO,
        "bairro_detectado": "",
        "distancia_m": int(dist_minima),
        "metodo": "centroide",
    }
