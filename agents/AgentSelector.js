/**
 * Agent Selector
 * Analyzes user input and routes to the appropriate specialized agent
 */

import agentFactory from './AgentFactory.js';

const SELECTOR_SYSTEM_PROMPT = `You are an intelligent agent router. Analyze user messages and determine which specialized agent should handle them.

Available agents:
- FINANCIAL: Stock prices, market data, financial news, ticker symbols (e.g., "stock price of Apple", "AAPL news", "market data")
- WEATHER: Weather forecasts, conditions, temperature (e.g., "weather in NYC", "will it rain tomorrow")
- CODE: Programming help, debugging, code examples (e.g., "how to sort array in Python", "fix this code")
- GENERAL: Everything else (general questions, conversations, non-specialized queries)

Respond with ONLY ONE WORD - the agent name in UPPERCASE. Examples:
- "What's the price of AAPL?" -> FINANCIAL
- "Tell me about Tesla stock" -> FINANCIAL
- "Weather in London?" -> WEATHER
- "How do I write a for loop?" -> CODE
- "Tell me a joke" -> GENERAL
- "Who won the Super Bowl?" -> GENERAL

If the message contains a ticker symbol or mentions stocks/finance/market, choose FINANCIAL.
Otherwise, use your best judgment. When in doubt, choose GENERAL.`;

class AgentSelector {
  constructor(config) {
    this.llmApiKey = config.llmApiKey;
    this.llmProvider = config.llmProvider || 'openrouter';
    this.llmModel = config.llmModel || 'openai/gpt-oss-120b:free';
    this.agents = new Map();
    this.fallbackAgent = config.fallbackAgent || null;
    this.timeout = config.timeout || 10000;
    this.cache = new Map(); // Cache recent routing decisions
    this.maxCacheSize = 100;
  }

  /**
   * Register an agent with the selector
   */
  registerAgent(name, agent) {
    if (!name || !agent) {
      throw new Error('Agent name and instance required');
    }
    this.agents.set(name.toUpperCase(), agent);
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(name) {
    return this.agents.delete(name.toUpperCase());
  }

  /**
   * List registered agents
   */
  listAgents() {
    return Array.from(this.agents.keys());
  }

  /**
   * Get cache key for message
   */
  getCacheKey(message) {
    return message.toLowerCase().trim().substring(0, 100);
  }

  /**
   * Check cache for routing decision
   */
  checkCache(message) {
    const key = this.getCacheKey(message);
    return this.cache.get(key);
  }

  /**
   * Cache routing decision
   */
  cacheDecision(message, agentName) {
    const key = this.getCacheKey(message);
    
    // Implement LRU cache
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, agentName);
  }

  /**
   * Extract ticker symbol if present
   */
  extractTicker(message) {
    const match = message.match(/\$?([A-Z]{1,5})\b/);
    return match ? match[1] : null;
  }

  /**
   * Quick pattern matching for common queries (faster than LLM)
   */
  quickMatch(message) {
    const lower = message.toLowerCase();
    
    // Code keywords (check first to avoid false positives)
    if (/\b(code|program|function|debug|syntax|error|algorithm|loop|variable|class|method)\b/i.test(message) ||
        /\b(python|javascript|java|c\+\+|ruby|php|rust|golang|typescript)\b/i.test(message) ||
        /how (do|to|can) (i|you) (write|create|make|implement)/i.test(message)) {
      return 'CODE';
    }
    
    // Weather keywords
    if (/\b(weather|forecast|temperature|rain|snow|sunny|cloudy|wind|humidity|climate)\b/i.test(message)) {
      return 'WEATHER';
    }
    
    // Financial keywords (more specific patterns)
    if (
      /\b(stock|price|market|ticker|nasdaq|dow|s&p|trading|shares|equity|portfolio|dividend)\b/i.test(message) ||
      this.extractTicker(message) ||
      /\b(apple|microsoft|google|amazon|tesla|meta|nvidia) (stock|price|shares|trading)/i.test(lower)
    ) {
      return 'FINANCIAL';
    }
    
    return null;
  }

  /**
   * Use LLM to classify intent
   */
  async classifyWithLlm(message) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      let url, headers, body;

