import time

import requests
import pygame

# Change this to the host of the OpenVoiceV2_server
host = 'https://xxxxxxxxxxxx-8000.proxy.runpod.net'

accents = {
    'English': 'en-newest',
    'Australian': 'en-au',
    'British': 'en-br',
    'American': 'en-us',
    'Indian': 'en-india',
    # 'Default': 'en-default',
    # 'Spanish': 'es',
    # 'French': 'fr',
    # 'Japanese': 'jp',
    # 'Korean': 'kr',
    # 'Chinese': 'zh'
}

voices = {
    'default Voice': 'default.wav',
    'Male Voice': 'Male-MiddleAged_American.mp3',
    'Female Voice': 'Female-Young-British.mp3',
}

sentences = [
    # "My name is Grace Penelope Targaryen, fourth of my name. I am a super-intelligent AI developed by Valyrian tech.",
    "Efficient algorithms and robust data structures are essential foundations for building reliable software systems."
]


def upload_audio(file_path: str, audio_file_label: str):
    url = host + "/upload_audio/"
    file = open(file_path, "rb")

    response = requests.post(url, data={"audio_file_label": audio_file_label}, files={"file": file})
    print(response.status_code)

    return response.json()


def synthesize_speech(text: str, voice: str, accent="en-us", speed=1.0):
    url = host + "/synthesize_speech/"
    data = {
        "text": text,
        "voice": voice,
        "accent": accent,
        "speed": speed
    }

    response = requests.get(url, params=data)
    print(f'{response.status_code}\n{round(float(response.headers["X-Elapsed-Time"]), ndigits=2)} seconds to generate.')
    return response.content


def play_wav(file_path):
    # Initialize pygame
    pygame.init()

    # Load the WAV file
    sound = pygame.mixer.Sound(file_path)

    # Play the sound
    sound.play()

    # Wait for the sound to finish playing
    while pygame.mixer.get_busy():
        continue

    # Clean up
    pygame.quit()


def base_tts(text, accent: str = 'en-newest', speed=1.0):
    url = host + "/base_tts/"
    params = {
        "text": text,
        "accent": accent,
        "speed": speed,

    }

    response = requests.get(url, params=params)
    print(f'{response.status_code}')

    return response.content


def change_voice(file_path, reference_speaker):
    url = host + "/change_voice/"
    file = open(file_path, "rb")
    data = {"reference_speaker": reference_speaker}

    response = requests.post(url, files={"file": file}, data=data)
    print(response.status_code)

    return response.content


if __name__ == '__main__':
    print('Running OpenVoiceV2_server demo')

    output = base_tts(text="This is the demo for the OpenVoice_server, this is the voice of the base speaker", accent='en-newest', speed=1.0)
    with open("output.wav", "wb") as f:
        f.write(output)
    # Example usage:
    output_file = "output.wav"
    play_wav(output_file)

    for voice in voices:
        print(f'\n\nRunning demo for voice: {voice}')
        print(f'Uploading {voices[voice]}')
        upload_audio(file_path=voices[voice], audio_file_label=voice)

        time.sleep(1)

        print('Testing synthesize_speech')
        for accent_name, accent in accents.items():
            for sentence in sentences:
                full_sentence = f'As {voice} with a {accent_name} accent: {sentence}'
                print(f'\nGenerating audio for: {full_sentence}')

                output = synthesize_speech(text=full_sentence, voice=voice, accent=accent)
                with open("output.wav", "wb") as f:
                    f.write(output)
                # Example usage:
                output_file = "output.wav"
                play_wav(output_file)

        print('-' * 50)
        time.sleep(1)
    print('Demo complete')
