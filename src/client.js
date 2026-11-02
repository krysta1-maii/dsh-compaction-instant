/**
 * Browser half of dsh-compaction-instant: the bundle's two configuration
 * sections on the 0.2.0 Plugins page (`plugins.bundle.config`, keyed by the
 * package name).
 *
 * - The engine fields bind to the `compaction-instant` settings form served by
 *   the bundle's settings bridge row (src/settings.js).
 * - The recall-companion section binds to the `compaction-instant-preset-tools`
 *   form served by the preset controller row (src/preset-tools.js). It lists
 *   the live preset roster through the optional `remote.agentPresets` namespace
 *   and persists the enabled set; the Host controller owns the actual
 *   registration on each Agent scope, so nothing here touches an Agent.
 *
 * DSH 0.2.0 serves volatile profile-entry configs as settings forms; edits go
 * through the client `configForms` service and persist into the profile
 * patch, applying live. Each section appears only while the Host serves its
 * own namespace, and the two namespaces keep independent drafts, saves, and
 * errors: a deployment without the preset-tools row hides that area only.
 *
 * This file is served verbatim by the deployment's client-modules bundle
 * route, so it must be a self-contained lazy-CJS factory in the
 * `window.__ModuleLoader__.load` format. Register only the real package owner:
 * invalidation removes that owner, not unrelated alias registrations. The
 * legacy compaction-basic alias is not a supported direct browser load path.
 * The Plugins page also keys bundle configuration sections by the real package
 * name.
 *
 * No TypeScript/JSX/bundler transforms run on this file.
 */
