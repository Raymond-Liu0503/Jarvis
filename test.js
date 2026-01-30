/**
 * Quick Test Script
 * Verifies the Agent Selector system is working
 */

import 'dotenv/config';
import AgentSelector from './agents/AgentSelector.js';
import { createFinancialAgent } from './agents/financial.js';

console.log('🧪 Testing Agent Selector System\n');

// Check environment variables
console.log('📋 Environment Check:');
console.log(`  OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? '✓ Set' : '✗ Missing'}`);
console.log(`  FINANCIAL_API_KEY: ${process.env.FINANCIAL_API_KEY ? '✓ Set' : '✗ Missing (optional)'}`);
console.log('');

if (!process.env.OPENROUTER_API_KEY) {
  console.error('❌ OPENROUTER_API_KEY is required. Please set it in your .env file.');
  process.exit(1);
}

// Initialize Agent Selector
console.log('🔧 Initializing Agent Selector...');
const selector = new AgentSelector({
  llmApiKey: process.env.OPENROUTER_API_KEY,
  llmProvider: 'openrouter',
  llmModel: 'openai/gpt-oss-120b:free'
});
console.log('✓ Agent Selector initialized\n');

// Register Financial Agent if available
if (process.env.FINANCIAL_API_KEY) {
  console.log('💰 Registering Financial Agent...');
  try {
    const financialAgent = createFinancialAgent({
      openrouterApiKey: process.env.OPENROUTER_API_KEY,
      financialApiKey: process.env.FINANCIAL_API_KEY
    });
    selector.registerAgent('FINANCIAL', financialAgent);
    console.log('✓ Financial Agent registered\n');
  } catch (error) {
    console.error('✗ Financial Agent registration failed:', error.message);
  }
} else {
  console.log('⚠️  Financial Agent not registered (FINANCIAL_API_KEY not set)\n');
}

// Show registered agents
console.log('📦 Registered Agents:', selector.listAgents().join(', ') || 'None');
console.log('');

// Test intent detection (doesn't require API calls)
console.log('🎯 Testing Intent Detection (Quick Match):\n');

const testQueries = [
  { query: "What's the stock price of Apple?", expected: "FINANCIAL" },
  { query: "Show me TSLA news", expected: "FINANCIAL" },
  { query: "Tell me a joke", expected: "GENERAL" },
  { query: "How do I write a Python function?", expected: "CODE" },
  { query: "What's the weather in NYC?", expected: "WEATHER" }
];

let passed = 0;
let failed = 0;

for (const test of testQueries) {
  const detected = selector.quickMatch(test.query);
  const result = detected || 'GENERAL (via LLM)';
  const match = detected === test.expected;
  
  if (match) {
    console.log(`  ✓ "${test.query}"`);
    console.log(`    → Detected: ${result}\n`);
    passed++;
  } else {
    console.log(`  ⚠️  "${test.query}"`);
    console.log(`    → Expected: ${test.expected}, Got: ${result}\n`);
    failed++;
  }
}

console.log(`\n📊 Quick Match Results: ${passed} passed, ${failed} will use LLM\n`);

// Test message formatting
console.log('🔧 Testing Message Formatting:\n');

const formatTests = [
  { query: "What's AAPL price?", agent: "FINANCIAL" },
  { query: "Show me Tesla news", agent: "FINANCIAL" }
];

for (const test of formatTests) {
  const formatted = selector.formatMessageForAgent(test.query, test.agent);
  console.log(`  Original: "${test.query}"`);
  console.log(`  Formatted: "${formatted}"\n`);
}

// Test full routing (requires API call - optional)
if (process.argv.includes('--full')) {
  console.log('🚀 Testing Full Routing (with API calls):\n');
  
  const routeTest = "What's the price of Apple stock?";
  console.log(`  Query: "${routeTest}"`);
  
  try {
    const result = await selector.route(routeTest);
    console.log(`  ✓ Routed to: ${result.agent}`);
    console.log(`  ✓ Response: ${result.text.substring(0, 100)}...`);
    if (result.toolUsed) {
      console.log(`  ✓ Tool used: ${result.toolUsed}`);
    }
  } catch (error) {
    console.error(`  ✗ Routing failed: ${error.message}`);
  }
} else {
  console.log('💡 Tip: Run with --full flag to test full routing with API calls');
  console.log('   Example: node test.js --full\n');
}

// Stats
console.log('📈 Selector Stats:');
const stats = selector.getStats();
console.log(`  Registered Agents: ${stats.registeredAgents.join(', ') || 'None'}`);
console.log(`  Cache Size: ${stats.cacheSize}`);
console.log(`  Has Fallback: ${stats.hasFallback ? 'Yes' : 'No'}`);
console.log('');

console.log('✅ All tests completed!\n');
console.log('Next steps:');
console.log('  1. Start the server: npm run dev');
console.log('  2. Open http://localhost:3000');
console.log('  3. Ask questions naturally - no command prefixes needed!');
console.log('');
