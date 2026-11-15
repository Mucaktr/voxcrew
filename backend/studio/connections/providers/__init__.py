from studio.connections.providers.base import Provider, ProviderContext
from studio.connections.providers.cli_tools import ClaudeProvider, CodexProvider, GeminiProvider
from studio.connections.providers.hermes import HermesProvider
from studio.connections.providers.ollama import OllamaProvider
from studio.connections.providers.openai_compat import OpenAICompatProvider


def default_providers() -> list[Provider]:
    return [HermesProvider(), OllamaProvider(), CodexProvider(), ClaudeProvider(), OpenAICompatProvider(), GeminiProvider()]


__all__ = ["Provider", "ProviderContext", "default_providers", "HermesProvider", "OllamaProvider", "CodexProvider",
           "ClaudeProvider", "OpenAICompatProvider", "GeminiProvider"]
