const chatEl = document.getElementById('chat');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const recordBtn = document.getElementById('recordBtn');
const statusEl = document.getElementById('status');
const recordIcon = document.getElementById('recordIcon');
const voiceToggle = document.getElementById('voiceToggle');

let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let stopTimer;
let activeAudio;
let voiceEnabled = true;

const appendMessage = (text, role) => {
  const message = document.createElement('div');
  message.className = `message ${role}`;
  message.textContent = text;
  chatEl.appendChild(message);
  chatEl.scrollTop = chatEl.scrollHeight;
};

const setStatus = (text) => {
  statusEl.textContent = text;
};

const sendMessage = async (text) => {
  appendMessage(text, 'user');
  setStatus('Thinking');

  const chatResponse = await fetch('/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text })
  });

  if (!chatResponse.ok) {
    const errorText = await chatResponse.text();
    setStatus(`Error: ${errorText || chatResponse.status}`);
    return;
  }

  const chatData = await chatResponse.json();
  const reply = chatData.text || 'No response.';
  appendMessage(reply, 'bot');

  if (voiceEnabled) {
    setStatus('Speaking');
    await playTts(reply);
  }
  setStatus('Idle');
};

const playTts = async (text) => {
  const response = await fetch('/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  if (!response.ok) {
    setStatus('TTS error');
    return;
  }

  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  if (activeAudio) {
    activeAudio.pause();
    activeAudio = undefined;
  }

  const audio = new Audio(audioUrl);
  activeAudio = audio;
  await audio.play();
};

const handleSend = async () => {
  const text = textInput.value.trim();
  if (!text) return;
  textInput.value = '';
  await sendMessage(text);
};

sendBtn.addEventListener('click', handleSend);
textInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    handleSend();
  }
});

const stopRecording = () => {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
};

recordBtn.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus('Mic not supported');
    return;
  }

  if (activeAudio) {
    activeAudio.pause();
    activeAudio = undefined;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
  } catch (error) {
    setStatus('Mic permission denied');
    return;
  }

  const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  mediaRecorder = new MediaRecorder(stream, { mimeType: preferredType });
  audioChunks = [];
  isRecording = true;
  recordIcon.textContent = '⏹️';
  setStatus('Listening');

  mediaRecorder.ondataavailable = (event) => {
    audioChunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    if (stopTimer) {
      clearTimeout(stopTimer);
      stopTimer = undefined;
    }
    isRecording = false;
    recordIcon.textContent = '🎙️';
    setStatus('Transcribing');

    stream.getTracks().forEach((track) => track.stop());

    if (!audioChunks.length) {
      setStatus('No audio captured');
      return;
    }

    const audioBlob = new Blob(audioChunks, { type: preferredType });
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    const response = await fetch('/stt', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      setStatus(`STT error: ${errorText || response.status}`);
      return;
    }

    const data = await response.json();
    const text = data.text || '';

    if (text) {
      textInput.value = text;
      await handleSend();
    } else {
      setStatus('No speech detected');
    }
  };

  mediaRecorder.start();
  stopTimer = setTimeout(stopRecording, 6000);
});

voiceToggle.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  voiceToggle.textContent = voiceEnabled ? '🔊 Voice On' : '🔇 Voice Off';
  voiceToggle.classList.toggle('off', !voiceEnabled);
});
