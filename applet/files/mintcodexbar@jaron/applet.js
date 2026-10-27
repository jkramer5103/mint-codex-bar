const Applet = imports.ui.applet;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Util = imports.misc.util;
const Pango = imports.gi.Pango;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const ByteArray = imports.byteArray;
const PanelModel = require('./panelModel');

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}


class MintCodexBarApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.metadata = metadata;
        this.instance_id = instance_id;
        this.refreshSeconds = 180;
        this._refreshLoopId = null;
        this._isRefreshing = false;
        this._lastData = null;
        this._lastError = null;
        this._configDir = GLib.build_filenamev([GLib.get_user_config_dir(), "mintcodexbar"]);
        GLib.mkdir_with_parents(this._configDir, 448);
        this._loadPrefs();
        // accounts.py saves accounts.json; apply its changes live.
        this._prefsMonitor = Gio.File.new_for_path(this._configDir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._prefsMonitor.connect("changed", Lang.bind(this, function(monitor, file) {
            if (file.get_basename() !== "accounts.json") return;
            this._loadPrefs();
            if (this._lastData) this._renderData(this._lastData);
        }));


        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.set_applet_icon_symbolic_name("utilities-terminal-symbolic");
        this.set_applet_label("--/--");
        this.set_applet_tooltip("Connecting to CLIProxyAPI…");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        this._contentItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            activate: false,
            hover: false,
            sensitive: true,
            focusOnHover: false,
            style_class: "clicpbar-content-item"
        });
        this.menu.addMenuItem(this._contentItem);

        this._content = new St.BoxLayout({
            vertical: true,
            style_class: "clicpbar-shell",
            x_expand: true
        });
        this._contentItem.addActor(this._content, {
            expand: true,
            span: -1,
            align: St.Align.START
        });

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._refreshItem = new PopupMenu.PopupIconMenuItem("Refresh now", "view-refresh-symbolic", St.IconType.SYMBOLIC);
        this._refreshItem.actor.connect("button-press-event", Lang.bind(this, function() {
            if (!this._authRejected) this._refresh();
            return true;
        }));
        this.menu.addMenuItem(this._refreshItem);

        // Settings live in the right-click menu; the popup is display-only.
        let accountSettings = new PopupMenu.PopupIconMenuItem("Account settings…", "view-list-symbolic", St.IconType.SYMBOLIC);
        accountSettings.connect("activate", Lang.bind(this, function() {
            Util.spawn(["/usr/bin/python3", this.metadata.path + "/accounts.py"]);
        }));
        this._applet_context_menu.addMenuItem(accountSettings);

        let settings = new PopupMenu.PopupIconMenuItem("Connection settings…", "preferences-system-symbolic", St.IconType.SYMBOLIC);
        settings.connect("activate", Lang.bind(this, function() {
            Util.spawnCommandLineAsyncIO("", Lang.bind(this, function() {
                this._authRejected = false;
                this._refresh();
            }), { argv: ["/usr/bin/python3", this.metadata.path + "/connection.py"] });
        }));
        this._applet_context_menu.addMenuItem(settings);
        this._applet_context_menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._renderLoading();
        this._refresh();

        this._refreshLoopId = Mainloop.timeout_add_seconds(this.refreshSeconds, Lang.bind(this, function() {
            if (!this._authRejected) this._refresh();
            return true;
        }));
    }

    on_applet_clicked() {
        if (this._lastError) this._renderError(this._lastError);
        else if (this._lastData) this._renderData(this._lastData);
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
        this._removed = true;
        this._prefsMonitor.cancel();
        if (this._positionIdle) Mainloop.source_remove(this._positionIdle);
        if (this._refreshLoopId) {
            Mainloop.source_remove(this._refreshLoopId);
            this._refreshLoopId = null;
        }
    }

    _refresh() {
        if (this._isRefreshing) {
            return;
        }

        this._isRefreshing = true;
        this._refreshItem.label.set_text("Refreshing...");

        Util.spawnCommandLineAsyncIO(
            "",
            Lang.bind(this, function(stdout, stderr, exitCode) {
                if (this._removed) return;
                this._isRefreshing = false;
                this._refreshItem.label.set_text("Refresh now");

                if (exitCode !== 0) {
                    this._lastError = stderr ? stderr.trim() : "Unknown fetch error";
                    this._authRejected = this._lastError.indexOf("Management key rejected") !== -1;
                    this._renderError(this._lastError);
                    return;
                }

                try {
                    let data = JSON.parse(stdout);
                    this._keepLastKnown(data, this._lastData);
                    this._saveKnownAccounts(data.accounts);
                    this._lastData = data;
                    this._lastError = null;
                    this._renderData(this._lastData);
                } catch (error) {
                    this._lastError = error.message;
                    this._renderError(this._lastError);
                }
            }),
            {
                argv: ["node", this.metadata.path + "/fetch-stats.mjs"]
            }
        );
    }

    _clearContent() {
        let children = this._content.get_children();
        for (let i = 0; i < children.length; i++) {
            children[i].destroy();
        }
    }

    _makeLabel(text, styleClass) {
        let label = new St.Label({
            text: text,
            style_class: styleClass,
            x_align: St.Align.START
        });
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        label.clutter_text.line_wrap = false;
        return label;
    }

    _formatDurationUntil(isoTime) {
        if (!isoTime) {
            return "unknown";
        }

        let diff = Math.floor((new Date(isoTime).getTime() - Date.now()) / 1000);
        if (diff <= 0) {
            return "now";
        }

        let days = Math.floor(diff / 86400);
        let hours = Math.floor((diff % 86400) / 3600);
        let minutes = Math.floor((diff % 3600) / 60);

        if (days > 0) {
            return days + "d " + hours + "h";
        }
        if (hours > 0) {
            return hours + "h " + minutes + "m";
        }
        if (minutes > 0) {
            return minutes + "m";
        }
        return "<1m";
    }

    _formatTimeAgo(isoTime) {
        if (!isoTime) {
            return "unknown";
        }

        let diff = Math.floor((Date.now() - new Date(isoTime).getTime()) / 1000);
        if (diff < 60) {
            return "just now";
        }
        if (diff < 3600) {
            return Math.floor(diff / 60).toString() + "m ago";
        }
        if (diff < 86400) {
            return Math.floor(diff / 3600).toString() + "h ago";
        }
        return Math.floor(diff / 86400).toString() + "d ago";
    }

    _renderLoading() {
        this._clearContent();
        this._content.add(this._makeLabel("CLIProxyAPI", "cpbar-heading"));
        this._content.add(this._makeLabel("Connecting…", "cpbar-muted"));
    }

    _renderError(message) {
        if (!this._lastData) this.set_applet_label("ERR");
        this.set_applet_tooltip(message);
        if (this._lastData) this._renderData(this._lastData);
        else this._clearContent();
        let label = this._makeLabel(message, "cpbar-error");
        label.clutter_text.line_wrap = true;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._content.add(label);
    }

    _repositionMenu() {
        if (this._positionIdle) Mainloop.source_remove(this._positionIdle);
        this._positionIdle = Mainloop.idle_add(Lang.bind(this, function() {
            this._positionIdle = null;
            if (!this._removed && this.menu.isOpen) this.menu.actor.set_position(...this.menu._calculatePosition());
            return false;
        }));
    }

    // A transient provider failure (e.g. HTTP 429) keeps the previous numbers, marked stale.
    _keepLastKnown(data, previous) {
        if (!previous) return;
        data.accounts.forEach(function(account) {
            if (!account.error || account.disabled) return;
            let old = previous.accounts.find(a => a.id === account.id);
            if (!old || !old.windows.length) return;
            account.windows = old.windows;
            account.plan = account.plan || old.plan;
            account.stale = account.error;
            account.error = null;
        });
    }

    _loadPrefs() {
        let prefs = {};
        try {
            prefs = JSON.parse(ByteArray.toString(GLib.file_get_contents(this._configDir + "/accounts.json")[1]));
        } catch (e) {}
        let list = value => Array.isArray(value) ? value : [];
        this._cardOrder = list(prefs.order);
        this._hiddenCards = list(prefs.hidden);
        this._excludedFromTotal = list(prefs.excluded);
    }

    _saveKnownAccounts(accounts) {
        let known = accounts.map(a => ({ id: PanelModel.accountKey(a), name: a.name, provider: a.provider, disabled: a.disabled }));
        GLib.file_set_contents(this._configDir + "/known-accounts.json", JSON.stringify(known));
    }

    _renderData(data) {
        this._clearContent();
        let accounts = PanelModel.orderAccounts(data.accounts || [], this._cardOrder);
        let summary = PanelModel.summarize(accounts, this._excludedFromTotal);
        let fmt = value => value === null ? "--" : value.toString();
        let flag = summary.missing || this._lastError ? " !" : "";
        this.set_applet_label(fmt(summary.session) + "/" + fmt(summary.weekly) + flag);
        this.set_applet_tooltip("5h " + fmt(summary.session) + "% / weekly " + fmt(summary.weekly) + "% left across " +
            summary.counted.length + " accounts" +
            (summary.missing ? "\n" + summary.missing + " counted accounts unavailable; totals are partial" : "") +
            (this._lastError ? "\nLast refresh failed: " + this._lastError : ""));
        this.set_applet_icon_symbolic_name("view-list-symbolic");

        let header = new St.BoxLayout({ style_class: "cpbar-header" });
        header.add(this._makeLabel("Limits", "cpbar-heading"), { expand: true });
        header.add(this._makeLabel("Updated " + this._formatTimeAgo(data.updatedAt), "cpbar-muted cpbar-updated"));
        this._content.add(header);
        if (!accounts.length) this._content.add(this._makeLabel("No accounts found. Add accounts in CLIProxyAPI.", "cpbar-muted"));

        let list = new St.BoxLayout({ vertical: true, style_class: "cpbar-list" });
        this._content.add(list);
        let cards = accounts.filter(a => this._hiddenCards.indexOf(PanelModel.accountKey(a)) === -1);
        if (accounts.length && !cards.length) list.add(this._makeLabel("All cards hidden · Right-click → Account settings…", "cpbar-muted"));
        cards.forEach(Lang.bind(this, function(account) {
            let counted = summary.counted.indexOf(account) !== -1;
            let provider = account.provider === "claude" ? "anthropic" : account.provider === "codex" ? "openai" : "other";
            let card = new St.BoxLayout({ vertical: true, style_class: "cpbar-account " + provider + (counted ? "" : " excluded") });
            let top = new St.BoxLayout({ style_class: "cpbar-identity" });
            top.add(this._makeLabel(account.name, "cpbar-account-name"), { expand: true });
            if (!counted) top.add(this._makeLabel("not in total", "cpbar-tag"));
            top.add(this._makeLabel(this._providerName(account) + (account.plan ? " · " + account.plan : ""), "cpbar-provider " + provider));
            card.add(top);
            if (account.error) card.add(this._makeLabel(account.error, "cpbar-note"));
            if (account.stale) card.add(this._makeLabel("Last known values · " + account.stale, "cpbar-note"));
            let row = null;
            account.windows.forEach(Lang.bind(this, function(w, index) {
                if (index % 2 === 0) {
                    row = new St.BoxLayout({ style_class: "cpbar-windows" });
                    card.add(row);
                }
                row.add(this._makeWindow(w, provider));
            }));
            list.add(card);
        }));

        let totals = new St.BoxLayout({ style_class: "cpbar-totals" });
        totals.add(this._makeLabel("Total · " + summary.counted.length + " accounts", "cpbar-totals-label"), { expand: true });
        totals.add(this._makeLabel("5h " + fmt(summary.session) + "%", "cpbar-totals-value"));
        totals.add(this._makeLabel("Weekly " + fmt(summary.weekly) + "%", "cpbar-totals-value"));
        this._content.add(totals);
        if (summary.missing) this._content.add(this._makeLabel(summary.missing + " counted account(s) unavailable · totals are partial", "cpbar-note"));
        this._repositionMenu();
    }

    _providerName(account) {
        return account.provider === "claude" ? "Anthropic" : account.provider === "codex" ? "OpenAI" : account.provider;
    }

    _makeWindow(w, provider) {
        let width = 208;
        let cell = new St.BoxLayout({ vertical: true, style_class: "cpbar-window" });
        cell.set_width(width);
        let metric = new St.BoxLayout({ style_class: "cpbar-metric" });
        metric.add(this._makeLabel(w.label.replace("Session · 5h", "5h"), "cpbar-limit-label"), { expand: true });
        metric.add(this._makeLabel(Math.round(w.remaining) + "%", "cpbar-percent" + (w.remaining <= 10 ? " critical" : w.remaining <= 25 ? " warning" : "")));
        cell.add(metric);
        // St.Widget lays children out at fixed positions, so the marker can sit over the fill.
        let meter = new St.Widget({ style_class: "cpbar-meter", height: 10 });
        meter.set_width(width);
        let track = new St.Widget({ style_class: "cpbar-track", width: width, height: 6, y: 2 });
        meter.add_child(track);
        if (w.remaining > 0) {
            let fill = new St.Widget({ style_class: "cpbar-fill " + provider, height: 6, y: 2 });
            fill.set_width(Math.max(4, Math.round(width * clamp(w.remaining, 0, 100) / 100)));
            meter.add_child(fill);
        }
        let even = PanelModel.evenRemaining(w, Date.now());
        if (even !== null) {
            let marker = new St.Widget({ style_class: "cpbar-even", width: 2, height: 10 });
            marker.set_x(Math.round(clamp(width * even / 100 - 1, 0, width - 2)));
            meter.add_child(marker);
        }
        cell.add(meter);
        cell.add(this._makeLabel(w.resetsAt ? "Resets in " + this._formatDurationUntil(w.resetsAt) : "Reset unknown", "cpbar-reset"));
        return cell;
    }

}

function main(metadata, orientation, panel_height, instance_id) {
    return new MintCodexBarApplet(metadata, orientation, panel_height, instance_id);
}
