from flask import Blueprint, jsonify, request

from CTFd.plugins import bypass_csrf_protection
from CTFd.plugins.boss_battle.models import BossState
from CTFd.utils.decorators import admins_only, authed_only
from CTFd.utils.user import get_current_user


boss_api_bp = Blueprint("boss_api", __name__, url_prefix="/api/boss")


from CTFd.cache import cache

@boss_api_bp.route("/state", methods=["GET"])
@cache.cached(timeout=10, key_prefix="boss_api_state")
@authed_only
def get_boss_state():
    """
    GET /api/boss/state
    Returns the current global boss status as JSON.
    """
    boss = BossState.get_or_create()
    return jsonify({
        "success": True,
        "data": boss.to_dict(),
    })


@boss_api_bp.route("/damage", methods=["POST"])
@admins_only
@bypass_csrf_protection
def admin_damage_boss():
    """
    POST /api/boss/damage
    Admin testing endpoint to manually apply damage to the boss.
    Expected JSON: {"damage": 1000}
    """
    req_data = request.get_json() or request.form
    try:
        damage_amount = int(req_data.get("damage", 1000))
    except (ValueError, TypeError):
        return jsonify({
            "success": False,
            "errors": {"damage": ["Invalid damage integer provided."]},
        }), 400

    user = get_current_user()
    solver_name = user.name if user else "Admin"

    boss = BossState.get_or_create()
    result = boss.apply_damage(damage_amount, solver_name=solver_name)

    return jsonify({
        "success": True,
        "data": {
            "result": result,
            "boss": boss.to_dict(),
        },
    })


@boss_api_bp.route("/reset", methods=["POST"])
@admins_only
@bypass_csrf_protection
def admin_reset_boss():
    """
    POST /api/boss/reset
    Admin testing endpoint to restore the boss to Phase 1 full health.
    """
    boss = BossState.get_or_create()
    boss.reset_boss()
    return jsonify({
        "success": True,
        "data": boss.to_dict(),
    })


@boss_api_bp.route("/hp", methods=["POST"])
@admins_only
@bypass_csrf_protection
def admin_set_boss_hp():
    """
    POST /api/boss/hp
    Admin endpoint to dynamically set current HP and/or max HP in real time.
    Expected JSON: {"current_hp": 35000, "max_hp": 50000} (both optional, at least one required)
    """
    req_data = request.get_json() or request.form
    current_hp = req_data.get("current_hp")
    max_hp = req_data.get("max_hp")

    if current_hp is None and max_hp is None:
        return jsonify({
            "success": False,
            "errors": {"hp": ["Provide at least current_hp or max_hp."]},
        }), 400

    try:
        current_hp_val = int(current_hp) if current_hp is not None else None
        max_hp_val = int(max_hp) if max_hp is not None else None
    except (ValueError, TypeError):
        return jsonify({
            "success": False,
            "errors": {"hp": ["Invalid integer provided for current_hp or max_hp."]},
        }), 400

    boss = BossState.get_or_create()
    updated_dict = boss.set_hp(current_hp=current_hp_val, max_hp=max_hp_val)

    return jsonify({
        "success": True,
        "data": updated_dict,
    })

