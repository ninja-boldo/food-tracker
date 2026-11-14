FROM python:3.12-slim
RUN pip install --no-cache-dir "onnx-asr[cpu,hub]" "onnxruntime!=1.24.1" fastapi uvicorn python-multipart
WORKDIR /app
COPY app.py .
ENV HF_HOME=/cache
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