      if (this.llmProvider === 'openrouter') {
        url = 'https://openrouter.ai/api/v1/chat/completions';
        headers = {
          Authorization: `Bearer ${this.llmApiKey}`,
          'Content-Type': 'application/json'
        };
        body = {
          model: this.llmModel,
          messages: [
            { role: 'system', content: SELECTOR_SYSTEM_PROMPT },
            { role: 'user', content: message }
          ],
          temperature: 0.1,
          max_tokens: 10
        };
      } else {
        throw new Error(`Unsupported LLM provider: ${this.llmProvider}`);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LLM classification failed (${response.status})`);
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content?.trim().toUpperCase();
      
      // Validate response
      const validAgents = ['FINANCIAL', 'WEATHER', 'CODE', 'GENERAL'];
      if (validAgents.includes(content)) {
        return content;
      }
      
      // If response is invalid, return GENERAL
      return 'GENERAL';
    } catch (error) {
      clearTimeout(timeoutId);
      console.error('LLM classification error:', error);
      return 'GENERAL'; // Default to general on error
    }
  }

  /**
   * Select appropriate agent for message
   */
  async selectAgent(message) {
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message');
    }

    // Check cache first
    const cached = this.checkCache(message);
    if (cached) {
      return cached;
    }

    // Try quick pattern matching first (faster)
    let agentName = this.quickMatch(message);
    
    // Fall back to LLM if no quick match
    if (!agentName) {
      agentName = await this.classifyWithLlm(message);
    }

    // Cache the decision
    this.cacheDecision(message, agentName);

    return agentName;
  }

  /**
   * Format message for specific agent
   */
  formatMessageForAgent(message, agentName) {
    if (agentName === 'FINANCIAL') {
      // Extract ticker if present
      const ticker = this.extractTicker(message);
      
      // Determine query type
      if (/price|quote|snapshot|trading/i.test(message)) {
        return ticker ? `/finance ${ticker} price` : message;
      } else if (/news|headline/i.test(message)) {
        return ticker ? `/finance ${ticker} news` : message;
      }
      
      // Default financial query
      return ticker ? `/finance ${ticker}` : message;
    }
    
    // Other agents use message as-is
    return message;
  }

  /**
   * Route message to appropriate agent
   */
  async route(message) {
    try {
      // Select the appropriate agent
      const agentName = await this.selectAgent(message);
      
      // Format message if needed
      const formattedMessage = this.formatMessageForAgent(message, agentName);
      
      // Handle GENERAL queries directly
      if (agentName === 'GENERAL') {
        if (this.fallbackAgent) {
          const result = await this.fallbackAgent.run(formattedMessage);
          return {
            success: true,
            agent: 'GENERAL',
            text: result.text,
            toolResult: result.toolResult
          };
        } else {
          // Use simple LLM call
          const text = await this.simpleQuery(formattedMessage);
          return {
            success: true,
            agent: 'GENERAL',
            text
          };
        }
      }

      // Get the specialized agent
      const agent = this.agents.get(agentName);
      
      if (!agent) {
        // Agent not registered, fall back to general
        console.warn(`Agent '${agentName}' not registered, using fallback`);
        const text = await this.simpleQuery(message);
        return {
          success: true,
          agent: 'GENERAL',
          text
        };
      }

      // Run the specialized agent
      const result = await agent.run(formattedMessage);
      
      return {
        success: result.success,
        agent: agentName,
        text: result.text,
        toolResult: result.toolResult,
        toolUsed: result.toolUsed,
        error: result.error
      };
    } catch (error) {
      console.error('Routing error:', error);
      return {
        success: false,
        agent: 'NONE',
        text: 'I encountered an error processing your request. Please try again.',
        error: error.message
      };
    }
  }

  /**
   * Simple LLM query without tools
   */
  async simpleQuery(message) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.llmApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.llmModel,
          messages: [
            { role: 'system', content: 'You are Jarvis, a helpful voice-first assistant.' },
            { role: 'user', content: message }
          ],
          temperature: 0.7
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LLM request failed (${response.status})`);
      }

      const data = await response.json();
      return data?.choices?.[0]?.message?.content?.trim() || 'No response.';
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Clear routing cache
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Get selector stats
   */
  getStats() {
    return {
      registeredAgents: Array.from(this.agents.keys()),
      cacheSize: this.cache.size,
      hasFallback: !!this.fallbackAgent
    };
  }
}

export default AgentSelector;
