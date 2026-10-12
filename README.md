
flowchart TB
    USER([User])

    subgraph FRONTEND["Frontend Layer"]
        UI["Web Application"]
        BTN["Central Interaction Button"]
        MODE["Mode Selector: TTT / STT / TTS"]
        INPUT["Text Input and Response Display"]
        MIC["Microphone"]
        PLAYER["Audio Player"]
        UI --> BTN --> MODE
        UI --- INPUT
        UI --- MIC
        UI --- PLAYER
    end

    subgraph DJANGO["Django Application Layer"]
        API["Django REST Framework"]
        AUTH["Authentication and Authorization"]
        ROUTER["Mode Router"]
        CHAT["Conversation Service"]
        SPEECH["Speech Processing Service"]
        RAG["RAG Orchestrator"]
        API --> AUTH --> ROUTER
        ROUTER --> CHAT
        ROUTER --> SPEECH
        ROUTER --> RAG
    end

    subgraph SPEECHAI["Speech Processing"]
        WHISPER["OpenAI Whisper STT"]
        GTTS["gTTS Text-to-Speech"]
    end

    subgraph RAGAI["RAG and AI Layer"]
        EMB["Embedding Model"]
        RET["Semantic Retriever"]
        LLM["Language Model"]
        EMB --> RET --> LLM
    end

    subgraph STORAGE["Data Layer"]
        DB[("PostgreSQL")]
        VEC[("pgvector Embeddings")]
        MEDIA[("Audio File Storage")]
    end

    USER --> UI
    MODE --> API
    SPEECH --> WHISPER
    SPEECH --> GTTS
    RAG --> EMB
    RET <--> VEC
    CHAT <--> DB
    RAG --> DB
    SPEECH --> DB
    GTTS --> MEDIA
    WHISPER --> CHAT
    LLM --> CHAT
    API --> UI
    PLAYER --> UI

    classDef frontend fill:#e8f2ff,stroke:#2878c8,color:#163b65
    classDef backend fill:#e7f7ed,stroke:#21945a,color:#124b30
    classDef speech fill:#fce7f3,stroke:#db2777,color:#831843
    classDef rag fill:#fff1df,stroke:#ea8a18,color:#7c3d06
    classDef storage fill:#dff7fa,stroke:#0891b2,color:#164e63

    class UI,BTN,MODE,INPUT,MIC,PLAYER frontend
    class API,AUTH,ROUTER,CHAT,SPEECH,RAG backend
    class WHISPER,GTTS speech
    class EMB,RET,LLM rag
    class DB,VEC,MEDIA storage
