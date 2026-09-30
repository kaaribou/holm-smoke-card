/* holm-smoke-card — https://github.com/kaaribou/holm-smoke-card — licence MIT — v1.0.0 */
/* HOLM Smoke Card
 * Détecteurs de fumée avec sirène : état global, fumée, pile, température,
 * et commande des sirènes (confirmation intégrée pour le déclenchement,
 * arrêt immédiat). Les capteurs de chaque détecteur sont trouvés
 * automatiquement à partir de l'appareil de l'entité sirène.
 */
(() => {
  const fmtAgo = (iso) => {
    if (!iso) return "";
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return "à l'instant";
    if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
    if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
    return `il y a ${Math.round(s / 86400)} j`;
  };
  const isOn = (st) => st && (st.state === "on" || st.state === "detected");

  class HolmSmokeCard extends HTMLElement {
    static getConfigElement() {
      return document.createElement("holm-smoke-card-editor");
    }
    static getStubConfig(hass) {
      const s = hass ? Object.keys(hass.states).filter((k) => k.startsWith("siren.")).slice(0, 4) : [];
      return { type: "custom:holm-smoke-card", title: "Détecteurs de fumée", detectors: s.map((e) => ({ entity: e })) };
    }
    setConfig(config) {
      if (!config || !Array.isArray(config.detectors) || !config.detectors.length) throw new Error("Ajoute au moins un détecteur (entité sirène).");
      this._config = { title: "Détecteurs de fumée", low_battery: 25, ...config };
      this._map = null;
      this._confirm = null;
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this._built = false;
      if (this._hass) this.hass = this._hass;
    }
    getCardSize() {
      return 2 + this._config.detectors.length;
    }
    getGridOptions() {
      return { columns: 12, min_columns: 6, rows: "auto" };
    }
    set hass(hass) {
      const first = !this._hass;
      this._hass = hass;
      if (!this._config) return;
      if (!this._map || first) this._detect();
      if (!this._built) this._build();
      this._render();
    }

    _detect() {
      const h = this._hass;
      const ents = h.entities || {};
      const dc = (id) => (h.states[id] && h.states[id].attributes.device_class) || "";
      this._map = this._config.detectors.map((d) => {
        const cfg = typeof d === "string" ? { entity: d } : d;
        const dev = ents[cfg.entity] && ents[cfg.entity].device_id;
        const sib = dev ? Object.keys(ents).filter((id) => ents[id].device_id === dev && h.states[id]) : [];
        const find = (dom, cls, re) => sib.find((id) => id.startsWith(dom + ".") && dc(id) === cls && (!re || re.test(id))) || null;
        const devName = dev && h.devices && h.devices[dev] ? h.devices[dev].name_by_user || h.devices[dev].name : "";
        return {
          siren: cfg.entity,
          name: cfg.name || (devName || (h.states[cfg.entity] && h.states[cfg.entity].attributes.friendly_name) || cfg.entity).replace(/^Détecteur de fumée\s*/i, "").replace(/\s*Alarm$/i, "") || "Détecteur",
          smoke: cfg.smoke_entity || find("binary_sensor", "smoke"),
          battery: cfg.battery_entity || find("sensor", "battery", /_battery$/) || find("sensor", "battery"),
          batteryLow: find("binary_sensor", "battery"),
          temp: cfg.temperature_entity || find("sensor", "temperature"),
          fault: find("binary_sensor", "problem"),
        };
      });
    }

    _build() {
      const root = this.shadowRoot;
      root.innerHTML = `<style>${HolmSmokeCard.css()}</style>
        <ha-card>
          <div class="amb"></div>
          <div class="wrap">
            <div class="banner" id="banner">
              <div class="shield"><ha-icon id="bicon"></ha-icon><span class="ring"></span></div>
              <div class="bt">
                <div class="title" id="title"></div>
                <div class="bsub" id="bsub"></div>
              </div>
              <button class="stopall" id="stopall"><ha-icon icon="mdi:volume-off"></ha-icon><span>Tout couper</span></button>
            </div>
            <div class="list" id="list"></div>
          </div>
          <div class="sheet" id="sheet">
            <div class="sheet-in">
              <div class="warn"><ha-icon icon="mdi:bullhorn"></ha-icon></div>
              <div class="q" id="q"></div>
              <div class="qs">La sirène va sonner très fort dans la maison.</div>
              <div class="btns"><button class="cancel" id="cancel">Annuler</button><button class="go" id="go">Déclencher</button></div>
            </div>
          </div>
        </ha-card>`;
      this._card = root.querySelector("ha-card");
      this.$ = (id) => root.getElementById(id);
      this.$("stopall").addEventListener("click", () => {
        this._map.filter((d) => isOn(this._hass.states[d.siren])).forEach((d) => this._siren(d.siren, false));
      });
      this.$("cancel").addEventListener("click", () => this._closeConfirm());
      this.$("sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") this._closeConfirm(); });
      this.$("go").addEventListener("click", () => {
        if (this._confirm) this._siren(this._confirm, true);
        this._closeConfirm();
      });
      this._built = true;
    }

    _siren(id, on) {
      const dom = id.split(".")[0];
      this._hass.callService(dom === "siren" ? "siren" : "homeassistant", on ? "turn_on" : "turn_off", { entity_id: id });
    }
    _closeConfirm() {
      this._confirm = null;
      this._card.classList.remove("confirm");
    }
    _more(id) {
      this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: id }, bubbles: true, composed: true }));
    }

    _render() {
      const h = this._hass;
      const $ = this.$;
      const low = Number(this._config.low_battery);
      const rows = this._map.map((d) => {
        const smoke = isOn(h.states[d.smoke]);
        const siren = isOn(h.states[d.siren]);
        const bs = h.states[d.battery];
        const bat = bs && !isNaN(parseFloat(bs.state)) ? parseFloat(bs.state) : null;
        const batLow = (bat != null && bat <= low) || isOn(h.states[d.batteryLow]);
        const fault = isOn(h.states[d.fault]);
        const unav = !h.states[d.siren] || h.states[d.siren].state === "unavailable";
        const ts = h.states[d.temp];
        const temp = ts && !isNaN(parseFloat(ts.state)) ? parseFloat(ts.state) : null;
        const lvl = smoke ? "fire" : siren ? "siren" : unav || fault ? "fault" : batLow ? "low" : "ok";
        return { d, smoke, siren, bat, batLow, fault, unav, temp, lvl };
      });
      const worst = ["fire", "siren", "fault", "low"].find((l) => rows.some((r) => r.lvl === l)) || "ok";
      const names = (l) => rows.filter((r) => r.lvl === l).map((r) => r.d.name).join(", ");
      const B = {
        ok: { icon: "mdi:shield-check", txt: `Tout est normal · ${rows.length} détecteur${rows.length > 1 ? "s" : ""}` },
        low: { icon: "mdi:battery-alert-variant-outline", txt: `Pile faible : ${names("low")}` },
        fault: { icon: "mdi:alert-circle-outline", txt: `À vérifier : ${names("fault")}` },
        siren: { icon: "mdi:bullhorn", txt: `Sirène en marche : ${names("siren")}` },
        fire: { icon: "mdi:fire-alert", txt: `Fumée détectée : ${names("fire")}` },
      }[worst];
      this._card.dataset.lvl = worst;
      $("title").textContent = this._config.title;
      $("bicon").setAttribute("icon", B.icon);
      $("bsub").textContent = B.txt;
      $("stopall").style.display = rows.some((r) => r.siren) ? "" : "none";

      const list = $("list");
      const key = JSON.stringify(rows.map((r) => [r.lvl, r.siren, r.bat, r.temp, r.unav]));
      if (list._key !== key) {
        list._key = key;
        list.innerHTML = "";
        rows.forEach((r) => {
          const el = document.createElement("div");
          el.className = `det ${r.lvl}`;
          const bcls = r.bat == null ? "" : r.bat <= low ? "red" : r.bat <= 50 ? "amber" : "good";
          const bicon = r.bat == null ? "mdi:battery-unknown" : `mdi:battery${r.bat >= 95 ? "" : r.bat < 10 ? "-outline" : "-" + Math.floor(r.bat / 10) * 10}`;
          const status = r.smoke ? "Fumée détectée !" : r.siren ? "Sirène en marche" : r.unav ? "Indisponible" : r.fault ? "Défaut" : "Surveillance active";
          const sub = [status, r.temp != null ? `${String(r.temp).replace(".", ",")}°` : ""].filter(Boolean).join(" · ");
          el.innerHTML = `
            <div class="ico"><ha-icon icon="${r.smoke ? "mdi:smoke-detector-variant-alert" : r.unav ? "mdi:smoke-detector-variant-off" : "mdi:smoke-detector-variant"}"></ha-icon><i></i><i></i><i></i></div>
            <div class="dt"><div class="dn">${r.d.name}</div><div class="ds">${sub}</div></div>
            <button class="bat ${bcls}" title="Batterie"><ha-icon icon="${bicon}"></ha-icon><span>${r.bat == null ? "–" : Math.round(r.bat) + "%"}</span><b style="--p:${r.bat == null ? 0 : r.bat}%"></b></button>
            <button class="sir${r.siren ? " on" : ""}" title="${r.siren ? "Arrêter la sirène" : "Déclencher la sirène"}" ${r.unav ? "disabled" : ""}><ha-icon icon="${r.siren ? "mdi:bullhorn" : "mdi:bullhorn-outline"}"></ha-icon><s></s><s></s></button>`;
          el.querySelector(".dt").addEventListener("click", () => this._more(r.d.smoke || r.d.siren));
          el.querySelector(".ico").addEventListener("click", () => this._more(r.d.smoke || r.d.siren));
          el.querySelector(".bat").addEventListener("click", () => r.d.battery && this._more(r.d.battery));
          el.querySelector(".sir").addEventListener("click", () => {
            if (r.siren) return this._siren(r.d.siren, false);
            this._confirm = r.d.siren;
            $("q").textContent = `Déclencher la sirène ${r.d.name} ?`;
            this._card.classList.add("confirm");
          });
          list.appendChild(el);
        });
      }
    }

    static css() {
      return `
      :host { display: block; }
      ha-card {
        display: block; position: relative; overflow: hidden; container-type: inline-size;
        --ok: 45,212,191; --low: 251,191,36; --fault: 148,163,184; --siren: 249,115,22; --fire: 239,68,68;
        --c: var(--ok);
        --tx: #e6f2f5; --tx2: rgba(220,235,240,.62);
        border-radius: var(--ha-card-border-radius, 20px);
        background: linear-gradient(160deg, rgba(20,28,38,.92), rgba(10,15,22,.96));
        border: 1px solid rgba(var(--c), .2);
        box-shadow: 0 8px 26px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.04);
        color: var(--tx); user-select: none; -webkit-tap-highlight-color: transparent;
      }
      ha-card[data-lvl="low"] { --c: var(--low); } ha-card[data-lvl="fault"] { --c: var(--fault); }
      ha-card[data-lvl="siren"] { --c: var(--siren); } ha-card[data-lvl="fire"] { --c: var(--fire); }
      ha-card[data-lvl="fire"], ha-card[data-lvl="siren"] { animation: alarm 1.2s ease-in-out infinite; }
      @keyframes alarm { 50% { box-shadow: 0 0 28px rgba(var(--c), .55), inset 0 0 20px rgba(var(--c), .15); border-color: rgba(var(--c), .9); } }
      button { font: inherit; color: inherit; border: 0; background: none; cursor: pointer; padding: 0; -webkit-tap-highlight-color: transparent; }
      .amb { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(90% 60% at 0% 0%, rgba(var(--c), .16), transparent 70%); }
      .wrap { position: relative; padding: 12px; display: flex; flex-direction: column; gap: 10px; }

      .banner { display: flex; align-items: center; gap: 11px; padding: 10px 10px 10px 10px; border-radius: 16px; background: rgba(var(--c), .1); box-shadow: inset 0 0 0 1px rgba(var(--c), .22); }
      .shield { position: relative; flex: 0 0 42px; width: 42px; height: 42px; border-radius: 14px; display: grid; place-items: center; color: rgb(var(--c)); background: rgba(var(--c), .18); }
      .shield ha-icon { --mdc-icon-size: 24px; position: relative; z-index: 1; }
      .shield .ring { position: absolute; inset: 0; border-radius: 14px; border: 2px solid rgba(var(--c), .6); opacity: 0; }
      ha-card[data-lvl="ok"] .shield .ring { animation: ring 3.2s ease-out infinite; }
      ha-card[data-lvl="fire"] .shield .ring, ha-card[data-lvl="siren"] .shield .ring { animation: ring 1s ease-out infinite; }
      @keyframes ring { 0% { transform: scale(.9); opacity: .8; } 100% { transform: scale(1.5); opacity: 0; } }
      .bt { flex: 1; min-width: 0; }
      .title { font-size: 15px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .bsub { font-size: 12px; color: rgb(var(--c)); font-weight: 600; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      ha-card[data-lvl="ok"] .bsub { color: var(--tx2); }
      .stopall { flex: 0 0 auto; display: flex; align-items: center; gap: 5px; height: 36px; padding: 0 12px; border-radius: 12px; font-size: 12.5px; font-weight: 700; color: #fff; background: linear-gradient(180deg, rgb(var(--fire)), rgba(var(--fire), .75)); box-shadow: 0 4px 14px -3px rgba(var(--fire), .7); }
      .stopall ha-icon { --mdc-icon-size: 18px; }

      .list { display: grid; grid-template-columns: 1fr; gap: 6px; }
      .det { --d: var(--ok); position: relative; display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 8px; border-radius: 14px; background: rgba(255,255,255,.045); box-shadow: inset 0 0 0 1px rgba(255,255,255,.06); overflow: hidden; }
      .det.low { --d: var(--low); } .det.fault { --d: var(--fault); } .det.siren { --d: var(--siren); } .det.fire { --d: var(--fire); }
      .det.fire, .det.siren { background: rgba(var(--d), .14); box-shadow: inset 0 0 0 1px rgba(var(--d), .5); }
      .ico { position: relative; flex: 0 0 38px; width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; color: rgb(var(--d)); background: rgba(var(--d), .13); cursor: pointer; }
      .ico ha-icon { --mdc-icon-size: 22px; position: relative; z-index: 1; }
      .det.ok .ico::after { content: ""; position: absolute; top: 3px; right: 3px; width: 7px; height: 7px; border-radius: 50%; background: rgb(var(--ok)); box-shadow: 0 0 6px rgb(var(--ok)); animation: blink 2.4s ease-in-out infinite; z-index: 2; }
      @keyframes blink { 0%, 80%, 100% { opacity: 1; } 90% { opacity: .2; } }
      .ico i { position: absolute; left: 50%; top: 40%; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: rgba(200,200,210,.55); filter: blur(3px); opacity: 0; }
      .det.fire .ico i { animation: puff 2.2s ease-out infinite; }
      .det.fire .ico i:nth-child(3) { animation-delay: -.7s; } .det.fire .ico i:nth-child(4) { animation-delay: -1.4s; }
      @keyframes puff { 0% { transform: translate(0,0) scale(.5); opacity: .8; } 100% { transform: translate(8px,-26px) scale(2.2); opacity: 0; } }
      .det.fire .ico ha-icon { animation: shake .5s ease-in-out infinite; }
      @keyframes shake { 25% { transform: rotate(-8deg); } 75% { transform: rotate(8deg); } }
      .dt { flex: 1; min-width: 0; cursor: pointer; }
      .dn { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ds { font-size: 11.5px; color: var(--tx2); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .det.fire .ds, .det.siren .ds { color: rgb(var(--d)); font-weight: 700; }

      .bat { position: relative; flex: 0 0 auto; display: flex; align-items: center; gap: 3px; height: 30px; padding: 0 8px 0 5px; border-radius: 10px; background: rgba(255,255,255,.06); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; overflow: hidden; --b: var(--ok); }
      .bat.amber { --b: var(--low); } .bat.red { --b: var(--fire); }
      .bat ha-icon { --mdc-icon-size: 17px; color: rgb(var(--b)); }
      .bat b { position: absolute; left: 0; bottom: 0; height: 2px; width: var(--p); background: rgb(var(--b)); box-shadow: 0 0 6px rgb(var(--b)); }
      .bat.red { background: rgba(var(--fire), .15); }

      .sir { position: relative; flex: 0 0 40px; width: 40px; height: 36px; border-radius: 12px; display: grid; place-items: center; color: var(--tx2); background: rgba(255,255,255,.06); box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); transition: background .3s, color .3s; }
      .sir:disabled { opacity: .35; cursor: default; }
      .sir ha-icon { --mdc-icon-size: 20px; position: relative; z-index: 1; }
      .sir:not(:disabled):not(.on):hover { color: rgb(var(--siren)); background: rgba(var(--siren), .12); }
      .sir.on { color: #fff; background: linear-gradient(180deg, rgb(var(--fire)), rgba(var(--fire), .75)); box-shadow: 0 3px 14px -2px rgba(var(--fire), .8); }
      .sir s { position: absolute; inset: 0; border-radius: 12px; border: 2px solid rgba(var(--fire), .8); opacity: 0; }
      .sir.on s { animation: ring 1s ease-out infinite; } .sir.on s + s { animation-delay: .5s; }
      .sir.on ha-icon { animation: shake .35s ease-in-out infinite; }

      .sheet { position: absolute; inset: 0; z-index: 5; display: grid; place-items: center; padding: 14px; background: rgba(4,8,12,.6); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); opacity: 0; pointer-events: none; transition: opacity .2s; }
      ha-card.confirm .sheet { opacity: 1; pointer-events: auto; }
      .sheet-in { width: 100%; max-width: 320px; box-sizing: border-box; padding: 16px; border-radius: 18px; text-align: center; background: rgba(22,30,40,.98); box-shadow: 0 10px 40px rgba(0,0,0,.6), inset 0 0 0 1px rgba(var(--siren), .35); transform: scale(.95); transition: transform .2s; }
      ha-card.confirm .sheet-in { transform: none; }
      .warn { width: 46px; height: 46px; margin: 0 auto 8px; border-radius: 50%; display: grid; place-items: center; color: rgb(var(--siren)); background: rgba(var(--siren), .15); }
      .warn ha-icon { --mdc-icon-size: 24px; }
      .q { font-size: 15px; font-weight: 700; }
      .qs { font-size: 12px; color: var(--tx2); margin: 4px 0 12px; }
      .btns { display: flex; gap: 8px; }
      .btns button { flex: 1; height: 38px; border-radius: 12px; font-weight: 700; font-size: 13px; }
      .cancel { background: rgba(255,255,255,.08); }
      .go { color: #fff; background: linear-gradient(180deg, rgb(var(--siren)), rgba(var(--siren), .75)); }

      @container (min-width: 560px) {
        .list { grid-template-columns: 1fr 1fr; }
      }
      @container (max-width: 300px) {
        .wrap { padding: 10px; }
        .stopall span { display: none; }
        .stopall { padding: 0 9px; }
        .bat b { display: none; }
        .bat { padding: 0 6px 0 3px; }
        .ico { flex-basis: 34px; width: 34px; height: 34px; }
      }
      @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }`;
    }
  }

  class HolmSmokeCardEditor extends HTMLElement {
    setConfig(config) {
      this._config = config || {};
      if (this._form && !this._self) this._form.data = this._data();
    }
    set hass(hass) {
      this._hass = hass;
      this._render();
    }
    connectedCallback() {
      this._render();
    }
    _data() {
      const c = this._config;
      return { ...c, detector_entities: (c.detectors || []).map((d) => (typeof d === "string" ? d : d.entity)) };
    }
    _render() {
      if (!this._hass || !this._config) return;
      if (!this._form) {
        const f = document.createElement("ha-form");
        f.schema = [
          { name: "title", selector: { text: {} } },
          { name: "detector_entities", selector: { entity: { multiple: true, domain: ["siren", "switch"] } } },
          { name: "low_battery", selector: { number: { min: 5, max: 60, step: 5, unit_of_measurement: "%", mode: "slider" } } },
        ];
        const L = { title: "Titre", detector_entities: "Sirènes des détecteurs (les capteurs sont trouvés automatiquement)", low_battery: "Seuil pile faible" };
        f.computeLabel = (s) => L[s.name] || s.name;
        f.addEventListener("value-changed", (ev) => {
          ev.stopPropagation();
          const v = { ...ev.detail.value };
          const old = this._config.detectors || [];
          v.detectors = (v.detector_entities || []).map((e) => old.find((d) => (typeof d === "string" ? d : d.entity) === e) || { entity: e });
          delete v.detector_entities;
          this._config = v;
          this._self = true;
          this.dispatchEvent(new CustomEvent("config-changed", { detail: { config: v }, bubbles: true, composed: true }));
          setTimeout(() => (this._self = false), 0);
        });
        this._form = f;
        this.appendChild(f);
      }
      this._form.hass = this._hass;
      this._form.data = this._data();
    }
  }

  if (!customElements.get("holm-smoke-card")) customElements.define("holm-smoke-card", HolmSmokeCard);
  if (!customElements.get("holm-smoke-card-editor")) customElements.define("holm-smoke-card-editor", HolmSmokeCardEditor);
  window.customCards = window.customCards || [];
  if (!window.customCards.some((c) => c.type === "holm-smoke-card")) {
    window.customCards.push({ type: "holm-smoke-card", name: "HOLM Détecteurs de fumée", description: "État des détecteurs de fumée, piles et commande des sirènes.", preview: true });
  }
})();

console.info("%c HOLM-SMOKE %c 1.0.0 ", "background:#ef4444;color:#111;border-radius:3px 0 0 3px", "background:#123;color:#fff;border-radius:0 3px 3px 0");
