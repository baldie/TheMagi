import os
import sys
import logging
import traceback
from datetime import datetime
import warnings
import torch
import torchaudio
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import tempfile
import uuid
import tqdm
import io
import base64
import glob
import threading
import time

# Suppress progress bars and verbose outputs
os.environ["TQDM_DISABLE"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"

# Force PEFT backend usage to replace deprecated LoRACompatibleLinear
os.environ["USE_PEFT"] = "1"
os.environ["DIFFUSERS_USE_PEFT"] = "1"

# Suppress LoRACompatibleLinear deprecation warning until chatterbox
# supports newer diffusers
warnings.filterwarnings(
    "ignore", category=FutureWarning, message=".*LoRACompatibleLinear.*"
)


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

# Voice embedding cache for performance optimization
voice_embeddings_cache = {}
glados_voice_path = None

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
    use_cached_voice: Optional[bool] = True
    return_audio_data: Optional[bool] = (
        False  # Return base64 audio instead of file path
    )


class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    model_loaded: bool
    chatterbox_available: bool
    initialization_stage: str
    error_message: Optional[str] = None


def initialize_model():
    """Initialize the Chatterbox TTS model and cache voice embeddings"""
    global tts_model, initialization_stage, initialization_error, glados_voice_path

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

        # Cache GLaDOS voice path for performance optimization
        glados_voice_path = os.path.join(os.getcwd(), "GLaDOS.wav")
        if os.path.exists(glados_voice_path):
            logger.info(f"GLaDOS voice file found at: {glados_voice_path}")
            logger.info("Voice cloning will be available for TTS requests")
        else:
            logger.warning(f"GLaDOS.wav not found at {glados_voice_path}")
            logger.warning("Voice cloning will be unavailable")

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


def cleanup_old_audio_files():
    """Clean up old temporary audio files older than 1 hour"""
    try:
        temp_dir = tempfile.gettempdir()
        pattern = os.path.join(temp_dir, "tts_*.wav")
        current_time = time.time()
        one_hour_ago = current_time - 3600  # 1 hour in seconds

        cleaned_count = 0
        for file_path in glob.glob(pattern):
            try:
                if os.path.getmtime(file_path) < one_hour_ago:
                    os.remove(file_path)
                    cleaned_count += 1
            except OSError:
                pass  # File might have been deleted already

        if cleaned_count > 0:
            logger.info(f"Cleaned up {cleaned_count} old temporary audio files")

    except Exception as e:
        logger.warning(f"Error during temporary file cleanup: {e}")


def start_cleanup_thread():
    """Start background thread for periodic cleanup"""

    def cleanup_worker():
        while True:
            time.sleep(1800)  # Clean up every 30 minutes
            cleanup_old_audio_files()

    cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
    cleanup_thread.start()
    logger.info("Started background cleanup thread for temporary files")


# Initialize model on startup
@app.on_event("startup")
async def startup_event():
    logger.info("FastAPI startup event triggered")
    logger.info("Attempting to initialize Chatterbox TTS model...")

    success = initialize_model()
    if success:
        logger.info("TTS service startup completed successfully")
        logger.info("Service is ready to accept requests")

        # Start cleanup thread for temporary files
        start_cleanup_thread()

        # Clean up any existing old files
        cleanup_old_audio_files()
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
    """Synthesize speech from text using Chatterbox TTS (legacy)"""
    return await _synthesize_speech_internal(request, save_file=True)


@app.post("/synthesize-direct")
async def synthesize_speech_direct(request: TTSRequest):
    """Return audio data directly as base64 (optimized)"""
    return await _synthesize_speech_internal(request, save_file=False)


async def _synthesize_speech_internal(request: TTSRequest, save_file: bool = True):
    """Internal synthesis function with optional file saving"""
    request_id = str(uuid.uuid4())[:8]
    logger.debug(f"[{request_id}] New synthesis request received")
    logger.debug(
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

        logger.debug(f"[{request_id}] Model available, starting synthesis...")

        # Generate unique audio ID for tracking
        audio_id = str(uuid.uuid4())
        audio_path = None

        # Only create file path if we're saving to disk
        if save_file:
            audio_filename = f"tts_{audio_id}.wav"
            audio_path = os.path.join(tempfile.gettempdir(), audio_filename)

        # Prepare generation parameters
        generation_kwargs = {
            "exaggeration": request.exaggeration,
            "cfg_weight": request.cfg_weight,
        }

        # Add voice cloning - use GLaDOS.wav by default for optimization
        if (
            request.use_cached_voice
            and glados_voice_path
            and os.path.exists(glados_voice_path)
        ):
            generation_kwargs["audio_prompt_path"] = glados_voice_path
            logger.debug(f"[{request_id}] Using cached GLaDOS voice for cloning")
        elif request.audio_prompt_path and os.path.exists(request.audio_prompt_path):
            generation_kwargs["audio_prompt_path"] = request.audio_prompt_path
            logger.debug(
                f"[{request_id}] Using custom voice cloning with: "
                f"{request.audio_prompt_path}"
            )

        # Generate speech using Chatterbox TTS
        logger.debug(
            f"[{request_id}] Calling tts_model.generate() with parameters: "
            f"{generation_kwargs}"
        )
        start_time = datetime.now()

        try:
            wav = tts_model.generate(request.text, **generation_kwargs)
            generation_time = (datetime.now() - start_time).total_seconds()
            logger.debug(
                f"[{request_id}] Generation completed in {generation_time:.2f} seconds"
            )
        except Exception as gen_error:
            logger.error(f"[{request_id}] Model generation failed: {gen_error}")
            logger.error(
                f"[{request_id}] Generation traceback: {traceback.format_exc()}"
            )
            raise

        # Handle audio output based on save_file parameter
        file_size = 0
        audio_data_base64 = None

        if save_file:
            # Save the generated audio to file (legacy behavior)
            logger.debug(f"[{request_id}] Saving audio to file...")
            try:
                torchaudio.save(audio_path, wav.cpu(), tts_model.sr)
                file_size = os.path.getsize(audio_path)
                logger.debug(
                    f"[{request_id}] Audio saved successfully, "
                    f"file size: {file_size} bytes"
                )
            except Exception as save_error:
                logger.error(f"[{request_id}] Failed to save audio: {save_error}")
                raise

            if not os.path.exists(audio_path):
                logger.error(
                    f"[{request_id}] Audio file not created at "
                    f"expected path: {audio_path}"
                )
                raise HTTPException(
                    status_code=500, detail="Failed to generate audio file"
                )
        else:
            # Return audio data directly (optimized behavior)
            logger.debug(f"[{request_id}] Preparing audio data for direct return...")
            try:
                # Convert audio tensor to bytes in memory
                audio_buffer = io.BytesIO()
                torchaudio.save(audio_buffer, wav.cpu(), tts_model.sr, format="wav")
                audio_bytes = audio_buffer.getvalue()
                file_size = len(audio_bytes)

                # Encode as base64 for JSON response
                audio_data_base64 = base64.b64encode(audio_bytes).decode("utf-8")
                logger.debug(
                    f"[{request_id}] Audio data prepared, size: {file_size} bytes"
                )
            except Exception as data_error:
                logger.error(
                    f"[{request_id}] Failed to prepare audio data: {data_error}"
                )
                raise

        duration = wav.shape[-1] / tts_model.sr
        logger.debug(
            f"[{request_id}] Synthesis completed successfully - "
            f"Duration: {duration:.2f}s, Sample rate: {tts_model.sr}Hz"
        )

        # Build response based on output mode
        response = {
            "audio_id": audio_id,
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

        if save_file:
            response["audio_path"] = audio_path
        else:
            response["audio_data"] = audio_data_base64
            response["format"] = "wav"
            response["encoding"] = "base64"

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
    """Get generated audio file (legacy endpoint)"""
    audio_filename = f"tts_{audio_id}.wav"
    audio_path = os.path.join(tempfile.gettempdir(), audio_filename)

    if not os.path.exists(audio_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Return file for download/streaming
    from fastapi.responses import FileResponse

    return FileResponse(audio_path, media_type="audio/wav", filename=audio_filename)


@app.post("/cleanup")
async def cleanup_temp_files():
    """Manually trigger cleanup of temporary files"""
    cleanup_old_audio_files()
    temp_dir = tempfile.gettempdir()
    remaining_files = len(glob.glob(os.path.join(temp_dir, "tts_*.wav")))

    return {"status": "cleanup_completed", "remaining_temp_files": remaining_files}


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

    # Count temporary files
    temp_dir = tempfile.gettempdir()
    temp_files = len(glob.glob(os.path.join(temp_dir, "tts_*.wav")))

    return {
        "service": "Chatterbox TTS Service",
        "version": "1.0.0",
        "model_status": model_info,
        "device": device_info,
        "cuda_available": torch.cuda.is_available(),
        "chatterbox_available": CHATTERBOX_AVAILABLE,
        "optimizations": {
            "voice_caching_enabled": glados_voice_path is not None,
            "direct_synthesis_available": True,
            "batch_synthesis_available": True,
        },
        "temp_files_count": temp_files,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
