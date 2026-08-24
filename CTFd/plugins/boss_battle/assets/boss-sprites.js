/**
 * Boss Battle Plugin — Sprite Animation Controller
 *
 * A pure CSS steps()-based sprite sheet animator.
 *
 * Sprite sheets are horizontal strips of 256x256 frames.
 * Each animation (idle, hit, attack, phase_transition, defeated)
 * maps to a specific sheet file and frame count.
 *
 * Design doc specs:
 *   Phase 1 idle: 8 frames  → 2048x256 sheet
 *   Phase 2 idle: 10 frames → 2560x256 sheet
 *   Phase 3 idle: 10 frames → 2560x256 sheet
 *   All attacks:  8 frames  → 2048x256 sheet
 *   Frame size:   256x256
 *   Target FPS:   10-12 FPS
 */

(function () {
  "use strict";

  var FRAME_WIDTH = 344;
  var FRAME_HEIGHT = 384;
  var BASE_PATH = "/plugins/boss_battle/assets/sprites/";

  // =========================================================================
  // ANIMATION MANIFEST
  // Each phase defines its available animations with frame counts and
  // sheet filenames. The system falls back to idle if a requested
  // animation doesn't exist for the current phase.
  // =========================================================================
  var ANIM_MANIFEST = {
    1: {
      idle:             { frames: 8,  fps: 10, sheet: "phase1_idle_v2.png",   loop: true },
      hit:              { frames: 4,  fps: 12, sheet: "phase1_idle_v2.png",   loop: false },
      attack:           { frames: 8,  fps: 12, sheet: "phase1_attack_v2.png", loop: false },
      phase_transition: { frames: 8,  fps: 6,  sheet: "phase1_idle_v2.png",   loop: false },
      defeated:         { frames: 8,  fps: 4,  sheet: "phase1_idle_v2.png",   loop: false },
    },
    2: {
      idle:             { frames: 8, fps: 10, sheet: "phase2_idle_v2.png",   loop: true },
      hit:              { frames: 4,  fps: 12, sheet: "phase2_idle_v2.png",   loop: false },
      attack:           { frames: 8,  fps: 12, sheet: "phase2_attack_v2.png", loop: false },
      phase_transition: { frames: 8, fps: 6,  sheet: "phase2_idle_v2.png",   loop: false },
      defeated:         { frames: 8, fps: 4,  sheet: "phase2_idle_v2.png",   loop: false },
    },
    3: {
      idle:             { frames: 8, fps: 10, sheet: "phase3_idle_v2.png",   loop: true },
      hit:              { frames: 4,  fps: 12, sheet: "phase3_idle_v2.png",   loop: false },
      attack:           { frames: 8,  fps: 12, sheet: "phase3_attack_v2.png", loop: false },
      phase_transition: { frames: 8, fps: 6,  sheet: "phase3_idle_v2.png",   loop: false },
      defeated:         { frames: 8, fps: 4,  sheet: "phase3_idle_v2.png",   loop: false },
    },
  };

  // =========================================================================
  // SPRITE ANIMATOR CLASS
  // Drives a single DOM element's background-position through a horizontal
  // sprite sheet using requestAnimationFrame for precise frame timing.
  // =========================================================================

  /**
   * @param {HTMLElement} containerEl - The 256x256 element to animate.
   */
  function SpriteAnimator(containerEl) {
    this.el = containerEl;
    this.currentPhase = 1;
    this.currentAnim = "idle";
    this.frameIndex = 0;
    this.frameCount = 0;
    this.fps = 10;
    this.loop = true;
    this.rafId = null;
    this.lastFrameTime = 0;
    this.onComplete = null; // callback when a non-looping animation finishes
    this.spriteEl = null;   // the inner element that shows the sprite
    this.usePlaceholder = false; // true when sprite sheet files are not found
    this._init();
  }

  /**
   * Initializes the sprite display element inside the container.
   * If the container already has a sprite element, reuses it.
   * Otherwise creates one, replacing the placeholder emoji.
   */
  SpriteAnimator.prototype._init = function () {
    // Look for an existing sprite element
    this.spriteEl = this.el.querySelector(".boss-arena__sprite-sheet");
    if (!this.spriteEl) {
      this.spriteEl = document.createElement("div");
      this.spriteEl.className = "boss-arena__sprite-sheet";
      // Clear the placeholder emoji
      var placeholder = this.el.querySelector(".boss-arena__sprite-placeholder");
      if (placeholder) {
        placeholder.style.display = "none";
      }
      this.el.appendChild(this.spriteEl);
    }
  };

  /**
   * Plays an animation by name for the given phase.
   * @param {number} phase - Boss phase (1, 2, or 3)
   * @param {string} animName - "idle", "hit", "attack", "phase_transition", "defeated"
   * @param {function} [onComplete] - Called when a non-looping animation ends
   */
  SpriteAnimator.prototype.play = function (phase, animName, onComplete) {
    var phaseAnims = ANIM_MANIFEST[phase];
    if (!phaseAnims) phaseAnims = ANIM_MANIFEST[1];

    var anim = phaseAnims[animName];
    if (!anim) anim = phaseAnims["idle"];

    // Don't restart if already playing the same looping animation
    if (
      this.currentPhase === phase &&
      this.currentAnim === animName &&
      anim.loop &&
      this.rafId !== null
    ) {
      return;
    }

    this.stop();

    this.currentPhase = phase;
    this.currentAnim = animName;
    this.frameCount = anim.frames;
    this.fps = anim.fps;
    this.loop = anim.loop;
    this.frameIndex = 0;
    this.lastFrameTime = 0;
    this.onComplete = onComplete || null;
    this.usePlaceholder = false;

    // Set sprite sheet as background image
    var sheetUrl = BASE_PATH + anim.sheet;
    this.spriteEl.style.backgroundImage = "url('" + sheetUrl + "')";
    this.spriteEl.style.backgroundSize = (this.frameCount * FRAME_WIDTH) + "px " + FRAME_HEIGHT + "px";
    this.spriteEl.style.backgroundRepeat = "no-repeat";
    this.spriteEl.style.width = FRAME_WIDTH + "px";
    this.spriteEl.style.height = FRAME_HEIGHT + "px";
    this._showFrame(0);

    // Verify the image loads; fall back to placeholder if not found
    var self = this;
    var testImg = new Image();
    testImg.onload = function () {
      // Sheet exists — start the frame loop
      self.usePlaceholder = false;
      self._startLoop();
    };
    testImg.onerror = function () {
      // Sheet doesn't exist — show CSS placeholder animation instead
      self.usePlaceholder = true;
      self.spriteEl.style.backgroundImage = "none";
      self._showPlaceholderAnim(phase, animName);
      self._startLoop();
    };
    testImg.src = sheetUrl;
  };

  /**
   * Shows a specific frame by adjusting background-position.
   */
  SpriteAnimator.prototype._showFrame = function (index) {
    if (this.usePlaceholder) return;
    var offsetX = -(index * FRAME_WIDTH);
    this.spriteEl.style.backgroundPosition = offsetX + "px 0px";
  };

  /**
   * When sprite sheets aren't available, use CSS-based visual feedback.
   * This provides meaningful animation even without sprite art assets.
   */
  SpriteAnimator.prototype._showPlaceholderAnim = function (phase, animName) {
    var placeholder = this.el.querySelector(".boss-arena__sprite-placeholder");
    if (placeholder) {
      placeholder.style.display = "flex";
    }

    // Map boss state to placeholder emoji
    var emojis = {
      idle:             "⚔",   // swords
      hit:              "💥",  // collision
      attack:           "🗡️", // dagger
      phase_transition: "✨",  // sparkles
      defeated:         "💀",  // skull
    };

    if (placeholder) {
      placeholder.textContent = emojis[animName] || "⚔";
    }
  };

  /**
   * Starts the requestAnimationFrame loop for frame stepping.
   */
  SpriteAnimator.prototype._startLoop = function () {
    var self = this;
    var msPerFrame = 1000 / this.fps;

    function tick(timestamp) {
      if (!self.lastFrameTime) self.lastFrameTime = timestamp;
      var elapsed = timestamp - self.lastFrameTime;

      if (elapsed >= msPerFrame) {
        self.lastFrameTime = timestamp;
        self.frameIndex++;

        if (self.frameIndex >= self.frameCount) {
          if (self.loop) {
            self.frameIndex = 0;
          } else {
            // Animation complete
            self.frameIndex = self.frameCount - 1;
            self._showFrame(self.frameIndex);
            self.rafId = null;
            if (self.onComplete) self.onComplete();
            return;
          }
        }

        self._showFrame(self.frameIndex);
      }

      self.rafId = requestAnimationFrame(tick);
    }

    this.rafId = requestAnimationFrame(tick);
  };

  /**
   * Stops the current animation loop.
   */
  SpriteAnimator.prototype.stop = function () {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  };

  /**
   * Convenience: play idle animation for current phase.
   */
  SpriteAnimator.prototype.idle = function (phase) {
    this.play(phase, "idle");
  };

  /**
   * Play a one-shot animation, then return to idle.
   */
  SpriteAnimator.prototype.playThenIdle = function (phase, animName) {
    var self = this;
    this.play(phase, animName, function () {
      self.idle(phase);
    });
  };

  // =========================================================================
  // PUBLIC API
  // =========================================================================
  window.BossSpriteAnimator = {
    SpriteAnimator: SpriteAnimator,
    ANIM_MANIFEST: ANIM_MANIFEST,
    FRAME_SIZE: FRAME_SIZE,
    BASE_PATH: BASE_PATH,
  };
})();
