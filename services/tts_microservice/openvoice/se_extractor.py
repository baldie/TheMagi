import os
import glob
import torch
import hashlib
import librosa
import base64
from glob import glob
import numpy as np
from pydub import AudioSegment
from faster_whisper import WhisperModel
import hashlib
import base64
import librosa
import logging
from whisper_timestamped.transcribe import get_audio_tensor, get_vad_segments

model_size = "medium"
# Run on GPU with FP16
model = None

def ensure_absolute_path(path):
    """Convert a path to absolute if it isn't already"""
    return os.path.abspath(path) if not os.path.isabs(path) else path

def split_audio_whisper(audio_path, audio_name, target_dir='processed'):
    global model
    if model is None:
        model = WhisperModel(model_size, device="cuda", compute_type="float16")
    
    audio_path = ensure_absolute_path(audio_path)
    target_dir = ensure_absolute_path(target_dir)
    
    logging.info(f"Processing audio file: {audio_path}")
    logging.info(f"Target directory: {target_dir}")
    
    audio = AudioSegment.from_file(audio_path)
    max_len = len(audio)

    target_folder = os.path.join(target_dir, audio_name)
    target_folder = ensure_absolute_path(target_folder)
    
    segments, info = model.transcribe(audio_path, beam_size=5, word_timestamps=True)
    segments = list(segments)    

    # create directory
    os.makedirs(target_folder, exist_ok=True)
    wavs_folder = os.path.join(target_folder, 'wavs')
    wavs_folder = ensure_absolute_path(wavs_folder)
    os.makedirs(wavs_folder, exist_ok=True)

    logging.info(f"Created wavs folder at: {wavs_folder}")

    # segments
    s_ind = 0
    start_time = None
    
    for k, w in enumerate(segments):
        # process with the time
        if k == 0:
            start_time = max(0, w.start)

        end_time = w.end

        # calculate confidence
        if len(w.words) > 0:
            confidence = sum([s.probability for s in w.words]) / len(w.words)
        else:
            confidence = 0.
        # clean text
        text = w.text.replace('...', '')

        # left 0.08s for each audios
        audio_seg = audio[int( start_time * 1000) : min(max_len, int(end_time * 1000) + 80)]

        # segment file name
        fname = f"{audio_name}_seg{s_ind}.wav"

        # filter out the segment shorter than 1.5s and longer than 20s
        save = audio_seg.duration_seconds > 1.5 and \
                audio_seg.duration_seconds < 20. and \
                len(text) >= 2 and len(text) < 200 

        if save:
            output_file = os.path.join(wavs_folder, fname)
            output_file = ensure_absolute_path(output_file)
            audio_seg.export(output_file, format='wav')
            logging.info(f"Saved audio segment: {output_file}")

        if k < len(segments) - 1:
            start_time = max(0, segments[k+1].start - 0.08)

        s_ind = s_ind + 1
    return wavs_folder

