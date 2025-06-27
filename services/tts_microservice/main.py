import os
import sys
import time
import warnings
import asyncio
from contextlib import asynccontextmanager

# Suppress specific warnings from libraries to clean up startup logs
# 1. HuggingFace Hub: 'resume_download' is deprecated.
# 2. PyTorch: 'weight_norm' is deprecated.
warnings.filterwarnings("ignore", category=FutureWarning)
# 3. PyDub: 'ffmpeg' or 'avconv' not found. We can ignore this if we only use standard audio formats.
warnings.filterwarnings("ignore", category=RuntimeWarning)

# Add the 'openvoice' subdirectory to the Python path
# This must be done before the other imports
sys.path.append(os.path.join(os.path.dirname(__file__), 'openvoice'))

import torch
from melo.api import TTS
import se_extractor
import io
import logging

from fastapi import FastAPI, HTTPException
from starlette.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from api import ToneColorConverter

logging.basicConfig(level=logging.INFO)

# --- Path Configuration ---
# Get the absolute path to the directory where this script is located
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# --- Configuration ---
# Use absolute paths for all file/directory references to avoid CWD issues
ckpt_base = os.path.join(BASE_DIR, 'checkpoints_v2/base_speakers/ses')
device = "cuda:0" if torch.cuda.is_available() else "cpu"
output_dir = os.path.join(BASE_DIR, 'outputs')
os.makedirs(output_dir, exist_ok=True)

# Define the personas and their corresponding reference audio files.
# These files are expected to be in a 'resources' subdirectory.
PERSONA_VOICES = {
    "Balthazar": "demo_speaker0.mp3",  # A distinct voice
    "Melchior": "demo_speaker1.mp3",   # A different distinct voice
    "Caspar": "demo_speaker2.mp3"      # A third distinct voice
}

# Map persona names to voice files - using the same files from resources
VOICE_MAPPING = {
    persona: os.path.join(BASE_DIR, 'resources', voice_file)
    for persona, voice_file in PERSONA_VOICES.items()
}

# --- Startup Verification ---
# Verify that all required reference voice files exist before starting the server.
logging.info("Verifying existence of reference voice files...")
for persona, voice_path in VOICE_MAPPING.items():
    if not os.path.exists(voice_path):
        logging.critical(f"CRITICAL ERROR: Reference voice file for persona '{persona}' not found at '{voice_path}'.")
        logging.critical("The service cannot start without all required voice files.")
        sys.exit(1) # Exit with a non-zero status code to indicate failure
logging.info("... All reference voice files found.")

# --- Model Loading ---
try:
    # Tone Color Converter
    converter_config_path = os.path.join(BASE_DIR, 'checkpoints_v2/converter/config.json')
    converter_ckpt_path = os.path.join(BASE_DIR, 'checkpoints_v2/converter/checkpoint.pth')
    tone_color_converter = ToneColorConverter(converter_config_path, device=device)
    tone_color_converter.load_ckpt(converter_ckpt_path)

    # Base Speaker (we'll use the default for all personas)
    source_se_path = os.path.join(ckpt_base, 'en-default.pth')
    source_se = torch.load(source_se_path).to(device)

    # Base TTS model
    model = TTS(language='EN', device=device)
    speaker_id = model.hps.data.spk2id['EN-Default']

    logging.info("OpenVoice models loaded successfully.")

except Exception as e:
    logging.error(f"Failed to load models: {e}")
    # This will prevent the app from starting if models fail to load
    raise RuntimeError("Could not initialize OpenVoice models") from e

# --- Pydantic Models ---
class SpeechRequest(BaseModel):
    text: str
    persona: str

