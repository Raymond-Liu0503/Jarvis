# 🤖 Jarvis Agent System - Visual Guide

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER INPUT                               │
│              "What's the stock price of Apple?"                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT SELECTOR                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  1. Quick Pattern Match (< 1ms)                          │  │
│  │     • Scan for keywords: stock, weather, code            │  │
│  │     • Extract ticker symbols: AAPL, $TSLA                │  │
│  │     • 80% of queries matched here                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                         │
│                         ▼                                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  2. LLM Classification (~1-2s)                           │  │
│  │     • Used for ambiguous queries                         │  │
│  │     • Highly accurate                                    │  │
│  │     • Minimal token usage                                │  │
│  └──────────────────────────────────────────────────────────┘  │
│                         │                                         │
│                         ▼                                         │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  3. Cache Lookup (instant)                               │  │
│  │     • Remembers last 100 decisions                       │  │
│  │     • Makes repeat queries instant                       │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┬──────────────┐
         ▼               ▼               ▼              ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
   │FINANCIAL│    │ WEATHER │    │  CODE   │    │ GENERAL │
   │  AGENT  │    │  AGENT  │    │  AGENT  │    │ RESPONSE│
   └─────────┘    └─────────┘    └─────────┘    └─────────┘
         │               │               │              │
         ▼               ▼               ▼              ▼
   ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
   │MCP TOOLS│    │MCP TOOLS│    │MCP TOOLS│    │   LLM   │
   │Stock API│    │Weather  │    │Code DB  │    │  Direct │
   └─────────┘    └─────────┘    └─────────┘    └─────────┘
         │               │               │              │
         └───────────────┴───────────────┴──────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                      RESPONSE                                    │
