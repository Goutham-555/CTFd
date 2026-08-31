import datetime
from CTFd.models import db


# Phase configuration constants according to the design specifications
PHASE_CONFIG = {
    1: {
        "name": "Starscourged General",
        "threshold_pct": 0.70,  # 100% -> 70%
        "color": "#c0392b",
        "description": "The mounted warlord who leads the charge (100% - 70% HP).",
    },
    2: {
        "name": "Gravity Lord",
        "threshold_pct": 0.30,  # 70% -> 30%
        "color": "#8e44ad",
        "description": "Commands gravity itself (70% - 30% HP).",
    },
    3: {
        "name": "Promised Consort",
        "threshold_pct": 0.00,  # 30% -> 0%
        "color": "#d4a017",
        "description": "Empowered by the goddess (30% - 0% HP).",
    },
}

DEFAULT_MAX_HP = 50000


def calculate_phase(current_hp: int, max_hp: int) -> int:
    """
    Computes phase dynamically from current HP percentage:
      - Phase 1: > 70% HP
      - Phase 2: 30% < HP <= 70% (triggers when boss reaches 70%)
      - Phase 3: 0% < HP <= 30% (triggers when boss reaches 30%)
      - Defeated: <= 0% HP
    """
    if max_hp <= 0:
        return 1
    pct = current_hp / max_hp
    if pct > 0.70:
        return 1
    elif pct > 0.30:
        return 2
    else:
        return 3


class BossCombatLog(db.Model):
    """
    SQLAlchemy model storing individual boss hit logs, first bloods, and phase breaks.
    """
    __tablename__ = "boss_combat_log"

    id = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(db.Integer, nullable=True)
    challenge_name = db.Column(db.String(120), nullable=True)
    solver_name = db.Column(db.String(80), nullable=False)
    damage_dealt = db.Column(db.Integer, default=0, nullable=False)
    is_first_blood = db.Column(db.Boolean, default=False, nullable=False)
    is_phase_transition = db.Column(db.Boolean, default=False, nullable=False)
    phase = db.Column(db.Integer, default=1, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "challenge_id": self.challenge_id,
            "challenge_name": self.challenge_name or "Unknown Challenge",
            "solver_name": self.solver_name,
            "damage_dealt": self.damage_dealt,
            "is_first_blood": self.is_first_blood,
            "is_phase_transition": self.is_phase_transition,
            "phase": self.phase,
            "timestamp": self.timestamp.strftime("%H:%M:%S") if self.timestamp else "",
        }


