const camera = document.getElementById("camera");
const placeholder = document.getElementById("placeholder");
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const cameraBadge = document.getElementById("cameraBadge");
const activity = document.getElementById("activity");
const transcript = document.getElementById("transcript");
const wordCount = document.getElementById("wordCount");

const startCameraBtn = document.getElementById("startCamera");
const stopCameraBtn = document.getElementById("stopCamera");
const startBtn = document.getElementById("startTranscription");
const pauseBtn = document.getElementById("pauseTranscription");
const copyBtn = document.getElementById("copyText");
const clearBtn = document.getElementById("clearText");

let stream = null;
let isTranscribing = false;
let transcriptParts = [];
let lastResult = "";
let requestInProgress = false;

function setStatus(message, online = false) {
  statusText.textContent = message;
  statusDot.classList.toggle("online", online);
  activity.textContent = message;
}

function renderTranscript() {
  const text = transcriptParts.join(" ").trim();

  transcript.replaceChildren();

  if (!text) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent =
      "Your predicted words will appear here once analysis begins.";
    transcript.appendChild(empty);
  } else {
    const result = document.createElement("p");
    result.textContent = text;
    transcript.appendChild(result);
  }

  wordCount.textContent = `${text ? text.split(/\s+/).length : 0} words`;

  copyBtn.disabled = !text;
}

async function enableCamera() {
  try {
    setStatus("Requesting camera permission...");

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Camera API unavailable. Open the site on localhost using Chrome.",
      );
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    console.log("Available camera devices:", devices);

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });

    camera.srcObject = stream;
    await camera.play();

    placeholder.hidden = true;
    cameraBadge.textContent = "CAMERA ON";

    startCameraBtn.disabled = true;
    stopCameraBtn.disabled = false;
    startBtn.disabled = false;

    setStatus("Camera connected", true);
  } catch (error) {
    console.error("Camera error:", error.name, error.message);

    setStatus(`Camera error: ${error.name} - ${error.message}`);
    alert(`Unable to open camera:\n${error.name}\n${error.message}`);
  }
}

function stopCamera() {
  isTranscribing = false;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  camera.srcObject = null;
  placeholder.hidden = false;
  cameraBadge.textContent = "OFFLINE";

  startCameraBtn.disabled = false;
  stopCameraBtn.disabled = true;
  startBtn.disabled = true;
  pauseBtn.disabled = true;

  setStatus("Camera offline");
}

function recordClip() {
  return new Promise((resolve, reject) => {
    if (!stream || !stream.active) {
      reject(new Error("Camera is not active."));
      return;
    }

    let recorder;

    try {
      const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );

      if (!mimeType) {
        reject(new Error("This browser does not support WebM recording."));
        return;
      }

      recorder = new MediaRecorder(stream, { mimeType });
    } catch (error) {
      reject(error);
      return;
    }

    const chunks = [];

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      reject(new Error("Camera recording failed."));
    };

    recorder.onstop = () => {
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };

    recorder.start();

    // Capture a short sequence of mouth movements.
    setTimeout(() => {
      if (recorder.state !== "inactive") {
        recorder.stop();
      }
    }, 2000);
  });
}

async function analyzeClip(blob) {
  const formData = new FormData();

  formData.append("video", blob, "camera-clip.webm");

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: formData,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Transcription request failed.");
  }

  const text = (data.text || "").trim();

  if (text && text !== "[unclear]" && text !== lastResult) {
    transcriptParts.push(text);
    lastResult = text;
    renderTranscript();
  }

  return text;
}

async function startTranscription() {
  if (!stream || isTranscribing || requestInProgress) return;

  isTranscribing = true;
  startBtn.disabled = true;
  pauseBtn.disabled = false;

  setStatus("Listening to visual movements...", true);

  while (isTranscribing && stream && stream.active) {
    try {
      const clip = await recordClip();

      if (!isTranscribing) break;

      requestInProgress = true;
      setStatus("Analyzing mouth movements...", true);

      const text = await analyzeClip(clip);
      // if (isTranscribing) {
      //   await new Promise(resolve => setTimeout(resolve, 10000));
      // }

      if (isTranscribing) {
        setStatus(
          text
            ? "Analysis complete. Capturing next clip..."
            : "No clear words detected. Keep your face visible.",
          true,
        );
      }
    } catch (error) {
      console.error(error);

      if (isTranscribing) {
        setStatus(`Analysis error: ${error.message}`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    } finally {
      requestInProgress = false;
    }
  }

  if (isTranscribing) {
    isTranscribing = false;
  }

  startBtn.disabled = !stream || !stream.active;
  pauseBtn.disabled = true;
}

function pauseTranscription() {
  isTranscribing = false;
  pauseBtn.disabled = true;
  startBtn.disabled = !stream || !stream.active;
  setStatus("Transcription paused", Boolean(stream && stream.active));
}

startCameraBtn.addEventListener("click", enableCamera);
stopCameraBtn.addEventListener("click", stopCamera);
startBtn.addEventListener("click", startTranscription);
pauseBtn.addEventListener("click", pauseTranscription);

clearBtn.addEventListener("click", () => {
  transcriptParts = [];
  lastResult = "";
  renderTranscript();
});

copyBtn.addEventListener("click", async () => {
  const text = transcriptParts.join(" ").trim();

  if (text) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("Transcript copied", true);
    } catch (error) {
      setStatus("Unable to copy. Check browser permissions.");
    }
  }
});

window.addEventListener("beforeunload", () => {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
});

fetch("/api/health")
  .then((response) => response.json())
  .then((data) => {
    if (!data.gemini_configured) {
      setStatus("Gemini API key is not configured.");
    }
  })
  .catch(() => setStatus("Backend connection unavailable"));

renderTranscript();
