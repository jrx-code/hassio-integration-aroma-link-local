/**
 * Aroma-Link Schedule Overview: a read-only card.
 *
 * One block per diffuser: a 24 h bar for every weekday, the cycle the device runs now, the spray
 * seconds per hour and the rule that switches the power. Editing stays in
 * `custom:aroma-link-schedule-card`. Data comes from `aroma_link_local/get_overview`.
 *
 *   type: custom:aroma-link-schedule-overview
 *   title: Dyfuzory            # optional
 *   devices: [qdpu118T...]     # optional device ids, default all
 */
import { LitElement, html, css, nothing } from "./vendor/lit-all.min.js";

const EVENT_UPDATED = "aroma_link_local_updated";
const REFRESH_MS = 60000;

const TEXT = {
  en: {
    days: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    cycle: "Cycle now", dose: "Spray per hour", window: "Window", rule: "Power rule", none: "none",
    varies: "varies by day", unknown: "not reported", loading: "Loading", empty: "No diffusers found",
    rules: {
      none: "Always on in the window", occupancy: "Off without occupancy", hvac: "Follows HVAC",
      occupancy_hvac: "Off without occupancy, follows HVAC",
    },
    after: (m) => `${m} min after the last presence`,
    states: { off: "off", diffusing: "spraying", paused: "pause", idle: "outside window" },
  },
  pl: {
    days: ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"],
    cycle: "Cykl teraz", dose: "Rozpylanie na godzinę", window: "Okno", rule: "Reguła zasilania", none: "brak",
    varies: "zależnie od dnia", unknown: "brak odczytu", loading: "Wczytywanie", empty: "Brak dyfuzorów",
    rules: {
      none: "Zawsze włączone w oknie", occupancy: "Wyłączone bez obecności", hvac: "Zależne od wentylacji",
      occupancy_hvac: "Wyłączone bez obecności, zależne od wentylacji",
    },
    after: (m) => `${m} min po ostatniej obecności`,
    states: { off: "wyłączony", diffusing: "rozpyla", paused: "pauza", idle: "poza oknem" },
  },
};

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

class AromaLinkScheduleOverview extends LitElement {
  static properties = {
    _config: { state: true },
    _devices: { attribute: false, state: true },
    _error: { state: true },
  };

  constructor() {
    super();
    this._config = {};
    this._devices = null;
    this._error = null;
    this._hass = null;
    this._unsub = null;
    this._timer = null;
  }

