//    Task Up UltraLite
//    GNOME Shell extension
//    @fthx 2025


import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import { AppMenu } from 'resource:///org/gnome/shell/ui/appMenu.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';


const UNFOCUSED_OPACITY = 128; // 0...255

const TaskButton = GObject.registerClass(
class TaskButton extends PanelMenu.Button {
    _init(window) {
        super._init();

        this._window = window;

        this.add_style_class_name('window-button');
        this._makeButtonBox();

        this._updateApp();
        this._updateFocus();
        this._updateTitle();
        this._updateVisibility();

        this._id = 'task-button-' + this._window;
        if (!Main.panel.statusArea[this._id])
            Main.panel.addToStatusArea(this._id, this, -1, 'left');

        this._connectSignals();
    }

    _connectSignals() {
        global.workspace_manager.connectObject('active-workspace-changed', this._updateVisibility.bind(this), this);
        Main.overview.connectObject(
            'showing', () => this.hide(),
            'hidden', this._updateVisibility.bind(this),
            this);

        this._window.connectObject(
            'notify::appears-focused', this._updateFocus.bind(this),
            'notify::title', this._updateTitle.bind(this),
            'notify::wm-class', this._updateApp.bind(this), GObject.ConnectFlags.AFTER,
            'notify::gtk-application-id', this._updateApp.bind(this), GObject.ConnectFlags.AFTER,
            'notify::skip-taskbar', this._updateVisibility.bind(this),
            'workspace-changed', this._updateVisibility.bind(this),
            'unmanaging', this._destroy.bind(this),
            this);

        this.connectObject(
            'notify::hover', this._onHover.bind(this),
            'button-press-event', (widget, event) => this._onClick(event),
            this);
    }

    _disconnectSignals() {
        global.workspace_manager.disconnectObject(this);
        Main.overview.disconnectObject(this);

        this._window?.disconnectObject(this);
    }

    _makeButtonBox() {
        this._box = new St.BoxLayout();

        this._icon = new St.Icon();
        this._icon.set_icon_size(Main.panel.height / 2);
        this._icon.set_fallback_gicon(null);
        this._box.add_child(this._icon);

        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._label);

        this.add_child(this._box);

        this.setMenu(new AppMenu(this));
    }

    _onClick(event) {
        if (event.get_button() == Clutter.BUTTON_PRIMARY) {
            this.menu.close();

            if (this._window?.has_focus()) {
                if (this._window?.can_minimize() && !Main.overview.visible)
                    this._window?.minimize();
            } else {
                this._window?.activate(global.get_current_time());
                this._window?.focus(global.get_current_time());
            }
            Main.overview.hide();

            return Clutter.EVENT_STOP;
        }

        if (event.get_button() == Clutter.BUTTON_MIDDLE) {
            this.menu.close();

            if (this._app?.can_open_new_window())
                this._app?.open_new_window(-1);
            Main.overview.hide();

            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _onHover() {
        if (!Main.wm._canScroll)
            return;

        if (this.get_hover() && !this._window?.on_all_workspaces)
            this._window?.raise();
        else
            global.display.focus_window?.raise();
    }

    _updateFocus() {
        if (this._window?.has_focus())
            this._box.set_opacity(255);
        else
            this._box.set_opacity(UNFOCUSED_OPACITY);
    }

    _updateTitle() {
        this._label.set_text(this._window?.get_title());
    }

    _updateApp() {
        this._app = Shell.WindowTracker.get_default().get_window_app(this._window);

        if (this._app) {
            this._icon.set_gicon(this._app.get_icon());
            this.menu.setApp(this._app);
        }
    }

    _updateVisibility() {
        let activeWorkspace = global.workspace_manager.get_active_workspace();
        let windowIsOnActiveWorkspace = this._window?.located_on_workspace(activeWorkspace);

        this.visible = !Main.overview.visible && !this._window?.is_skip_taskbar() && windowIsOnActiveWorkspace;
    }

    _destroy() {
        this._disconnectSignals();
        this.destroy();
    }
});

const TaskBar = GObject.registerClass(
class TaskBar extends GObject.Object {
    _init() {
        super._init();

        this._makeTaskbar();
        this._connectSignals();
    }

    _makeTaskButton(window) {
        if (!window || window.is_skip_taskbar() || window.get_window_type() == Meta.WindowType.MODAL_DIALOG)
            return;

        new TaskButton(window);
    }

    _destroyTaskbar() {
        if (this._makeTaskbarTimeout) {
            GLib.Source.remove(this._makeTaskbarTimeout);
            this._makeTaskbarTimeout = null;
        }

        for (let bin of Main.panel._leftBox.get_children()) {
            let button = bin.first_child;

            if (button && button instanceof TaskButton) {
                button._destroy();
                button = null;
            }
        }
    }

    _makeTaskbar() {
        this._moveDate(true);

        this._makeTaskbarTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            let workspacesNumber = global.workspace_manager.n_workspaces;

            for (let workspaceIndex = 0; workspaceIndex < workspacesNumber; workspaceIndex++) {
                let workspace = global.workspace_manager.get_workspace_by_index(workspaceIndex);
                let windowsList = workspace.list_windows();

                for (let window of windowsList)
                    this._makeTaskButton(window);
            }

            return GLib.SOURCE_REMOVE;
        });
    }

    _moveDate(active) {
        let panel = Main.sessionMode.panel;

        if (active) {
            panel.center = panel.center.filter(item => item != 'dateMenu')
            panel.right.splice(-1, 0, 'dateMenu');
        } else {
            panel.right = panel.right.filter(item => item != 'dateMenu')
            panel.center.push('dateMenu');
        }

        Main.panel._updatePanel();
    }

    _connectSignals() {
        global.display.connectObject('window-created', (display, window) => this._makeTaskButton(window), this);
        Main.panel.connectObject('scroll-event', (actor, event) => Main.wm.handleWorkspaceScroll(event), this);
    }

    _disconnectSignals() {
        global.display.disconnectObject(this);
        Main.panel.disconnectObject(this);
    }

    _destroy() {
        this._disconnectSignals();
        this._destroyTaskbar();

        this._moveDate(false);
    }
});

export default class TaskUpUltraLiteExtension {
    enable() {
        this._taskbar = new TaskBar();
    }

    disable() {
        this._taskbar._destroy();
        this._taskbar = null;
    }
}
