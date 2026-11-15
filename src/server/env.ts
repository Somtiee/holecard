import { loadEnvFile } from 'node:process';

if (process.env.NODE_ENV !== 'test') {
  try {
    loadEnvFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
