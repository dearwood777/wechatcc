"""faster-whisper STT helper for WeChat bridge.
Usage: python whisper_stt.py <wav_file>
Outputs transcribed text to stdout.
"""
import sys
import os
import warnings
warnings.filterwarnings("ignore")

# Add cuBLAS 12 DLL path for GPU support
_cublas_bin = r'C:\Users\Administrator\AppData\Local\Programs\Python\Python313\Lib\site-packages\nvidia\cublas\bin'
if os.path.isdir(_cublas_bin):
    os.environ['PATH'] = _cublas_bin + os.pathsep + os.environ.get('PATH', '')

def main():
    if len(sys.argv) < 2:
        print("", flush=True)
        return

    wav_path = sys.argv[1]
    if not os.path.exists(wav_path):
        print("", flush=True)
        return

    from faster_whisper import WhisperModel

    # Use local tiny model directly
    model_path = os.path.join(os.path.dirname(__file__), "whisper-models", "tiny-model")

    # Try GPU first, fall back to CPU
    model = None
    for device, compute in [("cuda", "float16"), ("cpu", "int8")]:
        try:
            model = WhisperModel(
                model_path,
                device=device,
                compute_type=compute,
            )
            break
        except Exception as e:
            print(f"  -> {device}/{compute} failed: {e}", file=sys.stderr, flush=True)
            continue

    if model is None:
        print("", flush=True)
        return

    try:
        segments, info = model.transcribe(wav_path, language="zh", beam_size=5)
        text = " ".join(seg.text for seg in segments)
        print(text.strip(), flush=True)
    except Exception as e:
        print(f"", flush=True)

if __name__ == "__main__":
    main()
