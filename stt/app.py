"""Tiny OpenAI-compatible speech-to-text server around NVIDIA Parakeet TDT 0.6B v3 (onnx-asr, CPU, amd64 and arm64)."""
import os
import tempfile
import threading
import wave

import onnx_asr
from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI()
model = onnx_asr.load_model(os.environ.get("ASR_MODEL", "nemo-parakeet-tdt-0.6b-v3"))
lock = threading.Lock()
CHUNK = 20 * 16000  # the model handles about 20 to 30 seconds at a time


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/v1/audio/transcriptions")
def transcribe(file: UploadFile = File(...)):
    data = file.file.read()
    with tempfile.TemporaryDirectory() as d:
        src = os.path.join(d, "in.wav")
        with open(src, "wb") as f:
            f.write(data)
        try:
            w = wave.open(src, "rb")
        except (wave.Error, EOFError):
            raise HTTPException(400, "Send a 16 kHz mono 16-bit WAV file")
        parts = []
        with w:
            if w.getframerate() != 16000 or w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise HTTPException(400, "Send a 16 kHz mono 16-bit WAV file")
            n = w.getnframes()
            for i, start in enumerate(range(0, n, CHUNK)):
                w.setpos(start)
                p = os.path.join(d, f"{i}.wav")
                with wave.open(p, "wb") as o:
                    o.setnchannels(1)
                    o.setsampwidth(2)
                    o.setframerate(16000)
                    o.writeframes(w.readframes(min(CHUNK, n - start)))
                parts.append(p)
        if not parts:
            return {"text": ""}
        with lock:
            res = model.recognize(parts)
    texts = res if isinstance(res, list) else [res]
    return {"text": " ".join(str(t).strip() for t in texts).strip()}
