import { Router } from 'express';
import { getSettings, setSettings, refreshDetectedDefault } from '../lib/settings.js';
import { scanProviders } from '../lib/providers.js';

export function settingsRouter(db) {
  const r = Router();
  r.get('/', (_req, res) => res.json({ settings: getSettings(db) }));
  r.put('/', (req, res) => {
    res.json({ settings: setSettings(db, req.body ?? {}) });
  });
  r.get('/providers', (_req, res) => {
    const providers = scanProviders({ force: true });
    const detected = refreshDetectedDefault(providers);
    res.json({ providers, detected, default: getSettings(db).defaultProvider });
  });
  return r;
}
