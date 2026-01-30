/**
 * Generic Agent Module
 * Allows creation of custom agents with MCP tool integration, custom prompts, and safety measures
 */

const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000; // 30 seconds
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 20;

class AgentModule {
  constructor(config) {
    this.validateConfig(config);
    
    this.name = config.name;
    this.description = config.description || '';
    this.systemPrompt = config.systemPrompt;
    this.mcpBaseUrl = config.mcpBaseUrl;
    this.mcpApiKey = config.mcpApiKey;
    this.llmApiKey = config.llmApiKey;
    this.llmProvider = config.llmProvider || 'openrouter';
    this.llmModel = config.llmModel || 'openai/gpt-oss-120b:free';
    this.tools = config.tools || [];
    this.intentMatchers = config.intentMatchers || [];
    this.paramExtractors = config.paramExtractors || [];
    
    // Session and rate limiting
    this.mcpSessionId = null;
    this.requestLog = [];
    
    // Safety configuration
    this.timeout = config.timeout || TIMEOUT_MS;
    this.maxRetries = config.maxRetries || MAX_RETRIES;
    this.rateLimitWindow = config.rateLimitWindow || RATE_LIMIT_WINDOW;
    this.maxRequestsPerWindow = config.maxRequestsPerWindow || MAX_REQUESTS_PER_WINDOW;
  }