function makeInstantCompactionClientFactory(bundlePackage) {
  return function instantCompactionClientFactory(require) {
  var module = { exports: {} };
  var exports = module.exports;
  Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

  var React = require("react");
  var { createSnapshotStore } = require("@deepseek-ai/dsh-client-store");

  // ── styles (injected once per page, matching the official cards' tokens) ──
  var css = [
    ".dsci_page{flex-direction:column;display:flex}",
    ".dsci_name{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}",
    ".dsci_description{color:var(--dsw-alias-label-tertiary);margin:4px 0 0;font-size:13px;line-height:1.5}",
    ".dsci_readOnly{color:var(--dsw-alias-label-tertiary);margin:12px 0 0;font-size:12px;line-height:1.5}",
    ".dsci_footer{border-top:1px solid var(--dsw-alias-border-l2);justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;display:flex}",
    ".dsci_failed{min-width:0;color:var(--dsw-alias-label-error);flex:1;margin:0;font-size:12px;line-height:1.5}",
    ".dsci_discard,.dsci_save{appearance:none;font:inherit;cursor:pointer;border:1px solid transparent;border-radius:8px;padding:5px 14px;font-size:13px;line-height:1.5}",
    ".dsci_discard{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);background:0 0}",
    ".dsci_discard:hover:not(:disabled){color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-dimmed)}",
    ".dsci_save{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3)}",
    ".dsci_discard:disabled,.dsci_save:disabled{opacity:.4;cursor:default}",
    ".dsci_discard:focus-visible,.dsci_save:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}",
    ".dsci_field{flex-direction:column;gap:6px;padding:12px 0;display:flex}",
    ".dsci_field+.dsci_field{border-top:1px solid var(--dsw-alias-border-l2)}",
    ".dsci_head{align-items:center;gap:8px;display:flex}",
    ".dsci_label{min-width:0;color:var(--dsw-alias-label-primary);flex:1;font-size:13px;font-weight:500;line-height:1.5}",
    ".dsci_badges{align-items:center;gap:8px;display:inline-flex}",
    ".dsci_badge{white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}",
    ".dsci_reset{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;padding:0;font-size:12px;line-height:1.5}",
    ".dsci_reset:hover:not(:disabled){color:var(--dsw-alias-label-primary)}",
    ".dsci_reset:disabled{cursor:default}",
    ".dsci_input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);height:34px;font:inherit;color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 12px;font-size:13px;line-height:1.5;width:100%;box-sizing:border-box}",
    ".dsci_input:focus-visible{border-color:var(--dsw-alias-brand-primary);outline:none}",
    ".dsci_input:disabled{color:var(--dsw-alias-label-tertiary);cursor:default}",
    ".dsci_inputInvalid{border-color:var(--dsw-alias-label-error)}",
    ".dsci_invalid{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}",
    ".dsci_hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:1.5}",
    ".dsci_toggleRow{align-items:center;gap:10px;display:flex}",
    ".dsci_toggle{accent-color:var(--dsw-alias-brand-primary);width:16px;height:16px;cursor:pointer;margin:2px 0 0;flex:none}",
    ".dsci_toggle:disabled{cursor:default}",
    ".dsci_section{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;margin-top:18px;padding-top:14px;display:flex}",
    ".dsci_presets{flex-direction:column;display:flex;padding:8px 0 0}",
    ".dsci_preset{align-items:flex-start;gap:10px;display:flex;padding:6px 0}",
    ".dsci_presetBody{cursor:pointer;min-width:0;flex-direction:column;gap:2px;display:flex;flex:1}",
    ".dsci_presetName{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:500;line-height:1.5;overflow-wrap:anywhere}",
    ".dsci_presetId{color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.5;overflow-wrap:anywhere}",
    ".dsci_presetMeta{align-items:center;gap:8px;display:inline-flex;flex-wrap:wrap;margin-top:2px}",
    ".dsci_presetBroken{color:var(--dsw-alias-label-error);font-size:11px;line-height:1.5}",
    ".dsci_presetMissing{color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}",
    ".dsci_presetFooter{margin-top:10px}"
  ].join("");
  var tagId = "dsh-compaction-instant/settings.css";
  if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
    var tag = document.createElement("style");
    tag.dataset.plugin = "dsh-compaction-instant";
    tag.dataset.pluginCss = tagId;
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  // ── locale ────────────────────────────────────────────────────────────────
  var NS = "compaction-instant";
  var zh = {
    title: "即时压缩",
    description: "VCC 式即时压缩引擎（dsh-compaction-instant）的参数。",
    checkpointCap: "检查点预算上限",
    checkpointCapHint: "一次检查点的编译预算上限（默认 65536）。",
    auto: "自动压缩",
    autoHint: "步骤间按上下文压力自动压缩；关闭后仅手动 /compact。",
    thresholdRatio: "自动压缩比例",
    thresholdRatioHint: "上下文窗口占用达到此比例时触发自动压缩（默认 0.5）。",
    retainTurns: "保留回合数",
    retainTurnsHint: "优先保留最近 N 个完整回合（默认 1）。",
    retainRatio: "保留上下文比例",
    retainRatioHint: "兼容 compaction-basic：按模型上下文窗口比例计算保留上限。",
    retainTokens: "保留 token 上限",
    retainTokensHint: "保留区 token 硬上限：补足回合时永不超出；若最近回合本身就超过它，只保留其中能装下的部分（默认 5120）。",
    overridden: "已覆盖",
    reset: "重置",
    invalidNumber: "必须是数字",
    save: "保存",
    saving: "保存中…",
    saveFailed: "保存失败",
    discard: "放弃",
    readOnly: "当前连接为只读，无法修改配置。",
    presetsTitle: "历史恢复工具",
    presetsDescription: "为所选预设的 Agent 注册 recall、search 两个模型工具与 /recall 命令。默认不向任何预设注册。",
    presetsHint: "保存只记录目标预设，由 Host 按各 Agent 实际使用的预设即时注册或注销；已开始的调用不会中断。",
    presetsDefault: "默认",
    presetsBroken: "不可用",
    presetsMissing: "当前不可用",
    presetsEmpty: "当前没有可选的预设。",
    presetsLoading: "正在读取预设列表…",
    presetsReadFailed: "预设列表读取失败",
    presetsUnavailable: "当前连接无法读取预设列表；已保存的选择仍可取消。",
    presetsRefresh: "刷新列表",
    presetsRefreshing: "刷新中…",
    presetsResetAll: "重置",
    presetsSaveFailed: "保存失败"
  };
  var en = {
    title: "Instant Compaction",
    description: "VCC-style instant compaction engine (dsh-compaction-instant) tuning.",
    checkpointCap: "Checkpoint cap",
    checkpointCapHint: "Total compiler-token budget for one checkpoint (default 65536).",
    auto: "Automatic compaction",
    autoHint: "Compress automatically between steps by pressure; off means manual /compact only.",
    thresholdRatio: "Auto-compaction ratio",
    thresholdRatioHint: "Triggers automatic compaction at this fraction of the context window (default 0.5).",
    retainTurns: "Retained turns",
    retainTurnsHint: "Prefer the last N complete turns (default 1).",
    retainRatio: "Retained context ratio",
    retainRatioHint: "compaction-basic compatibility: derive the retained ceiling from the model context window.",
    retainTokens: "Retained-token ceiling",
    retainTokensHint: "Hard ceiling for the retained region: turn extension never exceeds it, and if the latest turn alone is bigger, only the part of it that fits is kept (default 5120).",
    overridden: "Overridden",
    reset: "Reset",
    invalidNumber: "Must be a number",
    save: "Save",
    saving: "Saving…",
    saveFailed: "Save failed",
    discard: "Discard",
    readOnly: "This connection is read-only.",
    presetsTitle: "History recall tools",
    presetsDescription: "Registers the recall and search model tools plus the /recall command for Agents on the selected presets. Nothing is registered until a preset is selected here.",
    presetsHint: "Saving records the target presets; the Host registers or releases each Agent as it runs. Calls that already started are never interrupted.",
    presetsDefault: "Default",
    presetsBroken: "Unavailable",
    presetsMissing: "Currently unavailable",
    presetsEmpty: "No presets are available right now.",
    presetsLoading: "Reading the preset list…",
    presetsReadFailed: "Could not read the preset list",
    presetsUnavailable: "This connection cannot read the preset list; saved selections can still be removed.",
    presetsRefresh: "Refresh list",
    presetsRefreshing: "Refreshing…",
    presetsResetAll: "Reset",
    presetsSaveFailed: "Save failed"
  };

  // ── field specs ───────────────────────────────────────────────────────────
  /** A whole-number field; empty draft clears, non-numeric drafts block save. */
  function numberField(field) {
    return {
      field,
      format: (value) => typeof value === "number" ? String(value) : "",
      parse: (text) => {
        var trimmed = text.trim();
        if (trimmed === "") return { kind: "clear" };
        var parsed = Number(trimmed);
        return Number.isFinite(parsed) ? { kind: "set", value: parsed } : void 0;
      }
    };
  }
  /** A boolean field staged through the toggle's "true"/"false" text. */
  function booleanField(field) {
    return {
      field,
      format: (value) => value === true ? "true" : "false",
      parse: (text) => ({ kind: "set", value: text === "true" })
    };
  }

  // ── form model (official-card semantics: staged edits, one save, read-back) ──
  /**
   * Stages one card's edits over the compaction-instant settings namespace and
   * writes them on save. Mirrors the official plugin-card form contract:
   * dirty/invalid/saving/failed shell state, per-field draft text, and a save
   * that plans one write per staged field then re-reads from the Host.
   */
  var CardController = /** @class */ (function () {
    function CardController(scope, specs) {
      this.scope = scope;
      this.specs = new Map(specs.map(function (spec) { return [spec.field, spec]; }));
      this.staged = new Map();
      this.listeners = new Set();
      this.saving = false;
      this.failed = false;
      this.unsubscribe = scope.subscribe(this.publish.bind(this));
    }
    /** Release the form subscription when the client fiber unloads. */
    CardController.prototype.dispose = function () {
      this.unsubscribe();
      this.listeners.clear();
    };
    /** Build the snapshot store the slot's `useCompactionCard` selector reads. */
    CardController.prototype.bind = function (project) {
      var store = createSnapshotStore(project());
      this.listeners.add(function () { store.set(project()); });
      return store;
    };
    CardController.prototype.publish = function () {
      for (var _i = 0, _a = Array.from(this.listeners); _i < _a.length; _i++) {
        var listener = _a[_i];
        try { listener(); } catch (_) { /* a failing projection must not kill the form */ }
      }
    };
    CardController.prototype.shell = function () {
      var snapshot = this.scope.getSnapshot();
      var plan = this.plan();
      return {
        available: snapshot.status === "ready",
        writable: snapshot.writable,
        dirty: plan.length > 0,
        invalid: plan.some(function (item) { return item.op === void 0; }),
        saving: this.saving,
        failed: this.failed
      };
    };
    CardController.prototype.field = function (field) {
      var staged = this.staged.get(field);
      var spec = this.specs.get(field);
      if (staged === void 0) {
        return {
          text: spec.format(this.sectionValue(field)),
          overridden: this.stored(field),
          invalid: false
        };
      }
      var write = staged.clear ? { kind: "clear" } : spec.parse(staged.text);
      return {
        text: staged.text,
        overridden: write != null && write.kind === "set",
        invalid: write === void 0
      };
    };
    CardController.prototype.actions = function () {
      var self = this;
      return {
        edit: function (field, text) {
          self.stage(field, { text: text, clear: false });
        },
        resetField: function (field) {
          self.stage(field, { text: self.specs.get(field).format(self.baseValue(field)), clear: true });
        },
        save: function () { self.save(); },
        discard: function () {
          if (self.staged.size === 0 && !self.failed) return;
          self.staged.clear();
          self.failed = false;
          self.publish();
        }
      };
    };
    /** Every staged edit a save would write, in staging order. */
    CardController.prototype.plan = function () {
      var plan = [];
      var entries = Array.from(this.staged.entries());
      for (var _i = 0; _i < entries.length; _i++) {
        var entry = entries[_i];
        var field = entry[0];
        var staged = entry[1];
        var spec = this.specs.get(field);
        if (staged.clear) {
          if (this.stored(field)) plan.push({ field: field, op: { op: "unset", path: [field] } });
          continue;
        }
        if (staged.text === spec.format(this.sectionValue(field))) continue;
        var write = spec.parse(staged.text);
        if (write === void 0) plan.push({ field: field, op: void 0 });
        else if (write.kind === "clear") plan.push({ field: field, op: { op: "unset", path: [field] } });
        else plan.push({ field: field, op: { op: "set", path: [field], value: write.value } });
      }
      return plan;
    };
    CardController.prototype.stage = function (field, edit) {
      this.staged.set(field, edit);
      this.failed = false;
      this.publish();
    };
    CardController.prototype.sectionValue = function (field) {
      var value = this.scope.getSnapshot().value;
      return value == null ? void 0 : value[field];
    };
    CardController.prototype.baseValue = function (field) {
      var base = this.scope.getSnapshot().base;
      return base == null ? void 0 : base[field];
    };
    CardController.prototype.userLayer = function () {
      return this.scope.getSnapshot().user;
    };
    CardController.prototype.stored = function (field) {
      var user = this.userLayer();
      return user !== void 0 && Object.prototype.hasOwnProperty.call(user, field);
    };
    /** Write every staged edit atomically, then re-read what the Host accepted. */
    CardController.prototype.save = function () {
      var self = this;
      var plan = this.plan();
      var operations = plan.map(function (item) { return item.op; });
      if (plan.length === 0 || this.saving || operations.some(function (op) { return op === void 0; })) return;
      // Each edit replaces its entry object: identity acts as a staged revision.
      var submitted = new Map(this.staged);
      this.saving = true;
      this.failed = false;
      this.publish();
      var expectedRevision = this.scope.getSnapshot().revision;
      this.scope.mutate(operations, expectedRevision).then(function (accepted) {
        // 0.1.7's form controller resolves false for a refused or superseded
        // write after reloading Host state; an accepted write is already
        // folded into the mirror, and the user-layer re-read below confirms
        // the section landed the way the plan intended.
        var user = self.userLayer();
        var landed = accepted === true && plan.every(function (item) {
          if (item.op.op === "unset") return user === void 0 || !Object.prototype.hasOwnProperty.call(user, item.field);
          return user !== void 0 && user[item.field] === item.op.value;
        });
        if (landed) {
          submitted.forEach(function (edit, field) {
            if (self.staged.get(field) === edit) self.staged.delete(field);
          });
        }
        self.saving = false;
        self.failed = !landed;
        self.publish();
      }, function () {
        self.saving = false;
        self.failed = true;
        self.publish();
      });
    };
    return CardController;
  })();

  // ── preset-companion form model ───────────────────────────────────────────
  /** Settings namespace of the Host preset controller (src/preset-tools.js). */
  var PRESET_SETTINGS_NAMESPACE = "compaction-instant-preset-tools";

  /** Sorted, deduplicated string ids of a section value. */
  function readIds(value) {
    if (!Array.isArray(value)) return [];
    var ids = [];
    for (var index = 0; index < value.length; index += 1) {
      var entry = value[index];
      if (typeof entry === "string" && entry !== "" && ids.indexOf(entry) < 0) ids.push(entry);
    }
    return ids.sort();
  }

  /** Whether two id collections hold exactly the same ids. */
  function sameIds(left, right) {
    var a = readIds(left);
    var b = readIds(right);
    if (a.length !== b.length) return false;
    for (var index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
    return true;
  }

  /** Whether a stored user layer carries the field. */
  function hasField(layer, field) {
    return layer !== null && typeof layer === "object" && Object.prototype.hasOwnProperty.call(layer, field);
  }

  /** Human-readable text for a Remote failure or a transport error. */
  function failureText(value) {
    if (value === null || value === void 0) return "";
    if (typeof value === "string") return value;
    var failure = typeof value === "object" && value.error !== void 0 ? value.error : value;
    if (failure !== null && typeof failure === "object" && typeof failure.message === "string") return failure.message;
    if (typeof failure === "string") return failure;
    return "";
  }

  /**
   * The optional preset roster namespace. A deployment without the Remote
   * assembly still shows saved selections but hides the roster; the engine
   * form never depends on it.
   */
  function rosterSource(ctx) {
    var remote;
    try {
      remote = typeof ctx.get === "function" ? ctx.get("remote") : void 0;
    } catch (_) {
      return void 0;
    }
    if (remote === null || typeof remote !== "object") return void 0;
    var agentPresets = remote.agentPresets;
    if (agentPresets === null || typeof agentPresets !== "object" || typeof agentPresets.list !== "function") return void 0;
    return agentPresets;
  }

  /**
   * Stages the enabled-preset selection over the preset-tools settings
   * namespace. Independent from the engine card: its own draft, save, discard,
   * reset, roster read, and error state. The Host controller is what actually
   * registers or releases the companions; this class only writes the target
   * list and shows what the Host serves.
   */
  var PresetToolsController = /** @class */ (function () {
    function PresetToolsController(ctx, scope) {
      this.ctx = ctx;
      this.scope = scope;
      /** Explicit working selection; null means "follow the saved value". */
      this.draft = null;
      this.listeners = new Set();
      this.saving = false;
      this.failed = false;
      this.refreshing = false;
      this.mounted = false;
      this.roster = { status: "idle", presets: [], error: null, loaded: false };
      this.unsubscribe = scope.subscribe(this.publish.bind(this));
    }
    /** Release the form subscription when the client fiber unloads. */
    PresetToolsController.prototype.dispose = function () {
      this.unsubscribe();
      this.listeners.clear();
    };
    /** Build the snapshot store the slot's `usePresetTools` selector reads. */
    PresetToolsController.prototype.bind = function (project) {
      var store = createSnapshotStore(project());
      this.listeners.add(function () { store.set(project()); });
      return store;
    };
    PresetToolsController.prototype.publish = function () {
      var listeners = Array.from(this.listeners);
      for (var index = 0; index < listeners.length; index += 1) {
        try { listeners[index](); } catch (_) { /* a failing projection must not kill the form */ }
      }
    };
    PresetToolsController.prototype.snapshot = function () {
      return this.scope.getSnapshot();
    };
    /** Enabled ids as the Host currently serves them. */
    PresetToolsController.prototype.saved = function () {
      var value = this.snapshot().value;
      return readIds(value === null || value === void 0 ? void 0 : value.presets);
    };
    /** Whether the user layer stores the field, so a reset has something to unset. */
    PresetToolsController.prototype.stored = function () {
      return hasField(this.snapshot().user, "presets");
    };
    /** The selection the checkboxes show. */
    PresetToolsController.prototype.selection = function () {
      return this.draft === null ? this.saved() : this.draft;
    };
    /** Whether this connection may stage and write the enabled list. */
    PresetToolsController.prototype.writable = function () {
      var snapshot = this.snapshot();
      return snapshot.status === "ready" && snapshot.writable === true;
    };
    PresetToolsController.prototype.shell = function () {
      var snapshot = this.snapshot();
      var available = snapshot.status === "ready";
      return {
        available: available,
        writable: this.writable(),
        dirty: this.draft !== null && !sameIds(this.draft, this.saved()),
        saving: this.saving,
        failed: this.failed,
        refreshing: this.refreshing,
        resettable: this.draft !== null || this.stored() || this.saved().length > 0,
        rosterStatus: this.roster.status,
        rosterError: this.roster.error,
        rosterLoaded: this.roster.loaded
      };
    };
    /**
     * Roster rows plus saved ids the roster no longer declares. A failed read
     * keeps the last successful roster and never turns "unknown" into "gone":
     * absent ids are labelled unavailable only after one successful read.
     */
    PresetToolsController.prototype.rows = function () {
      var saved = this.saved();
      var selection = new Set(this.selection());
      var seen = new Set();
      var rows = [];
      var roster = this.roster.presets;
      for (var index = 0; index < roster.length; index += 1) {
        var entry = roster[index];
        if (entry === null || typeof entry !== "object" || typeof entry.id !== "string" || entry.id === "") continue;
        if (seen.has(entry.id)) continue;
        seen.add(entry.id);
        var broken = typeof entry.broken === "string" && entry.broken.length > 0 ? entry.broken : void 0;
        var checked = selection.has(entry.id);
        rows.push({
          id: entry.id,
          name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : void 0,
          isDefault: entry.isDefault === true,
          broken: broken,
          missing: false,
          checked: checked,
          locked: broken !== void 0 && !checked
        });
      }
      var known = saved.concat(this.draft === null ? [] : this.draft);
      var extras = [];
      for (var knownIndex = 0; knownIndex < known.length; knownIndex += 1) {
        var id = known[knownIndex];
        if (typeof id !== "string" || id === "" || seen.has(id)) continue;
        seen.add(id);
        extras.push(id);
      }
      extras.sort();
      for (var extraIndex = 0; extraIndex < extras.length; extraIndex += 1) {
        rows.push({
          id: extras[extraIndex],
          name: void 0,
          isDefault: false,
          broken: void 0,
          missing: this.roster.loaded,
          checked: selection.has(extras[extraIndex]),
          locked: false
        });
      }
      return rows;
    };
    /** Change one draft entry; a draft equal to the served value disappears. */
    PresetToolsController.prototype.toggle = function (id, checked) {
      if (typeof id !== "string" || id === "" || !this.writable()) return;
      var selection = new Set(this.selection());
      if (checked === true) selection.add(id);
      else selection.delete(id);
      var next = Array.from(selection).sort();
      this.draft = sameIds(next, this.saved()) ? null : next;
      this.failed = false;
      this.publish();
    };
    PresetToolsController.prototype.actions = function () {
      var self = this;
      return {
        togglePreset: function (id, checked) { self.toggle(id, checked); },
        savePresets: function () { self.save(); },
        discardPresets: function () { self.discard(); },
        resetPresets: function () { self.reset(); },
        refreshPresets: function () { self.refresh(); }
      };
    };
    /** Read the roster once when the page first mounts, outside any render. */
    PresetToolsController.prototype.mount = function () {
      if (this.mounted) return;
      this.mounted = true;
      if (this.roster.status !== "idle" && this.roster.status !== "unavailable") return;
      var self = this;
      Promise.resolve().then(function () { self.refresh(); });
    };
    PresetToolsController.prototype.discard = function () {
      if (this.draft === null && !this.failed) return;
      this.draft = null;
      this.failed = false;
      this.publish();
    };
    /** Persist the sorted draft as one presets array, then re-read acceptance. */
    PresetToolsController.prototype.save = function () {
      var self = this;
      if (this.saving || this.draft === null || !this.writable()) return;
      var plan = this.draft.slice().sort();
      if (sameIds(plan, this.saved())) return;
      var submitted = this.draft;
      this.saving = true;
      this.failed = false;
      this.publish();
      var expected = this.snapshot().revision;
      this.scope.mutate([{ op: "set", path: ["presets"], value: plan }], expected).then(function (accepted) {
        var user = self.snapshot().user;
        var landed = accepted === true && hasField(user, "presets") && sameIds(user.presets, plan);
        if (landed && self.draft === submitted) self.draft = null;
        self.saving = false;
        self.failed = !landed;
        self.publish();
      }, function () {
        self.saving = false;
        self.failed = true;
        self.publish();
      });
    };
    /** Restore the schema default by clearing the stored field. */
    PresetToolsController.prototype.reset = function () {
      var self = this;
      if (this.saving || !this.writable()) return;
      if (!this.stored()) {
        if (this.draft === null) return;
        this.draft = null;
        this.failed = false;
        this.publish();
        return;
      }
      this.saving = true;
      this.failed = false;
      this.publish();
      var expected = this.snapshot().revision;
      this.scope.mutate([{ op: "unset", path: ["presets"] }], expected).then(function (accepted) {
        var landed = accepted === true && !hasField(self.snapshot().user, "presets");
        if (landed) self.draft = null;
        self.saving = false;
        self.failed = !landed;
        self.publish();
      }, function () {
        self.saving = false;
        self.failed = true;
        self.publish();
      });
    };
    /** Read the roster on demand; never on a timer, never as a config cleanup. */
    PresetToolsController.prototype.refresh = function () {
      var self = this;
      if (this.refreshing) return;
      var source = rosterSource(this.ctx);
      if (source === void 0) {
        this.roster = { status: "unavailable", presets: this.roster.presets, error: null, loaded: this.roster.loaded };
        this.publish();
        return;
      }
      this.refreshing = true;
      this.roster = { status: "loading", presets: this.roster.presets, error: null, loaded: this.roster.loaded };
      this.publish();
      var pending;
      try {
        pending = Promise.resolve(source.list());
      } catch (error) {
        pending = Promise.reject(error);
      }
      pending.then(function (result) {
        self.refreshing = false;
        if (result !== null && typeof result === "object" && result.ok === true) {
          var value = result.value;
          var presets = value !== null && typeof value === "object" && Array.isArray(value.presets) ? value.presets : [];
          self.roster = { status: "ready", presets: presets, error: null, loaded: true };
        } else {
          self.roster = { status: "error", presets: self.roster.presets, error: failureText(result), loaded: self.roster.loaded };
        }
        self.publish();
      }, function (error) {
        self.refreshing = false;
        self.roster = { status: "error", presets: self.roster.presets, error: failureText(error), loaded: self.roster.loaded };
        self.publish();
      });
    };
    return PresetToolsController;
  })();

  // ── components ────────────────────────────────────────────────────────────
  function ValueField(props) {
    return React.createElement(
      "div",
      { className: "dsci_field" },
      React.createElement(
        "div",
        { className: "dsci_head" },
        React.createElement("label", { className: "dsci_label", htmlFor: props.id }, props.label),
        props.overridden
          ? React.createElement(
              "span",
              { className: "dsci_badges" },
              React.createElement("span", { className: "dsci_badge" }, props.overriddenLabel),
              React.createElement("button", {
                type: "button",
                className: "dsci_reset",
                disabled: props.disabled,
                onClick: props.onReset
              }, props.resetLabel)
            )
          : null
      ),
      React.createElement("input", {
        id: props.id,
        className: props.invalid ? "dsci_input dsci_inputInvalid" : "dsci_input",
        type: "text",
        inputMode: props.numeric === true ? "numeric" : void 0,
        "aria-invalid": props.invalid ? true : void 0,
        value: props.text,
        placeholder: props.placeholder ?? "",
        disabled: props.disabled,
        onChange: function (event) { props.onEdit(event.target.value); }
      }),
      React.createElement("p", { className: props.invalid ? "dsci_invalid" : "dsci_hint" }, props.invalid ? props.invalidLabel : props.hint)
    );
  }

  function ToggleField(props) {
    return React.createElement(
      "div",
      { className: "dsci_field" },
      React.createElement(
        "div",
        { className: "dsci_head" },
        React.createElement("label", { className: "dsci_label", htmlFor: props.id }, props.label),
        props.overridden
          ? React.createElement(
              "span",
              { className: "dsci_badges" },
              React.createElement("span", { className: "dsci_badge" }, props.overriddenLabel),
              React.createElement("button", {
                type: "button",
                className: "dsci_reset",
                disabled: props.disabled,
                onClick: props.onReset
              }, props.resetLabel)
            )
          : null
      ),
      React.createElement(
        "div",
        { className: "dsci_toggleRow" },
        React.createElement("input", {
          id: props.id,
          className: "dsci_toggle",
          type: "checkbox",
          checked: props.checked,
          disabled: props.disabled,
          onChange: function (event) { props.onToggle(event.target.checked); }
        })
      ),
      React.createElement("p", { className: "dsci_hint" }, props.hint)
    );
  }

  /**
   * One preset row: a native checkbox plus its associated label, with the
   * default marker, a broken reason, or the "currently unavailable" note.
   */
  function PresetRow(props) {
    var row = props.row;
    var label = row.name === void 0 ? row.id : row.name;
    return React.createElement(
      "div",
      { className: "dsci_preset", "data-preset-id": row.id },
      React.createElement("input", {
        id: props.id,
        className: "dsci_toggle",
        type: "checkbox",
        checked: row.checked === true,
        disabled: props.disabled,
        "aria-describedby": props.id + "-meta",
        onChange: function (event) { props.onToggle(row.id, event.target.checked); }
      }),
      React.createElement(
        "label",
        { className: "dsci_presetBody", htmlFor: props.id },
        React.createElement("span", { className: "dsci_presetName" }, label),
        row.name === void 0 ? null : React.createElement("span", { className: "dsci_presetId" }, row.id),
        React.createElement(
          "span",
          { className: "dsci_presetMeta", id: props.id + "-meta" },
          row.isDefault ? React.createElement("span", { className: "dsci_badge" }, props.defaultLabel) : null,
          row.broken === void 0 ? null : React.createElement("span", { className: "dsci_presetBroken" }, props.brokenLabel + ": " + row.broken),
          row.missing ? React.createElement("span", { className: "dsci_presetMissing" }, props.missingLabel) : null
        )
      )
    );
  }

  /**
   * The preset-scoped recall-companion area: roster checkboxes, refresh, reset,
   * and its own save/discard pair. Renders nothing while the Host serves no
   * preset-tools form.
   */
  function PresetToolsSection(props) {
    var state = props.state;
    var t = props.t;
    if (!state.available) return null;
    var rows = Array.isArray(state.rows) ? state.rows : [];
    var children = [
      React.createElement("span", { className: "dsci_name", key: "title" }, t("presetsTitle")),
      React.createElement("p", { className: "dsci_description", key: "description" }, t("presetsDescription"))
    ];
    if (state.rosterStatus === "loading") {
      children.push(React.createElement("p", { className: "dsci_hint", key: "roster-loading", role: "status" }, t("presetsLoading")));
    }
    if (state.rosterStatus === "error") {
      var detail = typeof state.rosterError === "string" && state.rosterError.length > 0 ? ": " + state.rosterError : "";
      children.push(React.createElement("p", { className: "dsci_failed", key: "roster-error", role: "status" }, t("presetsReadFailed") + detail));
    }
    if (state.rosterStatus === "unavailable") {
      children.push(React.createElement("p", { className: "dsci_hint", key: "roster-unavailable", role: "status" }, t("presetsUnavailable")));
    }
    if (rows.length === 0 && state.rosterStatus === "ready") {
      children.push(React.createElement("p", { className: "dsci_hint", key: "roster-empty" }, t("presetsEmpty")));
    }
    var list = rows.map(function (row, index) {
      return React.createElement(PresetRow, {
        key: row.id,
        id: "plugin-config-preset-" + String(index),
        row: row,
        disabled: !state.writable || row.locked === true,
        defaultLabel: t("presetsDefault"),
        brokenLabel: t("presetsBroken"),
        missingLabel: t("presetsMissing"),
        onToggle: props.togglePreset
      });
    });
    children.push(React.createElement("div", { className: "dsci_presets", key: "list" }, ...list));
    children.push(React.createElement("p", { className: "dsci_hint", key: "hint" }, t("presetsHint")));
    children.push(React.createElement(
      "div",
      { className: "dsci_footer dsci_presetFooter", key: "footer" },
      state.failed ? React.createElement("p", { className: "dsci_failed", role: "status" }, t("presetsSaveFailed")) : null,
      React.createElement("button", {
        type: "button",
        className: "dsci_discard",
        disabled: state.refreshing || state.saving,
        onClick: props.refreshPresets
      }, t(state.refreshing ? "presetsRefreshing" : "presetsRefresh")),
      React.createElement("button", {
        type: "button",
        className: "dsci_discard",
        disabled: !state.writable || !state.resettable || state.saving,
        onClick: props.resetPresets
      }, t("presetsResetAll")),
      React.createElement("button", {
        type: "button",
        className: "dsci_discard",
        disabled: !state.dirty || state.saving,
        onClick: props.discardPresets
      }, t("discard")),
      React.createElement("button", {
        type: "button",
        className: "dsci_save",
        disabled: !state.writable || !state.dirty || state.saving,
        onClick: props.savePresets
      }, t(state.saving ? "saving" : "save"))
    ));
    return React.createElement("div", { className: "dsci_section" }, ...children);
  }

  /**
   * Render the bundle's configuration section on its Plugins detail page.
   * The engine form and the preset-companion form are independent: each shows
   * only while its own Host namespace is served, and a failure in one never
   * hides or blocks the other.
   */
  function CompactionConfigPage(props) {
    var state = props.useCompactionCard(function (snapshot) { return snapshot; });
    var tools = typeof props.usePresetTools === "function" ? props.usePresetTools(function (snapshot) { return snapshot; }) : void 0;
    var t = props.t;
    if (props.view === "summary") return t("description");
    var engineVisible = state !== null && state !== void 0 && state.available === true;
    var toolsVisible = tools !== null && tools !== void 0 && tools.available === true;
    if (!engineVisible && !toolsVisible) return null;
    var readOnly = (engineVisible && !state.writable) || (toolsVisible && !tools.writable);
    var blocked = !state.dirty || state.invalid || state.saving;
    var ratioMode = state.retainRatio.text !== "" && state.retainTokens.text === "";
    var children = [
      React.createElement("span", { className: "dsci_name", key: "title" }, t("title")),
      React.createElement("p", { className: "dsci_description", key: "description" }, t("description")),
      readOnly ? React.createElement("p", { className: "dsci_readOnly", key: "readOnly", role: "status" }, t("readOnly")) : null
    ];
    if (engineVisible) {
      children.push(
        React.createElement(ValueField, {
          key: "checkpointCap",
          id: "plugin-config-instant-cap",
          label: t("checkpointCap"),
          hint: t("checkpointCapHint"),
          overriddenLabel: t("overridden"),
          resetLabel: t("reset"),
          invalidLabel: t("invalidNumber"),
          numeric: true,
          disabled: !state.writable,
          ...state.checkpointCap,
          onEdit: function (text) { props.edit("checkpointCap", text); },
          onReset: function () { props.resetField("checkpointCap"); }
        }),
        React.createElement(ToggleField, {
          key: "auto",
          id: "plugin-config-instant-auto",
          label: t("auto"),
          hint: t("autoHint"),
          overriddenLabel: t("overridden"),
          resetLabel: t("reset"),
          checked: state.auto.text === "true",
          overridden: state.auto.overridden,
          disabled: !state.writable,
          onToggle: function (checked) { props.edit("auto", checked ? "true" : "false"); },
          onReset: function () { props.resetField("auto"); }
        }),
        React.createElement(ValueField, {
          key: "thresholdRatio",
          id: "plugin-config-instant-threshold",
          label: t("thresholdRatio"),
          hint: t("thresholdRatioHint"),
          overriddenLabel: t("overridden"),
          resetLabel: t("reset"),
          invalidLabel: t("invalidNumber"),
          numeric: true,
          disabled: !state.writable,
          ...state.thresholdRatio,
          onEdit: function (text) { props.edit("thresholdRatio", text); },
          onReset: function () { props.resetField("thresholdRatio"); }
        }),
        React.createElement(ValueField, {
          key: "retainTurns",
          id: "plugin-config-instant-retain-turns",
          label: t("retainTurns"),
          hint: t("retainTurnsHint"),
          overriddenLabel: t("overridden"),
          resetLabel: t("reset"),
          invalidLabel: t("invalidNumber"),
          numeric: true,
          disabled: !state.writable,
          ...state.retainTurns,
          onEdit: function (text) { props.edit("retainTurns", text); },
          onReset: function () { props.resetField("retainTurns"); }
        }),
        ratioMode
          ? React.createElement(ValueField, {
              key: "retainRatio",
              id: "plugin-config-instant-retain-ratio",
              label: t("retainRatio"),
              hint: t("retainRatioHint"),
              overriddenLabel: t("overridden"),
              resetLabel: t("reset"),
              invalidLabel: t("invalidNumber"),
              numeric: true,
              disabled: !state.writable,
              ...state.retainRatio,
              onEdit: function (text) { props.edit("retainRatio", text); },
              onReset: function () { props.resetField("retainRatio"); }
            })
          : React.createElement(ValueField, {
              key: "retainTokens",
              id: "plugin-config-instant-retain-tokens",
              label: t("retainTokens"),
              hint: t("retainTokensHint"),
              overriddenLabel: t("overridden"),
              resetLabel: t("reset"),
              invalidLabel: t("invalidNumber"),
              numeric: true,
              disabled: !state.writable,
              ...state.retainTokens,
              onEdit: function (text) { props.edit("retainTokens", text); },
              onReset: function () { props.resetField("retainTokens"); }
            }),
        React.createElement(
          "div",
          { className: "dsci_footer", key: "engine-footer" },
          state.failed ? React.createElement("p", { className: "dsci_failed", role: "status" }, t("saveFailed")) : null,
          React.createElement("button", {
            type: "button",
            className: "dsci_discard",
            disabled: !state.dirty || state.saving,
            onClick: props.discard
          }, t("discard")),
          React.createElement("button", {
            type: "button",
            className: "dsci_save",
            disabled: blocked,
            onClick: props.save
          }, t(state.saving ? "saving" : "save"))
        )
      );
    }
    if (toolsVisible) {
      children.push(React.createElement(PresetToolsSection, {
        key: "presets",
        state: tools,
        t: t,
        togglePreset: props.togglePreset,
        savePresets: props.savePresets,
        discardPresets: props.discardPresets,
        resetPresets: props.resetPresets,
        refreshPresets: props.refreshPresets
      }));
    }
    return React.createElement("div", { className: "dsci_page" }, ...children);
  }

  // ── plugin body ───────────────────────────────────────────────────────────
  /**
   * Settings form namespace of the bundle's bridge row
   * (dsh-compaction-instant/settings, composition row id).
   */
  var SETTINGS_NAMESPACE = "compaction-instant";
  /** Required services (cordis fiber inject). */
  var inject = ["slots", "locale", "configForms"];

  function apply(ctx) {
    ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }); }, "compaction-instant: settings dictionary");
    var controller = new CardController(ctx.configForms.get(SETTINGS_NAMESPACE), [
      numberField("checkpointCap"),
      booleanField("auto"),
      numberField("thresholdRatio"),
      numberField("retainTurns"),
      numberField("retainRatio"),
      numberField("retainTokens")
    ]);
    var presetController = new PresetToolsController(ctx, ctx.configForms.get(PRESET_SETTINGS_NAMESPACE));
    var store = controller.bind(function () {
      var shell = controller.shell();
      return {
        ...shell,
        checkpointCap: controller.field("checkpointCap"),
        auto: controller.field("auto"),
        thresholdRatio: controller.field("thresholdRatio"),
        retainTurns: controller.field("retainTurns"),
        retainRatio: controller.field("retainRatio"),
        retainTokens: controller.field("retainTokens")
      };
    });
    var presetStore = presetController.bind(function () {
      return {
        ...presetController.shell(),
        rows: presetController.rows()
      };
    });
    ctx.effect(function () { return function () { controller.dispose(); presetController.dispose(); }; }, "compaction-instant: form subscriptions");
    // The Plugins page owns the slot; the bridge and controller rows own the
    // namespaces. Each area appears only once its own namespace is served, so
    // a deployment with either row switched off keeps the other area.
    ctx.effect(function () {
      return ctx.configForms.whileServed([SETTINGS_NAMESPACE, PRESET_SETTINGS_NAMESPACE], function () {
        return ctx.slots.inject("plugins.bundle.config", function () {
          return ctx.slots.register({
            name: "plugins.bundle.config",
            key: bundlePackage,
            locale: NS,
            inject: function () {
              presetController.mount();
              return {
                hooks: { compactionCard: store, presetTools: presetStore },
                ...controller.actions(),
                ...presetController.actions()
              };
            }
          }, CompactionConfigPage);
        });
      });
    }, "compaction-instant: bundle configuration section");
  }

  exports.apply = apply;
  exports.inject = inject;
  return module.exports;
  };
}

window.__ModuleLoader__.load({
  id: "dsh-compaction-instant",
  factory: makeInstantCompactionClientFactory("dsh-compaction-instant")
});
