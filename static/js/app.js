/**
 * AI Voice & Text Assistant with RAG - Frontend Client
 * Handles Text-to-Text (TTT), Speech-to-Text (STT with Whisper + Browser fallback),
 * Text-to-Speech (TTS with gTTS), pgvector memory inspection,
 * and real-time audio waveform visualization.
 */

document.addEventListener('DOMContentLoaded', () => {
    // =========================================================================
    // State
    // =========================================================================
    let currentConversationId = null;
    let isRecording = false;
    let mediaRecorder = null;
    let audioChunks = [];
    let recordStartTime = null;
    let recordTimerInterval = null;
    let audioContext = null;
    let analyserNode = null;
    let waveformAnimId = null;
    let recognition = null;       // Browser Web Speech API instance
    let isProcessing = false;     // Prevent duplicate submissions
    let isRecordingCancelled = false;

    // =========================================================================
    // DOM Elements
    // =========================================================================
    const messagesContainer = document.getElementById('messagesContainer');
    const welcomeCard = document.getElementById('welcomeCard');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');

    const singleChatBtn = document.getElementById('singleChatBtn');
    const micStateIcon = document.getElementById('micStateIcon');
    const stopStateIcon = document.getElementById('stopStateIcon');
    const spinnerStateIcon = document.getElementById('spinnerStateIcon');
    const btnMainTitle = document.getElementById('btnMainTitle');
    const btnSubTitle = document.getElementById('btnSubTitle');

    const textModeToggleBtn = document.getElementById('textModeToggleBtn');
    const textPopupDrawer = document.getElementById('textPopupDrawer');
    const closeTextDrawerBtn = document.getElementById('closeTextDrawerBtn');

    const recordingBar = document.getElementById('recordingBar');
    const recordingTimer = document.getElementById('recordingTimer');
    const cancelRecBtn = document.getElementById('cancelRecBtn');
    const waveformCanvas = document.getElementById('waveformCanvas');
    const conversationsList = document.getElementById('conversationsList');
    const newChatBtn = document.getElementById('newChatBtn');
    const clearAllChatsBtn = document.getElementById('clearAllChatsBtn');
    const currentChatTitle = document.getElementById('currentChatTitle');
    const globalAudioPlayer = document.getElementById('globalAudioPlayer');
    const settingAutoplay = document.getElementById('settingAutoplay');
    const settingSttMode = document.getElementById('settingSttMode');
    const exportChatBtn = document.getElementById('exportChatBtn');

    const ragInspectorBtn = document.getElementById('ragInspectorBtn');
    const ragModal = document.getElementById('ragModal');
    const closeRagModalBtn = document.getElementById('closeRagModalBtn');
    const ragSearchInput = document.getElementById('ragSearchInput');
    const execRagSearchBtn = document.getElementById('execRagSearchBtn');
    const ragResultsContainer = document.getElementById('ragResultsContainer');

    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsModalBtn = document.getElementById('closeSettingsModalBtn');

    const sidebar = document.getElementById('sidebar');
    const openSidebarBtn = document.getElementById('openSidebarBtn');
    const closeSidebarBtn = document.getElementById('closeSidebarBtn');

    const sysLlm = document.getElementById('sysLlm');
    const sysDb = document.getElementById('sysDb');

    // =========================================================================
    // Initialization
    // =========================================================================
    loadSystemStats();
    loadConversations();
    setupTextareaAutoresize();
    initBrowserSpeechRecognition();

    // =========================================================================
    // Text Mode Drawer
    // =========================================================================
    if (textModeToggleBtn && textPopupDrawer) {
        textModeToggleBtn.addEventListener('click', () => {
            const isHidden = textPopupDrawer.style.display === 'none' || !textPopupDrawer.style.display;
            textPopupDrawer.style.display = isHidden ? 'block' : 'none';
            if (isHidden && messageInput) messageInput.focus();
        });
    }

    if (closeTextDrawerBtn && textPopupDrawer) {
        closeTextDrawerBtn.addEventListener('click', () => {
            textPopupDrawer.style.display = 'none';
        });
    }

    function setupTextareaAutoresize() {
        if (!messageInput) return;
        messageInput.addEventListener('input', () => {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
            if (sendBtn) sendBtn.disabled = !messageInput.value.trim();
        });
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
    }

    if (sendBtn) {
        sendBtn.addEventListener('click', () => sendMessage());
    }

    // =========================================================================
    // Core Chat API — Text-to-Text (TTT) + RAG
    // =========================================================================
    async function sendMessage(textToSend = null) {
        const text = (textToSend || (messageInput ? messageInput.value : '')).trim();
        if (!text || isProcessing) return;

        isProcessing = true;

        // Clear input
        if (messageInput) {
            messageInput.value = '';
            messageInput.style.height = 'auto';
        }
        if (sendBtn) sendBtn.disabled = true;
        if (textPopupDrawer) textPopupDrawer.style.display = 'none';
        if (welcomeCard) welcomeCard.style.display = 'none';

        setThinkingUI(true);
        appendMessageRow('user', text);
        const typingIndicator = appendTypingIndicator();
        scrollToBottom();

        try {
            const resp = await fetch('/api/rag/chat/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    conversation_id: currentConversationId,
                    generate_speech: true
                })
            });

            const data = await resp.json();
            typingIndicator.remove();
            setThinkingUI(false);

            if (!resp.ok) {
                const errMsg = data.error || 'Failed to process request. Please try again.';
                appendMessageRow('assistant', `⚠️ ${errMsg}`);
                isProcessing = false;
                return;
            }

            // Update conversation state
            if (!currentConversationId && data.conversation_id) {
                currentConversationId = data.conversation_id;
                if (currentChatTitle) currentChatTitle.textContent = data.conversation_title || 'Active Conversation';
                loadConversations();
            }
            updateExportButtonVisibility();

            const assistantMsg = data.assistant_message;
            appendMessageRow(
                'assistant',
                assistantMsg.content,
                assistantMsg.audio_url,
                data.retrieved_context,
                data.timing
            );

            // Auto-play TTS
            if (settingAutoplay && settingAutoplay.checked && assistantMsg.audio_url) {
                playAudio(assistantMsg.audio_url);
            }

        } catch (err) {
            console.error('Chat API error:', err);
            typingIndicator.remove();
            setThinkingUI(false);
            appendMessageRow('assistant', `⚠️ Connection error: ${err.message}. Is the Django server running?`);
        }

        isProcessing = false;
        scrollToBottom();
    }

    // =========================================================================
    // Single Button — Voice Interaction Hub
    // =========================================================================
    if (singleChatBtn) {
        singleChatBtn.addEventListener('click', handleSingleButtonClick);
    }

    if (cancelRecBtn) {
        cancelRecBtn.addEventListener('click', () => stopVoiceRecording(true));
    }

    function handleSingleButtonClick() {
        // If audio playing → stop it
        if (globalAudioPlayer && !globalAudioPlayer.paused) {
            globalAudioPlayer.pause();
            globalAudioPlayer.currentTime = 0;
            setSpeakingUI(false);
            return;
        }
        // If processing → do nothing
        if (isProcessing) return;
        // Toggle recording
        if (isRecording) {
            stopVoiceRecording(false);
        } else {
            startVoiceRecording();
        }
    }

    // =========================================================================
    // Voice Recording — MediaRecorder (primary) with Browser STT fallback
    // =========================================================================
    async function startVoiceRecording() {
        const mode = settingSttMode ? settingSttMode.value : 'whisper';

        // Browser STT path (user explicitly chose it, or no MediaRecorder support)
        if (mode === 'browser') {
            startBrowserSpeechRecognition();
            return;
        }

        // Whisper path — requires mic + MediaRecorder
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showStatusMessage('Microphone not available in this browser. Switching to browser speech recognition.');
            startBrowserSpeechRecognition();
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    sampleRate: 16000,
                    echoCancellation: true,
                    noiseSuppression: true
                }
            });

            audioChunks = [];
            isRecordingCancelled = false;

            // Waveform visualizer
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            analyserNode = audioContext.createAnalyser();
            analyserNode.fftSize = 64;
            source.connect(analyserNode);

            // Pick best supported codec
            const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
            let mimeType = '';
            for (const t of preferredTypes) {
                if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
            }

            mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

            mediaRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.onstop = async () => {
                cancelAnimationFrame(waveformAnimId);
                stream.getTracks().forEach(t => t.stop());
                if (audioContext && audioContext.state !== 'closed') {
                    try { audioContext.close(); } catch (e) {}
                }

                if (!isRecordingCancelled && audioChunks.length > 0) {
                    const finalMime = mimeType || 'audio/webm';
                    const audioBlob = new Blob(audioChunks, { type: finalMime });
                    await processAudioWithWhisper(audioBlob, finalMime);
                } else if (isRecordingCancelled) {
                    updateRecordingUI(false);
                }
            };

            mediaRecorder.start(250); // Collect chunks every 250ms
            isRecording = true;
            updateRecordingUI(true);

            // Recording timer
            recordStartTime = Date.now();
            recordTimerInterval = setInterval(() => {
                const diff = Math.floor((Date.now() - recordStartTime) / 1000);
                const mins = String(Math.floor(diff / 60)).padStart(2, '0');
                const secs = String(diff % 60).padStart(2, '0');
                if (recordingTimer) recordingTimer.textContent = `${mins}:${secs}`;
                // Auto-stop at 60 seconds
                if (diff >= 60) stopVoiceRecording(false);
            }, 500);

            drawWaveform();

        } catch (err) {
            console.error('Microphone access error:', err);
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                showStatusMessage('Microphone permission denied. Please allow microphone access and try again.', 'error');
            } else {
                // Fallback to browser STT
                showStatusMessage('Mic unavailable. Switching to browser speech recognition...');
                setTimeout(() => startBrowserSpeechRecognition(), 500);
            }
        }
    }

    function stopVoiceRecording(cancelled = false) {
        if (!isRecording) return;
        isRecording = false;
        isRecordingCancelled = cancelled;
        clearInterval(recordTimerInterval);

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            try { mediaRecorder.stop(); } catch (e) {}
        }

        if (cancelled) {
            updateRecordingUI(false);
        }
        // If not cancelled, onstop handler will process the audio
    }

    // =========================================================================
    // Whisper Processing
    // =========================================================================
    async function processAudioWithWhisper(audioBlob, mimeType) {
        setThinkingUI(true);
        if (btnMainTitle) btnMainTitle.textContent = 'Transcribing with Whisper...';

        // Determine file extension from mime type
        let ext = 'webm';
        if (mimeType.includes('ogg')) ext = 'ogg';
        else if (mimeType.includes('mp4')) ext = 'mp4';

        const formData = new FormData();
        formData.append('audio', audioBlob, `recording.${ext}`);

        try {
            const resp = await fetch('/api/speech/stt/', {
                method: 'POST',
                body: formData
            });
            const data = await resp.json();

            if (resp.ok && data.text && data.text.trim()) {
                // Successfully transcribed — send as text message
                await sendMessage(data.text.trim());
            } else if (data.fallback) {
                // Whisper not available, try browser STT
                setThinkingUI(false);
                showStatusMessage('Whisper unavailable. Switching to browser speech recognition...');
                setTimeout(() => startBrowserSpeechRecognition(), 300);
            } else if (!data.text || !data.text.trim()) {
                // No speech detected
                setThinkingUI(false);
                showStatusMessage('No speech detected. Please speak clearly and try again.', 'warning');
                updateRecordingUI(false);
            } else {
                setThinkingUI(false);
                const errMsg = data.error || 'Transcription failed.';
                showStatusMessage(`STT Error: ${errMsg}`, 'error');
                updateRecordingUI(false);
            }
        } catch (err) {
            console.error('Whisper STT request failed:', err);
            setThinkingUI(false);
            // Network error fallback
            showStatusMessage('Server unreachable. Switching to browser speech recognition...');
            setTimeout(() => startBrowserSpeechRecognition(), 300);
        }
    }

    // =========================================================================
    // Browser Speech Recognition (Fallback / Alternative)
    // =========================================================================
    function initBrowserSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.info('Browser SpeechRecognition API not available. Using Whisper only.');
            return;
        }

        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;  // Show interim results
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        let interimTranscript = '';

        recognition.onstart = () => {
            isRecording = true;
            interimTranscript = '';
            updateRecordingUI(true);
            if (btnMainTitle) btnMainTitle.textContent = 'Listening... (speak now)';
        };

        recognition.onresult = (event) => {
            interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    finalTranscript += result[0].transcript;
                } else {
                    interimTranscript += result[0].transcript;
                }
            }

            // Show interim results in button
            if (interimTranscript && btnMainTitle) {
                btnMainTitle.textContent = `Heard: "${interimTranscript.substring(0, 40)}..."`;
            }

            if (finalTranscript.trim()) {
                isRecording = false;
                updateRecordingUI(false);
                sendMessage(finalTranscript.trim());
            }
        };

        recognition.onerror = (e) => {
            console.warn('Browser speech recognition error:', e.error);
            isRecording = false;
            updateRecordingUI(false);
            if (e.error === 'no-speech') {
                showStatusMessage('No speech detected. Please speak clearly and try again.', 'warning');
            } else if (e.error === 'not-allowed') {
                showStatusMessage('Microphone permission denied. Please allow access in browser settings.', 'error');
            } else if (e.error === 'network') {
                showStatusMessage('Network error with speech recognition. Please check your connection.', 'error');
            } else {
                showStatusMessage(`Speech recognition error: ${e.error}`, 'error');
            }
        };

        recognition.onend = () => {
            isRecording = false;
            updateRecordingUI(false);
        };
    }

    function startBrowserSpeechRecognition() {
        if (!recognition) {
            showStatusMessage('Browser speech recognition not supported. Use Chrome or Edge browser.', 'error');
            return;
        }

        if (isRecording) return; // Already running

        try {
            recognition.start();
        } catch (e) {
            // Handle "already started" error gracefully
            if (e.name !== 'InvalidStateError') {
                console.error('Error starting browser recognition:', e);
                showStatusMessage(`Could not start voice recognition: ${e.message}`, 'error');
            }
        }
    }

    // =========================================================================
    // UI State Functions
    // =========================================================================
    function updateRecordingUI(active) {
        if (!singleChatBtn) return;
        if (active) {
            singleChatBtn.classList.add('recording');
            singleChatBtn.classList.remove('thinking', 'speaking');
            if (micStateIcon) micStateIcon.style.display = 'none';
            if (stopStateIcon) stopStateIcon.style.display = 'block';
            if (spinnerStateIcon) spinnerStateIcon.style.display = 'none';
            if (btnMainTitle) btnMainTitle.textContent = 'Listening... Tap to send';
            if (btnSubTitle) btnSubTitle.textContent = 'Recording English voice — speak clearly';
            if (recordingBar) recordingBar.style.display = 'flex';
            if (recordingTimer) recordingTimer.textContent = '00:00';
        } else {
            singleChatBtn.classList.remove('recording', 'thinking', 'speaking');
            if (micStateIcon) micStateIcon.style.display = 'block';
            if (stopStateIcon) stopStateIcon.style.display = 'none';
            if (spinnerStateIcon) spinnerStateIcon.style.display = 'none';
            if (btnMainTitle) btnMainTitle.textContent = 'Tap to Speak';
            if (btnSubTitle) btnSubTitle.textContent = 'Voice & RAG Assistant \u2022 English Only';
            if (recordingBar) recordingBar.style.display = 'none';
        }
    }

    function setThinkingUI(active) {
        if (!singleChatBtn) return;
        if (active) {
            singleChatBtn.classList.remove('recording', 'speaking');
            singleChatBtn.classList.add('thinking');
            if (micStateIcon) micStateIcon.style.display = 'none';
            if (stopStateIcon) stopStateIcon.style.display = 'none';
            if (spinnerStateIcon) spinnerStateIcon.style.display = 'block';
            if (btnMainTitle) btnMainTitle.textContent = 'Thinking & Retrieving...';
            if (btnSubTitle) btnSubTitle.textContent = 'Querying pgvector & synthesizing response';
        } else {
            singleChatBtn.classList.remove('thinking');
            updateRecordingUI(false);
        }
    }

    function setSpeakingUI(active) {
        if (!singleChatBtn) return;
        if (active) {
            singleChatBtn.classList.remove('recording', 'thinking');
            singleChatBtn.classList.add('speaking');
            if (micStateIcon) micStateIcon.style.display = 'none';
            if (stopStateIcon) stopStateIcon.style.display = 'none';
            if (spinnerStateIcon) spinnerStateIcon.style.display = 'none';
            if (btnMainTitle) btnMainTitle.textContent = 'Speaking... Tap to stop';
            if (btnSubTitle) btnSubTitle.textContent = 'English audio via gTTS — tap button to stop';
        } else {
            singleChatBtn.classList.remove('speaking');
            updateRecordingUI(false);
        }
    }

    function showStatusMessage(msg, type = 'info') {
        // Brief status shown in button subtitle
        if (btnSubTitle) {
            const originalText = btnSubTitle.textContent;
            const icons = { info: 'ℹ️', warning: '⚠️', error: '❌' };
            btnSubTitle.textContent = `${icons[type] || ''} ${msg}`;
            btnSubTitle.style.color = type === 'error' ? '#f43f5e' : type === 'warning' ? '#f59e0b' : '#a5f3fc';
            setTimeout(() => {
                btnSubTitle.textContent = originalText;
                btnSubTitle.style.color = '';
            }, 4000);
        }
        console.warn(`[${type.toUpperCase()}] ${msg}`);
    }

    // =========================================================================
    // Waveform Visualizer
    // =========================================================================
    function drawWaveform() {
        if (!analyserNode || !waveformCanvas) return;
        const ctx = waveformCanvas.getContext('2d');
        const bufferLength = analyserNode.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const draw = () => {
            if (!isRecording) {
                ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
                return;
            }
            waveformAnimId = requestAnimationFrame(draw);
            analyserNode.getByteFrequencyData(dataArray);
            ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);

            const barWidth = (waveformCanvas.width / bufferLength) * 2;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const barHeight = (dataArray[i] / 255) * waveformCanvas.height;
                const gradient = ctx.createLinearGradient(0, 0, 0, waveformCanvas.height);
                gradient.addColorStop(0, '#f43f5e');
                gradient.addColorStop(1, '#6366f1');
                ctx.fillStyle = gradient;
                ctx.fillRect(x, (waveformCanvas.height - barHeight) / 2, barWidth - 1, barHeight);
                x += barWidth;
            }
        };
        draw();
    }

    // =========================================================================
    // Text-to-Speech (TTS) with gTTS
    // =========================================================================
    async function playAudio(url) {
        if (!url || !globalAudioPlayer) return;
        setSpeakingUI(true);

        // Stop any currently playing audio first
        if (!globalAudioPlayer.paused) {
            globalAudioPlayer.pause();
            globalAudioPlayer.currentTime = 0;
        }

        globalAudioPlayer.src = url;
        globalAudioPlayer.load();

        try {
            await globalAudioPlayer.play();
        } catch (e) {
            console.warn('Audio autoplay prevented:', e.message);
            setSpeakingUI(false);
            showStatusMessage('Click the button below to hear the response', 'info');
        }

        globalAudioPlayer.onended = () => setSpeakingUI(false);
        globalAudioPlayer.onerror = (e) => {
            console.error('Audio playback error:', e);
            setSpeakingUI(false);
        };
    }

    async function speakText(text, playBtnElement = null) {
        if (!text) return;
        if (playBtnElement) {
            playBtnElement.classList.add('playing');
            playBtnElement.innerHTML = `<span>Synthesizing...</span>`;
        }

        try {
            const resp = await fetch('/api/speech/tts/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text })
            });
            const data = await resp.json();

            if (resp.ok && data.audio_url) {
                if (playBtnElement) playBtnElement.innerHTML = `<span>Playing...</span>`;
                await playAudio(data.audio_url);

                globalAudioPlayer.onended = () => {
                    setSpeakingUI(false);
                    if (playBtnElement) {
                        playBtnElement.classList.remove('playing');
                        playBtnElement.innerHTML = `
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                            </svg><span>Listen</span>`;
                    }
                };
            } else {
                throw new Error(data.error || 'TTS failed');
            }
        } catch (err) {
            console.error('TTS error:', err);
            if (playBtnElement) {
                playBtnElement.classList.remove('playing');
                playBtnElement.innerHTML = `<span>Listen</span>`;
            }
            showStatusMessage('Could not generate audio. Check server logs.', 'error');
        }
    }

    // =========================================================================
    // UI Helpers: Message Rendering
    // =========================================================================
    function appendMessageRow(role, content, audioUrl = null, retrievedContext = null, timing = null) {
        const row = document.createElement('div');
        row.className = `msg-row ${role}`;

        const avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        avatar.innerHTML = role === 'assistant'
            ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a8 8 0 0 0-8 8c0 3.36 2.07 6.24 5 7.42V20a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2.58A8.004 8.004 0 0 0 12 2Z"></path></svg>`
            : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>`;

        const body = document.createElement('div');
        body.className = 'msg-body';

        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble';
        bubble.textContent = content;

        if (role === 'assistant') {
            const controls = document.createElement('div');
            controls.className = 'msg-audio-controls';

            // Listen button
            const listenBtn = document.createElement('button');
            listenBtn.className = 'play-voice-btn';
            listenBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                </svg><span>Listen</span>`;

            listenBtn.addEventListener('click', () => {
                if (audioUrl) {
                    playAudio(audioUrl);
                } else {
                    speakText(content, listenBtn);
                }
            });
            controls.appendChild(listenBtn);

            // RAG context pill
            if (retrievedContext && retrievedContext.length > 0) {
                const ragPill = document.createElement('button');
                ragPill.className = 'rag-tag';
                ragPill.innerHTML = `<span>🧠 ${retrievedContext.length} Memory Sources</span>`;
                ragPill.title = 'Toggle retrieved pgvector context';

                const accordion = document.createElement('div');
                accordion.className = 'rag-accordion';
                accordion.style.display = 'none';

                let snippetsHtml = `<div class="rag-accordion-header"><span>Retrieved Context (pgvector)</span><span>${retrievedContext.length} matches</span></div>`;
                retrievedContext.forEach(c => {
                    const pct = Math.round(c.score * 100);
                    snippetsHtml += `
                        <div class="rag-snippet">
                            <span class="rag-score">${pct}% match</span>
                            <strong>${escapeHtml(c.conversation_title || 'Past Chat')} (${c.role}):</strong>
                            <p>${escapeHtml(c.content.substring(0, 150))}${c.content.length > 150 ? '...' : ''}</p>
                        </div>`;
                });
                accordion.innerHTML = snippetsHtml;

                ragPill.addEventListener('click', () => {
                    accordion.style.display = accordion.style.display === 'none' ? 'block' : 'none';
                });

                controls.appendChild(ragPill);
                bubble.appendChild(controls);
                bubble.appendChild(accordion);
            } else {
                bubble.appendChild(controls);
            }

            // Copy button
            const copyBtn = document.createElement('button');
            copyBtn.className = 'copy-btn';
            copyBtn.title = 'Copy text';
            copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(content).catch(() => {});
                copyBtn.innerHTML = '✓';
                setTimeout(() => {
                    copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
                }, 1500);
            });
            controls.appendChild(copyBtn);
        }

        const meta = document.createElement('div');
        meta.className = 'msg-meta';
        const now = new Date();
        meta.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        if (timing && timing.total_latency) {
            meta.textContent += ` • ${timing.total_latency}s`;
        }

        body.appendChild(bubble);
        body.appendChild(meta);
        row.appendChild(avatar);
        row.appendChild(body);
        messagesContainer.appendChild(row);

        // Scroll after appending
        scrollToBottom();
        return row;
    }

    function appendTypingIndicator() {
        const row = document.createElement('div');
        row.className = 'msg-row assistant typing-row';
        row.innerHTML = `
            <div class="msg-avatar">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 2a8 8 0 0 0-8 8c0 3.36 2.07 6.24 5 7.42V20a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2.58A8.004 8.004 0 0 0 12 2Z"></path>
                </svg>
            </div>
            <div class="msg-body">
                <div class="msg-bubble">
                    <div class="typing-dots">
                        <span class="typing-dot"></span>
                        <span class="typing-dot"></span>
                        <span class="typing-dot"></span>
                    </div>
                </div>
            </div>`;
        messagesContainer.appendChild(row);
        scrollToBottom();
        return row;
    }

    function scrollToBottom() {
        const viewport = document.getElementById('chatViewport');
        if (viewport) {
            requestAnimationFrame(() => {
                viewport.scrollTop = viewport.scrollHeight;
            });
        }
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =========================================================================
    // Conversation Management
    // =========================================================================
    async function loadConversations() {
        try {
            const resp = await fetch('/api/conversations/');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            renderConversationsList(data);
        } catch (err) {
            console.error('Failed to load conversations:', err);
            if (conversationsList) {
                conversationsList.innerHTML = `<div class="empty-hint">Could not load chats</div>`;
            }
        }
    }

    function renderConversationsList(conversations) {
        if (!conversationsList) return;
        if (!conversations || conversations.length === 0) {
            conversationsList.innerHTML = `<div class="empty-hint" style="padding:10px;font-size:0.8rem;color:var(--text-dim)">No previous chats yet</div>`;
            return;
        }

        conversationsList.innerHTML = '';
        conversations.forEach(c => {
            const item = document.createElement('div');
            item.className = `conv-item ${c.id === currentConversationId ? 'active' : ''}`;
            item.innerHTML = `
                <span class="conv-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title)}</span>
                <button class="conv-del-btn" title="Delete conversation" data-id="${c.id}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </button>`;

            item.addEventListener('click', (e) => {
                if (e.target.closest('.conv-del-btn')) return;
                switchConversation(c.id);
            });

            const delBtn = item.querySelector('.conv-del-btn');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteConversation(c.id);
                });
            }

            conversationsList.appendChild(item);
        });
    }

    async function switchConversation(id) {
        currentConversationId = id;
        try {
            const resp = await fetch(`/api/conversations/${id}/`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (currentChatTitle) currentChatTitle.textContent = data.title;
            if (welcomeCard) welcomeCard.style.display = 'none';
            messagesContainer.innerHTML = '';

            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(m => appendMessageRow(m.role, m.content, m.audio_url));
            } else {
                if (welcomeCard) {
                    messagesContainer.appendChild(welcomeCard);
                    welcomeCard.style.display = 'block';
                }
            }

            loadConversations();
            updateExportButtonVisibility();
            scrollToBottom();
        } catch (e) {
            console.error('Error switching conversation:', e);
        }
    }

    async function deleteConversation(id) {
        if (!confirm('Delete this conversation?')) return;
        try {
            await fetch(`/api/conversations/${id}/`, { method: 'DELETE' });
            if (currentConversationId === id) {
                newConversation();
            } else {
                loadConversations();
            }
        } catch (e) {
            console.error('Delete error:', e);
        }
    }

    if (newChatBtn) {
        newChatBtn.addEventListener('click', newConversation);
    }

    function newConversation() {
        currentConversationId = null;
        if (currentChatTitle) currentChatTitle.textContent = 'AI Voice & Text Assistant';
        messagesContainer.innerHTML = '';
        if (welcomeCard) {
            messagesContainer.appendChild(welcomeCard);
            welcomeCard.style.display = 'block';
        }
        updateExportButtonVisibility();
        loadConversations();
    }

    if (clearAllChatsBtn) {
        clearAllChatsBtn.addEventListener('click', async () => {
            if (!confirm('Clear all conversation history?')) return;
            try {
                await fetch('/api/conversations/clear/', { method: 'POST' });
                newConversation();
            } catch (e) {
                console.error('Clear chats error:', e);
            }
        });
    }

    function updateExportButtonVisibility() {
        if (exportChatBtn) {
            exportChatBtn.style.display = currentConversationId ? 'inline-flex' : 'none';
        }
    }

    if (exportChatBtn) {
        exportChatBtn.addEventListener('click', () => {
            if (!currentConversationId) return;
            window.open(`/api/conversations/${currentConversationId}/export/?export_type=text`, '_blank');
        });
    }

    // =========================================================================
    // Semantic Memory Search Modal (pgvector inspector)
    // =========================================================================
    if (ragInspectorBtn) {
        ragInspectorBtn.addEventListener('click', () => {
            if (ragModal) ragModal.style.display = 'flex';
            if (ragSearchInput) ragSearchInput.focus();
        });
    }

    if (closeRagModalBtn) {
        closeRagModalBtn.addEventListener('click', () => {
            if (ragModal) ragModal.style.display = 'none';
        });
    }

    if (ragModal) {
        ragModal.addEventListener('click', (e) => {
            if (e.target === ragModal) ragModal.style.display = 'none';
        });
    }

    if (execRagSearchBtn) execRagSearchBtn.addEventListener('click', runRagSearch);
    if (ragSearchInput) {
        ragSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') runRagSearch();
        });
    }

    async function runRagSearch() {
        const q = ragSearchInput ? ragSearchInput.value.trim() : '';
        if (!q || !ragResultsContainer) return;

        ragResultsContainer.innerHTML = '<div class="empty-hint">Computing vector embeddings & querying pgvector...</div>';

        try {
            const resp = await fetch(`/api/rag/search/?q=${encodeURIComponent(q)}&top_k=6&threshold=0.15`);
            const data = await resp.json();

            if (!data.results || data.results.length === 0) {
                ragResultsContainer.innerHTML = '<div class="empty-hint">No semantically similar messages found above the threshold.</div>';
                return;
            }

            ragResultsContainer.innerHTML = '';
            data.results.forEach(r => {
                const card = document.createElement('div');
                card.className = 'rag-result-card';
                const pct = Math.round(r.score * 100);
                card.innerHTML = `
                    <div class="rag-result-header">
                        <span>${escapeHtml(r.conversation_title)} (${r.role})</span>
                        <span class="badge-en">${pct}% Similarity</span>
                    </div>
                    <div class="rag-result-body">${escapeHtml(r.content)}</div>`;
                ragResultsContainer.appendChild(card);
            });
        } catch (err) {
            if (ragResultsContainer) {
                ragResultsContainer.innerHTML = `<div class="empty-hint">Search error: ${err.message}</div>`;
            }
        }
    }

    // =========================================================================
    // Settings & Sidebar
    // =========================================================================
    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            if (settingsModal) settingsModal.style.display = 'flex';
        });
    }

    if (closeSettingsModalBtn) {
        closeSettingsModalBtn.addEventListener('click', () => {
            if (settingsModal) settingsModal.style.display = 'none';
        });
    }

    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            if (e.target === settingsModal) settingsModal.style.display = 'none';
        });
    }

    if (openSidebarBtn) {
        openSidebarBtn.addEventListener('click', () => {
            if (sidebar) sidebar.classList.toggle('open');
        });
    }

    if (closeSidebarBtn) {
        closeSidebarBtn.addEventListener('click', () => {
            if (sidebar) sidebar.classList.remove('open');
        });
    }

    // Welcome card feature shortcuts
    document.getElementById('featureTTT')?.addEventListener('click', () => {
        if (textPopupDrawer) textPopupDrawer.style.display = 'block';
        if (messageInput) messageInput.focus();
    });

    document.getElementById('featureSTT')?.addEventListener('click', () => {
        if (singleChatBtn) singleChatBtn.click();
    });

    document.getElementById('featureTTS')?.addEventListener('click', () => {
        speakText('Hello! This is a test of the English text-to-speech audio engine powered by Google gTTS.');
    });

    // =========================================================================
    // System Stats
    // =========================================================================
    async function loadSystemStats() {
        try {
            const resp = await fetch('/api/rag/stats/');
            if (!resp.ok) return;
            const data = await resp.json();
            if (sysLlm && data.llm_provider) {
                sysLlm.textContent = `${data.llm_provider} (${data.model_name})`;
            }
            if (sysDb && data.database_engine) {
                sysDb.textContent = data.database_engine.includes('postgres') ? 'PostgreSQL / pgvector' : 'SQLite / Vector';
            }
        } catch (e) {
            // Silently keep defaults
        }
    }
});
