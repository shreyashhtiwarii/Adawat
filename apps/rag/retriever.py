import numpy as np
import logging
from django.db import connection
from django.conf import settings
from apps.conversations.models import Message
from .embeddings import generate_embedding

logger = logging.getLogger(__name__)

def retrieve_relevant_context(
    query_text: str,
    exclude_message_ids: list = None,
    current_conversation_id: int = None,
    top_k: int = None,
    threshold: float = None
) -> list[dict]:
    """
    RAG Retriever: Converts the query into a numerical embedding and searches
    PostgreSQL with pgvector (or fallback vector engine) to retrieve semantically
    relevant messages from previous conversations.
    """
    if not query_text or not query_text.strip():
        return []

    if top_k is None:
        top_k = getattr(settings, 'MAX_RETRIEVED_CONTEXTS', 4)
    if threshold is None:
        threshold = getattr(settings, 'SIMILARITY_THRESHOLD', 0.25)
    if exclude_message_ids is None:
        exclude_message_ids = []

    query_vec = generate_embedding(query_text)
    results = []

    # Check if database is PostgreSQL with pgvector support
    if connection.vendor == 'postgresql':
        try:
            from pgvector.django import CosineDistance
            qs = Message.objects.exclude(embedding=None).exclude(id__in=exclude_message_ids)
            
            # Annotate with cosine distance: distance in [0, 2]
            # Similarity = 1.0 - distance
            max_distance = 1.0 - threshold
            matched = (
                qs.annotate(distance=CosineDistance('embedding', query_vec))
                .filter(distance__lte=max_distance)
                .select_related('conversation')
                .order_by('distance')[:top_k]
            )

            for m in matched:
                sim_score = max(0.0, min(1.0, 1.0 - float(m.distance)))
                results.append({
                    "id": m.id,
                    "conversation_id": m.conversation_id,
                    "conversation_title": m.conversation.title,
                    "role": m.role,
                    "content": m.content,
                    "score": round(sim_score, 4),
                    "created_at": m.created_at.isoformat(),
                    "source": "pgvector"
                })
            return results
        except Exception as e:
            logger.warning(f"PostgreSQL pgvector query failed ({e}), using in-memory cosine fallback.")

    # SQLite / In-Memory vector similarity fallback
    try:
        candidate_messages = (
            Message.objects.exclude(embedding=None)
            .exclude(id__in=exclude_message_ids)
            .select_related('conversation')
            .order_by('-created_at')[:250]
        )

        q_arr = np.array(query_vec, dtype=np.float32)
        q_norm = np.linalg.norm(q_arr)
        if q_norm < 1e-6:
            return []

        scored_messages = []
        for m in candidate_messages:
            if not m.embedding:
                continue
            try:
                m_arr = np.array(m.embedding, dtype=np.float32)
                m_norm = np.linalg.norm(m_arr)
                if m_norm < 1e-6:
                    continue
                cos_sim = float(np.dot(q_arr, m_arr) / (q_norm * m_norm))
                if cos_sim >= threshold:
                    scored_messages.append((cos_sim, m))
            except Exception:
                continue

        # Sort descending by similarity
        scored_messages.sort(key=lambda x: x[0], reverse=True)

        for score, m in scored_messages[:top_k]:
            results.append({
                "id": m.id,
                "conversation_id": m.conversation_id,
                "conversation_title": m.conversation.title,
                "role": m.role,
                "content": m.content,
                "score": round(score, 4),
                "created_at": m.created_at.isoformat(),
                "source": "vector_similarity"
            })

    except Exception as e:
        logger.error(f"Vector retrieval error: {e}")

    return results
