import time
import logging
from apps.conversations.models import Conversation, Message
from apps.speech.tts import generate_speech_audio
from .embeddings import generate_embedding
from .retriever import retrieve_relevant_context
from .llm import generate_llm_response

logger = logging.getLogger(__name__)

def run_rag_pipeline(user_text: str, conversation_id: int = None, generate_speech: bool = True) -> dict:
    """
    Complete RAG Execution Flow:
    1. Parse and validate user message.
    2. Retrieve or create Conversation.
    3. Generate vector embedding for user message.
    4. Save user message to PostgreSQL / DB.
    5. Query pgvector for semantically relevant previous conversation messages.
    6. Formulate contextual prompt and generate response via LLM.
    7. Generate vector embedding for assistant message.
    8. Generate English TTS audio via gTTS.
    9. Store assistant message in DB.
    10. Return complete payload.
    """
    start_time = time.time()
    user_text = (user_text or "").strip()
    if not user_text:
        raise ValueError("User message cannot be empty.")

    # 1. Manage Conversation
    conversation = None
    if conversation_id:
        try:
            conversation = Conversation.objects.get(pk=conversation_id)
        except Conversation.DoesNotExist:
            conversation = None

    if conversation is None:
        title = user_text[:45].strip()
        if len(user_text) > 45:
            title += "..."
        conversation = Conversation.objects.create(title=title)

    # 2. Embed user message
    user_embedding = generate_embedding(user_text)

    # 3. Store user message in DB
    user_msg = Message.objects.create(
        conversation=conversation,
        role='user',
        content=user_text,
        embedding=user_embedding
    )

    # 4. Semantic vector search (RAG)
    retrieved_context = retrieve_relevant_context(
        query_text=user_text,
        exclude_message_ids=[user_msg.id],
        current_conversation_id=conversation.id
    )

    # 5. Extract recent messages from active conversation for dialogue coherence
    recent_messages = (
        conversation.messages.exclude(id=user_msg.id)
        .order_by('-created_at')[:6]
    )
    history = [
        {"role": m.role, "content": m.content}
        for m in reversed(list(recent_messages))
    ]

    # 6. Generate LLM response
    llm_start = time.time()
    assistant_text = generate_llm_response(
        prompt=user_text,
        context=retrieved_context,
        history=history
    )
    llm_duration = round(time.time() - llm_start, 2)

    # 7. Embed assistant response
    assistant_embedding = generate_embedding(assistant_text)

    # 8. Generate speech audio with gTTS
    audio_url = None
    if generate_speech:
        try:
            audio_url = generate_speech_audio(assistant_text, lang='en')
        except Exception as e:
            logger.warning(f"TTS generation failed: {e}")
            audio_url = None

    # 9. Store assistant message with pgvector embedding and metadata
    total_duration = round(time.time() - start_time, 2)
    metadata = {
        "retrieved_context_count": len(retrieved_context),
        "retrieved_sources": [
            {"id": c["id"], "conv_id": c["conversation_id"], "score": c["score"]}
            for c in retrieved_context
        ],
        "latency_seconds": total_duration,
        "llm_latency_seconds": llm_duration
    }

    assistant_msg = Message.objects.create(
        conversation=conversation,
        role='assistant',
        content=assistant_text,
        audio_url=audio_url,
        embedding=assistant_embedding,
        metadata=metadata
    )

    # Touch conversation timestamp
    conversation.save(update_fields=['updated_at'])

    return {
        "conversation_id": conversation.id,
        "conversation_title": conversation.title,
        "user_message": {
            "id": user_msg.id,
            "role": user_msg.role,
            "content": user_msg.content,
            "created_at": user_msg.created_at.isoformat()
        },
        "assistant_message": {
            "id": assistant_msg.id,
            "role": assistant_msg.role,
            "content": assistant_msg.content,
            "audio_url": assistant_msg.audio_url,
            "metadata": assistant_msg.metadata,
            "created_at": assistant_msg.created_at.isoformat()
        },
        "retrieved_context": retrieved_context,
        "timing": {
            "total_latency": total_duration,
            "llm_latency": llm_duration
        }
    }