class BossState(db.Model):
    """
    SQLAlchemy model storing the global community Boss state.
    """
    __tablename__ = "boss_state"

    id = db.Column(db.Integer, primary_key=True)
    phase = db.Column(db.Integer, default=1, nullable=False)
    name = db.Column(db.String(80), default="Starscourged General", nullable=False)
    current_hp = db.Column(db.Integer, default=DEFAULT_MAX_HP, nullable=False)
    max_hp = db.Column(db.Integer, default=DEFAULT_MAX_HP, nullable=False)
    total_damage = db.Column(db.Integer, default=0, nullable=False)
    state = db.Column(db.String(32), default="idle", nullable=False)  # idle, hit, attack, phase_transition, defeated
    last_hit_by = db.Column(db.String(80), nullable=True)
    last_hit_at = db.Column(db.DateTime, nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    @classmethod
    def get_or_create(cls):
        """
        Retrieves the singleton global boss record or initializes it if absent.
        """
        record = cls.query.filter_by(id=1).first()
        if not record:
            phase_1 = PHASE_CONFIG[1]
            record = cls(
                id=1,
                phase=1,
                name=phase_1["name"],
                current_hp=DEFAULT_MAX_HP,
                max_hp=DEFAULT_MAX_HP,
                total_damage=0,
                state="idle",
                is_active=True,
            )
            db.session.add(record)
            db.session.commit()
        return record

    def apply_damage(
        self,
        amount: int,
        solver_name: str = None,
        challenge_id: int = None,
        challenge_name: str = None,
        is_first_blood: bool = False,
    ) -> dict:
        """
        Applies damage to the boss, handles phase transitions and defeat states.
        Records a combat log entry.
        """
        if not self.is_active or self.state == "defeated" or self.current_hp <= 0:
            return {
                "damage_applied": 0,
                "transition": False,
                "defeated": True,
                "current_phase": self.phase,
                "current_hp": 0,
                "max_hp": self.max_hp,
            }

        amount = max(0, int(amount))
        self.total_damage += amount
        self.last_hit_by = solver_name or "Anonymous"
        self.last_hit_at = datetime.datetime.utcnow()

        old_phase = self.phase
        transition_occurred = False
        defeated_occurred = False

        if self.current_hp > amount:
            self.current_hp -= amount
            new_phase = calculate_phase(self.current_hp, self.max_hp)
            if new_phase > old_phase:
                self.phase = new_phase
                self.name = PHASE_CONFIG[new_phase]["name"]
                self.state = "phase_transition"
                transition_occurred = True
            else:
                self.phase = new_phase
                self.name = PHASE_CONFIG[new_phase]["name"]
                self.state = "hit"
        else:
            self.current_hp = 0
            self.phase = 3
            self.name = PHASE_CONFIG[3]["name"]
            self.state = "defeated"
            defeated_occurred = True

        # Record combat log entry
        log_entry = BossCombatLog(
            challenge_id=challenge_id,
            challenge_name=challenge_name,
            solver_name=self.last_hit_by,
            damage_dealt=amount,
            is_first_blood=is_first_blood,
            is_phase_transition=transition_occurred,
            phase=self.phase,
            timestamp=datetime.datetime.utcnow(),
        )
        db.session.add(log_entry)

        db.session.commit()
        clear_boss_state_cache()

        return {
            "damage_applied": amount,
            "transition": transition_occurred,
            "defeated": defeated_occurred,
            "current_phase": self.phase,
            "current_hp": self.current_hp,
            "max_hp": self.max_hp,
            "state": self.state,
            "is_first_blood": is_first_blood,
        }

    def set_hp(self, current_hp: int = None, max_hp: int = None) -> dict:
        """
        Admin method to change current and/or max HP in real time.
        Recomputes phase and state automatically.
        """
        if max_hp is not None:
            self.max_hp = max(1, int(max_hp))

        if current_hp is not None:
            self.current_hp = max(0, min(self.max_hp, int(current_hp)))

        if self.current_hp <= 0:
            self.current_hp = 0
            self.phase = 3
            self.name = PHASE_CONFIG[3]["name"]
            self.state = "defeated"
        else:
            self.phase = calculate_phase(self.current_hp, self.max_hp)
            self.name = PHASE_CONFIG[self.phase]["name"]
            self.state = "idle"

        db.session.commit()
        clear_boss_state_cache()

        return self.to_dict()

    def reset_boss(self):
        """
        Resets the boss to Phase 1 full health and clears combat logs.
        """
        phase_1 = PHASE_CONFIG[1]
        self.phase = 1
        self.name = phase_1["name"]
        self.current_hp = self.max_hp
        self.total_damage = 0
        self.state = "idle"
        self.last_hit_by = None
        self.last_hit_at = None
        self.is_active = True
        
        # Clear combat logs on full reset
        try:
            BossCombatLog.query.delete()
        except Exception:
            pass

        db.session.commit()
        clear_boss_state_cache()

    def to_dict(self) -> dict:
        """
        Serializes the model into a dictionary for API/Template consumption.
        """
        from CTFd.cache import cache
        data = cache.get("boss_state_dict")
        if data:
            return data

        hp_percent = ((self.current_hp / self.max_hp) * 100) if self.max_hp > 0 else 0

        # Retrieve recent 10 combat logs
        try:
            recent_logs = [
                log.to_dict()
                for log in BossCombatLog.query.order_by(BossCombatLog.id.desc()).limit(10).all()
            ]
        except Exception:
            recent_logs = []

        # Retrieve Top 5 Slayers
        try:
            from sqlalchemy import func
            top_query = (
                db.session.query(
                    BossCombatLog.solver_name,
                    func.sum(BossCombatLog.damage_dealt).label("total_damage"),
                    func.sum(db.case((BossCombatLog.is_first_blood == True, 1), else_=0)).label("first_bloods")
                )
                .group_by(BossCombatLog.solver_name)
                .order_by(func.sum(BossCombatLog.damage_dealt).desc())
                .limit(5)
                .all()
            )
            top_slayers = [
                {
                    "rank": idx + 1,
                    "name": row[0],
                    "total_damage": int(row[1] or 0),
                    "first_bloods": int(row[2] or 0),
                }
                for idx, row in enumerate(top_query)
            ]
        except Exception:
            top_slayers = []

        data = {
            "id": self.id,
            "phase": self.phase,
            "name": self.name,
            "current_hp": self.current_hp,
            "max_hp": self.max_hp,
            "hp_percent": round(hp_percent, 2),
            "total_max_hp": self.max_hp,
            "total_current_hp": self.current_hp,
            "total_damage": self.total_damage,
            "state": self.state,
            "last_hit_by": self.last_hit_by,
            "last_hit_at": self.last_hit_at.isoformat() if self.last_hit_at else None,
            "is_active": self.is_active,
            "recent_combat_log": recent_logs,
            "top_slayers": top_slayers,
        }

        # Cache for 10 seconds. Invalidation happens on damage / admin updates.
        cache.set("boss_state_dict", data, timeout=10)
        return data


def clear_boss_state_cache():
    from CTFd.cache import cache
    cache.delete("boss_state_dict")
    cache.delete("boss_api_state")
