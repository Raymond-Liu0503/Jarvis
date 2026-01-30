import AgentModule from './AgentModule.js';

/**
 * Financial Agent - Example implementation using AgentModule
 */

const MCP_BASE_URL = 'https://mcp.financialdatasets.ai/api';

const systemPrompt = `You are a financial market assistant with access to real-time market data.

When tool data is provided:
- Extract and present the most relevant information clearly
- For price snapshots: state current price, day change, and market cap
- For news: summarize top headlines with sources
- Use numbers and percentages from the tool data directly

When no tool data is available:
- If a ticker is mentioned, acknowledge you need it in uppercase format (e.g., AAPL)
- Provide general financial knowledge when appropriate

Keep responses concise and factual. Never provide investment advice or recommendations.`;

// Helper functions for the financial agent
const extractTicker = (text) => {
  const match = text.match(/\$?([A-Z]{1,5})\b/);
  return match ? match[1] : undefined;
};

/**
 * Create a configured financial agent instance
 */
export const createFinancialAgent = ({ openrouterApiKey, financialApiKey }) => {
  if (!openrouterApiKey) {
    throw new Error('OPENROUTER_API_KEY not configured');
  }
  if (!financialApiKey) {
    throw new Error('FINANCIAL_API_KEY not configured');
  }

  return new AgentModule({
    name: 'FinancialAgent',
    description: 'Real-time financial market data and analysis',
    systemPrompt,
    mcpBaseUrl: MCP_BASE_URL,
    mcpApiKey: financialApiKey,
    llmApiKey: openrouterApiKey,
    llmProvider: 'openrouter',
    llmModel: 'openai/gpt-oss-120b:free',
    
    // Define available tools
    tools: [
      { name: 'getStockPriceSnapshot', description: 'Get current stock price and snapshot data' },
      { name: 'getNews', description: 'Get latest news for a stock ticker' }
    ],
    
    // Intent matchers to determine which tool to use
    intentMatchers: [
      {
        test: (text) => /price|quote|snapshot|trading|stock/i.test(text),
        toolName: 'getStockPriceSnapshot'
      },
      {
        test: (text) => /news|headline|article/i.test(text),
        toolName: 'getNews'
      }
    ],
    
    // Parameter extractors
    paramExtractors: [
      {
        name: 'ticker',
        fn: extractTicker
      },
      {
        name: 'limit',
        fn: (text) => text.includes('news') ? 5 : undefined
      }
    ]
  });
};

/**
 * Legacy function for backward compatibility
 */
export const runFinancialAgent = async ({ message, openrouterApiKey, financialApiKey }) => {
  try {
    const agent = createFinancialAgent({ openrouterApiKey, financialApiKey });
    const result = await agent.run(message);
    
    if (!result.success) {
      throw new Error(result.error || 'Agent execution failed');
    }
    
    return {
      text: result.text,
      toolResult: result.toolResult
    };
  } catch (error) {
    throw new Error(`Financial agent error: ${error.message}`);
  }
};