def split_audio_vad(audio_path, audio_name, target_dir, split_seconds=10.0):
    audio_path = ensure_absolute_path(audio_path)
    target_dir = ensure_absolute_path(target_dir)
    
    logging.info(f"VAD processing audio file: {audio_path}")
    logging.info(f"VAD target directory: {target_dir}")
    
    try:
        SAMPLE_RATE = 16000
        logging.info("Loading audio file for VAD processing...")
        audio_vad = get_audio_tensor(audio_path)
        logging.info("Audio file loaded successfully")
        
        logging.info("Running VAD segmentation...")
        segments = get_vad_segments(
            audio_vad,
            output_sample=True,
            min_speech_duration=0.1,
            min_silence_duration=1,
            method="silero",
        )
        segments = [(seg["start"], seg["end"]) for seg in segments]
        segments = [(float(s) / SAMPLE_RATE, float(e) / SAMPLE_RATE) for s,e in segments]
        logging.info(f"Found {len(segments)} VAD segments")
        
        logging.info("Loading audio file for segment extraction...")
        try:
            audio = AudioSegment.from_file(audio_path)
            logging.info("Audio file loaded successfully for segment extraction")
        except Exception as e:
            logging.error(f"Failed to load audio file with pydub: {str(e)}")
            logging.error(f"Audio file path: {audio_path}")
            logging.error(f"Current working directory: {os.getcwd()}")
            raise
        
        audio_active = AudioSegment.silent(duration=0)
        for start_time, end_time in segments:
            audio_active += audio[int(start_time * 1000) : int(end_time * 1000)]
        
        audio_dur = audio_active.duration_seconds
        logging.info(f'After VAD: duration = {audio_dur} seconds')
        
        target_folder = os.path.join(target_dir, audio_name)
        target_folder = ensure_absolute_path(target_folder)
        wavs_folder = os.path.join(target_folder, 'wavs')
        wavs_folder = ensure_absolute_path(wavs_folder)
        
        os.makedirs(wavs_folder, exist_ok=True)
        logging.info(f"Created VAD wavs folder at: {wavs_folder}")
        
        start_time = 0.
        count = 0
        num_splits = int(np.round(audio_dur / split_seconds))
        assert num_splits > 0, 'input audio is too short'
        interval = audio_dur / num_splits

        for i in range(num_splits):
            end_time = min(start_time + interval, audio_dur)
            if i == num_splits - 1:
                end_time = audio_dur
            output_file = os.path.join(wavs_folder, f"{audio_name}_seg{count}.wav")
            output_file = ensure_absolute_path(output_file)
            audio_seg = audio_active[int(start_time * 1000): int(end_time * 1000)]
            try:
                audio_seg.export(output_file, format='wav')
                logging.info(f"Saved VAD segment: {output_file}")
            except Exception as e:
                logging.error(f"Failed to export audio segment: {str(e)}")
                logging.error(f"Output file path: {output_file}")
                raise
            start_time = end_time
            count += 1
        return wavs_folder
    except Exception as e:
        logging.error(f"Error in split_audio_vad: {str(e)}")
        logging.error(f"Error type: {type(e)}")
        logging.error(f"Error args: {e.args}")
        raise

def hash_numpy_array(audio_path):
    audio_path = ensure_absolute_path(audio_path)
    try:
        array, _ = librosa.load(audio_path, sr=None, mono=True)
        # Convert the array to bytes
        array_bytes = array.tobytes()
        # Calculate the hash of the array bytes
        hash_object = hashlib.sha256(array_bytes)
        hash_value = hash_object.digest()
        # Convert the hash value to base64
        base64_value = base64.b64encode(hash_value)
        return base64_value.decode('utf-8')[:16].replace('/', '_^')
    except Exception as e:
        logging.error(f"Failed to hash audio file: {str(e)}")
        logging.error(f"Audio file path: {audio_path}")
        raise

def get_se(audio_path, vc_model, target_dir='processed', vad=True):
    audio_path = ensure_absolute_path(audio_path)
    target_dir = ensure_absolute_path(target_dir)
    
    device = vc_model.device
    version = vc_model.version
    logging.info(f"OpenVoice version: {version}")
    logging.info(f"Processing audio: {audio_path}")
    logging.info(f"Target directory: {target_dir}")

    try:
        audio_name = f"{os.path.basename(audio_path).rsplit('.', 1)[0]}_{version}_{hash_numpy_array(audio_path)}"
        se_path = os.path.join(target_dir, audio_name, 'se.pth')
        se_path = ensure_absolute_path(se_path)
        logging.info(f"Speaker embedding will be saved to: {se_path}")

        if vad:
            wavs_folder = split_audio_vad(audio_path, target_dir=target_dir, audio_name=audio_name)
        else:
            wavs_folder = split_audio_whisper(audio_path, target_dir=target_dir, audio_name=audio_name)
        
        wavs_folder = ensure_absolute_path(wavs_folder)
        audio_segs = glob(f'{wavs_folder}/*.wav')
        logging.info(f"Found {len(audio_segs)} audio segments in {wavs_folder}")
        
        if len(audio_segs) == 0:
            raise NotImplementedError('No audio segments found!')
        
        # Ensure all segment paths are absolute
        audio_segs = [ensure_absolute_path(seg) for seg in audio_segs]
        
        se = vc_model.extract_se(audio_segs, se_save_path=se_path)
        logging.info("Successfully extracted speaker embedding")
        return se, audio_name
    except Exception as e:
        logging.error(f"Error in get_se: {str(e)}")
        logging.error(f"Error type: {type(e)}")
        logging.error(f"Error args: {e.args}")
        raise

