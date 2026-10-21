import os
import requests
import json
import logging
from django.conf import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are an articulate, intelligent, and friendly AI voice and text assistant named ADAWAT.
CRITICAL RULES:
1. Respond in ENGLISH ONLY. Under no circumstances should you use any other language.
2. Tone & Style: Speak in natural, warm, and conversational English. Your answers will be spoken out loud using Text-to-Speech, so write sentences that sound effortless and pleasant to hear.
3. No Markdown clutter: Do NOT use bullet points (*, -), asterisks (**bold**), headers (###), or markdown tables, as they sound awkward when read aloud by speech synthesizers. Use natural phrasing and conversational transitions instead.
4. RAG Context: If information from previous conversations is provided under [RELEVANT CONTEXT], reference and connect it seamlessly into your response to provide persistent conversational memory.
5. Keep answers focused, engaging, and usually between 2 to 4 sentences unless a deep technical explanation is requested.
"""

def _call_ollama(prompt: str, context_text: str, history: list[dict]) -> str:
    ollama_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
    model_name = getattr(settings, 'OLLAMA_MODEL', 'llama3.2:1b')

    # Construct chat messages
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    if context_text:
        messages.append({
            "role": "system",
            "content": f"[RELEVANT CONTEXT FROM PREVIOUS CONVERSATIONS]:\n{context_text}"
        })

    # Add recent conversation turns for context continuity
    for h in history[-6:]:
        messages.append({
            "role": h.get("role", "user"),
            "content": h.get("content", "")
        })

    # Add current prompt
    messages.append({"role": "user", "content": prompt})

    try:
        resp = requests.post(
            f"{ollama_url}/api/chat",
            json={
                "model": model_name,
                "messages": messages,
                "stream": False,
                "options": {
                    "temperature": 0.7,
                    "top_p": 0.9,
                }
            },
            timeout=45.0
        )
        if resp.status_code == 200:
            data = resp.json()
            return data.get('message', {}).get('content', '').strip()
        else:
            logger.warning(f"Ollama chat error status {resp.status_code}: {resp.text}")
    except Exception as e:
        logger.warning(f"Ollama request failed: {e}")

    return ""


def _call_openai(prompt: str, context_text: str, history: list[dict]) -> str:
    api_key = getattr(settings, 'OPENAI_API_KEY', '') or os.getenv('OPENAI_API_KEY', '')
    if not api_key:
        return ""

    model_name = getattr(settings, 'OPENAI_MODEL', 'gpt-4o-mini')
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    if context_text:
        messages.append({
            "role": "system",
            "content": f"[RELEVANT CONTEXT FROM PREVIOUS CONVERSATIONS]:\n{context_text}"
        })

    for h in history[-6:]:
        messages.append({
            "role": h.get("role", "user"),
            "content": h.get("content", "")
        })

    messages.append({"role": "user", "content": prompt})

    try:
        resp = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": model_name,
                "messages": messages,
                "temperature": 0.7
            },
            timeout=30.0
        )
        if resp.status_code == 200:
            data = resp.json()
            return data['choices'][0]['message']['content'].strip()
    except Exception as e:
        logger.warning(f"OpenAI API call failed: {e}")

    return ""


def _mock_llm_response(prompt: str, context_text: str) -> str:
    """Intelligent fallback responder when external LLM services are temporarily offline."""
    prompt_clean = prompt.strip().rstrip('?!.').capitalize()

    if context_text:
        return (
            f"Regarding {prompt_clean}, connecting to our earlier conversation: {context_text[:180]}. "
            f"I have integrated this memory and am ready for your next question."
        )
    return (
        f"I received your inquiry regarding {prompt_clean}. "
        f"I am functioning properly and ready to assist you in English with voice and text responses."
    )


def generate_llm_response(prompt: str, context: list[dict] = None, history: list[dict] = None) -> str:
    """
    Coordinates LLM generation across configured providers (Ollama, OpenAI, or Mock).
    Always strictly produces natural, conversational English responses.
    """
    context = context or []
    history = history or []

    # Build formatted context string
    context_text = ""
    if context:
        context_lines = []
        for c in context:
            context_lines.append(f"- [Past {c.get('role', 'msg')} in '{c.get('conversation_title', 'Chat')}']: {c.get('content', '')}")
        context_text = "\n".join(context_lines)

    provider = getattr(settings, 'LLM_PROVIDER', 'ollama').lower()

    response = ""
    if provider == 'ollama':
        response = _call_ollama(prompt, context_text, history)
    elif provider == 'openai':
        response = _call_openai(prompt, context_text, history)

    # Fallback to Ollama if OpenAI was selected but failed or had no key
    if not response and provider != 'ollama':
        response = _call_ollama(prompt, context_text, history)

    # Fallback to Mock responder if neither was available
    if not response:
        response = _mock_llm_response(prompt, context_text)

    return response.strip()
