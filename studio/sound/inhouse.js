// The in-house build of the sound engine: the engine as the product has it,
// plus Strudel, so films scored in Strudel before the music bed keep
// playing exactly as they did. Strudel is AGPL-3.0, so this entry is only
// bundled when the edition is in-house and studio/sound/strudel is
// installed (scripts/studio/sound-engine.mjs). Strudel loads first, as it
// always did, before the engine seeds the page's random numbers.

import "./strudel/music.js";
import "./engine.js";
