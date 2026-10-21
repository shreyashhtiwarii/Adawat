from django.urls import path
from .views import SpeechToTextView, TextToSpeechView

urlpatterns = [
    path('stt/', SpeechToTextView.as_view(), name='speech_to_text'),
    path('tts/', TextToSpeechView.as_view(), name='text_to_speech'),
]
