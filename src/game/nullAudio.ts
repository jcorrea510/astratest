/** Silent stand-in used until the real audio engine is available (and in tests). */
import type { GameAudio, EngineVoice, LoopVoice } from '../ui/contracts';
const voice: EngineVoice & LoopVoice = { update() { /* silent */ }, stop() { /* silent */ } };
export class NullAudio implements GameAudio {
  async resume() { /* silent */ }
  setVolumes() { /* silent */ }
  setListener() { /* silent */ }
  play() { /* silent */ }
  engine() { return voice; }
  siren() { return voice; }
  skid() { return voice; }
  setAmbience() { /* silent */ }
  radioNext() { return null; }
  setRadioActive() { /* silent */ }
  setSlowMo() { /* silent */ }
  setPausedMuffle() { /* silent */ }
  setMusicMood() { /* silent */ }
}
