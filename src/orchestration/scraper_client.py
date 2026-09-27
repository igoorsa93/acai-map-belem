"""
scraper_client.py — Cliente HTTP para o google-maps-scraper-kit.

Envia buscas por bairro ao serviço local em localhost:8080 e retorna
a lista de estabelecimentos de açaí encontrados.

API esperada (google-maps-scraper-kit):
  POST /search
  Body: {"query": "açaí <bairro> Belém PA", "max_results": 60}
  Response: [{"place_id": "...", "name": "...", "lat": ..., "lng": ...,
              "rating": ..., "reviews": ..., "address": "..."}, ...]

  GET /status  → {"status": "ok", "version": "..."}

Fallback: se o serviço não estiver disponível, lança ScraperOfflineError.
"""
import asyncio
import aiohttp
import json
from dataclasses import dataclass
from typing import Optional

SCRAPER_BASE = "http://localhost:8080"
SEARCH_ENDPOINT = f"{SCRAPER_BASE}/search"
STATUS_ENDPOINT = f"{SCRAPER_BASE}/status"

# Queries alternativas para maximizar cobertura por bairro
QUERY_TEMPLATES = [
    'açaí "{bairro}" Belém PA',
    'açaí {bairro} Belém',
    'polpa açaí {bairro} Belém',
    'açaizeiro {bairro} Belém PA',
]


class ScraperOfflineError(Exception):
    """Lançado quando o scraper local não está disponível."""


@dataclass
class EstabelecimentoR4:
    place_id: str
    nome: str
    latitude: float
    longitude: float
    rating: str
    review_count: str
    endereco: str
    query_usada: str
    bairro_pesquisa: str


async def verificar_scraper(session: aiohttp.ClientSession, timeout: int = 5) -> dict:
    """Verifica se o scraper está online. Retorna info de status."""
    try:
        async with session.get(STATUS_ENDPOINT, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
            if resp.status == 200:
                return await resp.json()
            raise ScraperOfflineError(f"Scraper retornou HTTP {resp.status}")
    except aiohttp.ClientConnectorError:
        raise ScraperOfflineError(
            f"Scraper offline — inicie o google-maps-scraper-kit em {SCRAPER_BASE}"
        )
    except asyncio.TimeoutError:
        raise ScraperOfflineError(f"Scraper timeout após {timeout}s em {STATUS_ENDPOINT}")


async def buscar_por_query(
    session: aiohttp.ClientSession,
    query: str,
    max_results: int = 60,
    timeout: int = 120,
) -> list[dict]:
    """Executa uma busca no scraper e retorna lista bruta de resultados."""
    payload = {"query": query, "max_results": max_results}
    try:
        async with session.post(
            SEARCH_ENDPOINT,
            json=payload,
            timeout=aiohttp.ClientTimeout(total=timeout),
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                raise RuntimeError(f"HTTP {resp.status}: {body[:200]}")
            data = await resp.json()
            # Aceita tanto lista direta quanto envelope {"results": [...]}
            if isinstance(data, list):
                return data
            if isinstance(data, dict):
                return data.get("results", data.get("data", []))
            return []
    except aiohttp.ClientConnectorError as e:
        raise ScraperOfflineError(str(e))


def _normalizar_resultado(raw: dict, query: str, bairro: str) -> Optional[EstabelecimentoR4]:
    """Converte resultado bruto do scraper para EstabelecimentoR4."""
    pid = (
        raw.get("place_id") or
        raw.get("placeId") or
        raw.get("id") or
        ""
    ).strip()
    if not pid:
        return None

    # Suporte a variações de campo (lat/lng vs latitude/longitude)
    lat = float(raw.get("lat") or raw.get("latitude") or 0.0)
    lng = float(raw.get("lng") or raw.get("longitude") or raw.get("lon") or 0.0)

    return EstabelecimentoR4(
        place_id=pid,
        nome=(raw.get("name") or raw.get("nome") or "").strip(),
        latitude=lat,
        longitude=lng,
        rating=str(raw.get("rating") or raw.get("review_rating") or ""),
        review_count=str(raw.get("reviews") or raw.get("review_count") or ""),
        endereco=(raw.get("address") or raw.get("endereco") or "").strip(),
        query_usada=query,
        bairro_pesquisa=bairro,
    )


async def coletar_bairro(
    bairro: str,
    session: aiohttp.ClientSession,
    max_results_por_query: int = 60,
    queries_extras: Optional[list[str]] = None,
    timeout: int = 120,
) -> tuple[list[EstabelecimentoR4], list[str]]:
    """
    Executa múltiplas queries para um bairro e deduplica por place_id.

    Returns:
        (estabelecimentos, erros)  — erros é lista de strings descritivas
    """
    queries = [t.format(bairro=bairro) for t in QUERY_TEMPLATES]
    if queries_extras:
        queries += queries_extras

    vistos: dict[str, EstabelecimentoR4] = {}
    erros: list[str] = []

    for query in queries:
        try:
            resultados = await buscar_por_query(
                session, query, max_results=max_results_por_query, timeout=timeout
            )
            novos = 0
            for raw in resultados:
                estab = _normalizar_resultado(raw, query, bairro)
                if estab and estab.place_id not in vistos:
                    vistos[estab.place_id] = estab
                    novos += 1
        except ScraperOfflineError:
            raise  # Propagar para o runner parar tudo
        except Exception as e:
            erros.append(f"query={query!r} erro={e}")

    return list(vistos.values()), erros
