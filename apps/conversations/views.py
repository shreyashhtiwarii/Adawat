from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from .models import Conversation, Message
from .serializers import ConversationSerializer, MessageSerializer

class ConversationListCreateAPIView(APIView):
    def get(self, request):
        conversations = Conversation.objects.all().order_by('-updated_at')
        serializer = ConversationSerializer(conversations, many=True)
        return Response(serializer.data)

    def post(self, request):
        title = request.data.get('title', 'New Conversation').strip() or 'New Conversation'
        conversation = Conversation.objects.create(title=title)
        serializer = ConversationSerializer(conversation)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ConversationDetailAPIView(APIView):
    def get(self, request, pk):
        try:
            conversation = Conversation.objects.prefetch_related('messages').get(pk=pk)
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)
        serializer = ConversationSerializer(conversation)
        return Response(serializer.data)

    def delete(self, request, pk):
        try:
            conversation = Conversation.objects.get(pk=pk)
            conversation.delete()
            return Response({'message': 'Conversation deleted successfully'}, status=status.HTTP_200_OK)
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)

    def patch(self, request, pk):
        try:
            conversation = Conversation.objects.get(pk=pk)
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)
        title = request.data.get('title', '').strip()
        if title:
            conversation.title = title
            conversation.save(update_fields=['title'])
        serializer = ConversationSerializer(conversation)
        return Response(serializer.data)


class ClearAllConversationsAPIView(APIView):
    def post(self, request):
        count = Conversation.objects.count()
        Conversation.objects.all().delete()
        return Response({'message': f'Cleared {count} conversations successfully'}, status=status.HTTP_200_OK)


class ExportConversationAPIView(APIView):
    def get(self, request, pk):
        try:
            conversation = Conversation.objects.prefetch_related('messages').get(pk=pk)
        except Conversation.DoesNotExist:
            return Response({'error': 'Conversation not found'}, status=status.HTTP_404_NOT_FOUND)

        export_type = request.query_params.get('export_type', '').lower() or request.query_params.get('type', '').lower() or 'text'
        if export_type in ('txt', 'text'):
            from django.http import HttpResponse
            lines = [
                f"Assistant Conversation: {conversation.title}",
                f"Exported Date: {conversation.updated_at.strftime('%Y-%m-%d %H:%M:%S UTC')}",
                "=" * 60,
                ""
            ]
            for m in conversation.messages.all():
                role_label = "USER" if m.role == 'user' else "ASSISTANT"
                time_str = m.created_at.strftime("%H:%M:%S")
                lines.append(f"[{time_str}] {role_label}:")
                lines.append(f"  {m.content}")
                lines.append("")
            
            resp = HttpResponse("\n".join(lines), content_type='text/plain; charset=utf-8')
            resp['Content-Disposition'] = f'attachment; filename="conversation_{conversation.id}.txt"'
            return resp

        serializer = ConversationSerializer(conversation)
        return Response(serializer.data, status=status.HTTP_200_OK)

