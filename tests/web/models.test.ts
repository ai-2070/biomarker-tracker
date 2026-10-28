import { describe, expect, it } from 'vitest';
import { brainAsAgent, modelInfo } from '../../web/models.ts';
import { ACCENTS, applyLook } from '../../web/look.ts';

describe('modelInfo()', () => {
  it('names Claude models with family and version, and marks "always latest"', () => {
    expect(modelInfo({ engine: 'claude-code', model: 'sonnet' })).toMatchObject({ name: 'Claude Sonnet 5.5', latest: true, brand: 'claude' });
    expect(modelInfo({ engine: 'claude-code', model: 'claude-opus-5-5' })).toMatchObject({ short: 'Opus 5.5', latest: false });
  });

  it('handles OpenRouter, local servers, Codex and Hermes', () => {
    expect(modelInfo({ engine: 'openai', provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' })).toMatchObject({ short: 'Haiku 5.5', where: 'OpenRouter' });
    expect(modelInfo({ engine: 'openai', provider: 'ollama', model: 'llama3.2' }).where).toBe('Ollama');
    // the OpenRouter logo only for models that come from OpenRouter
    expect(modelInfo({ engine: 'openai', provider: 'openrouter', model: 'openai/gpt-6' }).brand).toBe('openrouter');
    expect(modelInfo({ engine: 'openai', provider: 'lmstudio', model: 'qwen3-coder' }).brand).toBeNull();
    expect(modelInfo({ engine: 'openai', provider: 'custom', model: 'mistral-large' }).brand).toBeNull();
    expect(modelInfo({ engine: 'codex', model: '' })).toMatchObject({ short: 'Codex', latest: true, brand: 'openai' });
    expect(modelInfo({ engine: 'hermes', model: '' }).short).toBe('Hermes');
  });

  it('handles pi, oh-my-pi and OpenClaw: their own default, or a provider/model id', () => {
    expect(modelInfo({ engine: 'pi', model: '' })).toMatchObject({ short: 'pi', where: 'pi' });
    expect(modelInfo({ engine: 'omp', model: 'anthropic/claude-sonnet-5-5' })).toMatchObject({ short: 'claude-sonnet-5-5', brand: 'claude', where: 'oh-my-pi · anthropic' });
    expect(modelInfo({ engine: 'openclaw', model: '', openclawAgent: 'ops' })).toMatchObject({ short: 'OpenClaw', where: 'OpenClaw · ops' });
  });

  it("maps the Brain's setting onto the same picker", () => {
    expect(brainAsAgent({ provider: 'claude', model: 'haiku' })).toMatchObject({ engine: 'claude-code', model: 'haiku' });
    expect(brainAsAgent({ provider: 'openrouter', model: 'x/y' })).toMatchObject({ engine: 'openai', model: 'x/y' });
    expect(brainAsAgent({ provider: 'codex', model: '' }).engine).toBe('codex');
  });
});

describe('applyLook()', () => {
  it('sets the UI scale and the accent colour', () => {
    applyLook({ scale: 125, accent: 'ice' });
    expect(document.documentElement.style.zoom).toBe('1.25');
    expect(document.documentElement.style.getPropertyValue('--color-accent')).toBe(ACCENTS.find((a) => a.id === 'ice')!.c);
  });

  it('keeps the scale within 70–160% and clears it at 100%', () => {
    applyLook({ scale: 500 });
    expect(document.documentElement.style.zoom).toBe('1.6');
    applyLook({ scale: 100 });
    expect(document.documentElement.style.zoom).toBe('');
  });

  it('turns reduced motion on and off', () => {
    applyLook({ motion: 'reduced' });
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(true);
    applyLook({ motion: 'full' });
    expect(document.documentElement.classList.contains('reduce-motion')).toBe(false);
  });
});
