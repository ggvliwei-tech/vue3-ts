// LLM 类型枚举，定义支持的大语言模型平台
export enum LlmTypeEnum {
  OPENAI = 'openai',              // OpenAI 兼容 API
  OLLAMA = 'local_ollama',        // 本地 Ollama 服务
  DASHSCOPE = 'dashscope_qwen',   // 阿里云 DashScope（通义千问）
}
