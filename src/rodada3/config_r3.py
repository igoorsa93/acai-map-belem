"""
config_r3.py — Configuração de bairros para Rodada 3.
Carrega bairros_r3.yaml e expõe DATA (Path para /data).
"""
from pathlib import Path
import yaml

# Raiz do projeto (dois níveis acima de src/rodada3/)
ROOT   = Path(__file__).resolve().parents[2]
DATA   = ROOT / "data"
CONFIG = ROOT / "config"


def carregar_bairros():
    """
    Retorna lista de dicts com:
      bairro, distrito, lat, lon, raio_m, aliases
    """
    with open(CONFIG / "bairros_r3.yaml", encoding="utf-8") as f:
        cfg = yaml.safe_load(f)

    bairros = []
    for dist_key, dist_val in cfg["distritos"].items():
        for b in dist_val["bairros"]:
            bairros.append({
                "bairro":   b["nome"],
                "distrito": dist_key,
                "lat":      float(b["lat"]),
                "lon":      float(b["lon"]),
                "raio_m":   int(b["raio_m"]),
                "aliases":  [str(a) for a in b.get("aliases", [])],
            })
    return bairros
