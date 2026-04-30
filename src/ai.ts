import 'dotenv/config';
import OpenAI from 'openai';

let openaiClient: OpenAI | undefined;

export function getOpenAIClient(): OpenAI {
  openaiClient ??= new OpenAI();
  return openaiClient;
}

export const openai = new Proxy({} as OpenAI, {
  get(_target, property, receiver) {
    return Reflect.get(getOpenAIClient(), property, receiver);
  },
});
