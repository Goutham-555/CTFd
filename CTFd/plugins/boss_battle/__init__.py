from flask import Blueprint, render_template

from CTFd.plugins import (
    register_plugin_assets_directory,
    register_plugin_script,
    register_plugin_stylesheet,
    register_user_page_menu_bar,
)
from CTFd.plugins.challenges import CHALLENGE_CLASSES
from CTFd.plugins.migrations import upgrade
from CTFd.plugins.boss_battle.api import boss_api_bp
from CTFd.plugins.boss_battle.models import BossState
from CTFd.utils.decorators import authed_only


boss_battle_bp = Blueprint(
    "boss_battle",
    __name__,
    template_folder="templates",
    static_folder="assets",
)


@boss_battle_bp.route("/boss")
@authed_only
def boss_page():
    """
    Renders the boss battle page with live database state.
    """
    boss = BossState.get_or_create()
    return render_template(
        "plugins/boss_battle/templates/boss.html",
        boss=boss.to_dict(),
    )


@boss_battle_bp.route("/")
@boss_battle_bp.route("/guide")
def guide_page():
    """
    Renders the Club Guide homepage.
    """
    return render_template("plugins/boss_battle/templates/guide.html")


def load(app):
    """
    CTFd plugin entry point.
    """
    # 1. Run database migrations and ensure all plugin tables exist
    upgrade(plugin_name="boss_battle")
    app.db.create_all()

    # 2. Override default static_html route so '/' always serves the Club Guide
    original_static_html = app.view_functions.get("views.static_html")
    def custom_static_html(route="index"):
        if route in ("index", "", "guide"):
            return render_template("plugins/boss_battle/templates/guide.html")
        if original_static_html:
            return original_static_html(route)
        return render_template("plugins/boss_battle/templates/guide.html")

    app.view_functions["views.static_html"] = custom_static_html

    # 3. Register page blueprint (/boss)
    app.register_blueprint(boss_battle_bp)

    # 3. Register API blueprint (/api/boss/state, /api/boss/damage, /api/boss/reset, /api/boss/hp)
    app.register_blueprint(boss_api_bp)

    # 4. Serve static assets (CSS, JS, sprite assets)
    register_plugin_assets_directory(
        app, base_path="/plugins/boss_battle/assets/"
    )

    # 5. Register navbar menu item
    register_user_page_menu_bar("Guide", "/guide")
    register_user_page_menu_bar("Boss Battle", "/boss")

    # 6. Inject CSS and JS globally for widget and arena support
    # boss-sprites.js must load BEFORE boss.js (SpriteAnimator dependency)
    register_plugin_stylesheet("/plugins/boss_battle/assets/boss.css?v=9")
    register_plugin_script("/plugins/boss_battle/assets/boss-sprites.js?v=9")
    register_plugin_script("/plugins/boss_battle/assets/boss.js?v=9")

    # 7. Hook into challenge solves to apply boss damage & award First Bloods
    # We use before_request to ensure all other plugins (including challenge types)
    # have finished loading their classes into CHALLENGE_CLASSES.
    wrapper_applied = False

    @app.before_request
    def apply_challenge_wrappers():
        nonlocal wrapper_applied
        if wrapper_applied:
            return

        for chal_type, chal_class in CHALLENGE_CLASSES.items():
            original_solve = chal_class.solve

            # Closure to capture the original method properly
            def make_wrapper(orig):
                @classmethod
                def solve_wrapper(cls, user, team, challenge, request):
                    # 1. Call the original solve method (which saves the solve to the DB)
                    result = orig.__func__(cls, user, team, challenge, request)
                    
                    # 2. Check if this is First Blood on the challenge
                    from CTFd.models import Solves
                    try:
                        solve_count = Solves.query.filter_by(challenge_id=challenge.id).count()
                        is_first_blood = (solve_count == 1)
                    except Exception:
                        is_first_blood = False

                    # 3. Apply damage with 1.5x First Blood bonus!
                    base_damage = challenge.value or 0
                    if base_damage > 0:
                        damage = int(base_damage * 1.5) if is_first_blood else base_damage
                        solver_name = team.name if team else (user.name if user else "Anonymous")
                        boss = BossState.get_or_create()
                        if boss.is_active and boss.current_hp > 0:
                            boss.apply_damage(
                                amount=damage,
                                solver_name=solver_name,
                                challenge_id=challenge.id,
                                challenge_name=challenge.name if hasattr(challenge, 'name') else None,
                                is_first_blood=is_first_blood,
                            )
                            
                    return result
                return solve_wrapper

            chal_class.solve = make_wrapper(original_solve)

        wrapper_applied = True
