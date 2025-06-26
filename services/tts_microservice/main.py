import os
import sys
import time
import warnings

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

app = FastAPI(
    title="The Magi TTS Microservice",
    description="Text-to-Speech service for The Magi AI system using OpenVoice",
    version="2.0.0"
)

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
    "Melchior": "demo_speaker1.mp3", # A different distinct voice
    "Caspar": "demo_speaker2.mp3"    # A third distinct voice
}

# Map persona names to voice files
VOICE_MAPPING = {
    'Caspar': os.path.join(BASE_DIR, 'demo', 'Male-MiddleAged_American.mp3'),
    'Melchior': os.path.join(BASE_DIR, 'demo', 'Female-Young-British.mp3'),
    'Balthazar': os.path.join(BASE_DIR, 'demo', 'Male-MiddleAged_American.mp3')  # Using same voice as fallback
}

# --- Startup Verification ---
# Verify that all required reference voice files exist before starting the server.
logging.info("Verifying existence of reference voice files...")
for persona, voice_file in PERSONA_VOICES.items():
    file_path = os.path.join(BASE_DIR, 'resources', voice_file)
    if not os.path.exists(file_path):
        logging.critical(f"CRITICAL ERROR: Reference voice file for persona '{persona}' not found at '{file_path}'.")
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
            target_se, _ = se_extractor.get_se(
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
            model.tts_to_file(request.text, speaker_id, base_speech_path, speed=1.0)
            logging.info("Successfully generated base speech")
        except Exception as tts_error:
            logging.error(f"Failed during base speech generation: {str(tts_error)}")
            raise

        # 4. Convert the voice
        final_speech_path = os.path.join(output_dir, f'final_{request.persona}_{int(time.time())}.wav')
        logging.info(f"Converting voice to final output: {final_speech_path}")
        try:
            tone_color_converter.convert(
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
        
        end_time = time.time()
        logging.info(f"Speech generated for {request.persona} in {end_time - start_time:.2f}s")
        
        # 5. Return the audio file
        try:
            with open(final_speech_path, "rb") as audio_file:
                audio_data = audio_file.read()
            logging.info("Successfully read final audio file")

            # Clean up temporary files
            os.remove(base_speech_path)
            os.remove(final_speech_path)
            logging.info("Cleaned up temporary files")

            return StreamingResponse(io.BytesIO(audio_data), media_type="audio/wav")
        except Exception as file_error:
            logging.error(f"Failed during file operations: {str(file_error)}")
            raise

    except Exception as e:
        logging.error(f"Error during speech synthesis for {request.persona}: {e}")
        logging.error(f"Error type: {type(e)}")
        logging.error(f"Error args: {e.args}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
async def root():
    return {
        "service": "The Magi TTS Microservice (OpenVoice)",
        "version": "2.0.0",
        "available_personas": list(PERSONA_VOICES.keys())
    }

if __name__ == '__main__':
    import uvicorn
    # The command in the PRD is 'bash -c "source venv/bin/activate && python main.py"'
    # This implies the file should be named main.py and exist at the root of the microservice.
    # We will rename this file later.
    uvicorn.run(app, host="0.0.0.0", port=8000)
