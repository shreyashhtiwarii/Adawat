from django.urls import path
from .views import ChatAPIView, RAGSearchAPIView, RAGStatsAPIView

urlpatterns = [
    path('chat/', ChatAPIView.as_view(), name='rag_chat'),
    path('search/', RAGSearchAPIView.as_view(), name='rag_search'),
    path('stats/', RAGStatsAPIView.as_view(), name='rag_stats'),
]
