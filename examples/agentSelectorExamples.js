/**
 * Agent Selector Examples
 * Demonstrates how to use the intelligent agent routing system
 */

import AgentSelector from './agents/AgentSelector.js';
import { createFinancialAgent } from './agents/financial.js';
import agentFactory from './agents/AgentFactory.js';

// Example 1: Basic Setup with Financial Agent
async function example1() {
  console.log('\n=== Example 1: Basic Agent Selector Setup ===\n');

  const selector = new AgentSelector({
    llmApiKey: process.env.OPENROUTER_API_KEY
  });

  // Register financial agent
  const financialAgent = createFinancialAgent({
    openrouterApiKey: process.env.OPENROUTER_API_KEY,
    financialApiKey: process.env.FINANCIAL_API_KEY
  });
  
  selector.registerAgent('FINANCIAL', financialAgent);

  // Test queries
  const queries = [
    "What's the stock price of Apple?",
    "Tell me about TSLA",
    "How is MSFT doing today?",
    "Tell me a joke"
  ];

  for (const query of queries) {
    console.log(`Query: "${query}"`);
    const result = await selector.route(query);
    console.log(`→ Routed to: ${result.agent}`);
    console.log(`→ Response: ${result.text.substring(0, 100)}...\n`);
  }
}

// Example 2: Custom Agent with Selector
async function example2() {
  console.log('\n=== Example 2: Custom Agent Registration ===\n');

  const selector = new AgentSelector({
    llmApiKey: process.env.OPENROUTER_API_KEY
  });

  // Create a custom weather agent
  const weatherAgent = agentFactory.createFromTemplate('weather', {
    llmApiKey: process.env.OPENROUTER_API_KEY
  });

  selector.registerAgent('WEATHER', weatherAgent);

  // Test weather query
  const result = await selector.route("What's the weather in New York?");
  console.log(`Agent: ${result.agent}`);
  console.log(`Response: ${result.text}`);
}

// Example 3: Intent Detection Demonstration
async function example3() {
  console.log('\n=== Example 3: Intent Detection ===\n');

  const selector = new AgentSelector({
    llmApiKey: process.env.OPENROUTER_API_KEY
  });

  const testCases = [
    { query: "What's AAPL trading at?", expected: "FINANCIAL" },
    { query: "Show me Tesla stock news", expected: "FINANCIAL" },
    { query: "Is it going to rain tomorrow?", expected: "WEATHER" },
    { query: "How do I write a Python function?", expected: "CODE" },
    { query: "What's the capital of France?", expected: "GENERAL" }
  ];

  for (const test of testCases) {
    const detected = await selector.selectAgent(test.query);
    const match = detected === test.expected ? '✓' : '✗';
    console.log(`${match} "${test.query}"`);
    console.log(`   Expected: ${test.expected}, Detected: ${detected}\n`);
  }
}

// Example 4: Message Formatting
async function example4() {
  console.log('\n=== Example 4: Message Formatting ===\n');

  const selector = new AgentSelector({
    llmApiKey: process.env.OPENROUTER_API_KEY
  });

  const queries = [
    "What's the price of AAPL?",
    "Show me news for Tesla",
    "How is Microsoft stock doing?"
  ];

  for (const query of queries) {
    const agentName = await selector.selectAgent(query);
    const formatted = selector.formatMessageForAgent(query, agentName);
    console.log(`Original: "${query}"`);
    console.log(`Formatted: "${formatted}"`);
    console.log(`Agent: ${agentName}\n`);
  }
}

// Example 5: Multiple Agents
async function example5() {
  console.log('\n=== Example 5: Multiple Agent System ===\n');

  const selector = new AgentSelector({
    llmApiKey: process.env.OPENROUTER_API_KEY
  });

  // Register multiple agents
  if (process.env.FINANCIAL_API_KEY) {
    const financialAgent = createFinancialAgent({
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      financialApiKey: process.env.FINANCIAL_API_KEY
    });
    selector.registerAgent('FINANCIAL', financialAgent);
  }

  const weatherAgent = agentFactory.createFromTemplate('weather', {
    llmApiKey: process.env.OPENROUTER_API_KEY
  });
  selector.registerAgent('WEATHER', weatherAgent);

  const codeAgent = agentFactory.createFromTemplate('code', {
    llmApiKey: process.env.OPENROUTER_API_KEY
  });
  selector.registerAgent('CODE', codeAgent);

  // Display stats
  const stats = selector.getStats();
  console.log('Registered Agents:', stats.registeredAgents);
  console.log('Cache Size:', stats.cacheSize);
  
  // Test diverse queries
  const queries = [
    "What's AAPL stock price?",
    "Weather forecast for Seattle",
    "How to sort an array in JavaScript"
  ];

  for (const query of queries) {
    const result = await selector.route(query);
    console.log(`\nQuery: "${query}"`);
    console.log(`Agent: ${result.agent}`);
    if (result.toolUsed) {
      console.log(`Tool Used: ${result.toolUsed}`);
    }
  }
}

// Example 6: Cache Performance
async function example6() {
  console.log('\n=== Example 6: Cache Performance ===\n');

  const selector = new AgentSelector({
    llmApiKey: process.env.OPENROUTER_API_KEY
  });

  const query = "What's the stock price of Apple?";

  // First call (not cached)
  console.time('First call (uncached)');
  await selector.selectAgent(query);
  console.timeEnd('First call (uncached)');

  // Second call (cached)
  console.time('Second call (cached)');
  await selector.selectAgent(query);
  console.timeEnd('Second call (cached)');

  console.log(`\nCache size: ${selector.getStats().cacheSize}`);
}

// Run examples
async function runExamples() {
  try {
    // Uncomment the examples you want to run
    
    // await example1(); // Basic setup
    // await example2(); // Custom agent
    await example3(); // Intent detection (no API calls needed if using quick match)
    // await example4(); // Message formatting
    // await example5(); // Multiple agents
    // await example6(); // Cache performance

  } catch (error) {
    console.error('Example error:', error);
  }
}

// Only run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples();
}

export { example1, example2, example3, example4, example5, example6 };