async def perform_self_test():
    """
    Performs a self-test of the TTS service by generating a test phrase.
    Raises an exception if the test fails.
    """
    logging.info("Performing TTS service self-test...")
    test_request = SpeechRequest(text="Speech Center ready", persona="Caspar")
    
    try:
        # Use the synthesize_speech endpoint directly
        await synthesize_speech(test_request)
        logging.info("Self-test completed successfully!")
        return True
    except Exception as e:
        logging.critical("Self-test failed!")
        logging.critical(f"Error details: {str(e)}")
        logging.critical("Stack trace:", exc_info=True)
        return False

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifecycle manager for the FastAPI application.
    Performs initialization and cleanup tasks.
    """
    # Perform startup tasks
    try:
        # Run self-test
        if not await perform_self_test():
            logging.critical("TTS service self-test failed. Shutting down...")
            sys.exit(1)
    except Exception as e:
        logging.critical(f"Fatal error during startup: {str(e)}")
        sys.exit(1)
    
    yield  # Service runs here
    
    # Perform cleanup tasks
    logging.info("Shutting down TTS service...")

# Create the FastAPI app AFTER defining lifespan
app = FastAPI(
    title="The Magi TTS Microservice",
    description="Text-to-Speech service for The Magi AI system using OpenVoice",
    version="2.0.0",
    lifespan=lifespan
)

# --- API Endpoints ---
@app.get("/health", status_code=200)
async def health_check():
    """Health check endpoint."""
    return JSONResponse(content={"status": "healthy"})

@app.post("/api/generate-speech")
async def synthesize_speech(request: SpeechRequest):
    """
    Synthesize speech from text using a specified Magi persona's voice.
    """
    start_time = time.time()
    
    # 1. Validate Persona
    if request.persona not in PERSONA_VOICES:
        raise HTTPException(status_code=400, detail=f"Invalid persona: {request.persona}. Available: {list(PERSONA_VOICES.keys())}")
    
    voice_filename = PERSONA_VOICES[request.persona]
    # Construct an absolute path to the reference file
    reference_speaker_path = VOICE_MAPPING.get(request.persona)
    if not reference_speaker_path:
        raise ValueError(f"No voice mapping found for persona: {request.persona}")
    
    if not os.path.exists(reference_speaker_path):
        raise FileNotFoundError(f"Reference speaker file not found: {reference_speaker_path}")
    
    logging.info(f"Using reference speaker file: {reference_speaker_path}")

    try:
        logging.info(f"Generating speech for {request.persona} using {voice_filename}")
        logging.info(f"File exists check passed for: {reference_speaker_path}")

        # 2. Get target tone color embedding
        processed_dir = os.path.join(BASE_DIR, 'processed')
        os.makedirs(processed_dir, exist_ok=True)
        logging.info(f"Using processed directory: {processed_dir}")

        # Create a unique directory for this persona's voice processing
        voice_hash = os.path.basename(reference_speaker_path).rsplit('.', 1)[0]
        voice_process_dir = os.path.join(processed_dir, voice_hash)
        os.makedirs(voice_process_dir, exist_ok=True)
        wavs_dir = os.path.join(voice_process_dir, 'wavs')
        os.makedirs(wavs_dir, exist_ok=True)
        
        logging.info(f"Voice processing directory: {voice_process_dir}")
        logging.info(f"Wavs directory: {wavs_dir}")
        
        try:
            # Run CPU-intensive operations in a thread pool
            target_se, _ = await asyncio.to_thread(
                se_extractor.get_se,
                audio_path=os.path.abspath(reference_speaker_path),
                vc_model=tone_color_converter,
                target_dir=os.path.abspath(processed_dir),
                vad=True
            )
            logging.info("Successfully extracted speaker embedding")
        except Exception as se_error:
            logging.error(f"Failed during speaker embedding extraction: {str(se_error)}")
            logging.error(f"Reference file absolute path: {os.path.abspath(reference_speaker_path)}")
            logging.error(f"Processed dir absolute path: {os.path.abspath(processed_dir)}")
            raise
        
        # 3. Generate the base audio
        base_speech_path = os.path.join(output_dir, f'base_{request.persona}_{int(time.time())}.wav')
        logging.info(f"Generating base speech to: {base_speech_path}")
        try:
            # Run CPU-intensive operations in a thread pool
            await asyncio.to_thread(
                model.tts_to_file,
                request.text,
                speaker_id,
                base_speech_path,
                speed=1.0
            )
            logging.info("Successfully generated base speech")
        except Exception as tts_error:
            logging.error(f"Failed during base speech generation: {str(tts_error)}")
            raise

        # 4. Convert the voice
        final_speech_path = os.path.join(output_dir, f'final_{request.persona}_{int(time.time())}.wav')
        logging.info(f"Converting voice to final output: {final_speech_path}")
        try:
            # Run CPU-intensive operations in a thread pool
            await asyncio.to_thread(
                tone_color_converter.convert,
                audio_src_path=base_speech_path,
                src_se=source_se,
                tgt_se=target_se,
                output_path=final_speech_path,
                message="@MyShell" # Watermark
            )
            logging.info("Successfully converted voice")
        except Exception as conv_error:
            logging.error(f"Failed during voice conversion: {str(conv_error)}")
            raise
        finally:
            # Clean up the intermediate base file immediately
            if os.path.exists(base_speech_path):
                os.remove(base_speech_path)
        
        end_time = time.time()
        logging.info(f"Speech generated for {request.persona} in {end_time - start_time:.2f}s")
        
        # 5. Return the audio file
        try:
            # Read file in chunks to avoid loading entire file into memory
            async def read_in_chunks(file_path, chunk_size=8192):
                with open(file_path, 'rb') as f:
                    while chunk := f.read(chunk_size):
                        yield chunk
            
            # Clean up temporary files after sending response
            response = StreamingResponse(
                read_in_chunks(final_speech_path),
                media_type="audio/wav"
            )
            
            # Schedule cleanup
            asyncio.create_task(asyncio.to_thread(cleanup_files, final_speech_path))
            
            return response
            
        except Exception as file_error:
            logging.error(f"Failed during file operations: {str(file_error)}")
            # Attempt cleanup even if response fails
            try:
                os.remove(final_speech_path)
            except:
                pass
            raise

    except Exception as e:
        logging.error(f"Error during speech synthesis for {request.persona}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

async def cleanup_files(*files_to_delete):
    for f in files_to_delete:
        try:
            if os.path.exists(f):
                os.remove(f)
                logging.info(f"Cleaned up temporary file: {f}")
        except Exception as e:
            logging.warning(f"Failed to clean up temporary file {f}: {e}")

@app.get("/")
async def root():
    return {
        "service": "The Magi TTS Microservice (OpenVoice)",
        "version": "2.0.0",
        "available_personas": list(PERSONA_VOICES.keys())
    }

@app.on_event("startup")
async def startup_event():
    # Perform startup tasks
    try:
        # Run self-test
        if not await perform_self_test():
            logging.critical("TTS service self-test failed. Shutting down...")
            sys.exit(1)
    except Exception as e:
        logging.critical(f"Fatal error during startup: {str(e)}")
        sys.exit(1)

if __name__ == '__main__':
    import uvicorn
    # The command in the PRD is 'bash -c "source venv/bin/activate && python main.py"'
    # This implies the file should be named main.py and exist at the root of the microservice.
    # We will rename this file later.
    uvicorn.run(app, host="0.0.0.0", port=8000)
