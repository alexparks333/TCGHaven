// Firebase Storage for the collector app (signed in as the collector) — Creators' uploads (their
// book cover, badge art, Relief Studio files) under creators/{uid}/ (storage.rules). Kept out of
// config.ts so pages that never upload don't load the Storage SDK.
import { getApps } from 'firebase/app'
import { getStorage } from 'firebase/storage'
import './config'

export const appStorage = getStorage(getApps()[0])
