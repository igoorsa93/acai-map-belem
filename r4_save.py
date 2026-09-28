#!/usr/bin/env python3
"""
r4_save.py — Salva dados R4 coletados via Chrome no formato de bairro.

Uso:
  python3 r4_save.py <slug> <nome_bairro> '<json_data>'

Onde json_data é uma lista de objetos com:
  {place_id, nome, lat, lng, rating, review_count, endereco}

Realiza:
1. Deduplicação contra raw.csv existente (por place_id E por proximidade lat/lng)
2. Geo-validação com geo_validator
3. Append em raw.csv e validado.csv
4. Atualiza status.json
"""
import csv, json, math, sys, os
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

COLETA = ROOT / "data" / "coleta" / "bairros"

RAW_FIELDNAMES = [
    "place_id", "nome", "latitude", "longitude", "rating", "review_count",
    "endereco", "bairro_pesquisa", "status_geo_orig", "bairro_detectado_orig",
    "rodadas", "r1", "r2", "g1", "g2", "g3", "r3", "r4",
]

VALIDADO_FIELDNAMES = [
    "place_id", "nome", "latitude", "longitude", "rating", "review_count",
    "endereco", "bairro_validado", "status_geo", "distancia_m", "metodo_validacao",
    "rodadas", "r1", "r2", "g1", "g2", "g3", "r3", "r4",
]


def haversine(lat1, lon1, lat2, lon2):
    R = 6371000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def carregar_existente(slug, filename):
    path = COLETA / slug / filename
    if not path.exists():
        return []
    with open(path, encoding='utf-8') as f:
        return list(csv.DictReader(f))


def is_duplicate(estab, existing_raw, threshold_m=80):
    """Verifica se estabelecimento já existe (por place_id ou proximidade)."""
    pid = estab['place_id']
    lat = float(estab['lat'])
    lng = float(estab['lng'])

    for row in existing_raw:
        # Exact place_id match
        if row.get('place_id') == pid:
            return True
        # Proximity check
        try:
            rlat = float(row.get('latitude', 0))
            rlng = float(row.get('longitude', 0))
            if rlat != 0 and rlng != 0:
                dist = haversine(lat, lng, rlat, rlng)
                if dist < threshold_m:
                    # Same location - likely duplicate
                    return True
        except (ValueError, TypeError):
            pass
    return False


def geo_validar_simples(lat, lng, bairro_nome, bairros_index):
    """Validação geográfica simplificada usando bairros_index.json."""
    try:
        b_info = bairros_index.get(bairro_nome.lower().replace(' ', '_'))
        if not b_info:
            # Try slug-based lookup
            for slug, info in bairros_index.items():
                if info['nome'].lower() == bairro_nome.lower():
                    b_info = info
                    break

        if not b_info:
            return {'status': 'INCERTO', 'bairro_detectado': bairro_nome, 'distancia_m': 0, 'metodo': 'sem_config'}

        b_lat = float(b_info['lat'])
        b_lon = float(b_info['lon'])
        raio = float(b_info.get('raio_m', 1000))

        dist = haversine(lat, lng, b_lat, b_lon)

        if dist <= raio * 1.5:
            return {'status': 'DENTRO', 'bairro_detectado': b_info['nome'], 'distancia_m': round(dist), 'metodo': 'centroide_idx'}
        elif dist <= raio * 3:
            return {'status': 'VIZINHO', 'bairro_detectado': b_info['nome'], 'distancia_m': round(dist), 'metodo': 'centroide_idx'}
        else:
            return {'status': 'FORA_BAIRRO', 'bairro_detectado': b_info['nome'], 'distancia_m': round(dist), 'metodo': 'centroide_idx'}
    except Exception as e:
        return {'status': 'INCERTO', 'bairro_detectado': bairro_nome, 'distancia_m': 0, 'metodo': f'erro:{e}'}


