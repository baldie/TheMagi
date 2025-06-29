import os
import sys
import io
import asyncio
import logging
from contextlib import asynccontextmanager
from chatterbox.tts import ChatterboxTTS
import torch
import torchaudio

from fastapi import FastAPI, HTTPException
from starlette.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)

# --- Path Configuration ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# --- Persona Configuration ---
PERSONA_VOICES = {
    "Balthazar": "demo_speaker0.mp3",
    "Melchior": "demo_speaker1.mp3",
    "Caspar": "demo_speaker2.mp3"
}

VOICE_MAPPING = {
    persona: os.path.join(BASE_DIR, 'resources', voice_file)
    for persona, voice_file in PERSONA_VOICES.items()
}

# --- Global Model Holder ---
class ModelHolder:
    model: ChatterboxTTS | None = None

model_holder = ModelHolder()

# --- Model Loading and Lifespan Management ---
def load_chatterbox_model():
    logging.info(f"Loading Chatterbox TTS model on device: {DEVICE}...")
    try:
        model = ChatterboxTTS.from_pretrained(device=DEVICE)
        
        # Apply torch.compile() for potential speedup on compatible hardware/pytorch versions
        if DEVICE == "cuda" and sys.platform == "linux" and torch.__version__.startswith("2"):
            logging.info("Applying torch.compile() for performance optimization...")
            try:
                # 'reduce-overhead' is good for small inputs, which fits sentence-by-sentence generation.
                model = torch.compile(model, mode="reduce-overhead")  # type: ignore
                logging.info("torch.compile() applied successfully.")
            except Exception as e:
                logging.warning(f"Could not apply torch.compile(): {e}")
        else:
            logging.info("Skipping torch.compile() (requires Linux, CUDA, and PyTorch 2.0+).")

        model_holder.model = model
        logging.info("Chatterbox TTS model loaded successfully.")
    except Exception as e:
        logging.critical(f"Failed to load Chatterbox model: {e}", exc_info=True)
        sys.exit(1)

async def perform_self_test():
    logging.info("Performing TTS service self-test...")
    test_request = SpeechRequest(text="Speech Center ready", persona="Caspar")
    try:
        audio_stream = await synthesize_speech_stream(test_request)
        # Consume the stream to ensure it's valid
        async for chunk in audio_stream.body_iterator:
            if not chunk:
                raise ValueError("Received an empty chunk during self-test.")
        logging.info("Self-test completed successfully!")
        return True
    except Exception as e:
        logging.critical("Self-test failed!", exc_info=True)
        return False

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_chatterbox_model()
    if not await perform_self_test():
        logging.critical("TTS service self-test failed. Shutting down...")
        sys.exit(1)
    yield
    logging.info("Shutting down TTS service...")

# --- Pydantic Models ---
class SpeechRequest(BaseModel):
    text: str
    persona: str
    stream: bool = True # Keep the parameter for compatibility, but we always stream

# --- FastAPI App ---
app = FastAPI(
    title="The Magi TTS Microservice (Chatterbox Edition)",
    description="Text-to-Speech service for The Magi AI system using resemble-ai/chatterbox",
    version="3.0.0",
    lifespan=lifespan
)

# --- Audio Generation ---
async def generate_audio_chunks(text: str, audio_prompt_path: str):
    """
    Generates audio using Chatterbox and yields it in chunks.
    """
    model = model_holder.model
    if not model:
        raise RuntimeError("Chatterbox model is not loaded.")

    try:
        # Chatterbox generates a tensor.
        wav_tensor = await asyncio.to_thread(model.generate, text, audio_prompt_path=audio_prompt_path)
        
        # The output is a tensor of shape [1, N]. We need to convert it to a byte stream.
        # We'll save it to an in-memory buffer as a WAV file.
        buffer = io.BytesIO()
        torchaudio.save(buffer, wav_tensor, model.sr, format="wav")
        buffer.seek(0)
        
        # Stream the buffer in chunks
        while True:
            chunk = buffer.read(8192) # 8KB chunks
            if not chunk:
                break
            yield chunk

    except Exception as e:
        logging.error(f"Error during Chatterbox audio generation: {e}", exc_info=True)
        # Yield nothing if an error occurs. The client will receive an empty stream.
        return


# --- API Endpoints ---
@app.get("/health", status_code=200)
async def health_check():
    return JSONResponse(content={"status": "healthy"})

@app.post("/api/generate-speech")
async def synthesize_speech_stream(request: SpeechRequest):
    if request.persona not in PERSONA_VOICES:
        raise HTTPException(status_code=400, detail=f"Invalid persona: {request.persona}")
    
    audio_prompt_path = VOICE_MAPPING[request.persona]
    logging.info(f"Generating speech for '{request.persona}' with text: '{request.text[:50]}...'")
    
    try:
        # Create an async generator for the audio chunks
        chunk_generator = generate_audio_chunks(request.text, audio_prompt_path)
        
        # Return a streaming response
        return StreamingResponse(
            chunk_generator,
            media_type="audio/wav",
            headers={"Content-Disposition": f'inline; filename="speech.wav"'}
        )
    except Exception as e:
        logging.error(f"Failed to generate speech stream for persona {request.persona}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to generate speech.")

@app.get("/")
async def root():
    return {"message": "The Magi TTS Microservice with Chatterbox is running."}

if __name__ == '__main__':
    import uvicorn
    # The command in the PRD is 'bash -c "source venv/bin/activate && python main.py"'
    # This implies the file should be named main.py and exist at the root of the microservice.
    # We will rename this file later.
    uvicorn.run(app, host="0.0.0.0", port=8000)
