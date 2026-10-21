from django.urls import path
from .views import (
    ConversationListCreateAPIView,
    ConversationDetailAPIView,
    ClearAllConversationsAPIView,
    ExportConversationAPIView
)

urlpatterns = [
    path('', ConversationListCreateAPIView.as_view(), name='conversation_list_create'),
    path('clear/', ClearAllConversationsAPIView.as_view(), name='conversation_clear_all'),
    path('<int:pk>/', ConversationDetailAPIView.as_view(), name='conversation_detail'),
    path('<int:pk>/export/', ExportConversationAPIView.as_view(), name='conversation_export'),
]

