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
    1: { name: "Starscourged General", threshold: 0.70, color: "#c0392b" },
    2: { name: "Gravity Lord",         threshold: 0.30, color: "#8e44ad" },
    3: { name: "Promised Consort",     threshold: 0.00, color: "#d4a017" },
  };

  var bossState = {
    currentPhase: 1,
    currentHp: 50000,
    maxHp: 50000,
    totalMaxHp: 50000,
    totalCurrentHp: 50000,
    animationState: "idle", // idle | hit | attack | phase_transition | defeated
    bossName: "Starscourged General",
    phaseTitle: "Phase 1",
    lastHitBy: null,
  };

  var pollingInterval = null;
  var spriteAnimator = null; // SpriteAnimator instance for the /boss page

  var lastSeenLogId = 0;

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
    bossState.totalMaxHp = typeof data.total_max_hp === "number" ? data.total_max_hp : bossState.maxHp;
    bossState.totalCurrentHp = typeof data.total_current_hp === "number" ? data.total_current_hp : bossState.currentHp;
    bossState.bossName = data.name || (BOSS_PHASES[bossState.currentPhase] ? BOSS_PHASES[bossState.currentPhase].name : "");
    bossState.phaseTitle = "Phase " + bossState.currentPhase;
    bossState.lastHitBy = data.last_hit_by || null;
    bossState.recentLogs = data.recent_combat_log || [];
    bossState.topSlayers = data.top_slayers || [];

    // Check for newly arrived First Blood events to pop up the banner
    if (bossState.recentLogs && bossState.recentLogs.length > 0) {
      var latestLog = bossState.recentLogs[0];
      if (lastSeenLogId > 0 && latestLog.id > lastSeenLogId && latestLog.is_first_blood) {
        showFirstBloodBanner(latestLog.solver_name, latestLog.damage_dealt);
      }
      lastSeenLogId = Math.max(lastSeenLogId, latestLog.id);
    }

    // Synchronize Admin Inputs if user is not actively typing
    var curInput = document.getElementById("admin-current-hp");
    if (curInput && document.activeElement !== curInput) {
      curInput.value = bossState.currentHp;
    }
    var maxInput = document.getElementById("admin-max-hp");
    if (maxInput && document.activeElement !== maxInput) {
      maxInput.value = bossState.maxHp;
    }

    // Detect live transitions or damage events during polling
    if (bossState.currentPhase > prevPhase) {
      // Phase transition detected
      bossState.animationState = "phase_transition";
      playTransitionCutscene(bossState.currentPhase);
    } else if (bossState.currentHp < prevHp) {
      // Damage detected
      bossState.animationState = "hit";
      playHitAnimation(bossState.currentPhase);
    } else if (data.state === "defeated" || bossState.currentHp <= 0) {
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
    var container = document.querySelector(".boss-arena__sprite-container");
    if (container) {
      // Visual flash effect on the boss element
      container.classList.add("boss-arena__sprite-container--flash");
      setTimeout(function () {
        container.classList.remove("boss-arena__sprite-container--flash");
      }, 150);
    }

    if (!spriteAnimator) {
      // Fallback
      setTimeout(function () {
        bossState.animationState = "idle";
        updateArena();
      }, 350);
      return;
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

    var toggleBtn = widget.querySelector(".boss-widget__toggle");
    var header = document.getElementById("boss-widget-toggle");
    var body = document.getElementById("boss-widget-body");
    var collapsed = false;

    // Load collapsed state
    if (localStorage.getItem("boss-widget-collapsed") === "1") {
      body.classList.add("boss-widget__body--collapsed");
      collapsed = true;
      toggleBtn.innerHTML = "&#9650;";
    }

    // Toggle collapse on button click
    toggleBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      collapsed = !collapsed;
      body.classList.toggle("boss-widget__body--collapsed", collapsed);
      toggleBtn.innerHTML = collapsed ? "&#9650;" : "&#9660;";
      localStorage.setItem("boss-widget-collapsed", collapsed ? "1" : "0");
    });

    // -----------------------------------------------------------------------
    // Draggable Mechanics (Mouse & Touch)
    // -----------------------------------------------------------------------
    var isDragging = false;
    var hasMoved = false;
    var startX, startY, initialLeft, initialTop;

    // Restore saved position if exists
    var savedPos = localStorage.getItem("boss-widget-position");
    if (savedPos) {
      try {
        var pos = JSON.parse(savedPos);
        widget.style.left = pos.x + "px";
        widget.style.top = pos.y + "px";
        widget.style.right = "auto";
        widget.style.bottom = "auto";
      } catch (_e) {}
    }

    function onPointerDown(e) {
      // Don't drag if clicking buttons or links
      if (e.target.closest(".boss-widget__toggle") || e.target.closest("a")) return;

      isDragging = true;
      hasMoved = false;
      var clientX = e.clientX || (e.touches && e.touches[0].clientX);
      var clientY = e.clientY || (e.touches && e.touches[0].clientY);

      var rect = widget.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;
      startX = clientX;
      startY = clientY;

      widget.classList.add("boss-widget--dragging");
      document.addEventListener("mousemove", onPointerMove);
      document.addEventListener("mouseup", onPointerUp);
      document.addEventListener("touchmove", onPointerMove, { passive: false });
      document.addEventListener("touchend", onPointerUp);
    }

    function onPointerMove(e) {
      if (!isDragging) return;
      var clientX = e.clientX || (e.touches && e.touches[0].clientX);
      var clientY = e.clientY || (e.touches && e.touches[0].clientY);

      var deltaX = clientX - startX;
      var deltaY = clientY - startY;

      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        hasMoved = true;
      }

      var newLeft = Math.max(10, Math.min(window.innerWidth - widget.offsetWidth - 10, initialLeft + deltaX));
      var newTop = Math.max(10, Math.min(window.innerHeight - widget.offsetHeight - 10, initialTop + deltaY));

      widget.style.left = newLeft + "px";
      widget.style.top = newTop + "px";
      widget.style.right = "auto";
      widget.style.bottom = "auto";

      if (e.cancelable) e.preventDefault();
    }

    function onPointerUp() {
      if (!isDragging) return;
      isDragging = false;
      widget.classList.remove("boss-widget--dragging");

      document.removeEventListener("mousemove", onPointerMove);
      document.removeEventListener("mouseup", onPointerUp);
      document.removeEventListener("touchmove", onPointerMove);
      document.removeEventListener("touchend", onPointerUp);

      // Save custom coordinates
      var rect = widget.getBoundingClientRect();
      localStorage.setItem("boss-widget-position", JSON.stringify({ x: rect.left, y: rect.top }));
    }

    header.addEventListener("mousedown", onPointerDown);
    header.addEventListener("touchstart", onPointerDown, { passive: true });
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

    if (bossState.recentLogs) {
      updateCombatLog(bossState.recentLogs);
    }
    if (bossState.topSlayers) {
      updateTopSlayers(bossState.topSlayers);
    }
  }

  function showFirstBloodBanner(teamName, damage) {
    var banner = document.getElementById("boss-first-blood-banner");
    var teamEl = document.getElementById("boss-first-blood-team");
    if (!banner || !teamEl) return;

    teamEl.textContent = (teamName || "Team") + (damage ? " (+" + formatHp(damage) + " CRIT!)" : "");
    banner.classList.remove("boss-first-blood-banner--active");
    void banner.offsetWidth;
    banner.classList.add("boss-first-blood-banner--active");
    setTimeout(function () {
      banner.classList.remove("boss-first-blood-banner--active");
    }, 4500);
  }

  function updateCombatLog(logs) {
    var container = document.getElementById("boss-combat-log-container");
    if (!container) return;

    if (!logs || logs.length === 0) {
      container.innerHTML = '<div class="text-muted small text-center py-3">No strikes recorded yet. Solve challenges to strike the boss!</div>';
      return;
    }

    var html = '<div class="boss-combat-log-list">';
    logs.forEach(function (log) {
      var fbBadge = log.is_first_blood
        ? '<span class="badge bg-danger text-light me-1" style="font-size:0.6rem; letter-spacing:0.5px;">🩸 1.5x CRIT</span>'
        : '';
      var ptBadge = log.is_phase_transition
        ? '<span class="badge bg-warning text-dark me-1" style="font-size:0.6rem;">⚡ PHASE BREAKER</span>'
        : '';

      html +=
        '<div class="boss-combat-log-item d-flex justify-content-between align-items-center py-1 border-bottom border-secondary">' +
          '<div class="text-truncate me-2">' +
            '<span class="text-muted me-1 font-monospace" style="font-size:0.65rem;">[' + escapeHtml(log.timestamp) + ']</span>' +
            fbBadge +
            ptBadge +
            '<strong class="text-light">' + escapeHtml(log.solver_name) + '</strong>' +
            '<span class="text-muted"> solved </span>' +
            '<span class="text-info font-italic">"' + escapeHtml(log.challenge_name) + '"</span>' +
          '</div>' +
          '<div class="text-danger font-weight-bold text-nowrap font-monospace" style="font-size:0.75rem;">' +
            '-' + formatHp(log.damage_dealt) + ' DMG' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    container.innerHTML = html;
  }

  function updateTopSlayers(slayers) {
    var tbody = document.getElementById("boss-top-slayers-tbody");
    if (!tbody) return;

    if (!slayers || slayers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-2">No damage leaders yet.</td></tr>';
      return;
    }

    var rankIcons = ["🥇", "🥈", "🥉", "4", "5"];
    var html = "";
    slayers.forEach(function (s, idx) {
      var rankBadge = rankIcons[idx] || (idx + 1);
      html +=
        '<tr>' +
          '<td class="font-weight-bold">' + rankBadge + '</td>' +
          '<td class="text-truncate text-light font-weight-bold" style="max-width: 120px;">' + escapeHtml(s.name) + '</td>' +
          '<td class="text-end text-danger font-monospace">' + formatHp(s.total_damage) + '</td>' +
          '<td class="text-center text-danger font-weight-bold">' + (s.first_bloods > 0 ? ('🩸' + s.first_bloods) : '-') + '</td>' +
        '</tr>';
    });
    tbody.innerHTML = html;
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

  var currentIntervalMs = 4000;

  function startPolling(intervalMs) {
    if (intervalMs) currentIntervalMs = intervalMs;
    if (pollingInterval) clearInterval(pollingInterval);
    pollingInterval = setInterval(fetchBossState, currentIntervalMs);
  }

  // Optimization: Slow down polling when the tab is inactive
  document.addEventListener("visibilitychange", function() {
    if (document.hidden) {
      // Backoff to 30 seconds when tab is hidden
      startPolling(30000);
    } else {
      // Resume normal 4-second polling and immediately fetch the latest state
      fetchBossState();
      startPolling(4000);
    }
  });

  function adminSetHp(currentHp, maxHp) {
    var payload = {};
    if (currentHp !== undefined && currentHp !== null) payload.current_hp = currentHp;
    if (maxHp !== undefined && maxHp !== null) payload.max_hp = maxHp;

    fetch("/api/boss/hp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json(); })
      .then(function (resJson) {
        if (resJson && resJson.success && resJson.data) {
          applyState(resJson.data);
          if (spriteAnimator) {
            spriteAnimator.idle(bossState.currentPhase);
          }
          updateArena();
          updateWidget();
        }
      })
      .catch(function (err) {
        console.error("Failed to set boss HP:", err);
      });
  }

  function adminSetHpInput() {
    var el = document.getElementById("admin-current-hp");
    if (!el) return;
    var val = parseInt(el.value, 10);
    if (!isNaN(val)) {
      adminSetHp(val, null);
    }
  }

  function adminSetMaxHpInput() {
    var el = document.getElementById("admin-max-hp");
    if (!el) return;
    var val = parseInt(el.value, 10);
    if (!isNaN(val)) {
      adminSetHp(null, val);
    }
  }

  function adminJumpPhase(targetPhase) {
    var max = bossState.maxHp || 50000;
    if (targetPhase === 1) {
      adminSetHp(max, null);
    } else if (targetPhase === 2) {
      adminSetHp(Math.round(max * 0.70), null);
    } else if (targetPhase === 3) {
      adminSetHp(Math.round(max * 0.30), null);
    }
  }

  function adminDamage(amount) {
    if (amount < 0) {
      // Healing: increase HP
      var newHp = Math.min(bossState.maxHp, bossState.currentHp - amount);
      adminSetHp(newHp, null);
      return;
    }

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
    adminSetHp: adminSetHp,
    adminSetHpInput: adminSetHpInput,
    adminSetMaxHpInput: adminSetMaxHpInput,
    adminJumpPhase: adminJumpPhase,
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
