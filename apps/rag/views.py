from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.conf import settings
from apps.conversations.models import Conversation, Message
from .pipeline import run_rag_pipeline
from .retriever import retrieve_relevant_context

class ChatAPIView(APIView):
    def post(self, request):
        message = request.data.get('message', '').strip()
        if not message:
            return Response(
                {"error": "Message text is required."},
                status=status.HTTP_400_BAD_REQUEST
            )

        conversation_id = request.data.get('conversation_id')
        generate_speech = request.data.get('generate_speech', True)
        if isinstance(generate_speech, str):
            generate_speech = generate_speech.lower() in ('true', '1')

        try:
            result = run_rag_pipeline(
                user_text=message,
                conversation_id=conversation_id,
                generate_speech=generate_speech
            )
            return Response(result, status=status.HTTP_200_OK)
        except Exception as e:
            return Response(
                {"error": f"Failed to process chat: {str(e)}"},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )


class RAGSearchAPIView(APIView):
    def get(self, request):
        query = request.query_params.get('q', '').strip()
        if not query:
            return Response({"results": []})

        try:
            top_k = int(request.query_params.get('top_k', 5))
            threshold = float(request.query_params.get('threshold', 0.2))
        except ValueError:
            top_k = 5
            threshold = 0.2

        results = retrieve_relevant_context(
            query_text=query,
            top_k=top_k,
            threshold=threshold
        )
        return Response({"query": query, "count": len(results), "results": results})


class RAGStatsAPIView(APIView):
    def get(self, request):
        total_convs = Conversation.objects.count()
        total_msgs = Message.objects.count()
        embedded_msgs = Message.objects.exclude(embedding=None).count()

        return Response({
            "llm_provider": getattr(settings, 'LLM_PROVIDER', 'ollama'),
            "model_name": getattr(settings, 'OLLAMA_MODEL', 'llama3.2:1b'),
            "database_engine": settings.DATABASES['default']['ENGINE'].split('.')[-1],
            "total_conversations": total_convs,
            "total_messages": total_msgs,
            "embedded_messages": embedded_msgs,
            "embedding_dimension": getattr(settings, 'EMBEDDING_DIM', 384),
            "stt_engine": getattr(settings, 'STT_ENGINE', 'whisper'),
            "tts_language": getattr(settings, 'TTS_LANGUAGE', 'en'),
        })
