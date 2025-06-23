#!/usr/bin/env python3
"""
The Magi TTS Microservice
A FastAPI-based text-to-speech service for The Magi AI system's three personas:
- Balthazar (Male)
- Melchior (Female) 
- Caspar (Unisex)

This service uses Coqui AI's TTS library to provide distinct voices for each persona.
"""

import logging
from typing import Dict, Optional
import os

from fastapi import FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from TTS.api import TTS

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# FastAPI app initialization
app = FastAPI(
    title="The Magi TTS Microservice",
    description="Text-to-Speech service for The Magi AI system's three personas",
    version="1.0.0"
)

# Request body model using Pydantic
class SpeechRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000, description="Text to be synthesized into speech")
    persona: str = Field(..., description="AI persona: Balthazar, Melchior, or Caspar")

# Voice configuration mapping persona names to Coqui AI TTS model strings
VOICE_CONFIG = {
    "Balthazar": "tts_models/en/vctk/p225",  # Male voice
    "Melchior": "tts_models/en/vctk/p228",   # Female voice
    "Caspar": "tts_models/en/vctk/p232"      # Unisex voice (male voice as placeholder)
}

# Global dictionary to store initialized TTS models
tts_models: Dict[str, TTS] = {}

def initialize_tts_models():
    """
    Initialize TTS models for all personas on startup.
    This ensures models are loaded into memory (and GPU if available) for fast inference.
    """
    logger.info("Initializing TTS models for all personas...")
    
    for persona, model_path in VOICE_CONFIG.items():
        try:
            logger.info(f"Loading TTS model for {persona}: {model_path}")
            
            # Initialize TTS model - will automatically download on first run
            tts = TTS(model_path)
            
            # Store the initialized model
            tts_models[persona] = tts
            
            logger.info(f"Successfully loaded TTS model for {persona}")
            
        except Exception as e:
            logger.error(f"Failed to load TTS model for {persona}: {str(e)}")
            raise RuntimeError(f"TTS model initialization failed for {persona}: {str(e)}")
    
    logger.info("All TTS models initialized successfully")

@app.on_event("startup")
async def startup_event():
    """
    FastAPI startup event handler.
    Initialize TTS models when the service starts.
    """
    initialize_tts_models()

@app.get("/")
async def root():
    """
    Root endpoint providing service information.
    """
    return {
        "service": "The Magi TTS Microservice",
        "version": "1.0.0",
        "available_personas": list(VOICE_CONFIG.keys()),
        "status": "ready"
    }

@app.get("/health")
async def health_check():
    """
    Health check endpoint to verify service status.
    """
    return {
        "status": "healthy",
        "models_loaded": len(tts_models),
        "available_personas": list(tts_models.keys())
    }

@app.post("/api/generate-speech")
async def generate_speech(request: SpeechRequest):
    """
    Generate speech from text using the specified persona's voice.
    
    Args:
        request: SpeechRequest containing text and persona
        
    Returns:
        StreamingResponse: Raw audio data in WAV format
        
    Raises:
        HTTPException: If persona is not supported or TTS generation fails
    """
    # Validate persona
    if request.persona not in VOICE_CONFIG:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported persona: {request.persona}. Supported personas: {list(VOICE_CONFIG.keys())}"
        )
    
    # Get the TTS model for the specified persona
    tts_model = tts_models.get(request.persona)
    if not tts_model:
        raise HTTPException(
            status_code=500,
            detail=f"TTS model not loaded for persona: {request.persona}"
        )
    
    try:
        logger.info(f"Generating speech for persona '{request.persona}': {request.text[:50]}...")
        
        # Generate speech using the TTS model
        # tts_to_wav returns the path to the generated audio file
        audio_path = tts_model.tts_to_wav(
            text=request.text,
            file_path=None,  # Return audio data instead of saving to file
            speaker=tts_model.speakers[0] if tts_model.speakers else None
        )
        
        # Read the generated audio file
        with open(audio_path, "rb") as audio_file:
            audio_data = audio_file.read()
        
        # Clean up the temporary file
        os.remove(audio_path)
        
        logger.info(f"Successfully generated speech for persona '{request.persona}'")
        
        # Return the audio data as a streaming response
        return Response(
            content=audio_data,
            media_type="audio/wav",
            headers={
                "Content-Disposition": f"attachment; filename=speech_{request.persona.lower()}.wav"
            }
        )
        
    except Exception as e:
        logger.error(f"Error generating speech for persona '{request.persona}': {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate speech: {str(e)}"
        )

@app.get("/api/personas")
async def get_personas():
    """
    Get information about available personas and their voice configurations.
    """
    return {
        "personas": {
            persona: {
                "model": model_path,
                "description": get_persona_description(persona)
            }
            for persona, model_path in VOICE_CONFIG.items()
        }
    }

def get_persona_description(persona: str) -> str:
    """
    Get a description for each persona.
    """
    descriptions = {
        "Balthazar": "Male voice - Wise and authoritative",
        "Melchior": "Female voice - Warm and nurturing", 
        "Caspar": "Unisex voice - Balanced and neutral"
    }
    return descriptions.get(persona, "Voice persona")

if __name__ == "__main__":
    import uvicorn
    
    # Run the FastAPI application using uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=False,  # Disable reload for production
        log_level="info"
    ) 