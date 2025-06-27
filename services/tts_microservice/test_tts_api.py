import requests
import sys
import os
import io
import pygame

def play_audio_buffer(buffer):
    """
    Plays an audio buffer using pygame.
    """
    try:
        print("Initializing audio player...")
        pygame.mixer.init()
        print("Creating sound from buffer...")
        sound = pygame.mixer.Sound(io.BytesIO(buffer))
        print("Playing audio...")
        sound.play()
        while pygame.mixer.get_busy():
            pygame.time.Clock().tick(10)
        print("Playback finished.")
    except Exception as e:
        print(f"Error playing audio: {e}")
        print("Please ensure you have a working audio output device.")
        print("On some systems (like WSL), you may need to configure audio forwarding.")
    finally:
        pygame.mixer.quit()

def test_tts_api():
    """
    Test the TTS API by sending a simple text request and verifying the response.
    The test assumes the TTS service is running on localhost:8000.
    """
    # API endpoint
    url = "http://localhost:8000/api/generate-speech"
    
    # Test data
    data = {
        "text": "this is a test",
        "persona": "Caspar"  # Using Caspar as the test persona
    }
    
    try:
        # First check if the service is running
        health_check = requests.get("http://localhost:8000/health")
        if health_check.status_code != 200:
            print("Error: TTS service is not running. Please start the service first.")
            sys.exit(1)
            
        # Make the TTS request
        print("Sending TTS request...")
        response = requests.post(url, json=data)
        
        # Check response
        if response.status_code == 200:
            print("Success! Received audio data.")
            
            # Play the audio from the response content
            play_audio_buffer(response.content)
            
            # Save the audio to a file for verification
            output_file = "test_output.wav"
            with open(output_file, "wb") as f:
                f.write(response.content)
            print(f"Audio also saved to {output_file}")
            
            # Verify the file exists and has content
            if os.path.exists(output_file) and os.path.getsize(output_file) > 0:
                print("Test passed! Audio file was created and played successfully.")
            else:
                print("Error: Audio file was not created or is empty.")
                sys.exit(1)
        else:
            print(f"Error: Received status code {response.status_code}")
            print(f"Response: {response.text}")
            sys.exit(1)
            
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to the TTS service. Make sure it's running on port 8000.")
        sys.exit(1)

if __name__ == "__main__":
    test_tts_api() 