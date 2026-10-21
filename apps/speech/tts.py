import os
import re
import uuid
import time
from pathlib import Path
from gtts import gTTS
from django.conf import settings

def clean_text_for_speech(text: str) -> str:
    """
    Cleans markdown formatting, links, asterisks, bullet points, and code blocks
    so gTTS reads natural, articulate spoken English without pronouncing symbols.
    """
    if not text:
        return ""
    # Remove code blocks and inline code
    text = re.sub(r'```[\s\S]*?```', '', text)
    text = re.sub(r'`.*?`', '', text)
    # Remove markdown headers (#, ##, etc.)
    text = re.sub(r'#+\s*', '', text)
    # Remove markdown asterisks and underscores (**bold**, *italic*)
    text = re.sub(r'[*_~]', '', text)
    # Remove bullet markers like "* " or "- " at line starts
    text = re.sub(r'^\s*[-*•]\s+', '', text, flags=re.MULTILINE)
    # Replace markdown links [text](url) with just text
    text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
    # Replace URLs
    text = re.sub(r'https?://\S+', '', text)
    # Normalize multiple spaces and newlines
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def clean_old_audio_files(max_age_seconds=3600, max_files=50):
    """
    Deletes temporary audio files older than max_age_seconds or limits directory size.
    Enforces the requirement: 'Audio files should be stored temporarily and deleted when no longer required.'
    """
    audio_dir = Path(settings.AUDIO_TEMP_DIR)
    if not audio_dir.exists():
        return

    now = time.time()
    try:
        files = list(audio_dir.glob('*.mp3'))
        for f in files:
            if now - f.stat().st_mtime > max_age_seconds:
                try:
                    f.unlink(missing_ok=True)
                except OSError:
                    pass

        remaining = sorted(list(audio_dir.glob('*.mp3')), key=lambda x: x.stat().st_mtime)
        if len(remaining) > max_files:
            for f in remaining[:len(remaining) - max_files]:
                try:
                    f.unlink(missing_ok=True)
                except OSError:
                    pass
    except Exception:
        pass


def generate_speech_audio(text: str, lang: str = 'en') -> str:
    """
    Converts English text into an MP3 file using gTTS.
    Returns the web URL path to the generated audio file.
    """
    clean_text = clean_text_for_speech(text)
    if not clean_text:
        clean_text = "I received your message."

    # Clean previous temporary audio
    clean_old_audio_files()

    audio_dir = Path(settings.AUDIO_TEMP_DIR)
    audio_dir.mkdir(parents=True, exist_ok=True)

    filename = f"tts_{uuid.uuid4().hex[:12]}.mp3"
    filepath = audio_dir / filename

    # Generate MP3 using Google Text-to-Speech with English language setting
    tts = gTTS(text=clean_text, lang=lang or 'en', slow=False)
    tts.save(str(filepath))

    relative_url = f"{settings.MEDIA_URL}audio/{filename}"
    return relative_url
