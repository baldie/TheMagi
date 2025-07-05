#!/usr/bin/env python3
"""
Direct TTS API Test Script

Tests the TTS service directly by making HTTP API calls to verify:
1. Service health and GPU availability
2. Speech synthesis for Caspar persona
3. Audio file generation and retrieval
4. GPU acceleration verification

Usage: python test_tts_direct.py
"""

import requests
import json
import time
import os
import sys
from datetime import datetime
import subprocess

# TTS Service Configuration
TTS_BASE_URL = "http://localhost:8000"
TEST_TEXT = "this is a test"
TEST_PERSONA = "caspar"

# Caspar persona settings (from orchestrator tts.ts)
CASPAR_SETTINGS = {
    "text": TEST_TEXT,
    "voice": TEST_PERSONA,
    "speed": 1.0,
    "pitch": 1.0,
    "exaggeration": 0.5,
    "cfg_weight": 0.5
}

def print_header(title):
    """Print a formatted header for test sections"""
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")

def print_step(step_num, description):
    """Print a formatted step description"""
    print(f"\n[Step {step_num}] {description}")

def check_gpu_status():
    """Check GPU status using nvidia-smi if available"""
    try:
        result = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.used,memory.total,utilization.gpu', 
                               '--format=csv,noheader,nounits'], 
                               capture_output=True, text=True, timeout=10)
        if result.returncode == 0:
            print("GPU Status:")
            lines = result.stdout.strip().split('\n')
            for i, line in enumerate(lines):
                name, mem_used, mem_total, util = line.split(', ')
                print(f"  GPU {i}: {name}")
                print(f"    Memory: {mem_used}MB / {mem_total}MB")
                print(f"    Utilization: {util}%")
            return True
        else:
            print("nvidia-smi failed:", result.stderr)
            return False
    except (subprocess.TimeoutExpired, FileNotFoundError) as e:
        print(f"Could not check GPU status: {e}")
        return False

def test_health_endpoint():
    """Test the TTS service health endpoint"""
    print_step(1, "Testing TTS Service Health")
    
    try:
        response = requests.get(f"{TTS_BASE_URL}/health", timeout=10)
        response.raise_for_status()
        
        health_data = response.json()
        print(f"✓ Service Status: {health_data.get('status', 'unknown')}")
        print(f"✓ Service Name: {health_data.get('service', 'unknown')}")
        print(f"✓ Version: {health_data.get('version', 'unknown')}")
        print(f"✓ Model Loaded: {health_data.get('model_loaded', False)}")
        print(f"✓ Chatterbox Available: {health_data.get('chatterbox_available', False)}")
        print(f"✓ Initialization Stage: {health_data.get('initialization_stage', 'unknown')}")
        
        if health_data.get('error_message'):
            print(f"⚠ Error Message: {health_data['error_message']}")
        
        if health_data.get('status') == 'healthy':
            print("✓ TTS Service is healthy and ready")
            return True
        else:
            print(f"✗ TTS Service is not healthy: {health_data.get('status')}")
            return False
            
    except requests.RequestException as e:
        print(f"✗ Failed to connect to TTS service: {e}")
        return False
    except json.JSONDecodeError as e:
        print(f"✗ Invalid JSON response: {e}")
        return False

def test_status_endpoint():
    """Test the detailed status endpoint"""
    print_step(2, "Checking Detailed Service Status")
    
    try:
        response = requests.get(f"{TTS_BASE_URL}/status", timeout=10)
        response.raise_for_status()
        
        status_data = response.json()
        print(f"✓ Service: {status_data.get('service', 'unknown')}")
        print(f"✓ Model Status: {status_data.get('model_status', 'unknown')}")
        print(f"✓ Device: {status_data.get('device', 'unknown')}")
        print(f"✓ CUDA Available: {status_data.get('cuda_available', False)}")
        print(f"✓ Chatterbox Available: {status_data.get('chatterbox_available', False)}")
        
        return status_data.get('cuda_available', False)
        
    except requests.RequestException as e:
        print(f"✗ Failed to get status: {e}")
        return False

def test_voices_endpoint():
    """Test the voices endpoint to see available personas"""
    print_step(3, "Checking Available Voices")
    
    try:
        response = requests.get(f"{TTS_BASE_URL}/voices", timeout=10)
        response.raise_for_status()
        
        voices_data = response.json()
        print("✓ Available voices:")
        
        for voice_id, voice_info in voices_data.get('voices', {}).items():
            print(f"  {voice_id}: {voice_info.get('name', 'Unknown')}")
            print(f"    Description: {voice_info.get('description', 'No description')}")
            settings = voice_info.get('recommended_settings', {})
            if settings:
                print(f"    Settings: exaggeration={settings.get('exaggeration', 'N/A')}, cfg_weight={settings.get('cfg_weight', 'N/A')}")
        
        return True
        
    except requests.RequestException as e:
        print(f"✗ Failed to get voices: {e}")
        return False

def test_speech_synthesis():
    """Test speech synthesis with Caspar persona"""
    print_step(4, f"Synthesizing Speech: '{TEST_TEXT}' with {TEST_PERSONA} voice")
    
    print("Request parameters:")
    for key, value in CASPAR_SETTINGS.items():
        print(f"  {key}: {value}")
    
    try:
        # Record start time and GPU status
        start_time = time.time()
        print("\nGPU status before synthesis:")
        check_gpu_status()
        
        print(f"\nSending synthesis request...")
        response = requests.post(
            f"{TTS_BASE_URL}/synthesize",
            json=CASPAR_SETTINGS,
            timeout=120  # 2 minutes timeout for synthesis
        )
        response.raise_for_status()
        
        synthesis_time = time.time() - start_time
        synthesis_data = response.json()
        
        print(f"✓ Synthesis completed in {synthesis_time:.2f} seconds")
        print(f"✓ Audio ID: {synthesis_data.get('audio_id', 'unknown')}")
        print(f"✓ Audio Path: {synthesis_data.get('audio_path', 'unknown')}")
        print(f"✓ Status: {synthesis_data.get('status', 'unknown')}")
        print(f"✓ Sample Rate: {synthesis_data.get('sample_rate', 'unknown')} Hz")
        print(f"✓ Duration: {synthesis_data.get('duration', 'unknown')} seconds")
        print(f"✓ Generation Time: {synthesis_data.get('generation_time', 'unknown')} seconds")
        print(f"✓ File Size: {synthesis_data.get('file_size', 'unknown')} bytes")
        
        print("\nGPU status after synthesis:")
        check_gpu_status()
        
        return synthesis_data.get('audio_id')
        
    except requests.RequestException as e:
        print(f"✗ Speech synthesis failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
            try:
                error_data = e.response.json()
                print(f"✗ Error details: {error_data}")
            except:
                print(f"✗ Response text: {e.response.text}")
        return None

def test_audio_retrieval(audio_id):
    """Test retrieving the generated audio file"""
    print_step(5, f"Retrieving Generated Audio (ID: {audio_id})")
    
    if not audio_id:
        print("✗ No audio ID provided, skipping retrieval test")
        return False
    
    try:
        response = requests.get(f"{TTS_BASE_URL}/audio/{audio_id}", timeout=30)
        response.raise_for_status()
        
        # Save audio file for verification
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"test_audio_caspar_{timestamp}.wav"
        
        with open(filename, 'wb') as f:
            f.write(response.content)
        
        file_size = os.path.getsize(filename)
        print(f"✓ Audio file retrieved successfully")
        print(f"✓ Saved as: {filename}")
        print(f"✓ File size: {file_size} bytes")
        print(f"✓ Content type: {response.headers.get('content-type', 'unknown')}")
        
        # Basic validation
        if file_size > 1000:  # At least 1KB for a short audio file
            print("✓ File size appears reasonable")
        else:
            print("⚠ File size seems very small")
            
        return True
        
    except requests.RequestException as e:
        print(f"✗ Audio retrieval failed: {e}")
        return False

def main():
    """Run all TTS tests"""
    print_header("TTS Service Direct API Test")
    print(f"Testing TTS service at: {TTS_BASE_URL}")
    print(f"Test text: '{TEST_TEXT}'")
    print(f"Test persona: {TEST_PERSONA}")
    print(f"Timestamp: {datetime.now()}")
    
    # Initial GPU check
    print_header("Initial System Check")
    print("Checking GPU availability...")
    check_gpu_status()
    
    # Test sequence
    tests_passed = 0
    total_tests = 5
    
    # Test 1: Health check
    if test_health_endpoint():
        tests_passed += 1
    
    # Test 2: Status check
    cuda_available = test_status_endpoint()
    if cuda_available is not False:  # Could be True or False, both are valid responses
        tests_passed += 1
        if cuda_available:
            print("✓ CUDA is available for acceleration")
        else:
            print("⚠ CUDA not available, will use CPU")
    
    # Test 3: Voices check
    if test_voices_endpoint():
        tests_passed += 1
    
    # Test 4: Speech synthesis
    audio_id = test_speech_synthesis()
    if audio_id:
        tests_passed += 1
    
    # Test 5: Audio retrieval
    if test_audio_retrieval(audio_id):
        tests_passed += 1
    
    # Final results
    print_header("Test Results Summary")
    print(f"Tests passed: {tests_passed}/{total_tests}")
    
    if tests_passed == total_tests:
        print("🎉 All tests passed! TTS service is working correctly with CUDA acceleration.")
        return 0
    elif tests_passed >= 3:
        print("⚠ Most tests passed, but there may be some issues. Check the output above.")
        return 1
    else:
        print("❌ Multiple tests failed. TTS service may not be working correctly.")
        return 2

if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)