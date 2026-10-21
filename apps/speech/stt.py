import os
import sys
import shutil
import uuid
import logging
from pathlib import Path
from django.conf import settings

logger = logging.getLogger(__name__)

_whisper_model = None
_ffmpeg_exe = None   # Absolute path to ffmpeg executable


def _resolve_ffmpeg() -> str | None:
    """
    Resolves the absolute path to ffmpeg and ensures it is accessible via PATH.
    Priority:
      1. System PATH (standard install)
      2. imageio_ffmpeg bundled binary — copies it to venv/Scripts/ffmpeg.exe
    Returns the absolute path, or None if not found.
    """
    global _ffmpeg_exe
    if _ffmpeg_exe:
        return _ffmpeg_exe

    # 1. Already on PATH
    found = shutil.which('ffmpeg') or shutil.which('ffmpeg.exe')
    if found:
        _ffmpeg_exe = found
        return _ffmpeg_exe

    # 2. imageio_ffmpeg bundled binary (may have a versioned filename)
    try:
        import imageio_ffmpeg
        bin_path = imageio_ffmpeg.get_ffmpeg_exe()
        if bin_path and Path(bin_path).exists():
            logger.info(f"Found imageio_ffmpeg binary: {bin_path}")

            # Copy to venv/Scripts/ffmpeg.exe so subprocess 'ffmpeg' calls work
            venv_scripts = Path(sys.prefix) / 'Scripts'
            target = venv_scripts / 'ffmpeg.exe'
            if not target.exists():
                try:
                    shutil.copy2(str(bin_path), str(target))
                    logger.info(f"Copied ffmpeg to: {target}")
                except Exception as copy_err:
                    logger.warning(f"Could not copy ffmpeg to Scripts: {copy_err}")

            # Prepend both directories to PATH
            for d in [str(venv_scripts), str(Path(bin_path).parent)]:
                if d not in os.environ.get('PATH', ''):
                    os.environ['PATH'] = d + ';' + os.environ.get('PATH', '')

            _ffmpeg_exe = str(target) if target.exists() else str(bin_path)
            return _ffmpeg_exe
    except Exception as e:
        logger.warning(f"imageio_ffmpeg lookup failed: {e}")

    logger.error("ffmpeg not found. Whisper transcription will not work.")
    return None


def _patch_whisper_ffmpeg(ffmpeg_path: str):
    """
    Monkey-patches whisper.audio.load_audio to use the resolved ffmpeg binary
    instead of relying solely on PATH lookup. This is the most reliable approach
    since Whisper hardcodes 'ffmpeg' in its subprocess call.
    """
    try:
        import whisper.audio as wa
        from subprocess import run as _run, CalledProcessError
        import numpy as np

        SAMPLE_RATE = wa.SAMPLE_RATE

        def patched_load_audio(file: str, sr: int = SAMPLE_RATE):
            cmd = [
                ffmpeg_path,
                "-nostdin",
                "-threads", "0",
                "-i", file,
                "-f", "s16le",
                "-ac", "1",
                "-acodec", "pcm_s16le",
                "-ar", str(sr),
                "-"
            ]
            try:
                out = _run(cmd, capture_output=True, check=True).stdout
            except CalledProcessError as e:
                raise RuntimeError(f"Failed to load audio: {e.stderr.decode()}") from e
            return np.frombuffer(out, np.int16).flatten().astype(np.float32) / 32768.0

        wa.load_audio = patched_load_audio
        logger.info(f"Whisper audio patched to use ffmpeg at: {ffmpeg_path}")
    except Exception as e:
        logger.warning(f"Could not patch whisper.audio: {e}")


# Run ffmpeg setup at module load time
_ffmpeg_resolved = _resolve_ffmpeg()
if _ffmpeg_resolved:
    _patch_whisper_ffmpeg(_ffmpeg_resolved)


def get_whisper_model():
    """
    Lazy loads the OpenAI Whisper model (cached in memory across requests).
    Returns None if loading fails.
    """
    global _whisper_model
    if _whisper_model is None:
        try:
            import whisper
            model_name = getattr(settings, 'WHISPER_MODEL', 'base')
            logger.info(f"Loading OpenAI Whisper model '{model_name}'...")
            _whisper_model = whisper.load_model(model_name)
            logger.info("Whisper model loaded successfully.")
        except Exception as e:
            logger.warning(f"Could not load Whisper model: {e}")
            _whisper_model = None
    return _whisper_model


def transcribe_audio_file(uploaded_file) -> dict:
    """
    Saves an uploaded audio file, transcribes English speech using Whisper,
    and removes the temporary file immediately after processing.

    Returns:
        dict with keys: success (bool), text (str), language (str),
                        error (str on failure), fallback (bool if whisper unavailable)
    """
    temp_dir = Path(settings.AUDIO_TEMP_DIR)
    temp_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(uploaded_file.name).suffix or '.webm'
    temp_filename = f"rec_{uuid.uuid4().hex[:12]}{ext}"
    temp_path = temp_dir / temp_filename

    try:
        # Write incoming audio to temporary file
        with open(temp_path, 'wb+') as destination:
            for chunk in uploaded_file.chunks():
                destination.write(chunk)

        file_size = temp_path.stat().st_size
        if file_size < 1000:
            return {
                "success": False,
                "error": "Audio recording is too short or empty. Please speak for at least 1 second.",
                "text": "",
                "language": "en"
            }

        model = get_whisper_model()
        if model is None:
            return {
                "success": False,
                "error": "Whisper STT engine is not available. Using browser speech recognition as fallback.",
                "text": "",
                "fallback": True
            }

        # Transcribe with English language explicitly enforced
        result = model.transcribe(
            str(temp_path),
            language=getattr(settings, 'TTS_LANGUAGE', 'en'),
            task='transcribe',
            fp16=False,
            verbose=False
        )

        transcript = result.get('text', '').strip()
        detected_lang = result.get('language', 'en')

        if not transcript:
            return {
                "success": False,
                "error": "No speech detected. Please speak clearly and try again.",
                "text": "",
                "language": detected_lang
            }

        logger.info(f"Transcribed [{detected_lang}]: {transcript[:80]}...")
        return {
            "success": True,
            "text": transcript,
            "language": detected_lang
        }

    except Exception as e:
        err_str = str(e)
        logger.error(f"Transcription error: {err_str}")
        # If ffmpeg error, signal browser fallback
        if 'ffmpeg' in err_str.lower() or 'Failed to load audio' in err_str:
            return {
                "success": False,
                "error": f"Audio processing error (ffmpeg): {err_str}",
                "text": "",
                "fallback": True
            }
        return {
            "success": False,
            "error": err_str,
            "text": ""
        }
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass
