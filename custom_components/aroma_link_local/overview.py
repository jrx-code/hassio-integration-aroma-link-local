"""Pure helpers for the current cycle, the schedule summary and the power rule (no Home Assistant import).

The numbers shown are the ones the device runs: the cycle comes from the enabled slot the device
reported, the summary from the weekly schedule HA keeps, the rule from the gating options.
"""
from __future__ import annotations

from .gating import GateConfig
from .model import Weekday, WeeklySchedule

RULE_NONE, RULE_OCCUPANCY, RULE_HVAC, RULE_OCCUPANCY_HVAC = "none", "occupancy", "hvac", "occupancy_hvac"
RULES = [RULE_NONE, RULE_OCCUPANCY, RULE_HVAC, RULE_OCCUPANCY_HVAC]


def dose_per_hour(work_sec: int, pause_sec: int) -> int:
    """Spray seconds per hour of a work/pause cycle."""
    total = work_sec + pause_sec
    return round(3600 * work_sec / total) if total > 0 else 0


def format_cycle(work_sec: int, pause_sec: int) -> str:
    return f"{work_sec} s / {pause_sec} s"


def active_cycle(slots) -> tuple[int, int] | None:
    """(work_sec, pause_sec) of the first enabled slot the device holds, else None."""
    for slot in slots or []:
        if slot.enabled:
            return slot.work_sec, slot.pause_sec
    return None


def _day_windows(schedule: WeeklySchedule, day: Weekday) -> list[tuple[str, str]]:
    return [(w.start, w.end) for w in schedule.days[day].enabled_windows()]


def schedule_windows(schedule: WeeklySchedule) -> dict[int, list[dict]]:
    """Per weekday (0=Mon) the enabled windows with their cycle and dose."""
    return {int(d): [{"start": w.start, "end": w.end, "work_sec": w.work_sec, "pause_sec": w.pause_sec,
                      "level": w.level, "dose_per_hour": dose_per_hour(w.work_sec, w.pause_sec)}
                     for w in schedule.days[d].enabled_windows()] for d in Weekday}


def summary_text(schedule: WeeklySchedule) -> str:
    """'08:00–22:30' when every day has the same windows, 'varies' when they differ, 'none' when empty."""
    per_day = [_day_windows(schedule, d) for d in Weekday]
    if all(not w for w in per_day):
        return "none"
    if any(w != per_day[0] for w in per_day):
        return "varies"
    return ", ".join(f"{s}–{e}" for s, e in per_day[0])


def power_rule(config: GateConfig) -> tuple[str, dict]:
    """(state, attributes): what switches the diffuser, from the gating options."""
    occ, hvac = bool(config.occupancy_entity), bool(config.climate_entity)
    state = (RULE_OCCUPANCY_HVAC if occ and hvac else RULE_OCCUPANCY if occ
             else RULE_HVAC if hvac else RULE_NONE)
    attrs: dict = {"gating_mode": config.gating_mode}
    if occ:
        attrs["occupancy_entity"] = config.occupancy_entity
        attrs["occupancy_off_delay_minutes"] = config.occupancy_off_delay_minutes
    if hvac:
        attrs["climate_entity"] = config.climate_entity
        attrs["hvac_off_delay_minutes"] = config.hvac_off_delay_minutes
    if config.block_entities:
        attrs["block_entities"] = list(config.block_entities)
    if config.motion_entities:
        attrs["motion_entities"] = list(config.motion_entities)
    return state, attrs


def overview_payload(device_id: str, mac: str, name: str, power: bool | None, work_status: str,
                     slots, schedule: WeeklySchedule, gate: GateConfig) -> dict:
    """Everything the overview card shows for one diffuser."""
    cycle = active_cycle(slots)
    state, attrs = power_rule(gate)
    return {
        "device_id": device_id, "mac": mac, "name": name, "power": bool(power), "work_status": work_status,
        "cycle": None if cycle is None else {"work_sec": cycle[0], "pause_sec": cycle[1],
                                              "dose_per_hour": dose_per_hour(*cycle)},
        "summary": summary_text(schedule), "windows": schedule_windows(schedule),
        "rule": {"state": state, **attrs},
    }
