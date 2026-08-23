import datetime
from CTFd.models import db


# Phase configuration constants according to the design specifications
PHASE_CONFIG = {
    1: {
        "name": "Starscourged General",
        "max_hp": 15000,
        "color": "#c0392b",
        "description": "The mounted warlord who leads the charge.",
    },
    2: {
        "name": "Gravity Lord",
        "max_hp": 10500,
        "color": "#8e44ad",
        "description": "He has abandoned his steed and commands gravity itself.",
    },
    3: {
        "name": "Promised Consort",
        "max_hp": 15000,
        "color": "#d4a017",
        "description": "Empowered by the goddess, he becomes her consort.",
    },
}

TOTAL_BOSS_MAX_HP = sum(phase["max_hp"] for phase in PHASE_CONFIG.values())


class BossState(db.Model):
    """
    SQLAlchemy model storing the global community Boss state.
    """
    __tablename__ = "boss_state"

    id = db.Column(db.Integer, primary_key=True)
    phase = db.Column(db.Integer, default=1, nullable=False)
    name = db.Column(db.String(80), default="Starscourged General", nullable=False)
    current_hp = db.Column(db.Integer, default=15000, nullable=False)
    max_hp = db.Column(db.Integer, default=15000, nullable=False)
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
                current_hp=phase_1["max_hp"],
                max_hp=phase_1["max_hp"],
                total_damage=0,
                state="idle",
                is_active=True,
            )
            db.session.add(record)
            db.session.commit()
        return record

    def apply_damage(self, amount: int, solver_name: str = None) -> dict:
        """
        Applies damage to the boss, handles phase transitions and defeat states.
        Returns a summary dictionary of what occurred.
        """
        if not self.is_active or self.state == "defeated":
            return {
                "damage_applied": 0,
                "transition": False,
                "defeated": True,
                "current_phase": self.phase,
                "current_hp": 0,
            }

        amount = max(0, int(amount))
        self.total_damage += amount
        self.last_hit_by = solver_name
        self.last_hit_at = datetime.datetime.utcnow()

        transition_occurred = False
        defeated_occurred = False

        if self.current_hp > amount:
            self.current_hp -= amount
            self.state = "hit"
        else:
            remaining_damage = amount - self.current_hp
            if self.phase < 3:
                # Advance to next phase
                self.phase += 1
                next_phase = PHASE_CONFIG[self.phase]
                self.name = next_phase["name"]
                self.max_hp = next_phase["max_hp"]
                self.current_hp = max(0, self.max_hp - remaining_damage)
                self.state = "phase_transition"
                transition_occurred = True
            else:
                # Defeated in final phase
                self.current_hp = 0
                self.state = "defeated"
                defeated_occurred = True

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
        }

    def reset_boss(self):
        """
        Resets the boss to Phase 1 full health.
        """
        phase_1 = PHASE_CONFIG[1]
        self.phase = 1
        self.name = phase_1["name"]
        self.current_hp = phase_1["max_hp"]
        self.max_hp = phase_1["max_hp"]
        self.total_damage = 0
        self.state = "idle"
        self.last_hit_by = None
        self.last_hit_at = None
        self.is_active = True
        db.session.commit()
        clear_boss_state_cache()

    def to_dict(self) -> dict:
        """
        Serializes the model into a dictionary for API/Template consumption.
        Calculates cumulative properties (total_max_hp, total_current_hp).
        """
        from CTFd.cache import cache
        data = cache.get("boss_state_dict")
        if data:
            return data

        # Calculate remaining total health across all 3 phases
        remaining_total_hp = 0
        for p in range(self.phase, 4):
            if p == self.phase:
                remaining_total_hp += self.current_hp
            else:
                remaining_total_hp += PHASE_CONFIG[p]["max_hp"]

        data = {
            "id": self.id,
            "phase": self.phase,
            "name": self.name,
            "current_hp": self.current_hp,
            "max_hp": self.max_hp,
            "total_max_hp": TOTAL_BOSS_MAX_HP,
            "total_current_hp": remaining_total_hp,
            "total_damage": self.total_damage,
            "state": self.state,
            "last_hit_by": self.last_hit_by,
            "last_hit_at": self.last_hit_at.isoformat() if self.last_hit_at else None,
            "is_active": self.is_active,
        }
        
        # Cache for 10 seconds. Invalidation happens on damage.
        cache.set("boss_state_dict", data, timeout=10)
        return data

def clear_boss_state_cache():
    from CTFd.cache import cache
    cache.delete("boss_state_dict")
    cache.delete("boss_api_state")