  setConfig(config) {
    this._config = { ...config };
    if (this._hass) this._load();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  static getStubConfig() {
    return { type: "custom:aroma-link-schedule-overview" };
  }

  getCardSize() {
    return 6;
  }

  connectedCallback() {
    super.connectedCallback();
    this._timer = setInterval(() => this._load(), REFRESH_MS);
    if (this._hass) this._subscribe();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
    if (this._unsub) {
      this._unsub.then((fn) => fn()).catch(() => {});
      this._unsub = null;
    }
  }

  _subscribe() {
    if (this._unsub || !this._hass?.connection) return;
    this._unsub = this._hass.connection.subscribeEvents(() => this._load(), EVENT_UPDATED);
  }

  async _load() {
    if (!this._hass) return;
    this._subscribe();
    try {
      const res = await this._hass.callWS({ type: "aroma_link_local/get_overview" });
      const wanted = this._config.devices;
      this._devices = res.devices.filter((d) => !wanted || wanted.includes(d.device_id));
      this._error = null;
    } catch (err) {
      this._error = err?.message || String(err);
    }
  }

  get _t() {
    return (this._hass?.language || "en").startsWith("pl") ? TEXT.pl : TEXT.en;
  }

  _bars(device, t) {
    const todayIdx = (new Date().getDay() + 6) % 7;
    return html`<div class="days">
      ${t.days.map((label, day) => {
        const windows = device.windows[String(day)] || [];
        return html`<span class="d ${day === todayIdx ? "today" : ""}">${label}</span>
          <div class="track" role="img"
               aria-label="${label}: ${windows.map((w) => `${w.start}-${w.end}`).join(", ") || t.none}">
            ${windows.map((w) => {
              const left = (minutes(w.start) / 1440) * 100;
              const width = ((minutes(w.end) - minutes(w.start)) / 1440) * 100;
              return html`<i style="left:${left}%;width:${width}%"
                             title="${w.start}-${w.end}, ${w.work_sec} s / ${w.pause_sec} s"></i>`;
            })}
          </div>`;
      })}
      <span></span>
      <div class="axis" aria-hidden="true">
        ${Array.from({ length: 24 }, (_, h) => html`<span>${h % 3 === 0 ? String(h).padStart(2, "0") : ""}</span>`)}
      </div>
    </div>`;
  }

  _rule(device, t) {
    const r = device.rule;
    let text = t.rules[r.state] || r.state;
    if (r.occupancy_off_delay_minutes != null) text += `, ${t.after(r.occupancy_off_delay_minutes)}`;
    return text;
  }

  _device(device, t) {
    const cycle = device.cycle;
    const summary = device.summary === "none" ? t.none : device.summary === "varies" ? t.varies : device.summary;
    return html`<section>
      <header>
        <h3>${device.name}</h3>
        <span class="pill ${device.work_status}">${t.states[device.work_status] || device.work_status}</span>
      </header>
      ${this._bars(device, t)}
      <dl>
        <div><dt>${t.window}</dt><dd>${summary}</dd></div>
        <div><dt>${t.cycle}</dt><dd>${cycle ? `${cycle.work_sec} s / ${cycle.pause_sec} s` : t.unknown}</dd></div>
        <div><dt>${t.dose}</dt><dd>${cycle ? `${cycle.dose_per_hour} s` : t.unknown}</dd></div>
        <div class="wide"><dt>${t.rule}</dt><dd>${this._rule(device, t)}</dd></div>
      </dl>
    </section>`;
  }

  render() {
    const t = this._t;
    return html`<ha-card .header=${this._config.title || nothing}>
      <div class="body">
        ${this._error
          ? html`<p class="msg">${this._error}</p>`
          : this._devices === null
            ? html`<p class="msg">${t.loading}</p>`
            : this._devices.length === 0
              ? html`<p class="msg">${t.empty}</p>`
              : this._devices.map((d) => this._device(d, t))}
      </div>
    </ha-card>`;
  }

  static styles = css`
    .body { display: flex; flex-direction: column; gap: 20px; padding: 0 16px 16px; }
    ha-card:not([header]) .body { padding-top: 16px; }
    section { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    h3 { margin: 0; font-size: 16px; font-weight: 500; }
    .pill { font-size: 12px; padding: 2px 8px; border-radius: 99px; background: var(--secondary-background-color);
            color: var(--secondary-text-color); white-space: nowrap; }
    .pill.diffusing { background: var(--primary-color); color: var(--text-primary-color, #fff); }
    .days { display: grid; grid-template-columns: 28px 1fr; gap: 4px 8px; align-items: center; }
    .d { font-size: 11px; color: var(--secondary-text-color); }
    .d.today { color: var(--primary-text-color); font-weight: 600; }
    .track { position: relative; height: 14px; border-radius: 3px; background: var(--divider-color); overflow: hidden; }
    .track i { position: absolute; top: 0; bottom: 0; background: var(--primary-color); }
    .axis { display: grid; grid-template-columns: repeat(24, 1fr); font-size: 10px; color: var(--secondary-text-color); }
    .axis span { border-left: 1px solid var(--divider-color); padding-left: 2px; overflow: hidden; }
    dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px 16px; margin: 0; }
    dl div { min-width: 0; }
    dl .wide { grid-column: 1 / -1; }
    dt { font-size: 12px; color: var(--secondary-text-color); }
    dd { margin: 0; font-size: 14px; font-variant-numeric: tabular-nums; }
    .msg { margin: 0; color: var(--secondary-text-color); }
  `;
}

if (!customElements.get("aroma-link-schedule-overview")) {
  customElements.define("aroma-link-schedule-overview", AromaLinkScheduleOverview);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === "aroma-link-schedule-overview")) {
  window.customCards.push({
    type: "aroma-link-schedule-overview",
    name: "Aroma-Link schedule overview",
    description: "Read-only view of the weekly windows, current cycle, spray per hour and power rule of every diffuser.",
  });
}
