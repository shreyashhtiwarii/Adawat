import re
import math
import hashlib
import numpy as np
import requests
import logging
from django.conf import settings

logger = logging.getLogger(__name__)

_st_model = None

def _get_sentence_transformer():
    """Lazy load sentence-transformers model if available."""
    global _st_model
    if _st_model is None:
        try:
            from sentence_transformers import SentenceTransformer
            logger.info("Loading sentence-transformers 'all-MiniLM-L6-v2'...")
            _st_model = SentenceTransformer('all-MiniLM-L6-v2')
        except Exception as e:
            _st_model = False
            logger.info(f"sentence-transformers not initialized ({e}); using resilient fallback.")
    return _st_model if _st_model is not False else None


def _fallback_hash_embedding(text: str, dim: int = 384) -> list[float]:
    """
    Deterministic semantic feature embedding for text.
    Extracts word tokens, character trigrams, and lexical features,
    projected into a normalized vector of length `dim`.
    Provides guaranteed zero-failure fallback with consistent cosine distance.
    """
    if not text:
        return [0.0] * dim

    vec = np.zeros(dim, dtype=np.float32)
    clean_text = text.lower().strip()
    words = re.findall(r'\b\w+\b', clean_text)

    # 1. Word level features
    for idx, word in enumerate(words):
        h = int(hashlib.md5(word.encode('utf-8')).hexdigest(), 16)
        pos = h % dim
        sign = 1.0 if ((h >> 8) % 2 == 0) else -1.0
        # Give higher weight to earlier and distinctive words
        weight = 1.0 / (math.log(idx + 2))
        vec[pos] += sign * weight

    # 2. Character trigram features for sub-word semantics
    for i in range(len(clean_text) - 2):
        trigram = clean_text[i:i+3]
        h = int(hashlib.sha256(trigram.encode('utf-8')).hexdigest(), 16)
        pos = h % dim
        sign = 1.0 if ((h >> 4) % 2 == 0) else -1.0
        vec[pos] += sign * 0.4

    # 3. Overall sentence length / complexity hint in designated bucket
    length_pos = dim - 1
    vec[length_pos] += math.tanh(len(words) / 10.0)

    # L2 normalize
    norm = np.linalg.norm(vec)
    if norm > 1e-6:
        vec = vec / norm
    else:
        vec[0] = 1.0

    return vec.tolist()


def generate_embedding(text: str, dim: int = 384) -> list[float]:
    """
    Primary embedding entry point.
    Returns a unit-normalized vector of size `dim` (default 384).
    """
    target_dim = getattr(settings, 'EMBEDDING_DIM', dim)
    text = (text or '').strip()
    if not text:
        return [0.0] * target_dim

    # 1. Try Sentence Transformers if available
    st_model = _get_sentence_transformer()
    if st_model is not None:
        try:
            emb = st_model.encode(text)
            if hasattr(emb, 'tolist'):
                emb = emb.tolist()
            # Normalize
            arr = np.array(emb, dtype=np.float32)
            norm = np.linalg.norm(arr)
            if norm > 1e-6:
                arr = arr / norm
            # Pad or truncate to target_dim if necessary
            if len(arr) == target_dim:
                return arr.tolist()
            elif len(arr) > target_dim:
                return arr[:target_dim].tolist()
            else:
                padded = np.pad(arr, (0, target_dim - len(arr)))
                return padded.tolist()
        except Exception as e:
            logger.warning(f"SentenceTransformer encoding error: {e}")

    # 2. Try Ollama embeddings if provider is ollama
    if getattr(settings, 'LLM_PROVIDER', '') == 'ollama':
        try:
            ollama_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
            model_name = getattr(settings, 'OLLAMA_MODEL', 'llama3.2:1b')
            resp = requests.post(
                f"{ollama_url}/api/embeddings",
                json={"model": model_name, "prompt": text},
                timeout=3.0
            )
            if resp.status_code == 200:
                raw_emb = resp.json().get('embedding', [])
                if raw_emb:
                    arr = np.array(raw_emb, dtype=np.float32)
                    # Project or resize to target_dim
                    if len(arr) != target_dim:
                        # Deterministic projection
                        step = len(arr) / float(target_dim)
                        indices = (np.arange(target_dim) * step).astype(int)
                        arr = arr[indices]
                    norm = np.linalg.norm(arr)
                    if norm > 1e-6:
                        arr = arr / norm
                    return arr.tolist()
        except Exception:
            pass

    # 3. Resilient deterministic semantic embedding fallback
    return _fallback_hash_embedding(text, dim=target_dim)