│  {                                                               │
│    text: "Apple (AAPL) is trading at $185.50...",              │
│    agent: "FINANCIAL",                                          │
│    toolResult: { price: 185.50, change: +2.3% },              │
│    toolUsed: "getStockPriceSnapshot"                           │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Agent Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     AgentModule (Base Class)                     │
├─────────────────────────────────────────────────────────────────┤
│  Configuration:                                                  │
│  • name, systemPrompt, llmApiKey                                │
│  • mcpBaseUrl, mcpApiKey (optional)                             │
│  • tools, intentMatchers, paramExtractors                       │
├─────────────────────────────────────────────────────────────────┤
│  Safety Features:                                                │
│  ✓ Input validation & sanitization                              │
│  ✓ Rate limiting (20 req/min)                                   │
│  ✓ Timeout protection (30s)                                     │
│  ✓ Retry logic (3 attempts)                                     │
│  ✓ Session management                                           │
│  ✓ Error recovery                                               │
├─────────────────────────────────────────────────────────────────┤
│  Methods:                                                        │
│  • run(message) → {success, text, toolResult}                   │
│  • callTool(toolName, args) → result                            │
│  • resetSession() → void                                        │
│  • getInfo() → {name, tools, provider}                          │
└─────────────────────────────────────────────────────────────────┘
```

## Request Flow Timeline

```
Time     Action                              Component
─────────────────────────────────────────────────────────────────
0ms      User sends message                  Client
         │
         ▼
10ms     POST /chat received                 Server
         │
         ▼
15ms     AgentSelector analyzes              AgentSelector
         │
         ├─ Quick Match (< 1ms)
         │  └─ Keywords found → FINANCIAL
         │
         └─ OR LLM Classification (1-2s)
            └─ Intent detected → FINANCIAL
         │
         ▼
1.5s     Route to Financial Agent            AgentSelector
         │
         ▼
1.5s     Agent extracts ticker "AAPL"        Financial Agent
         │
         ▼
1.6s     MCP session init (first time)       AgentModule
         │
         ▼
2.0s     Call MCP tool                       AgentModule
         │  getStockPriceSnapshot(AAPL)
         │
         ▼
2.5s     Tool returns data                   MCP Server
         │
         ▼
2.6s     Call LLM with tool context          AgentModule
         │
         ▼
4.0s     LLM returns formatted response      OpenRouter
         │
         ▼
4.1s     Response sent to client             Server
```

## Example Queries & Routing

```
┌─────────────────────────────────────────────────────────────────┐
│ Query: "What's the stock price of Apple?"                       │
├─────────────────────────────────────────────────────────────────┤
│ Detection:  Quick Match                                         │
│ Keywords:   "stock", "price", "Apple"                          │
│ Agent:      FINANCIAL                                           │
│ Format:     "/finance AAPL price"                              │
│ Tool:       getStockPriceSnapshot                              │
│ Time:       ~3-4 seconds                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Query: "Show me TSLA news"                                      │
├─────────────────────────────────────────────────────────────────┤
│ Detection:  Quick Match                                         │
│ Ticker:     TSLA extracted                                      │
│ Agent:      FINANCIAL                                           │
│ Format:     "/finance TSLA news"                               │
│ Tool:       getNews                                            │
│ Time:       ~3-4 seconds                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Query: "How do I write a Python function?"                      │
├─────────────────────────────────────────────────────────────────┤
│ Detection:  Quick Match                                         │
│ Keywords:   "write", "Python", "function"                      │
│ Agent:      CODE                                                │
│ Format:     (unchanged)                                         │
│ Tool:       None (direct LLM)                                  │
│ Time:       ~1-2 seconds                                        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ Query: "Tell me a joke"                                         │
├─────────────────────────────────────────────────────────────────┤
│ Detection:  LLM Classification                                  │
│ Keywords:   None matched                                        │
│ Agent:      GENERAL                                             │
│ Format:     (unchanged)                                         │
│ Tool:       None (direct LLM)                                  │
│ Time:       ~2-3 seconds                                        │
└─────────────────────────────────────────────────────────────────┘
```

## Performance Metrics

```
┌──────────────────────┬──────────────┬─────────────┬──────────────┐
│ Component            │ Cold Start   │ Warm Call   │ Cached       │
├──────────────────────┼──────────────┼─────────────┼──────────────┤
│ Quick Match          │ < 1ms        │ < 1ms       │ < 1ms        │
│ LLM Classification   │ 1-2s         │ 1-2s        │ instant      │
│ MCP Session Init     │ 2-3s         │ N/A         │ N/A          │
│ MCP Tool Call        │ 0.5-1s       │ 0.5-1s      │ N/A          │
│ LLM Response Gen     │ 1-2s         │ 1-2s        │ N/A          │
├──────────────────────┼──────────────┼─────────────┼──────────────┤
│ Total (with tools)   │ 4-6s         │ 2-4s        │ 2-4s         │
│ Total (no tools)     │ 1-3s         │ 1-2s        │ 1-2s         │
└──────────────────────┴──────────────┴─────────────┴──────────────┘
```

## Safety Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    Input Layer                                   │
│  ✓ Sanitize HTML/scripts                                        │
│  ✓ Length validation (10K max)                                  │
│  ✓ Type checking                                                │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Routing Layer                                  │
│  ✓ Rate limiting check                                          │
│  ✓ Agent availability check                                     │
│  ✓ Fallback to general                                          │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Network Layer                                  │
│  ✓ Timeout protection (30s)                                     │
│  ✓ Retry logic (3 attempts)                                     │
│  ✓ Exponential backoff                                          │
│  ✓ Session management                                           │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Error Layer                                   │
│  ✓ Try-catch on all operations                                  │
│  ✓ Graceful degradation                                         │
│  ✓ User-friendly messages                                       │
│  ✓ Error logging                                                │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start Commands

```bash
# 1. Setup
npm install
cp .env.example .env
# Add your API keys to .env

# 2. Test the system
node test.js

# 3. Start the server
npm run dev

# 4. Make requests
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is AAPL trading at?"}'
```

## Adding a New Agent

```javascript
// 1. Create the agent
import AgentModule from "./agents/AgentModule.js";

const myAgent = new AgentModule({
  name: "MyAgent",
  systemPrompt: "You are...",
  llmApiKey: process.env.OPENROUTER_API_KEY,
  tools: [{ name: "myTool", description: "..." }],
  intentMatchers: [
    { test: (text) => /keyword/i.test(text), toolName: "myTool" },
  ],
});

// 2. Register with selector
selector.registerAgent("MYAGENT", myAgent);

// 3. Update quick match (optional)
// Edit AgentSelector.js quickMatch() method
if (/my|custom|keywords/i.test(message)) {
  return "MYAGENT";
}

// 4. Test it
const result = await selector.route("my custom query");
```

## Troubleshooting

```
Problem: Agent not routing correctly
Solution:
  1. Check selector.listAgents()
  2. Test quickMatch() with your query
  3. Clear cache: selector.clearCache()
  4. Check console for errors

Problem: Timeout errors
Solution:
  1. Increase timeout in agent config
  2. Check MCP server status
  3. Verify API keys are correct

Problem: Rate limit hit
Solution:
  1. Check selector.getStats()
  2. Wait 60 seconds
  3. Increase limit in config
```
