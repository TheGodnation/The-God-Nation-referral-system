import dotenv from 'dotenv';
dotenv.config();

import { createApp } from './app';
import { PORT } from './lib/env';

const app = createApp();

app.listen(PORT, () => {
  console.log(`The God Nation Referral System API listening on port ${PORT}`);
});
