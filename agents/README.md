# Agent Module System

A flexible, secure system for creating custom AI agents with MCP tool integration.

## Overview

The Agent Module system allows you to create specialized AI agents that can:

- Integrate with MCP (Model Context Protocol) tools
- Execute custom prompts and workflows
- Handle API calls with retry logic and error handling
- Apply rate limiting and security measures
- Extract parameters and match user intent

## Quick Start

### Using a Template

```javascript
import agentFactory from "./agents/AgentFactory.js";

// Create a financial agent from template
const financialAgent = agentFactory.createFromTemplate("financial", {
  llmApiKey: "your-openrouter-api-key",
  mcpApiKey: "your-mcp-api-key",
});

// Run the agent
const result = await financialAgent.run("What is the price of AAPL?");
console.log(result.text);
```

### Creating a Custom Agent

```javascript
import AgentModule from "./agents/AgentModule.js";

const customAgent = new AgentModule({
  name: "MyCustomAgent",
  description: "Does something specific",
  systemPrompt: "You are a helpful assistant that...",

  // LLM Configuration
  llmApiKey: "your-api-key",
  llmProvider: "openrouter",
  llmModel: "openai/gpt-oss-120b:free",

  // MCP Configuration (optional)
  mcpBaseUrl: "https://api.example.com",
  mcpApiKey: "your-mcp-key",

  // Define tools
  tools: [{ name: "myTool", description: "What it does" }],

  // Intent matching
  intentMatchers: [
    {
      test: (text) => /keyword/i.test(text),
      toolName: "myTool",
    },
  ],

  // Parameter extraction
  paramExtractors: [
    {
      name: "param1",
      fn: (text) => {
        // Extract and return parameter
        const match = text.match(/pattern/);
        return match ? match[1] : undefined;
      },
    },
  ],
});

// Use the agent
const result = await customAgent.run("user message here");
```

## Configuration Options

### Required Fields

- `name` - Agent name (string)
- `systemPrompt` - Instructions for the LLM (string, max 10,000 chars)
- `llmApiKey` - API key for LLM provider (string)

### Optional Fields

- `description` - Agent description (string)
- `mcpBaseUrl` - Base URL for MCP server (string, must be valid HTTP/HTTPS URL)
- `mcpApiKey` - API key for MCP authentication (string)
- `llmProvider` - LLM provider (default: 'openrouter')
- `llmModel` - Model to use (default: 'openai/gpt-oss-120b:free')
- `tools` - Array of tool definitions
- `intentMatchers` - Array of intent matching rules
- `paramExtractors` - Array of parameter extraction functions
- `timeout` - Request timeout in ms (default: 30000)
- `maxRetries` - Max retry attempts (default: 3)
- `rateLimitWindow` - Rate limit window in ms (default: 60000)
- `maxRequestsPerWindow` - Max requests per window (default: 20)

## Safety Features

### Input Validation

- URL validation for API endpoints
- Configuration validation on initialization
- Input sanitization (removes scripts, limits length)
- Type checking for all parameters

### Error Handling

- Automatic retry with exponential backoff
- Timeout protection on all network requests
- Session management with auto-reconnection
- Graceful degradation (continues without tools if they fail)

### Rate Limiting

- Per-agent request tracking
- Configurable rate limits
- Sliding window algorithm

### Security

- Input sanitization to prevent injection
- Maximum input length (10,000 chars)
- Maximum system prompt length (10,000 chars)
- Tool context truncation (50,000 chars)
- API key validation

## Available Templates

### Financial Agent

```javascript
agentFactory.createFromTemplate("financial", {
  llmApiKey: "your-key",
  mcpApiKey: "financial-api-key",
});
```

Access to real-time stock prices, news, and financial data.

### Weather Agent

```javascript
agentFactory.createFromTemplate("weather", {
  llmApiKey: "your-key",
});
```

Weather information and forecasts.

### Code Helper Agent

```javascript
agentFactory.createFromTemplate("code", {
  llmApiKey: "your-key",
});
```

Programming assistance and code generation.

## Creating Custom Templates

```javascript
import agentFactory from './agents/AgentFactory.js';

agentFactory.registerTemplate('myTemplate', {
  name: 'MyTemplateAgent',
  description: 'What it does',
  systemPrompt: 'System instructions...',
  mcpBaseUrl: 'optional-url',
  tools: [...],
  intentMatchers: [...],
  paramExtractors: [...]
});

// Use the template
const agent = agentFactory.createFromTemplate('myTemplate', {
  llmApiKey: 'key',
  mcpApiKey: 'key'
});
```

