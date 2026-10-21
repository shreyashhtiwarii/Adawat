from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.parsers import MultiPartParser, FormParser, JSONParser
from .stt import transcribe_audio_file
from .tts import generate_speech_audio

class SpeechToTextView(APIView):
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        audio_file = request.FILES.get('audio') or request.FILES.get('file')
        if not audio_file:
            return Response(
                {"error": "No audio file provided in request. Expected 'audio' multipart form field."},
                status=status.HTTP_400_BAD_REQUEST
            )

        result = transcribe_audio_file(audio_file)
        if not result.get("success"):
            return Response(
                {"error": result.get("error", "Transcription failed."), "text": ""},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY
            )

        return Response({
            "text": result.get("text", ""),
            "language": result.get("language", "en")
        }, status=status.HTTP_200_OK)


class TextToSpeechView(APIView):
    parser_classes = [JSONParser, FormParser]

    def post(self, request):
        text = request.data.get('text', '').strip()
        if not text:
            return Response(
                {"error": "Field 'text' is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            audio_url = generate_speech_audio(text, lang='en')
            return Response({
                "audio_url": audio_url,
                "text": text
            }, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {"error": f"Failed to synthesize audio: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