  /**
   * Validate configuration object
   */
  validateConfig(config) {
    const required = ['name', 'systemPrompt', 'llmApiKey'];
    const missing = required.filter(field => !config[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required config fields: ${missing.join(', ')}`);
    }

    if (config.mcpBaseUrl && !this.isValidUrl(config.mcpBaseUrl)) {
      throw new Error('Invalid MCP base URL');
    }

    if (config.tools && !Array.isArray(config.tools)) {
      throw new Error('Tools must be an array');
    }

    if (config.systemPrompt && typeof config.systemPrompt !== 'string') {
      throw new Error('System prompt must be a string');
    }

    if (config.systemPrompt && config.systemPrompt.length > 10000) {
      throw new Error('System prompt exceeds maximum length (10000 characters)');
    }
  }

  /**
   * Validate URL format
   */
  isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  /**
   * Sanitize user input to prevent injection attacks
   */
  sanitizeInput(input) {
    if (typeof input !== 'string') {
      return String(input);
    }
    
    // Remove potential script tags and dangerous characters
    return input
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim()
      .substring(0, 10000); // Max input length
  }

  /**
   * Check rate limiting
   */
  checkRateLimit() {
    const now = Date.now();
    
    // Clean old requests outside the window
    this.requestLog = this.requestLog.filter(
      timestamp => now - timestamp < this.rateLimitWindow
    );

    if (this.requestLog.length >= this.maxRequestsPerWindow) {
      throw new Error(
        `Rate limit exceeded. Maximum ${this.maxRequestsPerWindow} requests per ${this.rateLimitWindow / 1000} seconds.`
      );
    }

    this.requestLog.push(now);
  }

  /**
   * Fetch with timeout
   */
  async fetchWithTimeout(url, options, timeoutMs = this.timeout) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeoutMs}ms`);
      }
      throw error;
    }
  }

  /**
   * Parse SSE response
   */
  async parseSseResponse(response) {
    try {
      const text = await response.text();
      const lines = text.split('\n');
      let jsonData = '';
      
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          jsonData = line.substring(6);
          break;
        }
      }
      
      if (!jsonData) {
        // Try parsing as regular JSON
        try {
          return JSON.parse(text);
        } catch (e) {
          throw new Error('No valid data found in response');
        }
      }
      
      return JSON.parse(jsonData);
    } catch (error) {
      throw new Error(`Failed to parse response: ${error.message}`);
    }
  }

  /**
   * Initialize MCP session with retry logic
   */
  async initMcpSession() {
    if (!this.mcpBaseUrl || !this.mcpApiKey) {
      throw new Error('MCP base URL and API key required for tool calls');
    }

    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(this.mcpBaseUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'X-API-KEY': this.mcpApiKey
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method: 'initialize',
            params: {
              protocolVersion: '2024-11-05',
              capabilities: {},
              clientInfo: { name: this.name, version: '1.0' }
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `MCP initialization failed (${response.status}): ${errorText.substring(0, 200)}`
          );
        }

        const sessionIdFromHeader = response.headers.get('mcp-session-id');
        const data = await this.parseSseResponse(response);
        
        if (data.error) {
          throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
        }

        this.mcpSessionId = sessionIdFromHeader || `session-${Date.now()}`;
        return data.result;
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw new Error(`MCP initialization failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Make MCP call with error handling
   */
  async mcpCall({ method, params }) {
    if (!this.mcpSessionId) {
      await this.initMcpSession();
    }

    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(this.mcpBaseUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'X-API-KEY': this.mcpApiKey,
            'Mcp-Session-Id': this.mcpSessionId
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: Date.now(),
            method,
            params
          })
        });

        if (!response.ok) {
          // Session might be expired, try reinitializing
          if (response.status === 401 || response.status === 403) {
            this.mcpSessionId = null;
            throw new Error('Session expired, reinitializing');
          }
          
          const errorText = await response.text();
          throw new Error(
            `MCP request failed (${response.status}): ${errorText.substring(0, 200)}`
          );
        }

        const data = await this.parseSseResponse(response);
        
        if (data.error) {
          throw new Error(`MCP error: ${JSON.stringify(data.error)}`);
        }

        return data.result;
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw new Error(`MCP call failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Call a specific tool
   */
  async callTool({ toolName, arguments: toolArgs }) {
    if (!this.tools.find(t => t.name === toolName)) {
      throw new Error(`Tool '${toolName}' is not registered with this agent`);
    }

    try {
      return await this.mcpCall({
        method: 'tools/call',
        params: { name: toolName, arguments: toolArgs || {} }
      });
    } catch (error) {
      throw new Error(`Tool call '${toolName}' failed: ${error.message}`);
    }
  }

  /**
   * Call LLM with context
   */
  async callLlm({ message, toolContext }) {
    this.checkRateLimit();

    const messages = [
      { role: 'system', content: this.systemPrompt }
    ];

    if (toolContext) {
      messages.push({
        role: 'system',
        content: `Tool data (use this to answer the user's question):\n${JSON.stringify(toolContext).substring(0, 50000)}`
      });
    }

    messages.push({ role: 'user', content: message });

    let url, headers, body;

    if (this.llmProvider === 'openrouter') {
      url = 'https://openrouter.ai/api/v1/chat/completions';
      headers = {
        Authorization: `Bearer ${this.llmApiKey}`,
        'Content-Type': 'application/json'
      };
      body = {
        model: this.llmModel,
        messages,
        temperature: 0.4
      };
    } else {
      throw new Error(`Unsupported LLM provider: ${this.llmProvider}`);
    }

    let lastError;
    
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `LLM request failed (${response.status}): ${errorText.substring(0, 200)}`
          );
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content?.trim();
        
        if (!content) {
          throw new Error('No content in LLM response');
        }

        return content;
      } catch (error) {
        lastError = error;
        
        if (attempt < this.maxRetries) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw new Error(`LLM call failed after ${this.maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * Extract parameters from message using configured extractors
   */
  extractParams(message) {
    const params = {};
    
    for (const extractor of this.paramExtractors) {
      try {
        const value = extractor.fn(message);
        if (value !== undefined) {
          params[extractor.name] = value;
        }
      } catch (error) {
        console.error(`Parameter extraction failed for '${extractor.name}':`, error);
      }
    }
    
    return params;
  }

  /**
   * Determine which tool to use based on intent matchers
   */
  selectTool(message) {
    for (const matcher of this.intentMatchers) {
      try {
        if (matcher.test(message)) {
          return matcher.toolName;
        }
      } catch (error) {
        console.error(`Intent matcher failed for '${matcher.toolName}':`, error);
      }
    }
    
    return null;
  }

  /**
   * Run the agent
   */
  async run(message) {
    try {
      // Sanitize input
      const sanitizedMessage = this.sanitizeInput(message);
      
      if (!sanitizedMessage) {
        throw new Error('Invalid or empty message');
      }

      // Extract parameters and select tool
      const params = this.extractParams(sanitizedMessage);
      const selectedTool = this.selectTool(sanitizedMessage);
      
      let toolResult = null;

      // Execute tool if selected and parameters available
      if (selectedTool && Object.keys(params).length > 0) {
        try {
          toolResult = await this.callTool({
            toolName: selectedTool,
            arguments: params
          });
        } catch (error) {
          console.error('Tool execution failed:', error);
          // Continue without tool result
        }
      }

      // Call LLM with or without tool context
      const text = await this.callLlm({
        message: sanitizedMessage,
        toolContext: toolResult
      });

      return {
        success: true,
        text,
        toolResult,
        toolUsed: selectedTool
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        text: 'I encountered an error processing your request. Please try again.'
      };
    }
  }

  /**
   * Reset session (useful for troubleshooting)
   */
  resetSession() {
    this.mcpSessionId = null;
    this.requestLog = [];
  }

  /**
   * Get agent info
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
      tools: this.tools.map(t => t.name),
      provider: this.llmProvider,
      model: this.llmModel,
      hasSession: !!this.mcpSessionId
    };
  }
}

export default AgentModule;
