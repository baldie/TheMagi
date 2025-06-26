# OpenVoice Server

OpenVoice Server is a FastAPI application that provides endpoints for uploading audio files, performing text-to-speech conversion, and synthesizing speech from text using a specified voice and style.
It is built on top of the OpenVoice project, which is a versatile instant voice cloning system that can accurately clone the reference tone color and generate speech in multiple languages and accents.
See: https://github.com/myshell-ai/OpenVoice

## Runpod.io template
I have provided 2 easy to deploy one-click templates for Runpod.io, for those who want to quickly deploy the OpenVoice Server on a Runpod instance.
The first template uses OpenVoice V1, and the second template uses OpenVoice V2, there are slight changes in the API endpoints (v1 has style and language, v2 only has accent as parameters).

V1 is slightly faster but only supports English, while V2 sounds better and supports multiple languages and accents.

OpenVoice V1 server:
https://runpod.io/console/deploy?template=6uvya46w7n&ref=2vdt3dn9

OpenVoice V2 server:
https://runpod.io/console/deploy?template=qo8v6w92q2&ref=2vdt3dn9

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ValyrianTech/OpenVoice_server.git
   ```
2. Navigate to the project directory:
   ```bash
   cd openvoice_server
   ```
3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Usage

To start the server, run the following command:

```bash
cd openvoice
uvicorn openvoice_server:app --host 0.0.0.0 --port 8000
```

The server provides the following endpoints:

### 1. Base Text-to-Speech

This endpoint performs text-to-speech conversion using only the base speaker.

**Endpoint:** `/base_tts/`

**Method:** `GET`

**Request Body:**

- `text` (str): The text to be converted to speech.
- `accent` (str, optional): The accent to be used for the synthesized speech. Defaults to 'en-newest'. Options are: 'en-au', 'en-br', 'en-default', 'en-india', 'en-newest', 'en-us', 'es', 'fr', 'jp', 'kr', 'zh'
- `speed` (float, optional): The speed of the synthesized speech. Defaults to 1.0.

**Example Request:**

```python
import requests

url = "http://localhost:8000/base_tts/"
params = {
    "text": "Hello, world!",
    "accent": "en-newest",
    "language": "English",
    "speed": 1.0
}

response = requests.get(url, params=params)

with open("output.wav", "wb") as f:
    f.write(response.content)
```

### 2. Change Voice

This endpoint allows you to change the voice of an existing audio file.

**Endpoint:** `/change_voice/`

**Method:** `POST`

**Request Body:**

- `reference_speaker` (str): The name of the reference speaker.
- `file` (file): The audio file to be changed.
- `watermark` (str, optional): The watermark to be encoded in the voice conversion. Defaults to '@MyShell'.

**Example Request:**

```python
import requests

url = "http://localhost:8000/change_voice/"
file = open("example.wav", "rb")
data = {"reference_speaker": "example_label"}

response = requests.post(url, data=data, files={"file": file})

with open("output.wav", "wb") as f:
    f.write(response.content)
```

### 3. Upload Audio

This endpoint allows you to upload an audio file that will be used as the reference audio for speech synthesis.

**Endpoint:** `/upload_audio/`

**Method:** `POST`

**Request Body:**

- `audio_file_label` (str): The label for the audio file.
- `file` (file): The audio file to be uploaded.

**Example Request:**

```python
import requests

url = "http://localhost:8000/upload_audio/"
audio_file_label = "example_label"
file = open("example.wav", "rb")

response = requests.post(url, data={"audio_file_label": audio_file_label}, files={"file": file})

print(response.json())
```

### 4. Synthesize Speech

This endpoint synthesizes speech from text using a specified voice and style.

**Endpoint:** `/synthesize_speech/`

**Method:** `GET`

**Request Body:**

- `text` (str): The text to be synthesized into speech.
- `voice` (str): The voice to be used for the synthesized speech.
- `accent` (str, optional): The accent to be used for the synthesized speech. Defaults to 'en-newest'. Options are: 'en-au', 'en-br', 'en-default', 'en-india', 'en-newest', 'en-us', 'es', 'fr', 'jp', 'kr', 'zh'
- `speed` (float, optional): The speed of the synthesized speech. Defaults to 1.0.
- `watermark` (str, optional): The watermark to be encoded in the voice conversion. Defaults to '@MyShell'.

Note: OpenVoice comes with a few voices as examples, the following are available:
- example_reference
- demo_speaker0
- demo_speaker1
- demo_speaker2

**Example Request:**

```python
import requests

url = "http://localhost:8000/synthesize_speech/"
data = {
    "text": "Hello, world!",
    "voice": "example_label",
    "accent": "en-newest",
    "speed": 1.0
}

response = requests.get(url, params=data)

with open("output.wav", "wb") as f:
    f.write(response.content)
```

The response will be the synthesized speech audio file. In the headers of the response are 2 additional fields:
- x-elapsed-time: The time taken to synthesize the speech in seconds.
- x-device-used: The device used for synthesis.
