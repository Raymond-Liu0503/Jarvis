# Agent Selector - Quick Reference

## What is the Agent Selector?

The Agent Selector is an intelligent routing system that automatically determines which specialized agent should handle your request. You don't need to use command prefixes or know which agent to use—just ask naturally!

## How to Use

### Just Ask Naturally

**Financial Questions:**

```
"What's the stock price of Apple?"
"Show me TSLA news"
"How is Microsoft doing?"
"Tell me about the market"
```

**General Questions:**

```
"Tell me a joke"
"What's 42 divided by 7?"
"Who invented the telephone?"
```

**Code Questions:**

```
"How do I sort an array in Python?"
"Explain recursion"
"Debug this function"
```

### Legacy Command Prefix (Still Supported)

```
"/finance AAPL price"
"/finance TSLA news"
```

## How It Works

1. **Quick Pattern Match** (Fast)
   - Scans for financial keywords (stock, price, market, ticker symbols)
   - Detects weather keywords (forecast, rain, temperature)
   - Identifies code keywords (function, debug, python, javascript)

2. **LLM Classification** (Fallback)
   - If no quick match, uses LLM to classify intent
   - Very accurate for ambiguous queries

3. **Caching**
   - Remembers recent routing decisions
   - Makes repeated queries instant

4. **Auto-Formatting**
   - Formats your query for the selected agent
   - Extracts ticker symbols, parameters, etc.

## API Response Format

```json
{
  "text": "The response text",
  "agent": "FINANCIAL",
  "toolResult": {
    /* tool data if used */
  },
  "toolUsed": "getStockPriceSnapshot"
}
```

## Detection Keywords

### Financial Agent

- Keywords: `stock`, `price`, `market`, `ticker`, `nasdaq`, `trading`, `shares`
- Ticker symbols: `AAPL`, `TSLA`, `MSFT`, `$AAPL`
- Company names: `Apple`, `Tesla`, `Microsoft`, `Google`, `Amazon`

### Weather Agent

- Keywords: `weather`, `forecast`, `temperature`, `rain`, `snow`, `sunny`

### Code Agent

- Keywords: `code`, `program`, `function`, `debug`, `python`, `javascript`

### General (Default)

- Everything else goes to general assistant

## Configuration

### Server-Side (server.js)

```javascript
import AgentSelector from "./agents/AgentSelector.js";
import { createFinancialAgent } from "./agents/financial.js";

// Initialize selector
const selector = new AgentSelector({
  llmApiKey: process.env.OPENROUTER_API_KEY,
  llmProvider: "openrouter",
  llmModel: "openai/gpt-oss-120b:free",
});

// Register agents
const financialAgent = createFinancialAgent({
  openrouterApiKey: process.env.OPENROUTER_API_KEY,
  financialApiKey: process.env.FINANCIAL_API_KEY,
});
selector.registerAgent("FINANCIAL", financialAgent);

// Route messages
const result = await selector.route(userMessage);
```

### Adding Custom Agents

```javascript
import agentFactory from "./agents/AgentFactory.js";

// Create custom agent
const myAgent = agentFactory.createCustom({
  name: "MyCustomAgent",
  systemPrompt: "You are a specialized assistant for...",
  llmApiKey: process.env.OPENROUTER_API_KEY,
  // ... other config
});

// Register with selector
selector.registerAgent("MYCUSTOM", myAgent);
```

### Updating Intent Detection

Edit the `quickMatch()` method in [AgentSelector.js](../agents/AgentSelector.js):

```javascript
quickMatch(message) {
  const lower = message.toLowerCase();

  // Add your custom patterns
  if (/your|custom|keywords/i.test(message)) {
    return 'YOURCUSTOMAGENT';
  }

  // ... existing patterns
}
```

## Tips

1. **Be Natural**: No need for special commands or formatting
2. **Use Company Names**: "Apple stock" works as well as "AAPL"
3. **Ticker Symbols**: Can use with or without $ prefix
4. **Context Matters**: "How is Apple doing?" → Financial agent
5. **Fallback**: If uncertain, routes to general assistant

## Troubleshooting

### Wrong Agent Selected?

1. Check if your keywords are in the quick match patterns
2. Verify agent is registered: `selector.listAgents()`
3. Clear cache if testing: `selector.clearCache()`

### Agent Not Found?

Make sure the agent is registered with the selector:

```javascript
console.log(selector.listAgents());
// Should show: ['FINANCIAL', 'WEATHER', 'CODE', ...]
```

### Slow Response?

- First query to an agent initializes the session (slower)
- Subsequent queries are cached (faster)
- Pattern matching is instant, LLM classification takes ~1-2s

## Performance

- **Quick Match**: < 1ms (keyword scanning)
- **LLM Classification**: ~1-2 seconds (only when needed)
- **Cached Results**: Instant (for repeated queries)
- **Cache Size**: 100 recent queries

## Example Queries by Category

### Financial ✓

- "What's the price of AAPL?"
- "Show me Tesla stock news"
- "How did the market close today?"
- "Is Microsoft up or down?"
- "Latest news for $NVDA"

### General ✓

- "Tell me a joke"
- "What's the weather like?" (if no weather agent)
- "Calculate 15% of 200"
- "Who was Albert Einstein?"
- "What time is it?"

### Code ✓ (when Code Agent registered)

- "How to reverse a string in Python"
- "Explain async/await in JavaScript"
- "What's the difference between let and var?"
- "How do I use map() in JavaScript?"

## See Also

- [Agent Module Documentation](../agents/README.md)
- [Creating Custom Agents](../agents/README.md#creating-custom-agents)
- [Examples](../examples/agentSelectorExamples.js)
