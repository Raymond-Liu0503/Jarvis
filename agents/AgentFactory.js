/**
 * Agent Factory
 * Simplifies creation and management of custom agent modules
 */

import AgentModule from './AgentModule.js';

class AgentFactory {
  constructor() {
    this.agents = new Map();
    this.templates = new Map();
    this.initializeDefaultTemplates();
  }

  /**
   * Initialize default agent templates
   */
  initializeDefaultTemplates() {
    // Financial Agent Template
    this.templates.set('financial', {
      name: 'FinancialAgent',
      description: 'Real-time financial market data and analysis',
      systemPrompt: `You are a financial market assistant with access to real-time market data.
When tool data is provided, extract and present the most relevant information clearly.
Keep responses concise and factual. Never provide investment advice.`,
      mcpBaseUrl: 'https://mcp.financialdatasets.ai/api',
      llmProvider: 'openrouter',
      llmModel: 'openai/gpt-oss-120b:free',
      tools: [
        { name: 'getStockPriceSnapshot', description: 'Get current stock price data' },
        { name: 'getNews', description: 'Get latest news for a stock' }
      ],
      intentMatchers: [
        { test: (text) => /price|quote|snapshot/i.test(text), toolName: 'getStockPriceSnapshot' },
        { test: (text) => /news|headline/i.test(text), toolName: 'getNews' }
      ],
      paramExtractors: [
        { name: 'ticker', fn: (text) => text.match(/\$?([A-Z]{1,5})\b/)?.[1] }
      ]
    });

    // Weather Agent Template
    this.templates.set('weather', {
      name: 'WeatherAgent',
      description: 'Weather information and forecasts',
      systemPrompt: `You are a weather assistant providing current conditions and forecasts.
Present weather data clearly with temperatures, conditions, and relevant details.`,
      llmProvider: 'openrouter',
      llmModel: 'openai/gpt-oss-120b:free',
      tools: [],
      intentMatchers: [],
      paramExtractors: []
    });

    // Code Helper Template
    this.templates.set('code', {
      name: 'CodeHelperAgent',
      description: 'Programming assistance and code generation',
      systemPrompt: `You are an expert programming assistant. Help with code questions,
debugging, and best practices. Provide clear, working code examples.`,
      llmProvider: 'openrouter',
      llmModel: 'openai/gpt-oss-120b:free',
      tools: [],
      intentMatchers: [],
      paramExtractors: []
    });
  }

  /**
   * Create agent from template
   */
  createFromTemplate(templateName, config) {
    const template = this.templates.get(templateName);
    
    if (!template) {
      throw new Error(`Template '${templateName}' not found. Available templates: ${Array.from(this.templates.keys()).join(', ')}`);
    }

    // Merge template with user config
    const agentConfig = {
      ...template,
      ...config,
      tools: config.tools || template.tools,
      intentMatchers: config.intentMatchers || template.intentMatchers,
      paramExtractors: config.paramExtractors || template.paramExtractors
    };

    // Validate required keys
    if (!agentConfig.llmApiKey) {
      throw new Error('llmApiKey is required');
    }

    if (agentConfig.mcpBaseUrl && !agentConfig.mcpApiKey) {
      throw new Error('mcpApiKey is required when mcpBaseUrl is provided');
    }

    const agent = new AgentModule(agentConfig);
    
    // Store agent if name provided
    if (agentConfig.name) {
      this.agents.set(agentConfig.name, agent);
    }

    return agent;
  }

  /**
   * Create custom agent from scratch
   */
  createCustom(config) {
    const agent = new AgentModule(config);
    
    if (config.name) {
      this.agents.set(config.name, agent);
    }

    return agent;
  }

  /**
   * Register a new template
   */
  registerTemplate(name, template) {
    if (!name || typeof name !== 'string') {
      throw new Error('Template name must be a non-empty string');
    }

    if (!template.systemPrompt) {
      throw new Error('Template must have a systemPrompt');
    }

    this.templates.set(name, {
      name: template.name || name,
      description: template.description || '',
      systemPrompt: template.systemPrompt,
      mcpBaseUrl: template.mcpBaseUrl,
      llmProvider: template.llmProvider || 'openrouter',
      llmModel: template.llmModel || 'openai/gpt-oss-120b:free',
      tools: template.tools || [],
      intentMatchers: template.intentMatchers || [],
      paramExtractors: template.paramExtractors || []
    });

    return true;
  }

  /**
   * Get agent by name
   */
  getAgent(name) {
    const agent = this.agents.get(name);
    
    if (!agent) {
      throw new Error(`Agent '${name}' not found`);
    }

    return agent;
  }

  /**
   * List all registered agents
   */
  listAgents() {
    return Array.from(this.agents.entries()).map(([name, agent]) => ({
      name,
      info: agent.getInfo()
    }));
  }

  /**
   * List all available templates
   */
  listTemplates() {
    return Array.from(this.templates.entries()).map(([name, template]) => ({
      name,
      description: template.description,
      requiresMcp: !!template.mcpBaseUrl
    }));
  }

  /**
   * Remove agent from registry
   */
  removeAgent(name) {
    return this.agents.delete(name);
  }

  /**
   * Clear all agents
   */
  clearAgents() {
    this.agents.clear();
  }
}

// Export singleton instance
export default new AgentFactory();
export { AgentFactory };
