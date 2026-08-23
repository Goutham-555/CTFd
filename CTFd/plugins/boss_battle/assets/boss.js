/**
 * Boss Battle Plugin — Client-side JavaScript
 *
 * Loaded on EVERY page via register_plugin_script().
 * On /boss page: drives the full boss arena UI + sprite animations.
 * On other pages: renders a persistent mini-widget.
 * Polls /api/boss/state periodically to sync with global server state.
 */

(function () {
  "use strict";

  // =========================================================================
  // CONSTANTS & INITIAL STATE
  // =========================================================================
  const BOSS_PHASES = {
    1: { name: "Starscourged General", maxHp: 15000, color: "#c0392b" },
    2: { name: "Gravity Lord",         maxHp: 10500, color: "#8e44ad" },
    3: { name: "Promised Consort",     maxHp: 15000, color: "#d4a017" },
  };

  var bossState = {
    currentPhase: 1,
    currentHp: 15000,
    maxHp: 15000,
    totalMaxHp: 40500,
    totalCurrentHp: 40500,
    animationState: "idle", // idle | hit | attack | phase_transition | defeated
    bossName: "Starscourged General",
    phaseTitle: "Phase 1",
    lastHitBy: null,
  };

  var pollingInterval = null;
  var spriteAnimator = null; // SpriteAnimator instance for the /boss page

  /**
   * Hydrates state from a data object (from server template or API)
   */
  function applyState(data) {
    if (!data) return;

    var prevHp = bossState.currentHp;
    var prevPhase = bossState.currentPhase;

    bossState.currentPhase = data.phase || 1;
    bossState.currentHp = typeof data.current_hp === "number" ? data.current_hp : bossState.currentHp;
    bossState.maxHp = typeof data.max_hp === "number" ? data.max_hp : bossState.maxHp;
    bossState.totalMaxHp = typeof data.total_max_hp === "number" ? data.total_max_hp : bossState.totalMaxHp;
    bossState.totalCurrentHp = typeof data.total_current_hp === "number" ? data.total_current_hp : bossState.totalCurrentHp;
    bossState.bossName = data.name || (BOSS_PHASES[bossState.currentPhase] ? BOSS_PHASES[bossState.currentPhase].name : "");
    bossState.phaseTitle = "Phase " + bossState.currentPhase;
    bossState.lastHitBy = data.last_hit_by || null;

    // Detect live transitions or damage events during polling
    if (bossState.currentPhase > prevPhase) {
      // Phase transition detected
      bossState.animationState = "phase_transition";
      playTransitionCutscene(bossState.currentPhase);
    } else if (bossState.currentHp < prevHp) {
      // Damage detected
      bossState.animationState = "hit";
      playHitAnimation(bossState.currentPhase);
    } else if (data.state === "defeated") {
      bossState.animationState = "defeated";
      playDefeatedAnimation(bossState.currentPhase);
    } else if (data.state) {
      bossState.animationState = data.state;
    }
  }

  // =========================================================================
  // SPRITE ANIMATION INTEGRATION
  // =========================================================================

  /**
   * Initializes the sprite animator on the /boss page.
   */
  function initSpriteAnimator() {
    if (!window.BossSpriteAnimator) return;

    var container = document.querySelector(".boss-arena__sprite-container");
    if (!container) return;

    spriteAnimator = new window.BossSpriteAnimator.SpriteAnimator(container);
    spriteAnimator.idle(bossState.currentPhase);
  }

  /**
   * Plays the hit reaction animation with screen shake.
   */
  function playHitAnimation(phase) {
    if (!spriteAnimator) {
      // Fallback: use CSS class-based animations
      setTimeout(function () {
        bossState.animationState = "idle";
        updateArena();
      }, 350);
      return;
    }

    // Screen shake effect
    var container = document.querySelector(".boss-arena__sprite-container");
    if (container) {
      container.classList.remove("boss-arena__sprite-container--shake");
      // Force reflow to restart CSS animation
      void container.offsetWidth;
      container.classList.add("boss-arena__sprite-container--shake");
      setTimeout(function () {
        container.classList.remove("boss-arena__sprite-container--shake");
      }, 350);
    }

    // Play hit sprite animation, then return to idle
    spriteAnimator.playThenIdle(phase, "hit");

    // Reset state after animation
    setTimeout(function () {
      bossState.animationState = "idle";
      updateArena();
    }, 400);
  }

  /**
   * Plays the phase transition cutscene.
   * Design doc: "Transition between phases with cutscene (fade out → goddess appear → revive)."
   */
  function playTransitionCutscene(newPhase) {
    // 1. Flash the overlay
    var overlay = document.getElementById("boss-transition-overlay");
    if (overlay) {
      overlay.classList.remove("boss-arena__transition-overlay--active");
      void overlay.offsetWidth;
      overlay.classList.add("boss-arena__transition-overlay--active");
      setTimeout(function () {
        overlay.classList.remove("boss-arena__transition-overlay--active");
      }, 2200);
    }

    // 2. Play transition sprite animation, then idle in the new phase
    if (spriteAnimator) {
      spriteAnimator.play(newPhase, "phase_transition", function () {
        spriteAnimator.idle(newPhase);
      });
    }

    // 3. Reset state after cutscene
    setTimeout(function () {
      bossState.animationState = "idle";
      updateArena();
    }, 2000);
  }

  /**
   * Plays the defeated animation.
   */
  function playDefeatedAnimation(phase) {
    if (spriteAnimator) {
      spriteAnimator.play(phase, "defeated");
    }
    // Defeated state persists — no automatic return to idle
  }

  // =========================================================================
  // HELPER FUNCTIONS
  // =========================================================================

  function hpPercent(current, max) {
    if (max <= 0) return 0;
    return Math.max(0, Math.min(100, (current / max) * 100));
  }

  function formatHp(n) {
    if (typeof n !== "number") return "0";
    return n.toLocaleString();
  }

  function isBossPage() {
    return window.location.pathname === "/boss";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  // =========================================================================
  // MINI WIDGET — Rendered on every page except /boss
  // =========================================================================

  function createWidget() {
    if (document.getElementById("boss-widget")) return;
    if (isBossPage()) return;

    var phase = bossState.currentPhase;
    var phaseInfo = BOSS_PHASES[phase] || { name: bossState.bossName };
    var pct = hpPercent(bossState.currentHp, bossState.maxHp);

    var widget = document.createElement("div");
    widget.id = "boss-widget";
    widget.className = "boss-widget";
    widget.setAttribute("data-boss-phase", phase);

    widget.innerHTML =
      '<div class="boss-widget__header" id="boss-widget-toggle">' +
        '<div>' +
          '<div class="boss-widget__title">' + escapeHtml(phaseInfo.name) + '</div>' +
          '<div class="boss-widget__phase">' + escapeHtml(bossState.phaseTitle) + '</div>' +
        '</div>' +
        '<button class="boss-widget__toggle" aria-label="Toggle boss widget">&#9660;</button>' +
      '</div>' +
      '<div class="boss-widget__body" id="boss-widget-body">' +
        '<div class="boss-hp-bar">' +
          '<div class="boss-hp-bar__fill" style="width: ' + pct + '%"></div>' +
        '</div>' +
        '<div class="boss-widget__hp-text">' +
          '<span>HP</span>' +
          '<span>' + formatHp(bossState.currentHp) + ' / ' + formatHp(bossState.maxHp) + '</span>' +
        '</div>' +
        '<a href="/boss" class="boss-widget__link">View Boss Battle &rarr;</a>' +
      '</div>';

    document.body.appendChild(widget);

    var toggleBtn = document.getElementById("boss-widget-toggle");
    var body = document.getElementById("boss-widget-body");
    var collapsed = false;

    if (localStorage.getItem("boss-widget-collapsed") === "1") {
      body.classList.add("boss-widget__body--collapsed");
      collapsed = true;
      widget.querySelector(".boss-widget__toggle").innerHTML = "&#9650;";
    }

    toggleBtn.addEventListener("click", function () {
      collapsed = !collapsed;
      body.classList.toggle("boss-widget__body--collapsed", collapsed);
      widget.querySelector(".boss-widget__toggle").innerHTML = collapsed ? "&#9650;" : "&#9660;";
      localStorage.setItem("boss-widget-collapsed", collapsed ? "1" : "0");
    });
  }

  function updateWidget() {
    var widget = document.getElementById("boss-widget");
    if (!widget) return;

    var phase = bossState.currentPhase;
    var phaseInfo = BOSS_PHASES[phase] || { name: bossState.bossName };
    var pct = hpPercent(bossState.currentHp, bossState.maxHp);

    widget.setAttribute("data-boss-phase", phase);
    var titleEl = widget.querySelector(".boss-widget__title");
    if (titleEl) titleEl.textContent = phaseInfo.name;

    var phaseEl = widget.querySelector(".boss-widget__phase");
    if (phaseEl) phaseEl.textContent = bossState.phaseTitle;

    var fillEl = widget.querySelector(".boss-hp-bar__fill");
    if (fillEl) fillEl.style.width = pct + "%";

    var hpText = widget.querySelectorAll(".boss-widget__hp-text span");
    if (hpText.length >= 2) {
      hpText[1].textContent = formatHp(bossState.currentHp) + " / " + formatHp(bossState.maxHp);
    }
  }

  // =========================================================================
  // FULL BOSS PAGE — Arena Updater
  // =========================================================================

  function updateArena() {
    var arena = document.getElementById("boss-arena");
    if (!arena) return;

    var phase = bossState.currentPhase;
    var phaseInfo = BOSS_PHASES[phase] || { name: bossState.bossName };
    var pct = hpPercent(bossState.currentHp, bossState.maxHp);

    arena.setAttribute("data-boss-phase", phase);

    var nameEl = arena.querySelector(".boss-arena__name");
    if (nameEl) nameEl.textContent = phaseInfo.name;

    var phaseLabel = arena.querySelector(".boss-arena__phase-label");
    if (phaseLabel) phaseLabel.textContent = bossState.phaseTitle;

    var hpFill = arena.querySelector(".boss-hp-bar__fill");
    if (hpFill) hpFill.style.width = pct + "%";

    var hpNumbers = arena.querySelector(".boss-arena__hp-numbers");
    if (hpNumbers) {
      hpNumbers.textContent = formatHp(bossState.currentHp) + " / " + formatHp(bossState.maxHp);
    }

    var stateLabel = arena.querySelector(".boss-arena__state-label");
    if (stateLabel) stateLabel.textContent = bossState.animationState;

    var dots = arena.querySelectorAll(".boss-arena__phase-dot-circle");
    dots.forEach(function (dot, i) {
      var dotPhase = i + 1;
      dot.classList.remove("boss-arena__phase-dot-circle--active", "boss-arena__phase-dot-circle--completed");
      if (dotPhase === phase) {
        dot.classList.add("boss-arena__phase-dot-circle--active");
      } else if (dotPhase < phase) {
        dot.classList.add("boss-arena__phase-dot-circle--completed");
      }
    });

    // CSS class-based animation state (fallback when sprite sheets missing)
    var spriteContainer = arena.querySelector(".boss-arena__sprite-container");
    if (spriteContainer) {
      spriteContainer.classList.remove(
        "boss-arena__sprite-container--hit",
        "boss-arena__sprite-container--defeated",
        "boss-arena__sprite-container--transition"
      );
      if (bossState.animationState === "hit") {
        spriteContainer.classList.add("boss-arena__sprite-container--hit");
      } else if (bossState.animationState === "defeated") {
        spriteContainer.classList.add("boss-arena__sprite-container--defeated");
      } else if (bossState.animationState === "phase_transition") {
        spriteContainer.classList.add("boss-arena__sprite-container--transition");
      }
    }
  }

  function triggerHit() {
    bossState.animationState = "hit";
    playHitAnimation(bossState.currentPhase);
    updateArena();
    updateWidget();
  }

  // =========================================================================
  // API POLLING & REAL-TIME SYNC
  // =========================================================================

  function fetchBossState() {
    fetch("/api/boss/state")
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (resJson) {
        if (resJson && resJson.success && resJson.data) {
          applyState(resJson.data);
          updateArena();
          updateWidget();
        }
      })
      .catch(function (_err) {
        // Silently handle offline / unauthorized responses
      });
  }

  function startPolling(intervalMs) {
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(fetchBossState, intervalMs || 4000);
  }

  // =========================================================================
  // ADMIN INTERACTIVE CONTROLS
  // =========================================================================

  function adminDamage(amount) {
    fetch("/api/boss/damage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ damage: amount }),
    })
      .then(function (res) { return res.json(); })
      .then(function (resJson) {
        if (resJson && resJson.success && resJson.data && resJson.data.boss) {
          applyState(resJson.data.boss);
          updateArena();
          updateWidget();
        }
      })
      .catch(function (err) {
        console.error("Failed to apply admin damage:", err);
      });
  }

  function adminReset() {
    fetch("/api/boss/reset", {
      method: "POST",
    })
      .then(function (res) { return res.json(); })
      .then(function (resJson) {
        if (resJson && resJson.success && resJson.data) {
          applyState(resJson.data);
          // Re-initialize sprite animator for Phase 1
          if (spriteAnimator) {
            spriteAnimator.idle(1);
          }
          updateArena();
          updateWidget();
        }
      })
      .catch(function (err) {
        console.error("Failed to reset boss:", err);
      });
  }

  window.BossBattle = {
    getState: function () { return bossState; },
    applyState: function (data) {
      applyState(data);
      updateArena();
      updateWidget();
    },
    fetchState: fetchBossState,
    triggerHit: triggerHit,
    updateArena: updateArena,
    updateWidget: updateWidget,
    adminDamage: adminDamage,
    adminReset: adminReset,
  };

  // =========================================================================
  // INITIALIZATION
  // =========================================================================

  document.addEventListener("DOMContentLoaded", function () {
    if (window.INITIAL_BOSS_STATE) {
      applyState(window.INITIAL_BOSS_STATE);
    }

    createWidget();

    if (isBossPage()) {
      document.body.classList.add("boss-page-active");
      updateArena();
      // Initialize sprite animation system
      initSpriteAnimator();
    }

    // Start background sync every 4 seconds
    startPolling(4000);
  });
})();
