import type { RegisteredTool } from '../types';

import { scrapeWebsiteTool } from './scrapeWebsite';

export const tools: RegisteredTool[] = [scrapeWebsiteTool];