## API Reference

### AgentModule Class

#### Methods

- `run(message)` - Execute the agent with a user message
- `resetSession()` - Reset MCP session (useful for troubleshooting)
- `getInfo()` - Get agent information

#### Return Format

```javascript
{
  success: true/false,
  text: 'Response text',
  toolResult: {...},  // Tool output if used
  toolUsed: 'toolName',  // Name of tool used
  error: 'error message'  // Only present if success=false
}
```

### AgentFactory

#### Methods

- `createFromTemplate(name, config)` - Create from template
- `createCustom(config)` - Create custom agent
- `registerTemplate(name, template)` - Add new template
- `getAgent(name)` - Retrieve agent by name
- `listAgents()` - List all registered agents
- `listTemplates()` - List available templates
- `removeAgent(name)` - Remove agent from registry
- `clearAgents()` - Clear all agents

## Error Handling Best Practices

```javascript
const result = await agent.run(message);

if (result.success) {
  console.log("Response:", result.text);
  if (result.toolUsed) {
    console.log("Tool used:", result.toolUsed);
    console.log("Tool result:", result.toolResult);
  }
} else {
  console.error("Error:", result.error);
  // Result still includes a user-friendly error message in result.text
}
```

## Examples

### Example 1: News Aggregator Agent

```javascript
const newsAgent = new AgentModule({
  name: "NewsAgent",
  systemPrompt: "You are a news aggregator. Summarize news articles concisely.",
  llmApiKey: process.env.OPENROUTER_KEY,
  mcpBaseUrl: "https://news-api.example.com",
  mcpApiKey: process.env.NEWS_KEY,
  tools: [
    { name: "getTopHeadlines", description: "Get top news headlines" },
    { name: "searchNews", description: "Search for specific news" },
  ],
  intentMatchers: [
    {
      test: (text) => /top|latest|breaking/i.test(text),
      toolName: "getTopHeadlines",
    },
    { test: (text) => /search|find|about/i.test(text), toolName: "searchNews" },
  ],
  paramExtractors: [
    {
      name: "query",
      fn: (text) => text.replace(/search|find|about/i, "").trim(),
    },
  ],
});
```

### Example 2: Simple Q&A Agent (No Tools)

```javascript
const qaAgent = new AgentModule({
  name: "QAAgent",
  systemPrompt:
    "You are a helpful Q&A assistant. Answer questions clearly and concisely.",
  llmApiKey: process.env.OPENROUTER_KEY,
});

const result = await qaAgent.run("What is the capital of France?");
```

### Example 3: Multi-Tool Agent

```javascript
const multiAgent = new AgentModule({
  name: "MultiAgent",
  systemPrompt: "You are a versatile assistant with access to multiple tools.",
  llmApiKey: process.env.OPENROUTER_KEY,
  mcpBaseUrl: "https://api.example.com",
  mcpApiKey: process.env.MCP_KEY,
  tools: [
    { name: "calculateMath", description: "Perform calculations" },
    { name: "translateText", description: "Translate between languages" },
    { name: "getDefinition", description: "Get word definitions" },
  ],
  intentMatchers: [
    {
      test: (text) => /calculate|compute|math/i.test(text),
      toolName: "calculateMath",
    },
    { test: (text) => /translate/i.test(text), toolName: "translateText" },
    {
      test: (text) => /define|definition|meaning/i.test(text),
      toolName: "getDefinition",
    },
  ],
  paramExtractors: [
    {
      name: "expression",
      fn: (text) => {
        const match = text.match(/calculate|compute\s+(.+)/i);
        return match ? match[1] : undefined;
      },
    },
    {
      name: "word",
      fn: (text) => {
        const match = text.match(/define\s+(\w+)/i);
        return match ? match[1] : undefined;
      },
    },
  ],
});
```

## Troubleshooting

### Session Issues

```javascript
// Reset the MCP session if experiencing connection issues
agent.resetSession();
```

### Rate Limiting

```javascript
// Adjust rate limiting for high-volume scenarios
const agent = new AgentModule({
  // ... other config
  maxRequestsPerWindow: 50,
  rateLimitWindow: 60000, // 1 minute
});
```

### Timeout Issues

```javascript
// Increase timeout for slow APIs
const agent = new AgentModule({
  // ... other config
  timeout: 60000, // 60 seconds
});
```

## License

MIT
