
import os
import base64
import time
import tempfile
from pathlib import Path

from flask import Flask, jsonify, render_template, request
from dotenv import load_dotenv
from google import genai

load_dotenv()

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 15 * 1024 * 1024

API_KEY = os.getenv("GEMINI_API_KEY")
MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")

client = genai.Client(api_key=API_KEY) if API_KEY else None


@app.get("/")
def home():
    return render_template("index.html")


@app.get("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "gemini_configured": client is not None
    })



@app.post("/api/transcribe")
def transcribe():
    if client is None:
        return jsonify({
            "error": "Gemini API key is not configured."
        }), 500

    if "video" not in request.files:
        return jsonify({
            "error": "No camera clip received."
        }), 400

    video = request.files["video"]

    if not video.filename:
        return jsonify({
            "error": "Empty camera clip."
        }), 400

    try:
        # Read the short clip directly instead of saving and uploading it.
        video_bytes = video.read()

        if len(video_bytes) < 1000:
            return jsonify({
                "text": "",
                "message": "Clip too short. Try recording again."
            })

        # Base64 increases payload size by roughly one third.
        # Keep inline requests comfortably below Gemini's request limit.
        if len(video_bytes) > 10 * 1024 * 1024:
            return jsonify({
                "error": "Video is too large for inline processing. "
                         "Please record a shorter clip."
            }), 413

        mime_type = video.mimetype or "video/webm"
        if mime_type != "video/webm":
            return jsonify({
                "error": f"Unsupported camera video type: {mime_type}"
            }), 415

        prompt = """
        Perform experimental visual-only lip reading on this silent video.

        Predict the English words most strongly supported by the visible
        mouth movements across the sequence of frames.

        Do not use audio. Do not invent words from the scene or context.
        If the movements are insufficient to infer words, return [unclear].

        Return only the predicted words, without explanations.
        """

        app.logger.info(
            "Transcription started: %.1f KB, model=%s",
            len(video_bytes) / 1024,
            MODEL_NAME
        )

        started = time.monotonic()

        interaction = client.interactions.create(
            model=MODEL_NAME,
            input=[
                {
                    "type": "video",
                    "data": base64.b64encode(video_bytes).decode("ascii"),
                    "mime_type": mime_type,
                    # "processing": {
                    #     "type": "static",
                    #     "fps": 2
                    # }
                },
                {
                    "type": "text",
                    "text": prompt
                }
            ]
        )

        elapsed = time.monotonic() - started
        text = (interaction.output_text or "").strip()

        app.logger.info(
            "Gemini inference completed in %.2f seconds",
            elapsed
        )

        return jsonify({
            "text": text,
            "message": "Analysis complete.",
            "processing_seconds": round(elapsed, 2)
        })

    except Exception as exc:
        app.logger.exception("Transcription request failed")
        return jsonify({
            "error": "Transcription failed. Check server logs.",
            "detail": str(exc)
        }), 500


if __name__ == "__main__":
    app.run(debug=True, port=5000)
