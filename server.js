import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import { runFinancialAgent, createFinancialAgent } from './agents/financial.js';
import AgentSelector from './agents/AgentSelector.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const FINANCIAL_API_KEY = process.env.FINANCIAL_API_KEY;

// Initialize Agent Selector
let agentSelector;
try {
  agentSelector = new AgentSelector({
    llmApiKey: OPENROUTER_API_KEY,
    llmProvider: 'openrouter',
    llmModel: 'openai/gpt-oss-120b:free'
  });

  // Register financial agent if API key is available
  if (FINANCIAL_API_KEY && OPENROUTER_API_KEY) {
    const financialAgent = createFinancialAgent({
      openrouterApiKey: OPENROUTER_API_KEY,
      financialApiKey: FINANCIAL_API_KEY
    });
    agentSelector.registerAgent('FINANCIAL', financialAgent);
    console.log('Financial agent registered');
  }
} catch (error) {
  console.error('Agent selector initialization failed:', error);
}

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

app.post('/chat', async (req, res) => {
  const { message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  // Legacy support for /finance prefix
  if (message.startsWith('/finance ')) {
    try {
      const result = await runFinancialAgent({
        message: message.replace('/finance ', ''),
        openrouterApiKey: OPENROUTER_API_KEY,
        financialApiKey: FINANCIAL_API_KEY
      });
      return res.json({ 
        text: result.text, 
        toolResult: result.toolResult,
        agent: 'FINANCIAL'
      });
    } catch (error) {
      console.error('Financial agent error:', error);
      return res.status(500).json({ error: error.message || 'financial agent failed' });
    }
  }

  // Use Agent Selector for intelligent routing
  if (agentSelector && OPENROUTER_API_KEY) {
    try {
      const result = await agentSelector.route(message);
      
      return res.json({
        text: result.text,
        toolResult: result.toolResult,
        agent: result.agent,
        toolUsed: result.toolUsed
      });
    } catch (error) {
      console.error('Agent selector error:', error);
      // Fall through to legacy behavior
    }
  }

  // Legacy fallback: direct LLM call
  if (!OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured' });
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b:free',
        messages: [
          { role: 'system', content: 'You are Jarvis, a helpful voice-first assistant.' },
          { role: 'user', content: message }
        ],
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenRouter error:', response.status, errorText);
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    const reply = data?.choices?.[0]?.message?.content?.trim() || 'No response.';
    return res.json({ text: reply, agent: 'GENERAL' });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: error.message || 'chat failed' });
  }
});

app.post('/agent/financial', async (req, res) => {
  const { message } = req.body || {};
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  try {
    const result = await runFinancialAgent({
      message,
      openrouterApiKey: OPENROUTER_API_KEY,
      financialApiKey: FINANCIAL_API_KEY
    });
    return res.json({ text: result.text, toolResult: result.toolResult });
  } catch (error) {
    console.error('Financial agent error:', error);
    return res.status(500).json({ error: error.message || 'financial agent failed' });
  }
});

app.post('/tts', async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
    }

    const { text, voiceId } = req.body || {};
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const voice = voiceId || ELEVENLABS_VOICE_ID;
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.85
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs STT error:', errorText);
      return res.status(response.status).json({ error: errorText });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    const arrayBuffer = await response.arrayBuffer();
    return res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    return res.status(500).json({ error: error.message || 'tts failed' });
  }
});

app.post('/stt', upload.single('audio'), async (req, res) => {
  try {
    if (!ELEVENLABS_API_KEY) {
      return res.status(500).json({ error: 'ELEVENLABS_API_KEY not configured' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'audio file is required' });
    }

    const form = new FormData();
    const mimeType = req.file.mimetype || 'audio/webm';
    const blob = new Blob([req.file.buffer], { type: mimeType });
    form.append('file', blob, 'recording.webm');
    form.append('model_id', 'scribe_v2');
    form.append('language_code', 'eng');
    form.append('tag_audio_events', 'false');
    form.append('diarize', 'false');

    const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY
      },
      body: form
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: errorText });
    }

    const data = await response.json();
    return res.json({ text: data.text || '' });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'stt failed' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
