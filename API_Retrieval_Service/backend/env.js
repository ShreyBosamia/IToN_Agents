import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// points to IToN_Agents/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
