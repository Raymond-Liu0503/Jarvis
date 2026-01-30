# Jarvis Chatbot

Intelligent AI assistant with automatic agent routing, voice input/output, and specialized agent modules.

## Features

- **Intelligent Agent Routing**: Automatically detects user intent and routes to specialized agents
- **Voice Input/Output**: ElevenLabs speech-to-text and text-to-speech
- **Specialized Agents**: Financial data, weather, code help, and more
- **Modular Architecture**: Easy to add new agent capabilities

## Setup

1. Copy [.env.example](.env.example) to `.env` and add your API keys:
   - `OPENROUTER_API_KEY` - Required for LLM
   - `ELEVENLABS_API_KEY` - Required for voice features
   - `FINANCIAL_API_KEY` - Optional, enables financial agent
2. Install dependencies:
   - `npm install`
3. Start the server:
   - `npm run dev`
4. Open http://localhost:3000

## How It Works

The system uses an intelligent **Agent Selector** that analyzes your message and automatically routes it to the appropriate specialized agent:

```
User Message → Agent Selector → [Quick Pattern Match → LLM Classification]
                                              ↓
                     ┌────────────────────────┼────────────────────────┐
                     ↓                        ↓                        ↓
              FINANCIAL Agent           WEATHER Agent           GENERAL Response
              (with MCP tools)         (if registered)          (direct LLM)
```

### Natural Language Examples

**Financial Queries** (automatically routed to Financial Agent):

- "What's the stock price of Apple?"
- "Show me TSLA news"
- "How is the market doing?"
- "Tell me about Microsoft stock"

**General Queries** (handled by general assistant):

- "Tell me a joke"
- "What's 25 + 37?"
- "Who won the Super Bowl?"

**Code Queries** (routed to Code Agent when available):

- "How do I sort an array in Python?"
- "Debug this JavaScript function"

### Manual Agent Selection (Legacy)

You can still explicitly select an agent using prefixes:

- `/finance AAPL price` - Financial agent

## Endpoints

- `POST /chat` - Main chat endpoint with intelligent routing
  - Automatically selects the appropriate agent
  - Returns `{ text, toolResult, agent, toolUsed }`
- `POST /stt` - Speech-to-text via ElevenLabs
- `POST /tts` - Text-to-speech via ElevenLabs
- `POST /agent/financial` - Direct financial agent access

## Architecture

The system implements an intelligent agentic architecture:

1. **Perception**: Capture user input (text or speech)
2. **Reasoning**: Agent Selector analyzes intent and selects appropriate agent
3. **Action**: Execute the selected agent with tools and return response

### Agent Selector

The Agent Selector uses a two-stage approach:

1. **Quick Pattern Matching**: Fast keyword detection for common queries
2. **LLM Classification**: For ambiguous cases, uses LLM to classify intent
3. **Caching**: Remembers recent routing decisions for speed

### Adding New Agents

See [agents/README.md](agents/README.md) for documentation on creating custom agents.

```javascript
import agentFactory from "./agents/AgentFactory.js";

// Create custom agent
const myAgent = agentFactory.createCustom({
  name: "MyAgent",
  systemPrompt: "Your instructions...",
  llmApiKey: process.env.OPENROUTER_API_KEY,
  // ... configuration
});

// Register with selector
agentSelector.registerAgent("MYAGENT", myAgent);
```