def salvar_r4(slug, nome_bairro, estabelecimentos_json):
    """
    Processa e salva dados R4 coletados via Chrome.

    estabelecimentos_json: lista de dicts com {place_id, nome, lat, lng, rating, review_count, endereco}
    """
    bairro_dir = COLETA / slug
    bairro_dir.mkdir(parents=True, exist_ok=True)

    # Carregar bairros_index para geo-validação
    with open(ROOT / "data" / "coleta" / "bairros_index.json") as f:
        bairros_index = json.load(f)

    # Carregar existente
    raw_existente = carregar_existente(slug, 'raw.csv')
    val_existente = carregar_existente(slug, 'validado.csv')
    pids_val = {r['place_id'] for r in val_existente}

    novos_raw = []
    novos_val = []
    dups = 0

    for estab in estabelecimentos_json:
        if not estab.get('place_id'):
            continue

        # Deduplicar
        if is_duplicate(estab, raw_existente):
            dups += 1
            continue

        lat = float(estab.get('lat', 0))
        lng = float(estab.get('lng', 0))

        # Geo-validar
        geo = geo_validar_simples(lat, lng, nome_bairro, bairros_index)

        row_raw = {
            'place_id': estab['place_id'],
            'nome': estab.get('nome', ''),
            'latitude': lat,
            'longitude': lng,
            'rating': estab.get('rating', ''),
            'review_count': estab.get('review_count', ''),
            'endereco': estab.get('endereco', ''),
            'bairro_pesquisa': nome_bairro,
            'status_geo_orig': geo['status'],
            'bairro_detectado_orig': geo['bairro_detectado'],
            'rodadas': 'r4',
            'r1': False, 'r2': False, 'g1': False,
            'g2': False, 'g3': False, 'r3': False, 'r4': True,
        }
        novos_raw.append(row_raw)

        if geo['status'] == 'DENTRO' and estab['place_id'] not in pids_val:
            novos_val.append({
                'place_id': estab['place_id'],
                'nome': estab.get('nome', ''),
                'latitude': lat,
                'longitude': lng,
                'rating': estab.get('rating', ''),
                'review_count': estab.get('review_count', ''),
                'endereco': estab.get('endereco', ''),
                'bairro_validado': geo['bairro_detectado'] or nome_bairro,
                'status_geo': 'DENTRO',
                'distancia_m': geo['distancia_m'],
                'metodo_validacao': geo['metodo'],
                'rodadas': 'r4',
                'r1': False, 'r2': False, 'g1': False,
                'g2': False, 'g3': False, 'r3': False, 'r4': True,
            })

    # Gravar raw.csv (append)
    raw_path = COLETA / slug / 'raw.csv'
    write_header = not raw_path.exists() or not raw_existente
    with open(raw_path, 'a', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=RAW_FIELDNAMES, extrasaction='ignore')
        if write_header:
            w.writeheader()
        w.writerows(novos_raw)

    # Gravar validado.csv (append)
    val_path = COLETA / slug / 'validado.csv'
    write_header_v = not val_path.exists() or not val_existente
    with open(val_path, 'a', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, fieldnames=VALIDADO_FIELDNAMES, extrasaction='ignore')
        if write_header_v:
            w.writeheader()
        w.writerows(novos_val)

    # Atualizar status.json
    st_path = COLETA / slug / 'status.json'
    st = {}
    if st_path.exists():
        try:
            st = json.loads(st_path.read_text())
        except Exception:
            st = {}

    st.update({
        'bairro': nome_bairro,
        'estado': 'validado',
        'total_raw': (st.get('total_raw', 0) + len(novos_raw)),
        'total_validado': (st.get('total_validado', 0) + len(novos_val)),
        'r4_coletado': True,
        'r4_novos_raw': len(novos_raw),
        'r4_novos_dentro': len(novos_val),
        'r4_dups_evitados': dups,
        'r4_timestamp': datetime.now(timezone.utc).isoformat(),
    })
    st_path.write_text(json.dumps(st, ensure_ascii=False, indent=2))

    return {
        'novos_raw': len(novos_raw),
        'novos_val': len(novos_val),
        'dups': dups,
        'total_coletados': len(estabelecimentos_json),
    }


if __name__ == '__main__':
    if len(sys.argv) < 4:
        print("Uso: python3 r4_save.py <slug> <nome> '<json>'")
        sys.exit(1)

    slug = sys.argv[1]
    nome = sys.argv[2]
    data = json.loads(sys.argv[3])

    result = salvar_r4(slug, nome, data)
    print(json.dumps(result, ensure_ascii=False))
