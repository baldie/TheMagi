import os
import sys
import logging
import traceback
from datetime import datetime
import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import tempfile
import uuid
import tqdm

# Suppress progress bars and verbose outputs
os.environ["TQDM_DISABLE"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"


# Monkey patch tqdm to redirect to null
class NullTqdm:
    def __init__(self, *args, **kwargs):
        self.iterable = args[0] if args else None

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def __iter__(self):
        return iter(self.iterable) if self.iterable is not None else iter([])

    def update(self, *args, **kwargs):
        pass

    def set_postfix(self, *args, **kwargs):
        pass

    def close(self):
        pass


# Override tqdm completely
tqdm.tqdm = NullTqdm

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("tts_service.log", mode="a"),
    ],
)

# Suppress noisy loggers
logging.getLogger("numba").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("transformers").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)

# Log startup information
logger.info("=" * 60)
logger.info("TTS Service Starting Up")
logger.info(f"Timestamp: {datetime.now()}")
logger.info(f"Python version: {sys.version}")
logger.info(f"Working directory: {os.getcwd()}")
logger.info(f"Temp directory: {tempfile.gettempdir()}")
logger.info("=" * 60)

# Check PyTorch installation
try:
    logger.info(f"PyTorch version: {torch.__version__}")
    logger.info(f"CUDA available: {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        logger.info(f"CUDA devices: {torch.cuda.device_count()}")
        for i in range(torch.cuda.device_count()):
            logger.info(f"  Device {i}: {torch.cuda.get_device_name(i)}")
    else:
        logger.info("CUDA not available - will use CPU")
except Exception as e:
    logger.error(f"Error checking PyTorch: {e}")

# Import Chatterbox TTS with detailed error reporting
try:
    logger.info("Attempting to import Chatterbox TTS...")
    from chatterbox.tts import ChatterboxTTS

    CHATTERBOX_AVAILABLE = True
    logger.info("Chatterbox TTS imported successfully")
except ImportError as e:
    CHATTERBOX_AVAILABLE = False
    logger.error(f"Chatterbox TTS not available: {e}")
    logger.error("To install Chatterbox TTS, run:")
    logger.error("  pip install git+https://github.com/resemble-ai/chatterbox.git")
    logger.error("Or check requirements.txt")
except Exception as e:
    CHATTERBOX_AVAILABLE = False
    logger.error(f"Unexpected error importing Chatterbox TTS: {e}")
    logger.error(f"Traceback: {traceback.format_exc()}")

app = FastAPI(title="Chatterbox TTS Service", version="1.0.0")

# Global TTS model instance and status tracking
tts_model = None
initialization_stage = "starting"
initialization_error = None

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = "default"
    speed: Optional[float] = 1.0
    pitch: Optional[float] = 1.0
    exaggeration: Optional[float] = 0.5
    cfg_weight: Optional[float] = 0.5
    audio_prompt_path: Optional[str] = None


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    model_loaded: bool
    chatterbox_available: bool
    initialization_stage: str
    error_message: Optional[str] = None


def initialize_model():
    """Initialize the Chatterbox TTS model"""
    global tts_model, initialization_stage, initialization_error

    initialization_stage = "checking_dependencies"
    logger.info("Starting model initialization...")

    if not CHATTERBOX_AVAILABLE:
        initialization_stage = "failed"
        initialization_error = (
            "Chatterbox TTS package not available - please install with "
            "'pip install git+https://github.com/resemble-ai/chatterbox.git'"
        )
        logger.error("Cannot initialize model: Chatterbox TTS is not available")
        logger.error("Please ensure Chatterbox TTS is properly installed")
        return False

    try:
        initialization_stage = "configuring_device"
        # Check if CUDA is available
        device = "cuda" if torch.cuda.is_available() else "cpu"
        logger.info(f"Selected device for model: {device}")

        if device == "cuda":
            logger.info(f"Using GPU: {torch.cuda.get_device_name(0)}")
            logger.info(
                "CUDA memory available: "
                f"{torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB"
            )
        else:
            logger.info("Using CPU - this may be slower but should work")

        initialization_stage = "downloading_model"
        logger.info("Loading Chatterbox TTS model from pretrained...")
        logger.info("This may take several minutes on first run (downloading model)")

        # Load the model with progress tracking
        tts_model = ChatterboxTTS.from_pretrained(device=device)

        initialization_stage = "ready"
        logger.info("Chatterbox TTS model loaded successfully!")
        logger.info(f"Model device: {getattr(tts_model, 'device', 'unknown')}")
        logger.info(f"Model sample rate: {getattr(tts_model, 'sr', 'unknown')}")

        return True

    except ImportError as e:
        initialization_stage = "failed"
        initialization_error = (
            f"Import error: {e} - Chatterbox TTS may not be properly installed"
        )
        logger.error(f"Import error during model loading: {e}")
        logger.error("This usually means Chatterbox TTS is not properly installed")
        return False
    except RuntimeError as e:
        initialization_stage = "failed"
        if "CUDA" in str(e):
            initialization_error = (
                f"CUDA error: {e} - Try installing CPU version or update GPU drivers"
            )
            logger.error("CUDA error detected - you may need to:")
            logger.error("  1. Install CUDA-compatible PyTorch")
            logger.error("  2. Update GPU drivers")
            logger.error("  3. Check CUDA installation")
        else:
            initialization_error = f"Runtime error: {e}"
        logger.error(f"Runtime error during model loading: {e}")
        return False
    except Exception as e:
        initialization_stage = "failed"
        initialization_error = f"Unexpected error: {e}"
        logger.error(f"Unexpected error during model loading: {e}")
        logger.error(f"Full traceback: {traceback.format_exc()}")
        return False


# Initialize model on startup
@app.on_event("startup")
async def startup_event():
    logger.info("FastAPI startup event triggered")
    logger.info("Attempting to initialize Chatterbox TTS model...")

    success = initialize_model()
    if success:
        logger.info("TTS service startup completed successfully")
        logger.info("Service is ready to accept requests")
    else:
        logger.warning("TTS service started but model failed to load")
        logger.warning(
            "Service will respond to health checks but TTS requests will fail"
        )
        logger.warning("Check the logs above for specific error details")


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint with detailed status information"""
    # Determine overall status based on model state and initialization stage
    if tts_model is not None:
        status = "healthy"
    elif initialization_stage == "failed":
        status = "failed"
    elif initialization_stage in [
        "starting",
        "checking_dependencies",
        "configuring_device",
        "downloading_model",
    ]:
        status = "initializing"
    else:
        status = "unhealthy"

    return HealthResponse(
        status=status,
        service="Chatterbox TTS",
        version="1.0.0",
        model_loaded=tts_model is not None,
        chatterbox_available=CHATTERBOX_AVAILABLE,
        initialization_stage=initialization_stage,
        error_message=initialization_error,
    )


@app.post("/synthesize")
async def synthesize_speech(request: TTSRequest):
    """Synthesize speech from text using Chatterbox TTS"""
    request_id = str(uuid.uuid4())[:8]
    logger.info(f"[{request_id}] New synthesis request received")
    logger.info(
        f"[{request_id}] Request details: text='{request.text[:100]}...', "
        f"voice={request.voice}, exaggeration={request.exaggeration}, "
        f"cfg_weight={request.cfg_weight}"
    )

    try:
        if tts_model is None:
            logger.error(f"[{request_id}] TTS model not loaded - service not ready")
            raise HTTPException(
                status_code=503,
                detail=(
                    "TTS model not loaded. Check service logs for "
                    "initialization errors."
                ),
            )

        logger.info(f"[{request_id}] Model available, starting synthesis...")

        # Generate unique filename
        audio_id = str(uuid.uuid4())
        audio_filename = f"tts_{audio_id}.wav"
        audio_path = os.path.join(tempfile.gettempdir(), audio_filename)

        # Prepare generation parameters
        generation_kwargs = {
            "exaggeration": request.exaggeration,
            "cfg_weight": request.cfg_weight,
        }

        # Add voice cloning if audio prompt is provided
        if request.audio_prompt_path and os.path.exists(request.audio_prompt_path):
            generation_kwargs["audio_prompt_path"] = request.audio_prompt_path
            logger.info(
                f"[{request_id}] Using voice cloning with: "
                f"{request.audio_prompt_path}"
            )

        # Generate speech using Chatterbox TTS
        logger.info(
            f"[{request_id}] Calling tts_model.generate() with parameters: "
            f"{generation_kwargs}"
        )
        start_time = datetime.now()

        try:
            wav = tts_model.generate(request.text, **generation_kwargs)
            generation_time = (datetime.now() - start_time).total_seconds()
            logger.info(
                f"[{request_id}] Generation completed in {generation_time:.2f} seconds"
            )
        except Exception as gen_error:
            logger.error(f"[{request_id}] Model generation failed: {gen_error}")
            logger.error(
                f"[{request_id}] Generation traceback: {traceback.format_exc()}"
            )
            raise

        # Save the generated audio
        logger.info(f"[{request_id}] Saving audio to file...")
        try:
            torchaudio.save(audio_path, wav.cpu(), tts_model.sr)
            file_size = os.path.getsize(audio_path)
            logger.info(
                f"[{request_id}] Audio saved successfully, file size: {file_size} bytes"
            )
        except Exception as save_error:
            logger.error(f"[{request_id}] Failed to save audio: {save_error}")
            raise

        if not os.path.exists(audio_path):
            logger.error(
                f"[{request_id}] Audio file not created at expected path: {audio_path}"
            )
            raise HTTPException(status_code=500, detail="Failed to generate audio file")

        duration = wav.shape[-1] / tts_model.sr
        logger.info(
            f"[{request_id}] Synthesis completed successfully - "
            f"Duration: {duration:.2f}s, Sample rate: {tts_model.sr}Hz"
        )

        # Return the path to the generated audio file
        response = {
            "audio_id": audio_id,
            "audio_path": audio_path,
            "text": (
                request.text[:100] + "..." if len(request.text) > 100 else request.text
            ),
            "voice": request.voice,
            "status": "success",
            "sample_rate": tts_model.sr,
            "duration": duration,
            "generation_time": generation_time,
            "file_size": file_size,
        }

        return response

    except HTTPException:
        # Re-raise HTTP exceptions as-is
        raise
    except Exception as e:
        logger.error(
            f"[{request_id}] TTS synthesis failed with unexpected error: " f"{str(e)}"
        )
        logger.error(f"[{request_id}] Full traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")


@app.get("/audio/{audio_id}")
async def get_audio(audio_id: str):
    """Get generated audio file"""
    audio_filename = f"tts_{audio_id}.wav"
    audio_path = os.path.join(tempfile.gettempdir(), audio_filename)

    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Return file for download/streaming
    from fastapi.responses import FileResponse

    return FileResponse(audio_path, media_type="audio/wav", filename=audio_filename)


@app.get("/voices")
async def list_voices():
    """List available voice configurations for The Magi personas"""
    return {
        "voices": {
            "caspar": {
                "name": "Caspar",
                "description": "Primary voice for responses, warm and authoritative",
                "recommended_settings": {"exaggeration": 0.5, "cfg_weight": 0.5},
            },
            "melchior": {
                "name": "Melchior",
                "description": "Creative and intuitive perspective",
                "recommended_settings": {"exaggeration": 0.7, "cfg_weight": 0.3},
            },
            "balthazar": {
                "name": "Balthazar",
                "description": "Logical and analytical perspective",
                "recommended_settings": {"exaggeration": 0.3, "cfg_weight": 0.6},
            },
        },
        "note": (
            "Voice characteristics are achieved through exaggeration and "
            "cfg_weight parameters. Add audio_prompt_path for voice cloning."
        ),
    }


@app.get("/status")
async def get_status():
    """Get detailed service status"""
    device_info = str(tts_model.device) if hasattr(tts_model, "device") else "Unknown"
    model_info = "Loaded and ready" if tts_model is not None else "Not loaded"

    return {
        "service": "Chatterbox TTS Service",
        "version": "1.0.0",
        "model_status": model_info,
        "device": device_info,
        "cuda_available": torch.cuda.is_available(),
        "chatterbox_available": CHATTERBOX_AVAILABLE,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
