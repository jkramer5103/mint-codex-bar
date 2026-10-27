#!/usr/bin/env python3
"""Account settings: card order, card visibility and which accounts count in the total.

The applet writes known-accounts.json after each refresh; this window writes
accounts.json, which the applet watches and applies immediately.
"""
import json
import os
from pathlib import Path
import tempfile
import gi
gi.require_version('Gtk', '3.0')
from gi.repository import GLib, Gtk, Pango

folder = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config'))) / 'mintcodexbar'
prefs_path = folder / 'accounts.json'


def load(path, fallback):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return fallback


known = load(folder / 'known-accounts.json', [])
prefs = load(prefs_path, {})
order, hidden, excluded = (list(prefs.get(k, [])) for k in ('order', 'hidden', 'excluded'))
rank = {key: i for i, key in enumerate(order)}
accounts = sorted(known, key=lambda a: rank.get(a['id'], len(order)))


def save():
    folder.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temp = tempfile.mkstemp(dir=folder)
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump({'order': [a['id'] for a in accounts], 'hidden': hidden, 'excluded': excluded}, stream)
        os.replace(temp, prefs_path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def set_member(items, key, present):
    if key in items:
        items.remove(key)
    if present:
        items.append(key)
    save()


window = Gtk.Window(title='CLIProxy Bar · Accounts')
window.set_default_size(560, -1)
window.connect('destroy', Gtk.main_quit)
outer = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=10, border_width=18)
window.add(outer)
intro = Gtk.Label(xalign=0, wrap=True, label='Card: shown in the popup.  Total: counted in the panel and the total at the bottom.  Use the arrows to change the card order.')
outer.pack_start(intro, False, False, 0)
listbox = Gtk.ListBox(selection_mode=Gtk.SelectionMode.NONE)
listbox.get_style_context().add_class('frame')
outer.pack_start(listbox, True, True, 0)


def move(index, delta):
    accounts.insert(index + delta, accounts.pop(index))
    save()
    rebuild()


def rebuild():
    for child in listbox.get_children():
        listbox.remove(child)
    for index, account in enumerate(accounts):
        key = account['id']
        row = Gtk.Box(spacing=8, border_width=6)
        for symbol, delta, enabled in (('go-up-symbolic', -1, index > 0), ('go-down-symbolic', 1, index < len(accounts) - 1)):
            button = Gtk.Button.new_from_icon_name(symbol, Gtk.IconSize.BUTTON)
            button.set_relief(Gtk.ReliefStyle.NONE)
            button.set_sensitive(enabled)
            button.connect('clicked', lambda _b, i=index, d=delta: move(i, d))
            row.pack_start(button, False, False, 0)
        provider = {'claude': 'Anthropic', 'codex': 'OpenAI'}.get(account['provider'], account['provider'])
        name = Gtk.Label(xalign=0, ellipsize=Pango.EllipsizeMode.END)
        name.set_markup('<b>{}</b>  <small>{}</small>'.format(
            GLib.markup_escape_text(account['name']), GLib.markup_escape_text(provider + (' · disabled in CLIProxyAPI' if account.get('disabled') else ''))))
        row.pack_start(name, True, True, 0)
        card = Gtk.CheckButton(label='Card', active=key not in hidden)
        card.connect('toggled', lambda b, k=key: set_member(hidden, k, not b.get_active()))
        row.pack_start(card, False, False, 0)
        total = Gtk.CheckButton(label='Total', active=key not in excluded and not account.get('disabled'))
        total.set_sensitive(not account.get('disabled'))
        total.connect('toggled', lambda b, k=key: set_member(excluded, k, not b.get_active()))
        row.pack_start(total, False, False, 0)
        listbox.add(row)
    if not accounts:
        listbox.add(Gtk.Label(label='No accounts yet. Open the popup once after connecting.', border_width=12))
    listbox.show_all()


buttons = Gtk.Box(spacing=8)
close = Gtk.Button(label='Close')
close.connect('clicked', lambda _b: window.destroy())
buttons.pack_end(close, False, False, 0)
outer.pack_start(buttons, False, False, 0)
rebuild()
window.show_all()
Gtk.main()
