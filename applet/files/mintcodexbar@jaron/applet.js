const Applet = imports.ui.applet;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Util = imports.misc.util;
const GLib = imports.gi.GLib;
const Cinnamon = imports.gi.Cinnamon;
const Pango = imports.gi.Pango;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

const SHELL_WIDTH = 420;
const METER_WIDTH = 168;

class MintCodexBarApplet extends Applet.TextIconApplet {
    constructor(metadata, orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this.metadata = metadata;
        this.instance_id = instance_id;
        this.refreshSeconds = 90;
        this._refreshLoopId = null;
        this._isRefreshing = false;
        this._lastData = null;
        this._lastError = null;

        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.set_applet_icon_symbolic_name("utilities-terminal-symbolic");
        this.set_applet_label("--/--");
        this.set_applet_tooltip("Loading Codex stats...");

        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        this._defaultCalculateMenuPosition = this.menu._calculatePosition.bind(this.menu);
        this.menu._calculatePosition = Lang.bind(this, this._calculateAnchoredMenuPosition);

        this._contentItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            activate: false,
            hover: false,
            sensitive: false,
            focusOnHover: false,
            style_class: "mintcodexbar-content-item"
        });
        this.menu.addMenuItem(this._contentItem);

        this._content = new St.BoxLayout({
            vertical: true,
            style_class: "mintcodexbar-shell",
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
            this._refresh();
            return true;
        }));
        this.menu.addMenuItem(this._refreshItem);

        this._openProjectItem = new PopupMenu.PopupIconMenuItem("Open latest project", "folder-symbolic", St.IconType.SYMBOLIC);
        this._openProjectItem.connect("activate", Lang.bind(this, this._openLatestProject));
        this.menu.addMenuItem(this._openProjectItem);

        this._openSessionsItem = new PopupMenu.PopupIconMenuItem("Open Codex sessions", "document-open-symbolic", St.IconType.SYMBOLIC);
        this._openSessionsItem.connect("activate", function() {
            Util.spawnCommandLine("xdg-open ~/.codex/sessions");
        });
        this.menu.addMenuItem(this._openSessionsItem);

        this._renderLoading();
        this._refresh();

        this._refreshLoopId = Mainloop.timeout_add_seconds(this.refreshSeconds, Lang.bind(this, function() {
            this._refresh();
            return true;
        }));
    }

    on_applet_clicked() {
        this.menu.toggle();
    }

    on_applet_removed_from_panel() {
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
                this._isRefreshing = false;
                this._refreshItem.label.set_text("Refresh now");

                if (exitCode !== 0) {
                    this._lastError = stderr ? stderr.trim() : "Unknown fetch error";
                    this._renderError(this._lastError);
                    return;
                }

                try {
                    this._lastData = JSON.parse(stdout);
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
            this._content.remove_child(children[i]);
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

    _calculateAnchoredMenuPosition() {
        let [xPos, yPos] = this._defaultCalculateMenuPosition();

        if (!this.menu || (this.orientation !== St.Side.TOP && this.orientation !== St.Side.BOTTOM)) {
            return [xPos, yPos];
        }

        if (this._panelLocation !== "left" && this._panelLocation !== "right") {
            return [xPos, yPos];
        }

        let sourceBox = Cinnamon.util_get_transformed_allocation(this.actor);
        let [, , natWidth] = this.menu.actor.get_preferred_size();
        let monitor = imports.ui.main.layoutManager.findMonitorForActor(this.actor);
        let xMin = monitor.x;
        let xMax = monitor.x + monitor.width - natWidth;

        if (this._panelLocation === "right") {
            xPos = sourceBox.x2 - natWidth;
        } else {
            xPos = sourceBox.x1;
        }

        xPos = Math.max(xMin, Math.min(xMax, xPos));
        return [Math.round(xPos), yPos];
    }

    _makeMetricCard(title, value, resetAt, resetIn, percent, fillClass) {
        let card = new St.BoxLayout({
            vertical: true,
            style_class: "mintcodexbar-card",
            x_expand: true
        });

        card.set_width(Math.floor((SHELL_WIDTH - 10) / 2));

        card.add(this._makeLabel(title, "mintcodexbar-title"));
        card.add(this._makeLabel(value, "mintcodexbar-value"));
        card.add(this._makeLabel(resetAt, "mintcodexbar-caption"));

        let meter = new St.BoxLayout({
            style_class: "mintcodexbar-meter",
            x_expand: true,
            y_expand: false
        });

        meter.set_width(METER_WIDTH);

        let fill = new St.Widget({
            style_class: fillClass
        });
        fill.set_width(Math.round(METER_WIDTH * clamp(percent, 0, 100) / 100));
        meter.add(fill);
        card.add(meter);
        card.add(this._makeLabel(resetIn, "mintcodexbar-subtitle"));

        return card;
    }

    _makeMiniCard(title, value, subtitle) {
        let card = new St.BoxLayout({
            vertical: true,
            style_class: "mintcodexbar-card",
            x_expand: true
        });
        card.set_width(Math.floor((SHELL_WIDTH - 10) / 2));
        card.add(this._makeLabel(title, "mintcodexbar-title"));
        card.add(this._makeLabel(value, "mintcodexbar-value-small"));
        card.add(this._makeLabel(subtitle, "mintcodexbar-caption"));
        return card;
    }

    _makeRow() {
        return new St.BoxLayout({
            vertical: false,
            style_class: "mintcodexbar-grid",
            x_expand: true
        });
    }

    _formatRemaining(windowData) {
        if (!windowData) {
            return "--";
        }
        return Math.max(0, 100 - windowData.usedPercent).toString() + "%";
    }

    _formatWindowTitle(windowData, fallback) {
        if (!windowData || !windowData.windowMinutes) {
            return fallback;
        }

        let minutes = Number(windowData.windowMinutes);
        if (minutes === 300) {
            return "5h window";
        }
        if (minutes === 10080) {
            return "Weekly window";
        }
        if (minutes % 1440 === 0) {
            return (minutes / 1440).toString() + "d window";
        }
        if (minutes % 60 === 0) {
            return (minutes / 60).toString() + "h window";
        }
        return minutes.toString() + "m window";
    }

    _hasTemporaryFiveHourRemoval(primary, secondary) {
        return !!(
            primary &&
            !secondary &&
            Number(primary.windowMinutes) >= 7 * 24 * 60
        );
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

    _formatResetClock(isoTime) {
        if (!isoTime) {
            return "reset unknown";
        }

        let date = new Date(isoTime);
        let hours = date.getHours().toString().padStart(2, "0");
        let minutes = date.getMinutes().toString().padStart(2, "0");
        return "reset " + hours + ":" + minutes;
    }

    _formatResetRemaining(isoTime) {
        if (!isoTime) {
            return "unknown";
        }

        return this._formatDurationUntil(isoTime) + " left";
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

    _formatNumber(value) {
        if (value === null || typeof value === "undefined") {
            return "n/a";
        }
        return Number(value).toLocaleString();
    }

    _formatCurrency(value) {
        if (value === null || typeof value === "undefined" || Number.isNaN(Number(value))) {
            return "n/a";
        }

        return new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: "USD",
            minimumFractionDigits: value < 0.01 ? 4 : 2,
            maximumFractionDigits: value < 0.01 ? 4 : 2
        }).format(Number(value));
    }

    _formatMonthLabel(monthKey) {
        if (!monthKey || monthKey.indexOf("-") === -1) {
            return "this month";
        }

        let parts = monthKey.split("-");
        let year = Number(parts[0]);
        let month = Number(parts[1]) - 1;
        let date = new Date(year, month, 1);

        return date.toLocaleString(undefined, {
            month: "long",
            year: "numeric"
        });
    }

    _shortenPath(filePath) {
        if (!filePath) {
            return "unknown project";
        }

        let homeDir = GLib.get_home_dir();
        let normalized = filePath.indexOf(homeDir) === 0 ? "~" + filePath.slice(homeDir.length) : filePath;

        if (normalized.length <= 26) {
            return normalized;
        }

        let parts = normalized.split("/").filter(function(part) {
            return part.length > 0;
        });

        if (parts.length <= 2) {
            return normalized.slice(0, 23) + "...";
        }

        let prefix = normalized.indexOf("~") === 0 ? "~/" : "/";
        return prefix + ".../" + parts.slice(-2).join("/");
    }

    _renderLoading() {
        this._clearContent();
        let hero = new St.BoxLayout({
            vertical: true,
            style_class: "mintcodexbar-hero"
        });
        hero.add(this._makeLabel("Codex", "mintcodexbar-title"));
        hero.add(this._makeLabel("Loading live stats...", "mintcodexbar-value-small"));
        hero.add(this._makeLabel("Reading app-server + local sessions", "mintcodexbar-subtitle"));
        this._content.add(hero);
    }

    _renderError(message) {
        this.set_applet_label("ERR");
        this.set_applet_tooltip("Mint Codex Bar: " + message);
        this._clearContent();

        let card = new St.BoxLayout({
            vertical: true,
            style_class: "mintcodexbar-error"
        });
        card.add(this._makeLabel("Codex fetch failed", "mintcodexbar-title"));
        card.add(this._makeLabel(message, "mintcodexbar-subtitle"));
        this._content.add(card);
    }

    _renderData(data) {
        let primary = data.rateLimits ? data.rateLimits.primary : null;
        let secondary = data.rateLimits ? data.rateLimits.secondary : null;
        let local = data.local || {};
        let latestSession = local.latestSession || null;
        let plan = data.account && data.account.planType ? data.account.planType : "unknown";
        let email = data.account && data.account.email ? data.account.email : "not available";
        let credits = data.rateLimits && data.rateLimits.credits ? data.rateLimits.credits : null;
        let monthSpend = local.monthSpend || null;
        let primaryLeft = primary ? primary.remainingPercent : null;
        let secondaryLeft = secondary ? secondary.remainingPercent : null;
        let panelPrimary = primaryLeft === null ? "--" : primaryLeft.toString();
        let panelSecondary = secondaryLeft === null ? "--" : secondaryLeft.toString();
        let temporaryFiveHourRemoval = this._hasTemporaryFiveHourRemoval(primary, secondary);
        let panelLabel = secondary ? panelPrimary + "/" + panelSecondary : panelPrimary + "%";
        let panelTooltip = secondary
            ? "Codex " + panelPrimary + "% / " + panelSecondary + "% left"
            : "Codex " + panelPrimary + "% left";

        if (temporaryFiveHourRemoval) {
            panelTooltip += "; 5h limit temporarily removed";
        }

        this.set_applet_label(panelLabel);
        this.set_applet_tooltip(panelTooltip);
        this._openProjectItem.actor.visible = !!(latestSession && latestSession.cwd);

        this._clearContent();

        let hero = new St.BoxLayout({
            vertical: true,
            style_class: "mintcodexbar-hero"
        });
        hero.add(this._makeLabel("Codex", "mintcodexbar-title"));
        hero.add(this._makeLabel(plan.toUpperCase(), "mintcodexbar-value-small"));
        hero.add(this._makeLabel(email, "mintcodexbar-subtitle"));
        hero.add(this._makeLabel("Updated " + this._formatTimeAgo(data.updatedAt), "mintcodexbar-caption"));
        this._content.add(hero);

        let usageRow = this._makeRow();
        usageRow.add(this._makeMetricCard(
            this._formatWindowTitle(primary, "5h window"),
            this._formatRemaining(primary),
            this._formatResetClock(primary ? primary.resetsAt : null),
            this._formatResetRemaining(primary ? primary.resetsAt : null),
            primary ? primary.remainingPercent : 0,
            "mintcodexbar-meter-fill-primary"
        ));
        if (temporaryFiveHourRemoval) {
            usageRow.add(this._makeMiniCard(
                "5h limit",
                "Temporarily off",
                "no 5h cap"
            ));
        } else {
            usageRow.add(this._makeMetricCard(
                this._formatWindowTitle(secondary, "Weekly window"),
                this._formatRemaining(secondary),
                this._formatResetClock(secondary ? secondary.resetsAt : null),
                this._formatResetRemaining(secondary ? secondary.resetsAt : null),
                secondary ? secondary.remainingPercent : 0,
                "mintcodexbar-meter-fill-secondary"
            ));
        }
        this._content.add(usageRow);

        let statsRow = this._makeRow();
        statsRow.add(this._makeMiniCard(
            "Credits",
            credits ? (credits.unlimited ? "unlimited" : (credits.balance || "0")) : "n/a",
            credits && credits.hasCredits ? "credits available" : "no extra credits"
        ));
        statsRow.add(this._makeMiniCard(
            "Today",
            (local.sessionsToday || 0).toString(),
            "sessions started"
        ));
        this._content.add(statsRow);

        let activityRow = this._makeRow();
        activityRow.add(this._makeMiniCard(
            "7 days",
            (local.sessionsLast7Days || 0).toString(),
            "recent sessions"
        ));
        activityRow.add(this._makeMiniCard(
            "Spend",
            monthSpend ? this._formatCurrency(monthSpend.totalUsd) : "n/a",
            monthSpend ? this._formatMonthLabel(monthSpend.monthKey) + " API estimate" : "this month"
        ));
        this._content.add(activityRow);

        if (latestSession && latestSession.tokenUsage) {
            let tokenRow = this._makeRow();
            tokenRow.add(this._makeMiniCard(
                "Latest total",
                this._formatNumber(latestSession.tokenUsage.totalTokens),
                "latest snapshot"
            ));
            tokenRow.add(this._makeMiniCard(
                "Last turn",
                this._formatNumber(latestSession.tokenUsage.lastTurnTokens),
                latestSession && latestSession.cwd ? this._shortenPath(latestSession.cwd) : "unknown project"
            ));
            this._content.add(tokenRow);
        }
    }

    _openLatestProject() {
        if (!this._lastData || !this._lastData.local || !this._lastData.local.latestSession) {
            return;
        }

        let cwd = this._lastData.local.latestSession.cwd;
        if (!cwd) {
            return;
        }

        Util.spawnCommandLine("xdg-open " + GLib.shell_quote(cwd));
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new MintCodexBarApplet(metadata, orientation, panel_height, instance_id);
}
